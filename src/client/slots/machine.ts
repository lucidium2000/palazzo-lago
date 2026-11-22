import { assets } from '../assets';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { SlotGame, symbolMap, type Machine, type SpinOutcome } from '../../rules/slots';
import { money, Tweens, type GameContext } from '../game';
import { CanvasPanel, GOLD, GOLD_LIGHT, roundRect, SERIF } from '../panel';
import type { Viewpoint } from '../player';
import { radial, toTexture } from '../textures';
import { symbolAtlas } from './symbols';
import { bakeStatic, dynamic } from '../merge';

export interface CabinetTheme {
  body: number;
  accent: number;
  screenBg: [string, string];
  reelBg: [string, string];
}

const ROWS = 3;
const DECK_TILT = 0.3;

interface ReelAnim {
  pos: number;
  from: number;
  distance: number;
  start: number;
  stopAt: number;
  stopped: boolean;
  anticipation: boolean;
}

type Mode = 'idle' | 'spinning' | 'showing' | 'pick' | 'info';

export class SlotMachineView {
  readonly group = new THREE.Group();
  readonly game: SlotGame;
  readonly viewpoint: Viewpoint;
  private screen: CanvasPanel;
  private deck: CanvasPanel;
  private marquee: CanvasPanel;
  private atlas: { canvas: HTMLCanvasElement; index: Map<string, number> };
  private blurAtlas: HTMLCanvasElement;
  private cell: number;
  private reels: ReelAnim[];
  private time = 0;
  mode: Mode = 'idle';
  /** Called when the reels settle: (amount staked, amount won, feature triggered). */
  onResult: ((staked: number, won: number, feature?: 'freeSpins' | 'pick') => void) | null = null;
  /** Called for each pick-bonus tile revealed. */
  onPick: ((won: number, done: boolean, total: number) => void) | null = null;
  private lastStake = 0;
  private outcome: SpinOutcome | null = null;
  private pendingWin = 0;
  private shownWin = 0;
  private winTimer = 0;
  private bulbs: THREE.InstancedMesh;
  private bulbOn = new THREE.Color(0xfff0b0);
  private bulbOff = new THREE.Color(0x4a3518);
  private bulbColorDirty = 0;
  private sideStrips: THREE.MeshStandardMaterial;
  private tweens = new Tweens();
  private reelLoop: ReturnType<GameContext['sound']['loop']>;
  private lever: THREE.Group | null = null;
  private freeSpinTimer = 0;
  private pickRevealAt = new Map<number, number>();
  private reelArea: { x: number; y: number; w: number; h: number };
  private dirty = true;
  private wasFeature = false;
  private featureTotal = 0;

  constructor(
    private ctx: GameContext,
    readonly machine: Machine,
    position: THREE.Vector3,
    yaw: number,
    private theme: CabinetTheme,
  ) {
    this.game = new SlotGame(machine, ctx.bankroll);
    this.game.betIndex = 1;
    this.group.position.copy(position);
    this.group.rotation.y = yaw;
    ctx.scene.add(this.group);

    const classic = machine.type === 'classic';
    this.cell = classic ? 200 : 168;
    this.atlas = symbolAtlas(machine, this.cell);
    this.blurAtlas = blurred(this.atlas.canvas);
    this.reels = machine.reels.map((strip) => ({
      pos: Math.floor(Math.random() * strip.length),
      from: 0,
      distance: 0,
      start: 0,
      stopAt: 0,
      stopped: true,
      anticipation: false,
    }));

    const screenPx = classic ? { w: 760, h: 700 } : { w: 1000, h: 720 };
    const cols = machine.reels.length;
    this.reelArea = {
      w: cols * this.cell,
      h: ROWS * this.cell,
      x: (screenPx.w - cols * this.cell) / 2,
      y: classic ? 50 : 70,
    };
    this.screen = new CanvasPanel(classic ? 0.5 : 0.6, screenPx.w, screenPx.h, { transparent: false });
    this.deck = new CanvasPanel(0.62, 1240, 360);
    this.marquee = new CanvasPanel(0.62, 1240, 440, { transparent: false });
    this.bulbs = this.buildCabinet();
    this.sideStrips = (this.group.getObjectByName('strips') as THREE.Mesh).material as THREE.MeshStandardMaterial;
    this.setupScreen();
    this.setupDeck();
    this.drawMarquee();
    this.reelLoop = ctx.sound.loop('reelTick', this.screen.mesh);

    const vp = new THREE.Vector3(0, 0, 0.82).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(position);
    this.viewpoint = { id: machine.id, label: machine.name, position: vp, yaw, pitch: -0.34, eye: 1.55, back: 0.32, portrait: { back: -0.12, eye: 1.3, pitch: -0.06 } };
    ctx.bankroll.onChange(() => this.deck.redraw());
    if (this.lever) dynamic(this.lever.parent!);
    bakeStatic(this.group, { shadows: ctx.quality.shadows });
  }

  // ---------------------------------------------------------------------------
  // Cabinet
  // ---------------------------------------------------------------------------

