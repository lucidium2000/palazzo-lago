import * as THREE from 'three';
import { canvas, toTexture } from './textures';
import type { Quality } from './quality';

/**
 * Bellagio-style architecture (original design in that spirit):
 *  - vaulted ceiling bays painted cream with gilded scrollwork, each lit from a
 *    hidden cove so the vault glows, with gilded beams and rosettes between;
 *  - silk pavilion canopies over the table games with scalloped, fringed
 *    valances (Roger Thomas famously hung fabric and chandeliers over tables);
 *  - marble pilasters with gilded capitals and glowing wall sconces.
 */

export interface HallSpec {
  w: number;
  d: number;
  h: number;
  rotunda: { x: number; z: number; r: number };
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

/** Cream plaster with gilded acanthus scrolls, painted for a vault. */
export function scrollwork(size: number): HTMLCanvasElement {
  const [c, g] = canvas(size);
  const bg = g.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.75);
  bg.addColorStop(0, '#f3e6cb');
  bg.addColorStop(1, '#e2cca2');
  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);
  const gold = (a: number) => `rgba(${196 + a * 30},${150 + a * 30},${70 + a * 20},${0.85})`;
  g.lineCap = 'round';
  // A scroll: spiral that unfurls along a stem with leaf curls.
  const scroll = (x: number, y: number, r: number, rot: number, flip: number) => {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.scale(flip, 1);
    g.strokeStyle = gold(0.3);
    g.lineWidth = r * 0.09;
    g.beginPath();
    for (let t = 0; t < 4.2 * Math.PI; t += 0.08) {
      const rr = r * (1 - t / (4.6 * Math.PI));
      const px = Math.cos(t) * rr,
        py = Math.sin(t) * rr;
      if (t === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
    // Leaves on the outer curl.
    g.fillStyle = gold(0.6);
    for (let k = 0; k < 5; k++) {
      const a = -0.4 + k * 0.55;
      g.save();
      g.translate(Math.cos(a) * r * 1.05, Math.sin(a) * r * 1.05);
      g.rotate(a + 1.2);
      g.beginPath();
      g.ellipse(0, 0, r * 0.32, r * 0.1, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    g.restore();
  };
  const s = size;
  // Central rosette medallion.
  g.save();
  g.translate(s / 2, s / 2);
  for (let k = 0; k < 16; k++) {
    g.rotate(Math.PI / 8);
    g.fillStyle = k % 2 ? gold(0.7) : gold(0.2);
    g.beginPath();
    g.ellipse(s * 0.07, 0, s * 0.07, s * 0.018, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.beginPath();
  g.arc(0, 0, s * 0.03, 0, Math.PI * 2);
  g.fillStyle = gold(1);
  g.fill();
  g.strokeStyle = gold(0.4);
  g.lineWidth = s * 0.006;
  for (const r of [0.17, 0.19]) {
    g.beginPath();
    g.arc(0, 0, s * r, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();
  // Scrolls radiating in four pairs, plus corner fans.
  for (let q = 0; q < 4; q++) {
    const a = (q * Math.PI) / 2;
    const cx = s / 2 + Math.cos(a) * s * 0.3,
      cy = s / 2 + Math.sin(a) * s * 0.3;
    scroll(cx + Math.cos(a + Math.PI / 2) * s * 0.06, cy + Math.sin(a + Math.PI / 2) * s * 0.06, s * 0.07, a, 1);
    scroll(cx - Math.cos(a + Math.PI / 2) * s * 0.06, cy - Math.sin(a + Math.PI / 2) * s * 0.06, s * 0.07, a, -1);
  }
  for (const [x, y] of [[0, 0], [s, 0], [0, s], [s, s]]) {
    g.save();
    g.translate(x, y);
    for (let k = 0; k < 9; k++) {
      g.rotate(Math.PI / 16);
      g.strokeStyle = gold(0.2);
      g.lineWidth = s * 0.008;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(s * 0.16, 0);
      g.stroke();
    }
    g.restore();
  }
  // Gilded border bands.
  g.strokeStyle = gold(0.5);
  g.lineWidth = s * 0.012;
  g.strokeRect(s * 0.06, s * 0.06, s * 0.88, s * 0.88);
  g.lineWidth = s * 0.004;
  g.strokeRect(s * 0.085, s * 0.085, s * 0.83, s * 0.83);
  return c;
}

/** Light from a hidden cove: bright at the vault's edge, fading toward the crown. */
function coveGlow(size: number): HTMLCanvasElement {
  const [c, g] = canvas(size);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = Math.abs(x / size - 0.5) * 2,
        v = Math.abs(y / size - 0.5) * 2;
      const e = Math.max(u, v);
      const k = Math.pow(Math.max(0, (e - 0.55) / 0.45), 2.2) * 0.95 + 0.1;
      const i = (y * size + x) * 4;
      img.data[i] = 255 * k;
      img.data[i + 1] = 205 * k;
      img.data[i + 2] = 140 * k;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Silk for the canopies: alternating jewel-toned panels radiating from the peak. */
function silk(size: number, colors: [string, string], panels: number): HTMLCanvasElement {
  const [c, g] = canvas(size);
  const cx = size / 2;
  for (let k = 0; k < panels; k++) {
    const a0 = (k / panels) * Math.PI * 2,
      a1 = ((k + 1) / panels) * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx, cx);
    g.arc(cx, cx, size, a0, a1);
    g.closePath();
    const grd = g.createLinearGradient(cx + Math.cos(a0) * size * 0.4, cx + Math.sin(a0) * size * 0.4, cx + Math.cos(a1) * size * 0.4, cx + Math.sin(a1) * size * 0.4);
    const col = colors[k % 2];
    grd.addColorStop(0, col);
    grd.addColorStop(0.5, shade(col, 1.18));
    grd.addColorStop(1, col);
    g.fillStyle = grd;
    g.fill();
  }
  // Gold piping along the seams.
  g.strokeStyle = 'rgba(232,190,100,0.9)';
  g.lineWidth = size * 0.006;
  for (let k = 0; k < panels; k++) {
    const a = (k / panels) * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx, cx);
    g.lineTo(cx + Math.cos(a) * size, cx + Math.sin(a) * size);
    g.stroke();
  }
  // Fine silk weave.
  const img = g.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const f = 0.94 + 0.06 * Math.sin(x * 1.7) * Math.sin(y * 1.3);
      img.data[i] *= f;
      img.data[i + 1] *= f;
      img.data[i + 2] *= f;
    }
  g.putImageData(img, 0, 0);
  return c;
}

/** The valance strip: silk with a gilded braid and a fringe at the scalloped edge. */
function valanceTex(color: string): HTMLCanvasElement {
  const [c, g] = canvas(512, 128);
  g.fillStyle = color;
  g.fillRect(0, 0, 512, 128);
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, 'rgba(0,0,0,0.25)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.08)');
  grd.addColorStop(1, 'rgba(0,0,0,0.2)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#d9a94e';
  g.fillRect(0, 8, 512, 10);
  g.fillRect(0, 96, 512, 6);
  g.fillStyle = '#f0cf7a';
  for (let x = 0; x < 512; x += 4) g.fillRect(x, 104, 2, 24);
  return c;
}

function shade(hex: string, k: number) {
  const c = new THREE.Color(hex).multiplyScalar(k);
  return '#' + c.getHexString();
}

// ---------------------------------------------------------------------------
// Ceiling
// ---------------------------------------------------------------------------

/**
 * Vaulted bays on a grid, gilded beams between them, and a flat ceiling with a
 * round opening where the rotunda's dome rises.
 */
export function buildCeiling(spec: HallSpec, q: Quality, gold: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const { w: W, d: D, h: H, rotunda } = spec;
  const xs = [-18, -12, -6, 0, 6, 12, 18].map((x) => (x * W) / 36);
  const zs = [-14, -7, 0, 7, 14].map((z) => (z * D) / 28);
  const scrollTex = toTexture(scrollwork(q.texSize >= 2048 ? 1024 : 512));
  scrollTex.anisotropy = 4;
  const glowTex = toTexture(coveGlow(256));
  const vaultMat = new THREE.MeshStandardMaterial({
    map: scrollTex,
    roughness: 0.55,
    metalness: 0.0,
    emissive: 0xffffff,
    emissiveMap: glowTex,
    emissiveIntensity: 0.4,
    side: THREE.BackSide,
  });
  const beamMat = new THREE.MeshStandardMaterial({ color: 0xecdcbb, roughness: 0.6 });
  const cove = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd29a).multiplyScalar(2.2) });
  const flatTex = scrollTex.clone();
  flatTex.wrapS = flatTex.wrapT = THREE.RepeatWrapping;
  flatTex.repeat.set(W / 6, D / 7);
  flatTex.needsUpdate = true;
  const flatMat = new THREE.MeshStandardMaterial({ map: flatTex, roughness: 0.6, emissive: 0x3a2814, emissiveIntensity: 0.5 });

  const nearRotunda = (x0: number, x1: number, z0: number, z1: number) => {
    const cx = THREE.MathUtils.clamp(rotunda.x, x0, x1),
      cz = THREE.MathUtils.clamp(rotunda.z, z0, z1);
    return Math.hypot(cx - rotunda.x, cz - rotunda.z) < rotunda.r + 0.9;
  };

  const vaultGeos: THREE.BufferGeometry[] = [];
  const beamGeos: THREE.BufferGeometry[] = [];
  const goldGeos: THREE.BufferGeometry[] = [];
  const coveGeos: THREE.BufferGeometry[] = [];
  const flatShapes: THREE.Shape[] = [];
  const BEAM = 0.55,
    DROP = 0.6,
    RISE = 1.0;
  const boxAt = (list: THREE.BufferGeometry[], x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const b = new THREE.BoxGeometry(sx, sy, sz);
    b.translate(x, y, z);
    list.push(b);
  };

  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      const x0 = xs[i],
        x1 = xs[i + 1],
        z0 = zs[j],
        z1 = zs[j + 1];
      const cx = (x0 + x1) / 2,
        cz = (z0 + z1) / 2;
      const bw = x1 - x0 - BEAM,
        bd = z1 - z0 - BEAM;
      if (nearRotunda(x0, x1, z0, z1)) {
        // Flat ceiling here, with the rotunda's round opening cut out.
        const s = new THREE.Shape();
        s.moveTo(x0, z0);
        s.lineTo(x1, z0);
        s.lineTo(x1, z1);
        s.lineTo(x0, z1);
        s.closePath();
        flatShapes.push(s);
        continue;
      }
      // A pillow vault: rises from the beam tops to the crown.
      const v = new THREE.PlaneGeometry(bw, bd, 18, 18);
      const pos = v.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < pos.count; k++) {
        const u = (pos.getX(k) / bw) * 2,
          w2 = (pos.getY(k) / bd) * 2;
        const e = (1 - u * u) * (1 - w2 * w2);
        pos.setZ(k, RISE * Math.pow(Math.max(0, e), 0.55));
      }
      v.rotateX(-Math.PI / 2);
      v.computeVertexNormals();
      v.translate(cx, H, cz);
      vaultGeos.push(v);
      // Cove light strips hidden on the beam tops, facing into the vault.
      boxAt(coveGeos, cx, H + 0.02, z0 + BEAM / 2 + 0.02, bw, 0.03, 0.04);
      boxAt(coveGeos, cx, H + 0.02, z1 - BEAM / 2 - 0.02, bw, 0.03, 0.04);
      boxAt(coveGeos, x0 + BEAM / 2 + 0.02, H + 0.02, cz, 0.04, 0.03, bd);
      boxAt(coveGeos, x1 - BEAM / 2 - 0.02, H + 0.02, cz, 0.04, 0.03, bd);
    }
  }
  // Beams along every grid line, skipping the rotunda.
  const beam = (x0: number, z0: number, x1: number, z1: number) => {
    const mx = (x0 + x1) / 2,
      mz = (z0 + z1) / 2;
    if (Math.hypot(mx - rotunda.x, mz - rotunda.z) < rotunda.r + 1.0) return;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const sx = alongX ? len : BEAM,
      sz = alongX ? BEAM : len;
    boxAt(beamGeos, mx, H - DROP / 2 + 0.05, mz, sx, DROP + 0.1, sz);
    // Gilded fillets along both lower edges, and an egg-and-dart band.
    const o = BEAM / 2 + 0.01;
    for (const s of [-1, 1]) {
      boxAt(goldGeos, mx + (alongX ? 0 : s * o), H - DROP + 0.04, mz + (alongX ? s * o : 0), alongX ? len : 0.035, 0.05, alongX ? 0.035 : len);
      boxAt(goldGeos, mx + (alongX ? 0 : s * o), H - 0.12, mz + (alongX ? s * o : 0), alongX ? len : 0.03, 0.03, alongX ? 0.03 : len);
    }
    boxAt(goldGeos, mx, H - DROP - 0.005, mz, alongX ? len : 0.12, 0.012, alongX ? 0.12 : len);
  };
  for (const x of xs) for (let j = 0; j < zs.length - 1; j++) beam(x, zs[j], x, zs[j + 1]);
  for (const z of zs) for (let i = 0; i < xs.length - 1; i++) beam(xs[i], z, xs[i + 1], z);
  // Rosettes where beams cross.
  const ros = new THREE.CylinderGeometry(0.22, 0.26, 0.08, 20);
  for (const x of xs)
    for (const z of zs) {
      if (Math.hypot(x - rotunda.x, z - rotunda.z) < rotunda.r + 1.0) continue;
      if (Math.abs(x) >= W / 2 - 0.01 || Math.abs(z) >= D / 2 - 0.01) continue;
      const r = ros.clone();
      r.translate(x, H - DROP - 0.04, z);
      goldGeos.push(r);
    }

  const merge = (list: THREE.BufferGeometry[], mat: THREE.Material) => {
    if (!list.length) return;
    const geo = mergeAll(list);
    const m = new THREE.Mesh(geo, mat);
    m.name = 'ceiling';
    g.add(m);
  };
  merge(vaultGeos, vaultMat);
  merge(beamGeos, beamMat);
  merge(goldGeos, gold);
  merge(coveGeos, cove);
  // Flat panels with the rotunda hole.
  if (flatShapes.length) {
    const hole = new THREE.Path();
    hole.absarc(rotunda.x, rotunda.z, rotunda.r + 0.6, 0, Math.PI * 2, true);
    const geos = flatShapes.map((s) => {
      // Only the shapes that actually contain the circle get the hole; clip others is unnecessary
      // because the circle spans the middle bays: put the hole in a single union rectangle instead.
      return s;
    });
    void geos;
    // Union of the flat bays as one rectangle (they form a block around the rotunda).
    let x0 = Infinity,
      x1 = -Infinity,
      z0 = Infinity,
      z1 = -Infinity;
    for (const s of flatShapes)
      for (const p of s.getPoints()) {
        x0 = Math.min(x0, p.x);
        x1 = Math.max(x1, p.x);
        z0 = Math.min(z0, p.y);
        z1 = Math.max(z1, p.y);
      }
    const u = new THREE.Shape();
    u.moveTo(x0, z0);
    u.lineTo(x1, z0);
    u.lineTo(x1, z1);
    u.lineTo(x0, z1);
    u.closePath();
    u.holes.push(hole);
    const geo = new THREE.ShapeGeometry(u, 48);
    // Shape is in x/y; lay it in x/z facing down at the ceiling height.
    geo.rotateX(Math.PI / 2);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) / 6, uv.getY(k) / 7);
    geo.translate(0, H + 0.02, 0);
    const flat = new THREE.Mesh(geo, flatMat);
    flat.name = 'ceiling-flat';
    g.add(flat);
  }
  return g;
}

