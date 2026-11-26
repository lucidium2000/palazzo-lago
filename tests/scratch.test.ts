import { describe, expect, it } from 'vitest';
import { DeckDSP, OMEGA, Platter, crossfade, wrapAngle } from '../src/client/party/scratch';
import { FULL_SET, SET_BPM, SLOT_BARS, SONG_BARS, SONG_TRACKS, slotLayout } from '../src/client/party/setlist';
import { beatAt } from '../src/client/party/beat';
import { World } from '../src/client/world';
import { registerHall } from '../src/client/casino';
import { registerAreas } from '../src/client/areas';
import { DJ, STAGE, STAGE_STEPS } from '../src/client/areas/pool';

const FPS = 72;
const dt = 1 / FPS;

describe('the platter', () => {
  it('spins at 33⅓ rpm on its own', () => {
    const p = new Platter();
    for (let i = 0; i < FPS; i++) p.update(dt);
    expect(p.rate).toBeCloseTo(1, 6);
    expect(p.angle).toBeCloseTo(OMEGA, 3);
    expect(OMEGA).toBeCloseTo(3.4907, 3);
  });

  it('follows a hand round the spindle, forwards and backwards', () => {
    const p = new Platter();
    let hand = 0.4;
    p.touch(hand);
    const a0 = p.angle;
    // Push it forward at twice the speed for a quarter second...
    for (let i = 0; i < FPS / 4; i++) p.drag((hand += (2 * OMEGA) / FPS), dt);
    expect(p.rate).toBeGreaterThan(1.8);
    expect(p.angle - a0).toBeCloseTo((2 * OMEGA) / 4, 5);
    // ...pull it back...
    for (let i = 0; i < FPS / 4; i++) p.drag((hand -= OMEGA / FPS), dt);
    expect(p.rate).toBeLessThan(-0.9);
    // ...and hold it still.
    for (let i = 0; i < FPS / 4; i++) p.drag(hand, dt);
    expect(Math.abs(p.rate)).toBeLessThan(0.01);
    // A hand crossing the ±π seam doesn't spin the record round.
    p.touch(Math.PI - 0.01);
    const a1 = p.angle;
    p.drag(-Math.PI + 0.01, dt);
    expect(p.angle - a1).toBeCloseTo(0.02, 6);
  });

  it('spins back up to speed when you let go', () => {
    const p = new Platter();
    p.touch(0);
    for (let i = 0; i < 10; i++) p.drag(0, dt);
    p.release();
    expect(p.rate).toBeLessThan(0.05);
    let t = 0;
    while (p.rate < 0.999 && t < 2) {
      p.update(dt);
      t += dt;
    }
    expect(t).toBeLessThan(0.3);
    expect(p.rate).toBeCloseTo(1, 6);
    // Let go of it going backwards: it comes round too.
    p.touch(0);
    for (let i = 0; i < 10; i++) p.drag(-i * 0.05, dt);
    p.release();
    for (let i = 0; i < FPS; i++) p.update(dt);
    expect(p.rate).toBeCloseTo(1, 6);
  });

  it('wraps angles', () => {
    expect(wrapAngle(Math.PI * 2 + 0.1)).toBeCloseTo(0.1, 9);
    expect(wrapAngle(-Math.PI * 2 - 0.1)).toBeCloseTo(-0.1, 9);
  });
});

describe('the crossfader', () => {
  it('cuts hard at the ends and keeps both up across the middle', () => {
    expect(crossfade(0)).toEqual([1, 0]);
    expect(crossfade(1)).toEqual([0, 1]);
    expect(crossfade(0.5)).toEqual([1, 1]);
    const [a, b] = crossfade(0.075);
    expect(a).toBe(1);
    expect(b).toBeCloseTo(0.5, 6);
  });
});

