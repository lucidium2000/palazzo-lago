import * as THREE from 'three';
import { reach, rotateWorld } from './net/embody';

/**
 * The dab, with a friend: grab each other's hand (both gripping, hands
 * together), hold it still a moment, then pull apart while still gripping,
 * and you both strike the pose: head tucked into one elbow, the other arm
 * flung up and out, for a beat, then back to normal.
 *
 * How it's told apart from the other hand gestures (net/session.ts):
 * - a fist bump is two fists meeting fast (the grab comes in open, then closes);
 * - a high five is two open hands meeting fast, up high;
 * - a handshake is hands held together: open, or gripped with a shake
 *   (the joined hands going up and down, two turns or more);
 * - the dab is a still grip held for `DAB_HOLD` seconds and then a yank apart
 *   (the hands end up `DAB_PULL` m apart within `DAB_PULL_TIME` s of letting go
 *   of each other, still gripping).
 */

/** How long the pose lasts (seconds). */
export const DAB_SECONDS = 1.2;
/** Seconds of still, gripped contact before a pull counts. */
export const DAB_HOLD = 0.3;
/** How far apart (m) the hands must get after the grab, and how fast (s). */
export const DAB_PULL = 0.3;
export const DAB_PULL_TIME = 0.6;
/** A shake: the joined hands turning up/down by at least this much (m), this many times. */
export const SHAKE_STEP = 0.03;
export const SHAKE_TURNS = 2;

/** How far into the pose (0..1) at `left` seconds remaining of DAB_SECONDS: snap in, hold, ease out. */
export function dabWeight(left: number): number {
  if (left <= 0) return 0;
  const t = DAB_SECONDS - left;
  const inn = Math.min(1, t / 0.15);
  const out = Math.min(1, left / 0.3);
  const k = Math.min(inn, out);
  return k * k * (3 - 2 * k);
}

/**
 * One pair of hands touching (one of mine, one of theirs): how long both have
 * been gripping, and whether the joined hands are shaking up and down.
 */
export class GrabTrack {
  /** Seconds both hands have been gripping, together. */
  held = 0;
  /** Up/down turns of the joined hands (a handshake's pumping). */
  turns = 0;
  private ext: number | null = null;
  private dir = 0;

  /** A frame in contact: `y` my hand's height, `both` whether both of us are gripping. */
  touch(dt: number, y: number, both: boolean) {
    this.held = both ? this.held + dt : 0;
    if (this.ext === null) {
      this.ext = y;
      return;
    }
    if (this.dir === 0) {
      if (Math.abs(y - this.ext) > SHAKE_STEP) {
        this.dir = Math.sign(y - this.ext);
        this.ext = y;
      }
    } else if ((y - this.ext) * this.dir > 0) this.ext = y;
    else if (Math.abs(y - this.ext) > SHAKE_STEP) {
      this.dir = -this.dir;
      this.ext = y;
      this.turns++;
    }
  }

  /** Shaken (up and down): a handshake, not a dab. */
  get shaking() {
    return this.turns >= SHAKE_TURNS;
  }

  /** Gripped and held still long enough: pulling apart now is a dab. */
  get armed() {
    return this.held >= DAB_HOLD && !this.shaking;
  }
}

/**
 * After an armed grab lets go: did the hands get pulled apart (still gripping)
 * far enough, fast enough? `since`: seconds since they parted; `apart`: their
 * distance now (m). 'dab', 'wait' (keep watching) or 'no' (too slow, or they let go).
 */
export function pullApart(since: number, apart: number, gripping: boolean): 'dab' | 'wait' | 'no' {
  if (since > DAB_PULL_TIME) return 'no';
  if (apart >= DAB_PULL) return gripping ? 'dab' : 'no';
  return 'wait';
}

type Bones = Record<string, THREE.Object3D | undefined>;

/**
 * Poses a rigged character mid-dab (after its animation, root placed and world
 * matrices current), by `k` (0..1). Head into the right elbow, left arm flung
 * up and out to the left (both arms pointing the same way). `yaw`: which way the
 * body faces; `sc`: its size (1 at a 1.8 m figure). `arms: false` leaves the arms
 * alone (your own body in VR: they follow your real hands), and `head: false`
 * the head (it's hidden from the inside anyway); `lean` how far the chest leans
 * into the elbow (radians).
 */
