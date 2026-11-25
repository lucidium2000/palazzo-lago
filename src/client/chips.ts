import * as THREE from 'three';
import { chipBreakdown, chipEdge, chipFace, CHIP_DENOMS, toTexture, type ChipDenom } from './textures';

/** Real casino chips: 39 mm across, 3.3 mm thick. */
export const CHIP_RADIUS = 0.0195;
export const CHIP_HEIGHT = 0.0033;

const geometry = new THREE.CylinderGeometry(CHIP_RADIUS, CHIP_RADIUS, CHIP_HEIGHT, 28, 1);
const materials = new Map<ChipDenom, THREE.Material[]>();

function chipMaterials(d: ChipDenom): THREE.Material[] {
  let m = materials.get(d);
  if (!m) {
    const face = new THREE.MeshStandardMaterial({ map: toTexture(chipFace(d)), roughness: 0.45, metalness: 0 });
    const edgeTex = toTexture(chipEdge(d));
    edgeTex.wrapS = THREE.RepeatWrapping;
    const edge = new THREE.MeshStandardMaterial({ map: edgeTex, roughness: 0.5 });
    // Cylinder groups: 0 side, 1 top, 2 bottom.
    m = [edge, face, face];
    materials.set(d, m);
  }
  return m;
}

export function makeChip(d: ChipDenom): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, chipMaterials(d));
  mesh.rotation.y = Math.random() * Math.PI * 2;
  // Chips are decoration: clicks pass through them to the felt underneath.
  mesh.raycast = () => {};
  return mesh;
}

/** A stack of chips totalling `amount`, bottom at y = 0. Slightly messy, like a real stack. */
export function makeChipStack(amount: number): THREE.Group {
  const g = new THREE.Group();
  chipBreakdown(amount).forEach((d, i) => {
    const chip = makeChip(d);
    chip.position.set((Math.random() - 0.5) * 0.0016, CHIP_HEIGHT * (i + 0.5), (Math.random() - 0.5) * 0.0016);
    g.add(chip);
  });
  g.userData.amount = amount;
  return g;
}

/** Warms the material cache so the first bet doesn't stutter. */
export function preloadChips() {
  for (const d of CHIP_DENOMS) chipMaterials(d);
}

let chipMaterial: THREE.MeshStandardMaterial | null = null;

/**
 * Chip face: an inlay ring and six edge spots in white over the chip's colour
 * (the instance colour). The cylinder's sides sample a slice through the same
 * picture, which reads as the stripes round a chip's edge.
 */
export function chipMat(): THREE.MeshStandardMaterial {
  if (chipMaterial) return chipMaterial;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#fff';
  for (let k = 0; k < 6; k++) {
    g.beginPath();
    g.moveTo(32, 32);
    g.arc(32, 32, 32, (k / 6) * Math.PI * 2 - 0.2, (k / 6) * Math.PI * 2 + 0.2);
    g.closePath();
    g.fill();
  }
  g.fillStyle = '#000';
  g.beginPath();
  g.arc(32, 32, 21, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#fff';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(32, 32, 17, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.45 });
  // The texture is a mask: white where the chip shows its white inlay, else the chip's colour.
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_fragment>', 'float chipMask = texture2D( map, vMapUv ).r;')
      .replace('#include <color_fragment>', '#ifdef USE_COLOR\n diffuseColor.rgb *= mix( vColor.rgb, vec3( 0.95 ), chipMask );\n#endif');
  };
  m.customProgramCacheKey = () => 'bjChips';
  return (chipMaterial = m);
}
