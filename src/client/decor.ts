import { assets } from './assets';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { LAGO_FORTUNA, ROYAL_CONSERVATORY, DIAMOND_SEVENS } from '../rules/machines';
import type { GameContext } from './game';
import { bakeStatic } from './merge';
import type { Crowd, Person } from './people';
import { envelope, handTo } from './gestures';
import { randomLook } from './people';
import { symbolAtlas } from './slots/symbols';
import { SEAT_R, type World } from './world';

/**
 * Rows of slot machines that fill out the floor. They are scenery, but the
 * guests sitting at them really play: every 6–15 s they press spin, the three
 * reels of *their* machine spin and stop one by one, and now and then they win
 * (lights chase, the reels flash, the guest cheers). It all costs a handful of
 * draw calls: cabinets are merged, every screen's backdrop shares one texture
 * atlas, every reel of every machine is one instanced quad whose texture
 * offset (a per-instance attribute) scrolls a shared reel-strip texture, and
 * the marquee bulbs are one instanced mesh.
 */

const NAMES = ['Golden Gondola', 'Venetian Nights', 'Lucky Lanterns', 'Fortune Fountains', 'Midnight Opera', 'Riviera Gold', 'Cypress Crown', 'Starlit Lake'];
const CELLS = 8; // distinct screen animations in the atlas (4 x 2)
const CELL = 192; // atlas cell width
const CELL_H = 256; // portrait screens
const SCREEN_W = 0.56,
  SCREEN_H = 0.78;
/** Reel windows on the screen (screen-local metres): three reels side by side. */
const REEL_W = 0.16,
  REEL_H = 0.36,
  REEL_Y = 0.04,
  REEL_X = [-0.175, 0, 0.175];
/** Symbols per reel strip; a window shows three of them. */
const STRIP = 12;
const STRIP_CELL = 96;
/** Machines further than this (or off screen) don't animate their reels. */
const LIVE_DIST = 12;
/** Reel flashes and marquee bulbs (made once, not every frame). */
const COLORS = {
  flashA: new THREE.Color(1.5, 1.25, 0.55),
  flashB: new THREE.Color(1, 1, 1),
  idle: new THREE.Color(0.92, 0.92, 0.92),
  on: new THREE.Color(0xfff0b0),
  off: new THREE.Color(0x4a3518),
  hot: new THREE.Color(0xff5a3a),
};

interface Reel {
  /** Strip offset shown now (in strip lengths; 1/STRIP per symbol). */
  cur: number;
  from: number;
  to: number;
  t0: number;
  t1: number;
  stopped: boolean;
}

interface Cabinet {
  pos: THREE.Vector3;
  yaw: number;
  cell: number;
  occupied: boolean;
  winUntil: number;
  bulbStart: number;
  person?: Person;
  /** Where the guest presses spin (world). */
  button: THREE.Vector3;
  /** Middle of the stool (world): the player sitting there blocks the guest's play. */
  seat: THREE.Vector3;
  reels: Reel[];
  spinning: boolean;
  /** When the guest next presses spin, and when they last did. */
  nextSpin: number;
  pressT: number;
  outcome: 'lose' | 'win' | 'big';
}

