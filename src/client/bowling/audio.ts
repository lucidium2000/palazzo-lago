import * as THREE from 'three';
import type { Sound } from '../audio';

/**
 * The alley's sound, synthesized here the first time you come down (no
 * downloads): the ball's rolling rumble (positional, its pitch rising with
 * speed and bending as it rolls away, Doppler-ish), the crack of the ball
 * into the pins and the wooden clatter of pins on pins and on the deck, the
 * gutter's hollow thunk, the ball return's clunk, the foul buzzer, and a low
 * bed of the other lanes' distant rumble. The casino's walla and its lounge
 * music carry on underneath, quieter (main.ts multiplies them by the mixes).
 */

type Buf = 'roll' | 'crack' | 'tock' | 'clatter' | 'thunk' | 'clunk' | 'buzz' | 'bed' | 'whoosh';

const SR = 44100;

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
}

/** A buffer from a per-sample function. */
function make(ctx: BaseAudioContext, secs: number, fn: (t: number, i: number) => number): AudioBuffer {
  const n = Math.floor(secs * SR);
  const b = ctx.createBuffer(1, n, SR);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = fn(i / SR, i);
  // Normalise to a safe peak.
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) for (let i = 0; i < n; i++) d[i] *= 0.9 / peak;
  return b;
}

/** One-pole low-passed noise (a rumble). */
function brown(seed: number) {
  const r = rng(seed);
  let y = 0;
  return (k: number) => (y += (r() - y) * k);
}

/** The rolling rumble: a seamless 2 s loop of low noise and the boards' thrum. */
export function renderRoll(ctx: BaseAudioContext): AudioBuffer {
  const len = 2;
  const lo = brown(3),
    mid = brown(9);
  const b = make(ctx, len, (t) => {
    const thrum = Math.sin(2 * Math.PI * 52 * t) * 0.35 + Math.sin(2 * Math.PI * 78 * t) * 0.18;
    // Board joints ticking past (about 30 a second at speed: the loop's rate scales them).
    const tick = Math.exp(-((t * 30) % 1) * 18) * 0.25;
    return lo(0.02) * 2.4 + mid(0.12) * 0.5 * (0.6 + tick) + thrum * 0.5;
  });
  // Crossfade the ends so it loops without a click.
  const d = b.getChannelData(0);
  const f = Math.floor(0.08 * SR);
  for (let i = 0; i < f; i++) {
    const k = i / f;
    d[i] = d[i] * k + d[d.length - f + i] * (1 - k);
  }
  return b;
}

/** The ball into the pins: a sharp wooden crack with a body. */
export function renderCrack(ctx: BaseAudioContext): AudioBuffer {
  const r = rng(21);
  return make(ctx, 0.5, (t) => {
    const click = r() * Math.exp(-t * 90);
    const body = (Math.sin(2 * Math.PI * 420 * t) * 0.6 + Math.sin(2 * Math.PI * 910 * t) * 0.4 + Math.sin(2 * Math.PI * 1730 * t) * 0.25) * Math.exp(-t * 22);
    const low = Math.sin(2 * Math.PI * 120 * t) * Math.exp(-t * 14) * 0.6;
    return click * 1.4 + body + low;
  });
}

/** A single pin knocking another (hollow maple). */
export function renderTock(ctx: BaseAudioContext): AudioBuffer {
  const r = rng(5);
  return make(ctx, 0.22, (t) => {
    const env = Math.exp(-t * 38);
    return (Math.sin(2 * Math.PI * 760 * t) * 0.5 + Math.sin(2 * Math.PI * 1480 * t) * 0.35 + Math.sin(2 * Math.PI * 2410 * t) * 0.2) * env + r() * Math.exp(-t * 160) * 0.5;
  });
}

/** Pins tumbling (a scatter of tocks over a second). */
export function renderClatter(ctx: BaseAudioContext): AudioBuffer {
  const r = rng(77);
  const hits: [number, number, number][] = [];
  for (let k = 0; k < 26; k++) hits.push([Math.abs(r()) ** 1.6 * 1.1, 600 + Math.abs(r()) * 900, 0.3 + Math.abs(r()) * 0.7]);
  const n2 = rng(8);
  return make(ctx, 1.4, (t) => {
    let s = 0;
    for (const [at, f, a] of hits) {
      const u = t - at;
      if (u < 0 || u > 0.15) continue;
      const e = Math.exp(-u * 45) * a;
      s += (Math.sin(2 * Math.PI * f * u) + 0.5 * Math.sin(2 * Math.PI * f * 1.93 * u)) * e;
    }
    return s + n2() * Math.exp(-t * 6) * 0.08;
  });
}

