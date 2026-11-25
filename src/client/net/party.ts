import type { NetEvent, PlayerState, Wire } from './transport';

/**
 * The pure parts of a night out with the crew (up to four players): the
 * event outbox that makes sure every friend hears every moment, player
 * colour slots handed out by the host, keeping avatars distinct, where your
 * friends are relative to you, a free spot to land beside one, and the
 * night's scoreboard. No three.js or DOM here, so it's all unit-tested.
 */

/** Host + three friends. */
export const MAX_PLAYERS = 4;

/** One colour per slot (host gold, then teal, pink, lime): name tags, chips, the scoreboard, the watch. */
export const PLAYER_COLORS = [0xffc94a, 0x2fd8ff, 0xff6ad5, 0xa6ff4a] as const;

export const cssColor = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export type AreaId = 'casino' | 'pool' | 'hotel' | 'suite';

/** Biggest wire packet (the claude.ai room carries at most 4 KiB per player). */
export const PACKET_BUDGET = 3600;

// ---------------------------------------------------------------------------
// Events: an outbox that keeps each moment until every active friend has it
// ---------------------------------------------------------------------------

interface Pending extends NetEvent {
  /** When it was sent (seconds, the session's clock). */
  t: number;
}

/**
 * Every packet repeats the events your friends haven't confirmed yet (each
 * friend acks the highest sequence number it has handled from you, inside
 * its own state). Transports that coalesce updates (the claude.ai room keeps
 * only each player's latest presence) can drop packets, but never an event:
 * it rides along until everyone active has it. When there's more than fits
 * in a packet, the oldest go first and the rest wait their turn, so friends
 * always see them in order.
 */
export class Outbox {
  private seq = 0;
  private list: Pending[] = [];

  constructor(
    private budget = PACKET_BUDGET,
    /** Hard caps so a friend who stopped answering can't grow it forever. */
    private maxKeep = 64,
    private maxAge = 6,
  ) {}

  get pending(): readonly NetEvent[] {
    return this.list;
  }

  get lastSeq() {
    return this.seq;
  }

  push(k: string, d: unknown, now: number): NetEvent {
    const e: Pending = { n: ++this.seq, k, d, t: now };
    this.list.push(e);
    return e;
  }

  /**
   * Forget what everyone has. `acks` holds, for each friend still talking to
   * us, the last event number they've handled from us (undefined: they
   * haven't said yet, e.g. they just arrived and ignore older events anyway).
   */
  prune(acks: readonly (number | undefined)[], now: number) {
    const known = acks.filter((a): a is number => typeof a === 'number' && Number.isFinite(a));
    if (!acks.length) {
      // Nobody here: keep a few for whoever walks in next.
      while (this.list.length > 6) this.list.shift();
    } else if (known.length) {
      const min = Math.min(...known);
      while (this.list.length && this.list[0].n <= min) this.list.shift();
    }
    while (this.list.length && (now - this.list[0].t > this.maxAge || this.list.length > this.maxKeep)) this.list.shift();
  }

  /** The packet to publish: my state and as many waiting events (oldest first) as fit. */
  packet(s: PlayerState): Wire {
    const w: Wire = { s, e: [] };
    let size = JSON.stringify(w).length;
    for (const p of this.list) {
      const e: NetEvent = p.d === undefined ? { n: p.n, k: p.k } : { n: p.n, k: p.k, d: p.d };
      const add = JSON.stringify(e).length + 1;
      if (w.e.length && size + add > this.budget) break;
      w.e.push(e);
      size += add;
    }
    return w;
  }
}

/** The events in a packet you haven't handled yet (in order), and the new high-water mark. */
export function freshEvents(last: number, events: readonly NetEvent[]): { fresh: NetEvent[]; last: number } {
  const fresh = events.filter((e) => Number.isFinite(e?.n) && e.n > last).sort((a, b) => a.n - b.n);
  return { fresh, last: fresh.length ? fresh[fresh.length - 1].n : last };
}

// ---------------------------------------------------------------------------
// Colour slots (the host hands them out) and distinct avatars
// ---------------------------------------------------------------------------

/**
 * The host's slot table for its guests: everyone keeps their slot while they
 * stay, newcomers get the lowest free one (1-3; the host is always 0), and
 * whoever left frees theirs.
 */
