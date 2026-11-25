import * as THREE from 'three';
import { MOUTH, mouthShape, profileMouth } from './net/embody';
import type { Person } from './people';

/**
 * Faces that come alive up close: lips that move with the words people say,
 * eyelids that blink, eyes that glance around and look at you, brows and lids
 * that react (surprise when splashed or pushed, smiling eyes and a grin when
 * laughing or cheering).
 *
 * The characters' eyes and brows are little dark boxes in the mesh. For the
 * few people near you, small flat pieces are laid over them: a skin patch
 * over the eye, a moving dark eye with a glint, skin-coloured lids, and (when
 * the brows lift) a skin patch over each brow with a brow drawn above it. The
 * mouth (the mesh has none) is lips, an opening and teeth, sized and placed
 * like the friend's avatar mouth (net/embody.ts makeMouth).
 *
 * Everything for everybody is two instanced meshes (one draw each) using the
 * characters' own shared material, so faces are lit exactly like the bodies.
 * Per-frame work is only for the few nearest people.
 */

type V3 = THREE.Vector3;

/** A flat feature on the face, in head-bone space: centre, in-plane axes (x across, y up), normal, size. */
export interface Patch {
  c: V3;
  x: V3;
  y: V3;
  n: V3;
  w: number;
  h: number;
  color: THREE.Color;
}

export interface FaceLayout {
  /** [character's left (+x), right (-x)], or null if no eyes were found. */
  eyes: [Patch, Patch] | null;
  /** Brow pieces on each side (some characters have two per brow). */
  brows: [Patch[], Patch[]];
  skin: THREE.Color;
  /** Centre of the lips (head-bone space, facing +z). */
  mouth: V3;
}

const layouts = new WeakMap<THREE.BufferGeometry, FaceLayout>();

/**
 * Measures a character's face from its geometry (once per character model):
 * the eyes and brows are the small dark parts on the front of the head, the
 * mouth sits on the face's profile between chin and nose (profileMouth).
 * Positions are in the head bone's space, so they hold whatever the pose.
 */
