import * as THREE from 'three';
import { STAGE, POOL } from '../areas/pool';
import type { Beat } from './beat';

/**
 * The back of her crowd: dozens more concert-goers filling the deck behind
 * the animated audience (audience.ts), as cheap as a crowd gets: three draws
 * for all of them (bodies, arms, phones), instanced, posed on the CPU each
 * frame with a few matrices apiece (no skeletons, no animation mixers).
 *
 * They start drifting in from the deck's east and west edges half a minute
 * before her set (so the deck fills up while you wait), stand facing her,
 * bounce on the beat, jump in the choruses, clap along in the build-ups, throw
 * their hands up, film her on their phones (a lit screen held up at eye
 * level), and drift off again after her set. Where everyone is comes from the
 * shared clock (seconds to / into / since her set), like audience.ts, so a
 * room sees the same crowd. You (and anyone walking through) can squeeze
 * past: they step aside and drift back.
 *
 * How many by tier (backCount): fewer on headsets and phones.
 */

/** How many of them, for a tier's crowd size (quality.ts `people`). */
export function backCount(people: number): number {
  return people >= 60 ? 96 : people >= 50 ? 72 : people >= 40 ? 56 : 40;
}

/** Walking pace (m/s), and over how long they arrive (s, from half a minute before her set). */
const PACE = 1.1;
const FIRST = -30;
const ARRIVE_OVER = 80;
/** Where they come in (and leave): the deck's east and west edges. */
const EAST_X = 58.5;
const WEST_X = 25.5;
/** Pushed aside: their body's reach (m), and how fast they drift back (m/s). */
const REACH = 0.48;
const DRIFT = 0.4;

/** Places behind the animated audience, best first (the middle, nearest her). */
export function backSpots(free: (x: number, z: number) => boolean, n: number): THREE.Vector2[] {
  const out: { v: THREE.Vector2; score: number }[] = [];
  const mid = STAGE.spot.x;
  const z0 = STAGE.z1 + 3.35;
  // Stop short of the pool's edge.
  const zMax = POOL.z - POOL.d / 2 - 0.85;
  for (let r = 0; ; r++) {
    const z = z0 + r * 0.6;
    if (z > zMax) break;
    for (let k = -11; k <= 11; k++) {
      const x = mid + k * 0.58 + (r % 2 ? 0.29 : 0) + (((k * 31 + r * 17) % 5) - 2) * 0.03;
      const zz = z + (((k * 13 + r * 7) % 5) - 2) * 0.04;
      if (x < STAGE.x0 - 2.6 || x > STAGE.x1 + 1.7) continue;
      if (!free(x, zz)) continue;
      out.push({ v: new THREE.Vector2(x, zz), score: r * 0.9 + Math.abs(x - mid) * 0.35 });
    }
  }
  return out
    .sort((a, b) => a.score - b.score)
    .slice(0, n)
    .map((o) => o.v);
}

/**
 * Where one of them is on the clock: `t` seconds into her set (negative: before
 * it), or `since` seconds after it. Returns how far along their way (0: not
 * here, 1: at their place) and whether they're walking.
 */
export function backAt(go: number, back: number, len: number, t: number, since: number): { f: number; walking: boolean; leaving: boolean } {
  let d: number;
  let leaving = false;
  if (Number.isFinite(t)) d = (t - go) * PACE;
  else if (Number.isFinite(since)) {
    d = len - (since - back) * PACE;
    leaving = true;
  } else d = -1;
  const f = len > 0 ? THREE.MathUtils.clamp(d / len, 0, 1) : 1;
  return { f, walking: d > 0 && d < len, leaving };
}

interface Fan {
  spot: THREE.Vector2;
  entryX: number;
  go: number;
  back: number;
  len: number;
  /** Their own way of being in a crowd. */
  energy: number;
  eager: number;
  lag: number;
  height: number;
  film: boolean;
  female: boolean;
  /** Pushed aside by. */
  ox: number;
  oz: number;
  /** Where they are this frame (for whoops). */
  x: number;
  z: number;
  here: boolean;
}

const SKIN = [0xf1d3bd, 0xe3b393, 0xcf9a74, 0xb57f58, 0x8e5a3a, 0x6a3f28, 0x5a3523];
const HAIR = [0x120d0b, 0x2e1f15, 0x5e3f26, 0x8a6a46, 0xd8c49a, 0x6e3a20, 0x9a948c];
const TOPS = [0xf2efe8, 0x101012, 0xc86e5e, 0xa6c0d8, 0x2a3a5a, 0xd8b0a8, 0xe0c060, 0x2f747c, 0xb8504a, 0x7a4ab8, 0xe86aa0, 0x34363b];
const BOTTOMS = [0x1e2a44, 0xece8de, 0x121214, 0xae9a72, 0x3a4a68, 0x2a7e8c, 0x50553a];

