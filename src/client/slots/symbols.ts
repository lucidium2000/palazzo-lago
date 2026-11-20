/**
 * Paints slot symbols onto a canvas atlas, one cell per symbol. Original,
 * procedural art: no licensed imagery.
 */
import type { Machine } from '../../rules/slots';

type Ctx = CanvasRenderingContext2D;
const SERIF = 'Georgia, "Times New Roman", serif';

function goldGrad(ctx: Ctx, y0: number, y1: number) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#fff3c4');
  g.addColorStop(0.45, '#e8b84e');
  g.addColorStop(0.55, '#b9822a');
  g.addColorStop(1, '#f6d77e');
  return g;
}

function glow(ctx: Ctx, color: string, blur: number) {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
}

function letter(ctx: Ctx, s: number, text: string, c1: string, c2: string) {
  const g = ctx.createLinearGradient(0, s * 0.2, 0, s * 0.8);
  g.addColorStop(0, c1);
  g.addColorStop(1, c2);
  ctx.font = `bold ${s * (text.length > 1 ? 0.5 : 0.62)}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = s * 0.05;
  ctx.strokeStyle = '#2a1a08';
  ctx.strokeText(text, s / 2, s * 0.54);
  glow(ctx, c1, s * 0.06);
  ctx.fillStyle = g;
  ctx.fillText(text, s / 2, s * 0.54);
  ctx.shadowBlur = 0;
  ctx.lineWidth = s * 0.012;
  ctx.strokeStyle = 'rgba(255,240,200,0.8)';
  ctx.strokeText(text, s / 2, s * 0.54);
}

function diamond(ctx: Ctx, s: number) {
  const cx = s / 2;
  const top = s * 0.24,
    mid = s * 0.42,
    bot = s * 0.82,
    w = s * 0.36;
  glow(ctx, '#7fe0ff', s * 0.12);
  const facets: [number[][], string][] = [
    [[[cx - w, mid], [cx - w * 0.55, top], [cx - w * 0.2, mid]], '#bdf3ff'],
    [[[cx - w * 0.2, mid], [cx - w * 0.55, top], [cx + w * 0.55, top], [cx + w * 0.2, mid]], '#e9fbff'],
    [[[cx + w * 0.2, mid], [cx + w * 0.55, top], [cx + w, mid]], '#9fe6ff'],
    [[[cx - w, mid], [cx - w * 0.2, mid], [cx, bot]], '#5cc8f0'],
    [[[cx - w * 0.2, mid], [cx + w * 0.2, mid], [cx, bot]], '#a8ecff'],
    [[[cx + w * 0.2, mid], [cx + w, mid], [cx, bot]], '#3aa7dc'],
  ];
  for (const [pts, col] of facets) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = s * 0.008;
  for (const [pts] of facets) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
  }
  // Sparkle.
  ctx.fillStyle = '#fff';
  star(ctx, cx + w * 0.55, top + s * 0.02, s * 0.07);
}

function star(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rr = i % 2 ? r * 0.25 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function seven(ctx: Ctx, s: number) {
  ctx.font = `bold ${s * 0.78}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = s * 0.07;
  ctx.strokeStyle = goldGrad(ctx, s * 0.15, s * 0.85);
  ctx.strokeText('7', s / 2, s * 0.53);
  const g = ctx.createLinearGradient(0, s * 0.15, 0, s * 0.85);
  g.addColorStop(0, '#ff6b5c');
  g.addColorStop(0.5, '#d4141e');
  g.addColorStop(1, '#7a050c');
  glow(ctx, '#ff3030', s * 0.08);
  ctx.fillStyle = g;
  ctx.fillText('7', s / 2, s * 0.53);
  ctx.shadowBlur = 0;
}

