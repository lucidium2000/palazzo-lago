import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { assets } from './assets';
import { HALL, POKER_DOOR } from './casino';
import type { Quality } from './quality';
import { canvas, carpet, damask, lakeView, toTexture } from './textures';
import type { World } from './world';

/**
 * The poker room: a private card salon off the west side of the casino floor,
 * through a gilded doorway beside the blackjack pit. Walnut wainscot and
 * claret damask, a coffered ceiling, a lake painting, a credenza with
 * decanters, and in the middle one six-seat oval Hold'em table: green felt
 * with a betting line, a padded leather rail on a walnut racetrack, the
 * dealer's chip tray and a low brass-and-green pendant that pools warm light
 * on the felt. The cards and chips in play are drawn by pokerplay.ts.
 *
 * Table frame (table-local): the long axis is x; the dealer sits at -z; the
 * seats go clockwise from the dealer's left. The table stands in the room with
 * its local +z toward the door (world +x).
 */

export const ROOM = { x0: -26.2, x1: -HALL.w / 2, z0: -3.6, z1: 3.6, h: 3.3 };
export const TABLE_AT = new THREE.Vector3(-22.3, 0, 0);
const TABLE_YAW = Math.PI / 2;
/** Felt height, felt and rail half-axes. */
export const PK_TOP = 0.78;
export const FELT_A = 1.17,
  FELT_B = 0.6;
export const RAIL_A = 1.33,
  RAIL_B = 0.76;
export const SEATS = 6;
/** Seat angles round the oval (table-local, x/z plane), clockwise from the dealer's left. */
const SEAT_DEG = [-30, 15, 60, 120, 165, 210];
export const seatAngle = (k: number) => (SEAT_DEG[k] * Math.PI) / 180;
/** Chair seat height (friends' avatars sit at 0.62, see session.ts). */
const CHAIR_Y = 0.6;

/** Table-local spots the dealer works from (the deck, the muck). */
export const DECK_AT = new THREE.Vector3(0.26, PK_TOP + 0.012, -0.47);
export const MUCK_AT = new THREE.Vector3(-0.24, PK_TOP + 0.004, -0.42);

export interface PokerRoom {
  /** Walls, floor and ceiling (drawn with the casino). */
  shell: THREE.Group;
  /** Everything inside (hidden from the far side of the floor). */
  interior: THREE.Group;
  /** The table's frame: the cards and chips in play are added here. */
  table: THREE.Group;
  dealer: { pos: THREE.Vector3; yaw: number };
  /** Chairs: world position (floor) and the way a seated person faces (person yaw). */
  seats: { pos: THREE.Vector3; yaw: number }[];
  /** Standing spots by the credenza and the walls (for guests who give up their seat). */
  rail: { pos: THREE.Vector3; yaw: number }[];
  /** Where the pendant hangs (world). */
  lamp: THREE.Vector3;
  update(t: number): void;
}

/** Walkable floor and the table, chairs and furniture as obstacles. */
export function registerPokerRoom(world: World) {
  world.addWalkable(ROOM.x0 + 0.3, ROOM.x1 - 0.2, ROOM.z0 + 0.3, ROOM.z1 - 0.3);
  // Through the doorway.
  world.addWalkable(ROOM.x1 - 0.6, ROOM.x1 + 0.6, POKER_DOOR.z0 + 0.28, POKER_DOOR.z1 - 0.28);
  world.addSurface('carpet', ROOM.x0, ROOM.x1, ROOM.z0, ROOM.z1);
  // The table (an oval: two boxes) and the dealer's spot behind it.
  world.addBox(TABLE_AT.x, TABLE_AT.z, RAIL_B * 2 - 0.12, RAIL_A * 2 - 0.5, 0, 'table');
  world.addBox(TABLE_AT.x, TABLE_AT.z, RAIL_B * 1.3, RAIL_A * 2 - 0.05, 0, 'table');
  // Credenza on the back wall, armchairs in the corners.
  world.addBox(ROOM.x0 + 0.3, 0, 0.5, 2.4, 0, 'credenza');
  for (const z of [ROOM.z0 + 0.6, ROOM.z1 - 0.6]) world.addCircle(ROOM.x0 + 0.65, z, 0.4, 'armchair');
  for (const s of seatSpots()) world.addSeat(s.pos.x, s.pos.z, 0.26, CHAIR_Y, s.yaw, 'poker chair');
}

