import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { Quality } from './quality';
import { carpet, damask, floorTile, lakeReflection, lakeView, marble, radial, toTexture, wood } from './textures';
import { textSign } from './panel';
import { bakeStatic } from './merge';
import { assets } from './assets';
import { buildCanopy, buildCeiling, buildPilasters } from './hall';

/**
 * The casino hall: an original resort interior in an Italian-lakeside style.
 * Static pieces are merged per material to keep draw calls low on Quest.
 */

export const HALL = { w: 36, d: 28, h: 6 };
/** The slot bank faces back toward the entrance, on a diagonal. */
export const SLOTS_YAW = -0.8;
const SLOTS_FWD = new THREE.Vector3(Math.sin(SLOTS_YAW), 0, Math.cos(SLOTS_YAW));

export const ROTUNDA = { x: 0, z: 2, r: 4.6, h: 8.5 };

export const POSITIONS = {
  start: new THREE.Vector3(0, 0, 12.6),
  roulette: new THREE.Vector3(-8.2, 0, 1.5),
  slots: new THREE.Vector3(8.8, 0, 4.4),
  craps: new THREE.Vector3(-7.5, 0, -7),
};

/** Collects static geometry by material and merges it into one mesh each. */
class Batcher {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    let list = this.parts.get(mat);
    if (!list) this.parts.set(mat, (list = []));
    list.push(g);
  }
  build(parent: THREE.Object3D, shadows: boolean) {
    for (const [mat, geos] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
      mesh.receiveShadow = shadows;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
    }
  }
}

const M = (x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)),
    new THREE.Vector3(sx, sy, sz),
  );

export interface Casino {
  root: THREE.Group;
  floor: THREE.Mesh;
  columns: [number, number][];
  planters: [number, number][];
  doorsOpen(): number;
  fountainLevel(): number;
  fountainAnchor: THREE.Object3D;
  update(t: number, player?: THREE.Vector3): void;
}

/** The terrace sits at floor level outside the French doors; the lake is far below. */
export const TERRACE = { x0: -10, x1: 10, z0: -18.2, z1: -14 };
const LAKE_Y = -7;
const DOOR_H = 3.6;

/** Walkable areas, obstacles and floor surfaces of the hall itself. */
export function registerHall(world: import('./world').World, c: Casino) {
  world.addWalkable(-17.7, 17.7, -13.7, 13.7);
  world.addWalkable(-1.45, 1.45, -14.8, -13.2);
  world.addWalkable(TERRACE.x0 + 0.35, TERRACE.x1 - 0.35, TERRACE.z0 + 0.35, -14.35);
  // Columns stand on square marble plinths (0.95 m); planters are gilded urns.
  for (const [x, z] of c.columns) world.addBox(x, z, 0.95, 0.95, 0, 'column');
  for (const [x, z] of c.planters) world.addCircle(x, z, 0.45, 'planter');
  // Window sills on the north wall (all but the middle bay, which is the doors).
  for (const wx of [-12, -6, 6, 12]) world.addBox(wx, -HALL.d / 2 + 0.38, 3.7, 0.2, 0, 'wall');
  // Lanterns either side of the terrace doors.
  for (const lx of [-2.4, 2.4]) world.addCircle(lx, TERRACE.z1 - 0.3, 0.12, 'lamp');
  world.addSurface('carpet', -12, -3, -11, 6);
  world.addSurface('carpet', 5.6, 13.6, -0.3, 8.7);
  world.addSurface('stone', -12, 12, -20, -14.05);
}

