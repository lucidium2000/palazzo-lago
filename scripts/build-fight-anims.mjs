// Builds the fighting animations for the casino's people: public/assets/people/fight.glb.
//
//  - Boxing moves from Quaternius' "Universal Animation Library" (CC0; trimmed
//    copy in art/source/anims/ual_standard.glb): the guard, jab, cross, head and
//    body hits and the knockdown, retargeted onto the "Ultimate Modular" rig the
//    people use (art/source/people/male_suit.glb). Every bone takes the source
//    bone's rotation away from its T-pose; legs are re-solved so the feet land
//    where the source's feet do (scaled to our people's legs).
//  - Moves the library doesn't have, hand-authored here as key poses on the
//    same rig: a hook, a high block, a stagger, footwork, lying knocked out, and
//    the groggy get-up (roll onto the side, hands and knees, one foot planted,
//    stand, wobble).
//  - Every frame is sampled at 30 fps and dropped onto the floor: the lowest
//    point of the skinned body sits at y = 0 (no floating, no sinking).
// Clips are named Box_*; the client blends them through each person's mixer.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { treeOf, sampleAnim, animLength, wq, wp, setWorldQ, rotWorld, aimAt, twoBone } from './fightrig.mjs';

const FPS = 30;
const SRC = 'art/source/anims/ual_standard.glb';
const RIG = 'art/source/people/male_suit.glb';
const OUT = 'public/assets/people/fight.glb';

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Q = (axis, deg) => new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), THREE.MathUtils.degToRad(deg));
const X = V(1, 0, 0),
  Y = V(0, 1, 0),
  Z = V(0, 0, 1);

// ---------------------------------------------------------------------------
// The two rigs
// ---------------------------------------------------------------------------

const srcDoc = await io.read(SRC);
const S = treeOf(srcDoc);
const srcAnim = (name) => srcDoc.getRoot().listAnimations().find((a) => a.getName() === name);

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

// The rig's own node rest (its first clip frame), which the client keeps for bones no clip moves.
const restLocal = new Map();
for (const o of T.byName.values()) restLocal.set(o.name, { p: o.position.clone(), q: o.quaternion.clone() });

/** Bones the clips drive (rotation): everything with a parent joint, except the IK pole targets. */
const BONES = joints.map((o) => o.name).filter((n) => !/^PT\./.test(n) && n !== 'Root');
const MOVED = ['Body', 'Foot.L', 'Foot.R'];

