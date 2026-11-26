import * as THREE from 'three';
import type { Quality } from '../quality';
import type { World } from '../world';
import { canvas, radial, toTexture } from '../textures';
import { Batch, haloQuad, M, nightSky, plane, wallQuad, type Mats } from './kit';
import { buildCity } from '../skyline';

/**
 * Suite 3201: a corner suite high in the tower, with floor-to-ceiling windows
 * over the Strip at night. It lives far from the casino in the world (out of
 * the camera's range), reached only by elevator.
 */

export const SUITE = { x0: 588, x1: 600, z0: -6, z1: 6, h: 3.2 };
export const SUITE_CAR = { doorX: 600, z: 3.4 };

export function registerSuite(world: World) {
  const S = SUITE;
  world.addWalkable(S.x0 + 0.35, S.x1 - 0.3, S.z0 + 0.35, S.z1 - 0.3);
  world.addSurface('carpet', S.x0, S.x1, S.z0, S.z1);
  world.addBox(592.2, -3.0, 3.0, 1.22, 0, 'sofa'); // sofa (seat and back)
  world.addBox(589.95, -1.6, 1.1, 2.4, 0, 'sofa'); // sofa return
  world.addBox(592.2, -1.2, 1.3, 0.7, 0, 'table'); // coffee table
  // The bed: walk onto it and you sit on it (a stool's way); the headboard stays solid.
  world.addFurniture(593.2, 3.85, 2.4, 2.25, 0, 'bed');
  world.addBox(593.2, 5.12, 2.4, 0.2, 0, 'headboard');
  for (const x of [592.65, 593.75]) for (const z of [3.25, 4.3]) world.addSeat(x, z, 0.58, 0.6, null, 'bed');
  world.addBox(598.5, -5.3, 2.7, 0.7, 0, 'bar'); // minibar
  world.addBox(596.8, -1.0, 1.4, 0.9, 0, 'table'); // dining table
  // Armchairs by the coffee table (seat and back), turned toward the sofa.
  for (const [x, z, ry] of [
    [594.5, -1.6, -Math.PI / 2],
    [594.5, -0.2, -Math.PI / 2 - 0.4],
  ]) world.addBox(x, z, 0.9, 0.9, ry, 'armchair');
  // Dining chairs (seat and back).
  for (const [x, z] of [
    [596.3, -1.7],
    [597.3, -1.7],
    [596.3, -0.3],
    [597.3, -0.3],
  ]) world.addBox(x, z + (z < -1 ? -0.03 : 0.03), 0.47, 0.52, 0, 'chair');
  for (const x of [591.7, 594.7]) world.addBox(x, 4.9, 0.58, 0.48, 0, 'nightstand');
  world.addBox(593.2, 2.35, 1.62, 0.48, 0, 'bench'); // bench at the foot of the bed
  for (const [x, z] of [
    [589.0, -5.0],
    [595.5, -4.9],
  ]) world.addCircle(x, z, 0.25, 'lamp');
  world.addBox(599.5, 0.8, 0.48, 1.32, 0, 'table'); // entry console
}

