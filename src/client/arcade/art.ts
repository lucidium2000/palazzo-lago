import * as THREE from 'three';
import type { GameMeta } from './types';
import { text, textWidth } from './font';

/**
 * One texture for every printed surface in the arcade (side art, marquees,
 * control panels, bezels, coin doors, the floor games' signs), so all the
 * cabinets bake into a couple of draw calls. 2048x1024, eight 512x512 tiles:
 * six cabinets, then the floor games.
 *
 * Tiles 6 and 7 hold the floor games' art; tile 7's panel region holds the
 * plain colour swatches (trims, rims, solid parts).
 *
 * Tile layout (px within a tile):
 *   side art   x 0..232,   y 0..512   (the cabinet's side profile, tall)
 *   marquee    x 232..512, y 0..104
 *   panel      x 232..512, y 104..200
 *   bezel      x 232..512, y 200..420
 *   coin door  x 232..512, y 420..512
 */

export const ATLAS_W = 2048;
export const ATLAS_H = 1024;
export const TILE = 512;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function tileOrigin(i: number): [number, number] {
  return [(i % 4) * TILE, Math.floor(i / 4) * TILE];
}

export const REGION = {
  side: { x: 0, y: 0, w: 232, h: 512 },
  marquee: { x: 232, y: 0, w: 280, h: 104 },
  panel: { x: 232, y: 104, w: 280, h: 96 },
  bezel: { x: 232, y: 200, w: 280, h: 220 },
  door: { x: 232, y: 420, w: 280, h: 92 },
} as const;

/** A region of a tile in UV space [u0, v0, u1, v1] (v up, three.js style; flipY textures). */
export function uvRect(tile: number, r: Rect, inset = 1): [number, number, number, number] {
  const [ox, oy] = tileOrigin(tile);
  const x0 = (ox + r.x + inset) / ATLAS_W,
    x1 = (ox + r.x + r.w - inset) / ATLAS_W;
  const y0 = 1 - (oy + r.y + r.h - inset) / ATLAS_H,
    y1 = 1 - (oy + r.y + inset) / ATLAS_H;
  return [x0, y0, x1, y1];
}

/** A 1-colour swatch spot (for trims and solid parts): tile 7's panel region holds them. */
export function swatchUV(k: number): [number, number, number, number] {
  const [ox, oy] = tileOrigin(7);
  const x = ox + 232 + (k % 13) * 20 + 4,
    y = oy + 104 + Math.floor(k / 13) * 20 + 4;
  return [(x + 2) / ATLAS_W, 1 - (y + 8) / ATLAS_H, (x + 8) / ATLAS_W, 1 - (y + 2) / ATLAS_H];
}

/** Swatch colours (index → colour), filled as cabinets ask for them. */
const swatches: string[] = [];
export function swatch(color: string): number {
  let i = swatches.indexOf(color);
  if (i < 0) {
    swatches.push(color);
    i = swatches.length - 1;
  }
  return i;
}

/** Big glowing title text from the bitmap font. */
function glowText(g: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, scale: number, glow: string, blur = 10) {
  g.save();
  g.shadowColor = glow;
  g.shadowBlur = blur;
  text(g, s, x, y, color, scale, 'center');
  g.shadowBlur = blur * 0.4;
  text(g, s, x, y, color, scale, 'center');
  g.restore();
}

function fitScale(s: string, w: number, max: number) {
  let sc = max;
  while (sc > 1 && textWidth(s, sc) > w) sc--;
  return sc;
}

/**
 * Where the controls sit on a control panel, as fractions of its width (u)
 * and depth from the back edge (v): one stick and three buttons per player.
 */
export function controlLayout(players: 1 | 2): { stick: [number, number]; buttons: [number, number][] }[] {
  const one = (cx: number, k: number) => ({
    stick: [cx - 0.2 * k, 0.5] as [number, number],
    buttons: [
      [cx + 0.03 * k, 0.52],
      [cx + 0.16 * k, 0.44],
      [cx + 0.29 * k, 0.52],
    ] as [number, number][],
  });
  return players === 2 ? [one(0.25, 0.62), one(0.75, 0.62)] : [one(0.48, 1)];
}

