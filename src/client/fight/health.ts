/**
 * Health in a fight (yours, a guest's, a friend's in a boxing match): hits
 * take it down (more for the head than the body, much less through a block,
 * a slap stings more than it hurts), it comes back slowly once nobody is
 * hitting you, and at zero you're knocked out.
 *
 * Pure logic (no three.js) so it can be unit tested.
 */

export type Zone = 'head' | 'body';

export interface Blow {
  zone: Zone;
  /** 0..1: how hard (fist speed). */
  power: number;
  blocked?: boolean;
  /** An open hand: stings, does little. */
  slap?: boolean;
  /** The thrower's strength (temperament), 1 = average. */
  strength?: number;
}

/** Damage one blow does (health points out of 100). */
export function damage(b: Blow): number {
  const p = Math.max(0.1, Math.min(1, b.power));
  let d = b.slap ? 4 + 4 * p : b.zone === 'head' ? 10 + 12 * p : 6 + 7 * p;
  d *= b.strength ?? 1;
  if (b.blocked) d *= b.slap ? 0 : 0.15;
  return d;
}

/** Seconds without a hit before health starts coming back. */
export const REGEN_AFTER = 6;
/** Points per second it comes back. */
export const REGEN_RATE = 4;

export class Health {
  hp: number;
  /** Seconds since the last hit. */
  since = 99;
  /** Knocked out (seconds left), 0 when not. */
  out = 0;

  constructor(readonly max = 100) {
    this.hp = max;
  }

  get fraction() {
    return this.hp / this.max;
  }

  get ko() {
    return this.out > 0;
  }

  /** Takes a blow. Returns the damage done and whether it knocked them out. */
  take(b: Blow, koSeconds = 5): { dmg: number; ko: boolean } {
    if (this.out > 0) return { dmg: 0, ko: false };
    const dmg = damage(b);
    this.hp = Math.max(0, this.hp - dmg);
    this.since = 0;
    if (this.hp <= 0) {
      this.out = koSeconds;
      return { dmg, ko: true };
    }
    return { dmg, ko: false };
  }

  /** Returns true on the frame they come round (health restored). */
  update(dt: number, inCombat = false): boolean {
    this.since += dt;
    if (this.out > 0) {
      this.out -= dt;
      if (this.out <= 0) {
        this.out = 0;
        this.hp = this.max;
        this.since = 99;
        return true;
      }
      return false;
    }
    if (!inCombat && this.since > REGEN_AFTER && this.hp < this.max) this.hp = Math.min(this.max, this.hp + REGEN_RATE * dt);
    return false;
  }

  reset() {
    this.hp = this.max;
    this.out = 0;
    this.since = 99;
  }
}
