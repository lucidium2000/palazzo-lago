import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LooseSpec } from './loosephys';
import { FOOD, MERCH, type FoodKey, type MerchKey } from './areas/promenadeplan';

/**
 * The Promenade's loose things: food from the food court (a pizza slice, a
 * burger, a noodle box, a gelato cone) and the boutique's stock (sunglasses,
 * a fedora, a plush lion, a dice set). Each is one small merged geometry with
 * vertex colours, so a kind is one draw wherever its copies are (loose.ts
 * instances them). Origins are the middle of the base, +z is the front.
 */

export interface PromKindDef {
  key: string;
  label: string;
  spec: LooseSpec;
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  tinted?: boolean;
  sound: 'thunk' | 'clink' | 'click';
  rate: number;
  vol: number;
  hold: { p: [number, number, number]; r: [number, number, number] };
  /** Food: bites to finish it. */
  food?: { bites: number };
  /** Shop stock: what it is (its price and whether you can wear it). */
  merch?: MerchKey;
  /** Drawn only when in view (a bounding sphere round the copies: they all live on the Promenade). */
  cull?: boolean;
}

/** Gives a geometry one flat vertex colour (non-indexed, position/normal/uv/color only). */
function paint(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
  if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
  const c = new THREE.Color(color);
  const arr = new Float32Array(n.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) {
    arr[i] = c.r;
    arr[i + 1] = c.g;
    arr[i + 2] = c.b;
  }
  n.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return n;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts)!;
  g.computeBoundingSphere();
  return g;
}

const vc = (rough: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, ...extra });

/** A pizza slice: a wedge of crust and cheese, pepperoni on top, the crust's rim at the back. */
export function pizzaGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.1);
  shape.lineTo(-0.062, -0.06);
  shape.quadraticCurveTo(0, -0.075, 0.062, -0.06);
  shape.closePath();
  // Extruded up (shape in XY, then turned so it lies in XZ with +y up).
  const base = new THREE.ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: false, curveSegments: 6 }).rotateX(Math.PI / 2).translate(0, 0.006, 0);
  const cheese = new THREE.ExtrudeGeometry(shape, { depth: 0.004, bevelEnabled: false, curveSegments: 6 }).rotateX(Math.PI / 2).scale(0.92, 1, 0.92).translate(0, 0.01, 0.004);
  const parts = [paint(base, 0xd9a35a), paint(cheese, 0xf2b63a)];
  const rim = new THREE.CylinderGeometry(0.011, 0.011, 0.13, 8).rotateZ(Math.PI / 2).translate(0, 0.01, 0.065);
  parts.push(paint(rim, 0xb87a3a));
  for (const [x, z] of [
    [0, -0.035],
    [-0.025, 0.02],
    [0.025, 0.015],
    [0, 0.045],
    [0.03, -0.035],
    [-0.03, -0.03],
  ])
    parts.push(paint(new THREE.CylinderGeometry(0.011, 0.011, 0.003, 10).translate(x, 0.0115, z), 0xa8241a));
  // The slice's tip points to -z (into your mouth when you hold it), the crust is the back.
  return merge(parts.map((p) => p.rotateY(Math.PI)));
}

export function burgerGeometry(): THREE.BufferGeometry {
  const parts = [
    paint(new THREE.CylinderGeometry(0.05, 0.048, 0.02, 18).translate(0, 0.01, 0), 0xd89a4a),
    paint(new THREE.CylinderGeometry(0.053, 0.053, 0.016, 18).translate(0, 0.028, 0), 0x5a2a14),
    paint(new THREE.BoxGeometry(0.085, 0.004, 0.085).rotateY(0.3).translate(0, 0.038, 0), 0xf2b83a),
    paint(new THREE.CylinderGeometry(0.057, 0.055, 0.005, 14).translate(0, 0.043, 0), 0x4a9a2a),
    paint(new THREE.CylinderGeometry(0.052, 0.052, 0.012, 18).translate(0, 0.052, 0), 0x5a2a14),
    paint(new THREE.SphereGeometry(0.05, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1).translate(0, 0.058, 0), 0xd88a3a),
  ];
  for (let i = 0; i < 10; i++) {
    const a = i * 2.39,
      r = 0.012 + (i % 3) * 0.012;
    parts.push(paint(new THREE.SphereGeometry(0.003, 4, 3).scale(1, 0.6, 1.6).translate(Math.cos(a) * r, 0.058 + 0.029 * Math.sqrt(1 - (r / 0.05) ** 2), Math.sin(a) * r), 0xf6ecd0));
  }
  return merge(parts);
}

