import * as THREE from 'three';

/**
 * Two dice thrown down a craps table, simulated in advance as rigid cubes.
 *
 * Real casino dice: 19 mm, ~8 g. Each die is a cube with its eight corners as
 * contact points against the felt (y = 0) and the four walls of the tub, solved
 * with impulses (restitution + Coulomb friction). The far end wall is lined
 * with rubber pyramids, so it is bouncier and kicks the dice off at odd angles,
 * which is what makes a real throw random. The dice bump each other as spheres.
 *
 * The outcome is chosen fairly by the RNG first; once the motion settles we
 * know which face of each cube ended up on top, and the pip faces are mapped
 * onto the cube so the right number shows (the motion is identical either way).
 */

export const DIE = 0.019;
const HALF = DIE / 2;
const MASS = 0.008;
const INERTIA = (MASS * DIE * DIE) / 6;
const G = 9.81;

/** Which local axis carries which pip count (opposite faces sum to 7). */
export const FACE_NORMALS: Record<number, THREE.Vector3> = {
  1: new THREE.Vector3(0, 1, 0),
  6: new THREE.Vector3(0, -1, 0),
  2: new THREE.Vector3(1, 0, 0),
  5: new THREE.Vector3(-1, 0, 0),
  3: new THREE.Vector3(0, 0, 1),
  4: new THREE.Vector3(0, 0, -1),
};

export interface Bed {
  /** Half-length (x) and half-width (z) of the felt bed, metres. */
  hx: number;
  hz: number;
}

export interface DieFrame {
  p: THREE.Vector3;
  q: THREE.Quaternion;
}

export interface DicePlan {
  /** frames[i] = [die0, die1] at time i * dt. */
  frames: [DieFrame, DieFrame][];
  dt: number;
  duration: number;
  /** Impacts for sound: time, strength 0..1, and whether it was a wall. */
  hits: { t: number; strength: number; wall: boolean; die: number }[];
  /** Local axis pointing up on each die at rest. */
  upLocal: [THREE.Vector3, THREE.Vector3];
  /** Did a die reach the back wall (house rule: dice must hit the back wall)? */
  hitBackWall: boolean;
}

interface Body {
  p: THREE.Vector3;
  q: THREE.Quaternion;
  v: THREE.Vector3;
  w: THREE.Vector3;
  still: number;
  asleep: boolean;
}

function rng(seed: number) {
  let s = (Math.imul(seed ^ 0x2545f491, 2654435761) ^ (seed >>> 5)) >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CORNERS = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => new THREE.Vector3(x * HALF, y * HALF, z * HALF))));

export interface ThrowOptions {
  bed: Bed;
  seed: number;
  /** Throw from +x toward the -x end wall. Start point (on the shooter's side). */
  from: THREE.Vector3;
  /** Initial velocity; if omitted a realistic throw is generated. */
  velocity?: THREE.Vector3;
}

