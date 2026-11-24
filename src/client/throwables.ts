import * as THREE from 'three';
import type { World } from './world';
import type { Sound } from './audio';

/**
 * Things you can throw (glasses, mostly). Simple rigid-body flight: gravity,
 * spin, air and water drag; they bounce off walls and the sides of tables and
 * counters, land on whatever surface is under them, and glass breaks if it
 * hits hard enough (crack, shards, a splash of the drink). Slow ones bounce,
 * settle upright-ish and can be picked up again.
 *
 * Surfaces come from short downward raycasts against nearby furniture (cached
 * per body and refreshed as it travels) plus the world's floor heights, so
 * there is no physics engine to load and almost no cost per frame.
 */

export interface ThrowOpts {
  /** Breaks on a hard landing (glass). */
  fragile?: boolean;
  /** Spin, radians per second about each axis. */
  spin?: THREE.Vector3;
  /** Called when it comes to rest (it stays in the scene). */
  onSettle?(obj: THREE.Object3D): void;
  /** Called when it breaks (it has already been removed). */
  onBreak?(at: THREE.Vector3): void;
  /** The drink's colour, for the splash when it breaks. */
  liquid?: number | null;
  /** Radius of the thing (metres). */
  radius?: number;
}

interface Body {
  obj: THREE.Object3D;
  v: THREE.Vector3;
  w: THREE.Vector3;
  o: ThrowOpts;
  surfaceY: number;
  castAt: THREE.Vector2;
  castIn: number;
  candidates: THREE.Object3D[];
  age: number;
  rest: number;
  inWater: boolean;
}

interface Shard {
  m: THREE.Mesh;
  v: THREE.Vector3;
  w: THREE.Vector3;
  t: number;
  floor: number;
}

const G = 9.81;
const BREAK_SPEED = 3.2;