export function noodlesGeometry(): THREE.BufferGeometry {
  // A takeout box: a square frustum, a red band, noodles heaped at the top, chopsticks.
  const box = new THREE.CylinderGeometry(0.05, 0.036, 0.095, 4, 1, true).rotateY(Math.PI / 4).translate(0, 0.0475, 0);
  const bottom = new THREE.CylinderGeometry(0.036, 0.036, 0.002, 4).rotateY(Math.PI / 4).translate(0, 0.001, 0);
  const band = new THREE.CylinderGeometry(0.0455, 0.042, 0.022, 4, 1, true).rotateY(Math.PI / 4).scale(1.01, 1, 1.01).translate(0, 0.05, 0);
  const heap = new THREE.SphereGeometry(0.046, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.95, 0.4, 0.95).rotateY(Math.PI / 4).translate(0, 0.09, 0);
  const parts = [paint(box, 0xf6f2ea), paint(bottom, 0xf6f2ea), paint(band, 0xb0141a), paint(heap, 0xe0b25a)];
  for (const x of [-0.006, 0.006]) parts.push(paint(new THREE.CylinderGeometry(0.0025, 0.0035, 0.2, 5).rotateZ(0.32).translate(x + 0.02, 0.12, -0.01), 0x8a5a2a));
  return merge(parts);
}

export function gelatoGeometry(): THREE.BufferGeometry {
  const cone = new THREE.CylinderGeometry(0.03, 0.004, 0.1, 12).translate(0, 0.05, 0);
  const rim = new THREE.TorusGeometry(0.03, 0.004, 5, 14).rotateX(Math.PI / 2).translate(0, 0.1, 0);
  const scoop = new THREE.SphereGeometry(0.035, 14, 10).scale(1, 0.92, 1).translate(0, 0.122, 0);
  const wafer = new THREE.BoxGeometry(0.012, 0.035, 0.024).rotateZ(0.3).translate(0.018, 0.15, 0);
  return merge([paint(cone, 0xc8904a), paint(rim, 0xb8803a), paint(scoop, 0xa8c87a), paint(wafer, 0xe8c88a)]);
}

export function sunglassesGeometry(): THREE.BufferGeometry {
  // Lying open: front at z = 0 facing +z, the arms reaching back. Frame tinted per pair (vertex white).
  const parts: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    parts.push(paint(new THREE.BoxGeometry(0.052, 0.036, 0.003).translate(s * 0.033, 0.02, 0.002), 0x202020));
    // Rim round each lens.
    parts.push(paint(new THREE.BoxGeometry(0.058, 0.005, 0.006).translate(s * 0.033, 0.039, 0), 0xffffff));
    parts.push(paint(new THREE.BoxGeometry(0.05, 0.004, 0.006).translate(s * 0.033, 0.002, 0), 0xffffff));
    parts.push(paint(new THREE.BoxGeometry(0.005, 0.04, 0.006).translate(s * 0.062, 0.02, 0), 0xffffff));
    // Arms.
    parts.push(paint(new THREE.BoxGeometry(0.004, 0.006, 0.13).translate(s * 0.064, 0.034, -0.065), 0xffffff));
  }
  parts.push(paint(new THREE.BoxGeometry(0.014, 0.005, 0.006).translate(0, 0.034, 0), 0xffffff));
  return merge(parts);
}

