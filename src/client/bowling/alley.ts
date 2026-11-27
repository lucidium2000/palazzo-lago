import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Quality } from '../quality';
import { canvas, radial, toTexture } from '../textures';
import type { World } from '../world';
import { Batch, M, wallQuad, type Mats } from '../areas/kit';
import { SignAtlas } from '../areas/promenade';
import { APPROACH_END, BAR, BOWL_CARS, CONCOURSE, FOUL_X, laneZ, LANES, LANE_PITCH, LOUNGE, RACK, RETURNS, ROOM, SHOES } from './plan';
import { BACK_Z, DECK_END, GUTTER_W, HEAD_Z, KICK_X, LANE_HALF, PIT_DEPTH, SPOTS } from './sim';

/**
 * Palazzo Lanes, built: eight glossy maple lanes with their gutters, arrows
 * and dots, foul lines and approaches; the pinsetters' masking fascia (deco
 * fans, the lake and its cypresses, gilt lane numbers) and the dark pit and
 * curtain behind the pins; neon along the dividers and the fascia; the
 * settee lounge with a ball return between each pair of lanes; the bar and
 * the shoe counter on the concourse; the lift landing in the east wall.
 *
 * Everything static is merged by material (see kit.ts Batch), so the whole
 * room is a few dozen draws. The lanes' shine is cheap: a low-roughness
 * finish that picks up the room's captured reflections, plus a faint mirror
 * of the lit fascia and the ceiling's light strips painted onto the boards.
 */

const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = '"Futura", "Avenir Next", "Century Gothic", Arial, sans-serif';
const LANE_LEN = DECK_END;
/** The masking unit's front face (world x), and its bottom and top edges. */
export const FASCIA = { x: FOUL_X - (HEAD_Z - 0.75), y0: 0.95, y1: 2.75 };
/** Score monitors: centre (world x, y), size, tilt. */
export const MONITOR = { x: FOUL_X + 2.4, y: 2.78, w: 1.12, h: 0.63, tilt: 0.2 };
/** The span of the lanes across the room (world z), gutters included. */
const SPAN = { z0: laneZ(LANES - 1) - KICK_X - 0.14, z1: laneZ(0) + KICK_X + 0.14 };
/** Lounge furniture per lane pair. */
const SOFA = { x: LOUNGE.x1 - 0.95, d: 0.78, len: 2.5 };
const TABLE_X = SOFA.x - 1.05;
/** Lane consoles (one per lane, beside its ball return). */
export const CONSOLE = { x: RACK.x1 + 0.12, off: 0.44, y: 1.05 };

// ---------------------------------------------------------------------------
// World: where you can walk, what's in the way, where you can sit
// ---------------------------------------------------------------------------

export function registerBowling(world: World) {
  const R = ROOM;
  // The approaches (a step past the foul line is a foul, not a walk down the lane), the lounge and the concourse.
  world.addWalkable(FOUL_X - 0.45, R.x1 - 0.05, R.z0 + 0.3, R.z1 - 0.3);
  // The side aisles beside the outer lanes, down toward the pins.
  world.addWalkable(FASCIA.x + 0.6, FOUL_X, SPAN.z1 + 0.05, R.z1 - 0.3);
  world.addWalkable(FASCIA.x + 0.6, FOUL_X, R.z0 + 0.3, SPAN.z0 - 0.05);
  world.addSurface('marble', FOUL_X - 1, APPROACH_END, SPAN.z0, SPAN.z1);
  world.addSurface('carpet', APPROACH_END, R.x1, R.z0, R.z1);
  world.addSurface('carpet', FASCIA.x, FOUL_X, R.z0, SPAN.z0);
  world.addSurface('carpet', FASCIA.x, FOUL_X, SPAN.z1, R.z1);
  // The lanes' dividers past the foul line keep you off the boards (a wall beyond the foul line's step).
  world.addBox((FOUL_X - 0.45 + FASCIA.x) / 2 - 0.3, 0, FOUL_X - 0.45 - FASCIA.x - 0.6, SPAN.z1 - SPAN.z0, 0, 'lane');
  for (const r of RETURNS) {
    world.addBox((RACK.x0 + RACK.x1) / 2 + 0.05, r.z, RACK.x1 - RACK.x0 + 0.25, 0.52, 0, 'ball return');
    // The sofa (sit on it), its table.
    world.addBox(SOFA.x + 0.22, r.z, 0.36, SOFA.len, 0, 'sofa');
    for (const dz of [-0.75, 0, 0.75]) world.addSeat(SOFA.x - 0.12, r.z + dz, 0.32, 0.46, -Math.PI / 2, 'sofa');
    world.addCircle(TABLE_X, r.z, 0.36, 'table');
    for (const s of [-1, 1]) world.addCircle(CONSOLE.x, r.z + s * CONSOLE.off, 0.1, 'console');
  }
  // The bar: its counter and stools; the shoe counter.
  world.addBox((BAR.x0 + BAR.x1) / 2, (BAR.z0 + BAR.z1) / 2 - 0.25, BAR.x1 - BAR.x0, BAR.z1 - BAR.z0 + 0.5, 0, 'bar');
  for (let i = 0; i < 5; i++) world.addSeat(BAR.x0 + 0.6 + i * 1.15, BAR.z1 + 0.42, 0.24, 0.76, Math.PI, 'bar stool');
  world.addBox((SHOES.x0 + SHOES.x1) / 2, (SHOES.z0 + SHOES.z1) / 2 + 0.2, SHOES.x1 - SHOES.x0, SHOES.z1 - SHOES.z0 + 0.4, 0, 'shoe counter');
  // High-top tables on the concourse.
  for (const [x, z] of HIGH_TOPS) {
    world.addCircle(x, z, 0.36, 'table');
    for (const a of [0, Math.PI]) world.addSeat(x + Math.cos(a) * 0.62, z + Math.sin(a) * 0.62, 0.22, 0.76, null, 'stool');
  }
}

const HIGH_TOPS: [number, number][] = [
  [-287.4, -4.4],
  [-287.4, 4.4],
  [-284.6, -4.6],
  [-284.6, 4.6],
];

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

