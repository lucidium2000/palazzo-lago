import { afterEach, describe, expect, it } from 'vitest';
import {
  assignSlots,
  freshEvents,
  landingSpot,
  MAX_PLAYERS,
  Outbox,
  PACKET_BUDGET,
  rankScores,
  relativeBearing,
  resolveAvatar,
  signedMoney,
  type Ground,
} from '../src/client/net/party';
import { localTransport, ROOM_FULL, type PlayerState, type Transport, type Wire } from '../src/client/net/transport';
import { callerOf } from '../src/client/net/voice';
import { SeededRng } from '../src/rules/rng';

const baseState = (name: string, extra: Partial<PlayerState> = {}): PlayerState => ({ name, host: false, look: 0, x: 0, z: 0, yaw: 0, pitch: 0, moving: 0, seat: null, chips: 1000, ...extra });

/**
 * A room of peers running the session's event protocol: each publishes its
 * state (with acks) and its outbox's packet; the "network" is lossy the way
 * the claude.ai room is (only each player's latest presence survives, and
 * receivers sample it at random moments).
 */
class Peer {
  out = new Outbox();
  last = new Map<string, number>();
  heard = new Map<string, number>();
  got = new Map<string, { n: number; k: string; d: unknown }[]>();
  theirAcks = new Map<string, number | undefined>();
  constructor(readonly id: string) {}
  packet(now: number): Wire {
    const live = [...this.heard.entries()].filter(([, t]) => now - t < 1.5).map(([id]) => this.theirAcks.get(id));
    this.out.prune(live, now);
    const a: Record<string, number> = {};
    for (const [id, n] of this.last) a[id] = n;
    return this.out.packet(baseState(this.id, { a }));
  }
  receive(from: string, w: Wire, now: number) {
    if (!this.last.has(from)) this.last.set(from, 0);
    this.heard.set(from, now);
    this.theirAcks.set(from, w.s.a?.[this.id]);
    const { fresh, last } = freshEvents(this.last.get(from)!, w.e);
    this.last.set(from, last);
    const list = this.got.get(from) ?? [];
    for (const e of fresh) list.push({ n: e.n, k: e.k, d: e.d });
    this.got.set(from, list);
  }
}

describe('four-player event delivery', () => {
  it('every player gets every event from every other, in order, over a coalescing room', () => {
    const rng = new SeededRng(7);
    const peers = ['host', 'b', 'c', 'd'].map((id) => new Peer(id));
    const presence = new Map<string, Wire>();
    const sent = new Map<string, number>(peers.map((p) => [p.id, 0]));
    let now = 0;
    // Everyone meets first (an empty hello), as the session does on arrival.
    for (const p of peers) presence.set(p.id, p.packet(now));
    for (const p of peers) for (const q of peers) if (p !== q) p.receive(q.id, presence.get(q.id)!, now);
    for (let step = 0; step < 600; step++) {
      now += 0.05;
      for (const p of peers) {
        // Bursts: chat, table calls, and fat voice-handshake chunks addressed to each friend.
        if (step < 400 && rng.next() < 0.35) {
          const big = rng.next() < 0.2;
          p.out.push(big ? 'vsig' : 'say', big ? { to: 'x', s: 'v'.repeat(900) } : { t: `hi ${step}` }, now);
          sent.set(p.id, sent.get(p.id)! + 1);
        }
        if (rng.next() < 0.7) presence.set(p.id, p.packet(now));
      }
      // Receivers sample the latest presence at random moments (packets in between are lost).
      for (const p of peers) for (const q of peers) if (p !== q && rng.next() < 0.5) p.receive(q.id, presence.get(q.id)!, now);
    }
    for (const p of peers) {
      for (const q of peers) {
        if (p === q) continue;
        const got = p.got.get(q.id) ?? [];
        expect(got.length, `${p.id} from ${q.id}`).toBe(sent.get(q.id));
        expect(got.map((e) => e.n)).toEqual(got.map((_, i) => i + 1));
      }
    }
  });

  it('keeps packets under the room limit and sends the oldest first', () => {
    const o = new Outbox();
    for (let i = 0; i < 10; i++) o.push('vsig', { s: 'x'.repeat(900) }, 0);
    const w = o.packet(baseState('a'));
    expect(JSON.stringify(w).length).toBeLessThanOrEqual(PACKET_BUDGET);
    expect(w.e[0].n).toBe(1);
    expect(w.e.length).toBeGreaterThan(1);
    expect(w.e.length).toBeLessThan(10);
  });

  it('drops events everyone active has acked, and caps a stalled friend', () => {
    const o = new Outbox(PACKET_BUDGET, 64, 6);
    for (let i = 0; i < 5; i++) o.push('say', { t: i }, 0);
    o.prune([3, 5], 0);
    expect(o.pending.map((e) => e.n)).toEqual([4, 5]);
    o.prune([undefined], 0);
    expect(o.pending.length).toBe(2);
    o.prune([3], 7);
    expect(o.pending.length).toBe(0);
  });

  it('ignores repeats and sorts what is new', () => {
    const r = freshEvents(2, [
      { n: 4, k: 'b' },
      { n: 2, k: 'x' },
      { n: 3, k: 'a' },
    ]);
    expect(r.fresh.map((e) => e.k)).toEqual(['a', 'b']);
    expect(r.last).toBe(4);
    expect(freshEvents(9, [{ n: 4, k: 'b' }]).last).toBe(9);
  });
});

