/**
 * A big inflatable beach ball, simulated as a light sphere: gravity fighting a
 * lot of air drag (it floats down rather than drops), big bouncy restitution off
 * the deck, walls and furniture, people as soft upright capsules, and on the
 * water it bobs at a floating line and drifts on a lazy breeze.
 *
 * Pure maths over the world's floor heights, water and 2D colliders, so it runs
 * the same in tests and in the game (and on both players' machines).
 */

export interface BallWorld {
  groundAt(x: number, z: number): number;
  waterAt(x: number, z: number): number | null;
  isInside(x: number, z: number): boolean;
  colliders(): {
    circles: readonly { x: number; z: number; r: number; kind: string }[];
    boxes: readonly { x: number; z: number; hw: number; hd: number; yaw: number; kind: string }[];
  };
}

/** An upright body the ball bounces off (a person): feet to head, radius, and how they're moving. */
export interface BallBody {
  x: number;
  z: number;
  y0: number;
  y1: number;
  r: number;
  vx?: number;
  vz?: number;
}

export interface BallState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Resting on the deck (not simulated until touched). */
  asleep: boolean;
  /** Seconds the ball has been slow on the ground (falls asleep after a while). */
  still: number;
  inWater: boolean;
  /** Spin for the look of it (radians/s about x and z, from rolling). */
  spinX: number;
  spinZ: number;
}

export const BALL = {
  /** Radius (a 60 cm inflatable). */
  r: 0.3,
  g: 9.81,
  /** Quadratic air drag (1/m): terminal speed sqrt(g / drag) ≈ 6.5 m/s. */
  drag: 0.23,
  /** Bounce off the deck / walls / furniture / people. */
  restitution: 0.86,
  wallRestitution: 0.72,
  bodyRestitution: 0.55,
  /** Floats with this much of its radius under water. */
  floatDepth: 0.35,
  /** Water damping (1/s): vertical bobbing, horizontal drift. */
  waterDampY: 4.5,
  waterDampXZ: 0.55,
  /** Breeze pushing it about on the water (m/s²). */
  breeze: 0.06,
  /** Rolling resistance on the deck (1/s). */
  roll: 0.9,
};

/** How tall each kind of collider is, for the ball (it can sail over a lounger, not a palm). */
const HEIGHT: Record<string, number> = {
  lounger: 0.45,
  bar: 1.1,
  'hot tub': 0.12,
  planter: 0.85,
  hedge: 1.1,
  'dj booth': 1.0,
  stage: 0.6,
  umbrella: 2.3,
  table: 0.8,
  bench: 0.45,
  'bar stool': 0.78,
};
const heightOf = (kind: string) => HEIGHT[kind] ?? 6;

export function newBall(x: number, y: number, z: number): BallState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, asleep: false, still: 0, inWater: false, spinX: 0, spinZ: 0 };
}

