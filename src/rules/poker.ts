import type { Card } from './blackjack';
import type { Rng } from './rng';

export type { Card };

/**
 * No-limit Texas Hold'em as dealt in the poker room: a fresh 52-card deck each
 * hand, a button, small and big blinds, four betting rounds (preflop, flop,
 * turn, river), no-limit raising with the standard minimum-raise rule, side
 * pots when players are all in, and a showdown ranked by the best five cards
 * of seven (split pots on ties, odd chips to the first winner left of the
 * button). The hand is played a step at a time (like blackjack's TableRound):
 * `start()` and each `act()` return the steps they caused, so the client can
 * animate them; NPCs decide through `npcDecide`, players through the table.
 *
 * Cards use blackjack's Card (rank 1 = ace .. 13 = king, suit 0..3); aces
 * count high (and low in the wheel, A-2-3-4-5). Amounts are whole dollars.
 */

// ---------------------------------------------------------------------------
// Cards and hand ranking
// ---------------------------------------------------------------------------

export const CATEGORY = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'] as const;
export const HIGH = 0,
  PAIR = 1,
  TWO_PAIR = 2,
  TRIPS = 3,
  STRAIGHT = 4,
  FLUSH = 5,
  FULL_HOUSE = 6,
  QUADS = 7,
  STRAIGHT_FLUSH = 8;

/** Poker value of a card: 2..14 (ace high). */
export const pv = (c: Card) => (c.rank === 1 ? 14 : c.rank);

const RANK_NAME: Record<number, [string, string]> = {
  2: ['Two', 'Twos'],
  3: ['Three', 'Threes'],
  4: ['Four', 'Fours'],
  5: ['Five', 'Fives'],
  6: ['Six', 'Sixes'],
  7: ['Seven', 'Sevens'],
  8: ['Eight', 'Eights'],
  9: ['Nine', 'Nines'],
  10: ['Ten', 'Tens'],
  11: ['Jack', 'Jacks'],
  12: ['Queen', 'Queens'],
  13: ['King', 'Kings'],
  14: ['Ace', 'Aces'],
};

/** A shuffled 52-card deck (Fisher-Yates). */
export function newDeck(rng: Rng): Card[] {
  const d: Card[] = [];
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) d.push({ rank: r, suit: s });
  for (let i = d.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

const B = 15;
const pack = (cat: number, ranks: number[]) => {
  let s = cat;
  for (let i = 0; i < 5; i++) s = s * B + (ranks[i] ?? 0);
  return s;
};

/** The category and tie-break ranks packed in a score. */
export function unpackScore(score: number): { cat: number; ranks: number[] } {
  const ranks: number[] = [];
  let s = score;
  for (let i = 0; i < 5; i++) {
    ranks.unshift(s % B);
    s = Math.floor(s / B);
  }
  return { cat: s, ranks };
}

/** Highest card of a straight in a rank bitmask (bit v set for value v), counting the wheel; 0 if none. */
function straightHigh(mask: number): number {
  if (mask & (1 << 14)) mask |= 1 << 1;
  for (let h = 14; h >= 5; h--) {
    const need = 0b11111 << (h - 4);
    if ((mask & need) === need) return h;
  }
  return 0;
}

/** The `n` highest values in a rank bitmask, excluding `skip`. */
function top(mask: number, n: number, ...skip: number[]): number[] {
  const out: number[] = [];
  for (let v = 14; v >= 2 && out.length < n; v--) if (mask & (1 << v) && !skip.includes(v)) out.push(v);
  return out;
}

/**
 * Score of the best five-card hand in 5 to 7 cards: higher beats lower, equal
 * scores tie. The category is the most significant digit, then the ranks that
 * break ties (the pair, then the kickers, …) in base 15.
 */
export function handScore(cards: readonly Card[]): number {
  const cnt = new Array<number>(15).fill(0);
  const suitMask = [0, 0, 0, 0];
  const suitCnt = [0, 0, 0, 0];
  let mask = 0;
  for (const c of cards) {
    const v = pv(c);
    cnt[v]++;
    mask |= 1 << v;
    suitMask[c.suit] |= 1 << v;
    suitCnt[c.suit]++;
  }
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) if (suitCnt[s] >= 5) flushSuit = s;
  if (flushSuit >= 0) {
    const sf = straightHigh(suitMask[flushSuit]);
    if (sf) return pack(STRAIGHT_FLUSH, [sf]);
  }
  const quads: number[] = [],
    trips: number[] = [],
    pairs: number[] = [];
  for (let v = 14; v >= 2; v--) {
    if (cnt[v] === 4) quads.push(v);
    else if (cnt[v] === 3) trips.push(v);
    else if (cnt[v] === 2) pairs.push(v);
  }
  if (quads.length) return pack(QUADS, [quads[0], ...top(mask, 1, quads[0])]);
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const p = Math.max(trips[1] ?? 0, pairs[0] ?? 0);
    return pack(FULL_HOUSE, [trips[0], p]);
  }
  if (flushSuit >= 0) return pack(FLUSH, top(suitMask[flushSuit], 5));
  const st = straightHigh(mask);
  if (st) return pack(STRAIGHT, [st]);
  if (trips.length) return pack(TRIPS, [trips[0], ...top(mask, 2, trips[0])]);
  if (pairs.length >= 2) return pack(TWO_PAIR, [pairs[0], pairs[1], ...top(mask, 1, pairs[0], pairs[1])]);
  if (pairs.length) return pack(PAIR, [pairs[0], ...top(mask, 3, pairs[0])]);
  return pack(HIGH, top(mask, 5));
}

