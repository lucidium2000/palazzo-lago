import * as THREE from 'three';
import type { Crowd, Look, Person } from '../people';
import { DJ, STAGE } from '../areas/pool';

/**
 * The pool party's performers: the resident DJ (party/decks.ts) and the
 * headliner (party/stage.ts). They're added to the crowd first thing when the
 * pool is populated, so a small crowd (headsets, phones) never leaves them out.
 */

/** The resident DJ: black tee, dark jeans, white sneakers. */
export const LOOK_DJ: Look = {
  kind: 'male_casual_2',
  dress: false,
  main: 0x15151a,
  second: 0x15151a,
  bottom: 0x23252c,
  topSurf: 'cotton',
  bottomSurf: 'denim',
  shoes: 0xf0eee8,
  shoeSurf: 'cotton',
  skin: 0x8a5a3c,
  hair: 0x141010,
  hairStyle: 'short',
  height: 1.8,
  jewel: 0xc9c9cf,
  glint: true,
};

/**
 * The headliner: an original character made for Palazzo Lago (his name, look
 * and songs were all invented here, after no real artist).
 */
export const HEADLINER = {
  name: 'ORLO VANTE',
  tagline: 'LIVE ON THE POOL STAGE · TONIGHT',
};

/**
 * His stage look (original, and nobody's famous outfit): a metallic teal sequin
 * jacket over a black silk shirt, black satin trousers, silver metallic shoes
 * that catch the lights, a gold chain, and a statement belt (gunmetal, a big
 * gold buckle: `dressBelt`).
 */
export const LOOK_HEADLINER: Look = {
  kind: 'male_suit',
  dress: false,
  main: 0x12a8b4,
  topSurf: 'sequin',
  second: 0x0c0c10,
  shirtSurf: 'silk',
  accent: 0x0c0c10,
  accentSurf: 'silk',
  bottom: 0x101014,
  bottomSurf: 'satin',
  shoes: 0xd9dde6,
  shoeSurf: 'metal',
  skin: 0xb07850,
  hair: 0x16100c,
  hairStyle: 'short',
  height: 1.84,
  jewel: 0xd8b24a,
  glint: true,
};

/** The belt round the trousers' waistband (the character file's bind space, m): centre, half-widths, height. */
const BELT = { y: 1.0, z: 0.052, rx: 0.148, rz: 0.113, h: 0.048 };

/**
 * Buckles his statement belt on (one small mesh, riding his hips bone exactly
 * as the skin there does): a gunmetal band and a big gold buckle. Once per rig.
 */
export function dressBelt(rig: { mesh: THREE.SkinnedMesh | null; bones: Record<string, THREE.Object3D> }) {
  const mesh = rig.mesh,
    hips = rig.bones.Hips;
  if (!mesh || !hips || hips.getObjectByName('headliner-belt')) return;
  const i = mesh.skeleton.bones.indexOf(hips as THREE.Bone);
  if (i < 0) return;
  const band = new THREE.CylinderGeometry(1, 1, BELT.h, 28, 1, true).scale(BELT.rx, 1, BELT.rz);
  const buckle = new THREE.BoxGeometry(0.085, BELT.h + 0.012, 0.014).translate(0, 0, BELT.rz + 0.006);
  const plate = new THREE.BoxGeometry(0.05, BELT.h - 0.016, 0.006).translate(0, 0, BELT.rz + 0.015);
  const parts = [band, buckle, plate].map((g) => g.toNonIndexed());
  const cols = [0x2c2e34, 0xe0b850, 0xf4dc8a];
  const pos: number[] = [],
    nor: number[] = [],
    col: number[] = [];
  const c = new THREE.Color();
  parts.forEach((g, k) => {
    pos.push(...(g.attributes.position.array as Float32Array));
    nor.push(...(g.attributes.normal.array as Float32Array));
    c.setHex(cols[k]);
    for (let v = 0; v < g.attributes.position.count; v++) col.push(c.r, c.g, c.b);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const belt = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.85, roughness: 0.28, envMapIntensity: 1.2 }));
  belt.name = 'headliner-belt';
  belt.raycast = () => {};
  belt.frustumCulled = false;
  // Where the skin puts a point held rigidly by the hips: bone × its inverse bind × the mesh's bind.
  belt.matrixAutoUpdate = false;
  belt.matrix.copy(mesh.skeleton.boneInverses[i]).multiply(mesh.bindMatrix).multiply(new THREE.Matrix4().makeTranslation(0, BELT.y, BELT.z));
  hips.add(belt);
}

export interface Performers {
  dj: Person | null;
  singer: Person | null;
}

/** Where the DJ stands behind the decks, and where the headliner waits between sets. */
export const DJ_SPOT = new THREE.Vector3(DJ.x, STAGE.y, DJ.z - 0.13);
export const SINGER_BACK = new THREE.Vector3(STAGE.x0 + 0.9, STAGE.y, STAGE.z0 + 0.65);

export function addPerformers(crowd: Crowd, into: Performers) {
  into.dj = crowd.add('watch', LOOK_DJ, DJ_SPOT, 0);
  into.singer = crowd.add('watch', LOOK_HEADLINER, SINGER_BACK, Math.PI / 2);
  for (const p of [into.dj, into.singer]) if (p) p.curious = false;
}
