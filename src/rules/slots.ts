import type { Bankroll } from './bankroll';
import type { Rng } from './rng';

/**
 * Slot machine engine. Two machine shapes:
 *  - classic: 3 reels, one payline on the middle row, combination rules
 *  - video:   5 reels x 3 rows, N paylines, wild/scatter, and either a free-spins
 *             feature or a pick bonus
 * All pays are multipliers. Classic pays multiply the total bet; video line pays
 * multiply the line bet (total bet / lines); scatter and bonus pays multiply the
 * total bet.
 */

export type SymbolKind = 'line' | 'wild' | 'scatter' | 'bonus' | 'blank';

export interface SymbolDef {
  id: string;
  name: string;
  kind: SymbolKind;
  /** Video machines: pays by count of a kind on a line, e.g. {3: 5, 4: 20, 5: 100}. */
  pays?: Partial<Record<2 | 3 | 4 | 5, number>>;
}

export interface ClassicRule {
  name: string;
  pays: number;
  test: (s: readonly string[]) => boolean;
}

interface MachineBase {
  id: string;
  name: string;
  tagline: string;
  symbols: readonly SymbolDef[];
  /** Virtual reel strips, top-to-bottom order. Symbol ids. */
  reels: readonly (readonly string[])[];
  betLevels: readonly number[];
  targetRtp: number;
}

export interface ClassicMachine extends MachineBase {
  type: 'classic';
  rules: readonly ClassicRule[];
}

export interface FreeSpinsFeature {
  type: 'freeSpins';
  /** Scatter count needed. */
  trigger: number;
  spins: number;
  multiplier: number;
}

export interface PickFeature {
  type: 'pick';
  /** Reels (0-based) that must each show the bonus symbol. */
  reels: readonly number[];
  /** Prize tiles as multiples of the total bet. Shuffled per bonus. */
  prizes: readonly number[];
  picks: number;
}

export interface VideoMachine extends MachineBase {
  type: 'video';
  rows: 3;
  /** Each line lists the row (0 top .. 2 bottom) used on each reel. */
  lines: readonly (readonly number[])[];
  /** Scatter pays by count, multiples of total bet. */
  scatterPays: Partial<Record<number, number>>;
  feature: FreeSpinsFeature | PickFeature;
}

export type Machine = ClassicMachine | VideoMachine;

export interface LineWin {
  line: number;
  symbol: string;
  count: number;
  amount: number;
  /** [reel, row] cells that make up the win. */
  cells: [number, number][];
}