const tableMatrix = () => new THREE.Matrix4().compose(TABLE_AT, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), TABLE_YAW), new THREE.Vector3(1, 1, 1));

/** Chair positions (world) and seated facing, from the table frame. */
function seatSpots(): { pos: THREE.Vector3; yaw: number; local: THREE.Vector3 }[] {
  const m = tableMatrix();
  return SEAT_DEG.map((_, k) => {
    const a = seatAngle(k);
    const local = new THREE.Vector3(Math.cos(a) * (RAIL_A + 0.4), 0, Math.sin(a) * (RAIL_B + 0.42));
    return { local, pos: local.clone().applyMatrix4(m), yaw: TABLE_YAW + Math.atan2(-local.x, -local.z) };
  });
}

function feltTex(size: number): HTMLCanvasElement {
  const W = size,
    H = Math.round(size * (FELT_B / FELT_A));
  const [c, g] = canvas(W, H);
  // Pooled light from the pendant: brighter in the middle, falling off to the rail.
  const grd = g.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W * 0.55);
  grd.addColorStop(0, '#2f8a55');
  grd.addColorStop(0.55, '#1d6b3f');
  grd.addColorStop(1, '#0d3a22');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  // Fine nap.
  const img = g.getImageData(0, 0, W, H);
  let s = 7;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const n = ((s >> 16) & 15) - 7;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const ink = 'rgba(236,214,150,0.85)';
  // The betting line.
  g.strokeStyle = ink;
  g.lineWidth = W * 0.003;
  g.beginPath();
  g.ellipse(W / 2, H / 2, W * 0.36, H * 0.34, 0, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = W * 0.0015;
  g.beginPath();
  g.ellipse(W / 2, H / 2, W * 0.375, H * 0.36, 0, 0, Math.PI * 2);
  g.stroke();
  // Five boxes for the board, and the logo.
  g.lineWidth = W * 0.0018;
  for (let i = 0; i < 5; i++) {
    // Card-sized (6.3 x 8.8 cm), 7.5 cm apart, 5 cm toward the dealer from the middle.
    const px = W / (2 * FELT_A);
    const cx = W / 2 + (i - 2) * 0.075 * px,
      cy = H / 2 - 0.05 * px;
    g.strokeStyle = 'rgba(236,214,150,0.35)';
    g.strokeRect(cx - 0.034 * px, cy - 0.046 * px, 0.068 * px, 0.092 * px);
  }
  g.fillStyle = 'rgba(236,214,150,0.55)';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `italic 600 ${Math.round(W * 0.034)}px Georgia, serif`;
  g.fillText('Palazzo Lago', W / 2, H * 0.76);
  g.font = `600 ${Math.round(W * 0.016)}px Georgia, serif`;
  g.fillText("NO LIMIT TEXAS HOLD'EM · BLINDS $5 / $10", W / 2, H * 0.84);
  return c;
}

function signTex(): HTMLCanvasElement {
  const [c, g] = canvas(512, 128);
  g.fillStyle = '#120806';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#d4a94e';
  g.lineWidth = 5;
  g.strokeRect(6, 6, 500, 116);
  g.fillStyle = '#ffd98a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '600 50px Georgia, serif';
  g.fillText('POKER ROOM', 256, 54);
  g.font = 'italic 24px Georgia, serif';
  g.fillStyle = '#e8c88a';
  g.fillText("Salon Privé · Hold'em $5/$10", 256, 98);
  return c;
}

