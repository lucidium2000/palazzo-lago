import { describe, expect, it } from 'vitest';
import { LANDINGS, PANEL, PANEL_ROWS, canSend, panelDest, panelRowAt, panelRowH, panelRowY, canRide, destSlot, floorLabel, floorsBetween, inDoorway, insideCab, readSlot, readSnapshot, RideClock, TRAVEL_SECS, type CarRef } from '../src/client/areas/liftlogic';

// The real layout: four casino cars, two at the pool, one in the suite.
const CARS: CarRef[] = [
  ...[2.2, 4.75, 7.25, 9.8].map((z, i) => ({ landing: 'casino' as const, index: i, slot: i, x: 42, z })),
  ...[-7.6, -5].map((z, i) => ({ landing: 'pool' as const, index: i, slot: 4 + i, x: 48, z })),
  { landing: 'suite' as const, index: 0, slot: 6, x: 600, z: 3.4 },
];

describe('elevator routes', () => {
  it('every landing reaches every other landing, ending in the matching car', () => {
    for (const from of CARS)
      for (const dest of ['casino', 'pool', 'suite'] as const) {
        const to = CARS[destSlot(CARS, from, dest)];
        expect(to.landing).toBe(dest);
        if (dest === from.landing) expect(to.slot).toBe(from.slot);
      }
    expect(destSlot(CARS, CARS[0], 'pool')).toBe(4);
    expect(destSlot(CARS, CARS[3], 'pool')).toBe(5); // casino car 3 → the last pool car
    expect(destSlot(CARS, CARS[5], 'casino')).toBe(1);
    expect(destSlot(CARS, CARS[5], 'suite')).toBe(6);
    expect(destSlot(CARS, CARS[6], 'casino')).toBe(0);
  });

  it('the indicator counts floor by floor (at most nine numbers) up and down', () => {
    expect(floorsBetween(1, 2)).toEqual([1, 2]);
    expect(floorsBetween(2, 1)).toEqual([2, 1]);
    const up = floorsBetween(1, 32);
    expect(up[0]).toBe(1);
    expect(up.at(-1)).toBe(32);
    expect(up.length).toBe(9);
    for (let i = 1; i < up.length; i++) expect(up[i]).toBeGreaterThan(up[i - 1]);
    expect(floorsBetween(32, 2).at(-1)).toBe(2);
    expect(floorLabel(1)).toBe('C');
    expect(floorLabel(2)).toBe('M');
    expect(floorLabel(0)).toBe('L');
    expect(floorLabel(-1)).toBe('B');
    expect(floorLabel(32)).toBe('32');
  });
});

describe('who rides', () => {
  const car = CARS[0];
  it('in the cab rides; on the landing or in the next car does not', () => {
    expect(insideCab(car, { x: 43, z: 2.2 })).toBe(true);
    expect(insideCab(car, { x: 43.9, z: 2.9 })).toBe(true); // a back corner
    expect(insideCab(car, { x: 41.2, z: 2.2 })).toBe(false); // waiting on the landing
    expect(insideCab(car, { x: 42.05, z: 2.2 })).toBe(false); // on the door line
    expect(insideCab(car, { x: 43, z: 4.75 })).toBe(false); // the car next door
    expect(inDoorway(car, { x: 42.05, z: 2.2 })).toBe(true);
    expect(inDoorway(car, { x: 41, z: 2.2 })).toBe(false);
  });
});

