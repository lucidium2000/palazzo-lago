/**
 * Anger: how far you've pushed someone. Every shove, slap, punch, splash or
 * thrown thing adds to it (scaled by their temperament), it cools off over
 * time, and past a point they stop complaining and do something about it:
 * square up and fight, call security, run, or just get loud.
 *
 * Pure logic (no three.js) so it can be unit tested.
 */

export type Provocation =
  | "pushed"
  | "slapped"
  | "punched"
  | "doused"
  | "hit"
  | "seat";

/** What someone does once they've had enough. */
export type Response =
  /** Squares up and throws punches. */
  | "brawl"
  /** Squares up, shouts, never actually swings; backs off once you hit back. */
  | "talk"
  /** Gets out of there. */
  | "flee"
  /** Doesn't fight back: just gets loud about it. */
  | "loud"
  /** Staff (and a few guests): calls security. */
  | "security"
  /** Your crew: never fights you. */
  | "never";

export interface Temperament {
  /** How quickly it builds (1 = average, 1.6 = hot-headed). */
  fuse: number;
  /** What they do at the threshold. */
  response: Response;
  /** Their punches' strength (damage multiplier). */
  power: number;
  /** How much they can take (health points). */
  hp: number;
  /** How often their guard stops a head shot, 0..1. */
  guard: number;
  /** Seconds between their attacks (shorter = busier). */
  tempo: number;
}

const BASE: Temperament = {
  fuse: 1,
  response: "brawl",
  power: 1,
  hp: 100,
  guard: 0.45,
  tempo: 1.4,
};

/** Per character (cast.ts ids), staff by job. */
export const TEMPERAMENTS: Record<string, Partial<Temperament>> = {
  // Hot-headed: two shoves and you've got a problem.
  sal: { fuse: 1.7, power: 1.15, hp: 95, guard: 0.5, tempo: 1.2 },
  vinnie: { fuse: 1.6, power: 1.05, hp: 110, guard: 0.35, tempo: 1.1 },
  // Will fight, takes a bit more to get there.
  marcus: { fuse: 1.1, power: 1, hp: 105, guard: 0.5, tempo: 1.3 },
  dale: { fuse: 0.7, power: 1.25, hp: 135, guard: 0.4, tempo: 1.8 },
  priya: { fuse: 1, power: 0.85, hp: 90, guard: 0.55, tempo: 1.2 },
  rosa: { fuse: 0.8, power: 0.95, hp: 95, guard: 0.65, tempo: 1.0 },
  // All talk.
  reggie: { fuse: 1.3, response: "talk", hp: 70, guard: 0.3 },
  // Not fighters.
  tommy: { fuse: 1.2, response: "flee", hp: 70 },
  margo: { fuse: 1.3, response: "security" },
  eleanor: { fuse: 1, response: "loud" },
  kayla: { fuse: 0.9, response: "loud" },
  destiny: { fuse: 1.1, response: "loud" },
  // Staff call security (they're working).
  staff: { fuse: 1, response: "security" },
  // Security: they came to fight.
  guard: { fuse: 2, power: 1.3, hp: 160, guard: 0.7, tempo: 1.0 },
  crew: { fuse: 0, response: "never" },
};

export function temperament(id: string): Temperament {
  return { ...BASE, ...(TEMPERAMENTS[id] ?? {}) };
}

/** How much one provocation adds (before temperament), `power` 0..1. */
export function provocation(kind: Provocation, power = 0.5): number {
  switch (kind) {
    case "pushed":
      return 0.1 + 0.08 * power;
    case "slapped":
      return 0.3 + 0.2 * power;
    case "punched":
      return 0.45 + 0.25 * power;
    case "doused":
      return 0.38;
    case "hit":
      return 0.22 + 0.1 * power;
    case "seat":
      return 0.3;
  }
}

/** Anger past this: they act. */
export const FIGHT_AT = 1;
/** Anger past this: they let you know they're annoyed. */
export const ANNOYED_AT = 0.3;
/** Seconds after the last provocation before they start to cool off. */
const HOLD = 5;
/** How fast it cools (per second) once it does. */
const COOL = 0.035;

export class Anger {
  level = 0;
  private since = 99;

  constructor(readonly t: Temperament) {}

  /** Adds a provocation. Returns true when this one pushed them over the edge. */
  add(kind: Provocation, power = 0.5): boolean {
    if (this.t.response === "never") return false;
    const before = this.level;
    this.level = Math.min(
      2,
      this.level + provocation(kind, power) * this.t.fuse,
    );
    this.since = 0;
    return before < FIGHT_AT && this.level >= FIGHT_AT;
  }

  get annoyed() {
    return this.level >= ANNOYED_AT;
  }

  get boiling() {
    return this.level >= FIGHT_AT;
  }

  update(dt: number) {
    this.since += dt;
    if (this.since > HOLD) this.level = Math.max(0, this.level - COOL * dt);
  }

  /** A fight settled it (they got it out of their system). */
  vent(to = 0.2) {
    this.level = Math.min(this.level, to);
  }
}
