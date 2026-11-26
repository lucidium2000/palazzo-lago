/**
 * First-time hints, the logic (no scene, no DOM: unit-tested in
 * tests/hints.test.ts). A hint is asked for every so often while its
 * situation holds ("you're swimming", "you're holding food"); the first time,
 * it waits its turn and shows for a few seconds, and then it is remembered on
 * this device and never shown again.
 *
 *  - One at a time: the rest queue, in the order they were first asked for.
 *  - A cooldown between two hints, so they never come one on top of another.
 *  - A queued hint whose situation has passed (not asked for again lately) is
 *    dropped without being shown, and without being remembered: it gets
 *    another go next time the situation comes up.
 *  - "Show hints" off: nothing is queued or shown (and what's showing goes).
 *  - Reset: everything is forgotten, every hint can show again.
 */

/** Where the seen list and the on/off switch live (localStorage, or a stand-in in tests). */
export interface HintStore {
  load(): { seen: string[]; off: boolean } | null;
  save(s: { seen: string[]; off: boolean }): void;
}

export const HINT_KEY = 'palazzo-lago.hints';

/** The real one: this device's localStorage (private mode, blocked storage: nothing remembered, no errors). */
export const localHintStore: HintStore = {
  load() {
    try {
      const raw = localStorage.getItem(HINT_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw) as { seen?: unknown; off?: unknown };
      return { seen: Array.isArray(v.seen) ? v.seen.filter((s): s is string => typeof s === 'string') : [], off: v.off === true };
    } catch {
      return null;
    }
  },
  save(s) {
    try {
      localStorage.setItem(HINT_KEY, JSON.stringify(s));
    } catch {
      /* private mode */
    }
  },
};

export interface HintTiming {
  /** How long a hint shows, fades included (s). */
  show: number;
  /** Fade in / fade out (s). */
  fade: number;
  /** Quiet time after a hint before the next (s). */
  cooldown: number;
  /** A queued hint not asked for again within this long has lost its moment (s). */
  stale: number;
}

export const HINT_TIMING: HintTiming = { show: 4, fade: 0.5, cooldown: 6, stale: 1.2 };

export interface ShownHint<T> {
  id: string;
  data: T;
  /** 0..1: fades in, holds, fades out. */
  alpha: number;
  /** Seconds since it came up. */
  age: number;
}

interface Pending<T> {
  id: string;
  data: T;
  last: number;
}

export class HintQueue<T = unknown> {
  private seen = new Set<string>();
  private off = false;
  private queue: Pending<T>[] = [];
  private cur: { id: string; data: T; age: number } | null = null;
  private quiet = 0;
  private time = 0;
  readonly timing: HintTiming;

  constructor(
    private store: HintStore,
    timing: Partial<HintTiming> = {},
  ) {
    this.timing = { ...HINT_TIMING, ...timing };
    const s = store.load();
    if (s) {
      this.seen = new Set(s.seen);
      this.off = s.off;
    }
  }

  /** Show hints (the comfort setting). */
  get enabled() {
    return !this.off;
  }

  set enabled(on: boolean) {
    if (on === !this.off) return;
    this.off = !on;
    if (!on) {
      this.queue.length = 0;
      this.cur = null;
    }
    this.save();
  }

  /** Has this hint been shown on this device? */
  seenBefore(id: string) {
    return this.seen.has(id);
  }

  /**
   * The situation for hint `id` holds right now. Call it as often as you like
   * while it does: the first time it queues the hint, later calls keep it fresh
   * (and update its data). False if it's been shown before, is off, or is up now.
   */
  want(id: string, data: T): boolean {
    if (this.off || this.seen.has(id)) return false;
    if (this.cur?.id === id) {
      this.cur.data = data;
      return false;
    }
    const q = this.queue.find((p) => p.id === id);
    if (q) {
      q.last = this.time;
      q.data = data;
    } else this.queue.push({ id, data, last: this.time });
    return true;
  }

  /**
   * Advance the clock; returns the hint showing now (or null). `hold`: not a
   * good moment to start one (something else is asking for your attention).
   */
  update(dt: number, hold = false): ShownHint<T> | null {
    this.time += dt;
    const t = this.timing;
    if (this.cur) {
      this.cur.age += dt;
      if (this.cur.age >= t.show) {
        this.cur = null;
        this.quiet = t.cooldown;
      }
    } else if (this.quiet > 0) this.quiet -= dt;
    // Lost their moment: never shown, so not remembered either.
    this.queue = this.queue.filter((p) => this.time - p.last <= t.stale);
    if (!this.cur && !hold && this.quiet <= 0 && this.queue.length && !this.off) {
      const next = this.queue.shift()!;
      this.cur = { id: next.id, data: next.data, age: 0 };
      // Remembered as soon as it's up (a reload halfway through doesn't bring it back).
      this.seen.add(next.id);
      this.save();
    }
    return this.current;
  }

  /** The hint up now, with its fade. */
  get current(): ShownHint<T> | null {
    const c = this.cur;
    if (!c) return null;
    const { show, fade } = this.timing;
    const alpha = Math.max(0, Math.min(1, c.age / fade, (show - c.age) / fade));
    return { id: c.id, data: c.data, alpha, age: c.age };
  }

  /** How many are waiting. */
  get waiting() {
    return this.queue.length;
  }

  /** Forget every hint: they can all show again. */
  reset() {
    this.seen.clear();
    this.queue.length = 0;
    this.cur = null;
    this.quiet = 0;
    this.save();
  }

  private save() {
    this.store.save({ seen: [...this.seen], off: this.off });
  }
}