export class SlotRows {
  private cabinets: Cabinet[] = [];
  private screenCanvas: HTMLCanvasElement;
  private screenTex: THREE.CanvasTexture;
  private bulbs!: THREE.InstancedMesh;
  private atlases: { canvas: HTMLCanvasElement; ids: number }[];
  private lastDraw = 0;
  private bulbsPer = 12;
  private reelMesh!: THREE.InstancedMesh;
  private reelAttr!: THREE.InstancedBufferAttribute;
  /** Which strip symbol sits on each row of each machine type's reel strip. */
  private strips: number[][] = [];
  private time = 0;
  private frustum = new THREE.Frustum();
  private pm = new THREE.Matrix4();
  private sphere = new THREE.Sphere(new THREE.Vector3(), 1.3);
  private bank: THREE.Sphere | null = null;
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
    const reels = [0, 1, 2].map((r) => {
      const cur = ((k * 5 + r * 7) % STRIP) / STRIP;
      return { cur, from: cur, to: cur, t0: 0, t1: 0, stopped: true };
    });
    return {
      pos: new THREE.Vector3(x, 0, z),
      yaw,
      cell: k % CELLS,
      occupied: false,
      winUntil: 0,
      bulbStart: 0,
      button: new THREE.Vector3(),
      seat: new THREE.Vector3(),
      reels,
      spinning: false,
      nextSpin: 3 + Math.random() * 12,
      pressT: -10,
      outcome: 'lose',
    };
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
    this.makeReels();
    const screenFrame = new THREE.Matrix4(),
      reelM = new THREE.Matrix4();

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
      const sg = new THREE.PlaneGeometry(SCREEN_W, SCREEN_H);
      const uv = sg.attributes.uv as THREE.BufferAttribute;
      const cx = c.cell % 4,
        cy = Math.floor(c.cell / 4);
      for (let k = 0; k < uv.count; k++) uv.setXY(k, (cx + uv.getX(k)) / 4, (1 - cy + uv.getY(k)) / 2);
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
      // Three reels in front of the screen backdrop (one instanced draw for all machines).
      screenFrame.copy(m.matrixWorld).multiply(reelM.makeTranslation(0, 1.36, 0.115)).multiply(new THREE.Matrix4().makeRotationX(-0.06));
      for (let r = 0; r < 3; r++) {
        reelM.makeTranslation(REEL_X[r], REEL_Y, 0.003).scale(new THREE.Vector3(REEL_W, REEL_H, 1));
        this.reelMesh.setMatrixAt(i * 3 + r, reelM.premultiply(screenFrame));
        this.reelAttr.setXY(i * 3 + r, c.cell % 3, c.reels[r].cur);
      }
      c.button.set(0.17, 0.92, 0.26).applyMatrix4(m.matrixWorld);
      c.seat.set(0, 0, 0.78).applyMatrix4(m.matrixWorld);
      // Collider for the cabinet (with its sloped deck); the stool is a seat you can sit on.
      this.world.addLocalBox(m, 0, 0.02, 0.72, 0.68, 'slot machine');
      this.world.addLocalSeat(m, 0, 0.78, SEAT_R, 0.7, Math.PI, 'slot stool');

