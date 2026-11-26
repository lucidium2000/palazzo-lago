import { describe, expect, it } from 'vitest';
import { DIAMOND_SEVENS, LAGO_FORTUNA, ROYAL_CONSERVATORY } from '../src/rules/machines';
import { PIGGY, PiggyGame } from '../src/rules/piggy';
import { SeededRng } from '../src/rules/rng';
import {
  decodeCraps,
  decodePiggySpin,
  decodeRoulette,
  decodeSlotSpin,
  encodeCraps,
  encodePiggySpin,
  encodeRoulette,
  MAX_SPOTS,
  resolveCraps,
  resolveRoulette,
} from '../src/client/net/mirrorCodec';
import { BET_SPOTS } from '../src/rules/roulette';

describe('roulette layout wire format', () => {
  it('round-trips a layout compactly', () => {
    const bets = new Map([
      ['straight:17', 5],
      ['red', 25],
      ['dozen:2', 10],
    ]);
    const wire = encodeRoulette(bets);
    expect(wire.every((x) => typeof x === 'number')).toBe(true);
    expect(decodeRoulette(JSON.parse(JSON.stringify(wire)))).toEqual(bets);
    expect(JSON.stringify(wire).length).toBeLessThan(60);
  });

  it('keeps the biggest bets when the layout is huge, staying small', () => {
    const bets = new Map(BET_SPOTS.map((s, i) => [s.id, i + 1]));
    const wire = encodeRoulette(bets);
    const back = decodeRoulette(wire);
    expect(back.size).toBe(MAX_SPOTS);
    expect(back.get(BET_SPOTS[BET_SPOTS.length - 1].id)).toBe(BET_SPOTS.length);
    expect(JSON.stringify({ b: wire }).length).toBeLessThan(600);
  });

  it('ignores junk from the network', () => {
    expect(decodeRoulette(null).size).toBe(0);
    expect(decodeRoulette('x').size).toBe(0);
    expect(decodeRoulette([9999, 5, -1, 5, 1.5, 5, 0, -3, 0, 'a', 0, 1e12]).size).toBe(0);
    expect(decodeRoulette([0, 5, 1]).size).toBe(1);
  });

  it('settles a friend layout against the pocket', () => {
    const r = resolveRoulette(new Map([['straight:17', 5], ['red', 10], ['black', 10]]), 17);
    expect(r.find((x) => x.id === 'straight:17')).toMatchObject({ outcome: 'win', won: 175 });
    expect(r.find((x) => x.id === 'black')).toMatchObject({ outcome: 'win', won: 10 });
    expect(r.find((x) => x.id === 'red')).toMatchObject({ outcome: 'lose', won: 0 });
  });
});

describe('craps layout wire format', () => {
  it('round-trips and validates bet ids', () => {
    const bets = new Map([
      ['pass', 10],
      ['passOdds', 30],
      ['place6', 12],
      ['field', 5],
    ]);
    expect(decodeCraps(JSON.parse(JSON.stringify(encodeCraps(bets))))).toEqual(bets);
    expect(decodeCraps(['place7', 10, 'pass', -5, 'nonsense', 3, 'field', 5]).size).toBe(1);
  });

  it('settles a friend layout with the same dice and point', () => {
    const bets = new Map([
      ['pass', 10],
      ['come', 10],
      ['field', 5],
      ['place8', 12],
    ]);
    const { results, next } = resolveCraps(bets, [3, 3], 4);
    const by = (id: string) => results.find((x) => x.id === id)!;
    expect(by('come')).toMatchObject({ outcome: 'move', to: 'come6' });
    expect(by('field').outcome).toBe('lose');
    expect(next.get('pass')).toBe(10);
    expect(next.get('come6')).toBe(10);
    expect(next.get('place8')).toBe(12);
    const seven = resolveCraps(next, [3, 4], 4);
    expect(seven.results.every((x) => x.outcome === 'lose')).toBe(true);
    expect(seven.next.size).toBe(0);
  });
});

describe('slot spin wire format', () => {
  const machines = [DIAMOND_SEVENS, LAGO_FORTUNA, ROYAL_CONSERVATORY];
  it('accepts real stops and rejects bad ones', () => {
    const m = machines[1];
    const s = m.reels.map((r) => r.length - 1);
    expect(decodeSlotSpin({ i: 1, s, b: 2, x: 1 }, machines)).toEqual({ i: 1, s, b: 2, x: 1 });
    expect(decodeSlotSpin({ i: 3, s, b: 2 }, machines)).toBeNull();
    expect(decodeSlotSpin({ i: 1, s: s.slice(1), b: 2 }, machines)).toBeNull();
    expect(decodeSlotSpin({ i: 1, s: s.map((v) => v + 1), b: 2 }, machines)).toBeNull();
    expect(decodeSlotSpin({ i: 1, s, b: -2 }, machines)).toBeNull();
  });

  it('round-trips Porkbelly spins, paid and free', () => {
    const rng = new SeededRng(7);
    const g = new PiggyGame(null);
    let seenCoins = false,
      seenFree = false;
    for (let n = 0; n < 1500; n++) {
      const bonus = g.bonus ? { ...g.bonus } : null;
      const out = g.spin(rng);
      const msg = JSON.parse(JSON.stringify(encodePiggySpin(out, g.bonus ?? bonus)));
      expect(JSON.stringify(msg).length).toBeLessThan(500);
      const back = decodePiggySpin(msg)!;
      expect(back).not.toBeNull();
      expect(back.free).toBe(out.free);
      expect(back.stops).toEqual(out.stops);
      expect(back.strips.map((s, i) => s[back.stops[i]])).toEqual(out.grid.map((col) => col[1]));
      expect(back.coins).toEqual(out.coins);
      expect(back.jackpotCoins).toEqual(out.jackpotCoins);
      expect(back.jackpotWins).toEqual(out.jackpotWins);
      expect(back.pots).toEqual(out.bank.pots);
      if (!out.free) expect(back.mods).toEqual(out.triggered);
      else (seenFree = true), expect(back.games![1]).toBe(g.bonus!.totalSpins);
      if (out.coins.length) seenCoins = true;
      if (g.bonus?.done) g.closeBonus();
    }
    expect(seenCoins).toBe(true);
    expect(seenFree).toBe(true);
    expect(decodePiggySpin({ s: [0, 0, 0, 0], f: 0, b: 1 })).toBeNull();
    expect(decodePiggySpin({ s: PIGGY.reels.map((r) => r.length), f: 0, b: 1 })).toBeNull();
    expect(decodePiggySpin({ s: [0, 0, 0, 0, 0], f: 1, b: 1, m: [0] })).toBeNull();
  });
});
