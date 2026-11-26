/**
 * Pushed off your seat: what a seated guest (a slot player, someone at the
 * bar or a table) does after a hard shove or a punch knocks them off it. They
 * stumble off the stool, stand there glaring at you for a few seconds, then
 * either walk straight back and sit down again (if you're not sitting in their
 * place), or wander off for a while before coming back. While they're gone the
 * seat is free.
 *
 * Pure state machine (no three.js): bodies.ts moves the person and reads the
 * phase; this decides when phases change. Unit tested.
 */

export type UnseatPhase = 'stumble' | 'glare' | 'return' | 'wander' | 'loiter' | 'sit';

export interface Unseat {
  phase: UnseatPhase;
  /** Seconds into this phase, and how long it lasts (when it has a set length). */
  t: number;
  T: number;
  /** The seat they were knocked off: where, facing which way, hip height, recline. */
  homeX: number;
  homeZ: number;
  homeYaw: number;
  seatY: number;
  lie: number;
  /** Where they're walking to (home, or somewhere to cool off). */
  goalX: number;
  goalZ: number;
  /** Seconds they've waited for you to get off their seat. */
  waited: number;
  /** Seconds they've been stuck walking (furniture in the way). */
  stuck: number;
}

/** How long each phase lasts (seconds). */
export const UNSEAT = {
  stumble: 0.9,
  glare: [3, 6] as const,
  loiter: [20, 40] as const,
  /** Chance they walk straight back rather than wander off first. */
  backChance: 0.55,
  /** Waiting at the seat while someone's on it, before giving up and wandering. */
  wait: 4,
  /** Walking speed (m/s). */
  walk: 0.9,
  /** Close enough to the goal. */
  near: 0.12,
  /** How far they go to cool off. */
  wander: [2.2, 4] as const,
};

/**
 * Is this hand push hard enough to knock someone off their seat? A punch is;
 * otherwise the hand has to be moving into them at a real shove's speed.
 */
export function knocksOffSeat(into: number, punch: boolean): boolean {
  return punch || into >= 1.2;
}

export function unseat(homeX: number, homeZ: number, homeYaw: number, seatY: number, lie = 0): Unseat {
  return { phase: 'stumble', t: 0, T: UNSEAT.stumble, homeX, homeZ, homeYaw, seatY, lie, goalX: homeX, goalZ: homeZ, waited: 0, stuck: 0 };
}

const range = (r: readonly [number, number], rnd: () => number) => r[0] + (r[1] - r[0]) * rnd();

export interface UnseatWorld {
  /** Distance from the person to their current goal (metres). */
  toGoal: number;
  /** Nobody's sitting (or standing) on their seat. */
  seatFree: boolean;
  rnd(): number;
  /** Somewhere to go and cool off (a free spot a few metres from the seat). */
  wanderGoal(dist: number): [number, number];
}

/** Advances the state machine by dt; returns the (possibly new) phase. 'sit' means: sit them back down now. */
export function stepUnseat(u: Unseat, dt: number, w: UnseatWorld): UnseatPhase {
  u.t += dt;
  const go = (phase: UnseatPhase, T = Infinity) => {
    u.phase = phase;
    u.t = 0;
    u.T = T;
    u.stuck = 0;
  };
  const home = () => {
    u.goalX = u.homeX;
    u.goalZ = u.homeZ;
    u.waited = 0;
    go('return');
  };
  const leave = () => {
    [u.goalX, u.goalZ] = w.wanderGoal(range(UNSEAT.wander, w.rnd));
    go('wander');
  };
  switch (u.phase) {
    case 'stumble':
      if (u.t >= u.T) go('glare', range(UNSEAT.glare, w.rnd));
      break;
    case 'glare':
      if (u.t >= u.T) {
        if (w.rnd() < UNSEAT.backChance) home();
        else leave();
      }
      break;
    case 'return':
      if (w.toGoal <= UNSEAT.near + 0.3 && !w.seatFree) {
        // Someone's in their seat: they wait a little, then give up and go.
        u.waited += dt;
        if (u.waited > UNSEAT.wait) leave();
      } else if (w.toGoal <= UNSEAT.near) go('sit');
      break;
    case 'wander':
      if (w.toGoal <= UNSEAT.near || u.t > 20) go('loiter', range(UNSEAT.loiter, w.rnd));
      break;
    case 'loiter':
      if (u.t >= u.T) home();
      break;
    case 'sit':
      break;
  }
  return u.phase;
}

/** Walking now (to the seat or away from it)? */
export const walking = (u: Unseat) => u.phase === 'return' || u.phase === 'wander';
