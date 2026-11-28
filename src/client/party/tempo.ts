import type { BarLevels } from './beat';

/**
 * Measures a music track the way tools/audio/analyze_music.py does (tempo,
 * where the beat grid starts, each bar's energy), but in plain TypeScript so it
 * runs anywhere: in the browser on a song dropped into public/audio/ without a
 * matching public/audio/index.json entry (party/music.ts), and from
 * scripts/measure-music.ts to write that entry.
 *
 *  1. An onset envelope (~86 frames a second): the summed rise in log energy of
 *     three bands (lows: the kick; mids; highs: hats, claps), half-wave
 *     rectified.
 *  2. Tempo: the envelope's autocorrelation over 70..180 bpm, weighted toward
 *     ~120 bpm (and folded into 85..170 so a half-time feel isn't taken).
 *  3. The grid: a fine search of tempo (±1.5 %) and phase that best lines the
 *     beats up with the onsets across the whole track, then which of the four
 *     beats is the downbeat (the one the low end hits hardest).
 *  4. Per bar, from the first downbeat: the level of the whole mix, of the
 *     percussive part (the low/high bands' onsets) and of the rest, in dB, the
 *     same shape as index.json's `perBar`.
 *
 * Pure (no audio APIs): unit-tested in tests/tempo.test.ts.
 */

export interface Measured {
  bpm: number;
  /** Seconds to the first downbeat. */
  firstBeat: number;
  /** Whole bars from the first downbeat to the end. */
  bars: number;
  seconds: number;
  perBar: BarLevels[];
}

const HOP = 256;
/** Seconds from a beat's onset to where index.json's beat grid puts it. */
const LAG = 0.038;

/** One-pole low-pass coefficient for a corner at `f` Hz. */
const lpK = (f: number, sr: number) => 1 - Math.exp((-2 * Math.PI * f) / sr);

/** The onset envelope (frames of HOP samples) and each frame's low / high / whole energy. */
export function onsetEnvelope(x: Float32Array, sr: number) {
  const n = Math.floor(x.length / HOP);
  const env = new Float32Array(n);
  const eLow = new Float32Array(n),
    eAll = new Float32Array(n),
    ePerc = new Float32Array(n);
  const kl = lpK(150, sr),
    km = lpK(2500, sr),
    kh = lpK(5000, sr);
  let l = 0,
    m = 0,
    h = 0;
  const prev = [0, 0, 0];
  for (let f = 0; f < n; f++) {
    let sl = 0,
      sm = 0,
      sh = 0,
      sa = 0;
    for (let i = f * HOP, e = i + HOP; i < e; i++) {
      const v = x[i];
      l += (v - l) * kl;
      m += (v - m) * km;
      h += (v - h) * kh;
      const mid = m - l,
        high = v - h;
      sl += l * l;
      sm += mid * mid;
      sh += high * high;
      sa += v * v;
    }
    const bands = [sl, sm, sh].map((s) => Math.log(1e-9 + s / HOP));
    let o = 0;
    for (let b = 0; b < 3; b++) {
      const d = bands[b] - prev[b];
      if (f > 0 && d > 0) o += d * (b === 1 ? 0.6 : 1);
      prev[b] = bands[b];
    }
    env[f] = o;
    eLow[f] = sl / HOP;
    eAll[f] = sa / HOP;
    // A frame's percussive share: the lows and highs while they're rising.
    ePerc[f] = (sl + sh) / HOP;
  }
  // Take the slow trend out (a long fade-in isn't a beat).
  const w = 43;
  const out = new Float32Array(n);
  let acc = 0;
  for (let f = 0; f < n; f++) {
    acc += env[f];
    if (f >= w) acc -= env[f - w];
    out[f] = Math.max(0, env[f] - acc / Math.min(f + 1, w));
  }
  return { env: out, eLow, eAll, ePerc, fps: sr / HOP };
}

/** The envelope's value at a fractional frame (linear). */
function at(env: Float32Array, fr: number) {
  const i = Math.floor(fr);
  if (i < 0 || i + 1 >= env.length) return 0;
  return env[i] + (env[i + 1] - env[i]) * (fr - i);
}

/** Tempo from the envelope's autocorrelation (bpm, folded into 85..170). */
export function roughTempo(env: Float32Array, fps: number): number {
  let best = 120,
    bestS = -Infinity;
  for (let bpm = 70; bpm <= 180; bpm += 0.25) {
    const lag = (60 / bpm) * fps;
    let s = 0;
    for (let f = 0; f + lag * 4 < env.length; f += 1) s += env[f] * (at(env, f + lag) + 0.5 * at(env, f + 2 * lag) + 0.25 * at(env, f + 4 * lag));
    // A gentle preference for ~120 bpm (log-normal, wide).
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.5, 2));
    s *= prior;
    if (s > bestS) {
      bestS = s;
      best = bpm;
    }
  }
  while (best < 85) best *= 2;
  while (best > 170) best /= 2;
  return best;
}

