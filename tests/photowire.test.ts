import { describe, expect, it } from 'vitest';
import { backfillFor, boardOrder, CHUNK, chunkEvents, MAX_B64, parseChunk, Reassembler, SendQueue, splitChunks, type PhotoMeta } from '../src/client/net/photowire';
import { Outbox, PACKET_BUDGET } from '../src/client/net/party';

const meta = (id: string, t = 1, a = 'A'): PhotoMeta => ({ id, a, n: 'Ann', c: 0x2fd8ff, t });
const b64 = (n: number) => {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let s = '';
  for (let i = 0; i < n; i++) s += abc[(i * 7 + (i >> 3)) % 64];
  return s;
};

describe('photo chunks', () => {
  it('splits into fixed-size chunks that join back exactly', () => {
    const s = b64(CHUNK * 3 + 17);
    const parts = splitChunks(s);
    expect(parts).toHaveLength(4);
    expect(parts.slice(0, 3).every((p) => p.length === CHUNK)).toBe(true);
    expect(parts[3]).toHaveLength(17);
    expect(parts.join('')).toBe(s);
    expect(splitChunks('')).toEqual([]);
  });

  it('numbers every chunk and repeats the photo details on each', () => {
    const ev = chunkEvents(meta('p1'), b64(5000), 2000);
    expect(ev.map((e) => [e.i, e.k])).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
    ]);
    expect(ev.every((e) => e.id === 'p1' && e.n === 'Ann' && e.c === 0x2fd8ff)).toBe(true);
  });

  it('a chunk with a VR player state fits in one packet', () => {
    const state = {
      name: 'Somebody Long',
      host: false,
      look: 3,
      x: -10.123,
      z: 4.567,
      y: 0,
      yaw: 1.234,
      pitch: -0.12,
      moving: 0,
      seat: null,
      chips: 1000,
      hh: 1.62,
      lh: [1.11, 1.22, 1.33],
      rh: [1.11, 1.22, 1.33],
      lg: 0.5,
      rg: 0.5,
      lf: '12345',
      rf: '12345',
      lw: [-10.123, 1.234, 4.567, 0.12, 0.34, 0.56, 0.78],
      rw: [-10.123, 1.234, 4.567, 0.12, 0.34, 0.56, 0.78],
      pc: [0, 1, 0.012, 0.034, -0.056, 0.123, 0.456, 0.789, 0.321, 1],
      a: { abcdefghij: 123, klmnopqrst: 456, uvwxyzabcd: 789 },
    };
    const o = new Outbox();
    const ev = chunkEvents({ id: 'abcde-12', a: 'palazzo-guest-0123456789abcdef', n: 'Somebody Long Name', c: 0xffc94a, t: Date.now() }, b64(MAX_B64));
    for (const e of ev.slice(0, 2)) o.push('ph', e, 0);
    const w = o.packet(state as never);
    expect(w.e.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(w).length).toBeLessThanOrEqual(PACKET_BUDGET);
    expect(JSON.stringify(w).length).toBeLessThan(4096);
  });

  it('rejects malformed chunks', () => {
    const good = chunkEvents(meta('p1'), b64(100))[0];
    expect(parseChunk(good)).toEqual(good);
    expect(parseChunk(null)).toBeNull();
    expect(parseChunk({ ...good, i: 1 })).toBeNull();
    expect(parseChunk({ ...good, k: 0 })).toBeNull();
    expect(parseChunk({ ...good, d: 'not base64!' })).toBeNull();
    expect(parseChunk({ ...good, id: '' })).toBeNull();
    expect(parseChunk({ ...good, n: 'x'.repeat(50) })!.n).toHaveLength(20);
  });
});

