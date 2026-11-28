import SHOW from './showmoves.json';

/**
 * The headliner's choreography: which move she's doing at each beat of a song,
 * and where on the stage she is. Original routines for Nixie Vale (an
 * electropop star of our own, after no real performer), made from everyday
 * dance vocabulary: sways, hip rolls, shoulder isolations, hits on the beat,
 * arm waves and sweeps out over the crowd, hair flips, side steps, spins, a
 * freeze, arms-up crowd calls, a big pose on each drop, the final pose and a
 * bow. The moves are clips (scripts/build-show-anims.mjs, played by
 * showanim.ts); this is the order.
 *
 * A song is read bar by bar (its sections: setlist.ts). Verses at the mic
 * stand (sways and hip rolls, a hit at the end of each line, a hair flip once
 * a song), pre-choruses building (arm waves), the mic off its stand at the end
 * of the pre-chorus, then the chorus out across the stage with the mic in her
 * hand (a big pose on its downbeat, side steps one way and the other, an arm
 * sweep, spins, a hair flip, a crowd call, back to the middle); back to the
 * stand (the mic on it) for the next verse; the final pose on the bar the
 * music lets go (the song's outro), a bow after it if there's time.
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
export type Cue = 'jump' | 'freeze' | 'spin' | 'kick' | 'call' | 'hit' | 'final' | 'bow' | 'trick' | 'flip';

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

/** The bars of the canonical 32-bar song: a verse (0-7), a pre-chorus (8-15), the chorus. */
export function canonicalParts(bars = 32): string[] {
  return Array.from({ length: bars }, (_, i) => (i < 8 ? 'verse' : i < 16 ? 'pre-chorus' : 'chorus'));
}

/**
 * His routine for the canonical 32-bar song whose music lets go at `endBar`
 * (its first outro bar; the final pose lands there). Steps cover the song beat
 * by beat, back to back.
 */
export function songRoutine(endBar: number, bars = 32): Step[] {
  return routineFor(canonicalParts(bars), endBar);
}

/** The bar a song's music lets go (its first outro bar after its first chorus), where the final pose lands. */
export function songEndBar(parts: readonly string[]): number {
  const c = parts.indexOf('chorus');
  for (let i = Math.max(c >= 0 ? c + 4 : 4, 4); i < parts.length; i++) if (parts[i] === 'outro') return i;
  return parts.length - 2;
}

/**
 * His routine for any song, from what each bar is (`parts`: 'verse',
 * 'pre-chorus', 'chorus', 'outro', anything else plays like a verse) and the
 * bar its music lets go. Verses at the stand (grooves, a hit at the end of each
 * line, the stand trick once a song), pre-choruses building (knee pops), the
 * mic off its stand as a chorus comes in and the chorus out across the stage
 * (back to the stand, mic on it, before the next verse), the final pose where
 * the music lets go, a bow.
 */
