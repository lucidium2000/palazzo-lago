/**
 * Original procedural art for Porkbelly Payday, drawn at high resolution with
 * gradients, bevels, rim lights and drop shadows: purple jewel royals, Golden
 * Piggy Bank, Gold Bars, Vault, Money Bag, Wild badge, the gold "?" Mystery
 * coin, the coloured bank coins and the on-screen piggy bank portraits.
 */

type Ctx = CanvasRenderingContext2D;
const SERIF = 'Georgia, "Times New Roman", serif';
const DISPLAY = '"Arial Black", "Helvetica Neue", Arial, sans-serif';

function goldGrad(ctx: Ctx, y0: number, y1: number) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#fffbe0');
  g.addColorStop(0.22, '#ffe27a');
  g.addColorStop(0.5, '#e0a020');
  g.addColorStop(0.62, '#a86a08');
  g.addColorStop(0.85, '#f0c040');
  g.addColorStop(1, '#fff0a0');
  return g;
}

function shadow(ctx: Ctx, s: number, blur = 0.06, dy = 0.025, color = 'rgba(0,0,0,0.55)') {
  ctx.shadowColor = color;
  ctx.shadowBlur = s * blur;
  ctx.shadowOffsetY = s * dy;
}
function noShadow(ctx: Ctx) {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/** A soft white gloss ellipse (specular highlight). */
function gloss(ctx: Ctx, x: number, y: number, rx: number, ry: number, rot = -0.4, a = 0.7) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
  g.addColorStop(0, `rgba(255,255,255,${a})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(1, ry / rx);
  ctx.translate(-x, -y);
  ctx.beginPath();
  ctx.arc(x, y, rx, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

function sparkle(ctx: Ctx, x: number, y: number, r: number) {
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = r * 2;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rr = i % 2 ? r * 0.25 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Purple jewel royals
// ---------------------------------------------------------------------------

const ROYAL_HUES: Record<string, [string, string, string]> = {
  A: ['#f0c8ff', '#9a30e0', '#3a0868'],
  K: ['#dcd0ff', '#6a48e8', '#1e1070'],
  Q: ['#ffc8f0', '#c030b0', '#4a0848'],
  J: ['#e8d0ff', '#8a40d0', '#30105a'],
  T: ['#f4d8ff', '#a858d8', '#3c1460'],
};

function royal(ctx: Ctx, s: number, id: string) {
  const text = id === 'T' ? '10' : id;
  const [hi, mid, dark] = ROYAL_HUES[id];
  const size = s * (text.length > 1 ? 0.56 : 0.7);
  ctx.font = `900 ${size}px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const x = s / 2,
    y = s * 0.54;
  // Drop shadow + thick dark outline.
  shadow(ctx, s, 0.05, 0.03);
  ctx.lineJoin = 'round';
  ctx.lineWidth = s * 0.07;
  ctx.strokeStyle = '#1a0628';
  ctx.strokeText(text, x, y);
  noShadow(ctx);
  // Gold rim.
  ctx.lineWidth = s * 0.035;
  ctx.strokeStyle = goldGrad(ctx, y - size / 2, y + size / 2);
  ctx.strokeText(text, x, y);
  // Jewel body.
  const g = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
  g.addColorStop(0, hi);
  g.addColorStop(0.45, mid);
  g.addColorStop(0.55, dark);
  g.addColorStop(1, mid);
  ctx.fillStyle = g;
  ctx.fillText(text, x, y);
  // Upper facet highlight, clipped to the glyph via source-atop.
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(0, y - size * 0.5, s, size * 0.38);
  ctx.restore();
  sparkle(ctx, x + size * 0.22, y - size * 0.3, s * 0.05);
}

// ---------------------------------------------------------------------------
// Premium symbols
// ---------------------------------------------------------------------------

function piggyBankSide(ctx: Ctx, s: number) {
  const cx = s * 0.5,
    cy = s * 0.53,
    rx = s * 0.34,
    ry = s * 0.27;
  shadow(ctx, s, 0.08, 0.03);
  // Legs.
  ctx.fillStyle = '#b07810';
  for (const lx of [-0.2, -0.05, 0.12, 0.24]) {
    ctx.beginPath();
    ctx.roundRect(cx + lx * s - s * 0.04, cy + ry * 0.6, s * 0.08, s * 0.15, s * 0.03);
    ctx.fill();
  }
  // Body.
  const g = ctx.createRadialGradient(cx - rx * 0.35, cy - ry * 0.45, s * 0.02, cx, cy, rx * 1.1);
  g.addColorStop(0, '#fffbd8');
  g.addColorStop(0.3, '#ffd24a');
  g.addColorStop(0.75, '#d08a10');
  g.addColorStop(1, '#7a4a04');
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  noShadow(ctx);
  ctx.lineWidth = s * 0.022;
  ctx.strokeStyle = '#5a3404';
  ctx.stroke();
  // Ear.
  ctx.beginPath();
  ctx.moveTo(cx + rx * 0.35, cy - ry * 0.75);
  ctx.lineTo(cx + rx * 0.55, cy - ry * 1.35);
  ctx.lineTo(cx + rx * 0.72, cy - ry * 0.6);
  ctx.closePath();
  ctx.fillStyle = '#f0b830';
  ctx.fill();
  ctx.stroke();
  // Snout.
  const sx = cx + rx * 0.98,
    sy = cy + ry * 0.05;
  ctx.beginPath();
  ctx.ellipse(sx, sy, s * 0.07, s * 0.09, 0, 0, Math.PI * 2);
  const sg = ctx.createLinearGradient(sx - s * 0.07, 0, sx + s * 0.07, 0);
  sg.addColorStop(0, '#e8a020');
  sg.addColorStop(1, '#ffe080');
  ctx.fillStyle = sg;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#5a3404';
  for (const dy of [-0.03, 0.03]) {
    ctx.beginPath();
    ctx.ellipse(sx + s * 0.012, sy + dy * s, s * 0.014, s * 0.022, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Eye.
  ctx.fillStyle = '#2a1404';
  ctx.beginPath();
  ctx.ellipse(cx + rx * 0.55, cy - ry * 0.3, s * 0.025, s * 0.035, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx + rx * 0.53, cy - ry * 0.38, s * 0.01, 0, Math.PI * 2);
  ctx.fill();
  // Coin slot with a coin going in.
  ctx.fillStyle = '#3a2004';
  ctx.beginPath();
  ctx.roundRect(cx - s * 0.1, cy - ry * 0.98, s * 0.18, s * 0.025, s * 0.01);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.01, cy - ry * 1.18, s * 0.08, s * 0.06, 0, Math.PI, 0);
  ctx.fillStyle = goldGrad(ctx, cy - ry * 1.4, cy - ry);
  ctx.fill();
  ctx.lineWidth = s * 0.012;
  ctx.stroke();
  // Curly tail.
  ctx.beginPath();
  ctx.lineWidth = s * 0.02;
  ctx.strokeStyle = '#b07810';
  ctx.arc(cx - rx * 1.02, cy - ry * 0.25, s * 0.035, 0.5, Math.PI * 1.8);
  ctx.stroke();
  gloss(ctx, cx - rx * 0.35, cy - ry * 0.5, rx * 0.45, ry * 0.25, -0.2, 0.85);
  sparkle(ctx, cx - rx * 0.5, cy - ry * 0.55, s * 0.05);
}

function goldBars(ctx: Ctx, s: number) {
  const bar = (x: number, y: number, w: number, h: number) => {
    const t = h * 0.35;
    shadow(ctx, s, 0.05, 0.02);
    // Front face.
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w - t, y + t);
    ctx.lineTo(x + t, y + t);
    ctx.closePath();
    ctx.fillStyle = goldGrad(ctx, y + t, y + h);
    ctx.fill();
    noShadow(ctx);
    ctx.lineWidth = s * 0.012;
    ctx.strokeStyle = '#6a4004';
    ctx.stroke();
    // Top face.
    ctx.beginPath();
    ctx.moveTo(x + t, y + t);
    ctx.lineTo(x + w - t, y + t);
    ctx.lineTo(x + w - t * 1.5, y);
    ctx.lineTo(x + t * 1.5, y);
    ctx.closePath();
    const tg = ctx.createLinearGradient(0, y, 0, y + t);
    tg.addColorStop(0, '#fffbe0');
    tg.addColorStop(1, '#ffd050');
    ctx.fillStyle = tg;
    ctx.fill();
    ctx.stroke();
    ctx.font = `bold ${h * 0.32}px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(90,50,0,0.6)';
    ctx.fillText('999.9', x + w / 2, y + h * 0.7);
  };
  bar(s * 0.1, s * 0.56, s * 0.42, s * 0.24);
  bar(s * 0.48, s * 0.56, s * 0.42, s * 0.24);
  bar(s * 0.29, s * 0.3, s * 0.42, s * 0.24);
  sparkle(ctx, s * 0.62, s * 0.34, s * 0.06);
  sparkle(ctx, s * 0.2, s * 0.62, s * 0.04);
}

function vault(ctx: Ctx, s: number) {
  const cx = s / 2,
    cy = s / 2,
    r = s * 0.4;
  shadow(ctx, s, 0.08, 0.03);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = goldGrad(ctx, cy - r, cy + r);
  ctx.fill();
  noShadow(ctx);
  ctx.lineWidth = s * 0.015;
  ctx.strokeStyle = '#5a3404';
  ctx.stroke();
  // Steel door.
  const st = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.05, cx, cy, r * 0.85);
  st.addColorStop(0, '#ffffff');
  st.addColorStop(0.35, '#c8ccd8');
  st.addColorStop(0.8, '#6a7088');
  st.addColorStop(1, '#3a3e50');
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
  ctx.fillStyle = st;
  ctx.fill();
  ctx.strokeStyle = '#2a2a38';
  ctx.stroke();
  // Bolts.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r * 0.91, cy + Math.sin(a) * r * 0.91, s * 0.018, 0, Math.PI * 2);
    ctx.fillStyle = '#fff4c0';
    ctx.fill();
  }
  // Wheel handle.
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI + 0.3;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * r * 0.55, cy - Math.sin(a) * r * 0.55);
    ctx.lineTo(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55);
    ctx.lineWidth = s * 0.045;
    ctx.strokeStyle = '#3a2004';
    ctx.stroke();
    ctx.lineWidth = s * 0.028;
    ctx.strokeStyle = goldGrad(ctx, cy - r, cy + r);
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, s * 0.035, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd24a';
    ctx.fill();
    ctx.lineWidth = s * 0.01;
    ctx.strokeStyle = '#5a3404';
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.17, 0, Math.PI * 2);
  ctx.fillStyle = goldGrad(ctx, cy - r * 0.17, cy + r * 0.17);
  ctx.fill();
  ctx.stroke();
  gloss(ctx, cx - r * 0.35, cy - r * 0.45, r * 0.35, r * 0.18, -0.6, 0.6);
}

function moneyBag(ctx: Ctx, s: number) {
  const cx = s / 2;
  shadow(ctx, s, 0.08, 0.03);
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.1, s * 0.3);
  ctx.bezierCurveTo(cx - s * 0.42, s * 0.42, cx - s * 0.4, s * 0.88, cx, s * 0.88);
  ctx.bezierCurveTo(cx + s * 0.4, s * 0.88, cx + s * 0.42, s * 0.42, cx + s * 0.1, s * 0.3);
  ctx.closePath();
  const g = ctx.createRadialGradient(cx - s * 0.1, s * 0.5, s * 0.03, cx, s * 0.62, s * 0.38);
  g.addColorStop(0, '#9ae07a');
  g.addColorStop(0.5, '#3a9a3a');
  g.addColorStop(1, '#104a18');
  ctx.fillStyle = g;
  ctx.fill();
  noShadow(ctx);
  ctx.lineWidth = s * 0.02;
  ctx.strokeStyle = '#0a2a0c';
  ctx.stroke();
  // Neck and tied top.
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.1, s * 0.3);
  ctx.lineTo(cx - s * 0.16, s * 0.14);
  ctx.quadraticCurveTo(cx, s * 0.2, cx + s * 0.16, s * 0.14);
  ctx.lineTo(cx + s * 0.1, s * 0.3);
  ctx.fillStyle = '#4aaa48';
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(cx - s * 0.13, s * 0.27, s * 0.26, s * 0.05, s * 0.02);
  ctx.fillStyle = goldGrad(ctx, s * 0.27, s * 0.32);
  ctx.fill();
  ctx.stroke();
  // Dollar sign.
  ctx.font = `900 ${s * 0.36}px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = s * 0.03;
  ctx.strokeStyle = '#3a2004';
  ctx.strokeText('$', cx, s * 0.62);
  ctx.fillStyle = goldGrad(ctx, s * 0.45, s * 0.8);
  ctx.fillText('$', cx, s * 0.62);
  gloss(ctx, cx - s * 0.14, s * 0.48, s * 0.1, s * 0.05, -0.8, 0.5);
}

function wild(ctx: Ctx, s: number) {
  const cx = s / 2,
    cy = s / 2;
  // Ruby starburst badge.
  shadow(ctx, s, 0.08, 0.03);
  ctx.beginPath();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r = i % 2 ? s * 0.36 : s * 0.44;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(cx - s * 0.1, cy - s * 0.12, s * 0.02, cx, cy, s * 0.44);
  g.addColorStop(0, '#ff9ab0');
  g.addColorStop(0.45, '#e0102c');
  g.addColorStop(1, '#5a0010');
  ctx.fillStyle = g;
  ctx.fill();
  noShadow(ctx);
  ctx.lineWidth = s * 0.03;
  ctx.strokeStyle = goldGrad(ctx, cy - s * 0.44, cy + s * 0.44);
  ctx.stroke();
  ctx.font = `900 ${s * 0.27}px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = s * 0.05;
  ctx.strokeStyle = '#3a0408';
  ctx.strokeText('WILD', cx, cy + s * 0.02);
  ctx.fillStyle = goldGrad(ctx, cy - s * 0.12, cy + s * 0.14);
  ctx.fillText('WILD', cx, cy + s * 0.02);
  gloss(ctx, cx - s * 0.1, cy - s * 0.2, s * 0.2, s * 0.07, -0.3, 0.55);
  sparkle(ctx, cx + s * 0.25, cy - s * 0.22, s * 0.06);
}

/** The Mystery symbol: a gold coin-crate with an embossed "?". */
/**
 * The mystery symbol: a pair of lacquered double doors in a gold frame with a
 * big "?" across the seam. After the reels stop the two halves swing open to
 * reveal what's behind (a symbol, a wild, or a coloured coin).
 */
export function mystery(ctx: Ctx, s: number) {
  const x = s * 0.07,
    y = s * 0.07,
    w = s * 0.86;
  shadow(ctx, s, 0.08, 0.03);
  ctx.beginPath();
  ctx.roundRect(x, y, w, w, s * 0.1);
  ctx.fillStyle = goldGrad(ctx, y, y + w);
  ctx.fill();
  noShadow(ctx);
  ctx.lineWidth = s * 0.018;
  ctx.strokeStyle = '#6a3a04';
  ctx.stroke();
  // Two door leaves.
  const ix = x + s * 0.06,
    iy = y + s * 0.06,
    iw = w - s * 0.12;
  for (const side of [0, 1]) {
    const lx = ix + side * (iw / 2);
    const g = ctx.createLinearGradient(lx, iy, lx + iw / 2, iy + iw);
    g.addColorStop(0, '#8a2ad0');
    g.addColorStop(0.55, '#4a0e88');
    g.addColorStop(1, '#22053e');
    ctx.fillStyle = g;
    ctx.fillRect(lx, iy, iw / 2, iw);
    // Raised panels.
    ctx.strokeStyle = 'rgba(255,214,120,0.75)';
    ctx.lineWidth = s * 0.012;
    ctx.strokeRect(lx + s * 0.04, iy + s * 0.05, iw / 2 - s * 0.08, iw * 0.38);
    ctx.strokeRect(lx + s * 0.04, iy + iw * 0.52, iw / 2 - s * 0.08, iw * 0.4);
    // Handle by the seam.
    ctx.beginPath();
    ctx.arc(lx + (side ? s * 0.06 : iw / 2 - s * 0.06), iy + iw * 0.5, s * 0.022, 0, Math.PI * 2);
    ctx.fillStyle = '#ffe08a';
    ctx.fill();
  }
  ctx.fillStyle = '#1a0230';
  ctx.fillRect(s / 2 - s * 0.006, iy, s * 0.012, iw);
  ctx.font = `900 ${s * 0.56}px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = s * 0.05;
  ctx.strokeStyle = '#2a1004';
  ctx.strokeText('?', s / 2, s * 0.53);
  ctx.shadowColor = '#ffd040';
  ctx.shadowBlur = s * 0.1;
  ctx.fillStyle = goldGrad(ctx, s * 0.26, s * 0.8);
  ctx.fillText('?', s / 2, s * 0.53);
  noShadow(ctx);
  gloss(ctx, s * 0.3, s * 0.2, s * 0.2, s * 0.05, -0.2, 0.55);
}

// ---------------------------------------------------------------------------
// Coins
// ---------------------------------------------------------------------------

export const COIN_COLORS: Record<string, [string, string, string]> = {
  gold: ['#fff6cc', '#f0c050', '#8a5a10'],
  blue: ['#e0ecff', '#2a6aff', '#081c70'],
  yellow: ['#fffad0', '#ffc818', '#7a5004'],
  red: ['#ffe0e0', '#ff2a3a', '#6a0410'],
  MINI: ['#d8ffe4', '#30c060', '#064818'],
  MINOR: ['#d8eaff', '#3a88ff', '#082468'],
  MAXI: ['#f0dcff', '#a860ff', '#380a70'],
  MAJOR: ['#ffdcdc', '#ff3a3a', '#680808'],
  GRAND: ['#fff6cc', '#ffbe20', '#6a4404'],
  MEGA: ['#ffdcf0', '#ff40b0', '#680840'],
};

/** A glossy coloured coin embossed with a pig; `label` is drawn across it if given. */
export function colorCoin(ctx: Ctx, s: number, color: string, label?: string) {
  const [hi, mid, dark] = COIN_COLORS[color] ?? COIN_COLORS.gold;
  const cx = s / 2,
    cy = s / 2,
    r = s * 0.43;
  shadow(ctx, s, 0.1, 0.03, 'rgba(0,0,0,0.6)');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = dark;
  ctx.fill();
  noShadow(ctx);
  // Milled rim.
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9);
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.strokeStyle = i % 2 ? mid : hi;
    ctx.lineWidth = s * 0.012;
    ctx.stroke();
  }
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r * 0.95);
  g.addColorStop(0, hi);
  g.addColorStop(0.5, mid);
  g.addColorStop(1, dark);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.86, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = s * 0.012;
  ctx.strokeStyle = dark;
  ctx.stroke();
  // Embossed pig face.
  ctx.globalAlpha = 0.55;
  pigFace(ctx, cx, cy, r * 0.42, mid, dark);
  ctx.globalAlpha = 1;
  gloss(ctx, cx - r * 0.3, cy - r * 0.45, r * 0.45, r * 0.18, -0.5, 0.75);
  if (label) paintCoinLabel(ctx, label, cx, cy + s * 0.02, s, true);
}