let seed = 17;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** A lane, foul line to the deck's tail: maple, then pine, then the maple deck; the dots, arrows and pin spots. */
function laneTexture(): HTMLCanvasElement {
  const W = 256,
    H = 4096;
  const [c, g] = canvas(W, H);
  const boards = 39;
  const bw = W / boards;
  const pxm = H / LANE_LEN;
  const pineAt = 4.88 * pxm,
    deckAt = (HEAD_Z - 0.38) * pxm;
  for (let b = 0; b < boards; b++) {
    for (let y = 0; y < H; y += 64) {
      const pine = y > pineAt && y < deckAt;
      const t = 0.92 + rnd() * 0.12;
      const [r, gg, bb] = pine ? [222, 178, 118] : [214, 160, 98];
      g.fillStyle = `rgb(${r * t},${gg * t},${bb * t})`;
      g.fillRect(b * bw, y, bw + 0.5, 64);
    }
    // Grain: fine streaks along the board.
    for (let k = 0; k < 40; k++) {
      g.fillStyle = `rgba(110,60,20,${0.04 + rnd() * 0.06})`;
      g.fillRect(b * bw + rnd() * bw, rnd() * H, 0.8, 30 + rnd() * 200);
    }
    g.fillStyle = 'rgba(70,36,12,0.45)';
    g.fillRect(b * bw, 0, 0.7, H);
  }
  // Joints where the maple meets the pine and the deck.
  g.fillStyle = 'rgba(60,30,10,0.5)';
  g.fillRect(0, pineAt, W, 1.5);
  g.fillRect(0, deckAt, W, 1.5);
  // The foul line.
  g.fillStyle = '#1a0f0a';
  g.fillRect(0, 0, W, 4);
  const board = (n: number) => W - (n - 0.5) * bw; // boards counted from the right (a right-hander's view)
  // Guide dots at 7 ft.
  g.fillStyle = '#2a140a';
  for (const n of [3, 5, 8, 11, 14, 26, 29, 32, 35, 37]) {
    g.beginPath();
    g.arc(board(n), 2.13 * pxm, 2.6, 0, Math.PI * 2);
    g.fill();
  }
  // The arrows (a V pointing down the lane, 12-16 ft).
  for (const n of [5, 10, 15, 20, 25, 30, 35]) {
    const d = (16 - (Math.abs(n - 20) / 15) * 3.4) * 0.3048 * pxm;
    const x = board(n);
    g.fillStyle = '#24110a';
    g.beginPath();
    g.moveTo(x, d + 22);
    g.lineTo(x - bw * 0.5, d - 6);
    g.lineTo(x + bw * 0.5, d - 6);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(200,160,90,0.5)';
    g.fillRect(x - 0.6, d - 4, 1.2, 18);
  }
  // Pin spots on the deck.
  g.fillStyle = 'rgba(40,20,8,0.75)';
  for (const [x, z] of SPOTS) {
    g.beginPath();
    g.arc(W / 2 - (x / (2 * LANE_HALF)) * W, z * pxm, 3.2, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/** The approach behind the foul line (4.6 m): maple and the stance dots at 12 and 15 ft. */
function approachTexture(): HTMLCanvasElement {
  const W = 256,
    H = 512;
  const [c, g] = canvas(W, H);
  const boards = 39;
  const bw = W / boards;
  const L = APPROACH_END - FOUL_X;
  for (let b = 0; b < boards; b++) {
    for (let y = 0; y < H; y += 48) {
      const t = 0.93 + rnd() * 0.1;
      g.fillStyle = `rgb(${200 * t},${150 * t},${92 * t})`;
      g.fillRect(b * bw, y, bw + 0.5, 48);
    }
    g.fillStyle = 'rgba(70,36,12,0.4)';
    g.fillRect(b * bw, 0, 0.7, H);
  }
  // Foul line at the top (row 0), dots at 12 and 15 ft back from it.
  g.fillStyle = '#140c08';
  g.fillRect(0, 0, W, 5);
  g.fillStyle = '#2a140a';
  for (const ft of [12, 15]) {
    const y = ((ft * 0.3048) / L) * H;
    if (y >= H) continue;
    for (const n of [3, 5, 8, 11, 14, 20, 26, 29, 32, 35, 37]) {
      g.beginPath();
      g.arc(W - (n - 0.5) * bw, y, 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  return c;
}

/** The pinsetters' masking fascia across all lanes (left to right as the bowlers see it). */
function fasciaTexture(): HTMLCanvasElement {
  const W = 4096,
    H = 512;
  const [c, g] = canvas(W, H);
  const span = SPAN.z1 - SPAN.z0;
  const pxm = W / span;
  // Lacquered midnight with a fine gold rule top and bottom.
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0a0d1e');
  bg.addColorStop(0.6, '#121634');
  bg.addColorStop(1, '#070812');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#c9a050';
  g.fillRect(0, 10, W, 4);
  g.fillRect(0, H - 14, W, 4);
  for (let i = 0; i < LANES; i++) {
    const cx = (SPAN.z1 - laneZ(i)) * pxm;
    const half = (LANE_PITCH / 2) * pxm;
    // A deco arch per lane: the lake at night through it, cypresses and a villa's lit windows.
    const aw = half * 0.86,
      top = 70,
      base = H - 40;
    g.save();
    g.beginPath();
    g.moveTo(cx - aw, base);
    g.lineTo(cx - aw, top + aw * 0.55);
    g.ellipse(cx, top + aw * 0.55, aw, aw * 0.55, 0, Math.PI, 0);
    g.lineTo(cx + aw, base);
    g.closePath();
    g.clip();
    const sky = g.createLinearGradient(0, top, 0, base);
    sky.addColorStop(0, '#141a46');
    sky.addColorStop(0.55, '#3a2a5e');
    sky.addColorStop(0.72, '#c8705a');
    sky.addColorStop(0.73, '#1a2848');
    sky.addColorStop(1, '#0a1226');
    g.fillStyle = sky;
    g.fillRect(cx - aw, top, aw * 2, base - top);
    // The moon (each lane's a little further along its arc).
    g.fillStyle = 'rgba(255,236,200,0.95)';
    g.beginPath();
    g.arc(cx - aw * 0.5 + (i / (LANES - 1)) * aw, top + 70 + Math.sin((i / (LANES - 1)) * Math.PI) * -24, 15, 0, Math.PI * 2);
    g.fill();
    // Its path on the water.
    const horizon = top + (base - top) * 0.725;
    for (let k = 0; k < 9; k++) {
      g.fillStyle = `rgba(255,220,170,${0.35 - k * 0.03})`;
      g.fillRect(cx - aw * 0.5 + (i / (LANES - 1)) * aw - 18 + k * 2, horizon + 6 + k * 10, 36 - k * 4, 3);
    }
    // Far hills and the villa on the shore.
    g.fillStyle = '#0c1430';
    g.beginPath();
    g.moveTo(cx - aw, horizon);
    for (let k = 0; k <= 10; k++) g.lineTo(cx - aw + (k / 10) * aw * 2, horizon - 18 - 14 * Math.sin(k * 1.3 + i));
    g.lineTo(cx + aw, horizon);
    g.fill();
    g.fillStyle = '#e8c890';
    for (let k = 0; k < 6; k++) g.fillRect(cx - 40 + k * 14, horizon - 14, 6, 6);
    // Cypresses either side.
    g.fillStyle = '#050a14';
    for (const s of [-1, 1]) {
      const x = cx + s * aw * 0.72;
      g.beginPath();
      g.ellipse(x, horizon - 50, 13, 66, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    // Gilt frame round the arch.
    g.strokeStyle = '#d8b46a';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(cx - aw, base);
    g.lineTo(cx - aw, top + aw * 0.55);
    g.ellipse(cx, top + aw * 0.55, aw, aw * 0.55, 0, Math.PI, 0);
    g.lineTo(cx + aw, base);
    g.stroke();
    // Deco fan rays between the lanes.
    if (i < LANES - 1) {
      const fx = cx + half;
      g.strokeStyle = 'rgba(216,180,106,0.55)';
      g.lineWidth = 2;
      for (let k = -4; k <= 4; k++) {
        g.beginPath();
        g.moveTo(fx, base);
        g.lineTo(fx + k * 9, 60);
        g.stroke();
      }
    }
    // The lane number in a gilt roundel at the arch's foot.
    g.fillStyle = '#0a0d1e';
    g.beginPath();
    g.arc(cx, base - 6, 46, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#d8b46a';
    g.lineWidth = 5;
    g.stroke();
    g.fillStyle = '#f2d38a';
    g.font = `bold 58px ${SERIF}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(i + 1), cx, base - 4);
  }
  // The name across the top, centred between lanes 4 and 5.
  g.font = `600 40px ${SANS}`;
  g.fillStyle = '#f2d38a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const mid = (SPAN.z1 - (laneZ(3) + laneZ(4)) / 2) * pxm;
  g.fillText('P A L A Z Z O   L A N E S', mid, 38);
  return c;
}

/** The faint mirror of the fascia's glow and the ceiling's light strips on the boards (additive). */
function sheenTexture(): HTMLCanvasElement {
  const W = 512,
    H = 512;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const span = SPAN.z1 - SPAN.z0;
  for (let i = 0; i < LANES; i++) {
    const cx = ((SPAN.z1 - laneZ(i)) / span) * W;
    const hw = (LANE_HALF / span) * W;
    // The fascia's reflection: strongest by the pins (top), fading toward the bowler.
    const gr = g.createLinearGradient(0, 0, 0, H * 0.75);
    gr.addColorStop(0, 'rgba(150,120,200,0.55)');
    gr.addColorStop(0.15, 'rgba(110,80,160,0.3)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(cx - hw, 0, hw * 2, H * 0.75);
    // Streaks under the ceiling's light baffles (along the lane).
    for (let k = 0; k < 4; k++) {
      const y = H * (0.18 + k * 0.21);
      const s = g.createRadialGradient(cx, y, 0, cx, y, 70);
      s.addColorStop(0, 'rgba(255,230,190,0.32)');
      s.addColorStop(1, 'rgba(255,230,190,0)');
      g.save();
      g.translate(cx, y);
      g.scale(0.22, 1);
      g.translate(-cx, -y);
      g.fillStyle = s;
      g.fillRect(cx - 80, y - 80, 160, 160);
      g.restore();
    }
  }
  return c;
}

/** The lounge carpet: midnight with gold and teal deco rings (original). */
function carpetTexture(): HTMLCanvasElement {
  const S = 512;
  const [c, g] = canvas(S);
  g.fillStyle = '#121633';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2000; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},0.04)`;
    g.fillRect(rnd() * S, rnd() * S, 2, 2);
  }
  const ring = (x: number, y: number, r: number, col: string, w: number) => {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.stroke();
  };
  for (const [x, y] of [
    [0, 0],
    [S, 0],
    [0, S],
    [S, S],
    [S / 2, S / 2],
  ]) {
    ring(x, y, 120, '#c9a050', 6);
    ring(x, y, 96, '#2a9a96', 4);
    ring(x, y, 70, '#c9a050', 3);
    ring(x, y, 30, '#7a3cc8', 8);
  }
  g.strokeStyle = 'rgba(201,160,80,0.5)';
  g.lineWidth = 2;
  for (const [x, y] of [
    [S / 2, 0],
    [0, S / 2],
    [S, S / 2],
    [S / 2, S],
  ]) {
    for (let k = 0; k < 8; k++) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos((k * Math.PI) / 4) * 60, y + Math.sin((k * Math.PI) / 4) * 60);
      g.stroke();
    }
  }
  return c;
}

/** Walnut panelling with brass reeds (the walls below the neon). */
function panelTexture(): HTMLCanvasElement {
  const W = 256,
    H = 256;
  const [c, g] = canvas(W, H);
  const grd = g.createLinearGradient(0, 0, W, 0);
  grd.addColorStop(0, '#2a1610');
  grd.addColorStop(0.5, '#3c2116');
  grd.addColorStop(1, '#2a1610');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  for (let k = 0; k < 60; k++) {
    g.fillStyle = `rgba(20,8,4,${0.1 + rnd() * 0.15})`;
    g.fillRect(rnd() * W, 0, 1 + rnd() * 2, H);
  }
  g.fillStyle = '#b8904a';
  g.fillRect(0, 0, 3, H);
  g.fillRect(W - 3, 0, 3, H);
  return c;
}

/** A canvas pin texture: white maple lacquer, two red neck stripes, a little gold crest. */
export function pinTexture(): HTMLCanvasElement {
  const W = 128,
    H = 256;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#f6f3ec';
  g.fillRect(0, 0, W, H);
  // v = height / pin height; canvas row 0 is the top of the pin.
  const row = (h: number) => H * (1 - h / 0.381);
  g.fillStyle = '#c4141e';
  g.fillRect(0, row(0.262), W, row(0.252) - row(0.262));
  g.fillRect(0, row(0.243), W, row(0.236) - row(0.243));
  // The crest on the front (u = 0.25).
  g.fillStyle = '#b8862e';
  g.font = `bold 15px ${SERIF}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('P', W * 0.25, row(0.3));
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, row(0.01), W, H - row(0.01));
  return c;
}

/** The house balls' finish: a marbled swirl (tinted per ball) and three finger holes. */
export function ballTexture(): HTMLCanvasElement {
  const W = 256,
    H = 128;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#9a9a9a';
  g.fillRect(0, 0, W, H);
  for (let k = 0; k < 22; k++) {
    g.strokeStyle = `rgba(255,255,255,${0.15 + rnd() * 0.3})`;
    g.lineWidth = 2 + rnd() * 6;
    g.beginPath();
    let x = rnd() * W,
      y = rnd() * H;
    g.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += (rnd() - 0.5) * 80;
      y += (rnd() - 0.5) * 40;
      g.quadraticCurveTo(x + (rnd() - 0.5) * 40, y + (rnd() - 0.5) * 40, x, y);
    }
    g.stroke();
  }
  for (let k = 0; k < 14; k++) {
    g.strokeStyle = `rgba(30,30,30,${0.15 + rnd() * 0.2})`;
    g.lineWidth = 1 + rnd() * 3;
    g.beginPath();
    g.moveTo(rnd() * W, rnd() * H);
    g.bezierCurveTo(rnd() * W, rnd() * H, rnd() * W, rnd() * H, rnd() * W, rnd() * H);
    g.stroke();
  }
  // Finger holes (two fingers and the thumb), near the top (u ≈ 0.25).
  const hole = (x: number, y: number, r: number) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, '#000');
    gr.addColorStop(0.75, '#111');
    gr.addColorStop(1, 'rgba(60,60,60,0.6)');
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(x, y, r, r * 1.4, 0, 0, Math.PI * 2);
    g.fill();
  };
  hole(W * 0.24, H * 0.3, 5.5);
  hole(W * 0.28, H * 0.3, 5.5);
  hole(W * 0.26, H * 0.44, 6.5);
  return c;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** A flat quad facing up over x0..x1, z0..z1, with explicit UVs: u0/u1 at z1/z0 (left to right facing west), v0/v1 at x1/x0. */
function floorQuad(x0: number, x1: number, z0: number, z1: number, y: number, u: [number, number], v: [number, number]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  // Corners: (x0,z1) (x1,z1) (x1,z0) (x0,z0); facing up (counter-clockwise seen from above).
  const pos = [x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z1, x1, y, z0, x0, y, z0];
  const uvAt = (x: number, z: number) => [u[0] + ((z1 - z) / (z1 - z0)) * (u[1] - u[0]), v[1] + ((x - x0) / (x1 - x0)) * (v[0] - v[1])];
  const uv: number[] = [];
  for (let i = 0; i < 6; i++) uv.push(...uvAt(pos[i * 3], pos[i * 3 + 2]));
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(18).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // Winding: make sure it faces up.
  return fixUp(g);
}

function fixUp(g: THREE.BufferGeometry) {
  const p = g.attributes.position as THREE.BufferAttribute;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  a.fromBufferAttribute(p, 0);
  b.fromBufferAttribute(p, 1);
  c.fromBufferAttribute(p, 2);
  const n = b.sub(a).cross(c.sub(a));
  if (n.y < 0) {
    const idx = [0, 2, 1, 3, 5, 4];
    const arr = p.array as Float32Array;
    const uv = (g.attributes.uv as THREE.BufferAttribute).array as Float32Array;
    const np = new Float32Array(18),
      nu = new Float32Array(12);
    idx.forEach((s, d) => {
      np.set(arr.subarray(s * 3, s * 3 + 3), d * 3);
      nu.set(uv.subarray(s * 2, s * 2 + 2), d * 2);
    });
    g.setAttribute('position', new THREE.BufferAttribute(np, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(nu, 2));
  }
  return g;
}

/** A gutter's half-pipe along x (open side up). */
function gutterGeo(x0: number, x1: number, z: number): THREE.BufferGeometry {
  const r = GUTTER_W / 2;
  const g = new THREE.CylinderGeometry(r, r, x1 - x0, 12, 1, true, Math.PI / 2, Math.PI);
  g.rotateZ(Math.PI / 2);
  g.translate((x0 + x1) / 2, 0.005, z);
  return g;
}

/** A pin's lathe (origin at its centre of mass, like the sim's body), with UVs by height. */
export function pinGeometry(): THREE.BufferGeometry {
  const prof: [number, number][] = [
    [0.0, 0.0],
    [0.0258, 0.0],
    [0.034, 0.02],
    [0.05, 0.058],
    [0.0605, 0.114],
    [0.056, 0.16],
    [0.042, 0.208],
    [0.026, 0.248],
    [0.0228, 0.268],
    [0.028, 0.298],
    [0.0318, 0.33],
    [0.0296, 0.356],
    [0.02, 0.374],
    [0.0, 0.381],
  ];
  const g = new THREE.LatheGeometry(
    prof.map(([r, h]) => new THREE.Vector2(r, h)),
    16,
  );
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setY(i, pos.getY(i) / 0.381);
  g.translate(0, -0.143, 0);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export interface Alley {
  root: THREE.Group;
  /** The overhead score monitors: one canvas atlas (a cell per lane), drawn by the game. */
  monitors: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; cell: { w: number; h: number }; cellAt(i: number): { x: number; y: number } };
  /** The lane consoles' screens (one atlas: a cell per lane). */
  consoles: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; meshes: THREE.Mesh[]; cell: { w: number; h: number }; cellAt(i: number): { x: number; y: number } };
  /** Red foul lamps, one per lane (lit by the game). */
  foulLamps: THREE.InstancedMesh;
  /** A spot to hang sound on: the middle of the pin decks. */
  pinsAnchor: THREE.Object3D;
  lounge: THREE.Object3D;
  bar: THREE.Object3D;
}

export function buildAlley(scene: THREE.Scene, q: Quality, m: Mats): Alley {
  const root = new THREE.Group();
  root.name = 'bowling';
  scene.add(root);
  const b = new Batch();
  const signs = new SignAtlas();
  const R = ROOM;
  const big = q.texSize >= 2048;

  // --- Materials -----------------------------------------------------------------------
  const laneTex = toTexture(laneTexture());
  laneTex.anisotropy = q.name === 'desktop' ? 8 : 4;
  const lane = new THREE.MeshStandardMaterial({ map: laneTex, roughness: 0.16, metalness: 0, envMapIntensity: 1.25, emissive: 0xffffff, emissiveMap: laneTex, emissiveIntensity: 0.16 });
  const apprTex = toTexture(approachTexture());
  apprTex.anisotropy = 4;
  const approach = new THREE.MeshStandardMaterial({ map: apprTex, roughness: 0.22, envMapIntensity: 1.1, emissive: 0xffffff, emissiveMap: apprTex, emissiveIntensity: 0.13 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 1, roughness: 0.22, envMapIntensity: 1.4 });
  const lacquer = new THREE.MeshStandardMaterial({ color: 0x0c0c12, roughness: 0.18, metalness: 0.2, envMapIntensity: 1.2 });
  const matte = new THREE.MeshStandardMaterial({ color: 0x060608, roughness: 0.95 });
  const panelT = toTexture(panelTexture());
  panelT.wrapS = panelT.wrapT = THREE.RepeatWrapping;
  panelT.repeat.set(1 / 0.9, 1 / 3);
  const walnut = new THREE.MeshStandardMaterial({ map: panelT, roughness: 0.45, envMapIntensity: 0.9, emissive: 0x1a0c06, emissiveIntensity: 0.5 });
  const carpetT = toTexture(carpetTexture());
  carpetT.wrapS = carpetT.wrapT = THREE.RepeatWrapping;
  carpetT.repeat.set(1 / 2.4, 1 / 2.4);
  const carpet = new THREE.MeshStandardMaterial({ map: carpetT, roughness: 0.95, emissive: 0xffffff, emissiveMap: carpetT, emissiveIntensity: 0.1 });
  const ceiling = new THREE.MeshStandardMaterial({ color: 0x14121a, roughness: 0.9, emissive: 0x08070c, emissiveIntensity: 1 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x5a1220, roughness: 0.42, envMapIntensity: 0.9, emissive: 0x200408, emissiveIntensity: 0.5 });
  const brass = m.gold;
  const marbleTop = m.marble;
  const glowWarm = m.glow(0xffe2b0, 1.5);
  const neonPink = m.glow(0xff3fa8, 2.2);
  const neonTeal = m.glow(0x2fe0d8, 2.0);
  const neonGold = m.glow(0xffc65a, 2.0);
  const neonViolet = m.glow(0x9a5cff, 2.0);
  const fasciaTex = toTexture(fasciaTexture());
  fasciaTex.anisotropy = 4;
  const fascia = new THREE.MeshBasicMaterial({ map: fasciaTex, color: new THREE.Color(0.95, 0.95, 0.95) });

  // --- The lanes -------------------------------------------------------------------------
  for (let i = 0; i < LANES; i++) {
    const z = laneZ(i);
    // The boards, foul line to the deck's tail.
    b.add(floorQuad(FOUL_X - LANE_LEN, FOUL_X, z - LANE_HALF, z + LANE_HALF, 0, [0, 1], [0, 1]), lane);
    // Gutters either side, the deck's gutters to the pit.
    for (const s of [-1, 1]) b.add(gutterGeo(FOUL_X - LANE_LEN, FOUL_X, z + s * (LANE_HALF + GUTTER_W / 2)), chrome);
    // The approach (to the lounge's step), the same width as lane and gutters.
    b.add(floorQuad(FOUL_X, APPROACH_END, z - KICK_X, z + KICK_X, 0, [0, 1], [0, 1]), approach);
    // Kickback plates beside the deck (between this lane and the next), and the pit behind.
    for (const s of [-1, 1]) b.box(lacquer, FOUL_X - (HEAD_Z + BACK_Z) / 2 + 0.3, 0.32, z + s * (KICK_X + 0.035), BACK_Z - HEAD_Z + 0.6, 0.9, 0.07);
    // The foul line's sensor posts (little lacquer boxes either side).
    for (const s of [-1, 1]) b.box(lacquer, FOUL_X - 0.02, 0.05, z + s * (KICK_X - 0.03), 0.08, 0.1, 0.05);
  }
  // Capping between gutters (and beyond the outer lanes): polished black divider boards with a teal neon inlay.
  for (let i = 0; i <= LANES; i++) {
    const z0 = i === 0 ? SPAN.z1 : laneZ(i - 1) - KICK_X;
    const z1 = i === LANES ? SPAN.z0 : laneZ(i) + KICK_X;
    const cz = (z0 + z1) / 2,
      w = Math.abs(z1 - z0);
    b.box(lacquer, FOUL_X - (HEAD_Z - 0.6) / 2, 0.025, cz, HEAD_Z - 0.6, 0.05, w);
    b.box(neonTeal, FOUL_X - (HEAD_Z - 0.6) / 2, 0.052, cz, HEAD_Z - 0.6, 0.006, 0.014);
  }
  // The pit and the back cushion (black velvet), the deck's lights under the fascia.
  b.add(floorQuad(FOUL_X - BACK_Z - 0.4, FOUL_X - DECK_END, SPAN.z0, SPAN.z1, -PIT_DEPTH, [0, 1], [0, 1]), matte);
  b.add(wallQuad(SPAN.z1 - SPAN.z0, 2.2), matte, M(FOUL_X - BACK_Z - 0.02, 0.8, 0, Math.PI / 2));
  b.box(matte, FOUL_X - DECK_END - 0.01, -PIT_DEPTH / 2, 0, 0.02, PIT_DEPTH, SPAN.z1 - SPAN.z0);
  // The masking unit: the fascia face, its gilt edge, the dark housing above and behind it.
  {
    const w = SPAN.z1 - SPAN.z0;
    const cz = (SPAN.z0 + SPAN.z1) / 2;
    const fg = new THREE.PlaneGeometry(w, FASCIA.y1 - FASCIA.y0);
    fg.rotateY(Math.PI / 2);
    fg.translate(FASCIA.x, (FASCIA.y0 + FASCIA.y1) / 2, cz);
    const fm = new THREE.Mesh(fg, fascia);
    fm.name = 'bowling-fascia';
    fm.raycast = () => {};
    root.add(fm);
    b.box(brass, FASCIA.x + 0.02, FASCIA.y0 - 0.02, cz, 0.05, 0.04, w);
    b.box(brass, FASCIA.x + 0.02, FASCIA.y1 + 0.02, cz, 0.05, 0.04, w);
    b.box(neonViolet, FASCIA.x + 0.05, FASCIA.y0 - 0.06, cz, 0.012, 0.02, w);
    b.box(neonPink, FASCIA.x + 0.05, FASCIA.y1 + 0.08, cz, 0.012, 0.025, w);
    // Housing: from the fascia's top to the ceiling, and its underside over the pins (lit).
    b.add(wallQuad(w, R.h - FASCIA.y1), lacquer, M(FASCIA.x - 0.01, (R.h + FASCIA.y1) / 2, cz, Math.PI / 2));
    b.box(matte, FASCIA.x - 1.6, FASCIA.y0 + 0.02, cz, 3.2, 0.04, w);
    // The light bar under the fascia's lip (it lights the pins).
    for (let i = 0; i < LANES; i++) b.box(glowWarm, FASCIA.x - 0.2, FASCIA.y0 - 0.005, laneZ(i), 0.08, 0.012, LANE_HALF * 1.8);
  }
  // A soft pool of light on each deck (additive).
  {
    const pool = new THREE.MeshBasicMaterial({ map: toTexture(radial(128, 'rgba(255,236,200,0.5)', 'rgba(255,200,140,0)')), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const geos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < LANES; i++) {
      const g = new THREE.PlaneGeometry(2.0, 1.25).rotateX(-Math.PI / 2);
      g.translate(FOUL_X - HEAD_Z - 0.35, 0.004, laneZ(i));
      geos.push(g);
    }
    const mesh = new THREE.Mesh(mergeGeometries(geos)!, pool);
    mesh.raycast = () => {};
    mesh.renderOrder = 2;
    root.add(mesh);
  }
  // The lanes' mirror shine (additive, over the boards from the pins back).
  {
    const sheen = new THREE.MeshBasicMaterial({ map: toTexture(sheenTexture()), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.75 });
    const g = floorQuad(FOUL_X - HEAD_Z + 0.4, FOUL_X - 1.0, SPAN.z0, SPAN.z1, 0.003, [0, 1], [0, 1]);
    const mesh = new THREE.Mesh(g, sheen);
    mesh.raycast = () => {};
    mesh.renderOrder = 1;
    mesh.name = 'bowling-sheen';
    root.add(mesh);
  }

  // --- The room: floor, walls, ceiling -------------------------------------------------
  // The side aisles and the lounge and concourse: carpet.
  b.add(floorQuad(APPROACH_END, R.x1, R.z0, R.z1, 0.002, [0, (R.z1 - R.z0) / 2.4], [0, (R.x1 - APPROACH_END) / 2.4]), carpet);
  b.add(floorQuad(FASCIA.x - 0.4, APPROACH_END, SPAN.z1, R.z1, 0.002, [0, (R.z1 - SPAN.z1) / 2.4], [0, (APPROACH_END - FASCIA.x) / 2.4]), carpet);
  b.add(floorQuad(FASCIA.x - 0.4, APPROACH_END, R.z0, SPAN.z0, 0.002, [0, (SPAN.z0 - R.z0) / 2.4], [0, (APPROACH_END - FASCIA.x) / 2.4]), carpet);
  // The lounge's step edge (a brass nosing where the approaches end).
  b.box(brass, APPROACH_END + 0.01, 0.012, 0, 0.03, 0.024, SPAN.z1 - SPAN.z0);
  // Ceiling.
  b.add(new THREE.PlaneGeometry(R.x1 - R.x0, R.z1 - R.z0).rotateX(Math.PI / 2), ceiling, M((R.x0 + R.x1) / 2, R.h, 0));
  // Light baffles over each lane (warm strips), and over the lounge, coves.
  for (let i = 0; i < LANES; i++) {
    for (let k = 0; k < 4; k++) {
      const x = FOUL_X - 2.5 - k * 3.9;
      b.box(lacquer, x, R.h - 0.08, laneZ(i), 1.6, 0.14, 0.32);
      b.box(glowWarm, x, R.h - 0.152, laneZ(i), 1.5, 0.006, 0.18);
    }
  }
  for (const z of [-4.8, 0, 4.8]) {
    b.box(lacquer, (LOUNGE.x0 + R.x1) / 2, R.h - 0.1, z, R.x1 - LOUNGE.x0 - 1, 0.2, 0.5);
    b.box(neonGold, (LOUNGE.x0 + R.x1) / 2, R.h - 0.203, z, R.x1 - LOUNGE.x0 - 1.2, 0.006, 0.08);
  }
  // Walls: walnut panelling to 2.4 m, then dark, with neon bands; the north and south walls run the length.
  const wallH = 2.4;
  for (const [z, ry] of [
    [R.z0, 0],
    [R.z1, Math.PI],
  ] as const) {
    const len = R.x1 - R.x0;
    b.add(wallQuad(len, wallH), walnut, M((R.x0 + R.x1) / 2, wallH / 2, z, ry));
    b.add(wallQuad(len, R.h - wallH), lacquer, M((R.x0 + R.x1) / 2, (R.h + wallH) / 2, z, ry));
    const s = ry ? -1 : 1;
    b.box(brass, (R.x0 + R.x1) / 2, wallH, z + s * 0.02, len, 0.04, 0.04);
    b.box(neonPink, (R.x0 + R.x1) / 2, wallH + 0.12, z + s * 0.025, len, 0.02, 0.012);
    b.box(neonTeal, (R.x0 + R.x1) / 2, R.h - 0.18, z + s * 0.025, len, 0.016, 0.012);
    b.box(walnut, (R.x0 + R.x1) / 2, 0.06, z + s * 0.03, len, 0.12, 0.06);
  }
  // The pit's back wall (behind the curtain) and the east wall round the lifts.
  b.add(wallQuad(R.z1 - R.z0, R.h), matte, M(R.x0, R.h / 2, 0, Math.PI / 2));
  {
    const eastSeg = (z0: number, z1: number, y0: number, y1: number, mat: THREE.Material) => b.add(wallQuad(z1 - z0, y1 - y0), mat, M(R.x1, (y0 + y1) / 2, (z0 + z1) / 2, -Math.PI / 2));
    const [za, zb] = BOWL_CARS.zs;
    eastSeg(R.z0, za - 0.83, 0, wallH, walnut);
    eastSeg(za + 0.83, zb - 0.83, 0, wallH, walnut);
    eastSeg(zb + 0.83, R.z1, 0, wallH, walnut);
    eastSeg(R.z0, R.z1, 2.6, R.h, lacquer);
    for (const [z0, z1] of [
      [R.z0, za - 0.83],
      [za + 0.83, zb - 0.83],
      [zb + 0.83, R.z1],
    ])
      eastSeg(z0, z1, wallH, 2.6, lacquer);
    for (const z of BOWL_CARS.zs) eastSeg(z - 0.83, z + 0.83, 2.6, 2.6 + 0.0001, lacquer);
    b.box(brass, R.x1 - 0.02, wallH, 0, 0.04, 0.04, R.z1 - R.z0);
    // Behind the east wall: closed in (seen from the cabs' doors).
    b.box(matte, R.x1 + 2.7, R.h / 2, 0, 0.2, R.h, R.z1 - R.z0);
    // The landing's sign over the lifts.
    signs.add(2.2, 0.36, 512, 84, M(R.x1 - 0.03, 2.95, 0, -Math.PI / 2), (g, w, h) => {
      g.fillStyle = '#0a0a10';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#d8b46a';
      g.lineWidth = 4;
      g.strokeRect(4, 4, w - 8, h - 8);
      g.fillStyle = '#f2d38a';
      g.font = `600 40px ${SANS}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('ELEVATORS  ·  B', w / 2, h / 2 + 2);
    });
  }
  // Wall art along the side aisles (original posters).
  POSTERS.forEach((p, k) => {
    const x = FOUL_X - 3.5 - k * 4.4;
    for (const [z, ry] of [
      [R.z0 + 0.03, 0],
      [R.z1 - 0.03, Math.PI],
    ] as const) {
      b.box(brass, x, 1.55, z + (ry ? 0.01 : -0.01), 1.04, 1.44, 0.03);
      signs.add(0.96, 1.36, 192, 272, M(x, 1.55, z + (ry ? -0.01 : 0.01), ry), p);
    }
  });

  // --- Score monitors over the approaches ------------------------------------------------
  const MON = { cw: 512, ch: 288 };
  const [monC] = canvas(MON.cw * 2, 2048);
  const monTex = new THREE.CanvasTexture(monC);
  monTex.colorSpace = THREE.SRGBColorSpace;
  monTex.anisotropy = 4;
  const monCell = (i: number) => ({ x: (i % 2) * MON.cw, y: Math.floor(i / 2) * MON.ch });
  {
    const geos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < LANES; i++) {
      const g = new THREE.PlaneGeometry(MONITOR.w, MONITOR.h);
      const { x, y } = monCell(i);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, (x + uv.getX(k) * MON.cw) / monC.width, 1 - (y + (1 - uv.getY(k)) * MON.ch) / monC.height);
      g.rotateX(-MONITOR.tilt);
      g.rotateY(Math.PI / 2);
      g.translate(MONITOR.x, MONITOR.y, laneZ(i));
      geos.push(g);
      // Bezel and the hanger rods.
      b.box(lacquer, MONITOR.x - 0.035, MONITOR.y, laneZ(i), 0.05, MONITOR.h + 0.06, MONITOR.w + 0.06);
      b.box(brass, MONITOR.x - 0.05, (MONITOR.y + MONITOR.h / 2 + R.h) / 2, laneZ(i), 0.03, R.h - MONITOR.y - MONITOR.h / 2, 0.03);
    }
    const mesh = new THREE.Mesh(mergeGeometries(geos)!, new THREE.MeshBasicMaterial({ map: monTex, toneMapped: false }));
    mesh.name = 'bowling-monitors';
    mesh.raycast = () => {};
    root.add(mesh);
  }

  // --- The lounge: ball returns, consoles, sofas, tables ---------------------------------
  const lounge = new THREE.Group();
  lounge.name = 'bowling-lounge';
  const CON = { cw: 256, ch: 160 };
  const [conC] = canvas(CON.cw * 2, CON.ch * 4);
  const conTex = new THREE.CanvasTexture(conC);
  conTex.colorSpace = THREE.SRGBColorSpace;
  const conCell = (i: number) => ({ x: (i % 2) * CON.cw, y: Math.floor(i / 2) * CON.ch });
  const conMat = new THREE.MeshBasicMaterial({ map: conTex, toneMapped: false });
  const conMeshes: THREE.Mesh[] = [];
  for (const r of RETURNS) {
    const z = r.z;
    // The return: a lacquered hood with a brass grille, the rails, the end stop.
    b.box(lacquer, RACK.x0 + 0.1, 0.42, z, 0.36, 0.84, 0.52);
    b.box(brass, RACK.x0 + 0.29, 0.62, z, 0.01, 0.26, 0.4);
    b.add(new THREE.SphereGeometry(0.26, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.8, 0.9, 1), lacquer, M(RACK.x0 + 0.1, 0.84, z));
    b.box(neonPink, RACK.x0 + 0.29, 0.81, z, 0.012, 0.02, 0.44);
    for (const s of [-1, 1]) b.box(chrome, (RACK.x0 + RACK.x1) / 2 + 0.15, RACK.y - 0.11, z + s * 0.075, RACK.x1 - RACK.x0 - 0.1, 0.03, 0.02);
    b.box(lacquer, (RACK.x0 + RACK.x1) / 2 + 0.15, 0.24, z, RACK.x1 - RACK.x0 - 0.2, 0.48, 0.34);
    b.box(chrome, RACK.x1 + 0.02, RACK.y - 0.04, z, 0.04, 0.14, 0.22);
    // The air blower (a small grille box on the hood's side).
    b.box(chrome, RACK.x0 + 0.1, 0.92, z, 0.18, 0.04, 0.18);
    // A console per lane on a brass post: its screen faces the bowler (east).
    r.lanes.forEach((li, k) => {
      const cz = z + (k === 0 ? 1 : -1) * CONSOLE.off;
      b.box(brass, CONSOLE.x, CONSOLE.y / 2, cz, 0.04, CONSOLE.y, 0.04);
      b.box(lacquer, CONSOLE.x, CONSOLE.y + 0.02, cz, 0.06, 0.22, 0.34);
      const g = new THREE.PlaneGeometry(0.3, 0.19);
      const { x, y } = conCell(li);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let j = 0; j < uv.count; j++) uv.setXY(j, (x + uv.getX(j) * CON.cw) / conC.width, 1 - (y + (1 - uv.getY(j)) * CON.ch) / conC.height);
      const mesh = new THREE.Mesh(g, conMat);
      mesh.position.set(CONSOLE.x + 0.032, CONSOLE.y + 0.02, cz);
      mesh.rotation.set(0, Math.PI / 2, 0);
      mesh.rotateX(-0.35);
      mesh.name = `bowling-console-${li}`;
      lounge.add(mesh);
      conMeshes.push(mesh);
    });
    // Sofa: base, seat cushions, back, arms; tufted oxblood leather.
    b.box(lacquer, SOFA.x, 0.12, z, SOFA.d, 0.24, SOFA.len);
    b.box(leather, SOFA.x - 0.04, 0.34, z, SOFA.d - 0.08, 0.2, SOFA.len - 0.12);
    b.box(leather, SOFA.x + SOFA.d / 2 - 0.1, 0.66, z, 0.2, 0.62, SOFA.len);
    for (const s of [-1, 1]) b.box(leather, SOFA.x, 0.5, z + s * (SOFA.len / 2 - 0.06), SOFA.d, 0.36, 0.14);
    b.box(neonViolet, SOFA.x + SOFA.d / 2 - 0.0, 0.03, z, 0.01, 0.01, SOFA.len - 0.1);
    // Coffee table: marble on a brass drum.
    b.add(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 24), marbleTop, M(TABLE_X, 0.44, z));
    b.add(new THREE.CylinderGeometry(0.2, 0.26, 0.42, 16), brass, M(TABLE_X, 0.21, z));
  }
  // Between the lounge and the concourse: a low brass rail with gaps for the aisles.
  for (const [z0, z1] of [
    [R.z0 + 1.6, -2.6],
    [2.6, R.z1 - 1.6],
  ]) {
    b.box(brass, LOUNGE.x1 + 0.05, 0.9, (z0 + z1) / 2, 0.05, 0.05, z1 - z0);
    for (let z = z0; z <= z1 + 0.01; z += (z1 - z0) / 4) b.box(brass, LOUNGE.x1 + 0.05, 0.45, z, 0.04, 0.9, 0.04);
  }

  // --- The concourse: the bar, the shoe counter, high-tops ----------------------------------
  const bar = new THREE.Group();
  bar.name = 'bowling-bar';
  {
    const cx = (BAR.x0 + BAR.x1) / 2;
    const len = BAR.x1 - BAR.x0;
    // Counter: walnut front with a brass foot rail and a marble top; the back bar's lit shelves of bottles.
    b.box(walnut, cx, 0.53, BAR.z1 - 0.3, len, 1.06, 0.6);
    b.add(new THREE.BoxGeometry(len + 0.1, 0.05, 0.72), marbleTop, M(cx, 1.085, BAR.z1 - 0.32));
    b.box(brass, cx, 0.18, BAR.z1 + 0.06, len, 0.04, 0.04);
    b.box(neonGold, cx, 1.03, BAR.z1 + 0.012, len, 0.012, 0.012);
    b.box(lacquer, cx, 1.3, R.z0 + 0.25, len, 2.6, 0.4);
    for (const y of [1.2, 1.6, 2.0]) {
      b.box(glowWarm, cx, y - 0.02, R.z0 + 0.45, len - 0.2, 0.01, 0.06);
      b.box(chrome, cx, y, R.z0 + 0.48, len - 0.1, 0.02, 0.18);
    }
    const bottle = new THREE.CylinderGeometry(0.035, 0.04, 0.28, 8);
    const colors = [0x3a7a3a, 0x8a5a1a, 0xd8d0b8, 0x6a1a2a, 0x2a4a8a, 0xc89a3a];
    const bottles = colors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.85, emissive: c, emissiveIntensity: 0.45 }));
    let k = 0;
    for (const y of [1.2, 1.6, 2.0])
      for (let x = BAR.x0 + 0.3; x < BAR.x1 - 0.2; x += 0.19) {
        b.add(bottle, bottles[k++ % bottles.length], M(x, y + 0.155, R.z0 + 0.48));
      }
    // Beer taps.
    for (let i = 0; i < 4; i++) b.add(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 8), brass, M(BAR.x0 + 1.6 + i * 0.25, 1.26, BAR.z1 - 0.45));
    // Bar stools.
    for (let i = 0; i < 5; i++) {
      const x = BAR.x0 + 0.6 + i * 1.15;
      b.add(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 16), leather, M(x, 0.76, BAR.z1 + 0.42));
      b.add(new THREE.CylinderGeometry(0.03, 0.03, 0.72, 8), brass, M(x, 0.36, BAR.z1 + 0.42));
      b.add(new THREE.TorusGeometry(0.16, 0.012, 6, 16).rotateX(Math.PI / 2), brass, M(x, 0.28, BAR.z1 + 0.42));
    }
    // The bar's neon sign: the alley's name in script.
    signs.add(3.4, 0.9, 1024, 272, M(cx, 3.0, R.z0 + 0.04), (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.shadowColor = '#ff3fa8';
      g.shadowBlur = 30;
      g.fillStyle = '#ffd0ec';
      g.font = `italic 700 130px ${SERIF}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('Palazzo Lanes', w / 2, h * 0.44);
      g.shadowColor = '#2fe0d8';
      g.fillStyle = '#c8fffa';
      g.font = `600 44px ${SANS}`;
      g.fillText('C O C K T A I L S  ·  B O W L I N G', w / 2, h * 0.86);
    });
  }
  {
    // The shoe counter: a walnut desk, cubbies of shoes behind it (two-tone house shoes), its neon.
    const cx = (SHOES.x0 + SHOES.x1) / 2;
    const len = SHOES.x1 - SHOES.x0;
    b.box(walnut, cx, 0.55, SHOES.z0 + 0.3, len, 1.1, 0.6);
    b.add(new THREE.BoxGeometry(len + 0.1, 0.05, 0.7), marbleTop, M(cx, 1.12, SHOES.z0 + 0.3));
    b.box(lacquer, cx, 1.35, R.z1 - 0.22, len, 2.7, 0.36);
    const shoeL = new THREE.BoxGeometry(0.11, 0.08, 0.27);
    const shoeMats = [0x7a1420, 0x14286a, 0x2a2a2e].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, emissive: c, emissiveIntensity: 0.25 }));
    const cream = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.6, emissive: 0x3a3020, emissiveIntensity: 0.4 });
    let k = 0;
    for (let row = 0; row < 6; row++)
      for (let x = SHOES.x0 + 0.25; x < SHOES.x1 - 0.15; x += 0.3) {
        const y = 0.35 + row * 0.36;
        b.box(chrome, x, y - 0.045, R.z1 - 0.4, 0.28, 0.01, 0.3);
        b.add(shoeL, shoeMats[k % 3], M(x - 0.06, y, R.z1 - 0.4));
        b.add(shoeL, cream, M(x + 0.06, y, R.z1 - 0.4));
        k++;
      }
    signs.add(1.6, 0.42, 512, 134, M(cx, 2.95, R.z1 - 0.03, Math.PI), (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.shadowColor = '#2fe0d8';
      g.shadowBlur = 24;
      g.fillStyle = '#d8fffb';
      g.font = `600 80px ${SANS}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('S H O E S', w / 2, h / 2 + 4);
    });
    // A little counter sign: sizes, original pricing card.
    signs.add(0.42, 0.28, 168, 112, M(cx + 0.6, 1.29, SHOES.z0 + 0.05, Math.PI), (g, w, h) => {
      g.fillStyle = '#efe4c8';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#2a1a0a';
      g.font = `italic 600 22px ${SERIF}`;
      g.textAlign = 'center';
      g.fillText('House Shoes', w / 2, 34);
      g.font = `16px ${SERIF}`;
      g.fillText('sizes 4 – 15', w / 2, 62);
      g.fillText('complimentary', w / 2, 88);
    });
  }
  for (const [x, z] of HIGH_TOPS) {
    b.add(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 24), marbleTop, M(x, 1.06, z));
    b.add(new THREE.CylinderGeometry(0.04, 0.04, 1.04, 10), brass, M(x, 0.52, z));
    b.add(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 16), brass, M(x, 0.015, z));
    for (const a of [0, Math.PI]) {
      const sx = x + Math.cos(a) * 0.62,
        sz = z + Math.sin(a) * 0.62;
      b.add(new THREE.CylinderGeometry(0.18, 0.18, 0.07, 14), leather, M(sx, 0.76, sz));
      b.add(new THREE.CylinderGeometry(0.025, 0.025, 0.72, 8), brass, M(sx, 0.36, sz));
    }
  }
  // Pendant lamps over the high-tops and the bar (globes).
  const globe = new THREE.SphereGeometry(0.14, 14, 10);
  for (const [x, z] of HIGH_TOPS) {
    b.add(globe, glowWarm, M(x, 2.3, z));
    b.box(brass, x, (2.44 + R.h) / 2, z, 0.012, R.h - 2.44, 0.012);
  }
  for (let i = 0; i < 4; i++) {
    const x = BAR.x0 + 0.8 + i * 1.4;
    b.add(globe, glowWarm, M(x, 2.25, BAR.z1 - 0.3));
    b.box(brass, x, (2.39 + R.h) / 2, BAR.z1 - 0.3, 0.012, R.h - 2.39, 0.012);
  }

  // Foul lamps: a red pip on each lane's sensor post, lit by the game.
  const foulLamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), LANES);
  for (let i = 0; i < LANES; i++) {
    foulLamps.setMatrixAt(i, M(FOUL_X - 0.02, 0.12, laneZ(i) + (KICK_X - 0.03)));
    foulLamps.setColorAt(i, new THREE.Color(0x401010));
  }
  foulLamps.raycast = () => {};
  root.add(foulLamps);

  void big;
  void CONCOURSE;
  const area = b.build(root, 'bowling-static', { byColor: true });
  area.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).raycast = () => {}) : null));
  signs.build(root, 'bowling-signs');
  root.add(lounge, bar);
  const pinsAnchor = new THREE.Object3D();
  pinsAnchor.position.set(FOUL_X - HEAD_Z - 0.4, 0.4, 0);
  root.add(pinsAnchor);
  return {
    root,
    monitors: { canvas: monC, tex: monTex, cell: { w: MON.cw, h: MON.ch }, cellAt: monCell },
    consoles: { canvas: conC, tex: conTex, meshes: conMeshes, cell: { w: CON.cw, h: CON.ch }, cellAt: conCell },
    foulLamps,
    pinsAnchor,
    lounge,
    bar,
  };
}

