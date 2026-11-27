/**
 * The ON THE RUN cabinet's printed art, drawn on one canvas in the game's own
 * look (its CSS palette and title screen): a dusk interstate under a deep
 * purple sky, amber headlights and gold, cyan neon, a magenta-pink haze, the
 * title in Russo One (the game's display face, vendored with it) with
 * Chakra Petch for the small print. Lettering and road scenery only.
 *
 * Layout (px) on a 1024 x 1024 canvas:
 *   marquee    x 0..1024,   y 0..176
 *   side art   x 0..400,    y 176..1024 (the side profile, front at the right)
 *   bezel      x 400..1024, y 176..376
 *   dash       x 400..1024, y 376..600 (one seat's console; both share it)
 *   kick       x 400..1024, y 600..820 (the front under the console)
 *   hub        x 400..528,  y 830..958 (the wheel's centre badge)
 *   swatches   x 540..,     y 830..    (flat colours for trims and solid parts)
 */

export const ART = 1024;
export const OTR_REGION = {
  marquee: { x: 0, y: 0, w: 1024, h: 176 },
  side: { x: 0, y: 176, w: 400, h: 848 },
  bezel: { x: 400, y: 176, w: 624, h: 200 },
  dash: { x: 400, y: 376, w: 624, h: 224 },
  kick: { x: 400, y: 600, w: 624, h: 220 },
  hub: { x: 400, y: 830, w: 128, h: 128 },
} as const;
export type Rect = { x: number; y: number; w: number; h: number };

/** The game's palette (its :root custom properties), plus the magenta of its two-player divider and haze. */
export const OTR = {
  ink: '#0d0818',
  panel: '#170f2c',
  amber: '#ffb347',
  cyan: '#62e0ff',
  red: '#ff4a5c',
  gold: '#ffd166',
  cream: '#f7ead8',
  dim: '#b7a6c8',
  magenta: '#ff3ad8',
  orange: '#ff7a1a',
  sky0: '#120a24',
  sky1: '#3a1844',
  sky2: '#9c4a6a',
  sun: '#ffb347',
};

export const DISPLAY = "'Russo One','Arial Black',Impact,sans-serif";
export const UI = "'Chakra Petch','Segoe UI',system-ui,sans-serif";

/** UV rect [u0, v0, u1, v1] (three.js, flipY) of a region of the art canvas. */
export function otrUV(r: Rect, inset = 1): [number, number, number, number] {
  return [(r.x + inset) / ART, 1 - (r.y + r.h - inset) / ART, (r.x + r.w - inset) / ART, 1 - (r.y + inset) / ART];
}

const SWATCHES: string[] = [];
/** A flat-colour spot on the art canvas (painted by paintOnTheRun). */
export function otrSwatch(color: string): [number, number, number, number] {
  let i = SWATCHES.indexOf(color);
  if (i < 0) i = SWATCHES.push(color) - 1;
  const x = 546 + (i % 18) * 26,
    y = 836 + Math.floor(i / 18) * 26;
  return [(x + 6) / ART, 1 - (y + 18) / ART, (x + 18) / ART, 1 - (y + 6) / ART];
}

function clip(g: CanvasRenderingContext2D, r: Rect) {
  g.save();
  g.beginPath();
  g.rect(r.x, r.y, r.w, r.h);
  g.clip();
}

