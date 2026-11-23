import { assets } from './assets';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { LAGO_FORTUNA, ROYAL_CONSERVATORY, DIAMOND_SEVENS } from '../rules/machines';
import type { GameContext } from './game';
import { bakeStatic } from './merge';
import type { Crowd } from './people';
import { randomLook } from './people';
import { symbolAtlas } from './slots/symbols';
import type { World } from './world';

/**
 * Rows of slot machines that fill out the floor. They are scenery (guests play
 * them, win, and cheer) and cost a handful of draw calls in total: cabinets
 * are merged, every screen shares one animated texture atlas, and the marquee
 * bulbs are one instanced mesh.
 */

const NAMES = ['Golden Gondola', 'Venetian Nights', 'Lucky Lanterns', 'Fortune Fountains', 'Midnight Opera', 'Riviera Gold', 'Cypress Crown', 'Starlit Lake'];
const CELLS = 8; // distinct screen animations in the atlas (4 x 2)
const CELL = 192; // atlas cell width
const CELL_H = 256; // portrait screens

interface Cabinet {
  pos: THREE.Vector3;
  yaw: number;
  cell: number;
  occupied: boolean;
  winUntil: number;
  bulbStart: number;
}

export class SlotRows {
  private cabinets: Cabinet[] = [];
  private screenCanvas: HTMLCanvasElement;
  private screenTex: THREE.CanvasTexture;
  private bulbs!: THREE.InstancedMesh;
  private atlases: { canvas: HTMLCanvasElement; ids: number }[];
  private lastDraw = 0;
  private nextWin = 6;
  private bulbsPer = 12;
  private carousels: [number, number][] = [
    [12.0, -3.9],
    [12.2, -8.9],
  ];