export interface SpinOutcome {
  stops: number[];
  /** grid[reel][row] symbol ids. Classic machines show 3 rows too (row 1 is the payline). */
  grid: string[][];
  lineWins: LineWin[];
  scatterCount: number;
  scatterWin: number;
  /** Total win for this spin, after any free-spin multiplier. */
  win: number;
  rule?: string;
  triggered?: 'freeSpins' | 'pick';
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function symbolMap(m: Machine): Map<string, SymbolDef> {
  return new Map(m.symbols.map((s) => [s.id, s]));
}

export function windowAt(strip: readonly string[], stop: number): string[] {
  const n = strip.length;
  return [strip[(stop - 1 + n) % n], strip[stop], strip[(stop + 1) % n]];
}

/** Pays a line of symbols (left to right) in line-bet units. */
export function evaluateLine(
  syms: readonly string[],
  defs: Map<string, SymbolDef>,
): { symbol: string; count: number; pays: number } | null {
  let wilds = 0;
  while (wilds < syms.length && defs.get(syms[wilds])!.kind === 'wild') wilds++;
  let best: { symbol: string; count: number; pays: number } | null = null;
  const wildDef = defs.get(syms[0])!;
  if (wilds >= 2 && wildDef.kind === 'wild') {
    const p = wildDef.pays?.[wilds as 2 | 3 | 4 | 5] ?? 0;
    if (p > 0) best = { symbol: wildDef.id, count: wilds, pays: p };
  }
  if (wilds < syms.length) {
    const s = defs.get(syms[wilds])!;
    if (s.kind === 'line') {
      let k = wilds + 1;
      while (k < syms.length) {
        const d = defs.get(syms[k])!;
        if (d.id === s.id || d.kind === 'wild') k++;
        else break;
      }
      const p = s.pays?.[k as 2 | 3 | 4 | 5] ?? 0;
      if (p > 0 && (!best || p > best.pays)) best = { symbol: s.id, count: k, pays: p };
    }
  }
  return best;
}

export function spinMachine(m: Machine, rng: Rng, totalBet: number, multiplier = 1): SpinOutcome {
  const stops = m.reels.map((strip) => rng.int(strip.length));
  return outcomeForStops(m, stops, totalBet, multiplier);
}

export function outcomeForStops(
  m: Machine,
  stops: number[],
  totalBet: number,
  multiplier = 1,
): SpinOutcome {
  const grid = m.reels.map((strip, i) => windowAt(strip, stops[i]));
  if (m.type === 'classic') {
    const line = grid.map((w) => w[1]);
    const rule = m.rules.find((r) => r.test(line));
    const win = rule ? round2(rule.pays * totalBet * multiplier) : 0;
    const lineWins: LineWin[] = rule
      ? [{ line: 0, symbol: line[0], count: 3, amount: win, cells: [[0, 1], [1, 1], [2, 1]] }]
      : [];
    return { stops, grid, lineWins, scatterCount: 0, scatterWin: 0, win, rule: rule?.name };
  }

  const defs = symbolMap(m);
  const lineBet = totalBet / m.lines.length;
  const lineWins: LineWin[] = [];
  m.lines.forEach((rows, li) => {
    const syms = rows.map((row, reel) => grid[reel][row]);
    const r = evaluateLine(syms, defs);
    if (r) {
      lineWins.push({
        line: li,
        symbol: r.symbol,
        count: r.count,
        amount: round2(r.pays * lineBet * multiplier),
        cells: rows.slice(0, r.count).map((row, reel) => [reel, row]),
      });
    }
  });

  let scatterCount = 0;
  for (const col of grid) for (const s of col) if (defs.get(s)!.kind === 'scatter') scatterCount++;
  const scatterWin = round2((m.scatterPays[scatterCount] ?? 0) * totalBet * multiplier);

  let triggered: SpinOutcome['triggered'];
  if (m.feature.type === 'freeSpins' && scatterCount >= m.feature.trigger) triggered = 'freeSpins';
  if (m.feature.type === 'pick') {
    const f = m.feature;
    if (f.reels.every((r) => grid[r].some((s) => defs.get(s)!.kind === 'bonus'))) triggered = 'pick';
  }

  const win = round2(lineWins.reduce((a, w) => a + w.amount, 0) + scatterWin);
  return { stops, grid, lineWins, scatterCount, scatterWin, win, triggered };
}

// ---------------------------------------------------------------------------
// Exact math. Used by tests to prove each machine's return to player (RTP).
// ---------------------------------------------------------------------------

export interface MachineAnalysis {
  rtp: number;
  /** Video machines: expected line pay per total bet in the base game. */
  lineRtp: number;
  scatterRtp: number;
  featureRtp: number;
  /** Probability per base spin of triggering the feature. */
  featureChance: number;
  /** Classic machines only: probability that a spin pays anything. */
  hitFrequency?: number;
}

function stripFrequencies(strip: readonly string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const s of strip) counts.set(s, (counts.get(s) ?? 0) + 1);
  return [...counts].map(([s, c]) => [s, c / strip.length]);
}

/** Probability that the 3-row window on a strip shows at least one of the given kind. */
export function windowChance(strip: readonly string[], defs: Map<string, SymbolDef>, kind: SymbolKind) {
  let hits = 0;
  for (let i = 0; i < strip.length; i++) {
    if (windowAt(strip, i).some((s) => defs.get(s)!.kind === kind)) hits++;
  }
  return hits / strip.length;
}

/** Asserts no window can show two symbols of a kind (keeps the math exact). */
export function maxPerWindow(strip: readonly string[], defs: Map<string, SymbolDef>, kind: SymbolKind) {
  let max = 0;
  for (let i = 0; i < strip.length; i++) {
    max = Math.max(max, windowAt(strip, i).filter((s) => defs.get(s)!.kind === kind).length);
  }
  return max;
}

export function analyzeMachine(m: Machine): MachineAnalysis {
  if (m.type === 'classic') {
    let total = 0;
    let hits = 0;
    const [a, b, c] = m.reels;
    for (const x of a)
      for (const y of b)
        for (const z of c) {
          const rule = m.rules.find((r) => r.test([x, y, z]));
          if (rule) {
            total += rule.pays;
            hits++;
          }
        }
    const n = a.length * b.length * c.length;
    return {
      rtp: total / n,
      lineRtp: total / n,
      scatterRtp: 0,
      featureRtp: 0,
      featureChance: 0,
      hitFrequency: hits / n,
    };
  }

  const defs = symbolMap(m);
  const freqs = m.reels.map(stripFrequencies);

  // Expected pay of one line in line-bet units == line RTP per total bet,
  // because every line has the same expectation and lineBet = totalBet / lines.
  let lineRtp = 0;
  const syms: string[] = [];
  const walk = (reel: number, p: number) => {
    if (reel === freqs.length) {
      const r = evaluateLine(syms, defs);
      if (r) lineRtp += p * r.pays;
      return;
    }
    for (const [s, q] of freqs[reel]) {
      syms[reel] = s;
      walk(reel + 1, p * q);
    }
  };
  walk(0, 1);

  // Scatter count distribution (at most one scatter per window, asserted in tests).
  let dist = [1];
  for (const strip of m.reels) {
    const q = windowChance(strip, defs, 'scatter');
    const next = new Array(dist.length + 1).fill(0);
    dist.forEach((p, k) => {
      next[k] += p * (1 - q);
      next[k + 1] += p * q;
    });
    dist = next;
  }
  const scatterRtp = dist.reduce((a, p, k) => a + p * (m.scatterPays[k] ?? 0), 0);

  let featureChance = 0;
  let featureRtp = 0;
  if (m.feature.type === 'freeSpins') {
    const f = m.feature;
    featureChance = dist.slice(f.trigger).reduce((a, p) => a + p, 0);
    // Each free spin can retrigger: expected spins T = N / (1 - pN).
    const expectedSpins = f.spins / (1 - featureChance * f.spins);
    featureRtp = featureChance * expectedSpins * f.multiplier * (lineRtp + scatterRtp);
  } else {
    const f = m.feature;
    featureChance = f.reels.reduce((p, r) => p * windowChance(m.reels[r], defs, 'bonus'), 1);
    const mean = f.prizes.reduce((a, b) => a + b, 0) / f.prizes.length;
    featureRtp = featureChance * f.picks * mean;
  }

  return {
    rtp: lineRtp + scatterRtp + featureRtp,
    lineRtp,
    scatterRtp,
    featureRtp,
    featureChance,
  };
}

