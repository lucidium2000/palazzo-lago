import * as THREE from 'three';
import { singlePassWhereSafe } from './merge';

/**
 * Portal and detail culling for the main resort (the casino floor, the poker
 * room, the hotel corridor and lobby, the elevator cabs and the outdoors).
 *
 * Three.js only culls against the view frustum, so from the hotel lobby (or the
 * poker room, or a lift cab) every table, machine and chandelier on the casino
 * floor behind the walls was still drawn: 400+ draw calls. Here the resort is
 * split into cells joined by portals (doorways). Each frame we walk from the
 * cell your eye is in through the doorways it can see, narrowing a frustum at
 * each one (the four planes from your eye through the doorway's edges), and
 * only draw things in other cells whose bounding sphere lies inside one of
 * those frusta. Things in your own cell are always drawn, except tiny distant
 * detail (a chip 10 m away is a pixel or two): small enough for its distance
 * and it is skipped.
 *
 * Culled objects are moved to a layer no camera renders (layer 31) rather than
 * made invisible, so this never fights the game's own `visible` switches; the
 * interaction raycasters enable all layers, so they still hit them.
 */

/** A cell: an axis-aligned box in the world (x0, x1, z0, z1, top y). */
export interface CullCell {
  name: string;
  box?: [number, number, number, number, number];
}

/** A doorway between two cells: a rectangle in a wall (x = at or z = at). */
export interface CullPortal {
  a: number;
  b: number;
  /** Portal plane: `x` = at (spanning z from..to) or `z` = at (spanning x). Omit for an open join (no culling). */
  axis?: 'x' | 'z';
  at?: number;
  from?: number;
  to?: number;
  y0?: number;
  y1?: number;
  /** Closed doors (a lift's) block the view. */
  open?: () => boolean;
}

export const CULLED_LAYER = 31;
const CULLED_MASK = 1 << CULLED_LAYER;
const DEFAULT_MASK = 1;

interface Entry {
  o: THREE.Object3D;
  /** Local bounding-sphere centre and radius. */
  c: THREE.Vector3;
  r: number;
  /** May be skipped when small and far (not skinned or instanced). */
  detail: boolean;
  culled: boolean;
  gen: number;
  /** `c`/`r` are a world sphere (a hint for something three never frustum culls): we frustum cull it too. */
  world: boolean;
  /** Big meshes: their world box (tighter than the sphere for telling which cells they reach into). */
  box: THREE.Box3 | null;
  boxKey: number;
  /** The top-level object it hangs under (skipped while the zone culling hides it). */
  top: THREE.Object3D;
  /** Cached world centre, radius and cell (recomputed when its matrix changes). */
  wc: THREE.Vector3;
  wr: number;
  cell: number;
  mk: number;
}

/** A frustum (a run of planes in the pool) through which a cell is seen. */
interface View {
  cell: number;
  start: number;
  count: number;
}

const MAX_PLANES = 256;
const MAX_VIEWS = 48;
const MAX_DEPTH = 5;
/** Spheres bigger than this (m) may span cells: they're drawn if any doorway's frustum reaches them. */
const BIG = 4;

export class Culler {
  /** Tiny-detail rule: skipped beyond `detailMin` m when radius < `detailK` × distance. */
  detailK = 0.006;
  detailMin = 8;
  /** The same for things in other cells, seen far off through a doorway. */
  detailKFar = 0.012;
  /** Never cull anything this close to the eye (things in your hands, a doorway you stand in). */
  keepNear = 1.6;
  /** Spheres are grown by this much in the portal tests (two eyes, a moving head, last frame's pose). */
  margin = 0.25;
  /** Seconds between rescans of the roots (objects added later get picked up). */
  rescanEvery = 2;

  private entries: Entry[] = [];
  private byObj = new Map<THREE.Object3D, Entry>();
  private gen = 0;
  private sinceScan = Infinity;
  private planes: THREE.Plane[] = [];
  private views: View[] = [];
  private nViews = 0;
  private nPlanes = 0;
  private eyeCell = -1;
  private readonly eye = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly pa = new THREE.Vector3();
  private readonly pb = new THREE.Vector3();
  private readonly pc = new THREE.Vector3();
  private readonly corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly reached = new Uint8Array(64);
  private readonly frustum = new THREE.Frustum();
  private readonly pm = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private readonly path: number[] = [];
  private active = false;
  /** Draws culled at the last update (for ?stats and tests). */
  culledCount = 0;

