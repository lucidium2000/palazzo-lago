/**
 * The pool party's beat clock. The game follows the music: each track's
 * measured tempo, first-beat offset and per-bar energy (public/audio/index.json,
 * measured by tools/audio/analyze_music.py) become an Arrangement, a bar-by-bar
 * map of where the music is going (drop, breakdown, build), how hard it is
 * going and whether the kick is in, so the lights, the dancers, the headliner
 * and your own bounce all read the real track: beat, bar, phase, section and
 * intensity.
 *
 * Drops, breakdowns and builds are found in the DJ set's numbers rather than
 * assumed: a drop is a big jump in the drums' level, a breakdown a run of
 * bars with the drums well down, a build the end of a breakdown leading into
 * a drop. The headliner's songs carry their own sections (verse, pre-chorus,
 * chorus): their chorus is where the DJ would have the drop.
 *
 * Pure (no three.js, no audio): unit-tested in tests/beat.test.ts.
 */

/**
 * The synthesized fallback set's fixed shape (party/track.ts renders it if the
 * real music can't be fetched): 64 bars at 122 bpm, two 32-bar cycles of a
 * 16-bar drop, an 8-bar breakdown and an 8-bar build.
 */
export const PARTY = {
  bpm: 122,
  /** Bars in one slot of the set list (the DJ's set; the headliner's two songs). */
  bars: 64,
  /** A drop, a breakdown and a build every this many bars (also one of the headliner's songs). */
  cycle: 32,
  /** Section lengths within a cycle (bars): drop, break, build. */
  drop: 16,
  breakdown: 8,
  build: 8,
} as const;

export type Section = 'drop' | 'break' | 'build';

export const beatLen = (bpm: number = PARTY.bpm) => 60 / bpm;
export const loopLength = (bpm: number = PARTY.bpm, bars: number = PARTY.bars) => bars * 4 * beatLen(bpm);

/** Which part of the synthesized set's 32-bar cycle a bar (any index) falls in. */
export function sectionOf(bar: number): Section {
  const c = ((bar % PARTY.cycle) + PARTY.cycle) % PARTY.cycle;
  if (c < PARTY.drop) return 'drop';
  if (c < PARTY.drop + PARTY.breakdown) return 'break';
  return 'build';
}

/** Is the synthesized set's kick drum playing in this bar? (Off in the breakdown and the last 4 bars of the build.) */
export function kickIn(bar: number): boolean {
  const c = ((bar % PARTY.cycle) + PARTY.cycle) % PARTY.cycle;
  if (c < PARTY.drop) return true;
  if (c < PARTY.drop + PARTY.breakdown) return false;
  return c < PARTY.cycle - 4;
}

// ---------------------------------------------------------------------------
// Arrangements: the music, bar by bar
// ---------------------------------------------------------------------------

/** One bar's measured energy (dB): percussive, tonal, and the whole mix. */
export interface BarLevels {
  drums: number;
  tonal: number;
  level: number;
}

/** A track as measured (an entry of public/audio/index.json). */
export interface MeasuredTrack {
  bpm: number;
  firstBeat: number;
  bars: number;
  seconds: number;
  perBar: BarLevels[];
  sections?: { name: string; bar: number; bars: number; sung: boolean }[];
}

/** What a bar of the set is. */
export interface BarInfo {
  section: Section;
  /** What it's called in its track ('drop', 'break', 'build'; a song's 'verse', 'pre-chorus', 'chorus', 'outro'). */
  part: string;
  /** 0..1 how hard the music is going (before the build's rise). */
  intensity: number;
  /** The kick (the drums) is in. */
  kick: boolean;
  /** A drop lands on this bar's downbeat. */
  drop: boolean;
  /** 0..1 a voice is singing through this bar. */
  voice: number;
  /** Which track of the set (0: the DJ; 1, 2: the headliner's songs). */
  track: number;
  /** Bar within its section, and the section's length (filled in by `arrangement`). */
  secBar: number;
  secLen: number;
  /** Bars since the last drop landed (filled in by `arrangement`). */
  sinceDrop: number;
}

