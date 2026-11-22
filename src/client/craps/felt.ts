import { canvas } from '../textures';

/**
 * The craps layout: drawing, hit-testing and chip positions.
 *
 * Canvas is 2048×860 px and covers the felt bed exactly (BED_W × BED_D metres).
 * Canvas top is the dealers' side (−z), bottom the players' rail (+z).
 */
export const FELT_PX = { w: 2048, h: 860 };
export const BED = { w: 3.1, d: 1.3 };

/** Canvas px → table-local x/z on the bed. */
export const pxToLocal = (x: number, y: number): [number, number] => [(x / FELT_PX.w - 0.5) * BED.w, (y / FELT_PX.h - 0.5) * BED.d];
export const localToPx = (x: number, z: number): [number, number] => [(x / BED.w + 0.5) * FELT_PX.w, (z / BED.d + 0.5) * FELT_PX.h];

const PLACE_W = (724 - 225) / 6;
const PLACE_NUMS = [4, 5, 6, 8, 9, 10];
const HARD_BOXES: [number, number, number][] = [
  [6, 744, 150],
  [8, 1024, 150],
  [4, 744, 300],
  [10, 1024, 300],
];
const ONE_ROLL = ['two', 'twelve', 'three', 'eleven'];
const inR = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

/**
 * What area of the layout a canvas point is on. Returns the base spot: 'pass',
 * 'dontPass', 'come', 'dontCome', 'field', 'place6' (the number box), 'big6',
 * 'hard8', 'any7', 'anyCraps', 'two'…, 'ceC', 'ceE'. The table decides
 * whether a number-box tap means a place bet or odds on your come bet.
 */
export function regionAt(px: number, py: number): string | null {
  if (px >= 744 && px <= 1304) {
    if (inR(px, py, 744, 70, 1304, 150)) return 'any7';
    for (const [n, x, y] of HARD_BOXES) if (inR(px, py, x, y, x + 280, y + 150)) return `hard${n}`;
    for (let i = 0; i < 4; i++) if (inR(px, py, 744 + i * 140, 450, 744 + (i + 1) * 140, 600)) return ONE_ROLL[i];
    if (inR(px, py, 744, 600, 1304, 690)) return 'anyCraps';
    if (inR(px, py, 744, 690, 1304, 815)) return py < 757 ? 'ceC' : 'ceE';
    return null;
  }
  const x = px > 1024 ? 2048 - px : px;
  const y = py;
  if (inR(x, y, 40, 710, 724, 860) || inR(x, y, 0, 40, 130, 860)) return 'pass';
  if (inR(x, y, 130, 40, 225, 235)) return 'dontCome';
  if (inR(x, y, 225, 40, 724, 235)) return `place${PLACE_NUMS[Math.min(5, Math.floor((x - 225) / PLACE_W))]}`;
  if (inR(x, y, 130, 235, 724, 400)) return 'come';
  if (inR(x, y, 130, 400, 225, 710)) return y < 555 ? 'big6' : 'big8';
  if (inR(x, y, 225, 400, 724, 615)) return 'field';
  if (inR(x, y, 225, 615, 724, 710)) return 'dontPass';
  return null;
}

/** Where a bet's chips sit (canvas px), on the half of the layout in front of the player (right half). */
export function anchorPx(id: string): [number, number] {
  const R = (x: number, y: number): [number, number] => [2048 - x, y];
  const box = (n: number) => 225 + PLACE_NUMS.indexOf(n) * PLACE_W + PLACE_W / 2;
  const m = id.match(/^([a-zA-Z]+?)(\d+)?$/)!;
  const k = m[1];
  const n = m[2] ? Number(m[2]) : 0;
  switch (k) {
    case 'pass':
      return R(400, 772);
    case 'passOdds':
      return R(400, 836);
    case 'dontPass':
      return R(400, 662);
    case 'dontOdds':
      return R(470, 662);
    case 'come':
      return n ? R(box(n) - 18, 128) : R(470, 330);
    case 'comeOdds':
      return R(box(n) + 20, 128);
    case 'dontCome':
      return n ? R(box(n) - 18, 91) : R(177, 205);
    case 'dontComeOdds':
      return R(box(n) + 20, 91);
    case 'place':
      return R(box(n), 212);
    case 'field':
      return R(520, 545);
    case 'big':
      return R(177, n === 6 ? 440 : 660);
    case 'hard': {
      const b = HARD_BOXES.find((h) => h[0] === n)!;
      return [b[1] + 140, b[2] + 100];
    }
    case 'any':
      return [1200, 110];
    case 'anyCraps':
      return [1200, 645];
    case 'two':
    case 'twelve':
    case 'three':
    case 'eleven':
      return [744 + ONE_ROLL.indexOf(k) * 140 + 70, 540];
    case 'ceC':
      return [1250, 735];
    case 'ceE':
      return [1250, 780];
  }
  return [1024, 430];
}

