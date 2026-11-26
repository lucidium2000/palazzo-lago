/**
 * The Promenade's floor plan (pure numbers, no three.js, so tests can check
 * it): the mezzanine level reached by elevator, Bellagio-style, with a food
 * court, a boutique and an arcade off a grand marble concourse that ends at a
 * glass balcony over a garden atrium.
 *
 * Like the suite it lives far from the casino in the world (out of the
 * camera's range, west at x ≈ -618), reached only by elevator.
 *
 *            z = -14  ┌───────────── kitchens / counters (north wall) ─────────────┐
 *                     │  [Gelato]   [Noodles]    [Burgers]    [Pizza]            │
 *     atrium          │   o   o   o   o   o   o      food court tables         ║ cars
 *     (void,  ░░ rail │   o   o   o   o   o   o                                ║ (east
 *      garden ░░      │ ════════════════ concourse (z −4.5…4.5) ═════════════════║ wall,
 *      below) ░░      │ ┌──── Lago Arcade ─────┐ ┌──── Lago Luxe boutique ─────┐ ║ x=−600)
 *                     │ │ cabinets, hoops,     │ │ shelves, tables, counter    │ │
 *            z = 14   └─┴──────────────────────┴─┴─────────────────────────────┴─┘
 *                   x = −636                 −617 −616.6                     −600
 */

/** The whole level (inside the walls). */
export const PROM = { x0: -636, x1: -600, z0: -14, z1: 14, h: 6.4 };
/** The elevator bank in the east wall (doors on the wall, cabs extending east). */
export const PROM_CARS = { doorX: -600, zs: [-1.3, 1.3] };
/** The open concourse down the middle (food court to the north is open to it). */
export const CONCOURSE = { z0: -4.5, z1: 4.5 };
/** The atrium beyond the west balcony: a garden courtyard far below. */
export const ATRIUM = { x0: -652, x1: -636, z0: -10, z1: 10, floorY: -7.5, rail: { z0: -4.5, z1: 4.5 } };
/** Shop and arcade fronts: the wall along the concourse's south side. */
export const FRONT_Z = 4.5;
/** Ceiling height inside the shops (the concourse soars above them). */
export const SHOP_H = 3.6;

export const STORE = { x0: -616.6, x1: -600, z0: FRONT_Z, z1: 14, door: { x0: -610, x1: -607 } };
export const ARCADE = { x0: -636, x1: -617, z0: FRONT_Z, z1: 14, door: { x0: -624, x1: -621.5 } };

/** Food counters along the north wall: counter top's centre line, height, and depth. */
export const COUNTER = { z: -11.5, depth: 0.7, top: 1.05, width: 4.6 };
/** Where the walk stops in front of the counters (the kitchens behind are staff only). */
export const COUNTER_FRONT = COUNTER.z + COUNTER.depth / 2;

export type FoodKey = 'pizza' | 'burger' | 'noodles' | 'gelato';
export type MerchKey = 'sunglasses' | 'hat' | 'plush' | 'diceset';

export interface FoodItemSpec {
  key: FoodKey;
  name: string;
  price: number;
  /** Bites to finish it. */
  bites: number;
  /** Seconds the cook takes. */
  prep: number;
}

export interface CounterSpec {
  id: string;
  /** Original brands only. */
  brand: string;
  tagline: string;
  x: number;
  /** Sign colours: background, accent. */
  colors: [string, string];
  items: FoodItemSpec[];
}

export const FOOD: Record<FoodKey, FoodItemSpec> = {
  pizza: { key: 'pizza', name: 'Slice of pepperoni', price: 7, bites: 5, prep: 3.5 },
  burger: { key: 'burger', name: 'Lago double cheeseburger', price: 12, bites: 6, prep: 5 },
  noodles: { key: 'noodles', name: 'Garlic chili noodles', price: 11, bites: 6, prep: 4.5 },
  gelato: { key: 'gelato', name: 'Pistachio gelato cone', price: 6, bites: 4, prep: 2.5 },
};

