import * as THREE from 'three';
import { textSign } from '../panel';
import type { Quality } from '../quality';
import { SEAT_R, type World } from '../world';
import { canvas, radial, toTexture } from '../textures';
import { Batch, M, nightSky, plane, type Mats } from './kit';
import { flowers } from './hotel';
import { assets } from '../assets';
import { ROUND_TOP } from '../barcounter';

/**
 * The pool deck at night, Vegas pool-party style, in an Italian garden: a lit
 * turquoise pool and a hot tub, loungers and umbrellas, palms, hedges and urns,
 * strings of lights, cabanas, a round pool bar and a DJ booth with moving
 * beams. A stone lift tower on the deck has two elevators.
 */

export const DECK = { x0: 22, x1: 62, z0: -36, z1: -0.3 };
export const POOL = { x: 41, z: -20, w: 18, d: 9 };
export const TUB = { x: 55, z: -12, r: 2.2 };
export const BAR = { x: 28.5, z: -26, r: 2.1 };
export const DJ = { x: 50, z: -32.5 };
/**
 * The stage: one riser 0.6 m up along the south edge, the DJ booth at its east
 * end (the decks, party/decks.ts) and the headliner's stage to the west (his
 * mic, a truss and his marquee: party/stage.ts). Steps up at the east end; the
 * front and the ends are a drop you can walk or jump off (and jump back up).
 */
export const STAGE = { x0: 39.6, x1: 47, z0: -34.1, z1: -31.5, y: 0.6, mic: { x: 43.3, z: -31.95 }, spot: { x: 43.3, z: -32.42 } };
/** The steps up to the booth (east end), 0.3 m. */
export const STAGE_STEPS = { x0: DJ.x + 3, x1: DJ.x + 3.8, z0: -32.5, z1: STAGE.z1 };
/** The truss posts at the headliner's stage's corners. */
const TRUSS: [number, number][] = [
  [STAGE.x0 + 0.15, STAGE.z1 - 0.15],
  [STAGE.x1 - 0.15, STAGE.z1 - 0.15],
  [STAGE.x0 + 0.15, STAGE.z0 + 0.15],
  [STAGE.x1 - 0.15, STAGE.z0 + 0.15],
];
/**
 * Her band on the stage behind her (party/band.ts): keys on a low riser stage
 * left, the drummer on a riser at the back in the middle, the bassist stage
 * right. (x, z: where they stand or sit; yaw: which way they face; riser: its height.)
 */
export const BAND = [
  { role: 'keys' as const, x: 41.0, z: -33.5, yaw: 0.25, riser: 0.2, w: 1.4, d: 0.9, rx: 41.05, rz: -33.55 },
  { role: 'drums' as const, x: 43.3, z: -33.72, yaw: 0, riser: 0.25, w: 1.7, d: 1.05, rx: 43.3, rz: -33.5 },
  { role: 'bass' as const, x: 45.55, z: -33.25, yaw: -0.3, riser: 0, w: 0, d: 0, rx: 0, rz: 0 },
];
export const LIFT = { doorX: 48, zs: [-7.6, -5.0] };

/** Water surface height, and the pool's floor: wide steps in the shallow end, ~1.1 m deep, sloping to ~2 m. */
export const WATER_Y = -0.12;
export const STEPS = { x0: 32, z0: -21.5, z1: -18.5, tread: 0.5, rise: 0.3, n: 3 };
export const LADDER = { x: 50, z: -20 };
export function poolFloor(x: number, z: number): number {
  const P = POOL;
  const lx = x - (P.x - P.w / 2);
  if (lx < STEPS.tread * STEPS.n && z >= STEPS.z0 && z <= STEPS.z1) return -STEPS.rise * (Math.floor(lx / STEPS.tread) + 1) - 0.02;
  const shallow = -1.22,
    deep = -2.12;
  const k = THREE.MathUtils.clamp((lx - 9) / 4, 0, 1);
  return shallow + (deep - shallow) * k * k * (3 - 2 * k);
}

/** Loungers along both long sides of the pool (yaw 0: the back toward −z). */
export function loungerSpots(): { x: number; z: number; yaw: number }[] {
  const spots: { x: number; z: number; yaw: number }[] = [];
  for (let k = 0; k < 7; k++) {
    const x = POOL.x - POOL.w / 2 + 1.2 + k * 2.6;
    spots.push({ x, z: POOL.z - POOL.d / 2 - 2.3, yaw: 0 }, { x, z: POOL.z + POOL.d / 2 + 2.3, yaw: Math.PI });
  }
  return spots;
}

/** An umbrella beside every fourth lounger. */
function umbrellaSpots(): [number, number][] {
  // (Not the one by the DJ: that's the dance floor's edge.)
  return loungerSpots()
    .filter((s, i) => i % 4 === 0 && !(s.x > DJ.x - 3 && s.yaw === 0))
    .map((s) => [s.x + 1.3, s.z + (s.yaw === 0 ? -1.2 : 1.2)]);
}

const PALMS: [number, number][] = [
  [24, -3],
  [24, -12],
  [24, -22],
  [24, -33],
  [31, -34],
  [40, -34.5],
  [60, -34],
  [60.5, -4],
  [45, -2.4],
  [53, -2.4],
  [33, -10],
  [52, -25],
];
const palmScale = (i: number) => 0.9 + ((i * 37) % 10) / 25;
const URNS: [number, number][] = [
  [26, -15],
  [26, -25],
  [36, -31],
  [46, -31],
  [57, -6],
];
/** Poles carrying the strings of lights. */
const LIGHT_POLES: [number, number][] = [
  [26, -6],
  [26, -34],
  [58, -6],
  [58, -34],
  [42, -6],
  [42, -34],
];

/** Stools around the round pool bar, facing it. */
function barStools(): { x: number; z: number; yaw: number }[] {
  const out: { x: number; z: number; yaw: number }[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const x = BAR.x + Math.cos(a) * (BAR.r + 0.55),
      z = BAR.z + Math.sin(a) * (BAR.r + 0.55);
    out.push({ x, z, yaw: Math.atan2(BAR.x - x, BAR.z - z) });
  }
  return out;
}

