import * as THREE from 'three';

/**
 * Loose-object physics: small things you can pick up, throw, knock over and
 * sweep off a table (chips, dice, bottles, fruit, napkins, menus, ashtrays,
 * ice buckets). No physics engine: each body is a simple shape (cylinder, box
 * or sphere, origin at the middle of its base) that flies under gravity with
 * spin, lands on whatever is under it, bounces, slides with friction (or
 * rolls, if round), tips over onto its most natural resting face and goes to
 * sleep. Sleeping bodies cost nothing; only what moves is simulated.
 *
 * Bodies stack (chips on chips, a bottle in an ice bucket, fruit in a bowl)
 * and knock each other (momentum-conserving impulses in the horizontal plane);
 * knock the bottom of a stack and the ones on top lose their support and fall.
 * Hands and other flying things push bodies with `sweep`.
 *
 * The world around them comes in through `LooseEnv` (floor, water, walls,
 * furniture tops), so this file has no scene and is unit-tested on its own.
 */

export type LooseShape = { type: 'cyl'; r: number; h: number } | { type: 'box'; x: number; y: number; z: number } | { type: 'sphere'; r: number };

export interface LooseSpec {
  name: string;
  shape: LooseShape;
  /** kg */
  mass: number;
  /** Restitution on a hard surface, 0..1. */
  bounce: number;
  /** Sliding friction coefficient. */
  friction: number;
  /** Breaks on an impact faster than this (m/s). */
  fragile?: number;
  /** Air drag per second (napkins flutter down). */
  drag?: number;
  /** How high things resting on top of it sit above its base (a bowl's floor, a chip's thickness). Defaults to its height. */
  carry?: number;
  /** Floats on water. */
  floats?: boolean;
  /** How much a bounce sets it tumbling (dice tumble, napkins don't). */
  tumble?: number;
}

export interface LooseEnv {
  /** The floor (or pool bottom) at (x, z). */
  ground(x: number, z: number): number;
  /** Water surface height at (x, z), if there's water. */
  water(x: number, z: number): number | null;
  /** Inside the walls (where you can walk). */
  inside(x: number, z: number): boolean;
  /** Furniture footprint (a table, the bar) at (x, z)? */
  blocked(x: number, z: number): boolean;
  /** The highest furniture top at (x, z) that isn't above `fromY` (soft: a cushion). May be slow: cached as bodies travel. */
  top(x: number, z: number, fromY: number): { y: number; soft?: boolean } | null;
  /** Cheap declared tops, checked every step (so a chip skimming onto a table edge finds it). */
  topFast?(x: number, z: number, fromY: number): { y: number; soft?: boolean } | null;
}

export type LooseEvent =
  | { type: 'impact'; body: LooseBody; speed: number; other: LooseBody | null; soft: boolean }
  | { type: 'break'; body: LooseBody; at: THREE.Vector3; v: THREE.Vector3 }
  | { type: 'settle'; body: LooseBody }
  | { type: 'wake'; body: LooseBody; by: LooseBody | null };

export const G = 9.81;
const UP = new THREE.Vector3(0, 1, 0);

export class LooseBody {
  /** Middle of the base, world. */
  readonly pos = new THREE.Vector3();
  readonly q = new THREE.Quaternion();
  readonly v = new THREE.Vector3();
  /** Angular velocity (rad/s, world axes). */
  readonly w = new THREE.Vector3();
  awake = false;
  /** In someone's hand: not simulated, not a support. */
  held = false;
  /** Broken (or otherwise removed for good). */
  gone = false;
  /** The body it sits on, if any. */
  restOn: LooseBody | null = null;
  /** Its motion was caused by you (not your friend): tell them about it. */
  mine = false;
  inWater = false;
  /** Seconds in a row it has been nearly still. */
  restT = 0;
  /** Seconds since it was last woken. */
  age = 0;
  sweepCool = 0;
  /** Cached furniture top under it (refreshed as it travels). */
  surf: { y: number; soft: boolean } = { y: -Infinity, soft: false };
  castX = 1e9;
  castZ = 1e9;
  castIn = 0;
  /** Anything the game wants to hang on it. */
  data: Record<string, unknown> = {};

