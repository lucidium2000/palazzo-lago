/**
 * Blackjack hand signals, read from your real hand in VR: the dealer can't
 * hear you, so you show them. Tap the felt beside your cards (one firm tap, or
 * two light ones) for a card; wave a flat hand side to side over your cards to
 * stand. Pure maths (no three.js) so recorded hand paths can be replayed in tests.
 *
 * Coordinates are in your spot's frame, metres: origin on the felt at your
 * cards, x across the table (to your left), y up off the felt, z toward you.
 */

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface HandSample {
  /** Seconds (any monotonic clock). */
  t: number;
  /** Index fingertip, if known. */
  tip: V3 | null;
  /** Palm / wrist centre, if known. */
  palm: V3 | null;
  /** How open the hand is: 0 a fist, 1 flat. */
  open: number;
}

export type Signal = 'hit' | 'stand';

export const GESTURE = {
  /** The patch of felt around your cards that counts (half-width across, near/far edges). */
  zoneX: 0.22,
  zoneNear: 0.26,
  zoneFar: -0.14,
  /** Touching the felt: tip this close; lifted again above `release`. */
  contact: 0.03,
  release: 0.055,
  /** A tap comes down at least this fast (m/s); a firm one alone is a hit. */
  tapSpeed: 0.28,
  firmSpeed: 0.85,
  /** Two light taps this close together are a hit. */
  doubleTap: 0.9,
  /** A wave: palm this high over the felt, open, moving sideways. */
  waveLow: 0.025,
  waveHigh: 0.38,
  waveOpen: 0.5,
  strokeLen: 0.05,
  strokeSpeed: 0.3,
  waveWindow: 1.4,
  /** Quiet time after a signal. */
  cooldown: 1.0,
};

interface Stroke {
  dir: number;
  x0: number;
  y0: number;
  t0: number;
  peak: number;
  x: number;
  y: number;
}

/** Watches one hand; `update` returns a signal the moment one is made. */
export class SignalReader {
  private hist: { t: number; tip: V3 | null; palm: V3 | null }[] = [];
  private touching = false;
  private lastTap = -Infinity;
  private quietUntil = -Infinity;
  private stroke: Stroke | null = null;
  private strokes: Stroke[] = [];

  constructor(private g = GESTURE) {}

  reset() {
    this.hist = [];
    this.touching = false;
    this.lastTap = -Infinity;
    this.stroke = null;
    this.strokes = [];
  }

  private inZone(p: V3, grow = 0) {
    return Math.abs(p.x) < this.g.zoneX + grow && p.z < this.g.zoneNear + grow && p.z > this.g.zoneFar - grow;
  }

  /** Velocity of a point over the last ~60 ms of history. */
  private vel(pick: (h: (typeof this.hist)[number]) => V3 | null): V3 | null {
    const n = this.hist.length;
    if (n < 2) return null;
    const b = this.hist[n - 1];
    const pb = pick(b);
    if (!pb) return null;
    let a = this.hist[n - 2];
    for (let i = n - 2; i >= 0; i--) {
      a = this.hist[i];
      if (b.t - a.t >= 0.05) break;
    }
    const pa = pick(a);
    const dt = b.t - a.t;
    if (!pa || dt <= 1e-4) return null;
    return { x: (pb.x - pa.x) / dt, y: (pb.y - pa.y) / dt, z: (pb.z - pa.z) / dt };
  }

  update(s: HandSample): Signal | null {
    this.hist.push({ t: s.t, tip: s.tip, palm: s.palm });
    while (this.hist.length > 2 && s.t - this.hist[0].t > 0.4) this.hist.shift();
    const quiet = s.t < this.quietUntil;
    const tap = this.readTap(s);
    const wave = this.readWave(s);
    if (quiet) return null;
    const sig: Signal | null = tap ? 'hit' : wave ? 'stand' : null;
    if (sig) {
      this.quietUntil = s.t + this.g.cooldown;
      this.lastTap = -Infinity;
      this.stroke = null;
      this.strokes = [];
    }
    return sig;
  }

  /** Peak downward speed of the tip over the last 0.18 s. */
  private descent(t: number): number {
    let peak = 0;
    for (let i = 1; i < this.hist.length; i++) {
      const a = this.hist[i - 1],
        b = this.hist[i];
      if (t - b.t > 0.18) continue;
      const pa = a.tip ?? a.palm,
        pb = b.tip ?? b.palm;
      const dt = b.t - a.t;
      if (!pa || !pb || dt <= 1e-4) continue;
      peak = Math.max(peak, (pa.y - pb.y) / dt);
    }
    return peak;
  }

  private readTap(s: HandSample): boolean {
    const p = s.tip ?? s.palm;
    if (!p) {
      this.touching = false;
      return false;
    }
    if (this.touching) {
      if (p.y > this.g.release || !this.inZone(p, 0.05)) this.touching = false;
      return false;
    }
    if (p.y > this.g.contact || p.y < -0.12 || !this.inZone(p)) return false;
    this.touching = true;
    const speed = this.descent(s.t);
    if (speed < this.g.tapSpeed) return false;
    const second = s.t - this.lastTap < this.g.doubleTap;
    this.lastTap = s.t;
    return speed >= this.g.firmSpeed || second;
  }

  private readWave(s: HandSample): boolean {
    const p = s.palm ?? s.tip;
    const ok = !!p && s.open >= this.g.waveOpen && p.y > this.g.waveLow && p.y < this.g.waveHigh && this.inZone(p, 0.08);
    if (!ok || !p) {
      this.stroke = null;
      this.strokes = [];
      return false;
    }
    const v = this.vel((h) => h.palm ?? h.tip);
    if (!v) return false;
    const dir = v.x > 0.08 ? 1 : v.x < -0.08 ? -1 : 0;
    const st = this.stroke;
    if (st && dir !== 0 && dir !== st.dir) {
      // Turned round: the stroke that just ended counts if it was long, quick and level.
      if (this.good(st)) this.strokes.push(st);
      else this.strokes = [];
      this.stroke = null;
    }
    if (!this.stroke && dir !== 0) this.stroke = { dir, x0: p.x, y0: p.y, t0: s.t, peak: 0, x: p.x, y: p.y };
    const cur = this.stroke;
    if (cur) {
      cur.x = p.x;
      cur.y = p.y;
      cur.peak = Math.max(cur.peak, Math.abs(v.x));
    }
    this.strokes = this.strokes.filter((k) => s.t - k.t0 < this.g.waveWindow);
    // One full stroke one way, and the stroke back is long enough: that's a wave.
    return !!cur && this.strokes.length >= 1 && this.strokes[this.strokes.length - 1].dir !== cur.dir && this.good(cur);
  }

  private good(st: Stroke) {
    const dx = Math.abs(st.x - st.x0),
      dy = Math.abs(st.y - st.y0);
    return dx >= this.g.strokeLen && st.peak >= this.g.strokeSpeed && dy < dx * 0.7;
  }
}
