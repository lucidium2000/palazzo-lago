import type { Bankroll } from './bankroll';
import type { Rng } from './rng';

/**
 * Las Vegas Strip craps.
 *
 * Bets and pays (winnings per unit, "to 1"):
 *  - Pass / Don't Pass, Come / Don't Come: even money. Don't bars 12.
 *  - Odds behind a line bet (3-4-5x): true odds 2:1 on 4/10, 3:2 on 5/9, 6:5 on 6/8;
 *    lay odds behind a don't bet up to 6x the flat bet: 1:2, 2:3, 5:6.
 *  - Place: 9:5 on 4/10, 7:5 on 5/9, 7:6 on 6/8. Off on the come-out.
 *  - Field: 1:1 on 3 4 9 10 11, 2:1 on 2, 3:1 on 12.
 *  - Big 6 / Big 8: even money.
 *  - Hardways: hard 6/8 9:1, hard 4/10 7:1. Off on the come-out.
 *  - One-roll: Any Seven 4:1, Any Craps 7:1, 2 or 12 30:1, 3 or 11 15:1,
 *    C (any craps) 7:1, E (eleven) 15:1.
 *
 * Contract bets (Pass once a point is set, Come bets that have travelled to a
 * number) can't be taken down. Place, Big and Hardway bets stay up after a win
 * (only the winnings are paid). Payouts are rounded down to the dollar, as
 * dealers pay in whole chips; bet $6 units on 6/8 and $5 units on 5/9 to get
 * every cent.
 */

export const POINTS = [4, 5, 6, 8, 9, 10] as const;
export type PointNumber = (typeof POINTS)[number];
export const isPoint = (n: number): n is PointNumber => (POINTS as readonly number[]).includes(n);

export type CrapsBetKind =
  | 'pass'
  | 'dontPass'
  | 'passOdds'
  | 'dontOdds'
  | 'come'
  | 'dontCome'
  | 'comePoint'
  | 'comeOdds'
  | 'dontComePoint'
  | 'dontComeOdds'
  | 'field'
  | 'place'
  | 'big'
  | 'hard'
  | 'any7'
  | 'anyCraps'
  | 'two'
  | 'three'
  | 'eleven'
  | 'twelve'
  | 'ceC'
  | 'ceE';

export interface CrapsBetInfo {
  kind: CrapsBetKind;
  /** The number for place/hard/big/come points. */
  n?: number;
  name: string;
  oneRoll: boolean;
}

/** Bet ids: 'pass', 'place6', 'hard8', 'come5' (a come bet on 5), 'comeOdds5', 'big6', ... */
export function betInfo(id: string): CrapsBetInfo | null {
  const m = id.match(/^([a-zA-Z]+?)(\d+)?$/);
  if (!m) return null;
  const [, k, nStr] = m;
  const n = nStr ? Number(nStr) : undefined;
  const simple: Record<string, [CrapsBetKind, string, boolean]> = {
    pass: ['pass', 'Pass Line', false],
    dontPass: ['dontPass', "Don't Pass", false],
    passOdds: ['passOdds', 'Pass Odds', false],
    dontOdds: ['dontOdds', "Don't Pass Odds", false],
    come: ['come', 'Come', false],
    dontCome: ['dontCome', "Don't Come", false],
    field: ['field', 'Field', true],
    any: ['any7', 'Any Seven', true],
    anyCraps: ['anyCraps', 'Any Craps', true],
    two: ['two', 'Two (Aces)', true],
    three: ['three', 'Three (Ace-Deuce)', true],
    eleven: ['eleven', 'Eleven (Yo)', true],
    twelve: ['twelve', 'Twelve (Boxcars)', true],
    ceC: ['ceC', 'C · Any Craps', true],
    ceE: ['ceE', 'E · Eleven', true],
  };
  if (n === undefined) {
    const s = simple[k];
    return s ? { kind: s[0], name: s[1], oneRoll: s[2] } : null;
  }
  if (k === 'any' && n === 7) return { kind: 'any7', name: 'Any Seven', oneRoll: true };
  if (k === 'place' && isPoint(n)) return { kind: 'place', n, name: `Place ${n}`, oneRoll: false };
  if (k === 'big' && (n === 6 || n === 8)) return { kind: 'big', n, name: `Big ${n}`, oneRoll: false };
  if (k === 'hard' && [4, 6, 8, 10].includes(n)) return { kind: 'hard', n, name: `Hard ${n}`, oneRoll: false };
  if (k === 'come' && isPoint(n)) return { kind: 'comePoint', n, name: `Come ${n}`, oneRoll: false };
  if (k === 'comeOdds' && isPoint(n)) return { kind: 'comeOdds', n, name: `Odds on Come ${n}`, oneRoll: false };
  if (k === 'dontCome' && isPoint(n)) return { kind: 'dontComePoint', n, name: `Don't Come ${n}`, oneRoll: false };
  if (k === 'dontComeOdds' && isPoint(n)) return { kind: 'dontComeOdds', n, name: `Lay Odds on ${n}`, oneRoll: false };
  return null;
}

