// Builds the headliner's stage moves: public/assets/people/show.glb.
//
// Nixie Vale's choreography (party/stage.ts, party/showanim.ts): original
// electropop moves made from everyday dance vocabulary (sways, hip rolls,
// shoulder isolations, hits on the beat, arm waves and sweeps, hair flips, side
// steps, spins, a freeze, arms-up crowd calls, a big pose on the drop, a lunge
// for the final pose, a bow; and the older showman moves, kept for anyone who
// wants them) and nobody's signature moves. Every move is authored here as
// numeric key poses on the "Ultimate Modular" rig the people use (her body:
// art/source/people/female_suit.glb), in beats at 122 bpm (the set's tempo; the client plays each
// clip by the beat clock, so it follows the music exactly). Between keys the
// numbers are eased (hits land with an accelerating ease, so they stop hard on
// the beat), each frame is rebuilt from them (two-bone IK on legs and arms) and
// sampled at 30 fps; standing frames are dropped onto the floor (the lowest
// point of the skinned body at y = 0), airborne ones are lifted exactly.
//
// The side glides travel: the clip is in place (the travel taken out at a
// constant speed) and the client moves him by the same amount (showmoves.json
// `dx` per cycle), so his planted foot stays put on the stage.
// Clips are named Show_*; durations and travel are in src/client/party/showmoves.json.
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { treeOf, wp, setWorldQ, rotWorld, twoBone } from './fightrig.mjs';

const FPS = 30;
const SRC = 'art/source/anims/ual_standard.glb';
const RIG = 'art/source/people/female_suit.glb';
const OUT_FILE = 'public/assets/people/show.glb';
const TABLE = JSON.parse(fs.readFileSync('src/client/party/showmoves.json', 'utf8'));
/** One beat (s) at the clips' tempo. */
const BEAT = 60 / TABLE.bpm;

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const X = V(1, 0, 0),
  Y = V(0, 1, 0),
  Z = V(0, 0, 1);
const rad = THREE.MathUtils.degToRad;
const Q = (axis, deg) => new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), rad(deg));

// ---------------------------------------------------------------------------
// The rig (as in build-fight-anims.mjs)
// ---------------------------------------------------------------------------

const rigDoc = await io.read(RIG);
const T = treeOf(rigDoc);
const skin = rigDoc.getRoot().listSkins()[0];
const joints = skin.listJoints().map((j) => T.of.get(j));
const ibm = skin.getInverseBindMatrices().getArray();
/** Bind (T-pose) world matrix of each joint. */
const bindWorld = new Map();
joints.forEach((o, i) => bindWorld.set(o.name, new THREE.Matrix4().fromArray(ibm, i * 16).invert()));
const bindQ = (n) => new THREE.Quaternion().setFromRotationMatrix(bindWorld.get(n));
const bindP = (n) => new THREE.Vector3().setFromMatrixPosition(bindWorld.get(n));
const B = (n) => T.byName.get(n);
const restLocal = new Map();
for (const o of T.byName.values()) restLocal.set(o.name, { p: o.position.clone(), q: o.quaternion.clone() });
/** Bones the clips drive (rotation): everything with a parent joint, except the IK pole targets. */
const BONES = joints.map((o) => o.name).filter((n) => !/^PT\./.test(n) && n !== 'Root');
/** Bones the clips also move (translation). */
const MOVED = ['Body', 'Foot.L', 'Foot.R'];

function bindPose() {
  for (const n of BONES) {
    const o = B(n);
    const l = o.parent.matrixWorld.clone().invert().multiply(bindWorld.get(n));
    const p = new THREE.Vector3(),
      q = new THREE.Quaternion(),
      s = new THREE.Vector3();
    l.decompose(p, q, s);
    o.position.copy(p);
    o.quaternion.copy(q);
    o.updateMatrixWorld(true);
  }
  // Hips: no clip moves it, so the client holds it at its node rest.
  B('Hips').quaternion.copy(restLocal.get('Hips').q);
  B('Hips').position.copy(restLocal.get('Hips').p);
  T.root.updateMatrixWorld(true);
}
bindPose();
/** Where the foot point (on the floor under the ankle) sits in the shin's frame (it hangs off the root, not the shin). */
const footInShin = {};
for (const s of ['L', 'R']) footInShin[s] = B(`LowerLeg.${s}`).worldToLocal(bindP(`Foot.${s}`));

