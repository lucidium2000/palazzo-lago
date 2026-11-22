import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { JACKPOTS, PIG_CAPACITY, PIGGY, PIGS, PiggyGame, type Coin, type PiggySpin, type RespinResult } from '../../rules/piggy';
import { windowAt } from '../../rules/slots';
import { assets } from '../assets';
import { easeOut, money, Tweens, type GameContext } from '../game';
import { bakeStatic, dynamic } from '../merge';
import { CanvasPanel, GOLD, GOLD_LIGHT, roundRect, SERIF } from '../panel';
import type { Viewpoint } from '../player';
import { radial, toTexture } from '../textures';
import { addCabinetDetails, GLOW } from './details';
import { coin as paintCoin, coinLabel, paintCoinLabel, piggyAtlas, pigFace } from './piggyArt';

/**
 * Porkbelly Payday: a premium cabinet with three 3D piggy banks standing on
 * top. Coins that land fly up into the banks; full banks glow and wait, then
 * smash open when Hold & Spin starts and add their power.
 */

type Mode = 'idle' | 'spinning' | 'showing' | 'intro' | 'respin' | 'bonusEnd' | 'info';

const CELL = 176;
const COLS = 5;
const ROWS = 3;
const REELS_X = (1000 - COLS * CELL) / 2;
const REELS_Y = 196;
const SCREEN = { w: 0.66, px: 1000, py: 1000, y: 1.45, z: 0.162, tilt: 0 };
const DECK_TILT = 0.3;
const PIG_COLORS = [0xd8202c, 0x23a04a, 0x2a5ad8];
const PIG_NAMES = ['Red Bank', 'Green Bank', 'Blue Bank'];
const PIG_POWERS = ['Coins ×2', '5 Respins', 'Jackpot Coin'];
const PIG_X = [-0.25, 0, 0.25];
const STAGE_Y = 2.08;
/** Coin values cycled on reels while they spin (looks alive, means nothing). */
const DISPLAY_VALUES = [1, 0.5, 2, 1.5, 5, 1, 3, 0.5, 10, 2, 1, 25];

interface ReelAnim {
  pos: number;
  from: number;
  distance: number;
  start: number;
  stopAt: number;
  stopped: boolean;
}

interface PigView {
  group: THREE.Group;
  mat: THREE.MeshPhysicalMaterial;
  scale: number;
  wobble: number;
  shown: number;
  hiddenUntil: number;
  /** The bank is smashed and rebuilding until this time. */
}

interface Flyer {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  vel?: THREE.Vector3;
  t: number;
  dur: number;
  done?: () => void;
}

export class PiggyMachineView {
  readonly group = new THREE.Group();
  readonly game: PiggyGame;
  readonly viewpoint: Viewpoint;
  readonly machine = { id: PIGGY.id, name: PIGGY.name };
  mode: Mode = 'idle';
  /** Base spin settled: (staked, line win, Hold & Spin started). */
  onResult: ((staked: number, won: number, feature?: 'holdSpin') => void) | null = null;
  /** Hold & Spin finished: total paid. */
  onBonusEnd: ((won: number, grand: boolean) => void) | null = null;