  private buildCabinet(): THREE.InstancedMesh {
    const g = this.group;
    const q = this.ctx.quality;
    const lacquer = new THREE.MeshPhysicalMaterial({
      color: this.theme.body,
      roughness: 0.25,
      metalness: 0.1,
      clearcoat: q.name === 'desktop' ? 1 : 0,
      clearcoatRoughness: 0.1,
      envMapIntensity: 1.2,
    });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd8ae58, metalness: 1, roughness: 0.25, envMapIntensity: 1.4 });
    const black = new THREE.MeshStandardMaterial({ color: 0x0c0a0a, roughness: 0.35 });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      m.castShadow = q.shadows;
      g.add(m);
      return m;
    };
    add(new RoundedBoxGeometry(0.7, 0.8, 0.6, 3, 0.03), lacquer, 0, 0.4, 0);
    add(new THREE.BoxGeometry(0.72, 0.03, 0.62), gold, 0, 0.8, 0);
    add(new THREE.BoxGeometry(0.66, 0.06, 0.5), black, 0, 0.03, 0);
    // Deck (button shelf).
    add(new RoundedBoxGeometry(0.7, 0.05, 0.3, 2, 0.015), lacquer, 0, 0.86, 0.2, DECK_TILT);
    // Upper body.
    add(new RoundedBoxGeometry(0.7, 0.95, 0.42, 3, 0.03), lacquer, 0, 1.33, -0.07);
    // Gold bezel around the screen.
    const classic = this.machine.type === 'classic';
    const sw = classic ? 0.5 : 0.6;
    const sh = (sw * this.screen.pxH) / this.screen.pxW;
    const screenY = 1.26;
    const bezel = new THREE.Shape();
    bezel.moveTo(-sw / 2 - 0.03, -sh / 2 - 0.03);
    bezel.lineTo(sw / 2 + 0.03, -sh / 2 - 0.03);
    bezel.lineTo(sw / 2 + 0.03, sh / 2 + 0.03);
    bezel.lineTo(-sw / 2 - 0.03, sh / 2 + 0.03);
    bezel.holes.push(new THREE.Path().moveTo(-sw / 2, -sh / 2).lineTo(sw / 2, -sh / 2).lineTo(sw / 2, sh / 2).lineTo(-sw / 2, sh / 2));
    const bezelMesh = add(new THREE.ExtrudeGeometry(bezel, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.004, bevelSegments: 2 }), gold, 0, screenY, 0.158);
    bezelMesh.rotation.x = -0.08;

    if (classic) {
      // Bend the reel window into a drum so it reads as physical reels.
      const geo = this.screen.mesh.geometry as THREE.PlaneGeometry;
      const bent = new THREE.PlaneGeometry(sw, sh, 1, 24);
      const pos = bent.attributes.position as THREE.BufferAttribute;
      const r = 0.32;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const a = y / r;
        pos.setY(i, Math.sin(a) * r);
        pos.setZ(i, (Math.cos(a) - 1) * r + 0.03);
      }
      bent.computeVertexNormals();
      this.screen.mesh.geometry = bent;
      geo.dispose();
      const glass = new THREE.Mesh(
        new THREE.PlaneGeometry(sw, sh),
        new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, roughness: 0.02, metalness: 1, envMapIntensity: 2.5, depthWrite: false }),
      );
      glass.position.set(0, screenY, 0.19);
      glass.rotation.x = -0.08;
      g.add(glass);
    }
    this.screen.mesh.position.set(0, screenY, 0.172);
    this.screen.mesh.rotation.x = -0.08;
    g.add(this.screen.mesh);

    // Deck panel on the shelf.
    // Lies on the shelf, facing up and tilted toward the player.
    this.deck.mesh.rotation.x = -Math.PI / 2 + DECK_TILT;
    this.deck.mesh.position.set(0, 0.86, 0.2).add(new THREE.Vector3(0, Math.cos(DECK_TILT), Math.sin(DECK_TILT)).multiplyScalar(0.027));
    g.add(this.deck.mesh);

    // Topper with marquee and chasing bulbs.
    add(new RoundedBoxGeometry(0.72, 0.34, 0.32, 3, 0.04), lacquer, 0, 1.98, -0.1);
    this.marquee.mesh.position.set(0, 1.98, 0.065);
    g.add(this.marquee.mesh);
    const mw = 0.62,
      mh = (0.62 * this.marquee.pxH) / this.marquee.pxW;
    const bulbCount = 44;
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.009, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: false }), bulbCount);
    const tmp = new THREE.Object3D();
    for (let i = 0; i < bulbCount; i++) {
      const t = i / bulbCount;
      const per = 2 * (mw + mh);
      let d = t * per;
      let x: number, y: number;
      if (d < mw) [x, y] = [-mw / 2 + d, mh / 2 + 0.012];
      else if ((d -= mw) < mh) [x, y] = [mw / 2 + 0.012, mh / 2 - d];
      else if ((d -= mh) < mw) [x, y] = [mw / 2 - d, -mh / 2 - 0.012];
      else [x, y] = [-mw / 2 - 0.012, -mh / 2 + (d - mw)];
      tmp.position.set(x, 1.98 + y, 0.068);
      tmp.updateMatrix();
      bulbs.setMatrixAt(i, tmp.matrix);
      bulbs.setColorAt(i, this.bulbOn);
    }
    g.add(bulbs);

    // Accent light strips down both front edges.
    const stripMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: this.theme.accent, emissiveIntensity: 1.4 });
    const strips = new THREE.Group();
    strips.name = 'strips-group';
    for (const sx of [-0.352, 0.352]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.012, 1.7, 0.012), stripMat);
      s.position.set(sx, 1.1, 0.16);
      strips.add(s);
    }
    (strips.children[0] as THREE.Mesh).name = 'strips';
    g.add(strips);

    // Glow pool on the floor + contact shadow.
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.2, 1.3),
      new THREE.MeshBasicMaterial({ map: toTexture(radial(128, 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0)')), transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, 0.011, 0.1);
    g.add(shadow);
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 0.8),
      new THREE.MeshBasicMaterial({
        map: toTexture(radial(128, '#' + new THREE.Color(this.theme.accent).getHexString(), 'rgba(0,0,0,0)')),
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, 0.012, 0.55);
    g.add(pool);

    // Stool.
    const leather = assets.material('leather', { repeat: 1, rough: 0.8, tint: 0x7a4040, fallback: () => new THREE.MeshStandardMaterial({ color: 0x3a1015, roughness: 0.5 }) });
    const seat = add(new THREE.CylinderGeometry(0.19, 0.17, 0.08, 24), leather, 0, 0.66, 0.78);
    seat.castShadow = false;
    add(new THREE.CylinderGeometry(0.028, 0.028, 0.6, 10), gold, 0, 0.32, 0.78);
    add(new THREE.CylinderGeometry(0.19, 0.21, 0.03, 24), gold, 0, 0.015, 0.78);

    // Classic machines get a pull lever on the right side.
    if (this.machine.type === 'classic') {
      const lever = new THREE.Group();
      lever.position.set(0.39, 1.0, 0.0);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 20), gold);
      hub.rotation.z = Math.PI / 2;
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 10), gold);
      rod.position.set(0.03, 0.21, 0);
      const knob = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 20, 14),
        new THREE.MeshStandardMaterial({ color: 0xc8121e, roughness: 0.15, envMapIntensity: 1.5 }),
      );
      knob.position.set(0.03, 0.44, 0);
      const arm = new THREE.Group();
      arm.add(rod, knob);
      lever.add(hub, arm);
      g.add(lever);
      this.lever = arm;
      this.ctx.interaction.register({
        object: lever,
        onSelect: () => this.pullLever(),
        enabled: () => this.mode !== 'spinning',
      });
    }
    return bulbs;
  }

  private drawMarquee() {
    const m = this.marquee;
    const ctx = m.ctx;
    const [a, b] = this.theme.screenBg;
    const g = ctx.createLinearGradient(0, 0, 0, m.pxH);
    g.addColorStop(0, b);
    g.addColorStop(0.5, a);
    g.addColorStop(1, b);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, m.pxW, m.pxH);
    // Sunburst.
    ctx.save();
    ctx.translate(m.pxW / 2, m.pxH * 0.62);
    for (let i = 0; i < 24; i++) {
      ctx.rotate((Math.PI * 2) / 24);
      ctx.fillStyle = i % 2 ? 'rgba(255,220,140,0.08)' : 'rgba(255,255,255,0.03)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(m.pxW, -60);
      ctx.lineTo(m.pxW, 60);
      ctx.fill();
    }
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `italic bold 130px ${SERIF}`;
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#2a1606';
    ctx.strokeText(this.machine.name, m.pxW / 2, m.pxH * 0.42);
    const tg = ctx.createLinearGradient(0, m.pxH * 0.25, 0, m.pxH * 0.6);
    tg.addColorStop(0, '#fff5cf');
    tg.addColorStop(0.5, '#f0bf4c');
    tg.addColorStop(1, '#b87d22');
    ctx.fillStyle = tg;
    ctx.shadowColor = '#ffcc66';
    ctx.shadowBlur = 30;
    ctx.fillText(this.machine.name, m.pxW / 2, m.pxH * 0.42);
    ctx.shadowBlur = 0;
    ctx.font = `46px ${SERIF}`;
    ctx.fillStyle = '#f6e7c3';
    ctx.fillText(this.machine.tagline, m.pxW / 2, m.pxH * 0.78);
    m.texture.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------
  // Deck controls
  // ---------------------------------------------------------------------------

  private setupDeck() {
    const d = this.deck;
    d.background = (ctx) => {
      roundRect(ctx, 4, 4, d.pxW - 8, d.pxH - 8, 30);
      ctx.fillStyle = 'rgba(14,10,8,0.92)';
      ctx.fill();
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = GOLD_LIGHT;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = `600 44px ${SERIF}`;
      ctx.fillText(`Credits ${money(this.ctx.bankroll.balance - this.pendingWin)}`, 40, 56);
      ctx.textAlign = 'right';
      const bet = this.game.phase === 'freeSpins' ? this.game.freeSpinBet : this.game.bet;
      ctx.fillText(`Bet ${money(bet)}`, d.pxW - 40, 56);
    };
    const idle = () => this.mode !== 'spinning' && this.game.phase === 'idle';
    d.add({ id: 'info', x: 40, y: 120, w: 170, h: 200, label: 'Info', sub: 'paytable', onPress: () => this.toggleInfo(), active: () => this.mode === 'info', enabled: () => this.mode !== 'spinning' && this.mode !== 'pick' });
    d.add({ id: 'bet-', x: 230, y: 120, w: 150, h: 200, label: '–', sub: 'bet', onPress: () => this.changeBet(-1), enabled: idle });
    d.add({ id: 'bet+', x: 400, y: 120, w: 150, h: 200, label: '+', sub: 'bet', onPress: () => this.changeBet(1), enabled: idle });
    d.add({ id: 'max', x: 570, y: 120, w: 200, h: 200, label: 'Max', sub: 'bet', onPress: () => this.maxBet(), enabled: idle });
    d.add({
      id: 'spin',
      x: 800,
      y: 110,
      w: 400,
      h: 220,
      label: () => (this.mode === 'spinning' ? 'STOP' : this.game.phase === 'freeSpins' ? 'FREE' : 'SPIN'),
      sub: () => (this.game.phase === 'freeSpins' ? `${this.game.freeSpinsLeft} left` : this.mode === 'pick' ? 'pick on screen' : ''),
      active: () => this.mode !== 'pick',
      enabled: () => this.mode !== 'pick',
      onPress: () => this.onSpinPressed(),
    });
    d.register(this.ctx.interaction);
    d.redraw();
  }

  changeBet(dir: 1 | -1) {
    this.game.changeBet(dir);
    this.ctx.sound.play('click', this.deck.mesh, { volume: 0.5 });
    this.deck.redraw();
  }

  maxBet() {
    while (this.game.betIndex < this.machine.betLevels.length - 1) this.game.changeBet(1);
    this.ctx.sound.play('click', this.deck.mesh, { volume: 0.5 });
    this.deck.redraw();
  }

  toggleInfo() {
    this.mode = this.mode === 'info' ? 'idle' : 'info';
    this.dirty = true;
    this.deck.redraw();
  }

  /** VR: grab the lever knob and pull it down to spin. */
  leverGrab(): import('../hands').Grabbable | null {
    const arm = this.lever;
    if (!arm) return null;
    let startY = 0,
      fired = false;
    const knob = new THREE.Vector3(0.03, 0.44, 0);
    return {
      at: () => arm.localToWorld(knob.clone()),
      radius: 0.09,
      enabled: () => this.mode !== 'spinning',
      grab: (hand) => {
        startY = hand.pos.y;
        fired = false;
        return 'drag';
      },
      drag: (_h, pos) => {
        const a = THREE.MathUtils.clamp(((startY - pos.y) / 0.32) * 1.1, 0, 1.1);
        arm.rotation.x = a;
        if (a > 0.95 && !fired) {
          fired = true;
          this.ctx.sound.play('lever', arm, { volume: 0.8 });
          this.onSpinPressed();
        }
      },
      release: () => {
        const from = arm.rotation.x;
        this.tweens.add(0.35, (k) => (arm.rotation.x = from * (1 - k) ** 2));
      },
    };
  }

  private pullLever() {
    if (!this.lever || this.mode === 'spinning') return;
    this.ctx.sound.play('lever', this.lever, { volume: 0.8 });
    const arm = this.lever;
    this.tweens.add(0.5, (k) => {
      arm.rotation.x = Math.sin(k * Math.PI) * 1.0;
    });
    setTimeout(() => this.onSpinPressed(), 220);
  }

  onSpinPressed() {
    if (this.mode === 'spinning') return this.slamStop();
    if (this.mode === 'pick') return;
    this.startSpin();
  }

  // ---------------------------------------------------------------------------
  // Spinning
  // ---------------------------------------------------------------------------

  private startSpin() {
    if (this.game.phase === 'pick') return;
    if (this.game.phase === 'idle' && !this.ctx.bankroll.canAfford(this.game.bet)) {
      this.ctx.hud.toast('Not enough credits — lower your bet', 'warn');
      this.ctx.sound.play('denied', this.deck.mesh);
      return;
    }
    const wasFree = this.game.phase === 'freeSpins';
    this.lastStake = wasFree ? 0 : this.game.bet;
    const out = this.game.spin(this.ctx.rng);
    this.outcome = out;
    this.pendingWin = out.win;
    if (out.triggered === 'pick' && this.game.pickState) this.pendingWin = out.win;
    this.ctx.hud.setPending(this.machine.id, out.win);
    this.shownWin = 0;
    this.mode = 'spinning';
    if (!wasFree && this.game.phase !== 'freeSpins') this.featureTotal = 0;

    // Stop times, with anticipation when a feature is one symbol away.
    const defs = symbolMap(this.machine);
    const featureKind = this.machine.type === 'video' ? (this.machine.feature.type === 'freeSpins' ? 'scatter' : 'bonus') : null;
    const need = this.machine.type === 'video' ? (this.machine.feature.type === 'freeSpins' ? this.machine.feature.trigger : this.machine.feature.reels.length) : 99;
    let seen = 0;
    let t = 0.75;
    this.reels.forEach((r, i) => {
      const strip = this.machine.reels[i];
      const len = strip.length;
      const target = out.stops[i];
      const anticipation = featureKind !== null && seen >= need - 1 && i > 0;
      t += anticipation ? 1.3 : i === 0 ? 0 : 0.28;
      const speed = 22; // symbols per second
      const delta = (((r.pos - target) % len) + len) % len;
      const laps = Math.max(1, Math.round((speed * t - delta) / len));
      r.from = r.pos;
      r.distance = laps * len + delta;
      r.start = this.time;
      r.stopAt = this.time + t;
      r.stopped = false;
      r.anticipation = anticipation;
      if (featureKind && out.grid[i].some((s) => defs.get(s)!.kind === featureKind)) seen++;
    });
    this.deck.redraw();
  }

  private slamStop() {
    for (const r of this.reels) {
      if (!r.stopped && r.stopAt - this.time > 0.15) {
        // Keep the landing position; just arrive sooner.
        const elapsed = this.time - r.start;
        const total = r.stopAt - r.start;
        const k = Math.min(1, elapsed / total);
        const done = reelEase(k) * r.distance;
        r.from = r.from - done;
        r.distance = r.distance - done;
        r.start = this.time;
        r.stopAt = this.time + 0.15;
      }
    }
  }

  private onAllStopped() {
    const out = this.outcome!;
    this.onResult?.(this.lastStake, out.win, out.triggered);
    this.reelLoop.stop();
    this.mode = 'showing';
    this.winTimer = 0;
    this.ctx.hud.setPending(this.machine.id, 0);
    const pending = this.pendingWin;
    this.pendingWin = 0;
    if (this.game.phase === 'freeSpins' || this.wasFeature) this.featureTotal += pending;
    if (out.win > 0) {
      const big = out.win >= (this.game.phase === 'freeSpins' ? this.game.freeSpinBet : this.game.bet) * 15;
      this.ctx.sound.play(big ? 'winBig' : 'winSmall', this.screen.mesh);
      this.tweens.add(Math.min(2.5, 0.6 + out.win / 200), (k) => {
        this.shownWin = Math.round(out.win * k * 100) / 100;
        this.dirty = true;
      });
      if (big) this.ctx.hud.toast(`${this.machine.name} · Big win ${money(out.win)}!`, 'win');
    }
    if (out.triggered === 'freeSpins') {
      this.ctx.sound.play('bonus', this.screen.mesh);
      this.ctx.hud.toast(`Free spins! ${this.game.freeSpinsLeft} spins, all wins x2`, 'win');
      this.freeSpinTimer = 2.4;
    } else if (out.triggered === 'pick') {
      this.ctx.sound.play('bonus', this.screen.mesh);
      this.ctx.hud.toast('Garden Pick bonus! Choose 3 tiles', 'win');
      setTimeout(() => {
        this.mode = 'pick';
        this.dirty = true;
        this.deck.redraw();
      }, 1600);
    } else if (this.game.phase === 'freeSpins') {
      this.freeSpinTimer = out.win > 0 ? 1.8 : 0.9;
    } else if (this.wasFeature) {
      this.ctx.hud.toast(`Free spins paid ${money(this.featureTotal)}`, 'win');
    }
    this.wasFeature = this.game.phase === 'freeSpins';
    this.dirty = true;
    this.deck.redraw();
  }

  // ---------------------------------------------------------------------------
  // Screen
  // ---------------------------------------------------------------------------

  private setupScreen() {
    const s = this.screen;
    s.register(this.ctx.interaction);
    s.onSurface = (x, y) => {
      if (this.mode === 'pick') this.pickAt(x, y);
      else if (this.mode === 'info') this.toggleInfo();
      else if (this.mode !== 'spinning') this.onSpinPressed();
    };
  }

  private pickTiles() {
    const s = this.screen;
    const cols = 4,
      rows = 3;
    const gw = s.pxW * 0.8,
      gh = s.pxH * 0.62;
    const x0 = (s.pxW - gw) / 2,
      y0 = s.pxH * 0.2;
    const tw = gw / cols,
      th = gh / rows;
    return Array.from({ length: 12 }, (_, i) => ({ x: x0 + (i % cols) * tw + 8, y: y0 + Math.floor(i / cols) * th + 8, w: tw - 16, h: th - 16 }));
  }

  private pickAt(x: number, y: number) {
    const st = this.game.pickState;
    if (!st || st.picksLeft === 0) return;
    const i = this.pickTiles().findIndex((t) => x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h);
    if (i < 0 || st.revealed.includes(i)) return;
    const won = this.game.pick(i);
    this.onPick?.(won, st.picksLeft === 0, st.won);
    this.pickRevealAt.set(i, this.time);
    this.ctx.sound.play(won >= st.totalBet * 20 ? 'winBig' : 'winSmall', this.screen.mesh);
    this.dirty = true;
    this.deck.redraw();
    if (st.picksLeft === 0) {
      this.ctx.hud.toast(`Garden Pick paid ${money(st.won)}`, 'win');
      setTimeout(() => {
        this.game.closePick();
        this.pickRevealAt.clear();
        this.mode = 'idle';
        this.dirty = true;
        this.deck.redraw();
      }, 3200);
    }
  }

  private drawScreen() {
    const s = this.screen;
    const ctx = s.ctx;
    const [a, b] = this.theme.screenBg;
    const bg = ctx.createLinearGradient(0, 0, 0, s.pxH);
    bg.addColorStop(0, a);
    bg.addColorStop(1, b);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, s.pxW, s.pxH);

    if (this.mode === 'pick') return this.drawPick();
    if (this.mode === 'info') return this.drawInfo();

    const { x: ax, y: ay, w: aw, h: ah } = this.reelArea;
    const cell = this.cell;
    const classic = this.machine.type === 'classic';
    this.reels.forEach((r, i) => {
      const strip = this.machine.reels[i];
      const x = ax + i * cell;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 3, ay, cell - 6, ah);
      ctx.clip();
      const rg = ctx.createLinearGradient(0, ay, 0, ay + ah);
      const [c1, c2] = this.theme.reelBg;
      rg.addColorStop(0, c2);
      rg.addColorStop(0.5, c1);
      rg.addColorStop(1, c2);
      ctx.fillStyle = rg;
      ctx.fillRect(x, ay, cell, ah);
      const fast = !r.stopped && r.stopAt - this.time > 0.2 && this.time - r.start > 0.1;
      const src = fast ? this.blurAtlas : this.atlas.canvas;
      const base = Math.floor(r.pos);
      const f = r.pos - base;
      const midY = ay + ah / 2 - cell / 2;
      for (let j = -2; j <= 2; j++) {
        const idx = (((base + j) % strip.length) + strip.length) % strip.length;
        const sym = this.atlas.index.get(strip[idx])!;
        const y = midY + (j - f) * cell;
        ctx.drawImage(src, sym * cell, 0, cell, cell, x + 6, y + 6, cell - 12, cell - 12);
      }
      if (r.anticipation && !r.stopped) {
        ctx.strokeStyle = `rgba(255,220,120,${0.5 + 0.5 * Math.sin(this.time * 18)})`;
        ctx.lineWidth = 10;
        ctx.strokeRect(x + 6, ay + 4, cell - 12, ah - 8);
      }
      ctx.restore();
      if (classic) {
        // Curvature shading on the drum.
        const sh = ctx.createLinearGradient(0, ay, 0, ay + ah);
        sh.addColorStop(0, 'rgba(0,0,0,0.65)');
        sh.addColorStop(0.25, 'rgba(0,0,0,0)');
        sh.addColorStop(0.75, 'rgba(0,0,0,0)');
        sh.addColorStop(1, 'rgba(0,0,0,0.65)');
        ctx.fillStyle = sh;
        ctx.fillRect(x, ay, cell, ah);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - 3, ay, 6, ah);
    });
    if (classic) {
      ctx.strokeStyle = 'rgba(220,40,40,0.85)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(ax - 20, ay + ah / 2);
      ctx.lineTo(ax + aw + 20, ay + ah / 2);
      ctx.stroke();
    }

    // Win presentation: cycle through winning lines.
    const out = this.outcome;
    if (this.mode === 'showing' && out && out.lineWins.length > 0) {
      const k = Math.floor(this.winTimer / 1.3) % (out.lineWins.length + 1);
      const wins = k === 0 ? out.lineWins : [out.lineWins[k - 1]];
      const pulse = 0.6 + 0.4 * Math.sin(this.time * 8);
      for (const w of wins) {
        if (this.machine.type === 'video') {
          const rows = this.machine.lines[w.line];
          ctx.strokeStyle = `rgba(255,214,102,${0.8 * pulse})`;
          ctx.lineWidth = 6;
          ctx.beginPath();
          rows.forEach((row, reel) => {
            const px = ax + reel * cell + cell / 2,
              py = ay + row * cell + cell / 2;
            reel ? ctx.lineTo(px, py) : ctx.moveTo(px - cell / 2, py);
          });
          ctx.stroke();
        }
        for (const [reel, row] of w.cells) {
          ctx.strokeStyle = `rgba(255,236,160,${pulse})`;
          ctx.lineWidth = 7;
          ctx.shadowColor = '#ffd36b';
          ctx.shadowBlur = 20;
          roundRect(ctx, ax + reel * cell + 6, ay + row * cell + 6, cell - 12, cell - 12, 14);
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
      }
      if (k > 0) {
        const w = out.lineWins[k - 1];
        this.banner(`Line ${w.line + 1} · ${w.count} × ${symbolMap(this.machine).get(w.symbol)!.name} · ${money(w.amount)}`, s.pxH - 34, 30);
      }
    }

    // Top and bottom bands.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (this.game.phase === 'freeSpins' || (this.outcome?.triggered === 'freeSpins' && this.mode === 'showing')) {
      this.banner(`FREE SPINS · ${this.game.freeSpinsLeft} left · wins x2 · ${money(this.featureTotal)}`, 34, 32);
    } else if (this.machine.type === 'video') {
      ctx.fillStyle = 'rgba(255,240,200,0.75)';
      ctx.font = `28px ${SERIF}`;
      ctx.fillText(`${this.machine.lines.length} LINES  ·  RTP ${(this.machine.targetRtp * 100).toFixed(0)}%`, s.pxW / 2, 36);
    }
    if (this.shownWin > 0 && this.mode === 'showing') {
      const y = this.machine.type === 'video' ? s.pxH - 70 : s.pxH - 50;
      ctx.font = `bold 64px ${SERIF}`;
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#2a1206';
      ctx.strokeText(`WIN ${money(this.shownWin)}`, s.pxW / 2, y);
      ctx.fillStyle = '#ffd86b';
      ctx.shadowColor = '#ffb030';
      ctx.shadowBlur = 24;
      ctx.fillText(`WIN ${money(this.shownWin)}`, s.pxW / 2, y);
      ctx.shadowBlur = 0;
    } else if (this.mode === 'idle' || (this.mode === 'showing' && !this.shownWin)) {
      ctx.fillStyle = 'rgba(255,240,200,0.8)';
      ctx.font = `italic 30px ${SERIF}`;
      ctx.fillText(this.machine.type === 'classic' ? 'Pull the lever or press SPIN' : 'Press SPIN to play', s.pxW / 2, s.pxH - 40);
    }
  }

  private banner(text: string, y: number, size: number) {
    const ctx = this.screen.ctx;
    ctx.font = `600 ${size}px ${SERIF}`;
    const w = ctx.measureText(text).width + 50;
    roundRect(ctx, this.screen.pxW / 2 - w / 2, y - size * 0.85, w, size * 1.7, size * 0.6);
    ctx.fillStyle = 'rgba(20,10,4,0.85)';
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = GOLD_LIGHT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, this.screen.pxW / 2, y + 2);
  }

  private drawPick() {
    const s = this.screen;
    const ctx = s.ctx;
    const st = this.game.pickState;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = GOLD_LIGHT;
    ctx.font = `italic bold 54px ${SERIF}`;
    ctx.fillText('Garden Pick', s.pxW / 2, 60);
    ctx.font = `30px ${SERIF}`;
    ctx.fillStyle = '#f2e6c8';
    ctx.fillText(st ? (st.picksLeft > 0 ? `Pick ${st.picksLeft} more · won ${money(st.won)}` : `Total ${money(st.won)}`) : '', s.pxW / 2, 112);
    const keyIdx = this.atlas.index.get('KEY') ?? this.atlas.index.get('ORCHID')!;
    this.pickTiles().forEach((t, i) => {
      const revealed = st?.revealed.includes(i);
      const showAll = st && st.picksLeft === 0;
      roundRect(ctx, t.x, t.y, t.w, t.h, 18);
      const g = ctx.createLinearGradient(0, t.y, 0, t.y + t.h);
      g.addColorStop(0, revealed ? '#3a7a3a' : '#2a1a3a');
      g.addColorStop(1, revealed ? '#1a4a20' : '#120a1c');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = revealed ? '#ffe39a' : GOLD;
      ctx.lineWidth = revealed ? 6 : 3;
      ctx.stroke();
      if (revealed || showAll) {
        const age = revealed ? this.time - (this.pickRevealAt.get(i) ?? 0) : 1;
        const scale = Math.min(1, age * 4);
        ctx.save();
        ctx.translate(t.x + t.w / 2, t.y + t.h / 2);
        ctx.scale(scale, scale);
        ctx.globalAlpha = revealed ? 1 : 0.45;
        ctx.fillStyle = '#ffe8a0';
        ctx.font = `bold ${Math.round(t.h * 0.42)}px ${SERIF}`;
        ctx.fillText(`${st!.prizes[i]}x`, 0, -t.h * 0.08);
        ctx.font = `${Math.round(t.h * 0.16)}px ${SERIF}`;
        ctx.fillText(money(st!.prizes[i] * st!.totalBet), 0, t.h * 0.28);
        ctx.restore();
      } else {
        const sz = Math.min(t.w, t.h) * 0.8;
        ctx.drawImage(this.atlas.canvas, keyIdx * this.cell, 0, this.cell, this.cell, t.x + t.w / 2 - sz / 2, t.y + t.h / 2 - sz / 2, sz, sz);
      }
    });
  }

  private drawInfo() {
    const s = this.screen;
    const ctx = s.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = GOLD_LIGHT;
    ctx.font = `italic bold 44px ${SERIF}`;
    if (this.machine.type === 'video') ctx.fillText(`${this.machine.name} · Paytable`, s.pxW / 2, 44);
    ctx.font = `22px ${SERIF}`;
    ctx.fillStyle = '#e8dcc0';
    const m = this.machine;
    if (m.type === 'classic') {
      // Keep inside the reel window: the drum curves away above and below it.
      const { y: ay, h: ah } = this.reelArea;
      m.rules.forEach((r, i) => {
        const y = ay + 34 + i * ((ah - 50) / m.rules.length);
        ctx.textAlign = 'left';
        ctx.font = `30px ${SERIF}`;
        ctx.fillText(r.name, 90, y);
        ctx.textAlign = 'right';
        ctx.fillStyle = GOLD_LIGHT;
        ctx.fillText(`${r.pays}x bet`, s.pxW - 90, y);
        ctx.fillStyle = '#e8dcc0';
      });
      ctx.textAlign = 'center';
      ctx.font = `italic 24px ${SERIF}`;
      ctx.fillText(`Return to player ${(m.targetRtp * 100).toFixed(1)}%  ·  tap to close`, s.pxW / 2, ay + ah - 8);
      return;
    }
    const paying = m.symbols.filter((sym) => sym.pays);
    const colW = s.pxW / 2;
    paying.forEach((sym, i) => {
      const col = i % 2,
        row = Math.floor(i / 2);
      const x = col * colW + 40,
        y = 90 + row * 92;
      const idx = this.atlas.index.get(sym.id)!;
      ctx.drawImage(this.atlas.canvas, idx * this.cell, 0, this.cell, this.cell, x, y, 84, 84);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#e8dcc0';
      ctx.font = `24px ${SERIF}`;
      const pays = Object.entries(sym.pays!).reverse().map(([n, p]) => `${n}× ${p}`).join('   ');
      ctx.fillText(pays, x + 100, y + 42);
    });
    ctx.textAlign = 'center';
    ctx.font = `italic 22px ${SERIF}`;
    ctx.fillStyle = GOLD_LIGHT;
    const f = m.feature;
    const featureText =
      f.type === 'freeSpins'
        ? `3+ Fountains anywhere: ${f.spins} free spins, wins x${f.multiplier}. Scatter pays 3: ${m.scatterPays[3]}x 4: ${m.scatterPays[4]}x 5: ${m.scatterPays[5]}x total bet`
        : `Keys on reels 1, 3 and 5 open Garden Pick: choose 3 of 12 prizes (2x–100x bet)`;
    ctx.fillText(featureText, s.pxW / 2, s.pxH - 70);
    ctx.fillText(`Line pays are multiples of line bet (bet ÷ ${m.lines.length}). Wild substitutes. RTP ${(m.targetRtp * 100).toFixed(1)}%  ·  tap to close`, s.pxW / 2, s.pxH - 34);
  }

  // ---------------------------------------------------------------------------

  update(dt: number) {
    this.time += dt;
    this.tweens.update(dt);
    let anyMoving = false;
    if (this.mode === 'spinning') {
      let allStopped = true;
      this.reels.forEach((r) => {
        if (r.stopped) return;
        const total = r.stopAt - r.start;
        const k = Math.min(1, (this.time - r.start) / total);
        r.pos = r.from - reelEase(k) * r.distance - reelBounce(k);
        if (k >= 1) {
          r.stopped = true;
          const len = this.machine.reels[this.reels.indexOf(r)].length;
          r.pos = ((Math.round(r.from - r.distance) % len) + len) % len;
          this.ctx.sound.play('reelStop', this.screen.mesh, { volume: 0.7 });
        } else allStopped = false;
      });
      anyMoving = !allStopped;
      this.reelLoop.set(anyMoving ? 0.5 : 0, 1);
      if (allStopped) this.onAllStopped();
      this.dirty = true;
    }
    if (this.mode === 'showing') {
      this.winTimer += dt;
      if (this.outcome && this.outcome.lineWins.length) this.dirty = true;
      if (this.freeSpinTimer > 0) {
        this.freeSpinTimer -= dt;
        if (this.freeSpinTimer <= 0 && this.game.phase === 'freeSpins') this.startSpin();
      }
    }
    if (this.mode === 'pick') this.dirty = true;

    // Marquee bulbs chase; faster while spinning or winning.
    const rate = this.mode === 'spinning' ? 14 : this.mode === 'showing' && this.shownWin > 0 ? 20 : 4;
    const phase = Math.floor(this.time * rate);
    if (phase !== this.bulbColorDirty) {
      this.bulbColorDirty = phase;
      for (let i = 0; i < this.bulbs.count; i++) this.bulbs.setColorAt(i, (i + phase) % 3 === 0 ? this.bulbOff : this.bulbOn);
      this.bulbs.instanceColor!.needsUpdate = true;
    }
    this.sideStrips.emissiveIntensity = this.mode === 'showing' && this.shownWin > 0 ? 1.6 + Math.sin(this.time * 10) : 1.2 + Math.sin(this.time * 1.5) * 0.2;

    if (this.dirty) {
      this.dirty = false;
      this.drawScreen();
      this.screen.texture.needsUpdate = true;
    }
  }
}

/** Reel motion: quick spin-up, cruise, arrive at 90% of the time. */
function reelEase(k: number): number {
  const arrive = 0.9,
    accel = 0.08;
  const u = Math.min(1, Math.max(0, k / arrive));
  const v = u < accel ? (u * u) / (2 * accel) : u - accel / 2;
  return Math.min(1, v / (1 - accel / 2));
}

/** After arriving, the reel dips a fraction of a symbol past its stop and settles back. */
function reelBounce(k: number): number {
  return k > 0.9 && k < 1 ? Math.sin(((k - 0.9) / 0.1) * Math.PI) * 0.18 : 0;
}

function blurred(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d')!;
  // Vertical motion blur: stack offset copies.
  ctx.globalAlpha = 0.18;
  for (let i = -5; i <= 5; i++) ctx.drawImage(src, 0, i * (src.height / 26));
  ctx.globalAlpha = 1;
  return c;
}