/** Words for a score: "Pair of Kings", "Aces full of Tens", "Royal Flush". */
export function describe(score: number): string {
  const { cat, ranks } = unpackScore(score);
  const one = (v: number) => RANK_NAME[v]?.[0] ?? '?';
  const many = (v: number) => RANK_NAME[v]?.[1] ?? '?';
  switch (cat) {
    case STRAIGHT_FLUSH:
      return ranks[0] === 14 ? 'Royal Flush' : `${one(ranks[0])}-high Straight Flush`;
    case QUADS:
      return `Four ${many(ranks[0])}`;
    case FULL_HOUSE:
      return `${many(ranks[0])} full of ${many(ranks[1])}`;
    case FLUSH:
      return `${one(ranks[0])}-high Flush`;
    case STRAIGHT:
      return `${one(ranks[0])}-high Straight`;
    case TRIPS:
      return `Three ${many(ranks[0])}`;
    case TWO_PAIR:
      return `${many(ranks[0])} and ${many(ranks[1])}`;
    case PAIR:
      return `Pair of ${many(ranks[0])}`;
    default:
      return `${one(ranks[0])} high`;
  }
}

export interface HandRank {
  score: number;
  cat: number;
  name: string;
  /** The five cards that make the hand. */
  best: Card[];
}

/** Ranks 5–7 cards: the score, its words and the five cards it's made of. */
export function evaluate(cards: readonly Card[]): HandRank {
  let best: Card[] = cards.slice(0, 5);
  let score = -1;
  const n = cards.length;
  const pick: Card[] = [];
  const rec = (from: number) => {
    if (pick.length === 5) {
      const s = handScore(pick);
      if (s > score) {
        score = s;
        best = pick.slice();
      }
      return;
    }
    for (let i = from; i <= n - (5 - pick.length); i++) {
      pick.push(cards[i]);
      rec(i + 1);
      pick.pop();
    }
  };
  if (n <= 5) {
    score = handScore(cards);
    best = cards.slice();
  } else rec(0);
  return { score, cat: unpackScore(score).cat, name: describe(score), best };
}

// ---------------------------------------------------------------------------
// Pots
// ---------------------------------------------------------------------------

export interface Pot {
  amount: number;
  /** Seats that can win it (still in the hand and in for its full level). */
  eligible: number[];
}

/**
 * Splits everything put in this hand into the main pot and side pots. Each
 * level is set by what a live (not folded) player put in; a pot holds every
 * player's money up to its level, and only live players who put in at least
 * that much can win it. Folded players' chips stay in the pots they reached.
 */
