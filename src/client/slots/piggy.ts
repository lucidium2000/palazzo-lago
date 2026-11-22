import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BLUE_START,
  COLORS,
  JACKPOT_BASE,
  JACKPOT_GROWTH,
  JACKPOT_NAMES,
  JACKPOT_NEED,
  PIGGY,
  PiggyGame,
  RED_ORDER,
  type CoinColor,
  type Feature,
  type PiggySpin,
} from '../../rules/piggy';
import { assets } from '../assets';
import { easeOut, money, Tweens, type GameContext } from '../game';
import { bakeStatic, dynamic } from '../merge';
import { CanvasPanel, GOLD_LIGHT, roundRect } from '../panel';
import type { Viewpoint } from '../player';
import { radial, toTexture } from '../textures';
import { addCabinetDetails, GLOW } from './details';
import { COIN_COLORS, colorCoin, PIG_PALETTE, piggyAtlas, pigPortrait } from './piggyArt';

/**
 * Porkbelly Payday on a modern tall cabinet: a big portrait screen with the
 * three piggy banks across the top, 5x3 reels with the jackpot ladder beside
 * them, and a roll-up win meter. Mystery coins reveal one symbol; any of them
 * can flick a coloured coin up into its pig (which gulps and fattens) or set
 * off that pig's bonus. Large glossy 3D banks also stand on the cabinet top.
 */

type Mode = 'idle' | 'spinning' | 'reveal' | 'showing' | 'intro' | 'free' | 'bonusEnd' | 'info';

// Screen layout (canvas px).
const W = 800;
const H = 1120;
const CELL = 128;
const REELS_X = 14;
const REELS_Y = 374;
const LADDER_X = 670;
const PIG_Y = 158;
const PIG_R = 80;
const PIG_SX: Record<CoinColor, number> = { blue: 140, yellow: 400, red: 660 };
const SCREEN = { w: 0.7, y: 1.5, z: 0.072 };
const DISPLAY = '"Arial Black", "Helvetica Neue", Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const DECK_TILT = 0.3;
const PIG_COLORS: Record<CoinColor, number> = { blue: 0x2a5ae8, yellow: 0xf8b818, red: 0xe81c2c };
const PIG_X3: Record<CoinColor, number> = { blue: -0.27, yellow: 0, red: 0.27 };
const STAGE_Y = 2.12;
const JP_COLORS = JACKPOT_NAMES.map((n) => COIN_COLORS[n][1]);
const LOW_LABEL: Record<string, string> = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };
const hex = (c: number) => '#' + new THREE.Color(c).getHexString();

interface ReelAnim {
  pos: number;
  from: number;
  distance: number;
  start: number;
  stopAt: number;
  stopped: boolean;
}

interface Pig3D {
  group: THREE.Group;
  mat: THREE.MeshPhysicalMaterial;
  fat: number;
  wobble: number;
  party: number;
}

/** On-screen pig animation state. */
interface Pig2D {
  fat: number;
  squash: number;
  shake: number;
  glow: number;
}

interface Flick {
  color: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  dur: number;
  done: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  life: number;
  color: string;
}

interface Flyer3D {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  t: number;
}

export class PiggyMachineView {
  readonly group = new THREE.Group();
  readonly game: PiggyGame;
  readonly viewpoint: Viewpoint;
  readonly machine = { id: PIGGY.id, name: PIGGY.name };
  mode: Mode = 'idle';
  /** Paid spin settled: (staked, won, a bonus started). */
  onResult: ((staked: number, won: number, feature?: 'bonus') => void) | null = null;
  /** Bonus finished: total paid by its free spins and jackpots. */
  onBonusEnd: ((won: number, features: Feature[]) => void) | null = null;