export interface Arrangement {
  bpm: number;
  bars: BarInfo[];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function percentile(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
}

/** Thresholds (dB) of the detection. */
export const DETECT = {
  /** A drop: the drums jump at least this much over the bars before. */
  jump: 6,
  /** A breakdown: the drums at least this far under the track's median. */
  low: 6,
  /** A bar this far under the track's loud level is (near) silent. */
  silent: 15,
};

/**
 * Reads a track's sections from its per-bar energy (the DJ's set: no section
 * map to trust). `loop`: the track wraps (its first bar follows its last).
 */
export function detectSections(per: BarLevels[], loop: boolean, track = 0): BarInfo[] {
  const n = per.length;
  const d = per.map((p) => p.drums),
    L = per.map((p) => p.level);
  const med = percentile(d, 0.5),
    hiD = percentile(d, 0.85),
    hiL = percentile(L, 0.85);
  const at = (i: number) => (loop ? d[((i % n) + n) % n] : i >= 0 && i < n ? d[i] : NaN);
  const low = d.map((x, i) => x < med - DETECT.low || L[i] < hiL - DETECT.silent);
  // Drop candidates: a big jump over the lower of the two bars before.
  const cand = d.map((x, i) => {
    if (low[i]) return false;
    const prev = [at(i - 1), at(i - 2)].filter(Number.isFinite);
    return prev.length > 0 && x - Math.min(...prev) >= DETECT.jump;
  });
  const drop = new Array<boolean>(n).fill(false);
  const lead = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (!cand[i]) continue;
    // One drop per jump (the next bar often qualifies too).
    let near = false;
    for (let k = 1; k <= 4; k++) {
      const j = i - k;
      if ((loop || j >= 0) && drop[((j % n) + n) % n]) near = true;
    }
    if (near) continue;
    // A build's fill often lifts the bar before the phrase: the drop lands on the phrase line.
    const nx = i + 1;
    if (nx % 4 === 0 && (loop || nx < n) && at(nx) >= d[i]) {
      drop[nx % n] = true;
      lead[i] = true;
    } else drop[i] = true;
  }
  const out: BarInfo[] = per.map((p, i) => {
    const dN = clamp01((p.drums - (hiD - 20)) / 20),
      lN = clamp01((p.level - (hiL - 12)) / 12);
    let intensity = 0.3 + 0.7 * (0.5 * dN + 0.5 * lN);
    const section: Section = low[i] ? 'break' : 'drop';
    if (section === 'break') intensity = Math.min(intensity, 0.45);
    return { section, part: section, intensity, kick: !low[i], drop: drop[i], voice: 0, track, secBar: 0, secLen: 1, sinceDrop: 0 };
  });
  // Builds: the end of the run of breakdown (and fill) bars before each drop.
  for (let i = 0; i < n; i++) {
    if (!drop[i]) continue;
    const run: number[] = [];
    for (let k = 1; k < n; k++) {
      const j = i - k;
      if (!loop && j < 0) break;
      const jj = ((j % n) + n) % n;
      if (!(low[jj] || lead[jj]) || drop[jj]) break;
      run.push(jj);
    }
    const nb = Math.min(4, Math.ceil(run.length / 2));
    for (let k = 0; k < nb; k++) {
      out[run[k]].section = 'build';
      out[run[k]].part = 'build';
    }
  }
  return out;
}

/** A song's bars from its section map (sung through; quiet bars at the end are its outro). */
export function songSections(per: BarLevels[], sections: NonNullable<MeasuredTrack['sections']>, track: number): BarInfo[] {
  const hiL = percentile(
    per.map((p) => p.level),
    0.85,
  );
  const med = percentile(
    per.map((p) => p.drums),
    0.5,
  );
  return per.map((p, i) => {
    const s = sections.find((x) => i >= x.bar && i < x.bar + x.bars) ?? sections[sections.length - 1];
    const quiet = p.level < hiL - 10;
    const fade = clamp01((p.level - (hiL - 16)) / 10);
    const name = quiet ? 'outro' : s.name;
    const section: Section = name === 'chorus' ? 'drop' : name === 'pre-chorus' ? 'build' : 'break';
    const intoChorus = name === 'chorus' ? i - s.bar : 0;
    const base = name === 'chorus' ? (intoChorus < 8 ? 1 : 0.9) : name === 'pre-chorus' ? 0.45 : name === 'verse' ? 0.55 : 0.3;
    return {
      section,
      part: name,
      intensity: Math.max(0.15, base * (0.3 + 0.7 * fade)),
      kick: !quiet && p.drums > med - DETECT.low - 6,
      drop: name === 'chorus' && i === s.bar,
      voice: s.sung && !quiet ? 1 : 0,
      track,
      secBar: 0,
      secLen: 1,
      sinceDrop: 0,
    };
  });
}

