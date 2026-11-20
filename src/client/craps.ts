import * as THREE from 'three';
import type { GameContext } from './game';
import { textSign } from './panel';
import { bakeStatic } from './merge';
import { canvas, radial, toTexture, wood } from './textures';

/**
 * Phase 3 placeholder: a dressed craps table behind velvet ropes, so the floor
 * plan is final and players can see what's coming.
 */
export function buildCrapsPreview(ctx: GameContext, position: THREE.Vector3) {
  const g = new THREE.Group();
  g.position.copy(position);
  ctx.scene.add(g);
  const L = 3.6,
    Wd = 1.5,
    H = 0.78;
  const woodTex = toTexture(wood(512));
  const woodMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.35 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x4a1418, roughness: 0.55 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 1, roughness: 0.3 });

  // Tub: outer walls with a rail, felt bed recessed below.
  const outer = new THREE.Shape();
  const r = 0.55;
  outer.absarc(-L / 2 + r, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
  outer.lineTo(L / 2 - r, -r);
  outer.absarc(L / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
  outer.closePath();
  const sx = Wd / (2 * r);
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: H, bevelEnabled: false, curveSegments: 24 }), woodMat);
  body.rotation.x = -Math.PI / 2;
  body.scale.set(1, sx, 1);
  g.add(body);
  const rail = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.06, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.03, curveSegments: 24 }), leather);
  rail.rotation.x = -Math.PI / 2;
  rail.scale.set(1.02, sx * 1.04, 1);
  rail.position.y = H;
  g.add(rail);

  const [c, c2d] = canvas(2048, 860);
  const grad = c2d.createRadialGradient(1024, 430, 100, 1024, 430, 1100);
  grad.addColorStop(0, '#1d7a46');
  grad.addColorStop(1, '#0e4a2a');
  c2d.fillStyle = grad;
  c2d.fillRect(0, 0, 2048, 860);
  c2d.strokeStyle = '#f1e6c8';
  c2d.lineWidth = 6;
  c2d.fillStyle = '#f1e6c8';
  c2d.textAlign = 'center';
  c2d.textBaseline = 'middle';
  for (const side of [-1, 1]) {
    const x0 = 1024 + side * 300;
    c2d.strokeRect(side < 0 ? x0 - 600 : x0, 120, 600, 620);
    c2d.font = 'italic 600 70px Georgia, serif';
    c2d.fillText('PASS LINE', side < 0 ? x0 - 300 : x0 + 300, 690);
    c2d.font = '600 52px Georgia, serif';
    c2d.fillText('COME', side < 0 ? x0 - 300 : x0 + 300, 420);
    c2d.fillText('FIELD  2 · 3 · 4 · 9 · 10 · 11 · 12', side < 0 ? x0 - 300 : x0 + 300, 540);
    ['4', '5', 'SIX', '8', 'NINE', '10'].forEach((n, i) => {
      const bx = (side < 0 ? x0 - 600 : x0) + i * 100;
      c2d.strokeRect(bx, 140, 100, 150);
      c2d.font = 'bold 44px Georgia, serif';
      c2d.fillText(n, bx + 50, 215);
    });
  }
  c2d.strokeRect(724, 180, 600, 500);
  c2d.font = 'italic 600 48px Georgia, serif';
  c2d.fillText('Seven  4 to 1', 1024, 240);
  c2d.fillText('Hard 6  9 to 1  ·  Hard 8  9 to 1', 1024, 330);
  c2d.fillText('Hard 4  7 to 1  ·  Hard 10  7 to 1', 1024, 420);
  c2d.fillText('Any Craps  7 to 1', 1024, 600);
  const felt = new THREE.Mesh(new THREE.PlaneGeometry(L - 0.3, Wd - 0.25), new THREE.MeshStandardMaterial({ map: toTexture(c), roughness: 0.9 }));
  felt.rotation.x = -Math.PI / 2;
  felt.position.y = H - 0.12;
  g.add(felt);
  const bed = new THREE.Mesh(new THREE.BoxGeometry(L - 0.2, 0.02, Wd - 0.15), new THREE.MeshStandardMaterial({ color: 0x0e4a2a }));
  bed.position.y = H - 0.135;
  g.add(bed);

  // Dice resting on the felt.
  const dieMat = new THREE.MeshPhysicalMaterial({ color: 0xc8121e, roughness: 0.1, transmission: 0, clearcoat: 1 });
  for (const [x, z, ry] of [[0.3, 0.1, 0.3], [0.38, 0.05, 1.1]] as const) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.019, 0.019, 0.019), dieMat);
    d.position.set(x, H - 0.115, z);
    d.rotation.y = ry;
    g.add(d);
  }

  // Velvet ropes on brass stanchions.
  const post = new THREE.CylinderGeometry(0.025, 0.03, 0.95, 12);
  const top = new THREE.SphereGeometry(0.045, 14, 10);
  const base = new THREE.CylinderGeometry(0.14, 0.16, 0.03, 20);
  const velvet = new THREE.MeshStandardMaterial({ color: 0x7a0a1a, roughness: 0.8 });
  const posts: THREE.Vector3[] = [];
  for (const [x, z] of [[-2.6, 1.4], [-0.9, 1.6], [0.9, 1.6], [2.6, 1.4]]) {
    const p = new THREE.Group();
    const a = new THREE.Mesh(post, gold);
    a.position.y = 0.475;
    const b = new THREE.Mesh(top, gold);
    b.position.y = 0.97;
    const c3 = new THREE.Mesh(base, gold);
    c3.position.y = 0.015;
    p.add(a, b, c3);
    p.position.set(x, 0, z);
    g.add(p);
    posts.push(new THREE.Vector3(x, 0.9, z));
  }
  for (let i = 0; i < posts.length - 1; i++) {
    const curve = new THREE.QuadraticBezierCurve3(posts[i], posts[i].clone().lerp(posts[i + 1], 0.5).setY(0.62), posts[i + 1]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.018, 8), velvet));
  }

  const sign = textSign('Craps', { width: 1.3, px: 140, sub: 'OPENING SOON', bg: 'rgba(16,10,8,0.9)' });
  sign.position.set(0, 1.9, 0);
  sign.rotation.y = 0;
  g.add(sign);
  const easel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 8), gold);
  easel.position.set(0, 0.8, -0.02);
  g.add(easel);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(L + 1, Wd + 1),
    new THREE.MeshBasicMaterial({ map: toTexture(radial(128, 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0)')), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  g.add(shadow);
  bakeStatic(g, { shadows: ctx.quality.shadows });
  return g;
}
