import * as THREE from 'three';
import { assets } from './assets';
import { canvas, toTexture } from './textures';
import type { Quality } from './quality';

/**
 * Blackjack tables that fill out the table-games pit (scenery with a dealer and
 * players). Strip-standard 7-spot tables, 2.1 m across, felt at 76 cm, with a
 * padded rail, chip tray, shoe, discard rack and a lit limit sign.
 */

const R = 1.05; // radius of the players' arc
const TOP = 0.76;

function feltTex(color: string): HTMLCanvasElement {
  const [c, g] = canvas(1024, 520);
  const grd = g.createRadialGradient(512, 40, 60, 512, 40, 700);
  grd.addColorStop(0, shade(color, 1.15));
  grd.addColorStop(1, shade(color, 0.75));
  g.fillStyle = grd;
  g.fillRect(0, 0, 1024, 520);
  const ink = 'rgba(244,228,180,0.92)';
  const cx = 512,
    cy = 0; // dealer edge at the top of the canvas; players' arc below
  const px = 1024 / (2 * R);
  const arcText = (text: string, r: number, size: number, spread: number) => {
    g.save();
    g.font = `600 ${size}px Georgia, serif`;
    g.fillStyle = ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const chars = [...text];
    chars.forEach((ch, i) => {
      const a = Math.PI / 2 + spread * (0.5 - i / (chars.length - 1));
      g.save();
      g.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      g.rotate(a - Math.PI / 2);
      g.fillText(ch, 0, 0);
      g.restore();
    });
    g.restore();
  };
  g.strokeStyle = ink;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(cx, cy, 0.52 * px, 0, Math.PI);
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, 0.6 * px, 0, Math.PI);
  g.stroke();
  arcText('BLACKJACK PAYS 3 TO 2', 0.42 * px, 30, 1.3);
  arcText('INSURANCE PAYS 2 TO 1', 0.56 * px, 20, 1.0);
  arcText('DEALER MUST DRAW TO 16 AND STAND ON ALL 17s', 0.36 * px, 15, 1.35);
  // Seven betting circles.
  for (let k = 0; k < 7; k++) {
    const a = Math.PI / 2 + (k - 3) * 0.36;
    const r = 0.8 * px;
    g.beginPath();
    g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0.075 * px, 0, Math.PI * 2);
    g.lineWidth = 3;
    g.stroke();
  }
  g.font = 'italic 600 22px Georgia, serif';
  g.fillStyle = ink;
  g.textAlign = 'center';
  g.fillText('Palazzo Lago', cx, 0.24 * px);
  return c;
}

function shade(hex: string, k: number) {
  return '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
}

function signTex(min: number, max: number): HTMLCanvasElement {
  const [c, g] = canvas(256, 160);
  g.fillStyle = '#0a0606';
  g.fillRect(0, 0, 256, 160);
  g.strokeStyle = '#d4a94e';
  g.lineWidth = 4;
  g.strokeRect(4, 4, 248, 152);
  g.fillStyle = '#ffd98a';
  g.textAlign = 'center';
  g.font = 'italic 600 26px Georgia, serif';
  g.fillText('Blackjack', 128, 40);
  g.font = 'bold 46px Georgia, serif';
  g.fillStyle = '#ffffff';
  g.fillText(`$${min}`, 128, 95);
  g.font = '20px Georgia, serif';
  g.fillStyle = '#ffd98a';
  g.fillText(`MAX $${max.toLocaleString('en-US')}`, 128, 135);
  return c;
}

export interface PitTable {
  group: THREE.Group;
  dealer: { pos: THREE.Vector3; yaw: number };
  seats: { pos: THREE.Vector3; yaw: number }[];
}