export function buildCasino(scene: THREE.Scene, renderer: THREE.WebGLRenderer, q: Quality): Casino {
  const root = new THREE.Group();
  root.name = 'casino';
  scene.add(root);
  const tex = q.texSize;
  const aniso = Math.min(q.anisotropy, renderer.capabilities.getMaxAnisotropy());

  // --- Lighting -----------------------------------------------------------------
  scene.background = new THREE.Color(0x120c08);
  scene.environment = assets.envHdr ? hdrEnvironment(renderer, assets.envHdr) : warmEnvironment(renderer);
  scene.environmentIntensity = 0.6;
  const hemi = new THREE.HemisphereLight(0xffdcae, 0x3a1810, 0.42);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffe6c4, 0.8);
  key.position.set(-4, 12, 6);
  key.target.position.set(-2, 0, 0);
  scene.add(key, key.target);
  if (q.shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const c = key.shadow.camera;
    c.left = -14;
    c.right = 14;
    c.top = 12;
    c.bottom = -12;
    c.near = 1;
    c.far = 30;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
  }
  const pools: [number, number][] = [
    [POSITIONS.roulette.x, POSITIONS.roulette.z - 1.2],
    [POSITIONS.slots.x + SLOTS_FWD.x * 1.2, POSITIONS.slots.z + SLOTS_FWD.z * 1.2],
    [ROTUNDA.x, ROTUNDA.z],
    [POSITIONS.craps.x, POSITIONS.craps.z - 1],
    [0, 10],
    [11, 8],
  ];
  pools.slice(0, q.pointLights).forEach(([x, z]) => {
    const l = new THREE.PointLight(0xffc98a, 16, 11, 1.6);
    l.position.set(x, 4.0, z);
    scene.add(l);
  });

  // --- Materials ------------------------------------------------------------------
  const floorTex = toTexture(floorTile(tex / 2, assets.image('marble')), { aniso });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(HALL.w / 2, HALL.d / 2);
  const floorMaps = assets.pbr('marble', [HALL.w / 2, HALL.d / 2]);
  const floorMat = new THREE.MeshPhysicalMaterial({
    map: floorTex,
    // Scanned marble relief and polish variation (Poly Haven), one per tile.
    normalMap: floorMaps?.normalMap ?? null,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughnessMap: floorMaps?.roughnessMap ?? null,
    roughness: floorMaps ? 0.32 : 0.12,
    metalness: 0,
    clearcoat: q.name === 'desktop' ? 0.6 : 0,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.3,
    // A touch darker than raw cream marble so light pools and reflections read.
    color: new THREE.Color(0.82, 0.8, 0.77),
  });
  const carpetTex = toTexture(carpet(tex / 2), { aniso });
  carpetTex.wrapS = carpetTex.wrapT = THREE.RepeatWrapping;
  const carpetMat = new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 0.97, envMapIntensity: 0.3 });
  const wallTex = toTexture(damask(1024), { aniso });
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
  wallTex.repeat.set(1, 1);
  const wallMat = new THREE.MeshPhysicalMaterial({ map: wallTex, roughness: 0.6, sheen: 0.6, sheenRoughness: 0.4, sheenColor: new THREE.Color(0xfff0d0) });
  const woodTex = toTexture(wood(512), { aniso });
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
  const woodMat = assets.material('walnut', { repeat: [6, 1], rough: 0.7, envIntensity: 0.8, fallback: () => new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.4, envMapIntensity: 0.8 }) });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 1, roughness: 0.28, envMapIntensity: 1.4 });
  const columnTex = toTexture(marble(tex / 4, 'cream', 9), { aniso });
  columnTex.wrapS = columnTex.wrapT = THREE.RepeatWrapping;
  columnTex.repeat.set(2, 3);
  const columnMat = assets.material('marble', { repeat: [1.5, 2.5], rough: 0.4, normal: 0.4, envIntensity: 1.1, fallback: () => new THREE.MeshStandardMaterial({ map: columnTex, roughness: 0.18, envMapIntensity: 1.1 }) });
  const ceilingMat = new THREE.MeshStandardMaterial({ color: 0xe8d6b4, roughness: 0.7, emissive: 0x3a2410, emissiveIntensity: 0.45 });
  // Softly lit brass for the rails: the room glows a little at night.
  const goldGlow = new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 1, roughness: 0.3, emissive: 0xb07020, emissiveIntensity: 0.55 });
  const darkMarbleTex = toTexture(marble(256, 'dark', 4), { aniso });
  const darkMarble = assets.material('darkmarble', { repeat: 1, rough: 0.45, tint: 0x9a7a6a, envIntensity: 1.1, fallback: () => new THREE.MeshStandardMaterial({ map: darkMarbleTex, roughness: 0.2 }) });

  const batch = new Batcher();
  const box = new THREE.BoxGeometry(1, 1, 1);
  // Box UVs scaled per-face are not needed for these solids; textures are noisy enough.

  // --- Floor ----------------------------------------------------------------------
  // Polished marble mirrors the room (desktop): a planar reflection at quarter resolution
  // (soft, like real polished stone), faded by a mask so the carpets don't reflect.
  if (q.name === 'desktop') root.add(marbleReflection(HALL.w, HALL.d));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALL.w, HALL.d), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = q.shadows;
  floor.name = 'floor';
  root.add(floor);

  const carpetPatch = (x: number, z: number, w: number, d: number) => {
    const g = new THREE.PlaneGeometry(w, d);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 2.4), uv.getY(i) * (d / 2.4));
    const mesh = new THREE.Mesh(g, carpetMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.004, z);
    mesh.receiveShadow = q.shadows;
    root.add(mesh);
    // Gold border strip.
    for (const [bx, bz, bw, bd] of [
      [x, z - d / 2, w + 0.12, 0.12],
      [x, z + d / 2, w + 0.12, 0.12],
      [x - w / 2, z, 0.12, d],
      [x + w / 2, z, 0.12, d],
    ]) {
      batch.add(box, gold, M(bx, 0.006, bz, 0, bw, 0.012, bd));
    }
  };
  carpetPatch(-7.5, -2.5, 9, 17);
  carpetPatch(9.6, 4.2, 8, 9);

  // --- Walls ----------------------------------------------------------------------
  const { w: W, d: D, h: H } = HALL;
  const wallPanel = (x: number, z: number, len: number, ry: number, y0 = 0, y1 = H) => {
    const h = y1 - y0;
    const g = new THREE.PlaneGeometry(len, h);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (len / 1.6), uv.getY(i) * (h / 1.6));
    batch.add(g, wallMat, M(x, y0 + h / 2, z, ry));
  };
  // Wainscot + rails along a wall segment.
  const trim = (x: number, z: number, len: number, ry: number) => {
    const inward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    const at = (off: number) => [x + inward.x * off, z + inward.z * off] as const;
    const [wx, wz] = at(0.05);
    batch.add(box, woodMat, M(wx, 0.55, wz, ry, len, 1.1, 0.1));
    const [gx, gz] = at(0.11);
    batch.add(box, goldGlow, M(gx, 1.12, gz, ry, len, 0.05, 0.05));
    batch.add(box, gold, M(gx, 0.08, gz, ry, len, 0.16, 0.04));
    const [cx, cz] = at(0.12);
    batch.add(box, gold, M(cx, H - 0.25, cz, ry, len, 0.12, 0.2));
    batch.add(box, ceilingMat, M(cx, H - 0.1, cz, ry, len, 0.2, 0.26));
  };
  // South, east, west walls.
  wallPanel(0, D / 2, W, Math.PI);
  trim(0, D / 2, W, Math.PI);
  wallPanel(-W / 2, 0, D, Math.PI / 2);
  trim(-W / 2, 0, D, Math.PI / 2);
  // East wall, with the grand opening to the hotel tower (corridor z 4.6–8.4, 4.2 m high).
  wallPanel(W / 2, (-D / 2 + 4.6) / 2, 4.6 + D / 2, -Math.PI / 2);
  trim(W / 2, (-D / 2 + 4.6) / 2, 4.6 + D / 2, -Math.PI / 2);
  wallPanel(W / 2, (8.4 + D / 2) / 2, D / 2 - 8.4, -Math.PI / 2);
  trim(W / 2, (8.4 + D / 2) / 2, D / 2 - 8.4, -Math.PI / 2);
  wallPanel(W / 2, 6.5, 3.8, -Math.PI / 2, 4.2, H);

  // North wall with five tall windows onto the lake.
  const windowsX = [-12, -6, 0, 6, 12];
  const winW = 3.4,
    winY0 = 1.1,
    winY1 = 5.3;
  const doorHalf = winW / 2;
  wallPanel((-W / 2 - doorHalf) / 2, -D / 2, W / 2 - doorHalf, 0, 0, winY0);
  wallPanel((W / 2 + doorHalf) / 2, -D / 2, W / 2 - doorHalf, 0, 0, winY0);
  wallPanel(0, -D / 2, W, 0, winY1, H);
  let edge = -W / 2;
  for (const wx of windowsX) {
    const l = wx - winW / 2;
    wallPanel((edge + l) / 2, -D / 2, l - edge, 0, winY0, winY1);
    edge = wx + winW / 2;
    const isDoor = wx === 0;
    // Gold frame + mullions (the door has a threshold instead of a sill).
    if (!isDoor) batch.add(box, gold, M(wx, winY0, -D / 2 + 0.06, 0, winW + 0.2, 0.12, 0.14));
    batch.add(box, gold, M(wx, winY1, -D / 2 + 0.06, 0, winW + 0.2, 0.12, 0.14));
    const y0 = isDoor ? 0 : winY0;
    batch.add(box, gold, M(wx - winW / 2, (y0 + winY1) / 2, -D / 2 + 0.06, 0, 0.12, winY1 - y0, 0.3));
    batch.add(box, gold, M(wx + winW / 2, (y0 + winY1) / 2, -D / 2 + 0.06, 0, 0.12, winY1 - y0, 0.3));
    if (isDoor) {
      batch.add(box, gold, M(wx, DOOR_H + 0.03, -D / 2, 0, winW, 0.08, 0.3));
      batch.add(box, darkMarble, M(wx, 0.004, -D / 2, 0, winW, 0.008, 0.5));
      continue;
    }
    batch.add(box, gold, M(wx, (winY0 + winY1) / 2, -D / 2 + 0.02, 0, 0.05, winY1 - winY0, 0.05));
    batch.add(box, gold, M(wx, winY0 + (winY1 - winY0) * 0.62, -D / 2 + 0.02, 0, winW, 0.05, 0.05));
    batch.add(box, darkMarble, M(wx, winY0 - 0.05, -D / 2 + 0.25, 0, winW + 0.3, 0.1, 0.4));
  }
  wallPanel((edge + W / 2) / 2, -D / 2, W / 2 - edge, 0, winY0, winY1);
  trim((-W / 2 - doorHalf - 0.06) / 2, -D / 2, W / 2 - doorHalf - 0.06, 0);
  trim((W / 2 + doorHalf + 0.06) / 2, -D / 2, W / 2 - doorHalf - 0.06, 0);

  // Entrance doors on the south wall.
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x1b1410, metalness: 0.6, roughness: 0.15, envMapIntensity: 1.5 });
  for (const dx of [-1.3, 1.3]) {
    const door = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 3.4), doorMat);
    door.position.set(dx, 1.7, D / 2 - 0.13);
    door.rotation.y = Math.PI;
    root.add(door);
    batch.add(box, gold, M(dx, 3.45, D / 2 - 0.12, 0, 2.5, 0.12, 0.1));
    batch.add(box, gold, M(dx - 1.2, 1.7, D / 2 - 0.12, 0, 0.1, 3.5, 0.1));
    batch.add(box, gold, M(dx + 1.2, 1.7, D / 2 - 0.12, 0, 0.1, 3.5, 0.1));
  }

  // --- Ceiling: vaulted bays with gilded scrollwork, lit from hidden coves ------------
  root.add(buildCeiling({ w: W, d: D, h: H, rotunda: ROTUNDA }, q, gold));
  // Silk pavilions over the table games, as at the Bellagio.
  root.add(buildCanopy({ x: POSITIONS.roulette.x - 0.2, z: POSITIONS.roulette.z - 0.4, w: 6.2, d: 5.2, edge: 4.75, peak: 5.85, colors: ['#7a1424', '#b88a2e'] }, q));
  root.add(buildCanopy({ x: POSITIONS.craps.x, z: POSITIONS.craps.z, w: 6.6, d: 5.0, edge: 4.75, peak: 5.85, colors: ['#4a1a5e', '#b88a2e'] }, q));
  // Marble pilasters with sconces along the walls (not behind the bar).
  root.add(
    buildPilasters(
      [
        { from: [-W / 2, D / 2], to: [W / 2, D / 2], inward: [0, -1], every: 3, skip: (x) => Math.abs(x) < 3.2 },
        { from: [W / 2, -D / 2], to: [W / 2, D / 2], inward: [-1, 0], every: 3.5, skip: (_x, z) => z > 3.9 && z < 9.1 },
        { from: [-W / 2, -D / 2], to: [-W / 2, D / 2], inward: [1, 0], every: 3.5, skip: (_x, z) => z > 4.5 },
      ],
      H,
      { marble: columnMat, gold },
    ),
  );
  // Rotunda: a ring beam and a glowing dome above the glass flowers.
  const ringGeo = new THREE.TorusGeometry(ROTUNDA.r + 0.4, 0.22, 10, 64);
  const ring = new THREE.Mesh(ringGeo, gold);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(ROTUNDA.x, H - 0.3, ROTUNDA.z);
  root.add(ring);
  // The dome glows from behind the glass flowers (bright enough to bloom).
  const domeTex = toTexture(radial(512, '#fff6e4', '#c98a44'));
  const domeMat = new THREE.MeshBasicMaterial({ map: domeTex, side: THREE.BackSide });
  domeMat.color.setScalar(1.25);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(ROTUNDA.r + 0.6, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
  dome.scale.y = (ROTUNDA.h - H) / (ROTUNDA.r + 0.6);
  dome.position.set(ROTUNDA.x, H - 0.05, ROTUNDA.z);
  root.add(dome);
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(ROTUNDA.r + 0.6, ROTUNDA.r + 0.6, 0.6, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xf1e3c6, side: THREE.BackSide, roughness: 0.6 }),
  );
  drum.position.set(ROTUNDA.x, H - 0.05, ROTUNDA.z);
  root.add(drum);
  root.add(glassFlowers(q));

  // --- Columns ------------------------------------------------------------------
  const columnSpots: [number, number][] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    columnSpots.push([ROTUNDA.x + Math.cos(a) * (ROTUNDA.r + 0.6), ROTUNDA.z + Math.sin(a) * (ROTUNDA.r + 0.6)]);
  }
  columnSpots.push([-13, -7], [-13, 6], [14, -7], [14, 4], [3, -10]);
  const shaft = new THREE.CylinderGeometry(0.3, 0.34, H - 1.3, 24, 1);
  const capital = new THREE.CylinderGeometry(0.46, 0.3, 0.38, 24, 1);
  const baseRing = new THREE.CylinderGeometry(0.42, 0.46, 0.2, 24, 1);
  for (const [x, z] of columnSpots) {
    batch.add(box, darkMarble, M(x, 0.3, z, 0, 0.95, 0.6, 0.95));
    batch.add(baseRing, gold, M(x, 0.7, z));
    batch.add(shaft, columnMat, M(x, 0.8 + (H - 1.3) / 2, z));
    batch.add(capital, gold, M(x, H - 0.69, z));
    batch.add(box, ceilingMat, M(x, H - 0.3, z, 0, 1, 0.3, 1));
  }

  // --- Planters with topiary (the conservatory touch) ------------------------------------
  const urn = new THREE.LatheGeometry(
    [
      [0.18, 0],
      [0.32, 0.08],
      [0.34, 0.3],
      [0.26, 0.55],
      [0.4, 0.75],
      [0.42, 0.8],
    ].map(([r, y]) => new THREE.Vector2(r, y)),
    24,
  );
  const planters: [number, number][] = [
    [-3.4, 11],
    [3.4, 11],
    [-16.5, -12.5],
    [16.5, -12.5],
    [16.5, 12.5],
    [3.2, -5],
    [-4.2, -12.8],
    [4.2, -12.8],
  ];
  const leafGeo = new THREE.IcosahedronGeometry(0.5, 1);
  const leaves = new THREE.InstancedMesh(
    leafGeo,
    new THREE.MeshStandardMaterial({ color: 0x2f5a2a, roughness: 0.9, flatShading: true }),
    planters.length * 3,
  );
  const blooms = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.06, 0),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
    planters.length * 24,
  );
  let li = 0,
    bi = 0;
  const bloomColors = [0xf4a3b5, 0xffd27a, 0xffffff, 0xd96a8a];
  const tmp = new THREE.Object3D();
  for (const [x, z] of planters) {
    batch.add(urn, gold, M(x, 0, z));
    for (let k = 0; k < 3; k++) {
      tmp.position.set(x, 1.15 + k * 0.42, z);
      tmp.scale.setScalar(0.85 - k * 0.22);
      tmp.rotation.set(k, k * 2, 0);
      tmp.updateMatrix();
      leaves.setMatrixAt(li++, tmp.matrix);
    }
    for (let k = 0; k < 24; k++) {
      const a = k * 2.4,
        y = 0.9 + (k / 24) * 1.1;
      const r = 0.42 * (1 - (k / 24) * 0.55);
      tmp.position.set(x + Math.cos(a) * r, y, z + Math.sin(a) * r);
      tmp.scale.setScalar(1);
      tmp.updateMatrix();
      blooms.setMatrixAt(bi, tmp.matrix);
      blooms.setColorAt(bi++, new THREE.Color(bloomColors[k % 4]));
    }
  }
  root.add(leaves, blooms);

  // --- Chandeliers ------------------------------------------------------------------
  const chandelierSpots: [number, number][] = [
    [POSITIONS.roulette.x, POSITIONS.roulette.z - 1.3],
    [POSITIONS.craps.x, POSITIONS.craps.z - 1],
    [POSITIONS.slots.x + SLOTS_FWD.x * 1.5, POSITIONS.slots.z + SLOTS_FWD.z * 1.5],
    [0, 9.5],
    [-12, 9],
    [12, -9],
    [-13, -1],
  ];
  root.add(chandeliers(chandelierSpots, q, gold));
  // Warm light falling from each chandelier onto the floor below, and its soft reflection
  // in the polished marble: what makes a casino floor glow instead of looking evenly lit.
  {
    const poolTex = toTexture(radial(128, 'rgba(255,196,120,0.42)', 'rgba(255,160,80,0)'));
    const coreTex = toTexture(radial(64, 'rgba(255,236,200,0.55)', 'rgba(255,200,140,0)'));
    const poolM = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const coreM = new THREE.MeshBasicMaterial({ map: coreTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const [x, z] of chandelierSpots) {
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), poolM);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x, 0.013, z);
      root.add(pool);
      const core = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), coreM);
      core.rotation.x = -Math.PI / 2;
      core.position.set(x, 0.014, z);
      root.add(core);
    }
  }

  // --- Lake view and fountains beyond the windows -------------------------------------
  const lake = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 70),
    new THREE.MeshBasicMaterial({ map: toTexture(lakeView(2048, 900)), toneMapped: false }),
  );
  lake.position.set(0, 10, -D / 2 - 70);
  root.add(lake);
  const reflTex = toTexture(lakeReflection(1024, 512));
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 70),
    new THREE.MeshStandardMaterial({ color: 0x050a1c, roughness: 0.08, metalness: 0.3, envMapIntensity: 0.25, emissive: 0xffffff, emissiveMap: reflTex, emissiveIntensity: 0.9 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, LAKE_Y, -D / 2 - 35);
  root.add(water);
  const terraceParts = buildTerrace(root, batch, box, { gold, darkMarble, wallMat, q });
  const fountains = fountainShow();
  fountains.position.set(0, LAKE_Y, -D / 2 - 26);
  root.add(fountains);
  const doors = frenchDoors();
  root.add(doors.group);

  // --- Contact shadows (cheap baked look under objects) -----------------------------------
  const shadowTex = toTexture(radial(128, 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'));
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
  const blob = (x: number, z: number, sx: number, sz: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), shadowMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.008, z);
    root.add(m);
  };
  for (const [x, z] of columnSpots) blob(x, z, 1.8, 1.8);
  // Warm uplight pools around the column bases (one merged additive draw).
  const poolMat = new THREE.MeshBasicMaterial({ map: toTexture(radial(128, 'rgba(255,180,90,0.55)', 'rgba(255,140,60,0)')), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  for (const [x, z] of columnSpots) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), poolMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.01, z);
    root.add(m);
  }
  for (const [x, z] of planters) blob(x, z, 1.4, 1.4);

  // --- Signage ------------------------------------------------------------------
  const brand = textSign('Palazzo Lago', { width: 4.4, px: 150, sub: 'RESORT  ·  CASINO' });
  brand.position.set(0, 4.5, D / 2 - 0.2);
  brand.rotation.y = Math.PI;
  root.add(brand);
  const slotSign = textSign('Slots', { width: 2.6, px: 150, sub: 'DIAMOND SEVENS  ·  LAGO FORTUNA  ·  ROYAL CONSERVATORY', bg: 'rgba(16,10,8,0.85)' });
  slotSign.position.copy(POSITIONS.slots).addScaledVector(SLOTS_FWD, -0.5).setY(2.85);
  slotSign.rotation.y = SLOTS_YAW;
  root.add(slotSign);

  batch.build(root, q.shadows);
  fountains.userData.dynamic = true;
  doors.group.userData.dynamic = true;
  void terraceParts;
  bakeStatic(root, { shadows: q.shadows });

  // --- Mood: light the place you're in like it would be at night ----------------------------
  // Casino: warm and glowing. Hotel corridors: warm, a touch dimmer. Outdoors (terrace,
  // pool deck): moonlit night with cool fill, the warmth coming from fixtures. Suite: lamps.
  const MOODS = {
    casino: { exp: 0.68, hemi: 0.42, sky: new THREE.Color(0xffdcae), ground: new THREE.Color(0x3a1810), key: 0.8, keyC: new THREE.Color(0xffe6c4), env: 0.55 },
    hotel: { exp: 0.8, hemi: 0.36, sky: new THREE.Color(0xffd8a8), ground: new THREE.Color(0x30160c), key: 0.35, keyC: new THREE.Color(0xffe0b8), env: 0.5 },
    outside: { exp: 0.95, hemi: 0.2, sky: new THREE.Color(0x5a74a8), ground: new THREE.Color(0x1c140e), key: 0.38, keyC: new THREE.Color(0xa8bcff), env: 0.28 },
    suite: { exp: 0.9, hemi: 0.2, sky: new THREE.Color(0xffd0a0), ground: new THREE.Color(0x1a100a), key: 0.12, keyC: new THREE.Color(0xffe0c0), env: 0.32 },
  };
  let lastT = -1;
  const mood = (f: THREE.Vector3, t: number) => {
    const zone = f.x > 500 ? 'suite' : f.x > 21 && f.z < -0.2 ? 'outside' : f.x > 17.5 ? 'hotel' : f.z < -14.2 ? 'outside' : 'casino';
    const m = MOODS[zone];
    const dt = lastT < 0 ? 1 : Math.min(0.1, t - lastT);
    lastT = t;
    const k = lastT < 0 ? 1 : Math.min(1, dt * 2.5);
    hemi.intensity += (m.hemi - hemi.intensity) * k;
    hemi.color.lerp(m.sky, k);
    hemi.groundColor.lerp(m.ground, k);
    key.intensity += (m.key - key.intensity) * k;
    key.color.lerp(m.keyC, k);
    scene.environmentIntensity += (m.env - scene.environmentIntensity) * k;
    renderer.toneMappingExposure += (m.exp - renderer.toneMappingExposure) * k;
  };

  return {
    root,
    floor,
    columns: columnSpots,
    planters,
    doorsOpen: () => doors.open,
    fountainLevel: () => fountains.userData.level as number,
    fountainAnchor: fountains,
    update(t: number, player?: THREE.Vector3) {
      (fountains.userData.update as (t: number) => void)(t);
      if (player) {
        doors.update(player);
        mood(player, t);
      }
    },
  };
}