/** The ball dropping into the gutter (or onto the boards): a hollow thunk. */
export function renderThunk(ctx: BaseAudioContext): AudioBuffer {
  const r = rng(13);
  return make(ctx, 0.45, (t) => {
    const f = 95 - 40 * t;
    return Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 11) + r() * Math.exp(-t * 70) * 0.5 + Math.sin(2 * Math.PI * 240 * t) * Math.exp(-t * 30) * 0.3;
  });
}

/** The ball return: a ball knocking the others on the rack (a hard clack and a ring). */
export function renderClunk(ctx: BaseAudioContext): AudioBuffer {
  const r = rng(31);
  return make(ctx, 0.6, (t) => {
    const clack = (Math.sin(2 * Math.PI * 1250 * t) * 0.5 + Math.sin(2 * Math.PI * 2650 * t) * 0.3) * Math.exp(-t * 55);
    const ring = Math.sin(2 * Math.PI * 330 * t) * Math.exp(-t * 9) * 0.35;
    const thud = Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t * 18) * 0.6;
    return clack + ring + thud + r() * Math.exp(-t * 120) * 0.4;
  });
}

/** The foul buzzer. */
export function renderBuzz(ctx: BaseAudioContext): AudioBuffer {
  return make(ctx, 0.7, (t) => {
    const env = Math.min(1, t * 60) * Math.min(1, (0.7 - t) * 30);
    const sq = Math.sign(Math.sin(2 * Math.PI * 196 * t)) * 0.5 + Math.sign(Math.sin(2 * Math.PI * 233 * t)) * 0.3;
    return sq * env * 0.6;
  });
}

/** The room's bed: far lanes rumbling, now and then a far-off strike (a 6 s loop). */
export function renderBed(ctx: BaseAudioContext): AudioBuffer {
  const lo = brown(41);
  const r = rng(99);
  const crashes = [1.1, 3.9, 5.2].map((at) => ({ at, f: 500 + Math.abs(r()) * 300 }));
  const b = make(ctx, 6, (t) => {
    let s = lo(0.015) * 1.6;
    for (const c of crashes) {
      const u = t - c.at;
      if (u > 0 && u < 0.8) s += (Math.sin(2 * Math.PI * c.f * u) * 0.12 + r() * 0.1) * Math.exp(-u * 7);
    }
    return s;
  });
  const d = b.getChannelData(0);
  const f = Math.floor(0.2 * SR);
  for (let i = 0; i < f; i++) {
    const k = i / f;
    d[i] = d[i] * k + d[d.length - f + i] * (1 - k);
  }
  return b;
}

/** A swish (the arm's swing, the pinsetter's sweep). */
export function renderWhoosh(ctx: BaseAudioContext): AudioBuffer {
  const r = rng(55);
  let y = 0;
  return make(ctx, 0.6, (t) => {
    y += (r() - y) * (0.05 + 0.25 * Math.sin(Math.PI * Math.min(1, t / 0.6)));
    return y * Math.sin(Math.PI * Math.min(1, t / 0.6));
  });
}

export class BowlSound {
  /** 0..1: you're down at the lanes (eased). */
  presence = 0;
  private started = false;
  private buf: Partial<Record<Buf, AudioBuffer>> = {};
  private shots: THREE.PositionalAudio[] = [];
  private rolls: { a: THREE.PositionalAudio; o: THREE.Object3D; key: number; last: number }[] = [];
  private bed: THREE.Audio | null = null;
  private listenerPos = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private clock = 0;

  constructor(
    private sound: Sound,
    private root: THREE.Object3D,
  ) {}

  /** The casino's music under the lounge (quiet here). */
  get musicMix() {
    return 1 - 0.55 * this.presence;
  }

