import { NO_SFX, Rng, SCREEN_H, SCREEN_W, STEP, type Game, type GameMeta, type Input, type SfxName } from '../types';
import { num, shadowText, text } from '../font';
import { panel, sprite } from '../gfx';
import { notes } from '../music';

/**
 * PRISM DROP: a falling-gems colour match with its own rules.
 *
 * Gems fall in pairs; steer (stick), turn them (A clockwise, B back), drop
 * faster (stick down). Four or more touching gems of a colour shatter, and
 * whatever falls into the gaps can set off a chain (each link doubles).
 * Two twists:
 *  - Every so often the Pit pushes up a row of grey rock (one gap). Rock
 *    doesn't match: it cracks when gems shatter next to it, and a cracked
 *    rock breaks the next time.
 *  - Every twelfth pair carries a Lucky Chip. Where it lands, every gem of
 *    the colour it lands on goes at once (land it on rock to crack every rock).
 * The stack reaching the top ends the game.
 */

export const COLS = 6;
export const ROWS = 12;
export const EMPTY = 0;
export const ROCK = 6;
export const CRACKED = 7;
export const CHIP = 8;
const CELL = 16;
const BX = 112;
const BY = 34;
const CHAIN = [1, 2, 4, 7, 12, 20, 32, 50, 80];

/** Offsets of the second gem from the pivot, by turn (0 above, 1 right, 2 below, 3 left). */
const OX = [0, 1, 0, -1];
const OY = [-1, 0, 1, 0];

export const PRISM_META: GameMeta = {
  id: 'prism',
  title: 'PRISM',
  sub: 'DROP',
  tagline: 'MATCH 4 . CHAIN . SHATTER',
  howTo: ['STICK  STEER / DOWN DROPS', 'A  TURN   B  TURN BACK', '4 OR MORE GEMS SHATTER', 'LUCKY CHIP CLEARS A COLOUR', 'ROCK CRACKS NEXT TO CLEARS'],
  buttons: ['TURN', 'BACK', ''],
  players: 1,
  colors: { body: '#1c0f2e', trim: '#c86bff', accent: '#4de2c1', accent2: '#ffd34d', bg: '#120822' },
  song: {
    bpm: 118,
    order: [0, 1, 0, 2],
    leadWave: 'triangle',
    bassWave: 'pulse',
    gain: 0.75,
    patterns: [
      {
        lead: notes('E5 . G5 . B5 - A5 . G5 . E5 . D5 . E5 -'),
        bass: notes('C3 . . C3 G2 . . G2 A2 . . A2 E2 . G2 .'),
        arp: notes('C5 E5 G5 E5 B4 D5 G5 D5 A4 C5 E5 C5 G4 B4 E5 B4'),
        drums: 'k...s..hk.k.s..h',
      },
      {
        lead: notes('F5 . A5 . C6 - B5 . A5 . G5 . E5 - . .'),
        bass: notes('F2 . . F2 C3 . . C3 G2 . . G2 D3 . B2 .'),
        arp: notes('F4 A4 C5 A4 F4 A4 C5 A4 G4 B4 D5 B4 G4 B4 D5 B4'),
        drums: 'k...s..hk.k.s.hh',
      },
      {
        lead: notes('G5 . E5 . C5 . E5 . G5 . C6 - B5 . G5 .'),
        bass: notes('A2 . . A2 E3 . . E3 F2 . . F2 G2 . G2 .'),
        drums: 'k.h.s.h.k.h.s.hs',
      },
    ],
  },
};

/** All groups of 4+ same-colour gems (orthogonal), as lists of cell indexes. Rocks and chips never match. */
export function findGroups(board: ArrayLike<number>, cols = COLS, rows = ROWS, min = 4): number[][] {
  const seen = new Uint8Array(cols * rows);
  const out: number[][] = [];
  const stack: number[] = [];
  for (let i = 0; i < cols * rows; i++) {
    const c = board[i];
    if (seen[i] || c < 1 || c > 5) continue;
    const group: number[] = [];
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      group.push(j);
      const x = j % cols,
        y = (j / cols) | 0;
      const nb = [x > 0 ? j - 1 : -1, x < cols - 1 ? j + 1 : -1, y > 0 ? j - cols : -1, y < rows - 1 ? j + cols : -1];
      for (const k of nb) {
        if (k < 0 || seen[k] || board[k] !== c) continue;
        seen[k] = 1;
        stack.push(k);
      }
    }
    if (group.length >= min) out.push(group);
  }
  return out;
}