export interface CrapsLimits {
  /** Line, come, field, place, big: table minimum. */
  tableMin: number;
  /** Proposition bets in the middle. */
  propMin: number;
  max: number;
}

export const DEFAULT_CRAPS_LIMITS: CrapsLimits = { tableMin: 10, propMin: 1, max: 5_000 };

/** True odds (winnings per unit) for odds bets on a point. */
export const TRUE_ODDS: Record<PointNumber, [number, number]> = { 4: [2, 1], 10: [2, 1], 5: [3, 2], 9: [3, 2], 6: [6, 5], 8: [6, 5] };
const PLACE_ODDS: Record<PointNumber, [number, number]> = { 4: [9, 5], 10: [9, 5], 5: [7, 5], 9: [7, 5], 6: [7, 6], 8: [7, 6] };
/** 3-4-5x odds. */
export const MAX_ODDS: Record<PointNumber, number> = { 4: 3, 10: 3, 5: 4, 9: 4, 6: 5, 8: 5 };
const ONE_ROLL: Partial<Record<CrapsBetKind, { wins: (t: number) => boolean; pays: number }>> = {
  any7: { wins: (t) => t === 7, pays: 4 },
  anyCraps: { wins: (t) => t === 2 || t === 3 || t === 12, pays: 7 },
  ceC: { wins: (t) => t === 2 || t === 3 || t === 12, pays: 7 },
  two: { wins: (t) => t === 2, pays: 30 },
  twelve: { wins: (t) => t === 12, pays: 30 },
  three: { wins: (t) => t === 3, pays: 15 },
  eleven: { wins: (t) => t === 11, pays: 15 },
  ceE: { wins: (t) => t === 11, pays: 15 },
};

/** Winnings for `stake` at a:b, rounded down to the dollar. */
const pay = (stake: number, [a, b]: [number, number]) => Math.floor((stake * a) / b + 1e-9);

export type BetOutcome = 'win' | 'lose' | 'push' | 'move';

export interface CrapsBetResult {
  id: string;
  stake: number;
  outcome: BetOutcome;
  /** Winnings paid to the player (excluding the stake). */
  won: number;
  /** Chips returned to the player: winnings, plus the stake if the bet comes down. */
  returned: number;
  /** Where a moved bet went (come → come6), or whether it stays up after a win. */
  to?: string;
  staysUp?: boolean;
}

export interface RollResult {
  dice: [number, number];
  total: number;
  hard: boolean;
  comeOut: boolean;
  pointBefore: number | null;
  pointAfter: number | null;
  results: CrapsBetResult[];
  totalWon: number;
  totalLost: number;
  /** The stickman's call, e.g. "Seven, front line winner!" */
  call: string;
  /** The shooter sevened out. */
  sevenOut: boolean;
  /** The shooter made the point. */
  pointMade: boolean;
}

export class CrapsBetRejected extends Error {}

export class CrapsGame {
  point: number | null = null;
  readonly bets = new Map<string, number>();
  history: [number, number][] = [];
  /** Rolls by the current shooter (resets on seven-out). */
  shooterRolls = 0;
  /** Points made by the current shooter. */
  pointsMade = 0;

  constructor(
    private bankroll: Bankroll,
    readonly limits: CrapsLimits = DEFAULT_CRAPS_LIMITS,
  ) {}

  get comeOut(): boolean {
    return this.point === null;
  }

  get totalOnTable(): number {
    let t = 0;
    for (const v of this.bets.values()) t += v;
    return t;
  }

