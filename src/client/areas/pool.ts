import * as THREE from 'three';
import { textSign } from '../panel';
import type { Quality } from '../quality';
import type { World } from '../world';
import { canvas, toTexture } from '../textures';
import { Batch, M, nightSky, plane, type Mats } from './kit';
import { flowers } from './hotel';

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
export const LIFT = { doorX: 48, zs: [-7.6, -5.0] };

export function registerPool(world: World) {
  world.addWalkable(DECK.x0 + 0.4, DECK.x1 - 0.4, DECK.z0 + 0.5, DECK.z1 - 0.2);
  world.addSurface('stone', DECK.x0, DECK.x1, DECK.z0, DECK.z1);
  world.addBox(POOL.x, POOL.z, POOL.w + 0.3, POOL.d + 0.3);
  world.addCircle(TUB.x, TUB.z, TUB.r + 0.2);
  world.addCircle(BAR.x, BAR.z, BAR.r + 0.15);
  world.addBox(DJ.x, DJ.z - 0.4, 6, 2.2);
  // Lift tower (the cabs themselves are walkable, see Elevators).
  // Solid parts of the tower around the two cabs (the cabs are walkable).
  world.addBox(LIFT.doorX + 1.3, -8.95, 2.9, 0.7);
  world.addBox(LIFT.doorX + 1.3, -6.3, 2.9, 0.68);
  world.addBox(LIFT.doorX + 1.3, -3.65, 2.9, 0.7);
  world.addBox(LIFT.doorX + 2.55, -6.3, 0.5, 6);
  for (const z of [-30, -24, -18]) world.addBox(59.5, z, 2.6, 3.2);
}

export interface PoolArea {
  root: THREE.Group;
  anchor: THREE.Object3D;
  update(t: number): void;
  /** Where people can be (for the crowd). */
  seats: { pos: THREE.Vector3; yaw: number; seatY: number }[];
  stands: { pos: THREE.Vector3; yaw: number }[];
  bartender: { pos: THREE.Vector3; yaw: number };
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

