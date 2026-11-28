/**
 * The pool party's running order: the night, the same for everyone in a room.
 *
 * The party starts when the first of you comes out to the pool. The night:
 *
 *   0:00  the DJ drops "No Tomorrow" (deck A) from its top
 *   1:30  the DJ on the mic, over the booth's stacks: "...in one minute... Nixie
 *         Vale!" (the music ducks under it; the crowd cheers, and its chatter
 *         turns to "one minute!")
 *   1:33  the dancers start drifting over to her stage, a few at a time, and
 *         more guests wander in from the deck's edges; all there by the fade
 *   2:30  the DJ pulls deck A's fader down over six seconds (FADE)
 *   2:36  the decks are silent: the crowd's noise, clapping, the band walking
 *         on, then her (the walk-on roar)
 *   ~2:44 her set (the concert's songs, from her stage's PA), on the DJ's bar
 *         line: `lead` after the party started (nightTimes)
 *   end   the DJ kicks back in with "One More Drop" (deck C) from the booth's
 *         stacks, and the crowd drifts back to his floor
 *   then  the night goes round again: "No Tomorrow" from its top as One More
 *         Drop ends, the call at 1:30, her set...
 *
 * A Plan is just the wall-clock time her first set starts (the party started
 * `lead` before it); every set after it follows a cycle later (`lead` + her
 * slot + One More Drop). Everything here is a pure function of the plan and
 * the wall clock, so everyone hears and sees the same moment.
 *
 * Multiplayer: the plan rides in each player's state (`pz`: start, rev). The
 * first of you to come out to the pool makes one (rev: when it was made) and
 * everyone adopts the newest plan they hear (ties: the larger tag), so a room
 * converges on one plan within a state update, late joiners pick it up from
 * anyone's state (and land wherever the night is: the right bar of the
 * record, or her set in progress), and a plan outlives whoever made it. Wall
 * clocks are assumed to agree (NTP), as the rest of the party's music already does.
 *
 * Pure (no three.js, no audio): unit-tested in tests/schedule.test.ts.
 */

/** The night's moments (s after the party starts: "No Tomorrow" at its top). */
export const NIGHT = {
  /** The DJ calls her: "in one minute". */
  announce: 90,
  /** The crowd starts drifting over this long after the call (a cheer first). */
  gatherAfter: 3,
  /** The DJ starts fading the record out (a minute after the call), and takes this long (s). */
  fadeAt: 150,
  fadeLen: 6,
  /** At least this long between the decks falling silent and her set: the crowd, the band walking on, her walk-on. */
  walkOn: 7,
  /** A record shorter than fadeAt + fadeLen: the fade ends this long before its end. */
  tail: 0.5,
};

/** The night's moments for a house record `houseLen` s long (bars of `bar` s). */
export interface NightTimes {
  announce: number;
  gatherAt: number;
  fadeAt: number;
  fadeLen: number;
  /** From the party starting to her set (s; whole bars of the house record). */
  lead: number;
}

/**
 * When everything happens (s after the party starts). A house record too short
 * to reach 2:30 plus the fade (dj_set.mp3 standing in, a shorter "No Tomorrow"
 * dropped in) has the fade end just before it does, and the call a minute
 * before that: the DJ never loops back to its top before her set.
 */
export function nightTimes(houseLen: number, bar: number): NightTimes {
  const N = NIGHT;
  let fadeAt = N.fadeAt;
  if (houseLen > 0 && houseLen < fadeAt + N.fadeLen + N.tail) fadeAt = Math.max(N.fadeLen, houseLen - N.fadeLen - N.tail);
  const announce = Math.max(0, fadeAt - (N.fadeAt - N.announce));
  const b = bar > 0 ? bar : 2;
  const lead = Math.ceil((fadeAt + N.fadeLen + N.walkOn) / b - 1e-9) * b;
  return { announce, gatherAt: announce + N.gatherAfter, fadeAt, fadeLen: N.fadeLen, lead };
}

export interface Plan {
  /** Wall-clock seconds her first set starts. */
  start: number;
  /** When the plan was made (ms since the epoch; the newest wins). */
  rev: number;
  /** Its maker's tag (planTag(): ties on rev go to the larger). */
  by: string;
}

export interface Timing {
  /** One of the DJ's bars (s). */
  bar: number;
  /** Her set's music (s, her songs back to back). */
  liveLen: number;
  /** From the party starting ("No Tomorrow" at its top) to her set (s): nightTimes().lead. */
  lead: number;
  /** The DJ's record after her set ("One More Drop", s; 0: none). */
  after: number;
}

export interface Program {
  /** Her set is on (the concert's music, through to the DJ's next bar line after it). */
  live: boolean;
  /** Seconds into her set (live), else -1. */
  into: number;
  /** Seconds until her next set starts (0 while it's on; Infinity: no plan). */
  next: number;
  /** Which of her sets this is / was last (0, 1, ...; -1 before the first). */
  set: number;
}

/** Her set's slot (s): her music, rounded up to the DJ's next bar line. */
export function liveSlot(t: Timing): number {
  return Math.ceil(t.liveLen / t.bar - 1e-6) * t.bar;
}

