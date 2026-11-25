import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * A cheap 3D Strip skyline for the views from the terrace, the pool deck, the
 * lake windows and the suite. Two draw calls per city:
 *
 *  1. one InstancedMesh of unit boxes: the towers (and their setbacks), the
 *     dark city ground with its street grid, and the glowing boulevards with
 *     moving traffic, all told apart by a per-instance `aInfo.x` kind;
 *  2. one merged mesh of landmark silhouettes (original designs: a needle
 *     tower, twin crescents, a sail, an observation wheel, a domed hotel and a
 *     stepped deco tower) sharing the same shader through per-vertex attributes.
 *
 * Windows come from a small canvas atlas (4x4 facade styles) mapped in world
 * units, so every face of any shape gets real-sized floors and bays; mip
 * levels are chosen from the unwrapped coordinate (textureGrad) so the tiles
 * don't shimmer or seam at a distance. Everything is unlit (it's night, the
 * city is its lights) with a distance haze, and parallax is real.
 */

export interface CityOptions {
  /** World height of the city's ground. */
  ground: number;
  /** 'lake': the Strip across the lake north of the casino; 'ring': all round a high-rise suite. */
  layout: 'lake' | 'ring';
  center: THREE.Vector2;
  seed: number;
  /** Haze distances (m) from the viewer. */
  hazeNear: number;
  hazeFar: number;
  /** Mirror the city in water at this height (an additive, rippled reflection pass). */
  mirrorY?: number;
  name?: string;
}

export interface City {
  group: THREE.Group;
  update(t: number): void;
}

const KIND = { tower: 0, ground: 1, boulevard: 2, facade: 4, neon: 5, solid: 6 } as const;

let atlasTex: THREE.Texture | null = null;
/** One clock for every city's traffic (the casino's update drives it). */
const cityTime = { value: 0 };

