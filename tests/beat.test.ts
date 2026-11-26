import { describe, expect, it } from 'vitest';
import { BeatClock, DETECT, PARTY, SYNTH_SET, arrangement, arrangementLength, beatAt, beatLen, detectSections, kickIn, loopLength, sectionOf, synthSections } from '../src/client/party/beat';
import { DJ_BARS, DJ_ONLY, DJ_TRACK, FULL_SET, SET_BPM, SLOT_BARS } from '../src/client/party/setlist';
import { BobDetector } from '../src/client/party/rhythm';

const B = beatLen();
const BAR = B * 4;

const SB = (bpm: number) => (60 / bpm) * 4;

describe('beat clock (the synthesized fallback set)', () => {
  it('runs at the party tempo and loops seamlessly', () => {
    expect(PARTY.bpm).toBeGreaterThanOrEqual(120);
    expect(PARTY.bpm).toBeLessThanOrEqual(124);
    expect(loopLength()).toBeCloseTo(PARTY.bars * 4 * (60 / PARTY.bpm), 6);
    const a = beatAt(3.3),
      b = beatAt(3.3 + loopLength(PARTY.bpm, SYNTH_SET.bars.length));
    expect(b.beat).toBe(a.beat);
    expect(b.phase).toBeCloseTo(a.phase, 6);
    // Negative time wraps too.
    expect(beatAt(-B * 0.5).beat).toBe(SYNTH_SET.bars.length * 4 - 1);
  });

  it('counts beats, bars and phase', () => {
    const s = beatAt(BAR * 5 + B * 2 + B * 0.25);
    expect(s.bar).toBe(5);
    expect(s.beatInBar).toBe(2);
    expect(s.phase).toBeCloseTo(0.25, 6);
    expect(s.barPhase).toBeCloseTo((2 + 0.25) / 4, 6);
    expect(beatAt(BAR * 40.5).secBar).toBe(8);
    expect(beatAt(BAR * 40.5).secLen).toBe(16);
  });

  it('drops, breaks down and builds every 32 bars', () => {
    expect(sectionOf(0)).toBe('drop');
    expect(sectionOf(15)).toBe('drop');
    expect(sectionOf(16)).toBe('break');
    expect(sectionOf(23)).toBe('break');
    expect(sectionOf(24)).toBe('build');
    expect(sectionOf(31)).toBe('build');
    expect(sectionOf(32)).toBe('drop');
    expect(sectionOf(63)).toBe('build');
    // The kick is out in the breakdown and the last 4 bars of the build.
    expect(kickIn(3)).toBe(true);
    expect(kickIn(18)).toBe(false);
    expect(kickIn(25)).toBe(true);
    expect(kickIn(29)).toBe(false);
    expect(kickIn(32)).toBe(true);
  });

  it('intensity: full on the drop, low in the breakdown, rising through the build', () => {
    expect(beatAt(BAR * 1).intensity).toBe(1);
    expect(beatAt(BAR * 18).intensity).toBeLessThan(0.45);
    const builds = [24, 26, 28, 30, 31.9].map((bar) => beatAt(BAR * bar));
    for (let i = 1; i < builds.length; i++) expect(builds[i].intensity).toBeGreaterThan(builds[i - 1].intensity);
    expect(builds[0].build).toBeCloseTo(0, 6);
    expect(builds[4].build).toBeGreaterThan(0.95);
    expect(beatAt(BAR * 2).build).toBe(0);
  });

  it('pulses on the beat', () => {
    expect(beatAt(BAR * 2).pulse).toBeCloseTo(1, 6);
    expect(beatAt(BAR * 2 + B * 0.5).pulse).toBeLessThan(0.1);
    // Softer with no kick.
    expect(beatAt(BAR * 18).pulse).toBeLessThan(0.5);
  });

  it('reports beat, bar and drop edges, across the loop end', () => {
    const arr = arrangement(PARTY.bpm, synthSections());
    const c = new BeatClock(arr);
    let beats = 0,
      bars = 0,
      drops = 0;
    const dt = 1 / 72;
    // Run a full loop and a bit, starting just before the end.
    const start = loopLength() - BAR * 2 - 0.01;
    for (let t = start; t < start + loopLength() + BAR * 3; t += dt) {
      c.update(t);
      if (c.onBeat) beats++;
      if (c.onBar) bars++;
      if (c.onDrop) drops++;
    }
    expect(bars).toBe(PARTY.bars + 3);
    expect(beats).toBeGreaterThanOrEqual((PARTY.bars + 3) * 4);
    expect(beats).toBeLessThanOrEqual((PARTY.bars + 3) * 4 + 1);
    // From bar 62: the wrap to bar 0, bar 32, and bar 0 again.
    expect(drops).toBe(3);
  });

  it('ignores a jump (paused tab) rather than firing a burst of beats', () => {
    const c = new BeatClock();
    c.update(1);
    c.update(30);
    expect(c.onBeat).toBe(false);
    expect(c.onDrop).toBe(false);
  });
});

