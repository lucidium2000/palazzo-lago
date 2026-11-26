import { Health, type Blow } from './health';
import type { Temperament } from './anger';

/**
 * One guest's side of a fight: the state machine that squares up, closes the
 * distance, holds a guard, throws telegraphed punches (a clear wind-up you can
 * see coming, then the strike), staggers when you land a good one, goes down
 * when out of health, gets up groggy and leaves. It also decides when the
 * fight is over: you walked away, or you put your hands down and backed off.
 *
 * Pure logic (no three.js): the fight manager feeds it distances and turns
 * its phases into movement, poses, hit checks and network messages.
 */

export type Phase = 'square' | 'close' | 'guard' | 'windup' | 'strike' | 'recover' | 'stagger' | 'ko' | 'getup' | 'leave' | 'flee';

/** Phase ids on the wire (fight sync). */
export const PHASES: readonly Phase[] = ['square', 'close', 'guard', 'windup', 'strike', 'recover', 'stagger', 'ko', 'getup', 'leave', 'flee'];

export interface BrawlInput {
  dt: number;
  /** Horizontal distance to who they're fighting (m). */
  dist: number;
  /** The other one has their hands down and isn't throwing anything. */
  passive: boolean;
  /** 0..1 random numbers (injected for tests). */
  rnd: () => number;
}

export type BrawlEvent =
  /** A punch is coming (the tell starts). */
  | 'windup'
  /** The punch arrives now: check whether it lands. */
  | 'impact'
  /** They've gone down. */
  | 'ko'
  /** Back on their feet. */
  | 'getup'
  /** They've had enough of standing there: the fight is over (no knockout). */
  | 'giveup'
  /** A talker or a timid one runs off. */
  | 'flee';

/** Timings (seconds). */
export const T = {
  square: 1.1,
  windup: 0.7,
  strike: 0.2,
  recover: 0.55,
  stagger: 0.6,
  fall: 0.7,
  lie: 4.5,
  getup: 1.5,
  /** Out of reach for this long: they give up. */
  away: 2.5,
  /** Hands down and backed off for this long: it's over. */
  calm: 3,
};

/** Reach: they step in until this close (m). */
export const STRIKE_RANGE = 0.85;
/** Further than this and they come after you again. */
export const CHASE_AT = 1.15;
/** Walk this far away and they let you go. */
export const WALKED_AWAY = 7;

export interface PoseOut {
  guard: number;
  block: number;
  windup: number;
  punch: number;
  down: number;
  wobble: number;
}

export class Brawl {
  phase: Phase = 'square';
  /** Seconds in the current phase. */
  t = 0;
  readonly health: Health;
  /** Which fist the next punch comes from (0 left, 1 right). */
  side: 0 | 1 = 1;
  /** Aiming for the head (or the body) with this punch. */
  head = true;
  /** How far they want to move this frame toward their opponent (m/s; negative backs off). */
  advance = 0;
  /** Hits they've taken in this fight. */
  taken = 0;
  private next = 1;
  private away = 0;
  private calm = 0;
  private standoff = 0;
  /** Blocking a punch right now (seconds left). */
  private blockT = 0;

  constructor(
    readonly temper: Temperament,
    /** Never throws (all talk, or security keeping it civil until you swing at them). */
    public talker = false,
  ) {
    this.health = new Health(temper.hp);
  }

  get over() {
    return this.phase === 'leave' || this.phase === 'flee';
  }

  get down() {
    return this.phase === 'ko';
  }

  /** Guard up right now (can block a head shot)? */
  get guarding() {
    return this.phase === 'guard' || this.phase === 'close' || this.phase === 'square';
  }

  private go(p: Phase) {
    this.phase = p;
    this.t = 0;
  }

