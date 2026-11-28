import { describe, expect, it } from 'vitest';
import { lagoCounter, ROUND_TOP, roundCounter } from '../src/client/barcounter';

const BAR = { x: 28.5, z: -26, r: 2.1 };

describe('bar counters', () => {
  it("Bar Lago keeps its old places (pour, serve, taps, the bartender's spot)", () => {
    const c = lagoCounter();
    expect(c.clamp(0)).toBeCloseTo(6.6);
    expect(c.clamp(20)).toBeCloseTo(12.0);
    expect(c.serveAt(9).toArray()).toEqual([-15 + 0.32, 1.1, 9]);
    expect(c.serveAt(9, true).x).toBeCloseTo(-14.72);
    expect(c.pourAt(9).x).toBeCloseTo(-15.2);
    expect(c.tapSpot).toBe(11.6);
    expect(c.workAt(8)).toEqual({ x: -16, z: 8, yaw: Math.PI / 2 });
    expect(c.near(-14, 9)).toBe(true);
    expect(c.near(-16, 9)).toBe(false);
  });

  it('the pool bar: spots go round the ring; drinks are served on its top, guests outside, the bartender inside', () => {
    const c = roundCounter('pool', BAR);
    for (const a of [0, 1, 2.5, -2, Math.PI / 2]) {
      const serve = c.serveAt(a);
      const r = Math.hypot(serve.x - BAR.x, serve.z - BAR.z);
      expect(r).toBeGreaterThan(ROUND_TOP.inner);
      expect(r).toBeLessThan(ROUND_TOP.outer);
      expect(serve.y).toBe(ROUND_TOP.y);
      // Served where you stand: the spot of the place it's served is the spot you asked for.
      expect(c.spotAt(serve.x, serve.z)).toBeCloseTo(c.clamp(a));
      const pour = c.pourAt(a);
      expect(Math.hypot(pour.x - BAR.x, pour.z - BAR.z)).toBeLessThan(r);
      const w = c.workAt(a);
      const wr = Math.hypot(w.x - BAR.x, w.z - BAR.z);
      expect(wr).toBeGreaterThan(0.9); // clear of the central column
      expect(wr).toBeLessThan(ROUND_TOP.inner);
      // She faces out, toward the guest at that spot.
      expect(Math.sin(w.yaw)).toBeCloseTo(Math.cos(a));
      expect(Math.cos(w.yaw)).toBeCloseTo(Math.sin(a));
    }
  });

  it("the pool bar: you're at the counter standing just outside it, anywhere round", () => {
    const c = roundCounter('pool', BAR);
    expect(c.near(BAR.x + 2.6, BAR.z)).toBe(true);
    expect(c.near(BAR.x, BAR.z - 2.7)).toBe(true);
    expect(c.near(BAR.x + 1.2, BAR.z)).toBe(false); // behind it
    expect(c.near(BAR.x + 5, BAR.z)).toBe(false); // across the deck
    expect(c.gap(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2 * (ROUND_TOP.outer - 0.2));
  });
});
