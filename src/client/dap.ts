import * as THREE from 'three';
import type { FingerPose } from './fingers';
import { orientHand, reach, rotateWorld, setFingers } from './net/embody';

/**
 * The dap (dab-up, bro handshake) between two friends: hands swing up and
 * clasp around chest height with the thumbs hooked over each other (a power
 * grip, palms meeting at an angle, fingers pointing up), a short pull into a
 * one-armed shoulder bump with a couple of pats on the back, then release and
 * finish with a snap or a fist bump.
 *
 * - `classifyClasp` tells it from a business handshake by how the hands came in.
 * - `DapSeq` is the move itself, on a clock both machines run (net/session.ts
 *   starts it on the `dap` event: `dapMessage` / `readDapMessage`).
 * - `poseDap` poses a friend's avatar through it; `dapFingers` your own hand.
 *
 * (dab.ts is the other "dab": the dance pose, head tucked in an elbow.)
 */

// --- Dap or handshake? -----------------------------------------------------------------------

/** How a hand came in to meet the other one (measured over the last fraction of a second). */
export interface Approach {
  /** Height of the clasp above the floor, as a fraction of the player's eye height (chest ≈ 0.75+, a business handshake ≈ 0.6). */
  rise: number;
  /** Peak hand speed on the way in (m/s). */
  speed: number;
  /** Average upward speed on the way in (m/s; negative coming down). */
  up: number;
  /** Peak speed across the line toward the other hand (m/s): an arcing, swinging approach. */
  swing: number;
  /** How far the fingers point up from level (radians), when the wrist's turn is known. */
  tilt?: number | null;
}

/**
 * A plain handshake is low, slow, level and straight, ALL of them: anything
 * outside one of these limits is a dap (the dap is what friends expect when
 * they grab hands; the business handshake only when it's clearly one).
 */
export const LOW_CLASP = { rise: 0.7, speed: 0.8, up: 0.2, swing: 0.45, tilt: 0.45 } as const;

export type Clasp = 'dap' | 'handshake';

export function classifyClasp(a: Approach): Clasp {
  const low = a.rise < LOW_CLASP.rise;
  const slow = a.speed < LOW_CLASP.speed;
  const level = a.up < LOW_CLASP.up && (a.tilt === undefined || a.tilt === null || a.tilt < LOW_CLASP.tilt);
  const straight = a.swing < LOW_CLASP.swing;
  return low && slow && level && straight ? 'handshake' : 'dap';
}

/** A hand's recent path, for reading its approach when it meets another. */
export class ApproachTrack {
  private s: { t: number; p: THREE.Vector3 }[] = [];
  constructor(readonly window = 0.3) {}

  push(t: number, p: THREE.Vector3 | null) {
    if (!p) {
      this.s.length = 0;
      return;
    }
    this.s.push({ t, p: p.clone() });
    while (this.s.length > 2 && t - this.s[0].t > this.window) this.s.shift();
  }

  /** Speed over the last frame (m/s), 0 until there are two samples. */
  get speed(): number {
    const n = this.s.length;
    if (n < 2) return 0;
    const a = this.s[n - 2],
      b = this.s[n - 1];
    return a.p.distanceTo(b.p) / Math.max(1e-3, b.t - a.t);
  }

  /**
   * How it came in toward `toward` (the other hand). `floorY`/`eye`: the floor
   * under the player and their eye height above it; `tilt`: the fingers' pitch
   * if known.
   */
  read(toward: THREE.Vector3, floorY: number, eye: number, tilt: number | null = null): Approach {
    const s = this.s;
    const last = s[s.length - 1];
    if (!last) return { rise: 0, speed: 0, up: 0, swing: 0, tilt };
    const first = s[0];
    const line = toward.clone().sub(first.p);
    line.y = line.y * 0.5;
    if (line.lengthSq() < 1e-6) line.set(0, 0, 1);
    line.normalize();
    let speed = 0,
      swing = 0;
    const v = new THREE.Vector3();
    for (let i = 1; i < s.length; i++) {
      const dt = Math.max(1e-3, s[i].t - s[i - 1].t);
      v.subVectors(s[i].p, s[i - 1].p).divideScalar(dt);
      speed = Math.max(speed, v.length());
      swing = Math.max(swing, v.clone().addScaledVector(line, -v.dot(line)).length());
    }
    const span = Math.max(1e-3, last.t - first.t);
    return { rise: (last.p.y - floorY) / Math.max(0.5, eye), speed, up: s.length > 1 ? (last.p.y - first.p.y) / span : 0, swing, tilt };
  }
}

