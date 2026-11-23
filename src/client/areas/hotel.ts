import * as THREE from 'three';
import { textSign } from '../panel';
import type { Quality } from '../quality';
import type { World } from '../world';
import { canvas, toTexture } from '../textures';
import { Batch, haloQuad, M, plane, wallQuad, type Mats } from './kit';

/**
 * The way to the hotel: a grand corridor through the casino's east wall to the
 * elevator lobby (Bellagio-style: marble, gilt, a great flower arrangement
 * under a chandelier), with a doorway north onto the pool deck. Also the
 * building exteriors you see from the pool.
 */

export const CORR = { x0: 18, x1: 30, z0: 4.6, z1: 8.4, h: 4.2 };
export const LOBBY = { x0: 30, x1: 42, z0: 0, z1: 12, h: 5 };
export const POOL_DOOR = { x0: 34.5, x1: 37.5, h: 3.2 };
export const LOBBY_CARS = [2.2, 4.75, 7.25, 9.8];

export function registerHotel(world: World) {
  // A little overlap with the casino rect so the doorway joins them.
  world.addWalkable(17.2, CORR.x1 + 0.4, CORR.z0 + 0.3, CORR.z1 - 0.3);
  world.addWalkable(LOBBY.x0 + 0.3, LOBBY.x1 - 0.3, LOBBY.z0 + 0.3, LOBBY.z1 - 0.3);
  world.addWalkable(POOL_DOOR.x0 + 0.3, POOL_DOOR.x1 - 0.3, -3.2, LOBBY.z0 + 0.6);
  world.addSurface('marble', 18, 42, 0, 12);
  // The great flower table in the middle of the lobby.
  world.addCircle(36, 6, 1.45);
}

