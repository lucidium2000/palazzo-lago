import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HAND_POINTS, HEAD_SHAPE, SLAP, SlapDetector, gradeTouch, headVolume, slapSnap, sweepUnit, type FaceHit } from '../src/client/fight/slap';

const N = HAND_POINTS.radii.length;

/** A head bone standing at (x, y, z) facing `yaw` (people face (sin yaw, cos yaw)). */
function bone(x: number, y: number, z: number, yaw = 0, parent?: THREE.Object3D) {
  const b = new THREE.Object3D();
  b.position.set(x, y, z);
  b.rotation.y = yaw;
  parent?.add(b);
  (parent ?? b).updateMatrixWorld(true);
  return b;
}

/** Is a world point inside the head's contact volume (grown by `pad`)? */
function inside(b: THREE.Object3D, p: THREE.Vector3, pad = 0) {
  const inv = headVolume(new THREE.Matrix4(), b.matrixWorld, pad).invert();
  return p.clone().applyMatrix4(inv).length() <= 1;
}

/** Drives a palm-only hand along a path at `hz`, one frame per position; returns the hits. */
function drive(det: SlapDetector, b: THREE.Object3D, path: THREE.Vector3[], opts: { hz?: number; palm?: THREE.Vector3 | null; fist?: boolean | null; t0?: number } = {}) {
  const hz = opts.hz ?? 90;
  const hits: FaceHit[] = [];
  const pts = Array.from({ length: N }, () => new THREE.Vector3());
  const has = new Array(N).fill(false);
  has[0] = true;
  path.forEach((p, i) => {
    det.beginFrame((opts.t0 ?? 0) + i / hz);
    pts[0].copy(p);
    det.hand('right', pts, has, opts.palm === undefined ? null : opts.palm, opts.fist === undefined ? false : opts.fist);
    b.updateMatrixWorld(true);
    const h = det.contact('right', b, b.matrixWorld);
    if (h) hits.push(h);
  });
  return hits;
}

/** A straight swing from a to b at `speed` m/s sampled at `hz`. */
function swing(a: THREE.Vector3, b: THREE.Vector3, speed: number, hz = 90) {
  const n = Math.max(1, Math.ceil((a.distanceTo(b) / speed) * hz));
  return Array.from({ length: n + 1 }, (_, i) => a.clone().lerp(b, i / n));
}

/** Where the middle of the face volume is, world. */
const centre = (b: THREE.Object3D) => HEAD_SHAPE.c.clone().applyMatrix4(b.matrixWorld);

describe('the face contact volume', () => {
  it('follows the head bone: standing, crouched, sitting, turned', () => {
    const body = new THREE.Object3D();
    const b = bone(0, 1.6, 0, 0, body);
    const front = () => new THREE.Vector3(0, HEAD_SHAPE.c.y, HEAD_SHAPE.c.z + HEAD_SHAPE.r.z - 0.01).applyMatrix4(b.matrixWorld);
    // Standing: just in front of the nose is on the face, 20 cm in front isn't, nor where the head isn't.
    expect(inside(b, front())).toBe(true);
    expect(inside(b, centre(b).add(new THREE.Vector3(0, 0, 0.2)))).toBe(false);
    const standingFront = front();
    // Crouched (the whole body lower): the old spot is empty air, the new face is solid.
    body.position.y = -0.5;
    body.updateMatrixWorld(true);
    expect(inside(b, standingFront)).toBe(false);
    expect(inside(b, front())).toBe(true);
    expect(centre(b).y).toBeCloseTo(1.6 - 0.5 + HEAD_SHAPE.c.y, 5);
    // Sitting further down and leaning forward a little (the bone tilts): still on the face.
    body.position.y = -0.45;
    b.rotation.x = 0.3;
    body.updateMatrixWorld(true);
    expect(inside(b, front())).toBe(true);
    b.rotation.x = 0;
    // Turned to face +x (a quarter turn): the face is now on the +x side.
    body.position.y = 0;
    body.rotation.y = Math.PI / 2;
    body.updateMatrixWorld(true);
    const f = front();
    expect(f.x).toBeGreaterThan(0.1);
    expect(Math.abs(f.z)).toBeLessThan(0.05);
    expect(inside(b, standingFront)).toBe(false);
  });

  it('scales with the person (a taller rig, a bigger head) and the hand points have size', () => {
    const b = bone(0, 1.6, 0);
    b.scale.setScalar(1.2);
    b.updateMatrixWorld(true);
    const side = centre(b).add(new THREE.Vector3(HEAD_SHAPE.r.x * 1.2 - 0.005, 0, 0));
    expect(inside(b, side)).toBe(true);
    const out = centre(b).add(new THREE.Vector3(HEAD_SHAPE.r.x * 1.2 + 0.02, 0, 0));
    expect(inside(b, out)).toBe(false);
    // A palm (3.5 cm) that close is touching.
    expect(inside(b, out, HAND_POINTS.radii[0])).toBe(true);
  });
});

