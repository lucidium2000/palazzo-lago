import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { extents, LooseSim, restingQuat, type LooseEnv, type LooseEvent, type LooseSpec } from '../src/client/loosephys';

/** A room 10 m across with a 1 m table (top 0.75 m) in the middle and a pool to the east. */
const env: LooseEnv = {
  ground: () => 0,
  water: (x) => (x > 3 ? 0.4 : null),
  inside: (x, z) => Math.abs(x) < 5 && Math.abs(z) < 5,
  blocked: (x, z) => Math.abs(x) < 0.5 && Math.abs(z) < 0.5,
  top: (x, z, fromY) => (Math.abs(x) < 0.5 && Math.abs(z) < 0.5 && fromY >= 0.75 ? { y: 0.75 } : null),
};
// (The "pool" just has water at 0.4 over the floor.)

const CHIP: LooseSpec = { name: 'chip', shape: { type: 'cyl', r: 0.0195, h: 0.0033 }, mass: 0.01, bounce: 0.3, friction: 0.5, tumble: 0.3 };
const BOTTLE: LooseSpec = { name: 'bottle', shape: { type: 'cyl', r: 0.036, h: 0.3 }, mass: 1.2, bounce: 0.2, friction: 0.4, fragile: 5, floats: true };
const DIE: LooseSpec = { name: 'die', shape: { type: 'box', x: 0.012, y: 0.012, z: 0.012 }, mass: 0.015, bounce: 0.45, friction: 0.4, tumble: 1 };
const LIME: LooseSpec = { name: 'lime', shape: { type: 'sphere', r: 0.028 }, mass: 0.07, bounce: 0.35, friction: 0.5, floats: true };

function run(sim: LooseSim, secs: number) {
  for (let i = 0; i < secs * 60; i++) sim.update(1 / 60);
}

function bottomOf(b: { spec: LooseSpec; pos: THREE.Vector3; q: THREE.Quaternion }) {
  const e = extents(b.spec.shape, b.pos, b.q);
  return e.c.y - e.ey;
}