/** The fingers' pitch above level (radians) for a wrist pose (its −Z runs from the wrist into the hand). */
export function fingerTilt(q: THREE.Quaternion): number {
  const d = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  return Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
}

// --- The move --------------------------------------------------------------------------------

/** How long each part lasts (seconds). */
export const DAP = { clasp: 0.45, pull: 0.35, hug: 1.05, release: 0.35, finish: 0.55 } as const;
export const DAP_SECONDS = DAP.clasp + DAP.pull + DAP.hug + DAP.release + DAP.finish;
const T_PULL = DAP.clasp,
  T_HUG = T_PULL + DAP.pull,
  T_REL = T_HUG + DAP.hug,
  T_FIN = T_REL + DAP.release;
/** Seconds between pats on the back (the first lands with the shoulder bump). */
export const PAT_EVERY = 0.3;

export type DapPhase = 'clasp' | 'pull' | 'hug' | 'release' | 'finish' | 'done';
/** Moments that make a sound (and a buzz on your controllers if it's you). */
export type DapCue = 'clasp' | 'bump' | 'pat' | 'release' | 'snap' | 'knock' | 'ayy';
/** How it ends: a snap of the fingers as the hands slide apart, or a fist bump. */
export type Finisher = 'snap' | 'knock';

/** When each cue lands (seconds into the move). */
export function dapCues(fin: Finisher): [number, DapCue][] {
  const c: [number, DapCue][] = [
    [0, 'clasp'],
    [T_HUG, 'bump'],
  ];
  for (let t = T_HUG + PAT_EVERY; t < T_REL - 0.05; t += PAT_EVERY) c.push([t, 'pat']);
  c.push([T_REL, 'release'], [T_FIN + DAP.finish * 0.4, fin], [T_FIN + DAP.finish * 0.5, 'ayy']);
  return c;
}

const smooth = (x: number) => {
  const k = THREE.MathUtils.clamp(x, 0, 1);
  return k * k * (3 - 2 * k);
};

/**
 * One dap, on its own clock. Both machines start one when it's detected (or
 * the other side says so) and run it the same way, so both players see the
 * same move: nothing in it waits on anyone's hands once it's begun.
 */
export class DapSeq {
  t: number;
  private readonly cues: [number, DapCue][];

  /** `start`: seconds already gone (a late start skips the cues before it). */
  constructor(
    readonly finisher: Finisher = 'knock',
    start = 0,
  ) {
    this.t = start;
    this.cues = dapCues(finisher);
  }

  /** Moves the clock on; returns the cues passed on the way ([t, t + dt)). */
  step(dt: number): DapCue[] {
    const a = this.t,
      b = a + Math.max(0, dt);
    this.t = b;
    const out: DapCue[] = [];
    for (const [at, c] of this.cues) if (at >= a && at < b) out.push(c);
    return out;
  }

  get phase(): DapPhase {
    const t = this.t;
    return t < T_PULL ? 'clasp' : t < T_HUG ? 'pull' : t < T_REL ? 'hug' : t < T_FIN ? 'release' : t < DAP_SECONDS ? 'finish' : 'done';
  }

  get done() {
    return this.t >= DAP_SECONDS;
  }

  /** Hands locked in the thumb grip (0..1): snaps in at once, lets go as the release ends. */
  get grip(): number {
    const t = this.t;
    if (t < 0 || t >= T_FIN) return 0;
    return Math.min(1, t / 0.08) * Math.min(1, (T_FIN - t) / 0.12);
  }