export function buildPots(entries: readonly { seat: number; put: number; folded: boolean }[]): Pot[] {
  const levels = [...new Set(entries.filter((e) => !e.folded && e.put > 0).map((e) => e.put))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  levels.forEach((L, i) => {
    const last = i === levels.length - 1;
    let amount = 0;
    for (const e of entries) amount += Math.max(0, (last ? e.put : Math.min(e.put, L)) - Math.min(e.put, prev));
    const eligible = entries.filter((e) => !e.folded && e.put >= L).map((e) => e.seat);
    // A level nobody else matched merges into the pot below (it's the same contest).
    if (pots.length && eligible.length === pots[pots.length - 1].eligible.length) pots[pots.length - 1].amount += amount;
    else if (amount > 0) pots.push({ amount, eligible });
    prev = L;
  });
  if (!levels.length) {
    const amount = entries.reduce((s, e) => s + e.put, 0);
    if (amount > 0) pots.push({ amount, eligible: [] });
  }
  return pots;
}

/**
 * Who wins each pot: the best score among its eligible seats; ties split it
 * evenly, the odd dollars going one at a time to the winners in `order`
 * (clockwise from the button's left).
 */
export function awardPots(pots: readonly Pot[], scores: ReadonlyMap<number, number>, order: readonly number[]): { seat: number; amount: number; pot: number }[] {
  const out: { seat: number; amount: number; pot: number }[] = [];
  pots.forEach((pot, i) => {
    const elig = pot.eligible.filter((s) => scores.has(s));
    if (!elig.length) return;
    const best = Math.max(...elig.map((s) => scores.get(s)!));
    const winners = elig.filter((s) => scores.get(s) === best).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const share = Math.floor(pot.amount / winners.length);
    let odd = pot.amount - share * winners.length;
    for (const s of winners) {
      const extra = odd > 0 ? 1 : 0;
      odd -= extra;
      out.push({ seat: s, amount: share + extra, pot: i });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// The hand
// ---------------------------------------------------------------------------

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river'];

export type PokerAction = { kind: 'fold' } | { kind: 'check' } | { kind: 'call' } | { kind: 'raise'; to: number } | { kind: 'allin' };
export type ActKind = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

/** One step of a hand, in the order it happens at the table. */
export type PokerStep =
  | { kind: 'button'; seat: number }
  | { kind: 'blind'; seat: number; amount: number; big: boolean }
  /** Hole cards for a seat (hidden from everyone else on the wire: rank 0). */
  | { kind: 'deal'; seat: number; cards: Card[] }
  /** `put`: chips moved now; `to`: that seat's bet this street afterwards. */
  | { kind: 'act'; seat: number; act: ActKind; put: number; to: number; allIn: boolean }
  | { kind: 'turn'; seat: number }
  /** An uncalled bet handed back. */
  | { kind: 'return'; seat: number; amount: number }
  /** The street's bets go into the middle; `pot` is the total after. */
  | { kind: 'collect'; pot: number }
  | { kind: 'board'; street: Street; cards: Card[] }
  | { kind: 'show'; seat: number; cards: Card[]; name: string; score: number }
  | { kind: 'win'; seat: number; amount: number; pot: number; name: string }
  | { kind: 'end' };

export interface PokerEntry {
  seat: number;
  stack: number;
}

export interface PlayerState {
  seat: number;
  stack: number;
  /** In front of them this street. */
  bet: number;
  /** All they've put in this hand. */
  put: number;
  folded: boolean;
  allIn: boolean;
  hole: Card[];
  acted: boolean;
  /** The raise count when they last acted (a later full raise reopens their option). */
  seen: number;
}

/**
 * Chips you pushed out on your turn (VR: from the rack, your wallet tray or a
 * pointing finger), read as an action: all you have is all in, exactly the
 * call is a call, more is a raise to your street bet plus them (a call if it's
 * short of a full raise), a bet when nothing is owed. A `say` result means the
 * chips don't make an action yet (short of a call, under the minimum bet).
 */
export function stagedAction(L: Legal, staged: number): { action: PokerAction } | { say: string } | null {
  const S = staged;
  if (S <= 0) return null;
  const usd = (n: number) => '$' + n.toLocaleString('en-US');
  if (S >= L.stack) return { action: L.maxTo ? { kind: 'allin' } : { kind: 'call' } };
  if (L.call > 0 && S < L.call) return { say: `${usd(L.call - S)} more to call ${usd(L.call)}` };
  const to = L.bet + S;
  if (L.maxTo && to >= L.minTo) return { action: { kind: 'raise', to } };
  if (L.call > 0) return { action: { kind: 'call' } };
  if (L.maxTo) return { say: `Minimum bet is ${usd(L.minTo)}` };
  return { action: { kind: 'check' } };
}

export interface Legal {
  /** What it costs to stay in (0: a check is possible). Capped at the stack. */
  toCall: number;
  check: boolean;
  /** Chips a call puts in (0 if there's nothing to call). */
  call: number;
  /** A bet/raise may be made: total street bet from `minTo` up to `maxTo` (all in). 0 if not. */
  minTo: number;
  maxTo: number;
  /** The seat's current street bet and stack. */
  bet: number;
  stack: number;
}

export class PokerHand {
  readonly steps: PokerStep[] = [];
  readonly players: PlayerState[];
  readonly board: Card[] = [];
  street: Street = 'preflop';
  /** Collected into the middle so far (not counting this street's bets). */
  pot = 0;
  currentBet = 0;
  /** Size of the last full raise (the next raise must be at least this much more). */
  minRaise: number;
  private raises = 0;
  private turnIdx = -1;
  private deck: Card[];
  private started = false;
  private lastAggressor: number | null = null;
  done = false;
  readonly button: number;
  readonly sbSeat: number;
  readonly bbSeat: number;

  constructor(
    rng: Rng,
    entries: readonly PokerEntry[],
    button: number,
    readonly sb: number,
    readonly bb: number,
    deck?: Card[],
  ) {
    this.players = [...entries]
      .filter((e) => e.stack > 0)
      .sort((a, b) => a.seat - b.seat)
      .map((e) => ({ seat: e.seat, stack: e.stack, bet: 0, put: 0, folded: false, allIn: false, hole: [], acted: false, seen: 0 }));
    if (this.players.length < 2) throw new Error('need two players');
    this.deck = deck ? deck.slice() : newDeck(rng);
    this.minRaise = bb;
    // The button moves to the given seat, or the next seat clockwise that's in this hand.
    const bi = this.players.findIndex((p) => p.seat >= button);
    const bIdx = bi < 0 ? 0 : bi;
    this.button = this.players[bIdx].seat;
    const n = this.players.length;
    const sbIdx = n === 2 ? bIdx : (bIdx + 1) % n;
    this.sbSeat = this.players[sbIdx].seat;
    this.bbSeat = this.players[(sbIdx + 1) % n].seat;
  }

  private idx(seat: number) {
    return this.players.findIndex((p) => p.seat === seat);
  }

  /** Seats clockwise starting left of the button. */
  get order(): number[] {
    const n = this.players.length;
    const b = this.idx(this.button);
    return Array.from({ length: n }, (_, k) => this.players[(b + 1 + k) % n].seat);
  }

  player(seat: number): PlayerState | undefined {
    return this.players[this.idx(seat)];
  }

  /** The seat the table is waiting on. */
  get waiting(): number | null {
    return this.done || this.turnIdx < 0 ? null : this.players[this.turnIdx].seat;
  }

  /** Everything in the middle and in front of players. */
  get totalPot(): number {
    return this.players.reduce((s, p) => s + p.put, 0);
  }

  private emit(out: PokerStep[], st: PokerStep) {
    this.steps.push(st);
    out.push(st);
  }

  private draw(): Card {
    return this.deck.shift()!;
  }

  private putIn(p: PlayerState, amount: number) {
    const a = Math.min(amount, p.stack);
    p.stack -= a;
    p.bet += a;
    p.put += a;
    if (p.stack === 0) p.allIn = true;
    return a;
  }

  /** Blinds, hole cards, then the first player to act. */
  start(): PokerStep[] {
    if (this.started) return [];
    this.started = true;
    const out: PokerStep[] = [];
    this.emit(out, { kind: 'button', seat: this.button });
    const sbP = this.player(this.sbSeat)!,
      bbP = this.player(this.bbSeat)!;
    this.emit(out, { kind: 'blind', seat: sbP.seat, amount: this.putIn(sbP, this.sb), big: false });
    this.emit(out, { kind: 'blind', seat: bbP.seat, amount: this.putIn(bbP, this.bb), big: true });
    this.currentBet = this.bb;
    // Two passes, one card at a time, starting left of the button.
    const order = this.order;
    for (let pass = 0; pass < 2; pass++) for (const s of order) this.player(s)!.hole.push(this.draw());
    for (const s of order) this.emit(out, { kind: 'deal', seat: s, cards: this.player(s)!.hole.slice() });
    // Preflop the action starts left of the big blind (heads up: the button, who is the small blind).
    this.turnIdx = this.idx(this.bbSeat);
    this.advance(out);
    return out;
  }

  private live() {
    return this.players.filter((p) => !p.folded);
  }

  private needsToAct(p: PlayerState) {
    if (p.folded || p.allIn) return false;
    // Alone against all-in players with nothing to call: no decision to make.
    const active = this.players.filter((q) => !q.folded && !q.allIn).length;
    if (active <= 1 && p.bet >= this.currentBet) return false;
    return !p.acted || p.bet < this.currentBet || p.seen < this.raises;
  }

  /** What the waiting seat may do. */
  legal(): Legal {
    const none: Legal = { toCall: 0, check: false, call: 0, minTo: 0, maxTo: 0, bet: 0, stack: 0 };
    if (this.done || this.turnIdx < 0) return none;
    const p = this.players[this.turnIdx];
    const owe = Math.max(0, this.currentBet - p.bet);
    const toCall = Math.min(owe, p.stack);
    const maxTo = p.bet + p.stack;
    // A raise needs someone left to raise against, and an open option (an incomplete all-in raise doesn't reopen it).
    const others = this.players.some((q) => q !== p && !q.folded && !q.allIn);
    const open = !p.acted || p.seen < this.raises;
    let minTo = this.currentBet === 0 ? Math.min(this.bb, maxTo) : this.currentBet + this.minRaise;
    let canRaise = others && open && maxTo > this.currentBet;
    if (minTo > maxTo) minTo = maxTo; // only all in for less than a full raise
    if (!canRaise) minTo = 0;
    return { toCall, check: owe === 0, call: owe > 0 ? toCall : 0, minTo, maxTo: canRaise ? maxTo : 0, bet: p.bet, stack: p.stack };
  }

  /**
   * The waiting seat's decision. Returns the steps it caused, or null if it
   * isn't that seat's turn or the move isn't allowed. A raise is given as the
   * total to bet this street (`to`); anything at or above the stack is all in.
   */
  act(seat: number, a: PokerAction): PokerStep[] | null {
    if (this.waiting !== seat) return null;
    const p = this.players[this.turnIdx];
    const L = this.legal();
    const out: PokerStep[] = [];
    switch (a.kind) {
      case 'fold':
        p.folded = true;
        this.emit(out, { kind: 'act', seat, act: 'fold', put: 0, to: p.bet, allIn: false });
        break;
      case 'check':
        if (!L.check) return null;
        this.emit(out, { kind: 'act', seat, act: 'check', put: 0, to: p.bet, allIn: false });
        break;
      case 'call': {
        if (L.call <= 0) return null;
        const put = this.putIn(p, L.call);
        this.emit(out, { kind: 'act', seat, act: p.allIn ? 'allin' : 'call', put, to: p.bet, allIn: p.allIn });
        break;
      }
      case 'raise':
      case 'allin': {
        let to = a.kind === 'allin' ? p.bet + p.stack : Math.floor(a.to);
        if (a.kind === 'allin' && (!L.maxTo || to <= this.currentBet)) {
          // All in for no more than the bet: that's a call.
          if (L.call <= 0) return null;
          const put = this.putIn(p, L.call);
          this.emit(out, { kind: 'act', seat, act: p.allIn ? 'allin' : 'call', put, to: p.bet, allIn: p.allIn });
          break;
        }
        if (!L.maxTo || !Number.isFinite(to)) return null;
        if (to >= L.maxTo) to = L.maxTo;
        else if (to < L.minTo) return null;
        const wasBet = this.currentBet === 0;
        const put = this.putIn(p, to - p.bet);
        const inc = p.bet - this.currentBet;
        if (inc >= this.minRaise) {
          this.minRaise = inc;
          this.raises++;
        }
        this.currentBet = Math.max(this.currentBet, p.bet);
        this.lastAggressor = seat;
        this.emit(out, { kind: 'act', seat, act: p.allIn ? 'allin' : wasBet ? 'bet' : 'raise', put, to: p.bet, allIn: p.allIn });
        break;
      }
      default:
        return null;
    }
    p.acted = true;
    p.seen = this.raises;
    this.advance(out);
    return out;
  }

  /**
   * A player leaves the table mid-hand: their hand is folded now, in turn or
   * not (their chips already in stay in the pot). Returns the steps caused.
   */
  fold(seat: number): PokerStep[] {
    if (this.done) return [];
    if (this.waiting === seat) return this.act(seat, { kind: 'fold' }) ?? [];
    const p = this.player(seat);
    if (!p || p.folded) return [];
    const out: PokerStep[] = [];
    p.folded = true;
    this.emit(out, { kind: 'act', seat, act: 'fold', put: 0, to: p.bet, allIn: false });
    if (this.live().length === 1) this.finishByFolds(out);
    return out;
  }

  /** Moves the turn on; ends the betting round, the street and the hand as they come. */
  private advance(out: PokerStep[]) {
    for (;;) {
      if (this.live().length === 1) return this.finishByFolds(out);
      const n = this.players.length;
      for (let k = 1; k <= n; k++) {
        const i = (this.turnIdx + k) % n;
        if (this.needsToAct(this.players[i])) {
          this.turnIdx = i;
          this.emit(out, { kind: 'turn', seat: this.players[i].seat });
          return;
        }
      }
      // Betting round over.
      this.endRound(out);
      if (this.street === 'river') return this.showdown(out);
      const canAct = this.live().filter((p) => !p.allIn).length;
      this.nextStreet(out);
      if (canAct <= 1) continue; // everyone's all in: the board runs out (advance finds nobody to act)
      this.turnIdx = this.idx(this.button); // the search starts left of the button
    }
  }

  /** Hands back an uncalled bet and gathers the street's bets into the middle. */
  private endRound(out: PokerStep[]) {
    const sorted = [...this.players].sort((a, b) => b.bet - a.bet);
    if (sorted.length > 1 && sorted[0].bet > sorted[1].bet) {
      const back = sorted[0].bet - sorted[1].bet;
      const p = sorted[0];
      p.bet -= back;
      p.put -= back;
      p.stack += back;
      if (p.stack > 0) p.allIn = false;
      this.emit(out, { kind: 'return', seat: p.seat, amount: back });
    }
    const street = this.players.reduce((s, p) => s + p.bet, 0);
    if (street > 0) {
      this.pot += street;
      this.emit(out, { kind: 'collect', pot: this.pot });
    }
    for (const p of this.players) {
      p.bet = 0;
      p.acted = false;
      p.seen = 0;
    }
    this.currentBet = 0;
    this.minRaise = this.bb;
    this.raises = 0;
  }

  private nextStreet(out: PokerStep[]) {
    const i = STREETS.indexOf(this.street);
    this.street = STREETS[i + 1];
    this.draw(); // burn
    const cards = this.street === 'flop' ? [this.draw(), this.draw(), this.draw()] : [this.draw()];
    this.board.push(...cards);
    this.emit(out, { kind: 'board', street: this.street, cards });
    this.lastAggressor = null;
  }

  private finishByFolds(out: PokerStep[]) {
    this.endRound(out);
    const w = this.live()[0];
    const amount = this.players.reduce((s, p) => s + p.put, 0);
    w.stack += amount;
    this.emit(out, { kind: 'win', seat: w.seat, amount, pot: 0, name: '' });
    this.end(out);
  }

  private showdown(out: PokerStep[]) {
    const live = this.live();
    // The last aggressor on the river shows first, else the first live seat left of the button.
    const order = this.order;
    let first = order.findIndex((s) => s === this.lastAggressor && live.some((p) => p.seat === s));
    if (first < 0) first = order.findIndex((s) => live.some((p) => p.seat === s));
    const scores = new Map<number, number>();
    const names = new Map<number, string>();
    for (let k = 0; k < order.length; k++) {
      const s = order[(first + k) % order.length];
      const p = this.player(s)!;
      if (p.folded) continue;
      const r = evaluate([...p.hole, ...this.board]);
      scores.set(s, r.score);
      names.set(s, r.name);
      this.emit(out, { kind: 'show', seat: s, cards: p.hole.slice(), name: r.name, score: r.score });
    }
    const pots = buildPots(this.players);
    for (const w of awardPots(pots, scores, order)) {
      this.player(w.seat)!.stack += w.amount;
      this.emit(out, { kind: 'win', seat: w.seat, amount: w.amount, pot: w.pot, name: names.get(w.seat) ?? '' });
    }
    this.end(out);
  }

  private end(out: PokerStep[]) {
    this.turnIdx = -1;
    this.done = true;
    this.emit(out, { kind: 'end' });
  }

  /** Stacks after the hand (or now). */
  stacks(): Map<number, number> {
    return new Map(this.players.map((p) => [p.seat, p.stack]));
  }
}

// ---------------------------------------------------------------------------
// What the table shows: the steps so far, folded into seats, bets and the pot
// ---------------------------------------------------------------------------

export interface SeatView {
  seat: number;
  stack: number;
  bet: number;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  /** Hole cards as known here (rank 0: face down / unknown). */
  cards: Card[];
  shown: boolean;
  /** The hand they showed. */
  hand: string;
  /** What they last did ("Call $20"). */
  last: string;
  won: number;
}

export interface TableView {
  seats: Map<number, SeatView>;
  pot: number;
  board: Card[];
  button: number | null;
  turn: number | null;
  street: Street;
  currentBet: number;
  ended: boolean;
}

const blankSeat = (seat: number, stack: number): SeatView => ({ seat, stack, bet: 0, inHand: false, folded: false, allIn: false, cards: [], shown: false, hand: '', last: '', won: 0 });

/** A table before the first step of a hand, with everyone's stacks. */
export function newView(stacks: Iterable<[number, number]>): TableView {
  const seats = new Map<number, SeatView>();
  for (const [seat, stack] of stacks) seats.set(seat, blankSeat(seat, stack));
  return { seats, pot: 0, board: [], button: null, turn: null, street: 'preflop', currentBet: 0, ended: false };
}

const ACT_WORDS: Record<ActKind, string> = { fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise to', allin: 'All in' };

/** Words for an action as the table shows it. */
export function actLabel(act: ActKind, to: number): string {
  return act === 'fold' || act === 'check' ? ACT_WORDS[act] : `${ACT_WORDS[act]} $${to}`;
}

/** Applies one step to what the table shows. */
export function applyStep(v: TableView, s: PokerStep): void {
  const seat = (k: number) => {
    let x = v.seats.get(k);
    if (!x) v.seats.set(k, (x = blankSeat(k, 0)));
    return x;
  };
  switch (s.kind) {
    case 'button':
      v.button = s.seat;
      break;
    case 'blind': {
      const p = seat(s.seat);
      p.stack -= s.amount;
      p.bet += s.amount;
      p.inHand = true;
      p.allIn = p.stack <= 0;
      p.last = `${s.big ? 'Big' : 'Small'} blind $${s.amount}`;
      v.currentBet = Math.max(v.currentBet, p.bet);
      break;
    }
    case 'deal': {
      const p = seat(s.seat);
      p.inHand = true;
      p.cards = s.cards.slice();
      break;
    }
    case 'act': {
      const p = seat(s.seat);
      v.turn = null;
      if (s.act === 'fold') p.folded = true;
      p.stack -= s.put;
      p.bet = s.to;
      p.allIn = s.allIn;
      p.last = actLabel(s.act, s.to);
      v.currentBet = Math.max(v.currentBet, p.bet);
      break;
    }
    case 'turn':
      v.turn = s.seat;
      break;
    case 'return': {
      const p = seat(s.seat);
      p.bet -= s.amount;
      p.stack += s.amount;
      if (p.stack > 0) p.allIn = false;
      break;
    }
    case 'collect':
      v.pot = s.pot;
      for (const p of v.seats.values()) p.bet = 0;
      v.currentBet = 0;
      break;
    case 'board':
      v.board.push(...s.cards);
      v.street = s.street;
      v.turn = null;
      for (const p of v.seats.values()) if (!p.folded && !p.allIn) p.last = '';
      break;
    case 'show': {
      const p = seat(s.seat);
      p.cards = s.cards.slice();
      p.shown = true;
      p.hand = s.name;
      break;
    }
    case 'win': {
      const p = seat(s.seat);
      // A fold win: whatever was still in front of players goes in first.
      if (v.pot === 0) for (const q of v.seats.values()) q.bet = 0;
      p.stack += s.amount;
      p.won += s.amount;
      v.pot = Math.max(0, v.pot - s.amount);
      p.last = `Wins $${p.won}`;
      break;
    }
    case 'end':
      v.ended = true;
      v.turn = null;
      break;
  }
}

// ---------------------------------------------------------------------------
// NPC guests: hand strength, pot odds and a little randomness
// ---------------------------------------------------------------------------

/** How a guest plays: loose (plays more hands), aggressive (bets and raises), bluffs. All 0..1. */
export interface NpcStyle {
  loose: number;
  aggro: number;
  bluff: number;
}

/**
 * Chance of winning (ties counted as a share) against `opponents` random hands,
 * by dealing out the rest of the board `iters` times.
 */
export function equity(hole: readonly Card[], board: readonly Card[], opponents: number, rng: Rng, iters = 160): number {
  const used = new Set([...hole, ...board].map((c) => c.suit * 13 + c.rank - 1));
  const rest: Card[] = [];
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) if (!used.has(s * 13 + r - 1)) rest.push({ rank: r, suit: s });
  const need = 5 - board.length;
  const opp = Math.max(1, opponents);
  let won = 0;
  const b: Card[] = [];
  for (let it = 0; it < iters; it++) {
    // Partial shuffle of what we need from the front of `rest`.
    const take = need + opp * 2;
    for (let i = 0; i < take; i++) {
      const j = i + rng.int(rest.length - i);
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    b.length = 0;
    b.push(...board);
    for (let i = 0; i < need; i++) b.push(rest[i]);
    const mine = handScore([...hole, ...b]);
    let best = 0,
      ties = 0;
    for (let o = 0; o < opp; o++) {
      const s = handScore([rest[need + o * 2], rest[need + o * 2 + 1], ...b]);
      if (s > best) {
        best = s;
        ties = 0;
      }
      if (s === best) ties++;
    }
    if (mine > best) won += 1;
    else if (mine === best) won += 1 / (ties + 1);
  }
  return won / iters;
}

export interface NpcView {
  hole: readonly Card[];
  board: readonly Card[];
  legal: Legal;
  /** Everything in the middle, including bets in front of players. */
  pot: number;
  /** Live opponents. */
  opponents: number;
  bb: number;
  /** Round a bet to this (chip) unit. */
  unit?: number;
}

/**
 * A guest's decision. Strength is their equity (plus their style and a little
 * noise) measured against a fair share of the pot; facing a bet they need
 * equity to beat the pot odds; strong hands bet and raise, weak ones check or
 * fold, and now and then they bluff. Always returns a legal action.
 */
export function npcDecide(v: NpcView, style: NpcStyle, rng: Rng & { next?(): number }, iters = 140): PokerAction {
  const r = () => (rng.next ? rng.next() : rng.int(1_000_000) / 1_000_000);
  const L = v.legal;
  const unit = v.unit ?? 5;
  const eq = equity(v.hole, v.board, v.opponents, rng, iters);
  const fair = 1 / (Math.max(1, v.opponents) + 1);
  const strength = eq + (r() - 0.5) * 0.08 + (style.loose - 0.5) * 0.06;
  const rel = strength / fair;
  const canRaise = L.maxTo > 0;
  const size = (frac: number) => {
    const raw = Math.max(L.minTo, (L.toCall > 0 ? L.bet + L.toCall : 0) + v.pot * frac);
    let to = Math.round(raw / unit) * unit;
    to = Math.max(L.minTo, Math.min(L.maxTo, to));
    // Committing most of the stack anyway: just go all in.
    if (to >= L.bet + L.stack * 0.7) to = L.maxTo;
    return to;
  };
  const raise = (frac: number): PokerAction => {
    const to = size(frac);
    return to >= L.maxTo ? { kind: 'allin' } : { kind: 'raise', to };
  };
  if (L.check) {
    if (canRaise && rel > 1.55 - 0.35 * style.aggro && r() < 0.55 + 0.4 * style.aggro) return raise(0.45 + 0.4 * r());
    if (canRaise && r() < style.bluff * 0.35) return raise(0.4 + 0.25 * r());
    return { kind: 'check' };
  }
  const odds = L.call / (v.pot + L.call);
  const cheap = L.call <= v.bb && v.board.length === 0;
  if (canRaise && rel > 2.0 - 0.6 * style.aggro && r() < 0.35 + 0.5 * style.aggro) return raise(0.6 + 0.5 * r());
  if (strength >= odds * (1.08 - 0.25 * style.loose) || (cheap && rel > 0.75 - 0.2 * style.loose)) return { kind: 'call' };
  if (canRaise && r() < style.bluff * 0.12) return raise(0.7 + 0.4 * r());
  return { kind: 'fold' };
}

// ---------------------------------------------------------------------------
// Compact wire form (host to guests)
// ---------------------------------------------------------------------------

const ACTS: ActKind[] = ['fold', 'check', 'call', 'bet', 'raise', 'allin'];
export const cardId = (c: Card) => (c.rank <= 0 ? -1 : c.suit * 13 + (c.rank - 1));
export const idCard = (n: number): Card => (n < 0 ? { rank: 0, suit: 0 } : { rank: (n % 13) + 1, suit: Math.floor(n / 13) % 4 });

/**
 * Packs steps as small arrays. Hole cards are hidden (-1) for every seat
 * except `reveal` (none by default): only a showdown shows them to the table.
 */
export function packPoker(steps: readonly PokerStep[], reveal: number | null = null): (number | string)[][] {
  return steps.map((s) => {
    switch (s.kind) {
      case 'button':
        return ['B', s.seat];
      case 'blind':
        return ['b', s.seat, s.amount, s.big ? 1 : 0];
      case 'deal':
        return ['d', s.seat, ...s.cards.map((c) => (s.seat === reveal ? cardId(c) : -1))];
      case 'act':
        return ['a', s.seat, ACTS.indexOf(s.act), s.put, s.to, s.allIn ? 1 : 0];
      case 'turn':
        return ['t', s.seat];
      case 'return':
        return ['r', s.seat, s.amount];
      case 'collect':
        return ['c', s.pot];
      case 'board':
        return ['o', STREETS.indexOf(s.street), ...s.cards.map(cardId)];
      case 'show':
        return ['s', s.seat, s.score, ...s.cards.map(cardId)];
      case 'win':
        return ['w', s.seat, s.amount, s.pot];
      case 'end':
        return ['e'];
    }
  });
}

/** Unpacks `packPoker`; anything malformed is dropped. Hidden cards unpack as rank 0. */
export function unpackPoker(raw: unknown): PokerStep[] {
  if (!Array.isArray(raw)) return [];
  const out: PokerStep[] = [];
  const N = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const seat = (v: unknown) => (Number.isInteger(N(v)) && N(v) >= 0 && N(v) < 10 ? N(v) : null);
  const amt = (v: unknown) => (N(v) >= 0 ? N(v) : null);
  const card = (v: unknown): Card | null => {
    const n = N(v);
    return Number.isInteger(n) && n >= -1 && n < 52 ? idCard(n) : null;
  };
  const cards = (vs: unknown[]) => {
    const cs = vs.map(card);
    return cs.every((c) => c) ? (cs as Card[]) : null;
  };
  for (const a of raw) {
    if (!Array.isArray(a)) continue;
    const [k, p, q, r, s, t] = a as unknown[];
    const S = seat(p);
    let st: PokerStep | null = null;
    switch (k) {
      case 'B':
        if (S !== null) st = { kind: 'button', seat: S };
        break;
      case 'b':
        if (S !== null && amt(q) !== null) st = { kind: 'blind', seat: S, amount: N(q), big: N(r) === 1 };
        break;
      case 'd': {
        const cs = cards(a.slice(2));
        if (S !== null && cs && cs.length === 2) st = { kind: 'deal', seat: S, cards: cs };
        break;
      }
      case 'a': {
        const act = ACTS[N(q)];
        if (S !== null && act && amt(r) !== null && amt(s) !== null) st = { kind: 'act', seat: S, act, put: N(r), to: N(s), allIn: N(t) === 1 };
        break;
      }
      case 't':
        if (S !== null) st = { kind: 'turn', seat: S };
        break;
      case 'r':
        if (S !== null && amt(q) !== null) st = { kind: 'return', seat: S, amount: N(q) };
        break;
      case 'c':
        if (amt(p) !== null) st = { kind: 'collect', pot: N(p) };
        break;
      case 'o': {
        const street = STREETS[N(p)];
        const cs = cards(a.slice(2));
        if (street && street !== 'preflop' && cs && cs.length) st = { kind: 'board', street, cards: cs };
        break;
      }
      case 's': {
        const cs = cards(a.slice(3));
        if (S !== null && amt(q) !== null && cs && cs.length === 2) st = { kind: 'show', seat: S, cards: cs, score: N(q), name: describe(N(q)) };
        break;
      }
      case 'w':
        if (S !== null && amt(q) !== null && amt(r) !== null) st = { kind: 'win', seat: S, amount: N(q), pot: N(r), name: '' };
        break;
      case 'e':
        st = { kind: 'end' };
        break;
    }
    if (st) out.push(st);
  }
  return out;
}
