import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { extents, LooseSim, Surfaces, type LooseEnv, type LooseSpec } from '../src/client/loosephys';
import { apparentGravity, makePlatform, palmCanHold, palmHold, palmQuat, PalmTracker, platformY, slideStep, tiltOf, type Platform } from '../src/client/palm';

const CHIP: LooseSpec = { name: 'chip', shape: { type: 'cyl', r: 0.0195, h: 0.0033 }, mass: 0.01, bounce: 0.3, friction: 0.45, tumble: 0.3 };
const DIE: LooseSpec = { name: 'die', shape: { type: 'box', x: 0.011, y: 0.011, z: 0.011 }, mass: 0.012, bounce: 0.45, friction: 0.35, tumble: 1 };

const room: LooseEnv = {
  ground: () => 0,
  water: () => null,
  inside: (x, z) => Math.abs(x) < 5 && Math.abs(z) < 5,
  blocked: () => false,
  top: () => null,
};

const deg = THREE.MathUtils.degToRad;

/** A palm at `p`, tilted `tilt` radians about +x (toward the fingers going down). */
function palmAt(p: THREE.Vector3, tilt = 0): Platform {
  const pl = makePlatform('palm-right');
  pl.p.copy(p);
  pl.q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt);
  pl.active = true;
  return pl;
}

function bottomOf(b: { spec: LooseSpec; pos: THREE.Vector3; q: THREE.Quaternion }) {
  const e = extents(b.spec.shape, b.pos, b.q);
  return e.c.y - e.ey;
}

describe('palm maths', () => {
  it('holds things only open, palm up (within 45°) and not squeezing', () => {
    const up = new THREE.Vector3(0, 1, 0);
    expect(palmCanHold(up, 1, 0)).toBe(true);
    expect(palmCanHold(up, 0.2, 0)).toBe(false);
    expect(palmCanHold(up, 1, 0.8)).toBe(false);
    expect(palmCanHold(new THREE.Vector3(0, Math.cos(deg(40)), Math.sin(deg(40))), 1, 0)).toBe(true);
    expect(palmCanHold(new THREE.Vector3(0, Math.cos(deg(50)), Math.sin(deg(50))), 1, 0)).toBe(false);
    expect(palmCanHold(new THREE.Vector3(0, -1, 0), 1, 0)).toBe(false);
    expect(tiltOf(up)).toBeCloseTo(0);
  });

  it('builds the palm frame from the palm normal and the fingers', () => {
    const q = palmQuat(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(q).y).toBeCloseTo(1);
    expect(new THREE.Vector3(0, 0, -1).applyQuaternion(q).z).toBeCloseTo(-1);
    const q2 = palmQuat(new THREE.Vector3(0, 0.8, 0.6), new THREE.Vector3(1, 0, 0));
    const n = new THREE.Vector3(0, 1, 0).applyQuaternion(q2);
    expect(n.y).toBeCloseTo(0.8);
    expect(n.z).toBeCloseTo(0.6);
  });

  it('gives the plane height under a point, only over the patch', () => {
    const pl = palmAt(new THREE.Vector3(0, 1, 0));
    expect(platformY(pl, 0.02, 0.03)).toBeCloseTo(1);
    expect(platformY(pl, 0.2, 0)).toBeNull();
    const tilted = palmAt(new THREE.Vector3(0, 1, 0), deg(20));
    // Tilted about +x: the normal leans toward +z, so the plane drops toward +z.
    expect(platformY(tilted, 0, 0.03)!).toBeLessThan(1);
    expect(platformY(tilted, 0, -0.03)!).toBeGreaterThan(1);
  });

  it('sticks when held still or moved gently, slides past ~35°, flies on a jolt', () => {
    const pl = palmAt(new THREE.Vector3(0, 1, 0));
    expect(palmHold(pl)).toBe('stick');
    pl.a.set(3, 0, 0);
    expect(palmHold(pl)).toBe('stick');
    pl.a.set(8, 0, 0);
    expect(palmHold(pl)).toBe('slide');
    pl.a.set(25, 0, 0);
    expect(palmHold(pl)).toBe('fly');
    // Yanked down faster than it can fall.
    pl.a.set(0, -12, 0);
    expect(palmHold(pl)).toBe('fly');
    pl.a.set(0, 0, 0);
    pl.v.set(4, 0, 0);
    expect(palmHold(pl)).toBe('fly');
    expect(palmHold(palmAt(new THREE.Vector3(), deg(30)))).toBe('stick');
    expect(palmHold(palmAt(new THREE.Vector3(), deg(40)))).toBe('slide');
  });

  it('slides downhill when tipped and stops when levelled', () => {
    const pl = palmAt(new THREE.Vector3(), deg(42));
    const g = apparentGravity(pl);
    expect(g.n).toBeCloseTo(9.81 * Math.cos(deg(42)), 2);
    const lv = new THREE.Vector2();
    for (let i = 0; i < 10; i++) slideStep(pl, lv, 0.01);
    // Downhill is local +z (the normal leans toward +z).
    expect(lv.y).toBeGreaterThan(0.05);
    pl.q.identity();
    for (let i = 0; i < 100; i++) slideStep(pl, lv, 0.01);
    expect(lv.length()).toBe(0);
  });

  it('tracks a moving hand: velocity, then acceleration', () => {
    const t = new PalmTracker();
    const r = (x: number) => ({ p: new THREE.Vector3(x, 1, 0), normal: new THREE.Vector3(0, 1, 0), fwd: new THREE.Vector3(0, 0, -1), open: 1, grip: 0 });
    for (let i = 0; i < 60; i++) t.set(1, r(i * 0.005), 1 / 60);
    // 0.005 m per 1/60 s = 0.3 m/s.
    expect(t.platforms[1].v.x).toBeCloseTo(0.3, 2);
    expect(Math.abs(t.platforms[1].a.x)).toBeLessThan(0.05);
    expect(t.platforms[1].active).toBe(true);
    t.set(1, null, 1 / 60);
    expect(t.platforms[1].active).toBe(false);
  });
});

