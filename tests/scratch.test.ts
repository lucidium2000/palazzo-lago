import { describe, expect, it } from 'vitest';
import { DeckDSP, OMEGA, Platter, crossfade, wrapAngle } from '../src/client/party/scratch';
import { DECK_B_PLAN, HOUSE_PLAN, INDEX_SONGS, TRACKS, autoSections, beatMatch, concertLength, entryMatches, songAt } from '../src/client/party/setlist';
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
  it('is equal-power: full left only deck A, full right only deck B, both at -3 dB in the middle', () => {
    expect(crossfade(0)).toEqual([1, 0]);
    expect(crossfade(1)).toEqual([0, 1]);
    const [a, b] = crossfade(0.5);
    expect(a).toBeCloseTo(Math.SQRT1_2, 6);
    expect(b).toBeCloseTo(Math.SQRT1_2, 6);
    for (let x = 0; x <= 1; x += 0.1) {
      const [ga, gb] = crossfade(x);
      expect(ga * ga + gb * gb).toBeCloseTo(1, 6);
    }
  });
});

const SR = 8000;
/** A record that's a pure tone (so each deck's share of the output can be measured), `secs` long. */
const tone = (hz: number, secs: number) => {
  const d = new Float32Array(Math.round(secs * SR) + SR);
  for (let i = 0; i < d.length; i++) d[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / SR);
  return d;
};
function dsp(rate = 16000) {
  const d = new DeckDSP(rate);
  d.recs[0] = { data: tone(220, 4), sr: SR, loop: 4 };
  d.recs[1] = { data: tone(550, 3), sr: SR, loop: 3 };
  d.t0 = 10;
  d.w0 = 1000;
  return d;
}
/** Each tone's amplitude in a block of output (a single-bin DFT). */
function share(out: Float32Array, rate: number, hz: number) {
  let re = 0,
    im = 0;
  for (let i = 0; i < out.length; i++) {
    re += out[i] * Math.cos((2 * Math.PI * hz * i) / rate);
    im += out[i] * Math.sin((2 * Math.PI * hz * i) / rate);
  }
  return (2 * Math.hypot(re, im)) / out.length;
}
function run(d: DeckDSP, t: number, secs: number, rate = 16000) {
  const out = new Float32Array(Math.round(secs * rate));
  for (let i = 0; i < out.length; i += 128) d.process(out.subarray(i, i + 128), Math.min(128, out.length - i), t + i / rate);
  return out;
}

