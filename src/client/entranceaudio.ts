import * as THREE from 'three';
import type { Sound } from './audio';
import { onEntrance, BLVD } from './areas/entranceplan';
import type { SimCar, Traffic } from './areas/entrancetraffic';

/**
 * Out front, the night air: the city's low roar and the boulevard's traffic
 * (a bed), engines idling at the curb (positional, on the nearest waiting
 * cars), cars pulling in and away, now and then a distant horn, car doors
 * opening and thunking shut, the valets' whistle.
 *
 * Everything is synthesized here, quietly, the first time you step out (no
 * downloads). The casino's music and room tone don't carry out here: main.ts
 * multiplies their levels by `musicMix` and `ambienceMix`.
 */

const BED = 0.2;
const IDLE = 0.16;

type Pose = { x: number; z: number; yaw?: number };

export class EntranceSound {
  /** 0..1: you're out front (eased). */
  presence = 0;
  private started = false;
  private bed: THREE.Audio | null = null;
  private idles: { a: THREE.PositionalAudio; o: THREE.Object3D }[] = [];
  private shots: THREE.PositionalAudio[] = [];
  private buf: Partial<Record<'idle' | 'pass' | 'horn' | 'thunk' | 'latch' | 'whistle' | 'street', AudioBuffer>> = {};
  private follow: { car: SimCar; o: THREE.Object3D; until: number }[] = [];
  private hornT = 9;
  private clock = 0;
  private streetT = 2;

  constructor(
    private sound: Sound,
    private root: THREE.Object3D,
  ) {}

  /** The casino's music level multiplier (none of it out here). */
  get musicMix() {
    return 1 - this.presence;
  }

  /** The casino's room tone multiplier (none of it out here). */
  get ambienceMix() {
    return 1 - this.presence;
  }

  private get ctx() {
    return this.sound.listener.context;
  }

  update(dt: number, feet: THREE.Vector3, live: { traffic: Traffic; t: number } | null, t: number) {
    const here = onEntrance(feet.x) ? 1 : 0;
    this.presence += (here - this.presence) * (1 - Math.exp(-dt * 2.5));
    if (this.presence < 0.002 && !here) this.presence = 0;
    if (!this.started) {
      if (!here || this.ctx.state !== 'running') return;
      this.start();
    }
    // Indoors (the lobby) the street is muffled.
    const inside = feet.z < 0 ? 0.35 : 1;
    const p = this.presence;
    this.bed?.setVolume(BED * p * (0.55 + 0.45 * inside));
    if (!live) {
      for (const i of this.idles) i.a.setVolume(0);
      return;
    }
    const { traffic, t: now } = live;
    // Idling engines on the three nearest cars waiting at the curb.
    const waiting = traffic.here
      .filter((c) => !c.motion && c.home !== 'valet')
      .map((c) => ({ c, p: traffic.carPose(c, now) }))
      .sort((a, b) => Math.hypot(a.p.x - feet.x, a.p.z - feet.z) - Math.hypot(b.p.x - feet.x, b.p.z - feet.z));
    this.idles.forEach((i, k) => {
      const w = waiting[k];
      if (!w) return i.a.setVolume(0);
      i.o.position.set(w.p.x + Math.sin(w.p.yaw) * 1.8, 0.5, w.p.z + Math.cos(w.p.yaw) * 1.8);
      i.a.setVolume(IDLE * p * inside);
    });
    // Cars on the move carry their sound with them.
    for (const f of this.follow) {
      const q = traffic.carPose(f.car, now);
      f.o.position.set(q.x, 0.6, q.z);
    }
    this.clock = t;
    this.follow = this.follow.filter((f) => {
      if (t < f.until) return true;
      f.o.removeFromParent();
      return false;
    });
    if (!here) return;
    // A horn somewhere down the Strip, now and then; cars passing on the boulevard.
    this.hornT -= dt;
    if (this.hornT <= 0) {
      this.hornT = 14 + Math.random() * 26;
      const at = new THREE.Vector3(feet.x + (Math.random() - 0.5) * 160, 1, BLVD.z1 + 20 + Math.random() * 80);
      this.shot('horn', at, 0.35 * inside, 0.85 + Math.random() * 0.3, 18, 0.8);
    }
    this.streetT -= dt;
    if (this.streetT <= 0) {
      this.streetT = 2.5 + Math.random() * 5;
      const lane = [BLVD.west[1], BLVD.west[2], BLVD.east[0], BLVD.east[1], BLVD.east[2]][Math.floor(Math.random() * 5)];
      this.shot('street', new THREE.Vector3(feet.x + (Math.random() - 0.5) * 30, 0.6, lane), 0.3 * inside, 0.85 + Math.random() * 0.35, 6, 1.1);
    }
  }