describe('things in an open palm', () => {
  it('a chip dropped onto a palm lands there and rides along as the hand moves', () => {
    const sim = new LooseSim(room);
    const pl = palmAt(new THREE.Vector3(0, 1.0, 0));
    sim.platforms = [pl];
    const b = sim.add(CHIP, 'c', new THREE.Vector3(0.01, 1.2, 0.01));
    sim.launch(b, new THREE.Vector3(0, 0, 0), new THREE.Vector3());
    for (let i = 0; i < 60; i++) sim.update(1 / 60);
    expect(b.plat).toBe(pl);
    expect(bottomOf(b)).toBeCloseTo(1.0, 3);
    // Move the hand slowly (0.2 m/s) for three seconds, turning it a little.
    for (let i = 0; i < 180; i++) {
      pl.v.set(0.2, 0, 0);
      pl.p.x += 0.2 / 60;
      pl.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.005);
      sim.update(1 / 60);
    }
    expect(b.plat).toBe(pl);
    expect(b.pos.x).toBeCloseTo(0.6 + 0.01, 1);
    expect(bottomOf(b)).toBeCloseTo(1.0, 3);
  });

  it('a stack of chips in the palm rides together', () => {
    const sim = new LooseSim(room);
    const pl = palmAt(new THREE.Vector3(0, 1.0, 0));
    sim.platforms = [pl];
    const chips = [0, 1, 2].map((k) => {
      const b = sim.add(CHIP, `c${k}`, new THREE.Vector3(0, 1.05 + k * 0.03, 0));
      sim.launch(b, new THREE.Vector3(), new THREE.Vector3());
      for (let i = 0; i < 40; i++) sim.update(1 / 60);
      return b;
    });
    for (const b of chips) expect(b.plat).toBe(pl);
    expect(bottomOf(chips[2])).toBeCloseTo(1.0 + 2 * 0.0033, 3);
  });

  it('slides off when you tip your hand past ~35°, then falls to the floor', () => {
    const sim = new LooseSim(room);
    const pl = palmAt(new THREE.Vector3(0, 1.0, 0));
    sim.platforms = [pl];
    const b = sim.add(DIE, 'd', new THREE.Vector3(0, 1.1, 0));
    sim.launch(b, new THREE.Vector3(), new THREE.Vector3());
    for (let i = 0; i < 60; i++) sim.update(1 / 60);
    expect(b.plat).toBe(pl);
    pl.q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), deg(30));
    for (let i = 0; i < 60; i++) sim.update(1 / 60);
    expect(b.plat).toBe(pl);
    pl.q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), deg(43));
    for (let i = 0; i < 60; i++) sim.update(1 / 60);
    expect(b.plat).toBeNull();
    for (let i = 0; i < 240; i++) sim.update(1 / 60);
    expect(bottomOf(b)).toBeCloseTo(0, 3);
  });

  it('flies off on a flick, falls when the hand closes or turns over', () => {
    const sim = new LooseSim(room);
    const pl = palmAt(new THREE.Vector3(0, 1.0, 0));
    sim.platforms = [pl];
    const b = sim.add(CHIP, 'c', new THREE.Vector3(0, 1.05, 0));
    sim.launch(b, new THREE.Vector3(), new THREE.Vector3());
    for (let i = 0; i < 40; i++) sim.update(1 / 60);
    expect(b.plat).toBe(pl);
    pl.v.set(3.5, 1, 0);
    pl.a.set(40, 10, 0);
    sim.update(1 / 60);
    expect(b.plat).toBeNull();
    expect(b.v.x).toBeGreaterThan(3);
    // Back into the palm, then the palm stops holding.
    pl.v.set(0, 0, 0);
    pl.a.set(0, 0, 0);
    const c = sim.add(CHIP, 'c2', new THREE.Vector3(0, 1.05, 0));
    sim.launch(c, new THREE.Vector3(), new THREE.Vector3());
    for (let i = 0; i < 40; i++) sim.update(1 / 60);
    expect(c.plat).toBe(pl);
    pl.active = false;
    sim.update(1 / 60);
    expect(c.plat).toBeNull();
  });

  it('letting go just over an open palm puts it there at once', () => {
    const sim = new LooseSim(room);
    const pl = palmAt(new THREE.Vector3(0, 1.0, 0));
    sim.platforms = [pl];
    const b = sim.add(CHIP, 'c', new THREE.Vector3(0.01, 1.02, 0));
    sim.launch(b, new THREE.Vector3(0, -0.1, 0), new THREE.Vector3());
    expect(sim.restOnPlatform(b)).toBe(pl);
    expect(bottomOf(b)).toBeCloseTo(1.0, 3);
    // Picking it up takes it out of the palm.
    sim.hold(b);
    expect(b.plat).toBeNull();
  });
});