/** Puts the target rig in its bind (T) pose. */
function bindPose() {
  for (const n of BONES) {
    const o = B(n);
    const pw = o.parent.matrixWorld.clone();
    const l = pw.invert().multiply(bindWorld.get(n));
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

// Source T-pose (its A_TPose clip).
sampleAnim(S, srcAnim('A_TPose'), 0);
const srcRest = new Map();
for (const o of S.byName.values()) srcRest.set(o.name, { q: wq(o), p: wp(o) });

const MAP = {
  'DEF-hips': 'Body',
  'DEF-spine.001': 'Abdomen',
  'DEF-spine.002': 'Torso',
  'DEF-spine.003': 'Chest',
  'DEF-neck': 'Neck',
  'DEF-head': 'Head',
};
for (const s of ['L', 'R']) {
  Object.assign(MAP, {
    [`DEF-shoulder.${s}`]: `Shoulder.${s}`,
    [`DEF-upper_arm.${s}`]: `UpperArm.${s}`,
    [`DEF-forearm.${s}`]: `LowerArm.${s}`,
    [`DEF-hand.${s}`]: `Wrist.${s}`,
    [`DEF-thigh.${s}`]: `UpperLeg.${s}`,
    [`DEF-shin.${s}`]: `LowerLeg.${s}`,
    [`DEF-foot.${s}`]: `Foot.${s}`,
  });
  for (const f of ['index', 'middle', 'ring', 'pinky']) {
    const F = f[0].toUpperCase() + f.slice(1);
    for (let k = 1; k <= 3; k++) MAP[`DEF-f_${f}.0${k}.${s}`] = `${F}${k + 1}.${s}`;
  }
  for (let k = 1; k <= 3; k++) MAP[`DEF-thumb.0${k}.${s}`] = `Thumb${k}.${s}`;
}
// Bones whose T-pose direction is lined up with the source's (arms, hands, fingers): which child to aim along.
const AIM = {};
for (const s of ['L', 'R']) {
  AIM[`Shoulder.${s}`] = [`UpperArm.${s}`, `DEF-upper_arm.${s}`];
  AIM[`UpperArm.${s}`] = [`LowerArm.${s}`, `DEF-forearm.${s}`];
  AIM[`LowerArm.${s}`] = [`Wrist.${s}`, `DEF-hand.${s}`];
  AIM[`Wrist.${s}`] = [`Middle2.${s}`, `DEF-f_middle.01.${s}`];
}
/** Per target bone: the world rotation that takes its T-pose to the source's T-pose. */
const align = new Map();
for (const [sn, tn] of Object.entries(MAP)) {
  if (!S.byName.has(sn) || !T.byName.has(tn)) continue;
  let a = new THREE.Quaternion();
  const aim = AIM[tn];
  if (aim && S.byName.has(aim[1])) {
    const td = bindP(aim[0]).sub(bindP(tn)).normalize();
    const sd = srcRest.get(aim[1]).p.clone().sub(srcRest.get(sn).p).normalize();
    a = new THREE.Quaternion().setFromUnitVectors(td, sd);
  }
  align.set(tn, a);
}

// Sizes: the source's legs vs ours.
const legT = bindP('UpperLeg.L').distanceTo(bindP('LowerLeg.L')) + bindP('LowerLeg.L').distanceTo(bindP('Foot.L'));
const legS = srcRest.get('DEF-thigh.L').p.distanceTo(srcRest.get('DEF-shin.L').p) + srcRest.get('DEF-shin.L').p.distanceTo(srcRest.get('DEF-foot.L').p);
const SCALE = legT / legS;
// Where our foot bone (on the floor under the ankle) sits on the source's foot, in its rest frame.
const footOnSrc = {};
// Where our foot point sits in the shin's frame (it hangs off the root, not the shin).
const footInShin = {};
bindPose();
for (const s of ['L', 'R']) {
  const sr = srcRest.get(`DEF-foot.${s}`);
  const fp = bindP(`Foot.${s}`).divideScalar(SCALE);
  const pt = V(sr.p.x, fp.y, sr.p.z);
  footOnSrc[s] = pt.sub(sr.p).applyQuaternion(sr.q.clone().invert());
  footInShin[s] = B(`LowerLeg.${s}`).worldToLocal(bindP(`Foot.${s}`));
}
const bodyOff = bindP('Body').sub(srcRest.get('DEF-hips').p.clone().multiplyScalar(SCALE));

// ---------------------------------------------------------------------------
// Skinned body (for the floor contact)
// ---------------------------------------------------------------------------

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
      for (let i = 0; i < P.getCount(); i += 3) {
        const p = P.getElement(i, []),
          j = J.getElement(i, []),
          w = W.getElement(i, []);
        verts.push({ p: V(...p), j: j.map((x) => jIndex.get(x)), w });
      }
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
/** Drops (or lifts) the whole body so its lowest point is on the floor. */
function toFloor() {
  const lo = lowest();
  for (const n of MOVED) B(n).position.y -= lo;
  T.root.updateMatrixWorld(true);
}

// ---------------------------------------------------------------------------
// Poses
// ---------------------------------------------------------------------------

/** The rig's current pose (locals of every driven bone). */
function snap() {
  const o = {};
  for (const n of BONES) o[n] = { q: B(n).quaternion.clone(), p: B(n).position.clone() };
  return o;
}
function apply(pose) {
  for (const n of BONES) {
    if (!pose[n]) continue;
    B(n).quaternion.copy(pose[n].q);
    if (MOVED.includes(n)) B(n).position.copy(pose[n].p);
  }
  T.root.updateMatrixWorld(true);
}
/** Blend between poses: quaternions slerp, the root and feet move straight. */
function mix(a, b, f) {
  const o = {};
  for (const n of BONES) o[n] = { q: a[n].q.clone().slerp(b[n].q, f), p: a[n].p.clone().lerp(b[n].p, f) };
  return o;
}

/** A source clip frame on our rig. */
function retarget(anim, t) {
  sampleAnim(S, anim, t);
  bindPose();
  // Rotations, parents first (Object.values keeps the hierarchy order: hips, spine, arms, legs).
  for (const [sn, tn] of Object.entries(MAP)) {
    const so = S.byName.get(sn),
      to = B(tn);
    if (!so || !to) continue;
    const rest = srcRest.get(sn).q;
    const q = wq(so).multiply(rest.clone().invert()).multiply(align.get(tn)).multiply(bindQ(tn));
    if (tn === 'Body') {
      const p = wp(so).multiplyScalar(SCALE).add(bodyOff);
      to.position.copy(to.parent.worldToLocal(p));
    }
    setWorldQ(to, q);
  }
  // Legs: the feet where the source's are.
  for (const s of ['L', 'R']) {
    const sf = S.byName.get(`DEF-foot.${s}`);
    const target = footOnSrc[s].clone().applyQuaternion(wq(sf)).add(wp(sf)).multiplyScalar(SCALE);
    const foot = B(`Foot.${s}`);
    const fq = wq(foot);
    legTo(s, target);
    setWorldQ(foot, fq);
  }
  return snap();
}

/** Solves a leg so its foot point is at `target` (knee where it already points), and moves the foot bone there. */
function legTo(s, target, pole) {
  const up = B(`UpperLeg.${s}`),
    lo = B(`LowerLeg.${s}`);
  const knee = wp(lo);
  const hip = wp(up);
  let off = knee.clone().sub(hip.clone().lerp(target, 0.5));
  if (off.lengthSq() < 1e-5) off = V(0, 0, 1).applyQuaternion(wq(B('Body')).multiply(bindQ('Body').invert()));
  const kneePole = pole ?? knee.clone().addScaledVector(off.normalize(), 0.5);
  const at = twoBone(up, lo, footInShin[s], target, kneePole);
  const foot = B(`Foot.${s}`);
  foot.position.copy(foot.parent.worldToLocal(at));
  foot.updateMatrixWorld(true);
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

/** Frames → a clip. `floor`: drop each frame onto the floor. */
function clipOf(name, frames, floor = true) {
  const out = [];
  for (const f of frames) {
    apply(f);
    if (floor) toFloor();
    out.push(snap());
  }
  return { name, frames: out };
}
/** A stretch of a source clip, retimed: [srcFrom, srcTo] played over `dur` seconds. */
function srcFrames(name, from, to, dur, ease = (x) => x) {
  const a = srcAnim(name);
  const end = Math.min(to, animLength(a));
  const n = Math.max(1, Math.round(dur * FPS));
  const fr = [];
  for (let i = 0; i <= n; i++) fr.push(retarget(a, from + (end - from) * ease(i / n)));
  return fr;
}

// ---------------------------------------------------------------------------
// Authoring helpers (all offline: every pose is checked by eye in the contact sheets)
// ---------------------------------------------------------------------------

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => {
  x = clamp01(x);
  return x * x * (3 - 2 * x);
};
const rad = THREE.MathUtils.degToRad;
/** Rotation from yaw / pitch / roll in degrees (anatomical: x = pitch forward, y = turn left, z = lean right… as the T-pose axes). */
const E = (x, y = 0, z = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(x), rad(y), rad(z), 'YXZ'));
/** A bone's anatomical frame: its rotation away from the T-pose (where +X is the body's left, +Y up, +Z forward). */
const frameOf = (n) => wq(B(n)).multiply(bindQ(n).invert());
const turn = (n, axis, deg) => rotWorld(B(n), Q(axis, deg));
/** Sets a bone's rotation relative to its parent, anatomically (degrees). */
function bend(n, x, y = 0, z = 0) {
  setWorldQ(B(n), frameOf(B(n).parent.name).multiply(E(x, y, z)).multiply(bindQ(n)));
}
const tipOf = (n) => {
  if (n.startsWith('UpperArm')) return wp(B(n.replace('Upper', 'Lower')));
  if (n.startsWith('LowerArm')) return wp(B(n.replace('LowerArm', 'Wrist')));
  if (n.startsWith('Wrist')) return wp(B(n.replace('Wrist', 'Middle2')));
  if (n.startsWith('UpperLeg')) return wp(B(n.replace('Upper', 'Lower')));
  if (n.startsWith('LowerLeg')) return B(n).localToWorld(footInShin[n.slice(-1)].clone());
  if (n.startsWith('Shoulder')) return wp(B(n.replace('Shoulder', 'UpperArm')));
  throw new Error(n);
};
/** Points a limb bone along a world direction (shortest turn from where it points now). */
const aim = (n, dir) => aimAt(B(n), tipOf(n), dir.clone().normalize());
/** Twists a bone about its own length so its anatomical `local` direction (T-pose axes) faces `want` (world) as nearly as it can. */
function twist(n, local, want) {
  const axis = tipOf(n).sub(wp(B(n))).normalize();
  const cur = local.clone().applyQuaternion(frameOf(n));
  const a = cur.addScaledVector(axis, -cur.dot(axis)).normalize();
  const b = want.clone().addScaledVector(axis, -want.dot(axis)).normalize();
  let ang = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
  if (new THREE.Vector3().crossVectors(a, b).dot(axis) < 0) ang = -ang;
  rotWorld(B(n), new THREE.Quaternion().setFromAxisAngle(axis, ang));
}
/** The foot follows the shin as if the ankle were stiff (lying, kneeling). */
function rigidFoot(s, point = 0) {
  const lo = B(`LowerLeg.${s}`),
    f = B(`Foot.${s}`);
  const rel = bindQ(`LowerLeg.${s}`).invert().multiply(bindQ(`Foot.${s}`));
  const at = lo.localToWorld(footInShin[s].clone());
  let q = wq(lo).multiply(rel);
  if (point) {
    // Toes pointed (the top of the foot toward the floor), turning about the ankle.
    const shin = at.clone().sub(wp(lo)).normalize();
    const ankle = at.clone().addScaledVector(shin, -0.075);
    const r = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0).applyQuaternion(frameOf(lo.name)), THREE.MathUtils.degToRad(point));
    at.sub(ankle).applyQuaternion(r).add(ankle);
    q = r.multiply(q);
  }
  f.position.copy(f.parent.worldToLocal(at));
  f.updateMatrixWorld(true);
  setWorldQ(f, q);
}
function feetNow() {
  return ['L', 'R'].map((s) => ({ s, p: wp(B(`Foot.${s}`)), q: wq(B(`Foot.${s}`)) }));
}
/** Re-solves the legs so the feet are where they were (after moving the hips). */
function replant(feet, offset = {}) {
  T.root.updateMatrixWorld(true);
  for (const f of feet) {
    legTo(f.s, f.p.clone().add(offset[f.s] ?? V(0, 0, 0)));
    setWorldQ(B(`Foot.${f.s}`), f.q);
  }
}
function moveBody(d) {
  B('Body').position.add(d);
  T.root.updateMatrixWorld(true);
}
/** Points an arm: the wrist at `fist` (world), the elbow toward `pole`. */
function armTo(s, fist, pole) {
  twoBone(B(`UpperArm.${s}`), B(`LowerArm.${s}`), B(`Wrist.${s}`).position.clone(), fist, pole);
}
const sgn = (s) => (s === 'L' ? 1 : -1);
/** A clip from key poses: [time, pose] pairs, eased between, sampled at FPS (with an optional per-frame touch-up). */
function keyed(keys, touch) {
  const dur = keys[keys.length - 1][0];
  const fr = [];
  for (let i = 0, n = Math.round(dur * FPS); i <= n; i++) {
    const t = i / FPS;
    let k = 0;
    while (k < keys.length - 2 && keys[k + 1][0] <= t) k++;
    const [t0, a] = keys[k],
      [t1, b] = keys[k + 1];
    apply(mix(a, b, ease((t - t0) / Math.max(1e-6, t1 - t0))));
    if (touch) touch(t);
    fr.push(snap());
  }
  return fr;
}
const pose = (fn) => {
  fn();
  T.root.updateMatrixWorld(true);
  return snap();
};

