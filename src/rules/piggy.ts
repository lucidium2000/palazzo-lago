import type { Bankroll } from './bankroll';
import type { Rng } from './rng';
import { buildStrip, LINES_20 } from './machines';
import { evaluateLine, windowAt, type SymbolDef } from './slots';

/**
 * Porkbelly Payday: an original county-fair-meets-bank-vault game built on the "three piggy
 * banks" persistent-state design (mechanics only; name, theme and art are our
 * own).
 *
 * Base game: 5 reels x 3 rows, 25 lines, pays are multiples of the line bet.
 * Stacked Mystery "?" symbols all turn into the same symbol each spin. Any "?"
 * may also show a coin, Blue, Yellow or Red, which flicks up to the matching
 * bank. A coin either triggers that bank's bonus, feeds its meter, or does
 * nothing.
 *
 *   Blue   meter = banked free spins (starts at 9, +1 per coin, up to 100)
 *   Yellow meter = six progressive jackpots that grow with each coin
 *   Red    meter = low symbols crossed out, in order 10, J, Q, K, A
 *
 * Bonuses are free spins at the triggering bet. When one bank triggers, the
 * others often join in. Spins = the Blue bank's count if Blue is in, else 7.
 *   Blue   – just the banked spins; the Blue bank resets to 9.
 *   Yellow – jackpot coins land on "?" symbols; collect 2/2/3/4/5/6 of a
 *            colour to win Mini/Minor/Maxi/Major/Grand/Mega (re-winnable);
 *            the jackpots drop back to their base values afterwards.
 *   Red    – reels with the crossed-out low symbols removed; red bank resets.
 *
 * Bank meters are kept per bet level, as on the casino floor, so a machine can
 * be left with a fat pig: the advantage-play hook.
 */

export type CoinColor = 'blue' | 'yellow' | 'red';
export const COLORS: readonly CoinColor[] = ['blue', 'yellow', 'red'];
export type Feature = CoinColor;

export const JACKPOT_NAMES = ['MINI', 'MINOR', 'MAXI', 'MAJOR', 'GRAND', 'MEGA'] as const;
export type JackpotName = (typeof JACKPOT_NAMES)[number];
/** Starting jackpot values, multiples of the total bet. */
export const JACKPOT_BASE = [10, 25, 100, 250, 1000, 2500];
/**
 * A yellow coin that doesn't trigger adds 0.25x–6.75x the bet (in 0.25 steps)
 * to ONE of the Mini, Minor, Maxi or Major meters (Grand and Mega are fixed),
 * as the real game's help screens describe.
 */
export const YELLOW_BOOST = { min: 0.25, max: 6.75, step: 0.25, meters: 4 };
/** Jackpots stop growing here (Mega tops out at 12,500x the bet). */
export const JACKPOT_MAX = [20, 50, 200, 500, 2500, 12500];
/** Coins of a jackpot's colour needed to win it in the Yellow bonus. */
export const JACKPOT_NEED = [2, 2, 3, 4, 5, 6];

/** Low symbols crossed out by red coins, in order. */
export const RED_ORDER = ['T', 'J', 'Q', 'K', 'A'] as const;
export const BLUE_START = 9;
export const BLUE_MAX = 100;
export const BONUS_SPINS = 7;