export function assignSlots(current: Readonly<Record<string, number>>, guests: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const used = new Set<number>();
  for (const id of guests) {
    const s = current[id];
    if (Number.isInteger(s) && s >= 1 && s < MAX_PLAYERS && !used.has(s)) {
      out[id] = s;
      used.add(s);
    }
  }
  for (const id of guests) {
    if (id in out) continue;
    for (let s = 1; s < MAX_PLAYERS; s++) {
      if (!used.has(s)) {
        out[id] = s;
        used.add(s);
        break;
      }
    }
  }
  return out;
}

/**
 * Two players in the same outfit: the one who joined later (higher slot)
 * changes into the next free one. Returns the avatar you should wear.
 */
export function resolveAvatar(mine: number, mySlot: number, others: readonly { slot: number; look: number }[], count: number): number {
  if (!others.some((o) => o.look === mine && o.slot < mySlot)) return mine;
  const taken = new Set(others.map((o) => o.look));
  for (let i = 1; i <= count; i++) {
    const c = (mine + i) % count;
    if (!taken.has(c)) return c;
  }
  return mine;
}

// ---------------------------------------------------------------------------
// Finding each other
// ---------------------------------------------------------------------------

/** Heading convention: atan2(dx, dz) of the way you face (0 = +z). */
export function headingOf(dx: number, dz: number) {
  return Math.atan2(dx, dz);
}

export function wrapAngle(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Where a point is relative to the way you face, in radians: 0 straight
 * ahead, positive to your right (clockwise seen from above, like a watch
 * hand), negative to your left, ±π behind you.
 */
export function relativeBearing(fromHeading: number, dx: number, dz: number) {
  return wrapAngle(fromHeading - headingOf(dx, dz));
}

export interface FriendDirection {
  id: string;
  name: string;
  /** Their player colour (0xRRGGBB). */
  color: number;
  /** Metres, on the floor plan. */
  distance: number;
  /** Radians relative to your facing: 0 ahead, + right (clockwise), − left. */
  bearing: number;
  area: AreaId;
  /** Talking right now (voice or typed chat). */
  talking: boolean;
}

/** What the game knows of the floor, for picking a landing spot. */
export interface Ground {
  /** A body of radius r can stand here (walls and furniture). */
  free(x: number, z: number, r: number): boolean;
  /** Inside the walls at all (ignores furniture): used to stay in the same room as them. */
  inside(x: number, z: number): boolean;
  /** Pool water here (land on the deck instead). */
  water?(x: number, z: number): boolean;
  /** Inside an elevator cab (doors can shut you in a car on its own schedule). */
  cab?(x: number, z: number): boolean;
}

/**
 * A free spot beside a friend for "go to friend": in front of them first (so
 * you see their face), then round them, a little further out each ring;
 * never in the water, in a lift car, on another player, or through a wall
 * from them. Returns where to stand and the heading that faces them.
 */
export function landingSpot(
  target: { x: number; z: number; heading: number },
  g: Ground,
  others: readonly { x: number; z: number }[] = [],
  r = 0.3,
): { x: number; z: number; heading: number } | null {
  const clearLine = (x: number, z: number) => {
    const d = Math.hypot(target.x - x, target.z - z);
    const n = Math.max(2, Math.ceil(d / 0.2));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (!g.inside(x + (target.x - x) * t, z + (target.z - z) * t)) return false;
    }
    return true;
  };
  const ok = (x: number, z: number) =>
    g.free(x, z, r) && !g.water?.(x, z) && !g.cab?.(x, z) && others.every((o) => Math.hypot(o.x - x, o.z - z) > 0.65) && clearLine(x, z);
  const offsets = [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.4, -2.4, Math.PI];
  for (const rad of [1.1, 1.5, 2.0, 2.6]) {
    for (const o of offsets) {
      const h = target.heading + o;
      const x = target.x + Math.sin(h) * rad,
        z = target.z + Math.cos(h) * rad;
      if (ok(x, z)) return { x, z, heading: headingOf(target.x - x, target.z - z) };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The night's scoreboard
// ---------------------------------------------------------------------------

export interface ScoreRow {
  id: string;
  name: string;
  color: number;
  /** Chips won (+) or lost (−) tonight. */
  net: number;
  chips: number;
  me: boolean;
}

/** Biggest winner on top; ties keep the order they came in. */
export function rankScores(rows: readonly ScoreRow[]): ScoreRow[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.net - a.r.net || a.i - b.i)
    .map((x) => x.r);
}

/** "+$1,250" / "−$40" / "even". */
export function signedMoney(v: number) {
  const n = Math.round(v);
  if (n === 0) return 'even';
  return `${n > 0 ? '+' : '−'}$${Math.abs(n).toLocaleString('en-US')}`;
}
