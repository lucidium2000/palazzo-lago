import * as THREE from 'three';

/**
 * The walkable world: where feet can go, what blocks them, and what each floor
 * is made of (for footsteps). Everything is 2D on the XZ plane.
 */

export type Surface = 'marble' | 'carpet' | 'stone';

interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

interface Circle {
  x: number;
  z: number;
  r: number;
  /** What it is (for the debug overlay and counts). */
  kind: string;
}

export interface Box {
  x: number;
  z: number;
  hw: number;
  hd: number;
  yaw: number;
  kind: string;
  /** Furniture you can climb onto (a bed, a lounger): solid for walking guests, passable for you (its seats sit you down). */
  soft?: boolean;
}

/**
 * Something you sit on (a slot stool, a table stool, a bar stool): it doesn't
 * block you; walk over it and you sit down. `y` is the seat top's height,
 * `yaw` (person convention, atan2(dx, dz)) the way you face sitting on it, if it has one.
 */
export interface Seat {
  x: number;
  z: number;
  r: number;
  y: number;
  yaw: number | null;
  kind: string;
}

export class World {
  /** Areas you can stand in (their union). */
  private walk: Rect[] = [];
  private circles: Circle[] = [];
  private boxes: Box[] = [];
  private seatList: Seat[] = [];
  private surfaces: { rect: Rect; surface: Surface }[] = [];
  private grounds: { rect: Rect; height: (x: number, z: number) => number }[] = [];
  private waters: { rect: Rect; y: number }[] = [];

  addWalkable(x0: number, x1: number, z0: number, z1: number) {
    this.walk.push({ x0, x1, z0, z1 });
  }

  addCircle(x: number, z: number, r: number, kind = 'misc') {
    this.circles.push({ x, z, r, kind });
  }

  /** An obstacle box centred at (x, z), half-sizes along its own axes, rotated by yaw. */
  addBox(x: number, z: number, w: number, d: number, yaw = 0, kind = 'misc'): Box {
    const b: Box = { x, z, hw: w / 2, hd: d / 2, yaw, kind };
    this.boxes.push(b);
    // (Returned so a moving thing, a parked car, can move its box.)
    return b;
  }

  /**
   * Furniture you get onto by walking over it, like a stool (a bed, a lounger,
   * a cabana's daybed): guests walk round it, you walk onto it. Give it seats
   * (addSeat) where you'd sit.
   */
  addFurniture(x: number, z: number, w: number, d: number, yaw = 0, kind = 'misc') {
    this.boxes.push({ x, z, hw: w / 2, hd: d / 2, yaw, kind, soft: true });
  }

  /** Adds a box in an object's local frame (e.g. a table group). */
  addLocalBox(obj: THREE.Object3D, cx: number, cz: number, w: number, d: number, kind = 'misc') {
    obj.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(cx, 0, cz).applyMatrix4(obj.matrixWorld);
    this.addBox(p.x, p.z, w, d, worldYaw(obj), kind);
  }

  /** Adds a circle in an object's local frame. */
  addLocalCircle(obj: THREE.Object3D, cx: number, cz: number, r: number, kind = 'misc') {
    obj.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(cx, 0, cz).applyMatrix4(obj.matrixWorld);
    this.addCircle(p.x, p.z, r, kind);
  }

  /**
   * A seat (stool): passable for you, an obstacle for walking guests (see
   * `isFree`'s `seats`). Stand over it (within `r`) and you sit on it.
   */
  addSeat(x: number, z: number, r: number, y: number, yaw: number | null = null, kind = 'stool'): Seat {
    const s: Seat = { x, z, r, y, yaw, kind };
    this.seatList.push(s);
    // (Returned so a seat that moves, a car's back seat, can follow it; r < 0 switches it off.)
    return s;
  }

