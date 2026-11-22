import * as THREE from 'three';
import type { GameContext } from './game';
import { textSign } from './panel';
import { bakeStatic } from './merge';
import { assets } from './assets';
import { canvas, radial, toTexture, wood } from './textures';

/**
 * Phase 3 placeholder: a dressed 12-ft craps table (accurate Vegas layout) behind velvet ropes, so the floor
 * plan is final and players can see what's coming.
 */
export function buildCrapsPreview(ctx: GameContext, position: THREE.Vector3) {
  const g = new THREE.Group();
  g.position.copy(position);
  ctx.scene.add(g);
  const L = 3.6,
    Wd = 1.5,
    H = 0.92; // rail top ~0.98 m, felt bed ~0.8 m, like a real 12-ft table
  const woodTex = toTexture(wood(512));
  const woodMat = assets.material('walnut', { repeat: [3, 1], rough: 0.55, fallback: () => new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.35 }) });
  const leather = assets.material('leather', { repeat: 3, rough: 0.85, tint: 0x8a3a3a, fallback: () => new THREE.MeshStandardMaterial({ color: 0x4a1418, roughness: 0.55 }) });
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

  const c = crapsFelt();
  const felt = new THREE.Mesh(new THREE.PlaneGeometry(L - 0.3, Wd - 0.25), new THREE.MeshStandardMaterial({ map: (() => { const t = toTexture(c); t.anisotropy = 8; return t; })(), roughness: 0.92 }));
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

/**
 * A Las Vegas craps layout (one 2048×860 canvas covering the bed). Each half is
 * the standard mirror image: Don't Come bar, place numbers (4 5 SIX 8 NINE 10),
 * Come, a Field paying double on 2 and triple on 12, Big 6/8, Don't Pass bar and
 * the Pass Line wrapping round the end. Proposition bets sit in the centre with
 * their Strip odds ("to 1"), plus the C & E circles.
 */
