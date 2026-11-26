import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { FingerPose } from './fingers';

/**
 * A realistic first-person hand (the WebXR "generic hand", MIT, from
 * @webxr-input-profiles/assets) that you see instead of the avatar's own
 * blocky hands. It is locked 1:1 to your controller (or tracked hand) and
 * posed finger by finger, the way Quest games do it: the trigger curls the
 * index finger, grip curls the other three, touching a button rests the thumb
 * on it. The avatar's arm reaches to this hand, never the other way round.
 *
 * The model's bones are WebXR hand joints (flat, in hand space): -Z runs along
 * each bone toward the fingertip, -Y points out of the palm. Curling a finger
 * turns each knuckle about its own X axis.
 */

const FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'] as const;
const SEGS = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'] as const;
const THUMB = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'] as const;

/** Knuckle bend at full curl (radians): proximal, intermediate, distal. */
export const CURL = {
  finger: [1.5, 1.75, 1.05],
  /** Thumb: metacarpal, proximal, distal; plus how far it swings across the palm. */
  thumb: [0.35, 0.75, 0.95],
  thumbAcross: 0.55,
  /** With nothing pressed the hand is open and flat. */
  relaxed: 0,
};

/**
 * How a hand holds a Quest controller, in grip space (-Z runs along the
 * handle toward the thumb; the palm faces +X on the left hand, -X on the
 * right). The handle crosses the palm diagonally, like a hammer grip, so the
 * fingers point down-and-forward and the forearm comes from behind.
 * Calibrated against the Meta Quest Touch Plus models.
 */
export const GRIP_HOLD = {
  diagonal: 0.75,
  fit: { out: 0.032, along: 0.82, lift: 0, twist: 0 },
  fwd() {
    return new THREE.Vector3(0, -Math.cos(this.diagonal), -Math.sin(this.diagonal));
  },
  palm(side: 'left' | 'right') {
    return new THREE.Vector3(side === 'left' ? 1 : -1, 0, 0);
  },
  /** With nothing pressed (or touched) the hand is open and flat; buttons and grip curl it. */
  rest: [0, 0, 0, 0, 0] as const,
};

interface Joint {
  p: THREE.Vector3;
  q: THREE.Quaternion;
}

type Side = 'left' | 'right';
const templates: Partial<Record<Side, Promise<THREE.Object3D>>> = {};

function load(side: Side) {
  return (templates[side] ??= new GLTFLoader().loadAsync(new URL(`assets/hands/${side}.glb`, document.baseURI).href).then((g) => g.scene));
}

export class PosedHand {
  /** Place this in the world (or in a controller's grip space). */
  readonly root = new THREE.Group();
  /** The model (moved so the hand sits in the grip; see calibrateToGrip). */
  readonly holder = new THREE.Group();
  private bones: Record<string, THREE.Object3D> = {};
  private rest: Record<string, Joint> = {};
  private mesh: THREE.SkinnedMesh | null = null;
  ready = false;
  readonly material = new THREE.MeshStandardMaterial({ color: 0xd9a17e, roughness: 0.62, metalness: 0, side: THREE.DoubleSide });