export const COUNTERS: CounterSpec[] = [
  { id: 'pizza', brand: 'Forno Lago', tagline: 'New York slices · wood oven', x: -606.5, colors: ['#5a1a12', '#f2c14e'], items: [FOOD.pizza, { ...FOOD.pizza, name: 'Slice of margherita', price: 6 }] },
  { id: 'burger', brand: 'High Roller Burgers', tagline: 'Smash burgers · shakes', x: -613, colors: ['#1a1a1a', '#e8402a'], items: [FOOD.burger, { ...FOOD.burger, name: 'Single smash burger', price: 9, bites: 5 }] },
  { id: 'noodles', brand: 'Golden Dragon Noodle Bar', tagline: 'Hand-pulled · wok fired', x: -619.5, colors: ['#7a0c10', '#f6d27a'], items: [FOOD.noodles, { ...FOOD.noodles, name: 'Sesame beef noodles', price: 13 }] },
  { id: 'gelato', brand: 'Dolce Vita Gelateria', tagline: 'Gelato · sorbetto · espresso', x: -626, colors: ['#f4e8d8', '#4a8a6a'], items: [FOOD.gelato, { ...FOOD.gelato, name: 'Stracciatella gelato cone', price: 6 }] },
];

/** Where a counter puts your order down (front edge of its top, toward you). */
export function servePoint(c: CounterSpec, slot = 0): { x: number; z: number; y: number } {
  return { x: c.x - 0.9 + (slot % 4) * 0.6, z: COUNTER.z + 0.17, y: COUNTER.top };
}

/** The boutique's stock: what's on the shelves, what it costs, and whether you can wear it. */
export const MERCH: Record<MerchKey, { name: string; price: number; wear: 'eyes' | 'head' | null }> = {
  sunglasses: { name: 'Lago Luxe sunglasses', price: 60, wear: 'eyes' },
  hat: { name: 'Palazzo fedora', price: 45, wear: 'head' },
  plush: { name: 'Lucky the plush lion', price: 25, wear: null },
  diceset: { name: 'souvenir dice set', price: 15, wear: null },
};

/** Store fixtures (world coordinates; boxes are centre + size, tops for things to sit on). */
export const STORE_FIX = {
  counter: { x: -608.5, z: 12.4, w: 2.6, d: 0.65, top: 1.0 },
  register: { x: -607.7, z: 12.35 },
  clerk: { x: -608.5, z: 13.3, yaw: Math.PI },
  tables: [
    { x: -612.2, z: 8.6, w: 1.6, d: 0.9, top: 0.82 },
    { x: -604.6, z: 8.6, w: 1.6, d: 0.9, top: 0.82 },
  ],
  /** Wall shelving: [x, z, w (along the wall), d, yaw] with shelf heights. */
  shelves: [
    { x: -616.35, z: 9.3, w: 3.2, d: 0.42, yaw: Math.PI / 2 },
    { x: -600.25, z: 9.3, w: 3.2, d: 0.42, yaw: -Math.PI / 2 },
  ],
  shelfYs: [0.55, 1.05, 1.55],
  mannequins: [
    { x: -614.2, z: 5.6, yaw: 0 },
    { x: -602.6, z: 5.6, yaw: 0 },
  ],
};

