/**
 * Bodies bumping into bodies: the pure maths behind walking into people,
 * shoving them, and keeping everybody out of everybody else. No three.js, no
 * allocations in the per-frame functions (they write into the arrays passed in).
 */

/** A person's body for collisions, on the floor plane. */
export const BODY_R = 0.25;
/** How much of your step survives while you squeeze along someone (resistance). */
export const SLIDE = 0.55;
/** How far you may sink into someone before you're held back (a soft contact). */
export const SOFT = 0.02;

export interface Step {
  dx: number;
  dz: number;
}

/**
 * Your step (dx, dz) from (x, z) against round bodies. `bodies` is flat
 * [x, z, r, x, z, r, ...] for `n` bodies. The part of the step that goes into
 * a body is taken out (you slide around them, slowed to `SLIDE`), and you never
 * end up more than `SOFT` inside anyone (`soft`, and `pass` of the push
 * going on into them, are what squeezing through a packed crowd loosens). `press[i]` receives how far this step
 * pushed into body i (metres, 0 when not touching), which is what shoves them.
 */
export function stepAgainst(x: number, z: number, dx: number, dz: number, r: number, bodies: ArrayLike<number>, n: number, press: Float32Array, out: Step, slow = SLIDE, soft = SOFT, pass = 0): Step {
  let sx = dx,
    sz = dz;
  for (let i = 0; i < n; i++) {
    press[i] = 0;
    const bx = bodies[i * 3],
      bz = bodies[i * 3 + 1];
    const R = bodies[i * 3 + 2] + r;
    const ex = x + sx - bx,
      ez = z + sz - bz;
    const d2 = ex * ex + ez * ez;
    if (d2 >= R * R) continue;
    // Outward normal at the contact (from where you stand when you're dead on).
    let nx = x - bx,
      nz = z - bz;
    let nl = Math.hypot(nx, nz);
    if (nl < 1e-6) {
      nx = -sx;
      nz = -sz;
      nl = Math.hypot(nx, nz);
      if (nl < 1e-6) {
        nx = 1;
        nz = 0;
        nl = 1;
      }
    }
    nx /= nl;
    nz /= nl;
    const into = -(sx * nx + sz * nz);
    if (into > 0) {
      press[i] = into;
      // Keep only the sideways part of the step, slowed: squeezing past someone
      // (wedged in a crowd, `pass` of the push goes on into them: see Wedge).
      sx = (sx + nx * into * (1 - pass)) * slow;
      sz = (sz + nz * into * (1 - pass)) * slow;
    }
    // Never deeper than `soft` inside them (also lets you out if they walked into you).
    const cx = x + sx - bx,
      cz = z + sz - bz;
    const cd = Math.hypot(cx, cz);
    const min = R - soft;
    if (cd < min) {
      const ux = cd > 1e-6 ? cx / cd : nx,
        uz = cd > 1e-6 ? cz / cd : nz;
      // Out to the edge, but no faster than a walk's worth (no teleports).
      const want = min - cd;
      const k = Math.min(want, 0.05);
      sx += ux * k;
      sz += uz * k;
    }
  }
  out.dx = sx;
  out.dz = sz;
  return out;
}

/**
 * How far someone gets shoved when you walk into them at `speed` (m/s).
 * A walk (~1.4 m/s) moves them a step back; running in is a real bump.
 */
export function shoveDistance(speed: number): number {
  const s = Math.max(0, speed);
  if (s < 0.3) return 0.12;
  const d = 0.12 + 0.16 * s + (s > 2 ? (s - 2) * 0.2 : 0);
  return Math.min(0.9, d);
}

/** Running into someone: a bump right away. Walking: only when you keep pushing. */
export const BUMP_SPEED = 2.0;
/** Seconds of steady pushing before someone gives way. */
export const PUSH_HOLD = 0.3;

/**
 * How much of a shove lasting `T` seconds is done at time t (0..1): fast at
 * first, easing out. Step by differences of this so the total is exact.
 */
export function shoveProgress(t: number, T: number): number {
  if (t <= 0) return 0;
  if (t >= T) return 1;
  const u = 1 - t / T;
  return 1 - u * u;
}

/**
 * Pushes overlapping bodies apart. Positions `xs`/`zs` (n bodies), radii `rs`,
 * `mass` 0 = immovable (seated, behind a counter, a friend's avatar), 1 =
 * movable. Writes each body's correction into `cx`/`cz` (both 0 for bodies
 * nobody touches). Each overlapping pair is split by mass; pairs of immovable
 * bodies are left alone. O(n²) with a cheap box reject: fine for ~60 people.
 * Returns how many pairs overlapped.
 */
