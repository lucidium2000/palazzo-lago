import { describe, expect, it } from 'vitest';
import { Bankroll } from '../src/rules/bankroll';
import { betInfo, CrapsBetRejected, CrapsGame } from '../src/rules/craps';
import { SeededRng } from '../src/rules/rng';

const game = (balance = 10_000) => {
  const bank = new Bankroll({ balance });
  return { bank, g: new CrapsGame(bank) };
};

describe('craps bets', () => {
  it('parses bet ids', () => {
    expect(betInfo('pass')?.kind).toBe('pass');
    expect(betInfo('place6')).toMatchObject({ kind: 'place', n: 6 });
    expect(betInfo('come5')).toMatchObject({ kind: 'comePoint', n: 5 });
    expect(betInfo('dontComeOdds10')).toMatchObject({ kind: 'dontComeOdds', n: 10 });
    expect(betInfo('any7')?.kind).toBe('any7');
    expect(betInfo('hard5')).toBeNull();
    expect(betInfo('place7')).toBeNull();
  });

  it('pays the pass line on a come-out natural and loses on craps', () => {
    const { bank, g } = game(1000);
    g.placeBet('pass', 10);
    let r = g.resolve([3, 4]);
    expect(r.call).toMatch(/front line winner/);
    expect(bank.balance).toBe(1000);
    expect(g.bets.get('pass')).toBe(10); // stays up
    r = g.resolve([1, 1]);
    expect(r.results[0].outcome).toBe('lose');
    expect(bank.balance).toBe(1000); // the $10 was already on the felt
    expect(g.point).toBeNull();
  });

  it('sets a point, pays true odds, and clears the puck when the point is made', () => {
    const { bank, g } = game(1000);
    g.placeBet('pass', 10);
    g.resolve([2, 2]);
    expect(g.point).toBe(4);
    expect(() => g.placeBet('pass', 10)).toThrow(CrapsBetRejected);
    expect(g.canRemove('pass')).toBe(false);
    g.placeBet('passOdds', 30); // 3x on the 4
    expect(() => g.placeBet('passOdds', 1)).toThrow('3-4-5x');
    g.resolve([5, 6]); // no decision
    const r = g.resolve([3, 1]);
    expect(r.pointMade).toBe(true);
    // Flat 10 wins 10; odds 30 win 60 at 2:1.
    expect(r.totalWon).toBe(70);
    expect(bank.balance).toBe(1000 + 70);
    expect(g.point).toBeNull();
    expect(g.bets.size).toBe(0);
  });

  it('sevens out: line and place bets lose, don\'t wins with lay odds', () => {
    const { bank, g } = game(1000);
    g.placeBet('pass', 10);
    g.placeBet('dontPass', 10);
    g.resolve([4, 2]); // point 6
    g.placeBet('place8', 12);
    g.placeBet('dontOdds', 60); // lay 6x
    g.placeBet('hard6', 5);
    const before = bank.balance;
    const r = g.resolve([5, 2]);
    expect(r.sevenOut).toBe(true);
    expect(r.call).toMatch(/Seven out/);
    // Don't Pass 10 wins 10; lay 60 on the 6 wins 50 (5:6).
    expect(r.totalWon).toBe(60);
    expect(bank.balance).toBe(before + 10 + 10 + 60 + 50);
    expect(g.bets.size).toBe(0);
  });

  it('bars the 12 on the don\'t', () => {
    const { g } = game();
    g.placeBet('dontPass', 10);
    const r = g.resolve([6, 6]);
    expect(r.results[0].outcome).toBe('push');
    expect(g.bets.get('dontPass')).toBe(10);
  });

  it('moves come bets to their number and pays them with odds', () => {
    const { bank, g } = game(1000);
    g.placeBet('pass', 10);
    g.resolve([3, 2]); // point 5
    expect(() => g.placeBet('come', 0)).toThrow();
    g.placeBet('come', 10);
    let r = g.resolve([5, 4]);
    expect(r.results.find((x) => x.id === 'come')).toMatchObject({ outcome: 'move', to: 'come9' });
    expect(g.bets.get('come9')).toBe(10);
    g.placeBet('comeOdds9', 40); // 4x on the 9
    r = g.resolve([6, 3]);
    // Come 9: 10 + odds 40 at 3:2 = 60.
    expect(r.totalWon).toBe(70);
    expect(g.bets.has('come9')).toBe(false);
    expect(bank.balance).toBe(1000 - 10 - 10 - 40 + 10 + 10 + 40 + 60);
  });

  it('keeps come odds off on the come-out roll', () => {
    const { bank, g } = game(1000);
    g.placeBet('pass', 10);
    g.resolve([3, 3]); // point 6
    g.placeBet('come', 10);
    g.resolve([2, 2]); // come 4
    g.placeBet('comeOdds4', 20);
    g.resolve([4, 2]); // point made, back to come-out
    expect(g.point).toBeNull();
    const before = bank.balance;
    const r = g.resolve([4, 3]); // come-out seven
    expect(r.results.find((x) => x.id === 'come4')!.outcome).toBe('lose');
    expect(r.results.find((x) => x.id === 'comeOdds4')!.outcome).toBe('push');
    expect(bank.balance).toBe(before + 20); // only the odds come back
  });

  it('pays the field double on 2 and triple on 12, nothing on 5 6 7 8', () => {
    for (const [d, back] of [[[1, 1], 30], [[6, 6], 40], [[4, 5], 20], [[2, 3], 0], [[3, 4], 0]] as const) {
      const { bank, g } = game(100);
      g.placeBet('field', 10);
      g.resolve(d as [number, number]);
      expect(bank.balance).toBe(90 + back);
    }
  });

  it('pays place bets at 7:6 / 7:5 / 9:5, rounded down, and leaves them up', () => {
    const { g } = game();
    g.placeBet('pass', 10);
    g.resolve([1, 3]); // point 4
    g.placeBet('place6', 12);
    g.placeBet('place5', 10);
    g.placeBet('place10', 10);
    g.placeBet('place8', 10);
    expect(g.resolve([5, 1]).totalWon).toBe(14);
    expect(g.resolve([2, 3]).totalWon).toBe(14);
    expect(g.resolve([5, 5]).totalWon).toBe(18);
    expect(g.resolve([4, 4]).totalWon).toBe(11); // 10 on the 8 pays 11.67 → 11
    expect(g.bets.get('place6')).toBe(12);
  });

  it('works place bets and hardways off on the come-out', () => {
    const { g } = game();
    g.placeBet('place6', 12);
    g.placeBet('hard6', 5);
    const r = g.resolve([3, 3]);
    expect(r.results.filter((x) => x.outcome === 'win')).toHaveLength(0);
    expect(g.point).toBe(6);
    expect(g.resolve([3, 3]).totalWon).toBe(0 + 14 + 45 + 0); // point made: place 6 and hard 6 win
  });

  it('loses hardways on easy ways and pays one-roll props', () => {
    const { g } = game();
    g.placeBet('pass', 10);
    g.resolve([5, 5]); // point 10
    g.placeBet('hard8', 5);
    let r = g.resolve([5, 3]);
    expect(r.results.find((x) => x.id === 'hard8')!.outcome).toBe('lose');
    g.placeBet('eleven', 5);
    g.placeBet('any7', 5);
    g.placeBet('ceC', 1);
    r = g.resolve([5, 6]);
    expect(r.totalWon).toBe(75);
    expect(g.bets.has('eleven')).toBe(false);
  });

  it('checks minimums when the dice go out', () => {
    const { g } = game();
    g.placeBet('pass', 5);
    expect(() => g.roll(new SeededRng())).toThrow('Pass Line needs at least $10');
    g.placeBet('pass', 5);
    g.placeBet('two', 1);
    expect(() => g.roll(new SeededRng())).not.toThrow();
  });

  it('refuses bets at the wrong time', () => {
    const { g } = game();
    expect(() => g.placeBet('come', 10)).toThrow(/need a point/);
    expect(() => g.placeBet('passOdds', 10)).toThrow(/once a point/);
    expect(() => g.placeBet('come6', 10)).toThrow();
  });
});

