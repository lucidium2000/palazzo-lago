import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  ApproachTrack,
  classifyClasp,
  DAP,
  DAP_ADOPT,
  DAP_GRIP,
  DAP_SECONDS,
  DAP_SIDESTEP,
  dapArrives,
  dapCues,
  dapFingers,
  dapMessage,
  dapOffset,
  DapSeq,
  fingerTilt,
  LOW_CLASP,
  readDapMessage,
  type DapCue,
} from '../src/client/dap';
import { freshEvents, Outbox } from '../src/client/net/party';
import type { FingerPose } from '../src/client/fingers';

const dt = 1 / 72;

/** Runs a hand along `path(u)` (u 0..1) over `secs`, ending at the meeting point; returns its approach there. */
function approach(path: (u: number) => THREE.Vector3, secs = 0.3, eye = 1.62, tilt: number | null = null) {
  const tr = new ApproachTrack();
  for (let t = 0; t <= secs + 1e-9; t += dt) tr.push(t, path(Math.min(1, t / secs)));
  return tr.read(path(1).add(new THREE.Vector3(0, 0, 0.08)), 0, eye, tilt);
}

describe('dap or handshake', () => {
  const handshake = { rise: 0.6, speed: 0.5, up: 0.05, swing: 0.2, tilt: 0.1 };

  it('a low, slow, level, straight clasp is a handshake', () => {
    expect(classifyClasp(handshake)).toBe('handshake');
    expect(classifyClasp({ ...handshake, tilt: null })).toBe('handshake');
    expect(classifyClasp({ ...handshake, up: -0.3 })).toBe('handshake');
  });

  it('raised, fast, rising, swinging or fingers-up: any one makes it a dap', () => {
    expect(classifyClasp({ ...handshake, rise: 0.8 })).toBe('dap');
    expect(classifyClasp({ ...handshake, speed: 1.2 })).toBe('dap');
    expect(classifyClasp({ ...handshake, up: 0.4 })).toBe('dap');
    expect(classifyClasp({ ...handshake, swing: 0.8 })).toBe('dap');
    expect(classifyClasp({ ...handshake, tilt: 0.8 })).toBe('dap');
    // Right on a limit counts as the dap (it's the default).
    expect(classifyClasp({ ...handshake, rise: LOW_CLASP.rise })).toBe('dap');
  });

  it('reads a business handshake from a hand pushed straight out at waist height', () => {
    const ap = approach((u) => new THREE.Vector3(0.2, 0.98, 0.15 + 0.15 * u), 0.4);
    expect(ap.rise).toBeLessThan(LOW_CLASP.rise);
    expect(ap.speed).toBeLessThan(LOW_CLASP.speed);
    expect(classifyClasp(ap)).toBe('handshake');
  });

  it('reads a dap from a hand swung up and round to chest height', () => {
    const ap = approach((u) => new THREE.Vector3(0.35 * Math.cos(u * 1.4), 0.95 + 0.33 * u, 0.15 + 0.3 * Math.sin(u * 1.4)), 0.3);
    expect(ap.up).toBeGreaterThan(LOW_CLASP.up);
    expect(ap.swing).toBeGreaterThan(LOW_CLASP.swing);
    expect(classifyClasp(ap)).toBe('dap');
  });

  it('a slow, low clasp with the fingers pointing up is still a dap (palms meeting at an angle)', () => {
    const ap = approach((u) => new THREE.Vector3(0.2, 0.98, 0.15 + 0.15 * u), 0.4, 1.62, 0.9);
    expect(classifyClasp(ap)).toBe('dap');
  });

  it('measures the fingers pointing up from the wrist turn', () => {
    expect(fingerTilt(new THREE.Quaternion())).toBeCloseTo(0, 5);
    const up = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 4);
    expect(fingerTilt(up)).toBeCloseTo(Math.PI / 4, 5);
  });

  it('a lost hand clears its track', () => {
    const tr = new ApproachTrack();
    tr.push(0, new THREE.Vector3());
    tr.push(0.1, new THREE.Vector3(0, 0, 0.2));
    expect(tr.speed).toBeCloseTo(2, 5);
    tr.push(0.2, null);
    expect(tr.speed).toBe(0);
  });
});