  constructor(readonly side: Side) {
    this.root.add(this.holder);
    void load(side).then((tpl) => {
      const m = SkeletonUtils.clone(tpl);
      m.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) {
          const sm = o as THREE.SkinnedMesh;
          sm.material = this.material;
          sm.frustumCulled = false;
          sm.castShadow = false;
          this.mesh = sm;
        }
        o.raycast = () => {};
        if ((o as THREE.Bone).isBone || /finger|thumb|wrist/.test(o.name)) {
          this.bones[o.name] = o;
          this.rest[o.name] = { p: o.position.clone(), q: o.quaternion.clone() };
        }
      });
      this.holder.add(m);
      this.ready = true;
      this.calibrated?.();
    });
  }

  private calibrated: (() => void) | null = null;

  setColor(c: THREE.ColorRepresentation) {
    this.material.color.set(c);
  }

  /** Rest-pose joint (hand space). */
  joint(name: string): Joint | undefined {
    return this.rest[name];
  }

  /**
   * Seats the hand on a controller: `palm` is the palm normal and `fwd` the
   * finger direction in grip space; the fist closes around the grip origin.
   */
  calibrateToGrip(fwd: THREE.Vector3, palm: THREE.Vector3, opts: { out?: number; along?: number; lift?: number; twist?: number } = {}) {
    const apply = () => {
      const w = this.rest['wrist'],
        m = this.rest['middle-finger-phalanx-proximal'],
        i = this.rest['index-finger-phalanx-proximal'],
        pk = this.rest['pinky-finger-phalanx-proximal'];
      if (!w || !m || !i || !pk) return;
      // The model's own frame: fingers along wrist→middle knuckle, palm normal (−Y of the wrist joint).
      const f0 = m.p.clone().sub(w.p).normalize();
      const n0 = new THREE.Vector3(0, -1, 0).applyQuaternion(w.q);
      const qa = basisQ(fwd, palm);
      const qb = basisQ(f0, n0);
      const q = qa.multiply(qb.invert());
      if (opts.twist) q.premultiply(new THREE.Quaternion().setFromAxisAngle(fwd.clone().normalize(), opts.twist));
      this.holder.quaternion.copy(q);
      // The rod runs through the fist: just in front of the palm, under the knuckles.
      const knuckles = i.p.clone().add(pk.p).multiplyScalar(0.5);
      const anchor = w.p.clone().lerp(knuckles, opts.along ?? 0.82).addScaledVector(n0, opts.out ?? 0.032);
      this.holder.position.copy(anchor.applyQuaternion(q).negate()).add(new THREE.Vector3(0, 0, opts.lift ?? 0));
    };
    if (this.ready) apply();
    else this.calibrated = apply;
  }

  /** A joint's world position (e.g. 'index-finger-tip'), once loaded. */
  jointWorld(name: string, out = new THREE.Vector3()): THREE.Vector3 | null {
    const b = this.bones[name];
    return b ? b.getWorldPosition(out) : null;
  }

  /** The wrist joint's world pose. */
  wristPoseWorld(): { p: THREE.Vector3; q: THREE.Quaternion } | null {
    const w = this.bones['wrist'];
    if (!w) return null;
    return { p: w.getWorldPosition(new THREE.Vector3()), q: w.getWorldQuaternion(new THREE.Quaternion()) };
  }

  /** Places the hand (root in world space) so its wrist joint sits at this world pose. */
  placeByWrist(p: THREE.Vector3, q: THREE.Quaternion) {
    const w = this.rest['wrist'];
    if (!w) return;
    this.holder.position.set(0, 0, 0);
    this.holder.quaternion.identity();
    const rq = q.clone().multiply(w.q.clone().invert());
    this.root.quaternion.copy(rq);
    this.root.position.copy(p).sub(w.p.clone().applyQuaternion(rq));
  }

  /** Wrist position in world space (where the avatar's forearm should end). */
  wristWorld(out = new THREE.Vector3()): THREE.Vector3 | null {
    const w = this.bones['wrist'];
    if (!w) return null;
    return w.getWorldPosition(out);
  }

  /**
   * Poses the fingers: [thumb, index, middle, ring, pinky] curls, 0 open … 1
   * closed. On a controller the fingers rest on it when nothing is pressed.
   */
  setPose(pose: Readonly<FingerPose>, o: { controller?: boolean } = {}) {
    if (!this.ready) return;
    const lo = (k: number) => (o.controller ? GRIP_HOLD.rest[k] : CURL.relaxed);
    FINGERS.forEach((f, k) => {
      const c = lo(k + 1) + (1 - lo(k + 1)) * THREE.MathUtils.clamp(pose[k + 1] ?? 0, 0, 1);
      // A little splay when open, none when closed (fingers come together in a fist).
      const splay = (1 - c) * (k - 1.5) * -0.05;
      this.chain(
        SEGS.map((s) => `${f}-${s}`),
        [null, [c * CURL.finger[0], splay], [c * CURL.finger[1], 0], [c * CURL.finger[2], 0], null],
      );
    });
    const t = lo(0) + (0.95 - lo(0)) * THREE.MathUtils.clamp(pose[0] ?? 0, 0, 1);
    this.chain([...THUMB], [[t * CURL.thumb[0], t * CURL.thumbAcross * (this.side === 'left' ? -1 : 1)], [t * CURL.thumb[1], 0], [t * CURL.thumb[2], 0], null]);
  }

  /**
   * Forward kinematics on a flat chain: each joint bends (about its own X) and
   * swings (about its own Y); everything further along follows.
   */
  private chain(names: string[], bends: ([number, number] | null)[]) {
    const pos = names.map((n) => this.rest[n]?.p.clone());
    const rot = names.map((n) => this.rest[n]?.q.clone());
    if (pos.some((p) => !p)) return;
    for (let k = 0; k < names.length; k++) {
      const b = bends[k];
      if (!b || (b[0] === 0 && b[1] === 0)) continue;
      const pivot = pos[k]!;
      // Flexion toward the palm is a negative turn about the joint's X axis.
      const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(rot[k]!);
      const ay = new THREE.Vector3(0, 1, 0).applyQuaternion(rot[k]!);
      const turn = new THREE.Quaternion().setFromAxisAngle(ax, -b[0]).multiply(new THREE.Quaternion().setFromAxisAngle(ay, b[1]));
      for (let j = k; j < names.length; j++) {
        if (j > k) pos[j]!.sub(pivot).applyQuaternion(turn).add(pivot);
        rot[j]!.premultiply(turn);
      }
    }
    names.forEach((n, k) => {
      const bone = this.bones[n];
      if (!bone) return;
      bone.position.copy(pos[k]!);
      bone.quaternion.copy(rot[k]!);
    });
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }
  get visible() {
    return this.root.visible;
  }
  get hasMesh() {
    return !!this.mesh;
  }
}

/** Rotation whose Z is `f` and X is `n` (made perpendicular). */
function basisQ(f: THREE.Vector3, n: THREE.Vector3) {
  const z = f.clone().normalize();
  const x = n.clone().addScaledVector(z, -n.dot(z)).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/**
 * A character's skin tone: the average vertex colour of the mesh around its
 * wrists (the characters are vertex coloured), so the hands match the arms.
 */
export function skinTone(mesh: THREE.SkinnedMesh | null | undefined): THREE.Color | null {
  if (!mesh) return null;
  const g = mesh.geometry;
  const col = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  const si = g.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
  const sw = g.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
  if (!col || !si || !sw) return null;
  const want = new Set<number>();
  mesh.skeleton.bones.forEach((b, i) => {
    if (/^(Wrist|Index1|Middle1|Ring1|Pinky1|Thumb1)[LR]$/.test(b.name.replace(/\./g, ''))) want.add(i);
  });
  if (!want.size) return null;
  const sum = new THREE.Color(0, 0, 0);
  let n = 0;
  for (let v = 0; v < si.count; v++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (want.has(si.getComponent(v, k))) w += sw.getComponent(v, k);
    if (w < 0.6) continue;
    sum.r += col.getX(v);
    sum.g += col.getY(v);
    sum.b += col.getZ(v);
    n++;
  }
  if (!n) return null;
  // Vertex colours are linear already; the material colour is too.
  return sum.multiplyScalar(1 / n);
}
