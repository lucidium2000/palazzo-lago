import * as THREE from 'three';
import { HIGH, LOW, Voices } from './pianokeys';
import { freq, renderTone, TONE_RATE, zoneOf, zones } from './pianotone';

/**
 * The grand piano you can play: a polyphonic sampler over notes synthesized
 * at start-up (pianotone.ts, rendered in a worker, one every major third and
 * pitch-shifted in between). 24 voices with stealing (pianokeys.ts `Voices`);
 * each voice is a buffer source through a velocity low-pass (soft notes are
 * darker, loud ones brighter) and a gain that holds while the key is down,
 * then the damper stops the string (a short tail; the top keys have no
 * dampers and ring on). A sustain pedal holds released notes. The sound comes
 * from the piano's soundboard (a positional source) with a little room.
 */

interface Slot {
  filter: BiquadFilterNode;
  gain: GainNode;
  src: AudioBufferSourceNode | null;
}

export class PianoSynth {
  readonly voices: Voices;
  private slots: Slot[] = [];
  private buffers = new Map<number, AudioBuffer>();
  private pending = new Set<number>();
  private worker: Worker | null = null;
  private bus: GainNode | null = null;
  private out: THREE.PositionalAudio | null = null;
  private rel: number[] = [];
  /** Notes started (for tests and the stats). */
  stats = { notes: 0, stolen: 0, sources: 0 };
  /** Muted (the game's sound switch). */
  muted = () => false;

  constructor(
    private listener: THREE.AudioListener,
    /** Where the sound comes from (the soundboard). */
    private at: THREE.Object3D,
    private opts: { voices?: number; reverb?: number } = {},
  ) {
    this.voices = new Voices(opts.voices ?? 24);
  }

  private get ctx() {
    return this.listener.context;
  }

  /** Starts rendering the notes (in a worker when possible). Call early (walking up to the piano). */
  prepare() {
    if (this.worker || this.pending.size || this.buffers.size) return;
    const list = zones();
    // Middle of the keyboard first: that's where people play.
    list.sort((a, b) => Math.abs(a - 62) - Math.abs(b - 62));
    try {
      this.worker = new Worker(new URL('./pianoworker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ midi: number; buf: Float32Array }>) => this.store(e.data.midi, e.data.buf);
      this.worker.onerror = () => {
        this.worker = null;
        this.pending.clear();
      };
      for (const z of list) {
        this.pending.add(z);
        this.worker.postMessage({ midi: z, rate: TONE_RATE });
      }
    } catch {
      this.worker = null;
    }
  }

  private store(midi: number, data: Float32Array) {
    this.pending.delete(midi);
    const b = this.ctx.createBuffer(1, data.length, TONE_RATE);
    b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    this.buffers.set(midi, b);
  }

  /** The buffer for a note's zone: rendered, else the nearest rendered one, else rendered now. */
  private bufferFor(midi: number): [AudioBuffer, number] {
    const z = zoneOf(midi);
    let b = this.buffers.get(z);
    if (b) return [b, z];
    let best = -1,
      bd = Infinity;
    for (const k of this.buffers.keys())
      if (Math.abs(k - z) < bd && Math.abs(k - z) <= 8) {
        bd = Math.abs(k - z);
        best = k;
      }
    if (best >= 0) return [this.buffers.get(best)!, best];
    this.store(z, renderTone(z, TONE_RATE));
    b = this.buffers.get(z)!;
    return [b, z];
  }

  private ensureGraph() {
    if (this.bus) return;
    const ctx = this.ctx;
    const mix = ctx.createGain();
    mix.gain.value = 1;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.42;
    this.bus.connect(mix);
    // A little of the room: a short, soft, generated impulse response.
    const secs = this.opts.reverb ?? 1.3;
    if (secs > 0) {
      const ir = ctx.createBuffer(2, Math.ceil(secs * ctx.sampleRate), ctx.sampleRate);
      let seed = 3;
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        let y = 0;
        for (let i = 0; i < d.length; i++) {
          const t = i / ctx.sampleRate;
          seed = (seed * 16807) % 2147483647;
          y += 0.35 * ((seed / 2147483647) * 2 - 1 - y);
          d[i] = y * Math.exp(-t / (secs * 0.28)) * (t < 0.012 ? t / 0.012 : 1);
        }
      }
      const conv = ctx.createConvolver();
      conv.buffer = ir;
      const wet = ctx.createGain();
      wet.gain.value = 0.32;
      this.bus.connect(conv).connect(wet).connect(mix);
    }
    const out = new THREE.PositionalAudio(this.listener);
    out.setRefDistance(1.6);
    out.setRolloffFactor(1.1);
    out.setDistanceModel('inverse');
    out.setNodeSource(mix as unknown as AudioBufferSourceNode);
    this.at.add(out);
    this.out = out;
    for (let i = 0; i < this.voices.max; i++) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.5;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      filter.connect(gain).connect(this.bus);
      this.slots.push({ filter, gain, src: null });
    }
  }