export function hatGeometry(): THREE.BufferGeometry {
  // A fedora: a pinched crown, a band, and a brim with a little curl.
  const crown = new THREE.LatheGeometry([[0, 0.115], [0.04, 0.112], [0.07, 0.1], [0.08, 0.06], [0.085, 0.01], [0.085, 0.0]].map(([r, y]) => new THREE.Vector2(r, y)), 20);
  const pos = crown.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    // The pinch at the front and the dent along the top.
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const top = Math.max(0, (y - 0.08) / 0.035);
    pos.setXYZ(i, x * (1 - 0.15 * top * Math.max(0, z / 0.085)), y - 0.018 * top * Math.exp(-(x * x) / 0.0012), z * 1.12);
  }
  crown.computeVertexNormals();
  const brim = new THREE.CylinderGeometry(0.15, 0.15, 0.006, 28, 1).scale(1, 1, 1.12).translate(0, 0.003, 0);
  const band = new THREE.CylinderGeometry(0.0865, 0.0865, 0.02, 20, 1, true).scale(1, 1, 1.12).translate(0, 0.016, 0);
  return merge([paint(crown, 0xffffff), paint(brim, 0xffffff), paint(band, 0x2a2a2a)]);
}

export function plushGeometry(): THREE.BufferGeometry {
  // Lucky the lion, sitting: body, head with a darker mane, ears, paws, a tail tuft.
  const parts = [
    paint(new THREE.SphereGeometry(0.055, 14, 10).scale(1, 1.05, 0.9).translate(0, 0.055, 0), 0xffffff),
    paint(new THREE.SphereGeometry(0.06, 14, 10).scale(1, 1, 0.6).translate(0, 0.13, -0.008), 0x9a5a2a),
    paint(new THREE.SphereGeometry(0.043, 14, 10).translate(0, 0.13, 0.012), 0xffffff),
    paint(new THREE.SphereGeometry(0.016, 8, 6).scale(1.2, 0.8, 1).translate(0, 0.122, 0.05), 0xf6e8d0),
    paint(new THREE.SphereGeometry(0.006, 6, 4).translate(0, 0.128, 0.064), 0x2a1a10),
  ];
  for (const s of [-1, 1]) {
    parts.push(paint(new THREE.SphereGeometry(0.006, 6, 4).translate(s * 0.016, 0.142, 0.048), 0x140c08));
    parts.push(paint(new THREE.SphereGeometry(0.014, 8, 6).translate(s * 0.032, 0.168, 0.0), 0xffffff));
    parts.push(paint(new THREE.SphereGeometry(0.018, 8, 6).scale(1, 0.8, 1.4).translate(s * 0.03, 0.012, 0.04), 0xffffff));
  }
  parts.push(paint(new THREE.SphereGeometry(0.013, 8, 6).translate(0.03, 0.03, -0.06), 0x9a5a2a));
  return merge(parts);
}

export function dicesetGeometry(): THREE.BufferGeometry {
  // A velvet case with its lid off and a pair of big translucent dice on top.
  const parts = [paint(new THREE.BoxGeometry(0.12, 0.035, 0.08).translate(0, 0.0175, 0), 0xffffff), paint(new THREE.BoxGeometry(0.108, 0.002, 0.068).translate(0, 0.0355, 0), 0x2a1a1a)];
  parts.push(paint(new THREE.BoxGeometry(0.026, 0.026, 0.026).rotateY(0.4).translate(-0.022, 0.049, 0), 0xffffff));
  parts.push(paint(new THREE.BoxGeometry(0.026, 0.026, 0.026).rotateY(-0.3).translate(0.024, 0.049, 0.004), 0xffffff));
  // Pips on top (white dots).
  for (const [x, z] of [
    [-0.022, 0],
    [0.016, -0.004],
    [0.032, 0.012],
  ])
    parts.push(paint(new THREE.CylinderGeometry(0.0035, 0.0035, 0.001, 8).translate(x, 0.0625, z), 0xffffff));
  return merge(parts);
}

const DESK_HOLD: PromKindDef['hold'] = { p: [0.16, -0.18, -0.38], r: [0.3, 0, 0] };

