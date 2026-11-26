/**
 * Where every one of your chips is, and a single check that it all adds up.
 *
 * Your money lives in exactly one of these places at a time:
 *   - the wallet (your bankroll balance). The table rail is only a view of it:
 *     rail chips + rail chips in your hand + winnings still being pushed to you
 *     = balance. Rail chips in your hand are NOT taken out of the balance.
 *   - chips you pulled out of the wallet tray: in a hand (`hand`), or lying
 *     loose in the world as physical chips (`loose`). These ARE taken out of
 *     the balance (a 'chips' debit) and go back in when you return them.
 *   - bets on a layout (the games' own books; already debited as 'bet').
 *
 * worth = balance + bets + hand + loose. Moving chips between those places
 * (take out, bet, return, drop, collect) never changes worth. Only a game
 * settling (a win or a lost bet), free chips (bonus, reset) and chips you find
 * lying around (`found`) do.
 *
 * Pure: a Bankroll and numbers. Unit tested (tests/chipledger.test.ts).
 */
import type { Bankroll } from './bankroll';

const c2 = (x: number) => Math.round(x * 100) / 100;
const EPS = 0.005;

/** The rail at the table you're at, as it is drawn right now. */
export interface RailReading {
  /** Value of the chips on the rail (its counted stacks plus odd change). */
  total: number;
  /** Rail chips in your hands, resting in a palm, or flying back to the rail. */
  held: number;
  /** Winnings credited but still being pushed to you by the dealer. */
  away: number;
}

/** Everything the audit looks at, gathered at one instant. */
export interface ChipSnapshot {
  balance: number;
  /** Your chips on each table's layout (already debited). */
  bets: Record<string, number>;
  /** The ledger's books: wallet chips in hands and lying loose. */
  hand: number;
  loose: number;
  /** What is physically there (carried stacks; wallet chips present in the world), if known. */
  physicalHand?: number;
  physicalLoose?: number;
  /** The rail at the table you're at (null: not at a table). */
  rail?: RailReading | null;
}

export interface AuditResult {
  ok: boolean;
  worth: number;
  issues: string[];
}

/** Total value you own right now. */
export function worthOf(s: ChipSnapshot): number {
  let bets = 0;
  for (const v of Object.values(s.bets)) bets += v;
  return c2(s.balance + bets + s.hand + s.loose);
}

/**
 * The one source-of-truth check. `expected` is what your worth should be (the
 * starting money plus every win, loss, bonus and find since); leave it out to
 * check only that the parts agree with each other.
 */
export function auditChips(s: ChipSnapshot, expected?: number): AuditResult {
  const issues: string[] = [];
  const neg = (name: string, v: number) => v < -EPS && issues.push(`${name} is negative (${v})`);
  neg('balance', s.balance);
  neg('chips in hand', s.hand);
  neg('loose chips', s.loose);
  for (const [k, v] of Object.entries(s.bets)) neg(`bets at ${k}`, v);
  if (s.physicalHand !== undefined && Math.abs(s.physicalHand - s.hand) > EPS) issues.push(`hands hold ${s.physicalHand} in chips but the books say ${s.hand}`);
  if (s.physicalLoose !== undefined && Math.abs(s.physicalLoose - s.loose) > EPS) issues.push(`${s.physicalLoose} in loose chips lie about but the books say ${s.loose}`);
  if (s.rail) {
    const r = s.rail;
    neg('the rail', r.total);
    neg('rail chips in hand', r.held);
    if (Math.abs(r.total + r.held + r.away - s.balance) > EPS) issues.push(`rail ${r.total} + in hand ${r.held} + on its way ${r.away} ≠ balance ${s.balance}`);
  }
  const worth = worthOf(s);
  if (expected !== undefined && Math.abs(worth - expected) > EPS) issues.push(`worth ${worth} ≠ expected ${expected} (${c2(worth - expected) > 0 ? 'money from nowhere' : 'money lost'})`);
  return { ok: issues.length === 0, worth, issues };
}

/**
 * The books for chips out of the wallet. Every move is a transfer: it takes
 * from one place and puts the same amount in another, or refuses and changes
 * nothing.
 */
export class ChipLedger {
  /** Wallet chips in each hand ("left" / "right" / a test key). */
  readonly hand = new Map<string, number>();
  /** Wallet chips lying loose, by loose-object id. */
  readonly loose = new Map<string, number>();
  /** Chips you found lying around (not yours) that you bet or pocketed: money from the world. */
  found = 0;
  /** Your loose chips someone else took (a friend picked one up and bet it). */
  given = 0;