export const PIGGY_SYMBOLS: SymbolDef[] = [
  { id: 'WILD', name: 'Wild', kind: 'wild' },
  { id: 'BANK', name: 'Golden Piggy Bank', kind: 'line', pays: { 3: 15, 4: 100, 5: 150 } },
  { id: 'BARS', name: 'Gold Bars', kind: 'line', pays: { 3: 10, 4: 50, 5: 100 } },
  { id: 'VAULT', name: 'Vault', kind: 'line', pays: { 3: 10, 4: 50, 5: 100 } },
  { id: 'BAG', name: 'Money Bag', kind: 'line', pays: { 3: 5, 4: 30, 5: 75 } },
  { id: 'A', name: 'Ace', kind: 'line', pays: { 3: 3, 4: 20, 5: 50 } },
  { id: 'K', name: 'King', kind: 'line', pays: { 3: 3, 4: 20, 5: 50 } },
  { id: 'Q', name: 'Queen', kind: 'line', pays: { 3: 2, 4: 15, 5: 50 } },
  { id: 'J', name: 'Jack', kind: 'line', pays: { 3: 2, 4: 15, 5: 50 } },
  { id: 'T', name: 'Ten', kind: 'line', pays: { 3: 2, 4: 15, 5: 50 } },
  { id: 'MYSTERY', name: 'Mystery Coin', kind: 'bonus' },
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

/** Puts `n` stacks of three "?" evenly round a strip. */
function withMystery(strip: string[], stacks: number): string[] {
  const out = [...strip];
  const step = Math.floor(out.length / stacks);
  for (let k = stacks - 1; k >= 0; k--) out.splice(k * step + 2, 0, 'MYSTERY', 'MYSTERY', 'MYSTERY');
  return out;
}

const BASE = { BANK: 3, BARS: 4, VAULT: 4, BAG: 5, A: 6, K: 6, Q: 7, J: 7, T: 7 };

export const PIGGY = {
  id: 'porkbelly-payday',
  name: 'Porkbelly Payday',
  tagline: 'Feed the piggy banks · Blue, Yellow and Red bonuses',
  rows: 3,
  lines: LINES_25,
  /** 75/150/225/450/600 credits at 1¢. */
  betLevels: [0.75, 1.5, 2.25, 4.5, 6] as readonly number[],
  symbols: PIGGY_SYMBOLS,
  reels: [
    withMystery(buildStrip({ ...BASE }, [], 51), 3),
    withMystery(buildStrip({ ...BASE, WILD: 4 }, [], 52), 3),
    withMystery(buildStrip({ ...BASE, WILD: 4 }, [], 53), 3),
    withMystery(buildStrip({ ...BASE, WILD: 4 }, [], 54), 3),
    withMystery(buildStrip({ ...BASE }, [], 55), 3),
  ] as readonly (readonly string[])[],
  /** What every "?" becomes, by weight. */
  mysteryWeights: { BANK: 6, BARS: 8, VAULT: 8, BAG: 9, A: 10, K: 10, Q: 11, J: 11, T: 11, WILD: 8 } as Record<string, number>,
  /** Chance (per 10,000) that a "?" shows a coin in the base game, and the colour mix. */
  coinChance: 1400,
  colorWeights: { blue: 40, yellow: 30, red: 30 } as Record<CoinColor, number>,
  /** Per coin, per 10,000: trigger the bank, else feed it. */
  trigger: { blue: 380, yellow: 260, red: 260 } as Record<CoinColor, number>,
  feed: { blue: 3000, yellow: 5500, red: 1050 } as Record<CoinColor, number>,
  /** Per 10,000: another bank joins a triggered bonus. */
  join: 3200,
  /** Yellow bonus: chance a "?" shows a jackpot coin, and the colour mix. */
  jackpotCoinChance: 1000,
  jackpotWeights: [600, 250, 100, 35, 12, 3],
};

export interface BankState {
  blue: number;
  /** Current jackpot values, multiples of the total bet. */
  jackpots: number[];
  /** How many low symbols are crossed out (0..5). */
  reds: number;
}

export const freshBank = (): BankState => ({ blue: BLUE_START, jackpots: [...JACKPOT_BASE], reds: 0 });

export const crossedOut = (reds: number): string[] => RED_ORDER.slice(0, reds) as unknown as string[];

export interface CoinEvent {
  reel: number;
  row: number;
  color: CoinColor;
  result: 'trigger' | 'feed' | 'none';
  /** Yellow feeds: which jackpot meter grew, and by how much (x bet). */
  boost?: { jackpot: number; amount: number };
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

export interface BonusState {
  features: Record<Feature, boolean>;
  spinsLeft: number;
  totalSpins: number;
  totalBet: number;
  /** Low symbols removed from the reels (Red). */
  removed: string[];
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
  /** Raw window with "?" (grid[reel][row]). */
  raw: string[][];
  /** After the mystery reveal. */
  grid: string[][];
  mystery: string | null;
  coins: CoinEvent[];
  jackpotCoins: JackpotCoin[];
  jackpotWins: { jackpot: number; amount: number }[];
  lineWins: PiggyLineWin[];
  lineWin: number;
  /** Everything this spin paid (lines + jackpots). */
  win: number;
  /** Set when this base spin started a bonus. */
  triggered: Record<Feature, boolean> | null;
  bank: BankState;
}

function pick<K extends string | number>(rng: Rng, weights: [K, number][]): K {
  const total = weights.reduce((a, [, w]) => a + w, 0);
  let r = rng.int(total);
  for (const [k, w] of weights) if ((r -= w) < 0) return k;
  return weights[weights.length - 1][0];
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Pays the 25 lines of a revealed 5x3 window (grid[reel][row]) for a total bet. */
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

  setBank(state: Partial<BankState>, betIndex = this.betIndex) {
    Object.assign(this.bankFor(betIndex), state);
  }

  /** A machine as the last player left it: some banked spins, some growth, a few reds. */
  randomizeBanks(rng: Rng) {
    PIGGY.betLevels.forEach((_b, i) => {
      const coins = rng.int(60);
      const yellow = rng.int(40);
      const jackpots = [...JACKPOT_BASE];
      for (let k = 0; k < yellow; k++) {
        const b = yellowBoost(rng);
        jackpots[b.jackpot] = Math.min(JACKPOT_MAX[b.jackpot], round2(jackpots[b.jackpot] + b.amount));
      }
      this.banks.set(i, {
        blue: Math.min(BLUE_MAX, BLUE_START + Math.floor(coins * (0.3 + rng.int(70) / 100))),
        jackpots,
        reds: rng.int(4),
      });
    });
  }

  /** A paid spin in the base game, or the next free spin in a bonus. */
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
    const reels = free ? b!.reels : PIGGY.reels;
    const stops = forcedStops ?? reels.map((s) => rng.int(s.length));
    const raw = reels.map((s, i) => windowAt(s, stops[i]));
    const hasMystery = raw.some((col) => col.includes('MYSTERY'));
    const removed = free ? b!.removed : [];
    const mystery = hasMystery ? pick(rng, Object.entries(PIGGY.mysteryWeights).filter(([k]) => !removed.includes(k))) : null;
    const grid = raw.map((col) => col.map((s) => (s === 'MYSTERY' ? mystery! : s)));

    const lineWins = piggyLineWins(grid, bet);
    const lineWin = round2(lineWins.reduce((a, w) => a + w.amount, 0));

    const bank = this.bankFor();
    const coins: CoinEvent[] = [];
    const jackpotCoins: JackpotCoin[] = [];
    const jackpotWins: { jackpot: number; amount: number }[] = [];
    const trig: Record<Feature, boolean> = { blue: false, yellow: false, red: false };

    if (!free) {
      // Coins on "?" symbols go to the banks.
      raw.forEach((col, reel) =>
        col.forEach((s, row) => {
          if (s !== 'MYSTERY' || rng.int(10000) >= PIGGY.coinChance) return;
          const color = pick(rng, Object.entries(PIGGY.colorWeights) as [CoinColor, number][]);
          const roll = rng.int(10000);
          let result: CoinEvent['result'] = 'none';
          let boost: CoinEvent['boost'];
          if (roll < PIGGY.trigger[color]) result = 'trigger';
          else if (roll < PIGGY.trigger[color] + PIGGY.feed[color]) {
            if (color === 'blue' && bank.blue < BLUE_MAX) bank.blue++, (result = 'feed');
            else if (color === 'yellow') {
              boost = yellowBoost(rng);
              const j = boost.jackpot;
              bank.jackpots = bank.jackpots.map((v, k) => (k === j ? Math.min(JACKPOT_MAX[k], round2(v + boost!.amount)) : v));
              result = 'feed';
            } else if (color === 'red' && bank.reds < RED_ORDER.length) bank.reds++, (result = 'feed');
          }
          if (result === 'trigger') trig[color] = true;
          coins.push(boost ? { reel, row, color, result, boost } : { reel, row, color, result });
        }),
      );
      if (COLORS.some((c) => trig[c])) {
        // The other banks often join in.
        for (const c of COLORS) if (!trig[c] && rng.int(10000) < PIGGY.join) trig[c] = true;
      }
    } else if (b!.features.yellow) {
      // Yellow bonus: jackpot coins on "?" symbols.
      raw.forEach((col, reel) =>
        col.forEach((s, row) => {
          if (s !== 'MYSTERY' || rng.int(10000) >= PIGGY.jackpotCoinChance) return;
          const jackpot = pick(rng, PIGGY.jackpotWeights.map((w, j) => [j, w] as [number, number]));
          jackpotCoins.push({ reel, row, jackpot });
          b!.counts[jackpot]++;
          if (b!.counts[jackpot] >= JACKPOT_NEED[jackpot]) {
            const amount = round2(bank.jackpots[jackpot] * bet);
            jackpotWins.push({ jackpot, amount });
            b!.jackpotsWon.push({ jackpot, amount });
            b!.counts[jackpot] = 0;
            bank.jackpots[jackpot] = JACKPOT_BASE[jackpot];
          }
        }),
      );
    }

    const triggered = !free && COLORS.some((c) => trig[c]) ? trig : null;
    const win = round2(lineWin + jackpotWins.reduce((a, w) => a + w.amount, 0));
    if (win > 0 && this.bankroll) this.bankroll.credit(win, 'win', PIGGY.id);

    if (free) {
      b!.won = round2(b!.won + win);
      b!.spinsLeft--;
      if (b!.spinsLeft <= 0) this.endBonus();
    } else if (triggered) {
      this.startBonus(triggered, bet);
    }

    return { free, bet, stops, raw, grid, mystery, coins, jackpotCoins, jackpotWins, lineWins, lineWin, win, triggered, bank: { ...bank, jackpots: [...bank.jackpots] } };
  }

  private startBonus(features: Record<Feature, boolean>, bet: number) {
    const bank = this.bankFor();
    const removed = features.red ? crossedOut(bank.reds) : [];
    const spins = features.blue ? bank.blue : BONUS_SPINS;
    this.bonus = {
      features: { ...features },
      spinsLeft: spins,
      totalSpins: spins,
      totalBet: bet,
      removed,
      reels: PIGGY.reels.map((s) => s.filter((x) => !removed.includes(x))),
      counts: [0, 0, 0, 0, 0, 0],
      won: 0,
      jackpotsWon: [],
      done: false,
    };
    this.phase = 'bonus';
  }

  private endBonus() {
    const b = this.bonus!;
    const bank = this.bankFor();
    if (b.features.blue) bank.blue = BLUE_START;
    if (b.features.red) bank.reds = 0;
    if (b.features.yellow) bank.jackpots = [...JACKPOT_BASE];
    b.done = true;
  }

  /** Back to the base game once the client has shown the bonus total. */
  closeBonus() {
    if (this.bonus?.done) {
      this.bonus = null;
      this.phase = 'idle';
    }
  }
}

/** Monte Carlo from a given bank state. Plays `spins` paid spins (bonuses play out in full). */
export function simulatePiggy(rng: Rng, spins: number, start: Partial<BankState> = {}) {
  const g = new PiggyGame(null);
  g.setBank(start);
  let staked = 0,
    line = 0,
    bonus = 0,
    jackpots = 0,
    bonuses = 0;
  const combos: Record<string, number> = {};
  for (let i = 0; i < spins; i++) {
    staked += g.bet;
    const s = g.spin(rng);
    line += s.win;
    if (g.phase === 'bonus') {
      bonuses++;
      const key = COLORS.filter((c) => g.bonus!.features[c]).join('+');
      combos[key] = (combos[key] ?? 0) + 1;
      while (!g.bonus!.done) {
        const f = g.spin(rng);
        bonus += f.lineWin;
        jackpots += f.win - f.lineWin;
      }
      g.closeBonus();
    }
  }
  return { rtp: (line + bonus + jackpots) / staked, baseRtp: line / staked, bonusRtp: (bonus + jackpots) / staked, jackpotRtp: jackpots / staked, bonusRate: bonuses / spins, combos };
}

/**
 * Advantage-play value: start with the Blue bank at `blue` and play until the
 * first bonus that includes Blue ends (the bank resets then). Returns RTP over
 * many such sessions.
 */
export function apValue(rng: Rng, blue: number, sessions: number, start: Partial<BankState> = {}) {
  let staked = 0,
    won = 0,
    spins = 0;
  for (let n = 0; n < sessions; n++) {
    const g = new PiggyGame(null);
    g.setBank({ ...start, blue });
    for (let guard = 0; guard < 100000; guard++) {
      staked += g.bet;
      spins++;
      won += g.spin(rng).win;
      if (g.phase === 'bonus') {
        const hadBlue = g.bonus!.features.blue;
        while (!g.bonus!.done) won += g.spin(rng).win;
        g.closeBonus();
        if (hadBlue) break;
      }
    }
  }
  return { rtp: won / staked, avgSpins: spins / sessions };
}

/** One yellow-coin boost: a random lower jackpot meter and a random amount (x bet). */
export function yellowBoost(rng: Rng): { jackpot: number; amount: number } {
  const steps = Math.round((YELLOW_BOOST.max - YELLOW_BOOST.min) / YELLOW_BOOST.step) + 1;
  return { jackpot: rng.int(YELLOW_BOOST.meters), amount: YELLOW_BOOST.min + rng.int(steps) * YELLOW_BOOST.step };
}