/** The DJ's stretch between her sets when there's no after-set record (s). */
export const NO_AFTER_GAP = 60;

/** From one of her sets to the next (s): her slot, One More Drop, then the night again from its top. */
export function cycleLength(t: Timing): number {
  return liveSlot(t) + (t.after > 0 ? t.after : NO_AFTER_GAP) + t.lead;
}

/** What's on at wall time `w`. */
export function programAt(w: number, plan: Plan | null, t: Timing): Program {
  if (!plan || !Number.isFinite(plan.start)) return { live: false, into: -1, next: Infinity, set: -1 };
  if (w < plan.start) return { live: false, into: -1, next: plan.start - w, set: -1 };
  const C = cycleLength(t),
    slot = liveSlot(t);
  const set = Math.floor((w - plan.start) / C);
  const into = w - plan.start - set * C;
  if (into < slot) return { live: true, into, next: 0, set };
  return { live: false, into: -1, next: C - into, set };
}

/**
 * Seconds into the DJ's record after her set (`len` s long: played once
 * through from the end of her slot, cut short if the night comes round first)
 * at wall time `w`, or -1 when it isn't on.
 */
export function afterAt(w: number, plan: Plan | null, t: Timing, len: number): number {
  if (!plan || !Number.isFinite(plan.start) || !(len > 0) || w < plan.start) return -1;
  const C = cycleLength(t),
    slot = liveSlot(t);
  const set = Math.floor((w - plan.start) / C);
  const into = w - plan.start - set * C - slot;
  return into >= 0 && into < Math.min(len, C - slot - t.lead) ? into : -1;
}

/** Where the night is at a moment (nightAt). */
export interface NightState {
  /** 'none': no plan yet. */
  phase: 'none' | 'dj' | 'called' | 'fade' | 'walkon' | 'live' | 'after';
  /** Seconds since this round of the night started ("No Tomorrow" from its top; negative: not yet), and since the call. */
  party: number;
  sinceCall: number;
  /** Seconds until her next set (Infinity: no plan). */
  toSet: number;
  /** Seconds since her crowd started gathering for this set (through her set), else -1. */
  gather: number;
  /** Seconds since her last set ended (Infinity: before her first, or the night's come round again). */
  since: number;
  /** The scheduled fade on the decks (1: full, 0: faded right down: through her walk-on and her set). */
  gain: number;
  /** Wall time the house record is at its top: deck A plays (w - anchor) round its loop. */
  anchor: number;
  /** Which round of the night (0: the first). */
  round: number;
}

/** The decks' scheduled level `toSet` s before her set (the DJ's fade: a fader's curve, not a straight line). */
export function fadeGain(toSet: number, n: NightTimes): number {
  const end = n.lead - n.fadeAt - n.fadeLen;
  const g = Math.min(1, Math.max(0, (toSet - end) / n.fadeLen));
  return g * g;
}

/** Where the night is at wall time `w` (the house record's times: `n`). */
export function nightAt(w: number, plan: Plan | null, t: Timing, n: NightTimes): NightState {
  if (!plan || !Number.isFinite(plan.start)) return { phase: 'none', party: -1, sinceCall: -1, toSet: Infinity, gather: -1, since: Infinity, gain: 1, anchor: 0, round: 0 };
  const C = cycleLength(t),
    slot = liveSlot(t);
  const p0 = plan.start - t.lead;
  const round = Math.max(0, Math.floor((w - p0) / C));
  const P = p0 + round * C;
  const u = w - P;
  const toSet = Math.max(0, t.lead - u);
  const live = u >= t.lead && u < t.lead + slot;
  const done = u >= t.lead + slot;
  const gather = u >= n.gatherAt && !done ? u - n.gatherAt : -1;
  // Her last set ended (this round's, or the last round's until the night comes round again).
  const since = done ? u - t.lead - slot : Infinity;
  let phase: NightState['phase'];
  if (done) phase = 'after';
  else if (live) phase = 'live';
  else if (u >= n.fadeAt + n.fadeLen) phase = 'walkon';
  else if (u >= n.fadeAt) phase = 'fade';
  else if (u >= n.announce) phase = 'called';
  else phase = 'dj';
  // The house record restarts each round: from the last second of her set on (the decks are silent
  // under it), it's on the next round's grid, at its top as One More Drop ends.
  const anchor = u >= t.lead + slot - 1 ? P + C : P;
  return { phase, party: u, sinceCall: u >= n.announce && !done ? u - n.announce : -1, toSet: live ? 0 : done ? C - u + t.lead : toSet, gather, since, gain: live ? 0 : done ? 1 : fadeGain(toSet, n), anchor, round };
}

/** A new plan: the party starts now, her set `lead` from now. */
export function makePlan(now: number, t: Timing, by: string, revMs = now * 1000): Plan {
  return { start: now + t.lead, rev: Math.round(revMs), by };
}

/**
 * You've just come out to the pool: does the room need a plan (the party
 * starting now)? Only when there's none: once there is, the night goes round
 * on its own, and you join it wherever it is.
 */
export function needsPlan(plan: Plan | null): boolean {
  return !plan || !Number.isFinite(plan.start);
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
