import { describe, expect, it } from 'vitest';
import { type Card, handValue, isBust, packSteps, settleHand, Shoe, TableRound, type TableStep, unpackSteps } from '../src/rules/blackjack';
import { SeededRng } from '../src/rules/rng';

const c = (...ranks: number[]): Card[] => ranks.map((rank, i) => ({ rank, suit: i % 4 }));
/** A shoe that deals exactly these ranks, in order (then tens). */
const stacked = (...ranks: number[]) => {
  const cards = c(...ranks);
  let i = 0;
  return { draw: () => cards[i++] ?? { rank: 10, suit: 0 }, needsShuffle: false, shuffle() {} } as unknown as Shoe;
};
const kinds = (steps: TableStep[]) => steps.map((s) => s.kind);

describe('a live table round', () => {
  it('waits for the player, then plays guests after them and the dealer', () => {
    // Deal order: seat 1 (guest), seat 3 (you), dealer up; again, dealer hole.
    // Guest 10,6 vs dealer 9 hits (a 4); you 5,6 = 11 hit a 10; the dealer's 16 draws a 2.
    const shoe = stacked(10, 5, 9, 6, 6, 7, 4, 10, 2);
    const r = new TableRound(shoe, [
      { seat: 3, bet: 50, auto: false },
      { seat: 1, bet: 25, auto: true },
    ]);
    const first = r.start();
    expect(kinds(first).slice(0, 2)).toEqual(['bet', 'bet']);
    expect(first.filter((s) => s.kind === 'deal')).toHaveLength(6);
    // Seat 1 plays before you (first base first): 10,6 hits against a 9.
    expect(first.some((s) => s.kind === 'hit' && s.seat === 1)).toBe(true);
    expect(r.waiting).toEqual({ seat: 3, hand: 0 });
    expect(first[first.length - 1]).toEqual({ kind: 'turn', seat: 3, hand: 0 });
    expect(r.legal()).toEqual({ hit: true, stand: true, double: true, split: false });
    // Not your seat / not your turn.
    expect(r.act(1, 'hit')).toBeNull();
    const hit = r.act(3, 'hit')!;
    expect(hit[0]).toMatchObject({ kind: 'hit', seat: 3, hand: 0 });
    expect(handValue(r.seats.find((s) => s.seat === 3)!.hands[0].cards).total).toBe(21);
    // 21 stands by itself and the dealer plays.
    expect(kinds(hit)).toContain('reveal');
    expect(r.done).toBe(true);
    const settle = r.steps.filter((s) => s.kind === 'settle');
    expect(settle).toHaveLength(2);
    expect(settle.find((s) => s.kind === 'settle' && s.seat === 3)).toMatchObject({ outcome: 'win', returned: 100 });
  });

  it('doubles: one card, twice the stake', () => {
    const shoe = stacked(6, 6, 5, 10, /* double card */ 10, /* dealer draws */ 10);
    const r = new TableRound(shoe, [{ seat: 0, bet: 25, auto: false }]);
    r.start();
    expect(r.waiting).toEqual({ seat: 0, hand: 0 });
    const d = r.act(0, 'double')!;
    expect(d[0]).toMatchObject({ kind: 'double', seat: 0, hand: 0, bet: 25 });
    expect(r.seats[0].hands[0]).toMatchObject({ bet: 50, doubled: true });
    // Dealer 6+10 = 16 draws a ten and busts: 21 doubled wins 100 back.
    expect(r.steps.find((s) => s.kind === 'settle')).toMatchObject({ outcome: 'win', bet: 50, returned: 100 });
  });

  it('only doubles on the first two cards', () => {
    const r = new TableRound(stacked(2, 6, 3, 10, 2), [{ seat: 0, bet: 25, auto: false }]);
    r.start();
    r.act(0, 'hit');
    expect(r.legal().double).toBe(false);
    expect(r.act(0, 'double')).toBeNull();
  });

  it('splits a pair into two hands played one after the other', () => {
    // You 8,8 against a dealer 6 (hole 10).
    const shoe = stacked(8, 6, 8, 10, /* hand 0 */ 3, /* hand 0 hits */ 10, /* hand 1 second card */ 2, /* dealer */ 9);
    const r = new TableRound(shoe, [{ seat: 2, bet: 25, auto: false }]);
    r.start();
    expect(r.legal().split).toBe(true);
    const sp = r.act(2, 'split')!;
    expect(kinds(sp)).toEqual(['split', 'hit', 'turn']);
    expect(r.seats[0].hands).toHaveLength(2);
    expect(r.legal().split).toBe(false);
    // Hand 0: 8,3 -> hit 10 = 21, stands itself; then hand 1 gets its second card.
    const h = r.act(2, 'hit')!;
    expect(h.map((s) => [s.kind, 'hand' in s ? s.hand : -1])).toEqual([
      ['hit', 0],
      ['stand', 0],
      ['hit', 1],
      ['turn', 1],
    ]);
    expect(r.waiting).toEqual({ seat: 2, hand: 1 });
    r.act(2, 'stand');
    expect(r.done).toBe(true);
    // Dealer 6+10+9 busts: both hands win; 21 after a split is not a natural.
    const s = r.steps.filter((x) => x.kind === 'settle');
    expect(s.map((x) => x.kind === 'settle' && x.outcome)).toEqual(['win', 'win']);
    expect(s.map((x) => x.kind === 'settle' && x.returned)).toEqual([50, 50]);
  });

  it('split aces take one card each', () => {
    const r = new TableRound(stacked(1, 9, 1, 8, 13, 12), [{ seat: 0, bet: 10, auto: false }]);
    r.start();
    r.act(0, 'split');
    expect(r.done).toBe(true);
    expect(r.seats[0].hands.map((h) => h.cards.length)).toEqual([2, 2]);
    // Two 21s, paid even money (not 3:2), against the dealer's 17.
    expect(r.steps.filter((x) => x.kind === 'settle').map((x) => x.kind === 'settle' && x.returned)).toEqual([20, 20]);
  });

  it('a player natural is paid 3:2 without being asked anything', () => {
    const r = new TableRound(stacked(1, 9, 13, 8), [{ seat: 4, bet: 20, auto: false }]);
    const steps = r.start();
    expect(kinds(steps)).not.toContain('turn');
    expect(r.steps.find((s) => s.kind === 'settle')).toMatchObject({ outcome: 'blackjack', returned: 50 });
  });

  it('a dealer natural ends the round at the peek', () => {
    const r = new TableRound(stacked(10, 1, 9, 13), [{ seat: 0, bet: 20, auto: false }]);
    r.start();
    expect(r.done).toBe(true);
    expect(r.waiting).toBeNull();
    expect(r.steps.find((s) => s.kind === 'settle')).toMatchObject({ outcome: 'lose', returned: 0 });
  });

  it('plays thousands of random rounds consistently (guests and a standing player)', () => {
    const shoe = new Shoe(new SeededRng(5));
    for (let n = 0; n < 2000; n++) {
      const r = new TableRound(shoe, [
        { seat: 0, bet: 25, auto: true },
        { seat: 2, bet: 50, auto: false },
        { seat: 5, bet: 25, auto: true },
      ]);
      r.start();
      let guard = 0;
      while (r.waiting && guard++ < 20) {
        const L = r.legal();
        const act = L.split && n % 3 === 0 ? 'split' : L.double && n % 5 === 0 ? 'double' : n % 2 ? 'hit' : 'stand';
        expect(r.act(r.waiting.seat, act)).not.toBeNull();
      }
      expect(r.done).toBe(true);
      // Every hand settled once, with the rule's result.
      const settles = r.steps.filter((s) => s.kind === 'settle');
      expect(settles.length).toBe(r.seats.reduce((a, s) => a + s.hands.length, 0));
      for (const s of r.seats) s.hands.forEach((h, hi) => expect(settles.find((x) => x.kind === 'settle' && x.seat === s.seat && x.hand === hi)).toMatchObject(settleHand(h, r.dealer)));
      // Cards in hands match the steps that dealt them.
      const dealt = r.steps.filter((s) => s.kind === 'deal' || s.kind === 'hit' || s.kind === 'double' || s.kind === 'dealerHit').length;
      expect(dealt).toBe(r.dealer.length + r.seats.reduce((a, s) => a + s.hands.reduce((b, h) => b + h.cards.length, 0), 0));
      for (const s of r.seats) for (const h of s.hands) if (h.done && !isBust(h.cards)) expect(handValue(h.cards).total).toBeLessThanOrEqual(21);
    }
  });
});

