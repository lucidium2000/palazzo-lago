import * as THREE from 'three';

/**
 * How people are coloured and shaded: one material for everybody (one draw
 * call per person), with each vertex telling the shader what it is made of.
 *
 * The built character files (scripts/build-people.mjs) store each vertex's
 * body region (skin, hair, jacket, trousers, shoes…) in the vertex colour's
 * alpha. Each person gets their own colour buffer (the shape, normals and
 * skinning stay shared): the RGB is their skin tone, hair and outfit, the
 * alpha is the surface (skin, wool, satin, sequins, leather, gold…), which the
 * shader turns into wrap-lit skin, sheen on cloth, sparkles on sequins and
 * jewellery, and a strand highlight on hair.
 */

/** Body regions as written by scripts/build-people.mjs (alpha × 15). Keep in sync. */
export const REGION = { skin: 0, hair: 1, brow: 2, eye: 3, top: 4, bottom: 5, shoes: 6, shirt: 7, accent: 8, stubble: 9, jewel: 10, strap: 11, sole: 12 } as const;

/** Surfaces the shader knows (alpha × 15 in a person's colour buffer). */
export const SURF = { skin: 0, hair: 1, feature: 2, wool: 3, satin: 4, sequin: 5, cotton: 6, leather: 7, patent: 8, metal: 9, gem: 10, silk: 11, rubber: 12, velvet: 13, denim: 14 } as const;
export type Surface = keyof typeof SURF;

/** Everything needed to paint one person (sRGB hex colours). */
export interface Paint {
  skin: number;
  hair: number;
  top: number;
  topSurf: Surface;
  bottom: number;
  bottomSurf: Surface;
  shirt: number;
  shirtSurf: Surface;
  shoes: number;
  shoeSurf: Surface;
  accent: number;
  accentSurf: Surface;
  /** Jewellery / watch metal colour, and whether it glints. */
  jewel: number;
  glint: boolean;
  /** Lipstick (sRGB), else lips are a deeper shade of the skin. */
  lipstick?: number;
}

const regionsOf = new WeakMap<THREE.BufferGeometry, Uint8Array>();

function regions(template: THREE.BufferGeometry): Uint8Array {
  let r = regionsOf.get(template);
  if (r) return r;
  const col = template.attributes.color as THREE.BufferAttribute | undefined;
  const n = template.attributes.position.count;
  r = new Uint8Array(n);
  // Old files (no regions in the alpha) come out all skin; the paint then keeps their own colours.
  if (col && col.itemSize === 4) for (let i = 0; i < n; i++) r[i] = Math.min(15, Math.max(0, Math.round(col.getW(i) * 15)));
  regionsOf.set(template, r);
  return r;
}

const lin = (hex: number) => new THREE.Color(hex);

/**
 * Gives a spawned character its own colours. The geometry is swapped for one
 * that shares every buffer with the model except the colours, so the GPU cost
 * is one small colour buffer per person (8 bytes a vertex).
 */
