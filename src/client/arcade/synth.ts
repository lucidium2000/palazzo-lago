import * as THREE from 'three';
import type { SfxName, Song } from './types';
import { hz } from './music';

/**
 * The arcade's sound chip: every effect and every tune is synthesized here
 * with WebAudio oscillators and a noise buffer (nothing recorded). Each
 * cabinet (and floor game) gets a CabinetSound that plays from its own spot
 * in the room through a panner, so the shooter's lasers come from the
 * shooter. Music only plays while someone's playing (or a friend's game is
 * mirrored); idle machines are silent.
 */

export interface ArcadeListener {
  listener: THREE.AudioListener;
}

/** Shared bits: the context, a white-noise buffer, a 25% pulse wave. */
export class ArcadeAudio {
  private noiseBuf: AudioBuffer | null = null;
  private pulseWave: PeriodicWave | null = null;
  muted = false;

  constructor(readonly listener: THREE.AudioListener) {}

  get ctx(): AudioContext | null {
    const c = this.listener.context;
    return c.state === 'running' && !this.muted ? c : null;
  }

  noise(c: AudioContext): AudioBuffer {
    if (!this.noiseBuf) {
      const len = c.sampleRate;
      this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      let s = 1;
      for (let i = 0; i < len; i++) {
        s = (s * 16807) % 2147483647;
        d[i] = (s / 2147483647) * 2 - 1;
      }
    }
    return this.noiseBuf;
  }

  pulse(c: AudioContext): PeriodicWave {
    if (!this.pulseWave) {
      // A 25% duty pulse from its Fourier series: the classic thin chip lead.
      const n = 32,
        re = new Float32Array(n),
        im = new Float32Array(n);
      for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * 0.25);
      this.pulseWave = c.createPeriodicWave(re, im);
    }
    return this.pulseWave;
  }
}

type Wave = 'square' | 'pulse' | 'triangle' | 'sawtooth' | 'sine';

/** Live voices across every cabinet (a hard cap keeps a busy arcade cheap). */
let voices = 0;
const MAX_VOICES = 48;

export class CabinetSound {
  private pa: THREE.PositionalAudio | null = null;
  private bus: GainNode | null = null;
  /** Music scheduling: the next 16th to schedule (song steps), and the song it belongs to. */
  private nextStep = 0;
  private song: Song | null = null;
  private level = 1;

  constructor(
    private audio: ArcadeAudio,
    private anchor: THREE.Object3D,
    private opts: { ref?: number; rolloff?: number; volume?: number } = {},
  ) {}

  private out(c: AudioContext): GainNode {
    if (!this.bus) {
      const pa = new THREE.PositionalAudio(this.audio.listener);
      pa.panner.panningModel = 'equalpower';
      pa.setDistanceModel('inverse');
      pa.setRefDistance(this.opts.ref ?? 1.3);
      pa.setRolloffFactor(this.opts.rolloff ?? 1.5);
      pa.setMaxDistance(30);
      this.anchor.add(pa);
      this.pa = pa;
      this.bus = c.createGain();
      this.bus.gain.value = this.opts.volume ?? 0.32;
      this.bus.connect(pa.getOutput());
    }
    return this.bus;
  }

  /** Overall loudness (0..1): quieter for attract jingles, full while playing. */
  setLevel(v: number) {
    this.level = v;
    if (this.bus) this.bus.gain.value = (this.opts.volume ?? 0.32) * v;
  }

  // --- Building blocks --------------------------------------------------------

  private osc(c: AudioContext, wave: Wave): OscillatorNode {
    const o = c.createOscillator();
    if (wave === 'pulse') o.setPeriodicWave(this.audio.pulse(c));
    else o.type = wave;
    return o;
  }

  /** A note with a pitch glide and a quick envelope. */
  tone(c: AudioContext, t: number, f0: number, f1: number, dur: number, wave: Wave, vol: number, dest?: AudioNode) {
    // Silent (a puck barely touching a rail): nothing to play, and an exponential ramp to 0 throws.
    if (voices >= MAX_VOICES || !(vol > 0.0002) || !(f0 > 0)) return;
    const o = this.osc(c, wave);
    const g = c.createGain();
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.setValueAtTime(vol, t + Math.max(0.007, dur * 0.4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? this.out(c));
    o.start(t);
    o.stop(t + dur + 0.02);
    voices++;
    o.onended = () => {
      voices--;
      g.disconnect();
    };
  }

  /** Filtered noise (drums, explosions, swishes). */
  hiss(c: AudioContext, t: number, dur: number, type: BiquadFilterType, f0: number, f1: number, vol: number) {
    if (voices >= MAX_VOICES || !(vol > 0.0002)) return;
    const s = c.createBufferSource();
    s.buffer = this.audio.noise(c);
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.out(c));
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
    voices++;
    s.onended = () => {
      voices--;
      g.disconnect();
    };
  }

