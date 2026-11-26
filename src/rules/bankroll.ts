/**
 * Play-money bankroll shared by every game. Balance changes only through
 * debit/credit calls made by game engines, never directly from the UI.
 */
export type BankrollReason = 'bet' | 'win' | 'refund' | 'daily-bonus' | 'reset';

export interface BankrollChange {
  delta: number;
  balance: number;
  reason: BankrollReason;
  game?: string;
}

export interface BankrollStats {
  totalWagered: number;
  totalWon: number;
  biggestWin: number;
  spins: number;
}

export interface BankrollState {
  balance: number;
  lastBonusDay: string;
  stats: BankrollStats;
}

/** Every game starts you with this much (main.ts doesn't carry the balance over from the last one). */
export const STARTING_BALANCE = 2_000;
export const DAILY_BONUS = 2_500;

export class InsufficientFunds extends Error {
  constructor(need: number, have: number) {
    super(`Need $${need}, have $${have}`);
  }
}

export class Bankroll {
  private state: BankrollState;
  private listeners = new Set<(c: BankrollChange) => void>();

  constructor(initial?: Partial<BankrollState>) {
    this.state = {
      balance: initial?.balance ?? STARTING_BALANCE,
      lastBonusDay: initial?.lastBonusDay ?? '',
      stats: { totalWagered: 0, totalWon: 0, biggestWin: 0, spins: 0, ...initial?.stats },
    };
  }

  get balance(): number {
    return this.state.balance;
  }

  get stats(): Readonly<BankrollStats> {
    return this.state.stats;
  }

  snapshot(): BankrollState {
    return structuredClone(this.state);
  }

  onChange(fn: (c: BankrollChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  canAfford(amount: number): boolean {
    return amount <= this.state.balance;
  }

  debit(amount: number, reason: BankrollReason, game?: string): void {
    assertAmount(amount);
    if (amount > this.state.balance) throw new InsufficientFunds(amount, this.state.balance);
    this.state.balance = cents(this.state.balance - amount);
    if (reason === 'bet') this.state.stats.totalWagered = cents(this.state.stats.totalWagered + amount);
    this.emit(-amount, reason, game);
  }

  credit(amount: number, reason: BankrollReason, game?: string): void {
    assertAmount(amount);
    if (amount === 0) return;
    this.state.balance = cents(this.state.balance + amount);
    if (reason === 'win') {
      this.state.stats.totalWon = cents(this.state.stats.totalWon + amount);
      this.state.stats.biggestWin = Math.max(this.state.stats.biggestWin, amount);
    }
    this.emit(amount, reason, game);
  }

  /** Records one round played (spin of a wheel or reels). */
  countRound(): void {
    this.state.stats.spins += 1;
  }

  /** Grants the daily top-up once per calendar day (YYYY-MM-DD). Returns the amount granted. */
  claimDailyBonus(today: string): number {
    if (this.state.lastBonusDay === today) return 0;
    this.state.lastBonusDay = today;
    this.credit(DAILY_BONUS, 'daily-bonus');
    return DAILY_BONUS;
  }

  /** Lets a broke player start over. */
  reset(): void {
    const delta = STARTING_BALANCE - this.state.balance;
    this.state.balance = STARTING_BALANCE;
    this.emit(delta, 'reset');
  }

  private emit(delta: number, reason: BankrollReason, game?: string) {
    const change = { delta, balance: this.state.balance, reason, game };
    for (const l of this.listeners) l(change);
  }
}

function assertAmount(amount: number) {
  if (!Number.isFinite(amount) || amount < 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
    throw new RangeError(`bad amount ${amount}`);
  }
}

const cents = (x: number) => Math.round(x * 100) / 100;