// The skinned body, for the floor contact.
const verts = [];
{
  const jIndex = new Map(skin.listJoints().map((j, i) => [i, T.of.get(j).name]));
  for (const node of rigDoc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || !node.getSkin() || /pistol/i.test(node.getName())) continue;
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION'),
        J = prim.getAttribute('JOINTS_0'),
        W = prim.getAttribute('WEIGHTS_0');
      for (let i = 0; i < P.getCount(); i += 3) verts.push({ p: V(...P.getElement(i, [])), j: J.getElement(i, []).map((x) => jIndex.get(x)), w: W.getElement(i, []) });
    }
  }
}
const ibmOf = new Map();
joints.forEach((o, i) => ibmOf.set(o.name, new THREE.Matrix4().fromArray(ibm, i * 16)));
/** Lowest point of the skinned body (rig space). */
function lowest() {
  T.root.updateMatrixWorld(true);
  const M = new Map();
  for (const o of joints) M.set(o.name, o.matrixWorld.clone().multiply(ibmOf.get(o.name)));
  let lo = Infinity;
  const v = new THREE.Vector3(),
    acc = new THREE.Vector3();
  for (const x of verts) {
    acc.set(0, 0, 0);
    for (let k = 0; k < 4; k++) if (x.w[k] > 0) acc.addScaledVector(v.copy(x.p).applyMatrix4(M.get(x.j[k])), x.w[k]);
    if (acc.y < lo) lo = acc.y;
  }
  return lo;
}
function lift(dy) {
  for (const n of MOVED) B(n).position.y += dy;
  T.root.updateMatrixWorld(true);
}
function apply(pose) {
  for (const n of BONES) {
    B(n).quaternion.copy(pose[n].q);
    if (MOVED.includes(n)) B(n).position.copy(pose[n].p);
  }
  T.root.updateMatrixWorld(true);
}
function snap() {
  const o = {};
  for (const n of BONES) o[n] = { q: B(n).quaternion.clone(), p: B(n).position.clone() };
  return o;
}
/** Solves a leg so its foot point is at `target`, the knee toward `pole`, and moves the foot bone there. */
function legTo(s, target, pole) {
  const at = twoBone(B(`UpperLeg.${s}`), B(`LowerLeg.${s}`), footInShin[s], target, pole);
  const foot = B(`Foot.${s}`);
  foot.position.copy(foot.parent.worldToLocal(at));
  foot.updateMatrixWorld(true);
}
const turn = (n, axis, deg) => deg && rotWorld(B(n), Q(axis, deg));
function armTo(s, hand, pole) {
  twoBone(B(`UpperArm.${s}`), B(`LowerArm.${s}`), B(`Wrist.${s}`).position.clone(), hand, pole);
}

// ---------------------------------------------------------------------------
// The pose builder
//
// A pose is a handful of numbers (all eased between keys):
//   px, pz     the pelvis, from where it stands at rest (m; +x his left, +z the crowd)
//   drop       how far the pelvis sinks (the knees bend); air: off the floor (m)
//   yaw        the whole body's turn (deg, + to his left); pitch: lean forward; roll: lean to his left
//   fyaw       the feet's frame (turns with a spin: they pivot on the balls of the feet)
//   lf, rf     each foot: [out, fwd, toe-out deg, lift m, heel-up deg] ("out" is toward that side)
//   lk, rk     each knee's pole, from its hip: [out, up, fwd]
//   sp, hd     spine and head: [pitch fwd, yaw left, roll left] (deg)
//   sh         shoulders raised: [left, right] (deg)
//   la, ra     each hand from its shoulder, and its elbow's pole: [out, up, fwd, pole out, up, fwd]
// ---------------------------------------------------------------------------

const BODY0 = bindP('Body');
const FOOT_Y = bindP('Foot.L').y;
/** From the foot point (under the ankle) to the ball of the foot, which a raised heel turns about. */
const TOE = 0.12;

const HANG = [0.05, -0.39, 0.03, 0.3, -0.1, -0.3];
const BENT = [0.05, -0.2, 0.22, 0.28, -0.3, -0.2];
/** The mic hand (her right) at her mouth. */
const MIC = [-0.11, 0.0, 0.21, 0.3, -0.35, -0.05];
const MIC_LOW = [-0.08, -0.12, 0.2, 0.3, -0.4, -0.1];
const CHEST = [-0.1, -0.13, 0.19, 0.35, -0.2, 0];
const OUT = [0.41, 0.02, 0.05, 0, -0.3, -0.3];
const UPV = [0.24, 0.35, 0.06, 0.35, 0, -0.3];
const UP = [0.05, 0.41, 0.03, 0.35, 0, -0.2];
const DIAG = [0.3, -0.27, 0.1, 0.25, -0.2, -0.3];
const POINT = [0.12, 0.04, 0.39, 0.3, -0.3, 0];
const HIP = [0.11, -0.36, -0.02, 0.4, -0.1, -0.15];

const STANCE = {
  px: 0, pz: 0, drop: 0.015, air: 0, yaw: 0, pitch: 0, roll: 0, fyaw: 0,
  lf: [0.15, 0.06, 9, 0, 0], rf: [0.15, 0.06, 9, 0, 0],
  lk: [0.12, -0.3, 0.8], rk: [0.12, -0.3, 0.8],
  sp: [0, 0, 0], hd: [0, 0, 0], sh: [0, 0],
  la: BENT, ra: MIC_LOW,
};

const sgnOf = (s) => (s === 'L' ? 1 : -1);
const v3 = (a, sg, i = 0) => V(sg * a[i], a[i + 1], a[i + 2]);

/** Fingers loosely curled (a relaxed, half-closed hand), from the T-pose. */
function relaxHands() {
  for (const side of ['L', 'R']) {
    const sg = sgnOf(side);
    for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) {
      const k = f === 'Index' ? 0.8 : f === 'Pinky' ? 1.15 : 1;
      turn(`${f}2.${side}`, Z, -sg * 28 * k);
      turn(`${f}3.${side}`, Z, -sg * 32 * k);
      turn(`${f}4.${side}`, Z, -sg * 18 * k);
    }
    turn(`Thumb2.${side}`, Y, sg * 20);
    turn(`Thumb3.${side}`, Z, -sg * 20);
  }
}

