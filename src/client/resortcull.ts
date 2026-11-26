import type * as THREE from 'three';
import { HALL, POKER_DOOR } from './casino';
import { Culler, type CullCell, type CullPortal } from './cull';
import { CORR, LOBBY, POOL_DOOR } from './areas/hotel';
import { DEPTH } from './areas/liftlogic';
import { DECK } from './areas/pool';
import { ROOM } from './pokerroom';

/** A lift car as the culler needs it: its door line, and how open its doors are. */
export interface CullCar {
  landing: string;
  x: number;
  z: number;
  open: number;
}

/** The lift doors' opening (see elevators.ts: two 0.78 m leaves, 2.4 m high). */
const CAB_DOOR = { half: 0.8, h: 2.45 };

/**
 * The main resort's cells and doorways (see cull.ts): outdoors (the terrace, the lake), the casino
 * floor (open to outdoors through its lake windows and French doors), the poker room off its west
 * wall, the hotel corridor and lobby off its east wall, the pool deck through the lobby's pool doors,
 * and every lift cab of the casino lobby and pool deck (seen into only while its doors are open).
 */
export function resortCells(cars: readonly CullCar[]): { cells: CullCell[]; portals: CullPortal[] } {
  const W = HALL.w / 2,
    D = HALL.d / 2;
  const cells: CullCell[] = [
    // The terrace, the lake and the sky (everywhere not in a box below).
    { name: 'outdoors' },
    { name: 'casino', box: [-W, W, -D, D, 9.5] },
    { name: 'poker', box: [ROOM.x0 - 0.3, ROOM.x1, ROOM.z0 - 0.3, ROOM.z1 + 0.3, ROOM.h + 0.6] },
    { name: 'corridor', box: [CORR.x0, CORR.x1, CORR.z0 - 0.3, CORR.z1 + 0.3, CORR.h + 0.6] },
    { name: 'lobby', box: [LOBBY.x0, LOBBY.x1, LOBBY.z0 - 0.3, LOBBY.z1 + 0.3, LOBBY.h + 0.6] },
    // The pool deck (and the party's lights over it); as zone culling has it, out of sight of the casino.
    { name: 'deck', box: [DECK.x0 - 1, DECK.x1 + 10, DECK.z0 - 6, LOBBY.z0 - 0.3, 80] },
    // The suite and the Promenade, hundreds of metres away (their lift landings are in the lifts' group).
    { name: 'suite', box: [500, 800, -200, 200, 200] },
    { name: 'promenade', box: [-800, -500, -200, 200, 200] },
  ];
  const [OUT, CASINO, POKER, CORRIDOR, LOBBY_, DECK_] = [0, 1, 2, 3, 4, 5];
  const portals: CullPortal[] = [
    // The lake windows and French doors: wide open to the outdoors (no narrowing). Open joins don't
    // chain (see cull.ts): the deck is open to the lake and sky, but not on through the casino's windows.
    { a: CASINO, b: OUT },
    { a: DECK_, b: OUT },
    { a: CASINO, b: POKER, axis: 'x', at: -W, from: POKER_DOOR.z0, to: POKER_DOOR.z1, y0: 0, y1: POKER_DOOR.h },
    { a: CASINO, b: CORRIDOR, axis: 'x', at: W, from: CORR.z0, to: CORR.z1, y0: 0, y1: CORR.h },
    { a: CORRIDOR, b: LOBBY_, axis: 'x', at: CORR.x1, from: CORR.z0, to: CORR.z1, y0: 0, y1: CORR.h },
    { a: LOBBY_, b: DECK_, axis: 'z', at: LOBBY.z0, from: POOL_DOOR.x0, to: POOL_DOOR.x1, y0: 0, y1: POOL_DOOR.h },
  ];
  for (const car of cars) {
    // Only the lifts here in the main resort (the suite's and the Promenade's are hundreds of metres away).
    if (car.landing !== 'casino' && car.landing !== 'pool') continue;
    const i = cells.length;
    cells.push({ name: `cab-${car.landing}-${car.z}`, box: [car.x, car.x + DEPTH + 0.3, car.z - 1.05, car.z + 1.05, 3.2] });
    const outside = car.landing === 'casino' ? LOBBY_ : DECK_;
    portals.push({ a: outside, b: i, axis: 'x', at: car.x, from: car.z - CAB_DOOR.half, to: car.z + CAB_DOOR.half, y0: 0, y1: CAB_DOOR.h, open: () => car.open > 0.01 });
  }
  return { cells, portals };
}

export function resortCuller(cars: readonly CullCar[], roots: () => THREE.Object3D[], skip: (o: THREE.Object3D) => boolean): Culler {
  const { cells, portals } = resortCells(cars);
  return new Culler(cells, portals, roots, skip);
}