/** Wall posters (original art): a vintage pin, a strike's burst, the lake. */
const POSTERS: ((g: CanvasRenderingContext2D, w: number, h: number) => void)[] = [
  (g, w, h) => {
    g.fillStyle = '#1a2a4a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8d8b0';
    g.beginPath();
    g.ellipse(w / 2, h * 0.52, 26, 70, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(w / 2, h * 0.3, 14, 22, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#c4141e';
    g.fillRect(w / 2 - 15, h * 0.37, 30, 5);
    g.fillStyle = '#f2d38a';
    g.font = `italic 700 26px ${SERIF}`;
    g.textAlign = 'center';
    g.fillText('Ten Pins', w / 2, 40);
    g.font = `14px ${SANS}`;
    g.fillText('PALAZZO LAGO', w / 2, h - 22);
  },
  (g, w, h) => {
    g.fillStyle = '#3a0a1e';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffc65a';
    for (let k = 0; k < 24; k++) {
      g.lineWidth = 2 + (k % 3);
      g.beginPath();
      g.moveTo(w / 2, h / 2);
      g.lineTo(w / 2 + Math.cos(k * 0.2618) * 200, h / 2 + Math.sin(k * 0.2618) * 200);
      g.stroke();
    }
    g.fillStyle = '#3a0a1e';
    g.beginPath();
    g.arc(w / 2, h / 2, 50, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffe6b0';
    g.font = `italic 800 30px ${SERIF}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('X', w / 2, h / 2);
    g.font = `600 16px ${SANS}`;
    g.fillText('NIGHT LEAGUE', w / 2, h - 30);
  },
  (g, w, h) => {
    const s = g.createLinearGradient(0, 0, 0, h);
    s.addColorStop(0, '#0a1230');
    s.addColorStop(0.6, '#4a2a5a');
    s.addColorStop(0.62, '#0c1a38');
    s.addColorStop(1, '#050a18');
    g.fillStyle = s;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffeacc';
    g.beginPath();
    g.arc(w * 0.66, h * 0.3, 16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#050a14';
    for (const x of [0.2, 0.32]) {
      g.beginPath();
      g.ellipse(w * x, h * 0.5, 9, 44, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#f2d38a';
    g.font = `italic 600 22px ${SERIF}`;
    g.textAlign = 'center';
    g.fillText('Lago di Notte', w / 2, h - 26);
  },
  (g, w, h) => {
    g.fillStyle = '#0e2a2a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#2fe0d8';
    g.beginPath();
    g.arc(w / 2, h * 0.45, 48, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0e2a2a';
    for (const [dx, dy] of [
      [-12, -16],
      [8, -18],
      [-2, 2],
    ]) {
      g.beginPath();
      g.arc(w / 2 + dx, h * 0.45 + dy, 7, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#f2f2e8';
    g.font = `600 18px ${SANS}`;
    g.textAlign = 'center';
    g.fillText('ROLL WITH IT', w / 2, h - 28);
  },
];
