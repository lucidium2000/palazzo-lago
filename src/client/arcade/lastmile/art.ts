/**
 * The Last Mile cabinet's printed art, drawn on one canvas in the game's own
 * look: Midtown at dusk (near-black sky warming to a rust horizon), the
 * orange the game is lit in, NYC lane yellow, street-sign green, and its
 * title set the way its title screen sets it ("ThE Last Mile": the T and E
 * full size in orange, a smaller white h tucked under the T's arm). No logos:
 * only lettering and street scenery.
 *
 * Layout (px) on a 1024 x 1024 canvas:
 *   side art   x 0..464,    y 0..1024 (the side profile)
 *   marquee    x 464..1024, y 0..128
 *   bezel      x 464..1024, y 128..428
 *   panel      x 464..1024, y 428..548
 *   door       x 464..1024, y 548..888
 *   swatches   x 464..,     y 900..  (flat colours for trims and solid parts)
 */

export const ART = 1024;
export const LM_REGION = {
  side: { x: 0, y: 0, w: 464, h: 1024 },
  marquee: { x: 464, y: 0, w: 560, h: 128 },
  bezel: { x: 464, y: 128, w: 560, h: 300 },
  panel: { x: 464, y: 428, w: 560, h: 120 },
  door: { x: 464, y: 548, w: 560, h: 340 },
} as const;
export type LmRect = { x: number; y: number; w: number; h: number };

/** The game's palette (its BRAND and C blocks). */
export const LM = {
  sky0: '#0a0708',
  sky1: '#161014',
  sky2: '#2a1b16',
  brand: '#ff6a13',
  deep: '#c9480a',
  light: '#ffa552',
  pale: '#ffd9b8',
  amber: '#ffc23d',
  lane: '#c9b24a',
  road: '#0c0c0e',
  walk: '#9a999d',
  curb: '#423630',
  sign: '#1f6b4a',
  text: '#fdf4ee',
  dim: 'rgba(253,244,238,0.58)',
  cab: '#f2c230',
  bg: '#07080c',
};

/** The game's type: its brand stack, then the system sans it falls back to. */
export const LM_FONT = '"Segoe UI","Noto Sans","Open Sans","Source Sans Pro","Avenir Next",Avenir,"Helvetica Neue",Helvetica,Arial,sans-serif';
const font = (px: number, w = 'bold') => `${w} ${px}px ${LM_FONT}`;

/** UV rect [u0, v0, u1, v1] (three.js, flipY) of a region of the art canvas. */
export function lmUV(r: LmRect, inset = 1): [number, number, number, number] {
  return [(r.x + inset) / ART, 1 - (r.y + r.h - inset) / ART, (r.x + r.w - inset) / ART, 1 - (r.y + inset) / ART];
}

const SWATCHES: string[] = [];
/** A flat-colour spot on the art canvas (painted by paintLastMile). */
export function lmSwatch(color: string): [number, number, number, number] {
  let i = SWATCHES.indexOf(color);
  if (i < 0) i = SWATCHES.push(color) - 1;
  const x = 470 + (i % 20) * 26,
    y = 904 + Math.floor(i / 20) * 26;
  return [(x + 6) / ART, 1 - (y + 18) / ART, (x + 18) / ART, 1 - (y + 6) / ART];
}

/** The title lockup, centred on (cx, baseline y), `big` px caps. Returns its width. */
export function titleLockup(g: CanvasRenderingContext2D, cx: number, y: number, big: number, measureOnly = false): number {
  const hSz = Math.round(big * 0.75);
  g.font = font(big);
  const wT = g.measureText('T').width,
    wE = g.measureText('E').width,
    wL = g.measureText(' Last Mile').width;
  g.font = font(hSz);
  const wh = g.measureText('h').width;
  const tuck = wT * 0.34,
    tight = wh * 0.14;
  const total = wT - tuck + wh - tight + wE + wL;
  if (measureOnly) return total;
  let x = cx - total / 2;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  const put = (s: string, px: number, col: string) => {
    g.font = font(px);
    g.fillStyle = col;
    g.fillText(s, x, y);
  };
  put('T', big, LM.brand);
  x += wT - tuck;
  put('h', hSz, LM.text);
  x += wh - tight;
  put('E', big, LM.brand);
  x += wE;
  put(' Last Mile', big, LM.text);
  return total;
}