describe('colour slots and outfits', () => {
  it('hands out the lowest free slot and keeps them while players stay', () => {
    let s = assignSlots({}, ['b', 'c']);
    expect(s).toEqual({ b: 1, c: 2 });
    s = assignSlots(s, ['c', 'd']);
    expect(s).toEqual({ c: 2, d: 1 });
    s = assignSlots(s, ['c', 'd', 'e', 'f']);
    expect(Object.values(s).sort()).toEqual([1, 2, 3]);
    expect(Object.keys(s).length).toBe(MAX_PLAYERS - 1);
  });

  it('the later arrival changes outfit when two match', () => {
    expect(resolveAvatar(2, 1, [{ slot: 0, look: 2 }], 6)).toBe(3);
    expect(resolveAvatar(2, 0, [{ slot: 1, look: 2 }], 6)).toBe(2);
    expect(resolveAvatar(5, 3, [{ slot: 0, look: 5 }, { slot: 1, look: 0 }, { slot: 2, look: 1 }], 6)).toBe(2);
  });

  it('exactly one of each pair places the voice call', () => {
    const ids = ['k3', 'a9', 'zz', 'b0'];
    for (const a of ids) for (const b of ids) if (a !== b) expect(callerOf(a, b)).not.toBe(callerOf(b, a));
  });
});

