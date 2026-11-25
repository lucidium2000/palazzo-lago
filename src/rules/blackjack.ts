import type { Rng } from './rng';

/**
 * Blackjack as dealt on the Strip: a six-deck shoe, the dealer stands on all
 * 17s (S17), takes a hole card and peeks under an ace or ten-value upcard,
 * blackjack pays 3 to 2. The background tables in the pit play their guests'
 * hands with this; the hands are decided here and the client animates them.
 */

export interface Card {
  /** 1 = ace, 11 = jack, 12 = queen, 13 = king. */
  rank: number;
  /** 0 spades, 1 hearts, 2 diamonds, 3 clubs. */
  suit: number;
}

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUITS = ['♠', '♥', '♦', '♣'];

export function cardLabel(c: Card): string {
  return RANKS[c.rank - 1] + SUITS[c.suit];
}

/** Blackjack value of one card (aces count 1 here; `handValue` promotes one to 11). */
export function cardPoints(c: Card): number {
  return Math.min(10, c.rank);
}

export interface HandValue {
  total: number;
  /** An ace is being counted as 11. */
  soft: boolean;
}

export function handValue(cards: readonly Card[]): HandValue {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardPoints(c);
    if (c.rank === 1) aces++;
  }
  if (aces > 0 && total + 10 <= 21) return { total: total + 10, soft: true };
  return { total, soft: false };
}

/** A natural: two cards making 21. */
export function isBlackjack(cards: readonly Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

export function isBust(cards: readonly Card[]): boolean {
  return handValue(cards).total > 21;
}

/** S17: the dealer draws to 16 and stands on every 17, soft ones included. */
export function dealerHits(cards: readonly Card[]): boolean {
  return handValue(cards).total < 17;
}

/**
 * What a sensible regular does (basic strategy without doubles or splits):
 * hard 11 or less hit; hard 12 hit against 2, 3 or 7+; hard 13–16 hit against
 * 7+; soft 17 or less hit; soft 18 hit against 9, ten or ace; else stand.
 */
export function playerHits(cards: readonly Card[], dealerUp: Card): boolean {
  const { total, soft } = handValue(cards);
  const up = dealerUp.rank === 1 ? 11 : cardPoints(dealerUp);
  if (total >= 21) return false;
  if (soft) {
    if (total <= 17) return true;
    if (total === 18) return up >= 9;
    return false;
  }
  if (total <= 11) return true;
  if (total === 12) return up <= 3 || up >= 7;
  if (total <= 16) return up >= 7;
  return false;
}

export type Outcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';

/**
 * Settles one finished hand. Returns the outcome and what the bet returns in
 * total (stake included): 0 for a loss, the stake for a push, 2x for a win and
 * 2.5x for a natural.
 */
export function settle(player: readonly Card[], dealer: readonly Card[], bet: number): { outcome: Outcome; returned: number } {
  const pbj = isBlackjack(player),
    dbj = isBlackjack(dealer);
  if (pbj && dbj) return { outcome: 'push', returned: bet };
  if (pbj) return { outcome: 'blackjack', returned: bet * 2.5 };
  if (dbj) return { outcome: 'lose', returned: 0 };
  const p = handValue(player).total;
  if (p > 21) return { outcome: 'bust', returned: 0 };
  const d = handValue(dealer).total;
  if (d > 21 || p > d) return { outcome: 'win', returned: bet * 2 };
  if (p === d) return { outcome: 'push', returned: bet };
  return { outcome: 'lose', returned: 0 };
}

/** A shoe of `decks` shuffled decks, dealt from the front; reshuffles at the cut card. */
export class Shoe {
  private cards: Card[] = [];
  private next = 0;
  private cut = 0;

  constructor(
    private rng: Rng,
    private decks = 6,
  ) {
    this.shuffle();
  }

  shuffle() {
    this.cards = [];
    for (let d = 0; d < this.decks; d++) for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) this.cards.push({ rank: r, suit: s });
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
    this.next = 0;
    // Cut card about three quarters of the way in.
    this.cut = Math.floor(this.cards.length * 0.75);
  }

  get remaining() {
    return this.cards.length - this.next;
  }

  /** Past the cut card: shuffle before the next round. */
  get needsShuffle() {
    return this.next >= this.cut;
  }

  draw(): Card {
    if (this.next >= this.cards.length) this.shuffle();
    return this.cards[this.next++];
  }
}

