import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DapCue } from '../src/client/dap';
import type { Wire } from '../src/client/net/transport';

/**
 * Two real Sessions (net/session.ts) wired back to back through a fake
 * transport (packets arrive a few frames late), with stand-in crowd, player
 * and HUD: the dap is detected on one side, travels as a `dap` event, and
 * both machines run the same move.
 */

beforeAll(() => {
  // Name tags draw on a canvas: a do-nothing 2D context is enough here.
  const ctx2d = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 100 }) : () => {}), set: () => true });
  (globalThis as unknown as { document: unknown }).document ??= {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, addEventListener() {}, style: {} }),
  };
});

type Hands = { l: THREE.Vector3 | null; r: THREE.Vector3 | null };

function fakePerson(at: THREE.Vector3, yaw: number) {
  return { pos: at.clone(), yaw, look: { height: 1.8, kind: 'male_suit' }, moving: 0, walkPhase: 0, rig: null, cheer: 0, dabT: 0, headYaw: 0, headPitch: 0, homeYaw: yaw, seated: false, swimHead: null, seatY: 0 } as Record<string, unknown> & { pos: THREE.Vector3; cheer: number };
}

/** One player's machine: a Session and what it did. */
async function machine(name: string, at: THREE.Vector3, facing: number, link: { out: Wire[][]; self: string }, host: boolean) {
  const { Session } = await import('../src/client/net/session');
  const camera = new THREE.PerspectiveCamera();
  const rig = new THREE.Group();
  rig.add(camera);
  rig.position.copy(at);
  camera.position.set(0, 1.62, 0);
  // Camera looks down −z: face heading `facing` (atan2(dx, dz)).
  rig.rotation.y = facing + Math.PI;
  rig.updateMatrixWorld(true);
  let onRemote: ((id: string, w: Wire | null) => void) | null = null;
  const log = { cues: [] as DapCue[], buzz: [] as string[], toasts: [] as string[], gest: [] as string[] };
  const hands: { now: Hands | null; grip: { l: number; r: number } } = { now: null, grip: { l: 0, r: 0 } };
  const player = {
    camera,
    rig,
    seated: null,
    stool: null,
    feetY: at.y,
    floorY: at.y,
    swimming: false,
    crouch: { drop: 0 },
    inXR: false,
    feet: () => rig.position.clone(),
  };
  const transport = {
    kind: 'local',
    code: 'TEST',
    self: link.self,
    publish: (w: Wire) => link.out.push([JSON.parse(JSON.stringify(w))]),
    onRemote: (fn: (id: string, w: Wire | null) => void) => (onRemote = fn),
    leave() {},
  };
  const session = new Session({
    transport: transport as never,
    host,
    name,
    avatar: host ? 0 : 1,
    crowd: { add: (_k: string, _l: unknown, p: THREE.Vector3, y: number) => fakePerson(p, y), setLook() {}, react() {} } as never,
    player: player as never,
    hud: { toast: (t: string) => log.toasts.push(t), say() {} } as never,
    scene: new THREE.Scene(),
    bankroll: { balance: 1000, onChange() {} } as never,
    roulette: { net: null, game: { phase: 'betting' } } as never,
    craps: { net: null, phase: 'betting', game: { point: null }, syncPoint() {} } as never,
    cheer() {},
    listener: {} as never,
    onRoster() {},
    hands: () => hands.now,
    grip: () => hands.grip,
    haptic: (side, s, ms) => log.buzz.push(`${side}:${s}:${ms}`),
    dapCue: (c) => log.cues.push(c),
  });
  const emit = session.emit.bind(session);
  session.emit = (k: string, d?: unknown) => {
    if (k === 'gest') log.gest.push(String((d as { k: string }).k));
    emit(k, d);
  };
  return { session, player, log, hands, deliver: (id: string, w: Wire | null) => onRemote?.(id, w) };
}

