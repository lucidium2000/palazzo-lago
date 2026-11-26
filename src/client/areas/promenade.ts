import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Quality } from '../quality';
import type { World } from '../world';
import { SEAT_R } from '../world';
import type { Crowd, Person } from '../people';
import { randomLook, staffLook } from '../people';
import { canvas, marble, radial, toTexture } from '../textures';
import { burgerGeometry, dicesetGeometry, gelatoGeometry, hatGeometry, noodlesGeometry, pizzaGeometry, plushGeometry } from '../promenadeprops';
import { Batch, M, plane, wallQuad, type Mats } from './kit';
import { chandelier } from './hotel';
import {
  ARCADE,
  ARCADE_SLOT_SPECS,
  ATRIUM,
  CHANGE_MACHINE,
  CONCOURSE,
  COUNTER,
  COUNTER_FRONT,
  COUNTERS,
  FRONT_Z,
  onPromenade,
  PLANTERS,
  PROM,
  PROM_CARS,
  PROMENADE_NODES,
  SHOP_H,
  STOOL_ANGLES,
  STOOL_R,
  STOOL_Y,
  STORE,
  STORE_FIX,
  TABLE_R,
  TABLE_TOP,
  TABLES,
  type ArcadeSlotSpec,
  type CounterSpec,
} from './promenadeplan';

export * from './promenadeplan';

/**
 * The Promenade: the resort's mezzanine of restaurants and shops, reached by
 * elevator (the "M" button). A marble concourse under a coffered ceiling with
 * skylights runs west from the elevators to a glass balcony over a garden
 * atrium; off it, a food court (four counters with their own cooks), the
 * Lago Luxe boutique and the Lago Arcade, whose bays are filled by the arcade
 * module (src/client/arcade/) when it's there.
 *
 * Built like the other areas: static geometry merged per material (kit.ts
 * Batch), every sign and menu board drawn into one canvas atlas (one draw),
 * the table food and the kitchens' displays one vertex-coloured mesh.
 */

// ---------------------------------------------------------------------------
// The arcade's bays (the interface with the arcade module)
// ---------------------------------------------------------------------------

/** A place in the arcade for a game: an upright cabinet's bay, or a floor spot for a bigger game. */
export interface ArcadeSlot {
  id: string;
  kind: 'cabinet' | 'floor';
  /** Centre of the footprint, on the floor (y = 0). */
  pos: THREE.Vector3;
  /** The way the game's front faces, as Object3D.rotation.y (local +z turns to (sin yaw, 0, cos yaw)). */
  yaw: number;
  /** [width across the front, depth front to back], metres. The world collider covers exactly this. */
  footprint: [number, number];
  /** What the bay was laid out for ('upright', 'basketball', 'air hockey', 'claw machine'). */
  hint: string;
}

export const ARCADE_SLOTS: ArcadeSlot[] = ARCADE_SLOT_SPECS.map((s: ArcadeSlotSpec) => ({ id: s.id, kind: s.kind, pos: new THREE.Vector3(s.x, 0, s.z), yaw: s.yaw, footprint: [...s.footprint] as [number, number], hint: s.hint }));

/** What the arcade gets to work with (filled in by main.ts once everything exists). */
export interface ArcadeDeps {
  scene: THREE.Scene;
  camera: THREE.Camera;
  quality: Quality;
  world: World;
  interaction: import('../interaction').Interaction;
  hands: import('../hands').Hands;
  player: import('../player').Player;
  sound: import('../audio').Sound;
  hud: import('../hud').Hud;
  bankroll: import('../../rules/bankroll').Bankroll;
  /** Your feet (cheap; the arcade can idle when you're elsewhere). */
  feet(): THREE.Vector3;
  /** You're on the Promenade (the arcade is drawn; otherwise it's hidden by zone culling). */
  here(): boolean;
  /** The room, when playing with friends (null alone). */
  session(): import('../net/session').Session | null;
  /** The arcade room's group (dim, neon): add the games here so zone culling hides them with the floor. */
  root: THREE.Object3D;
  /** The room's loose objects: the claw's won prizes become loose things (carried, thrown, synced). */
  loose: import('../loose').LooseObjects;
}

export type MountArcade = (scene: THREE.Scene, slots: readonly ArcadeSlot[], deps: ArcadeDeps) => { update(dt: number): void };

// The arcade module, if this build has it (src/client/arcade/index.ts exporting `mountArcade`).
const arcadeModules = import.meta.glob<{ mountArcade?: MountArcade }>('../arcade/index.ts', { eager: true });
export const mountArcade: MountArcade | undefined = Object.values(arcadeModules)[0]?.mountArcade;

// ---------------------------------------------------------------------------
// Walking, colliders, floors
// ---------------------------------------------------------------------------

export function registerPromenade(world: World) {
  const P = PROM;
  // The concourse and the food court (the kitchens behind the counters are staff only).
  world.addWalkable(P.x0 + 0.3, P.x1 - 0.3, COUNTER_FRONT, FRONT_Z - 0.3);
  // The boutique and the arcade, with their doorways.
  world.addWalkable(STORE.x0 + 0.3, STORE.x1 - 0.3, FRONT_Z + 0.3, STORE.z1 - 0.3);
  world.addWalkable(STORE.door.x0 + 0.12, STORE.door.x1 - 0.12, FRONT_Z - 0.6, FRONT_Z + 0.6);
  world.addWalkable(ARCADE.x0 + 0.3, ARCADE.x1 - 0.3, FRONT_Z + 0.3, ARCADE.z1 - 0.3);
  world.addWalkable(ARCADE.door.x0 + 0.12, ARCADE.door.x1 - 0.12, FRONT_Z - 0.6, FRONT_Z + 0.6);
  world.addSurface('marble', P.x0, P.x1, P.z0, FRONT_Z);
  world.addSurface('marble', STORE.x0, STORE.x1, STORE.z0, STORE.z1);
  world.addSurface('carpet', ARCADE.x0, ARCADE.x1, ARCADE.z0, ARCADE.z1);
  // Food counters (their fronts are the walk's edge, but guests mustn't clip them either).
  for (const c of COUNTERS) world.addBox(c.x, COUNTER.z, COUNTER.width, COUNTER.depth, 0, 'counter');
  // Food court tables, and the stools round them (walk onto one and you sit, facing the table).
  for (const [x, z] of TABLES) {
    world.addCircle(x, z, TABLE_R + 0.04, 'table');
    for (const a of STOOL_ANGLES) {
      const sx = x + Math.cos(a) * STOOL_R,
        sz = z + Math.sin(a) * STOOL_R;
      world.addSeat(sx, sz, SEAT_R, STOOL_Y, Math.atan2(x - sx, z - sz), 'stool');
    }
  }
  for (const [x, z] of PLANTERS) world.addCircle(x, z, 0.5, 'planter');
  for (const [x, z] of COLUMNS) world.addBox(x, z, 0.8, 0.8, 0, 'column');
  // The boutique: counter, display tables, wall shelving, mannequins.
  const c = STORE_FIX.counter;
  world.addBox(c.x, c.z, c.w, c.d, 0, 'counter');
  for (const t of STORE_FIX.tables) world.addBox(t.x, t.z, t.w, t.d, 0, 'table');
  for (const s of STORE_FIX.shelves) world.addBox(s.x, s.z, s.w, s.d + 0.06, s.yaw, 'shelf');
  for (const mq of STORE_FIX.mannequins) world.addCircle(mq.x, mq.z, 0.3, 'mannequin');
  // The arcade's bays (the games themselves come from the arcade module) and the change machine.
  for (const s of ARCADE_SLOTS) world.addBox(s.pos.x, s.pos.z, s.footprint[0], s.footprint[1], s.yaw, `arcade ${s.kind}`);
  world.addBox(CHANGE_MACHINE.x, CHANGE_MACHINE.z, CHANGE_MACHINE.w, CHANGE_MACHINE.d, CHANGE_MACHINE.yaw, 'change machine');
}

/** Columns along the food court's edge. */
const COLUMNS: [number, number][] = [
  [-609.75, -4.6],
  [-618.75, -4.6],
  [-627.75, -4.6],
];

// ---------------------------------------------------------------------------
// Signs: one canvas atlas, one draw for every sign and menu board
// ---------------------------------------------------------------------------

class SignAtlas {
  private list: { w: number; h: number; pw: number; ph: number; draw: (g: CanvasRenderingContext2D, w: number, h: number) => void; m: THREE.Matrix4 }[] = [];

  /** A sign w × h metres, drawn at pw × ph pixels, placed by `m` (the plane faces +z before it). */
  add(w: number, h: number, pw: number, ph: number, m: THREE.Matrix4, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
    this.list.push({ w, h, pw, ph, draw, m });
  }

  build(parent: THREE.Object3D, name: string) {
    const W = 2048;
    let x = 0,
      y = 0,
      row = 0;
    const at: [number, number][] = [];
    for (const s of this.list) {
      if (x + s.pw > W) {
        x = 0;
        y += row;
        row = 0;
      }
      at.push([x, y]);
      x += s.pw;
      row = Math.max(row, s.ph);
    }
    const H = Math.max(256, 2 ** Math.ceil(Math.log2(y + row)));
    const [c, g] = canvas(W, H);
    const geos: THREE.BufferGeometry[] = [];
    this.list.forEach((s, i) => {
      const [px, py] = at[i];
      g.save();
      g.translate(px, py);
      g.beginPath();
      g.rect(0, 0, s.pw, s.ph);
      g.clip();
      s.draw(g, s.pw, s.ph);
      g.restore();
      const geo = new THREE.PlaneGeometry(s.w, s.h);
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, (px + uv.getX(k) * s.pw) / W, 1 - (py + (1 - uv.getY(k)) * s.ph) / H);
      geo.applyMatrix4(s.m);
      geos.push(geo);
    });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mesh = new THREE.Mesh(mergeGeometries(geos)!, new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
    mesh.name = name;
    mesh.raycast = () => {};
    parent.add(mesh);
    return mesh;
  }
}