  /** Bodies pulled together (0..1): in over the pull, held through the hug, back out on the release. */
  get close(): number {
    const t = this.t;
    if (t < T_PULL) return 0;
    if (t < T_HUG) return smooth((t - T_PULL) / DAP.pull);
    if (t < T_REL) return 1;
    return 1 - smooth((t - T_REL) / DAP.release);
  }

  /** The free arm around the other's back (0..1). */
  get hug(): number {
    const t = this.t;
    if (t < T_PULL + DAP.pull * 0.4) return 0;
    if (t < T_HUG + 0.1) return smooth((t - T_PULL - DAP.pull * 0.4) / (DAP.pull * 0.6 + 0.1));
    if (t < T_REL) return 1;
    return 1 - smooth((t - T_REL) / (DAP.release * 0.8));
  }

  /** The patting hand's lift (0 on the back, 1 at the top of the swing). */
  get pat(): number {
    const t = this.t;
    if (t < T_HUG || t >= T_REL) return 0;
    return 0.5 - 0.5 * Math.cos((2 * Math.PI * (t - T_HUG)) / PAT_EVERY);
  }

  /** Into the finisher (0..1). */
  get fin(): number {
    return this.t < T_FIN ? 0 : Math.min(1, (this.t - T_FIN) / DAP.finish);
  }

  /** The whole move's hold on the body (0..1): in fast, out at the end. */
  get engage(): number {
    const t = this.t;
    if (t < 0 || t >= DAP_SECONDS) return 0;
    return smooth(t / 0.2) * smooth((DAP_SECONDS - t) / 0.3);
  }
}

// --- Fingers -----------------------------------------------------------------------------------

/** The interlocked-thumb grip: thumb hooked over theirs (half bent, up), fingers wrapped round their hand. */
export const DAP_GRIP: FingerPose = [0.38, 0.72, 0.78, 0.82, 0.86];
export const DAP_FIST: FingerPose = [0.9, 1, 1, 1, 1];
/** A snap: middle finger pressed to the thumb (set), then cracked down into the palm (done). */
export const SNAP_SET: FingerPose = [0.55, 0.3, 0.45, 1, 1];
export const SNAP_DONE: FingerPose = [0.45, 0.3, 1, 1, 1];

const mix = (a: readonly number[], b: readonly number[], k: number): FingerPose => a.map((x, i) => x + (b[i] - x) * k) as FingerPose;

/** The clasping hand's fingers through the move, from what they'd be otherwise (`base`). */
export function dapFingers(base: Readonly<FingerPose>, seq: DapSeq): FingerPose {
  if (seq.grip > 0) return mix(base, DAP_GRIP, seq.grip);
  const f = seq.fin;
  if (f <= 0 || seq.done) return [...base] as FingerPose;
  const out = Math.min(1, (1 - f) / 0.25);
  if (seq.finisher === 'knock') return mix(base, DAP_FIST, Math.min(1, f / 0.2) * out);
  const shape = f < 0.4 ? SNAP_SET : SNAP_DONE;
  return mix(base, shape, Math.min(1, f / 0.2) * out);
}

// --- The network message ---------------------------------------------------------------------

export type Side = 'l' | 'r';

/** `dap` event: the sender daps `to` (an id), with the sender's `h` hand and their `th` hand. */
export interface DapMsg {
  id: number;
  to: string;
  h: Side;
  th: Side;
  fin: Finisher;
}

export function dapMessage(to: string, h: Side, th: Side, fin: Finisher = Math.random() < 0.5 ? 'snap' : 'knock', id = Math.floor(Math.random() * 1e9)): DapMsg {
  return { id, to, h, th, fin };
}

/** A `dap` event's data, checked (null if it isn't one). */
export function readDapMessage(d: unknown): DapMsg | null {
  if (!d || typeof d !== 'object') return null;
  const o = d as Record<string, unknown>;
  const side = (x: unknown): Side | null => (x === 'l' || x === 'r' ? x : null);
  const h = side(o.h),
    th = side(o.th);
  if (!h || !th || typeof o.to !== 'string' || !o.to || o.to.length > 64) return null;
  if (typeof o.id !== 'number' || !Number.isFinite(o.id)) return null;
  const fin: Finisher = o.fin === 'snap' ? 'snap' : 'knock';
  return { id: o.id, to: o.to, h, th, fin };
}