function mergeAll(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const norm = list.map((g0) => {
    const g1 = g0.index ? g0.toNonIndexed() : g0;
    for (const k of Object.keys(g1.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g1.deleteAttribute(k);
    return g1;
  });
  // Lightweight merge (avoids importing BufferGeometryUtils here).
  let n = 0;
  for (const g1 of norm) n += g1.attributes.position.count;
  const pos = new Float32Array(n * 3),
    nor = new Float32Array(n * 3),
    uv = new Float32Array(n * 2);
  let o = 0;
  for (const g1 of norm) {
    pos.set(g1.attributes.position.array as Float32Array, o * 3);
    nor.set(g1.attributes.normal.array as Float32Array, o * 3);
    if (g1.attributes.uv) uv.set(g1.attributes.uv.array as Float32Array, o * 2);
    o += g1.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

// ---------------------------------------------------------------------------
// Canopies over the table games
// ---------------------------------------------------------------------------

export interface CanopySpec {
  x: number;
  z: number;
  w: number;
  d: number;
  /** Height of the valance top and of the peak. */
  edge: number;
  peak: number;
  colors: [string, string];
}

export function buildCanopy(c: CanopySpec, q: Quality): THREE.Group {
  const g = new THREE.Group();
  g.position.set(c.x, 0, c.z);
  const tex = toTexture(silk(q.texSize >= 2048 ? 1024 : 512, c.colors, 16));
  tex.anisotropy = 4;
  const mat = new THREE.MeshPhysicalMaterial({
    map: tex,
    roughness: 0.55,
    sheen: 1,
    sheenRoughness: 0.35,
    sheenColor: new THREE.Color(0xffe0b0),
    side: THREE.DoubleSide,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: 0.22,
  });
  // A pavilion: four sloping roof panels billowing between gilded ribs.
  const roof = new THREE.PlaneGeometry(c.w, c.d, 32, 32);
  const pos = roof.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) {
    const u = (pos.getX(k) / c.w) * 2,
      v = (pos.getY(k) / c.d) * 2;
    const e = Math.max(Math.abs(u), Math.abs(v));
    // Straight slope to the peak, with fabric sagging between the ribs.
    const ribDist = Math.min(Math.abs(Math.abs(u) - Math.abs(v)), 1);
    const sag = Math.sin(Math.PI * Math.min(1, e)) * 0.22 * Math.min(1, ribDist * 3);
    pos.setZ(k, (1 - e) * (c.peak - c.edge) - sag);
  }
  roof.computeVertexNormals();
  roof.rotateX(-Math.PI / 2);
  roof.translate(0, c.edge, 0);
  const roofMesh = new THREE.Mesh(roof, mat);
  g.add(roofMesh);

  // Scalloped valance hanging from the edge, all four sides.
  const vtex = toTexture(valanceTex(c.colors[0]));
  vtex.wrapS = THREE.RepeatWrapping;
  const vmat = new THREE.MeshStandardMaterial({ map: vtex, roughness: 0.6, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: vtex, emissiveIntensity: 0.18 });
  const sides: [number, number, number, number][] = [
    [0, -c.d / 2, c.w, 0],
    [0, c.d / 2, c.w, Math.PI],
    [-c.w / 2, 0, c.d, Math.PI / 2],
    [c.w / 2, 0, c.d, -Math.PI / 2],
  ];
  const tassels: THREE.Vector3[] = [];
  for (const [x, z, len, ry] of sides) {
    const scallop = 0.55;
    const n = Math.max(2, Math.round(len / scallop));
    const geo = new THREE.PlaneGeometry(len, 0.55, n * 8, 1);
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      if (p.getY(k) < 0) {
        const t = ((p.getX(k) + len / 2) / len) * n;
        p.setY(k, -0.275 - Math.abs(Math.sin(Math.PI * t)) * 0.16);
      }
    }
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * (len / 1.2));
    const m = new THREE.Mesh(geo, vmat);
    m.position.set(x, c.edge - 0.27, z);
    m.rotation.y = ry;
    g.add(m);
    const dir = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    for (let k = 0; k <= n; k++) {
      const off = -len / 2 + (k / n) * len;
      tassels.push(new THREE.Vector3(x + dir.x * off, c.edge - 0.58, z + dir.z * off));
    }
  }
  // Gilded ribs from the corners to the peak, and a crown finial.
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 1, roughness: 0.3 });
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const a = new THREE.Vector3((sx * c.w) / 2, c.edge, (sz * c.d) / 2);
    const b = new THREE.Vector3(0, c.peak, 0);
    const rib = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 1, 0.035, 8), goldMat);
    g.add(rib);
  }
  const frame = new THREE.Mesh(new THREE.TorusGeometry(1, 0.045, 8, 4, Math.PI * 2), goldMat);
  frame.rotation.set(Math.PI / 2, 0, Math.PI / 4);
  frame.scale.set((c.w / 2) * Math.SQRT2, (c.d / 2) * Math.SQRT2, 1);
  frame.position.y = c.edge;
  g.add(frame);
  // Tassels.
  const tasselGeo = new THREE.ConeGeometry(0.035, 0.14, 8);
  tasselGeo.rotateX(Math.PI);
  const ts = new THREE.InstancedMesh(tasselGeo, goldMat, tassels.length);
  const tmp = new THREE.Object3D();
  tassels.forEach((p, i) => {
    tmp.position.copy(p);
    tmp.updateMatrix();
    ts.setMatrixAt(i, tmp.matrix);
  });
  g.add(ts);
  return g;
}

