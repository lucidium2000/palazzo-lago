import * as THREE from 'three';
import type { Sound } from './audio';
import { COUNTER, COUNTERS, inArcade, onPromenade } from './areas/promenadeplan';

/**
 * The Promenade's sound: a low crowd murmur over the concourse, the food
 * court's grills sizzling at each counter (and now and then a plate or a
 * utensil), and in the arcade a room of its own (a soft electronic hum,
 * distant bleeps) with the music ducked so the cabinets' chiptunes are clear.
 *
 * The casino's room tone (slots, crowd) stays downstairs, and its music
 * plays up here only as a quiet bed: main.ts multiplies its levels by
 * `ambienceMix` and `musicMix`.
 *
 * Every bed is synthesized here (seamless loops, rendered once the first
 * time you come up), so nothing is downloaded for it.
 */

/** Levels (0..1 gains). */
const MURMUR = 0.11;
const SIZZLE = 0.22;
const ARCADE_BED = 0.16;
/** How much of the casino's music stays as the Promenade's bed, and in the arcade on top of that. */
const MUSIC_HERE = 0.4;
const MUSIC_ARCADE = 0.12;

export class PromenadeSound {
  /** 0..1: you're on the Promenade (eased). */
  presence = 0;
  /** 0..1: you're in the arcade (eased). */
  arcade = 0;
  private murmur: THREE.Audio | null = null;
  private bed: THREE.Audio | null = null;
  private sizzles: THREE.PositionalAudio[] = [];
  private started = false;
  private clatterT = 3;

  constructor(
    private sound: Sound,
    private root: THREE.Object3D,
  ) {}

  /** The casino's music level multiplier for where you are. */
  get musicMix() {
    return 1 - this.presence * (1 - MUSIC_HERE) - this.arcade * (MUSIC_HERE - MUSIC_ARCADE);
  }

  /** The casino's room tone multiplier (none of it up here). */
  get ambienceMix() {
    return 1 - this.presence;
  }

  update(dt: number, feet: THREE.Vector3) {
    const here = onPromenade(feet.x) ? 1 : 0;
    const inArc = here && inArcade(feet.x, feet.z) ? 1 : 0;
    // Eased: about a second to come up out of the lift, a little less through the arcade's door.
    this.presence += (here - this.presence) * (1 - Math.exp(-dt * 2.5));
    this.arcade += (inArc - this.arcade) * (1 - Math.exp(-dt * 3));
    if (this.presence < 0.002 && !here) this.presence = 0;
    const ctx = this.sound.listener.context;
    if (!this.started) {
      if (!here || ctx.state !== 'running') return;
      this.start();
    }
    const p = this.presence;
    this.murmur?.setVolume(MURMUR * p * (1 - 0.7 * this.arcade));
    this.bed?.setVolume(ARCADE_BED * p * this.arcade);
    for (const s of this.sizzles) s.setVolume(SIZZLE * p);
    // Kitchen clatter: a plate set down, a spatula, a cup, now and then at a counter near you.
    if (here && !inArc) {
      this.clatterT -= dt;
      if (this.clatterT <= 0) {
        this.clatterT = 2 + Math.random() * 5;
        const c = COUNTERS[Math.floor(Math.random() * COUNTERS.length)];
        if (Math.abs(c.x - feet.x) < 12) {
          const at = new THREE.Vector3(c.x + (Math.random() - 0.5) * 3, 1.1, COUNTER.z - 0.6);
          const r = Math.random();
          if (r < 0.45) this.sound.play('clink', at, { volume: 0.08 + Math.random() * 0.05, rate: 0.8 + Math.random() * 0.6 });
          else if (r < 0.8) this.sound.play('click', at, { volume: 0.1, rate: 0.5 + Math.random() * 0.3 });
          else this.sound.play('thunk', at, { volume: 0.08, rate: 1.2 + Math.random() * 0.4 });
        }
      }
    }
  }