/** How long into a dap a crossing `dap` event (both sides spotted it at once) can still replace it. */
export const DAP_ADOPT = 0.6;

/**
 * A `dap` event arrives for a pair. `cur`: the dap already running for either
 * of them (its id, how far in, and whether it's this same pair), or null.
 * Start it; adopt it in place of the running one (both sides spotted it at
 * once: every machine goes with the lower id, so the finisher matches); or
 * ignore it (someone's busy with someone else, or it lost).
 */
export function dapArrives(cur: { id: number; t: number; samePair: boolean } | null, id: number): 'start' | 'adopt' | 'ignore' {
  if (!cur) return 'start';
  if (!cur.samePair) return 'ignore';
  return id < cur.id && cur.t < DAP_ADOPT ? 'adopt' : 'ignore';
}

// --- Posing a body -----------------------------------------------------------------------------

type Bones = Record<string, THREE.Object3D | undefined>;

/** Leans a rigged body's chest `angle` radians toward `dir` (a horizontal world direction), absolute from world up. */
export function leanChest(b: Bones, dir: THREE.Vector3, angle: number) {
  if (Math.abs(angle) < 1e-4) return;
  const neckB = b.Neck ?? b.Head;
  const spine = b.Abdomen ?? b.Spine ?? b.Spine1 ?? b.Torso;
  if (!neckB || !spine) return;
  const base = spine.getWorldPosition(new THREE.Vector3());
  const cur = neckB.getWorldPosition(new THREE.Vector3()).sub(base);
  if (cur.lengthSq() < 1e-8) return;
  const flat = dir.clone().setY(0);
  if (flat.lengthSq() < 1e-8) return;
  flat.normalize();
  const want = new THREE.Vector3(0, Math.cos(angle), 0).addScaledVector(flat, Math.sin(angle));
  rotateWorld(spine, cur, want);
}

export interface DapBody {
  seq: DapSeq;
  /** Which of this body's hands clasps. */
  hand: Side;
  /** Where the joined hands are (world). */
  clasp: THREE.Vector3;
  /** The partner's feet, facing and height (m). */
  partner: THREE.Vector3;
  partnerYaw: number;
  partnerHeight: number;
  /** This body's facing and size (1 at a 1.8 m figure). */
  yaw: number;
  sc: number;
}

/**
 * Poses a friend's rigged avatar through the dap (after its animation, with
 * world matrices current): the chest leans in, the clasping arm holds the
 * joined hands (thumb grip, fingers up) and then does the finisher, the free
 * arm goes round the partner's back and pats. Returns which hands it took
 * over (their tracked hand models should hide for those).
 */