export function registerPool(world: World) {
  world.addWalkable(DECK.x0 + 0.4, DECK.x1 - 0.4, DECK.z0 + 0.5, DECK.z1 - 0.2);
  world.addSurface('stone', DECK.x0, DECK.x1, DECK.z0, DECK.z1);
  // The pool is open: walk in down the steps, jump in, swim, climb out.
  world.addGround(POOL.x - POOL.w / 2, POOL.x + POOL.w / 2, POOL.z - POOL.d / 2, POOL.z + POOL.d / 2, poolFloor);
  world.addWater(POOL.x - POOL.w / 2, POOL.x + POOL.w / 2, POOL.z - POOL.d / 2, POOL.z + POOL.d / 2, WATER_Y);
  world.addCircle(TUB.x, TUB.z, TUB.r + 0.35, 'hot tub');
  world.addCircle(BAR.x, BAR.z, BAR.r + 0.15, 'bar');
  // The stage riser (walk up the steps at the booth's east end): its floor, its edges, the console and speaker stacks.
  const sx1 = DJ.x + 3;
  world.addGround(STAGE.x0, sx1, STAGE.z0, STAGE.z1, () => STAGE.y);
  world.addGround(STAGE_STEPS.x0, STAGE_STEPS.x1, STAGE_STEPS.z0, STAGE_STEPS.z1, () => STAGE.y / 2);
  const mid = (STAGE.x0 + sx1) / 2,
    w = sx1 - STAGE.x0;
  // The front and the two ends are open drops (0.6 m): walk or jump off onto the deck (and jump
  // back up: a 0.45 m jump lifts your feet within a stair's height of the top). Guests and the
  // performers never step off (or on): the ledges are solid to them. The back stays a wall.
  world.addLedge(mid, STAGE.z1 + 0.05, w, 0.1, 0, 'stage edge');
  world.addBox(mid, STAGE.z0 - 0.05, w, 0.1, 0, 'stage');
  world.addLedge(STAGE.x0 - 0.05, (STAGE.z0 + STAGE.z1) / 2, 0.1, STAGE.z1 - STAGE.z0 + 0.2, 0, 'stage edge');
  world.addLedge(sx1 + 0.05, (STAGE.z0 + STAGE_STEPS.z0) / 2, 0.1, STAGE_STEPS.z0 - STAGE.z0, 0, 'stage edge');
  world.addBox(DJ.x, DJ.z + 0.5, 2.4, 0.7, 0, 'dj booth');
  for (const s of [-1, 1]) world.addBox(DJ.x + s * 2.6, DJ.z - 0.5, 0.9, 0.8, 0, 'dj booth');
  world.addCircle(STAGE.mic.x, STAGE.mic.z, 0.1, 'stage');
  // Her band: the risers (step up onto them), the keyboard rig, the drum kit, the bassist.
  for (const b of BAND) {
    if (b.riser > 0) world.addGround(b.rx - b.w / 2, b.rx + b.w / 2, b.rz - b.d / 2, b.rz + b.d / 2, () => STAGE.y + b.riser);
    if (b.role === 'keys') world.addBox(b.x + Math.sin(b.yaw) * 0.42, b.z + Math.cos(b.yaw) * 0.42, 1.05, 0.34, b.yaw, 'band');
    if (b.role === 'drums') world.addBox(b.x, b.z + 0.38, 1.45, 0.95, 0, 'band');
    world.addCircle(b.x, b.z, 0.22, 'band');
  }
  for (const [x, z] of TRUSS) world.addCircle(x, z, 0.09, 'stage');
  // Hedges along both long sides.
  for (const x of [22.7, 61.3]) world.addBox(x, -18, 1.0, 34, 0, 'hedge');
  // Loungers (seat and raised back), umbrella poles, palms, urns, light poles.
  // Loungers: walk onto one and you sit on it, facing along it (guests still walk round them).
  for (const sp of loungerSpots()) {
    const s = Math.sin(sp.yaw),
      c = Math.cos(sp.yaw);
    world.addFurniture(sp.x + s * 0.05, sp.z + c * 0.05, 0.74, 1.98, sp.yaw, 'lounger');
    for (const lz of [0.45, -0.3]) world.addSeat(sp.x + s * lz, sp.z + c * lz, 0.42, 0.37, sp.yaw, 'lounger');
  }
  for (const [x, z] of umbrellaSpots()) world.addCircle(x, z, 0.1, 'umbrella');
  PALMS.forEach(([x, z], i) => world.addCircle(x + 0.03, z, 0.2 * palmScale(i), 'palm'));
  for (const [x, z] of URNS) world.addCircle(x, z, 0.42, 'planter');
  for (const [x, z] of LIGHT_POLES) world.addCircle(x, z, 0.1, 'lamp');
  // The bar stools are seats: walk onto one and you sit.
  for (const st of barStools()) world.addSeat(st.x, st.z, SEAT_R, 0.78, st.yaw, 'bar stool');
  // Lift tower (the cabs themselves are walkable, see Elevators).
  // Solid parts of the tower around the two cabs (the cabs are walkable).
  world.addBox(LIFT.doorX + 1.3, -8.95, 2.9, 0.7, 0, 'lift');
  world.addBox(LIFT.doorX + 1.3, -6.3, 2.9, 0.68, 0, 'lift');
  world.addBox(LIFT.doorX + 1.3, -3.65, 2.9, 0.7, 0, 'lift');
  world.addBox(LIFT.doorX + 2.55, -6.3, 0.5, 6, 0, 'lift');
  // Cabanas: curtained on three sides, open to the west; walk onto the daybed and you sit on it.
  for (const z of [-30, -24, -18]) {
    world.addFurniture(59.5, z, 2.6, 3.2, 0, 'cabana');
    for (const dz of [-1.65, 1.65]) world.addBox(59.8, z + dz, 2.3, 0.12, 0, 'cabana curtain');
    world.addBox(60.85, z, 0.12, 3.3, 0, 'cabana curtain');
    for (const x of [59.2, 60.2]) for (const dz of [-0.7, 0.7]) world.addSeat(x, z + dz, 0.55, 0.5, -Math.PI / 2, 'cabana');
  }
}