  // Travertine deck.
  const deckTex = toTexture(travertine(1024));
  deckTex.wrapS = deckTex.wrapT = THREE.RepeatWrapping;
  deckTex.repeat.set(0.25, 0.25);
  const deck = new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.75, emissive: 0x1c140e, emissiveIntensity: 0.6 });
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
  const coping = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.6, emissive: 0x2a2218, emissiveIntensity: 0.4 });
  const P = POOL;
  for (const [x, z, w, d] of [
    [P.x, P.z - P.d / 2 - 0.2, P.w + 0.8, 0.4],
    [P.x, P.z + P.d / 2 + 0.2, P.w + 0.8, 0.4],
    [P.x - P.w / 2 - 0.2, P.z, 0.4, P.d],
    [P.x + P.w / 2 + 0.2, P.z, 0.4, P.d],
  ]) b.box(coping, x, 0.04, z, w, 0.08, d);
  for (const [x, z, w, d] of [
    [P.x, P.z - P.d / 2, P.w, 0.05],
    [P.x, P.z + P.d / 2, P.w, 0.05],
    [P.x - P.w / 2, P.z, 0.05, P.d],
    [P.x + P.w / 2, P.z, 0.05, P.d],
  ]) b.box(tile, x, -0.7, z, w, 1.4, d);
  b.box(tile, P.x, -1.4, P.z, P.w, 0.05, P.d);
  const waterMat = waterMaterial();
  const water = new THREE.Mesh(new THREE.PlaneGeometry(P.w, P.d, 1, 1), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(P.x, -0.12, P.z);
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
  const spots: { x: number; z: number; yaw: number }[] = [];
  for (let k = 0; k < 7; k++) {
    const x = P.x - P.w / 2 + 1.2 + k * 2.6;
    spots.push({ x, z: P.z - P.d / 2 - 2.3, yaw: 0 }, { x, z: P.z + P.d / 2 + 2.3, yaw: Math.PI });
  }
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
  spots.forEach((s, i) => {
    if (i % 4 !== 0) return;
    const uz = s.z + (s.yaw === 0 ? -1.2 : 1.2);
    b.add(new THREE.CylinderGeometry(0.03, 0.03, 2.5, 6), m.gold, M(s.x + 1.3, 1.25, uz));
    b.add(new THREE.ConeGeometry(1.4, 0.5, 10, 1, true), canopy, M(s.x + 1.3, 2.45, uz));
  });

  // Palms around the deck.
  const palmSpots: [number, number][] = [
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
  const { trunk, crown } = palmGeometry();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6a5238, roughness: 0.9, emissive: 0x1a120a, emissiveIntensity: 0.5 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x2f6a34, roughness: 0.8, side: THREE.DoubleSide, emissive: 0x0c2a10, emissiveIntensity: 0.7 });
  const trunks = new THREE.InstancedMesh(trunk, trunkMat, palmSpots.length);
  const crowns = new THREE.InstancedMesh(crown, crownMat, palmSpots.length);
  palmSpots.forEach(([x, z], i) => {
    tmp.position.set(x, 0, z);
    tmp.rotation.set(0, i * 1.7, 0);
    tmp.scale.setScalar(0.9 + ((i * 37) % 10) / 25);
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
  for (const [x, z] of [
    [26, -15],
    [26, -25],
    [36, -31],
    [46, -31],
    [57, -6],
  ]) {
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
  b.add(new THREE.TorusGeometry(BAR.r + 0.05, 0.08, 8, 48).rotateX(Math.PI / 2), m.darkMarble, M(BAR.x, 1.08, BAR.z));
  b.add(new THREE.TorusGeometry(BAR.r + 0.02, 0.02, 6, 48).rotateX(Math.PI / 2), m.glow(0x5ad0ff, 1.8), M(BAR.x, 0.12, BAR.z));
  b.add(new THREE.CylinderGeometry(0.7, 0.8, 2.6, 24), m.walnut, M(BAR.x, 1.3, BAR.z));
  b.add(new THREE.CylinderGeometry(2.6, 2.6, 0.15, 40), m.cream, M(BAR.x, 3.0, BAR.z));
  b.add(new THREE.CylinderGeometry(2.4, 2.4, 0.01, 40), m.glow(0xffd9a0, 1.2), M(BAR.x, 2.92, BAR.z));
  for (const pole of [0, 1, 2, 3]) {
    const a = (pole / 4) * Math.PI * 2 + 0.4;
    b.add(new THREE.CylinderGeometry(0.06, 0.06, 2.9, 8), m.gold, M(BAR.x + Math.cos(a) * 2.45, 1.45, BAR.z + Math.sin(a) * 2.45));
  }
  // Bottles on the central column.
  const bottleCols = [0x2a6a3a, 0x8a5a1a, 0xd8d0c0, 0x3a1a4a, 0x8a1a1a];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    b.add(new THREE.CylinderGeometry(0.035, 0.04, 0.28, 8), m.glow(bottleCols[i % 5], 0.9), M(BAR.x + Math.cos(a) * 0.82, 1.32 + (i % 2) * 0.4, BAR.z + Math.sin(a) * 0.82));
  }
  const stools: PoolArea['seats'] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const x = BAR.x + Math.cos(a) * (BAR.r + 0.55),
      z = BAR.z + Math.sin(a) * (BAR.r + 0.55);
    b.add(new THREE.CylinderGeometry(0.2, 0.18, 0.08, 16), cushion, M(x, 0.74, z));
    b.add(new THREE.CylinderGeometry(0.025, 0.025, 0.72, 8), m.gold, M(x, 0.37, z));
    stools.push({ pos: new THREE.Vector3(x, 0, z), yaw: Math.atan2(BAR.x - x, BAR.z - z), seatY: 0.74 });
  }

  // DJ booth with an LED wall and moving beams.
  b.box(m.darkMarble, DJ.x, 0.3, DJ.z - 0.3, 6, 0.6, 2.6);
  b.box(new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 }), DJ.x, 1.0, DJ.z + 0.5, 2.4, 0.9, 0.7);
  for (const s of [-1, 1]) b.box(new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.5 }), DJ.x + s * 2.6, 1.4, DJ.z - 0.5, 0.9, 2.2, 0.8);
  const ledMat = ledMaterial();
  const led = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 2.8), ledMat);
  led.position.set(DJ.x, 2.2, DJ.z - 1.55);
  led.raycast = () => {};
  root.add(led);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beams: THREE.Mesh[] = [];
  const beamGeo = new THREE.ConeGeometry(0.9, 14, 16, 1, true).translate(0, -7, 0).rotateX(Math.PI);
  for (let k = 0; k < 4; k++) {
    const beam = new THREE.Mesh(beamGeo, beamMat.clone());
    beam.position.set(DJ.x - 2.2 + k * 1.45, 3.7, DJ.z - 1.2);
    beam.raycast = () => {};
    root.add(beam);
    beams.push(beam);
  }
  const djSign = textSign('Pool Party', { width: 3.2, px: 130, sub: 'DJ  ·  TONIGHT', bg: 'rgba(10,4,20,0.85)' });
  djSign.position.set(DJ.x, 4.2, DJ.z - 1.5);
  root.add(djSign);

  // Strings of lights criss-crossing the deck.
  const poles: [number, number][] = [
    [26, -6],
    [26, -34],
    [58, -6],
    [58, -34],
    [42, -6],
    [42, -34],
  ];
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
  const liftSign = textSign('Tower Lifts', { width: 1.6, px: 110, sub: 'SUITES  ·  CASINO', bg: 'rgba(16,10,8,0.85)' });
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

  b.build(root, 'pool-static');
  const anchor = new THREE.Object3D();
  anchor.position.set(P.x, 0.5, P.z);
  root.add(anchor);

  // Crowd spots: loungers, bar stools, cabanas, and a dance floor in front of the DJ.
  const loungerSeats = spots.filter((_, i) => i % 3 === 0).map((s) => ({ pos: new THREE.Vector3(s.x, 0, s.z), yaw: s.yaw, seatY: 0.48 }));
  const stands: PoolArea['stands'] = [];
  for (let k = 0; k < 8; k++) {
    stands.push({ pos: new THREE.Vector3(DJ.x - 2.4 + (k % 4) * 1.5 + (k > 3 ? 0.7 : 0), 0, DJ.z + 2.2 + Math.floor(k / 4) * 1.2), yaw: Math.PI });
  }
  stands.push({ pos: new THREE.Vector3(P.x - 6, 0, P.z + P.d / 2 + 1.0), yaw: Math.PI }, { pos: new THREE.Vector3(P.x - 5.3, 0, P.z + P.d / 2 + 1.0), yaw: Math.PI * 0.8 });

  return {
    root,
    anchor,
    seats: [...stools.slice(0, 5), ...seats, ...loungerSeats],
    stands,
    bartender: { pos: new THREE.Vector3(BAR.x + 1.15, 0, BAR.z), yaw: Math.PI / 2 },
    update(t: number) {
      waterMat.uniforms.time.value = t;
      ledMat.uniforms.time.value = t;
      beams.forEach((beam, k) => {
        beam.rotation.set(Math.sin(t * 0.7 + k) * 0.6, 0, Math.cos(t * 0.9 + k * 1.3) * 0.5);
        (beam.material as THREE.MeshBasicMaterial).color.setHSL((t * 0.08 + k * 0.25) % 1, 0.9, 0.6);
      });
    },
  };
}