export function faceLayout(mesh: THREE.SkinnedMesh, head: THREE.Object3D): FaceLayout {
  // People wear their own colours on a geometry that shares the model's shape
  // (peopleshade.ts paintCharacter): measure the model once, from its own colours.
  const g = (mesh.geometry.userData.base as THREE.BufferGeometry | undefined) ?? mesh.geometry;
  const cached = layouts.get(g);
  if (cached) return cached;
  let root: THREE.Object3D = mesh;
  while (root.parent && !(root.parent as THREE.Scene).isScene) root = root.parent;
  root.updateMatrixWorld(true);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = g.attributes.color as THREE.BufferAttribute | undefined;
  const toHead = new THREE.Matrix4().copy(head.matrixWorld).invert().multiply(mesh.matrixWorld);
  // Only the head and neck matter (skinning every vertex on the CPU would take tens of ms).
  const si = g.attributes.skinIndex as THREE.BufferAttribute | undefined;
  const sw = g.attributes.skinWeight as THREE.BufferAttribute | undefined;
  const bones = new Set([mesh.skeleton.bones.indexOf(head as THREE.Bone), mesh.skeleton.bones.indexOf(head.parent as THREE.Bone)]);
  const far = new THREE.Vector3(0, -9, -9);
  const P: V3[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    let w = si && sw ? 0 : 1;
    if (si && sw) for (let j = 0; j < 4; j++) if (bones.has(si.getComponent(i, j))) w += sw.getComponent(i, j);
    if (w < 0.3) {
      P.push(far);
      continue;
    }
    mesh.getVertexPosition(i, v);
    P.push(v.clone().applyMatrix4(toHead));
  }
  const colorOf = (i: number) => (col ? new THREE.Color(col.getX(i), col.getY(i), col.getZ(i)) : new THREE.Color(1, 1, 1));
  const lum = (i: number) => (col ? 0.3 * col.getX(i) + 0.59 * col.getY(i) + 0.11 * col.getZ(i) : 1);

  // Profile → mouth.
  const prof = new Map<number, number>();
  const counts = new Map<string, { n: number; i: number }>();
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    if (Math.abs(p.x) < 0.025 && p.y > -0.06 && p.y < 0.12) {
      const k = Math.round(p.y * 100);
      prof.set(k, Math.max(prof.get(k) ?? -1, p.z));
    }
    // Skin: the commonest colour on the cheeks and nose.
    if (Math.abs(p.x) < 0.06 && p.y > 0 && p.y < 0.09 && p.z > 0.07) {
      const key = col ? `${col.getX(i).toFixed(2)},${col.getY(i).toFixed(2)},${col.getZ(i).toFixed(2)}` : 'w';
      const e = counts.get(key) ?? { n: 0, i };
      e.n++;
      counts.set(key, e);
    }
  }
  const pm = profileMouth(prof);
  const mouth = new THREE.Vector3(0, pm?.up ?? 0.022, (pm?.front ?? 0.11) + 0.005);
  let skin = new THREE.Color(0.62, 0.42, 0.24);
  let best = 0;
  for (const e of counts.values()) if (e.n > best && lum(e.i) > 0.12) (best = e.n), (skin = colorOf(e.i));

  // Eyes and brows: small connected dark parts on the front of the head.
  const cand = new Set<number>();
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    if (p.y > 0.07 && p.y < 0.15 && p.z > 0.08 && Math.abs(p.x) < 0.09 && lum(i) < 0.1) cand.add(i);
  }
  const parent = new Map<number, number>();
  const find = (a: number): number => {
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r)!;
    for (let q = a; q !== r; ) {
      const nx = parent.get(q)!;
      parent.set(q, r);
      q = nx;
    }
    return r;
  };
  const join = (a: number, b: number) => parent.set(find(a), find(b));
  const byPos = new Map<string, number>();
  for (const i of cand) {
    parent.set(i, i);
    const key = `${Math.round(P[i].x * 1e4)},${Math.round(P[i].y * 1e4)},${Math.round(P[i].z * 1e4)}`;
    const o = byPos.get(key);
    if (o !== undefined) join(i, o);
    else byPos.set(key, i);
  }
  const idx = g.index;
  const tris: [number, number, number][] = [];
  const triCount = idx ? idx.count : pos.count;
  for (let t = 0; t < triCount; t += 3) {
    const a = idx ? idx.getX(t) : t,
      b = idx ? idx.getX(t + 1) : t + 1,
      c = idx ? idx.getX(t + 2) : t + 2;
    if (cand.has(a) && cand.has(b) && cand.has(c)) {
      join(a, b);
      join(a, c);
      tris.push([a, b, c]);
    }
  }
  const comps = new Map<number, [number, number, number][]>();
  for (const t of tris) {
    const r = find(t[0]);
    let l = comps.get(r);
    if (!l) comps.set(r, (l = []));
    l.push(t);
  }
  const parts: { patch: Patch; tris: [number, number, number][] }[] = [];
  for (const ts of comps.values()) {
    const f = ts.length <= 64 ? frontTris(ts, P) : null;
    if (!f) continue;
    const p = fitPatch(f.tris, P, f.n, false);
    // Eyes and brows sit on the front of the face between nose and forehead (hair doesn't).
    if (p.w < 0.065 && p.h < 0.03 && p.c.y > 0.08 && p.c.y < 0.135 && p.c.z > 0.095 && Math.abs(p.c.x) < 0.08) {
      p.color = colorOf(ts[0][0]);
      parts.push({ patch: p, tris: f.tris });
    }
  }
  const side = (s: number) => parts.filter((q) => Math.sign(q.patch.c.x) === s);
  // The eye is the lowest dark part on each side; the brows are above it.
  const eyeOf = (l: typeof parts) => l.reduce<(typeof parts)[number] | null>((m, q) => (!m || q.patch.c.y < m.patch.c.y ? q : m), null);
  const sides = [side(1), side(-1)];
  const eyeL = eyeOf(sides[0]),
    eyeR = eyeOf(sides[1]);
  const eyes: [Patch, Patch] | null = eyeL && eyeR && eyeL.patch.h > 0.012 && eyeR.patch.h > 0.012 ? [eyeL.patch, eyeR.patch] : null;
  const browsOf = (l: typeof parts, eye: (typeof parts)[number] | null) =>
    eye ? l.filter((q) => q !== eye && q.patch.c.y > eye.patch.c.y + 0.003).flatMap((q) => browPieces(q.tris, P, q.patch.n, q.patch.color)) : [];
  const layout: FaceLayout = { eyes, brows: [browsOf(sides[0], eyeL), browsOf(sides[1], eyeR)], skin, mouth };
  layouts.set(g, layout);
  return layout;
}

