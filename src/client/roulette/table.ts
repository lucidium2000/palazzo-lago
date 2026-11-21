import * as THREE from 'three';
import {
  BetRejected,
  pocketColor,
  pocketLabel,
  RouletteGame,
  SPOTS_BY_ID,
  WHEEL_ORDER,
  type Pocket,
} from '../../rules/roulette';
import { makeChip, makeChipStack, CHIP_HEIGHT } from '../chips';
import { bakeStatic, dynamic } from '../merge';
import { easeInOut, money, Tweens, type GameContext } from '../game';
import { CanvasPanel, GOLD, GOLD_LIGHT, roundRect, SERIF } from '../panel';
import type { Viewpoint } from '../player';
import { CHIP_DENOMS, chipFace, radial, toTexture, wood, type ChipDenom } from '../textures';
import { describeSpot, FELT, FELT_SIZE, feltTexture, spotAnchor, spotAt, WHEEL_CENTER } from './layout';

const TOP = 0.8; // felt height
const POCKETS = WHEEL_ORDER.length;
const SECTOR = (Math.PI * 2) / POCKETS;
const R = { bowl: 0.43, track: 0.372, pocket: 0.218, numbersIn: 0.248, numbersOut: 0.288 };
const SPIN_TIME = 7.2;

export class RouletteTable {
  readonly group = new THREE.Group();
  readonly game: RouletteGame;
  readonly viewpoint: Viewpoint;
  private rotor = new THREE.Group();
  private ball: THREE.Mesh;
  private rotorAngle = 0;
  private rotorSpeed = 0.35;
  private spin: { t: number; target: Pocket; theta: number; r0: number } | null = null;
  private ballRest: Pocket | null = null;
  private stacks = new Map<string, THREE.Group>();
  private ghost: THREE.Group;
  private dolly: THREE.Mesh;
  private chip: ChipDenom = 5;
  private panel: CanvasPanel;
  private board: CanvasPanel;
  private tweens = new Tweens();
  private hoverSpot: string | null = null;
  private ballLoop: ReturnType<GameContext['sound']['loop']>;
  private undoStack: { spotId: string; amount: number }[] = [];
  private lastResult: { pocket: Pocket; net: number } | null = null;
  /** Hooks for the croupier and onlookers. */
  onSpin: (() => void) | null = null;
  onResult: ((pocket: Pocket, staked: number, returned: number) => void) | null = null;

