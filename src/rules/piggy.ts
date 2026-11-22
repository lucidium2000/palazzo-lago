import type { Bankroll } from './bankroll';
import type { Rng } from './rng';
import { LINES_20, buildStrip } from './machines';
import { evaluateLine, windowAt, type SymbolDef } from './slots';

/**
 * Porkbelly Payday: an original county-fair "cash on reels" game.
 *
 * Base game: 5 reels x 3 rows, 20 lines. Golden Pig wilds appear on reels
 * 2–4. Coins carry a cash value (a multiple of the total bet) or a jackpot
 * label. Every coin that lands drops into one of three piggy banks above the
 * reels (Red, Green, Blue). Each bank has a meter kept per bet level; a full
 * bank waits for the next Hold & Spin, smashes at its start and applies its
 * power:
 *   Red   – every cash coin is doubled when the bonus ends
 *   Green – 5 respins instead of 3
 *   Blue  – a guaranteed jackpot coin (Mini 70%, Minor 25%, Major 5%)
 *
 * Hold & Spin: 6+ coins anywhere. Coins lock; each respin every empty cell
 * may land a coin; any new coin resets the respins. All 15 cells = Grand.
 * The bonus pays the sum of the coins (plus the Grand) times the total bet.
 */

export type Jackpot = 'MINI' | 'MINOR' | 'MAJOR' | 'GRAND';
export const JACKPOTS: Record<Jackpot, number> = { MINI: 25, MINOR: 75, MAJOR: 250, GRAND: 1000 };

export interface Coin {
  /** Value as a multiple of the total bet. */
  mult: number;
  jackpot?: Jackpot;
}

export const PIGS = ['red', 'green', 'blue'] as const;
export type Pig = (typeof PIGS)[number];
/** Coins each bank holds before it is full. */
export const PIG_CAPACITY: Record<Pig, number> = { red: 90, green: 70, blue: 160 };

export const PIGGY_SYMBOLS: SymbolDef[] = [
  { id: 'WILD', name: 'Golden Pig (wild)', kind: 'wild', pays: { 3: 115, 4: 570, 5: 2850 } },
  { id: 'BARN', name: 'Red Barn', kind: 'line', pays: { 3: 68, 4: 285, 5: 1140 } },
  { id: 'RIBBON', name: 'Blue Ribbon', kind: 'line', pays: { 3: 57, 4: 230, 5: 685 } },
  { id: 'CORN', name: 'Sweet Corn', kind: 'line', pays: { 3: 46, 4: 135, 5: 455 } },
  { id: 'APPLE', name: 'Candy Apple', kind: 'line', pays: { 3: 34, 4: 115, 5: 340 } },
  { id: 'A', name: 'Ace', kind: 'line', pays: { 3: 23, 4: 68, 5: 230 } },
  { id: 'K', name: 'King', kind: 'line', pays: { 3: 23, 4: 57, 5: 205 } },
  { id: 'Q', name: 'Queen', kind: 'line', pays: { 3: 17, 4: 46, 5: 135 } },
  { id: 'J', name: 'Jack', kind: 'line', pays: { 3: 14, 4: 34, 5: 115 } },
  { id: 'T', name: 'Ten', kind: 'line', pays: { 3: 14, 4: 28, 5: 103 } },
  { id: 'COIN', name: 'Pig Coin', kind: 'bonus' },
];

export const PIGGY = {
  id: 'porkbelly-payday',
  name: 'Porkbelly Payday',
  tagline: 'Feed the piggy banks · 6 coins start Hold & Spin',
  rows: 3,
  lines: LINES_20,
  betLevels: [1, 2, 3, 5, 10, 25, 50] as readonly number[],
  symbols: PIGGY_SYMBOLS,
  reels: [
    buildStrip({ BARN: 3, RIBBON: 4, CORN: 5, APPLE: 6, A: 7, K: 7, Q: 8, J: 8, T: 9, COIN: 8 }, [], 41),
    buildStrip({ WILD: 3, BARN: 3, RIBBON: 4, CORN: 5, APPLE: 6, A: 7, K: 7, Q: 8, J: 8, T: 9, COIN: 8 }, [], 42),
    buildStrip({ WILD: 3, BARN: 3, RIBBON: 4, CORN: 5, APPLE: 6, A: 7, K: 7, Q: 8, J: 8, T: 9, COIN: 8 }, [], 43),
    buildStrip({ WILD: 3, BARN: 3, RIBBON: 4, CORN: 5, APPLE: 6, A: 7, K: 7, Q: 8, J: 8, T: 9, COIN: 8 }, [], 44),
    buildStrip({ BARN: 3, RIBBON: 4, CORN: 5, APPLE: 6, A: 7, K: 7, Q: 8, J: 8, T: 9, COIN: 8 }, [], 45),
  ] as readonly (readonly string[])[],
  trigger: 6,
  respins: 3,
  greenRespins: 5,
  /** Chance an empty cell lands a coin on each respin. */
  respinCoinChance: 0.035,
};

