// Rig helpers for build-fight-anims.mjs: loads a glTF skeleton into three.js
// objects (in Node, no renderer), samples its clips, and poses the Quaternius
// "Ultimate Modular" rig (the one every person in the casino uses).
import * as THREE from 'three';

/** A glTF document's node tree as three.js objects, by name. */
export function treeOf(doc) {
  const root = new THREE.Group();
  const byName = new Map();
  const of = new Map();
  const make = (n, parent) => {
    const o = new THREE.Object3D();
    o.name = n.getName();
    o.position.fromArray(n.getTranslation());
    o.quaternion.fromArray(n.getRotation());
    o.scale.fromArray(n.getScale());
    o.userData.rest = { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() };
    parent.add(o);
    byName.set(o.name, o);
    of.set(n, o);
    for (const c of n.listChildren()) make(c, o);
  };
  for (const s of doc.getRoot().listScenes()) for (const n of s.listChildren()) make(n, root);
  root.updateMatrixWorld(true);
  return { root, byName, of };
}

/** Samples a glTF animation (linear / step) onto a tree at time t. */
export function sampleAnim(tree, anim, t) {
  for (const ch of anim.listChannels()) {
    const o = tree.of.get(ch.getTargetNode());
    if (!o) continue;
    const s = ch.getSampler();
    const inp = s.getInput().getArray();
    const out = s.getOutput().getArray();
    const path = ch.getTargetPath();
    const k = path === 'rotation' ? 4 : 3;
    let i = 0;
    while (i < inp.length - 1 && inp[i + 1] <= t) i++;
    const j = Math.min(inp.length - 1, i + 1);
    const f = s.getInterpolation() === 'STEP' || j === i ? 0 : THREE.MathUtils.clamp((t - inp[i]) / (inp[j] - inp[i]), 0, 1);
    if (path === 'rotation') {
      const a = new THREE.Quaternion().fromArray(out, i * k),
        b = new THREE.Quaternion().fromArray(out, j * k);
      o.quaternion.copy(a.slerp(b, f));
    } else if (path === 'translation' || path === 'scale') {
      const a = new THREE.Vector3().fromArray(out, i * k),
        b = new THREE.Vector3().fromArray(out, j * k);
      (path === 'translation' ? o.position : o.scale).copy(a.lerp(b, f));
    }
  }
  tree.root.updateMatrixWorld(true);
}

export const animLength = (anim) => Math.max(...anim.listChannels().map((c) => c.getSampler().getInput().getMax([])[0]));

export const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion());
export const wp = (o) => o.getWorldPosition(new THREE.Vector3());

/** Sets a bone's world rotation (keeps its parent). */
export function setWorldQ(o, q) {
  const pq = o.parent ? wq(o.parent) : new THREE.Quaternion();
  o.quaternion.copy(pq.invert().multiply(q));
  o.updateMatrixWorld(true);
}

/** Rotates a bone in world space by q (about its own joint). */
export function rotWorld(o, q) {
  setWorldQ(o, q.clone().multiply(wq(o)));
}

/** Turns a bone (shortest arc) so the direction from its joint to `tip` (a world point it carries) becomes `dir`. */
export function aimAt(o, tip, dir) {
  const from = tip.clone().sub(wp(o)).normalize();
  rotWorld(o, new THREE.Quaternion().setFromUnitVectors(from, dir.clone().normalize()));
}

/**
 * Two-bone IK (offline, for authoring and retargeting): puts the end point
 * (`endLocal`, in the lower bone's frame) at `target` with the middle joint
 * toward `pole`.
 */
export function twoBone(upper, lower, endLocal, target, pole) {
  upper.updateMatrixWorld(true);
  const S = wp(upper);
  const E = wp(lower);
  const W = lower.localToWorld(endLocal.clone());
  const a = S.distanceTo(E),
    b = E.distanceTo(W);
  const toT = target.clone().sub(S);
  const d = THREE.MathUtils.clamp(toT.length(), Math.abs(a - b) + 1e-4, a + b - 1e-4);
  const dir = toT.normalize();
  const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const toP = pole.clone().sub(S);
  const perp = toP.addScaledVector(dir, -toP.dot(dir));
  if (perp.lengthSq() < 1e-10) perp.set(0, 0, 1);
  perp.normalize();
  const E2 = S.clone().addScaledVector(dir, a * cosA).addScaledVector(perp, a * sinA);
  rotWorld(upper, new THREE.Quaternion().setFromUnitVectors(E.clone().sub(S).normalize(), E2.clone().sub(S).normalize()));
  const E3 = wp(lower);
  const W3 = lower.localToWorld(endLocal.clone());
  rotWorld(lower, new THREE.Quaternion().setFromUnitVectors(W3.sub(E3).normalize(), target.clone().sub(E3).normalize()));
  return lower.localToWorld(endLocal.clone());
}