/** The forward-facing triangles of a little box (eye or brow) and their mean normal. */
function frontTris(ts: [number, number, number][], P: V3[]): { tris: [number, number, number][]; n: V3 } | null {
  const ab = new THREE.Vector3(),
    ac = new THREE.Vector3();
  const normals = ts.map(([a, b, c]) => ab.subVectors(P[b], P[a]).cross(ac.subVectors(P[c], P[a])).clone());
  let best: V3 | null = null;
  for (const m of normals) if (m.lengthSq() > 1e-14 && (!best || m.clone().normalize().z > best.z)) best = m.clone().normalize();
  if (!best || best.z < 0.5) return null;
  const n = new THREE.Vector3();
  const tris: [number, number, number][] = [];
  ts.forEach((t, i) => {
    const m = normals[i];
    if (m.lengthSq() < 1e-14 || m.clone().normalize().dot(best!) < 0.9) return;
    n.add(m);
    tris.push(t);
  });
  return { tris, n: n.normalize() };
}

/**
 * Fits a flat patch to triangles facing along `n`: across the face (x) is
 * level, or (`along`) follows the part's length, like a sloping brow.
 */
function fitPatch(tris: [number, number, number][], P: V3[], n: V3, along: boolean): Patch {
  const pts = [...new Set(tris.flat())].map((k) => P[k]);
  const x = new THREE.Vector3(1, 0, 0).addScaledVector(n, -n.x).normalize();
  let y = new THREE.Vector3().crossVectors(n, x);
  const c0 = new THREE.Vector3();
  for (const p of pts) c0.add(p);
  c0.multiplyScalar(1 / pts.length);
  if (along) {
    // Principal direction of the points in the plane.
    let sxx = 0,
      sxy = 0,
      syy = 0;
    for (const p of pts) {
      const d = p.clone().sub(c0);
      const u = d.dot(x),
        v = d.dot(y);
      sxx += u * u;
      sxy += u * v;
      syy += v * v;
    }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const nx = x.clone().multiplyScalar(Math.cos(th)).addScaledVector(y, Math.sin(th));
    x.copy(nx.x < 0 ? nx.negate() : nx);
    y = new THREE.Vector3().crossVectors(n, x);
  }
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const p of pts) {
    const d = p.clone().sub(c0);
    x0 = Math.min(x0, d.dot(x));
    x1 = Math.max(x1, d.dot(x));
    y0 = Math.min(y0, d.dot(y));
    y1 = Math.max(y1, d.dot(y));
  }
  const c = c0.addScaledVector(x, (x0 + x1) / 2).addScaledVector(y, (y0 + y1) / 2);
  return { c, x, y, n: n.clone(), w: x1 - x0, h: y1 - y0, color: new THREE.Color() };
}

/** A brow as two pieces along its length (so an arched brow keeps its arch and thickness). */
function browPieces(tris: [number, number, number][], P: V3[], n: V3, color: THREE.Color): Patch[] {
  const whole = fitPatch(tris, P, n, true);
  const along = (t: [number, number, number]) => (P[t[0]].dot(whole.x) + P[t[1]].dot(whole.x) + P[t[2]].dot(whole.x)) / 3;
  const sorted = [...tris].sort((a, b) => along(a) - along(b));
  const half = Math.ceil(sorted.length / 2);
  const parts = sorted.length >= 4 ? [sorted.slice(0, half), sorted.slice(half)] : [sorted];
  return parts.map((ts) => Object.assign(fitPatch(ts, P, n, true), { color }));
}

