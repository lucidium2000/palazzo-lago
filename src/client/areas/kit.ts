import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { assets } from '../assets';
import type { Quality } from '../quality';
import { canvas, damask, marble, radial, toTexture } from '../textures';

/**
 * Shared building kit for the areas beyond the casino floor: a geometry
 * batcher (one draw per material), common materials, and helpers for boxes,
 * floors, walls and glows.
 */

export class Batch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(geo: THREE.BufferGeometry, mat: THREE.Material, m?: THREE.Matrix4) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()) as THREE.BufferGeometry;
    if (m) g.applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    let l = this.parts.get(mat);
    if (!l) this.parts.set(mat, (l = []));
    l.push(g);
  }

  /** A box from its centre and size (optional yaw). */
  box(mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    // World-scaled UVs so tiling textures keep their size on every face.
    scaleBoxUv(g, sx, sy, sz);
    this.add(g, mat, M(x, y, z, yaw));
  }

  build(parent: THREE.Object3D, name = 'area'): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    for (const [mat, list] of this.parts) {
      const geo = mergeGeometries(list);
      list.forEach((x) => x.dispose());
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = false;
      g.add(mesh);
    }
    parent.add(g);
    this.parts.clear();
    return g;
  }
}

export const M = (x = 0, y = 0, z = 0, ry = 0, s = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(s, s, s));

/** Box UVs in metres (one texture repeat per metre, scaled by the material's repeat). */
function scaleBoxUv(g: THREE.BoxGeometry, sx: number, sy: number, sz: number) {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // Face order: +x, -x, +y, -y, +z, -z; 4 verts each.
  const dims: [number, number][] = [
    [sz, sy],
    [sz, sy],
    [sx, sz],
    [sx, sz],
    [sx, sy],
    [sx, sy],
  ];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
  }
}

/** A horizontal floor/ceiling plane with metre UVs. `up` false faces down (ceilings). */
export function plane(w: number, d: number, uvScale = 1, up = true): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * uvScale, uv.getY(i) * d * uvScale);
  g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
  return g;
}

/** A vertical wall quad (normal toward +z before yaw) with metre UVs. */
export function wallQuad(w: number, h: number, uvScale = 1): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * uvScale, uv.getY(i) * h * uvScale);
  return g;
}

export interface Mats {
  silk: THREE.Material;
  marbleWall: THREE.Material;
  marble: THREE.MeshStandardMaterial;
  darkMarble: THREE.MeshStandardMaterial;
  walnut: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  cream: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  glowWarm: THREE.MeshBasicMaterial;
  glow: (color: number, k?: number) => THREE.MeshBasicMaterial;
  halo: THREE.MeshBasicMaterial;
}

let cached: Mats | null = null;

