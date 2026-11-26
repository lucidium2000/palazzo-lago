/**
 * Original procedural art for Porkbelly Payday (Luau edition), all drawn on
 * canvas with gradients, gloss, rims, outlines and drop shadows so it reads at
 * arm's length in VR: chunky glossy royals, the Hula Piggy, Tiki Mask, Coconut
 * Cooler, Beach Ball and Surfboard Wild, pig coins, the three mascot pigs
 * (Skipper, Goldie and Rocco), the logo, jackpot meter frames, feature badges
 * and the sunset-beach backdrop with its mountain of coins.
 */

type Ctx = CanvasRenderingContext2D;
export const DISPLAY = '"Arial Black", "Arial Bold", "Helvetica Neue", Arial, sans-serif';
type Stops = [number, string][];

export function canvas2(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  return [c, c.getContext('2d')!];
}

function lin(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, stops: Stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [k, c] of stops) g.addColorStop(k, c);
  return g;
}
function rad(ctx: Ctx, x0: number, y0: number, r0: number, x1: number, y1: number, r1: number, stops: Stops) {
  const g = ctx.createRadialGradient(x0, y0, r0, x1, y1, r1);
  for (const [k, c] of stops) g.addColorStop(k, c);
  return g;
}

export const GOLD_STOPS: Stops = [
  [0, '#fffbe6'],
  [0.42, '#ffe070'],
  [0.5, '#f7b500'],
  [0.78, '#c47400'],
  [1, '#ffd650'],
];
export const PINK_STOPS: Stops = [
  [0, '#fff0fa'],
  [0.42, '#ff8fd2'],
  [0.5, '#ff2fa0'],
  [0.8, '#b0086a'],
  [1, '#ff6ac0'],
];
export const WHITE_STOPS: Stops = [
  [0, '#ffffff'],
  [0.48, '#ffffff'],
  [0.52, '#e4ecff'],
  [1, '#c8d4f0'],
];

function goldGrad(ctx: Ctx, y0: number, y1: number) {
  return lin(ctx, 0, y0, 0, y1, GOLD_STOPS);
}

function shadow(ctx: Ctx, blur: number, dy: number, color = 'rgba(0,0,0,0.5)') {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = dy;
}
function noShadow(ctx: Ctx) {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/** A soft white specular ellipse. */
export function gloss(ctx: Ctx, x: number, y: number, rx: number, ry: number, rot = -0.4, a = 0.7) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(255,255,255,${a})`);
  g.addColorStop(0.6, `rgba(255,255,255,${a * 0.35})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

/** A four-point twinkle. */
export function sparkle(ctx: Ctx, x: number, y: number, r: number, a = 1) {
  ctx.save();
  ctx.globalAlpha *= a;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    const rr = i % 2 ? r * 0.18 : r;
    ctx.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
  }
  ctx.closePath();
  ctx.fill();
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 0.6);
  g.addColorStop(0, 'rgba(255,255,230,0.9)');
  g.addColorStop(1, 'rgba(255,255,200,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export interface ChunkyOpts {
  fill?: Stops;
  outline?: string;
  rim?: string | null;
  depth?: number;
  glow?: string;
  maxW?: number;
  shadow?: boolean;
}

/**
 * Chunky glossy display text: drop shadow, extruded dark depth, thick
 * outline, a light rim and a banded gradient fill that reads as gloss.
 */