export function separate(xs: ArrayLike<number>, zs: ArrayLike<number>, rs: ArrayLike<number>, mass: ArrayLike<number>, n: number, cx: Float32Array, cz: Float32Array): number {
  for (let i = 0; i < n; i++) cx[i] = cz[i] = 0;
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const xi = xs[i],
      zi = zs[i],
      ri = rs[i];
    for (let j = i + 1; j < n; j++) {
      const mi = mass[i],
        mj = mass[j];
      if (mi + mj <= 0) continue;
      const R = ri + rs[j];
      const ex = xs[j] - xi,
        ez = zs[j] - zi;
      if (ex > R || ex < -R || ez > R || ez < -R) continue;
      const d2 = ex * ex + ez * ez;
      if (d2 >= R * R) continue;
      hits++;
      let d = Math.sqrt(d2),
        ux: number,
        uz: number;
      if (d < 1e-6) {
        // Exactly on top of each other: split along a fixed, index-based direction.
        const a = (i * 2.399 + j * 0.7) % (Math.PI * 2);
        ux = Math.cos(a);
        uz = Math.sin(a);
        d = 0;
      } else {
        ux = ex / d;
        uz = ez / d;
      }
      const over = R - d;
      const wi = mi / (mi + mj),
        wj = mj / (mi + mj);
      cx[i] -= ux * over * wi;
      cz[i] -= uz * over * wi;
      cx[j] += ux * over * wj;
      cz[j] += uz * over * wj;
    }
  }
  return hits;
}

/**
 * Is a point (a hand) inside a person's body? The body is a vertical capsule
 * of radius `r` around (px, pz) from height y0 (knees) to y1 (shoulders).
 * Returns how deep the point is (metres, > 0 inside), or a negative distance.
 */
export function capsuleDepth(hx: number, hy: number, hz: number, px: number, pz: number, y0: number, y1: number, r: number): number {
  const cy = Math.min(y1, Math.max(y0, hy));
  const dx = hx - px,
    dy = hy - cy,
    dz = hz - pz;
  return r - Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * A hand push: given the hand's velocity (vx, vz on the floor plane) and the
 * direction from the body to the hand (ox, oz), how hard the hand moves into
 * the body (m/s, 0 if moving away or sideways).
 */
export function handInto(vx: number, vz: number, ox: number, oz: number): number {
  const l = Math.hypot(ox, oz);
  if (l < 1e-6) return Math.hypot(vx, vz);
  return Math.max(0, -(vx * ox + vz * oz) / l);
}

/** How far a hand push moves someone: a full step back (pushing, not hitting), a bit more the harder you push. */
export function handShove(speed: number): number {
  return Math.min(0.6, 0.32 + 0.12 * Math.max(0, speed));
}

/** How far someone in your way steps to make room (m), and how soon they do once you press into them (s). */
export const YIELD_STEP = 0.45;
export const YIELD_HOLD = 0.1;

/**
 * Which ways someone in your path can step to make way, best first: aside
 * (perpendicular to your travel (fx, fz), toward the side they're already on,
 * a little ahead of you), straight back along your way, and the other side.
 * (ox, oz) is from you to them. Writes three unit vectors into `out` [x, z, ...].
 */
export function yieldDirs(fx: number, fz: number, ox: number, oz: number, out: Float32Array): Float32Array {
  let fl = Math.hypot(fx, fz);
  if (fl < 1e-6) {
    fx = ox;
    fz = oz;
    fl = Math.hypot(fx, fz);
    if (fl < 1e-6) {
      fx = 1;
      fz = 0;
      fl = 1;
    }
  }
  fx /= fl;
  fz /= fl;
  // Perpendicular, on their side of your line (dead ahead: to your right).
  let px = -fz,
    pz = fx;
  if (px * ox + pz * oz < 0) {
    px = -px;
    pz = -pz;
  }
  const put = (i: number, x: number, z: number) => {
    const l = Math.hypot(x, z) || 1;
    out[i * 2] = x / l;
    out[i * 2 + 1] = z / l;
  };
  put(0, px + fx * 0.35, pz + fz * 0.35);
  put(1, fx, fz);
  put(2, -px + fx * 0.35, -pz + fz * 0.35);
  return out;
}

/** Seconds of trying to walk and getting nowhere, touching people, before you count as wedged. */
export const WEDGE_T = 0.4;

/**
 * Stuck in a crowd: you're trying to walk, you're touching people, and you've
 * made next to no progress for WEDGE_T. Then `squeeze` rises to 1 (people
 * give: you sink into them a little and push on through, see stepAgainst's
 * `soft` and `pass`), and it stays up while you keep pressing on through
 * people, easing off once you're clear of them or stop.
 */
export class Wedge {
  /** Seconds of no progress so far. */
  t = 0;
  /** 0..1: how much the crowd gives right now. */
  squeeze = 0;

  /**
   * One frame: how far you meant to go (`want`, metres), how far you got
   * (`got`), and whether you're touching anyone. Returns `squeeze`.
   */
  update(dt: number, want: number, got: number, touching: boolean): number {
    const trying = want > 0.08 * dt;
    const stuck = trying && touching && got < want * 0.35;
    this.t = stuck ? this.t + dt : Math.max(0, this.t - dt * 2);
    if (this.t >= WEDGE_T) this.squeeze = Math.min(1, this.squeeze + dt * 5);
    else if (!(trying && touching)) this.squeeze = Math.max(0, this.squeeze - dt * 2);
    return this.squeeze;
  }

  get wedged() {
    return this.t >= WEDGE_T;
  }
}