  /** Strike a key (velocity 0..1). `delay`: seconds from now (a friend's batched notes keep their timing). */
  noteOn(midi: number, vel: number, delay = 0) {
    if (midi < LOW || midi > HIGH || this.muted()) return;
    const ctx = this.ctx;
    if (ctx.state !== 'running') return;
    this.ensureGraph();
    const now = ctx.currentTime + Math.max(0, delay);
    const i = this.voices.alloc(midi, now, vel);
    const s = this.slots[i];
    const g = s.gain.gain;
    let t = now;
    if (s.src) {
      // Stealing (or restriking the same string): a 6 ms fade, then the new note.
      this.stats.stolen++;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + 0.006);
      try {
        s.src.stop(now + 0.007);
      } catch {
        /* already stopped */
      }
      s.src.onended = null;
      t = now + 0.007;
    }
    const [buf, zone] = this.bufferFor(midi);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 2 ** ((midi - zone) / 12);
    src.connect(s.filter);
    const f0 = freq(midi);
    s.filter.frequency.setValueAtTime(Math.min(12000, f0 * 2 + 450 + 9000 * vel ** 1.6), t);
    // Loudness: ~24 dB from softest to hardest; the bass a touch fuller.
    const amp = (0.06 + 0.94 * vel ** 1.7) * (midi < 48 ? 1.12 : midi > 84 ? 0.85 : 1);
    g.cancelScheduledValues(t);
    g.setValueAtTime(amp, t);
    src.start(t);
    src.onended = () => {
      if (s.src !== src) return;
      s.src = null;
      this.voices.free(i);
    };
    s.src = src;
    this.stats.notes++;
    this.stats.sources++;
  }

  /** Let a key up: the damper stops the string (unless the pedal is down). */
  noteOff(midi: number, delay = 0) {
    if (!this.bus) return;
    const now = this.ctx.currentTime + Math.max(0, delay);
    for (const i of this.voices.keyUp(midi, now, this.rel)) this.damp(i, now);
  }

  /** Sustain pedal. */
  pedal(on: boolean, delay = 0) {
    const now = this.ctx.currentTime + Math.max(0, delay);
    for (const i of this.voices.pedal(on, now, this.rel)) this.damp(i, now);
  }

  private damp(i: number, now: number) {
    const s = this.slots[i];
    if (!s?.src) return;
    const note = this.voices.v[i].note;
    // The top keys have no dampers: they ring out. Bass dampers take a moment longer.
    const tau = note >= 89 ? 0.9 : note < 45 ? 0.16 : 0.09;
    const g = s.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.setTargetAtTime(0, now, tau);
    try {
      s.src.stop(now + tau * 7);
    } catch {
      /* already stopped */
    }
  }

  /** Every note off, now (leaving the piano). */
  allOff() {
    for (let i = 0; i < this.voices.max; i++) {
      const v = this.voices.v[i];
      if (v.note >= 0 && v.released < 0) {
        v.held = false;
        v.pedal = false;
        v.released = this.ctx.currentTime;
        this.damp(i, this.ctx.currentTime);
      }
    }
  }

  /** Notes rendered so far / in all. */
  get ready() {
    return this.buffers.size / zones().length;
  }

  get output() {
    return this.out;
  }
}