// ---------------------------------------------------------------------------
// The guard and footwork
// ---------------------------------------------------------------------------

const jabA = srcAnim('Punch_Jab'),
  crossA = srcAnim('Punch_Cross');
apply(retarget(jabA, 0));
toFloor();
const G = snap();
apply(G);
const gHead = wp(B('Head'));
const gFist = { L: wp(B('Wrist.L')), R: wp(B('Wrist.R')) };
const gFeet = feetNow();
const lead = gFeet[0].p.z > gFeet[1].p.z ? 'L' : 'R';
console.log('guard: lead foot', lead, 'head', gHead.toArray().map((v) => +v.toFixed(2)));

const clips = [];
const GUARD_T = 1.2;
clips.push(
  clipOf(
    'Box_Guard',
    keyed([[0, G], [GUARD_T, G]], (t) => {
      const ph = (2 * Math.PI * t) / GUARD_T;
      const feet = feetNow();
      moveBody(V(0.012 * Math.sin(ph), -0.018 * (0.5 - 0.5 * Math.cos(2 * ph)), 0.006 * Math.sin(2 * ph)));
      replant(feet);
      turn('Torso', Y, 2.5 * Math.sin(ph));
      turn('Head', X, 2 * Math.sin(2 * ph + 1));
    }),
  ),
);

