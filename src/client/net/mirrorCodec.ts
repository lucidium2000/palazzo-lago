/**
 * Small, pure wire formats for showing your friend's game actions on your
 * screen (their chips on the shared tables, their slot spins). Everything here
 * is validated on the way in: a payload from the network never reaches the
 * scene unless it names real bet spots, sane amounts and real reel stops.
 */
import { Bankroll } from '../../rules/bankroll';
import { betInfo, CrapsGame, type CrapsBetResult } from '../../rules/craps';
import { BET_SPOTS, SPOTS_BY_ID, type Pocket } from '../../rules/roulette';
import { COLORS, freeReels, JACKPOT_NAMES, PIGGY, POT_MAX, type CoinColor, type CoinEvent, type Feature, type Modifiers } from '../../rules/piggy';
import type { Machine } from '../../rules/slots';

/** Most spots sent per layout (biggest bets first) so an event stays well under 1 KB. */
export const MAX_SPOTS = 40;
const MAX_AMOUNT = 1_000_000;

const SPOT_INDEX = new Map(BET_SPOTS.map((s, i) => [s.id, i]));

const okAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_AMOUNT;
const round2 = (x: number) => Math.round(x * 100) / 100;

function biggest(bets: ReadonlyMap<string, number>): [string, number][] {
  const list = [...bets].filter(([, v]) => v > 0);
  if (list.length > MAX_SPOTS) list.sort((a, b) => b[1] - a[1]).length = MAX_SPOTS;
  return list;
}

/** Roulette layout → flat [spotIndex, amount, …] (indices into BET_SPOTS). */
export function encodeRoulette(bets: ReadonlyMap<string, number>): number[] {
  const out: number[] = [];
  for (const [id, v] of biggest(bets)) {
    const i = SPOT_INDEX.get(id);
    if (i !== undefined) out.push(i, round2(v));
  }
  return out;
}

export function decodeRoulette(data: unknown): Map<string, number> {
  const m = new Map<string, number>();
  if (!Array.isArray(data)) return m;
  for (let k = 0; k + 1 < data.length && m.size < MAX_SPOTS; k += 2) {
    const i = data[k],
      v = data[k + 1];
    if (!Number.isInteger(i) || i < 0 || i >= BET_SPOTS.length || !okAmount(v)) continue;
    m.set(BET_SPOTS[i].id, v);
  }
  return m;
}

/** Craps layout → flat [betId, amount, …] (ids are short: "pass", "place6", "comeOdds5"). */
export function encodeCraps(bets: ReadonlyMap<string, number>): (string | number)[] {
  const out: (string | number)[] = [];
  for (const [id, v] of biggest(bets)) out.push(id, round2(v));
  return out;
}

export function decodeCraps(data: unknown): Map<string, number> {
  const m = new Map<string, number>();
  if (!Array.isArray(data)) return m;
  for (let k = 0; k + 1 < data.length && m.size < MAX_SPOTS; k += 2) {
    const id = data[k],
      v = data[k + 1];
    if (typeof id !== 'string' || id.length > 20 || !betInfo(id) || !okAmount(v)) continue;
    m.set(id, v);
  }
  return m;
}

/** How a friend's chip stack fares on a spin or roll (drives the dealer's sweep and payouts). */
export interface FriendBetResult {
  id: string;
  stake: number;
  outcome: 'win' | 'lose' | 'push' | 'move';
  /** Winnings beside the stake. */
  won: number;
  /** The stake stays on the layout after a win (place bets) or push. */
  staysUp?: boolean;
  /** Where a come bet travels to. */
  to?: string;
}

/** Settles a friend's roulette layout against a pocket (display only: no bankroll involved). */
export function resolveRoulette(bets: ReadonlyMap<string, number>, pocket: Pocket): FriendBetResult[] {
  const out: FriendBetResult[] = [];
  for (const [id, stake] of bets) {
    const spot = SPOTS_BY_ID.get(id);
    if (!spot) continue;
    const won = spot.numbers.includes(pocket);
    out.push({ id, stake, outcome: won ? 'win' : 'lose', won: won ? stake * spot.payout : 0 });
  }
  return out;
}

