import { describe, expect, it } from 'vitest';
import { knocksOffSeat, stepUnseat, unseat, UNSEAT, walking, type Unseat, type UnseatWorld } from '../src/client/seatshove';

/** Runs the machine with a person who walks straight at their goal at walking speed. */
function sim(u: Unseat, secs: number, o: { rnd: number; seatFree?: (t: number) => boolean }) {
  let x = u.homeX + 0.6,
    z = u.homeZ;
  const phases: string[] = [];
  const dt = 0.1;
  for (let t = 0; t < secs; t += dt) {
    const w: UnseatWorld = {
      toGoal: Math.hypot(u.goalX - x, u.goalZ - z),
      seatFree: o.seatFree ? o.seatFree(t) : true,
      rnd: () => o.rnd,
      wanderGoal: (d) => [u.homeX + d, u.homeZ],
    };
    const ph = stepUnseat(u, dt, w);
    if (phases[phases.length - 1] !== ph) phases.push(ph);
    if (ph === 'sit') break;
    if (walking(u)) {
      const waiting = ph === 'return' && !w.seatFree && w.toGoal < UNSEAT.near + 0.35;
      const d = Math.hypot(u.goalX - x, u.goalZ - z);
      if (!waiting && d > 1e-6) {
        const s = Math.min(d, UNSEAT.walk * dt);
        x += ((u.goalX - x) / d) * s;
        z += ((u.goalZ - z) / d) * s;
      }
    }
  }
  return phases;
}

describe('knocked off a seat', () => {
  it('takes a punch or a real shove; a gentle touch only gets a look', () => {
    expect(knocksOffSeat(0.4, false)).toBe(false);
    expect(knocksOffSeat(1.0, false)).toBe(false);
    expect(knocksOffSeat(1.5, false)).toBe(true);
    expect(knocksOffSeat(0.6, true)).toBe(true);
  });

  it('stumbles, glares, walks straight back and sits down', () => {
    const u = unseat(2, 3, 1.2, 0.7);
    const phases = sim(u, 30, { rnd: 0.1 });
    expect(phases).toEqual(['stumble', 'glare', 'return', 'sit']);
    expect(u.homeX).toBe(2);
    expect(u.seatY).toBe(0.7);
  });

  it('or wanders off for a while first, then comes back', () => {
    const u = unseat(0, 0, 0, 0.7);
    const phases = sim(u, 120, { rnd: 0.9 });
    expect(phases).toEqual(['stumble', 'glare', 'wander', 'loiter', 'return', 'sit']);
  });

  it('waits while you sit in their seat, then gives up and wanders off', () => {
    const u = unseat(0, 0, 0, 0.7);
    // You sit down in it as soon as they're off it, and stay a minute.
    const phases = sim(u, 200, { rnd: 0.1, seatFree: (t) => t > 60 });
    expect(phases.slice(0, 4)).toEqual(['stumble', 'glare', 'return', 'wander']);
    // ...and they come back to it once you've gone.
    expect(phases[phases.length - 1]).toBe('sit');
  });

  it('the seat is free while they are away', () => {
    const u = unseat(0, 0, 0, 0.7);
    let x = 0.6;
    let away = 0;
    for (let t = 0; t < 40; t += 0.1) {
      const ph = stepUnseat(u, 0.1, { toGoal: Math.abs(u.goalX - x), seatFree: true, rnd: () => 0.9, wanderGoal: (d) => [d, 0] });
      if (walking(u)) x += Math.sign(u.goalX - x) * Math.min(Math.abs(u.goalX - x), 0.09);
      if (ph !== 'sit' && Math.abs(x) > 0.5) away++;
    }
    expect(away).toBeGreaterThan(300);
  });
});
