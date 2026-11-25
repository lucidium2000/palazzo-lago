import { describe, expect, it } from 'vitest';
import {
  awardPots,
  buildPots,
  type Card,
  describe as describeScore,
  equity,
  evaluate,
  handScore,
  npcDecide,
  newDeck,
  packPoker,
  type PokerAction,
  PokerHand,
  type PokerStep,
  unpackPoker,
  unpackScore,
  newView,
  applyStep,
  FLUSH,
  FULL_HOUSE,
  HIGH,
  PAIR,
  QUADS,
  STRAIGHT,
  STRAIGHT_FLUSH,
  TRIPS,
  TWO_PAIR,
} from '../src/rules/poker';
import { SeededRng } from '../src/rules/rng';

/** "As Kd Tc 2h" → cards (rank chars A K Q J T 9..2, suits s h d c). */
const C = (s: string): Card[] =>
  s
    .trim()
    .split(/\s+/)
    .map((t) => {
      const r = 'A23456789TJQK'.indexOf(t[0]) + 1;
      const suit = 'shdc'.indexOf(t[1]);
      if (r < 1 || suit < 0) throw new Error(`bad card ${t}`);
      return { rank: r, suit };
    });
const score = (s: string) => handScore(C(s));
const cat = (s: string) => unpackScore(score(s)).cat;
const key = (c: Card) => c.suit * 13 + c.rank;

/**
 * A deck that deals the given hole cards and board: two passes over `order`
 * (the seats left of the button, clockwise), then burn, flop, burn, turn, burn, river.
 */
function deckFor(order: number[], holes: Record<number, string>, board: string): Card[] {
  const used = new Set<number>();
  const hs = Object.fromEntries(Object.entries(holes).map(([k, v]) => [k, C(v)]));
  const b = C(board);
  for (const c of [...Object.values(hs).flat(), ...b]) used.add(key(c));
  const spare: Card[] = [];
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) if (!used.has(s * 13 + r)) spare.push({ rank: r, suit: s });
  const d: Card[] = [];
  for (let pass = 0; pass < 2; pass++) for (const s of order) d.push(hs[s][pass]);
  d.push(spare.shift()!, b[0], b[1], b[2], spare.shift()!, b[3], spare.shift()!, b[4], ...spare);
  return d;
}

const rng = () => new SeededRng(7);