/** In-place shuffle: each foot planted (sliding back under the moving body) then a quick low step. */
function shuffle(name, dir, first, P, v0) {
  const sw = 0.3 * P,
    stance = P - sw,
    A = (v0 * stance) / 2;
  const startOf = { [first]: 0, [first === 'L' ? 'R' : 'L']: P * 0.5 };
  return clipOf(
    name,
    keyed([[0, G], [P, G]], (t) => {
      const feet = feetNow();
      moveBody(V(0, -0.012 * (0.5 - 0.5 * Math.cos((4 * Math.PI * t) / P)), 0));
      const off = {};
      for (const s of ['L', 'R']) {
        const u = (((t - startOf[s]) % P) + P) % P;
        let o, lift;
        if (u < sw) {
          const f = u / sw;
          o = -A + 2 * A * ease(f);
          lift = 0.035 * Math.sin(Math.PI * f);
        } else {
          o = A - (2 * A * (u - sw)) / stance;
          lift = 0;
        }
        off[s] = dir.clone().multiplyScalar(o).add(V(0, lift, 0));
      }
      replant(feet, off);
    }),
  );
}
export const SHUFFLE = { P: 0.5, v: 0.5 };
clips.push(shuffle('Box_Shuffle', V(0, 0, 1), lead, SHUFFLE.P, SHUFFLE.v));
clips.push(shuffle('Box_Side', V(1, 0, 0), 'L', SHUFFLE.P, SHUFFLE.v));

// ---------------------------------------------------------------------------
// Punches (upper body: the legs keep doing the footwork)
// ---------------------------------------------------------------------------

const WIND = 0.7,
  STRIKE = 0.2,
  RECOVER = 0.55;
