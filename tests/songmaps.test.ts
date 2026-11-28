import { describe, expect, it } from 'vitest';
import { DRUM, FFT, MAP_RATE, analyseSong, drummerHands, frameAt, lastAt, strikeLift } from '../src/client/party/songmaps';
import { DANCE_HEAVY, MOVES, fitToVocals, routineFor, songEndBar, stepAt } from '../src/client/party/routine';
import { INDEX_SONGS } from '../src/client/party/setlist';
import { DeckDSP } from '../src/client/party/scratch';

const SR = 32000;
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

/** A kick (a pitch-swept sine thump), a snare (noise and a 200 Hz body), a closed hat (high-passed noise). */
function addKick(x: Float32Array, t: number, g = 0.6) {
  const s = Math.round(t * SR);
  for (let i = 0; i < 0.25 * SR && s + i < x.length; i++) {
    const tt = i / SR;
    x[s + i] += g * Math.sin(2 * Math.PI * (55 + 120 * Math.exp(-tt * 30)) * tt) * Math.exp(-tt * 12);
  }
}
function addSnare(x: Float32Array, t: number) {
  const s = Math.round(t * SR);
  for (let i = 0; i < 0.15 * SR && s + i < x.length; i++) {
    const tt = i / SR;
    x[s + i] += (0.3 * rnd() + 0.3 * Math.sin(2 * Math.PI * 200 * tt)) * Math.exp(-tt * 25);
  }
}
function addHat(x: Float32Array, t: number) {
  const s = Math.round(t * SR);
  let prev = 0;
  for (let i = 0; i < 0.05 * SR && s + i < x.length; i++) {
    const tt = i / SR;
    const n = rnd();
    x[s + i] += 0.15 * (n - prev) * Math.exp(-tt * 80);
    prev = n;
  }
}
const nearest = (det: ArrayLike<number>, t: number) => {
  let best = Infinity;
  for (let i = 0; i < det.length; i++) if (Math.abs(det[i] - t) < Math.abs(best)) best = det[i] - t;
  return best;
};

describe('the FFT', () => {
  it('finds a sine in its bin', () => {
    const n = 256,
      f = new FFT(n);
    const re = new Float32Array(n),
      im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 10 * i) / n);
    f.run(re, im);
    expect(Math.hypot(re[10], im[10])).toBeCloseTo(n / 2, 2);
    expect(Math.hypot(re[11], im[11])).toBeLessThan(1e-3);
  });
});

describe('onset detection (songmaps.ts) on a synthetic drum track', () => {
  // Eight seconds at 120 bpm: kicks on every beat, a snare on 2 and 4, hats on the off-beats,
  // nudged off the analysis grid by a different fraction each time.
  const n = SR * 8;
  const mid = new Float32Array(n);
  const beat = 0.5;
  const kicks: number[] = [],
    snares: number[] = [],
    hats: number[] = [];
  for (let b = 0; b < 15; b++) {
    const t = 0.1 + b * beat + b * 0.0013;
    kicks.push(t);
    if (b % 2) snares.push(t);
    hats.push(t + beat / 2);
  }
  kicks.forEach((t) => addKick(mid, t));
  snares.forEach((t) => addSnare(mid, t));
  hats.forEach((t) => addHat(mid, t));
  const m = analyseSong(mid, null, SR, { bpm: 120 });

  it('finds every kick, snare and hat once, within 15 ms', () => {
    for (const [det, truth] of [
      [m.kick, kicks],
      [m.snare, snares],
      [m.hat, hats],
    ] as const) {
      expect(det.length).toBe(truth.length);
      for (const t of truth) expect(Math.abs(nearest(det, t))).toBeLessThan(0.015);
    }
  });

  it("gives the drummer's right hand the hats and his left the snares, his foot the kicks", () => {
    for (let i = 0; i < m.rHits.length; i++) expect(m.rDrum[i]).toBe(DRUM.hat);
    for (const t of hats) expect(Math.abs(nearest(m.rHits, t))).toBeLessThan(0.015);
    for (const t of snares) expect(Math.abs(nearest(m.lHits, t))).toBeLessThan(0.015);
  });

  it('brings a stick down onto its drum exactly on each hit, and up between them', () => {
    for (let i = 0; i < m.lHits.length; i++) expect(strikeLift(m.lHits, m.lHits[i], 0.17)).toBe(0);
    for (let i = 0; i + 1 < m.lHits.length; i++) {
      const mid = (m.lHits[i] + m.lHits[i + 1]) / 2;
      expect(strikeLift(m.lHits, mid, 0.17)).toBeGreaterThan(0.08);
      // Lowest at the hit: just before and after, it's up a little.
      expect(strikeLift(m.lHits, m.lHits[i + 1] - 0.03, 0.17)).toBeGreaterThan(0);
    }
  });
});