describe('hand ranking: every category', () => {
  it('names each category from 7 cards', () => {
    const cases: [string, number, string][] = [
      ['As Ks Qs Js Ts 2d 3c', STRAIGHT_FLUSH, 'Royal Flush'],
      ['9h 8h 7h 6h 5h Ad Ac', STRAIGHT_FLUSH, 'Nine-high Straight Flush'],
      ['7c 7d 7h 7s Kd 2c 3h', QUADS, 'Four Sevens'],
      ['Qc Qd Qh 4s 4d 2c 9h', FULL_HOUSE, 'Queens full of Fours'],
      ['Ad 9d 7d 4d 2d Kc Qh', FLUSH, 'Ace-high Flush'],
      ['Tc 9d 8h 7s 6d 2c 2h', STRAIGHT, 'Ten-high Straight'],
      ['8c 8d 8h Ks 4d 2c 9h', TRIPS, 'Three Eights'],
      ['Jc Jd 5h 5s Ad 2c 9h', TWO_PAIR, 'Jacks and Fives'],
      ['Kc Kd 7h 5s 3d 2c 9h', PAIR, 'Pair of Kings'],
      ['Ac Jd 9h 7s 5d 3c 2h', HIGH, 'Ace high'],
    ];
    for (const [hand, c, name] of cases) {
      const r = evaluate(C(hand));
      expect(r.cat, hand).toBe(c);
      expect(r.name, hand).toBe(name);
      expect(r.best).toHaveLength(5);
      expect(handScore(r.best)).toBe(r.score);
    }
  });

  it('orders the categories', () => {
    const ladder = [
      'Ac Jd 9h 7s 5d',
      '2c 2d 3h 4s 5d'.replace('5d', '6d'),
      '2c 2d 3h 3s 4d',
      '2c 2d 2h 3s 4d',
      'Ac 2d 3h 4s 5d',
      '2h 4h 6h 8h 9h',
      '2c 2d 2h 3s 3d',
      '2c 2d 2h 2s 3d',
      'Ah 2h 3h 4h 5h',
    ].map(score);
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
  });

  it('straights: the wheel is the lowest, ace-high the highest, no wrapping round', () => {
    expect(cat('Ac 2d 3h 4s 5d')).toBe(STRAIGHT);
    expect(describeScore(score('Ac 2d 3h 4s 5d'))).toBe('Five-high Straight');
    expect(score('2c 3d 4h 5s 6d')).toBeGreaterThan(score('Ac 2d 3h 4s 5d'));
    expect(score('Ac Kd Qh Js Td')).toBeGreaterThan(score('9c Kd Qh Js Td'));
    expect(cat('Qc Kd Ah 2s 3d')).toBe(HIGH);
    // Steel wheel loses to a six-high straight flush.
    expect(score('2s 3s 4s 5s 6s')).toBeGreaterThan(score('As 2s 3s 4s 5s'));
    // Six cards in a row: the top five count.
    expect(describeScore(score('4c 5d 6h 7s 8d 9c Kh'))).toBe('Nine-high Straight');
  });

  it('kickers decide pairs, two pair, trips, quads and high cards', () => {
    expect(score('Kc Kd Ah 7s 3d')).toBeGreaterThan(score('Kh Ks Qh 7c 3c'));
    expect(score('Kc Kd Ah 7s 4d')).toBeGreaterThan(score('Kh Ks Ad 7c 3c'));
    expect(score('Jc Jd 5h 5s Ad')).toBeGreaterThan(score('Jh Js 5c 5d Kd'));
    expect(score('Jc Jd 6h 6s 2d')).toBeGreaterThan(score('Jh Js 5c 5d Ad'));
    expect(score('8c 8d 8h Ks 4d')).toBeGreaterThan(score('8c 8d 8h Qs Jd'));
    expect(score('7c 7d 7h 7s Kd')).toBeGreaterThan(score('7c 7d 7h 7s Qd'));
    expect(score('Ac Jd 9h 7s 5d')).toBeGreaterThan(score('Ac Jd 9h 7s 4d'));
    // Only five cards play: a sixth and seventh kicker never count.
    expect(score('Ac Ad Kh Qs Jd 4c 3h')).toBe(score('Ac Ad Kh Qs Jd 9c 8h'));
  });

  it('flushes compare card by card; the best five of six suited cards', () => {
    expect(score('Ah Jh 9h 7h 3h')).toBeGreaterThan(score('Ah Jh 9h 6h 5h'));
    expect(describeScore(score('Kh Jh 9h 7h 3h 2h Ac'))).toBe('King-high Flush');
    expect(score('Kh Jh 9h 7h 3h 2h Ac')).toBe(score('Kh Jh 9h 7h 3h'));
  });

  it('full houses: two sets of trips make the best full house; trips beat the pair', () => {
    expect(describeScore(score('9c 9d 9h 4s 4d 4c Ah'))).toBe('Nines full of Fours');
    expect(describeScore(score('9c 9d 4h 4s 4d Ac Ah'))).toBe('Fours full of Aces');
    expect(score('3c 3d 3h 2s 2d')).toBeGreaterThan(score('2c 2d 2h As Ad'));
    expect(score('Tc Td Th 2s 2d')).toBe(score('Tc Td Th 2h 2c'));
  });

  it('quads take the best kicker from what is left', () => {
    expect(score('5c 5d 5h 5s 2d Ac Kh')).toBe(score('5c 5d 5h 5s Ad'));
  });

  it('a straight flush is found even with a bigger plain straight', () => {
    expect(describeScore(score('5h 6h 7h 8h 9h Tc Js'))).toBe('Nine-high Straight Flush');
  });

  it('agrees with best-of-21 on random seven-card hands, and the categories show up at about the right rates', () => {
    const r = new SeededRng(99);
    const counts = new Array(9).fill(0);
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const d = newDeck(r).slice(0, 7);
      const fast = handScore(d);
      expect(evaluate(d).score).toBe(fast);
      counts[unpackScore(fast).cat]++;
    }
    // Seven-card odds: high card 17.4%, pair 43.8%, two pair 23.5%, trips 4.8%, straight 4.6%, flush 3.0%, boat 2.6%.
    expect(counts[PAIR] / N).toBeGreaterThan(0.39);
    expect(counts[PAIR] / N).toBeLessThan(0.49);
    expect(counts[TWO_PAIR] / N).toBeGreaterThan(0.2);
    expect(counts[TWO_PAIR] / N).toBeLessThan(0.27);
    expect(counts[HIGH] / N).toBeGreaterThan(0.14);
    expect(counts[HIGH] / N).toBeLessThan(0.21);
  });
});

