import * as THREE from 'three';

/**
 * Finger tracking for your avatar's hands.
 *
 * Meta Touch controllers (Quest 2 / 3 / Pro) report more than button presses:
 * every control has a capacitive sensor, exposed in WebXR as
 * GamepadButton.touched, plus analogue values. In the xr-standard layout:
 *   0 trigger      value 0..1 + touched     → index finger
 *   1 squeeze      value 0..1                → middle, ring and pinky
 *   3 thumbstick   pressed + touched         ┐
 *   4 A / X        pressed + touched         ├ thumb resting on the controller
 *   5 B / Y        pressed + touched         │ (lift it off everything: thumbs up)
 *   6 thumb rest   touched (where present)   ┘
 * So: finger off the trigger = pointing; resting on it = slightly curled;
 * pulling it = curling all the way. Grip curls the other three. Thumb down
 * when it touches anything, up when it doesn't. That's how Meta's own hands
 * pose from Touch controllers.
 *
 * With hand tracking (no controllers) the browser gives 25 joints per hand
 * (WebXR Hand Input), and each finger's curl is measured from the bends
 * between its bones.
 *
 * A pose is [thumb, index, middle, ring, pinky], each 0 (straight) .. 1 (curled).
 */
export type FingerPose = [number, number, number, number, number];

export const OPEN: FingerPose = [0, 0, 0, 0, 0];

/**
 * A controller hand: completely open and flat unless something is pressed. Only presses curl it
 * (trigger: the index finger, grip: the other three, a thumb button or stick click: the thumb);
 * merely resting a finger on a button doesn't.
 */
export function controllerPose(gp: Gamepad): FingerPose {
  const b = gp.buttons;
  const trig = b[0];
  const sq = b[1];
  const index = trig && trig.value > 0.02 ? 0.35 + 0.65 * trig.value : 0;
  const grip = sq ? Math.max(sq.value, sq.pressed ? 1 : 0) : 0;
  const rest = grip > 0.02 ? 0.15 + 0.85 * grip : 0;
  let thumb = 0;
  for (const i of [3, 4, 5, 6]) if (b[i]?.pressed) thumb = 0.85;
  // A full squeeze reads as a fist (the thumb wraps over).
  if (grip > 0.8) thumb = Math.max(thumb, 0.9);
  return [thumb, index, rest, rest * 0.98, rest * 0.95];
}

/**
 * A point: index finger out, the other three curled (on a controller: grip
 * squeezed, finger off the trigger). The only pose that bets on a felt.
 */
export function isPointing(p: FingerPose): boolean {
  return p[1] < 0.35 && (p[2] + p[3] + p[4]) / 3 > 0.5;
}

/** All four fingers out: an open hand (not a point, not a fist). */
export function isOpenHand(p: FingerPose): boolean {
  return (p[1] + p[2] + p[3] + p[4]) / 4 < 0.3;
}

const FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'] as const;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** Curl of a chain of joints: the sum of the bend angles between consecutive bones. */
function chainCurl(joints: Record<string, THREE.Object3D | undefined>, names: string[], full: number): number | null {
  const pts: THREE.Vector3[] = [];
  for (const n of names) {
    const j = joints[n];
    if (!j || !j.visible) return null;
    pts.push(j.getWorldPosition(new THREE.Vector3()));
  }
  let sum = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    _a.subVectors(pts[i], pts[i - 1]);
    _b.subVectors(pts[i + 1], pts[i]);
    if (_a.lengthSq() < 1e-10 || _b.lengthSq() < 1e-10) continue;
    sum += _a.angleTo(_b);
  }
  return THREE.MathUtils.clamp(sum / full, 0, 1);
}

/** Pose from a tracked hand (three's XRHandSpace: a Group with `.joints`). Null if not tracked. */
export function handTrackPose(hand: THREE.Object3D & { joints?: Record<string, THREE.Object3D> }): FingerPose | null {
  const j = hand.joints;
  if (!j || !j['wrist'] || !j['wrist'].visible) return null;
  const out: number[] = [];
  const thumb = chainCurl(j, ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'], 1.4);
  out.push(thumb ?? 0.2);
  for (const f of FINGERS) {
    const c = chainCurl(j, [`${f}-metacarpal`, `${f}-phalanx-proximal`, `${f}-phalanx-intermediate`, `${f}-phalanx-distal`, `${f}-tip`], 4.0);
    out.push(c ?? 0.2);
  }
  return out as FingerPose;
}

/** Wrist position of a tracked hand (world), or null. */
export function handTrackWrist(hand: THREE.Object3D & { joints?: Record<string, THREE.Object3D> }): THREE.Vector3 | null {
  const w = hand.joints?.['wrist'];
  return w && w.visible ? w.getWorldPosition(new THREE.Vector3()) : null;
}

/** Packs a pose into 5 digits for the network ("08899"). */
export function packPose(p: FingerPose): string {
  return p.map((v) => Math.round(THREE.MathUtils.clamp(v, 0, 1) * 9)).join('');
}

export function unpackPose(s: unknown): FingerPose | null {
  if (typeof s !== 'string' || !/^[0-9]{5}$/.test(s)) return null;
  return [...s].map((c) => Number(c) / 9) as FingerPose;
}

/** Eases a displayed pose toward a target pose. */
export function blendPose(cur: FingerPose, target: FingerPose, k: number) {
  for (let i = 0; i < 5; i++) cur[i] += (target[i] - cur[i]) * k;
}