/** One step of a round, in the order it happens at the table. */
export type RoundStep =
  | { kind: 'deal'; to: number | 'dealer'; card: Card; faceUp: boolean }
  | { kind: 'peek'; blackjack: boolean }
  | { kind: 'hit'; seat: number; card: Card }
  | { kind: 'stand'; seat: number }
  | { kind: 'bust'; seat: number }
  | { kind: 'reveal'; card: Card }
  | { kind: 'dealerHit'; card: Card }
  | { kind: 'settle'; seat: number; outcome: Outcome; bet: number; returned: number };

export interface Round {
  steps: RoundStep[];
  hands: Card[][];
  dealer: Card[];
  results: { outcome: Outcome; bet: number; returned: number }[];
}

/**
 * Plays a full round for `bets.length` seated players (in dealing order,
 * first base first) against the dealer, with `strategy` deciding each hit.
 */
export function playRound(shoe: Shoe, bets: readonly number[], strategy: (cards: readonly Card[], up: Card) => boolean = playerHits): Round {
  if (shoe.needsShuffle) shoe.shuffle();
  const steps: RoundStep[] = [];
  const n = bets.length;
  const hands: Card[][] = bets.map(() => []);
  const dealer: Card[] = [];
  // Two passes: one card each face up, the dealer's up card; then the second
  // card each and the dealer's hole card face down.
  for (let pass = 0; pass < 2; pass++) {
    for (let s = 0; s < n; s++) {
      const card = shoe.draw();
      hands[s].push(card);
      steps.push({ kind: 'deal', to: s, card, faceUp: true });
    }
    const card = shoe.draw();
    dealer.push(card);
    steps.push({ kind: 'deal', to: 'dealer', card, faceUp: pass === 0 });
  }
  const up = dealer[0];
  // Peek for blackjack under an ace or a ten.
  let dealerNatural = false;
  if (up.rank === 1 || cardPoints(up) === 10) {
    dealerNatural = isBlackjack(dealer);
    steps.push({ kind: 'peek', blackjack: dealerNatural });
  }
  if (!dealerNatural) {
    for (let s = 0; s < n; s++) {
      const h = hands[s];
      if (isBlackjack(h)) continue;
      while (strategy(h, up)) {
        const card = shoe.draw();
        h.push(card);
        steps.push({ kind: 'hit', seat: s, card });
      }
      if (isBust(h)) steps.push({ kind: 'bust', seat: s });
      else steps.push({ kind: 'stand', seat: s });
    }
  }
  steps.push({ kind: 'reveal', card: dealer[1] });
  // The dealer only draws if someone is still in with a non-natural hand.
  const live = !dealerNatural && hands.some((h) => !isBust(h) && !isBlackjack(h));
  if (live) {
    while (dealerHits(dealer)) {
      const card = shoe.draw();
      dealer.push(card);
      steps.push({ kind: 'dealerHit', card });
    }
  }
  const results = hands.map((h, s) => settle(h, dealer, bets[s])).map((r, s) => ({ ...r, bet: bets[s] }));
  results.forEach((r, s) => steps.push({ kind: 'settle', seat: s, outcome: r.outcome, bet: r.bet, returned: r.returned }));
  return { steps, hands, dealer, results };
}

// ---------------------------------------------------------------------------
// Live tables: rounds played a step at a time, with real players deciding.
// ---------------------------------------------------------------------------

export type Action = 'hit' | 'stand' | 'double' | 'split';

/** Someone in this round: a betting spot (0 = first base) and the opening bet. */
export interface TableEntry {
  seat: number;
  bet: number;
  /** Played by the house strategy (a guest NPC) instead of waiting for a decision. */
  auto: boolean;
}

export interface PlayHand {
  cards: Card[];
  /** Total at risk on this hand (doubled hands carry twice the stake). */
  bet: number;
  doubled: boolean;
  /** Came from a split: a two-card 21 is just 21, not a natural. */
  split: boolean;
  done: boolean;
}

export interface TableSeat {
  seat: number;
  auto: boolean;
  hands: PlayHand[];
}

/** One step at a live table, in the order it happens. `hand` is 0 unless the seat split. */
export type TableStep =
  | { kind: 'bet'; seat: number; amount: number }
  | { kind: 'deal'; to: number | 'dealer'; card: Card; faceUp: boolean }
  | { kind: 'peek'; blackjack: boolean }
  | { kind: 'turn'; seat: number; hand: number }
  | { kind: 'hit'; seat: number; hand: number; card: Card }
  | { kind: 'double'; seat: number; hand: number; card: Card; bet: number }
  | { kind: 'split'; seat: number; bet: number }
  | { kind: 'stand'; seat: number; hand: number }
  | { kind: 'bust'; seat: number; hand: number }
  | { kind: 'reveal'; card: Card }
  | { kind: 'dealerHit'; card: Card }
  | { kind: 'settle'; seat: number; hand: number; outcome: Outcome; bet: number; returned: number };