/** When a source punch starts moving and when the fist is furthest out. */
function timing(anim, s) {
  const len = animLength(anim);
  let best = 0,
    bz = -Infinity,
    start = 0;
  const z0 = (apply(retarget(anim, 0)), wp(B(`Wrist.${s}`)).z);
  for (let t = 0; t <= Math.min(0.7, len); t += 1 / 60) {
    apply(retarget(anim, t));
    const z = wp(B(`Wrist.${s}`)).z;
    if (!start && z > z0 + 0.03) start = Math.max(0, t - 1 / 30);
    if (z > bz) (bz = z), (best = t);
  }
  return { start, peak: best, end: len };
}
/** The body-shot version: knees and waist bend, the punch goes in lower. */
function low(s, w) {
  if (w <= 0) return;
  turn('Abdomen', X, 12 * w);
  turn('Chest', X, 6 * w);
  turn('Head', X, -8 * w);
  const sh = wp(B(`UpperArm.${s}`));
  const side = V(1, 0, 0);
  rotWorld(B(`UpperArm.${s}`), Q(side, 16 * w));
  void sh;
}
function punch(name, anim, s, body, load) {
  const tm = timing(anim, s);
  // The tell: shoulders turn away, the throwing fist drops back.
  const W = pose(() => {
    apply(G);
    turn('Torso', Y, load * sgn(s));
    turn('Abdomen', X, 5);
    const f = gFist[s].clone().add(V(sgn(s) * 0.03, -0.04, -0.1));
    armTo(s, f, wp(B(`LowerArm.${s}`)).add(V(sgn(s) * 0.15, -0.25, -0.15)));
    if (body) low(s, 0.6);
  });
  const fr = [];
  const total = WIND + STRIKE + RECOVER;
  for (let i = 0, n = Math.round(total * FPS); i <= n; i++) {
    const t = i / FPS;
    let p;
    if (t <= WIND) p = mix(G, W, ease(t / (WIND * 0.6)));
    else if (t <= WIND + STRIKE) {
      const u = (t - WIND) / STRIKE;
      const src = retarget(anim, tm.start + (tm.peak - tm.start) * u);
      apply(src);
      if (body) low(s, 0.6 + 0.4 * u);
      p = mix(W, snap(), clamp01(u * 1.7));
    } else {
      const u = (t - WIND - STRIKE) / RECOVER;
      apply(retarget(anim, tm.peak + (tm.end - tm.peak) * u));
      if (body) low(s, 1 - ease(u * 1.5));
      p = mix(snap(), G, ease((u - 0.5) / 0.5));
    }
    fr.push(p);
  }
  apply(fr[Math.round((WIND + STRIKE) * FPS)]);
  console.log(name, 'fist at impact', wp(B(`Wrist.${s}`)).toArray().map((v) => +v.toFixed(2)).join(','));
  return { name, frames: fr, part: 'upper' };
}
export const PUNCH = { windup: WIND, strike: STRIKE, recover: RECOVER };
clips.push(punch('Box_Jab', jabA, 'L', false, 12));
clips.push(punch('Box_Cross', crossA, 'R', false, 20));
clips.push(punch('Box_JabBody', jabA, 'L', true, 12));
clips.push(punch('Box_CrossBody', crossA, 'R', true, 20));

// Left hook: load on the lead side, then the hips and shoulders turn through with the elbow up, forearm level.
{
  const W = pose(() => {
    apply(G);
    turn('Torso', Y, 14);
    turn('Abdomen', Z, -5);
    armTo('L', gFist.L.clone().add(V(0.05, -0.05, -0.04)), wp(B('LowerArm.L')).add(V(0.2, -0.2, -0.1)));
  });
  const hit = (yaw, across) =>
    pose(() => {
      apply(G);
      turn('Abdomen', Y, -yaw * 0.35);
      turn('Torso', Y, -yaw * 0.65);
      const sh = wp(B('UpperArm.L'));
      const fist = V(gHead.x - across, sh.y + 0.02, gHead.z + 0.36);
      armTo('L', fist, sh.clone().add(V(0.6, 0.12, -0.05)));
      // The fist turns over (knuckles forward, palm down).
      twist('LowerArm.L', V(0, -1, 0), V(0, -1, 0));
    });
  const I = hit(40, 0.02),
    F = hit(52, 0.16);
  const fr = keyed([[0, G], [WIND * 0.6, W], [WIND, W], [WIND + STRIKE * 0.75, I], [WIND + STRIKE + 0.1, F], [WIND + STRIKE + RECOVER, G]]);
  apply(I);
  console.log('Box_Hook fist at impact', wp(B('Wrist.L')).toArray().map((v) => +v.toFixed(2)).join(','));
  clips.push({ name: 'Box_Hook', frames: fr, part: 'upper' });
}

// ---------------------------------------------------------------------------
// Block and hit reactions (upper body)
// ---------------------------------------------------------------------------

const BLOCK = pose(() => {
  apply(G);
  turn('Abdomen', X, 6);
  turn('Neck', X, 8);
  turn('Head', X, 8);
  const h = wp(B('Head'));
  for (const s of ['L', 'R']) armTo(s, h.clone().add(V(sgn(s) * 0.07, 0.05, 0.14)), h.clone().add(V(sgn(s) * 0.2, -0.5, 0.25)));
});
clips.push({ name: 'Box_Block', frames: keyed([[0, BLOCK], [0.5, BLOCK]]), part: 'upper' });