export function buildPokerRoom(q: Quality): PokerRoom {
  const shell = new THREE.Group();
  const interior = new THREE.Group();
  const { x0, x1, z0, z1, h } = ROOM;
  const W = x1 - x0,
    D = z1 - z0,
    cx = (x0 + x1) / 2;
  const tex = Math.min(q.texSize, 1024);
  const walnut = assets.material('walnut', { repeat: [3, 1], rough: 0.55, fallback: () => new THREE.MeshStandardMaterial({ color: 0x3a1a0c, roughness: 0.45 }) });
  const walnutDark = assets.material('walnut', { repeat: [2, 2], rough: 0.6, tint: 0x3a1c12, fallback: () => new THREE.MeshStandardMaterial({ color: 0x24100a, roughness: 0.5 }) });
  const leather = assets.material('leather', { repeat: 3, rough: 0.75, tint: 0x3a1a14, fallback: () => new THREE.MeshStandardMaterial({ color: 0x1e0c0a, roughness: 0.55 }) });
  const velvet = assets.material('velvet', { repeat: 2, tint: 0x6a1420, fallback: () => new THREE.MeshStandardMaterial({ color: 0x5a1018, roughness: 0.85 }) });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 1, roughness: 0.3 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08a3e, metalness: 0.9, roughness: 0.35 });

  // --- Shell -----------------------------------------------------------------------------
  const carpetTex = toTexture(carpet(tex), { repeat: 1 });
  carpetTex.repeat.set(W / 2.4, D / 2.4);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: carpetTex, color: 0x6a5a58, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0.002, 0);
  floor.receiveShadow = q.shadows;
  shell.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0x1a120e, roughness: 0.8 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(cx, h, 0);
  shell.add(ceil);
  // Coffers: a grid of dark beams.
  for (let i = 1; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, D), walnutDark);
    b.position.set(x0 + (W * i) / 4, h - 0.09, 0);
    shell.add(b);
  }
  for (let i = 1; i < 3; i++) {
    // (Stopping at the door wall: run to x1 and their ends showed through the casino's wall as dark squares.)
    const b = new THREE.Mesh(new THREE.BoxGeometry(W - 0.12, 0.18, 0.16), walnutDark);
    b.position.set(cx - 0.06, h - 0.09, z0 + (D * i) / 3);
    shell.add(b);
  }
  const damaskTex = toTexture(damask(512), { repeat: 1 });
  damaskTex.wrapS = damaskTex.wrapT = THREE.RepeatWrapping;
  const wallMat = new THREE.MeshStandardMaterial({ map: damaskTex, color: 0x8e3a34, roughness: 0.8 });
  const wall = (x: number, z: number, len: number, ry: number, y0 = 0, y1 = h) => {
    const hh = y1 - y0;
    const g = new THREE.PlaneGeometry(len, hh);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * len) / 1.2, (uv.getY(i) * hh) / 1.2);
    const m = new THREE.Mesh(g, wallMat);
    m.position.set(x, y0 + hh / 2, z);
    m.rotation.y = ry;
    shell.add(m);
    // Wainscot and a gold rail on the lower part.
    if (y0 === 0) {
      const inward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
      const p = new THREE.Mesh(new THREE.BoxGeometry(len, 1.05, 0.05), walnut);
      p.position.set(x + inward.x * 0.025, 0.525, z + inward.z * 0.025);
      p.rotation.y = ry;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, 0.05), gold);
      rail.position.set(x + inward.x * 0.05, 1.06, z + inward.z * 0.05);
      rail.rotation.y = ry;
      const crown = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.12), walnutDark);
      crown.position.set(x + inward.x * 0.06, h - 0.06, z + inward.z * 0.06);
      crown.rotation.y = ry;
      shell.add(p, rail, crown);
    }
  };
  wall(cx, z0, W, 0); // south (−z)
  wall(cx, z1, W, Math.PI); // north (+z)
  wall(x0, 0, D, Math.PI / 2); // back wall
  // The door wall (facing into the room), with the opening.
  const dz0 = POKER_DOOR.z0,
    dz1 = POKER_DOOR.z1,
    dh = POKER_DOOR.h;
  wall(x1 - 0.1, (z0 + dz0) / 2, dz0 - z0, -Math.PI / 2);
  wall(x1 - 0.1, (dz1 + z1) / 2, z1 - dz1, -Math.PI / 2);
  wall(x1 - 0.1, (dz0 + dz1) / 2, dz1 - dz0, -Math.PI / 2, dh, h);
  // Doorway: reveal (jambs, lintel) between the two walls, framed in gold on both sides.
  const jambMat = walnutDark;
  for (const z of [dz0 - 0.03, dz1 + 0.03]) {
    const j = new THREE.Mesh(new THREE.BoxGeometry(0.16, dh, 0.06), jambMat);
    j.position.set(x1 - 0.05, dh / 2, z);
    shell.add(j);
    // Gilt frame on both faces, standing just proud of each side's wainscot (it used to sit inside
    // the casino's and flush with the room's, so it vanished below the dado rail and flickered).
    for (const side of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.07, dh + 0.06, 0.1), gold);
      f.position.set(x1 - 0.05 + side * 0.13, (dh + 0.06) / 2, z + (z < 0 ? -0.04 : 0.04));
      shell.add(f);
    }
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, dz1 - dz0 + 0.12), jambMat);
  lintel.position.set(x1 - 0.05, dh + 0.03, 0);
  shell.add(lintel);
  for (const side of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, dz1 - dz0 + 0.26), gold);
    f.position.set(x1 - 0.05 + side * 0.13, dh + 0.08, 0);
    shell.add(f);
  }
  // A sign over the door on the casino side, and velvet ropes on brass posts.
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.375), new THREE.MeshBasicMaterial({ map: toTexture(signTex()), toneMapped: false }));
  sign.position.set(x1 + 0.09, dh + 0.42, 0);
  sign.rotation.y = Math.PI / 2;
  shell.add(sign);
  const postGeo = new THREE.CylinderGeometry(0.022, 0.03, 0.95, 10);
  const knob = new THREE.SphereGeometry(0.045, 12, 8);
  const baseGeo = new THREE.CylinderGeometry(0.13, 0.15, 0.03, 16);
  for (const z of [dz0 - 0.45, dz1 + 0.45]) {
    for (const dx of [0.35, 1.1]) {
      const px = x1 + dx;
      const p = new THREE.Mesh(postGeo, brass);
      p.position.set(px, 0.475, z);
      const k = new THREE.Mesh(knob, brass);
      k.position.set(px, 0.97, z);
      const b = new THREE.Mesh(baseGeo, brass);
      b.position.set(px, 0.015, z);
      shell.add(p, k, b);
    }
    const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(x1 + 0.35, 0.9, z), new THREE.Vector3(x1 + 0.725, 0.68, z), new THREE.Vector3(x1 + 1.1, 0.9, z)), 12, 0.018, 6), velvet);
    shell.add(rope);
  }

  // --- The table ---------------------------------------------------------------------------
  const table = new THREE.Group();
  table.position.copy(TABLE_AT);
  table.rotation.y = TABLE_YAW;
  interior.add(table);
  const ellipse = (a: number, b: number, n = 64) => {
    const s = new THREE.Shape();
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * Math.PI * 2;
      if (i === 0) s.moveTo(a * Math.cos(t), b * Math.sin(t));
      else s.lineTo(a * Math.cos(t), b * Math.sin(t));
    }
    return s;
  };
  // Pedestal and racetrack.
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.5, PK_TOP - 0.1, 24), new THREE.MeshStandardMaterial({ color: 0x140b07, roughness: 0.5 }));
  ped.scale.set(1.9, 1, 1);
  ped.position.y = (PK_TOP - 0.1) / 2;
  table.add(ped);
  const slabGeo = new THREE.ExtrudeGeometry(ellipse(RAIL_A + 0.02, RAIL_B + 0.02), { depth: 0.07, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2, curveSegments: 48 });
  slabGeo.rotateX(-Math.PI / 2);
  const slab = new THREE.Mesh(slabGeo, walnut);
  slab.position.y = PK_TOP - 0.1; // top (with the bevel) just under the felt
  table.add(slab);
  // Felt, mapped from the canvas (u along x, v along z).
  const feltGeo = new THREE.ShapeGeometry(ellipse(FELT_A, FELT_B), 48);
  feltGeo.rotateX(-Math.PI / 2);
  {
    const pos = feltGeo.attributes.position as THREE.BufferAttribute;
    const uv = feltGeo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + FELT_A) / (2 * FELT_A), 1 - (pos.getZ(i) + FELT_B) / (2 * FELT_B));
  }
  const felt = new THREE.Mesh(feltGeo, new THREE.MeshStandardMaterial({ map: toTexture(feltTex(Math.min(2048, tex * 2)), { aniso: 8 }), roughness: 0.95 }));
  felt.position.y = PK_TOP;
  felt.receiveShadow = q.shadows;
  table.add(felt);
  // The racetrack between the felt and the rail: polished walnut.
  // (A strip of triangles between the felt's edge and the rail.)
  const trackGeo = new THREE.BufferGeometry();
  {
    const n = 96;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * Math.PI * 2;
      const c = Math.cos(t),
        sn = Math.sin(t);
      pos.push(FELT_A * c, 0, FELT_B * sn, (RAIL_A - 0.08) * c, 0, (RAIL_B - 0.08) * sn);
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    trackGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    trackGeo.setIndex(idx);
    trackGeo.computeVertexNormals();
    // Faces up either way round.
    const nrm = trackGeo.attributes.normal as THREE.BufferAttribute;
    if (nrm.getY(0) < 0) {
      for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
      trackGeo.setIndex(idx);
      trackGeo.computeVertexNormals();
    }
  }
  const track = new THREE.Mesh(trackGeo, new THREE.MeshStandardMaterial({ color: 0x4a2414, roughness: 0.25, metalness: 0.1 }));
  track.position.y = PK_TOP + 0.001;
  table.add(track);
  // Padded rail.
  const railPts: THREE.Vector3[] = [];
  for (let i = 0; i < 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    railPts.push(new THREE.Vector3((RAIL_A - 0.05) * Math.cos(t), 0, (RAIL_B - 0.05) * Math.sin(t)));
  }
  const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPts, true), 96, 0.055, 10, true), leather);
  rail.scale.y = 0.8;
  rail.position.y = PK_TOP + 0.035;
  table.add(rail);
  // Dealer's chip tray (sunk into the felt at the dealer's edge) with columns of chips.
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.12), new THREE.MeshStandardMaterial({ color: 0x0b0806, roughness: 0.3 }));
  tray.position.set(0, PK_TOP + 0.008, -FELT_B + 0.1);
  table.add(tray);
  const trayChips = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0195, 0.0195, 0.0033, 12), new THREE.MeshStandardMaterial({ roughness: 0.5 }), 8 * 24);
  const COLORS = [0xc0262d, 0xc0262d, 0x1e7a3a, 0x1e7a3a, 0x1b1b1f, 0x1b1b1f, 0x6b2f8f, 0xe4b833];
  const o = new THREE.Object3D();
  let ci = 0;
  COLORS.forEach((c, i) => {
    for (let k = 0; k < 24; k++) {
      o.position.set(-0.21 + i * 0.06, PK_TOP + 0.04, -FELT_B + 0.1 - 0.04 + k * 0.0036);
      o.rotation.set(Math.PI / 2, 0, 0);
      o.updateMatrix();
      trayChips.setMatrixAt(ci, o.matrix);
      trayChips.setColorAt(ci++, new THREE.Color(c));
    }
  });
  table.add(trayChips);
  // Card shuffler at the dealer's right.
  const shuffler = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.09, 0.2, 2, 0.015), new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.35, metalness: 0.3 }));
  shuffler.position.set(-0.42, PK_TOP + 0.045, -FELT_B + 0.06);
  shuffler.rotation.y = 0.3;
  table.add(shuffler);

  // Chairs: high-backed leather on brass swivel bases.
  const seatSp = seatSpots();
  const chairSeat = new RoundedBoxGeometry(0.5, 0.11, 0.48, 3, 0.04);
  const chairBack = new RoundedBoxGeometry(0.5, 0.56, 0.1, 3, 0.04);
  const chairArm = new RoundedBoxGeometry(0.07, 0.07, 0.4, 2, 0.02);
  const pole = new THREE.CylinderGeometry(0.03, 0.03, CHAIR_Y - 0.12, 8);
  const star = new THREE.CylinderGeometry(0.26, 0.28, 0.03, 5);
  for (const s of seatSp) {
    const c = new THREE.Group();
    const seat = new THREE.Mesh(chairSeat, leather);
    seat.position.y = CHAIR_Y - 0.06;
    const back = new THREE.Mesh(chairBack, leather);
    back.position.set(0, CHAIR_Y + 0.27, -0.26);
    back.rotation.x = -0.12;
    const p = new THREE.Mesh(pole, brass);
    p.position.y = (CHAIR_Y - 0.12) / 2 + 0.03;
    const b = new THREE.Mesh(star, brass);
    b.position.y = 0.015;
    c.add(seat, back, p, b);
    for (const side of [-1, 1]) {
      const a = new THREE.Mesh(chairArm, walnut);
      a.position.set(side * 0.27, CHAIR_Y + 0.13, -0.04);
      c.add(a);
    }
    // Chairs sit back from the rail and face the table.
    c.position.copy(s.local);
    c.rotation.y = Math.atan2(-s.local.x, -s.local.z);
    table.add(c);
  }

  // The pendant: a long green shade on brass rods, glowing underneath.
  const lampY = PK_TOP + 1.12;
  const shadeMat = new THREE.MeshStandardMaterial({ color: 0x0e3a24, roughness: 0.35, metalness: 0.4, side: THREE.DoubleSide });
  const glow = new THREE.MeshBasicMaterial({ color: 0xfff0c8, toneMapped: false });
  const lamp = new THREE.Group();
  lamp.position.set(0, lampY, 0);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 0.2, 4, 1, true), shadeMat);
  shade.rotation.y = Math.PI / 4;
  shade.scale.set(3.2, 1, 1);
  lamp.add(shade);
  const diffuser = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.38), glow);
  diffuser.rotation.x = Math.PI / 2;
  diffuser.position.y = -0.095;
  lamp.add(diffuser);
  for (const sx of [-1, 1]) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.02, 0.02), brass);
    trim.position.set(0, -0.1, sx * 0.21);
    lamp.add(trim);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, h - lampY - 0.1, 6), brass);
    rod.position.set(sx * 0.5, (h - lampY) / 2 + 0.05, 0);
    lamp.add(rod);
  }
  table.add(lamp);
  // A faint cone of light under it.
  const cone = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62, 1.25, lampY - PK_TOP - 0.1, 4, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.025, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
  );
  cone.rotation.y = Math.PI / 4;
  cone.scale.set(1.25, 1, 0.42);
  cone.position.y = (lampY + PK_TOP) / 2 - 0.05;
  cone.raycast = () => {};
  cone.userData.dynamic = true;
  table.add(cone);
  if (q.name === 'desktop') {
    const l = new THREE.PointLight(0xffd2a0, 5, 3.6, 1.6);
    l.position.set(0, lampY - 0.18, 0);
    table.add(l);
  }

  // --- Furniture -------------------------------------------------------------------------
  // Credenza on the back wall, decanters on it, and the lake over it.
  const cred = new THREE.Mesh(new RoundedBoxGeometry(0.48, 0.92, 2.4, 2, 0.02), walnut);
  cred.position.set(x0 + 0.26, 0.46, 0);
  interior.add(cred);
  const credTop = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.03, 2.44), new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.15, metalness: 0.2 }));
  credTop.position.set(x0 + 0.27, 0.935, 0);
  interior.add(credTop);
  // The decanters of whisky on it are loose (loose.ts): pick one up, pour yourself a glass, swig.
  const painting = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.0), new THREE.MeshBasicMaterial({ map: toTexture(lakeView(512, 256)), color: 0x9a8a7a }));
  painting.position.set(x0 + 0.055, 1.95, 0);
  painting.rotation.y = Math.PI / 2;
  interior.add(painting);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.12, 2.12), gold); // the painting sits just in front of it
  frame.position.set(x0 + 0.015, 1.95, 0);
  interior.add(frame);
  // Wall sconces: two each side.
  const sconceGlow = new THREE.MeshBasicMaterial({ color: 0xffc880, toneMapped: false });
  const sconceShade = new THREE.CylinderGeometry(0.06, 0.09, 0.14, 12, 1, true);
  for (const z of [z0 + 0.02, z1 - 0.02])
    for (const x of [x0 + W * 0.28, x0 + W * 0.72]) {
      const s = new THREE.Mesh(sconceShade, sconceGlow);
      s.position.set(x, 1.85, z + (z < 0 ? 0.09 : -0.09));
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.1), brass);
      arm.position.set(x, 1.76, z + (z < 0 ? 0.05 : -0.05));
      interior.add(s, arm);
    }
  // Leather armchairs in the back corners and a side table between them.
  const arm = new RoundedBoxGeometry(0.72, 0.42, 0.7, 3, 0.06);
  const armBack = new RoundedBoxGeometry(0.72, 0.5, 0.16, 3, 0.05);
  for (const z of [z0 + 0.6, z1 - 0.6]) {
    const c = new THREE.Group();
    const s = new THREE.Mesh(arm, leather);
    s.position.y = 0.21;
    const b = new THREE.Mesh(armBack, leather);
    b.position.set(0, 0.62, -0.28);
    c.add(s, b);
    c.position.set(x0 + 0.65, 0, z);
    c.rotation.y = z < 0 ? 0.6 : Math.PI - 0.6;
    interior.add(c);
  }

  // Dealer and standing spots.
  const m = tableMatrix();
  const dealerLocal = new THREE.Vector3(0, 0, -RAIL_B - 0.2);
  const rail2: PokerRoom['rail'] = [
    { pos: new THREE.Vector3(x0 + 1.0, 0, z0 + 0.7), yaw: 0.9 },
    { pos: new THREE.Vector3(x0 + 1.1, 0, z1 - 0.7), yaw: Math.PI - 0.9 },
    { pos: new THREE.Vector3(x1 - 0.9, 0, z0 + 0.6), yaw: -0.8 },
    { pos: new THREE.Vector3(x1 - 0.9, 0, z1 - 0.6), yaw: Math.PI + 0.8 },
    { pos: new THREE.Vector3(cx, 0, z0 + 0.5), yaw: 0 },
    { pos: new THREE.Vector3(cx, 0, z1 - 0.5), yaw: Math.PI },
  ];
  return {
    shell,
    interior,
    table,
    dealer: { pos: dealerLocal.applyMatrix4(m), yaw: TABLE_YAW },
    seats: seatSp.map((s) => ({ pos: s.pos, yaw: s.yaw })),
    rail: rail2,
    lamp: new THREE.Vector3(0, lampY, 0).applyMatrix4(m),
    update(t: number) {
      // A gentle shimmer in the cone, as if smoke drifts through it.
      (cone.material as THREE.MeshBasicMaterial).opacity = 0.022 + 0.005 * Math.sin(t * 0.7) * Math.sin(t * 1.3);
    },
  };
}