describe('Reassembler', () => {
  const photo = b64(CHUNK * 4 + 300);
  const ev = chunkEvents(meta('p1'), photo);

  it('reassembles in any order, once, ignoring duplicates', () => {
    const r = new Reassembler();
    const order = [3, 1, 1, 4, 0, 3];
    for (const i of order) expect(r.add(ev[i], 'A', 0)).toBeNull();
    expect(r.missing('p1')).toEqual([2]);
    const done = r.add(ev[2], 'A', 0);
    expect(done?.b64).toBe(photo);
    expect(done?.meta).toEqual(meta('p1'));
    // Already have it: late repeats do nothing.
    for (const e of ev) expect(r.add(e, 'A', 1)).toBeNull();
    expect(r.has('p1')).toBe(true);
    expect(r.inProgress).toBe(0);
  });

  it('keeps several photos apart', () => {
    const r = new Reassembler();
    const other = b64(2500).split('').reverse().join('');
    const ev2 = chunkEvents(meta('p2', 2, 'B'), other);
    const out: string[] = [];
    for (let i = 0; i < Math.max(ev.length, ev2.length); i++)
      for (const e of [ev[i], ev2[i]]) {
        if (!e) continue;
        const d = e === ev[i] ? r.add(e, 'A', 0) : r.add(e, 'B', 0);
        if (d) out.push(d.meta.id + ':' + (d.b64 === (d.meta.id === 'p1' ? photo : other)));
      }
    expect(out.sort()).toEqual(['p1:true', 'p2:true']);
  });

  it('never re-adds your own photo', () => {
    const r = new Reassembler();
    r.markDone('p1');
    for (const e of ev) expect(r.add(e, 'A', 0)).toBeNull();
  });

  it('asks the sender for missing chunks after a stall, then gives up', () => {
    const r = new Reassembler(4, 2);
    r.add(ev[0], 'A', 0);
    r.add(ev[2], 'A', 1);
    expect(r.stalled(3, () => true)).toEqual([]);
    expect(r.stalled(5.5, () => true)).toEqual([{ to: 'A', id: 'p1', m: [1, 3, 4] }]);
    expect(r.stalled(6, () => true)).toEqual([]);
    expect(r.stalled(10, () => true)).toHaveLength(1);
    expect(r.stalled(20, () => true)).toEqual([]);
    expect(r.inProgress).toBe(0);
  });

  it('forgets transfers whose sender left', () => {
    const r = new Reassembler();
    r.add(ev[0], 'A', 0);
    expect(r.stalled(10, () => false)).toEqual([]);
    expect(r.inProgress).toBe(0);
  });

  it('round-trips a resent transfer after a gap', () => {
    const r = new Reassembler(4);
    r.add(ev[0], 'A', 0);
    r.add(ev[1], 'A', 0);
    const ask = r.stalled(5, () => true)[0];
    let done = null;
    for (const i of ask.m) done = r.add(ev[i], 'A', 6) ?? done;
    expect(done?.b64).toBe(photo);
  });
});

describe('SendQueue', () => {
  it('sends in order without repeats', () => {
    const q = new SendQueue();
    q.add('p1', [0, 1, 2]);
    q.add('p1', [1, 2, 3]);
    q.add('p2', [0]);
    const out: string[] = [];
    for (let n = q.next(); n; n = q.next()) out.push(`${n.id}#${n.i}`);
    expect(out).toEqual(['p1#0', 'p1#1', 'p1#2', 'p1#3', 'p2#0']);
    q.add('p1', [0]);
    expect(q.length).toBe(1);
  });
});

describe('backfill and board order', () => {
  const photos = [meta('a1', 10, 'A'), meta('b1', 20, 'B'), meta('gone', 15, 'C'), meta('n1', 5, 'N'), meta('a0', 1, 'A')];

  it('each player sends their own; the host also sends the departed and the newcomer’s old ones', () => {
    const present = new Set(['A', 'B']);
    expect(backfillFor(photos, { me: 'A', host: true, present, newcomer: 'N', limit: 9 })).toEqual(['gone', 'a1', 'n1', 'a0']);
    expect(backfillFor(photos, { me: 'B', host: false, present, newcomer: 'N', limit: 9 })).toEqual(['b1']);
    expect(backfillFor(photos, { me: 'A', host: true, present, newcomer: 'N', limit: 2 })).toEqual(['gone']);
  });

  it('newest first, ties by id', () => {
    expect(boardOrder([meta('b', 1), meta('a', 1), meta('c', 3)]).map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });
});