  constructor(
    private ctx: GameContext,
    position: THREE.Vector3,
  ) {
    this.game = new RouletteGame(ctx.bankroll);
    this.group.position.copy(position);
    ctx.scene.add(this.group);

    this.buildTable();
    this.buildWheel();
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.0105, 20, 14),
      new THREE.MeshStandardMaterial({ color: 0xfbfbf6, roughness: 0.12, envMapIntensity: 1.2 }),
    );
    this.ball.castShadow = ctx.quality.shadows;
    this.ball.raycast = () => {};
    this.wheelGroup.add(this.ball);
    this.placeBallOnTrack(0);

    this.ghost = new THREE.Group();
    const ghostChip = makeChip(5);
    ghostChip.material = (ghostChip.material as THREE.Material[]).map((m) => {
      const c = m.clone();
      c.transparent = true;
      c.opacity = 0.55;
      return c;
    });
    this.ghost.add(ghostChip);
    this.ghost.visible = false;
    this.group.add(this.ghost);

    this.dolly = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.024, 0.07, 20),
      new THREE.MeshStandardMaterial({ color: 0xf3dc9a, metalness: 0.9, roughness: 0.25 }),
    );
    this.dolly.visible = false;
    this.dolly.raycast = () => {};
    this.group.add(this.dolly);

    this.panel = this.buildPanel();
    this.board = this.buildBoard();
    this.ballLoop = ctx.sound.loop('ballRoll', this.ball);

    // Player stands on the +Z side of the table, centred on the layout.
    const seat = new THREE.Vector3(0.0, 0, 0.95).add(position);
    this.viewpoint = { id: 'roulette', label: 'Roulette', position: seat, yaw: 0, pitch: -0.74, eye: 1.72, back: 0.32 };

    ctx.bankroll.onChange(() => this.panel.redraw());
    addEventListener('keydown', (e) => this.onKey(e));

    // Merge static parts per material to keep draw calls low.
    bakeStatic(this.rotor);
    dynamic(this.rotor);
    dynamic(this.ball);
    dynamic(this.ghost);
    dynamic(this.dolly);
    this.buildRack();
    bakeStatic(this.group, { shadows: ctx.quality.shadows });
  }

  private wheelGroup = new THREE.Group();

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  private buildTable() {
    const q = this.ctx.quality;
    const woodTex = toTexture(wood(512));
    woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
    woodTex.repeat.set(3, 3);
    const woodMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.35, envMapIntensity: 1 });
    const leather = new THREE.MeshStandardMaterial({ color: 0x4a1418, roughness: 0.55, envMapIntensity: 0.6 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 1, roughness: 0.3 });

    const cx = (FELT.x0 + FELT.x1) / 2,
      cz = (FELT.z0 + FELT.z1) / 2;
    const fw = FELT_SIZE.w,
      fd = FELT_SIZE.d;

    // Felt.
    const felt = new THREE.Mesh(
      new THREE.PlaneGeometry(fw, fd),
      new THREE.MeshStandardMaterial({ map: feltTexture(q.texSize), roughness: 0.92, envMapIntensity: 0.25 }),
    );
    felt.rotation.x = -Math.PI / 2;
    felt.position.set(cx, TOP, cz);
    felt.receiveShadow = q.shadows;
    felt.name = 'felt';
    this.group.add(felt);
    this.ctx.interaction.register({
      object: felt,
      kind: 'surface',
      onSelect: (e) => {
        const p = this.group.worldToLocal(e.hit.point.clone());
        const spot = spotAt(p.x, p.z);
        if (spot) this.bet(spot.id);
      },
      onHover: (e) => {
        if (!e) return this.setHover(null);
        const p = this.group.worldToLocal(e.hit.point.clone());
        this.setHover(spotAt(p.x, p.z)?.id ?? null);
      },
    });

    // Padded rail: an extruded rounded-rectangle ring.
    const pad = 0.1;
    const outer = roundedRectShape(cx, cz, fw + pad * 2, fd + pad * 2, 0.16);
    const hole = roundedRectShape(cx, cz, fw, fd, 0.08);
    outer.holes.push(new THREE.Path(hole.getPoints(48)));
    const railGeo = new THREE.ExtrudeGeometry(outer, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.03, bevelSegments: 4, curveSegments: 16 });
    railGeo.rotateX(Math.PI / 2);
    const rail = new THREE.Mesh(railGeo, leather);
    rail.position.y = TOP + 0.06;
    rail.castShadow = q.shadows;
    this.group.add(rail);

    // Wooden apron and cabinet under the felt.
    const apronShape = roundedRectShape(cx, cz, fw + pad * 2 + 0.04, fd + pad * 2 + 0.04, 0.18);
    const apronGeo = new THREE.ExtrudeGeometry(apronShape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, curveSegments: 16 });
    apronGeo.rotateX(Math.PI / 2);
    const apron = new THREE.Mesh(apronGeo, woodMat);
    apron.position.y = TOP - 0.012;
    this.group.add(apron);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(fw + 0.26, 0.012, fd + 0.26), gold);
    trim.position.set(cx, TOP - 0.12, cz);
    this.group.add(trim);
    const body = new THREE.Mesh(new THREE.BoxGeometry(fw - 0.2, TOP - 0.2, fd - 0.2), woodMat);
    body.position.set(cx, (TOP - 0.2) / 2 + 0.06, cz);
    body.castShadow = q.shadows;
    this.group.add(body);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(fw - 0.1, 0.06, fd - 0.1), new THREE.MeshStandardMaterial({ color: 0x1a0f0a, roughness: 0.4 }));
    plinth.position.set(cx, 0.03, cz);
    this.group.add(plinth);

    // Contact shadow.
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(fw + 0.8, fd + 0.9),
      new THREE.MeshBasicMaterial({ map: toTexture(radial(128, 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0)')), transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(cx, 0.012, cz);
    this.group.add(shadow);

    // Stools for the player and three neighbours.
    const stoolSeat = new THREE.CylinderGeometry(0.2, 0.18, 0.08, 24);
    const stoolPole = new THREE.CylinderGeometry(0.03, 0.03, 0.62, 10);
    const stoolBase = new THREE.CylinderGeometry(0.2, 0.22, 0.03, 24);
    for (const x of [-0.75, 0.95]) {
      const s = new THREE.Group();
      const seat = new THREE.Mesh(stoolSeat, leather);
      seat.position.y = 0.68;
      const pole = new THREE.Mesh(stoolPole, gold);
      pole.position.y = 0.33;
      const base = new THREE.Mesh(stoolBase, gold);
      base.position.y = 0.015;
      s.add(seat, pole, base);
      s.position.set(x, 0, 0.98);
      this.group.add(s);
    }
  }

  private buildWheel() {
    const w = this.wheelGroup;
    w.position.set(WHEEL_CENTER.x, TOP, WHEEL_CENTER.z);
    this.group.add(w);

    const woodTex = toTexture(wood(512));
    const bowlWood = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.25, envMapIntensity: 1.2, side: THREE.DoubleSide });
    const trackMat = new THREE.MeshStandardMaterial({ color: 0x3b1d10, roughness: 0.18, envMapIntensity: 1.3, side: THREE.DoubleSide });
    const gold = new THREE.MeshStandardMaterial({ color: 0xe0b45a, metalness: 1, roughness: 0.18, envMapIntensity: 1.5 });

    // Bowl exterior and rim.
    const bowl = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          [0.36, 0.0],
          [0.43, 0.01],
          [0.445, 0.07],
          [0.44, 0.115],
          [0.425, 0.125],
          [0.405, 0.118],
        ].map(([r, y]) => new THREE.Vector2(r, y)),
        64,
      ),
      bowlWood,
    );
    w.add(bowl);
    // Ball track sloping in toward the rotor.
    const track = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          [0.405, 0.118],
          [0.385, 0.098],
          [0.36, 0.09],
          [0.33, 0.078],
          [0.3, 0.062],
          [0.292, 0.058],
        ].map(([r, y]) => new THREE.Vector2(r, y)),
        64,
      ),
      trackMat,
    );
    w.add(track);
    // Diamond deflectors on the lower track.
    const defl = new THREE.OctahedronGeometry(0.011, 0);
    defl.scale(1, 0.5, 2);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.2;
      const d = new THREE.Mesh(defl, gold);
      d.position.set(Math.cos(a) * 0.318, 0.074, -Math.sin(a) * 0.318);
      d.rotation.y = a;
      w.add(d);
    }

    // Rotor: numbers ring, pockets, frets, cone, turret.
    this.rotor.position.y = 0.0;
    w.add(this.rotor);
    const ringTex = rotorTexture(1024);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(R.pocket - 0.03, R.numbersOut, 76, 1),
      new THREE.MeshStandardMaterial({ map: ringTex, roughness: 0.3, envMapIntensity: 0.9 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.048;
    this.rotor.add(ring);
    const fretGeo = new THREE.BoxGeometry(0.06, 0.016, 0.0025);
    const fretMat = gold;
    const frets = new THREE.InstancedMesh(fretGeo, fretMat, POCKETS);
    const tmp = new THREE.Object3D();
    for (let i = 0; i < POCKETS; i++) {
      const a = (i + 0.5) * SECTOR;
      tmp.position.set(Math.cos(a) * 0.218, 0.056, -Math.sin(a) * 0.218);
      tmp.rotation.set(0, a, 0);
      tmp.updateMatrix();
      frets.setMatrixAt(i, tmp.matrix);
    }
    this.rotor.add(frets);
    const pocketWall = new THREE.Mesh(new THREE.CylinderGeometry(R.numbersIn, R.numbersIn, 0.014, 76, 1, true), gold);
    pocketWall.position.y = 0.055;
    this.rotor.add(pocketWall);
    const cone = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          [0.19, 0.05],
          [0.15, 0.062],
          [0.09, 0.078],
          [0.05, 0.085],
          [0.0, 0.088],
        ].map(([r, y]) => new THREE.Vector2(r, y)),
        64,
      ),
      new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.2, envMapIntensity: 1.3, side: THREE.DoubleSide }),
    );
    this.rotor.add(cone);
    const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.016, 0.09, 16), gold);
    spindle.position.y = 0.13;
    this.rotor.add(spindle);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 12), gold);
    knob.position.y = 0.18;
    this.rotor.add(knob);
    for (let k = 0; k < 4; k++) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.11, 8), gold);
      arm.rotation.z = Math.PI / 2;
      arm.rotation.y = (k * Math.PI) / 2;
      arm.position.y = 0.115;
      const end = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), gold);
      end.position.set(Math.cos((k * Math.PI) / 2) * 0.055, 0.115, -Math.sin((k * Math.PI) / 2) * 0.055);
      this.rotor.add(arm, end);
    }
  }

  private buildPanel(): CanvasPanel {
    const p = new CanvasPanel(0.74, 1560, 420);
    // Sits just past the front rail, tilted up toward the player.
    p.mesh.position.set(0.12, TOP + 0.12, 0.6);
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
      ctx.fillText(`Bet ${money(this.game.totalBet)}`, p.pxW - 40, 60);
      ctx.textAlign = 'center';
      ctx.font = `italic 34px ${SERIF}`;
      ctx.fillStyle = '#cbb991';
      const hover = this.hoverSpot ? SPOTS_BY_ID.get(this.hoverSpot) : null;
      const msg = this.game.phase === 'spinning'
        ? 'No more bets'
        : hover
          ? `${describeSpot(hover)}  ·  pays ${hover.payout} to 1`
          : this.lastResult
            ? `Last: ${pocketLabel(this.lastResult.pocket)} ${pocketColor(this.lastResult.pocket)}  ·  ${this.lastResult.net >= 0 ? 'won' : 'lost'} ${money(Math.abs(this.lastResult.net))}`
            : 'Choose a chip, then tap the layout to bet';
      ctx.fillText(msg, p.pxW / 2, 60);
    };

    const chipTex = new Map<ChipDenom, HTMLCanvasElement>();
    for (const d of CHIP_DENOMS) chipTex.set(d, chipFace(d, 160));
    CHIP_DENOMS.forEach((d, i) => {
      p.add({
        id: `chip-${d}`,
        x: 40 + i * 125,
        y: 120,
        w: 115,
        h: 115,
        label: '',
        active: () => this.chip === d,
        onPress: () => {
          this.chip = d;
          this.ctx.sound.play('click', p.mesh, { volume: 0.5 });
          p.redraw();
        },
        paint: (ctx, b, s) => {
          const r = b.w / 2;
          ctx.save();
          if (s.active || s.hover) {
            ctx.shadowColor = s.active ? '#ffe39a' : '#ffffff';
            ctx.shadowBlur = s.active ? 30 : 16;
          }
          ctx.drawImage(chipTex.get(d)!, b.x, b.y + (s.active ? -10 : 0), b.w, b.h);
          ctx.restore();
          if (s.active) {
            ctx.strokeStyle = GOLD_LIGHT;
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.arc(b.x + r, b.y + r - 10, r + 4, 0, Math.PI * 2);
            ctx.stroke();
          }
        },
      });
    });
    const btn = (id: string, x: number, label: string, onPress: () => void, enabled: () => boolean, w = 180) =>
      p.add({ id, x, y: 270, w, h: 110, label, onPress, enabled });
    const betting = () => this.game.phase === 'betting';
    btn('undo', 40, 'Undo', () => this.undo(), () => betting() && this.undoStack.length > 0);
    btn('clear', 240, 'Clear', () => this.clear(), () => betting() && this.game.bets.size > 0);
    btn('rebet', 440, 'Rebet', () => this.rebet(), () => this.game.canRebet);
    btn('double', 640, 'Double', () => this.double(), () => betting() && this.game.bets.size > 0);
    p.add({
      id: 'spin',
      x: 940,
      y: 130,
      w: 580,
      h: 250,
      label: () => (this.game.phase === 'spinning' ? 'Spinning…' : 'SPIN'),
      sub: () => (this.game.phase === 'spinning' ? 'good luck' : 'no more bets'),
      enabled: () => betting() && this.game.bets.size > 0,
      active: () => betting() && this.game.bets.size > 0,
      onPress: () => this.startSpin(),
    });
    p.register(this.ctx.interaction);
    p.redraw();
    return p;
  }

  /** The tall results display beside the wheel, like a real reader board. */
  private buildBoard(): CanvasPanel {
    const b = new CanvasPanel(0.36, 360, 1000, { transparent: false });
    b.mesh.position.set(WHEEL_CENTER.x - 0.62, 1.45, WHEEL_CENTER.z - 0.25);
    b.mesh.rotation.y = 0.5;
    this.group.add(b.mesh);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.025, 1.0, 12),
      new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 1, roughness: 0.3 }),
    );
    pole.position.set(b.mesh.position.x, 0.5, b.mesh.position.z);
    this.group.add(pole);
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.39, 1.03, 0.03),
      new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 1, roughness: 0.3 }),
    );
    frame.position.copy(b.mesh.position);
    frame.rotation.copy(b.mesh.rotation);
    frame.translateZ(-0.017);
    this.group.add(frame);
    b.background = (ctx) => {
      ctx.fillStyle = '#08060a';
      ctx.fillRect(0, 0, b.pxW, b.pxH);
      ctx.fillStyle = GOLD_LIGHT;
      ctx.textAlign = 'center';
      ctx.font = `italic 600 40px ${SERIF}`;
      ctx.fillText('Roulette', b.pxW / 2, 60);
      ctx.font = `22px ${SERIF}`;
      ctx.fillStyle = '#a99670';
      ctx.fillText('MIN $1  ·  MAX $1,000', b.pxW / 2, 96);
      const hist = this.game.history.slice(0, 14);
      hist.forEach((p, i) => {
        const y = 150 + i * 60;
        const col = pocketColor(p);
        const x = col === 'red' ? b.pxW * 0.3 : col === 'black' ? b.pxW * 0.7 : b.pxW * 0.5;
        ctx.fillStyle = col === 'red' ? '#ff4a4a' : col === 'black' ? '#f2f2f2' : '#3ddc84';
        ctx.font = `bold ${i === 0 ? 54 : 42}px ${SERIF}`;
        ctx.fillText(pocketLabel(p), x, y + (i === 0 ? 4 : 0));
      });
      if (hist.length === 0) {
        ctx.fillStyle = '#7d6d50';
        ctx.font = `italic 28px ${SERIF}`;
        ctx.fillText('Place your bets', b.pxW / 2, 300);
      }
    };
    b.redraw();
    return b;
  }

  // ---------------------------------------------------------------------------
  // Betting
  // ---------------------------------------------------------------------------

  private bet(spotId: string, amount: number = this.chip, silent = false) {
    try {
      this.game.placeBet(spotId, amount);
      this.undoStack.push({ spotId, amount });
      this.dolly.visible = false;
      this.refreshStack(spotId, true);
      if (!silent) this.ctx.sound.play('chip', this.stacks.get(spotId), { volume: 0.9, rate: 0.95 + Math.random() * 0.1 });
    } catch (e) {
      if (e instanceof BetRejected) {
        this.ctx.hud.toast(e.message, 'warn');
        this.ctx.sound.play('denied', this.panel.mesh, { volume: 0.6 });
      } else throw e;
    }
    this.panel.redraw();
  }

  private undo() {
    const last = this.undoStack.pop();
    if (!last) return;
    // Refund just the last chip: remove the spot and re-place what was there before.
    const total = this.game.bets.get(last.spotId) ?? 0;
    this.game.removeBet(last.spotId);
    if (total - last.amount > 0) this.game.placeBet(last.spotId, total - last.amount);
    this.refreshStack(last.spotId);
    this.ctx.sound.play('chip', this.panel.mesh, { volume: 0.6 });
    this.panel.redraw();
  }

  private clear() {
    this.game.clearBets();
    for (const id of [...this.stacks.keys()]) this.refreshStack(id);
    this.undoStack = [];
    this.ctx.sound.play('chips', this.panel.mesh);
    this.panel.redraw();
  }

  private rebet() {
    if (!this.game.rebet()) {
      this.ctx.hud.toast('Not enough chips to rebet', 'warn');
      return;
    }
    this.undoStack = [];
    for (const id of this.game.bets.keys()) this.refreshStack(id, true);
    this.dolly.visible = false;
    this.ctx.sound.play('chips', this.panel.mesh);
    this.panel.redraw();
  }

  private double() {
    const bets = [...this.game.bets];
    for (const [id, v] of bets) this.bet(id, v, true);
    this.ctx.sound.play('chips', this.panel.mesh);
  }

  private refreshStack(spotId: string, drop = false) {
    const old = this.stacks.get(spotId);
    if (old) {
      this.group.remove(old);
      this.stacks.delete(spotId);
    }
    const amount = this.game.bets.get(spotId) ?? 0;
    if (amount <= 0) return;
    const spot = SPOTS_BY_ID.get(spotId)!;
    const [x, z] = spotAnchor(spot);
    const stack = makeChipStack(amount);
    stack.position.set(x, TOP + 0.001, z);
    stack.traverse((o) => (o.castShadow = this.ctx.quality.shadows));
    this.group.add(stack);
    this.stacks.set(spotId, stack);
    if (drop) {
      const top = stack.children.at(-1)!;
      const y = top.position.y;
      this.tweens.add(0.18, (k) => (top.position.y = y + (1 - k) ** 2 * 0.06));
    }
  }

  private setHover(spotId: string | null, chip: ChipDenom = this.chip) {
    if (spotId === this.hoverSpot && chip === this.chip) return;
    if (chip !== this.chip) this.chip = chip;
    this.hoverSpot = spotId;
    if (spotId && this.game.phase === 'betting') {
      const [x, z] = spotAnchor(SPOTS_BY_ID.get(spotId)!);
      const h = (this.game.bets.get(spotId) ? this.stacks.get(spotId)!.children.length : 0) * CHIP_HEIGHT;
      this.ghost.position.set(x, TOP + h + 0.002 + CHIP_HEIGHT / 2, z);
      this.ghost.visible = true;
      const chip = this.ghost.children[0] as THREE.Mesh;
      const fresh = makeChip(this.chip);
      chip.material = (fresh.material as THREE.Material[]).map((m) => {
        const c = m.clone();
        c.transparent = true;
        c.opacity = 0.55;
        return c;
      });
    } else {
      this.ghost.visible = false;
    }
    this.panel.redraw();
  }

  private onKey(e: KeyboardEvent) {
    if (this.ctx.hud.station !== 'roulette') return;
    if (e.code === 'Space') {
      e.preventDefault();
      this.startSpin();
    } else if (e.code === 'KeyC') this.clear();
    else if (e.code === 'KeyR') this.rebet();
    else if (e.code === 'KeyZ' || e.code === 'Backspace') this.undo();
    else if (/^Digit[1-7]$/.test(e.code)) {
      this.chip = CHIP_DENOMS[Number(e.code.slice(5)) - 1];
      this.panel.redraw();
    }
  }

  // ---------------------------------------------------------------------------
  // Spin
  // ---------------------------------------------------------------------------

  /** World spots for the croupier and for guests standing around the table. */
  spots() {
    const w = (x: number, z: number) => this.group.localToWorld(new THREE.Vector3(x, 0, z));
    const yaw = this.group.rotation.y;
    return {
      croupier: { pos: w(WHEEL_CENTER.x + 0.42, -0.86), yaw },
      watchers: [
        { pos: w(0.35, -0.9), yaw },
        { pos: w(0.95, -0.85), yaw: yaw - 0.3 },
        { pos: w(1.55, -0.1), yaw: yaw - Math.PI / 2 },
        { pos: w(-0.75, 0.98), yaw: yaw + Math.PI, seated: true },
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // Chip rack on the rail: pick chips up with your hand in VR.
  // ---------------------------------------------------------------------------

  /** Grabbables for the VR hands system (set up by main once hands exist). */
  readonly grabbables: import('../hands').Grabbable[] = [];

  private buildRack() {
    const y = TOP + 0.09,
      z = 0.47;
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.02, 0.09), new THREE.MeshStandardMaterial({ color: 0x2a1408, roughness: 0.4 }));
    tray.position.set(-0.62, y - 0.01, z);
    this.group.add(tray);
    const chipGeo = new THREE.CylinderGeometry(0.0195, 0.0195, 0.0033, 20);
    const perStack = 12;
    const rack = new THREE.InstancedMesh(chipGeo, new THREE.MeshStandardMaterial({ roughness: 0.45 }), CHIP_DENOMS.length * perStack);
    const tmp = new THREE.Object3D();
    const COLORS = [0xf2f0ea, 0xc0262d, 0x1e7a3a, 0x1b1b1f, 0x6b2f8f, 0xe4b833, 0x8a4f22];
    CHIP_DENOMS.forEach((d, i) => {
      const x = -0.86 + i * 0.08;
      for (let k = 0; k < perStack; k++) {
        tmp.position.set(x, y + 0.0017 + k * 0.0033, z);
        tmp.updateMatrix();
        rack.setMatrixAt(i * perStack + k, tmp.matrix);
        rack.setColorAt(i * perStack + k, new THREE.Color(COLORS[i]));
      }
      const top = new THREE.Vector3(x, y + perStack * 0.0033, z);
      this.grabbables.push({
        at: () => this.group.localToWorld(top.clone()),
        radius: 0.085,
        enabled: () => this.game.phase === 'betting',
        grab: () => {
          const chip = makeChip(d);
          chip.position.copy(this.group.localToWorld(top.clone()));
          this.ctx.sound.play('chip', chip, { volume: 0.5 });
          return chip;
        },
        drag: (_h, pos) => {
          const l = this.group.worldToLocal(pos.clone());
          this.setHover(l.y > TOP - 0.05 && l.y < TOP + 0.35 ? spotAt(l.x, l.z)?.id ?? null : null, d);
        },
        release: (_h, pos, carried) => {
          carried?.removeFromParent();
          const l = this.group.worldToLocal(pos.clone());
          const spot = l.y > TOP - 0.05 && l.y < TOP + 0.35 ? spotAt(l.x, l.z) : null;
          this.setHover(null);
          if (spot) this.bet(spot.id, d);
          else this.ctx.sound.play('chip', this.panel.mesh, { volume: 0.3 });
        },
      });
    });
    rack.raycast = () => {};
    this.group.add(dynamic(rack));
  }

  private startSpin() {
    if (this.game.phase !== 'betting') return;
    if (this.game.bets.size === 0) {
      this.ctx.hud.toast('Place a bet first', 'warn');
      return;
    }
    const target = this.game.spin(this.ctx.rng);
    this.onSpin?.();
    const idx = WHEEL_ORDER.indexOf(target);
    // Relative angle to cover: the ball runs the opposite way to the rotor.
    this.spin = { t: 0, target, theta: idx * SECTOR, r0: 34 + Math.random() * 4 };
    this.rotorSpeed = 2.4;
    this.ballRest = null;
    this.ghost.visible = false;
    this.dolly.visible = false;
    this.ctx.hud.toast('No more bets', 'info');
    this.panel.redraw();
  }

  private placeBallOnTrack(phi: number) {
    this.ball.position.set(Math.cos(phi) * R.track, 0.104, -Math.sin(phi) * R.track);
  }

  private finishSpin() {
    const result = this.game.settle();
    this.spin = null;
    this.ballLoop.stop();
    const net = result.totalReturned - result.totalStaked;
    this.onResult?.(result.pocket, result.totalStaked, result.totalReturned);
    this.lastResult = { pocket: result.pocket, net };
    const label = `${pocketLabel(result.pocket)} ${result.color}`;
    if (result.totalReturned > 0) {
      this.ctx.hud.toast(`${label} · You win ${money(result.totalReturned)}`, 'win');
      this.ctx.sound.play(result.totalReturned >= result.totalStaked * 10 ? 'winBig' : 'winSmall', this.wheelGroup);
    } else {
      this.ctx.hud.toast(`${label} · Better luck next spin`, 'info');
    }

    // Dolly on the winning number.
    const winSpot = SPOTS_BY_ID.get(`straight:${pocketLabel(result.pocket)}`)!;
    const [dx, dz] = spotAnchor(winSpot);
    const hasStack = this.stacks.get(winSpot.id);
    this.dolly.position.set(dx, TOP + 0.035 + (hasStack ? hasStack.children.length * CHIP_HEIGHT : 0), dz);
    this.dolly.visible = true;

    // Losing chips slide to the dealer; winners get paid and pushed to the player.
    for (const r of result.results) {
      const stack = this.stacks.get(r.spotId);
      if (!stack) continue;
      this.stacks.delete(r.spotId);
      const from = stack.position.clone();
      if (!r.won) {
        const to = new THREE.Vector3(WHEEL_CENTER.x + 0.3, TOP, -0.4);
        this.tweens.add(0.9, (k) => {
          const e = easeInOut(k);
          stack.position.lerpVectors(from, to, e);
          stack.scale.setScalar(1 - e * 0.6);
        }, () => this.group.remove(stack));
      } else {
        const pay = makeChipStack(r.returned - r.stake);
        pay.position.copy(from).add(new THREE.Vector3(0.045, 0, 0));
        this.group.add(pay);
        const to = new THREE.Vector3(0.15, TOP + 0.002, 0.5);
        setTimeout(() => {
          this.tweens.add(1.0, (k) => {
            const e = easeInOut(k);
            stack.position.lerpVectors(from, to, e);
            pay.position.lerpVectors(from.clone().add(new THREE.Vector3(0.045, 0, 0)), to.clone().add(new THREE.Vector3(0.045, 0, 0)), e);
          }, () => {
            this.group.remove(stack, pay);
            this.ctx.sound.play('chips', this.panel.mesh, { volume: 0.8 });
          });
        }, 1400);
      }
    }
    this.undoStack = [];
    this.panel.redraw();
    this.board.redraw();
  }

  update(dt: number) {
    this.tweens.update(dt);

    // Rotor slows toward its idle speed.
    this.rotorSpeed = Math.max(0.35, this.rotorSpeed * Math.exp(-0.12 * dt));
    this.rotorAngle += this.rotorSpeed * dt;
    this.rotor.rotation.y = this.rotorAngle;

    const sp = this.spin;
    if (sp) {
      sp.t += dt;
      const s = Math.min(1, sp.t / SPIN_TIME);
      const rel = sp.r0 * (1 - s) ** 3;
      const phi = this.rotorAngle + sp.theta + rel;
      let r: number, y: number;
      if (s < 0.6) {
        r = R.track;
        y = 0.104 + Math.sin(sp.t * 40) * 0.0006;
      } else if (s < 0.78) {
        const k = (s - 0.6) / 0.18;
        r = R.track + (0.29 - R.track) * k * k;
        y = 0.104 + (0.07 - 0.104) * k + Math.abs(Math.sin(k * 9)) * 0.012 * (1 - k);
      } else {
        const k = (s - 0.78) / 0.22;
        const bounce = Math.abs(Math.sin(k * 14)) * (1 - k) ** 2;
        r = 0.29 + (R.pocket - 0.29) * Math.min(1, k * 1.6) + bounce * 0.03;
        y = 0.07 + (0.058 - 0.07) * Math.min(1, k * 1.6) + bounce * 0.02;
        if (bounce < 0.02 && (k * 14) % Math.PI < 0.3 && Math.random() < 0.3) {
          this.ctx.sound.play('ballDrop', this.ball, { volume: 0.25 * (1 - k) + 0.05 });
        }
      }
      this.ball.position.set(Math.cos(phi) * r, y, -Math.sin(phi) * r);
      const speed = Math.abs(-3 * sp.r0 * (1 - s) ** 2 / SPIN_TIME);
      if (s < 0.78) this.ballLoop.set(Math.min(1, speed / 10) * 0.7, 0.6 + speed / 14);
      else this.ballLoop.set(0);
      if (s >= 1) {
        this.ballRest = sp.target;
        this.finishSpin();
      }
    } else if (this.ballRest !== null) {
      const phi = this.rotorAngle + WHEEL_ORDER.indexOf(this.ballRest) * SECTOR;
      this.ball.position.set(Math.cos(phi) * R.pocket, 0.058, -Math.sin(phi) * R.pocket);
    }
  }
}