/** How closed the upper lid is `t` seconds into a blink (fast down, a beat shut, slower up). */
export function blinkCurve(t: number): number {
  const D = 0.17;
  if (t < 0 || t > D) return 0;
  const u = t / D;
  return u < 0.33 ? u / 0.33 : u < 0.47 ? 1 : 1 - (u - 0.47) / 0.53;
}

/** Seconds to the next blink: every 2–6 s, quicker while laughing; sometimes a double blink. */
export function nextBlinkGap(laughing: boolean, rnd: () => number = Math.random): number {
  if (rnd() < 0.15) return 0.24 + rnd() * 0.08;
  return laughing ? 0.6 + rnd() * 1.2 : 2 + rnd() * 4;
}

/** Mouth opening for a speech frame: loud and vowel-y opens wide, quiet or hissy stays narrow. */
export function speechOpen(level: number, vowel: number): number {
  return THREE.MathUtils.clamp(level * (0.45 + 0.75 * vowel), 0, 1);
}

export interface FaceState {
  nextBlink: number;
  blinkAt: number;
  open: number;
  gx: number;
  gy: number;
  sx: number;
  sy: number;
  nextSac: number;
  lookAwayUntil: number;
  nextLookAway: number;
  smile: number;
  wide: number;
  brow: number;
}

export interface FacesOpts {
  /** Only people this close get a face (metres). */
  radius?: number;
  /** At most this many faces at once (the nearest). */
  max?: number;
  /** A person's recorded line, analysed (voices.mouthLevel). */
  level?: (p: Person) => { level: number; vowel: number } | null;
}

const C = {
  lips: new THREE.Color(MOUTH.lips.color).multiplyScalar(1.15),
  inner: new THREE.Color(MOUTH.inner.color),
  teeth: new THREE.Color(MOUTH.teeth.color).multiplyScalar(1.1),
  glint: new THREE.Color(2.4, 2.4, 2.3),
};
const SQUARE = 0,
  ROUND = 1,
  GRIN = 2;
type Shape = typeof SQUARE | typeof ROUND | typeof GRIN;
const X = new THREE.Vector3(1, 0, 0),
  Y = new THREE.Vector3(0, 1, 0),
  Z = new THREE.Vector3(0, 0, 1);

export class Faces {
  /** Rounded squares (eyes, lids, brows, teeth), ellipses (lips, the mouth's opening, glints), the grin's "D". */
  private meshes: THREE.InstancedMesh[] = [];
  private counts = [0, 0, 0];
  /** Per-person blink, gaze and expression state (exposed for tests). */
  readonly state = new WeakMap<Person, FaceState>();
  private radius: number;
  private max: number;
  /** Who has a face this frame (nearest first). */
  readonly near: Person[] = [];
  /** Mouth opening per near person this frame (for tests and tuning). */
  readonly openOf = new WeakMap<Person, number>();
  private hm = new THREE.Matrix4();
  private inv = new THREE.Matrix4();
  private lm = new THREE.Matrix4();
  private wm = new THREE.Matrix4();
  private tx = new THREE.Vector3();
  private ty = new THREE.Vector3();
  private tp = new THREE.Vector3();
  private lc = new THREE.Vector3();
  private hp = new THREE.Vector3();
  private cand: { p: Person; d: number }[] = [];
  private warm = false;

  constructor(
    private parent: THREE.Object3D,
    private opts: FacesOpts = {},
  ) {
    this.radius = opts.radius ?? 6;
    this.max = opts.max ?? 8;
  }

  /** A person's measured face (for tests and tuning). */
  layoutOf(p: Person): FaceLayout | null {
    return p.rig?.mesh && p.rig.bones.Head ? faceLayout(p.rig.mesh, p.rig.bones.Head) : null;
  }

