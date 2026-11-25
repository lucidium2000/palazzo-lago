import { describe, expect, it } from 'vitest';
import { BODY_R, SOFT, capsuleDepth, handInto, handShove, separate, shoveDistance, shoveProgress, stepAgainst } from '../src/client/push';

const R = 0.25;

describe('walking into someone', () => {
  it('leaves a step alone when nobody is near', () => {
    const press = new Float32Array(1);
    const out = stepAgainst(0, 0, 0.02, 0, R, [5, 5, BODY_R], 1, press, { dx: 0, dz: 0 });
    expect(out.dx).toBeCloseTo(0.02);
    expect(out.dz).toBeCloseTo(0);
    expect(press[0]).toBe(0);
  });

  it('stops you at their edge when you walk straight at them, and records the push', () => {
    const press = new Float32Array(1);
    // Touching already (0.5 apart): a 2 cm step straight in.
    const out = stepAgainst(0, 0, 0.02, 0, R, [0.5, 0, BODY_R], 1, press, { dx: 0, dz: 0 });
    expect(out.dx).toBeLessThanOrEqual(1e-9);
    expect(press[0]).toBeCloseTo(0.02);
  });

  it('slides you around them, slower than walking freely', () => {
    const press = new Float32Array(1);
    // Walking +x, with them just off to the side ahead: you glance off them.
    const out = stepAgainst(0, 0, 0.02, 0, R, [0.45, 0.2, BODY_R], 1, press, { dx: 0, dz: 0 });
    const moved = Math.hypot(out.dx, out.dz);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(0.02);
    expect(out.dz).toBeLessThan(0); // sideways, away from them
    expect(press[0]).toBeGreaterThan(0);
  });

  it('never lets you sink in more than the soft contact, however long you push', () => {
    const press = new Float32Array(1);
    let x = 0,
      z = 0.01;
    const body = [1, 0, BODY_R];
    const out = { dx: 0, dz: 0 };
    let deepest = 0;
    for (let i = 0; i < 300; i++) {
      stepAgainst(x, z, 3.0 / 72, 0, R, body, 1, press, out);
      x += out.dx;
      z += out.dz;
      deepest = Math.max(deepest, R + BODY_R - Math.hypot(x - 1, z));
    }
    expect(deepest).toBeLessThanOrEqual(SOFT + 1e-6);
  });

  it('eases you out if someone ends up on top of you (no teleport)', () => {
    const press = new Float32Array(1);
    const out = stepAgainst(0, 0, 0, 0, R, [0.1, 0, BODY_R], 1, press, { dx: 0, dz: 0 });
    expect(out.dx).toBeLessThan(0);
    expect(Math.hypot(out.dx, out.dz)).toBeLessThanOrEqual(0.05 + 1e-9);
  });
});

describe('shoves', () => {
  it('get bigger the faster you go, with running a real bump, and are capped', () => {
    expect(shoveDistance(1.45)).toBeGreaterThan(shoveDistance(0.5));
    expect(shoveDistance(3)).toBeGreaterThan(shoveDistance(1.45) + 0.15);
    expect(shoveDistance(1.45)).toBeGreaterThan(0.25);
    expect(shoveDistance(1.45)).toBeLessThan(0.45);
    expect(shoveDistance(50)).toBeLessThanOrEqual(0.9);
  });

  it('play out smoothly and cover exactly the shove distance', () => {
    const T = 0.4,
      dist = 0.37,
      dt = 1 / 90;
    let x = 0,
      maxStep = 0;
    for (let t = 0; t < T + 0.1; t += dt) {
      const s = dist * (shoveProgress(t + dt, T) - shoveProgress(t, T));
      maxStep = Math.max(maxStep, s);
      x += s;
    }
    expect(x).toBeCloseTo(dist, 5);
    expect(maxStep).toBeLessThan(0.03); // no teleporting
    expect(shoveProgress(T * 0.5, T)).toBeGreaterThan(0.5); // quick at first, then easing out
  });
});

