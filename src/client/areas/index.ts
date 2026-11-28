import * as THREE from 'three';
import type { Sound } from '../audio';
import type { Interaction } from '../interaction';
import type { Crowd, Person } from '../people';
import type { Performers } from '../party/performers';
import type { Player, Viewpoint } from '../player';
import type { Quality } from '../quality';
import type { World } from '../world';
import { Elevators, type LandingId } from './elevators';
import { buildHotel, CORR, LOBBY, LOBBY_CARS, registerHotel } from './hotel';
import { mats } from './kit';
import { buildPool, DECK, LIFT, registerPool, type PoolArea } from './pool';
import { populatePool } from './poolguests';
import { buildSuite, registerSuite, SUITE, SUITE_CAR } from './suite';
import { buildPromenade, mountArcade, populatePromenade, PROM_CARS, promenadeShare, registerPromenade, type PromenadeArea, type PromenadeCast } from './promenade';
import { onPromenade } from './promenadeplan';
import { buildEntrance, ENT_CARS, entranceShare, onEntrance, registerEntrance, type EntranceArea } from './entrance';
import type { Hands } from '../hands';
import { BOWL_CARS, bowlingShare, buildBowling, FOUL_X, onBowling, registerBowling, RIG_FACE_PINS, type BowlingArea } from '../bowling';

export { PROMENADE_NODES } from './promenadeplan';

/**
 * Everything beyond the casino floor: the hotel corridor and elevator lobby,
 * the night pool deck, Suite 3201 and the Promenade (food court, boutique,
 * arcade), joined by working elevators.
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
  registerPromenade(world);
  registerEntrance(world);
  registerBowling(world);
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
  where(feet: THREE.Vector3): 'casino' | 'hotel' | 'pool' | 'suite' | 'promenade' | 'entrance' | 'bowling';
  elevators: Elevators;
  /** The pool deck (the party's lights drive its water and LED wall). */
  pool: PoolArea;
  /** The guests on the dance floor (filled by populate). */
  dancers: Person[];
  /** The DJ and the headliner (filled by populate, first after the bartender). */
  performers: Performers;
  /** The Promenade: food court, boutique, arcade. */
  promenade: PromenadeArea;
  /** Its cooks, clerk and guests (filled by populate). */
  promenadeCast: PromenadeCast | null;
  /** The front entrance: the porte-cochère, the taxi line and the rideshare bays. */
  entrance: EntranceArea;
  /** Palazzo Lanes, the bowling lounge on the lower level. */
  bowling: BowlingArea;
}

export function buildAreas(deps: {
  scene: THREE.Scene;
  quality: Quality;
  interaction: Interaction;
  sound: Sound;
  player: Player;
  world: World;
  hands: Hands;
  dom: HTMLElement;
  toast: (text: string) => void;
}): Areas {
  const { scene, quality: q } = deps;
  const m = mats(q);
  buildHotel(scene, q, m);
  const pool = buildPool(scene, q, m);
  const dancers: Person[] = [];
  const performers: Performers = { dj: null, singer: null, band: [], extras: [] };
  buildSuite(scene, q, m);
  // The arcade module fills the arcade's bays with games; until it's in, dark cabinets stand there.
  const promenade = buildPromenade(scene, q, m, { placeholders: !mountArcade });
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
    // (Last, so the other cars keep their slots: every machine numbers them the same.)
    { id: 'promenade', doorX: PROM_CARS.doorX, zs: PROM_CARS.zs },
    { id: 'entrance', doorX: ENT_CARS.doorX, zs: ENT_CARS.zs },
    { id: 'bowling', doorX: BOWL_CARS.doorX, zs: BOWL_CARS.zs },
  ]);
  lifts.registerWorld(deps.world);
  lifts.onRide = (dest: LandingId) => {
    if (dest === 'suite') deps.toast('Suite 3201');
    if (dest === 'pool') deps.toast('Pool Deck');
    if (dest === 'promenade') deps.toast('The Promenade · food court, Lago Luxe, the arcade');
    if (dest === 'entrance') deps.toast('Main Entrance · the doors out to the taxis and rideshare');
    if (dest === 'bowling') deps.toast('Palazzo Lanes · eight lanes, the bar and the lounge');
  };
  // The lower level: the bowling lounge.
  const bowling = buildBowling({ scene, q, m, interaction: deps.interaction, sound: deps.sound, player: deps.player, hands: deps.hands, dom: deps.dom, toast: deps.toast });
  // The ground floor's lobby and the driveway out front (its cars run on everyone's shared clock).
  const entrance = buildEntrance({ scene, q, m, interaction: deps.interaction, sound: deps.sound, player: deps.player, world: deps.world, others: () => lifts.others() });
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
    vp('promenade', 'Promenade', PROM_CARS.doorX - 2.6, 0, Math.PI / 2, -0.04),
    vp('arcade', 'Arcade', -622.75, 3.2, Math.PI, -0.05),
    vp('entrance', 'Main Entrance', 300.5, 3.6, Math.PI + 0.55, -0.04),
    vp('bowling', 'Palazzo Lanes', FOUL_X + 6.4, 2.2, RIG_FACE_PINS + 0.1, -0.06),
  ];

  const where = (f: THREE.Vector3): ReturnType<Areas['where']> => {
    if (onPromenade(f.x)) return 'promenade';
    if (onEntrance(f.x)) return 'entrance';
    if (onBowling(f.x)) return 'bowling';
    if (f.x > SUITE.x0 - 5) return 'suite';
    if (f.z < LOBBY.z0 - 0.2 && f.x > DECK.x0 - 1) return 'pool';
    if (f.x > CORR.x0 - 0.2) return 'hotel';
    return 'casino';
  };

  const areas: Areas = {
    nav,
    where,
    elevators: lifts,
    update(dt, t, feet) {
      lifts.update(dt);
      pool.update(t);
      promenade.update(t);
      entrance.update(dt, feet);
      bowling.update(dt, feet);
    },
    pool,
    dancers,
    performers,
    promenade,
    promenadeCast: null,
    entrance,
    bowling,
    musicLevel(f) {
      if (where(f) !== 'pool') return 0;
      const d = Math.hypot(f.x - 50, f.z + 31);
      return THREE.MathUtils.clamp(1 - d / 30, 0.25, 1);
    },
    outdoors(f) {
      const w = where(f);
      return w === 'pool' || (w === 'entrance' && f.z > 0) ? 1 : 0;
    },
    populate(crowd) {
      // The Promenade has its own share of the crowd (see Crowd's capacity): first, as the pool party takes all it can.
      areas.promenadeCast = populatePromenade(crowd, promenade, promenadeShare(q.people));
      entrance.populate(crowd, entranceShare(q.people));
      bowling.populate(crowd, bowlingShare(q.people));
      return populatePool(crowd, pool, dancers, performers);
    },
  };
  return areas;
}