/** A DSP with a "set" whose samples are their own time (s): the output position is readable. */
function rampDSP(rate = 48000) {
  const dsp = new DeckDSP(rate);
  const sr = 1000,
    loop = 10;
  const mk = (off: number) => {
    const a = new Float32Array(loop * sr + sr);
    for (let i = 0; i < a.length; i++) a[i] = off + (i % (loop * sr)) / sr;
    return a;
  };
  dsp.tracks = [mk(0), mk(100)];
  dsp.trackRate = sr;
  dsp.trackLoop = loop;
  dsp.t0 = 5;
  dsp.p0 = 3;
  return dsp;
}

describe('the decks (DSP)', () => {
  it('plays the set list on the clock: one track, then the next', () => {
    const dsp = rampDSP();
    expect(dsp.period()).toBe(20);
    expect(dsp.setPos(5)).toBeCloseTo(3, 9);
    expect(dsp.readSet(dsp.setPos(7.5))).toBeCloseTo(5.5, 3);
    // Past the first loop: the second track (offset 100 in the ramp).
    expect(dsp.readSet(dsp.setPos(13))).toBeCloseTo(101, 3);
    // A track not loaded yet plays the first one in its place.
    dsp.tracks[1] = null;
    expect(dsp.readSet(dsp.setPos(13))).toBeCloseTo(1, 3);
  });

  it('scratches from where the music is, backwards too, and slips back in time after', () => {
    const dsp = rampDSP();
    const out = new Float32Array(128);
    let t = 6;
    const block = () => {
      dsp.process(out, 128, t);
      t += 128 / 48000;
    };
    block();
    expect(dsp.a.scratch).toBe(false);
    // Hand on: held still.
    dsp.params.holdA = 1;
    dsp.params.rateA = 0;
    block();
    expect(dsp.a.scratch).toBe(true);
    const at = dsp.a.pos;
    expect(at).toBeCloseTo(dsp.setPos(t - 2 * (128 / 48000)) + 128 / 48000, 2);
    for (let i = 0; i < 40; i++) block();
    expect(dsp.a.pos).toBeCloseTo(at, 3);
    // Held still, the output dies away (no DC thump).
    expect(Math.abs(out[127])).toBeLessThan(0.05);
    // Pulled back.
    dsp.params.rateA = -1;
    for (let i = 0; i < 40; i++) block();
    expect(dsp.a.pos).toBeLessThan(at - 0.09);
    // Let go, back at speed: it fades back to where the set has got to.
    dsp.params.holdA = 0;
    dsp.params.rateA = 1;
    for (let i = 0; i < 20; i++) block();
    expect(dsp.a.scratch).toBe(false);
    expect(dsp.a.blend).toBe(0);
  });

  it('opens the battle record while it is held (or by the crossfader)', () => {
    const dsp = rampDSP();
    const rec = new Float32Array(2000);
    for (let i = 0; i < rec.length; i++) rec[i] = Math.sin(i * 0.3);
    dsp.rec = rec;
    dsp.recRate = 1000;
    dsp.recLoop = 1.5;
    dsp.tracks = [new Float32Array(11000)];
    const out = new Float32Array(256);
    const energy = () => out.reduce((s, x) => s + x * x, 0);
    dsp.process(out, 256, 6);
    expect(energy()).toBeLessThan(1e-6);
    dsp.params.holdB = 1;
    dsp.params.rateB = -1.5;
    for (let i = 0; i < 10; i++) dsp.process(out, 256, 6 + i * 0.01);
    expect(energy()).toBeGreaterThan(1);
    dsp.params.holdB = 0;
    dsp.params.rateB = 1;
    dsp.params.xf = 1;
    for (let i = 0; i < 200; i++) dsp.process(out, 256, 7 + i * 0.01);
    expect(energy()).toBeGreaterThan(1);
  });

  it('is self-contained (its source becomes the AudioWorklet module)', () => {
    const Cls = new Function(`return (${DeckDSP.toString()});`)() as typeof DeckDSP;
    const d = new Cls(44100);
    d.tracks = [new Float32Array(500).fill(0.5)];
    d.trackRate = 100;
    d.trackLoop = 4;
    const out = new Float32Array(64);
    d.process(out, 64, 0);
    expect(Number.isFinite(out[63])).toBe(true);
  });
});