/** Settles one hand that may have come from a split (no natural then). */
export function settleHand(h: PlayHand, dealer: readonly Card[]): { outcome: Outcome; returned: number } {
  if (!h.split) return settle(h.cards, dealer, h.bet);
  if (isBust(h.cards)) return { outcome: 'bust', returned: 0 };
  if (isBlackjack(dealer)) return { outcome: 'lose', returned: 0 };
  const p = handValue(h.cards).total,
    d = handValue(dealer).total;
  if (d > 21 || p > d) return { outcome: 'win', returned: h.bet * 2 };
  if (p === d) return { outcome: 'push', returned: h.bet };
  return { outcome: 'lose', returned: 0 };
}

/** The same rank counts as a pair (two eights, two kings; a king and a queen don't). */
export const isPair = (cards: readonly Card[]) => cards.length === 2 && cards[0].rank === cards[1].rank;

/**
 * A round at a live table. Guests (auto seats) play themselves with the house
 * strategy; at a player's seat the round stops and waits (`waiting`) for
 * `act()`. Each call returns the steps it added, so the client can animate them
 * as they come. Rules: S17, peek, 3:2, double on any first two cards (also after
 * a split), one split per seat (split aces take one card each).
 */
export class TableRound {
  readonly steps: TableStep[] = [];
  readonly dealer: Card[] = [];
  readonly seats: TableSeat[];
  /** Whose decision the table is waiting for (index into `seats`, and the hand). */
  private turn: { i: number; h: number } | null = null;
  private started = false;
  done = false;
  dealerNatural = false;

  constructor(
    private shoe: Shoe,
    entries: readonly TableEntry[],
    private strategy: (cards: readonly Card[], up: Card) => boolean = playerHits,
  ) {
    this.seats = [...entries]
      .sort((a, b) => a.seat - b.seat)
      .map((e) => ({ seat: e.seat, auto: e.auto, hands: [{ cards: [], bet: e.bet, doubled: false, split: false, done: false }] }));
  }

  /** The seat and hand the table is waiting on, if any. */
  get waiting(): { seat: number; hand: number } | null {
    return this.turn ? { seat: this.seats[this.turn.i].seat, hand: this.turn.h } : null;
  }

  private emit(out: TableStep[], st: TableStep) {
    this.steps.push(st);
    out.push(st);
  }

  /** Bets, the deal and the peek, then guests play until a player has to decide. */
  start(): TableStep[] {
    if (this.started) return [];
    this.started = true;
    if (this.shoe.needsShuffle) this.shoe.shuffle();
    const out: TableStep[] = [];
    for (const s of this.seats) this.emit(out, { kind: 'bet', seat: s.seat, amount: s.hands[0].bet });
    for (let pass = 0; pass < 2; pass++) {
      for (const s of this.seats) {
        const card = this.shoe.draw();
        s.hands[0].cards.push(card);
        this.emit(out, { kind: 'deal', to: s.seat, card, faceUp: true });
      }
      const card = this.shoe.draw();
      this.dealer.push(card);
      this.emit(out, { kind: 'deal', to: 'dealer', card, faceUp: pass === 0 });
    }
    const up = this.dealer[0];
    if (up.rank === 1 || cardPoints(up) === 10) {
      this.dealerNatural = isBlackjack(this.dealer);
      this.emit(out, { kind: 'peek', blackjack: this.dealerNatural });
    }
    if (this.dealerNatural) {
      for (const s of this.seats) s.hands[0].done = true;
      this.finish(out);
    } else {
      this.turn = { i: 0, h: 0 };
      this.advance(out);
    }
    return out;
  }

  /** What the waiting hand may do now. */
  legal(): Record<Action, boolean> {
    const none = { hit: false, stand: false, double: false, split: false };
    if (!this.turn || this.done) return none;
    const s = this.seats[this.turn.i];
    const h = s.hands[this.turn.h];
    const two = h.cards.length === 2;
    return { hit: true, stand: true, double: two, split: two && s.hands.length === 1 && isPair(h.cards) };
  }

