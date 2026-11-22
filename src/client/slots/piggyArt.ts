/**
 * Original procedural art for Porkbelly Payday (county-fair theme): golden pig
 * wild, red barn, blue ribbon, sweet corn, candy apple and the pig coin.
 */
import { paintSymbol } from './symbols';
import type { Coin } from '../../rules/piggy';

type Ctx = CanvasRenderingContext2D;
const SERIF = 'Georgia, "Times New Roman", serif';

function gold(ctx: Ctx, y0: number, y1: number) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#fff6cc');
  g.addColorStop(0.45, '#f0c050');
  g.addColorStop(0.6, '#b8801e');
  g.addColorStop(1, '#ffe08a');
  return g;
}

/** A cartoon pig face; used for the wild (gold) and the coin emblem. */
export function pigFace(ctx: Ctx, cx: number, cy: number, r: number, skin: string | CanvasGradient, dark: string) {
  ctx.save();
  ctx.lineWidth = r * 0.06;
  ctx.strokeStyle = dark;
  // Ears.
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + s * r * 0.45, cy - r * 0.62);
    ctx.lineTo(cx + s * r * 0.95, cy - r * 1.0);
    ctx.lineTo(cx + s * r * 0.85, cy - r * 0.35);
    ctx.closePath();
    ctx.fillStyle = skin;
    ctx.fill();
    ctx.stroke();
  }
  // Head.
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r * 0.86, 0, 0, Math.PI * 2);
  ctx.fillStyle = skin;
  ctx.fill();
  ctx.stroke();
  // Cheeks.
  ctx.fillStyle = 'rgba(255,120,140,0.35)';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + s * r * 0.58, cy + r * 0.2, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }
  // Eyes.
  ctx.fillStyle = '#1a0e08';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + s * r * 0.36, cy - r * 0.22, r * 0.1, r * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx + s * r * 0.33, cy - r * 0.27, r * 0.04, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a0e08';
  }
  // Snout.
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.28, r * 0.42, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fillStyle = skin;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = dark;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + s * r * 0.14, cy + r * 0.28, r * 0.07, r * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function wildPig(ctx: Ctx, s: number) {
  const g = gold(ctx, s * 0.15, s * 0.9);
  ctx.shadowColor = '#ffd060';
  ctx.shadowBlur = s * 0.08;
  pigFace(ctx, s / 2, s * 0.5, s * 0.33, g, '#6a3e08');
  ctx.shadowBlur = 0;
  ctx.font = `bold ${s * 0.2}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = s * 0.035;
  ctx.strokeStyle = '#3a1a04';
  ctx.strokeText('WILD', s / 2, s * 0.88);
  ctx.fillStyle = '#fff1b8';
  ctx.fillText('WILD', s / 2, s * 0.88);
}

function barn(ctx: Ctx, s: number) {
  const x0 = s * 0.17,
    x1 = s * 0.83,
    yR = s * 0.42,
    yB = s * 0.84;
  // Roof.
  ctx.beginPath();
  ctx.moveTo(s * 0.1, yR + s * 0.02);
  ctx.lineTo(s * 0.28, s * 0.22);
  ctx.lineTo(s * 0.72, s * 0.22);
  ctx.lineTo(s * 0.9, yR + s * 0.02);
  ctx.closePath();
  ctx.fillStyle = '#3a2a24';
  ctx.fill();
  // Walls.
  const w = ctx.createLinearGradient(0, yR, 0, yB);
  w.addColorStop(0, '#e0383a');
  w.addColorStop(1, '#8a1216');
  ctx.fillStyle = w;
  ctx.fillRect(x0, yR, x1 - x0, yB - yR);
  ctx.strokeStyle = '#fff4e6';
  ctx.lineWidth = s * 0.025;
  ctx.strokeRect(x0, yR, x1 - x0, yB - yR);
  // Door with the white X.
  const dx0 = s * 0.38,
    dx1 = s * 0.62,
    dy0 = s * 0.56;
  ctx.fillStyle = '#a01c20';
  ctx.fillRect(dx0, dy0, dx1 - dx0, yB - dy0);
  ctx.strokeRect(dx0, dy0, dx1 - dx0, yB - dy0);
  ctx.beginPath();
  ctx.moveTo(dx0, dy0);
  ctx.lineTo(dx1, yB);
  ctx.moveTo(dx1, dy0);
  ctx.lineTo(dx0, yB);
  ctx.stroke();
  // Loft window.
  ctx.fillStyle = '#ffe08a';
  ctx.fillRect(s * 0.45, s * 0.3, s * 0.1, s * 0.09);
  ctx.strokeRect(s * 0.45, s * 0.3, s * 0.1, s * 0.09);
}

function ribbon(ctx: Ctx, s: number) {
  const cx = s / 2,
    cy = s * 0.4;
  // Tails.
  ctx.fillStyle = '#1846b0';
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * s * 0.05, cy);
    ctx.lineTo(cx + sx * s * 0.22, s * 0.9);
    ctx.lineTo(cx + sx * s * 0.13, s * 0.82);
    ctx.lineTo(cx + sx * s * 0.06, s * 0.92);
    ctx.lineTo(cx - sx * s * 0.04, cy);
    ctx.fill();
  }
  // Rosette petals.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * s * 0.2, cy + Math.sin(a) * s * 0.2, s * 0.1, s * 0.06, a, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 ? '#2a62d8' : '#1a44a8';
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.17, 0, Math.PI * 2);
  ctx.fillStyle = gold(ctx, cy - s * 0.17, cy + s * 0.17);
  ctx.fill();
  ctx.font = `bold ${s * 0.2}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#5a2e04';
  ctx.fillText('1st', cx, cy + s * 0.01);
}

