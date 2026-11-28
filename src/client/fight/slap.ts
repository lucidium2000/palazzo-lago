import * as THREE from 'three';
import type { Hand, Hands } from '../hands';

/**
 * Hands on faces: what a hand touching someone's head is, measured properly.
 *
 * Contact: every head (guests, and your friends' avatars) has a contact volume,
 * an ellipsoid fixed to the head bone (so it follows them crouching, sitting,
 * turning, and the head's own nods and snaps). Your hand is a handful of small
 * spheres: the palm, the five fingertips and three points along the fingers
 * (from hand tracking, or the hand posed on the controller). Each frame every
 * point is swept from where it was last frame (in the head's frame of last
 * frame) to where it is now (in the head's frame now), so a fast swing at
 * 72-90 Hz, or a slow frame, can't pass through a face between two frames.
 *
 * Velocity: the touching point's own velocity, averaged over the last few
 * frames, minus the head's, and only the part of it going INTO the face
 * (along the contact normal) counts, weighted by how flat the hand meets it
 * (palm or back of the hand: a slap; edge-on: less so). Then:
 *
 *   brush  < SLAP.brush           barely there: a glance at most
 *   touch  < SLAP.speed           a touch: a flinch, a lean away, maybe "hey"
 *   slap   >= SLAP.speed          a smack: the clap, the head snaps away, a red cheek
 *   punch  a fist faster than SLAP.punch (the existing punch, unchanged)
 *
 * One event per hand per contact: the hand has to leave the face (by
 * SLAP.rearm) before it can slap that face again.
 */

export const SLAP = {
  /** Approach speed into the face (m/s, relative to the head, flat hand) from which a touch is a slap. */
  speed: 1.6,
  /** Below this it's a brush (m/s). */
  brush: 0.35,
  /** Approach speed of a full-power slap (m/s). */
  full: 4.5,
  /** A fist faster than this (m/s, relative) is a punch (bodies.ts PUNCH_SPEED). */
  punch: 1.9,
  /** Any hand faster than this is a punch when we can't tell whether it's a fist. */
  punchAny: 3.2,
  /** The hand has to be this far off the face (m) before the next slap counts. */
  rearm: 0.04,
  /** Velocity is averaged over this long (s): a few frames. */
  window: 0.06,
  /** Edge-on hands count this much (a flat palm or back of the hand: 1). */
  edge: 0.65,
} as const;

/** The head's contact volume in the head bone's space (metres: +z the face, +y up, +x their left; see faces.ts). */
export const HEAD_SHAPE = {
  c: new THREE.Vector3(0, 0.08, 0.02),
  r: new THREE.Vector3(0.08, 0.125, 0.105),
};

/** The hand's contact points (index into a sample) and their radii (m). */
export const HAND_POINTS = {
  /** palm, thumb..pinky tips, then palm→index, palm→middle, palm→pinky midpoints */
  radii: [0.035, 0.011, 0.011, 0.011, 0.011, 0.011, 0.016, 0.016, 0.016] as readonly number[],
};
const NPTS = HAND_POINTS.radii.length;

export type TouchKind = 'brush' | 'touch' | 'slap' | 'punch';

export interface Grade {
  kind: TouchKind;
  /** Speed into the face (m/s). */
  approach: number;
  /** `approach` weighted by how flat the hand meets the face. */
  eff: number;
  /** Slap or punch power 0..1 (0 for a touch). */
  power: number;
  /** A touch's strength 0..1 (eff over the slap speed). */
  strength: number;
  /** The back of the hand met the face (a back-hand). */
  back: boolean;
}

/**
 * What a hand meeting a face is. `v` is the hand's velocity relative to the
 * head, `n` the outward normal of the face where they met, `palm` the palm's
 * normal (out of the palm) if known, `fist` whether the hand is a fist (null:
 * can't tell).
 */
