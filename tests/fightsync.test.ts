import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';

/**
 * Two machines in one room, wired back to back with a fake session: one
 * player starts a fight with a guest, the other sees the same guest (same
 * character), follows the fight, lands a punch that the first applies, sees
 * the knockout; and a player's own knockout shows on the friend's avatar.
 * (No browser: a minimal stand-in for the DOM.)
 */

function fakeEl(): Record<string, unknown> {
  const el: Record<string, unknown> = {
    style: {},
    classList: { toggle() {}, add() {}, remove() {} },
    textContent: '',
    innerHTML: '',
    width: 0,
    height: 0,
    appendChild() {},
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => fakeEl(),
    getContext: () => new Proxy({}, { get: (_t, k) => (k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}) }),
  };
  return el;
}

beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  g.document ??= { createElement: () => fakeEl(), getElementById: () => null, body: fakeEl() };
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
});

type Handler = (f: unknown, d: Record<string, unknown>) => void;

async function machine(id: string, seedBase: number) {
  const { Person, Crowd } = await import('../src/client/people');
  void Crowd;
  const { Fights } = await import('../src/client/fight/fights');
  const look = { dress: false, main: 0, second: 0, skin: 0, hair: 0, hairStyle: 'short' as const, height: 1.8, kind: 'male_suit' };
  const people = ['watch', 'watch', 'wander', 'bartender'].map((r, i) => {
    const p = new Person(r as 'watch', { ...look, main: i });
    p.seed = seedBase + i;
    p.pos.set(i * 3, 0, -2);
    return p;
  });
  // The friend's avatar on this machine.
  const avatar = new Person('buddy', { ...look });
  avatar.driven = true;
  const crowd = {
    people,
    now: 0,
    add: () => null,
    react() {},
    speak() {},
    setLook(p: InstanceType<typeof Person>, l: typeof look) {
      (p as { look: typeof look }).look = l;
    },
    randomNode: () => new THREE.Vector3(5, 0, 5),
  };
  const feet = new THREE.Vector3(0, 0, 0);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 1.65, 0);
  camera.updateMatrixWorld(true);
  const toasts: string[] = [];
  const handlers = new Map<string, Handler>();
  const session = {
    selfId: id,
    extraState: null as null | (() => Record<string, unknown>),
    peer: null as null | { id: string; handlers: Map<string, Handler>; avatar: InstanceType<typeof Person>; session: { extraState: null | (() => Record<string, unknown>) } },
    on: (k: string, fn: Handler) => handlers.set(k, fn),
    emit(k: string, d: unknown) {
      const peer = this.peer!;
      // Delivered to the other machine, from us (their avatar of us).
      peer.handlers.get(k)?.(friendOf(id, peer.avatar, () => session.extraState?.() ?? {}), JSON.parse(JSON.stringify(d ?? {})));
    },
    friendList() {
      const peer = this.peer!;
      return [friendOf(peer.id, avatar, () => peer.session.extraState?.() ?? {})];
    },
  };
  const friendOf = (fid: string, person: InstanceType<typeof Person>, state: () => Record<string, unknown>) => ({ id: fid, name: fid, person, get state() { return state(); }, color: 0, hand: () => null, wrist: () => null });
  const dialogue = {
    character: (p: InstanceType<typeof Person>) => ({ id: ['sal', 'vinnie', 'marcus', 'dale'][Math.floor(p.seed) % 4], name: ['Sal', 'Vinnie', 'Marcus', 'Dale'][Math.floor(p.seed) % 4], gender: 'male' }),
    voiceOf: () => 'el_bartender',
    voicesOf: () => ['el_x', 'am_x'],
    angryLines: () => ({ lines: [], voice: 'el_x', alt: 'am_x' }),
  };
  const fights = new Fights({
    crowd: crowd as never,
    world: { move: (x: number, z: number, dx: number, dz: number) => [x + dx, z + dz], settle: (x: number, z: number) => [x, z], groundAt: () => 0 } as never,
    player: { feet: () => feet, inXR: false, stunned: false } as never,
    hands: { wrist: () => null } as never,
    camera,
    scene: new THREE.Scene(),
    sound: { listener: null, play() {}, playLocal() {} } as never,
    hud: { toast: (t: string) => toasts.push(t) } as never,
    dialogue: dialogue as never,
    crew: { buddies: [], react() {} },
    react: () => 0,
    haptic() {},
    handsBusy: () => false,
    canvas: fakeEl() as never,
  });
  fights.connect(session as never);
  return { id, fights, people, avatar, handlers, session, toasts, feet };
}

