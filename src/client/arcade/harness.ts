import * as THREE from 'three';
import { mountArcade, type ArcadeDeps, type ArcadeHandle, type ArcadeSlot } from './index';

/**
 * Dev harness only (main.ts loads it with `?arcade=1`): a bare test room far
 * from the casino with the arcade mounted in it, and you placed at its door.
 * The real arcade lives in the Promenade, which calls mountArcade with its
 * own ARCADE_SLOTS.
 */

export const TEST_ROOM = { x: -300, z: 0, w: 14, d: 12 };

/** Slots laid out like the Promenade's arcade: six bays on the back wall, three floor spots. */
export function testSlots(): ArcadeSlot[] {
  const { x, z, d } = TEST_ROOM;
  const back = z - d / 2 + 0.47;
  const bays = [-3.1, -2.1, -1.1, -0.1, 0.9, 2.15];
  const slots: ArcadeSlot[] = bays.map((dx, i) => ({ id: `bay${i + 1}`, kind: 'cabinet' as const, pos: new THREE.Vector3(x + dx, 0, back), yaw: 0, footprint: [i === 5 ? 1.1 : 0.8, 0.9] as [number, number] }));
  slots.push({ id: 'floor-a', kind: 'floor', pos: new THREE.Vector3(x + 5.3, 0, z - 2.6), yaw: -Math.PI / 2, footprint: [1.3, 2.7] });
  slots.push({ id: 'floor-b', kind: 'floor', pos: new THREE.Vector3(x + 0.2, 0, z + 1.4), yaw: Math.PI / 2, footprint: [1.3, 2.4] });
  slots.push({ id: 'floor-c', kind: 'floor', pos: new THREE.Vector3(x - 5.6, 0, z - 3.6), yaw: Math.PI / 2, footprint: [1.0, 1.0] });
  return slots;
}

export interface HarnessDeps extends ArcadeDeps {
  scene: THREE.Scene;
}

export function mountArcadeHarness(d: HarnessDeps): ArcadeHandle {
  const { x, z, w, d: depth } = TEST_ROOM;
  const room = new THREE.Group();
  room.name = 'arcade-test-room';
  d.scene.add(room);
  // Carpet with a neon confetti pattern, dark walls, a low ceiling.
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#120a24';
  g.fillRect(0, 0, 256, 256);
  const cols = ['#ff5ab4', '#3ad8ff', '#ffd34d', '#7dff5a'];
  for (let k = 0; k < 90; k++) {
    g.fillStyle = cols[k % 4];
    g.save();
    g.translate((k * 97) % 256, (k * 61) % 256);
    g.rotate(k);
    g.fillRect(-6, -1.5, 12, 3);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(w / 2, depth / 2);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, depth), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(x, 0.001, z);
  room.add(floor);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a1030, roughness: 0.8, side: THREE.BackSide });
  const shell = new THREE.Mesh(new THREE.BoxGeometry(w, 3.6, depth), wallMat);
  shell.position.set(x, 1.8, z);
  room.add(shell);
  // Neon strips round the walls.
  const neon = new THREE.MeshBasicMaterial({ color: 0xff5ab4, toneMapped: false });
  for (const [px, pz, sx, sz] of [
    [x, z - depth / 2 + 0.02, w, 0.02],
    [x, z + depth / 2 - 0.02, w, 0.02],
    [x - w / 2 + 0.02, z, 0.02, depth],
    [x + w / 2 - 0.02, z, 0.02, depth],
  ]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.04, sz), neon);
    s.position.set(px, 2.9, pz);
    room.add(s);
  }
  room.add(new THREE.HemisphereLight(0x8a90ff, 0x301020, 1.1));
  for (const [px, pz] of [
    [x - 3, z - 2],
    [x + 3, z - 2],
    [x, z + 3],
  ]) {
    const l = new THREE.PointLight(0xffe0f0, 6, 12, 1.6);
    l.position.set(px, 3.2, pz);
    room.add(l);
  }
  d.world.addWalkable(x - w / 2 + 0.3, x + w / 2 - 0.3, z - depth / 2 + 0.3, z + depth / 2 - 0.3);
  const arcade = mountArcade(d.scene, testSlots(), d);
  // Stand at the door, facing the cabinets.
  d.player.place({ id: 'arcade-test', label: 'Arcade (test)', position: new THREE.Vector3(x, 0, z + depth / 2 - 1.2), yaw: 0, pitch: -0.05, eye: 1.65 });
  d.player.current = null;
  return arcade;
}