  private screen: CanvasPanel;
  private deck: CanvasPanel;
  private marquee: CanvasPanel;
  private atlas: { canvas: HTMLCanvasElement; index: Map<string, number> };
  private blurAtlas: HTMLCanvasElement;
  private coinFaces = new Map<string, HTMLCanvasElement>();
  private bg: HTMLCanvasElement;
  private bgBonus: HTMLCanvasElement;
  private reels: ReelAnim[];
  private reelStrips: readonly (readonly string[])[] = PIGGY.reels;
  private time = 0;
  private tweens = new Tweens();
  private reelLoop: ReturnType<GameContext['sound']['loop']>;
  private out: PiggySpin | null = null;
  private lastStake = 0;
  private pendingWin = 0;
  private shownWin = 0;
  private winTimer = 0;
  private revealAt = 0;
  private dirty = true;
  private redrawClock = 0;
  private pig3: Record<CoinColor, Pig3D> = {} as Record<CoinColor, Pig3D>;
  private pig2: Record<CoinColor, Pig2D> = {
    blue: { fat: 0, squash: 0, shake: 0, glow: 0 },
    yellow: { fat: 0, squash: 0, shake: 0, glow: 0 },
    red: { fat: 0, squash: 0, shake: 0, glow: 0 },
  };
  /** Meter values as shown (they catch up as coins arrive). */
  private shown = { blue: BLUE_START, boost: 0, red: 0 };
  private flicks: Flick[] = [];
  private particles: Particle[] = [];
  private flyers: Flyer3D[] = [];
  private coinPool = new Map<string, THREE.Mesh[]>();
  private coinGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.004, 16).rotateX(Math.PI / 2);
  private coinMats = new Map<string, THREE.MeshStandardMaterial>();
  private bulbs: THREE.InstancedMesh;
  private bulbOn = new THREE.Color(0xfff0b0);
  private bulbOff = new THREE.Color(0x4a3518);
  private bulbPhase = -1;
  private led: THREE.MeshBasicMaterial;
  private banner: { text: string; sub?: string; at: number; until: number; color: string } | null = null;
  private freeTimer = 0;
  private bonusShownTotal = 0;
  private bonusCounted = false;
  private cellFlash: number[] = new Array(15).fill(-10);
  private jpFlash: number[] = new Array(6).fill(-10);
  private lastFeatures: Feature[] = [];
  private infoPage = 0;

  constructor(
    private ctx: GameContext,
    position: THREE.Vector3,
    yaw: number,
  ) {
    this.game = new PiggyGame(ctx.bankroll);
    // A machine as the last player left it: sometimes a fat pig worth playing.
    this.game.randomizeBanks(ctx.rng);
    this.group.position.copy(position);
    this.group.rotation.y = yaw;
    ctx.scene.add(this.group);

    const ids = PIGGY.symbols.map((s) => s.id);
    this.atlas = piggyAtlas(ids, CELL);
    this.blurAtlas = blurred(this.atlas.canvas);
    this.bg = background(false);
    this.bgBonus = background(true);
    this.reels = PIGGY.reels.map((strip) => ({ pos: Math.floor(Math.random() * strip.length), from: 0, distance: 0, start: 0, stopAt: 0, stopped: true }));

    this.screen = new CanvasPanel(SCREEN.w, W, H, { transparent: false });
    this.deck = new CanvasPanel(0.72, 1240, 360);
    this.marquee = new CanvasPanel(0.8, 1240, 360, { transparent: false });
    const { bulbs, led } = this.buildCabinet();
    this.bulbs = bulbs;
    this.led = led;
    this.buildPigs();
    this.syncShown(true);
    this.setupScreen();
    this.setupDeck();
    this.drawMarquee();
    this.reelLoop = ctx.sound.loop('reelTick', this.screen.mesh);

    const vp = new THREE.Vector3(0, 0, 0.9).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(position);
    this.viewpoint = { id: PIGGY.id, label: PIGGY.name, position: vp, yaw, pitch: 0.0, eye: 1.55, back: 0.62, portrait: { back: 0.5, eye: 1.5, pitch: 0.02 } };
    ctx.bankroll.onChange(() => this.deck.redraw());
    bakeStatic(this.group, { shadows: ctx.quality.shadows });
  }

  // ---------------------------------------------------------------------------
  // Cabinet and 3D banks
  // ---------------------------------------------------------------------------

  private buildCabinet() {
    const g = this.group;
    const q = this.ctx.quality;
    const body = new THREE.MeshPhysicalMaterial({ color: 0x141018, roughness: 0.25, metalness: 0.3, clearcoat: q.name === 'desktop' ? 1 : 0, clearcoatRoughness: 0.06, envMapIntensity: 1.1 });
    const accent = new THREE.MeshPhysicalMaterial({ color: 0x6a1840, roughness: 0.2, metalness: 0.4, clearcoat: q.name === 'desktop' ? 1 : 0, envMapIntensity: 1.2 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xe8e8f0, metalness: 1, roughness: 0.12, envMapIntensity: 1.6 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xe0b860, metalness: 1, roughness: 0.2, envMapIntensity: 1.5 });
    const black = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.35 });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      m.castShadow = q.shadows;
      g.add(m);
      return m;
    };
    // Base, deck, tall upper body with a slim chrome-framed screen.
    add(new RoundedBoxGeometry(0.82, 0.8, 0.64, 3, 0.03), body, 0, 0.4, 0.02);
    add(new THREE.BoxGeometry(0.84, 0.02, 0.66), chrome, 0, 0.805, 0.02);
    add(new THREE.BoxGeometry(0.78, 0.06, 0.54), black, 0, 0.03, 0.02);
    add(new RoundedBoxGeometry(0.82, 0.05, 0.32, 2, 0.015), body, 0, 0.86, 0.2, DECK_TILT);
    add(new RoundedBoxGeometry(0.84, 1.22, 0.3, 3, 0.04), body, 0, 1.5, -0.08);
    // Accent side fins.
    for (const sx of [-1, 1]) add(new RoundedBoxGeometry(0.035, 1.2, 0.26, 2, 0.012), accent, sx * 0.425, 1.5, -0.07);
    const sw = SCREEN.w,
      sh = (SCREEN.w * H) / W;
    const bezel = new THREE.Shape();
    const m = 0.014;
    bezel.moveTo(-sw / 2 - m, -sh / 2 - m);
    bezel.lineTo(sw / 2 + m, -sh / 2 - m);
    bezel.lineTo(sw / 2 + m, sh / 2 + m);
    bezel.lineTo(-sw / 2 - m, sh / 2 + m);
    bezel.holes.push(new THREE.Path().moveTo(-sw / 2, -sh / 2).lineTo(sw / 2, -sh / 2).lineTo(sw / 2, sh / 2).lineTo(-sw / 2, sh / 2));
    add(new THREE.ExtrudeGeometry(bezel, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 2 }), chrome, 0, SCREEN.y, SCREEN.z - 0.01);
    this.screen.mesh.position.set(0, SCREEN.y, SCREEN.z);
    g.add(this.screen.mesh);
    this.deck.mesh.rotation.x = -Math.PI / 2 + DECK_TILT;
    this.deck.mesh.position.set(0, 0.86, 0.2).add(new THREE.Vector3(0, Math.cos(DECK_TILT), Math.sin(DECK_TILT)).multiplyScalar(0.027));
    g.add(this.deck.mesh);

    // LED edge light around the cabinet face (colour animates).
    const led = new THREE.MeshBasicMaterial({ color: 0xff40a0, toneMapped: false });
    const ledGroup = new THREE.Group();
    for (const sx of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.008, 1.16, 0.008), led);
      strip.position.set(sx * 0.4, 1.5, 0.075);
      ledGroup.add(strip);
    }
    const topStrip = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.008, 0.008), led);
    topStrip.position.set(0, 2.1, 0.075);
    ledGroup.add(topStrip);
    const baseStrip = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.008, 0.008), led);
    baseStrip.position.set(0, 0.07, 0.345);
    ledGroup.add(baseStrip);
    g.add(dynamic(ledGroup));

    // Topper: chrome shelf for the banks, marquee sign behind with chasing bulbs.
    add(new RoundedBoxGeometry(0.88, 0.035, 0.44, 2, 0.012), chrome, 0, STAGE_Y - 0.015, -0.06);
    add(new RoundedBoxGeometry(0.86, 0.3, 0.08, 3, 0.03), body, 0, STAGE_Y + 0.36, -0.24);
    add(new THREE.BoxGeometry(0.88, 0.012, 0.09), gold, 0, STAGE_Y + 0.51, -0.24);
    this.marquee.mesh.position.set(0, STAGE_Y + 0.36, -0.198);
    g.add(this.marquee.mesh);
    const mw = 0.8,
      mh = (0.8 * this.marquee.pxH) / this.marquee.pxW;
    const bulbCount = 52;
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0075, 8, 6), new THREE.MeshBasicMaterial({ toneMapped: false }), bulbCount);
    const tmp = new THREE.Object3D();
    for (let i = 0; i < bulbCount; i++) {
      let d = (i / bulbCount) * 2 * (mw + mh);
      let x: number, y: number;
      if (d < mw) [x, y] = [-mw / 2 + d, mh / 2 + 0.008];
      else if ((d -= mw) < mh) [x, y] = [mw / 2 + 0.008, mh / 2 - d];
      else if ((d -= mh) < mw) [x, y] = [mw / 2 - d, -mh / 2 - 0.008];
      else [x, y] = [-mw / 2 - 0.008, -mh / 2 + (d - mw)];
      tmp.position.set(x, STAGE_Y + 0.36 + y, -0.196);
      tmp.updateMatrix();
      bulbs.setMatrixAt(i, tmp.matrix);
      bulbs.setColorAt(i, this.bulbOn);
    }
    g.add(dynamic(bulbs));

    addCabinetDetails(g, { topY: STAGE_Y + 0.51, topZ: -0.24, frontZ: 0.34, panelY: 0.62, halfW: 0.41, candle: GLOW.pink, dark: black });

    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.4), new THREE.MeshBasicMaterial({ map: toTexture(radial(128, 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0)')), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, 0.011, 0.1);
    g.add(shadow);
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.9),
      new THREE.MeshBasicMaterial({ map: toTexture(radial(128, '#ff4aa0', 'rgba(0,0,0,0)')), transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, 0.012, 0.62);
    g.add(pool);
    const leather = assets.material('leather', { repeat: 1, rough: 0.8, tint: 0x7a4040, fallback: () => new THREE.MeshStandardMaterial({ color: 0x3a1015, roughness: 0.5 }) });
    add(new THREE.CylinderGeometry(0.19, 0.17, 0.08, 24), leather, 0, 0.66, 0.86).castShadow = false;
    add(new THREE.CylinderGeometry(0.028, 0.028, 0.6, 10), chrome, 0, 0.32, 0.86);
    add(new THREE.CylinderGeometry(0.19, 0.21, 0.03, 24), chrome, 0, 0.015, 0.86);
    return { bulbs, led };
  }

  private buildPigs() {
    const black = new THREE.MeshStandardMaterial({ color: 0x140808, roughness: 0.3 });
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xe8c060, metalness: 1, roughness: 0.18, envMapIntensity: 1.6 });
    const geo = pigGeometry(0.1);
    for (const c of COLORS) {
      const col = PIG_COLORS[c];
      const mat = new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.12, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6, emissive: col, emissiveIntensity: 0 });
      const pg = new THREE.Group();
      pg.add(new THREE.Mesh(geo.body, mat), new THREE.Mesh(geo.dark, black), new THREE.Mesh(geo.trim, gold), new THREE.Mesh(geo.white, white));
      pg.position.set(PIG_X3[c], STAGE_Y, -0.02);
      pg.rotation.y = -PIG_X3[c] * 0.8;
      this.group.add(dynamic(pg));
      this.pig3[c] = { group: pg, mat, fat: 0, wobble: 0, party: 0 };
    }
  }

  /** How full each bank looks, 0..1. */
  private fullness(c: CoinColor): number {
    if (c === 'blue') return Math.min(1, (this.shown.blue - BLUE_START) / 40);
    if (c === 'yellow') return Math.min(1, this.shown.boost / 100);
    return this.shown.red / RED_ORDER.length;
  }

  private boostOf(jackpots: number[]): number {
    return Math.round(((jackpots[4] - JACKPOT_BASE[4]) / JACKPOT_BASE[4]) * 100);
  }

  private syncShown(snap = false) {
    const b = this.game.bankFor();
    this.shown = { blue: b.blue, boost: this.boostOf(b.jackpots), red: b.reds };
    if (snap) for (const c of COLORS) this.pig2[c].fat = this.pig3[c].fat = this.fullness(c);
    this.dirty = true;
  }

  private drawMarquee() {
    const m = this.marquee;
    const ctx = m.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, m.pxH);
    g.addColorStop(0, '#1a0418');
    g.addColorStop(0.5, '#6a0c48');
    g.addColorStop(1, '#1a0418');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, m.pxW, m.pxH);
    ctx.save();
    ctx.translate(m.pxW / 2, m.pxH * 0.62);
    for (let i = 0; i < 32; i++) {
      ctx.rotate((Math.PI * 2) / 32);
      ctx.fillStyle = i % 2 ? 'rgba(255,200,120,0.12)' : 'rgba(255,255,255,0.03)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(m.pxW, -60);
      ctx.lineTo(m.pxW, 60);
      ctx.fill();
    }
    ctx.restore();
    titleText(ctx, 'PORKBELLY', m.pxW / 2, m.pxH * 0.32, 118);
    titleText(ctx, 'PAYDAY', m.pxW / 2, m.pxH * 0.72, 128, true);
    m.texture.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------
  // Deck
  // ---------------------------------------------------------------------------

  private setupDeck() {
    const d = this.deck;
    d.background = (ctx) => {
      roundRect(ctx, 4, 4, d.pxW - 8, d.pxH - 8, 30);
      ctx.fillStyle = 'rgba(10,8,12,0.94)';
      ctx.fill();
      ctx.strokeStyle = '#c8c8d8';
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
  get inBonus() {
    return this.mode === 'intro' || this.mode === 'free' || this.mode === 'bonusEnd' || (this.game.phase === 'bonus' && (this.mode === 'spinning' || this.mode === 'reveal' || this.mode === 'showing'));
  }
  get spinLabel() {
    if (this.mode === 'spinning') return 'STOP';
    if (this.mode === 'bonusEnd') return 'COLLECT';
    return this.inBonus ? 'FREE' : 'SPIN';
  }
  get spinSub() {
    const b = this.game.bonus;
    return b && !b.done ? `${b.spinsLeft} left` : '';
  }
  get spinEnabled() {
    return this.mode === 'idle' || this.mode === 'showing' || this.mode === 'spinning' || this.mode === 'info' || (this.mode === 'bonusEnd' && this.bonusCounted);
  }

  changeBet(dir: 1 | -1) {
    if (!this.canChangeBet) return;
    this.game.changeBet(dir);
    this.afterBetChange();
  }

  maxBet() {
    if (!this.canChangeBet) return;
    this.game.betIndex = PIGGY.betLevels.length - 1;
    this.afterBetChange();
  }

  private afterBetChange() {
    this.ctx.sound.play('click', this.deck.mesh, { volume: 0.5 });
    // Banks are kept per bet level: show this level's banks.
    this.syncShown();
    this.deck.redraw();
  }

  toggleInfo() {
    if (this.mode !== 'idle' && this.mode !== 'showing' && this.mode !== 'info') return;
    this.mode = this.mode === 'info' ? 'idle' : 'info';
    this.infoPage = 0;
    this.dirty = true;
    this.deck.redraw();
  }

  onSpinPressed() {
    if (this.mode === 'spinning') return this.slamStop();
    if (this.mode === 'bonusEnd') return this.collect();
    if (this.mode === 'info') {
      if (this.infoPage < 1) {
        this.infoPage++;
        this.dirty = true;
        return;
      }
      return this.toggleInfo();
    }
    if ((this.mode === 'idle' || this.mode === 'showing') && this.game.phase === 'idle') this.startSpin();
  }

  // ---------------------------------------------------------------------------
  // Spins (paid and free)
  // ---------------------------------------------------------------------------

  private startSpin(forcedStops?: number[]) {
    const free = this.game.phase === 'bonus';
    if (!free && !this.ctx.bankroll.canAfford(this.game.bet)) {
      this.ctx.hud.toast('Not enough credits — lower your bet', 'warn');
      this.ctx.sound.play('denied', this.deck.mesh);
      return;
    }
    const strips = free && this.game.bonus ? this.game.bonus.reels : PIGGY.reels;
    this.lastStake = free ? 0 : this.game.bet;
    const out = this.game.spin(this.ctx.rng, forcedStops);
    this.out = out;
    this.pendingWin = out.win;
    this.ctx.hud.setPending(PIGGY.id, out.win);
    this.shownWin = 0;
    this.mode = 'spinning';
    let t = free ? 0.55 : 0.7;
    this.reels.forEach((r, i) => {
      const len = strips[i].length;
      r.pos = ((r.pos % len) + len) % len;
      const target = out.stops[i];
      t += i === 0 ? 0 : free ? 0.18 : 0.25;
      const delta = (((r.pos - target) % len) + len) % len;
      const laps = Math.max(1, Math.round((22 * t - delta) / len));
      Object.assign(r, { from: r.pos, distance: laps * len + delta, start: this.time, stopAt: this.time + t, stopped: false });
    });
    this.reelStrips = strips;
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

  /** Reels stopped: mystery coins flip to reveal their symbol a beat later. */
  private onAllStopped() {
    this.reelLoop.stop();
    const out = this.out!;
    if (out.mystery) {
      this.mode = 'reveal';
      this.revealAt = this.time + 0.6;
      this.ctx.sound.play('bonus', this.screen.mesh, { volume: 0.25, rate: 1.6 });
    } else this.afterReveal();
  }

  private afterReveal() {
    const out = this.out!;
    this.mode = 'showing';
    this.winTimer = 0;
    this.dirty = true;
    if (out.mystery) {
      this.ctx.sound.play('reelStop', this.screen.mesh, { volume: 0.8, rate: 1.3 });
      out.raw.forEach((col, r) => col.forEach((s, row) => s === 'MYSTERY' && (this.cellFlash[r * 3 + row] = this.time)));
    }
    if (out.lineWin > 0) {
      const bet = out.bet;
      const big = out.lineWin >= bet * 10;
      this.ctx.sound.play(big ? 'winBig' : 'winSmall', this.screen.mesh);
      if (big) this.shower(Math.min(120, 30 + out.lineWin / bet));
      this.tweens.add(Math.min(3, 0.6 + out.lineWin / bet / 8), (k) => {
        this.shownWin = Math.round(out.lineWin * k * 100) / 100;
      });
    }
    // Jackpot coins in the Yellow bonus.
    out.jackpotCoins.forEach((c, n) =>
      this.after(0.15 * n, () => {
        this.cellFlash[c.reel * 3 + c.row] = this.time;
        this.jpFlash[c.jackpot] = this.time;
        this.ctx.sound.play('chip', this.screen.mesh, { volume: 0.8, rate: 1 + c.jackpot * 0.1 });
      }),
    );
    for (const w of out.jackpotWins) {
      this.after(0.4 + 0.15 * out.jackpotCoins.length, () => {
        this.showBanner(`${JACKPOT_NAMES[w.jackpot]}!`, money(w.amount), JP_COLORS[w.jackpot], 2.6);
        this.jpFlash[w.jackpot] = this.time + 1.5;
        this.ctx.sound.play('winBig', this.screen.mesh);
        this.shower(40 + w.jackpot * 25, JACKPOT_NAMES[w.jackpot]);
        if (w.jackpot >= 3) this.ctx.sound.play('cheer', this.screen.mesh, { volume: 0.8 });
        this.ctx.hud.toast(`${JACKPOT_NAMES[w.jackpot]} jackpot · ${money(w.amount)}`, 'win');
      });
    }

    // Coins flick up into the pigs.
    out.coins.forEach((c, n) => {
      this.after(0.3 + 0.28 * n, () => {
        this.ctx.sound.play('chip', this.screen.mesh, { volume: 0.6, rate: 1.4 });
        const cx = REELS_X + c.reel * CELL + CELL / 2,
          cy = REELS_Y + c.row * CELL + CELL / 2;
        this.flicks.push({
          color: c.color,
          x0: cx,
          y0: cy,
          x1: PIG_SX[c.color],
          y1: PIG_Y - PIG_R * 0.7,
          t: 0,
          dur: 0.65,
          done: () => this.coinArrived(c.color, c.result, out),
        });
      });
    });

    const settle = 0.3 + 0.28 * out.coins.length + (out.coins.length ? 0.9 : 0.2);
    this.ctx.hud.setPending(PIGGY.id, 0);
    this.pendingWin = 0;
    if (!out.free) {
      this.onResult?.(this.lastStake, out.win, out.triggered ? 'bonus' : undefined);
      if (out.triggered) this.after(settle + 0.6, () => this.startIntro());
      else this.after(settle, () => this.syncShown());
    } else {
      const b = this.game.bonus!;
      this.freeTimer = (out.lineWin > 0 ? 1.4 : 0.75) + (out.jackpotWins.length ? 2.6 : 0) + 0.15 * out.jackpotCoins.length;
      this.mode = 'free';
      if (b.done) this.freeTimer += 0.4;
    }
    this.deck.redraw();
  }

  private coinArrived(c: CoinColor, result: 'trigger' | 'feed' | 'none', out: PiggySpin) {
    const p2 = this.pig2[c];
    const p3 = this.pig3[c];
    p2.squash = 1;
    this.ctx.sound.play('gulp', this.screen.mesh, { volume: 0.7 });
    if (result === 'feed') {
      if (c === 'blue') this.shown.blue = Math.min(out.bank.blue, this.shown.blue + 1);
      if (c === 'yellow') {
        const step = Math.round((JACKPOT_GROWTH[4] / JACKPOT_BASE[4]) * 100);
        this.shown.boost = Math.min(this.boostOf(out.bank.jackpots), this.shown.boost + step);
      }
      if (c === 'red') this.shown.red = Math.min(out.bank.reds, this.shown.red + 1);
      p3.wobble = 1;
    } else if (result === 'trigger') {
      p2.shake = 1.2;
      p3.party = 2;
      this.ctx.sound.play('bonus', this.screen.mesh, { volume: 0.8 });
      this.after(0.7, () => this.showBanner(`${c.toUpperCase()} PIG!`, 'BONUS', hex(PIG_COLORS[c]), 1.4));
    } else p3.wobble = 0.3;
    this.dirty = true;
  }

  private showBanner(text: string, sub: string | undefined, color: string, dur: number) {
    this.banner = { text, sub, at: this.time, until: this.time + dur, color };
  }

  /** Coin shower particles over the screen. */
  private shower(n: number, color = 'gold') {
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x: W / 2 + (Math.random() - 0.5) * 200,
        y: REELS_Y + CELL * 1.5,
        vx: (Math.random() - 0.5) * 900,
        vy: -500 - Math.random() * 700,
        spin: Math.random() * 6,
        life: 2.2 + Math.random(),
        color: Math.random() < 0.7 ? color : 'gold',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Bonus
  // ---------------------------------------------------------------------------

  private startIntro() {
    const b = this.game.bonus!;
    const feats = COLORS.filter((c) => b.features[c]);
    this.lastFeatures = feats;
    this.mode = 'intro';
    this.bonusShownTotal = 0;
    this.bonusCounted = false;
    const title = feats.map((f) => f.toUpperCase()).join(' + ');
    this.showBanner(title + '!', `${b.totalSpins} FREE SPINS`, feats.length > 1 ? '#ffd86b' : hex(PIG_COLORS[feats[0]]), 3.4);
    this.ctx.sound.play('banjo', this.screen.mesh, { volume: 0.9 });
    this.ctx.sound.play('bonus', this.screen.mesh, { volume: 0.6 });
    this.ctx.hud.toast(this.describe(feats, b.totalSpins), 'win');
    feats.forEach((c, n) => this.after(0.3 + n * 0.45, () => this.celebrate(c)));
    this.shower(40 * feats.length);
    this.after(3.6, () => {
      this.mode = 'free';
      this.freeTimer = 0.2;
      this.syncShown();
    });
    this.deck.redraw();
  }

  private describe(feats: Feature[], spins: number): string {
    const parts: string[] = [`${spins} free spins`];
    if (feats.includes('yellow')) parts.push('jackpot coins');
    if (feats.includes('red')) {
      const x = this.game.bonus!.removed.map((s) => LOW_LABEL[s]);
      parts.push(x.length ? `no ${x.join(', ')}` : 'Red reels');
    }
    return parts.join(' · ');
  }

  /** A bank going off: the 3D pig bounces, glows and throws its coins. */
  private celebrate(c: CoinColor) {
    const p3 = this.pig3[c];
    p3.party = 3;
    this.pig2[c].glow = 3;
    this.pig2[c].shake = 0.8;
    this.ctx.sound.play('chips', p3.group, { volume: 1 });
    const at = new THREE.Vector3(PIG_X3[c], STAGE_Y + 0.22, -0.02);
    for (let n = 0; n < 16; n++) {
      const a = (n / 16) * Math.PI * 2;
      const mesh = this.coinMesh(c);
      mesh.position.copy(at);
      this.flyers.push({ mesh, vel: new THREE.Vector3(Math.cos(a) * (0.3 + Math.random() * 0.4), 1 + Math.random() * 0.8, Math.sin(a) * 0.25 + 0.4), t: 0 });
    }
  }

  private finishBonus() {
    const b = this.game.bonus!;
    this.mode = 'bonusEnd';
    const big = b.won >= b.totalBet * 30;
    this.ctx.sound.play(big ? 'winBig' : 'winSmall', this.screen.mesh);
    if (big) this.ctx.sound.play('banjo', this.screen.mesh, { volume: 0.7 });
    this.shower(Math.min(160, 30 + b.won / b.totalBet));
    this.tweens.add(Math.min(4, 1.2 + b.won / b.totalBet / 30), (k) => {
      this.bonusShownTotal = Math.round(b.won * easeOut(k) * 100) / 100;
    }, () => {
      this.bonusCounted = true;
      this.ctx.hud.toast(`Bonus paid ${money(b.won)}`, 'win');
      this.onBonusEnd?.(b.won, this.lastFeatures);
      this.freeTimer = 6; // auto-collect
      this.deck.redraw();
    });
    this.deck.redraw();
  }

  private collect() {
    if (!this.bonusCounted) return;
    this.game.closeBonus();
    this.mode = 'idle';
    this.banner = null;
    this.syncShown();
    this.deck.redraw();
  }

  /** Runs fn after `sec` of game time (stays in step with the frame loop). */
  private after(sec: number, fn: () => void) {
    this.tweens.add(Math.max(0.001, sec), () => {}, fn);
  }

  /** Test/demo hook: set this bet level's banks and force a bonus with the given features. */
  debugBonus(features: Partial<Record<Feature, boolean>>, bank: { blue?: number; reds?: number } = {}) {
    if (this.mode !== 'idle' && this.mode !== 'showing') return;
    this.game.setBank(bank);
    this.syncShown(true);
    const g = this.game as unknown as { startBonus: (f: Record<Feature, boolean>, bet: number) => void };
    g.startBonus({ blue: false, yellow: false, red: false, ...features }, this.game.bet);
    this.out = null;
    this.startIntro();
  }

  // ---------------------------------------------------------------------------
  // 3D coins
  // ---------------------------------------------------------------------------

  private coinMesh(color: string): THREE.Mesh {
    let mat = this.coinMats.get(color);
    if (!mat) {
      const c = new THREE.Color(COIN_COLORS[color][1]);
      this.coinMats.set(color, (mat = new THREE.MeshStandardMaterial({ color: c, metalness: 0.9, roughness: 0.25, emissive: c, emissiveIntensity: 0.35 })));
    }
    const pool = this.coinPool.get(color) ?? [];
    this.coinPool.set(color, pool);
    const m = pool.pop() ?? new THREE.Mesh(this.coinGeo, mat);
    m.userData.color = color;
    m.visible = true;
    this.group.add(m);
    return m;
  }

  // ---------------------------------------------------------------------------
  // Screen
  // ---------------------------------------------------------------------------

  private setupScreen() {
    this.screen.register(this.ctx.interaction);
    this.screen.onSurface = () => {
      if (this.mode === 'info') this.onSpinPressed();
      else if (this.mode === 'bonusEnd') this.collect();
      else if ((this.mode === 'idle' || this.mode === 'showing') && this.game.phase === 'idle') this.onSpinPressed();
    };
  }

  private coinFace(color: string): HTMLCanvasElement {
    let c = this.coinFaces.get(color);
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = CELL;
      colorCoin(c.getContext('2d')!, CELL, color, JACKPOT_NAMES.includes(color as never) ? color : undefined);
      this.coinFaces.set(color, c);
    }
    return c;
  }

  private drawScreen() {
    const ctx = this.screen.ctx;
    ctx.drawImage(this.inBonus ? this.bgBonus : this.bg, 0, 0);
    if (this.mode === 'info') return this.drawInfo();
    this.drawPigs();
    this.drawReels();
    this.drawLadder();
    this.drawBottom();
    this.drawFlicks();
    this.drawParticles();
    this.drawBanner();
  }

  private drawPigs() {
    const ctx = this.screen.ctx;
    for (const c of COLORS) {
      const p = this.pig2[c];
      const x = PIG_SX[c] + (p.shake > 0 ? Math.sin(this.time * 60) * 6 * Math.min(1, p.shake) : 0);
      const inBonus = this.inBonus && !!this.game.bonus?.features[c];
      const glow = Math.max(p.glow > 0 ? 1 : 0, inBonus ? 0.6 + 0.4 * Math.sin(this.time * 6) : 0);
      // Spotlight under each pig.
      const sp = ctx.createRadialGradient(x, PIG_Y + 60, 5, x, PIG_Y + 60, 130);
      sp.addColorStop(0, hexA(PIG_PALETTE[c][1], 0.45 + glow * 0.3));
      sp.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sp;
      ctx.fillRect(x - 130, PIG_Y - 70, 260, 200);
      pigPortrait(ctx, x, PIG_Y, PIG_R, c, p.fat, Math.sin(p.squash * Math.PI * 3) * p.squash, glow);
      // Value plate.
      const py = 274;
      roundRect(ctx, x - 118, py, 236, 74, 20);
      const pg = ctx.createLinearGradient(0, py, 0, py + 74);
      pg.addColorStop(0, '#2a0a24');
      pg.addColorStop(1, '#0a0208');
      ctx.fillStyle = pg;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = PIG_PALETTE[c][1];
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (c === 'blue') {
        ctx.font = `900 46px ${DISPLAY}`;
        outlined(ctx, `${this.shown.blue}`, x - 44, py + 39, '#ffffff', '#0a1a60', 6);
        ctx.font = `900 20px ${DISPLAY}`;
        ctx.fillStyle = '#9ac0ff';
        ctx.fillText('FREE', x + 42, py + 26);
        ctx.fillText('SPINS', x + 42, py + 50);
      } else if (c === 'yellow') {
        ctx.font = `900 18px ${DISPLAY}`;
        ctx.fillStyle = '#ffe07a';
        ctx.fillText('JACKPOT BOOST', x, py + 20);
        ctx.font = `900 34px ${DISPLAY}`;
        outlined(ctx, `+${this.shown.boost}%`, x, py + 51, '#ffffff', '#5a3a00', 5);
      } else {
        RED_ORDER.forEach((s, i) => {
          const gx = x - 90 + i * 45;
          ctx.drawImage(this.atlas.canvas, this.atlas.index.get(s)! * CELL, 0, CELL, CELL, gx - 22, py + 14, 46, 46);
          if (i < this.shown.red) {
            ctx.strokeStyle = '#ff2a2a';
            ctx.lineWidth = 7;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(gx - 16, py + 20);
            ctx.lineTo(gx + 16, py + 54);
            ctx.moveTo(gx + 16, py + 20);
            ctx.lineTo(gx - 16, py + 54);
            ctx.stroke();
          }
        });
      }
    }
  }

  private drawReels() {
    const ctx = this.screen.ctx;
    const ah = 3 * CELL;
    const out = this.out;
    const revealed = out && this.mode !== 'spinning' && this.mode !== 'reveal';
    const strips = this.reelStrips;
    roundRect(ctx, REELS_X - 8, REELS_Y - 8, 5 * CELL + 16, ah + 16, 16);
    ctx.fillStyle = goldFrame(ctx, REELS_Y - 8, REELS_Y + ah + 8);
    ctx.fill();
    this.reels.forEach((r, i) => {
      const strip = strips[i];
      const x = REELS_X + i * CELL;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, REELS_Y, CELL, ah);
      ctx.clip();
      const rg = ctx.createLinearGradient(0, REELS_Y, 0, REELS_Y + ah);
      rg.addColorStop(0, '#1a0828');
      rg.addColorStop(0.5, '#3a1458');
      rg.addColorStop(1, '#1a0828');
      ctx.fillStyle = rg;
      ctx.fillRect(x, REELS_Y, CELL, ah);
      const fast = !r.stopped && r.stopAt - this.time > 0.2 && this.time - r.start > 0.1;
      const src = fast ? this.blurAtlas : this.atlas.canvas;
      const base = Math.floor(r.pos);
      const f = r.pos - base;
      const midY = REELS_Y + ah / 2 - CELL / 2;
      const settled = r.stopped && out && f < 0.01;
      for (let j = -2; j <= 2; j++) {
        const idx = (((base + j) % strip.length) + strip.length) % strip.length;
        let id = strip[idx];
        const y = midY + (j - f) * CELL;
        const row = j + 1;
        let flash = 0;
        let flipX = 1;
        if (settled && row >= 0 && row <= 2) {
          id = revealed ? out.grid[i][row] : out.raw[i][row];
          flash = Math.max(0, 1 - (this.time - this.cellFlash[i * 3 + row]) * 2);
          if (this.mode === 'reveal' && out.raw[i][row] === 'MYSTERY') {
            const k = 1 - (this.revealAt - this.time) / 0.6;
            flipX = k > 0.5 ? Math.max(0.05, Math.abs(Math.cos(((k - 0.5) / 0.5) * Math.PI * 0.5))) : 1;
          }
        }
        const grow = 1 + flash * 0.18;
        const sz = CELL * grow;
        if (flash > 0) {
          const hg = ctx.createRadialGradient(x + CELL / 2, y + CELL / 2, 5, x + CELL / 2, y + CELL / 2, CELL * 0.7);
          hg.addColorStop(0, `rgba(255,220,120,${0.6 * flash})`);
          hg.addColorStop(1, 'rgba(255,220,120,0)');
          ctx.fillStyle = hg;
          ctx.fillRect(x, y, CELL, CELL);
        }
        ctx.save();
        ctx.translate(x + CELL / 2, y + CELL / 2);
        ctx.scale(flipX, 1);
        ctx.drawImage(src, this.atlas.index.get(id)! * CELL, 0, CELL, CELL, -sz / 2, -sz / 2, sz, sz);
        ctx.restore();
      }
      const sh = ctx.createLinearGradient(0, REELS_Y, 0, REELS_Y + ah);
      sh.addColorStop(0, 'rgba(0,0,0,0.5)');
      sh.addColorStop(0.18, 'rgba(0,0,0,0)');
      sh.addColorStop(0.82, 'rgba(0,0,0,0)');
      sh.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = sh;
      ctx.fillRect(x, REELS_Y, CELL, ah);
      ctx.restore();
      if (i > 0) {
        ctx.fillStyle = 'rgba(255,215,120,0.35)';
        ctx.fillRect(x - 1, REELS_Y, 2, ah);
      }
    });
    if (out && revealed) {
      out.coins.forEach((c, n) => {
        if (this.time - this.cellFlash[c.reel * 3 + c.row] > 0.3 + 0.28 * n) return;
        ctx.drawImage(this.coinFace(c.color), REELS_X + c.reel * CELL + 22, REELS_Y + c.row * CELL + 22, CELL - 44, CELL - 44);
      });
      for (const c of out.jackpotCoins) {
        if (this.time < this.cellFlash[c.reel * 3 + c.row]) continue;
        ctx.drawImage(this.coinFace(JACKPOT_NAMES[c.jackpot]), REELS_X + c.reel * CELL + 6, REELS_Y + c.row * CELL + 6, CELL - 12, CELL - 12);
      }
    }

    if ((this.mode === 'showing' || this.mode === 'free') && out && out.lineWins.length > 0) {
      const k = Math.floor(this.winTimer / 1.3) % (out.lineWins.length + 1);
      const wins = k === 0 ? out.lineWins : [out.lineWins[k - 1]];
      const pulse = 0.6 + 0.4 * Math.sin(this.time * 8);
      for (const w of wins) {
        ctx.strokeStyle = `rgba(255,224,120,${0.85 * pulse})`;
        ctx.lineWidth = 5;
        ctx.shadowColor = '#ffcc40';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        PIGGY.lines[w.line].forEach((row, reel) => {
          const px = REELS_X + reel * CELL + CELL / 2,
            py = REELS_Y + row * CELL + CELL / 2;
          reel ? ctx.lineTo(px, py) : ctx.moveTo(px - CELL / 2, py);
        });
        ctx.stroke();
        for (const [reel, row] of w.cells) {
          ctx.lineWidth = 6;
          roundRect(ctx, REELS_X + reel * CELL + 4, REELS_Y + row * CELL + 4, CELL - 8, CELL - 8, 12);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
      }
    }
  }

  /** The six jackpots beside the reels, Mega on top. */
  private drawLadder() {
    const ctx = this.screen.ctx;
    const bet = this.bonusBet;
    const jp = this.game.bankFor().jackpots;
    const b = this.game.bonus;
    const yellow = !!b?.features.yellow && this.inBonus;
    const h = 58,
      gap = 7.5,
      w = W - LADDER_X - 10;
    for (let k = 0; k < 6; k++) {
      const j = 5 - k;
      const y = REELS_Y - 6 + k * (h + gap);
      const flash = Math.max(0, 1 - Math.abs(this.time - this.jpFlash[j]) * 1.2);
      roundRect(ctx, LADDER_X, y, w, h, 12);
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, shadeHex(JP_COLORS[j], 0.55 + flash * 0.4));
      g.addColorStop(1, shadeHex(JP_COLORS[j], 0.18));
      ctx.fillStyle = g;
      if (flash > 0) {
        ctx.shadowColor = JP_COLORS[j];
        ctx.shadowBlur = 30 * flash;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 3;
      ctx.strokeStyle = COIN_COLORS[JACKPOT_NAMES[j]][0];
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 15px ${DISPLAY}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(JACKPOT_NAMES[j], LADDER_X + w / 2, y + 14);
      ctx.font = `900 ${j >= 4 ? 19 : 21}px ${DISPLAY}`;
      outlined(ctx, money(Math.round(jp[j] * bet * 100) / 100), LADDER_X + w / 2, y + 36, '#fff8d8', '#1a0410', 4, w - 10);
      if (yellow) {
        const need = JACKPOT_NEED[j];
        for (let i = 0; i < need; i++) {
          const cx = LADDER_X + w / 2 + (i - (need - 1) / 2) * 14;
          ctx.beginPath();
          ctx.arc(cx, y + h - 4, 5, 0, Math.PI * 2);
          ctx.fillStyle = i < b!.counts[j] ? '#ffffff' : 'rgba(0,0,0,0.6)';
          ctx.fill();
        }
      }
    }
  }

  private drawBottom() {
    const ctx = this.screen.ctx;
    const b = this.game.bonus;
    const y0 = REELS_Y + 3 * CELL + 26;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    roundRect(ctx, 40, y0, W - 80, 108, 24);
    const mg = ctx.createLinearGradient(0, y0, 0, y0 + 108);
    mg.addColorStop(0, '#2a0a24');
    mg.addColorStop(1, '#060104');
    ctx.fillStyle = mg;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = goldFrame(ctx, y0, y0 + 108);
    ctx.stroke();
    const inBonus = !!b && this.inBonus;
    const value = inBonus ? (this.mode === 'bonusEnd' ? this.bonusShownTotal : b!.won) : this.shownWin;
    ctx.font = `900 22px ${DISPLAY}`;
    ctx.fillStyle = GOLD_LIGHT;
    ctx.fillText(inBonus ? 'BONUS WIN' : 'WIN', W / 2, y0 + 22);
    ctx.font = `900 ${this.mode === 'bonusEnd' ? 64 : 58}px ${DISPLAY}`;
    const winText = value > 0 ? money(value) : this.mode === 'spinning' ? 'GOOD LUCK!' : inBonus ? '$0' : 'PLAY NOW';
    outlined(ctx, winText, W / 2, y0 + 68, value > 0 ? '#ffd86b' : 'rgba(255,240,220,0.55)', '#2a0610', 8, W - 120, value > 0 ? '#ffb030' : undefined);

    const ym = y0 + 160;
    if (inBonus) {
      const feats = COLORS.filter((c) => b!.features[c]);
      const cw = 220;
      feats.forEach((c, i) => {
        const x = W / 2 + (i - (feats.length - 1) / 2) * (cw + 12) - cw / 2;
        roundRect(ctx, x, ym - 24, cw, 48, 24);
        const cg = ctx.createLinearGradient(0, ym - 24, 0, ym + 24);
        cg.addColorStop(0, PIG_PALETTE[c][0]);
        cg.addColorStop(0.4, PIG_PALETTE[c][1]);
        cg.addColorStop(1, PIG_PALETTE[c][2]);
        ctx.fillStyle = cg;
        ctx.fill();
        ctx.font = `900 19px ${DISPLAY}`;
        const label = c === 'blue' ? 'BLUE · SPINS' : c === 'yellow' ? 'YELLOW · JACKPOTS' : b!.removed.length ? `RED · NO ${b!.removed.map((x) => LOW_LABEL[x]).join(' ')}` : 'RED REELS';
        outlined(ctx, label, x + cw / 2, ym + 1, '#ffffff', '#000', 4, cw - 16);
      });
      const done = b!.totalSpins - b!.spinsLeft;
      ctx.font = `900 34px ${DISPLAY}`;
      const spinText = this.mode === 'intro' ? `${b!.totalSpins} FREE SPINS` : this.mode === 'bonusEnd' ? (this.bonusCounted ? 'TAP TO COLLECT' : 'BONUS COMPLETE') : `FREE SPIN ${Math.min(b!.totalSpins, Math.max(1, done))} OF ${b!.totalSpins}`;
      outlined(ctx, spinText, W / 2, ym + 60, '#ffffff', '#2a0610', 6);
    } else {
      const out = this.out;
      const k = out && this.mode === 'showing' ? Math.floor(this.winTimer / 1.3) % (out.lineWins.length + 1) : 0;
      ctx.font = `600 26px ${SERIF}`;
      ctx.fillStyle = GOLD_LIGHT;
      if (out && k > 0) {
        const w = out.lineWins[k - 1];
        ctx.fillText(`Line ${w.line + 1} · ${w.count} × ${PIGGY.symbols.find((x) => x.id === w.symbol)!.name} · ${money(w.amount)}`, W / 2, ym, W - 60);
      } else if (out?.mystery && this.mode === 'showing') {
        ctx.fillText(`Mystery coins revealed ${PIGGY.symbols.find((x) => x.id === out.mystery)!.name}`, W / 2, ym, W - 60);
      } else {
        ctx.fillText('Mystery coins turn into one symbol · coins feed the pigs', W / 2, ym, W - 60);
      }
      ctx.font = `italic 22px ${SERIF}`;
      ctx.fillStyle = 'rgba(255,236,220,0.65)';
      ctx.fillText('Blue banks free spins · Yellow grows jackpots · Red crosses out royals', W / 2, ym + 40, W - 60);
    }

    const yf = H - 64;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, yf, W, 64);
    ctx.fillStyle = goldFrame(ctx, yf, yf + 3);
    ctx.fillRect(0, yf, W, 3);
    const col = (label: string, v: string, x: number) => {
      ctx.font = `900 15px ${DISPLAY}`;
      ctx.fillStyle = '#ffd86b';
      ctx.fillText(label, x, yf + 20);
      ctx.font = `900 24px ${DISPLAY}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(v, x, yf + 45);
    };
    col('CREDIT', money(Math.round((this.ctx.bankroll.balance - this.pendingWin) * 100) / 100), 150);
    col('BET', money(this.bonusBet), W / 2);
    col('LINES', `${PIGGY.lines.length}`, W - 150);
  }

  private drawFlicks() {
    const ctx = this.screen.ctx;
    for (const f of this.flicks) {
      const k = Math.min(1, f.t / f.dur);
      const e = easeOut(k);
      const x = f.x0 + (f.x1 - f.x0) * e;
      const y = f.y0 + (f.y1 - f.y0) * k - Math.sin(k * Math.PI) * 140;
      const s = 70 * (1 - k * 0.4);
      ctx.globalAlpha = 0.35;
      ctx.drawImage(this.coinFace(f.color), x - s / 2 - (f.x1 - f.x0) * 0.03, y - s / 2 + 18, s * 0.8, s * 0.8);
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(Math.abs(Math.cos(f.t * 14)) * 0.7 + 0.3, 1);
      ctx.drawImage(this.coinFace(f.color), -s / 2, -s / 2, s, s);
      ctx.restore();
    }
  }

  private drawParticles() {
    const ctx = this.screen.ctx;
    for (const p of this.particles) {
      const s = 34;
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life);
      ctx.translate(p.x, p.y);
      ctx.scale(Math.cos(p.spin), 1);
      ctx.drawImage(this.coinFace(p.color), -s / 2, -s / 2, s, s);
      ctx.restore();
    }
  }

  private drawBanner() {
    const ctx = this.screen.ctx;
    const b = this.banner;
    if (!b || this.time > b.until) return;
    const age = this.time - b.at;
    const pop = age < 0.25 ? easeOut(age / 0.25) * 1.15 : age < 0.4 ? 1.15 - ((age - 0.25) / 0.15) * 0.15 : 1;
    const fade = Math.min(1, (b.until - this.time) * 3);
    const cy = REELS_Y + 1.5 * CELL;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(W / 2, cy);
    ctx.scale(pop, pop);
    ctx.save();
    ctx.rotate(this.time * 0.6);
    for (let i = 0; i < 18; i++) {
      ctx.rotate((Math.PI * 2) / 18);
      ctx.fillStyle = hexA(b.color, 0.25);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(420, -40);
      ctx.lineTo(420, 40);
      ctx.fill();
    }
    ctx.restore();
    const bh = b.sub ? 190 : 130;
    roundRect(ctx, -360, -95, 720, bh, 40);
    const g = ctx.createLinearGradient(0, -95, 0, 95);
    g.addColorStop(0, 'rgba(40,6,30,0.95)');
    g.addColorStop(1, 'rgba(8,0,6,0.95)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = b.color;
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 30;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 76px ${DISPLAY}`;
    outlined(ctx, b.text, 0, b.sub ? -26 : -30, b.color, '#1a0410', 10, 680, b.color);
    if (b.sub) {
      ctx.font = `900 48px ${DISPLAY}`;
      outlined(ctx, b.sub, 0, 50, '#ffffff', '#1a0410', 8, 680);
    }
    ctx.restore();
  }

  private drawInfo() {
    const ctx = this.screen.ctx;
    ctx.fillStyle = 'rgba(10,2,8,0.75)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 46px ${DISPLAY}`;
    outlined(ctx, this.infoPage === 0 ? 'THE PIGGY BANKS' : 'PAYS', W / 2, 54, '#ffd86b', '#2a0610', 7);
    ctx.textAlign = 'left';
    const para = (y: number, color: string, head: string, lines: string[], pig?: CoinColor) => {
      let x = 40;
      if (pig) {
        pigPortrait(ctx, 78, y + 52, 46, pig, 0.3);
        x = 148;
      }
      ctx.textAlign = 'left';
      ctx.font = `900 32px ${DISPLAY}`;
      ctx.fillStyle = color;
      ctx.fillText(head, x, y);
      ctx.font = `28px ${SERIF}`;
      ctx.fillStyle = '#f6e7d8';
      lines.forEach((l, i) => ctx.fillText(l, x, y + 42 + i * 34, W - x - 24));
    };
    if (this.infoPage === 0) {
      para(130, '#ffd86b', 'COINS', ['Any Mystery coin can carry a Blue, Yellow or Red', 'coin. It flicks up into its pig, which gets fatter', 'or starts its bonus. Others often join in.']);
      para(300, '#7ab0ff', 'BLUE PIG · FREE SPINS', ['Banks spins: starts at 9, +1 per blue', 'coin, up to 100. Plays them all, then', 'resets to 9.'], 'blue');
      para(470, '#ffd030', 'YELLOW PIG · JACKPOTS', ['Yellow coins grow all six jackpots.', 'Bonus: collect 2 Mini, 2 Minor, 3 Maxi,', '4 Major, 5 Grand or 6 Mega coins. 7 spins.'], 'yellow');
      para(640, '#ff7a7a', 'RED PIG · CROSS OUTS', ['Red coins cross out 10, J, Q, K, A in', 'order. Bonus: 7 spins with those royals', 'taken off the reels.'], 'red');
      para(810, '#ffffff', 'TOGETHER', ['Pigs can go off together: spins = the Blue', 'count if Blue is in, otherwise 7. Pigs are', 'kept per bet level: look for a fat Blue pig!']);
      ctx.textAlign = 'center';
      ctx.font = `italic 26px ${SERIF}`;
      ctx.fillStyle = GOLD_LIGHT;
      ctx.fillText('tap for pays', W / 2, H - 50);
      return;
    }
    const syms = PIGGY.symbols.filter((x) => x.pays);
    const cell = 96;
    syms.forEach((sym, i) => {
      const col = i % 2,
        row = Math.floor(i / 2);
      const x = 40 + col * 380,
        y = 100 + row * 116;
      ctx.drawImage(this.atlas.canvas, this.atlas.index.get(sym.id)! * CELL, 0, CELL, CELL, x, y, cell, cell);
      ctx.font = `900 24px ${DISPLAY}`;
      ctx.fillStyle = '#ffffff';
      const p = sym.pays!;
      ctx.fillText(`5  ${p[5]}`, x + 112, y + 24);
      ctx.fillText(`4  ${p[4]}`, x + 112, y + 52);
      ctx.fillText(`3  ${p[3]}`, x + 112, y + 80);
    });
    const y = 700;
    ctx.drawImage(this.atlas.canvas, this.atlas.index.get('MYSTERY')! * CELL, 0, CELL, CELL, 40, y, cell, cell);
    ctx.drawImage(this.atlas.canvas, this.atlas.index.get('WILD')! * CELL, 0, CELL, CELL, 40, y + 120, cell, cell);
    ctx.font = `24px ${SERIF}`;
    ctx.fillStyle = '#f6e7d8';
    ctx.fillText('Mystery coins land in stacks. Every Mystery coin on', 156, y + 30, W - 190);
    ctx.fillText('screen turns into the same symbol, even the Wild.', 156, y + 60, W - 190);
    ctx.fillText('WILD on reels 2–4 substitutes for all paying symbols.', 156, y + 150, W - 190);
    ctx.fillText('It pays nothing on its own.', 156, y + 180, W - 190);
    ctx.textAlign = 'center';
    ctx.font = `italic 20px ${SERIF}`;
    ctx.fillStyle = GOLD_LIGHT;
    ctx.fillText('Pays × line bet (bet ÷ 25), left to right, 25 lines  ·  tap to close', W / 2, H - 40);
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
          const len = this.reelStrips[i].length;
          r.pos = ((Math.round(r.from - r.distance) % len) + len) % len;
          const mys = this.out!.raw[i].includes('MYSTERY');
          this.ctx.sound.play(mys ? 'chip' : 'reelStop', this.screen.mesh, { volume: 0.7 });
        } else all = false;
      });
      this.reelLoop.set(all ? 0 : 0.5, 1);
      if (all) this.onAllStopped();
    }
    if (this.mode === 'reveal' && this.time >= this.revealAt) this.afterReveal();
    if (this.mode === 'showing' || this.mode === 'free') this.winTimer += dt;
    if (this.mode === 'free') {
      this.freeTimer -= dt;
      if (this.freeTimer <= 0 && !this.flicks.length) {
        if (this.game.bonus?.done) this.finishBonus();
        else this.startSpin();
      }
    }
    if (this.mode === 'bonusEnd' && this.bonusCounted) {
      this.freeTimer -= dt;
      if (this.freeTimer <= 0) this.collect();
    }

    for (const f of [...this.flicks]) {
      f.t += dt;
      if (f.t >= f.dur) {
        this.flicks.splice(this.flicks.indexOf(f), 1);
        f.done();
      }
    }
    for (const p of this.particles) {
      p.vy += 1500 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.spin += dt * 9;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0 && p.y < H + 40);

    // Pigs: fatness follows the meter, squash-and-stretch gulps, shakes.
    for (const c of COLORS) {
      const p = this.pig2[c];
      const target = this.fullness(c);
      p.fat += (target - p.fat) * Math.min(1, dt * 5);
      p.squash = Math.max(0, p.squash - dt * 2.5);
      p.shake = Math.max(0, p.shake - dt);
      p.glow = Math.max(0, p.glow - dt);
      const q = this.pig3[c];
      const g = q.group;
      q.fat += (target - q.fat) * Math.min(1, dt * 4);
      q.wobble = Math.max(0, q.wobble - dt * 2.2);
      q.party = Math.max(0, q.party - dt);
      const f = q.fat;
      g.scale.set(0.85 + f * 0.5, 0.85 + f * 0.25, 0.85 + f * 0.4);
      g.rotation.z = Math.sin(this.time * 22) * 0.18 * q.wobble + (q.party > 0 ? Math.sin(this.time * 14) * 0.12 : 0);
      g.position.y = STAGE_Y + (q.party > 0 ? Math.abs(Math.sin(this.time * 9)) * 0.05 : 0) + q.wobble * 0.01;
      const inBonus = this.inBonus && !!this.game.bonus?.features[c];
      q.mat.emissiveIntensity = q.party > 0 || inBonus ? 0.35 + 0.25 * Math.sin(this.time * 8) : f > 0.8 ? 0.12 + 0.08 * Math.sin(this.time * 3) : 0;
    }

    for (const fl of [...this.flyers]) {
      fl.t += dt;
      fl.vel.y -= 3.2 * dt;
      fl.mesh.position.addScaledVector(fl.vel, dt);
      if (fl.mesh.position.y < 0.01) {
        fl.mesh.position.y = 0.01;
        fl.vel.y = Math.abs(fl.vel.y) * 0.3;
        fl.vel.x *= 0.5;
        fl.vel.z *= 0.5;
      }
      fl.mesh.rotation.x += dt * 12;
      if (fl.t >= 2.2) {
        fl.mesh.visible = false;
        fl.mesh.removeFromParent();
        this.coinPool.get(fl.mesh.userData.color)!.push(fl.mesh);
        this.flyers.splice(this.flyers.indexOf(fl), 1);
      }
    }

    // LED edge light: slow pink breathing; rainbow chase in bonuses and wins.
    const hot = this.inBonus || (this.mode === 'showing' && this.shownWin > 0);
    if (hot) this.led.color.setHSL((this.time * 0.5) % 1, 0.9, 0.55);
    else this.led.color.setHSL(0.9, 0.85, 0.42 + 0.12 * Math.sin(this.time * 1.5));

    const rate = this.mode === 'spinning' ? 14 : hot ? 24 : 4;
    const phase = Math.floor(this.time * rate);
    if (phase !== this.bulbPhase) {
      this.bulbPhase = phase;
      for (let i = 0; i < this.bulbs.count; i++) this.bulbs.setColorAt(i, (i + phase) % 3 === 0 ? this.bulbOff : this.bulbOn);
      this.bulbs.instanceColor!.needsUpdate = true;
    }

    // Redraw the screen when anything on it moves (30 fps is plenty, and kinder to Quest).
    const animating =
      this.mode === 'spinning' ||
      this.mode === 'reveal' ||
      this.mode === 'intro' ||
      this.mode === 'free' ||
      this.mode === 'bonusEnd' ||
      this.flicks.length > 0 ||
      this.particles.length > 0 ||
      (!!this.banner && this.time < this.banner.until + 0.2) ||
      (this.mode === 'showing' && this.winTimer < 30) ||
      COLORS.some((c) => this.pig2[c].squash > 0 || this.pig2[c].shake > 0 || Math.abs(this.pig2[c].fat - this.fullness(c)) > 0.002);
    this.redrawClock += dt;
    if (this.dirty || (animating && this.redrawClock >= 1 / 30)) {
      this.redrawClock = 0;
      this.dirty = false;
      this.drawScreen();
      this.screen.texture.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function outlined(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, stroke: string, width: number, maxW?: number, glow?: string) {
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y, maxW);
  if (glow) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = 20;
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y, maxW);
  ctx.shadowBlur = 0;
}