/** Puck spots: in the Don't Come bar when OFF, on the point's number box when ON (both halves). */
export function puckPx(point: number | null): [[number, number], [number, number]] {
  if (!point) return [[177, 150], [2048 - 177, 150]];
  const x = 225 + PLACE_NUMS.indexOf(point) * PLACE_W + PLACE_W / 2;
  return [[x, 165], [2048 - x, 165]];
}

export function crapsFelt(): HTMLCanvasElement {
  const [c, g] = canvas(2048, 860);
  const grad = g.createRadialGradient(1024, 430, 100, 1024, 430, 1100);
  grad.addColorStop(0, '#1d7a46');
  grad.addColorStop(1, '#0d4527');
  g.fillStyle = grad;
  g.fillRect(0, 0, 2048, 860);
  const INK = '#f1e6c8';
  const RED = '#c8202a';
  const YEL = '#f2c94c';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';

  const text = (s: string, x: number, y: number, size: number, opts: { color?: string; italic?: boolean; rot?: number; weight?: number } = {}) => {
    g.save();
    g.translate(x, y);
    if (opts.rot) g.rotate(opts.rot);
    g.fillStyle = opts.color ?? INK;
    g.font = `${opts.italic ? 'italic ' : ''}${opts.weight ?? 700} ${size}px Georgia, serif`;
    g.fillText(s, 0, 0);
    g.restore();
  };
  const die = (x: number, y: number, n: number, s = 30) => {
    g.fillStyle = '#fbf6ea';
    g.beginPath();
    g.roundRect(x - s / 2, y - s / 2, s, s, s * 0.18);
    g.fill();
    g.fillStyle = n === 1 ? RED : '#111';
    const o = s * 0.27;
    const pips: Record<number, [number, number][]> = {
      1: [[0, 0]],
      2: [[-o, -o], [o, o]],
      3: [[-o, -o], [0, 0], [o, o]],
      4: [[-o, -o], [o, -o], [-o, o], [o, o]],
      5: [[-o, -o], [o, -o], [0, 0], [-o, o], [o, o]],
      6: [[-o, -o], [o, -o], [-o, 0], [o, 0], [-o, o], [o, o]],
    };
    for (const [px, py] of pips[n]) {
      g.beginPath();
      g.arc(x + px, y + py, s * 0.09, 0, Math.PI * 2);
      g.fill();
    }
  };

  for (const side of [-1, 1] as const) {
    // Work in left-half coordinates; X() mirrors them for the right half.
    const X = (x: number) => (side < 0 ? x : 2048 - x);
    const rect = (x0: number, y0: number, x1: number, y1: number) => {
      const a = X(x0),
        b = X(x1);
      g.strokeRect(Math.min(a, b), y0, Math.abs(b - a), y1 - y0);
    };
    g.strokeStyle = INK;
    g.lineWidth = 5;

    // Pass Line: along the players' edge and up round the end.
    g.beginPath();
    for (const [x, y] of [[40, 70], [40, 815], [724, 815], [724, 710], [130, 710], [130, 70]]) g.lineTo(X(x), y);
    g.closePath();
    g.stroke();
    text('PASS LINE', X(430), 762, 64, { italic: true });
    text('PASS LINE', X(85), 390, 40, { italic: true, rot: side < 0 ? -Math.PI / 2 : Math.PI / 2 });

    // Don't Come bar 12.
    rect(130, 70, 225, 235);
    text("DON'T", X(177), 105, 22);
    text('COME', X(177), 130, 22);
    text('BAR', X(177), 155, 22);
    die(X(160), 200, 6, 26);
    die(X(194), 200, 6, 26);

    // Place numbers.
    const nums = ['4', '5', 'SIX', '8', 'NINE', '10'];
    const w = (724 - 225) / 6;
    nums.forEach((n, i) => {
      const x0 = 225 + i * w;
      rect(x0, 70, x0 + w, 235);
      g.strokeStyle = INK;
      g.lineWidth = 2;
      rect(x0 + 6, 76, x0 + w - 6, 106);
      g.lineWidth = 5;
      text(n, X(x0 + w / 2), 170, n.length > 3 ? 32 : n.length > 2 ? 38 : 58, { color: n === 'SIX' || n === '8' ? YEL : INK });
    });

    // Come.
    rect(130, 235, 724, 400);
    text('COME', X(430), 318, 110, { color: RED, italic: true });

    // Field: 2 pays double, 12 pays triple.
    rect(225, 400, 724, 615);
    text('FIELD', X(475), 590, 30, { color: YEL });
    const fx = [265, 335, 405, 475, 545, 615, 685];
    ['2', '3', '4', '9', '10', '11', '12'].forEach((n, i) => {
      const x = X(fx[i]);
      const circled = n === '2' || n === '12';
      if (circled) {
        g.lineWidth = 3;
        g.beginPath();
        g.arc(x, 490, 34, 0, Math.PI * 2);
        g.stroke();
        g.lineWidth = 5;
      }
      text(n, x, 490, 48, { color: circled ? YEL : INK });
    });
    text('PAYS DOUBLE', X(fx[0] + 22), 436, 16, { color: YEL });
    text('PAYS TRIPLE', X(fx[6] - 24), 436, 16, { color: YEL });

    // Big 6 / Big 8.
    rect(130, 400, 225, 710);
    text('6', X(177), 480, 70, { color: RED });
    text('8', X(177), 610, 70, { color: RED });
    text('BIG', X(177), 545, 22);

    // Don't Pass bar 12.
    rect(225, 615, 724, 710);
    text("DON'T PASS BAR", X(430), 662, 40, { italic: true });
    die(X(640), 662, 6, 30);
    die(X(678), 662, 6, 30);
  }

  // Centre: proposition bets with Strip odds.
  g.strokeStyle = INK;
  g.lineWidth = 5;
  g.strokeRect(744, 70, 560, 745);
  g.fillStyle = '#9e1a22';
  g.fillRect(746, 72, 556, 76);
  g.fillRect(746, 602, 556, 86);
  text('SEVEN   4 TO 1', 1024, 110, 46);
  g.strokeRect(744, 70, 560, 80);
  // Hard ways.
  const hard: [number, string][] = [[3, '9 TO 1'], [4, '9 TO 1'], [2, '7 TO 1'], [5, '7 TO 1']];
  hard.forEach(([d, odds], i) => {
    const cx = 744 + (i % 2) * 280;
    const cy = 150 + Math.floor(i / 2) * 150;
    g.strokeRect(cx, cy, 280, 150);
    die(cx + 110, cy + 60, d, 44);
    die(cx + 170, cy + 60, d, 44);
    text(odds, cx + 140, cy + 120, 30);
  });
  // One-roll bets.
  const one: [number, number, string][] = [[1, 1, '30 TO 1'], [6, 6, '30 TO 1'], [1, 2, '15 TO 1'], [5, 6, '15 TO 1']];
  one.forEach(([a, b], i) => {
    const cx = 744 + i * 140;
    g.strokeRect(cx, 450, 140, 150);
    die(cx + 50, 500, a, 36);
    die(cx + 90, 500, b, 36);
    text(one[i][2], cx + 70, 565, 22);
  });
  g.strokeRect(744, 600, 560, 90);
  text('ANY CRAPS   7 TO 1', 1024, 645, 40);
  // C & E circles.
  for (let i = 0; i < 4; i++) {
    const cx = 800 + i * 150;
    for (const [dy, l, col] of [[735, 'C', RED], [780, 'E', YEL]] as const) {
      g.beginPath();
      g.arc(cx, dy, 20, 0, Math.PI * 2);
      g.lineWidth = 3;
      g.stroke();
      text(l, cx, dy + 1, 24, { color: col });
    }
  }
  return c;
}