describe('pots', () => {
  it('one pot when nobody is short', () => {
    expect(buildPots([{ seat: 0, put: 100, folded: false }, { seat: 1, put: 100, folded: false }, { seat: 2, put: 40, folded: true }])).toEqual([{ amount: 240, eligible: [0, 1] }]);
  });

  it('main pot and side pots for all-ins of different sizes; folded chips stay in', () => {
    const pots = buildPots([
      { seat: 0, put: 50, folded: false },
      { seat: 1, put: 200, folded: false },
      { seat: 2, put: 500, folded: false },
      { seat: 3, put: 500, folded: false },
      { seat: 4, put: 100, folded: true },
    ]);
    expect(pots).toEqual([
      { amount: 250, eligible: [0, 1, 2, 3] }, // 50 x 5
      { amount: 500, eligible: [1, 2, 3] }, // 150 x 3 + 50 from the folder
      { amount: 600, eligible: [2, 3] },
    ]);
    expect(pots.reduce((s, p) => s + p.amount, 0)).toBe(1350);
  });

  it('awards each pot to its best eligible hand; ties split with the odd chip left of the button', () => {
    const pots = [
      { amount: 151, eligible: [0, 1, 2] },
      { amount: 100, eligible: [1, 2] },
    ];
    const scores = new Map([
      [0, 900],
      [1, 500],
      [2, 500],
    ]);
    expect(awardPots(pots, scores, [2, 0, 1])).toEqual([
      { seat: 0, amount: 151, pot: 0 },
      { seat: 2, amount: 50, pot: 1 },
      { seat: 1, amount: 50, pot: 1 },
    ]);
    const tie = awardPots([{ amount: 25, eligible: [0, 1] }], new Map([[0, 1], [1, 1]]), [1, 0]);
    expect(tie).toEqual([
      { seat: 1, amount: 13, pot: 0 },
      { seat: 0, amount: 12, pot: 0 },
    ]);
  });
});

/** Plays actions by seat in order, checking each was accepted. */
function play(h: PokerHand, moves: [number, PokerAction][]) {
  const out: PokerStep[] = [];
  for (const [s, a] of moves) {
    expect(h.waiting, `waiting for ${s} (${JSON.stringify(a)})`).toBe(s);
    const st = h.act(s, a);
    expect(st, `${s} ${JSON.stringify(a)}`).not.toBeNull();
    out.push(...st!);
  }
  return out;
}
const total = (h: PokerHand) => h.players.reduce((s, p) => s + p.stack, 0) + h.totalPot * (h.done ? 0 : 1);

describe('blinds and the order of play', () => {
  it('three-handed: blinds left of the button, the button acts first preflop', () => {
    const h = new PokerHand(rng(), [{ seat: 0, stack: 1000 }, { seat: 2, stack: 1000 }, { seat: 4, stack: 1000 }], 0, 5, 10);
    const st = h.start();
    expect(st.filter((s) => s.kind === 'blind')).toEqual([
      { kind: 'blind', seat: 2, amount: 5, big: false },
      { kind: 'blind', seat: 4, amount: 10, big: true },
    ]);
    expect(st.filter((s) => s.kind === 'deal').map((s) => (s as { seat: number }).seat)).toEqual([2, 4, 0]);
    expect(h.players.every((p) => p.hole.length === 2)).toBe(true);
    expect(h.waiting).toBe(0);
    expect(h.legal()).toMatchObject({ toCall: 10, check: false, call: 10, minTo: 20, maxTo: 1000 });
    expect(h.player(2)!.stack).toBe(995);
  });

  it('the button moves to the next seat in the hand', () => {
    const h = new PokerHand(rng(), [{ seat: 1, stack: 100 }, { seat: 3, stack: 100 }, { seat: 5, stack: 100 }], 2, 5, 10);
    expect(h.button).toBe(3);
    expect([h.sbSeat, h.bbSeat]).toEqual([5, 1]);
  });

  it('heads up: the button posts the small blind, acts first preflop and last after', () => {
    const h = new PokerHand(rng(), [{ seat: 1, stack: 500 }, { seat: 4, stack: 500 }], 4, 5, 10);
    h.start();
    expect([h.sbSeat, h.bbSeat]).toEqual([4, 1]);
    expect(h.waiting).toBe(4);
    play(h, [
      [4, { kind: 'call' }],
      [1, { kind: 'check' }],
    ]);
    expect(h.street).toBe('flop');
    expect(h.board).toHaveLength(3);
    expect(h.waiting).toBe(1);
  });

  it('the big blind gets the option when everyone limps', () => {
    const h = new PokerHand(rng(), [{ seat: 0, stack: 1000 }, { seat: 1, stack: 1000 }, { seat: 2, stack: 1000 }], 0, 5, 10);
    h.start();
    play(h, [
      [0, { kind: 'call' }],
      [1, { kind: 'call' }],
    ]);
    expect(h.street).toBe('preflop');
    expect(h.waiting).toBe(2);
    expect(h.legal()).toMatchObject({ check: true, toCall: 0, minTo: 20 });
    play(h, [[2, { kind: 'raise', to: 40 }]]);
    expect(h.waiting).toBe(0);
    expect(h.legal().toCall).toBe(30);
  });

  it('everyone folds to the big blind: the blinds go to the big blind, uncalled bet returned', () => {
    const h = new PokerHand(rng(), [{ seat: 0, stack: 1000 }, { seat: 1, stack: 1000 }, { seat: 2, stack: 1000 }], 0, 5, 10);
    h.start();
    const st = play(h, [
      [0, { kind: 'fold' }],
      [1, { kind: 'fold' }],
    ]);
    expect(h.done).toBe(true);
    expect(st).toContainEqual({ kind: 'return', seat: 2, amount: 5 });
    expect(st).toContainEqual({ kind: 'win', seat: 2, amount: 10, pot: 0, name: '' });
    expect([...h.stacks().values()]).toEqual([1000, 995, 1005]);
    expect(st.some((s) => s.kind === 'show')).toBe(false);
  });
});