export function buildSuite(scene: THREE.Scene, q: Quality, m: Mats): THREE.Group {
  const S = SUITE;
  const root = new THREE.Group();
  root.name = 'suite';
  scene.add(root);
  const b = new Batch();
  const cx = (S.x0 + S.x1) / 2,
    cz = (S.z0 + S.z1) / 2;
  const w = S.x1 - S.x0,
    d = S.z1 - S.z0;

  // The view: the Strip at night all round, 100 m below and rising past the windows
  // (real 3D towers with parallax as you walk to the glass), under a starry sky.
  const sky = nightSky(380);
  sky.position.set(cx, 0, cz);
  root.add(sky);
  const city = buildCity({ ground: -100, layout: 'ring', center: new THREE.Vector2(cx, cz), seed: 23, hazeNear: 140, hazeFar: 420, name: 'skyline-suite' });
  root.add(city.group);

  // Plush carpet, a patterned rug, and the ceiling with a glowing cove.
  const carpetTex = toTexture(plush(512));
  carpetTex.wrapS = carpetTex.wrapT = THREE.RepeatWrapping;
  const carpet = new THREE.MeshStandardMaterial({ map: carpetTex, roughness: 0.95, emissive: 0x3a2c1e, emissiveIntensity: 0.8 });
  b.add(plane(w, d, 0.5), carpet, M(cx, 0.003, cz));
  const rug = new THREE.MeshStandardMaterial({ map: toTexture(rugTex(512)), roughness: 0.95, emissive: 0x1a120c, emissiveIntensity: 0.4 });
  const rugGeo = new THREE.PlaneGeometry(4.2, 3.2).rotateX(-Math.PI / 2);
  b.add(rugGeo, rug, M(592.2, 0.008, -1.7));
  b.add(plane(w, d, 1, false), m.cream, M(cx, S.h, cz));
  // A lowered ceiling field with a glowing cove all round it.
  b.box(m.glowWarm, cx, S.h - 0.02, cz, w - 0.6, 0.01, d - 0.6);
  b.box(new THREE.MeshStandardMaterial({ color: 0xf2e8d4, roughness: 0.7, emissive: 0x6a5a44, emissiveIntensity: 0.8 }), cx, S.h - 0.14, cz, w - 2.0, 0.1, d - 2.0);

  // Windows on the north and west sides: thin mullions and a sill; glass is barely there.
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fb8c8, transparent: true, opacity: 0.08, roughness: 0.02, metalness: 0.9, envMapIntensity: 1.5, depthWrite: false });
  const g1 = new THREE.Mesh(new THREE.PlaneGeometry(w, S.h), glass);
  g1.position.set(cx, S.h / 2, S.z0);
  root.add(g1);
  const g2 = new THREE.Mesh(new THREE.PlaneGeometry(d, S.h), glass);
  g2.position.set(S.x0, S.h / 2, cz);
  g2.rotation.y = Math.PI / 2;
  root.add(g2);
  for (let x = S.x0; x <= S.x1; x += 2) b.box(m.darkMarble, x, S.h / 2, S.z0, 0.08, S.h, 0.12);
  for (let z = S.z0; z <= S.z1; z += 2) b.box(m.darkMarble, S.x0, S.h / 2, z, 0.12, S.h, 0.08);
  b.box(m.darkMarble, cx, 0.1, S.z0, w, 0.2, 0.25);
  b.box(m.darkMarble, S.x0, 0.1, cz, 0.25, 0.2, d);

  // Solid walls: south (bedroom wall), east (entry with the elevator).
  b.add(wallQuad(w, S.h), m.silk, M(cx, S.h / 2, S.z1, Math.PI));
  const eastSeg = (z0: number, z1: number, y0: number, y1: number) => b.add(wallQuad(z1 - z0, y1 - y0), m.silk, M(S.x1, (y0 + y1) / 2, (z0 + z1) / 2, -Math.PI / 2));
  eastSeg(S.z0, SUITE_CAR.z - 0.83, 0, S.h);
  eastSeg(SUITE_CAR.z + 0.83, S.z1, 0, S.h);
  eastSeg(SUITE_CAR.z - 0.83, SUITE_CAR.z + 0.83, 2.6, S.h);
  b.box(m.walnut, S.x1 - 0.05, 0.08, cz, 0.1, 0.16, d);
  b.box(m.walnut, cx, 0.08, S.z1 - 0.05, w, 0.16, 0.1);

  // Living area: L-shaped sofa, coffee table, armchairs, lamps.
  const velvet = new THREE.MeshStandardMaterial({ color: 0x3a5486, roughness: 0.8, emissive: 0x1a2844, emissiveIntensity: 0.9 });
  const pillow = new THREE.MeshStandardMaterial({ color: 0xc9a050, roughness: 0.7, emissive: 0x2a1a08, emissiveIntensity: 0.4 });
  b.box(velvet, 592.2, 0.22, -3.1, 3.0, 0.44, 0.95);
  b.box(velvet, 592.2, 0.62, -3.5, 3.0, 0.5, 0.2);
  b.box(velvet, 590.0, 0.22, -1.6, 0.95, 0.44, 2.4);
  b.box(velvet, 589.6, 0.62, -1.6, 0.2, 0.5, 2.4);
  for (const [x, z] of [
    [591.2, -3.3],
    [593.1, -3.3],
    [589.8, -0.9],
  ]) b.box(pillow, x, 0.6, z, 0.42, 0.36, 0.14);
  b.box(m.marble, 592.2, 0.4, -1.2, 1.3, 0.06, 0.7);
  b.box(m.gold, 592.2, 0.2, -1.2, 1.1, 0.36, 0.5);
  flowersSmall(b, m, 592.2, 0.43, -1.2);
  for (const [x, z, ry] of [
    [594.5, -1.6, -Math.PI / 2],
    [594.5, -0.2, -Math.PI / 2 - 0.4],
  ]) {
    b.box(velvet, x, 0.25, z, 0.85, 0.5, 0.85, ry);
    b.box(velvet, x + Math.sin(ry) * -0.35, 0.65, z + Math.cos(ry) * -0.35, 0.85, 0.5, 0.15, ry);
  }
  // Dining table with four chairs by the window corner.
  b.box(m.walnut, 596.8, 0.74, -1.0, 1.4, 0.05, 0.9);
  b.add(new THREE.CylinderGeometry(0.08, 0.25, 0.72, 12), m.gold, M(596.8, 0.36, -1.0));
  for (const [x, z] of [
    [596.3, -1.7],
    [597.3, -1.7],
    [596.3, -0.3],
    [597.3, -0.3],
  ]) {
    b.box(velvet, x, 0.45, z, 0.45, 0.08, 0.45);
    b.box(velvet, x, 0.75, z + (z < -1 ? -0.2 : 0.2), 0.45, 0.6, 0.06);
  }
  // Bedroom: king bed with headboard, nightstands with lamps, a bench.
  const linen = new THREE.MeshStandardMaterial({ color: 0xf6f1e6, roughness: 0.85, emissive: 0x2a2620, emissiveIntensity: 0.4 });
  b.box(m.walnut, 593.2, 0.22, 3.9, 2.2, 0.44, 2.3);
  b.box(linen, 593.2, 0.52, 3.85, 2.1, 0.18, 2.2);
  b.box(velvet, 593.2, 0.62, 3.4, 2.1, 0.05, 1.2);
  for (const x of [592.6, 593.8]) b.box(linen, x, 0.7, 4.75, 0.75, 0.18, 0.4);
  b.box(velvet, 593.2, 1.0, 5.15, 2.4, 1.3, 0.15);
  for (const x of [591.7, 594.7]) {
    b.box(m.walnut, x, 0.3, 4.9, 0.55, 0.6, 0.45);
    b.add(new THREE.CylinderGeometry(0.03, 0.08, 0.35, 10), m.gold, M(x, 0.78, 4.9));
    b.add(new THREE.CylinderGeometry(0.14, 0.2, 0.25, 16, 1, true), m.glowWarm, M(x, 1.05, 4.9));
    const h = haloQuad(m, 1.4);
    h.position.set(x, 1.05, 5.88);
    h.rotation.y = Math.PI;
    root.add(h);
  }
  b.box(velvet, 593.2, 0.25, 2.35, 1.6, 0.5, 0.45);
  // Minibar along the window end of the east wall: walnut, glowing shelf, bottles, glasses.
  b.box(m.walnut, 598.5, 0.47, -5.3, 2.6, 0.94, 0.6);
  b.box(m.darkMarble, 598.5, 0.96, -5.3, 2.7, 0.05, 0.66);
  b.box(m.glow(0xffd9a0, 1.1), 598.5, 1.6, -5.55, 2.4, 0.02, 0.25);
  const cols = [0x2a6a3a, 0x8a5a1a, 0xd8d0c0, 0x3a1a4a, 0x8a1a1a, 0xc9a050];
  for (let i = 0; i < 12; i++) b.add(new THREE.CylinderGeometry(0.035, 0.04, 0.3, 8), m.glow(cols[i % cols.length], 0.9), M(597.4 + i * 0.2, 1.15, -5.45));
  for (let i = 0; i < 4; i++) b.add(new THREE.CylinderGeometry(0.035, 0.025, 0.12, 10), m.glow(0xffffff, 0.8), M(598.0 + i * 0.25, 1.05, -5.15));
  // TV on the south wall facing the sofa, and floor lamps.
  b.box(new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.2, metalness: 0.4 }), 597.0, 1.5, 5.9, 2.0, 1.15, 0.06);
  b.box(m.glow(0x1a3060, 0.6), 597.0, 1.5, 5.86, 1.9, 1.05, 0.01);
  for (const [x, z] of [
    [589.0, -5.0],
    [595.5, -4.9],
  ]) {
    b.add(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 8), m.gold, M(x, 0.8, z));
    b.add(new THREE.CylinderGeometry(0.18, 0.25, 0.3, 16, 1, true), m.glowWarm, M(x, 1.65, z));
  }
  // Entry: a console with flowers beside the elevator.
  b.box(m.walnut, 599.5, 0.8, 0.8, 0.45, 0.05, 1.3);
  flowersSmall(b, m, 599.5, 0.83, 0.8);
  if (q.pointLights > 0) {
    const l = new THREE.PointLight(0xffc890, 5, 12, 1.8);
    l.position.set(594, 1.6, 0);
    root.add(l);
  }
  // Lamp light: warm pools on the carpet under each lamp (the room is lamp-lit, not evenly bright).
  {
    const pt = toTexture(radial(128, 'rgba(255,200,130,0.5)', 'rgba(255,170,90,0)'));
    const pm = new THREE.MeshBasicMaterial({ map: pt, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const [x, z, r] of [[591.7, 4.9, 2.4], [594.7, 4.9, 2.4], [589.0, -5.0, 3.0], [595.5, -4.9, 3.0], [598.5, -5.0, 2.6], [594, 0, 5.5]] as const) {
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(r, r), pm);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x, 0.02, z);
      pool.raycast = () => {};
      root.add(pool);
    }
  }
  b.build(root, 'suite-static');
  return root;
}

