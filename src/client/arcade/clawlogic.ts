import { Rng } from './types';

/**
 * The claw machine's rules, in the machine's frame (metres, x across,
 * z toward the player, y up): where the prizes lie, how likely the claw is
 * to hold one, and a little ball-ish physics for prizes falling and
 * bouncing (in the machine and loose in the room).
 */

export const CLAW = {
  /** Inside the glass: the play area (x, z half-extents) and its floor. */
  half: 0.36,
  floor: 0.93,
  /** The prize chute (front-left): centre and half-size. */
  chute: { x: -0.25, z: 0.25, half: 0.11 },
  /** Top of the claw's travel (the claw's tip at rest), cable speed, trolley speed. */
  top: 1.72,
  drop: 0.55,
  move: 0.32,
  prizeR: 0.045,
  /** Seconds to line up the claw. */
  aimTime: 20,
};

export interface PilePrize {
  design: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Lays out a pile of prizes (deterministic from the seed), keeping clear of the chute. */
export function makePile(seed: number, count = 14, designs = 5): PilePrize[] {
  const r = new Rng(seed);
  const out: PilePrize[] = [];
  const h = CLAW.half - CLAW.prizeR;
  let tries = 0;
  while (out.length < count && tries++ < 500) {
    const x = r.range(-h, h),
      z = r.range(-h, h);
    if (Math.abs(x - CLAW.chute.x) < CLAW.chute.half + 0.07 && Math.abs(z - CLAW.chute.z) < CLAW.chute.half + 0.07) continue;
    // Rest on the floor or on top of one already there.
    let y = CLAW.floor + CLAW.prizeR;
    let crowded = false;
    for (const p of out) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < CLAW.prizeR * 1.4) {
        if (p.y > CLAW.floor + CLAW.prizeR * 2) crowded = true;
        y = Math.max(y, p.y + CLAW.prizeR * 1.5);
      }
    }
    if (crowded) continue;
    out.push({ design: r.int(designs), x, y, z, yaw: r.range(0, Math.PI * 2) });
  }
  return out;
}

/** The chance the claw holds a prize whose centre is `d` metres (sideways) from the claw's centre. */
export function grabChance(d: number): number {
  const reach = 0.075;
  if (d > reach) return 0;
  return 0.85 - (d / reach) * 0.55;
}

/** Picks the prize under the claw: the highest one within reach (index or -1). */
export function prizeUnder(pile: readonly { x: number; y: number; z: number; live: boolean }[], x: number, z: number): number {
  let best = -1;
  let by = -1;
  for (let i = 0; i < pile.length; i++) {
    const p = pile[i];
    if (!p.live) continue;
    if (Math.hypot(p.x - x, p.z - z) > 0.075) continue;
    if (p.y > by) {
      by = p.y;
      best = i;
    }
  }
  return best;
}

/** How far down the claw goes at (x, z): to the top of what's under it, or the floor. */
export function dropDepth(pile: readonly { x: number; y: number; z: number; live: boolean }[], x: number, z: number): number {
  let top = CLAW.floor;
  for (const p of pile) {
    if (!p.live) continue;
    if (Math.hypot(p.x - x, p.z - z) < CLAW.prizeR + 0.05) top = Math.max(top, p.y + CLAW.prizeR * 0.4);
  }
  return Math.max(0, CLAW.top - top);
}

/** Is a point over the prize chute? */
export function overChute(x: number, z: number): boolean {
  return Math.abs(x - CLAW.chute.x) < CLAW.chute.half && Math.abs(z - CLAW.chute.z) < CLAW.chute.half;
}

export interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/** A soft, light body falling and bouncing on a floor at `floorY` (with friction when it lands). Returns impact speed. */
export function stepBody(b: Body, dt: number, floorY: number, r = CLAW.prizeR): number {
  b.vy -= 9.81 * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  let hit = 0;
  if (b.y - r < floorY) {
    b.y = floorY + r;
    if (b.vy < 0) {
      hit = -b.vy;
      b.vy = hit > 0.6 ? hit * 0.3 : 0;
    }
    const f = Math.max(0, 1 - 6 * dt);
    b.vx *= f;
    b.vz *= f;
  }
  return hit;
}