export function mats(q: Quality): Mats {
  if (cached) return cached;
  const marbleTex = toTexture(marble(q.texSize >= 2048 ? 1024 : 512, 'cream', 21));
  marbleTex.wrapS = marbleTex.wrapT = THREE.RepeatWrapping;
  const darkTex = toTexture(marble(512, 'dark', 7));
  darkTex.wrapS = darkTex.wrapT = THREE.RepeatWrapping;
  const wallTex = toTexture(damask(1024));
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
  wallTex.repeat.set(1 / 1.6, 1 / 1.6);
  const stoneTex = toTexture(stone(512));
  stoneTex.wrapS = stoneTex.wrapT = THREE.RepeatWrapping;
  stoneTex.repeat.set(0.5, 0.5);
  const glows = new Map<string, THREE.MeshBasicMaterial>();
  cached = {
    marble: assets.material('marble', { repeat: 0.35, rough: 0.35, normal: 0.3, envIntensity: 1.1, fallback: () => new THREE.MeshStandardMaterial({ map: marbleTex, roughness: 0.25 }) }),
    darkMarble: assets.material('darkmarble', { repeat: 0.5, rough: 0.4, tint: 0x9a7a6a, fallback: () => new THREE.MeshStandardMaterial({ map: darkTex, roughness: 0.25 }) }),
    walnut: assets.material('walnut', { repeat: 0.6, rough: 0.55, fallback: () => new THREE.MeshStandardMaterial({ color: 0x4a2414, roughness: 0.45 }) }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 1, roughness: 0.28, envMapIntensity: 1.4 }),
    wall: new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.65, emissive: 0x2a1c0e, emissiveIntensity: 0.35 }),
    silk: (() => {
      const t = toTexture(silkWall(512));
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(1 / 1.2, 1 / 1.2);
      return new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.55, sheen: 0.7, sheenRoughness: 0.4, sheenColor: new THREE.Color(0xfff0d8), emissive: 0x24180c, emissiveIntensity: 0.3 });
    })(),
    marbleWall: assets.material('marble', { repeat: 0.5, rough: 0.3, normal: 0.3, envIntensity: 1.2, fallback: () => new THREE.MeshStandardMaterial({ map: marbleTex, roughness: 0.2 }) }),
    cream: new THREE.MeshStandardMaterial({ color: 0xece0c4, roughness: 0.6, emissive: 0x3a2814, emissiveIntensity: 0.3 }),
    stone: new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.8, emissive: 0x2a1e12, emissiveIntensity: 0.25 }),
    glowWarm: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd9a0).multiplyScalar(1.6) }),
    glow(color: number, k = 1.6) {
      const key = `${color}:${k}`;
      let m = glows.get(key);
      if (!m) glows.set(key, (m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) })));
      return m;
    },
    halo: new THREE.MeshBasicMaterial({ map: toTexture(radial(128, 'rgba(255,210,140,0.6)', 'rgba(255,170,90,0)')), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  };
  return cached;
}

/** Plain champagne silk wall covering with a fine slub (suites, quieter rooms). */
function silkWall(size: number): HTMLCanvasElement {
  const [c, g] = canvas(size);
  g.fillStyle = '#d8c3a0';
  g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  let s = 5;
  for (let y = 0; y < size; y++) {
    s = (s * 16807) % 2147483647;
    const row = 0.95 + (s / 2147483647) * 0.08;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const f = row * (0.985 + 0.015 * Math.sin(x * 0.9));
      img.data[i] *= f;
      img.data[i + 1] *= f;
      img.data[i + 2] *= f;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Warm limestone blocks for the building exteriors. */
function stone(size: number): HTMLCanvasElement {
  const [c, g] = canvas(size);
  g.fillStyle = '#c9b48e';
  g.fillRect(0, 0, size, size);
  const rows = 4;
  const h = size / rows;
  let s = 3;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (size / 4);
    for (let k = -1; k < 3; k++) {
      const x = off + k * (size / 2);
      const t = 0.9 + rnd() * 0.15;
      g.fillStyle = `rgb(${201 * t},${180 * t},${142 * t})`;
      g.fillRect(x + 3, r * h + 3, size / 2 - 6, h - 6);
    }
  }
  return c;
}

/** Floating soft glow (additive quad facing +z before rotation). */
export function haloQuad(m: Mats, size: number) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m.halo);
  mesh.raycast = () => {};
  return mesh;
}

/** A night sky with stars and a warm city glow on the horizon (one draw). */
export function nightSky(radius: number): THREE.Mesh {
  const [c, g] = canvas(1024, 512);
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#04050d');
  grd.addColorStop(0.55, '#0b1028');
  grd.addColorStop(0.78, '#2a1a3a');
  grd.addColorStop(1, '#5a3424');
  g.fillStyle = grd;
  g.fillRect(0, 0, 1024, 512);
  let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 700; i++) {
    const y = rnd() * 360;
    g.fillStyle = `rgba(255,255,255,${0.3 + rnd() * 0.7 * (1 - y / 400)})`;
    g.fillRect(rnd() * 1024, y, rnd() < 0.1 ? 2 : 1, rnd() < 0.1 ? 2 : 1);
  }
  const t = toTexture(c);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, depthWrite: false, fog: false }));
  mesh.raycast = () => {};
  mesh.renderOrder = -10;
  return mesh;
}