/** The dusk sky and the interstate running to a vanishing point (the game's opening shot). */
function duskRoad(g: CanvasRenderingContext2D, r: Rect, vx: number, horizon: number, seed: number) {
  const sky = g.createLinearGradient(0, r.y, 0, horizon);
  sky.addColorStop(0, OTR.sky0);
  sky.addColorStop(0.55, OTR.sky1);
  sky.addColorStop(1, OTR.sky2);
  g.fillStyle = sky;
  g.fillRect(r.x, r.y, r.w, horizon - r.y);
  // The sun on the horizon, banded like a synthwave sunset.
  const sr = Math.min(r.w, r.h) * 0.22;
  const sun = g.createLinearGradient(0, horizon - sr, 0, horizon);
  sun.addColorStop(0, OTR.gold);
  sun.addColorStop(1, OTR.orange);
  g.fillStyle = sun;
  g.beginPath();
  g.arc(vx, horizon, sr, Math.PI, 0);
  g.fill();
  g.fillStyle = OTR.sky2;
  for (let i = 0; i < 5; i++) g.fillRect(vx - sr, horizon - sr * (0.12 + i * 0.16), sr * 2, sr * 0.035 * (i + 1));
  // Hills.
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#26103a';
  g.beginPath();
  g.moveTo(r.x, horizon);
  for (let x = r.x; x <= r.x + r.w; x += 16) g.lineTo(x, horizon - 6 - rnd() * r.h * 0.05);
  g.lineTo(r.x + r.w, horizon);
  g.fill();
  // The road.
  g.fillStyle = '#0b0714';
  g.fillRect(r.x, horizon, r.w, r.y + r.h - horizon);
  const bottom = r.y + r.h;
  const spread = r.w * 1.4;
  g.fillStyle = '#1a1226';
  g.beginPath();
  g.moveTo(vx - 4, horizon);
  g.lineTo(vx + 4, horizon);
  g.lineTo(vx + spread / 2, bottom);
  g.lineTo(vx - spread / 2, bottom);
  g.fill();
  // Lane lines and the shoulders: amber dashes, cyan edges.
  for (const [k, col] of [
    [-0.5, OTR.cyan],
    [0.5, OTR.cyan],
  ] as const) {
    g.strokeStyle = col;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(vx, horizon);
    g.lineTo(vx + k * spread, bottom);
    g.stroke();
  }
  for (const k of [-0.17, 0.17]) {
    for (let t = 0.02; t < 1; t *= 1.55) {
      const t2 = Math.min(1, t * 1.25);
      g.strokeStyle = OTR.amber;
      g.lineWidth = 1 + t * 6;
      g.beginPath();
      g.moveTo(vx + k * spread * t, horizon + (bottom - horizon) * t);
      g.lineTo(vx + k * spread * t2, horizon + (bottom - horizon) * t2);
      g.stroke();
    }
  }
  // Tail lights ahead, headlight glow.
  for (let i = 0; i < 6; i++) {
    const t = 0.08 + rnd() * 0.4;
    const x = vx + (rnd() - 0.5) * spread * 0.6 * t,
      y = horizon + (bottom - horizon) * t;
    g.fillStyle = OTR.red;
    g.fillRect(x - 3 - t * 8, y, 2 + t * 5, 2 + t * 3);
    g.fillRect(x + 1 + t * 3, y, 2 + t * 5, 2 + t * 3);
  }
}

/** Speed streaks (the game's boost blur) across a rect. */
function streaks(g: CanvasRenderingContext2D, r: Rect, n: number, seed: number, cols = [OTR.cyan, OTR.magenta, OTR.amber]) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const y = r.y + rnd() * r.h,
      x = r.x + rnd() * r.w,
      len = 30 + rnd() * r.w * 0.4;
    const gr = g.createLinearGradient(x, 0, x + len, 0);
    const c = cols[i % cols.length];
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, c);
    g.strokeStyle = gr;
    g.globalAlpha = 0.25 + rnd() * 0.5;
    g.lineWidth = 1 + rnd() * 2.5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + len, y);
    g.stroke();
  }
  g.globalAlpha = 1;
}

/** "ON THE RUN" set like the game's logo: heavy display caps, amber to gold, a cyan offset shadow and a magenta glow. */
export function titleLogo(g: CanvasRenderingContext2D, cx: number, y: number, px: number, maxW: number) {
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.font = `${px}px ${DISPLAY}`;
  const w = g.measureText('ON THE RUN').width;
  if (w > maxW) {
    px = Math.floor((px * maxW) / w);
    g.font = `${px}px ${DISPLAY}`;
  }
  // Letter spacing like the game's (.08em): draw it spaced by hand.
  const text = 'ON THE RUN';
  const sp = px * 0.08;
  let total = 0;
  for (const ch of text) total += g.measureText(ch).width + sp;
  total -= sp;
  const put = (dx: number, dy: number, style: string | CanvasGradient, blur = 0, glow = '') => {
    g.shadowBlur = blur;
    g.shadowColor = glow;
    g.fillStyle = style;
    g.textAlign = 'left';
    let x = cx - total / 2 + dx;
    for (const ch of text) {
      g.fillText(ch, x, y + dy);
      x += g.measureText(ch).width + sp;
    }
  };
  put(px * 0.05, px * 0.05, OTR.cyan, px * 0.35, OTR.magenta);
  const gr = g.createLinearGradient(0, y - px * 0.8, 0, y);
  gr.addColorStop(0, '#fff1c9');
  gr.addColorStop(0.45, OTR.gold);
  gr.addColorStop(1, OTR.orange);
  put(0, 0, gr, px * 0.25, 'rgba(255,179,71,0.8)');
  g.restore();
  return total;
}