/** Where each piece of stock starts (deterministic, so ids match on every machine). */
export function storeStock(): { key: MerchKey; x: number; z: number; y: number; yaw: number; color: number }[] {
  const out: { key: MerchKey; x: number; z: number; y: number; yaw: number; color: number }[] = [];
  const [t1, t2] = STORE_FIX.tables;
  // Sunglasses fanned out on the first table, facing the door.
  [0x141414, 0xc9a050, 0x6a3a1a, 0xf2f2f2].forEach((c, i) => out.push({ key: 'sunglasses', x: t1.x - 0.55 + i * 0.36, z: t1.z - 0.15, y: t1.top, yaw: Math.PI, color: c }));
  [0x7a5a3a, 0x1a1a2a].forEach((c, i) => out.push({ key: 'sunglasses', x: t1.x - 0.35 + i * 0.5, z: t1.z + 0.22, y: t1.top, yaw: Math.PI, color: c }));
  // Hats on the second table.
  [0x1a1a1a, 0xe8dcc0, 0x6a1428].forEach((c, i) => out.push({ key: 'hat', x: t2.x - 0.5 + i * 0.5, z: t2.z, y: t2.top, yaw: 0, color: c }));
  // Plush lions and dice sets on the wall shelves.
  const [west, east] = STORE_FIX.shelves;
  [0xd8a040, 0xe8c070, 0xc07830].forEach((c, i) => out.push({ key: 'plush', x: east.x - 0.12, z: east.z - 1.0 + i * 1.0, y: STORE_FIX.shelfYs[1], yaw: -Math.PI / 2, color: c }));
  [0x6a0e18, 0x0e2a5a, 0x0e4a2a].forEach((c, i) => out.push({ key: 'diceset', x: west.x + 0.12, z: west.z - 1.0 + i * 1.0, y: STORE_FIX.shelfYs[1], yaw: Math.PI / 2, color: c }));
  [0x6a0e18, 0x1a1a1a].forEach((c, i) => out.push({ key: 'diceset', x: STORE_FIX.counter.x - 1.0 + i * 0.25, z: STORE_FIX.counter.z - 0.15, y: STORE_FIX.counter.top, yaw: 0, color: c }));
  return out;
}

/** Food court tables (round) and the stools round each. */
export const TABLE_R = 0.45;
export const TABLE_TOP = 0.76;
export const STOOL_R = 0.72;
export const STOOL_Y = 0.66;
export const TABLES: [number, number][] = [];
for (const z of [-9.0, -6.4]) for (const x of [-607.5, -612, -616.5, -621, -625.5, -630]) TABLES.push([x, z]);
/** Stool angles round a table (radians, 0 = +x). */
export const STOOL_ANGLES = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];

/** Planters with palms (concourse edges and the food court's west end). */
export const PLANTERS: [number, number][] = [
  [-604.5, -3.9],
  [-614.5, -3.9],
  [-624.5, -3.9],
  [-634.6, -3.9],
  [-604.5, 3.9],
  [-618.8, 3.9],
  [-634.6, 3.9],
  [-634.4, -12.4],
  [-634.4, -9.0],
];

/** An arcade bay: a place for a game, and the collider that goes with it. */
export interface ArcadeSlotSpec {
  id: string;
  /** 'feature': a wider bay for a featured game. */
  kind: 'cabinet' | 'floor' | 'feature';
  /** Centre of the footprint, on the floor. */
  x: number;
  z: number;
  /** The way the game's front faces (Object3D.rotation.y: local +z turns to (sin yaw, cos yaw)). */
  yaw: number;
  /** [width across the front, depth front to back], metres. */
  footprint: [number, number];
  /** What it's meant for (the arcade module decides). */
  hint: string;
}

const CAB: [number, number] = [0.8, 0.85];
export const ARCADE_SLOT_SPECS: ArcadeSlotSpec[] = [
  // Upright cabinets: three along the back wall, three along the west wall.
  { id: 'cab1', kind: 'cabinet', x: -634.6, z: 13.5, yaw: Math.PI, footprint: CAB, hint: 'upright' },
  { id: 'cab2', kind: 'cabinet', x: -633.5, z: 13.5, yaw: Math.PI, footprint: CAB, hint: 'upright' },
  { id: 'cab3', kind: 'cabinet', x: -632.4, z: 13.5, yaw: Math.PI, footprint: CAB, hint: 'upright' },
  { id: 'cab4', kind: 'cabinet', x: -635.5, z: 9.6, yaw: Math.PI / 2, footprint: CAB, hint: 'upright' },
  { id: 'cab5', kind: 'cabinet', x: -635.5, z: 8.5, yaw: Math.PI / 2, footprint: CAB, hint: 'upright' },
  { id: 'cab6', kind: 'cabinet', x: -635.5, z: 7.4, yaw: Math.PI / 2, footprint: CAB, hint: 'upright' },
  // Bigger games on the floor.
  { id: 'hoops', kind: 'floor', x: -628.2, z: 12.55, yaw: Math.PI, footprint: [1.3, 2.8], hint: 'basketball' },
  { id: 'airhockey', kind: 'floor', x: -628.6, z: 7.4, yaw: Math.PI / 2, footprint: [1.3, 2.3], hint: 'air hockey' },
  { id: 'claw', kind: 'floor', x: -618.1, z: 12.8, yaw: -Math.PI / 2, footprint: [1.1, 1.1], hint: 'claw machine' },
  // The featured game: a wide 16:9 cabinet against the east wall, facing into the room (The Last Mile).
  { id: 'feature', kind: 'feature', x: -617.5, z: 9.0, yaw: -Math.PI / 2, footprint: [1.45, 0.95], hint: 'featured wide cabinet' },
];