export function gradeTouch(v: THREE.Vector3, n: THREE.Vector3, palm: THREE.Vector3 | null, fist: boolean | null): Grade {
  const speed = v.length();
  const approach = Math.max(0, -v.dot(n));
  const facing = palm ? palm.dot(n) : -1;
  const flat = palm ? Math.abs(facing) : 1;
  const back = !!palm && facing > 0.35;
  const eff = approach * (SLAP.edge + (1 - SLAP.edge) * flat);
  const strength = Math.min(1, eff / SLAP.speed);
  if ((fist === true && speed > SLAP.punch) || (fist === null && speed > SLAP.punchAny))
    return { kind: 'punch', approach, eff, power: Math.min(1, Math.max(0, (speed - 1.6) / 3)), strength, back: false };
  if (fist !== true && eff >= SLAP.speed) {
    const power = THREE.MathUtils.clamp(0.2 + (0.8 * (eff - SLAP.speed)) / (SLAP.full - SLAP.speed), 0.2, 1);
    return { kind: 'slap', approach, eff, power, strength, back };
  }
  return { kind: eff < SLAP.brush ? 'brush' : 'touch', approach, eff, power: 0, strength, back };
}

/**
 * Which way a blow (or a touch) moves someone's head: along the way the hand
 * was going. `yaw` is theirs; `amount` radians. Returns Person.snapY (+ turns
 * toward their left) and snapX (+ tips back), and the cheek that took it when
 * all we know is the direction (0 their left, 1 their right).
 */
export function headTurn(v: THREE.Vector3, yaw: number, amount: number): { yaw: number; pitch: number; side: 0 | 1 } {
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  // Toward their right is (-cos yaw, sin yaw); their front is (sin yaw, cos yaw).
  const across = -v.x * c + v.z * s;
  const fwd = v.x * s + v.z * c;
  const h = Math.hypot(across, fwd);
  if (h < 1e-6) return { yaw: 0, pitch: amount * 0.3, side: 0 };
  return {
    yaw: -(across / h) * amount,
    pitch: (Math.max(0, -fwd) / h) * amount * 0.45 + amount * 0.05,
    // A hand going to their left came from their right: that cheek.
    side: across < 0 ? 1 : 0,
  };
}

/** How far a slap of `power` snaps the head (radians). */
export const slapSnap = (v: THREE.Vector3, yaw: number, power: number) => headTurn(v, yaw, 0.3 + 0.5 * power);

/** How a touch moves the head: a small lean away. */
export const touchLean = (v: THREE.Vector3, yaw: number, strength: number) => headTurn(v, yaw, 0.04 + 0.12 * strength);

const M1 = new THREE.Matrix4();
const M2 = new THREE.Matrix4();
const V = new THREE.Vector3();

/** World ← unit-sphere matrix of a head's contact volume, grown by `pad` metres all round. */
export function headVolume(out: THREE.Matrix4, bone: THREE.Matrix4, pad = 0): THREE.Matrix4 {
  const e = bone.elements;
  const s = (Math.hypot(e[0], e[1], e[2]) + Math.hypot(e[4], e[5], e[6]) + Math.hypot(e[8], e[9], e[10])) / 3 || 1;
  const p = pad / s;
  const { c, r } = HEAD_SHAPE;
  return out.copy(bone).multiply(M1.makeTranslation(c.x, c.y, c.z)).multiply(M2.makeScale(r.x + p, r.y + p, r.z + p));
}

/** A head bone's world matrix from a position and facing (an avatar without bones: `y` the bone, about 0.1 m under the eyes). */
export function boneFromPose(out: THREE.Matrix4, x: number, y: number, z: number, yaw: number): THREE.Matrix4 {
  return out.makeRotationY(yaw).setPosition(x, y, z);
}

/**
 * The first point (0..1) along a → b inside the unit sphere, or -1. Starting
 * inside is 0.
 */