describe('swept detection', () => {
  it('sweeps a segment into the unit sphere', () => {
    expect(sweepUnit(new THREE.Vector3(-2, 0, 0), new THREE.Vector3(2, 0, 0))).toBeCloseTo(0.25, 5);
    expect(sweepUnit(new THREE.Vector3(-2, 1.5, 0), new THREE.Vector3(2, 1.5, 0))).toBe(-1);
    expect(sweepUnit(new THREE.Vector3(0.2, 0, 0), new THREE.Vector3(3, 0, 0))).toBe(0);
  });

  it('catches a fast swing that jumps clean over the face between two frames', () => {
    const b = bone(0, 1.6, 0);
    const c = centre(b);
    // 8 m/s across the face at a 30 Hz desktop frame rate: one frame each side of the head, neither touching it.
    const a = c.clone().add(new THREE.Vector3(0.16, 0, 0.03));
    const z = c.clone().add(new THREE.Vector3(-0.16, 0, 0.03));
    expect(inside(b, a, HAND_POINTS.radii[0])).toBe(false);
    expect(inside(b, z, HAND_POINTS.radii[0])).toBe(false);
    // A run-up so the hand's velocity is known.
    const path = [c.clone().add(new THREE.Vector3(0.69, 0, 0.03)), c.clone().add(new THREE.Vector3(0.43, 0, 0.03)), a, z];
    const hits = drive(new SlapDetector(), b, path, { hz: 30 });
    expect(hits.length).toBe(1);
    expect(hits[0].kind).toBe('slap');
    // It met the face on its +x side (their left: people face +z, so +x is their left).
    expect(hits[0].side).toBe(0);
    expect(hits[0].n.x).toBeGreaterThan(0.5);
  });

  it('catches the head moving into a still hand too (relative motion): someone walking into your hand is a touch', () => {
    const b = bone(0.4, 1.6, 0);
    const hand = centre(b).add(new THREE.Vector3(-0.4, 0, 0.03));
    const det = new SlapDetector();
    const hits: FaceHit[] = [];
    const pts = Array.from({ length: N }, () => new THREE.Vector3());
    const has = new Array(N).fill(false);
    has[0] = true;
    // The head moves 1.2 m/s sideways through a hand held still.
    for (let i = 0; i < 40; i++) {
      det.beginFrame(i / 72);
      b.position.x = 0.4 - (1.2 * i) / 72;
      b.updateMatrixWorld(true);
      pts[0].copy(hand);
      det.hand('right', pts, has, null, false);
      const h = det.contact('right', b, b.matrixWorld);
      if (h) hits.push(h);
    }
    expect(hits.length).toBe(1);
    expect(hits[0].kind).toBe('touch');
    // The hand moved relative to the head: toward +x (the head went -x).
    expect(hits[0].v.x).toBeGreaterThan(0.8);
  });
});