  constructor(
    readonly spec: LooseSpec,
    readonly id: string,
  ) {}

  /** Local up axis in world space. */
  axis(out = new THREE.Vector3()) {
    return out.copy(UP).applyQuaternion(this.q);
  }
}

/** Shape extents for an orientation: centre height above the origin (local), half-heights. */
export interface Extents {
  /** Centre of the shape, world. */
  c: THREE.Vector3;
  /** Vertical half-extent. */
  ey: number;
  /** Horizontal radius (from the centre). */
  eh: number;
}

const _ax = new THREE.Vector3(),
  _ay = new THREE.Vector3(),
  _az = new THREE.Vector3();

/** Where the shape is for a body at `pos` with orientation `q`. */
export function extents(shape: LooseShape, pos: THREE.Vector3, q: THREE.Quaternion, out?: Extents): Extents {
  const e = out ?? { c: new THREE.Vector3(), ey: 0, eh: 0 };
  _ay.set(0, 1, 0).applyQuaternion(q);
  if (shape.type === 'cyl') {
    const s = Math.sqrt(Math.max(0, 1 - _ay.y * _ay.y));
    e.c.copy(pos).addScaledVector(_ay, shape.h / 2);
    e.ey = (shape.h / 2) * Math.abs(_ay.y) + shape.r * s;
    e.eh = (shape.h / 2) * s + shape.r;
  } else if (shape.type === 'sphere') {
    e.c.copy(pos).addScaledVector(_ay, shape.r);
    e.ey = shape.r;
    e.eh = shape.r;
  } else {
    _ax.set(1, 0, 0).applyQuaternion(q);
    _az.set(0, 0, 1).applyQuaternion(q);
    e.c.copy(pos).addScaledVector(_ay, shape.y);
    e.ey = Math.abs(_ax.y) * shape.x + Math.abs(_ay.y) * shape.y + Math.abs(_az.y) * shape.z;
    const ex = Math.abs(_ax.x) * shape.x + Math.abs(_ay.x) * shape.y + Math.abs(_az.x) * shape.z;
    const ez = Math.abs(_ax.z) * shape.x + Math.abs(_ay.z) * shape.y + Math.abs(_az.z) * shape.z;
    e.eh = Math.max(ex, ez);
  }
  return e;
}

/** Full height of the shape standing in its natural pose (what sits on it sits this high). */
export function standingHeight(shape: LooseShape) {
  return shape.type === 'cyl' ? shape.h : shape.type === 'sphere' ? shape.r * 2 : shape.y * 2;
}

/**
 * The orientation it comes to rest in from `q`: a cylinder stays upright (or
 * upside down) while its centre of mass is over its base, otherwise it falls
 * onto its side (if it's taller than wide; coins fall flat); a box lands on the
 * face nearest the floor; a ball rests any way up.
 */
