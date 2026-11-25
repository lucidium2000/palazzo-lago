import { describe, expect, it } from 'vitest';
import { type Card, dealerHits, handValue, isBlackjack, isBust, playerHits, playRound, settle, Shoe } from '../src/rules/blackjack';
import { SeededRng } from '../src/rules/rng';

const c = (...ranks: number[]): Card[] => ranks.map((rank, i) => ({ rank, suit: i % 4 }));

describe('hand values', () => {
  it('counts faces as ten and promotes one ace to eleven when it fits', () => {
    expect(handValue(c(13, 12))).toEqual({ total: 20, soft: false });
    expect(handValue(c(1, 6))).toEqual({ total: 17, soft: true });
    expect(handValue(c(1, 1))).toEqual({ total: 12, soft: true });
    expect(handValue(c(1, 1, 9))).toEqual({ total: 21, soft: true });
    expect(handValue(c(1, 6, 10))).toEqual({ total: 17, soft: false });
    expect(handValue(c(1, 1, 1, 1, 10, 7))).toEqual({ total: 21, soft: false });
  });

  it('knows a natural from a three-card 21', () => {
    expect(isBlackjack(c(1, 11))).toBe(true);
    expect(isBlackjack(c(10, 1))).toBe(true);
    expect(isBlackjack(c(7, 7, 7))).toBe(false);
    expect(isBlackjack(c(9, 10))).toBe(false);
  });

  it('busts over 21', () => {
    expect(isBust(c(10, 6, 9))).toBe(true);
    expect(isBust(c(1, 6, 9))).toBe(false);
  });
});

describe('dealer rules (S17)', () => {
  it('draws to 16 and stands on all 17s', () => {
    expect(dealerHits(c(10, 6))).toBe(true);
    expect(dealerHits(c(10, 7))).toBe(false);
    expect(dealerHits(c(1, 6))).toBe(false); // soft 17 stands
    expect(dealerHits(c(1, 5))).toBe(true);
  });
});

describe('player strategy', () => {
  const up = (rank: number): Card => ({ rank, suit: 0 });
  it('follows the basic hard totals', () => {
    expect(playerHits(c(5, 6), up(10))).toBe(true);
    expect(playerHits(c(10, 2), up(2))).toBe(true);
    expect(playerHits(c(10, 2), up(4))).toBe(false);
    expect(playerHits(c(10, 6), up(6))).toBe(false);
    expect(playerHits(c(10, 6), up(10))).toBe(true);
    expect(playerHits(c(10, 6), up(1))).toBe(true);
    expect(playerHits(c(10, 7), up(1))).toBe(false);
  });
  it('plays soft hands', () => {
    expect(playerHits(c(1, 6), up(5))).toBe(true);
    expect(playerHits(c(1, 7), up(8))).toBe(false);
    expect(playerHits(c(1, 7), up(9))).toBe(true);
    expect(playerHits(c(1, 8), up(10))).toBe(false);
  });
});

describe('settling', () => {
  it('pays 3 to 2 on a natural and pushes natural against natural', () => {
    expect(settle(c(1, 13), c(10, 9), 10)).toEqual({ outcome: 'blackjack', returned: 25 });
    expect(settle(c(1, 13), c(1, 12), 10)).toEqual({ outcome: 'push', returned: 10 });
  });
  it('loses to a dealer natural even with 21', () => {
    expect(settle(c(7, 7, 7), c(1, 10), 10)).toEqual({ outcome: 'lose', returned: 0 });
  });
  it('loses a bust even when the dealer busts too', () => {
    expect(settle(c(10, 6, 10), c(10, 6, 10), 10)).toEqual({ outcome: 'bust', returned: 0 });
  });
  it('wins on a dealer bust or a higher total, pushes ties', () => {
    expect(settle(c(10, 2), c(10, 6, 9), 10)).toEqual({ outcome: 'win', returned: 20 });
    expect(settle(c(10, 9), c(10, 8), 10)).toEqual({ outcome: 'win', returned: 20 });
    expect(settle(c(10, 8), c(10, 8), 10)).toEqual({ outcome: 'push', returned: 10 });
    expect(settle(c(10, 7), c(10, 8), 10)).toEqual({ outcome: 'lose', returned: 0 });
  });
});

describe('shoe', () => {
  it('holds six full decks', () => {
    const s = new Shoe(new SeededRng(3), 6);
    const seen = new Map<string, number>();
    for (let i = 0; i < 312; i++) {
      const k = s.draw();
      seen.set(`${k.rank}/${k.suit}`, (seen.get(`${k.rank}/${k.suit}`) ?? 0) + 1);
    }
    expect(seen.size).toBe(52);
    for (const n of seen.values()) expect(n).toBe(6);
  });
});

describe('a round', () => {
  it('deals in order and keeps the hands consistent with the steps', () => {
    const shoe = new Shoe(new SeededRng(7));
    for (let r = 0; r < 500; r++) {
      const bets = [25, 50, 25, 100].slice(0, 1 + (r % 4));
      const round = playRound(shoe, bets);
      const deals = round.steps.filter((s) => s.kind === 'deal');
      expect(deals.length).toBe(2 * (bets.length + 1));
      // The dealer's second card is the hole card, face down.
      expect(deals[bets.length].faceUp).toBe(true);
      expect(deals[2 * bets.length + 1].faceUp).toBe(false);
      // Every card in a hand was dealt or hit to it.
      bets.forEach((_, s) => {
        const got = round.steps.filter((x) => (x.kind === 'deal' && x.to === s) || (x.kind === 'hit' && x.seat === s)).length;
        expect(got).toBe(round.hands[s].length);
        expect(handValue(round.hands[s]).total).toBeLessThanOrEqual(21 + 10);
      });
      // A dealer that drew ended on 17 or more.
      if (round.steps.some((x) => x.kind === 'dealerHit')) expect(handValue(round.dealer).total).toBeGreaterThanOrEqual(17);
      // Results agree with the settle rule.
      round.results.forEach((res, s) => expect(res).toEqual({ ...settle(round.hands[s], round.dealer, bets[s]), bet: bets[s] }));
      expect(round.steps.filter((x) => x.kind === 'settle').length).toBe(bets.length);
    }
  });

  it('stops after a dealer natural without anyone drawing', () => {
    // Stack a shoe: player 10, dealer A, player 9, dealer K.
    const fixed: Card[] = c(10, 1, 9, 13, 5, 5, 5, 5);
    let i = 0;
    const shoe = { draw: () => fixed[i++], needsShuffle: false, shuffle() {} } as unknown as Shoe;
    const round = playRound(shoe, [25]);
    expect(round.steps.some((x) => x.kind === 'peek' && x.blackjack)).toBe(true);
    expect(round.steps.some((x) => x.kind === 'hit' || x.kind === 'dealerHit')).toBe(false);
    expect(round.results[0].outcome).toBe('lose');
  });

  it('keeps the house edge in the usual range for this simple strategy', () => {
    const shoe = new Shoe(new SeededRng(11));
    let staked = 0,
      returned = 0;
    for (let r = 0; r < 40000; r++) {
      const round = playRound(shoe, [10]);
      staked += 10;
      returned += round.results[0].returned;
    }
    const edge = 1 - returned / staked;
    // Basic strategy without doubles/splits gives up roughly 1.5–3%.
    expect(edge).toBeGreaterThan(-0.01);
    expect(edge).toBeLessThan(0.05);
  });
});