describe('grading a touch', () => {
  const n = new THREE.Vector3(1, 0, 0); // the face's normal where they meet (outward)
  it('a slow touch is soft, a fast open hand into the face is a slap', () => {
    expect(gradeTouch(new THREE.Vector3(-0.2, 0, 0), n, null, false).kind).toBe('brush');
    expect(gradeTouch(new THREE.Vector3(-0.9, 0, 0), n, null, false).kind).toBe('touch');
    expect(gradeTouch(new THREE.Vector3(-1.4, 0, 0), n, null, false).kind).toBe('touch');
    const s = gradeTouch(new THREE.Vector3(-3, 0, 0), n, null, false);
    expect(s.kind).toBe('slap');
    expect(s.power).toBeGreaterThan(0.2);
    expect(s.power).toBeLessThanOrEqual(1);
    // Harder, more power.
    expect(gradeTouch(new THREE.Vector3(-4.5, 0, 0), n, null, false).power).toBeGreaterThan(s.power);
    expect(SLAP.speed).toBeGreaterThanOrEqual(1.5);
    expect(SLAP.speed).toBeLessThanOrEqual(2);
  });

  it('only the part going into the face counts: a fast hand sliding along it (reaching past) is a graze', () => {
    const g = gradeTouch(new THREE.Vector3(-0.3, 0, 3), n, null, false);
    expect(g.kind).not.toBe('slap');
    expect(g.approach).toBeCloseTo(0.3, 5);
  });

  it('palm or back of the hand slaps; edge-on needs more speed', () => {
    const palmIn = new THREE.Vector3(-1, 0, 0);
    const palmOut = new THREE.Vector3(1, 0, 0);
    const edge = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3(-2, 0, 0);
    expect(gradeTouch(v, n, palmIn, false).kind).toBe('slap');
    const back = gradeTouch(v, n, palmOut, false);
    expect(back.kind).toBe('slap');
    expect(back.back).toBe(true);
    expect(gradeTouch(v, n, edge, false).kind).toBe('touch');
    expect(gradeTouch(new THREE.Vector3(-3, 0, 0), n, edge, false).kind).toBe('slap');
  });

  it('a fist at punch speed stays a punch; a slow fist is only a touch', () => {
    expect(gradeTouch(new THREE.Vector3(-2.5, 0, 0), n, null, true).kind).toBe('punch');
    expect(gradeTouch(new THREE.Vector3(-1.7, 0, 0), n, null, true).kind).toBe('touch');
    // Can't tell (no grip, no fingers): only very fast is a punch.
    expect(gradeTouch(new THREE.Vector3(-2.5, 0, 0), n, null, null).kind).toBe('slap');
    expect(gradeTouch(new THREE.Vector3(-3.5, 0, 0), n, null, null).kind).toBe('punch');
  });

  it('a graze through the detector is soft, a fast hit a slap', () => {
    const b = bone(0, 1.6, 0);
    const c = centre(b);
    const from = c.clone().add(new THREE.Vector3(0.4, 0, 0.03));
    const to = c.clone().add(new THREE.Vector3(-0.05, 0, 0.03));
    const soft = drive(new SlapDetector(), b, swing(from, to, 0.6));
    expect(soft.length).toBe(1);
    expect(['brush', 'touch']).toContain(soft[0].kind);
    expect(soft[0].power).toBe(0);
    const hard = drive(new SlapDetector(), bone(0, 1.6, 0), swing(from, to, 3.5));
    expect(hard.length).toBe(1);
    expect(hard[0].kind).toBe('slap');
    expect(hard[0].v.length()).toBeGreaterThan(3);
    // Reaching past their face at an everyday speed: never a slap.
    const past = drive(new SlapDetector(), bone(0, 1.6, 0), swing(c.clone().add(new THREE.Vector3(0.3, 0, 0.2)), c.clone().add(new THREE.Vector3(-0.3, 0, 0.05)), 1.2));
    expect(past.every((h) => h.kind !== 'slap')).toBe(true);
  });
});

