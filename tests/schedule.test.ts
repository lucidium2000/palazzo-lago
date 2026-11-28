import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SCHEDULE, alignUp, cycleLength, liveSlot, makePlan, needsPlan, newer, packPlan, programAt, unpackPlan, type Plan } from '../src/client/party/schedule';
import { packDecks, unpackDecks } from '../src/client/party/deckwire';
import { measureTrack } from '../src/client/party/tempo';
import { Audience, audienceSpots } from '../src/client/party/audience';
import { HOUSE_PLAN, INDEX_SONGS, concertLength } from '../src/client/party/setlist';
import { STAGE } from '../src/client/areas/pool';
import { Person } from '../src/client/people';

const T = { bar: HOUSE_PLAN.bar, liveLen: concertLength(INDEX_SONGS) };

describe('the running order (schedule)', () => {
  it('brings her on 60..120 s after you arrive, on a phrase line of the house record', () => {
    const now = 1_765_000_000.123;
    for (const r of [0, 0.25, 0.5, 0.75, 1]) {
      const p = makePlan(now, T, r, '7');
      expect(p.start - now).toBeGreaterThanOrEqual(SCHEDULE.firstMin);
      expect(p.start - now).toBeLessThanOrEqual(SCHEDULE.firstMax);
      const phrases = p.start / (T.bar * SCHEDULE.align);
      expect(Math.abs(phrases - Math.round(phrases))).toBeLessThan(1e-6);
    }
    expect(alignUp(10.01, 1)).toBeCloseTo(12, 9);
  });

  it('runs DJ, her set, DJ for a few minutes, her again, round and round', () => {
    const plan: Plan = { start: 1000, rev: 1, by: '1' };
    const slot = liveSlot(T),
      C = cycleLength(T);
    expect(slot).toBeGreaterThanOrEqual(T.liveLen);
    expect(slot - T.liveLen).toBeLessThan(T.bar);
    expect(C - slot).toBeGreaterThan(SCHEDULE.gap - 2 * T.bar * SCHEDULE.align);
    expect(programAt(900, plan, T)).toMatchObject({ live: false, next: 100, set: -1 });
    expect(programAt(1010, plan, T)).toMatchObject({ live: true, set: 0 });
    expect(programAt(1010, plan, T).into).toBeCloseTo(10, 9);
    const after = programAt(1000 + slot + 5, plan, T);
    expect(after.live).toBe(false);
    expect(after.next).toBeCloseTo(C - slot - 5, 6);
    expect(programAt(1000 + C + 1, plan, T)).toMatchObject({ live: true, set: 1 });
    expect(programAt(5, null, T).next).toBe(Infinity);
  });

  it('only makes a new plan when her next set is far off, never cutting one short', () => {
    const plan: Plan = { start: 1000, rev: 1, by: '1' };
    expect(needsPlan(500, null, T)).toBe(true);
    expect(needsPlan(950, plan, T)).toBe(false);
    expect(needsPlan(1005, plan, T)).toBe(false);
    expect(needsPlan(800, plan, T)).toBe(true);
    // Just after her set: the DJ's stretch is longer than two minutes, so a new arrival brings her back sooner.
    expect(needsPlan(1000 + liveSlot(T) + 10, plan, T)).toBe(true);
  });

  it('agrees across a room: the newest plan wins (then the larger tag), and survives the wire', () => {
    const a: Plan = { start: 2000, rev: 10, by: '5' };
    const b: Plan = { start: 2050, rev: 11, by: '3' };
    const c: Plan = { start: 2100, rev: 11, by: '9' };
    expect(newer(a, b)).toBe(b);
    expect(newer(b, a)).toBe(b);
    expect(newer(b, c)).toBe(c);
    expect(newer(c, b)).toBe(c);
    expect(newer(null, a)).toBe(a);
    // Everyone folding everyone's plans in, in any order, ends on the same one.
    const orders = [[a, b, c], [c, b, a], [b, a, c]];
    for (const o of orders) expect(o.reduce<Plan | null>((x, y) => newer(x, y), null)).toBe(c);
    const back = unpackPlan(packPlan(c));
    expect(back).toEqual({ start: 2100, rev: 11, by: '9' });
    expect(unpackPlan('nope')).toBeNull();
  });
});

describe("a friend's decks on the wire", () => {
  it('round-trips the faders, the records and the platters', () => {
    const v = { xf: 0.37, volA: 0.8, volB: 1, offA: 12.345, offB: -0.5, rateA: 1, rateB: -1.5, holdA: 0, holdB: 1 };
    const u = unpackDecks(packDecks(v))!;
    expect(u.xf).toBeCloseTo(0.37, 3);
    expect(u.volA).toBeCloseTo(0.8, 3);
    expect(u.offA).toBeCloseTo(12.345, 3);
    expect(u.offB).toBeCloseTo(-0.5, 3);
    expect(u.rateB).toBeCloseTo(-1.5, 2);
    expect([u.holdA, u.holdB]).toEqual([0, 1]);
    expect(unpackDecks([1, 2])).toBeNull();
  });
});