/** Puts the rig in pose `s` (with `tx`: the travel so far, taken out in x). */
function build(s, tx = 0) {
  bindPose();
  relaxHands();
  const qF = Q(Y, s.fyaw);
  const body = B('Body');
  body.position.copy(body.parent.worldToLocal(V(BODY0.x + s.px - tx, BODY0.y - s.drop, BODY0.z + s.pz)));
  body.updateMatrixWorld(true);
  const qB = Q(Y, s.yaw).multiply(Q(X, s.pitch)).multiply(Q(Z, -s.roll));
  setWorldQ(body, qB.clone().multiply(bindQ('Body')));
  // Legs.
  for (const side of ['L', 'R']) {
    const f = side === 'L' ? s.lf : s.rf,
      k = side === 'L' ? s.lk : s.rk,
      sg = sgnOf(side);
    const qY = Q(Y, s.fyaw + sg * f[2]);
    const at = V(sg * f[0], FOOT_Y + f[3], f[1]).applyQuaternion(qF);
    at.x -= tx;
    let q = qY.clone();
    if (f[4]) {
      const toe = V(0, 0, TOE).applyQuaternion(qY).add(at);
      const r = new THREE.Quaternion().setFromAxisAngle(X.clone().applyQuaternion(qY), rad(f[4]));
      at.sub(toe).applyQuaternion(r).add(toe);
      q = r.multiply(q);
    }
    const hip = wp(B(`UpperLeg.${side}`));
    legTo(side, at, hip.add(v3(k, sg).applyQuaternion(Q(Y, s.fyaw + sg * f[2] * 0.5))));
    setWorldQ(B(`Foot.${side}`), q.multiply(bindQ(`Foot.${side}`)));
  }
  // Spine and head.
  const ax = (v) => v.clone().applyQuaternion(qB);
  for (const [n, k] of [['Abdomen', 0.35], ['Torso', 0.35], ['Chest', 0.3]]) {
    turn(n, ax(Y), s.sp[1] * k);
    turn(n, ax(X), s.sp[0] * k);
    turn(n, ax(Z), -s.sp[2] * k);
  }
  const qC = Q(Y, s.yaw + s.sp[1]);
  const cx = (v) => v.clone().applyQuaternion(qC);
  for (const [n, k] of [['Neck', 0.4], ['Head', 0.6]]) {
    turn(n, cx(Y), s.hd[1] * k);
    turn(n, cx(X), s.hd[0] * k);
    turn(n, cx(Z), -s.hd[2] * k);
  }
  turn('Shoulder.L', cx(Z), s.sh[0]);
  turn('Shoulder.R', cx(Z), -s.sh[1]);
  // Arms.
  for (const side of ['L', 'R']) {
    const a = side === 'L' ? s.la : s.ra,
      sg = sgnOf(side);
    const sh = wp(B(`UpperArm.${side}`));
    armTo(side, sh.clone().add(v3(a, sg).applyQuaternion(qC)), sh.clone().add(v3(a, sg, 3).applyQuaternion(qC)));
  }
  // On the floor, or exactly this far off it.
  T.root.updateMatrixWorld(true);
  if (s.air > 0) {
    // Off the floor by exactly `air`, from where this pose would stand (feet down).
    const pose = snap();
    build({ ...s, air: 0, lf: [...s.lf.slice(0, 3), 0, s.lf[4]], rf: [...s.rf.slice(0, 3), 0, s.rf[4]] }, tx);
    const off = -lowest();
    apply(pose);
    lift(off + s.air);
  } else lift(-lowest());
  return snap();
}

// --- Keys -------------------------------------------------------------------------------

const EASE = {
  smooth: (x) => x * x * (3 - 2 * x),
  lin: (x) => x,
  /** Accelerating into the key: a hit that stops hard on it. */
  hit: (x) => x * x * x,
  /** Quick out of the last key, settling into this one. */
  out: (x) => 1 - (1 - x) ** 3,
};
const lerpSpec = (a, b, f) => {
  const o = {};
  for (const k of Object.keys(a)) o[k] = Array.isArray(a[k]) ? a[k].map((v, i) => v + (b[k][i] - v) * f) : a[k] + (b[k] - a[k]) * f;
  return o;
};
const with_ = (base, part) => {
  const o = { ...base };
  for (const k of Object.keys(part)) o[k] = Array.isArray(part[k]) ? part[k].slice() : part[k];
  return o;
};
/** The same pose the other way round (his left for his right). */
function mirror(s) {
  return {
    ...s,
    px: -s.px, yaw: -s.yaw, roll: -s.roll, fyaw: -s.fyaw,
    lf: s.rf, rf: s.lf, lk: s.rk, rk: s.lk, la: s.ra, ra: s.la,
    sp: [s.sp[0], -s.sp[1], -s.sp[2]], hd: [s.hd[0], -s.hd[1], -s.hd[2]], sh: [s.sh[1], s.sh[0]],
  };
}

/**
 * A move from keys: [beat, pose changes, ease into it]. Each key builds on the
 * one before. `mod(pose, beat)` adds the bounce; `dx` the travel per clip (taken out).
 */
function move(name, keys, { mod, dx = 0, from = STANCE } = {}) {
  const beats = TABLE.moves[name].beats;
  const full = [];
  let prev = from;
  for (const [b, part, ease] of keys) {
    prev = with_(prev, part);
    full.push([b, prev, EASE[ease ?? 'smooth']]);
  }
  const frames = [];
  const n = Math.round((beats * BEAT) * FPS);
  for (let i = 0; i <= n; i++) {
    const b = (i / n) * beats;
    let k = 0;
    while (k < full.length - 2 && full[k + 1][0] <= b) k++;
    const [b0, a] = full[k];
    const [b1, c, e] = full[Math.min(k + 1, full.length - 1)];
    let s = b1 > b0 ? lerpSpec(a, c, e(THREE.MathUtils.clamp((b - b0) / (b1 - b0), 0, 1))) : a;
    if (mod) s = mod(with_(s, {}), b);
    frames.push(build(s, (dx * b) / beats));
  }
  clips.push({ name, frames });
  return full[full.length - 1][1];
}
const clips = [];
const bounce = (b, k = 1) => 0.5 + 0.5 * Math.cos(2 * Math.PI * b * k);
const add = (a, i, v) => {
  a = a.slice();
  a[i] += v;
  return a;
};