  private screen: CanvasPanel;
  private deck: CanvasPanel;
  private meters: CanvasPanel;
  private marquee: CanvasPanel;
  private atlas: { canvas: HTMLCanvasElement; index: Map<string, number> };
  private blurAtlas: HTMLCanvasElement;
  private coinFace: HTMLCanvasElement;
  private reels: ReelAnim[];
  private time = 0;
  private tweens = new Tweens();
  private reelLoop: ReturnType<GameContext['sound']['loop']>;
  private out: PiggySpin | null = null;
  private lastStake = 0;
  private pendingWin = 0;
  private shownWin = 0;
  private winTimer = 0;
  private dirty = true;
  private pigs: PigView[] = [];
  private flyers: Flyer[] = [];
  private coinPool: THREE.Mesh[] = [];
  private coinGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.004, 16).rotateX(Math.PI / 2);
  private coinMat = new THREE.MeshStandardMaterial({ color: 0xf0c040, metalness: 1, roughness: 0.25, emissive: 0x402800 });
  private bulbs: THREE.InstancedMesh;
  private bulbOn = new THREE.Color(0xfff0b0);
  private bulbOff = new THREE.Color(0x4a3518);
  private bulbPhase = -1;
  /** Bonus presentation. */
  private cellSpin: number[] = new Array(15).fill(0); // time each empty cell stops spinning (0 = still)
  private cellFlash: number[] = new Array(15).fill(-10);
  private banner: { text: string; until: number; color?: string } | null = null;
  private respinTimer = 0;
  private lastRespin: RespinResult | null = null;
  private bonusShownTotal = 0;
  private bonusCounted = false;
  private redApplied = false;

  constructor(
    private ctx: GameContext,
    position: THREE.Vector3,
    yaw: number,
  ) {
    this.game = new PiggyGame(ctx.bankroll);
    this.game.betIndex = 1;
    this.group.position.copy(position);
    this.group.rotation.y = yaw;
    ctx.scene.add(this.group);

    const ids = PIGGY.symbols.map((s) => s.id);
    this.atlas = piggyAtlas(ids, CELL);
    this.blurAtlas = blurred(this.atlas.canvas);
    this.coinFace = document.createElement('canvas');
    this.coinFace.width = this.coinFace.height = CELL;
    paintCoin(this.coinFace.getContext('2d')!, CELL);
    this.reels = PIGGY.reels.map((strip) => ({ pos: Math.floor(Math.random() * strip.length), from: 0, distance: 0, start: 0, stopAt: 0, stopped: true }));

    this.screen = new CanvasPanel(SCREEN.w, SCREEN.px, SCREEN.py, { transparent: false });
    this.deck = new CanvasPanel(0.7, 1240, 360);
    this.meters = new CanvasPanel(0.72, 1200, 190, { transparent: false });
    this.marquee = new CanvasPanel(0.76, 1240, 400, { transparent: false });
    this.bulbs = this.buildCabinet();
    this.buildPigs();
    this.setupScreen();
    this.setupDeck();
    this.drawMarquee();
    this.drawMeters();
    this.reelLoop = ctx.sound.loop('reelTick', this.screen.mesh);

    const vp = new THREE.Vector3(0, 0, 0.86).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(position);
    this.viewpoint = { id: PIGGY.id, label: PIGGY.name, position: vp, yaw, pitch: 0.06, eye: 1.6, back: 0.55, portrait: { back: 0.25, eye: 1.55, pitch: 0.08 } };
    ctx.bankroll.onChange(() => this.deck.redraw());
    bakeStatic(this.group, { shadows: ctx.quality.shadows });
  }

  // ---------------------------------------------------------------------------
  // Cabinet and banks
  // ---------------------------------------------------------------------------

  private buildCabinet(): THREE.InstancedMesh {
    const g = this.group;
    const q = this.ctx.quality;
    const lacquer = new THREE.MeshPhysicalMaterial({ color: 0x5a1830, roughness: 0.22, metalness: 0.15, clearcoat: q.name === 'desktop' ? 1 : 0, clearcoatRoughness: 0.08, envMapIntensity: 1.2 });
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
    // Lower body, plinth, deck shelf, tall upper body.
    add(new RoundedBoxGeometry(0.8, 0.82, 0.62, 3, 0.03), lacquer, 0, 0.41, 0);
    add(new THREE.BoxGeometry(0.82, 0.03, 0.64), gold, 0, 0.82, 0);
    add(new THREE.BoxGeometry(0.76, 0.06, 0.52), black, 0, 0.03, 0);
    add(new RoundedBoxGeometry(0.8, 0.05, 0.32, 2, 0.015), lacquer, 0, 0.88, 0.2, DECK_TILT);
    add(new RoundedBoxGeometry(0.8, 1.2, 0.44, 3, 0.03), lacquer, 0, 1.48, -0.07);
    // Gold bezel around the screen.
    const sw = SCREEN.w,
      sh = (SCREEN.w * SCREEN.py) / SCREEN.px;
    const bezel = new THREE.Shape();
    bezel.moveTo(-sw / 2 - 0.03, -sh / 2 - 0.03);
    bezel.lineTo(sw / 2 + 0.03, -sh / 2 - 0.03);
    bezel.lineTo(sw / 2 + 0.03, sh / 2 + 0.03);
    bezel.lineTo(-sw / 2 - 0.03, sh / 2 + 0.03);
    bezel.holes.push(new THREE.Path().moveTo(-sw / 2, -sh / 2).lineTo(sw / 2, -sh / 2).lineTo(sw / 2, sh / 2).lineTo(-sw / 2, sh / 2));
    const bz = add(new THREE.ExtrudeGeometry(bezel, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.004, bevelSegments: 2 }), gold, 0, SCREEN.y, SCREEN.z - 0.015);
    bz.rotation.x = SCREEN.tilt;
    this.screen.mesh.position.set(0, SCREEN.y, SCREEN.z);
    this.screen.mesh.rotation.x = SCREEN.tilt;
    g.add(this.screen.mesh);
    // Bank meters strip above the screen.
    this.meters.mesh.position.set(0, 1.94, 0.152);
    g.add(this.meters.mesh);
    // Deck.
    this.deck.mesh.rotation.x = -Math.PI / 2 + DECK_TILT;
    this.deck.mesh.position.set(0, 0.88, 0.2).add(new THREE.Vector3(0, Math.cos(DECK_TILT), Math.sin(DECK_TILT)).multiplyScalar(0.027));
    g.add(this.deck.mesh);

    // The stage the banks stand on: a gold-rimmed ledge with a little hay-bale trim.
    add(new RoundedBoxGeometry(0.84, 0.04, 0.46, 2, 0.012), gold, 0, STAGE_Y - 0.02, -0.04);
    const hay = new THREE.MeshStandardMaterial({ color: 0xc8a04a, roughness: 0.95 });
    for (const x of [-0.37, 0.37]) add(new RoundedBoxGeometry(0.07, 0.05, 0.1, 2, 0.01), hay, x, STAGE_Y + 0.025, 0.1);
    // Marquee behind the banks.
    add(new RoundedBoxGeometry(0.84, 0.36, 0.1, 3, 0.03), lacquer, 0, STAGE_Y + 0.33, -0.24);
    this.marquee.mesh.position.set(0, STAGE_Y + 0.33, -0.188);
    g.add(this.marquee.mesh);
    const mw = 0.76,
      mh = (0.76 * this.marquee.pxH) / this.marquee.pxW;
    const bulbCount = 48;
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: false }), bulbCount);
    const tmp = new THREE.Object3D();
    for (let i = 0; i < bulbCount; i++) {
      let d = (i / bulbCount) * 2 * (mw + mh);
      let x: number, y: number;
      if (d < mw) [x, y] = [-mw / 2 + d, mh / 2 + 0.01];
      else if ((d -= mw) < mh) [x, y] = [mw / 2 + 0.01, mh / 2 - d];
      else if ((d -= mh) < mw) [x, y] = [mw / 2 - d, -mh / 2 - 0.01];
      else [x, y] = [-mw / 2 - 0.01, -mh / 2 + (d - mw)];
      tmp.position.set(x, STAGE_Y + 0.33 + y, -0.186);
      tmp.updateMatrix();
      bulbs.setMatrixAt(i, tmp.matrix);
      bulbs.setColorAt(i, this.bulbOn);
    }
    g.add(dynamic(bulbs));

    addCabinetDetails(g, { topY: STAGE_Y + 0.51, topZ: -0.24, frontZ: 0.31, panelY: 0.64, halfW: 0.4, candle: GLOW.pink, dark: black });

    // Floor: contact shadow, coloured glow pool, stool.
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.4), new THREE.MeshBasicMaterial({ map: toTexture(radial(128, 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0)')), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, 0.011, 0.1);
    g.add(shadow);
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.9),
      new THREE.MeshBasicMaterial({ map: toTexture(radial(128, '#ff6ab0', 'rgba(0,0,0,0)')), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, 0.012, 0.6);
    g.add(pool);
    const leather = assets.material('leather', { repeat: 1, rough: 0.8, tint: 0x7a4040, fallback: () => new THREE.MeshStandardMaterial({ color: 0x3a1015, roughness: 0.5 }) });
    add(new THREE.CylinderGeometry(0.19, 0.17, 0.08, 24), leather, 0, 0.66, 0.82).castShadow = false;
    add(new THREE.CylinderGeometry(0.028, 0.028, 0.6, 10), gold, 0, 0.32, 0.82);
    add(new THREE.CylinderGeometry(0.19, 0.21, 0.03, 24), gold, 0, 0.015, 0.82);
    return bulbs;
  }

  private buildPigs() {
    const black = new THREE.MeshStandardMaterial({ color: 0x140808, roughness: 0.3 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xe0b860, metalness: 1, roughness: 0.2, envMapIntensity: 1.5 });
    const { body, dark, trim } = pigGeometry(0.08);
    PIG_COLORS.forEach((c, i) => {
      const mat = new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.18, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.4, emissive: c, emissiveIntensity: 0 });
      const pg = new THREE.Group();
      pg.add(new THREE.Mesh(body, mat), new THREE.Mesh(dark, black), new THREE.Mesh(trim, gold));
      pg.position.set(PIG_X[i], STAGE_Y, -0.02);
      pg.rotation.y = -PIG_X[i] * 0.9; // turned a little toward the player
      this.group.add(dynamic(pg));
      this.pigs.push({ group: pg, mat, scale: 0.8, wobble: 0, shown: 0, hiddenUntil: 0 });
    });
  }

  private pigFill(i: number): number {
    return Math.min(1, this.pigs[i].shown / PIG_CAPACITY[PIGS[i]]);
  }

  private drawMarquee() {
    const m = this.marquee;
    const ctx = m.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, m.pxH);
    g.addColorStop(0, '#3a0c22');
    g.addColorStop(0.5, '#a0285a');
    g.addColorStop(1, '#3a0c22');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, m.pxW, m.pxH);
    ctx.save();
    ctx.translate(m.pxW / 2, m.pxH * 0.7);
    for (let i = 0; i < 28; i++) {
      ctx.rotate((Math.PI * 2) / 28);
      ctx.fillStyle = i % 2 ? 'rgba(255,220,160,0.1)' : 'rgba(255,255,255,0.03)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(m.pxW, -70);
      ctx.lineTo(m.pxW, 70);
      ctx.fill();
    }
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `italic bold 120px ${SERIF}`;
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#3a0a1a';
    ctx.strokeText('Porkbelly Payday', m.pxW / 2, m.pxH * 0.4);
    const tg = ctx.createLinearGradient(0, m.pxH * 0.25, 0, m.pxH * 0.55);
    tg.addColorStop(0, '#fff5cf');
    tg.addColorStop(0.5, '#ffc0dc');
    tg.addColorStop(1, '#f08ab8');
    ctx.fillStyle = tg;
    ctx.shadowColor = '#ff80c0';
    ctx.shadowBlur = 30;
    ctx.fillText('Porkbelly Payday', m.pxW / 2, m.pxH * 0.4);
    ctx.shadowBlur = 0;
    ctx.font = `44px ${SERIF}`;
    ctx.fillStyle = '#ffeedd';
    ctx.fillText('Feed the banks · Hold & Spin for the Grand', m.pxW / 2, m.pxH * 0.78);
    m.texture.needsUpdate = true;
  }

  private drawMeters() {
    const m = this.meters;
    const ctx = m.ctx;
    ctx.fillStyle = '#1a0a10';
    ctx.fillRect(0, 0, m.pxW, m.pxH);
    const meters = this.game.metersFor();
    const w = m.pxW / 3;
    PIGS.forEach((p, i) => {
      const x = i * w;
      const fill = this.pigFill(i);
      const full = meters[i] >= PIG_CAPACITY[p] && this.pigs[i].shown >= PIG_CAPACITY[p];
      const col = '#' + new THREE.Color(PIG_COLORS[i]).getHexString();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold 40px ${SERIF}`;
      ctx.fillStyle = full ? '#fff2a0' : '#f6e2d0';
      ctx.fillText(full ? `${PIG_NAMES[i]} FULL!` : PIG_NAMES[i], x + w / 2, 38);
      ctx.font = `italic 30px ${SERIF}`;
      ctx.fillStyle = GOLD_LIGHT;
      ctx.fillText(PIG_POWERS[i], x + w / 2, 80);
      roundRect(ctx, x + 40, 112, w - 80, 46, 23);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.strokeStyle = full ? '#ffe070' : GOLD;
      ctx.lineWidth = 4;
      ctx.stroke();
      if (fill > 0) {
        roundRect(ctx, x + 44, 116, Math.max(38, (w - 88) * fill), 38, 19);
        const gr = ctx.createLinearGradient(0, 116, 0, 154);
        gr.addColorStop(0, '#ffffff');
        gr.addColorStop(0.3, col);
        gr.addColorStop(1, '#200008');
        ctx.fillStyle = gr;
        ctx.fill();
      }
      if (i > 0) {
        ctx.fillStyle = 'rgba(216,178,90,0.5)';
        ctx.fillRect(x - 2, 20, 4, m.pxH - 40);
      }
    });
    m.texture.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------
  // Deck
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
      ctx.fillText(`Bet ${money(this.bonusBet)}`, d.pxW - 40, 56);
    };
    const idle = () => this.canChangeBet;
    d.add({ id: 'info', x: 40, y: 120, w: 170, h: 200, label: 'Info', sub: 'rules', onPress: () => this.toggleInfo(), active: () => this.mode === 'info', enabled: () => this.mode === 'idle' || this.mode === 'showing' || this.mode === 'info' });
    d.add({ id: 'bet-', x: 230, y: 120, w: 150, h: 200, label: '–', sub: 'bet', onPress: () => this.changeBet(-1), enabled: idle });
    d.add({ id: 'bet+', x: 400, y: 120, w: 150, h: 200, label: '+', sub: 'bet', onPress: () => this.changeBet(1), enabled: idle });
    d.add({ id: 'max', x: 570, y: 120, w: 200, h: 200, label: 'Max', sub: 'bet', onPress: () => this.maxBet(), enabled: idle });
    d.add({ id: 'spin', x: 800, y: 110, w: 400, h: 220, label: () => this.spinLabel, sub: () => this.spinSub, active: () => this.spinEnabled, enabled: () => this.spinEnabled, onPress: () => this.onSpinPressed() });
    d.register(this.ctx.interaction);
    d.redraw();
  }

  get canChangeBet() {
    return (this.mode === 'idle' || this.mode === 'showing' || this.mode === 'info') && this.game.phase === 'idle';
  }
  get bonusBet() {
    return this.game.bonus?.totalBet ?? this.game.bet;
  }
  get spinLabel() {
    return this.mode === 'spinning' ? 'STOP' : this.mode === 'bonusEnd' ? 'COLLECT' : this.inBonus ? 'BONUS' : 'SPIN';
  }
  get spinSub() {
    if (this.mode === 'respin' || this.mode === 'intro') return `${this.game.bonus?.respinsLeft ?? 0} respins`;
    return '';
  }
  get spinEnabled() {
    return this.mode !== 'intro' && this.mode !== 'respin';
  }
  get inBonus() {
    return this.mode === 'intro' || this.mode === 'respin' || this.mode === 'bonusEnd';
  }

  changeBet(dir: 1 | -1) {
    if (!this.canChangeBet) return;
    this.game.changeBet(dir);
    this.ctx.sound.play('click', this.deck.mesh, { volume: 0.5 });
    // Bank meters are kept per bet level: show this level's banks.
    this.game.metersFor().forEach((v, i) => (this.pigs[i].shown = v));
    this.drawMeters();
    this.deck.redraw();
    this.dirty = true;
  }

  maxBet() {
    while (this.game.betIndex < PIGGY.betLevels.length - 1) this.changeBet(1);
  }

  toggleInfo() {
    if (this.mode !== 'idle' && this.mode !== 'showing' && this.mode !== 'info') return;
    this.mode = this.mode === 'info' ? 'idle' : 'info';
    this.dirty = true;
    this.deck.redraw();
  }

  onSpinPressed() {
    if (this.mode === 'spinning') return this.slamStop();
    if (this.mode === 'bonusEnd') return this.collect();
    if (this.mode === 'info') return this.toggleInfo();
    if (this.mode === 'idle' || this.mode === 'showing') this.startSpin();
  }

  // ---------------------------------------------------------------------------
  // Base game
  // ---------------------------------------------------------------------------

  private startSpin(forcedStops?: number[]) {
    if (!this.ctx.bankroll.canAfford(this.game.bet)) {
      this.ctx.hud.toast('Not enough credits — lower your bet', 'warn');
      this.ctx.sound.play('denied', this.deck.mesh);
      return;
    }
    this.lastStake = this.game.bet;
    const out = this.game.spin(this.ctx.rng, forcedStops);
    this.out = out;
    this.pendingWin = out.lineWin;
    this.ctx.hud.setPending(PIGGY.id, out.lineWin);
    // Banks animate up to the new meter as coins arrive; hold them for now.
    this.shownWin = 0;
    this.mode = 'spinning';
    let t = 0.7;
    let coins = 0;
    this.reels.forEach((r, i) => {
      const len = PIGGY.reels[i].length;
      const target = out.stops[i];
      // Anticipation: slow the last reels when 4+ coins are already showing.
      const tease = i >= 3 && coins >= 4;
      t += tease ? 1.1 : i === 0 ? 0 : 0.26;
      const delta = (((r.pos - target) % len) + len) % len;
      const laps = Math.max(1, Math.round((22 * t - delta) / len));
      Object.assign(r, { from: r.pos, distance: laps * len + delta, start: this.time, stopAt: this.time + t, stopped: false });
      coins += out.coins[i].filter(Boolean).length;
    });
    this.deck.redraw();
  }

  private slamStop() {
    for (const r of this.reels) {
      if (!r.stopped && r.stopAt - this.time > 0.15) {
        const k = Math.min(1, (this.time - r.start) / (r.stopAt - r.start));
        const done = reelEase(k) * r.distance;
        r.from -= done;
        r.distance -= done;
        r.start = this.time;
        r.stopAt = this.time + 0.15;
      }
    }
  }

  private onAllStopped() {
    const out = this.out!;
    this.reelLoop.stop();
    this.mode = 'showing';
    this.winTimer = 0;
    this.ctx.hud.setPending(PIGGY.id, 0);
    this.pendingWin = 0;
    this.onResult?.(this.lastStake, out.lineWin, out.triggered ? 'holdSpin' : undefined);
    if (out.lineWin > 0) {
      this.ctx.sound.play(out.lineWin >= this.lastStake * 15 ? 'winBig' : 'winSmall', this.screen.mesh);
      this.tweens.add(Math.min(2.2, 0.6 + out.lineWin / 200), (k) => {
        this.shownWin = Math.round(out.lineWin * k * 100) / 100;
        this.dirty = true;
      });
    }
    // Coins fly up into the banks.
    out.fed.forEach((f, n) => {
      this.after(0.12 * n, () => {
        this.ctx.sound.play('chip', this.screen.mesh, { volume: 0.5, rate: 1.2 + n * 0.05 });
        if (f.pig < 0) return;
        this.fly(this.cellWorld(f.reel * 3 + f.row), this.pigSlot(f.pig), 0.55, () => {
          const p = this.pigs[f.pig];
          p.shown = Math.min(PIG_CAPACITY[PIGS[f.pig]], p.shown + 1);
          p.wobble = 1;
          this.ctx.sound.play('chips', p.group, { volume: 0.35, rate: 1.4 });
          if (p.shown >= PIG_CAPACITY[PIGS[f.pig]]) {
            this.ctx.sound.play('bonus', p.group, { volume: 0.5 });
            this.ctx.hud.toast(`${PIG_NAMES[f.pig]} is full! ${PIG_POWERS[f.pig]} on the next Hold & Spin`, 'win');
          }
          this.drawMeters();
        });
      });
    });
    if (out.triggered) {
      const wait = 700 + 120 * out.fed.length;
      this.ctx.sound.play('bonus', this.screen.mesh);
      this.banner = { text: 'HOLD & SPIN!', until: this.time + 3, color: '#ffd86b' };
      this.after(wait / 1000, () => this.startIntro());
      this.mode = 'intro';
    }
    this.dirty = true;
    this.deck.redraw();
  }

  // ---------------------------------------------------------------------------
  // Hold & Spin
  // ---------------------------------------------------------------------------

  private startIntro() {
    const b = this.game.bonus!;
    this.cellSpin.fill(0);
    this.cellFlash.fill(-10);
    this.bonusShownTotal = 0;
    this.bonusCounted = false;
    this.redApplied = false;
    this.ctx.hud.toast('Hold & Spin! Coins lock, every new coin resets the respins', 'win');
    // Full banks smash, one after another.
    const smash = PIGS.map((p, i) => (b.powers[p] ? i : -1)).filter((i) => i >= 0);
    smash.forEach((i, n) => {
      this.after(0.9 + n * 1.1, () => {
        this.smashPig(i);
        this.banner = { text: `${PIG_NAMES[i].toUpperCase()} · ${PIG_POWERS[i].toUpperCase()}`, until: this.time + 1.6, color: '#' + new THREE.Color(PIG_COLORS[i]).getHexString() };
        if (PIGS[i] === 'blue' && b.blueCell !== null) {
          this.fly(this.pigSlot(i), this.cellWorld(b.blueCell), 0.7, () => {
            this.cellFlash[b.blueCell!] = this.time;
            this.ctx.sound.play('winSmall', this.screen.mesh);
          });
        }
        this.dirty = true;
      });
    });
    this.respinTimer = 2.2 + smash.length * 1.1;
    this.mode = 'respin';
    this.lastRespin = null;
    this.drawMeters();
    this.deck.redraw();
  }

  private smashPig(i: number) {
    const p = this.pigs[i];
    this.ctx.sound.play('winBig', p.group, { volume: 0.6 });
    this.ctx.sound.play('chips', p.group, { volume: 1 });
    // Bulge, then burst into coins, then a fresh empty bank pops back.
    const g = p.group;
    this.tweens.add(0.35, (k) => g.scale.setScalar(p.scale * (1 + k * 0.5)), () => {
      g.visible = false;
      const at = this.pigSlot(i);
      for (let n = 0; n < 16; n++) {
        const a = (n / 16) * Math.PI * 2;
        const v = new THREE.Vector3(Math.cos(a) * (0.4 + Math.random() * 0.4), 0.8 + Math.random() * 0.8, Math.sin(a) * 0.3 + 0.35);
        this.burst(at, v);
      }
    });
    p.shown = 0;
    p.hiddenUntil = this.time + 2.4;
    this.drawMeters();
  }

  private nextRespin() {
    const res = this.game.respin(this.ctx.rng);
    this.lastRespin = res;
    const b = this.game.bonus!;
    // Every still-empty cell (plus ones that just landed) spins; stagger the stops.
    let k = 0;
    b.board.forEach((c, cell) => {
      const landedHere = res.landed.some((l) => l.cell === cell);
      if (c && !landedHere) return;
      this.cellSpin[cell] = this.time + 0.45 + k * 0.05;
      k++;
    });
    const end = this.time + 0.5 + k * 0.05;
    for (const l of res.landed) {
      this.after(this.cellSpin[l.cell] - this.time, () => {
        this.cellFlash[l.cell] = this.time;
        this.ctx.sound.play(l.coin.jackpot ? 'winBig' : 'reelStop', this.screen.mesh, { volume: 0.8 });
        this.ctx.sound.play('chip', this.screen.mesh, { volume: 0.6 });
      });
    }
    this.respinTimer = end - this.time + (res.landed.length ? 0.7 : 0.45);
    if (res.done) this.respinTimer += 0.3;
    this.reelLoop.set(0.35, 1.3);
    this.deck.redraw();
  }

  private finishBonus() {
    const b = this.game.bonus!;
    this.mode = 'bonusEnd';
    this.reelLoop.set(0);
    this.ctx.hud.setPending(PIGGY.id, b.win);
    this.pendingWin = b.win;
    if (b.grand) {
      this.banner = { text: `GRAND JACKPOT ${money(JACKPOTS.GRAND * b.totalBet)}!`, until: this.time + 6, color: '#ffd86b' };
      this.ctx.sound.play('cheer', this.screen.mesh, { volume: 0.9 });
    }
    const count = () => {
      this.ctx.sound.play(b.win >= b.totalBet * 40 ? 'winBig' : 'winSmall', this.screen.mesh);
      this.tweens.add(Math.min(4, 1.2 + b.win / b.totalBet / 30), (k) => {
        this.bonusShownTotal = Math.round(b.win * easeOut(k) * 100) / 100;
        this.dirty = true;
      }, () => {
        this.bonusCounted = true;
        this.ctx.hud.setPending(PIGGY.id, 0);
        this.pendingWin = 0;
        this.deck.redraw();
        this.ctx.hud.toast(`Hold & Spin paid ${money(b.win)}`, 'win');
        this.onBonusEnd?.(b.win, b.grand);
        this.respinTimer = 6; // auto-collect
      });
    };
    if (b.powers.red) {
      this.banner = { text: 'RED BANK DOUBLES EVERY COIN!', until: this.time + 1.6, color: '#ff6060' };
      this.after(1.2, () => {
        this.redApplied = true;
        b.board.forEach((_c, i) => (this.cellFlash[i] = this.time));
        this.ctx.sound.play('bonus', this.screen.mesh);
        this.after(0.9, count);
      });
    } else count();
    this.deck.redraw();
  }

  private collect() {
    if (!this.bonusCounted) return;
    this.game.closeBonus();
    this.mode = 'idle';
    this.banner = null;
    this.dirty = true;
    this.drawMeters();
    this.deck.redraw();
  }

  /** Runs fn after `sec` of game time (stays in step with the frame loop). */
  private after(sec: number, fn: () => void) {
    this.tweens.add(Math.max(0.001, sec), () => {}, fn);
  }

  /** Test/demo hook: fill banks and land a Hold & Spin on the next spin. */
  debugBonus(fullBanks: boolean[] = [true, true, true]) {
    if (this.mode !== 'idle' && this.mode !== 'showing') return;
    fullBanks.forEach((f, i) => {
      if (f) {
        this.game.setMeter(i, PIG_CAPACITY[PIGS[i]]);
        this.pigs[i].shown = PIG_CAPACITY[PIGS[i]];
      }
    });
    this.drawMeters();
    for (let n = 0; n < 1e5; n++) {
      const stops = PIGGY.reels.map((s) => Math.floor(Math.random() * s.length));
      const c = PIGGY.reels.reduce((a, s, i) => a + windowAt(s, stops[i]).filter((x) => x === 'COIN').length, 0);
      if (c >= 6) return this.startSpin(stops);
    }
  }

  // ---------------------------------------------------------------------------
  // 3D coins
  // ---------------------------------------------------------------------------

  private coinMesh(): THREE.Mesh {
    const m = this.coinPool.pop() ?? new THREE.Mesh(this.coinGeo, this.coinMat);
    m.visible = true;
    this.group.add(m);
    return m;
  }

  private fly(from: THREE.Vector3, to: THREE.Vector3, dur: number, done?: () => void) {
    const mesh = this.coinMesh();
    mesh.position.copy(from);
    this.flyers.push({ mesh, from: from.clone(), to: to.clone(), t: 0, dur, done });
  }

  private burst(from: THREE.Vector3, vel: THREE.Vector3) {
    const mesh = this.coinMesh();
    mesh.position.copy(from);
    this.flyers.push({ mesh, from: from.clone(), to: from.clone(), vel, t: 0, dur: 2.2 });
  }

  /** A screen cell's centre in this group's local space. */
  private cellWorld(cell: number): THREE.Vector3 {
    const reel = Math.floor(cell / 3),
      row = cell % 3;
    const px = REELS_X + reel * CELL + CELL / 2,
      py = REELS_Y + row * CELL + CELL / 2;
    const h = (SCREEN.w * SCREEN.py) / SCREEN.px;
    const v = new THREE.Vector3((px / SCREEN.px - 0.5) * SCREEN.w, (0.5 - py / SCREEN.py) * h, 0.012);
    v.applyAxisAngle(new THREE.Vector3(1, 0, 0), SCREEN.tilt);
    return v.add(new THREE.Vector3(0, SCREEN.y, SCREEN.z));
  }

  private pigSlot(i: number): THREE.Vector3 {
    const p = this.pigs[i];
    return new THREE.Vector3(PIG_X[i], STAGE_Y + 0.17 * p.scale, -0.02);
  }

  // ---------------------------------------------------------------------------
  // Screen
  // ---------------------------------------------------------------------------

  private setupScreen() {
    this.screen.register(this.ctx.interaction);
    this.screen.onSurface = () => {
      if (this.mode === 'info') this.toggleInfo();
      else if (this.mode === 'bonusEnd') this.collect();
      else if (this.mode === 'idle' || this.mode === 'showing') this.onSpinPressed();
    };
  }

  private drawScreen() {
    const s = this.screen;
    const ctx = s.ctx;
    const bg = ctx.createLinearGradient(0, 0, 0, s.pxH);
    const bonus = this.inBonus && this.mode !== 'intro';
    bg.addColorStop(0, bonus ? '#3a0a28' : '#5a1838');
    bg.addColorStop(1, bonus ? '#0c0208' : '#1c0610');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, s.pxW, s.pxH);
    if (this.mode === 'info') return this.drawInfo();
    this.drawJackpots();
    if (bonus) this.drawBoard();
    else this.drawReels();
    this.drawBottom();
    if (this.banner && this.time < this.banner.until) {
      const k = Math.min(1, (this.banner.until - this.time) * 3);
      ctx.globalAlpha = k;
      ctx.font = `italic bold 72px ${SERIF}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const y = REELS_Y + (ROWS * CELL) / 2;
      const w = ctx.measureText(this.banner.text).width + 80;
      roundRect(ctx, s.pxW / 2 - w / 2, y - 70, w, 140, 40);
      ctx.fillStyle = 'rgba(20,4,12,0.85)';
      ctx.fill();
      ctx.strokeStyle = this.banner.color ?? GOLD;
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.lineWidth = 10;
      ctx.strokeStyle = '#2a0610';
      ctx.strokeText(this.banner.text, s.pxW / 2, y + 4);
      ctx.fillStyle = this.banner.color ?? '#ffd86b';
      ctx.shadowColor = ctx.fillStyle as string;
      ctx.shadowBlur = 24;
      ctx.fillText(this.banner.text, s.pxW / 2, y + 4);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }

  private drawJackpots() {
    const ctx = this.screen.ctx;
    const bet = this.bonusBet;
    const list: [string, number, string][] = [
      ['GRAND', JACKPOTS.GRAND, '#ffd040'],
      ['MAJOR', JACKPOTS.MAJOR, '#ff5a5a'],
      ['MINOR', JACKPOTS.MINOR, '#5aa0ff'],
      ['MINI', JACKPOTS.MINI, '#5ad080'],
    ];
    const w = 220,
      gap = 14,
      x0 = (1000 - (w * 4 + gap * 3)) / 2;
    list.forEach(([name, mult, col], i) => {
      const x = x0 + i * (w + gap);
      roundRect(ctx, x, 22, w, 140, 22);
      const g = ctx.createLinearGradient(0, 22, 0, 162);
      g.addColorStop(0, '#2a0a1a');
      g.addColorStop(1, '#0a0206');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold 40px ${SERIF}`;
      ctx.fillStyle = col;
      ctx.fillText(name, x + w / 2, 62);
      ctx.font = `bold 44px ${SERIF}`;
      ctx.fillStyle = '#fff6e0';
      ctx.fillText(money(mult * bet), x + w / 2, 118);
    });
  }

  private drawReels() {
    const ctx = this.screen.ctx;
    const ah = ROWS * CELL;
    const out = this.out;
    this.reels.forEach((r, i) => {
      const strip = PIGGY.reels[i];
      const x = REELS_X + i * CELL;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 3, REELS_Y, CELL - 6, ah);
      ctx.clip();
      const rg = ctx.createLinearGradient(0, REELS_Y, 0, REELS_Y + ah);
      rg.addColorStop(0, '#f3e6c8');
      rg.addColorStop(0.5, '#fffaf0');
      rg.addColorStop(1, '#e2d0a8');
      ctx.fillStyle = rg;
      ctx.fillRect(x, REELS_Y, CELL, ah);
      const fast = !r.stopped && r.stopAt - this.time > 0.2 && this.time - r.start > 0.1;
      const src = fast ? this.blurAtlas : this.atlas.canvas;
      const base = Math.floor(r.pos);
      const f = r.pos - base;
      const midY = REELS_Y + ah / 2 - CELL / 2;
      for (let j = -2; j <= 2; j++) {
        const idx = (((base + j) % strip.length) + strip.length) % strip.length;
        const id = strip[idx];
        const y = midY + (j - f) * CELL;
        ctx.drawImage(src, this.atlas.index.get(id)! * CELL, 0, CELL, CELL, x + 6, y + 6, CELL - 12, CELL - 12);
        if (id === 'COIN' && !fast) {
          const settled = r.stopped && out && Math.abs(j) <= 1 && f < 0.01;
          const c: Coin = settled ? out.coins[i][j + 1] ?? { mult: 1 } : { mult: DISPLAY_VALUES[idx % DISPLAY_VALUES.length] };
          paintCoinLabel(ctx, coinLabel(c, this.game.bet), x + CELL / 2, y + CELL / 2 + 4, CELL, !!c.jackpot);
        }
      }
      ctx.restore();
      ctx.fillStyle = 'rgba(40,6,20,0.8)';
      ctx.fillRect(x - 3, REELS_Y, 6, ah);
    });
    roundRect(ctx, REELS_X - 8, REELS_Y - 8, COLS * CELL + 16, ah + 16, 14);
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 6;
    ctx.stroke();

    if (this.mode === 'showing' && out && out.lineWins.length > 0) {
      const k = Math.floor(this.winTimer / 1.3) % (out.lineWins.length + 1);
      const wins = k === 0 ? out.lineWins : [out.lineWins[k - 1]];
      const pulse = 0.6 + 0.4 * Math.sin(this.time * 8);
      for (const w of wins) {
        ctx.strokeStyle = `rgba(255,214,102,${0.8 * pulse})`;
        ctx.lineWidth = 6;
        ctx.beginPath();
        PIGGY.lines[w.line].forEach((row, reel) => {
          const px = REELS_X + reel * CELL + CELL / 2,
            py = REELS_Y + row * CELL + CELL / 2;
          reel ? ctx.lineTo(px, py) : ctx.moveTo(px - CELL / 2, py);
        });
        ctx.stroke();
        for (const [reel, row] of w.cells) {
          ctx.strokeStyle = `rgba(255,236,160,${pulse})`;
          ctx.lineWidth = 7;
          roundRect(ctx, REELS_X + reel * CELL + 6, REELS_Y + row * CELL + 6, CELL - 12, CELL - 12, 14);
          ctx.stroke();
        }
      }
    }
  }

  private drawBoard() {
    const ctx = this.screen.ctx;
    const b = this.game.bonus;
    if (!b) return;
    for (let cell = 0; cell < 15; cell++) {
      const reel = Math.floor(cell / 3),
        row = cell % 3;
      const x = REELS_X + reel * CELL,
        y = REELS_Y + row * CELL;
      roundRect(ctx, x + 5, y + 5, CELL - 10, CELL - 10, 16);
      ctx.fillStyle = '#12040c';
      ctx.fill();
      ctx.strokeStyle = 'rgba(216,178,90,0.45)';
      ctx.lineWidth = 3;
      ctx.stroke();
      const spinning = this.cellSpin[cell] > this.time;
      const c = b.board[cell];
      if (spinning) {
        // A blurred flicker of coins and blanks.
        const k = (this.time * 14 + cell * 0.37) % 1;
        ctx.globalAlpha = 0.35;
        ctx.drawImage(this.coinFace, 0, 0, CELL, CELL, x + 14, y + 14 + (k - 0.5) * CELL * 0.6, CELL - 28, CELL - 28);
        ctx.globalAlpha = 1;
      } else if (c) {
        const flash = Math.max(0, 1 - (this.time - this.cellFlash[cell]) * 1.5);
        ctx.save();
        if (flash > 0) {
          ctx.shadowColor = c.jackpot ? '#ff60c0' : '#ffe060';
          ctx.shadowBlur = 50 * flash;
        }
        const grow = 1 + flash * 0.12;
        const sz = (CELL - 16) * grow;
        ctx.drawImage(this.coinFace, x + CELL / 2 - sz / 2, y + CELL / 2 - sz / 2, sz, sz);
        ctx.restore();
        paintCoinLabel(ctx, coinLabel(c, b.totalBet, this.redApplied), x + CELL / 2, y + CELL / 2 + 4, CELL, !!c.jackpot);
      } else {
        ctx.globalAlpha = 0.12;
        pigFace(ctx, x + CELL / 2, y + CELL / 2, CELL * 0.22, '#ff9ac0', '#ff9ac0');
        ctx.globalAlpha = 1;
      }
    }
    roundRect(ctx, REELS_X - 8, REELS_Y - 8, COLS * CELL + 16, ROWS * CELL + 16, 14);
    ctx.strokeStyle = '#ffd86b';
    ctx.lineWidth = 6;
    ctx.stroke();
  }

  private drawBottom() {
    const ctx = this.screen.ctx;
    const s = this.screen;
    const y = REELS_Y + ROWS * CELL + 60;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const b = this.game.bonus;
    if ((this.mode === 'respin' || this.mode === 'bonusEnd') && b) {
      // Respin lights.
      ctx.font = `bold 36px ${SERIF}`;
      ctx.fillStyle = GOLD_LIGHT;
      ctx.fillText('RESPINS', s.pxW / 2 - 200, y);
      for (let i = 0; i < b.maxRespins; i++) {
        ctx.beginPath();
        ctx.arc(s.pxW / 2 - 60 + i * 56, y, 20, 0, Math.PI * 2);
        const on = i < b.respinsLeft;
        ctx.fillStyle = on ? '#ffd86b' : '#3a2a20';
        ctx.shadowColor = '#ffb030';
        ctx.shadowBlur = on ? 18 : 0;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      const filled = b.board.filter(Boolean).length;
      ctx.font = `30px ${SERIF}`;
      ctx.fillStyle = 'rgba(255,240,220,0.8)';
      ctx.fillText(`${filled} / 15 · fill them all for the GRAND`, s.pxW / 2, y + 56);
      if (this.mode === 'bonusEnd') {
        ctx.font = `bold 84px ${SERIF}`;
        ctx.lineWidth = 10;
        ctx.strokeStyle = '#2a0610';
        const text = `WIN ${money(this.bonusShownTotal)}`;
        ctx.strokeText(text, s.pxW / 2, y + 150);
        ctx.fillStyle = '#ffd86b';
        ctx.shadowColor = '#ffb030';
        ctx.shadowBlur = 30;
        ctx.fillText(text, s.pxW / 2, y + 150);
        ctx.shadowBlur = 0;
        if (this.bonusCounted) {
          ctx.font = `italic 28px ${SERIF}`;
          ctx.fillStyle = 'rgba(255,240,220,0.8)';
          ctx.fillText('Tap to collect', s.pxW / 2, y + 215);
        }
      }
      return;
    }
    if (this.shownWin > 0 && this.mode === 'showing') {
      ctx.font = `bold 72px ${SERIF}`;
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#2a1206';
      ctx.strokeText(`WIN ${money(this.shownWin)}`, s.pxW / 2, y + 40);
      ctx.fillStyle = '#ffd86b';
      ctx.shadowColor = '#ffb030';
      ctx.shadowBlur = 24;
      ctx.fillText(`WIN ${money(this.shownWin)}`, s.pxW / 2, y + 40);
      ctx.shadowBlur = 0;
      const out = this.out;
      const k = out ? Math.floor(this.winTimer / 1.3) % (out.lineWins.length + 1) : 0;
      if (out && k > 0) {
        const w = out.lineWins[k - 1];
        ctx.font = `30px ${SERIF}`;
        ctx.fillStyle = GOLD_LIGHT;
        ctx.fillText(`Line ${w.line + 1} · ${w.count} × ${PIGGY.symbols.find((x) => x.id === w.symbol)!.name} · ${money(w.amount)}`, s.pxW / 2, y + 120);
      }
    } else {
      ctx.font = `italic 34px ${SERIF}`;
      ctx.fillStyle = 'rgba(255,236,220,0.85)';
      ctx.fillText(this.mode === 'spinning' ? 'Good luck!' : '6 coins anywhere start HOLD & SPIN', s.pxW / 2, y + 20);
      ctx.font = `28px ${SERIF}`;
      ctx.fillStyle = 'rgba(255,236,220,0.6)';
      ctx.fillText(`${PIGGY.lines.length} LINES  ·  MAX BET ${money(PIGGY.betLevels[PIGGY.betLevels.length - 1])}  ·  coins feed the banks above`, s.pxW / 2, y + 80);
    }
  }

  private drawInfo() {
    const ctx = this.screen.ctx;
    const s = this.screen;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = GOLD_LIGHT;
    ctx.font = `italic bold 60px ${SERIF}`;
    ctx.fillText('How to play', s.pxW / 2, 60);
    const lines = [
      ['Hold & Spin', '6 or more coins anywhere. Coins lock and you get 3 respins.'],
      ['', 'Any new coin resets the respins. Fill all 15 for the GRAND.'],
      ['Coins', 'Cash prizes, or MINI / MINOR jackpots (MAJOR in the bonus).'],
      ['Piggy banks', 'Every coin drops into a bank. A full bank smashes at the'],
      ['', 'next Hold & Spin. Banks are kept per bet level.'],
      ['Red Bank', 'every cash coin is doubled when the bonus ends'],
      ['Green Bank', '5 respins instead of 3'],
      ['Blue Bank', 'drops in a guaranteed jackpot coin'],
    ];
    ctx.textAlign = 'left';
    lines.forEach(([h, t], i) => {
      const y = 140 + i * 50;
      ctx.font = `bold 30px ${SERIF}`;
      ctx.fillStyle = i >= 5 ? '#' + new THREE.Color(PIG_COLORS[i - 5]).getHexString() : '#ffd86b';
      ctx.fillText(h, 60, y);
      ctx.font = `28px ${SERIF}`;
      ctx.fillStyle = '#f6e7d8';
      ctx.fillText(t, 250, y, 720);
    });
    // Paytable in line-bet multiples.
    const syms = PIGGY.symbols.filter((x) => x.pays);
    const cell = 70;
    syms.forEach((sym, i) => {
      const col = i % 2,
        row = Math.floor(i / 2);
      const x = 70 + col * 450,
        y = 560 + row * 76;
      ctx.drawImage(this.atlas.canvas, this.atlas.index.get(sym.id)! * CELL, 0, CELL, CELL, x, y, cell, cell);
      ctx.font = `26px ${SERIF}`;
      ctx.fillStyle = '#f6e7d8';
      const p = sym.pays!;
      ctx.fillText(`5: ${p[5]}  4: ${p[4]}  3: ${p[3]}`, x + 90, y + cell / 2);
    });
    ctx.textAlign = 'center';
    ctx.font = `italic 24px ${SERIF}`;
    ctx.fillStyle = GOLD_LIGHT;
    ctx.fillText('Line pays × line bet (bet ÷ 20), left to right. Wild pig on reels 2–4.  ·  tap to close', s.pxW / 2, s.pxH - 26);
  }

  // ---------------------------------------------------------------------------

  update(dt: number) {
    this.time += dt;
    this.tweens.update(dt);
    if (this.mode === 'spinning') {
      let all = true;
      this.reels.forEach((r, i) => {
        if (r.stopped) return;
        const k = Math.min(1, (this.time - r.start) / (r.stopAt - r.start));
        r.pos = r.from - reelEase(k) * r.distance - reelBounce(k);
        if (k >= 1) {
          r.stopped = true;
          const len = PIGGY.reels[i].length;
          r.pos = ((Math.round(r.from - r.distance) % len) + len) % len;
          const coins = this.out!.coins[i].filter(Boolean).length;
          this.ctx.sound.play(coins ? 'chip' : 'reelStop', this.screen.mesh, { volume: 0.7 });
        } else all = false;
      });
      this.reelLoop.set(all ? 0 : 0.5, 1);
      if (all) this.onAllStopped();
      this.dirty = true;
    }
    if (this.mode === 'showing') {
      this.winTimer += dt;
      if (this.out?.lineWins.length) this.dirty = true;
    }
    if (this.mode === 'respin') {
      this.dirty = true;
      this.respinTimer -= dt;
      if (this.respinTimer <= 0) {
        if (this.lastRespin?.done || this.game.bonus?.done) this.finishBonus();
        else this.nextRespin();
      }
    }
    if (this.mode === 'bonusEnd') {
      this.dirty = true;
      if (this.bonusCounted) {
        this.respinTimer -= dt;
        if (this.respinTimer <= 0) this.collect();
      }
    }
    if (this.banner && this.time < this.banner.until + 0.5) this.dirty = true;

    // Banks: size follows the meter, wobble when fed, bounce and glow when full.
    this.pigs.forEach((p, i) => {
      const g = p.group;
      if (!g.visible) {
        if (this.time >= p.hiddenUntil) {
          g.visible = true;
          p.scale = 0.01;
        } else return;
      }
      const fill = this.pigFill(i);
      const target = 0.8 + 0.4 * fill;
      p.scale += (target - p.scale) * Math.min(1, dt * 6);
      p.wobble = Math.max(0, p.wobble - dt * 2.2);
      const full = fill >= 1;
      g.scale.setScalar(p.scale);
      g.rotation.z = Math.sin(this.time * 22) * 0.18 * p.wobble;
      g.position.y = STAGE_Y + (full ? Math.abs(Math.sin(this.time * 4 + i)) * 0.02 : 0) + p.wobble * 0.01;
      p.mat.emissiveIntensity = full ? 0.35 + 0.25 * Math.sin(this.time * 6 + i) : 0;
    });

    // Flying coins.
    for (const f of [...this.flyers]) {
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      if (f.vel) {
        f.vel.y -= 3.2 * dt;
        f.mesh.position.addScaledVector(f.vel, dt);
        if (f.mesh.position.y < 0.01) {
          // Bounce and skid on the carpet.
          f.mesh.position.y = 0.01;
          f.vel.y = Math.abs(f.vel.y) * 0.3;
          f.vel.x *= 0.5;
          f.vel.z *= 0.5;
        }
        f.mesh.rotation.x += dt * 12;
      } else {
        f.mesh.position.lerpVectors(f.from, f.to, k);
        f.mesh.position.y += Math.sin(k * Math.PI) * 0.12;
        f.mesh.rotation.y += dt * 14;
      }
      if (k >= 1) {
        f.mesh.visible = false;
        f.mesh.removeFromParent();
        this.coinPool.push(f.mesh);
        this.flyers.splice(this.flyers.indexOf(f), 1);
        f.done?.();
      }
    }

    const rate = this.mode === 'spinning' ? 14 : this.inBonus ? 24 : this.shownWin > 0 && this.mode === 'showing' ? 20 : 4;
    const phase = Math.floor(this.time * rate);
    if (phase !== this.bulbPhase) {
      this.bulbPhase = phase;
      for (let i = 0; i < this.bulbs.count; i++) this.bulbs.setColorAt(i, (i + phase) % 3 === 0 ? this.bulbOff : this.bulbOn);
      this.bulbs.instanceColor!.needsUpdate = true;
    }

    if (this.dirty) {
      this.dirty = false;
      this.drawScreen();
      this.screen.texture.needsUpdate = true;
    }
  }
}

/** One piggy bank, origin between its feet, facing +z: body, dark details, gold trim. */
function pigGeometry(r: number) {
  const prep = (g: THREE.BufferGeometry, m: THREE.Matrix4) => {
    const n = g.index ? g.toNonIndexed() : g;
    n.applyMatrix4(m);
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
    return n;
  };
  const M = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  const legH = 0.035;
  const cy = legH + r * 0.85;
  const body: THREE.BufferGeometry[] = [
    prep(new THREE.SphereGeometry(r, 28, 20), M(0, cy, 0, 0, 0, 0, 1, 0.9, 1.22)),
    prep(new THREE.CylinderGeometry(r * 0.3, r * 0.34, r * 0.22, 20), M(0, cy - r * 0.05, r * 1.22, Math.PI / 2)),
  ];
  for (const s of [-1, 1]) {
    body.push(prep(new THREE.ConeGeometry(r * 0.24, r * 0.34, 12), M(s * r * 0.48, cy + r * 0.78, r * 0.55, 0.5, 0, -s * 0.35)));
    for (const z of [-1, 1]) body.push(prep(new THREE.CylinderGeometry(r * 0.17, r * 0.15, legH + r * 0.4, 12), M(s * r * 0.5, (legH + r * 0.4) / 2, z * r * 0.62)));
  }
  body.push(prep(new THREE.TorusGeometry(r * 0.12, r * 0.035, 8, 16, Math.PI * 1.6), M(0, cy + r * 0.1, -r * 1.2, 0, Math.PI / 2, 0)));
  const dark: THREE.BufferGeometry[] = [prep(new THREE.BoxGeometry(r * 0.55, r * 0.05, r * 0.1), M(0, cy + r * 0.9, -r * 0.1))];
  for (const s of [-1, 1]) {
    dark.push(prep(new THREE.SphereGeometry(r * 0.08, 10, 8), M(s * r * 0.33, cy + r * 0.32, r * 0.98)));
    dark.push(prep(new THREE.SphereGeometry(r * 0.06, 8, 6), M(s * r * 0.11, cy - r * 0.05, r * 1.34, 0, 0, 0, 1, 1.3, 0.5)));
  }
  const trim: THREE.BufferGeometry[] = [prep(new THREE.TorusGeometry(r * 0.72, r * 0.05, 8, 32), M(0, cy, r * 0.55, 0, 0, 0, 1, 0.9, 1))];
  for (const s of [-1, 1]) for (const z of [-1, 1]) trim.push(prep(new THREE.CylinderGeometry(r * 0.17, r * 0.18, r * 0.08, 12), M(s * r * 0.5, r * 0.04, z * r * 0.62)));
  return { body: mergeGeometries(body)!, dark: mergeGeometries(dark)!, trim: mergeGeometries(trim)! };
}

function reelEase(k: number): number {
  const arrive = 0.9,
    accel = 0.08;
  const u = Math.min(1, Math.max(0, k / arrive));
  const v = u < accel ? (u * u) / (2 * accel) : u - accel / 2;
  return Math.min(1, v / (1 - accel / 2));
}

function reelBounce(k: number): number {
  return k > 0.9 && k < 1 ? Math.sin(((k - 0.9) / 0.1) * Math.PI) * 0.18 : 0;
}

function blurred(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d')!;
  ctx.globalAlpha = 0.18;
  for (let i = -5; i <= 5; i++) ctx.drawImage(src, 0, i * (src.height / 26));
  ctx.globalAlpha = 1;
  return c;
}
