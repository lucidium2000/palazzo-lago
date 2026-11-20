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
