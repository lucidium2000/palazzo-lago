/**
 * What's in a concert song, read once from its decoded audio when it loads
 * (in a worker: songmaps.worker.ts; pure, no DOM, unit-tested in
 * tests/songmaps.test.ts), so the headliner and her band can follow the
 * recording itself, not just its tempo:
 *
 * - The vocal: an envelope of the sung line (100 frames a second) for her
 *   mouth, its vowel colour, a per-beat map of where she sings, the phrases
 *   (when each line starts and ends) and how steady the note is (held notes:
 *   her head tilts, her eyes close, she leans back). The vocal is isolated as
 *   well as a stereo mix allows: the 300-3400 Hz band of the mid channel less
 *   what's also in the side (a lead vocal is panned dead centre, the synths and
 *   reverbs are wide), a running median that steps over drum hits, measured
 *   against the song's own bed a few seconds either side, and only in the bars
 *   the section map says are sung.
 * - The drums: kick (50-150 Hz), snare (150-2000 Hz plus its noise to 5 kHz)
 *   and hi-hat (6-12 kHz) onsets, by spectral flux and adaptive peak picking
 *   on the mid channel; crashes on the big drops (the first kick back after a
 *   break, or the downbeat of each chorus); fills where the snare hits bunch
 *   up. From these, each of the drummer's hands gets its own list of strikes
 *   (which drum, when): the right on the hats (a crash on the drops), the left
 *   on the snare, both round the toms in a fill.
 * - The bass: onsets in the low band, and each one's note (for the fretting hand).
 * - The keys: onsets in the side channel's mids (the wide synths), and a chord
 *   colour per beat (a 12-note chroma's strongest note) for where the hands go.
 *
 * Everything is stored as small typed arrays; looking anything up is a binary
 * search (no allocation per frame).
 */

/** Analysis frames per second. */
export const MAP_RATE = 100;
const N = 1024;
/** Where in the analysis window a hit is when its flux peaks (fraction of the window). */
const ONSET_LAG = 0.62;

export interface SongMaps {
  /** Seconds the maps cover (from the song's first downbeat). */
  length: number;
  /** One beat (s). */
  beat: number;
  /** Per frame (1/MAP_RATE s): vocal level 0..255, its vowel-ness 0..255, how steady (a held note) 0..255. */
  vocal: Uint8Array;
  vowel: Uint8Array;
  steady: Uint8Array;
  /** Per beat: how much of it is sung (0..255). */
  beatVocal: Uint8Array;
  /** The sung lines: start, end (s), pairs. */
  phrases: Float32Array;
  /** Onset times (s), ascending. */
  kick: Float32Array;
  snare: Float32Array;
  hat: Float32Array;
  crash: Float32Array;
  bass: Float32Array;
  /** Each bass onset's note (MIDI). */
  bassNote: Uint8Array;
  keys: Float32Array;
  /** Per beat: the chord's strongest pitch class (0..11), and 1 where the chord changes. */
  chord: Uint8Array;
  chordChange: Uint8Array;
  /** Per beat: 1 in a drum fill. */
  fill: Uint8Array;
  /** The drummer's strikes per hand: times (s) and drums (DRUM ids). */
  rHits: Float32Array;
  rDrum: Uint8Array;
  lHits: Float32Array;
  lDrum: Uint8Array;
}

/** The kit's pieces, as the strike lists name them. */
export const DRUM = { snare: 0, hat: 1, tom1: 2, tom2: 3, floor: 4, crash: 5, ride: 6 } as const;

export interface SongInfo {
  bpm: number;
  /** Per bar: is it sung (from the section map)? Missing: all sung. */
  sung?: ArrayLike<boolean>;
  /** Bars where a chorus drops (crash cymbals). */
  drops?: ArrayLike<number>;
}

// --- FFT --------------------------------------------------------------------------------