describe('measuring a dropped-in song (tempo.ts)', () => {
  it('finds the tempo, the first downbeat and the bars of a beat', () => {
    const sr = 11025,
      bpm = 126,
      first = 0.4,
      secs = 40;
    const x = new Float32Array(sr * secs);
    const beat = 60 / bpm;
    let seed = 1;
    for (let k = 0; first + k * beat < secs; k++) {
      const t0 = Math.round((first + k * beat) * sr);
      // A kick on every beat (louder on the one), a hat on the off-beats.
      const amp = k % 4 === 0 ? 1 : 0.6;
      for (let i = 0; i < sr * 0.12 && t0 + i < x.length; i++) x[t0 + i] += amp * Math.sin(2 * Math.PI * 60 * (i / sr)) * Math.exp(-i / (sr * 0.04));
      const h = Math.round((first + (k + 0.5) * beat) * sr);
      for (let i = 0; i < sr * 0.03 && h + i < x.length; i++) {
        seed = (seed * 16807) % 2147483647;
        x[h + i] += 0.15 * (seed / 1073741823 - 1) * Math.exp(-i / (sr * 0.008));
      }
    }
    const m = measureTrack(x, sr);
    expect(m.bpm).toBeCloseTo(bpm, 0);
    // (Its grid sits a touch after the onsets, like index.json's.)
    const offBeats = (m.firstBeat - first) / beat;
    expect(Math.abs(offBeats - Math.round(offBeats))).toBeLessThan(0.15);
    expect(m.bars).toBeGreaterThan(18);
    expect(m.perBar).toHaveLength(m.bars);
  });
});

describe("her audience", () => {
  const free = () => true;
  const dancers = Array.from({ length: 6 }, (_, k) => {
    const p = new Person('watch', { dress: false, main: 0, second: 0, skin: 0, hair: 0, hairStyle: 'short', height: 1.8 });
    p.pos.set(k < 2 ? 42 + k : 48 + k, 0, k < 2 ? STAGE.z1 + 0.9 : -29.5);
    p.homeYaw = Math.PI;
    return p;
  });
  const extras = Array.from({ length: 4 }, () => new Person('watch', { dress: false, main: 0, second: 0, skin: 0, hair: 0, hairStyle: 'short', height: 1.8 }));

  it('has places in front of her stage, best first', () => {
    const s = audienceSpots(free);
    expect(s.length).toBeGreaterThan(20);
    for (const v of s) expect(v.y).toBeGreaterThan(STAGE.z1);
    expect(Math.abs(s[0].x - STAGE.spot.x)).toBeLessThan(0.5);
  });

  it('gathers in front of her as she comes on, doubles over a minute and a half, and goes home after: from the clock alone', () => {
    const a = new Audience(dancers, extras, free, Math.PI);
    const her = new THREE.Vector3(STAGE.spot.x, STAGE.y, STAGE.spot.z);
    a.update(0.1, { into: -1, since: Infinity }, her);
    expect(extras.every((p) => p.away)).toBe(true);
    const home = dancers.map((p) => p.pos.clone());
    a.update(0.1, { into: 120, since: Infinity }, her);
    expect(extras.every((p) => !p.away)).toBe(true);
    expect(a.here).toBe(4);
    for (const p of [...dancers, ...extras]) {
      expect(p.pos.z).toBeGreaterThan(STAGE.z1);
      expect(p.pos.z).toBeLessThan(STAGE.z1 + 3);
      expect(p.pos.x).toBeGreaterThan(STAGE.x0 - 0.5);
      expect(p.pos.x).toBeLessThan(STAGE.x1 + 0.5);
    }
    // Two clients at the same moment see the same crowd.
    const again = dancers.map((p) => p.pos.clone());
    const b = new Audience(dancers, extras, free, Math.PI);
    b.update(0.1, { into: 120, since: Infinity }, her);
    dancers.forEach((p, i) => expect(p.pos.distanceTo(again[i])).toBeLessThan(1e-9));
    // Mid-arrival: the first extras are in, the last aren't yet.
    a.update(0.1, { into: 20, since: Infinity }, her);
    expect(extras[0].away).toBe(false);
    expect(extras[3].away).toBe(true);
    // A minute after her set: everyone's home, the extras gone.
    a.update(0.1, { into: -1, since: 60 }, her);
    expect(extras.every((p) => p.away)).toBe(true);
    dancers.forEach((p, i) => expect(p.pos.distanceTo(home[i])).toBeLessThan(1e-6));
  });
});