/** The synthesized fallback set's 64 bars (the fixed 16/8/8 shape above). */
export function synthSections(): BarInfo[] {
  return Array.from({ length: PARTY.bars }, (_, bar) => {
    const c = bar % PARTY.cycle;
    const section = sectionOf(bar);
    const intensity = section === 'drop' ? (c < 8 ? 1 : 0.9) : section === 'break' ? 0.3 + (0.08 * (c - PARTY.drop)) / PARTY.breakdown : 0.4;
    return { section, part: section, intensity, kick: kickIn(bar), drop: c === 0, voice: 0, track: 0, secBar: 0, secLen: 1, sinceDrop: 0 };
  });
}

/**
 * The whole set list as one looping arrangement: the tracks' bars one after
 * another, with each bar's place in its section and since the last drop
 * worked out round the loop.
 */
export function arrangement(bpm: number, ...tracks: BarInfo[][]): Arrangement {
  const bars = tracks.flat().map((b) => ({ ...b }));
  const n = bars.length;
  const starts = (i: number) => {
    const p = bars[(i - 1 + n) % n],
      b = bars[i];
    return b.drop || b.section !== p.section || b.part !== p.part || b.track !== p.track;
  };
  let s0 = -1;
  for (let i = 0; i < n && s0 < 0; i++) if (starts(i)) s0 = i;
  if (s0 < 0) {
    bars.forEach((b, i) => ((b.secBar = i), (b.secLen = n)));
  } else {
    let runStart = s0;
    for (let k = 1; k <= n; k++) {
      const i = (s0 + k) % n;
      if (k === n || starts(i)) {
        const len = k - ((runStart - s0 + n) % n);
        for (let m = 0; m < len; m++) {
          const b = bars[(runStart + m) % n];
          b.secBar = m;
          b.secLen = len;
        }
        runStart = i;
      }
    }
  }
  const firstDrop = bars.findIndex((b) => b.drop);
  for (let i = 0; i < n; i++) {
    if (firstDrop < 0) {
      bars[i].sinceDrop = i;
      continue;
    }
    let k = 0;
    while (k < n && !bars[(i - k + n) % n].drop) k++;
    bars[i].sinceDrop = k;
  }
  return { bpm, bars };
}

/** The synthesized fallback: the DJ's 64 bars at 122 bpm (twice round the set list). */
export const SYNTH_SET = arrangement(PARTY.bpm, synthSections(), synthSections());

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

export interface Beat {
  /** Seconds into the loop. */
  t: number;
  /** Continuous beats since the loop started (0 .. bars*4). */
  beats: number;
  /** Whole beat index within the loop. */
  beat: number;
  /** Bar within the loop. */
  bar: number;
  /** 0..3. */
  beatInBar: number;
  /** 0..1 through the current beat (0 = on the kick). */
  phase: number;
  /** 0..1 through the current bar. */
  barPhase: number;
  section: Section;
  /** The section's name in its track (see BarInfo.part). */
  part: string;
  /** Bar within the current section, and the section's length in bars. */
  secBar: number;
  secLen: number;
  /** Which track of the set this is. */
  track: number;
  /** 0..1: how hard the music is going (the drop high, the breakdown low, the build rising). */
  intensity: number;
  /** 0..1 through the build (0 outside it). */
  build: number;
  /** Beats since the last drop landed (counts on through the breakdown and build). */
  sinceDrop: number;
  /** 1 right on each beat, decaying through it (kick-shaped). */
  pulse: number;
  /** Whether the kick is playing now. */
  kick: boolean;
  /** 0..1: a voice is singing (with a breath at the end of each two-bar line). */
  voice: number;
}

