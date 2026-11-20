import { describe, expect, it } from 'vitest';
import { Bankroll, DAILY_BONUS, STARTING_BALANCE } from '../src/rules/bankroll';

describe('Bankroll', () => {
  it('starts with the default balance and tracks stats', () => {
    const b = new Bankroll();
    expect(b.balance).toBe(STARTING_BALANCE);
    b.debit(100, 'bet');
    b.credit(250, 'win');
    expect(b.balance).toBe(STARTING_BALANCE + 150);
    expect(b.stats).toMatchObject({ totalWagered: 100, totalWon: 250, biggestWin: 250 });
  });

  it('notifies listeners', () => {
    const b = new Bankroll({ balance: 10 });
    const seen: number[] = [];
    b.onChange((c) => seen.push(c.delta));
    b.debit(4, 'bet');
    b.credit(1, 'refund');
    expect(seen).toEqual([-4, 1]);
  });

  it('rejects bad amounts', () => {
    const b = new Bankroll();
    expect(() => b.debit(-1, 'bet')).toThrow();
    expect(() => b.debit(0.001, 'bet')).toThrow();
    expect(() => b.credit(NaN, 'win')).toThrow();
  });

  it('grants the daily bonus once per day', () => {
    const b = new Bankroll({ balance: 0 });
    expect(b.claimDailyBonus('2026-11-20')).toBe(DAILY_BONUS);
    expect(b.claimDailyBonus('2026-11-20')).toBe(0);
    expect(b.claimDailyBonus('2026-11-21')).toBe(DAILY_BONUS);
  });
});
