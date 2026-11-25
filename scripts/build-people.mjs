// Builds web-ready people from the Quaternius "Ultimate Modular" characters (CC0).
//  - drops props (the pistol) and every animation except the ones we use
//  - bakes each material's colour into vertex colours (and its body region into
//    the alpha), smooths the flat-shaded normals (creased) and merges the character
//    into one skinned mesh with one material (one draw call per person)
//  - quantizes and meshopt-compresses the result
// Input:  art/source/people/*.glb    Output: public/assets/people/*.glb
// The animations are written once, to people/anims.glb (all models share the rig).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, join, flatten, prune, quantize, meshopt, reorder, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { readdirSync } from 'node:fs';
import { basename } from 'node:path';

const SRC = 'art/source/people';
const OUT = 'public/assets/people';
const KEEP = ['Idle', 'Idle_Neutral', 'Walk', 'Run', 'Wave', 'Interact', 'HitRecieve'];

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

// Body regions, written to the vertex colour's alpha as region / 15. The client
// recolours each region per person (skin tone, outfit, hair) and the people shader
// shades each kind of surface its own way (skin, satin, wool, hair, gold…).
// Keep in sync with REGION in src/client/peoplelook.ts.
const R = { skin: 0, hair: 1, brow: 2, eye: 3, top: 4, bottom: 5, shoes: 6, shirt: 7, accent: 8, stubble: 9, jewel: 10, strap: 11, sole: 12 };

/** Which region a primitive is, from its material and where it sits on the body (bind pose, metres). */
function regionOf(kind, matName, lo, hi) {
  const m = matName.toLowerCase();
  if (m === 'skin') return R.skin;
  if (m === 'skin_darker') return R.stubble;
  if (m === 'eyebrows' || m === 'hair_brown') return R.brow;
  if (m === 'eye' || (m === 'brown' && hi[1] > 1.6)) return R.eye;
  if (m === 'hair' || m === 'hair_blond' || (lo[1] > 1.45 && hi[1] > 1.75)) return R.hair;
  if (m === 'gold' || m === 'earrings') return R.jewel;
  if (m === 'tie') return R.accent;
  // The watch on the suit's left wrist.
  if (hi[0] < -0.6) return m === 'darkbrown' ? R.strap : R.jewel;
  if (hi[1] < 0.3) return m === 'white' ? R.sole : R.shoes;
  if (lo[1] > 0.85) return m === 'white' && kind !== 'female_casual' ? R.shirt : R.top;
  return m === 'white' ? R.accent : R.bottom;
}

/**
 * Smooth (creased) normals for a flat-shaded primitive: each corner gets the
 * area-weighted average of the faces around its position that are within
 * `crease` of its own face, so curved surfaces (heads, limbs) shade smoothly
 * while real edges (collars, soles, nose bridge) stay crisp. The silhouette is
 * untouched (only normals change).
 */
function creaseNormals(prim, creaseDeg) {
  const pos = prim.getAttribute('POSITION');
  const nor = prim.getAttribute('NORMAL');
  const idxA = prim.getIndices();
  if (!pos || !nor) return;
  const n = pos.getCount();
  const index = idxA ? idxA.getArray() : Uint32Array.from({ length: n }, (_, i) => i);
  const P = new Float32Array(n * 3);
  const v = [0, 0, 0];
  for (let i = 0; i < n; i++) P.set(pos.getElement(i, v), i * 3);
  const tri = index.length / 3;
  const FN = new Float32Array(tri * 3); // area-weighted face normals
  const vertFaces = Array.from({ length: n }, () => []);
  for (let t = 0; t < tri; t++) {
    const a = index[t * 3] * 3, b = index[t * 3 + 1] * 3, c = index[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
    FN[t * 3] = uy * wz - uz * wy;
    FN[t * 3 + 1] = uz * wx - ux * wz;
    FN[t * 3 + 2] = ux * wy - uy * wx;
    for (let k = 0; k < 3; k++) vertFaces[index[t * 3 + k]].push(t);
  }
  const key = (i) => `${Math.round(P[i * 3] * 1e4)},${Math.round(P[i * 3 + 1] * 1e4)},${Math.round(P[i * 3 + 2] * 1e4)}`;
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const k = key(i);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = new Set()));
    for (const t of vertFaces[i]) g.add(t);
  }
  const cos = Math.cos((creaseDeg * Math.PI) / 180);
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // Reference: the vertex's own (flat) normal.
    const r = nor.getElement(i, [0, 0, 0]);
    const rl = Math.hypot(r[0], r[1], r[2]) || 1;
    let sx = 0, sy = 0, sz = 0;
    for (const t of groups.get(key(i))) {
      const fx = FN[t * 3], fy = FN[t * 3 + 1], fz = FN[t * 3 + 2];
      const fl = Math.hypot(fx, fy, fz);
      if (fl < 1e-12) continue;
      if ((fx * r[0] + fy * r[1] + fz * r[2]) / (fl * rl) < cos) continue;
      sx += fx; sy += fy; sz += fz;
    }
    const l = Math.hypot(sx, sy, sz);
    if (l < 1e-12) out.set([r[0] / rl, r[1] / rl, r[2] / rl], i * 3);
    else out.set([sx / l, sy / l, sz / l], i * 3);
  }
  const acc = prim.getAttribute('NORMAL').clone().setArray(out).setNormalized(false);
  prim.setAttribute('NORMAL', acc);
}

