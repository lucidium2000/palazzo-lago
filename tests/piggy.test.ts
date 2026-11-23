import { describe, expect, it } from 'vitest';
import { Bankroll } from '../src/rules/bankroll';
import {
  apValue,
  BLUE_MAX,
  BLUE_START,
  BONUS_SPINS,
  JACKPOT_BASE,
  YELLOW_BOOST,
  JACKPOT_NEED,
  LINES_25,
  PIGGY,
  PiggyGame,
  simulatePiggy,
  type Feature,
} from '../src/rules/piggy';
import { SeededRng, type Rng } from '../src/rules/rng';
import { windowAt } from '../src/rules/slots';

const mysteryCount = (stops: number[], reels = PIGGY.reels) =>
  reels.reduce((a, s, i) => a + windowAt(s, stops[i]).filter((x) => x === 'MYSTERY').length, 0);

/** Stops showing at least n "?" symbols. */
function stopsWith(n: number, reels = PIGGY.reels): number[] {
  const rng = new SeededRng(99);
  for (let i = 0; i < 1e6; i++) {
    const stops = reels.map((s) => rng.int(s.length));
    if (mysteryCount(stops, reels) >= n) return stops;
  }
  throw new Error('none');
}

/**
 * Scripted Rng: answers `int(10000)` rolls from a queue (coin / trigger / join
 * checks), everything else from a seeded generator.
 */
function scripted(rolls: number[], seed = 1): Rng {
  const r = new SeededRng(seed);
  return { int: (m) => (m === 10000 && rolls.length ? rolls.shift()! : r.int(m)) };
}

const start = (g: PiggyGame, f: Partial<Record<Feature, boolean>>) =>
  (g as unknown as { startBonus: (f: Record<Feature, boolean>, bet: number) => void }).startBonus({ blue: false, yellow: false, red: false, ...f }, g.bet);