/** Machines in a room (A, B, and C when `third` is given), packets taking `lag` frames. A and B face each other `gap` m apart. */
async function room(gap = 1.0, lag = 6, third?: THREE.Vector3) {
  const outs: Record<string, Wire[][]> = { A: [], B: [], C: [] };
  const A = await machine('Ana', new THREE.Vector3(0, 0, 0), 0, { out: outs.A, self: 'A' }, true);
  const B = await machine('Ben', new THREE.Vector3(0, 0, gap), Math.PI, { out: outs.B, self: 'B' }, false);
  const C = third ? await machine('Cal', third, 0, { out: outs.C, self: 'C' }, false) : null;
  const all: Record<string, Awaited<ReturnType<typeof machine>>> = { A, B, ...(C ? { C } : {}) };
  const inFlight: { at: number; from: string; to: string; w: Wire }[] = [];
  let frame = 0;
  const dt = 1 / 60;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      frame++;
      for (const m of Object.values(all)) m.session.update(dt);
      for (const from of Object.keys(all))
        for (const [w] of outs[from].splice(0)) for (const to of Object.keys(all)) if (to !== from) inFlight.push({ at: frame + lag, from, to, w });
      const due = inFlight.filter((p) => p.at <= frame);
      for (const p of due) {
        inFlight.splice(inFlight.indexOf(p), 1);
        all[p.to].deliver(p.from, p.w);
      }
    }
  };
  // Say hello (each publishes once things change; nudge everyone).
  for (const m of Object.values(all)) m.session.say('hi');
  step(30);
  return { A, B, C, step, dt };
}

const dapOf = (s: unknown) => (s as { myDap: { seq: { phase: string; finisher: string; t: number }; hand: string; id: number } | null }).myDap;
const remoteOf = (s: unknown) => [...(s as { remotes: Map<string, { person: { pos: THREE.Vector3; cheer: number }; dap: { hand: string } | null }> }).remotes.values()][0];

