import {
  BET_SPOTS,
  DOUBLE_ZERO,
  pocketColor,
  pocketLabel,
  SPOTS_BY_ID,
  type BetSpot,
} from '../../rules/roulette';
import { canvas, toTexture } from '../textures';
import { roundRect, SERIF } from '../panel';
import * as THREE from 'three';

/**
 * Geometry of the American roulette layout on the felt, in metres in the
 * table's local frame: +X runs away from the wheel, +Z toward the player.
 */
export const CW = 0.115; // grid row width (along X)
export const CH = 0.12; // grid column height (along Z)
export const GX0 = -0.55; // grid starts here (zero area to its left)
export const ZW = 0.16; // zero area width
export const ZFAR = -0.3; // far edge of the number grid
export const ZEDGE = ZFAR + 3 * CH; // player-side edge of the grid
export const DOZ_H = 0.1;
export const EVEN_H = 0.1;
export const GX1 = GX0 + 12 * CW; // end of grid (2-to-1 cells follow)

/** The felt plane: covers the wheel well too. */
export const FELT = { x0: -1.62, x1: 1.07, z0: -0.46, z1: 0.42 };
export const WHEEL_CENTER = { x: -1.16, z: -0.02 };

const cellCenter = (n: number): [number, number] => {
  if (n === 0) return [GX0 - ZW / 2, ZFAR + 2.25 * CH];
  if (n === DOUBLE_ZERO) return [GX0 - ZW / 2, ZFAR + 0.75 * CH];
  const r = Math.floor((n - 1) / 3),
    c = (n - 1) % 3;
  return [GX0 + (r + 0.5) * CW, ZFAR + (2 - c + 0.5) * CH];
};

/** Where chips for a spot are stacked. */
export function spotAnchor(s: BetSpot): [number, number] {
  const has0 = s.numbers.includes(0),
    has00 = s.numbers.includes(DOUBLE_ZERO);
  switch (s.kind) {
    case 'straight':
      return cellCenter(s.numbers[0]);
    case 'topline':
      return [GX0, ZEDGE];
    case 'trio':
      return has0 ? [GX0, ZFAR + 2 * CH] : [GX0, ZFAR + CH];
    case 'street': {
      const [x] = cellCenter(s.numbers[0]);
      return [x, ZEDGE];
    }
    case 'sixline': {
      const r = Math.floor((s.numbers[0] - 1) / 3);
      return [GX0 + (r + 1) * CW, ZEDGE];
    }
    case 'split':
      if (has0 && has00) return [GX0 - ZW / 2, ZFAR + 1.5 * CH];
      if (has0 || has00) {
        const other = s.numbers.find((n) => n !== 0 && n !== DOUBLE_ZERO)!;
        if (other === 2) return [GX0, ZFAR + 1.5 * CH + (has0 ? 0.25 : -0.25) * CH];
        return [GX0, cellCenter(other)[1]];
      }
    // fall through: grid splits use the average of the two cells
    case 'corner': {
      const pts = s.numbers.map(cellCenter);
      return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
    }
    case 'column': {
      const c = Number(s.id.split(':')[1]) - 1;
      return [GX1 + CW / 2, ZFAR + (2 - c + 0.5) * CH];
    }
    case 'dozen': {
      const k = Number(s.id.split(':')[1]) - 1;
      return [GX0 + (k * 4 + 2) * CW, ZEDGE + DOZ_H / 2];
    }
    default: {
      const order = ['low', 'even', 'red', 'black', 'odd', 'high'];
      const k = order.indexOf(s.kind);
      return [GX0 + (k * 2 + 1) * CW, ZEDGE + DOZ_H + EVEN_H / 2];
    }
  }
}

const EDGE_SPOTS = BET_SPOTS.filter((s) => !['straight', 'column', 'dozen', 'red', 'black', 'odd', 'even', 'low', 'high'].includes(s.kind)).map(
  (s) => ({ spot: s, at: spotAnchor(s) }),
);

