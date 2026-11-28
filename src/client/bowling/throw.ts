import { BALL_R, HEAD_Z, LANE_HALF, type Launch } from './sim';

/**
 * From a swing to a ball on the lane (pure): the motion-game feel.
 *
 * In VR the ball takes your hand's release velocity, with a little help the
 * way living-room bowling games give it: the speed is scaled up a touch (a
 * relaxed arm swing should roll a real ball), the sideways part of the swing
 * is halved and clamped so the ball's line stays on the lane, and the
 * release point is kept over the boards. Your wrist's twist at the release
 * (the forearm's rotation about the line of the throw) and the hand's
 * sideways sweep put side spin on the ball, and side spin is what makes it
 * hook once it reaches the dry back end (see sim.ts).
 *
 * On a screen: aim (where you stand, and a slight angle), a power meter, and
 * a twist (spin) control map to the same launch.
 */

export const THROW = {
  /** Below this forward hand speed (m/s) it isn't a throw: the ball is set down. */
  minHand: 0.6,
  /** Ball speed = base + gain × hand speed, within limits (m/s). */
  base: 1.5,
  gain: 1.35,
  minSpeed: 1.2,
  maxSpeed: 10.5,
  /** How much of the hand's sideways speed the ball keeps. */
  lateralKeep: 0.5,
  /** Side spin per rad/s of wrist twist, and per m/s of sideways hand sweep. */
  spinPerTwist: 1.6,
  spinPerSweep: 4,
  /** The most side spin a throw gets (rad/s): a big hook, not a boomerang. */
  maxSpin: 16,
  /** Forward roll at release, as a share of rolling without skidding. */
  roll: 0.3,
} as const;

/** The hand as it lets go (lane frame: x positive to the bowler's left, z down the lane). */
export interface HandRelease {
  /** Where the ball's centre is. */
  x: number;
  y: number;
  z: number;
  /** The hand's velocity (m/s). */
  vx: number;
  vy: number;
  vz: number;
  /** The wrist's angular velocity about the lane's +z (rad/s, right-hand rule: negative is a right-hander's counter-clockwise turn). */
  twist: number;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** The release point kept over the lane. */
function onLane(x: number) {
  const lim = LANE_HALF - BALL_R - 0.01;
  return clamp(x, -lim, lim);
}

/** Keeps a ball's straight line on the lane as far as the head pin (sideways speed vx at forward speed vz from x). */
function keepLine(x: number, z: number, vx: number, vz: number) {
  const run = Math.max(1, HEAD_Z - z);
  const lim = LANE_HALF - 0.04;
  const lo = ((-lim - x) / run) * vz,
    hi = ((lim - x) / run) * vz;
  return clamp(vx, lo, hi);
}

/** The ball's speed for a hand's forward speed. */
export const ballSpeed = (hand: number) => clamp(THROW.base + THROW.gain * hand, THROW.minSpeed, THROW.maxSpeed);

/** A VR release: the launch, or null if the hand wasn't moving down the lane (the ball is just set down). */
export function launchFromHand(h: HandRelease): Launch | null {
  if (!(h.vz >= THROW.minHand)) return null;
  const vz = ballSpeed(h.vz);
  const x = onLane(h.x);
  const z = clamp(h.z, -1.2, 1.5);
  const vx = keepLine(x, z, h.vx * THROW.lateralKeep * (vz / Math.max(0.5, h.vz)) * 0.75, vz);
  const spin = clamp(h.twist * THROW.spinPerTwist - h.vx * THROW.spinPerSweep, -THROW.maxSpin, THROW.maxSpin);
  return {
    x,
    y: clamp(h.y, BALL_R, 0.9),
    z,
    vx,
    vy: clamp(h.vy, -2.5, 0.8),
    vz,
    wx: (THROW.roll * vz) / BALL_R,
    wy: 0,
    wz: spin,
  };
}

/** A screen throw: where you stand (lane x), the aim (rad, positive to your left), power 0..1, twist -1..1 (positive hooks left). */
export interface MeterThrow {
  x: number;
  aim: number;
  power: number;
  spin: number;
}

export function launchFromMeter(t: MeterThrow): Launch {
  const p = clamp(t.power, 0, 1);
  const vz = 3.6 + 6.4 * p;
  const x = onLane(t.x);
  const z = -0.12;
  const vx = keepLine(x, z, vz * Math.tan(clamp(t.aim, -0.08, 0.08)), vz);
  return { x, y: BALL_R + 0.02, z, vx, vy: 0, vz, wx: (THROW.roll * vz) / BALL_R, wy: 0, wz: -clamp(t.spin, -1, 1) * THROW.maxSpin };
}

/**
 * The swing meter on a screen: hold to swing back, let go to throw. The power
 * climbs to full in `rise` seconds and then sinks again (hold too long and the
 * moment's gone), like timing a real backswing.
 */
export function meterPower(held: number, rise = 1.1): number {
  if (held <= 0) return 0;
  const k = (held / rise) % 2;
  const tri = k <= 1 ? k : 2 - k;
  // Eased: quick off the mark, lingering near the top.
  return Math.sin((tri * Math.PI) / 2);
}

/** World velocity → lane frame (the lanes run west: down the lane is world -x, the bowler's left is world +z). */
export function worldToLaneVel(vx: number, vz: number): { x: number; z: number } {
  return { x: vz, z: -vx };
}
