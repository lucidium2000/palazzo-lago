import type { Bankroll } from './bankroll';
import type { Rng } from './rng';

/** Pocket ids: 0..36 are their own numbers, 37 is "00". */
export type Pocket = number;
export const DOUBLE_ZERO = 37;
export const POCKET_COUNT = 38;

/** American wheel, clockwise from 0. */
export const WHEEL_ORDER: readonly Pocket[] = [
  0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1, DOUBLE_ZERO, 27, 10, 25, 29,
  12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2,
];

export const RED_NUMBERS: ReadonlySet<number> = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export type PocketColor = 'red' | 'black' | 'green';

export function pocketColor(p: Pocket): PocketColor {
  if (p === 0 || p === DOUBLE_ZERO) return 'green';
  return RED_NUMBERS.has(p) ? 'red' : 'black';
}

export function pocketLabel(p: Pocket): string {
  return p === DOUBLE_ZERO ? '00' : String(p);
}

export type BetKind =
  | 'straight'
  | 'split'
  | 'street'
  | 'trio'
  | 'corner'
  | 'topline'
  | 'sixline'
  | 'dozen'
  | 'column'
  | 'red'
  | 'black'
  | 'odd'
  | 'even'
  | 'low'
  | 'high';

export interface BetSpot {
  id: string;
  kind: BetKind;
  numbers: readonly Pocket[];
  /** Winnings per unit staked, not counting the returned stake (35 means 35 to 1). */
  payout: number;
  inside: boolean;
}

const PAYOUT_BY_SIZE: Record<number, number> = { 1: 35, 2: 17, 3: 11, 4: 8, 6: 5, 12: 2, 18: 1 };

function makeSpot(kind: BetKind, numbers: Pocket[], id?: string): BetSpot {
  const sorted = [...numbers].sort((a, b) => a - b);
  const payout = kind === 'topline' ? 6 : PAYOUT_BY_SIZE[sorted.length];
  if (payout === undefined) throw new Error(`no payout for ${kind} ${numbers}`);
  return {
    id: id ?? `${kind}:${sorted.map(pocketLabel).join('-')}`,
    kind,
    numbers: sorted,
    payout,
    inside: !['dozen', 'column', 'red', 'black', 'odd', 'even', 'low', 'high'].includes(kind),
  };
}

/** The number in grid row r (0..11, from the zero end) and column c (0..2). */
export const gridNumber = (r: number, c: number) => r * 3 + c + 1;

function buildSpots(): BetSpot[] {
  const spots: BetSpot[] = [];
  for (let n = 0; n <= 36; n++) spots.push(makeSpot('straight', [n]));
  spots.push(makeSpot('straight', [DOUBLE_ZERO]));

  for (let r = 0; r < 12; r++) {
    for (let c = 0; c < 3; c++) {
      const n = gridNumber(r, c);
      if (c < 2) spots.push(makeSpot('split', [n, n + 1]));
      if (r < 11) spots.push(makeSpot('split', [n, n + 3]));
      if (c < 2 && r < 11) spots.push(makeSpot('corner', [n, n + 1, n + 3, n + 4]));
    }
    const a = gridNumber(r, 0);
    spots.push(makeSpot('street', [a, a + 1, a + 2]));
    if (r < 11) spots.push(makeSpot('sixline', [a, a + 1, a + 2, a + 3, a + 4, a + 5]));
  }

  // Zero-area bets on an American layout.
  spots.push(makeSpot('split', [0, DOUBLE_ZERO]));
  spots.push(makeSpot('split', [0, 1]));
  spots.push(makeSpot('split', [0, 2]));
  spots.push(makeSpot('split', [DOUBLE_ZERO, 2]));
  spots.push(makeSpot('split', [DOUBLE_ZERO, 3]));
  spots.push(makeSpot('trio', [0, 1, 2]));
  spots.push(makeSpot('trio', [DOUBLE_ZERO, 2, 3]));
  spots.push(makeSpot('topline', [0, DOUBLE_ZERO, 1, 2, 3]));

  const range = (from: number, to: number, pred: (n: number) => boolean = () => true) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i).filter(pred);

  spots.push(makeSpot('dozen', range(1, 12), 'dozen:1'));
  spots.push(makeSpot('dozen', range(13, 24), 'dozen:2'));
  spots.push(makeSpot('dozen', range(25, 36), 'dozen:3'));
  for (let c = 0; c < 3; c++) {
    spots.push(makeSpot('column', range(1, 36, (n) => (n - 1) % 3 === c), `column:${c + 1}`));
  }
  spots.push(makeSpot('red', range(1, 36, (n) => RED_NUMBERS.has(n)), 'red'));
  spots.push(makeSpot('black', range(1, 36, (n) => !RED_NUMBERS.has(n)), 'black'));
  spots.push(makeSpot('odd', range(1, 36, (n) => n % 2 === 1), 'odd'));
  spots.push(makeSpot('even', range(1, 36, (n) => n % 2 === 0), 'even'));
  spots.push(makeSpot('low', range(1, 18), 'low'));
  spots.push(makeSpot('high', range(19, 36), 'high'));
  return spots;
}