describe('the dap between two machines', () => {
  it('desktop G on one side: both run the whole move together, the friend steps in for the shoulder bump', async () => {
    const { A, B, step } = await room(1.4);
    expect(A.session.friends).toEqual(['Ben']);
    expect(B.session.friends).toEqual(['Ana']);
    expect(A.session.dap()).toBe(true);
    step(10);
    const a = dapOf(A.session)!,
      b = dapOf(B.session)!;
    expect(b).not.toBeNull();
    expect(b.id).toBe(a.id);
    expect(b.seq.finisher).toBe(a.seq.finisher);
    // B is a few frames behind (the packet's flight), no more.
    expect(a.seq.t - b.seq.t).toBeGreaterThan(0.05);
    expect(a.seq.t - b.seq.t).toBeLessThan(0.2);
    // Each sees the other's avatar with the clasping hand set.
    expect(remoteOf(A.session).dap?.hand).toBe('r');
    expect(remoteOf(B.session).dap?.hand).toBe('r');
    // Into the hug: on each machine the friend's avatar has come in close.
    step(Math.round(60 * 1.2));
    expect(dapOf(A.session)!.seq.phase).toBe('hug');
    expect(remoteOf(A.session).person.pos.distanceTo(A.player.feet())).toBeLessThan(0.75);
    expect(remoteOf(B.session).person.pos.distanceTo(B.player.feet())).toBeLessThan(0.75);
    step(60 * 3);
    expect(dapOf(A.session)).toBeNull();
    expect(dapOf(B.session)).toBeNull();
    // The same cues in the same order on both, and both players felt it.
    expect(A.log.cues).toEqual(B.log.cues);
    expect(A.log.cues[0]).toBe('clasp');
    expect(A.log.cues).toContain('pat');
    expect(A.log.cues.slice(-2)).toEqual([a.seq.finisher as DapCue, 'ayy']);
    expect(A.log.toasts).toContain('Dap with Ben!');
    expect(B.log.toasts).toContain('Dap with Ana!');
    // Back where the network puts them once it's over.
    step(60);
    expect(remoteOf(A.session).person.pos.distanceTo(new THREE.Vector3(0, 0, 1.4))).toBeLessThan(0.05);
  });

  it('a third friend watching sees the two of them dap each other (and no handshake of theirs is taken for one with them)', async () => {
    const { A, B, C, step } = await room(1.2, 6, new THREE.Vector3(3, 0, 0.6));
    expect(C!.session.friends.sort()).toEqual(['Ana', 'Ben']);
    expect(A.session.dap()).toBe(true);
    step(10);
    const rs = [...(C!.session as unknown as { remotes: Map<string, { id: string; person: { pos: THREE.Vector3 }; dap: { partner: string; lead: boolean } | null }> }).remotes.values()];
    const ra = rs.find((r) => r.id === 'A')!,
      rb = rs.find((r) => r.id === 'B')!;
    expect(ra.dap?.partner).toBe('B');
    expect(rb.dap?.partner).toBe('A');
    // Exactly one of the pair plays the sounds on C's machine.
    expect(Number(ra.dap!.lead) + Number(rb.dap!.lead)).toBe(1);
    expect(dapOf(C!.session)).toBeNull();
    step(Math.round(60 * 1.2));
    // Each did half the closing: they meet in the middle.
    expect(ra.person.pos.distanceTo(rb.person.pos)).toBeLessThan(0.8);
    step(60 * 3);
    expect(C!.log.cues[0]).toBe('clasp');
    expect(C!.log.cues).toContain('ayy');
    expect(C!.log.toasts.some((t) => t.startsWith('Dap'))).toBe(false);
    // A gesture between A and B isn't one with C.
    A.session.emit('gest', { k: 'highfive', to: 'B' });
    step(10);
    expect(C!.log.toasts.some((t) => t.startsWith('High five'))).toBe(false);
    expect(B.log.toasts).toContain('High five with Ana!');
  });

  it('nobody near: no dap', async () => {
    const { A } = await room(4);
    expect(A.session.dap()).toBe(false);
  });

  it('both spotting it at once settle on one dap (the same finisher on both)', async () => {
    const { A, B, step } = await room(1.0);
    for (let i = 0; i < 6; i++) {
      A.session.dap();
      B.session.dap();
      step(20);
      const a = dapOf(A.session)!,
        b = dapOf(B.session)!;
      expect(a.id).toBe(b.id);
      expect(a.seq.finisher).toBe(b.seq.finisher);
      step(60 * 4);
    }
  });

  /** VR: B holds a hand out at `y`, gripping; A's right hand comes in along `path` (u 0..1) and grips on contact. */
  async function vrClasp(y: number, path: (u: number, meet: THREE.Vector3) => THREE.Vector3, secs: number) {
    const r = await room(1.0);
    const { A, B, step } = r;
    const meet = new THREE.Vector3(-0.15, y, 0.5);
    B.hands.now = { l: null, r: meet.clone().add(new THREE.Vector3(0, 0, 0.04)) };
    B.hands.grip = { l: 0, r: 1 };
    A.hands.now = { l: null, r: path(0, meet) };
    step(20);
    const n = Math.round(secs * 60);
    // Walk A's hand in.
    for (let i = 0; i <= n; i++) {
      A.hands.now = { l: null, r: path(i / n, meet) };
      if (i === n) A.hands.grip = { l: 0, r: 1 };
      step(1);
    }
    step(60);
    return r;
  }

  it('VR: hands swung up to chest height and clasped: a dap, on both machines', async () => {
    const { A, B } = await vrClasp(1.25, (u, m) => new THREE.Vector3(m.x + 0.35 * Math.cos(u * 1.4), 0.9 + (m.y - 0.9) * u, m.z - 0.35 + 0.35 * Math.sin(u * 1.4)), 0.3);
    expect(dapOf(A.session)).not.toBeNull();
    expect(dapOf(B.session)).not.toBeNull();
    expect(dapOf(A.session)!.hand).toBe('r');
    expect(A.log.gest).not.toContain('handshake');
    // The clasping hand locks into the thumb grip (what your hand model shows and your friend sees).
    const open = { l: [0, 0, 0, 0, 0] as [number, number, number, number, number], r: [0, 0, 0, 0, 0] as [number, number, number, number, number] };
    expect(A.session.dapFingers(open).r[2]).toBeGreaterThan(0.7);
    expect(A.session.dapFingers(open).l).toEqual(open.l);
    // Buzzes on both controllers.
    expect(A.log.buzz.some((b) => b.startsWith('right:1:'))).toBe(true);
    expect(A.log.buzz.some((b) => b.startsWith('left:'))).toBe(true);
  });

  it('VR: a low, slow, level clasp stays a handshake (once it is shaken)', async () => {
    const r = await room(1.0);
    const { A, B, step } = r;
    const meet = new THREE.Vector3(-0.15, 0.98, 0.5);
    B.hands.now = { l: null, r: meet.clone().add(new THREE.Vector3(0, 0, 0.04)) };
    B.hands.grip = { l: 0, r: 1 };
    step(20);
    const n = 30;
    for (let i = 0; i <= n; i++) {
      A.hands.now = { l: null, r: new THREE.Vector3(meet.x, meet.y, meet.z - 0.2 + (0.2 * i) / n) };
      step(1);
    }
    A.hands.grip = { l: 0, r: 1 };
    // Pump it up and down.
    for (let i = 0; i < 90; i++) {
      const dy = Math.sin(i * 0.35) * 0.05;
      A.hands.now = { l: null, r: new THREE.Vector3(meet.x, meet.y + dy, meet.z) };
      B.hands.now = { l: null, r: new THREE.Vector3(meet.x, meet.y + dy, meet.z + 0.04) };
      step(1);
    }
    expect(dapOf(A.session)).toBeNull();
    expect(A.log.gest).toContain('handshake');
  });
});
