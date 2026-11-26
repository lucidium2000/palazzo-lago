import { describe, expect, it } from 'vitest';
import { Bankroll } from '../src/rules/bankroll';
import { ChipWallet } from '../src/rules/chiprack';
import { auditChips, ChipLedger, type ChipSnapshot } from '../src/rules/chipledger';

const DENOMS = [1, 5, 25, 100, 500, 1000, 5000] as const;
const c2 = (x: number) => Math.round(x * 100) / 100;

/** A seeded random source (Park–Miller). */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/**
 * The client's chip system in miniature: the bankroll, the rail (a ChipWallet
 * plus rail chips in hand and winnings on their way), the wallet tray's books
 * (ChipLedger), physical loose chips (yours and found ones) and one table's
 * layout. Every action is something you can do in the game.
 */
class World {
  bank = new Bankroll({ balance: 2000 });
  railHeld = 0;
  away = 0;
  ledger = new ChipLedger(this.bank, () => this.railHeld + this.away);
  rail = new ChipWallet(DENOMS);
  bets = new Map<string, number>();
  /** Physical wallet chips in hands (what the carry meshes show). */
  carried = new Map<string, number>();
  /** Loose chips lying in the world: id → value, and whether they're from your wallet. */
  looseChips = new Map<string, { v: number; mine: boolean }>();
  expected = 2000;
  n = 0;
  log: string[] = [];

  constructor(private r: () => number) {
    for (let i = 0; i < 6; i++) this.looseChips.set(`found${i}`, { v: [5, 25, 100][i % 3], mine: false });
    this.syncRail();
  }

  pick<T>(a: readonly T[]): T {
    return a[Math.floor(this.r() * a.length)];
  }

  syncRail() {
    this.rail.sync(Math.max(0, this.bank.balance - this.away - this.railHeld));
  }

  /** The table's own book: a bet is debited, taking it down refunds it. */
  placeBet(spot: string, amount: number): boolean {
    if (!this.bank.canAfford(amount)) return false;
    this.bank.debit(amount, 'bet', 'test');
    this.bets.set(spot, c2((this.bets.get(spot) ?? 0) + amount));
    return true;
  }

  snapshot(): ChipSnapshot {
    let ph = 0;
    for (const v of this.carried.values()) ph += v;
    let pl = 0;
    for (const c of this.looseChips.values()) if (c.mine) pl += c.v;
    return {
      balance: this.bank.balance,
      bets: { test: [...this.bets.values()].reduce((s, v) => s + v, 0) },
      hand: this.ledger.inHand,
      loose: this.ledger.onTable,
      physicalHand: c2(ph),
      physicalLoose: c2(pl),
      rail: { total: this.rail.total, held: this.railHeld, away: this.away },
    };
  }

  step() {
    const r = this.r;
    const hand = this.pick(['left', 'right']);
    const spot = this.pick(['pass', 'field', 'six', 'red']);
    const d = this.pick(DENOMS);
    const act = this.pick(['take', 'take', 'more', 'betHand', 'returnHand', 'drop', 'drop', 'collect', 'betLoose', 'pocket', 'railTake', 'railBet', 'railBack', 'click', 'down', 'win', 'lose', 'arrive']);
    this.log.push(act);
    switch (act) {
      case 'take':
      case 'more':
        // Pull a chip off the wallet tray (hold longer: another one).
        if (this.ledger.take(hand, d)) this.carried.set(hand, c2((this.carried.get(hand) ?? 0) + d));
        break;
      case 'betHand': {
        const amt = this.carried.get(hand) ?? 0;
        if (amt > 0 && this.ledger.betFromHand(hand, amt, (a) => this.placeBet(spot, a))) this.carried.delete(hand);
        break;
      }
      case 'returnHand': {
        const amt = this.carried.get(hand) ?? 0;
        if (amt > 0 && this.ledger.returnHand(hand) === amt) this.carried.delete(hand);
        break;
      }
      case 'drop': {
        // Let go over the felt (not a spot): the stack falls as loose chips, one id per chip.
        const amt = this.carried.get(hand) ?? 0;
        if (amt <= 0) break;
        const chips: [string, number][] = [];
        let left = amt;
        for (const den of [...DENOMS].reverse())
          while (left >= den - 1e-9) {
            chips.push([`w${this.n++}`, den]);
            left = c2(left - den);
          }
        if (this.ledger.drop(hand, chips)) {
          this.carried.delete(hand);
          for (const [id, v] of chips) this.looseChips.set(id, { v, mine: true });
        }
        break;
      }
      case 'collect': {
        // Tap one of your loose chips with an open hand (or sweep them in).
        const mine = [...this.looseChips].filter(([, c]) => c.mine);
        if (!mine.length) break;
        const [id] = this.pick(mine);
        if (this.ledger.collect(id) > 0) this.looseChips.delete(id);
        break;
      }
      case 'betLoose': {
        // A loose chip (yours or found) comes to rest on a betting spot.
        const all = [...this.looseChips];
        if (!all.length) break;
        const [id, c] = this.pick(all);
        if (this.ledger.betLoose(c.mine ? id : null, c.v, (a) => this.placeBet(spot, a))) {
          this.looseChips.delete(id);
          if (!c.mine) this.expected = c2(this.expected + c.v);
        }
        break;
      }
      case 'pocket': {
        // A found chip dropped on the wallet tray.
        const found = [...this.looseChips].filter(([, c]) => !c.mine);
        if (!found.length) break;
        const [id, c] = this.pick(found);
        this.ledger.pocketFound(c.v);
        this.looseChips.delete(id);
        this.expected = c2(this.expected + c.v);
        break;
      }
      case 'railTake':
        if (this.rail.take(d)) this.railHeld = c2(this.railHeld + d);
        break;
      case 'railBet':
        // Rail chips set down on a spot: the bet is debited as they leave the hand.
        if (this.railHeld > 0 && this.placeBet(spot, this.railHeld)) this.railHeld = 0;
        break;
      case 'railBack':
        this.railHeld = 0;
        break;
      case 'click': {
        // A pointed finger (or a click) bets the selected chip from what's spendable.
        if (d <= this.ledger.spendable) this.placeBet(spot, d);
        break;
      }
      case 'down': {
        const v = this.bets.get(spot);
        if (v) {
          this.bets.delete(spot);
          this.bank.credit(v, 'refund', 'test');
        }
        break;
      }
      case 'win': {
        const v = this.bets.get(spot);
        if (v) {
          this.bets.delete(spot);
          // Stake back plus even money, pushed to you by the dealer.
          this.bank.credit(v * 2, 'win', 'test');
          this.away = c2(this.away + v * 2);
          this.expected = c2(this.expected + v);
        }
        break;
      }
      case 'lose': {
        const v = this.bets.get(spot);
        if (v) {
          this.bets.delete(spot);
          this.expected = c2(this.expected - v);
        }
        break;
      }
      case 'arrive':
        this.away = 0;
        break;
    }
    void r;
    this.syncRail();
  }
}