  private start() {
    this.started = true;
    const ctx = this.sound.listener.context;
    const sr = ctx.sampleRate;
    const loop = (data: Float32Array<ArrayBuffer>) => {
      const b = ctx.createBuffer(1, data.length, sr);
      b.copyToChannel(data, 0);
      return b;
    };
    const play = (a: THREE.Audio | THREE.PositionalAudio, buf: AudioBuffer) => {
      a.setBuffer(buf);
      a.setLoop(true);
      a.setVolume(0);
      a.offset = Math.random() * buf.duration * 0.9;
      a.play();
    };
    // Rendering ~40 s of audio takes a few tens of ms: spread over frames.
    setTimeout(() => {
      this.murmur = new THREE.Audio(this.sound.listener);
      play(this.murmur, loop(renderMurmur(sr, 14)));
    }, 0);
    setTimeout(() => {
      const buf = loop(renderSizzle(sr, 6));
      for (const c of COUNTERS) {
        const a = new THREE.PositionalAudio(this.sound.listener);
        a.setRefDistance(1.4);
        a.setRolloffFactor(1.6);
        a.setDistanceModel('inverse');
        const o = new THREE.Object3D();
        o.position.set(c.x, 1.15, COUNTER.z - 0.5);
        o.add(a);
        this.root.add(o);
        play(a, buf);
        this.sizzles.push(a);
      }
    }, 50);
    setTimeout(() => {
      this.bed = new THREE.Audio(this.sound.listener);
      play(this.bed, loop(renderArcadeBed(sr, 12)));
    }, 100);
  }
}

// ---------------------------------------------------------------------------
// Synthesis (pure: Float32Array out; seamless loops)
// ---------------------------------------------------------------------------

/** A tiny seeded random (-1..1). */
function noise(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
}

/** Renders `seconds` plus a tail, then folds the tail over the start so the loop has no seam. */
function seamless(sr: number, seconds: number, fill: (out: Float32Array) => void, peak: number): Float32Array<ArrayBuffer> {
  const n = Math.floor(sr * seconds);
  const f = Math.floor(sr * 0.5);
  const raw = new Float32Array(n + f);
  fill(raw);
  const out = raw.slice(0, n);
  for (let i = 0; i < f; i++) {
    const k = i / f;
    out[i] = out[i] * k + raw[n + i] * (1 - k);
  }
  let m = 1e-6;
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(out[i]));
  const g = peak / m;
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

/**
 * A crowd murmur: a dozen "voices", each a band of noise in the speech range
 * shaped into syllables (3–6 a second) and phrases with pauses, far enough
 * away that no words come through (a soft low-pass over all of it).
 */
export function renderMurmur(sr: number, seconds: number): Float32Array<ArrayBuffer> {
  return seamless(
    sr,
    seconds,
    (out) => {
      const r = noise(4242);
      const voices = 12;
      for (let v = 0; v < voices; v++) {
        // Each voice: its own centre (lower for men, higher for women) and pace.
        const centre = 180 + Math.abs(r()) * 420;
        const a1 = Math.exp((-2 * Math.PI * centre * 0.6) / sr);
        const a2 = Math.exp((-2 * Math.PI * centre * 2.2) / sr);
        let lp1 = 0,
          lp2 = 0,
          env = 0,
          target = 0;
        let syl = 0;
        let talking = Math.abs(r()) < 0.6;
        let phrase = Math.abs(r()) * sr * 3;
        const rate = 3 + Math.abs(r()) * 3;
        const gain = 0.6 + Math.abs(r()) * 0.6;
        for (let i = 0; i < out.length; i++) {
          if (--phrase <= 0) {
            talking = !talking;
            phrase = (talking ? 1.2 + Math.abs(r()) * 3 : 0.4 + Math.abs(r()) * 1.6) * sr;
          }
          if (--syl <= 0) {
            syl = (sr / rate) * (0.6 + Math.abs(r()) * 0.8);
            target = talking ? 0.3 + Math.abs(r()) * 0.7 : 0;
          }
          env += (target - env) * 0.0015;
          const x = r();
          lp1 = lp1 * a1 + x * (1 - a1);
          lp2 = lp2 * a2 + x * (1 - a2);
          out[i] += (lp2 - lp1) * env * gain;
        }
      }
      // Distance: a gentle low-pass over the whole crowd.
      const a = Math.exp((-2 * Math.PI * 1400) / sr);
      let y = 0;
      for (let i = 0; i < out.length; i++) out[i] = y = y * a + out[i] * (1 - a);
    },
    0.5,
  );
}