export function sweepUnit(a: THREE.Vector3, b: THREE.Vector3): number {
  const C = a.lengthSq() - 1;
  if (C <= 0) return 0;
  const dx = b.x - a.x,
    dy = b.y - a.y,
    dz = b.z - a.z;
  const A = dx * dx + dy * dy + dz * dz;
  if (A < 1e-12) return -1;
  const B = 2 * (a.x * dx + a.y * dy + a.z * dz);
  const disc = B * B - 4 * A * C;
  if (disc < 0) return -1;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  return t >= 0 && t <= 1 ? t : -1;
}

/** A hand touching a face, as found by SlapDetector.contact. */
export interface FaceHit extends Grade {
  /** On the face, where (world). */
  at: THREE.Vector3;
  /** The face's outward normal there (world). */
  n: THREE.Vector3;
  /** The hand's velocity relative to the head, smoothed (world, m/s). */
  v: THREE.Vector3;
  /** The cheek (side of the head) that was touched: 0 their left, 1 their right. */
  side: 0 | 1;
  /** Which hand point touched first (HAND_POINTS order). */
  point: number;
}

interface Sample {
  t: number;
  frame: number;
  pts: THREE.Vector3[];
  has: boolean[];
}

interface HandTrack {
  ring: Sample[];
  /** Index of the newest sample in `ring`, and how many are filled. */
  head: number;
  n: number;
  palm: THREE.Vector3 | null;
  fist: boolean | null;
  /** Heads this hand is touching right now (the frame we last saw it touching), for the one-slap-per-contact rule. */
  on: WeakMap<object, number>;
}

interface HeadTrack {
  frame: number;
  t: number;
  bone: THREE.Matrix4;
  prev: THREE.Matrix4;
  hasPrev: boolean;
  c: THREE.Vector3;
  v: THREE.Vector3;
}

const RING = 8;

/**
 * Tracks your hands and the heads near them across frames, and finds hands
 * meeting faces (see the top of this file). Call `beginFrame` once a frame,
 * `hand` for each hand (sampleHands), then `contact` for each head near a hand.
 */
export class SlapDetector {
  frame = 0;
  private hands = new Map<string, HandTrack>();
  private heads = new WeakMap<object, HeadTrack>();
  private inv = new THREE.Matrix4();
  private invPrev = new THREE.Matrix4();
  private w = new THREE.Matrix4();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private u = new THREE.Vector3();
  private n3 = new THREE.Matrix3();

  /** This frame's time (s). */
  t = 0;

  /** A new frame, at time `t` (s). */
  beginFrame(t: number) {
    this.frame++;
    this.t = t;
  }

  /** This frame's hand: its contact points (world, HAND_POINTS order) and which are known, the palm's normal, and whether it's a fist. */
  hand(id: string, pts: readonly THREE.Vector3[], has: readonly boolean[], palm: THREE.Vector3 | null, fist: boolean | null) {
    let h = this.hands.get(id);
    if (!h) {
      h = {
        ring: Array.from({ length: RING }, () => ({ t: 0, frame: -9, pts: Array.from({ length: NPTS }, () => new THREE.Vector3()), has: new Array(NPTS).fill(false) })),
        head: -1,
        n: 0,
        palm: null,
        fist: null,
        on: new WeakMap(),
      };
      this.hands.set(id, h);
    }
    // Twice in one frame: replace this frame's sample.
    if (!(h.n > 0 && h.ring[h.head].frame === this.frame)) {
      h.head = (h.head + 1) % RING;
      h.n = Math.min(RING, h.n + 1);
    }
    const s = h.ring[h.head];
    s.t = this.t;
    s.frame = this.frame;
    for (let i = 0; i < NPTS; i++) {
      s.has[i] = !!has[i] && !!pts[i];
      if (s.has[i]) s.pts[i].copy(pts[i]);
    }
    h.palm = palm ? (h.palm ?? new THREE.Vector3()).copy(palm) : null;
    h.fist = fist;
  }

  /** A hand gone (controller off, hands out of view): it starts afresh. */
  dropHand(id: string) {
    this.hands.delete(id);
  }

