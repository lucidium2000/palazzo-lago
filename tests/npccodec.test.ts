import { describe, expect, it } from 'vitest';
import { decodeNpcLine, encodeNpcLine, resolveNpc, type NpcLine } from '../src/client/net/npcCodec';

const line: NpcLine = { kind: 'punched', uid: 12, role: 'wander', pos: [1.234, 0, -3.456], text: 'Ow! What was that for?', voice: 'el_guest_marco', alt: 'kokoro_am_adam', who: 'Marco', volume: 1.5 };

const person = (uid: number, role: string, x: number, z: number, driven = false) => ({ uid, role, driven, pos: { x, y: 0, z } });

describe('npc line codec', () => {
  it('round-trips a reaction', () => {
    const back = decodeNpcLine(JSON.parse(JSON.stringify(encodeNpcLine(line))));
    expect(back).toEqual({ ...line, pos: [1.23, 0, -3.46] });
  });

  it('round-trips a gasp (no text) and a reply', () => {
    expect(decodeNpcLine(encodeNpcLine({ ...line, kind: 'gasp', text: '', voice: 'x' }))?.kind).toBe('gasp');
    const r = decodeNpcLine(encodeNpcLine({ ...line, kind: 'reply', uid: -1, role: 'buddy', alt: undefined }));
    expect(r?.kind).toBe('reply');
    expect(r?.uid).toBe(-1);
    expect(r?.alt).toBeUndefined();
  });

  it('rejects junk', () => {
    expect(decodeNpcLine(null)).toBeNull();
    expect(decodeNpcLine({ ...encodeNpcLine(line), k: 99 })).toBeNull();
    expect(decodeNpcLine({ ...encodeNpcLine(line), p: [0, NaN, 0] })).toBeNull();
    expect(decodeNpcLine({ ...encodeNpcLine(line), p: [1e9, 0, 0] })).toBeNull();
    expect(decodeNpcLine({ ...encodeNpcLine(line), t: '' })).toBeNull();
    expect(decodeNpcLine({ ...encodeNpcLine(line), v: '../../etc' })).toBeNull();
    expect(decodeNpcLine({ ...encodeNpcLine(line), t: 'x'.repeat(5000) })?.text.length).toBe(240);
    expect(decodeNpcLine({ ...encodeNpcLine(line), vo: 50 })?.volume).toBe(2);
  });
});

describe('resolveNpc', () => {
  const people = [person(11, 'wander', 1, -3), person(12, 'wander', 20, 20), person(13, 'wander', 1.5, -3.2), person(-1, 'buddy', 1.2, -3.4, true), person(14, 'waiter', 1.1, -3.4)];

  it('takes the same person when they are near where the sender had them', () => {
    const near = [person(12, 'wander', 1.5, -3), ...people.slice(2)];
    expect(resolveNpc(near, line)?.uid).toBe(12);
  });

  it('falls back to the nearest person of that role close to the spot', () => {
    expect(resolveNpc(people, line)?.uid).toBe(13);
  });

  it('never picks a friend, crew or someone of another role; nobody near gives null', () => {
    expect(resolveNpc(people, { ...line, role: 'buddy' })).toBeNull();
    expect(resolveNpc(people, { ...line, role: 'bartender' })).toBeNull();
    expect(resolveNpc(people, { ...line, pos: [50, 0, 50] })).toBeNull();
    expect(resolveNpc(people, { ...line, role: 'waiter' })?.uid).toBe(14);
  });
});
