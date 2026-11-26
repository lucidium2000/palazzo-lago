import { NO_SFX, Rng, SCREEN_H, SCREEN_W, STEP, type Game, type GameMeta, type Input, type SfxName } from '../types';
import { num, shadowText, text } from '../font';
import { Sparks, sprite } from '../gfx';
import { notes } from '../music';

/**
 * SPLASH RALLY: head-to-head paddle tennis across a swimming pool, for one
 * player against the pool's champions or two friends on one cabinet. Your
 * paddle is an inflatable float (stick up/down); the ball is a beach ball.
 * Press A just before it reaches you for a Splash Shot (much faster). Two
 * lily pads drift across the middle and knock the ball off line. First to
 * seven takes the match.
 */

const TOP = 22;
const BOTTOM = 224;
const P1X = 18;
const P2X = 302;
const PAD_H = 38;
const PAD_W = 8;
const BALL_R = 6;
export const WIN_AT = 7;

/** The pool's champions, in order: name, paddle speed (px/s), reaction delay (s), aim error (px). */
export const RIVALS: [string, number, number, number][] = [
  ['GIL', 120, 0.24, 18],
  ['MARINA', 150, 0.16, 12],
  ['DUKE', 175, 0.11, 8],
  ['CAPTAIN SPLASH', 205, 0.07, 4],
];

export const SPLASH_META: GameMeta = {
  id: 'splash',
  title: 'SPLASH',
  sub: 'RALLY',
  tagline: '1 OR 2 PLAYERS . FIRST TO 7',
  howTo: ['STICK  UP / DOWN', 'A  SPLASH SHOT: PRESS', 'JUST BEFORE THE BALL HITS', 'LILY PADS DEFLECT', 'A FRIEND CAN JOIN AS P2'],
  buttons: ['SPLASH', '', ''],
  players: 2,
  colors: { body: '#062a3a', trim: '#3ad8ff', accent: '#ff5ab4', accent2: '#fff27a', bg: '#06324a' },
  song: {
    bpm: 132,
    order: [0, 1, 0, 2],
    leadWave: 'pulse',
    bassWave: 'triangle',
    gain: 0.7,
    patterns: [
      {
        lead: notes('E5 . G#5 . B5 . G#5 E5 F#5 . A5 . C#6 . A5 F#5'),
        bass: notes('E2 . E3 . B2 . E3 . F#2 . F#3 . C#3 . F#3 .'),
        drums: 'k.hsk.hsk.hsk.hs',
      },
      {
        lead: notes('G#5 . F#5 . E5 . C#5 . B4 . C#5 E5 . . . .'),
        bass: notes('A2 . A3 . E3 . A3 . B2 . B3 . F#3 . B3 .'),
        drums: 'k.hsk.hsk.hsk.ss',
      },
      {
        lead: notes('B5 B5 . A5 G#5 . F#5 . E5 E5 . F#5 G#5 . B5 .'),
        bass: notes('C#3 . C#3 . G#2 . G#2 . A2 . A2 . B2 . B2 .'),
        arp: notes('C#5 E5 G#5 E5 G#4 B4 D#5 B4 A4 C#5 E5 C#5 B4 D#5 F#5 D#5'),
        drums: 'kkhsk.hskkhsk.so',
      },
    ],
  },
};

/** Paddle bounce: offset -1 (top end) .. 1 (bottom end) to a heading away from the paddle. */
export function paddleBounce(offset: number, speed: number, toRight: boolean): [number, number] {
  const a = Math.max(-1, Math.min(1, offset)) * 0.95;
  return [(toRight ? 1 : -1) * Math.cos(a) * speed, Math.sin(a) * speed];
}

