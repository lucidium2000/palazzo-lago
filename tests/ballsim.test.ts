import { describe, expect, it } from 'vitest';
import { aimFor, sampleAt, simulateSpin, WHEEL_R } from '../src/client/roulette/ballsim';

const SECTOR = (Math.PI * 2) / 38;

describe('roulette ball simulation', () => {
  const plans = Array.from({ length: 40 }, (_, i) => simulateSpin({ rotorSpeed: 2 + (i % 5) * 0.2, seed: i + 1 }));

  it('takes a realistic time from launch to rest', () => {
    for (const p of plans) {
      expect(p.duration).toBeGreaterThan(6);
      expect(p.duration).toBeLessThan(16);
    }
  });

  it('launches at real ball speeds and drops below the track', () => {
    for (const p of plans) {
      expect(p.samples[0].speed).toBeGreaterThan(3.9);
      expect(p.samples[0].speed).toBeLessThan(5.1);
      expect(p.samples.some((s) => s.phase === 'spiral')).toBe(true);
      expect(p.samples.some((s) => s.phase === 'rotor')).toBe(true);
    }
  });

  it('bounces off frets before settling, and ends in a pocket centre', () => {
    for (const p of plans) {
      expect(p.hits.length).toBeGreaterThan(1);
      const k = p.finalRel / SECTOR;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
      expect(p.samples.at(-1)!.r).toBeCloseTo(WHEEL_R.pocket, 6);
    }
  });

  it('can be aimed at any pocket without changing the motion', () => {
    const p = plans[0];
    for (const idx of [0, 7, 19, 37]) {
      const d = aimFor(p, idx);
      const end = sampleAt(p, p.duration);
      const rel = end.ball + d - end.rotor;
      const n = (((rel / SECTOR) % 38) + 38) % 38;
      expect(Math.round(n) % 38).toBe(idx);
    }
  });

  it('never moves the ball through the bowl or above the track', () => {
    for (const p of plans) {
      for (const s of p.samples) {
        expect(s.r).toBeGreaterThanOrEqual(WHEEL_R.pocket - 1e-6);
        expect(s.r).toBeLessThanOrEqual(WHEEL_R.track + 1e-6);
        expect(s.y).toBeGreaterThan(0.05);
        expect(s.y).toBeLessThan(0.2);
      }
    }
  });
});
