import { describe, expect, it } from 'vitest';
import { Bankroll } from '../src/rules/bankroll';
import { ChipWallet, greedyBreakdown, rackBreakdown, visibleStacks } from '../src/rules/chiprack';
import { CrapsBetRejected, CrapsGame } from '../src/rules/craps';
import { BetRejected, RouletteGame } from '../src/rules/roulette';

const DENOMS = [1, 5, 25, 100, 500, 1000, 5000];
const value = (counts: number[], denoms = DENOMS) => counts.reduce((s, n, i) => s + n * denoms[i], 0);

describe('balance → rail stacks', () => {
  it('a fresh rack adds up to the balance exactly', () => {
    for (const amount of [0, 1, 4, 5, 37, 250, 999, 10_000, 12_345, 250_000]) {
      const r = rackBreakdown(amount, DENOMS);
      expect(value(r.counts) + r.odd).toBe(amount);
      expect(r.odd).toBe(0);
      expect(r.counts.every((n) => Number.isInteger(n) && n >= 0)).toBe(true);
    }
  });

  it('keeps small chips for betting instead of a couple of big ones', () => {
    const r = rackBreakdown(10_000, DENOMS);
    // Not just two $5,000 chips: there are reds and greens to bet with.
    expect(r.counts[DENOMS.indexOf(5)]).toBeGreaterThanOrEqual(5);
    expect(r.counts[DENOMS.indexOf(25)]).toBeGreaterThanOrEqual(5);
    expect(r.counts[DENOMS.indexOf(100)]).toBeGreaterThanOrEqual(5);
    expect(value(r.counts)).toBe(10_000);
  });

  it('keeps a few small chips back when there is little money', () => {
    expect(rackBreakdown(37, DENOMS).counts).toEqual([7, 6, 0, 0, 0, 0, 0]);
    expect(greedyBreakdown(37, DENOMS).counts).toEqual([2, 2, 1, 0, 0, 0, 0]);
  });

  it('leaves cents and amounts under the smallest chip as odd change', () => {
    const r = rackBreakdown(1007.5, DENOMS);
    expect(value(r.counts)).toBe(1007);
    expect(r.odd).toBe(0.5);
    const bj = [5, 25, 100, 500, 1000];
    const b = rackBreakdown(1003, bj);
    expect(value(b.counts, bj)).toBe(1000);
    expect(b.odd).toBe(3);
  });

  it('caps the chips drawn per stack', () => {
    expect(visibleStacks([3, 40, 20, 0], 20)).toEqual([3, 20, 20, 0]);
  });
});

describe('the chip wallet', () => {
  it('stays equal to the balance through payouts and bets', () => {
    const w = new ChipWallet(DENOMS);
    w.sync(10_000);
    expect(w.total).toBe(10_000);
    for (const t of [10_035, 9_985, 9_984, 12_000.5, 7, 0, 3, 2_500]) {
      w.sync(t);
      expect(w.total).toBe(t);
      expect(w.counts.every((n) => n >= 0)).toBe(true);
    }
  });

  it('a win arrives as the chips the dealer pays', () => {
    const w = new ChipWallet(DENOMS);
    w.sync(100);
    const before = [...w.counts];
    w.sync(135);
    expect(w.count(25) - before[2]).toBe(1);
    expect(w.count(5) - before[1]).toBe(2);
  });

  it('a click bet breaks a bigger chip for change when it has to', () => {
    const w = new ChipWallet(DENOMS);
    w.reset(0);
    w.sync(100); // one black chip
    expect(w.count(100)).toBe(1);
    w.sync(95); // a $5 bet: the $100 is broken
    expect(w.count(100)).toBe(0);
    expect(w.total).toBe(95);
  });

  it('taking chips moves one chip and refuses when the stack is empty', () => {
    const w = new ChipWallet(DENOMS);
    w.reset(30);
    const fives = w.count(5);
    expect(w.take(5)).toBe(true);
    expect(w.count(5)).toBe(fives - 1);
    expect(w.take(5000)).toBe(false);
    expect(w.take(7)).toBe(false);
  });
});

describe("you can't bet more than you hold", () => {
  it('the rail never gives you more chips than your balance', () => {
    const bank = new Bankroll({ balance: 137 });
    const w = new ChipWallet(DENOMS);
    w.sync(bank.balance);
    let inHand = 0;
    // Grab every chip there is, biggest first, then keep grabbing.
    for (let tries = 0; tries < 500; tries++) {
      const d = [...DENOMS].reverse().find((x) => w.count(x) > 0);
      if (d === undefined) break;
      expect(w.take(d)).toBe(true);
      inHand += d;
    }
    expect(inHand).toBe(137);
    for (const d of DENOMS) expect(w.take(d)).toBe(false);
  });

  it('chips set down go through the game, which refuses more than the bankroll', () => {
    const bank = new Bankroll({ balance: 40 });
    const craps = new CrapsGame(bank);
    craps.placeBet('pass', 25);
    expect(bank.balance).toBe(15);
    expect(() => craps.placeBet('field', 25)).toThrow(CrapsBetRejected);
    expect(() => craps.placeBet('field', 25)).toThrow(/Not enough/);
    expect(bank.balance).toBe(15);
    // Picking the bet back up (come-out) returns it to the rail.
    expect(craps.removeBet('pass')).toBe(25);
    expect(bank.balance).toBe(40);

    const bank2 = new Bankroll({ balance: 10 });
    const roulette = new RouletteGame(bank2);
    expect(() => roulette.placeBet('red', 25)).toThrow(BetRejected);
    expect(() => roulette.placeBet('red', 25)).toThrow(/Not enough/);
    expect(bank2.balance).toBe(10);
  });

  it('the wallet follows the balance as chips are placed and picked up', () => {
    const bank = new Bankroll({ balance: 500 });
    const craps = new CrapsGame(bank);
    const w = new ChipWallet(DENOMS);
    w.sync(bank.balance);
    // Hand: one green chip off the rail; the rail shows balance - what's in hand.
    expect(w.take(25)).toBe(true);
    let held = 25;
    expect(w.sync(bank.balance - held)).toBe(false);
    // Set it down on the pass line: the bet debits as the hand empties.
    craps.placeBet('pass', held);
    held = 0;
    w.sync(bank.balance - held);
    expect(w.total).toBe(475);
    // Pick it back up, drop it off the layout: it lands back on the rail.
    held = craps.removeBet('pass');
    w.sync(bank.balance - held);
    expect(w.total).toBe(475);
    held = 0;
    w.sync(bank.balance - held);
    expect(w.total).toBe(500);
  });
});