export function crapsFelt(): HTMLCanvasElement {
  const [c, g] = canvas(2048, 860);
  const grad = g.createRadialGradient(1024, 430, 100, 1024, 430, 1100);
  grad.addColorStop(0, '#1d7a46');
  grad.addColorStop(1, '#0d4527');
  g.fillStyle = grad;
  g.fillRect(0, 0, 2048, 860);
  const INK = '#f1e6c8';
  const RED = '#c8202a';
  const YEL = '#f2c94c';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';

  const text = (s: string, x: number, y: number, size: number, opts: { color?: string; italic?: boolean; rot?: number; weight?: number } = {}) => {
    g.save();
    g.translate(x, y);
    if (opts.rot) g.rotate(opts.rot);
    g.fillStyle = opts.color ?? INK;
    g.font = `${opts.italic ? 'italic ' : ''}${opts.weight ?? 700} ${size}px Georgia, serif`;
    g.fillText(s, 0, 0);
    g.restore();
  };
  const die = (x: number, y: number, n: number, s = 30) => {
    g.fillStyle = '#fbf6ea';
    g.beginPath();
    g.roundRect(x - s / 2, y - s / 2, s, s, s * 0.18);
    g.fill();
    g.fillStyle = n === 1 ? RED : '#111';
    const o = s * 0.27;
    const pips: Record<number, [number, number][]> = {
      1: [[0, 0]],
      2: [[-o, -o], [o, o]],
      3: [[-o, -o], [0, 0], [o, o]],
      4: [[-o, -o], [o, -o], [-o, o], [o, o]],
      5: [[-o, -o], [o, -o], [0, 0], [-o, o], [o, o]],
      6: [[-o, -o], [o, -o], [-o, 0], [o, 0], [-o, o], [o, o]],
    };
    for (const [px, py] of pips[n]) {
      g.beginPath();
      g.arc(x + px, y + py, s * 0.09, 0, Math.PI * 2);
      g.fill();
    }
  };

  for (const side of [-1, 1] as const) {
    // Work in left-half coordinates; X() mirrors them for the right half.
    const X = (x: number) => (side < 0 ? x : 2048 - x);
    const rect = (x0: number, y0: number, x1: number, y1: number) => {
      const a = X(x0),
        b = X(x1);
      g.strokeRect(Math.min(a, b), y0, Math.abs(b - a), y1 - y0);
    };
    g.strokeStyle = INK;
    g.lineWidth = 5;

    // Pass Line: along the players' edge and up round the end.
    g.beginPath();
    for (const [x, y] of [[40, 70], [40, 815], [724, 815], [724, 710], [130, 710], [130, 70]]) g.lineTo(X(x), y);
    g.closePath();
    g.stroke();
    text('PASS LINE', X(430), 762, 64, { italic: true });
    text('PASS LINE', X(85), 390, 40, { italic: true, rot: side < 0 ? -Math.PI / 2 : Math.PI / 2 });

    // Don't Come bar 12.
    rect(130, 70, 225, 235);
    text("DON'T", X(177), 105, 22);
    text('COME', X(177), 130, 22);
    text('BAR', X(177), 155, 22);
    die(X(160), 200, 6, 26);
    die(X(194), 200, 6, 26);

    // Place numbers.
    const nums = ['4', '5', 'SIX', '8', 'NINE', '10'];
    const w = (724 - 225) / 6;
    nums.forEach((n, i) => {
      const x0 = 225 + i * w;
      rect(x0, 70, x0 + w, 235);
      g.strokeStyle = INK;
      g.lineWidth = 2;
      rect(x0 + 6, 76, x0 + w - 6, 106);
      g.lineWidth = 5;
      text(n, X(x0 + w / 2), 170, n.length > 3 ? 32 : n.length > 2 ? 38 : 58, { color: n === 'SIX' || n === '8' ? YEL : INK });
    });

    // Come.
    rect(130, 235, 724, 400);
    text('COME', X(430), 318, 110, { color: RED, italic: true });

    // Field: 2 pays double, 12 pays triple.
    rect(225, 400, 724, 615);
    text('FIELD', X(475), 590, 30, { color: YEL });
    const fx = [265, 335, 405, 475, 545, 615, 685];
    ['2', '3', '4', '9', '10', '11', '12'].forEach((n, i) => {
      const x = X(fx[i]);
      const circled = n === '2' || n === '12';
      if (circled) {
        g.lineWidth = 3;
        g.beginPath();
        g.arc(x, 490, 34, 0, Math.PI * 2);
        g.stroke();
        g.lineWidth = 5;
      }
      text(n, x, 490, 48, { color: circled ? YEL : INK });
    });
    text('PAYS DOUBLE', X(fx[0] + 22), 436, 16, { color: YEL });
    text('PAYS TRIPLE', X(fx[6] - 24), 436, 16, { color: YEL });

    // Big 6 / Big 8.
    rect(130, 400, 225, 710);
    text('6', X(177), 480, 70, { color: RED });
    text('8', X(177), 610, 70, { color: RED });
    text('BIG', X(177), 545, 22);

    // Don't Pass bar 12.
    rect(225, 615, 724, 710);
    text("DON'T PASS BAR", X(430), 662, 40, { italic: true });
    die(X(640), 662, 6, 30);
    die(X(678), 662, 6, 30);
  }

  // Centre: proposition bets with Strip odds.
  g.strokeStyle = INK;
  g.lineWidth = 5;
  g.strokeRect(744, 70, 560, 745);
  g.fillStyle = '#9e1a22';
  g.fillRect(746, 72, 556, 76);
  g.fillRect(746, 602, 556, 86);
  text('SEVEN   4 TO 1', 1024, 110, 46);
  g.strokeRect(744, 70, 560, 80);
  // Hard ways.
  const hard: [number, string][] = [[3, '9 TO 1'], [4, '9 TO 1'], [2, '7 TO 1'], [5, '7 TO 1']];
  hard.forEach(([d, odds], i) => {
    const cx = 744 + (i % 2) * 280;
    const cy = 150 + Math.floor(i / 2) * 150;
    g.strokeRect(cx, cy, 280, 150);
    die(cx + 110, cy + 60, d, 44);
    die(cx + 170, cy + 60, d, 44);
    text(odds, cx + 140, cy + 120, 30);
  });
  // One-roll bets.
  const one: [number, number, string][] = [[1, 1, '30 TO 1'], [6, 6, '30 TO 1'], [1, 2, '15 TO 1'], [5, 6, '15 TO 1']];
  one.forEach(([a, b], i) => {
    const cx = 744 + i * 140;
    g.strokeRect(cx, 450, 140, 150);
    die(cx + 50, 500, a, 36);
    die(cx + 90, 500, b, 36);
    text(one[i][2], cx + 70, 565, 22);
  });
  g.strokeRect(744, 600, 560, 90);
  text('ANY CRAPS   7 TO 1', 1024, 645, 40);
  // C & E circles.
  for (let i = 0; i < 4; i++) {
    const cx = 800 + i * 150;
    for (const [dy, l, col] of [[735, 'C', RED], [780, 'E', YEL]] as const) {
      g.beginPath();
      g.arc(cx, dy, 20, 0, Math.PI * 2);
      g.lineWidth = 3;
      g.stroke();
      text(l, cx, dy + 1, 24, { color: col });
    }
  }
  return c;
}