// --- The moves ----------------------------------------------------------------------------

// Groove at the stand: knees down on every beat, the hips swaying over two, shoulders and head with them.
move('Show_Groove', [[0, {}], [2, {}]], {
  mod: (s, b) => {
    const sw = Math.sin(Math.PI * b);
    s.drop += 0.035 * bounce(b);
    s.px += 0.035 * sw;
    s.roll += 3 * sw;
    s.sp = [s.sp[0] + 3 * bounce(b), s.sp[1] + 7 * sw, s.sp[2] - 5 * sw];
    s.hd = [s.hd[0] + 7 * bounce(b, 1) - 3, s.hd[1] - 4 * sw, s.hd[2] + 3 * sw];
    s.la = add(add(s.la, 2, 0.06 * sw), 1, 0.04 * bounce(b));
    s.ra = add(s.ra, 1, 0.03 * bounce(b));
    s.sh = [3 * Math.max(0, sw), 3 * Math.max(0, -sw)];
    return s;
  },
});

// Shoulder isolations: the chest shifts sharply side to side on the beat, a shoulder pops up with it.
{
  const L = { sp: [4, 8, 9], sh: [16, -2], hd: [0, -6, -5], px: -0.02, la: [0.08, -0.16, 0.24, 0.3, -0.3, -0.2], ra: [-0.02, -0.22, 0.24, 0.28, -0.3, -0.2] };
  const R = mirror(with_(STANCE, L));
  move('Show_Iso', [[0, L], [0.7, L], [1, R, 'hit'], [1.7, R], [2, L, 'hit']], {
    mod: (s, b) => ((s.drop += 0.03 * bounce(b)), s),
  });
}

// Knee pops: on each beat a knee snaps forward and in (heel up), the hips drop to the other side.
{
  const P = { drop: 0.08, px: -0.04, roll: -4, lf: [0.13, 0.08, 4, 0, 38], lk: [-0.15, -0.2, 0.8], sp: [5, -6, 3], hd: [6, 8, 0], la: [0.14, -0.3, 0.16, 0.3, -0.2, -0.2], ra: MIC_LOW };
  const Pm = mirror(with_(STANCE, P));
  Pm.la = BENT;
  Pm.ra = [-0.02, -0.22, 0.24, 0.3, -0.35, -0.1];
  move('Show_KneePop', [[0, P], [0.65, P], [1, Pm, 'hit'], [1.65, Pm], [2, P, 'hit']]);
}

// A hit on the beat: knees dip, the left arm snaps out and up, the mic hand across the chest, head snaps left.
const HIT = { drop: 0.08, sp: [2, 12, 3], hd: [-6, 28, 0], la: [0.36, 0.2, 0.14, 0.2, -0.3, -0.3], ra: CHEST, sh: [6, 0] };
move('Show_Hit', [[0, {}], [0.14, HIT, 'out'], [0.6, add2(HIT)], [1, STANCE]]);
function add2(h) {
  return { ...h, drop: h.drop - 0.01, hd: [h.hd[0] - 2, h.hd[1], h.hd[2]] };
}

// Four hits, one a beat.
{
  const wide = { lf: [0.25, 0.06, 12, 0, 0], rf: [0.25, 0.06, 12, 0, 0] };
  const H1 = { ...wide, drop: 0.1, sp: [10, 0, 0], hd: [22, 0, 0], la: DIAG, ra: DIAG };
  const H2 = { drop: 0.06, px: -0.05, roll: -3, sp: [-4, 10, 4], hd: [-14, 20, 0], la: UPV, ra: CHEST };
  const H3 = { drop: 0.07, px: 0.05, roll: 3, sp: [0, -14, -3], hd: [0, -30, 0], la: [-0.1, -0.12, 0.19, 0.35, -0.2, 0], ra: OUT };
  const H4 = { drop: 0.13, px: 0, roll: 0, sp: [12, 0, 0], hd: [14, 0, 0], la: [-0.09, -0.16, 0.17, 0.4, 0, -0.05], ra: [-0.09, -0.16, 0.17, 0.4, 0, -0.05], sh: [8, 8] };
  move('Show_Hits4', [
    [0, {}],
    [0.08, { lf: [0.2, 0.06, 10, 0.05, 0], rf: [0.2, 0.06, 10, 0.05, 0], drop: 0.06 }, 'lin'],
    [0.16, H1, 'out'],
    [0.85, { drop: 0.09 }],
    [1.12, H2, 'out'],
    [1.85, { drop: 0.05 }],
    [2.12, H3, 'out'],
    [2.85, { drop: 0.06 }],
    [3.12, H4, 'out'],
    [3.6, { drop: 0.12 }],
    [3.75, { lf: [0.2, 0.06, 10, 0.05, 0], rf: [0.2, 0.06, 10, 0.05, 0], drop: 0.06, la: BENT, ra: MIC_LOW, sp: [0, 0, 0], hd: [0, 0, 0], sh: [0, 0] }],
    [4, STANCE],
  ]);
}

