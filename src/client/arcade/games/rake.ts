import { NO_SFX, Rng, SCREEN_H, SCREEN_W, STEP, type Game, type GameMeta, type Input, type SfxName } from '../types';
import { num, shadowText, text } from '../font';
import { Sparks, sprite } from '../gfx';
import { notes } from '../music';

/**
 * RAKE & BREAK: a paddle-and-ball brick game on a card table. You hold the
 * croupier's rake; the ball is a roulette ball. Bricks are chips (one hit;
 * the black $100 chip takes two) and playing cards, which flip face up on the
 * first hit and break on the second. Gold bars don't break. Face cards drop
 * favours to catch: King widens the rake, Queen splits the ball in three,
 * Jack makes it sticky (A lets go), an Ace is an extra ball.
 */

export const BCOLS = 12;
export const BROWS = 9;
const BW = 24;
const BH = 10;
const FX = 16;
const FY = 26;
const PADDLE_Y = 222;
const MAX_BALLS = 6;
const MAX_DROPS = 6;
const BALL_R = 3;

/** Brick kinds. */
export const enum K {
  None,
  White,
  Red,
  Green,
  Black,
  Card,
  Gold,
}
const CHIP_POINTS = [0, 10, 25, 50, 100, 200, 0];

/** The tables (all original layouts). Letters: 1-4 chips, c card, K Q J A face cards, G gold bar. */
export const LEVELS: string[][] = [
  ['............', '.1111111111.', '.2222222222.', '.3333333333.', '.c.c.cc.c.c.', '.1111111111.'],
  ['.....44.....', '....4444....', '...444444...', '..44444444..', '..444cc444..', '...4.cc.4...', '.....cc.....', '....cKQc....'],
  ['.....22.....', '....2222....', '...22QK22...', '..22222222..', '.G.222222.G.', '....2222....', '.....22.....'],
  ['GGc......cGG', '.c.c....c.c.', '..c......c..', '.c.c....c.c.', '............', '1111JQKA1111', '333333333333'],
  ['GG.c7c..c7c.', '....c....c..', '.3cc3cc3cc3.', '.4.4.4.4.4.4', 'G..........G', '.2222AA2222.', '.1111111111.'],
  ['c.c.c.c.c.c.', '.4.4.4.4.4.4', 'c.c.c.c.c.c.', '.3.3.3.3.3.3', 'GGG..KQ..GGG', '222222222222', '111111111111', '..JJ....JJ..'],
];

export const RAKE_META: GameMeta = {
  id: 'rake',
  title: 'RAKE &',
  sub: 'BREAK',
  tagline: 'CLEAR THE TABLE',
  howTo: ['STICK  SLIDE THE RAKE', 'A  LAUNCH / LET GO', 'CARDS FLIP, THEN BREAK', 'K WIDE  Q SPLIT  J STICKY', 'A ACE IS AN EXTRA BALL'],
  buttons: ['LAUNCH', '', ''],
  players: 1,
  colors: { body: '#0f2a1c', trim: '#ffd34d', accent: '#e23b3b', accent2: '#f4efe4', bg: '#0b3a24' },
  song: {
    bpm: 128,
    order: [0, 1, 0, 2],
    leadWave: 'square',
    bassWave: 'triangle',
    gain: 0.7,
    patterns: [
      {
        lead: notes('G4 . B4 D5 . B4 G4 . A4 . C5 E5 . C5 A4 .'),
        bass: notes('G2 . D3 . G2 . D3 . A2 . E3 . A2 . E3 .'),
        drums: 'k.h.s.h.k.hks.h.',
      },
      {
        lead: notes('B4 . D5 G5 . D5 B4 . C5 . E5 A5 - G5 F#5 .'),
        bass: notes('E2 . B2 . E2 . B2 . A2 . E3 . D3 . F#2 .'),
        drums: 'k.h.s.h.k.hks.hs',
      },
      {
        lead: notes('D5 D5 . D5 C5 . B4 . A4 . G4 . A4 B4 . .'),
        bass: notes('C3 . G2 . C3 . G2 . D3 . A2 . D3 . D2 .'),
        arp: notes('C5 E5 G5 E5 C5 E5 G5 E5 D5 F#5 A5 F#5 D5 F#5 A5 F#5'),
        drums: 'k.hsk.hsk.hsk.ss',
      },
    ],
  },
};

