import { describe, expect, it } from 'vitest';
import { Bankroll } from '../src/rules/bankroll';
import { boardValue, JACKPOTS, PIG_CAPACITY, PiggyGame, PIGGY, simulatePiggy, type Coin } from '../src/rules/piggy';
import { SeededRng, type Rng } from '../src/rules/rng';
import { windowAt } from '../src/rules/slots';

const coinCount = (stops: number[]) => PIGGY.reels.reduce((a, s, i) => a + windowAt(s, stops[i]).filter((x) => x === 'COIN').length, 0);

/** Stops showing exactly n coins (searched deterministically). */
function stopsWith(n: number): number[] {
  const rng = new SeededRng(99);
  for (let i = 0; i < 1e6; i++) {
    const stops = PIGGY.reels.map((s) => rng.int(s.length));
    if (coinCount(stops) === n) return stops;
  }
  throw new Error('none');
}

/** An Rng that always answers 0: first entry of every table, coins always land. */
const zeros: Rng = { int: () => 0 };
/** An Rng that never lands a respin coin. */
const never: Rng = { int: (m) => m - 1 };

describe('Porkbelly Payday', () => {
  it('only uses defined symbols; wilds only on reels 2–4', () => {
    const ids = new Set(PIGGY.symbols.map((s) => s.id));
    PIGGY.reels.forEach((strip, i) => {
      for (const s of strip) expect(ids).toContain(s);
      expect(strip.includes('WILD')).toBe(i >= 1 && i <= 3);
    });
  });

  it('starts Hold & Spin at 6 coins, not 5', () => {
    const g = new PiggyGame(null);
    expect(g.spin(new SeededRng(1), stopsWith(5)).triggered).toBe(false);
    expect(g.phase).toBe('idle');
    const s = g.spin(new SeededRng(1), stopsWith(6));
    expect(s.triggered).toBe(true);
    expect(g.phase).toBe('bonus');
    expect(g.bonus!.board.filter(Boolean)).toHaveLength(6);
    expect(g.bonus!.respinsLeft).toBe(3);
  });

  it('resets respins when a coin lands and pays when they run out', () => {
    const g = new PiggyGame(null);
    g.spin(new SeededRng(1), stopsWith(6));
    let r = g.respin(never);
    expect(r.respinsLeft).toBe(2);
    r = g.respin(never);
    expect(r.respinsLeft).toBe(1);
    // A respin where a coin lands: first draw lands, the rest miss.
    let first = true;
    const once: Rng = { int: (m) => (m === 10000 ? (first ? ((first = false), 0) : m - 1) : 0) };
    r = g.respin(once);
    expect(r.landed).toHaveLength(1);
    expect(r.respinsLeft).toBe(3);
    g.respin(never);
    g.respin(never);
    r = g.respin(never);
    expect(r.done).toBe(true);
    expect(r.win).toBeCloseTo(boardValue(g.bonus!.board, false).mult * g.bonus!.totalBet, 6);
  });

  it('awards the Grand when all 15 cells fill', () => {
    const g = new PiggyGame(null);
    g.spin(new SeededRng(1), stopsWith(6));
    const r = g.respin(zeros); // every empty cell lands a coin
    expect(r.done).toBe(true);
    expect(r.grand).toBe(true);
    expect(r.win).toBeGreaterThanOrEqual(JACKPOTS.GRAND * g.bonus!.totalBet);
  });

  it('feeds coins into the banks and keeps meters per bet level', () => {
    const g = new PiggyGame(null);
    const s = g.spin(new SeededRng(3), stopsWith(4));
    expect(s.fed).toHaveLength(4);
    expect(s.meters.reduce((a, b) => a + b, 0)).toBe(4);
    g.changeBet(1);
    expect(g.metersFor()).toEqual([0, 0, 0]);
    g.changeBet(-1);
    expect(g.metersFor().reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('full banks smash at bonus start and apply their powers', () => {
    const g = new PiggyGame(null);
    g.setMeter(0, PIG_CAPACITY.red);
    g.setMeter(1, PIG_CAPACITY.green);
    g.setMeter(2, PIG_CAPACITY.blue);
    g.spin(new SeededRng(5), stopsWith(6));
    const b = g.bonus!;
    expect(b.powers).toEqual({ red: true, green: true, blue: true });
    expect(b.respinsLeft).toBe(5); // green
    expect(b.blueCell).not.toBeNull();
    expect(b.board[b.blueCell!]!.jackpot).toBeDefined(); // blue
    expect(b.board.filter(Boolean)).toHaveLength(7);
    // Banks reset (new coins from this spin may have refilled them a little).
    for (const m of g.metersFor()) expect(m).toBeLessThan(10);
    while (!g.bonus!.done) g.respin(never);
    // red: cash coins doubled, jackpots not.
    const plain = g.bonus!.board.reduce((a, c) => a + (c ? (c.jackpot ? c.mult : c.mult * 2) : 0), 0);
    expect(g.bonus!.win).toBeCloseTo(plain * g.bonus!.totalBet, 6);
  });

  it('doubles only cash coins for the Red bank', () => {
    const board: (Coin | null)[] = [{ mult: 2 }, { mult: 25, jackpot: 'MINI' }, ...Array(13).fill(null)];
    expect(boardValue(board, false).mult).toBe(27);
    expect(boardValue(board, true).mult).toBe(29);
  });

  it('debits bets and credits wins through the bankroll', () => {
    const bank = new Bankroll({ balance: 100 });
    const g = new PiggyGame(bank);
    g.betIndex = 2; // $3
    const s = g.spin(new SeededRng(11));
    expect(bank.balance).toBeCloseTo(100 - 3 + s.lineWin, 6);
    const poor = new PiggyGame(new Bankroll({ balance: 0.5 }));
    expect(() => poor.spin(new SeededRng(1))).toThrow('Not enough chips');
    expect(() => g.respin(new SeededRng(1))).toThrow();
  });

  it('returns about 93% over a million spins', () => {
    const r = simulatePiggy(new SeededRng(2024), 1_000_000);
    expect(r.rtp).toBeGreaterThan(0.9);
    expect(r.rtp).toBeLessThan(0.97);
    expect(1 / r.bonusRate).toBeGreaterThan(90);
    expect(1 / r.bonusRate).toBeLessThan(180);
  }, 30_000);
});
