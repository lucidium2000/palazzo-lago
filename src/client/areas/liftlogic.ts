/**
 * The pure parts of the elevators (no three.js, no DOM), so they're unit
 * tested: the landings, which car a ride ends in, the floors the indicator
 * counts through, who may start a ride (the host arbitrates, so two presses
 * never conflict), the ride's clock, who is in a cab, and the snapshot a
 * friend who walks in late gets.
 */

export type LandingId = 'casino' | 'pool' | 'promenade' | 'suite' | 'entrance' | 'bowling';

/**
 * Every landing: its name (toasts, the call-plate tooltip), the short mark on
 * the indicators and the panel's buttons, its floor, and the name on the
 * panel. The casino lobby and the pool deck are the same floor of the hotel
 * (the deck is out through the lobby's glass doors), so they share one
 * button, "Casino / Pool"; the pool deck's own cars are still there, and in
 * them that button just opens the doors.
 */
export const LANDINGS: Record<LandingId, { label: string; short: string; floor: number; panel: string }> = {
  /** (First: the indicator shows a floor's first one-letter mark, so floor 1 counts as "C".) */
  casino: { label: 'Casino / Pool', short: 'C', floor: 1, panel: 'Casino / Pool' },
  /** The pool deck's own bank, on the casino floor: no button of its own. */
  pool: { label: 'Pool Deck', short: 'P', floor: 1, panel: 'Casino / Pool' },
  /** The mezzanine promenade: food court, the boutique and the arcade. */
  promenade: { label: 'Promenade', short: 'M', floor: 2, panel: 'Promenade' },
  /** Your room: Suite 3201, high in the tower. */
  suite: { label: 'Room 3201', short: '32', floor: 32, panel: 'Room 3201' },
  /** The ground floor: the hotel lobby and the front entrance outside (taxis, rideshare, valet). */
  entrance: { label: 'Lobby', short: 'L', floor: 0, panel: 'Lobby' },
  /** The lower level: Palazzo Lanes, the bowling lounge. */
  bowling: { label: 'Palazzo Lanes', short: 'B', floor: -1, panel: 'Bowling' },
};

export const isLanding = (v: unknown): v is LandingId => v === 'casino' || v === 'pool' || v === 'promenade' || v === 'suite' || v === 'entrance' || v === 'bowling';

/** Cab interior, from the door line (x) eastwards; half its width (z). */
export const DEPTH = 2.2;
export const HALF = 0.95;

/**
 * The floor panel inside the cab (metres): a brass plate on the side wall,
 * centred at shoulder height. Six rows, top to bottom like a real panel (the
 * room, the Promenade, Casino / Pool, the lobby, the lanes below, then the
 * doors), each a round button with its name beside it. Sized for a
 * fingertip: 7 cm buttons, 3.5 cm apart, and a 1 cm strip between rows that
 * presses nothing (a poke that lands between two rows picks neither, never
 * the wrong one).
 */
export const PANEL_ROWS = ['suite', 'promenade', 'casino', 'entrance', 'bowling', 'open'] as const;
export type PanelRow = (typeof PANEL_ROWS)[number];
export const PANEL = {
  w: 0.3,
  h: 0.725,
  /** Centre height above the cab floor. */
  y: 1.3,
  /** The name plate at the top, and the margin at the bottom. */
  header: 0.075,
  foot: 0.02,
  /** Button diameter, its centre from the plate's left edge. */
  button: 0.07,
  buttonX: 0.055,
  /** Unpressable strip at each edge of a row (so 2x between rows). */
  dead: 0.005,
} as const;

/** Height of one row (m). */
export const panelRowH = () => (PANEL.h - PANEL.header - PANEL.foot) / PANEL_ROWS.length;

/** Centre of row `i`, from the plate's top edge (m). */
export const panelRowY = (i: number) => PANEL.header + (i + 0.5) * panelRowH();

/** The row under a point `fromTop` metres below the plate's top edge, or null (header, margins, between rows). */
export function panelRowAt(fromTop: number): PanelRow | null {
  const y = fromTop - PANEL.header;
  const h = panelRowH();
  if (y < 0) return null;
  const i = Math.floor(y / h);
  if (i >= PANEL_ROWS.length) return null;
  const inRow = y - i * h;
  if (inRow < PANEL.dead || inRow > h - PANEL.dead) return null;
  return PANEL_ROWS[i];
}

/**
 * Where a floor button takes a car standing at `here`. "Casino / Pool" in a
 * pool-deck car is this floor (it opens the doors); from anywhere else it's
 * the casino lobby's bank, the hotel's main landing.
 */
export function panelDest(here: LandingId, row: Exclude<PanelRow, 'open'>): LandingId {
  if (row === 'casino' && here === 'pool') return 'pool';
  return row;
}

/** Can a car at `from` be sent to `dest`? Only to a floor on its panel (never its own, never the pool bank: it's the casino floor). */
export function canSend(from: LandingId, dest: LandingId): boolean {
  if (dest === from) return false;
  return PANEL_ROWS.some((r) => r !== 'open' && panelDest(from, r) === dest);
}