/** In-place radix-2 complex FFT (re, im of length n, a power of two), with precomputed tables. */
export class FFT {
  readonly n: number;
  private cos: Float32Array;
  private sin: Float32Array;
  private rev: Uint32Array;
  constructor(n: number) {
    this.n = n;
    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }
  run(re: Float32Array, im: Float32Array) {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1,
        step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j,
            b = a + half;
          const tr = re[b] * this.cos[k] - im[b] * this.sin[k];
          const ti = re[b] * this.sin[k] + im[b] * this.cos[k];
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

// --- Peak picking ---------------------------------------------------------------------

/**
 * Onsets in a flux curve (one value per frame): local maxima (±2 frames) that
 * stand `k` × the curve's typical level above its running mean (±`w` frames),
 * and at least `rel` of the strongest peak within ±`around` frames, at least
 * `gap` frames apart. Returns frame indices.
 */
export function pickPeaks(flux: Float32Array, o: { w?: number; k?: number; gap?: number; floor?: number; rel?: number; around?: number } = {}): number[] {
  const n = flux.length;
  const rel = o.rel ?? 0.3,
    around = o.around ?? 100;
  const w = o.w ?? 8,
    k = o.k ?? 1.5,
    gap = o.gap ?? 8;
  // The curve's typical level: its median over the frames that have anything in them.
  const nz: number[] = [];
  for (let i = 0; i < n; i += 4) if (flux[i] > 0) nz.push(flux[i]);
  nz.sort((a, b) => a - b);
  const typ = nz.length ? nz[Math.floor(nz.length * 0.5)] : 0;
  const floor = Math.max(o.floor ?? 0, typ * 0.5);
  const out: number[] = [];
  let sum = 0;
  // Running sum over [i-w, i+w].
  for (let i = 0; i <= Math.min(n - 1, w); i++) sum += flux[i];
  let last = -1e9;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      if (i + w < n) sum += flux[i + w];
      if (i - w - 1 >= 0) sum -= flux[i - w - 1];
    }
    const cnt = Math.min(n - 1, i + w) - Math.max(0, i - w) + 1;
    const mean = sum / cnt;
    const v = flux[i];
    if (v <= floor || v < mean + k * typ) continue;
    // And a real share of the strongest hit around it (not another drum's bleed into this band).
    let big = 0;
    for (let j = Math.max(0, i - around); j <= Math.min(n - 1, i + around); j++) if (flux[j] > big) big = flux[j];
    if (v < rel * big) continue;
    let peak = true;
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) if (flux[j] > v || (flux[j] === v && j < i)) peak = false;
    if (!peak) continue;
    if (i - last < gap) {
      // Too close to the last: keep the stronger.
      if (out.length && v > flux[out[out.length - 1]]) {
        out[out.length - 1] = i;
        last = i;
      }
      continue;
    }
    out.push(i);
    last = i;
  }
  return out;
}

// --- The analysis -----------------------------------------------------------------------

/** Hz → FFT bin at sample rate `sr`. */
const binOf = (hz: number, sr: number) => Math.max(1, Math.min(N / 2, Math.round((hz * N) / sr)));

/**
 * The analysis, a frame at a time (so it can be run in slices off a worker
 * too): `step(budget)` until it returns true, then `finish()`.
 */
export class SongAnalyser {
  readonly frames: number;
  readonly hop: number;
  private fft = new FFT(N);
  private re = new Float32Array(N);
  private im = new Float32Array(N);
  private win = new Float32Array(N);
  private prevM = new Float32Array(N / 2 + 1);
  private prevS = new Float32Array(N / 2 + 1);
  private prevA = new Float32Array(N / 2 + 1);
  private f = 0;
  // Per-frame curves.
  fKick: Float32Array;
  fSnare: Float32Array;
  fHat: Float32Array;
  fBass: Float32Array;
  fKeys: Float32Array;
  private vE: Float32Array;
  private vCent: Float32Array;
  private vVowel: Float32Array;
  /** The bass's strongest bin per frame. */
  private bassBin: Uint16Array;
  /** Chroma per beat (12 each). */
  private chroma: Float32Array;
  private pcOf: Int8Array;
  private bins: Record<'kick0' | 'kick1' | 'sn0' | 'snBody' | 'sn1' | 'hat0' | 'hat1' | 'bass0' | 'bass1' | 'voc0' | 'voc1' | 'vow1' | 'vow2' | 'keys0' | 'keys1' | 'ch0' | 'ch1', number>;
  private beatLen: number;
  readonly beats: number;

