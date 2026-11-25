import * as THREE from 'three';
import { orientHand, reach } from './net/embody';
import type { Person } from './people';

/**
 * Hand gestures for guests and dealers at the games: put a hand on a world
 * point (two-bone IK on the character's arm), blended in and out by a weight.
 * Called from a person's `onPose`, after the animation clip has posed them.
 */

const S = new THREE.Vector3();
const pole = new THREE.Vector3();
const fwd = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

export function handTo(p: Person, side: 'L' | 'R', target: THREE.Vector3, weight: number, palm: THREE.Vector3 = DOWN) {
  const b = p.rig?.bones;
  if (!b || weight <= 0.001) return;
  const up = b['UpperArm' + side],
    lo = b['LowerArm' + side],
    wr = b['Wrist' + side];
  if (!up || !lo || !wr) return;
  const w = Math.min(1, weight);
  const s = side === 'R' ? 1 : -1;
  up.getWorldPosition(S);
  // Elbow below, behind and out to the side of the shoulder.
  const rx = -Math.cos(p.yaw) * s,
    rz = Math.sin(p.yaw) * s;
  pole.set(S.x + rx * 0.35 - Math.sin(p.yaw) * 0.3, S.y - 0.6, S.z + rz * 0.35 - Math.cos(p.yaw) * 0.3);
  reach(up, lo, wr, target, pole, w);
  // Hand pointing from the elbow on through the target, palm down.
  lo.getWorldPosition(fwd);
  fwd.subVectors(target, fwd);
  fwd.y *= 0.3;
  if (fwd.lengthSq() > 1e-6) orientHand(b, side, fwd, palm, w * 0.8);
}

/** 0 → 1 → 0 over [t0, t1], eased: how much of a gesture shows at `t`. */
export function envelope(t: number, t0: number, t1: number, ramp = 0.25): number {
  if (t <= t0 || t >= t1) return 0;
  const r = Math.min(ramp, (t1 - t0) / 2);
  const k = Math.min(1, (t - t0) / r, (t1 - t) / r);
  return k * k * (3 - 2 * k);
}