/** Seconds for the doors to go fully open or shut. */
export const DOOR_SECS = 1.1;
/** Seconds sealed in, moving between landings. */
export const TRAVEL_SECS = 2.6;
/** A called car shows up after this long. */
export const CALL_SECS = 1.4;
/** Doors stay open this long after the last press (unless someone is in the way). */
export const HOLD_SECS = 9;
/** After arriving, the doors open this long later (a beat, then the chime). */
export const ARRIVE_OPEN_SECS = 0.25;

export interface CarRef {
  landing: LandingId;
  /** Which car at its landing (0 = first). */
  index: number;
  /** Position in the shared list of every car (the same on every machine). */
  slot: number;
  x: number;
  z: number;
}

/** The identical car at the destination landing (the one a ride ends in). */
export function destSlot(cars: readonly CarRef[], from: CarRef, dest: LandingId): number {
  const at = cars.filter((c) => c.landing === dest);
  return at[Math.min(from.index, at.length - 1)].slot;
}

/** The floors the indicator counts through, start and end included (at most 9 numbers). */
export function floorsBetween(from: number, to: number): number[] {
  const steps = Math.max(1, Math.min(8, Math.abs(to - from)));
  return Array.from({ length: steps + 1 }, (_, i) => Math.round(from + ((to - from) * i) / steps));
}

/** What the indicator shows for a floor: a landing's letter (B, L, C, M), else the number. */
export function floorLabel(n: number): string {
  for (const l of Object.values(LANDINGS)) if (l.floor === n && l.short.length === 1) return l.short;
  return String(n);
}

/** Feet inside a car's cab (past the door line)? */
export function insideCab(car: { x: number; z: number }, p: { x: number; z: number }): boolean {
  return p.x > car.x + 0.15 && p.x < car.x + DEPTH && Math.abs(p.z - car.z) < HALF;
}

/** In the doorway (where closing doors would catch you)? */
export function inDoorway(car: { x: number; z: number }, p: { x: number; z: number }): boolean {
  return Math.abs(p.x - car.x) < 0.4 && Math.abs(p.z - car.z) < 0.7;
}

/** A ride under way: from one car (`car`) to its twin at the destination (`dest`). */
export interface RideRef {
  id: number;
  car: number;
  dest: number;
}

/**
 * May a ride start from `car` to `dest`? Not if either car is already part
 * of a ride (leaving or arriving). The host asks this, so of two presses the
 * first wins and the second simply rides along (or waits).
 */
export function canRide(rides: readonly RideRef[], car: number, dest: number): boolean {
  if (car === dest) return false;
  return !rides.some((r) => r.car === car || r.dest === car || r.car === dest || r.dest === dest);
}

/** The ride's clock: doors shut, then the trip; nothing moves while the doors are open. */
export class RideClock {
  /** Seconds of travel so far (counts only once the doors are shut). */
  t = 0;
  done = false;

  constructor(readonly travel = TRAVEL_SECS) {}

  /** Advance; `sealed` = the doors are fully shut. Returns true the moment it arrives. */
  step(dt: number, sealed: boolean): boolean {
    if (this.done) return false;
    if (!sealed) return false;
    this.t += dt;
    if (this.t >= this.travel) {
      this.done = true;
      return true;
    }
    return false;
  }

  /** 0..1 through the trip. */
  get k() {
    return Math.min(1, this.t / this.travel);
  }

  get moving() {
    return this.t > 0 && !this.done;
  }

  /** Which of `floors` the indicator shows now. */
  floor(floors: readonly number[]): number {
    return floors[Math.min(floors.length - 1, Math.floor(this.k * floors.length))];
  }
}

/** What a friend who walks in late needs: every car's doors and indicator, and rides under way. */
export interface LiftSnapshot {
  /** Per car slot: [doors wanted open (0/1), indicator text]. */
  cars: [number, string][];
  /** Rides under way: [id, from slot, to landing, seconds travelled]. */
  rides: [number, number, LandingId, number][];
}

/** Checks a snapshot from the wire (anything malformed is dropped). */
export function readSnapshot(d: unknown, nCars: number): LiftSnapshot | null {
  if (!d || typeof d !== 'object') return null;
  const s = d as { cars?: unknown; rides?: unknown };
  if (!Array.isArray(s.cars) || s.cars.length !== nCars || !Array.isArray(s.rides)) return null;
  const cars: [number, string][] = [];
  for (const c of s.cars) {
    if (!Array.isArray(c)) return null;
    cars.push([c[0] ? 1 : 0, String(c[1] ?? '').slice(0, 3)]);
  }
  const rides: LiftSnapshot['rides'] = [];
  for (const r of s.rides.slice(0, nCars)) {
    if (!Array.isArray(r)) continue;
    const [id, car, dest, t] = r;
    if (!Number.isInteger(id) || !Number.isInteger(car) || car < 0 || car >= nCars || !isLanding(dest)) continue;
    rides.push([id, car, dest, Math.max(0, Math.min(TRAVEL_SECS, Number(t) || 0))]);
  }
  return { cars, rides };
}

/** A car slot from the wire, or null. */
export function readSlot(v: unknown, nCars: number): number | null {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) < nCars ? (v as number) : null;
}