describe('the dap sequence', () => {
  const run = (seq: DapSeq) => {
    const got: [number, DapCue][] = [];
    while (!seq.done) for (const c of seq.step(dt)) got.push([seq.t, c]);
    return got;
  };

  it('goes clasp, pull, hug, release, finish, done', () => {
    const s = new DapSeq('knock');
    const seen: string[] = [];
    while (!s.done) {
      if (seen[seen.length - 1] !== s.phase) seen.push(s.phase);
      s.step(dt);
    }
    expect(seen).toEqual(['clasp', 'pull', 'hug', 'release', 'finish']);
    expect(s.phase).toBe('done');
    expect(s.t).toBeGreaterThanOrEqual(DAP_SECONDS);
  });

  it('claps on the clasp, bumps, pats the back, releases, then the finisher and the "ayyy", each once and in order', () => {
    for (const fin of ['snap', 'knock'] as const) {
      const cues = run(new DapSeq(fin)).map(([, c]) => c);
      expect(cues[0]).toBe('clasp');
      expect(cues[1]).toBe('bump');
      const pats = cues.filter((c) => c === 'pat').length;
      expect(pats).toBeGreaterThanOrEqual(2);
      expect(cues.slice(-3)).toEqual(['release', fin, 'ayy']);
      expect(cues).toEqual(dapCues(fin).map(([, c]) => c));
    }
  });

  it('the grip locks at once and holds until the release ends; the bodies come together only after the clasp', () => {
    const s = new DapSeq();
    s.step(0.1);
    expect(s.grip).toBe(1);
    expect(s.close).toBe(0);
    s.step(DAP.clasp + DAP.pull);
    expect(s.phase).toBe('hug');
    expect(s.close).toBe(1);
    expect(s.hug).toBe(1);
    expect(s.grip).toBe(1);
    s.step(DAP.hug + DAP.release);
    expect(s.phase).toBe('finish');
    expect(s.grip).toBe(0);
    expect(s.close).toBe(0);
    expect(s.fin).toBeGreaterThan(0);
  });

  it('pats: the hand is on the back at each pat cue and lifted between', () => {
    const s = new DapSeq();
    s.step(DAP.clasp + DAP.pull);
    expect(s.pat).toBeCloseTo(0, 5);
    s.step(0.15);
    expect(s.pat).toBeGreaterThan(0.9);
  });

  it('a late start (heard over the network) skips what already happened', () => {
    const s = new DapSeq('snap', 0.2);
    const cues = run(s).map(([, c]) => c);
    expect(cues).not.toContain('clasp');
    expect(cues).toContain('bump');
  });

  it('the clasping hand: thumb grip while held, then the finisher, then back to itself', () => {
    const base: FingerPose = [0, 0, 0, 0, 0];
    const s = new DapSeq('knock');
    s.step(0.2);
    expect(dapFingers(base, s)).toEqual(DAP_GRIP);
    s.step(DAP_SECONDS - DAP.finish - 0.2 + DAP.finish * 0.3);
    const fist = dapFingers(base, s);
    expect(Math.min(...fist.slice(1))).toBeGreaterThan(0.9);
    const snap = new DapSeq('snap', DAP_SECONDS - DAP.finish + DAP.finish * 0.6);
    expect(dapFingers(base, snap)[2]).toBeGreaterThan(0.9);
    s.step(10);
    expect(dapFingers(base, s)).toEqual(base);
  });

  it('pulls the friend in from arm\'s length to a shoulder bump, never past you, and lets go at the end', () => {
    const me = new THREE.Vector3(0, 0, 0);
    const them = new THREE.Vector3(0, 0, 1.5);
    const s = new DapSeq();
    s.step(0.3);
    // During the clasp: in to arm's length (0.85 m).
    expect(them.clone().add(dapOffset(them, me, s)).distanceTo(me)).toBeCloseTo(0.85 + (1.5 - 0.85) * (1 - s.engage), 3);
    s.step(DAP.clasp + DAP.pull);
    const at = them.clone().add(dapOffset(them, me, s));
    // In to a shoulder bump: half a metre closer along the line, stepped aside to their free side (their left: my right, −x).
    expect(Math.abs(at.z)).toBeCloseTo(0.5, 3);
    expect(at.x).toBeCloseTo(-DAP_SIDESTEP, 3);
    expect(dapOffset(them, me, s, 1, 'l').x).toBeCloseTo(DAP_SIDESTEP, 3);
    // Watching two friends: each does half.
    expect(dapOffset(them, me, s, 0.5).z).toBeCloseTo(-0.5, 3);
    s.step(10);
    expect(dapOffset(them, me, s).length()).toBe(0);
  });
});