function bakeColours(doc, kind) {
  const root = doc.getRoot();
  const body = doc.createMaterial('Body').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.72).setMetallicFactor(0);
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      const c = mat ? mat.getBaseColorFactor() : [1, 1, 1, 1];
      const pos = prim.getAttribute('POSITION');
      const n = pos.getCount();
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], v = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        pos.getElement(i, v);
        for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], v[k])), (hi[k] = Math.max(hi[k], v[k]));
      }
      const region = regionOf(kind, mat ? mat.getName() : '', lo, hi);
      const arr = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) arr.set([c[0], c[1], c[2], region / 15], i * 4);
      const col = doc.createAccessor().setType('VEC4').setArray(arr).setBuffer(pos.getBuffer());
      prim.setAttribute('COLOR_0', col);
      // Shoes, soles, jewellery and the watch keep crisper edges.
      // Hair locks meet at steep angles but should still read as soft masses.
      const crease = [R.shoes, R.sole, R.jewel, R.strap, R.eye, R.brow].includes(region) ? 35 : region === R.hair ? 88 : region === R.skin ? 72 : 62;
      creaseNormals(prim, crease);
      // No textures: UVs only stop primitives from merging.
      for (const sem of prim.listSemantics()) if (sem.startsWith('TEXCOORD')) prim.setAttribute(sem, null);
      prim.setMaterial(body);
    }
  }
}

for (const file of readdirSync(SRC).filter((f) => f.endsWith('.glb'))) {
  const doc = await io.read(`${SRC}/${file}`);
  const root = doc.getRoot();
  // Props: the pistol (and any other held weapon), skinned or not.
  for (const node of root.listNodes()) {
    if (node.getMesh() && (!node.getSkin() || /pistol|gun|sword|knife|weapon/i.test(node.getName()))) {
      node.getMesh().dispose();
      node.dispose();
    }
  }
  const animDoc = file === 'male_suit.glb';
  for (const anim of root.listAnimations()) {
    if (!animDoc || !KEEP.includes(anim.getName())) anim.dispose();
  }
  bakeColours(doc, basename(file, '.glb'));
  await doc.transform(weld(), flatten(), join({ keepNamed: false }), prune(), dedup());
  // Positions stay float: quantizing them moves a rescale into each piece's skin, which breaks the merge.
  // (meshopt() would quantize positions unconditionally, so its steps are done by hand.)
  await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }), quantize({ pattern: /^(NORMAL|COLOR_0|JOINTS_0|WEIGHTS_0)$/, quantizeColor: 8 }));
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  await io.write(`${OUT}/${basename(file)}`, doc);

  if (animDoc) {
    // A second file with just the skeleton and the clips.
    const a = await io.read(`${SRC}/${file}`);
    const ar = a.getRoot();
    for (const anim of ar.listAnimations()) if (!KEEP.includes(anim.getName())) anim.dispose();
    for (const node of ar.listNodes()) if (node.getMesh()) node.setMesh(null);
    for (const m of ar.listMeshes()) m.dispose();
    await a.transform(prune({ keepLeaves: true }), dedup(), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
    await io.write(`${OUT}/anims.glb`, a);
  }
  const info = (await io.read(`${OUT}/${basename(file)}`)).getRoot();
  console.log(file, 'meshes', info.listMeshes().length, 'prims', info.listMeshes().reduce((s, m) => s + m.listPrimitives().length, 0), 'anims', info.listAnimations().length);
}