  /** A car door: the latch opening, the thunk shutting. */
  door(kind: 'open' | 'close', at: Pose) {
    const yaw = at.yaw ?? -Math.PI / 2;
    // The curb-side rear door: right of the car's centre and behind it.
    const pos = new THREE.Vector3(at.x - 0.4 * Math.cos(yaw) - 0.55 * Math.sin(yaw), 0.9, at.z + 0.4 * Math.sin(yaw) - 0.55 * Math.cos(yaw));
    this.shot(kind === 'open' ? 'latch' : 'thunk', pos, kind === 'open' ? 0.35 : 0.6, 0.92 + Math.random() * 0.16, 2, 1.5);
  }

  /** The valet's whistle (two short blasts). */
  whistle(at: THREE.Vector3) {
    this.shot('whistle', at.clone().setY(1.6), 0.35, 0.96 + Math.random() * 0.08, 4, 1.2);
  }

  /** A car pulling in or away (the sound rides along with it for the clip's length). */
  passBy(car: SimCar, kind: 'arrive' | 'depart') {
    if (!this.started || this.presence < 0.05) return;
    const o = new THREE.Object3D();
    this.root.add(o);
    if (!this.shot('pass', o, 0.5, kind === 'arrive' ? 0.9 : 1.05, 5, 1.1)) return void o.removeFromParent();
    this.follow.push({ car, o, until: this.clock + 6 });
  }

  private shot(name: keyof EntranceSound['buf'], at: THREE.Vector3 | THREE.Object3D, volume: number, rate: number, ref: number, rolloff: number): THREE.PositionalAudio | null {
    const buf = this.buf[name];
    if (!buf || this.ctx.state !== 'running' || this.sound.muted) return null;
    let a = this.shots.find((s) => !s.isPlaying);
    if (!a) {
      if (this.shots.length >= 8) return null;
      a = new THREE.PositionalAudio(this.sound.listener);
      a.setDistanceModel('inverse');
      this.shots.push(a);
    }
    a.removeFromParent();
    if (at instanceof THREE.Object3D) {
      a.position.set(0, 0, 0);
      at.add(a);
    } else {
      a.position.copy(at);
      this.root.add(a);
    }
    a.setRefDistance(ref);
    a.setRolloffFactor(rolloff);
    a.setBuffer(buf);
    a.setLoop(false);
    a.setVolume(volume * this.presence);
    a.setPlaybackRate(rate);
    a.play();
    return a;
  }

  private start() {
    this.started = true;
    const sr = this.ctx.sampleRate;
    const mk = (d: Float32Array<ArrayBuffer>) => {
      const b = this.ctx.createBuffer(1, d.length, sr);
      b.copyToChannel(d, 0);
      return b;
    };
    // Spread the rendering over a few frames.
    setTimeout(() => {
      this.bed = new THREE.Audio(this.sound.listener);
      const b = mk(renderCityBed(sr, 12));
      this.bed.setBuffer(b);
      this.bed.setLoop(true);
      this.bed.setVolume(0);
      this.bed.offset = Math.random() * 10;
      this.bed.play();
    }, 0);
    setTimeout(() => {
      this.buf.idle = mk(renderIdle(sr, 2));
      for (let k = 0; k < 3; k++) {
        const o = new THREE.Object3D();
        this.root.add(o);
        const a = new THREE.PositionalAudio(this.sound.listener);
        a.setRefDistance(1.5);
        a.setRolloffFactor(1.6);
        a.setDistanceModel('inverse');
        a.setBuffer(this.buf.idle);
        a.setLoop(true);
        a.setVolume(0);
        a.setPlaybackRate(0.94 + k * 0.05);
        a.offset = k * 0.6;
        o.add(a);
        a.play();
        this.idles.push({ a, o });
      }
    }, 40);
    setTimeout(() => {
      this.buf.pass = mk(renderPass(sr, 4));
      this.buf.street = mk(renderPass(sr, 3, 0.6));
      this.buf.horn = mk(renderHorn(sr));
      this.buf.thunk = mk(renderThunk(sr));
      this.buf.latch = mk(renderLatch(sr));
      this.buf.whistle = mk(renderWhistle(sr));
    }, 80);
  }
}

