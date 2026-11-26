/**
 * The arcade's own 5x7 bitmap font (drawn here, pixel by pixel), so screens
 * read crisp at 320x240 instead of blurry browser text. Each colour gets its
 * glyph strip made once; drawing is drawImage per character, no allocation.
 */

const GLYPHS: Record<string, string> = {
  A: '01110 10001 10001 11111 10001 10001 10001',
  B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110',
  D: '11100 10010 10001 10001 10001 10010 11100',
  E: '11111 10000 10000 11110 10000 10000 11111',
  F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111',
  H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110',
  J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001',
  L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001',
  N: '10001 10001 11001 10101 10011 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101',
  R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110',
  T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110',
  V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 10101 01010',
  X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 10001 01010 00100 00100 00100',
  Z: '11111 00001 00010 00100 01000 10000 11111',
  '0': '01110 10001 10011 10101 11001 10001 01110',
  '1': '00100 01100 00100 00100 00100 00100 01110',
  '2': '01110 10001 00001 00010 00100 01000 11111',
  '3': '11111 00010 00100 00010 00001 10001 01110',
  '4': '00010 00110 01010 10010 11111 00010 00010',
  '5': '11111 10000 11110 00001 00001 10001 01110',
  '6': '00110 01000 10000 11110 10001 10001 01110',
  '7': '11111 00001 00010 00100 01000 01000 01000',
  '8': '01110 10001 10001 01110 10001 10001 01110',
  '9': '01110 10001 10001 01111 00001 00010 01100',
  ' ': '00000 00000 00000 00000 00000 00000 00000',
  '!': '00100 00100 00100 00100 00100 00000 00100',
  '?': '01110 10001 00001 00010 00100 00000 00100',
  '.': '00000 00000 00000 00000 00000 01100 01100',
  ',': '00000 00000 00000 00000 01100 00100 01000',
  ':': '00000 01100 01100 00000 01100 01100 00000',
  '-': '00000 00000 00000 11111 00000 00000 00000',
  '+': '00000 00100 00100 11111 00100 00100 00000',
  '/': '00001 00010 00010 00100 01000 01000 10000',
  "'": '00100 00100 01000 00000 00000 00000 00000',
  '"': '01010 01010 00000 00000 00000 00000 00000',
  '$': '00100 01111 10100 01110 00101 11110 00100',
  '#': '01010 11111 01010 01010 01010 11111 01010',
  '%': '11001 11010 00010 00100 01000 01011 10011',
  '&': '01100 10010 10100 01000 10101 10010 01101',
  '(': '00010 00100 01000 01000 01000 00100 00010',
  ')': '01000 00100 00010 00010 00010 00100 01000',
  '*': '00000 10101 01110 11111 01110 10101 00000',
  '<': '00010 00100 01000 10000 01000 00100 00010',
  '>': '01000 00100 00010 00001 00010 00100 01000',
  '=': '00000 00000 11111 00000 11111 00000 00000',
  _: '00000 00000 00000 00000 00000 00000 11111',
  // Arrows and a heart (sent as these stand-in characters).
  '^': '00100 01110 10101 00100 00100 00100 00100',
  '~': '00100 00100 00100 00100 10101 01110 00100',
  '{': '00100 01000 11111 01000 00100 00000 00000',
  '}': '00100 00010 11111 00010 00100 00000 00000',
  '@': '00000 01010 11111 11111 01110 00100 00000',
};

const ORDER = Object.keys(GLYPHS);
const INDEX = new Int16Array(128).fill(-1);
ORDER.forEach((ch, i) => (INDEX[ch.charCodeAt(0)] = i));
/** Lower case draws as upper case. */
for (let c = 97; c <= 122; c++) INDEX[c] = INDEX[c - 32];

export const GLYPH_W = 5;
export const GLYPH_H = 7;
/** Advance per character at scale 1 (one pixel of spacing). */
export const ADVANCE = 6;

const strips = new Map<string, HTMLCanvasElement>();

function strip(color: string): HTMLCanvasElement {
  let c = strips.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = ORDER.length * GLYPH_W;
  c.height = GLYPH_H;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  ORDER.forEach((ch, i) => {
    const rows = GLYPHS[ch].split(' ');
    for (let y = 0; y < GLYPH_H; y++) for (let x = 0; x < GLYPH_W; x++) if (rows[y][x] === '1') g.fillRect(i * GLYPH_W + x, y, 1, 1);
  });
  strips.set(color, c);
  return c;
}

/** How wide a string draws at a scale (px). */
export function textWidth(s: string, scale = 1) {
  return s.length ? (s.length * ADVANCE - 1) * scale : 0;
}

/**
 * Draws text with its top-left (align 'left'), top-centre ('center') or
 * top-right ('right') at (x, y). Upper-case font; unknown characters are spaces.
 */
export function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, scale = 1, align: 'left' | 'center' | 'right' = 'left') {
  const st = strip(color);
  let px = align === 'left' ? x : align === 'center' ? x - textWidth(s, scale) / 2 : x - textWidth(s, scale);
  px = Math.round(px);
  y = Math.round(y);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const gi = code < 128 ? INDEX[code] : -1;
    if (gi >= 0 && code !== 32) g.drawImage(st, gi * GLYPH_W, 0, GLYPH_W, GLYPH_H, px, y, GLYPH_W * scale, GLYPH_H * scale);
    px += ADVANCE * scale;
  }
}

/** Text with a 1-px drop shadow (reads on busy backgrounds). */
export function shadowText(g: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, scale = 1, align: 'left' | 'center' | 'right' = 'left', shadow = '#000000') {
  text(g, s, x + scale, y + scale, shadow, scale, align);
  text(g, s, x, y, color, scale, align);
}

/**
 * Draws a non-negative integer without making a string (score counters every
 * frame), right-aligned at x when `align` is 'right', zero-padded to `pad` digits.
 */
export function num(g: CanvasRenderingContext2D, n: number, x: number, y: number, color: string, scale = 1, align: 'left' | 'right' | 'center' = 'left', pad = 1) {
  n = Math.max(0, Math.floor(n));
  let digits = 1;
  for (let v = n; v >= 10; v = Math.floor(v / 10)) digits++;
  if (digits < pad) digits = pad;
  const w = (digits * ADVANCE - 1) * scale;
  let px = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  px = Math.round(px);
  const st = strip(color);
  const zero = INDEX[48];
  let v = n;
  for (let i = digits - 1; i >= 0; i--) {
    const d = v % 10;
    v = Math.floor(v / 10);
    g.drawImage(st, (zero + d) * GLYPH_W, 0, GLYPH_W, GLYPH_H, px + i * ADVANCE * scale, Math.round(y), GLYPH_W * scale, GLYPH_H * scale);
  }
}