  constructor(
    private mid: Float32Array,
    private side: Float32Array | null,
    private sr: number,
    private info: SongInfo,
  ) {
    this.hop = sr / MAP_RATE;
    this.frames = Math.max(1, Math.floor((mid.length - N) / this.hop) + 1);
    const F = this.frames;
    this.fKick = new Float32Array(F);
    this.fSnare = new Float32Array(F);
    this.fHat = new Float32Array(F);
    this.fBass = new Float32Array(F);
    this.fKeys = new Float32Array(F);
    this.vE = new Float32Array(F);
    this.vCent = new Float32Array(F);
    this.vVowel = new Float32Array(F);
    this.bassBin = new Uint16Array(F);
    this.beatLen = 60 / info.bpm;
    this.beats = Math.ceil(mid.length / sr / this.beatLen);
    this.chroma = new Float32Array(this.beats * 12);
    for (let i = 0; i < N; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    this.bins = {
      kick0: binOf(50, sr),
      kick1: binOf(150, sr),
      sn0: binOf(150, sr) + 1,
      snBody: binOf(2000, sr),
      sn1: binOf(5000, sr),
      hat0: binOf(6000, sr),
      hat1: binOf(12000, sr),
      bass0: binOf(40, sr),
      bass1: binOf(300, sr),
      voc0: binOf(300, sr),
      voc1: binOf(3400, sr),
      vow1: binOf(1000, sr),
      vow2: binOf(4000, sr),
      keys0: binOf(250, sr),
      keys1: binOf(2500, sr),
      ch0: binOf(130, sr),
      ch1: binOf(2000, sr),
    };
    this.pcOf = new Int8Array(N / 2 + 1).fill(-1);
    for (let k = this.bins.ch0; k <= this.bins.ch1; k++) {
      const hz = (k * sr) / N;
      this.pcOf[k] = ((Math.round(12 * Math.log2(hz / 440) + 69) % 12) + 12) % 12;
    }
  }

  /** Analyses up to `budget` frames; true when every frame's done. */
  step(budget = Infinity): boolean {
    const { re, im, win, mid, side, hop, bins: B, prevM, prevS, prevA } = this;
    const end = Math.min(this.frames, this.f + budget);
    const scale = 2 / N;
    for (; this.f < end; this.f++) {
      const f = this.f;
      const s0 = Math.round(f * hop);
      for (let i = 0; i < N; i++) {
        const j = s0 + i;
        re[i] = (j < mid.length ? mid[j] : 0) * win[i];
        im[i] = side && j < side.length ? side[j] * win[i] : 0;
      }
      this.fft.run(re, im);
      // Split the packed transform into the mid's and the side's spectra (magnitudes).
      let kick = 0,
        snare = 0,
        snareNoise = 0,
        hat = 0,
        bass = 0,
        keys = 0,
        vm = 0,
        vs = 0,
        vv = 0,
        lo = 0,
        hi = 0,
        bestB = 0,
        bestBin = 0;
      const beat = Math.min(this.beats - 1, Math.floor((f / MAP_RATE + N / 2 / this.sr) / this.beatLen));
      for (let k = 1; k <= N / 2; k++) {
        const nk = (N - k) & (N - 1);
        const ar = re[k],
          ai = im[k],
          br = re[nk],
          bi = im[nk];
        // M = (Z[k] + conj Z[N-k]) / 2, S = (Z[k] - conj Z[N-k]) / 2i.
        const mr = (ar + br) / 2,
          mi = (ai - bi) / 2;
        const sr_ = (ai + bi) / 2,
          si = -(ar - br) / 2;
        const M2 = (mr * mr + mi * mi) * scale * scale;
        const S2 = (sr_ * sr_ + si * si) * scale * scale;
        const am = Math.sqrt(M2);
        const lm = Math.log(1 + 1000 * am),
          ls = Math.log(1 + 1000 * Math.sqrt(S2));
        const dm = lm - prevM[k],
          ds = ls - prevS[k],
          da = am - prevA[k];
        prevM[k] = lm;
        prevS[k] = ls;
        prevA[k] = am;
        // The low drums by how much louder they got (linear: a kick's thump, not a hiss's low edge);
        // the snare's body (150-2000 Hz) and half its noise (to 5 kHz), the hats, by log flux.
        if (da > 0) {
          if (k >= B.kick0 && k <= B.kick1) kick += da;
          if (k >= B.bass0 && k <= B.bass1) bass += da;
        }
        if (dm > 0) {
          if (k >= B.sn0 && k <= B.snBody) snare += dm;
          else if (k > B.snBody && k <= B.sn1) snareNoise += dm;
          if (k >= B.hat0 && k <= B.hat1) hat += dm;
        }
        if (ds > 0 && k >= B.keys0 && k <= B.keys1) keys += ds;
        if (k >= B.bass0 && k <= B.bass1 && M2 > bestB) {
          bestB = M2;
          bestBin = k;
        }
        if (k >= B.voc0 && k <= B.voc1) {
          vm += M2;
          vs += S2;
          vv += Math.max(0, M2 - 1.5 * S2);
        }
        if (k >= B.voc0 && k < B.vow1) lo += M2;
        else if (k >= B.vow1 && k < B.vow2) hi += M2;
        const pc = this.pcOf[k];
        if (pc >= 0) this.chroma[beat * 12 + pc] += Math.sqrt(M2) + Math.sqrt(S2);
      }
      this.fKick[f] = kick;
      // The snare's noise counts only alongside its body (a hat's hiss reaches down to 2 kHz too).
      this.fSnare[f] = snare + 0.5 * Math.min(snareNoise, snare);
      this.fHat[f] = hat;
      this.fBass[f] = bass;
      this.fKeys[f] = keys;
      this.vE[f] = side ? vv : vm;
      this.vCent[f] = vm > 1e-12 ? 1 - Math.sqrt(vs / vm) : 0;
      this.vVowel[f] = lo + hi > 1e-12 ? lo / (lo + hi) : 0;
      this.bassBin[f] = bestBin;
    }
    return this.f >= this.frames;
  }

  /**
   * A peak frame of `curve` → seconds of the onset it marks: the peak placed
   * between frames (a parabola through it and its neighbours), less the
   * window's lag (calibrated on synthetic hits: tests/songmaps.test.ts).
   */
  private t(curve: Float32Array, frame: number): number {
    const a = curve[frame - 1] ?? 0,
      b = curve[frame],
      c = curve[frame + 1] ?? 0;
    const den = a - 2 * b + c;
    const d = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
    return Math.max(0, ((frame + d) * this.hop + ONSET_LAG * N) / this.sr);
  }

  finish(): SongMaps {
    const F = this.frames;
    const info = this.info;
    const beat = this.beatLen;
    const len = this.mid.length / this.sr;
    const times = (c: Float32Array, fr: number[]) => Float32Array.from(fr, (i) => this.t(c, i));
    const gapF = (s: number) => Math.max(2, Math.round(s * MAP_RATE));
    const kickF = pickPeaks(this.fKick, { w: 10, k: 1.6, gap: gapF(Math.min(0.18, beat * 0.4)) });
    // The snare: its own band's hits, less a kick's or a hat's bleed into it (a kick's click and
    // pitch sweep reach the snare's body): one on a kick counts only if it's a strong one.
    const snareF = pickPeaks(this.fSnare, { w: 10, k: 1.8, gap: gapF(0.09), rel: 0.4 }).filter((fr) => {
      if (!kickF.some((kf) => Math.abs(kf - fr) <= 2)) return true;
      let big = 0;
      for (let j = Math.max(0, fr - 60); j <= Math.min(F - 1, fr + 60); j++) big = Math.max(big, this.fSnare[j]);
      return this.fSnare[fr] >= 0.6 * big;
    });
    // The hats: their band's hits that aren't a snare's top end (the snare's noise reaches 12 kHz).
    const hatF = pickPeaks(this.fHat, { w: 8, k: 1.4, gap: gapF(0.07) }).filter((fr) => !snareF.some((sf) => Math.abs(sf - fr) <= 2));

    const bassF = pickPeaks(this.fBass, { w: 10, k: 1.4, gap: gapF(0.1) });
    const keysF = pickPeaks(this.fKeys, { w: 10, k: 1.5, gap: gapF(0.1) });
    const kick = times(this.fKick, kickF),
      snare = times(this.fSnare, snareF),
      hat = times(this.fHat, hatF),
      bass = times(this.fBass, bassF),
      keys = times(this.fKeys, keysF);
    const bassNote = Uint8Array.from(bassF, (fr) => {
      // The strongest low bin a few frames after the pluck.
      let best = 0;
      for (let j = fr; j < Math.min(F, fr + 4); j++) best = Math.max(best, this.bassBin[j]);
      const hz = Math.max(30, (best * this.sr) / N);
      return Math.max(0, Math.min(127, Math.round(12 * Math.log2(hz / 440) + 69)));
    });

    // --- The vocal ---
    const sungBar = (t: number) => {
      const s = info.sung;
      if (!s) return true;
      const b = Math.floor(t / (beat * 4));
      return b >= 0 && b < s.length ? !!s[b] : false;
    };
    // Over drum hits (a running median of 9 frames), in dB.
    const db = new Float32Array(F);
    const win9 = new Float32Array(9);
    for (let i = 0; i < F; i++) {
      for (let j = -4; j <= 4; j++) win9[j + 4] = this.vE[Math.max(0, Math.min(F - 1, i + j))];
      win9.sort();
      db[i] = 10 * Math.log10(win9[4] + 1e-12);
    }
    // The bed: the quiet end (15th percentile) of the band ±3 s around.
    const W = 3 * MAP_RATE,
      STEP = 10;
    const bedAt = new Float32Array(Math.ceil(F / STEP) + 1);
    const tmp = new Float32Array(2 * W + 1);
    for (let k = 0; k < bedAt.length; k++) {
      const c = k * STEP;
      const a = Math.max(0, c - W),
        z = Math.min(F, c + W + 1);
      const view = tmp.subarray(0, z - a);
      view.set(db.subarray(a, z));
      view.sort();
      bedAt[k] = view.length ? view[Math.floor(view.length * 0.15)] : -120;
    }
    // Centredness: its running median, and how it sits against the song's own.
    const centAvg = (() => {
      let s = 0;
      for (let i = 0; i < F; i++) s += this.vCent[i];
      return s / F;
    })();
    const vocal = new Uint8Array(F),
      vowel = new Uint8Array(F),
      steady = new Uint8Array(F);
    const level = new Float32Array(F);
    for (let i = 0; i < F; i++) {
      const k = i / STEP,
        k0 = Math.floor(k);
      const bed = bedAt[k0] + (bedAt[Math.min(bedAt.length - 1, k0 + 1)] - bedAt[k0]) * (k - k0);
      let v = Math.max(0, Math.min(1, (db[i] - bed - 2) / 10));
      let c = 0;
      for (let j = -4; j <= 4; j++) c += this.vCent[Math.max(0, Math.min(F - 1, i + j))];
      c /= 9;
      // More centred than the song usually is: more likely her.
      v *= Math.max(0.35, Math.min(1, 0.7 + (c - centAvg) * 2));
      if (!sungBar(i / MAP_RATE)) v = 0;
      level[i] = v;
    }
    // A jaw: opens fast, closes a little slower.
    let env = 0;
    for (let i = 0; i < F; i++) {
      const v = level[i];
      env += (v - env) * (v > env ? 0.6 : 0.3);
      vocal[i] = Math.round(env * 255);
      vowel[i] = Math.round(Math.min(1, this.vVowel[i] * 1.3) * 255);
    }
    // The phrases: where the level stays up (hysteresis), short breaths bridged, specks dropped.
    const ph: number[] = [];
    let on = false,
      start = 0,
      quiet = 0;
    for (let i = 0; i < F; i++) {
      const v = level[i];
      if (!on && v > 0.3) {
        on = true;
        start = i;
        quiet = 0;
      } else if (on) {
        if (v < 0.12) quiet++;
        else quiet = 0;
        if (quiet > 0.22 * MAP_RATE || i === F - 1) {
          const end = i - quiet + 1;
          on = false;
          const prevEnd = ph.length ? ph[ph.length - 1] : -1;
          if (ph.length && start - prevEnd < 0.25 * MAP_RATE) ph[ph.length - 1] = end;
          else ph.push(start, end);
        }
      }
    }
    const phrases: number[] = [];
    for (let k = 0; k < ph.length; k += 2) if (ph[k + 1] - ph[k] >= 0.2 * MAP_RATE) phrases.push(ph[k] / MAP_RATE, ph[k + 1] / MAP_RATE);
    // Steadiness: inside a phrase, the band's level barely moving over ~0.3 s.
    const inPh = new Uint8Array(F);
    for (let k = 0; k < phrases.length; k += 2) for (let i = Math.round(phrases[k] * MAP_RATE); i < Math.min(F, Math.round(phrases[k + 1] * MAP_RATE)); i++) inPh[i] = 1;
    for (let i = 0; i < F; i++) {
      if (!inPh[i] || level[i] < 0.35) continue;
      let s = 0,
        s2 = 0,
        n = 0;
      for (let j = Math.max(0, i - 15); j <= Math.min(F - 1, i + 15); j++) {
        s += db[j];
        s2 += db[j] * db[j];
        n++;
      }
      const sd = Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
      steady[i] = Math.round(Math.max(0, Math.min(1, (3.5 - sd) / 2.5)) * 255);
    }
    const B = this.beats;
    const beatVocal = new Uint8Array(B);
    for (let b = 0; b < B; b++) {
      const a = Math.floor(b * beat * MAP_RATE),
        z = Math.min(F, Math.floor((b + 1) * beat * MAP_RATE));
      let s = 0;
      for (let i = a; i < z; i++) s += inPh[i];
      beatVocal[b] = z > a ? Math.round((s / (z - a)) * 255) : 0;
    }

    // --- Crashes and fills ---
    const crash: number[] = [];
    for (let i = 0; i < kick.length; i++) if (i > 0 && kick[i] - kick[i - 1] > 2.5 * beat) crash.push(kick[i]);
    for (let k = 0; k < (info.drops?.length ?? 0); k++) {
      const t = info.drops![k] * 4 * beat;
      // On the nearest kick to that downbeat (or the downbeat itself).
      let best = t,
        d = 0.1;
      for (let i = 0; i < kick.length; i++)
        if (Math.abs(kick[i] - t) < d) {
          d = Math.abs(kick[i] - t);
          best = kick[i];
        }
      if (!crash.some((c) => Math.abs(c - best) < beat)) crash.push(best);
    }
    crash.sort((a, b) => a - b);
    // (One crash a beat at most.)
    for (let i = crash.length - 1; i > 0; i--) if (crash[i] - crash[i - 1] < beat) crash.splice(i, 1);
    const fill = new Uint8Array(B);
    const perBeat = new Uint8Array(B);
    for (const t of snare) perBeat[Math.min(B - 1, Math.floor(t / beat + 0.05))]++;
    for (let b = 0; b < B; b++) {
      // Three or more snare-band hits in a beat, more than the beats around it usually have, at the end of a bar.
      let around = 0;
      for (let j = b - 8; j < b; j++) if (j >= 0) around += perBeat[j];
      if (perBeat[b] >= 3 && perBeat[b] >= around / 8 + 2) fill[b] = 1;
    }
    // A fill runs on to the next downbeat if it starts late in a bar.
    for (let b = 0; b < B - 1; b++) if (fill[b] && b % 4 >= 2 && b % 4 < 3) fill[b + 1] = 1;

    // --- Keys: chord colour per beat ---
    const chord = new Uint8Array(B),
      chordChange = new Uint8Array(B);
    for (let b = 0; b < B; b++) {
      let best = 0,
        bi = 0;
      for (let p = 0; p < 12; p++) if (this.chroma[b * 12 + p] > best) (best = this.chroma[b * 12 + p]), (bi = p);
      chord[b] = bi;
      if (b > 0) {
        let dot = 0,
          na = 0,
          nb = 0;
        for (let p = 0; p < 12; p++) {
          const x = this.chroma[b * 12 + p],
            y = this.chroma[(b - 1) * 12 + p];
          dot += x * y;
          na += x * x;
          nb += y * y;
        }
        chordChange[b] = na > 0 && nb > 0 && dot / Math.sqrt(na * nb) < 0.9 ? 1 : 0;
      }
    }

    const hands = drummerHands({ kick, snare, hat, crash: Float32Array.from(crash), fill, beat });
    return {
      length: len,
      beat,
      vocal,
      vowel,
      steady,
      beatVocal,
      phrases: Float32Array.from(phrases),
      kick,
      snare,
      hat,
      crash: Float32Array.from(crash),
      bass,
      bassNote,
      keys,
      chord,
      chordChange,
      fill,
      ...hands,
    };
  }
}

/**
 * The drummer's two hands from the onsets: the right on the hats (and a crash
 * where one lands; where the hats are too quiet to pick out, it keeps time on
 * the hat with the kicks), the left on the snare; in a fill, the snare-band hits
 * alternate hands round the toms (right first). A stick can't strike faster
 * than every 90 ms: hits closer than that on one hand go to the other if it's
 * free, else are dropped.
 */
export function drummerHands(o: { kick: Float32Array; snare: Float32Array; hat: Float32Array; crash: Float32Array; fill: Uint8Array; beat: number }) {
  const MIN = 0.09;
  const inFill = (t: number) => {
    const b = Math.floor(t / o.beat + 0.05);
    return b >= 0 && b < o.fill.length && o.fill[b] === 1;
  };
  type Hit = { t: number; d: number };
  const R: Hit[] = [],
    L: Hit[] = [];
  const TOMS = [DRUM.tom1, DRUM.tom2, DRUM.floor, DRUM.snare];
  let f = 0;
  const events: { t: number; kind: 'hat' | 'snare' | 'crash' | 'kick' }[] = [];
  for (const t of o.hat) events.push({ t, kind: 'hat' });
  for (const t of o.kick) events.push({ t, kind: 'kick' });
  for (const t of o.snare) events.push({ t, kind: 'snare' });
  for (const t of o.crash) events.push({ t, kind: 'crash' });
  events.sort((a, b) => a.t - b.t || (a.kind === 'crash' ? -1 : 1));
  const free = (h: Hit[], t: number) => !h.length || t - h[h.length - 1].t >= MIN;
  for (const e of events) {
    if (e.kind === 'crash') {
      // The crash replaces a hat at the same moment.
      if (R.length && Math.abs(R[R.length - 1].t - e.t) < 0.05) R.pop();
      if (free(R, e.t)) R.push({ t: e.t, d: DRUM.crash });
      continue;
    }
    if (inFill(e.t)) {
      if (e.kind !== 'snare') continue;
      // Round the toms, hands alternating.
      const d = TOMS[Math.floor(f / 2) % TOMS.length];
      const first = f % 2 === 0 ? R : L,
        other = f % 2 === 0 ? L : R;
      if (free(first, e.t)) first.push({ t: e.t, d });
      else if (free(other, e.t)) other.push({ t: e.t, d });
      f++;
      continue;
    }
    f = 0;
    if (e.kind === 'kick') {
      // Keeping time: where the hats are quiet (none within a beat), the right hand plays the hat with the kick.
      const near = o.hat[Math.max(0, lastAt(o.hat, e.t + o.beat))];
      const prevH = lastAt(o.hat, e.t);
      const hatNear = (prevH >= 0 && e.t - o.hat[prevH] < o.beat) || (near !== undefined && near > e.t && near - e.t < o.beat);
      if (!hatNear && free(R, e.t)) R.push({ t: e.t, d: DRUM.hat });
      continue;
    }
    if (e.kind === 'hat') {
      if (R.length && R[R.length - 1].d === DRUM.crash && e.t - R[R.length - 1].t < 0.05) continue;
      if (free(R, e.t)) R.push({ t: e.t, d: DRUM.hat });
    } else if (free(L, e.t)) L.push({ t: e.t, d: DRUM.snare });
    else if (free(R, e.t) && !(R.length && Math.abs(R[R.length - 1].t - e.t) < MIN)) R.push({ t: e.t, d: DRUM.snare });
  }
  return {
    rHits: Float32Array.from(R, (h) => h.t),
    rDrum: Uint8Array.from(R, (h) => h.d),
    lHits: Float32Array.from(L, (h) => h.t),
    lDrum: Uint8Array.from(L, (h) => h.d),
  };
}

/** Analyses a whole song in one go (the worker, the tests). */
export function analyseSong(mid: Float32Array, side: Float32Array | null, sr: number, info: SongInfo): SongMaps {
  const a = new SongAnalyser(mid, side, sr, info);
  a.step();
  return a.finish();
}

/** Every buffer of a map (to hand it between threads without copying). */
export function mapBuffers(m: SongMaps): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const v of Object.values(m)) if (ArrayBuffer.isView(v) && !out.includes(v.buffer as ArrayBuffer)) out.push(v.buffer as ArrayBuffer);
  return out;
}