describe('chip ledger', () => {
  it('take, return, drop and collect move money without making or losing any', () => {
    const bank = new Bankroll({ balance: 100 });
    const l = new ChipLedger(bank);
    expect(l.take('r', 25)).toBe(true);
    expect(bank.balance).toBe(75);
    expect(l.take('r', 500)).toBe(false);
    expect(l.drop('r', [['a', 25]])).toBe(true);
    expect(l.inHand).toBe(0);
    expect(l.onTable).toBe(25);
    expect(l.collect('a')).toBe(25);
    expect(l.collect('a')).toBe(0);
    expect(bank.balance).toBe(100);
  });

  it('a failed bet leaves the chips where they were', () => {
    const bank = new Bankroll({ balance: 100 });
    const l = new ChipLedger(bank);
    l.take('r', 25);
    expect(l.betFromHand('r', 25, () => false)).toBe(false);
    expect(l.inHand).toBe(25);
    expect(bank.balance).toBe(75);
    expect(
      l.betFromHand('r', 25, () => {
        throw new Error('rejected');
      }),
    ).toBe(false);
    expect(l.inHand).toBe(25);
    expect(bank.balance).toBe(75);
  });

  it('chips spoken for on the rail cannot be taken out twice', () => {
    const bank = new Bankroll({ balance: 100 });
    let held = 100;
    const l = new ChipLedger(bank, () => held);
    expect(l.take('r', 1)).toBe(false);
    held = 75;
    expect(l.take('r', 25)).toBe(true);
    expect(l.take('r', 1)).toBe(false);
  });

  it('the audit catches a leak, a double count and a rail that does not add up', () => {
    const base: ChipSnapshot = { balance: 100, bets: { t: 50 }, hand: 25, loose: 0, physicalHand: 25, physicalLoose: 0, rail: { total: 100, held: 0, away: 0 } };
    expect(auditChips(base, 175).ok).toBe(true);
    expect(auditChips({ ...base, physicalLoose: 5 }).ok).toBe(false);
    expect(auditChips({ ...base, rail: { total: 80, held: 25, away: 0 } }).ok).toBe(false);
    expect(auditChips(base, 150).issues[0]).toMatch(/from nowhere/);
  });

  for (const seed of [1, 7, 42, 1234, 99991]) {
    it(`a long random evening adds up (seed ${seed})`, () => {
      const w = new World(rng(seed));
      for (let i = 0; i < 3000; i++) {
        w.step();
        const a = auditChips(w.snapshot(), w.expected);
        if (!a.ok) throw new Error(`step ${i} (${w.log.slice(-5).join(' → ')}): ${a.issues.join('; ')}`);
      }
      // Bring everything home: the worth is all in the balance.
      for (const h of ['left', 'right']) w.ledger.returnHand(h);
      for (const id of [...w.ledger.loose.keys()]) w.ledger.collect(id);
      w.carried.clear();
      for (const [id, c] of w.looseChips) if (c.mine) w.looseChips.delete(id);
      w.railHeld = 0;
      w.away = 0;
      w.syncRail();
      const a = auditChips(w.snapshot(), w.expected);
      expect(a.issues).toEqual([]);
      expect(w.ledger.out).toBe(0);
    });
  }
});