export class Throwables {
  private bodies: Body[] = [];
  private shards: Shard[] = [];
  private spills: { m: THREE.Mesh; t: number }[] = [];
  private ray = new THREE.Raycaster();
  private shardGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.018, 0.004, 0.003), new THREE.Vector3(0.006, 0.022, -0.002)]);
  private shardMat = new THREE.MeshStandardMaterial({ color: 0xe8f4ff, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.7, side: THREE.DoubleSide });

  constructor(
    private d: { scene: THREE.Scene; world: World; sound: Sound; camera: THREE.Camera; isSelf?(o: THREE.Object3D): boolean },
  ) {
    this.shardGeo.computeVertexNormals();
  }

  /** Is this object in flight? */
  flying(obj: THREE.Object3D) {
    return this.bodies.some((b) => b.obj === obj);
  }

  /** Stops simulating an object (someone grabbed it out of the air). */
  catch(obj: THREE.Object3D) {
    this.bodies = this.bodies.filter((b) => b.obj !== obj);
  }

  /** Throws an object (already in the scene, at its start pose) with velocity `v` (m/s, world). */
  throw(obj: THREE.Object3D, v: THREE.Vector3, o: ThrowOpts = {}) {
    this.catch(obj);
    if (obj.parent !== this.d.scene) this.d.scene.attach(obj);
    const p = obj.position;
    const b: Body = {
      obj,
      v: v.clone(),
      w: o.spin?.clone() ?? new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6).multiplyScalar(Math.min(1, v.length() / 4)),
      o,
      surfaceY: this.d.world.groundAt(p.x, p.z),
      castAt: new THREE.Vector2(1e9, 1e9),
      castIn: 0,
      candidates: this.nearby(p),
      age: 0,
      rest: 0,
      inWater: false,
    };
    this.bodies.push(b);
  }

  /** Furniture near the throw that a glass could land on (small meshes only: the floor comes from the world). */
  private nearby(at: THREE.Vector3): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    const s = new THREE.Sphere();
    this.d.scene.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || (o as THREE.Object3D & { isSprite?: boolean }).isSprite) return;
      if (this.d.isSelf?.(o)) return;
      const g = m.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      s.copy(g.boundingSphere!).applyMatrix4(m.matrixWorld);
      if (s.radius > 4.5 || s.center.distanceTo(at) - s.radius > 9) return;
      out.push(m);
    });
    return out;
  }

  /** Height of what's under (x, z) below `fromY`: furniture tops, else the floor. */
  private surfaceUnder(b: Body, x: number, z: number, fromY: number): number {
    let y = this.d.world.groundAt(x, z);
    const water = this.d.world.waterAt(x, z);
    if (water !== null) y = Math.min(y, water);
    if (!b.candidates.length) return this.d.world.groundAt(x, z);
    this.ray.set(new THREE.Vector3(x, fromY + 0.05, z), new THREE.Vector3(0, -1, 0));
    this.ray.far = 4;
    (this.ray as THREE.Raycaster & { camera: THREE.Camera }).camera = this.d.camera;
    const hits = this.ray.intersectObjects(b.candidates, false);
    for (const h of hits) {
      if (isInside(h.object, b.obj)) continue;
      // Only roughly upward-facing surfaces hold a glass.
      const n = h.face?.normal.clone().transformDirection(h.object.matrixWorld);
      if (n && n.y < 0.5) continue;
      return Math.max(this.d.world.groundAt(x, z), h.point.y);
    }
    return this.d.world.groundAt(x, z);
  }

  update(dt: number) {
    const steps = Math.min(4, Math.ceil(dt / 0.012));
    const h = Math.min(dt, 0.1) / steps;
    for (let s = 0; s < steps; s++) for (const b of [...this.bodies]) this.step(b, h);
    this.updateShards(dt);
  }

  private step(b: Body, dt: number) {
    const p = b.obj.position;
    b.age += dt;
    // Water: slows right down and sinks gently.
    const water = this.d.world.waterAt(p.x, p.z);
    const wet = water !== null && p.y < water;
    if (wet && !b.inWater) {
      b.inWater = true;
      this.d.sound.play('splash', p.clone(), { volume: Math.min(1, b.v.length() / 6), rate: 1.8 });
      b.v.multiplyScalar(0.3);
    }
    if (wet) {
      b.v.multiplyScalar(Math.pow(0.15, dt));
      b.v.y -= G * 0.12 * dt;
    } else {
      b.v.y -= G * dt;
      b.v.multiplyScalar(1 - 0.06 * dt);
    }
    const nx = p.x + b.v.x * dt,
      nz = p.z + b.v.z * dt;
    let ny = p.y + b.v.y * dt;
    // Refresh what's under it now and then (and whenever it has moved a bit).
    b.castIn -= dt;
    if (b.castIn <= 0 || b.castAt.distanceTo(new THREE.Vector2(nx, nz)) > 0.18) {
      const under = this.surfaceUnder(b, nx, nz, Math.max(p.y, ny) + 0.02);
      // Something taller than us appeared in the way: we hit its side.
      if (under > p.y + 0.03 && under > b.surfaceY + 0.05) {
        b.v.x *= -0.3;
        b.v.z *= -0.3;
        this.impact(b, Math.hypot(b.v.x, b.v.z) / 0.3);
        if (!this.bodies.includes(b)) return;
        b.castIn = 0;
        return;
      }
      b.surfaceY = under;
      b.castAt.set(nx, nz);
      b.castIn = 0.05;
    }
    // Walls (the edges of where you can walk) turn it back.
    if (!this.d.world.isInside(nx, nz) && this.d.world.isInside(p.x, p.z)) {
      const speed = Math.hypot(b.v.x, b.v.z);
      if (!this.d.world.isInside(nx, p.z)) b.v.x *= -0.35;
      if (!this.d.world.isInside(p.x, nz)) b.v.z *= -0.35;
      this.impact(b, speed);
      return;
    }
    p.x = nx;
    p.z = nz;
    // Landing.
    if (ny <= b.surfaceY) {
      ny = b.surfaceY;
      const down = -b.v.y;
      if (down > 0.6) {
        this.impact(b, Math.hypot(down, Math.hypot(b.v.x, b.v.z) * 0.6));
        if (!this.bodies.includes(b)) return;
      }
      b.v.y = down > 0.8 ? down * 0.22 : 0;
      b.v.x *= 0.55;
      b.v.z *= 0.55;
      b.w.multiplyScalar(0.5);
      // Tipping back up as it settles.
      const e = new THREE.Euler().setFromQuaternion(b.obj.quaternion, 'YXZ');
      e.x *= 0.6;
      e.z *= 0.6;
      b.obj.quaternion.setFromEuler(e);
      if (b.v.length() < 0.25) {
        b.rest += dt;
        if (b.rest > 0.15) return this.settle(b, ny);
      }
    }
    p.y = ny;
    // Spin.
    const wl = b.w.length();
    if (wl > 1e-3) b.obj.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(b.w.clone().divideScalar(wl), wl * dt));
    // Lost (fell out of the world): drop it.
    if (p.y < -20 || b.age > 20) {
      this.bodies.splice(this.bodies.indexOf(b), 1);
      b.obj.removeFromParent();
    }
  }

  private settle(b: Body, y: number) {
    this.bodies.splice(this.bodies.indexOf(b), 1);
    const e = new THREE.Euler().setFromQuaternion(b.obj.quaternion, 'YXZ');
    b.obj.rotation.set(0, e.y, 0);
    b.obj.position.y = y;
    b.o.onSettle?.(b.obj);
  }

  /** It hit something at `speed` (m/s): glass breaks above a threshold, else it knocks. */
  private impact(b: Body, speed: number) {
    const at = b.obj.getWorldPosition(new THREE.Vector3());
    if (b.o.fragile && speed > BREAK_SPEED && !b.inWater) {
      this.bodies.splice(this.bodies.indexOf(b), 1);
      b.obj.removeFromParent();
      this.shatter(at, b.v, b.o.liquid ?? null);
      b.o.onBreak?.(at);
      return;
    }
    if (speed > 0.8) this.d.sound.play('thunk', at, { volume: Math.min(1, speed / 4), rate: 0.9 + Math.random() * 0.3 });
  }

  /** Glass shards fly, the drink spills. */
  shatter(at: THREE.Vector3, v: THREE.Vector3, liquid: number | null) {
    this.d.sound.play('shatter', at.clone(), { volume: 1, rate: 0.9 + Math.random() * 0.25 });
    const floor = this.d.world.groundAt(at.x, at.z);
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(this.shardGeo, this.shardMat);
      m.position.copy(at).add(new THREE.Vector3(0, 0.03, 0));
      m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      m.scale.setScalar(0.6 + Math.random() * 0.9);
      m.raycast = () => {};
      this.d.scene.add(m);
      const sv = new THREE.Vector3((Math.random() - 0.5) * 3, 0.8 + Math.random() * 2, (Math.random() - 0.5) * 3).addScaledVector(v, 0.25);
      this.shards.push({ m, v: sv, w: new THREE.Vector3(Math.random() * 20, Math.random() * 20, Math.random() * 20), t: 0, floor: at.y > floor + 0.3 ? at.y - 0.01 : floor });
    }
    if (liquid !== null) {
      const m = new THREE.Mesh(
        new THREE.CircleGeometry(0.16 + Math.random() * 0.08, 18).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: liquid, roughness: 0.05, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      );
      m.position.set(at.x, Math.max(floor, at.y - 0.02) + 0.004, at.z);
      m.scale.set(1, 1, 0.75 + Math.random() * 0.4);
      m.raycast = () => {};
      this.d.scene.add(m);
      this.spills.push({ m, t: 0 });
    }
  }

  private updateShards(dt: number) {
    for (const s of [...this.shards]) {
      s.t += dt;
      if (s.m.position.y > s.floor + 0.002) {
        s.v.y -= G * dt;
        s.m.position.addScaledVector(s.v, dt);
        s.m.rotation.x += s.w.x * dt;
        s.m.rotation.y += s.w.y * dt;
        if (s.m.position.y <= s.floor) {
          s.m.position.y = s.floor + 0.002;
          s.v.set(0, 0, 0);
        }
      }
      // Shards linger a while on the floor, then get swept up.
      if (s.t > 12) {
        s.m.removeFromParent();
        this.shards.splice(this.shards.indexOf(s), 1);
      }
    }
    for (const s of [...this.spills]) {
      s.t += dt;
      const mat = s.m.material as THREE.MeshStandardMaterial;
      if (s.t > 10) mat.opacity = Math.max(0, 0.55 * (1 - (s.t - 10) / 6));
      if (s.t > 16) {
        s.m.removeFromParent();
        s.m.geometry.dispose();
        mat.dispose();
        this.spills.splice(this.spills.indexOf(s), 1);
      }
    }
  }
}

function isInside(o: THREE.Object3D, root: THREE.Object3D) {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true;
  return false;
}
