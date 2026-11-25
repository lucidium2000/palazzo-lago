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
    hx.fillStyle = '#e6bd84';
    hx.fillRect(0, 0, size / 2, size / 2);
    honey = h;
  } else {
    ctx.drawImage(marble(size, 'cream', 3), 0, 0);
    honey = marble(size / 2, 'honey', 5);
  }
  const b = size * 0.04;
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
  ctx.strokeStyle = 'rgba(70,44,34,0.7)';
  ctx.lineWidth = size * 0.008;
  ctx.strokeRect(b, b, size - 2 * b, size - 2 * b);
  ctx.strokeStyle = 'rgba(196,152,70,0.95)';
  ctx.lineWidth = size * 0.003;
  ctx.strokeRect(b + size * 0.008, b + size * 0.008, size - 2 * b - size * 0.016, size - 2 * b - size * 0.016);
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
  // Classic Vegas casino floral. One tile = 2.4 m, half-drop: two big peonies (~55 cm) and two
  // lilies per tile on broad swirling teal ribbons edged in gold, over a deep wine ground with a
  // tone-on-tone damask. Bold, dark-outlined shapes read at a glance in VR (no confetti that
  // would shimmer); the woven relief comes from the scanned pile normal map.
  const [c, g] = canvas(size);
  const S = size;
  g.fillStyle = '#3c0a16';
  g.fillRect(0, 0, S, S);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const wrap = (fn: (ox: number, oy: number) => void) => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(ox, oy);
  };
  // Tone-on-tone ground: large damask lozenges.
  g.fillStyle = 'rgba(96,22,36,0.7)';
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      wrap((ox, oy) => {
        const x = (i + 0.5) * (S / 4) + ((j % 2) * S) / 8 + ox,
          y = (j + 0.5) * (S / 4) + oy;
        g.beginPath();
        g.moveTo(x, y - S * 0.1);
        g.quadraticCurveTo(x + S * 0.07, y, x, y + S * 0.1);
        g.quadraticCurveTo(x - S * 0.07, y, x, y - S * 0.1);
        g.fill();
      });
  // Broad swirling ribbons (S-curves that wrap seamlessly), dark-edged, gold-rimmed, teal with a sheen.
  const curve = (pts: number[][], ox: number, oy: number) => {
    g.beginPath();
    g.moveTo(pts[0][0] * S + ox, pts[0][1] * S + oy);
    for (let k = 1; k + 2 < pts.length + 1; k += 3) {
      const [a1, b1, c1] = [pts[k], pts[k + 1], pts[k + 2]];
      if (!c1) break;
      g.bezierCurveTo(a1[0] * S + ox, a1[1] * S + oy, b1[0] * S + ox, b1[1] * S + oy, c1[0] * S + ox, c1[1] * S + oy);
    }
  };
  const ribbons = [
    [[0, 0.5], [0.12, 0.32], [0.38, 0.68], [0.5, 0.5], [0.62, 0.32], [0.88, 0.68], [1, 0.5]],
    [[0.5, 0], [0.68, 0.12], [0.32, 0.38], [0.5, 0.5], [0.68, 0.62], [0.32, 0.88], [0.5, 1]],
  ];
  for (const [w, col] of [
    [0.05, '#14040a'],
    [0.042, '#c9973e'],
    [0.032, '#0f4a50'],
    [0.014, '#2f8a86'],
  ] as const)
    for (const p of ribbons)
      wrap((ox, oy) => {
        g.strokeStyle = col;
        g.lineWidth = S * w;
        g.lineCap = 'round';
        curve(p, ox, oy);
        g.stroke();
      });
  // Fine gold scroll tendrils curling off the ribbons.
  const tendril = (x: number, y: number, a: number, r: number) =>
    wrap((ox, oy) => {
      g.save();
      g.translate(x + ox, y + oy);
      g.rotate(a);
      g.strokeStyle = '#d6a84c';
      g.lineWidth = S * 0.006;
      g.beginPath();
      g.moveTo(0, 0);
      g.bezierCurveTo(r * 0.6, -r * 0.2, r, r * 0.3, r * 0.7, r * 0.6);
      g.bezierCurveTo(r * 0.5, r * 0.8, r * 0.3, r * 0.5, r * 0.5, r * 0.4);
      g.stroke();
      g.restore();
    });
  for (let k = 0; k < 20; k++) tendril(rnd() * S, rnd() * S, rnd() * 6.28, S * (0.04 + rnd() * 0.03));
  // Acanthus leaves, two-tone with a dark outline.
  const leaf = (x: number, y: number, a: number, l: number) =>
    wrap((ox, oy) => {
      g.save();
      g.translate(x + ox, y + oy);
      g.rotate(a);
      const grd = g.createLinearGradient(0, 0, l, 0);
      grd.addColorStop(0, '#24401c');
      grd.addColorStop(1, '#7c9a46');
      g.fillStyle = grd;
      g.strokeStyle = '#120806';
      g.lineWidth = S * 0.003;
      g.beginPath();
      g.moveTo(0, 0);
      g.bezierCurveTo(l * 0.3, -l * 0.42, l * 0.75, -l * 0.3, l, 0);
      g.bezierCurveTo(l * 0.7, l * 0.22, l * 0.3, l * 0.28, 0, 0);
      g.fill();
      g.stroke();
      g.strokeStyle = 'rgba(220,230,150,0.5)';
      g.beginPath();
      g.moveTo(l * 0.05, 0);
      g.quadraticCurveTo(l * 0.5, -l * 0.08, l * 0.9, 0);
      g.stroke();
      g.restore();
    });
  const blooms: [number, number, number][] = [
    [0.25, 0.25, 0.115],
    [0.75, 0.75, 0.115],
    [0.75, 0.25, 0.075],
    [0.25, 0.75, 0.075],
  ];
  for (const [x, y, r] of blooms)
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + x * 3;
      leaf(x * S + Math.cos(a) * r * S * 0.75, y * S + Math.sin(a) * r * S * 0.75, a, S * r * (0.9 + rnd() * 0.3));
    }
  // Big peonies: rings of ruffled, shaded petals, each outlined so the bloom stays crisp.
  const peony = (x: number, y: number, r: number, cols: string[]) =>
    wrap((ox, oy) => {
      const cx = x + ox,
        cy = y + oy;
      for (let ring = 0; ring < 4; ring++) {
        const rr = r * (1 - ring * 0.22);
        const n = 9 - ring;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + ring * 0.4;
          const px = cx + Math.cos(a) * rr * 0.52,
            py = cy + Math.sin(a) * rr * 0.52;
          const grd = g.createRadialGradient(cx, cy, rr * 0.05, px, py, rr * 0.6);
          grd.addColorStop(0, cols[Math.min(3, ring + 1)]);
          grd.addColorStop(1, cols[Math.min(3, ring)]);
          g.fillStyle = grd;
          g.strokeStyle = 'rgba(30,6,10,0.85)';
          g.lineWidth = S * 0.0025;
          g.beginPath();
          g.ellipse(px, py, rr * 0.5, rr * 0.3, a, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        }
      }
      g.fillStyle = '#f6d67a';
      g.beginPath();
      g.arc(cx, cy, r * 0.12, 0, Math.PI * 2);
      g.fill();
    });
  // Lilies: six pointed petals with a pale throat and gold stamens.
  const lily = (x: number, y: number, r: number, cols: string[]) =>
    wrap((ox, oy) => {
      const cx = x + ox,
        cy = y + oy;
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        g.save();
        g.translate(cx, cy);
        g.rotate(a);
        const grd = g.createLinearGradient(0, 0, r, 0);
        grd.addColorStop(0, cols[2]);
        grd.addColorStop(0.5, cols[1]);
        grd.addColorStop(1, cols[0]);
        g.fillStyle = grd;
        g.strokeStyle = 'rgba(30,6,10,0.85)';
        g.lineWidth = S * 0.0025;
        g.beginPath();
        g.moveTo(0, 0);
        g.quadraticCurveTo(r * 0.5, -r * 0.32, r, 0);
        g.quadraticCurveTo(r * 0.5, r * 0.32, 0, 0);
        g.fill();
        g.stroke();
        g.restore();
      }
      g.fillStyle = '#ffe08a';
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.5;
        g.beginPath();
        g.arc(cx + Math.cos(a) * r * 0.3, cy + Math.sin(a) * r * 0.3, r * 0.05, 0, Math.PI * 2);
        g.fill();
      }
    });
  peony(0.25 * S, 0.25 * S, 0.115 * S, ['#9a2a24', '#cf4c38', '#ec8a62', '#f8c49a']);
  peony(0.75 * S, 0.75 * S, 0.115 * S, ['#b07612', '#dca23a', '#f2cc6c', '#fbe8b0']);
  lily(0.75 * S, 0.25 * S, 0.075 * S, ['#5a2a7e', '#9a5ab8', '#f0d8f4']);
  lily(0.25 * S, 0.75 * S, 0.075 * S, ['#b02a58', '#de6a8e', '#fbd6e0']);
  // Small rosettes where the ribbons cross, and gold four-point sparkles.
  for (const [x, y] of [[0.5, 0.5], [0, 0], [0.5, 0], [0, 0.5]])
    peony(x * S, y * S, 0.038 * S, ['#0d4a5a', '#1f7a8a', '#5ab4b8', '#bfe6e0']);
  for (let k = 0; k < 14; k++) {
    const sx = rnd() * S,
      sy = rnd() * S;
    wrap((ox, oy) => {
      const x = sx + ox,
        y = sy + oy,
        r = S * 0.012;
      g.fillStyle = '#e8c068';
      g.beginPath();
      g.moveTo(x, y - r);
      g.quadraticCurveTo(x, y, x + r, y);
      g.quadraticCurveTo(x, y, x, y + r);
      g.quadraticCurveTo(x, y, x - r, y);
      g.quadraticCurveTo(x, y, x, y - r);
      g.fill();
    });
  }
  // Pile: fibre noise and a soft blur so it reads as woven wool.
  const img = g.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const f = 0.9 + rnd() * 0.18;
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