/** 16 facade styles, 8 bays x 16 floors each, on a 512 px canvas. */
function windowAtlas(): THREE.Texture {
  if (atlasTex) return atlasTex;
  const S = 512,
    T = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  let s = 91;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let tile = 0; tile < 16; tile++) {
    const ox = (tile % 4) * T,
      oy = Math.floor(tile / 4) * T;
    const style = Math.floor(tile / 4);
    const cw = T / 8,
      ch = T / 16;
    // Facade between the windows.
    g.fillStyle = ['#0b0a10', '#070b14', '#100c0a', '#14100a'][style];
    g.fillRect(ox, oy, T, T);
    for (let row = 0; row < 16; row++) {
      // Offices light whole floors; hotels light room by room.
      const floorLit = rnd() < (style === 1 ? 0.3 : 0.9);
      for (let col = 0; col < 8; col++) {
        const x = ox + col * cw,
          y = oy + row * ch;
        let lit: boolean;
        let colr: string;
        const warm = rnd();
        if (style === 0) {
          // Punched hotel windows, warm and cool rooms.
          lit = rnd() < 0.3;
          colr = warm < 0.6 ? '#ffd79a' : warm < 0.88 ? '#ffb468' : '#bcd8ff';
          g.fillStyle = lit ? colr : '#1a1c2a';
          g.fillRect(x + 3, y + 1.5, cw - 6, ch - 3);
        } else if (style === 1) {
          // Glass curtain wall: ribbon windows, cool office light on lit floors.
          lit = floorLit && rnd() < 0.9;
          g.fillStyle = lit ? (warm < 0.7 ? '#cfe4ff' : '#fff1cf') : '#121a2c';
          g.fillRect(x + 0.5, y + 1, cw - 1, ch - 2.5);
        } else if (style === 2) {
          // Tall narrow hotel windows with curtains half drawn.
          lit = rnd() < 0.4;
          colr = warm < 0.7 ? '#ffc27a' : warm < 0.9 ? '#ffe2b0' : '#ff9a6a';
          g.fillStyle = lit ? colr : '#1c1612';
          g.fillRect(x + 4, y + 1, cw - 8, ch - 2);
          if (col === 3 || col === 4) {
            // A lit vertical feature fin up the middle.
            g.fillStyle = '#ffe9c0';
            g.fillRect(col === 3 ? x + cw - 1.5 : x, y, 1.5, ch);
          }
        } else {
          // Gold glass: the whole facade glows faintly gold, brighter rooms on top.
          g.fillStyle = '#2a1c0e';
          g.fillRect(x, y, cw, ch);
          lit = rnd() < 0.35;
          g.fillStyle = lit ? (warm < 0.8 ? '#ffd27a' : '#fff0c8') : '#2a1c0c';
          g.fillRect(x + 1, y + 1, cw - 2, ch - 2.5);
        }
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  atlasTex = t;
  return t;
}

const vertexShader = /* glsl */ `
  attribute vec4 aInfo;   // kind, atlas tile, seed, top height (towers) / centre (boulevard)
  attribute vec3 aColor;  // crown neon (towers), colour (neon/solid parts)
  uniform float uTime;
  uniform float uMirrorY;
  varying vec3 vWorld;
  varying vec3 vN;
  varying vec4 vInfo;
  varying vec3 vColor;
  void main() {
    mat4 m = modelMatrix;
    #ifdef USE_INSTANCING
      m = modelMatrix * instanceMatrix;
    #endif
    vec4 w = m * vec4(position, 1.0);
    vWorld = w.xyz;
    vN = normalize(mat3(m) * normal);
    vInfo = aInfo;
    vColor = aColor;
    #ifdef MIRROR
      // Reflected in the lake: flip about the water line, with a ripple that grows with depth.
      float below = max(w.y - uMirrorY, 0.0);
      w.y = 2.0 * uMirrorY - w.y;
      w.x += sin(w.y * 0.45 + uTime * 1.7) * (0.15 + below * 0.012);
    #endif
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uTime;
  uniform float uGround;
  uniform vec3 uHaze;
  uniform float uHazeNear;
  uniform float uHazeFar;
  varying vec3 vWorld;
  varying vec3 vN;
  varying vec4 vInfo;
  varying vec3 vColor;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  // A soft line of half-width w around multiples of 'period', faded to its average
  // brightness once a pixel covers too much of the period (no shimmer at grazing angles).
  float gridLine(float x, float period, float w) {
    float d = abs(fract(x / period + 0.5) - 0.5) * period;
    float fw = fwidth(x);
    float l = 1.0 - smoothstep(w - fw, w + fw, d);
    return mix(l, 2.0 * w / period, clamp(fw / (period * 0.35), 0.0, 1.0));
  }

  vec3 facade(vec3 n, float tile, float seed, float top) {
    if (n.y > 0.6) return vec3(0.012, 0.012, 0.02);
    if (n.y < -0.6) return vec3(0.0);
    vec2 t = normalize(vec2(-n.z, n.x));
    float along = dot(vWorld.xz, t);
    float h = vWorld.y - uGround;
    // 2.4 m bays, 3.3 m floors; the atlas tile repeats every 8 x 16 of them.
    vec2 cell = vec2(along / 2.4, h / 3.3) + floor(vec2(seed * 7.0, seed * 13.0) * 8.0);
    vec2 g = cell / vec2(8.0, 16.0);
    vec2 off = vec2(mod(tile, 4.0), floor(tile / 4.0)) * 0.25;
    vec2 f = fract(g);
    vec2 uv = off + (vec2(0.002) + f * 0.246);
    // Mip level from the continuous coordinate, so the wrap doesn't seam.
    vec2 gs = g * 0.246;
    vec3 win = textureGrad(uAtlas, vec2(uv.x, 1.0 - uv.y), dFdx(gs), dFdy(gs)).rgb;
    // Street glow washing up the lowest floors.
    win *= 0.8;
    win += vec3(0.16, 0.09, 0.04) * exp(-h / 14.0);
    // Neon crown band at the top of towers that have one.
    if (top > 0.0 && dot(vColor, vColor) > 0.0) {
      float band = smoothstep(2.6, 2.2, top - vWorld.y) * step(vWorld.y, top);
      win = mix(win, vColor * 2.2, band);
    }
    return win;
  }

  void main() {
    float kind = vInfo.x;
    #ifdef MIRROR
      if (kind > 0.5 && kind < 2.5) discard; // the ground and roads hide their own reflections
    #endif
    vec3 n = normalize(vN);
    vec3 col;
    if (kind < 0.5 || abs(kind - 4.0) < 0.5) {
      col = facade(n, vInfo.y, vInfo.z, vInfo.w);
    } else if (kind < 1.5) {
      // City ground: dark blocks, amber avenues and streets, scattered lights.
      vec2 p = vWorld.xz;
      float av = max(gridLine(p.x, 90.0, 3.0), gridLine(p.y, 60.0, 2.0));
      vec2 cell = floor(p / 6.0);
      float r = hash(cell + vInfo.z);
      float dots = step(0.93, r);
      float fw = max(fwidth(p.x), fwidth(p.y));
      dots = mix(dots, 0.07, clamp(fw / 4.0, 0.0, 1.0));
      col = vec3(0.012, 0.01, 0.018) + vec3(1.0, 0.62, 0.3) * av * 0.55 + mix(vec3(1.0, 0.8, 0.55), vec3(0.6, 0.75, 1.0), r) * dots * 0.35;
    } else if (kind < 2.5) {
      // Boulevard: a glowing median, white headlights one way, red tail lights the other.
      // The strip runs along x for aInfo.y = 0, along z for 1; aInfo.w is its centre line.
      bool alongX = vInfo.y < 0.5;
      float along = alongX ? vWorld.x : vWorld.z;
      float across = (alongX ? vWorld.z : vWorld.x) - vInfo.w;
      float a = abs(across);
      float fwA = fwidth(along);
      float glow = exp(-a * a / 60.0);
      float lane = smoothstep(1.6, 0.6, abs(a - 5.0));
      float dir = sign(across);
      float flow = fract(along / 14.0 + dir * uTime * 0.9 + hash(vec2(floor(along / 14.0), dir)) * 0.3);
      float car = smoothstep(0.0, 0.08, flow) * smoothstep(0.3, 0.12, flow);
      car = mix(car, 0.22, clamp(fwA / 6.0, 0.0, 1.0));
      vec3 lights = dir > 0.0 ? vec3(1.0, 0.95, 0.85) : vec3(1.0, 0.12, 0.08);
      float median = smoothstep(1.4, 0.4, a);
      float sideLamps = smoothstep(1.2, 0.4, abs(a - 11.0)) * mix(step(0.7, fract(along / 9.0)), 0.3, clamp(fwA / 4.0, 0.0, 1.0));
      col = vec3(0.05, 0.03, 0.02) + vec3(1.0, 0.6, 0.28) * (glow * 0.45 + median * 0.9 + sideLamps * 0.9) + lights * lane * car * 1.6;
    } else if (kind < 5.5) {
      col = vColor;
    } else {
      col = vColor * (0.6 + 0.4 * smoothstep(-0.2, 0.8, n.y));
    }
    float d = distance(cameraPosition, vWorld);
    float haze = smoothstep(uHazeNear, uHazeFar, d);
    col = mix(col, uHaze, haze * 0.75);
    #ifdef MIRROR
      // Dimmer, and fading the further down the reflection goes.
      col *= 0.42 * exp(-max(vWorld.y - uGround, 0.0) / 160.0);
    #endif
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

function cityMaterial(o: CityOptions, mirror = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: mirror ? { MIRROR: '' } : {},
    ...(mirror ? { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide } : {}),
    uniforms: {
      uAtlas: { value: windowAtlas() },
      uTime: cityTime,
      uGround: { value: o.ground },
      uHaze: { value: new THREE.Color(0x2a2240) },
      uHazeNear: { value: o.hazeNear },
      uHazeFar: { value: o.hazeFar },
      uMirrorY: { value: o.mirrorY ?? 0 },
    },
    vertexShader,
    fragmentShader,
    toneMapped: false,
  });
}

interface Inst {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  info: [number, number, number, number];
  color: [number, number, number];
}

const NEONS: [number, number, number][] = [
  [1.0, 0.18, 0.5],
  [0.2, 0.75, 1.0],
  [1.0, 0.68, 0.2],
  [0.65, 0.35, 1.0],
  [0.3, 1.0, 0.6],
  [1.0, 0.42, 0.15],
];

export function buildCity(o: CityOptions): City {
  let s = o.seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const G = o.ground;
  const insts: Inst[] = [];
  const cx = o.center.x,
    cz = o.center.y;

  const tower = (x: number, z: number, w: number, d: number, h: number, yaw: number, tile: number, neon: boolean) => {
    const seed = rnd();
    const col = neon ? NEONS[Math.floor(rnd() * NEONS.length)] : ([0, 0, 0] as [number, number, number]);
    insts.push({ x, y: G + h / 2, z, sx: w, sy: h, sz: d, yaw, info: [KIND.tower, tile, seed, G + h], color: col });
    // A setback tier on some taller towers.
    if (h > 45 && rnd() < 0.45) {
      const h2 = h * (0.15 + rnd() * 0.2);
      insts.push({ x, y: G + h + h2 / 2, z, sx: w * 0.62, sy: h2, sz: d * 0.7, yaw, info: [KIND.tower, tile, seed, G + h + h2], color: col });
    }
  };
  // Y-shaped resort tower: three wings round a core.
  const yTower = (x: number, z: number, h: number, yaw: number, tile: number) => {
    const col = NEONS[Math.floor(rnd() * NEONS.length)];
    const seed = rnd();
    for (let k = 0; k < 3; k++) {
      const a = yaw + (k * Math.PI * 2) / 3;
      const len = 34,
        hk = h * (1 - k * 0.08);
      insts.push({ x: x + Math.sin(a) * len * 0.5, y: G + hk / 2, z: z + Math.cos(a) * len * 0.5, sx: 14, sy: hk, sz: len, yaw: a, info: [KIND.tower, tile, seed + k, G + hk], color: col });
    }
  };
  const tileFor = (style: number) => style * 4 + Math.floor(rnd() * 4);
  const flat = (x0: number, x1: number, z0: number, z1: number) =>
    insts.push({ x: (x0 + x1) / 2, y: G - 0.5, z: (z0 + z1) / 2, sx: x1 - x0, sy: 1, sz: z1 - z0, yaw: 0, info: [KIND.ground, 0, rnd() * 50, 0], color: [0, 0, 0] });
  const boulevard = (alongX: boolean, centre: number, a0: number, a1: number) => {
    const len = a1 - a0,
      mid = (a0 + a1) / 2;
    insts.push(
      alongX
        ? { x: mid, y: G + 0.02, z: centre, sx: len, sy: 0.1, sz: 26, yaw: 0, info: [KIND.boulevard, 0, 0, centre], color: [0, 0, 0] }
        : { x: centre, y: G + 0.02, z: mid, sx: 26, sy: 0.1, sz: len, yaw: 0, info: [KIND.boulevard, 1, 0, centre], color: [0, 0, 0] },
    );
  };

  const landmarks: THREE.BufferGeometry[] = [];
  const free = (x: number, z: number, keep: [number, number, number][]) => keep.every(([kx, kz, r]) => Math.hypot(x - kx, z - kz) > r);

  if (o.layout === 'lake') {
    // The lake (|x| < 80, z -14..-86) and the resort (pool, hotel) stay clear; the ground frames the lake
    // (never under it: the fountains' reflections draw below the water line).
    const R = 335;
    // The lake (|x| < 150, z -14..-164) and the resort stay clear; the ground frames the lake
    // (never under it: reflections draw below the water line).
    const SHORE = -164;
    flat(-R, R, -R, SHORE);
    flat(-R, -150, SHORE, 70);
    flat(150, R, SHORE, 70);
    flat(66, 150, -14, 70);
    flat(-150, -20, -14, 70);
    // The boulevard along the far shore, and the Strip itself running away from the lake.
    const SX = 62;
    boulevard(true, SHORE - 9, -R, R);
    boulevard(false, SX, -R, SHORE - 9);
    boulevard(false, -170, -R, SHORE - 9);
    const lm = placeLandmarks(G, rnd, landmarks, [
      ['needle', -185, -262],
      ['crescents', -20, -232],
      ['sail', SX + 52, -214],
      ['wheel', -95, -196],
      ['dome', -262, -205],
      ['deco', SX - 46, -305],
    ], 0.66);
    const keep: [number, number, number][] = lm;
    const inRange = (x: number, z: number) => Math.hypot(x - cx, z - cz) < R;
    // Resort towers lining both sides of the Strip.
    for (const side of [-1, 1])
      for (let z = SHORE - 30; z > -R; z -= 28 + rnd() * 24) {
        const x = SX + side * (32 + rnd() * 14);
        if (!free(x, z, keep) || !inRange(x, z)) continue;
        const h = 40 + rnd() * 70;
        if (rnd() < 0.22) yTower(x + side * 10, z, h, rnd() * Math.PI, tileFor(2));
        else tower(x, z, 18 + rnd() * 24, 30 + rnd() * 26, h, 0, tileFor(rnd() < 0.5 ? 2 : rnd() < 0.5 ? 3 : 0), rnd() < 0.5);
      }
    // Along the shore boulevard.
    for (let x = -R + 20; x < R - 20; x += 20 + rnd() * 24) {
      const z = SHORE - 26 - rnd() * 18;
      if (!free(x, z, keep) || Math.abs(x - SX) < 28 || Math.abs(x + 170) < 18 || !inRange(x, z)) continue;
      tower(x, z, 16 + rnd() * 26, 14 + rnd() * 14, 16 + rnd() * 45, 0, tileFor(Math.floor(rnd() * 4)), rnd() < 0.3);
    }
    // Off-Strip: a field of lower towers further back.
    for (let k = 0; k < 300; k++) {
      const x = (rnd() * 2 - 1) * R,
        z = SHORE - 60 - rnd() * (R + SHORE);
      if (!inRange(x, z) || !free(x, z, keep) || Math.abs(x - SX) < 26 || Math.abs(x + 170) < 18) continue;
      tower(x, z, 12 + rnd() * 24, 12 + rnd() * 24, 10 + rnd() * rnd() * 70, rnd() < 0.2 ? rnd() * 0.6 : 0, tileFor(Math.floor(rnd() * 4)), rnd() < 0.12);
    }
    // East and west of the lake (seen from the pool deck and along the terrace).
    for (let k = 0; k < 140; k++) {
      const side = rnd() < 0.5 ? -1 : 1;
      const x = side * (162 + rnd() * (R - 160)),
        z = SHORE + rnd() * 230;
      if (!inRange(x, z)) continue;
      tower(x, z, 14 + rnd() * 24, 14 + rnd() * 24, 10 + rnd() * rnd() * 60, 0, tileFor(Math.floor(rnd() * 4)), rnd() < 0.15);
    }
    // A few low blocks beyond the pool deck.
    for (let k = 0; k < 18; k++) {
      const x = 84 + rnd() * 60,
        z = -6 + rnd() * 70;
      tower(x, z, 14 + rnd() * 20, 14 + rnd() * 20, 8 + rnd() * 18, 0, tileFor(Math.floor(rnd() * 4)), false);
    }
  } else {
    // From the 32nd floor: the city all round, down below and rising past the windows.
    const R0 = 120,
      R = 360;
    flat(cx - R, cx + R, cz - R, cz + R);
    boulevard(false, cx - 190, cz - R, cz + R);
    boulevard(true, cz + 150, cx - R, cx + R);
    boulevard(true, cz - 240, cx - R, cx + R);
    const lm = placeLandmarks(G, rnd, landmarks, [
      ['needle', cx + 60, cz - 300],
      ['crescents', cx - 260, cz + 40],
      ['sail', cx - 150, cz - 200],
      ['wheel', cx + 210, cz + 190],
      ['dome', cx - 120, cz + 260],
      ['deco', cx + 260, cz - 120],
    ]);
    for (let k = 0; k < 420; k++) {
      const a = rnd() * Math.PI * 2,
        r = R0 + Math.sqrt(rnd()) * (R - R0 - 20);
      const x = cx + Math.cos(a) * r,
        z = cz + Math.sin(a) * r;
      if (!free(x, z, lm) || Math.abs(x - (cx - 190)) < 22 || Math.abs(z - (cz + 150)) < 22 || Math.abs(z - (cz - 240)) < 22) continue;
      const tall = rnd() < 0.25;
      const h = tall ? 90 + rnd() * 150 : 14 + rnd() * rnd() * 90;
      if (tall && rnd() < 0.2) yTower(x, z, h, rnd() * Math.PI, tileFor(2));
      else tower(x, z, 14 + rnd() * 30, 14 + rnd() * 30, h, rnd() < 0.25 ? rnd() * 0.8 : 0, tileFor(Math.floor(rnd() * 4)), tall ? rnd() < 0.6 : rnd() < 0.1);
    }
  }

  const mat = cityMaterial(o);
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.deleteAttribute('uv');
  const mesh = new THREE.InstancedMesh(box, mat, insts.length);
  const info = new Float32Array(insts.length * 4);
  const color = new Float32Array(insts.length * 3);
  const m4 = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    up = new THREE.Vector3(0, 1, 0);
  insts.forEach((it, i) => {
    q.setFromAxisAngle(up, it.yaw);
    m4.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.sx, it.sy, it.sz));
    mesh.setMatrixAt(i, m4);
    info.set(it.info, i * 4);
    color.set(it.color, i * 3);
  });
  box.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4));
  box.setAttribute('aColor', new THREE.InstancedBufferAttribute(color, 3));
  mesh.computeBoundingSphere();
  mesh.name = 'city';

  const group = new THREE.Group();
  group.name = o.name ?? 'skyline';
  group.add(mesh);
  const lmGeo = landmarks.length ? mergeGeometries(landmarks) : null;
  if (lmGeo) {
    const lm = new THREE.Mesh(lmGeo, mat);
    lm.name = 'landmarks';
    group.add(lm);
  }
  if (o.mirrorY !== undefined) {
    const mm = cityMaterial(o, true);
    const refl = new THREE.InstancedMesh(box, mm, insts.length);
    refl.instanceMatrix = mesh.instanceMatrix;
    refl.count = mesh.count;
    // Bounds cover the city and its reflection.
    refl.boundingSphere = mesh.boundingSphere!.clone();
    refl.boundingSphere.radius *= 1.5;
    refl.renderOrder = 2;
    refl.name = 'city-reflection';
    group.add(refl);
    if (lmGeo) {
      const lr = new THREE.Mesh(lmGeo, mm);
      lr.frustumCulled = false;
      lr.renderOrder = 2;
      lr.name = 'landmark-reflection';
      group.add(lr);
    }
  }
  // Never merged into the static batches (they keep only position/normal/uv), never picked.
  group.userData.dynamic = true;
  group.traverse((c) => {
    c.userData.dynamic = true;
    c.raycast = () => {};
    c.matrixAutoUpdate = false;
    c.updateMatrix();
  });
  return {
    group,
    update(t: number) {
      cityTime.value = t;
    },
  };
}

/** Tags a geometry with the city attributes and moves it into place. */
function part(geo: THREE.BufferGeometry, kind: number, color: [number, number, number], tile = 0, seed = 0, top = 0): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const n = g.attributes.position.count;
  const info = new Float32Array(n * 4),
    col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    info.set([kind, tile, seed, top], i * 4);
    col.set(color, i * 3);
  }
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Extrudes a plan shape (x, z) up from y0 by h. */
function extrudeUp(shape: THREE.Shape, y0: number, h: number, x: number, z: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 24 });
  g.rotateX(-Math.PI / 2);
  g.translate(x, y0, z);
  return g;
}

type LandmarkName = 'needle' | 'crescents' | 'sail' | 'wheel' | 'dome' | 'deco';

/** Adds the landmark silhouettes; returns keep-out circles for the generic towers. */
function placeLandmarks(G: number, rnd: () => number, all: THREE.BufferGeometry[], list: [LandmarkName, number, number][], scale = 1): [number, number, number][] {
  const keep: [number, number, number][] = [];
  const dark: [number, number, number] = [0.025, 0.022, 0.035];
  for (const [name, x, z] of list) {
    const out: THREE.BufferGeometry[] = [];
    if (name === 'needle') {
      // A slender observation tower: tapering shaft, a lit three-tier pod, a spire with a beacon.
      out.push(part(new THREE.CylinderGeometry(4, 9, 220, 12).translate(x, G + 110, z), KIND.solid, dark));
      for (const [y, r, h] of [[200, 15, 9], [209, 18, 7], [216, 13, 6]] as const)
        out.push(part(new THREE.CylinderGeometry(r, r * 0.92, h, 24).translate(x, G + y + h / 2, z), KIND.facade, [1, 1, 1], 2 * 4 + 1, 0.3, 0));
      out.push(part(new THREE.TorusGeometry(18.4, 0.7, 6, 40).rotateX(Math.PI / 2).translate(x, G + 209.5, z), KIND.neon, [0.3, 0.85, 1.4]));
      out.push(part(new THREE.CylinderGeometry(0.4, 1.6, 46, 6).translate(x, G + 245, z), KIND.solid, [0.06, 0.06, 0.08]));
      out.push(part(new THREE.SphereGeometry(1.6, 8, 6).translate(x, G + 269, z), KIND.neon, [2.0, 0.2, 0.15]));
      // Light strips up the shaft.
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        out.push(part(new THREE.BoxGeometry(0.9, 196, 0.9).translate(x + Math.cos(a) * 6.6, G + 100, z + Math.sin(a) * 6.6), KIND.neon, [1.1, 0.75, 0.4]));
      }
      keep.push([x, z, 34]);
    } else if (name === 'crescents') {
      // Two curved slab towers facing each other across a forecourt.
      for (const [dir, h] of [[1, 150], [-1, 128]] as const) {
        const sh = new THREE.Shape();
        const R = 64,
          T = 15,
          a0 = -0.6,
          a1 = 0.6;
        sh.absarc(0, 0, R, a0, a1, false);
        sh.absarc(0, 0, R - T, a1, a0, true);
        const g = extrudeUp(sh, G, h, 0, 0);
        g.rotateY(dir > 0 ? 0 : Math.PI);
        g.translate(x - dir * 48, 0, z);
        out.push(part(g, KIND.facade, [1, 1, 1], 3 * 4 + (dir > 0 ? 0 : 2), 0.5 + dir * 0.2, 0));
        const cap = extrudeUp(sh, G + h, 2.4, 0, 0);
        cap.rotateY(dir > 0 ? 0 : Math.PI);
        cap.translate(x - dir * 48, 0, z);
        out.push(part(cap, KIND.neon, [1.6, 1.05, 0.45]));
      }
      keep.push([x, z, 70]);
    } else if (name === 'sail') {
      // A glass tower whose plan is a curved sail; its spine glows.
      const sh = new THREE.Shape();
      sh.moveTo(-22, -14);
      sh.quadraticCurveTo(4, -22, 26, 6);
      sh.quadraticCurveTo(0, 2, -22, 14);
      sh.closePath();
      out.push(part(extrudeUp(sh, G, 178, x, z), KIND.facade, [1, 1, 1], 1 * 4 + 2, 0.7, 0));
      out.push(part(new THREE.BoxGeometry(1.2, 190, 1.2).translate(x - 22, G + 95, z), KIND.neon, [0.7, 0.9, 1.6]));
      out.push(part(new THREE.ConeGeometry(4, 26, 6).translate(x + 4, G + 191, z), KIND.solid, [0.08, 0.08, 0.1]));
      keep.push([x, z, 40]);
    } else if (name === 'wheel') {
      // An observation wheel by the shore, its rim and spokes outlined in light.
      const r = 46,
        hub = G + r + 10;
      out.push(part(new THREE.TorusGeometry(r, 1.3, 6, 72).translate(x, hub, z), KIND.neon, [1.5, 0.3, 0.9]));
      out.push(part(new THREE.TorusGeometry(r - 4, 0.6, 4, 72).translate(x, hub, z), KIND.neon, [0.9, 0.25, 1.2]));
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const sp = new THREE.BoxGeometry(0.8, r, 0.8);
        sp.translate(0, r / 2, 0);
        sp.rotateZ(a);
        sp.translate(x, hub, z);
        out.push(part(sp, KIND.neon, [0.85, 0.55, 1.1]));
        out.push(part(new THREE.BoxGeometry(3, 2.6, 3).translate(x + Math.sin(-a) * (r + 2.4), hub + Math.cos(a) * (r + 2.4), z), KIND.neon, [1.4, 1.25, 1.0]));
      }
      for (const s of [-1, 1]) {
        const leg = new THREE.BoxGeometry(2, (r + 12) * 1.08, 2);
        leg.translate(0, -(r + 12) * 0.54, 0);
        leg.rotateZ(s * 0.38);
        leg.translate(x, hub, z + 3);
        out.push(part(leg, KIND.solid, [0.1, 0.08, 0.12]));
      }
      keep.push([x, z, 40]);
    } else if (name === 'dome') {
      // A broad round hotel crowned by a dome with a gilt ring.
      out.push(part(new THREE.CylinderGeometry(30, 32, 108, 32, 1, true).translate(x, G + 54, z), KIND.facade, [1, 1, 1], 0 * 4 + 3, 0.2, 0));
      out.push(part(new THREE.SphereGeometry(30, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, G + 108, z), KIND.solid, [0.12, 0.09, 0.06]));
      out.push(part(new THREE.TorusGeometry(30.4, 0.9, 6, 48).rotateX(Math.PI / 2).translate(x, G + 108.5, z), KIND.neon, [1.7, 1.15, 0.5]));
      out.push(part(new THREE.CylinderGeometry(2.4, 3, 10, 12).translate(x, G + 143, z), KIND.neon, [1.6, 1.2, 0.7]));
      keep.push([x, z, 42]);
    } else {
      // A stepped deco tower with a lit pyramidal crown.
      let y = G;
      for (const [w, h] of [[46, 96], [34, 54], [24, 34]] as const) {
        out.push(part(new THREE.BoxGeometry(w, h, w).translate(x, y + h / 2, z), KIND.facade, [1, 1, 1], 3 * 4 + 1, rnd(), 0));
        out.push(part(new THREE.BoxGeometry(w + 0.6, 1.2, w + 0.6).translate(x, y + h, z), KIND.neon, [1.6, 1.1, 0.5]));
        y += h;
      }
      out.push(part(new THREE.ConeGeometry(16, 30, 4).rotateY(Math.PI / 4).translate(x, y + 15, z), KIND.neon, [0.9, 0.62, 0.25]));
      out.push(part(new THREE.CylinderGeometry(0.3, 0.8, 20, 6).translate(x, y + 40, z), KIND.solid, [0.1, 0.1, 0.12]));
      keep.push([x, z, 40]);
    }
    // Scale each landmark about its foot (the lake view is seen from closer than the suite's).
    const m = new THREE.Matrix4().makeTranslation(x, G, z).multiply(new THREE.Matrix4().makeScale(scale, scale, scale)).multiply(new THREE.Matrix4().makeTranslation(-x, -G, -z));
    for (const g of out) all.push(scale === 1 ? g : g.applyMatrix4(m));
    keep[keep.length - 1][2] *= scale;
  }
  return keep;
}