export function restingQuat(shape: LooseShape, q: THREE.Quaternion, out = new THREE.Quaternion()): THREE.Quaternion {
  out.copy(q);
  if (shape.type === 'sphere') return out;
  const toward = (local: THREE.Vector3, world: THREE.Vector3) => {
    const cur = local.clone().applyQuaternion(q);
    return new THREE.Quaternion().setFromUnitVectors(cur, world).multiply(q);
  };
  if (shape.type === 'cyl') {
    const u = _ay.set(0, 1, 0).applyQuaternion(q);
    const tilt = Math.acos(Math.min(1, Math.abs(u.y)));
    const critical = Math.atan2(shape.r, shape.h / 2);
    const canLie = shape.h > shape.r * 1.4;
    if (tilt < critical || !canLie) return out.copy(toward(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, Math.sign(u.y) || 1, 0)));
    const flat = new THREE.Vector3(u.x, 0, u.z);
    if (flat.lengthSq() < 1e-8) flat.set(1, 0, 0);
    return out.copy(toward(new THREE.Vector3(0, 1, 0), flat.normalize()));
  }
  // Box: whichever local axis is most vertical goes vertical.
  const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  let best = axes[1],
    bd = -1,
    sign = 1;
  // A thin thing (a napkin, a menu) can't stand on its edge: weight each face by its area.
  const area = [shape.y * shape.z, shape.x * shape.z, shape.x * shape.y];
  const amax = Math.max(...area);
  for (let i = 0; i < 3; i++) {
    const a = axes[i];
    const y = a.clone().applyQuaternion(q).y;
    // (Far thinner than wide: it always ends on a big face.)
    const score = area[i] / amax < 0.2 ? -1 : Math.abs(y) * Math.pow(area[i] / amax, 0.5);
    if (score > bd) {
      bd = score;
      best = a;
      sign = Math.sign(y) || 1;
    }
  }
  return out.copy(toward(best, new THREE.Vector3(0, sign, 0)));
}

/** Is it lying on its side (a bottle knocked over)? Lying cylinders roll across their axis. */
export function lyingOnSide(shape: LooseShape, q: THREE.Quaternion) {
  return shape.type === 'cyl' && Math.abs(_ay.set(0, 1, 0).applyQuaternion(q).y) < 0.5;
}

export class LooseSim {
  readonly bodies: LooseBody[] = [];
  onEvent: ((e: LooseEvent) => void) | null = null;
  private ex: Extents = { c: new THREE.Vector3(), ey: 0, eh: 0 };
  private ex2: Extents = { c: new THREE.Vector3(), ey: 0, eh: 0 };
  private rnd: () => number;

  constructor(
    private env: LooseEnv,
    seed = 1,
  ) {
    let s = seed >>> 0 || 1;
    this.rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  }

  add(spec: LooseSpec, id: string, at: THREE.Vector3, yaw = 0): LooseBody {
    const b = new LooseBody(spec, id);
    b.pos.copy(at);
    b.q.setFromAxisAngle(UP, yaw);
    this.bodies.push(b);
    return b;
  }

  /**
   * Puts a body down asleep on whatever is under (x, z): furniture or another
   * loose body (so build stacks bottom first).
   */
  place(b: LooseBody, x: number, z: number, fromY: number) {
    b.pos.x = x;
    b.pos.z = z;
    b.pos.y = fromY;
    b.q.copy(restingQuat(b.spec.shape, b.q));
    const s = this.support(b, x, z, fromY + 0.002, true);
    const e = extents(b.spec.shape, b.pos, b.q, this.ex);
    b.pos.y += s.y - (e.c.y - e.ey);
    b.restOn = s.on;
    b.awake = false;
    b.v.set(0, 0, 0);
    b.w.set(0, 0, 0);
  }

  get awakeCount() {
    let n = 0;
    for (const b of this.bodies) if (b.awake && !b.held && !b.gone) n++;
    return n;
  }

  /** Wakes a body (and whatever sits on it). */
  wake(b: LooseBody, by: LooseBody | null = null, mine = b.mine) {
    if (b.gone || b.held) return;
    if (!b.awake) {
      b.awake = true;
      b.restT = 0;
      b.age = 0;
      b.castIn = 0;
      b.mine = mine;
      this.onEvent?.({ type: 'wake', body: b, by });
    } else if (mine) b.mine = true;
    b.restOn = null;
    for (const o of this.bodies) if (o.restOn === b && !o.held) this.wake(o, b, mine);
  }

