import * as THREE from 'three';

/**
 * Procedural textures, drawn on canvases at startup. They stand in for the
 * purchased/baked art until the asset pipeline lands, and keep the download tiny.
 */

export function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

const baseTextures = new WeakMap<HTMLCanvasElement, THREE.CanvasTexture>();

export function toTexture(c: HTMLCanvasElement, opts: { repeat?: number; srgb?: boolean; aniso?: number } = {}) {
  // Textures made from the same canvas share one GPU upload (clone keeps the source).
  const base = baseTextures.get(c);
  const t = base ? (base.clone() as THREE.CanvasTexture) : new THREE.CanvasTexture(c);
  if (!base) baseTextures.set(c, t);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(opts.repeat, opts.repeat);
  }
  t.anisotropy = opts.aniso ?? 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// --- Noise --------------------------------------------------------------------

function makeNoise(seed: number) {
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  let s = seed;
  for (let i = 255; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h: number) => (h / 255) * 2 - 1;
  const fade = (t: number) => t * t * (3 - 2 * t);
  /** Tileable value noise with the given integer period. */
  return (x: number, y: number, period: number) => {
    const xi = Math.floor(x),
      yi = Math.floor(y);
    const xf = x - xi,
      yf = y - yi;
    const x0 = ((xi % period) + period) % period,
      y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period,
      y1 = (y0 + 1) % period;
    const v = (a: number, b: number) => grad(perm[perm[a] + b]);
    const u = fade(xf),
      w = fade(yf);
    const a = v(x0, y0) + (v(x1, y0) - v(x0, y0)) * u;
    const b = v(x0, y1) + (v(x1, y1) - v(x0, y1)) * u;
    return a + (b - a) * w;
  };
}

function fbm(noise: ReturnType<typeof makeNoise>, x: number, y: number, base: number, oct: number) {
  let sum = 0,
    amp = 0.5,
    f = 1;
  for (let o = 0; o < oct; o++) {
    sum += amp * noise(x * f, y * f, base * f);
    amp *= 0.5;
    f *= 2;
  }
  return sum;
}

/** Cream or honey marble with soft veins. Tileable. */
const memo = new Map<string, HTMLCanvasElement>();
function cached(key: string, make: () => HTMLCanvasElement) {
  let c = memo.get(key);
  if (!c) memo.set(key, (c = make()));
  return c;
}

export function marble(size: number, tone: 'cream' | 'honey' | 'dark', seed = 1): HTMLCanvasElement {
  return cached(`marble-${size}-${tone}-${seed}`, () => marbleRaw(size, tone, seed));
}

function marbleRaw(size: number, tone: 'cream' | 'honey' | 'dark', seed = 1): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size);
  const n = makeNoise(seed);
  const base =
    tone === 'cream' ? [236, 226, 208] : tone === 'honey' ? [206, 168, 112] : [70, 38, 34];
  const vein = tone === 'cream' ? [168, 146, 120] : tone === 'honey' ? [140, 98, 52] : [196, 160, 110];
  const scale = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * scale,
        v = (y / size) * scale;
      const warp = fbm(n, u, v, scale, 4);
      const veinV = Math.abs(Math.sin((u + v * 0.6) * 3.2 + warp * 6));
      const t = Math.pow(1 - veinV, 10) * 0.85;
      const cloud = fbm(n, u * 2 + 9, v * 2 + 3, scale * 2, 3) * 0.12;
      const i = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) {
        img.data[i + k] = Math.max(0, Math.min(255, base[k] * (1 + cloud) * (1 - t) + vein[k] * t));
      }
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** One 1.5 m floor tile: cream field, honey border, dark inlay and a gold star. */
export function floorTile(size: number): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const cream = marble(size, 'cream', 3);
  const honey = marble(size / 2, 'honey', 5);
  ctx.drawImage(cream, 0, 0);
  const b = size * 0.06;
  ctx.save();
  ctx.fillStyle = ctx.createPattern(honey, 'repeat')!;
  ctx.fillRect(0, 0, size, b);
  ctx.fillRect(0, size - b, size, b);
  ctx.fillRect(0, 0, b, size);
  ctx.fillRect(size - b, 0, b, size);
  ctx.restore();
  // Thin dark grout and a gold inlay line.
  ctx.strokeStyle = 'rgba(60,40,30,0.55)';
  ctx.lineWidth = size * 0.004;
  ctx.strokeRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(176,134,60,0.9)';
  ctx.lineWidth = size * 0.006;
  ctx.strokeRect(b, b, size - 2 * b, size - 2 * b);
  // Centre compass star.
  const cx = size / 2,
    r = size * 0.17;
  ctx.save();
  ctx.translate(cx, cx);
  for (let i = 0; i < 8; i++) {
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(r * (i % 2 ? 0.55 : 1), 0);
    ctx.lineTo(r * 0.16, r * 0.16);
    ctx.closePath();
    ctx.fillStyle = i % 2 ? 'rgba(120,70,50,0.85)' : 'rgba(196,156,84,0.92)';
    ctx.fill();
  }
  ctx.restore();
  return c;
}