// Spins on the balls of the feet: a wind-up the other way, arms in, round (once or twice), and a hit facing front.
function spin(name, turns, t0, t1) {
  const prep = { drop: 0.09, yaw: -28, fyaw: 0, sp: [6, -10, 0], la: OUT, ra: MIC, hd: [4, 0, 0] };
  const tuck = { drop: 0.0, lf: [0.07, 0.04, 4, 0, 28], rf: [0.07, 0.04, 4, 0, 28], la: CHEST, ra: MIC, sp: [-3, 0, 0], hd: [-4, 0, 0] };
  const land = { drop: 0.07, yaw: 360 * turns, fyaw: 360 * turns, lf: [0.16, 0.06, 9, 0, 0], rf: [0.16, 0.06, 9, 0, 0], la: [0.38, 0.12, 0.16, 0.2, -0.3, -0.3], ra: MIC, sp: [0, 6, 0], hd: [-4, 16, 0] };
  move(name, [
    [0, {}],
    [t0, prep],
    [t0 + 0.12, { ...tuck, yaw: -10, fyaw: -6 }, 'lin'],
    [t1 - 0.1, { yaw: 360 * turns - 18, fyaw: 360 * turns - 12 }, 'lin'],
    [t1 + 0.1, land, 'out'],
    [1.75, { drop: 0.06 }],
    [2, { ...STANCE, yaw: 360 * turns, fyaw: 360 * turns }],
  ]);
}
spin('Show_Spin', 1, 0.35, 1.35);
spin('Show_Spin2', 2, 0.25, 1.45);

// Jump on the chorus downbeat, landing into a freeze: wide stance, free arm high, mic at the mouth, chin up.
const FREEZE = { drop: 0.11, lf: [0.27, 0.07, 14, 0, 0], rf: [0.27, 0.07, 14, 0, 0], sp: [-5, 6, 4], hd: [-10, 12, 0], la: UPV, ra: MIC, sh: [4, 0] };
{
  const jumpH = 0.2,
    up = 0.3,
    down = 1.02;
  move('Show_JumpFreeze', [
    [0, {}],
    [0.24, { drop: 0.15, sp: [14, 0, 0], hd: [8, 0, 0], la: [0.14, -0.33, -0.14, 0.3, -0.1, -0.4], ra: MIC_LOW }],
    [up, { drop: 0.0, lf: [0.15, 0.06, 9, 0, 30], rf: [0.15, 0.06, 9, 0, 30], sp: [-2, 0, 0], la: [0.2, 0.2, 0.15, 0.3, 0, -0.3], ra: MIC }, 'lin'],
    [0.66, { drop: -0.02, lf: [0.22, 0.1, 12, 0.12, 15], rf: [0.22, 0.1, 12, 0.12, 15], lk: [0.12, 0, 0.8], rk: [0.12, 0, 0.8], la: UPV, hd: [-8, 0, 0] }],
    [down - 0.04, { drop: 0.0, lf: [0.27, 0.07, 14, 0.01, 20], rf: [0.27, 0.07, 14, 0.01, 20] }],
    [down + 0.12, { ...FREEZE, drop: 0.17, lk: STANCE.lk, rk: STANCE.rk, sp: [10, 6, 2] }, 'out'],
    [1.4, FREEZE],
    [3.5, { ...FREEZE, drop: 0.1, hd: [-12, 14, 0] }],
    [3.75, { lf: [0.2, 0.06, 10, 0.06, 0], la: BENT, ra: MIC, sp: [0, 0, 0], hd: [0, 0, 0], sh: [0, 0], drop: 0.06 }],
    [4, { ...STANCE, ra: MIC }],
  ], {
    mod: (s, b) => {
      if (b > up && b < down) s.air = jumpH * 4 * ((b - up) / (down - up)) * (1 - (b - up) / (down - up));
      return s;
    },
  });
}

// A freeze held two beats: weight on the right, left leg out on its toe, left arm to the sky.
{
  const F = { drop: 0.1, px: -0.07, roll: -4, lf: [0.46, 0.12, 30, 0, 55], lk: [0.3, -0.1, 0.8], rf: [0.17, 0.04, 12, 0, 0], sp: [-4, 8, 6], hd: [-14, 25, 4], la: [0.2, 0.37, 0.12, 0.35, 0, -0.3], ra: MIC };
  move('Show_Freeze', [[0, {}], [0.16, F, 'out'], [1.55, { ...F, drop: 0.09 }], [2, { ...STANCE, ra: MIC }]]);
}

