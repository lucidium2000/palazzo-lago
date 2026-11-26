/**
 * The shared shapes of the arcade: a cabinet's controls as a game sees them,
 * the game interface every cabinet runs, a small seeded RNG and the song
 * format the chiptune player reads.
 *
 * Games are plain logic plus a draw function onto a 320x240 canvas. Their
 * update never touches the DOM, so the tests step them in Node.
 */

/** The screen every cabinet draws on (4:3, chunky pixels). */
export const SCREEN_W = 320;
export const SCREEN_H = 240;
/** Every game steps at a fixed 60 Hz. */
export const STEP = 1 / 60;

/** One player's controls for one step: stick (-1..1, y up), three buttons, and what changed since the last step. */
export interface Input {
  x: number;
  y: number;
  a: boolean;
  b: boolean;
  c: boolean;
  /** Pressed this step. */
  ap: boolean;
  bp: boolean;
  cp: boolean;
  /** The stick moved into a direction this step (-1, 0, 1), for menus and initials. */
  dx: number;
  dy: number;
}

export function blankInput(): Input {
  return { x: 0, y: 0, a: false, b: false, c: false, ap: false, bp: false, cp: false, dx: 0, dy: 0 };
}

/** Raw control state (what a hand, a key or a friend's message says), before edges are worked out. */
export interface RawPad {
  x: number;
  y: number;
  a: boolean;
  b: boolean;
  c: boolean;
}

export function blankPad(): RawPad {
  return { x: 0, y: 0, a: false, b: false, c: false };
}

/**
 * Turns raw control states into game inputs with edges (no allocation).
 * The stick's direction edge uses a threshold with hysteresis so a wobbly
 * hand on the joystick doesn't flick through initials.
 */
export class EdgeTracker {
  private pa = false;
  private pb = false;
  private pc = false;
  private sx = 0;
  private sy = 0;
  /** Auto-repeat for a held direction (menus), seconds until the next repeat. */
  private rep = 0;

  apply(raw: RawPad, out: Input, dt = STEP) {
    out.x = clamp(raw.x, -1, 1);
    out.y = clamp(raw.y, -1, 1);
    out.a = raw.a;
    out.b = raw.b;
    out.c = raw.c;
    out.ap = raw.a && !this.pa;
    out.bp = raw.b && !this.pb;
    out.cp = raw.c && !this.pc;
    this.pa = raw.a;
    this.pb = raw.b;
    this.pc = raw.c;
    const nx = digit(out.x, this.sx),
      ny = digit(out.y, this.sy);
    const changed = nx !== this.sx || ny !== this.sy;
    out.dx = 0;
    out.dy = 0;
    if (changed) {
      out.dx = nx !== this.sx ? nx : 0;
      out.dy = ny !== this.sy ? ny : 0;
      this.rep = 0.38;
    } else if (nx || ny) {
      this.rep -= dt;
      if (this.rep <= 0) {
        this.rep = 0.12;
        out.dx = nx;
        out.dy = ny;
      }
    }
    this.sx = nx;
    this.sy = ny;
  }

  reset() {
    this.pa = this.pb = this.pc = false;
    this.sx = this.sy = 0;
  }
}

/** -1/0/1 from an analogue axis, with hysteresis around the previous value. */
function digit(v: number, prev: number) {
  const on = 0.55,
    off = 0.35;
  if (prev !== 0 && Math.sign(v) === prev && Math.abs(v) > off) return prev;
  return v > on ? 1 : v < -on ? -1 : 0;
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** mulberry32: small, fast, seedable (every game's randomness comes from one of these). */
export class Rng {
  private s: number;
  constructor(seed = 1) {
    this.s = seed >>> 0 || 1;
  }
  seed(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
  int(n: number) {
    return Math.floor(this.next() * n);
  }
  chance(p: number) {
    return this.next() < p;
  }
}

/** Sound effects every cabinet can make (synth.ts plays them). */
export type SfxName =
  | 'coin'
  | 'start'
  | 'shoot'
  | 'zap'
  | 'boom'
  | 'bigboom'
  | 'hit'
  | 'hurt'
  | 'pickup'
  | 'bounce'
  | 'brick'
  | 'flip'
  | 'power'
  | 'move'
  | 'rotate'
  | 'land'
  | 'clear'
  | 'chain'
  | 'rise'
  | 'kick'
  | 'snare'
  | 'hat'
  | 'perfect'
  | 'miss'
  | 'engine'
  | 'crash'
  | 'whoosh'
  | 'tick'
  | 'select'
  | 'over'
  | 'fanfare'
  | 'splash'
  | 'swish'
  | 'buzzer'
  | 'clunk';

/**
 * A chiptune: a tempo and up to four looping tracks of steps (16ths). Notes
 * are MIDI numbers (0 = rest, -1 = hold the previous note), drums are letters
 * (k kick, s snare, h hat, o open hat, . rest).
 */
export interface Song {
  bpm: number;
  /** Patterns played in order, then looped. */
  order: number[];
  patterns: {
    lead: number[];
    bass: number[];
    arp?: number[];
    drums: string;
  }[];
  leadWave: 'square' | 'pulse' | 'triangle' | 'sawtooth';
  bassWave: 'square' | 'pulse' | 'triangle' | 'sawtooth';
  /** Master level 0..1 for this song. */
  gain?: number;
}

/** What a cabinet's frame needs to know about a game for its title, attract and bezel art. */
export interface GameMeta {
  id: string;
  title: string;
  /** Second title line (smaller), if any. */
  sub?: string;
  tagline: string;
  /** Lines for the how-to-play page of the attract loop (short, upper case reads best). */
  howTo: string[];
  /** Labels for the three buttons (empty: unused). */
  buttons: [string, string, string];
  /** 2 for head-to-head games (two control sets on the cabinet). */
  players: 1 | 2;
  /** Cabinet colours: body, neon trim, art accent. */
  colors: { body: string; trim: string; accent: string; accent2: string; bg: string };
  song: Song;
}

/**
 * A cabinet game. `step` runs at 60 Hz with both players' inputs (p2 is the
 * CPU's or a friend's; one-player games ignore it). `draw` paints the whole
 * screen. `snap`/`load` carry what a watching friend needs to draw the same
 * picture (numbers only, small).
 */
export interface Game {
  readonly meta: GameMeta;
  /** Player one's score (the high-score table's). */
  score: number;
  over: boolean;
  /** Difficulty / tempo hint (the music speeds up a little with it). */
  level: number;
  start(players: 1 | 2, seed: number): void;
  step(p1: Input, p2: Input): void;
  draw(g: CanvasRenderingContext2D, t: number): void;
  /** The attract-mode title background (animated by t, nothing stepped). */
  attract(g: CanvasRenderingContext2D, t: number): void;
  /** Writes the picture's state into `out` (cleared first). */
  snap(out: number[]): void;
  load(a: readonly number[]): void;
  /** Sound effects come out here (set by the cabinet). */
  sfx: (name: SfxName, vol?: number, pitch?: number) => void;
  /** Two-player games: a friend took the second controls (true) or left (false). */
  setHuman2?(on: boolean): void;
  /** Watching a friend's game: move things on a little between their snapshots (visual only). */
  predict?(dt: number): void;
  /** Games whose chart follows the music (rhythm): the song to play now and the beat we're on. */
  musicSong?(): Song | null;
  musicBeat?(): number;
  /** Head-to-head games: no high-score entry when two people played. */
  versus?: boolean;
}

/** A no-op sound sink for tests and silent games. */
export const NO_SFX = () => {};