/** Fits tempo and phase to the onsets over the whole track. */
export function fitGrid(env: Float32Array, fps: number, bpm0: number): { bpm: number; phase: number } {
  let best = { bpm: bpm0, phase: 0, s: -Infinity };
  const score = (bpm: number, phase: number) => {
    const p = (60 / bpm) * fps;
    let s = 0;
    for (let fr = phase; fr < env.length - 1; fr += p) s += at(env, fr);
    return s;
  };
  const search = (lo: number, hi: number, step: number, phases: number) => {
    for (let bpm = lo; bpm <= hi + 1e-9; bpm += step) {
      const p = (60 / bpm) * fps;
      for (let k = 0; k < phases; k++) {
        const ph = (k / phases) * p;
        const s = score(bpm, ph);
        if (s > best.s) best = { bpm, phase: ph, s };
      }
    }
  };
  search(bpm0 * 0.985, bpm0 * 1.015, 0.05, 24);
  const b1 = best.bpm;
  search(b1 - 0.06, b1 + 0.06, 0.005, 48);
  return { bpm: best.bpm, phase: best.phase / fps };
}

const db = (ms: number) => Math.round(10 * Math.log10(ms + 1e-12) * 10) / 10;

/** Measures mono samples at `sr`. */
export function measureTrack(x: Float32Array, sr: number): Measured {
  const seconds = x.length / sr;
  const { env, eLow, eAll, ePerc, fps } = onsetEnvelope(x, sr);
  const { bpm, phase } = fitGrid(env, fps, roughTempo(env, fps));
  const beat = 60 / bpm;
  // The downbeat: mostly the most accented of the four beats, helped by where the music's level
  // changes from bar to bar (a phrase, a drop, a new section lands on a bar line).
  const beatE: number[] = [];
  for (let t = phase; t + beat <= seconds; t += beat) {
    let s = 0;
    const f0 = Math.floor(t * fps),
      f1 = Math.min(eAll.length, Math.floor((t + beat) * fps));
    for (let f = f0; f < f1; f++) s += eAll[f] + 2 * eLow[f];
    beatE.push(Math.log(1e-9 + s / Math.max(1, f1 - f0)));
  }
  const scores = [0, 1, 2, 3].map((k) => {
    // Bars read from beat k: aligned with the real bar lines, bar-to-bar changes are sharpest.
    const barE: number[] = [];
    for (let i = k; i + 4 <= beatE.length; i += 4) barE.push((beatE[i] + beatE[i + 1] + beatE[i + 2] + beatE[i + 3]) / 4);
    let s = 0;
    for (let i = 1; i < barE.length; i++) s += Math.abs(barE[i] - barE[i - 1]);
    return s / Math.max(1, barE.length - 1);
  });
  // And the one is usually the most accented beat (the onsets, summed by place in the bar).
  const accent = [0, 0, 0, 0];
  for (let i = 0; i < beatE.length; i++) accent[i % 4] += env[Math.round((phase + i * beat) * fps)] ?? 0;
  const top = Math.max(...scores, 1e-9),
    topA = Math.max(...accent, 1e-9);
  let down = 0,
    bestS = -Infinity;
  for (let k = 0; k < 4; k++) {
    const s = 0.75 * (scores[k] / top) + accent[k] / topA;
    if (s > bestS) {
      bestS = s;
      down = k;
    }
  }
  // (LAG: index.json's grid, from librosa, sits ~38 ms after the onsets this finds; match it.)
  const firstBeat = phase + down * beat + LAG;
  const bar = 4 * beat;
  const bars = Math.max(1, Math.floor((seconds - firstBeat) / bar));
  const perBar: BarLevels[] = [];
  for (let i = 0; i < bars; i++) {
    const f0 = Math.floor(((firstBeat + i * bar) * sr) / HOP),
      f1 = Math.min(eAll.length, Math.floor(((firstBeat + (i + 1) * bar) * sr) / HOP));
    let a = 0,
      p = 0,
      o = 0;
    for (let f = f0; f < f1; f++) {
      a += eAll[f];
      p += ePerc[f] * Math.min(1, env[f] * 2 + 0.15);
      o += env[f];
    }
    const k = Math.max(1, f1 - f0);
    const level = db(a / k);
    // The percussive part: low/high energy weighted by how much it's hitting.
    const drums = db(p / k);
    const tonal = db(Math.max(1e-12, a / k - (p / k) * 0.5));
    perBar.push({ drums, tonal, level });
    void o;
  }
  return { bpm: Math.round(bpm * 1000) / 1000, firstBeat: Math.round(firstBeat * 1000) / 1000, bars, seconds: Math.round(seconds * 1000) / 1000, perBar };
}