// ---------------------------------------------------------------------------
// Synthesis (pure: Float32Array out)
// ---------------------------------------------------------------------------

function noise(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
}

/** Renders `seconds` plus a tail, folds the tail over the start (a seamless loop), normalised to `peak`. */
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
  return normalise(out, peak);
}

function normalise<T extends Float32Array>(out: T, peak: number): T {
  let m = 1e-6;
  for (let i = 0; i < out.length; i++) m = Math.max(m, Math.abs(out[i]));
  const g = peak / m;
  for (let i = 0; i < out.length; i++) out[i] *= g;
  return out;
}

/** The city at night: a low roar (brown noise), traffic swelling and fading, a far-off hum of voices. */
export function renderCityBed(sr: number, seconds: number): Float32Array<ArrayBuffer> {
  return seamless(
    sr,
    seconds,
    (out) => {
      const r = noise(9091);
      let brown = 0,
        lp = 0,
        bp1 = 0,
        bp2 = 0;
      const aLp = Math.exp((-2 * Math.PI * 180) / sr);
      const a1 = Math.exp((-2 * Math.PI * 300) / sr),
        a2 = Math.exp((-2 * Math.PI * 1400) / sr);
      // Swells: a few cars going by on the boulevard, each a slow rise and fall.
      const swells: [number, number, number][] = [];
      for (let k = 0; k < 9; k++) swells.push([Math.abs(r()) * out.length, (1.5 + Math.abs(r()) * 2.5) * sr, 0.4 + Math.abs(r()) * 0.6]);
      for (let i = 0; i < out.length; i++) {
        const x = r();
        brown = (brown + x * 0.02) * 0.998;
        lp = lp * aLp + brown * (1 - aLp);
        bp1 = bp1 * a1 + x * (1 - a1);
        bp2 = bp2 * a2 + x * (1 - a2);
        let sw = 0;
        for (const [c, w, g] of swells) {
          const d = (i - c) / w;
          if (Math.abs(d) < 1) sw += g * (1 + Math.cos(Math.PI * d)) * 0.5;
        }
        out[i] = lp * 3.2 + (bp2 - bp1) * (0.04 + sw * 0.16);
      }
    },
    0.5,
  );
}

/** An engine idling: a low firing pulse (about 13 Hz at 800 rpm, four cylinders) with a little roughness. */
export function renderIdle(sr: number, seconds: number): Float32Array<ArrayBuffer> {
  return seamless(
    sr,
    seconds,
    (out) => {
      const r = noise(123);
      // Whole cycles of the loop so it repeats cleanly.
      const f0 = Math.round(26.5 * seconds) / seconds;
      let ph = 0,
        lp = 0;
      const a = Math.exp((-2 * Math.PI * 240) / sr);
      for (let i = 0; i < out.length; i++) {
        ph += f0 / sr;
        const pulse = Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * ph), 6);
        const x = pulse * (0.8 + 0.2 * r()) + r() * 0.08;
        lp = lp * a + x * (1 - a);
        out[i] = lp + 0.25 * Math.sin(2 * Math.PI * ph * 0.5) * 0.2;
      }
    },
    0.5,
  );
}