/** Drops everything into the gaps below it (rock falls too). Returns true if anything moved. */
export function settle(board: Int8Array | number[], cols = COLS, rows = ROWS): boolean {
  let moved = false;
  for (let x = 0; x < cols; x++) {
    let w = rows - 1;
    for (let y = rows - 1; y >= 0; y--) {
      const v = board[y * cols + x];
      if (v === EMPTY) continue;
      if (w !== y) {
        board[w * cols + x] = v;
        board[y * cols + x] = EMPTY;
        moved = true;
      }
      w--;
    }
  }
  return moved;
}

/** Pushes a row of rock (with one gap at `gap`) up from the bottom. Returns false if the stack overflowed the top. */
export function riseRock(board: Int8Array | number[], gap: number, cols = COLS, rows = ROWS): boolean {
  let ok = true;
  for (let x = 0; x < cols; x++) if (board[x] !== EMPTY) ok = false;
  for (let i = 0; i < cols * (rows - 1); i++) board[i] = board[i + cols];
  for (let x = 0; x < cols; x++) board[(rows - 1) * cols + x] = x === gap ? EMPTY : ROCK;
  // Anything floating over the gap falls into it.
  settle(board, cols, rows);
  return ok;
}

/** Cracks rock next to the cleared cells (rock → cracked → gone). */
export function crackAround(board: Int8Array | number[], cleared: readonly number[], cols = COLS, rows = ROWS): number {
  const hit = new Set<number>();
  for (const j of cleared) {
    const x = j % cols,
      y = (j / cols) | 0;
    if (x > 0) hit.add(j - 1);
    if (x < cols - 1) hit.add(j + 1);
    if (y > 0) hit.add(j - cols);
    if (y < rows - 1) hit.add(j + cols);
  }
  let n = 0;
  for (const k of hit) {
    if (board[k] === ROCK) {
      board[k] = CRACKED;
      n++;
    } else if (board[k] === CRACKED) {
      board[k] = EMPTY;
      n++;
    }
  }
  return n;
}

/** Points for one clear step: gems shattered at a chain link. */
export function clearPoints(gems: number, chain: number, level: number): number {
  const base = gems * 10 + Math.max(0, gems - 4) * 20;
  return base * CHAIN[Math.min(CHAIN.length - 1, chain)] * level;
}

type Phase = 'fall' | 'settle' | 'flash' | 'spawn';

export class Prism implements Game {
  readonly meta = PRISM_META;
  score = 0;
  over = false;
  level = 1;
  sfx: (name: SfxName, vol?: number, pitch?: number) => void = NO_SFX;
  readonly board = new Int8Array(COLS * ROWS);
  private rng = new Rng(1);
  phase: Phase = 'spawn';
  private phaseT = 0;
  // The falling pair.
  px = 2;
  py = 1;
  turn = 0;
  ca = 1;
  cb = 2;
  private na = 1;
  private nb = 2;
  private fallT = 0;
  private lockT = 0;
  private das = 0;
  private dasDir = 0;
  pieces = 0;
  rockIn = 14;
  private gems = 0;
  chain = 0;
  /** Cells flashing before they go. */
  private flashing = new Uint8Array(COLS * ROWS);
  private popup = 0;
  private popupT = 0;
  private time = 0;
  private shake = 0;
  private lastChain = 0;
  private lastChainT = 0;

  start(_players: 1 | 2, seed: number) {
    this.rng.seed(seed);
    this.board.fill(0);
    this.flashing.fill(0);
    this.score = 0;
    this.over = false;
    this.level = 1;
    this.pieces = 0;
    this.gems = 0;
    this.chain = 0;
    this.rockIn = 14;
    this.time = 0;
    this.na = this.color();
    this.nb = this.color();
    this.phase = 'spawn';
    this.phaseT = 0.4;
  }

  private colors() {
    return this.level >= 4 ? 5 : 4;
  }

  private color() {
    return 1 + this.rng.int(this.colors());
  }

  private cell(x: number, y: number) {
    if (x < 0 || x >= COLS || y >= ROWS) return ROCK;
    if (y < 0) return EMPTY;
    return this.board[y * COLS + x];
  }

