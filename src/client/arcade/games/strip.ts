import { NO_SFX, Rng, SCREEN_H, SCREEN_W, STEP, type Game, type GameMeta, type Input, type SfxName } from '../types';
import { num, shadowText, text } from '../font';
import { sprite } from '../gfx';
import { notes } from '../music';

/**
 * MIDNIGHT STRIP: a lane-dodging night drive down a neon boulevard. Steer
 * through the traffic (stick), brake (B), and burn nitro (A) that you fill by
 * picking up the gold chips on the road. The clock runs down; every
 * checkpoint gives you more time. Scraping past a car at speed is a Close
 * Call (+100); hitting one spins you down to a crawl.
 */

const HZ = 104;
/** Screen row for a distance ahead, and back. */
const ROW_K = 620;
const SCALE_K = 125;
const HALF = 6;
export const LANES = [-4.5, -1.5, 1.5, 4.5];
const MAX_CARS = 12;
const MAX_CHIPS = 8;
const TOP_SPEED = 62;
const CHECK_EVERY = 1800;

export const STRIP_META: GameMeta = {
  id: 'strip',
  title: 'MIDNIGHT',
  sub: 'STRIP',
  tagline: 'BEAT THE CLOCK . DODGE THE TRAFFIC',
  howTo: ['STICK  STEER', 'A  NITRO   B  BRAKE', 'GOLD CHIPS FILL NITRO', 'CHECKPOINTS ADD TIME', 'CLOSE CALLS SCORE 100'],
  buttons: ['NITRO', 'BRAKE', ''],
  players: 1,
  colors: { body: '#1a0b22', trim: '#ff5ab4', accent: '#ffb03a', accent2: '#3ad8ff', bg: '#12051c' },
  song: {
    bpm: 150,
    order: [0, 1, 0, 2],
    leadWave: 'sawtooth',
    bassWave: 'square',
    gain: 0.6,
    patterns: [
      {
        lead: notes('D5 . . D5 F5 . A5 . G5 . F5 . E5 . C5 .'),
        bass: notes('D2 D3 D2 D3 D2 D3 D2 D3 Bb1 Bb2 Bb1 Bb2 C2 C3 C2 C3'),
        drums: 'k.h.s.hkk.h.s.h.',
      },
      {
        lead: notes('F5 . E5 . D5 . A4 - . . C5 D5 E5 . C5 .'),
        bass: notes('Bb1 Bb2 Bb1 Bb2 F2 F3 F2 F3 C2 C3 C2 C3 A1 A2 A1 A2'),
        drums: 'k.h.s.hkk.h.s.hs',
      },
      {
        lead: notes('A5 . G5 A5 . G5 F5 . E5 . F5 G5 . F5 E5 .'),
        bass: notes('G1 G2 G1 G2 A1 A2 A1 A2 Bb1 Bb2 Bb1 Bb2 A1 A2 C#2 C#3'),
        arp: notes('D5 F5 A5 F5 E5 G5 A5 G5 F5 A5 D6 A5 E5 A5 C#6 A5'),
        drums: 'kshskshskshsksss',
      },
    ],
  },
};

/** Road curvature at a distance along the drive (1/m): gentle sweeps, deterministic. */
export function curveAt(z: number, phase = 0): number {
  return 0.0034 * Math.sin(z / 420 + phase) * Math.min(1, Math.abs(Math.sin(z / 900 + phase * 0.5)) * 1.6) + 0.0012 * Math.sin(z / 160 + phase * 2);
}

/** Seconds added at the n-th checkpoint (1-based). */
export function checkpointBonus(n: number): number {
  return Math.max(14, 32 - n * 2);
}

