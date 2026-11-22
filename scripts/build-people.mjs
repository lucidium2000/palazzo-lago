// Builds web-ready people from the Quaternius "Ultimate Modular" characters (CC0).
//  - drops props (the pistol) and every animation except the ones we use
//  - bakes each material's colour into vertex colours and merges the character
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

function bakeColours(doc) {
  const root = doc.getRoot();
  const body = doc.createMaterial('Body').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.72).setMetallicFactor(0);
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      const c = mat ? mat.getBaseColorFactor() : [1, 1, 1, 1];
      const pos = prim.getAttribute('POSITION');
      const n = pos.getCount();
      const arr = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) arr.set([c[0], c[1], c[2], 1], i * 4);
      const col = doc.createAccessor().setType('VEC4').setArray(arr).setBuffer(pos.getBuffer());
      prim.setAttribute('COLOR_0', col);
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
  bakeColours(doc);
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