function reaction(name, dur, peak, fn) {
  const fr = keyed([[0, G], [dur, G]], (t) => {
    const w = t < peak ? ease(t / peak) : 1 - ease((t - peak * 1.6) / (dur - peak * 1.6));
    fn(w, t);
  });
  return { name, frames: fr, part: 'upper' };
}
clips.push(
  reaction('Box_HitHead', 0.55, 0.07, (w) => {
    turn('Abdomen', X, -4 * w);
    turn('Chest', X, -8 * w);
    turn('Torso', Y, 7 * w);
    turn('Neck', X, -14 * w);
    turn('Head', X, -16 * w);
    turn('Head', Y, 10 * w);
    for (const s of ['L', 'R']) armTo(s, wp(B(`Wrist.${s}`)).add(V(sgn(s) * 0.04 * w, -0.08 * w, -0.02 * w)), wp(B(`LowerArm.${s}`)).add(V(sgn(s) * 0.1, -0.3, 0)));
  }),
);
clips.push(
  reaction('Box_HitBody', 0.6, 0.09, (w) => {
    turn('Abdomen', X, 14 * w);
    turn('Chest', X, 9 * w);
    turn('Head', X, 8 * w);
    for (const s of ['L', 'R']) armTo(s, wp(B(`Wrist.${s}`)).add(V(-sgn(s) * 0.02 * w, -0.13 * w, -0.03 * w)), wp(B(`LowerArm.${s}`)).add(V(sgn(s) * 0.05, -0.3, 0)));
  }),
);

// ---------------------------------------------------------------------------
// Stagger (whole body): rocked back, guard broken, two stumbling steps back.
// The client moves them back by STAGGER.back over the same time (root motion in the game).
// ---------------------------------------------------------------------------

export const STAGGER = { dur: 0.9, back: 0.22, from: 0.05, to: 0.4 };
{
  const rootZ = (t) => -STAGGER.back * ease((t - STAGGER.from) / (STAGGER.to - STAGGER.from));
  const rear = lead === 'L' ? 'R' : 'L';
  const fr = keyed([[0, G], [STAGGER.dur, G]], (t) => {
    const w = t < 0.1 ? ease(t / 0.1) : 1 - ease((t - 0.42) / 0.45);
    const feet = feetNow();
    const pelvis = -STAGGER.back * ease((t - 0.02) / 0.3) - rootZ(t);
    moveBody(V(0, -0.06 * Math.sin(Math.PI * clamp01(t / 0.8)), pelvis - 0.03 * w));
    const step = (t0, t1, d) => {
      const f = (t - t0) / (t1 - t0);
      return V(0, f > 0 && f < 1 ? 0.04 * Math.sin(Math.PI * f) : 0, -d * ease(f) - rootZ(t));
    };
    replant(feet, { [rear]: step(0.08, 0.26, STAGGER.back), [lead]: step(0.22, 0.42, STAGGER.back) });
    turn('Abdomen', X, -6 * w);
    turn('Chest', X, -10 * w);
    turn('Neck', X, -14 * w);
    turn('Head', X, -16 * w);
    turn('Torso', Y, 9 * w);
    for (const s of ['L', 'R']) armTo(s, wp(B(`Wrist.${s}`)).add(V(sgn(s) * 0.14 * w, -0.25 * w, 0.04 * w)), wp(B(`LowerArm.${s}`)).add(V(sgn(s) * 0.3, -0.2, 0.1)));
  });
  clips.push(clipOf('Box_Stagger', fr));
}

// ---------------------------------------------------------------------------
// Knocked out: the knees go, they fall back and lie flat
// ---------------------------------------------------------------------------

export const KO = { fall: 2.0 };
const ko = clipOf('Box_KO', srcFrames('Death01', 0, animLength(srcAnim('Death01')), KO.fall));
clips.push(ko);
const L = ko.frames[ko.frames.length - 1];
clips.push(
  clipOf(
    'Box_Lie',
    keyed([[0, L], [2.4, L]], (t) => {
      const b = Math.sin((2 * Math.PI * t) / 2.4);
      turn('Chest', X, -1.5 * b);
      turn('Head', Z, 2 * Math.sin((2 * Math.PI * t) / 2.4 + 1));
    }),
  ),
);

// ---------------------------------------------------------------------------
// The get-up: roll onto the side, push up onto hands and knees, sway there,
// plant a foot, push up to standing, wobble, shake it off. They end up facing
// back the way their head was (the client turns them round when it ends).
// ---------------------------------------------------------------------------

apply(L);
const lPelvis = wp(B('Body'));
console.log('lying pelvis', lPelvis.toArray().map((v) => +v.toFixed(2)));
const basis = (x, y, z) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
/** Starts a pose from the T-pose with the pelvis at `at` and the body's axes (left, up, forward) given in world. */
function body(at, q) {
  bindPose();
  const b = B('Body');
  b.position.copy(b.parent.worldToLocal(at.clone()));
  b.updateMatrixWorld(true);
  setWorldQ(b, q.clone().multiply(bindQ('Body')));
}
// Facing: -Z when they're up (their head lay toward -Z).
const back = -1;
/** Their left and their forward once they're up. */
const LEFT = V(-1, 0, 0),
  FWD = V(0, 0, back);