  private arp(c: AudioContext, t: number, freqs: number[], step: number, wave: Wave, vol: number) {
    for (let i = 0; i < freqs.length; i++) this.tone(c, t + i * step, freqs[i], freqs[i], step * 1.2, wave, vol);
  }

  // --- Effects ------------------------------------------------------------------

  sfx(name: SfxName, vol = 1, pitch = 1) {
    const c = this.audio.ctx;
    if (!c) return;
    const t = c.currentTime + 0.005;
    const p = pitch;
    const v = vol;
    switch (name) {
      case 'coin':
        this.tone(c, t, 988, 988, 0.07, 'square', 0.25 * v);
        this.tone(c, t + 0.07, 1319, 1319, 0.25, 'square', 0.25 * v);
        break;
      case 'start':
        this.arp(c, t, [523, 659, 784, 1047, 1319], 0.06, 'pulse', 0.25 * v);
        break;
      case 'shoot':
        this.tone(c, t, 1400 * p, 300 * p, 0.09, 'square', 0.12 * v);
        break;
      case 'zap':
        this.tone(c, t, 1200 * p, 180 * p, 0.2, 'sawtooth', 0.14 * v);
        break;
      case 'boom':
        this.hiss(c, t, 0.35, 'lowpass', 2400 * p, 200, 0.5 * v);
        this.tone(c, t, 140 * p, 50, 0.25, 'square', 0.12 * v);
        break;
      case 'bigboom':
        this.hiss(c, t, 1.1, 'lowpass', 1800 * p, 80, 0.7 * v);
        this.tone(c, t, 90, 30, 0.9, 'sine', 0.5 * v);
        break;
      case 'hit':
        this.tone(c, t, 520 * p, 380 * p, 0.06, 'square', 0.14 * v);
        break;
      case 'hurt':
        this.tone(c, t, 420, 50, 0.55, 'sawtooth', 0.22 * v);
        this.hiss(c, t, 0.4, 'lowpass', 1200, 100, 0.3 * v);
        break;
      case 'pickup':
        this.tone(c, t, 784 * p, 784 * p, 0.06, 'square', 0.18 * v);
        this.tone(c, t + 0.06, 1568 * p, 1568 * p, 0.12, 'square', 0.18 * v);
        break;
      case 'bounce':
        this.tone(c, t, 620 * p, 560 * p, 0.07, 'triangle', 0.3 * v);
        break;
      case 'brick':
        this.tone(c, t, 880 * p, 660 * p, 0.08, 'square', 0.15 * v);
        this.hiss(c, t, 0.05, 'highpass', 4000, 4000, 0.15 * v);
        break;
      case 'flip':
        this.hiss(c, t, 0.05, 'highpass', 5000, 3000, 0.25 * v);
        this.tone(c, t, 1200, 1500, 0.05, 'triangle', 0.18 * v);
        break;
      case 'power':
        this.arp(c, t, [523, 659, 784, 1047], 0.055, 'pulse', 0.22 * v);
        break;
      case 'move':
        this.tone(c, t, 240, 220, 0.03, 'triangle', 0.2 * v);
        break;
      case 'rotate':
        this.tone(c, t, 440 * p, 520 * p, 0.04, 'triangle', 0.22 * v);
        break;
      case 'land':
        this.tone(c, t, 160, 90, 0.08, 'sine', 0.35 * v);
        break;
      case 'clear':
        this.arp(c, t, [1047 * p, 1319 * p, 1568 * p, 2093 * p], 0.04, 'triangle', 0.2 * v);
        break;
      case 'chain':
        this.arp(c, t, [784 * p, 988 * p, 1175 * p, 1568 * p, 1976 * p], 0.035, 'pulse', 0.2 * v);
        break;
      case 'rise':
        this.tone(c, t, 70, 150, 0.45, 'sawtooth', 0.2 * v);
        break;
      case 'kick':
        this.tone(c, t, 150, 45, 0.14, 'sine', 0.6 * v);
        break;
      case 'snare':
        this.hiss(c, t, 0.12, 'bandpass', 1900, 1500, 0.4 * v);
        this.tone(c, t, 200, 160, 0.06, 'triangle', 0.2 * v);
        break;
      case 'hat':
        this.hiss(c, t, 0.035, 'highpass', 7500, 7500, 0.2 * v);
        break;
      case 'perfect':
        this.tone(c, t, 1568 * p, 1568 * p, 0.06, 'triangle', 0.2 * v);
        this.tone(c, t + 0.04, 2093 * p, 2093 * p, 0.09, 'triangle', 0.16 * v);
        break;
      case 'miss':
        this.tone(c, t, 170, 110, 0.16, 'square', 0.1 * v);
        break;
      case 'engine':
        this.tone(c, t, 70 * p, 90 * p, 0.2, 'sawtooth', 0.1 * v);
        break;
      case 'crash':
        this.hiss(c, t, 0.6, 'lowpass', 3000, 150, 0.6 * v);
        this.tone(c, t, 110, 40, 0.4, 'square', 0.2 * v);
        break;
      case 'whoosh':
        this.hiss(c, t, 0.32, 'bandpass', 600, 3200, 0.4 * v);
        break;
      case 'tick':
        this.tone(c, t, 1300 * p, 1300 * p, 0.018, 'square', 0.08 * v);
        break;
      case 'select':
        this.tone(c, t, 660 * p, 660 * p, 0.05, 'square', 0.15 * v);
        break;
      case 'over':
        this.arp(c, t, [523, 494, 440, 392, 330, 262], 0.12, 'sawtooth', 0.16 * v);
        break;
      case 'fanfare':
        this.arp(c, t, [523, 659, 784, 659, 784, 1047], 0.08, 'pulse', 0.2 * v);
        break;
      case 'splash':
        this.hiss(c, t, 0.4, 'bandpass', 1400, 500, 0.5 * v);
        this.tone(c, t, 900, 1800, 0.08, 'triangle', 0.15 * v);
        break;
      case 'swish':
        this.hiss(c, t, 0.28, 'highpass', 2500, 6000, 0.35 * v);
        break;
      case 'buzzer':
        this.tone(c, t, 110, 108, 0.7, 'square', 0.25 * v);
        this.tone(c, t, 165, 163, 0.7, 'square', 0.12 * v);
        break;
      case 'clunk':
        this.tone(c, t, 110 * p, 80 * p, 0.09, 'square', 0.25 * v);
        this.hiss(c, t, 0.08, 'lowpass', 900, 300, 0.25 * v);
        break;
    }
  }

