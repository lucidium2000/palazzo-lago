import type { Bankroll } from './bankroll';
import type { Rng } from './rng';
import { buildStrip, LINES_20 } from './machines';
import { evaluateLine, windowAt, type SymbolDef } from './slots';

/**
 * Porkbelly Payday (Luau edition): an original beach-party take on the generic
 * "three pots" piggy-bank slot (mechanics are genre conventions; the name,
 * characters and art are our own).
 *
 * Base game: 5 reels x 3 rows, 25 lines, pays are multiples of the line bet.
 * Pig coins land on the reels (at most one per reel). Each coin is Blue,
 * Yellow or Red and flies to that piggy's pot. A coin either fills the pot one
 * level, sets the pot off (a trigger coin), or bounces off. A pot that reaches
 * its top level also goes off.
 *
 * Each pot powers one free-games modifier, and its strength is the pot's level
 * (1..9) when it goes off:
 *   Blue   – EXTRA FREE GAMES: 6 + level free games (7..15). Without Blue: 6.
 *   Yellow – JACKPOT FREE GAMES: jackpot coins land in the free games (more of
 *            them the fuller the pot); 3 of a tier wins that progressive.
 *   Red    – EXTRA WILDS: 6 + level extra wilds (7..15) added to reels 2–5.
 * When a pot goes off, each other pot joins in with a chance that grows with
 * its level, and the modifiers combine. Pots that went off empty afterwards.
 *
 * Five progressive jackpots (Mini, Minor, Major, Grand, Mega) tick up with
 * every paid spin and reset to their base when won. Pots and jackpots are kept
 * per bet level, as on the casino floor, so a machine can be left with a fat
 * pig: the advantage-play hook.
 */

export type CoinColor = 'blue' | 'yellow' | 'red';
export const COLORS: readonly CoinColor[] = ['blue', 'yellow', 'red'];
export type Feature = CoinColor;

export const JACKPOT_NAMES = ['MINI', 'MINOR', 'MAJOR', 'GRAND', 'MEGA'] as const;
export type JackpotName = (typeof JACKPOT_NAMES)[number];
/** Starting jackpot values, multiples of the total bet. */
export const JACKPOT_BASE = [10, 25, 100, 500, 2500];
/** Jackpots stop growing here (Mega tops out at 10,000x the bet). */
export const JACKPOT_MAX = [30, 75, 300, 1500, 10000];
/** What each paid spin adds to each meter, as a fraction of the bet. */
export const JACKPOT_RATE = [0.008, 0.006, 0.004, 0.003, 0.002];
/** Matching jackpot coins needed to win a jackpot in Jackpot Free Games. */
export const JACKPOT_NEED = 3;

/** Pot levels: a pot that reaches POT_MAX goes off. */
export const POT_MAX = 9;
export const BASE_FREE_GAMES = 6;
export const freeGamesFor = (blueLevel: number) => BASE_FREE_GAMES + blueLevel;
export const extraWildsFor = (redLevel: number) => 6 + redLevel;
/** Extra jackpot coins per reel in Jackpot Free Games. */
export const jackpotCoinsFor = (yellowLevel: number) => 1 + Math.floor(yellowLevel / 5);

export const PIGGY_SYMBOLS: SymbolDef[] = [
  { id: 'WILD', name: 'Surfboard Wild', kind: 'wild' },
  { id: 'HULA', name: 'Hula Piggy', kind: 'line', pays: { 3: 40, 4: 200, 5: 500 } },
  { id: 'TIKI', name: 'Tiki Mask', kind: 'line', pays: { 3: 30, 4: 120, 5: 300 } },
  { id: 'DRINK', name: 'Coconut Cooler', kind: 'line', pays: { 3: 25, 4: 100, 5: 250 } },
  { id: 'BALL', name: 'Beach Ball', kind: 'line', pays: { 3: 20, 4: 75, 5: 200 } },
  { id: 'A', name: 'Ace', kind: 'line', pays: { 3: 12, 4: 50, 5: 150 } },
  { id: 'K', name: 'King', kind: 'line', pays: { 3: 12, 4: 50, 5: 150 } },
  { id: 'Q', name: 'Queen', kind: 'line', pays: { 3: 10, 4: 35, 5: 120 } },
  { id: 'J', name: 'Jack', kind: 'line', pays: { 3: 10, 4: 35, 5: 120 } },
  { id: 'T', name: 'Ten', kind: 'line', pays: { 3: 10, 4: 35, 5: 120 } },
  { id: 'COIN', name: 'Pig Coin', kind: 'bonus' },
];
const DEFS = new Map(PIGGY_SYMBOLS.map((s) => [s.id, s]));

