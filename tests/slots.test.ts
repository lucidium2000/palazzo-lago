import { describe, expect, it } from 'vitest';
import { Bankroll, InsufficientFunds } from '../src/rules/bankroll';
import { DIAMOND_SEVENS, LAGO_FORTUNA, MACHINES, ROYAL_CONSERVATORY } from '../src/rules/machines';
import {
  analyzeMachine,
  evaluateLine,
  maxPerWindow,
  outcomeForStops,
  SlotGame,
  spinMachine,
  symbolMap,
} from '../src/rules/slots';
import { SeededRng } from '../src/rules/rng';

describe.each(MACHINES.map((m) => [m.name, m] as const))('%s', (_name, m) => {
  it('hits its target RTP within 0.1%', () => {
    expect(Math.abs(analyzeMachine(m).rtp - m.targetRtp)).toBeLessThan(0.001);
  });

  it('only uses symbols it defines', () => {
    const ids = new Set(m.symbols.map((s) => s.id));
    for (const strip of m.reels) for (const s of strip) expect(ids).toContain(s);
  });

  it('never shows two scatter or bonus symbols on one reel', () => {
    const defs = symbolMap(m);
    for (const strip of m.reels) {
      expect(maxPerWindow(strip, defs, 'scatter')).toBeLessThanOrEqual(1);
      expect(maxPerWindow(strip, defs, 'bonus')).toBeLessThanOrEqual(1);
    }
  });

  it('agrees with a Monte Carlo run of the base game', () => {
    // Without the feature the variance is low enough for a tight check.
    const a = analyzeMachine(m);
    const rng = new SeededRng(99);
    const n = m.type === 'classic' ? 2_000_000 : 400_000;
    let won = 0;
    for (let i = 0; i < n; i++) won += spinMachine(m, rng, 20).win;
    const base = a.lineRtp + a.scatterRtp;
    expect(Math.abs(won / (n * 20) - base)).toBeLessThan(m.type === 'classic' ? 0.02 : 0.025);
  });
});

describe('line evaluation', () => {
  const defs = symbolMap(LAGO_FORTUNA);
  it('substitutes wilds and pays the best of wild-run and symbol-run', () => {
    expect(evaluateLine(['WILD', 'LION', 'LION', 'A', 'K'], defs)).toMatchObject({ symbol: 'LION', count: 3 });
    expect(evaluateLine(['WILD', 'WILD', 'WILD', 'T', 'K'], defs)).toMatchObject({ symbol: 'WILD', count: 3 });
    expect(evaluateLine(['A', 'WILD', 'A', 'WILD', 'A'], defs)).toMatchObject({ symbol: 'A', count: 5 });
    expect(evaluateLine(['A', 'K', 'A', 'A', 'A'], defs)).toBeNull();
    expect(evaluateLine(['FOUNTAIN', 'A', 'A', 'A', 'A'], defs)).toBeNull();
  });
});

describe('SlotGame', () => {
  it('debits the bet and credits wins', () => {
    const bank = new Bankroll({ balance: 100 });
    const g = new SlotGame(DIAMOND_SEVENS, bank);
    const out = g.spin(new SeededRng(3));
    expect(bank.balance).toBeCloseTo(100 - 1 + out.win, 2);
  });

  it('refuses a spin it cannot afford', () => {
    const bank = new Bankroll({ balance: 0 });
    const g = new SlotGame(DIAMOND_SEVENS, bank);
    expect(() => g.spin(new SeededRng())).toThrow();
    expect(() => bank.debit(1, 'bet')).toThrow(InsufficientFunds);
  });

  it('runs free spins at no cost with the multiplier', () => {
    const bank = new Bankroll({ balance: 1000 });
    const g = new SlotGame(LAGO_FORTUNA, bank);
    const rng = new SeededRng(5);
    let guard = 0;
    while (g.phase !== 'freeSpins' && guard++ < 10_000) g.spin(rng);
    expect(g.phase).toBe('freeSpins');
    expect(g.freeSpinsLeft).toBeGreaterThanOrEqual(10);
    const before = bank.snapshot().stats.totalWagered;
    while (g.phase === 'freeSpins') g.spin(rng);
    expect(bank.snapshot().stats.totalWagered).toBe(before);
  });

  it('runs the pick bonus and pays each tile', () => {
    const bank = new Bankroll({ balance: 100_000 });
    const g = new SlotGame(ROYAL_CONSERVATORY, bank);
    const rng = new SeededRng(8);
    let guard = 0;
    while (g.phase !== 'pick' && guard++ < 50_000) g.spin(rng);
    expect(g.phase).toBe('pick');
    const st = g.pickState!;
    expect([...st.prizes].sort((a, b) => a - b)).toEqual(
      [...ROYAL_CONSERVATORY.feature.type === 'pick' ? ROYAL_CONSERVATORY.feature.prizes : []].sort((a, b) => a - b),
    );
    const bal = bank.balance;
    const won = g.pick(0) + g.pick(0) + g.pick(5) + g.pick(7);
    expect(st.revealed).toEqual([0, 5, 7]);
    expect(bank.balance).toBeCloseTo(bal + won, 2);
    expect(g.phase).toBe('idle');
  });

  it('builds the 3-row window around each stop', () => {
    const out = outcomeForStops(DIAMOND_SEVENS, [0, 0, 0], 1);
    expect(out.grid).toHaveLength(3);
    expect(out.grid[0][1]).toBe(DIAMOND_SEVENS.reels[0][0]);
    expect(out.grid[0][0]).toBe(DIAMOND_SEVENS.reels[0].at(-1));
  });
});
