import { describe, expect, it } from 'vitest';
import { CROUCH_DROP, CROUCH_EYE_MIN, CROUCH_SPEED, CROUCH_TIME, Crouch, crouchDropFor } from '../src/client/crouch';
import { DIVE_SPEED, MAX_DIVE, floatFeet, newVState, verticalStep } from '../src/client/swimphys';
import { WATER_Y } from '../src/client/areas/pool';

const DT = 1 / 72;

describe('button crouch', () => {
  it('lowers a standing eye by about half a metre in ~0.2 s, eased, and back up', () => {
    const c = new Crouch();
    const drops: number[] = [];
    for (let t = 0; t < 0.5; t += DT) drops.push(c.update(DT, true, 1.65));
    expect(drops[drops.length - 1]).toBeCloseTo(CROUCH_DROP, 5);
    // Eased in: the first frame moves very little; done by ~0.2 s.
    expect(drops[0]).toBeLessThan(0.01);
    expect(drops[Math.ceil(CROUCH_TIME / DT)]).toBeCloseTo(CROUCH_DROP, 5);
    for (let i = 1; i < drops.length; i++) expect(drops[i]).toBeGreaterThanOrEqual(drops[i - 1] - 1e-9);
    expect(c.speedFactor).toBeCloseTo(CROUCH_SPEED, 5);
    for (let t = 0; t < 0.25; t += DT) c.update(DT, false, 1.65);
    expect(c.drop).toBe(0);
    expect(c.speedFactor).toBe(1);
  });

  it('a short player, or one already crouching or sitting in real life, is lowered less', () => {
    expect(crouchDropFor(1.8)).toBe(CROUCH_DROP);
    expect(crouchDropFor(1.4)).toBeCloseTo(1.4 - CROUCH_EYE_MIN, 6);
    expect(crouchDropFor(1.0)).toBe(0);
  });

  it('a lasting real-life crouch takes over from the button (no double lowering)', () => {
    const c = new Crouch();
    for (let t = 0; t < 0.5; t += DT) c.update(DT, true, 1.65);
    // Squat down for real to 1.0 m and stay there.
    for (let t = 0; t < 3; t += DT) c.update(DT, true, 1.0);
    expect(c.drop).toBeLessThan(0.01);
  });

  it('a quick nod is not cancelled out (your head still moves the view one to one)', () => {
    const c = new Crouch();
    for (let t = 0; t < 0.5; t += DT) c.update(DT, true, 1.65);
    const before = 1.65 - c.drop;
    c.update(DT, true, 1.6);
    const after = 1.6 - c.drop;
    expect(before - after).toBeGreaterThan(0.045);
  });
});

describe('holding the dive button', () => {
  const DEEP = -2.12;
  const W = WATER_Y;
  it('sinks at a comfortable, eased-in speed to the deepest point, then floats back up', () => {
    const eyeH = 1.65;
    const s = newVState(floatFeet(W, eyeH));
    const speeds: number[] = [];
    let minHead = Infinity;
    for (let t = 0; t < 4; t += DT) {
      verticalStep(s, { ground: DEEP, water: W, eyeH, dive: true }, DT);
      speeds.push(-s.velY);
      minHead = Math.min(minHead, s.feetY + eyeH);
    }
    const top = Math.max(...speeds);
    expect(top).toBeLessThanOrEqual(DIVE_SPEED + 0.02);
    expect(top).toBeGreaterThan(0.6);
    // Eased in: still slow after the first tenth of a second.
    expect(speeds[Math.round(0.1 / DT)]).toBeLessThan(0.25);
    expect(minHead).toBeGreaterThanOrEqual(W - MAX_DIVE - 0.01);
    expect(minHead).toBeLessThan(W - 0.8);
    // Settled at the bottom of the dive.
    expect(Math.abs(s.velY)).toBeLessThan(0.05);
    let t = 0;
    while (s.feetY + eyeH < W && t < 5) {
      verticalStep(s, { ground: DEEP, water: W, eyeH }, DT);
      t += DT;
    }
    expect(t).toBeLessThan(1.5);
  });

  it('keeps your head off the floor in the shallows', () => {
    const eyeH = 1.65;
    const ground = W - 1.2;
    const s = newVState(floatFeet(W, eyeH));
    for (let t = 0; t < 4; t += DT) {
      verticalStep(s, { ground, water: W, eyeH, dive: true }, DT);
      expect(s.feetY + eyeH).toBeGreaterThanOrEqual(ground + 0.3 - 1e-6);
    }
  });

  it('jumping in while holding it brakes in the water, not through the floor', () => {
    const eyeH = 1.65;
    const s = newVState(W + 0.5);
    s.airborne = true;
    for (let t = 0; t < 3; t += DT) {
      verticalStep(s, { ground: DEEP, water: W, eyeH, dive: true }, DT);
      expect(s.feetY + eyeH).toBeGreaterThanOrEqual(W - MAX_DIVE - 0.4);
      expect(s.feetY + eyeH).toBeGreaterThanOrEqual(DEEP + 0.3 - 1e-6);
    }
  });
});