  /** The most that may go on this bet right now (odds caps, table max). */
  maxFor(id: string): number {
    const info = betInfo(id);
    if (!info) return 0;
    const flatOdds = (flat: number, n: number, lay: boolean) => {
      if (!isPoint(n)) return 0;
      if (lay) {
        // Lay up to 6x the flat bet (wins at most the same as 3-4-5x).
        return flat * 6;
      }
      return flat * MAX_ODDS[n];
    };
    switch (info.kind) {
      case 'passOdds':
        return this.point ? flatOdds(this.bets.get('pass') ?? 0, this.point, false) : 0;
      case 'dontOdds':
        return this.point ? flatOdds(this.bets.get('dontPass') ?? 0, this.point, true) : 0;
      case 'comeOdds':
        return flatOdds(this.bets.get(`come${info.n}`) ?? 0, info.n!, false);
      case 'dontComeOdds':
        return flatOdds(this.bets.get(`dontCome${info.n}`) ?? 0, info.n!, true);
      default:
        return this.limits.max;
    }
  }

  /** Why this bet can't be made right now, or null. */
  problem(id: string, amount: number): string | null {
    const info = betInfo(id);
    if (!info) return 'Not a bet';
    if (!(amount > 0)) return 'Bet something';
    const cur = this.bets.get(id) ?? 0;
    switch (info.kind) {
      case 'pass':
      case 'dontPass':
        if (!this.comeOut && info.kind === 'pass' && cur === 0) {
          // Strip tables allow a "put" bet, but it's a bad one; keep it simple.
          return 'Pass Line bets go down on the come-out roll';
        }
        if (!this.comeOut) return info.kind === 'pass' ? 'The Pass Line is a contract bet once the point is on' : "Don't Pass bets go down on the come-out roll";
        break;
      case 'come':
      case 'dontCome':
        if (this.comeOut) return `${info.name} bets need a point — use the ${info.kind === 'come' ? 'Pass Line' : "Don't Pass"} on the come-out`;
        break;
      case 'passOdds':
        if (this.comeOut) return 'Odds go behind the Pass Line once a point is set';
        if (!this.bets.has('pass')) return 'Make a Pass Line bet first';
        break;
      case 'dontOdds':
        if (this.comeOut) return 'Lay odds once a point is set';
        if (!this.bets.has('dontPass')) return "Make a Don't Pass bet first";
        break;
      case 'comeOdds':
        if (!this.bets.has(`come${info.n}`)) return `No Come bet on the ${info.n}`;
        break;
      case 'dontComeOdds':
        if (!this.bets.has(`dontCome${info.n}`)) return `No Don't Come bet on the ${info.n}`;
        break;
      case 'comePoint':
      case 'dontComePoint':
        return 'Come bets move to the numbers by themselves';
      default:
        break;
    }
    const isProp = info.oneRoll && info.kind !== 'field';
    const isOdds = ['passOdds', 'dontOdds', 'comeOdds', 'dontComeOdds'].includes(info.kind);
    if (!isOdds && cur + amount < (isProp || info.kind === 'hard' ? this.limits.propMin : this.limits.tableMin)) {
      // Minimums are on the total in the spot: two $5 chips make a $10 bet.
      return null;
    }
    const max = this.maxFor(id);
    if (cur + amount > max) {
      if (isOdds) return max === 0 ? 'No odds available there' : `Odds max here is $${max.toLocaleString('en-US')} (3-4-5x)`;
      return `Table maximum is $${max.toLocaleString('en-US')}`;
    }
    if (!this.bankroll.canAfford(amount)) return 'Not enough chips';
    return null;
  }

  placeBet(id: string, amount: number): void {
    const p = this.problem(id, amount);
    if (p) throw new CrapsBetRejected(p);
    this.bankroll.debit(amount, 'bet', 'craps');
    this.bets.set(id, (this.bets.get(id) ?? 0) + amount);
  }

  /** Can this bet be picked up? Contract bets can't. */
  canRemove(id: string): boolean {
    const info = betInfo(id);
    if (!info || !this.bets.has(id)) return false;
    if (info.kind === 'pass' && !this.comeOut) return false;
    if (info.kind === 'comePoint') return false;
    return true;
  }

  removeBet(id: string): number {
    if (!this.canRemove(id)) return 0;
    const amount = this.bets.get(id)!;
    this.bets.delete(id);
    // Taking down a flat bet takes its odds down with it.
    const info = betInfo(id)!;
    let extra = 0;
    if (info.kind === 'dontPass') extra += this.removeBet('dontOdds');
    if (info.kind === 'dontComePoint') extra += this.removeBet(`dontComeOdds${info.n}`);
    this.bankroll.credit(amount, 'refund', 'craps');
    return amount + extra;
  }

