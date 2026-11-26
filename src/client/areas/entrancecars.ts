import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvas } from '../textures';
import { blinkOn, CAR, DOOR, FLEETS, type CarKind } from './entranceplan';
import type { SimCar, Traffic } from './entrancetraffic';

/**
 * The driveway's cars: low-poly but finished (bevelled body, glass you can see
 * the guests through, seats, wheels, mirrors), one merged mesh per car type,
 * instanced, so every car on the driveway costs a handful of draws:
 *
 *   body ×4 types (sedan, SUV, two cab fleets) + glass ×4, the opening rear
 *   doors (panel + glass), contact shadows and the head/tail light pools.
 *
 * Lights are emissive only (no real lights): each vertex says which part it is
 * (paint, headlight, tail light, indicator, windshield sign, roof sign, door
 * lettering) and each car instance carries its paint, lamp state (lights,
 * brake, left/right blink) and sign colour; a few lines added to the standard
 * shader turn those into colour and glow.
 */

/** Vertex part ids. */
const P = { fixed: 0, paint: 1, head: 2, tail: 3, indL: 4, indR: 5, sign: 6, roof: 7, decal: 8 } as const;

interface Dims {
  len: number;
  wid: number;
  /** Underbody, beltline and roof heights. */
  floor: number;
  belt: number;
  roof: number;
  /** Windshield base (z), roof front, roof back, rear window base. */
  wsBase: number;
  roofF: number;
  roofB: number;
  rwBase: number;
  /** Hood front height, trunk/tailgate top. */
  nose: number;
  tail: number;
  wheelR: number;
  wheelZ: number;
}

const SEDAN: Dims = { len: CAR.len, wid: CAR.wid, floor: 0.3, belt: 0.98, roof: 1.46, wsBase: 0.95, roofF: 0.22, roofB: -0.98, rwBase: -1.7, nose: 0.72, tail: 0.98, wheelR: 0.34, wheelZ: 1.48 };
const SUV: Dims = { len: CAR.len + 0.05, wid: CAR.wid + 0.06, floor: 0.38, belt: 1.1, roof: 1.78, wsBase: 1.05, roofF: 0.38, roofB: -1.95, rwBase: -2.2, nose: 0.92, tail: 1.1, wheelR: 0.39, wheelZ: 1.5 };

/** The mesh each car kind is drawn with (the valet's car is a black sedan). */
type MeshKind = 'sedan' | 'suv' | 'taxiY' | 'taxiBW';
const MESH_OF: Record<CarKind, MeshKind> = { sedan: 'sedan', lux: 'sedan', suv: 'suv', taxiY: 'taxiY', taxiBW: 'taxiBW' };
const PAINT: Partial<Record<CarKind, number>> = { taxiY: 0xf2b300, taxiBW: 0x111214 };
/** Taxis are painted by fleet; the black-and-white fleet's doors are white. */
const DOOR_PAINT: Partial<Record<CarKind, number>> = { taxiBW: 0xf2f0ea };

const MAX_PER_KIND = 9;
const SUV_DOOR = new THREE.Vector3(1, (SUV.roof - 0.02 - SUV.floor) / (SEDAN.roof - 0.02 - SEDAN.floor), 1);
const MAX_CARS = 4 * MAX_PER_KIND;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Collects parts with a colour, a part id and decal UVs (one merged geometry). */
class CarBatch {
  parts: THREE.BufferGeometry[] = [];
  add(geo: THREE.BufferGeometry, part: number, color: number, m?: THREE.Matrix4, decal?: (u: number, v: number, i: number) => [number, number]) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()) as THREE.BufferGeometry;
    if (m) g.applyMatrix4(m);
    const n = g.attributes.position.count;
    const c = new THREE.Color(color);
    const col = new Float32Array(n * 3);
    const pa = new Float32Array(n);
    const dc = new Float32Array(n * 2);
    const uv = g.attributes.uv as THREE.BufferAttribute | undefined;
    for (let i = 0; i < n; i++) {
      col.set([c.r, c.g, c.b], i * 3);
      pa[i] = part;
      if (decal && uv) dc.set(decal(uv.getX(i), uv.getY(i), i), i * 2);
    }
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aPart', new THREE.BufferAttribute(pa, 1));
    g.setAttribute('aDecal', new THREE.BufferAttribute(dc, 2));
    this.parts.push(g);
  }
  box(part: number, color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0)), new THREE.Vector3(1, 1, 1));
    this.add(new THREE.BoxGeometry(sx, sy, sz), part, color, m);
  }
  /** A bar between two points (pillars), `t` thick. */
  bar(part: number, color: number, a: THREE.Vector3, b: THREE.Vector3, t: number) {
    const d = b.clone().sub(a);
    const g = new THREE.BoxGeometry(t, d.length(), t);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    this.add(g, part, color, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  }
  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts)!;
    this.parts.forEach((p) => p.dispose());
    g.computeBoundingSphere();
    return g;
  }
}

