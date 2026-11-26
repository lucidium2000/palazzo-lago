/**
 * Air-hockey physics on the table's surface (2D, metres): x across, z along
 * the table, side 0 defends the +z end, side 1 the -z end. The puck glides
 * on air (very little friction), bounces off the rails, and goes in where a
 * goal slot is cut in an end rail. Mallets are driven (by hands, keys or the
 * house AI) and hit the puck like an immovable wall moving at their speed.
 */

export const RINK = {
  halfW: 0.5,
  halfL: 1.0,
  goalHalf: 0.15,
  puckR: 0.04,
  malletR: 0.052,
  maxSpeed: 7,
  /** Rail and mallet bounciness. */
  rail: 0.88,
  hit: 0.92,
  /** Air-cushion drag (1/s). */
  drag: 0.12,
};

export interface Puck {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

export interface Mallet {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

const SUB = 1 / 240;

/** Keeps a mallet in its own half and off the rails. */
export function clampMallet(m: Mallet, side: 0 | 1) {
  const r = RINK.malletR;
  m.x = Math.max(-RINK.halfW + r, Math.min(RINK.halfW - r, m.x));
  if (side === 0) m.z = Math.max(r * 0.5, Math.min(RINK.halfL - r, m.z));
  else m.z = Math.min(-r * 0.5, Math.max(-RINK.halfL + r, m.z));
}

/** Moves a mallet toward a target at up to `speed`, recording its velocity. */
export function driveMallet(m: Mallet, tx: number, tz: number, speed: number, dt: number, side: 0 | 1) {
  const px = m.x,
    pz = m.z;
  const dx = tx - m.x,
    dz = tz - m.z;
  const d = Math.hypot(dx, dz);
  const step = Math.min(d, speed * dt);
  if (d > 1e-6) {
    m.x += (dx / d) * step;
    m.z += (dz / d) * step;
  }
  clampMallet(m, side);
  if (dt > 0) {
    m.vx = (m.x - px) / dt;
    m.vz = (m.z - pz) / dt;
  }
}

/** Puck against a mallet: returns the hit speed (0: no contact). */
export function collide(p: Puck, m: Mallet): number {
  const R = RINK.puckR + RINK.malletR;
  const dx = p.x - m.x,
    dz = p.z - m.z;
  const d2 = dx * dx + dz * dz;
  if (d2 >= R * R) return 0;
  const d = Math.sqrt(d2) || 1e-6;
  const nx = dx / d,
    nz = dz / d;
  p.x = m.x + nx * R;
  p.z = m.z + nz * R;
  const rvx = p.vx - m.vx,
    rvz = p.vz - m.vz;
  const vn = rvx * nx + rvz * nz;
  if (vn >= 0) return 0;
  p.vx -= (1 + RINK.hit) * vn * nx;
  p.vz -= (1 + RINK.hit) * vn * nz;
  const s = Math.hypot(p.vx, p.vz);
  if (s > RINK.maxSpeed) {
    p.vx *= RINK.maxSpeed / s;
    p.vz *= RINK.maxSpeed / s;
  }
  return -vn;
}

export type RinkEvent = { k: 'goal'; side: 0 | 1 } | { k: 'rail'; speed: number } | { k: 'hit'; side: 0 | 1; speed: number };

/**
 * Steps the puck by dt against the rails, goals and both mallets. A goal
 * scored *on* side s (the puck went into s's end) is reported as
 * { k: 'goal', side: s }; the puck then waits at centre.
 */
export function stepRink(p: Puck, mallets: [Mallet, Mallet], dt: number, ev?: (e: RinkEvent) => void): 0 | 1 | null {
  let left = Math.min(dt, 0.1);
  while (left > 1e-6) {
    const h = Math.min(SUB, left);
    left -= h;
    const k = 1 - RINK.drag * h;
    p.vx *= k;
    p.vz *= k;
    p.x += p.vx * h;
    p.z += p.vz * h;
    const r = RINK.puckR;
    if (Math.abs(p.x) > RINK.halfW - r) {
      p.x = Math.sign(p.x) * (RINK.halfW - r);
      if (Math.sign(p.vx) === Math.sign(p.x)) {
        ev?.({ k: 'rail', speed: Math.abs(p.vx) });
        p.vx = -p.vx * RINK.rail;
      }
    }
    if (Math.abs(p.z) > RINK.halfL - r) {
      const end: 0 | 1 = p.z > 0 ? 0 : 1;
      if (Math.abs(p.x) < RINK.goalHalf - r * 0.3) {
        if (Math.abs(p.z) > RINK.halfL + r) {
          ev?.({ k: 'goal', side: end });
          return end;
        }
      } else {
        p.z = Math.sign(p.z) * (RINK.halfL - r);
        if (Math.sign(p.vz) === Math.sign(p.z)) {
          ev?.({ k: 'rail', speed: Math.abs(p.vz) });
          p.vz = -p.vz * RINK.rail;
        }
      }
    }
    for (let s = 0; s < 2; s++) {
      const sp = collide(p, mallets[s]);
      if (sp > 0.05) ev?.({ k: 'hit', side: s as 0 | 1, speed: sp });
    }
  }
  return null;
}

/**
 * The house player's brain for one step: where its mallet should go. It
 * guards its goal, then strikes when the puck is in its half and slow or
 * coming at it. `skill` 0..1 scales its reactions.
 */
export function aiTarget(p: Puck, me: Mallet, side: 0 | 1, skill: number): { x: number; z: number; speed: number } {
  const dir = side === 0 ? 1 : -1;
  const home = dir * (RINK.halfL - 0.16);
  const inMyHalf = p.z * dir > 0;
  const coming = p.vz * dir > 0.2;
  const speed = 1.4 + skill * 1.6;
  if (inMyHalf && (!coming || Math.abs(p.z - me.z) < 0.25)) {
    // Get behind the puck (goal side) and drive through it toward the far goal.
    const behind = p.z + dir * 0.07;
    const aimX = p.x * 0.6;
    if ((me.z - p.z) * dir > 0.02) return { x: p.x + (p.x - aimX) * 0.3, z: p.z - dir * 0.02, speed: speed * 1.4 };
    return { x: p.x + Math.sign(me.x - p.x || 1) * 0.08, z: behind, speed };
  }
  // Guard: on the line between the puck and the goal centre.
  const t = 0.35;
  const gx = p.x * t * (0.6 + skill * 0.4);
  return { x: gx, z: home, speed: speed * 0.8 };
}