export function poseDap(b: Bones, o: DapBody): { l: boolean; r: boolean } {
  const s = o.seq;
  const took = { l: false, r: false };
  const k = s.engage;
  if (k <= 0.001) return took;
  const up = new THREE.Vector3(0, 1, 0);
  const fwd = new THREE.Vector3(Math.sin(o.yaw), 0, Math.cos(o.yaw));
  const left = new THREE.Vector3(Math.cos(o.yaw), 0, -Math.sin(o.yaw));
  const hips = (b.Hips ?? b.Abdomen ?? b.Spine)?.getWorldPosition(new THREE.Vector3());
  const toward = o.partner.clone().sub(hips ?? o.partner.clone().addScaledVector(fwd, -1)).setY(0);
  if (toward.lengthSq() < 1e-6) toward.copy(fwd);
  toward.normalize();
  // Into each other: the chest leans in (and the clasping shoulder leads).
  leanChest(b, toward, (0.05 + 0.16 * s.close) * k);
  const S = o.hand === 'l' ? 'L' : 'R';
  const F = o.hand === 'l' ? 'R' : 'L';
  const sideOf = (X: 'L' | 'R') => (X === 'L' ? left.clone() : left.clone().negate());
  // The clasping arm: holds the joined hands, then the finisher.
  {
    const uA = b[`UpperArm${S}`],
      lA = b[`LowerArm${S}`],
      wA = b[`Wrist${S}`] ?? b[`Hand${S}`];
    if (uA && lA && wA) {
      const sh = uA.getWorldPosition(new THREE.Vector3());
      let target = o.clasp.clone();
      const f = s.fin;
      if (f > 0) {
        // Hands slide apart; a fist bump meets back in the middle, a snap goes up by the shoulder.
        const back = sh.clone().addScaledVector(toward, 0.28 * o.sc).addScaledVector(up, -0.12 * o.sc);
        if (s.finisher === 'knock') {
          const meet = Math.sin(Math.PI * Math.min(1, f / 0.8));
          target = back.clone().lerp(o.clasp.clone().addScaledVector(toward, -0.04), meet);
        } else {
          const by = sh.clone().addScaledVector(toward, 0.22 * o.sc).addScaledVector(up, 0.08 * o.sc).addScaledVector(sideOf(S), 0.1 * o.sc);
          target = o.clasp.clone().lerp(by, smooth(f / 0.35));
        }
      }
      const w = k * (f > 0 ? 1 - smooth((f - 0.6) / 0.4) : 1);
      const pole = sh.clone().addScaledVector(up, -0.5).addScaledVector(sideOf(S), 0.35).addScaledVector(fwd, -0.15);
      if (w > 0.001) {
        reach(uA, lA, wA, target, pole, w);
        took[o.hand] = w > 0.5;
        // Thumbs up, fingers up and toward the partner, palm facing in (to meet theirs at an angle).
        if (s.grip > 0) orientHand(b as Record<string, THREE.Object3D>, S, toward.clone().multiplyScalar(0.55).addScaledVector(up, 0.85), sideOf(F), s.grip * w);
        setFingers(b as Record<string, THREE.Object3D>, S, dapFingers([0.2, 0.2, 0.2, 0.2, 0.2], s));
      }
    }
  }
  // The free arm: round the partner's back, patting.
  const hug = s.hug * k;
  if (hug > 0.001) {
    const uA = b[`UpperArm${F}`],
      lA = b[`LowerArm${F}`],
      wA = b[`Wrist${F}`] ?? b[`Hand${F}`];
    if (uA && lA && wA) {
      const sh = uA.getWorldPosition(new THREE.Vector3());
      const pFwd = new THREE.Vector3(Math.sin(o.partnerYaw), 0, Math.cos(o.partnerYaw));
      const lift = s.pat;
      const target = o.partner
        .clone()
        .setY(o.partner.y + o.partnerHeight * 0.7 + 0.07 * lift)
        .addScaledVector(pFwd, -0.1 - 0.05 * lift)
        .addScaledVector(sideOf(F), 0.08);
      const pole = sh.clone().addScaledVector(sideOf(F), 0.55).addScaledVector(up, -0.15).addScaledVector(fwd, -0.1);
      reach(uA, lA, wA, target, pole, hug);
      took[o.hand === 'l' ? 'r' : 'l'] = hug > 0.5;
      setFingers(b as Record<string, THREE.Object3D>, F, [0.25, 0.2, 0.25, 0.25, 0.3]);
    }
  }
  return took;
}

/**
 * Where a body stands for the move: `from` its own spot, `partner` theirs.
 * Arm's length for the clasp, a shoulder bump's distance for the hug; `share`
 * is how much of the closing this body does (1 when the partner can't move,
 * i.e. it's you; ½ when you're watching two friends). Returns the offset to
 * add to where it would otherwise stand (capped).
 */
export function dapOffset(from: THREE.Vector3, partner: THREE.Vector3, seq: DapSeq, share = 1): THREE.Vector3 {
  const d = partner.clone().sub(from).setY(0);
  const dist = d.length();
  if (dist < 1e-4 || dist > 3) return new THREE.Vector3();
  d.divideScalar(dist);
  const want = THREE.MathUtils.lerp(0.85, 0.5, seq.close);
  const move = THREE.MathUtils.clamp((dist - want) * share, -0.4, 1.6) * seq.engage;
  return d.multiplyScalar(move);
}
