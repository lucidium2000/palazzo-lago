/**
 * Ten-pin scoring (pure, no three.js): a player's rolls in, frames, marks and
 * running totals out; whose turn it is on a lane of up to four players; and
 * what the pinsetter does before the next ball (a fresh rack, or the pins
 * left standing).
 *
 * A roll is the number of pins it knocked down (0..10). A foul counts as a
 * delivery that scores 0 (its pins are respotted), and shows as "F".
 */

export const FRAMES = 10;
export const MAX_PLAYERS = 4;

export interface Frame {
  /** The pins of each ball in the frame (1..3 balls). */
  rolls: number[];
  /** Marks to draw in the frame's boxes ("X", "/", "-", "F", "7"). */
  marks: string[];
  /** Running total through this frame, once it can be known (bonus balls thrown). */
  total: number | null;
  strike: boolean;
  spare: boolean;
}

/** Splits rolls into frames (only the frames started so far). */
function split(rolls: readonly number[]): number[][] {
  const frames: number[][] = [];
  let i = 0;
  while (i < rolls.length && frames.length < FRAMES) {
    if (frames.length === FRAMES - 1) {
      frames.push(rolls.slice(i, i + 3));
      break;
    }
    if (rolls[i] === 10) {
      frames.push([10]);
      i += 1;
    } else {
      frames.push(rolls.slice(i, i + 2));
      i += 2;
    }
  }
  return frames;
}

/** Is a frame (given its balls) finished? */
function frameDone(f: readonly number[], tenth: boolean): boolean {
  if (!tenth) return f[0] === 10 || f.length >= 2;
  if (f.length < 2) return false;
  if (f.length >= 3) return true;
  // Two balls in the tenth: a third only after a strike or a spare.
  return f[0] + f[1] < 10;
}

/** The frames so far, with marks and running totals. `fouls[i]` marks roll i as a foul. */
export function frames(rolls: readonly number[], fouls: readonly boolean[] = []): Frame[] {
  const out: Frame[] = [];
  const parts = split(rolls);
  let idx = 0;
  let run = 0;
  let known = true;
  parts.forEach((f, fi) => {
    const tenth = fi === FRAMES - 1;
    const start = idx;
    idx += f.length;
    const strike = f[0] === 10;
    const spare = !strike && f.length >= 2 && f[0] + f[1] === 10;
    // Score: strike = 10 + next two balls; spare = 10 + next ball; open = the pins.
    let score: number | null;
    if (tenth) score = frameDone(f, true) ? f.reduce((a, b) => a + b, 0) : null;
    else if (strike) score = rolls.length >= start + 3 ? 10 + rolls[start + 1] + rolls[start + 2] : null;
    else if (spare) score = rolls.length >= start + 3 ? 10 + rolls[start + 2] : null;
    else score = f.length === 2 ? f[0] + f[1] : null;
    if (score === null) known = false;
    if (known && score !== null) run += score;
    out.push({ rolls: [...f], marks: marksOf(f, tenth, fouls.slice(start, start + f.length)), total: known && score !== null ? run : null, strike, spare });
  });
  return out;
}

/** The boxes' marks for a frame's balls. */
function marksOf(f: readonly number[], tenth: boolean, fouls: readonly boolean[]): string[] {
  const m: string[] = [];
  const digit = (n: number, i: number) => (fouls[i] ? 'F' : n === 0 ? '-' : String(n));
  if (!tenth) {
    if (f[0] === 10) return ['', 'X'];
    m.push(digit(f[0], 0));
    if (f.length > 1) m.push(f[0] + f[1] === 10 ? '/' : digit(f[1], 1));
    return m;
  }
  // The tenth: the rack resets after a strike or a spare.
  let standing = 10;
  for (let i = 0; i < f.length; i++) {
    const n = f[i];
    const fresh = standing === 10;
    if (fresh && n === 10) m.push('X');
    else if (!fresh && n === standing) m.push('/');
    else m.push(digit(n, i));
    standing = fresh && n === 10 ? 10 : !fresh && n === standing ? 10 : fresh ? 10 - n : 10;
  }
  return m;
}

/** Total score so far (only frames whose bonuses are known count). */
export function total(rolls: readonly number[]): number {
  const fs = frames(rolls);
  for (let i = fs.length - 1; i >= 0; i--) if (fs[i].total !== null) return fs[i].total!;
  return 0;
}

/**
 * The best the score can still reach (every ball from here a strike): what the
 * monitor shows while frames wait on their bonus balls.
 */
export function runningTotal(rolls: readonly number[]): number {
  // Pins and bonuses known so far, counting unknown bonuses as zero.
  const fs = split(rolls);
  let idx = 0,
    run = 0;
  fs.forEach((f, fi) => {
    const start = idx;
    idx += f.length;
    if (fi === FRAMES - 1) {
      run += f.reduce((a, b) => a + b, 0);
      return;
    }
    run += f.reduce((a, b) => a + b, 0);
    if (f[0] === 10) run += (rolls[start + 1] ?? 0) + (rolls[start + 2] ?? 0);
    else if (f.length === 2 && f[0] + f[1] === 10) run += rolls[start + 2] ?? 0;
  });
  return run;
}

/** Frames finished (0..10). */
export function framesDone(rolls: readonly number[]): number {
  const fs = split(rolls);
  let n = 0;
  fs.forEach((f, fi) => {
    if (frameDone(f, fi === FRAMES - 1)) n++;
  });
  return n;
}