/** A matrix placing a +z-facing plane at (x, y, z) turned by ry. */
const at = (x: number, y: number, z: number, ry = 0) => M(x, y, z, ry);

const SERIF = 'Georgia, "Times New Roman", serif';

/** Gold serif on a dark panel with a gilt edge (the casino's sign style). */
function goldSign(text: string, sub?: string, opts: { bg?: string; px?: number; color?: string; italic?: boolean } = {}) {
  return (g: CanvasRenderingContext2D, w: number, h: number) => {
    g.fillStyle = opts.bg ?? 'rgba(18,11,8,0.92)';
    roundRect(g, 4, 4, w - 8, h - 8, Math.min(24, h * 0.12));
    g.fill();
    g.strokeStyle = '#d8b25a';
    g.lineWidth = Math.max(3, h * 0.025);
    g.stroke();
    g.fillStyle = opts.color ?? '#f3dc9a';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = 'rgba(255,200,90,0.55)';
    g.shadowBlur = h * 0.08;
    let px = opts.px ?? h * (sub ? 0.46 : 0.6);
    const font = () => `${opts.italic === false ? '' : 'italic '}600 ${px}px ${SERIF}`;
    g.font = font();
    while (g.measureText(text).width > w * 0.9 && px > 10) {
      px -= 2;
      g.font = font();
    }
    g.fillText(text, w / 2, sub ? h * 0.42 : h * 0.53);
    if (sub) {
      g.shadowBlur = 0;
      let sp = h * 0.16;
      g.font = `${sp}px ${SERIF}`;
      while (g.measureText(sub).width > w * 0.9 && sp > 8) g.font = `${--sp}px ${SERIF}`;
      g.fillStyle = '#e9dcc0';
      g.fillText(sub, w / 2, h * 0.78);
    }
  };
}

