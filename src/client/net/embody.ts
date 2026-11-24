import * as THREE from 'three';

/**
 * Making a friend's avatar move like them: arms that reach where their real
 * hands are (two-bone IK on the character's shoulder → elbow → wrist), and a
 * mouth that opens with their voice.
 */

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _qp = new THREE.Quaternion();

/** Turns `bone` (in world space) so the direction `from` becomes `to`. */
function rotateWorld(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
  if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
  _q.setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
  bone.getWorldQuaternion(_qw);
  _qw.premultiply(_q);
  if (bone.parent) {
    bone.parent.getWorldQuaternion(_qp);
    _qw.premultiply(_qp.invert());
  }
  bone.quaternion.copy(_qw).normalize();
  bone.updateMatrixWorld(true);
}

/**
 * Two-bone IK: bends `upper` and `lower` so `end` lands on `target` (world),
 * with the elbow pushed toward `pole` (a world point: below, behind and to the
 * side of the shoulder, as real elbows go). Blends by `weight` (0..1).
 */
export function reach(upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3, weight = 1): THREE.Vector3 | undefined {
  if (weight <= 0) return;
  const S = upper.getWorldPosition(new THREE.Vector3());
  const E = lower.getWorldPosition(new THREE.Vector3());
  const W = end.getWorldPosition(new THREE.Vector3());
  // Some rigs hang the foot off the root (an IK target), not off the shin: then
  // follow the shin's end point in the lower bone's frame, and return where it
  // ends up so the caller can move the end bone there.
  let attached = false;
  for (let o = end.parent; o; o = o.parent) if (o === lower) { attached = true; break; }
  lower.updateWorldMatrix(true, false);
  const endLocal = attached ? null : lower.worldToLocal(W.clone());
  const a = S.distanceTo(E),
    b = E.distanceTo(W);
  const T = W.clone().lerp(target, weight);
  const toT = _a.copy(T).sub(S);
  const d = THREE.MathUtils.clamp(toT.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const dir = toT.normalize();
  const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const toPole = _b.copy(pole).sub(S);
  const perp = _c.copy(toPole).addScaledVector(dir, -toPole.dot(dir));
  if (perp.lengthSq() < 1e-8) perp.set(0, -1, 0);
  perp.normalize();
  const E2 = S.clone().addScaledVector(dir, a * cosA).addScaledVector(perp, a * sinA);
  rotateWorld(upper, E.clone().sub(S), E2.clone().sub(S));
  const E3 = lower.getWorldPosition(new THREE.Vector3());
  const W3 = endLocal ? lower.localToWorld(endLocal.clone()) : end.getWorldPosition(new THREE.Vector3());
  rotateWorld(lower, W3.clone().sub(E3), T.clone().sub(E3));
  return endLocal ? lower.localToWorld(endLocal.clone()) : end.getWorldPosition(new THREE.Vector3());
}

/**
 * A simple mouth on the character's face (a dark rounded opening with lips)
 * attached to the head bone so it follows every nod. Scale it with `setOpen`.
 */
export function makeMouth(head: THREE.Object3D, root: THREE.Object3D, yaw: number, scale: number, skin?: THREE.SkinnedMesh | null): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, 0.022, 0.012, 0, Math.PI * 2, false, 0);
  const geo = new THREE.ShapeGeometry(shape, 16);
  const mat = new THREE.MeshBasicMaterial({ color: 0x3a0e10, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
  const mouth = new THREE.Mesh(geo, mat);
  mouth.raycast = () => {};
  // Place on the face in the rest pose, then keep it in the head bone's frame.
  root.updateMatrixWorld(true);
  const H = head.getWorldPosition(new THREE.Vector3());
  const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
  // The mouth sits ~7.5 cm above the head bone (which is at the base of the skull);
  // find the front of the face at that height from the character's own mesh.
  const up = 0.075 * scale;
  let front = 0.12 * scale;
  if (skin) {
    const pos = skin.geometry.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    let best = -1;
    for (let i = 0; i < pos.count; i++) {
      skin.getVertexPosition(i, v);
      v.applyMatrix4(skin.matrixWorld).sub(H);
      if (Math.abs(v.y - up) > 0.02 * scale || Math.abs(v.dot(right)) > 0.03 * scale) continue;
      best = Math.max(best, v.dot(fwd));
    }
    if (best > 0.04 && best < 0.25) front = best;
  }
  const world = H.clone().addScaledVector(fwd, front + 0.004).add(new THREE.Vector3(0, up, 0));
  const worldQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), fwd);
  head.add(mouth);
  mouth.position.copy(head.worldToLocal(world));
  const hq = head.getWorldQuaternion(new THREE.Quaternion()).invert();
  mouth.quaternion.copy(hq.multiply(worldQ));
  const hs = head.getWorldScale(new THREE.Vector3());
  mouth.scale.set(scale / hs.x, (scale * 0.25) / hs.y, scale / hs.z);
  mouth.userData.base = mouth.scale.clone();
  return mouth;
}

export function setOpen(mouth: THREE.Mesh, open: number) {
  const base = mouth.userData.base as THREE.Vector3;
  const k = THREE.MathUtils.clamp(open, 0, 1);
  mouth.scale.set(base.x * (1 - k * 0.15), base.y * (1 + k * 3.2), base.z);
}

/** Finger bend axis in the finger bones' local frame (Quaternius rig), and its sign per side. */
export const FINGER = { axis: 'x' as 'x' | 'y' | 'z', sign: { L: -1, R: -1 } };