export interface PoolArea {
  root: THREE.Group;
  anchor: THREE.Object3D;
  update(t: number): void;
  /** Where people can be (for the crowd). */
  seats: { pos: THREE.Vector3; yaw: number; seatY: number }[];
  stands: { pos: THREE.Vector3; yaw: number }[];
  /** People standing in the water (pos.y is their feet, on the pool floor). */
  swimmers: { pos: THREE.Vector3; yaw: number }[];
  /** Swimming loops in the deep end (centre, radii, m/s). */
  laps: { x: number; z: number; rx: number; rz: number; speed: number }[];
  /** Loungers with someone on them (`lie`: how far they recline, 0 = sitting up). */
  loungers: { pos: THREE.Vector3; yaw: number; seatY: number; lie: number }[];
  /** A pair chatting on the deck. */
  chats: { pos: THREE.Vector3; yaw: number }[];
  bartender: { pos: THREE.Vector3; yaw: number };
  /** The bottles round the pool bar's central column (their bases, world) and colours: stock.ts draws them. */
  bottles: { pos: THREE.Vector3; color: number }[];
  /** What the party's lights drive: the water's and the basin's colour, the deck glow, the LED wall. */
  party: { water: THREE.ShaderMaterial; led: THREE.ShaderMaterial; tile: THREE.MeshStandardMaterial; floor: THREE.MeshStandardMaterial; glow: THREE.MeshBasicMaterial };
}