  /** Why the stickman won't send the dice yet (minimums), or null. */
  minimumProblem(): string | null {
    for (const [id, v] of this.bets) {
      const info = betInfo(id)!;
      if (['passOdds', 'dontOdds', 'comeOdds', 'dontComeOdds', 'comePoint', 'dontComePoint'].includes(info.kind)) continue;
      const isProp = info.oneRoll && info.kind !== 'field';
      const min = isProp || info.kind === 'hard' ? this.limits.propMin : this.limits.tableMin;
      if (v < min) return `${info.name} needs at least $${min}`;
    }
    return null;
  }

  roll(rng: Rng): RollResult {
    const problem = this.minimumProblem();
    if (problem) throw new CrapsBetRejected(problem);
    return this.resolve([rng.int(6) + 1, rng.int(6) + 1]);
  }

  /** Settles every bet for a given pair of dice. */
  resolve(dice: [number, number]): RollResult {
    const [a, b] = dice;
    const t = a + b;
    const hard = a === b;
    const comeOut = this.point === null;
    const pointBefore = this.point;
    const results: CrapsBetResult[] = [];
    const next = new Map<string, number>();
    let totalWon = 0;
    let totalLost = 0;

    const win = (id: string, stake: number, won: number, staysUp: boolean) => {
      results.push({ id, stake, outcome: 'win', won, returned: won + (staysUp ? 0 : stake), staysUp });
      totalWon += won;
      if (staysUp) next.set(id, stake);
    };
    const lose = (id: string, stake: number) => {
      results.push({ id, stake, outcome: 'lose', won: 0, returned: 0 });
      totalLost += stake;
    };
    const push = (id: string, stake: number, returned = true) => {
      results.push({ id, stake, outcome: 'push', won: 0, returned: returned ? stake : 0, staysUp: !returned });
      if (!returned) next.set(id, stake);
    };
    const keep = (id: string, stake: number) => next.set(id, stake);

    for (const [id, stake] of this.bets) {
      const info = betInfo(id)!;
      const n = info.n!;
      switch (info.kind) {
        case 'pass':
          if (comeOut) {
            if (t === 7 || t === 11) win(id, stake, stake, true);
            else if (t === 2 || t === 3 || t === 12) lose(id, stake);
            else keep(id, stake);
          } else if (t === this.point) win(id, stake, stake, false);
          else if (t === 7) lose(id, stake);
          else keep(id, stake);
          break;
        case 'dontPass':
          if (comeOut) {
            if (t === 2 || t === 3) win(id, stake, stake, true);
            else if (t === 12) push(id, stake, false);
            else if (t === 7 || t === 11) lose(id, stake);
            else keep(id, stake);
          } else if (t === 7) win(id, stake, stake, false);
          else if (t === this.point) lose(id, stake);
          else keep(id, stake);
          break;
        case 'passOdds':
          if (t === this.point) win(id, stake, pay(stake, TRUE_ODDS[this.point as PointNumber]), false);
          else if (t === 7) lose(id, stake);
          else keep(id, stake);
          break;
        case 'dontOdds': {
          if (t === 7) {
            const [x, y] = TRUE_ODDS[this.point as PointNumber];
            win(id, stake, pay(stake, [y, x]), false);
          } else if (t === this.point) lose(id, stake);
          else keep(id, stake);
          break;
        }
        case 'come':
          if (t === 7 || t === 11) win(id, stake, stake, false);
          else if (t === 2 || t === 3 || t === 12) lose(id, stake);
          else {
            const to = `come${t}`;
            results.push({ id, stake, outcome: 'move', won: 0, returned: 0, to });
            next.set(to, (next.get(to) ?? 0) + stake);
          }
          break;
        case 'dontCome':
          if (t === 2 || t === 3) win(id, stake, stake, false);
          else if (t === 12) push(id, stake, false);
          else if (t === 7 || t === 11) lose(id, stake);
          else {
            const to = `dontCome${t}`;
            results.push({ id, stake, outcome: 'move', won: 0, returned: 0, to });
            next.set(to, (next.get(to) ?? 0) + stake);
          }
          break;
        case 'comePoint':
          if (t === n) win(id, stake, stake, false);
          else if (t === 7) lose(id, stake);
          else keep(id, stake);
          break;
        case 'comeOdds':
          // Odds on come bets are off on the come-out roll.
          if (t === n) {
            if (comeOut) push(id, stake);
            else win(id, stake, pay(stake, TRUE_ODDS[n as PointNumber]), false);
          } else if (t === 7) {
            if (comeOut) push(id, stake);
            else lose(id, stake);
          } else keep(id, stake);
          break;
        case 'dontComePoint':
          if (t === 7) win(id, stake, stake, false);
          else if (t === n) lose(id, stake);
          else keep(id, stake);
          break;
        case 'dontComeOdds': {
          const [x, y] = TRUE_ODDS[n as PointNumber];
          if (t === 7) win(id, stake, pay(stake, [y, x]), false);
          else if (t === n) lose(id, stake);
          else keep(id, stake);
          break;
        }
        case 'field':
          if (t === 2) win(id, stake, stake * 2, false);
          else if (t === 12) win(id, stake, stake * 3, false);
          else if ([3, 4, 9, 10, 11].includes(t)) win(id, stake, stake, false);
          else lose(id, stake);
          break;
        case 'place':
          if (comeOut) keep(id, stake);
          else if (t === n) win(id, stake, pay(stake, PLACE_ODDS[n as PointNumber]), true);
          else if (t === 7) lose(id, stake);
          else keep(id, stake);
          break;
        case 'big':
          if (t === n) win(id, stake, stake, true);
          else if (t === 7) lose(id, stake);
          else keep(id, stake);
          break;
        case 'hard':
          if (comeOut) keep(id, stake);
          else if (t === n && hard) win(id, stake, stake * (n === 6 || n === 8 ? 9 : 7), true);
          else if (t === 7 || t === n) lose(id, stake);
          else keep(id, stake);
          break;
        default: {
          const r = ONE_ROLL[info.kind]!;
          if (r.wins(t)) win(id, stake, stake * r.pays, false);
          else lose(id, stake);
        }
      }
    }

    // Pay the player.
    const back = results.reduce((s, r) => s + r.returned, 0);
    if (back > 0) this.bankroll.credit(back, 'win', 'craps');
    this.bankroll.countRound();
    this.bets.clear();
    for (const [k, v] of next) this.bets.set(k, v);

    // Move the puck.
    let sevenOut = false;
    let pointMade = false;
    if (comeOut) {
      if (isPoint(t)) this.point = t;
    } else if (t === this.point) {
      this.point = null;
      pointMade = true;
      this.pointsMade++;
    } else if (t === 7) {
      this.point = null;
      sevenOut = true;
    }
    this.shooterRolls = sevenOut ? 0 : this.shooterRolls + 1;
    if (sevenOut) this.pointsMade = 0;
    this.history.unshift(dice);
    this.history.length = Math.min(this.history.length, 30);

    return {
      dice,
      total: t,
      hard,
      comeOut,
      pointBefore,
      pointAfter: this.point,
      results,
      totalWon,
      totalLost,
      call: stickCall(dice, comeOut, pointBefore, sevenOut, pointMade),
      sevenOut,
      pointMade,
    };
  }
}

