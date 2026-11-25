import * as THREE from 'three';
import { Drink, type Lounge } from './lounge';
import type { Throwables } from './throwables';
import type { Hands } from './hands';
import type { Crowd, Person } from './people';
import type { Sound } from './audio';
import type { World } from './world';

/**
 * Drinks obey physics:
 * - Tip a glass past sideways and it pours: a stream of drink falls from the
 *   low side of the rim, splashes whatever it lands on (a puddle grows there),
 *   and soaks anyone underneath (they flinch). Desktop: hold P to pour.
 * - Glasses that meet clink; meet hard and both shatter. Sweep a glass into
 *   others on a table and they get knocked flying.
 * - A thrown glass that hits someone splashes them and bounces off (or breaks
 *   on them if it's going fast).
 * - Two-player: your friend gets soaked on their side too (and you on yours).
 */

interface Drop {
  p: THREE.Vector3;
  v: THREE.Vector3;
  color: THREE.Color;
  landY: number;
  t: number;
  /** Whose pour (to tell your friend they got soaked). */
  mine: boolean;
}

/** Anything that pours when tipped: a glass, a bottle. */
export interface Pourable {
  group: THREE.Object3D;
  level: number;
  setLevel(l: number): void;
  rimHeight: number;
  rimRadius: number;
  color: number;
  /** Your friend's (their side decides how much is left). */
  remote: boolean;
  /** How many glasses it holds (a bottle empties slower). */
  capacity?: number;
}

export interface DrinkPhysicsDeps {
  scene: THREE.Scene;
  camera: THREE.Camera;
  lounge: Lounge;
  throwables: Throwables;
  hands: Hands;
  crowd: Crowd;
  sound: Sound;
  world: World;
  /** Your friend's avatar → tell them they got soaked (two-player). */
  douse?(person: Person, color: number): boolean;
  inXR(): boolean;
}

const MAX_DROPS = 260;
/** Two glasses this close (centres, metres) are touching. */
const TOUCH = 0.085;
const SMASH_SPEED = 3.2;

export class DrinkPhysics {
  private drops: Drop[] = [];
  private mesh: THREE.InstancedMesh;
  private tmp = new THREE.Object3D();
  private pairCool = new Map<string, number>();
  private flinchCool = new WeakMap<Person, number>();
  private time = 0;
  private landCache = new WeakMap<Pourable, { at: THREE.Vector3; y: number; t: number }>();
  /** Other things that pour (bottles you pick up). */
  pourables: (() => Pourable[]) | null = null;
  private veil: THREE.Mesh;
  private veilA = 0;