  private fits(x: number, y: number, turn: number) {
    return this.cell(x, y) === EMPTY && this.cell(x + OX[turn], y + OY[turn]) === EMPTY;
  }

  private spawnPiece() {
    this.pieces++;
    this.ca = this.na;
    this.cb = this.nb;
    this.na = this.color();
    this.nb = this.pieces % 12 === 11 ? CHIP : this.color();
    this.px = 2;
    this.py = 1;
    this.turn = 0;
    this.fallT = 0;
    this.lockT = 0;
    if (!this.fits(2, 1, 0)) {
      this.over = true;
      this.sfx('over', 1);
      return;
    }
    this.phase = 'fall';
  }

  private get fallEvery() {
    return Math.max(0.07, 0.75 - 0.06 * (this.level - 1));
  }

  step(p: Input) {
    const dt = STEP;
    this.time += dt;
    this.popupT = Math.max(0, this.popupT - dt);
    this.lastChainT = Math.max(0, this.lastChainT - dt);
    this.shake = Math.max(0, this.shake - dt);
    if (this.over) return;
    switch (this.phase) {
      case 'spawn':
        this.phaseT -= dt;
        if (this.phaseT <= 0) this.spawnPiece();
        return;
      case 'fall':
        this.control(p, dt);
        return;
      case 'settle':
        this.phaseT -= dt;
        if (this.phaseT <= 0) this.resolve();
        return;
      case 'flash':
        this.phaseT -= dt;
        if (this.phaseT <= 0) {
          for (let i = 0; i < this.board.length; i++) if (this.flashing[i]) this.board[i] = EMPTY;
          this.flashing.fill(0);
          settle(this.board);
          this.phase = 'settle';
          this.phaseT = 0.12;
        }
        return;
    }
  }

  private control(p: Input, dt: number) {
    // Steering with a delayed auto-repeat.
    const dir = p.x > 0.5 ? 1 : p.x < -0.5 ? -1 : 0;
    let move = 0;
    if (dir !== this.dasDir) {
      this.dasDir = dir;
      this.das = 0.17;
      move = dir;
    } else if (dir) {
      this.das -= dt;
      if (this.das <= 0) {
        this.das = 0.055;
        move = dir;
      }
    }
    if (move && this.fits(this.px + move, this.py, this.turn)) {
      this.px += move;
      this.lockT = 0;
      this.sfx('move', 0.25);
    }
    if (p.ap || p.bp) this.rotate(p.ap ? 1 : -1);
    const soft = p.y < -0.5;
    this.fallT += dt * (soft ? 14 : 1);
    if (this.fallT >= this.fallEvery) {
      this.fallT = 0;
      if (this.fits(this.px, this.py + 1, this.turn)) {
        this.py++;
        if (soft) this.score += 1;
      }
    }
    if (!this.fits(this.px, this.py + 1, this.turn)) {
      this.lockT += dt * (soft ? 3 : 1);
      if (this.lockT >= 0.4) this.lock();
    } else this.lockT = 0;
  }

  private rotate(d: number) {
    const t = (this.turn + d + 4) % 4;
    // Straight in, or nudged off a wall / the stack, or lifted a row.
    const tries = [0, -OX[t], 0];
    const lifts = [0, 0, -1];
    for (let k = 0; k < 3; k++) {
      if (this.fits(this.px + tries[k], this.py + lifts[k], t)) {
        this.px += tries[k];
        this.py += lifts[k];
        this.turn = t;
        this.lockT = 0;
        this.sfx('rotate', 0.3);
        return;
      }
    }
    // Hemmed in on both sides: swap the colours instead (a half turn).
    if (this.turn % 2 === 0 && d) {
      const c = this.ca;
      this.ca = this.cb;
      this.cb = c;
      this.sfx('rotate', 0.3, 0.8);
    }
  }