// Side glide to his left (two beats, one cycle): the left foot steps out with an arm snap, the right slides in along the floor.
{
  const D = TABLE.moves.Show_GlideL.dx;
  const L0 = STANCE.lf[0],
    R0 = STANCE.rf[0];
  const step = L0 + D;
  const keys = [
    [0, { ra: MIC }],
    [0.22, { px: 0.07, drop: 0.05, lf: [L0 + 0.22, 0.08, 12, 0.07, 0], sp: [0, 6, -3], la: [0.2, -0.05, 0.2, 0.3, -0.2, -0.2] }],
    [0.42, { px: 0.2, drop: 0.08, lf: [step, 0.06, 14, 0, 0], sp: [2, 10, 3], hd: [-4, 24, 0], la: [0.4, 0.06, 0.1, 0.1, -0.3, -0.3] }, 'hit'],
    [0.95, { px: 0.28, drop: 0.07, rf: [R0, 0.06, 9, 0, 22], hd: [0, 18, 0] }],
    [1.6, { px: D, drop: 0.05, rf: [-(step - 0.3), 0.06, 9, 0, 6], sp: [0, 2, 0], hd: [0, 6, 0], la: BENT }],
    [2, { px: D, drop: 0.03, lf: [L0 + D, 0.06, 9, 0, 0], rf: [R0 - D, 0.06, 9, 0, 0], sp: [0, 0, 0], hd: [0, 0, 0] }],
  ];
  // (In the world frame: the travel comes out at a constant speed, so at the end the feet are back at the stance.)
  move('Show_GlideL', keys, { dx: D, mod: (s, b) => ((s.drop += 0.015 * bounce(b)), s) });
  move('Show_GlideR', keys.map(([b, p, e]) => [b, mirror(with_(STANCE, p)), e]), { dx: -D, mod: (s, b) => ((s.drop += 0.015 * bounce(b)), s) });
}

// A high front kick (right leg), then a step back down into a knee pop.
{
  move('Show_Kick', [
    [0, { ra: MIC }],
    [0.16, { px: 0.05, drop: 0.05, rf: [0.12, 0.25, 4, 0.4, 20], rk: [0.05, 0.5, 0.8], la: OUT, sp: [6, 0, 0] }],
    [0.34, { px: 0.06, drop: 0.04, pitch: -6, rf: [0.08, 0.66, 0, 1.0, 35], rk: [0.05, 0.6, 0.6], sp: [-6, 0, 0], hd: [6, 0, 0], la: [0.4, 0.12, 0.08, 0, -0.3, -0.3] }, 'hit'],
    [0.6, { px: 0.05, pitch: 0, rf: [0.12, 0.25, 4, 0.4, 20], rk: [0.05, 0.5, 0.8], sp: [4, 0, 0], hd: [0, 0, 0] }],
    [0.85, { px: 0.0, drop: 0.05, rf: [0.15, 0.06, 9, 0.05, 0], rk: STANCE.rk }],
    [1.0, { drop: 0.09, rf: [0.15, 0.06, 9, 0, 0], lf: [0.13, 0.08, 4, 0, 36], lk: [-0.15, -0.2, 0.8], px: -0.03, roll: -3, la: DIAG, sp: [6, -6, 2], hd: [8, 10, 0] }, 'hit'],
    [1.6, { drop: 0.08 }],
    [2, { ...STANCE, ra: MIC }],
  ]);
}

// Call and response: point out to the crowd, pump the fist up, then both arms up wide (mic and all), chin up.
{
  move('Show_Call', [
    [0, { ra: MIC }],
    [0.15, { pitch: 6, sp: [8, 10, 0], hd: [0, 14, 0], la: POINT, drop: 0.06 }, 'out'],
    [0.85, { drop: 0.05 }],
    [1.1, { pitch: 0, sp: [-2, 6, 0], hd: [-14, 10, 0], la: UP, drop: 0.08, lf: [0.15, 0.06, 9, 0, 0] }, 'out'],
    [1.5, { la: [0.08, 0.3, 0.05, 0.35, 0, -0.2], drop: 0.04 }],
    [1.75, { la: UP, drop: 0.08 }, 'hit'],
    [2.12, { sp: [-8, 0, 0], hd: [-22, 0, 0], la: UPV, ra: [-0.2, 0.35, 0.08, -0.3, 0, -0.3], lf: [0.2, 0.06, 12, 0, 18], rf: [0.2, 0.06, 12, 0, 18], drop: 0.0 }, 'out'],
    [2.6, { sp: [-8, 0, 5], drop: 0.02 }],
    [3.1, { sp: [-8, 0, -5], drop: 0.0 }],
    [3.55, { sp: [-6, 0, 0], lf: [0.15, 0.06, 9, 0, 0], rf: [0.15, 0.06, 9, 0, 0] }],
    [4, { ...STANCE, ra: MIC }],
  ]);
}

// The mic-stand trick (the client tilts the stand and puts his hands on it): lean back with it, let go with a hit, catch it.
{
  move('Show_StandTilt', [
    [0, {}],
    [0.6, { pitch: 8, sp: [6, 0, 0], drop: 0.05, la: [-0.02, -0.12, 0.38, 0.3, -0.3, 0], ra: [-0.1, 0.04, 0.38, 0.3, -0.3, 0] }],
    [1.8, { pitch: -4, roll: 6, px: 0.06, drop: 0.1, sp: [-4, 6, 4], hd: [-6, 8, 0], lf: [0.17, 0.02, 12, 0, 0] }],
    [2.12, { pitch: 0, roll: 0, px: 0, drop: 0.08, sp: [6, 0, 0], hd: [14, 0, 0], la: DIAG, ra: DIAG, sh: [6, 6] }, 'out'],
    [2.6, { la: BENT, sh: [0, 0], hd: [0, 0, 0], ra: [-0.1, 0.04, 0.38, 0.3, -0.3, 0], drop: 0.05, pitch: 5 }],
    [3.2, { pitch: 0, sp: [0, 0, 0], ra: MIC_LOW, lf: [0.15, 0.06, 9, 0, 0] }],
    [4, STANCE],
  ], { mod: (s, b) => ((s.drop += b > 2.6 ? 0.03 * bounce(b) : 0), s) });
}