  /** A seat in an object's local frame; `yaw` is local too (0 faces the object's +Z). */
  addLocalSeat(obj: THREE.Object3D, cx: number, cz: number, r: number, y: number, yaw: number | null = null, kind = 'stool') {
    obj.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(cx, 0, cz).applyMatrix4(obj.matrixWorld);
    this.addSeat(p.x, p.z, r, y, yaw === null ? null : yaw + worldYaw(obj), kind);
  }

  /** Every seat (stool) in the world. */
  get seats(): readonly Seat[] {
    return this.seatList;
  }

  /**
   * The seat under a body at (x, z): the nearest one whose sitting area holds
   * the point (`grow` widens every seat's area, so you stay seated while
   * shifting about on it). Null when you're not over one.
   */
  seatAt(x: number, z: number, grow = 0): Seat | null {
    let best: Seat | null = null,
      bestD = Infinity;
    for (const s of this.seatList) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d <= s.r + grow && d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best;
  }

  /** Every obstacle, for debugging (colliderdebug.ts) and tests. */
  colliders() {
    return {
      circles: this.circles as readonly Readonly<Circle>[],
      boxes: this.boxes as readonly Readonly<Box>[],
      seats: this.seatList as readonly Readonly<Seat>[],
      walk: this.walk as readonly Readonly<Rect>[],
    };
  }

