/**
 * Ball physics for the arcade hoop machine, in the machine's own frame
 * (metres; x across, y up, z toward the player). Pure maths: gravity, a
 * ramp that tilts down to the player so balls roll back into the tray, net
 * side walls, a backboard, the rim as a ring (torus), and a soft net under
 * it. A ball scores when it drops down through the ring.
 */

export const HOOP = {
  ballR: 0.09,
  rimR: 0.2,
  rimTube: 0.011,
  rim: { x: 0, y: 2.12, z: -0.86 },
  board: { z: -1.1, x0: -0.48, x1: 0.48, y0: 1.82, y1: 2.6 },
  /** The ramp: its height at the back and front, and where it runs. */
  ramp: { zBack: -1.15, zFront: 0.95, yBack: 1.05, yFront: 0.78 },
  /** The tray in front of the ramp, and its lip. */
  tray: { zLip: 1.18, y: 0.78, lipTop: 0.9 },
  wallX: 0.52,
  top: 3.1,
  back: -1.2,
  g: 9.81,
};

export interface HoopBall {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** In someone's hand (not simulated). */
  held: boolean;
  /** Was above the rim, inside its circle, last step (for scoring). */
  above: boolean;
  /** Already scored on this throw. */
  scored: boolean;
  /** Seconds out of the cage (lost: comes back to the tray). */
  out: number;
}

export type HoopEvent = 'score' | 'rim' | 'board' | 'floor' | 'wall' | 'net';

export function newHoopBall(x: number, y: number, z: number): HoopBall {
  return { x, y, z, vx: 0, vy: 0, vz: 0, held: false, above: false, scored: false, out: 0 };
}

/** The ramp's / tray's floor height under (z). */
export function floorAt(z: number): number {
  const r = HOOP.ramp;
  if (z >= r.zFront) return HOOP.tray.y;
  if (z <= r.zBack) return r.yBack;
  return r.yFront + ((r.zFront - z) / (r.zFront - r.zBack)) * (r.yBack - r.yFront);
}

const SLOPE = (HOOP.ramp.yBack - HOOP.ramp.yFront) / (HOOP.ramp.zFront - HOOP.ramp.zBack);
const SUB = 1 / 240;

/** Reflects velocity off a unit normal (only if moving into it), with restitution and a little friction. */
function bounce(b: HoopBall, nx: number, ny: number, nz: number, e: number, fr: number) {
  const vn = b.vx * nx + b.vy * ny + b.vz * nz;
  if (vn >= 0) return 0;
  // Normal part reversed (scaled), tangential part slowed.
  const tx = b.vx - vn * nx,
    ty = b.vy - vn * ny,
    tz = b.vz - vn * nz;
  b.vx = tx * (1 - fr) - e * vn * nx;
  b.vy = ty * (1 - fr) - e * vn * ny;
  b.vz = tz * (1 - fr) - e * vn * nz;
  return -vn;
}

/** Advances a ball by dt (fixed sub-steps). Calls `ev` for scores and impacts (with speed). */
export function stepHoopBall(b: HoopBall, dt: number, ev?: (e: HoopEvent, speed: number) => void) {
  if (b.held) return;
  let left = Math.min(dt, 0.1);
  while (left > 1e-6) {
    const h = Math.min(SUB, left);
    left -= h;
    tick(b, h, ev);
  }
}