  /** Where a hand's palm is this frame (null if it wasn't given this frame). */
  palmAt(id: string): THREE.Vector3 | null {
    const h = this.hands.get(id);
    if (!h || h.n === 0) return null;
    const s = h.ring[h.head];
    return s.frame === this.frame && s.has[0] ? s.pts[0] : null;
  }

  private sample(h: HandTrack, back: number): Sample | null {
    if (back >= h.n) return null;
    return h.ring[(h.head - back + RING) % RING];
  }

  /** A point's velocity (world), averaged over the last SLAP.window. */
  private pointVel(h: HandTrack, i: number, out: THREE.Vector3): THREE.Vector3 {
    const last = this.sample(h, 0)!;
    let first: Sample | null = null;
    for (let k = 1; k < h.n; k++) {
      const s = this.sample(h, k)!;
      // Consecutive frames only, with this point known.
      if (!s.has[i] || s.frame !== last.frame - k) break;
      first = s;
      if (last.t - s.t >= SLAP.window) break;
    }
    if (!first) return out.set(0, 0, 0);
    const dt = last.t - first.t;
    return dt > 0.004 ? out.subVectors(last.pts[i], first.pts[i]).divideScalar(dt) : out.set(0, 0, 0);
  }

  private headTrack(key: object, bone: THREE.Matrix4): HeadTrack {
    const t = this.t;
    let hd = this.heads.get(key);
    if (!hd) {
      hd = { frame: -9, t, bone: new THREE.Matrix4().copy(bone), prev: new THREE.Matrix4().copy(bone), hasPrev: false, c: new THREE.Vector3().setFromMatrixPosition(bone), v: new THREE.Vector3() };
      hd.frame = this.frame;
      this.heads.set(key, hd);
      return hd;
    }
    if (hd.frame === this.frame) return hd;
    const fresh = hd.frame === this.frame - 1;
    hd.prev.copy(hd.bone);
    hd.hasPrev = fresh;
    hd.bone.copy(bone);
    V.setFromMatrixPosition(bone);
    const dt = t - hd.t;
    if (fresh && dt > 0.004) {
      // The head's own velocity, smoothed (a few frames).
      const k = 0.5;
      hd.v.multiplyScalar(1 - k).addScaledVector(V.clone().sub(hd.c).divideScalar(dt), k);
    } else hd.v.set(0, 0, 0);
    hd.c.copy(V);
    hd.t = t;
    hd.frame = this.frame;
    return hd;
  }