  /**
   * A player's decision for the waiting hand (`seat` must match). Returns the
   * steps it caused, or null if it isn't that seat's turn or the move isn't allowed.
   */
  act(seat: number, action: Action): TableStep[] | null {
    const w = this.waiting;
    if (!w || w.seat !== seat || !this.legal()[action]) return null;
    const out: TableStep[] = [];
    const s = this.seats[this.turn!.i];
    const hi = this.turn!.h;
    const h = s.hands[hi];
    switch (action) {
      case 'hit': {
        const card = this.shoe.draw();
        h.cards.push(card);
        this.emit(out, { kind: 'hit', seat, hand: hi, card });
        const v = handValue(h.cards).total;
        if (v > 21) {
          h.done = true;
          this.emit(out, { kind: 'bust', seat, hand: hi });
        } else if (v === 21) {
          h.done = true;
          this.emit(out, { kind: 'stand', seat, hand: hi });
        }
        break;
      }
      case 'stand':
        h.done = true;
        this.emit(out, { kind: 'stand', seat, hand: hi });
        break;
      case 'double': {
        const add = h.bet;
        h.bet += add;
        h.doubled = true;
        const card = this.shoe.draw();
        h.cards.push(card);
        h.done = true;
        this.emit(out, { kind: 'double', seat, hand: hi, card, bet: add });
        if (isBust(h.cards)) this.emit(out, { kind: 'bust', seat, hand: hi });
        else this.emit(out, { kind: 'stand', seat, hand: hi });
        break;
      }
      case 'split': {
        const second = h.cards.pop()!;
        h.split = true;
        s.hands.push({ cards: [second], bet: h.bet, doubled: false, split: true, done: false });
        this.emit(out, { kind: 'split', seat, bet: h.bet });
        // The first hand gets its second card now; the other when its turn comes.
        this.dealTo(out, s, 0);
        break;
      }
    }
    this.advance(out);
    return out;
  }

  /** A second card for a split hand (aces take just the one, and stand). */
  private dealTo(out: TableStep[], s: TableSeat, hi: number) {
    const h = s.hands[hi];
    const card = this.shoe.draw();
    h.cards.push(card);
    this.emit(out, { kind: 'hit', seat: s.seat, hand: hi, card });
    if (h.cards[0].rank === 1 || handValue(h.cards).total === 21) {
      h.done = true;
      this.emit(out, { kind: 'stand', seat: s.seat, hand: hi });
    }
  }

  /** Moves the turn on, playing guests' hands, until a player must decide or everyone is done. */
  private advance(out: TableStep[]) {
    const up = this.dealer[0];
    while (this.turn) {
      const { i, h: hi } = this.turn;
      const s = this.seats[i];
      const h = s.hands[hi];
      if (h.cards.length === 1) this.dealTo(out, s, hi);
      if (!h.done && h.cards.length === 2 && !h.split && isBlackjack(h.cards)) h.done = true;
      if (!h.done && s.auto) {
        while (this.strategy(h.cards, up)) {
          const card = this.shoe.draw();
          h.cards.push(card);
          this.emit(out, { kind: 'hit', seat: s.seat, hand: hi, card });
        }
        h.done = true;
        this.emit(out, isBust(h.cards) ? { kind: 'bust', seat: s.seat, hand: hi } : { kind: 'stand', seat: s.seat, hand: hi });
      }
      if (!h.done) {
        // A player's hand: announce the turn once, then wait.
        const last = this.steps[this.steps.length - 1];
        if (!(last.kind === 'turn' && last.seat === s.seat && last.hand === hi)) this.emit(out, { kind: 'turn', seat: s.seat, hand: hi });
        return;
      }
      // Next hand of this seat, else the next seat.
      if (hi + 1 < s.hands.length) this.turn = { i, h: hi + 1 };
      else if (i + 1 < this.seats.length) this.turn = { i: i + 1, h: 0 };
      else this.turn = null;
    }
    this.finish(out);
  }

  /** The dealer's hand, then everyone is paid or taken. */
  private finish(out: TableStep[]) {
    this.turn = null;
    this.emit(out, { kind: 'reveal', card: this.dealer[1] });
    const live = !this.dealerNatural && this.seats.some((s) => s.hands.some((h) => !isBust(h.cards) && !(isBlackjack(h.cards) && !h.split)));
    if (live) {
      while (dealerHits(this.dealer)) {
        const card = this.shoe.draw();
        this.dealer.push(card);
        this.emit(out, { kind: 'dealerHit', card });
      }
    }
    for (const s of this.seats)
      s.hands.forEach((h, hi) => {
        const r = settleHand(h, this.dealer);
        this.emit(out, { kind: 'settle', seat: s.seat, hand: hi, outcome: r.outcome, bet: h.bet, returned: r.returned });
      });
    this.done = true;
  }
}