function marquee(g: CanvasRenderingContext2D) {
  const r = OTR_REGION.marquee;
  clip(g, r);
  duskRoad(g, r, r.x + r.w / 2, r.y + r.h * 0.72, 7);
  // Darken behind the title.
  const v = g.createLinearGradient(0, r.y, 0, r.y + r.h);
  v.addColorStop(0, 'rgba(13,8,24,0.75)');
  v.addColorStop(0.7, 'rgba(13,8,24,0.35)');
  v.addColorStop(1, 'rgba(13,8,24,0.8)');
  g.fillStyle = v;
  g.fillRect(r.x, r.y, r.w, r.h);
  streaks(g, r, 40, 3);
  g.textAlign = 'center';
  g.fillStyle = OTR.cyan;
  g.font = `600 18px ${UI}`;
  spaced(g, 'A COAST-TO-COAST SPY CHASE', r.x + r.w / 2, r.y + 30, 0.4);
  titleLogo(g, r.x + r.w / 2, r.y + 118, 92, r.w * 0.8);
  g.fillStyle = OTR.cream;
  g.font = `700 17px ${UI}`;
  spaced(g, 'OUT OF ORDER  ·  SORRY FOR THE INCONVENIENCE', r.x + r.w / 2, r.y + 158, 0.3);
  // Neon lines top and bottom: cyan and magenta.
  g.fillStyle = OTR.cyan;
  g.fillRect(r.x, r.y + 2, r.w, 4);
  g.fillStyle = OTR.magenta;
  g.fillRect(r.x, r.y + r.h - 6, r.w, 4);
  g.restore();
}

/** Text with letter spacing (em fraction), centred on x. */
function spaced(g: CanvasRenderingContext2D, s: string, cx: number, y: number, em: number) {
  const px = parseFloat(/(\d+)px/.exec(g.font)?.[1] ?? '16');
  const sp = px * em;
  let total = 0;
  for (const ch of s) total += g.measureText(ch).width + sp;
  total -= sp;
  let x = cx - total / 2;
  const al = g.textAlign;
  g.textAlign = 'left';
  for (const ch of s) {
    g.fillText(ch, x, y);
    x += g.measureText(ch).width + sp;
  }
  g.textAlign = al;
}

function side(g: CanvasRenderingContext2D) {
  const r = OTR_REGION.side;
  clip(g, r);
  // Front is at the right: the road runs away to the left, up high.
  duskRoad(g, r, r.x + r.w * 0.3, r.y + r.h * 0.42, 11);
  streaks(g, { x: r.x, y: r.y + r.h * 0.45, w: r.w, h: r.h * 0.4 }, 50, 5);
  // A big slanted ON THE RUN up the side.
  g.save();
  g.translate(r.x + r.w * 0.62, r.y + r.h * 0.83);
  g.rotate(-Math.PI / 2);
  titleLogo(g, 0, 0, 96, r.h * 0.62);
  g.restore();
  // Racing stripes: amber, cyan, magenta (the game's three colours).
  const cols = [OTR.amber, OTR.cyan, OTR.magenta];
  cols.forEach((c, i) => {
    g.fillStyle = c;
    g.beginPath();
    const y0 = r.y + r.h * 0.9 + i * 16;
    g.moveTo(r.x, y0);
    g.lineTo(r.x + r.w, y0 - 60);
    g.lineTo(r.x + r.w, y0 - 50);
    g.lineTo(r.x, y0 + 10);
    g.fill();
  });
  g.fillStyle = 'rgba(13,8,24,0.9)';
  g.fillRect(r.x, r.y + r.h - 40, r.w, 40);
  g.restore();
}

