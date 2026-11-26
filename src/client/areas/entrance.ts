import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Interaction, Interactable } from '../interaction';
import type { Crowd, Look, Person } from '../people';
import { randomLook, staffLook } from '../people';
import type { Player } from '../player';
import type { Quality } from '../quality';
import { buildCity, type City } from '../skyline';
import type { Sound } from '../audio';
import { canvas, toTexture } from '../textures';
import type { Box, Seat, World } from '../world';
import { Batch, M, nightSky, wallQuad, type Mats } from './kit';
import { chandelier } from './hotel';
import { palmGeometry } from './pool';
import { SignAtlas } from './promenade';
import { CarFleet } from './entrancecars';
import { seatOf, Traffic, type SimCar, type SimGuest } from './entrancetraffic';
import {
  BAYS,
  BLVD,
  CANOPY,
  CAR,
  COLUMNS,
  CURB_LANE,
  CURB_Z,
  DRIVE,
  ENT_CARS,
  ENT_LOBBY,
  ENT_X,
  FACADE_Z,
  FOUNTAIN,
  ISLAND,
  onEntrance,
  REVOLVING,
  SIDEWALK,
  SLIDE_DOORS,
  TAXI_SLOTS,
  VALET_SPOT,
} from './entranceplan';
import { EntranceSound } from '../entranceaudio';

export * from './entranceplan';

/**
 * The front entrance: the lobby's elevator landing (floor G), its glass
 * doors, and outside, the porte-cochère. A grand lit canopy on gilded
 * columns over the driveway, warm uplights, the revolving door, the valet
 * stand, bell carts, potted palms, a fountain on the planter island; the taxi
 * line along the curb and the rideshare bays (numbered, signed) where cars
 * pull in with their hazards on, guests come out with their bags and get in,
 * and off they go. Beyond the hedges, the Strip at night: the boulevard's
 * traffic, palms on the median, the resorts' neon across the road, the city
 * and an open sky.
 *
 * Every car comes and goes on one shared clock (entrancetraffic.ts), so all
 * the players in a room see the same ones; you can open a waiting car's door
 * and sit in the back (it stays put while you're in it).
 */

// ---------------------------------------------------------------------------
// Walkable floor and obstacles
// ---------------------------------------------------------------------------

const L = ENT_LOBBY;
/** Fixtures outside (also used to build them). */
const PODIUM = { x: 300.6, z: 4.5, w: 0.9, d: 0.55 };
const CARTS: [number, number, number][] = [
  [287.0, 1.2, 0.1],
  [309.4, 1.25, -0.15],
];
const POTS: [number, number][] = [
  [288.0, 0.9],
  [308.1, 0.9],
  [272.5, 0.9],
  [327.5, 0.9],
  [264.6, 0.9],
  [335.4, 0.9],
];
const BENCHES: [number, number][] = [
  [280.6, 0.75],
  [276.2, 0.75],
];
const URN = { x: 325.4, z: 1.0 };
const TAXI_SIGN = { x: 304.1, z: 6.15 };
const RIDE_SIGN = { x: 292.1, z: 6.15 };
const BAY_POSTS = BAYS.map((x) => ({ x: x - 2.35, z: 6.2 }));
/** Stanchions round the taxi queue. */
const STANCHIONS: [number, number][] = [
  [306.9, 4.25],
  [308.6, 4.25],
  [310.3, 4.25],
  [312.0, 4.25],
  [306.9, 5.6],
  [308.6, 5.6],
  [310.3, 5.6],
];
const LOBBY_URN = { x: 297.8, z: -5.2 };

export function registerEntrance(world: World) {
  // Lobby (the doors are the only way out: the glass wall stands between).
  world.addWalkable(L.x0 + 0.3, L.x1 - 0.05, L.z0 + 0.3, FACADE_Z - 0.32);
  for (const d of SLIDE_DOORS) world.addWalkable(d.x - d.half + 0.12, d.x + d.half - 0.12, FACADE_Z - 0.7, FACADE_Z + 0.7);
  world.addSurface('marble', L.x0, L.x1, L.z0, FACADE_Z);
  world.addCircle(LOBBY_URN.x, LOBBY_URN.z, 0.75, 'planter');
  world.addBox(289.65, -4.4, 0.6, 2.2, 0, 'table');
  world.addCircle(REVOLVING.x, FACADE_Z, REVOLVING.r + 0.05, 'door');
  // Outside: the sidewalk, the driveway, round the island's ends to the hedges.
  world.addWalkable(SIDEWALK.x0 + 2.4, SIDEWALK.x1 - 2.4, FACADE_Z + 0.3, 19.0);
  world.addSurface('stone', SIDEWALK.x0, SIDEWALK.x1, FACADE_Z, 22);
  world.addBox((ISLAND.x0 + ISLAND.x1) / 2, (ISLAND.z0 + ISLAND.z1) / 2, ISLAND.x1 - ISLAND.x0, ISLAND.z1 - ISLAND.z0, 0, 'planter');
  for (const [x, z] of COLUMNS) world.addCircle(x, z, 0.55, 'column');
  world.addBox(PODIUM.x, PODIUM.z, PODIUM.w, PODIUM.d, 0, 'podium');
  for (const [x, z, yaw] of CARTS) world.addBox(x, z, 1.2, 0.7, yaw, 'luggage cart');
  for (const [x, z] of POTS) world.addCircle(x, z, 0.48, 'planter');
  for (const [x, z] of BENCHES) world.addBox(x, z, 1.8, 0.6, 0, 'bench');
  world.addCircle(URN.x, URN.z, 0.25, 'ash urn');
  for (const s of [TAXI_SIGN, RIDE_SIGN, ...BAY_POSTS]) world.addCircle(s.x, s.z, 0.12, 'sign');
  for (const [x, z] of STANCHIONS) world.addCircle(x, z, 0.12, 'stanchion');
  // The rope between the stanchions (a thin wall either side of the queue).
  world.addBox(309.45, 4.25, 5.1, 0.06, 0, 'rope');
  world.addBox(308.6, 5.6, 3.4, 0.06, 0, 'rope');
  // Lamp posts at the island's ends and along the hedges.
  for (const [x, z] of LAMPS) world.addCircle(x, z, 0.18, 'lamp');
}

/** Lamp posts (lanterns on black poles). */
const LAMPS: [number, number][] = [
  [272.6, 15.9],
  [327.4, 15.9],
  [266, 19.2],
  [334, 19.2],
];

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

/** The ground's light (pools under the canopy's downlights, the uplights, lamps, the lobby's glow). */
const GROUND = { x0: 250, x1: 350, z0: -1, z1: 24 };

function groundLight(): THREE.CanvasTexture {
  const W = 1024,
    H = 256;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const px = (x: number) => ((x - GROUND.x0) / (GROUND.x1 - GROUND.x0)) * W;
  const py = (z: number) => ((z - GROUND.z0) / (GROUND.z1 - GROUND.z0)) * H;
  const sx = W / (GROUND.x1 - GROUND.x0);
  g.globalCompositeOperation = 'lighter';
  const pool = (x: number, z: number, r: number, rgb: string, a: number) => {
    const grd = g.createRadialGradient(px(x), py(z), 0, px(x), py(z), r * sx);
    grd.addColorStop(0, `rgba(${rgb},${a})`);
    grd.addColorStop(0.5, `rgba(${rgb},${a * 0.45})`);
    grd.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grd;
    g.fillRect(px(x) - r * sx, py(z) - r * sx, 2 * r * sx, 2 * r * sx);
  };
  // Under the canopy: a soft warm wash and a downlight every 4 m.
  {
    const grd = g.createLinearGradient(0, py(-0.5), 0, py(CANOPY.z1 + 2));
    grd.addColorStop(0, 'rgba(255,200,140,0.32)');
    grd.addColorStop(0.75, 'rgba(255,190,130,0.22)');
    grd.addColorStop(1, 'rgba(255,190,130,0)');
    g.fillStyle = grd;
    g.fillRect(px(CANOPY.x0 - 2), py(-0.5), px(CANOPY.x1 + 2) - px(CANOPY.x0 - 2), py(CANOPY.z1 + 2) - py(-0.5));
  }
  for (let x = CANOPY.x0 + 2; x < CANOPY.x1; x += 4) for (let z = 1.8; z < CANOPY.z1; z += 4) pool(x, z, 2.4, '255,214,160', 0.28);
  // The lobby's glow through the glass, and the doors.
  for (let x = L.x0 + 1; x < L.x1; x += 1.5) pool(x, 0.4, 2.6, '255,220,170', 0.22);
  // Uplights at the columns, the fountain's glow, lamp posts.
  for (const [x, z] of COLUMNS) pool(x, z, 3.2, '255,196,120', 0.45);
  pool(FOUNTAIN.x, FOUNTAIN.z, 5.5, '180,215,255', 0.35);
  for (const [x, z] of LAMPS) pool(x, z, 6, '255,206,150', 0.5);
  // Taxi stand and rideshare signs.
  pool(TAXI_SIGN.x, TAXI_SIGN.z, 1.8, '255,220,120', 0.3);
  pool(RIDE_SIGN.x, RIDE_SIGN.z, 1.8, '200,230,255', 0.3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1 / (GROUND.x1 - GROUND.x0), 1 / (GROUND.z1 - GROUND.z0));
  return t;
}