/** What the stickman says. */
export function stickCall(dice: [number, number], comeOut: boolean, point: number | null, sevenOut: boolean, pointMade: boolean): string {
  const [a, b] = dice;
  const t = a + b;
  const hard = a === b;
  if (sevenOut) return 'Seven out! Line away, pay the don\'ts.';
  if (pointMade) return `${t}${hard ? ' the hard way' : ''}! Winner, pay the line!`;
  if (comeOut) {
    if (t === 7) return 'Seven, front line winner!';
    if (t === 11) return 'Yo-leven! Front line winner!';
    if (t === 2) return 'Aces! Craps, line away.';
    if (t === 3) return 'Ace-deuce, craps. Line away.';
    if (t === 12) return 'Boxcars! Craps.';
    return `The point is ${t}. Mark it!`;
  }
  if (t === 11) return 'Yo-leven!';
  if (t === 2) return 'Aces, snake eyes!';
  if (t === 3) return 'Ace-deuce, three craps three.';
  if (t === 12) return 'Midnight, boxcars!';
  const names: Record<number, string> = { 4: 'Four', 5: 'Five, no field five', 6: 'Six', 8: 'Eight', 9: 'Nine, center field nine', 10: 'Ten' };
  return `${names[t]}${hard ? ' the hard way' : t === 6 || t === 8 || t === 4 || t === 10 ? ', easy' : ''}.${point ? ` Point is ${point}.` : ''}`;
}