describe('table steps on the wire', () => {
  it('round-trips, hiding the hole card until it is turned', () => {
    const r = new TableRound(new Shoe(new SeededRng(9)), [
      { seat: 1, bet: 25, auto: true },
      { seat: 3, bet: 100, auto: false },
    ]);
    r.start();
    while (r.waiting) r.act(r.waiting.seat, 'stand');
    const packed = packSteps(r.steps);
    expect(JSON.stringify(packed).length).toBeLessThan(800);
    const back = unpackSteps(JSON.parse(JSON.stringify(packed)));
    expect(back.length).toBe(r.steps.length);
    const hole = r.steps.findIndex((s) => s.kind === 'deal' && s.to === 'dealer' && !s.faceUp);
    back.forEach((s, i) => {
      if (i === hole) expect(s).toMatchObject({ kind: 'deal', to: 'dealer', faceUp: false, card: { rank: 0 } });
      else expect(s).toEqual(r.steps[i]);
    });
  });
  it('drops junk', () => {
    expect(unpackSteps([['b', 9, 25], ['h', 1, 0, 99], 'x', null, ['$', 1, 0, 7, 1, 1], ['b', 2, 25]])).toEqual([{ kind: 'bet', seat: 2, amount: 25 }]);
    expect(unpackSteps('nope')).toEqual([]);
  });
});