export const gameOver = (rolls: readonly number[]) => framesDone(rolls) >= FRAMES;

/** Where the next ball is: the frame (0..9) and the ball in it (0..2). */
export function position(rolls: readonly number[]): { frame: number; ball: number } {
  const fs = split(rolls);
  if (!fs.length) return { frame: 0, ball: 0 };
  const last = fs[fs.length - 1];
  const fi = fs.length - 1;
  if (frameDone(last, fi === FRAMES - 1)) return { frame: Math.min(FRAMES, fs.length), ball: 0 };
  return { frame: fi, ball: last.length };
}

/**
 * What the pinsetter sets before the next ball: a full rack, or the pins left
 * from the ball before ('leftover'), or nothing ('done': the game is over).
 */
export function rackFor(rolls: readonly number[]): 'full' | 'leftover' | 'done' {
  if (gameOver(rolls)) return 'done';
  const { frame, ball } = position(rolls);
  if (ball === 0) return 'full';
  const f = split(rolls)[frame];
  if (frame < FRAMES - 1) return 'leftover';
  // The tenth.
  if (ball === 1) return f[0] === 10 ? 'full' : 'leftover';
  // Third ball: after X X, or X then a spare-making ball, or a spare.
  if (f[0] === 10) return f[1] === 10 ? 'full' : 'leftover';
  return 'full';
}

/** How many pins are standing for the next ball (10 on a fresh rack). */
export function pinsUp(rolls: readonly number[]): number {
  const rack = rackFor(rolls);
  if (rack !== 'leftover') return rack === 'full' ? 10 : 0;
  return 10 - rolls[rolls.length - 1];
}

/** Is `n` pins a legal next roll? */
export const legal = (rolls: readonly number[], n: number) => Number.isInteger(n) && n >= 0 && n <= pinsUp(rolls);

// ---------------------------------------------------------------------------
// A lane: up to four players taking turns, a frame each
// ---------------------------------------------------------------------------

export interface Bowler {
  id: string;
  name: string;
  rolls: number[];
  fouls: boolean[];
}

export class LaneGame {
  players: Bowler[] = [];

  /** Whose ball it is: the first player (in order) with the fewest frames done; null when all are done or nobody plays. */
  get current(): Bowler | null {
    let best: Bowler | null = null;
    let bn = Infinity;
    for (const p of this.players) {
      const n = framesDone(p.rolls);
      if (n < FRAMES && n < bn) {
        best = p;
        bn = n;
      }
    }
    return best;
  }

  get over() {
    return this.players.length > 0 && this.players.every((p) => gameOver(p.rolls));
  }

  /** Total balls thrown on this lane (a roll's sequence number, so a late or repeated message is ignored). */
  get balls() {
    return this.players.reduce((n, p) => n + p.rolls.length, 0);
  }

  has(id: string) {
    return this.players.some((p) => p.id === id);
  }

  join(id: string, name: string): boolean {
    if (this.has(id) || this.players.length >= MAX_PLAYERS) return this.has(id);
    // A finished game starts over when someone new walks up.
    if (this.over) this.reset();
    this.players.push({ id, name: name.slice(0, 14), rolls: [], fouls: [] });
    return true;
  }

  leave(id: string) {
    this.players = this.players.filter((p) => p.id !== id);
  }

  reset() {
    for (const p of this.players) {
      p.rolls = [];
      p.fouls = [];
    }
  }

  /**
   * The current player's ball knocked `pins` down (a foul scores 0). Returns
   * the frame event worth celebrating, or null if it wasn't their ball.
   */
  roll(id: string, pins: number, foul = false): RollResult | null {
    const p = this.current;
    if (!p || p.id !== id) return null;
    const n = foul ? 0 : Math.max(0, Math.min(pinsUp(p.rolls), Math.round(pins)));
    const before = position(p.rolls);
    const up = pinsUp(p.rolls);
    const fresh = rackFor(p.rolls) === 'full';
    p.rolls.push(n);
    p.fouls.push(foul);
    return { player: p, pins: n, foul, kind: rollKind(p.rolls, fresh, up, n, foul), frame: before.frame, ball: before.ball };
  }
}

export type RollKind = 'strike' | 'spare' | 'gutter' | 'foul' | 'open' | 'turkey' | 'double';

export interface RollResult {
  player: Bowler;
  pins: number;
  foul: boolean;
  kind: RollKind;
  frame: number;
  ball: number;
}

/** What a ball was worth celebrating (the last of `rolls`, thrown at `up` pins). */
function rollKind(rolls: readonly number[], fresh: boolean, up: number, n: number, foul: boolean): RollKind {
  if (foul) return 'foul';
  if (fresh && n === 10) {
    // Strikes in a row (the previous two balls also strikes, each on a fresh rack).
    let run = 0;
    const seq: boolean[] = [];
    for (let i = 0; i < rolls.length; i++) seq.push(rolls[i] === 10 && rackFor(rolls.slice(0, i)) === 'full');
    for (let i = seq.length - 1; i >= 0 && seq[i]; i--) run++;
    return run >= 3 ? 'turkey' : run === 2 ? 'double' : 'strike';
  }
  if (!fresh && n === up) return 'spare';
  if (n === 0) return 'gutter';
  return 'open';
}