function roundedRectShape(cx: number, cz: number, w: number, d: number, r: number): THREE.Shape {
  // Shape is drawn in X/Y; after rotateX(+90deg) Y maps to +Z.
  const s = new THREE.Shape();
  const x0 = cx - w / 2,
    y0 = cz - d / 2;
  s.moveTo(x0 + r, y0);
  s.lineTo(x0 + w - r, y0);
  s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  s.lineTo(x0 + w, y0 + d - r);
  s.quadraticCurveTo(x0 + w, y0 + d, x0 + w - r, y0 + d);
  s.lineTo(x0 + r, y0 + d);
  s.quadraticCurveTo(x0, y0 + d, x0, y0 + d - r);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

/** Pocket colours and numbers for the rotor, laid out to match RingGeometry UVs. */
function rotorTexture(size: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const cx = size / 2,
    scale = size / 2 / R.numbersOut;
  ctx.fillStyle = '#2a1a0e';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < POCKETS; i++) {
    const p = WHEEL_ORDER[i];
    const a0 = -(i + 0.5) * SECTOR,
      a1 = -(i - 0.5) * SECTOR;
    const col = pocketColor(p);
    ctx.beginPath();
    ctx.arc(cx, cx, R.numbersOut * scale, a0, a1);
    ctx.arc(cx, cx, (R.pocket - 0.03) * scale, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = col === 'red' ? '#a3121c' : col === 'black' ? '#141012' : '#0f7a3c';
    ctx.fill();
    // Number in the outer band, reading outward.
    const mid = -i * SECTOR;
    ctx.save();
    ctx.translate(cx + Math.cos(mid) * ((R.numbersIn + R.numbersOut) / 2) * scale, cx + Math.sin(mid) * ((R.numbersIn + R.numbersOut) / 2) * scale);
    ctx.rotate(mid + Math.PI / 2);
    ctx.fillStyle = '#f6efd8';
    ctx.font = `bold ${Math.round(size * 0.04)}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pocketLabel(p), 0, 0);
    ctx.restore();
  }
  // Gold separator rings.
  ctx.strokeStyle = '#d8b25a';
  ctx.lineWidth = size * 0.004;
  for (const r of [R.numbersIn, R.numbersOut - 0.002]) {
    ctx.beginPath();
    ctx.arc(cx, cx, r * scale, 0, Math.PI * 2);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