describe('no-limit betting rules', () => {
  it('a raise must be at least the last raise; re-raises grow the minimum', () => {
    const h = new PokerHand(rng(), [{ seat: 0, stack: 1000 }, { seat: 1, stack: 1000 }, { seat: 2, stack: 1000 }], 0, 5, 10);
    h.start();
    expect(h.act(0, { kind: 'raise', to: 15 })).toBeNull(); // less than a full raise
    play(h, [[0, { kind: 'raise', to: 35 }]]); // raise of 25
    expect(h.legal()).toMatchObject({ toCall: 30, minTo: 60 });
    expect(h.act(1, { kind: 'raise', to: 59 })).toBeNull();
    play(h, [[1, { kind: 'raise', to: 100 }]]); // raise of 65
    expect(h.legal()).toMatchObject({ toCall: 90, minTo: 165 });
    expect(h.act(2, { kind: 'check' })).toBeNull();
    expect(h.act(0, { kind: 'call' })).toBeNull(); // not their turn
  });

  it('first bet after the flop is at least the big blind', () => {
    const h = new PokerHand(rng(), [{ seat: 0, stack: 1000 }, { seat: 1, stack: 1000 }], 0, 5, 10);
    h.start();
    play(h, [
      [0, { kind: 'call' }],
      [1, { kind: 'check' }],
    ]);
    expect(h.legal()).toMatchObject({ check: true, minTo: 10, maxTo: 990 });
    expect(h.act(1, { kind: 'raise', to: 5 })).toBeNull();
    const st = play(h, [[1, { kind: 'raise', to: 10 }]]);
    expect(st[0]).toMatchObject({ kind: 'act', act: 'bet', put: 10, to: 10 });
  });

  it('an all-in for less than a full raise does not reopen the betting for those who acted', () => {
    const h = new PokerHand(rng(), [{ seat: 0, stack: 1000 }, { seat: 1, stack: 1000 }, { seat: 2, stack: 130 }], 0, 5, 10);
    h.start();
    // Button raises to 100 (raise 90), SB calls, BB moves in for 130 (30 more: not a full raise).
    const st = play(h, [
      [0, { kind: 'raise', to: 100 }],
      [1, { kind: 'call' }],
      [2, { kind: 'allin' }],
    ]);
    expect(st.find((s) => s.kind === 'act' && s.seat === 2)).toMatchObject({ act: 'allin', to: 130, allIn: true });
    expect(h.waiting).toBe(0);
    const L = h.legal();
    expect(L.toCall).toBe(30);
    expect(L.maxTo).toBe(0); // call or fold only
    expect(h.act(0, { kind: 'raise', to: 300 })).toBeNull();
    play(h, [
      [0, { kind: 'call' }],
      [1, { kind: 'call' }],
    ]);
    expect(h.street).toBe('flop');
  });

  it('a full all-in raise does reopen the betting', () => {
    const h = new PokerHand(rng(), [{ seat: 0, stack: 1000 }, { seat: 1, stack: 1000 }, { seat: 2, stack: 300 }], 0, 5, 10);
    h.start();
    play(h, [
      [0, { kind: 'raise', to: 100 }],
      [1, { kind: 'call' }],
      [2, { kind: 'allin' }], // 300: a raise of 200
    ]);
    expect(h.legal()).toMatchObject({ toCall: 200, minTo: 500, maxTo: 1000 });
  });

  it('calling more than your stack puts you all in for what you have', () => {
    const h = new PokerHand(rng(), [{ seat: 0, stack: 1000 }, { seat: 1, stack: 60 }], 0, 5, 10);
    h.start();
    play(h, [[0, { kind: 'raise', to: 200 }]]);
    expect(h.legal()).toMatchObject({ toCall: 50, call: 50, maxTo: 0 });
    const st = play(h, [[1, { kind: 'call' }]]);
    expect(st.find((s) => s.kind === 'act')).toMatchObject({ act: 'allin', put: 50, to: 60, allIn: true });
    // The uncalled 140 comes back; the board runs out with nobody left to act.
    expect(st).toContainEqual({ kind: 'return', seat: 0, amount: 140 });
    expect(h.done).toBe(true);
    expect(st.filter((s) => s.kind === 'board')).toHaveLength(3);
    expect(st.filter((s) => s.kind === 'show')).toHaveLength(2);
    expect(total(h)).toBe(1060);
  });

  it('a player who leaves mid-hand is folded out of turn; the last one left wins', () => {
    const h = new PokerHand(rng(), [{ seat: 0, stack: 1000 }, { seat: 1, stack: 1000 }, { seat: 2, stack: 1000 }], 0, 5, 10);
    h.start();
    expect(h.waiting).toBe(0);
    const a = h.fold(2);
    expect(a).toEqual([{ kind: 'act', seat: 2, act: 'fold', put: 0, to: 10, allIn: false }]);
    expect(h.waiting).toBe(0);
    play(h, [[0, { kind: 'call' }]]);
    expect(h.waiting).toBe(1);
    const b = h.fold(0);
    expect(h.done).toBe(true);
    expect(b.find((s) => s.kind === 'win')).toMatchObject({ seat: 1, amount: 25 });
    expect(total(h)).toBe(3000);
  });

  it('checks round every street to a showdown in the right order', () => {
    const h = new PokerHand(rng(), [{ seat: 0, stack: 500 }, { seat: 1, stack: 500 }, { seat: 2, stack: 500 }], 0, 5, 10);
    h.start();
    play(h, [
      [0, { kind: 'call' }],
      [1, { kind: 'call' }],
      [2, { kind: 'check' }],
    ]);
    for (const street of ['flop', 'turn', 'river']) {
      expect(h.street).toBe(street);
      play(h, [
        [1, { kind: 'check' }],
        [2, { kind: 'check' }],
        [0, { kind: 'check' }],
      ]);
    }
    expect(h.done).toBe(true);
    const shows = h.steps.filter((s) => s.kind === 'show').map((s) => (s as { seat: number }).seat);
    expect(shows).toEqual([1, 2, 0]);
    expect(h.board).toHaveLength(5);
    expect(total(h)).toBe(1500);
  });

  it('the last river aggressor shows first', () => {
    const h = new PokerHand(rng(), [{ seat: 0, stack: 500 }, { seat: 1, stack: 500 }, { seat: 2, stack: 500 }], 0, 5, 10);
    h.start();
    play(h, [
      [0, { kind: 'call' }],
      [1, { kind: 'call' }],
      [2, { kind: 'check' }],
    ]);
    for (let i = 0; i < 2; i++)
      play(h, [
        [1, { kind: 'check' }],
        [2, { kind: 'check' }],
        [0, { kind: 'check' }],
      ]);
    play(h, [
      [1, { kind: 'check' }],
      [2, { kind: 'raise', to: 20 }],
      [0, { kind: 'call' }],
      [1, { kind: 'call' }],
    ]);
    expect(h.steps.filter((s) => s.kind === 'show').map((s) => (s as { seat: number }).seat)).toEqual([2, 0, 1]);
  });
});

