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

/** An original look: a teal sequin jacket over a black silk shirt, cream trousers, white patent shoes, a gold chain. */
export const LOOK_HEADLINER: Look = {
  kind: 'male_suit',
  dress: false,
  main: 0x1c8c92,
  topSurf: 'sequin',
  second: 0x0e0e12,
  shirtSurf: 'silk',
  accent: 0x0e0e12,
  accentSurf: 'silk',
  bottom: 0xe8dfca,
  bottomSurf: 'wool',
  shoes: 0xf4f2ee,
  shoeSurf: 'patent',
  skin: 0xb07850,
  hair: 0x16100c,
  hairStyle: 'short',
  height: 1.84,
  jewel: 0xd8b24a,
  glint: true,
};

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
