import { blankInput, blankPad, EdgeTracker, SCREEN_H, SCREEN_W, STEP, type Game, type Input, type RawPad, type SfxName, type Song } from './types';
import { InitialsEntry, qualifies, type ScoreEntry } from './scores';
import { num, shadowText, text } from './font';
import { crt } from './gfx';

/**
 * A cabinet's brain: the game plus everything around it. Attract mode loops
 * a title page, how-to-play and the high scores until someone puts a credit
 * in (any button); then the game runs at a fixed 60 Hz; game over leads to
 * initials entry with the joystick if the score made the table, then the
 * table. A cabinet can also mirror a friend's game (their snapshots).
 *
 * No DOM except the canvas it draws on, and that only in `render`.
 */

export type Mode = 'attract' | 'play' | 'over' | 'initials' | 'scores' | 'mirror';
export const MODES: Mode[] = ['attract', 'play', 'over', 'initials', 'scores', 'mirror'];

export interface MachineHooks {
  /** Take a credit's money: true if paid. */
  coin(): boolean;
  /** The table for this game (the room's, or this device's). */
  table(): ScoreEntry[];
  /** A finished score with initials (for the table). */
  submit(initials: string, score: number): void;
  sfx(name: SfxName, vol?: number, pitch?: number): void;
  /** Initials to start from (last used). */
  lastInitials?(): string;
  /** Your name, for the "now playing" line friends see. */
  seed?(): number;
}

const PAGE = 5.5;

/** A machine's whole running state (for handing a game over to another player): see saveState. */
export interface MachineState {
  mode: Mode;
  modeT: number;
  beat: number;
  lastScore: number;
  placed: number;
  human2: boolean;
  /** Initials being entered: the letters so far and where the cursor is. */
  entry: { text: string; pos: number } | null;
  game: unknown;
}

// --- Generic deep state (any game: numbers, strings, typed arrays, arrays, objects, Maps, Sets) ---------

/** Keys never carried: the game's fixed description and its sound hook. */
const SKIP = new Set(['meta', 'sfx']);

/**
 * A game object's whole state as plain JSON-safe data: every own field, deep
 * (typed arrays as number lists, non-finite numbers as markers), functions
 * left out. Works for any game class without it doing anything (a new
 * cabinet's game is covered as long as its state lives in its fields).
 */
export function deepState(v: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof v === 'number') return Number.isFinite(v) ? v : { $n: String(v) };
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v !== 'object' || depth > 10) return undefined;
  if (seen.has(v)) return undefined;
  seen.add(v);
  if (ArrayBuffer.isView(v)) return { $t: Array.from(v as unknown as ArrayLike<number>, (x) => (Number.isFinite(x) ? x : 0)) };
  if (Array.isArray(v)) return v.map((x) => deepState(x, depth + 1, seen) ?? null);
  if (v instanceof Map) return { $m: [...v].map(([k, x]) => [deepState(k, depth + 1, seen), deepState(x, depth + 1, seen)]) };
  if (v instanceof Set) return { $s: [...v].map((x) => deepState(x, depth + 1, seen)) };
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) {
    if (depth === 0 && SKIP.has(k)) continue;
    const x = (v as Record<string, unknown>)[k];
    if (typeof x === 'function') continue;
    const d = deepState(x, depth + 1, seen);
    if (d !== undefined) out[k] = d;
  }
  return out;
}

/** Plain data back to values (no target to merge into). */
function revive(d: unknown): unknown {
  if (d === null || typeof d !== 'object') return d;
  if (Array.isArray(d)) return d.map(revive);
  const o = d as Record<string, unknown>;
  if ('$n' in o) return Number(o.$n);
  if ('$t' in o) return Float64Array.from(o.$t as number[]);
  if ('$m' in o) return new Map((o.$m as unknown[][]).map(([k, x]) => [revive(k), revive(x)]));
  if ('$s' in o) return new Set((o.$s as unknown[]).map(revive));
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) out[k] = revive(o[k]);
  return out;
}

/**
 * Pours deepState's data back into a live object: fields of class instances
 * (and typed arrays) are filled in place, so methods and array types stay.
 */