/** A flat cartoon pig face used as the emblem on coins. */
export function pigFace(ctx: Ctx, cx: number, cy: number, r: number, skin: string | CanvasGradient, dark: string) {
  ctx.save();
  ctx.lineWidth = r * 0.08;
  ctx.strokeStyle = dark;
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + sgn * r * 0.45, cy - r * 0.62);
    ctx.lineTo(cx + sgn * r * 0.95, cy - r * 1.0);
    ctx.lineTo(cx + sgn * r * 0.85, cy - r * 0.35);
    ctx.closePath();
    ctx.fillStyle = skin;
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r * 0.86, 0, 0, Math.PI * 2);
  ctx.fillStyle = skin;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.28, r * 0.42, r * 0.3, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = dark;
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + sgn * r * 0.14, cy + r * 0.28, r * 0.07, r * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + sgn * r * 0.36, cy - r * 0.22, r * 0.08, r * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function paintCoinLabel(ctx: Ctx, text: string, cx: number, cy: number, s: number, strong: boolean) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = s * (text.length > 5 ? 0.17 : text.length > 3 ? 0.21 : 0.28);
  ctx.font = `900 ${size}px ${DISPLAY}`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = s * 0.045;
  ctx.strokeStyle = strong ? '#1a0410' : '#3a1a02';
  ctx.strokeText(text, cx, cy);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, cx, cy);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// On-screen piggy bank portraits