/** The change machine by the arcade door. */
export const CHANGE_MACHINE = { x: -619.6, z: 5.0, yaw: 0, w: 0.7, d: 0.5 };

/** Walking-graph nodes on the Promenade (they join up with each other only: it's a floor of its own). */
export const PROMENADE_NODES: [number, number][] = [
  // The concourse, both sides, from the elevators to the balcony.
  [-603.5, -2.6],
  [-603.5, 2.6],
  [-609, -2.6],
  [-609, 2.6],
  [-614.5, -2.4],
  [-614.5, 2.4],
  [-620, -2.6],
  [-620, 2.6],
  [-626, -2.6],
  [-626, 2.6],
  [-632, -2.4],
  [-632, 2.4],
  [-634.8, 0],
  // The food court: the aisle between the table rows, and along the counters.
  [-609.75, -7.7],
  [-614.25, -7.7],
  [-618.75, -7.7],
  [-623.25, -7.7],
  [-627.75, -7.7],
  [-632.3, -7.7],
  [-606.5, -10.4],
  [-613, -10.4],
  [-619.5, -10.4],
  [-626, -10.4],
  [-604.8, -7.7],
  [-605, -5.0],
  // Into the boutique and the arcade.
  [-608.5, 5.8],
  [-608.5, 10.6],
  [-603.2, 10.8],
  [-622.75, 3.3],
  [-622.75, 5.8],
  [-622.75, 10.2],
];

export type PromSurface = { kind: 'box'; x: number; z: number; w: number; d: number; y: number; yaw: number } | { kind: 'disc'; x: number; z: number; r: number; y: number };

/** Tops things can be set down on (counters, tables, shelves): loose.ts lands food and stock on them. */
export function PROMENADE_SURFACES(): PromSurface[] {
  const out: PromSurface[] = [];
  for (const c of COUNTERS) out.push({ kind: 'box', x: c.x, z: COUNTER.z, w: COUNTER.width, d: COUNTER.depth, y: COUNTER.top, yaw: 0 });
  for (const [x, z] of TABLES) out.push({ kind: 'disc', x, z, r: TABLE_R, y: TABLE_TOP });
  for (const t of STORE_FIX.tables) out.push({ kind: 'box', x: t.x, z: t.z, w: t.w, d: t.d, y: t.top, yaw: 0 });
  const c = STORE_FIX.counter;
  out.push({ kind: 'box', x: c.x, z: c.z, w: c.w, d: c.d, y: c.top, yaw: 0 });
  for (const s of STORE_FIX.shelves) for (const y of STORE_FIX.shelfYs) out.push({ kind: 'box', x: s.x, z: s.z, w: s.w, d: s.d, y, yaw: s.yaw });
  return out;
}

/** Is (x, z) on the Promenade level? (It's the only thing out west.) */
export const onPromenade = (x: number) => x < -500;
/** In the arcade room (dim, neon)? */
export const inArcade = (x: number, z: number) => x > ARCADE.x0 && x < ARCADE.x1 && z > ARCADE.z0 && z < ARCADE.z1;
/** In the boutique? */
export const inStore = (x: number, z: number) => x > STORE.x0 && x < STORE.x1 && z > STORE.z0 && z < STORE.z1;

/** How many guests and staff the Promenade adds to the crowd (on top of the floor's). */
export function promenadeShare(people: number) {
  return people >= 60 ? 22 : people >= 45 ? 18 : 14;
}