/** A soft planar reflection over the marble (not the carpet patches). Desktop only. */
function marbleReflection(w: number, d: number): THREE.Object3D {
  const mask = document.createElement('canvas');
  mask.width = 512;
  mask.height = Math.round((512 * d) / w);
  const g = mask.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, mask.width, mask.height);
  g.fillStyle = '#000000';
  const toPx = (x: number, z: number) => [((x + w / 2) / w) * mask.width, ((z + d / 2) / d) * mask.height];
  for (const [cx, cz, cw, cd] of [[-7.5, -2.5, 9.3, 17.3], [9.6, 4.2, 8.3, 9.3]]) {
    const [x0, y0] = toPx(cx - cw / 2, cz - cd / 2);
    const [x1, y1] = toPx(cx + cw / 2, cz + cd / 2);
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  const maskTex = new THREE.CanvasTexture(mask);
  const refl = new Reflector(new THREE.PlaneGeometry(w, d), {
    textureWidth: 512,
    textureHeight: Math.round((512 * d) / w),
    clipBias: 0.003,
    shader: {
      name: 'MarbleReflection',
      uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, tMask: { value: maskTex } },
      vertexShader: /* glsl */ `
        uniform mat4 textureMatrix;
        varying vec4 vUvR;
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          vUv = uv;
          vUvR = textureMatrix * vec4(position, 1.0);
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tMask;
        varying vec4 vUvR;
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          vec3 base = texture2DProj(tDiffuse, vUvR).rgb;
          // Cheap blur: a few taps around the projected coordinate.
          vec2 p = vUvR.xy / vUvR.w;
          vec3 b = base;
          b += texture2D(tDiffuse, p + vec2(0.004, 0.0)).rgb;
          b += texture2D(tDiffuse, p - vec2(0.004, 0.0)).rgb;
          b += texture2D(tDiffuse, p + vec2(0.0, 0.006)).rgb;
          b += texture2D(tDiffuse, p - vec2(0.0, 0.006)).rgb;
          b /= 5.0;
          float m = texture2D(tMask, vec2(vUv.x, 1.0 - vUv.y)).r;
          vec3 v = normalize(cameraPosition - vWorld);
          float fres = 0.12 + 0.5 * pow(1.0 - clamp(v.y, 0.0, 1.0), 3.0);
          gl_FragColor = vec4(b, m * fres);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    },
  });
  const mat = refl.material as THREE.ShaderMaterial;
  mat.transparent = true;
  mat.depthWrite = false;
  refl.rotation.x = -Math.PI / 2;
  refl.position.y = 0.003;
  refl.renderOrder = 1;
  refl.raycast = () => {};
  refl.userData.dynamic = true;
  return refl;
}

/** Reflections from the real ballroom HDRI (Poly Haven, CC0), prefiltered for PBR. */
function hdrEnvironment(renderer: THREE.WebGLRenderer, hdr: THREE.Texture): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromEquirectangular(hdr);
  pmrem.dispose();
  return rt.texture;
}

/** A warm, bright environment map for reflections on gold, marble and lacquer. */
function warmEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(20, 8, 20),
    new THREE.MeshBasicMaterial({ color: 0x3a2318, side: THREE.BackSide }),
  );
  env.add(room);
  const panel = (x: number, y: number, z: number, w: number, d: number, color: number, intensity: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) }));
    m.position.set(x, y, z);
    m.rotation.x = Math.PI / 2;
    env.add(m);
  };
  for (let x = -6; x <= 6; x += 4) for (let z = -6; z <= 6; z += 4) panel(x, 3.9, z, 2.2, 2.2, 0xffd6a0, 3);
  panel(0, 3.95, 0, 5, 5, 0xfff1d8, 4);
  const floorM = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ color: 0x5a2a1e }));
  floorM.rotation.x = -Math.PI / 2;
  floorM.position.y = -3.9;
  env.add(floorM);
  for (const [x, z, ry] of [[0, -9.9, 0], [0, 9.9, Math.PI], [9.9, 0, -Math.PI / 2], [-9.9, 0, Math.PI / 2]] as const) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(20, 3), new THREE.MeshBasicMaterial({ color: 0xc9a27a }));
    wall.position.set(x, 0, z);
    wall.rotation.y = ry;
    env.add(wall);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.035);
  pmrem.dispose();
  return rt.texture;
}

/**
 * The rotunda's ceiling of hand-blown glass (an original piece in the spirit of
 * the Bellagio lobby): ruffled blossoms layered under the glowing dome, with
 * twisted, tapering horns hanging below. The glass shader lets colour glow
 * through thin edges and brightens at grazing angles, and the bloom pass
 * makes it shine.
 */
function glassFlowers(q: Quality): THREE.Group {
  const g = new THREE.Group();
  // Ruffled blossom: a shallow bell with a strongly fluted, wavy rim.
  const bloom = new THREE.LatheGeometry(
    [[0.0, 0.02], [0.05, 0.0], [0.12, -0.03], [0.2, -0.09], [0.27, -0.17], [0.31, -0.24], [0.3, -0.28]].map(([r, y]) => new THREE.Vector2(r, y)),
    28,
  );
  {
    const pos = bloom.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        z = pos.getZ(i),
        y = pos.getY(i);
      const a = Math.atan2(z, x);
      const edge = Math.min(1, -y * 4);
      const k = 1 + Math.sin(a * 7) * 0.12 * edge;
      pos.setXYZ(i, x * k, y + Math.sin(a * 7 + 1) * 0.05 * edge, z * k);
    }
    bloom.computeVertexNormals();
  }
  // Twisted horn: a tapering tube along a loose helix.
  const hornCurve = new THREE.CatmullRomCurve3(
    Array.from({ length: 9 }, (_, i) => {
      const t = i / 8;
      return new THREE.Vector3(Math.cos(t * 5) * 0.08 * (1 - t), -t * 0.9, Math.sin(t * 5) * 0.08 * (1 - t));
    }),
  );
  const horn = new THREE.TubeGeometry(hornCurve, 24, 0.05, 8, false);
  {
    const pos = horn.attributes.position as THREE.BufferAttribute;
    const n = 25;
    for (let i = 0; i < pos.count; i++) {
      const ring = Math.floor(i / 9);
      const t = ring / (n - 1);
      const p = hornCurve.getPoint(t);
      const taper = 1 - t * 0.85;
      pos.setXYZ(i, p.x + (pos.getX(i) - p.x) * taper, p.y + (pos.getY(i) - p.y) * taper, p.z + (pos.getZ(i) - p.z) * taper);
    }
    horn.computeVertexNormals();
  }
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.08, metalness: 0.0, envMapIntensity: 2.0 });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      #ifdef USE_INSTANCING_COLOR
        float facing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
        float rim = 1.0 - facing;
        // Light passing through the glass: strongest through thin, face-on parts.
        totalEmissiveRadiance += vColor * (0.9 + 1.6 * facing * facing + 1.2 * rim * rim * rim);
      #endif`,
    );
  };
  const tmp = new THREE.Object3D();
  let s = 9;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const palette = [0xff6a1a, 0xffb020, 0xff3a4a, 0x7a3ad9, 0x1aa0e0, 0xffe040, 0xe8206a, 0x3ac45a, 0x20c8c0, 0xff8a30];
  const colour = () => {
    const c = new THREE.Color(palette[Math.floor(rnd() * palette.length)]);
    c.offsetHSL((rnd() - 0.5) * 0.03, 0.1, (rnd() - 0.5) * 0.1);
    return c.multiplyScalar(0.55);
  };
  const nb = q.flowers;
  const blooms = new THREE.InstancedMesh(bloom, mat, nb);
  for (let i = 0; i < nb; i++) {
    const r = Math.sqrt(rnd()) * (ROTUNDA.r - 0.1);
    const a = rnd() * Math.PI * 2;
    const depth = (1 - (r / ROTUNDA.r) ** 2) * 1.5;
    tmp.position.set(ROTUNDA.x + Math.cos(a) * r, HALL.h + 0.55 + depth * 0.55 - rnd() * 0.55, ROTUNDA.z + Math.sin(a) * r);
    tmp.rotation.set((rnd() - 0.5) * 1.3, rnd() * Math.PI * 2, (rnd() - 0.5) * 1.3);
    tmp.scale.setScalar(0.55 + rnd() * 1.0);
    tmp.updateMatrix();
    blooms.setMatrixAt(i, tmp.matrix);
    blooms.setColorAt(i, colour());
  }
  const nh = Math.round(nb * 0.18);
  const horns = new THREE.InstancedMesh(horn, mat, nh);
  for (let i = 0; i < nh; i++) {
    const r = Math.sqrt(rnd()) * (ROTUNDA.r - 0.5);
    const a = rnd() * Math.PI * 2;
    tmp.position.set(ROTUNDA.x + Math.cos(a) * r, HALL.h + 0.25 - rnd() * 0.4, ROTUNDA.z + Math.sin(a) * r);
    tmp.rotation.set((rnd() - 0.5) * 0.5, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.5);
    tmp.scale.setScalar(0.7 + rnd() * 0.8);
    tmp.updateMatrix();
    horns.setMatrixAt(i, tmp.matrix);
    horns.setColorAt(i, colour());
  }
  g.add(blooms, horns);
  return g;
}