// The final pose: gather low, then out into a lunge, the free arm thrust up, the mic hand out low, chin to the lights.
const FINAL = { drop: 0.21, px: 0.06, pz: 0.03, lf: [0.3, 0.36, 22, 0, 0], rf: [0.2, -0.3, 6, 0, 38], rk: [0.12, -0.5, 0.7], pitch: -3, sp: [-8, 10, 4], hd: [-22, 12, 0], la: UP, ra: [0.3, -0.24, 0.14, 0.2, -0.2, -0.3], sh: [6, 0] };
{
  const fin = move('Show_Final', [
    [0, { ra: MIC }],
    [0.45, { drop: 0.1, sp: [14, 0, 0], hd: [18, 0, 0], la: [-0.13, -0.33, 0.12, 0.3, -0.2, 0], ra: [-0.13, -0.33, 0.12, 0.3, -0.2, 0] }],
    [0.75, { drop: 0.12, lf: [0.22, 0.2, 14, 0.1, 0] }],
    [1.0, FINAL, 'hit'],
    [1.3, { drop: 0.23 }],
    [4, { drop: 0.22, hd: [-24, 14, 0] }],
  ]);
  // The bow, from the final pose: step back in, bow from the waist (mic hand to the belly, free arm out), up again.
  move('Show_Bow', [
    [0, {}],
    [0.35, { drop: 0.12, px: 0.03, lf: [0.22, 0.2, 14, 0.06, 0], rf: [0.17, -0.12, 8, 0.04, 10], sp: [0, 0, 0], hd: [0, 0, 0], la: HIP, ra: MIC_LOW, pitch: 0 }],
    [0.7, { ...STANCE, pz: 0, la: HIP, ra: MIC_LOW }],
    [1.4, { pitch: 14, sp: [34, 0, 0], hd: [10, 0, 0], drop: 0.05, la: [0.3, -0.25, -0.05, 0.3, 0, -0.3], ra: [-0.08, -0.2, 0.16, 0.35, -0.2, 0], pz: -0.04 }],
    [2.6, { pitch: 16, sp: [36, 0, 0] }],
    [3.4, { ...STANCE, la: HIP }],
    [4, STANCE],
  ], { from: fin });
}


// --- Her moves (electropop) -------------------------------------------------------------

// Sway at the stand: the hips swing side to side over two beats, a soft knee on each, the shoulders
// and head answering, the free arm loose with the swing, the mic low between lines.
move('Show_Sway', [[0, { ra: MIC_LOW }], [2, { ra: MIC_LOW }]], {
  mod: (s, b) => {
    const sw = Math.sin(Math.PI * b);
    s.drop += 0.02 + 0.02 * bounce(b);
    s.px += 0.05 * sw;
    s.roll += 4 * sw;
    s.sp = [s.sp[0] + 2 * bounce(b), s.sp[1] + 5 * sw, s.sp[2] - 7 * sw];
    s.hd = [s.hd[0] + 4 * bounce(b) - 2, s.hd[1] - 3 * sw, s.hd[2] + 6 * sw];
    s.la = add(add(s.la, 0, 0.05 * sw), 2, 0.05 * sw);
    s.sh = [4 * Math.max(0, sw), 4 * Math.max(0, -sw)];
    return s;
  },
});

// Hip roll: the hips circle (side, back, side, front) over two beats, a hand on the hip, the shoulders rolling against them.
move('Show_HipRoll', [[0, { la: HIP, ra: MIC_LOW }], [2, { la: HIP, ra: MIC_LOW }]], {
  mod: (s, b) => {
    const a = Math.PI * b;
    s.drop += 0.035 + 0.015 * bounce(b);
    s.px += 0.055 * Math.sin(a);
    s.pz += 0.03 * Math.cos(a);
    s.roll += 5 * Math.sin(a);
    s.pitch += 3 * Math.cos(a);
    s.sp = [s.sp[0] - 3 * Math.cos(a), s.sp[1] + 4 * Math.sin(a), s.sp[2] - 8 * Math.sin(a)];
    s.hd = [s.hd[0] + 3 * Math.cos(a), s.hd[1], s.hd[2] + 5 * Math.sin(a)];
    s.sh = [6 * Math.max(0, Math.cos(a)), 6 * Math.max(0, -Math.cos(a))];
    return s;
  },
});

// A hair flip: fold forward from the waist with a dip of the knees, the free hand sweeping through the hair,
// then whip up and back, chin high, and settle.
{
  const down = { drop: 0.12, pitch: 8, sp: [34, 0, 0], hd: [26, 0, 0], la: [0.05, 0.12, 0.2, 0.3, -0.1, -0.2], ra: MIC_LOW, lk: [0.14, -0.3, 0.8], rk: [0.14, -0.3, 0.8] };
  const up = { drop: 0.04, pitch: -4, sp: [-10, 8, 0], hd: [-24, 10, 4], la: [0.15, 0.36, -0.02, 0.35, 0, -0.3], ra: MIC, sh: [6, 2] };
  move('Show_HairFlip', [
    [0, { ra: MIC_LOW }],
    [0.9, down],
    [1.05, { ...down, drop: 0.13 }],
    [1.4, up, 'out'],
    [2.4, { ...up, drop: 0.06, hd: [-18, 6, 2] }],
    [3.3, { pitch: 0, sp: [0, 0, 0], hd: [0, 0, 0], la: BENT, sh: [0, 0], drop: 0.04 }],
    [4, { ...STANCE, ra: MIC_LOW }],
  ], { mod: (s, b) => ((s.drop += b > 2.4 ? 0.02 * bounce(b) : 0), s) });
}