export class Splash implements Game {
  readonly meta = SPLASH_META;
  score = 0;
  over = false;
  level = 1;
  versus = false;
  sfx: (name: SfxName, vol?: number, pitch?: number) => void = NO_SFX;
  private rng = new Rng(1);
  s1 = 0;
  s2 = 0;
  /** Which champion (1-player ladder). */
  rival = 0;
  p1 = 120;
  p2 = 120;
  bx = 160;
  by = 120;
  bvx = 0;
  bvy = 0;
  private serveT = 1.2;
  private serveDir = 1;
  private spike1 = 0;
  private spike2 = 0;
  private flash = 0;
  private time = 0;
  private spin = 0;
  private banner: 'NEW CHALLENGER' | 'MATCH' | 'YOU WIN' | 'P1 WINS' | 'P2 WINS' | '' = '';
  private bannerT = 0;
  private aiT = 0;
  private aiTarget = 120;
  private padsPh = 0;
  rally = 0;
  private sparks = new Sparks(80, ['#ffffff', '#bdf3ff', '#ff5ab4', '#3ad8ff']);
  /** Which side last won a match (for the banner), 1 or 2. */
  private winner = 0;

  start(_players: 1 | 2, seed: number) {
    this.rng.seed(seed);
    this.score = 0;
    this.over = false;
    this.rival = 0;
    this.level = 1;
    this.versus = false;
    this.time = 0;
    this.newMatch();
  }

  setHuman2(on: boolean) {
    if (on === this.versus || this.over) return;
    this.versus = on;
    this.newMatch();
    this.banner = on ? 'NEW CHALLENGER' : 'MATCH';
    this.bannerT = 2;
    this.sfx('fanfare', 0.8);
  }

  private newMatch() {
    this.s1 = 0;
    this.s2 = 0;
    this.p1 = this.p2 = 120;
    this.serve(this.rng.next() < 0.5 ? 1 : -1);
    this.banner = 'MATCH';
    this.bannerT = 1.6;
  }

  private serve(dir: number) {
    this.bx = 160;
    this.by = 120;
    this.bvx = 0;
    this.bvy = 0;
    this.serveT = 1.1;
    this.serveDir = dir;
    this.rally = 0;
  }

  /** Lily pad centres (they drift up and down the middle). */
  padY(k: number) {
    return 123 + Math.sin(this.padsPh * (k ? 0.9 : 0.7) + k * 2.4) * 70;
  }
  padX(k: number) {
    return k ? 196 : 124;
  }

  private ai(dt: number): number {
    // The champion watches the ball with a delay and aims a bit off.
    const [, speed, react, err] = RIVALS[Math.min(this.rival, RIVALS.length - 1)];
    this.aiT -= dt;
    if (this.aiT <= 0) {
      this.aiT = react;
      if (this.bvx > 0) {
        // Where it'll cross (bouncing off the walls).
        const t = (P2X - this.bx) / this.bvx;
        let y = this.by + this.bvy * t;
        const span = BOTTOM - TOP - BALL_R * 2;
        y -= TOP + BALL_R;
        y = ((y % (2 * span)) + 2 * span) % (2 * span);
        if (y > span) y = 2 * span - y;
        this.aiTarget = y + TOP + BALL_R + this.rng.range(-err, err);
      } else this.aiTarget = 123;
    }
    const d = this.aiTarget - this.p2;
    return Math.max(-1, Math.min(1, d / 12)) * (speed / 190);
  }