export function loadDeepState(target: object, data: unknown, depth = 0) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || depth > 10) return;
  const t = target as Record<string, unknown>;
  for (const k of Object.keys(data as Record<string, unknown>)) {
    if (depth === 0 && SKIP.has(k)) continue;
    const dv = (data as Record<string, unknown>)[k];
    const tv = t[k];
    if (typeof tv === 'function') continue;
    if (ArrayBuffer.isView(tv) && dv && typeof dv === 'object' && '$t' in dv) {
      const arr = (dv as { $t: number[] }).$t;
      const ta = tv as unknown as { length: number; set(a: ArrayLike<number>): void; fill(v: number): void; constructor: new (n: number) => unknown };
      if (ta.length === arr.length) ta.set(arr);
      else {
        const fresh = new ta.constructor(arr.length) as { set(a: ArrayLike<number>): void };
        fresh.set(arr);
        t[k] = fresh;
      }
    } else if (Array.isArray(dv)) {
      if (Array.isArray(tv)) {
        for (let i = 0; i < dv.length; i++) {
          const e = tv[i];
          if (e && typeof e === 'object' && !Array.isArray(e) && !ArrayBuffer.isView(e) && dv[i] && typeof dv[i] === 'object' && !Array.isArray(dv[i])) loadDeepState(e, dv[i], depth + 1);
          else tv[i] = revive(dv[i]);
        }
        tv.length = dv.length;
      } else t[k] = revive(dv);
    } else if (dv && typeof dv === 'object' && !('$n' in dv) && !('$t' in dv) && !('$m' in dv) && !('$s' in dv) && tv && typeof tv === 'object' && !(tv instanceof Map) && !(tv instanceof Set)) {
      loadDeepState(tv, dv, depth + 1);
    } else t[k] = revive(dv);
  }
}

export class Machine {
  mode: Mode = 'attract';
  /** Raw controls from whoever is at each set (hands, keys, a friend's messages). */
  readonly pad1: RawPad = blankPad();
  readonly pad2: RawPad = blankPad();
  private in1: Input = blankInput();
  private in2: Input = blankInput();
  private idle: Input = blankInput();
  private e1 = new EdgeTracker();
  private e2 = new EdgeTracker();
  private acc = 0;
  /** Seconds in the current mode, and attract-loop time. */
  modeT = 0;
  attractT = 0;
  private entry: InitialsEntry | null = null;
  /** Where the last score landed on the table (highlighted), or -1. */
  private placed = -1;
  private lastScore = 0;
  /** Music: the beat we're on and the song. */
  beat = 0;
  /** A friend's game we're showing: their name and when it goes stale. */
  mirrorName = '';
  private mirrorT = 0;
  private mirrorMode: Mode = 'play';
  /** The friend's initials as they enter them (mirrored). */
  private mirrorInitials = '';
  /** A friend took the second controls (two-player games). */
  human2 = false;
  /** "Insert coin" refused flash. */
  private brokeT = 0;
  /** Running the game for someone else (P2 is a friend whose inputs arrive by message). */
  dirty = true;

  constructor(
    readonly game: Game,
    private hooks: MachineHooks,
  ) {
    game.sfx = (n, v, p) => hooks.sfx(n, v, p);
  }

  get playing() {
    return this.mode === 'play';
  }

  /** Someone at the cabinet doing something (playing, entering initials, looking at their score). */
  get busy() {
    return this.mode === 'play' || this.mode === 'over' || this.mode === 'initials' || (this.mode === 'scores' && this.placed >= 0);
  }

  private setMode(m: Mode) {
    this.mode = m;
    this.modeT = 0;
    this.dirty = true;
  }

  /** Try to start a game: takes a credit (false if you can't pay). */
  insertCoin(): boolean {
    if (this.mode === 'play' || this.mode === 'mirror' || this.mode === 'initials' || this.mode === 'over') return false;
    if (!this.hooks.coin()) {
      this.brokeT = 2;
      this.hooks.sfx('buzzer', 0.6);
      return false;
    }
    this.hooks.sfx('coin', 0.8);
    this.game.start(1, this.hooks.seed?.() ?? Math.floor(Math.random() * 1e9));
    this.game.setHuman2?.(this.human2);
    this.e1.reset();
    this.e2.reset();
    this.acc = 0;
    this.beat = 0;
    this.placed = -1;
    this.setMode('play');
    return true;
  }

  /** A friend joined (or left) the second controls. */
  setHuman2(on: boolean) {
    this.human2 = on;
    if (this.mode === 'play') this.game.setHuman2?.(on);
  }

  /** Leave mid-game (walked away): game over without a score entry. */
  abandon() {
    if (this.mode === 'play' || this.mode === 'initials' || this.mode === 'over') {
      if (this.mode === 'initials' && this.entry) this.finishInitials(this.entry.text);
      else this.setMode('attract');
      this.attractT = 0;
    }
  }