export function buildBlackjack(q: Quality, opts: { x: number; z: number; yaw: number; felt: string; min: number; max: number }): PitTable {
  const g = new THREE.Group();
  g.position.set(opts.x, 0, opts.z);
  g.rotation.y = opts.yaw;
  const walnut = assets.material('walnut', { repeat: [3, 1], rough: 0.5, fallback: () => new THREE.MeshStandardMaterial({ color: 0x3a1a0c, roughness: 0.4 }) });
  const leather = assets.material('leather', { repeat: 3, rough: 0.8, tint: 0x5a2424, fallback: () => new THREE.MeshStandardMaterial({ color: 0x2a0d10, roughness: 0.55 }) });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 1, roughness: 0.3 });

  g.updateMatrixWorld(true);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.55, R * 0.6, TOP - 0.1, 24, 1, false, -Math.PI / 2, Math.PI), new THREE.MeshStandardMaterial({ color: 0x140b07, roughness: 0.6 }));
  base.position.set(0, (TOP - 0.1) / 2, 0);
  g.add(base);
  const slab = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.08, 40, 1, false, -Math.PI / 2, Math.PI), walnut);
  slab.position.y = TOP - 0.04;
  g.add(slab);
  const back = new THREE.Mesh(new THREE.BoxGeometry(2 * R, 0.08, 0.12), walnut);
  back.position.set(0, TOP - 0.04, -0.06);
  g.add(back);
  // Felt (half disc), mapped so the canvas top is the dealer edge.
  const felt = new THREE.Mesh(new THREE.CircleGeometry(R - 0.06, 48, -Math.PI, Math.PI), new THREE.MeshStandardMaterial({ map: toTexture(feltTex(opts.felt)), roughness: 0.92 }));
  felt.rotation.x = -Math.PI / 2;
  felt.position.y = TOP + 0.001;
  const uv = felt.geometry.attributes.uv as THREE.BufferAttribute;
  const pos = felt.geometry.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, (pos.getX(k) + R) / (2 * R), 1 + pos.getY(k) / (R * 1.0));
  g.add(felt);
  // Padded rail around the arc.
  const arc = new THREE.EllipseCurve(0, 0, R - 0.03, R - 0.03, Math.PI, 2 * Math.PI, false, 0);
  const pts = arc.getPoints(40).map((p) => new THREE.Vector3(p.x, TOP + 0.03, -p.y));
  const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.055, 10, false), leather);
  g.add(rail);
  // Chip tray, shoe, discard rack.
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.03, 0.16), new THREE.MeshStandardMaterial({ color: 0x0b0806, roughness: 0.3 }));
  tray.position.set(0, TOP + 0.015, 0.1);
  g.add(tray);
  // All chips on the table (tray columns and bets) as one instanced draw.
  const COLORS = [0xf2f0ea, 0xc0262d, 0x1e7a3a, 0x1b1b1f, 0x6b2f8f, 0xe4b833];
  const chipGeo = new THREE.CylinderGeometry(0.0195, 0.0195, 0.0033, 14);
  const chips = new THREE.InstancedMesh(chipGeo, new THREE.MeshStandardMaterial({ roughness: 0.5 }), 6 * 34 + 4 * 6);
  const tmpO = new THREE.Object3D();
  let ci = 0;
  COLORS.forEach((c, i) => {
    for (let k = 0; k < 34; k++) {
      tmpO.position.set(-0.25 + i * 0.1, TOP + 0.035, 0.035 + k * 0.0038);
      tmpO.rotation.set(Math.PI / 2, 0, 0);
      tmpO.updateMatrix();
      chips.setMatrixAt(ci, tmpO.matrix);
      chips.setColorAt(ci++, new THREE.Color(c));
    }
  });
  const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.24), new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 0.3 }));
  shoe.position.set(0.62, TOP + 0.05, 0.18);
  shoe.rotation.y = -0.4;
  g.add(shoe);

  // Cards dealt to a few spots and chips in a few circles.
  const cardMat = new THREE.MeshStandardMaterial({ color: 0xfbf8f0, roughness: 0.6 });
  const cardGeo = new THREE.BoxGeometry(0.063, 0.001, 0.088);
  for (let k = 0; k < 7; k++) {
    if (k % 2) continue;
    const a = Math.PI / 2 + (k - 3) * 0.36;
    const r = 0.62;
    for (let j = 0; j < 2; j++) {
      const card = new THREE.Mesh(cardGeo, cardMat);
      card.position.set(Math.cos(a) * r + j * 0.02, TOP + 0.002 + j * 0.001, Math.sin(a) * r + j * 0.015);
      card.rotation.y = -(a - Math.PI / 2) + 0.1;
      g.add(card);
    }
    for (let j = 0; j < 6; j++) {
      tmpO.position.set(Math.cos(a) * 0.8 + (j % 2) * 0.002, TOP + 0.0017 + j * 0.0033, Math.sin(a) * 0.8);
      tmpO.rotation.set(0, 0, 0);
      tmpO.updateMatrix();
      chips.setMatrixAt(ci, tmpO.matrix);
      chips.setColorAt(ci++, new THREE.Color(COLORS[(k + (j > 2 ? 1 : 0)) % COLORS.length]));
    }
  }
  chips.count = ci;
  g.add(chips);
  // Lit table-limit sign on a brass post at the dealer's side.
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.16), new THREE.MeshBasicMaterial({ map: toTexture(signTex(opts.min, opts.max)), toneMapped: false }));
  sign.position.set(R - 0.15, TOP + 0.32, -0.02);
  sign.rotation.y = -0.3;
  g.add(sign);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.25, 6), gold);
  post.position.set(R - 0.15, TOP + 0.13, -0.03);
  g.add(post);
  // Stools.
  const seats: PitTable['seats'] = [];
  const seatTop = new THREE.CylinderGeometry(0.2, 0.18, 0.09, 18);
  const stoolPole = new THREE.CylinderGeometry(0.025, 0.025, 0.6, 8);
  for (let k = 0; k < 7; k++) {
    const a = Math.PI / 2 + (k - 3) * 0.36;
    const r = R + 0.42;
    const x = Math.cos(a) * r,
      z = Math.sin(a) * r;
    const s = new THREE.Mesh(seatTop, leather);
    s.position.set(x, 0.7, z);
    const p = new THREE.Mesh(stoolPole, gold);
    p.position.set(x, 0.35, z);
    g.add(s, p);
    const w = g.localToWorld(new THREE.Vector3(x, 0, z));
    seats.push({ pos: w, yaw: opts.yaw + Math.atan2(-x, -z) });
  }
  return {
    group: g,
    dealer: { pos: g.localToWorld(new THREE.Vector3(0, 0, -0.45)), yaw: opts.yaw },
    seats,
  };
}

/** Shared helper so a table's seats use world positions after placement. */
export function placeTable(scene: THREE.Object3D, t: PitTable) {
  scene.add(t.group);
  t.group.updateMatrixWorld(true);
}
