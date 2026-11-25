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
export function rotateWorld(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
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

/** Mouth part sizes (metres at a 1.8 m figure) and how they change as the jaw opens. */
export const MOUTH = {
  lips: { rx: 0.022, ry: 0.0075, color: 0x9a5a52 },
  inner: { rx: 0.0185, ry: 0.006, color: 0x240808 },
  teeth: { w: 0.024, h: 0.0035, y: 0.0045, color: 0xeee8dc },
};

/** Where each mouth part sits and how it's scaled for an opening of k (0..1). */
export function mouthShape(k: number) {
  k = THREE.MathUtils.clamp(k, 0, 1);
  return {
    // Lips stretch taller and a little narrower as the jaw drops.
    lips: { sx: 1 - k * 0.18, sy: 1 + k * 1.3, y: -k * 0.004 },
    // Closed: a thin dark seam between the lips; open: a dark rounded mouth.
    inner: { sx: 1 - k * 0.22, sy: 0.12 + k * 1.9, y: -k * 0.005 },
    teeth: { visible: k > 0.25, sx: 1 - k * 0.2 },
  };
}

/**
 * The mouth's place on a face profile: `prof` maps each centimetre of height
 * (relative to the head bone, for a 1.8 m figure) to how far forward the face
 * is there. The lips sit between the chin and the tip of the nose, on the
 * most forward part of the face at that height. Null if no nose was found.
 */
export function profileMouth(prof: Map<number, number>): { up: number; front: number } | null {
  // Nose tip: the most forward point between the head bone and 10 cm up.
  let nose = -1,
    noseZ = 0;
  for (const [k, z] of prof) if (k >= 0 && k <= 10 && z > noseZ) (nose = k), (noseZ = z);
  // Chin: the lowest point below the nose that's still the front of the face.
  let chin = nose;
  for (const [k, z] of prof) if (k < chin && k >= -5 && z > noseZ - 0.04) chin = k;
  if (!(nose > 0 && noseZ > 0.06)) return null;
  const mk = chin + (nose - chin) * 0.45;
  const near = [Math.floor(mk) - 1, Math.floor(mk), Math.ceil(mk), Math.ceil(mk) + 1].map((k) => prof.get(k) ?? -1).filter((z) => z > 0.05);
  return { up: mk / 100, front: near.length ? Math.max(...near) : 0.11 };
}

let mouthMats: { lips: THREE.Material; inner: THREE.Material; teeth: THREE.Material } | null = null;

/**
 * A mouth on the character's face (lips, a dark opening, a hint of teeth),
 * attached to the head bone so it follows every nod. It sits where the
 * character's own mouth is: found from the face's profile (between the chin
 * and the tip of the nose). Open it with `setOpen`. (Guests near you get
 * their mouths from faces.ts instead: one instanced draw for everybody.)
 */
export function makeMouth(head: THREE.Object3D, root: THREE.Object3D, yaw: number, scale: number, skin?: THREE.SkinnedMesh | null): THREE.Object3D {
  const mouth = new THREE.Group();
  const mat = (color: number, offset: number) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset });
  // Shared by every mouth made here.
  mouthMats ??= { lips: mat(MOUTH.lips.color, -4), inner: mat(MOUTH.inner.color, -5), teeth: mat(MOUTH.teeth.color, -6) };
  const flat = (shape: THREE.Shape, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape, 18), m);
    mesh.raycast = () => {};
    return mesh;
  };
  const ellipse = (rx: number, ry: number) => {
    const sh = new THREE.Shape();
    sh.absellipse(0, 0, rx, ry, 0, Math.PI * 2, false, 0);
    return sh;
  };
  // Full lips with a closed seam: the dark opening is a thin line until the jaw drops.
  const lips = flat(ellipse(MOUTH.lips.rx, MOUTH.lips.ry), mouthMats.lips);
  const inner = flat(ellipse(MOUTH.inner.rx, MOUTH.inner.ry), mouthMats.inner);
  inner.position.z = 0.0003;
  const T = MOUTH.teeth;
  const teethShape = new THREE.Shape();
  teethShape.moveTo(-T.w / 2, 0);
  teethShape.lineTo(T.w / 2, 0);
  teethShape.lineTo(T.w / 2 - 0.001, -T.h);
  teethShape.lineTo(-T.w / 2 + 0.001, -T.h);
  teethShape.closePath();
  const teeth = flat(teethShape, mouthMats.teeth);
  teeth.position.set(0, T.y, 0.0004);
  mouth.add(inner, lips, teeth);
  mouth.userData.parts = { lips, inner, teeth };

  root.updateMatrixWorld(true);
  const H = head.getWorldPosition(new THREE.Vector3());
  const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
  let up = 0.022 * scale;
  let front = 0.11 * scale;
  if (skin) {
    // The face's profile near the centre line, per centimetre of height.
    const pos = skin.geometry.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const prof = new Map<number, number>();
    for (let i = 0; i < pos.count; i++) {
      skin.getVertexPosition(i, v);
      v.applyMatrix4(skin.matrixWorld).sub(H);
      if (Math.abs(v.dot(right)) > 0.025 * scale) continue;
      const y = v.y / scale;
      if (y < -0.06 || y > 0.12) continue;
      const k = Math.round(y * 100);
      prof.set(k, Math.max(prof.get(k) ?? -1, v.dot(fwd) / scale));
    }
    const m = profileMouth(prof);
    if (m) {
      up = m.up * scale;
      front = m.front * scale;
    }
  }
  const world = H.clone().addScaledVector(fwd, front + 0.005 * scale).add(new THREE.Vector3(0, up, 0));
  const worldQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), fwd);
  head.add(mouth);
  mouth.position.copy(head.worldToLocal(world));
  const hq = head.getWorldQuaternion(new THREE.Quaternion()).invert();
  mouth.quaternion.copy(hq.multiply(worldQ));
  const hs = head.getWorldScale(new THREE.Vector3());
  mouth.scale.set(scale / hs.x, scale / hs.y, scale / hs.z);
  setOpen(mouth, 0);
  return mouth;
}

/**
 * Opens the mouth (0 closed … 1 wide). Small values part the lips; louder
 * sound opens the jaw (the opening grows taller and rounder, the teeth show).
 */
export function setOpen(mouth: THREE.Object3D, open: number) {
  const parts = mouth.userData.parts as { lips: THREE.Mesh; inner: THREE.Mesh; teeth: THREE.Mesh } | undefined;
  if (!parts) return;
  const s = mouthShape(open);
  parts.lips.scale.set(s.lips.sx, s.lips.sy, 1);
  parts.lips.position.y = s.lips.y;
  parts.inner.scale.set(s.inner.sx, s.inner.sy, 1);
  parts.inner.position.y = s.inner.y;
  parts.teeth.visible = s.teeth.visible;
  parts.teeth.scale.set(s.teeth.sx, 1, 1);
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