function corn(ctx: Ctx, s: number) {
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.rotate(-0.35);
  // Husk leaves.
  ctx.fillStyle = '#3a9a3a';
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0, s * 0.36);
    ctx.quadraticCurveTo(sx * s * 0.3, s * 0.1, sx * s * 0.14, -s * 0.18);
    ctx.quadraticCurveTo(sx * s * 0.1, s * 0.15, 0, s * 0.36);
    ctx.fill();
  }
  // Cob with kernels.
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.04, s * 0.13, s * 0.34, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#e8a81a';
  ctx.fill();
  ctx.clip();
  for (let row = -9; row <= 9; row++) {
    for (let col = -3; col <= 3; col++) {
      const x = col * s * 0.045 + (row % 2) * s * 0.022;
      const y = row * s * 0.037 - s * 0.04;
      ctx.beginPath();
      ctx.ellipse(x, y, s * 0.02, s * 0.016, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd650';
      ctx.fill();
    }
  }
  ctx.restore();
}

function apple(ctx: Ctx, s: number) {
  const cx = s / 2,
    cy = s * 0.55;
  // Stick.
  ctx.fillStyle = '#d8b07a';
  ctx.fillRect(cx - s * 0.02, s * 0.08, s * 0.04, s * 0.3);
  // Apple with glossy candy coat.
  const g = ctx.createRadialGradient(cx - s * 0.1, cy - s * 0.1, s * 0.03, cx, cy, s * 0.32);
  g.addColorStop(0, '#ff8a8a');
  g.addColorStop(0.4, '#e0141e');
  g.addColorStop(1, '#6a0408');
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.2);
  ctx.bezierCurveTo(cx + s * 0.38, cy - s * 0.38, cx + s * 0.42, cy + s * 0.3, cx, cy + s * 0.3);
  ctx.bezierCurveTo(cx - s * 0.42, cy + s * 0.3, cx - s * 0.38, cy - s * 0.38, cx, cy - s * 0.2);
  ctx.fillStyle = g;
  ctx.fill();
  // Drip line.
  ctx.fillStyle = '#b00c14';
  ctx.beginPath();
  ctx.ellipse(cx, cy + s * 0.27, s * 0.22, s * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.12, cy - s * 0.06, s * 0.04, s * 0.09, 0.5, 0, Math.PI * 2);
  ctx.fill();
}

/** The pig coin face (value is drawn on top separately). */
export function coin(ctx: Ctx, s: number, tint: 'gold' | 'jackpot' = 'gold') {
  const cx = s / 2,
    cy = s / 2,
    r = s * 0.42;
  ctx.shadowColor = tint === 'jackpot' ? '#ff60c0' : '#ffcc40';
  ctx.shadowBlur = s * 0.08;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = gold(ctx, cy - r, cy + r);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = s * 0.03;
  ctx.strokeStyle = '#8a5a10';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(120,70,10,0.6)';
  ctx.lineWidth = s * 0.015;
  ctx.stroke();
  // Pig emblem in relief, faint, behind the value.
  ctx.globalAlpha = 0.35;
  pigFace(ctx, cx, cy - s * 0.02, r * 0.5, '#e8b040', '#8a5a10');
  ctx.globalAlpha = 1;
}

export function paintPiggySymbol(ctx: Ctx, id: string, s: number) {
  ctx.save();
  switch (id) {
    case 'WILD':
      wildPig(ctx, s);
      break;
    case 'BARN':
      barn(ctx, s);
      break;
    case 'RIBBON':
      ribbon(ctx, s);
      break;
    case 'CORN':
      corn(ctx, s);
      break;
    case 'APPLE':
      apple(ctx, s);
      break;
    case 'COIN':
      coin(ctx, s);
      break;
    default:
      paintSymbol(ctx, 'porkbelly-payday', id, s);
  }
  ctx.restore();
}

export function piggyAtlas(ids: string[], cell: number) {
  const c = document.createElement('canvas');
  c.width = cell * ids.length;
  c.height = cell;
  const ctx = c.getContext('2d')!;
  const index = new Map<string, number>();
  ids.forEach((id, i) => {
    index.set(id, i);
    ctx.save();
    ctx.translate(i * cell, 0);
    paintPiggySymbol(ctx, id, cell);
    ctx.restore();
  });
  return { canvas: c, index };
}

/** Value text on a coin: a dollar amount or the jackpot name. */
export function coinLabel(c: Coin, bet: number, red = false): string {
  if (c.jackpot) return c.jackpot;
  const v = c.mult * bet * (red ? 2 : 1);
  return v >= 1000 ? `$${(v / 1000).toFixed(v % 1000 ? 1 : 0)}K` : v % 1 ? `$${v.toFixed(2)}` : `$${v}`;
}

export function paintCoinLabel(ctx: Ctx, text: string, cx: number, cy: number, s: number, jackpot: boolean) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = s * (text.length > 5 ? 0.2 : text.length > 3 ? 0.25 : 0.3);
  ctx.font = `bold ${size}px ${SERIF}`;
  ctx.lineWidth = s * 0.04;
  ctx.strokeStyle = jackpot ? '#4a0630' : '#3a1a02';
  ctx.strokeText(text, cx, cy);
  ctx.fillStyle = jackpot ? '#ffe0f4' : '#fffbe8';
  ctx.fillText(text, cx, cy);
  ctx.restore();
}