  /**
   * Everything about the running game (mode, timers, initials, and the game's
   * own fields, deep): another player's machine can load it and carry on
   * exactly where this one is, as its new owner.
   */
  saveState(): MachineState {
    return {
      mode: this.mode === 'mirror' ? 'attract' : this.mode,
      modeT: this.modeT,
      beat: this.beat,
      lastScore: this.lastScore,
      placed: this.placed,
      human2: this.human2,
      entry: this.entry ? { text: this.entry.text, pos: this.entry.pos } : null,
      game: deepState(this.game),
    };
  }

  /** Carries on from another machine's saveState (taking the game over). False if it doesn't look like one. */
  loadState(st: unknown): boolean {
    const s = st as Partial<MachineState> | null;
    if (!s || typeof s !== 'object' || !MODES.includes(s.mode as Mode) || s.mode === 'mirror') return false;
    loadDeepState(this.game, s.game);
    this.mode = s.mode as Mode;
    this.modeT = Number(s.modeT) || 0;
    this.beat = Number(s.beat) || 0;
    this.lastScore = Number(s.lastScore) || 0;
    this.placed = Number.isInteger(s.placed) ? (s.placed as number) : -1;
    this.human2 = !!s.human2;
    this.entry = null;
    if (s.entry && typeof s.entry.text === 'string') {
      this.entry = new InitialsEntry(s.entry.text);
      this.entry.pos = Math.max(0, Math.min(2, Number(s.entry.pos) || 0));
    }
    if (this.mode === 'initials' && !this.entry) this.entry = new InitialsEntry(this.hooks.lastInitials?.() ?? 'AAA');
    // Fresh edges: a button someone was already holding isn't a new press here.
    this.e1.reset();
    this.e2.reset();
    this.acc = 0;
    this.dirty = true;
    return true;
  }

  /** I handed my running game to a friend: from now on this screen shows theirs. */
  handOff(name: string) {
    const was = this.mode;
    this.mode = 'mirror';
    this.modeT = 0;
    this.mirrorName = name;
    this.mirrorMode = was === 'mirror' ? 'play' : was;
    this.mirrorT = 2.5;
    this.dirty = true;
  }

  /** Shows a friend's game (their snapshot), until they stop sending. */
  mirror(name: string, mode: Mode, snap: readonly number[] | null, initials = '') {
    if (this.mode !== 'mirror' && this.mode !== 'attract' && this.mode !== 'scores') return;
    if (this.mode !== 'mirror') {
      this.setMode('mirror');
      this.beat = 0;
    }
    this.mirrorName = name;
    this.mirrorMode = mode;
    this.mirrorInitials = initials;
    this.mirrorT = 2.5;
    if (snap && snap.length) this.game.load(snap);
    this.dirty = true;
  }

  /** What friends should see: mode, and the game's picture if it's on. */
  snapshot(out: number[]): Mode {
    if (this.mode === 'play' || this.mode === 'over') this.game.snap(out);
    else out.length = 0;
    return this.mode;
  }

  get initialsText() {
    return this.entry?.text ?? '';
  }

  /** The song and beat to play now (null: quiet). */
  music(): { song: Song; beat: number } | null {
    if (this.mode === 'play' || (this.mode === 'mirror' && this.mirrorMode === 'play')) {
      const song = this.game.musicSong ? this.game.musicSong() : this.game.meta.song;
      if (!song) return null;
      return { song, beat: this.game.musicBeat ? this.game.musicBeat() : this.beat };
    }
    return null;
  }