// ---------------------------------------------------------------------------
// Walls: pilasters and sconces
// ---------------------------------------------------------------------------

export function buildPilasters(
  runs: { from: [number, number]; to: [number, number]; inward: [number, number]; every: number; skip?: (x: number, z: number) => boolean }[],
  h: number,
  mats: { marble: THREE.Material; gold: THREE.Material },
): THREE.Group {
  const g = new THREE.Group();
  const lists = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const add = (mat: THREE.Material, geo: THREE.BufferGeometry) => {
    let l = lists.get(mat);
    if (!l) lists.set(mat, (l = []));
    l.push(geo);
  };
  const shadeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe2b0).multiplyScalar(1.8) });
  const glowTex = toTexture(radialGlow());
  const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  for (const r of runs) {
    const [ax, az] = r.from,
      [bx, bz] = r.to;
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.floor(len / r.every);
    const ry = Math.atan2(-(r.inward[0]), -(r.inward[1])) + Math.PI;
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const x = ax + (bx - ax) * t + r.inward[0] * 0.08,
        z = az + (bz - az) * t + r.inward[1] * 0.08;
      if (r.skip?.(x, z)) continue;
      const put = (mat: THREE.Material, geo: THREE.BufferGeometry, y: number, off = 0) => {
        geo.rotateY(ry);
        geo.translate(x + r.inward[0] * off, y, z + r.inward[1] * off);
        add(mat, geo);
      };
      put(mats.marble, new THREE.BoxGeometry(0.5, h - 1.6, 0.14), 1.2 + (h - 1.6) / 2);
      put(mats.gold, new THREE.BoxGeometry(0.62, 0.2, 0.2), 1.2);
      put(mats.gold, new THREE.BoxGeometry(0.66, 0.26, 0.22), h - 0.52);
      put(mats.gold, new THREE.BoxGeometry(0.54, 0.06, 0.18), h - 0.72);
      // Sconce halfway to the next pilaster.
      const t2 = (k + 0.5) / n;
      if (k < n - 0 && t2 < 1) {
        const sx = ax + (bx - ax) * t2 + r.inward[0] * 0.1,
          sz = az + (bz - az) * t2 + r.inward[1] * 0.1;
        if (r.skip?.(sx, sz)) continue;
        const sc = (mat: THREE.Material, geo: THREE.BufferGeometry, y: number, off: number) => {
          geo.rotateY(ry);
          geo.translate(sx + r.inward[0] * off, y, sz + r.inward[1] * off);
          add(mat, geo);
        };
        sc(mats.gold, new THREE.BoxGeometry(0.16, 0.34, 0.03), 2.45, 0);
        sc(mats.gold, new THREE.CylinderGeometry(0.02, 0.02, 0.16, 6).rotateX(Math.PI / 2), 2.4, 0.08);
        sc(shadeMat, new THREE.CylinderGeometry(0.07, 0.11, 0.16, 16, 1, true), 2.52, 0.16);
        const glow = new THREE.PlaneGeometry(1.4, 1.6);
        sc(glowMat, glow, 2.5, 0.02);
      }
    }
  }
  for (const [mat, list] of lists) {
    const m = new THREE.Mesh(mergeAll(list), mat);
    m.name = 'pilasters';
    g.add(m);
  }
  return g;
}

function radialGlow(): HTMLCanvasElement {
  const [c, g] = canvas(128);
  const grd = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,214,150,0.55)');
  grd.addColorStop(0.4, 'rgba(255,180,100,0.18)');
  grd.addColorStop(1, 'rgba(255,160,80,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return c;
}