describe('host arbitration', () => {
  it('first press wins: a busy car (leaving or arriving) takes no second ride', () => {
    const rides = [{ id: 1, car: 0, dest: 4 }]; // casino car 0 → pool car 0
    expect(canRide(rides, 0, 6)).toBe(false); // same car, other floor (a second press inside)
    expect(canRide(rides, 4, 6)).toBe(false); // the arriving car can't leave from the pool
    expect(canRide(rides, 6, 0)).toBe(false); // nor be the end of someone else's ride
    expect(canRide(rides, 6, 4)).toBe(false);
    expect(canRide(rides, 1, 5)).toBe(true); // the next car over is free
    expect(canRide([], 0, 0)).toBe(false);
    expect(canRide([], 0, 4)).toBe(true);
  });

  it('two presses resolved in arrival order give exactly one ride', () => {
    const rides: { id: number; car: number; dest: number }[] = [];
    const press = (car: number, dest: number) => {
      if (!canRide(rides, car, dest)) return false;
      rides.push({ id: rides.length + 1, car, dest });
      return true;
    };
    expect(press(0, destSlot(CARS, CARS[0], 'suite'))).toBe(true);
    expect(press(0, destSlot(CARS, CARS[0], 'pool'))).toBe(false);
    expect(rides).toHaveLength(1);
  });
});

describe('ride clock', () => {
  it("doesn't move until the doors are shut, then arrives once", () => {
    const c = new RideClock();
    for (let i = 0; i < 60; i++) expect(c.step(1 / 30, false)).toBe(false);
    expect(c.t).toBe(0);
    expect(c.moving).toBe(false);
    let arrivals = 0;
    let t = 0;
    while (t < TRAVEL_SECS + 1) {
      if (c.step(1 / 30, true)) arrivals++;
      t += 1 / 30;
    }
    expect(arrivals).toBe(1);
    expect(c.done).toBe(true);
    expect(c.step(1 / 30, true)).toBe(false);
  });

  it('the indicator passes through the floors in order and ends on the destination', () => {
    const floors = floorsBetween(1, 32);
    const c = new RideClock();
    const seen: number[] = [];
    while (!c.done) {
      c.step(1 / 60, true);
      const f = c.floor(floors);
      if (seen.at(-1) !== f) seen.push(f);
    }
    expect(seen).toEqual(floors);
  });

  it('two machines stepping at different frame rates arrive at the same travel time', () => {
    const a = new RideClock(),
      b = new RideClock();
    let ta = 0,
      tb = 0;
    while (!a.done) {
      a.step(1 / 72, true);
      ta += 1 / 72;
    }
    while (!b.done) {
      b.step(1 / 30, true);
      tb += 1 / 30;
    }
    expect(Math.abs(ta - tb)).toBeLessThan(1 / 30 + 1e-9);
  });
});

describe('late joiners', () => {
  it('reads a good snapshot and drops junk', () => {
    const s = readSnapshot({ cars: CARS.map((c, i) => [i === 2 ? 1 : 0, 'C']), rides: [[3, 0, 'suite', 1.2], [4, 99, 'pool', 0], [5, 1, 'moon', 0]] }, CARS.length);
    expect(s).not.toBeNull();
    expect(s!.cars[2]).toEqual([1, 'C']);
    expect(s!.rides).toEqual([[3, 0, 'suite', 1.2]]);
    expect(readSnapshot({ cars: [[0, 'C']], rides: [] }, CARS.length)).toBeNull();
    expect(readSnapshot(null, CARS.length)).toBeNull();
    expect(readSnapshot({ cars: CARS.map(() => [0, 'C']), rides: [[1, 0, 'pool', 1e9]] }, CARS.length)!.rides[0][3]).toBe(TRAVEL_SECS);
    expect(readSlot(3, 7)).toBe(3);
    expect(readSlot(7, 7)).toBeNull();
    expect(readSlot('1', 7)).toBeNull();
  });
});