  update(i: BrawlInput): BrawlEvent | null {
    this.t += i.dt;
    this.blockT = Math.max(0, this.blockT - i.dt);
    this.health.update(i.dt, true);
    this.advance = 0;
    const p = this.phase;
    if (p === 'ko') {
      if (this.t >= T.fall + T.lie) {
        this.go('getup');
        return 'getup';
      }
      return null;
    }
    if (p === 'getup') {
      if (this.t >= T.getup) this.go('leave');
      return null;
    }
    if (p === 'leave' || p === 'flee') {
      this.advance = p === 'flee' ? -2.6 : -0.8;
      return null;
    }

    // Is it over? Walked away, or hands down and backed off.
    this.away = i.dist > WALKED_AWAY ? this.away + i.dt : 0;
    this.calm = i.passive && i.dist > 1.6 ? this.calm + i.dt : 0;
    if (this.away > T.away || this.calm > T.calm) {
      this.go('leave');
      return 'giveup';
    }
    // All talk: a long standoff and they find a reason to be elsewhere.
    if (this.talker) {
      this.standoff += i.dt;
      if (this.standoff > 10 && i.passive) {
        this.go('leave');
        return 'giveup';
      }
    }

    switch (p) {
      case 'square':
        if (this.t >= T.square) this.go(i.dist > STRIKE_RANGE ? 'close' : 'guard');
        return null;
      case 'close':
        if (i.passive && i.dist < 2.2) {
          // They don't chase someone who's backing down (but stand their ground).
          this.go('guard');
          return null;
        }
        this.advance = i.dist > 2.5 ? 1.7 : 0.9;
        if (i.dist <= STRIKE_RANGE) this.go('guard');
        return null;
      case 'guard':
        if (i.dist > CHASE_AT && !i.passive) {
          this.go('close');
          return null;
        }
        // Too close: half a step back.
        if (i.dist < 0.55) this.advance = -0.5;
        if (this.talker) return null;
        if (this.t >= this.next && i.dist < CHASE_AT + 0.2) {
          this.side = i.rnd() < 0.55 ? 1 : 0;
          this.head = i.rnd() < 0.65;
          this.go('windup');
          return 'windup';
        }
        return null;
      case 'windup':
        // Leaning in as the punch comes.
        if (i.dist > STRIKE_RANGE) this.advance = 0.6;
        if (this.t >= T.windup) {
          this.go('strike');
          this.advance = 1.2;
        }
        return null;
      case 'strike':
        this.advance = 0.8;
        if (this.t >= T.strike) {
          this.go('recover');
          return 'impact';
        }
        return null;
      case 'recover':
        if (this.t >= T.recover) {
          this.go('guard');
          this.next = this.temper.tempo * (0.6 + i.rnd() * 0.8);
        }
        return null;
      case 'stagger':
        this.advance = this.t < 0.25 ? -0.9 : 0;
        if (this.t >= T.stagger) {
          this.go('guard');
          this.next = 0.4 + i.rnd() * this.temper.tempo;
        }
        return null;
    }
    return null;
  }

  /**
   * You landed one (as far as they're concerned): `rnd` decides whether their
   * guard was up in time. Returns what happened.
   */
  hit(b: Blow, rnd: () => number): { blocked: boolean; dmg: number; ko: boolean; flee: boolean } {
    if (this.phase === 'ko' || this.phase === 'getup') return { blocked: false, dmg: 0, ko: false, flee: false };
    // Guard up and it's to the head: they may get their arms there (unless whoever threw it already saw).
    const blocked = b.blocked ?? (b.zone === 'head' && !b.slap && this.guarding && rnd() < this.temper.guard);
    const res = this.health.take({ ...b, blocked }, 99);
    this.taken++;
    if (blocked) this.blockT = 0.35;
    if (res.ko) {
      this.go('ko');
      return { blocked, dmg: res.dmg, ko: true, flee: false };
    }
    if (this.talker && this.taken >= 2) {
      this.go('flee');
      return { blocked, dmg: res.dmg, ko: false, flee: true };
    }
    // A clean, hard one stops whatever they were doing.
    if (!blocked && (b.power > 0.45 || b.zone === 'head') && !b.slap && this.phase !== 'flee' && this.phase !== 'leave') this.go('stagger');
    return { blocked, dmg: res.dmg, ko: false, flee: false };
  }

  /** Can this one block a head shot right now (for a hit decided on another machine)? */
  rollBlock(b: Blow, rnd: () => number): boolean {
    return b.zone === 'head' && !b.slap && this.guarding && rnd() < this.temper.guard;
  }

  /** Puppet (a fight driven on a friend's machine): show this phase. */
  show(p: Phase) {
    if (p !== this.phase) this.go(p);
  }

  /** Arms, wind-up, punch, on the floor: what the body should look like now. */
  pose(out: PoseOut): PoseOut {
    out.guard = out.block = out.windup = out.punch = out.down = out.wobble = 0;
    const t = this.t;
    const ease = (x: number) => Math.min(1, Math.max(0, x));
    switch (this.phase) {
      case 'square':
        out.guard = ease(t / 0.5);
        break;
      case 'close':
      case 'guard':
      case 'recover':
        out.guard = this.phase === 'recover' ? 0.6 + 0.4 * ease(t / T.recover) : 1;
        break;
      case 'windup':
        out.guard = 1;
        out.windup = ease(t / (T.windup * 0.6));
        break;
      case 'strike':
        out.guard = 1;
        out.windup = 1 - ease(t / (T.strike * 0.5));
        out.punch = ease(t / (T.strike * 0.7));
        break;
      case 'stagger':
        out.guard = 0.4;
        break;
      case 'ko': {
        // Crumple: slow at first, then all the way down, with a little bounce.
        const f = ease(t / T.fall);
        out.down = f < 1 ? f * f : 1 - 0.04 * Math.max(0, Math.sin(Math.min(1, (t - T.fall) / 0.3) * Math.PI));
        break;
      }
      case 'getup':
        out.down = 1 - ease(t / T.getup);
        out.wobble = 1;
        break;
      case 'leave':
        out.wobble = this.taken > 0 ? Math.max(0, 1 - t / 6) : 0;
        break;
    }
    if (this.blockT > 0) out.block = Math.min(1, this.blockT / 0.15);
    return out;
  }
}
