/**
 * What a punch does, from the physics of it: how fast the fist was moving,
 * how much mass was behind it, and where it landed (the head, the body, or
 * the gloves held up in front of the face).
 *
 * The fist carries the hand and forearm (and some shoulder when it's thrown
 * properly): FIST_MASS kilograms. Its kinetic energy, against a solid punch's
 * (REF_SPEED with that mass), sets the damage; its momentum sets the knock-back.
 * A hard, clean shot to the head is a crit (more damage, a stagger); a hard
 * one to the body winds them (a stagger, no crit). Gloves in the way take
 * most of it (a block): a little damage, no crit, no stagger, a small push.
 *
 * Pure (no three.js) so it can be unit tested: tests/fightmode.test.ts.
 */

export type Spot = 'head' | 'body' | 'guard';

/** Effective mass behind a punch (kg): fist, forearm and a bit of shoulder. */
export const FIST_MASS = 1.6;
/** Slower than this (m/s) it's a touch, not a punch. */
export const MIN_SPEED = 1.6;
/** A solid, committed punch (m/s): energy 1 at FIST_MASS. */
export const REF_SPEED = 6.5;
/** A head shot at least this fast (m/s) is a crit. */
export const CRIT_SPEED = 5.4;
/** A body shot at least this fast (m/s) winds them (a stagger). */
export const WIND_SPEED = 6;
/** What gets through a block. */
export const BLOCK_THROUGH = 0.15;
/** A crit's damage multiplier. */
export const CRIT_X = 1.5;

export interface Punch {
  /** Fist speed at contact (m/s). */
  speed: number;
  /** Mass behind it (kg); FIST_MASS if left out. */
  mass?: number;
  /** Where it landed. 'guard': on the gloves (a block). */
  spot: Spot;
  /** The thrower's strength (temperament), 1 = average. */
  strength?: number;
}

export interface Impact {
  /** 0..1, how hard it was (for sounds, flinches, haptics). */
  power: number;
  /** Health points out of 100. */
  damage: number;
  crit: boolean;
  /** Rocks them back (a stagger clip, a stumble). */
  stagger: boolean;
  blocked: boolean;
  /** How far it knocks them back (m), before walls. */
  push: number;
  /** Kinetic energy against a solid punch's (0 .. ~2). */
  energy: number;
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** The damage, crit, stagger and knock-back of one punch. */
export function punchImpact(p: Punch): Impact {
  const m = p.mass ?? FIST_MASS;
  const v = Math.max(0, p.speed);
  const blocked = p.spot === 'guard';
  // Energy against a solid punch's (½ m v², normalised), from the minimum speed up.
  const eff = Math.max(0, v - MIN_SPEED * 0.5);
  const ref = REF_SPEED - MIN_SPEED * 0.5;
  const energy = clamp(((m / FIST_MASS) * eff * eff) / (ref * ref), 0, 2);
  const power = clamp((v - MIN_SPEED) / (REF_SPEED + 1 - MIN_SPEED), 0, 1) * clamp(Math.sqrt(m / FIST_MASS), 0.5, 1.3);
  const zone = p.spot === 'body' ? 'body' : 'head';
  let damage = v < MIN_SPEED ? 0 : zone === 'head' ? 5 + 17 * energy : 3.5 + 11 * energy;
  const crit = !blocked && zone === 'head' && v >= CRIT_SPEED;
  const stagger = !blocked && (crit || (zone === 'body' && v >= WIND_SPEED));
  if (crit) damage *= CRIT_X;
  damage *= p.strength ?? 1;
  if (blocked) damage *= BLOCK_THROUGH;
  // Momentum knocks them back: a little through the gloves, more on a crit.
  const push = v < MIN_SPEED ? 0 : (blocked ? 0.03 + 0.06 * energy : 0.06 + 0.16 * energy) * (crit ? 1.4 : 1);
  return { power: clamp(power, 0, 1), damage: Math.round(damage * 10) / 10, crit, stagger, blocked, push: Math.min(0.45, push), energy };
}

/** A fist speed for a 0..1 power (the old power scale: a friend's machine, a screen punch). */
export function speedOf(power: number) {
  return MIN_SPEED + clamp(power, 0, 1) * (REF_SPEED + 1 - MIN_SPEED);
}

/**
 * Where on someone a fist landed: the head (within `headR` of its middle) or
 * the body; and on their gloves instead if a glove was between (within
 * `gloveR` of where the fist met them). Distances in metres.
 */
export function spotOf(distHead: number, distGlove: number, headR = 0.17, gloveR = 0.12): Spot {
  if (distGlove < gloveR) return 'guard';
  return distHead < headR ? 'head' : 'body';
}