/** Ornate floral casino carpet: burgundy ground, gold scrolls, coral and amber blooms. */
export function carpet(size: number): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  ctx.fillStyle = '#4a0f1c';
  ctx.fillRect(0, 0, size, size);
  const cells = 4;
  const cs = size / cells;
  // Lattice of gold scroll diamonds.
  ctx.strokeStyle = '#a9822f';
  ctx.lineWidth = size * 0.006;
  for (let i = -1; i <= cells; i++) {
    for (let j = -1; j <= cells; j++) {
      const x = i * cs + cs / 2,
        y = j * cs + cs / 2;
      ctx.beginPath();
      ctx.moveTo(x, y - cs / 2);
      ctx.quadraticCurveTo(x + cs * 0.15, y, x + cs / 2, y);
      ctx.quadraticCurveTo(x, y + cs * 0.15, x, y + cs / 2);
      ctx.quadraticCurveTo(x - cs * 0.15, y, x - cs / 2, y);
      ctx.quadraticCurveTo(x, y - cs * 0.15, x, y - cs / 2);
      ctx.stroke();
    }
  }
  const bloom = (x: number, y: number, r: number, petal: string, center: string) => {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.42, r * 0.2, a, 0, Math.PI * 2);
      ctx.fillStyle = petal;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, r * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = center;
    ctx.fill();
  };
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const x = i * cs + cs / 2,
        y = j * cs + cs / 2;
      bloom(x, y, cs * 0.22, (i + j) % 2 ? '#d9674e' : '#e3a44a', '#f4dc8c');
      bloom(i * cs, j * cs, cs * 0.12, '#7a2d6b', '#e8c46a');
      // Leaves.
      ctx.fillStyle = '#2f5a3a';
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(a) * cs * 0.3, y + Math.sin(a) * cs * 0.3, cs * 0.08, cs * 0.03, a, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // Fibre noise so it doesn't read as flat print.
  const img = ctx.getImageData(0, 0, size, size);
  let s = 7;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 16807) % 2147483647;
    const f = 0.88 + (s / 2147483647) * 0.2;
    img.data[i] *= f;
    img.data[i + 1] *= f;
    img.data[i + 2] *= f;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Dark mahogany with grain, for table rails and cabinet trim. */
export function wood(size: number): HTMLCanvasElement {
  return cached(`wood-${size}`, () => woodRaw(size));
}

function woodRaw(size: number): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size);
  const n = makeNoise(17);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size;
      const g = Math.sin((v * 90 + fbm(n, u * 4, v * 4, 4, 4) * 5) * Math.PI);
      const t = 0.5 + 0.5 * g;
      const fine = fbm(n, u * 64, v * 8, 64, 2) * 0.15;
      const i = (y * size + x) * 4;
      img.data[i] = (46 + 22 * t) * (1 + fine);
      img.data[i + 1] = (20 + 9 * t) * (1 + fine);
      img.data[i + 2] = (12 + 5 * t) * (1 + fine);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Soft radial gradient, used for light glows and contact shadows. */
export function radial(size: number, inner: string, outer: string): HTMLCanvasElement {
  return cached(`radial-${size}-${inner}-${outer}`, () => radialRaw(size, inner, outer));
}

function radialRaw(size: number, inner: string, outer: string): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

/** Warm cream wall with a damask pattern. */
export function damask(size: number): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  ctx.fillStyle = '#e9dcc0';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(190,160,100,0.35)';
  const motif = (x: number, y: number, s: number) => {
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.bezierCurveTo(x + s * 0.8, y - s * 0.6, x + s * 0.5, y + s * 0.2, x, y + s);
    ctx.bezierCurveTo(x - s * 0.5, y + s * 0.2, x - s * 0.8, y - s * 0.6, x, y - s);
    ctx.fill();
  };
  const s = size / 4;
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) motif(i * s + ((j % 2) * s) / 2, j * s, s * 0.3);
  return c;
}

