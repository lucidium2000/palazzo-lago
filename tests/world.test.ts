import { describe, expect, it } from 'vitest';
import { World } from '../src/client/world';

function hall() {
  const w = new World();
  w.addWalkable(-10, 10, -10, 10);
  w.addWalkable(-1, 1, -12, -9.5); // doorway
  w.addWalkable(-5, 5, -15, -11.5); // terrace
  w.addCircle(0, 0, 0.5);
  w.addBox(5, 5, 2, 1, Math.PI / 4);
  w.addSurface('carpet', -10, -5, -10, 10);
  return w;
}

describe('World', () => {
  it('stops at walls and slides along them', () => {
    const w = hall();
    const [x, z] = w.move(9.6, 0, 1, 0.5, 0.25);
    expect(x).toBeLessThanOrEqual(9.75 + 1e-9);
    expect(z).toBeCloseTo(0.5, 5);
  });

  it('pushes out of a column', () => {
    const w = hall();
    const [x, z] = w.move(-1, 0, 0.9, 0, 0.25);
    expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(0.75 - 1e-6);
  });

  it('keeps bodies out of a rotated table', () => {
    const w = hall();
    expect(w.isFree(5, 5)).toBe(false);
    expect(w.isFree(5 + 2, 5)).toBe(true);
    const [x, z] = w.move(3.5, 3.5, 1.2, 1.2, 0.25);
    expect(w.isFree(x, z, 0.24)).toBe(true);
  });

  it('lets you walk through the doorway onto the terrace but not through the wall', () => {
    const w = hall();
    let x = 0,
      z = -9;
    for (let i = 0; i < 55; i++) [x, z] = w.move(x, z, 0, -0.1, 0.25);
    expect(z).toBeLessThan(-13);
    let x2 = 4,
      z2 = -9;
    for (let i = 0; i < 40; i++) [x2, z2] = w.move(x2, z2, 0, -0.1, 0.25);
    expect(z2).toBeGreaterThan(-10);
  });

  it('reports floor surfaces', () => {
    const w = hall();
    expect(w.surfaceAt(-7, 0)).toBe('carpet');
    expect(w.surfaceAt(3, 0)).toBe('marble');
  });
});