export function buildHotel(scene: THREE.Scene, q: Quality, m: Mats): THREE.Group {
  const b = new Batch();
  const root = new THREE.Group();
  root.name = 'hotel';
  scene.add(root);

  // --- Corridor -------------------------------------------------------------------
  const C = CORR;
  const cw = C.z1 - C.z0,
    cl = C.x1 - C.x0,
    cz = (C.z0 + C.z1) / 2;
  b.add(plane(cl + 0.4, cw, 1), m.marble, M((C.x0 + C.x1) / 2, 0.002, cz));
  b.box(m.darkMarble, (C.x0 + C.x1) / 2, 0.006, cz, cl, 0.004, 1.2);
  b.box(m.gold, (C.x0 + C.x1) / 2, 0.008, cz - 0.62, cl, 0.004, 0.05);
  b.box(m.gold, (C.x0 + C.x1) / 2, 0.008, cz + 0.62, cl, 0.004, 0.05);
  b.add(plane(cl, cw, 1, false), m.cream, M((C.x0 + C.x1) / 2, C.h, cz));
  for (const [z, ry] of [
    [C.z0, 0],
    [C.z1, Math.PI],
  ] as const) {
    const inward = ry === 0 ? 1 : -1;
    b.add(wallQuad(cl, C.h), m.wall, M((C.x0 + C.x1) / 2, C.h / 2, z, ry));
    // Walnut wainscot, gilt rail, crown and cove light.
    b.box(m.walnut, (C.x0 + C.x1) / 2, 0.55, z + inward * 0.05, cl, 1.1, 0.1);
    b.box(m.gold, (C.x0 + C.x1) / 2, 1.12, z + inward * 0.11, cl, 0.05, 0.05);
    b.box(m.cream, (C.x0 + C.x1) / 2, C.h - 0.15, z + inward * 0.12, cl, 0.3, 0.24);
    b.box(m.glowWarm, (C.x0 + C.x1) / 2, C.h - 0.31, z + inward * 0.2, cl, 0.02, 0.04);
    // Pilasters with sconces between.
    for (let x = C.x0 + 1.5; x < C.x1; x += 3) {
      b.box(m.marble, x, C.h / 2, z + inward * 0.08, 0.42, C.h - 0.3, 0.14);
      b.box(m.gold, x, C.h - 0.4, z + inward * 0.1, 0.52, 0.2, 0.18);
      const sx = x + 1.5;
      if (sx < C.x1 - 0.5) {
        b.box(m.gold, sx, 2.3, z + inward * 0.04, 0.14, 0.3, 0.03);
        b.add(new THREE.CylinderGeometry(0.07, 0.1, 0.16, 12, 1, true), m.glowWarm, M(sx, 2.45, z + inward * 0.16));
        const h = haloQuad(m, 1.3);
        h.position.set(sx, 2.45, z + inward * 0.03);
        h.rotation.y = ry;
        root.add(h);
      }
    }
  }
  // Console tables with flowers, and paintings.
  for (const x of [21, 27]) {
    b.box(m.walnut, x, 0.8, C.z0 + 0.35, 1.4, 0.05, 0.45);
    b.box(m.gold, x - 0.6, 0.4, C.z0 + 0.35, 0.05, 0.8, 0.05);
    b.box(m.gold, x + 0.6, 0.4, C.z0 + 0.35, 0.05, 0.8, 0.05);
    flowers(b, m, x, 0.83, C.z0 + 0.35, 0.35);
    painting(root, x, 2.35, C.z1 - 0.06, Math.PI, x * 7);
  }
  for (const x of [20.5, 24, 27.5]) chandelier(b, root, m, x, C.h - 0.2, cz, 0.45);
  // Signs.
  const toHotel = textSign('Hotel Tower', { width: 2.6, px: 120, sub: 'ELEVATORS  ·  POOL  ·  SUITES', bg: 'rgba(16,10,8,0.85)' });
  toHotel.position.set(17.85, 4.75, cz);
  toHotel.rotation.y = -Math.PI / 2;
  root.add(toHotel);
  // Portal frame on the casino side of the opening.
  b.box(m.gold, 17.92, C.h / 2, C.z0 - 0.1, 0.16, C.h, 0.2);
  b.box(m.gold, 17.92, C.h / 2, C.z1 + 0.1, 0.16, C.h, 0.2);
  b.box(m.gold, 17.92, C.h + 0.08, cz, 0.18, 0.16, cw + 0.4);

  // --- Elevator lobby ---------------------------------------------------------------
  const L = LOBBY;
  const lw = L.x1 - L.x0,
    ld = L.z1 - L.z0,
    lx = (L.x0 + L.x1) / 2,
    lz = (L.z0 + L.z1) / 2;
  b.add(plane(lw, ld, 1), m.marble, M(lx, 0.002, lz));
  const medallion = new THREE.Mesh(new THREE.CircleGeometry(3.2, 64), new THREE.MeshStandardMaterial({ map: toTexture(compass(1024)), roughness: 0.3, envMapIntensity: 1.1, polygonOffset: true, polygonOffsetFactor: -1 }));
  medallion.rotation.x = -Math.PI / 2;
  medallion.position.set(36, 0.004, 6);
  root.add(medallion);
  b.add(plane(lw, ld, 1, false), m.cream, M(lx, L.h, lz));
  // Coffered ceiling ring and cove.
  b.add(new THREE.TorusGeometry(3.6, 0.18, 8, 64).rotateX(Math.PI / 2), m.gold, M(36, L.h - 0.2, 6));
  b.add(new THREE.TorusGeometry(3.4, 0.04, 6, 64).rotateX(Math.PI / 2), m.glowWarm, M(36, L.h - 0.08, 6));
  chandelier(b, root, m, 36, L.h - 0.3, 6, 1.0);
  // Walls with their openings: [axis position, from, to, facing yaw, openings].
  const wallRun = (fixed: 'x' | 'z', at: number, from: number, to: number, ry: number, holes: [number, number, number][]) => {
    const H = L.h;
    let cur = from;
    const seg = (a: number, c: number, y0: number, y1: number) => {
      if (c - a < 0.01 || y1 - y0 < 0.01) return;
      const mid = (a + c) / 2,
        len = c - a;
      const mtx = fixed === 'x' ? M(at, (y0 + y1) / 2, mid, ry) : M(mid, (y0 + y1) / 2, at, ry);
      b.add(wallQuad(len, y1 - y0), m.wall, mtx);
      if (y0 === 0) {
        const inward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
        const px = fixed === 'x' ? at + inward.x * 0.05 : mid,
          pz = fixed === 'x' ? mid : at + inward.z * 0.05;
        b.box(m.walnut, px, 0.55, pz, fixed === 'x' ? 0.1 : len, 1.1, fixed === 'x' ? len : 0.1);
        b.box(m.gold, px + inward.x * 0.06, 1.12, pz + inward.z * 0.06, fixed === 'x' ? 0.05 : len, 0.05, fixed === 'x' ? len : 0.05);
      }
    };
    for (const [a, c, h] of holes.sort((p, q2) => p[0] - q2[0])) {
      seg(cur, a, 0, H);
      seg(a, c, h, H);
      cur = c;
    }
    seg(cur, to, 0, H);
    // Crown moulding.
    const inward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    const len = to - from,
      mid = (from + to) / 2;
    b.box(m.cream, fixed === 'x' ? at + inward.x * 0.12 : mid, H - 0.15, fixed === 'x' ? mid : at + inward.z * 0.12, fixed === 'x' ? 0.24 : len, 0.3, fixed === 'x' ? len : 0.24);
    b.box(m.gold, fixed === 'x' ? at + inward.x * 0.25 : mid, H - 0.32, fixed === 'x' ? mid : at + inward.z * 0.25, fixed === 'x' ? 0.04 : len, 0.05, fixed === 'x' ? len : 0.04);
  };
  wallRun('x', L.x0, L.z0, L.z1, Math.PI / 2, [[C.z0, C.z1, C.h]]);
  wallRun('z', L.z0, L.x0, L.x1, 0, [[POOL_DOOR.x0, POOL_DOOR.x1, POOL_DOOR.h]]);
  wallRun('z', L.z1, L.x0, L.x1, Math.PI, []);
  wallRun(
    'x',
    L.x1,
    L.z0,
    L.z1,
    -Math.PI / 2,
    LOBBY_CARS.map((z) => [z - 0.83, z + 0.83, 2.6] as [number, number, number]),
  );
  // Pool doors: tall glass doors standing open, gilt frame, and a sign.
  for (const s of [-1, 1]) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.45, 3.0, 0.04), glassMat());
    door.position.set(36 + s * 2.1, 1.5, L.z0 - 0.7);
    door.rotation.y = s * 1.2;
    root.add(door);
  }
  b.box(m.gold, POOL_DOOR.x0 - 0.06, POOL_DOOR.h / 2, L.z0, 0.14, POOL_DOOR.h, 0.2);
  b.box(m.gold, POOL_DOOR.x1 + 0.06, POOL_DOOR.h / 2, L.z0, 0.14, POOL_DOOR.h, 0.2);
  b.box(m.gold, 36, POOL_DOOR.h + 0.06, L.z0, POOL_DOOR.x1 - POOL_DOOR.x0 + 0.3, 0.14, 0.2);
  const poolSign = textSign('Pool Deck', { width: 1.8, px: 120, sub: 'OPEN LATE  ·  DJ TONIGHT', bg: 'rgba(16,10,8,0.85)' });
  poolSign.position.set(36, 4.05, L.z0 + 0.06);
  root.add(poolSign);
  const liftSign = textSign('Elevators', { width: 1.6, px: 120, sub: 'SUITES  ·  POOL  ·  CASINO', bg: 'rgba(16,10,8,0.85)' });
  liftSign.position.set(L.x1 - 0.06, 3.6, 6);
  liftSign.rotation.y = -Math.PI / 2;
  root.add(liftSign);
  // The great flower table under the chandelier.
  b.add(new THREE.CylinderGeometry(1.3, 1.35, 0.08, 40), m.walnut, M(36, 0.78, 6));
  b.add(new THREE.CylinderGeometry(0.25, 0.6, 0.76, 24), m.gold, M(36, 0.38, 6));
  flowers(b, m, 36, 0.82, 6, 1.2, 140);
  // Seating: two curved benches, and planters by the walls.
  for (const s of [-1, 1]) {
    b.box(m.walnut, 32, 0.22, 6 + s * 3.2, 1.8, 0.44, 0.6);
    b.box(new THREE.MeshStandardMaterial({ color: 0x6a1428, roughness: 0.85 }), 32, 0.5, 6 + s * 3.2, 1.7, 0.12, 0.55);
  }
  for (const [x, z] of [
    [30.7, 0.8],
    [30.7, 11.2],
    [41.2, 0.8],
    [41.2, 11.2],
  ]) {
    b.add(new THREE.CylinderGeometry(0.32, 0.22, 0.7, 20), m.gold, M(x, 0.35, z));
    flowers(b, m, x, 0.7, z, 0.4, 26);
  }
  painting(root, 36, 2.6, L.z1 - 0.06, Math.PI, 99, 2.4, 1.5);

  // --- Exteriors seen from the pool deck -------------------------------------------------
  // Hotel tower facade (north face of the lobby), with the pool doorway.
  const towerTex = toTexture(towerFacade(1024, 2048));
  towerTex.wrapS = towerTex.wrapT = THREE.RepeatWrapping;
  const towerMat = new THREE.MeshBasicMaterial({ map: towerTex, toneMapped: true });
  const towerMat2 = towerMat;
  const facade = (x0: number, x1: number, y0: number, y1: number) => {
    const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (x0 + uv.getX(i) * (x1 - x0)) / 12, (y0 + uv.getY(i) * (y1 - y0)) / 24);
    g.rotateY(Math.PI);
    b.add(g, towerMat2, M((x0 + x1) / 2, (y0 + y1) / 2, L.z0 - 0.12));
  };
  facade(18, POOL_DOOR.x0 - 0.1, 0, 72);
  facade(POOL_DOOR.x1 + 0.1, 66, 0, 72);
  facade(POOL_DOOR.x0 - 0.1, POOL_DOOR.x1 + 0.1, POOL_DOOR.h + 0.15, 72);
  // Stone base and canopy over the pool doors.
  b.box(m.stone, (18 + POOL_DOOR.x0) / 2 - 0.1, 1.6, L.z0 - 0.25, POOL_DOOR.x0 - 18 - 0.2, 3.2, 0.2);
  b.box(m.stone, (POOL_DOOR.x1 + 66) / 2 + 0.1, 1.6, L.z0 - 0.25, 66 - POOL_DOOR.x1 - 0.2, 3.2, 0.2);
  b.box(m.cream, 36, POOL_DOOR.h + 0.35, L.z0 - 1.0, 5, 0.12, 2.0);
  b.box(m.glowWarm, 36, POOL_DOOR.h + 0.28, L.z0 - 1.0, 4.4, 0.01, 1.6);
  // Casino building's east face (west edge of the pool deck).
  const casinoTex = toTexture(arcade(1024, 512));
  casinoTex.wrapS = THREE.RepeatWrapping;
  const cg = new THREE.PlaneGeometry(40, 14);
  const cuv = cg.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < cuv.count; i++) cuv.setX(i, cuv.getX(i) * 5);
  cg.rotateY(Math.PI / 2);
  b.add(cg, new THREE.MeshBasicMaterial({ map: casinoTex }), M(21.9, 7, -18));
  // Holes in the lobby east wall are framed by the elevator module.
  b.build(root, 'hotel-static');
  return root;
}

