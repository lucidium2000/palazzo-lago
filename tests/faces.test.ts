import { describe, expect, it } from 'vitest';
import { blinkCurve, nextBlinkGap, speechOpen } from '../src/client/faces';
import { speechFeatures } from '../src/client/voices';

describe('blinks', () => {
  it('closes fast, holds, opens and is done within a fifth of a second', () => {
    expect(blinkCurve(-0.01)).toBe(0);
    expect(blinkCurve(0)).toBe(0);
    expect(blinkCurve(0.07)).toBe(1);
    expect(blinkCurve(0.03)).toBeGreaterThan(0.4);
    expect(blinkCurve(0.12)).toBeGreaterThan(0);
    expect(blinkCurve(0.12)).toBeLessThan(1);
    expect(blinkCurve(0.2)).toBe(0);
  });
  it('comes every 2–6 s, quicker when laughing, with occasional doubles', () => {
    let s = 1;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const calm = Array.from({ length: 2000 }, () => nextBlinkGap(false, rnd));
    const doubles = calm.filter((g) => g < 0.5).length / calm.length;
    expect(doubles).toBeGreaterThan(0.08);
    expect(doubles).toBeLessThan(0.22);
    for (const g of calm) expect(g < 0.5 || (g >= 2 && g <= 6)).toBe(true);
    const laughing = Array.from({ length: 2000 }, () => nextBlinkGap(true, rnd)).filter((g) => g > 0.5);
    expect(Math.max(...laughing)).toBeLessThanOrEqual(1.8);
  });
});

describe('lip sync', () => {
  const bin = 48000 / 512;
  const tone = (hz: number, amp: number) => {
    const wave = Float32Array.from({ length: 512 }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / 48000));
    const spec = new Uint8Array(256);
    spec[Math.round(hz / bin)] = 200;
    return { wave, spec };
  };
  it('silence keeps the mouth shut', () => {
    const f = speechFeatures(new Float32Array(512), new Uint8Array(256), bin);
    expect(f.level).toBe(0);
    expect(speechOpen(f.level, f.vowel)).toBe(0);
  });
  it('a loud vowel opens wider than a loud hiss', () => {
    const a = tone(600, 0.3),
      s = tone(4000, 0.3);
    const fa = speechFeatures(a.wave, a.spec, bin),
      fs = speechFeatures(s.wave, s.spec, bin);
    expect(fa.level).toBeGreaterThan(0.9);
    expect(fa.vowel).toBeGreaterThan(0.9);
    expect(fs.vowel).toBeLessThan(0.1);
    expect(speechOpen(fa.level, fa.vowel)).toBeGreaterThan(speechOpen(fs.level, fs.vowel) * 2);
  });
  it('quiet speech opens a little', () => {
    const q = tone(600, 0.04);
    const f = speechFeatures(q.wave, q.spec, bin);
    expect(speechOpen(f.level, f.vowel)).toBeGreaterThan(0.05);
    expect(speechOpen(f.level, f.vowel)).toBeLessThan(0.4);
  });
});