describe('fast things and table tops', () => {
  /** A table whose top is only found by a slow cast (like a raycast), plus a declared craps-like tub. */
  const S = new Surfaces();
  S.box(0, 3, 3.1, 1.3, 0.72);
  S.frameIn(0, 3, 0, 1.75, 0.75, 1.55, 0.65, 0.92);
  const env: LooseEnv = {
    ground: () => 0,
    water: () => null,
    inside: (x, z) => Math.abs(x) < 9 && Math.abs(z) < 9,
    blocked: () => false,
    top: (x, z, fromY) => {
      const s = S.top(x, z, fromY);
      if (s) return s;
      return Math.abs(x) < 0.5 && Math.abs(z) < 0.5 && fromY >= 0.8 ? { y: 0.8 } : null;
    },
    topFast: (x, z, fromY) => S.top(x, z, fromY),
  };

  it('a chip thrown hard and low onto a table lands on it, not through it', () => {
    let n = 0;
    for (let k = 0; k < 24; k++) {
      const sim = new LooseSim(env, k + 1);
      const b = sim.add(CHIP, 'c', new THREE.Vector3(-0.62 + (k % 6) * 0.03, 0.9, -0.2 + k * 0.015));
      sim.launch(b, new THREE.Vector3(5 + (k % 4), -2 - (k % 3) * 0.5, 0), new THREE.Vector3());
      let over = false;
      for (let i = 0; i < 300; i++) {
        sim.update(1 / 60);
        // Wherever it is over the table, it's never below the top.
        if (Math.abs(b.pos.x) < 0.45 && Math.abs(b.pos.z) < 0.45) {
          over = true;
          expect(bottomOf(b)).toBeGreaterThan(0.79);
        }
      }
      if (over) n++;
    }
    expect(n).toBeGreaterThan(10);
  });

  it('a chip sliding across the tub stops at the wall instead of passing through it', () => {
    const sim = new LooseSim(env);
    const b = sim.add(CHIP, 'c', new THREE.Vector3(1.0, 0.72, 3));
    sim.place(b, 1.0, 3, 0.75);
    expect(bottomOf(b)).toBeCloseTo(0.72, 3);
    sim.launch(b, new THREE.Vector3(3, 0, 0), new THREE.Vector3());
    for (let i = 0; i < 300; i++) sim.update(1 / 60);
    expect(b.pos.x).toBeLessThan(1.56);
    expect(bottomOf(b)).toBeCloseTo(0.72, 2);
  });

  it('a sloping deck holds things at its slope', () => {
    const s = new Surfaces();
    s.box(0, 0, 0.6, 0.24, 0.88, 0, false, -0.3);
    expect(s.top(0, 0.1)!.y).toBeCloseTo(0.85, 3);
    expect(s.top(0, -0.1)!.y).toBeCloseTo(0.91, 3);
    expect(s.top(0, 0.1, 0.86)!.y).toBeCloseTo(0.85, 3);
    expect(s.top(0, -0.1, 0.86)).toBeNull();
  });
});