export class Strip implements Game {
  readonly meta = STRIP_META;
  score = 0;
  over = false;
  level = 1;
  sfx: (name: SfxName, vol?: number, pitch?: number) => void = NO_SFX;
  private rng = new Rng(1);
  private phase = 0;
  /** Distance driven (m), speed (m/s), lateral position (m from the centre line). */
  pos = 0;
  speed = 0;
  px = 1.5;
  timeLeft = 45;
  nitro = 0.5;
  private boosting = false;
  private spin = 0;
  checkpoints = 0;
  private cpBanner = 0;
  private closeT = 0;
  private time = 0;
  private endT = 0;
  chips = 0;
  closeCalls = 0;
  readonly carOn = new Uint8Array(MAX_CARS);
  readonly carZ = new Float32Array(MAX_CARS);
  readonly carX = new Float32Array(MAX_CARS);
  private carV = new Float32Array(MAX_CARS);
  private carC = new Uint8Array(MAX_CARS);
  private carPassed = new Uint8Array(MAX_CARS);
  readonly chipOn = new Uint8Array(MAX_CHIPS);
  readonly chipZ = new Float32Array(MAX_CHIPS);
  readonly chipX = new Float32Array(MAX_CHIPS);
  private spawnT = 0;

  start(_players: 1 | 2, seed: number) {
    this.rng.seed(seed);
    this.phase = this.rng.next() * 10;
    this.score = 0;
    this.over = false;
    this.pos = 0;
    this.speed = 0;
    this.px = 1.5;
    this.timeLeft = 45;
    this.nitro = 0.5;
    this.spin = 0;
    this.checkpoints = 0;
    this.cpBanner = 0;
    this.closeT = 0;
    this.time = 0;
    this.endT = 0;
    this.chips = 0;
    this.closeCalls = 0;
    this.level = 1;
    this.carOn.fill(0);
    this.chipOn.fill(0);
  }

  get mph() {
    return Math.round(this.speed * 2.5);
  }

  private density() {
    return Math.min(MAX_CARS, 3 + Math.floor(this.pos / 1500));
  }

