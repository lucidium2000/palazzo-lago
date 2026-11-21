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
}

interface Box {
  x: number;
  z: number;
  hw: number;
  hd: number;
  yaw: number;
}

export class World {
  /** Areas you can stand in (their union). */
  private walk: Rect[] = [];
  private circles: Circle[] = [];
  private boxes: Box[] = [];
  private surfaces: { rect: Rect; surface: Surface }[] = [];

  addWalkable(x0: number, x1: number, z0: number, z1: number) {
    this.walk.push({ x0, x1, z0, z1 });
  }

  addCircle(x: number, z: number, r: number) {
    this.circles.push({ x, z, r });
  }

  /** An obstacle box centred at (x, z), half-sizes along its own axes, rotated by yaw. */
  addBox(x: number, z: number, w: number, d: number, yaw = 0) {
    this.boxes.push({ x, z, hw: w / 2, hd: d / 2, yaw });
  }

  /** Adds a box in an object's local frame (e.g. a table group). */
  addLocalBox(obj: THREE.Object3D, cx: number, cz: number, w: number, d: number) {
    obj.updateMatrixWorld(true);
    const p = new THREE.Vector3(cx, 0, cz).applyMatrix4(obj.matrixWorld);
    const yaw = new THREE.Euler().setFromQuaternion(obj.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
    this.addBox(p.x, p.z, w, d, yaw);
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
  private pushOut(x: number, z: number, r: number): [number, number] {
    for (let iter = 0; iter < 3; iter++) {
      for (const c of this.circles) {
        const dx = x - c.x,
          dz = z - c.z;
        const d = Math.hypot(dx, dz);
        const min = c.r + r;
        if (d < min && d > 1e-6) {
          x = c.x + (dx / d) * min;
          z = c.z + (dz / d) * min;
        }
      }
      for (const b of this.boxes) {
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
  move(x: number, z: number, dx: number, dz: number, r = 0.25): [number, number] {
    let [nx, nz] = this.pushOut(x + dx, z + dz, r);
    if (this.inWalkable(nx, nz, r)) return [nx, nz];
    // Slide along one axis.
    [nx, nz] = this.pushOut(x + dx, z, r);
    if (this.inWalkable(nx, nz, r)) return [nx, nz];
    [nx, nz] = this.pushOut(x, z + dz, r);
    if (this.inWalkable(nx, nz, r)) return [nx, nz];
    return [x, z];
  }

  /** Nearest free spot to (x, z), for teleports. */
  settle(x: number, z: number, r = 0.25): [number, number] | null {
    const [nx, nz] = this.pushOut(x, z, r);
    return this.inWalkable(nx, nz, r) ? [nx, nz] : null;
  }

  isFree(x: number, z: number, r = 0.25): boolean {
    const [nx, nz] = this.pushOut(x, z, r);
    return Math.hypot(nx - x, nz - z) < 1e-3 && this.inWalkable(x, z, r);
  }
}