/**
 * Backlit honey onyx: translucent amber bands with cloudy depth and pale
 * crystalline veins. Used as an emissive map so it glows like lit stone.
 */
export function onyx(w: number, h = w, seed = 7): HTMLCanvasElement {
  return cached(`onyx-${w}-${h}-${seed}`, () => {
    const [c, ctx] = canvas(w, h);
    const img = ctx.createImageData(w, h);
    const n = makeNoise(seed);
    const deep = [184, 104, 40],
      mid = [234, 172, 96],
      pale = [252, 230, 190];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = (x / w) * 4,
          v = (y / h) * 4 * (h / w);
        const warp = fbm(n, u * 0.7, v * 0.7, 4, 5);
        // Sweeping growth bands, warped like real onyx.
        const band = 0.5 + 0.5 * Math.sin((u * 0.6 + v * 1.4 + warp * 3.2) * 4.2);
        const fine = 0.5 + 0.5 * Math.sin((u * 0.6 + v * 1.4 + warp * 3.6) * 23);
        const cloud = fbm(n, u * 2 + 7, v * 2 + 3, 8, 4);
        let t = 0.2 + band * 0.45 + fine * 0.12 + cloud * 0.4;
        t = Math.max(0, Math.min(1, t));
        const vein = Math.pow(Math.max(0, 1 - Math.abs(Math.sin((u * 1.3 - v * 0.4 + warp * 5) * 2.6)) * 9), 2);
        const i = (y * w + x) * 4;
        for (let k = 0; k < 3; k++) {
          const a = t < 0.5 ? deep[k] + (mid[k] - deep[k]) * (t * 2) : mid[k] + (pale[k] - mid[k]) * ((t - 0.5) * 2);
          img.data[i + k] = Math.min(255, a + vein * 50);
        }
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  });
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
      ctx.fillRect(x + Math.sin(y * 0.3 + x) * 3, y, 1 + rnd() * 2.5, 1.5);
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