  /** The casino's walla (the alley has its own crowd and rumble). */
  get ambienceMix() {
    return 1 - 0.5 * this.presence;
  }

  private get ctx() {
    return this.sound.listener.context;
  }

  update(dt: number, here: boolean) {
    this.clock += dt;
    this.presence += ((here ? 1 : 0) - this.presence) * (1 - Math.exp(-dt * 2.5));
    if (this.presence < 0.002 && !here) this.presence = 0;
    if (!this.started) {
      if (!here || this.ctx.state !== 'running') return;
      this.start();
    }
    this.bed?.setVolume(0.12 * this.presence);
    this.sound.listener.getWorldPosition(this.listenerPos);
    // Loops nobody fed this frame fall silent.
    for (const r of this.rolls) if (r.key >= 0 && this.clock - r.last > 0.15) {
      r.a.setVolume(0);
      r.key = -1;
    }
  }

  private start() {
    this.started = true;
    const c = this.ctx;
    this.buf = { roll: renderRoll(c), crack: renderCrack(c), tock: renderTock(c), clatter: renderClatter(c), thunk: renderThunk(c), clunk: renderClunk(c), buzz: renderBuzz(c), bed: renderBed(c), whoosh: renderWhoosh(c) };
    const bed = new THREE.Audio(this.sound.listener);
    bed.setBuffer(this.buf.bed!);
    bed.setLoop(true);
    bed.setVolume(0);
    bed.play();
    this.bed = bed;
    for (let i = 0; i < 3; i++) {
      const o = new THREE.Object3D();
      this.root.add(o);
      const a = new THREE.PositionalAudio(this.sound.listener);
      a.setRefDistance(2.2);
      a.setRolloffFactor(1.1);
      a.setBuffer(this.buf.roll!);
      a.setLoop(true);
      a.setVolume(0);
      o.add(a);
      a.play();
      this.rolls.push({ a, o, key: -1, last: 0 });
    }
  }

  /**
   * A rolling ball (`key` tells balls apart): where it is, how fast, its velocity
   * (world) for the pitch bend as it rolls toward or away from you.
   */
  roll(key: number, at: THREE.Vector3, vel: THREE.Vector3, gutter: boolean) {
    if (!this.started || this.sound.muted) return;
    let r = this.rolls.find((x) => x.key === key) ?? this.rolls.find((x) => x.key < 0);
    if (!r) return;
    r.key = key;
    r.last = this.clock;
    r.o.position.copy(at);
    const speed = vel.length();
    // Doppler-ish: the closing speed toward the listener, exaggerated a little (sound is slow next to a ball? no: but it reads).
    const to = this.tmp.copy(this.listenerPos).sub(at);
    const d = to.length() || 1;
    const closing = vel.dot(to) / d;
    const bend = THREE.MathUtils.clamp(1 + closing / 60, 0.85, 1.15);
    r.a.setPlaybackRate((0.62 + speed * 0.055) * bend * (gutter ? 1.25 : 1));
    r.a.setVolume(Math.min(1, speed / 6) * 0.9 * (gutter ? 0.7 : 1) * Math.max(0.3, this.presence));
  }

  /** A one-shot. */
  shot(name: Buf, at: THREE.Vector3, volume: number, rate = 1, ref = 2, rolloff = 1.2) {
    const buf = this.buf[name];
    if (!buf || !this.started || this.ctx.state !== 'running' || this.sound.muted) return;
    let a = this.shots.find((s) => !s.isPlaying);
    if (!a) {
      if (this.shots.length >= 10) return;
      a = new THREE.PositionalAudio(this.sound.listener);
      this.root.add(a);
      this.shots.push(a);
    }
    a.position.copy(at);
    a.setRefDistance(ref);
    a.setRolloffFactor(rolloff);
    a.setBuffer(buf);
    a.setLoop(false);
    a.setVolume(Math.min(1.5, volume));
    a.setPlaybackRate(rate);
    a.play();
  }

  /** The crowd: a cheer for a strike, applause for a spare (the casino's recordings). */
  crowd(kind: 'cheer' | 'applause', at: THREE.Vector3, volume: number) {
    this.sound.play(kind === 'cheer' ? 'crowdCheer' : 'applause', at, { volume, ref: 6, rolloff: 0.9 });
  }
}