function skyGradient(g: CanvasRenderingContext2D, r: LmRect) {
  const sky = g.createLinearGradient(0, r.y, 0, r.y + r.h);
  sky.addColorStop(0, LM.sky0);
  sky.addColorStop(0.45, LM.sky1);
  sky.addColorStop(1, LM.sky2);
  g.fillStyle = sky;
  g.fillRect(r.x, r.y, r.w, r.h);
}

/** A Midtown skyline along a baseline: blocks with a few lit windows (seeded, so it's the same every time). */
function skyline(g: CanvasRenderingContext2D, x0: number, x1: number, base: number, maxH: number, seed: number) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let x = x0;
  while (x < x1) {
    const w = 14 + rnd() * 30,
      h = maxH * (0.35 + rnd() * 0.65);
    g.fillStyle = rnd() < 0.5 ? '#120c0d' : '#17100f';
    g.fillRect(x, base - h, w, h);
    if (rnd() < 0.25) g.fillRect(x + w / 2 - 1, base - h - 10, 2, 10);
    for (let wy = base - h + 6; wy < base - 6; wy += 7)
      for (let wx = x + 3; wx < x + w - 4; wx += 6) {
        if (rnd() < 0.16) {
          g.fillStyle = rnd() < 0.7 ? 'rgba(255,194,61,0.55)' : 'rgba(255,217,184,0.4)';
          g.fillRect(wx, wy, 2, 3);
        }
      }
    x += w + 2;
  }
}

/** A cross street seen from above: asphalt, yellow centre line, a zebra crossing, kerbs. */
function street(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  g.fillStyle = LM.road;
  g.fillRect(x, y, w, h);
  g.fillStyle = LM.lane;
  for (let lx = x + 6; lx < x + w; lx += 34) g.fillRect(lx, y + h / 2 - 2, 18, 4);
  g.fillStyle = 'rgba(230,226,220,0.75)';
  for (let k = 0; k < 6; k++) g.fillRect(x + w * 0.62 + k * 9, y + 4, 5, h - 8);
  g.fillStyle = LM.curb;
  g.fillRect(x, y - 3, w, 3);
  g.fillRect(x, y + h, w, 3);
}

/** A yellow cab from above-and-front, as a few blocks (the game's voxel look). */
function cab(g: CanvasRenderingContext2D, x: number, y: number, s: number, flip = false) {
  g.save();
  g.translate(x, y);
  if (flip) g.scale(-1, 1);
  g.fillStyle = '#9c7a12';
  g.fillRect(-s * 1.1, -s * 0.2, s * 2.2, s * 0.55);
  g.fillStyle = LM.cab;
  g.fillRect(-s * 1.1, -s * 0.55, s * 2.2, s * 0.4);
  g.fillStyle = '#2a2a33';
  g.fillRect(-s * 0.45, -s * 0.85, s * 0.95, s * 0.32);
  g.fillStyle = '#fff0bd';
  g.fillRect(s * 0.95, -s * 0.28, s * 0.15, s * 0.12);
  g.fillStyle = '#ff4f3a';
  g.fillRect(-s * 1.1, -s * 0.28, s * 0.12, s * 0.12);
  g.restore();
}

function glowLine(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, col: string, w = 3) {
  g.save();
  g.strokeStyle = col;
  g.lineCap = 'round';
  g.globalAlpha = 0.2;
  g.lineWidth = w * 4;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  g.globalAlpha = 1;
  g.lineWidth = w;
  g.stroke();
  g.restore();
}

function marquee(g: CanvasRenderingContext2D, r: LmRect) {
  skyGradient(g, r);
  // The horizon: rust glow and the skyline against it.
  const hz = g.createLinearGradient(0, r.y + r.h * 0.45, 0, r.y + r.h);
  hz.addColorStop(0, 'rgba(201,72,10,0)');
  hz.addColorStop(1, 'rgba(201,72,10,0.55)');
  g.fillStyle = hz;
  g.fillRect(r.x, r.y, r.w, r.h);
  skyline(g, r.x, r.x + r.w, r.y + r.h - 6, r.h * 0.5, 7);
  g.fillStyle = LM.deep;
  g.fillRect(r.x, r.y + r.h - 6, r.w, 6);
  // Shade behind the title so it reads over the windows.
  const sh = g.createRadialGradient(r.x + r.w / 2, r.y + r.h * 0.5, 10, r.x + r.w / 2, r.y + r.h * 0.5, r.w * 0.5);
  sh.addColorStop(0, 'rgba(8,5,3,0.75)');
  sh.addColorStop(1, 'rgba(8,5,3,0)');
  g.fillStyle = sh;
  g.fillRect(r.x, r.y, r.w, r.h);
  g.save();
  g.shadowColor = 'rgba(255,106,19,0.8)';
  g.shadowBlur = 14;
  titleLockup(g, r.x + r.w / 2, r.y + 70, 56);
  g.restore();
  titleLockup(g, r.x + r.w / 2, r.y + 70, 56);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font(15);
  g.fillStyle = LM.pale;
  g.fillText('Every minute counts. Every deal matters.', r.x + r.w / 2, r.y + 98);
  // Orange tube along the top and bottom edges.
  glowLine(g, r.x + 8, r.y + 5, r.x + r.w - 8, r.y + 5, LM.brand, 2);
}