export function buildPool(scene: THREE.Scene, q: Quality, m: Mats): PoolArea {
  const root = new THREE.Group();
  root.name = 'pool';
  scene.add(root);
  const b = new Batch();
  const W = DECK.x1 - DECK.x0;
  const cx = (DECK.x0 + DECK.x1) / 2,
    cz = (DECK.z0 + DECK.z1) / 2;

  // Sky over the deck.
  const sky = nightSky(260);
  sky.position.set(cx, 0, cz);
  root.add(sky);

  // Limestone deck (Poly Haven "Floor Tiles 02" scan, 4 m per repeat; deck UVs are metres),
  // with a wet night sheen: it catches the pool glow and the string lights.
  const deck = assets.material('limestone', {
    repeat: 0.25,
    rough: 0.62,
    normal: 0.9,
    tint: 0xeae0d2,
    envIntensity: 0.8,
    fallback: () => {
      const deckTex = toTexture(travertine(1024));
      deckTex.wrapS = deckTex.wrapT = THREE.RepeatWrapping;
      deckTex.repeat.set(0.25, 0.25);
      return new THREE.MeshStandardMaterial({ map: deckTex, color: new THREE.Color(0.78, 0.74, 0.7), roughness: 0.38, metalness: 0.05 });
    },
  });
  deck.emissive.set(0x1c140e);
  deck.emissiveIntensity = 0.6;
  // The deck surface, with the pool and hot tub cut out (shape in x / −z).
  const shape = new THREE.Shape();
  shape.moveTo(DECK.x0, -DECK.z1);
  shape.lineTo(DECK.x1, -DECK.z1);
  shape.lineTo(DECK.x1, -DECK.z0);
  shape.lineTo(DECK.x0, -DECK.z0);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(POOL.x - POOL.w / 2, -(POOL.z + POOL.d / 2));
  hole.lineTo(POOL.x - POOL.w / 2, -(POOL.z - POOL.d / 2));
  hole.lineTo(POOL.x + POOL.w / 2, -(POOL.z - POOL.d / 2));
  hole.lineTo(POOL.x + POOL.w / 2, -(POOL.z + POOL.d / 2));
  hole.closePath();
  const tubHole = new THREE.Path();
  tubHole.absarc(TUB.x, -TUB.z, TUB.r, 0, Math.PI * 2, true);
  shape.holes.push(hole, tubHole);
  const deckGeo = new THREE.ShapeGeometry(shape, 24);
  const duv = deckGeo.attributes.uv as THREE.BufferAttribute;
  const dpos = deckGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < duv.count; i++) duv.setXY(i, dpos.getX(i), dpos.getY(i));
  deckGeo.rotateX(-Math.PI / 2);
  b.add(deckGeo, deck, M(0, 0.003, 0));
  b.add(plane(3, 3.2, 1), deck, M(36, 0.003, -1.6));

  // The pool: coping, tiled basin, and the lit water.
  const tile = new THREE.MeshStandardMaterial({ color: 0x1a8ab0, roughness: 0.3, emissive: 0x0a6a8a, emissiveIntensity: 0.8 });
  // (The party recolours it: keep it out of the colour merge, see Batch.build.)
  tile.userData.live = true;
  const coping = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.6, emissive: 0x2a2218, emissiveIntensity: 0.4 });
  const P = POOL;
  for (const [x, z, w, d] of [
    [P.x, P.z - P.d / 2 - 0.2, P.w + 0.8, 0.4],
    [P.x, P.z + P.d / 2 + 0.2, P.w + 0.8, 0.4],
    [P.x - P.w / 2 - 0.2, P.z, 0.4, P.d],
    [P.x + P.w / 2 + 0.2, P.z, 0.4, P.d],
  ]) b.box(coping, x, 0.04, z, w, 0.08, d);
  // Basin walls down to the deep end's floor.
  for (const [x, z, w, d] of [
    [P.x, P.z - P.d / 2, P.w, 0.05],
    [P.x, P.z + P.d / 2, P.w, 0.05],
    [P.x - P.w / 2, P.z, 0.05, P.d],
    [P.x + P.w / 2, P.z, 0.05, P.d],
  ]) b.box(tile, x, -1.07, z, w, 2.14, d);
  // Floor following the depth profile (shallow end, a smooth slope, the deep end).
  const poolFloorMat = new THREE.MeshStandardMaterial({ color: 0x2aa0c8, roughness: 0.4, emissive: 0x0c7fa8, emissiveIntensity: 0.9 });
  poolFloorMat.userData.live = true;
  {
    const floorMat = poolFloorMat;
    const fg = new THREE.PlaneGeometry(P.w, P.d, 36, 1);
    fg.rotateX(-Math.PI / 2);
    const fp = fg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < fp.count; i++) fp.setY(i, poolFloor(P.x + fp.getX(i), P.z + fp.getZ(i)) - 0.0);
    fg.computeVertexNormals();
    b.add(fg, floorMat, M(P.x, 0, P.z));
    // Lane lines on the floor.
    const line = new THREE.MeshStandardMaterial({ color: 0x0a3c5a, roughness: 0.5 });
    for (const z of [P.z - 2.2, P.z + 2.2]) {
      const lg = new THREE.PlaneGeometry(P.w - 4, 0.18, 36, 1);
      lg.rotateX(-Math.PI / 2);
      const lp = lg.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < lp.count; i++) lp.setY(i, poolFloor(P.x + 1 + lp.getX(i), z) + 0.01);
      b.add(lg, line, M(P.x + 1, 0, z));
    }
    // Wide entry steps in the shallow end, with a bright nosing on each tread.
    const nosing = new THREE.MeshStandardMaterial({ color: 0xf0f4f8, roughness: 0.4, emissive: 0x6a8a9a, emissiveIntensity: 0.6 });
    for (let k = 0; k < STEPS.n; k++) {
      const top = -STEPS.rise * (k + 1) - 0.02;
      const x0 = P.x - P.w / 2 + k * STEPS.tread;
      const depth = top - -1.22;
      b.box(tile, x0 + STEPS.tread / 2, top + depth / 2 - (top - -1.22) - 0.0, (STEPS.z0 + STEPS.z1) / 2, STEPS.tread, Math.max(0.05, -(-1.22 - top)), STEPS.z1 - STEPS.z0);
      b.box(nosing, x0 + STEPS.tread - 0.04, top + 0.005, (STEPS.z0 + STEPS.z1) / 2, 0.08, 0.02, STEPS.z1 - STEPS.z0);
    }
    // A chrome ladder in the deep end.
    const chrome = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: 1, roughness: 0.15 });
    for (const dz of [-0.28, 0.28]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(LADDER.x - 0.12, -1.6, LADDER.z + dz),
        new THREE.Vector3(LADDER.x - 0.12, 0.2, LADDER.z + dz),
        new THREE.Vector3(LADDER.x + 0.1, 0.75, LADDER.z + dz),
        new THREE.Vector3(LADDER.x + 0.45, 0.05, LADDER.z + dz),
      ]);
      b.add(new THREE.TubeGeometry(curve, 24, 0.022, 8, false), chrome, M(0, 0, 0));
    }
    for (let k = 0; k < 4; k++) b.box(chrome, LADDER.x - 0.1, -0.25 - k * 0.32, LADDER.z, 0.06, 0.03, 0.56);
  }
  // The lit water throws turquoise light onto the deck around it.
  const poolGlow = new THREE.MeshBasicMaterial({ map: toTexture(radial(128, 'rgba(255,255,255,0.45)', 'rgba(255,255,255,0)')), color: 0x3cc8e6, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  {
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(POOL.w + 7, POOL.d + 7), poolGlow);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(POOL.x, 0.015, POOL.z);
    glow.raycast = () => {};
    root.add(glow);
  }
  const waterMat = waterMaterial();
  const water = new THREE.Mesh(new THREE.PlaneGeometry(P.w, P.d, 1, 1), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(P.x, WATER_Y, P.z);
  water.renderOrder = 2;
  water.raycast = () => {};
  root.add(water);
  // Hot tub.
  b.add(new THREE.TorusGeometry(TUB.r + 0.15, 0.18, 8, 40).rotateX(Math.PI / 2), coping, M(TUB.x, 0.05, TUB.z));
  b.add(new THREE.CylinderGeometry(TUB.r, TUB.r, 0.9, 32, 1, true), tile, M(TUB.x, -0.45, TUB.z));
  const tub = new THREE.Mesh(new THREE.CircleGeometry(TUB.r, 40), waterMat);
  tub.rotation.x = -Math.PI / 2;
  tub.position.set(TUB.x, -0.1, TUB.z);
  tub.raycast = () => {};
  root.add(tub);

  // Loungers and umbrellas along both long sides.
  const lounger = loungerGeometry();
  const loungerMat = new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.7, emissive: 0x2a2620, emissiveIntensity: 0.4 });
  const spots = loungerSpots();
  const loungers = new THREE.InstancedMesh(lounger, loungerMat, spots.length);
  const tmp = new THREE.Object3D();
  spots.forEach((s, i) => {
    tmp.position.set(s.x, 0, s.z);
    tmp.rotation.set(0, s.yaw, 0);
    tmp.updateMatrix();
    loungers.setMatrixAt(i, tmp.matrix);
  });
  loungers.raycast = () => {};
  root.add(loungers);
  const canopy = new THREE.MeshStandardMaterial({ color: 0xf6f0e2, roughness: 0.8, side: THREE.DoubleSide, emissive: 0x302820, emissiveIntensity: 0.5 });
  for (const [ux, uz] of umbrellaSpots()) {
    b.add(new THREE.CylinderGeometry(0.03, 0.03, 2.5, 6), m.gold, M(ux, 1.25, uz));
    b.add(new THREE.ConeGeometry(1.4, 0.5, 10, 1, true), canopy, M(ux, 2.45, uz));
  }

  // Palms around the deck.
  const palmSpots = PALMS;
  const { trunk, crown } = palmGeometry();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6a5238, roughness: 0.9, emissive: 0x1a120a, emissiveIntensity: 0.5 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x2f6a34, roughness: 0.8, side: THREE.DoubleSide, emissive: 0x0c2a10, emissiveIntensity: 0.7 });
  const trunks = new THREE.InstancedMesh(trunk, trunkMat, palmSpots.length);
  const crowns = new THREE.InstancedMesh(crown, crownMat, palmSpots.length);
  palmSpots.forEach(([x, z], i) => {
    tmp.position.set(x, 0, z);
    tmp.rotation.set(0, i * 1.7, 0);
    tmp.scale.setScalar(palmScale(i));
    tmp.updateMatrix();
    trunks.setMatrixAt(i, tmp.matrix);
    crowns.setMatrixAt(i, tmp.matrix);
    // Uplight at the foot of each palm.
    b.add(new THREE.CylinderGeometry(0.12, 0.14, 0.06, 10), m.glow(0xffe2b0, 1.4), M(x + 0.3, 0.03, z));
  });
  trunks.raycast = crowns.raycast = () => {};
  root.add(trunks, crowns);

  // Hedges, urns and a stone balustrade over the lake.
  const hedge = new THREE.MeshStandardMaterial({ color: 0x24502a, roughness: 0.9, emissive: 0x0a200c, emissiveIntensity: 0.6 });
  b.box(hedge, 22.7, 0.55, -18, 1.0, 1.1, 34);
  b.box(hedge, 61.3, 0.55, -18, 1.0, 1.1, 34);
  for (let x = DECK.x0 + 1; x < DECK.x1 - 0.5; x += 2) b.box(m.stone, x, 0.5, DECK.z0 + 0.2, 0.18, 0.8, 0.18);
  b.box(m.stone, cx, 0.95, DECK.z0 + 0.2, W, 0.12, 0.35);
  b.box(m.stone, cx, 0.08, DECK.z0 + 0.2, W, 0.16, 0.4);
  for (const [x, z] of URNS) {
    b.add(new THREE.CylinderGeometry(0.4, 0.28, 0.8, 20), m.stone, M(x, 0.4, z));
    flowers(b, m, x, 0.8, z, 0.45, 24);
  }

  // Cabanas along the east hedge.
  const curtain = new THREE.MeshStandardMaterial({ color: 0xfaf6ee, roughness: 0.9, side: THREE.DoubleSide, emissive: 0x3a3430, emissiveIntensity: 0.5 });
  const cushion = new THREE.MeshStandardMaterial({ color: 0x1a3a5a, roughness: 0.8, emissive: 0x081420, emissiveIntensity: 0.4 });
  const seats: PoolArea['seats'] = [];
  for (const z of [-30, -24, -18]) {
    const x = 59.5;
    for (const [px, pz] of [
      [-1.3, -1.6],
      [1.3, -1.6],
      [-1.3, 1.6],
      [1.3, 1.6],
    ]) b.box(m.cream, x + px, 1.3, z + pz, 0.12, 2.6, 0.12);
    b.box(m.cream, x, 2.65, z, 2.9, 0.12, 3.5);
    b.box(m.glow(0xffd9a0, 1.2), x, 2.58, z, 2.4, 0.01, 3.0);
    b.box(cushion, x + 0.2, 0.25, z, 2.0, 0.5, 2.8);
    for (const pz of [-1.65, 1.65]) b.box(curtain, x + 0.3, 1.3, z + pz, 2.3, 2.5, 0.02);
    b.box(curtain, x + 1.35, 1.3, z, 0.02, 2.5, 3.2);
    seats.push({ pos: new THREE.Vector3(x - 0.4, 0, z - 0.6), yaw: -Math.PI / 2, seatY: 0.5 }, { pos: new THREE.Vector3(x - 0.4, 0, z + 0.6), yaw: -Math.PI / 2, seatY: 0.5 });
  }

  // Round pool bar with a glowing front and stools.
  b.add(new THREE.CylinderGeometry(BAR.r, BAR.r, 1.05, 40, 1, true), m.walnut, M(BAR.x, 0.52, BAR.z));
  // A flat marble top round the ring (drinks are served on it: lounge.ts), with a rounded front edge.
  b.add(new THREE.RingGeometry(ROUND_TOP.inner, ROUND_TOP.outer, 48).rotateX(-Math.PI / 2), m.darkMarble, M(BAR.x, ROUND_TOP.y, BAR.z));
  b.add(new THREE.CylinderGeometry(ROUND_TOP.inner, ROUND_TOP.inner, 0.06, 40, 1, true), m.darkMarble, M(BAR.x, ROUND_TOP.y - 0.03, BAR.z));
  b.add(new THREE.TorusGeometry(ROUND_TOP.outer, 0.03, 6, 48).rotateX(Math.PI / 2), m.darkMarble, M(BAR.x, ROUND_TOP.y - 0.03, BAR.z));
  b.add(new THREE.RingGeometry(BAR.r, ROUND_TOP.outer, 48).rotateX(Math.PI / 2), m.darkMarble, M(BAR.x, ROUND_TOP.y - 0.06, BAR.z));
  b.add(new THREE.TorusGeometry(BAR.r + 0.02, 0.02, 6, 48).rotateX(Math.PI / 2), m.glow(0x5ad0ff, 1.8), M(BAR.x, 0.12, BAR.z));
  b.add(new THREE.CylinderGeometry(0.7, 0.8, 2.6, 24), m.walnut, M(BAR.x, 1.3, BAR.z));
  b.add(new THREE.CylinderGeometry(2.6, 2.6, 0.15, 40), m.cream, M(BAR.x, 3.0, BAR.z));
  b.add(new THREE.CylinderGeometry(2.4, 2.4, 0.01, 40), m.glow(0xffd9a0, 1.2), M(BAR.x, 2.92, BAR.z));
  for (const pole of [0, 1, 2, 3]) {
    const a = (pole / 4) * Math.PI * 2 + 0.4;
    b.add(new THREE.CylinderGeometry(0.06, 0.06, 2.9, 8), m.gold, M(BAR.x + Math.cos(a) * 2.45, 1.45, BAR.z + Math.sin(a) * 2.45));
  }
  // Bottles on the central column, lit from below: one instanced draw, each one takeable (stock.ts).
  const bottleCols = [0x2a6a3a, 0x8a5a1a, 0xd8d0c0, 0x3a1a4a, 0x8a1a1a];
  const columnBottles: PoolArea['bottles'] = [];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    columnBottles.push({ pos: new THREE.Vector3(BAR.x + Math.cos(a) * 0.82, 1.32 + (i % 2) * 0.4 - 0.14, BAR.z + Math.sin(a) * 0.82), color: bottleCols[i % 5] });
  }
  const stools: PoolArea['seats'] = [];
  for (const { x, z, yaw } of barStools()) {
    b.add(new THREE.CylinderGeometry(0.2, 0.18, 0.08, 16), cushion, M(x, 0.74, z));
    b.add(new THREE.CylinderGeometry(0.025, 0.025, 0.72, 8), m.gold, M(x, 0.37, z));
    stools.push({ pos: new THREE.Vector3(x, 0, z), yaw, seatY: 0.74 });
  }

  // DJ booth with an LED wall (the moving beams, lasers and dance floor are the party's: party/lights.ts).
  b.box(m.darkMarble, DJ.x, 0.3, DJ.z - 0.3, 6, 0.6, 2.6);
  b.box(new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 }), DJ.x, 1.05, DJ.z + 0.5, 2.4, 1.0, 0.7);
  for (const s of [-1, 1]) b.box(new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.5 }), DJ.x + s * 2.6, 1.4, DJ.z - 0.5, 0.9, 2.2, 0.8);
  const ledMat = ledMaterial();
  const led = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 2.8), ledMat);
  led.position.set(DJ.x, 2.2, DJ.z - 1.55);
  led.raycast = () => {};
  root.add(led);
  // The headliner's stage: the riser carries on west of the booth, a truss over it, a backdrop
  // for her marquee, a mic stand, a glowing strip along the front and steps up at the east end.
  b.box(m.darkMarble, (STAGE.x0 + STAGE.x1) / 2, STAGE.y / 2, (STAGE.z0 + STAGE.z1) / 2, STAGE.x1 - STAGE.x0, STAGE.y, STAGE.z1 - STAGE.z0);
  b.box(m.darkMarble, (STAGE_STEPS.x0 + STAGE_STEPS.x1) / 2, STAGE.y / 4, (STAGE_STEPS.z0 + STAGE_STEPS.z1) / 2, STAGE_STEPS.x1 - STAGE_STEPS.x0, STAGE.y / 2, STAGE_STEPS.z1 - STAGE_STEPS.z0);
  b.box(m.glow(0x9a6cff, 1.3), (STAGE.x0 + DJ.x + 3) / 2, STAGE.y - 0.05, STAGE.z1 + 0.012, DJ.x + 3 - STAGE.x0, 0.035, 0.02);
  const truss = new THREE.MeshStandardMaterial({ color: 0x2a2a31, metalness: 0.85, roughness: 0.35 });
  const top = STAGE.y + 3.6;
  for (const [x, z] of TRUSS) b.box(truss, x, (STAGE.y + top) / 2, z, 0.12, top - STAGE.y, 0.12);
  for (const z of [TRUSS[0][1], TRUSS[2][1]]) b.box(truss, (STAGE.x0 + STAGE.x1) / 2, top, z, STAGE.x1 - STAGE.x0 - 0.18, 0.14, 0.14);
  for (const x of [TRUSS[0][0], TRUSS[1][0]]) b.box(truss, x, top, (STAGE.z0 + STAGE.z1) / 2, 0.14, 0.14, STAGE.z1 - STAGE.z0 - 0.18);
  // Lamps on the truss (the beams are party/stage.ts's).
  for (const x of [STAGE.x0 + 0.25, STAGE.x1 - 0.25]) b.box(truss, x, top - 0.08, STAGE.z1 - 0.2, 0.2, 0.22, 0.26);
  for (let k = 0; k < 4; k++) b.box(truss, STAGE.x0 + 1.1 + k * 1.75, top - 0.12, STAGE.z0 + 0.2, 0.22, 0.2, 0.22);
  // The backdrop behind the marquee (high enough to clear the band in front of it).
  b.box(truss, STAGE.spot.x, STAGE.y + 2.35, STAGE.z0 + 0.06, 6.0, 2.3, 0.06);
  // The band's risers (their instruments are party/band.ts's).
  for (const r of BAND) if (r.riser > 0) b.box(m.darkMarble, r.rx, STAGE.y + r.riser / 2, r.rz, r.w, r.riser, r.d);
  // Mic stand: the weighted base (the pole and its clip are party/stage.ts's: he tilts it).
  b.add(new THREE.CylinderGeometry(0.13, 0.14, 0.025, 20), truss, M(STAGE.mic.x, STAGE.y + 0.012, STAGE.mic.z));
  const djSign = textSign('Pool Party', { width: 3.2, px: 130, sub: 'DJ  ·  TONIGHT', bg: 'rgba(10,4,20,0.85)' });
  djSign.position.set(DJ.x, 4.2, DJ.z - 1.5);
  root.add(djSign);

  // Strings of lights criss-crossing the deck.
  const poles = LIGHT_POLES;
  for (const [x, z] of poles) b.add(new THREE.CylinderGeometry(0.06, 0.08, 5, 8), m.walnut, M(x, 2.5, z));
  const links: [number, number][] = [
    [0, 5],
    [4, 1],
    [4, 3],
    [2, 5],
    [0, 4],
    [4, 2],
    [1, 5],
    [5, 3],
  ];
  const bulbs: THREE.Vector3[] = [];
  for (const [i, j] of links) {
    const a = new THREE.Vector3(poles[i][0], 4.9, poles[i][1]);
    const c = new THREE.Vector3(poles[j][0], 4.9, poles[j][1]);
    const n = Math.round(a.distanceTo(c) / 0.9);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      bulbs.push(a.clone().lerp(c, t).add(new THREE.Vector3(0, -Math.sin(Math.PI * t) * 1.2, 0)));
    }
  }
  const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 6, 4), m.glow(0xffd9a0, 2.2), bulbs.length);
  bulbs.forEach((p, i) => {
    tmp.position.copy(p);
    tmp.rotation.set(0, 0, 0);
    tmp.scale.setScalar(1);
    tmp.updateMatrix();
    bulbMesh.setMatrixAt(i, tmp.matrix);
  });
  bulbMesh.raycast = () => {};
  root.add(bulbMesh);

  // The lift tower on the deck (cabs are built by the elevator module).
  const L = LIFT;
  b.box(m.stone, L.doorX + 1.3, 4.5, -9.15, 2.9, 9, 0.3);
  b.box(m.stone, L.doorX + 1.3, 4.5, -3.45, 2.9, 9, 0.3);
  b.box(m.stone, L.doorX + 2.65, 4.5, -6.3, 0.3, 9, 5.9);
  b.box(m.stone, L.doorX + 1.3, 9.05, -6.3, 2.9, 0.2, 5.9);
  // West face with two door openings (2.6 m tall).
  const face = (z0: number, z1: number, y0: number, y1: number) => b.box(m.stone, L.doorX - 0.05, (y0 + y1) / 2, (z0 + z1) / 2, 0.2, y1 - y0, z1 - z0);
  face(-9.3, L.zs[0] - 0.83, 0, 9);
  face(L.zs[0] + 0.83, L.zs[1] - 0.83, 0, 9);
  face(L.zs[1] + 0.83, -3.3, 0, 9);
  face(L.zs[0] - 0.83, L.zs[1] + 0.83, 2.6, 9);
  const liftSign = textSign('Tower Lifts', { width: 1.6, px: 110, sub: 'ROOM  ·  PROMENADE  ·  LOBBY  ·  BOWLING', bg: 'rgba(16,10,8,0.85)' });
  liftSign.position.set(L.doorX - 0.17, 3.6, -6.3);
  liftSign.rotation.y = -Math.PI / 2;
  root.add(liftSign);

  // A couple of warm lights on the deck where the hardware allows.
  if (q.pointLights > 0) {
    for (const [x, z] of [
      [BAR.x, BAR.z],
      [P.x, P.z],
    ]) {
      const l = new THREE.PointLight(0xffd0a0, 12, 16, 1.6);
      l.position.set(x, 4, z);
      root.add(l);
    }
  }

  b.build(root, 'pool-static', { byColor: true });
  const anchor = new THREE.Object3D();
  anchor.position.set(P.x, 0.5, P.z);
  root.add(anchor);

  // Crowd spots: loungers, bar stools, cabanas, and a dance floor in front of the DJ.
  // Guests lie back on most of the occupied loungers; one sits up with a drink.
  const loungerSeats = spots
    .filter((_, i) => i % 2 === 0 || i === 5 || i === 9)
    .slice(0, 9)
    .map((s, k) => ({ pos: new THREE.Vector3(s.x, 0, s.z), yaw: s.yaw, seatY: k === 3 ? 0.48 : 0.47, lie: k === 3 ? 0 : 0.95 }));
  const stands: PoolArea['stands'] = [];
  for (let k = 0; k < 8; k++) {
    stands.push({ pos: new THREE.Vector3(DJ.x - 2.4 + (k % 4) * 1.5 + (k > 3 ? 0.7 : 0), 0, DJ.z + 2.2 + Math.floor(k / 4) * 1.2), yaw: Math.PI });
  }
  // Fans in front of the headliner's stage (they dance with the floor and turn to him when he's on).
  for (const [x, z] of [
    [41.3, -30.55],
    [42.7, -30.75],
    [44.1, -30.6],
    [45.3, -30.35],
  ])
    stands.push({ pos: new THREE.Vector3(x, 0, z), yaw: Math.PI });
  // Two friends chatting on the east deck, by the hot tub (clear of the walkways).
  const chats: PoolArea['chats'] = [
    { pos: new THREE.Vector3(56.4, 0, -14.6), yaw: Math.PI * 0.75 },
    { pos: new THREE.Vector3(57.0, 0, -15.3), yaw: -Math.PI * 0.25 },
  ];

  // A few guests standing in the shallow end, the water at their waists, chatting.
  const at = (x: number, z: number, yaw: number) => ({ pos: new THREE.Vector3(x, poolFloor(x, z), z), yaw });
  const swimmers: PoolArea['swimmers'] = [at(P.x - 5.6, P.z + 2.3, Math.PI * 0.75), at(P.x - 4.7, P.z + 1.6, -Math.PI * 0.6), at(P.x - 5.9, P.z + 1.2, Math.PI * 0.35)];

  // Laps in the deep end: slow loops (centre and radii), kept well off the walls.
  const laps: PoolArea['laps'] = [
    { x: P.x + 4.6, z: P.z, rx: 2.9, rz: 2.6, speed: 0.38 },
    { x: P.x + 4.9, z: P.z + 0.2, rx: 2.0, rz: 1.7, speed: 0.3 },
  ];

  return {
    root,
    anchor,
    swimmers,
    laps,
    loungers: loungerSeats,
    seats: [...stools.slice(0, 5), ...seats],
    stands,
    chats,
    bartender: { pos: new THREE.Vector3(BAR.x + 1.15, 0, BAR.z), yaw: Math.PI / 2 },
    bottles: columnBottles,
    update(t: number) {
      waterMat.uniforms.time.value = t;
      ledMat.uniforms.time.value = t;
    },
    party: { water: waterMat, led: ledMat, tile, floor: poolFloorMat, glow: poolGlow },
  };
}

