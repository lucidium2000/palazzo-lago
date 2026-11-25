import * as THREE from 'three';
import { reach, rotateWorld } from './net/embody';

/**
 * Sitting poses shared by the guests (people.ts), your own VR body
 * (selfbody.ts) and your friend's avatar: legs placed by IK so they work for
 * every character model, whatever its leg bones' local axes.
 */

/** Hips sit this far below the seat's top (the bone is inside the pelvis, the cushion gives). */
export const HIP_BELOW_SEAT = 0.05;

/** Hip height for sitting on a seat whose top is at `seatTop`. */
export const hipOnSeat = (seatTop: number) => seatTop - HIP_BELOW_SEAT;

type Bones = Record<string, THREE.Object3D | undefined>;

/**
 * Seated legs: thighs along the seat, knees forward (a touch apart), shins
 * hanging down to the floor at `floorY` (or as far as they reach on a tall
 * stool). Call after the animation mixer, with the rig's root already placed
 * and its world matrices current. `k` blends from the animated legs (0) to
 * seated (1).
 */
export function sitLegs(b: Bones, yaw: number, floorY: number, k = 1) {
  const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const left = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  for (const [s, dir] of [
    ['L', 1],
    ['R', -1],
  ] as const) {
    const upper = b[`UpperLeg${s}`],
      lower = b[`LowerLeg${s}`],
      foot = b[`Foot${s}`];
    if (!upper || !lower || !foot) continue;
    // The clips don't move a root-parented foot: start from its standing spot each frame.
    const rest = (foot.userData.restPos ??= foot.position.clone()) as THREE.Vector3;
    foot.position.copy(rest);
    foot.updateMatrixWorld(true);
    const hip = upper.getWorldPosition(new THREE.Vector3());
    const knee = lower.getWorldPosition(new THREE.Vector3());
    const ankle = foot.getWorldPosition(new THREE.Vector3());
    const thigh = hip.distanceTo(knee),
      shin = knee.distanceTo(ankle);
    // Knee straight ahead of the hip (a touch apart), shin hanging down to the floor.
    const kneeAt = hip.clone().addScaledVector(fwd, thigh * 0.96).addScaledVector(left, 0.04 * dir);
    const footY = Math.max(floorY + 0.09, kneeAt.y - shin * 0.98);
    const drop = Math.min(shin * 0.98, kneeAt.y - footY);
    const ahead = Math.sqrt(Math.max(0, shin * shin * 0.96 - drop * drop));
    const target = new THREE.Vector3(kneeAt.x, footY, kneeAt.z).addScaledVector(fwd, ahead + 0.03);
    const pole = hip.clone().addScaledVector(fwd, 1).add(new THREE.Vector3(0, 0.25, 0));
    const end = reach(upper, lower, foot, target, pole, k);
    if (end && foot.parent && foot.parent !== lower) {
      // Foot bone hangs off the root: carry it to the shin's end, flat on the floor.
      foot.parent.updateWorldMatrix(true, false);
      foot.position.copy(foot.parent.worldToLocal(end));
      foot.updateMatrixWorld(true);
    }
  }
}

/** Puts root-parented feet back under a rig that sat before. */
export function standLegs(b: Bones) {
  for (const s of ['L', 'R']) {
    const f = b[`Foot${s}`],
      r = f?.userData.restPos as THREE.Vector3 | undefined;
    if (f && r && !f.position.equals(r)) {
      f.position.copy(r);
      f.updateMatrixWorld(true);
    }
  }
}

/**
 * Leans the torso from the hips toward a point (your real head when you sit in
 * VR but stand or lean in real life): turns the spine so the neck points at
 * it, at most `max` radians.
 */
export function leanToward(b: Bones, target: THREE.Vector3, max = 0.6, k = 1) {
  // The lowest spine bone (rigs name it differently).
  const spine = b.Abdomen ?? b.Spine ?? b.Spine1 ?? b.Torso,
    neck = b.Neck ?? b.Head;
  if (!spine || !neck || k <= 0) return;
  const base = spine.getWorldPosition(new THREE.Vector3());
  const from = neck.getWorldPosition(new THREE.Vector3()).sub(base);
  const to = target.clone().sub(base);
  if (from.lengthSq() < 1e-6 || to.lengthSq() < 1e-6) return;
  from.normalize();
  to.normalize();
  const ang = Math.min(max, from.angleTo(to)) * k;
  if (ang < 1e-3) return;
  const axis = new THREE.Vector3().crossVectors(from, to);
  if (axis.lengthSq() < 1e-10) return;
  axis.normalize();
  rotateWorld(spine, from, from.clone().applyAxisAngle(axis, ang));
}