  /** Advance by a frame. Returns true if the picture changed. */
  update(dt: number): boolean {
    this.modeT += dt;
    this.brokeT = Math.max(0, this.brokeT - dt);
    switch (this.mode) {
      case 'attract':
        this.attractT += dt;
        this.edges(dt);
        if (this.in1.ap || this.in1.bp || this.in1.cp) this.insertCoin();
        return true;
      case 'mirror': {
        this.mirrorT -= dt;
        if (this.mirrorMode === 'play') {
          this.game.predict?.(dt);
          this.beat += (dt * this.tempo()) / 60;
        }
        if (this.mirrorT <= 0) {
          this.setMode('attract');
          this.attractT = 0;
        }
        return true;
      }
      case 'play': {
        this.acc = Math.min(this.acc + dt, STEP * 4);
        let stepped = false;
        while (this.acc >= STEP) {
          this.acc -= STEP;
          this.e1.apply(this.pad1, this.in1);
          this.e2.apply(this.pad2, this.in2);
          this.game.step(this.in1, this.in2);
          stepped = true;
          if (this.game.over) break;
        }
        this.beat += (dt * this.tempo()) / 60;
        if (this.game.over) {
          this.lastScore = this.game.score;
          this.setMode('over');
        }
        return stepped;
      }
      case 'over':
        // The game keeps animating its last moments (sparks) under the banner.
        this.e1.apply(this.pad1, this.in1);
        this.game.step(this.idle, this.idle);
        if (this.modeT > 2.6) {
          const table = this.hooks.table();
          if (!this.game.versus && qualifies(table, this.lastScore)) {
            this.entry = new InitialsEntry(this.hooks.lastInitials?.() ?? 'AAA');
            this.setMode('initials');
            this.hooks.sfx('fanfare', 0.9);
          } else {
            this.placed = -1;
            this.setMode('scores');
          }
        }
        return true;
      case 'initials': {
        this.edges(dt);
        const e = this.entry!;
        const before = e.text + e.pos;
        e.input(this.in1.dx, this.in1.dy, this.in1.ap || this.in1.cp, this.in1.bp);
        if (e.text + e.pos !== before) this.hooks.sfx('select', 0.5, 1 + e.pos * 0.1);
        if (e.done || this.modeT > 40) this.finishInitials(e.text);
        return true;
      }
      case 'scores':
        this.edges(dt);
        if (this.modeT > 6 || (this.modeT > 1 && (this.in1.ap || this.in1.bp))) {
          this.placed = -1;
          this.setMode('attract');
          this.attractT = PAGE * 2;
        }
        return true;
    }
  }

  private finishInitials(n: string) {
    this.hooks.submit(n, this.lastScore);
    // After submitting, the entry is in the table: find it.
    const t = this.hooks.table();
    this.placed = t.findIndex((e) => e.s === Math.floor(this.lastScore) && e.n === n);
    this.entry = null;
    this.setMode('scores');
  }

  private edges(dt: number) {
    this.e1.apply(this.pad1, this.in1, dt);
  }

  private tempo() {
    const s = this.game.meta.song;
    return s.bpm * (1 + Math.min(0.2, (this.game.level - 1) * 0.025));
  }

  // --- Drawing -------------------------------------------------------------

  render(g: CanvasRenderingContext2D, t: number) {
    g.imageSmoothingEnabled = false;
    switch (this.mode) {
      case 'attract':
        this.drawAttract(g, t);
        break;
      case 'play':
        this.game.draw(g, t);
        break;
      case 'over':
        this.game.draw(g, t);
        this.dim(g, 0.45);
        shadowText(g, 'GAME OVER', 160, 96, '#ffffff', 3, 'center');
        text(g, 'SCORE', 160, 132, this.game.meta.colors.trim, 1, 'center');
        num(g, this.lastScore, 160, 144, '#ffffff', 2, 'center');
        break;
      case 'initials':
        this.drawInitials(g, t, this.entry?.text ?? 'AAA', this.entry?.pos ?? 0, this.lastScore);
        break;
      case 'scores':
        this.drawScores(g, t, this.placed);
        break;
      case 'mirror':
        if (this.mirrorMode === 'play' || this.mirrorMode === 'over') {
          this.game.draw(g, t);
          if (this.mirrorMode === 'over') {
            this.dim(g, 0.45);
            shadowText(g, 'GAME OVER', 160, 100, '#ffffff', 3, 'center');
          }
        } else if (this.mirrorMode === 'initials') this.drawInitials(g, t, this.mirrorInitials || '...', 3, this.game.score);
        else this.drawScores(g, t, -1);
        // Whose game this is.
        g.fillStyle = '#000000';
        g.globalAlpha = 0.6;
        g.fillRect(0, SCREEN_H - 10, SCREEN_W, 10);
        g.globalAlpha = 1;
        text(g, this.mirrorName.toUpperCase().slice(0, 20) + ' IS PLAYING', 160, SCREEN_H - 9, '#ffffff', 1, 'center');
        break;
    }
    crt(g);
    this.dirty = false;
  }

  private dim(g: CanvasRenderingContext2D, a: number) {
    g.fillStyle = '#000000';
    g.globalAlpha = a;
    g.fillRect(0, 0, SCREEN_W, SCREEN_H);
    g.globalAlpha = 1;
  }

