import * as THREE from 'three';

/**
 * Your open hand as a little moving tray. Hold a hand flat, palm up, fingers
 * open and not squeezing, and things you drop into it (a chip, a die, a lime)
 * land and stay there, riding along as you move and turn your hand. Tip it
 * past ~35° and they slide off; flick it, or yank it away faster than they can
 * follow, and they fly; close your hand and you've got them.
 *
 * The maths here is pure (three.js vectors only, no scene): which way the palm
 * faces, whether it can hold things, the support plane under a point, and what
 * a thing on it does given the hand's acceleration (static friction holds it
 * until the apparent gravity in the hand's frame tips past tan(35°)). The
 * loose-object simulation (loosephys.ts) and the chip rail (chiprail.ts) both
 * ride on the surfaces `PalmTracker` keeps up to date.
 */

/** Half-size of the palm's support patch (9 × 10 cm: across the palm, wrist to finger roots). */
export const PALM_HX = 0.045;
export const PALM_HZ = 0.05;
/** Palm normal must be within this of straight up to hold anything. */
export const PALM_MAX_TILT = THREE.MathUtils.degToRad(45);
/** Past this tilt things start to slide (static friction μs = tan 35°). */
export const PALM_SLIDE_TILT = THREE.MathUtils.degToRad(35);
export const PALM_MU_S = Math.tan(PALM_SLIDE_TILT);
/** Sliding friction (skin on a chip). */
export const PALM_MU_K = 0.45;
/** A jolt this many times past what friction can hold throws things off rather than sliding them. */
export const PALM_FLY = 1.8;
/** Moving this fast (m/s) is a flick: anything on the palm leaves it. */
export const PALM_FLICK_SPEED = 3.2;

const G = 9.81;
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * A moving support surface (an open palm): a rectangle 2hx × 2hz centred on
 * `p`, its normal along local +y of `q`. Velocity, spin and acceleration are
 * the hand's (smoothed), used to carry things and decide when they come off.
 */
export interface Platform {
  id: string;
  p: THREE.Vector3;
  q: THREE.Quaternion;
  hx: number;
  hz: number;
  v: THREE.Vector3;
  w: THREE.Vector3;
  a: THREE.Vector3;
  /** It holds things right now (open, palm up, not squeezing, tracked). */
  active: boolean;
  /** Your hand (not your friend's). */
  mine: boolean;
}

export function makePlatform(id: string, mine = true): Platform {
  return { id, p: new THREE.Vector3(), q: new THREE.Quaternion(), hx: PALM_HX, hz: PALM_HZ, v: new THREE.Vector3(), w: new THREE.Vector3(), a: new THREE.Vector3(), active: false, mine };
}

/** Angle between a surface normal and straight up (radians). */
export function tiltOf(normal: THREE.Vector3): number {
  const l = normal.length() || 1;
  return Math.acos(THREE.MathUtils.clamp(normal.y / l, -1, 1));
}

/** The normal (local +y) of an orientation. */
export function normalOf(q: THREE.Quaternion, out = new THREE.Vector3()) {
  return out.copy(UP).applyQuaternion(q);
}

/**
 * Can an open hand hold things? `open` 0 (fist) .. 1 (flat), `grip` the grip
 * button / squeeze 0..1, `normal` the way the palm faces.
 */
export function palmCanHold(normal: THREE.Vector3, open: number, grip: number): boolean {
  return open >= 0.5 && grip < 0.35 && tiltOf(normal) <= PALM_MAX_TILT;
}

/**
 * Orientation of a palm surface from the way the palm faces (`normal`, out of
 * the skin) and the way the fingers point (`fwd`): local +y = normal, local
 * -z = toward the fingers.
 */