/**
 * Settles a friend's craps layout for a roll with a throwaway game (its own
 * bankroll), returning what happened to each stack and what stays on the felt.
 */
export function resolveCraps(bets: ReadonlyMap<string, number>, dice: [number, number], point: number | null): { results: FriendBetResult[]; next: Map<string, number> } {
  const g = new CrapsGame(new Bankroll({ balance: 1e12 }));
  g.point = point;
  for (const [id, v] of bets) if (betInfo(id)) g.bets.set(id, v);
  const r = g.resolve(dice);
  return { results: r.results.map((x: CrapsBetResult) => ({ id: x.id, stake: x.stake, outcome: x.outcome, won: x.won, staysUp: x.staysUp, to: x.to })), next: new Map(g.bets) };
}

/** A classic/video slot spin: which machine, where the reels stopped, the bet and multiplier. */
export interface SlotSpinMsg {
  i: number;
  s: number[];
  b: number;
  x: number;
}

export function decodeSlotSpin(data: unknown, machines: readonly Machine[]): SlotSpinMsg | null {
  const d = data as Partial<SlotSpinMsg> | null;
  if (!d || !Number.isInteger(d.i) || d.i! < 0 || d.i! >= machines.length) return null;
  const m = machines[d.i!];
  if (!Array.isArray(d.s) || d.s.length !== m.reels.length) return null;
  if (!d.s.every((v, k) => Number.isInteger(v) && v >= 0 && v < m.reels[k].length)) return null;
  if (!okAmount(d.b)) return null;
  const x = typeof d.x === 'number' && d.x >= 1 && d.x <= 10 ? d.x : 1;
  return { i: d.i!, s: d.s, b: d.b!, x };
}

/** What a friend's Porkbelly spin looked like, compactly. */
export interface PiggySpinMsg {
  /** Reel stops (on the free-games strips when free). */
  s: number[];
  /** Free game (1) or paid (0). */
  f: 0 | 1;
  b: number;
  /**
   * Modifiers [bits, blue, yellow, red] (bit 1 blue, 2 yellow, 4 red): the
   * free games' (they define the free strips), or what a paid spin triggered.
   */
  m: number[];
  /** Coins: [reel, row, colour index, result index (0 none, 1 fill, 2 trigger)]. */
  c: number[][];
  /** Jackpot coins: [reel, row, jackpot]. */
  j: number[][];
  /** Jackpots won: [jackpot, amount]. */
  w: number[][];
  /** Their pot levels after the spin [blue, yellow, red]. */
  p: number[];
  /** Free games: [games left, total]. */
  k?: number[];
}

const RESULTS: CoinEvent['result'][] = ['none', 'feed', 'trigger'];

const packMods = (m: Modifiers | null): number[] => (m ? [COLORS.reduce((a, c, k) => a | (m.features[c] ? 1 << k : 0), 0), ...COLORS.map((c) => m.levels[c])] : [0, 0, 0, 0]);

export function encodePiggySpin(
  out: { free: boolean; bet: number; stops: number[]; coins: CoinEvent[]; jackpotCoins: { reel: number; row: number; jackpot: number }[]; jackpotWins: { jackpot: number; amount: number }[]; triggered: Modifiers | null; bank: { pots: Record<CoinColor, number> } },
  bonus: (Modifiers & { spinsLeft: number; totalSpins: number }) | null,
): PiggySpinMsg {
  const msg: PiggySpinMsg = {
    s: out.stops,
    f: out.free ? 1 : 0,
    b: out.bet,
    m: packMods(out.free ? bonus : out.triggered),
    c: out.coins.slice(0, 15).map((c) => [c.reel, c.row, COLORS.indexOf(c.color), RESULTS.indexOf(c.result)]),
    j: out.jackpotCoins.slice(0, 15).map((c) => [c.reel, c.row, c.jackpot]),
    w: out.jackpotWins.slice(0, 5).map((w) => [w.jackpot, round2(w.amount)]),
    p: COLORS.map((c) => out.bank.pots[c]),
  };
  if (out.free && bonus) msg.k = [bonus.spinsLeft, bonus.totalSpins];
  return msg;
}