describe('the real set: sections read from the measured music', () => {
  it("finds the DJ set's drops where its drums jump, its breakdown where they're low, and the builds into each drop", () => {
    const drops = DJ_BARS.flatMap((b, i) => (b.drop ? [i] : []));
    // Bar 0 (out of the dip at bar 63, round the loop) and bar 40 (out of the breakdown;
    // the jump starts in bar 39, the build's fill, and lands on the phrase line).
    expect(drops).toEqual([0, 40]);
    for (let i = 30; i < 36; i++) expect(DJ_BARS[i].section).toBe('break');
    for (let i = 36; i < 40; i++) expect(DJ_BARS[i].section).toBe('build');
    expect(DJ_BARS[63].section).toBe('build');
    for (const i of [1, 10, 20, 50, 62]) expect(DJ_BARS[i].section).toBe('drop');
    // No kick in the breakdown; the drop hits hardest.
    expect(DJ_BARS[33].kick).toBe(false);
    expect(DJ_BARS[5].kick).toBe(true);
    expect(DJ_BARS[5].intensity).toBeGreaterThan(0.95);
    expect(DJ_BARS[33].intensity).toBeLessThan(0.45);
    // A drop is a real jump in the measured drums.
    for (const i of drops) {
      const d = DJ_TRACK.perBar.map((p) => p.drums);
      const before = Math.min(d[(i - 2 + 64) % 64], d[(i - 1 + 64) % 64]);
      expect(d[i] - before).toBeGreaterThan(DETECT.jump);
    }
  });

  it('reads a drop from any big jump in the drums, not a fixed pattern', () => {
    const flat = (drums: number) => ({ drums, tonal: -20, level: drums < -30 ? -20 : -11 });
    const per = [...Array(10).fill(-20), ...Array(6).fill(-40), ...Array(16).fill(-14)].map(flat);
    const bars = detectSections(per, false);
    expect(bars.flatMap((b, i) => (b.drop ? [i] : []))).toEqual([16]);
    expect(bars[10].section).toBe('break');
    expect(bars[15].section).toBe('build');
    expect(bars[16].section).toBe('drop');
  });

  it('runs the whole set list on one clock: the DJ, then the headliner, at the measured tempo', () => {
    expect(SET_BPM).toBeCloseTo(121.978, 3);
    expect(FULL_SET.bars).toHaveLength(SLOT_BARS * 2);
    expect(DJ_ONLY.bars).toHaveLength(SLOT_BARS * 2);
    const loop = arrangementLength(FULL_SET);
    expect(loop).toBeCloseTo(SLOT_BARS * 2 * SB(SET_BPM), 9);
    const c = new BeatClock(FULL_SET);
    const drops: number[] = [];
    for (let t = -0.01; t < loop + 0.5; t += 1 / 60) {
      c.update(t);
      if (c.onDrop) drops.push(c.now.bar);
    }
    // The DJ's two drops, then the chorus of each song (and the DJ again, round the loop).
    expect(drops).toEqual([0, 40, 80, 112, 0]);
    // The clock's beat 0 is the track's first beat: one beat in is one measured beat later.
    expect(beatAt(60 / SET_BPM + 1e-6, FULL_SET).beat).toBe(1);
    expect(beatAt(60 / SET_BPM + 1e-6, FULL_SET).phase).toBeCloseTo(0, 4);
  });
});

describe('head bob rhythm detector', () => {
  const run = (secs: number, head: (t: number, beats: number) => number, d = new BobDetector()) => {
    const dt = 1 / 72;
    for (let t = 0; t < secs; t += dt) d.update(dt, head(t, t / B), t / B);
    return d;
  };

  it('stays still when you stand still', () => {
    const d = run(6, () => 1.65);
    expect(d.level).toBe(0);
  });

  it('locks onto a bob on every beat (any phase)', () => {
    for (const ph of [0, 0.3, 0.75]) {
      const d = run(6, (_t, b) => 1.65 + 0.03 * Math.cos(2 * Math.PI * (b + ph)));
      expect(d.lock).toBeGreaterThan(0.8);
      expect(d.level).toBeGreaterThan(0.8);
      expect(d.amp).toBeGreaterThan(0.02);
    }
  });

  it('also counts a half-time bob (every two beats)', () => {
    const d = run(7, (_t, b) => 1.65 + 0.04 * Math.sin(Math.PI * b));
    expect(d.level).toBeGreaterThan(0.7);
  });

  it('ignores a bob that is off the tempo', () => {
    const d = run(10, (t) => 1.65 + 0.03 * Math.sin(2 * Math.PI * (PARTY.bpm / 60) * 0.7 * t));
    expect(d.lock).toBeLessThan(0.4);
    expect(d.level).toBeLessThan(0.2);
  });

  it('ignores a tiny tremble and slow crouching', () => {
    const tremble = run(6, (_t, b) => 1.65 + 0.003 * Math.cos(2 * Math.PI * b));
    expect(tremble.level).toBeLessThan(0.1);
    const crouch = run(6, (t) => 1.65 - Math.min(0.4, t * 0.15));
    expect(crouch.level).toBeLessThan(0.1);
  });

  it('ignores jittery noise', () => {
    let s = 11;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5;
    const d = run(8, () => 1.65 + rnd() * 0.04);
    expect(d.level).toBeLessThan(0.25);
  });

  it('dips: the head below its average is how far the knees bend', () => {
    const d = new BobDetector();
    for (let i = 0; i < 300; i++) d.update(1 / 72, 1.65, i / 72 / B);
    d.update(1 / 72, 1.6, 0);
    expect(d.dip).toBeGreaterThan(0.04);
    expect(d.dip).toBeLessThan(0.051);
  });

  it('keeps dancing through a missed beat, then stops', () => {
    const d = run(6, (_t, b) => 1.65 + 0.03 * Math.cos(2 * Math.PI * b));
    const on = d.level;
    // Half a second still: still dancing.
    run(0.5, () => 1.65, d);
    expect(d.level).toBeGreaterThan(on * 0.4);
    run(6, () => 1.65, d);
    expect(d.level).toBeLessThan(0.15);
  });
});