/**
 * Curls a hand into a fist (amount 0 = open, 1 = closed). Applied on top of
 * the animation pose, every frame.
 */
export function curlFingers(bones: Record<string, THREE.Object3D>, side: 'L' | 'R', amount: number) {
  const k = THREE.MathUtils.clamp(amount, 0, 1) * FINGER.sign[side];
  const bend = (b: THREE.Object3D | undefined, a: number) => {
    if (!b) return;
    // The clips don't animate fingers: start from the rest pose every frame (no build-up).
    const rest = (b.userData.rest ??= b.quaternion.clone().normalize()) as THREE.Quaternion;
    b.quaternion.copy(rest);
    if (a === 0) return;
    if (FINGER.axis === 'x') b.rotateX(a);
    else if (FINGER.axis === 'y') b.rotateY(a);
    else b.rotateZ(a);
  };
  for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) for (const seg of [1, 2, 3]) bend(bones[`${f}${seg}${side}`], k * (seg === 1 ? 1.25 : 1.45));
  for (const seg of [1, 2, 3]) bend(bones[`Thumb${seg}${side}`], k * 0.6);
}

/** Thumb bend axis/sign (calibrated separately: the thumb sits rotated on the hand). */
export const THUMB = { axis: 'z' as 'x' | 'y' | 'z', sign: { L: 1, R: -1 }, scale: 1 };

/**
 * Poses each finger on its own: [thumb, index, middle, ring, pinky] curls 0..1
 * (see fingers.ts). Starts from each bone's rest pose every frame.
 */
export function setFingers(bones: Record<string, THREE.Object3D>, side: 'L' | 'R', pose: readonly number[]) {
  const bend = (b: THREE.Object3D | undefined, axis: 'x' | 'y' | 'z', a: number) => {
    if (!b) return;
    const rest = (b.userData.rest ??= b.quaternion.clone().normalize()) as THREE.Quaternion;
    b.quaternion.copy(rest);
    if (a === 0) return;
    if (axis === 'x') b.rotateX(a);
    else if (axis === 'y') b.rotateY(a);
    else b.rotateZ(a);
  };
  const names = ['Index', 'Middle', 'Ring', 'Pinky'];
  names.forEach((f, i) => {
    const c = THREE.MathUtils.clamp(pose[i + 1] ?? 0, 0, 1) * FINGER.sign[side];
    for (const seg of [1, 2, 3]) bend(bones[`${f}${seg}${side}`], FINGER.axis, c * (seg === 1 ? 1.15 : seg === 2 ? 1.3 : 0.85));
  });
  const t = THREE.MathUtils.clamp(pose[0] ?? 0, 0, 1) * THUMB.sign[side] * THUMB.scale;
  for (const seg of [1, 2, 3]) bend(bones[`Thumb${seg}${side}`], THUMB.axis, t * (seg === 1 ? 0.35 : 0.6));
}

/**
 * Turns a hand (the Wrist bone) so the fingers point along `fwd` and the palm
 * faces `palm` (world directions). Measured from the hand's own bones, so it
 * works for every character model. `PALM.sign` flips the palm normal per side.
 */
export const PALM = { sign: { L: 1, R: -1 } };
const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qw2 = new THREE.Quaternion();
const _qp2 = new THREE.Quaternion();

export function handFrame(bones: Record<string, THREE.Object3D>, side: 'L' | 'R'): { fwd: THREE.Vector3; palm: THREE.Vector3 } | null {
  const w = bones[`Wrist${side}`],
    m = bones[`Middle1${side}`],
    i = bones[`Index1${side}`],
    p = bones[`Pinky1${side}`];
  if (!w || !m || !i || !p) return null;
  const W = w.getWorldPosition(new THREE.Vector3());
  const fwd = m.getWorldPosition(new THREE.Vector3()).sub(W).normalize();
  const across = i.getWorldPosition(new THREE.Vector3()).sub(p.getWorldPosition(new THREE.Vector3()));
  const palm = new THREE.Vector3().crossVectors(fwd, across).normalize().multiplyScalar(PALM.sign[side]);
  return { fwd, palm };
}

export function orientHand(bones: Record<string, THREE.Object3D>, side: 'L' | 'R', fwd: THREE.Vector3, palm: THREE.Vector3, weight = 1) {
  const wrist = bones[`Wrist${side}`];
  const cur = handFrame(bones, side);
  if (!wrist || !cur) return;
  const basis = (f: THREE.Vector3, n: THREE.Vector3, out: THREE.Matrix4) => {
    const z = f.clone().normalize();
    const x = n.clone().addScaledVector(z, -n.dot(z)).normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    return out.makeBasis(x, y, z);
  };
  _qa.setFromRotationMatrix(basis(fwd, palm, _m1));
  _qb.setFromRotationMatrix(basis(cur.fwd, cur.palm, _m2));
  const delta = _qa.multiply(_qb.invert());
  if (weight < 1) delta.slerp(new THREE.Quaternion(), 1 - weight);
  wrist.getWorldQuaternion(_qw2);
  _qw2.premultiply(delta);
  if (wrist.parent) {
    wrist.parent.getWorldQuaternion(_qp2);
    _qw2.premultiply(_qp2.invert());
  }
  wrist.quaternion.copy(_qw2).normalize();
  wrist.updateMatrixWorld(true);
}