      // Some machines have someone playing (fewer on lighter devices, so the
      // crowd budget also covers people mingling on the floor).
      const occ = { desktop: 4, quest3: 3, quest2: 2, mobile: 2 }[this.ctx.quality.name] ?? 4;
      if ((i * 7) % 10 < occ) {
        const seatPos = new THREE.Vector3(0, 0, 0.8).applyMatrix4(m.matrixWorld);
        const p = this.crowd.add('slots', randomLook(), seatPos, c.yaw + Math.PI);
        if (p) {
          c.occupied = true;
          c.bulbStart = i;
          c.person = p;
          // Reach out and press spin (animated characters; the simple bodies use the 'tap' action).
          const hold = new THREE.Vector3();
          p.onPose = (pp) => {
            const w = envelope(this.time, c.pressT, c.pressT + 0.8, 0.3);
            if (w <= 0) return;
            const dip = Math.sin(THREE.MathUtils.clamp((this.time - c.pressT - 0.25) / 0.3, 0, 1) * Math.PI);
            hold.copy(c.button);
            hold.y += 0.05 - dip * 0.045;
            handTo(pp, 'R', hold, w);
          };
        }
      }
    });
    g.add(this.bulbs);
    g.add(this.reelMesh);
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
      this.world.addCircle(cx, cz, 0.6, 'sign tower');
    });
    // (Static decor: materials alike but for colour share a draw.)
    bakeStatic(g, { byColor: true });
    // The seat faces the machine: people at a machine look toward -Z of the person frame.
    for (const c of this.cabinets) if (c.person) c.person.yaw = c.person.homeYaw = c.yaw + Math.PI;
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

  /**
   * The reels: one instanced quad per reel, each showing three symbols of a
   * shared reel-strip texture (a column per machine theme). A per-instance
   * attribute picks the column and scrolls the strip; the shader shades the
   * window like a drum and draws the pay line.
   */
  private makeReels() {
    const cols = this.atlases.length;
    const c = document.createElement('canvas');
    c.width = STRIP_CELL * cols;
    c.height = STRIP_CELL * STRIP;
    const g = c.getContext('2d')!;
    let seed = 17;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    this.atlases.forEach((a, col) => {
      // Every symbol at least once, the rest random, no two the same in a row.
      const seq: number[] = [];
      for (let r = 0; r < STRIP; r++) seq.push(r < a.ids ? r : Math.floor(rnd() * a.ids));
      for (let r = STRIP - 1; r > 0; r--) {
        const j = Math.floor(rnd() * (r + 1));
        [seq[r], seq[j]] = [seq[j], seq[r]];
      }
      for (let r = 0; r < STRIP; r++) {
        if (seq[r] === seq[(r + 1) % STRIP]) {
          const j = (r + 3) % STRIP;
          [seq[(r + 1) % STRIP], seq[j]] = [seq[j], seq[(r + 1) % STRIP]];
        }
      }
      this.strips.push(seq);
      for (let r = 0; r < STRIP; r++) {
        const x = col * STRIP_CELL,
          y = r * STRIP_CELL;
        const bg = g.createLinearGradient(x, 0, x + STRIP_CELL, 0);
        bg.addColorStop(0, '#d8d2c4');
        bg.addColorStop(0.5, '#fffdf6');
        bg.addColorStop(1, '#d8d2c4');
        g.fillStyle = bg;
        g.fillRect(x, y, STRIP_CELL, STRIP_CELL);
        g.drawImage(a.canvas, seq[r] * 96, 0, 96, 96, x + 6, y + 6, STRIP_CELL - 12, STRIP_CELL - 12);
      }
    });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aReel;\nvarying vec2 vQuad;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv = vec2((aReel.x + uv.x) / ${cols}.0, aReel.y + uv.y * ${(3 / STRIP).toFixed(5)});\nvQuad = uv;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vQuad;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          diffuseColor.rgb *= 0.35 + 0.65 * sin(vQuad.y * 3.14159);
          float pay = 1.0 - smoothstep(0.004, 0.009, abs(vQuad.y - 0.5));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.08, 0.05), pay * 0.75);`,
        );
    };
    mat.customProgramCacheKey = () => 'slotReels';
    const geo = new THREE.PlaneGeometry(1, 1);
    this.reelAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.cabinets.length * 3 * 2), 2);
    this.reelAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aReel', this.reelAttr);
    this.reelMesh = new THREE.InstancedMesh(geo, mat, this.cabinets.length * 3);
    this.reelMesh.raycast = () => {};
    this.reelMesh.userData.dynamic = true;
    const white = new THREE.Color(0.92, 0.92, 0.92);
    for (let k = 0; k < this.cabinets.length * 3; k++) this.reelMesh.setColorAt(k, white);
  }

  /** Redraws the shared screen backdrops: theme colours, reel frames, and a ticking jackpot meter. */
  private drawScreens(time: number) {
    const g = this.screenCanvas.getContext('2d')!;
    const pxX = CELL / SCREEN_W,
      pxY = CELL_H / SCREEN_H;
    for (let cell = 0; cell < CELLS; cell++) {
      const x0 = (cell % 4) * CELL,
        y0 = Math.floor(cell / 4) * CELL_H;
      const hue = (cell * 47) % 360;
      const bg = g.createLinearGradient(0, y0, 0, y0 + CELL_H);
      bg.addColorStop(0, `hsl(${hue},55%,22%)`);
      bg.addColorStop(1, `hsl(${hue},60%,8%)`);
      g.fillStyle = bg;
      g.fillRect(x0, y0, CELL, CELL_H);
      // Gold frames round the reel windows (the reels themselves are drawn in front).
      g.strokeStyle = '#e8c46a';
      g.lineWidth = 3;
      for (const rx of REEL_X) {
        const l = x0 + (rx - REEL_W / 2 + SCREEN_W / 2) * pxX,
          t = y0 + (SCREEN_H / 2 - REEL_Y - REEL_H / 2) * pxY;
        g.strokeRect(l - 2, t - 2, REEL_W * pxX + 4, REEL_H * pxY + 4);
      }
      // Credits and bet under the reels.
      g.font = 'bold 15px Georgia, serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#f4e2b0';
      const by = y0 + (SCREEN_H / 2 - REEL_Y + REEL_H / 2) * pxY;
      g.fillText('BET 5  ·  LINES 1', x0 + CELL / 2, by + 22);
      g.fillStyle = '#ffd25a';
      g.font = 'bold 18px Georgia, serif';
      g.fillText('SPIN TO WIN', x0 + CELL / 2, by + 48);
      // Jackpot meter across the top of each screen.
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(x0, y0, CELL, 40);
      g.font = 'bold 24px Georgia, serif';
      g.fillStyle = '#ffd25a';
      const jp = 1000 + ((cell * 7919) % 9000) + time * (3 + cell);
      g.fillText('$' + jp.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), x0 + CELL / 2, y0 + 21);
      g.strokeStyle = '#d8b25a';
      g.lineWidth = 4;
      g.strokeRect(x0 + 2, y0 + 2, CELL - 4, CELL_H - 4);
    }
    this.screenTex.needsUpdate = true;
  }

  /** The guest at `c` presses spin: pick the result and set the reels going. */
  private spin(c: Cabinet, time: number, live: boolean) {
    const strip = this.strips[c.cell % this.strips.length];
    const roll = Math.random();
    c.outcome = roll < 0.025 ? 'big' : roll < 0.17 ? 'win' : 'lose';
    // Strip rows to land on the pay line, one per reel.
    const rowsOf = (sym: number) => strip.map((s, r) => (s === sym ? r : -1)).filter((r) => r >= 0);
    let rows: number[];
    if (c.outcome !== 'lose') {
      const sym = strip[Math.floor(Math.random() * STRIP)];
      const opts = rowsOf(sym);
      rows = [0, 1, 2].map(() => opts[Math.floor(Math.random() * opts.length)]);
    } else {
      do rows = [0, 1, 2].map(() => Math.floor(Math.random() * STRIP));
      while (strip[rows[0]] === strip[rows[1]] && strip[rows[1]] === strip[rows[2]]);
    }
    c.pressT = time;
    c.spinning = true;
    if (c.person) {
      c.person.actionKind = 'tap';
      c.person.action = 0.5;
    }
    if (live) this.ctx.sound.play('reelTick', c.button, { volume: 0.25, rate: 0.9 + Math.random() * 0.2 });
    c.reels.forEach((r, i) => {
      // Strip row n sits on the pay line (mid-window) at offset (STRIP - 2 - n) / STRIP.
      const k = (STRIP - 2 - rows[i] + STRIP) % STRIP;
      r.from = r.cur - Math.floor(r.cur);
      r.to = k / STRIP + 3 + i;
      r.t0 = time + 0.45;
      r.t1 = r.t0 + 1.0 + i * 0.45;
      r.stopped = false;
    });
  }

  update(time: number, playerPos: THREE.Vector3, camera?: THREE.Camera) {
    this.time = time;
    if (camera) {
      camera.updateMatrixWorld();
      this.frustum.setFromProjectionMatrix(this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    }
    // The whole bank: is any of it near, and in view? (Off in the lobby, the suite or the
    // Promenade its screens and bulbs needn't redraw at all.)
    if (!this.bank) {
      const b = new THREE.Box3();
      for (const c of this.cabinets) b.expandByPoint(c.pos);
      this.bank = b.getBoundingSphere(new THREE.Sphere());
      this.bank.center.y = 1.4;
      this.bank.radius += 1.5;
    }
    const bankDist = Math.max(0, this.bank.center.distanceTo(playerPos) - this.bank.radius);
    const bankSeen = bankDist < 30 && (!camera || this.frustum.intersectsSphere(this.bank));
    // The jackpot meters tick over a few times a second (small texture upload); once a second from afar.
    if (bankSeen && time - this.lastDraw > (bankDist < LIVE_DIST ? 0.25 : 1)) {
      this.lastDraw = time;
      this.drawScreens(time);
    }
    let reelsDirty = false,
      colorsDirty = false;
    const { flashA, flashB, idle } = COLORS;
    this.cabinets.forEach((c, i) => {
      // Only machines near you and in view animate their reels and make noise.
      this.sphere.center.set(c.pos.x, 1.4, c.pos.z);
      const near = c.pos.distanceTo(playerPos) < LIVE_DIST;
      const live = near && (!camera || this.frustum.intersectsSphere(this.sphere));
      if (c.person && c.person.seated && !c.spinning && time > c.nextSpin) {
        c.nextSpin = time + 6 + Math.random() * 9;
        // Not while you're sitting on that stool.
        const sitting = Math.hypot(playerPos.x - c.seat.x, playerPos.z - c.seat.z) < 0.45;
        if (!sitting) this.spin(c, time, live);
      }
      if (c.spinning) {
        let done = true;
        c.reels.forEach((r, k) => {
          if (r.stopped && time > r.t1 + 0.25) return;
          if (!live) {
            // Off screen or far away: just land on the result.
            r.cur = r.to - Math.floor(r.to);
            r.stopped = true;
            reelsDirty = true;
            return;
          }
          if (time >= r.t1) {
            if (!r.stopped) {
              r.stopped = true;
              this.ctx.sound.play('reelStop', c.button, { volume: 0.22, rate: 0.95 + k * 0.05 });
            }
            // A little bounce as the reel settles.
            const u = Math.min(1, (time - r.t1) / 0.25);
            r.cur = r.to - 0.02 * Math.sin(u * Math.PI) * (1 - u);
            if (u < 1) done = false;
          } else {
            done = false;
            const u = Math.max(0, (time - r.t0) / (r.t1 - r.t0));
            // Wind back a touch, then spin up and slow into the stop.
            const wind = time < r.t0 ? -0.03 * Math.sin(((time - (r.t0 - 0.45)) / 0.45) * Math.PI) : 0;
            r.cur = r.from + (r.to - r.from) * (1 - (1 - u) ** 2.4) + wind;
          }
          this.reelAttr.setY(i * 3 + k, r.cur);
          reelsDirty = true;
        });
        if (!live) c.reels.forEach((r, k) => this.reelAttr.setY(i * 3 + k, r.cur));
        if (done || c.reels.every((r) => r.stopped && !live)) {
          c.spinning = false;
          for (const r of c.reels) r.cur -= Math.floor(r.cur);
          if (c.outcome !== 'lose') this.celebrate(c, time, live, playerPos);
        }
      }
      // Winning reels flash.
      const winning = c.winUntil > time;
      if (winning || c.winUntil > time - 0.5) {
        const on = winning && Math.floor(time * 6) % 2 === 0;
        for (let k = 0; k < 3; k++) this.reelMesh.setColorAt(i * 3 + k, winning ? (on ? flashA : flashB) : idle);
        colorsDirty = true;
      }
    });
    if (reelsDirty) this.reelAttr.needsUpdate = true;
    if (colorsDirty) this.reelMesh.instanceColor!.needsUpdate = true;

    // Marquee bulbs chase (and run hot on a winning machine).
    if (bankSeen && time - this.bulbT > (bankDist < LIVE_DIST ? 0.12 : 0.24)) {
      this.bulbT = time;
      const { on, off, hot } = COLORS;
      const phase = Math.floor(time * 6);
      this.cabinets.forEach((c, i) => {
        const winning = c.winUntil > time;
        const ph = winning ? Math.floor(time * 14) : phase;
        for (let b = 0; b < this.bulbsPer; b++) {
          const lit = (b + ph + i) % 3 !== 0;
          this.bulbs.setColorAt(i * this.bulbsPer + b, winning ? (lit ? hot : on) : lit ? on : off);
        }
      });
      this.bulbs.instanceColor!.needsUpdate = true;
    }
  }
  private bulbT = 0;

  private celebrate(c: Cabinet, time: number, live: boolean, playerPos: THREE.Vector3) {
    const big = c.outcome === 'big';
    c.winUntil = time + (big ? 5 : 2.2);
    // Only audible nearby; the room tone covers the rest.
    if (live || c.pos.distanceTo(playerPos) < 8) this.ctx.sound.play(big ? 'winBig' : 'winSmall', c.button, { volume: big ? 0.55 : 0.3 });
    if (c.person) c.person.cheer = big ? 2.2 : 1.2;
    // Neighbours look over at a big one (and sometimes a small one).
    if (big) this.crowd.react(c.pos, 2.5, 'cheer');
    else if (Math.random() < 0.2) this.crowd.react(c.pos, 1.3, 'cheer');
  }
}