export function chunkyText(ctx: Ctx, text: string, x: number, y: number, size: number, o: ChunkyOpts = {}) {
  ctx.save();
  ctx.font = `900 ${size}px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.translate(x, y);
  if (o.maxW) {
    const w = ctx.measureText(text).width + size * 0.25;
    if (w > o.maxW) ctx.scale(o.maxW / w, 1);
  }
  const outline = o.outline ?? '#2a0620';
  const depth = o.depth ?? size * 0.07;
  ctx.strokeStyle = outline;
  ctx.fillStyle = outline;
  ctx.lineWidth = size * 0.2;
  if (o.shadow !== false) shadow(ctx, size * 0.18, size * 0.08, 'rgba(0,0,0,0.55)');
  ctx.strokeText(text, 0, depth);
  noShadow(ctx);
  for (let d = depth * 0.5; d > 0.5; d -= Math.max(1, depth / 3)) ctx.strokeText(text, 0, d);
  ctx.strokeText(text, 0, 0);
  if (o.rim !== null) {
    ctx.lineWidth = size * 0.085;
    ctx.strokeStyle = o.rim ?? '#ffffff';
    ctx.strokeText(text, 0, 0);
  }
  ctx.fillStyle = lin(ctx, 0, -size * 0.42, 0, size * 0.4, o.fill ?? GOLD_STOPS);
  if (o.glow) {
    ctx.shadowColor = o.glow;
    ctx.shadowBlur = size * 0.4;
  }
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

const ROYAL: Record<string, Stops> = {
  A: [
    [0, '#fff1e0'],
    [0.42, '#ff9a5a'],
    [0.5, '#ff4a1c'],
    [0.82, '#b81800'],
    [1, '#ff7a3a'],
  ],
  K: [
    [0, '#f6e8ff'],
    [0.42, '#c890ff'],
    [0.5, '#8a3cf0'],
    [0.82, '#4a1498'],
    [1, '#a870ff'],
  ],
  Q: [
    [0, '#e4fffb'],
    [0.42, '#6ff0e0'],
    [0.5, '#10c0b8'],
    [0.82, '#06706e'],
    [1, '#50e0d0'],
  ],
  J: [
    [0, '#efffe0'],
    [0.42, '#9cf060'],
    [0.5, '#3cc020'],
    [0.82, '#1a7008'],
    [1, '#80e040'],
  ],
  T: [
    [0, '#e8f4ff'],
    [0.42, '#7cc0ff'],
    [0.5, '#2a7cff'],
    [0.82, '#0a3aa8'],
    [1, '#5aa0ff'],
  ],
};
const ROYAL_INK: Record<string, string> = { A: '#4a0800', K: '#1e0848', Q: '#033634', J: '#0a3204', T: '#061c50' };

function royal(ctx: Ctx, s: number, id: string) {
  const text = id === 'T' ? '10' : id;
  const size = s * (text.length > 1 ? 0.6 : 0.74);
  ctx.save();
  ctx.font = `900 ${size}px ${DISPLAY}`;
  const w = ctx.measureText(text).width;
  ctx.restore();
  // Condense the "10" so it stays inside the cell.
  const squeeze = Math.min(1, (s * 0.84) / (w + size * 0.2));
  ctx.save();
  ctx.translate(s / 2, s * 0.54);
  ctx.scale(squeeze, 1);
  chunkyText(ctx, text, 0, 0, size, { fill: ROYAL[id], outline: ROYAL_INK[id], depth: s * 0.05 });
  ctx.restore();
  sparkle(ctx, s * 0.5 + size * 0.24, s * 0.54 - size * 0.32, s * 0.06);
}

/** A rounded symbol tile with a radial colour field, faint rays and a bevelled rim. */
function tile(ctx: Ctx, s: number, c0: string, c1: string, c2: string, rays = true) {
  const x = s * 0.045,
    w = s - x * 2;
  shadow(ctx, s * 0.05, s * 0.02, 'rgba(0,0,0,0.35)');
  ctx.beginPath();
  ctx.roundRect(x, x, w, w, s * 0.13);
  ctx.fillStyle = rad(ctx, s * 0.5, s * 0.42, s * 0.02, s * 0.5, s * 0.5, s * 0.7, [
    [0, c0],
    [0.55, c1],
    [1, c2],
  ]);
  ctx.fill();
  noShadow(ctx);
  if (rays) {
    ctx.save();
    ctx.clip();
    ctx.translate(s * 0.5, s * 0.46);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i < 12; i++) {
      ctx.rotate(Math.PI / 6);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(s, -s * 0.13);
      ctx.lineTo(s, s * 0.13);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.beginPath();
  ctx.roundRect(x, x, w, w, s * 0.13);
  ctx.lineWidth = s * 0.035;
  ctx.strokeStyle = goldGrad(ctx, x, x + w);
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(x + s * 0.03, x + s * 0.03, w - s * 0.06, w - s * 0.06, s * 0.1);
  ctx.lineWidth = s * 0.008;
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.stroke();
}

/** A five-petal hibiscus. */
export function hibiscus(ctx: Ctx, x: number, y: number, r: number, petal: string, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.lineWidth = r * 0.08;
  ctx.strokeStyle = 'rgba(80,0,30,0.6)';
  for (let i = 0; i < 5; i++) {
    ctx.rotate((Math.PI * 2) / 5);
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.55, r * 0.38, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fillStyle = rad(ctx, 0, -r * 0.2, 0, 0, -r * 0.55, r * 0.7, [
      [0, '#ffffff'],
      [0.25, petal],
      [1, petal],
    ]);
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = '#ffe040';
  ctx.fill();
  ctx.fillStyle = '#ff8a00';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.12, Math.sin(a) * r * 0.12, r * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A pink piggy in a grass skirt and lei, strumming a ukulele. */
function hulaPig(ctx: Ctx, s: number) {
  tile(ctx, s, '#fff2a8', '#ff8a3c', '#d0206a');
  ctx.save();
  ctx.scale(s, s);
  const ink = '#5a1030';
  const skin = (y0: number, y1: number) =>
    lin(ctx, 0, y0, 0, y1, [
      [0, '#ffe0ea'],
      [0.5, '#ff9ab8'],
      [1, '#d8507a'],
    ]);
  ctx.lineJoin = 'round';
  // Grass skirt.
  ctx.beginPath();
  ctx.moveTo(0.27, 0.66);
  for (let i = 0; i <= 12; i++) {
    const x = 0.25 + (i / 12) * 0.5;
    ctx.lineTo(x, 0.9 + (i % 2 ? -0.03 : 0.015));
  }
  ctx.lineTo(0.73, 0.66);
  ctx.closePath();
  ctx.fillStyle = lin(ctx, 0, 0.66, 0, 0.92, [
    [0, '#c8f060'],
    [0.6, '#4aa020'],
    [1, '#2a6a10'],
  ]);
  shadow(ctx, s * 0.04, s * 0.015);
  ctx.fill();
  noShadow(ctx);
  ctx.lineWidth = 0.012;
  ctx.strokeStyle = '#1e4a08';
  ctx.stroke();
  ctx.strokeStyle = 'rgba(30,80,10,0.6)';
  ctx.lineWidth = 0.006;
  for (let i = 1; i < 12; i++) {
    const x = 0.27 + (i / 12) * 0.46;
    ctx.beginPath();
    ctx.moveTo(x, 0.68);
    ctx.lineTo(x + (i - 6) * 0.004, 0.87);
    ctx.stroke();
  }
  // Body.
  ctx.beginPath();
  ctx.ellipse(0.5, 0.6, 0.2, 0.17, 0, 0, Math.PI * 2);
  ctx.fillStyle = skin(0.43, 0.77);
  ctx.fill();
  ctx.lineWidth = 0.014;
  ctx.strokeStyle = ink;
  ctx.stroke();
  // Ukulele across the tummy.
  ctx.save();
  ctx.translate(0.53, 0.63);
  ctx.rotate(-0.75);
  ctx.beginPath();
  ctx.roundRect(0.04, -0.018, 0.28, 0.036, 0.01);
  ctx.fillStyle = '#6a3a10';
  ctx.fill();
  ctx.strokeStyle = '#2a1004';
  ctx.lineWidth = 0.008;
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(0.3, -0.03, 0.06, 0.06, 0.015);
  ctx.fillStyle = '#4a2408';
  ctx.fill();
  ctx.stroke();
  const ub = lin(ctx, -0.12, -0.08, 0.06, 0.08, [
    [0, '#ffd890'],
    [0.5, '#e09030'],
    [1, '#9a5410'],
  ]);
  ctx.beginPath();
  ctx.ellipse(-0.08, 0, 0.1, 0.085, 0, 0, Math.PI * 2);
  ctx.ellipse(0.04, 0, 0.075, 0.065, 0, 0, Math.PI * 2);
  ctx.fillStyle = ub;
  ctx.fill();
  ctx.lineWidth = 0.01;
  ctx.strokeStyle = '#4a2004';
  ctx.beginPath();
  ctx.ellipse(-0.08, 0, 0.1, 0.085, 0, 0.9, Math.PI * 2 - 0.9);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0.04, 0, 0.075, 0.065, 0, -Math.PI + 1.2, Math.PI - 1.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-0.01, 0, 0.028, 0, Math.PI * 2);
  ctx.fillStyle = '#2a1004';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,230,0.8)';
  ctx.lineWidth = 0.003;
  for (const dy of [-0.012, 0, 0.012]) {
    ctx.beginPath();
    ctx.moveTo(-0.13, dy);
    ctx.lineTo(0.34, dy * 0.6);
    ctx.stroke();
  }
  gloss(ctx, -0.1, -0.035, 0.05, 0.02, 0, 0.6);
  ctx.restore();
  // Arms on the uke.
  ctx.fillStyle = skin(0.55, 0.72);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.012;
  for (const [x, y] of [
    [0.38, 0.66],
    [0.63, 0.55],
  ]) {
    ctx.beginPath();
    ctx.ellipse(x, y, 0.045, 0.035, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // Head.
  for (const sg of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0.5 + sg * 0.08, 0.19);
    ctx.quadraticCurveTo(0.5 + sg * 0.2, 0.08, 0.5 + sg * 0.19, 0.25);
    ctx.closePath();
    ctx.fillStyle = '#ff8ab0';
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(0.5, 0.34, 0.17, 0.15, 0, 0, Math.PI * 2);
  ctx.fillStyle = skin(0.19, 0.49);
  shadow(ctx, s * 0.03, s * 0.01, 'rgba(90,0,40,0.4)');
  ctx.fill();
  noShadow(ctx);
  ctx.stroke();
  // Eyes (happy, eyes closed, strumming).
  ctx.lineWidth = 0.014;
  ctx.lineCap = 'round';
  for (const sg of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(0.5 + sg * 0.075, 0.3, 0.03, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,80,130,0.5)';
  for (const sg of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(0.5 + sg * 0.115, 0.36, 0.03, 0.018, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(0.5, 0.37, 0.065, 0.045, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ffb4ca';
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ink;
  for (const sg of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(0.5 + sg * 0.022, 0.37, 0.011, 0.018, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0.5, 0.42, 0.035, 0.3, Math.PI - 0.3);
  ctx.stroke();
  // Lei.
  const lei = ['#ff3a7a', '#ffe040', '#ffffff', '#b060ff', '#ff8a20'];
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.15 + (i / 8) * 0.7);
    hibiscus(ctx, 0.5 + Math.cos(a) * 0.15, 0.46 + Math.sin(a) * 0.06, 0.03, lei[i % lei.length], i);
  }
  hibiscus(ctx, 0.36, 0.22, 0.05, '#ff2a6a', 0.3);
  gloss(ctx, 0.44, 0.27, 0.07, 0.03, -0.4, 0.7);
  ctx.restore();
}

/** A carved tiki mask with a pig's snout and a leaf crown. */
function tikiMask(ctx: Ctx, s: number) {
  tile(ctx, s, '#f8ffb0', '#3cc060', '#0a5a30');
  ctx.save();
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  // Leaf crown.
  const leaves: [number, string][] = [
    [-1.05, '#2a9a30'],
    [-0.7, '#ff6a2a'],
    [-0.35, '#5ad040'],
    [0, '#ffd020'],
    [0.35, '#5ad040'],
    [0.7, '#ff6a2a'],
    [1.05, '#2a9a30'],
  ];
  for (const [a, c] of leaves) {
    ctx.save();
    ctx.translate(0.5, 0.36);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(0.07, -0.16, 0, -0.3);
    ctx.quadraticCurveTo(-0.07, -0.16, 0, 0);
    ctx.fillStyle = c;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,40,0,0.7)';
    ctx.lineWidth = 0.01;
    ctx.stroke();
    ctx.restore();
  }
  // Ears.
  ctx.fillStyle = '#b8702c';
  ctx.strokeStyle = '#3a1a04';
  ctx.lineWidth = 0.014;
  for (const sg of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0.5 + sg * 0.17, 0.3);
    ctx.lineTo(0.5 + sg * 0.3, 0.2);
    ctx.lineTo(0.5 + sg * 0.25, 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // Mask.
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(0.3, 0.32);
    ctx.quadraticCurveTo(0.3, 0.18, 0.5, 0.18);
    ctx.quadraticCurveTo(0.7, 0.18, 0.7, 0.32);
    ctx.lineTo(0.68, 0.8);
    ctx.quadraticCurveTo(0.68, 0.9, 0.5, 0.9);
    ctx.quadraticCurveTo(0.32, 0.9, 0.32, 0.8);
    ctx.closePath();
  };
  path();
  ctx.fillStyle = lin(ctx, 0.3, 0, 0.7, 0, [
    [0, '#7a4210'],
    [0.3, '#e0a050'],
    [0.55, '#c47c30'],
    [1, '#5a2e08'],
  ]);
  shadow(ctx, s * 0.05, s * 0.02);
  ctx.fill();
  noShadow(ctx);
  ctx.lineWidth = 0.016;
  ctx.stroke();
  // Wood grain.
  ctx.save();
  path();
  ctx.clip();
  ctx.strokeStyle = 'rgba(70,30,0,0.25)';
  ctx.lineWidth = 0.006;
  for (let i = 0; i < 9; i++) {
    ctx.beginPath();
    ctx.moveTo(0.33 + i * 0.045, 0.18);
    ctx.bezierCurveTo(0.31 + i * 0.045, 0.45, 0.36 + i * 0.045, 0.6, 0.33 + i * 0.045, 0.92);
    ctx.stroke();
  }
  ctx.restore();
  // Painted brow band.
  ctx.beginPath();
  ctx.roundRect(0.32, 0.29, 0.36, 0.05, 0.02);
  ctx.fillStyle = '#e83a20';
  ctx.fill();
  ctx.strokeStyle = '#3a1a04';
  ctx.lineWidth = 0.01;
  ctx.stroke();
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(0.34 + i * 0.06, 0.3);
    ctx.lineTo(0.37 + i * 0.06, 0.33);
    ctx.lineTo(0.4 + i * 0.06, 0.3);
    ctx.strokeStyle = '#ffe040';
    ctx.lineWidth = 0.008;
    ctx.stroke();
  }
  // Eyes.
  for (const sg of [-1, 1]) {
    const ex = 0.5 + sg * 0.085;
    ctx.beginPath();
    ctx.arc(ex, 0.43, 0.065, 0, Math.PI * 2);
    ctx.fillStyle = '#3a1a04';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex, 0.43, 0.05, 0, Math.PI * 2);
    ctx.fillStyle = '#fffbe8';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex - sg * 0.012, 0.44, 0.025, 0, Math.PI * 2);
    ctx.fillStyle = '#140600';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex - sg * 0.02, 0.43, 0.008, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
  // Snout.
  ctx.beginPath();
  ctx.ellipse(0.5, 0.58, 0.1, 0.07, 0, 0, Math.PI * 2);
  ctx.fillStyle = lin(ctx, 0, 0.51, 0, 0.65, [
    [0, '#f4c080'],
    [1, '#a86020'],
  ]);
  ctx.fill();
  ctx.lineWidth = 0.014;
  ctx.strokeStyle = '#3a1a04';
  ctx.stroke();
  ctx.fillStyle = '#1a0800';
  for (const sg of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(0.5 + sg * 0.035, 0.58, 0.018, 0.03, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Grinning mouth with teeth.
  ctx.beginPath();
  ctx.roundRect(0.37, 0.69, 0.26, 0.1, 0.04);
  ctx.fillStyle = '#2a0c00';
  ctx.fill();
  ctx.fillStyle = '#fff8e0';
  for (let i = 0; i < 6; i++) {
    ctx.fillRect(0.385 + i * 0.039, 0.7, 0.03, 0.035);
    ctx.fillRect(0.385 + i * 0.039, 0.745, 0.03, 0.03);
  }
  // Teal cheek paint.
  ctx.fillStyle = '#20d0c0';
  for (const sg of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0.5 + sg * 0.15, 0.55);
    ctx.lineTo(0.5 + sg * 0.18, 0.6);
    ctx.lineTo(0.5 + sg * 0.15, 0.65);
    ctx.lineTo(0.5 + sg * 0.12, 0.6);
    ctx.closePath();
    ctx.fill();
  }
  gloss(ctx, 0.4, 0.24, 0.07, 0.025, -0.3, 0.6);
  ctx.restore();
}

/** A coconut cooler with a straw, a paper parasol and a pineapple wedge. */
function coconutDrink(ctx: Ctx, s: number) {
  tile(ctx, s, '#e8fff8', '#30d0d0', '#0a5a8a');
  ctx.save();
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  // Straw.
  ctx.save();
  ctx.translate(0.56, 0.55);
  ctx.rotate(0.35);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-0.018, -0.42, 0.036, 0.4);
  ctx.fillStyle = '#ff3a6a';
  for (let i = 0; i < 6; i++) ctx.fillRect(-0.018, -0.42 + i * 0.07, 0.036, 0.03);
  ctx.strokeStyle = '#6a0a20';
  ctx.lineWidth = 0.008;
  ctx.strokeRect(-0.018, -0.42, 0.036, 0.4);
  ctx.restore();
  // Parasol.
  ctx.save();
  ctx.translate(0.36, 0.42);
  ctx.rotate(-0.4);
  ctx.strokeStyle = '#8a5a20';
  ctx.lineWidth = 0.014;
  ctx.beginPath();
  ctx.moveTo(0, -0.18);
  ctx.lineTo(0, 0.16);
  ctx.stroke();
  const cols = ['#ffd020', '#ff4a8a', '#ffd020', '#ff4a8a', '#ffd020', '#ff4a8a'];
  for (let i = 0; i < 6; i++) {
    const a0 = Math.PI + (i / 6) * Math.PI,
      a1 = Math.PI + ((i + 1) / 6) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(0, -0.18);
    ctx.lineTo(Math.cos(a0) * 0.2, -0.08 + Math.sin(a0) * 0.06 + 0.06);
    ctx.lineTo(Math.cos(a1) * 0.2, -0.08 + Math.sin(a1) * 0.06 + 0.06);
    ctx.closePath();
    ctx.fillStyle = cols[i];
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,20,30,0.7)';
    ctx.lineWidth = 0.007;
    ctx.stroke();
  }
  ctx.restore();
  // Coconut shell.
  shadow(ctx, s * 0.05, s * 0.02);
  ctx.beginPath();
  ctx.moveTo(0.22, 0.58);
  ctx.bezierCurveTo(0.22, 0.92, 0.78, 0.92, 0.78, 0.58);
  ctx.closePath();
  ctx.fillStyle = rad(ctx, 0.4, 0.62, 0.02, 0.5, 0.68, 0.32, [
    [0, '#c08048'],
    [0.6, '#7a4418'],
    [1, '#3a1c06'],
  ]);
  ctx.fill();
  noShadow(ctx);
  ctx.strokeStyle = '#241004';
  ctx.lineWidth = 0.014;
  ctx.stroke();
  // Husk fibres.
  ctx.strokeStyle = 'rgba(30,12,2,0.5)';
  ctx.lineWidth = 0.005;
  for (let i = 0; i < 14; i++) {
    const x = 0.27 + i * 0.033;
    ctx.beginPath();
    ctx.moveTo(x, 0.62 + (i % 3) * 0.02);
    ctx.lineTo(x + 0.015, 0.7 + (i % 4) * 0.03);
    ctx.stroke();
  }
  // White flesh rim and pink drink.
  ctx.beginPath();
  ctx.ellipse(0.5, 0.58, 0.28, 0.06, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#fffaf0';
  ctx.fill();
  ctx.strokeStyle = '#241004';
  ctx.lineWidth = 0.012;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0.5, 0.585, 0.24, 0.045, 0, 0, Math.PI * 2);
  ctx.fillStyle = lin(ctx, 0.26, 0, 0.74, 0, [
    [0, '#ff6aa0'],
    [0.5, '#ffb0d0'],
    [1, '#ff4a8a'],
  ]);
  ctx.fill();
  // Pineapple wedge on the rim.
  ctx.save();
  ctx.translate(0.72, 0.55);
  ctx.rotate(0.3);
  ctx.beginPath();
  ctx.moveTo(-0.08, 0);
  ctx.lineTo(0.08, 0);
  ctx.lineTo(0, -0.12);
  ctx.closePath();
  ctx.fillStyle = lin(ctx, 0, -0.12, 0, 0, [
    [0, '#fff8a0'],
    [1, '#ffc020'],
  ]);
  ctx.fill();
  ctx.strokeStyle = '#8a5a04';
  ctx.lineWidth = 0.01;
  ctx.stroke();
  ctx.fillStyle = '#c08000';
  ctx.fillRect(-0.08, -0.012, 0.16, 0.024);
  ctx.fillStyle = '#3aa020';
  for (const a of [-0.5, 0, 0.5]) {
    ctx.save();
    ctx.translate(0, -0.12);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.ellipse(0, -0.04, 0.015, 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  hibiscus(ctx, 0.28, 0.6, 0.06, '#ff2a6a', 0.4);
  gloss(ctx, 0.36, 0.7, 0.07, 0.03, -0.5, 0.45);
  ctx.restore();
}

/** A glossy six-panel beach ball. */
export function beachBall(ctx: Ctx, cx: number, cy: number, r: number) {
  const px = cx - r * 0.32,
    py = cy - r * 0.38;
  shadow(ctx, r * 0.2, r * 0.08);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  noShadow(ctx);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const cols = ['#ff2a3a', '#ffffff', '#ffd010', '#ffffff', '#1a7aff', '#ffffff'];
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2 + 0.3,
      a1 = ((i + 1) / 6) * Math.PI * 2 + 0.3;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.quadraticCurveTo(px + Math.cos(a0 + 0.35) * r * 1.2, py + Math.sin(a0 + 0.35) * r * 1.2, px + Math.cos(a0) * r * 3, py + Math.sin(a0) * r * 3);
    ctx.lineTo(px + Math.cos(a1) * r * 3, py + Math.sin(a1) * r * 3);
    ctx.quadraticCurveTo(px + Math.cos(a1 + 0.35) * r * 1.2, py + Math.sin(a1 + 0.35) * r * 1.2, px, py);
    ctx.fillStyle = cols[i];
    ctx.fill();
  }
  // Shading.
  ctx.fillStyle = rad(ctx, cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r * 1.05, [
    [0, 'rgba(255,255,255,0.25)'],
    [0.6, 'rgba(0,0,0,0)'],
    [1, 'rgba(0,10,40,0.45)'],
  ]);
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(px, py, r * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = '#f4f4f4';
  ctx.fill();
  ctx.lineWidth = r * 0.03;
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = r * 0.05;
  ctx.strokeStyle = '#1a1a3a';
  ctx.stroke();
  gloss(ctx, cx - r * 0.38, cy - r * 0.48, r * 0.38, r * 0.16, -0.6, 0.85);
}

function ballSymbol(ctx: Ctx, s: number) {
  tile(ctx, s, '#ffffff', '#7ad8ff', '#1a6ad0');
  // Sand.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(s * 0.045, s * 0.045, s * 0.91, s * 0.91, s * 0.13);
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(s * 0.5, s * 1.02, s * 0.6, s * 0.22, 0, 0, Math.PI * 2);
  ctx.fillStyle = lin(ctx, 0, s * 0.8, 0, s, [
    [0, '#ffe8a8'],
    [1, '#d8a850'],
  ]);
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.ellipse(s * 0.5, s * 0.86, s * 0.26, s * 0.05, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(90,50,0,0.35)';
  ctx.fill();
  beachBall(ctx, s * 0.5, s * 0.5, s * 0.33);
  sparkle(ctx, s * 0.73, s * 0.27, s * 0.06);
}

/** A striped surfboard with chunky WILD lettering. */
function wild(ctx: Ctx, s: number) {
  tile(ctx, s, '#fff6a0', '#ff6a20', '#b8101a');
  ctx.save();
  ctx.translate(s * 0.5, s * 0.5);
  ctx.rotate(-0.75);
  const L = s * 0.46,
    Wd = s * 0.15;
  const board = () => {
    ctx.beginPath();
    ctx.moveTo(-L, 0);
    ctx.bezierCurveTo(-L * 0.6, -Wd * 1.1, L * 0.5, -Wd * 1.05, L, 0);
    ctx.bezierCurveTo(L * 0.5, Wd * 1.05, -L * 0.6, Wd * 1.1, -L, 0);
    ctx.closePath();
  };
  board();
  shadow(ctx, s * 0.05, s * 0.02);
  ctx.fillStyle = lin(ctx, 0, -Wd, 0, Wd, [
    [0, '#ffffff'],
    [0.5, '#bff4ff'],
    [1, '#40b8e8'],
  ]);
  ctx.fill();
  noShadow(ctx);
  ctx.save();
  board();
  ctx.clip();
  ctx.fillStyle = '#ff3a20';
  ctx.fillRect(-L, -Wd * 0.18, L * 2, Wd * 0.36);
  ctx.fillStyle = '#ffd020';
  ctx.fillRect(-L, -Wd * 0.42, L * 2, Wd * 0.12);
  ctx.fillRect(-L, Wd * 0.3, L * 2, Wd * 0.12);
  ctx.restore();
  board();
  ctx.lineWidth = s * 0.018;
  ctx.strokeStyle = '#0a2a4a';
  ctx.stroke();
  gloss(ctx, -L * 0.2, -Wd * 0.5, L * 0.5, Wd * 0.2, 0, 0.8);
  ctx.restore();
  ctx.save();
  ctx.translate(s * 0.5, s * 0.53);
  ctx.rotate(-0.12);
  chunkyText(ctx, 'WILD', 0, 0, s * 0.3, {
    fill: [
      [0, '#fffbe0'],
      [0.42, '#ffe040'],
      [0.5, '#ff9a00'],
      [0.8, '#e02000'],
      [1, '#ffb030'],
    ],
    outline: '#3a0404',
    depth: s * 0.04,
    maxW: s * 0.9,
  });
  ctx.restore();
  sparkle(ctx, s * 0.78, s * 0.25, s * 0.07);
}

// ---------------------------------------------------------------------------
// Coins
// ---------------------------------------------------------------------------

export const COIN_COLORS: Record<string, [string, string, string]> = {
  gold: ['#fff6cc', '#f0c040', '#8a5a08'],
  /** The plain pig coin on the reel strips (its colour shows when it lands). */
  rose: ['#fff0e8', '#e8a080', '#7a3418'],
  blue: ['#e0f0ff', '#2a8aff', '#06206a'],
  yellow: ['#ffffd8', '#ffe41a', '#a86000'],
  red: ['#ffe0e0', '#ff2a3a', '#6a0410'],
  MINI: ['#f2e0ff', '#b060ff', '#3a0a70'],
  MINOR: ['#dcefff', '#2a90ff', '#082468'],
  MAJOR: ['#e0ffe4', '#30c050', '#064818'],
  GRAND: ['#fff2c8', '#ff8a10', '#6a1804'],
  MEGA: ['#ffe0f4', '#ff30b0', '#680840'],
};

/** A glossy coin embossed with a pig; `label` across it; `hot` adds a starburst (a trigger coin). */
export function colorCoin(ctx: Ctx, s: number, color: string, label?: string, hot = false) {
  const [hi, mid, dark] = COIN_COLORS[color] ?? COIN_COLORS.gold;
  const cx = s / 2,
    cy = s / 2,
    r = s * (hot ? 0.38 : 0.43);
  if (hot) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const rr = i % 2 ? s * 0.36 : s * 0.49;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = rad(ctx, 0, 0, 0, 0, 0, s * 0.5, [
      [0, '#ffffff'],
      [0.6, '#fff0a0'],
      [1, mid],
    ]);
    ctx.fill();
    ctx.restore();
  }
  shadow(ctx, s * 0.08, s * 0.03, 'rgba(0,0,0,0.55)');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = dark;
  ctx.fill();
  noShadow(ctx);
  // Milled rim.
  ctx.lineWidth = s * 0.012;
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.88, cy + Math.sin(a) * r * 0.88);
    ctx.lineTo(cx + Math.cos(a) * r * 0.99, cy + Math.sin(a) * r * 0.99);
    ctx.strokeStyle = i % 2 ? mid : hi;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.86, 0, Math.PI * 2);
  ctx.fillStyle = rad(ctx, cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r * 0.95, [
    [0, hi],
    [0.5, mid],
    [1, dark],
  ]);
  ctx.fill();
  ctx.lineWidth = s * 0.014;
  ctx.strokeStyle = dark;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.74, 0, Math.PI * 2);
  ctx.lineWidth = s * 0.008;
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.stroke();
  ctx.globalAlpha = label ? 0.35 : 0.75;
  coinPig(ctx, cx, cy + r * 0.04, r * 0.44, hi, dark);
  ctx.globalAlpha = 1;
  gloss(ctx, cx - r * 0.3, cy - r * 0.45, r * 0.45, r * 0.18, -0.5, 0.75);
  if (label) chunkyText(ctx, label, cx, cy + s * 0.02, s * (label.length > 4 ? 0.17 : 0.2), { fill: WHITE_STOPS, outline: dark, rim: null, depth: s * 0.015, maxW: s * 0.82 });
  if (hot) sparkle(ctx, cx + r * 0.5, cy - r * 0.55, s * 0.08);
}

/** The embossed pig head on coins. */
function coinPig(ctx: Ctx, cx: number, cy: number, r: number, light: string, dark: string) {
  ctx.save();
  ctx.lineWidth = r * 0.1;
  ctx.strokeStyle = dark;
  ctx.fillStyle = light;
  for (const sg of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + sg * r * 0.45, cy - r * 0.6);
    ctx.lineTo(cx + sg * r * 0.95, cy - r * 1.05);
    ctx.lineTo(cx + sg * r * 0.88, cy - r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r * 0.86, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.25, r * 0.42, r * 0.3, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = dark;
  for (const sg of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + sg * r * 0.14, cy + r * 0.25, r * 0.07, r * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + sg * r * 0.36, cy - r * 0.25, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Mascots: Skipper (blue), Goldie (yellow) and Rocco (red)
// ---------------------------------------------------------------------------

export const PIG_PALETTE: Record<string, [string, string, string]> = {
  blue: ['#d8ecff', '#2a8cff', '#0a2a8a'],
  yellow: ['#fff8c8', '#ffc21a', '#a05a00'],
  red: ['#ffd8d8', '#ff3040', '#7a0414'],
};
export const PIG_NAMES: Record<string, string> = { blue: 'SKIPPER', yellow: 'GOLDIE', red: 'ROCCO' };

/**
 * One of the three piggy-bank mascots standing on its hooves, drawn centred on
 * its body at (0,0) in units of r. `blink` closes the eyes; `cheer` opens the
 * mouth wide (a bonus).
 */
export function pigMascot(ctx: Ctx, r: number, color: 'blue' | 'yellow' | 'red', blink = false, cheer = false) {
  const [hi, mid, dark] = PIG_PALETTE[color];
  const ink = color === 'blue' ? '#061650' : color === 'yellow' ? '#5a2c00' : '#4a0008';
  ctx.save();
  ctx.scale(r, r);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const lw = 0.05;
  // Back legs, then front legs.
  const leg = (x: number, y0: number, w: number, h: number, back: boolean) => {
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y0, w, h, w * 0.42);
    ctx.fillStyle = lin(ctx, 0, y0, 0, y0 + h, back ? [[0, dark], [1, dark]] : [[0, mid], [0.6, mid], [1, dark]]);
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = ink;
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y0 + h - 0.12, w, 0.12, [0, 0, w * 0.42, w * 0.42]);
    ctx.fillStyle = ink;
    ctx.fill();
  };
  leg(-0.66, 0.45, 0.28, 0.5, true);
  leg(0.66, 0.45, 0.28, 0.5, true);
  // Curly tail.
  ctx.beginPath();
  ctx.lineWidth = 0.07;
  ctx.strokeStyle = ink;
  ctx.moveTo(0.92, 0.05);
  ctx.bezierCurveTo(1.18, -0.05, 1.18, -0.28, 1.06, -0.25);
  ctx.bezierCurveTo(0.95, -0.22, 1.02, -0.05, 1.16, -0.12);
  ctx.stroke();
  ctx.lineWidth = 0.035;
  ctx.strokeStyle = mid;
  ctx.stroke();
  // Ears.
  const ear = (sg: number) => {
    ctx.beginPath();
    ctx.moveTo(sg * 0.25, -0.82);
    ctx.bezierCurveTo(sg * 0.45, -1.28, sg * 0.82, -1.22, sg * 0.86, -1.1);
    ctx.bezierCurveTo(sg * 0.88, -0.9, sg * 0.82, -0.7, sg * 0.66, -0.6);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, 0, -1.2, 0, -0.6, [
      [0, hi],
      [1, mid],
    ]);
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = ink;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sg * 0.38, -0.84);
    ctx.bezierCurveTo(sg * 0.52, -1.13, sg * 0.74, -1.1, sg * 0.76, -1.02);
    ctx.bezierCurveTo(sg * 0.76, -0.88, sg * 0.7, -0.76, sg * 0.62, -0.7);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,150,190,0.75)';
    ctx.fill();
  };
  ear(-1);
  ear(1);
  // Body.
  ctx.save();
  shadow(ctx, r * 0.18, r * 0.06, 'rgba(0,0,0,0.45)');
  ctx.beginPath();
  ctx.ellipse(0, 0, 1, 0.9, 0, 0, Math.PI * 2);
  ctx.fillStyle = rad(ctx, -0.35, -0.45, 0.05, 0, 0.05, 1.12, [
    [0, hi],
    [0.42, mid],
    [0.85, dark],
    [1, dark],
  ]);
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = lw;
  ctx.strokeStyle = ink;
  ctx.beginPath();
  ctx.ellipse(0, 0, 1, 0.9, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Rim light.
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.94, 0.84, 0, -0.7, 0.5);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 0.04;
  ctx.stroke();
  // Front legs.
  leg(-0.34, 0.55, 0.34, 0.5, false);
  leg(0.34, 0.55, 0.34, 0.5, false);
  // Coin slot (Rocco's is under his hat).
  if (color !== 'red') {
    ctx.beginPath();
    ctx.roundRect(-0.24, -0.86, 0.48, 0.08, 0.04);
    ctx.fillStyle = '#140804';
    ctx.fill();
    ctx.lineWidth = 0.035;
    ctx.strokeStyle = lin(ctx, 0, -0.9, 0, -0.76, GOLD_STOPS);
    ctx.stroke();
  }
  // Cheeks.
  ctx.fillStyle = 'rgba(255,110,160,0.45)';
  for (const sg of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(sg * 0.6, 0.12, 0.17, 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Eyes.
  const eyeY = -0.28;
  const openEye = (sg: number, look: number) => {
    ctx.beginPath();
    ctx.ellipse(sg * 0.3, eyeY, 0.17, 0.21, 0, 0, Math.PI * 2);
    ctx.fillStyle = rad(ctx, sg * 0.3 - 0.05, eyeY - 0.08, 0.01, sg * 0.3, eyeY, 0.22, [
      [0, '#ffffff'],
      [0.8, '#ffffff'],
      [1, '#d8e0f0'],
    ]);
    ctx.fill();
    ctx.lineWidth = 0.035;
    ctx.strokeStyle = ink;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(sg * 0.3 + look, eyeY - 0.02, 0.095, 0.12, 0, 0, Math.PI * 2);
    ctx.fillStyle = color === 'yellow' ? '#5a2a08' : '#120818';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sg * 0.3 + look - 0.035, eyeY - 0.07, 0.035, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sg * 0.3 + look + 0.03, eyeY + 0.03, 0.015, 0, Math.PI * 2);
    ctx.fill();
  };
  const shutEye = (sg: number) => {
    ctx.beginPath();
    ctx.arc(sg * 0.3, eyeY - 0.06, 0.13, 0.25 * Math.PI, 0.75 * Math.PI);
    ctx.lineWidth = 0.05;
    ctx.strokeStyle = ink;
    ctx.stroke();
  };
  for (const sg of [-1, 1]) {
    const wink = color === 'red' && sg === -1 && !cheer;
    if (blink || wink) shutEye(sg);
    else openEye(sg, color === 'blue' ? 0.03 : color === 'red' ? 0.04 : 0);
  }
  if (color === 'yellow' && !blink) {
    // Goldie's lashes.
    ctx.lineWidth = 0.03;
    ctx.strokeStyle = ink;
    for (const sg of [-1, 1])
      for (let k = 0; k < 3; k++) {
        const a = -Math.PI / 2 + sg * (0.5 + k * 0.28);
        ctx.beginPath();
        ctx.moveTo(sg * 0.3 + Math.cos(a) * 0.19, eyeY + Math.sin(a) * 0.22);
        ctx.lineTo(sg * 0.3 + Math.cos(a) * 0.28, eyeY + Math.sin(a) * 0.3);
        ctx.stroke();
      }
  }
  // Brows: Skipper cocky, Goldie sweet, Rocco sly.
  ctx.lineWidth = 0.05;
  ctx.strokeStyle = ink;
  if (color === 'blue') {
    ctx.beginPath();
    ctx.arc(-0.3, -0.5, 0.14, 1.2 * Math.PI, 1.8 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0.3, -0.58, 0.14, 1.15 * Math.PI, 1.85 * Math.PI);
    ctx.stroke();
  } else if (color === 'red') {
    ctx.beginPath();
    ctx.moveTo(-0.44, -0.5);
    ctx.lineTo(-0.16, -0.44);
    ctx.moveTo(0.16, -0.5);
    ctx.lineTo(0.44, -0.56);
    ctx.stroke();
  }
  // Snout.
  ctx.beginPath();
  ctx.ellipse(0, 0.1, 0.36, 0.25, 0, 0, Math.PI * 2);
  ctx.fillStyle = rad(ctx, -0.08, 0.02, 0.02, 0, 0.1, 0.38, [
    [0, '#ffffff'],
    [0.25, hi],
    [1, mid],
  ]);
  ctx.fill();
  ctx.lineWidth = 0.04;
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.fillStyle = ink;
  for (const sg of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(sg * 0.12, 0.11, 0.06, 0.1, sg * 0.15, 0, Math.PI * 2);
    ctx.fill();
  }
  gloss(ctx, -0.12, 0.01, 0.12, 0.05, -0.2, 0.8);
  // Mouth.
  ctx.lineWidth = 0.045;
  ctx.strokeStyle = ink;
  if (cheer || color === 'yellow') {
    const open = cheer ? 0.17 : 0.1;
    ctx.beginPath();
    ctx.moveTo(-0.2, 0.42);
    ctx.quadraticCurveTo(0, 0.44 + open * 2.2, 0.2, 0.42);
    ctx.quadraticCurveTo(0, 0.47, -0.2, 0.42);
    ctx.closePath();
    ctx.fillStyle = '#5a0a1a';
    ctx.fill();
    ctx.stroke();
    ctx.save();
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(0, 0.48 + open * 1.4, 0.12, 0.08, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ff6a8a';
    ctx.fill();
    ctx.restore();
  } else if (color === 'blue') {
    ctx.beginPath();
    ctx.moveTo(-0.24, 0.4);
    ctx.quadraticCurveTo(0, 0.6, 0.26, 0.38);
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(0.02, 0.47, 0.08, 0.07);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 0.02;
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(-0.18, 0.46);
    ctx.quadraticCurveTo(0.05, 0.55, 0.24, 0.4);
    ctx.stroke();
  }
  // Accessories.
  if (color === 'blue') {
    // Sunglasses pushed up on his forehead.
    ctx.save();
    ctx.translate(0, -0.66);
    ctx.rotate(-0.06);
    ctx.lineWidth = 0.05;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(-0.1, -0.02);
    ctx.quadraticCurveTo(0, -0.08, 0.1, -0.02);
    ctx.stroke();
    for (const sg of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sg * 0.25, 0, 0.17, 0.12, 0, 0, Math.PI * 2);
      ctx.fillStyle = lin(ctx, 0, -0.12, 0, 0.12, [
        [0, '#ff9ad8'],
        [0.5, '#a040ff'],
        [1, '#2a0a6a'],
      ]);
      ctx.fill();
      ctx.lineWidth = 0.055;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.lineWidth = 0.02;
      ctx.strokeStyle = ink;
      ctx.beginPath();
      ctx.ellipse(sg * 0.25, 0, 0.2, 0.15, 0, 0, Math.PI * 2);
      ctx.stroke();
      gloss(ctx, sg * 0.25 - 0.06, -0.04, 0.07, 0.03, -0.4, 0.9);
    }
    ctx.restore();
  } else if (color === 'yellow') {
    // A flower lei, and a hibiscus behind her ear.
    const lei = ['#ff3a7a', '#ffffff', '#ff8a20', '#b060ff', '#ff3a7a', '#40d0ff', '#ffffff', '#ff8a20', '#b060ff'];
    for (let i = 0; i < lei.length; i++) {
      const a = Math.PI * (0.08 + (i / (lei.length - 1)) * 0.84);
      hibiscus(ctx, Math.cos(a) * 0.82, 0.3 + Math.sin(a) * 0.38, 0.13, lei[i], i * 0.7);
    }
    hibiscus(ctx, -0.62, -0.78, 0.2, '#ff2a6a', 0.4);
  } else {
    // A straw sun hat with a red band, tipped back.
    ctx.save();
    ctx.translate(0.05, -0.84);
    ctx.rotate(-0.14);
    const straw = lin(ctx, 0, -0.4, 0, 0.1, [
      [0, '#fff4c0'],
      [0.5, '#f0cc70'],
      [1, '#b88830'],
    ]);
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.72, 0.17, 0, 0, Math.PI * 2);
    ctx.fillStyle = straw;
    ctx.fill();
    ctx.lineWidth = 0.04;
    ctx.strokeStyle = '#5a3a08';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-0.4, -0.02);
    ctx.bezierCurveTo(-0.42, -0.42, 0.42, -0.42, 0.4, -0.02);
    ctx.closePath();
    ctx.fillStyle = straw;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-0.405, -0.06);
    ctx.bezierCurveTo(-0.405, -0.16, 0.405, -0.16, 0.405, -0.06);
    ctx.lineTo(0.4, 0);
    ctx.bezierCurveTo(0.4, -0.08, -0.4, -0.08, -0.4, 0);
    ctx.closePath();
    ctx.fillStyle = '#e8102a';
    ctx.fill();
    ctx.lineWidth = 0.02;
    ctx.stroke();
    // Weave.
    ctx.strokeStyle = 'rgba(120,80,10,0.35)';
    ctx.lineWidth = 0.012;
    for (let i = -5; i <= 5; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 0.12, -0.06);
      ctx.lineTo(i * 0.13, 0.12);
      ctx.stroke();
    }
    hibiscus(ctx, 0.3, -0.1, 0.12, '#ffd020', 0.2);
    gloss(ctx, -0.18, -0.26, 0.14, 0.05, -0.3, 0.6);
    ctx.restore();
  }
  // Body gloss.
  gloss(ctx, -0.48, -0.5, 0.3, 0.13, -0.65, 0.85);
  gloss(ctx, -0.56, -0.38, 0.06, 0.04, -0.6, 0.9);
  ctx.restore();
}

/** A pre-drawn mascot sprite (centred at sprite.width/2, sprite.height * 0.52). */
export function pigSprite(r: number, color: 'blue' | 'yellow' | 'red', blink = false, cheer = false): HTMLCanvasElement {
  const [c, ctx] = canvas2(r * 2.7, r * 2.9);
  ctx.translate(c.width / 2, c.height * 0.52);
  pigMascot(ctx, r, color, blink, cheer);
  return c;
}

// ---------------------------------------------------------------------------
// Logo, meters and badges
// ---------------------------------------------------------------------------

/** Arched chunky glossy letters, one by one. */
function archText(ctx: Ctx, text: string, cx: number, cy: number, size: number, radius: number, o: ChunkyOpts) {
  ctx.save();
  ctx.font = `900 ${size}px ${DISPLAY}`;
  const widths = [...text].map((ch) => ctx.measureText(ch).width * 0.96);
  const total = widths.reduce((a, b) => a + b, 0);
  ctx.restore();
  let at = -total / 2;
  // Draw outlines of all letters first so neighbours don't cut each other.
  const place = (fn: (ch: string) => void) => {
    at = -total / 2;
    [...text].forEach((ch, i) => {
      const mid = at + widths[i] / 2;
      at += widths[i];
      const a = mid / radius;
      ctx.save();
      ctx.translate(cx + Math.sin(a) * radius, cy + radius - Math.cos(a) * radius);
      ctx.rotate(a);
      fn(ch);
      ctx.restore();
    });
  };
  place((ch) => chunkyText(ctx, ch, 0, 0, size, { ...o, fill: [[0, o.outline ?? '#000']], rim: o.outline ?? '#000' }));
  place((ch) => chunkyText(ctx, ch, 0, 0, size, { ...o, shadow: false, depth: 0 }));
}

/** The game logo: arched glossy PORKBELLY over a turquoise PAYDAY ribbon. */
export function logo(w: number, h: number): HTMLCanvasElement {
  const [c, ctx] = canvas2(w, h);
  const cx = w / 2;
  // Ribbon.
  const ry = h * 0.72,
    rh = h * 0.3,
    rw = w * 0.62;
  for (const sg of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + sg * rw * 0.42, ry - rh * 0.3);
    ctx.lineTo(cx + sg * rw * 0.66, ry - rh * 0.3);
    ctx.lineTo(cx + sg * rw * 0.58, ry + rh * 0.2);
    ctx.lineTo(cx + sg * rw * 0.66, ry + rh * 0.7);
    ctx.lineTo(cx + sg * rw * 0.42, ry + rh * 0.7);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, 0, ry - rh * 0.3, 0, ry + rh * 0.7, [
      [0, '#2ad8d0'],
      [1, '#06706a'],
    ]);
    shadow(ctx, h * 0.04, h * 0.02);
    ctx.fill();
    noShadow(ctx);
    ctx.lineWidth = h * 0.02;
    ctx.strokeStyle = '#043836';
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - rw / 2, ry - rh / 2);
  ctx.quadraticCurveTo(cx, ry - rh * 0.78, cx + rw / 2, ry - rh / 2);
  ctx.lineTo(cx + rw / 2, ry + rh / 2);
  ctx.quadraticCurveTo(cx, ry + rh * 0.22, cx - rw / 2, ry + rh / 2);
  ctx.closePath();
  ctx.fillStyle = lin(ctx, 0, ry - rh * 0.7, 0, ry + rh / 2, [
    [0, '#c8fff8'],
    [0.35, '#30e8dc'],
    [0.55, '#0aa8a8'],
    [1, '#045c5a'],
  ]);
  shadow(ctx, h * 0.06, h * 0.03);
  ctx.fill();
  noShadow(ctx);
  ctx.lineWidth = h * 0.025;
  ctx.strokeStyle = '#033a38';
  ctx.stroke();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(cx - rw / 2, ry - rh * 0.8, rw, rh * 0.32);
  ctx.restore();
  // Hibiscus at the ribbon's ends.
  hibiscus(ctx, cx - rw * 0.47, ry - rh * 0.1, h * 0.1, '#ff2a6a', 0.3);
  hibiscus(ctx, cx + rw * 0.47, ry - rh * 0.1, h * 0.1, '#ffd020', 1.1);
  ctx.save();
  ctx.translate(cx, ry - rh * 0.05);
  ctx.rotate(0);
  chunkyText(ctx, 'PAYDAY', 0, 0, h * 0.24, { fill: GOLD_STOPS, outline: '#3a1a00', depth: h * 0.02, maxW: rw * 0.82 });
  ctx.restore();
  // Arched title.
  archText(ctx, 'PORKBELLY', cx, h * 0.34, h * 0.42, w * 1.15, { fill: PINK_STOPS, outline: '#3a0030', depth: h * 0.045 });
  sparkle(ctx, cx + w * 0.3, h * 0.14, h * 0.07);
  sparkle(ctx, cx - w * 0.33, h * 0.24, h * 0.05);
  return c;
}

export const JP_FRAME: Record<string, Stops> = {
  MEGA: [
    [0, '#ff3a3a'],
    [0.2, '#ffb020'],
    [0.4, '#f8f040'],
    [0.6, '#30e070'],
    [0.8, '#30a0ff'],
    [1, '#c040ff'],
  ],
  GRAND: [
    [0, '#ffe0a0'],
    [0.45, '#ff8a10'],
    [0.55, '#c83a00'],
    [1, '#ffb060'],
  ],
  MAJOR: [
    [0, '#d8ffd0'],
    [0.45, '#40d040'],
    [0.55, '#108020'],
    [1, '#80f070'],
  ],
  MINOR: [
    [0, '#d8f0ff'],
    [0.45, '#3aa0ff'],
    [0.55, '#0a4ac0'],
    [1, '#80c8ff'],
  ],
  MINI: [
    [0, '#f4e0ff'],
    [0.45, '#b060ff'],
    [0.55, '#5a10b0'],
    [1, '#d0a0ff'],
  ],
};

/** A jackpot meter frame (the value is drawn on top each frame). The label tab overlaps the top. */
export function meterSprite(w: number, h: number, name: string): HTMLCanvasElement {
  const tab = h * (name === 'MEGA' ? 0.3 : 0.36);
  const pad = 10;
  const [c, ctx] = canvas2(w + pad * 2, h + tab * 0.5 + pad * 2);
  const x = pad,
    y = pad + tab * 0.5;
  const rr = h * 0.22;
  const stops = JP_FRAME[name];
  const horizontal = name === 'MEGA';
  shadow(ctx, 10, 4, 'rgba(0,0,0,0.6)');
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, rr);
  ctx.fillStyle = horizontal ? lin(ctx, x, 0, x + w, 0, stops) : lin(ctx, 0, y, 0, y + h, stops);
  ctx.fill();
  noShadow(ctx);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#1a0420';
  ctx.stroke();
  // Bevel highlight.
  ctx.beginPath();
  ctx.roundRect(x + 2, y + 2, w - 4, h * 0.45, [rr, rr, rr * 0.3, rr * 0.3]);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fill();
  // Inner panel.
  const b = Math.max(6, h * 0.11);
  ctx.beginPath();
  ctx.roundRect(x + b, y + b, w - b * 2, h - b * 2, rr * 0.6);
  ctx.fillStyle = lin(ctx, 0, y + b, 0, y + h - b, [
    [0, '#1a0a3a'],
    [0.5, '#2a0e4a'],
    [1, '#0a0418'],
  ]);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(x + b + 3, y + b + 3, w - b * 2 - 6, (h - b * 2) * 0.4, rr * 0.4);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fill();
  // Label tab.
  ctx.font = `900 ${tab * 0.78}px ${DISPLAY}`;
  const tw = ctx.measureText(name).width + tab * 1.2;
  ctx.beginPath();
  ctx.roundRect(x + w / 2 - tw / 2, pad, tw, tab, tab / 2);
  ctx.fillStyle = lin(ctx, 0, pad, 0, pad + tab, [
    [0, '#2a0a3a'],
    [1, '#120420'],
  ]);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = horizontal ? lin(ctx, x + w / 2 - tw / 2, 0, x + w / 2 + tw / 2, 0, stops) : stops[1][1];
  ctx.stroke();
  chunkyText(ctx, name, x + w / 2, pad + tab * 0.54, tab * 0.74, { fill: horizontal ? PINK_STOPS : [[0, '#ffffff'], [0.5, '#ffffff'], [0.55, stops[1][1]], [1, stops[0][1]]], outline: '#14031c', depth: 2, rim: null, maxW: tw - 8 });
  return c;
}

/** The value inset of a meter sprite, for drawing the number. */
export function meterInset(w: number, h: number, name: string) {
  const tab = h * (name === 'MEGA' ? 0.3 : 0.36);
  const pad = 10;
  return { ox: pad, oy: pad + tab * 0.5, cx: pad + w / 2, cy: pad + tab * 0.5 + h * 0.56, w: w - Math.max(6, h * 0.11) * 2 - 12 };
}

/** A feature badge frame under each pig (text drawn on top). */
export function badgeSprite(w: number, h: number, color: 'blue' | 'yellow' | 'red'): HTMLCanvasElement {
  const pad = 10;
  const [c, ctx] = canvas2(w + pad * 2, h + pad * 2);
  const [hi, mid, dark] = PIG_PALETTE[color];
  const x = pad,
    y = pad;
  shadow(ctx, 10, 4, 'rgba(0,0,0,0.6)');
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fillStyle = lin(ctx, 0, y, 0, y + h, [
    [0, hi],
    [0.45, mid],
    [0.55, dark],
    [1, mid],
  ]);
  ctx.fill();
  noShadow(ctx);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#10041a';
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(x + 6, y + 6, w - 12, h - 12, (h - 12) / 2);
  ctx.fillStyle = lin(ctx, 0, y, 0, y + h, [
    [0, '#1e0a34'],
    [1, '#08020e'],
  ]);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = lin(ctx, 0, y, 0, y + h, GOLD_STOPS);
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(x + 9, y + 8, w - 18, (h - 16) * 0.42, (h - 16) * 0.2);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();
  return c;
}

// ---------------------------------------------------------------------------
// Backdrop
// ---------------------------------------------------------------------------

export interface BackdropLayout {
  w: number;
  h: number;
  /** Centre of the sunburst (behind the logo). */
  burstY: number;
  /** Pig stage: coin mountain between these. */
  stageTop: number;
  stageBottom: number;
  pigX: number[];
  pedestalY: number;
  /** Beach band around the reels. */
  beachTop: number;
  beachBottom: number;
  reels: { x: number; y: number; w: number; h: number };
}

/** Seeded pseudo-random for repeatable backdrops. */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function flatCoin(ctx: Ctx, x: number, y: number, r: number, tone: number) {
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.12, r, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fillStyle = tone > 0.5 ? '#8a5200' : '#6a3a00';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fillStyle = rad(ctx, x - r * 0.3, y - r * 0.15, r * 0.05, x, y, r, [
    [0, '#fffbd0'],
    [0.4, tone > 0.5 ? '#ffd040' : '#f0b020'],
    [1, '#b06a00'],
  ]);
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.strokeStyle = 'rgba(120,60,0,0.8)';
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.66, r * 0.26, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,240,180,0.55)';
  ctx.lineWidth = Math.max(1, r * 0.07);
  ctx.stroke();
}

/** A mound of gold coins between x0..x1 with its peak heights given by `top(x)`. */
function coinMountain(ctx: Ctx, x0: number, x1: number, yBase: number, top: (x: number) => number, rnd: () => number) {
  ctx.beginPath();
  ctx.moveTo(x0, yBase);
  for (let x = x0; x <= x1; x += 6) ctx.lineTo(x, top(x) + 8);
  ctx.lineTo(x1, yBase);
  ctx.closePath();
  ctx.fillStyle = lin(ctx, 0, yBase - 220, 0, yBase, [
    [0, '#ffd23a'],
    [0.5, '#d08a00'],
    [1, '#6a3400'],
  ]);
  ctx.fill();
  const coins: [number, number, number, number][] = [];
  for (let i = 0; i < 2200; i++) {
    const x = x0 + rnd() * (x1 - x0);
    const t = top(x);
    if (t >= yBase) continue;
    const y = t + Math.pow(rnd(), 0.8) * (yBase - t);
    const depth = (y - t) / Math.max(1, yBase - t);
    coins.push([x, y, 9 + rnd() * 8 + depth * 6, rnd()]);
  }
  coins.sort((a, b) => a[1] - b[1]);
  for (const [x, y, r, tone] of coins) flatCoin(ctx, x, y, r, tone);
  // Upright coins leaning in the pile.
  for (let i = 0; i < 22; i++) {
    const x = x0 + rnd() * (x1 - x0);
    const y = top(x) + 18 + rnd() * 50;
    const r = 11 + rnd() * 6;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((rnd() - 0.5) * 0.9);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.5, r, 0, 0, Math.PI * 2);
    ctx.fillStyle = rad(ctx, -r * 0.15, -r * 0.3, 1, 0, 0, r, [
      [0, '#fffbd0'],
      [0.5, '#ffc020'],
      [1, '#a05a00'],
    ]);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#7a4000';
    ctx.stroke();
    ctx.restore();
  }
  // Warm glow on the pile.
  ctx.fillStyle = rad(ctx, (x0 + x1) / 2, yBase - 140, 20, (x0 + x1) / 2, yBase - 100, (x1 - x0) * 0.6, [
    [0, 'rgba(255,240,160,0.35)'],
    [1, 'rgba(255,200,60,0)'],
  ]);
  ctx.fillRect(x0, yBase - 300, x1 - x0, 300);
}

function pedestal(ctx: Ctx, x: number, y: number, rx: number, color: string) {
  const [hi, mid, dark] = PIG_PALETTE[color];
  const ry = rx * 0.26,
    hgt = rx * 0.32;
  shadow(ctx, 14, 6, 'rgba(60,20,0,0.6)');
  ctx.beginPath();
  ctx.ellipse(x, y + hgt, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = dark;
  ctx.fill();
  noShadow(ctx);
  ctx.beginPath();
  ctx.moveTo(x - rx, y);
  ctx.lineTo(x - rx, y + hgt);
  ctx.ellipse(x, y + hgt, rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(x + rx, y);
  ctx.closePath();
  ctx.fillStyle = lin(ctx, x - rx, 0, x + rx, 0, [
    [0, dark],
    [0.3, mid],
    [0.45, hi],
    [0.6, mid],
    [1, dark],
  ]);
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#140418';
  ctx.stroke();
  // Gold bands.
  for (const yy of [y + hgt * 0.15, y + hgt * 0.85]) {
    ctx.beginPath();
    ctx.ellipse(x, yy, rx, ry, 0, 0.05, Math.PI - 0.05);
    ctx.lineWidth = 4;
    ctx.strokeStyle = goldGrad(ctx, yy - 4, yy + ry);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = rad(ctx, x - rx * 0.3, y - ry * 0.3, 2, x, y, rx, [
    [0, hi],
    [0.6, mid],
    [1, dark],
  ]);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = goldGrad(ctx, y - ry, y + ry);
  ctx.stroke();
}

function palmFrond(ctx: Ctx, x: number, y: number, len: number, rot: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.strokeStyle = '#2a5a10';
  ctx.lineWidth = len * 0.04;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.5, -len * 0.15, len, len * 0.1);
  ctx.stroke();
  for (let i = 1; i < 14; i++) {
    const k = i / 14;
    const px = len * k,
      py = -len * 0.15 * Math.sin(k * Math.PI) + len * 0.1 * k * k;
    for (const sg of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + len * 0.05, py + sg * len * 0.12, px + len * 0.1, py + sg * len * (0.22 - k * 0.12));
      ctx.lineWidth = len * 0.035;
      ctx.strokeStyle = i % 2 ? '#3ab030' : '#28901c';
      ctx.stroke();
    }
  }
  ctx.restore();
}

function swimRing(ctx: Ctx, x: number, y: number, r: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, 0.75);
  shadow(ctx, 10, 5, 'rgba(0,0,0,0.4)');
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.arc(0, 0, r * 0.48, 0, Math.PI * 2, true);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  noShadow(ctx);
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(0, 0, r, (i / 4) * Math.PI * 2, (i / 4 + 0.125) * Math.PI * 2);
    ctx.arc(0, 0, r * 0.48, (i / 4 + 0.125) * Math.PI * 2, (i / 4) * Math.PI * 2, true);
    ctx.closePath();
    ctx.fillStyle = '#ff3a50';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.arc(0, 0, r * 0.48, 0, Math.PI * 2, true);
  ctx.fillStyle = rad(ctx, -r * 0.3, -r * 0.4, 2, 0, 0, r, [
    [0, 'rgba(255,255,255,0.5)'],
    [0.6, 'rgba(255,255,255,0)'],
    [1, 'rgba(0,0,0,0.3)'],
  ]);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#4a0a10';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.48, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function flipFlop(ctx: Ctx, x: number, y: number, s: number, rot: number, col: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  shadow(ctx, 6, 3, 'rgba(0,0,0,0.35)');
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.32, s * 0.7, 0, 0, Math.PI * 2);
  ctx.fillStyle = col;
  ctx.fill();
  noShadow(ctx);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = s * 0.08;
  ctx.beginPath();
  ctx.moveTo(-s * 0.28, s * 0.05);
  ctx.lineTo(0, -s * 0.38);
  ctx.lineTo(s * 0.28, s * 0.05);
  ctx.stroke();
  ctx.restore();
}

function starfish(ctx: Ctx, x: number, y: number, r: number, rot: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.42 : r;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = rad(ctx, 0, 0, 1, 0, 0, r, [
    [0, '#ffd0a0'],
    [1, '#ff6a2a'],
  ]);
  ctx.lineJoin = 'round';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#8a2a00';
  ctx.stroke();
  ctx.restore();
}

/** The static screen backdrop: sunset sunburst, coin mountain with pedestals, beach band. */
export function backdrop(L: BackdropLayout, bonus: boolean): HTMLCanvasElement {
  const { w, h } = L;
  const [c, ctx] = canvas2(w, h);
  const rnd = prng(bonus ? 7 : 3);
  // Sky.
  ctx.fillStyle = lin(ctx, 0, 0, 0, L.stageBottom, bonus
    ? [
        [0, '#1a0640'],
        [0.4, '#6a1a8a'],
        [0.75, '#e0408a'],
        [1, '#ff9a40'],
      ]
    : [
        [0, '#c0104a'],
        [0.35, '#ff3a6a'],
        [0.7, '#ff8a2a'],
        [1, '#ffd040'],
      ]);
  ctx.fillRect(0, 0, w, L.stageBottom);
  // Sunburst.
  ctx.save();
  ctx.translate(w / 2, L.burstY);
  for (let i = 0; i < 40; i++) {
    ctx.rotate((Math.PI * 2) / 40);
    ctx.fillStyle = i % 2 ? (bonus ? 'rgba(255,160,255,0.12)' : 'rgba(255,255,200,0.16)') : 'rgba(255,255,255,0.03)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(h, -h * 0.08);
    ctx.lineTo(h, h * 0.08);
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = rad(ctx, w / 2, L.burstY, 10, w / 2, L.burstY, w * 0.7, [
    [0, bonus ? 'rgba(255,200,255,0.55)' : 'rgba(255,255,220,0.6)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  ctx.fillRect(0, 0, w, L.stageBottom);
  // Little pig-coin confetti dots in the sky.
  for (let i = 0; i < 60; i++) {
    const x = rnd() * w,
      y = rnd() * L.stageTop;
    ctx.beginPath();
    ctx.arc(x, y, 1.5 + rnd() * 2.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,250,220,${0.2 + rnd() * 0.4})`;
    ctx.fill();
  }
  // Coin mountain: peaks under each pig.
  const peaks = L.pigX;
  const top = (x: number) => L.stageTop + 70 + Math.pow(Math.abs(x - w / 2) / (w / 2), 1.5) * 110 + Math.sin(x / 47) * 12 + Math.sin(x / 19) * 4;
  coinMountain(ctx, 0, w, L.beachTop, top, rnd);
  ctx.fillStyle = rad(ctx, w / 2, L.stageBottom, 10, w / 2, L.stageBottom, w * 0.8, [
    [0, 'rgba(0,0,0,0)'],
    [0.7, 'rgba(0,0,0,0)'],
    [1, 'rgba(40,0,10,0.35)'],
  ]);
  ctx.fillRect(0, L.stageTop, w, L.beachTop - L.stageTop);
  (['blue', 'yellow', 'red'] as const).forEach((col, i) => pedestal(ctx, peaks[i], L.pedestalY, 82, col));

  // Beach band: sand with sea and foam along the bottom.
  const bt = L.beachTop,
    bb = L.beachBottom;
  ctx.fillStyle = lin(ctx, 0, bt, 0, bb, [
    [0, '#ffe9b0'],
    [0.6, '#f4cf7a'],
    [1, '#e0b060'],
  ]);
  ctx.fillRect(0, bt, w, bb - bt);
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = rnd() > 0.5 ? 'rgba(160,110,30,0.25)' : 'rgba(255,255,240,0.35)';
    ctx.fillRect(rnd() * w, bt + rnd() * (bb - bt), 1.5, 1.5);
  }
  // Sea along the bottom, curling round the reels.
  const seaY = L.reels.y + L.reels.h - 30;
  ctx.beginPath();
  ctx.moveTo(0, seaY + 40);
  for (let x = 0; x <= w; x += 10) ctx.lineTo(x, seaY + 18 + Math.sin(x / 38) * 9 + Math.sin(x / 13) * 3);
  ctx.lineTo(w, bb);
  ctx.lineTo(0, bb);
  ctx.closePath();
  ctx.fillStyle = lin(ctx, 0, seaY, 0, bb, [
    [0, '#5ae8f0'],
    [0.4, '#18b8d8'],
    [1, '#0a6aa8'],
  ]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  for (let k = 1; k < 5; k++) {
    ctx.beginPath();
    for (let x = 0; x <= w; x += 10) ctx.lineTo(x, seaY + 18 + k * 18 + Math.sin(x / 30 + k * 2) * 5);
    ctx.stroke();
  }
  // Props in the margins.
  palmFrond(ctx, -10, bt + 10, 120, 0.5);
  palmFrond(ctx, w + 10, bt + 10, 120, Math.PI - 0.5);
  swimRing(ctx, 14, L.reels.y + L.reels.h * 0.55, 34);
  flipFlop(ctx, w - 16, L.reels.y + L.reels.h * 0.35, 30, 0.3, '#30c060');
  flipFlop(ctx, w - 8, L.reels.y + L.reels.h * 0.6, 30, -0.2, '#30c060');
  starfish(ctx, 18, L.reels.y + 40, 16, 0.3);
  beachBall(ctx, w - 20, L.reels.y + 34, 17);
  // Top edge of the beach band: a turquoise rail.
  ctx.fillStyle = lin(ctx, 0, bt - 6, 0, bt + 8, [
    [0, '#c8fff8'],
    [0.5, '#20c8c0'],
    [1, '#065a58'],
  ]);
  ctx.fillRect(0, bt - 6, w, 14);
  // Vignette.
  ctx.fillStyle = rad(ctx, w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.75, [
    [0, 'rgba(0,0,0,0)'],
    [1, 'rgba(0,0,0,0.35)'],
  ]);
  ctx.fillRect(0, 0, w, h);
  return c;
}

// ---------------------------------------------------------------------------

export function paintPiggySymbol(ctx: Ctx, id: string, s: number) {
  ctx.save();
  switch (id) {
    case 'WILD':
      wild(ctx, s);
      break;
    case 'HULA':
      hulaPig(ctx, s);
      break;
    case 'TIKI':
      tikiMask(ctx, s);
      break;
    case 'DRINK':
      coconutDrink(ctx, s);
      break;
    case 'BALL':
      ballSymbol(ctx, s);
      break;
    case 'COIN':
      colorCoin(ctx, s, 'rose');
      break;
    default:
      royal(ctx, s, id);
  }
  ctx.restore();
}

/** Every symbol drawn once at `cell` px into a one-row atlas. */
export function piggyAtlas(ids: string[], cell: number) {
  const [c, ctx] = canvas2(cell * ids.length, cell);
  const index = new Map<string, number>();
  ids.forEach((id, i) => {
    index.set(id, i);
    ctx.save();
    ctx.beginPath();
    ctx.rect(i * cell, 0, cell, cell);
    ctx.clip();
    ctx.translate(i * cell, 0);
    paintPiggySymbol(ctx, id, cell);
    ctx.restore();
  });
  return { canvas: c, index };
}