describe('the decks (DSP): two records, a mixer, the concert', () => {
  it('plays each record off the wall clock, round its own loop', () => {
    const d = dsp();
    expect(d.wall(10)).toBe(1000);
    expect(d.restPos(0, 1001.5)).toBeCloseTo(1001.5 % 4, 9);
    expect(d.restPos(1, 1001.5)).toBeCloseTo(1001.5 % 3, 9);
    d.off[1] = 0.5;
    expect(d.restPos(1, 1001.5)).toBeCloseTo((1001.5 + 0.5) % 3, 9);
    d.speed[1] = 1.05;
    expect(d.restPos(1, 1001.5)).toBeCloseTo((1001.5 * 1.05 + 0.5) % 3, 6);
  });

  it('mixes them with the crossfader: left only A, right only B, both in the middle (each at its channel fader)', () => {
    const d = dsp();
    const meas = (xf: number, volA = 1, volB = 1) => {
      d.params.xf = xf;
      d.params.volA = volA;
      d.params.volB = volB;
      run(d, 10, 0.05);
      const out = run(d, 10.05, 0.5);
      return [share(out, 16000, 220), share(out, 16000, 550)];
    };
    const [l0, l1] = meas(0);
    expect(l0).toBeGreaterThan(0.45);
    expect(l1).toBeLessThan(0.01);
    const [r0, r1] = meas(1);
    expect(r0).toBeLessThan(0.01);
    expect(r1).toBeGreaterThan(0.45);
    const [m0, m1] = meas(0.5);
    expect(m0).toBeCloseTo(0.5 * Math.SQRT1_2, 1);
    expect(m1).toBeCloseTo(0.5 * Math.SQRT1_2, 1);
    const [h0, h1] = meas(0.5, 0.5, 0);
    expect(h0).toBeCloseTo(0.25 * Math.SQRT1_2, 1);
    expect(h1).toBeLessThan(0.01);
  });

  it('scratches a record from where it is, and leaves it where you let go (its offset moves, and says so)', () => {
    const d = dsp();
    run(d, 10, 0.05);
    expect(d.decks[0].scratch).toBe(false);
    d.params.holdA = 1;
    d.params.rateA = 0;
    run(d, 10.05, 0.01);
    expect(d.decks[0].scratch).toBe(true);
    const at = d.decks[0].pos;
    run(d, 10.06, 0.5);
    expect(d.decks[0].pos).toBeCloseTo(at, 3);
    // Pulled back a bit.
    d.params.rateA = -1;
    run(d, 10.56, 0.2);
    expect(d.decks[0].pos).toBeLessThan(at - 0.15);
    // Let go, back at speed: it carries on from there (held 0.5 s and pulled back 0.2 s: 0.9 s behind the clock).
    d.params.holdA = 0;
    d.params.rateA = 1;
    run(d, 10.76, 0.01);
    expect(d.decks[0].scratch).toBe(false);
    expect(d.changed).toBe(true);
    const behind = (d.restPos(0, d.wall(10.77)) - d.restPos(0, d.wall(10.77), 0) + 4) % 4;
    expect(4 - behind).toBeCloseTo(0.9, 1);
    // Deck B was never touched: still on the clock.
    expect(d.off[1]).toBe(0);
  });

  it('crossfades to an offset set from outside (a friend at the decks) rather than jumping', () => {
    const d = dsp();
    d.setOffset(0, 1.25);
    expect(d.off[0]).toBe(1.25);
    expect(d.decks[0].fade).toBe(0);
    run(d, 10, 0.01);
    expect(d.decks[0].fade).toBeGreaterThan(0);
    expect(d.decks[0].fade).toBeLessThan(1);
    run(d, 10.01, 0.05);
    expect(d.decks[0].fade).toBe(1);
    // A tiny change (the same place, round the loop) isn't a move.
    d.setOffset(0, 1.25 + 4);
    expect(d.decks[0].fade).toBe(1);
  });

  it('hands the stacks to the concert while she is on, and back to the decks after', () => {
    const d = dsp();
    const live = tone(880, 2);
    d.live = { data: live, sr: SR };
    d.sched = { on: 1, start: 1001, slot: 2, cycle: 10 };
    const at = (w: number) => {
      const out = run(d, 10 + (w - 1000), 0.3);
      return [share(out.subarray(1600), 16000, 220), share(out.subarray(1600), 16000, 880)];
    };
    const [a0, c0] = at(1000.4);
    expect(a0).toBeGreaterThan(0.4);
    expect(c0).toBeLessThan(0.01);
    const [a1, c1] = at(1001.5);
    expect(a1).toBeLessThan(0.01);
    expect(c1).toBeGreaterThan(0.4);
    const [a2, c2] = at(1003.5);
    expect(a2).toBeGreaterThan(0.4);
    expect(c2).toBeLessThan(0.01);
    // The next set, a cycle later.
    expect(d.liveAt(1011.5)).toBeCloseTo(0.5, 6);
    expect(d.liveAt(1013.5)).toBe(-1);
    // Not until her music's loaded.
    d.live = { data: null, sr: SR };
    expect(d.liveAt(1001.5)).toBe(-1);
  });

  it('is self-contained (its source becomes the AudioWorklet module)', () => {
    const Cls = new Function(`return (${DeckDSP.toString()});`)() as typeof DeckDSP;
    const d = new Cls(44100);
    d.recs[0] = { data: new Float32Array(500).fill(0.5), sr: 100, loop: 4 };
    const out = new Float32Array(64);
    d.process(out, 64, 0);
    expect(Number.isFinite(out[63])).toBe(true);
  });
});