// --- Compact wire form (two-player tables) ----------------------------------

const OUTCOMES: Outcome[] = ['blackjack', 'win', 'push', 'lose', 'bust'];
const cardId = (c: Card) => c.suit * 13 + (c.rank - 1);
const idCard = (n: number): Card => ({ rank: (n % 13) + 1, suit: Math.floor(n / 13) % 4 });

/** Packs steps as small arrays. The dealer's hole card is hidden (-1) until it's turned over. */
export function packSteps(steps: readonly TableStep[]): (number | string)[][] {
  return steps.map((s) => {
    switch (s.kind) {
      case 'bet':
        return ['b', s.seat, s.amount];
      case 'deal':
        return ['d', s.to === 'dealer' ? -1 : s.to, s.to === 'dealer' && !s.faceUp ? -1 : cardId(s.card), s.faceUp ? 1 : 0];
      case 'peek':
        return ['p', s.blackjack ? 1 : 0];
      case 'turn':
        return ['t', s.seat, s.hand];
      case 'hit':
        return ['h', s.seat, s.hand, cardId(s.card)];
      case 'double':
        return ['x', s.seat, s.hand, cardId(s.card), s.bet];
      case 'split':
        return ['s', s.seat, s.bet];
      case 'stand':
        return ['n', s.seat, s.hand];
      case 'bust':
        return ['u', s.seat, s.hand];
      case 'reveal':
        return ['r', cardId(s.card)];
      case 'dealerHit':
        return ['D', cardId(s.card)];
      case 'settle':
        return ['$', s.seat, s.hand, OUTCOMES.indexOf(s.outcome), s.bet, s.returned];
    }
  });
}

/** Unpacks `packSteps`; anything malformed is dropped. A hidden hole card unpacks as rank 0. */
export function unpackSteps(raw: unknown): TableStep[] {
  if (!Array.isArray(raw)) return [];
  const out: TableStep[] = [];
  const N = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const C = (v: unknown): Card | null => {
    const n = N(v);
    return n === -1 ? { rank: 0, suit: 0 } : n >= 0 && n < 52 && Number.isInteger(n) ? idCard(n) : null;
  };
  const seat = (v: unknown) => (Number.isInteger(N(v)) && N(v) >= 0 && N(v) < 7 ? N(v) : null);
  const hand = (v: unknown) => (N(v) === 0 || N(v) === 1 ? N(v) : null);
  for (const a of raw) {
    if (!Array.isArray(a)) continue;
    const [k, p, q, r, s, t] = a as unknown[];
    let st: TableStep | null = null;
    const S = seat(p),
      H = hand(q);
    switch (k) {
      case 'b':
        if (S !== null && N(q) > 0) st = { kind: 'bet', seat: S, amount: N(q) };
        break;
      case 'd': {
        const c = C(q);
        if (c && (N(p) === -1 || S !== null)) st = { kind: 'deal', to: N(p) === -1 ? 'dealer' : S!, card: c, faceUp: N(r) === 1 };
        break;
      }
      case 'p':
        st = { kind: 'peek', blackjack: N(p) === 1 };
        break;
      case 't':
        if (S !== null && H !== null) st = { kind: 'turn', seat: S, hand: H };
        break;
      case 'h': {
        const c = C(r);
        if (S !== null && H !== null && c) st = { kind: 'hit', seat: S, hand: H, card: c };
        break;
      }
      case 'x': {
        const c = C(r);
        if (S !== null && H !== null && c && N(s) > 0) st = { kind: 'double', seat: S, hand: H, card: c, bet: N(s) };
        break;
      }
      case 's':
        if (S !== null && N(q) > 0) st = { kind: 'split', seat: S, bet: N(q) };
        break;
      case 'n':
        if (S !== null && H !== null) st = { kind: 'stand', seat: S, hand: H };
        break;
      case 'u':
        if (S !== null && H !== null) st = { kind: 'bust', seat: S, hand: H };
        break;
      case 'r': {
        const c = C(p);
        if (c) st = { kind: 'reveal', card: c };
        break;
      }
      case 'D': {
        const c = C(p);
        if (c) st = { kind: 'dealerHit', card: c };
        break;
      }
      case '$': {
        const o = OUTCOMES[N(r)];
        if (S !== null && H !== null && o && N(s) >= 0 && N(t) >= 0) st = { kind: 'settle', seat: S, hand: H, outcome: o, bet: N(s), returned: N(t) };
        break;
      }
    }
    if (st) out.push(st);
  }
  return out;
}
