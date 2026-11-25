/**
 * Your chips on the table rail, as chips rather than a number.
 *
 * The rail always holds exactly what you can spend (your balance, less chips
 * in your hand or still being paid out). It is kept as real counts per
 * denomination: taking a red chip leaves one fewer red chip, a win adds the
 * chips the dealer pays you, and a bet made some other way (a click) is paid
 * out of the stacks, breaking a bigger chip for change when it has to.
 * Pure logic: no three.js, unit tested.
 */

/** How many chips of each smaller size a fresh rack keeps for change. */
const RESERVE: Record<number, number> = { 1: 5, 5: 10, 25: 10, 100: 10, 500: 4, 1000: 2 };

/**
 * A fresh rack for `amount`: greedy from the biggest chip down, but each
 * bigger chip leaves enough below it for a working spread of smaller ones
 * (so $10,000 is not just two $5,000 chips). Whatever no chip can make
 * (cents, or under the smallest chip) is left over as `odd`.
 */
export function rackBreakdown(amount: number, denoms: readonly number[]): { counts: number[]; odd: number } {
  const ds = [...denoms].sort((a, b) => a - b);
  const counts = ds.map(() => 0);
  let left = Math.max(0, Math.floor(amount + 1e-9));
  for (let i = ds.length - 1; i >= 0; i--) {
    let keep = 0;
    for (let j = 0; j < i; j++) keep += (RESERVE[ds[j]] ?? 5) * ds[j];
    const n = Math.floor(Math.max(0, left - keep) / ds[i]);
    counts[i] = n;
    left -= n * ds[i];
  }
  // Whatever the reserve held back is paid greedily.
  for (let i = ds.length - 1; i >= 0; i--) {
    const n = Math.floor(left / ds[i]);
    counts[i] += n;
    left -= n * ds[i];
  }
  return { counts: reorder(counts, ds, denoms), odd: round2(amount - sum(reorder(counts, ds, denoms), denoms)) };
}

/** Plain greedy breakdown (a payout, change for a broken chip). */
export function greedyBreakdown(amount: number, denoms: readonly number[]): { counts: number[]; odd: number } {
  const order = denoms.map((d, i) => [d, i] as const).sort((a, b) => b[0] - a[0]);
  const counts = denoms.map(() => 0);
  let left = Math.max(0, Math.floor(amount + 1e-9));
  for (const [d, i] of order) {
    counts[i] = Math.floor(left / d);
    left -= counts[i] * d;
  }
  return { counts, odd: round2(amount - sum(counts, denoms)) };
}

/** Visible chips per stack (the rest is counted on the label). */
export function visibleStacks(counts: readonly number[], cap: number): number[] {
  return counts.map((n) => Math.min(n, cap));
}

export class ChipWallet {
  /** Chips per denomination, in the order of `denoms`. */
  readonly counts: number[];
  /** What no chip makes (cents, or less than the smallest chip). */
  odd = 0;
  private started = false;

  constructor(readonly denoms: readonly number[]) {
    this.counts = denoms.map(() => 0);
  }

  /** Total value of the chips (not counting `odd`). */
  get chips(): number {
    return sum(this.counts, this.denoms);
  }

  get total(): number {
    return round2(this.chips + this.odd);
  }

  count(d: number): number {
    const i = this.denoms.indexOf(d);
    return i < 0 ? 0 : this.counts[i];
  }

  /**
   * Make the rail add up to `total` (what you can spend right now). More: the
   * difference arrives as chips (a payout). Less: chips leave the stacks (a
   * bet made with a click), with change made from a bigger chip if needed.
   * Returns true if anything changed.
   */
  sync(total: number): boolean {
    total = Math.max(0, round2(total));
    if (!this.started) {
      this.started = true;
      this.reset(total);
      return true;
    }
    const min = Math.min(...this.denoms);
    const diff = round2(total - this.chips);
    if (diff >= 0 && diff < min) {
      if (diff === this.odd) return false;
      this.odd = diff;
      return true;
    }
    if (diff >= min) this.add(diff);
    else this.pay(this.chips - total);
    this.odd = round2(total - this.chips);
    // Something didn't add up (shouldn't happen): start a fresh rack.
    if (this.odd < 0 || this.odd >= min) this.reset(total);
    return true;
  }

  /** A fresh rack for `total`. */
  reset(total: number) {
    const r = rackBreakdown(total, this.denoms);
    r.counts.forEach((n, i) => (this.counts[i] = n));
    this.odd = r.odd;
    this.started = true;
  }

  /** Take one chip of `d` off the rail (into your hand). False if there isn't one: no money from nowhere. */
  take(d: number): boolean {
    const i = this.denoms.indexOf(d);
    if (i < 0 || this.counts[i] <= 0) return false;
    this.counts[i]--;
    return true;
  }

  /** Chips added to the rail (a payout or chips returned): greedy. */
  private add(amount: number) {
    const g = greedyBreakdown(amount, this.denoms);
    g.counts.forEach((n, i) => (this.counts[i] += n));
  }

  /** Remove `amount` of chips, making change from a bigger chip when needed. */
  private pay(amount: number) {
    let left = round2(amount);
    const order = this.denoms.map((d, i) => [d, i] as const).sort((a, b) => b[0] - a[0]);
    for (const [d, i] of order) {
      while (this.counts[i] > 0 && d <= left + 1e-9) {
        this.counts[i]--;
        left = round2(left - d);
      }
    }
    if (left <= 0) return;
    // Break the smallest chip that covers what's left and keep the change.
    for (let k = order.length - 1; k >= 0; k--) {
      const [d, i] = order[k];
      if (this.counts[i] > 0 && d > left) {
        this.counts[i]--;
        this.add(round2(d - left));
        return;
      }
    }
  }
}

function sum(counts: readonly number[], denoms: readonly number[]) {
  return counts.reduce((s, n, i) => s + n * denoms[i], 0);
}

function reorder(counts: number[], sorted: number[], denoms: readonly number[]) {
  return denoms.map((d) => counts[sorted.indexOf(d)]);
}

const round2 = (x: number) => Math.round(x * 100) / 100;
