import { describe, expect, it } from 'vitest';
import { Bankroll } from '../src/rules/bankroll';
import {
  apValue,
  BASE_FREE_GAMES,
  extraWildsFor,
  FREE_DROP,
  freeGamesFor,
  freeReels,
  JACKPOT_BASE,
  JACKPOT_MAX,
  JACKPOT_NEED,
  JACKPOT_RATE,
  jackpotCoinsFor,
  LINES_25,
  PIGGY,
  PiggyGame,
  POT_MAX,
  simulatePiggy,
  type Feature,
  type Modifiers,
} from '../src/rules/piggy';
import { SeededRng, type Rng } from '../src/rules/rng';
import { windowAt } from '../src/rules/slots';

const coinCount = (stops: number[], reels: readonly (readonly string[])[] = PIGGY.reels) =>
  reels.reduce((a, s, i) => a + windowAt(s, stops[i]).filter((x) => x === 'COIN').length, 0);

/** Stops showing at least n pig coins. */
function stopsWith(n: number, reels: readonly (readonly string[])[] = PIGGY.reels): number[] {
  const rng = new SeededRng(99);
  for (let i = 0; i < 1e6; i++) {
    const stops = reels.map((s) => rng.int(s.length));
    if (coinCount(stops, reels) >= n) return stops;
  }
  throw new Error('none');
}

/**
 * Scripted Rng: answers `int(10000)` rolls (trigger / fill / join checks)
 * from a queue and colour picks from `colors`; everything else seeded.
 */
function scripted(rolls: number[], colors: Feature[] = [], seed = 1): Rng {
  const r = new SeededRng(seed);
  const total = Object.values(PIGGY.colorWeights).reduce((a, b) => a + b, 0);
  const at: Record<Feature, number> = { blue: 0, yellow: PIGGY.colorWeights.blue, red: PIGGY.colorWeights.blue + PIGGY.colorWeights.yellow };
  return {
    int: (m) => {
      if (m === 10000 && rolls.length) return rolls.shift()!;
      if (m === total && colors.length) return at[colors.shift()!];
      return r.int(m);
    },
  };
}

/** One roll per coin on screen: `first` for the first coin, 9999 (bounce off) for the rest. */
const coinRolls = (stops: number[], first: number) => [first, ...Array(coinCount(stops) - 1).fill(9999)];
const same = (stops: number[], c: Feature) => Array(coinCount(stops)).fill(c);

const mods = (f: Partial<Record<Feature, number>>): Modifiers => ({
  features: { blue: 'blue' in f, yellow: 'yellow' in f, red: 'red' in f },
  levels: { blue: f.blue ?? 0, yellow: f.yellow ?? 0, red: f.red ?? 0 },
});
const start = (g: PiggyGame, f: Partial<Record<Feature, number>>) =>
  (g as unknown as { startBonus: (m: Modifiers, bet: number) => void }).startBonus(mods(f), g.bet);

