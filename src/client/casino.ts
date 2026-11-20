import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Quality } from './quality';
import { carpet, damask, floorTile, lakeView, marble, radial, toTexture, wood } from './textures';
import { textSign } from './panel';
import { bakeStatic } from './merge';

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
  update(t: number): void;
}

export function buildCasino(scene: THREE.Scene, renderer: THREE.WebGLRenderer, q: Quality): Casino {
  const root = new THREE.Group();
  root.name = 'casino';
  scene.add(root);
  const tex = q.texSize;
  const aniso = Math.min(q.anisotropy, renderer.capabilities.getMaxAnisotropy());

  // --- Lighting -----------------------------------------------------------------
  scene.background = new THREE.Color(0x120c08);
  scene.environment = warmEnvironment(renderer);
  scene.environmentIntensity = 0.75;
  const hemi = new THREE.HemisphereLight(0xffe4c0, 0x5a2a1c, 1.25);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff0d8, 1.4);
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
    const l = new THREE.PointLight(0xffc98a, 9, 9, 1.8);
    l.position.set(x, 4.2, z);
    scene.add(l);
  });

  // --- Materials ------------------------------------------------------------------
  const floorTex = toTexture(floorTile(tex / 2), { aniso });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(HALL.w / 2, HALL.d / 2);
  const floorMat = new THREE.MeshPhysicalMaterial({
    map: floorTex,
    roughness: 0.12,
    metalness: 0,
    clearcoat: q.name === 'desktop' ? 0.6 : 0,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.3,
  });
  const carpetTex = toTexture(carpet(tex / 2), { aniso });
  carpetTex.wrapS = carpetTex.wrapT = THREE.RepeatWrapping;
  const carpetMat = new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 0.95 });
  const wallTex = toTexture(damask(512), { aniso });
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
  wallTex.repeat.set(1, 1);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85 });
  const woodTex = toTexture(wood(512), { aniso });
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
  const woodMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.4, envMapIntensity: 0.8 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 1, roughness: 0.28, envMapIntensity: 1.4 });
  const columnTex = toTexture(marble(tex / 4, 'cream', 9), { aniso });
  columnTex.wrapS = columnTex.wrapT = THREE.RepeatWrapping;
  columnTex.repeat.set(2, 3);
  const columnMat = new THREE.MeshStandardMaterial({ map: columnTex, roughness: 0.18, envMapIntensity: 1.1 });
  const ceilingMat = new THREE.MeshStandardMaterial({ color: 0xf1e3c6, roughness: 0.7, emissive: 0x3a2a14, emissiveIntensity: 0.6 });
  const cofferGlow = new THREE.MeshBasicMaterial({ color: 0xffe2b0, toneMapped: true });
  const darkMarbleTex = toTexture(marble(256, 'dark', 4), { aniso });
  const darkMarble = new THREE.MeshStandardMaterial({ map: darkMarbleTex, roughness: 0.2 });

  const batch = new Batcher();
  const box = new THREE.BoxGeometry(1, 1, 1);
  // Box UVs scaled per-face are not needed for these solids; textures are noisy enough.

  // --- Floor ----------------------------------------------------------------------
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
    batch.add(box, gold, M(gx, 1.12, gz, ry, len, 0.05, 0.05));
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
  wallPanel(W / 2, 0, D, -Math.PI / 2);
  trim(W / 2, 0, D, -Math.PI / 2);

  // North wall with five tall windows onto the lake.
  const windowsX = [-12, -6, 0, 6, 12];
  const winW = 3.4,
    winY0 = 1.1,
    winY1 = 5.3;
  wallPanel(0, -D / 2, W, 0, 0, winY0);
  wallPanel(0, -D / 2, W, 0, winY1, H);
  let edge = -W / 2;
  for (const wx of windowsX) {
    const l = wx - winW / 2;
    wallPanel((edge + l) / 2, -D / 2, l - edge, 0, winY0, winY1);
    edge = wx + winW / 2;
    // Gold frame + mullions.
    batch.add(box, gold, M(wx, winY0, -D / 2 + 0.06, 0, winW + 0.2, 0.12, 0.14));
    batch.add(box, gold, M(wx, winY1, -D / 2 + 0.06, 0, winW + 0.2, 0.12, 0.14));
    batch.add(box, gold, M(wx - winW / 2, (winY0 + winY1) / 2, -D / 2 + 0.06, 0, 0.12, winY1 - winY0, 0.14));
    batch.add(box, gold, M(wx + winW / 2, (winY0 + winY1) / 2, -D / 2 + 0.06, 0, 0.12, winY1 - winY0, 0.14));
    batch.add(box, gold, M(wx, (winY0 + winY1) / 2, -D / 2 + 0.02, 0, 0.05, winY1 - winY0, 0.05));
    batch.add(box, gold, M(wx, winY0 + (winY1 - winY0) * 0.62, -D / 2 + 0.02, 0, winW, 0.05, 0.05));
    batch.add(box, darkMarble, M(wx, winY0 - 0.05, -D / 2 + 0.25, 0, winW + 0.3, 0.1, 0.4));
  }
  wallPanel((edge + W / 2) / 2, -D / 2, W / 2 - edge, 0, winY0, winY1);
  trim(0, -D / 2, W, 0);

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

  // --- Ceiling: coffers everywhere except over the rotunda -----------------------------
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), ceilingMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  root.add(ceil);
  const step = 2;
  for (let x = -W / 2 + step; x < W / 2; x += step) {
    for (let z = -D / 2 + step; z < D / 2; z += step) {
      const inRotunda = Math.hypot(x - ROTUNDA.x, z - ROTUNDA.z) < ROTUNDA.r + 0.8;
      if (inRotunda) continue;
      batch.add(box, ceilingMat, M(x, H - 0.16, z, 0, 0.22, 0.32, 0.22));
      batch.add(box, ceilingMat, M(x - step / 2, H - 0.16, z, 0, step - 0.22, 0.3, 0.18));
      batch.add(box, ceilingMat, M(x, H - 0.16, z - step / 2, 0, 0.18, 0.3, step - 0.22));
      batch.add(box, gold, M(x - step / 2, H - 0.32, z, 0, step - 0.22, 0.03, 0.2));
      batch.add(box, gold, M(x, H - 0.32, z - step / 2, 0, 0.2, 0.03, step - 0.22));
      // Softly glowing coffer panel.
      batch.add(box, cofferGlow, M(x - step / 2, H - 0.02, z - step / 2, 0, step * 0.55, 0.01, step * 0.55));
    }
  }
  // Rotunda: a ring beam and a glowing dome above the glass flowers.
  const ringGeo = new THREE.TorusGeometry(ROTUNDA.r + 0.4, 0.22, 10, 64);
  const ring = new THREE.Mesh(ringGeo, gold);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(ROTUNDA.x, H - 0.3, ROTUNDA.z);
  root.add(ring);
  const domeTex = toTexture(radial(512, '#fff4dc', '#d9a35a'));
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(ROTUNDA.r + 0.6, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: domeTex, side: THREE.BackSide }),
  );
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
    [-16.5, 12.5],
    [16.5, 12.5],
    [3.2, -5],
    [-0.5, -12.5],
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

  // --- Lake view and fountains beyond the windows -------------------------------------
  const lake = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 70),
    new THREE.MeshBasicMaterial({ map: toTexture(lakeView(2048, 900)), toneMapped: false }),
  );
  lake.position.set(0, 14, -D / 2 - 70);
  root.add(lake);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 70),
    new THREE.MeshStandardMaterial({ color: 0x0a1230, roughness: 0.05, metalness: 0.2, envMapIntensity: 0.3 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -1.5, -D / 2 - 35);
  root.add(water);
  // Terrace balustrade just outside.
  for (let x = -W / 2; x <= W / 2; x += 0.5) batch.add(box, wallMat, M(x, -0.4, -D / 2 - 3, 0, 0.12, 1, 0.12));
  batch.add(box, wallMat, M(0, 0.12, -D / 2 - 3, 0, W, 0.12, 0.3));
  const terrace = new THREE.Mesh(new THREE.PlaneGeometry(W, 3), darkMarble);
  terrace.rotation.x = -Math.PI / 2;
  terrace.position.set(0, -0.9, -D / 2 - 1.5);
  root.add(terrace);
  const fountains = fountainShow();
  fountains.position.set(0, -1.5, -D / 2 - 26);
  root.add(fountains);

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
  bakeStatic(root, { shadows: q.shadows });

  let fountainT = 0;
  return {
    root,
    floor,
    update(t: number) {
      fountainT = t;
      (fountains.userData.update as (t: number) => void)(fountainT);
    },
  };
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

/** The rotunda's ceiling of glass flowers: original design, backlit by the dome. */
function glassFlowers(q: Quality): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.LatheGeometry(
    [
      [0.0, 0.0],
      [0.06, -0.02],
      [0.16, -0.06],
      [0.24, -0.16],
      [0.27, -0.24],
      [0.25, -0.27],
    ].map(([r, y]) => new THREE.Vector2(r, y)),
    10,
  );
  // Ruffle the rim so each bloom reads as hand-blown glass.
  const pos = shape.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      z = pos.getZ(i),
      y = pos.getY(i);
    const a = Math.atan2(z, x);
    pos.setY(i, y + Math.sin(a * 5) * 0.03 * Math.min(1, -y * 5));
  }
  shape.computeVertexNormals();
  // Glossy glass that also glows in its own colour (instance colour fed into emissive).
  const mat = new THREE.MeshStandardMaterial({
    side: THREE.DoubleSide,
    roughness: 0.12,
    metalness: 0.0,
    envMapIntensity: 1.6,
    transparent: false,
  });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      #ifdef USE_INSTANCING_COLOR
        float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition)));
        totalEmissiveRadiance += vColor * (0.55 + 0.9 * rim * rim);
      #endif`,
    );
  };
  const mesh = new THREE.InstancedMesh(shape, mat, q.flowers);
  const palette = [0xff7a3c, 0xffb238, 0xf25c7a, 0x8f5bd9, 0x4fb3d9, 0xffd45c, 0xe8467c, 0x6fd17a, 0xff9a5c];
  const tmp = new THREE.Object3D();
  let s = 9;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < q.flowers; i++) {
    const r = Math.sqrt(rnd()) * (ROTUNDA.r - 0.2);
    const a = rnd() * Math.PI * 2;
    const depth = (1 - (r / ROTUNDA.r) ** 2) * 1.6;
    tmp.position.set(ROTUNDA.x + Math.cos(a) * r, HALL.h + 0.2 + depth * 0.6 - rnd() * 0.5, ROTUNDA.z + Math.sin(a) * r);
    tmp.rotation.set((rnd() - 0.5) * 0.7, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.7);
    tmp.scale.setScalar(0.6 + rnd() * 1.1);
    tmp.updateMatrix();
    mesh.setMatrixAt(i, tmp.matrix);
    const c = new THREE.Color(palette[Math.floor(rnd() * palette.length)]);
    c.offsetHSL(0, 0, (rnd() - 0.5) * 0.15);
    mesh.setColorAt(i, c);
  }
  g.add(mesh);
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
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
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
    glow.scale.setScalar(2.6);
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
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.15, 'rgba(230,240,255,0.7)');
  grad.addColorStop(1, 'rgba(200,220,255,0.9)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 256);
  const side = ctx.createLinearGradient(0, 0, 64, 0);
  side.addColorStop(0, 'rgba(0,0,0,1)');
  side.addColorStop(0.5, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, 64, 256);
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
  const count = 36;
  const jets = new THREE.InstancedMesh(jetGeo, mat, count);
  jets.frustumCulled = false;
  g.add(jets);
  const tmp = new THREE.Object3D();
  g.userData.update = (time: number) => {
    // Phrases cycle every 24 s: wave, burst, sweep.
    const phase = (time % 24) / 24;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      let h: number;
      if (phase < 0.33) h = 0.5 + 0.5 * Math.sin(time * 2.2 - t * 9);
      else if (phase < 0.66) h = Math.max(0, Math.sin((time * 1.4) % Math.PI)) * (i % 2 ? 1 : 0.6);
      else h = Math.exp(-(((t - ((time * 0.35) % 1)) * 6) ** 2));
      tmp.position.set((t - 0.5) * 90, 0, Math.sin(t * Math.PI) * -12);
      tmp.scale.set(1.2 + h * 1.4, 3 + h * 22, 1.2 + h * 1.4);
      tmp.updateMatrix();
      jets.setMatrixAt(i, tmp.matrix);
    }
    jets.instanceMatrix.needsUpdate = true;
  };
  return g;
}