function tick(b: HoopBall, h: number, ev?: (e: HoopEvent, speed: number) => void) {
  const r = HOOP.ballR;
  const prevY = b.y;
  b.vy -= HOOP.g * h;
  // A little air drag.
  const k = 1 - 0.08 * h;
  b.vx *= k;
  b.vy *= k;
  b.vz *= k;
  b.x += b.vx * h;
  b.y += b.vy * h;
  b.z += b.vz * h;

  const inCage = b.z < HOOP.tray.zLip + 0.25 && Math.abs(b.x) < HOOP.wallX + 0.2;
  if (!inCage) {
    // Out of the machine: fall to the room's floor and wait to be returned.
    if (b.y < r) {
      b.y = r;
      if (b.vy < 0) b.vy = -b.vy * 0.4;
      b.vx *= 0.98;
      b.vz *= 0.98;
    }
    b.out += h;
    return;
  }
  b.out = 0;

  // Rim (a ring in the horizontal plane): push out from the nearest point on the circle.
  {
    const c = HOOP.rim;
    let dx = b.x - c.x,
      dz = b.z - c.z;
    const dh = Math.hypot(dx, dz) || 1e-6;
    dx /= dh;
    dz /= dh;
    const qx = c.x + dx * HOOP.rimR,
      qz = c.z + dz * HOOP.rimR;
    const ex = b.x - qx,
      ey = b.y - c.y,
      ez = b.z - qz;
    const d = Math.hypot(ex, ey, ez);
    const min = r + HOOP.rimTube;
    if (d < min && d > 1e-6) {
      const nx = ex / d,
        ny = ey / d,
        nz = ez / d;
      b.x += nx * (min - d);
      b.y += ny * (min - d);
      b.z += nz * (min - d);
      const s = bounce(b, nx, ny, nz, 0.55, 0.08);
      if (s > 0.3) ev?.('rim', s);
    }
    // Scoring: down through the ring.
    const inside = Math.hypot(b.x - c.x, b.z - c.z) < HOOP.rimR - r * 0.35;
    if (prevY >= c.y && b.y < c.y && inside && b.vy < 0 && !b.scored) {
      b.scored = true;
      ev?.('score', -b.vy);
    }
    // The net: a soft sleeve under the rim that slows the ball and funnels it down.
    if (b.y < c.y && b.y > c.y - 0.32 && Math.hypot(b.x - c.x, b.z - c.z) < HOOP.rimR + 0.02) {
      b.vx *= 1 - 6 * h;
      b.vz *= 1 - 6 * h;
      if (b.vy < -2.5) b.vy *= 1 - 3 * h;
      const pull = 3 * h;
      b.x += (c.x - b.x) * pull;
      b.z += (c.z - b.z) * pull;
    }
  }

  // Backboard (front face), only where the board is.
  const bd = HOOP.board;
  if (b.z - r < bd.z && b.z > bd.z - 0.1 && b.x > bd.x0 && b.x < bd.x1 && b.y > bd.y0 && b.y < bd.y1) {
    b.z = bd.z + r;
    const s = bounce(b, 0, 0, 1, 0.62, 0.05);
    if (s > 0.3) ev?.('board', s);
  }
  // Back wall of the cage.
  if (b.z - r < HOOP.back) {
    b.z = HOOP.back + r;
    bounce(b, 0, 0, 1, 0.4, 0.1);
  }
  // Net side walls and the net roof.
  if (Math.abs(b.x) + r > HOOP.wallX) {
    const sx = Math.sign(b.x);
    b.x = sx * (HOOP.wallX - r);
    const s = bounce(b, -sx, 0, 0, 0.3, 0.2);
    if (s > 0.5) ev?.('wall', s);
  }
  if (b.y + r > HOOP.top) {
    b.y = HOOP.top - r;
    bounce(b, 0, -1, 0, 0.3, 0.2);
  }
  // Ramp / tray floor.
  const fy = floorAt(b.z);
  if (b.y - r < fy) {
    const onRamp = b.z < HOOP.ramp.zFront && b.z > HOOP.ramp.zBack;
    let nx = 0,
      ny = 1,
      nz = 0;
    if (onRamp) {
      const l = Math.hypot(1, SLOPE);
      ny = 1 / l;
      nz = SLOPE / l;
    }
    // Push out along the normal (enough to clear the floor vertically).
    b.y = fy + r;
    const s = bounce(b, nx, ny, nz, 0.35, 0.02);
    if (s > 0.8) ev?.('floor', s);
    // Rolling resistance.
    b.vx *= 1 - 1.2 * h;
    b.vz *= 1 - 0.4 * h;
  }
  // The tray's front lip.
  if (b.z + r > HOOP.tray.zLip && b.y < HOOP.tray.lipTop + r * 0.5 && b.z < HOOP.tray.zLip + 0.2) {
    b.z = HOOP.tray.zLip - r;
    bounce(b, 0, 0, -1, 0.3, 0.2);
  }
}

/**
 * The velocity that carries a ball from (x, y, z) to the target in `t` seconds
 * (ignoring drag): for the screen players' shots and the throw assist.
 */
export function shotVelocity(x: number, y: number, z: number, tx: number, ty: number, tz: number, t: number): [number, number, number] {
  return [(tx - x) / t, (ty - y) / t + 0.5 * HOOP.g * t, (tz - z) / t];
}