function glassMat() {
  return new THREE.MeshStandardMaterial({ color: 0xbfd8e0, transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0.6, envMapIntensity: 1.8 });
}

/** A ball of mixed blooms (instanced-looking but merged into the batch as small icosahedra). */
export function flowers(b: Batch, m: Mats, x: number, y: number, z: number, r: number, n = 60) {
  let s = Math.floor(x * 31 + z * 17) || 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pal = [0xf4a3b5, 0xffd27a, 0xffffff, 0xd96a8a, 0xf2865a, 0xc8a0e8];
  const leaf = m.glow(0x2f5a2a, 0.55);
  b.add(new THREE.SphereGeometry(r * 0.85, 12, 8), leaf, M(x, y + r * 0.7, z));
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2,
      e = Math.acos(rnd() * 0.9);
    const p = new THREE.Vector3(Math.cos(a) * Math.sin(e), Math.cos(e), Math.sin(a) * Math.sin(e)).multiplyScalar(r * 0.9);
    b.add(new THREE.IcosahedronGeometry(r * (0.1 + rnd() * 0.06), 0), m.glow(pal[i % pal.length], 0.85), M(x + p.x, y + r * 0.7 + p.y * 0.9, z + p.z));
  }
}

/** Gilt ring chandelier with glass drops and a warm glow. */
export function chandelier(b: Batch, root: THREE.Object3D, m: Mats, x: number, y: number, z: number, s: number) {
  b.add(new THREE.TorusGeometry(0.55 * s, 0.025 * s, 8, 40).rotateX(Math.PI / 2), m.gold, M(x, y - 0.3 * s, z));
  b.add(new THREE.TorusGeometry(0.32 * s, 0.02 * s, 8, 32).rotateX(Math.PI / 2), m.gold, M(x, y, z));
  b.add(new THREE.CylinderGeometry(0.012, 0.012, 0.5 * s, 6), m.gold, M(x, y + 0.2 * s, z));
  const drop = new THREE.OctahedronGeometry(0.035 * s, 0).scale(1, 1.8, 1);
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2,
      r = (k % 2 ? 0.55 : 0.4) * s;
    b.add(drop, m.glow(0xfff4e0, 1.3), M(x + Math.cos(a) * r, y - (k % 2 ? 0.45 : 0.6) * s, z + Math.sin(a) * r));
  }
  b.add(new THREE.SphereGeometry(0.12 * s, 12, 8), m.glowWarm, M(x, y - 0.35 * s, z));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: m.halo.map, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7 }));
  glow.position.set(x, y - 0.35 * s, z);
  glow.scale.setScalar(2.2 * s);
  root.add(glow);
}

