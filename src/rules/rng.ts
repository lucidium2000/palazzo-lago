/**
 * Every random outcome in the game goes through an Rng. In single-player the
 * client uses CryptoRng; in multiplayer the server will own it. Tests use
 * SeededRng so results are reproducible.
 */
export interface Rng {
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
}

/** Unbiased integers from the Web Crypto API (rejection sampling). */
export class CryptoRng implements Rng {
  private buf = new Uint32Array(1);

  int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 2 ** 32) {
      throw new RangeError(`bad range ${maxExclusive}`);
    }
    const limit = Math.floor(2 ** 32 / maxExclusive) * maxExclusive;
    for (;;) {
      globalThis.crypto.getRandomValues(this.buf);
      const v = this.buf[0];
      if (v < limit) return v % maxExclusive;
    }
  }
}

/** Fast deterministic generator (mulberry32) for tests and simulations. */
export class SeededRng implements Rng {
  private s: number;

  constructor(seed = 1) {
    this.s = seed >>> 0;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
}