/** Night view over a lake, seen through the big windows. */
export function lakeView(w: number, h: number): HTMLCanvasElement {
  const [c, ctx] = canvas(w, h);
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.55);
  sky.addColorStop(0, '#060a1c');
  sky.addColorStop(1, '#27305a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.55);
  // Distant skyline.
  let s = 3;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let x = 0; x < w; ) {
    const bw = 20 + rnd() * 60,
      bh = 30 + rnd() * h * 0.28;
    ctx.fillStyle = '#0d1126';
    ctx.fillRect(x, h * 0.55 - bh, bw, bh);
    for (let k = 0; k < bh / 9; k++) {
      if (rnd() < 0.5) {
        ctx.fillStyle = rnd() < 0.3 ? '#f7d18a' : '#e2a85a';
        ctx.fillRect(x + 3 + rnd() * (bw - 6), h * 0.55 - bh + k * 9 + 3, 3, 2);
      }
    }
    x += bw + 2;
  }
  const lake = ctx.createLinearGradient(0, h * 0.55, 0, h);
  lake.addColorStop(0, '#152048');
  lake.addColorStop(1, '#070b1d');
  ctx.fillStyle = lake;
  ctx.fillRect(0, h * 0.55, w, h * 0.45);
  for (let k = 0; k < 400; k++) {
    ctx.fillStyle = `rgba(255,${190 + rnd() * 50},120,${0.1 + rnd() * 0.25})`;
    ctx.fillRect(rnd() * w, h * 0.56 + rnd() * h * 0.4, 8 + rnd() * 30, 1);
  }
  return c;
}

/** Chip denominations and their standard Vegas colours. */
export const CHIP_DENOMS = [1, 5, 25, 100, 500, 1000, 5000] as const;
export type ChipDenom = (typeof CHIP_DENOMS)[number];
export const CHIP_COLORS: Record<ChipDenom, [string, string]> = {
  1: ['#f2f0ea', '#2a4f9e'],
  5: ['#c0262d', '#f2f0ea'],
  25: ['#1e7a3a', '#f2f0ea'],
  100: ['#1b1b1f', '#f2f0ea'],
  500: ['#6b2f8f', '#f2d36b'],
  1000: ['#e4b833', '#1b1b1f'],
  5000: ['#8a4f22', '#f2f0ea'],
};

export const chipLabel = (d: number) => (d >= 1000 ? `${d / 1000}K` : String(d));

/** Chip face: base colour, edge inserts, inner ring and the value. */
export function chipFace(denom: ChipDenom, size = 256): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const [base, accent] = CHIP_COLORS[denom];
  const r = size / 2;
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = accent;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(r, r, r * 0.98, a - 0.16, a + 0.16);
    ctx.arc(r, r, r * 0.78, a + 0.16, a - 0.16, true);
    ctx.fill();
  }
  ctx.strokeStyle = accent;
  ctx.lineWidth = size * 0.02;
  ctx.setLineDash([size * 0.03, size * 0.02]);
  ctx.beginPath();
  ctx.arc(r, r, r * 0.66, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.arc(r, r, r * 0.58, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.font = `bold ${size * (denom >= 1000 ? 0.3 : 0.34)}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(chipLabel(denom), r, r * 1.04);
  return c;
}

/** Chip edge: base colour with accent stripes, wraps around the cylinder. */
export function chipEdge(denom: ChipDenom): HTMLCanvasElement {
  const [c, ctx] = canvas(256, 16);
  const [base, accent] = CHIP_COLORS[denom];
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 16);
  ctx.fillStyle = accent;
  for (let i = 0; i < 6; i++) ctx.fillRect(i * (256 / 6), 0, 14, 16);
  return c;
}

/** Splits an amount into chips, largest first. */
export function chipBreakdown(amount: number): ChipDenom[] {
  const out: ChipDenom[] = [];
  let left = Math.round(amount);
  for (let i = CHIP_DENOMS.length - 1; i >= 0; i--) {
    const d = CHIP_DENOMS[i];
    while (left >= d && out.length < 40) {
      out.push(d);
      left -= d;
    }
  }
  return out;
}
