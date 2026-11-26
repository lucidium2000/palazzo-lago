import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CULLED_LAYER, Culler } from '../src/client/cull';
import { resortCells } from '../src/client/resortcull';
import { batchSprites, bakeStatic } from '../src/client/merge';

const box = (x: number, y: number, z: number, s = 0.5, mat?: THREE.Material) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat ?? new THREE.MeshStandardMaterial());
  m.position.set(x, y, z);
  return m;
};
const culled = (o: THREE.Object3D) => o.layers.isEnabled(CULLED_LAYER) && !o.layers.isEnabled(0);

/** The real resort's cells, with a few things placed about it. */
function resort(cabOpen = 0) {
  const scene = new THREE.Scene();
  const cars = [{ landing: 'casino', x: 42, z: 4.75, open: cabOpen }];
  const { cells, portals } = resortCells(cars);
  const culler = new Culler(cells, portals, () => scene.children);
  const things = {
    // In line with the corridor (z 4.6–8.4), on the casino floor.
    slotInLine: box(9, 1.2, 6.5, 1.2),
    // Off to the side, behind the casino's east wall as seen from the lobby.
    tableAside: box(-8, 1, -7, 2),
    // In the poker room's far corner.
    pokerTable: box(-24.5, 0.8, -2.5, 0.8),
    lobbyFlowers: box(36, 1, 6, 1.5),
    poolChair: box(40, 0.4, -20, 1),
    suiteSofa: box(594, 0.4, 0, 1.5),
  };
  for (const o of Object.values(things)) scene.add(o);
  scene.updateMatrixWorld(true);
  return { scene, culler, things, cars };
}

describe('portal culling', () => {
  it('draws only what the corridor frames from the hotel lobby', () => {
    const { culler, things } = resort();
    culler.update(1, new THREE.Vector3(36, 1.65, 6.2));
    expect(culled(things.slotInLine)).toBe(false);
    expect(culled(things.lobbyFlowers)).toBe(false);
    expect(culled(things.tableAside)).toBe(true);
    expect(culled(things.pokerTable)).toBe(true);
    expect(culled(things.suiteSofa)).toBe(true);
    // The pool deck: out of the pool doors' frame from the middle of the lobby looking along it.
    expect(culler.sees(40, 0.5, -20, 1)).toBe(true);
    expect(culler.sees(60, 0.5, -2, 0.5)).toBe(false);
  });

  it('sees the whole floor from inside the casino, and not the deck', () => {
    const { culler, things } = resort();
    culler.update(1, new THREE.Vector3(0, 1.65, 7.5));
    expect(culled(things.slotInLine)).toBe(false);
    expect(culled(things.tableAside)).toBe(false);
    expect(culled(things.poolChair)).toBe(true);
    // The poker room only through its doorway (from here it frames the room's south side).
    expect(culler.sees(-22.3, 0.8, -1.8, 0.5)).toBe(true);
    expect(culler.sees(-25, 0.8, 3, 0.3)).toBe(false);
  });

  it('a closed lift cab hides everything outside; open doors frame the lobby', () => {
    const shut = resort(0);
    shut.culler.update(1, new THREE.Vector3(43.2, 1.65, 4.75));
    expect(culled(shut.things.lobbyFlowers)).toBe(true);
    expect(culled(shut.things.slotInLine)).toBe(true);
    const open = resort(1);
    open.culler.update(1, new THREE.Vector3(43.2, 1.65, 4.75));
    expect(culled(open.things.lobbyFlowers)).toBe(false);
    expect(culled(open.things.pokerTable)).toBe(true);
  });

  it('standing in a doorway shows the room beyond in full', () => {
    const { culler, things } = resort();
    culler.update(1, new THREE.Vector3(-17.9, 1.65, 0));
    expect(culled(things.pokerTable)).toBe(false);
    expect(culler.sees(-25, 0.8, 3, 0.3)).toBe(true);
  });

  it('skips tiny far detail but never what is close, and restores everything on clear()', () => {
    const { scene, culler } = resort();
    const chip = box(-10, 0.8, 7.5, 0.04);
    const nearChip = box(-1, 0.8, 7.5, 0.04);
    scene.add(chip, nearChip);
    scene.updateMatrixWorld(true);
    culler.rescan();
    culler.update(1, new THREE.Vector3(0, 1.65, 7.5));
    expect(culled(chip)).toBe(true);
    expect(culled(nearChip)).toBe(false);
    culler.clear();
    expect(chip.layers.mask).toBe(1);
  });

  it('a big mesh spanning cells is drawn from any cell it reaches into', () => {
    const { scene, culler } = resort();
    // A long wall run from the corridor into the lobby (centred in the lobby).
    const run = box(0, 0, 0, 1);
    run.geometry = new THREE.BoxGeometry(20, 4, 0.2);
    run.position.set(32, 2, 4.7);
    scene.add(run);
    scene.updateMatrixWorld(true);
    culler.rescan();
    culler.update(1, new THREE.Vector3(24, 1.65, 6.5));
    expect(culled(run)).toBe(false);
    // From a closed lift cab it's out of sight.
    culler.update(1, new THREE.Vector3(43.2, 1.65, 4.75));
    expect(culled(run)).toBe(true);
  });

  it('a raycaster on all layers still hits culled things', () => {
    const { culler, things } = resort();
    culler.update(1, new THREE.Vector3(36, 1.65, 6.2));
    expect(culled(things.pokerTable)).toBe(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(-24.5, 5, -2.5), new THREE.Vector3(0, -1, 0));
    expect(ray.intersectObject(things.pokerTable).length).toBe(0);
    ray.layers.enableAll();
    expect(ray.intersectObject(things.pokerTable).length).toBeGreaterThan(0);
  });
});