describe('fights over the network', () => {
  it('a friend sees the same guest fight you, punches land on both sides, knockouts show', async () => {
    const A = await machine('A', 0);
    const B = await machine('B', 1); // B's crowd plays different characters by default
    A.session.peer = { id: 'B', handlers: B.handlers, avatar: B.avatar, session: B.session };
    B.session.peer = { id: 'A', handlers: A.handlers, avatar: A.avatar, session: A.session };
    // B's avatar of A stands where A is.
    B.avatar.pos.copy(A.feet);
    const pa = A.people[1];
    pa.pos.set(0, 0, -1);
    const f = A.fights.forceFight(pa);
    expect(f).not.toBeNull();
    // B: the same guest (index 1), the same character (seed), in a fight.
    const pb = B.people[1];
    expect(B.fights.debug().remote.length).toBe(1);
    expect(pb.seed).toBe(pa.seed);
    expect(pb.fight).not.toBeNull();
    // A's guest moves in and swings; B follows the phase and position.
    const step = (secs: number) => {
      for (let t = 0; t < secs; t += 0.05) {
        A.fights.update(0.05);
        B.fights.update(0.05);
      }
    };
    step(3);
    expect(A.fights.debug().you).toBeLessThan(100);
    expect(Math.hypot(pb.pos.x - pa.pos.x, pb.pos.z - pa.pos.z)).toBeLessThan(0.2);
    expect(B.fights.debug().remote[0].phase).not.toBe('square');
    // B punches the guest: A applies the damage.
    const hp0 = A.fights.debug().fights[0].hp;
    B.fights.hitPerson(pb, 1, 'body', new THREE.Vector3(0, 0, -3));
    expect(A.fights.debug().fights[0].hp).toBeLessThan(hp0);
    // A knocks them out: B sees them go down.
    for (let i = 0; i < 40 && A.fights.debug().fights[0]?.phase !== 'ko'; i++) A.fights.hitPerson(pa, 1, 'head', new THREE.Vector3(0, 0, -3));
    expect(A.fights.debug().fights[0].phase).toBe('ko');
    step(1);
    expect(B.fights.debug().remote[0].phase).toBe('ko');
    // The same knockdown (clip and clock) on both machines.
    expect(pb.fight!.act).toBe('ko');
    expect(Math.abs(pb.fight!.actT - pa.fight!.actT)).toBeLessThan(0.3);
    step(1.2);
    expect(pb.fight!.down).toBeGreaterThan(0.8);
    // They get up and leave; the fight ends on both machines.
    step(20);
    expect(A.fights.debug().fights.length).toBe(0);
    step(0.2);
    expect(B.fights.debug().remote.length).toBe(0);
    expect(pb.fight).toBeNull();
    // A gets knocked out (another guest): B sees A's avatar go down, then get up.
    for (let i = 0; i < 30 && !A.fights.you.out; i++) A.fights.you.hurt({ zone: 'head', power: 1 });
    expect(A.fights.you.out).toBe(true);
    step(2.2);
    expect(B.avatar.fight?.act).toBe('ko');
    expect(B.avatar.fight?.down ?? 0).toBeGreaterThan(0.8);
    step(6);
    expect(A.fights.you.out).toBe(false);
    step(2);
    expect(B.avatar.fight).toBeNull();
  });

  it('slaps on a guest nobody is fighting show on the friend’s side too', async () => {
    const A = await machine('A', 0);
    const B = await machine('B', 0);
    A.session.peer = { id: 'B', handlers: B.handlers, avatar: B.avatar, session: B.session };
    B.session.peer = { id: 'A', handlers: A.handlers, avatar: A.avatar, session: A.session };
    A.fights.hitPerson(A.people[0], 0.6, 'head', new THREE.Vector3(2, 0, 0), true);
    expect(A.people[0].blush).toBeGreaterThan(0);
    expect(B.people[0].blush).toBeGreaterThan(0);
    expect(Math.abs(B.people[0].snapY)).toBeGreaterThan(0.3);
  });
});