// Arm wave: the free arm up overhead, waving side to side on each beat, the body swaying under it.
{
  const hi = (o) => [0.05 + o, 0.4, 0.05, 0.35, 0, -0.25];
  move('Show_ArmWave', [
    [0, { ra: MIC }],
    [0.3, { la: hi(0.18), sp: [-4, 0, -6], hd: [-10, 0, -4] }, 'out'],
    [1, { la: hi(-0.12), sp: [-4, 0, 6], hd: [-10, 0, 4] }],
    [2, { la: hi(0.18), sp: [-4, 0, -6], hd: [-10, 0, -4] }],
    [3, { la: hi(-0.12), sp: [-4, 0, 6], hd: [-10, 0, 4] }],
    [3.6, { la: hi(0.1), sp: [-2, 0, 0], hd: [-4, 0, 0] }],
    [4, { ...STANCE, ra: MIC }],
  ], {
    mod: (s, b) => {
      const sw = Math.sin(Math.PI * b);
      s.drop += 0.03 * bounce(b);
      s.px += 0.04 * sw;
      s.roll += 3 * sw;
      return s;
    },
  });
}

// Arm sweep: the free arm from across the body, out over the crowd in a wide arc, the body turning with it, and back.
move('Show_Sweep', [
  [0, { ra: MIC }],
  [0.5, { yaw: -18, sp: [6, -10, 0], hd: [4, -12, 0], la: CHEST, drop: 0.07 }],
  [2.0, { yaw: 22, sp: [-4, 16, 4], hd: [-10, 24, 0], la: [0.42, 0.12, 0.12, 0.2, -0.3, -0.3], drop: 0.04 }, 'smooth'],
  [2.6, { la: [0.32, 0.32, 0.08, 0.3, 0, -0.3], hd: [-16, 20, 0] }],
  [3.5, { yaw: 0, sp: [0, 0, 0], hd: [0, 0, 0], la: BENT, drop: 0.05 }],
  [4, { ...STANCE, ra: MIC }],
], { mod: (s, b) => ((s.drop += 0.02 * bounce(b)), s) });

// The big pose on the drop: a hit into a wide stance, both arms up in a V (the mic held high), chin to the lights, held.
{
  const P = { drop: 0.1, lf: [0.26, 0.05, 14, 0, 0], rf: [0.26, 0.05, 14, 0, 0], sp: [-8, 0, 0], hd: [-20, 6, 0], la: UPV, ra: [0.24, 0.35, 0.06, 0.35, 0, -0.3], sh: [6, 6] };
  move('Show_Pose', [
    [0, { ra: MIC }],
    [0.15, P, 'hit'],
    [0.5, { ...P, drop: 0.12 }],
    [3.2, { ...P, drop: 0.09, hd: [-16, 10, 0] }],
    [3.7, { lf: [0.18, 0.06, 10, 0.04, 0], rf: [0.18, 0.06, 10, 0.04, 0], la: BENT, ra: MIC, sp: [0, 0, 0], hd: [0, 0, 0], sh: [0, 0], drop: 0.05 }],
    [4, { ...STANCE, ra: MIC }],
  ]);
}


// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

async function write() {
  const { Document } = await import('@gltf-transform/core');
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene();
  const nodes = new Map();
  const make = (o, parent) => {
    const n = doc.createNode(o.name).setTranslation(restLocal.get(o.name).p.toArray()).setRotation(restLocal.get(o.name).q.toArray());
    nodes.set(o.name, n);
    if (parent) parent.addChild(n);
    else scene.addChild(n);
    for (const c of o.children) make(c, n);
  };
  make(B('CharacterArmature'), null);
  for (const c of clips) {
    const anim = doc.createAnimation(c.name);
    const times = new Float32Array(c.frames.length).map((_, i) => i / FPS);
    const input = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buf);
    for (const n of BONES) {
      const q = new Float32Array(c.frames.length * 4);
      c.frames.forEach((f, i) => {
        // Keep neighbouring keys on the same hemisphere (clean slerps).
        if (i > 0) {
          const prev = new THREE.Quaternion().fromArray(q, (i - 1) * 4);
          if (prev.dot(f[n].q) < 0) f[n].q.set(-f[n].q.x, -f[n].q.y, -f[n].q.z, -f[n].q.w);
        }
        f[n].q.toArray(q, i * 4);
      });
      const s = doc.createAnimationSampler().setInput(input).setOutput(doc.createAccessor().setType('VEC4').setArray(q).setBuffer(buf)).setInterpolation('LINEAR');
      anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(nodes.get(n)).setTargetPath('rotation').setSampler(s));
      if (MOVED.includes(n)) {
        const p = new Float32Array(c.frames.length * 3);
        c.frames.forEach((f, i) => f[n].p.toArray(p, i * 3));
        const s2 = doc.createAnimationSampler().setInput(input).setOutput(doc.createAccessor().setType('VEC3').setArray(p).setBuffer(buf)).setInterpolation('LINEAR');
        anim.addSampler(s2).addChannel(doc.createAnimationChannel().setTargetNode(nodes.get(n)).setTargetPath('translation').setSampler(s2));
      }
    }
  }
  await doc.transform(quantize(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await io.write(OUT_FILE, doc);
}
await write();
console.log('show clips', clips.map((c) => `${c.name} ${((c.frames.length - 1) / FPS).toFixed(2)}s`).join(', '));