function painting(root: THREE.Object3D, x: number, y: number, z: number, ry: number, seed: number, w = 1.2, h = 0.9) {
  const [c, g] = canvas(512, 384);
  let s = seed || 3;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const grd = g.createLinearGradient(0, 0, 0, 384);
  grd.addColorStop(0, '#f3dcae');
  grd.addColorStop(1, '#b97a4a');
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 384);
  // Loose floral still life.
  for (let i = 0; i < 26; i++) {
    g.fillStyle = ['#c0304a', '#f2a03a', '#f7e3c0', '#7a3a8a', '#3a6a3a'][i % 5];
    g.globalAlpha = 0.75;
    g.beginPath();
    g.ellipse(180 + rnd() * 160, 90 + rnd() * 160, 18 + rnd() * 30, 14 + rnd() * 26, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  g.fillStyle = '#6a4a2a';
  g.fillRect(220, 250, 70, 90);
  g.lineWidth = 22;
  g.strokeStyle = '#c9a050';
  g.strokeRect(11, 11, 490, 362);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: toTexture(c), roughness: 0.6, emissive: 0x2a1a0a, emissiveIntensity: 0.4 }));
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  mesh.raycast = () => {};
  root.add(mesh);
}

function compass(size: number): HTMLCanvasElement {
  const [c, g] = canvas(size);
  const r = size / 2;
  g.fillStyle = '#e9dcc0';
  g.fillRect(0, 0, size, size);
  g.translate(r, r);
  for (let k = 0; k < 16; k++) {
    g.rotate(Math.PI / 8);
    g.fillStyle = k % 2 ? '#4a2a1a' : '#b8923e';
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(r * 0.12, -r * 0.12);
    g.lineTo(0, -r * (k % 2 ? 0.62 : 0.88));
    g.lineTo(-r * 0.12, -r * 0.12);
    g.fill();
  }
  g.lineWidth = r * 0.03;
  g.strokeStyle = '#b8923e';
  for (const rr of [0.92, 0.97]) {
    g.beginPath();
    g.arc(0, 0, r * rr, 0, Math.PI * 2);
    g.stroke();
  }
  return c;
}

