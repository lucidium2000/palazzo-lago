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

/** The punches they throw: a jab and a hook with the lead (left) hand, a cross with the right. */
export type Move = 'jab' | 'cross' | 'hook';
/** Move ids on the wire. */
export const MOVES: readonly Move[] = ['jab', 'cross', 'hook'];

/**
 * What the whole body is doing (an animation clip, people.ts): a punch, the
 * stagger after a big hit, going down, getting up. 'none' = the guard and the
 * footwork (or, out of the fight, their ordinary walking).
 */
export type Act = 'none' | Move | 'stagger' | 'ko' | 'getup';

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
// The punch, stagger, fall and get-up times match the clips (scripts/build-fight-anims.mjs).
export const T = {
  square: 1.1,
  windup: 0.7,
  strike: 0.2,
  recover: 0.55,
  stagger: 0.9,
  /** Knees buckle, down onto their back. */
  fall: 2.0,
  lie: 3.0,
  /** Side, hands and knees, a foot planted, up, shake it off. */
  getup: 3.9,
  /** Out of reach for this long: they give up. */
  away: 2.5,
  /** Hands down and backed off for this long: it's over. */
  calm: 3,
};

/** Reach: they step in until this close (m). */
export const STRIKE_RANGE = 0.95;
/** Further than this and they come after you again. */
export const CHASE_AT = 1.25;
/** Closer than this and they step back out. */
const CROWDED = 0.75;
/** A clean punch at least this hard staggers them. */
export const STAGGER_AT = 0.75;
/** The stagger's stumble back: this far (m), between these times (s) (the clip's steps land with it). */
export const STAGGER_BACK = { d: 0.22, from: 0.05, to: 0.4 };
/** Walk this far away and they let you go. */
export const WALKED_AWAY = 7;