const side = (s, k) => LEFT.clone().multiplyScalar(sgn(s) * k);
/** Knees forward and a little out (for legs solved from a straight start). */
const kneePole = (s) => wp(B(`UpperLeg.${s}`)).add(FWD.clone().multiplyScalar(0.8)).add(side(s, 0.15)).add(V(0, -0.3, 0));
const K0 = pose(() => {
  // Still on the back: the arms come in to the sides, a knee comes up (getting ready to roll).
  apply(L);
  for (const s of ['L', 'R']) {
    aim(`UpperArm.${s}`, V(sgn(s) * 0.35, -0.05, 1));
    aim(`LowerArm.${s}`, V(sgn(s) * 0.15, 0.1, 1));
  }
  aim('UpperLeg.R', V(-0.05, 0.55, 1));
  aim('LowerLeg.R', V(0, -0.75, 1));
  rigidFoot('R', 10);
  bend('Neck', 12);
});
const K1 = pose(() => {
  // On the left side, knees drawn up, the top arm reaching over to the floor.
  body(lPelvis.clone().add(V(0.05, 0, 0.05)), basis(V(0, -1, 0), V(0, 0, back), V(1, 0, 0)));
  bend('Abdomen', 8);
  bend('Torso', 8);
  bend('Chest', 4);
  bend('Neck', 10, 0, -8);
  bend('Head', 5);
  const fwd = V(1, 0, 0),
    down = V(0, -1, 0),
    head = V(0, 0, back);
  aim('UpperLeg.L', fwd.clone().multiplyScalar(0.6).addScaledVector(head, -0.8));
  aim('LowerLeg.L', fwd.clone().multiplyScalar(-0.3).addScaledVector(head, -1));
  aim('UpperLeg.R', fwd.clone().multiplyScalar(0.8).addScaledVector(head, -0.6).addScaledVector(down, -0.1));
  aim('LowerLeg.R', fwd.clone().multiplyScalar(-0.2).addScaledVector(head, -1));
  rigidFoot('L');
  rigidFoot('R');
  // Bottom arm along the body, top arm over with the hand flat on the floor by the chest.
  aim('UpperArm.L', fwd.clone().multiplyScalar(0.45).addScaledVector(head, -1));
  aim('LowerArm.L', fwd.clone().multiplyScalar(0.9).addScaledVector(head, -0.5));
  aim('UpperArm.R', fwd.clone().addScaledVector(down, 0.2));
  aim('LowerArm.R', down.clone().addScaledVector(fwd, 0.6));
  aim('Wrist.R', fwd.clone().addScaledVector(head, 0.4));
  twist('Wrist.R', V(0, -1, 0), down);
});
const kneel4 = (sway, headDrop) =>
  pose(() => {
    // Hands and knees: back level, thighs and arms straight down, shins along the floor, head hanging.
    body(lPelvis.clone().add(V(sway, 0.5, 0.15)), basis(V(-1, 0, 0), V(0, 0, back), V(0, -1, 0)).multiply(E(-6)));
    bend('Abdomen', -4);
    bend('Torso', 4);
    bend('Chest', 4);
    bend('Neck', 30 + headDrop);
    bend('Head', 12 + headDrop * 0.5);
    for (const s of ['L', 'R']) {
      aim(`UpperLeg.${s}`, side(s, 0.06).add(V(0, -1, -0.05 * back)));
      aim(`LowerLeg.${s}`, V(0, -0.06, -back));
      rigidFoot(s, 80);
      aim(`UpperArm.${s}`, side(s, 0.12).add(V(0, -1, 0.12 * back)));
      aim(`LowerArm.${s}`, side(s, 0.05).add(V(0, -1, 0.08 * back)));
      aim(`Wrist.${s}`, side(s, 0.15).add(V(0, -0.25, back)));
      twist(`Wrist.${s}`, V(0, -1, 0), V(0, -1, 0));
    }
  });
const K2 = kneel4(0, 0),
  K2a = kneel4(0.05, 12),
  K2b = kneel4(-0.04, 4);
