import { describe, expect, it } from 'vitest';
import { Bankroll } from '../src/rules/bankroll';
import { Shoe, TableRound } from '../src/rules/blackjack';
import { auditChips, ChipLedger } from '../src/rules/chipledger';
import { DealerClock } from '../src/rules/dealerclock';
import { type Legal, type PokerAction, PokerHand, stagedAction } from '../src/rules/poker';
import { SeededRng } from '../src/rules/rng';
import { BetRejected, RouletteGame } from '../src/rules/roulette';

/**
 * The chip books through each table's whole flow, as the client runs it: chips
 * out of the wallet tray (one per grab, more while you hold), bets by hand or
 * by a pointing finger, the dealer's own call (roulette spins and blackjack
 * deals with no button), payouts, and at poker your table stack (the tray deals
 * from it) through pots. Every step: nothing appears, nothing vanishes.
 */

const c2 = (x: number) => Math.round(x * 100) / 100;
const DENOMS = [1, 5, 25, 100, 500] as const;

describe('roulette: tray chips, pointing, and the croupier spinning on his own', () => {
  for (const seed of [3, 17, 99]) {
    it(`conserves money through auto-spins and payouts (seed ${seed})`, () => {
      const r = new SeededRng(seed);
      const pick = <T>(a: readonly T[]) => a[r.int(a.length)];
      const bank = new Bankroll({ balance: 3000 });
      const ledger = new ChipLedger(bank);
      const game = new RouletteGame(bank);
      const clock = new DealerClock();
      const spots = ['red', 'black', 'even', 'odd', 'dozen1', 'col2', 'n17', 'n0'].filter((id) => {
        try {
          game.placeBet(id, 10);
          game.removeBet(id);
          return true;
        } catch {
          return false;
        }
      });
      expect(spots.length).toBeGreaterThan(3);
      let expected = 3000;
      let spinning = false;
      let spins = 0,
        calls = 0;
      let lastChange = 0,
        firstBet: number | null = null;
      let looseId = 0;
      const place = (spot: string) => (a: number) => {
        try {
          game.placeBet(spot, a);
          return true;
        } catch (e) {
          if (e instanceof BetRejected) return false;
          throw e;
        }
      };
      const layout = () => [...game.bets].map(([k, v]) => `${k}:${v}`).join();
      for (let step = 0, now = 0; step < 3000; step++, now = c2(now + 0.25)) {
        const before = layout();
        if (!spinning && clock.state === 'open' && r.next() < 0.3) {
          const act = pick(['grab', 'scoop', 'place', 'return', 'point', 'drop', 'collect', 'lift']);
          const d = pick(DENOMS);
          if (act === 'grab') ledger.take('right', d);
          else if (act === 'scoop') for (let k = 0; k < 3; k++) ledger.take('right', d);
          else if (act === 'place') ledger.betFromHand('right', ledger.handOf('right'), place(pick(spots)));
          else if (act === 'return') ledger.returnHand('right');
          else if (act === 'point') place(pick(spots))(Math.max(d, 1));
          else if (act === 'drop' && ledger.handOf('right') > 0) ledger.drop('right', [[`l${looseId++}`, ledger.handOf('right')]]);
          else if (act === 'collect') for (const id of [...ledger.loose.keys()]) ledger.collect(id);
          else if (act === 'lift' && game.bets.size) game.removeBet(pick([...game.bets.keys()]));
        }
        if (layout() !== before) {
          lastChange = now;
          if (firstBet === null && game.bets.size) firstBet = now;
        }
        if (!game.bets.size) firstBet = null;
        const ev = clock.update({ now, bets: game.bets.size > 0, layout: layout(), placing: false, busy: spinning });
        if (ev === 'call') {
          if (game.minimumProblem()) clock.reopen(now);
          else {
            calls++;
            // He only calls when the layout's been quiet 4 s, or 20 s after the first bet.
            expect(now - lastChange >= 4 - 1e-6 || (firstBet !== null && now - firstBet >= 20 - 1e-6)).toBe(true);
          }
        } else if (ev === 'go') {
          game.spin(r);
          spinning = true;
        } else if (spinning && r.next() < 0.1) {
          const res = game.settle();
          expected = c2(expected + res.totalReturned - res.totalStaked);
          spinning = false;
          spins++;
          firstBet = null;
        }
        const snap = { balance: bank.balance, bets: { roulette: game.totalBet }, hand: ledger.inHand, loose: ledger.onTable };
        const a = auditChips(snap, expected);
        expect(a.issues, `step ${step}`).toEqual([]);
      }
      expect(spins).toBeGreaterThan(5);
      expect(calls).toBeGreaterThanOrEqual(spins);
    });
  }
});

