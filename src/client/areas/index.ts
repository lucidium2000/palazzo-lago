import * as THREE from 'three';
import type { Sound } from '../audio';
import type { Interaction } from '../interaction';
import type { Crowd, Person } from '../people';
import type { Player, Viewpoint } from '../player';
import type { Quality } from '../quality';
import type { World } from '../world';
import { Elevators, type LandingId } from './elevators';
import { buildHotel, CORR, LOBBY, LOBBY_CARS, registerHotel } from './hotel';
import { mats } from './kit';
import { buildPool, DECK, LIFT, registerPool, type PoolArea } from './pool';
import { populatePool } from './poolguests';
import { buildSuite, registerSuite, SUITE, SUITE_CAR } from './suite';

/**
 * Everything beyond the casino floor: the hotel corridor and elevator lobby,
 * the night pool deck, and Suite 3201, joined by working elevators.
 */

/**
 * Walking-graph nodes so guests stroll out to the lobby and the pool. On the
 * deck they make a loop along the poolside walkways (between the coping and the
 * loungers), an outer loop behind the loungers, and cut-throughs at the gaps,
 * all closer than the graph's longest edge so every node joins up.
 */
export const AREA_NODES: [number, number][] = [
  // Hotel corridor, lobby, the pool doors.
  [16.4, 6.5],
  [21, 6.5],
  [27, 6.5],
  [32.5, 6.5],
  [36, 2.0],
  [36, -1.5],
  // North deck: in from the doors, past the lifts.
  [36, -5.5],
  [41, -6.8],
  [46, -6.3],
  [29.5, -7.5],
  // Behind the north loungers (the cut-throughs to the pool are the gaps at x 37.1 and 42.3).
  [29.5, -11.2],
  [35, -11],
  [42.3, -11],
  [47, -11],
  [51.5, -10.2],
  // The poolside walkway, all the way round (coping on one side, loungers on the other).
  [31, -14.85],
  [36, -14.85],
  [42.3, -14.85],
  [46, -14.85],
  [51, -14.85],
  [31, -20],
  [51, -20],
  [31.1, -24.85],
  [37.1, -25.15],
  [42.3, -25.15],
  [46, -25.15],
  [51, -25.15],
  // West deck by the pool bar, east deck by the hot tub and the cabanas.
  [27.6, -15.5],
  [27.6, -20.5],
  [54.5, -16.5],
  [55.5, -21.5],
  [55, -27.5],
  // Behind the south loungers, toward the DJ.
  [30.5, -29.6],
  [37.1, -29.4],
  [42.3, -29.4],
  [45.5, -29],
];

/** Collision and walkable floor for the new areas (call right after the hall is registered). */
export function registerAreas(world: World) {
  registerHotel(world);
  registerPool(world);
  registerSuite(world);
}

export interface Areas {
  nav: { id: string; label: string; viewpoint: Viewpoint }[];
  update(dt: number, t: number, feet: THREE.Vector3): void;
  /** Party music near the DJ (0..1). */
  musicLevel(feet: THREE.Vector3): number;
  /** 0..1 how far outdoors you are (the pool deck), for ambience. */
  outdoors(feet: THREE.Vector3): number;
  /** Adds the pool crowd (call before the floor's wanderers fill the crowd). */
  populate(crowd: Crowd): Person[];
  where(feet: THREE.Vector3): 'casino' | 'hotel' | 'pool' | 'suite';
  elevators: Elevators;
  /** The pool deck (the party's lights drive its water and LED wall). */
  pool: PoolArea;
  /** The guests on the dance floor (filled by populate). */
  dancers: Person[];
}

export function buildAreas(deps: {
  scene: THREE.Scene;
  quality: Quality;
  interaction: Interaction;
  sound: Sound;
  player: Player;
  world: World;
  toast: (text: string) => void;
}): Areas {
  const { scene, quality: q } = deps;
  const m = mats(q);
  buildHotel(scene, q, m);
  const pool = buildPool(scene, q, m);
  const dancers: Person[] = [];
  buildSuite(scene, q, m);
  // Night mood: the areas' materials carried a lot of self-lighting ("emissive fill") so
  // they read without lamps; the hemisphere fill now does that per zone, so keep only
  // the fixtures (bright emissives) glowing and let everything else sit in the dark.
  for (const name of ['pool', 'suite', 'hotel']) {
    scene.getObjectByName(name)?.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!mat || Array.isArray(mat) || !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial || mat.userData.dimmed) return;
      const e = mat.emissive;
      const lum = (e.r * 0.3 + e.g * 0.59 + e.b * 0.11) * mat.emissiveIntensity;
      if (lum < 0.35 && !mat.emissiveMap) mat.emissiveIntensity *= name === 'hotel' ? 0.7 : 0.4;
      mat.userData.dimmed = true;
    });
  }
  const lifts = new Elevators(scene, q, m, deps.interaction, deps.sound, deps.player, deps.toast, [
    { id: 'casino', doorX: LOBBY.x1, zs: LOBBY_CARS },
    { id: 'pool', doorX: LIFT.doorX, zs: LIFT.zs },
    { id: 'suite', doorX: SUITE_CAR.doorX, zs: [SUITE_CAR.z] },
  ]);
  lifts.registerWorld(deps.world);
  lifts.onRide = (dest: LandingId) => {
    if (dest === 'suite') deps.toast('Suite 3201');
    if (dest === 'pool') deps.toast('Pool Deck');
  };
  // The pool's water and the party.
  deps.sound.ambientAt('water', pool.anchor, { volume: 0.45, ref: 6, rolloff: 1.4 });

  const vp = (id: string, label: string, x: number, z: number, yaw: number, pitch = 0): { id: string; label: string; viewpoint: Viewpoint } => ({
    id,
    label,
    viewpoint: { id, label, position: new THREE.Vector3(x, 0, z), yaw, pitch, eye: 1.65 },
  });
  const nav = [
    vp('elevators', 'Elevators', 33, 8.5, -Math.PI / 2 + 0.25),
    vp('pool', 'Pool Deck', 36, -4.5, 0.05, -0.05),
    vp('suite', 'Suite 3201', SUITE.x1 - 1.6, 1.2, Math.PI / 2 + 0.5, -0.05),
  ];

  const where = (f: THREE.Vector3): ReturnType<Areas['where']> => {
    if (f.x > SUITE.x0 - 5) return 'suite';
    if (f.z < LOBBY.z0 - 0.2 && f.x > DECK.x0 - 1) return 'pool';
    if (f.x > CORR.x0 - 0.2) return 'hotel';
    return 'casino';
  };

  return {
    nav,
    where,
    elevators: lifts,
    update(dt, t) {
      lifts.update(dt);
      pool.update(t);
    },
    pool,
    dancers,
    musicLevel(f) {
      if (where(f) !== 'pool') return 0;
      const d = Math.hypot(f.x - 50, f.z + 31);
      return THREE.MathUtils.clamp(1 - d / 30, 0.25, 1);
    },
    outdoors(f) {
      return where(f) === 'pool' ? 1 : 0;
    },
    populate(crowd) {
      return populatePool(crowd, pool, dancers);
    },
  };
}