/** A grill: a soft high hiss and fat crackling in it. */
export function renderSizzle(sr: number, seconds: number): Float32Array<ArrayBuffer> {
  return seamless(
    sr,
    seconds,
    (out) => {
      const r = noise(777);
      const a = Math.exp((-2 * Math.PI * 2500) / sr);
      let lp = 0;
      for (let i = 0; i < out.length; i++) {
        const x = r();
        lp = lp * a + x * (1 - a);
        // The hiss breathes a little (a whole number of breaths per loop).
        const breathe = 0.75 + 0.25 * Math.sin((2 * Math.PI * 3 * i) / (sr * seconds));
        out[i] = (x - lp) * 0.25 * breathe;
      }
      // Crackles: short decaying pops (about 25 a second), some bigger.
      const pops = Math.floor(seconds * 25);
      for (let k = 0; k < pops; k++) {
        const at = Math.floor(Math.abs(r()) * (out.length - sr * 0.02));
        const big = Math.abs(r()) < 0.15 ? 2.5 : 1;
        const len = Math.floor(sr * (0.002 + Math.abs(r()) * 0.006) * big);
        const amp = (0.4 + Math.abs(r()) * 0.6) * big;
        for (let j = 0; j < len; j++) out[at + j] += r() * amp * Math.exp((-j / len) * 5);
      }
    },
    0.45,
  );
}

/**
 * The arcade's room: a low electronic hum (mains and fans), soft air, and
 * distant bleeps and arpeggios from machines around the room (sparse,
 * pentatonic, quiet: the cabinet you're at plays over them).
 */
export function renderArcadeBed(sr: number, seconds: number): Float32Array<ArrayBuffer> {
  return seamless(
    sr,
    seconds,
    (out) => {
      const r = noise(9001);
      const n = out.length;
      // Hum (60 Hz and its harmonics, slowly wavering) and fan air.
      const a = Math.exp((-2 * Math.PI * 500) / sr);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const w = 1 + 0.08 * Math.sin(t * 0.7);
        const hum = Math.sin(2 * Math.PI * 60 * t) * 0.5 + Math.sin(2 * Math.PI * 120 * t) * 0.3 * w + Math.sin(2 * Math.PI * 180 * t) * 0.12;
        lp = lp * a + r() * (1 - a);
        out[i] = hum * 0.22 + lp * 0.9;
      }
      // Bleeps: little square-ish blips and three-note runs, as from other machines across the room.
      const scale = [0, 3, 5, 7, 10, 12, 15];
      const events = Math.floor(seconds * 1.4);
      for (let k = 0; k < events; k++) {
        const at = Math.floor(Math.abs(r()) * (n - sr * 0.6));
        const base = 72 + Math.floor(Math.abs(r()) * 12);
        const notes = Math.abs(r()) < 0.35 ? 3 : 1;
        const len = Math.floor(sr * (0.05 + Math.abs(r()) * 0.07));
        const amp = 0.12 + Math.abs(r()) * 0.12;
        for (let q = 0; q < notes; q++) {
          const f = 440 * Math.pow(2, (base + scale[Math.floor(Math.abs(r()) * scale.length)] - 69) / 12);
          const s0 = at + q * len;
          for (let j = 0; j < len && s0 + j < n; j++) {
            const ph = (j * f) / sr;
            // Soft square: a sine with its third harmonic.
            const v = Math.sin(2 * Math.PI * ph) + Math.sin(6 * Math.PI * ph) / 3;
            const e = Math.min(1, j / (sr * 0.004)) * Math.exp((-j / len) * 3);
            out[s0 + j] += v * amp * e;
          }
        }
      }
      // Far off: a gentle low-pass over the bleeps too.
      const b = Math.exp((-2 * Math.PI * 3200) / sr);
      let y = 0;
      for (let i = 0; i < n; i++) out[i] = y = y * b + out[i] * (1 - b);
    },
    0.5,
  );
}