describe('showdown and side pots', () => {
  it('a short all-in wins only the main pot; the side pot goes to the best of the rest', () => {
    // Button 0; order left of the button: 1, 2, 0.
    const deck = deckFor([1, 2, 0], { 0: 'Kc Kd', 1: 'Ac Ad', 2: 'Qc Qd' }, '2s 7h 9d Js 3c');
    const h = new PokerHand(rng(), [{ seat: 0, stack: 500 }, { seat: 1, stack: 100 }, { seat: 2, stack: 300 }], 0, 5, 10, deck);
    h.start();
    play(h, [
      [0, { kind: 'raise', to: 500 }],
      [1, { kind: 'allin' }],
      [2, { kind: 'allin' }],
    ]);
    expect(h.done).toBe(true);
    const wins = h.steps.filter((s) => s.kind === 'win');
    // Main pot 300 (100 x 3) to the aces; side pot 400 (200 x 2) to the kings; 200 uncalled back to seat 0.
    expect(wins).toEqual([
      { kind: 'win', seat: 1, amount: 300, pot: 0, name: 'Pair of Aces' },
      { kind: 'win', seat: 0, amount: 400, pot: 1, name: 'Pair of Kings' },
    ]);
    expect(h.steps).toContainEqual({ kind: 'return', seat: 0, amount: 200 });
    expect(Object.fromEntries(h.stacks())).toEqual({ 0: 600, 1: 300, 2: 0 });
  });

  it('three all-ins, a folded player, and the biggest stack winning everything it can', () => {
    const deck = deckFor([1, 2, 3, 0], { 0: '9c 9d', 1: 'Ac Kd', 2: '2c 7d', 3: 'Th Td' }, 'Ts 9h 4d 4s Jc');
    const h = new PokerHand(rng(), [{ seat: 0, stack: 1000 }, { seat: 1, stack: 50 }, { seat: 2, stack: 400 }, { seat: 3, stack: 200 }], 0, 5, 10, deck);
    h.start();
    // Order preflop: 3 (UTG), 0, 1 (SB), 2 (BB).
    play(h, [
      [3, { kind: 'allin' }],
      [0, { kind: 'raise', to: 1000 }],
      [1, { kind: 'allin' }],
      [2, { kind: 'fold' }],
    ]);
    expect(h.done).toBe(true);
    // Tens full beat nines full. Main pot: 50 x 3 + 10 from the folded BB = 160; side: 150 x 2 = 300; seat 0 gets 800 back.
    const wins = h.steps.filter((s) => s.kind === 'win').map((s) => s as { seat: number; amount: number; pot: number });
    expect(wins).toEqual([
      expect.objectContaining({ seat: 3, amount: 160, pot: 0 }),
      expect.objectContaining({ seat: 3, amount: 300, pot: 1 }),
    ]);
    expect(Object.fromEntries(h.stacks())).toEqual({ 0: 800, 1: 0, 2: 390, 3: 460 });
  });

  it('a split pot when the board plays, odd chip left of the button', () => {
    const deck = deckFor([1, 2, 0], { 0: '2c 3d', 1: '2d 3c', 2: '4c 5d' }, 'As Ks Qs Js Ts');
    const h = new PokerHand(rng(), [{ seat: 0, stack: 100 }, { seat: 1, stack: 100 }, { seat: 2, stack: 100 }], 0, 5, 10, deck);
    h.start();
    play(h, [
      [0, { kind: 'call' }],
      [1, { kind: 'call' }],
      [2, { kind: 'raise', to: 21 }],
      [0, { kind: 'call' }],
      [1, { kind: 'call' }],
    ]);
    for (let i = 0; i < 3; i++)
      play(h, [
        [1, { kind: 'check' }],
        [2, { kind: 'check' }],
        [0, { kind: 'check' }],
      ]);
    const wins = h.steps.filter((s) => s.kind === 'win').map((s) => s as { seat: number; amount: number });
    expect(wins.map((w) => w.seat)).toEqual([1, 2, 0]);
    expect(wins.map((w) => w.amount)).toEqual([21, 21, 21]);
    expect(wins.every((w) => (w as unknown as { name: string }).name === 'Royal Flush')).toBe(true);
    expect(total(h)).toBe(300);
  });

  it('odd chips of a split go to the first winners left of the button', () => {
    const pots = buildPots([
      { seat: 0, put: 15, folded: false },
      { seat: 1, put: 15, folded: false },
      { seat: 2, put: 5, folded: true },
    ]);
    expect(pots).toEqual([{ amount: 35, eligible: [0, 1] }]);
    expect(awardPots(pots, new Map([[0, 7], [1, 7]]), [1, 2, 0])).toEqual([
      { seat: 1, amount: 18, pot: 0 },
      { seat: 0, amount: 17, pot: 0 },
    ]);
  });

  it('kickers decide a showdown', () => {
    const deck = deckFor([1, 0], { 0: 'Ah Qc', 1: 'As Jd' }, 'Ac 8s 6d 4h 2c');
    const h = new PokerHand(rng(), [{ seat: 0, stack: 200 }, { seat: 1, stack: 200 }], 0, 5, 10, deck);
    h.start();
    play(h, [
      [0, { kind: 'allin' }],
      [1, { kind: 'call' }],
    ]);
    expect(h.steps.filter((s) => s.kind === 'win')).toEqual([{ kind: 'win', seat: 0, amount: 400, pot: 0, name: 'Pair of Aces' }]);
  });
});