describe('loose objects', () => {
  it('lands on the table, settles and goes to sleep', () => {
    const sim = new LooseSim(env);
    const b = sim.add(CHIP, 'c', new THREE.Vector3(0, 1.2, 0));
    sim.launch(b, new THREE.Vector3(0.3, 0.5, 0));
    run(sim, 3);
    expect(b.awake).toBe(false);
    expect(bottomOf(b)).toBeCloseTo(0.75, 3);
    // Lies flat.
    expect(Math.abs(b.axis().y)).toBeGreaterThan(0.999);
  });

  it('a thrown chip lands flat however it was spinning', () => {
    for (let k = 0; k < 8; k++) {
      const sim = new LooseSim(env, k + 3);
      const b = sim.add(CHIP, 'c', new THREE.Vector3(-2, 1.4, 0));
      b.q.setFromEuler(new THREE.Euler(k, k * 0.7, 0));
      sim.launch(b, new THREE.Vector3(1.5, 1, 0.3 * k - 1));
      run(sim, 6);
      expect(b.awake).toBe(false);
      expect(Math.abs(b.axis().y)).toBeGreaterThan(0.999);
      expect(bottomOf(b)).toBeCloseTo(0, 3);
    }
  });

  it('slides off the edge of the table when knocked and falls to the floor', () => {
    const sim = new LooseSim(env);
    const b = sim.add(CHIP, 'c', new THREE.Vector3(0.3, 0.75, 0));
    sim.place(b, 0.3, 0, 0.8);
    expect(bottomOf(b)).toBeCloseTo(0.75, 4);
    sim.launch(b, new THREE.Vector3(1.6, 0, 0));
    run(sim, 3);
    expect(b.pos.x).toBeGreaterThan(0.5);
    expect(bottomOf(b)).toBeCloseTo(0, 3);
    expect(b.awake).toBe(false);
  });

  it('stays on the table when nudged gently (friction)', () => {
    const sim = new LooseSim(env);
    const b = sim.add(CHIP, 'c', new THREE.Vector3(0, 0.75, 0));
    sim.place(b, 0, 0, 0.8);
    sim.launch(b, new THREE.Vector3(0.6, 0, 0));
    run(sim, 2);
    expect(b.pos.x).toBeGreaterThan(0.01);
    expect(b.pos.x).toBeLessThan(0.45);
    expect(bottomOf(b)).toBeCloseTo(0.75, 3);
  });

  it('bounces lower each time on a hard floor', () => {
    const sim = new LooseSim(env);
    const b = sim.add(DIE, 'd', new THREE.Vector3(2, 1.5, 2));
    sim.launch(b, new THREE.Vector3(0, 0, 0), new THREE.Vector3());
    const peaks: number[] = [];
    let up = false,
      last = b.pos.y;
    for (let i = 0; i < 240; i++) {
      sim.update(1 / 60);
      if (b.pos.y > last) up = true;
      else if (up && b.pos.y < last) {
        peaks.push(last);
        up = false;
      }
      last = b.pos.y;
    }
    expect(peaks.length).toBeGreaterThan(0);
    expect(peaks[0]).toBeLessThan(1.5 * 0.5);
    for (let i = 1; i < Math.min(3, peaks.length); i++) expect(peaks[i]).toBeLessThan(peaks[i - 1]);
    // A die rests on a face.
    const ax = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((a) => Math.abs(a.applyQuaternion(b.q).y));
    expect(Math.max(...ax)).toBeGreaterThan(0.999);
  });

  it('fragile things break on a hard landing, not a soft one', () => {
    const events: LooseEvent[] = [];
    const sim = new LooseSim(env);
    sim.onEvent = (e) => events.push(e);
    const soft = sim.add(BOTTLE, 'b1', new THREE.Vector3(-2, 0.5, -2));
    sim.launch(soft, new THREE.Vector3(0.5, 0, 0));
    const hard = sim.add(BOTTLE, 'b2', new THREE.Vector3(-2, 1.8, 2));
    sim.launch(hard, new THREE.Vector3(2, -5, 0));
    run(sim, 3);
    expect(events.some((e) => e.type === 'break' && e.body === hard)).toBe(true);
    expect(events.some((e) => e.type === 'break' && e.body === soft)).toBe(false);
    expect(sim.bodies.includes(hard)).toBe(false);
    expect(soft.awake).toBe(false);
  });

  it('a bottle tipped past its balance point ends up on its side; nearly upright it stands', () => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.5);
    const side = restingQuat(BOTTLE.shape, q);
    expect(Math.abs(new THREE.Vector3(0, 1, 0).applyQuaternion(side).y)).toBeLessThan(1e-6);
    const q2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.1);
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(restingQuat(BOTTLE.shape, q2)).y).toBeCloseTo(1, 6);
    // A chip at the same tilt just falls flat.
    expect(Math.abs(new THREE.Vector3(0, 1, 0).applyQuaternion(restingQuat(CHIP.shape, q)).y)).toBeCloseTo(1, 6);
  });

  it('stacks: knocking the bottom chip drops the ones above', () => {
    const sim = new LooseSim(env);
    const stack = [0, 1, 2, 3, 4].map((i) => {
      const c = sim.add(CHIP, `s${i}`, new THREE.Vector3(0, 0.8, 0));
      sim.place(c, 0, 0, 0.8);
      return c;
    });
    for (let i = 0; i < 5; i++) expect(bottomOf(stack[i])).toBeCloseTo(0.75 + i * 0.0033, 4);
    expect(stack[4].restOn).toBe(stack[3]);
    // Resting stacks don't move by themselves.
    run(sim, 1);
    expect(sim.awakeCount).toBe(0);
    sim.launch(stack[0], new THREE.Vector3(1.0, 0, 0));
    expect(sim.awakeCount).toBe(5);
    run(sim, 4);
    expect(sim.awakeCount).toBe(0);
    // Everything came down to the table (or the floor), lying flat, no chip floating.
    for (const c of stack) {
      expect(Math.abs(c.axis().y)).toBeGreaterThan(0.999);
      const b = bottomOf(c);
      const ok = Math.abs(b - 0) < 1e-3 || (b > 0.749 && b < 0.75 + 5 * 0.0034);
      if (!ok) console.log('chip', c.id, b, c.pos.toArray(), c.restOn?.id);
      expect(ok).toBe(true);
    }
  });

  it('a flying object knocks a resting one (momentum goes across)', () => {
    const sim = new LooseSim(env);
    const target = sim.add(BOTTLE, 't', new THREE.Vector3(0, 0.75, 0));
    sim.place(target, 0.1, 0, 0.8);
    const die = sim.add({ ...DIE, mass: 0.5 }, 'd', new THREE.Vector3(-0.3, 0.86, 0));
    sim.launch(die, new THREE.Vector3(3, 0, 0), new THREE.Vector3());
    let woke = false;
    sim.onEvent = (e) => {
      if (e.type === 'wake' && e.body === target && e.by === die) woke = true;
    };
    run(sim, 0.4);
    expect(woke).toBe(true);
    expect(target.pos.x).toBeGreaterThan(0.12);
  });

  it('a hand sweeping through pushes things along (and off the table)', () => {
    const sim = new LooseSim(env);
    const a = sim.add(CHIP, 'a', new THREE.Vector3());
    sim.place(a, 0.2, 0, 0.8);
    const far = sim.add(CHIP, 'f', new THREE.Vector3());
    sim.place(far, -0.3, 0.3, 0.8);
    const hit = sim.sweep(new THREE.Vector3(0.18, 0.77, 0), new THREE.Vector3(2.0, 0, 0), 0.04, true);
    expect(hit).toEqual([a]);
    expect(a.mine).toBe(true);
    run(sim, 3);
    expect(a.pos.x).toBeGreaterThan(0.5);
    expect(far.pos.x).toBeCloseTo(-0.3, 6);
    // Slow hands (reaching to pick something up) don't shove anything.
    expect(sim.sweep(new THREE.Vector3(-0.3, 0.77, 0.3), new THREE.Vector3(0.3, 0, 0), 0.04, true)).toEqual([]);
  });

  it('bounces off the side of the table instead of passing through it', () => {
    const sim = new LooseSim(env);
    const b = sim.add(DIE, 'd', new THREE.Vector3(-1.5, 0.4, 0));
    sim.launch(b, new THREE.Vector3(4, 0.5, 0), new THREE.Vector3());
    run(sim, 3);
    expect(b.pos.x).toBeLessThan(-0.5);
    expect(bottomOf(b)).toBeCloseTo(0, 3);
  });

  it('rolls: a lime keeps rolling much further than a chip slides', () => {
    const sim = new LooseSim(env);
    const lime = sim.add(LIME, 'l', new THREE.Vector3(-4, 0, -3));
    sim.place(lime, -4, -3, 0.1);
    const chip = sim.add(CHIP, 'c', new THREE.Vector3(-4, 0, 3));
    sim.place(chip, -4, 3, 0.1);
    sim.launch(lime, new THREE.Vector3(1.2, 0, 0));
    sim.launch(chip, new THREE.Vector3(1.2, 0, 0));
    run(sim, 5);
    expect(lime.pos.x + 4).toBeGreaterThan((chip.pos.x + 4) * 3);
  });

  it('floats in water', () => {
    const sim = new LooseSim(env);
    const lime = sim.add(LIME, 'l', new THREE.Vector3(4, 1.2, 0));
    sim.launch(lime, new THREE.Vector3(0, 0, 0));
    run(sim, 6);
    const c = extents(LIME.shape, lime.pos, lime.q).c;
    expect(c.y).toBeGreaterThan(0.35);
    expect(c.y).toBeLessThan(0.45);
  });

  it('walls turn things back', () => {
    const sim = new LooseSim(env);
    const b = sim.add(DIE, 'd', new THREE.Vector3(4.5, 1.0, -2));
    sim.launch(b, new THREE.Vector3(0, 0.5, -6), new THREE.Vector3());
    run(sim, 4);
    expect(Math.abs(b.pos.z)).toBeLessThan(5);
  });

  it('napkins and menus lie flat, never on an edge', () => {
    const NAPKIN: LooseSpec = { name: 'napkin', shape: { type: 'box', x: 0.06, y: 0.0015, z: 0.06 }, mass: 0.004, bounce: 0.02, friction: 0.7, drag: 3.2 };
    for (let k = 0; k < 10; k++) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(k * 0.31, k, k * 0.17 + 1.2));
      const r = restingQuat(NAPKIN.shape, q);
      expect(Math.abs(new THREE.Vector3(0, 1, 0).applyQuaternion(r).y)).toBeCloseTo(1, 6);
    }
  });

  it('skims onto a table from just off its edge (declared tops are checked every step)', () => {
    const fastEnv: LooseEnv = { ...env, top: () => null, topFast: env.top };
    const sim = new LooseSim(fastEnv);
    const d = sim.add(DIE, 'd', new THREE.Vector3(-0.55, 0.7505, 0));
    sim.launch(d, new THREE.Vector3(2.0, 0, 0), new THREE.Vector3());
    run(sim, 3);
    expect(bottomOf(d)).toBeCloseTo(0.75, 3);
    expect(d.pos.x).toBeGreaterThan(-0.5);
  });
});