/** 25 lines: the shared 20 plus five more. */
export const LINES_25: number[][] = [
  ...LINES_20,
  [2, 0, 2, 0, 2],
  [0, 2, 2, 2, 0],
  [2, 0, 0, 0, 2],
  [1, 2, 0, 2, 1],
  [1, 0, 2, 0, 1],
];

/** Inserts `n` copies of `id` evenly round a strip, never two within 3 places when it can help it. */
function sprinkle(strip: readonly string[], id: string, n: number, phase = 0): string[] {
  const out = [...strip];
  if (n <= 0) return out;
  const len = out.length;
  for (let k = n - 1; k >= 0; k--) out.splice((Math.floor(((k + phase / 7) * len) / n) + 1) % (len + 1), 0, id);
  return out;
}

const BASE = { HULA: 3, TIKI: 4, DRINK: 4, BALL: 5, A: 6, K: 6, Q: 7, J: 7, T: 7 };

export const PIGGY = {
  id: 'porkbelly-payday',
  name: 'Porkbelly Payday',
  tagline: 'Fill the three piggy pots · combine them for bigger free games',
  rows: 3,
  lines: LINES_25,
  /** 75/150/225/450/600 credits at 1¢. */
  betLevels: [0.75, 1.5, 2.25, 4.5, 6] as readonly number[],
  symbols: PIGGY_SYMBOLS,
  reels: [
    sprinkle(buildStrip({ ...BASE }, [], 61), 'COIN', 1, 0),
    sprinkle(buildStrip({ ...BASE, WILD: 3 }, [], 62), 'COIN', 1, 2),
    sprinkle(buildStrip({ ...BASE, WILD: 3 }, [], 63), 'COIN', 1, 4),
    sprinkle(buildStrip({ ...BASE, WILD: 3 }, [], 64), 'COIN', 1, 1),
    sprinkle(buildStrip({ ...BASE, WILD: 2 }, [], 65), 'COIN', 1, 3),
  ] as readonly (readonly string[])[],
  colorWeights: { blue: 34, yellow: 33, red: 33 } as Record<CoinColor, number>,
  /** Per coin, per 10,000: set the pot off, else fill it one level. */
  trigger: { blue: 180, yellow: 180, red: 180 } as Record<CoinColor, number>,
  feed: { blue: 3000, yellow: 3000, red: 3000 } as Record<CoinColor, number>,
  /** Per 10,000, per level: another pot joins in when one goes off. */
  joinPerLevel: 550,
  /** Jackpot Free Games: tier of each jackpot coin, by weight. */
  jackpotWeights: [640, 260, 75, 20, 5],
};

export interface BankState {
  /** Pot levels, 0..POT_MAX. */
  pots: Record<CoinColor, number>;
  /** Current jackpot values, multiples of the total bet. */
  jackpots: number[];
}

export const freshBank = (): BankState => ({ pots: { blue: 0, yellow: 0, red: 0 }, jackpots: [...JACKPOT_BASE] });

export interface CoinEvent {
  reel: number;
  row: number;
  color: CoinColor;
  result: 'trigger' | 'feed' | 'none';
}

export interface JackpotCoin {
  reel: number;
  row: number;
  jackpot: number;
}

export interface PiggyLineWin {
  line: number;
  symbol: string;
  count: number;
  amount: number;
  cells: [number, number][];
}

/** Which modifiers are on and how strong (the pot levels when they went off). */
export interface Modifiers {
  features: Record<Feature, boolean>;
  levels: Record<Feature, number>;
}