describe('the head snaps the way the hand went', () => {
  it('turns toward their right when the hand goes to their right, and the other way', () => {
    // Facing +z, their right is -x.
    const right = slapSnap(new THREE.Vector3(-3, 0, 0), 0, 0.6);
    expect(right.yaw).toBeLessThan(0);
    expect(right.side).toBe(0); // came from their left: the left cheek
    const left = slapSnap(new THREE.Vector3(3, 0, 0), 0, 0.6);
    expect(left.yaw).toBeGreaterThan(0);
    expect(left.side).toBe(1);
    // Harder, further.
    expect(Math.abs(slapSnap(new THREE.Vector3(3, 0, 0), 0, 1).yaw)).toBeGreaterThan(Math.abs(slapSnap(new THREE.Vector3(3, 0, 0), 0, 0.2).yaw));
    // A quarter turn (facing +x): their right, (-cos yaw, sin yaw), is +z, so a hand going +z turns them to their right.
    expect(slapSnap(new THREE.Vector3(0, 0, 3), Math.PI / 2, 0.6).yaw).toBeLessThan(0);
    // Straight into the face from the front tips the head back, barely turning it.
    const front = slapSnap(new THREE.Vector3(0, 0, -3), 0, 0.6);
    expect(front.pitch).toBeGreaterThan(Math.abs(front.yaw));
  });
});

describe('one slap per hand per contact', () => {
  it('re-arms only once the hand has left the face', () => {
    const b = bone(0, 1.6, 0);
    const c = centre(b);
    const det = new SlapDetector();
    const out = c.clone().add(new THREE.Vector3(0.45, 0, 0.03));
    const on = c.clone().add(new THREE.Vector3(0.05, 0, 0.03));
    const near = c.clone().add(new THREE.Vector3(HEAD_SHAPE.r.x + HAND_POINTS.radii[0] + SLAP.rearm * 0.5, 0, 0.03));
    let t = 0;
    const go = (path: THREE.Vector3[]) => {
      const h = drive(det, b, path, { t0: t });
      t += path.length / 90 + 0.5;
      return h;
    };
    // A slap, then the hand stays on the cheek and wobbles: one slap.
    const first = go([...swing(out, on, 4), on, on.clone().add(new THREE.Vector3(0.02, 0, 0)), on]);
    expect(first.filter((h) => h.kind === 'slap').length).toBe(1);
    expect(first.length).toBe(1);
    // Off the skin but not away (inside the re-arm margin), then smack again: nothing.
    const second = go([on, near, near, ...swing(near, on, 4)]);
    expect(second.length).toBe(0);
    // Away, and back: a second slap.
    const third = go([...swing(on, out, 2), out, ...swing(out, on, 4)]);
    expect(third.filter((h) => h.kind === 'slap').length).toBe(1);
  });

  it('each hand has its own contact', () => {
    const b = bone(0, 1.6, 0);
    const c = centre(b);
    const det = new SlapDetector();
    const pts = Array.from({ length: N }, () => new THREE.Vector3());
    const has = new Array(N).fill(false);
    has[0] = true;
    const kinds: string[] = [];
    const L = swing(c.clone().add(new THREE.Vector3(0.45, 0, 0.03)), c.clone().add(new THREE.Vector3(0.05, 0, 0.03)), 4);
    const R = swing(c.clone().add(new THREE.Vector3(-0.45, 0, 0.03)), c.clone().add(new THREE.Vector3(-0.05, 0, 0.03)), 4);
    for (let i = 0; i < L.length; i++) {
      det.beginFrame(i / 90);
      for (const [id, path] of [['left', L], ['right', R]] as const) {
        pts[0].copy(path[i]);
        det.hand(id, pts, has, null, false);
      }
      for (const id of ['left', 'right']) {
        const h = det.contact(id, b, b.matrixWorld);
        if (h) kinds.push(id + ' ' + h.kind);
      }
    }
    expect(kinds.sort()).toEqual(['left slap', 'right slap']);
  });
});