/** Paints a cabinet's printed surfaces into its tile. */
export function paintCabinet(g: CanvasRenderingContext2D, tile: number, m: GameMeta) {
  const [ox, oy] = tileOrigin(tile);
  const c = m.colors;
  g.save();
  g.translate(ox, oy);
  g.imageSmoothingEnabled = false;

  // --- Side art: the body colour, a big diagonal sweep of the game's colours, its title up the side.
  {
    const r = REGION.side;
    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    const bg = g.createLinearGradient(0, 0, r.w, r.h);
    bg.addColorStop(0, c.body);
    bg.addColorStop(1, '#050308');
    g.fillStyle = bg;
    g.fillRect(r.x, r.y, r.w, r.h);
    // Diagonal stripes.
    const cols = [c.trim, c.accent, c.accent2];
    for (let k = 0; k < 3; k++) {
      g.fillStyle = cols[k];
      g.globalAlpha = 0.85;
      g.beginPath();
      const y0 = 300 + k * 26;
      g.moveTo(0, y0);
      g.lineTo(r.w, y0 - 150);
      g.lineTo(r.w, y0 - 136);
      g.lineTo(0, y0 + 14);
      g.fill();
    }
    g.globalAlpha = 1;
    // Starburst / grid motif behind the title.
    g.strokeStyle = c.trim;
    g.globalAlpha = 0.25;
    for (let k = 0; k < 14; k++) {
      g.beginPath();
      g.moveTo(r.w * 0.55, 150);
      const a = (k / 14) * Math.PI * 2;
      g.lineTo(r.w * 0.55 + Math.cos(a) * 300, 150 + Math.sin(a) * 300);
      g.stroke();
    }
    g.globalAlpha = 1;
    // Title running up the side (rotated), big.
    g.save();
    g.translate(r.w * 0.5, 300);
    g.rotate(-Math.PI / 2);
    const full = m.sub ? `${m.title} ${m.sub}` : m.title;
    const sc = fitScale(full, 270, 5);
    glowText(g, full, 40, -18, '#ffffff', sc, c.trim, 14);
    g.restore();
    // A neon edge (shows on the panel's thin edges too).
    g.strokeStyle = c.trim;
    g.lineWidth = 10;
    g.strokeRect(r.x + 5, r.y + 5, r.w - 10, r.h - 10);
    g.restore();
  }

  // --- Marquee: lit title.
  {
    const r = REGION.marquee;
    const bg = g.createLinearGradient(0, r.y, 0, r.y + r.h);
    bg.addColorStop(0, '#0a0614');
    bg.addColorStop(0.5, c.body);
    bg.addColorStop(1, '#0a0614');
    g.fillStyle = bg;
    g.fillRect(r.x, r.y, r.w, r.h);
    g.strokeStyle = c.trim;
    g.lineWidth = 3;
    g.strokeRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
    if (m.sub) {
      glowText(g, m.title, r.x + r.w / 2, r.y + 14, '#ffffff', fitScale(m.title, r.w - 24, 5), c.trim, 12);
      glowText(g, m.sub, r.x + r.w / 2, r.y + 58, c.accent2, fitScale(m.sub, r.w - 24, 4), c.accent, 12);
    } else glowText(g, m.title, r.x + r.w / 2, r.y + 32, '#ffffff', fitScale(m.title, r.w - 24, 6), c.trim, 12);
  }

  // --- Control panel top: the layout's print (stick ring and button labels are 3D on top of it).
  {
    const r = REGION.panel;
    g.fillStyle = '#0d0b12';
    g.fillRect(r.x, r.y, r.w, r.h);
    const gr = g.createLinearGradient(r.x, 0, r.x + r.w, 0);
    gr.addColorStop(0, c.body);
    gr.addColorStop(1, '#0d0b12');
    g.fillStyle = gr;
    g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = c.trim;
    g.fillRect(r.x, r.y + r.h - 6, r.w, 3);
    g.fillStyle = c.accent;
    g.fillRect(r.x, r.y + 3, r.w, 2);
    // Button legends under where the cabinet puts its buttons (the same layout, see controlLayout).
    for (const set of controlLayout(m.players)) {
      for (let b = 0; b < 3; b++) {
        if (!m.buttons[b]) continue;
        const [u, v] = set.buttons[b];
        text(g, m.buttons[b], r.x + u * r.w, r.y + (v + 0.3) * r.h, '#ffffff', 1, 'center');
      }
      // A printed ring round the stick.
      g.strokeStyle = c.accent;
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(r.x + set.stick[0] * r.w, r.y + set.stick[1] * r.h, 16, 16 * (r.h / r.w) * 2.6, 0, 0, Math.PI * 2);
      g.stroke();
      if (m.players === 2) text(g, set.stick[0] < 0.5 ? '1P' : '2P', r.x + set.stick[0] * r.w, r.y + 10, c.accent2, 2, 'center');
    }
  }

  // --- Bezel: gloss black frame with the title and a thin neon line around the glass.
  {
    const r = REGION.bezel;
    g.fillStyle = '#060509';
    g.fillRect(r.x, r.y, r.w, r.h);
    const gr = g.createLinearGradient(0, r.y, 0, r.y + r.h);
    gr.addColorStop(0, c.body);
    gr.addColorStop(0.2, '#060509');
    gr.addColorStop(0.8, '#060509');
    gr.addColorStop(1, c.body);
    g.fillStyle = gr;
    g.fillRect(r.x, r.y, r.w, r.h);
    g.strokeStyle = c.trim;
    g.lineWidth = 2;
    g.strokeRect(r.x + 22, r.y + 16, r.w - 44, r.h - 32);
    text(g, '1 PLAYER = $1', r.x + 30, r.y + r.h - 12, c.accent2, 1);
    text(g, 'PALAZZO LAGO', r.x + r.w - 30, r.y + 5, '#8a80a0', 1, 'right');
  }

  // --- Coin door: two lit coin slots on brushed steel (drawn squashed: the kick panel is tall).
  {
    const r = REGION.door;
    g.fillStyle = '#0b0a10';
    g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = c.body;
    g.fillRect(r.x, r.y, r.w, 6);
    const dw = 92,
      dx = r.x + (r.w - dw) / 2;
    g.fillStyle = '#5a5a66';
    g.fillRect(dx, r.y + 18, dw, 40);
    g.fillStyle = '#8a8a96';
    g.fillRect(dx + 2, r.y + 19, dw - 4, 2);
    for (let k = 0; k < 2; k++) {
      const sx = dx + 14 + k * 44;
      g.fillStyle = '#ff3b3b';
      g.fillRect(sx, r.y + 24, 20, 12);
      g.fillStyle = '#ffd9d9';
      g.fillRect(sx + 9, r.y + 26, 2, 8);
      text(g, '$1', sx + 10, r.y + 42, '#ffffff', 1, 'center');
    }
    g.fillStyle = c.trim;
    g.fillRect(r.x, r.y + r.h - 4, r.w, 4);
  }
  g.restore();
}

/** Fills the swatch spots (call after every cabinet and floor game has asked for its colours). */
export function paintSwatches(g: CanvasRenderingContext2D) {
  const [ox, oy] = tileOrigin(7);
  for (let k = 0; k < swatches.length; k++) {
    const x = ox + 232 + (k % 13) * 20,
      y = oy + 104 + Math.floor(k / 13) * 20;
    g.fillStyle = swatches[k];
    g.fillRect(x, y, 18, 18);
  }
}

export function atlasTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