/** A side profile (z, y) extruded across the car's width (centred on x = 0). */
function extrude(profile: [number, number][], width: number, bevel = 0.045): THREE.BufferGeometry {
  const s = new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: width - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -(width - 2 * bevel) / 2);
  // Shape x → car z, shape y → car y, extrusion → car x.
  g.rotateY(-Math.PI / 2);
  return g;
}

/** A flat quad from four corners (counter-clockwise seen from its front). */
function quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([a, b, c, a, c, d].flatMap((v) => [v.x, v.y, v.z]), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
  g.computeVertexNormals();
  return g;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** The greenhouse's corners at the belt (half width hb) and the roof (half width hr). */
function cabin(d: Dims) {
  const hb = d.wid / 2 - 0.06,
    hr = d.wid / 2 - 0.2;
  return { hb, hr };
}

/** The decal atlas: roof signs and fleet lettering (all made-up names). */
function decalAtlas(): THREE.CanvasTexture {
  const W = 1024,
    H = 512;
  const [c, g] = canvas(W, H);
  g.clearRect(0, 0, W, H);
  // Row 0 (y 0–128): the yellow cabs' roof sign; row 1: the black-and-whites'.
  const roof = (y: number, bg: string, fg: string, sub: string) => {
    g.fillStyle = bg;
    g.fillRect(0, y, W, 128);
    g.fillStyle = fg;
    g.font = 'bold 92px Arial, Helvetica, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('TAXI', W * 0.3, y + 66);
    g.font = 'bold 44px Arial, Helvetica, sans-serif';
    g.fillText(sub, W * 0.72, y + 66);
  };
  roof(0, '#fff3c8', '#1a1206', 'LANTERN');
  roof(128, '#f4f6ff', '#0c0e14', 'NEON MESA');
  // Rows 2, 3: door lettering (transparent around it).
  const door = (y: number, f: { name: string; sub: string; phone: string }, fg: string, checker: boolean) => {
    if (checker) {
      for (let i = 0; i < 32; i++) for (let r = 0; r < 2; r++) {
        g.fillStyle = (i + r) % 2 ? '#111214' : '#f2f0ea';
        g.fillRect(i * 32, y + r * 14, 32, 14);
      }
    }
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 54px Arial, Helvetica, sans-serif';
    g.fillText(f.name, W / 2, y + 58);
    g.font = 'bold 30px Arial, Helvetica, sans-serif';
    g.fillText(`${f.sub}  ·  ${f.phone}`, W / 2, y + 104);
  };
  door(256, FLEETS.taxiY, '#14100a', false);
  door(384, FLEETS.taxiBW, '#111214', true);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Builds one car type's body (everything but its glass and the curb-side rear door). */
function carBody(kind: MeshKind): { body: THREE.BufferGeometry; glass: THREE.BufferGeometry } {
  const d = kind === 'suv' ? SUV : SEDAN;
  const taxi = kind === 'taxiY' || kind === 'taxiBW';
  const b = new CarBatch();
  const L = d.len / 2,
    W = d.wid;
  const hw = W / 2;
  const trim = 0x141416,
    chrome = 0xb8bcc2,
    tyre = 0x0c0c0d,
    cloth = 0x26201c,
    dash = 0x15130f;
  const white = 0xffffff;
  // Hood and nose.
  b.add(
    extrude(
      [
        [d.wsBase, d.floor],
        [L - 0.06, d.floor],
        [L, d.floor + 0.16],
        [L, d.nose - 0.06],
        [L - 0.2, d.nose + 0.08],
        [d.wsBase, d.belt],
      ],
      W,
    ),
    P.paint,
    white,
  );
  // Trunk (or the SUV's tailgate).
  b.add(
    extrude(
      [
        [-L + 0.06, d.floor],
        [d.rwBase, d.floor],
        [d.rwBase, d.belt + 0.02],
        [-L + 0.16, d.tail],
        [-L, d.tail - 0.14],
        [-L, d.floor + 0.18],
      ],
      W,
    ),
    P.paint,
    white,
  );
  // The tub: floor pan, sills and the side walls (the curb side leaves the rear door's opening).
  const wallT = 0.07;
  const zF = d.wsBase,
    zR = d.rwBase;
  const hinge = DOOR.hinge,
    doorEnd = DOOR.hinge - DOOR.len;
  b.box(P.fixed, 0x1a1714, 0, d.floor + 0.02, (zF + zR) / 2, W - 0.1, 0.04, zF - zR);
  const wall = (x: number, z0: number, z1: number) => b.box(P.paint, white, x, (d.floor + d.belt) / 2, (z0 + z1) / 2, wallT, d.belt - d.floor, z1 - z0);
  wall(hw - wallT / 2, zR, zF);
  wall(-hw + wallT / 2, hinge, zF);
  wall(-hw + wallT / 2, zR, doorEnd);
  // The opening's dark frame (seen when the door swings out).
  b.box(P.fixed, 0x0e0c0b, -hw + 0.05, d.floor + 0.06, (hinge + doorEnd) / 2, 0.1, 0.08, DOOR.len);
  // Sill trim and bumpers.
  for (const s of [-1, 1]) b.box(P.fixed, trim, s * (hw - 0.01), d.floor + 0.03, 0, 0.03, 0.08, d.len - 0.7);
  b.box(P.fixed, trim, 0, d.floor + 0.1, L + 0.01, W - 0.18, 0.18, 0.08);
  b.box(P.fixed, trim, 0, d.floor + 0.1, -L - 0.01, W - 0.18, 0.18, 0.08);
  // Grille, plates.
  b.box(P.fixed, kind === 'suv' ? 0x2a2c30 : trim, 0, d.nose - 0.18, L + 0.005, W * 0.46, 0.16, 0.03);
  b.box(P.fixed, 0xe8e6dc, 0, d.floor + 0.24, -L - 0.02, 0.34, 0.12, 0.02);
  // Lamps: headlights, tail lights, indicators at the corners (left = +x, the driver's side).
  for (const s of [-1, 1]) {
    b.box(P.head, 0xdfe6ee, s * (hw - 0.25), d.nose - 0.08, L - 0.02, 0.34, 0.09, 0.05);
    b.box(s > 0 ? P.indL : P.indR, 0x8a5a20, s * (hw - 0.05), d.nose - 0.08, L - 0.06, 0.06, 0.08, 0.1);
    b.box(P.tail, 0x5a0c0c, s * (hw - 0.22), d.tail - 0.12, -L - 0.01, 0.36, 0.1, 0.05);
    b.box(s > 0 ? P.indL : P.indR, 0x8a5a20, s * (hw - 0.04), d.tail - 0.12, -L + 0.02, 0.06, 0.1, 0.08);
  }
  // Wheels: tyre and hub.
  const tyreG = new THREE.CylinderGeometry(d.wheelR, d.wheelR, 0.24, 14).rotateZ(Math.PI / 2);
  const hubG = new THREE.CylinderGeometry(d.wheelR * 0.62, d.wheelR * 0.62, 0.02, 10).rotateZ(Math.PI / 2);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      b.add(tyreG, P.fixed, tyre, new THREE.Matrix4().makeTranslation(sx * (hw - 0.14), d.wheelR, sz * d.wheelZ));
      b.add(hubG, P.fixed, chrome, new THREE.Matrix4().makeTranslation(sx * (hw - 0.01), d.wheelR, sz * d.wheelZ));
      // Dark wheel arch over it.
      b.box(P.fixed, 0x0a0a0b, sx * (hw - 0.02), d.wheelR + 0.08, sz * d.wheelZ, 0.04, 0.18, d.wheelR * 2.1);
    }
  // Greenhouse: roof panel and pillars (paint), glass panes (their own mesh).
  const { hb, hr } = cabin(d);
  b.box(P.paint, white, 0, d.roof + 0.02, (d.roofF + d.roofB) / 2, hr * 2 + 0.06, 0.05, d.roofF - d.roofB + 0.08);
  const pil = 0.07;
  const post = kind === 'suv' ? 0x101012 : -1;
  const pc = post >= 0 ? P.fixed : P.paint;
  const pcol = post >= 0 ? post : white;
  for (const s of [-1, 1]) {
    // A, B and C pillars, and the rail along the roof.
    b.bar(pc, pcol, V(s * hb, d.belt, d.wsBase), V(s * hr, d.roof, d.roofF), pil);
    b.bar(pc, pcol, V(s * hb, d.belt, hinge), V(s * hr, d.roof, hinge), pil);
    b.bar(pc, pcol, V(s * hb, d.belt, d.rwBase), V(s * hr, d.roof, d.roofB), pil);
    b.bar(pc, pcol, V(s * hr, d.roof, d.roofF), V(s * hr, d.roof, d.roofB), pil * 0.8);
    // Mirror.
    b.box(P.paint, white, s * (hw + 0.1), d.belt + 0.08, d.wsBase - 0.15, 0.16, 0.1, 0.07);
  }
  // Inside: seats, the dash, the wheel, the windshield sign (rideshare) on the passenger side.
  const seatY = d.floor + 0.18;
  b.box(P.fixed, cloth, 0, seatY, -0.62, W - 0.3, 0.16, 0.56);
  b.box(P.fixed, cloth, 0, seatY + 0.3, -0.98, W - 0.3, 0.55, 0.14, -0.18);
  for (const s of [-1, 1]) {
    b.box(P.fixed, cloth, s * 0.42, seatY, 0.38, 0.52, 0.16, 0.5);
    b.box(P.fixed, cloth, s * 0.42, seatY + 0.34, 0.08, 0.5, 0.62, 0.12, -0.15);
    b.box(P.fixed, cloth, s * 0.42, seatY + 0.72, 0.04, 0.26, 0.14, 0.1, -0.15);
  }
  b.box(P.fixed, dash, 0, d.belt - 0.06, d.wsBase - 0.2, W - 0.16, 0.16, 0.42);
  b.add(new THREE.TorusGeometry(0.17, 0.022, 6, 14), P.fixed, 0x0c0c0c, new THREE.Matrix4().compose(V(0.42, d.belt + 0.04, d.wsBase - 0.42), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.45, 0, 0)), V(1, 1, 1)));
  if (!taxi) b.box(P.sign, 0x222222, -0.45, d.belt + 0.06, d.wsBase - 0.12, 0.28, 0.09, 0.012, -0.5);
  // Taxis: the roof sign (lit while for hire) and the fleet's lettering on the front doors.
  if (taxi) {
    const row = kind === 'taxiY' ? 0 : 1;
    const roofSign = new THREE.BoxGeometry(0.82, 0.2, 0.3);
    b.add(roofSign, P.roof, white, new THREE.Matrix4().makeTranslation(0, d.roof + 0.15, -0.3), (u, v, i) => {
      // Faces: the long sides (±z, front and back) carry the sign; the rest takes the sign's plain edge.
      const face = Math.floor(i / 6);
      if (face === 4 || face === 5) return [0.04 + u * 0.92, 1 - (row + 1 - v) / 4];
      return [0.02, 1 - (row + 0.1) / 4];
    });
    const lrow = kind === 'taxiY' ? 2 : 3;
    for (const s of [-1, 1]) {
      const x = s * (hw + 0.004);
      const z0 = d.wsBase - 0.08,
        z1 = hinge + 0.06;
      const y0 = d.belt - 0.25,
        y1 = d.belt - 0.06;
      // Wound so the outer side is the quad's front, the lettering reading front to back on both sides.
      const q = s > 0 ? quad(V(x, y0, z0), V(x, y0, z1), V(x, y1, z1), V(x, y1, z0)) : quad(V(x, y0, z1), V(x, y0, z0), V(x, y1, z0), V(x, y1, z1));
      b.add(q, P.decal, kind === 'taxiBW' ? 0xf2f0ea : PAINT.taxiY!, undefined, (u, v) => [0.08 + u * 0.84, 1 - (lrow + 1 - v) / 4]);
    }
  }
  const body = b.build();

  // Glass: windshield, back light, the side windows (not the curb-side rear one: that's in the door).
  const glass: THREE.BufferGeometry[] = [];
  const wsL = V(hb - 0.03, d.belt, d.wsBase),
    wsR = V(-hb + 0.03, d.belt, d.wsBase),
    rfL = V(hr, d.roof, d.roofF),
    rfR = V(-hr, d.roof, d.roofF);
  glass.push(quad(wsR, wsL, rfL, rfR));
  const rwL = V(hb - 0.03, d.belt, d.rwBase),
    rwR = V(-hb + 0.03, d.belt, d.rwBase),
    rbL = V(hr, d.roof, d.roofB),
    rbR = V(-hr, d.roof, d.roofB);
  glass.push(quad(rwL, rwR, rbR, rbL));
  for (const s of [-1, 1]) {
    const x0 = s * hb,
      x1 = s * hr;
    const front = [V(x0, d.belt, d.wsBase), V(x0, d.belt, hinge), V(x1, d.roof, hinge), V(x1, d.roof, d.roofF)];
    const rear = [V(x0, d.belt, hinge), V(x0, d.belt, d.rwBase), V(x1, d.roof, d.roofB), V(x1, d.roof, hinge)];
    for (const pts of s > 0 ? [front, rear] : [front]) glass.push(s > 0 ? quad(pts[1], pts[0], pts[3], pts[2]) : quad(pts[0], pts[1], pts[2], pts[3]));
    if (s < 0) {
      // Behind the curb-side door: the quarter glass.
      glass.push(quad(V(x0, d.belt, doorEnd), V(x0, d.belt, d.rwBase), V(x1, d.roof, d.roofB), V(x1, d.roof, Math.max(d.roofB, doorEnd + 0.1))));
    }
  }
  const g = mergeGeometries(glass)!;
  return { body, glass: g };
}