  step(p1: Input, p2: Input) {
    const dt = STEP;
    this.time += dt;
    this.padsPh += dt;
    this.flash = Math.max(0, this.flash - dt);
    this.bannerT = Math.max(0, this.bannerT - dt);
    this.sparks.step(dt, 2, 60);
    if (this.over) return;
    this.spike1 = p1.ap ? 0.2 : Math.max(0, this.spike1 - dt);
    // The champion swings at the right moment, sometimes.
    const p2y = this.versus ? p2.y : -this.ai(dt);
    if (this.versus) this.spike2 = p2.ap ? 0.2 : Math.max(0, this.spike2 - dt);
    else if (this.bvx > 0 && P2X - this.bx < 40 && this.rival >= 1 && this.rng.next() < 0.04 * this.rival) this.spike2 = 0.2;
    else this.spike2 = Math.max(0, this.spike2 - dt);
    const lim = (y: number) => Math.max(TOP + PAD_H / 2, Math.min(BOTTOM - PAD_H / 2, y));
    this.p1 = lim(this.p1 - p1.y * 190 * dt);
    this.p2 = lim(this.p2 - p2y * 190 * dt);
    if (this.bannerT > 1 && this.banner === 'NEW CHALLENGER') return;
    if (this.serveT > 0) {
      this.serveT -= dt;
      if (this.serveT <= 0) {
        const a = this.rng.range(-0.5, 0.5);
        const sp = 140 + this.rival * 10;
        this.bvx = Math.cos(a) * sp * this.serveDir;
        this.bvy = Math.sin(a) * sp;
        this.sfx('bounce', 0.5, 0.8);
      }
      return;
    }
    this.spin += dt * this.bvx * 0.05;
    // Two half steps.
    for (let s = 0; s < 2; s++) this.moveBall(dt / 2);
  }