/** A car going by: tyre roar and engine rising and falling, the pitch dropping as it passes. */
export function renderPass(sr: number, seconds: number, bright = 1): Float32Array<ArrayBuffer> {
  const n = Math.floor(sr * seconds);
  const out = new Float32Array(n);
  const r = noise(555 + Math.round(bright * 10));
  let lp = 0,
    lp2 = 0,
    ph = 0;
  for (let i = 0; i < n; i++) {
    const k = i / n;
    const env = Math.exp(-Math.pow((k - 0.45) / 0.22, 2));
    const cut = 300 + 1600 * env * bright;
    const a = Math.exp((-2 * Math.PI * cut) / sr);
    const x = r();
    lp = lp * a + x * (1 - a);
    lp2 = lp2 * 0.995 + lp * 0.005;
    const f = 70 * (k < 0.45 ? 1.08 : 0.92);
    ph += f / sr;
    out[i] = env * ((lp - lp2) * 1.4 + 0.25 * Math.sin(2 * Math.PI * ph) * (0.6 + 0.4 * Math.sin(2 * Math.PI * ph * 0.5)));
  }
  return normalise(out, 0.6);
}

/** A distant car horn: two detuned buzzy tones, a short and a longer blast, softened by distance. */
export function renderHorn(sr: number): Float32Array<ArrayBuffer> {
  const n = Math.floor(sr * 1.3);
  const out = new Float32Array(n);
  let lp = 0;
  const a = Math.exp((-2 * Math.PI * 900) / sr);
  const blasts: [number, number][] = [
    [0.0, 0.22],
    [0.34, 0.95],
  ];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let g = 0;
    for (const [t0, t1] of blasts) if (t >= t0 && t < t1) g = Math.min(1, (t - t0) * 60, (t1 - t) * 40);
    const sq = (f: number) => (Math.sin(2 * Math.PI * f * t) > 0 ? 1 : -1);
    const x = g * (sq(415) * 0.5 + sq(500) * 0.5);
    lp = lp * a + x * (1 - a);
    out[i] = lp;
  }
  return normalise(out, 0.5);
}

/** A car door shutting: a low thud and a metallic click. */
export function renderThunk(sr: number): Float32Array<ArrayBuffer> {
  const n = Math.floor(sr * 0.45);
  const out = new Float32Array(n);
  const r = noise(77);
  let lp = 0;
  const a = Math.exp((-2 * Math.PI * 160) / sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const body = Math.sin(2 * Math.PI * 62 * t) * Math.exp(-t * 22);
    lp = lp * a + r() * (1 - a);
    const click = t > 0.004 && t < 0.03 ? r() * Math.exp(-(t - 0.004) * 260) * 0.5 : 0;
    out[i] = body + lp * 3 * Math.exp(-t * 30) + click;
  }
  return normalise(out, 0.8);
}

/** A door latch opening (a small double click). */
export function renderLatch(sr: number): Float32Array<ArrayBuffer> {
  const n = Math.floor(sr * 0.22);
  const out = new Float32Array(n);
  const r = noise(31);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    for (const t0 of [0.0, 0.07]) if (t > t0) out[i] += r() * Math.exp(-(t - t0) * 300) * (t0 ? 0.6 : 1) + Math.sin(2 * Math.PI * 1800 * t) * Math.exp(-(t - t0) * 120) * 0.2;
  }
  return normalise(out, 0.6);
}

/** The valet's whistle: two short shrill blasts with a pea's warble. */
export function renderWhistle(sr: number): Float32Array<ArrayBuffer> {
  const n = Math.floor(sr * 0.75);
  const out = new Float32Array(n);
  const r = noise(5);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let g = 0;
    for (const [t0, t1] of [
      [0.0, 0.16],
      [0.26, 0.62],
    ])
      if (t >= t0 && t < t1) g = Math.min(1, (t - t0) * 80, (t1 - t) * 50);
    const f = 2900 + 140 * Math.sin(2 * Math.PI * 34 * t);
    ph += f / sr;
    out[i] = g * (Math.sin(2 * Math.PI * ph) * 0.85 + r() * 0.08);
  }
  return normalise(out, 0.5);
}