describe('blackjack: tray chips into the circle, the dealer deals when bets settle', () => {
  it('conserves money through rounds, doubles, splits and payouts', () => {
    const r = new SeededRng(5);
    const bank = new Bankroll({ balance: 3000 });
    const ledger = new ChipLedger(bank);
    const shoe = new Shoe(r);
    const clock = new DealerClock({ idle: 4, window: 15, warn: 0.25 });
    const MIN = 10,
      MAX = 500;
    let pending = 0;
    let expected = 3000;
    let rounds = 0;
    const intoCircle = (a: number) => {
      if (pending + a > MAX || !bank.canAfford(a)) return false;
      bank.debit(a, 'bet', 'blackjack');
      pending = c2(pending + a);
      return true;
    };
    for (let step = 0, now = 0; step < 2000; step++, now = c2(now + 0.25)) {
      if (r.next() < 0.25) {
        const d = [5, 25, 100][r.int(3)];
        const act = r.int(4);
        if (act === 0) ledger.take('right', d);
        else if (act === 1) ledger.betFromHand('right', ledger.handOf('right'), intoCircle);
        else if (act === 2) intoCircle(d);
        else ledger.returnHand('right');
      }
      const ev = clock.update({ now, bets: pending >= MIN, layout: String(pending) });
      if (ev === 'go') {
        // The round: you (played by the house strategy here) and a guest.
        const round = new TableRound(shoe, [
          { seat: 0, bet: pending, auto: true },
          { seat: 2, bet: 25, auto: true },
        ]);
        round.start();
        expect(round.done).toBe(true);
        let staked = 0,
          returned = 0;
        for (const s of round.steps) if (s.kind === 'settle' && s.seat === 0) (staked += s.bet), (returned += s.returned);
        // A double or split puts more of your chips out: from the balance, as the client does.
        const extra = c2(staked - pending);
        expect(extra).toBeGreaterThanOrEqual(0);
        if (extra > 0) bank.debit(extra, 'bet', 'blackjack');
        if (returned > 0) bank.credit(returned, 'win', 'blackjack');
        expected = c2(expected + returned - staked);
        pending = 0;
        rounds++;
      }
      const a = auditChips({ balance: bank.balance, bets: { blackjack: pending }, hand: ledger.inHand, loose: ledger.onTable }, expected);
      expect(a.issues, `step ${step}`).toEqual([]);
    }
    expect(rounds).toBeGreaterThan(5);
  });
});

describe('poker: the tray deals from your stack, pots move chips between players', () => {
  it('buy-in, tray chips pushed out as bets and raises, pots and cash-out add up', () => {
    const r = new SeededRng(11);
    const bank = new Bankroll({ balance: 3000 });
    const ledger = new ChipLedger(bank);
    // Sit down: the buy-in leaves the wallet for your stack.
    bank.debit(1000, 'bet', 'poker');
    let stacks = new Map([
      [0, 1000],
      [1, 1000],
      [3, 1000],
    ]);
    let tableTotal = 3000;
    let house = 0;
    const worth = () => c2(bank.balance + ledger.out + (stacks.get(0) ?? 0));
    const everyone = () => c2(bank.balance + [...stacks.values()].reduce((s, v) => s + v, 0));
    const startWorld = everyone();
    let button = 0,
      trayBets = 0,
      raises = 0;
    for (let n = 0; n < 150; n++) {
      // Out of chips: you rebuy from your wallet; a regular who busts brings fresh money (the house's).
      if ((stacks.get(0) ?? 0) < 10 && bank.canAfford(1000)) {
        bank.debit(1000, 'bet', 'poker');
        stacks.set(0, (stacks.get(0) ?? 0) + 1000);
        tableTotal += 1000;
      }
      for (const k of [1, 3])
        if ((stacks.get(k) ?? 0) < 10) {
          stacks.set(k, (stacks.get(k) ?? 0) + 1000);
          tableTotal += 1000;
          house += 1000;
        }
      const entries = [...stacks].filter(([, v]) => v >= 10).map(([seat, stack]) => ({ seat, stack }));
      if (entries.length < 2 || !entries.some((e) => e.seat === 0)) break;
      const h = new PokerHand(r, entries, button, 5, 10);
      h.start();
      for (let guard = 0; guard < 300 && !h.done; guard++) {
        const s = h.waiting!;
        const L: Legal = h.legal();
        let a: PokerAction | null = null;
        if (s === 0) {
          // Your turn: chips out of the tray one at a time (it only offers what's left of your stack).
          const p = h.player(0)!;
          let staged = 0,
            carried = 0;
          const avail = () => p.stack - staged - carried;
          const roll = r.next();
          const want = roll < 0.2 ? 0 : roll < 0.5 ? L.call : roll < 0.9 ? Math.max(L.call, L.minTo - L.bet) + 5 * r.int(6) : p.stack;
          for (const d of [500, 100, 25, 5]) while (staged + carried + d <= want && avail() >= d) carried += d;
          expect(avail()).toBeGreaterThanOrEqual(0);
          // Let go over the betting line: they're staged (still in your stack until the action).
          staged += carried;
          carried = 0;
          const res = stagedAction(L, staged);
          if (res && 'action' in res) {
            a = res.action;
            trayBets++;
            if (a.kind === 'raise') raises++;
          } else a = L.check ? { kind: 'check' } : { kind: 'fold' };
        } else {
          const roll = r.next();
          a = roll < 0.15 ? { kind: 'fold' } : roll < 0.3 && L.maxTo ? { kind: 'raise', to: L.minTo } : L.check ? { kind: 'check' } : { kind: 'call' };
        }
        if (!h.act(s, a)) h.act(s, L.check ? { kind: 'check' } : { kind: 'fold' });
        // Mid-hand your stack shrinks as chips go in: the pot holds them (nothing lost overall).
        const inPlay = h.players.reduce((t, q) => t + q.stack, 0);
        if (!h.done) expect(inPlay + h.totalPot).toBe(entries.reduce((t, e) => t + e.stack, 0));
      }
      expect(h.done).toBe(true);
      for (const [seat, v] of h.stacks()) stacks.set(seat, v);
      expect([...stacks.values()].reduce((t, v) => t + v, 0)).toBe(tableTotal);
      expect(everyone()).toBe(startWorld + house);
      button = (button + 1) % 4;
    }
    expect(trayBets).toBeGreaterThan(10);
    expect(raises).toBeGreaterThan(0);
    // Stand up: your stack goes back to the wallet.
    const mine = stacks.get(0) ?? 0;
    const w = worth();
    bank.credit(mine, 'refund', 'poker');
    stacks = new Map([...stacks].filter(([k]) => k !== 0));
    expect(worth()).toBe(w);
  });
});