/** Big honed limestone slabs (1.2 m) with fine joints. */
function paverTex(): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S);
  g.fillStyle = '#8a7a64';
  g.fillRect(0, 0, S, S);
  let s = 17;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const n = 2;
  const t = S / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const k = 0.9 + rnd() * 0.12;
      g.fillStyle = `rgb(${206 * k},${190 * k},${160 * k})`;
      g.fillRect(i * t + 2, j * t + 2, t - 4, t - 4);
      for (let p = 0; p < 90; p++) {
        g.fillStyle = `rgba(120,100,70,${0.04 + rnd() * 0.08})`;
        g.fillRect(i * t + rnd() * t, j * t + rnd() * t, 2 + rnd() * 14, 1 + rnd() * 3);
      }
    }
  const tex = toTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / 2.4, 1 / 2.4);
  return tex;
}

/** Granite setts for the driveway (fan-ish rows of small dark stones). */
function settsTex(): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S);
  g.fillStyle = '#26221e';
  g.fillRect(0, 0, S, S);
  let s = 29;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const rows = 16;
  const h = S / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * 30;
    while (x < S) {
      const w = 22 + rnd() * 16;
      const k = 0.75 + rnd() * 0.35;
      g.fillStyle = `rgb(${86 * k},${80 * k},${74 * k})`;
      g.fillRect(x + 1.5, r * h + 1.5, w - 3, h - 3);
      x += w;
    }
  }
  const tex = toTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / 3.2, 1 / 3.2);
  return tex;
}