describe('Porkbelly Payday', () => {
  it('has 25 distinct lines and five bets from 75 to 600 credits', () => {
    expect(LINES_25).toHaveLength(25);
    expect(new Set(LINES_25.map((l) => l.join())).size).toBe(25);
    expect(PIGGY.betLevels.map((b) => Math.round(b * 100))).toEqual([75, 150, 225, 450, 600]);
  });

  it('pays the published table in line-bet units', () => {
    const pays = Object.fromEntries(PIGGY.symbols.filter((s) => s.pays).map((s) => [s.id, [s.pays![5], s.pays![4], s.pays![3]]]));
    expect(pays.BANK).toEqual([150, 100, 15]);
    expect(pays.BARS).toEqual([100, 50, 10]);
    expect(pays.VAULT).toEqual([100, 50, 10]);
    expect(pays.BAG).toEqual([75, 30, 5]);
    for (const s of ['A', 'K']) expect(pays[s]).toEqual([50, 20, 3]);
    for (const s of ['Q', 'J', 'T']) expect(pays[s]).toEqual([50, 15, 2]);
  });

  it('turns every "?" into the same symbol', () => {
    const g = new PiggyGame(null);
    const stops = stopsWith(4);
    for (let seed = 1; seed < 30; seed++) {
      const s = g.spin(new SeededRng(seed), stops);
      if (g.phase === 'bonus') g.bonus!.done = true, g.closeBonus();
      expect(s.mystery).not.toBeNull();
      const revealed = s.raw.flatMap((col, r) => col.flatMap((x, row) => (x === 'MYSTERY' ? [s.grid[r][row]] : [])));
      expect(revealed.length).toBeGreaterThanOrEqual(4);
      expect(new Set(revealed).size).toBe(1);
    }
  });

  it('coins feed the banks: blue spins, yellow jackpots, red cross-outs', () => {
    const stops = stopsWith(3);
    // Rolls per "?": coin? (0 = yes), then the first roll in the feed band.
    for (const color of ['blue', 'yellow', 'red'] as const) {
      const w = PIGGY.colorWeights;
      // Find a seed whose first coin is this colour.
      for (let seed = 1; seed < 500; seed++) {
        const g = new PiggyGame(null);
        const s = g.spin(scripted([0, PIGGY.trigger[color], ...Array(14).fill(9999)], seed), stops);
        if (s.coins[0]?.color !== color) continue;
        expect(s.coins[0].result).toBe('feed');
        const b = g.bankFor();
        if (color === 'blue') expect(b.blue).toBe(BLUE_START + 1);
        if (color === 'yellow') {
          // Exactly one of Mini/Minor/Maxi/Major grew, by 0.25x–6.75x the bet; Grand and Mega stay put.
          const boost = s.coins[0].boost!;
          expect(boost.jackpot).toBeLessThan(YELLOW_BOOST.meters);
          expect(boost.amount).toBeGreaterThanOrEqual(0.25);
          expect(boost.amount).toBeLessThanOrEqual(6.75);
          b.jackpots.forEach((v, j) => expect(v).toBeCloseTo(JACKPOT_BASE[j] + (j === boost.jackpot ? boost.amount : 0), 6));
        }
        if (color === 'red') expect(b.reds).toBe(1);
        break;
      }
      expect(w[color]).toBeGreaterThan(0);
    }
  });

  it('caps the blue bank at 100 and resets it to 9 after a Blue bonus', () => {
    const g = new PiggyGame(null);
    g.setBank({ blue: BLUE_MAX });
    const stops = stopsWith(3);
    for (let seed = 1; seed < 200; seed++) {
      g.spin(scripted([0, 9000], seed), stops);
      if (g.phase === 'bonus') g.bonus!.done = true, g.closeBonus();
    }
    expect(g.bankFor().blue).toBeLessThanOrEqual(BLUE_MAX);
    g.setBank({ blue: 33 });
    start(g, { blue: true });
    expect(g.bonus!.totalSpins).toBe(33);
    let n = 0;
    while (!g.bonus!.done) g.spin(new SeededRng(++n));
    expect(n).toBe(33);
    expect(g.bankFor().blue).toBe(BLUE_START);
  });

  it('plays 7 spins without Blue and the Blue count with it, with every feature active together', () => {
    const g = new PiggyGame(null);
    g.setBank({ blue: 21, reds: 2 });
    start(g, { yellow: true, red: true });
    expect(g.bonus!.totalSpins).toBe(BONUS_SPINS);
    g.bonus!.done = true;
    g.closeBonus();
    start(g, { blue: true, yellow: true, red: true });
    const b = g.bonus!;
    expect(b.totalSpins).toBe(21);
    expect(b.features).toEqual({ blue: true, yellow: true, red: true });
    expect(b.removed).toEqual(['T', 'J']);
  });

  it('removes crossed-out low symbols from the Red bonus reels', () => {
    const g = new PiggyGame(null);
    g.setBank({ reds: 3 });
    start(g, { red: true });
    for (const strip of g.bonus!.reels) {
      for (const x of ['T', 'J', 'Q']) expect(strip).not.toContain(x);
      expect(strip).toContain('K');
    }
    for (let i = 0; i < 300; i++) {
      const s = g.spin(new SeededRng(i));
      for (const col of s.grid) for (const x of col) expect(['T', 'J', 'Q']).not.toContain(x);
      if (g.bonus!.done) break;
    }
    expect(g.bankFor().reds).toBe(0);
  });

  it('collects jackpot coins in the Yellow bonus, pays, resets and can win again', () => {
    const bank = new Bankroll({ balance: 1000 });
    const g = new PiggyGame(bank);
    g.setBank({ jackpots: JACKPOT_BASE.map((b) => b * 2) });
    start(g, { yellow: true });
    g.bonus!.spinsLeft = 1000;
    const stops = stopsWith(3, g.bonus!.reels);
    let miniWins = 0;
    // Every "?" shows a jackpot coin (roll 0); colour comes from the seeded rolls.
    for (let i = 0; i < 400 && miniWins < 2; i++) {
      const s = g.spin(scripted([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], i), stops);
      for (const w of s.jackpotWins) {
        if (w.jackpot === 0) {
          miniWins++;
          // First Mini pays the grown value, after that the base.
          expect(w.amount).toBeCloseTo((miniWins === 1 ? 20 : 10) * g.bet, 6);
        }
        expect(g.bankFor().jackpots[w.jackpot]).toBe(JACKPOT_BASE[w.jackpot]);
      }
      for (let j = 0; j < 6; j++) expect(g.bonus!.counts[j]).toBeLessThan(JACKPOT_NEED[j]);
    }
    expect(miniWins).toBe(2);
    g.bonus!.spinsLeft = 1;
    g.spin(new SeededRng(5));
    expect(g.bankFor().jackpots).toEqual(JACKPOT_BASE);
  });

  it('keeps banks per bet level and cycles the five bets', () => {
    const g = new PiggyGame(null);
    g.setBank({ blue: 40 });
    g.changeBet(1);
    expect(g.bankFor().blue).toBe(BLUE_START);
    for (let i = 0; i < 4; i++) g.changeBet(1);
    expect(g.betIndex).toBe(0);
    expect(g.bankFor().blue).toBe(40);
  });

  it('randomizes banks the way a previous player might leave them', () => {
    const g = new PiggyGame(null);
    g.randomizeBanks(new SeededRng(4));
    for (let i = 0; i < 5; i++) {
      const b = g.bankFor(i);
      expect(b.blue).toBeGreaterThanOrEqual(BLUE_START);
      expect(b.blue).toBeLessThanOrEqual(BLUE_MAX);
      expect(b.reds).toBeLessThanOrEqual(3);
    }
  });

  it('debits paid spins, not free spins, and credits every win', () => {
    const bank = new Bankroll({ balance: 100 });
    const g = new PiggyGame(bank);
    g.betIndex = 4; // $6
    const s = g.spin(new SeededRng(11));
    expect(bank.balance).toBeCloseTo(100 - 6 + s.win, 6);
    if (g.phase === 'bonus') g.bonus!.done = true, g.closeBonus();
    start(g, {});
    const before = bank.balance;
    const f = g.spin(new SeededRng(12));
    expect(f.free).toBe(true);
    expect(bank.balance).toBeCloseTo(before + f.win, 6);
    const poor = new PiggyGame(new Bankroll({ balance: 0.5 }));
    expect(() => poor.spin(new SeededRng(1))).toThrow('Not enough chips');
  });

  it('returns about 88–92% from fresh banks', () => {
    const r = simulatePiggy(new SeededRng(2024), 800_000);
    expect(r.rtp).toBeGreaterThan(0.86);
    expect(r.rtp).toBeLessThan(0.94);
    expect(1 / r.bonusRate).toBeGreaterThan(70);
    expect(1 / r.bonusRate).toBeLessThan(150);
  }, 30_000);

  it('is worth more with a fat Blue bank', () => {
    const lo = apValue(new SeededRng(1), BLUE_START, 3000).rtp;
    const hi = apValue(new SeededRng(2), 40, 3000).rtp;
    expect(hi).toBeGreaterThan(lo + 0.15);
    expect(hi).toBeGreaterThan(1);
  }, 30_000);
});
