import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Merges every static mesh under `root` that shares a material into a single
 * mesh. Interactive objects (registered with Interaction), anything marked
 * `userData.dynamic`, instanced meshes, multi-material meshes and sprites are
 * left alone. This is the main draw-call saver for Quest.
 */
export function bakeStatic(root: THREE.Object3D, opts: { shadows?: boolean } = {}): number {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; cast: boolean }>();
  const remove: THREE.Mesh[] = [];

  const visit = (o: THREE.Object3D) => {
    if (o.userData.dynamic || o.userData.interactable) return;
    if ((o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material;
      if (!Array.isArray(mat) && mesh.visible) {
        const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        g.morphAttributes = {};
        let entry = groups.get(mat);
        if (!entry) groups.set(mat, (entry = { geos: [], cast: false }));
        entry.geos.push(g);
        entry.cast ||= mesh.castShadow;
        remove.push(mesh);
      }
    }
    for (const c of [...o.children]) visit(c);
  };
  for (const c of [...root.children]) visit(c);

  let merged = 0;
  for (const [mat, { geos, cast }] of groups) {
    if (geos.length < 2) {
      geos.forEach((g) => g.dispose());
      // Keep the original single mesh where it is.
      const keep = remove.findIndex((m) => m.material === mat);
      if (keep >= 0) remove.splice(keep, 1);
      continue;
    }
    const geo = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = cast && !!opts.shadows;
    mesh.receiveShadow = !!opts.shadows;
    mesh.name = 'baked';
    root.add(mesh);
    merged++;
  }
  for (const m of remove) {
    if (m.name === 'baked') continue;
    m.removeFromParent();
  }
  // Drop groups left empty.
  const prune = (o: THREE.Object3D) => {
    for (const c of [...o.children]) prune(c);
    if (o !== root && o.type === 'Group' && o.children.length === 0 && !o.userData.dynamic) o.removeFromParent();
  };
  prune(root);
  return merged;
}

/** Marks an object (and so its subtree) as moving, so bakeStatic leaves it alone. */
export function dynamic<T extends THREE.Object3D>(o: T): T {
  o.userData.dynamic = true;
  return o;
}