describe('merging', () => {
  it('bakeStatic byColor merges materials alike but for colour, keeping the colours', () => {
    const root = new THREE.Group();
    const red = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.5 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x0000ff, roughness: 0.5 });
    const shiny = new THREE.MeshStandardMaterial({ color: 0x00ff00, roughness: 0.1 });
    root.add(box(0, 0, 0, 1, red), box(2, 0, 0, 1, blue), box(4, 0, 0, 1, shiny));
    bakeStatic(root, { byColor: true });
    const meshes = root.children as THREE.Mesh[];
    expect(meshes.length).toBe(2);
    const merged = meshes.find((m) => m.name === 'baked')!;
    expect((merged.material as THREE.MeshStandardMaterial).vertexColors).toBe(true);
    const col = merged.geometry.getAttribute('color');
    const reds = new Set<string>();
    for (let i = 0; i < col.count; i++) reds.add(`${col.getX(i).toFixed(2)},${col.getZ(i).toFixed(2)}`);
    expect([...reds].sort()).toEqual(['0.00,1.00', '1.00,0.00']);
  });

  it('bakeStatic byColor also merges petals whose faint glow is their own colour', () => {
    const root = new THREE.Group();
    const petal = (c: number) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.12, roughness: 0.55 });
    root.add(box(0, 0, 0, 0.1, petal(0xff0000)), box(1, 0, 0, 0.1, petal(0x00ff00)), box(2, 0, 0, 0.1, petal(0x0000ff)));
    bakeStatic(root, { byColor: true });
    expect(root.children.length).toBe(1);
    const mat = (root.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(mat.vertexColors).toBe(true);
    expect(mat.emissive.getHex()).toBe(0xffffff);
    expect(mat.customProgramCacheKey()).toBe('glow-from-vertex');
  });

  it('batchSprites draws alike sprites as one mesh', () => {
    const root = new THREE.Group();
    const tex = new THREE.Texture();
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, opacity: 0.7, transparent: true }));
      s.position.set(i, 2, 0);
      s.scale.setScalar(1.5);
      root.add(s);
    }
    const odd = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, opacity: 0.2 }));
    root.add(odd);
    expect(batchSprites(root)).toBe(1);
    expect(root.children.filter((o) => (o as THREE.Sprite).isSprite)).toEqual([odd]);
    const mesh = root.children.find((o) => o.name === 'sprites') as THREE.Mesh;
    expect(mesh.geometry.getAttribute('position').count).toBe(12);
    expect(mesh.geometry.boundingSphere!.radius).toBeGreaterThan(1);
  });
});
