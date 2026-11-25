import * as THREE from 'three';
import type { World } from './world';

/**
 * Debug view of the walkable world: every obstacle outlined on the floor
 * (circles and boxes in red, stools you can sit on in green, walkable areas in
 * faint blue). Toggle with `window.casino.colliders.show()` or Ctrl+Shift+C;
 * `list()` prints a count by kind.
 */
export class ColliderDebug {
  readonly group = new THREE.Group();
  private built = -1;

  constructor(
    private scene: THREE.Scene,
    private world: World,
    private renderer?: THREE.WebGLRenderer,
    /** Objects left out of a coverage audit (people, your own body). */
    private skip: THREE.Object3D[] = [],
  ) {
    this.group.name = 'collider-debug';
    this.group.visible = false;
    scene.add(this.group);
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyC' && e.ctrlKey && e.shiftKey) this.show(!this.group.visible);
    });
  }

  show(on = true) {
    if (on) this.rebuild();
    this.group.visible = on;
    return on;
  }

  /** Counts of obstacles (and seats) by kind. */
  list() {
    const c = this.world.counts();
    const all = this.world.colliders();
    return { total: all.circles.length + all.boxes.length, seats: all.seats.length, byKind: c };
  }

  private rebuild() {
    const all = this.world.colliders();
    const n = all.circles.length + all.boxes.length + all.seats.length;
    if (n === this.built) return;
    this.built = n;
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      (c as THREE.LineSegments).geometry?.dispose();
    }
    const solid: number[] = [],
      seat: number[] = [],
      walk: number[] = [];
    const Y = 0.04;
    const ring = (out: number[], x: number, z: number, r: number, y = Y) => {
      const k = 24;
      for (let i = 0; i < k; i++) {
        const a0 = (i / k) * Math.PI * 2,
          a1 = ((i + 1) / k) * Math.PI * 2;
        out.push(x + Math.cos(a0) * r, y, z + Math.sin(a0) * r, x + Math.cos(a1) * r, y, z + Math.sin(a1) * r);
      }
    };
    for (const c of all.circles) ring(solid, c.x, c.z, c.r);
    for (const b of all.boxes) {
      const cos = Math.cos(b.yaw),
        sin = Math.sin(b.yaw);
      const corner = (lx: number, lz: number): [number, number] => [b.x + lx * cos + lz * sin, b.z - lx * sin + lz * cos];
      const pts = [corner(-b.hw, -b.hd), corner(b.hw, -b.hd), corner(b.hw, b.hd), corner(-b.hw, b.hd)];
      for (let i = 0; i < 4; i++) {
        const [ax, az] = pts[i],
          [bx, bz] = pts[(i + 1) % 4];
        solid.push(ax, Y, az, bx, Y, bz);
      }
      // A cross so filled boxes read at a glance.
      solid.push(pts[0][0], Y, pts[0][1], pts[2][0], Y, pts[2][1], pts[1][0], Y, pts[1][1], pts[3][0], Y, pts[3][1]);
    }
    for (const s of all.seats) {
      ring(seat, s.x, s.z, s.r);
      ring(seat, s.x, s.z, 0.05, s.y);
      seat.push(s.x, Y, s.z, s.x, s.y, s.z);
      if (s.yaw !== null) seat.push(s.x, Y, s.z, s.x + Math.sin(s.yaw) * s.r, Y, s.z + Math.cos(s.yaw) * s.r);
    }
    for (const w of all.walk) {
      const y = 0.02;
      walk.push(w.x0, y, w.z0, w.x1, y, w.z0, w.x1, y, w.z0, w.x1, y, w.z1, w.x1, y, w.z1, w.x0, y, w.z1, w.x0, y, w.z1, w.x0, y, w.z0);
    }
    const lines = (pts: number[], color: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, toneMapped: false }));
      l.renderOrder = 3000;
      l.frustumCulled = false;
      l.raycast = () => {};
      this.group.add(l);
    };
    lines(walk, 0x3a7aff);
    lines(solid, 0xff2a2a);
    lines(seat, 0x2aff5a);
  }

  /**
   * Coverage audit: renders a top-down slice of the scene between heights y0
   * and y1 (anything solid you'd walk into) over the rect x0..x1, z0..z1, and
   * compares it with the obstacles. Returns the clusters of solid stuff inside
   * the walkable area that no obstacle (or seat) covers, biggest first, and a
   * map image (white: covered solid, red: uncovered solid, dark red: obstacle
   * over empty floor, green: seat, blue: walkable floor).
   */
  audit(x0: number, x1: number, z0: number, z1: number, o: { res?: number; y0?: number; y1?: number; minArea?: number } = {}) {
    const renderer = this.renderer;
    if (!renderer) throw new Error('audit needs the renderer');
    const res = o.res ?? 0.05,
      y0 = o.y0 ?? 0.12,
      y1 = o.y1 ?? 1.8;
    const W = Math.round((x1 - x0) / res),
      H = Math.round((z1 - z0) / res);
    const cam = new THREE.OrthographicCamera(-(x1 - x0) / 2, (x1 - x0) / 2, (z1 - z0) / 2, -(z1 - z0) / 2, 0, y1 - y0);
    cam.position.set((x0 + x1) / 2, y1, (z0 + z1) / 2);
    cam.up.set(0, 0, -1);
    cam.lookAt((x0 + x1) / 2, 0, (z0 + z1) / 2);
    cam.updateMatrixWorld(true);
    // Show everything solid; hide people, effects, floors and rugs.
    const changed: [THREE.Object3D, boolean][] = [];
    const set = (obj: THREE.Object3D, v: boolean) => {
      if (obj.visible !== v) {
        changed.push([obj, obj.visible]);
        obj.visible = v;
      }
    };
    for (const c of this.scene.children) set(c, true);
    for (const s of this.skip) set(s, false);
    set(this.group, false);
    const box = new THREE.Box3();
    this.scene.traverse((obj) => {
      const any = obj as THREE.Mesh & { isSprite?: boolean; isPoints?: boolean; isLine?: boolean };
      if (any.isSprite || any.isPoints || any.isLine) return set(obj, false);
      if (!(obj as THREE.Mesh).isMesh) return;
      const mesh = obj as THREE.Mesh;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (mats.every((m) => m.blending === THREE.AdditiveBlending || (m.transparent && m.opacity < 0.6) || !m.visible)) return set(obj, false);
      if (!(mesh as THREE.InstancedMesh).isInstancedMesh) {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        box.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
        const sz = box.getSize(new THREE.Vector3());
        if (sz.y < 0.03 && Math.max(sz.x, sz.z) > 2.5) set(obj, false);
      }
    });
    const rt = new THREE.WebGLRenderTarget(W, H);
    const bg = this.scene.background,
      fog = this.scene.fog,
      over = this.scene.overrideMaterial;
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    this.scene.background = new THREE.Color(0);
    this.scene.fog = null;
    this.scene.overrideMaterial = mat;
    const prevRt = renderer.getRenderTarget();
    const xr = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(this.scene, cam);
    const px = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
    renderer.setRenderTarget(prevRt);
    renderer.xr.enabled = xr;
    this.scene.background = bg;
    this.scene.fog = fog;
    this.scene.overrideMaterial = over;
    rt.dispose();
    mat.dispose();
    for (const [obj, v] of changed) obj.visible = v;

    // Classify each cell (row 0 of the read-back is the bottom of the view: z1).
    const img = new Uint8ClampedArray(W * H * 4);
    const loose = new Uint8Array(W * H);
    for (let j = 0; j < H; j++) {
      const z = z1 - (j + 0.5) * res;
      for (let i = 0; i < W; i++) {
        const x = x0 + (i + 0.5) * res;
        const k = j * W + i;
        const occ = px[k * 4] > 100;
        const inside = this.world.isInside(x, z);
        const blocked = inside && !this.world.isFree(x, z, 0.01);
        const seat = inside && !!this.world.seatAt(x, z);
        let c: [number, number, number] = [20, 20, 24];
        if (inside) c = [24, 40, 90];
        if (blocked) c = [110, 20, 20];
        if (seat) c = [30, 140, 60];
        if (occ) c = !inside ? [90, 90, 90] : blocked || seat ? [235, 235, 235] : [255, 40, 40];
        if (occ && inside && !blocked && !seat) loose[k] = 1;
        // Image rows go top (z0) to bottom (z1).
        const q = ((H - 1 - j) * W + i) * 4;
        img[q] = c[0];
        img[q + 1] = c[1];
        img[q + 2] = c[2];
        img[q + 3] = 255;
      }
    }
    // Clusters of uncovered solid cells.
    const seen = new Uint8Array(W * H);
    const clusters: { x0: number; x1: number; z0: number; z1: number; area: number }[] = [];
    const stack: number[] = [];
    for (let k0 = 0; k0 < W * H; k0++) {
      if (!loose[k0] || seen[k0]) continue;
      let n = 0,
        i0 = W,
        i1 = 0,
        j0 = H,
        j1 = 0;
      stack.push(k0);
      seen[k0] = 1;
      while (stack.length) {
        const k = stack.pop()!;
        n++;
        const i = k % W,
          j = (k / W) | 0;
        i0 = Math.min(i0, i);
        i1 = Math.max(i1, i);
        j0 = Math.min(j0, j);
        j1 = Math.max(j1, j);
        for (const [di, dj] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const ii = i + di,
            jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
          const kk = jj * W + ii;
          if (loose[kk] && !seen[kk]) {
            seen[kk] = 1;
            stack.push(kk);
          }
        }
      }
      const area = n * res * res;
      if (area >= (o.minArea ?? 0.02)) {
        const r2 = (v: number) => Math.round(v * 100) / 100;
        clusters.push({ x0: r2(x0 + i0 * res), x1: r2(x0 + (i1 + 1) * res), z0: r2(z1 - (j1 + 1) * res), z1: r2(z1 - j0 * res), area: r2(area) });
      }
    }
    clusters.sort((a, b) => b.area - a.area);
    let url = '';
    if (typeof document !== 'undefined') {
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      cv.getContext('2d')!.putImageData(new ImageData(img, W, H), 0, 0);
      url = cv.toDataURL('image/png');
    }
    return { clusters, image: url, size: [W, H] };
  }

  /**
   * Debug snapshot from any point (e.g. a third-person look at your own VR
   * body): renders the scene from `from` looking at `at` into an image (data URL).
   */
  view(from: [number, number, number], at: [number, number, number], w = 640, h = 480, fov = 50) {
    const renderer = this.renderer;
    if (!renderer || typeof document === 'undefined') return '';
    const cam = new THREE.PerspectiveCamera(fov, w / h, 0.03, 200);
    cam.position.set(...from);
    cam.lookAt(...at);
    cam.updateMatrixWorld(true);
    const rt = new THREE.WebGLRenderTarget(w, h);
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const prev = renderer.getRenderTarget(),
      xr = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.setRenderTarget(rt);
    renderer.render(this.scene, cam);
    const px = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
    renderer.setRenderTarget(prev);
    renderer.xr.enabled = xr;
    rt.dispose();
    const img = new Uint8ClampedArray(w * h * 4);
    for (let j = 0; j < h; j++) img.set(px.subarray((h - 1 - j) * w * 4, (h - j) * w * 4), j * w * 4);
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    cv.getContext('2d')!.putImageData(new ImageData(img, w, h), 0, 0);
    return cv.toDataURL('image/png');
  }
}