describe('nobody inside anybody', () => {
  it('splits an overlap between two movable people', () => {
    const cx = new Float32Array(2),
      cz = new Float32Array(2);
    const hits = separate([0, 0.3], [0, 0], [0.25, 0.25], [1, 1], 2, cx, cz);
    expect(hits).toBe(1);
    expect(cx[0]).toBeCloseTo(-0.1);
    expect(cx[1]).toBeCloseTo(0.1);
  });

  it('moves only the movable one when the other is rooted (seated, behind a counter, you)', () => {
    const cx = new Float32Array(2),
      cz = new Float32Array(2);
    separate([0, 0.3], [0, 0], [0.25, 0.25], [0, 1], 2, cx, cz);
    expect(cx[0]).toBe(0);
    expect(cx[1]).toBeCloseTo(0.2);
  });

  it('leaves two rooted people and far-apart people alone', () => {
    const cx = new Float32Array(3),
      cz = new Float32Array(3);
    expect(separate([0, 0.3, 5], [0, 0, 5], [0.25, 0.25, 0.25], [0, 0, 1], 3, cx, cz)).toBe(0);
    expect([...cx, ...cz].every((v) => v === 0)).toBe(true);
  });

  it('pulls apart two people standing exactly on the same spot', () => {
    const cx = new Float32Array(2),
      cz = new Float32Array(2);
    separate([1, 1], [1, 1], [0.25, 0.25], [1, 1], 2, cx, cz);
    const ax = 1 + cx[0],
      az = 1 + cz[0],
      bx = 1 + cx[1],
      bz = 1 + cz[1];
    expect(Math.hypot(ax - bx, az - bz)).toBeCloseTo(0.5);
  });

  it('settles a crowd squeezed into a corner within a few frames', () => {
    const n = 12;
    const xs = new Float32Array(n),
      zs = new Float32Array(n),
      rs = new Float32Array(n).fill(0.25),
      m = new Float32Array(n).fill(1);
    for (let i = 0; i < n; i++) {
      xs[i] = (i % 4) * 0.2;
      zs[i] = Math.floor(i / 4) * 0.2;
    }
    const cx = new Float32Array(n),
      cz = new Float32Array(n);
    for (let f = 0; f < 200; f++) {
      separate(xs, zs, rs, m, n, cx, cz);
      for (let i = 0; i < n; i++) {
        xs[i] += cx[i];
        zs[i] += cz[i];
      }
    }
    let worst = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) worst = Math.max(worst, 0.5 - Math.hypot(xs[i] - xs[j], zs[i] - zs[j]));
    expect(worst).toBeLessThan(0.01);
  });
});

describe('hands', () => {
  it('finds a hand inside the body capsule between knees and shoulders', () => {
    expect(capsuleDepth(0.1, 1.2, 0, 0, 0, 0.5, 1.4, 0.2)).toBeGreaterThan(0);
    expect(capsuleDepth(0.35, 1.2, 0, 0, 0, 0.5, 1.4, 0.2)).toBeLessThan(0);
    // Above the head (well past the shoulders) is not in the body.
    expect(capsuleDepth(0, 1.75, 0, 0, 0, 0.5, 1.4, 0.2)).toBeLessThan(0);
  });

  it('only counts motion into the body, and pushes gently', () => {
    // Hand on the +x side of the body moving toward -x: into the body.
    expect(handInto(-1, 0, 0.15, 0)).toBeCloseTo(1);
    expect(handInto(1, 0, 0.15, 0)).toBe(0);
    expect(handInto(0, 1, 0.15, 0)).toBeCloseTo(0);
    expect(handShove(10)).toBeLessThanOrEqual(0.22);
    expect(handShove(1)).toBeLessThan(shoveDistance(1.45));
  });
});

describe('pushing a friend (two-player)', () => {
  it('nudges your player on their push, capped, and buzzes both controllers', async () => {
    const { friendShove, SHOVE_EVENT } = await import('../src/client/bodies');
    const handlers: Record<string, (f: unknown, d: Record<string, unknown>) => void> = {};
    const sent: [string, unknown][] = [];
    const session = { on: (k: string, fn: (f: unknown, d: Record<string, unknown>) => void) => (handlers[k] = fn), emit: (k: string, d?: unknown) => sent.push([k, d]) };
    const nudges: number[][] = [];
    const player = { nudge: (dx: number, dz: number, s: number) => nudges.push([dx, dz, s]) };
    const buzz: string[] = [];
    const push = friendShove(session as never, player as never, (side) => buzz.push(side));
    push(0.304, -0.1);
    expect(sent).toEqual([[SHOVE_EVENT, { x: 0.3, z: -0.1 }]]);
    handlers[SHOVE_EVENT]({}, { x: 0.3, z: 0 });
    expect(nudges[0]).toEqual([0.3, 0, 0.25]);
    expect(buzz).toEqual(['left', 'right']);
    // Whatever arrives, never more than half a metre; junk is ignored.
    handlers[SHOVE_EVENT]({}, { x: 30, z: 40 });
    expect(Math.hypot(nudges[1][0], nudges[1][1])).toBeCloseTo(0.5);
    handlers[SHOVE_EVENT]({}, { x: 'a', z: null });
    expect(nudges.length).toBe(2);
  });
});