  step(p: Input) {
    const dt = STEP;
    this.time += dt;
    this.cpBanner = Math.max(0, this.cpBanner - dt);
    this.closeT = Math.max(0, this.closeT - dt);
    if (this.over) return;
    // The clock.
    if (this.timeLeft > 0) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft === 0) this.sfx('buzzer', 1);
    }
    const out = this.timeLeft <= 0;
    // Speed: it pulls by itself; brake, nitro, grass and spins change it.
    let target = TOP_SPEED;
    this.boosting = p.a && this.nitro > 0 && !out && this.spin <= 0;
    if (this.boosting) {
      target = TOP_SPEED * 1.38;
      this.nitro = Math.max(0, this.nitro - dt * 0.32);
    }
    if (Math.abs(this.px) > HALF) target *= 0.45;
    if (p.b) target = Math.min(target, 12);
    if (out) target = 0;
    if (this.spin > 0) {
      this.spin -= dt;
      target = 10;
    }
    const acc = this.speed < target ? (this.boosting ? 22 : 11) : p.b || out ? 34 : 14;
    this.speed += Math.sign(target - this.speed) * Math.min(Math.abs(target - this.speed), acc * dt);
    const was = this.pos;
    this.pos += this.speed * dt;
    this.level = 1 + Math.floor(this.pos / 3000);
    this.score += Math.floor(this.pos / 2) - Math.floor(was / 2);
    // Steering, with the curve pulling you outward.
    const k = Math.min(1, this.speed / 20);
    this.px += p.x * 9 * k * dt;
    this.px -= curveAt(this.pos, this.phase) * this.speed * this.speed * 0.016 * dt;
    this.px = Math.max(-HALF - 3, Math.min(HALF + 3, this.px));
    // Checkpoints.
    if (Math.floor(this.pos / CHECK_EVERY) > Math.floor(was / CHECK_EVERY)) {
      this.checkpoints++;
      this.timeLeft += checkpointBonus(this.checkpoints);
      this.score += 1000;
      this.cpBanner = 2;
      this.sfx('fanfare', 0.9);
    }
    // Traffic and chips.
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.5 + this.rng.next() * 0.8;
      let n = 0;
      for (let i = 0; i < MAX_CARS; i++) n += this.carOn[i];
      if (n < this.density()) this.spawnCar();
      if (this.rng.next() < 0.35) this.spawnChip();
    }
    for (let i = 0; i < MAX_CARS; i++) {
      if (!this.carOn[i]) continue;
      this.carZ[i] += this.carV[i] * dt;
      const d = this.carZ[i] - this.pos;
      if (d < -12 || d > 260) {
        this.carOn[i] = 0;
        continue;
      }
      const dx = Math.abs(this.carX[i] - this.px);
      if (d > -0.5 && d < 3.2 && dx < 1.7 && this.spin <= 0) {
        // Crash: spin out, the car shoots off ahead.
        this.spin = 1.1;
        this.speed *= 0.3;
        this.carZ[i] = this.pos + 14;
        this.carPassed[i] = 1;
        this.sfx('crash', 1);
      } else if (!this.carPassed[i] && d < -0.5) {
        this.carPassed[i] = 1;
        if (dx < 3 && this.speed > 40) {
          this.closeCalls++;
          this.score += 100;
          this.closeT = 1;
          this.sfx('whoosh', 0.8);
        }
      }
    }
    for (let i = 0; i < MAX_CHIPS; i++) {
      if (!this.chipOn[i]) continue;
      const d = this.chipZ[i] - this.pos;
      if (d < -3) {
        this.chipOn[i] = 0;
        continue;
      }
      if (d < 2 && Math.abs(this.chipX[i] - this.px) < 1.6) {
        this.chipOn[i] = 0;
        this.chips++;
        this.score += 250;
        this.nitro = Math.min(1, this.nitro + 0.25);
        this.sfx('pickup', 0.8);
      }
    }
    if (out && this.speed < 0.5) {
      this.endT += dt;
      if (this.endT > 1) {
        this.over = true;
        this.sfx('over', 1);
      }
    }
  }

  private spawnCar() {
    for (let i = 0; i < MAX_CARS; i++) {
      if (this.carOn[i]) continue;
      const lane = this.rng.int(4);
      // Don't stack two cars on one spot.
      for (let j = 0; j < MAX_CARS; j++) if (this.carOn[j] && this.carX[j] === LANES[lane] && Math.abs(this.carZ[j] - this.pos - 220) < 30) return;
      this.carOn[i] = 1;
      this.carX[i] = LANES[lane];
      this.carZ[i] = this.pos + 200 + this.rng.next() * 50;
      this.carV[i] = 22 + this.rng.next() * 18;
      this.carC[i] = this.rng.int(4);
      this.carPassed[i] = 0;
      return;
    }
  }

  private spawnChip() {
    for (let i = 0; i < MAX_CHIPS; i++) {
      if (this.chipOn[i]) continue;
      this.chipOn[i] = 1;
      this.chipX[i] = LANES[this.rng.int(4)];
      this.chipZ[i] = this.pos + 180 + this.rng.next() * 60;
      return;
    }
  }

  // ---------------------------------------------------------------------------
  private art: { sky: HTMLCanvasElement; city: HTMLCanvasElement; me: HTMLCanvasElement; cars: HTMLCanvasElement[]; palm: HTMLCanvasElement; signs: HTMLCanvasElement[]; chip: HTMLCanvasElement } | null = null;
  private sprites() {
    if (this.art) return this.art;
    const r = new Rng(99);
    const sky = sprite(SCREEN_W, HZ + 2, (g) => {
      const gr = g.createLinearGradient(0, 0, 0, HZ);
      gr.addColorStop(0, '#0a0420');
      gr.addColorStop(0.6, '#3b1150');
      gr.addColorStop(1, '#ff6a3d');
      g.fillStyle = gr;
      g.fillRect(0, 0, SCREEN_W, HZ + 2);
      g.fillStyle = '#ffffff';
      for (let k = 0; k < 40; k++) g.fillRect(r.int(SCREEN_W), r.int(60), 1, 1);
      // A big low moon.
      g.fillStyle = '#ffd8a8';
      g.globalAlpha = 0.85;
      g.beginPath();
      g.arc(250, 46, 16, 0, Math.PI * 2);
      g.fill();
    });
    const city = sprite(640, 60, (g) => {
      for (let x = 0; x < 640; ) {
        const w = 10 + r.int(22),
          h = 12 + r.int(46);
        g.fillStyle = r.chance(0.5) ? '#140822' : '#1d0c2e';
        g.fillRect(x, 60 - h, w, h);
        g.fillStyle = r.chance(0.3) ? '#ff5ab4' : r.chance(0.5) ? '#ffd34d' : '#3ad8ff';
        for (let wy = 60 - h + 3; wy < 58; wy += 4) for (let wx = x + 2; wx < x + w - 2; wx += 3) if (r.chance(0.35)) g.fillRect(wx, wy, 1, 2);
        if (h > 44 && r.chance(0.6)) {
          g.fillStyle = '#ff3864';
          g.fillRect(x + (w >> 1), 60 - h - 4, 1, 4);
        }
        x += w + r.int(3);
      }
    });
    const car = (body: string, roof: string) =>
      sprite(48, 26, (g) => {
        g.fillStyle = '#000000';
        g.globalAlpha = 0.45;
        g.fillRect(3, 22, 42, 4);
        g.globalAlpha = 1;
        g.fillStyle = body;
        g.fillRect(2, 10, 44, 12);
        g.fillStyle = roof;
        g.fillRect(9, 2, 30, 10);
        g.fillStyle = '#1a2236';
        g.fillRect(11, 4, 26, 6);
        g.fillStyle = '#ff2a3a';
        g.fillRect(4, 13, 8, 3);
        g.fillRect(36, 13, 8, 3);
        g.fillStyle = '#ffb3b8';
        g.fillRect(5, 13, 3, 1);
        g.fillRect(40, 13, 3, 1);
        g.fillStyle = '#d9d9e0';
        g.fillRect(18, 16, 12, 3);
        g.fillStyle = '#0a0a10';
        g.fillRect(4, 22, 8, 3);
        g.fillRect(36, 22, 8, 3);
      });
    const me = sprite(64, 32, (g) => {
      // The player's coupe: low and wide, a glowing underbody.
      g.fillStyle = '#ff5ab4';
      g.globalAlpha = 0.35;
      g.fillRect(2, 27, 60, 5);
      g.globalAlpha = 1;
      g.fillStyle = '#1b1430';
      g.fillRect(2, 14, 60, 14);
      g.fillStyle = '#2b2150';
      g.fillRect(4, 12, 56, 6);
      g.fillStyle = '#3ad8ff';
      g.fillRect(14, 4, 36, 10);
      g.fillStyle = '#0c1a2a';
      g.fillRect(16, 6, 32, 6);
      g.fillStyle = '#3ad8ff';
      g.fillRect(4, 16, 56, 1);
      g.fillStyle = '#ff2a3a';
      g.fillRect(5, 19, 14, 3);
      g.fillRect(45, 19, 14, 3);
      g.fillStyle = '#ffd34d';
      g.fillRect(26, 21, 12, 3);
      g.fillStyle = '#05050a';
      g.fillRect(4, 27, 12, 4);
      g.fillRect(48, 27, 12, 4);
    });
    const palm = sprite(40, 70, (g) => {
      // A palm lit by the neon: dark trunk with a pink edge, teal fronds.
      for (let y = 20; y < 70; y++) {
        const x = 19 + Math.round(Math.sin(y / 14) * 2);
        g.fillStyle = '#3a1c40';
        g.fillRect(x, y, 3, 1);
        g.fillStyle = '#ff5ab4';
        g.fillRect(x + 3, y, 1, 1);
      }
      g.strokeStyle = '#1f8a6a';
      g.lineWidth = 3;
      for (let k = 0; k < 7; k++) {
        const a = -Math.PI + (k / 6) * Math.PI;
        g.beginPath();
        g.moveTo(20, 20);
        g.quadraticCurveTo(20 + Math.cos(a) * 12, 10 + Math.sin(a) * 6, 20 + Math.cos(a) * 19, 22 + Math.abs(Math.cos(a)) * 6);
        g.stroke();
      }
    });
    const SIGN_WORDS: [string, string][] = [
      ['LUCKY', '#ff5ab4'],
      ['MOTEL', '#3ad8ff'],
      ['24 HR', '#ffd34d'],
      ['CHAPEL', '#ff8a3d'],
      ['BUFFET', '#7dff5a'],
      ['LAGO', '#ffd34d'],
    ];
    const signs = SIGN_WORDS.map(([w, c]) =>
      sprite(48, 56, (g) => {
        g.fillStyle = '#20122a';
        g.fillRect(22, 20, 4, 36);
        g.fillStyle = '#0d0612';
        g.fillRect(2, 2, 44, 20);
        g.strokeStyle = c;
        g.lineWidth = 1;
        g.strokeRect(2.5, 2.5, 43, 19);
        g.fillStyle = c;
        g.globalAlpha = 0.25;
        g.fillRect(0, 0, 48, 24);
        g.globalAlpha = 1;
        text(g, w, 24, 9, c, 1, 'center');
        for (let k = 0; k < 8; k++) g.fillRect(4 + k * 5.5, 4, 2, 1);
      }),
    );
    const chip = sprite(16, 16, (g) => {
      g.fillStyle = '#7a5200';
      g.beginPath();
      g.arc(8, 8, 7.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffd34d';
      g.beginPath();
      g.arc(8, 8, 6.2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffffff';
      for (let k = 0; k < 6; k++) g.fillRect(8 + Math.cos((k / 6) * Math.PI * 2) * 5 - 1, 8 + Math.sin((k / 6) * Math.PI * 2) * 5 - 1, 2, 2);
    });
    const cars = [car('#ffd34d', '#e0b020'), car('#e8e8f0', '#b8b8c8'), car('#d8262e', '#a01018'), car('#3d6bd6', '#2a4ca0')];
    return (this.art = { sky, city, me, cars, palm, signs, chip });
  }

  /** Screen x of a world lateral position at distance d (and the row and scale). */
  private projX(x: number, d: number, cur: number) {
    const s = SCALE_K / d;
    return 160 + ((cur * d * d) / 2 - this.px + x) * s;
  }

  private drawRoad(g: CanvasRenderingContext2D, t: number, pos: number, cur: number) {
    const a = this.sprites();
    g.drawImage(a.sky, 0, 0);
    // The skyline slides against the curve.
    const off = ((((cur * 20000 + pos * 0.002) % 640) + 640) % 640) | 0;
    g.drawImage(a.city, -off, HZ - 58);
    g.drawImage(a.city, 640 - off, HZ - 58);
    // Ground.
    g.fillStyle = '#150a1e';
    g.fillRect(0, HZ, SCREEN_W, SCREEN_H - HZ);
    for (let y = HZ + 1; y < SCREEN_H; y++) {
      const d = ROW_K / (y - HZ);
      const z = pos + d;
      const cx = this.projX(0, d, cur);
      const hw = HALF * (SCALE_K / d);
      const band = Math.floor(z / 6) % 2 === 0;
      // Shoulder glow, rumble strips, the road, lane lines.
      g.fillStyle = band ? '#24112e' : '#1b0c24';
      g.fillRect(0, y, SCREEN_W, 1);
      g.fillStyle = band ? '#ff5ab4' : '#f4efe4';
      g.fillRect((cx - hw * 1.08) | 0, y, (hw * 2.16) | 0, 1);
      // Streetlight pools every 30 m.
      const lit = (z % 30) / 30;
      g.fillStyle = lit < 0.25 ? '#3a3448' : band ? '#2a2638' : '#25212f';
      g.fillRect((cx - hw) | 0, y, (hw * 2) | 0, 1);
      if (Math.floor(z / 4) % 2 === 0) {
        g.fillStyle = '#d8d0e8';
        const lw = Math.max(1, hw * 0.025);
        for (let l = -1; l <= 1; l++) g.fillRect((cx + l * hw * 0.5 - lw / 2) | 0, y, lw | 0 || 1, 1);
      }
      if (this.cpOnRow(z)) {
        g.fillStyle = Math.floor(t * 8) % 2 ? '#ffffff' : '#ffd34d';
        g.fillRect((cx - hw) | 0, y, (hw * 2) | 0, 1);
      }
    }
    // Roadside palms and signs, far to near.
    const step = 36;
    const first = Math.ceil((pos + 160) / step) * step;
    for (let z = first; z > pos + 2; z -= step) {
      const d = z - pos;
      const idx = Math.round(z / step);
      const side = idx % 2 ? 1 : -1;
      const sign = idx % 5 === 0;
      const img = sign ? a.signs[Math.abs(idx / 5) % a.signs.length | 0] : a.palm;
      const s = (SCALE_K / d) * (sign ? 0.14 : 0.16);
      const x = this.projX(side * (HALF + 3.5), d, cur);
      const y = HZ + ROW_K / d;
      const w = img.width * s,
        h = img.height * s;
      if (w < 1) continue;
      g.drawImage(img, x - w / 2, y - h, w, h);
    }
  }

  private cpOnRow(z: number) {
    const m = z % CHECK_EVERY;
    return m < 2;
  }

  draw(g: CanvasRenderingContext2D, t: number) {
    const a = this.sprites();
    const cur = curveAt(this.pos, this.phase);
    this.drawRoad(g, t, this.pos, cur);
    // Things on the road, far to near (simple: sort by drawing chips first then cars by distance buckets).
    for (let i = 0; i < MAX_CHIPS; i++) {
      if (!this.chipOn[i]) continue;
      const d = this.chipZ[i] - this.pos;
      if (d < 1 || d > 170) continue;
      const s = (SCALE_K / d) * 0.12;
      const x = this.projX(this.chipX[i], d, cur),
        y = HZ + ROW_K / d - 16 * s - Math.abs(Math.sin(t * 4 + i)) * 6 * s;
      const w = 16 * s * (0.4 + 0.6 * Math.abs(Math.cos(t * 3 + i)));
      g.drawImage(a.chip, x - w / 2, y, w, 16 * s);
    }
    for (let pass = 0; pass < 3; pass++) {
      // Three depth bands so near cars draw over far ones.
      for (let i = 0; i < MAX_CARS; i++) {
        if (!this.carOn[i]) continue;
        const d = this.carZ[i] - this.pos;
        if (d < 1 || d > 200) continue;
        const band = d > 80 ? 0 : d > 30 ? 1 : 2;
        if (band !== pass) continue;
        const s = (SCALE_K / d) * 0.07;
        const x = this.projX(this.carX[i], d, cur),
          y = HZ + ROW_K / d;
        g.drawImage(a.cars[this.carC[i]], x - 24 * s, y - 26 * s, 48 * s, 26 * s);
      }
    }
    // You.
    const wob = this.spin > 0 ? Math.sin(this.spin * 30) * 6 : 0;
    const bump = this.speed > 5 ? Math.round(Math.sin(t * 40) * 0.6) : 0;
    g.save();
    g.translate(160, 214 + bump);
    if (this.spin > 0) g.rotate(Math.sin(this.spin * 14) * 0.25);
    g.drawImage(a.me, -32 + wob, -16);
    if (this.boosting) {
      g.fillStyle = Math.floor(t * 30) % 2 ? '#3ad8ff' : '#ffffff';
      g.fillRect(-20 + wob, 13, 6, 3 + Math.floor(t * 50) % 4);
      g.fillRect(14 + wob, 13, 6, 3 + Math.floor(t * 50) % 4);
    }
    g.restore();
    this.hud(g, t);
  }

  private hud(g: CanvasRenderingContext2D, t: number) {
    g.fillStyle = '#000000';
    g.globalAlpha = 0.45;
    g.fillRect(0, 0, SCREEN_W, 22);
    g.globalAlpha = 1;
    text(g, 'TIME', 160, 2, '#ffb03a', 1, 'center');
    const low = this.timeLeft < 10 && Math.floor(t * 4) % 2 === 0;
    num(g, Math.ceil(this.timeLeft), 160, 10, low ? '#ff3864' : '#ffffff', 2, 'center');
    text(g, 'SCORE', 4, 3, '#ff5ab4');
    num(g, this.score, 4, 12, '#ffffff');
    text(g, 'MPH', 316, 3, '#3ad8ff', 1, 'right');
    num(g, this.mph, 316, 12, '#ffffff', 1, 'right');
    // Nitro gauge.
    text(g, 'NITRO', 4, 226, '#3ad8ff');
    g.fillStyle = '#0d1a26';
    g.fillRect(38, 226, 60, 7);
    g.fillStyle = this.boosting ? '#ffffff' : '#3ad8ff';
    g.fillRect(38, 226, Math.round(60 * this.nitro), 7);
    text(g, 'KM', 316, 226, '#ffb03a', 1, 'right');
    num(g, Math.floor(this.pos / 100) % 10, 300, 226, '#ffffff', 1, 'right');
    text(g, '.', 290, 226, '#ffffff');
    num(g, Math.floor(this.pos / 1000), 290, 226, '#ffffff', 1, 'right');
    if (this.cpBanner > 0) shadowText(g, 'CHECKPOINT', 160, 60, '#ffd34d', 2, 'center'), text(g, 'EXTENDED TIME', 160, 80, '#ffffff', 1, 'center');
    else if (this.closeT > 0) shadowText(g, 'CLOSE CALL', 160, 60, '#3ad8ff', 2, 'center');
    if (this.timeLeft <= 0 && !this.over) shadowText(g, 'TIME UP', 160, 110, '#ff3864', 3, 'center');
  }

  attract(g: CanvasRenderingContext2D, t: number) {
    const a = this.sprites();
    const pos = t * 40;
    const cur = curveAt(pos, 2);
    this.px = Math.sin(t * 0.5) * 2;
    this.drawRoad(g, t, pos, cur);
    g.drawImage(a.me, 160 - 32, 198);
  }

  snap(o: number[]) {
    o.length = 0;
    o.push(this.score, Math.round(this.pos), Math.round(this.speed * 10), Math.round(this.px * 100), Math.round(this.timeLeft * 10), Math.round(this.nitro * 100), this.spin > 0 ? 1 : 0, this.boosting ? 1 : 0, Math.round(this.cpBanner * 10), Math.round(this.closeT * 10), Math.round(this.phase * 1000), this.over ? 1 : 0);
    let n = 0;
    const at = o.length;
    o.push(0);
    for (let i = 0; i < MAX_CARS; i++) if (this.carOn[i]) o.push(Math.round(this.carZ[i] * 10), Math.round(this.carX[i] * 10), this.carC[i]), n++;
    o[at] = n;
    for (let i = 0; i < MAX_CHIPS; i++) if (this.chipOn[i]) o.push(Math.round(this.chipZ[i] * 10), Math.round(this.chipX[i] * 10));
  }

  load(a: readonly number[]) {
    let k = 0;
    const r = () => Number(a[k++]) || 0;
    this.score = r();
    this.pos = r();
    this.speed = r() / 10;
    this.px = r() / 100;
    this.timeLeft = r() / 10;
    this.nitro = r() / 100;
    this.spin = r() ? 0.5 : 0;
    this.boosting = r() === 1;
    this.cpBanner = r() / 10;
    this.closeT = r() / 10;
    this.phase = r() / 1000;
    this.over = r() === 1;
    this.carOn.fill(0);
    const n = Math.min(MAX_CARS, r());
    for (let i = 0; i < n; i++) {
      this.carOn[i] = 1;
      this.carZ[i] = r() / 10;
      this.carX[i] = r() / 10;
      this.carC[i] = r() & 3;
    }
    this.chipOn.fill(0);
    for (let i = 0; i < MAX_CHIPS && k + 1 < a.length; i++) {
      this.chipOn[i] = 1;
      this.chipZ[i] = r() / 10;
      this.chipX[i] = r() / 10;
    }
  }
}
