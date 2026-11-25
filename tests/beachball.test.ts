import { describe, expect, it } from 'vitest';
import { BALL, BallSim, lobVelocity, newBall, type BallBody } from '../src/client/ballphys';
import { POOL, WATER_Y, registerPool } from '../src/client/areas/pool';
import { World } from '../src/client/world';

function deck() {
  const w = new World();
  registerPool(w);
  return w;
}

/** Runs the ball for `secs`, recording heights. */
function run(sim: BallSim, secs: number, bodies: BallBody[] = [], dt = 1 / 72) {
  const ys: number[] = [];
  for (let t = 0; t < secs; t += dt) {
    sim.step(dt, bodies);
    ys.push(sim.s.y);
  }
  return ys;
}

/** Peak heights of the bounces (local maxima of y). */
function peaks(ys: number[]) {
  const out: number[] = [];
  for (let i = 1; i < ys.length - 1; i++) if (ys[i] > ys[i - 1] && ys[i] >= ys[i + 1]) out.push(ys[i]);
  return out;
}

describe('beach ball: air', () => {
  it('falls slowly: drag caps it near 6.5 m/s', () => {
    const w = deck();
    const sim = new BallSim(w, newBall(28, 30, -10));
    run(sim, 3);
    // Still falling from 30 m after 3 s (a stone would be on the ground), close to terminal speed.
    expect(sim.s.y).toBeGreaterThan(5);
    expect(-sim.s.vy).toBeGreaterThan(5.8);
    expect(-sim.s.vy).toBeLessThan(Math.sqrt(BALL.g / BALL.drag) + 0.05);
  });

  it('a lob lands roughly where it was aimed', () => {
    const w = deck();
    const sim = new BallSim(w, newBall(30, 1.2, -11));
    const [vx, vy, vz] = lobVelocity(30, 1.2, -11, 36, 1.2, -11, 1.2);
    sim.hit(vx, vy, vz);
    let x = 0;
    for (let t = 0; t < 3; t += 1 / 120) {
      const prev = sim.s.y;
      sim.step(1 / 120);
      if (prev >= 1.2 && sim.s.y < 1.2 && sim.s.vy < 0) {
        x = sim.s.x;
        break;
      }
    }
    expect(x).toBeGreaterThan(35);
    expect(x).toBeLessThan(37);
  });
});

describe('beach ball: deck', () => {
  it('bounces high and lightly, then rests', () => {
    const w = deck();
    const sim = new BallSim(w, newBall(28, 2.3, -10));
    const ys = run(sim, 8);
    const p = peaks(ys).filter((y) => y > BALL.r + 0.02);
    expect(p.length).toBeGreaterThanOrEqual(3);
    // First rebound: well over a third of the drop (drag eats some, restitution keeps most).
    const first = (p[0] - BALL.r) / (2.3 - BALL.r);
    expect(first).toBeGreaterThan(0.35);
    expect(first).toBeLessThan(0.75);
    for (let i = 1; i < p.length; i++) expect(p[i]).toBeLessThan(p[i - 1]);
    expect(sim.s.y).toBeCloseTo(BALL.r, 3);
    expect(sim.s.asleep).toBe(true);
  });

  it('rolls to a stop and never sinks through the deck', () => {
    const w = deck();
    const sim = new BallSim(w, newBall(28, BALL.r, -10));
    sim.hit(2.5, 0, 0);
    const ys = run(sim, 10);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(BALL.r - 1e-6);
    expect(sim.s.x).toBeGreaterThan(29);
    expect(sim.s.asleep).toBe(true);
  });

  it('bounces off the hedge (edge of the deck) and stays on the deck', () => {
    const w = deck();
    const sim = new BallSim(w, newBall(26, 0.8, -9));
    sim.hit(-6, 1, 0);
    for (let t = 0; t < 6; t += 1 / 72) {
      sim.step(1 / 72);
      expect(w.isInside(sim.s.x, sim.s.z)).toBe(true);
    }
    expect(sim.s.x).toBeGreaterThan(23.3);
  });

  it('bounces off a person and off a lounger', () => {
    const w = deck();
    const sim = new BallSim(w, newBall(28, 1.2, -11));
    sim.hit(4, 0, 0);
    const person: BallBody = { x: 29.5, z: -11, y0: 0.3, y1: 1.5, r: 0.25 };
    run(sim, 0.6, [person]);
    expect(sim.s.vx).toBeLessThan(0);
    expect(sim.s.x).toBeLessThan(29.5 - 0.5);
    // A lounger (yaw π, north side): a low roll into it bounces back.
    const sim2 = new BallSim(w, newBall(38.4, BALL.r, -10.6));
    sim2.hit(0, 0, -3);
    run(sim2, 0.8);
    expect(sim2.s.vz).toBeGreaterThanOrEqual(0);
    expect(sim2.s.z).toBeGreaterThan(-12.2 + BALL.r - 0.01);
  });
});

