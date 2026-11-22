import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Downloaded art (all CC0, see art/LICENSES.md):
 *  - Poly Haven PBR material sets (colour, normal, packed AO/roughness/metal)
 *  - the Poly Haven "Ballroom" HDRI for reflections
 *  - Quaternius "Ultimate Modular" people, merged to one mesh per person
 * Everything has a procedural fallback, so the casino still opens if a file fails.
 */

export type PbrName = 'marble' | 'darkmarble' | 'walnut' | 'velvet' | 'leather';

interface PbrSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  arm: THREE.Texture;
}

export interface PeopleLib {
  models: Map<string, THREE.Object3D>;
  clips: Map<string, THREE.AnimationClip>;
}

const base = (p: string) => new URL(`assets/${p}`, document.baseURI).href;

/**
 * URL for a binary asset (.glb, .hdr). Some hosts (the claude.ai artifact
 * viewer) won't serve those types, so the build also ships each one as
 * base64 in `<file>.b64.json`; fall back to that and hand back a blob URL.
 */
async function binaryUrl(p: string): Promise<string> {
  const direct = base(p);
  try {
    const r = await fetch(direct, { method: 'HEAD' });
    if (r.ok && !(r.headers.get('content-type') ?? '').includes('text/html')) return direct;
  } catch {
    /* fall through */
  }
  const r = await fetch(base(`${p}.b64.json`));
  if (!r.ok) return direct;
  const b64: string = await r.json();
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes]));
}

class Assets {
  private pbrSets = new Map<PbrName, PbrSet>();
  envHdr: THREE.DataTexture | null = null;
  people: PeopleLib | null = null;

  async load(renderer: THREE.WebGLRenderer, onProgress: (k: number) => void) {
    const names: PbrName[] = ['marble', 'darkmarble', 'walnut', 'velvet', 'leather'];
    const loader = new THREE.TextureLoader();
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    let done = 0;
    const total = names.length * 3 + 2;
    const tick = () => onProgress(++done / total);
    const tex = async (file: string, srgb: boolean) => {
      const t = await loader.loadAsync(base(`tex/${file}`));
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = aniso;
      tick();
      return t;
    };
    const jobs: Promise<unknown>[] = names.map(async (n) => {
      try {
        const [map, normalMap, arm] = await Promise.all([tex(`${n}.diff.jpg`, true), tex(`${n}.nor.jpg`, false), tex(`${n}.arm.jpg`, false)]);
        this.pbrSets.set(n, { map, normalMap, arm });
      } catch (e) {
        console.warn('texture set failed', n, e);
      }
    });
    jobs.push(
      binaryUrl('tex/ballroom.hdr')
        .then((u) => new RGBELoader().loadAsync(u))
        .then((t) => {
          t.mapping = THREE.EquirectangularReflectionMapping;
          this.envHdr = t;
          tick();
        })
        .catch((e) => console.warn('hdri failed', e)),
    );
    jobs.push(
      this.loadPeople()
        .then(() => tick())
        .catch((e) => console.warn('people failed', e)),
    );
    await Promise.all(jobs);
  }

  /** A material set as maps with their own repeat (sharing the GPU upload). */
  pbr(name: PbrName, repeat: number | [number, number] = 1) {
    const s = this.pbrSets.get(name);
    if (!s) return null;
    const [rx, ry] = typeof repeat === 'number' ? [repeat, repeat] : repeat;
    const c = (t: THREE.Texture) => {
      const k = t.clone();
      k.repeat.set(rx, ry);
      k.needsUpdate = true;
      return k;
    };
    const arm = c(s.arm);
    return { map: c(s.map), normalMap: c(s.normalMap), roughnessMap: arm, aoMap: arm, metalnessMap: arm };
  }

  /** Raw image of a material's colour map (for drawing into canvases, e.g. the floor tiles). */
  image(name: PbrName): HTMLImageElement | ImageBitmap | null {
    return (this.pbrSets.get(name)?.map.image as HTMLImageElement) ?? null;
  }