describe('many random hands', () => {
  it('chips are never created or lost, stacks never go negative, every hand ends', () => {
    const r = new SeededRng(2024);
    let stacks = new Map([0, 1, 2, 3, 4, 5].map((s) => [s, 1000]));
    let button = 0;
    for (let n = 0; n < 400; n++) {
      const entries = [...stacks].filter(([, v]) => v > 0).map(([seat, stack]) => ({ seat, stack }));
      if (entries.length < 2) stacks = new Map([0, 1, 2, 3, 4, 5].map((s) => [s, 1000]));
      const e = entries.length >= 2 ? entries : [...stacks].map(([seat, stack]) => ({ seat, stack }));
      const before = e.reduce((s, x) => s + x.stack, 0);
      const h = new PokerHand(r, e, button, 5, 10);
      h.start();
      for (let guard = 0; guard < 200 && !h.done; guard++) {
        const s = h.waiting!;
        const L = h.legal();
        const roll = r.next();
        let a: PokerAction;
        if (roll < 0.15) a = { kind: 'fold' };
        else if (roll < 0.25 && L.maxTo) a = { kind: 'allin' };
        else if (roll < 0.45 && L.maxTo) a = { kind: 'raise', to: L.minTo + r.int(Math.max(1, L.maxTo - L.minTo + 1)) };
        else a = L.check ? { kind: 'check' } : { kind: 'call' };
        expect(h.act(s, a), JSON.stringify({ a, L })).not.toBeNull();
        for (const p of h.players) expect(p.stack).toBeGreaterThanOrEqual(0);
      }
      expect(h.done).toBe(true);
      const after = [...h.stacks().values()].reduce((s, x) => s + x, 0);
      expect(after).toBe(before);
      for (const [seat, v] of h.stacks()) stacks.set(seat, v);
      button = (button + 1) % 6;
    }
  });
});

