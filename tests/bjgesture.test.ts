import { describe, expect, it } from 'vitest';
import { type HandSample, type Signal, SignalReader, type V3 } from '../src/client/bjgesture';

/**
 * Hand paths as a headset reports them (72 Hz, with a little tracking jitter),
 * in the spot frame: x across, y up off the felt, z toward the player.
 */
const HZ = 72;
function noise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 2 ** 32 - 0.5) * 0.003; // ±1.5 mm
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
    out.push({ t: 10 + t, tip, palm, open: p.open ?? 0.3 });
  }
  return out;
}
function play(samples: HandSample[]): { signal: Signal; t: number }[] {
  const r = new SignalReader();
  const out: { signal: Signal; t: number }[] = [];
  for (const s of samples) {
    const sig = r.update(s);
    if (sig) out.push({ signal: sig, t: s.t });
  }
  return out;
}
const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
/** Fingertip comes down from `h0` to the felt over `down` s, pauses, and lifts. */
function tapAt(t: number, t0: number, down: number, x = 0.09, z = 0.04, h0 = 0.12) {
  const u = (t - t0) / down;
  let y = h0;
  if (u > 0 && u <= 1) y = h0 - (h0 - 0.008) * u * u; // accelerating down: a tap, not a lowering
  else if (u > 1 && u <= 1.5) y = 0.008;
  else if (u > 1.5 && u <= 3) y = 0.008 + (h0 - 0.008) * smooth((u - 1.5) / 1.5);
  return { x, y, z };
}

describe('hit: tapping the felt by your cards', () => {
  it('one firm downward tap', () => {
    // 11 cm in 0.15 s, accelerating: ~1.5 m/s at contact.
    const s = record(1.2, (t) => ({ tip: tapAt(t, 0.3, 0.15) }));
    const got = play(s);
    expect(got.map((g) => g.signal)).toEqual(['hit']);
    expect(got[0].t).toBeGreaterThan(10.4);
    expect(got[0].t).toBeLessThan(10.5);
  });

  it('two light taps', () => {
    const s = record(1.8, (t) => ({ tip: t < 0.75 ? tapAt(t, 0.2, 0.3, 0.09, 0.04, 0.07) : tapAt(t, 0.75, 0.3, 0.1, 0.05, 0.07) }));
    expect(play(s).map((g) => g.signal)).toEqual(['hit']);
  });

  it('a single light tap is not enough', () => {
    const s = record(1.4, (t) => ({ tip: tapAt(t, 0.3, 0.35, 0.09, 0.04, 0.07) }));
    expect(play(s)).toEqual([]);
  });

  it('resting your hand down slowly is not a tap', () => {
    const s = record(3, (t) => ({ tip: { x: 0.05, y: Math.max(0.008, 0.15 - t * 0.08), z: 0.06 } }));
    expect(play(s)).toEqual([]);
  });

  it('taps away from your cards do nothing', () => {
    const s = record(1.2, (t) => ({ tip: tapAt(t, 0.3, 0.15, 0.45, 0.04) }));
    expect(play(s)).toEqual([]);
  });

  it('bobbing in the air without touching does nothing', () => {
    const s = record(2, (t) => ({ tip: { x: 0.05, y: 0.1 + 0.04 * Math.sin(t * 14), z: 0.05 } }));
    expect(play(s)).toEqual([]);
  });

  it('works from the palm when there is no fingertip', () => {
    const s = record(1.2, (t) => ({ tip: null, palm: tapAt(t, 0.3, 0.15) }));
    expect(play(s).map((g) => g.signal)).toEqual(['hit']);
  });

  it('cools down: tapping on through the cooldown gives one hit', () => {
    const s = record(1.0, (t) => ({ tip: tapAt(t % 0.45, 0.05, 0.15) }));
    expect(play(s).map((g) => g.signal)).toEqual(['hit']);
  });
});

describe('stand: waving a flat hand over your cards', () => {
  const wave = (amp: number, hz: number, open = 0.95, y = 0.12) => (t: number) => ({ palm: { x: 0.02 + amp * Math.sin(t * hz * Math.PI * 2), y: y + 0.005 * Math.sin(t * 9), z: 0.05 }, tip: { x: amp * Math.sin(t * hz * Math.PI * 2), y: y - 0.01, z: -0.03 }, open });

  it('a side-to-side wave', () => {
    const got = play(record(1.0, wave(0.08, 1.3)));
    expect(got.map((g) => g.signal)).toEqual(['stand']);
    // Out, back past the middle: well under a second.
    expect(got[0].t - 10).toBeLessThan(0.9);
  });

  it('a quick small wave', () => {
    expect(play(record(1.2, wave(0.045, 2.2))).map((g) => g.signal)).toEqual(['stand']);
  });

  it('not with a fist', () => {
    expect(play(record(1.5, wave(0.08, 1.3, 0.1)))).toEqual([]);
  });

  it('not high above the table', () => {
    expect(play(record(1.5, wave(0.08, 1.3, 0.95, 0.5)))).toEqual([]);
  });

  it('reaching across the table once is not a wave', () => {
    const s = record(1.2, (t) => ({ palm: { x: -0.25 + 0.5 * smooth(t / 0.8), y: 0.1, z: 0.05 }, open: 0.9 }));
    expect(play(s)).toEqual([]);
  });

  it('a slow drift back and forth is not a wave', () => {
    expect(play(record(4, wave(0.06, 0.3)))).toEqual([]);
  });

  it('holding still over the cards is nothing', () => {
    expect(play(record(3, () => ({ palm: { x: 0.03, y: 0.1, z: 0.05 }, open: 1 })))).toEqual([]);
  });

  it('a wave never reads as a tap, even low over the felt', () => {
    const got = play(record(1.0, wave(0.08, 1.3, 0.95, 0.05)));
    expect(got.map((g) => g.signal)).toEqual(['stand']);
  });
});