  /** Throws (or drops, with v = 0) a body from its current pose. */
  launch(b: LooseBody, v: THREE.Vector3, w?: THREE.Vector3, mine = true) {
    b.held = false;
    b.gone = false;
    b.v.copy(v);
    const s = Math.min(1, v.length() / 4);
    if (w) b.w.copy(w);
    else b.w.set((this.rnd() - 0.5) * 8 * s, (this.rnd() - 0.5) * 6 * s, (this.rnd() - 0.5) * 8 * s);
    b.awake = false;
    this.wake(b, null, mine);
    b.mine = mine;
  }

  /** Picked up: out of the simulation until it's thrown or dropped. */
  hold(b: LooseBody) {
    for (const o of this.bodies) if (o.restOn === b) this.wake(o, b);
    b.held = true;
    b.awake = false;
    b.restOn = null;
  }

  /** Takes a body out for good (it broke). */
  remove(b: LooseBody) {
    for (const o of this.bodies) if (o.restOn === b) this.wake(o, b);
    b.gone = true;
    b.awake = false;
    const i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
  }

  /**
   * Something moving through space (a hand, a flying glass) pushes whatever it
   * touches. `p` is its centre, `r` its radius, `v` its velocity. Returns the
   * bodies it pushed.
   */
  sweep(p: THREE.Vector3, v: THREE.Vector3, r: number, mine: boolean, minSpeed = 0.6, skip?: LooseBody): LooseBody[] {
    const sp = v.length();
    if (sp < minSpeed) return [];
    const out: LooseBody[] = [];
    for (const b of this.bodies) {
      if (b.held || b.gone || b === skip || b.sweepCool > 0) continue;
      const e = extents(b.spec.shape, b.pos, b.q, this.ex);
      const dx = e.c.x - p.x,
        dz = e.c.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > e.eh + r || p.y < e.c.y - e.ey - r || p.y > e.c.y + e.ey + r) continue;
      // Moving toward it (or straight through it).
      if (d > 1e-4 && (dx * v.x + dz * v.z) / d < -0.05 * sp) continue;
      this.wake(b, null, mine);
      // Light things get batted further than heavy ones.
      const k = THREE.MathUtils.clamp(0.35 / Math.sqrt(b.spec.mass + 0.05), 0.5, 1.15);
      b.v.set(v.x * k, Math.max(b.v.y, Math.max(0.1, v.y * k) + 0.12 * sp * k), v.z * k);
      const across = new THREE.Vector3(v.z, 0, -v.x).normalize();
      b.w.addScaledVector(across, -sp * 6 * (b.spec.tumble ?? 1)).add(new THREE.Vector3(0, (this.rnd() - 0.5) * 6, 0));
      b.sweepCool = 0.12;
      out.push(b);
    }
    return out;
  }

  /** Furniture or another body under (x, z), no higher than fromY. */
  private support(b: LooseBody, x: number, z: number, fromY: number, fresh = false, bodyFromY = fromY): { y: number; soft: boolean; on: LooseBody | null } {
    let y = this.env.ground(x, z);
    let soft = false;
    // Near what it's about to land on, look often; in flight, now and then.
    const close = fromY - b.surf.y < 0.15;
    if (fresh || b.castIn <= 0 || Math.hypot(x - b.castX, z - b.castZ) > (close ? 0.04 : 0.2)) {
      const t = this.env.top(x, z, fromY);
      b.surf = t ? { y: t.y, soft: !!t.soft } : { y: -Infinity, soft: false };
      b.castX = x;
      b.castZ = z;
      b.castIn = 0.1;
    }
    if (b.surf.y > y && b.surf.y <= fromY + 0.01) {
      y = b.surf.y;
      soft = b.surf.soft;
    }
    const fast = this.env.topFast?.(x, z, fromY);
    if (fast && fast.y > y) {
      y = fast.y;
      soft = !!fast.soft;
    }
    let on: LooseBody | null = null;
    for (const o of this.bodies) {
      if (o === b || o.held || o.gone || o.restOn === b) continue;
      if (Math.abs(o.pos.x - x) > 0.45 || Math.abs(o.pos.z - z) > 0.45) continue;
      const e = extents(o.spec.shape, o.pos, o.q, this.ex2);
      if (Math.hypot(x - e.c.x, z - e.c.z) > e.eh * 0.9) continue;
      const low = e.c.y - e.ey;
      // Upright things carry others at their carry height; lying ones on their top.
      const upright = Math.abs(o.axis(_az).y) > 0.9;
      const top = upright && o.spec.carry !== undefined ? low + o.spec.carry : e.c.y + e.ey;
      if (top <= bodyFromY + 0.004 && top > y) {
        y = top;
        soft = false;
        on = o;
      }
    }
    return { y, soft, on };
  }

  update(dt: number) {
    const steps = Math.min(6, Math.max(1, Math.ceil(dt / 0.01)));
    const h = Math.min(dt, 0.1) / steps;
    for (let s = 0; s < steps; s++) {
      for (const b of [...this.bodies]) if (b.awake && !b.held && !b.gone) this.step(b, h);
      this.collide();
    }
    for (const b of this.bodies) if (b.sweepCool > 0) b.sweepCool -= dt;
  }

  private step(b: LooseBody, dt: number) {
    const sp = b.spec;
    b.age += dt;
    const p = b.pos;
    // Water: things sink slowly or float.
    const e0 = extents(sp.shape, p, b.q, this.ex);
    const water = this.env.water(e0.c.x, e0.c.z);
    const wet = water !== null && e0.c.y < water;
    if (wet && !b.inWater) {
      b.inWater = true;
      this.onEvent?.({ type: 'impact', body: b, speed: -b.v.y, other: null, soft: true });
      b.v.multiplyScalar(0.3);
    } else if (!wet && water === null) b.inWater = false;
    if (wet) {
      b.v.multiplyScalar(Math.pow(0.12, dt));
      b.w.multiplyScalar(Math.pow(0.2, dt));
      if (sp.floats) {
        b.v.y += (water! - e0.c.y) * 40 * dt;
        if (Math.abs(water! - e0.c.y) < 0.01 && b.v.length() < 0.05) return this.sleep(b, null);
      } else b.v.y -= G * 0.15 * dt;
    } else {
      b.v.y -= G * dt;
      if (sp.drag) b.v.multiplyScalar(Math.max(0, 1 - sp.drag * dt));
      else b.v.multiplyScalar(1 - 0.02 * dt);
    }
    // Spin.
    const wl = b.w.length();
    if (wl > 1e-4) b.q.premultiply(new THREE.Quaternion().setFromAxisAngle(b.w.clone().divideScalar(wl), wl * dt)).normalize();
    const nx = p.x + b.v.x * dt,
      nz = p.z + b.v.z * dt;
    const ny = p.y + b.v.y * dt;
    // Walls turn it back.
    if (!this.env.inside(nx, nz) && this.env.inside(p.x, p.z)) {
      const speed = Math.hypot(b.v.x, b.v.z);
      if (!this.env.inside(nx, p.z)) b.v.x *= -0.4;
      if (!this.env.inside(p.x, nz)) b.v.z *= -0.4;
      this.impact(b, speed, null, false);
      return;
    }
    b.castIn -= dt;
    const e1 = extents(sp.shape, p, b.q, this.ex2);
    const oldLow = e1.c.y - e1.ey,
      oldX = e1.c.x,
      oldZ = e1.c.z;
    const e = extents(sp.shape, new THREE.Vector3(nx, ny, nz), b.q, this.ex);
    const low = e.c.y - e.ey;
    // Running into the side of a table or the bar: bounce off it rather than pass through.
    if (this.env.blocked(e.c.x, e.c.z) && !this.env.blocked(oldX, oldZ)) {
      const t = this.env.topFast?.(e.c.x, e.c.z, low + 1.2) ?? this.env.top(e.c.x, e.c.z, low + 1.2);
      const topY = t ? t.y : 1.0;
      if (topY > low + 0.025 && oldLow < topY - 0.01 && topY > this.env.ground(e.c.x, e.c.z) + 0.05) {
        const speed = Math.hypot(b.v.x, b.v.z);
        b.v.x *= -0.35;
        b.v.z *= -0.35;
        b.castIn = 0;
        p.y = ny;
        this.impact(b, speed, null, false);
        return;
      }
    }
    p.set(nx, ny, nz);
    const s = this.support(b, e.c.x, e.c.z, Math.max(low, oldLow) + 0.02, false, Math.max(low, oldLow));
    let contact = false;
    if (low <= s.y + 0.0005) {
      p.y += s.y - low;
      contact = true;
      const vn = -b.v.y;
      const vh = Math.hypot(b.v.x, b.v.z);
      if (vn > 0.35) {
        this.impact(b, Math.hypot(vn, vh * 0.5), s.on, s.soft);
        if (b.gone) return;
      }
      const e = sp.bounce * (s.soft ? 0.25 : 1);
      if (vn > 0) {
        b.v.y = vn > 0.6 ? vn * e : 0;
        // Friction from the landing impulse.
        if (vh > 1e-4 && vn > 0.6) {
          const cut = Math.min(vh, sp.friction * (1 + e) * vn * 0.5);
          b.v.x -= (b.v.x / vh) * cut;
          b.v.z -= (b.v.z / vh) * cut;
        }
        // A hard bounce sets it tumbling.
        if (vn > 0.8 && (sp.tumble ?? 0) > 0) b.w.add(new THREE.Vector3(this.rnd() - 0.5, 0, this.rnd() - 0.5).multiplyScalar(vn * 10 * (sp.tumble ?? 0)));
        if (s.soft) b.w.multiplyScalar(0.4);
      }
    }
    // Sliding off an edge: it tips over the edge as it goes.
    if (!contact && b.data.contact) {
      const vh = Math.hypot(b.v.x, b.v.z);
      if (vh > 0.05 && sp.shape.type !== 'sphere') b.w.add(new THREE.Vector3(b.v.z, 0, -b.v.x).multiplyScalar(Math.min(12, 2.5 / Math.max(0.03, e.ey))));
    }
    b.data.contact = contact;
    // Resting on something (or close enough): slide, roll, tip onto its resting face.
    if (contact && b.v.y <= 0.01) {
      b.v.y = 0;
      const vh = Math.hypot(b.v.x, b.v.z);
      const rolling = sp.shape.type === 'sphere' || lyingOnSide(sp.shape, b.q);
      if (vh > 1e-5) {
        let decel = (rolling ? 0.6 : sp.friction * G * (s.soft ? 2 : 1)) * dt;
        if (rolling && sp.shape.type === 'cyl') {
          // A lying bottle rolls across its axis and slides along it.
          const u = b.axis(_az).setY(0).normalize();
          const along = b.v.x * u.x + b.v.z * u.z;
          const cut = Math.min(Math.abs(along), sp.friction * G * dt);
          b.v.x -= u.x * Math.sign(along) * cut;
          b.v.z -= u.z * Math.sign(along) * cut;
          decel = 0.6 * dt;
        }
        const vh2 = Math.hypot(b.v.x, b.v.z);
        const k = vh2 > 1e-6 ? Math.max(0, vh2 - decel) / vh2 : 0;
        b.v.x *= k;
        b.v.z *= k;
      }
      if (rolling) {
        // Roll without slipping.
        const r = sp.shape.type === 'sphere' ? sp.shape.r : (sp.shape as { r: number }).r;
        b.w.set(b.v.z / r, 0, -b.v.x / r);
        if (sp.shape.type === 'cyl') {
          const u = b.axis(_az).setY(0).normalize();
          b.w.copy(u).multiplyScalar(b.w.dot(u));
        }
      } else {
        b.w.multiplyScalar(Math.exp(-dt * 10));
        // Tip toward the resting orientation, keeping the lowest point on the surface.
        const target = restingQuat(sp.shape, b.q);
        b.q.slerp(target, 1 - Math.exp(-dt * 9));
      }
      if (sp.shape.type === 'cyl' && rolling) b.q.slerp(restingQuat(sp.shape, b.q), 1 - Math.exp(-dt * 9));
      const e2 = extents(sp.shape, p, b.q, this.ex2);
      p.y += s.y - (e2.c.y - e2.ey);
      const still = b.v.lengthSq() < 0.03 * 0.03 && (rolling || b.w.lengthSq() < 0.5);
      const settled = rolling || restingQuat(sp.shape, b.q).angleTo(b.q) < 0.03;
      if (still && settled) {
        b.restT += dt;
        if (b.restT > 0.2) return this.sleep(b, s.on, s.y);
      } else b.restT = 0;
    }
    // Lost (fell out of the world, or rolled forever).
    if (p.y < -20 || b.age > 25) {
      if (p.y < -20) this.remove(b);
      else this.sleep(b, null);
    }
  }

  private sleep(b: LooseBody, on: LooseBody | null, y?: number) {
    b.awake = false;
    b.v.set(0, 0, 0);
    b.w.set(0, 0, 0);
    b.restT = 0;
    if (!b.inWater) {
      b.q.copy(restingQuat(b.spec.shape, b.q));
      if (y !== undefined) {
        const e = extents(b.spec.shape, b.pos, b.q, this.ex);
        b.pos.y += y - (e.c.y - e.ey);
      }
    }
    b.restOn = on;
    this.onEvent?.({ type: 'settle', body: b });
  }

  /** It hit something at `speed`: fragile things break above their limit. */
  private impact(b: LooseBody, speed: number, other: LooseBody | null, soft: boolean) {
    const lim = b.spec.fragile;
    if (lim !== undefined && !b.inWater && speed > lim * (soft ? 2.5 : 1)) {
      const at = extents(b.spec.shape, b.pos, b.q, this.ex).c.clone();
      const v = b.v.clone();
      this.remove(b);
      this.onEvent?.({ type: 'break', body: b, at, v });
      return;
    }
    if (speed > 0.25) this.onEvent?.({ type: 'impact', body: b, speed, other, soft });
  }

  /** Bodies that run into each other trade momentum (horizontally) and get knocked. */
  private collide() {
    const list = this.bodies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.awake || a.held || a.gone) continue;
      const ea = extents(a.spec.shape, a.pos, a.q, this.ex);
      for (let j = 0; j < list.length; j++) {
        const b = list[j];
        if (b === a || b.held || b.gone || (b.awake && j < i)) continue;
        if (a.restOn === b || b.restOn === a) continue;
        if (Math.abs(a.pos.x - b.pos.x) > 0.7 || Math.abs(a.pos.z - b.pos.z) > 0.7 || Math.abs(a.pos.y - b.pos.y) > 0.7) continue;
        const eb = extents(b.spec.shape, b.pos, b.q, this.ex2);
        const dx = eb.c.x - ea.c.x,
          dz = eb.c.z - ea.c.z;
        const d = Math.hypot(dx, dz);
        const reach = ea.eh + eb.eh;
        if (d >= reach) continue;
        const aLow = ea.c.y - ea.ey,
          bLow = eb.c.y - eb.ey;
        // Vertical overlap (a little slack so neighbours in a stack don't fight).
        if (aLow > eb.c.y + eb.ey - 0.003 || bLow > ea.c.y + ea.ey - 0.003) continue;
        // One sitting on (or in) the other: that's support, not a knock.
        const carryB = b.spec.carry ?? standingHeight(b.spec.shape);
        const carryA = a.spec.carry ?? standingHeight(a.spec.shape);
        if (aLow >= bLow + carryB - 0.004 && d < eb.eh) continue;
        if (bLow >= aLow + carryA - 0.004 && d < ea.eh) continue;
        const n = d > 1e-5 ? new THREE.Vector3(dx / d, 0, dz / d) : new THREE.Vector3(1, 0, 0);
        const ma = a.spec.mass,
          mb = b.spec.mass;
        const rel = (a.v.x - b.v.x) * n.x + (a.v.z - b.v.z) * n.z;
        const overlap = reach - d;
        // Push apart (the sleeping one only once it's woken).
        if (rel > 0.05) {
          const e = Math.min(a.spec.bounce, b.spec.bounce) * 0.8 + 0.1;
          const jn = ((1 + e) * rel) / (1 / ma + 1 / mb);
          a.v.addScaledVector(n, -jn / ma);
          if (!b.awake) this.wake(b, a, a.mine);
          b.v.addScaledVector(n, jn / mb);
          // A knock pops light things up a little and sets them spinning.
          b.v.y += Math.min(0.6, rel * 0.15);
          b.w.add(new THREE.Vector3(n.z, (this.rnd() - 0.5) * 2, -n.x).multiplyScalar(rel * 8 * (b.spec.tumble ?? 1)));
          this.impact(a, rel, b, false);
          if (!b.gone) this.impact(b, rel, a, false);
          if (a.gone) break;
        }
        if (a.gone || b.gone) continue;
        const share = b.awake ? ma / (ma + mb) : 1;
        a.pos.addScaledVector(n, -overlap * share);
        if (b.awake) b.pos.addScaledVector(n, overlap * (1 - share));
      }
    }
  }
}