const DEFS = new Map(PIGGY_SYMBOLS.map((s) => [s.id, s]));

/** [weight, coin] tables. Cash values are multiples of the total bet. */
const BASE_COINS: [number, Coin][] = [
  [300, { mult: 0.5 }],
  [280, { mult: 1 }],
  [140, { mult: 1.5 }],
  [120, { mult: 2 }],
  [70, { mult: 3 }],
  [50, { mult: 5 }],
  [25, { mult: 10 }],
  [12, { mult: 25, jackpot: 'MINI' }],
  [3, { mult: 75, jackpot: 'MINOR' }],
];
const BONUS_COINS: [number, Coin][] = [...BASE_COINS, [0.6, { mult: 250, jackpot: 'MAJOR' }]];
const BLUE_JACKPOT: [number, Coin][] = [
  [70, { mult: 25, jackpot: 'MINI' }],
  [25, { mult: 75, jackpot: 'MINOR' }],
  [5, { mult: 250, jackpot: 'MAJOR' }],
];

function pick<T>(rng: Rng, table: [number, T][]): T {
  // Weights scaled to integers so any Rng gives exact odds.
  const scaled = table.map(([w]) => Math.round(w * 10));
  const total = scaled.reduce((a, b) => a + b, 0);
  let r = rng.int(total);
  for (let i = 0; i < table.length; i++) {
    if ((r -= scaled[i]) < 0) return table[i][1];
  }
  return table[table.length - 1][1];
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export interface PiggyLineWin {
  line: number;
  symbol: string;
  count: number;
  amount: number;
  cells: [number, number][];
}

export interface PiggySpin {
  stops: number[];
  grid: string[][];
  /** coins[reel][row] for COIN cells, otherwise null. */
  coins: (Coin | null)[][];
  lineWins: PiggyLineWin[];
  lineWin: number;
  coinCount: number;
  /** Which bank each landed coin went into (-1: every bank already full). */
  fed: { reel: number; row: number; pig: number }[];
  triggered: boolean;
  /** Meters after this spin (for the current bet level). */
  meters: number[];
}

export interface BonusState {
  /** board[reel*3 + row]. */
  board: (Coin | null)[];
  respinsLeft: number;
  maxRespins: number;
  totalBet: number;
  powers: Record<Pig, boolean>;
  /** Cell where the Blue bank placed its jackpot coin. */
  blueCell: number | null;
  done: boolean;
  grand: boolean;
  /** Final pay (credited when done). */
  win: number;
  respinCount: number;
}

export interface RespinResult {
  landed: { cell: number; coin: Coin }[];
  respinsLeft: number;
  done: boolean;
  grand: boolean;
  win: number;
}

/** Sum of a finished board in total-bet multiples. */
export function boardValue(board: readonly (Coin | null)[], red: boolean): { mult: number; grand: boolean } {
  let mult = 0;
  let filled = 0;
  for (const c of board) {
    if (!c) continue;
    filled++;
    mult += c.jackpot ? c.mult : red ? c.mult * 2 : c.mult;
  }
  const grand = filled === board.length;
  if (grand) mult += JACKPOTS.GRAND;
  return { mult, grand };
}

export class PiggyGame {
  phase: 'idle' | 'bonus' = 'idle';
  betIndex = 0;
  bonus: BonusState | null = null;
  /** Bank meters per bet level, as casinos keep them. */
  private meters = new Map<number, number[]>();

  constructor(private bankroll: Bankroll | null) {}

  get bet(): number {
    return PIGGY.betLevels[this.betIndex];
  }

  changeBet(dir: 1 | -1): number {
    if (this.phase !== 'idle') return this.bet;
    this.betIndex = Math.max(0, Math.min(PIGGY.betLevels.length - 1, this.betIndex + dir));
    return this.bet;
  }

  metersFor(betIndex = this.betIndex): number[] {
    let m = this.meters.get(betIndex);
    if (!m) this.meters.set(betIndex, (m = [0, 0, 0]));
    return m;
  }

  isFull(pig: number, betIndex = this.betIndex): boolean {
    return this.metersFor(betIndex)[pig] >= PIG_CAPACITY[PIGS[pig]];
  }

  /** A paid base-game spin. Starts the bonus when 6+ coins land. */
  spin(rng: Rng, forcedStops?: number[]): PiggySpin {
    if (this.phase !== 'idle') throw new Error('finish the bonus first');
    const bet = this.bet;
    if (this.bankroll) {
      if (!this.bankroll.canAfford(bet)) throw new Error('Not enough chips');
      this.bankroll.debit(bet, 'bet', PIGGY.id);
      this.bankroll.countRound();
    }
    const stops = forcedStops ?? PIGGY.reels.map((s) => rng.int(s.length));
    const grid = PIGGY.reels.map((s, i) => windowAt(s, stops[i]));
    const coins = grid.map((col) => col.map((s) => (s === 'COIN' ? pick(rng, BASE_COINS) : null)));

    const lineBet = bet / PIGGY.lines.length;
    const lineWins: PiggyLineWin[] = [];
    PIGGY.lines.forEach((rows, li) => {
      const syms = rows.map((row, reel) => grid[reel][row]);
      const r = evaluateLine(syms, DEFS);
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
    const lineWin = round2(lineWins.reduce((a, w) => a + w.amount, 0));
    if (lineWin > 0 && this.bankroll) this.bankroll.credit(lineWin, 'win', PIGGY.id);

    // Feed the banks.
    const meters = this.metersFor();
    const fed: PiggySpin['fed'] = [];
    let coinCount = 0;
    for (let reel = 0; reel < 5; reel++) {
      for (let row = 0; row < 3; row++) {
        if (!coins[reel][row]) continue;
        coinCount++;
        const open = [0, 1, 2].filter((p) => meters[p] < PIG_CAPACITY[PIGS[p]]);
        const pig = open.length ? open[rng.int(open.length)] : -1;
        if (pig >= 0) meters[pig]++;
        fed.push({ reel, row, pig });
      }
    }

    const triggered = coinCount >= PIGGY.trigger;
    if (triggered) this.startBonus(rng, coins, bet);
    return { stops, grid, coins, lineWins, lineWin, coinCount, fed, triggered, meters: [...meters] };
  }

  private startBonus(rng: Rng, coins: (Coin | null)[][], bet: number) {
    const meters = this.metersFor();
    const powers = { red: false, green: false, blue: false } as Record<Pig, boolean>;
    PIGS.forEach((p, i) => {
      if (meters[i] >= PIG_CAPACITY[p]) {
        powers[p] = true;
        meters[i] = 0; // the bank smashes
      }
    });
    const board: (Coin | null)[] = [];
    for (let reel = 0; reel < 5; reel++) for (let row = 0; row < 3; row++) board.push(coins[reel][row]);
    let blueCell: number | null = null;
    if (powers.blue) {
      const empty = board.flatMap((c, i) => (c ? [] : [i]));
      blueCell = empty[rng.int(empty.length)];
      board[blueCell] = pick(rng, BLUE_JACKPOT);
    }
    const max = powers.green ? PIGGY.greenRespins : PIGGY.respins;
    this.bonus = { board, respinsLeft: max, maxRespins: max, totalBet: bet, powers, blueCell, done: false, grand: false, win: 0, respinCount: 0 };
    this.phase = 'bonus';
    if (board.every(Boolean)) this.finishBonus();
  }

  /** One Hold & Spin respin. Pays out when the bonus ends. */
  respin(rng: Rng): RespinResult {
    const b = this.bonus;
    if (this.phase !== 'bonus' || !b || b.done) throw new Error('no bonus');
    const landed: RespinResult['landed'] = [];
    const chance = Math.round(PIGGY.respinCoinChance * 10000);
    b.board.forEach((c, cell) => {
      if (c) return;
      if (rng.int(10000) < chance) {
        const coin = pick(rng, BONUS_COINS);
        b.board[cell] = coin;
        landed.push({ cell, coin });
      }
    });
    b.respinCount++;
    b.respinsLeft = landed.length ? b.maxRespins : b.respinsLeft - 1;
    if (b.respinsLeft === 0 || b.board.every(Boolean)) this.finishBonus();
    return { landed, respinsLeft: b.respinsLeft, done: b.done, grand: b.grand, win: b.win };
  }

  private finishBonus() {
    const b = this.bonus!;
    const { mult, grand } = boardValue(b.board, b.powers.red);
    b.grand = grand;
    b.win = round2(mult * b.totalBet);
    b.done = true;
    if (this.bankroll && b.win > 0) this.bankroll.credit(b.win, 'win', PIGGY.id);
  }

  /** Back to the base game once the client has shown the bonus result. */
  closeBonus() {
    if (this.bonus?.done) {
      this.bonus = null;
      this.phase = 'idle';
    }
  }

  /** Test/demo hook: sets a bank's meter. */
  setMeter(pig: number, value: number, betIndex = this.betIndex) {
    this.metersFor(betIndex)[pig] = value;
  }
}

/** Monte Carlo RTP (no bankroll), used by tests and the tuning script. */
export function simulatePiggy(rng: Rng, spins: number, betIndex = 0) {
  const g = new PiggyGame(null);
  g.betIndex = betIndex;
  let staked = 0;
  let line = 0;
  let bonus = 0;
  let bonuses = 0;
  let grands = 0;
  const powers = { red: 0, green: 0, blue: 0 };
  for (let i = 0; i < spins; i++) {
    staked += g.bet;
    const s = g.spin(rng);
    line += s.lineWin;
    if (s.triggered) {
      bonuses++;
      for (const p of PIGS) if (g.bonus!.powers[p]) powers[p]++;
      while (!g.bonus!.done) g.respin(rng);
      bonus += g.bonus!.win;
      if (g.bonus!.grand) grands++;
      g.closeBonus();
    }
  }
  return { rtp: (line + bonus) / staked, lineRtp: line / staked, bonusRtp: bonus / staked, bonusRate: bonuses / spins, grands, powers };
}
