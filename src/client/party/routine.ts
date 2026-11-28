import SHOW from './showmoves.json';

/**
 * The headliner's choreography: which move he's doing at each beat of a song,
 * and where on the stage he is. Original routines for Orlo Vante (an 80s pop
 * showman of our own, after no real performer), made from everyday dance
 * vocabulary: grooves, hits on the beat, shoulder isolations, knee pops, side
 * glides, spins, a front kick, a jump into a freeze, arms-up crowd calls, a
 * lunge for the final pose and a bow. The moves are clips
 * (scripts/build-show-anims.mjs, played by showanim.ts); this is the order.
 *
 * Each of his songs is 32 bars: a verse (bars 0-7) and a pre-chorus (8-15) at
 * the mic stand, the mic on its stand (the stand trick in bar 6, the mic off
 * the stand in bar 14), then the chorus out across the stage with the mic in
 * his hand: a jump into a freeze on its downbeat, glides to one side and the
 * other, kicks, spins, a crowd call, hits, back to the middle, and the final
 * pose on the bar the music lets go (the song's outro), a bow after it if
 * there's time.
 *
 * Pure (no three.js): unit-tested in tests/routine.test.ts.
 */

export type ShowMove = keyof typeof SHOW.moves;
export interface MoveInfo {
  beats: number;
  loop?: boolean;
  /** Travel per cycle (m, + his left / world +x as he faces the crowd). */
  dx?: number;
}
export const MOVES = SHOW.moves as Record<ShowMove, MoveInfo>;
/** The tempo the clips were authored at (they're played by the beat clock, at any tempo). */
export const SHOW_BPM = SHOW.bpm;
/** Every clip. */
export const SHOW_CLIPS = Object.keys(MOVES) as ShowMove[];

/** Something that happens on a step's first beat (the lights, the crowd, the effects follow these). */
export type Cue = 'jump' | 'freeze' | 'spin' | 'kick' | 'call' | 'hit' | 'final' | 'bow' | 'trick';

export interface Step {
  move: ShowMove;
  /** Song beat it starts on, and how long it lasts (a looping move repeats). */
  at: number;
  beats: number;
  /** Where he is across the stage (m from the mic, + his left) at its start and end. */
  x0: number;
  x1: number;
  /** The mic's in his hand (else on its stand). */
  hand: boolean;
  cue?: Cue;
}

/** How far a side glide takes him in one cycle. */
export const GLIDE = MOVES.Show_GlideL.dx ?? 0.45;

/**
 * His routine for a song whose music lets go at `endBar` (its first outro bar;
 * the final pose lands there). Steps cover beats 0 .. 128 back to back.
 */