describe('NPC guests', () => {
  it('always choose a legal action', () => {
    const r = new SeededRng(5);
    const styles = [
      { loose: 0.2, aggro: 0.2, bluff: 0.05 },
      { loose: 0.8, aggro: 0.9, bluff: 0.3 },
      { loose: 0.5, aggro: 0.5, bluff: 0.1 },
    ];
    for (let n = 0; n < 60; n++) {
      const h = new PokerHand(r, [0, 1, 2, 3].map((s) => ({ seat: s, stack: 200 + r.int(1500) })), n % 4, 5, 10);
      h.start();
      for (let guard = 0; guard < 100 && !h.done; guard++) {
        const s = h.waiting!;
        const p = h.player(s)!;
        const a = npcDecide({ hole: p.hole, board: h.board, legal: h.legal(), pot: h.totalPot, opponents: h.players.filter((q) => !q.folded).length - 1, bb: 10 }, styles[s % 3], r, 40);
        expect(h.act(s, a), JSON.stringify(a)).not.toBeNull();
      }
      expect(h.done).toBe(true);
    }
  });

  it('fold trash to a big bet and raise monsters', () => {
    const r = new SeededRng(11);
    const style = { loose: 0.5, aggro: 0.6, bluff: 0 };
    const legal = { toCall: 300, check: false, call: 300, minTo: 600, maxTo: 1000, bet: 0, stack: 1000 };
    let folds = 0,
      raises = 0;
    for (let i = 0; i < 40; i++) {
      const trash = npcDecide({ hole: C('7c 2d'), board: C('As Kh 9s'), legal, pot: 450, opponents: 2, bb: 10 }, style, r, 60);
      if (trash.kind === 'fold') folds++;
      const nuts = npcDecide({ hole: C('Ac Ad'), board: C('As Ah 9s'), legal, pot: 450, opponents: 2, bb: 10 }, style, r, 60);
      if (nuts.kind === 'raise' || nuts.kind === 'allin') raises++;
      expect(nuts.kind).not.toBe('fold');
    }
    expect(folds).toBe(40);
    expect(raises).toBeGreaterThan(15);
  });

  it('equity is about right for well-known matchups', () => {
    const r = new SeededRng(3);
    // Aces against one random hand: ~85%.
    const aa = equity(C('As Ah'), [], 1, r, 1500);
    expect(aa).toBeGreaterThan(0.8);
    expect(aa).toBeLessThan(0.9);
    // Made nut flush on the river against two: nearly always.
    expect(equity(C('As 2s'), C('Ks 9s 4s Jd 3c'), 2, r, 300)).toBeGreaterThan(0.95);
  });
});

