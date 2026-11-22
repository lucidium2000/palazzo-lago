import * as THREE from 'three';

/**
 * Small real-cabinet details shared by every slot machine: the two-tier
 * "candle" tower light on top, the bill validator with its lit bezel, the
 * TITO ticket printer and the player's-club card reader with its display.
 *
 * All glowing bits use one unlit material that samples a tiny palette texture
 * (bakeStatic keeps UVs but drops vertex colours), so each cabinet gains a
 * single draw call for every light, plus the dark parts that merge into the
 * cabinet's existing black material.
 */

export const GLOW = {
  red: 0,
  blue: 1,
  green: 2,
  pink: 3,
  white: 4,
  bezel: 5,
  display: 6,
  amber: 7,
} as const;
const PALETTE = ['#ff4040', '#4ab0ff', '#5aff9a', '#ff7ab8', '#fff8ec', '#38ff70', '#3aa0ff', '#ffb030'];

let glowMat: THREE.MeshBasicMaterial | null = null;
let chromeMat: THREE.MeshStandardMaterial | null = null;

function material(): THREE.MeshBasicMaterial {
  if (glowMat) return glowMat;
  const c = document.createElement('canvas');
  c.width = PALETTE.length * 4;
  c.height = 4;
  const ctx = c.getContext('2d')!;
  PALETTE.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.fillRect(i * 4, 0, 4, 4);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  glowMat = new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
  return glowMat;
}

function chrome(): THREE.MeshStandardMaterial {
  return (chromeMat ??= new THREE.MeshStandardMaterial({ color: 0xc8c8cc, metalness: 1, roughness: 0.22, envMapIntensity: 1.3 }));
}

/** A geometry whose every UV samples one palette colour. */
function tint<T extends THREE.BufferGeometry>(geo: T, color: number): T {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const u = (color + 0.5) / PALETTE.length;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, 0.5);
  uv.needsUpdate = true;
  return geo;
}

function mesh(g: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

export interface DetailOpts {
  /** Top of the cabinet (where the candle stands), and its z. */
  topY: number;
  topZ: number;
  /** Front face of the lower body (z) and the height band to use. */
  frontZ: number;
  panelY: number;
  /** Half the cabinet width, to place things near the edges. */
  halfW: number;
  candle: number;
  dark: THREE.Material;
}

export function addCabinetDetails(g: THREE.Group, o: DetailOpts) {
  const glow = material();
  const dark = o.dark;
  const metal = chrome();

  // Candle: chrome post, lower tier in the machine's colour, white tier above, chrome cap.
  mesh(g, new THREE.CylinderGeometry(0.012, 0.012, 0.06, 10), metal, 0, o.topY + 0.03, o.topZ);
  mesh(g, tint(new THREE.CylinderGeometry(0.035, 0.035, 0.09, 16), o.candle), glow, 0, o.topY + 0.105, o.topZ);
  mesh(g, new THREE.CylinderGeometry(0.038, 0.038, 0.008, 16), metal, 0, o.topY + 0.153, o.topZ);
  mesh(g, tint(new THREE.CylinderGeometry(0.035, 0.035, 0.07, 16), GLOW.white), glow, 0, o.topY + 0.192, o.topZ);
  mesh(g, new THREE.SphereGeometry(0.037, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), metal, 0, o.topY + 0.227, o.topZ);

  const x = o.halfW - 0.13;
  const z = o.frontZ;
  // Bill validator: dark housing, glowing green bezel ring, black note slot.
  const by = o.panelY;
  mesh(g, new THREE.BoxGeometry(0.12, 0.13, 0.03), dark, x, by, z + 0.015);
  mesh(g, tint(new THREE.BoxGeometry(0.1, 0.035, 0.006), GLOW.bezel), glow, x, by + 0.025, z + 0.031);
  mesh(g, new THREE.BoxGeometry(0.085, 0.01, 0.008), dark, x, by + 0.025, z + 0.033);
  mesh(g, new THREE.BoxGeometry(0.06, 0.03, 0.006), metal, x, by - 0.035, z + 0.031);

  // TITO ticket printer: chrome bezel with a dark ticket slot, small amber status light.
  const px = -x;
  mesh(g, new THREE.BoxGeometry(0.12, 0.06, 0.02), metal, px, by + 0.02, z + 0.01);
  mesh(g, new THREE.BoxGeometry(0.09, 0.008, 0.008), dark, px, by + 0.02, z + 0.021);
  mesh(g, tint(new THREE.CylinderGeometry(0.005, 0.005, 0.006, 8).rotateX(Math.PI / 2), GLOW.amber), glow, px + 0.045, by + 0.04, z + 0.021);

  // Player's-club card reader with a two-line display.
  const ry = by - 0.13;
  mesh(g, new THREE.BoxGeometry(0.13, 0.08, 0.025), dark, x, ry, z + 0.0125);
  mesh(g, tint(new THREE.BoxGeometry(0.09, 0.03, 0.004), GLOW.display), glow, x, ry + 0.014, z + 0.026);
  mesh(g, new THREE.BoxGeometry(0.07, 0.006, 0.008), metal, x, ry - 0.022, z + 0.026);
}