/** Bars of a loop of `bars` at `bpm`, as an arrangement with nothing in it but the beat. */
export function plainArrangement(bpm: number, bars: number): Arrangement {
  return arrangement(
    bpm,
    Array.from({ length: bars }, () => ({ section: 'drop' as Section, part: 'drop', intensity: 0.85, kick: true, drop: false, voice: 0, track: 0, secBar: 0, secLen: 1, sinceDrop: 0 })),
  );
}

export const arrangementLength = (a: Arrangement) => loopLength(a.bpm, a.bars.length);

/** Where the music is `t` seconds into the loop (any t: it wraps). */
export function beatAt(t: number, arr: Arrangement = SYNTH_SET): Beat {
  const bpm = arr.bpm,
    bars = arr.bars.length;
  const len = loopLength(bpm, bars);
  const tt = ((t % len) + len) % len;
  const beats = tt / beatLen(bpm);
  const beat = Math.floor(beats);
  const phase = beats - beat;
  const bar = Math.floor(beat / 4) % bars;
  const beatInBar = beat % 4;
  const barPhase = (beatInBar + phase) / 4;
  const info = arr.bars[bar];
  const section = info.section;
  let intensity = info.intensity,
    build = 0;
  if (section === 'build') {
    build = (info.secBar + barPhase) / info.secLen;
    intensity = Math.max(intensity, 0.4 + 0.55 * build * build);
  }
  const sinceDrop = info.sinceDrop * 4 + beatInBar + phase;
  const kick = info.kick;
  const pulse = Math.exp(-phase * 6) * (kick ? 1 : 0.35);
  // A breath at the end of each two-bar line (and none past the last sung bar).
  let voice = info.voice;
  if (voice > 0) {
    const inLine = ((bar % 2) * 4 + beatInBar + phase) / 8;
    const next = arr.bars[(bar + 1) % bars].voice;
    if (inLine > 0.94) voice *= bar % 2 && next > 0 ? 1 - Math.sin(((inLine - 0.94) / 0.06) * Math.PI) : 1 - (inLine - 0.94) / 0.06;
  }
  return { t: tt, beats, beat, bar, beatInBar, phase, barPhase, section, part: info.part, secBar: info.secBar, secLen: info.secLen, track: info.track, intensity, build, sinceDrop, pulse, kick, voice: clamp01(voice) };
}

/**
 * Follows the music from frame to frame and says what just happened: a new
 * beat, a new bar, a drop landing. Feed it the set's position each frame.
 */
export class BeatClock {
  now: Beat;
  /** This update crossed a beat / a bar line / a drop. */
  onBeat = false;
  onBar = false;
  onDrop = false;
  private lastBeats = -1;

  constructor(public arr: Arrangement = SYNTH_SET) {
    this.now = beatAt(0, arr);
  }

  get bpm() {
    return this.arr.bpm;
  }

  get bars() {
    return this.arr.bars.length;
  }

  /** The whole loop (s). */
  get loop() {
    return arrangementLength(this.arr);
  }

  /** Follow another arrangement (the real music arrived, or the fallback took over). */
  setArrangement(arr: Arrangement) {
    if (arr === this.arr) return;
    this.arr = arr;
    this.lastBeats = -1;
  }

  /** Position in seconds (wraps). */
  update(t: number): Beat {
    const b = beatAt(t, this.arr);
    const total = this.bars * 4;
    const prev = this.lastBeats;
    this.onBeat = this.onBar = this.onDrop = false;
    if (prev >= 0) {
      // Wrapped round the end of the loop: count on past it.
      let cur = b.beats;
      if (cur < prev - total / 2) cur += total;
      // A big jump (paused tab, a resync) isn't a beat: just pick up from here.
      if (cur > prev && cur - prev < 4) {
        this.onBeat = Math.floor(cur) > Math.floor(prev);
        this.onBar = Math.floor(cur / 4) > Math.floor(prev / 4);
        this.onDrop = this.onBar && this.arr.bars[b.bar].drop;
      }
    }
    this.lastBeats = b.beats;
    this.now = b;
    return b;
  }
}
