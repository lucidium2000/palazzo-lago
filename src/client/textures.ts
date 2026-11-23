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
export function floorTile(size: number, photo?: CanvasImageSource | null): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  let honey: HTMLCanvasElement;
  if (photo) {
    // Scanned marble for the field; a warm-tinted copy for the honey border.
    ctx.drawImage(photo, 0, 0, size, size);
    const [h, hx] = canvas(size / 2);
    hx.drawImage(photo, 0, 0, size / 2, size / 2);
    hx.globalCompositeOperation = 'multiply';
    hx.fillStyle = '#d9a35a';
    hx.fillRect(0, 0, size / 2, size / 2);
    honey = h;
  } else {
    ctx.drawImage(marble(size, 'cream', 3), 0, 0);
    honey = marble(size / 2, 'honey', 5);
  }
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
  // Bellagio-style floral: a dark wine ground, gilded acanthus scrolls, and
  // shaded blossoms in coral, saffron, teal and violet. One tile = 2.4 m.
  const [c, g] = canvas(size);
  g.fillStyle = '#2e0a12';
  g.fillRect(0, 0, size, size);
  const S = size;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Tone-on-tone ground damask.
  g.fillStyle = 'rgba(90,20,32,0.55)';
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      const x = (i + 0.5) * (S / 4) + ((j % 2) * S) / 8,
        y = (j + 0.5) * (S / 4);
      g.beginPath();
      g.ellipse(x, y, S * 0.06, S * 0.1, 0, 0, Math.PI * 2);
      g.fill();
    }
  // Scrolling vines (wrap around the tile edges so it repeats seamlessly).
  const wrap = (fn: (ox: number, oy: number) => void) => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(ox, oy);
  };
  const vine = (pts: number[][], w: number, col: string) =>
    wrap((ox, oy) => {
      g.strokeStyle = col;
      g.lineWidth = w;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(pts[0][0] * S + ox, pts[0][1] * S + oy);
      for (let k = 1; k + 2 < pts.length + 1; k += 3) {
        const [a1, b1, c1] = [pts[k], pts[k + 1], pts[k + 2]];
        if (!c1) break;
        g.bezierCurveTo(a1[0] * S + ox, a1[1] * S + oy, b1[0] * S + ox, b1[1] * S + oy, c1[0] * S + ox, c1[1] * S + oy);
      }
      g.stroke();
    });
  const paths = [
    [[0, 0.25], [0.2, 0.05], [0.3, 0.45], [0.5, 0.25], [0.7, 0.05], [0.8, 0.45], [1, 0.25]],
    [[0, 0.75], [0.2, 0.55], [0.3, 0.95], [0.5, 0.75], [0.7, 0.55], [0.8, 0.95], [1, 0.75]],
    [[0.25, 0], [0.05, 0.2], [0.45, 0.3], [0.25, 0.5], [0.05, 0.7], [0.45, 0.8], [0.25, 1]],
    [[0.75, 0], [0.55, 0.2], [0.95, 0.3], [0.75, 0.5], [0.55, 0.7], [0.95, 0.8], [0.75, 1]],
  ];
  for (const p of paths) {
    vine(p, S * 0.012, '#5c4a1c');
    vine(p, S * 0.006, '#b8913e');
  }
  // Acanthus leaves along the vines.
  const leaf = (x: number, y: number, a: number, l: number) =>
    wrap((ox, oy) => {
      g.save();
      g.translate(x + ox, y + oy);
      g.rotate(a);
      const grd = g.createLinearGradient(0, 0, l, 0);
      grd.addColorStop(0, '#3f5a2a');
      grd.addColorStop(1, '#8aa055');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(l * 0.5, -l * 0.35, l, 0);
      g.quadraticCurveTo(l * 0.5, l * 0.2, 0, 0);
      g.fill();
      g.restore();
    });
  for (let k = 0; k < 40; k++) leaf(rnd() * S, rnd() * S, rnd() * 6.28, S * (0.03 + rnd() * 0.03));
  // Shaded blossoms.
  const blossom = (x: number, y: number, r: number, cols: string[], petals: number) =>
    wrap((ox, oy) => {
      const cx = x + ox,
        cy = y + oy;
      for (let ring = 0; ring < 3; ring++) {
        const rr = r * (1 - ring * 0.3);
        for (let k = 0; k < petals; k++) {
          const a = (k / petals) * Math.PI * 2 + ring * 0.3;
          const px = cx + Math.cos(a) * rr * 0.5,
            py = cy + Math.sin(a) * rr * 0.5;
          const grd = g.createRadialGradient(cx, cy, rr * 0.1, px, py, rr * 0.55);
          grd.addColorStop(0, cols[Math.min(2, ring + 1)]);
          grd.addColorStop(1, cols[ring]);
          g.fillStyle = grd;
          g.beginPath();
          g.ellipse(px, py, rr * 0.45, rr * 0.26, a, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.fillStyle = '#f2d27a';
      g.beginPath();
      g.arc(cx, cy, r * 0.14, 0, Math.PI * 2);
      g.fill();
    });
  const palettes = [
    ['#b8402e', '#e0704a', '#f5b48a'],
    ['#c58a1e', '#e8b444', '#fae3a0'],
    ['#1f6a6a', '#3a9a90', '#9fd6c6'],
    ['#5a2e7a', '#8a54a8', '#d2a8e0'],
    ['#a8304e', '#d65a78', '#f6b4c4'],
  ];
  const spots = [
    [0.25, 0.25, 0.09],
    [0.75, 0.75, 0.09],
    [0.75, 0.25, 0.07],
    [0.25, 0.75, 0.07],
    [0.5, 0.5, 0.05],
    [0, 0, 0.05],
    [0.5, 0, 0.04],
    [0, 0.5, 0.04],
  ];
  spots.forEach(([x, y, r], i) => blossom(x * S, y * S, r * S, palettes[i % palettes.length], i < 4 ? 8 : 6));
  for (let k = 0; k < 26; k++) blossom(rnd() * S, rnd() * S, S * (0.012 + rnd() * 0.012), palettes[k % palettes.length], 5);
  // Pile: fibre noise and a soft blur so it reads as woven wool.
  const img = g.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const f = 0.84 + rnd() * 0.24;
    img.data[i] *= f;
    img.data[i + 1] *= f;
    img.data[i + 2] *= f;
  }
  g.putImageData(img, 0, 0);
  const [c2, g2] = canvas(size);
  g2.filter = 'blur(0.6px)';
  g2.drawImage(c, 0, 0);
  return c2;
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
  // Champagne silk wall covering with a tone-on-tone damask medallion.
  const [c, g] = canvas(size);
  const bg = g.createLinearGradient(0, 0, size, 0);
  bg.addColorStop(0, '#d9c39a');
  bg.addColorStop(0.5, '#e6d3ad');
  bg.addColorStop(1, '#d9c39a');
  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);
  const S = size / 2;
  const medallion = (x: number, y: number, s: number) => {
    g.save();
    g.translate(x, y);
    g.fillStyle = 'rgba(160,118,60,0.15)';
    g.strokeStyle = 'rgba(150,110,55,0.22)';
    g.lineWidth = s * 0.03;
    for (const sx of [-1, 1]) {
      g.save();
      g.scale(sx, 1);
      g.beginPath();
      g.moveTo(0, -s);
      g.bezierCurveTo(s * 0.55, -s * 0.8, s * 0.2, -s * 0.35, s * 0.6, -s * 0.15);
      g.bezierCurveTo(s * 0.9, 0, s * 0.45, s * 0.5, s * 0.5, s * 0.7);
      g.bezierCurveTo(s * 0.3, s * 0.85, s * 0.1, s * 0.9, 0, s);
      g.lineTo(0, -s);
      g.fill();
      // Inner fronds.
      for (let k = 0; k < 4; k++) {
        g.beginPath();
        g.moveTo(0, -s * 0.6 + k * s * 0.35);
        g.quadraticCurveTo(s * 0.35, -s * 0.7 + k * s * 0.35, s * 0.42, -s * 0.4 + k * s * 0.35);
        g.stroke();
      }
      g.restore();
    }
    g.fillStyle = 'rgba(120,85,40,0.16)';
    g.beginPath();
    g.ellipse(0, 0, s * 0.16, s * 0.24, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) medallion(i * S, j * S, S * 0.38);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) medallion(i * S + S / 2, j * S + S / 2, S * 0.2);
  // Silk slub.
  const img = g.getImageData(0, 0, size, size);
  let sd = 3;
  for (let y = 0; y < size; y++) {
    sd = (sd * 16807) % 2147483647;
    const row = 0.97 + (sd / 2147483647) * 0.06;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      img.data[i] *= row;
      img.data[i + 1] *= row;
      img.data[i + 2] *= row;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Night view over a lake, seen through the big windows. */
export function lakeView(w: number, h: number): HTMLCanvasElement {
  const [c, ctx] = canvas(w, h);
  const H = h * 0.55; // horizon
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#03050f');
  sky.addColorStop(0.55, '#0b1230');
  sky.addColorStop(0.9, '#2a2a52');
  sky.addColorStop(1, '#4a3550');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, H);
  let s = 3;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  // Stars and a moon.
  for (let k = 0; k < 260; k++) {
    ctx.fillStyle = `rgba(255,255,255,${0.2 + rnd() * 0.6})`;
    ctx.fillRect(rnd() * w, rnd() * H * 0.6, 1 + (rnd() < 0.1 ? 1 : 0), 1);
  }
  const mx = w * 0.78,
    my = H * 0.18;
  const mg = ctx.createRadialGradient(mx, my, 4, mx, my, 70);
  mg.addColorStop(0, 'rgba(255,250,235,1)');
  mg.addColorStop(0.18, 'rgba(255,245,225,0.9)');
  mg.addColorStop(0.3, 'rgba(200,210,255,0.15)');
  mg.addColorStop(1, 'rgba(200,210,255,0)');
  ctx.fillStyle = mg;
  ctx.fillRect(mx - 70, my - 70, 140, 140);
  // Light haze over the city.
  const haze = ctx.createLinearGradient(0, H - h * 0.22, 0, H);
  haze.addColorStop(0, 'rgba(255,170,100,0)');
  haze.addColorStop(1, 'rgba(255,150,90,0.28)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, H - h * 0.22, w, h * 0.22);
  // Two rows of towers: far (dim, hazy) then near (taller, brighter windows, neon crowns).
  const towers: { x: number; bw: number; bh: number; neon: string | null }[] = [];
  for (const row of [0, 1]) {
    for (let x = rnd() * 20; x < w; ) {
      const bw = (row ? 26 : 16) + rnd() * (row ? 70 : 40);
      const bh = (row ? 40 : 30) + rnd() * h * (row ? 0.33 : 0.2) * (rnd() < 0.15 ? 1.6 : 1);
      const top = H - bh;
      ctx.fillStyle = row ? '#0a0d1e' : '#141a34';
      ctx.fillRect(x, top, bw, bh);
      // Window grid.
      const lit = row ? 0.55 : 0.35;
      for (let yy = top + 4; yy < H - 3; yy += row ? 7 : 6) {
        for (let xx = x + 3; xx < x + bw - 3; xx += row ? 5 : 4) {
          if (rnd() < lit) {
            const warm = rnd();
            ctx.fillStyle = warm < 0.55 ? `rgba(255,214,150,${row ? 0.9 : 0.5})` : warm < 0.85 ? `rgba(255,186,110,${row ? 0.8 : 0.45})` : `rgba(190,220,255,${row ? 0.7 : 0.4})`;
            ctx.fillRect(xx, yy, row ? 2 : 1.5, row ? 3 : 2);
          }
        }
      }
      let neon: string | null = null;
      if (row && rnd() < 0.3) {
        neon = ['#ff3a8a', '#3ad0ff', '#ffb03a', '#b06aff', '#4aff9a'][Math.floor(rnd() * 5)];
        ctx.fillStyle = neon;
        ctx.shadowColor = neon;
        ctx.shadowBlur = 14;
        ctx.fillRect(x, top - 3, bw, 3);
        if (rnd() < 0.5) {
          ctx.beginPath();
          ctx.moveTo(x + bw * 0.2, top - 3);
          ctx.lineTo(x + bw / 2, top - 3 - bw * 0.9);
          ctx.lineTo(x + bw * 0.8, top - 3);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      }
      towers.push({ x, bw, bh, neon });
      x += bw + (row ? 6 + rnd() * 18 : 1 + rnd() * 6);
    }
  }
  // The lake: dark water with long shimmering reflections of the lights.
  const lake = ctx.createLinearGradient(0, H, 0, h);
  lake.addColorStop(0, '#141a3a');
  lake.addColorStop(1, '#03050f');
  ctx.fillStyle = lake;
  ctx.fillRect(0, H, w, h - H);
  for (const t of towers) {
    const col = t.neon ?? 'rgba(255,196,120,1)';
    for (let k = 0; k < 3; k++) {
      const x = t.x + rnd() * t.bw;
      const len = (h - H) * (0.25 + rnd() * 0.6);
      for (let y = H + 1; y < H + len; y += 2) {
        const f = 1 - (y - H) / len;
        ctx.globalAlpha = f * (t.neon ? 0.5 : 0.28) * (0.5 + 0.5 * rnd());
        ctx.fillStyle = col;
        const wob = Math.sin(y * 0.4 + x) * 2;
        ctx.fillRect(x + wob - 1, y, 2 + rnd() * 3, 1);
      }
    }
  }
  ctx.globalAlpha = 1;
  // The moon's path on the water.
  for (let y = H + 2; y < h; y += 2) {
    const f = 1 - (y - H) / (h - H);
    ctx.fillStyle = `rgba(230,235,255,${0.18 * f})`;
    ctx.fillRect(mx - 6 - (1 - f) * 20 + Math.sin(y) * 4, y, 12 + (1 - f) * 40, 1);
  }
  return c;
}

/** Reflections of the city lights on the lake surface (emissive map for the water plane). */
export function lakeReflection(w: number, h: number): HTMLCanvasElement {
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);
  let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  // v = 1 (top of the canvas) is the far shore: streaks start there and fade toward you.
  for (let k = 0; k < 140; k++) {
    const x = rnd() * w;
    const neon = rnd() < 0.18;
    const col = neon ? ['#ff3a8a', '#3ad0ff', '#ffb03a', '#b06aff'][Math.floor(rnd() * 4)] : rnd() < 0.7 ? '#ffc888' : '#ffe0b0';
    const len = h * (0.15 + rnd() * 0.5);
    for (let y = 0; y < len; y += 2) {
      const f = 1 - y / len;
      ctx.globalAlpha = f * f * (neon ? 0.55 : 0.35) * (0.4 + 0.6 * rnd());
      ctx.fillStyle = col;
      ctx.fillRect(x + Math.sin(y * 0.3 + x) * 3, y, 2 + rnd() * 4, 1.5);
    }
  }
  ctx.globalAlpha = 1;
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
