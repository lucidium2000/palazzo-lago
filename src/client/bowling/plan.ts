/**
 * Palazzo Lanes, the resort's boutique bowling lounge on the lower level
 * (floor "B"): pure numbers, no three.js, so tests can check them.
 *
 * Like the suite, the Promenade and the Main Entrance it lives far from the
 * casino in the world (west, x ≈ -300, between the casino and the Promenade
 * at x < -500), reached only by elevator.
 *
 * Plan (looking down from above; north is -z):
 *
 *   x = -321   -318.3        -300 (foul line)  -295.4     -290        -281 (lift doors)
 *     │ pit │ pins ◄── lanes (18.3 m) ──── │ approach │ lounge │ concourse ║ cars
 *     │     │ ▲▲▲▲  1 … 8 (z -6.3 … 6.3)   │          │ sofas  │ bar (N)   ║
 *     │     │ (pinsetter fascia over them) │          │ returns│ shoes (S) ║
 *
 * The lanes run west: you bowl facing -x. Each lane has its own frame: x
 * across (positive to the bowler's left, which is +z in the world), y up,
 * z down the lane from the foul line (see sim.ts). World = lane:
 *   X = FOUL_X - z,  Y = y,  Z = laneZ(i) + x.
 */

/** The foul line (world x) of every lane. */
export const FOUL_X = -300;
export const LANES = 8;
/** Lane centre lines (world z), lane 0 the northmost. */
export const LANE_PITCH = 1.8;
export const laneZ = (i: number) => (i - (LANES - 1) / 2) * LANE_PITCH;

/** The room. */
export const ROOM = { x0: -321.6, x1: -281, z0: -9.6, z1: 9.6, h: 3.9 };
/** Where the approaches end and the lounge starts (a step up to the settees). */
export const APPROACH_END = FOUL_X + 4.6;
/** The settee lounge behind the approaches, and the concourse (bar, shoes, lifts) behind it. */
export const LOUNGE = { x0: APPROACH_END, x1: -290.2 };
export const CONCOURSE = { x0: -290.2, x1: ROOM.x1 };
/** The elevator bank in the east wall (doors on the wall, cabs extending east). */
export const BOWL_CARS = { doorX: ROOM.x1, zs: [-1.3, 1.3] };
/** Ball returns: one between each pair of lanes (lanes 2k and 2k+1), its hood and rack. */
export const RETURNS = Array.from({ length: LANES / 2 }, (_, k) => ({ z: (laneZ(2 * k) + laneZ(2 * k + 1)) / 2, lanes: [2 * k, 2 * k + 1] as [number, number] }));
/** The return's rack runs from the hood (x0) back to the end stop (x1). */
export const RACK = { x0: FOUL_X + 1.35, x1: FOUL_X + 2.6, y: 0.62 };
/** House balls on each return: weight (lb) and colour. */
export const HOUSE_BALLS: { lb: number; color: number; swirl: number }[] = [
  { lb: 8, color: 0x2bb7b0, swirl: 0xbff4ee },
  { lb: 10, color: 0x7a3cc8, swirl: 0xd4b8ff },
  { lb: 12, color: 0xc81e32, swirl: 0xffb0a8 },
  { lb: 14, color: 0x14286a, swirl: 0x6a9cff },
  { lb: 16, color: 0x101012, swirl: 0xd8b46a },
];
/** The bar (north end of the concourse) and the shoe counter (south end). */
export const BAR = { x0: -289.2, x1: -283.4, z0: -9.0, z1: -7.2 };
export const SHOES = { x0: -289.2, x1: -284.0, z0: 7.2, z1: 9.0 };

/** Is (x) the bowling alley? (It's the only thing out here.) */
export const onBowling = (x: number) => x > -450 && x < -150;

/** How many staff and guests the alley adds to the crowd (on top of the floor's). */
export function bowlingShare(people: number) {
  return people >= 45 ? 12 : 10;
}

/** Which lane a world z is over (nearest centre line), or -1 beyond the outer lanes. */
export function laneAt(z: number): number {
  const i = Math.round(z / LANE_PITCH + (LANES - 1) / 2);
  return i >= 0 && i < LANES && Math.abs(z - laneZ(i)) < LANE_PITCH / 2 + 0.01 ? i : -1;
}

/** World → lane frame (x across, positive to the bowler's left; z down the lane). */
export function toLane(i: number, X: number, Z: number): { x: number; z: number } {
  return { x: Z - laneZ(i), z: FOUL_X - X };
}

/** Lane frame → world. */
export function toWorld(i: number, x: number, z: number): { X: number; Z: number } {
  return { X: FOUL_X - z, Z: laneZ(i) + x };
}

/** The bowler's yaw (person convention: atan2(dx, dz)) facing down the lanes (west). */
export const FACE_PINS = -Math.PI / 2;
/** The player rig's yaw facing down the lanes (camera looks along -z of the rig: west is yaw +π/2). */
export const RIG_FACE_PINS = Math.PI / 2;