/** Per-vertex part (0 top, 1 skin, 2 bottoms, 3 hair) → per-instance colours, in the standard material. */
function tintedMaterial(opts: THREE.MeshStandardMaterialParameters) {
  const m = new THREE.MeshStandardMaterial(opts);
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float part;\nattribute vec3 iTop;\nattribute vec3 iSkin;\nattribute vec3 iBottom;\nattribute vec3 iHair;\nvarying vec3 vTint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTint = part < 0.5 ? iTop : part < 1.5 ? iSkin : part < 2.5 ? iBottom : iHair;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTint;').replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse * vTint, opacity );');
  };
  m.customProgramCacheKey = () => 'backcrowd-tint';
  return m;
}

/** Merges geometries (non-indexed), tagging each with its part. */
function merge(parts: [THREE.BufferGeometry, number][]): THREE.BufferGeometry {
  const pos: number[] = [],
    nor: number[] = [],
    part: number[] = [];
  for (const [g0, k] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...(g.attributes.position.array as Float32Array));
    nor.push(...(g.attributes.normal.array as Float32Array));
    for (let i = 0; i < g.attributes.position.count; i++) part.push(k);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('part', new THREE.Float32BufferAttribute(part, 1));
  return out;
}

/** A standing figure, facing +z, feet at y = 0 (a 1.75 m adult). */
function bodyGeometry(): THREE.BufferGeometry {
  const legL = new THREE.CylinderGeometry(0.075, 0.06, 0.86, 7).translate(0.095, 0.43, 0);
  const legR = new THREE.CylinderGeometry(0.075, 0.06, 0.86, 7).translate(-0.095, 0.43, 0);
  const hips = new THREE.CylinderGeometry(0.165, 0.17, 0.2, 9).translate(0, 0.9, 0);
  const torso = new THREE.CylinderGeometry(0.195, 0.16, 0.52, 9).scale(1, 1, 0.72).translate(0, 1.22, 0);
  const neck = new THREE.CylinderGeometry(0.048, 0.052, 0.1, 6).translate(0, 1.52, 0);
  const head = new THREE.SphereGeometry(0.105, 10, 8).scale(0.92, 1.1, 1).translate(0, 1.64, 0.005);
  const hair = new THREE.SphereGeometry(0.114, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.95, 1.05, 1.05).translate(0, 1.655, -0.012);
  const shoes = new THREE.BoxGeometry(0.3, 0.07, 0.24).translate(0, 0.035, 0.04);
  return merge([
    [legL, 2],
    [legR, 2],
    [hips, 2],
    [torso, 0],
    [neck, 1],
    [head, 1],
    [hair, 3],
    [shoes, 2],
  ]);
}

/** An arm hanging from the shoulder (pivot at the origin, down -y): a sleeve, then bare arm and hand. */
function armGeometry(): THREE.BufferGeometry {
  const sleeve = new THREE.CylinderGeometry(0.058, 0.052, 0.2, 7).translate(0, -0.1, 0);
  const arm = new THREE.CylinderGeometry(0.045, 0.038, 0.42, 6).translate(0, -0.38, 0);
  const hand = new THREE.SphereGeometry(0.045, 6, 5).scale(0.8, 1.1, 0.6).translate(0, -0.62, 0);
  return merge([
    [sleeve, 0],
    [arm, 1],
    [hand, 1],
  ]);
}

/** The arm's length to the palm (m, at 1.75 m tall). */
const ARM = 0.6;
const SHOULDER = { x: 0.215, y: 1.43 };

export interface BackCrowdUpdate {
  beat: Beat;
  /** Seconds into her set (live), else NaN; seconds until it (before), seconds since it ended (after). */
  into: number;
  toLive: number;
  since: number;
  /** 0..1: how hard the crowd's going (hype.ts). */
  energy: number;
  /** Clapping along / a chorus on / phones up now. */
  clap: boolean;
  chorus: boolean;
  /** Where she is (they face her). */
  her: THREE.Vector3;
  /** People to make way for (you, friends, anyone else on the deck there). */
  avoid: readonly { x: number; z: number }[];
  /** Draw them at all (you're out at the party). */
  show: boolean;
}

export class BackCrowd {
  readonly fans: Fan[] = [];
  private body: THREE.InstancedMesh;
  private arms: THREE.InstancedMesh;
  private phones: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private down = new THREE.Vector3(0, -1, 0);
  private up = new THREE.Vector3(0, 1, 0);
  private time = 0;
  /** How many are on the deck now. */
  here = 0;

