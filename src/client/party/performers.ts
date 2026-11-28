import * as THREE from 'three';
import type { Crowd, Look, Person } from '../people';
import { BAND, DJ, STAGE } from '../areas/pool';

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
 * The headliner: NIXIE VALE, an electropop star in her late twenties, an
 * original character made for Palazzo Lago (her name, look and moves were all
 * invented here, after no real artist; her song is the owner's "Chasing Dawn").
 */
export const HEADLINER = {
  name: 'NIXIE VALE',
  tagline: 'LIVE ON THE POOL STAGE · TONIGHT',
};

/**
 * Her stage look (original, and nobody's famous outfit): a cropped holographic
 * lilac jacket (sequinned, so it throws the lights back) over a sleek black
 * silk top, high-waisted black leather trousers, black patent platform boots,
 * gold statement earrings, a berry lip, and long brunette hair (`dressStar`
 * adds the hair and the earrings to her character).
 */
export const LOOK_HEADLINER: Look = {
  kind: 'female_suit',
  dress: false,
  main: 0xc2a8ff,
  topSurf: 'sequin',
  second: 0x0c0b10,
  shirtSurf: 'silk',
  accent: 0x0c0b10,
  accentSurf: 'silk',
  bottom: 0x0d0c10,
  bottomSurf: 'leather',
  shoes: 0x0a0a0c,
  shoeSurf: 'patent',
  skin: 0xd6a582,
  hair: 0x3b2417,
  hairStyle: 'long',
  height: 1.72,
  jewel: 0xe2bd52,
  glint: true,
  lipstick: 0x9e1f4a,
};

/** Her band (all original looks): keys, drums, bass. */
export const LOOK_KEYS: Look = {
  kind: 'female_casual',
  dress: false,
  main: 0x16161c,
  second: 0x16161c,
  bottom: 0x1d1d26,
  topSurf: 'cotton',
  bottomSurf: 'denim',
  shoes: 0xeceae4,
  shoeSurf: 'leather',
  skin: 0xf0c8a8,
  hair: 0xd8d2c8,
  hairStyle: 'short',
  height: 1.68,
  jewel: 0xc9c9cf,
  glint: true,
};
export const LOOK_DRUMS: Look = {
  kind: 'male_casual_2',
  dress: false,
  main: 0x7a1830,
  second: 0x7a1830,
  bottom: 0x15151a,
  topSurf: 'cotton',
  bottomSurf: 'denim',
  shoes: 0x121212,
  shoeSurf: 'leather',
  skin: 0x6a4028,
  hair: 0x0e0b0a,
  hairStyle: 'short',
  height: 1.82,
  jewel: 0xc9c9cf,
  glint: false,
};
export const LOOK_BASS: Look = {
  kind: 'male_casual_2',
  dress: false,
  main: 0x2a3c52,
  second: 0x2a3c52,
  bottom: 0x101014,
  topSurf: 'cotton',
  bottomSurf: 'leather',
  shoes: 0x1a1210,
  shoeSurf: 'leather',
  skin: 0xc49070,
  hair: 0x4a2a16,
  hairStyle: 'short',
  height: 1.79,
  jewel: 0xd8b24a,
  glint: true,
};

/**
 * Long hair and statement earrings for the star, riding her head bone exactly
 * as the skin there does (one small mesh, vertex colours): a crown over the
 * model's own hair, a long fall down her back past the shoulder blades, two
 * front locks over the collarbones, and a gold hoop at each ear. Once per rig.
 */
export function dressStar(rig: { mesh: THREE.SkinnedMesh | null; bones: Record<string, THREE.Object3D> }, hairColor = LOOK_HEADLINER.hair, gold = 0xe2bd52) {
  const mesh = rig.mesh,
    head = rig.bones.Head;
  if (!mesh || !head || head.getObjectByName('star-hair')) return;
  const i = mesh.skeleton.bones.indexOf(head as THREE.Bone);
  if (i < 0) return;
  // The head bone's place in the mesh's bind space: hair is built round it.
  const bindHead = new THREE.Matrix4().copy(mesh.skeleton.boneInverses[i]).invert();
  const hp = new THREE.Vector3().setFromMatrixPosition(mesh.bindMatrixInverse.clone().multiply(bindHead));
  const H = 0.105; // head radius (bind units, ~m)
  const cy = hp.y + 0.1; // the skull's centre, a little above the head joint
  const parts: { g: THREE.BufferGeometry; c: number }[] = [];
  const crown = new THREE.SphereGeometry(H * 1.08, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.62).scale(1, 1.02, 1.08).translate(hp.x, cy + 0.005, hp.z - 0.012);
  parts.push({ g: crown, c: hairColor });
  // The fall: a tapered, slightly curved sheet from the crown down the back.
  const fall = new THREE.CylinderGeometry(H * 0.98, H * 1.25, 0.46, 16, 4, true, Math.PI * 0.62, Math.PI * 0.76).translate(0, -0.23, 0);
  fall.translate(hp.x, cy - 0.02, hp.z - 0.02);
  parts.push({ g: fall, c: hairColor });
  for (const sx of [-1, 1]) {
    const lock = new THREE.CapsuleGeometry(0.028, 0.26, 3, 8).translate(hp.x + sx * H * 0.92, cy - 0.17, hp.z + 0.035);
    parts.push({ g: lock, c: hairColor });
    const hoop = new THREE.TorusGeometry(0.018, 0.0035, 6, 16).translate(hp.x + sx * (H * 0.97), cy - 0.085, hp.z + 0.005);
    parts.push({ g: hoop, c: gold });
  }
  const pos: number[] = [],
    nor: number[] = [],
    col: number[] = [];
  const c = new THREE.Color();
  for (const { g, c: hex } of parts) {
    const n = g.toNonIndexed();
    pos.push(...(n.attributes.position.array as Float32Array));
    nor.push(...(n.attributes.normal.array as Float32Array));
    c.setHex(hex).convertSRGBToLinear();
    for (let v = 0; v < n.attributes.position.count; v++) col.push(c.r, c.g, c.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const hair = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15, side: THREE.DoubleSide }));
  hair.name = 'star-hair';
  hair.raycast = () => {};
  hair.frustumCulled = false;
  hair.matrixAutoUpdate = false;
  // Bind space → the head bone's frame: the bone's inverse bind × the mesh's bind matrix.
  hair.matrix.copy(mesh.skeleton.boneInverses[i]).multiply(mesh.bindMatrix);
  head.add(hair);
}

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
  /** Her band: keys, drums, bass (any may be missing in a tiny crowd). */
  band: (Person | null)[];
  /** Concert-goers who come in while she's on (away until then: party/audience.ts). */
  extras: Person[];
}