function chandeliers(spots: [number, number][], q: Quality, gold: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const crystalGeo = new THREE.OctahedronGeometry(0.035, 0);
  crystalGeo.scale(1, 1.8, 1);
  const crystalMat = new THREE.MeshStandardMaterial({
    color: 0xfff6e8,
    metalness: 0.1,
    roughness: 0.02,
    envMapIntensity: 2.6,
    emissive: 0x4a3a20,
    flatShading: true,
  });
  const n = q.crystals;
  const crystals = new THREE.InstancedMesh(crystalGeo, crystalMat, spots.length * n);
  const glowTex = toTexture(radial(128, 'rgba(255,226,170,1)', 'rgba(255,190,110,0)'));
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 });
  const bulbGeo = new THREE.SphereGeometry(0.03, 8, 6);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff0d0 });
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, spots.length * 12);
  const tmp = new THREE.Object3D();
  let ci = 0,
    bi = 0;
  const ringA = new THREE.TorusGeometry(0.55, 0.025, 8, 40);
  const ringB = new THREE.TorusGeometry(0.32, 0.02, 8, 32);
  const rod = new THREE.CylinderGeometry(0.015, 0.015, 1.2, 6);
  const parts = new Batcher();
  for (const [x, z] of spots) {
    const y = 4.5;
    parts.add(ringA, gold, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new THREE.Vector3(1, 1, 1)));
    parts.add(ringB, gold, new THREE.Matrix4().compose(new THREE.Vector3(x, y + 0.35, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new THREE.Vector3(1, 1, 1)));
    parts.add(rod, gold, M(x, y + 0.9, z));
    for (let k = 0; k < n; k++) {
      const tier = k % 3;
      const a = (k / n) * Math.PI * 2 * 3 + tier;
      const r = [0.55, 0.42, 0.3][tier];
      const drop = [-0.18, -0.38, -0.56][tier] + ((k * 7) % 5) * -0.02;
      tmp.position.set(x + Math.cos(a) * r, y + drop, z + Math.sin(a) * r);
      tmp.rotation.set(0, a, 0);
      tmp.scale.setScalar(1);
      tmp.updateMatrix();
      crystals.setMatrixAt(ci++, tmp.matrix);
    }
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const r = k % 2 ? 0.55 : 0.32;
      tmp.position.set(x + Math.cos(a) * r, y + (k % 2 ? 0.06 : 0.41), z + Math.sin(a) * r);
      tmp.updateMatrix();
      bulbs.setMatrixAt(bi++, tmp.matrix);
    }
    const glow = new THREE.Sprite(glowMat);
    glow.position.set(x, y + 0.1, z);
    glow.scale.setScalar(1.5);
    g.add(glow);
  }
  crystals.count = ci;
  parts.build(g, false);
  g.add(crystals, bulbs);
  return g;
}