/** Cheap animated pool water: lit from below, with moving caustic ripples. */
function waterMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float time;
      varying vec3 vW;
      void main() {
        vec2 p = vW.xz * 1.3;
        float c = 0.0;
        c += sin(p.x * 2.1 + time * 1.3 + sin(p.y * 1.7 + time));
        c += sin(p.y * 2.6 - time * 1.1 + sin(p.x * 1.3 - time * 0.7));
        c += sin((p.x + p.y) * 1.7 + time * 0.9);
        float caustic = pow(abs(sin(c * 1.4)), 6.0);
        vec3 deep = vec3(0.02, 0.35, 0.55);
        vec3 shallow = vec3(0.15, 0.85, 0.95);
        vec3 col = mix(deep, shallow, 0.55 + 0.15 * sin(c)) + caustic * vec3(0.55, 0.85, 0.9);
        gl_FragColor = vec4(col * 1.15, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/** Animated LED wall behind the DJ: sweeping colour bars and an equaliser. */
function ledMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float time;
      varying vec2 vUv;
      vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
      void main() {
        float bars = floor(vUv.x * 24.0);
        float level = 0.35 + 0.35 * sin(time * 3.0 + bars * 0.7) * sin(time * 1.7 + bars * 0.31) + 0.2 * sin(time * 8.0 + bars);
        float lit = step(vUv.y, level) * step(0.15, fract(vUv.x * 24.0));
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
  add(new THREE.BoxGeometry(0.7, 0.1, 0.75), 0, 0.55, -0.55, -0.6);
  for (const [x, z] of [
    [-0.3, 0.9],
    [0.3, 0.9],
    [-0.3, -0.75],
    [0.3, -0.75],
  ]) add(new THREE.BoxGeometry(0.05, 0.3, 0.05), x, 0.15, z);
  return mergeGeos(parts);
}

function palmGeometry() {
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