/** Cheap animated pool water: lit from below, with moving caustic ripples. */
function waterMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    // tint / tintAmt: the party's underwater lights shifting colour (party/lights.ts).
    uniforms: { time: { value: 0 }, tint: { value: new THREE.Color(0.1, 0.7, 0.9) }, tintAmt: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform vec3 tint;
      uniform float tintAmt;
      varying vec3 vW;
      void main() {
        vec2 p = vW.xz * 1.3;
        float c = 0.0;
        c += sin(p.x * 2.1 + time * 1.3 + sin(p.y * 1.7 + time));
        c += sin(p.y * 2.6 - time * 1.1 + sin(p.x * 1.3 - time * 0.7));
        c += sin((p.x + p.y) * 1.7 + time * 0.9);
        float caustic = pow(abs(sin(c * 1.4)), 6.0);
        vec3 deep = vec3(0.02, 0.32, 0.52);
        vec3 shallow = vec3(0.12, 0.78, 0.9);
        vec3 body = mix(deep, shallow, 0.55 + 0.15 * sin(c)) + caustic * vec3(0.5, 0.8, 0.85);
        body = mix(body, tint * (0.75 + 0.25 * sin(c)) + caustic * tint * 0.9, tintAmt);
        // Ripple normal from the same wave field, then a Fresnel mix with the night sky.
        vec3 n = normalize(vec3(cos(p.x * 2.1 + time * 1.3) * 0.08, 1.0, cos(p.y * 2.6 - time * 1.1) * 0.08));
        vec3 v = normalize(cameraPosition - vW);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
        vec3 sky = mix(vec3(0.02, 0.03, 0.08), vec3(0.12, 0.1, 0.18), clamp(reflect(-v, n).y, 0.0, 1.0));
        // Glints of the string lights and DJ beams dancing on the ripples.
        float glint = pow(max(0.0, sin(p.x * 9.0 + time * 2.0) * sin(p.y * 11.0 - time * 1.7)), 24.0);
        vec3 col = mix(body * 1.1, sky, fres * 0.85) + glint * vec3(1.0, 0.85, 0.6) * (0.3 + fres);
        // Seen from below (you're underwater): a bright, rippling ceiling of light.
        if (cameraPosition.y < vW.y) col = vec3(0.3, 0.75, 0.85) + caustic * vec3(0.6, 0.9, 1.0);
        gl_FragColor = vec4(col, cameraPosition.y < vW.y ? 0.92 : 0.86);
        #include <colorspace_fragment>
      }`,
  });
}

/** Animated LED wall behind the DJ: sweeping colour bars and an equaliser. */
function ledMaterial() {
  return new THREE.ShaderMaterial({
    // pulse / level: the equaliser jumps with the kick and follows the music's intensity (party/lights.ts).
    uniforms: { time: { value: 0 }, pulse: { value: 0 }, level: { value: 0.6 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform float pulse;
      uniform float level;
      varying vec2 vUv;
      vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
      void main() {
        float bars = floor(vUv.x * 24.0);
        float lv = (0.2 + 0.3 * level) + 0.3 * sin(time * 3.0 + bars * 0.7) * sin(time * 1.7 + bars * 0.31) + 0.15 * sin(time * 8.0 + bars) + pulse * 0.35 * (1.0 - abs(bars - 11.5) / 12.0);
        float lit = step(vUv.y, lv) * step(0.15, fract(vUv.x * 24.0));
        vec3 col = hue(fract(bars / 24.0 + time * 0.05)) * lit * 1.6;
        col += hue(fract(time * 0.1 + vUv.y)) * 0.08;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

function loungerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0) => {
    g.rotateX(rx);
    g.translate(x, y, z);
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  // Seat (flat part toward the pool, z+), back raised toward z−.
  add(new THREE.BoxGeometry(0.7, 0.1, 1.3), 0, 0.32, 0.35);
  // The backrest rises away from the seat (its low edge meets the seat's end).
  add(new THREE.BoxGeometry(0.7, 0.1, 0.75), 0, 0.55, -0.55, 0.6);
  for (const [x, z] of [
    [-0.3, 0.9],
    [0.3, 0.9],
    [-0.3, -0.75],
    [0.3, -0.75],
  ]) add(new THREE.BoxGeometry(0.05, 0.3, 0.05), x, 0.15, z);
  return mergeGeos(parts);
}

export function palmGeometry() {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(new THREE.Vector3(Math.sin(t * 1.4) * 0.6 * t, t * 7, 0));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const trunk = new THREE.TubeGeometry(curve, 12, 0.18, 7, false);
  const top = curve.getPoint(1);
  const fronds: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 9; k++) {
    const g = new THREE.PlaneGeometry(0.6, 3.2, 1, 4);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) + 1.6; // 0 at base, 3.2 at tip
      pos.setY(i, y);
      pos.setZ(i, -((y / 3.2) ** 2) * 1.3);
      pos.setX(i, pos.getX(i) * (1 - (y / 3.2) * 0.85));
    }
    g.rotateX(-Math.PI / 2 + 0.5);
    g.rotateY((k / 9) * Math.PI * 2);
    g.translate(top.x, top.y, top.z);
    fronds.push(g.toNonIndexed());
  }
  return { trunk, crown: mergeGeos(fronds) };
}

function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3),
    nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    g.computeVertexNormals();
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

function travertine(size: number): HTMLCanvasElement {
  const [c, g] = canvas(size);
  g.fillStyle = '#d9c8a8';
  g.fillRect(0, 0, size, size);
  let s = 9;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const n = 4;
  const t = size / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const k = 0.88 + rnd() * 0.14;
      g.fillStyle = `rgb(${217 * k},${200 * k},${168 * k})`;
      g.fillRect(i * t + 2, j * t + 2, t - 4, t - 4);
      for (let p = 0; p < 30; p++) {
        g.fillStyle = `rgba(150,130,100,${0.1 + rnd() * 0.15})`;
        g.fillRect(i * t + rnd() * t, j * t + rnd() * t, 2 + rnd() * 10, 1 + rnd() * 2);
      }
    }
  return c;
}