  private lock() {
    const sx = this.px + OX[this.turn],
      sy = this.py + OY[this.turn];
    if (this.py >= 0) this.board[this.py * COLS + this.px] = this.ca;
    if (sy >= 0) this.board[sy * COLS + sx] = this.cb;
    this.sfx('land', 0.5);
    settle(this.board);
    this.chain = 0;
    this.rockIn--;
    // The Lucky Chip: it clears the colour (or cracks the rock) it came to rest on.
    for (let i = 0; i < this.board.length; i++) {
      if (this.board[i] !== CHIP) continue;
      this.board[i] = EMPTY;
      const below = i + COLS < this.board.length ? this.board[i + COLS] : EMPTY;
      let n = 0;
      if (below >= 1 && below <= 5) {
        for (let j = 0; j < this.board.length; j++) if (this.board[j] === below) (this.flashing[j] = 1), n++;
      } else if (below === ROCK || below === CRACKED) {
        for (let j = 0; j < this.board.length; j++) if (this.board[j] === ROCK || this.board[j] === CRACKED) (this.flashing[j] = 1), n++;
      }
      if (n) {
        const pts = n * 30 * this.level;
        this.score += pts;
        this.showPopup(pts);
        this.gems += n;
        this.sfx('fanfare', 0.8);
        this.phase = 'flash';
        this.phaseT = 0.45;
        this.shake = 0.3;
        return;
      }
    }
    this.phase = 'settle';
    this.phaseT = 0.08;
  }

  private showPopup(pts: number) {
    this.popup = pts;
    this.popupT = 1.2;
  }

  /** After things have fallen: clear what matches (a chain link), else rock rises and the next pair comes. */
  private resolve() {
    const groups = findGroups(this.board);
    if (groups.length) {
      let n = 0;
      const all: number[] = [];
      for (const gr of groups)
        for (const j of gr) {
          this.flashing[j] = 1;
          all.push(j);
          n++;
        }
      crackAround(this.board, all);
      // Cracked rock that just broke shows as a flash too.
      const pts = clearPoints(n, this.chain, this.level);
      this.score += pts;
      this.gems += n;
      this.showPopup(pts);
      if (this.chain > 0) {
        this.lastChain = this.chain + 1;
        this.lastChainT = 1.4;
      }
      this.sfx(this.chain > 0 ? 'chain' : 'clear', 0.8, 1 + this.chain * 0.12);
      this.chain++;
      this.shake = Math.min(0.5, 0.1 + this.chain * 0.08);
      const lv = 1 + Math.floor(this.gems / 40);
      if (lv > this.level) {
        this.level = lv;
        this.sfx('power', 0.7);
      }
      this.phase = 'flash';
      this.phaseT = 0.4;
      return;
    }
    if (this.rockIn <= 0) {
      this.rockIn = Math.max(6, 15 - this.level);
      const ok = riseRock(this.board, this.rng.int(COLS));
      this.sfx('rise', 0.7);
      this.shake = 0.25;
      if (!ok) {
        this.over = true;
        this.sfx('over', 1);
        return;
      }
    }
    this.phase = 'spawn';
    this.phaseT = 0.1;
  }

