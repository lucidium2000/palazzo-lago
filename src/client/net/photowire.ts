/**
 * The pure parts of sharing photos with the room (no three.js or DOM, so
 * it's unit-tested): a photo travels as a small base64 JPEG cut into chunks
 * that each fit in one network packet (the event outbox rides along with
 * each player's ~3.6 KB state packet, see party.ts), and is put back
 * together on the other side whatever order (or how many times) the chunks
 * arrive in. Every chunk carries the photo's details, so any chunk can
 * start a transfer, and a receiver missing some asks for just those.
 */

/** Base64 characters per chunk: with the photo's details and a VR player's state, one packet. */
export const CHUNK = 2000;
/** Biggest photo we'll send or accept (base64 characters, ~45 KB of JPEG). */
export const MAX_B64 = 60000;
export const MAX_CHUNKS = Math.ceil(MAX_B64 / CHUNK);

/** Who took a photo and when: the same on everyone's board. */
export interface PhotoMeta {
  /** Unique per photo (the author's id + a counter). */
  id: string;
  /** The author's network id. */
  a: string;
  /** Their name and colour (0xRRGGBB) when they took it. */
  n: string;
  c: number;
  /** When it was taken (ms since 1970, the author's clock). */
  t: number;
}

/** One `ph` event on the wire. */
export interface PhotoChunk extends PhotoMeta {
  /** How many chunks in all, and which this is. */
  k: number;
  i: number;
  /** The base64 slice. */
  d: string;
}

export function splitChunks(b64: string, size = CHUNK): string[] {
  if (!b64) return [];
  const out: string[] = [];
  for (let i = 0; i < b64.length; i += size) out.push(b64.slice(i, i + size));
  return out;
}

export function chunkEvents(meta: PhotoMeta, b64: string, size = CHUNK): PhotoChunk[] {
  const parts = splitChunks(b64, size);
  return parts.map((d, i) => ({ ...meta, k: parts.length, i, d }));
}

const B64 = /^[A-Za-z0-9+/=]*$/;

/** A chunk off the wire, checked (anything malformed is null). */
export function parseChunk(x: unknown): PhotoChunk | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const k = Number(o.k),
    i = Number(o.i),
    t = Number(o.t),
    c = Number(o.c);
  if (typeof o.id !== 'string' || !o.id || o.id.length > 80) return null;
  if (!Number.isInteger(k) || k < 1 || k > MAX_CHUNKS || !Number.isInteger(i) || i < 0 || i >= k) return null;
  if (typeof o.d !== 'string' || !o.d.length || o.d.length > CHUNK * 2 || !B64.test(o.d)) return null;
  return {
    id: o.id,
    a: typeof o.a === 'string' ? o.a.slice(0, 80) : '',
    n: String(o.n ?? 'Friend').slice(0, 20),
    c: Number.isFinite(c) ? Math.max(0, Math.min(0xffffff, Math.floor(c))) : 0xffffff,
    t: Number.isFinite(t) ? t : Date.now(),
    k,
    i,
    d: o.d,
  };
}

interface Partial {
  meta: PhotoMeta;
  parts: (string | undefined)[];
  got: number;
  /** Who's been sending it (asked again for what's missing). */
  from: string;
  /** Last time a new chunk arrived / we asked (seconds, caller's clock). */
  touched: number;
  asks: number;
}

/**
 * Puts photos back together. `add` returns the whole photo once its last
 * missing chunk arrives (exactly once per photo id); chunks of photos already
 * complete, duplicates and malformed ones are ignored.
 */
export class Reassembler {
  private partial = new Map<string, Partial>();
  private done = new Set<string>();

  constructor(
    /** Seconds without progress before asking for what's missing. */
    private stall = 4,
    /** Asks before giving up on a photo. */
    private maxAsks = 6,
  ) {}

  /** A photo we already have (yours, or one that came in whole). */
  markDone(id: string) {
    this.done.add(id);
    this.partial.delete(id);
  }

  has(id: string) {
    return this.done.has(id);
  }

  get inProgress() {
    return this.partial.size;
  }

  add(c: PhotoChunk, from: string, now: number): { meta: PhotoMeta; b64: string } | null {
    if (this.done.has(c.id)) return null;
    let p = this.partial.get(c.id);
    if (!p || p.parts.length !== c.k) {
      p = { meta: { id: c.id, a: c.a, n: c.n, c: c.c, t: c.t }, parts: new Array(c.k), got: 0, from, touched: now, asks: 0 };
      this.partial.set(c.id, p);
    }
    if (p.parts[c.i] !== undefined) return null;
    p.parts[c.i] = c.d;
    p.got++;
    p.from = from;
    p.touched = now;
    if (p.got < p.parts.length) return null;
    this.partial.delete(c.id);
    this.done.add(c.id);
    return { meta: p.meta, b64: p.parts.join('') };
  }

  /** Chunk numbers still missing for a photo (empty if unknown or complete). */
  missing(id: string): number[] {
    const p = this.partial.get(id);
    if (!p) return [];
    const m: number[] = [];
    for (let i = 0; i < p.parts.length; i++) if (p.parts[i] === undefined) m.push(i);
    return m;
  }

  /**
   * Transfers that stalled: ask their sender again for what's missing. Gives
   * up (forgets the transfer) after `maxAsks`, or when its sender has left.
   */
  stalled(now: number, present: (id: string) => boolean): { to: string; id: string; m: number[] }[] {
    const out: { to: string; id: string; m: number[] }[] = [];
    for (const [id, p] of this.partial) {
      if (!present(p.from) || p.asks >= this.maxAsks) {
        this.partial.delete(id);
        continue;
      }
      if (now - p.touched < this.stall) continue;
      p.touched = now;
      p.asks++;
      out.push({ to: p.from, id, m: this.missing(id).slice(0, 40) });
    }
    return out;
  }
}

/**
 * Chunks waiting to go out, in order, without repeats (a re-ask for chunks
 * already queued doesn't queue them twice). The caller sends a few at a time
 * as friends confirm the previous ones.
 */
export class SendQueue {
  private q: { id: string; i: number }[] = [];
  private keys = new Set<string>();

  get length() {
    return this.q.length;
  }

  add(id: string, chunks: Iterable<number>) {
    for (const i of chunks) {
      const key = `${id}#${i}`;
      if (this.keys.has(key)) continue;
      this.keys.add(key);
      this.q.push({ id, i });
    }
  }

  next(): { id: string; i: number } | null {
    const x = this.q.shift() ?? null;
    if (x) this.keys.delete(`${x.id}#${x.i}`);
    return x;
  }

  clear() {
    this.q = [];
    this.keys.clear();
  }
}

/**
 * Which photos you should send a friend who just walked in: the newest
 * `limit` (what fits on the board) that you took yourself, plus, if you're
 * the host, those whose photographer isn't here to send them.
 */
export function backfillFor(
  photos: readonly PhotoMeta[],
  opts: { me: string; host: boolean; present: ReadonlySet<string>; newcomer: string; limit: number },
): string[] {
  return [...photos]
    .sort((a, b) => b.t - a.t)
    .slice(0, opts.limit)
    .filter((p) => p.a === opts.me || (opts.host && (p.a === opts.newcomer || !opts.present.has(p.a))))
    .map((p) => p.id);
}

/** Newest first; ties broken by id so every board agrees. */
export function boardOrder<T extends { t: number; id: string }>(photos: readonly T[]): T[] {
  return [...photos].sort((a, b) => b.t - a.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