export function palmQuat(normal: THREE.Vector3, fwd: THREE.Vector3, out = new THREE.Quaternion()): THREE.Quaternion {
  const y = normal.clone().normalize();
  const f = fwd.clone().addScaledVector(y, -fwd.dot(y));
  if (f.lengthSq() < 1e-8) f.set(0, 0, -1).addScaledVector(y, y.z);
  const z = f.normalize().negate();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  z.crossVectors(x, y);
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** A point given in the platform's frame, in world space. */
export function platformToWorld(pl: Platform, local: THREE.Vector3, out = new THREE.Vector3()) {
  return out.copy(local).applyQuaternion(pl.q).add(pl.p);
}

/** A world point in the platform's frame. */
export function worldToPlatform(pl: Platform, world: THREE.Vector3, out = new THREE.Vector3()) {
  return out.copy(world).sub(pl.p).applyQuaternion(_q.copy(pl.q).invert());
}

/** Velocity of a point riding the platform (world): v + ω × r. */
export function pointVelocity(pl: Platform, at: THREE.Vector3, out = new THREE.Vector3()) {
  _v.copy(at).sub(pl.p);
  return out.crossVectors(pl.w, _v).add(pl.v);
}

/**
 * Height of the platform's plane straight under (x, z), if (x, z) is over the
 * patch (with `margin` metres of slack round the edge); null otherwise.
 */
export function platformY(pl: Platform, x: number, z: number, margin = 0): number | null {
  const n = normalOf(pl.q, _v);
  if (n.y < 0.2) return null;
  const y = pl.p.y - (n.x * (x - pl.p.x) + n.z * (z - pl.p.z)) / n.y;
  const l = worldToPlatform(pl, new THREE.Vector3(x, y, z));
  if (Math.abs(l.x) > pl.hx + margin || Math.abs(l.z) > pl.hz + margin) return null;
  return y;
}

/**
 * What the hand's motion does to something resting on it. In the hand's frame
 * the thing feels gravity minus the hand's acceleration: the part pressing
 * into the palm (`n`, m/s²) and the part along it (`t`, a vector in the
 * platform's local x/z). Static friction holds while |t| ≤ μs·n.
 */
export function apparentGravity(pl: Platform, out = new THREE.Vector3()): { n: number; tx: number; tz: number } {
  out.set(-pl.a.x, -G - pl.a.y, -pl.a.z).applyQuaternion(_q.copy(pl.q).invert());
  return { n: -out.y, tx: out.x, tz: out.z };
}

export type PalmHold = 'stick' | 'slide' | 'fly';

/**
 * Stick, slide or fly, for something at rest on the palm: it flies when the
 * palm drops away faster than it falls (nothing pressing it down), when the
 * hand jerks far harder than friction can hold, or on a fast flick; it slides
 * when the palm is tipped past ~35° or the hand accelerates a bit too hard;
 * otherwise it sticks.
 */
export function palmHold(pl: Platform): PalmHold {
  const g = apparentGravity(pl);
  const t = Math.hypot(g.tx, g.tz);
  if (g.n < 0.15 * G) return 'fly';
  if (pl.v.length() > PALM_FLICK_SPEED) return 'fly';
  if (t > PALM_FLY * PALM_MU_S * g.n + 1.5) return 'fly';
  if (t > PALM_MU_S * g.n) return 'slide';
  return 'stick';
}

/**
 * One step of sliding along the palm (local x/z): apparent gravity along the
 * palm less sliding friction. `lv` (local velocity, x/z) is updated in place
 * and comes to rest when friction wins. Returns true while it's moving.
 */
export function slideStep(pl: Platform, lv: THREE.Vector2, dt: number): boolean {
  const g = apparentGravity(pl);
  const n = Math.max(0, g.n);
  const sp = lv.length();
  const t = Math.hypot(g.tx, g.tz);
  if (sp < 1e-3 && t <= PALM_MU_S * n) {
    lv.set(0, 0);
    return false;
  }
  // Friction opposes the slide (or, from rest, the pull).
  const fx = sp > 1e-3 ? lv.x / sp : g.tx / (t || 1),
    fz = sp > 1e-3 ? lv.y / sp : g.tz / (t || 1);
  const ax = g.tx - PALM_MU_K * n * fx,
    az = g.tz - PALM_MU_K * n * fz;
  const ox = lv.x,
    oz = lv.y;
  lv.x += ax * dt;
  lv.y += az * dt;
  // Friction stops it; it doesn't push it back.
  if (sp > 1e-3 && lv.x * ox + lv.y * oz < 0) {
    lv.set(0, 0);
    return false;
  }
  return true;
}

/** Is a local point off the edge of the patch? */
export function offPalm(pl: Platform, lx: number, lz: number) {
  return Math.abs(lx) > pl.hx || Math.abs(lz) > pl.hz;
}

/** A hand's palm this frame, as measured (see `PalmTracker.set`). */
export interface PalmReading {
  /** Centre of the palm's skin, world. */
  p: THREE.Vector3;
  /** Out of the palm. */
  normal: THREE.Vector3;
  /** Toward the fingers. */
  fwd: THREE.Vector3;
  /** 0 fist .. 1 flat. */
  open: number;
  /** Squeeze / grip button 0..1. */
  grip: number;
}

/**
 * Keeps a platform per hand up to date from per-frame readings: pose, and
 * smoothed velocity, spin and acceleration (hand poses are noisy; a little
 * smoothing keeps a chip from jittering off a steady hand).
 */
export class PalmTracker {
  readonly platforms: Platform[];
  readonly grip: number[] = [0, 0];
  readonly open: number[] = [0, 0];
  private seen: boolean[] = [false, false];
  private prevP = [new THREE.Vector3(), new THREE.Vector3()];
  private prevQ = [new THREE.Quaternion(), new THREE.Quaternion()];
  private prevV = [new THREE.Vector3(), new THREE.Vector3()];

  constructor(readonly sides: readonly string[] = ['left', 'right']) {
    this.platforms = sides.map((s) => makePlatform(`palm-${s}`));
  }

  bySide(side: string): Platform | null {
    const i = this.sides.indexOf(side);
    return i >= 0 ? this.platforms[i] : null;
  }

  /** The reading for hand `i` this frame (null: not tracked). */
  set(i: number, r: PalmReading | null, dt: number) {
    const pl = this.platforms[i];
    if (!r) {
      pl.active = false;
      this.seen[i] = false;
      pl.v.set(0, 0, 0);
      pl.w.set(0, 0, 0);
      pl.a.set(0, 0, 0);
      return;
    }
    const q = palmQuat(r.normal, r.fwd);
    this.grip[i] = r.grip;
    this.open[i] = r.open;
    if (this.seen[i] && dt > 1e-4) {
      const k = 1 - Math.exp(-dt / 0.035);
      const v = r.p.clone().sub(this.prevP[i]).divideScalar(dt);
      pl.v.lerp(v, k);
      const a = pl.v.clone().sub(this.prevV[i]).divideScalar(dt);
      pl.a.lerp(a, 1 - Math.exp(-dt / 0.06));
      // ω from the change in orientation.
      const dq = q.clone().multiply(this.prevQ[i].clone().invert());
      if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
      const ang = 2 * Math.acos(THREE.MathUtils.clamp(dq.w, -1, 1));
      const s = Math.sqrt(Math.max(0, 1 - dq.w * dq.w));
      const w = s > 1e-6 ? new THREE.Vector3(dq.x / s, dq.y / s, dq.z / s).multiplyScalar(ang / dt) : new THREE.Vector3();
      pl.w.lerp(w, k);
    } else {
      pl.v.set(0, 0, 0);
      pl.w.set(0, 0, 0);
      pl.a.set(0, 0, 0);
    }
    this.seen[i] = true;
    this.prevP[i].copy(r.p);
    this.prevQ[i].copy(q);
    this.prevV[i].copy(pl.v);
    pl.p.copy(r.p);
    pl.q.copy(q);
    pl.active = palmCanHold(r.normal, r.open, r.grip);
  }
}

/** The palms in play (shared by the loose objects and the chip rails). */
export const palms = new PalmTracker();
/** Hook: close hand `side` around grabbable `g` (set by whoever owns the hands). */
export const palmGrab: { grab: ((side: string, g: import('./hands').Grabbable) => boolean) | null } = { grab: null };