const K3 = pose(() => {
  // One foot planted (right), the other knee down, a hand pushing on the front knee.
  body(lPelvis.clone().add(V(0, 0.55, 0.1 + 0.1 * back)), basis(V(-1, 0, 0), V(0, 1, 0), V(0, 0, back)));
  bend('Abdomen', 18);
  bend('Torso', 12);
  bend('Chest', 6);
  bend('Neck', 18);
  bend('Head', 8);
  const f = V(0, 0, back);
  aim('UpperLeg.R', f.clone().addScaledVector(V(0, -1, 0), 0.25).add(side('R', 0.15)));
  aim('LowerLeg.R', V(0, -1, -0.12 * back));
  rigidFoot('R');
  aim('UpperLeg.L', side('L', 0.05).add(V(0, -1, -0.15 * back)));
  aim('LowerLeg.L', V(0, -0.08, -back));
  rigidFoot('L', 45);
  // Right hand on the right knee, left arm hanging by the left thigh.
  const knee = wp(B('LowerLeg.R'));
  armTo('R', knee.clone().add(V(0.02 * back, 0.06, 0.04 * back)), wp(B('UpperArm.R')).add(side('R', 0.4)).add(V(0, -0.1, 0)));
  aim('UpperArm.L', V(0, -1, 0.35 * back));
  aim('LowerArm.L', V(0, -1, 0.5 * back));
});
const K4 = pose(() => {
  // Pushing up: crouched, hands on the thighs above the knees.
  apply(K3);
  const fq = wq(B('Foot.R'));
  const fr = wp(B('Foot.R'));
  const lf = fr.clone().add(side('L', 0.26)).add(V(0, 0, -0.14 * back));
  body(V((fr.x + lf.x) / 2, 0.62, (fr.z + lf.z) / 2 - 0.12 * back), basis(V(-1, 0, 0), V(0, 1, 0), V(0, 0, back)));
  bend('Abdomen', 28);
  bend('Torso', 14);
  bend('Chest', 6);
  bend('Neck', 10);
  bend('Head', 6);
  legTo('R', fr, kneePole('R'));
  setWorldQ(B('Foot.R'), fq);
  legTo('L', lf, kneePole('L'));
  setWorldQ(B('Foot.L'), fq);
  for (const s of ['L', 'R']) {
    const knee = wp(B(`LowerLeg.${s}`));
    const hip = wp(B(`UpperLeg.${s}`));
    armTo(s, knee.clone().lerp(hip, 0.3).add(V(0, 0.05, 0.03 * back)), wp(B(`UpperArm.${s}`)).add(side(s, 0.35)).add(V(0, -0.1, 0)));
  }
});
const K5 = pose(() => {
  // Up, a bit hunched, arms hanging, head low.
  apply(K4);
  const feet = feetNow();
  const mid = feet[0].p.clone().add(feet[1].p).multiplyScalar(0.5);
  body(V(mid.x, bindP('Body').y - 0.03, mid.z - 0.03 * back), basis(V(-1, 0, 0), V(0, 1, 0), V(0, 0, back)));
  bend('Abdomen', 6);
  bend('Torso', 6);
  bend('Chest', 2);
  bend('Neck', 12);
  bend('Head', 10);
  for (const f of feet) {
    legTo(f.s, f.p, kneePole(f.s));
    setWorldQ(B(`Foot.${f.s}`), f.q);
  }
  for (const s of ['L', 'R']) {
    aim(`UpperArm.${s}`, side(s, 0.15).add(V(0, -1, 0.05 * back)));
    aim(`LowerArm.${s}`, side(s, 0.05).add(V(0, -1, 0.25 * back)));
  }
});
export const GETUP = { dur: 3.9 };
{
  const fr = keyed(
    [
      [0, L],
      [0.35, K0],
      [0.8, K1],
      [1.35, K2],
      [1.65, K2a],
      [2.0, K2b],
      [2.5, K3],
      [3.0, K4],
      [3.4, K5],
      [3.9, K5],
    ],
    (t) => {
      // Wobble and shake it off once up.
      const k = clamp01((t - 3.1) / 0.3);
      if (k > 0) {
        const feet = feetNow();
        moveBody(V(0.03 * k * Math.sin(t * 9), 0, 0));
        replant(feet);
        turn('Head', Y, 16 * k * Math.sin((t - 3.1) * 22) * (1 - clamp01((t - 3.75) / 0.15)));
      }
    },
  );
  clips.push(clipOf('Box_Getup', fr));
}
// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/** Bones the footwork owns (the rest is the upper body). */
const LOWER = ['Body', 'Hips', 'UpperLeg.L', 'LowerLeg.L', 'Foot.L', 'UpperLeg.R', 'LowerLeg.R', 'Foot.R'];
/** Upper-body clips ride on whatever the legs are doing: the spine keeps its world turn over the guard's hips. */
function upperOnly(c) {
  c.frames = c.frames.map((f) => {
    apply(f);
    const ab = wq(B('Abdomen'));
    apply({ ...f, Body: G.Body, 'UpperLeg.L': G['UpperLeg.L'], 'UpperLeg.R': G['UpperLeg.R'], 'LowerLeg.L': G['LowerLeg.L'], 'LowerLeg.R': G['LowerLeg.R'], 'Foot.L': G['Foot.L'], 'Foot.R': G['Foot.R'] });
    setWorldQ(B('Abdomen'), ab);
    return snap();
  });
}
// The footwork again, legs only (worn under an upper-body move).
for (const n of ['Box_Guard', 'Box_Shuffle', 'Box_Side']) {
  const c = clips.find((x) => x.name === n);
  clips.push({ name: n + 'Legs', frames: c.frames, part: 'legs' });
}

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
    if (c.part === 'upper') upperOnly(c);
    const anim = doc.createAnimation(c.name);
    const times = new Float32Array(c.frames.length).map((_, i) => i / FPS);
    const input = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buf);
    for (const n of BONES) {
      if (c.part === 'upper' && LOWER.includes(n)) continue;
      if (c.part === 'legs' && !LOWER.includes(n)) continue;
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
  await io.write(OUT, doc);
}
await write();
console.log('fight clips', clips.map((c) => `${c.name} ${(c.frames.length / FPS).toFixed(2)}s`).join(', '));