/** Maps a point on the felt to the bet spot a dealer would read it as. */
export function spotAt(x: number, z: number): BetSpot | null {
  let best: BetSpot | null = null;
  let bestD = 0.034;
  for (const e of EDGE_SPOTS) {
    const d = Math.hypot(x - e.at[0], z - e.at[1]);
    if (d < bestD) {
      bestD = d;
      best = e.spot;
    }
  }
  if (best) return best;

  if (x >= GX0 && x < GX1 && z >= ZFAR && z < ZEDGE) {
    const r = Math.floor((x - GX0) / CW),
      c = 2 - Math.floor((z - ZFAR) / CH);
    return SPOTS_BY_ID.get(`straight:${r * 3 + c + 1}`) ?? null;
  }
  if (x >= GX0 - ZW && x < GX0 && z >= ZFAR && z < ZEDGE) {
    return SPOTS_BY_ID.get(z > ZFAR + 1.5 * CH ? 'straight:0' : 'straight:00') ?? null;
  }
  if (x >= GX1 && x < GX1 + CW && z >= ZFAR && z < ZEDGE) {
    const c = 2 - Math.floor((z - ZFAR) / CH);
    return SPOTS_BY_ID.get(`column:${c + 1}`) ?? null;
  }
  if (x >= GX0 && x < GX1 && z >= ZEDGE && z < ZEDGE + DOZ_H) {
    return SPOTS_BY_ID.get(`dozen:${Math.floor((x - GX0) / (4 * CW)) + 1}`) ?? null;
  }
  if (x >= GX0 && x < GX1 && z >= ZEDGE + DOZ_H && z < ZEDGE + DOZ_H + EVEN_H) {
    const order = ['low', 'even', 'red', 'black', 'odd', 'high'];
    return SPOTS_BY_ID.get(order[Math.floor((x - GX0) / (2 * CW))]) ?? null;
  }
  return null;
}

export function describeSpot(s: BetSpot): string {
  const nums = s.numbers.map(pocketLabel).join('-');
  switch (s.kind) {
    case 'straight':
      return `Straight ${nums}`;
    case 'split':
      return `Split ${nums}`;
    case 'street':
      return `Street ${nums}`;
    case 'trio':
      return `Basket ${nums}`;
    case 'corner':
      return `Corner ${nums}`;
    case 'topline':
      return 'Top line 0-00-1-2-3';
    case 'sixline':
      return `Six line ${nums}`;
    case 'dozen':
      return ['1st 12', '2nd 12', '3rd 12'][Number(s.id.split(':')[1]) - 1];
    case 'column':
      return `Column ${s.id.split(':')[1]}`;
    default:
      return { red: 'Red', black: 'Black', odd: 'Odd', even: 'Even', low: '1 to 18', high: '19 to 36' }[s.kind as string]!;
  }
}

// ---------------------------------------------------------------------------
// Felt artwork
// ---------------------------------------------------------------------------