export function simulateThrow(opts: ThrowOptions): DicePlan {
  const rand = rng(opts.seed);
  const { hx, hz } = opts.bed;
  const sub = 1 / 960;
  const frameDt = 1 / 120;
  const base = opts.velocity ?? new THREE.Vector3(-(3.4 + rand() * 0.9), 0.8 + rand() * 0.5, -(0.25 + rand() * 0.35) * Math.sign(opts.from.z || 1));
  const bodies: Body[] = [0, 1].map((i) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 6.28, rand() * 6.28, rand() * 6.28));
    return {
      p: opts.from.clone().add(new THREE.Vector3((rand() - 0.5) * 0.02, i * 0.012, (i - 0.5) * 0.03)),
      q,
      v: base.clone().add(new THREE.Vector3((rand() - 0.5) * 0.25, (rand() - 0.5) * 0.2, (rand() - 0.5) * 0.15)),
      w: new THREE.Vector3((rand() - 0.5) * 60, (rand() - 0.5) * 40, (rand() - 0.5) * 60),
      still: 0,
      asleep: false,
    };
  });

  const frames: DicePlan['frames'] = [];
  const hits: DicePlan['hits'] = [];
  let hitBackWall = false;
  const lastHit = [-1, -1];

  type Plane = { n: THREE.Vector3; d: number; e: number; mu: number; wall: boolean; back?: boolean };
  // Plane: n·x + d >= 0 is inside.
  const planes: Plane[] = [
    { n: new THREE.Vector3(0, 1, 0), d: 0, e: 0.38, mu: 0.3, wall: false },
    { n: new THREE.Vector3(1, 0, 0), d: hx, e: 0.78, mu: 0.2, wall: true, back: true },
    { n: new THREE.Vector3(-1, 0, 0), d: hx, e: 0.45, mu: 0.3, wall: true },
    { n: new THREE.Vector3(0, 0, 1), d: hz, e: 0.45, mu: 0.3, wall: true },
    { n: new THREE.Vector3(0, 0, -1), d: hz, e: 0.45, mu: 0.3, wall: true },
  ];

  const r = new THREE.Vector3();
  const c = new THREE.Vector3();
  const vp = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tang = new THREE.Vector3();
  const dq = new THREE.Quaternion();

  let t = 0;
  let nextFrame = 0;
  const maxT = 9;
  while (t < maxT) {
    for (let bi = 0; bi < 2; bi++) {
      const b = bodies[bi];
      if (b.asleep) continue;
      b.v.y -= G * sub;
      // Air drag is tiny for a die; rolling resistance comes from contacts.
      b.p.addScaledVector(b.v, sub);
      const wl = b.w.length();
      if (wl > 1e-9) {
        dq.setFromAxisAngle(tmp.copy(b.w).divideScalar(wl), wl * sub);
        b.q.premultiply(dq).normalize();
      }

      for (const pl of planes) {
        for (const k of CORNERS) {
          r.copy(k).applyQuaternion(b.q);
          c.copy(b.p).add(r);
          const depth = pl.n.dot(c) + pl.d;
          if (depth >= 0) continue;
          // Velocity of the corner.
          vp.copy(b.w).cross(r).add(b.v);
          const vn = vp.dot(pl.n);
          // Push out of the surface.
          b.p.addScaledVector(pl.n, -depth * 0.5);
          if (vn >= 0) continue;
          const rn = tmp.copy(r).cross(pl.n);
          const denom = 1 / MASS + rn.lengthSq() / INERTIA;
          let e = pl.e;
          if (Math.abs(vn) < 0.2) e = 0; // resting contact: no bounce
          const jn = (-(1 + e) * vn) / denom;
          // Pyramids on the back wall scatter the rebound.
          const n = pl.back ? tmp.copy(pl.n).add(new THREE.Vector3(0, (rand() - 0.3) * 0.5, (rand() - 0.5) * 0.9)).normalize() : pl.n;
          b.v.addScaledVector(n, jn / MASS);
          b.w.add(r.clone().cross(n).multiplyScalar(jn / INERTIA));
          // Friction.
          vp.copy(b.w).cross(r).add(b.v);
          tang.copy(vp).addScaledVector(pl.n, -vp.dot(pl.n));
          const vt = tang.length();
          if (vt > 1e-6) {
            tang.divideScalar(vt);
            const rt = r.clone().cross(tang);
            const jtMax = vt / (1 / MASS + rt.lengthSq() / INERTIA);
            const jt = Math.min(jtMax, pl.mu * jn);
            b.v.addScaledVector(tang, -jt / MASS);
            b.w.add(r.clone().cross(tang).multiplyScalar(-jt / INERTIA));
          }
          const strength = Math.min(1, -vn / 2.5);
          if (strength > 0.06 && t - lastHit[bi] > 0.04) {
            hits.push({ t, strength, wall: pl.wall, die: bi });
            lastHit[bi] = t;
          }
          if (pl.back) hitBackWall = true;
        }
      }
      // Rolling/spinning resistance on the felt.
      if (b.p.y < HALF * 1.8) {
        b.w.multiplyScalar(Math.exp(-1.2 * sub));
        b.v.x *= Math.exp(-0.6 * sub);
        b.v.z *= Math.exp(-0.6 * sub);
      }
      if (b.v.length() < 0.02 && b.w.length() < 0.6 && b.p.y < HALF * 1.25) {
        b.still += sub;
        if (b.still > 0.25) b.asleep = true;
      } else b.still = 0;
    }

    // Dice knock into each other (as spheres).
    const [a, b2] = bodies;
    const d = tmp.copy(b2.p).sub(a.p);
    const dist = d.length();
    const minD = DIE * 1.05;
    if (dist < minD && dist > 1e-6) {
      d.divideScalar(dist);
      const rel = b2.v.clone().sub(a.v).dot(d);
      a.p.addScaledVector(d, -(minD - dist) / 2);
      b2.p.addScaledVector(d, (minD - dist) / 2);
      if (rel < 0) {
        const j = (-(1 + 0.5) * rel) / (2 / MASS);
        a.v.addScaledVector(d, -j / MASS);
        b2.v.addScaledVector(d, j / MASS);
        a.asleep = b2.asleep = false;
        if (-rel > 0.15 && t - lastHit[0] > 0.04) {
          hits.push({ t, strength: Math.min(1, -rel / 2), wall: false, die: 0 });
          lastHit[0] = t;
        }
      }
    }

    if (t >= nextFrame) {
      frames.push([
        { p: bodies[0].p.clone(), q: bodies[0].q.clone() },
        { p: bodies[1].p.clone(), q: bodies[1].q.clone() },
      ]);
      nextFrame += frameDt;
    }
    t += sub;
    if (bodies[0].asleep && bodies[1].asleep) break;
  }

  // Snap each die flat onto the face nearest to up.
  const settle = bodies.map((b) => {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(b.q.clone().invert());
    const ax = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
    let best = ax[0];
    for (const a2 of ax) if (a2.dot(up) > best.dot(up)) best = a2;
    // Rotate so `best` (local) points exactly world-up, keeping the heading.
    const worldBest = best.clone().applyQuaternion(b.q);
    const fix = new THREE.Quaternion().setFromUnitVectors(worldBest, new THREE.Vector3(0, 1, 0));
    const q = b.q.clone().premultiply(fix);
    return { up: best, frame: { p: new THREE.Vector3(b.p.x, HALF, b.p.z), q } };
  });
  // Ease the last few frames into the snapped pose.
  const ease = Math.min(frames.length, 24);
  for (let i = 0; i < ease; i++) {
    const k = (i + 1) / ease;
    const f = frames[frames.length - ease + i];
    f.forEach((fr, di) => {
      fr.p.lerp(settle[di].frame.p, k);
      fr.q.slerp(settle[di].frame.q, k);
    });
  }
  frames.push([settle[0].frame, settle[1].frame]);

  return {
    frames,
    dt: frameDt,
    duration: (frames.length - 1) * frameDt,
    hits,
    upLocal: [settle[0].up, settle[1].up],
    hitBackWall,
  };
}

/**
 * Orientation to give a die's pip mesh (relative to its simulated body) so the
 * face showing `value` is the one that ends up on top.
 */
export function faceFix(upLocal: THREE.Vector3, value: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(FACE_NORMALS[value], upLocal);
}

/** Interpolated pose of both dice at time t. */
export function poseAt(plan: DicePlan, t: number, out: [DieFrame, DieFrame]): void {
  const f = plan.frames;
  const x = Math.min(f.length - 1, Math.max(0, t / plan.dt));
  const i = Math.min(f.length - 2, Math.floor(x));
  const k = Math.max(0, Math.min(1, x - i));
  for (let d = 0; d < 2; d++) {
    out[d].p.lerpVectors(f[i][d].p, f[i + 1][d].p, k);
    out[d].q.slerpQuaternions(f[i][d].q, f[i + 1][d].q, k);
  }
}