  constructor(
    private ctx: GameContext,
    private crowd: Crowd,
    private world: World,
  ) {
    this.atlases = [LAGO_FORTUNA, ROYAL_CONSERVATORY, DIAMOND_SEVENS].map((m) => ({ canvas: symbolAtlas(m, 96).canvas, ids: m.symbols.length }));
    this.screenCanvas = document.createElement('canvas');
    this.screenCanvas.width = CELL * 4;
    this.screenCanvas.height = CELL_H * 2;
    this.screenTex = new THREE.CanvasTexture(this.screenCanvas);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;

    // East wall row, facing west.
    for (let k = 0; k < 10; k++) this.cabinets.push(this.cab(17.4, -11 + k * 0.95, -Math.PI / 2, k));
    // Island, back to back.
    for (let k = 0; k < 7; k++) {
      this.cabinets.push(this.cab(11.05, -10 + k * 0.95, -Math.PI / 2, k + 3));
      this.cabinets.push(this.cab(11.75, -10 + k * 0.95, Math.PI / 2, k + 5));
    }
    // Two round carousels of machines around a lit sign tower, in the open floor.
    for (const [cx, cz] of this.carousels) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + 0.2;
        this.cabinets.push(this.cab(cx + Math.sin(a) * 0.95, cz + Math.cos(a) * 0.95, a, k + 2));
      }
    }
    this.cabinets = this.cabinets.slice(0, ctx.quality.rowMachines);
    this.build();
  }

  private cab(x: number, z: number, yaw: number, k: number): Cabinet {
    return { pos: new THREE.Vector3(x, 0, z), yaw, cell: k % CELLS, occupied: false, winUntil: 0, bulbStart: 0 };
  }

  private build() {
    const g = new THREE.Group();
    this.ctx.scene.add(g);
    const bodies = [0x5a0c18, 0x0f2a5a, 0x0c3d2a, 0x3a1a4a].map(
      (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.28, metalness: 0.1, envMapIntensity: 1.2 }),
    );
    const gold = new THREE.MeshStandardMaterial({ color: 0xd8ae58, metalness: 1, roughness: 0.25, envMapIntensity: 1.4 });
    const black = new THREE.MeshStandardMaterial({ color: 0x0c0a0a, roughness: 0.35 });
    const leather = assets.material('leather', { repeat: 1, rough: 0.8, tint: 0x7a4040, fallback: () => new THREE.MeshStandardMaterial({ color: 0x3a1015, roughness: 0.5 }) });
    const screenMat = new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false });
    const marqueeMat = new THREE.MeshBasicMaterial({ map: this.marqueeAtlas(), toneMapped: false });
    const base = new RoundedBoxGeometry(0.66, 0.8, 0.55, 2, 0.03);
    const upper = new RoundedBoxGeometry(0.66, 1.1, 0.36, 2, 0.03);
    const topper = new RoundedBoxGeometry(0.66, 0.4, 0.28, 2, 0.04);
    const ledGeo = new THREE.BoxGeometry(0.018, 1.55, 0.018);
    const ledMats = [0xff3a5a, 0x3ab0ff, 0x4affa0, 0xc06aff].map((c) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.2), toneMapped: true }));
    const glass = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.05, metalness: 0.2, envMapIntensity: 1.6 });
    const deck = new THREE.BoxGeometry(0.66, 0.05, 0.28);
    const trim = new THREE.BoxGeometry(0.68, 0.025, 0.57);
    const seat = new THREE.CylinderGeometry(0.19, 0.17, 0.08, 18);
    const pole = new THREE.CylinderGeometry(0.026, 0.026, 0.6, 8);
    const foot = new THREE.CylinderGeometry(0.19, 0.21, 0.03, 18);
    const tmp = new THREE.Object3D();
    const bulbGeo = new THREE.SphereGeometry(0.01, 6, 4);
    this.bulbs = new THREE.InstancedMesh(bulbGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), this.cabinets.length * this.bulbsPer);
    this.bulbs.raycast = () => {};

    this.cabinets.forEach((c, i) => {
      const m = new THREE.Group();
      m.position.copy(c.pos);
      m.rotation.y = c.yaw;
      g.add(m);
      const body = bodies[i % bodies.length];
      const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0) => {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        mesh.rotation.x = rx;
        m.add(mesh);
        return mesh;
      };
      add(base, body, 0, 0.4, 0);
      add(trim, gold, 0, 0.8, 0);
      add(deck, black, 0, 0.86, 0.2, 0.3);
      add(upper, body, 0, 1.4, -0.08);
      add(topper, body, 0, 2.17, -0.1);
      // Glowing LED edges down both sides of the cabinet front.
      add(ledGeo, ledMats[i % ledMats.length], -0.335, 1.42, 0.1);
      add(ledGeo, ledMats[i % ledMats.length], 0.335, 1.42, 0.1);
      // Glass front behind the screen.
      add(new THREE.BoxGeometry(0.6, 0.9, 0.01), glass, 0, 1.36, 0.105, -0.06);
      // Screen: a quad whose UVs point at this cabinet's cell of the shared atlas.
      const sg = new THREE.PlaneGeometry(0.56, 0.78);
      const uv = sg.attributes.uv as THREE.BufferAttribute;
      const cx = c.cell % 4,
        cy = Math.floor(c.cell / 4);
      for (let k = 0; k < uv.count; k++) uv.setXY(k, (cx + uv.getX(k)) / 4, (1 - cy - 1 + uv.getY(k)) / 2 + 0.0);
      add(sg, screenMat, 0, 1.36, 0.115, -0.06);
      const bezel = add(new THREE.BoxGeometry(0.62, 0.84, 0.012), gold, 0, 1.36, 0.104, -0.06);
      bezel.scale.set(1, 1, 1);
      // Marquee: one row of the name atlas.
      const mg = new THREE.PlaneGeometry(0.62, 0.3);
      const mv = mg.attributes.uv as THREE.BufferAttribute;
      const row = i % NAMES.length;
      for (let k = 0; k < mv.count; k++) mv.setXY(k, mv.getX(k), (NAMES.length - 1 - row + mv.getY(k)) / NAMES.length);
      add(mg, marqueeMat, 0, 2.17, 0.042);
      // Stool.
      add(seat, leather, 0, 0.66, 0.78);
      add(pole, gold, 0, 0.32, 0.78);
      add(foot, gold, 0, 0.015, 0.78);
      // Bulbs along the top edge of the marquee.
      m.updateMatrixWorld(true);
      for (let b = 0; b < this.bulbsPer; b++) {
        tmp.position.set(-0.3 + (b / (this.bulbsPer - 1)) * 0.6, 2.39, 0.05).applyMatrix4(m.matrixWorld);
        tmp.updateMatrix();
        this.bulbs.setMatrixAt(i * this.bulbsPer + b, tmp.matrix);
        this.bulbs.setColorAt(i * this.bulbsPer + b, new THREE.Color(0xfff0b0));
      }
      // Colliders: cabinet and stool.
      this.world.addLocalBox(m, 0, -0.05, 0.7, 0.62);
      this.world.addLocalBox(m, 0, 0.78, 0.36, 0.36);

      // Some machines have someone playing (fewer on lighter devices, so the
      // crowd budget also covers people mingling on the floor).
      const occ = { desktop: 4, quest3: 3, quest2: 2, mobile: 2 }[this.ctx.quality.name] ?? 4;
      if ((i * 7) % 10 < occ) {
        const seatPos = new THREE.Vector3(0, 0, 0.8).applyMatrix4(m.matrixWorld);
        const p = this.crowd.add('slots', randomLook(), seatPos, c.yaw + Math.PI);
        if (p) {
          c.occupied = true;
          p.onUpdate = (pp) => {
            if (pp.action <= 0 && Math.random() < 0.012) {
              pp.actionKind = 'tap';
              pp.action = 0.5;
            }
          };
          c.bulbStart = i;
          (c as Cabinet & { person?: typeof p }).person = p;
        }
      }
    });
    g.add(this.bulbs);
    // Sign towers in the middle of each carousel (only if its machines made the cut).
    const towerBody = new THREE.MeshStandardMaterial({ color: 0x1a0c10, roughness: 0.4 });
    const signMat = new THREE.MeshBasicMaterial({ map: this.marqueeAtlas(), toneMapped: false });
    this.carousels.forEach(([cx, cz], n) => {
      if (!this.cabinets.some((c) => Math.hypot(c.pos.x - cx, c.pos.z - cz) < 1.2)) return;
      const t = new THREE.Group();
      t.position.set(cx, 0, cz);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 2.1, 24), towerBody);
      col.position.y = 1.05;
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.55, 32, 1, true), signMat);
      const uv = drum.geometry.attributes.uv as THREE.BufferAttribute;
      const row = (n * 3 + 2) % NAMES.length;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, (uv.getX(k) * 2) % 1.0001, (NAMES.length - 1 - row + uv.getY(k)) / NAMES.length);
      drum.position.y = 2.75;
      const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.06, 32), gold);
      capTop.position.y = 3.05;
      const capBot = capTop.clone();
      capBot.position.y = 2.45;
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 12), gold);
      crown.position.y = 3.25;
      t.add(col, drum, capTop, capBot, crown);
      g.add(t);
      this.world.addCircle(cx, cz, 0.6);
    });
    bakeStatic(g);
    // The seat faces the machine: people at a machine look toward -Z of the person frame.
    for (const c of this.cabinets) {
      const p = (c as Cabinet & { person?: { yaw: number; homeYaw: number } }).person;
      if (p) p.yaw = p.homeYaw = c.yaw + Math.PI;
    }
    this.drawScreens(0);
  }

  private marqueeAtlas(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 96 * NAMES.length;
    const g = c.getContext('2d')!;
    NAMES.forEach((name, i) => {
      const y = i * 96;
      const grad = g.createLinearGradient(0, y, 0, y + 96);
      grad.addColorStop(0, '#1a0a20');
      grad.addColorStop(0.5, '#3a1a40');
      grad.addColorStop(1, '#1a0a20');
      g.fillStyle = grad;
      g.fillRect(0, y, 512, 96);
      g.font = 'italic bold 52px Georgia, serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = '#ffcc66';
      g.shadowBlur = 16;
      const tg = g.createLinearGradient(0, y + 20, 0, y + 76);
      tg.addColorStop(0, '#fff5cf');
      tg.addColorStop(1, '#d89a34');
      g.fillStyle = tg;
      g.fillText(name, 256, y + 50);
      g.shadowBlur = 0;
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** Redraws the shared screen atlas: slow-scrolling reels, and a WIN flash where someone hit. */
  private drawScreens(time: number) {
    const g = this.screenCanvas.getContext('2d')!;
    const wins = new Set(this.cabinets.filter((c) => c.winUntil > time).map((c) => c.cell));
    for (let cell = 0; cell < CELLS; cell++) {
      const x0 = (cell % 4) * CELL,
        y0 = Math.floor(cell / 4) * CELL_H;
      const a = this.atlases[cell % this.atlases.length];
      const hue = (cell * 47) % 360;
      const bg = g.createLinearGradient(0, y0, 0, y0 + CELL_H);
      bg.addColorStop(0, `hsl(${hue},55%,22%)`);
      bg.addColorStop(1, `hsl(${hue},60%,8%)`);
      g.fillStyle = bg;
      g.fillRect(x0, y0, CELL, CELL_H);
      const cols = 3,
        s = CELL / 3.3;
      for (let col = 0; col < cols; col++) {
        const off = (time * (0.6 + col * 0.25) + cell) % 1;
        for (let r = -1; r < 5; r++) {
          const id = Math.abs((r + col * 3 + cell * 5 + Math.floor(time * (0.6 + col * 0.25) + cell)) % a.ids);
          g.drawImage(a.canvas, id * 96, 0, 96, 96, x0 + 8 + col * (s + 4), y0 + 46 + (r + off - 0.5) * s, s, s);
        }
      }
      if (wins.has(cell)) {
        g.fillStyle = 'rgba(30,10,0,0.55)';
        g.fillRect(x0, y0, CELL, CELL_H);
        g.font = 'bold 54px Georgia, serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = Math.floor(time * 6) % 2 ? '#ffe28a' : '#ff9a3a';
        g.fillText('WIN!', x0 + CELL / 2, y0 + CELL_H / 2);
      }
      g.strokeStyle = '#d8b25a';
      g.lineWidth = 4;
      // Jackpot meter across the top of each screen.
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(x0, y0, CELL, 40);
      g.font = 'bold 24px Georgia, serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#ffd25a';
      const jp = 1000 + ((cell * 7919) % 9000) + time * (3 + cell);
      g.fillText('$' + jp.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), x0 + CELL / 2, y0 + 21);
      g.strokeRect(x0 + 2, y0 + 2, CELL - 4, CELL_H - 4);
    }
    this.screenTex.needsUpdate = true;
  }

  update(time: number, playerPos: THREE.Vector3) {
    // ~8 fps is plenty for attract screens and keeps texture uploads cheap.
    if (time - this.lastDraw > 0.12) {
      this.lastDraw = time;
      this.drawScreens(time);
      const on = new THREE.Color(0xfff0b0),
        off = new THREE.Color(0x4a3518),
        hot = new THREE.Color(0xff5a3a);
      const phase = Math.floor(time * 6);
      this.cabinets.forEach((c, i) => {
        const winning = c.winUntil > time;
        for (let b = 0; b < this.bulbsPer; b++) {
          const lit = (b + phase + i) % 3 !== 0;
          this.bulbs.setColorAt(i * this.bulbsPer + b, winning ? (lit ? hot : on) : lit ? on : off);
        }
      });
      this.bulbs.instanceColor!.needsUpdate = true;
    }
    // Every so often someone hits.
    if (time > this.nextWin) {
      this.nextWin = time + 5 + Math.random() * 10;
      const busy = this.cabinets.filter((c) => c.occupied);
      const c = busy[Math.floor(Math.random() * busy.length)];
      if (c) {
        const big = Math.random() < 0.25;
        c.winUntil = time + (big ? 4 : 2);
        const at = c.pos.clone().setY(1.4);
        // Only audible nearby; the room tone covers the rest.
        if (at.distanceTo(playerPos) < 14) this.ctx.sound.play(big ? 'winBig' : 'winSmall', at, { volume: big ? 0.7 : 0.45 });
        const person = (c as Cabinet & { person?: { cheer: number } }).person;
        if (person) person.cheer = big ? 2.2 : 1.2;
        if (big) this.crowd.react(c.pos, 2.5, 'cheer');
      }
    }
  }
}