export interface BonusState extends Modifiers {
  spinsLeft: number;
  totalSpins: number;
  totalBet: number;
  /** Red: extra wilds on reels 2–5. */
  extraWilds: number;
  reels: (readonly string[])[];
  /** Yellow: jackpot coins collected toward each jackpot. */
  counts: number[];
  won: number;
  jackpotsWon: { jackpot: number; amount: number }[];
  done: boolean;
}

export interface PiggySpin {
  free: boolean;
  bet: number;
  stops: number[];
  grid: string[][];
  coins: CoinEvent[];
  jackpotCoins: JackpotCoin[];
  jackpotWins: { jackpot: number; amount: number }[];
  lineWins: PiggyLineWin[];
  lineWin: number;
  /** Everything this spin paid (lines + jackpots). */
  win: number;
  /** Set when this base spin started free games. */
  triggered: Modifiers | null;
  bank: BankState;
}

function pick<K extends string | number>(rng: Rng, weights: [K, number][]): K {
  const total = weights.reduce((a, [, w]) => a + w, 0);
  let r = rng.int(total);
  for (const [k, w] of weights) if ((r -= w) < 0) return k;
  return weights[weights.length - 1][0];
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Pays the 25 lines of a 5x3 window (grid[reel][row]) for a total bet. */
export function piggyLineWins(grid: string[][], bet: number): PiggyLineWin[] {
  const lineBet = bet / PIGGY.lines.length;
  const lineWins: PiggyLineWin[] = [];
  PIGGY.lines.forEach((rows, li) => {
    const r = evaluateLine(
      rows.map((row, reel) => grid[reel][row]),
      DEFS,
    );
    if (r) {
      lineWins.push({
        line: li,
        symbol: r.symbol,
        count: r.count,
        amount: round2(r.pays * lineBet),
        cells: rows.slice(0, r.count).map((row, reel) => [reel, row] as [number, number]),
      });
    }
  });
  return lineWins;
}

/**
 * The free-games reel strips for a set of modifiers (pure, so a friend's
 * screen can rebuild them): no pig coins unless Yellow is on (then extra
 * jackpot coins), and Red's extra wilds spread round reels 2–5.
 */
export function freeReels(m: Modifiers): string[][] {
  const wilds = m.features.red ? extraWildsFor(m.levels.red) : 0;
  return PIGGY.reels.map((s, i) => {
    let strip = s.filter((x) => x !== 'COIN' && !FREE_DROP.includes(x));
    if (i > 0 && wilds) strip = sprinkle(strip, 'WILD', Math.ceil(wilds / 3), i + 2);
    if (m.features.yellow) strip = sprinkle(strip, 'COIN', jackpotCoinsFor(m.levels.yellow), i);
    return strip;
  });
}

/** Low symbols left off the free-games reels. */
export const FREE_DROP = ['T', 'J'];

export class PiggyGame {
  phase: 'idle' | 'bonus' = 'idle';
  betIndex = 0;
  bonus: BonusState | null = null;
  private banks = new Map<number, BankState>();

  constructor(private bankroll: Bankroll | null) {}

  get bet(): number {
    return PIGGY.betLevels[this.betIndex];
  }

  changeBet(dir: 1 | -1): number {
    if (this.phase !== 'idle') return this.bet;
    this.betIndex = (this.betIndex + dir + PIGGY.betLevels.length) % PIGGY.betLevels.length;
    return this.bet;
  }

  bankFor(betIndex = this.betIndex): BankState {
    let b = this.banks.get(betIndex);
    if (!b) this.banks.set(betIndex, (b = freshBank()));
    return b;
  }

  setBank(state: { pots?: Partial<Record<CoinColor, number>>; jackpots?: number[] }, betIndex = this.betIndex) {
    const b = this.bankFor(betIndex);
    if (state.pots) Object.assign(b.pots, state.pots);
    if (state.jackpots) b.jackpots = [...state.jackpots];
  }

  /** A machine as the last player left it: part-filled pots and grown jackpots. */
  randomizeBanks(rng: Rng) {
    PIGGY.betLevels.forEach((_b, i) => {
      const spins = rng.int(3000);
      this.banks.set(i, {
        pots: { blue: rng.int(POT_MAX - 1), yellow: rng.int(POT_MAX - 1), red: rng.int(POT_MAX - 1) },
        jackpots: JACKPOT_BASE.map((v, j) => Math.min(JACKPOT_MAX[j], round2(v + spins * JACKPOT_RATE[j]))),
      });
    });
  }

  /** A paid spin in the base game, or the next free game. */
  spin(rng: Rng, forcedStops?: number[]): PiggySpin {
    const free = this.phase === 'bonus';
    const b = this.bonus;
    if (free && (!b || b.done)) throw new Error('no bonus');
    const bet = free ? b!.totalBet : this.bet;
    if (!free && this.bankroll) {
      if (!this.bankroll.canAfford(bet)) throw new Error('Not enough chips');
      this.bankroll.debit(bet, 'bet', PIGGY.id);
      this.bankroll.countRound();
    }
    const bank = this.bankFor();
    if (!free) bank.jackpots = bank.jackpots.map((v, j) => Math.min(JACKPOT_MAX[j], v + JACKPOT_RATE[j]));

    const reels = free ? b!.reels : PIGGY.reels;
    const stops = forcedStops ?? reels.map((s) => rng.int(s.length));
    const grid = reels.map((s, i) => windowAt(s, stops[i]));
    const lineWins = piggyLineWins(grid, bet);
    const lineWin = round2(lineWins.reduce((a, w) => a + w.amount, 0));

    const coins: CoinEvent[] = [];
    const jackpotCoins: JackpotCoin[] = [];
    const jackpotWins: { jackpot: number; amount: number }[] = [];
    let triggered: Modifiers | null = null;

    if (!free) {
      const went: Record<Feature, boolean> = { blue: false, yellow: false, red: false };
      grid.forEach((col, reel) =>
        col.forEach((s, row) => {
          if (s !== 'COIN') return;
          const color = pick(rng, Object.entries(PIGGY.colorWeights) as [CoinColor, number][]);
          const roll = rng.int(10000);
          let result: CoinEvent['result'] = 'none';
          if (roll < PIGGY.trigger[color] + PIGGY.feed[color] && !went[color]) {
            bank.pots[color] = Math.min(POT_MAX, bank.pots[color] + 1);
            result = roll < PIGGY.trigger[color] || bank.pots[color] >= POT_MAX ? 'trigger' : 'feed';
          }
          if (result === 'trigger') went[color] = true;
          coins.push({ reel, row, color, result });
        }),
      );
      if (COLORS.some((c) => went[c])) {
        for (const c of COLORS) if (!went[c] && bank.pots[c] > 0 && rng.int(10000) < PIGGY.joinPerLevel * bank.pots[c]) went[c] = true;
        triggered = { features: went, levels: { blue: went.blue ? bank.pots.blue : 0, yellow: went.yellow ? bank.pots.yellow : 0, red: went.red ? bank.pots.red : 0 } };
      }
    } else if (b!.features.yellow) {
      // Jackpot Free Games: every pig coin is a jackpot coin.
      grid.forEach((col, reel) =>
        col.forEach((s, row) => {
          if (s !== 'COIN') return;
          const jackpot = pick(rng, PIGGY.jackpotWeights.map((w, j) => [j, w] as [number, number]));
          jackpotCoins.push({ reel, row, jackpot });
          b!.counts[jackpot]++;
          if (b!.counts[jackpot] >= JACKPOT_NEED) {
            const amount = round2(bank.jackpots[jackpot] * bet);
            jackpotWins.push({ jackpot, amount });
            b!.jackpotsWon.push({ jackpot, amount });
            b!.counts[jackpot] = 0;
            bank.jackpots[jackpot] = JACKPOT_BASE[jackpot];
          }
        }),
      );
    }

    const win = round2(lineWin + jackpotWins.reduce((a, w) => a + w.amount, 0));
    if (win > 0 && this.bankroll) this.bankroll.credit(win, 'win', PIGGY.id);

    if (free) {
      b!.won = round2(b!.won + win);
      b!.spinsLeft--;
      if (b!.spinsLeft <= 0) b!.done = true;
    } else if (triggered) {
      this.startBonus(triggered, bet);
    }

    return {
      free,
      bet,
      stops,
      grid,
      coins,
      jackpotCoins,
      jackpotWins,
      lineWins,
      lineWin,
      win,
      triggered,
      bank: { pots: { ...bank.pots }, jackpots: [...bank.jackpots] },
    };
  }

  /** Free games with these modifiers; the pots that went off empty. */
  private startBonus(m: Modifiers, bet: number) {
    const bank = this.bankFor();
    const spins = m.features.blue ? freeGamesFor(m.levels.blue) : BASE_FREE_GAMES;
    this.bonus = {
      features: { ...m.features },
      levels: { ...m.levels },
      spinsLeft: spins,
      totalSpins: spins,
      totalBet: bet,
      extraWilds: m.features.red ? extraWildsFor(m.levels.red) : 0,
      reels: freeReels(m),
      counts: JACKPOT_NAMES.map(() => 0),
      won: 0,
      jackpotsWon: [],
      done: false,
    };
    for (const c of COLORS) if (m.features[c]) bank.pots[c] = 0;
    this.phase = 'bonus';
  }

  /** Back to the base game once the client has shown the free-games total. */
  closeBonus() {
    if (this.bonus?.done) {
      this.bonus = null;
      this.phase = 'idle';
    }
  }
}

/** Monte Carlo from a given bank state. Plays `spins` paid spins (free games play out in full). */
export function simulatePiggy(rng: Rng, spins: number, start: { pots?: Partial<Record<CoinColor, number>>; jackpots?: number[] } = {}) {
  const g = new PiggyGame(null);
  g.setBank(start);
  let staked = 0,
    line = 0,
    bonus = 0,
    jackpots = 0,
    bonuses = 0,
    hits = 0,
    coinSpins = 0,
    bigWins = 0;
  const combos: Record<string, number> = {};
  const jackpotHits = JACKPOT_NAMES.map(() => 0);
  for (let i = 0; i < spins; i++) {
    staked += g.bet;
    const s = g.spin(rng);
    line += s.win;
    if (s.win > 0) hits++;
    if (s.coins.length) coinSpins++;
    let total = s.win;
    if (g.phase === 'bonus') {
      bonuses++;
      const key = COLORS.filter((c) => g.bonus!.features[c]).join('+');
      combos[key] = (combos[key] ?? 0) + 1;
      while (!g.bonus!.done) {
        const f = g.spin(rng);
        bonus += f.lineWin;
        jackpots += f.win - f.lineWin;
        total += f.win;
        for (const w of f.jackpotWins) jackpotHits[w.jackpot]++;
      }
      g.closeBonus();
    }
    if (total >= g.bet * 10) bigWins++;
  }
  return {
    rtp: (line + bonus + jackpots) / staked,
    baseRtp: line / staked,
    bonusRtp: (bonus + jackpots) / staked,
    jackpotRtp: jackpots / staked,
    bonusRate: bonuses / spins,
    hitRate: hits / spins,
    coinRate: coinSpins / spins,
    bigWinRate: bigWins / spins,
    combos,
    jackpotHits,
  };
}

/**
 * Advantage-play value: start with the pots at `pots` and play until the first
 * free games end. Returns RTP over many such sessions.
 */
export function apValue(rng: Rng, pots: Partial<Record<CoinColor, number>>, sessions: number) {
  let staked = 0,
    won = 0,
    spins = 0;
  for (let n = 0; n < sessions; n++) {
    const g = new PiggyGame(null);
    g.setBank({ pots });
    for (let guard = 0; guard < 100000; guard++) {
      staked += g.bet;
      spins++;
      won += g.spin(rng).win;
      if (g.phase === 'bonus') {
        while (!g.bonus!.done) won += g.spin(rng).win;
        g.closeBonus();
        break;
      }
    }
  }
  return { rtp: won / staked, avgSpins: spins / sessions };
}