/** Neon tube lettering on nothing (the wall shows through). */
function neonSign(text: string, color: string, sub?: string, subColor?: string) {
  return (g: CanvasRenderingContext2D, w: number, h: number) => {
    g.clearRect(0, 0, w, h);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let px = h * (sub ? 0.5 : 0.66);
    g.font = `bold ${px}px "Trebuchet MS", Verdana, sans-serif`;
    while (g.measureText(text).width > w * 0.92 && px > 10) g.font = `bold ${(px -= 2)}px "Trebuchet MS", Verdana, sans-serif`;
    for (const [blur, alpha, lw] of [
      [h * 0.18, 0.55, h * 0.05],
      [h * 0.06, 0.9, h * 0.03],
    ] as const) {
      g.shadowColor = color;
      g.shadowBlur = blur;
      g.globalAlpha = alpha;
      g.strokeStyle = color;
      g.lineWidth = lw;
      g.strokeText(text, w / 2, sub ? h * 0.38 : h / 2);
    }
    g.globalAlpha = 1;
    g.shadowBlur = h * 0.03;
    g.fillStyle = '#ffffff';
    g.fillText(text, w / 2, sub ? h * 0.38 : h / 2);
    if (sub) {
      g.font = `bold ${h * 0.2}px "Trebuchet MS", Verdana, sans-serif`;
      g.shadowColor = subColor ?? color;
      g.shadowBlur = h * 0.08;
      g.fillStyle = subColor ?? color;
      g.fillText(sub, w / 2, h * 0.8);
    }
    g.shadowBlur = 0;
  };
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** A counter's menu board: its brand, then each item and its price. */
function menuBoard(c: CounterSpec) {
  return (g: CanvasRenderingContext2D, w: number, h: number) => {
    const [bg, accent] = c.colors;
    g.fillStyle = '#120c08';
    g.fillRect(0, 0, w, h);
    g.fillStyle = bg;
    g.fillRect(8, 8, w - 16, h - 16);
    g.strokeStyle = '#d8b25a';
    g.lineWidth = 6;
    g.strokeRect(14, 14, w - 28, h - 28);
    const light = bg === '#f4e8d8';
    g.fillStyle = light ? '#3a2a1a' : '#f6ead0';
    g.textAlign = 'center';
    g.font = `italic 600 ${h * 0.15}px ${SERIF}`;
    g.fillText('Menu', w / 2, h * 0.2);
    g.fillStyle = accent;
    g.fillRect(w * 0.2, h * 0.27, w * 0.6, 3);
    c.items.forEach((it, i) => {
      const y = h * (0.45 + i * 0.2);
      g.textAlign = 'left';
      g.fillStyle = light ? '#2a1a10' : '#fff4dc';
      g.font = `${h * 0.1}px ${SERIF}`;
      g.fillText(it.name, w * 0.08, y);
      g.textAlign = 'right';
      g.fillStyle = accent;
      g.font = `bold ${h * 0.11}px ${SERIF}`;
      g.fillText(`$${it.price}`, w * 0.92, y);
    });
    g.textAlign = 'center';
    g.fillStyle = light ? '#6a5a4a' : '#cbb991';
    g.font = `italic ${h * 0.075}px ${SERIF}`;
    g.fillText('Order at the counter · pay with chips', w / 2, h * 0.9);
  };
}

/** A brand's fascia over its counter. */
function brandSign(c: CounterSpec) {
  return (g: CanvasRenderingContext2D, w: number, h: number) => {
    const [bg, accent] = c.colors;
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#d8b25a';
    g.lineWidth = 6;
    g.strokeRect(5, 5, w - 10, h - 10);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = accent;
    g.shadowColor = accent;
    g.shadowBlur = 10;
    let px = h * 0.5;
    g.font = `italic 700 ${px}px ${SERIF}`;
    while (g.measureText(c.brand).width > w * 0.9) g.font = `italic 700 ${(px -= 2)}px ${SERIF}`;
    g.fillText(c.brand, w / 2, h * 0.42);
    g.shadowBlur = 0;
    g.fillStyle = bg === '#f4e8d8' ? '#4a3a2a' : '#efe2c4';
    g.font = `${h * 0.18}px ${SERIF}`;
    g.fillText(c.tagline.toUpperCase(), w / 2, h * 0.8);
  };
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

/** Cream marble tiles with dark diamond keys and gilt joints (one tile per texture repeat). */
function tileTexture(size: number): THREE.CanvasTexture {
  const [c, g] = canvas(size);
  g.drawImage(marble(size, 'cream', 33), 0, 0);
  const s = size;
  // Joints.
  g.strokeStyle = 'rgba(120,90,50,0.55)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, s, s);
  // Dark diamond keys at the corners (they meet as a diamond where four tiles meet).
  const dark = marble(Math.round(s / 2), 'dark', 8);
  const k = s * 0.13;
  for (const [x, y] of [
    [0, 0],
    [s, 0],
    [0, s],
    [s, s],
  ]) {
    g.save();
    g.beginPath();
    g.moveTo(x - k, y);
    g.lineTo(x, y - k);
    g.lineTo(x + k, y);
    g.lineTo(x, y + k);
    g.closePath();
    g.clip();
    g.drawImage(dark, x - k, y - k, k * 2, k * 2);
    g.restore();
    g.strokeStyle = '#c9a050';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x - k, y);
    g.lineTo(x, y - k);
    g.lineTo(x + k, y);
    g.lineTo(x, y + k);
    g.closePath();
    g.stroke();
  }
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** The arcade's carpet: neon squiggles, triangles and rings on midnight blue. */
function arcadeCarpet(size: number): THREE.CanvasTexture {
  const [c, g] = canvas(size);
  g.fillStyle = '#0c0820';
  g.fillRect(0, 0, size, size);
  let s = 9;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const cols = ['#ff2bd6', '#29e7ff', '#ffe03a', '#7a5cff', '#3aff8a'];
  g.lineWidth = size / 90;
  g.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const x = rnd() * size,
      y = rnd() * size,
      r = size * (0.02 + rnd() * 0.03);
    g.strokeStyle = g.fillStyle = cols[i % cols.length];
    const kind = i % 3;
    g.save();
    g.translate(x, y);
    g.rotate(rnd() * 6.28);
    // Drawn three times over the edges so it tiles.
    for (const [ox, oy] of [
      [0, 0],
      [size, 0],
      [-size, 0],
    ]) {
      g.save();
      g.translate(ox, oy);
      g.beginPath();
      if (kind === 0) {
        for (let k = 0; k <= 12; k++) g.lineTo(-r * 2 + (k / 12) * r * 4, Math.sin(k * 1.3) * r * 0.5);
        g.stroke();
      } else if (kind === 1) {
        g.moveTo(0, -r);
        g.lineTo(r * 0.9, r * 0.6);
        g.lineTo(-r * 0.9, r * 0.6);
        g.closePath();
        g.stroke();
      } else {
        g.arc(0, 0, r * 0.6, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
    }
    g.restore();
  }
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A skylight: night sky through a gilt grid of mullions, a glow round the frame. */
function skylightTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512);
  const grd = g.createLinearGradient(0, 0, 512, 512);
  grd.addColorStop(0, '#0a0f2a');
  grd.addColorStop(1, '#1a1638');
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 512);
  let s = 4;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(255,255,255,${0.3 + rnd() * 0.6})`;
    g.fillRect(rnd() * 512, rnd() * 512, rnd() < 0.15 ? 2 : 1, rnd() < 0.15 ? 2 : 1);
  }
  g.strokeStyle = '#6a5228';
  g.lineWidth = 6;
  for (let k = 1; k < 4; k++) {
    g.beginPath();
    g.moveTo((k * 512) / 4, 0);
    g.lineTo((k * 512) / 4, 512);
    g.moveTo(0, (k * 512) / 4);
    g.lineTo(512, (k * 512) / 4);
    g.stroke();
  }
  const edge = g.createRadialGradient(256, 256, 160, 256, 256, 380);
  edge.addColorStop(0, 'rgba(255,200,120,0)');
  edge.addColorStop(1, 'rgba(255,200,120,0.35)');
  g.fillStyle = edge;
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = '#c9a050';
  g.lineWidth = 14;
  g.strokeRect(7, 7, 498, 498);
  return toTexture(c);
}

/** White kitchen tiles. */
function kitchenTiles(): THREE.CanvasTexture {
  const [c, g] = canvas(256);
  g.fillStyle = '#b8b0a4';
  g.fillRect(0, 0, 256, 256);
  for (let r = 0; r < 8; r++)
    for (let k = -1; k < 5; k++) {
      const x = k * 64 + (r % 2) * 32;
      g.fillStyle = r % 2 ? '#f2eee6' : '#ece6dc';
      g.fillRect(x + 2, r * 32 + 2, 60, 28);
    }
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** A wall along x (at z) or z (at x) with openings [from, to, bottom, top]; the quad faces `ry`. */
function wallRun(b: Batch, mat: THREE.Material, axis: 'x' | 'z', at: number, from: number, to: number, ry: number, y0: number, y1: number, holes: [number, number, number, number][] = []) {
  const seg = (a: number, c: number, lo: number, hi: number) => {
    if (c - a < 0.01 || hi - lo < 0.01) return;
    const mid = (a + c) / 2;
    b.add(wallQuad(c - a, hi - lo), mat, axis === 'x' ? M(mid, (lo + hi) / 2, at, ry) : M(at, (lo + hi) / 2, mid, ry));
  };
  let cur = from;
  for (const [a, c, lo, hi] of [...holes].sort((p, q) => p[0] - q[0])) {
    seg(cur, a, y0, y1);
    seg(a, c, hi, y1);
    seg(a, c, y0, lo);
    cur = c;
  }
  seg(cur, to, y0, y1);
}

/** A potted palm: a stone urn, a curving trunk and a crown of fronds. */
function palm(b: Batch, urn: THREE.Material, trunkMat: THREE.Material, frondMat: THREE.Material, x: number, z: number, h: number, seed: number, y = 0, pot = true) {
  if (pot) {
    b.add(new THREE.LatheGeometry([[0, 0], [0.32, 0], [0.38, 0.12], [0.3, 0.3], [0.42, 0.7], [0.46, 0.78], [0.4, 0.8], [0, 0.8]].map(([r, yy]) => new THREE.Vector2(r, yy)), 16), urn, M(x, y, z));
  }
  const base = y + (pot ? 0.78 : 0);
  const pts: THREE.Vector3[] = [];
  const lean = 0.25 + (seed % 3) * 0.1;
  const dir = seed * 2.1;
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    pts.push(new THREE.Vector3(Math.cos(dir) * Math.sin(t * 1.2) * lean * h * 0.15, t * h, Math.sin(dir) * Math.sin(t * 1.2) * lean * h * 0.15));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  b.add(new THREE.TubeGeometry(curve, 8, 0.06 + h * 0.012, 6, false), trunkMat, M(x, base, z));
  const top = curve.getPoint(1);
  const n = 8;
  for (let k = 0; k < n; k++) {
    const len = h * 0.38;
    const g = new THREE.PlaneGeometry(0.34, len, 1, 4);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const yy = pos.getY(i) + len / 2;
      pos.setY(i, yy);
      pos.setZ(i, -((yy / len) ** 2) * len * 0.45);
      pos.setX(i, pos.getX(i) * (1 - (yy / len) * 0.8));
    }
    g.rotateX(-Math.PI / 2 + 0.6);
    g.rotateY((k / n) * Math.PI * 2 + seed);
    g.computeVertexNormals();
    b.add(g, frondMat, M(x + top.x, base + top.y, z + top.z));
  }
}

/** One vertex-coloured mesh: food on the tables and in the kitchens' displays. */
class ColorBatch {
  private parts: THREE.BufferGeometry[] = [];
  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, color?: number) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()) as THREE.BufferGeometry;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    if (color !== undefined || !g.attributes.color) {
      const c = new THREE.Color(color ?? 0xffffff);
      const a = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < a.length; i += 3) a.set([c.r, c.g, c.b], i);
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    }
    g.applyMatrix4(m);
    this.parts.push(g);
  }
  build(parent: THREE.Object3D, name: string) {
    if (!this.parts.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(this.parts)!, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: 0x201008, emissiveIntensity: 0.25 }));
    mesh.name = name;
    mesh.raycast = () => {};
    parent.add(mesh);
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export interface PromenadeArea {
  root: THREE.Group;
  /** The arcade room's group (dim, neon): the arcade module adds its games here. */
  arcadeRoom: THREE.Group;
  /** Placeholder cabinets in the bays (when there's no arcade module). */
  placeholders: THREE.Group | null;
  /** Each counter's ordering spot (its menu panel goes here, standing on the counter). */
  menuSpots: { counter: CounterSpec; pos: THREE.Vector3; yaw: number }[];
  /** The boutique's register (an interactable goes on it). */
  register: THREE.Vector3;
  /** Where the eaters at the tables sit (food is set in front of them). */
  eaters: { pos: THREE.Vector3; yaw: number }[];
  update(t: number): void;
}

/** The seats taken by guests having dinner (deterministic, so the food on the tables matches them). */
function eaterSeats(n: number): { pos: THREE.Vector3; yaw: number; table: [number, number] }[] {
  const out: { pos: THREE.Vector3; yaw: number; table: [number, number] }[] = [];
  // Tables in an order that spreads them out, two diners facing each other at most.
  const order = [1, 8, 3, 10, 5, 0, 7, 2, 9, 4, 11, 6];
  for (const ti of order) {
    const [x, z] = TABLES[ti];
    for (const k of ti % 2 ? [0, 2] : [1, 3]) {
      if (out.length >= n) return out;
      const a = STOOL_ANGLES[k];
      const sx = x + Math.cos(a) * STOOL_R,
        sz = z + Math.sin(a) * STOOL_R;
      out.push({ pos: new THREE.Vector3(sx, 0, sz), yaw: Math.atan2(x - sx, z - sz), table: [x, z] });
      if (ti % 3 === 0) break;
    }
  }
  return out;
}

const EATERS_MAX = 10;

export function buildPromenade(scene: THREE.Scene, q: Quality, m: Mats, opts: { placeholders: boolean }): PromenadeArea {
  const P = PROM;
  const root = new THREE.Group();
  root.name = 'promenade';
  scene.add(root);
  const b = new Batch();
  const signs = new SignAtlas();
  const food = new ColorBatch();
  const cx = (P.x0 + P.x1) / 2;

  // --- Materials (shared where the casino's kit has one) -------------------------------
  const floorTex = tileTexture(q.texSize >= 2048 ? 512 : 256);
  const floor = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.22, metalness: 0.05, envMapIntensity: 1.15 });
  const sky = new THREE.MeshBasicMaterial({ map: skylightTexture() });
  const glass = new THREE.MeshStandardMaterial({ color: 0xcfe4ec, transparent: true, opacity: 0.18, roughness: 0.03, metalness: 0.6, envMapIntensity: 1.8, depthWrite: false, side: THREE.DoubleSide });
  const trunk = new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.9, emissive: 0x1a120a, emissiveIntensity: 0.4 });
  const frond = new THREE.MeshStandardMaterial({ color: 0x3a7a3a, roughness: 0.7, side: THREE.DoubleSide, emissive: 0x0a2a10, emissiveIntensity: 0.45 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.9, roughness: 0.35, envMapIntensity: 1.2 });
  const tiles = new THREE.MeshStandardMaterial({ map: kitchenTiles(), roughness: 0.3, emissive: 0x2a2824, emissiveIntensity: 0.35 });
  (tiles.map as THREE.Texture).repeat.set(1, 1);
  const fire = m.glow(0xff7a2a, 1.6);
  const pools = new THREE.MeshBasicMaterial({ map: toTexture(radial(128, 'rgba(255,205,140,0.42)', 'rgba(255,170,90,0)')), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const pool = (x: number, z: number, r: number, y = 0.02) => b.add(new THREE.PlaneGeometry(r, r).rotateX(-Math.PI / 2), pools, M(x, y, z));
  const halo = (x: number, y: number, z: number, s: number, ry: number) => b.add(new THREE.PlaneGeometry(s, s), m.halo, M(x, y, z, ry));

  // --- Floor, ceiling, walls of the great hall (concourse + food court) ---------------------
  const hallD = FRONT_Z - P.z0;
  const hallZ = (P.z0 + FRONT_Z) / 2;
  b.add(plane(P.x1 - P.x0, hallD, 1 / 1.6), floor, M(cx, 0.002, hallZ));
  // Dark marble bands framing the concourse, gilt lines inside them, a rosette in the middle.
  for (const z of [CONCOURSE.z0 + 0.35, CONCOURSE.z1 - 0.35]) {
    b.box(m.darkMarble, cx, 0.006, z, P.x1 - P.x0 - 0.6, 0.004, 0.5);
    b.box(m.gold, cx, 0.009, z + (z < 0 ? 0.32 : -0.32), P.x1 - P.x0 - 0.6, 0.004, 0.04);
  }
  {
    const [c, g] = canvas(1024);
    g.translate(512, 512);
    const rings = ['#2a1a14', '#e8dcc4', '#c9a050', '#6a1a1a', '#e8dcc4'];
    rings.forEach((col, i) => {
      g.fillStyle = col;
      g.beginPath();
      g.arc(0, 0, 512 - i * 70, 0, Math.PI * 2);
      g.fill();
    });
    for (let k = 0; k < 16; k++) {
      g.rotate(Math.PI / 8);
      g.fillStyle = k % 2 ? '#c9a050' : '#2a1a14';
      g.beginPath();
      g.moveTo(0, -300);
      g.lineTo(40, 0);
      g.lineTo(0, 60);
      g.lineTo(-40, 0);
      g.closePath();
      g.fill();
    }
    g.fillStyle = '#c9a050';
    g.beginPath();
    g.arc(0, 0, 60, 0, Math.PI * 2);
    g.fill();
    const rosette = new THREE.Mesh(new THREE.CircleGeometry(2.4, 48), new THREE.MeshStandardMaterial({ map: toTexture(c), roughness: 0.25, envMapIntensity: 1.1, polygonOffset: true, polygonOffsetFactor: -2 }));
    rosette.rotation.x = -Math.PI / 2;
    rosette.position.set(-618, 0.008, 0);
    rosette.raycast = () => {};
    root.add(rosette);
  }
  // Ceiling: a coffered field, gilt-edged beams, three skylights over the concourse.
  b.add(plane(P.x1 - P.x0, hallD, 0.5, false), m.cream, M(cx, P.h, hallZ));
  for (let x = P.x0 + 3; x < P.x1; x += 3) {
    b.box(m.cream, x, P.h - 0.2, hallZ, 0.3, 0.4, hallD);
    b.box(m.gold, x, P.h - 0.41, hallZ, 0.32, 0.02, hallD);
  }
  for (let z = P.z0 + 3; z < FRONT_Z; z += 3) {
    b.box(m.cream, cx, P.h - 0.2, z, P.x1 - P.x0, 0.4, 0.3);
    b.box(m.gold, cx, P.h - 0.41, z, P.x1 - P.x0, 0.02, 0.32);
  }
  for (const x of [-606, -618, -630]) {
    b.add(new THREE.PlaneGeometry(5.6, 5.6).rotateX(Math.PI / 2), sky, M(x, P.h - 0.45, 0));
    b.box(m.gold, x, P.h - 0.47, -2.85, 5.9, 0.08, 0.15);
    b.box(m.gold, x, P.h - 0.47, 2.85, 5.9, 0.08, 0.15);
    b.box(m.gold, x - 2.85, P.h - 0.47, 0, 0.15, 0.08, 5.9);
    b.box(m.gold, x + 2.85, P.h - 0.47, 0, 0.15, 0.08, 5.9);
    // Moonlight from above, softly on the floor.
    b.add(new THREE.PlaneGeometry(5, 5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1a2240, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }), M(x, 0.015, 0));
  }
  // Glowing cove all round the hall's top.
  b.box(m.glowWarm, cx, P.h - 0.62, P.z0 + 0.25, P.x1 - P.x0 - 0.5, 0.03, 0.05);
  b.box(m.glowWarm, cx, P.h - 0.62, FRONT_Z - 0.25, P.x1 - P.x0 - 0.5, 0.03, 0.05);
  b.box(m.cream, cx, P.h - 0.55, P.z0 + 0.15, P.x1 - P.x0, 0.12, 0.3);
  b.box(m.cream, cx, P.h - 0.55, FRONT_Z - 0.15, P.x1 - P.x0, 0.12, 0.3);
  // Chandeliers over the food court and the concourse.
  for (const x of [-611.5, -623.5]) chandelier(b, root, m, x, P.h - 0.6, -7.7, 1.15);
  chandelier(b, root, m, -618, P.h - 1.0, 0, 1.4);

  // North wall (behind the kitchens), east wall (the elevators), west wall (either side of the balcony).
  wallRun(b, m.marbleWall, 'x', P.z0, P.x0, P.x1, 0, 0, P.h);
  wallRun(
    b,
    m.marbleWall,
    'z',
    P.x1,
    P.z0,
    FRONT_Z,
    -Math.PI / 2,
    0,
    P.h,
    PROM_CARS.zs.map((z) => [z - 0.83, z + 0.83, 0, 2.6] as [number, number, number, number]),
  );
  wallRun(b, m.marbleWall, 'z', P.x0, P.z0, ATRIUM.rail.z0, Math.PI / 2, 0, P.h);
  // Wainscot and a gilt rail along the elevator wall (round the doors).
  for (const [z0, z1] of [
    [CONCOURSE.z0, PROM_CARS.zs[0] - 0.83],
    [PROM_CARS.zs[0] + 0.83, PROM_CARS.zs[1] - 0.83],
    [PROM_CARS.zs[1] + 0.83, CONCOURSE.z1],
  ]) {
    b.box(m.walnut, P.x1 - 0.05, 0.55, (z0 + z1) / 2, 0.1, 1.1, z1 - z0);
    b.box(m.gold, P.x1 - 0.11, 1.12, (z0 + z1) / 2, 0.05, 0.05, z1 - z0);
  }
  // Pilasters with gilt capitals along the walls.
  for (let z = P.z0 + 1.5; z < CONCOURSE.z0; z += 3) {
    b.box(m.marble, P.x1 - 0.1, P.h / 2, z, 0.2, P.h - 0.6, 0.5);
    b.box(m.gold, P.x1 - 0.12, P.h - 0.85, z, 0.25, 0.25, 0.62);
  }
  for (const z of [CONCOURSE.z0, CONCOURSE.z1]) {
    b.box(m.marble, P.x1 - 0.12, P.h / 2, z, 0.25, P.h, 0.6);
    b.box(m.gold, P.x1 - 0.14, P.h - 0.85, z, 0.3, 0.25, 0.72);
  }
  // Freestanding columns between the food court and the concourse.
  for (const [x, z] of COLUMNS) {
    b.box(m.darkMarble, x, 0.15, z, 0.9, 0.3, 0.9);
    b.add(new THREE.CylinderGeometry(0.3, 0.32, P.h - 0.9, 20), m.marble, M(x, 0.3 + (P.h - 0.9) / 2, z));
    b.box(m.gold, x, P.h - 0.5, z, 0.85, 0.3, 0.85);
    b.add(new THREE.TorusGeometry(0.33, 0.03, 6, 20).rotateX(Math.PI / 2), m.gold, M(x, 1.1, z));
    pool(x, z, 2.2);
  }

  // The elevator foyer: the floor's name over the doors.
  signs.add(3.0, 0.85, 1024, 290, at(P.x1 - 0.1, 3.55, 0, -Math.PI / 2), goldSign('The Promenade', 'DINING  ·  BOUTIQUE  ·  ARCADE'));
  b.box(m.gold, P.x1 - 0.06, 3.55, 0, 0.06, 0.95, 3.1);
  // Hanging signs over the food court's edge (both faces), on gilt rods from the ceiling.
  for (const x of [-606, -622]) {
    b.box(m.darkMarble, x, 4.4, CONCOURSE.z0 + 0.1, 3.3, 0.62, 0.06);
    signs.add(3.1, 0.52, 1024, 172, at(x, 4.4, CONCOURSE.z0 + 0.135, 0), goldSign('Food Court', 'PIZZA  ·  BURGERS  ·  NOODLES  ·  GELATO'));
    signs.add(3.1, 0.52, 1024, 172, at(x, 4.4, CONCOURSE.z0 + 0.065, Math.PI), goldSign('Food Court', 'PIZZA  ·  BURGERS  ·  NOODLES  ·  GELATO'));
    for (const s of [-1, 1]) b.box(m.gold, x + s * 1.4, (4.71 + P.h) / 2, CONCOURSE.z0 + 0.1, 0.03, P.h - 4.71, 0.03);
  }

  // --- Food court ---------------------------------------------------------------------
  const menuSpots: PromenadeArea['menuSpots'] = [];
  const pizza = pizzaGeometry(),
    burger = burgerGeometry(),
    noodles = noodlesGeometry(),
    gelato = gelatoGeometry();
  const plate = new THREE.CylinderGeometry(0.12, 0.1, 0.012, 20).translate(0, 0.006, 0);
  for (const c of COUNTERS) {
    const x = c.x,
      z = COUNTER.z;
    // The counter: walnut front, marble top, a gilt kick, a glass sneeze guard.
    b.box(m.walnut, x, COUNTER.top / 2, z, COUNTER.width, COUNTER.top - 0.03, COUNTER.depth);
    b.box(m.darkMarble, x, COUNTER.top - 0.015, z, COUNTER.width + 0.1, 0.04, COUNTER.depth + 0.06);
    b.box(m.gold, x, 0.08, z + COUNTER.depth / 2 + 0.005, COUNTER.width, 0.1, 0.02);
    b.box(m.gold, x, 0.75, z + COUNTER.depth / 2 + 0.005, COUNTER.width, 0.03, 0.02);
    b.box(glass, x - 0.4, COUNTER.top + 0.3, z - 0.12, 2.9, 0.42, 0.012);
    for (const s of [-1, 1]) b.box(m.gold, x - 0.4 + s * 1.45, COUNTER.top + 0.25, z - 0.12, 0.025, 0.5, 0.025);
    // Kitchen: tiled back wall, a steel back counter, the canopy over it all with the brand.
    b.add(wallQuad(5.6, 2.9), tiles, M(x, 1.45, P.z0 + 0.03));
    b.box(steel, x, 0.47, P.z0 + 0.55, 5.4, 0.94, 0.8);
    b.box(m.darkMarble, x, 2.95, -12.6, 5.9, 0.12, 2.9);
    b.box(m.walnut, x, 3.3, -11.2, 5.9, 0.7, 0.25);
    signs.add(5.0, 0.62, 1024, 128, at(x, 3.3, -11.06), brandSign(c));
    signs.add(2.4, 1.05, 640, 280, at(x, 2.15, P.z0 + 0.06), menuBoard(c));
    for (const s of [-1, 1]) b.box(m.marbleWall, x + s * 2.95, 1.5, -12.6, 0.15, 3.0, 2.9);
    // Warm light spilling onto the counter and the floor in front of it.
    b.box(m.glowWarm, x, 2.88, -11.45, 4.6, 0.02, 0.05);
    pool(x, -10.4, 4.2);
    pool(x, -11.4, 3.2, COUNTER.top + 0.002);
    // The ordering menu stands at the right end of the counter (served food goes on the left).
    menuSpots.push({ counter: c, pos: new THREE.Vector3(x + 1.65, COUNTER.top + 0.26, z - 0.02), yaw: 0 });
    // Each kitchen's own look.
    if (c.id === 'pizza') {
      // A domed wood oven with fire in its mouth, pies on the pass.
      b.add(new THREE.SphereGeometry(0.85, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), m.stone, M(x + 1.2, 1.0, P.z0 + 0.9));
      b.box(m.stone, x + 1.2, 0.5, P.z0 + 0.9, 1.9, 1.0, 1.6);
      b.add(new THREE.CircleGeometry(0.32, 16, 0, Math.PI), fire, M(x + 1.2, 1.0, P.z0 + 1.76));
      halo(x + 1.2, 1.15, P.z0 + 1.8, 1.4, 0);
      for (let k = 0; k < 3; k++) {
        food.add(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 20), M(x - 1.6 + k * 0.45, COUNTER.top + 0.01, z - 0.2), 0xe2a84a);
        food.add(new THREE.CylinderGeometry(0.15, 0.15, 0.006, 20), M(x - 1.6 + k * 0.45, COUNTER.top + 0.023, z - 0.2), k === 1 ? 0xf2d27a : 0xf2b63a);
        for (let p = 0; p < 7; p++) food.add(new THREE.CylinderGeometry(0.022, 0.022, 0.004, 8), M(x - 1.6 + k * 0.45 + Math.cos(p * 0.9) * 0.09 * (p % 2 ? 1 : 0.5), COUNTER.top + 0.028, z - 0.2 + Math.sin(p * 0.9) * 0.09 * (p % 2 ? 1 : 0.5)), k === 1 ? 0x3a8a2a : 0xa8241a);
      }
    } else if (c.id === 'burger') {
      // A flat-top grill with patties sizzling, fry baskets.
      b.box(m.darkMarble, x - 0.8, 0.96, P.z0 + 0.55, 2.2, 0.04, 0.7);
      b.box(fire, x - 0.8, 0.94, P.z0 + 0.92, 2.2, 0.02, 0.02);
      for (let k = 0; k < 6; k++) food.add(new THREE.CylinderGeometry(0.055, 0.055, 0.016, 12), M(x - 1.6 + k * 0.32, 0.99, P.z0 + 0.55 + (k % 2) * 0.15), 0x5a2a14);
      for (let k = 0; k < 2; k++) b.box(steel, x + 1.2 + k * 0.5, 1.05, P.z0 + 0.55, 0.35, 0.2, 0.3);
      for (let k = 0; k < 3; k++) food.add(burger, M(x - 1.6 + k * 0.35, COUNTER.top, z - 0.22, k));
    } else if (c.id === 'noodles') {
      // Two woks over flames, red lanterns under the canopy.
      for (const dx of [-1.4, -0.5]) {
        b.add(new THREE.SphereGeometry(0.28, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), steel, M(x + dx, 1.25, P.z0 + 0.55));
        b.add(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 12), fire, M(x + dx, 0.97, P.z0 + 0.55));
      }
      for (const dx of [-1.8, 0, 1.8]) {
        b.add(new THREE.SphereGeometry(0.2, 12, 8).scale(1, 1.25, 1), m.glow(0xd8241a, 1.3), M(x + dx, 2.55, -11.35));
        b.box(m.gold, x + dx, 2.79, -11.35, 0.1, 0.06, 0.1);
      }
      for (let k = 0; k < 3; k++) food.add(noodles, M(x - 1.6 + k * 0.3, COUNTER.top, z - 0.22, 0.3 * k));
    } else {
      // A gelato case: glass over a dozen colourful tubs.
      b.box(glass, x - 0.6, COUNTER.top + 0.12, z - 0.05, 2.4, 0.24, 0.5);
      const flavours = [0xa8c87a, 0xf6e8c8, 0x5a3418, 0xf2a0b0, 0xf6d24a, 0xe84a3a, 0xc8a0e8, 0xf6f6f0, 0x8ad0e0, 0x7a4a2a, 0xf0c060, 0x6ab84a];
      flavours.forEach((col, k) => {
        const tx = x - 1.65 + (k % 6) * 0.42,
          tz = z - 0.17 + Math.floor(k / 6) * 0.22;
        food.add(new THREE.BoxGeometry(0.36, 0.06, 0.18), M(tx, COUNTER.top + 0.03, tz), 0xc8ccd2);
        food.add(new THREE.SphereGeometry(0.11, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.4, 0.5, 0.7), M(tx, COUNTER.top + 0.055, tz), col);
      });
      // An espresso machine on the back counter.
      b.box(steel, x + 1.3, 1.2, P.z0 + 0.5, 0.8, 0.5, 0.45);
      b.box(m.gold, x + 1.3, 1.47, P.z0 + 0.5, 0.82, 0.04, 0.47);
      for (let k = 0; k < 3; k++) food.add(gelato, M(x + 0.9 + k * 0.12, COUNTER.top, z + 0.05));
    }
  }
  // Tables and stools.
  for (const [x, z] of TABLES) {
    b.add(new THREE.CylinderGeometry(TABLE_R, TABLE_R, 0.04, 28), m.marble, M(x, TABLE_TOP - 0.02, z));
    b.add(new THREE.TorusGeometry(TABLE_R, 0.012, 4, 28).rotateX(Math.PI / 2), m.gold, M(x, TABLE_TOP - 0.03, z));
    b.add(new THREE.CylinderGeometry(0.05, 0.06, TABLE_TOP - 0.04, 10), m.gold, M(x, (TABLE_TOP - 0.04) / 2, z));
    b.add(new THREE.CylinderGeometry(0.28, 0.3, 0.03, 16), m.gold, M(x, 0.015, z));
    for (const a of STOOL_ANGLES) {
      const sx = x + Math.cos(a) * STOOL_R,
        sz = z + Math.sin(a) * STOOL_R;
      b.add(new THREE.CylinderGeometry(0.19, 0.17, 0.07, 16), m.walnut, M(sx, STOOL_Y - 0.035, sz));
      b.add(new THREE.CylinderGeometry(0.025, 0.03, STOOL_Y - 0.07, 8), m.gold, M(sx, (STOOL_Y - 0.07) / 2, sz));
      b.add(new THREE.TorusGeometry(0.15, 0.01, 4, 16).rotateX(Math.PI / 2), m.gold, M(sx, 0.25, sz));
      b.add(new THREE.CylinderGeometry(0.17, 0.19, 0.02, 16), m.gold, M(sx, 0.01, sz));
    }
  }
  // Dinner in front of the guests at the tables (they're seated by populate; same seats).
  const eaters = eaterSeats(EATERS_MAX);
  const dishes = [pizza, burger, noodles, gelato];
  eaters.forEach((e, i) => {
    const [tx, tz] = e.table;
    const d = new THREE.Vector3(e.pos.x - tx, 0, e.pos.z - tz).normalize();
    const px = tx + d.x * 0.24,
      pz = tz + d.z * 0.24;
    food.add(plate, M(px, TABLE_TOP, pz), 0xf6f2ea);
    food.add(dishes[i % 4], M(px, TABLE_TOP + 0.012, pz, e.yaw + Math.PI));
    food.add(new THREE.CylinderGeometry(0.035, 0.03, 0.12, 10).translate(0, 0.06, 0), M(tx - d.z * 0.22, TABLE_TOP, tz + d.x * 0.22), [0xb8101a, 0xe8b040, 0x3a1a0a, 0xf2f2f2][i % 4]);
  });
  // A couple of tables with leftovers nobody's sitting at (napkins, a drink).
  food.add(plate, M(TABLES[6][0] + 0.15, TABLE_TOP, TABLES[6][1] - 0.1), 0xf6f2ea);
  food.add(pizza, M(TABLES[6][0] + 0.15, TABLE_TOP + 0.012, TABLES[6][1] - 0.1, 1.2, 0.55));
  // Palms in urns along the concourse and at the food court's west end.
  PLANTERS.forEach(([x, z], i) => palm(b, m.stone, trunk, frond, x, z, 2.6 + (i % 3) * 0.35, i + 1));

  // --- Shop fronts (the concourse's south side) -----------------------------------------
  const sd = STORE.door,
    ad = ARCADE.door;
  const winW: [number, number][] = [
    [STORE.x0 + 0.8, sd.x0 - 0.6],
    [sd.x1 + 0.6, STORE.x1 - 0.8],
  ];
  // The wall itself, concourse side: marble, with the doors and the boutique's windows.
  wallRun(b, m.marbleWall, 'x', FRONT_Z, P.x0, P.x1, Math.PI, 0, P.h, [
    [sd.x0, sd.x1, 0, 2.8],
    [ad.x0, ad.x1, 0, 2.8],
    ...winW.map(([a, c]) => [a, c, 0.45, 2.8] as [number, number, number, number]),
  ]);
  // Gilt frames round the doors and windows, a sill under the windows, the glass.
  for (const [a, c, lo] of [[sd.x0, sd.x1, 0], [ad.x0, ad.x1, 0], ...winW.map(([a2, c2]) => [a2, c2, 0.45])] as [number, number, number][]) {
    b.box(m.gold, a - 0.06, 1.4 + lo / 2, FRONT_Z - 0.04, 0.12, 2.8 - lo + 0.1, 0.16);
    b.box(m.gold, c + 0.06, 1.4 + lo / 2, FRONT_Z - 0.04, 0.12, 2.8 - lo + 0.1, 0.16);
    b.box(m.gold, (a + c) / 2, 2.86, FRONT_Z - 0.04, c - a + 0.24, 0.12, 0.16);
    if (lo > 0) {
      b.box(m.darkMarble, (a + c) / 2, lo - 0.03, FRONT_Z - 0.06, c - a, 0.06, 0.24);
      b.add(new THREE.PlaneGeometry(c - a, 2.8 - lo), glass, M((a + c) / 2, (lo + 2.8) / 2, FRONT_Z + 0.02, Math.PI));
    }
  }
  // Fascias over the shops: the boutique's name in gold, the arcade's in neon.
  b.box(m.darkMarble, (STORE.x0 + STORE.x1) / 2, 3.45, FRONT_Z - 0.08, STORE.x1 - STORE.x0 - 0.4, 0.9, 0.1);
  signs.add(5.2, 0.85, 1024, 168, at((STORE.x0 + STORE.x1) / 2, 3.45, FRONT_Z - 0.14, Math.PI), goldSign('Lago Luxe', 'EYEWEAR  ·  HATS  ·  GIFTS', { bg: 'rgba(14,9,6,0.0)' }));
  signs.add(5.0, 1.0, 1024, 205, at((ARCADE.x0 + ARCADE.x1) / 2 + 1.0, 3.55, FRONT_Z - 0.06, Math.PI), neonSign('LAGO ARCADE', '#ff3ad8', 'PLAY  ·  WIN  ·  REPEAT', '#3ae8ff'));
  // Neon frames round the arcade's door (they glow out onto the marble).
  const neonPink = m.glow(0xff3ad8, 1.8),
    neonCyan = m.glow(0x3ae8ff, 1.6);
  b.box(neonPink, ad.x0 - 0.2, 1.45, FRONT_Z - 0.1, 0.04, 2.9, 0.04);
  b.box(neonPink, ad.x1 + 0.2, 1.45, FRONT_Z - 0.1, 0.04, 2.9, 0.04);
  b.box(neonCyan, (ad.x0 + ad.x1) / 2, 3.0, FRONT_Z - 0.1, ad.x1 - ad.x0 + 0.44, 0.04, 0.04);
  halo((ad.x0 + ad.x1) / 2, 1.5, FRONT_Z - 0.15, 3.6, Math.PI);
  pool((ad.x0 + ad.x1) / 2, FRONT_Z - 1.2, 3.0);
  pool((sd.x0 + sd.x1) / 2, FRONT_Z - 1.0, 3.4);

  // --- The boutique ----------------------------------------------------------------------
  const S = STORE,
    sw = S.x1 - S.x0,
    scx = (S.x0 + S.x1) / 2,
    scz = (S.z0 + S.z1) / 2;
  // Bright and white like a jeweller's: pale marble underfoot, ivory walls, a glowing ceiling.
  const ivory = new THREE.MeshStandardMaterial({ color: 0xf4ece0, roughness: 0.7, emissive: 0x6a5a48, emissiveIntensity: 0.6 });
  b.add(plane(sw, S.z1 - S.z0, 1), m.marble, M(scx, 0.003, scz));
  {
    const rug = new THREE.MeshStandardMaterial({ color: 0x5a1220, roughness: 0.95, emissive: 0x1a0408, emissiveIntensity: 0.5 });
    b.add(new THREE.PlaneGeometry(7, 4.2).rotateX(-Math.PI / 2), rug, M(scx, 0.006, 8.9));
    b.box(m.gold, scx, 0.007, 8.9 - 2.12, 7, 0.002, 0.05);
    b.box(m.gold, scx, 0.007, 8.9 + 2.12, 7, 0.002, 0.05);
  }
  b.add(plane(sw, S.z1 - S.z0, 1, false), m.cream, M(scx, SHOP_H, scz));
  b.box(m.glowWarm, scx, SHOP_H - 0.02, scz, sw - 2, 0.01, S.z1 - S.z0 - 2.4);
  b.box(m.cream, scx, SHOP_H - 0.06, scz, sw - 2.6, 0.06, S.z1 - S.z0 - 3);
  for (const x of [S.x0 + 3.5, scx, S.x1 - 3.5]) b.box(m.glow(0xfff2dc, 1.3), x, SHOP_H - 0.1, 9.4, 2.2, 0.02, 4.2);
  wallRun(b, ivory, 'z', S.x0, S.z0, S.z1, Math.PI / 2, 0, SHOP_H);
  wallRun(b, ivory, 'z', S.x1, S.z0, S.z1, -Math.PI / 2, 0, SHOP_H);
  wallRun(b, ivory, 'x', S.z1, S.x0, S.x1, Math.PI, 0, SHOP_H);
  wallRun(b, ivory, 'x', FRONT_Z + 0.12, S.x0, S.x1, 0, 0, SHOP_H, [[sd.x0, sd.x1, 0, 2.8], ...winW.map(([a, c]) => [a, c, 0.45, 2.8] as [number, number, number, number])]);
  // Gilt panel mouldings on the ivory walls.
  for (const [x, z, w, d] of [
    [S.x0 + 0.02, 6.2, 0.02, 1.6],
    [S.x1 - 0.02, 6.2, 0.02, 1.6],
    [S.x0 + 0.02, 12.6, 0.02, 1.6],
    [S.x1 - 0.02, 12.6, 0.02, 1.6],
  ] as const)
    for (const y of [0.9, 2.7]) b.box(m.gold, x, y, z, w || 0.02, 0.03, d || 0.02);
  for (const x of [S.x0 + 0.06, S.x1 - 0.06]) b.box(m.walnut, x, 0.08, scz, 0.12, 0.16, S.z1 - S.z0);
  // Wall shelving: walnut frames, glass shelves lit from behind.
  for (const sh of STORE_FIX.shelves) {
    const inward = sh.x < scx ? 1 : -1;
    b.box(m.walnut, sh.x - inward * 0.18, 1.1, sh.z, 0.06, 2.2, sh.w + 0.1);
    b.box(m.glow(0xffe2b0, 0.9), sh.x - inward * 0.145, 1.1, sh.z, 0.01, 2.0, sh.w - 0.1);
    for (const s of [-1, 1]) b.box(m.walnut, sh.x, 1.1, sh.z + (s * sh.w) / 2, sh.d, 2.2, 0.05);
    for (const y of STORE_FIX.shelfYs) b.box(glass, sh.x, y - 0.01, sh.z, sh.d, 0.02, sh.w);
    b.box(m.walnut, sh.x, 2.22, sh.z, sh.d + 0.04, 0.06, sh.w + 0.1);
  }
  // Display tables: white marble tops on gilt legs, so the stock stands out.
  for (const t of STORE_FIX.tables) {
    b.box(m.marble, t.x, t.top - 0.025, t.z, t.w, 0.05, t.d);
    b.box(m.gold, t.x, t.top - 0.055, t.z, t.w + 0.02, 0.02, t.d + 0.02);
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      b.box(m.gold, t.x + sx * (t.w / 2 - 0.06), (t.top - 0.05) / 2, t.z + sz * (t.d / 2 - 0.06), 0.04, t.top - 0.05, 0.04);
    pool(t.x, t.z, 2.4, t.top + 0.003);
    pool(t.x, t.z, 3.2);
  }
  // The counter and the register.
  {
    const c = STORE_FIX.counter;
    b.box(m.walnut, c.x, (c.top - 0.04) / 2, c.z, c.w, c.top - 0.04, c.d);
    b.box(m.marble, c.x, c.top - 0.02, c.z, c.w + 0.08, 0.04, c.d + 0.06);
    b.box(m.gold, c.x, 0.07, c.z - c.d / 2 - 0.005, c.w, 0.08, 0.02);
    const r = STORE_FIX.register;
    b.box(new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.3, metalness: 0.4 }), r.x, c.top + 0.06, r.z, 0.32, 0.12, 0.26);
    b.add(new THREE.PlaneGeometry(0.24, 0.14), m.glow(0x3a8ac8, 0.8), M(r.x, c.top + 0.22, r.z - 0.02, Math.PI).multiply(new THREE.Matrix4().makeRotationX(-0.35)));
    b.box(new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.3, metalness: 0.4 }), r.x, c.top + 0.15, r.z + 0.04, 0.04, 0.16, 0.04);
    // Behind the counter: the shop's name and a mirror.
    signs.add(2.2, 0.5, 768, 175, at(c.x, 2.5, S.z1 - 0.05, Math.PI), goldSign('Lago Luxe', 'EST. ON THE LAKE', { bg: 'rgba(14,9,6,0.85)' }));
    b.box(new THREE.MeshStandardMaterial({ color: 0x8a8070, metalness: 1, roughness: 0.06, envMapIntensity: 1.6 }), c.x + 2.6, 1.5, S.z1 - 0.04, 1.2, 1.9, 0.02);
    pool(c.x, c.z + 0.4, 3.0);
  }
  // Mannequins in the windows: glossy white figures, one in a fedora, one in a scarf.
  {
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f0ec, roughness: 0.2, envMapIntensity: 1.2, emissive: 0x2a2826, emissiveIntensity: 0.3 });
    STORE_FIX.mannequins.forEach((mq, i) => {
      const y0 = 0.05;
      b.add(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 16), m.gold, M(mq.x, 0.015, mq.z));
      b.add(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 6), m.gold, M(mq.x, y0 + 0.45, mq.z));
      b.add(new THREE.CapsuleGeometry(0.15, 0.42, 4, 12).scale(1, 1, 0.7), white, M(mq.x, 1.25, mq.z, mq.yaw));
      b.add(new THREE.CapsuleGeometry(0.12, 0.2, 4, 10).scale(1.15, 1, 0.75), white, M(mq.x, 0.88, mq.z, mq.yaw));
      for (const s of [-1, 1]) {
        b.add(new THREE.CapsuleGeometry(0.045, 0.5, 4, 8), white, M(mq.x + s * 0.21, 1.2, mq.z, mq.yaw).multiply(new THREE.Matrix4().makeRotationZ(s * 0.15)));
        b.add(new THREE.CapsuleGeometry(0.06, 0.5, 4, 8), white, M(mq.x + s * 0.09, 0.45, mq.z, mq.yaw));
      }
      b.add(new THREE.CylinderGeometry(0.04, 0.05, 0.1, 8), white, M(mq.x, 1.6, mq.z));
      b.add(new THREE.SphereGeometry(0.1, 14, 10).scale(0.9, 1.15, 1), white, M(mq.x, 1.75, mq.z));
      if (i === 0) b.add(hatGeometry(), m.darkMarble, M(mq.x, 1.82, mq.z, mq.yaw));
      else b.add(new THREE.TorusGeometry(0.08, 0.035, 8, 16).rotateX(Math.PI / 2).scale(1, 1, 0.8), new THREE.MeshStandardMaterial({ color: 0xb01a2a, roughness: 0.8 }), M(mq.x, 1.58, mq.z));
      pool(mq.x, mq.z, 2.0);
    });
  }
  void plushGeometry;
  void dicesetGeometry;

  // --- The arcade -------------------------------------------------------------------------
  const arcadeRoom = new THREE.Group();
  arcadeRoom.name = 'arcade-room';
  root.add(arcadeRoom);
  const A = ARCADE,
    aw = A.x1 - A.x0,
    acx = (A.x0 + A.x1) / 2,
    acz = (A.z0 + A.z1) / 2;
  {
    const ab = new Batch();
    const carpetTex = arcadeCarpet(512);
    const carpet = new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 0.95, emissive: 0xffffff, emissiveMap: carpetTex, emissiveIntensity: 0.35 });
    ab.add(plane(aw, A.z1 - A.z0, 1 / 2.2), carpet, M(acx, 0.003, acz));
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2040, roughness: 0.8, emissive: 0x140c26, emissiveIntensity: 0.9 });
    ab.add(plane(aw, A.z1 - A.z0, 1, false), dark, M(acx, SHOP_H, acz));
    wallRun(ab, dark, 'z', A.x0, A.z0, A.z1, Math.PI / 2, 0, SHOP_H);
    wallRun(ab, dark, 'z', A.x1, A.z0, A.z1, -Math.PI / 2, 0, SHOP_H);
    wallRun(ab, dark, 'x', A.z1, A.x0, A.x1, Math.PI, 0, SHOP_H);
    wallRun(ab, dark, 'x', FRONT_Z + 0.12, A.x0, A.x1, 0, 0, SHOP_H, [[ad.x0, ad.x1, 0, 2.8]]);
    // Neon trim: pink along the top of every wall, cyan along the skirting, a grid of tubes overhead.
    for (const [x, z, w, d] of [
      [acx, A.z1 - 0.04, aw, 0.03],
      [acx, FRONT_Z + 0.16, aw, 0.03],
      [A.x0 + 0.04, acz, 0.03, A.z1 - A.z0],
      [A.x1 - 0.04, acz, 0.03, A.z1 - A.z0],
    ] as const) {
      ab.box(neonPink, x, 2.95, z, w, 0.04, d);
      ab.box(neonCyan, x, 0.12, z, w, 0.03, d);
    }
    for (let x = A.x0 + 3; x < A.x1 - 1; x += 3.2) ab.box(x % 2 < 1 ? neonCyan : neonPink, x, SHOP_H - 0.05, acz, 0.04, 0.03, A.z1 - A.z0 - 2);
    ab.box(m.glow(0xffe03a, 1.5), acx, SHOP_H - 0.05, acz, aw - 2, 0.03, 0.04);
    // The change machine by the door.
    const cm = CHANGE_MACHINE;
    ab.box(steel, cm.x, 0.8, cm.z, cm.w, 1.6, cm.d, cm.yaw);
    ab.box(m.glow(0x3ae8ff, 1.0), cm.x, 1.25, cm.z + cm.d / 2 + 0.005, cm.w - 0.12, 0.35, 0.01);
    ab.box(m.glow(0xffe03a, 1.2), cm.x, 0.75, cm.z + cm.d / 2 + 0.005, 0.3, 0.06, 0.01);
    ab.box(m.darkMarble, cm.x, 0.35, cm.z + cm.d / 2 + 0.03, 0.4, 0.12, 0.06);
    signs.add(0.9, 0.3, 384, 128, at(cm.x, 1.95, cm.z + cm.d / 2 + 0.01), neonSign('CHANGE', '#ffe03a', 'CHIPS  →  TOKENS', '#3ae8ff'));
    // Glow on the carpet from the screens and the neon.
    const neonPool = new THREE.MeshBasicMaterial({ map: toTexture(radial(128, 'rgba(255,80,220,0.35)', 'rgba(80,40,255,0)')), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const s of ARCADE_SLOTS) ab.add(new THREE.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2), neonPool, M(s.pos.x + Math.sin(s.yaw) * 0.9, 0.02, s.pos.z + Math.cos(s.yaw) * 0.9));
    ab.add(new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2), neonPool, M(acx, 0.02, acz));
    signs.add(3.2, 0.8, 1024, 256, at(acx + 3.5, 2.35, A.z1 - 0.05, Math.PI), neonSign('HIGH SCORES', '#3ae8ff', 'BEAT THE BOYS', '#ff3ad8'));
    ab.build(arcadeRoom, 'arcade-static');
  }
  // Until the arcade module is in: dark cabinets in the bays, a glow where each screen will be.
  let placeholders: THREE.Group | null = null;
  if (opts.placeholders) {
    placeholders = new THREE.Group();
    placeholders.name = 'arcade-placeholders';
    arcadeRoom.add(placeholders);
    const pb = new Batch();
    const shell = new THREE.MeshStandardMaterial({ color: 0x120e18, roughness: 0.5, metalness: 0.2 });
    const screen = m.glow(0x2a3a6a, 0.9);
    for (const s of ARCADE_SLOTS) {
      const [w, d] = s.footprint;
      const rot = new THREE.Matrix4().makeRotationY(s.yaw);
      const put = (lx: number, y: number, lz: number) => new THREE.Vector3(lx, y, lz).applyMatrix4(rot).add(s.pos);
      const box = (mat: THREE.Material, lx: number, y: number, lz: number, sx: number, sy: number, sz: number) => {
        const p = put(lx, y, lz);
        pb.box(mat, p.x, p.y, p.z, sx, sy, sz, s.yaw);
      };
      if (s.kind === 'cabinet') {
        box(shell, 0, 0.95, -0.05, w - 0.04, 1.9, d - 0.15);
        box(shell, 0, 0.95, d / 2 - 0.12, w - 0.04, 0.12, 0.2);
        box(screen, 0, 1.45, d / 2 - 0.12, w - 0.2, 0.5, 0.02);
        box(neonPink, 0, 1.93, -0.05 + (d - 0.15) / 2 + 0.005, w - 0.1, 0.12, 0.01);
      } else if (s.hint === 'basketball') {
        box(shell, 0, 0.45, 0, w, 0.9, d);
        box(shell, 0, 1.7, -d / 2 + 0.1, w, 1.6, 0.1);
        box(neonCyan, 0, 2.5, -d / 2 + 0.16, w, 0.05, 0.02);
      } else if (s.hint === 'claw machine') {
        box(shell, 0, 0.45, 0, w, 0.9, d);
        box(glass, 0, 1.4, 0, w - 0.05, 1.0, d - 0.05);
        box(neonPink, 0, 1.95, 0, w, 0.1, d);
      } else {
        box(shell, 0, 0.4, 0, w, 0.8, d);
        box(screen, 0, 0.805, 0, w - 0.1, 0.01, d - 0.1);
        box(neonCyan, 0, 0.82, 0, w, 0.02, d);
      }
    }
    pb.build(placeholders, 'arcade-placeholder-cabinets');
  }

  // --- The balcony over the atrium --------------------------------------------------------
  {
    const R = ATRIUM.rail;
    // The floor's edge, a glass balustrade with gilt posts and handrail.
    b.box(m.darkMarble, P.x0 + 0.05, -0.15, 0, 0.3, 0.3, R.z1 - R.z0);
    b.add(new THREE.PlaneGeometry(R.z1 - R.z0, 0.95).rotateY(Math.PI / 2), glass, M(P.x0 + 0.15, 0.55, 0));
    for (let z = R.z0; z <= R.z1 + 0.01; z += 0.9) b.box(m.gold, P.x0 + 0.15, 0.55, z, 0.05, 1.1, 0.05);
    b.box(m.gold, P.x0 + 0.15, 1.08, 0, 0.08, 0.05, R.z1 - R.z0);
    // Grand columns either side of the opening and a beam across the top.
    for (const z of [R.z0, R.z1]) {
      b.box(m.marble, P.x0 + 0.1, P.h / 2, z, 0.8, P.h, 0.8);
      b.box(m.gold, P.x0 + 0.1, P.h - 0.6, z, 0.9, 0.3, 0.9);
    }
    b.box(m.cream, P.x0, P.h - 0.3, 0, 0.6, 0.6, R.z1 - R.z0);
    // The atrium: a garden courtyard far below, a fountain, tall palms, levels of glowing balconies, a glass roof.
    const T = ATRIUM;
    const tw = T.x1 - T.x0,
      td = T.z1 - T.z0,
      tcx = (T.x0 + T.x1) / 2,
      tcz = (T.z0 + T.z1) / 2,
      top = 12;
    b.add(plane(tw, td, 0.5), m.stone, M(tcx, T.floorY, tcz));
    b.add(plane(tw, td, 0.5, false), sky, M(tcx, top, tcz));
    wallRun(b, m.marbleWall, 'x', T.z0, T.x0, T.x1, 0, T.floorY, top);
    wallRun(b, m.marbleWall, 'x', T.z1, T.x0, T.x1, Math.PI, T.floorY, top);
    wallRun(b, m.marbleWall, 'z', T.x0, T.z0, T.z1, Math.PI / 2, T.floorY, top);
    wallRun(b, m.marbleWall, 'z', T.x1, T.z0, T.z1, -Math.PI / 2, T.floorY, top, [[R.z0, R.z1, 0, P.h]]);
    // Other levels: balcony slabs with lit windows behind, round the three far walls.
    for (const y of [-4.2, -0.9, 3.4, 7.6]) {
      b.box(m.cream, tcx, y, T.z0 + 0.4, tw, 0.25, 0.8);
      b.box(m.cream, tcx, y, T.z1 - 0.4, tw, 0.25, 0.8);
      b.box(m.cream, T.x0 + 0.4, y, tcz, 0.8, 0.25, td);
      b.box(m.gold, tcx, y + 0.5, T.z0 + 0.78, tw, 0.04, 0.04);
      b.box(m.gold, tcx, y + 0.5, T.z1 - 0.78, tw, 0.04, 0.04);
      b.box(m.gold, T.x0 + 0.78, y + 0.5, tcz, 0.04, 0.04, td);
      for (let x = T.x0 + 1.5; x < T.x1 - 0.5; x += 2.2) {
        b.box(m.glowWarm, x, y + 1.3, T.z0 + 0.02, 1.2, 1.6, 0.02);
        b.box(m.glowWarm, x, y + 1.3, T.z1 - 0.02, 1.2, 1.6, 0.02);
      }
      for (let z = T.z0 + 1.5; z < T.z1 - 0.5; z += 2.2) b.box(m.glowWarm, T.x0 + 0.02, y + 1.3, z, 0.02, 1.6, 1.2);
    }
    // The garden: a fountain in the middle, hedges, four tall palms that reach up to the balcony.
    const fx = tcx,
      fz = tcz;
    b.add(new THREE.CylinderGeometry(3.0, 3.1, 0.55, 40, 1, true), m.marble, M(fx, T.floorY + 0.27, fz));
    b.add(new THREE.TorusGeometry(3.05, 0.12, 6, 40).rotateX(Math.PI / 2), m.marble, M(fx, T.floorY + 0.55, fz));
    b.add(new THREE.CircleGeometry(3.0, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1a4a6a, roughness: 0.05, metalness: 0.3, emissive: 0x0a3a5a, emissiveIntensity: 0.9, envMapIntensity: 2 }), M(fx, T.floorY + 0.42, fz));
    b.add(new THREE.CylinderGeometry(0.5, 0.8, 1.2, 16), m.marble, M(fx, T.floorY + 0.9, fz));
    b.add(new THREE.CylinderGeometry(1.2, 0.4, 0.25, 24), m.marble, M(fx, T.floorY + 1.6, fz));
    b.add(new THREE.CylinderGeometry(0.06, 0.12, 2.4, 8, 1, true), m.glow(0xdaf2ff, 1.3), M(fx, T.floorY + 2.9, fz));
    b.add(new THREE.SphereGeometry(0.35, 10, 8).scale(1, 0.6, 1), m.glow(0xdaf2ff, 1.1), M(fx, T.floorY + 4.1, fz));
    halo(fx, T.floorY + 3.0, fz, 4.5, Math.PI / 2);
    pool(fx, fz, 9, T.floorY + 0.02);
    const hedge = new THREE.MeshStandardMaterial({ color: 0x2a5a2a, roughness: 0.9, emissive: 0x0a1a0a, emissiveIntensity: 0.5 });
    for (const [hx, hz, hw, hd] of [
      [tcx, T.z0 + 2.2, tw - 4, 0.8],
      [tcx, T.z1 - 2.2, tw - 4, 0.8],
      [T.x0 + 2.2, tcz, 0.8, td - 6],
    ]) b.box(hedge, hx, T.floorY + 0.45, hz, hw, 0.9, hd);
    for (const [px, pz] of [
      [T.x0 + 3.5, T.z0 + 3.5],
      [T.x0 + 3.5, T.z1 - 3.5],
      [T.x1 - 3.5, T.z0 + 3.5],
      [T.x1 - 3.5, T.z1 - 3.5],
    ]) palm(b, m.stone, trunk, frond, px, pz, 9, Math.round(px + pz), T.floorY, false);
  }

  // --- Lighting: warm pools under the chandeliers and along the concourse -------------------
  for (const x of [-611.5, -623.5]) pool(x, -7.7, 9);
  for (const x of [-606, -618, -630]) pool(x, 0, 7);
  pool(-602.5, 0, 5);

  b.build(root, 'promenade-static');
  food.build(root, 'promenade-food');
  signs.build(root, 'promenade-signs');

  const neonA = neonPink.color.clone(),
    neonB = neonCyan.color.clone();
  return {
    root,
    arcadeRoom,
    placeholders,
    menuSpots,
    register: new THREE.Vector3(STORE_FIX.register.x, STORE_FIX.counter.top, STORE_FIX.register.z),
    eaters: eaters.map((e) => ({ pos: e.pos, yaw: e.yaw })),
    update(t) {
      if (!root.visible) return;
      // The neon breathes a little (the arcade's tubes, the door frame).
      const k = 0.92 + 0.08 * Math.sin(t * 2.3) + (Math.sin(t * 37) > 0.995 ? -0.25 : 0);
      neonPink.color.copy(neonA).multiplyScalar(k);
      neonCyan.color.copy(neonB).multiplyScalar(0.96 + 0.04 * Math.sin(t * 1.7 + 1));
    },
  };
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

const COOK_MEN = new Set(['pizza', 'burger']);

export interface PromenadeCast {
  /** Each counter's cook, by counter id. */
  servers: Map<string, Person>;
  clerk: Person | null;
  people: Person[];
}

/**
 * The Promenade's people: a cook behind each counter, the boutique's clerk,
 * guests having dinner at the tables (bites now and then), friends chatting
 * on the concourse, strollers, and a couple of kids-at-heart in the arcade.
 */
export function populatePromenade(crowd: Crowd, area: PromenadeArea, budget: number): PromenadeCast {
  const people: Person[] = [];
  const keep = (p: Person | null) => {
    if (p) people.push(p);
    return p;
  };
  const servers = new Map<string, Person>();
  for (const c of COUNTERS) {
    const look = { ...staffLook('bar'), main: new THREE.Color(c.colors[0] === '#f4e8d8' ? '#4a8a6a' : c.colors[0]).getHex(), second: 0xf6f2ea };
    // Tony (pizza) and Duke (burgers) are men; Mei (noodles) and Lucia (gelato) women: their voices match (cast.ts).
    if (COOK_MEN.has(c.id)) Object.assign(look, { kind: 'male_suit', height: 1.8, hairStyle: look.hairStyle === 'long' || look.hairStyle === 'bun' ? 'short' : look.hairStyle, lipstick: undefined });
    const p = keep(crowd.add('bartender', look, new THREE.Vector3(c.x - 0.3, 0, COUNTER.z - 0.85), 0));
    if (p) {
      p.speaker = `cook_${c.id}`;
      servers.set(c.id, p);
    }
  }
  const clerk = keep(crowd.add('bartender', { ...staffLook('bar'), main: 0x14100e, second: 0xf6f2ea }, new THREE.Vector3(STORE_FIX.clerk.x, 0, STORE_FIX.clerk.z), STORE_FIX.clerk.yaw));
  if (clerk) clerk.speaker = 'clerk';
  const left = () => budget - people.length;
  // Dinner at the tables.
  const nEat = Math.min(area.eaters.length, Math.max(3, Math.round(left() * 0.5)));
  for (const e of area.eaters.slice(0, nEat)) {
    const p = keep(crowd.add('patron', randomLook(), e.pos.clone(), e.yaw));
    if (!p) break;
    p.seatY = STOOL_Y;
    p.onUpdate = (q) => {
      // A bite now and then (hand to mouth), a sip less often.
      if (q.action <= 0 && Math.random() < 0.004) {
        q.actionKind = 'sip';
        q.action = 1.3;
      }
    };
  }
  // Friends talking on the concourse.
  if (left() >= 4) for (const p of crowd.addGroup(-613.5, 1.2, 3, { drinks: 0.6 })) keep(p);
  if (left() >= 3) for (const p of crowd.addGroup(-626.5, -1.4, 2, { drinks: 0.3 })) keep(p);
  // At the arcade's cabinets.
  for (const id of ['cab2', 'cab5']) {
    if (left() < 2) break;
    const s = ARCADE_SLOTS.find((x) => x.id === id)!;
    const fwd = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    keep(crowd.add('watch', randomLook(), s.pos.clone().addScaledVector(fwd, s.footprint[1] / 2 + 0.45), s.yaw + Math.PI));
  }
  // Strolling: up and down the concourse, in and out of the shops.
  const starts = [PROMENADE_NODES[2], PROMENADE_NODES[9], PROMENADE_NODES[15], PROMENADE_NODES[25], PROMENADE_NODES[6], PROMENADE_NODES[19]];
  for (const [x, z] of starts) {
    if (left() <= 0) break;
    const p = keep(crowd.add('wander', randomLook(), new THREE.Vector3(x, 0, z)));
    if (!p) break;
    p.speed = 0.65 + Math.random() * 0.25;
    p.haunt = (hx) => onPromenade(hx);
  }
  return { servers, clerk, people };
}
