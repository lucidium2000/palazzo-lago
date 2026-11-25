import * as THREE from 'three';
import { betInfo, CrapsBetRejected, CrapsGame, MAX_ODDS, isPoint, type RollResult } from '../../rules/craps';
import { assets } from '../assets';
import { CHIP_HEIGHT, makeChip, makeChipStack } from '../chips';
import { ChipRail } from '../chiprail';
import { easeInOut, money, Tweens, type GameContext } from '../game';
import type { Grabbable } from '../hands';
import { bakeStatic, dynamic } from '../merge';
import { CanvasPanel, GOLD, GOLD_LIGHT, roundRect, SERIF } from '../panel';
import type { Viewpoint } from '../player';
import { canvas, CHIP_DENOMS, radial, toTexture, wood, type ChipDenom } from '../textures';
import { DIE, faceFix, poseAt, simulateThrow, type DicePlan, type DieFrame } from './dicesim';
import { anchorPx, BED, crapsFelt, localToPx, pxToLocal, puckPx, regionAt } from './felt';

/** A 12-ft Strip craps table: felt 72 cm up, rail 98 cm, 26 cm deep tub. */
export const FELT_Y = 0.72;
const RAIL_Y = 0.98;
const OUT = { w: 3.66, d: 1.62 };
const HX = BED.w / 2;
const HZ = BED.d / 2;
/** Where the shooter stands (table-local), and where the stickman sends the dice. */
const SHOOTER = new THREE.Vector3(1.15, 0, OUT.d / 2 + 0.32);
const DICE_HOME = new THREE.Vector3(1.1, DIE / 2, HZ - 0.1);

const PAYS: Record<string, string> = {
  pass: 'even money',
  dontPass: 'even money · bar 12',
  come: 'even money',
  dontCome: 'even money · bar 12',
  field: '2 pays double · 12 pays triple',
  big6: 'even money',
  big8: 'even money',
  hard4: '7 to 1',
  hard10: '7 to 1',
  hard6: '9 to 1',
  hard8: '9 to 1',
  any7: '4 to 1 · one roll',
  anyCraps: '7 to 1 · one roll',
  two: '30 to 1 · one roll',
  twelve: '30 to 1 · one roll',
  three: '15 to 1 · one roll',
  eleven: '15 to 1 · one roll',
  ceC: 'any craps 7 to 1',
  ceE: 'eleven 15 to 1',
};
const PLACE_PAYS: Record<number, string> = { 4: '9 to 5', 10: '9 to 5', 5: '7 to 5', 9: '7 to 5', 6: '7 to 6 · bet $6s', 8: '7 to 6 · bet $6s' };
const ODDS_PAYS: Record<number, string> = { 4: '2 to 1', 10: '2 to 1', 5: '3 to 2', 9: '3 to 2', 6: '6 to 5', 8: '6 to 5' };

type Phase = 'betting' | 'rolling' | 'paying';
/** The VR panel sits this far to the right of your chips, so it doesn't hide them. */
const PANEL_FROM_RAIL = 0.68;

export class CrapsTable {
  readonly group = new THREE.Group();
  readonly game: CrapsGame;
  readonly viewpoint: Viewpoint;
  readonly grabbables: Grabbable[] = [];
  chip: ChipDenom = 5;
  phase: Phase = 'betting';
  /** Hooks for the stickman, the crowd and the crew. */
  onRoll: (() => void) | null = null;
  onResult: ((r: RollResult) => void) | null = null;

  private ctx: GameContext;
  private felt: THREE.Mesh;
  private stacks = new Map<string, THREE.Group>();
  private tweens = new Tweens();
  private dice: THREE.Mesh[] = [];
  private pucks: THREE.Mesh[] = [];
  private ghost: THREE.Group;
  private panel: CanvasPanel;
  private hover: string | null = null;
  private undoStack: { id: string; amount: number }[] = [];
  private roll: { plan: DicePlan; t: number; result: RollResult; hit: number; fix: THREE.Quaternion[] } | null = null;
  private pose: [DieFrame, DieFrame] = [
    { p: new THREE.Vector3(), q: new THREE.Quaternion() },
    { p: new THREE.Vector3(), q: new THREE.Quaternion() },
  ];
  private last: RollResult | null = null;
  private puckMat: { on: THREE.Material; off: THREE.Material };
  private diceInHand = false;
  /** Where the stickman leaves the dice for the shooter (table-local, on the felt by the rail). */
  private diceHome = DICE_HOME.clone();
  private offeredAt = -1e9;
  /** Your chips on the rail (VR: pick them up and set them on the layout). */
  readonly rail: ChipRail;
  /** Winnings already credited but still being pushed to you by the dealers. */
  private away = 0;