/** Reflects a moving ball off a box (AABB) if they overlap: returns 0 none, 1 hit from a side (x flipped), 2 top/bottom (y flipped). */
export function bounceBox(b: { x: number; y: number; vx: number; vy: number }, x0: number, y0: number, x1: number, y1: number, r = BALL_R): 0 | 1 | 2 {
  const cx = Math.max(x0, Math.min(b.x, x1)),
    cy = Math.max(y0, Math.min(b.y, y1));
  const dx = b.x - cx,
    dy = b.y - cy;
  if (dx * dx + dy * dy > r * r) return 0;
  // Push out along the shallower overlap.
  const ox = Math.min(b.x + r - x0, x1 - (b.x - r)),
    oy = Math.min(b.y + r - y0, y1 - (b.y - r));
  if (ox < oy) {
    b.vx = b.x < (x0 + x1) / 2 ? -Math.abs(b.vx) : Math.abs(b.vx);
    b.x += b.x < (x0 + x1) / 2 ? -ox : ox;
    return 1;
  }
  b.vy = b.y < (y0 + y1) / 2 ? -Math.abs(b.vy) : Math.abs(b.vy);
  b.y += b.y < (y0 + y1) / 2 ? -oy : oy;
  return 2;
}

/** Where on the rake the ball landed (-1 left end .. 1 right end) sets its new heading: up to 62° off straight up. */
export function rakeBounce(offset: number, speed: number): [number, number] {
  const a = Math.max(-1, Math.min(1, offset)) * 1.08;
  return [Math.sin(a) * speed, -Math.cos(a) * speed];
}

interface Ball {
  on: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  stuck: boolean;
  stuckOff: number;
}

export class Rake implements Game {
  readonly meta = RAKE_META;
  score = 0;
  over = false;
  level = 1;
  sfx: (name: SfxName, vol?: number, pitch?: number) => void = NO_SFX;
  private rng = new Rng(1);
  readonly kind = new Int8Array(BCOLS * BROWS);
  readonly hp = new Int8Array(BCOLS * BROWS);
  private rank = new Int8Array(BCOLS * BROWS);
  private flip = new Float32Array(BCOLS * BROWS);
  readonly balls: Ball[] = [];
  private dropOn = new Uint8Array(MAX_DROPS);
  private dropX = new Float32Array(MAX_DROPS);
  private dropY = new Float32Array(MAX_DROPS);
  private dropK = new Uint8Array(MAX_DROPS);
  paddle = 160;
  private padV = 0;
  lives = 3;
  private wide = 0;
  private sticky = 0;
  private stage = 0;
  private banner = 0;
  private speed = 150;
  private autoT = 0;
  private time = 0;
  private sparks = new Sparks(120, ['#ffffff', '#e23b3b', '#2fe08a', '#30303a', '#ffd34d', '#4aa3ff']);

  constructor() {
    for (let i = 0; i < MAX_BALLS; i++) this.balls.push({ on: false, x: 0, y: 0, vx: 0, vy: 0, stuck: false, stuckOff: 0 });
  }

  get width() {
    return this.wide > 0 ? 66 : 42;
  }

  start(_players: 1 | 2, seed: number) {
    this.rng.seed(seed);
    this.score = 0;
    this.over = false;
    this.lives = 3;
    this.stage = 0;
    this.time = 0;
    this.loadStage(0);
  }