describe("the drummer's hands", () => {
  it('crash on a drop (in place of that hat), round the toms in a fill, hands alternating', () => {
    const beat = 0.5;
    const hat = Float32Array.from([0, 0.25, 0.5, 0.75, 1.0]);
    const snare = Float32Array.from([0.5, 2.0, 2.125, 2.25, 2.375]);
    const fill = new Uint8Array(8);
    fill[4] = 1;
    const h = drummerHands({ kick: new Float32Array(), snare, hat, crash: Float32Array.from([0]), fill, beat });
    expect(h.rDrum[0]).toBe(DRUM.crash);
    expect(h.rHits[0]).toBe(0);
    // The fill: right, left, right, left.
    const fillHits = [...Array.from(h.rHits, (t, i) => ({ t, d: h.rDrum[i], hand: 'R' })), ...Array.from(h.lHits, (t, i) => ({ t, d: h.lDrum[i], hand: 'L' }))].filter((x) => x.t >= 2).sort((a, b) => a.t - b.t);
    expect(fillHits.map((x) => x.hand).join('')).toBe('RLRL');
    expect(fillHits.some((x) => x.d === DRUM.tom1 || x.d === DRUM.tom2)).toBe(true);
  });
});

describe('the vocal-activity map', () => {
  // A centre-panned "voice" (a vibrato'd sawtooth-ish tone, harmonics in the vocal band) singing
  // one-second lines with one-second gaps over a wide stereo pad (different noise left and right)
  // and a kick on every beat; bars 0-1 are an unsung intro (the section map says so).
  const dur = 12,
    n = SR * dur;
  const mid = new Float32Array(n),
    side = new Float32Array(n);
  const lines: [number, number][] = [];
  for (let t = 2; t + 1 <= dur - 0.5; t += 2) lines.push([t, t + 1]);
  let ph = 0,
    lpL = 0,
    lpR = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    // The wide bed: decorrelated band-limited noise (mostly in the side).
    lpL += (rnd() - lpL) * 0.2;
    lpR += (rnd() - lpR) * 0.2;
    let L = 0.05 * lpL,
      R = 0.05 * lpR;
    const sung = lines.some(([a, b]) => t >= a && t < b) || (t >= 0.3 && t < 1.2);
    if (sung) {
      const f0 = 330 * (1 + 0.01 * Math.sin(2 * Math.PI * 5.5 * t));
      ph += (2 * Math.PI * f0) / SR;
      let v = 0;
      for (let h = 1; h <= 8; h++) v += Math.sin(ph * h) / h;
      const env = Math.min(1, (t % 1) * 20, (1 - (t % 1)) * 20);
      L += 0.12 * v * env;
      R += 0.12 * v * env;
    }
    mid[i] = (L + R) / 2;
    side[i] = (L - R) / 2;
  }
  for (let b = 0; b < dur * 2; b++) addKick(mid, b * 0.5 + 0.01, 0.4);
  // 120 bpm: a bar is 2 s; bars 0 (the intro, where a voice-like synth plays) isn't sung.
  const m = analyseSong(mid, side, SR, { bpm: 120, sung: [false, true, true, true, true, true] });

  it('is high where she sings and low in the gaps', () => {
    for (const [a, b] of lines) {
      for (let t = a + 0.15; t < b - 0.15; t += 0.1) expect(frameAt(m.vocal, t)).toBeGreaterThan(0.4);
      for (let t = b + 0.2; t < b + 0.8; t += 0.1) expect(frameAt(m.vocal, t)).toBeLessThan(0.1);
    }
    // Per beat: the sung beats near full, the gaps' beats empty.
    for (const [a] of lines) {
      expect(m.beatVocal[Math.round(a / 0.5)]).toBeGreaterThan(200);
      expect(m.beatVocal[Math.round((a + 1) / 0.5)]).toBeLessThan(40);
    }
  });

  it('finds each line as a phrase (start and end within a tenth of a second), and nothing in the unsung intro', () => {
    expect(m.phrases.length / 2).toBe(lines.length);
    lines.forEach(([a, b], k) => {
      expect(Math.abs(m.phrases[2 * k] - a)).toBeLessThan(0.1);
      expect(Math.abs(m.phrases[2 * k + 1] - b)).toBeLessThan(0.12);
    });
    for (let t = 0; t < 2; t += 0.05) expect(frameAt(m.vocal, t)).toBe(0);
  });

  it('is small typed arrays: a few bytes per frame', () => {
    expect(m.vocal).toBeInstanceOf(Uint8Array);
    expect(m.vocal.length).toBeCloseTo(dur * MAP_RATE, -2);
    expect(m.beatVocal.length).toBe(dur * 2);
    expect(lastAt(m.phrases, 2.5)).toBe(0);
  });
});