export function feltTexture(pxW: number): THREE.CanvasTexture {
  const fw = FELT.x1 - FELT.x0,
    fd = FELT.z1 - FELT.z0;
  const pxH = Math.round((pxW * fd) / fw);
  const [c, ctx] = canvas(pxW, pxH);
  const sx = pxW / fw;
  const X = (x: number) => (x - FELT.x0) * sx;
  const Z = (z: number) => (z - FELT.z0) * sx;

  // Felt with soft light falloff and fibre noise.
  const g = ctx.createRadialGradient(pxW * 0.55, pxH * 0.5, pxH * 0.1, pxW * 0.55, pxH * 0.5, pxW * 0.6);
  g.addColorStop(0, '#1d7a46');
  g.addColorStop(1, '#0e4a2a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, pxW, pxH);
  const img = ctx.getImageData(0, 0, pxW, pxH);
  let s = 5;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 16807) % 2147483647;
    const f = 0.93 + (s / 2147483647) * 0.12;
    img.data[i] *= f;
    img.data[i + 1] *= f;
    img.data[i + 2] *= f;
  }
  ctx.putImageData(img, 0, 0);

  const line = '#f1e6c8';
  ctx.strokeStyle = line;
  ctx.lineWidth = Math.max(2, sx * 0.004);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Number cells.
  for (let n = 1; n <= 36; n++) {
    const [cx, cz] = cellCenter(n);
    const x = X(cx - CW / 2),
      y = Z(cz - CH / 2);
    ctx.strokeRect(x, y, CW * sx, CH * sx);
    const col = pocketColor(n) === 'red' ? '#b3202a' : '#16120f';
    roundRect(ctx, x + CW * sx * 0.16, y + CH * sx * 0.2, CW * sx * 0.68, CH * sx * 0.6, CW * sx * 0.3);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.lineWidth = Math.max(1, sx * 0.0015);
    ctx.strokeStyle = '#d8b25a';
    ctx.stroke();
    ctx.lineWidth = Math.max(2, sx * 0.004);
    ctx.strokeStyle = line;
    ctx.save();
    ctx.translate(X(cx), Z(cz));
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#f8f1dc';
    ctx.font = `bold ${Math.round(CH * sx * 0.36)}px ${SERIF}`;
    ctx.fillText(String(n), 0, 2);
    ctx.restore();
  }
  // Zero area: two cells forming a pointed end.
  for (const n of [0, DOUBLE_ZERO]) {
    const [cx, cz] = cellCenter(n);
    const top = cz - 0.75 * CH,
      bot = cz + 0.75 * CH;
    ctx.beginPath();
    ctx.moveTo(X(GX0), Z(top));
    ctx.lineTo(X(GX0 - ZW * 0.55), Z(top));
    ctx.lineTo(X(GX0 - ZW), Z(cz));
    ctx.lineTo(X(GX0 - ZW * 0.55), Z(bot));
    ctx.lineTo(X(GX0), Z(bot));
    ctx.closePath();
    ctx.fillStyle = '#16804a';
    ctx.fill();
    ctx.stroke();
    ctx.save();
    ctx.translate(X(cx + 0.01), Z(cz));
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#f8f1dc';
    ctx.font = `bold ${Math.round(CH * sx * 0.42)}px ${SERIF}`;
    ctx.fillText(pocketLabel(n), 0, 2);
    ctx.restore();
  }
  // 2 to 1 columns.
  for (let c = 0; c < 3; c++) {
    const z = ZFAR + (2 - c) * CH;
    ctx.strokeRect(X(GX1), Z(z), CW * sx, CH * sx);
    ctx.save();
    ctx.translate(X(GX1 + CW / 2), Z(z + CH / 2));
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#f1e6c8';
    ctx.font = `600 ${Math.round(CH * sx * 0.22)}px ${SERIF}`;
    ctx.fillText('2 to 1', 0, 0);
    ctx.restore();
  }
  // Dozens.
  ['1st 12', '2nd 12', '3rd 12'].forEach((label, k) => {
    const x = GX0 + k * 4 * CW;
    ctx.strokeRect(X(x), Z(ZEDGE), 4 * CW * sx, DOZ_H * sx);
    ctx.fillStyle = '#f1e6c8';
    ctx.font = `italic 600 ${Math.round(DOZ_H * sx * 0.48)}px ${SERIF}`;
    ctx.fillText(label, X(x + 2 * CW), Z(ZEDGE + DOZ_H / 2));
  });
  // Even-money bets.
  const evens = ['1 to 18', 'EVEN', 'red', 'black', 'ODD', '19 to 36'];
  evens.forEach((label, k) => {
    const x = GX0 + k * 2 * CW,
      z = ZEDGE + DOZ_H;
    ctx.strokeRect(X(x), Z(z), 2 * CW * sx, EVEN_H * sx);
    const cx = X(x + CW),
      cz = Z(z + EVEN_H / 2);
    if (label === 'red' || label === 'black') {
      ctx.beginPath();
      const w = CW * sx * 0.7,
        h = EVEN_H * sx * 0.32;
      ctx.moveTo(cx - w, cz);
      ctx.lineTo(cx, cz - h);
      ctx.lineTo(cx + w, cz);
      ctx.lineTo(cx, cz + h);
      ctx.closePath();
      ctx.fillStyle = label === 'red' ? '#b3202a' : '#16120f';
      ctx.fill();
      ctx.strokeStyle = '#d8b25a';
      ctx.stroke();
      ctx.strokeStyle = line;
    } else {
      ctx.fillStyle = '#f1e6c8';
      ctx.font = `600 ${Math.round(EVEN_H * sx * 0.4)}px ${SERIF}`;
      ctx.fillText(label, cx, cz);
    }
  });
  // Outer gold border around the layout.
  ctx.strokeStyle = '#d8b25a';
  ctx.lineWidth = Math.max(3, sx * 0.006);
  ctx.strokeRect(X(GX0 - ZW - 0.012), Z(ZFAR - 0.012), (GX1 + CW - GX0 + ZW + 0.024) * sx, (3 * CH + DOZ_H + EVEN_H + 0.024) * sx);

  // House name in the open felt in front of the wheel.
  ctx.save();
  ctx.translate(X(WHEEL_CENTER.x), Z(0.33));
  ctx.fillStyle = 'rgba(232,201,120,0.85)';
  ctx.font = `italic 600 ${Math.round(sx * 0.05)}px ${SERIF}`;
  ctx.fillText('Palazzo Lago', 0, 0);
  ctx.restore();
  ctx.fillStyle = 'rgba(232,201,120,0.6)';
  ctx.font = `${Math.round(sx * 0.022)}px ${SERIF}`;
  ctx.fillText('TABLE LIMITS  $1 – $1,000 INSIDE  ·  $5,000 OUTSIDE', X(0.2), Z(0.375));

  return toTexture(c, { aniso: 8 });
}

export const FELT_SIZE = { w: FELT.x1 - FELT.x0, d: FELT.z1 - FELT.z0 };