describe('the music: records, songs and their sections', () => {
  it('beat-matches deck B to deck A within a turntable\'s pitch range, else leaves it at its own tempo', () => {
    expect(beatMatch(128, 124)).toBeCloseTo(128 / 124, 9);
    expect(beatMatch(128, 64)).toBeCloseTo(1, 9);
    expect(beatMatch(132.8, 91.1)).toBe(1);
    expect(beatMatch(120, 140)).toBe(1);
  });

  it('reads sections from a song\'s energy when it has no map (the loud phrases are the chorus)', () => {
    const lv = (x: number) => ({ drums: x - 7, tonal: x, level: x });
    const per = [...Array(16).fill(-16), ...Array(8).fill(-15), ...Array(16).fill(-10), ...Array(16).fill(-16), ...Array(16).fill(-10)].map(lv);
    const secs = autoSections(per, per.length);
    const at = (bar: number) => secs.find((s) => bar >= s.bar && bar < s.bar + s.bars)!.name;
    expect(at(30)).toBe('chorus');
    expect(at(65)).toBe('chorus');
    expect(at(5)).toBe('verse');
    expect(at(22)).toBe('pre-chorus');
    expect(at(50)).toBe('verse');
    expect(secs.reduce((n, s) => n + s.bars, 0)).toBe(per.length);
    // No energy to go on: a quarter verse, a pre-chorus phrase, chorus.
    const t = autoSections(undefined, 32);
    expect(t.map((s) => s.name)).toEqual(['verse', 'pre-chorus', 'chorus']);
  });

  it("finds her song and where it is in her set", () => {
    const songs = INDEX_SONGS;
    expect(songs.length).toBeGreaterThanOrEqual(1);
    const s = songs[0]!;
    expect(s.title).toBe('Chasing Dawn');
    expect(concertLength(songs)).toBeCloseTo(s.length, 9);
    expect(songAt(songs, 10)).toEqual({ song: 0, t: 10 });
    expect(songAt(songs, s.length + 1).song).toBe(-1);
    // index.json's entry matches the file it was measured from; a different file (by its length) doesn't.
    expect(entryMatches('concert_1', s.firstBeat + 0 + (TRACKS.concert_1.seconds ?? 0))).toBe(true);
    expect(entryMatches('concert_1', 63)).toBe(false);
    expect(DECK_B_PLAN?.title).toBe('Woo and Oh Yeah');
    expect(HOUSE_PLAN.title).toBe('No Tomorrow');
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
    // At the booth the console fills the front; guests on the dance floor never wander up.
    expect(w.isFree(DJ.x, STAGE.z1 - 0.1, 0.25)).toBe(false);
    expect(w.isFree(DJ.x, STAGE.z1 + 0.1, 0.22, true)).toBe(false);
  });

  it("is a drop at the front and the ends you can walk or jump off, but the back and the truss stay solid (and guests never step off)", () => {
    const x = STAGE.spot.x + 1.2;
    // Standing at the front edge, and just past it on the deck: free for you, a wall for walking guests.
    expect(w.isFree(x, STAGE.z1 - 0.1, 0.25)).toBe(true);
    expect(w.isFree(x, STAGE.z1 + 0.1, 0.25)).toBe(true);
    expect(w.isFree(x, STAGE.z1 + 0.1, 0.22, true)).toBe(false);
    expect(w.groundAt(x, STAGE.z1 - 0.05)).toBeCloseTo(STAGE.y, 6);
    expect(w.groundAt(x, STAGE.z1 + 0.05)).toBe(0);
    // A walk off the front goes through (the player's step-up rule is the only thing that holds you back from below).
    const [nx, nz] = w.move(x, STAGE.z1 - 0.2, 0, 0.5, 0.25);
    expect(nz).toBeCloseTo(STAGE.z1 + 0.3, 6);
    expect(nx).toBeCloseTo(x, 6);
    // The west end too.
    expect(w.isFree(STAGE.x0 - 0.12, (STAGE.z0 + STAGE.z1) / 2 + 0.6, 0.25)).toBe(true);
    // The back is a wall, the truss posts are solid.
    expect(w.isFree(x, STAGE.z0 - 0.1, 0.25)).toBe(false);
    expect(w.isFree(STAGE.x0 + 0.15, STAGE.z1 - 0.15, 0.1)).toBe(false);
  });
});