describe('craps house edge (simulated)', () => {
  const edge = (setup: (g: CrapsGame) => void, rolls = 600_000, seed = 7) => {
    const bank = new Bankroll({ balance: 1e12 });
    const g = new CrapsGame(bank, { tableMin: 1, propMin: 1, max: 1e9 });
    const rng = new SeededRng(seed);
    let staked = 0;
    let won = 0;
    for (let i = 0; i < rolls; i++) {
      const before = g.totalOnTable;
      setup(g);
      staked += g.totalOnTable - before;
      const r = g.resolve([rng.int(6) + 1, rng.int(6) + 1]);
      for (const x of r.results) if (x.outcome === 'win' || x.outcome === 'lose') won += x.outcome === 'win' ? x.won : -x.stake;
    }
    return -won / staked;
  };

  it('pass line ≈ 1.41%', () => {
    expect(edge((g) => g.comeOut && !g.bets.has('pass') && g.placeBet('pass', 1))).toBeCloseTo(0.0141, 2);
  });
  it("don't pass ≈ 1.36%", () => {
    expect(edge((g) => g.comeOut && !g.bets.has('dontPass') && g.placeBet('dontPass', 1))).toBeCloseTo(0.0136, 2);
  });
  it('field ≈ 2.78% with a triple 12', () => {
    expect(edge((g) => g.placeBet('field', 1))).toBeCloseTo(0.0278, 2);
  });
  it('any seven ≈ 16.7%', () => {
    expect(edge((g) => g.placeBet('any7', 1))).toBeCloseTo(0.1667, 2);
  });
});