function bar(ctx: Ctx, s: number, n: number) {
  const h = s * 0.17,
    gap = s * 0.05;
  const total = n * h + (n - 1) * gap;
  for (let i = 0; i < n; i++) {
    const y = s / 2 - total / 2 + i * (h + gap);
    ctx.beginPath();
    ctx.roundRect(s * 0.14, y, s * 0.72, h, h * 0.3);
    ctx.fillStyle = '#121014';
    ctx.fill();
    ctx.lineWidth = s * 0.02;
    ctx.strokeStyle = goldGrad(ctx, y, y + h);
    ctx.stroke();
    ctx.fillStyle = goldGrad(ctx, y, y + h);
    ctx.font = `bold ${h * 0.78}px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BAR', s / 2, y + h * 0.55);
  }
}

function cherry(ctx: Ctx, s: number) {
  ctx.strokeStyle = '#3e7a2c';
  ctx.lineWidth = s * 0.035;
  ctx.beginPath();
  ctx.moveTo(s * 0.36, s * 0.62);
  ctx.quadraticCurveTo(s * 0.45, s * 0.3, s * 0.62, s * 0.2);
  ctx.moveTo(s * 0.66, s * 0.6);
  ctx.quadraticCurveTo(s * 0.64, s * 0.35, s * 0.62, s * 0.2);
  ctx.stroke();
  ctx.fillStyle = '#4f9a36';
  ctx.beginPath();
  ctx.ellipse(s * 0.72, s * 0.2, s * 0.12, s * 0.05, -0.4, 0, Math.PI * 2);
  ctx.fill();
  for (const [x, y] of [
    [0.34, 0.68],
    [0.66, 0.66],
  ]) {
    const g = ctx.createRadialGradient(s * (x - 0.05), s * (y - 0.05), s * 0.02, s * x, s * y, s * 0.16);
    g.addColorStop(0, '#ff9a9a');
    g.addColorStop(0.4, '#d61a2a');
    g.addColorStop(1, '#6a0510');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s * x, s * y, s * 0.15, 0, Math.PI * 2);
    ctx.fill();
  }
}

function crest(ctx: Ctx, s: number, text: string) {
  // A gold shield with a word across it.
  ctx.beginPath();
  ctx.moveTo(s * 0.5, s * 0.1);
  ctx.lineTo(s * 0.85, s * 0.22);
  ctx.quadraticCurveTo(s * 0.85, s * 0.68, s * 0.5, s * 0.92);
  ctx.quadraticCurveTo(s * 0.15, s * 0.68, s * 0.15, s * 0.22);
  ctx.closePath();
  glow(ctx, '#ffd36b', s * 0.1);
  ctx.fillStyle = goldGrad(ctx, s * 0.1, s * 0.92);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = s * 0.02;
  ctx.strokeStyle = '#6a4210';
  ctx.stroke();
  ctx.fillStyle = '#5a1020';
  ctx.beginPath();
  ctx.roundRect(s * 0.08, s * 0.43, s * 0.84, s * 0.18, s * 0.04);
  ctx.fill();
  ctx.fillStyle = '#ffe9a8';
  ctx.font = `bold ${s * 0.15}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, s / 2, s * 0.525);
}

function lion(ctx: Ctx, s: number) {
  // Lion head in profile-free medallion style: mane rays, face, eyes.
  const cx = s / 2,
    cy = s * 0.52;
  ctx.fillStyle = '#9a5a16';
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * s * 0.24, cy + Math.sin(a) * s * 0.24, s * 0.12, s * 0.07, a, 0, Math.PI * 2);
    ctx.fill();
  }
  const g = ctx.createRadialGradient(cx, cy - s * 0.05, s * 0.02, cx, cy, s * 0.24);
  g.addColorStop(0, '#ffe0a0');
  g.addColorStop(1, '#d08a2a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3a2008';
  ctx.beginPath();
  ctx.arc(cx - s * 0.08, cy - s * 0.05, s * 0.025, 0, Math.PI * 2);
  ctx.arc(cx + s * 0.08, cy - s * 0.05, s * 0.025, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.05, cy + s * 0.04);
  ctx.lineTo(cx + s * 0.05, cy + s * 0.04);
  ctx.lineTo(cx, cy + s * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#3a2008';
  ctx.lineWidth = s * 0.015;
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.1);
  ctx.quadraticCurveTo(cx - s * 0.06, cy + s * 0.16, cx - s * 0.1, cy + s * 0.12);
  ctx.moveTo(cx, cy + s * 0.1);
  ctx.quadraticCurveTo(cx + s * 0.06, cy + s * 0.16, cx + s * 0.1, cy + s * 0.12);
  ctx.stroke();
  // Crown.
  ctx.fillStyle = goldGrad(ctx, s * 0.08, s * 0.24);
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.14, s * 0.24);
  ctx.lineTo(cx - s * 0.14, s * 0.12);
  ctx.lineTo(cx - s * 0.07, s * 0.18);
  ctx.lineTo(cx, s * 0.08);
  ctx.lineTo(cx + s * 0.07, s * 0.18);
  ctx.lineTo(cx + s * 0.14, s * 0.12);
  ctx.lineTo(cx + s * 0.14, s * 0.24);
  ctx.closePath();
  ctx.fill();
}