export function routineFor(parts: readonly string[], endBar: number): Step[] {
  const bars = parts.length;
  const firstChorus = parts.indexOf('chorus');
  const E = Math.min(bars - 1, Math.max(firstChorus >= 0 ? firstChorus + 4 : 4, endBar)) * 4;
  const out: Step[] = [];
  let at = 0,
    x = 0,
    hand = false,
    trick = false;
  const put = (move: ShowMove, beats: number, o: { to?: number; cue?: Cue } = {}) => {
    if (beats <= 0) return;
    const x1 = o.to ?? x;
    out.push({ move, at, beats, x0: x, x1, hand, cue: o.cue });
    at += beats;
    x = x1;
  };
  const glideBeats = (from: number, to: number) => Math.round((Math.abs(to - from) / GLIDE) * MOVES.Show_GlideL.beats);
  const glide = (to: number, cue?: Cue) => put(to > x ? 'Show_GlideL' : 'Show_GlideR', glideBeats(x, to), { to, cue });
  /** Two-bar lines up to `end` (beats), each its own move and a hit to end it; what doesn't fill a line grooves. */
  const lines = (end: number, line: (k: number) => void) => {
    for (let k = 0; at + 8 <= end; k++) line(k);
    if (at < end) put('Show_Sway', end - at);
  };
  // The runs of bars, up to where the music lets go.
  const runs: { part: string; s: number; e: number }[] = [];
  for (let b = 0; b < E / 4; b++) {
    const part = parts[b] === 'chorus' || parts[b] === 'pre-chorus' ? parts[b] : 'verse';
    const last = runs[runs.length - 1];
    if (last && last.part === part) last.e = b + 1;
    else runs.push({ part, s: b, e: b + 1 });
  }
  for (const [ri, run] of runs.entries()) {
    const end = run.e * 4;
    const next = runs[ri + 1]?.part ?? 'end';
    if (run.part !== 'chorus' && hand) hand = false;
    if (run.part === 'chorus') {
      hand = true;
      // Back at the stand before a verse (not before the end: the final pose is wherever he is).
      const back = next === 'end' ? () => 0 : (to: number) => glideBeats(to, 0);
      // The drop: a big pose on its downbeat, then out across the stage: side steps, an arm sweep
      // over the crowd, spins, a hair flip, a crowd call, back to the middle.
      const chorus: [() => void, number, number][] = [
        [() => put('Show_Pose', 4, { cue: 'jump' }), 4, 0],
        [() => glide(4 * GLIDE), 8, 4 * GLIDE],
        [() => put('Show_Sweep', 4, { cue: 'call' }), 4, NaN],
        [() => (put('Show_Spin2', 2, { cue: 'spin' }), put('Show_Freeze', 2, { cue: 'freeze' })), 4, NaN],
        [() => glide(0), 8, 0],
        [() => put('Show_Call', 4, { cue: 'call' }), 4, NaN],
        [() => glide(-4 * GLIDE), 8, -4 * GLIDE],
        [() => put('Show_HairFlip', 4, { cue: 'flip' }), 4, NaN],
        [() => (put('Show_Spin', 2, { cue: 'spin' }), put('Show_Hit', 1, { cue: 'hit' }), put('Show_HipRoll', 1)), 4, NaN],
        [() => glide(-2 * GLIDE), 4, -2 * GLIDE],
        [() => glide(0), 4, 0],
        [() => put('Show_ArmWave', 4, { cue: 'call' }), 4, NaN],
      ];
      for (let k = 0; ; k++) {
        const [step, beats, to] = chorus[k % chorus.length];
        const xAfter = Number.isNaN(to) ? x : to;
        // (The glides' beats are worked out from where he is: the listed lengths hold from the start.)
        const len = k < chorus.length ? beats : Number.isNaN(to) ? beats : glideBeats(x, to);
        if (len === 0 && k >= chorus.length) continue;
        if (at + len + back(xAfter) > end || k > 4 * chorus.length) break;
        step();
      }
      if (next !== 'end' && x !== 0) glide(0);
      if (at < end) put('Show_Sway', end - at);
    } else if (run.part === 'pre-chorus') {
      // Knee pops building, a hit at the end of each line; going into a chorus, the mic off the stand.
      const into = next === 'chorus';
      const tail = into ? (end - at >= 16 ? 16 : end - at >= 8 ? 8 : 0) : 0;
      lines(end - tail, (k) => (put('Show_ArmWave', 4, { cue: k % 2 ? 'call' : undefined }), put('Show_HipRoll', 3), put('Show_Hit', 1, { cue: 'hit' })));
      if (tail === 16) {
        put('Show_Sweep', 4);
        put('Show_Hits4', 4, { cue: 'hit' });
        hand = true;
        put('Show_Sway', 4);
        put('Show_Spin', 2, { cue: 'spin' });
        put('Show_Sway', 2);
      } else if (tail === 8) {
        put('Show_Hits4', 4, { cue: 'hit' });
        hand = true;
        put('Show_Spin', 2, { cue: 'spin' });
        put('Show_Sway', 2);
      }
    } else {
      // A verse at the stand: grooves, isolations, a hit at the end of each line, the stand trick
      // (once a song); straight into a chorus, the mic off the stand at the end.
      const tail = next === 'chorus' && end - at >= 16 ? 8 : 0;
      lines(end - tail, (k) => {
        if (k % 4 === 3 && !trick) {
          trick = true;
          put('Show_HairFlip', 4, { cue: 'flip' });
          put('Show_Sway', 3);
        } else put(k % 4 === 1 ? 'Show_HipRoll' : k % 4 === 2 ? 'Show_Iso' : 'Show_Sway', 7);
        put('Show_Hit', 1, { cue: 'hit' });
      });
      if (tail) {
        put('Show_Hits4', 4, { cue: 'hit' });
        hand = true;
        put('Show_Spin', 2, { cue: 'spin' });
        put('Show_Sway', 2);
      }
    }
  }
  if (at < E) put('Show_Sway', E - at);
  put('Show_Final', 4, { cue: 'final' });
  const end = bars * 4;
  if (at + 4 <= end) put('Show_Bow', 4, { cue: 'bow' });
  // Back to the middle (for the next song's verse at the stand), then a groove.
  if (x !== 0 && at + 4 <= end && Math.abs(x) <= 2 * GLIDE + 1e-6) glide(0);
  if (at < end) put('Show_Sway', end - at);
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
  Show_Pose: [[0.15, 0.85]],
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

/** Moves that need her whole body (she can't sing through them): they belong in the instrumental passages. */
export const DANCE_HEAVY: ReadonlySet<ShowMove> = new Set<ShowMove>(['Show_Spin', 'Show_Spin2', 'Show_HairFlip', 'Show_Freeze', 'Show_Kick', 'Show_Hits4', 'Show_JumpFreeze', 'Show_Call']);
/** Moves she sings through (sways, steps, hand gestures). */
export const SING_FRIENDLY: ReadonlySet<ShowMove> = new Set<ShowMove>(['Show_Sway', 'Show_HipRoll', 'Show_Iso', 'Show_Groove', 'Show_KneePop', 'Show_GlideL', 'Show_GlideR', 'Show_ArmWave', 'Show_Sweep', 'Show_Hit']);

/**
 * A routine refitted to where she really sings (`beatVocal`: per song beat,
 * 0..255, songmaps.ts): a dance-heavy move that lands on a sung line becomes
 * one she can sing through (a sway, or a hand gesture out to the crowd: an arm
 * sweep or wave for a four-beat move), and a sway of a bar or more in an
 * instrumental passage becomes the dance (hits, a spin, a hair flip, an
 * isolation). The big moments stay put (the pose on a chorus's downbeat, the
 * stand trick, the final pose, the bow), as does where she is on the stage:
 * steps keep their beats and places; only the move (and its cue) changes.
 */
export function fitToVocals(r: Step[], beatVocal: ArrayLike<number>): Step[] {
  const sung = (a: number, n: number) => {
    let s = 0,
      c = 0;
    for (let b = Math.floor(a); b < Math.ceil(a + n); b++) {
      s += b >= 0 && b < beatVocal.length ? beatVocal[b] / 255 : 0;
      c++;
    }
    return c ? s / c : 0;
  };
  const KEEP = new Set<ShowMove>(['Show_Pose', 'Show_StandTilt', 'Show_Final', 'Show_Bow']);
  const out: Step[] = [];
  let dances = 0;
  for (const s of r) {
    if (KEEP.has(s.move) || s.x0 !== s.x1) {
      out.push(s);
      continue;
    }
    const v = sung(s.at, s.beats);
    if (DANCE_HEAVY.has(s.move) && v > 0.5) {
      // Singing: something she can sing through, the same length.
      const four = s.beats === 4;
      const move: ShowMove = four ? (s.hand ? 'Show_Sweep' : 'Show_ArmWave') : 'Show_Sway';
      out.push({ ...s, move, cue: four && s.cue === 'call' ? 'call' : undefined });
      continue;
    }
    if ((s.move === 'Show_Sway' || s.move === 'Show_Groove') && s.beats >= 4 && v < 0.15) {
      // An instrumental passage: dance it, a bar at a time (a hit to finish anything left over).
      let at = s.at;
      const end = s.at + s.beats;
      while (end - at >= 4) {
        const k = dances++ % 4;
        if (k === 0) out.push({ ...s, move: 'Show_Hits4', at, beats: 4, cue: 'hit' });
        else if (k === 1) {
          out.push({ ...s, move: 'Show_Spin', at, beats: 2, cue: 'spin' });
          out.push({ ...s, move: 'Show_HipRoll', at: at + 2, beats: 2, cue: undefined });
        } else if (k === 2) out.push({ ...s, move: 'Show_HairFlip', at, beats: 4, cue: 'flip' });
        else out.push({ ...s, move: 'Show_Iso', at, beats: 4, cue: undefined });
        at += 4;
      }
      if (end > at) out.push({ ...s, move: 'Show_Sway', at, beats: end - at, cue: undefined });
      continue;
    }
    out.push(s);
  }
  return out;
}