/** The boulevard: asphalt with its lane lines (one tile 8 m along the road, the road's full width across). */
function roadTex(): THREE.CanvasTexture {
  const W = 256,
    H = 768;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#1c1c1f';
  g.fillRect(0, 0, W, H);
  let s = 5;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + rnd() * 0.04})`;
    g.fillRect(rnd() * W, rnd() * H, 2, 2);
  }
  const zy = (z: number) => ((z - BLVD.z0) / (BLVD.z1 - BLVD.z0)) * H;
  const dash = (z: number) => {
    g.fillStyle = 'rgba(235,235,225,0.75)';
    g.fillRect(0, zy(z) - 2, W * 0.4, 4);
  };
  dash((BLVD.west[0] + BLVD.west[1]) / 2);
  dash((BLVD.west[1] + BLVD.west[2]) / 2);
  dash((BLVD.east[0] + BLVD.east[1]) / 2);
  dash((BLVD.east[1] + BLVD.east[2]) / 2);
  g.fillStyle = 'rgba(240,190,60,0.8)';
  for (const z of [BLVD.median[0] - 0.4, BLVD.median[1] + 0.4]) g.fillRect(0, zy(z) - 2, W, 4);
  g.fillStyle = 'rgba(235,235,225,0.6)';
  for (const z of [BLVD.z0 + 0.4, BLVD.z1 - 0.4]) g.fillRect(0, zy(z) - 2, W, 3);
  const tex = toTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/** The road's light: a pool under every street lamp (one texture for the whole run). */
const ROAD = { x0: 150, x1: 450 };
function roadLight(): THREE.CanvasTexture {
  const W = 1024,
    H = 128;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'lighter';
  const sx = W / (ROAD.x1 - ROAD.x0),
    sz = H / (BLVD.z1 - BLVD.z0);
  for (let x = ROAD.x0 + 6; x < ROAD.x1; x += 24)
    for (const z of [BLVD.z0 + 1, BLVD.z1 - 1, (BLVD.median[0] + BLVD.median[1]) / 2]) {
      const cx = (x - ROAD.x0) * sx,
        cy = (z - BLVD.z0) * sz;
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, 11 * sx);
      grd.addColorStop(0, 'rgba(255,196,130,0.55)');
      grd.addColorStop(1, 'rgba(255,196,130,0)');
      g.fillStyle = grd;
      g.save();
      g.translate(cx, cy);
      g.scale(1, sz / sx);
      g.translate(-cx, -cy);
      g.fillRect(cx - 11 * sx, cy - 11 * sx, 22 * sx, 22 * sx);
      g.restore();
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The canopy's ceiling: coffers with a gilt edge (map) and a downlight in each (emissive). */
function cofferTex(lit: boolean): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  if (!lit) {
    g.fillStyle = '#e9dcc0';
    g.fillRect(0, 0, S, S);
    g.fillStyle = '#c8b48a';
    g.fillRect(0, 0, S, 14);
    g.fillRect(0, 0, 14, S);
    g.fillStyle = '#d4a94e';
    g.fillRect(14, 14, S - 14, 4);
    g.fillRect(14, 14, 4, S - 14);
    g.fillStyle = '#f4ead4';
    g.fillRect(40, 40, S - 66, S - 66);
  } else {
    g.fillStyle = '#000';
    g.fillRect(0, 0, S, S);
    const grd = g.createRadialGradient(S / 2 + 7, S / 2 + 7, 0, S / 2 + 7, S / 2 + 7, 100);
    grd.addColorStop(0, 'rgba(255,226,180,1)');
    grd.addColorStop(0.09, 'rgba(255,226,180,1)');
    grd.addColorStop(0.12, 'rgba(255,190,120,0.4)');
    grd.addColorStop(1, 'rgba(255,170,90,0.0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    // A warm cove line round the coffer.
    g.strokeStyle = 'rgba(255,200,130,0.35)';
    g.lineWidth = 5;
    g.strokeRect(42, 42, S - 70, S - 70);
  }
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 4, 1 / 4);
  return t;
}

/** Painted markings on the driveway: the bays and their numbers, TAXI on the curb lane, the crossings. */
function markingsTex(): THREE.CanvasTexture {
  const X0 = DRIVE.x0,
    X1 = DRIVE.x1,
    Z0 = DRIVE.z0,
    Z1 = DRIVE.z1;
  const W = 2048,
    H = Math.round((W * (Z1 - Z0)) / (X1 - X0));
  const [c, g] = canvas(W, H);
  g.clearRect(0, 0, W, H);
  const px = (x: number) => ((x - X0) / (X1 - X0)) * W;
  const py = (z: number) => ((z - Z0) / (Z1 - Z0)) * H;
  const s = W / (X1 - X0);
  g.strokeStyle = 'rgba(240,240,232,0.85)';
  g.lineWidth = 0.12 * s;
  // Rideshare bays: boxes with their numbers.
  BAYS.forEach((x, i) => {
    g.strokeRect(px(x - 2.95), py(CURB_LANE - 1.25), 5.9 * s, 2.5 * s);
    g.save();
    g.translate(px(x - 2.3), py(CURB_LANE));
    g.rotate(Math.PI / 2);
    g.fillStyle = 'rgba(240,240,232,0.85)';
    g.font = `bold ${Math.round(1.2 * s)}px Arial, Helvetica, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(i + 1), 0, 0);
    g.restore();
  });
  // TAXI along the line, a yellow curb stripe, the valet zone.
  g.fillStyle = 'rgba(245,200,60,0.85)';
  g.fillRect(px(TAXI_SLOTS[0] - 2.8), py(CURB_Z) , (TAXI_SLOTS[4] - TAXI_SLOTS[0] + 5.6) * s, 0.16 * s);
  g.save();
  g.translate(px(TAXI_SLOTS[0] - 2.9), py(CURB_LANE));
  g.rotate(-Math.PI / 2);
  g.font = `bold ${Math.round(0.9 * s)}px Arial, Helvetica, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('TAXI', 0, 0);
  g.restore();
  g.fillStyle = 'rgba(240,240,232,0.85)';
  g.save();
  g.translate(px(VALET_SPOT + 3.1), py(CURB_LANE));
  g.rotate(-Math.PI / 2);
  g.font = `bold ${Math.round(0.6 * s)}px Arial, Helvetica, sans-serif`;
  g.textAlign = 'center';
  g.fillText('VALET', 0, 0);
  g.restore();
  // The lane line.
  g.setLineDash([2 * s, 2 * s]);
  g.beginPath();
  g.moveTo(px(X0 + 2), py((CURB_LANE + 11.3) / 2 + 0.1));
  g.lineTo(px(X1 - 2), py((CURB_LANE + 11.3) / 2 + 0.1));
  g.lineWidth = 0.1 * s;
  g.strokeStyle = 'rgba(240,240,232,0.45)';
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A ground quad over [x0, x1] × [z0, z1] whose UVs are metres from the ground light's corner. */
function groundQuad(x0: number, x1: number, z0: number, z1: number, y = 0): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = [x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z1, x1, y, z0, x0, y, z0];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(18).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  const uv: number[] = [];
  for (let i = 0; i < 6; i++) uv.push(pos[i * 3] - GROUND.x0, GROUND.z1 - pos[i * 3 + 2]);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = 'Arial, Helvetica, sans-serif';

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export interface EntranceCast {
  doorman: Person | null;
  valets: Person[];
  guests: Map<number, Person>;
  people: Person[];
}

export interface EntranceArea {
  root: THREE.Group;
  traffic: Traffic;
  fleet: CarFleet;
  sound: EntranceSound;
  cast: EntranceCast | null;
  /** Seconds added to the wall clock (tests: fast-forward the driveway). */
  clockOffset: number;
  /** The shared clock (s). */
  now(): number;
  update(dt: number, feet: THREE.Vector3): void;
  populate(crowd: Crowd, budget: number): EntranceCast;
  /** Share car doors with friends (net session). */
  connect(net: { emit(k: string, d?: unknown): void; on(k: string, fn: (f: unknown, d: Record<string, unknown>) => void): void }): void;
  /** Open/close a car's door as a player (you). */
  toggleDoor(key: string): void;
}

export function buildEntrance(deps: {
  scene: THREE.Scene;
  q: Quality;
  m: Mats;
  interaction: Interaction;
  sound: Sound;
  player: Player;
  world: World;
  /** Where friends' feet are. */
  others: () => { x: number; z: number }[];
}): EntranceArea {
  const { scene, m, interaction, player, world } = deps;
  const root = new THREE.Group();
  root.name = 'entrance';
  scene.add(root);
  const b = new Batch();
  const signs = new SignAtlas();

  // --- Materials -------------------------------------------------------------------
  const light = groundLight();
  const lightOf = (tex: THREE.Texture) => {
    const t = tex.clone();
    t.needsUpdate = true;
    return t;
  };
  const paver = new THREE.MeshStandardMaterial({ map: paverTex(), roughness: 0.55, envMapIntensity: 0.6, lightMap: light, lightMapIntensity: 4.2 });
  const setts = new THREE.MeshStandardMaterial({ map: settsTex(), roughness: 0.6, envMapIntensity: 0.7, lightMap: lightOf(light), lightMapIntensity: 4.2 });
  const kerb = new THREE.MeshStandardMaterial({ color: 0xb8ab94, roughness: 0.7, emissive: 0x2a2016, emissiveIntensity: 0.35 });
  const soil = new THREE.MeshStandardMaterial({ color: 0x1c1a12, roughness: 1 });
  const hedge = new THREE.MeshStandardMaterial({ color: 0x23472a, roughness: 0.9, emissive: 0x0a1c0c, emissiveIntensity: 0.55 });
  const flowers = new THREE.MeshStandardMaterial({ color: 0xd4708a, roughness: 0.8, emissive: 0x3a1420, emissiveIntensity: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xcfe0ea, transparent: true, opacity: 0.16, roughness: 0.03, metalness: 0.6, envMapIntensity: 1.6, depthWrite: false, side: THREE.DoubleSide });
  const bronze = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, metalness: 0.9, roughness: 0.35, envMapIntensity: 1.2 });
  const blackMetal = new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0.6, roughness: 0.45 });
  const lantern = m.glow(0xffd8a0, 1.7);
  const led = m.glow(0xffd49a, 2.2);
  const facadeStone = m.stone;
  const water = new THREE.MeshStandardMaterial({ color: 0x0d2436, roughness: 0.04, metalness: 0.3, envMapIntensity: 1.8, emissive: 0x0a2a40, emissiveIntensity: 0.7 });

  // --- Ground: the sidewalk, the driveway and ramps, the island, the verge, the lot round it -------
  b.add(groundQuad(SIDEWALK.x0, SIDEWALK.x1, FACADE_Z, CURB_Z), paver);
  b.add(groundQuad(L.x0, L.x1, L.z0, FACADE_Z, 0.004), m.marble);
  b.add(groundQuad(DRIVE.x0 - 22, DRIVE.x1 + 22, CURB_Z, 22.6, -0.02), setts);
  // Curb: a stone edge along the driveway, ramps at its ends.
  b.box(kerb, (SIDEWALK.x0 + SIDEWALK.x1) / 2, 0.06, CURB_Z, SIDEWALK.x1 - SIDEWALK.x0, 0.16, 0.22);
  for (const x of [SIDEWALK.x0, SIDEWALK.x1]) b.box(kerb, x, 0.06, (FACADE_Z + CURB_Z) / 2, 0.22, 0.16, CURB_Z - FACADE_Z);
  // The planter island: a stone curb round a bed, hedges, flowers.
  {
    const I = ISLAND;
    const cx = (I.x0 + I.x1) / 2,
      cz = (I.z0 + I.z1) / 2;
    b.box(kerb, cx, 0.22, I.z0, I.x1 - I.x0, 0.44, 0.3);
    b.box(kerb, cx, 0.22, I.z1, I.x1 - I.x0, 0.44, 0.3);
    b.box(kerb, I.x0, 0.22, cz, 0.3, 0.44, I.z1 - I.z0);
    b.box(kerb, I.x1, 0.22, cz, 0.3, 0.44, I.z1 - I.z0);
    b.box(soil, cx, 0.36, cz, I.x1 - I.x0 - 0.3, 0.02, I.z1 - I.z0 - 0.3);
    for (const [x0, x1] of [
      [I.x0 + 0.6, FOUNTAIN.x - FOUNTAIN.r - 0.8],
      [FOUNTAIN.x + FOUNTAIN.r + 0.8, I.x1 - 0.6],
    ]) {
      b.box(hedge, (x0 + x1) / 2, 0.7, I.z0 + 0.65, x1 - x0, 0.6, 0.55);
      b.box(hedge, (x0 + x1) / 2, 0.7, I.z1 - 0.65, x1 - x0, 0.6, 0.55);
      b.box(flowers, (x0 + x1) / 2, 0.48, cz, x1 - x0 - 0.6, 0.2, 1.6);
    }
  }
  // Verge: hedges along the boulevard (gaps for the ramps), a sidewalk, the boulevard itself.
  b.box(hedge, 300, 0.55, 20.1, 64, 1.1, 1.0);
  b.box(soil, 300, -0.005, 20.1, 66, 0.01, 2.6);
  b.add(groundQuad(ROAD.x0, ROAD.x1, BLVD.walk[0], BLVD.walk[1], -0.01), paver);
  {
    const road = new THREE.MeshStandardMaterial({ map: roadTex(), roughness: 0.85, envMapIntensity: 0.4, lightMap: roadLight(), lightMapIntensity: 3.2 });
    const g = new THREE.PlaneGeometry(ROAD.x1 - ROAD.x0, BLVD.z1 - BLVD.z0).rotateX(-Math.PI / 2);
    // u: one tile per 8 m along the road; v: across it (the light map spans the whole run).
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + (ROAD.x1 - ROAD.x0) / 2) / 8, 1 - (pos.getZ(i) + (BLVD.z1 - BLVD.z0) / 2) / (BLVD.z1 - BLVD.z0));
    (road.lightMap as THREE.Texture).repeat.set(8 / (ROAD.x1 - ROAD.x0), 1);
    b.add(g, road, M((ROAD.x0 + ROAD.x1) / 2, -0.03, (BLVD.z0 + BLVD.z1) / 2));
    b.box(kerb, 300, 0.06, (BLVD.median[0] + BLVD.median[1]) / 2, ROAD.x1 - ROAD.x0, 0.14, BLVD.median[1] - BLVD.median[0]);
    b.box(hedge, 300, 0.3, (BLVD.median[0] + BLVD.median[1]) / 2, ROAD.x1 - ROAD.x0 - 2, 0.35, 1.6);
    b.add(groundQuad(ROAD.x0, ROAD.x1, BLVD.z1, BLVD.z1 + 5, -0.01), paver);
  }
  // A dark lot under everything else nearby (the city's own ground starts further out).
  b.add(new THREE.PlaneGeometry(420, 120).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0c0b0a, roughness: 1 }), M(300, -0.06, 15));
  // Painted markings.
  {
    const mk = new THREE.Mesh(
      new THREE.PlaneGeometry(DRIVE.x1 - DRIVE.x0, DRIVE.z1 - DRIVE.z0).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: markingsTex(), transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, emissive: 0x302820, emissiveIntensity: 0.6, emissiveMap: null }),
    );
    mk.position.set((DRIVE.x0 + DRIVE.x1) / 2, -0.012, (DRIVE.z0 + DRIVE.z1) / 2);
    mk.raycast = () => {};
    mk.renderOrder = 1;
    root.add(mk);
  }

  // --- The lobby inside ------------------------------------------------------------------
  {
    const cx = (L.x0 + L.x1) / 2,
      cz = (L.z0 + L.z1) / 2;
    const w = L.x1 - L.x0,
      d = L.z1 - L.z0;
    b.add(new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2), m.cream, M(cx, L.h, cz));
    // A coffered ceiling field with a glowing cove, and the chandelier.
    b.box(m.glowWarm, cx, L.h - 0.02, cz, w - 1.2, 0.01, d - 1.2);
    b.box(m.cream, cx, L.h - 0.16, cz, w - 3, 0.12, d - 3);
    chandelier(b, root, m, ENT_X, L.h - 0.9, -4.4, 1.6);
    // Walls: the back (north) with a gilt-framed mural panel, the west marble, the east round the cars.
    b.add(wallQuad(w, L.h), m.silk, M(cx, L.h / 2, L.z0));
    b.box(m.gold, cx, 2.2, L.z0 + 0.03, 6.2, 2.6, 0.04);
    b.box(new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.6, emissive: 0x2a1a0c, emissiveIntensity: 0.6 }), cx, 2.2, L.z0 + 0.06, 5.9, 2.3, 0.02);
    b.add(wallQuad(d, L.h), m.marbleWall, M(L.x0, L.h / 2, cz, Math.PI / 2));
    const eastSeg = (z0: number, z1: number, y0: number, y1: number) => b.add(wallQuad(z1 - z0, y1 - y0), m.silk, M(L.x1, (y0 + y1) / 2, (z0 + z1) / 2, -Math.PI / 2));
    const [za, zb] = ENT_CARS.zs;
    eastSeg(L.z0, za - 0.83, 0, L.h);
    eastSeg(za + 0.83, zb - 0.83, 0, L.h);
    eastSeg(zb + 0.83, FACADE_Z, 0, L.h);
    for (const z of ENT_CARS.zs) eastSeg(z - 0.83, z + 0.83, 2.6, L.h);
    // Behind the east wall: closed in (seen from the cabs' doors) and up to the podium.
    b.box(m.darkMarble, L.x1 + 2.7, L.h / 2, (L.z0 + FACADE_Z) / 2, 0.2, L.h, d);
    for (const x of [L.x0, L.x1])
      b.box(m.walnut, x + (x < cx ? 0.06 : -0.06), 0.08, cz, 0.12, 0.16, d);
    b.box(m.walnut, cx, 0.08, L.z0 + 0.06, w, 0.16, 0.12);
    // Console and flowers on the west wall, a great urn of flowers in the middle.
    b.box(m.walnut, 289.65, 0.42, -4.4, 0.5, 0.06, 2.1);
    b.box(m.gold, 289.65, 0.2, -4.4, 0.4, 0.4, 1.9);
    b.add(new THREE.LatheGeometry([[0, 0], [0.45, 0], [0.6, 0.25], [0.5, 0.7], [0.65, 0.9], [0, 0.9]].map(([r, y]) => new THREE.Vector2(r, y)), 20), m.darkMarble, M(LOBBY_URN.x, 0, LOBBY_URN.z));
    // An arrangement: greenery, then blooms in white, blush and deep red heaped round a dome.
    b.add(new THREE.SphereGeometry(0.62, 12, 8).scale(1, 0.6, 1), hedge, M(LOBBY_URN.x, 1.05, LOBBY_URN.z));
    const blooms = [flowers, new THREE.MeshStandardMaterial({ color: 0xf4eee4, roughness: 0.7, emissive: 0x3a3428, emissiveIntensity: 0.5 }), new THREE.MeshStandardMaterial({ color: 0x8a1022, roughness: 0.7, emissive: 0x2a0408, emissiveIntensity: 0.5 })];
    const bloom = new THREE.IcosahedronGeometry(0.095, 1);
    for (let k = 0; k < 64; k++) {
      const a = k * 2.399,
        r = 0.62 * Math.sqrt((k + 0.5) / 64);
      const y = 1.12 + Math.sqrt(Math.max(0, 0.42 - r * r)) * 0.75;
      b.add(bloom, blooms[k % 3], M(LOBBY_URN.x + Math.cos(a) * r, y, LOBBY_URN.z + Math.sin(a) * r, 0, 0.8 + (k % 4) * 0.12));
    }
    // Sign over the lifts.
    signs.add(3.2, 0.36, 640, 72, M(L.x1 - 0.04, 3.1, (ENT_CARS.zs[0] + ENT_CARS.zs[1]) / 2, -Math.PI / 2), (g, w2, h2) => {
      g.fillStyle = '#1a120a';
      g.fillRect(0, 0, w2, h2);
      g.fillStyle = '#e8c878';
      g.font = `italic 600 40px ${SERIF}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('Elevators  ·  Casino · Pool · Promenade · Suites', w2 / 2, h2 / 2 + 2);
    });
  }

  // --- The facade: glass in front of the lobby, stone either side, the podium's upper floors -------
  {
    const glassSeg = (x0: number, x1: number, y0: number, y1: number) => {
      b.add(new THREE.PlaneGeometry(x1 - x0, y1 - y0), glass, M((x0 + x1) / 2, (y0 + y1) / 2, FACADE_Z));
    };
    const doorH = 2.7;
    const segs: [number, number][] = [
      [L.x0, SLIDE_DOORS[0].x - SLIDE_DOORS[0].half],
      [SLIDE_DOORS[0].x + SLIDE_DOORS[0].half, REVOLVING.x - REVOLVING.r],
      [REVOLVING.x + REVOLVING.r, SLIDE_DOORS[1].x - SLIDE_DOORS[1].half],
      [SLIDE_DOORS[1].x + SLIDE_DOORS[1].half, L.x1],
    ];
    for (const [x0, x1] of segs) glassSeg(x0, x1, 0, doorH + 0.1);
    glassSeg(L.x0, L.x1, doorH + 0.1, L.h + 0.4);
    // Gilt mullions and the transom.
    for (let x = L.x0; x <= L.x1 + 0.01; x += 1.5) b.box(bronze, x, (L.h + 0.4) / 2, FACADE_Z, 0.08, L.h + 0.4, 0.14);
    b.box(bronze, (L.x0 + L.x1) / 2, doorH + 0.1, FACADE_Z, L.x1 - L.x0, 0.12, 0.18);
    // Stone either side and above (the podium), with pilasters and a cornice.
    const H = 12;
    b.add(wallQuad(L.x0 - SIDEWALK.x0 + 4, H), facadeStone, M((SIDEWALK.x0 - 4 + L.x0) / 2, H / 2, FACADE_Z));
    b.add(wallQuad(SIDEWALK.x1 + 4 - L.x1, H), facadeStone, M((L.x1 + SIDEWALK.x1 + 4) / 2, H / 2, FACADE_Z));
    b.add(wallQuad(L.x1 - L.x0, H - L.h - 0.4), facadeStone, M((L.x0 + L.x1) / 2, (L.h + 0.4 + H) / 2, FACADE_Z));
    for (let x = SIDEWALK.x0 - 2; x <= SIDEWALK.x1 + 2; x += 6) {
      if (x > L.x0 - 0.5 && x < L.x1 + 0.5) continue;
      b.box(facadeStone, x, H / 2, FACADE_Z + 0.2, 0.9, H, 0.4);
      b.box(m.gold, x, 0.5, FACADE_Z + 0.42, 0.95, 0.06, 0.05);
    }
    b.box(m.cream, 300, H + 0.25, FACADE_Z + 0.3, SIDEWALK.x1 - SIDEWALK.x0 + 8, 0.5, 0.8);
    b.box(facadeStone, 300, H / 2, -16, SIDEWALK.x1 - SIDEWALK.x0 + 8, H, 32);
    // Lit windows on the podium's upper floor (above the canopy) and shop windows either side below.
    for (let x = SIDEWALK.x0 + 1; x < SIDEWALK.x1 - 1; x += 3) b.box(m.glow(0xffcf8a, 0.7), x, 9.4, FACADE_Z + 0.03, 1.7, 1.9, 0.02);
    for (const [x0, x1] of [
      [SIDEWALK.x0 + 1, L.x0 - 4],
      [L.x1 + 4, SIDEWALK.x1 - 1],
    ])
      for (let x = x0; x < x1 - 1; x += 6) {
        b.box(m.glow(0xffd8a8, 0.9), x + 2.5, 2.4, FACADE_Z + 0.02, 3.6, 3.2, 0.02);
        b.box(bronze, x + 2.5, 4.1, FACADE_Z + 0.05, 3.8, 0.14, 0.08);
      }
    // The name over the doors (lit gold on dark).
    signs.add(9, 0.95, 1400, 148, M(ENT_X, 4.4, FACADE_Z + 0.06), (g, w2, h2) => {
      g.fillStyle = '#0e0a06';
      g.fillRect(0, 0, w2, h2);
      g.strokeStyle = '#c9a050';
      g.lineWidth = 6;
      g.strokeRect(5, 5, w2 - 10, h2 - 10);
      g.fillStyle = '#f0d38a';
      g.font = `600 104px ${SERIF}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('P A L A Z Z O   L A G O', w2 / 2, h2 / 2 + 6);
    });
  }

  // --- The revolving door (it turns) and the sliding doors ---------------------------------------
  const revolve = new THREE.Group();
  {
    const R = REVOLVING.r,
      H = 2.7;
    const drum = new Batch();
    const arc = (a0: number, a1: number) => new THREE.CylinderGeometry(R, R, H, 24, 1, true, a0, a1 - a0);
    // Glass drum walls on the two sides (open to the lobby and to the street).
    drum.add(arc(Math.PI * 0.18, Math.PI * 0.82), glass, M(0, H / 2, 0));
    drum.add(arc(Math.PI * 1.18, Math.PI * 1.82), glass, M(0, H / 2, 0));
    drum.add(new THREE.CylinderGeometry(R + 0.1, R + 0.1, 0.35, 32), m.gold, M(0, H + 0.17, 0));
    drum.add(new THREE.CylinderGeometry(R, R, 0.02, 32), m.darkMarble, M(0, 0.01, 0));
    drum.build(root, 'revolving-drum').position.set(REVOLVING.x, 0, FACADE_Z);
    const wings = new Batch();
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      wings.add(new THREE.PlaneGeometry(R - 0.12, H - 0.15), glass, M(Math.cos(a) * (R / 2), H / 2, -Math.sin(a) * (R / 2), a));
      wings.add(new THREE.BoxGeometry(R - 0.1, 0.06, 0.05), m.gold, M(Math.cos(a) * (R / 2), 1.0, -Math.sin(a) * (R / 2), a));
    }
    wings.add(new THREE.CylinderGeometry(0.06, 0.06, H, 8), m.gold, M(0, H / 2, 0));
    wings.build(revolve, 'revolving-wings');
    revolve.position.set(REVOLVING.x, 0, FACADE_Z);
    root.add(revolve);
  }
  const slidePanels = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 2.62, 0.03), glass, 4);
  const slideFrames = new THREE.InstancedMesh(mergeGeometries([new THREE.BoxGeometry(1.0, 0.06, 0.05).translate(0, 1.28, 0), new THREE.BoxGeometry(1.0, 0.06, 0.05).translate(0, -1.28, 0), new THREE.BoxGeometry(0.05, 2.6, 0.05).translate(0.48, 0, 0), new THREE.BoxGeometry(0.05, 2.6, 0.05).translate(-0.48, 0, 0)])!, bronze, 4);
  for (const x of [slidePanels, slideFrames]) {
    x.raycast = () => {};
    x.frustumCulled = false;
    root.add(x);
  }
  const slideOpen = SLIDE_DOORS.map(() => 0);
  const placeSlides = () => {
    const t = new THREE.Object3D();
    SLIDE_DOORS.forEach((d, i) => {
      for (const s of [-1, 1]) {
        t.position.set(d.x + s * (d.half / 2 + slideOpen[i] * (d.half - 0.08)), 1.35, FACADE_Z + (s > 0 ? 0.03 : -0.03));
        t.updateMatrix();
        slidePanels.setMatrixAt(i * 2 + (s > 0 ? 1 : 0), t.matrix);
        slideFrames.setMatrixAt(i * 2 + (s > 0 ? 1 : 0), t.matrix);
      }
    });
    slidePanels.instanceMatrix.needsUpdate = slideFrames.instanceMatrix.needsUpdate = true;
  };
  placeSlides();

  // --- The porte-cochère: canopy, columns, uplights -----------------------------------------------
  {
    const C = CANOPY;
    const cx = (C.x0 + C.x1) / 2,
      cz = (C.z0 + C.z1) / 2;
    const w = C.x1 - C.x0,
      d = C.z1 - C.z0;
    const ceil = new THREE.MeshStandardMaterial({ map: cofferTex(false), emissiveMap: cofferTex(true), emissive: 0xffffff, emissiveIntensity: 1.25, roughness: 0.7 });
    const g = new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d);
    b.add(g, ceil, M(cx, C.h, cz));
    // The roof slab and its deep gilded fascia with an LED line under the lip.
    b.box(m.cream, cx, C.h + 0.75, cz, w + 0.4, 0.3, d + 0.2);
    for (const [x, z, sx, sz] of [
      [cx, C.z1, w + 0.6, 0.3],
      [C.x0, cz, 0.3, d],
      [C.x1, cz, 0.3, d],
    ] as const) {
      b.box(m.gold, x, C.h + 0.45, z, sx, 1.1, sz);
      b.box(led, x, C.h - 0.13, z, sx === 0.3 ? 0.06 : sx - 0.2, 0.04, sz === 0.3 ? 0.06 : sz - 0.2);
    }
    b.box(m.darkMarble, cx, C.h + 0.45, C.z1 + 0.16, w + 0.6, 0.55, 0.02);
    // The name on the fascia, toward the boulevard and toward the doors.
    for (const [z, ry] of [
      [C.z1 + 0.17, 0],
      [C.z1 - 0.17, Math.PI],
    ] as const)
      signs.add(12, 0.62, 1600, 84, M(ENT_X, C.h + 0.45, z, ry), (gg, w2, h2) => {
        gg.clearRect(0, 0, w2, h2);
        gg.fillStyle = '#f6dc98';
        gg.shadowColor = 'rgba(255,200,120,0.9)';
        gg.shadowBlur = 12;
        gg.font = `600 70px ${SERIF}`;
        gg.textAlign = 'center';
        gg.textBaseline = 'middle';
        gg.fillText('P A L A Z Z O   L A G O', w2 / 2, h2 / 2 + 4);
      });
    // Columns: gilded shafts on dark marble plinths with capitals, an uplight washing each.
    for (const [x, z] of COLUMNS) {
      b.box(m.darkMarble, x, 0.55, z, 1.0, 0.7, 1.0);
      b.add(new THREE.CylinderGeometry(0.4, 0.44, C.h - 1.3, 20), m.gold, M(x, 0.9 + (C.h - 1.3) / 2, z));
      b.add(new THREE.CylinderGeometry(0.62, 0.42, 0.45, 20), m.gold, M(x, C.h - 0.2, z));
      for (const [dx, dz] of [
        [0, -0.52],
        [0, 0.52],
      ]) {
        b.box(lantern, x + dx, 0.92, z + dz, 0.22, 0.04, 0.1);
        b.add(new THREE.PlaneGeometry(1.3, 4.4), m.halo, M(x + dx, 2.6, z + dz * 1.12, dz < 0 ? Math.PI : 0));
      }
    }
  }

  // --- The fountain on the island -------------------------------------------------------------
  const spray = new THREE.Group();
  {
    const F = FOUNTAIN;
    b.add(new THREE.LatheGeometry([[0, 0.38], [F.r, 0.38], [F.r + 0.1, 0.4], [F.r + 0.22, 0.9], [F.r - 0.05, 0.92], [F.r - 0.1, 0.7], [0, 0.7]].map(([r, y]) => new THREE.Vector2(r, y)), 40), m.marble, M(F.x, 0, F.z));
    b.add(new THREE.CircleGeometry(F.r - 0.1, 40).rotateX(-Math.PI / 2), water, M(F.x, 0.78, F.z));
    // A two-tier centre: shaft, a bowl, a smaller bowl, a finial.
    b.add(new THREE.CylinderGeometry(0.2, 0.32, 1.5, 16), m.marble, M(F.x, 1.4, F.z));
    b.add(new THREE.LatheGeometry([[0, 0], [1.1, 0.18], [1.15, 0.3], [1.0, 0.26], [0, 0.12]].map(([r, y]) => new THREE.Vector2(r, y)), 28), m.gold, M(F.x, 2.05, F.z));
    b.add(new THREE.CylinderGeometry(0.12, 0.18, 0.8, 12), m.marble, M(F.x, 2.6, F.z));
    b.add(new THREE.LatheGeometry([[0, 0], [0.55, 0.12], [0.58, 0.2], [0.5, 0.17], [0, 0.08]].map(([r, y]) => new THREE.Vector2(r, y)), 24), m.gold, M(F.x, 2.95, F.z));
    b.add(new THREE.SphereGeometry(0.1, 10, 8), m.gold, M(F.x, 3.2, F.z));
    // Lights in the basin.
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      b.box(m.glow(0xcfe6ff, 2), F.x + Math.cos(a) * (F.r - 0.4), 0.8, F.z + Math.sin(a) * (F.r - 0.4), 0.14, 0.02, 0.14);
    }
    // Water: a sheet off each bowl and a jet at the top (scrolling streaks, additive).
    const [c, g] = canvas(64, 256);
    g.clearRect(0, 0, 64, 256);
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(220,240,255,${0.15 + Math.random() * 0.35})`;
      g.fillRect(Math.random() * 64, Math.random() * 256, 1 + Math.random() * 2, 20 + Math.random() * 60);
    }
    const streak = new THREE.CanvasTexture(c);
    streak.wrapS = streak.wrapT = THREE.RepeatWrapping;
    streak.repeat.set(4, 1);
    const sm = new THREE.MeshBasicMaterial({ map: streak, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: 0x9fc8e8, toneMapped: false });
    const sheets = mergeGeometries([
      new THREE.CylinderGeometry(1.15, 1.32, 1.3, 28, 1, true).translate(0, 1.6, 0),
      new THREE.CylinderGeometry(0.58, 0.7, 0.75, 20, 1, true).translate(0, 2.55, 0),
      new THREE.ConeGeometry(0.22, 1.2, 10, 1, true).rotateX(Math.PI).translate(0, 3.8, 0),
    ])!;
    const mesh = new THREE.Mesh(sheets, sm);
    mesh.raycast = () => {};
    spray.add(mesh);
    spray.position.set(F.x, 0, F.z);
    spray.userData.tex = streak;
    root.add(spray);
  }

  // --- Things on the sidewalk -----------------------------------------------------------------
  {
    // The valet stand: a walnut podium with a brass top and a lamp.
    const P2 = PODIUM;
    b.box(m.walnut, P2.x, 0.55, P2.z, P2.w, 1.1, P2.d);
    b.box(m.gold, P2.x, 1.12, P2.z, P2.w + 0.06, 0.04, P2.d + 0.06);
    b.box(lantern, P2.x + 0.3, 1.24, P2.z - 0.1, 0.08, 0.2, 0.08);
    signs.add(0.7, 0.22, 280, 88, M(P2.x, 0.82, P2.z + P2.d / 2 + 0.005), (g, w2, h2) => {
      g.fillStyle = '#1a0e06';
      g.fillRect(0, 0, w2, h2);
      g.fillStyle = '#e8c878';
      g.font = `600 52px ${SERIF}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('VALET', w2 / 2, h2 / 2 + 3);
    });
    // Bell carts: a red-carpeted deck, brass uprights and arch, bags piled on.
    const bags = [0x2a1a12, 0x5a1a20, 0x1a2a44, 0xb89a6a, 0x3a3a3c, 0x7a5030];
    for (const [x, z, yaw] of CARTS) {
      const cm = (lx: number, ly: number, lz: number) => M(x + lx * Math.cos(yaw) + lz * Math.sin(yaw), ly, z - lx * Math.sin(yaw) + lz * Math.cos(yaw), yaw);
      b.add(new THREE.BoxGeometry(1.2, 0.06, 0.66), new THREE.MeshStandardMaterial({ color: 0x6a1018, roughness: 0.9 }), cm(0, 0.22, 0));
      for (const lx of [-0.56, 0.56]) {
        b.add(new THREE.CylinderGeometry(0.02, 0.02, 1.7, 8), m.gold, cm(lx, 1.05, 0));
        for (const lz of [-0.28, 0.28]) b.add(new THREE.SphereGeometry(0.06, 8, 6), blackMetal, cm(lx, 0.07, lz));
      }
      b.add(new THREE.TorusGeometry(0.56, 0.02, 6, 20, Math.PI), m.gold, cm(0, 1.9, 0));
      b.add(new THREE.CylinderGeometry(0.018, 0.018, 1.12, 6).rotateZ(Math.PI / 2), m.gold, cm(0, 1.45, 0));
      let k = Math.round(x);
      const pile: [number, number, number, number, number][] = [
        [-0.25, 0.48, 0.55, 0.42, 0.24],
        [0.28, 0.45, 0.48, 0.36, 0.22],
        [-0.2, 0.82, 0.5, 0.26, 0.34],
        [0.25, 0.76, 0.4, 0.22, 0.3],
      ];
      for (const [lx, ly, sx, sy, sz] of pile) {
        const bag = new THREE.MeshStandardMaterial({ color: bags[k++ % bags.length], roughness: 0.6 });
        b.add(new THREE.BoxGeometry(sx, sy, sz), bag, cm(lx, ly, 0));
      }
    }
    // Benches (rideshare waiting), an ash urn for the smokers.
    for (const [x, z] of BENCHES) {
      b.box(m.walnut, x, 0.45, z, 1.8, 0.06, 0.5);
      b.box(m.walnut, x, 0.75, z - 0.22, 1.8, 0.5, 0.05);
      for (const dx of [-0.8, 0.8]) b.box(blackMetal, x + dx, 0.22, z, 0.06, 0.44, 0.5);
    }
    b.add(new THREE.CylinderGeometry(0.2, 0.22, 0.75, 14), blackMetal, M(URN.x, 0.375, URN.z));
    b.add(new THREE.CylinderGeometry(0.21, 0.21, 0.03, 14), m.gold, M(URN.x, 0.76, URN.z));
    // Stanchions with red velvet ropes round the taxi queue.
    for (const [x, z] of STANCHIONS) {
      b.add(new THREE.CylinderGeometry(0.03, 0.03, 0.95, 8), m.gold, M(x, 0.48, z));
      b.add(new THREE.CylinderGeometry(0.14, 0.16, 0.04, 14), m.gold, M(x, 0.02, z));
      b.add(new THREE.SphereGeometry(0.05, 8, 6), m.gold, M(x, 0.97, z));
    }
    const rope = new THREE.MeshStandardMaterial({ color: 0x8a0e18, roughness: 0.8, emissive: 0x200204, emissiveIntensity: 0.5 });
    for (const [row, list] of [
      [4.25, STANCHIONS.filter(([, z]) => z < 5)],
      [5.6, STANCHIONS.filter(([, z]) => z > 5)],
    ] as const)
      for (let i = 0; i + 1 < list.length; i++) {
        const [x0] = list[i],
          [x1] = list[i + 1];
        const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x0, 0.88, row), new THREE.Vector3((x0 + x1) / 2, 0.68, row), new THREE.Vector3(x1, 0.88, row));
        b.add(new THREE.TubeGeometry(curve, 8, 0.022, 5, false), rope);
      }
    // Signs on posts: the taxi stand, rideshare pickup, the bay numbers.
    const post = (x: number, z: number, h: number) => {
      b.add(new THREE.CylinderGeometry(0.045, 0.05, h, 8), blackMetal, M(x, h / 2, z));
      b.add(new THREE.CylinderGeometry(0.16, 0.18, 0.05, 12), blackMetal, M(x, 0.025, z));
    };
    post(TAXI_SIGN.x, TAXI_SIGN.z, 2.9);
    b.box(blackMetal, TAXI_SIGN.x, 2.55, TAXI_SIGN.z, 0.9, 0.62, 0.12);
    for (const [dz, ry] of [
      [0.065, 0],
      [-0.065, Math.PI],
    ] as const)
      signs.add(0.84, 0.56, 300, 200, M(TAXI_SIGN.x, 2.55, TAXI_SIGN.z + dz, ry), (g, w2, h2) => {
        g.fillStyle = '#f5c518';
        g.fillRect(0, 0, w2, h2);
        g.fillStyle = '#111';
        g.font = `bold 96px ${SANS}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('TAXI', w2 / 2, h2 * 0.42);
        g.font = `bold 30px ${SANS}`;
        g.fillText('QUEUE HERE  ▸', w2 / 2, h2 * 0.8);
      });
    post(RIDE_SIGN.x, RIDE_SIGN.z, 2.9);
    b.box(blackMetal, RIDE_SIGN.x, 2.45, RIDE_SIGN.z, 1.3, 0.82, 0.12);
    for (const [dz, ry] of [
      [0.065, 0],
      [-0.065, Math.PI],
    ] as const)
      signs.add(1.24, 0.76, 420, 258, M(RIDE_SIGN.x, 2.45, RIDE_SIGN.z + dz, ry), (g, w2, h2) => {
        g.fillStyle = '#0d1a24';
        g.fillRect(0, 0, w2, h2);
        g.strokeStyle = '#9fd8ff';
        g.lineWidth = 5;
        g.strokeRect(6, 6, w2 - 12, h2 - 12);
        g.fillStyle = '#eaf6ff';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = `bold 62px ${SANS}`;
        g.fillText('RIDESHARE', w2 / 2, h2 * 0.3);
        g.font = `bold 52px ${SANS}`;
        g.fillText('PICKUP', w2 / 2, h2 * 0.54);
        g.font = `30px ${SANS}`;
        g.fillStyle = '#9fd8ff';
        g.fillText('◂  Bays 1 – 3', w2 / 2, h2 * 0.8);
      });
    BAY_POSTS.forEach((p2, i) => {
      post(p2.x, p2.z, 1.7);
      b.box(blackMetal, p2.x, 1.55, p2.z, 0.42, 0.42, 0.08);
      for (const [dz, ry] of [
        [0.045, 0],
        [-0.045, Math.PI],
      ] as const)
        signs.add(0.38, 0.38, 128, 128, M(p2.x, 1.55, p2.z + dz, ry), (g, w2, h2) => {
          g.fillStyle = '#eaf6ff';
          g.fillRect(0, 0, w2, h2);
          g.fillStyle = '#0d1a24';
          g.font = `bold 24px ${SANS}`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText('BAY', w2 / 2, h2 * 0.22);
          g.font = `bold 78px ${SANS}`;
          g.fillText(String(i + 1), w2 / 2, h2 * 0.64);
        });
    });
    // Lamp posts: black poles with lanterns.
    for (const [x, z] of LAMPS) {
      post(x, z, 4.2);
      b.add(new THREE.CylinderGeometry(0.2, 0.14, 0.5, 6), lantern, M(x, 4.45, z));
      b.add(new THREE.ConeGeometry(0.28, 0.25, 6), blackMetal, M(x, 4.82, z));
    }
  }

  // --- The boulevard: street lamps, its own traffic, and the city ---------------------------------
  {
    for (let x = ROAD.x0 + 6; x < ROAD.x1; x += 24)
      for (const [z, arm] of [
        [BLVD.z0 + 0.3, 1],
        [BLVD.z1 - 0.3, -1],
        [(BLVD.median[0] + BLVD.median[1]) / 2, 0],
      ] as const) {
        b.add(new THREE.CylinderGeometry(0.09, 0.13, 8.5, 6), blackMetal, M(x, 4.25, z));
        const heads = arm === 0 ? [-1, 1] : [arm];
        for (const s of heads) {
          b.box(blackMetal, x, 8.4, z + s * 1.1, 0.08, 0.08, 2.2);
          b.box(lantern, x, 8.3, z + s * 2.1, 0.5, 0.08, 0.26);
        }
      }
  }
  const traffic3 = streetTraffic();
  root.add(traffic3.mesh);
  const city: City = buildCity({ ground: -0.08, layout: 'strip', center: new THREE.Vector2(300, 0), seed: 41, hazeNear: 70, hazeFar: 380, name: 'skyline-entrance' });
  root.add(city.group);
  const sky = nightSky(390);
  sky.position.set(300, 0, 10);
  root.add(sky);

  // --- Palms: on the island, the median, in pots by the doors (two draws for all) ---------------
  {
    const spots: [number, number, number, number][] = [];
    for (const x of [279, 285, 311, 321]) spots.push([x, 15.85, 0.36, 1.0]);
    for (let x = ROAD.x0 + 18; x < ROAD.x1; x += 12) spots.push([x, (BLVD.median[0] + BLVD.median[1]) / 2, 0.1, 1.15]);
    for (let x = 262; x < 340; x += 9) if (x < 266 || x > 334 || Math.abs(x - 300) > 4) spots.push([x, 21.6, 0, 0.9]);
    for (const [x, z] of POTS) spots.push([x, z, 0.78, 0.45]);
    const { trunk, crown } = palmGeometry();
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6a5238, roughness: 0.9, emissive: 0x1a120a, emissiveIntensity: 0.6 });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x2f6a34, roughness: 0.8, side: THREE.DoubleSide, emissive: 0x0c2a10, emissiveIntensity: 0.8 });
    const trunks = new THREE.InstancedMesh(trunk, trunkMat, spots.length);
    const crowns = new THREE.InstancedMesh(crown, crownMat, spots.length);
    const t = new THREE.Object3D();
    spots.forEach(([x, z, y, s], i) => {
      t.position.set(x, y, z);
      t.rotation.set(0, i * 1.7, 0);
      t.scale.setScalar(s * (0.92 + ((i * 37) % 10) / 40));
      t.updateMatrix();
      trunks.setMatrixAt(i, t.matrix);
      crowns.setMatrixAt(i, t.matrix);
    });
    trunks.raycast = crowns.raycast = () => {};
    root.add(trunks, crowns);
    for (const [x, z] of POTS) b.add(new THREE.LatheGeometry([[0, 0], [0.36, 0], [0.42, 0.12], [0.34, 0.3], [0.46, 0.7], [0.5, 0.8], [0, 0.8]].map(([r, y]) => new THREE.Vector2(r, y)), 18), m.stone, M(x, 0, z));
  }

  b.build(root, 'entrance-static');
  signs.build(root, 'entrance-signs');

  // --- Cars and the schedule --------------------------------------------------------------------
  const fleet = new CarFleet();
  root.add(fleet.group);
  const area: EntranceArea = {
    root,
    traffic: null as unknown as Traffic,
    fleet,
    sound: new EntranceSound(deps.sound, root),
    cast: null,
    clockOffset: 0,
    now: () => Date.now() / 1000 + area.clockOffset,
    update: () => {},
    populate: () => ({ doorman: null, valets: [], guests: new Map(), people: [] }),
    connect: () => {},
    toggleDoor: () => {},
  };
  area.traffic = new Traffic(area.now());
  const traffic = area.traffic;

  // Each car on the driveway: a box you can't walk through (soft with its door open, so you can get
  // in), its back seat (walk in and you sit), and something to click to open its door.
  const boxes: Box[] = [];
  const seats: Seat[] = [];
  for (let i = 0; i < 16; i++) {
    boxes.push(world.addBox(1e6, 1e6, 0, 0, 0, 'car'));
    // (Low: your eyes go to a seated height under the roof.)
    seats.push(world.addSeat(1e6, 1e6, -1, 0.3, 0, 'car seat'));
  }
  const proxies = new Map<string, { mesh: THREE.Mesh; item: Interactable; car: SimCar }>();
  const proxyGeo = new THREE.BoxGeometry(CAR.wid + 0.1, 1.5, CAR.len);
  proxyGeo.translate(0, 0.75, 0);
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const near = (car: SimCar, p: { x: number; z: number }, grow: number) => {
    const pose = traffic.carPose(car, area.now());
    const dx = p.x - pose.x,
      dz = p.z - pose.z;
    const c = Math.cos(pose.yaw),
      s = Math.sin(pose.yaw);
    const lx = dx * c - dz * s,
      lz = dx * s + dz * c;
    return Math.abs(lx) < CAR.wid / 2 + grow && Math.abs(lz) < CAR.len / 2 + grow;
  };
  /** Someone's in it (you or a friend), or a player has its door open: it stays. */
  const held = (car: SimCar) => {
    if (car.playerDoor) return true;
    const ps = [player.feet(), ...deps.others()];
    return ps.some((p) => near(car, p, 0.15));
  };
  let net: Parameters<EntranceArea['connect']>[0] | null = null;
  area.toggleDoor = (key: string) => {
    const car = traffic.here.find((c) => c.key === key);
    if (!car || car.motion) return;
    car.playerDoor = car.playerDoor ? 0 : 1;
    net?.emit('valet', { k: key, o: car.playerDoor });
    area.sound.door(car.playerDoor ? 'open' : 'close', traffic.carPose(car, area.now()));
  };
  area.connect = (n) => {
    net = n;
    n.on('valet', (_f, d) => {
      const car = traffic.here.find((c) => c.key === String(d.k));
      if (!car) return;
      const o = d.o ? 1 : 0;
      if (car.playerDoor !== o) area.sound.door(o ? 'open' : 'close', traffic.carPose(car, area.now()));
      car.playerDoor = o;
    });
  };

  // --- People: who's where, their bags ---------------------------------------------------------
  const bagGeo = mergeGeometries([
    new THREE.BoxGeometry(0.4, 0.58, 0.24).translate(0, 0.36, 0),
    new THREE.BoxGeometry(0.03, 0.36, 0.03).translate(-0.1, 0.83, 0),
    new THREE.BoxGeometry(0.03, 0.36, 0.03).translate(0.1, 0.83, 0),
    new THREE.BoxGeometry(0.24, 0.03, 0.04).translate(0, 1.01, 0),
    new THREE.CylinderGeometry(0.035, 0.035, 0.03, 8).rotateZ(Math.PI / 2).translate(-0.14, 0.04, 0.09),
    new THREE.CylinderGeometry(0.035, 0.035, 0.03, 8).rotateZ(Math.PI / 2).translate(0.14, 0.04, 0.09),
  ])!;
  const bags = new THREE.InstancedMesh(bagGeo, new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.2, envMapIntensity: 1.1 }), 8);
  const bagColors = [0x1a2236, 0x6a1a22, 0x2a2a2c, 0xb89a6a, 0x1e3a34];
  for (let i = 0; i < 8; i++) bags.setColorAt(i, new THREE.Color(bagColors[i % bagColors.length]));
  bags.count = 0;
  bags.frustumCulled = false;
  bags.raycast = () => {};
  root.add(bags);

  area.populate = (crowd, budget) => {
    const people: Person[] = [];
    const keep = (p: Person | null) => {
      if (p) people.push(p);
      return p;
    };
    const left = () => budget - people.length;
    // The doorman by the revolving door, in his long coat and cap-less (the models have none).
    const coat: Look = { ...staffLook('waiter'), kind: 'male_suit', dress: false, main: 0x4a0e18, second: 0xe8d8b0, accent: 0xc9a050, height: 1.84 };
    const doorman = keep(crowd.add('watch', coat, new THREE.Vector3(REVOLVING.x + REVOLVING.r + 0.55, 0, 0.75), 0.2));
    // Valets: black vests, white shirts.
    const vest: Look = { ...staffLook('bar'), kind: 'male_suit', dress: false, main: 0x141416, second: 0xf2f0ea, accent: 0x6a0e18 };
    const valets: Person[] = [];
    for (const [x, z, yaw] of [
      [304.6, 5.95, Math.PI / 2],
      [295.9, 6.0, Math.PI * 0.9],
      [291.2, 5.4, -Math.PI / 2 + 0.4],
    ] as const) {
      const p = keep(crowd.add('watch', { ...vest, height: 1.74 + valets.length * 0.04 }, new THREE.Vector3(x, 0, z), yaw));
      if (p) valets.push(p);
    }
    // The guests the driveway's schedule moves (taxi queue, rideshare).
    const guests = new Map<number, Person>();
    for (const g of traffic.guests) {
      if (left() <= 0) break;
      const look = randomLook();
      const p = keep(crowd.add('watch', look, new THREE.Vector3(g.rest.x, 0, g.rest.z), g.rest.yaw));
      if (!p) break;
      guests.set(g.id, p);
      p.onUpdate = (q) => {
        const pose = traffic.guestPose(g, area.now());
        if (pose.hidden) {
          q.pos.set(300, 0, -4000);
          q.moving = 0;
          q.seated = false;
          return;
        }
        q.pos.set(pose.x, 0, pose.z);
        q.moving = pose.moving;
        q.seated = pose.seated;
        q.seatY = 0.6;
        if (pose.moving > 0 || pose.seated) q.yaw = pose.yaw;
        else q.yaw += angleTo(q.yaw, pose.yaw) * 0.1;
        q.homeYaw = q.yaw;
        // Waiting for a ride: a look at the phone now and then.
        q.prop = g.state === 'wait' && g.line === 'ride' && !g.luggage ? 'phone' : 'none';
      };
    }
    // Smokers by the urn, friends chatting while they wait for their ride.
    if (left() >= 2) for (const p of crowd.addGroup(URN.x - 0.4, URN.z + 1.3, 2)) keep(p);
    if (left() >= 2) for (const p of crowd.addGroup(285.4, 1.6, Math.min(3, left()), { drinks: 0.3 })) keep(p);
    area.cast = { doorman, valets, guests, people };
    return area.cast;
  };

  // --- The frame -------------------------------------------------------------------------
  const tmp = new THREE.Object3D();
  let lastT = area.now();
  let here = false;
  area.update = (dt, feet) => {
    const t = area.now();
    here = onEntrance(feet.x);
    // Keep the schedule running even while you're elsewhere (it's cheap): you come down to the same driveway as everyone.
    traffic.step(t, held);
    if (!here) {
      lastT = t;
      area.sound.update(dt, feet, null, t);
      return;
    }
    fleet.update(traffic, t, Math.min(0.1, t - lastT || dt));
    lastT = t;
    city.update(t % 10000);
    revolve.rotation.y = (t * 0.35) % (Math.PI * 2);
    (spray.userData.tex as THREE.Texture).offset.y = (t * 0.9) % 1;
    traffic3.update(t);
    // Sliding doors open for anyone near.
    const walkers = [feet, ...deps.others(), ...traffic.guests.map((g) => traffic.guestPose(g, t)).filter((p) => !p.hidden)];
    let moved = false;
    SLIDE_DOORS.forEach((d, i) => {
      const want = walkers.some((p) => Math.abs(p.x - d.x) < 1.6 && Math.abs(p.z - FACADE_Z) < 2.2) ? 1 : 0;
      const v = THREE.MathUtils.clamp(slideOpen[i] + Math.sign(want - slideOpen[i]) * dt * 1.6, 0, 1);
      if (v !== slideOpen[i]) {
        slideOpen[i] = v;
        moved = true;
      }
    });
    if (moved) placeSlides();
    // Car colliders, seats and door handles.
    const cars = traffic.here;
    let bi = 0;
    for (const car of cars) {
      const pose = traffic.carPose(car, t);
      const open = fleet.doorAngle.get(car.key) ?? 0;
      if (!car.motion && bi < boxes.length) {
        const bx = boxes[bi],
          st = seats[bi];
        bi++;
        const seat = seatOf(pose);
        const onIt = player.stool === st;
        Object.assign(bx, { x: pose.x, z: pose.z, yaw: pose.yaw, hw: CAR.wid / 2, hd: CAR.len / 2, soft: open > 0.5 || onIt });
        Object.assign(st, { x: seat.x, z: seat.z, yaw: pose.yaw, r: open > 0.6 || onIt ? 0.42 : -1 });
      }
      let px = proxies.get(car.key);
      if (!px) {
        const mesh = new THREE.Mesh(proxyGeo, proxyMat);
        mesh.name = `car-${car.key}`;
        root.add(mesh);
        const key = car.key;
        const item = interaction.register({
          object: mesh,
          label: () => (car.motion ? null : car.playerDoor ? 'Close the car door' : car.kind.startsWith('taxi') ? 'Open the cab door' : 'Open the car door'),
          enabled: () => !car.motion && onEntrance(player.feet().x) && player.feet().distanceTo(mesh.position) < 7,
          onSelect: () => area.toggleDoor(key),
        });
        px = { mesh, item, car };
        proxies.set(car.key, px);
      }
      px.mesh.position.set(pose.x, 0, pose.z);
      px.mesh.rotation.y = pose.yaw;
    }
    for (; bi < boxes.length; bi++) {
      Object.assign(boxes[bi], { x: 1e6, z: 1e6, hw: 0, hd: 0 });
      seats[bi].r = -1;
    }
    for (const [key, px] of proxies) {
      if (cars.includes(px.car)) continue;
      interaction.unregister(px.item);
      px.mesh.removeFromParent();
      proxies.delete(key);
    }
    // Bags beside the guests who have them (not once they're in the car).
    let n = 0;
    for (const g of traffic.guests) {
      if (!g.luggage || n >= 8) continue;
      const pose = traffic.guestPose(g, t);
      if (pose.hidden || pose.seated) continue;
      const fx = Math.sin(pose.yaw),
        fz = Math.cos(pose.yaw);
      const walking = pose.moving > 0;
      // Rolled behind them on its wheels while they walk; stood beside them while they wait.
      const back = walking ? 0.55 : 0.05,
        side = walking ? 0.22 : 0.42;
      tmp.position.set(pose.x - fx * back - fz * side, 0, pose.z - fz * back + fx * side);
      tmp.rotation.set(walking ? -0.45 : 0, pose.yaw, 0, 'YXZ');
      tmp.updateMatrix();
      bags.setMatrixAt(n++, tmp.matrix);
    }
    bags.count = n;
    bags.instanceMatrix.needsUpdate = true;
    // What the schedule did this frame: valets wave and whistle, doors thunk, cars come and go.
    for (const e of traffic.events.splice(0)) {
      const pose = traffic.carPose(e.car, t);
      const valet = nearestValet(area.cast?.valets ?? [], pose);
      if (e.kind === 'whistle' || e.kind === 'depart') {
        if (valet) valet.cheer = 1.8;
        if (e.kind === 'whistle' || e.car.home === 'taxi') area.sound.whistle(valet?.pos ?? new THREE.Vector3(pose.x, 1.6, pose.z));
      } else if (e.kind === 'door') {
        area.sound.door(e.car.door ? 'open' : 'close', pose);
        if (valet && e.car.door) {
          valet.action = 1.4;
          valet.actionKind = 'reach';
        }
      } else if (e.kind === 'shift' && valet) {
        valet.cheer = 1.2;
      }
      if (e.kind === 'arrive' || e.kind === 'depart') area.sound.passBy(e.car, e.kind);
    }
    area.sound.update(dt, feet, { traffic, t }, t);
  };
  return area;
}