  constructor(ctx: GameContext, position: THREE.Vector3, yaw = 0) {
    this.ctx = ctx;
    this.game = new CrapsGame(ctx.bankroll);
    this.group.position.copy(position);
    this.group.rotation.y = yaw;
    ctx.scene.add(this.group);

    this.felt = this.buildTub();
    this.buildDice();
    this.puckMat = this.buildPucks();
    this.ghost = new THREE.Group();
    const g = makeChip(5);
    g.material = (g.material as THREE.Material[]).map((m) => Object.assign(m.clone(), { transparent: true, opacity: 0.55 }));
    this.ghost.add(g);
    this.ghost.visible = false;
    this.group.add(this.ghost);
    this.panel = this.buildPanel();
    this.rail = this.buildRail();
    this.buildDiceGrab();

    ctx.interaction.register({
      object: this.felt,
      kind: 'surface',
      enabled: () => this.phase === 'betting',
      label: (e) => {
        const id = this.betFor(this.regionFromLocal(e.local));
        return id ? this.describe(id) : null;
      },
      onHover: (e) => this.setHover(e ? this.betFor(this.regionFromLocal(e.local)) : null),
      onSelect: (e) => {
        const id = this.betFor(this.regionFromLocal(e.local));
        if (id) this.bet(id);
      },
    });

    const seat = SHOOTER.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(position);
    this.viewpoint = { id: 'craps', label: 'Craps', position: seat, yaw: yaw + 0.38, pitch: -0.5, eye: 1.74, back: 0.3 };
    this.group.updateMatrixWorld(true);
    this.viewpoint.portrait = { at: new THREE.Vector3(0.1, 0, 0.1).applyMatrix4(this.group.matrixWorld), yaw: yaw, back: 0.2, eye: 3.1, pitch: -1.3 };

    ctx.bankroll.onChange(() => this.panel.redraw());
    addEventListener('keydown', (e) => this.onKey(e));
    for (const d of this.dice) dynamic(d);
    for (const p of this.pucks) dynamic(p);
    dynamic(this.ghost);
    bakeStatic(this.group, { shadows: ctx.quality.shadows });
    this.placePucks(false);
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  private buildTub(): THREE.Mesh {
    const g = this.group;
    const q = this.ctx.quality;
    const woodTex = toTexture(wood(512));
    const walnut = assets.material('walnut', { repeat: [4, 1], rough: 0.5, fallback: () => new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.35 }) });
    const leather = assets.material('leather', { repeat: 4, rough: 0.8, tint: 0x5a2424, fallback: () => new THREE.MeshStandardMaterial({ color: 0x2a0d10, roughness: 0.55 }) });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 1, roughness: 0.3 });

    const rounded = (w: number, d: number, r: number, hole = false) => {
      const s = hole ? new THREE.Path() : new THREE.Shape();
      const x = w / 2,
        y = d / 2;
      s.moveTo(-x + r, -y);
      s.lineTo(x - r, -y);
      s.quadraticCurveTo(x, -y, x, -y + r);
      s.lineTo(x, y - r);
      s.quadraticCurveTo(x, y, x - r, y);
      s.lineTo(-x + r, y);
      s.quadraticCurveTo(-x, y, -x, y - r);
      s.lineTo(-x, -y + r);
      s.quadraticCurveTo(-x, -y, -x + r, -y);
      return s;
    };
    const flat = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = y;
      m.castShadow = q.shadows;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    // Pedestal base and the slab under the felt.
    const base = new THREE.Mesh(new THREE.BoxGeometry(OUT.w - 0.6, FELT_Y - 0.1, OUT.d - 0.6), new THREE.MeshStandardMaterial({ color: 0x140b07, roughness: 0.6 }));
    base.position.y = (FELT_Y - 0.1) / 2;
    g.add(base);
    flat(new THREE.ExtrudeGeometry(rounded(OUT.w, OUT.d, 0.18) as THREE.Shape, { depth: 0.1, bevelEnabled: false }), walnut, FELT_Y - 0.1);
    // Walls: an outer ring of walnut up to the rail.
    const ring = rounded(OUT.w, OUT.d, 0.18) as THREE.Shape;
    ring.holes.push(rounded(BED.w, BED.d, 0.02, true) as THREE.Path);
    flat(new THREE.ExtrudeGeometry(ring, { depth: RAIL_Y - 0.06 - FELT_Y, bevelEnabled: false, curveSegments: 8 }), walnut, FELT_Y);
    // Padded leather armrest along the top, with a chip groove inside it.
    const rail = rounded(OUT.w + 0.04, OUT.d + 0.04, 0.2) as THREE.Shape;
    rail.holes.push(rounded(OUT.w - 0.16, OUT.d - 0.16, 0.12, true) as THREE.Path);
    flat(new THREE.ExtrudeGeometry(rail, { depth: 0.035, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 3, curveSegments: 10 }), leather, RAIL_Y - 0.06);
    const groove = rounded(OUT.w - 0.16, OUT.d - 0.16, 0.12) as THREE.Shape;
    groove.holes.push(rounded(BED.w + 0.04, BED.d + 0.04, 0.03, true) as THREE.Path);
    flat(new THREE.ExtrudeGeometry(groove, { depth: 0.004, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: 0x0d3a22, roughness: 0.9 }), RAIL_Y - 0.075);
    // Brass drink rail under the armrest.
    const brass = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 8, 64), gold);
    brass.scale.set(OUT.w / 2 + 0.03, OUT.d / 2 + 0.03, 1);
    brass.rotation.x = Math.PI / 2;
    brass.position.y = RAIL_Y - 0.11;
    g.add(brass);

    // Rubber pyramids lining the inside walls.
    const [pc, p2] = canvas(256, 64);
    p2.fillStyle = '#121212';
    p2.fillRect(0, 0, 256, 64);
    for (let i = 0; i < 8; i++) {
      const x = i * 32;
      for (const [dx, col] of [[0, '#2c2c2c'], [16, '#060606']] as const) {
        p2.fillStyle = col;
        p2.beginPath();
        p2.moveTo(x + dx, 0);
        p2.lineTo(x + 16, 32);
        p2.lineTo(x + dx, 64);
        p2.fill();
      }
    }
    const pyrTex = toTexture(pc);
    pyrTex.wrapS = THREE.RepeatWrapping;
    const h = RAIL_Y - 0.08 - FELT_Y;
    const wallMat = (len: number) => {
      const t = pyrTex.clone();
      t.repeat.set(len / 0.08, 1);
      t.needsUpdate = true;
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 });
    };
    const wall = (len: number, x: number, z: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, h * 0.7), wallMat(len));
      m.position.set(x, FELT_Y + h * 0.42, z);
      m.rotation.y = ry;
      g.add(m);
    };
    wall(BED.d, -HX + 0.002, 0, Math.PI / 2);
    wall(BED.d, HX - 0.002, 0, -Math.PI / 2);
    wall(BED.w, 0, -HZ + 0.002, 0);
    wall(BED.w, 0, HZ - 0.002, Math.PI);

    // The felt.
    const tex = toTexture(crapsFelt());
    tex.anisotropy = 8;
    const felt = new THREE.Mesh(
      new THREE.PlaneGeometry(BED.w, BED.d),
      assets.material('velvet', { repeat: [14, 6], rough: 1, fallback: () => new THREE.MeshStandardMaterial({ roughness: 0.92 }) }).clone() as THREE.MeshStandardMaterial,
    );
    const fm = felt.material as THREE.MeshStandardMaterial;
    fm.map = tex;
    fm.color.set(0xffffff);
    fm.roughness = 0.92;
    if (fm.normalMap) fm.normalScale.set(0.25, 0.25);
    fm.aoMap = null;
    felt.rotation.x = -Math.PI / 2;
    felt.position.y = FELT_Y + 0.001;
    felt.receiveShadow = true;
    g.add(felt);

    // Dealers' chip bank in the middle of the far rail.
    const bank = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.03, 0.14), new THREE.MeshStandardMaterial({ color: 0x0b0806, roughness: 0.4 }));
    bank.position.set(0, RAIL_Y - 0.03, -OUT.d / 2 + 0.07);
    g.add(bank);
    const COLORS = [0xf2f0ea, 0xc0262d, 0x1e7a3a, 0x1b1b1f, 0x6b2f8f];
    const bankChips = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0195, 0.0195, 0.07, 16), new THREE.MeshStandardMaterial({ roughness: 0.5 }), COLORS.length * 3);
    const tmpB = new THREE.Object3D();
    COLORS.forEach((c, i) => {
      for (let j = 0; j < 3; j++) {
        tmpB.rotation.set(0, 0, Math.PI / 2);
        tmpB.position.set(-0.3 + i * 0.13 + j * 0.042, RAIL_Y - 0.003, -OUT.d / 2 + 0.07);
        tmpB.updateMatrix();
        bankChips.setMatrixAt(i * 3 + j, tmpB.matrix);
        bankChips.setColorAt(i * 3 + j, new THREE.Color(c));
      }
    });
    bankChips.raycast = () => {};
    g.add(bankChips);

    // Contact shadow on the carpet.
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(OUT.w + 1, OUT.d + 1),
      new THREE.MeshBasicMaterial({ map: toTexture(radial(128, 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0)')), transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.012;
    g.add(shadow);
    return felt;
  }

  private buildDice() {
    // One texture atlas for all six faces (3 x 2 cells) so each die is a single draw.
    const order = [2, 5, 1, 6, 3, 4]; // BoxGeometry faces: +x, -x, +y, -y, +z, -z
    const [c, g] = canvas(384, 256);
    order.forEach((n, i) => {
      const ox = (i % 3) * 128,
        oy = Math.floor(i / 3) * 128;
      g.fillStyle = '#b4101c';
      g.fillRect(ox, oy, 128, 128);
      const grd = g.createRadialGradient(ox + 64, oy + 64, 10, ox + 64, oy + 64, 90);
      grd.addColorStop(0, 'rgba(255,90,90,0.35)');
      grd.addColorStop(1, 'rgba(0,0,0,0.15)');
      g.fillStyle = grd;
      g.fillRect(ox, oy, 128, 128);
      const o = 34;
      const pips: Record<number, [number, number][]> = {
        1: [[0, 0]],
        2: [[-o, -o], [o, o]],
        3: [[-o, -o], [0, 0], [o, o]],
        4: [[-o, -o], [o, -o], [-o, o], [o, o]],
        5: [[-o, -o], [o, -o], [0, 0], [-o, o], [o, o]],
        6: [[-o, -o], [o, -o], [-o, 0], [o, 0], [-o, o], [o, o]],
      };
      g.fillStyle = '#fbfaf4';
      for (const [x, y] of pips[n]) {
        g.beginPath();
        g.arc(ox + 64 + x, oy + 64 + y, 11, 0, Math.PI * 2);
        g.fill();
      }
    });
    const mat = new THREE.MeshPhysicalMaterial({ map: toTexture(c), roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.3 });
    const geo = new THREE.BoxGeometry(DIE, DIE, DIE);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let f = 0; f < 6; f++) {
      const cx = f % 3,
        cy = Math.floor(f / 3);
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        uv.setXY(i, (cx + uv.getX(i)) / 3, 1 - (cy + 1 - uv.getY(i)) / 2);
      }
    }
    geo.clearGroups();
    for (let i = 0; i < 2; i++) {
      const body = new THREE.Mesh(geo, mat);
      body.castShadow = this.ctx.quality.shadows;
      body.raycast = () => {};
      body.position.copy(DICE_HOME).add(new THREE.Vector3(i * 0.03, FELT_Y, 0));
      body.rotation.y = i * 0.4;
      this.group.add(body);
      this.dice.push(body);
    }
  }

  private buildPucks() {
    const mk = (on: boolean) => {
      const [c, g] = canvas(128, 128);
      g.fillStyle = on ? '#f4f1ea' : '#121212';
      g.beginPath();
      g.arc(64, 64, 62, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = on ? '#121212' : '#f4f1ea';
      g.font = 'bold 44px Georgia, serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(on ? 'ON' : 'OFF', 64, 66);
      return new THREE.MeshStandardMaterial({ map: toTexture(c), roughness: 0.4 });
    };
    const side = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.4 });
    const on = mk(true),
      off = mk(false);
    const geo = new THREE.CylinderGeometry(0.035, 0.035, 0.012, 28);
    for (let i = 0; i < 2; i++) {
      const p = new THREE.Mesh(geo, [side, off, off]);
      p.raycast = () => {};
      this.group.add(p);
      this.pucks.push(p);
    }
    return { on, off };
  }

  private placePucks(animate: boolean) {
    const spots = puckPx(this.game.point);
    this.pucks.forEach((p, i) => {
      const [x, z] = pxToLocal(...spots[i]);
      const to = new THREE.Vector3(x, FELT_Y + 0.007, z);
      const mats = p.material as THREE.Material[];
      const m = this.game.point ? this.puckMat.on : this.puckMat.off;
      if (!animate) {
        p.position.copy(to);
        mats[1] = mats[2] = m;
        return;
      }
      const from = p.position.clone();
      this.tweens.add(0.6, (k) => {
        const e = easeInOut(k);
        p.position.lerpVectors(from, to, e);
        p.position.y += Math.sin(k * Math.PI) * 0.05;
        if (k > 0.5) mats[1] = mats[2] = m;
      });
    });
  }

  private buildPanel(): CanvasPanel {
    const p = new CanvasPanel(0.74, 1560, 420);
    p.mesh.position.set(SHOOTER.x - 0.35 + PANEL_FROM_RAIL, RAIL_Y + 0.1, OUT.d / 2 + 0.06);
    p.mesh.rotation.x = -1.0;
    this.group.add(p.mesh);
    p.background = (ctx) => {
      roundRect(ctx, 4, 4, p.pxW - 8, p.pxH - 8, 28);
      ctx.fillStyle = 'rgba(16,11,8,0.86)';
      ctx.fill();
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = GOLD_LIGHT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `600 46px ${SERIF}`;
      ctx.fillText(`Chips ${money(this.ctx.bankroll.balance)}`, 40, 60);
      ctx.textAlign = 'right';
      ctx.fillText(`On the felt ${money(this.game.totalOnTable)}`, p.pxW - 40, 60);
      ctx.textAlign = 'center';
      ctx.font = `italic 32px ${SERIF}`;
      ctx.fillStyle = '#cbb991';
      ctx.fillText(this.status(), p.pxW / 2, 60);
      ctx.textAlign = 'left';
      ctx.font = `italic 30px ${SERIF}`;
      ctx.fillStyle = '#a99670';
      ctx.fillText('Your chips are on the rail below: pick some up', 40, 150);
      ctx.fillText('and set them down on a bet. Pick a bet back up', 40, 192);
      ctx.fillText('to take it down.', 40, 234);
    };
    const btn = (id: string, x: number, label: string, onPress: () => void, enabled: () => boolean) => p.add({ id, x, y: 270, w: 200, h: 110, label, onPress, enabled });
    btn('undo', 40, 'Undo', () => this.undo(), () => this.canUndo);
    btn('clear', 260, 'Take down', () => this.clear(), () => this.canClear);
    btn('odds', 480, 'Max odds', () => this.maxOdds(), () => this.canOdds);
    p.add({
      id: 'roll',
      x: 940,
      y: 130,
      w: 580,
      h: 250,
      label: () => (this.phase === 'betting' ? 'ROLL' : 'Dice are out'),
      sub: () => (this.phase === 'betting' ? (this.game.point ? `point is ${this.game.point}` : 'come-out roll') : ''),
      enabled: () => this.canRoll,
      active: () => this.canRoll,
      onPress: () => this.throwDice(),
    });
    p.register(this.ctx.interaction);
    p.redraw();
    return p;
  }

  /** Your chips in the rail groove in front of you: they always add up to your balance. */
  private buildRail(): ChipRail {
    const rail = new ChipRail({
      parent: this.group,
      denoms: CHIP_DENOMS,
      sound: this.ctx.sound,
      spacing: 0.055,
      balance: () => this.ctx.bankroll.balance,
      away: () => this.away,
      visible: () => this.ctx.hud.station === 'craps',
      canGrab: () => this.phase === 'betting',
      place: (world, amount) => {
        const id = this.betAtWorld(world);
        return !!id && this.bet(id, amount);
      },
      hover: (world, d) => this.setHover(world ? this.betAtWorld(world) : null, d),
      spots: () => {
        const out = [];
        for (const id of this.game.bets.keys()) {
          const st = this.stacks.get(id);
          if (!st || !this.game.canRemove(id)) continue;
          const at = this.group.localToWorld(st.position.clone().setY(st.position.y + st.children.length * CHIP_HEIGHT + 0.01));
          out.push({ at, take: () => this.takeDown(id) });
        }
        return out;
      },
      interaction: this.ctx.interaction,
      onPick: (d) => this.selectChip(d),
      selected: () => this.chip,
    });
    rail.group.position.set(SHOOTER.x - 0.35, RAIL_Y - 0.07, OUT.d / 2 - 0.06);
    for (const g of rail.grabbables) this.grabbables.push(g);
    return rail;
  }

  /**
   * Your chips (and the VR panel beside them) follow you along the near rail,
   * wherever you stand to play: chips a little to your left, panel to your right.
   */
  standAt(feet: THREE.Vector3) {
    const l = this.group.worldToLocal(feet.clone());
    if (l.z < HZ || Math.abs(l.x) > OUT.w / 2) return;
    const want = THREE.MathUtils.clamp(l.x - 0.3, -HX + 0.25, SHOOTER.x - 0.35);
    const p = this.rail.group.position;
    if (Math.abs(want - p.x) > 0.35 && this.rail.held === 0) {
      p.x = want;
      this.panel.mesh.position.x = want + PANEL_FROM_RAIL;
    }
  }

  /** Picks one of your bets back up off the layout (if the rules let it come down). Returns what came back. */
  private takeDown(id: string): number {
    if (this.phase !== 'betting' || !this.game.canRemove(id)) return 0;
    this.undoStack = this.undoStack.filter((u) => u.id !== id);
    const back = this.game.removeBet(id);
    this.syncStacks();
    this.panel.redraw();
    return back;
  }

  /** The dice: pick them up (VR) and throw them at the far wall. */
  private buildDiceGrab() {
    const samples: { t: number; p: THREE.Vector3 }[] = [];
    this.grabbables.push({
      at: () => this.group.localToWorld(this.dice[0].position.clone()),
      radius: 0.09,
      enabled: () => this.canRoll,
      grab: () => {
        samples.length = 0;
        this.diceInHand = true;
        this.ctx.sound.play('chip', this.dice[0], { volume: 0.3, rate: 1.6 });
        return 'drag';
      },
      drag: (_h, pos) => {
        const l = this.group.worldToLocal(pos.clone());
        this.dice[0].position.copy(l).add(new THREE.Vector3(-0.012, 0, 0));
        this.dice[1].position.copy(l).add(new THREE.Vector3(0.012, 0, 0.004));
        const now = performance.now() / 1000;
        samples.push({ t: now, p: l });
        // Keep only the last ~70 ms: the hand's speed as it lets go.
        while (samples.length > 2 && now - samples[0].t > 0.07) samples.shift();
      },
      release: () => {
        this.diceInHand = false;
        const a = samples[0],
          b = samples.at(-1);
        if (!a || !b || b.t - a.t < 1e-3) return this.homeDice();
        const v = b.p.clone().sub(a.p).divideScalar(b.t - a.t);
        const from = b.p.clone().sub(new THREE.Vector3(0, FELT_Y, 0));
        // The far end from where you stand is the back wall you throw at.
        const dirX = from.x >= 0 ? -1 : 1;
        if (v.x * dirX < 1.0 || from.y < -0.02) {
          this.ctx.hud.toast('Toss them down the table — the dice have to hit the far wall', 'warn');
          return this.homeDice(true);
        }
        // Give a soft throw enough to reach the pyramids; keep its direction and spin.
        if (v.x * dirX < 3.2) v.multiplyScalar(3.2 / Math.abs(v.x));
        from.x = THREE.MathUtils.clamp(from.x, -HX + 0.05, HX - 0.05);
        from.z = THREE.MathUtils.clamp(from.z, -HZ + 0.05, HZ - 0.05);
        from.y = Math.max(0.06, Math.min(0.5, from.y));
        this.throwDice(from, v);
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Betting
  // ---------------------------------------------------------------------------

  private regionFromLocal(l: THREE.Vector3): string | null {
    // e.local is in the felt's own frame (plane): x → x, y → −z.
    const [px, py] = localToPx(l.x, -l.y);
    return regionAt(px, py);
  }

  private betAtWorld(pos: THREE.Vector3): string | null {
    const l = this.group.worldToLocal(pos.clone());
    if (l.y < FELT_Y - 0.05 || l.y > FELT_Y + 0.4 || Math.abs(l.x) > HX || Math.abs(l.z) > HZ) return null;
    return this.betFor(regionAt(...localToPx(l.x, l.z)));
  }

  /** Turns a layout area into the bet a dealer would book for you there. */
  private betFor(region: string | null): string | null {
    if (!region) return null;
    const g = this.game;
    if (region === 'pass' && g.point && g.bets.has('pass')) return 'passOdds';
    if (region === 'dontPass' && g.point && g.bets.has('dontPass')) return 'dontOdds';
    const m = region.match(/^place(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      if (g.bets.has(`come${n}`)) return `comeOdds${n}`;
      if (g.bets.has(`dontCome${n}`)) return `dontComeOdds${n}`;
    }
    return region;
  }

  private describe(id: string): string {
    const info = betInfo(id);
    if (!info) return '';
    let pays = PAYS[id] ?? '';
    if (info.kind === 'place') pays = PLACE_PAYS[info.n!];
    if (info.kind === 'passOdds' && this.game.point) pays = `${ODDS_PAYS[this.game.point]} · up to ${MAX_ODDS[this.game.point as 4]}x`;
    if (info.kind === 'comeOdds') pays = `${ODDS_PAYS[info.n!]} · up to ${MAX_ODDS[info.n as 4]}x`;
    if (info.kind === 'dontOdds' || info.kind === 'dontComeOdds') pays = 'lay odds · up to 6x';
    const cur = this.game.bets.get(id);
    return `${info.name}${pays ? ' · ' + pays : ''}${cur ? ` · ${money(cur)} on it` : ''}`;
  }

  private status(): string {
    if (this.phase !== 'betting') return 'Dice are out';
    if (this.hover) return this.describe(this.hover);
    if (this.last) return `${this.last.call}  ${this.last.totalWon > 0 ? '· won ' + money(this.last.totalWon) : ''}`;
    return this.game.point ? `The point is ${this.game.point}` : 'Coming out! Bet the Pass Line, then roll';
  }

  selectChip(d: ChipDenom) {
    this.chip = d;
    this.ctx.sound.play('click', this.panel.mesh, { volume: 0.5 });
    this.panel.redraw();
  }

  setPanelVisible(v: boolean) {
    this.panel.mesh.visible = v;
  }

  /** Places a bet through the game's rules (click, button or chips set down by hand). True if it took. */
  bet(id: string, amount: number = this.chip): boolean {
    if (this.phase !== 'betting') return false;
    let ok = false;
    try {
      this.game.placeBet(id, amount);
      this.undoStack.push({ id, amount });
      this.refreshStack(id, true);
      this.ctx.sound.play('chip', this.stacks.get(id), { volume: 0.9, rate: 0.95 + Math.random() * 0.1 });
      ok = true;
    } catch (e) {
      if (!(e instanceof CrapsBetRejected)) throw e;
      this.ctx.hud.toast(e.message, 'warn');
      this.ctx.sound.play('denied', this.panel.mesh, { volume: 0.6 });
    }
    this.panel.redraw();
    return ok;
  }

  get canUndo() {
    return this.phase === 'betting' && this.undoStack.some((u) => this.game.canRemove(u.id));
  }
  get canClear() {
    return this.phase === 'betting' && [...this.game.bets.keys()].some((id) => this.game.canRemove(id));
  }
  get canRoll() {
    return this.phase === 'betting' && !this.diceInHand;
  }
  get canOdds() {
    return this.phase === 'betting' && this.oddsTargets().length > 0;
  }

  undo() {
    const last = this.undoStack.pop();
    if (!last || !this.game.canRemove(last.id)) return;
    const total = this.game.bets.get(last.id) ?? 0;
    this.game.removeBet(last.id);
    if (total - last.amount > 0) this.game.placeBet(last.id, total - last.amount);
    this.syncStacks();
    this.ctx.sound.play('chip', this.panel.mesh, { volume: 0.6 });
    this.panel.redraw();
  }

  /** Takes down everything that's allowed to come down. */
  clear() {
    let back = 0;
    for (const id of [...this.game.bets.keys()]) back += this.game.removeBet(id);
    this.undoStack = [];
    this.syncStacks();
    if (back > 0) this.ctx.sound.play('chips', this.panel.mesh);
    this.panel.redraw();
  }

  private oddsTargets(): string[] {
    const g = this.game;
    const out: string[] = [];
    if (g.point && g.bets.has('pass')) out.push('passOdds');
    if (g.point && g.bets.has('dontPass')) out.push('dontOdds');
    for (const id of g.bets.keys()) {
      const m = id.match(/^(come|dontCome)(\d+)$/);
      if (m) out.push(`${m[1]}Odds${m[2]}`);
    }
    return out.filter((id) => g.maxFor(id) > (g.bets.get(id) ?? 0));
  }

  /** Takes full 3-4-5x odds (and 6x lay) behind every line and come bet. */
  maxOdds() {
    for (const id of this.oddsTargets()) {
      const want = this.game.maxFor(id) - (this.game.bets.get(id) ?? 0);
      const amount = Math.min(want, Math.floor(this.ctx.bankroll.balance));
      if (amount > 0) this.bet(id, amount);
    }
  }

  private anchor(id: string): THREE.Vector3 {
    const [x, z] = pxToLocal(...anchorPx(id));
    return new THREE.Vector3(x, FELT_Y + 0.001, z);
  }

  private refreshStack(id: string, drop = false) {
    const old = this.stacks.get(id);
    if (old) {
      this.group.remove(old);
      this.stacks.delete(id);
    }
    const amount = this.game.bets.get(id) ?? 0;
    if (amount <= 0) return;
    const stack = makeChipStack(amount);
    stack.position.copy(this.anchor(id));
    stack.traverse((o) => (o.castShadow = this.ctx.quality.shadows));
    this.group.add(stack);
    this.stacks.set(id, stack);
    if (drop) {
      const top = stack.children.at(-1)!;
      const y = top.position.y;
      this.tweens.add(0.18, (k) => (top.position.y = y + (1 - k) ** 2 * 0.06));
    }
  }

  private syncStacks() {
    for (const id of new Set([...this.stacks.keys(), ...this.game.bets.keys()])) {
      const s = this.stacks.get(id);
      if ((s?.userData.amount ?? 0) !== (this.game.bets.get(id) ?? 0)) this.refreshStack(id);
    }
  }

  private setHover(id: string | null, chip: ChipDenom = this.chip) {
    if (id === this.hover && chip === this.chip) return;
    this.chip = chip;
    this.hover = id;
    if (id && this.phase === 'betting') {
      const a = this.anchor(id);
      const h = (this.stacks.get(id)?.children.length ?? 0) * CHIP_HEIGHT;
      this.ghost.position.set(a.x, a.y + h + CHIP_HEIGHT / 2 + 0.002, a.z);
      const fresh = makeChip(chip);
      (this.ghost.children[0] as THREE.Mesh).material = (fresh.material as THREE.Material[]).map((m) => Object.assign(m.clone(), { transparent: true, opacity: 0.55 }));
      this.ghost.visible = true;
    } else this.ghost.visible = false;
    this.panel.redraw();
  }

  private onKey(e: KeyboardEvent) {
    if (this.ctx.hud.station !== 'craps') return;
    if (e.code === 'Space') {
      e.preventDefault();
      this.throwDice();
    } else if (e.code === 'KeyZ' || e.code === 'Backspace') this.undo();
    else if (e.code === 'KeyO') this.maxOdds();
    else if (/^Digit[1-7]$/.test(e.code)) this.selectChip(CHIP_DENOMS[Number(e.code.slice(5)) - 1]);
  }

  // ---------------------------------------------------------------------------
  // The roll
  // ---------------------------------------------------------------------------

  /** Throws the dice (from the shooter's hand, or with a VR throw's own start and velocity). */
  /**
   * Shared-table hooks (two-player games). The host's machine rolls every
   * pair of dice; a guest's throw asks the host to roll for them.
   */
  net: {
    role: 'host' | 'guest';
    request(t: { from: number[] | null; v: number[] | null }): void;
    announce(r: { dice: [number, number]; seed: number; from: number[]; v: number[] | null; point: number | null }): void;
  } | null = null;

  throwDice(from?: THREE.Vector3, velocity?: THREE.Vector3) {
    if (!this.canRoll && !(from && this.phase === 'betting')) return;
    const g = this.game;
    if (g.comeOut && !g.bets.has('pass') && !g.bets.has('dontPass')) {
      this.ctx.hud.toast("The shooter bets the line: put a chip on the Pass Line (or Don't Pass)", 'warn');
      this.ctx.sound.play('denied', this.panel.mesh, { volume: 0.6 });
      this.homeDice();
      return;
    }
    const problem = g.minimumProblem();
    if (problem) {
      this.ctx.hud.toast(problem, 'warn');
      this.ctx.sound.play('denied', this.panel.mesh, { volume: 0.6 });
      this.homeDice();
      return;
    }
    if (this.net?.role === 'guest') {
      this.net.request({ from: from ? from.toArray() : null, v: velocity ? velocity.toArray() : null });
      this.homeDice();
      this.ctx.hud.toast('Dice are out!', 'info');
      return;
    }
    this.hostRoll(from ?? null, velocity ?? null);
  }

  /** Host: roll for anyone at the table (own throw, or a guest's request). */
  hostRoll(from: THREE.Vector3 | null, velocity: THREE.Vector3 | null) {
    if (this.phase !== 'betting') return;
    const dice: [number, number] = [this.ctx.rng.int(6) + 1, this.ctx.rng.int(6) + 1];
    const seed = (Math.random() * 2 ** 31) | 0;
    const start = from ?? new THREE.Vector3(SHOOTER.x + 0.05, 0.28, HZ - 0.12);
    this.net?.announce({ dice, seed, from: start.toArray(), v: velocity ? velocity.toArray() : null, point: this.game.point });
    this.beginRoll(dice, seed, start, velocity);
  }

  /** Guest: a roll decided by the host's machine arrives. */
  applyRemoteRoll(dice: [number, number], seed: number, from: number[], v: number[] | null, point: number | null) {
    if (this.phase !== 'betting') return;
    // Follow the host's puck (we may have joined mid-hand).
    if (this.game.point !== point) {
      this.game.point = point;
      this.placePucks(true);
    }
    this.beginRoll(dice, seed, new THREE.Vector3().fromArray(from), v ? new THREE.Vector3().fromArray(v) : null);
  }

  /** The puck as the host has it (sent when a friend joins). */
  syncPoint(point: number | null) {
    if (this.phase !== 'betting' || this.game.point === point) return;
    this.game.point = point;
    this.placePucks(true);
    this.panel.redraw();
  }

  private beginRoll(dice: [number, number], seed: number, start: THREE.Vector3, velocity: THREE.Vector3 | null) {
    const result = this.game.resolve(dice);
    const returned = result.results.reduce((s, r) => s + r.returned, 0);
    this.ctx.hud.setPending('craps', returned);
    // Already credited, but it reaches your rail when the dealers push it to you.
    this.away = returned;
    let plan: DicePlan | null = null;
    // The simulation throws toward −x; a throw from the −x end toward +x runs mirrored.
    const mirror = start.x < 0 && (!velocity || velocity.x > 0);
    const m = (v: THREE.Vector3) => (mirror ? new THREE.Vector3(-v.x, v.y, v.z) : v);
    for (let i = 0; i < 8; i++) {
      const p = simulateThrow({ bed: { hx: HX, hz: HZ }, seed: seed + i * 7919, from: m(start), velocity: i < 4 && velocity ? m(velocity) : undefined });
      plan = p;
      if (p.hitBackWall) break;
    }
    if (mirror && plan) {
      // Reflect across the table's middle: positions flip in x, rotations conjugate by the mirror.
      for (const f of plan.frames)
        for (const d of f) {
          d.p.x = -d.p.x;
          d.q.set(d.q.x, -d.q.y, -d.q.z, d.q.w);
        }
      plan.upLocal = [new THREE.Vector3(-plan.upLocal[0].x, plan.upLocal[0].y, plan.upLocal[0].z), new THREE.Vector3(-plan.upLocal[1].x, plan.upLocal[1].y, plan.upLocal[1].z)];
    }
    const fix = [faceFix(plan!.upLocal[0], result.dice[0]), faceFix(plan!.upLocal[1], result.dice[1])];
    this.roll = { plan: plan!, t: 0, result, hit: 0, fix };
    this.phase = 'rolling';
    this.ghost.visible = false;
    this.undoStack = [];
    this.onRoll?.();
    this.panel.redraw();
  }

  private finishRoll() {
    const r = this.roll!.result;
    this.roll = null;
    this.phase = 'paying';
    this.last = r;
    this.ctx.hud.setPending('craps', 0);
    this.onResult?.(r);

    // Dealers settle: losers are swept, winners paid beside the bet then pushed to you.
    const player = new THREE.Vector3(SHOOTER.x, RAIL_Y - 0.06, OUT.d / 2 - 0.06);
    const dealer = new THREE.Vector3(0, FELT_Y + 0.01, -HZ + 0.1);
    let delay = 0.6;
    for (const res of r.results) {
      const stack = this.stacks.get(res.id);
      if (!stack) continue;
      const from = stack.position.clone();
      if (res.outcome === 'lose') {
        this.stacks.delete(res.id);
        this.later(delay * 0.5, () =>
          this.tweens.add(0.8, (k) => {
            stack.position.lerpVectors(from, dealer, easeInOut(k));
            stack.scale.setScalar(1 - easeInOut(k) * 0.5);
          }, () => this.group.remove(stack)),
        );
      } else if (res.outcome === 'move' && res.to) {
        this.stacks.delete(res.id);
        const to = this.anchor(res.to);
        this.later(delay * 0.5, () =>
          this.tweens.add(0.7, (k) => {
            stack.position.lerpVectors(from, to, easeInOut(k));
            stack.position.y += Math.sin(k * Math.PI) * 0.03;
          }, () => {
            this.group.remove(stack);
            this.refreshStack(res.to!);
          }),
        );
      } else if (res.returned > 0) {
        const pay = res.won > 0 ? makeChipStack(res.won) : null;
        if (pay) {
          pay.position.copy(from).add(new THREE.Vector3(0.045, 0, 0.02));
          pay.visible = false;
          this.group.add(pay);
        }
        const comesDown = !res.staysUp;
        if (comesDown) this.stacks.delete(res.id);
        const d = delay;
        this.later(d, () => {
          if (pay) {
            pay.visible = true;
            this.ctx.sound.play('chips', pay, { volume: 0.7 });
          }
        });
        this.later(d + 0.9, () => {
          const items = [pay, comesDown ? stack : null].filter(Boolean) as THREE.Group[];
          const starts = items.map((o) => o.position.clone());
          this.tweens.add(0.9, (k) => {
            items.forEach((o, i) => o.position.lerpVectors(starts[i], player.clone().add(new THREE.Vector3(i * 0.04, 0, 0)), easeInOut(k)));
          }, () => {
            items.forEach((o) => this.group.remove(o));
            this.away = Math.max(0, this.away - res.returned);
          });
        });
        delay += 0.25;
      }
    }
    if (r.pointAfter !== r.pointBefore) this.later(0.3, () => this.placePucks(true));
    // Stickman sends the dice back to the shooter.
    this.later(Math.max(2.2, delay + 1.6), () => {
      this.homeDice(true);
      this.syncStacks();
      this.away = 0;
      this.phase = 'betting';
      this.panel.redraw();
    });
    this.panel.redraw();
  }

  /**
   * Walk-up shooting (VR): the stickman slides the dice along the rail to
   * whoever is standing at the table, ready to grab. `at` is your feet (world).
   */
  offerDice(at: THREE.Vector3) {
    if (!this.canRoll || this.roll) return;
    const l = this.group.worldToLocal(at.clone());
    let x = THREE.MathUtils.clamp(l.x, -HX + 0.2, HX - 0.2),
      z = HZ - 0.1;
    if (Math.abs(l.x) > HX - 0.05 && l.z < HZ) {
      // At one end of the table.
      x = Math.sign(l.x) * (HX - 0.15);
      z = THREE.MathUtils.clamp(l.z, -HZ + 0.2, HZ - 0.15);
    }
    const spot = new THREE.Vector3(x, DIE / 2, z);
    if (spot.distanceTo(this.diceHome) < 0.35) return;
    this.diceHome.copy(spot);
    this.homeDice(true);
    this.ctx.sound.play('chip', this.dice[0], { volume: 0.35, rate: 1.4 });
    const now = performance.now() / 1000;
    if (now - this.offeredAt > 25) {
      this.offeredAt = now;
      this.ctx.hud.toast('Your dice, shooter! Grab them (grip) and throw at the far wall', 'info');
    }
  }

  private homeDice(slide = false) {
    this.dice.forEach((d, i) => {
      const to = this.diceHome.clone().add(new THREE.Vector3(i * 0.03, FELT_Y, 0));
      if (!slide) {
        d.position.copy(to);
        return;
      }
      const from = d.position.clone();
      this.tweens.add(0.9, (k) => d.position.lerpVectors(from, to, easeInOut(k)));
    });
  }

  private later(s: number, fn: () => void) {
    let t = 0;
    this.tweens.add(s, (k) => (t = k), () => t >= 1 && fn());
  }

  update(dt: number) {
    this.tweens.update(dt);
    this.rail.update(dt);
    const r = this.roll;
    if (!r) return;
    r.t += dt;
    poseAt(r.plan, r.t, this.pose);
    this.dice.forEach((d, i) => {
      d.position.copy(this.pose[i].p).y += FELT_Y;
      d.quaternion.copy(this.pose[i].q).multiply(r.fix[i]);
    });
    while (r.hit < r.plan.hits.length && r.plan.hits[r.hit].t <= r.t) {
      const h = r.plan.hits[r.hit++];
      this.ctx.sound.play('ballDrop', this.dice[h.die], { volume: 0.15 + 0.5 * h.strength, rate: h.wall ? 0.55 : 0.75 + Math.random() * 0.2 });
    }
    if (r.t >= r.plan.duration + 0.15) this.finishRoll();
  }

  /** World spots for the crew: dealers on the far side, stickman opposite, players at the rail. */
  spots() {
    const w = (x: number, z: number) => this.group.localToWorld(new THREE.Vector3(x, 0, z));
    const yaw = this.group.rotation.y;
    const far = -OUT.d / 2 - 0.32;
    const near = OUT.d / 2 + 0.3;
    return {
      boxman: { pos: w(0, far - 0.05), yaw },
      dealers: [
        { pos: w(-0.95, far), yaw },
        { pos: w(0.95, far), yaw },
      ],
      stickman: { pos: w(0, near), yaw: yaw + Math.PI },
      players: [
        { pos: w(-0.4, near + 0.02), yaw: yaw + Math.PI + 0.1 },
        { pos: w(-1.1, near), yaw: yaw + Math.PI - 0.2 },
        { pos: w(-OUT.w / 2 - 0.3, 0.2), yaw: yaw - Math.PI / 2 },
        { pos: w(OUT.w / 2 + 0.3, -0.2), yaw: yaw + Math.PI / 2 },
        { pos: w(1.75, near - 0.1), yaw: yaw + Math.PI + 0.4 },
      ],
    };
  }
}

export { isPoint };