// ---------------------------------------------------------------------------
// Game session: bankroll, free spins, pick bonus.
// ---------------------------------------------------------------------------

export type SlotPhase = 'idle' | 'freeSpins' | 'pick';

export interface PickState {
  prizes: number[];
  revealed: number[];
  picksLeft: number;
  totalBet: number;
  won: number;
}

export class SlotGame {
  phase: SlotPhase = 'idle';
  freeSpinsLeft = 0;
  freeSpinsWon = 0;
  freeSpinBet = 0;
  pickState: PickState | null = null;
  betIndex = 0;

  constructor(
    readonly machine: Machine,
    private bankroll: Bankroll,
  ) {}

  get bet(): number {
    return this.machine.betLevels[this.betIndex];
  }

  changeBet(dir: 1 | -1): number {
    if (this.phase !== 'idle') return this.bet;
    this.betIndex = Math.max(0, Math.min(this.machine.betLevels.length - 1, this.betIndex + dir));
    return this.bet;
  }

  /** Base-game spin (paid) or the next free spin. */
  spin(rng: Rng): SpinOutcome {
    if (this.phase === 'pick') throw new Error('finish the bonus first');
    this.closePick();
    const free = this.phase === 'freeSpins';
    const bet = free ? this.freeSpinBet : this.bet;
    if (!free) {
      if (!this.bankroll.canAfford(bet)) throw new Error('Not enough chips');
      this.bankroll.debit(bet, 'bet', this.machine.id);
      this.bankroll.countRound();
    }
    const mult =
      free && this.machine.type === 'video' && this.machine.feature.type === 'freeSpins'
        ? this.machine.feature.multiplier
        : 1;
    const out = spinMachine(this.machine, rng, bet, mult);
    if (out.win > 0) this.bankroll.credit(out.win, 'win', this.machine.id);

    if (free) {
      this.freeSpinsLeft--;
      this.freeSpinsWon = round2(this.freeSpinsWon + out.win);
    }
    if (out.triggered === 'freeSpins' && this.machine.type === 'video' && this.machine.feature.type === 'freeSpins') {
      if (!free) {
        this.freeSpinBet = bet;
        this.freeSpinsWon = 0;
      }
      this.freeSpinsLeft += this.machine.feature.spins;
    }
    if (out.triggered === 'pick' && this.machine.type === 'video' && this.machine.feature.type === 'pick') {
      const prizes = [...this.machine.feature.prizes];
      for (let i = prizes.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [prizes[i], prizes[j]] = [prizes[j], prizes[i]];
      }
      this.pickState = { prizes, revealed: [], picksLeft: this.machine.feature.picks, totalBet: bet, won: 0 };
    }
    this.phase = this.pickState ? 'pick' : this.freeSpinsLeft > 0 ? 'freeSpins' : 'idle';
    return out;
  }

  /** Reveals one pick-bonus tile. Returns the amount won by that tile. */
  pick(tile: number): number {
    const st = this.pickState;
    if (this.phase !== 'pick' || !st) throw new Error('no bonus');
    if (tile < 0 || tile >= st.prizes.length || st.revealed.includes(tile)) return 0;
    st.revealed.push(tile);
    st.picksLeft--;
    const amount = round2(st.prizes[tile] * st.totalBet);
    st.won = round2(st.won + amount);
    this.bankroll.credit(amount, 'win', this.machine.id);
    if (st.picksLeft === 0) {
      this.phase = this.freeSpinsLeft > 0 ? 'freeSpins' : 'idle';
    }
    return amount;
  }

  /** Clears a finished pick bonus so the screen can return to the reels. */
  closePick(): void {
    if (this.pickState && this.pickState.picksLeft === 0) this.pickState = null;
  }
}
