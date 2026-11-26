import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
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

describe('World seats (stools)', () => {
  function bar() {
    const w = new World();
    w.addWalkable(-10, 10, -10, 10);
    w.addBox(0, 0, 4, 0.8, 0, 'bar'); // a counter along x, z -0.4..0.4
    w.addSeat(0, 1.0, 0.26, 0.8, Math.PI, 'bar stool');
    w.addSeat(1.2, 1.0, 0.26, 0.8, Math.PI, 'bar stool');
    return w;
  }

  it('lets you walk straight over a stool', () => {
    const w = bar();
    let x = -1,
      z = 1.0;
    for (let i = 0; i < 20; i++) [x, z] = w.move(x, z, 0.1, 0, 0.25);
    expect(x).toBeCloseTo(1, 5);
    expect(z).toBeCloseTo(1.0, 5);
  });

  it('is an obstacle for walking guests (seats: true)', () => {
    const w = bar();
    expect(w.isFree(0, 1.0, 0.22)).toBe(true);
    expect(w.isFree(0, 1.0, 0.22, true)).toBe(false);
    let x = -1,
      z = 1.0;
    for (let i = 0; i < 20; i++) [x, z] = w.move(x, z, 0.1, 0, 0.22, true);
    // Never closer to the stool's centre than its solid radius plus the body.
    expect(Math.hypot(x - 0, z - 1.0)).toBeGreaterThanOrEqual(0.42 - 1e-6);
    expect(w.settle(0, 1.0, 0.22, true)).not.toBeNull();
    const [sx, sz] = w.settle(0, 1.0, 0.22, true)!;
    expect(Math.hypot(sx, sz - 1)).toBeGreaterThanOrEqual(0.42 - 1e-6);
  });

  it('finds the seat under you, nearest first, with a margin to stay seated', () => {
    const w = bar();
    expect(w.seatAt(0.05, 1.05)?.x).toBe(0);
    expect(w.seatAt(1.1, 0.95)?.x).toBe(1.2);
    expect(w.seatAt(0.6, 1.0)).toBeNull();
    // Just past the edge: off it when arriving, still on it when already seated.
    expect(w.seatAt(0.3, 1.0)).toBeNull();
    expect(w.seatAt(0.3, 1.0, 0.08)?.x).toBe(0);
    expect(w.seatAt(0, 1.0)?.y).toBe(0.8);
  });

  it('still stops you at the counter beside the stools', () => {
    const w = bar();
    let x = 0,
      z = 1.0;
    for (let i = 0; i < 20; i++) [x, z] = w.move(x, z, 0, -0.1, 0.25);
    expect(z).toBeGreaterThanOrEqual(0.4 + 0.25 - 1e-6);
  });

  it('places seats and boxes in an object frame (rotation included)', () => {
    const w = new World();
    w.addWalkable(-10, 10, -10, 10);
    const g = new THREE.Group();
    g.position.set(3, 0, 2);
    g.rotation.y = Math.PI / 2;
    w.addLocalSeat(g, 0, 0.78, 0.26, 0.7, Math.PI, 'slot stool');
    w.addLocalBox(g, 0, 0, 0.7, 0.6, 'slot machine');
    const s = w.seats[0];
    // Local +Z turns to world +X.
    expect(s.x).toBeCloseTo(3.78, 5);
    expect(s.z).toBeCloseTo(2, 5);
    // Facing the machine: from the stool toward the cabinet (world −X).
    expect(Math.sin(s.yaw!)).toBeCloseTo(-1, 5);
    expect(w.isFree(3, 2, 0.1)).toBe(false);
    expect(w.isFree(3.78, 2, 0.25)).toBe(true);
    expect(w.counts()).toEqual({ 'slot machine': 1, 'seat:slot stool': 1 });
  });
});

describe('World furniture you walk onto (bed, loungers)', () => {
  function room() {
    const w = new World();
    w.addWalkable(-10, 10, -10, 10);
    w.addFurniture(0, 0, 2.4, 2.2, 0, 'bed');
    for (const x of [-0.55, 0.55]) for (const z of [-0.5, 0.5]) w.addSeat(x, z, 0.58, 0.6, null, 'bed');
    return w;
  }

  it('lets you walk onto it, and sits you down there', () => {
    const w = room();
    let x = -3,
      z = 0.4;
    for (let i = 0; i < 30; i++) [x, z] = w.move(x, z, 0.1, 0, 0.25);
    expect(x).toBeCloseTo(0, 5); // walked right across
    expect(w.seatAt(-0.5, 0.4)?.kind).toBe('bed');
  });

  it('is solid for walking guests', () => {
    const w = room();
    expect(w.isFree(0, 0, 0.22)).toBe(true);
    expect(w.isFree(0, 0, 0.22, true)).toBe(false);
    let x = -3,
      z = 0.4;
    for (let i = 0; i < 30; i++) [x, z] = w.move(x, z, 0.1, 0, 0.22, true);
    expect(x).toBeLessThanOrEqual(-1.2 - 0.22 + 1e-6);
  });
});