  constructor(private d: DrinkPhysicsDeps) {
    const geo = new THREE.SphereGeometry(0.006, 5, 4).scale(1, 2.2, 1);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.05, transparent: true, opacity: 0.85 }), MAX_DROPS);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DROPS * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => {};
    d.scene.add(this.mesh);
    // Drink running down your face: drips over your eyes, fading.
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d')!;
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * 128,
        w = 2 + Math.random() * 6,
        h = 30 + Math.random() * 90;
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(255,255,255,0.9)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.roundRect(x, Math.random() * 30, w, h, w / 2);
      g.fill();
    }
    this.veil = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.5),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
    );
    this.veil.position.z = -0.115;
    this.veil.renderOrder = 1998;
    this.veil.visible = false;
    this.veil.raycast = () => {};
    d.camera.add(this.veil);
  }

  /** Drink poured over YOU (by your friend, or yourself). */
  soaked(color: number) {
    this.veilA = 0.85;
    (this.veil.material as THREE.MeshBasicMaterial).color.set(color).lerp(new THREE.Color(0xffffff), 0.35);
    this.d.sound.playLocal('splash', 0.35);
  }

  private inScene(o: THREE.Object3D) {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === this.d.scene) return true;
    return false;
  }

  update(dt: number) {
    this.time += dt;
    const live = [...Drink.all].filter((dr) => this.inScene(dr.group));
    for (const dr of live) this.pour(dr, dt);
    for (const pr of this.pourables?.() ?? []) this.pour(pr, dt);
    this.collide(live);
    this.hitPeople(live);
    this.stepDrops(dt);
    // Desktop: P tips the glass in your hand forward (and back when you let go).
    const desk = live.find((dr) => this.d.lounge.holder(dr)?.desktop);
    if (desk) {
      const want = this.d.lounge.pouringDesktop ? -2.0 : 0.15;
      desk.group.rotation.x += (want - desk.group.rotation.x) * Math.min(1, dt * 6);
    }
    this.veilA = Math.max(0, this.veilA - dt * 0.35);
    this.veil.visible = this.veilA > 0.01;
    (this.veil.material as THREE.MeshBasicMaterial).opacity = this.veilA;
  }

  // -------------------------------------------------------------------------
  // Pouring
  // -------------------------------------------------------------------------

  private pour(dr: Pourable, dt: number) {
    if (dr.level <= 0.005) return;
    const q = dr.group.getWorldQuaternion(new THREE.Quaternion());
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    // Past ~80° from upright it spills; upside down it pours fast.
    if (up.y > 0.17) return;
    const tilt = THREE.MathUtils.clamp((0.17 - up.y) / 1.17, 0, 1);
    const rate = 0.12 + 0.75 * tilt; // glass-fulls per second
    if (!dr.remote) dr.setLevel(dr.level - (rate * dt) / (dr.capacity ?? 1));
    const base = dr.group.getWorldPosition(new THREE.Vector3());
    const side = new THREE.Vector3(up.x, 0, up.z);
    if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
    side.normalize();
    // The lowest point of the rim: out along the tilt, at the rim's height.
    const rim = base.clone().addScaledVector(up, dr.rimHeight).addScaledVector(side, dr.rimRadius * Math.max(0, up.y + 0.3) * 0.6 + dr.rimRadius * 0.4);
    const n = Math.min(6, Math.ceil(rate * dt * 110));
    const landY = this.landing(dr, rim);
    const color = new THREE.Color(dr.color);
    const mine = !dr.remote;
    for (let i = 0; i < n; i++) {
      if (this.drops.length >= MAX_DROPS) this.drops.shift();
      const v = side.clone().multiplyScalar(0.25 + Math.random() * 0.15).add(new THREE.Vector3((Math.random() - 0.5) * 0.08, -0.2, (Math.random() - 0.5) * 0.08));
      const hv = this.d.throwables.velocityOf(dr.group);
      if (hv) v.add(hv);
      this.drops.push({ p: rim.clone().addScaledVector(v, Math.random() * dt), v, color, landY, t: 0, mine });
    }
    if (Math.random() < dt * 4) this.d.sound.play('pour', rim, { volume: 0.25 + tilt * 0.3, rate: 1.2 });
  }

  /** Where the stream lands under a point (cached briefly: one ray every ~0.2 s per glass). */
  private landing(dr: Pourable, at: THREE.Vector3): number {
    const c = this.landCache.get(dr);
    if (c && this.time - c.t < 0.2 && c.at.distanceTo(at) < 0.08) return c.y;
    const y = this.d.throwables.surfaceBelow(at, dr.group);
    this.landCache.set(dr, { at: at.clone(), y, t: this.time });
    return y;
  }

  private stepDrops(dt: number) {
    const h = Math.min(dt, 0.05);
    let k = 0;
    const eye = this.d.camera.getWorldPosition(new THREE.Vector3());
    for (const dp of this.drops) {
      dp.t += dt;
      dp.v.y -= 9.81 * h;
      dp.p.addScaledVector(dp.v, dt);
      // On someone? (heads and shoulders first)
      const who = this.personAt(dp.p);
      if (who) {
        this.flinch(who, dp.color.getHex(), dp.mine);
        dp.t = 99;
        continue;
      }
      // Into your own face (pouring over your head, in VR).
      if (this.d.inXR() && dp.p.distanceTo(eye) < 0.13 && dp.mine) {
        if (this.veilA < 0.4) this.soaked(dp.color.getHex());
        dp.t = 99;
        continue;
      }
      if (dp.p.y <= dp.landY) {
        this.d.throwables.spill(new THREE.Vector3(dp.p.x, dp.landY, dp.p.z), dp.color.getHex(), 0.006);
        dp.t = 99;
        continue;
      }
      this.tmp.position.copy(dp.p);
      this.tmp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dp.v.clone().normalize());
      this.tmp.updateMatrix();
      this.mesh.setMatrixAt(k, this.tmp.matrix);
      this.mesh.setColorAt(k, dp.color);
      k++;
    }
    this.drops = this.drops.filter((dp) => dp.t < 3);
    this.mesh.count = k;
    if (k) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  /** The person whose body is at this point, if any. */
  private personAt(p: THREE.Vector3): Person | null {
    for (const q of this.d.crowd.people) {
      if (q.culled) continue;
      const dx = p.x - q.pos.x,
        dz = p.z - q.pos.z;
      if (dx * dx + dz * dz > 0.2 * 0.2) continue;
      const top = q.pos.y + (q.seated ? 1.35 : 1.85 * (q.look.height / 1.8));
      if (p.y < top && p.y > q.pos.y + 0.3) return q;
    }
    return null;
  }

  /** Someone got hit by drink (or a glass): they flinch, look at you; your friend gets told. */
  private flinch(p: Person, color: number, mine: boolean) {
    if ((this.flinchCool.get(p) ?? 0) > this.time) return;
    this.flinchCool.set(p, this.time + 1.2);
    p.gaspT = 0.9;
    p.attendUntil = this.d.crowd.now + 3;
    this.d.sound.play('gasp', p.pos.clone().setY(p.pos.y + 1.5), { volume: 0.5 });
    this.d.throwables.spill(new THREE.Vector3(p.pos.x + (Math.random() - 0.5) * 0.3, this.d.world.groundAt(p.pos.x, p.pos.z), p.pos.z + (Math.random() - 0.5) * 0.3), color, 0.05);
    if (mine) this.d.douse?.(p, color);
  }

  // -------------------------------------------------------------------------
  // Glass on glass
  // -------------------------------------------------------------------------

  /** A glass's centre and velocity right now. */
  private motion(dr: Drink): { c: THREE.Vector3; v: THREE.Vector3; held: boolean; flying: boolean } {
    const c = dr.group.localToWorld(new THREE.Vector3(0, 0.06, 0));
    const holder = this.d.lounge.holder(dr);
    if (holder?.hand) return { c, v: this.d.hands.velocity(holder.hand), held: true, flying: false };
    const fv = this.d.throwables.velocityOf(dr.group);
    if (fv) return { c, v: fv.clone(), held: false, flying: true };
    return { c, v: new THREE.Vector3(), held: !!holder || dr.remote, flying: false };
  }

  private collide(live: Drink[]) {
    const m = live.map((dr) => ({ dr, ...this.motion(dr) }));
    for (let i = 0; i < m.length; i++)
      for (let j = i + 1; j < m.length; j++) {
        const a = m[i],
          b = m[j];
        if (a.dr.remote && b.dr.remote) continue;
        if (a.c.distanceTo(b.c) > TOUCH) continue;
        const rel = a.v.clone().sub(b.v);
        const s = rel.length();
        if (s < 0.35) continue;
        const key = a.dr.group.uuid + b.dr.group.uuid;
        if ((this.pairCool.get(key) ?? 0) > this.time) continue;
        this.pairCool.set(key, this.time + 0.35);
        const at = a.c.clone().lerp(b.c, 0.5);
        if (s > SMASH_SPEED && !a.dr.remote && !b.dr.remote) {
          // Crashed together: both go.
          for (const x of [a, b]) {
            this.d.lounge.forget(x.dr);
            this.d.throwables.smash(x.dr.group, x.v, x.dr.level > 0.05 ? x.dr.color : null);
          }
          continue;
        }
        this.d.sound.play('clink', at, { volume: Math.min(1, 0.3 + s * 0.25), rate: 0.9 + Math.random() * 0.2 });
        // The faster one knocks the other (if it's loose: on a table, or flying).
        const [hit, by] = a.v.lengthSq() >= b.v.lengthSq() ? [b, a] : [a, b];
        if (hit.held || hit.dr.remote) continue;
        const push = by.v.clone().multiplyScalar(0.7).add(hit.v.clone().multiplyScalar(0.3));
        push.y = Math.max(push.y, 0.4 + Math.random() * 0.4);
        hit.dr.group.position.addScaledVector(by.v.clone().normalize(), 0.02);
        this.d.lounge.throwDrink(hit.dr, push);
      }
  }

  /** Thrown glasses that hit people: a splash, a flinch, a bounce (or a smash on a fast one). */
  private hitPeople(live: Drink[]) {
    for (const dr of live) {
      const v = this.d.throwables.velocityOf(dr.group);
      if (!v || v.length() < 1.2) continue;
      const c = dr.group.localToWorld(new THREE.Vector3(0, 0.06, 0));
      const who = this.personAt(c);
      if (!who) continue;
      const color = dr.color;
      const full = dr.level > 0.05;
      this.flinch(who, color, !dr.remote);
      if (full) {
        // The drink splashes off them.
        for (let i = 0; i < 18 && this.drops.length < MAX_DROPS; i++)
          this.drops.push({ p: c.clone(), v: new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2), color: new THREE.Color(color), landY: this.d.world.groundAt(c.x, c.z), t: 0, mine: false });
        if (!dr.remote) dr.setLevel(0);
      }
      if (v.length() > 5.5) {
        this.d.lounge.forget(dr);
        this.d.throwables.smash(dr.group, v, null);
      } else {
        // Bounce off them and drop.
        const away = new THREE.Vector3(c.x - who.pos.x, 0, c.z - who.pos.z).normalize();
        v.set(away.x * 0.8, Math.min(0.5, v.y * -0.2), away.z * 0.8);
        this.d.sound.play('thunk', c, { volume: 0.6 });
      }
    }
  }
}