  /** The instanced meshes, made with the characters' own (shared) material on first use. */
  private build(mat: THREE.Material) {
    const mk = (geo: THREE.BufferGeometry, n: number) => {
      const c = new Float32Array(geo.attributes.position.count * 3).fill(1);
      geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.frustumCulled = false;
      m.raycast = () => {};
      m.count = 0;
      m.visible = false;
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      m.name = 'faces';
      this.parent.add(m);
      return m;
    };
    // Superellipses 1 × 1: rounded squares like the model's own eyes and brows, and ellipses.
    const blob = (pw: number) => {
      const sh = new THREE.Shape();
      const N = 28;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const c = Math.cos(a),
          s = Math.sin(a);
        const px = 0.5 * Math.sign(c) * Math.pow(Math.abs(c), 2 / pw),
          py = 0.5 * Math.sign(s) * Math.pow(Math.abs(s), 2 / pw);
        if (i === 0) sh.moveTo(px, py);
        else sh.lineTo(px, py);
      }
      return new THREE.ShapeGeometry(sh);
    };
    // A "D" (flat top, round bottom), 1 × 1: the open grin.
    const d = new THREE.Shape();
    d.moveTo(-0.5, 0.5);
    for (let i = 0; i <= 14; i++) {
      const a = -(i / 14) * Math.PI;
      d.lineTo(0.5 * Math.cos(a), 0.5 + Math.sin(a));
    }
    this.meshes = [mk(blob(6), this.max * 18), mk(blob(2), this.max * 4), mk(new THREE.ShapeGeometry(d), this.max)];
  }

  /** Lays one flat piece on the face (head-bone space → world through `hm`). */
  private put(shape: Shape, c: V3, x: V3, y: V3, n: V3, w: number, h: number, color: THREE.Color, ox: number, oy: number, dz: number) {
    const mesh = this.meshes[shape];
    const i = this.counts[shape];
    if (i >= mesh.instanceMatrix.count) return;
    this.lm.makeBasis(this.tx.copy(x).multiplyScalar(w), this.ty.copy(y).multiplyScalar(h), n);
    this.lm.setPosition(this.tp.copy(c).addScaledVector(x, ox).addScaledVector(y, oy).addScaledVector(n, dz));
    this.wm.multiplyMatrices(this.hm, this.lm);
    mesh.setMatrixAt(i, this.wm);
    mesh.setColorAt(i, color);
    this.counts[shape]++;
  }

  /**
   * Once a frame, after the crowd has been posed. `cam` is your eye (world),
   * `time` the crowd's clock.
   */
  update(dt: number, time: number, people: readonly Person[], cam: THREE.Vector3) {
    // The nearest few people you can see.
    const cand = this.cand;
    cand.length = 0;
    const r2 = this.radius * this.radius;
    for (const p of people) {
      if (!p.rig?.mesh || p.culled || !p.rig.root.visible || !p.rig.bones.Head) continue;
      const dx = p.pos.x - cam.x,
        dz = p.pos.z - cam.z,
        dy = p.pos.y + (p.seated ? 1.2 : 1.6) - cam.y;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < r2) cand.push({ p, d });
    }
    cand.sort((a, b) => a.d - b.d);
    this.near.length = 0;
    for (let i = 0; i < cand.length && i < this.max; i++) this.near.push(cand[i].p);
    if (!this.warm) {
      // Measure every character model once, up front (the first frame is behind the loading screen).
      this.warm = true;
      for (const p of people) if (p.rig?.mesh && p.rig.bones.Head) faceLayout(p.rig.mesh, p.rig.bones.Head);
    }
    if (!this.meshes.length) {
      if (!this.near.length) return;
      const mat = this.near[0].rig!.mesh!.material;
      this.build(Array.isArray(mat) ? mat[0] : mat);
    }
    this.counts.fill(0);
    for (const p of this.near) this.face(p, dt, time, cam);
    for (let k = 0; k < this.meshes.length; k++) {
      const m = this.meshes[k],
        n = this.counts[k];
      m.count = n;
      m.visible = n > 0;
      if (n > 0) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
  }

  private face(p: Person, dt: number, time: number, cam: THREE.Vector3) {
    const rig = p.rig!;
    const head = rig.bones.Head;
    const lay = faceLayout(rig.mesh!, head);
    let st = this.state.get(p);
    if (!st) {
      st = { nextBlink: time + Math.random() * 3, blinkAt: -9, open: 0, gx: 0, gy: 0, sx: 0, sy: 0, nextSac: 0, lookAwayUntil: 0, nextLookAway: time + 3 + Math.random() * 4, smile: 0, wide: 0, brow: 0 };
      this.state.set(p, st);
    }
    head.updateWorldMatrix(true, false);
    this.hm.copy(head.matrixWorld);
    // You, seen from their head.
    this.lc.copy(cam).applyMatrix4(this.inv.copy(this.hm).invert());
    const eyeY = lay.eyes ? (lay.eyes[0].c.y + lay.eyes[1].c.y) / 2 : 0.11;
    const dx = this.lc.x,
      dy = this.lc.y - eyeY,
      dz = this.lc.z - 0.1;
    const yawTo = Math.atan2(dx, dz),
      pitchTo = Math.atan2(dy, Math.hypot(dx, dz));
    const dist = this.hp.setFromMatrixPosition(this.hm).distanceTo(cam);
    const inFront = dz > 0 && Math.abs(yawTo) < 1.0;

    // --- Expressions -----------------------------------------------------------
    const gasp = p.gaspT > 0 ? Math.min(1, p.gaspT * 3) : 0;
    const laugh = p.laughT > 0 ? Math.min(1, p.laughT * 2) : 0;
    const cheer = p.cheer > 0 ? Math.min(1, p.cheer * 2) : 0;
    const k = Math.min(1, dt * 8);
    st.smile += (Math.max(laugh, cheer) - st.smile) * k;
    st.wide += (gasp - st.wide) * Math.min(1, dt * (gasp > st.wide ? 22 : 5));

    // --- Mouth -----------------------------------------------------------------
    const heard = p.ownMouth ? null : (this.opts.level?.(p) ?? null);
    const speaking = time < p.speakUntil || (p.talk && p.talk.members[p.talk.speaker] === p && p.talking > 0.5) || (!!p.chatWith && p.talking > 0.6);
    let want = 0;
    if (heard) want = speechOpen(heard.level, heard.vowel);
    else if (speaking) {
      // No recording to follow (muted, or ambient chatter): a natural-looking flap.
      const t = time + p.seed;
      want = Math.max(0, (0.32 + 0.4 * Math.sin(t * 17) * Math.sin(t * 7.3)) * Math.min(1, p.talking + 0.3));
    }
    // "Ha ha" with the laugh's bounce (people.ts), "oh!" when startled.
    if (laugh > 0.2) want = Math.max(want, (0.2 + 0.4 * Math.abs(Math.sin((time + p.seed) * 14))) * laugh);
    if (cheer > 0.2) want = Math.max(want, 0.35 * cheer);
    want = Math.max(want, 0.5 * gasp);
    st.open += (want - st.open) * Math.min(1, dt * (want > st.open ? 28 : 16));
    this.openOf.set(p, st.open);

    // --- Eyes ------------------------------------------------------------------
    // Look at you while talking with you, or (mostly) when you're close in front of them.
    if (time > st.nextLookAway) {
      st.lookAwayUntil = time + 0.5 + Math.random() * 0.9;
      st.nextLookAway = time + 3 + Math.random() * 5;
    }
    const attending = time < p.attendUntil;
    const atYou = !p.driven && (attending || (dist < 2.6 && inFront && time > st.lookAwayUntil));
    let tx: number, ty: number;
    if (atYou && inFront) {
      tx = THREE.MathUtils.clamp(yawTo / 0.55, -1, 1);
      ty = THREE.MathUtils.clamp(pitchTo / 0.45, -1, 1);
    } else {
      // Little glances around (saccades): jump, hold, jump.
      if (time > st.nextSac) {
        const big = p.driven ? 0.4 : 1;
        st.sx = (Math.random() - 0.5) * 1.1 * big;
        st.sy = (Math.random() - 0.5) * 0.6 * big;
        st.nextSac = time + 0.5 + Math.random() * 2.5;
      }
      tx = st.sx;
      ty = st.sy;
    }
    const gk = Math.min(1, dt * 22);
    st.gx += (tx - st.gx) * gk;
    st.gy += (ty - st.gy) * gk;

    if (time >= st.nextBlink) {
      // A startled stare holds off the blink.
      if (st.wide > 0.5) st.nextBlink = time + 0.3;
      else {
        st.blinkAt = time;
        st.nextBlink = time + nextBlinkGap(laugh > 0.2);
      }
    }
    const blink = blinkCurve(time - st.blinkAt);
    const upper = Math.max(blink, 0.22 * st.smile * (1 - st.wide));
    const lower = 0.42 * st.smile * (1 - blink);
    const browUp = 0.0055 * st.wide + 0.0018 * cheer + (heard ? 0.0012 * heard.level : 0);
    st.brow += (browUp - st.brow) * Math.min(1, dt * 12);

    // This person's own skin and brow colour (painted), else the model's.
    const skin = (rig.mesh!.userData.skin as THREE.Color | undefined) ?? lay.skin;
    const browCol = rig.mesh!.userData.brow as THREE.Color | undefined;
    if (lay.eyes) {
      for (let s = 0; s < 2; s++) {
        const e = lay.eyes[s];
        // Skin over the model's own eye, then the moving eye, its glint, the lids.
        this.put(SQUARE, e.c, e.x, e.y, e.n, e.w * 1.32, e.h * 1.28, skin, 0, 0, 0.001);
        const ox = st.gx * 0.17 * e.w,
          oy = st.gy * 0.12 * e.h;
        const ih = e.h * (1 + 0.14 * st.wide);
        this.put(SQUARE, e.c, e.x, e.y, e.n, e.w * (1 + 0.06 * st.wide), ih, e.color, ox, oy, 0.0016);
        const gl = e.w * 0.24;
        this.put(ROUND, e.c, e.x, e.y, e.n, gl, gl, C.glint, ox + e.w * 0.2, oy + ih * 0.22, 0.0021);
        if (upper > 0.01) {
          const top = e.h * 0.6,
            lh = upper * e.h * 1.2;
          this.put(SQUARE, e.c, e.x, e.y, e.n, e.w * 1.3, lh, skin, 0, top - lh / 2, 0.0026);
        }
        if (lower > 0.01) {
          const bot = -e.h * 0.6,
            lh = lower * e.h;
          this.put(SQUARE, e.c, e.x, e.y, e.n, e.w * 1.3, lh, skin, 0, bot + lh / 2, 0.0026);
        }
        // Brows lift: skin over the model's brow, the brow drawn higher.
        if (st.brow > 0.0004) {
          for (const b of lay.brows[s]) {
            this.put(SQUARE, b.c, b.x, b.y, b.n, b.w * 1.12, b.h * 1.3, skin, 0, 0, 0.0006);
            this.put(SQUARE, b.c, b.x, b.y, b.n, b.w, b.h, browCol ?? b.color, 0, st.brow, 0.0012);
          }
        }
      }
    }

    if (!p.ownMouth) {
      const m = lay.mouth;
      const sh = mouthShape(st.open);
      const sm = st.smile;
      const L = MOUTH.lips,
        I = MOUTH.inner,
        T = MOUTH.teeth;
      this.put(ROUND, m, X, Y, Z, 2 * L.rx * sh.lips.sx * (1 + 0.16 * sm), 2 * L.ry * sh.lips.sy * (1 - 0.15 * sm), (rig.mesh!.userData.lips as THREE.Color | undefined) ?? C.lips, 0, sh.lips.y, 0);
      if (sm < 0.4) {
        this.put(ROUND, m, X, Y, Z, 2 * I.rx * sh.inner.sx * (1 - 0.3 * st.wide), 2 * I.ry * sh.inner.sy, C.inner, 0, sh.inner.y, 0.0007);
        if (sh.teeth.visible) this.put(SQUARE, m, X, Y, Z, T.w * sh.teeth.sx, T.h, C.teeth, 0, T.y - T.h / 2, 0.0013);
      } else {
        // A grin: flat on top, round below, the top teeth showing.
        const w = 2 * I.rx * (1 + 0.12 * sm),
          h = 0.004 + st.open * 0.013 + 0.003 * sm,
          top = 0.002;
        this.put(GRIN, m, X, Y, Z, w, h, C.inner, 0, top - h / 2, 0.0007);
        const th = Math.min(T.h, h * 0.42);
        this.put(SQUARE, m, X, Y, Z, w * 0.82, th, C.teeth, 0, top - th / 2, 0.0013);
      }
    }
  }
}