export const BET_SPOTS: readonly BetSpot[] = buildSpots();
export const SPOTS_BY_ID: ReadonlyMap<string, BetSpot> = new Map(BET_SPOTS.map((s) => [s.id, s]));

export function spotFor(kind: BetKind, numbers: Pocket[]): BetSpot | undefined {
  const sorted = [...numbers].sort((a, b) => a - b);
  return SPOTS_BY_ID.get(`${kind}:${sorted.map(pocketLabel).join('-')}`);
}

export interface TableLimits {
  minBet: number;
  maxInside: number;
  maxOutside: number;
  maxTotal: number;
}

export const DEFAULT_LIMITS: TableLimits = {
  minBet: 1,
  maxInside: 1_000,
  maxOutside: 5_000,
  maxTotal: 25_000,
};

export type RoulettePhase = 'betting' | 'spinning';

export interface SpotResult {
  spotId: string;
  stake: number;
  won: boolean;
  /** Total returned to the player (stake + winnings), 0 if lost. */
  returned: number;
}

export interface SpinResult {
  pocket: Pocket;
  color: PocketColor;
  results: SpotResult[];
  totalStaked: number;
  totalReturned: number;
}

export class BetRejected extends Error {}

/**
 * One roulette table. Chips leave the bankroll when placed; a spin decides
 * the pocket; settle() pays winners and clears the layout.
 */
export class RouletteGame {
  readonly bets = new Map<string, number>();
  phase: RoulettePhase = 'betting';
  history: Pocket[] = [];
  private lastBets = new Map<string, number>();
  private pending: Pocket | null = null;

  constructor(
    private bankroll: Bankroll,
    readonly limits: TableLimits = DEFAULT_LIMITS,
  ) {}

  get totalBet(): number {
    let t = 0;
    for (const v of this.bets.values()) t += v;
    return t;
  }

  /** Throws BetRejected with a player-facing message when the bet is not allowed. */
  placeBet(spotId: string, amount: number): void {
    if (this.phase !== 'betting') throw new BetRejected('No more bets');
    const spot = SPOTS_BY_ID.get(spotId);
    if (!spot) throw new BetRejected('Not a valid bet');
    if (amount < this.limits.minBet) throw new BetRejected(`Minimum bet is $${this.limits.minBet}`);
    const current = this.bets.get(spotId) ?? 0;
    const max = spot.inside ? this.limits.maxInside : this.limits.maxOutside;
    if (current + amount > max) throw new BetRejected(`Table max on that spot is $${max}`);
    if (this.totalBet + amount > this.limits.maxTotal) throw new BetRejected('Table maximum reached');
    if (!this.bankroll.canAfford(amount)) throw new BetRejected('Not enough chips');
    this.bankroll.debit(amount, 'bet', 'roulette');
    this.bets.set(spotId, current + amount);
  }

  removeBet(spotId: string): number {
    if (this.phase !== 'betting') return 0;
    const amount = this.bets.get(spotId) ?? 0;
    if (amount > 0) {
      this.bets.delete(spotId);
      this.bankroll.credit(amount, 'refund', 'roulette');
    }
    return amount;
  }

  clearBets(): number {
    let refunded = 0;
    for (const id of [...this.bets.keys()]) refunded += this.removeBet(id);
    return refunded;
  }

  /** Places the previous round's bets again. Returns false if they can't all be placed. */
  rebet(): boolean {
    if (this.phase !== 'betting' || this.lastBets.size === 0) return false;
    let need = 0;
    for (const v of this.lastBets.values()) need += v;
    if (!this.bankroll.canAfford(need)) return false;
    for (const [id, v] of this.lastBets) this.placeBet(id, v);
    return true;
  }

  get canRebet(): boolean {
    return this.phase === 'betting' && this.lastBets.size > 0 && this.bets.size === 0;
  }

  /** Closes betting and decides the pocket. The client animates the ball to it, then calls settle(). */
  spin(rng: Rng): Pocket {
    if (this.phase !== 'betting') throw new BetRejected('Already spinning');
    if (this.bets.size === 0) throw new BetRejected('Place a bet first');
    this.phase = 'spinning';
    this.pending = WHEEL_ORDER[rng.int(POCKET_COUNT)];
    return this.pending;
  }

  settle(): SpinResult {
    if (this.phase !== 'spinning' || this.pending === null) throw new Error('nothing to settle');
    const pocket = this.pending;
    const results: SpotResult[] = [];
    let totalStaked = 0;
    let totalReturned = 0;
    for (const [spotId, stake] of this.bets) {
      const spot = SPOTS_BY_ID.get(spotId)!;
      const won = spot.numbers.includes(pocket);
      const returned = won ? stake * (spot.payout + 1) : 0;
      results.push({ spotId, stake, won, returned });
      totalStaked += stake;
      totalReturned += returned;
    }
    if (totalReturned > 0) this.bankroll.credit(totalReturned, 'win', 'roulette');
    this.bankroll.countRound();
    this.lastBets = new Map(this.bets);
    this.bets.clear();
    this.history.unshift(pocket);
    this.history.length = Math.min(this.history.length, 20);
    this.pending = null;
    this.phase = 'betting';
    return { pocket, color: pocketColor(pocket), results, totalStaked, totalReturned };
  }
}
