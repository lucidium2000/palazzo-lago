import { describe, expect, it } from 'vitest';
import type { HandSample, V3 } from '../src/client/bjgesture';
import { type PokerSignal, PokerSignalReader } from '../src/client/pokergesture';

/**
 * Hand paths as a headset reports them (72 Hz, ±1.5 mm of tracking jitter), in
 * the seat frame: x across, y up off the felt, z toward the player; the hole
 * cards at the origin, the dealer toward -z.
 */
const HZ = 72;
function noise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 2 ** 32 - 0.5) * 0.003;
  };
}
function record(dur: number, at: (t: number) => { tip?: V3 | null; palm?: V3 | null; open?: number }, seed = 1): HandSample[] {
  const n = noise(seed);
  const out: HandSample[] = [];
  for (let i = 0; i <= dur * HZ; i++) {
    const t = i / HZ;
    const p = at(t);
    const j = (v: V3 | null | undefined) => (v ? { x: v.x + n(), y: v.y + n(), z: v.z + n() } : null);
    const tip = p.tip === undefined ? null : j(p.tip);
    const palm = p.palm === undefined ? (tip ? { x: tip.x, y: tip.y + 0.04, z: tip.z + 0.07 } : null) : j(p.palm);
    out.push({ t: 10 + t, tip, palm, open: p.open ?? 0.4 });
  }
  return out;
}
function play(samples: HandSample[]): { signal: PokerSignal; t: number }[] {
  const r = new PokerSignalReader();
  const out: { signal: PokerSignal; t: number }[] = [];
  for (const s of samples) {
    const sig = r.update(s);
    if (sig) out.push({ signal: sig, t: s.t });
  }
  return out;
}
const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
/** Fingertip comes down from `h0` to the felt over `down` s (accelerating), rests briefly and lifts. */
function tipTap(t: number, t0: number, down = 0.12, x = 0.05, z = -0.08, h0 = 0.07) {
  const u = (t - t0) / down;
  let y = h0;
  if (u > 0 && u <= 1) y = h0 - (h0 - 0.006) * u * u;
  else if (u > 1 && u <= 1.4) y = 0.006;
  else if (u > 1.4 && u <= 2.6) y = 0.006 + (h0 - 0.006) * smooth((u - 1.4) / 1.2);
  return { x, y, z };
}

describe('check: two quick knocks on the felt', () => {
  it('a double tap in front of your cards', () => {
    const got = play(record(1.4, (t) => ({ tip: t < 0.55 ? tipTap(t, 0.2) : tipTap(t, 0.55, 0.12, 0.06, -0.07) })));
    expect(got.map((g) => g.signal)).toEqual(['check']);
    expect(got[0].t).toBeGreaterThan(10.6);
    expect(got[0].t).toBeLessThan(10.75);
  });

  it('a firm double knock with the knuckles (palm low, no fingertip tracked)', () => {
    const got = play(record(1.2, (t) => ({ tip: null, palm: t < 0.5 ? tipTap(t, 0.15, 0.1, 0.0, 0.05, 0.09) : tipTap(t, 0.5, 0.1, 0.01, 0.05, 0.09) })));
    expect(got.map((g) => g.signal)).toEqual(['check']);
  });

  it('one tap is not a check', () => {
    expect(play(record(1.5, (t) => ({ tip: tipTap(t, 0.3, 0.1) })))).toEqual([]);
  });

  it('two taps too far apart in time, or in space, are not a check', () => {
    expect(play(record(2.5, (t) => ({ tip: t < 1.0 ? tipTap(t, 0.2) : tipTap(t, 1.3) })))).toEqual([]);
    expect(play(record(1.4, (t) => ({ tip: t < 0.55 ? tipTap(t, 0.2, 0.12, -0.15) : tipTap(t, 0.55, 0.12, 0.15) })))).toEqual([]);
  });

  it('resting your hand on the felt (slowly, twice) is not a check', () => {
    const rest = (t: number, t0: number) => {
      const u = smooth((t - t0) / 0.6);
      return { x: 0.05, y: 0.1 - 0.095 * u, z: -0.05 };
    };
    expect(play(record(2.6, (t) => ({ tip: t < 1.2 ? rest(t, 0.2) : t < 1.6 ? { x: 0.05, y: 0.1, z: -0.05 } : rest(t, 1.6) })))).toEqual([]);
  });

  it('taps off to the side of the table do not count', () => {
    expect(play(record(1.4, (t) => ({ tip: t < 0.55 ? tipTap(t, 0.2, 0.12, 0.45) : tipTap(t, 0.55, 0.12, 0.45) })))).toEqual([]);
  });
});

describe('fold: sweep your cards toward the dealer', () => {
  /** Palm over the cards, then a quick low sweep forward of `dist` m over `dur` s. */
  const sweep = (t: number, t0: number, dist = 0.3, dur = 0.25, x0 = 0.0, z0 = 0.04, y = 0.05, dx = 0) => {
    const u = smooth((t - t0) / dur);
    return { x: x0 + dx * u, y, z: z0 - dist * u };
  };

  it('a flick forward from your cards folds', () => {
    const got = play(record(1.2, (t) => ({ palm: sweep(t, 0.4), tip: null, open: 0.8 })));
    expect(got.map((g) => g.signal)).toEqual(['fold']);
    expect(got[0].t).toBeGreaterThan(10.45);
    expect(got[0].t).toBeLessThan(10.66);
  });

  it('with the fingertip leading (both tracked)', () => {
    const got = play(record(1.2, (t) => {
      const p = sweep(t, 0.4, 0.28, 0.22);
      return { palm: p, tip: { x: p.x, y: p.y - 0.03, z: p.z - 0.08 } };
    }));
    expect(got.map((g) => g.signal)).toEqual(['fold']);
  });

  it('sliding your hand slowly forward does not fold', () => {
    expect(play(record(2.2, (t) => ({ palm: sweep(t, 0.3, 0.3, 1.5), tip: null })))).toEqual([]);
  });

  it('reaching forward from beside your chips (not your cards) does not fold', () => {
    expect(play(record(1.2, (t) => ({ palm: sweep(t, 0.4, 0.3, 0.25, 0.3), tip: null })))).toEqual([]);
  });

  it('a reach high over the table does not fold', () => {
    expect(play(record(1.2, (t) => ({ palm: sweep(t, 0.4, 0.35, 0.25, 0, 0.04, 0.3), tip: null })))).toEqual([]);
  });

  it('pulling your hand back toward you does not fold', () => {
    expect(play(record(1.2, (t) => ({ palm: sweep(t, 0.4, -0.3), tip: null })))).toEqual([]);
  });

  it('a quick sideways swipe over the cards does not fold', () => {
    expect(play(record(1.2, (t) => ({ palm: sweep(t, 0.4, 0.05, 0.25, -0.1, 0.04, 0.05, 0.35), tip: null })))).toEqual([]);
  });

  it('lifting the corners of your cards to look does not fold', () => {
    const peek = (t: number) => {
      const u = smooth((t - 0.3) / 0.5);
      return { x: 0.02, y: 0.02 + 0.1 * u, z: 0.06 + 0.08 * u };
    };
    expect(play(record(1.5, (t) => ({ palm: peek(t), tip: { ...peek(t), z: peek(t).z - 0.06 } })))).toEqual([]);
  });

  it('one signal at a time: after a fold, the reader stays quiet', () => {
    const got = play(record(1.6, (t) => ({ palm: t < 0.8 ? sweep(t, 0.3) : sweep(t, 0.85), tip: null })));
    expect(got.map((g) => g.signal)).toEqual(['fold']);
  });
});