/** Where the DJ stands behind the decks, and where the headliner waits between sets. */
export const DJ_SPOT = new THREE.Vector3(DJ.x, STAGE.y, DJ.z - 0.13);
// (Stage left, in front of the keys rig: clear of the band.)
export const SINGER_BACK = new THREE.Vector3(STAGE.x0 + 0.65, STAGE.y, STAGE.z1 - 0.85);

export function addPerformers(crowd: Crowd, into: Performers) {
  into.dj = crowd.add('watch', LOOK_DJ, DJ_SPOT, 0);
  into.singer = crowd.add('watch', LOOK_HEADLINER, SINGER_BACK, Math.PI / 2);
  const looks = [LOOK_KEYS, LOOK_DRUMS, LOOK_BASS];
  into.band = BAND.map((b, k) => crowd.add('watch', looks[k], new THREE.Vector3(b.x, STAGE.y + b.riser, b.z), b.yaw, { reserved: true }));
  for (const p of [into.dj, into.singer, ...into.band]) if (p) p.curious = false;
  // They're working: the DJ and the band never chat; she only talks about the show, and not a word while she's on.
  if (into.dj) into.dj.performer = 'dj';
  if (into.singer) into.singer.performer = 'singer';
  for (const b of into.band) if (b) b.performer = 'band';
}

/** The concert-goers (away until she's on), in their reserved share of the crowd. */
export function addConcertGoers(crowd: Crowd, into: Performers, n: number, look: () => Look) {
  into.extras = [];
  for (let k = 0; k < n; k++) {
    const p = crowd.add('watch', look(), new THREE.Vector3(60, 0, -29), -Math.PI / 2, { reserved: true });
    if (!p) break;
    p.away = true;
    into.extras.push(p);
  }
}
