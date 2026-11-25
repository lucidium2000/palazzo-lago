/**
 * The pool party's beat clock. The DJ set is a 64-bar house track (two
 * 32-bar cycles: a 16-bar drop, an 8-bar breakdown, an 8-bar build back
 * into the next drop), synthesized offline from the same arrangement this
 * file describes, so the lights, the dancers and your own bounce can all read
 * where the music is: beat, bar, phase, section and intensity.
 *
 * Pure (no three.js, no audio): unit-tested in tests/beat.test.ts.
 */

export const PARTY = {
  bpm: 122,
  /** Bars in the whole (seamless) loop. */
  bars: 64,
  /** A drop, a breakdown and a build every this many bars. */
  cycle: 32,
  /** Section lengths within a cycle (bars): drop, break, build. */
  drop: 16,
  breakdown: 8,
  build: 8,
} as const;

export type Section = 'drop' | 'break' | 'build';

export const beatLen = (bpm: number = PARTY.bpm) => 60 / bpm;
export const loopLength = (bpm: number = PARTY.bpm, bars: number = PARTY.bars) => bars * 4 * beatLen(bpm);

/** Which part of the 32-bar cycle a bar (any index) falls in. */
export function sectionOf(bar: number): Section {
  const c = ((bar % PARTY.cycle) + PARTY.cycle) % PARTY.cycle;
  if (c < PARTY.drop) return 'drop';
  if (c < PARTY.drop + PARTY.breakdown) return 'break';
  return 'build';
}

/** Is the kick drum playing in this bar? (Off in the breakdown and the last 4 bars of the build.) */
export function kickIn(bar: number): boolean {
  const c = ((bar % PARTY.cycle) + PARTY.cycle) % PARTY.cycle;
  if (c < PARTY.drop) return true;
  if (c < PARTY.drop + PARTY.breakdown) return false;
  return c < PARTY.cycle - 4;
}

export interface Beat {
  /** Seconds into the loop. */
  t: number;
  /** Continuous beats since the loop started (0 .. bars*4). */
  beats: number;
  /** Whole beat index within the loop. */
  beat: number;
  /** Bar within the loop (0 .. bars-1). */
  bar: number;
  /** 0..3. */
  beatInBar: number;
  /** 0..1 through the current beat (0 = on the kick). */
  phase: number;
  /** 0..1 through the current bar. */
  barPhase: number;
  /** Bar within the 32-bar cycle (0 = the drop lands). */
  cycleBar: number;
  section: Section;
  /** 0..1: how hard the music is going (the drop is 1, the breakdown low, the build rises). */
  intensity: number;
  /** 0..1 through the build (0 outside it). */
  build: number;
  /** Beats since the last drop landed (counts on through the breakdown and build). */
  sinceDrop: number;
  /** 1 right on each beat, decaying through it (kick-shaped). */
  pulse: number;
  /** Whether the kick is playing now. */
  kick: boolean;
}

/** Where the music is `t` seconds into the loop (any t: it wraps). */
export function beatAt(t: number, bpm: number = PARTY.bpm, bars: number = PARTY.bars): Beat {
  const len = loopLength(bpm, bars);
  const tt = ((t % len) + len) % len;
  const beats = tt / beatLen(bpm);
  const beat = Math.floor(beats);
  const phase = beats - beat;
  const bar = Math.floor(beat / 4) % bars;
  const beatInBar = beat % 4;
  const barPhase = (beatInBar + phase) / 4;
  const cycleBar = bar % PARTY.cycle;
  const section = sectionOf(bar);
  const sinceDrop = cycleBar * 4 + beatInBar + phase;
  let intensity: number,
    build = 0;
  if (section === 'drop') {
    // Peaks as the drop lands, settles a touch through its second half.
    intensity = cycleBar < 8 ? 1 : 0.9;
  } else if (section === 'break') {
    // Low, easing up a little toward the build.
    intensity = 0.3 + 0.08 * ((cycleBar - PARTY.drop + barPhase) / PARTY.breakdown);
  } else {
    build = (cycleBar - PARTY.drop - PARTY.breakdown + barPhase) / PARTY.build;
    intensity = 0.4 + 0.55 * build * build;
  }
  const kick = kickIn(bar);
  const pulse = Math.exp(-phase * 6) * (kick ? 1 : 0.35);
  return { t: tt, beats, beat, bar, beatInBar, phase, barPhase, cycleBar, section, intensity, build, sinceDrop, pulse, kick };
}

/**
 * Follows the music from frame to frame and says what just happened: a new
 * beat, a new bar, the drop landing. Feed it the track position each frame.
 */
export class BeatClock {
  now: Beat;
  /** This update crossed a beat / a bar line / the drop. */
  onBeat = false;
  onBar = false;
  onDrop = false;
  private lastBeats = -1;

  constructor(
    readonly bpm: number = PARTY.bpm,
    readonly bars: number = PARTY.bars,
  ) {
    this.now = beatAt(0, bpm, bars);
  }

  get loop() {
    return loopLength(this.bpm, this.bars);
  }

  /** Track position in seconds (wraps). */
  update(t: number): Beat {
    const b = beatAt(t, this.bpm, this.bars);
    const total = this.bars * 4;
    let prev = this.lastBeats;
    this.onBeat = this.onBar = this.onDrop = false;
    if (prev >= 0) {
      // Wrapped round the end of the loop: count on past it.
      let cur = b.beats;
      if (cur < prev - total / 2) cur += total;
      // A big jump (paused tab, a resync) isn't a beat: just pick up from here.
      if (cur > prev && cur - prev < 4) {
        this.onBeat = Math.floor(cur) > Math.floor(prev);
        this.onBar = Math.floor(cur / 4) > Math.floor(prev / 4);
        this.onDrop = Math.floor(cur / (PARTY.cycle * 4)) > Math.floor(prev / (PARTY.cycle * 4));
      }
      prev = cur;
    }
    this.lastBeats = b.beats;
    this.now = b;
    return b;
  }
}