  constructor(
    private bank: Bankroll,
    /** Money in the balance that is spoken for (rail chips in your hand, winnings on their way). */
    private reserved: () => number = () => 0,
  ) {}

  get inHand(): number {
    let s = 0;
    for (const v of this.hand.values()) s += v;
    return c2(s);
  }

  get onTable(): number {
    let s = 0;
    for (const v of this.loose.values()) s += v;
    return c2(s);
  }

  /** All wallet chips out of the wallet. */
  get out(): number {
    return c2(this.inHand + this.onTable);
  }

  /** What you could take out of the wallet or bet right now. */
  get spendable(): number {
    return Math.max(0, c2(this.bank.balance - this.reserved()));
  }

  handOf(key: string): number {
    return this.hand.get(key) ?? 0;
  }

  /** Take `amount` out of the wallet into a hand. False (nothing changes) if you can't cover it. */
  take(key: string, amount: number): boolean {
    if (!(amount > 0) || amount > this.spendable + 1e-9) return false;
    this.bank.debit(amount, 'chips');
    this.hand.set(key, c2(this.handOf(key) + amount));
    return true;
  }

  /** Chips in a hand go back into the wallet (all of them, or `amount`). Returns what went back. */
  returnHand(key: string, amount = this.handOf(key)): number {
    amount = Math.min(amount, this.handOf(key));
    if (!(amount > 0)) return 0;
    this.setHand(key, this.handOf(key) - amount);
    this.bank.credit(c2(amount), 'chips');
    return c2(amount);
  }

  /** Chips let go of from a hand become loose chips (each id with its value). False if the hand doesn't hold that much. */
  drop(key: string, chips: [id: string, value: number][]): boolean {
    let sum = 0;
    for (const [, v] of chips) sum += v;
    if (sum > this.handOf(key) + EPS || chips.some(([id]) => this.loose.has(id))) return false;
    this.setHand(key, this.handOf(key) - sum);
    for (const [id, v] of chips) this.loose.set(id, v);
    return true;
  }

  /** A loose chip of yours back into the wallet. Returns its value (0 if it isn't yours). */
  collect(id: string): number {
    const v = this.loose.get(id);
    if (v === undefined) return 0;
    this.loose.delete(id);
    this.bank.credit(v, 'chips');
    return v;
  }

  /** A loose chip that isn't yours goes into your wallet: found money. */
  pocketFound(value: number) {
    if (!(value > 0)) return;
    this.found = c2(this.found + value);
    this.bank.credit(value, 'chips');
  }

  /**
   * Chips from a hand go on a bet. `place` must put `amount` on the layout
   * paid from the balance (it gets the amount credited first, and must debit
   * it again as the bet, or refuse and change nothing). True if it took.
   */
  betFromHand(key: string, amount: number, place: (amount: number) => boolean): boolean {
    if (!(amount > 0) || amount > this.handOf(key) + EPS) return false;
    this.setHand(key, this.handOf(key) - amount);
    this.bank.credit(amount, 'chips');
    if (this.safe(() => place(amount))) return true;
    this.bank.debit(amount, 'chips');
    this.setHand(key, this.handOf(key) + amount);
    return false;
  }

  /** A loose chip came to rest on a betting spot. Yours or found, `place` works as for betFromHand. */
  betLoose(id: string | null, value: number, place: (amount: number) => boolean): boolean {
    const mine = id !== null && this.loose.has(id);
    if (mine) this.loose.delete(id!);
    this.bank.credit(value, 'chips');
    if (this.safe(() => place(value))) {
      if (!mine) this.found = c2(this.found + value);
      return true;
    }
    this.bank.debit(value, 'chips');
    if (mine) this.loose.set(id!, value);
    return false;
  }

  /** A loose chip of yours left the world some other way (a friend took it). */
  lose(id: string): number {
    const v = this.loose.get(id);
    if (v === undefined) return 0;
    this.loose.delete(id);
    this.given = c2(this.given + v);
    return v;
  }

  private setHand(key: string, v: number) {
    v = c2(v);
    if (v > EPS) this.hand.set(key, v);
    else this.hand.delete(key);
  }

  private safe(f: () => boolean): boolean {
    try {
      return f();
    } catch {
      return false;
    }
  }
}