describe("the headliner's songs", () => {
  const bar = (60 / SET_BPM) * 4;

  it('are two 32-bar recordings that fill his slot of the set, on the same bar grid', () => {
    expect(SONG_TRACKS).toHaveLength(2);
    for (const s of SONG_TRACKS) {
      expect(s.track.bars).toBe(SONG_BARS);
      // Within a few ms of the set's tempo over the whole song.
      expect(Math.abs(SONG_BARS * 4 * (60 / s.track.bpm) - SONG_BARS * bar)).toBeLessThan(0.01);
      expect(s.track.firstBeat).toBeGreaterThanOrEqual(0);
      expect(s.track.firstBeat).toBeLessThan(0.5);
    }
    const L = slotLayout();
    expect(L.slot).toBeCloseTo(SLOT_BARS * bar, 9);
    expect(L.songs.map((s) => s.at)).toEqual([0, SONG_BARS * bar]);
  });

  it('follow their sections: verse, pre-chorus, chorus (the drop), sung through, an outro as the music ends', () => {
    for (const [k, first] of [SLOT_BARS, SLOT_BARS + SONG_BARS].entries()) {
      const parts = FULL_SET.bars.slice(first, first + SONG_BARS);
      expect(parts.every((b) => b.track === k + 1)).toBe(true);
      expect(parts.slice(0, 8).every((b) => b.part === 'verse')).toBe(true);
      expect(parts.slice(8, 16).every((b) => b.part === 'pre-chorus' && b.section === 'build')).toBe(true);
      expect(parts[16].part).toBe('chorus');
      expect(parts[16].drop).toBe(true);
      // Sung all the way through the music, not in the silence after it.
      expect(parts.slice(0, 28).every((b) => b.voice === 1)).toBe(true);
      expect(parts[SONG_BARS - 1].part).toBe('outro');
      expect(parts[SONG_BARS - 1].voice).toBe(0);
    }
    // A breath at the end of each two-bar line.
    const t = (b: number) => b * bar;
    expect(beatAt(t(SLOT_BARS + 2) + bar * 0.5, FULL_SET).voice).toBe(1);
    expect(beatAt(t(SLOT_BARS + 2) - bar * 0.03, FULL_SET).voice).toBeLessThan(0.5);
  });
});

describe('the stage riser', () => {
  const w = new World();
  registerHall(w, { columns: [], planters: [] } as never);
  registerAreas(w);

  it('stands 0.6 m up with steps at the east end', () => {
    expect(w.groundAt(STAGE.spot.x, STAGE.spot.z)).toBeCloseTo(STAGE.y, 6);
    expect(w.groundAt(DJ.x, DJ.z - 0.13)).toBeCloseTo(STAGE.y, 6);
    expect(w.groundAt((STAGE_STEPS.x0 + STAGE_STEPS.x1) / 2, -32)).toBeCloseTo(STAGE.y / 2, 6);
    expect(w.groundAt(DJ.x, DJ.z + 3)).toBe(0);
  });

  it('has room behind the decks and a way up to them', () => {
    // The DJ's spot is clear; you get there from the steps round the console's end.
    for (const [x, z] of [
      [DJ.x, DJ.z - 0.13],
      [STAGE_STEPS.x0 + 0.4, -32],
      [DJ.x + 1.75, -32],
      [DJ.x + 1.75, DJ.z - 0.3],
    ])
      expect(w.isFree(x, z, 0.25)).toBe(true);
    // The front edge is a wall from the deck (and the dance floor).
    expect(w.isFree(DJ.x, STAGE.z1 + 0.1, 0.25)).toBe(false);
  });
});