function bezel(g: CanvasRenderingContext2D, r: LmRect) {
  g.fillStyle = '#0b0a0d';
  g.fillRect(r.x, r.y, r.w, r.h);
  // An orange keyline round where the screen sits, and the game's credit under it.
  g.strokeStyle = LM.deep;
  g.lineWidth = 3;
  g.strokeRect(r.x + 12, r.y + 8, r.w - 24, r.h - 16);
  g.strokeStyle = 'rgba(255,106,19,0.35)';
  g.lineWidth = 1;
  g.strokeRect(r.x + 6, r.y + 3, r.w - 12, r.h - 6);
}

function panel(g: CanvasRenderingContext2D, r: LmRect, stickU: number, buttons: { u: number; label: string; col: string }[]) {
  const pg = g.createLinearGradient(0, r.y, 0, r.y + r.h);
  pg.addColorStop(0, '#17110f');
  pg.addColorStop(1, '#0c0a0b');
  g.fillStyle = pg;
  g.fillRect(r.x, r.y, r.w, r.h);
  // Lane lines across the panel, like the street.
  g.fillStyle = 'rgba(201,178,74,0.35)';
  for (let x = r.x + 8; x < r.x + r.w; x += 40) g.fillRect(x, r.y + r.h - 14, 22, 4);
  glowLine(g, r.x + 4, r.y + 4, r.x + r.w - 4, r.y + 4, LM.brand, 2);
  // The stick's washer and arrows; rings and labels under the buttons. (v runs back to front: the panel's far edge is at the top.)
  const cy = r.y + r.h * 0.5;
  const sx = r.x + stickU * r.w;
  g.fillStyle = '#26201d';
  g.beginPath();
  g.arc(sx, cy, 26, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = LM.pale;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font(13);
  for (const [dx, dy, s] of [
    [0, -36, '▲'],
    [0, 38, '▼'],
    [-38, 0, '◀'],
    [38, 0, '▶'],
  ] as const)
    g.fillText(s, sx + dx, cy + dy);
  for (const b of buttons) {
    const bx = r.x + b.u * r.w;
    g.fillStyle = '#d8d8e0';
    g.beginPath();
    g.arc(bx, cy - 6, 19, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0c0a0b';
    g.beginPath();
    g.arc(bx, cy - 6, 16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = b.col;
    g.font = font(13);
    g.fillText(b.label, bx, cy + 26);
  }
}

function door(g: CanvasRenderingContext2D, r: LmRect) {
  skyGradient(g, r);
  // Two streets and the pavement between: the game's board.
  g.fillStyle = '#2c2a2d';
  g.fillRect(r.x, r.y + 40, r.w, r.h - 80);
  street(g, r.x, r.y + 70, r.w, 70);
  street(g, r.x, r.y + 200, r.w, 70);
  cab(g, r.x + 120, r.y + 118, 22);
  cab(g, r.x + 420, r.y + 248, 22, true);
  // A FREE PLAY plate where the coin slots would be.
  const px = r.x + r.w / 2,
    py = r.y + r.h / 2 - 2;
  g.fillStyle = 'rgba(8,5,3,0.88)';
  g.fillRect(px - 150, py - 34, 300, 68);
  g.strokeStyle = LM.brand;
  g.lineWidth = 3;
  g.strokeRect(px - 150, py - 34, 300, 68);
  g.fillStyle = LM.amber;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font(38);
  g.fillText('FREE PLAY', px, py + 1);
  g.fillStyle = LM.dim;
  g.font = font(13, '600');
  g.fillText('A GAME BY CHRISTOPHER G. HUNT  ·  THELASTMILE.LIVE', px, r.y + r.h - 18);
}

function side(g: CanvasRenderingContext2D, r: LmRect) {
  skyGradient(g, r);
  // Right is the cabinet's front. Top: skyline and the horizon glow; then the streets, uptown to downtown.
  const hz = g.createLinearGradient(0, r.y + 120, 0, r.y + 330);
  hz.addColorStop(0, 'rgba(201,72,10,0)');
  hz.addColorStop(1, 'rgba(201,72,10,0.6)');
  g.fillStyle = hz;
  g.fillRect(r.x, r.y + 120, r.w, 210);
  skyline(g, r.x, r.x + r.w, r.y + 330, 150, 11);
  g.fillStyle = '#2c2a2d';
  g.fillRect(r.x, r.y + 330, r.w, r.h - 330);
  for (let k = 0; k < 5; k++) street(g, r.x, r.y + 380 + k * 128, r.w, 64);
  cab(g, r.x + 90, r.y + 425, 20);
  cab(g, r.x + 330, r.y + 556, 20, true);
  cab(g, r.x + 200, r.y + 680, 20);
  cab(g, r.x + 60, r.y + 812, 20, true);
  // The walker's route: an orange trace up the crossings.
  g.save();
  g.setLineDash([14, 10]);
  glowLine(g, r.x + r.w * 0.68, r.y + r.h - 20, r.x + r.w * 0.68, r.y + 360, LM.brand, 4);
  g.restore();
  // The title, stacked, in the clear sky at the back-top of the panel.
  g.save();
  g.translate(r.x + r.w * 0.3, r.y + 70);
  g.shadowColor = 'rgba(255,106,19,0.8)';
  g.shadowBlur = 12;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.font = font(46);
  g.fillStyle = LM.brand;
  g.fillText('THE LAST', 0, 0);
  g.fillStyle = LM.text;
  g.fillText('MILE', 0, 48);
  g.restore();
  // A street sign: the start of the walk.
  const sx = r.x + r.w * 0.72,
    sy = r.y + r.h - 120;
  g.fillStyle = '#8a8a90';
  g.fillRect(sx - 3, sy, 6, 110);
  g.fillStyle = LM.sign;
  g.fillRect(sx - 70, sy - 26, 140, 30);
  g.strokeStyle = '#e8efe9';
  g.lineWidth = 2;
  g.strokeRect(sx - 67, sy - 23, 134, 24);
  g.fillStyle = '#f3f6f2';
  g.font = font(16);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('W 35 ST', sx, sy - 11);
}

/** Paints all of it. `stickU` and `buttons` place the panel print under the real controls (u across the panel, 0..1). */
export function paintLastMile(g: CanvasRenderingContext2D, stickU: number, buttons: { u: number; label: string; col: string }[]) {
  g.fillStyle = LM.bg;
  g.fillRect(0, 0, ART, ART);
  side(g, LM_REGION.side);
  marquee(g, LM_REGION.marquee);
  bezel(g, LM_REGION.bezel);
  panel(g, LM_REGION.panel, stickU, buttons);
  door(g, LM_REGION.door);
  SWATCHES.forEach((c, i) => {
    g.fillStyle = c;
    g.fillRect(470 + (i % 20) * 26, 904 + Math.floor(i / 20) * 26, 24, 24);
  });
}

/** The screen when the game isn't running: its title card, or a status line (loading, a friend's game). */
export function paintScreenCard(g: CanvasRenderingContext2D, w: number, h: number, line: string, t = 0) {
  const r = { x: 0, y: 0, w, h };
  skyGradient(g, r);
  const hz = g.createLinearGradient(0, h * 0.55, 0, h);
  hz.addColorStop(0, 'rgba(201,72,10,0)');
  hz.addColorStop(1, 'rgba(201,72,10,0.5)');
  g.fillStyle = hz;
  g.fillRect(0, 0, w, h);
  skyline(g, 0, w, h * 0.86, h * 0.3, 5);
  g.fillStyle = LM.deep;
  g.fillRect(0, h * 0.86, w, 4);
  const big = Math.round(h * 0.12);
  titleLockup(g, w / 2, h * 0.42, big);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font(Math.round(h * 0.035));
  g.fillStyle = LM.dim;
  g.fillText('Every minute counts. Every deal matters.', w / 2, h * 0.52);
  g.globalAlpha = 0.6 + 0.4 * Math.sin(t * 3);
  g.font = font(Math.round(h * 0.05));
  g.fillStyle = LM.brand;
  g.fillText(line, w / 2, h * 0.68);
  g.globalAlpha = 1;
}

/** The banner over a friend's game. */
export function paintNowPlaying(g: CanvasRenderingContext2D, w: number, h: number, name: string) {
  const bh = Math.round(h * 0.075);
  g.fillStyle = 'rgba(8,5,3,0.78)';
  g.fillRect(0, h - bh, w, bh);
  g.fillStyle = LM.brand;
  g.fillRect(0, h - bh, w, 2);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font(Math.round(bh * 0.5));
  g.fillStyle = LM.pale;
  g.fillText(`NOW PLAYING: ${name.toUpperCase()}`, w / 2, h - bh / 2 + 1);
}

/** A speaker and three level bars (`bars` of them lit; none lit is a cross for mute), fitting `size` high from (x, y) top-left. Returns the width drawn. */
function volumeGlyph(g: CanvasRenderingContext2D, x: number, y: number, size: number, bars: number, on: string, off: string): number {
  const s = size;
  // The speaker.
  g.fillStyle = on;
  g.beginPath();
  g.moveTo(x, y + s * 0.34);
  g.lineTo(x + s * 0.22, y + s * 0.34);
  g.lineTo(x + s * 0.5, y + s * 0.08);
  g.lineTo(x + s * 0.5, y + s * 0.92);
  g.lineTo(x + s * 0.22, y + s * 0.66);
  g.lineTo(x, y + s * 0.66);
  g.closePath();
  g.fill();
  let bx = x + s * 0.68;
  const bw = s * 0.2,
    gap = s * 0.12;
  for (let i = 0; i < 3; i++) {
    const bh = s * (0.4 + 0.3 * i);
    g.fillStyle = i < bars ? on : off;
    g.fillRect(bx, y + s - bh, bw, bh);
    bx += bw + gap;
  }
  if (!bars) {
    // A cross over the empty bars.
    g.strokeStyle = on;
    g.lineWidth = Math.max(2, s * 0.1);
    g.lineCap = 'round';
    const x0 = x + s * 0.68,
      x1 = bx - gap;
    g.beginPath();
    g.moveTo(x0, y + s * 0.2);
    g.lineTo(x1, y + s * 0.9);
    g.moveTo(x1, y + s * 0.2);
    g.lineTo(x0, y + s * 0.9);
    g.stroke();
  }
  return bx - gap - x;
}

/** The volume, briefly over the game after a SOUND press: "VOL", the bars and the percent, centred under the game's top bar. */
export function paintVolumeOverlay(g: CanvasRenderingContext2D, w: number, h: number, bars: number, percent: number, alpha = 1) {
  if (alpha <= 0) return;
  const s = Math.round(h * 0.07);
  const pad = s * 0.45;
  g.save();
  g.globalAlpha = Math.min(1, alpha);
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = font(Math.round(s * 0.62));
  const tail = bars ? `${percent}%` : 'MUTE';
  const lw = g.measureText('VOL').width,
    tw = g.measureText('100%').width,
    gw = s * 1.52;
  const pw = pad + lw + pad + gw + pad + tw + pad,
    ph = s * 1.7;
  const x = Math.round((w - pw) / 2),
    y = Math.round(h * 0.16);
  g.fillStyle = 'rgba(8,5,3,0.86)';
  g.fillRect(x, y, pw, ph);
  g.fillStyle = LM.brand;
  g.fillRect(x, y + ph - 3, pw, 3);
  g.fillStyle = LM.text;
  g.fillText('VOL', x + pad, y + ph / 2);
  const gx = x + pad + lw + pad;
  volumeGlyph(g, gx, y + (ph - s) / 2, s, bars, LM.brand, 'rgba(253,244,238,0.22)');
  g.fillStyle = bars ? LM.text : LM.dim;
  g.fillText(tail, gx + gw + pad, y + ph / 2);
  g.restore();
}

/** The small level badge by the SOUND button (always shows the level). */
export function paintVolumeBadge(g: CanvasRenderingContext2D, w: number, h: number, bars: number) {
  g.fillStyle = '#0c0a0b';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(58,216,255,0.55)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, w - 2, h - 2);
  const s = h * 0.62;
  const gw = s * 1.52;
  volumeGlyph(g, (w - gw) / 2, (h - s) / 2, s, bars, '#3ad8ff', 'rgba(58,216,255,0.18)');
}