function nearestValet(list: Person[], p: { x: number; z: number }): Person | null {
  let best: Person | null = null,
    bd = 18;
  for (const v of list) {
    const d = Math.hypot(v.pos.x - p.x, v.pos.z - p.z);
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  return best;
}

const angleTo = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

// ---------------------------------------------------------------------------
// The boulevard's traffic: one instanced draw, moved entirely on the GPU
// ---------------------------------------------------------------------------

function streetTraffic(): { mesh: THREE.InstancedMesh; update(t: number): void } {
  // A plain car shape facing +x (the shader turns the westbound ones round): body, cabin, lamps.
  const part = (g: THREE.BufferGeometry, k: number) => {
    const n = g.toNonIndexed();
    n.deleteAttribute('uv');
    n.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count).fill(k), 1));
    return n;
  };
  const geo = mergeGeometries([
    part(new THREE.BoxGeometry(4.6, 0.7, 1.8).translate(0, 0.6, 0), 0),
    part(new THREE.BoxGeometry(2.4, 0.5, 1.6).translate(-0.3, 1.2, 0), 3),
    part(new THREE.BoxGeometry(0.06, 0.12, 0.34).translate(2.31, 0.72, 0.62), 1),
    part(new THREE.BoxGeometry(0.06, 0.12, 0.34).translate(2.31, 0.72, -0.62), 1),
    part(new THREE.BoxGeometry(0.06, 0.12, 0.34).translate(-2.31, 0.78, 0.62), 2),
    part(new THREE.BoxGeometry(0.06, 0.12, 0.34).translate(-2.31, 0.78, -0.62), 2),
    // Headlight beams on the road ahead (a faint wedge).
    part(new THREE.PlaneGeometry(8, 2.6).rotateX(-Math.PI / 2).translate(6.4, 0.03, 0), 4),
  ])!;
  // Lanes: the near westbound lane is left free (cars turn in and out of the driveway there).
  const lanes: [number, number][] = [
    [BLVD.west[1], -1],
    [BLVD.west[2], -1],
    [BLVD.east[0], 1],
    [BLVD.east[1], 1],
    [BLVD.east[2], 1],
  ];
  const N = 40;
  const info = new Float32Array(N * 4);
  const tint = new Float32Array(N * 3);
  let s = 77;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N; i++) {
    const [z, dir] = lanes[i % lanes.length];
    info.set([z, dir, 9 + rnd() * 6, rnd() * 400], i * 4);
    const g = 0.04 + rnd() * 0.16;
    tint.set(rnd() < 0.15 ? [0.5, 0.36, 0.04] : [g, g, g * 1.05], i * 3);
  }
  geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4));
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
  const uTime = { value: 0 };
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime, uX0: { value: ROAD.x0 }, uSpan: { value: ROAD.x1 - ROAD.x0 } },
    transparent: true,
    depthWrite: true,
    vertexShader: /* glsl */ `
      attribute float aPart;
      attribute vec4 aInfo;
      attribute vec3 aTint;
      uniform float uTime, uX0, uSpan;
      varying float vPart;
      varying vec3 vTint;
      varying float vFade;
      void main() {
        vPart = aPart;
        vTint = aTint;
        float along = mod(aInfo.w + uTime * aInfo.z, uSpan);
        float x = aInfo.y > 0.0 ? uX0 + along : uX0 + uSpan - along;
        vFade = smoothstep(0.0, 18.0, along) * smoothstep(uSpan, uSpan - 18.0, along);
        vec3 p = position;
        p.x *= aInfo.y;
        p.z *= aInfo.y;
        vec4 wp = vec4(p.x + x, p.y, p.z + aInfo.x, 1.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      varying float vPart;
      varying vec3 vTint;
      varying float vFade;
      void main() {
        vec3 c = vTint;
        float a = 1.0;
        if (vPart > 3.5) { c = vec3(1.0, 0.86, 0.62) * 0.16; a = 0.0; }
        else if (vPart > 2.5) c = vec3(0.03, 0.035, 0.05);
        else if (vPart > 1.5) c = vec3(2.4, 0.12, 0.06);
        else if (vPart > 0.5) c = vec3(2.6, 2.4, 2.0);
        if (vPart > 3.5) gl_FragColor = vec4(c * vFade, 1.0);
        else gl_FragColor = vec4(c * mix(0.2, 1.0, vFade), 1.0);
      }`,
  });
  // The beams add light; the rest is opaque (premultiplied trick: beams drawn with additive blending
  // wouldn't share the draw, so they're dim and opaque-blended on black instead: a faint glow).
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  mesh.name = 'strip-traffic';
  return {
    mesh,
    update(t: number) {
      uTime.value = t % 100000;
    },
  };
}

export type { SimGuest };