function bezel(g: CanvasRenderingContext2D) {
  const r = OTR_REGION.bezel;
  clip(g, r);
  const gr = g.createLinearGradient(0, r.y, 0, r.y + r.h);
  gr.addColorStop(0, '#1d1236');
  gr.addColorStop(1, OTR.ink);
  g.fillStyle = gr;
  g.fillRect(r.x, r.y, r.w, r.h);
  g.strokeStyle = 'rgba(98,224,255,0.5)';
  g.lineWidth = 3;
  g.strokeRect(r.x + 8, r.y + 8, r.w - 16, r.h - 16);
  g.strokeStyle = 'rgba(255,58,216,0.35)';
  g.lineWidth = 2;
  g.strokeRect(r.x + 16, r.y + 16, r.w - 32, r.h - 32);
  g.restore();
}

/** The console print: labels round the buttons, and the controller legend. `buttons`: [u (0..1 across), label, colour]. */
function dash(g: CanvasRenderingContext2D, buttons: readonly [number, string, string][], btnV: number) {
  const r = OTR_REGION.dash;
  clip(g, r);
  const gr = g.createLinearGradient(0, r.y, 0, r.y + r.h);
  gr.addColorStop(0, '#24163f');
  gr.addColorStop(1, '#0f0920');
  g.fillStyle = gr;
  g.fillRect(r.x, r.y, r.w, r.h);
  // Carbon-ish weave.
  g.fillStyle = 'rgba(255,255,255,0.025)';
  for (let y = r.y; y < r.y + r.h; y += 8) for (let x = r.x + ((y / 8) % 2) * 8; x < r.x + r.w; x += 16) g.fillRect(x, y, 8, 8);
  // The wheel's column well.
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath();
  g.ellipse(r.x + r.w / 2, r.y + r.h * 0.5, r.w * 0.17, r.h * 0.36, 0, 0, Math.PI * 2);
  g.fill();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const [u, label, col] of buttons) {
    const x = r.x + u * r.w,
      y = r.y + btnV * r.h;
    g.strokeStyle = col;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(x, y, 22, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = OTR.cream;
    g.font = `700 15px ${UI}`;
    g.fillText(label, x, y + 40);
  }
  // The legend along the near edge (the controllers while your hands are on the wheel).
  g.fillStyle = OTR.dim;
  g.font = `600 13px ${UI}`;
  g.fillText('GRAB THE WHEEL  ·  RIGHT TRIGGER GAS  ·  LEFT TRIGGER BRAKE  ·  A BOOST  ·  B GUNS  ·  X MISSILE  ·  Y JUMP', r.x + r.w / 2, r.y + r.h - 34);
  g.fillText('RIGHT STICK CLICK DRIFT  ·  LEFT STICK CLICK OIL  ·  MENUS: TURN THE WHEEL TO PICK, A OK, B BACK', r.x + r.w / 2, r.y + r.h - 14);
  g.fillStyle = OTR.amber;
  g.fillRect(r.x, r.y, r.w, 3);
  g.restore();
}

function kick(g: CanvasRenderingContext2D) {
  const r = OTR_REGION.kick;
  clip(g, r);
  g.fillStyle = OTR.ink;
  g.fillRect(r.x, r.y, r.w, r.h);
  streaks(g, r, 30, 9);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = OTR.cream;
  g.font = `28px ${DISPLAY}`;
  spaced(g, 'INTERSTATE 80  ·  DUSK', r.x + r.w / 2, r.y + r.h * 0.42, 0.12);
  g.fillStyle = OTR.cyan;
  g.font = `600 16px ${UI}`;
  spaced(g, 'FREE PLAY', r.x + r.w / 2, r.y + r.h * 0.66, 0.5);
  g.restore();
}

function hub(g: CanvasRenderingContext2D) {
  const r = OTR_REGION.hub;
  g.fillStyle = '#120c1e';
  g.fillRect(r.x, r.y, r.w, r.h);
  g.strokeStyle = OTR.amber;
  g.lineWidth = 6;
  g.beginPath();
  g.arc(r.x + r.w / 2, r.y + r.h / 2, r.w * 0.42, 0, Math.PI * 2);
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = OTR.gold;
  g.font = `30px ${DISPLAY}`;
  g.fillText('OTR', r.x + r.w / 2, r.y + r.h / 2 + 2);
}

function swatches(g: CanvasRenderingContext2D) {
  SWATCHES.forEach((c, i) => {
    const x = 546 + (i % 18) * 26,
      y = 836 + Math.floor(i / 18) * 26;
    g.fillStyle = c;
    g.fillRect(x, y, 24, 24);
  });
}