/** The Promenade's loose kinds (loose.ts adds them after its own). */
export function promenadeKinds(): PromKindDef[] {
  const food = (key: FoodKey, geo: THREE.BufferGeometry, spec: LooseSpec, hold: PromKindDef['hold']): PromKindDef => ({
    key,
    label: FOOD[key].name.toLowerCase().replace(/^slice of /, 'slice of '),
    spec,
    geo,
    mat: vc(0.65),
    sound: 'thunk',
    rate: 1.4,
    vol: 0.3,
    hold,
    food: { bites: FOOD[key].bites },
    cull: true,
  });
  const merch = (key: MerchKey, geo: THREE.BufferGeometry, mat: THREE.Material, spec: LooseSpec, sound: PromKindDef['sound'], hold = DESK_HOLD): PromKindDef => ({
    key,
    label: MERCH[key].name,
    spec,
    geo,
    mat,
    tinted: true,
    sound,
    rate: 1.1,
    vol: 0.4,
    hold,
    merch: key,
    cull: true,
  });
  return [
    food('pizza', pizzaGeometry(), { name: 'pizza', shape: { type: 'box', x: 0.062, y: 0.008, z: 0.085 }, mass: 0.12, bounce: 0.05, friction: 0.8, drag: 0.6, tumble: 0.3 }, { p: [0.14, -0.16, -0.34], r: [0.25, 0.3, 0] }),
    food('burger', burgerGeometry(), { name: 'burger', shape: { type: 'cyl', r: 0.053, h: 0.075 }, mass: 0.3, bounce: 0.08, friction: 0.7, tumble: 0.3 }, { p: [0.15, -0.17, -0.36], r: [0.2, 0, 0] }),
    food('noodles', noodlesGeometry(), { name: 'noodles', shape: { type: 'cyl', r: 0.045, h: 0.1 }, mass: 0.35, bounce: 0.08, friction: 0.7, tumble: 0.4 }, { p: [0.15, -0.2, -0.38], r: [0.15, 0, 0] }),
    food('gelato', gelatoGeometry(), { name: 'gelato', shape: { type: 'cyl', r: 0.035, h: 0.16 }, mass: 0.1, bounce: 0.05, friction: 0.7, tumble: 0.5 }, { p: [0.14, -0.2, -0.34], r: [0.1, 0, 0] }),
    merch('sunglasses', sunglassesGeometry(), vc(0.25, { metalness: 0.35, envMapIntensity: 1.6 }), { name: 'sunglasses', shape: { type: 'box', x: 0.066, y: 0.021, z: 0.066 }, mass: 0.03, bounce: 0.2, friction: 0.5, tumble: 0.4 }, 'click', { p: [0.12, -0.15, -0.32], r: [0.2, Math.PI, 0] }),
    merch('hat', hatGeometry(), vc(0.85), { name: 'hat', shape: { type: 'cyl', r: 0.15, h: 0.12 }, mass: 0.15, bounce: 0.1, friction: 0.7, drag: 1.2, tumble: 0.2 }, 'thunk', { p: [0.2, -0.22, -0.48], r: [0.35, 0, 0] }),
    merch('plush', plushGeometry(), vc(0.95), { name: 'plush', shape: { type: 'cyl', r: 0.055, h: 0.18 }, mass: 0.15, bounce: 0.3, friction: 0.8, drag: 0.4, tumble: 0.6 }, 'thunk'),
    merch('diceset', dicesetGeometry(), vc(0.35, { envMapIntensity: 1.4 }), { name: 'diceset', shape: { type: 'box', x: 0.06, y: 0.031, z: 0.04 }, mass: 0.12, bounce: 0.2, friction: 0.6, tumble: 0.5 }, 'click'),
  ];
}

/** How big a half-eaten thing looks: 1 whole, smaller with each bite, never quite nothing. */
export function biteScale(left: number, total: number): number {
  if (total <= 0) return 1;
  return 0.45 + 0.55 * Math.max(0, Math.min(1, left / total));
}