  constructor(
    readonly cells: CullCell[],
    readonly portals: CullPortal[],
    private roots: () => THREE.Object3D[],
    private skip: (o: THREE.Object3D) => boolean = () => false,
  ) {
    for (let i = 0; i < MAX_PLANES; i++) this.planes.push(new THREE.Plane());
    for (let i = 0; i < MAX_VIEWS; i++) this.views.push({ cell: 0, start: 0, count: 0 });
  }

  /** The cell a point is in (later boxes win, so a lift cab inside the deck's box is the cab; a cell without a box is the default). */
  cellAt(x: number, y: number, z: number): number {
    let fallback = 0;
    for (let i = this.cells.length - 1; i >= 0; i--) {
      const b = this.cells[i].box;
      if (!b) {
        fallback = i;
        continue;
      }
      if (x >= b[0] && x <= b[1] && z >= b[2] && z <= b[3] && y <= b[4]) return i;
    }
    return fallback;
  }

  /** Picks up objects under the roots (and drops ones no longer there). Allocates only for new objects. */
  rescan() {
    const gen = ++this.gen;
    const visit = (o: THREE.Object3D, top: THREE.Object3D) => {
      if (this.skip(o)) return;
      const m = o as THREE.Mesh;
      const hint = o.userData.cullSphere as THREE.Sphere | undefined;
      if ((m.isMesh || (o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.Line).isLine) && (o.frustumCulled || hint) && (o.layers.mask === DEFAULT_MASK || o.layers.mask === CULLED_MASK)) {
        let e = this.byObj.get(o);
        if (!e && !o.frustumCulled) {
          if (m.isMesh) singlePassWhereSafe(m);
          // Never frustum culled by three (its extent moves about), but with a world sphere it stays within.
          e = { o, c: hint!.center, r: hint!.radius, detail: false, culled: false, gen, world: true, box: null, boxKey: NaN, top, wc: hint!.center, wr: hint!.radius, cell: -1, mk: NaN };
          this.byObj.set(o, e);
          this.entries.push(e);
        } else if (!e) {
          if (m.isMesh) singlePassWhereSafe(m);
          const skinned = (o as THREE.SkinnedMesh).isSkinnedMesh;
          const inst = (o as THREE.InstancedMesh).isInstancedMesh;
          let c = new THREE.Vector3();
          let r = 1;
          if (skinned) r = 1.5;
          else if (inst) {
            // (Its live bounding sphere is read each update: the instances move.)
            r = -1;
          } else if ((o as THREE.Sprite).isSprite) {
            r = 0.75;
          } else if (m.geometry) {
            if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
            const s = m.geometry.boundingSphere!;
            c = s.center.clone();
            r = s.radius;
          }
          if (!Number.isFinite(r)) return;
          e = { o, c, r, detail: !skinned, culled: false, gen, world: false, box: null, boxKey: NaN, top, wc: new THREE.Vector3(), wr: 0, cell: -1, mk: NaN };
          this.byObj.set(o, e);
          this.entries.push(e);
        }
        e.gen = gen;
        e.top = top;
      }
      for (const k of o.children) visit(k, top);
    };
    for (const root of this.roots()) visit(root, root);
    // Drop what's gone (restoring its layer, in case it comes back).
    let w = 0;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (e.gen === gen) this.entries[w++] = e;
      else {
        if (e.culled) e.o.layers.mask = DEFAULT_MASK;
        this.byObj.delete(e.o);
      }
    }
    this.entries.length = w;
  }

  /** Shows everything again (before a reflection capture, or when leaving the main resort). */
  clear() {
    for (const e of this.entries) {
      if (e.culled) {
        e.culled = false;
        e.o.layers.mask = DEFAULT_MASK;
      }
    }
    this.active = false;
    this.culledCount = 0;
  }

  /**
   * Culls for an eye at `eye` (world). `enabled` false (in the suite, on the Promenade) shows all
   * (the zone culling hides the whole resort there anyway).
   */
  update(dt: number, eye: THREE.Vector3, enabled = true, camera?: THREE.Camera) {
    if (!enabled) {
      if (this.active) this.clear();
      return;
    }
    this.sinceScan += dt;
    if (this.sinceScan >= this.rescanEvery) {
      this.sinceScan = 0;
      this.rescan();
    }
    this.active = true;
    this.computeViews(eye);
    let frustum: THREE.Frustum | null = null;
    if (camera) {
      // (In VR the camera carries both eyes' combined projection.)
      this.frustum.setFromProjectionMatrix(this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      frustum = this.frustum;
    }
    let n = 0;
    const near2 = this.keepNear * this.keepNear;
    const dmin2 = this.detailMin * this.detailMin;
    const k2 = this.detailK * this.detailK;
    const kf2 = this.detailKFar * this.detailKFar;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      // A whole area the zone culling hides: nothing to do (its state stands till it's back).
      if (!e.top.visible) continue;
      const mw = e.o.matrixWorld;
      let c: THREE.Vector3, r: number;
      let cell = -1;
      if (e.world) {
        c = e.c;
        r = e.r;
        if (frustum && !frustum.intersectsSphere(this.sphere.set(c, r))) {
          if (!e.culled) {
            e.culled = true;
            e.o.layers.mask = CULLED_MASK;
          }
          n++;
          continue;
        }
      } else if (e.r < 0) {
        // Instanced: the sphere round all its instances (three keeps it, and drops it when they move).
        const im = e.o as THREE.InstancedMesh;
        // (Not drawn, three won't recompute it: do it here, for the small ones.)
        if (!im.boundingSphere && im.count <= 256) im.computeBoundingSphere();
        const bs = im.boundingSphere;
        if (!bs || bs.radius < 0) {
          if (e.culled) {
            e.culled = false;
            e.o.layers.mask = DEFAULT_MASK;
          }
          continue;
        }
        c = this.v.copy(bs.center).applyMatrix4(mw);
        r = bs.radius * mw.getMaxScaleOnAxis();
      } else {
        // Most things never move: their centre, size and cell are worked out once.
        const el = mw.elements;
        const key = el[0] + el[1] * 1.3 + el[2] * 1.7 + el[5] * 2.3 + el[10] * 2.9 + el[12] * 3.1 + el[13] * 5.3 + el[14] * 7.7;
        if (key !== e.mk) {
          e.mk = key;
          e.wc.copy(e.c).applyMatrix4(mw);
          e.wr = e.r * (e.detail ? mw.getMaxScaleOnAxis() : 1);
          e.cell = this.cellAt(e.wc.x, e.wc.y, e.wc.z);
        }
        c = e.wc;
        r = e.wr;
        cell = e.cell;
      }
      const dx = c.x - eye.x,
        dy = c.y - eye.y,
        dz = c.z - eye.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      let cull = false;
      if (d2 > near2) {
        if (cell < 0) cell = this.cellAt(c.x, c.y, c.z);
        let here = cell === this.eyeCell;
        if (!here && r > BIG && e.r > 0 && !e.world) {
          // (Allocates only when a big mesh moves, which they don't.)
          const key = mw.elements[0] + mw.elements[12] * 3 + mw.elements[13] * 5 + mw.elements[14] * 7;
          if (key !== e.boxKey) {
            const g = (e.o as THREE.Mesh).geometry;
            if (!g.boundingBox) g.computeBoundingBox();
            e.box = (e.box ?? new THREE.Box3()).copy(g.boundingBox!).applyMatrix4(mw);
            e.boxKey = key;
          }
          here = this.boxInEyeCell(e.box!);
        } else if (!here) here = this.touchesEyeCell(c, r);
        if (!here && !this.inViews(cell, c, r + this.margin) && !(r > BIG && this.inAnyView(c, r + this.margin))) cull = true;
        else if (e.detail && d2 > dmin2) {
          // Tiny for its distance (a little hysteresis so it doesn't flicker at the edge).
          const k = (here ? k2 : kf2) * (e.culled ? 0.81 : 1);
          if (r * r < k * d2) cull = true;
        }
      }
      if (cull !== e.culled) {
        e.culled = cull;
        e.o.layers.mask = cull ? CULLED_MASK : DEFAULT_MASK;
      }
      if (cull) n++;
    }
    this.culledCount = n;
  }

  /** Could a sphere be seen from the eye at the last update (its cell, through the doorways)? */
  sees(x: number, y: number, z: number, r: number): boolean {
    if (!this.active) return true;
    const dx = x - this.eye.x,
      dy = y - this.eye.y,
      dz = z - this.eye.z;
    if (dx * dx + dy * dy + dz * dz < (this.keepNear + r) ** 2) return true;
    const cell = this.cellAt(x, y, z);
    this.pc.set(x, y, z);
    if (cell === this.eyeCell || this.touchesEyeCell(this.pc, r)) return true;
    return this.inViews(cell, this.pc, r + this.margin);
  }

  /** Does a sphere reach into the eye's own cell (something big, centred next door)? */
  private touchesEyeCell(c: THREE.Vector3, r: number): boolean {
    const b = this.cells[this.eyeCell]?.box;
    if (!b) return false;
    const dx = Math.max(b[0] - c.x, 0, c.x - b[1]),
      dz = Math.max(b[2] - c.z, 0, c.z - b[3]),
      dy = Math.max(0, c.y - b[4]);
    return dx * dx + dy * dy + dz * dz < r * r;
  }

  /** Does a box reach into the eye's own cell (by more than a wall's width)? */
  private boxInEyeCell(bx: THREE.Box3): boolean {
    const b = this.cells[this.eyeCell]?.box;
    if (!b) return false;
    const t = 0.1;
    return bx.max.x > b[0] + t && bx.min.x < b[1] - t && bx.max.z > b[2] + t && bx.min.z < b[3] - t && bx.min.y < b[4] - t;
  }

  /** In any frustum at all (for big things spanning cells, whose centre's cell says little). */
  private inAnyView(c: THREE.Vector3, r: number): boolean {
    for (let i = 0; i < this.nViews; i++) {
      const v = this.views[i];
      let inside = true;
      for (let p = v.start; p < v.start + v.count; p++) {
        if (this.planes[p].distanceToPoint(c) < -r) {
          inside = false;
          break;
        }
      }
      if (inside) return true;
    }
    return false;
  }

  private inViews(cell: number, c: THREE.Vector3, r: number): boolean {
    for (let i = 0; i < this.nViews; i++) {
      const v = this.views[i];
      if (v.cell !== cell) continue;
      let inside = true;
      for (let p = v.start; p < v.start + v.count; p++) {
        if (this.planes[p].distanceToPoint(c) < -r) {
          inside = false;
          break;
        }
      }
      if (inside) return true;
    }
    return false;
  }

  /** Walks the portals from the eye's cell, recording a frustum for every cell reached. */
  private computeViews(eye: THREE.Vector3) {
    this.eye.copy(eye);
    this.eyeCell = this.cellAt(eye.x, eye.y, eye.z);
    this.nViews = 0;
    this.nPlanes = 0;
    this.reached.fill(0);
    this.path.length = 0;
    this.path.push(this.eyeCell);
    this.walk(this.eyeCell, 0, 0, 0, false);
  }

  private walk(cell: number, start: number, count: number, depth: number, wentOpen: boolean) {
    if (depth >= MAX_DEPTH) return;
    for (let pi = 0; pi < this.portals.length; pi++) {
      const p = this.portals[pi];
      const next = p.a === cell ? p.b : p.b === cell ? p.a : -1;
      if (next < 0 || this.path.includes(next)) continue;
      if (p.open && !p.open()) continue;
      // Open joins (no doorway to narrow the view) don't chain: one per path.
      if (p.axis === undefined && wentOpen) continue;
      let s = start,
        n = count;
      if (p.axis !== undefined) {
        const added = this.portalPlanes(p, next, start, count);
        if (added < 0) continue;
        if (added > 0) {
          s = this.nPlanes - (count + added);
          n = count + added;
        }
      }
      if (this.nViews < MAX_VIEWS) {
        const v = this.views[this.nViews++];
        v.cell = next;
        v.start = s;
        v.count = n;
      }
      this.path.push(next);
      this.walk(next, s, n, depth + 1, wentOpen || p.axis === undefined);
      this.path.pop();
    }
  }

  /**
   * Adds the planes for looking through portal `p` into cell `next` (copying the current run first so
   * runs stay contiguous). Returns the number of planes added, 0 when standing in the doorway (no
   * narrowing), or -1 when the doorway can't be seen at all.
   */
  private portalPlanes(p: CullPortal, next: number, start: number, count: number): number {
    const e = this.eye;
    const at = p.at!,
      y0 = p.y0 ?? 0,
      y1 = p.y1 ?? 3;
    const lo = Math.min(p.from!, p.to!),
      hi = Math.max(p.from!, p.to!);
    // Which side of the portal is the next cell on? (Its box, or for the default cell the side away from ours.)
    const nb = this.cells[next].box;
    const ob = this.cells[p.a === next ? p.b : p.a].box;
    const mid = (bx: [number, number, number, number, number]) => (p.axis === 'x' ? (bx[0] + bx[1]) / 2 : (bx[2] + bx[3]) / 2);
    const nextSide = nb ? Math.sign(mid(nb) - at) : ob ? -Math.sign(mid(ob) - at) : 1;
    const eyeAlong = p.axis === 'x' ? e.x : e.z;
    const eyeAcross = p.axis === 'x' ? e.z : e.x;
    const ahead = (at - eyeAlong) * nextSide; // > 0: the portal is in front, between us and the next cell
    // In the doorway: no narrowing.
    if (Math.abs(at - eyeAlong) < 0.45 && eyeAcross > lo - 0.3 && eyeAcross < hi + 0.3 && e.y > y0 - 0.3 && e.y < y1 + 0.3) return 0;
    if (ahead <= 0.01) return -1;
    if (this.nPlanes + count + 5 > MAX_PLANES) return 0;
    // Corners, going round.
    const C = this.corners;
    if (p.axis === 'x') {
      C[0].set(at, y0, lo);
      C[1].set(at, y0, hi);
      C[2].set(at, y1, hi);
      C[3].set(at, y1, lo);
    } else {
      C[0].set(lo, y0, at);
      C[1].set(hi, y0, at);
      C[2].set(hi, y1, at);
      C[3].set(lo, y1, at);
    }
    // The doorway must itself be inside the current frustum.
    const cx = (C[0].x + C[2].x) / 2,
      cy = (y0 + y1) / 2,
      cz = (C[0].z + C[2].z) / 2;
    const pr = 0.5 * Math.hypot(hi - lo, y1 - y0);
    this.pc.set(cx, cy, cz);
    for (let i = start; i < start + count; i++) if (this.planes[i].distanceToPoint(this.pc) < -pr) return -1;
    // Copy the current run, then add the doorway's planes.
    const base = this.nPlanes;
    for (let i = 0; i < count; i++) this.planes[base + i].copy(this.planes[start + i]);
    let w = base + count;
    for (let i = 0; i < 4; i++) {
      const pl = this.planes[w++];
      pl.setFromCoplanarPoints(e, C[i], C[(i + 1) % 4]);
      if (pl.distanceToPoint(this.pc) < 0) pl.negate();
    }
    // And only beyond the doorway.
    const pl = this.planes[w++];
    if (p.axis === 'x') this.pa.set(nextSide, 0, 0);
    else this.pa.set(0, 0, nextSide);
    pl.setFromNormalAndCoplanarPoint(this.pa, this.pb.set(cx, cy, cz));
    this.nPlanes = w;
    return 5;
  }
}

/** A raycaster that also hits culled things (they're on another layer, not gone). */
export function allLayers(r: THREE.Raycaster): THREE.Raycaster {
  r.layers.enableAll();
  return r;
}