describe('Porkbelly Payday', () => {
  it('has 25 distinct lines and five bets from 75 to 600 credits', () => {
    expect(LINES_25).toHaveLength(25);
    expect(new Set(LINES_25.map((l) => l.join())).size).toBe(25);
    expect(PIGGY.betLevels.map((b) => Math.round(b * 100))).toEqual([75, 150, 225, 450, 600]);
  });

  it('pays the published table in line-bet units', () => {
    const pays = Object.fromEntries(PIGGY.symbols.filter((s) => s.pays).map((s) => [s.id, [s.pays![5], s.pays![4], s.pays![3]]]));
    expect(pays.HULA).toEqual([500, 200, 40]);
    expect(pays.TIKI).toEqual([300, 120, 30]);
    expect(pays.DRINK).toEqual([250, 100, 25]);
    expect(pays.BALL).toEqual([200, 75, 20]);
    for (const s of ['A', 'K']) expect(pays[s]).toEqual([150, 50, 12]);
    for (const s of ['Q', 'J', 'T']) expect(pays[s]).toEqual([120, 35, 10]);
  });

  it('shows at most one pig coin per reel', () => {
    for (const strip of PIGGY.reels) for (let i = 0; i < strip.length; i++) expect(windowAt(strip, i).filter((x) => x === 'COIN').length).toBeLessThanOrEqual(1);
  });

  it('coins fill their own pot one level at a time', () => {
    const stops = stopsWith(2);
    for (const color of ['blue', 'yellow', 'red'] as const) {
      const g = new PiggyGame(null);
      // First coin fills (roll just past the trigger band), the rest bounce off.
      const s = g.spin(scripted(coinRolls(stops, PIGGY.trigger[color]), same(stops, color)), stops);
      expect(s.coins[0]).toMatchObject({ color, result: 'feed' });
      expect(s.coins.slice(1).every((c) => c.result === 'none')).toBe(true);
      expect(g.bankFor().pots[color]).toBe(1);
      expect(s.bank.pots[color]).toBe(1);
      expect(g.phase).toBe('idle');
    }
  });

  it('a trigger coin or a full pot starts free games at the pot level', () => {
    const stops = stopsWith(1);
    // Trigger coin: blue at 4 goes to 5 and off.
    let g = new PiggyGame(null);
    g.setBank({ pots: { blue: 4 } });
    let s = g.spin(scripted(coinRolls(stops, 0), ['blue', ...same(stops, 'red')]), stops);
    expect(s.triggered!.features.blue).toBe(true);
    expect(s.triggered!.levels.blue).toBe(5);
    expect(g.bonus!.totalSpins).toBe(freeGamesFor(5));
    expect(g.bankFor().pots.blue).toBe(0);
    // Full pot: red at POT_MAX - 1 fills up.
    g = new PiggyGame(null);
    g.setBank({ pots: { red: POT_MAX - 1 } });
    s = g.spin(scripted(coinRolls(stops, PIGGY.trigger.red), ['red', ...same(stops, 'blue')]), stops);
    expect(s.coins[0].result).toBe('trigger');
    expect(s.triggered!.levels.red).toBe(POT_MAX);
    expect(g.bonus!.extraWilds).toBe(extraWildsFor(POT_MAX));
    expect(g.bonus!.totalSpins).toBe(BASE_FREE_GAMES);
  });

  it('other pots join with their own level, and the modifiers combine', () => {
    const stops = stopsWith(1);
    const g = new PiggyGame(null);
    g.setBank({ pots: { blue: 7, yellow: 3, red: 0 } });
    // Yellow triggers; blue joins (roll 0), red is empty so it can't.
    g.spin(scripted([...coinRolls(stops, 0), 0], same(stops, 'yellow')), stops);
    const b = g.bonus!;
    expect(b.features).toEqual({ blue: true, yellow: true, red: false });
    expect(b.levels).toMatchObject({ blue: 7, yellow: 4 });
    expect(b.totalSpins).toBe(13);
    expect(g.bankFor().pots).toEqual({ blue: 0, yellow: 0, red: 0 });
  });

  it('builds the free-games reels from the modifiers', () => {
    const plain = freeReels(mods({ blue: 3 }));
    for (const s of plain) {
      expect(s).not.toContain('COIN');
      for (const x of FREE_DROP) expect(s).not.toContain(x);
    }
    const wild = freeReels(mods({ red: 9 }));
    const wildsOn = (r: string[][]) => r.map((s) => s.filter((x) => x === 'WILD').length);
    const added = wildsOn(wild).map((n, i) => n - wildsOn(plain)[i]);
    expect(added[0]).toBe(0);
    for (const n of added.slice(1)) expect(n).toBe(Math.ceil(extraWildsFor(9) / 3));
    const jp = freeReels(mods({ yellow: 9 }));
    for (const s of jp) expect(s.filter((x) => x === 'COIN').length).toBe(jackpotCoinsFor(9));
  });

  it('plays the right number of free games without charging', () => {
    const bank = new Bankroll({ balance: 100 });
    const g = new PiggyGame(bank);
    start(g, { blue: 9, red: 2 });
    expect(g.bonus!.totalSpins).toBe(15);
    let n = 0;
    const before = bank.balance;
    let won = 0;
    while (!g.bonus!.done) {
      const s = g.spin(new SeededRng(++n));
      expect(s.free).toBe(true);
      expect(s.coins).toEqual([]);
      won += s.win;
    }
    expect(n).toBe(15);
    expect(bank.balance).toBeCloseTo(before + won, 6);
    g.closeBonus();
    expect(g.phase).toBe('idle');
  });

  it('collects jackpot coins in Jackpot Free Games, pays, resets and can win again', () => {
    const bank = new Bankroll({ balance: 1000 });
    const g = new PiggyGame(bank);
    g.setBank({ jackpots: JACKPOT_BASE.map((b) => b * 2) });
    start(g, { yellow: 9 });
    g.bonus!.spinsLeft = 100000;
    const stops = stopsWith(3, g.bonus!.reels);
    let miniWins = 0;
    for (let i = 0; i < 2000 && miniWins < 2; i++) {
      const s = g.spin(new SeededRng(i), stops);
      expect(s.jackpotCoins.length).toBeGreaterThanOrEqual(3);
      for (const w of s.jackpotWins) {
        if (w.jackpot === 0) {
          miniWins++;
          expect(w.amount).toBeCloseTo((miniWins === 1 ? 20 : 10) * g.bet, 6);
        }
        expect(g.bankFor().jackpots[w.jackpot]).toBe(JACKPOT_BASE[w.jackpot]);
      }
      for (let j = 0; j < 5; j++) expect(g.bonus!.counts[j]).toBeLessThan(JACKPOT_NEED);
    }
    expect(miniWins).toBe(2);
  });

  it('progressives tick up with every paid spin, not free games, and stop at their caps', () => {
    const g = new PiggyGame(null);
    g.spin(new SeededRng(3), stopsWith(0));
    if (g.phase === 'bonus') g.bonus!.done = true, g.closeBonus();
    g.bankFor().jackpots.forEach((v, j) => expect(v).toBeCloseTo(JACKPOT_BASE[j] + JACKPOT_RATE[j], 9));
    start(g, { red: 1 });
    const before = [...g.bankFor().jackpots];
    g.spin(new SeededRng(4));
    expect(g.bankFor().jackpots).toEqual(before);
    g.bonus!.done = true;
    g.closeBonus();
    g.setBank({ jackpots: [...JACKPOT_MAX] });
    g.spin(new SeededRng(5));
    if (g.phase === 'bonus') g.bonus!.done = true, g.closeBonus();
    expect(g.bankFor().jackpots).toEqual(JACKPOT_MAX);
  });

  it('keeps pots per bet level and cycles the five bets', () => {
    const g = new PiggyGame(null);
    g.setBank({ pots: { blue: 6 } });
    g.changeBet(1);
    expect(g.bankFor().pots.blue).toBe(0);
    for (let i = 0; i < 4; i++) g.changeBet(1);
    expect(g.betIndex).toBe(0);
    expect(g.bankFor().pots.blue).toBe(6);
  });

  it('randomizes pots the way a previous player might leave them', () => {
    const g = new PiggyGame(null);
    g.randomizeBanks(new SeededRng(4));
    for (let i = 0; i < 5; i++) {
      const b = g.bankFor(i);
      for (const v of Object.values(b.pots)) expect(v).toBeLessThan(POT_MAX - 1);
      b.jackpots.forEach((v, j) => expect(v).toBeGreaterThanOrEqual(JACKPOT_BASE[j]));
    }
  });

  it('debits paid spins and credits every win', () => {
    const bank = new Bankroll({ balance: 100 });
    const g = new PiggyGame(bank);
    g.betIndex = 4; // $6
    const s = g.spin(new SeededRng(11));
    expect(bank.balance).toBeCloseTo(100 - 6 + s.win, 6);
    const poor = new PiggyGame(new Bankroll({ balance: 0.5 }));
    expect(() => poor.spin(new SeededRng(1))).toThrow('Not enough chips');
  });

  it('returns about 92–96% with free games every 80–150 spins', () => {
    const r = simulatePiggy(new SeededRng(2024), 400_000);
    expect(r.rtp).toBeGreaterThan(0.91);
    expect(r.rtp).toBeLessThan(0.975);
    expect(r.baseRtp).toBeGreaterThan(0.55);
    expect(r.jackpotRtp).toBeGreaterThan(0.03);
    expect(1 / r.bonusRate).toBeGreaterThan(80);
    expect(1 / r.bonusRate).toBeLessThan(150);
    expect(r.hitRate).toBeGreaterThan(0.25);
    // Every combination of pots turns up.
    expect(Object.keys(r.combos).length).toBe(7);
  }, 120_000);

  it('is worth much more with fat pots', () => {
    const lo = apValue(new SeededRng(1), {}, 1500).rtp;
    const hi = apValue(new SeededRng(2), { blue: 8, red: 8 }, 1500).rtp;
    expect(hi).toBeGreaterThan(lo + 0.5);
    expect(hi).toBeGreaterThan(1);
  }, 120_000);
});
