import { describe, expect, it } from 'vitest';
import { BeatClock, PARTY, beatAt, beatLen, kickIn, loopLength, sectionOf } from '../src/client/party/beat';
import { BobDetector } from '../src/client/party/rhythm';

const B = beatLen();
const BAR = B * 4;

describe('beat clock', () => {
  it('runs at the party tempo and loops seamlessly', () => {
    expect(PARTY.bpm).toBeGreaterThanOrEqual(120);
    expect(PARTY.bpm).toBeLessThanOrEqual(124);
    expect(loopLength()).toBeCloseTo(PARTY.bars * 4 * (60 / PARTY.bpm), 6);
    const a = beatAt(3.3),
      b = beatAt(3.3 + loopLength());
    expect(b.beat).toBe(a.beat);
    expect(b.phase).toBeCloseTo(a.phase, 6);
    // Negative time wraps too.
    expect(beatAt(-B * 0.5).beat).toBe(PARTY.bars * 4 - 1);
  });

  it('counts beats, bars and phase', () => {
    const s = beatAt(BAR * 5 + B * 2 + B * 0.25);
    expect(s.bar).toBe(5);
    expect(s.beatInBar).toBe(2);
    expect(s.phase).toBeCloseTo(0.25, 6);
    expect(s.barPhase).toBeCloseTo((2 + 0.25) / 4, 6);
    expect(beatAt(BAR * 40).cycleBar).toBe(8);
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
    const c = new BeatClock();
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