/** Choreographed fountain jets on the lake: additive glowing water columns. */
function fountainShow(): THREE.Group {
  const g = new THREE.Group();
  const [c, ctx] = (() => {
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 256;
    return [cv, cv.getContext('2d')!] as const;
  })();
  // A water column: a bright core near the base, breaking into spray toward the top.
  const img = ctx.createImageData(64, 256);
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < 256; y++) {
    const v = y / 255; // 0 top, 1 base
    const width = 0.12 + (1 - v) * 0.3;
    for (let x = 0; x < 64; x++) {
      const u = (x - 31.5) / 32;
      const core = Math.exp(-((u / width) ** 2) * 2.2);
      const spray = rnd() < 0.25 * (1 - v) ? 0.6 : 0;
      const fade = Math.min(1, v * 4) * (0.55 + 0.45 * v);
      const a = Math.min(1, (core * (0.5 + 0.5 * v) + spray * core * 0.8) * fade);
      const i = (y * 64 + x) * 4;
      img.data[i] = 225;
      img.data[i + 1] = 236;
      img.data[i + 2] = 255;
      img.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  // Two crossed planes per jet, all jets in one instanced draw.
  const a = new THREE.PlaneGeometry(1, 1);
  const b = new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2);
  const jetGeo = mergeGeometries([a, b])!;
  jetGeo.translate(0, 0.5, 0);
  const count = 48;
  const jets = new THREE.InstancedMesh(jetGeo, mat, count);
  jets.frustumCulled = false;
  g.add(jets);
  // Spray crowns at the top of each jet and mist hanging over the water at the base.
  const puffTex = toTexture(radial(128, 'rgba(235,242,255,0.28)', 'rgba(220,232,255,0)'));
  const puffMat = new THREE.MeshBasicMaterial({ map: puffTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const puffGeo = mergeGeometries([new THREE.PlaneGeometry(1, 1), new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2), new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2)])!;
  const crowns = new THREE.InstancedMesh(puffGeo, puffMat, count);
  const mists = new THREE.InstancedMesh(puffGeo, puffMat, count);
  crowns.frustumCulled = mists.frustumCulled = false;
  g.add(crowns, mists);
  const tmp = new THREE.Object3D();
  g.userData.level = 0;
  g.userData.update = (time: number) => {
    // A 70-second show: gentle wave, alternating bursts, a travelling sweep, then a finale.
    const cycle = time % 70;
    let total = 0;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      let h: number;
      if (cycle < 18) h = 0.35 + 0.3 * Math.sin(time * 1.6 - t * 9);
      else if (cycle < 34) h = Math.max(0, Math.sin((time * 1.4) % Math.PI)) * (i % 2 ? 0.9 : 0.5);
      else if (cycle < 52) h = 0.15 + 0.8 * Math.exp(-(((t - ((cycle - 34) / 18)) * 5) ** 2));
      else if (cycle < 66) {
        const k = (cycle - 52) / 14;
        h = Math.min(1, 0.4 + k * 0.7) * (0.85 + 0.15 * Math.sin(time * 6 + i));
      } else h = Math.max(0.05, 1 - (cycle - 66) / 4);
      total += h;
      tmp.position.set((t - 0.5) * 90, 0, Math.sin(t * Math.PI) * -12);
      // In the bursts and the finale the jets fan out in pairs, like a choreographed show.
      const fan = cycle >= 18 && cycle < 34 ? (i % 2 ? 0.16 : -0.16) : cycle >= 52 ? Math.sin(i * 1.7) * 0.12 : 0;
      tmp.rotation.set(0, 0, fan);
      tmp.scale.set(1.6 + h * 2.4, 4 + h * 26, 1.6 + h * 2.4);
      tmp.updateMatrix();
      jets.setMatrixAt(i, tmp.matrix);
      const top = 4 + h * 26;
      const jx = tmp.position.x,
        jz = tmp.position.z;
      tmp.rotation.set(0, time * 0.3 + i, 0);
      tmp.position.set(jx + Math.sin(fan) * -top, top * Math.cos(fan) - 1, jz);
      tmp.scale.set(1.2 + h * 2.6, 2 + h * 5, 1.2 + h * 2.6);
      tmp.updateMatrix();
      crowns.setMatrixAt(i, tmp.matrix);
      tmp.position.set(jx, 1.2, jz);
      tmp.scale.set(3 + h * 4, 1 + h * 1.6, 3 + h * 4);
      tmp.updateMatrix();
      mists.setMatrixAt(i, tmp.matrix);
    }
    g.userData.level = total / count;
    jets.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    mists.instanceMatrix.needsUpdate = true;
  };
  return g;
}