describe('wire form', () => {
  it('round-trips, hiding hole cards except the viewer’s until the showdown', () => {
    const deck = deckFor([1, 0], { 0: 'Ah Qc', 1: 'As Jd' }, 'Ac 8s 6d 4h 2c');
    const h = new PokerHand(rng(), [{ seat: 0, stack: 200 }, { seat: 1, stack: 200 }], 0, 5, 10, deck);
    h.start();
    const early = unpackPoker(JSON.parse(JSON.stringify(packPoker(h.steps, 1))));
    const deals = early.filter((s) => s.kind === 'deal') as { seat: number; cards: Card[] }[];
    expect(deals.find((d) => d.seat === 1)!.cards).toEqual(C('As Jd'));
    expect(deals.find((d) => d.seat === 0)!.cards.every((c) => c.rank === 0)).toBe(true);
    // Nobody's cards for a spectator.
    expect((unpackPoker(packPoker(h.steps)).filter((s) => s.kind === 'deal') as { cards: Card[] }[]).every((d) => d.cards.every((c) => c.rank === 0))).toBe(true);
    play(h, [
      [0, { kind: 'allin' }],
      [1, { kind: 'call' }],
    ]);
    const all = unpackPoker(packPoker(h.steps));
    expect(all.filter((s) => s.kind !== 'deal')).toEqual(h.steps.filter((s) => s.kind !== 'deal').map((s) => (s.kind === 'win' ? { ...s, name: '' } : s)));
    const shown = all.filter((s) => s.kind === 'show') as { seat: number; cards: Card[]; name: string }[];
    expect(shown.find((s) => s.seat === 0)).toMatchObject({ cards: C('Ah Qc'), name: 'Pair of Aces' });
    expect(unpackPoker([['x'], 'junk', ['a', 99, 0, 0, 0, 0], ['d', 1, 60, 3]])).toEqual([]);
  });
});

describe('what the table shows', () => {
  it('folds the steps of a hand into stacks, bets, the pot and the board', () => {
    const deck = deckFor([1, 2, 0], { 0: 'Kc Kd', 1: 'Ac Ad', 2: 'Qc Qd' }, '2s 7h 9d Js 3c');
    const h = new PokerHand(rng(), [{ seat: 0, stack: 500 }, { seat: 1, stack: 100 }, { seat: 2, stack: 300 }], 0, 5, 10, deck);
    const v = newView([[0, 500], [1, 100], [2, 300]]);
    for (const s of h.start()) applyStep(v, s);
    expect(v.seats.get(1)).toMatchObject({ stack: 95, bet: 5, last: 'Small blind $5' });
    expect(v.turn).toBe(0);
    for (const s of h.act(0, { kind: 'raise', to: 30 })!) applyStep(v, s);
    expect(v.seats.get(0)).toMatchObject({ stack: 470, bet: 30, last: 'Raise to $30' });
    expect(v.turn).toBe(1);
    for (const s of h.act(1, { kind: 'call' })!) applyStep(v, s);
    for (const s of h.act(2, { kind: 'call' })!) applyStep(v, s);
    expect(v.pot).toBe(90);
    expect(v.board).toHaveLength(3);
    expect([...v.seats.values()].every((p) => p.bet === 0)).toBe(true);
    const moves: [number, PokerAction][] = [
      [1, { kind: 'allin' }],
      [2, { kind: 'allin' }],
      [0, { kind: 'call' }],
    ];
    for (const [s, a] of moves) for (const st of h.act(s, a)!) applyStep(v, st);
    expect(v.ended).toBe(true);
    expect(Object.fromEntries([...v.seats].map(([k, p]) => [k, p.stack]))).toEqual(Object.fromEntries(h.stacks()));
    expect(v.seats.get(1)).toMatchObject({ shown: true, hand: 'Pair of Aces' });
    expect(v.pot).toBe(0);
  });

  it('a hand won by folds ends with every chip back in a stack', () => {
    const h = new PokerHand(rng(), [{ seat: 0, stack: 1000 }, { seat: 1, stack: 1000 }, { seat: 2, stack: 1000 }], 0, 5, 10);
    const v = newView([[0, 1000], [1, 1000], [2, 1000]]);
    for (const s of h.start()) applyStep(v, s);
    for (const s of h.act(0, { kind: 'raise', to: 40 })!) applyStep(v, s);
    for (const s of h.act(1, { kind: 'fold' })!) applyStep(v, s);
    for (const s of h.act(2, { kind: 'fold' })!) applyStep(v, s);
    expect([...v.seats.values()].map((p) => p.stack)).toEqual([...h.stacks().values()]);
    expect([...v.seats.values()].every((p) => p.bet === 0)).toBe(true);
    expect(v.seats.get(0)!.last).toBe('Wins $25');
  });
});
