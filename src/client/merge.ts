import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Merges every static mesh under `root` that shares a material into a single
 * mesh. Interactive objects (registered with Interaction), anything marked
 * `userData.dynamic`, instanced meshes, multi-material meshes and sprites are
 * left alone. This is the main draw-call saver for Quest.
 */
export function bakeStatic(root: THREE.Object3D, opts: { shadows?: boolean; byColor?: boolean } = {}): number {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; cast: boolean }>();
  // byColor: materials alike but for their colour share a mesh too (the colour goes in the vertices).
  // Only for static decor whose materials nothing changes later (a merged mesh has its own material).
  const sameBut = opts.byColor ? new Map<string, THREE.Material>() : null;
  const tint = new Map<THREE.BufferGeometry, THREE.Color>();
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
        let key: THREE.Material = mat;
        const ck = sameBut ? colorKey(mat) : null;
        if (ck !== null) {
          const first = sameBut!.get(ck);
          if (first) key = first;
          else sameBut!.set(ck, mat);
          tint.set(g, (mat as THREE.MeshBasicMaterial).color);
        }
        let entry = groups.get(key);
        if (!entry) groups.set(key, (entry = { geos: [], cast: false }));
        entry.geos.push(g);
        entry.cast ||= mesh.castShadow;
        remove.push(mesh);
      }
    }
    for (const c of [...o.children]) visit(c);
  };
  for (const c of [...root.children]) visit(c);

  let merged = 0;
  for (const [first, { geos, cast }] of groups) {
    let mat = first;
    if (geos.length < 2) {
      geos.forEach((g) => g.dispose());
      // Keep the original single mesh where it is.
      const keep = remove.findIndex((m) => m.material === mat);
      if (keep >= 0) remove.splice(keep, 1);
      continue;
    }
    // Several colours: white material, colours per vertex (same look: the colour multiplies either way).
    const colors = geos.map((g) => tint.get(g));
    if (colors[0] && colors.some((c) => !c!.equals(colors[0]!))) {
      for (const g of geos) {
        const c = tint.get(g)!;
        const n = g.attributes.position.count;
        const a = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
        g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      }
      mat = first.clone();
      (mat as THREE.MeshBasicMaterial).color.set(0xffffff);
      mat.vertexColors = true;
      if (glowsOwnColor(first)) {
        // The glow takes each vertex's colour too.
        (mat as THREE.MeshStandardMaterial).emissive.set(0xffffff);
        mat.onBeforeCompile = (sh) => {
          sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;');
        };
        mat.customProgramCacheKey = () => 'glow-from-vertex';
      }
    } else if (colors[0] && !colors[0].equals((first as THREE.MeshBasicMaterial).color)) {
      // All one colour, but not the first material's: use one that has it.
      mat = first.clone();
      (mat as THREE.MeshBasicMaterial).color.copy(colors[0]);
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

const DEFAULT_COMPILE = THREE.Material.prototype.onBeforeCompile;
const TEX = ['map', 'alphaMap', 'aoMap', 'bumpMap', 'emissiveMap', 'envMap', 'lightMap', 'metalnessMap', 'normalMap', 'roughnessMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'specularMap', 'transmissionMap', 'thicknessMap', 'sheenColorMap', 'iridescenceMap', 'displacementMap'];
const PARAMS = ['roughness', 'metalness', 'emissiveIntensity', 'envMapIntensity', 'transparent', 'opacity', 'alphaTest', 'side', 'blending', 'depthWrite', 'depthTest', 'toneMapped', 'fog', 'flatShading', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'clearcoat', 'clearcoatRoughness', 'transmission', 'thickness', 'ior', 'sheen', 'sheenRoughness', 'specularIntensity', 'iridescence', 'reflectivity', 'wireframe', 'aoMapIntensity', 'lightMapIntensity', 'bumpScale', 'colorWrite', 'premultipliedAlpha', 'dithering', 'alphaToCoverage', 'refractionRatio', 'combine'];
/** Emissive tint equal to the colour, and faint (so the areas' night dimming treats them all alike). */
function glowsOwnColor(m: THREE.Material): boolean {
  const s = m as THREE.MeshStandardMaterial;
  return !!s.emissive && s.emissive.getHex() !== 0 && s.emissive.equals(s.color) && s.emissiveIntensity < 0.3;
}

/** A key for "the same material but for its colour", or null when it can't share (custom shaders and such). */
function colorKey(m: THREE.Material): string | null {
  const t = m.type;
  if (t !== 'MeshStandardMaterial' && t !== 'MeshPhysicalMaterial' && t !== 'MeshBasicMaterial' && t !== 'MeshLambertMaterial') return null;
  if (m.transparent || m.vertexColors || m.onBeforeCompile !== DEFAULT_COMPILE || Object.keys(m.userData).length || m.clippingPlanes || !m.visible) return null;
  const r = m as unknown as Record<string, unknown>;
  const parts: unknown[] = [t];
  for (const k of TEX) parts.push((r[k] as THREE.Texture | null | undefined)?.uuid ?? '');
  for (const k of PARAMS) parts.push(r[k]);
  // A self-lit tint the same as the colour (flower petals) merges too: the vertices carry both (see glowFromVertex).
  const em = r.emissive as THREE.Color | undefined;
  parts.push(em && glowsOwnColor(m) ? 'own' : em?.getHex());
  for (const k of ['specularColor', 'sheenColor', 'attenuationColor']) parts.push((r[k] as THREE.Color | undefined)?.getHex());
  const ns = r.normalScale as THREE.Vector2 | undefined;
  if (ns) parts.push(ns.x, ns.y);
  return parts.join('|');
}

/** Marks an object (and so its subtree) as moving, so bakeStatic leaves it alone. */
export function dynamic<T extends THREE.Object3D>(o: T): T {
  o.userData.dynamic = true;
  return o;
}

/**
 * Draws every static sprite under `root` that looks the same (texture, colour,
 * blending) as one mesh: a
 * quad per sprite, turned to face the camera in the vertex shader exactly as a
 * Sprite is (the corner offset added in view space), so they look the same,
 * per eye in VR too. Sprites under dynamic or interactable objects, rotated or
 * off-centre ones, and materials with fewer than two sprites are left alone.
 * Returns the number of meshes made.
 */
export function batchSprites(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  // Sprites whose materials look the same (a fresh material per chandelier, say) share a mesh.
  const groups = new Map<string, THREE.Sprite[]>();
  const keyOf = (s: THREE.Sprite) => {
    const m = s.material;
    return [m.map?.uuid, m.color.getHexString(), m.opacity, m.blending, m.transparent, m.depthWrite, m.depthTest, m.fog, m.toneMapped, s.renderOrder].join('|');
  };
  const visit = (o: THREE.Object3D) => {
    if (o.userData.dynamic || o.userData.interactable) return;
    const s = o as THREE.Sprite;
    if (s.isSprite && s.visible && s.center.x === 0.5 && s.center.y === 0.5 && s.material.rotation === 0 && s.material.sizeAttenuation && !s.material.alphaMap) {
      const key = keyOf(s);
      let list = groups.get(key);
      if (!list) groups.set(key, (list = []));
      list.push(s);
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  let made = 0;
  const p = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    sc = new THREE.Vector3(),
    m = new THREE.Matrix4();
  for (const sprites of groups.values()) {
    if (sprites.length < 2) continue;
    const sm = sprites[0].material;
    const n = sprites.length;
    const pos = new Float32Array(n * 4 * 3);
    const off = new Float32Array(n * 4 * 2);
    const uv = new Float32Array(n * 4 * 2);
    const index: number[] = [];
    const corners = [
      [-0.5, -0.5, 0, 0],
      [0.5, -0.5, 1, 0],
      [0.5, 0.5, 1, 1],
      [-0.5, 0.5, 0, 1],
    ];
    sprites.forEach((s, i) => {
      m.multiplyMatrices(inv, s.matrixWorld).decompose(p, q, sc);
      for (let k = 0; k < 4; k++) {
        const v = i * 4 + k;
        pos.set([p.x, p.y, p.z], v * 3);
        off.set([corners[k][0] * sc.x, corners[k][1] * sc.y], v * 2);
        uv.set([corners[k][2], corners[k][3]], v * 2);
      }
      index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
      s.removeFromParent();
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('spriteOffset', new THREE.BufferAttribute(off, 2));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(index);
    geo.computeBoundingSphere();
    let big = 0;
    for (let i = 0; i < off.length; i += 2) big = Math.max(big, Math.hypot(off[i], off[i + 1]));
    geo.boundingSphere!.radius += big;
    const mat = new THREE.MeshBasicMaterial({
      map: sm.map,
      color: sm.color,
      opacity: sm.opacity,
      transparent: sm.transparent,
      blending: sm.blending,
      depthWrite: sm.depthWrite,
      depthTest: sm.depthTest,
      fog: sm.fog,
      toneMapped: sm.toneMapped,
      // (The quads are built facing the camera: one side, one pass.)
      side: THREE.FrontSide,
    });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 spriteOffset;').replace(
        '#include <project_vertex>',
        `vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
        mvPosition.xy += spriteOffset;
        gl_Position = projectionMatrix * mvPosition;`,
      );
    };
    mat.customProgramCacheKey = () => 'sprite-batch';
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'sprites';
    mesh.renderOrder = sprites[0].renderOrder;
    mesh.matrixAutoUpdate = false;
    mesh.raycast = () => {};
    root.add(mesh);
    made++;
  }
  return made;
}

/**
 * Three draws a transparent double-sided mesh twice (back faces, then front) so
 * it blends in the right order. A flat one has nothing behind itself, and an
 * additive one blends the same in any order: for those one pass looks the same
 * at half the draws. Returns whether it changed the material.
 */
const singled = new WeakMap<THREE.Material, boolean>();
export function singlePassWhereSafe(mesh: THREE.Mesh): boolean {
  const mat = mesh.material;
  if (Array.isArray(mat) || !mat.transparent || mat.side !== THREE.DoubleSide) return false;
  const mine = singled.get(mat);
  if (mine === false || (mat.forceSinglePass && mine === undefined)) return false;
  let safe = mat.blending === THREE.AdditiveBlending;
  if (!safe && mesh.geometry) {
    const g = mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const s = g.boundingBox!.getSize(new THREE.Vector3());
    safe = Math.min(s.x, s.y, s.z) < 1e-5;
  }
  // (Shared with something that isn't flat: back to two passes, for good.)
  singled.set(mat, safe);
  mat.forceSinglePass = safe;
  return safe;
}
