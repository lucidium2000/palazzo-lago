import * as THREE from 'three';

/**
 * Voice chat between the two players: a WebRTC audio call whose handshake
 * (offer/answer, with ICE candidates gathered up front) travels over the
 * game's own connection in small chunks. The friend's voice plays from their
 * avatar's head as positional audio, so in VR they sound like they're beside
 * you. STUN only (no relay server), so a few very strict networks can't connect.
 */

const ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const CHUNK = 900;

interface Link {
  pc: RTCPeerConnection;
  audio: THREE.PositionalAudio | null;
  el: HTMLAudioElement | null;
  parts: Map<string, string[]>;
  started: boolean;
  /** Listens to their incoming voice (drives their avatar's mouth, in sync with what you hear). */
  analyser: AnalyserNode | null;
  level: number;
}

export class Voice {
  /** Mic is on and we're taking part. */
  enabled = false;
  muted = false;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private buf = new Float32Array(512);
  private smooth = 0;
  private links = new Map<string, Link>();
  readonly anchor = new Map<string, THREE.Object3D>();
  onChange: (() => void) | null = null;

  constructor(
    private send: (k: string, d: unknown) => void,
    private listener: THREE.AudioListener,
    private scene: THREE.Scene,
    private host: boolean,
  ) {}

  /** Asks for the microphone. Returns an error message, or null when voice is on. */
  async enable(): Promise<string | null> {
    if (this.enabled) return null;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') return window.top !== window.self ? 'Voice chat is blocked inside this embedded window: open the casino on its own page (start screen) or from your own web host' : 'Voice chat is not supported in this browser';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      const name = (e as DOMException).name;
      return name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Microphone access was blocked (allow it in the browser, or open the game outside the embedded viewer)'
        : 'No microphone found';
    }
    // A level meter on your own mic drives your avatar's mouth.
    try {
      const ctx = this.listener.context;
      const src = ctx.createMediaStreamSource(this.stream);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser);
    } catch {
      this.analyser = null;
    }
    this.enabled = true;
    this.muted = false;
    this.onChange?.();
    return null;
  }

  setMuted(m: boolean) {
    this.muted = m;
    for (const t of this.stream?.getAudioTracks() ?? []) t.enabled = !m;
    this.onChange?.();
  }

  disable() {
    for (const id of [...this.links.keys()]) this.drop(id);
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    this.enabled = false;
    this.onChange?.();
  }

  /** How loud you're talking right now, 0..1 (0 when muted). */
  private rbuf = new Float32Array(512);
  private fbuf = new Uint8Array(256);

  /**
   * How loud your friend is speaking right now (0..1) and how "open" the
   * sound is (vowels carry more low-mid energy than consonants), from the
   * voice you're hearing. Null when there's no audio from them.
   */
  remoteLevel(id: string): { level: number; vowel: number } | null {
    const l = this.links.get(id);
    const an = l?.analyser;
    if (!an) return null;
    an.getFloatTimeDomainData(this.rbuf);
    let sum = 0;
    for (const v of this.rbuf) sum += v * v;
    const rms = Math.sqrt(sum / this.rbuf.length);
    const target = Math.min(1, Math.max(0, (rms - 0.008) * 10));
    l.level += (target - l.level) * (target > l.level ? 0.75 : 0.4);
    an.getByteFrequencyData(this.fbuf);
    // Share of energy in the vowel band (~300–1000 Hz) vs. everything above it.
    const bin = this.listener.context.sampleRate / an.fftSize;
    let lo = 0,
      hi = 1;
    for (let i = 1; i < this.fbuf.length; i++) {
      const f = i * bin;
      if (f > 250 && f < 1000) lo += this.fbuf[i];
      else if (f >= 1000 && f < 6000) hi += this.fbuf[i];
    }
    return { level: l.level, vowel: Math.min(1, lo / (lo + hi) * 1.6) };
  }

  level(): number {
    if (!this.analyser || this.muted) return (this.smooth *= 0.6);
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += v * v;
    const rms = Math.sqrt(sum / this.buf.length);
    const target = Math.min(1, Math.max(0, (rms - 0.012) * 9));
    this.smooth += (target - this.smooth) * (target > this.smooth ? 0.7 : 0.35);
    return this.smooth;
  }

  get connectedCount() {
    let n = 0;
    for (const l of this.links.values()) if (l.pc.connectionState === 'connected') n++;
    return n;
  }

  /**
   * The remote player's voice flag changed (or we just enabled ours): the
   * host starts the call once both sides have voice on.
   */
  sync(id: string, remoteOn: boolean) {
    const link = this.links.get(id);
    if (!remoteOn || !this.enabled) {
      if (link) this.drop(id);
      return;
    }
    if (link || !this.host) return;
    void this.call(id);
  }

  private makeLink(id: string): Link {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const link: Link = { pc, audio: null, el: null, parts: new Map(), started: false, analyser: null, level: 0 };
    for (const t of this.stream?.getAudioTracks() ?? []) pc.addTrack(t, this.stream!);
    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      // Chrome only starts pulling a remote stream into Web Audio once a media element plays it.
      const el = new Audio();
      el.srcObject = stream;
      el.muted = true;
      void el.play().catch(() => {});
      const audio = new THREE.PositionalAudio(this.listener);
      audio.setMediaStreamSource(stream);
      audio.setRefDistance(1.2);
      audio.setRolloffFactor(0.8);
      audio.setDistanceModel('inverse');
      audio.setVolume(1.6);
      // Tap their voice (before distance attenuation) to move their mouth.
      try {
        const an = this.listener.context.createAnalyser();
        an.fftSize = 512;
        (audio.source as AudioNode).connect(an);
        link.analyser = an;
      } catch {
        /* no analyser: falls back to the level they send */
      }
      this.scene.add(audio);
      link.audio = audio;
      link.el = el;
      this.onChange?.();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        this.drop(id);
        this.onChange?.();
      } else this.onChange?.();
    };
    this.links.set(id, link);
    return link;
  }

  private async call(id: string) {
    const link = this.makeLink(id);
    if (!this.stream) link.pc.addTransceiver('audio', { direction: 'recvonly' });
    const offer = await link.pc.createOffer();
    await link.pc.setLocalDescription(offer);
    await gathered(link.pc);
    this.sendSdp(id, 'offer', link.pc.localDescription!.sdp);
  }

  private sendSdp(to: string, type: 'offer' | 'answer', sdp: string) {
    const key = Math.random().toString(36).slice(2, 8);
    const n = Math.ceil(sdp.length / CHUNK);
    for (let i = 0; i < n; i++) {
      // Spaced out so each chunk rides its own update.
      setTimeout(() => this.send('vsig', { to, key, type, i, n, s: sdp.slice(i * CHUNK, (i + 1) * CHUNK) }), i * 180);
    }
  }

  /** A chunk of the other side's offer/answer arrived. */
  async signal(from: string, me: string | null, d: { to?: string; key: string; type: 'offer' | 'answer'; i: number; n: number; s: string }) {
    if (d.to && me && d.to !== me) return;
    if (!this.enabled) return;
    let link = this.links.get(from);
    if (d.type === 'offer' && link && link.started) return;
    if (!link) {
      if (d.type !== 'offer') return;
      link = this.makeLink(from);
    }
    const parts = link.parts.get(d.key) ?? new Array<string>(d.n);
    parts[d.i] = d.s;
    link.parts.set(d.key, parts);
    if (parts.filter((x) => x !== undefined).length < d.n) return;
    link.parts.delete(d.key);
    const sdp = parts.join('');
    try {
      if (d.type === 'offer') {
        link.started = true;
        await link.pc.setRemoteDescription({ type: 'offer', sdp });
        const answer = await link.pc.createAnswer();
        await link.pc.setLocalDescription(answer);
        await gathered(link.pc);
        this.sendSdp(from, 'answer', link.pc.localDescription!.sdp);
      } else if (link.pc.signalingState === 'have-local-offer') {
        await link.pc.setRemoteDescription({ type: 'answer', sdp });
        link.started = true;
      }
    } catch (e) {
      console.warn('voice handshake failed', e);
      this.drop(from);
    }
  }

  /** Places the friend's voice at their head. */
  update(id: string, head: THREE.Vector3) {
    const a = this.links.get(id)?.audio;
    if (a) a.position.copy(head);
  }

  drop(id: string) {
    const l = this.links.get(id);
    if (!l) return;
    l.pc.close();
    if (l.audio) {
      l.audio.disconnect();
      this.scene.remove(l.audio);
    }
    if (l.el) l.el.srcObject = null;
    this.links.delete(id);
  }
}

function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(done, 2500);
  });
}