  /**
   * A standard material from a set, or the fallback when the files didn't load.
   * `tint` multiplies the photo colour; `rough` and `normal` scale the maps.
   */
  material(
    name: PbrName,
    opts: { repeat?: number | [number, number]; tint?: number; rough?: number; normal?: number; physical?: boolean; envIntensity?: number; fallback: () => THREE.MeshStandardMaterial },
  ): THREE.MeshStandardMaterial {
    const maps = this.pbr(name, opts.repeat ?? 1);
    if (!maps) return opts.fallback();
    const params = {
      map: maps.map,
      normalMap: maps.normalMap,
      roughnessMap: maps.roughnessMap,
      aoMap: maps.aoMap,
      aoMapIntensity: 0.6,
      // The walnut scan is a pale veneer: stain it to a casino-table mahogany unless told otherwise.
      color: opts.tint ?? (name === 'walnut' ? 0x6a3a2a : 0xffffff),
      roughness: opts.rough ?? 1,
      metalness: 0,
      envMapIntensity: opts.envIntensity ?? 1,
      normalScale: new THREE.Vector2(opts.normal ?? 1, opts.normal ?? 1),
    };
    return opts.physical ? new THREE.MeshPhysicalMaterial(params) : new THREE.MeshStandardMaterial(params);
  }

  private async loadPeople() {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const kinds = ['male_suit', 'male_casual_2', 'male_beach', 'female_formal', 'female_suit', 'female_casual'];
    const [animGltf, ...gltfs] = await Promise.all([
      binaryUrl('people/anims.glb').then((u) => loader.loadAsync(u)),
      ...kinds.map((k) => binaryUrl(`people/${k}.glb`).then((u) => loader.loadAsync(u))),
    ]);
    const clips = new Map<string, THREE.AnimationClip>();
    for (const c of animGltf.animations) clips.set(c.name, c);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0, envMapIntensity: 0.7 });
    const models = new Map<string, THREE.Object3D>();
    kinds.forEach((k, i) => models.set(k, mergeCharacter(gltfs[i].scene, mat)));
    this.people = { models, clips };
  }
}

/** Merges a character's skinned pieces into one SkinnedMesh (one draw call per person). */
function mergeCharacter(scene: THREE.Object3D, mat: THREE.Material): THREE.Object3D {
  const parts: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) parts.push(o as THREE.SkinnedMesh);
  });
  if (parts.length === 0) return scene;
  const geos = parts.map((p) => {
    const g = p.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.color) {
      const n = g.attributes.position.count;
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 4).fill(1), 4));
    }
    // Normalise attribute types so mergeGeometries accepts them.
    for (const k of ['position', 'normal', 'color', 'skinWeight'] as const) {
      const a = g.attributes[k] as THREE.BufferAttribute;
      if (a && !(a.array instanceof Float32Array)) {
        const f = new Float32Array(a.count * a.itemSize);
        for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
        g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
      }
    }
    const si = g.attributes.skinIndex as THREE.BufferAttribute;
    if (!(si.array instanceof Uint16Array)) {
      const u = new Uint16Array(si.count * 4);
      for (let i = 0; i < si.count; i++) for (let c = 0; c < 4; c++) u[i * 4 + c] = si.getComponent(i, c);
      g.setAttribute('skinIndex', new THREE.BufferAttribute(u, 4));
    }
    const col = g.attributes.color as THREE.BufferAttribute;
    if (col.itemSize === 3) {
      const f = new Float32Array(col.count * 4);
      for (let i = 0; i < col.count; i++) f.set([col.getX(i), col.getY(i), col.getZ(i), 1], i * 4);
      g.setAttribute('color', new THREE.BufferAttribute(f, 4));
    }
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    return g;
  });
  const merged = mergeGeometries(geos);
  const first = parts[0];
  const mesh = new THREE.SkinnedMesh(merged, mat);
  mesh.name = 'body';
  mesh.frustumCulled = false;
  mesh.bind(first.skeleton, first.bindMatrix);
  first.parent!.add(mesh);
  for (const p of parts) p.removeFromParent();
  return scene;
}

/** A posable copy of a character, with its own skeleton and animation mixer. */
export function spawnCharacter(lib: PeopleLib, kind: string) {
  const template = lib.models.get(kind) ?? [...lib.models.values()][0];
  const root = SkeletonUtils.clone(template);
  const bones: Record<string, THREE.Bone> = {};
  let mesh: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    // three.js strips '.' from node names (UpperLeg.L -> UpperLegL); index both spellings.
    if ((o as THREE.Bone).isBone) bones[o.name] = bones[o.name.replace(/\./g, '')] = o as THREE.Bone;
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
    o.raycast = () => {};
  });
  const mixer = new THREE.AnimationMixer(root);
  const actions: Record<string, THREE.AnimationAction> = {};
  for (const [name, clip] of lib.clips) actions[name] = mixer.clipAction(clip);
  return { root, mesh: mesh as THREE.SkinnedMesh | null, bones, mixer, actions };
}

export const assets = new Assets();