/** Stone terrace over the lake: balustrade, lanterns, the building's outer face, and the night sky. */
function buildTerrace(
  root: THREE.Object3D,
  batch: { add(g: THREE.BufferGeometry, m: THREE.Material, mat: THREE.Matrix4): void },
  box: THREE.BufferGeometry,
  m: { gold: THREE.Material; darkMarble: THREE.Material; wallMat: THREE.Material; q: Quality },
) {
  const { x0, x1, z0, z1 } = TERRACE;
  const w = x1 - x0,
    d = z1 - z0;
  const stoneTex = toTexture(marble(512, 'cream', 41));
  stoneTex.wrapS = stoneTex.wrapT = THREE.RepeatWrapping;
  const stoneGeo = new THREE.PlaneGeometry(w, d);
  const uv = stoneGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 2), uv.getY(i) * (d / 2));
  const stone = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.55, color: 0xeee4d2 });
  const floor = new THREE.Mesh(stoneGeo, stone);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((x0 + x1) / 2, 0.002, (z0 + z1) / 2);
  root.add(floor);
  // Slab edge and the cliff of the building below it.
  batch.add(box, stone, M((x0 + x1) / 2, -0.25, z0 - 0.05, 0, w + 0.3, 0.5, 0.2));
  batch.add(box, stone, M((x0 + x1) / 2, -3.6, z1 - 0.4, 0, w + 6, 7.2, 0.8));
  // Balustrade: posts, rail, and end walls.
  for (let x = x0 + 0.2; x <= x1 - 0.2; x += 0.32) batch.add(new THREE.CylinderGeometry(0.045, 0.06, 0.78, 8), stone, M(x, 0.42, z0 + 0.15));
  batch.add(box, stone, M((x0 + x1) / 2, 0.06, z0 + 0.15, 0, w, 0.12, 0.3));
  batch.add(box, stone, M((x0 + x1) / 2, 0.86, z0 + 0.15, 0, w + 0.1, 0.12, 0.34));
  for (const x of [x0, x1]) {
    batch.add(box, stone, M(x, 0.5, (z0 + z1) / 2, 0, 0.3, 1.0, d));
    batch.add(box, stone, M(x, 1.05, (z0 + z1) / 2, 0, 0.36, 0.1, d));
  }
  // Lanterns on the corners and either side of the doors.
  const glowTex = toTexture(radial(128, 'rgba(255,214,150,1)', 'rgba(255,170,90,0)'));
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe2a8 });
  for (const [lx, lz] of [[x0 + 0.3, z0 + 0.3], [x1 - 0.3, z0 + 0.3], [-2.4, z1 - 0.3], [2.4, z1 - 0.3]]) {
    batch.add(new THREE.CylinderGeometry(0.04, 0.06, 2.2, 8), m.gold, M(lx, 1.1, lz));
    batch.add(new THREE.SphereGeometry(0.13, 12, 8), lampMat, M(lx, 2.3, lz));
    const glow = new THREE.Sprite(glowMat);
    glow.position.set(lx, 2.3, lz);
    glow.scale.setScalar(1.8);
    root.add(glow);
  }
  // Outer face of the north wall, with openings for the windows and the doors.
  const face = new THREE.Shape();
  face.moveTo(-HALL.w / 2, 0);
  face.lineTo(HALL.w / 2, 0);
  face.lineTo(HALL.w / 2, HALL.h + 0.6);
  face.lineTo(-HALL.w / 2, HALL.h + 0.6);
  face.closePath();
  for (const wx of [-12, -6, 0, 6, 12]) {
    const y0 = wx === 0 ? 0.001 : 1.1;
    const hole = new THREE.Path();
    hole.moveTo(wx - 1.7, y0);
    hole.lineTo(wx + 1.7, y0);
    hole.lineTo(wx + 1.7, 5.3);
    hole.lineTo(wx - 1.7, 5.3);
    hole.closePath();
    face.holes.push(hole);
  }
  const facade = new THREE.Mesh(new THREE.ShapeGeometry(face), stone.clone());
  (facade.material as THREE.Material).side = THREE.DoubleSide;
  facade.rotation.y = Math.PI;
  facade.position.set(0, 0, -HALL.d / 2 - 0.12);
  facade.scale.x = -1;
  root.add(facade);
  // Window reveals so the openings have depth from outside.
  for (const wx of [-12, -6, 0, 6, 12]) {
    const y0 = wx === 0 ? 0 : 1.1;
    batch.add(box, stone, M(wx, 5.35, -HALL.d / 2 - 0.06, 0, 3.6, 0.1, 0.14));
    for (const sx of [-1.75, 1.75]) batch.add(box, stone, M(wx + sx, (y0 + 5.3) / 2, -HALL.d / 2 - 0.06, 0, 0.1, 5.3 - y0, 0.14));
  }
  batch.add(box, m.gold, M(0, HALL.h + 0.55, -HALL.d / 2 - 0.2, 0, HALL.w, 0.12, 0.2));
  // Night sky dome, seen from the terrace and through the windows.
  const sky = document.createElement('canvas');
  sky.width = 1024;
  sky.height = 512;
  const g = sky.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#02030a');
  grad.addColorStop(0.55, '#0b1230');
  grad.addColorStop(0.75, '#2a2a4a');
  grad.addColorStop(1, '#2a2a4a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 512);
  let seed = 5;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.7})`;
    const sz = r() < 0.95 ? 1 : 2;
    g.fillRect(r() * 1024, r() * 300, sz, sz);
  }
  const skyTex = new THREE.CanvasTexture(sky);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false, toneMapped: false }));
  dome.position.set(0, 0, -40);
  dome.renderOrder = -1;
  root.add(dome);
  return { floor, facade };
}

/** Two glass doors that swing out onto the terrace as you approach. */
function frenchDoors() {
  const group = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 1, roughness: 0.25 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xbfd8ff, transparent: true, opacity: 0.16, roughness: 0.02, metalness: 0.8, envMapIntensity: 2, depthWrite: false, side: THREE.DoubleSide });
  const leafW = 1.6;
  const leaves: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(side * 1.65, 0, -HALL.d / 2);
    const leaf = new THREE.Group();
    const cx = -side * leafW / 2;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(leafW - 0.1, DOOR_H - 0.1), glass);
    pane.position.set(cx, DOOR_H / 2, 0);
    leaf.add(pane);
    const frame = (w: number, h: number, x: number, y: number) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), gold);
      b.position.set(x, y, 0);
      leaf.add(b);
    };
    frame(leafW, 0.06, cx, 0.03);
    frame(leafW, 0.06, cx, DOOR_H - 0.03);
    frame(0.06, DOOR_H, cx - leafW / 2 + 0.03, DOOR_H / 2);
    frame(0.06, DOOR_H, cx + leafW / 2 - 0.03, DOOR_H / 2);
    frame(leafW, 0.03, cx, DOOR_H * 0.62);
    frame(0.03, DOOR_H, cx, DOOR_H / 2);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8), gold);
    handle.position.set(-side * (leafW - 0.15), 1.05, 0.05);
    leaf.add(handle);
    leaf.traverse((o) => (o.raycast = () => {}));
    hinge.add(leaf);
    group.add(hinge);
    leaves.push(hinge);
  }
  const state = { open: 0 };
  return {
    group,
    get open() {
      return state.open;
    },
    update(player: THREE.Vector3) {
      const near = Math.hypot(player.x, player.z + HALL.d / 2) < 3.2;
      const target = near ? 1 : 0;
      state.open += (target - state.open) * 0.06;
      // Doors swing outward onto the terrace.
      leaves[0].rotation.y = state.open * 1.45;
      leaves[1].rotation.y = -state.open * 1.45;
    },
  };
}
