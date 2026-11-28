/**
 * When the headliner is on: the pool party's running order.
 *
 * The DJ plays while you arrive; a minute or two later (60..120 s) the
 * headliner comes on for his set (the concert's two songs), then the DJ again
 * for a few minutes (GAP: opening with his after-set record, afterAt, then the
 * house record), then him again, and so on.
 *
 * A Plan is just the wall-clock time his first set starts. Every set after it
 * follows at a fixed cycle (his set, rounded up to the DJ's bar, plus the
 * DJ's stretch), and every start sits on the DJ's bar grid (deck A's beat,
 * which runs off the wall clock too), so the music hands over on the beat.
 *
 * Multiplayer: the plan rides in each player's state (`pz`: start, rev). The
 * first of you to come out to the pool makes one (rev: when it was made) and
 * everyone adopts the newest plan they hear (ties: the larger tag), so
 * a room converges on one plan within a state update, late joiners pick it up
 * from anyone's state, and a plan outlives whoever made it. Anyone arriving
 * while the next set is more than FIRST_MAX away (and it isn't on) makes a
 * new plan: that only ever brings his next set closer, never cuts one off,
 * so it's safe however many of you arrive at once. Wall clocks are assumed
 * to agree (NTP), as the rest of the party's music already does.
 *
 * Pure (no three.js, no audio): unit-tested in tests/schedule.test.ts.
 */

export const SCHEDULE = {
  /** His first set starts this long after you arrive (s): picked at random in between. */
  firstMin: 60,
  firstMax: 120,
  /** The DJ's stretch between his sets (s, rounded to whole phrases). */
  gap: 240,
  /** Starts land on a phrase line: every this many of the DJ's bars. */
  align: 4,
};

export interface Plan {
  /** Wall-clock seconds his first set starts. */
  start: number;
  /** When the plan was made (ms since the epoch; the newest wins). */
  rev: number;
  /** Its maker's tag (planTag(): ties on rev go to the larger). */
  by: string;
}

export interface Timing {
  /** One of the DJ's bars (s): the grid starts sit on. */
  bar: number;
  /** His set's music (s, both songs back to back). */
  liveLen: number;
}

export interface Program {
  /** His set is on (the concert's music, through to the DJ's next bar line after it). */
  live: boolean;
  /** Seconds into his set (live), else -1. */
  into: number;
  /** Seconds until his next set starts (0 while it's on; Infinity: no plan). */
  next: number;
  /** Which of his sets this is / was last (0, 1, ...; -1 before the first). */
  set: number;
}

/** His set's slot on the grid (s): his music, rounded up to the DJ's next bar line. */
export function liveSlot(t: Timing): number {
  return Math.ceil(t.liveLen / t.bar - 1e-6) * t.bar;
}

/** From one of his sets to the next (s). */
export function cycleLength(t: Timing, gap = SCHEDULE.gap): number {
  const phrase = t.bar * SCHEDULE.align;
  return liveSlot(t) + Math.max(1, Math.round(gap / phrase)) * phrase;
}

/** What's on at wall time `w`. */
export function programAt(w: number, plan: Plan | null, t: Timing, gap = SCHEDULE.gap): Program {
  if (!plan || !Number.isFinite(plan.start)) return { live: false, into: -1, next: Infinity, set: -1 };
  if (w < plan.start) return { live: false, into: -1, next: plan.start - w, set: -1 };
  const C = cycleLength(t, gap),
    slot = liveSlot(t);
  const set = Math.floor((w - plan.start) / C);
  const into = w - plan.start - set * C;
  if (into < slot) return { live: true, into, next: 0, set };
  return { live: false, into: -1, next: C - into, set };
}

/**
 * Seconds into the DJ's record after her set (`len` s long: played once
 * through from the end of her slot, cut short if her next set comes first) at
 * wall time `w`, or -1 when it isn't on.
 */
export function afterAt(w: number, plan: Plan | null, t: Timing, len: number, gap = SCHEDULE.gap): number {
  if (!plan || !Number.isFinite(plan.start) || !(len > 0) || w < plan.start) return -1;
  const C = cycleLength(t, gap),
    slot = liveSlot(t);
  const set = Math.floor((w - plan.start) / C);
  const into = w - plan.start - set * C - slot;
  return into >= 0 && into < Math.min(len, C - slot) ? into : -1;
}

/** Rounds wall time `w` up to the DJ's next phrase line. */
export function alignUp(w: number, bar: number): number {
  const phrase = bar * SCHEDULE.align;
  return Math.ceil(w / phrase - 1e-9) * phrase;
}

/** A new plan: his first set 60..120 s from `now` (on a phrase line), `r` in 0..1 picking where. */
export function makePlan(now: number, t: Timing, r: number, by: string, revMs = now * 1000): Plan {
  const phrase = t.bar * SCHEDULE.align;
  const span = Math.max(0, SCHEDULE.firstMax - SCHEDULE.firstMin - phrase);
  const start = alignUp(now + SCHEDULE.firstMin + Math.min(1, Math.max(0, r)) * span, t.bar);
  return { start, rev: Math.round(revMs), by };
}

/** You've just arrived: does the room need a plan that brings him on sooner? */
export function needsPlan(now: number, plan: Plan | null, t: Timing, gap = SCHEDULE.gap): boolean {
  const p = programAt(now, plan, t, gap);
  return !p.live && p.next > SCHEDULE.firstMax;
}

/** Which plan wins: the newer (or, made the same millisecond, the larger id). */
export function newer(a: Plan | null, b: Plan | null): Plan | null {
  if (!a) return b;
  if (!b) return a;
  if (a.rev !== b.rev) return a.rev > b.rev ? a : b;
  return Number(a.by) >= Number(b.by) ? a : b;
}

/** A plan on the wire (`pz`): [start (ms), rev (ms), maker's tag]. */
export function packPlan(p: Plan | null): number[] | undefined {
  return p ? [Math.round(p.start * 1000), p.rev, Number(p.by) || 0] : undefined;
}

export function unpackPlan(v: unknown): Plan | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const [s, r, b] = v.map(Number);
  return Number.isFinite(s) && Number.isFinite(r) ? { start: s / 1000, rev: r, by: String(Number.isFinite(b) ? b : 0) } : null;
}

/** A tag for a plan you make (numeric, for the wire; ties on rev go to the larger). */
export const planTag = () => String(Math.floor(Math.random() * 2 ** 31));