function flowersSmall(b: Batch, m: Mats, x: number, y: number, z: number) {
  b.add(new THREE.CylinderGeometry(0.1, 0.08, 0.25, 12), m.glow(0xf0f0f0, 0.7), M(x, y + 0.12, z));
  const pal = [0xf4a3b5, 0xffffff, 0xd96a8a, 0xffd27a];
  for (let i = 0; i < 14; i++) {
    const a = i * 2.4;
    b.add(new THREE.IcosahedronGeometry(0.05, 0), m.glow(pal[i % 4], 0.85), M(x + Math.cos(a) * 0.12, y + 0.3 + (i % 3) * 0.04, z + Math.sin(a) * 0.12));
  }
}

function plush(size: number): HTMLCanvasElement {
  const [c, g] = canvas(size);
  g.fillStyle = '#b9a284';
  g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  let s = 5;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 16807) % 2147483647;
    const f = 0.9 + (s / 2147483647) * 0.16;
    img.data[i] *= f;
    img.data[i + 1] *= f;
    img.data[i + 2] *= f;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function rugTex(size: number): HTMLCanvasElement {
  const [c, g] = canvas(size);
  g.fillStyle = '#2a1a3a';
  g.fillRect(0, 0, size, size);
  g.strokeStyle = '#c9a050';
  g.lineWidth = 10;
  g.strokeRect(20, 20, size - 40, size - 40);
  g.lineWidth = 3;
  g.strokeRect(44, 44, size - 88, size - 88);
  g.translate(size / 2, size / 2);
  for (let k = 0; k < 12; k++) {
    g.rotate(Math.PI / 6);
    g.fillStyle = k % 2 ? '#8a3a5a' : '#c9a050';
    g.beginPath();
    g.ellipse(size * 0.16, 0, size * 0.12, size * 0.04, 0, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}