  private moveBall(dt: number) {
    this.bx += this.bvx * dt;
    this.by += this.bvy * dt;
    if (this.by < TOP + BALL_R) ((this.by = TOP + BALL_R), (this.bvy = Math.abs(this.bvy)), this.sfx('tick', 0.3));
    if (this.by > BOTTOM - BALL_R) ((this.by = BOTTOM - BALL_R), (this.bvy = -Math.abs(this.bvy)), this.sfx('tick', 0.3));
    // Lily pads.
    for (let k = 0; k < 2; k++) {
      const dx = this.bx - this.padX(k),
        dy = this.by - this.padY(k);
      const r = 10 + BALL_R;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r && d2 > 0.01) {
        const d = Math.sqrt(d2),
          nx = dx / d,
          ny = dy / d;
        const vn = this.bvx * nx + this.bvy * ny;
        if (vn < 0) {
          this.bvx -= 2 * vn * nx;
          this.bvy -= 2 * vn * ny;
          // Never straight up and down.
          if (Math.abs(this.bvx) < 60) this.bvx = Math.sign(this.bvx || 1) * 60;
          this.sfx('bounce', 0.4, 1.4);
        }
        this.bx = this.padX(k) + nx * r;
        this.by = this.padY(k) + ny * r;
      }
    }
    const speed = Math.hypot(this.bvx, this.bvy);
    // Paddles.
    if (this.bvx < 0 && this.bx - BALL_R <= P1X + PAD_W / 2 && this.bx > P1X - 6 && Math.abs(this.by - this.p1) < PAD_H / 2 + BALL_R) this.hitPaddle(1, speed);
    else if (this.bvx > 0 && this.bx + BALL_R >= P2X - PAD_W / 2 && this.bx < P2X + 6 && Math.abs(this.by - this.p2) < PAD_H / 2 + BALL_R) this.hitPaddle(2, speed);
    // Points.
    if (this.bx < -8) this.point(2);
    else if (this.bx > SCREEN_W + 8) this.point(1);
  }

  private hitPaddle(side: 1 | 2, speed: number) {
    const spike = side === 1 ? this.spike1 > 0 : this.spike2 > 0;
    const off = (this.by - (side === 1 ? this.p1 : this.p2)) / (PAD_H / 2);
    let sp = Math.min(330, speed + 9);
    if (spike) sp = Math.min(420, sp * 1.35);
    const [vx, vy] = paddleBounce(off, sp, side === 1);
    this.bvx = vx;
    this.bvy = vy;
    this.bx = side === 1 ? P1X + PAD_W / 2 + BALL_R : P2X - PAD_W / 2 - BALL_R;
    this.rally++;
    if (side === 1 && !this.versus) this.score += 10 * this.rally;
    if (spike) {
      this.flash = 0.18;
      this.sparks.burst(this.rng, this.bx, this.by, 16, 120, 1, 0.5);
      this.sfx('splash', 0.9);
      if (side === 1) this.spike1 = 0;
      else this.spike2 = 0;
    } else this.sfx('bounce', 0.6);
  }

  private point(side: 1 | 2) {
    this.sparks.burst(this.rng, side === 1 ? SCREEN_W - 4 : 4, this.by, 30, 140, 0, 0.8);
    if (side === 1) {
      this.s1++;
      if (!this.versus) this.score += 100 * (this.rival + 1);
      this.sfx('pickup', 0.9);
    } else {
      this.s2++;
      this.sfx(this.versus ? 'pickup' : 'hurt', 0.8);
    }
    if (this.s1 >= WIN_AT || this.s2 >= WIN_AT) {
      this.winner = this.s1 >= WIN_AT ? 1 : 2;
      if (this.versus) {
        this.banner = this.winner === 1 ? 'P1 WINS' : 'P2 WINS';
        this.bannerT = 3;
        this.over = true;
        this.sfx('fanfare', 1);
        return;
      }
      if (this.winner === 1) {
        this.score += 2000 * (this.rival + 1);
        this.rival++;
        this.level = this.rival + 1;
        this.banner = 'YOU WIN';
        this.bannerT = 2.5;
        this.sfx('fanfare', 1);
        this.s1 = this.s2 = 0;
        this.serve(1);
        this.serveT = 2.5;
      } else {
        this.over = true;
        this.sfx('over', 1);
      }
      return;
    }
    this.serve(side === 1 ? -1 : 1);
  }

  predict(dt: number) {
    if (this.over || this.serveT > 0) return;
    this.padsPh += dt;
    this.bx += this.bvx * dt;
    this.by = Math.max(TOP + BALL_R, Math.min(BOTTOM - BALL_R, this.by + this.bvy * dt));
  }

  // ---------------------------------------------------------------------------
  private art: { water: HTMLCanvasElement } | null = null;
  private sprites() {
    if (this.art) return this.art;
    const water = sprite(SCREEN_W, SCREEN_H, (g) => {
      g.fillStyle = '#0b6f9e';
      g.fillRect(0, 0, SCREEN_W, SCREEN_H);
      // Tiles.
      g.strokeStyle = '#0e86bb';
      g.lineWidth = 1;
      for (let x = 0; x < SCREEN_W; x += 16) {
        g.beginPath();
        g.moveTo(x + 0.5, TOP);
        g.lineTo(x + 0.5, BOTTOM);
        g.stroke();
      }
      for (let y = TOP; y < BOTTOM; y += 16) {
        g.beginPath();
        g.moveTo(0, y + 0.5);
        g.lineTo(SCREEN_W, y + 0.5);
        g.stroke();
      }
      // Lane line down the middle (dashed dark tile).
      g.fillStyle = '#064a6c';
      for (let y = TOP + 4; y < BOTTOM; y += 12) g.fillRect(158, y, 4, 7);
      // Deck at top and bottom with lane-rope floats.
      g.fillStyle = '#d9c9a8';
      g.fillRect(0, 0, SCREEN_W, TOP - 3);
      g.fillRect(0, BOTTOM + 3, SCREEN_W, SCREEN_H - BOTTOM - 3);
      for (let x = 0; x < SCREEN_W; x += 8) {
        g.fillStyle = (x / 8) % 2 ? '#ffffff' : '#e23b3b';
        g.fillRect(x + 1, TOP - 4, 6, 4);
        g.fillRect(x + 1, BOTTOM, 6, 4);
      }
    });
    return (this.art = { water });
  }

  private drawFloat(g: CanvasRenderingContext2D, x: number, y: number, body: string, light: string, glow: boolean) {
    const top = y - PAD_H / 2;
    g.fillStyle = '#00000055';
    g.fillRect(x - PAD_W / 2 + 2, top + 3, PAD_W, PAD_H);
    g.fillStyle = body;
    g.fillRect(x - PAD_W / 2, top + 3, PAD_W, PAD_H - 6);
    g.fillRect(x - PAD_W / 2 + 1, top + 1, PAD_W - 2, PAD_H - 2);
    g.fillRect(x - PAD_W / 2 + 2, top, PAD_W - 4, PAD_H);
    g.fillStyle = light;
    g.fillRect(x - PAD_W / 2 + 2, top + 3, 2, PAD_H - 6);
    for (let k = 8; k < PAD_H - 4; k += 8) {
      g.fillStyle = '#00000033';
      g.fillRect(x - PAD_W / 2, top + k, PAD_W, 1);
    }
    if (glow) {
      g.fillStyle = '#ffffff';
      g.globalAlpha = 0.5;
      g.fillRect(x - PAD_W / 2 - 2, top - 2, PAD_W + 4, PAD_H + 4);
      g.globalAlpha = 1;
    }
  }

  private drawBall(g: CanvasRenderingContext2D, x: number, y: number) {
    g.fillStyle = '#00000044';
    g.beginPath();
    g.arc(x + 2, y + 3, BALL_R, 0, Math.PI * 2);
    g.fill();
    const cols = ['#ff3b5c', '#ffffff', '#3d8bff', '#ffffff', '#ffcf3a', '#ffffff'];
    for (let k = 0; k < 6; k++) {
      g.fillStyle = cols[k];
      g.beginPath();
      g.moveTo(x, y);
      g.arc(x, y, BALL_R, this.spin + (k / 6) * Math.PI * 2, this.spin + ((k + 1) / 6) * Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#ffffff';
    g.fillRect(x - 2, y - 3, 2, 2);
  }

  private drawPads(g: CanvasRenderingContext2D) {
    for (let k = 0; k < 2; k++) {
      const x = this.padX(k),
        y = this.padY(k);
      g.fillStyle = '#1d6b2a';
      g.beginPath();
      g.arc(x, y, 10, 0.35, Math.PI * 2 - 0.1);
      g.lineTo(x, y);
      g.fill();
      g.fillStyle = '#3fb34f';
      g.beginPath();
      g.arc(x, y, 8, 0.4, Math.PI * 2 - 0.15);
      g.lineTo(x, y);
      g.fill();
      g.fillStyle = '#ff9ad5';
      g.fillRect(x - 2, y - 3, 4, 4);
      g.fillStyle = '#ffffff';
      g.fillRect(x - 1, y - 2, 2, 2);
    }
  }

  private waterWaves(g: CanvasRenderingContext2D, t: number) {
    g.strokeStyle = '#9fe9ff';
    g.globalAlpha = 0.18;
    g.lineWidth = 1;
    for (let k = 0; k < 7; k++) {
      const y0 = TOP + 14 + k * 30;
      g.beginPath();
      for (let x = 0; x <= SCREEN_W; x += 16) {
        const y = y0 + Math.sin(x * 0.05 + t * 1.6 + k) * 3;
        if (x) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  draw(g: CanvasRenderingContext2D, t: number) {
    const a = this.sprites();
    g.drawImage(a.water, 0, 0);
    this.waterWaves(g, t);
    this.drawPads(g);
    this.drawFloat(g, P1X, this.p1, '#ff5ab4', '#ffc0e2', this.spike1 > 0);
    this.drawFloat(g, P2X, this.p2, '#3ad8ff', '#c8f4ff', this.spike2 > 0);
    if (this.serveT <= 0 || Math.floor(t * 8) % 2) this.drawBall(g, this.bx, this.by);
    this.sparks.draw(g, 2);
    if (this.flash > 0) {
      g.fillStyle = '#ffffff';
      g.globalAlpha = this.flash * 2;
      g.fillRect(0, TOP, SCREEN_W, BOTTOM - TOP);
      g.globalAlpha = 1;
    }
    // Scores on the deck.
    num(g, this.s1, 120, 3, '#ff5ab4', 2, 'right');
    text(g, '-', 160, 6, '#062a3a', 1, 'center');
    num(g, this.s2, 200, 3, '#0a8fb8', 2, 'left');
    text(g, this.versus ? 'P1' : 'YOU', 6, 6, '#8a1450');
    text(g, this.versus ? 'P2' : RIVALS[Math.min(this.rival, RIVALS.length - 1)][0], 314, 6, '#0a5a78', 1, 'right');
    if (!this.versus) {
      text(g, 'SCORE', 6, 230, '#5a4a30');
      num(g, this.score, 42, 230, '#062a3a');
    }
    if (this.rally >= 6) {
      text(g, 'RALLY', 278, 230, '#5a4a30', 1, 'right');
      num(g, this.rally, 284, 230, '#062a3a');
    }
    if (this.bannerT > 0) {
      const c = this.banner === 'NEW CHALLENGER' ? '#fff27a' : '#ffffff';
      shadowText(g, this.banner, 160, 96, c, this.banner === 'NEW CHALLENGER' ? 2 : 3, 'center', '#062a3a');
      if (this.banner === 'MATCH' && !this.versus) shadowText(g, 'VS ' + RIVALS[Math.min(this.rival, RIVALS.length - 1)][0], 160, 126, '#ffffff', 2, 'center', '#062a3a');
    }
  }

  attract(g: CanvasRenderingContext2D, t: number) {
    const a = this.sprites();
    g.drawImage(a.water, 0, 0);
    this.waterWaves(g, t);
    this.padsPh = t;
    this.drawPads(g);
    const bx = 160 + Math.sin(t * 1.3) * 130,
      by = 123 + Math.sin(t * 2.9) * 80;
    this.drawFloat(g, P1X, 123 + Math.sin(t * 2.9 - 0.4) * 70, '#ff5ab4', '#ffc0e2', false);
    this.drawFloat(g, P2X, 123 + Math.sin(t * 2.9 + 0.4) * 70, '#3ad8ff', '#c8f4ff', false);
    this.spin = t * 4;
    this.drawBall(g, bx, by);
  }

  snap(o: number[]) {
    o.length = 0;
    o.push(this.s1, this.s2, this.rival, Math.round(this.bx), Math.round(this.by), Math.round(this.bvx), Math.round(this.bvy), Math.round(this.p1), Math.round(this.p2), Math.round(this.padsPh * 100), this.versus ? 1 : 0, this.over ? 1 : 0, Math.round(this.serveT * 10), this.score, this.flash > 0 ? 1 : 0, ['', 'NEW CHALLENGER', 'MATCH', 'YOU WIN', 'P1 WINS', 'P2 WINS'].indexOf(this.banner), Math.round(this.bannerT * 10), this.spike1 > 0 ? 1 : 0, this.spike2 > 0 ? 1 : 0);
  }

  load(a: readonly number[]) {
    let k = 0;
    const r = () => Number(a[k++]) || 0;
    this.s1 = r();
    this.s2 = r();
    this.rival = r();
    this.bx = r();
    this.by = r();
    this.bvx = r();
    this.bvy = r();
    this.p1 = r();
    this.p2 = r();
    this.padsPh = r() / 100;
    this.versus = r() === 1;
    this.over = r() === 1;
    this.serveT = r() / 10;
    this.score = r();
    if (r()) this.flash = 0.18;
    const b = r();
    this.banner = (['', 'NEW CHALLENGER', 'MATCH', 'YOU WIN', 'P1 WINS', 'P2 WINS'] as const)[Math.max(0, b)] ?? '';
    this.bannerT = r() / 10;
    this.spike1 = r() ? 0.1 : 0;
    this.spike2 = r() ? 0.1 : 0;
  }
}
