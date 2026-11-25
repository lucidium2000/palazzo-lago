/**
 * Poker hand signals, read from your real hand in VR (the same idea as
 * bjgesture.ts): a check is two quick taps of your fingers on the felt in
 * front of you, the way players knock the table; a fold is sweeping your cards
 * forward toward the dealer with a flick of the hand. Bets are made with chips
 * (see pokerplay.ts), not signals. Pure maths (no three.js), so recorded hand
 * paths replay in tests.
 *
 * Coordinates are in your seat's frame, metres: origin on the felt at your
 * hole cards, x across the table (to your left), y up off the felt, z toward
 * you (so the dealer and the pot are toward -z).
 */

import type { HandSample, V3 } from './bjgesture';

export type { HandSample, V3 };
export type PokerSignal = 'check' | 'fold';

export const POKER_GESTURE = {
  /** The patch of felt in front of you where taps count. */
  tapX: 0.26,
  tapNear: 0.3,
  tapFar: -0.22,
  /** Touching the felt; lifted again above `release`. */
  contact: 0.03,
  release: 0.05,
  /** A tap comes down at least this fast (m/s). */
  tapSpeed: 0.3,
  /** Two taps: the second this soon after the first (s), not sooner than `tapGap`, this close (m). */
  doubleTap: 0.75,
  tapGap: 0.1,
  tapSpread: 0.16,
  /** The flick starts with the hand over your cards: this close across / along, this low. */
  foldNearX: 0.15,
  foldNearZ: 0.15,
  foldLow: 0.09,
  /** …and sweeps toward the dealer at least this far, this fast, staying low and straight. */
  foldDist: 0.16,
  foldSpeed: 0.7,
  foldHigh: 0.2,
  foldWindow: 0.5,
  /** Quiet time after a signal. */
  cooldown: 0.9,
};

interface Hist {
  t: number;
  p: V3 | null;
  tip: V3 | null;
}

/** Watches one hand; `update` returns a signal the moment one is made. */
export class PokerSignalReader {
  private hist: Hist[] = [];
  private touching = false;
  private lastTap: { t: number; x: number; z: number } | null = null;
  private quietUntil = -Infinity;

  constructor(private g = POKER_GESTURE) {}

  reset() {
    this.hist = [];
    this.touching = false;
    this.lastTap = null;
  }

  update(s: HandSample): PokerSignal | null {
    this.hist.push({ t: s.t, p: s.palm ?? s.tip, tip: s.tip ?? s.palm });
    while (this.hist.length > 2 && s.t - this.hist[0].t > this.g.foldWindow + 0.1) this.hist.shift();
    const tap = this.readTap(s);
    const fold = this.readFold(s);
    if (s.t < this.quietUntil) {
      // Nothing made during the quiet time counts afterwards.
      this.hist = this.hist.slice(-1);
      this.lastTap = null;
      return null;
    }
    const sig: PokerSignal | null = fold ? 'fold' : tap ? 'check' : null;
    if (sig) {
      this.quietUntil = s.t + this.g.cooldown;
      this.lastTap = null;
      this.hist = this.hist.slice(-1);
    }
    return sig;
  }

  /** Peak downward speed of the fingertip over the last 0.18 s. */
  private descent(t: number): number {
    let peak = 0;
    for (let i = 1; i < this.hist.length; i++) {
      const a = this.hist[i - 1],
        b = this.hist[i];
      if (t - b.t > 0.18 || !a.tip || !b.tip) continue;
      const dt = b.t - a.t;
      if (dt > 1e-4) peak = Math.max(peak, (a.tip.y - b.tip.y) / dt);
    }
    return peak;
  }

  private inTapZone(p: V3, grow = 0) {
    return Math.abs(p.x) < this.g.tapX + grow && p.z < this.g.tapNear + grow && p.z > this.g.tapFar - grow;
  }

  /** True on the second of two quick taps. */
  private readTap(s: HandSample): boolean {
    const p = s.tip ?? s.palm;
    if (!p) {
      this.touching = false;
      return false;
    }
    if (this.touching) {
      if (p.y > this.g.release || !this.inTapZone(p, 0.05)) this.touching = false;
      return false;
    }
    if (p.y > this.g.contact || p.y < -0.12 || !this.inTapZone(p)) return false;
    this.touching = true;
    if (this.descent(s.t) < this.g.tapSpeed) return false;
    const prev = this.lastTap;
    this.lastTap = { t: s.t, x: p.x, z: p.z };
    if (!prev) return false;
    const dt = s.t - prev.t;
    const near = Math.hypot(p.x - prev.x, p.z - prev.z) < this.g.tapSpread;
    if (dt >= this.g.tapGap && dt <= this.g.doubleTap && near) return true;
    return false;
  }

  /** A low, quick sweep forward that started over your cards. */
  private readFold(s: HandSample): boolean {
    const p = s.palm ?? s.tip;
    if (!p || p.y > this.g.foldHigh) return false;
    let peak = 0;
    for (let i = this.hist.length - 1; i > 0; i--) {
      const a = this.hist[i - 1],
        b = this.hist[i];
      if (!a.p || !b.p) break;
      const dt = b.t - a.t;
      if (dt > 1e-4) peak = Math.max(peak, (a.p.z - b.p.z) / dt);
      const st = a.p;
      if (s.t - a.t > this.g.foldWindow) break;
      if (st.y > this.g.foldHigh) break;
      const startOk = Math.abs(st.x) < this.g.foldNearX && Math.abs(st.z) < this.g.foldNearZ && st.y < this.g.foldLow;
      if (!startOk) continue;
      const dz = st.z - p.z,
        dx = Math.abs(p.x - st.x);
      if (dz >= this.g.foldDist && dx < dz * 0.8 && peak >= this.g.foldSpeed) return true;
    }
    return false;
  }
}
