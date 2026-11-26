import type { RawPad } from './types';

/**
 * What the arcade says to friends in the room (via `session.emit`/`on`), and
 * the compact encodings it uses. All messages are small: a cabinet's picture
 * goes as its game's snapshot (a few dozen numbers) 12-20 times a second, and
 * only while a friend is standing near it.
 *
 *  arcS  {c, m, a, n, i?}  a cabinet's screen: index, mode, snapshot, player name, initials being entered
 *  arcI  {c, p}            your controls on the second-player set of a two-player cabinet
 *  arcJ  {c, on}           you took (1) / left (0) a cabinet's second-player controls
 *  arcH+ {g, n, s}         a score for the table (to the host)
 *  arcHT {g, t}            a game's table (from the host)
 *  arcF  {k, ...}          the floor games (hoops, hockey, claw, The Last Mile): see each game
 */

export interface ArcadeFriend {
  id: string;
  name: string;
  state: { x: number; z: number };
}

/** The part of the room's Session the arcade uses. */
export interface ArcadeSession {
  readonly host: boolean;
  readonly selfId: string;
  emit(k: string, data?: unknown): void;
  on(kind: string, fn: (friend: ArcadeFriend, d: Record<string, unknown>) => void): void;
  friendList(): ArcadeFriend[];
  /** How many of my events of a kind friends haven't confirmed yet (to pace bulky ones). */
  unconfirmed?(k: string): number;
}

/** A pad in one number: stick quantised to 1/7 steps (x, y in 4 bits each) and three button bits. */
export function packPad(p: RawPad): number {
  const q = (v: number) => Math.max(0, Math.min(14, Math.round(Math.max(-1, Math.min(1, v)) * 7) + 7));
  return q(p.x) | (q(p.y) << 4) | ((p.a ? 1 : 0) << 8) | ((p.b ? 1 : 0) << 9) | ((p.c ? 1 : 0) << 10);
}

export function unpackPad(n: number, out: RawPad): RawPad {
  n = Number(n) | 0;
  out.x = ((n & 15) - 7) / 7;
  out.y = (((n >> 4) & 15) - 7) / 7;
  out.a = !!(n & 256);
  out.b = !!(n & 512);
  out.c = !!(n & 1024);
  return out;
}

/** Rounds a snapshot's numbers for the wire (they're already integers; this guards against NaN). */
export function cleanSnap(a: unknown, max = 600): number[] | null {
  if (!Array.isArray(a) || a.length > max) return null;
  const out = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) {
    const v = Number(a[i]);
    out[i] = Number.isFinite(v) ? v : 0;
  }
  return out;
}

/** Is a friend near enough a spot to see it (metres)? */
export function friendNear(f: ArcadeFriend, x: number, z: number, r: number): boolean {
  const s = f.state;
  const dx = Number(s?.x) - x,
    dz = Number(s?.z) - z;
  return Number.isFinite(dx) && Number.isFinite(dz) && dx * dx + dz * dz < r * r;
}