  loadStage(s: number) {
    this.stage = s;
    this.level = s + 1;
    const lay = LEVELS[s % LEVELS.length];
    this.kind.fill(0);
    this.hp.fill(0);
    this.flip.fill(0);
    for (let y = 0; y < lay.length && y < BROWS; y++)
      for (let x = 0; x < BCOLS; x++) {
        const ch = lay[y][x];
        const i = y * BCOLS + x;
        let k = K.None,
          hp = 1,
          rank = 0;
        if (ch >= '1' && ch <= '4') k = ch.charCodeAt(0) - 48;
        else if (ch === '7') ((k = K.Card), (rank = 7));
        else if (ch === 'c') ((k = K.Card), (rank = 2 + this.rng.int(9)));
        else if (ch === 'K' || ch === 'Q' || ch === 'J' || ch === 'A') ((k = K.Card), (rank = ch === 'K' ? 13 : ch === 'Q' ? 12 : ch === 'J' ? 11 : 1));
        else if (ch === 'G') k = K.Gold;
        if (k === K.Black || k === K.Card) hp = 2;
        this.kind[i] = k;
        this.hp[i] = k ? hp : 0;
        this.rank[i] = rank;
      }
    // Faster tables each time round.
    this.speed = Math.min(290, 150 + s * 14);
    this.wide = 0;
    this.sticky = 0;
    this.dropOn.fill(0);
    this.banner = 2;
    this.serve();
  }

  private serve() {
    for (const b of this.balls) b.on = false;
    const b = this.balls[0];
    b.on = true;
    b.stuck = true;
    b.stuckOff = 6;
    b.x = this.paddle + 6;
    b.y = PADDLE_Y - BALL_R - 1;
    b.vx = 0;
    b.vy = 0;
    this.autoT = 3.5;
  }

  remaining(): number {
    let n = 0;
    for (let i = 0; i < this.kind.length; i++) if (this.kind[i] && this.kind[i] !== K.Gold) n++;
    return n;
  }

  private launch(b: Ball) {
    b.stuck = false;
    const off = b.stuckOff / (this.width / 2);
    const [vx, vy] = rakeBounce(off * 0.6 + 0.15, this.speed);
    b.vx = vx;
    b.vy = vy;
    this.sfx('bounce', 0.5, 1.2);
  }

  step(p: Input) {
    const dt = STEP;
    this.time += dt;
    this.sparks.step(dt, 3, 120);
    if (this.over) return;
    this.banner = Math.max(0, this.banner - dt);
    this.wide = Math.max(0, this.wide - dt);
    this.sticky = Math.max(0, this.sticky - dt);
    const w = this.width;
    const prev = this.paddle;
    this.paddle = Math.max(FX + w / 2, Math.min(FX + BCOLS * BW - w / 2, this.paddle + p.x * 250 * dt));
    this.padV = (this.paddle - prev) / dt;
    let any = false;
    for (const b of this.balls) {
      if (!b.on) continue;
      any = true;
      if (b.stuck) {
        b.x = this.paddle + b.stuckOff;
        b.y = PADDLE_Y - BALL_R - 1;
        this.autoT -= dt;
        if (p.ap || this.autoT <= 0) this.launch(b);
        continue;
      }
      // Two sub-steps so a fast ball can't skip a brick.
      for (let s = 0; s < 2; s++) this.moveBall(b, dt / 2);
    }
    if (!any) {
      this.lives--;
      this.sfx('hurt', 0.9);
      if (this.lives <= 0) {
        this.over = true;
        this.sfx('over', 1);
        return;
      }
      this.wide = 0;
      this.sticky = 0;
      this.serve();
    }
    // Falling favours.
    for (let i = 0; i < MAX_DROPS; i++) {
      if (!this.dropOn[i]) continue;
      this.dropY[i] += 70 * dt;
      if (this.dropY[i] > SCREEN_H) this.dropOn[i] = 0;
      else if (this.dropY[i] + 6 >= PADDLE_Y && this.dropY[i] - 6 <= PADDLE_Y + 6 && Math.abs(this.dropX[i] - this.paddle) < w / 2 + 6) {
        this.dropOn[i] = 0;
        this.favour(this.dropK[i]);
      }
    }
    if (this.remaining() === 0) {
      this.score += 1000 * this.level;
      this.sfx('fanfare', 1);
      this.loadStage(this.stage + 1);
    }
  }