  /** How many obstacles (and seats) of each kind. */
  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const o of [...this.circles, ...this.boxes]) out[o.kind] = (out[o.kind] ?? 0) + 1;
    for (const s of this.seatList) out[`seat:${s.kind}`] = (out[`seat:${s.kind}`] ?? 0) + 1;
    return out;
  }

  /**
   * A region whose floor isn't at y = 0 (a pool basin, steps): `height(x, z)`
   * gives the floor height inside the rect. Later regions win.
   */
  addGround(x0: number, x1: number, z0: number, z1: number, height: (x: number, z: number) => number) {
    this.grounds.push({ rect: { x0, x1, z0, z1 }, height });
  }

  /** Water with its surface at `y` over a rect (swimmable). */
  addWater(x0: number, x1: number, z0: number, z1: number, y: number) {
    this.waters.push({ rect: { x0, x1, z0, z1 }, y });
  }

  /** Floor height under (x, z). */
  groundAt(x: number, z: number): number {
    for (let i = this.grounds.length - 1; i >= 0; i--) {
      const { rect, height } = this.grounds[i];
      if (x >= rect.x0 && x <= rect.x1 && z >= rect.z0 && z <= rect.z1) return height(x, z);
    }
    return 0;
  }

  /** Water surface height over (x, z), or null when dry. */
  waterAt(x: number, z: number): number | null {
    for (const w of this.waters) if (x >= w.rect.x0 && x <= w.rect.x1 && z >= w.rect.z0 && z <= w.rect.z1) return w.y;
    return null;
  }

  addSurface(surface: Surface, x0: number, x1: number, z0: number, z1: number) {
    this.surfaces.push({ rect: { x0, x1, z0, z1 }, surface });
  }

  surfaceAt(x: number, z: number): Surface {
    for (let i = this.surfaces.length - 1; i >= 0; i--) {
      const { rect, surface } = this.surfaces[i];
      if (x >= rect.x0 && x <= rect.x1 && z >= rect.z0 && z <= rect.z1) return surface;
    }
    return 'marble';
  }

  private inWalkable(x: number, z: number, r: number) {
    // The point must be inside some walkable rect, with the radius kept inside the union:
    // check the four extreme points of the circle.
    const pts: [number, number][] = [
      [x, z],
      [x + r, z],
      [x - r, z],
      [x, z + r],
      [x, z - r],
    ];
    return pts.every(([px, pz]) => this.walk.some((w) => px >= w.x0 && px <= w.x1 && pz >= w.z0 && pz <= w.z1));
  }

  /** Pushes a circle of radius r out of obstacles. Returns the corrected point. */
  private pushOut(x: number, z: number, r: number, seats = false): [number, number] {
    for (let iter = 0; iter < 3; iter++) {
      for (const c of this.circles) [x, z] = pushCircle(x, z, r, c.x, c.z, c.r);
      if (seats) for (const c of this.seatList) [x, z] = pushCircle(x, z, r, c.x, c.z, SEAT_SOLID);
      for (const b of this.boxes) {
        if (b.soft && !seats) continue;
        const cos = Math.cos(b.yaw),
          sin = Math.sin(b.yaw);
        // World -> box local (box yaw rotates local +X to (cos, -sin)).
        const dx = x - b.x,
          dz = z - b.z;
        const lx = dx * cos - dz * sin;
        const lz = dx * sin + dz * cos;
        const cx = THREE.MathUtils.clamp(lx, -b.hw, b.hw);
        const cz = THREE.MathUtils.clamp(lz, -b.hd, b.hd);
        let ex = lx - cx,
          ez = lz - cz;
        let d = Math.hypot(ex, ez);
        if (d >= r) continue;
        let nlx: number, nlz: number;
        if (d < 1e-6) {
          // Centre inside the box: leave by the nearest face.
          const px = b.hw - Math.abs(lx),
            pz = b.hd - Math.abs(lz);
          if (px < pz) {
            nlx = Math.sign(lx || 1) * (b.hw + r);
            nlz = lz;
          } else {
            nlx = lx;
            nlz = Math.sign(lz || 1) * (b.hd + r);
          }
        } else {
          ex /= d;
          ez /= d;
          d = r;
          nlx = cx + ex * d;
          nlz = cz + ez * d;
        }
        x = b.x + nlx * cos + nlz * sin;
        z = b.z - nlx * sin + nlz * cos;
      }
    }
    return [x, z];
  }

  /**
   * Moves from (x, z) by (dx, dz) for a body of radius r, sliding along walls
   * and around obstacles.
   */
  move(x: number, z: number, dx: number, dz: number, r = 0.25, seats = false): [number, number] {
    let [nx, nz] = this.pushOut(x + dx, z + dz, r, seats);
    if (this.inWalkable(nx, nz, r)) return [nx, nz];
    // Slide along one axis.
    [nx, nz] = this.pushOut(x + dx, z, r, seats);
    if (this.inWalkable(nx, nz, r)) return [nx, nz];
    [nx, nz] = this.pushOut(x, z + dz, r, seats);
    if (this.inWalkable(nx, nz, r)) return [nx, nz];
    return [x, z];
  }

  /** Nearest free spot to (x, z), for teleports. */
  settle(x: number, z: number, r = 0.25, seats = false): [number, number] | null {
    const [nx, nz] = this.pushOut(x, z, r, seats);
    return this.inWalkable(nx, nz, r) ? [nx, nz] : null;
  }

  /** Inside the walls (anywhere you could stand, obstacles aside)? */
  isInside(x: number, z: number): boolean {
    return this.inWalkable(x, z, 0.02);
  }

  /**
   * Is a body of radius r clear of walls and obstacles at (x, z)? With `seats`,
   * stools count as obstacles too (walking guests go around them; you don't).
   */
  isFree(x: number, z: number, r = 0.25, seats = false): boolean {
    const [nx, nz] = this.pushOut(x, z, r, seats);
    return Math.hypot(nx - x, nz - z) < 1e-3 && this.inWalkable(x, z, r);
  }
}

/** How close to a stool's centre your feet must be to sit on it. */
export const SEAT_R = 0.26;

/** A stool's solid radius for walking guests (its seat, not the area you sit in). */
const SEAT_SOLID = 0.2;

function worldYaw(obj: THREE.Object3D) {
  return new THREE.Euler().setFromQuaternion(obj.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
}

function pushCircle(x: number, z: number, r: number, cx: number, cz: number, cr: number): [number, number] {
  const dx = x - cx,
    dz = z - cz;
  const d = Math.hypot(dx, dz);
  const min = cr + r;
  if (d >= min) return [x, z];
  // Dead centre: leave in any direction.
  if (d <= 1e-6) return [cx + min, cz];
  return [cx + (dx / d) * min, cz + (dz / d) * min];
}