// ---------------------------------------------------------------------------

export const PIG_PALETTE: Record<string, [string, string, string]> = {
  blue: ['#cfe0ff', '#2a62e8', '#0a1a60'],
  yellow: ['#fff6c0', '#f8b818', '#6a4004'],
  red: ['#ffd0d4', '#e81c2c', '#5a0408'],
};

/**
 * A chubby glossy piggy bank facing the player. `fat` 0..1 widens the body;
 * `squash` > 0 squashes and stretches it (the gulp when a coin goes in).
 */
export function pigPortrait(ctx: Ctx, cx: number, cy: number, r: number, color: string, fat: number, squash = 0, glow = 0) {
  const [hi, mid, dark] = PIG_PALETTE[color];
  const sx = (1 + fat * 0.38) * (1 + squash * 0.12);
  const sy = (1 + fat * 0.12) * (1 - squash * 0.12);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(sx, sy);
  if (glow > 0) {
    ctx.shadowColor = mid;
    ctx.shadowBlur = r * 0.6 * glow;
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = r * 0.15;
    ctx.shadowOffsetY = r * 0.08;
  }
  // Legs (behind body).
  for (const lx of [-0.5, 0.5]) {
    const lg = ctx.createLinearGradient(0, r * 0.5, 0, r * 1.05);
    lg.addColorStop(0, mid);
    lg.addColorStop(1, dark);
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.roundRect(lx * r - r * 0.17, r * 0.5, r * 0.34, r * 0.52, r * 0.12);
    ctx.fill();
  }
  // Ears.
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(sgn * r * 0.35, -r * 0.72);
    ctx.quadraticCurveTo(sgn * r * 0.95, -r * 1.25, sgn * r * 0.88, -r * 0.42);
    ctx.closePath();
    const eg = ctx.createLinearGradient(0, -r * 1.2, 0, -r * 0.4);
    eg.addColorStop(0, hi);
    eg.addColorStop(1, mid);
    ctx.fillStyle = eg;
    ctx.fill();
  }
  // Body.
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.05, 0, 0, r * 1.05);
  g.addColorStop(0, hi);
  g.addColorStop(0.35, mid);
  g.addColorStop(0.85, dark);
  g.addColorStop(1, dark);
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.86, 0, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = r * 0.05;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.stroke();
  // Rim light on the right edge.
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.96, r * 0.82, 0, -0.9, 0.6);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = r * 0.04;
  ctx.stroke();
  // Gold coin slot on top.
  ctx.beginPath();
  ctx.roundRect(-r * 0.3, -r * 0.82, r * 0.6, r * 0.1, r * 0.05);
  ctx.fillStyle = '#1a0a04';
  ctx.fill();
  ctx.lineWidth = r * 0.04;
  ctx.strokeStyle = goldGrad(ctx, -r * 0.85, -r * 0.7);
  ctx.stroke();
  // Eyes.
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(sgn * r * 0.33, -r * 0.2, r * 0.13, r * 0.16, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(sgn * r * 0.31, -r * 0.17, r * 0.08, r * 0.11, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#140808';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sgn * r * 0.28, -r * 0.23, r * 0.03, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
  // Cheeks.
  ctx.fillStyle = 'rgba(255,140,170,0.45)';
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(sgn * r * 0.6, r * 0.12, r * 0.15, r * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Snout.
  const sg = ctx.createRadialGradient(-r * 0.08, r * 0.12, r * 0.02, 0, r * 0.22, r * 0.36);
  sg.addColorStop(0, hi);
  sg.addColorStop(1, mid);
  ctx.beginPath();
  ctx.ellipse(0, r * 0.22, r * 0.34, r * 0.24, 0, 0, Math.PI * 2);
  ctx.fillStyle = sg;
  ctx.fill();
  ctx.lineWidth = r * 0.035;
  ctx.strokeStyle = dark;
  ctx.stroke();
  ctx.fillStyle = dark;
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(sgn * r * 0.12, r * 0.22, r * 0.055, r * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Smile.
  ctx.beginPath();
  ctx.arc(0, r * 0.42, r * 0.16, 0.25, Math.PI - 0.25);
  ctx.lineWidth = r * 0.04;
  ctx.strokeStyle = dark;
  ctx.stroke();
  gloss(ctx, -r * 0.42, -r * 0.48, r * 0.32, r * 0.14, -0.6, 0.85);
  ctx.restore();
}

// ---------------------------------------------------------------------------

export function paintPiggySymbol(ctx: Ctx, id: string, s: number) {
  ctx.save();
  switch (id) {
    case 'WILD':
      wild(ctx, s);
      break;
    case 'BANK':
      piggyBankSide(ctx, s);
      break;
    case 'BARS':
      goldBars(ctx, s);
      break;
    case 'VAULT':
      vault(ctx, s);
      break;
    case 'BAG':
      moneyBag(ctx, s);
      break;
    case 'MYSTERY':
      mystery(ctx, s);
      break;
    default:
      royal(ctx, s, id);
  }
  ctx.restore();
}

/** Every symbol drawn once at `cell` px into a one-row atlas. */
export function piggyAtlas(ids: string[], cell: number) {
  const c = document.createElement('canvas');
  c.width = cell * ids.length;
  c.height = cell;
  const ctx = c.getContext('2d')!;
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