function titleText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, pink = false) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${size}px ${DISPLAY}`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.16;
  ctx.strokeStyle = '#1a0410';
  ctx.strokeText(text, x, y);
  ctx.lineWidth = size * 0.07;
  ctx.strokeStyle = goldFrame(ctx, y - size / 2, y + size / 2);
  ctx.strokeText(text, x, y);
  const g = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
  if (pink) {
    g.addColorStop(0, '#fff0f8');
    g.addColorStop(0.45, '#ff70c0');
    g.addColorStop(0.55, '#c0106a');
    g.addColorStop(1, '#ff90d0');
  } else {
    g.addColorStop(0, '#fffbe0');
    g.addColorStop(0.45, '#ffd040');
    g.addColorStop(0.55, '#b07008');
    g.addColorStop(1, '#ffe080');
  }
  ctx.fillStyle = g;
  ctx.shadowColor = pink ? '#ff60c0' : '#ffc040';
  ctx.shadowBlur = 24;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
}

function goldFrame(ctx: CanvasRenderingContext2D, y0: number, y1: number) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#fff4c0');
  g.addColorStop(0.3, '#e0a830');
  g.addColorStop(0.5, '#8a5a10');
  g.addColorStop(0.7, '#e8b840');
  g.addColorStop(1, '#fff0b0');
  return g;
}

function hexA(c: string, a: number): string {
  const col = new THREE.Color(c);
  return `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${a})`;
}

function shadeHex(c: string, k: number): string {
  return '#' + new THREE.Color(c).multiplyScalar(k).getHexString();
}

/** The static screen backdrop: deep plum with a sunburst behind the pigs. */
function background(bonus: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, bonus ? '#5a2a08' : '#4a0c3a');
  g.addColorStop(0.3, bonus ? '#2a1004' : '#22041c');
  g.addColorStop(1, '#08020a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, 170);
  for (let i = 0; i < 36; i++) {
    ctx.rotate((Math.PI * 2) / 36);
    ctx.fillStyle = i % 2 ? (bonus ? 'rgba(255,210,90,0.12)' : 'rgba(255,120,200,0.09)') : 'rgba(255,255,255,0.02)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(900, -70);
    ctx.lineTo(900, 70);
    ctx.fill();
  }
  ctx.restore();
  for (let i = 0; i < 80; i++) {
    const x = (i * 97) % W,
      y = (i * 53) % 330;
    ctx.fillStyle = `rgba(255,230,180,${0.15 + ((i * 7) % 10) / 30})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.5 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  return c;
}