export function poseDab(b: Bones, yaw: number, sc: number, k: number, opts: { arms?: boolean; head?: boolean; lean?: number } = {}) {
  if (k <= 0.001) return;
  const arms = opts.arms ?? true,
    head = opts.head ?? true;
  const up = new THREE.Vector3(0, 1, 0);
  const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const left = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const right = left.clone().negate();
  // (Everything here is absolute, worked out from the hips and world up, never "a bit more than now":
  // a bone the clip doesn't key keeps last frame's turn, and a relative nudge would add up frame on frame.)
  // The chest bends a little forward and toward the tucked (right) elbow.
  const neckB = b.Neck ?? b.Head;
  const spine = b.Abdomen ?? b.Spine ?? b.Spine1 ?? b.Torso;
  if (neckB && spine) {
    const base = spine.getWorldPosition(new THREE.Vector3());
    const cur = neckB.getWorldPosition(new THREE.Vector3()).sub(base);
    const lean = opts.lean ?? 0.22;
    const side = fwd.clone().multiplyScalar(0.75).addScaledVector(right, 0.66).normalize();
    const want = up.clone().multiplyScalar(Math.cos(lean)).addScaledVector(side, Math.sin(lean));
    // Blend from the clip's posture to the lean (bounded even if the bone kept last frame's turn).
    if (cur.lengthSq() > 1e-8) rotateWorld(spine, cur, cur.clone().normalize().lerp(want, k).normalize());
  }
  const sh = (S: 'L' | 'R') => b[`UpperArm${S}`]?.getWorldPosition(new THREE.Vector3()) ?? null;
  const shL = sh('L'),
    shR = sh('R');
  if (arms && shL && shR) {
    // Tucked arm (right): upper arm forward and up, the elbow in front of the face (on its own side),
    // the forearm across the face toward the left shoulder.
    const uR = b.UpperArmR,
      lR = b.LowerArmR,
      wR = b.WristR ?? b.HandR;
    if (uR && lR && wR) {
      const elbow = shR.clone().addScaledVector(fwd, 0.22 * sc).addScaledVector(up, 0.18 * sc).addScaledVector(left, 0.05 * sc);
      const hand = elbow.clone().addScaledVector(left, 0.26 * sc).addScaledVector(up, 0.05 * sc);
      reach(uR, lR, wR, hand, elbow.clone().addScaledVector(fwd, 0.3 * sc).addScaledVector(right, 0.1 * sc), k);
    }
    // Flung arm (left): straight out, up and to the left.
    const uL = b.UpperArmL,
      lL = b.LowerArmL,
      wL = b.WristL ?? b.HandL;
    if (uL && lL && wL) {
      const len = uL.getWorldPosition(new THREE.Vector3()).distanceTo(lL.getWorldPosition(new THREE.Vector3())) + lL.getWorldPosition(new THREE.Vector3()).distanceTo(wL.getWorldPosition(new THREE.Vector3()));
      const dir = left.clone().multiplyScalar(0.8).addScaledVector(up, 0.55).addScaledVector(fwd, 0.2).normalize();
      const hand = shL.clone().addScaledVector(dir, len * 0.97);
      const elbow = shL.clone().addScaledVector(up, -0.3 * sc).addScaledVector(fwd, -0.3 * sc);
      reach(uL, lL, wL, hand, elbow, k);
    }
  }
  // Face down into the crook of the right elbow: the top of the head tips forward and right.
  // (Which way is "up" in the head bone's own frame is learnt the first time, standing upright.)
  const h = b.Head;
  if (head && h) {
    const q = h.getWorldQuaternion(new THREE.Quaternion());
    const ud = h.userData as { dabUp?: THREE.Vector3 };
    ud.dabUp ??= up.clone().applyQuaternion(q.clone().invert());
    const cur = ud.dabUp.clone().applyQuaternion(q);
    const tuck = up.clone().multiplyScalar(0.55).addScaledVector(fwd, 0.62).addScaledVector(right, 0.55).normalize();
    rotateWorld(h, cur, cur.clone().lerp(tuck, k).normalize());
  }
}

/**
 * The same pose for the simple (unrigged) figures, as shoulder/elbow angles in
 * their own convention (people.ts): `side` +1/-1, outward roll is +side.
 * Returns [shoulder pitch, elbow, roll] to blend toward, and the head's [pitch, yaw].
 */
export function dabAngles(right: boolean, side: number): [number, number, number] {
  return right ? [-1.75, -2.1, -0.85 * side] : [-2.25, -0.1, 1.0 * side];
}
export const DAB_HEAD: [number, number] = [0.55, -0.5];
