import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { paintCharacter, peopleMaterial, REGION, SURF, type Paint } from '../src/client/peopleshade';

/** A tiny "character": one vertex per region, region in the colour's alpha (as the build writes it). */
function model() {
  const regions = [REGION.skin, REGION.hair, REGION.top, REGION.bottom, REGION.shirt, REGION.shoes, REGION.jewel, REGION.sole];
  const n = regions.length;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).fill(0.25), 4));
  const c = new Float32Array(n * 4);
  regions.forEach((r, i) => c.set([0.5, 0.5, 0.5, r / 15], i * 4));
  g.setAttribute('color', new THREE.BufferAttribute(c, 4));
  g.setIndex([0, 1, 2]);
  const mesh = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial());
  return { mesh, g, regions };
}

const paint: Paint = {
  skin: 0xc08660,
  hair: 0x2e1f15,
  top: 0x0c4030,
  topSurf: 'satin',
  bottom: 0x141a2c,
  bottomSurf: 'wool',
  shirt: 0xf4f2ec,
  shirtSurf: 'cotton',
  shoes: 0x0c0b0b,
  shoeSurf: 'patent',
  accent: 0x4e1220,
  accentSurf: 'silk',
  jewel: 0xd8b46a,
  glint: true,
};

describe('painting people', () => {
  it('gives each person their own colours on a geometry that shares the shape', () => {
    const { mesh, g } = model();
    paintCharacter(mesh, paint);
    const p = mesh.geometry;
    expect(p).not.toBe(g);
    expect(p.userData.base).toBe(g);
    for (const k of ['position', 'normal', 'skinIndex', 'skinWeight']) expect(p.attributes[k]).toBe(g.attributes[k]);
    expect(p.index).toBe(g.index);
    // The model keeps its own colours (faces.ts measures them).
    expect(g.attributes.color.getX(0)).toBeCloseTo(0.5);
  });

  it('colours each region and tags it with its surface', () => {
    const { mesh, regions } = model();
    paintCharacter(mesh, paint);
    const col = mesh.geometry.attributes.color as THREE.BufferAttribute;
    const at = (r: number) => regions.indexOf(r as (typeof regions)[number]);
    const rgb = (i: number) => new THREE.Color(col.getX(i), col.getY(i), col.getZ(i));
    const surf = (i: number) => Math.round(col.getW(i) * 15);
    expect(rgb(at(REGION.skin)).getHex()).toBe(0xc08660);
    expect(rgb(at(REGION.top)).getHex()).toBe(0x0c4030);
    expect(rgb(at(REGION.bottom)).getHex()).toBe(0x141a2c);
    expect(surf(at(REGION.skin))).toBe(SURF.skin);
    expect(surf(at(REGION.hair))).toBe(SURF.hair);
    expect(surf(at(REGION.top))).toBe(SURF.satin);
    expect(surf(at(REGION.shoes))).toBe(SURF.patent);
    expect(surf(at(REGION.jewel))).toBe(SURF.gem);
    expect(surf(at(REGION.sole))).toBe(SURF.rubber);
    expect((mesh.userData.skin as THREE.Color).getHex()).toBe(0xc08660);
  });

  it('repainting starts from the model, not the last paint', () => {
    const { mesh, g } = model();
    paintCharacter(mesh, paint);
    paintCharacter(mesh, { ...paint, top: 0x7c0e1c });
    expect(mesh.geometry.userData.base).toBe(g);
    const col = mesh.geometry.attributes.color as THREE.BufferAttribute;
    expect(new THREE.Color(col.getX(2), col.getY(2), col.getZ(2)).getHex()).toBe(0x7c0e1c);
  });

  it('one shared material for everybody', () => {
    const m = peopleMaterial();
    expect(m.vertexColors).toBe(true);
    expect(typeof m.onBeforeCompile).toBe('function');
  });
});