/** A glossy 3D piggy bank, origin between its feet, facing +z. */
function pigGeometry(r: number) {
  const prep = (g: THREE.BufferGeometry, m: THREE.Matrix4) => {
    const n = g.index ? g.toNonIndexed() : g;
    n.applyMatrix4(m);
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
    return n;
  };
  const M = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  const legH = 0.03;
  const cy = legH + r * 0.88;
  // Body: a lathe so the belly is round and the back slightly flatter.
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = -Math.PI / 2 + (i / 24) * Math.PI;
    pts.push(new THREE.Vector2(Math.max(0.0001, Math.cos(a) * r * (1 + 0.06 * Math.cos(a * 2))), Math.sin(a) * r * 1.22));
  }
  const body: THREE.BufferGeometry[] = [
    prep(new THREE.LatheGeometry(pts, 32), M(0, cy, 0, Math.PI / 2, 0, 0, 1, 1, 0.92)),
    prep(new THREE.CylinderGeometry(r * 0.32, r * 0.36, r * 0.24, 24), M(0, cy - r * 0.05, r * 1.2, Math.PI / 2)),
    prep(new THREE.SphereGeometry(r * 0.24, 16, 12), M(0, cy + r * 0.4, r * 0.85)),
  ];
  for (const s of [-1, 1]) {
    body.push(prep(new THREE.ConeGeometry(r * 0.26, r * 0.4, 16), M(s * r * 0.5, cy + r * 0.82, r * 0.5, 0.45, 0, -s * 0.4, 1, 1, 0.5)));
    for (const z of [-1, 1]) body.push(prep(new THREE.CylinderGeometry(r * 0.17, r * 0.15, legH + r * 0.42, 14), M(s * r * 0.52, (legH + r * 0.42) / 2, z * r * 0.62)));
  }
  const tail = new THREE.CatmullRomCurve3(
    Array.from({ length: 12 }, (_, i) => {
      const a = i * 0.9;
      return new THREE.Vector3(Math.cos(a) * r * 0.1, cy + r * 0.15 + Math.sin(a) * r * 0.1, -r * 1.18 - i * r * 0.012);
    }),
  );
  body.push(prep(new THREE.TubeGeometry(tail, 24, r * 0.03, 8), new THREE.Matrix4()));
  const dark: THREE.BufferGeometry[] = [prep(new THREE.BoxGeometry(r * 0.6, r * 0.06, r * 0.12), M(0, cy + r * 0.88, -r * 0.1))];
  for (const s of [-1, 1]) {
    dark.push(prep(new THREE.SphereGeometry(r * 0.075, 10, 8), M(s * r * 0.3, cy + r * 0.38, r * 0.99)));
    dark.push(prep(new THREE.SphereGeometry(r * 0.065, 8, 6), M(s * r * 0.12, cy - r * 0.05, r * 1.33, 0, 0, 0, 1, 1.3, 0.5)));
  }
  const white: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) white.push(prep(new THREE.SphereGeometry(r * 0.11, 12, 10), M(s * r * 0.3, cy + r * 0.38, r * 0.92)));
  const trim: THREE.BufferGeometry[] = [prep(new THREE.TorusGeometry(r * 0.36, r * 0.035, 8, 24), M(0, cy + r * 0.88, -r * 0.1, Math.PI / 2, 0, 0, 1, 0.45, 1))];
  for (const s of [-1, 1]) for (const z of [-1, 1]) trim.push(prep(new THREE.CylinderGeometry(r * 0.17, r * 0.18, r * 0.08, 14), M(s * r * 0.52, r * 0.04, z * r * 0.62)));
  return { body: mergeGeometries(body)!, dark: mergeGeometries(dark)!, white: mergeGeometries(white)!, trim: mergeGeometries(trim)! };
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