export interface PoseOut {
  /** Fists up, in their stance (0..1). */
  guard: number;
  /** Gloves up over the face (0..1). */
  block: number;
  act: Act;
  /** Seconds into the act's clip (a punch: wind-up, strike and recovery on one timeline). */
  actT: number;
  /** This punch goes to the body. */
  body: boolean;
  /** 0 on their feet … 1 on the floor. */
  down: number;
  /** Groggy (walking off after being knocked about), 0..1. */
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
  /** The punch being thrown (or the last one). */
  move: Move = 'jab';
  /** How far they want to move this frame toward their opponent (m/s; negative backs off). */
  advance = 0;
  /** Sideways (m/s, + to their left): circling you. */
  strafe = 0;
  /** Hits they've taken in this fight. */
  taken = 0;
  private next = 1;
  private away = 0;
  private calm = 0;
  private standoff = 0;
  /** Blocking a punch right now (seconds left). */
  private blockT = 0;
  /** Seconds since they last saw a punch coming (and whether they got their gloves up for it). */
  private sawT = 99;
  private saw = false;
  /** Circling: which way, and for how long more; a bob in and out. */
  private circle = 0;
  private circleT = 0;
  private bob = 0;

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
    return this.phase === 'guard' || this.phase === 'close' || this.phase === 'square' || this.phase === 'recover';
  }

  private go(p: Phase) {
    this.phase = p;
    this.t = 0;
  }

  update(i: BrawlInput): BrawlEvent | null {
    this.t += i.dt;
    this.blockT = Math.max(0, this.blockT - i.dt);
    this.sawT += i.dt;
    this.health.update(i.dt, true);
    this.advance = 0;
    this.strafe = 0;
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
        this.advance = i.dist > 2.5 ? 1.7 : 0.75;
        if (i.dist <= STRIKE_RANGE) this.go('guard');
        return null;
      case 'guard':
        if (i.dist > CHASE_AT && !i.passive) {
          this.go('close');
          return null;
        }
        // Too close: half a step back.
        if (i.dist < CROWDED) this.advance = -0.5;
        else if (!this.talker) {
          // Footwork: circling (now one way, now the other, now still) and bobbing in and out.
          this.circleT -= i.dt;
          if (this.circleT <= 0) {
            const r = i.rnd();
            this.circle = r < 0.3 ? 0 : r < 0.65 ? 1 : -1;
            this.circleT = 0.8 + i.rnd() * 1.6;
          }
          this.bob += i.dt;
          this.strafe = 0.35 * this.circle;
          this.advance = 0.22 * Math.sin(this.bob * 3.1) + (i.dist > STRIKE_RANGE + 0.1 ? 0.3 : 0);
        }
        if (this.talker) return null;
        if (this.t >= this.next && i.dist < CHASE_AT + 0.2) {
          this.side = i.rnd() < 0.55 ? 1 : 0;
          this.head = i.rnd() < 0.65;
          // The lead hand: a jab, or (at the head) now and then a hook.
          this.move = this.side === 1 ? 'cross' : this.head && i.rnd() < 0.4 ? 'hook' : 'jab';
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
        this.advance = 0.6;
        if (this.t >= T.strike) {
          this.go('recover');
          return 'impact';
        }
        return null;
      case 'recover':
        // Punch, then a step back out.
        if (this.t > 0.15 && this.t < 0.45 && i.dist < CHASE_AT) this.advance = -0.55;
        if (this.t >= T.recover) {
          this.go('guard');
          this.next = this.temper.tempo * (0.6 + i.rnd() * 0.8);
        }
        return null;
      case 'stagger': {
        // Stumbling back (as fast as the clip's steps go).
        const S = STAGGER_BACK;
        const x = (this.t - S.from) / (S.to - S.from);
        this.advance = x > 0 && x < 1 ? (-S.d * 6 * x * (1 - x)) / (S.to - S.from) : 0;
        if (this.t >= T.stagger) {
          this.go('guard');
          this.next = 0.4 + i.rnd() * this.temper.tempo;
        }
        return null;
      }
    }
    return null;
  }

  /**
   * You're throwing one at them (seen coming): they may get their gloves up.
   * The block (or not) holds for the punch that follows.
   */
  threat(rnd: () => number) {
    if (this.sawT < 0.6) return this.saw;
    this.sawT = 0;
    this.saw = this.guarding && rnd() < this.temper.guard;
    if (this.saw) this.blockT = 0.6;
    return this.saw;
  }

  /** Gloves up now (a block decided elsewhere: a friend's machine). */
  blockNow(s = 0.45) {
    this.blockT = Math.max(this.blockT, s);
  }

  /** Blocking right now (for the fight sync). */
  get blocking() {
    return this.blockT > 0;
  }

  /**
   * You landed one (as far as they're concerned): `rnd` decides whether their
   * guard was up in time. Returns what happened.
   */
  hit(b: Blow, rnd: () => number): { blocked: boolean; dmg: number; ko: boolean; flee: boolean } {
    if (this.phase === 'ko' || this.phase === 'getup') return { blocked: false, dmg: 0, ko: false, flee: false };
    // Guard up and it's to the head: they may get their arms there (unless whoever threw it already saw).
    const blocked = b.blocked ?? this.rollBlock(b, rnd);
    const res = this.health.take({ ...b, blocked }, 99);
    this.taken++;
    if (blocked) this.blockT = Math.max(this.blockT, 0.35);
    if (res.ko) {
      this.go('ko');
      return { blocked, dmg: res.dmg, ko: true, flee: false };
    }
    if (this.talker && this.taken >= 2) {
      this.go('flee');
      return { blocked, dmg: res.dmg, ko: false, flee: true };
    }
    // A clean, hard one rocks them back (a stagger); a lighter one is a flinch (people.ts) that
    // still knocks them off a punch they were only winding up.
    const busy = this.phase === 'flee' || this.phase === 'leave';
    if (!blocked && !b.slap && !busy) {
      if (b.power >= STAGGER_AT) this.go('stagger');
      else if (this.phase === 'windup') {
        this.go('guard');
        this.next = 0.5;
      }
    }
    return { blocked, dmg: res.dmg, ko: false, flee: false };
  }

  /** Can this one block a head shot right now (for a hit decided on another machine)? */
  rollBlock(b: Blow, rnd: () => number): boolean {
    if (b.zone !== 'head' || b.slap || !this.guarding) return false;
    // They saw it coming: gloves already up (or not).
    if (this.sawT < 0.6) return this.saw;
    return rnd() < this.temper.guard;
  }

  /** Puppet (a fight driven on a friend's machine): show this phase. */
  show(p: Phase) {
    if (p !== this.phase) this.go(p);
  }

  /** Fists up, the punch (or stagger, fall, get-up) and how far into it: what the body should look like now. */
  pose(out: PoseOut): PoseOut {
    out.guard = out.block = out.down = out.wobble = out.actT = 0;
    out.act = 'none';
    out.body = !this.head;
    const t = this.t;
    const clamp = (x: number) => Math.min(1, Math.max(0, x));
    switch (this.phase) {
      case 'square':
        out.guard = clamp(t / 0.5);
        break;
      case 'close':
      case 'guard':
        out.guard = 1;
        break;
      case 'windup':
      case 'strike':
      case 'recover':
        out.guard = 1;
        out.act = this.move;
        out.actT = this.phase === 'windup' ? t : this.phase === 'strike' ? T.windup + t : T.windup + T.strike + t;
        break;
      case 'stagger':
        out.guard = 1;
        out.act = 'stagger';
        out.actT = t;
        break;
      case 'ko':
        out.act = 'ko';
        out.actT = t;
        out.down = clamp(t / T.fall);
        break;
      case 'getup':
        out.act = 'getup';
        out.actT = t;
        out.down = 1 - clamp(t / T.getup);
        break;
      case 'leave':
        out.wobble = this.taken > 0 ? Math.max(0, 1 - t / 6) : 0;
        break;
    }
    if (this.blockT > 0 && out.act === 'none') out.block = clamp(this.blockT / 0.12);
    return out;
  }
}
