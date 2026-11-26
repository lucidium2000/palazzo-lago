/**
 * Small drawing helpers the cabinet games share: a starfield, a glow pass,
 * a CRT scanline overlay and a spark pool. Everything preallocated.
 */
import { Rng, SCREEN_H, SCREEN_W } from './types';

/** Fixed starfield (positions from a seed), drifting down at `speed` px/s. */
export class Stars {
  private x: Float32Array;
  private y: Float32Array;
  private z: Float32Array;
  constructor(n = 60, seed = 7) {
    const r = new Rng(seed);
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.z = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.x[i] = r.range(0, SCREEN_W);
      this.y[i] = r.range(0, SCREEN_H);
      this.z[i] = r.range(0.2, 1);
    }
  }
  draw(g: CanvasRenderingContext2D, t: number, speed = 20, color = '#ffffff') {
    g.fillStyle = color;
    for (let i = 0; i < this.x.length; i++) {
      const y = (this.y[i] + t * speed * this.z[i]) % SCREEN_H;
      g.globalAlpha = 0.25 + this.z[i] * 0.6;
      g.fillRect(this.x[i] | 0, y | 0, this.z[i] > 0.75 ? 2 : 1, 1);
    }
    g.globalAlpha = 1;
  }
}

/** Sparks for explosions and hits (pooled, no allocation). */
export class Sparks {
  readonly n: number;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  life: Float32Array;
  col: Uint8Array;
  private next = 0;
  constructor(
    n: number,
    readonly colors: string[],
  ) {
    this.n = n;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.life = new Float32Array(n);
    this.col = new Uint8Array(n);
  }
  burst(rng: Rng, x: number, y: number, count: number, speed: number, color: number, life = 0.6) {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      const a = rng.next() * Math.PI * 2,
        s = speed * (0.3 + rng.next() * 0.7);
      this.x[i] = x;
      this.y[i] = y;
      this.vx[i] = Math.cos(a) * s;
      this.vy[i] = Math.sin(a) * s;
      this.life[i] = life * (0.5 + rng.next() * 0.5);
      this.col[i] = color;
    }
  }
  step(dt: number, drag = 2.5, gravity = 0) {
    const k = Math.max(0, 1 - drag * dt);
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vx[i] *= k;
      this.vy[i] = this.vy[i] * k + gravity * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
    }
  }
  draw(g: CanvasRenderingContext2D, size = 2) {
    for (let i = 0; i < this.n; i++) {
      const l = this.life[i];
      if (l <= 0) continue;
      g.globalAlpha = l > 0.3 ? 1 : l / 0.3;
      g.fillStyle = this.colors[this.col[i]];
      g.fillRect(this.x[i] | 0, this.y[i] | 0, size, size);
    }
    g.globalAlpha = 1;
  }
  clear() {
    this.life.fill(0);
  }
}

let scan: HTMLCanvasElement | null = null;
/** CRT scanlines and a soft vignette over the finished frame (one drawImage). */
export function crt(g: CanvasRenderingContext2D) {
  if (!scan) {
    scan = document.createElement('canvas');
    scan.width = SCREEN_W;
    scan.height = SCREEN_H;
    const s = scan.getContext('2d')!;
    s.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 1; y < SCREEN_H; y += 2) s.fillRect(0, y, SCREEN_W, 1);
    const v = s.createRadialGradient(SCREEN_W / 2, SCREEN_H / 2, SCREEN_H * 0.45, SCREEN_W / 2, SCREEN_H / 2, SCREEN_W * 0.72);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    s.fillStyle = v;
    s.fillRect(0, 0, SCREEN_W, SCREEN_H);
  }
  g.drawImage(scan, 0, 0);
}

/** A neon line: a wide dim stroke under a thin bright one. Call between beginPath and your path. */
export function neonStroke(g: CanvasRenderingContext2D, color: string, width = 1.5) {
  g.strokeStyle = color;
  g.globalAlpha = 0.28;
  g.lineWidth = width * 3;
  g.stroke();
  g.globalAlpha = 1;
  g.lineWidth = width;
  g.stroke();
}

/** A filled rectangle with a bright outline (UI boxes). */
export function panel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, line: string) {
  g.fillStyle = fill;
  g.fillRect(x, y, w, h);
  g.strokeStyle = line;
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

/** Pre-renders something once into an offscreen canvas (sprites). */
export function sprite(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  draw(g);
  return c;
}