export function paintCharacter(mesh: THREE.SkinnedMesh, paint: Paint) {
  const t = (mesh.geometry.userData.base as THREE.BufferGeometry | undefined) ?? mesh.geometry;
  const src = t.attributes.color as THREE.BufferAttribute | undefined;
  if (!src || src.itemSize !== 4) return;
  const reg = regions(t);
  const n = reg.length;
  const skin = lin(paint.skin);
  const hair = lin(paint.hair);
  // Brows a shade darker than the hair (and never lighter than a dark blonde would read).
  const brow = hair.clone().multiplyScalar(0.55);
  const eye = lin(0x140c08);
  const stubble = skin.clone().lerp(hair, 0.35).multiplyScalar(0.78);
  const table: [THREE.Color, number][] = [];
  table[REGION.skin] = [skin, SURF.skin];
  table[REGION.hair] = [hair, SURF.hair];
  table[REGION.brow] = [brow, SURF.feature];
  table[REGION.eye] = [eye, SURF.feature];
  table[REGION.top] = [lin(paint.top), SURF[paint.topSurf]];
  table[REGION.bottom] = [lin(paint.bottom), SURF[paint.bottomSurf]];
  table[REGION.shoes] = [lin(paint.shoes), SURF[paint.shoeSurf]];
  table[REGION.shirt] = [lin(paint.shirt), SURF[paint.shirtSurf]];
  table[REGION.accent] = [lin(paint.accent), SURF[paint.accentSurf]];
  table[REGION.stubble] = [stubble, SURF.skin];
  table[REGION.jewel] = [lin(paint.jewel), paint.glint ? SURF.gem : SURF.metal];
  table[REGION.strap] = [lin(0x2a1a10), SURF.leather];
  table[REGION.sole] = [lin(paint.shoeSurf === 'leather' ? 0x1a1410 : 0xe6e2da), SURF.rubber];
  const out = new Uint16Array(n * 4);
  for (let i = 0; i < n; i++) {
    const e = table[reg[i]] ?? table[REGION.skin];
    const o = i * 4;
    out[o] = Math.round(e[0].r * 65535);
    out[o + 1] = Math.round(e[0].g * 65535);
    out[o + 2] = Math.round(e[0].b * 65535);
    out[o + 3] = Math.round((e[1] / 15) * 65535);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(t.index);
  for (const k of ['position', 'normal', 'skinIndex', 'skinWeight']) if (t.attributes[k]) g.setAttribute(k, t.attributes[k]);
  g.setAttribute('color', new THREE.BufferAttribute(out, 4, true));
  g.boundingBox = t.boundingBox;
  g.boundingSphere = t.boundingSphere;
  g.userData.base = t;
  mesh.geometry = g;
  mesh.userData.skin = skin;
  mesh.userData.brow = brow;
  mesh.userData.lips = paint.lipstick !== undefined ? lin(paint.lipstick) : skin.clone().multiply(new THREE.Color(0.62, 0.36, 0.36)).lerp(lin(0x9a5a52), 0.2);
}

/**
 * The one material everybody shares. Standard PBR plus, per surface:
 *  - skin: soft wrap lighting with a warm (red-shifted) terminator, a faint rim
 *  - cloth: roughness and a grazing-angle sheen per weave (wool, satin, silk,
 *    velvet; cotton and denim stay matte), sequins sparkle as you move
 *  - hair: a strand highlight (Kajiya-Kay) across the hair, fine streaks and
 *    darker roots, so it stops reading as a plastic helmet
 *  - metal: gold and silver, some with a glint
 * Faces' overlay pieces (faces.ts) use it too; without the alpha they're skin.
 */
export function peopleMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0, envMapIntensity: 0.7 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vBindPos;
varying vec3 vHairT;`,
      )
      .replace(
        '#include <skinnormal_vertex>',
        `#include <skinnormal_vertex>
vBindPos = position;
// Hair strands run from the crown outwards and down.
vec3 hairDir = position - vec3(0.0, 1.86, -0.03);
#ifdef USE_SKINNING
  hairDir = (skinMatrix * vec4(hairDir, 0.0)).xyz;
#endif
vHairT = normalize(normalMatrix * hairDir);`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vBindPos;
varying vec3 vHairT;
float pSkin = 0.0;   // wrap / scatter
float pSheen = 0.0;  // grazing sheen
vec3 pSheenCol = vec3(0.0);
float pHair = 0.0;   // strand highlight
vec3 pHairT = vec3(0.0, 1.0, 0.0);
float pHash(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }`,
      )
      .replace(
        '#include <lights_physical_pars_fragment>',
        `#include <lights_physical_pars_fragment>
void RE_Direct_People(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
  RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
  float ndl = dot(geometryNormal, directLight.direction);
  if (pSkin > 0.0) {
    // Light bleeding past the terminator, reddened (blood under the skin).
    float wrap = clamp((ndl + 0.55) / 1.55, 0.0, 1.0);
    float extra = max(wrap * wrap - max(ndl, 0.0), 0.0);
    reflectedLight.directDiffuse += pSkin * extra * directLight.color * material.diffuseColor * vec3(1.0, 0.42, 0.28) * RECIPROCAL_PI * 2.2;
  }
  float ndv = clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0);
  if (pSheen > 0.0) {
    float s = pow(1.0 - ndv, 4.0) * clamp(ndl * 0.6 + 0.4, 0.0, 1.0);
    reflectedLight.directSpecular += pSheen * s * pSheenCol * directLight.color;
  }
  if (pHair > 0.0) {
    vec3 T = normalize(pHairT - geometryNormal * dot(geometryNormal, pHairT));
    vec3 H = normalize(directLight.direction + geometryViewDir);
    float th = dot(T, H);
    float s = pow(sqrt(max(0.0, 1.0 - th * th)), 90.0);
    // Fade at grazing angles: thin locks seen edge-on shouldn't flare white.
    reflectedLight.directSpecular += pHair * s * clamp(ndl * 0.8 + 0.2, 0.0, 1.0) * clamp(ndv * 3.0, 0.0, 1.0) * directLight.color;
  }
}
#undef RE_Direct
#define RE_Direct RE_Direct_People`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
#ifdef USE_COLOR_ALPHA
  float surf = floor(vColor.a * 15.0 + 0.5);
  diffuseColor.a = 1.0;
#else
  float surf = 0.0;
#endif
float pRough = 0.6;
float pMetal = 0.0;
float pRim = 0.0;
float pSparkle = 0.0;
float pSparkCell = 260.0;
if (surf < 0.5) { // skin
  pSkin = 1.0; pRough = 0.6; pRim = 0.2;
} else if (surf < 1.5) { // hair
  float ang = atan(vBindPos.x, vBindPos.z + 0.03);
  float streak = 0.5 + 0.5 * sin(ang * 61.0 + sin(ang * 23.0) * 2.0) * sin(ang * 37.0 + vBindPos.y * 9.0);
  float roots = smoothstep(1.66, 1.87, vBindPos.y);
  diffuseColor.rgb *= (0.8 + 0.3 * streak) * (1.0 - 0.32 * roots);
  pHair = 0.12 + 0.14 * streak; pRough = 0.56; pRim = 0.18;
  pHairT = normalize(vHairT);
} else if (surf < 2.5) { // eyes, brows
  pRough = 0.4;
} else if (surf < 3.5) { // wool (suits)
  pRough = 0.72; pSheen = 0.22; pSheenCol = diffuseColor.rgb * 0.6 + 0.04;
} else if (surf < 4.5) { // satin
  pRough = 0.3; pSheen = 0.55; pSheenCol = diffuseColor.rgb * 1.2 + 0.03;
} else if (surf < 5.5) { // sequins
  pRough = 0.28; pMetal = 0.55; pSheen = 0.4; pSheenCol = diffuseColor.rgb + 0.05; pSparkle = 1.0;
} else if (surf < 6.5) { // cotton
  pRough = 0.88; pSheen = 0.06; pSheenCol = diffuseColor.rgb + 0.05;
} else if (surf < 7.5) { // leather
  pRough = 0.38;
} else if (surf < 8.5) { // patent
  pRough = 0.14;
} else if (surf < 9.5) { // metal
  pRough = 0.26; pMetal = 1.0;
} else if (surf < 10.5) { // metal with a glint
  pRough = 0.16; pMetal = 1.0; pSparkle = 2.5; pSparkCell = 150.0;
} else if (surf < 11.5) { // silk
  pRough = 0.38; pSheen = 0.35; pSheenCol = diffuseColor.rgb + 0.05;
} else if (surf < 12.5) { // rubber
  pRough = 0.85;
} else if (surf < 13.5) { // velvet
  pRough = 0.8; pSheen = 0.8; pSheenCol = diffuseColor.rgb * 1.6 + 0.02;
} else { // denim
  pRough = 0.92; pSheen = 0.05; pSheenCol = vec3(0.05);
}`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = pRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = pMetal;')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
{
  vec3 amb = irradiance + iblIrradiance;
  float ndv = clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0);
  // A soft rim from the room's light, so skin and hair separate from what's behind them.
  reflectedLight.indirectDiffuse += pRim * pow(1.0 - ndv, 3.0) * amb * diffuseColor.rgb * vec3(1.0, 0.85, 0.7) * RECIPROCAL_PI * 1.6;
  if (pSparkle > 0.0) {
    // Sequins / facets: a few cells catch the light as you (or they) move.
    vec3 cell = floor(vBindPos * pSparkCell);
    float h = pHash(cell);
    float tw = sin(h * 6283.0 + dot(geometryNormal, vec3(31.0, 23.0, 17.0)) + dot(geometryViewDir, vec3(13.0, 7.0, 19.0)));
    float glint = step(0.93, h) * smoothstep(0.96, 1.0, tw);
    float fade = 1.0 - smoothstep(1.2, 4.5, -vViewPosition.z);
    float lum = dot(amb, vec3(0.3, 0.59, 0.11)) * RECIPROCAL_PI;
    reflectedLight.directSpecular += pSparkle * glint * fade * (0.35 + 1.6 * lum) * mix(vec3(1.0, 0.95, 0.85), diffuseColor.rgb + 0.3, 0.5);
  }
}`,
      );
  };
  mat.customProgramCacheKey = () => 'people-v1';
  return mat;
}