const STEP = 1 / 120;
const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * The ball's simulation. `step` advances it (fixed sub-steps); `hit` gives it a
 * new velocity (a hand, a kick, a guest's swat) and wakes it.
 */
export class BallSim {
  readonly s: BallState;
  /** Simulated time (drives the breeze; the same on both players' machines). */
  time = 0;
  private near: { circles: ReturnType<BallWorld['colliders']>['circles'][number][]; boxes: ReturnType<BallWorld['colliders']>['boxes'][number][] } = { circles: [], boxes: [] };
  private nearAt = { x: 1e9, z: 1e9 };
  private acc = 0;
  /** Called on a bounce or splash, with how hard (m/s). */
  onImpact?: (kind: 'ground' | 'wall' | 'body' | 'water', speed: number) => void;

  constructor(
    private world: BallWorld,
    s: BallState,
  ) {
    this.s = s;
  }

  hit(vx: number, vy: number, vz: number) {
    const s = this.s;
    s.vx = vx;
    s.vy = vy;
    s.vz = vz;
    s.asleep = false;
    s.still = 0;
  }

  /** Puts the ball at a spot (network sync, respawn). */
  set(x: number, y: number, z: number, vx: number, vy: number, vz: number) {
    Object.assign(this.s, { x, y, z, vx, vy, vz, asleep: false, still: 0 });
  }

  step(dt: number, bodies: readonly BallBody[] = []) {
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.time += STEP;
      this.tick(STEP, bodies);
    }
  }

  private refreshNear() {
    const s = this.s;
    if (Math.hypot(s.x - this.nearAt.x, s.z - this.nearAt.z) < 1.5) return;
    this.nearAt = { x: s.x, z: s.z };
    const c = this.world.colliders();
    const R = 4;
    this.near = {
      circles: c.circles.filter((o) => Math.abs(o.x - s.x) < R + o.r && Math.abs(o.z - s.z) < R + o.r),
      boxes: c.boxes.filter((o) => Math.hypot(o.x - s.x, o.z - s.z) < R + Math.hypot(o.hw, o.hd)),
    };
  }

  private tick(dt: number, bodies: readonly BallBody[]) {
    const s = this.s;
    const B = BALL;
    const r = B.r;
    const water = this.world.waterAt(s.x, s.z);
    // In water: buoyancy as a spring toward the floating line, heavy damping, a drifting breeze.
    const sub = water !== null ? water - (s.y - r) : -1;
    s.inWater = sub > 0;
    if (s.asleep && !s.inWater) {
      // Resting: only someone walking into it wakes it.
      if (!bodies.some((b) => Math.hypot(s.x - b.x, s.z - b.z) < r + b.r && s.y + r > b.y0 && s.y - r < b.y1)) return;
    }
    s.asleep = false;
    let ax = 0,
      ay = -B.g,
      az = 0;
    const sp = Math.hypot(s.vx, s.vy, s.vz);
    ax -= B.drag * sp * s.vx;
    ay -= B.drag * sp * s.vy;
    az -= B.drag * sp * s.vz;
    if (s.inWater) {
      const depth = Math.min(sub, 2 * r);
      ay += (B.g / (B.floatDepth * r)) * depth;
      ay -= B.waterDampY * s.vy;
      ax -= B.waterDampXZ * s.vx;
      az -= B.waterDampXZ * s.vz;
      // A lazy breeze that slowly swings round.
      const a = this.time * 0.05 + Math.sin(this.time * 0.13) * 1.5;
      ax += Math.cos(a) * B.breeze;
      az += Math.sin(a) * B.breeze;
    }
    const wasY = s.y;
    s.vx += ax * dt;
    s.vy += ay * dt;
    s.vz += az * dt;
    let nx = s.x + s.vx * dt,
      ny = s.y + s.vy * dt,
      nz = s.z + s.vz * dt;

    // Walls (the edge of where you can walk) and steps up (the pool's sides, seen from in it):
    // probe the ball's four sides, push it back out of anything solid and bounce.
    const blocked = (x: number, z: number) => !this.world.isInside(x, z) || this.world.groundAt(x, z) > ny - r + 0.04;
    for (const [dx, dz] of DIRS) {
      if (!blocked(nx + dx * r, nz + dz * r)) continue;
      // How far out the ball's side is free (bisection), then back off the rest.
      let lo = 0,
        hi = r;
      if (blocked(nx, nz)) hi = 0;
      else
        for (let k = 0; k < 6; k++) {
          const m = (lo + hi) / 2;
          if (blocked(nx + dx * m, nz + dz * m)) hi = m;
          else lo = m;
        }
      const push = r - lo;
      nx -= dx * push;
      nz -= dz * push;
      const vn = s.vx * dx + s.vz * dz;
      if (vn > 0) {
        this.impact('wall', vn);
        s.vx -= (1 + B.wallRestitution) * vn * dx;
        s.vz -= (1 + B.wallRestitution) * vn * dz;
      }
    }

    // Furniture: bounce off the sides, or land on top of the low things.
    this.refreshNear();
    for (const c of this.near.circles) {
      const h = heightOf(c.kind);
      const dx = nx - c.x,
        dz = nz - c.z;
      const d = Math.hypot(dx, dz);
      if (d >= c.r + r || ny - r >= h) continue;
      if (wasY - r >= h - 0.03 && d < c.r + r * 0.5) {
        // Coming down onto its top.
        ny = h + r;
        if (s.vy < 0) {
          this.impact('ground', -s.vy);
          s.vy = -s.vy * B.restitution;
        }
        continue;
      }
      const ux = d > 1e-6 ? dx / d : 1,
        uz = d > 1e-6 ? dz / d : 0;
      nx = c.x + ux * (c.r + r);
      nz = c.z + uz * (c.r + r);
      this.reflect(ux, uz, B.wallRestitution, 0, 0, 'wall');
    }
    for (const b of this.near.boxes) {
      const h = heightOf(b.kind);
      if (ny - r >= h) continue;
      const cos = Math.cos(b.yaw),
        sin = Math.sin(b.yaw);
      const dx = nx - b.x,
        dz = nz - b.z;
      const lx = dx * cos - dz * sin,
        lz = dx * sin + dz * cos;
      const cx = Math.max(-b.hw, Math.min(b.hw, lx)),
        cz = Math.max(-b.hd, Math.min(b.hd, lz));
      let ex = lx - cx,
        ez = lz - cz;
      const d = Math.hypot(ex, ez);
      if (d >= r) continue;
      if (wasY - r >= h - 0.03 && d < r * 0.5) {
        ny = h + r;
        if (s.vy < 0) {
          this.impact('ground', -s.vy);
          s.vy = -s.vy * B.restitution;
        }
        continue;
      }
      if (d < 1e-6) {
        // Centre inside: out through the nearest face.
        if (b.hw - Math.abs(lx) < b.hd - Math.abs(lz)) {
          ex = Math.sign(lx) || 1;
          ez = 0;
        } else {
          ex = 0;
          ez = Math.sign(lz) || 1;
        }
      } else {
        ex /= d;
        ez /= d;
      }
      const plx = cx + ex * r,
        plz = cz + ez * r;
      nx = b.x + plx * cos + plz * sin;
      nz = b.z - plx * sin + plz * cos;
      this.reflect(ex * cos + ez * sin, -ex * sin + ez * cos, B.wallRestitution, 0, 0, 'wall');
    }

    // People: soft upright capsules that bat it back with their own motion.
    for (const b of bodies) {
      const cy = Math.max(b.y0, Math.min(b.y1, ny));
      const dx = nx - b.x,
        dy = ny - cy,
        dz = nz - b.z;
      const d = Math.hypot(dx, dy, dz);
      const min = r + b.r;
      if (d >= min || d < 1e-6) continue;
      const ux = dx / d,
        uy = dy / d,
        uz = dz / d;
      nx = b.x + ux * min;
      ny = cy + uy * min;
      nz = b.z + uz * min;
      const vn = (s.vx - (b.vx ?? 0)) * ux + s.vy * uy + (s.vz - (b.vz ?? 0)) * uz;
      if (vn < 0) {
        const k = (1 + B.bodyRestitution) * vn;
        s.vx -= k * ux;
        s.vy -= k * uy;
        s.vz -= k * uz;
        this.impact('body', -vn);
      }
    }

    // The floor (deck or pool floor).
    const floor = this.world.groundAt(nx, nz);
    if (ny - r < floor) {
      ny = floor + r;
      if (s.vy < 0) {
        const v = -s.vy;
        s.vy = v < 0.35 ? 0 : v * B.restitution;
        if (v > 0.35) this.impact('ground', v);
      }
      // Rolling: friction on the deck.
      const k = Math.exp(-B.roll * dt);
      s.vx *= k;
      s.vz *= k;
    }
    // Splash down.
    if (water !== null && !s.inWater && ny - r < water && s.vy < -1) this.impact('water', -s.vy);

    // Spin from rolling / skimming.
    const onSurface = ny - r <= floor + 0.01 || s.inWater;
    if (onSurface) {
      s.spinX = s.vz / r;
      s.spinZ = -s.vx / r;
    } else {
      s.spinX *= 1 - dt * 0.3;
      s.spinZ *= 1 - dt * 0.3;
    }

    s.x = nx;
    s.y = ny;
    s.z = nz;
    // Asleep once it has sat still on the deck for a moment.
    const slow = Math.hypot(s.vx, s.vy, s.vz) < 0.06 && ny - r <= floor + 0.005 && !s.inWater;
    s.still = slow ? s.still + dt : 0;
    if (s.still > 0.5) {
      s.asleep = true;
      s.vx = s.vy = s.vz = 0;
    }
  }

  /** Bounces the velocity off a surface with normal (ux, uz) (horizontal). */
  private reflect(ux: number, uz: number, e: number, bvx: number, bvz: number, kind: 'wall' | 'body') {
    const s = this.s;
    const vn = (s.vx - bvx) * ux + (s.vz - bvz) * uz;
    if (vn >= 0) return;
    s.vx -= (1 + e) * vn * ux;
    s.vz -= (1 + e) * vn * uz;
    this.impact(kind, -vn);
  }

  private impact(kind: 'ground' | 'wall' | 'body' | 'water', speed: number) {
    if (speed > 0.4) this.onImpact?.(kind, speed);
  }
}

/**
 * The velocity to lob the ball from `from` so it is at `to` after `t` seconds,
 * through the air drag (a few rounds of aim, fly, correct; no collisions).
 */
export function lobVelocity(fx: number, fy: number, fz: number, tx: number, ty: number, tz: number, t: number): [number, number, number] {
  let vx = (tx - fx) / t,
    vy = (ty - fy + 0.5 * BALL.g * t * t) / t,
    vz = (tz - fz) / t;
  const dt = 1 / 60;
  for (let round = 0; round < 5; round++) {
    let x = fx,
      y = fy,
      z = fz,
      ux = vx,
      uy = vy,
      uz = vz;
    for (let k = 0; k < Math.round(t / dt); k++) {
      const sp = Math.hypot(ux, uy, uz);
      ux -= BALL.drag * sp * ux * dt;
      uy -= (BALL.g + BALL.drag * sp * uy) * dt;
      uz -= BALL.drag * sp * uz * dt;
      x += ux * dt;
      y += uy * dt;
      z += uz * dt;
    }
    vx += (tx - x) / t;
    vy += (ty - y) / t;
    vz += (tz - z) / t;
  }
  return [vx, vy, vz];
}
