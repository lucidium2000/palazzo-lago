import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DIE, faceFix, FACE_NORMALS, simulateThrow } from '../src/client/craps/dicesim';

const bed = { hx: 1.6, hz: 0.58 };
const from = new THREE.Vector3(1.0, 0.25, 0.4);

describe('dice throw simulation', () => {
  const plans = Array.from({ length: 30 }, (_, i) => simulateThrow({ bed, seed: i + 1, from }));

  it('settles in a few seconds, flat on the felt, inside the tub', () => {
    for (const p of plans) {
      expect(p.duration).toBeGreaterThan(0.8);
      expect(p.duration).toBeLessThan(9);
      const last = p.frames.at(-1)!;
      for (const d of last) {
        expect(d.p.y).toBeCloseTo(DIE / 2, 6);
        expect(Math.abs(d.p.x)).toBeLessThanOrEqual(bed.hx);
        expect(Math.abs(d.p.z)).toBeLessThanOrEqual(bed.hz);
      }
      for (const [i, d] of last.entries()) {
        const up = p.upLocal[i].clone().applyQuaternion(d.q);
        expect(up.y).toBeCloseTo(1, 6);
      }
    }
  });

  it('usually reaches the back wall and makes noise', () => {
    expect(plans.filter((p) => p.hitBackWall).length).toBeGreaterThan(20);
    for (const p of plans) expect(p.hits.length).toBeGreaterThan(2);
  });

  it('can show any number on top without changing the motion', () => {
    const p = plans[0];
    const last = p.frames.at(-1)!;
    for (let v = 1; v <= 6; v++) {
      const visual = last[0].q.clone().multiply(faceFix(p.upLocal[0], v));
      const shown = FACE_NORMALS[v].clone().applyQuaternion(visual);
      expect(shown.y).toBeCloseTo(1, 6);
    }
  });
});