/** The curb-side rear door: its panel (paint) and its window, in the hinge's frame (door runs toward −z). */
function doorParts(d: Dims): { panel: THREE.BufferGeometry; glass: THREE.BufferGeometry } {
  const b = new CarBatch();
  const { hb, hr } = cabin(d);
  const hw = d.wid / 2;
  const t = 0.07;
  const len = DOOR.len;
  // Panel (its outer face flush with the body side, the hinge's x), a handle, the window frame.
  b.box(P.paint, 0xffffff, t / 2, (d.floor + d.belt) / 2 + 0.02, -len / 2, t, d.belt - d.floor - 0.02, len - 0.02);
  b.box(P.fixed, 0xb8bcc2, -0.01, d.belt - 0.14, -len + 0.2, 0.02, 0.035, 0.16);
  // Inside trim (seen once it's open).
  b.box(P.fixed, 0x2a2320, t + 0.005, (d.floor + d.belt) / 2, -len / 2, 0.02, d.belt - d.floor - 0.1, len - 0.08);
  // The window leans in with the greenhouse.
  const x0 = hw - hb,
    x1 = hw - hr;
  const top = d.roof - 0.02;
  b.bar(P.fixed, 0x111112, V(x0, d.belt, -len + 0.02), V(x1, top, -len + 0.12), 0.04);
  b.bar(P.fixed, 0x111112, V(x1, top, -0.02), V(x1, top, -len + 0.12), 0.035);
  const panel = b.build();
  const g = quad(V(x0, d.belt, -len + 0.03), V(x0, d.belt, -0.02), V(x1, top, -0.02), V(x1, top, -len + 0.12));
  return { panel, glass: g };
}