describe('beach ball: water', () => {
  it('splashes in, bobs, and floats at its waterline', () => {
    const w = deck();
    const splashes: number[] = [];
    const sim = new BallSim(w, newBall(POOL.x, 2, POOL.z));
    sim.onImpact = (k, v) => {
      if (k === 'water') splashes.push(v);
    };
    const ys = run(sim, 12);
    expect(splashes.length).toBe(1);
    // Never goes far under; settles with ~a third of its radius under water.
    expect(Math.min(...ys)).toBeGreaterThan(WATER_Y - BALL.r);
    const line = WATER_Y + BALL.r * (1 - BALL.floatDepth);
    expect(sim.s.y).toBeCloseTo(line, 2);
    expect(Math.abs(sim.s.vy)).toBeLessThan(0.02);
    expect(sim.s.inWater).toBe(true);
  });

  it('drifts slowly on the water and stays in the pool', () => {
    const w = deck();
    const sim = new BallSim(w, newBall(POOL.x - 3, WATER_Y + 0.2, POOL.z));
    let maxSpeed = 0;
    const x0 = sim.s.x,
      z0 = sim.s.z;
    for (let t = 0; t < 240; t += 1 / 30) {
      sim.step(1 / 30);
      maxSpeed = Math.max(maxSpeed, Math.hypot(sim.s.vx, sim.s.vz));
      expect(Math.abs(sim.s.x - POOL.x)).toBeLessThanOrEqual(POOL.w / 2 - BALL.r + 0.02);
      expect(Math.abs(sim.s.z - POOL.z)).toBeLessThanOrEqual(POOL.d / 2 - BALL.r + 0.02);
      expect(sim.s.y).toBeGreaterThan(WATER_Y - 0.1);
    }
    expect(Math.hypot(sim.s.x - x0, sim.s.z - z0)).toBeGreaterThan(0.5);
    expect(maxSpeed).toBeLessThan(0.25);
  });

  it('a hard shot across the pool bounces off the side wall and stays in', () => {
    const w = deck();
    const sim = new BallSim(w, newBall(POOL.x, WATER_Y + 0.2, POOL.z));
    sim.hit(0, 0, 4);
    run(sim, 4);
    expect(sim.s.z).toBeLessThan(POOL.z + POOL.d / 2);
    expect(sim.s.inWater).toBe(true);
  });

  it('is stable with long frames', () => {
    const w = deck();
    const sim = new BallSim(w, newBall(POOL.x, 3, POOL.z));
    for (let i = 0; i < 40; i++) sim.step(0.25);
    expect(sim.s.y).toBeCloseTo(WATER_Y + BALL.r * (1 - BALL.floatDepth), 1);
  });
});

describe('beach ball: people', () => {
  it('a resting ball is knocked along by someone walking into it', () => {
    const w = deck();
    const sim = new BallSim(w, newBall(28, BALL.r, -10));
    run(sim, 1);
    expect(sim.s.asleep).toBe(true);
    // A guest walks east through it at 1 m/s.
    let x = 27;
    for (let t = 0; t < 1.5; t += 1 / 72) {
      x += 1 / 72;
      sim.step(1 / 72, [{ x, z: -10, y0: 0.15, y1: 1.5, r: 0.22, vx: 1, vz: 0 }]);
    }
    expect(sim.s.x).toBeGreaterThan(x + 0.3);
  });
});