function swan(ctx: Ctx, s: number) {
  ctx.fillStyle = '#f8f6f0';
  glow(ctx, '#bfe4ff', s * 0.06);
  ctx.beginPath();
  ctx.moveTo(s * 0.2, s * 0.7);
  ctx.quadraticCurveTo(s * 0.3, s * 0.48, s * 0.55, s * 0.55);
  ctx.quadraticCurveTo(s * 0.6, s * 0.35, s * 0.52, s * 0.25);
  ctx.quadraticCurveTo(s * 0.58, s * 0.15, s * 0.68, s * 0.22);
  ctx.lineTo(s * 0.8, s * 0.26);
  ctx.lineTo(s * 0.67, s * 0.28);
  ctx.quadraticCurveTo(s * 0.62, s * 0.4, s * 0.7, s * 0.55);
  ctx.quadraticCurveTo(s * 0.86, s * 0.6, s * 0.82, s * 0.72);
  ctx.quadraticCurveTo(s * 0.5, s * 0.84, s * 0.2, s * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ff8a2a';
  ctx.beginPath();
  ctx.moveTo(s * 0.68, s * 0.22);
  ctx.lineTo(s * 0.8, s * 0.26);
  ctx.lineTo(s * 0.68, s * 0.28);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.arc(s * 0.63, s * 0.235, s * 0.012, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#4fa3d9';
  ctx.lineWidth = s * 0.02;
  for (let i = 0; i < 2; i++) {
    ctx.beginPath();
    ctx.moveTo(s * 0.12, s * (0.8 + i * 0.06));
    ctx.bezierCurveTo(s * 0.35, s * (0.75 + i * 0.06), s * 0.6, s * (0.85 + i * 0.06), s * 0.88, s * (0.79 + i * 0.06));
    ctx.stroke();
  }
}

function rose(ctx: Ctx, s: number, petal = '#e0304a', dark = '#8a0f22') {
  const cx = s / 2,
    cy = s * 0.46;
  ctx.fillStyle = '#3e7a2c';
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.18, s * 0.74, s * 0.14, s * 0.05, -0.5, 0, Math.PI * 2);
  ctx.ellipse(cx + s * 0.18, s * 0.74, s * 0.14, s * 0.05, 0.5, 0, Math.PI * 2);
  ctx.fill();
  for (let ring = 3; ring >= 0; ring--) {
    const n = 5 + ring;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring;
      const r = s * (0.06 + ring * 0.055);
      const g = ctx.createRadialGradient(cx, cy, 0, cx + Math.cos(a) * r, cy + Math.sin(a) * r, s * 0.12);
      g.addColorStop(0, dark);
      g.addColorStop(1, petal);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r, s * (0.08 + ring * 0.02), s * (0.06 + ring * 0.012), a, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function lemon(ctx: Ctx, s: number) {
  const g = ctx.createRadialGradient(s * 0.42, s * 0.4, s * 0.03, s * 0.5, s * 0.5, s * 0.34);
  g.addColorStop(0, '#fffbd0');
  g.addColorStop(0.5, '#ffe14a');
  g.addColorStop(1, '#c9a00c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(s / 2, s / 2, s * 0.33, s * 0.24, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#4f9a36';
  ctx.beginPath();
  ctx.ellipse(s * 0.66, s * 0.24, s * 0.12, s * 0.05, -0.8, 0, Math.PI * 2);
  ctx.fill();
}

function fountain(ctx: Ctx, s: number) {
  // Basin with arcing jets.
  ctx.fillStyle = goldGrad(ctx, s * 0.62, s * 0.86);
  ctx.beginPath();
  ctx.ellipse(s / 2, s * 0.72, s * 0.34, s * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(s * 0.44, s * 0.72, s * 0.12, s * 0.14);
  ctx.beginPath();
  ctx.ellipse(s / 2, s * 0.86, s * 0.2, s * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  glow(ctx, '#8fd8ff', s * 0.08);
  ctx.strokeStyle = '#bfeaff';
  ctx.lineWidth = s * 0.03;
  for (const dx of [-0.24, -0.12, 0, 0.12, 0.24]) {
    ctx.beginPath();
    ctx.moveTo(s / 2, s * 0.68);
    ctx.quadraticCurveTo(s * (0.5 + dx * 0.6), s * (0.08 + Math.abs(dx) * 0.6), s * (0.5 + dx * 1.3), s * 0.66);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${s * 0.11}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.fillText('BONUS', s / 2, s * 0.98);
}

function crown(ctx: Ctx, s: number) {
  glow(ctx, '#ffd36b', s * 0.1);
  ctx.fillStyle = goldGrad(ctx, s * 0.2, s * 0.75);
  ctx.beginPath();
  ctx.moveTo(s * 0.16, s * 0.72);
  ctx.lineTo(s * 0.12, s * 0.3);
  ctx.lineTo(s * 0.32, s * 0.5);
  ctx.lineTo(s * 0.5, s * 0.2);
  ctx.lineTo(s * 0.68, s * 0.5);
  ctx.lineTo(s * 0.88, s * 0.3);
  ctx.lineTo(s * 0.84, s * 0.72);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  for (const [x, y, c] of [
    [0.5, 0.2, '#e8204a'],
    [0.12, 0.3, '#2a8ae8'],
    [0.88, 0.3, '#2a8ae8'],
    [0.5, 0.58, '#22b05a'],
  ] as const) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(s * x, s * y, s * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#5a1020';
  ctx.beginPath();
  ctx.roundRect(s * 0.14, s * 0.74, s * 0.72, s * 0.15, s * 0.03);
  ctx.fill();
  ctx.fillStyle = '#ffe9a8';
  ctx.font = `bold ${s * 0.12}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('WILD', s / 2, s * 0.815);
}

function peacock(ctx: Ctx, s: number) {
  const cx = s / 2,
    cy = s * 0.7;
  for (let i = 0; i < 9; i++) {
    const a = Math.PI + (i / 8) * Math.PI;
    const x = cx + Math.cos(a) * s * 0.36,
      y = cy + Math.sin(a) * s * 0.42;
    ctx.strokeStyle = '#2f8a5a';
    ctx.lineWidth = s * 0.012;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.stroke();
    const g = ctx.createRadialGradient(x, y, 0, x, y, s * 0.08);
    g.addColorStop(0, '#13246a');
    g.addColorStop(0.35, '#1aa4c8');
    g.addColorStop(0.6, '#e8c040');
    g.addColorStop(1, 'rgba(40,140,80,0.9)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, s * 0.075, s * 0.095, a + Math.PI / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#1a5ac0';
  ctx.beginPath();
  ctx.ellipse(cx, cy - s * 0.02, s * 0.07, s * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.18, s * 0.045, 0, Math.PI * 2);
  ctx.fill();
}

function orchid(ctx: Ctx, s: number) {
  const cx = s / 2,
    cy = s / 2;
  const petals: [number, number, number, number][] = [
    [-Math.PI / 2, 0.22, 0.1, 0.16],
    [Math.PI / 2 - 0.5, 0.2, 0.09, 0.15],
    [Math.PI / 2 + 0.5, 0.2, 0.09, 0.15],
    [0, 0.2, 0.15, 0.11],
    [Math.PI, 0.2, 0.15, 0.11],
  ];
  for (const [a, r, w, h] of petals) {
    const x = cx + Math.cos(a) * s * r * 0.8,
      y = cy + Math.sin(a) * s * r * 0.8;
    const g = ctx.createRadialGradient(cx, cy, s * 0.02, x, y, s * 0.2);
    g.addColorStop(0, '#fff');
    g.addColorStop(1, '#b04ad0');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, s * w, s * h, a + Math.PI / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#ffd34a';
  ctx.beginPath();
  ctx.ellipse(cx, cy + s * 0.04, s * 0.06, s * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#7a1a5a';
  ctx.beginPath();
  ctx.arc(cx, cy + s * 0.08, s * 0.03, 0, Math.PI * 2);
  ctx.fill();
}

function chandelierSym(ctx: Ctx, s: number) {
  ctx.strokeStyle = goldGrad(ctx, s * 0.1, s * 0.8);
  ctx.lineWidth = s * 0.03;
  ctx.beginPath();
  ctx.moveTo(s / 2, s * 0.08);
  ctx.lineTo(s / 2, s * 0.3);
  ctx.stroke();
  for (const [y, w] of [
    [0.32, 0.18],
    [0.52, 0.32],
  ]) {
    ctx.beginPath();
    ctx.ellipse(s / 2, s * y, s * w, s * 0.05, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  glow(ctx, '#fff2c0', s * 0.08);
  ctx.fillStyle = '#e8fbff';
  for (let i = 0; i < 9; i++) {
    const x = s * (0.2 + i * 0.075);
    const y = s * (0.62 + (i % 2) * 0.08);
    ctx.beginPath();
    ctx.moveTo(x, y - s * 0.06);
    ctx.lineTo(x + s * 0.025, y);
    ctx.lineTo(x, y + s * 0.06);
    ctx.lineTo(x - s * 0.025, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#fff5d0';
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(s * (0.22 + i * 0.14), s * 0.46, s * 0.025, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

function tulip(ctx: Ctx, s: number) {
  ctx.strokeStyle = '#3e7a2c';
  ctx.lineWidth = s * 0.03;
  ctx.beginPath();
  ctx.moveTo(s / 2, s * 0.55);
  ctx.lineTo(s / 2, s * 0.9);
  ctx.stroke();
  ctx.fillStyle = '#4f9a36';
  ctx.beginPath();
  ctx.ellipse(s * 0.38, s * 0.76, s * 0.06, s * 0.16, -0.5, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createLinearGradient(0, s * 0.15, 0, s * 0.6);
  g.addColorStop(0, '#ffb0c8');
  g.addColorStop(1, '#d6205a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(s * 0.3, s * 0.22);
  ctx.lineTo(s * 0.4, s * 0.32);
  ctx.lineTo(s * 0.5, s * 0.16);
  ctx.lineTo(s * 0.6, s * 0.32);
  ctx.lineTo(s * 0.7, s * 0.22);
  ctx.quadraticCurveTo(s * 0.74, s * 0.55, s * 0.5, s * 0.6);
  ctx.quadraticCurveTo(s * 0.26, s * 0.55, s * 0.3, s * 0.22);
  ctx.fill();
}

function key(ctx: Ctx, s: number) {
  glow(ctx, '#ffd36b', s * 0.12);
  ctx.strokeStyle = goldGrad(ctx, s * 0.1, s * 0.9);
  ctx.fillStyle = goldGrad(ctx, s * 0.1, s * 0.9);
  ctx.lineWidth = s * 0.06;
  ctx.beginPath();
  ctx.arc(s * 0.32, s * 0.36, s * 0.14, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(s * 0.42, s * 0.46);
  ctx.lineTo(s * 0.8, s * 0.84);
  ctx.stroke();
  ctx.fillRect(s * 0.6, s * 0.66, s * 0.05, s * 0.12);
  ctx.fillRect(s * 0.68, s * 0.74, s * 0.05, s * 0.12);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${s * 0.11}px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.fillText('BONUS', s * 0.32, s * 0.95);
}

export function paintSymbol(ctx: Ctx, machineId: string, id: string, s: number) {
  ctx.save();
  switch (id) {
    case 'DIAMOND':
      diamond(ctx, s);
      break;
    case 'SEVEN':
      seven(ctx, s);
      break;
    case 'BAR3':
      bar(ctx, s, 3);
      break;
    case 'BAR2':
      bar(ctx, s, 2);
      break;
    case 'BAR1':
      bar(ctx, s, 1);
      break;
    case 'CHERRY':
      cherry(ctx, s);
      break;
    case 'BLANK':
      break;
    case 'WILD':
      if (machineId === 'royal-conservatory') crown(ctx, s);
      else crest(ctx, s, 'WILD');
      break;
    case 'LION':
      lion(ctx, s);
      break;
    case 'SWAN':
      swan(ctx, s);
      break;
    case 'ROSE':
      rose(ctx, s);
      break;
    case 'LEMON':
      lemon(ctx, s);
      break;
    case 'FOUNTAIN':
      fountain(ctx, s);
      break;
    case 'PEACOCK':
      peacock(ctx, s);
      break;
    case 'ORCHID':
      orchid(ctx, s);
      break;
    case 'CHANDELIER':
      chandelierSym(ctx, s);
      break;
    case 'TULIP':
      tulip(ctx, s);
      break;
    case 'KEY':
      key(ctx, s);
      break;
    case 'A':
      letter(ctx, s, 'A', '#ff7a7a', '#b0101a');
      break;
    case 'K':
      letter(ctx, s, 'K', '#7ac0ff', '#1a4ab0');
      break;
    case 'Q':
      letter(ctx, s, 'Q', '#d08aff', '#6a1ab0');
      break;
    case 'J':
      letter(ctx, s, 'J', '#8aff9a', '#1a8a3a');
      break;
    case 'T':
      letter(ctx, s, '10', '#ffd27a', '#c0700a');
      break;
  }
  ctx.restore();
}

/** Pre-renders every symbol of a machine into an atlas (one row of cells). */
export function symbolAtlas(m: Machine, cell: number): { canvas: HTMLCanvasElement; index: Map<string, number> } {
  const c = document.createElement('canvas');
  c.width = cell * m.symbols.length;
  c.height = cell;
  const ctx = c.getContext('2d')!;
  const index = new Map<string, number>();
  m.symbols.forEach((sym, i) => {
    index.set(sym.id, i);
    ctx.save();
    ctx.translate(i * cell, 0);
    paintSymbol(ctx, m.id, sym.id, cell);
    ctx.restore();
  });
  return { canvas: c, index };
}