describe('dap over the network', () => {
  it('the message round-trips through JSON and is checked on the way in', () => {
    const m = dapMessage('peer-b', 'r', 'l', 'snap', 42);
    expect(readDapMessage(JSON.parse(JSON.stringify(m)))).toEqual({ id: 42, to: 'peer-b', h: 'r', th: 'l', fin: 'snap' });
    expect(readDapMessage(null)).toBeNull();
    expect(readDapMessage({ ...m, h: 'x' })).toBeNull();
    expect(readDapMessage({ ...m, to: '' })).toBeNull();
    expect(readDapMessage({ ...m, id: 'nope' })).toBeNull();
    expect(readDapMessage({ ...m, fin: 'moonwalk' })?.fin).toBe('knock');
    expect(['snap', 'knock']).toContain(dapMessage('x', 'r', 'r').fin);
  });

  it("rides the room's event outbox to the friend, who runs the same move (their hand is the receiver's hand)", () => {
    // A (sender) detects it and emits; B gets the packet ~120 ms later.
    const outbox = new Outbox();
    const sent = dapMessage('B', 'r', 'l', 'knock', 7);
    outbox.push('dap', sent, 0);
    const packet = JSON.parse(JSON.stringify(outbox.packet({} as never)));
    const { fresh } = freshEvents(0, packet.e);
    expect(fresh.map((e: { k: string }) => e.k)).toEqual(['dap']);
    const got = readDapMessage(fresh[0].d)!;
    expect(got.to).toBe('B');
    // B's side of it: B clasps with `th`, A's avatar with `h`.
    expect([got.th, got.h]).toEqual(['l', 'r']);
    // Both clocks give the same cues; B's runs 120 ms behind.
    const a = new DapSeq(sent.fin),
      b = new DapSeq(got.fin);
    const ca: DapCue[] = [],
      cb: DapCue[] = [];
    for (let t = 0; t < DAP_SECONDS + 0.5; t += dt) {
      ca.push(...a.step(dt));
      if (t >= 0.12) cb.push(...b.step(dt));
    }
    expect(cb).toEqual(ca);
    // Re-sent packets (until acked) don't start it twice.
    const again = freshEvents(fresh[0].n, packet.e);
    expect(again.fresh).toHaveLength(0);
  });

  it('both sides spotting it at once settle on the lower id, only early on; a busy friend ignores it', () => {
    expect(dapArrives(null, 5)).toBe('start');
    expect(dapArrives({ id: 9, t: 0.1, samePair: true }, 5)).toBe('adopt');
    expect(dapArrives({ id: 3, t: 0.1, samePair: true }, 5)).toBe('ignore');
    expect(dapArrives({ id: 9, t: DAP_ADOPT + 0.1, samePair: true }, 5)).toBe('ignore');
    expect(dapArrives({ id: 9, t: 0.1, samePair: false }, 5)).toBe('ignore');
  });
});
