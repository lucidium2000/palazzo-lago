/**
 * Listening to you (voice replies to the people you talk to). Two engines:
 * the browser's own speech recognition where it exists and works (desktop and
 * Android Chrome), and Vosk, an offline recognizer running in the headset
 * (Quest Browser has no speech recognition). Vosk's small English model
 * (~40 MB, Apache-2.0) is fetched once, the first time you're asked something.
 */

const MODEL_URL = 'asr/vosk-model-small-en-us-0.15.tar.gz';

type Engine = 'browser' | 'vosk' | 'none';

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export class Listener {
  private engine: Engine | null = null;
  private browserFailed = false;
  private vosk: Promise<import('vosk-browser').Model | null> | null = null;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private active: (() => void) | null = null;
  /** Shown while listening (e.g. a "listening…" badge). */
  onState: ((s: 'idle' | 'loading' | 'listening') => void) | null = null;
  enabled = true;
  /** What it's doing now (the VR reply strip lights its mic while listening). */
  state: 'idle' | 'loading' | 'listening' = 'idle';

  private setState(s: 'idle' | 'loading' | 'listening') {
    this.state = s;
    this.onState?.(s);
  }

  constructor() {
    try {
      this.enabled = localStorage.getItem('palazzo-lago.voiceReplies') !== 'off';
    } catch {
      /* private mode */
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.stop();
    try {
      localStorage.setItem('palazzo-lago.voiceReplies', on ? 'on' : 'off');
    } catch {
      /* private mode */
    }
  }

  private browserApi(): (new () => SpeechRecognitionLike) | null {
    const w = globalThis as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
  }

  /** Stop listening now. */
  stop() {
    this.active?.();
    this.active = null;
    this.setState('idle');
  }

  /**
   * Listens for one short answer (up to `seconds`). Resolves with what was
   * heard ('' for silence), or null if listening isn't possible here.
   */
  async listen(vocab: string[], seconds = 7): Promise<string | null> {
    if (!this.enabled) return null;
    this.stop();
    const Api = !this.browserFailed ? this.browserApi() : null;
    if (Api) {
      const heard = await this.listenBrowser(Api, seconds);
      if (heard !== null) return heard;
      this.browserFailed = true; // e.g. a browser without its speech service: use Vosk from now on
    }
    return this.listenVosk(vocab, seconds);
  }

  private listenBrowser(Api: new () => SpeechRecognitionLike, seconds: number): Promise<string | null> {
    return new Promise((resolve) => {
      let done = false;
      let rec: SpeechRecognitionLike;
      try {
        rec = new Api();
      } catch {
        resolve(null);
        return;
      }
      const finish = (v: string | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.active = null;
        this.setState('idle');
        try {
          rec.abort();
        } catch {
          /* already stopped */
        }
        resolve(v);
      };
      rec.lang = 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 3;
      rec.continuous = false;
      rec.onresult = (e) => {
        const alts = e.results[0];
        finish(alts && alts.length ? Array.from({ length: alts.length }, (_, i) => alts[i].transcript).join(' | ') : '');
      };
      rec.onerror = (e) => finish(e.error === 'no-speech' || e.error === 'aborted' ? '' : null);
      rec.onend = () => finish('');
      const timer = setTimeout(() => finish(''), seconds * 1000);
      this.active = () => finish('');
      try {
        rec.start();
        this.engine = 'browser';
        this.setState('listening');
      } catch {
        finish(null);
      }
    });
  }

  private async micStream() {
    if (this.stream && this.stream.getAudioTracks().some((t) => t.readyState === 'live')) return this.stream;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    return this.stream;
  }

  private loadVosk() {
    return (this.vosk ??= (async () => {
      try {
        const url = new URL(MODEL_URL, document.baseURI).href;
        const head = await fetch(url, { method: 'HEAD' });
        if (!head.ok) return null;
        const { createModel } = await import('vosk-browser');
        return await createModel(url, -1);
      } catch {
        return null;
      }
    })());
  }

  private async listenVosk(vocab: string[], seconds: number): Promise<string | null> {
    this.setState('loading');
    const model = await this.loadVosk();
    if (!model) {
      this.setState('idle');
      this.engine = 'none';
      return null;
    }
    let stream: MediaStream;
    try {
      stream = await this.micStream();
    } catch {
      this.setState('idle');
      return null;
    }
    this.engine = 'vosk';
    this.ctx ??= new AudioContext();
    const ctx = this.ctx;
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    // A small grammar (the words that matter here, plus "anything else") makes the small model much more accurate.
    const rec = new model.KaldiRecognizer(ctx.sampleRate, JSON.stringify([...vocab, '[unk]']));
    const src = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    return new Promise((resolve) => {
      let done = false;
      let text = '';
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearTimeout(quiet);
        this.active = null;
        try {
          src.disconnect();
          node.disconnect();
          rec.remove();
        } catch {
          /* gone */
        }
        this.setState('idle');
        resolve(text.replace(/\[unk\]/g, '').trim());
      };
      let quiet: ReturnType<typeof setTimeout> | undefined;
      rec.on('result', (m) => {
        const t = (m as unknown as { result: { text: string } }).result.text;
        if (t && t.replace(/\[unk\]/g, '').trim()) {
          text += ' ' + t;
          // A short pause after an answer: done.
          clearTimeout(quiet);
          quiet = setTimeout(finish, 600);
        }
      });
      node.onaudioprocess = (e) => {
        try {
          rec.acceptWaveform(e.inputBuffer);
        } catch {
          /* recognizer gone */
        }
      };
      src.connect(node);
      node.connect(sink);
      sink.connect(ctx.destination);
      const timer = setTimeout(() => {
        try {
          rec.retrieveFinalResult();
        } catch {
          /* gone */
        }
        setTimeout(finish, 400);
      }, seconds * 1000);
      this.active = finish;
      this.setState('listening');
    });
  }

  /** Which engine is in use (for the help text / debugging). */
  get using() {
    return this.engine;
  }
}