// ---------------------------------------------------------------------------
// Material: the standard material plus parts and per-car state
// ---------------------------------------------------------------------------

function carMaterial(decal: THREE.Texture | null): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.45, envMapIntensity: 1.25 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDecal = { value: decal };
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aPart;
attribute vec2 aDecal;
attribute vec3 aPaint;
attribute vec4 aLamp;
attribute vec4 aSign;
varying float vPart;
varying vec2 vDecal;
varying vec3 vPaint;
varying vec4 vLamp;
varying vec4 vSign;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vPart = aPart; vDecal = aDecal; vPaint = aPaint; vLamp = aLamp; vSign = aSign;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uDecal;
varying float vPart;
varying vec2 vDecal;
varying vec3 vPaint;
varying vec4 vLamp;
varying vec4 vSign;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float part = floor(vPart + 0.5);
vec3 carGlow = vec3(0.0);
float carRough = -1.0;
if (part == 1.0) { diffuseColor.rgb *= vPaint; carRough = 0.22; }
else if (part == 2.0) { carGlow = vec3(1.0, 0.95, 0.86) * (0.35 + 2.6 * vLamp.x); }
else if (part == 3.0) { carGlow = vec3(1.0, 0.05, 0.03) * (0.5 * vLamp.x + 2.6 * vLamp.y); }
else if (part == 4.0) { carGlow = vec3(1.0, 0.52, 0.06) * 3.2 * vLamp.z; }
else if (part == 5.0) { carGlow = vec3(1.0, 0.52, 0.06) * 3.2 * vLamp.w; }
else if (part == 6.0) { carGlow = vSign.rgb * 2.4 * vSign.w; diffuseColor.rgb = mix(diffuseColor.rgb, vSign.rgb, vSign.w); }
else if (part == 7.0 || part == 8.0) {
  vec4 dc = texture2D(uDecal, vDecal);
  diffuseColor.rgb = part == 7.0 ? dc.rgb : mix(diffuseColor.rgb, dc.rgb, dc.a);
  if (part == 7.0) carGlow = dc.rgb * (0.15 + 1.5 * vSign.w);
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
if (carRough > 0.0) roughnessFactor = carRough;
if (part >= 2.0 && part <= 7.0) roughnessFactor = 0.25;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += carGlow;`,
      );
  };
  mat.customProgramCacheKey = () => 'entrance-car';
  return mat;
}

function glassMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x0b1118, transparent: true, opacity: 0.5, roughness: 0.04, metalness: 0.2, envMapIntensity: 1.6, depthWrite: false, side: THREE.DoubleSide });
}

/** A soft dark oval under a car (its contact shadow). */
function shadowTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 256);
  const grd = g.createRadialGradient(64, 128, 10, 64, 128, 128);
  grd.addColorStop(0, 'rgba(0,0,0,0.75)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.5)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.save();
  g.scale(1, 1);
  g.fillRect(0, 0, 128, 256);
  g.restore();
  return new THREE.CanvasTexture(c);
}

/** A light pool on the pavement (headlights ahead, a red glow behind). */
function poolTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 40, 4, 64, 64, 70);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// ---------------------------------------------------------------------------
// The fleet on screen
// ---------------------------------------------------------------------------

interface KindMesh {
  body: THREE.InstancedMesh;
  glass: THREE.InstancedMesh;
  paint: THREE.InstancedBufferAttribute;
  lamp: THREE.InstancedBufferAttribute;
  sign: THREE.InstancedBufferAttribute;
  dims: Dims;
}

export class CarFleet {
  readonly group = new THREE.Group();
  private kinds = new Map<MeshKind, KindMesh>();
  private doorPanel: THREE.InstancedMesh;
  private doorGlass: THREE.InstancedMesh;
  private doorPaint: THREE.InstancedBufferAttribute;
  private shadows: THREE.InstancedMesh;
  private pools: THREE.InstancedMesh;
  /** Each car's door angle (eased), by key. */
  readonly doorAngle = new Map<string, number>();
  private m = new THREE.Matrix4();
  private m2 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);
  private c = new THREE.Color();
  /** Fully open (radians). */
  static readonly OPEN = 1.15;

  constructor() {
    this.group.name = 'entrance-cars';
    const decal = decalAtlas();
    const bodyMat = carMaterial(decal);
    const glassMat = glassMaterial();
    for (const kind of ['sedan', 'suv', 'taxiY', 'taxiBW'] as MeshKind[]) {
      const { body, glass } = carBody(kind);
      const paint = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_KIND * 3), 3);
      const lamp = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_KIND * 4), 4);
      const sign = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_KIND * 4), 4);
      for (const a of [paint, lamp, sign]) a.setUsage(THREE.DynamicDrawUsage);
      body.setAttribute('aPaint', paint);
      body.setAttribute('aLamp', lamp);
      body.setAttribute('aSign', sign);
      const bm = new THREE.InstancedMesh(body, bodyMat, MAX_PER_KIND);
      const gm = new THREE.InstancedMesh(glass, glassMat, MAX_PER_KIND);
      gm.instanceMatrix = bm.instanceMatrix;
      for (const x of [bm, gm]) {
        x.count = 0;
        x.frustumCulled = false;
        x.raycast = () => {};
        x.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      }
      gm.renderOrder = 3;
      bm.name = `cars-${kind}`;
      this.group.add(bm, gm);
      this.kinds.set(kind, { body: bm, glass: gm, paint, lamp, sign, dims: kind === 'suv' ? SUV : SEDAN });
    }
    // Doors: one shape (sized for both bodies' openings), placed at each car's hinge.
    const door = doorParts(SEDAN);
    const dp = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARS * 3), 3);
    dp.setUsage(THREE.DynamicDrawUsage);
    door.panel.setAttribute('aPaint', dp);
    door.panel.setAttribute('aLamp', new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARS * 4), 4));
    door.panel.setAttribute('aSign', new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARS * 4), 4));
    this.doorPaint = dp;
    this.doorPanel = new THREE.InstancedMesh(door.panel, bodyMat, MAX_CARS);
    this.doorGlass = new THREE.InstancedMesh(door.glass, glassMat, MAX_CARS);
    this.doorGlass.instanceMatrix = this.doorPanel.instanceMatrix;
    this.doorGlass.renderOrder = 3;
    // Contact shadows and light pools: one quad shape each, in the car's frame.
    const shadowGeo = new THREE.PlaneGeometry(2.5, 5.6).rotateX(-Math.PI / 2).translate(0, 0.012, 0);
    this.shadows = new THREE.InstancedMesh(shadowGeo, new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }), MAX_CARS);
    const poolTex = poolTexture();
    const head = new THREE.PlaneGeometry(3.6, 7).rotateX(-Math.PI / 2).translate(0, 0.016, 2.4 + 3.3);
    const tail = new THREE.PlaneGeometry(2.4, 2.2).rotateX(-Math.PI / 2).rotateY(Math.PI).translate(0, 0.016, -2.4 - 0.9);
    const colorOf = (g: THREE.BufferGeometry, c: number) => {
      const col = new THREE.Color(c);
      const a = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < a.length; i += 3) a.set([col.r, col.g, col.b], i);
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return g;
    };
    const poolGeo = mergeGeometries([colorOf(head, 0x6a6150), colorOf(tail, 0x5a0806)])!;
    this.pools = new THREE.InstancedMesh(poolGeo, new THREE.MeshBasicMaterial({ map: poolTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), MAX_CARS);
    for (const x of [this.doorPanel, this.doorGlass, this.shadows, this.pools]) {
      x.count = 0;
      x.frustumCulled = false;
      x.raycast = () => {};
      x.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(x);
    }
    this.doorPanel.name = 'car-doors';
  }

  /** Lay out every car on the driveway at time t (wall clock), easing doors by dt. */
  update(traffic: Traffic, t: number, dt: number) {
    const counts = new Map<MeshKind, number>();
    let n = 0;
    const blink = blinkOn(t);
    for (const car of traffic.here) {
      const mk = MESH_OF[car.kind];
      const km = this.kinds.get(mk)!;
      const i = counts.get(mk) ?? 0;
      if (i >= MAX_PER_KIND || n >= MAX_CARS) continue;
      counts.set(mk, i + 1);
      const pose = traffic.carPose(car, t);
      this.q.setFromAxisAngle(this.up, pose.yaw);
      this.m.compose(this.v.set(pose.x, 0, pose.z), this.q, this.one);
      km.body.setMatrixAt(i, this.m);
      this.c.setHex(car.paint || PAINT[car.kind] || 0x777777).convertSRGBToLinear();
      km.paint.setXYZ(i, this.c.r, this.c.g, this.c.b);
      const moving = !!car.motion;
      const brake = traffic.braking(car, t) || (moving && pose.speed < 0.3) ? 1 : 0;
      const left = (car.blink || car.hazards) && blink ? 1 : 0;
      const right = car.hazards && blink ? 1 : 0;
      km.lamp.setXYZW(i, car.home === 'valet' ? 0.15 : 1, brake, left, right);
      if (car.kind === 'taxiY' || car.kind === 'taxiBW') km.sign.setXYZW(i, 1, 0.9, 0.7, car.roof ? 1 : 0);
      else if (car.sign) {
        this.c.setHex(car.sign).convertSRGBToLinear();
        km.sign.setXYZW(i, this.c.r, this.c.g, this.c.b, 1);
      } else km.sign.setXYZW(i, 0, 0, 0, 0);
      // The door: eased toward open (guest or player), hinged on the curb side.
      const want = Math.max(car.door, car.playerDoor) && !moving ? 1 : 0;
      let a = this.doorAngle.get(car.key) ?? 0;
      a += Math.sign(want - a) * Math.min(Math.abs(want - a), dt / 0.9);
      this.doorAngle.set(car.key, a);
      const ang = CarFleet.OPEN * easeSwing(a);
      // (One door shape: stretched to the SUV's taller opening.)
      const suv = mk === 'suv';
      this.m2.compose(this.v.set(-km.dims.wid / 2, suv ? 0.017 : 0, DOOR.hinge), this.q.setFromAxisAngle(this.up, ang), suv ? SUV_DOOR : this.one);
      this.m2.premultiply(this.m);
      this.doorPanel.setMatrixAt(n, this.m2);
      this.c.setHex(DOOR_PAINT[car.kind] ?? (car.paint || PAINT[car.kind] || 0x777777)).convertSRGBToLinear();
      this.doorPaint.setXYZ(n, this.c.r, this.c.g, this.c.b);
      this.shadows.setMatrixAt(n, this.m);
      // Headlight pools only while moving or idling with lights on (the valet's car is parked dark).
      if (car.home === 'valet') this.pools.setMatrixAt(n, this.m2.makeScale(0, 0, 0));
      else this.pools.setMatrixAt(n, this.m);
      n++;
    }
    for (const [mk, km] of this.kinds) {
      const c = counts.get(mk) ?? 0;
      km.body.count = km.glass.count = c;
      km.body.instanceMatrix.needsUpdate = true;
      km.paint.needsUpdate = km.lamp.needsUpdate = km.sign.needsUpdate = true;
    }
    for (const x of [this.doorPanel, this.doorGlass, this.shadows, this.pools]) {
      x.count = n;
      x.instanceMatrix.needsUpdate = true;
    }
    this.doorPaint.needsUpdate = true;
    // Forget doors of cars that have gone.
    if (this.doorAngle.size > 40) for (const k of [...this.doorAngle.keys()]) if (!traffic.here.some((c) => c.key === k)) this.doorAngle.delete(k);
  }
}

/** Doors swing out quickly, then settle. */
const easeSwing = (a: number) => 1 - (1 - a) * (1 - a);

export type { SimCar };