  // ---------------------------------------------------------------------------
  private sprites: HTMLCanvasElement[] | null = null;
  private gemSprites() {
    if (this.sprites) return this.sprites;
    const fills = ['', '#ff3b5c', '#2fe08a', '#3d8bff', '#ffcf3a', '#b46bff'];
    const lights = ['', '#ffb3c0', '#b8ffd9', '#bcd6ff', '#fff2b0', '#e6c9ff'];
    const darks = ['', '#8a0c26', '#0b7040', '#0f3a91', '#a06d00', '#5a1d9e'];
    const out: HTMLCanvasElement[] = [];
    for (let c = 0; c <= 8; c++) {
      out.push(
        sprite(CELL, CELL, (g) => {
          const m = 8;
          if (c >= 1 && c <= 5) {
            g.fillStyle = darks[c];
            g.beginPath();
            // A different cut per colour (readable without colour too).
            if (c === 1) g.arc(m, m, 7, 0, Math.PI * 2);
            else if (c === 2) g.rect(1, 1, 14, 14);
            else if (c === 3) (g.moveTo(m, 0), g.lineTo(15, m), g.lineTo(m, 15), g.lineTo(1, m));
            else if (c === 4) (g.moveTo(m, 1), g.lineTo(15, 14), g.lineTo(1, 14));
            else for (let k = 0; k < 6; k++) g.lineTo(m + Math.cos((k / 6) * Math.PI * 2) * 7, m + Math.sin((k / 6) * Math.PI * 2) * 7);
            g.closePath();
            g.fill();
            g.save();
            g.clip();
            g.fillStyle = fills[c];
            g.fillRect(2, 2, 12, 12);
            g.fillStyle = lights[c];
            g.beginPath();
            g.moveTo(2, 2);
            g.lineTo(10, 2);
            g.lineTo(2, 10);
            g.fill();
            g.fillStyle = darks[c];
            g.globalAlpha = 0.5;
            g.beginPath();
            g.moveTo(15, 6);
            g.lineTo(15, 15);
            g.lineTo(6, 15);
            g.fill();
            g.restore();
            g.fillStyle = '#ffffff';
            g.fillRect(4, 4, 2, 2);
          } else if (c === ROCK || c === CRACKED) {
            g.fillStyle = '#3c3646';
            g.fillRect(0, 0, 16, 16);
            g.fillStyle = '#5a5268';
            g.fillRect(1, 1, 14, 6);
            g.fillStyle = '#2a2532';
            g.fillRect(0, 14, 16, 2);
            g.fillRect(9, 7, 7, 1);
            if (c === CRACKED) {
              g.strokeStyle = '#d9d0ff';
              g.lineWidth = 1;
              g.beginPath();
              g.moveTo(3, 1);
              g.lineTo(7, 7);
              g.lineTo(5, 11);
              g.lineTo(9, 15);
              g.moveTo(7, 7);
              g.lineTo(13, 5);
              g.stroke();
            }
          } else if (c === CHIP) {
            g.fillStyle = '#7a5200';
            g.beginPath();
            g.arc(m, m, 7.5, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = '#ffd34d';
            g.beginPath();
            g.arc(m, m, 6.5, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = '#ffffff';
            for (let k = 0; k < 6; k++) {
              const a = (k / 6) * Math.PI * 2;
              g.fillRect(m + Math.cos(a) * 5.5 - 1, m + Math.sin(a) * 5.5 - 1, 2, 2);
            }
            g.fillStyle = '#7a5200';
            g.fillRect(7, 4, 2, 8);
            g.fillRect(5, 5, 6, 2);
            g.fillRect(5, 9, 6, 2);
          }
        }),
      );
    }
    return (this.sprites = out);
  }

  private background(g: CanvasRenderingContext2D, t: number) {
    g.fillStyle = '#120822';
    g.fillRect(0, 0, SCREEN_W, SCREEN_H);
    // Slow light shafts through a prism.
    g.globalAlpha = 0.09;
    const cols = ['#ff3b5c', '#ffcf3a', '#2fe08a', '#3d8bff', '#b46bff'];
    for (let k = 0; k < 5; k++) {
      g.fillStyle = cols[k];
      const x = ((k * 70 + t * 14) % 420) - 60;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + 26, 0);
      g.lineTo(x - 54, SCREEN_H);
      g.lineTo(x - 80, SCREEN_H);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  draw(g: CanvasRenderingContext2D, t: number) {
    const spr = this.gemSprites();
    this.background(g, t);
    const sh = this.shake > 0 ? Math.round(Math.sin(t * 80) * this.shake * 3) : 0;
    // The pit.
    panel(g, BX - 3 + sh, BY - 3, COLS * CELL + 6, ROWS * CELL + 6, '#07030f', '#c86bff');
    // Danger column marker.
    g.fillStyle = '#ff3b5c';
    g.globalAlpha = 0.18;
    g.fillRect(BX + 2 * CELL + sh, BY, CELL, CELL * 2);
    g.globalAlpha = 1;
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const v = this.board[y * COLS + x];
        if (v === EMPTY) continue;
        const fl = this.flashing[y * COLS + x];
        if (fl && Math.floor(t * 20) % 2 === 0) {
          g.fillStyle = '#ffffff';
          g.fillRect(BX + x * CELL + sh, BY + y * CELL, CELL, CELL);
        } else g.drawImage(spr[v], BX + x * CELL + sh, BY + y * CELL);
      }
    if (this.phase === 'fall' && !this.over) {
      // Ghost of where it lands.
      let gy = this.py;
      while (this.fits(this.px, gy + 1, this.turn)) gy++;
      g.globalAlpha = 0.25;
      this.drawPair(g, spr, this.px, gy, this.turn, this.ca, this.cb, sh, 0);
      g.globalAlpha = 1;
      const fall = Math.min(1, this.fallT / this.fallEvery);
      const off = this.fits(this.px, this.py + 1, this.turn) ? fall * 4 : 0;
      this.drawPair(g, spr, this.px, this.py, this.turn, this.ca, this.cb, sh, off);
    }
    // Left: score and level.
    text(g, 'SCORE', 12, 40, '#c86bff');
    num(g, this.score, 96, 52, '#ffffff', 1, 'right');
    text(g, 'LEVEL', 12, 72, '#c86bff');
    num(g, this.level, 12, 84, '#ffffff', 2);
    text(g, 'GEMS', 12, 108, '#c86bff');
    num(g, this.gems, 12, 120, '#ffffff');
    // Right: next pair and the rock clock.
    text(g, 'NEXT', 232, 40, '#4de2c1');
    panel(g, 232, 52, 28, 40, '#07030f', '#4de2c1');
    g.drawImage(spr[this.nb], 238, 56);
    g.drawImage(spr[this.na], 238, 72);
    text(g, 'ROCK IN', 232, 108, '#ffd34d');
    num(g, Math.max(0, this.rockIn), 232, 120, this.rockIn <= 2 ? '#ff3b5c' : '#ffffff', 2);
    for (let k = 0; k < Math.min(14, this.rockIn); k++) {
      g.fillStyle = k < 3 ? '#ff3b5c' : '#5a5268';
      g.fillRect(232 + (k % 7) * 9, 140 + Math.floor(k / 7) * 9, 7, 7);
    }
    if (this.popupT > 0) {
      const y = BY + 70 - (1.2 - this.popupT) * 20;
      text(g, '+', 160 - 30, y, '#ffd34d', 2);
      num(g, this.popup, 160 - 18, y, '#ffd34d', 2);
    }
    if (this.lastChainT > 0) {
      shadowText(g, 'CHAIN', 160, BY + 100, '#4de2c1', 2, 'center');
      text(g, 'X', 148, BY + 120, '#ffffff', 2);
      num(g, this.lastChain, 160, BY + 120, '#ffffff', 2);
    }
  }

  private drawPair(g: CanvasRenderingContext2D, spr: HTMLCanvasElement[], x: number, y: number, turn: number, a: number, b: number, sh: number, off: number) {
    const sx = x + OX[turn],
      sy = y + OY[turn];
    if (y >= 0) g.drawImage(spr[a], BX + x * CELL + sh, BY + y * CELL + off);
    if (sy >= 0) g.drawImage(spr[b], BX + sx * CELL + sh, BY + sy * CELL + off);
  }

  attract(g: CanvasRenderingContext2D, t: number) {
    const spr = this.gemSprites();
    this.background(g, t);
    // Gems tumbling down the screen.
    for (let k = 0; k < 22; k++) {
      const x = (k * 53) % 300;
      const y = ((t * (30 + (k % 5) * 9) + k * 37) % 280) - 20;
      g.drawImage(spr[1 + (k % 5)], x + 4, y | 0);
    }
  }

  snap(o: number[]) {
    o.length = 0;
    o.push(this.score, this.level, this.gems, this.rockIn, this.phase === 'fall' ? 1 : 0, this.px, this.py, this.turn, this.ca, this.cb, this.na, this.nb, this.over ? 1 : 0, this.lastChainT > 0 ? this.lastChain : 0);
    for (let i = 0; i < this.board.length; i++) o.push(this.flashing[i] ? 9 : this.board[i]);
  }

  load(a: readonly number[]) {
    let k = 0;
    const r = () => Number(a[k++]) || 0;
    this.score = r();
    this.level = r();
    this.gems = r();
    this.rockIn = r();
    this.phase = r() ? 'fall' : 'settle';
    this.px = r();
    this.py = r();
    this.turn = r() & 3;
    this.ca = r();
    this.cb = r();
    this.na = r();
    this.nb = r();
    this.over = r() === 1;
    const ch = r();
    if (ch) {
      this.lastChain = ch;
      this.lastChainT = 0.5;
    }
    for (let i = 0; i < this.board.length; i++) {
      const v = r();
      this.flashing[i] = v === 9 ? 1 : 0;
      this.board[i] = v === 9 ? 1 : Math.max(0, Math.min(8, v));
    }
    this.fallT = 0;
  }
}