describe('her routine fitted to where she sings', () => {
  const song = INDEX_SONGS[0]!;
  const parts = song.info.map((b) => b.part);
  const base = routineFor(parts, songEndBar(parts));
  // A made-up vocal map: sung on the first three beats of each bar from bar 2, the fourth beat (and every
  // eighth bar) instrumental.
  const beats = parts.length * 4;
  const bv = new Uint8Array(beats);
  for (let b = 8; b < beats; b++) bv[b] = b % 4 === 3 || Math.floor(b / 4) % 8 === 7 ? 0 : 255;
  const r = fitToVocals(base, bv);

  it('still covers the song beat by beat, every move where the routine put her', () => {
    expect(r[0].at).toBe(0);
    for (let i = 1; i < r.length; i++) expect(r[i].at).toBe(r[i - 1].at + r[i - 1].beats);
    expect(r[r.length - 1].at + r[r.length - 1].beats).toBe(beats);
    for (let b = 0; b < beats; b++) {
      const a = stepAt(base, b).step,
        c = stepAt(r, b).step;
      expect(c.hand).toBe(a.hand);
      expect(stepAt(r, b).x).toBeCloseTo(stepAt(base, b).x, 6);
    }
  });

  it('keeps the dance-heavy moves off the sung lines, and dances the instrumental bars', () => {
    const sung = (s: { at: number; beats: number }) => {
      let v = 0;
      for (let b = s.at; b < s.at + s.beats; b++) v += bv[b] / 255;
      return v / s.beats;
    };
    for (const s of r) if (DANCE_HEAVY.has(s.move)) expect(sung(s)).toBeLessThanOrEqual(0.5);
    // The intro (bars 0-1, unsung): no long sways left there.
    const intro = r.filter((s) => s.at < 8 && s.move === 'Show_Sway');
    for (const s of intro) expect(s.beats).toBeLessThan(4);
    expect(r.filter((s) => DANCE_HEAVY.has(s.move) && sung(s) === 0).length).toBeGreaterThan(0);
    for (const s of r) expect(MOVES[s.move]).toBeTruthy();
  });

  it('leaves the big moments where they were (each chorus pose, the final pose)', () => {
    for (const s of base) if (s.move === 'Show_Pose' || s.move === 'Show_Final' || s.move === 'Show_StandTilt') expect(r.find((x) => x.at === s.at)?.move).toBe(s.move);
  });
});