export function songRoutine(endBar: number, bars = 32): Step[] {
  const E = Math.max(20, Math.min(bars - 1, endBar)) * 4;
  const out: Step[] = [];
  let at = 0,
    x = 0,
    hand = false;
  const put = (move: ShowMove, beats: number, o: { to?: number; cue?: Cue } = {}) => {
    const x1 = o.to ?? x;
    out.push({ move, at, beats, x0: x, x1, hand, cue: o.cue });
    at += beats;
    x = x1;
  };
  const glide = (to: number, cue?: Cue) => {
    const beats = Math.round((Math.abs(to - x) / GLIDE) * MOVES.Show_GlideL.beats);
    put(to > x ? 'Show_GlideL' : 'Show_GlideR', beats, { to, cue });
  };
  // Verse: at the stand, grooving, a hit at the end of each line, the stand trick.
  put('Show_Groove', 7);
  put('Show_Hit', 1, { cue: 'hit' });
  put('Show_Groove', 7);
  put('Show_Hit', 1, { cue: 'hit' });
  put('Show_Iso', 7);
  put('Show_Hit', 1, { cue: 'hit' });
  put('Show_StandTilt', 4, { cue: 'trick' });
  put('Show_Groove', 3);
  put('Show_Hit', 1, { cue: 'hit' });
  // Pre-chorus: knee pops building, hits, the mic off the stand, a spin.
  put('Show_KneePop', 7);
  put('Show_Hit', 1, { cue: 'hit' });
  put('Show_KneePop', 7);
  put('Show_Hit', 1, { cue: 'hit' });
  put('Show_Iso', 4);
  put('Show_Hits4', 4, { cue: 'hit' });
  hand = true;
  put('Show_Groove', 4);
  put('Show_Spin', 2, { cue: 'spin' });
  put('Show_Groove', 2);
  // Chorus: out across the stage.
  const chorus: [() => void, number][] = [
    [() => put('Show_JumpFreeze', 4, { cue: 'jump' }), 4],
    [() => glide(4 * GLIDE), 8],
    [() => (put('Show_Kick', 2, { cue: 'kick' }), put('Show_Kick', 2, { cue: 'kick' })), 4],
    [() => (put('Show_Spin2', 2, { cue: 'spin' }), put('Show_Freeze', 2, { cue: 'freeze' })), 4],
    [() => glide(0), 8],
    [() => put('Show_Call', 4, { cue: 'call' }), 4],
    [() => glide(-4 * GLIDE), 8],
    [() => put('Show_Hits4', 4, { cue: 'hit' }), 4],
    [() => (put('Show_Spin', 2, { cue: 'spin' }), put('Show_Kick', 2, { cue: 'kick' })), 4],
    [() => glide(-2 * GLIDE), 4],
    [() => glide(0), 4],
    [() => put('Show_Call', 4, { cue: 'call' }), 4],
  ];
  for (const [step, beats] of chorus) {
    if (at + beats > E) break;
    step();
  }
  // Fill up to the final pose (a groove, on the spot).
  if (at < E) put('Show_Groove', E - at);
  put('Show_Final', 4, { cue: 'final' });
  const end = bars * 4;
  if (at + 4 <= end) put('Show_Bow', 4, { cue: 'bow' });
  // Back to the middle (for the next song's verse at the stand), then a groove.
  if (x !== 0 && at + 4 <= end && Math.abs(x) <= 2 * GLIDE + 1e-6) glide(0);
  if (at < end) put('Show_Groove', end - at);
  return out;
}

export interface At {
  step: Step;
  /** Index of the step. */
  i: number;
  /** 0..1 through the clip (a looping move: through this cycle; past a one-shot's end it stays at 1). */
  f: number;
  /** Beats into the step. */
  into: number;
  /** Where he is across the stage now (m). */
  x: number;
}

/** Where a routine is at song beat `b` (0 .. its length). */
export function stepAt(r: Step[], b: number, out?: At): At {
  let i = 0;
  while (i < r.length - 1 && r[i + 1].at <= b) i++;
  const s = r[i];
  const into = Math.max(0, b - s.at);
  const m = MOVES[s.move];
  const f = m.loop ? (into % m.beats) / m.beats : Math.min(1, into / m.beats);
  const x = s.x0 + (s.x1 - s.x0) * Math.min(1, into / s.beats);
  if (!out) return { step: s, i, f, into, x };
  out.step = s;
  out.i = i;
  out.f = f;
  out.into = into;
  out.x = x;
  return out;
}

/**
 * Times in a move when his mic hand leaves his mouth for the move's own arm
 * work (fractions of the clip): the crowd call's arms up, the arm out in the
 * hits, the final pose's arm out, the bow.
 */
export const MIC_FREE: Partial<Record<ShowMove, [number, number][]>> = {
  Show_Call: [[0.5, 0.88]],
  Show_Hits4: [[0.5, 0.72]],
  Show_Final: [[0.2, 1]],
  Show_Bow: [[0.05, 0.85]],
};

/** 0..1: how free his mic hand is at `f` through `move` (eased over a short edge). */
export function micFree(move: ShowMove, f: number): number {
  const spans = MIC_FREE[move];
  if (!spans) return 0;
  let w = 0;
  for (const [a, b] of spans) {
    const e = 0.06;
    const k = Math.min((f - a) / e + 1, (b - f) / e + 1);
    w = Math.max(w, Math.max(0, Math.min(1, k)));
  }
  return w;
}