// --- Looking things up (no allocation) -------------------------------------------------

/** Index of the last entry ≤ t in an ascending array (-1 if none). */
export function lastAt(a: ArrayLike<number>, t: number): number {
  let lo = 0,
    hi = a.length - 1,
    r = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (a[m] <= t) {
      r = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  return r;
}

/** A per-frame map's value at `t` s (0..1, interpolated). */
export function frameAt(a: Uint8Array, t: number): number {
  const x = t * MAP_RATE;
  if (!(x >= 0) || x >= a.length - 1) return 0;
  const i = Math.floor(x);
  return (a[i] + (a[i + 1] - a[i]) * (x - i)) / 255;
}

/**
 * A stick (or hand) height over a list of strikes at `t`: 0 on each strike,
 * up to `amp` between them (scaled down when they come fast), lifting off
 * quickly after a strike and falling onto the next. Exactly 0 at each strike time.
 */
export function strikeLift(hits: Float32Array, t: number, amp: number, idle = amp): number {
  const i = lastAt(hits, t);
  const prev = i >= 0 ? hits[i] : -Infinity,
    next = i + 1 < hits.length ? hits[i + 1] : Infinity;
  const since = t - prev,
    until = next - t;
  if (!Number.isFinite(since) && !Number.isFinite(until)) return idle;
  const gap = Math.min(next - prev, 1.2);
  const a = Number.isFinite(gap) ? Math.min(amp, Math.max(amp * 0.25, gap * amp * 2.2)) : amp;
  // Up (rebound) over ~35% of the gap, down onto the next over ~45% (eased so it lands with speed).
  const up = Math.min(1, since / Math.max(0.03, 0.35 * (Number.isFinite(gap) ? gap : 0.4)));
  const dn = Math.min(1, until / Math.max(0.03, 0.45 * (Number.isFinite(gap) ? gap : 0.4)));
  const e = (x: number) => x * (2 - x);
  const hUp = Number.isFinite(since) ? e(up) : 1,
    hDn = Number.isFinite(until) ? Math.sqrt(dn) : 1;
  const h = Math.min(hUp, hDn);
  return (Number.isFinite(gap) && gap > 1.2 ? idle : a) * h;
}