  private drawAttract(g: CanvasRenderingContext2D, t: number) {
    const m = this.game.meta;
    const page = Math.floor(this.attractT / PAGE) % 3;
    this.game.attract(g, t);
    if (page === 0) {
      this.dim(g, 0.25);
      const bob = Math.round(Math.sin(t * 2) * 2);
      shadowText(g, m.title, 160, 46 + bob, m.colors.trim, m.title.length > 7 ? 4 : 5, 'center', '#000000');
      if (m.sub) shadowText(g, m.sub, 160, 90 + bob, m.colors.accent, m.sub.length > 8 ? 3 : 4, 'center', '#000000');
      shadowText(g, m.tagline, 160, 134, '#ffffff', 1, 'center');
    } else if (page === 1) {
      this.dim(g, 0.6);
      shadowText(g, 'HOW TO PLAY', 160, 34, m.colors.accent, 2, 'center');
      for (let i = 0; i < m.howTo.length; i++) shadowText(g, m.howTo[i], 160, 70 + i * 16, '#ffffff', 1, 'center');
    } else {
      this.dim(g, 0.65);
      this.scoreList(g, -1, 30);
    }
    // Coin line.
    if (this.brokeT > 0) {
      g.fillStyle = '#000000';
      g.fillRect(40, 186, 240, 26);
      shadowText(g, 'NOT ENOUGH CHIPS', 160, 190, '#ff3864', 2, 'center');
    } else if (Math.floor(t * 2) % 2 === 0) {
      shadowText(g, m.players === 2 ? 'PRESS A . 1 OR 2 PLAYERS' : 'PRESS A TO PLAY', 160, 192, '#fff27a', 1, 'center');
    }
    shadowText(g, '$1 PER PLAY', 160, 210, '#ffffff', 1, 'center');
    text(g, 'PALAZZO LAGO ARCADE', 160, 228, '#8a80a0', 1, 'center');
  }

  private scoreList(g: CanvasRenderingContext2D, highlight: number, y0: number) {
    const m = this.game.meta;
    const table = this.hooks.table();
    shadowText(g, 'HIGH SCORES', 160, y0, m.colors.accent, 2, 'center');
    for (let i = 0; i < table.length; i++) {
      const e = table[i];
      const y = y0 + 26 + i * 13;
      const hot = i === highlight;
      const c = hot ? (Math.floor(performance.now() / 150) % 2 ? '#fff27a' : '#ffffff') : i === 0 ? m.colors.trim : '#ffffff';
      num(g, i + 1, 92, y, c, 1, 'right');
      text(g, '.', 94, y, c);
      text(g, e.n, 110, y, c);
      num(g, e.s, 232, y, c, 1, 'right');
    }
  }

  private drawScores(g: CanvasRenderingContext2D, t: number, highlight: number) {
    this.game.attract(g, t);
    this.dim(g, 0.7);
    this.scoreList(g, highlight, 22);
    if (highlight < 0 && this.lastScore > 0 && this.mode === 'scores') {
      text(g, 'YOUR SCORE', 150, 170 + 22, '#ffffff', 1, 'right');
      num(g, this.lastScore, 160, 192, '#fff27a');
    }
  }

  private drawInitials(g: CanvasRenderingContext2D, t: number, letters: string, pos: number, score: number) {
    const m = this.game.meta;
    this.game.attract(g, t);
    this.dim(g, 0.72);
    shadowText(g, 'NEW HIGH SCORE!', 160, 30, m.colors.trim, 2, 'center');
    num(g, score, 160, 56, '#ffffff', 2, 'center');
    text(g, 'ENTER YOUR INITIALS', 160, 84, '#ffffff', 1, 'center');
    for (let i = 0; i < 3; i++) {
      const x = 160 - 54 + i * 36;
      const on = i === pos;
      g.fillStyle = on ? m.colors.accent : '#333344';
      g.fillRect(x, 136, 30, 3);
      if (!on || Math.floor(t * 4) % 2 === 0) shadowText(g, letters[i] ?? ' ', x + 15, 104, on ? '#fff27a' : '#ffffff', 4, 'center');
    }
    text(g, 'STICK UP/DOWN  CHANGE LETTER', 160, 158, '#a0a0c0', 1, 'center');
    text(g, 'A  NEXT     B  BACK', 160, 172, '#a0a0c0', 1, 'center');
  }
}
