/**
 * Crouching on a button (VR: click the right stick in; desktop: hold C), kept
 * free of scene state so it can be unit-tested. On land it lowers your view
 * and slows your walk; in deep water the same button dives (see swimphys.ts).
 *
 * VR comfort: your real head still moves your view one to one; the button only
 * adds a smooth offset on top. If you're already crouching (or sitting) in real
 * life, it lowers you less, never below a sensible eye height: your real height
 * is followed slowly, so a quick nod isn't cancelled out but a lasting real
 * crouch takes over from the button one.
 */

/** How far a full crouch lowers your eyes (m). */
export const CROUCH_DROP = 0.5;
/** Time to crouch down or stand back up (s). */
export const CROUCH_TIME = 0.2;
/** The button never takes your eyes lower than this above the floor (m). */
export const CROUCH_EYE_MIN = 1.1;
/** Walking speed while fully crouched, as a fraction of normal. */
export const CROUCH_SPEED = 0.5;
/** How quickly the crouch follows a lasting change in your real head height (s). */
const REAL_FOLLOW = 0.6;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** Ease in and out (0..1). */
export const smooth = (t: number) => t * t * (3 - 2 * t);

/** The drop for a held crouch, given your (real) eye height above the floor. */
export const crouchDropFor = (eye: number) => clamp(eye - CROUCH_EYE_MIN, 0, CROUCH_DROP);

export class Crouch {
  /** Progress 0 (standing) .. 1 (crouched), linear in time. */
  k = 0;
  /** How far your view is lowered right now (m). */
  drop = 0;
  private realEye = NaN;

  /**
   * Advance by dt. `held`: the button is down and crouching is allowed here
   * (on the ground, not on a stool, not swimming). `eye`: your eye height above
   * the floor without the crouch (VR: the headset's; desktop: the standing eye).
   */
  update(dt: number, held: boolean, eye: number): number {
    if (!(dt > 0)) return this.drop;
    if (!Number.isFinite(this.realEye)) this.realEye = eye;
    else this.realEye += (eye - this.realEye) * Math.min(1, dt / REAL_FOLLOW);
    this.k = clamp(this.k + (held ? dt : -dt) / CROUCH_TIME, 0, 1);
    this.drop = this.k > 0 ? crouchDropFor(this.realEye) * smooth(this.k) : 0;
    return this.drop;
  }

  /** Walking speed factor (1 standing, CROUCH_SPEED fully crouched). */
  get speedFactor() {
    return 1 - (1 - CROUCH_SPEED) * smooth(this.k);
  }

  reset() {
    this.k = 0;
    this.drop = 0;
  }
}
