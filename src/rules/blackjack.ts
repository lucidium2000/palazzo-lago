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
