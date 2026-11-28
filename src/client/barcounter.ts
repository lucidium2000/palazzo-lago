import * as THREE from 'three';
import type { BarId } from './bar';

/**
 * Where things happen along a bar counter you can order at: Bar Lago's
 * straight one in the casino, and the round one out by the pool. A spot along
 * the counter is one number `s`: Bar Lago's z, or the angle round the pool
 * bar (radians, 0 = +x, toward +z). The bartender works the spot from her
 * side; your drink waits on the guests' side.
 */
export interface Counter {
  id: BarId;
  /** Height of the counter top. */
  top: number;
  /** A spot kept where there is counter (and not right at an end). */
  clamp(s: number): number;
  /** The spot nearest a point on the floor (clamped). */
  spotAt(x: number, z: number): number;
  /** Where a drink is set down for a guest at spot `s` (on the top, guests' side). `npc`: a regular's, a little further in. */
  serveAt(s: number, npc?: boolean): THREE.Vector3;
  /** Where the bartender makes a drink for spot `s` (on the top, her side). */
  pourAt(s: number): THREE.Vector3;
  /** The spot of the beer taps, if the bar has one place for them (else beer is drawn where it's made). */
  tapSpot: number | null;
  /** Where the tap's spout is, for a beer made at spot `s`. */
  tapAt(s: number): THREE.Vector3;
  /** Where the bartender stands to work spot `s`, and which way she faces (toward the guests). */
  workAt(s: number): { x: number; z: number; yaw: number };
  /** Standing at the counter on the guests' side, close enough to be served (VR: the menu comes up). */
  near(x: number, z: number): boolean;
  /** Where the menu panel stands on the top for spot `s` (VR), facing the guest. */
  menuAt(s: number): { pos: THREE.Vector3; yaw: number };
  /** How far apart two spots are along the counter (metres). */
  gap(a: number, b: number): number;
}

/** Bar Lago: a straight counter along x = -15 (z 6.2 to 12.4), guests on its +x side. */
export function lagoCounter(): Counter {
  const X = -15.0,
    Z0 = 6.2,
    Z1 = 12.4,
    TOP = 1.1;
  const POUR_X = X - 0.2,
    SERVE_X = X + 0.32;
  const clamp = (z: number) => THREE.MathUtils.clamp(z, Z0 + 0.4, Z1 - 0.4);
  return {
    id: 'lago',
    top: TOP,
    clamp,
    spotAt: (_x, z) => clamp(z),
    serveAt: (z, npc = false) => new THREE.Vector3(npc ? X + 0.28 : SERVE_X, TOP, z),
    pourAt: (z) => new THREE.Vector3(POUR_X, TOP, z),
    tapSpot: 11.6,
    tapAt: () => new THREE.Vector3(POUR_X + 0.03, TOP + 0.26, 11.6),
    workAt: (z) => ({ x: -16.0, z, yaw: Math.PI / 2 }),
    near: (x, z) => x > X + 0.3 && x < X + 2.0 && z > Z0 && z < Z1,
    menuAt: (z) => ({ pos: new THREE.Vector3(X + 0.02, TOP + 0.36, THREE.MathUtils.clamp(z, Z0 + 0.5, Z1 - 0.5)), yaw: Math.PI / 2 }),
    gap: (a, b) => Math.abs(a - b),
  };
}

/** The round pool bar's counter top: a ring between these radii, at this height. */
export const ROUND_TOP = { inner: 1.62, outer: 2.3, y: 1.1 };

/**
 * A round island bar centred at (x, z): the bartender works inside the ring
 * (round the central column), guests stand outside it.
 */
export function roundCounter(id: BarId, bar: { x: number; z: number; r: number }): Counter {
  const { inner, outer, y: TOP } = ROUND_TOP;
  const at = (a: number, r: number, y = TOP) => new THREE.Vector3(bar.x + Math.cos(a) * r, y, bar.z + Math.sin(a) * r);
  /** Facing out from the centre at angle a (a person's yaw: atan2 of the facing direction's x and z). */
  const out = (a: number) => Math.atan2(Math.cos(a), Math.sin(a));
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const SERVE = outer - 0.2;
  return {
    id,
    top: TOP,
    clamp: wrap,
    spotAt: (x, z) => Math.atan2(z - bar.z, x - bar.x),
    serveAt: (a, npc = false) => at(a, npc ? SERVE - 0.12 : SERVE),
    pourAt: (a) => at(a, inner + 0.2),
    tapSpot: null,
    tapAt: (a) => at(a, inner + 0.2, TOP + 0.3),
    workAt: (a) => {
      const p = at(a, 1.3, 0);
      return { x: p.x, z: p.z, yaw: out(a) };
    },
    near: (x, z) => {
      const d = Math.hypot(x - bar.x, z - bar.z);
      return d > outer - 0.1 && d < outer + 0.9;
    },
    menuAt: (a) => ({ pos: at(a, (inner + outer) / 2 + 0.05, TOP + 0.36), yaw: out(a) }),
    gap: (a, b) => Math.abs(wrap(a - b)) * SERVE,
  };
}