describe('the decks and her set on separate buses', () => {
  it("plays her set out of its own output (the stage's PA) while the decks' output (the booth) goes quiet", () => {
    const rate = 8000;
    const d = new DeckDSP(rate);
    const rec = new Float32Array(rate * 3).map((_, i) => Math.sin(i * 0.05) * 0.5);
    d.recs[0] = { data: rec, sr: rate, loop: 2 };
    d.live = { data: new Float32Array(rate * 3).map((_, i) => Math.sin(i * 0.11) * 0.5), sr: rate };
    const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
    const out = new Float32Array(256),
      live = new Float32Array(256);
    // Not on: the decks only.
    d.sched = { on: 0, start: 0, slot: 0, cycle: 1 };
    d.process(out, 256, 0.5, live);
    expect(rms(out)).toBeGreaterThan(0.2);
    expect(rms(live)).toBe(0);
    // Her set on (after its 20 ms crossfade): her song only, on its own output.
    d.sched = { on: 1, start: 0, slot: 2.5, cycle: 3 };
    for (let k = 0; k < 4; k++) d.process(out, 256, 0.6 + (k * 256) / rate, live);
    expect(rms(live)).toBeGreaterThan(0.2);
    expect(rms(out)).toBeLessThan(0.01);
  });
});

describe("the DJ's record after her set", () => {
  it('starts as her slot ends, plays once through, then the house record is back (the same for everyone: the plan alone)', async () => {
    const { afterAt, cycleLength, liveSlot } = await import('../src/client/party/schedule');
    const t = { bar: 2, liveLen: 249, lead: 164, after: 220 };
    const plan = { start: 1000, rev: 1, by: '1' };
    const slot = liveSlot(t),
      C = cycleLength(t);
    expect(afterAt(1000 + slot - 0.01, plan, t, 220)).toBe(-1);
    expect(afterAt(1000 + slot, plan, t, 220)).toBe(0);
    expect(afterAt(1000 + slot + 100, plan, t, 220)).toBeCloseTo(100, 6);
    expect(afterAt(1000 + slot + 220.01, plan, t, 220)).toBe(-1);
    // The next cycle too; and never into the night's next round (the house record from its top, `lead` before her next set).
    expect(afterAt(1000 + C + slot + 5, plan, t, 220)).toBeCloseTo(5, 6);
    expect(afterAt(1000 + C - t.lead - 0.01, plan, t, 1e6)).toBeGreaterThan(0);
    expect(afterAt(1000 + C - t.lead + 0.01, plan, t, 1e6)).toBe(-1);
    expect(afterAt(1000 + C + 1, plan, t, 1e6)).toBe(-1);
    expect(afterAt(999, plan, t, 220)).toBe(-1);
  });

  it('takes over deck A on the booth bus (not the stage bus) for its length', () => {
    const rate = 8000;
    const d = new DeckDSP(rate);
    d.recs[0] = { data: new Float32Array(rate * 3).fill(0.25), sr: rate, loop: 2 };
    d.after = { data: new Float32Array(rate * 3).map((_, i) => Math.sin(i * 0.2) * 0.5), sr: rate };
    d.live = { data: new Float32Array(rate * 3), sr: rate };
    d.sched = { on: 1, start: 0, slot: 1, cycle: 10, after: 2 };
    const out = new Float32Array(512),
      live = new Float32Array(512);
    const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
    for (let k = 0; k < 4; k++) d.process(out, 512, 1.2 + (k * 512) / rate, live);
    // A sine, not the house record's flat line (the DC blocker takes a constant away).
    expect(rms(out)).toBeGreaterThan(0.25);
    expect(rms(live)).toBe(0);
    // Past its length: the house record (constant: blocked to ~0) again.
    for (let k = 0; k < 8; k++) d.process(out, 512, 3.2 + (k * 512) / rate, live);
    expect(rms(out)).toBeLessThan(0.05);
  });
});