/** Paints everything (again: once the game's fonts have loaded). */
export function paintOnTheRun(g: CanvasRenderingContext2D, buttons: readonly [number, string, string][], btnV: number) {
  g.clearRect(0, 0, ART, ART);
  marquee(g);
  side(g);
  bezel(g);
  dash(g, buttons, btnV);
  kick(g);
  hub(g);
  swatches(g);
}

/** The screen's card when the game isn't on it (loading, a seat's free, out of order). */
export function paintCard(g: CanvasRenderingContext2D, w: number, h: number, line: string, sub = '') {
  if (line === 'OUT OF ORDER') return paintOutOfOrder(g, w, h, sub);
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, OTR.sky0);
  gr.addColorStop(1, OTR.ink);
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  streaks(g, { x: 0, y: h * 0.55, w, h: h * 0.4 }, 30, 13);
  titleLogo(g, w / 2, h * 0.44, Math.round(h * 0.16), w * 0.8);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = OTR.cyan;
  g.font = `600 ${Math.round(h * 0.045)}px ${UI}`;
  spaced(g, line, w / 2, h * 0.62, 0.3);
  if (sub) {
    g.fillStyle = OTR.dim;
    g.font = `600 ${Math.round(h * 0.034)}px ${UI}`;
    spaced(g, sub, w / 2, h * 0.7, 0.2);
  }
}

/** A dead screen with a taped-on paper sign: the machine is broken. */
function paintOutOfOrder(g: CanvasRenderingContext2D, w: number, h: number, sub: string) {
  // The screen is off: near-black glass with a faint reflection.
  const gr = g.createLinearGradient(0, 0, w, h);
  gr.addColorStop(0, '#0d0c12');
  gr.addColorStop(0.5, '#15131c');
  gr.addColorStop(1, '#08070b');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.05)';
  g.beginPath();
  g.moveTo(w * 0.05, 0);
  g.lineTo(w * 0.28, 0);
  g.lineTo(w * 0.1, h);
  g.lineTo(0, h);
  g.closePath();
  g.fill();
  // The paper sign, a little crooked, with tape at the corners.
  g.save();
  g.translate(w / 2, h / 2);
  g.rotate(-0.06);
  const sw = w * 0.62,
    sh = h * 0.5;
  g.fillStyle = '#f3efe2';
  g.shadowColor = 'rgba(0,0,0,0.5)';
  g.shadowBlur = 12;
  g.fillRect(-sw / 2, -sh / 2, sw, sh);
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(230,220,170,0.75)';
  for (const [x, y, r] of [
    [-sw / 2, -sh / 2, -0.6],
    [sw / 2, -sh / 2, 0.6],
    [-sw / 2, sh / 2, 0.6],
    [sw / 2, sh / 2, -0.6],
  ] as const) {
    g.save();
    g.translate(x, y);
    g.rotate(r);
    g.fillRect(-sw * 0.07, -sh * 0.05, sw * 0.14, sh * 0.1);
    g.restore();
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#c4161c';
  g.font = `900 ${Math.round(sh * 0.3)}px Impact, 'Arial Black', sans-serif`;
  g.fillText('OUT OF', 0, -sh * 0.16);
  g.fillText('ORDER', 0, sh * 0.15);
  if (sub) {
    g.fillStyle = '#3a342c';
    g.font = `italic 600 ${Math.round(sh * 0.08)}px Georgia, serif`;
    g.fillText(sub.replace(/·/g, '—').toLowerCase().replace(/^./, (c) => c.toUpperCase()), 0, sh * 0.38);
  }
  g.restore();
}

/** "NOW PLAYING: NAME" along the bottom of a friend's picture. */
export function paintNowPlaying(g: CanvasRenderingContext2D, w: number, h: number, name: string) {
  const bh = Math.round(h * 0.1);
  g.fillStyle = 'rgba(13,8,24,0.82)';
  g.fillRect(0, h - bh, w, bh);
  g.fillStyle = OTR.amber;
  g.fillRect(0, h - bh, w, 3);
  g.fillStyle = OTR.cream;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${Math.round(bh * 0.5)}px ${UI}`;
  g.fillText(`NOW PLAYING: ${name.toUpperCase()}`, w / 2, h - bh / 2 + 1);
}