/**
 * Tops of furniture that loose things rest on (the bar counter, cocktail
 * tables, the pool bar's ledge, cabana cushions), declared where the furniture
 * is built. Merged scenery can't be raycast cheaply, so these are what make a
 * thrown chip land on the bar instead of falling through to the floor.
 */
export class Surfaces {
  private list: { kind: 'box' | 'disc' | 'ring'; x: number; z: number; a: number; b: number; cos: number; sin: number; y: number; soft: boolean }[] = [];

  /** A rectangle w × d centred on (x, z), turned by yaw, top at y. */
  box(x: number, z: number, w: number, d: number, y: number, yaw = 0, soft = false) {
    this.list.push({ kind: 'box', x, z, a: w / 2, b: d / 2, cos: Math.cos(yaw), sin: Math.sin(yaw), y, soft });
  }

  disc(x: number, z: number, r: number, y: number, soft = false) {
    this.list.push({ kind: 'disc', x, z, a: r, b: 0, cos: 1, sin: 0, y, soft });
  }

  /** An annulus (a round bar's ledge). */
  ring(x: number, z: number, r0: number, r1: number, y: number) {
    this.list.push({ kind: 'ring', x, z, a: r0, b: r1, cos: 1, sin: 0, y, soft: false });
  }

  get count() {
    return this.list.length;
  }

  /** The highest top over (x, z) that isn't above fromY. */
  top(x: number, z: number, fromY = Infinity): { y: number; soft: boolean } | null {
    let best: { y: number; soft: boolean } | null = null;
    for (const s of this.list) {
      if (s.y > fromY || (best && s.y <= best.y)) continue;
      const dx = x - s.x,
        dz = z - s.z;
      let hit: boolean;
      if (s.kind === 'box') {
        // Into the box's frame (yaw turns +x toward -z, as Object3D.rotation.y does).
        const lx = dx * s.cos - dz * s.sin,
          lz = dx * s.sin + dz * s.cos;
        hit = Math.abs(lx) <= s.a && Math.abs(lz) <= s.b;
      } else if (s.kind === 'disc') hit = dx * dx + dz * dz <= s.a * s.a;
      else {
        const d = Math.hypot(dx, dz);
        hit = d >= s.a && d <= s.b;
      }
      if (hit) best = { y: s.y, soft: s.soft };
    }
    return best;
  }
}