  private favour(rank: number) {
    this.sfx('power', 0.9);
    this.score += 100;
    if (rank === 13) this.wide = 15;
    else if (rank === 11) this.sticky = 15;
    else if (rank === 1) this.lives = Math.min(6, this.lives + 1);
    else if (rank === 12) {
      // Split every ball in play into three.
      const live = this.balls.filter((b) => b.on && !b.stuck);
      for (const src of live) {
        for (const a of [-0.45, 0.45]) {
          const nb = this.balls.find((b) => !b.on);
          if (!nb) break;
          const c = Math.cos(a),
            s = Math.sin(a);
          Object.assign(nb, { on: true, stuck: false, x: src.x, y: src.y, vx: src.vx * c - src.vy * s, vy: src.vx * s + src.vy * c });
          if (nb.vy > -40) nb.vy = -Math.abs(nb.vy) - 40;
        }
      }
    }
  }

  private moveBall(b: Ball, dt: number) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    // Walls.
    if (b.x < FX + BALL_R) ((b.x = FX + BALL_R), (b.vx = Math.abs(b.vx)), this.sfx('tick', 0.2));
    if (b.x > FX + BCOLS * BW - BALL_R) ((b.x = FX + BCOLS * BW - BALL_R), (b.vx = -Math.abs(b.vx)), this.sfx('tick', 0.2));
    if (b.y < FY - 6 + BALL_R) ((b.y = FY - 6 + BALL_R), (b.vy = Math.abs(b.vy)), this.sfx('tick', 0.2));
    // The rake.
    const w = this.width;
    if (b.vy > 0 && b.y + BALL_R >= PADDLE_Y && b.y - BALL_R <= PADDLE_Y + 6 && b.x >= this.paddle - w / 2 - BALL_R && b.x <= this.paddle + w / 2 + BALL_R) {
      const off = (b.x - this.paddle) / (w / 2);
      // A moving rake puts a little english on it.
      const [vx, vy] = rakeBounce(off + this.padV * 0.0006, Math.min(320, Math.hypot(b.vx, b.vy) + 2));
      b.vx = vx;
      b.vy = vy;
      b.y = PADDLE_Y - BALL_R;
      if (this.sticky > 0) {
        b.stuck = true;
        b.stuckOff = b.x - this.paddle;
        this.autoT = 3;
      }
      this.sfx('bounce', 0.5);
    }
    if (b.y > SCREEN_H + 6) {
      b.on = false;
      return;
    }
    // Bricks near the ball.
    const cx = Math.floor((b.x - FX) / BW),
      cy = Math.floor((b.y - FY) / BH);
    for (let yy = cy - 1; yy <= cy + 1; yy++) {
      if (yy < 0 || yy >= BROWS) continue;
      for (let xx = cx - 1; xx <= cx + 1; xx++) {
        if (xx < 0 || xx >= BCOLS) continue;
        const i = yy * BCOLS + xx;
        if (!this.kind[i]) continue;
        const x0 = FX + xx * BW,
          y0 = FY + yy * BH;
        if (bounceBox(b, x0 + 0.5, y0 + 0.5, x0 + BW - 0.5, y0 + BH - 0.5)) {
          this.hitBrick(i, x0 + BW / 2, y0 + BH / 2);
          return;
        }
      }
    }
  }

  hitBrick(i: number, x: number, y: number) {
    const k = this.kind[i];
    if (k === K.Gold) {
      this.sfx('clunk', 0.5);
      this.sparks.burst(this.rng, x, y, 4, 60, 4, 0.3);
      return;
    }
    this.hp[i]--;
    if (this.hp[i] > 0) {
      // A card flips face up; the black chip chips.
      this.flip[i] = 0.25;
      this.score += 50;
      this.sfx(k === K.Card ? 'flip' : 'hit', 0.6);
      return;
    }
    this.kind[i] = K.None;
    this.score += CHIP_POINTS[k];
    this.sparks.burst(this.rng, x, y, 10, 90, k === K.Card ? 0 : k - 1, 0.6);
    this.sfx('brick', 0.6, 0.9 + (i % 5) * 0.06);
    const r = this.rank[i];
    if (k === K.Card && (r === 1 || r >= 11)) {
      for (let d = 0; d < MAX_DROPS; d++) {
        if (this.dropOn[d]) continue;
        this.dropOn[d] = 1;
        this.dropX[d] = x;
        this.dropY[d] = y;
        this.dropK[d] = r;
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  private art: { chips: HTMLCanvasElement[]; back: HTMLCanvasElement; face: HTMLCanvasElement; gold: HTMLCanvasElement; felt: HTMLCanvasElement } | null = null;
  private sprites() {
    if (this.art) return this.art;
    const chip = (base: string, stripe: string) =>
      sprite(BW, BH, (g) => {
        // A chip lying flat, seen from the rail: an oval with edge stripes.
        g.fillStyle = '#00000088';
        g.beginPath();
        g.ellipse(12, 6, 11, 4, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = base;
        g.beginPath();
        g.ellipse(12, 5, 11, 4.2, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = stripe;
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          g.fillRect(12 + Math.cos(a) * 9 - 1, 5 + Math.sin(a) * 3.2 - 1, 3, 2);
        }
        g.strokeStyle = stripe;
        g.globalAlpha = 0.6;
        g.beginPath();
        g.ellipse(12, 5, 6, 2.2, 0, 0, Math.PI * 2);
        g.stroke();
      });
    const chips = [chip('#f4efe4', '#3d6bd6'), chip('#d8262e', '#ffffff'), chip('#1f9b4f', '#ffffff'), chip('#202024', '#ffd34d')];
    const back = sprite(BW, BH, (g) => {
      g.fillStyle = '#f4efe4';
      g.fillRect(0, 0, BW, BH);
      g.fillStyle = '#b3202a';
      g.fillRect(1, 1, BW - 2, BH - 2);
      g.fillStyle = '#e8545c';
      for (let x = 2; x < BW - 2; x += 4) for (let y = 2; y < BH - 2; y += 3) if ((x + y) % 2 === 0) g.fillRect(x, y, 2, 1);
    });
    const face = sprite(BW, BH, (g) => {
      g.fillStyle = '#c9c2b2';
      g.fillRect(0, 0, BW, BH);
      g.fillStyle = '#fffdf6';
      g.fillRect(1, 1, BW - 2, BH - 2);
    });
    const gold = sprite(BW, BH, (g) => {
      g.fillStyle = '#7a5200';
      g.fillRect(0, 0, BW, BH);
      g.fillStyle = '#ffd34d';
      g.fillRect(2, 1, BW - 4, BH - 3);
      g.fillStyle = '#fff2b0';
      g.fillRect(3, 2, BW - 8, 2);
    });
    const felt = sprite(SCREEN_W, SCREEN_H, (g) => {
      const gr = g.createRadialGradient(160, 110, 20, 160, 120, 230);
      gr.addColorStop(0, '#13603a');
      gr.addColorStop(1, '#062615');
      g.fillStyle = gr;
      g.fillRect(0, 0, SCREEN_W, SCREEN_H);
      g.strokeStyle = '#ffffff';
      g.globalAlpha = 0.04;
      for (let k = -SCREEN_H; k < SCREEN_W; k += 12) {
        g.beginPath();
        g.moveTo(k, 0);
        g.lineTo(k + SCREEN_H, SCREEN_H);
        g.moveTo(k + SCREEN_H, 0);
        g.lineTo(k, SCREEN_H);
        g.stroke();
      }
      g.globalAlpha = 1;
      // The rail.
      g.fillStyle = '#3a1d0c';
      g.fillRect(0, 12, FX, SCREEN_H);
      g.fillRect(FX + BCOLS * BW, 12, SCREEN_W - FX - BCOLS * BW, SCREEN_H);
      g.fillRect(0, 12, SCREEN_W, FY - 18);
      g.fillStyle = '#ffd34d';
      g.fillRect(FX - 2, FY - 8, 1, SCREEN_H);
      g.fillRect(FX + BCOLS * BW + 1, FY - 8, 1, SCREEN_H);
      g.fillRect(FX - 2, FY - 8, BCOLS * BW + 4, 1);
    });
    return (this.art = { chips, back, face, gold, felt });
  }

  private cardFace(g: CanvasRenderingContext2D, x: number, y: number, rank: number, i: number) {
    const a = this.sprites();
    g.drawImage(a.face, x, y);
    const red = i % 2 === 0;
    const label = rank === 1 ? 'A' : rank === 11 ? 'J' : rank === 12 ? 'Q' : rank === 13 ? 'K' : '';
    const col = red ? '#c8102e' : '#16161c';
    if (label) text(g, label, x + 3, y + 2, col);
    else num(g, rank, x + 3, y + 2, col);
    // A suit pip.
    g.fillStyle = col;
    if (red) {
      g.beginPath();
      g.moveTo(x + 17, y + 2);
      g.lineTo(x + 20, y + 5);
      g.lineTo(x + 17, y + 8);
      g.lineTo(x + 14, y + 5);
      g.fill();
    } else {
      g.beginPath();
      g.moveTo(x + 17, y + 2);
      g.lineTo(x + 20, y + 6);
      g.lineTo(x + 14, y + 6);
      g.fill();
      g.fillRect(x + 16, y + 6, 2, 2);
    }
  }

  draw(g: CanvasRenderingContext2D, t: number) {
    const a = this.sprites();
    g.drawImage(a.felt, 0, 0);
    for (let y = 0; y < BROWS; y++)
      for (let x = 0; x < BCOLS; x++) {
        const i = y * BCOLS + x;
        const k = this.kind[i];
        if (!k) continue;
        const px = FX + x * BW,
          py = FY + y * BH;
        if (k >= K.White && k <= K.Black) {
          g.drawImage(a.chips[k - 1], px, py);
          if (k === K.Black && this.hp[i] === 1) {
            g.fillStyle = '#ffffff';
            g.fillRect(px + 15, py + 3, 3, 1);
            g.fillRect(px + 13, py + 4, 2, 1);
          }
        } else if (k === K.Gold) g.drawImage(a.gold, px, py);
        else if (k === K.Card) {
          if (this.hp[i] >= 2) g.drawImage(a.back, px, py);
          else this.cardFace(g, px, py, this.rank[i], i);
        }
      }
    // Favours falling.
    for (let d = 0; d < MAX_DROPS; d++) {
      if (!this.dropOn[d]) continue;
      const x = this.dropX[d] - 7,
        y = this.dropY[d] - 5;
      g.fillStyle = Math.floor(t * 8) % 2 ? '#ffd34d' : '#ffffff';
      g.fillRect(x - 1, y - 1, 16, 12);
      g.fillStyle = '#16161c';
      g.fillRect(x, y, 14, 10);
      const r = this.dropK[d];
      text(g, r === 13 ? 'K' : r === 12 ? 'Q' : r === 11 ? 'J' : 'A', x + 5, y + 2, '#ffd34d');
    }
    // The rake: a brass bar with tines and a handle.
    const w = this.width,
      x0 = Math.round(this.paddle - w / 2);
    g.fillStyle = this.sticky > 0 ? '#4de2c1' : '#7a5200';
    g.fillRect(x0, PADDLE_Y, w, 6);
    g.fillStyle = this.sticky > 0 ? '#c8fff1' : '#ffd34d';
    g.fillRect(x0 + 1, PADDLE_Y, w - 2, 3);
    g.fillStyle = '#4a2a10';
    g.fillRect(Math.round(this.paddle) - 2, PADDLE_Y + 6, 4, 14);
    for (let k = 4; k < w - 2; k += 6) {
      g.fillStyle = '#ffd34d';
      g.fillRect(x0 + k, PADDLE_Y + 6, 1, 2);
    }
    // Balls.
    for (const b of this.balls) {
      if (!b.on) continue;
      g.fillStyle = '#9aa4b0';
      g.fillRect((b.x - 3) | 0, (b.y - 2) | 0, 6, 4);
      g.fillRect((b.x - 2) | 0, (b.y - 3) | 0, 4, 6);
      g.fillStyle = '#ffffff';
      g.fillRect((b.x - 2) | 0, (b.y - 2) | 0, 3, 3);
    }
    this.sparks.draw(g, 2);
    // Top bar.
    g.fillStyle = '#000000';
    g.fillRect(0, 0, SCREEN_W, 12);
    text(g, 'SCORE', 4, 3, '#ffd34d');
    num(g, this.score, 38, 3, '#ffffff');
    text(g, 'TABLE', 140, 3, '#ffd34d');
    num(g, this.level, 174, 3, '#ffffff');
    for (let k = 0; k < Math.min(6, this.lives); k++) {
      g.fillStyle = '#ffffff';
      g.fillRect(250 + k * 10, 4, 5, 5);
    }
    if (this.wide > 0) text(g, 'K', 300, 3, '#ffd34d');
    if (this.sticky > 0) text(g, 'J', 310, 3, '#4de2c1');
    if (this.banner > 0 && !this.over) {
      shadowText(g, 'TABLE', 160, 120, '#ffd34d', 3, 'center');
      num(g, this.level, 160, 146, '#ffffff', 3, 'center');
    } else if (this.balls[0].on && this.balls[0].stuck && Math.floor(t * 3) % 2 === 0) shadowText(g, 'PRESS A TO LAUNCH', 160, 190, '#ffffff', 1, 'center');
  }

  attract(g: CanvasRenderingContext2D, t: number) {
    const a = this.sprites();
    g.drawImage(a.felt, 0, 0);
    // A fan of cards under the title, chip stacks either side.
    for (let k = 0; k < 5; k++) {
      g.save();
      g.translate(160, 214);
      g.rotate(-0.5 + k * 0.25 + Math.sin(t * 0.7) * 0.04);
      g.scale(1.5, 1.5);
      if (k === 2) this.cardFace(g, -12, -42, 13, 1);
      else if (k % 2) g.drawImage(a.back, -12, -42);
      else this.cardFace(g, -12, -42, k === 0 ? 1 : 12, k);
      g.restore();
    }
    for (let s = 0; s < 4; s++) {
      const x = s < 2 ? 18 + s * 28 : 250 + (s - 2) * 28;
      const h = 6 + ((s * 3) % 5);
      for (let k = 0; k < h; k++) g.drawImage(a.chips[s], x, 208 - k * 5 - (s === 1 ? Math.abs(Math.sin(t * 2)) * 6 : 0));
    }
  }

  snap(o: number[]) {
    o.length = 0;
    o.push(this.score, this.level, this.lives, Math.round(this.paddle), this.wide > 0 ? 1 : 0, this.sticky > 0 ? 1 : 0, Math.round(this.banner * 10), this.over ? 1 : 0);
    for (let i = 0; i < this.kind.length; i++) o.push(this.kind[i] * 16 + this.hp[i] * 4 + (this.rank[i] >= 11 || this.rank[i] === 1 ? 1 : 0));
    for (const b of this.balls) if (b.on) o.push(Math.round(b.x), Math.round(b.y));
  }

  load(a: readonly number[]) {
    let k = 0;
    const r = () => Number(a[k++]) || 0;
    this.score = r();
    this.level = r();
    this.lives = r();
    this.paddle = r();
    this.wide = r() ? 1 : 0;
    this.sticky = r() ? 1 : 0;
    this.banner = r() / 10;
    this.over = r() === 1;
    for (let i = 0; i < this.kind.length; i++) {
      const v = r();
      this.kind[i] = (v >> 4) & 7;
      this.hp[i] = (v >> 2) & 3;
      if (this.kind[i] === K.Card && !this.rank[i]) this.rank[i] = v & 1 ? 13 : 2 + (i % 9);
    }
    for (const b of this.balls) b.on = false;
    for (let n = 0; k + 1 < a.length && n < MAX_BALLS; n++) {
      const b = this.balls[n];
      b.on = true;
      b.stuck = false;
      b.x = r();
      b.y = r();
    }
  }
}