/** Night facade of the hotel tower: limestone bands and lit windows. */
function towerFacade(w: number, h: number): HTMLCanvasElement {
  const [c, g] = canvas(w, h);
  g.fillStyle = '#2a2430';
  g.fillRect(0, 0, w, h);
  let s = 5;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const cols = 6,
    rows = 8;
  const cw = w / cols,
    rh = h / rows;
  for (let r = 0; r < rows; r++)
    for (let k = 0; k < cols; k++) {
      const lit = rnd() < 0.55;
      const warm = 150 + rnd() * 90;
      g.fillStyle = lit ? `rgb(${warm + 40},${warm},${warm * 0.6})` : '#1a1622';
      g.fillRect(k * cw + cw * 0.18, r * rh + rh * 0.2, cw * 0.64, rh * 0.6);
      if (lit) {
        g.fillStyle = 'rgba(40,20,10,0.35)';
        g.fillRect(k * cw + cw * 0.18, r * rh + rh * 0.2, cw * 0.64, rh * 0.18);
      }
    }
  g.fillStyle = '#c9b48e';
  for (let r = 0; r <= rows; r++) g.fillRect(0, r * rh - 6, w, 12);
  for (let k = 0; k <= cols; k++) g.fillRect(k * cw - 5, 0, 10, h);
  return c;
}

/** The casino's arcaded east face at night. */
function arcade(w: number, h: number): HTMLCanvasElement {
  const [c, g] = canvas(w, h);
  g.fillStyle = '#c9b48e';
  g.fillRect(0, 0, w, h);
  const n = 4;
  const aw = w / n;
  for (let k = 0; k < n; k++) {
    const x = k * aw + aw * 0.15;
    const grd = g.createLinearGradient(0, h * 0.3, 0, h);
    grd.addColorStop(0, '#ffd99a');
    grd.addColorStop(1, '#a86a30');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(x, h * 0.95);
    g.lineTo(x, h * 0.45);
    g.arc(x + aw * 0.35, h * 0.45, aw * 0.35, Math.PI, 0);
    g.lineTo(x + aw * 0.7, h * 0.95);
    g.fill();
    g.strokeStyle = '#8a6a3a';
    g.lineWidth = 8;
    g.stroke();
  }
  g.fillStyle = '#a8916a';
  g.fillRect(0, h * 0.06, w, h * 0.05);
  g.fillRect(0, h * 0.95, w, h * 0.05);
  return c;
}
