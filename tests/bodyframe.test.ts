import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bodyYaw, neckPivot } from '../src/client/bodyframe';

/** The headset's forward and up after turning to `yaw` and pitching by `pitch` (radians, + up). */
function head(yaw: number, pitch: number) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  return { dir: new THREE.Vector3(0, 0, -1).applyQuaternion(q), up: new THREE.Vector3(0, 1, 0).applyQuaternion(q) };
}
/** Person-convention yaw of the headset facing at `yaw` (forward is -z at yaw 0). */
const facing = (yaw: number) => Math.atan2(-Math.sin(yaw), -Math.cos(yaw));
const angle = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

describe('body facing from the headset', () => {
  it('follows where you look when level', () => {
    for (const y of [0, 0.7, -1.9, 3]) {
      const h = head(y, 0);
      expect(angle(bodyYaw(h.dir, h.up), facing(y))).toBeLessThan(1e-6);
    }
  });

  it('stays facing forward looking down, straight down and past it', () => {
    for (const y of [0, 1.2, -2.5]) {
      for (const p of [-0.6, -1.3, -Math.PI / 2, -1.75]) {
        const h = head(y, p);
        expect(angle(bodyYaw(h.dir, h.up), facing(y))).toBeLessThan(0.05);
      }
    }
  });

  it('stays facing forward looking up', () => {
    for (const p of [0.6, 1.3, Math.PI / 2]) {
      const h = head(0.4, p);
      expect(angle(bodyYaw(h.dir, h.up), facing(0.4))).toBeLessThan(0.05);
    }
  });
});

describe('neck pivot', () => {
  it('sits behind and below the eyes when level', () => {
    const h = head(0, 0);
    const n = neckPivot({ x: 0, y: 1.7, z: 0 }, h.dir, h.up);
    expect(n.z).toBeCloseTo(0.09, 5); // behind (forward is -z)
    expect(n.y).toBeCloseTo(1.6, 5);
  });

  it('barely moves as you nod (the eyes swing round it)', () => {
    // Rotating the head about a fixed neck: the eyes move, the computed pivot doesn't.
    const neck = new THREE.Vector3(0.3, 1.6, -0.2);
    for (const p of [0, -0.5, -1.2, -Math.PI / 2]) {
      const h = head(0.8, p);
      const eyes = neck.clone().addScaledVector(h.dir, 0.09).addScaledVector(h.up, 0.1);
      const n = neckPivot(eyes, h.dir, h.up);
      expect(Math.hypot(n.x - neck.x, n.y - neck.y, n.z - neck.z)).toBeLessThan(1e-9);
    }
  });
});