  // --- Music ----------------------------------------------------------------------

  /**
   * Keeps the song going: called every frame with where the game says we are
   * (in beats). Schedules the 16ths in the next ~120 ms. Null stops it.
   */
  music(m: { song: Song; beat: number } | null) {
    const c = this.audio.ctx;
    if (!m || !c) {
      this.song = null;
      return;
    }
    const { song, beat } = m;
    const spb = 60 / song.bpm;
    // A new song, or the beat jumped (resync): start from the next 16th.
    if (song !== this.song || Math.abs(this.nextStep / 4 - beat) > 1) {
      this.song = song;
      this.nextStep = Math.max(0, Math.ceil(beat * 4));
    }
    const ahead = 0.12 / spb;
    let guard = 0;
    while (this.nextStep / 4 < beat + ahead && guard++ < 8) {
      const step = this.nextStep++;
      if (step < 0) continue;
      const t = c.currentTime + Math.max(0, (step / 4 - beat) * spb) + 0.03;
      this.playStep(c, song, step, t, spb / 4);
    }
  }

  private playStep(c: AudioContext, song: Song, step: number, t: number, sd: number) {
    const bar = Math.floor(step / 16);
    const pat = song.patterns[song.order[bar % song.order.length]];
    const i = step % 16;
    const g = song.gain ?? 0.8;
    const len = (arr: number[]) => {
      let n = 1;
      while (i + n < arr.length && arr[i + n] === -1) n++;
      return n;
    };
    const lead = pat.lead[i];
    if (lead > 0) this.tone(c, t, hz(lead), hz(lead), sd * len(pat.lead) * 0.92, song.leadWave, 0.1 * g);
    const bass = pat.bass[i];
    if (bass > 0) this.tone(c, t, hz(bass), hz(bass), sd * len(pat.bass) * 0.85, song.bassWave, 0.16 * g);
    const arp = pat.arp?.[i] ?? 0;
    if (arp > 0) this.tone(c, t, hz(arp), hz(arp), sd * 0.7, 'square', 0.04 * g);
    switch (pat.drums[i]) {
      case 'k':
        this.tone(c, t, 150, 45, 0.13, 'sine', 0.45 * g);
        break;
      case 's':
        this.hiss(c, t, 0.11, 'bandpass', 1900, 1500, 0.28 * g);
        break;
      case 'h':
        this.hiss(c, t, 0.03, 'highpass', 8000, 8000, 0.12 * g);
        break;
      case 'o':
        this.hiss(c, t, 0.16, 'highpass', 7000, 7000, 0.12 * g);
        break;
    }
  }

  dispose() {
    this.pa?.removeFromParent();
    this.bus?.disconnect();
  }

  get volume() {
    return this.level;
  }
}
