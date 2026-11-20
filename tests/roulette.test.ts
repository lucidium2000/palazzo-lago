import { describe, expect, it } from 'vitest';
import { Bankroll } from '../src/rules/bankroll';
import {
  BET_SPOTS,
  BetRejected,
  DOUBLE_ZERO,
  pocketColor,
  POCKET_COUNT,
  RouletteGame,
  spotFor,
  WHEEL_ORDER,
} from '../src/rules/roulette';
import { SeededRng, type Rng } from '../src/rules/rng';

const fixed = (index: number): Rng => ({ int: () => index });
const indexOf = (p: number) => WHEEL_ORDER.indexOf(p);

describe('roulette wheel', () => {
  it('has 38 unique pockets', () => {
    expect(new Set(WHEEL_ORDER).size).toBe(POCKET_COUNT);
    expect(WHEEL_ORDER).toContain(DOUBLE_ZERO);
  });

  it('has 18 red, 18 black, 2 green', () => {
    const colors = WHEEL_ORDER.map(pocketColor);
    expect(colors.filter((c) => c === 'red')).toHaveLength(18);
    expect(colors.filter((c) => c === 'black')).toHaveLength(18);
    expect(colors.filter((c) => c === 'green')).toHaveLength(2);
  });

  it('alternates red and black between the zeros', () => {
    for (let i = 1; i < WHEEL_ORDER.length; i++) {
      const a = pocketColor(WHEEL_ORDER[i - 1]);
      const b = pocketColor(WHEEL_ORDER[i]);
      if (a !== 'green' && b !== 'green') expect(a).not.toBe(b);
    }
  });
});

describe('bet spots', () => {
  it('pay standard Vegas odds with a 5.26% house edge (7.89% on the top line)', () => {
    for (const s of BET_SPOTS) {
      const ev = (s.numbers.length / 38) * (s.payout + 1) - 1;
      const edge = s.kind === 'topline' ? -3 / 38 : -2 / 38;
      expect(ev, s.id).toBeCloseTo(edge, 10);
    }
  });

  it('has the right number of each inside bet', () => {
    const count = (k: string) => BET_SPOTS.filter((s) => s.kind === k).length;
    expect(count('straight')).toBe(38);
    expect(count('split')).toBe(57 + 5);
    expect(count('street')).toBe(12);
    expect(count('corner')).toBe(22);
    expect(count('sixline')).toBe(11);
    expect(count('trio')).toBe(2);
    expect(count('topline')).toBe(1);
  });

  it('has unique ids', () => {
    expect(new Set(BET_SPOTS.map((s) => s.id)).size).toBe(BET_SPOTS.length);
  });

  it('finds spots by numbers in any order', () => {
    expect(spotFor('split', [20, 17])?.id).toBe('split:17-20');
    expect(spotFor('split', [17, 19])).toBeUndefined();
  });
});

describe('RouletteGame', () => {
  it('takes chips when bets are placed and pays winners with stake', () => {
    const bank = new Bankroll({ balance: 1000 });
    const g = new RouletteGame(bank);
    g.placeBet('straight:17', 10);
    g.placeBet('red', 50);
    g.placeBet('black', 20);
    expect(bank.balance).toBe(920);
    g.spin(fixed(indexOf(17))); // 17 is black
    const r = g.settle();
    expect(r.pocket).toBe(17);
    expect(r.totalReturned).toBe(10 * 36 + 20 * 2);
    expect(bank.balance).toBe(920 + 400);
    expect(g.bets.size).toBe(0);
    expect(g.history[0]).toBe(17);
  });

  it('loses outside bets on zero and double zero', () => {
    for (const p of [0, DOUBLE_ZERO]) {
      const bank = new Bankroll({ balance: 100 });
      const g = new RouletteGame(bank);
      g.placeBet('red', 50);
      g.placeBet('black', 50);
      g.spin(fixed(indexOf(p)));
      expect(g.settle().totalReturned).toBe(0);
    }
  });

  it('pays the top line 6 to 1', () => {
    const bank = new Bankroll({ balance: 100 });
    const g = new RouletteGame(bank);
    g.placeBet('topline:0-1-2-3-00', 10);
    g.spin(fixed(indexOf(DOUBLE_ZERO)));
    expect(g.settle().totalReturned).toBe(70);
  });

  it('enforces limits and bankroll', () => {
    const bank = new Bankroll({ balance: 100 });
    const g = new RouletteGame(bank);
    expect(() => g.placeBet('red', 101)).toThrow(BetRejected);
    expect(() => g.placeBet('nope', 1)).toThrow(BetRejected);
    expect(() => g.placeBet('red', 0.5)).toThrow(BetRejected);
    expect(() => g.spin(new SeededRng())).toThrow('Place a bet first');
    g.placeBet('red', 5);
    g.spin(new SeededRng());
    expect(() => g.placeBet('red', 5)).toThrow('No more bets');
  });

  it('refunds cleared bets and supports rebet', () => {
    const bank = new Bankroll({ balance: 100 });
    const g = new RouletteGame(bank);
    g.placeBet('straight:5', 5);
    g.placeBet('odd', 5);
    expect(g.clearBets()).toBe(10);
    expect(bank.balance).toBe(100);
    g.placeBet('odd', 5);
    g.spin(fixed(indexOf(2)));
    g.settle();
    expect(g.canRebet).toBe(true);
    expect(g.rebet()).toBe(true);
    expect(g.bets.get('odd')).toBe(5);
  });

  it('returns about 94.7% over many spins', () => {
    const bank = new Bankroll({ balance: 1e9 });
    const g = new RouletteGame(bank, { minBet: 1, maxInside: 1e9, maxOutside: 1e9, maxTotal: 1e9 });
    const rng = new SeededRng(42);
    let staked = 0;
    let back = 0;
    for (let i = 0; i < 200_000; i++) {
      g.placeBet('red', 1);
      g.spin(rng);
      const r = g.settle();
      staked += r.totalStaked;
      back += r.totalReturned;
    }
    expect(back / staked).toBeGreaterThan(0.94);
    expect(back / staked).toBeLessThan(0.955);
  });
});