describe('the floor panel in the cab', () => {
  it('has fingertip-sized buttons (4 cm+) with at least 1 cm between them', () => {
    expect(PANEL_ROWS).toEqual(['suite', 'promenade', 'casino', 'entrance', 'bowling', 'open']);
    expect(PANEL.button).toBeGreaterThanOrEqual(0.04);
    expect(panelRowH() - PANEL.button).toBeGreaterThanOrEqual(0.01);
    // The whole row is pressable bar the dead strip: the pressable band is at least the button.
    expect(panelRowH() - 2 * PANEL.dead).toBeGreaterThanOrEqual(PANEL.button);
    // Everything fits on the plate.
    expect(panelRowY(PANEL_ROWS.length - 1) + panelRowH() / 2 + PANEL.foot).toBeCloseTo(PANEL.h, 6);
    expect(PANEL.buttonX - PANEL.button / 2).toBeGreaterThan(0.01);
  });

  it('a poke anywhere on a button presses that row; between rows presses nothing', () => {
    PANEL_ROWS.forEach((row, i) => {
      const y = panelRowY(i);
      expect(panelRowAt(y)).toBe(row);
      expect(panelRowAt(y - PANEL.button / 2 + 0.001)).toBe(row);
      expect(panelRowAt(y + PANEL.button / 2 - 0.001)).toBe(row);
      if (i) expect(panelRowAt(y - panelRowH() / 2)).toBeNull();
    });
    expect(panelRowAt(0.02)).toBeNull(); // the name plate
    expect(panelRowAt(PANEL.h - 0.005)).toBeNull(); // the bottom margin
  });
});

describe('the panel\'s floors', () => {
  const ALL = ['casino', 'pool', 'promenade', 'suite', 'entrance', 'bowling'] as const;
  const rows = PANEL_ROWS.filter((r) => r !== 'open');

  it('names them Room, Promenade, Casino / Pool, Lobby, Bowling (one button for the casino floor)', () => {
    expect(rows.map((r) => LANDINGS[r].panel)).toEqual(['Room 3201', 'Promenade', 'Casino / Pool', 'Lobby', 'Bowling']);
    expect(LANDINGS.entrance.label).toBe('Lobby');
    expect(LANDINGS.entrance.short).toBe('L');
    expect(PANEL_ROWS).not.toContain('pool');
    // The casino lobby and the pool deck are one floor.
    expect(LANDINGS.pool.floor).toBe(LANDINGS.casino.floor);
    // Top to bottom, highest floor first.
    const floors = rows.map((r) => LANDINGS[r].floor);
    expect([...floors].sort((a, b) => b - a)).toEqual(floors);
  });

  it('Casino / Pool goes to the casino lobby bank, except in a pool-deck car (this floor: the doors open)', () => {
    for (const here of ALL) expect(panelDest(here, 'casino')).toBe(here === 'pool' ? 'pool' : 'casino');
    for (const here of ALL) for (const r of ['suite', 'promenade', 'entrance', 'bowling'] as const) expect(panelDest(here, r)).toBe(r);
  });

  it('every landing reaches every floor on the panel, and nothing sends a car to the pool bank', () => {
    for (const from of ALL)
      for (const r of rows) {
        const dest = panelDest(from, r);
        expect(canSend(from, dest)).toBe(dest !== from);
      }
    for (const from of ALL) expect(canSend(from, 'pool')).toBe(false);
    expect(canSend('pool', 'casino')).toBe(false); // the same floor: walk
    expect(canSend('casino', 'casino')).toBe(false);
    expect(canSend('pool', 'suite')).toBe(true);
    expect(canSend('bowling', 'entrance')).toBe(true);
  });

  it('every ride from every car on the real layout ends in a car at the floor pressed', () => {
    const cars: CarRef[] = [
      ...CARS,
      ...[-1.3, 1.3].map((z, i) => ({ landing: 'promenade' as const, index: i, slot: 7 + i, x: -600, z })),
      ...[-6.2, -3.6].map((z, i) => ({ landing: 'entrance' as const, index: i, slot: 9 + i, x: 307, z })),
      ...[-1.3, 1.3].map((z, i) => ({ landing: 'bowling' as const, index: i, slot: 11 + i, x: -300, z })),
    ];
    let rides = 0;
    for (const from of cars)
      for (const r of rows) {
        const dest = panelDest(from.landing, r);
        if (!canSend(from.landing, dest)) continue;
        expect(cars[destSlot(cars, from, dest)].landing).toBe(dest);
        rides++;
      }
    expect(rides).toBe(cars.length * 4); // five floor buttons in every car, one of them "here" (in a pool car, Casino / Pool)
  });
});