  /**
   * Does hand `id` meet the face `key` (whose head bone is at `bone`, world)
   * this frame? A hit only once per contact: null while the hand stays on
   * the face, until it has left it.
   */
  contact(id: string, key: object, bone: THREE.Matrix4): FaceHit | null {
    const h = this.hands.get(id);
    const hd = this.headTrack(key, bone);
    if (!h || h.n === 0) return null;
    const cur = this.sample(h, 0)!;
    if (cur.frame !== this.frame) return null;
    const prevS = this.sample(h, 1);
    const prev = prevS && prevS.frame === this.frame - 1 ? prevS : null;
    // Touching it last time we looked (a frame or two ago): still the same contact.
    const onAt = h.on.get(key);
    const touching = onAt !== undefined && onAt >= this.frame - 3;
    let best = 2,
      bi = -1,
      br = 0;
    const u = this.u;
    let away = true;
    let lastR = -1;
    for (let i = 0; i < NPTS; i++) {
      if (!cur.has[i]) continue;
      const r = HAND_POINTS.radii[i];
      if (r !== lastR) {
        this.inv.copy(headVolume(this.w, hd.bone, r)).invert();
        this.invPrev.copy(headVolume(this.w, hd.hasPrev ? hd.prev : hd.bone, r)).invert();
        lastR = r;
      }
      const b = this.b.copy(cur.pts[i]).applyMatrix4(this.inv);
      const a = prev && prev.has[i] ? this.a.copy(prev.pts[i]).applyMatrix4(this.invPrev) : this.a.copy(b);
      const ts = sweepUnit(a, b);
      if (ts >= 0 && ts < best) {
        best = ts;
        bi = i;
        br = r;
        u.copy(a).lerp(b, ts);
      }
    }
    // Off the face by the re-arm margin (every point)?
    if (bi < 0) {
      if (onAt === undefined) return null;
      for (let i = 0; i < NPTS && away; i++) {
        if (!cur.has[i]) continue;
        headVolume(this.w, hd.bone, HAND_POINTS.radii[i] + SLAP.rearm);
        if (this.b.copy(cur.pts[i]).applyMatrix4(this.inv.copy(this.w).invert()).lengthSq() <= 1) away = false;
      }
      if (away) h.on.delete(key);
      else if (touching) h.on.set(key, this.frame);
      return null;
    }
    h.on.set(key, this.frame);
    if (touching) return null;
    // Where, and which way the face faces there (world).
    headVolume(this.w, hd.bone, br);
    this.inv.copy(this.w).invert();
    const n = new THREE.Vector3().copy(u).applyMatrix3(this.n3.setFromMatrix4(this.inv).transpose());
    if (n.lengthSq() < 1e-12) n.set(0, 1, 0);
    n.normalize();
    if (u.lengthSq() < 1e-9) u.set(0, 0, 1);
    const surf = u.clone().normalize();
    const at = surf.clone().applyMatrix4(headVolume(this.w, hd.bone, 0));
    // Which side of the head: +x in the bone's space is their left.
    const side: 0 | 1 = HEAD_SHAPE.c.x + surf.x * HEAD_SHAPE.r.x >= 0 ? 0 : 1;
    // The touching point's velocity relative to the head.
    const v = this.pointVel(h, bi, new THREE.Vector3()).sub(hd.v);
    const g = gradeTouch(v, n, h.palm, h.fist);
    return { ...g, at, n, v, side, point: bi };
  }
}

const tips = [0, 1, 2, 3, 4].map(() => new THREE.Vector3());
const tipHas = [false, false, false, false, false];
const pts = Array.from({ length: NPTS }, () => new THREE.Vector3());
const has: boolean[] = new Array(NPTS).fill(false);

/** Which side a hand is on. */
export const handSide = (h: Hand): 'left' | 'right' => (h.ctrl.userData.handedness === 'left' ? 'left' : 'right');

/**
 * Feeds this frame's hands into a detector: the palm (the grip), the five
 * fingertips and three points along the fingers, from hand tracking or the
 * hand posed on the controller (just the palm if the fingers aren't known).
 */
export function sampleHands(det: SlapDetector, hands: Hands, isFist: (h: Hand) => boolean | null) {
  for (const h of hands.hands) {
    const side = handSide(h);
    if (h.ctrl.userData.connected === false) {
      det.dropHand(side);
      continue;
    }
    h.grip.updateMatrixWorld(true);
    pts[0].setFromMatrixPosition(h.grip.matrixWorld);
    if (pts[0].lengthSq() === 0) {
      det.dropHand(side);
      continue;
    }
    has.fill(false);
    has[0] = true;
    const src = typeof hands.fingertips === 'function' ? hands.fingertips(side, tips, tipHas) : null;
    if (src) {
      for (let i = 0; i < 5; i++) {
        has[1 + i] = tipHas[i];
        if (tipHas[i]) pts[1 + i].copy(tips[i]);
      }
      // Along the fingers: halfway from the palm to the index, middle and pinky tips.
      for (const [k, tip] of [[6, 1], [7, 2], [8, 4]] as const) {
        has[k] = tipHas[tip];
        if (has[k]) pts[k].copy(pts[0]).lerp(tips[tip], 0.5);
      }
    }
    const aim = typeof hands.handAim === 'function' ? hands.handAim(side) : null;
    det.hand(side, pts, has, aim?.palm ?? null, isFist(h));
  }
}
