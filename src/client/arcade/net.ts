import type { RawPad } from './types';

/**
 * What the arcade says to friends in the room (via `session.emit`/`on`), and
 * the compact encodings it uses. All messages are small: a cabinet's picture
 * goes as its game's snapshot (a few dozen numbers) 12-20 times a second, and
 * only while a friend is standing near it.
 *
 *  arcS  {c, m, a, n, i?}  a cabinet's screen: index, mode, snapshot, player name, initials being entered
 *  arcI  {c, s, p}         your hands on a cabinet a friend is running: which control set, the packed pad
 *  arcJ  {c, s, on}        you stepped up to (1) / away from (0) a friend's cabinet's controls
 *  arcX  {c, st}           the whole running game (machine.saveState), now and then while someone shares
 *                          the controls: whoever takes over carries on from it
 *  arcO  {c, to, st}       the owner walked away: the game, handed to a friend still at the controls
 *  arcH+ {g, n, s}         a score for the table (to the host)
 *  arcHT {g, t}            a game's table (from the host)
 *  arcF  {k, ...}          the floor games (hoops, hockey, claw, The Last Mile, ON THE RUN): see each game
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

/**
 * Everyone's hands on one set of controls, as one pad: the joystick and the
 * buttons belong to the machine, not to a player, so a button is down if
 * anyone holds it and the stick is everyone's pushes added up (clamped), like
 * two people crowding one real cabinet.
 */
export function mergePads(out: RawPad, pads: readonly (RawPad | null | undefined)[]): RawPad {
  let x = 0,
    y = 0,
    a = false,
    b = false,
    c = false;
  for (const p of pads) {
    if (!p) continue;
    x += p.x;
    y += p.y;
    a ||= p.a;
    b ||= p.b;
    c ||= p.c;
  }
  out.x = Math.max(-1, Math.min(1, x));
  out.y = Math.max(-1, Math.min(1, y));
  out.a = a;
  out.b = b;
  out.c = c;
  return out;
}

/** A friend's hands on a machine: which set, their pad, when last heard (seconds). */
interface Presser {
  set: number;
  pad: RawPad;
  at: number;
}

/**
 * Who is at one machine's controls and who runs it (pure: no three, no DOM).
 * The owner simulates the game and streams it; everyone else at the controls
 * sends their hands (arcI), which the owner merges in. When the owner walks
 * away the game is handed to someone still at the controls (`handTo`); when
 * the owner vanishes (left the room, closed the tab) the friend at the
 * controls with the lowest id takes over from the last full state it heard
 * (`shouldTakeOver`), so the game carries on instead of resetting. Generic:
 * any cabinet (or floor game) can use it.
 */
export class SharedControls {
  /** Friends' hands on this machine, by id. */
  readonly pressers = new Map<string, Presser>();
  /** Last time the owner (a friend) was heard, and the last whole game state they sent. */
  ownerHeard = -Infinity;
  lastState: unknown = null;
  /** How long a friend's hands count without a word from them (s). */
  static readonly STALE = 1.2;
  /** How long the owner can be silent before someone at the controls takes over (s). */
  static readonly SILENT = 2;

  constructor(private sets = 1) {}

  /** A friend's pad (arcI). */
  hear(id: string, set: number, packed: number, now: number) {
    let p = this.pressers.get(id);
    if (!p) this.pressers.set(id, (p = { set: 0, pad: { x: 0, y: 0, a: false, b: false, c: false }, at: now }));
    p.set = Math.max(0, Math.min(this.sets - 1, Math.floor(Number(set) || 0)));
    unpackPad(packed, p.pad);
    p.at = now;
  }

  /** A friend stepped away (arcJ off). */
  leave(id: string) {
    this.pressers.delete(id);
  }

  /** Forget friends gone quiet. */
  prune(now: number) {
    for (const [id, p] of this.pressers) if (now - p.at > SharedControls.STALE) this.pressers.delete(id);
  }

  /** Who's on a set now (ids). */
  at(set: number, now: number): string[] {
    const out: string[] = [];
    for (const [id, p] of this.pressers) if (p.set === set && now - p.at <= SharedControls.STALE) out.push(id);
    return out;
  }

  /** Anyone (but `except`) at the controls? */
  any(now: number, except = ''): boolean {
    for (const [id, p] of this.pressers) if (id !== except && now - p.at <= SharedControls.STALE) return true;
    return false;
  }

  /** One set's merged pad: my own hands (if I'm on it) plus every friend's on it (unless `friends` is false: not my game). */
  merged(out: RawPad, set: number, mine: RawPad | null, now: number, friends = true): RawPad {
    const list: RawPad[] = [];
    if (mine) list.push(mine);
    if (friends) for (const p of this.pressers.values()) if (p.set === set && now - p.at <= SharedControls.STALE) list.push(p.pad);
    return mergePads(out, list);
  }

  /** I'm the owner and walked away: the friend to hand the running game to (set 0 first, then the lowest id), or null. */
  handTo(now: number): string | null {
    let best: { id: string; set: number } | null = null;
    for (const [id, p] of this.pressers) {
      if (now - p.at > SharedControls.STALE) continue;
      if (!best || p.set < best.set || (p.set === best.set && id < best.id)) best = { id, set: p.set };
    }
    return best?.id ?? null;
  }

  /**
   * A friend owns it and I'm at its controls: should I take over? Only once
   * the owner has been silent a while, and only the lowest id among the
   * friends at the controls (so exactly one of us does), with a state to
   * carry on from.
   */
  shouldTakeOver(selfId: string, owner: string, now: number): boolean {
    if (!this.lastState || now - this.ownerHeard < SharedControls.SILENT) return false;
    for (const [id, p] of this.pressers) if (id !== owner && now - p.at <= SharedControls.STALE && id < selfId) return false;
    return true;
  }
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
