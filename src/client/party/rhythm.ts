/**
 * Are you dancing? Watches your real head's height (VR) and tells how much
 * it is bobbing in time with the music: the vertical motion is high-passed
 * (crouching or sitting down is slow, a bob is quick), then correlated with
 * the beat at the tempo and at half tempo (one bob per beat, or one every
 * two). Any phase counts: a bob on the off-beat is still on the beat.
 *
 * Pure (no three.js): unit-tested in tests/rhythm.test.ts.
 */
export class BobDetector {
  /** 0..1: dancing on the beat (bob big enough and locked to the tempo). */
  level = 0;
  /** 0..1: how well the bob follows the tempo (any phase). */
  lock = 0;
  /** Bob amplitude (metres, peak). */
  amp = 0;
  /** How far the head is below its recent average right now (metres, ≥ 0): the knees bend this much. */
  dip = 0;
  private slow = NaN;
  private energy = 0;
  private z1 = { re: 0, im: 0 };
  private z2 = { re: 0, im: 0 };

  constructor(
    /** Seconds the average head height follows over. */
    readonly slowTau = 0.7,
    /** Seconds the beat correlation averages over. */
    readonly tau = 2.2,
    /** Smallest bob that counts (metres, peak). */
    readonly minAmp = 0.008,
  ) {}

  /** The head's recent average height (NaN before the first update). */
  get average() {
    return this.slow;
  }

  reset() {
    this.slow = NaN;
    this.energy = 0;
    this.z1 = { re: 0, im: 0 };
    this.z2 = { re: 0, im: 0 };
    this.level = this.lock = this.amp = this.dip = 0;
  }

  /** One frame: `headY` your head height (m), `beats` the music's continuous beat count. */
  update(dt: number, headY: number, beats: number): number {
    if (!(dt > 0) || !Number.isFinite(headY)) return this.level;
    dt = Math.min(dt, 0.1);
    if (Number.isNaN(this.slow)) this.slow = headY;
    this.slow += (headY - this.slow) * (1 - Math.exp(-dt / this.slowTau));
    const hp = headY - this.slow;
    this.dip = Math.max(0, -hp);
    const k = 1 - Math.exp(-dt / this.tau);
    this.energy += (hp * hp - this.energy) * k;
    const a1 = -2 * Math.PI * beats,
      a2 = -Math.PI * beats;
    this.z1.re += (hp * Math.cos(a1) - this.z1.re) * k;
    this.z1.im += (hp * Math.sin(a1) - this.z1.im) * k;
    this.z2.re += (hp * Math.cos(a2) - this.z2.re) * k;
    this.z2.im += (hp * Math.sin(a2) - this.z2.im) * k;
    const rms = Math.sqrt(this.energy);
    this.amp = rms * Math.SQRT2;
    const mag = Math.max(Math.hypot(this.z1.re, this.z1.im), Math.hypot(this.z2.re, this.z2.im));
    // A pure bob at the tempo gives |z| = A/2 and rms = A/√2: lock 1.
    this.lock = rms > 1e-5 ? Math.min(1, (mag * Math.SQRT2) / rms) : 0;
    const big = clamp01((this.amp - this.minAmp) / (this.minAmp * 2));
    const want = big * smooth(0.35, 0.7, this.lock);
    // Quick to start, slower to stop (a missed beat doesn't stop the dance).
    this.level += (want - this.level) * Math.min(1, dt * (want > this.level ? 3 : 1.2));
    return this.level;
  }
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
