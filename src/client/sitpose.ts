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

/**
 * Lying back on a sun lounger: the body (rig root) is already reclined; the
 * legs stretch out along the seat ahead of the hips, knees a touch bent and
 * apart, heels resting on the cushion at `restY`. Same IK as sitting.
 */
export function lieLegs(b: Bones, yaw: number, restY: number, k = 1) {
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
    const rest = (foot.userData.restPos ??= foot.position.clone()) as THREE.Vector3;
    foot.position.copy(rest);
    foot.updateMatrixWorld(true);
    const hip = upper.getWorldPosition(new THREE.Vector3());
    const knee = lower.getWorldPosition(new THREE.Vector3());
    const ankle = foot.getWorldPosition(new THREE.Vector3());
    const len = hip.distanceTo(knee) + knee.distanceTo(ankle);
    // Heels on the cushion, nearly straight out, a little apart (one knee up a bit more).
    const reachK = dir > 0 ? 0.95 : 0.9;
    const target = hip.clone().addScaledVector(fwd, len * reachK).addScaledVector(left, 0.07 * dir);
    target.y = restY + 0.06;
    const pole = hip.clone().addScaledVector(fwd, len * 0.5).add(new THREE.Vector3(0, 1, 0));
    const end = reach(upper, lower, foot, target, pole, k);
    if (end && foot.parent && foot.parent !== lower) {
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

/**
 * Crouching: lowers the body (rig root) by `drop` metres and bends the knees so
 * the feet stay where the animation put them (planted on the floor, or mid-step
 * when walking), knees forward. Call after the
 * animation mixer, with the rig's root placed and its world matrices current.
 * `moving`: walking (the ankle's place in the shin is only learnt standing still).
 */
export function crouchLegs(root: THREE.Object3D, b: Bones, yaw: number, drop: number, moving = false) {
  if (drop <= 0.005) return standLegs(b);
  const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const legs = [
    [b.UpperLegL, b.LowerLegL, b.FootL],
    [b.UpperLegR, b.LowerLegR, b.FootR],
  ] as const;
  // Where each ankle is in the animation (the end of the shin, in the shin's own frame).
  const ankles = legs.map(([upper, lower, foot]) => {
    if (!upper || !lower || !foot) return null;
    // The clips don't move a root-parented foot: start from its standing spot (as sitLegs does).
    const rest = (foot.userData.restPos ??= foot.position.clone()) as THREE.Vector3;
    foot.position.copy(rest);
    foot.updateMatrixWorld(true);
    const ud = lower.userData as { shinEnd?: THREE.Vector3 };
    if (!ud.shinEnd && !moving) ud.shinEnd = lower.worldToLocal(foot.getWorldPosition(new THREE.Vector3()));
    return ud.shinEnd ? lower.localToWorld(ud.shinEnd.clone()) : foot.getWorldPosition(new THREE.Vector3());
  });
  root.position.y -= drop;
  root.updateMatrixWorld(true);
  legs.forEach(([upper, lower, foot], i) => {
    const at = ankles[i];
    if (!upper || !lower || !foot || !at) return;
    const shinEnd = lower.userData.shinEnd as THREE.Vector3 | undefined;
    if (shinEnd && foot.parent && foot.parent !== lower) {
      // Put the (root-parented) foot at the shin's end, so the IK measures the real shin.
      foot.parent.updateWorldMatrix(true, false);
      foot.position.copy(foot.parent.worldToLocal(lower.localToWorld(shinEnd.clone())));
      foot.updateMatrixWorld(true);
    }
    const hip = upper.getWorldPosition(new THREE.Vector3());
    const pole = hip.clone().addScaledVector(fwd, 1).add(new THREE.Vector3(0, 0.2, 0));
    const end = reach(upper, lower, foot, at, pole, 1);
    if (end && foot.parent && foot.parent !== lower) {
      foot.parent.updateWorldMatrix(true, false);
      foot.position.copy(foot.parent.worldToLocal(end));
      foot.updateMatrixWorld(true);
    }
  });
  root.updateMatrixWorld(true);
}