describe('finding each other', () => {
  it('bearing: ahead 0, right positive, left negative, behind ±π', () => {
    // Facing +z (heading 0).
    expect(relativeBearing(0, 0, 5)).toBeCloseTo(0);
    expect(relativeBearing(0, -5, 0)).toBeCloseTo(Math.PI / 2); // −x is on your right facing +z
    expect(relativeBearing(0, 5, 0)).toBeCloseTo(-Math.PI / 2);
    expect(Math.abs(relativeBearing(0, 0, -5))).toBeCloseTo(Math.PI);
    // Facing +x (heading π/2): +z is on your right, −z on your left.
    expect(relativeBearing(Math.PI / 2, 0, 5)).toBeCloseTo(Math.PI / 2);
    expect(relativeBearing(Math.PI / 2, 0, -5)).toBeCloseTo(-Math.PI / 2);
  });

  const room = (extra: Partial<Ground> = {}): Ground => ({
    // A 10×10 room with a wall at x = 0 (the other side is another room).
    inside: (x, z) => Math.abs(z) < 5 && x > -5 && x < 5 && Math.abs(x) > 0.05,
    free: (x, z, r) => Math.abs(z) < 5 - r && x > -5 + r && x < 5 - r && Math.abs(x) > r,
    ...extra,
  });

  it('lands in front of them, facing them', () => {
    const s = landingSpot({ x: 2, z: 0, heading: 0 }, room())!;
    expect(s.x).toBeCloseTo(2);
    expect(s.z).toBeCloseTo(1.1);
    expect(relativeBearing(s.heading, 2 - s.x, 0 - s.z)).toBeCloseTo(0);
  });

  it('never through a wall, into water, a lift car or onto another player', () => {
    // Friend right by the wall facing it: the spot ahead is through the wall.
    const s = landingSpot({ x: 0.6, z: 0, heading: -Math.PI / 2 }, room())!;
    expect(s.x).toBeGreaterThan(0);
    const wet = landingSpot({ x: 2, z: 0, heading: 0 }, room({ water: (_x, z) => z > 0.5 }))!;
    expect(wet.z).toBeLessThanOrEqual(0.5);
    // Swimming mid-pool (water everywhere within 4 m): the nearest deck.
    const pool = (x: number, z: number) => Math.hypot(x - 2, z) < 4;
    const deck = landingSpot({ x: 2, z: 0, heading: 0 }, room({ water: pool, inside: (x, z) => Math.abs(z) < 5 && x > -5 && x < 9, free: (x, z, r) => Math.abs(z) < 5 - r && x > -5 + r && x < 9 - r }))!;
    expect(pool(deck.x, deck.z)).toBe(false);
    // All water: beside them in it.
    const swim = landingSpot({ x: 2, z: 0, heading: 0 }, room({ water: () => true }))!;
    expect(Math.hypot(swim.x - 2, swim.z)).toBeLessThan(2.1);
    const cab = landingSpot({ x: 2, z: 0, heading: 0 }, room({ cab: (x) => x > 1.5 && x < 2.5 }))!;
    expect(cab.x < 1.5 || cab.x > 2.5).toBe(true);
    const crowded = landingSpot({ x: 2, z: 0, heading: 0 }, room(), [{ x: 2, z: 1.1 }])!;
    expect(Math.hypot(crowded.x - 2, crowded.z - 1.1)).toBeGreaterThan(0.65);
    expect(landingSpot({ x: 2, z: 0, heading: 0 }, { inside: () => false, free: () => false })).toBeNull();
  });
});

describe('scoreboard', () => {
  it('ranks by tonight, biggest winner first', () => {
    const rows = rankScores([
      { id: 'a', name: 'A', color: 0, net: -40, chips: 0, me: true },
      { id: 'b', name: 'B', color: 0, net: 1250, chips: 0, me: false },
      { id: 'c', name: 'C', color: 0, net: 0, chips: 0, me: false },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(signedMoney(1250)).toBe('+$1,250');
    expect(signedMoney(-40)).toBe('−$40');
    expect(signedMoney(0.2)).toBe('even');
  });
});

describe('local transport door (same-browser tabs)', () => {
  const open: Transport[] = [];
  afterEach(() => {
    for (const t of open.splice(0)) t.leave();
  });

  it('lets in host + three, turns the fifth away, and everyone hears everyone', async () => {
    const code = 'T' + Math.random().toString(36).slice(2, 5).toUpperCase();
    await expect(localTransport(code, false, 60)).rejects.toThrow('No game');
    const host = await localTransport(code, true, 60);
    open.push(host);
    for (let i = 0; i < 3; i++) open.push(await localTransport(code, false, 60));
    await expect(localTransport(code, false, 60)).rejects.toThrow(ROOM_FULL);
    const heard = open.map(() => new Set<string>());
    open.forEach((t, i) => t.onRemote((id, w) => w && heard[i].add(w.s.name)));
    open.forEach((t, i) => t.publish({ s: baseState(`p${i}`), e: [] }));
    await new Promise((r) => setTimeout(r, 60));
    heard.forEach((h, i) => expect([...h].sort()).toEqual(['p0', 'p1', 'p2', 'p3'].filter((n) => n !== `p${i}`)));
    expect(new Set(open.map((t) => t.self)).size).toBe(4);
  });
});