  constructor(scene: THREE.Scene, count: number, free: (x: number, z: number) => boolean) {
    const spots = backSpots(free, count);
    const n = spots.length;
    let seed = 9137;
    const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    spots.forEach((spot, k) => {
      const entryX = spot.x < STAGE.spot.x + (r() - 0.5) * 3 ? WEST_X : EAST_X;
      this.fans.push({
        spot,
        entryX,
        go: FIRST + (k * ARRIVE_OVER) / Math.max(1, n) + r() * 3,
        back: 2 + r() * 40,
        len: Math.abs(spot.x - entryX),
        energy: 0.6 + r() * 0.6,
        eager: r(),
        lag: (r() - 0.5) * 0.12,
        height: 0.92 + r() * 0.14,
        film: r() < 0.28,
        female: r() < 0.5,
        ox: 0,
        oz: 0,
        x: spot.x,
        z: spot.y,
        here: false,
      });
    });
    const mat = tintedMaterial({ roughness: 0.75, envMapIntensity: 0.5 });
    this.body = new THREE.InstancedMesh(bodyGeometry(), mat, Math.max(1, n));
    this.arms = new THREE.InstancedMesh(armGeometry(), mat, Math.max(1, n * 2));
    this.phones = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.072, 0.145, 0.01),
      new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.3, metalness: 0.5, emissive: 0xb8ccff, emissiveIntensity: 0.9 }),
      Math.max(1, n),
    );
    // Their colours: per instance (bodies once each, arms twice).
    const col = (per: number) => {
      const a = new Float32Array(n * per * 3);
      return { a, set: (i: number, hex: number) => new THREE.Color(hex).toArray(a, i * 3) };
    };
    const bt = col(1),
      bs = col(1),
      bb = col(1),
      bh = col(1);
    const at = col(2),
      as = col(2),
      ab = col(2),
      ah = col(2);
    for (let i = 0; i < n; i++) {
      const top = TOPS[Math.floor(r() * TOPS.length)],
        skin = SKIN[Math.floor(r() * SKIN.length)],
        bottom = BOTTOMS[Math.floor(r() * BOTTOMS.length)],
        hair = HAIR[Math.floor(r() * HAIR.length)];
      bt.set(i, top);
      bs.set(i, skin);
      bb.set(i, bottom);
      bh.set(i, hair);
      for (const j of [i * 2, i * 2 + 1]) {
        at.set(j, top);
        as.set(j, skin);
        ab.set(j, bottom);
        ah.set(j, hair);
      }
    }
    const attach = (mesh: THREE.InstancedMesh, t: Float32Array, s: Float32Array, b: Float32Array, h: Float32Array) => {
      // (Each mesh gets its own copy of the geometry's attributes: arms and bodies differ in count.)
      mesh.geometry = mesh.geometry.clone();
      mesh.geometry.setAttribute('iTop', new THREE.InstancedBufferAttribute(t, 3));
      mesh.geometry.setAttribute('iSkin', new THREE.InstancedBufferAttribute(s, 3));
      mesh.geometry.setAttribute('iBottom', new THREE.InstancedBufferAttribute(b, 3));
      mesh.geometry.setAttribute('iHair', new THREE.InstancedBufferAttribute(h, 3));
    };
    attach(this.body, bt.a, bs.a, bb.a, bh.a);
    attach(this.arms, at.a, as.a, ab.a, ah.a);
    for (const mesh of [this.body, this.arms, this.phones]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.raycast = () => {};
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.visible = false;
      mesh.name = 'back-crowd';
      scene.add(mesh);
    }
  }

  /** Places the fans have (tests, the curious). */
  get size() {
    return this.fans.length;
  }

  update(dt: number, o: BackCrowdUpdate) {
    this.time += dt;
    const b = o.beat;
    let nb = 0,
      na = 0,
      np = 0,
      here = 0;
    const t = Number.isFinite(o.into) ? o.into : o.toLive < 60 ? -o.toLive : NaN;
    for (const f of this.fans) {
      const { f: along, walking, leaving } = backAt(f.go, f.back, f.len, t, Number.isFinite(t) ? NaN : o.since);
      f.here = along > 0;
      if (!f.here) {
        f.ox = f.oz = 0;
        continue;
      }
      here++;
      // Where they are: on their way in (along their row from the deck's edge), or at their place.
      const bx = f.entryX + (f.spot.x - f.entryX) * along,
        bz = f.spot.y;
      // Make way for anyone close (you, friends, someone walking through), then drift back.
      let pushed = false;
      for (const a of o.avoid) {
        const dx = bx + f.ox - a.x,
          dz = bz + f.oz - a.z;
        const d = Math.hypot(dx, dz);
        if (d < REACH && d > 1e-4) {
          const k = (REACH - d) / d;
          f.ox += dx * k;
          f.oz += dz * k;
          pushed = true;
        }
      }
      const off = Math.hypot(f.ox, f.oz);
      if (off > 1.5) {
        f.ox *= 1.5 / off;
        f.oz *= 1.5 / off;
      } else if (!pushed && off > 1e-4) {
        const back = Math.min(off, DRIFT * dt);
        f.ox -= (f.ox / off) * back;
        f.oz -= (f.oz / off) * back;
      }
      const x = (f.x = bx + f.ox),
        z = (f.z = bz + f.oz);
      if (!o.show) continue;

      // Their body: facing her (or the way they're walking), bouncing on the beat, jumping in a chorus.
      const yaw = walking ? (f.entryX < f.spot.x !== leaving ? Math.PI / 2 : -Math.PI / 2) : Math.atan2(o.her.x - x, o.her.z - z);
      const ph = b.beats + f.lag;
      const g = 0.5 + 0.5 * Math.cos(ph * Math.PI * 2);
      const e = walking ? 0 : f.energy * (0.35 + 0.65 * o.energy);
      let y = -0.035 * e * g;
      if (o.chorus && !walking && f.energy > 0.85) y = Math.max(0, -Math.cos(ph * Math.PI * 2)) * 0.13 * e;
      if (walking) y = Math.abs(Math.sin(this.time * 6 + f.go)) * 0.025;
      const sway = walking ? 0 : 0.08 * e * Math.sin(ph * Math.PI);
      this.q.setFromAxisAngle(this.up, yaw + sway * 0.5);
      this.s.setScalar(f.height);
      this.p.set(x, y, z);
      this.body.setMatrixAt(nb++, this.m.compose(this.p, this.q, this.s));

      // Arms: by what the music's doing and who they are.
      const filming = f.film && !walking && (o.chorus || o.energy > 0.55 || f.eager > 0.6) && Number.isFinite(o.into);
      for (const side of [1, -1] as const) {
        const d = this.dir;
        if (walking) d.set(0.1 * side, -1, 0.35 * Math.sin(this.time * 5.2 + f.go + (side > 0 ? 0 : Math.PI)));
        else if (filming && side < 0) d.set(-0.15, 0.32, 1); // the phone held up, screen to them, at her
        else if (o.chorus && f.eager > 0.3) d.set((0.3 + 0.1 * Math.sin(ph * Math.PI + side)) * side, 1, 0.12);
        else if (o.clap) {
          const c = Math.pow(Math.abs(((((ph % 1) + 1) % 1) - 0.5) * 2), 3);
          d.set((0.05 + 0.4 * (1 - c)) * side - 0.25 * side * c, -0.1 + 0.3 * c, 1);
        } else if (o.energy > 0.6 && f.eager > 0.55 && Math.floor(b.bar + f.eager * 3) % 2 === (side > 0 ? 0 : 1)) d.set(0.1 * side, 0.3 + 0.7 * g, 0.4);
        else d.set((0.14 + 0.05 * g * e) * side, -1, 0.25 * e);
        d.normalize();
        this.q2.setFromUnitVectors(this.down, d);
        this.q2.premultiply(this.q);
        this.p.set(SHOULDER.x * side * f.height, SHOULDER.y * f.height + y, 0).applyQuaternion(this.q).add(this.s.set(x, 0, z));
        this.arms.setMatrixAt(na++, this.m.compose(this.p, this.q2, this.s.setScalar(f.height)));
        if (filming && side < 0) {
          // The phone at the hand, upright, its screen toward them.
          const hand = this.p.clone().addScaledVector(d.applyQuaternion(this.q), ARM * f.height);
          this.q2.setFromAxisAngle(this.up, yaw);
          this.phones.setMatrixAt(np++, this.m.compose(hand, this.q2, this.s.setScalar(1)));
        }
      }
    }
    this.here = here;
    const vis = o.show && here > 0;
    for (const [mesh, c] of [
      [this.body, nb],
      [this.arms, na],
      [this.phones, np],
    ] as const) {
      mesh.visible = vis && c > 0;
      mesh.count = c;
      if (c > 0) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** A random fan on the deck now (for a whoop), or null. */
  someone(r: number): Fan | null {
    const here = this.fans.filter((f) => f.here);
    return here.length ? here[Math.floor(r * here.length) % here.length] : null;
  }
}