const cell = (a: unknown): a is number[] => Array.isArray(a) && a.length >= 2 && Number.isInteger(a[0]) && a[0] >= 0 && a[0] < 5 && Number.isInteger(a[1]) && a[1] >= 0 && a[1] < 3;
const level = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= POT_MAX ? (v as number) : 0);

export interface PiggyRemoteSpin {
  free: boolean;
  bet: number;
  stops: number[];
  strips: string[][];
  coins: CoinEvent[];
  jackpotCoins: { reel: number; row: number; jackpot: number }[];
  jackpotWins: { jackpot: number; amount: number }[];
  /** Paid spin: what it triggered. Free game: the free games' modifiers. */
  mods: Modifiers | null;
  pots: Record<CoinColor, number>;
  /** Free games: [left, total]. */
  games: [number, number] | null;
}

export function decodePiggySpin(data: unknown): PiggyRemoteSpin | null {
  const d = data as Partial<PiggySpinMsg> | null;
  if (!d || !Array.isArray(d.s) || d.s.length !== PIGGY.reels.length || !okAmount(d.b)) return null;
  const free = d.f === 1;
  const m = Array.isArray(d.m) ? d.m : [];
  const bits = Number.isInteger(m[0]) ? (m[0] as number) & 7 : 0;
  const mods: Modifiers | null = bits
    ? { features: Object.fromEntries(COLORS.map((c, k) => [c, !!(bits & (1 << k))])) as Record<Feature, boolean>, levels: Object.fromEntries(COLORS.map((c, k) => [c, bits & (1 << k) ? level(m[k + 1]) : 0])) as Record<Feature, number> }
    : null;
  if (free && !mods) return null;
  const strips = free ? freeReels(mods!) : PIGGY.reels.map((s) => [...s]);
  if (!d.s.every((v, k) => Number.isInteger(v) && v >= 0 && v < strips[k].length)) return null;
  const coins: CoinEvent[] = free ? [] : (Array.isArray(d.c) ? d.c : []).filter(cell).filter((c) => COLORS[c[2]] && RESULTS[c[3]]).slice(0, 15).map((c) => ({ reel: c[0], row: c[1], color: COLORS[c[2]] as CoinColor, result: RESULTS[c[3]] }));
  const jackpotCoins = (Array.isArray(d.j) ? d.j : []).filter(cell).filter((c) => Number.isInteger(c[2]) && c[2] >= 0 && c[2] < JACKPOT_NAMES.length).slice(0, 15).map((c) => ({ reel: c[0], row: c[1], jackpot: c[2] }));
  const jackpotWins = (Array.isArray(d.w) ? d.w : []).filter((w) => Array.isArray(w) && Number.isInteger(w[0]) && w[0] >= 0 && w[0] < JACKPOT_NAMES.length && okAmount(w[1])).slice(0, 5).map((w) => ({ jackpot: w[0], amount: w[1] }));
  const p = Array.isArray(d.p) ? d.p : [];
  const pots = Object.fromEntries(COLORS.map((c, k) => [c, level(p[k])])) as Record<CoinColor, number>;
  const k = Array.isArray(d.k) && Number.isInteger(d.k[0]) && Number.isInteger(d.k[1]) && d.k[0] >= 0 && d.k[1] > 0 && d.k[1] <= 99 && d.k[0] <= d.k[1] ? ([d.k[0], d.k[1]] as [number, number]) : null;
  return { free, bet: d.b!, stops: d.s, strips, coins, jackpotCoins, jackpotWins, mods, pots, games: free ? k : null };
}
