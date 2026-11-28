import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NIGHT, afterAt, cycleLength, fadeGain, liveSlot, makePlan, needsPlan, newer, nightAt, nightTimes, packPlan, programAt, unpackPlan, type Plan, type Timing } from '../src/client/party/schedule';
import { packDecks, unpackDecks } from '../src/client/party/deckwire';
import { measureTrack } from '../src/client/party/tempo';
import { Audience, GATHER_OVER, audienceSpots } from '../src/client/party/audience';
import { AFTER_PLAN, HOUSE_PLAN, INDEX_SONGS, concertLength } from '../src/client/party/setlist';
import { DeckDSP } from '../src/client/party/scratch';
import { STAGE } from '../src/client/areas/pool';
import { Person } from '../src/client/people';

const N = nightTimes(HOUSE_PLAN.length, HOUSE_PLAN.bar);
const T: Timing = { bar: HOUSE_PLAN.bar, liveLen: concertLength(INDEX_SONGS), lead: N.lead, after: AFTER_PLAN?.length ?? 0 };

describe('the night (schedule)', () => {
  const now = 1_765_000_000.123;
  const plan = makePlan(now, T, '7');
  const at = (u: number) => nightAt(now + u, plan, T, N);

  it('is "No Tomorrow", long enough for the call at 1:30 and the fade at 2:30', () => {
    expect(HOUSE_PLAN.title).toBe('No Tomorrow');
    expect(AFTER_PLAN?.title).toBe('One More Drop');
    expect(HOUSE_PLAN.length).toBeGreaterThan(150 + NIGHT.fadeLen);
    expect(N.announce).toBe(90);
    expect(N.fadeAt).toBe(150);
    expect(N.fadeLen).toBeGreaterThanOrEqual(4);
    // A few seconds between the decks falling silent and her set (the crowd, the band, her walk-on): never dead air for long.
    const gap = N.lead - N.fadeAt - N.fadeLen;
    expect(gap).toBeGreaterThanOrEqual(NIGHT.walkOn);
    expect(gap).toBeLessThan(NIGHT.walkOn + HOUSE_PLAN.bar + 1e-6);
    // Her set on the house record's bar line, counted from its top.
    expect(Math.abs(N.lead / HOUSE_PLAN.bar - Math.round(N.lead / HOUSE_PLAN.bar))).toBeLessThan(1e-9);
  });

  it('starts the party as the first of you arrives: "No Tomorrow" from its top, her set `lead` later', () => {
    expect(needsPlan(null)).toBe(true);
    expect(needsPlan(plan)).toBe(false);
    expect(plan.start - now).toBeCloseTo(N.lead, 5);
    const n = at(0);
    expect(n).toMatchObject({ phase: 'dj', round: 0, gain: 1, gather: -1, sinceCall: -1 });
    expect(n.party).toBeCloseTo(0, 5);
    expect(n.anchor).toBeCloseTo(now, 5);
    expect(n.toSet).toBeCloseTo(N.lead, 4);
    expect(nightAt(now, null, T, N).phase).toBe('none');
  });

  it('calls her at 1:30, the crowd drifts over from a few seconds later, the fade at 2:30, her set, then One More Drop', () => {
    expect(at(89.9).phase).toBe('dj');
    expect(at(90).phase).toBe('called');
    expect(at(90).sinceCall).toBeCloseTo(0, 4);
    expect(at(92.9).gather).toBe(-1);
    expect(at(93.5).gather).toBeCloseTo(0.5, 4);
    expect(at(149.9)).toMatchObject({ phase: 'called', gain: 1 });
    // The fade: 2:30 to 2:36, a fader's curve, down to nothing.
    expect(at(150)).toMatchObject({ phase: 'fade' });
    expect(at(150).gain).toBeCloseTo(1, 4);
    expect(at(153).gain).toBeCloseTo(0.25, 4);
    expect(at(155.9).gain).toBeLessThan(0.01);
    for (let u = 150; u < 156; u += 0.25) expect(at(u + 0.25).gain).toBeLessThanOrEqual(at(u).gain + 1e-12);
    expect(at(156)).toMatchObject({ phase: 'walkon', gain: 0 });
    expect(at(N.lead - 0.01)).toMatchObject({ phase: 'walkon', gain: 0 });
    // Her set, on the stage's PA (the decks silent through it); the crowd still in front of her.
    const s = at(N.lead + 0.001);
    expect(s).toMatchObject({ phase: 'live', gain: 0, toSet: 0 });
    expect(s.gather).toBeCloseTo(N.lead - N.gatherAt, 2);
    expect(programAt(now + N.lead + 10, plan, T)).toMatchObject({ live: true, set: 0 });
    expect(programAt(now + N.lead + 10, plan, T).into).toBeCloseTo(10, 4);
    // Her set's over: the DJ kicks back in with One More Drop, the crowd heads back.
    const slot = liveSlot(T);
    const e = at(N.lead + slot + 1);
    expect(e).toMatchObject({ phase: 'after', gain: 1, gather: -1 });
    expect(e.since).toBeCloseTo(1, 4);
    expect(afterAt(now + N.lead + slot + 1, plan, T, T.after)).toBeCloseTo(1, 4);
    expect(afterAt(now + N.lead + slot - 0.01, plan, T, T.after)).toBe(-1);
  });

  it('goes round again: "No Tomorrow" from its top as One More Drop ends, the call at 1:30 again', () => {
    const C = cycleLength(T);
    expect(C).toBeCloseTo(N.lead + liveSlot(T) + T.after, 4);
    // From the last second of her set the house record is on the next round's grid (silent under her).
    expect(at(N.lead + liveSlot(T) - 2).anchor).toBeCloseTo(now, 4);
    expect(at(N.lead + liveSlot(T) - 0.5).anchor).toBeCloseTo(now + C, 4);
    expect(afterAt(now + C - 0.01, plan, T, T.after)).toBeGreaterThan(0);
    expect(afterAt(now + C + 0.01, plan, T, T.after)).toBe(-1);
    const r = at(C + 0.01);
    expect(r).toMatchObject({ phase: 'dj', round: 1, gain: 1 });
    expect(r.party).toBeCloseTo(0.01, 4);
    expect(at(C + 90.5)).toMatchObject({ phase: 'called', round: 1 });
    expect(programAt(now + C + N.lead + 1, plan, T)).toMatchObject({ live: true, set: 1 });
  });

  it('a late joiner lands where the night is: the same bar of the record, or her set in progress', () => {
    // Someone arriving 2:05 in hears "No Tomorrow" 2:05 in (the house record plays from the anchor round its loop).
    const late = nightAt(now + 125, unpackPlan(packPlan(plan)), T, N);
    expect(late.phase).toBe('called');
    expect(late.party).toBeCloseTo(125, 2);
    expect(now + 125 - late.anchor).toBeCloseTo(125, 2);
    expect(late.gather).toBeCloseTo(125 - N.gatherAt, 2);
    const mid = programAt(now + N.lead + 61, plan, T);
    expect(mid.live).toBe(true);
    expect(mid.into).toBeCloseTo(61, 2);
  });

  it('copes with a house record too short for 2:30 and the fade: the fade ends just before the record does', () => {
    const n = nightTimes(120, 2);
    expect(n.fadeAt + n.fadeLen).toBeLessThanOrEqual(120);
    expect(n.fadeAt + n.fadeLen).toBeGreaterThan(119);
    expect(n.announce).toBeCloseTo(n.fadeAt - 60, 9);
    expect(n.lead).toBeGreaterThanOrEqual(n.fadeAt + n.fadeLen + NIGHT.walkOn);
    expect(fadeGain(n.lead - n.fadeAt + 1, n)).toBe(1);
    expect(fadeGain(n.lead - n.fadeAt - n.fadeLen, n)).toBe(0);
    // Very short: the call at the top.
    expect(nightTimes(40, 2).announce).toBe(0);
  });

  it('fades the booth\'s stacks on the audio thread on the same schedule, and keeps them silent through her set', () => {
    const SR = 8000;
    const d = new DeckDSP(SR);
    d.recs[0] = { data: new Float32Array(SR * 5).map((_, i) => Math.sin(i * 0.3) * 0.5), sr: SR, loop: 4 };
    d.live = { data: new Float32Array(SR * 30), sr: SR };
    const lead = 30,
      fadeAt = 10;
    d.sched = { on: 1, start: 1000 + lead, slot: 20, cycle: 200, after: 0, fadeTo: lead - fadeAt, fadeLen: 6 };
    const rms = (w: number) => {
      const out = new Float32Array(400),
        live = new Float32Array(400);
      for (let k = 0; k < 3; k++) d.process(out, 400, w + (k * 400) / SR - 1000, live);
      return Math.sqrt(out.reduce((s, x) => s + x * x, 0) / out.length);
    };
    d.t0 = 0;
    d.w0 = 1000;
    const full = rms(1005);
    expect(full).toBeGreaterThan(0.2);
    expect(rms(1013) / full).toBeCloseTo(0.25, 1);
    expect(rms(1017)).toBeLessThan(0.01);
    expect(rms(1031)).toBeLessThan(0.01);
    // After her set: back up (the DJ's on again).
    expect(rms(1000 + lead + 21) / full).toBeGreaterThan(0.9);
    // Without her music loaded: the DJ plays on.
    d.live = { data: null, sr: SR };
    expect(rms(1017) / full).toBeGreaterThan(0.9);
    expect(d.djGain(1017)).toBe(1);
  });

  it('runs DJ, her set, DJ, her again, round and round', () => {
    const p: Plan = { start: 1000, rev: 1, by: '1' };
    const slot = liveSlot(T),
      C = cycleLength(T);
    expect(slot).toBeGreaterThanOrEqual(T.liveLen);
    expect(slot - T.liveLen).toBeLessThan(T.bar);
    expect(programAt(900, p, T)).toMatchObject({ live: false, next: 100, set: -1 });
    expect(programAt(1010, p, T)).toMatchObject({ live: true, set: 0 });
    const after = programAt(1000 + slot + 5, p, T);
    expect(after.live).toBe(false);
    expect(after.next).toBeCloseTo(C - slot - 5, 6);
    expect(programAt(1000 + C + 1, p, T)).toMatchObject({ live: true, set: 1 });
    expect(programAt(5, null, T).next).toBe(Infinity);
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

  it('drifts over after the call, a few at a time, everyone in place by the fade, and goes home after: from the clock alone', () => {
    const a = new Audience(dancers, extras, free, Math.PI, GATHER_OVER);
    const her = new THREE.Vector3(STAGE.spot.x, STAGE.y, STAGE.spot.z);
    a.update(0.1, { gather: -1, since: Infinity }, her);
    expect(extras.every((p) => p.away)).toBe(true);
    const home = dancers.map((p) => p.pos.clone());
    // Staggered: each sets off at their own moment through the minute, not all at once at the end.
    const walkers = a.members.filter((m) => m.arrive > m.go);
    const go = walkers.map((m) => m.go).sort((x, y) => x - y);
    expect(go[go.length - 1] - go[0]).toBeGreaterThan(GATHER_OVER * 0.4);
    for (const g of go) expect(go.filter((h) => h >= g && h < g + 5).length).toBeLessThanOrEqual(Math.ceil(walkers.length / 3));
    for (const m of walkers) expect(m.arrive).toBeLessThanOrEqual(GATHER_OVER);
    // In their places by the end of the gathering (the DJ's faded out), and through her set.
    a.update(0.1, { gather: GATHER_OVER, since: Infinity }, her);
    expect(extras.every((p) => !p.away)).toBe(true);
    expect(a.here).toBe(4);
    for (const p of [...dancers, ...extras]) {
      expect(p.pos.z).toBeGreaterThan(STAGE.z1);
      expect(p.pos.z).toBeLessThan(STAGE.z1 + 3);
      expect(p.pos.x).toBeGreaterThan(STAGE.x0 - 0.5);
      expect(p.pos.x).toBeLessThan(STAGE.x1 + 0.5);
    }
    // Two clients at the same moment see the same crowd.
    a.update(0.1, { gather: 200, since: Infinity }, her);
    const again = dancers.map((p) => p.pos.clone());
    const b = new Audience(dancers, extras, free, Math.PI, GATHER_OVER);
    b.update(0.1, { gather: 200, since: Infinity }, her);
    dancers.forEach((p, i) => expect(p.pos.distanceTo(again[i])).toBeLessThan(1e-9));
    // Mid-gathering: the first extras are in, the last aren't yet.
    a.update(0.1, { gather: 20, since: Infinity }, her);
    expect(extras[0].away).toBe(false);
    expect(extras[3].away).toBe(true);
    // A minute after her set: everyone's home, the extras gone.
    a.update(0.1, { gather: -1, since: 60 }, her);
    expect(extras.every((p) => p.away)).toBe(true);
    dancers.forEach((p, i) => expect(p.pos.distanceTo(home[i])).toBeLessThan(1e-6));
  });
});
