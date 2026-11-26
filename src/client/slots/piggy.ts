import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  BASE_FREE_GAMES,
  COLORS,
  extraWildsFor,
  freeGamesFor,
  JACKPOT_NAMES,
  JACKPOT_NEED,
  PIGGY,
  PiggyGame,
  piggyLineWins,
  POT_MAX,
  type CoinColor,
  type CoinEvent,
  type Feature,
  type Modifiers,
  type PiggySpin,
} from '../../rules/piggy';
import { windowAt } from '../../rules/slots';
import { assets } from '../assets';
import { easeOut, money, Tweens, type GameContext } from '../game';
import { bakeStatic, dynamic } from '../merge';
import { CanvasPanel, GOLD_LIGHT, roundRect } from '../panel';
import type { Viewpoint } from '../player';
import { radial, toTexture } from '../textures';
import { addCabinetDetails, GLOW } from './details';
import {
  backdrop,
  badgeSprite,
  canvas2,
  chunkyText,
  COIN_COLORS,
  colorCoin,
  DISPLAY,
  GOLD_STOPS,
  logo,
  meterInset,
  meterSprite,
  PIG_NAMES,
  PIG_PALETTE,
  piggyAtlas,
  pigSprite,
  PINK_STOPS,
  sparkle,
  WHITE_STOPS,
  type BackdropLayout,
} from './piggyArt';
import type { PiggyRemoteSpin } from '../net/mirrorCodec';

/**
 * Porkbelly Payday (Luau edition) on a tall cabinet with a gently curved
 * portrait screen and glowing edge trim. Top to bottom: the progressive
 * jackpot meters (Mega, then Grand, Major, Minor and Mini), the logo, the
 * three piggy mascots on pedestals over a mountain of coins with their
 * feature badges and pot pips, 5x3 reels on a beach, and a dark info bar.
 *
 * Pig coins landing on the reels fly into their pig's pot: the pig gulps,
 * fattens and wiggles, and its badge's pip lights. A full pot or a trigger
 * coin bursts the pot into free games with that pig's modifier, and other
 * pots can join in, combining modifiers. Big glossy 3D banks also stand on
 * the cabinet top.
 */

type Mode = 'idle' | 'spinning' | 'showing' | 'intro' | 'free' | 'bonusEnd' | 'info';

// Screen layout (canvas px).
const W = 720;
const H = 1280;
const CELL = 128;
const REELS_X = 40;
const REELS_Y = 724;
const REELS_H = 3 * CELL;
const PIG_R = 77;
const PIG_Y = 486;
const FOOT_Y = PIG_Y + PIG_R * 1.05;
const PIG_SX: Record<CoinColor, number> = { blue: 130, yellow: 360, red: 590 };
const BADGE = { w: 214, h: 66, y: 610 };
const TAG_Y = 698;
const MSG_Y = 1118;
const BAR_Y = 1198;
const MEGA = { x: 90, y: 30, w: 540, h: 92 };
const SMALL = { y: 152, w: 158, h: 60, gap: 14 };
const LOGO_Y = 214;
const LAYOUT: BackdropLayout = {
  w: W,
  h: H,
  burstY: 300,
  stageTop: 330,
  stageBottom: 640,
  pigX: COLORS.map((c) => PIG_SX[c]),
  pedestalY: FOOT_Y - 4,
  beachTop: 716,
  beachBottom: BAR_Y,
  reels: { x: REELS_X, y: REELS_Y, w: 5 * CELL, h: REELS_H },
};
const SCREEN = { w: 0.64, y: 1.535, z: 0.074, bulge: 0.03 };
const SERIF = 'Georgia, "Times New Roman", serif';
const DECK_TILT = 0.3;
const PIG_COLORS: Record<CoinColor, number> = { blue: 0x2a8cff, yellow: 0xffc21a, red: 0xff3040 };
const PIG_X3: Record<CoinColor, number> = { blue: -0.27, yellow: 0, red: 0.27 };
const STAGE_Y = 2.2;
const JP_COLORS = JACKPOT_NAMES.map((n) => COIN_COLORS[n][1]);
const FEATURE_NAME: Record<Feature, string> = { blue: 'EXTRA FREE GAMES', yellow: 'JACKPOT FREE GAMES', red: 'EXTRA WILDS' };
const TIPS = ['PIG COINS FILL THE PIGGY POTS', 'A FULL POT OR A ★ COIN STARTS FREE GAMES', 'POTS ARE KEPT PER BET · LOOK FOR FAT PIGS', 'JACKPOTS GROW WITH EVERY SPIN'];
const hex = (c: number) => '#' + new THREE.Color(c).getHexString();

interface ReelAnim {
  pos: number;
  from: number;
  distance: number;
  start: number;
  stopAt: number;
  stopped: boolean;
  /** Anticipation: this reel spins on longer, glowing. */
  tease: boolean;
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
  wiggle: number;
  cheer: number;
  phase: number;
}

interface Flick {
  color: string;
  hot: boolean;
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
  size: number;
}

interface Burst {
  x: number;
  y: number;
  color: string;
  at: number;
}

interface Flyer3D {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  t: number;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class PiggyMachineView {
  readonly group = new THREE.Group();
  readonly game: PiggyGame;
  readonly viewpoint: Viewpoint;
  readonly machine = { id: PIGGY.id, name: PIGGY.name };
  mode: Mode = 'idle';
  /** Paid spin settled: (staked, won, free games started). */
  onResult: ((staked: number, won: number, feature?: 'bonus') => void) | null = null;
  /** Free games finished: total paid by them (lines and jackpots). */
  onBonusEnd: ((won: number, features: Feature[]) => void) | null = null;
  /** Every spin you make here, paid or free (two-player games show it on your friend's screen). */
  onSpin: ((out: PiggySpin, bonus: (Modifiers & { spinsLeft: number; totalSpins: number }) | null) => void) | null = null;

  private screen: CanvasPanel;
  private deck: CanvasPanel;
  private marquee: CanvasPanel;
  private atlas: { canvas: HTMLCanvasElement; index: Map<string, number> };
  private blurAtlas: HTMLCanvasElement;
  private coinFaces = new Map<string, HTMLCanvasElement>();
  private bg: HTMLCanvasElement;
  private bgBonus: HTMLCanvasElement;
  private logoArt: HTMLCanvasElement;
  private meters: HTMLCanvasElement[];
  private badges: Record<CoinColor, HTMLCanvasElement>;
  private pigArt: Record<CoinColor, { open: HTMLCanvasElement; blink: HTMLCanvasElement; cheer: HTMLCanvasElement }>;
  private twinkles: [number, number, number][] = [];
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
  private dirty = true;
  private redrawClock = 0;
  /** When the screen was last drawn by the renderer, and how far away. */
  private seenAt = -10;
  private seenDist = 99;
  private pig3: Record<CoinColor, Pig3D> = {} as Record<CoinColor, Pig3D>;
  private pig2: Record<CoinColor, Pig2D> = {
    blue: { fat: 0, squash: 0, shake: 0, glow: 0, wiggle: 0, cheer: 0, phase: 0 },
    yellow: { fat: 0, squash: 0, shake: 0, glow: 0, wiggle: 0, cheer: 0, phase: 1.7 },
    red: { fat: 0, squash: 0, shake: 0, glow: 0, wiggle: 0, cheer: 0, phase: 3.1 },
  };
  /** Pot levels as shown (they catch up as coins arrive). */
  private shown: Record<CoinColor, number> = { blue: 0, yellow: 0, red: 0 };
  /** Jackpot meters as shown, in dollars (they tick up toward the real values). */
  private jpShown: number[] = JACKPOT_NAMES.map(() => 0);
  private flicks: Flick[] = [];
  private particles: Particle[] = [];
  private bursts: Burst[] = [];
  private flyers: Flyer3D[] = [];
  private coinPool = new Map<string, THREE.Mesh[]>();
  private coinGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.004, 16).rotateX(Math.PI / 2);
  private coinMats = new Map<string, THREE.MeshStandardMaterial>();
  private bulbs: THREE.InstancedMesh;
  private bulbOn = new THREE.Color(0xfff0b0);
  private bulbOff = new THREE.Color(0x4a3518);
  private bulbPhase = -1;
  private led: THREE.MeshBasicMaterial;
  private banner: { text: string | (() => string); sub?: string | (() => string); at: number; until: number; color: string | (() => string); big?: boolean } | null = null;
  /** Floating labels ("+1 FREE GAME"). */
  private floaters: { text: string; x: number; y: number; at: number; color: string }[] = [];
  private freeTimer = 0;
  private introUntil = 0;
  private bonusShownTotal = 0;
  private bonusCounted = false;
  private cellFlash: number[] = new Array(15).fill(-10);
  private jpFlash: number[] = JACKPOT_NAMES.map(() => -10);
  private teaseSoundFor = -1;
  private lastFeatures: Feature[] = [];
  private infoPage = 0;
  /** A spin your friend made on this machine, played here for show (their name), or null. */
  private remote: string | null = null;
  private remoteGames: [number, number] | null = null;

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
    this.bg = backdrop(LAYOUT, false);
    this.bgBonus = backdrop(LAYOUT, true);
    this.logoArt = logo(W, 152);
    this.meters = JACKPOT_NAMES.map((n) => (n === 'MEGA' ? meterSprite(MEGA.w, MEGA.h, n) : meterSprite(SMALL.w, SMALL.h, n)));
    this.badges = { blue: badgeSprite(BADGE.w, BADGE.h, 'blue'), yellow: badgeSprite(BADGE.w, BADGE.h, 'yellow'), red: badgeSprite(BADGE.w, BADGE.h, 'red') };
    this.pigArt = Object.fromEntries(COLORS.map((c) => [c, { open: pigSprite(PIG_R, c), blink: pigSprite(PIG_R, c, true), cheer: pigSprite(PIG_R, c, false, true) }])) as PiggyMachineView['pigArt'];
    for (let i = 0; i < 16; i++) this.twinkles.push([20 + ((i * 263) % 680), 420 + ((i * 97) % 200), i * 0.77]);
    this.reels = PIGGY.reels.map((strip) => ({ pos: Math.floor(Math.random() * strip.length), from: 0, distance: 0, start: 0, stopAt: 0, stopped: true, tease: false }));

    this.screen = new CanvasPanel(SCREEN.w, W, H, { transparent: false });
    this.screen.mesh.geometry.dispose();
    this.screen.mesh.geometry = curvedPanel(SCREEN.w, (SCREEN.w * H) / W, SCREEN.bulge);
    this.screen.mesh.onBeforeRender = (_r, _s, camera) => {
      this.seenAt = this.time;
      this.seenDist = _v.setFromMatrixPosition(camera.matrixWorld).distanceTo(_w.setFromMatrixPosition(this.screen.mesh.matrixWorld));
    };
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
    this.viewpoint = { id: PIGGY.id, label: PIGGY.name, position: vp, yaw, pitch: 0.02, eye: 1.55, back: 0.66, portrait: { back: 0.55, eye: 1.52, pitch: 0.04 } };
    ctx.bankroll.onChange(() => {
      this.deck.redraw();
      this.dirty = true;
    });
    bakeStatic(this.group, { shadows: ctx.quality.shadows });
  }

  // ---------------------------------------------------------------------------
  // Cabinet and 3D banks
  // ---------------------------------------------------------------------------

  private buildCabinet() {
    const g = this.group;
    const q = this.ctx.quality;
    const body = new THREE.MeshPhysicalMaterial({ color: 0x120e18, roughness: 0.25, metalness: 0.3, clearcoat: q.name === 'desktop' ? 1 : 0, clearcoatRoughness: 0.06, envMapIntensity: 1.1 });
    const accent = new THREE.MeshPhysicalMaterial({ color: 0x0a5a64, roughness: 0.2, metalness: 0.4, clearcoat: q.name === 'desktop' ? 1 : 0, envMapIntensity: 1.2 });
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
    const sw = SCREEN.w,
      sh = (SCREEN.w * H) / W;
    // Base, deck, tall upper body behind the curved screen.
    add(new RoundedBoxGeometry(0.82, 0.8, 0.64, 3, 0.03), body, 0, 0.4, 0.02);
    add(new THREE.BoxGeometry(0.84, 0.02, 0.66), chrome, 0, 0.805, 0.02);
    add(new THREE.BoxGeometry(0.78, 0.06, 0.54), black, 0, 0.03, 0.02);
    add(new RoundedBoxGeometry(0.82, 0.05, 0.32, 2, 0.015), body, 0, 0.86, 0.2, DECK_TILT);
    add(new RoundedBoxGeometry(0.84, sh + 0.14, 0.3, 3, 0.04), body, 0, SCREEN.y, -0.08);
    // Teal side fins.
    for (const sx of [-1, 1]) add(new RoundedBoxGeometry(0.035, sh + 0.1, 0.26, 2, 0.012), accent, sx * 0.425, SCREEN.y, -0.07);
    // A black curved surround just behind the screen.
    const surround = new THREE.Mesh(curvedPanel(sw + 0.05, sh + 0.05, SCREEN.bulge), black);
    surround.position.set(0, SCREEN.y, SCREEN.z - 0.004);
    g.add(surround);
    this.screen.mesh.position.set(0, SCREEN.y, SCREEN.z);
    g.add(dynamic(this.screen.mesh));
    this.deck.mesh.rotation.x = -Math.PI / 2 + DECK_TILT;
    this.deck.mesh.position.set(0, 0.86, 0.2).add(new THREE.Vector3(0, Math.cos(DECK_TILT), Math.sin(DECK_TILT)).multiplyScalar(0.027));
    g.add(this.deck.mesh);

    // Glowing edge trim following the screen's curve (colour animates).
    const led = new THREE.MeshBasicMaterial({ color: 0x30e8e0, toneMapped: false });
    const ledGroup = new THREE.Group();
    const bow = (x: number) =>
      new THREE.CatmullRomCurve3(
        Array.from({ length: 13 }, (_, i) => {
          const t = i / 12 - 0.5;
          return new THREE.Vector3(x, SCREEN.y + t * (sh + 0.03), SCREEN.z + SCREEN.bulge * (2 * t) ** 2 + 0.002);
        }),
      );
    for (const sx of [-1, 1]) ledGroup.add(new THREE.Mesh(new THREE.TubeGeometry(bow(sx * (sw / 2 + 0.018)), 24, 0.0065, 8), led));
    for (const sy of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, sw + 0.036, 8).rotateZ(Math.PI / 2), led);
      strip.position.set(0, SCREEN.y + sy * (sh / 2 + 0.015), SCREEN.z + SCREEN.bulge + 0.002);
      ledGroup.add(strip);
    }
    const baseStrip = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.008, 0.008), led);
    baseStrip.position.set(0, 0.07, 0.345);
    ledGroup.add(baseStrip);
    g.add(dynamic(ledGroup));

    // Topper: chrome shelf for the banks, marquee sign behind with chasing bulbs.
    add(new RoundedBoxGeometry(0.88, 0.035, 0.44, 2, 0.012), chrome, 0, STAGE_Y - 0.015, -0.06);
    add(new RoundedBoxGeometry(0.86, 0.3, 0.08, 3, 0.03), body, 0, STAGE_Y + 0.42, -0.24);
    add(new THREE.BoxGeometry(0.88, 0.012, 0.09), gold, 0, STAGE_Y + 0.57, -0.24);
    this.marquee.mesh.position.set(0, STAGE_Y + 0.42, -0.198);
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
      tmp.position.set(x, STAGE_Y + 0.42 + y, -0.196);
      tmp.updateMatrix();
      bulbs.setMatrixAt(i, tmp.matrix);
      bulbs.setColorAt(i, this.bulbOn);
    }
    g.add(dynamic(bulbs));

    addCabinetDetails(g, { topY: STAGE_Y + 0.57, topZ: -0.24, frontZ: 0.34, panelY: 0.62, halfW: 0.41, candle: GLOW.pink, dark: black });

    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.4), new THREE.MeshBasicMaterial({ map: toTexture(radial(128, 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0)')), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, 0.011, 0.1);
    g.add(shadow);
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.9),
      new THREE.MeshBasicMaterial({ map: toTexture(radial(128, '#30e0d8', 'rgba(0,0,0,0)')), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }),
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

  /** How full each pot looks, 0..1. */
  private fullness(c: CoinColor): number {
    return this.shown[c] / POT_MAX;
  }

  private syncShown(snap = false) {
    const b = this.game.bankFor();
    this.shown = { ...b.pots };
    if (snap) {
      for (const c of COLORS) this.pig2[c].fat = this.pig3[c].fat = this.fullness(c);
      this.jpShown = b.jackpots.map((v) => Math.round(v * this.game.bet * 100) / 100);
    }
    this.dirty = true;
  }

  private drawMarquee() {
    const m = this.marquee;
    const ctx = m.ctx;
    ctx.fillStyle = (() => {
      const g = ctx.createLinearGradient(0, 0, 0, m.pxH);
      g.addColorStop(0, '#a00840');
      g.addColorStop(0.55, '#ff4a6a');
      g.addColorStop(1, '#ffb040');
      return g;
    })();
    ctx.fillRect(0, 0, m.pxW, m.pxH);
    ctx.save();
    ctx.translate(m.pxW / 2, m.pxH * 0.55);
    for (let i = 0; i < 36; i++) {
      ctx.rotate((Math.PI * 2) / 36);
      ctx.fillStyle = i % 2 ? 'rgba(255,255,200,0.16)' : 'rgba(255,255,255,0.03)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(m.pxW, -70);
      ctx.lineTo(m.pxW, 70);
      ctx.fill();
    }
    ctx.restore();
    const art = logo(1180, 330);
    ctx.drawImage(art, (m.pxW - art.width) / 2, 10);
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
      ctx.strokeStyle = '#30e0d8';
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
    return this.mode === 'intro' || this.mode === 'free' || this.mode === 'bonusEnd' || (this.game.phase === 'bonus' && (this.mode === 'spinning' || this.mode === 'showing'));
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
    // Pots and jackpots are kept per bet level: show this level's.
    this.syncShown(true);
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
    // Your own play always wins over a friend's spin being shown here.
    if (this.remote) this.endRemote();
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
    if (this.remote) this.endRemote();
    const strips = free && this.game.bonus ? this.game.bonus.reels : PIGGY.reels;
    const nearFull = !free && COLORS.some((c) => this.shown[c] >= POT_MAX - 1);
    this.lastStake = free ? 0 : this.game.bet;
    const out = this.game.spin(this.ctx.rng, forcedStops);
    this.onSpin?.(out, this.game.bonus);
    this.out = out;
    this.pendingWin = out.win;
    this.ctx.hud.setPending(PIGGY.id, out.win);
    this.shownWin = 0;
    this.mode = 'spinning';
    this.scheduleReels(out, strips, free, nearFull);
  }

  /** Are you using this machine: mid-spin, in free games or reading the rules? */
  get busy(): boolean {
    return (this.mode !== 'idle' && this.mode !== 'showing' && !this.remote) || this.game.phase !== 'idle';
  }

  /**
   * Shows a spin your friend made on their Porkbelly: same stops, coins flying
   * into the pigs (their pots, for the moment), wins and free-games banners,
   * all for show. Your pots, free games, credits and HUD stay as they are.
   * Returns false if you're busy at the machine yourself.
   */
  showRemoteSpin(spin: PiggyRemoteSpin, who: string): boolean {
    if (this.busy) return false;
    const grid = spin.strips.map((st, i) => windowAt(st, spin.stops[i]));
    const lineWins = piggyLineWins(grid, spin.bet);
    const lineWin = Math.round(lineWins.reduce((a, w) => a + w.amount, 0) * 100) / 100;
    const win = Math.round((lineWin + spin.jackpotWins.reduce((a, w) => a + w.amount, 0)) * 100) / 100;
    const mine = this.game.bankFor();
    this.out = {
      free: spin.free,
      bet: spin.bet,
      stops: spin.stops,
      grid,
      coins: spin.coins,
      jackpotCoins: spin.jackpotCoins,
      jackpotWins: spin.jackpotWins,
      lineWins,
      lineWin,
      win,
      triggered: spin.free ? null : spin.mods,
      bank: { pots: { ...spin.pots }, jackpots: [...mine.jackpots] },
    };
    // Their pots as they were before this spin's coins went in.
    if (!spin.free) {
      for (const c of COLORS) {
        const n = spin.coins.filter((e) => e.color === c && e.result !== 'none').length;
        const level = spin.mods?.features[c] ? spin.mods.levels[c] : spin.pots[c];
        this.shown[c] = Math.max(0, level - n);
      }
    }
    this.remote = who;
    this.remoteGames = spin.games;
    this.banner = null;
    this.shownWin = 0;
    this.mode = 'spinning';
    this.scheduleReels(this.out, spin.strips, spin.free, false);
    return true;
  }

  private endRemote() {
    this.remote = null;
    this.remoteGames = null;
    if (this.mode === 'spinning') {
      for (const r of this.reels) r.stopped = true;
      this.reelLoop.stop();
      this.mode = 'idle';
    }
    this.banner = null;
    this.flicks = [];
    this.syncShown();
  }

  private scheduleReels(out: PiggySpin, strips: readonly (readonly string[])[], free: boolean, nearFull: boolean) {
    let t = free ? 0.55 : 0.7;
    // Anticipation: a coin on an early reel with a pot about to go (or going) makes the rest spin on, glowing.
    const firstCoin = out.coins.length ? Math.min(...out.coins.map((c) => c.reel)) : 9;
    const tease = !free && firstCoin < 3 && (nearFull || !!out.triggered);
    this.reels.forEach((r, i) => {
      const len = strips[i].length;
      r.pos = ((r.pos % len) + len) % len;
      const target = out.stops[i];
      t += i === 0 ? 0 : free ? 0.18 : 0.25;
      const slow = tease && i > firstCoin;
      if (slow) t += 0.75;
      const delta = (((r.pos - target) % len) + len) % len;
      const laps = Math.max(1, Math.round((22 * t - delta) / len));
      Object.assign(r, { from: r.pos, distance: laps * len + delta, start: this.time, stopAt: this.time + t, stopped: false, tease: slow });
    });
    this.teaseSoundFor = -1;
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
        r.tease = false;
      }
    }
  }

  /** Reels stopped: wins, jackpot coins, then pig coins fly into their pots. */
  private onAllStopped() {
    this.reelLoop.stop();
    const out = this.out!;
    this.mode = 'showing';
    this.winTimer = 0;
    this.dirty = true;
    let celebrateFor = 0;
    if (out.lineWin > 0) {
      const bet = out.bet;
      const big = out.lineWin >= bet * 10;
      this.ctx.sound.play(big ? 'winBig' : 'winSmall', this.screen.mesh);
      if (big && !out.free) celebrateFor = this.celebrateWin(out.lineWin, bet);
      else if (big) this.shower(Math.min(120, 30 + out.lineWin / bet));
      this.tweens.add(Math.min(3, 0.6 + out.lineWin / bet / 8), (k) => {
        this.shownWin = Math.round(out.lineWin * k * 100) / 100;
      });
      for (const w of out.lineWins) for (const [reel, row] of w.cells) this.cellFlash[reel * 3 + row] = this.time;
    }
    // Jackpot coins in Jackpot Free Games.
    out.jackpotCoins.forEach((c, n) =>
      this.after(0.15 * n, () => {
        this.cellFlash[c.reel * 3 + c.row] = this.time;
        this.jpFlash[c.jackpot] = this.time;
        this.ctx.sound.play('chip', this.screen.mesh, { volume: 0.8, rate: 1 + c.jackpot * 0.12 });
      }),
    );
    for (const w of out.jackpotWins) {
      this.after(0.4 + 0.15 * out.jackpotCoins.length, () => {
        this.showBanner(`${JACKPOT_NAMES[w.jackpot]}!`, money(w.amount), JP_COLORS[w.jackpot], 2.6, true);
        this.jpFlash[w.jackpot] = this.time + 1.5;
        this.ctx.sound.play('winBig', this.screen.mesh);
        this.shower(40 + w.jackpot * 30, JACKPOT_NAMES[w.jackpot]);
        if (w.jackpot >= 2) this.ctx.sound.play('cheer', this.screen.mesh, { volume: 0.8 });
        if (!this.remote) this.ctx.hud.toast(`${JACKPOT_NAMES[w.jackpot]} jackpot · ${money(w.amount)}`, 'win');
      });
    }

    // Pig coins fly up into the pots.
    out.coins.forEach((c, n) => {
      this.after(0.35 + 0.3 * n, () => {
        this.ctx.sound.play('chip', this.screen.mesh, { volume: 0.6, rate: 1.4 });
        if (c.result === 'trigger' || Math.random() < 0.25) this.ctx.sound.play('tension', this.screen.mesh, { volume: 0.5 });
        const cx = REELS_X + c.reel * CELL + CELL / 2,
          cy = REELS_Y + c.row * CELL + CELL / 2;
        this.flicks.push({ color: c.color, hot: c.result === 'trigger', x0: cx, y0: cy, x1: PIG_SX[c.color], y1: PIG_Y - PIG_R * 0.75, t: 0, dur: 0.7, done: () => this.coinArrived(c) });
      });
    });

    const settle = 0.35 + 0.3 * out.coins.length + (out.coins.length ? 1 : 0.2);
    if (this.remote) {
      // A friend's spin: show the free games they hit, then put your own pigs back.
      const who = this.remote;
      if (out.triggered) {
        const feats = COLORS.filter((c) => out.triggered!.features[c]);
        this.after(settle + 0.4, () => {
          if (this.remote !== who) return;
          this.showBanner(`${who.toUpperCase()} HIT FREE GAMES!`, feats.map((f) => PIG_NAMES[f]).join(' + '), feats.length > 1 ? '#ffd86b' : hex(PIG_COLORS[feats[0]]), 3.2);
          this.ctx.sound.play('banjo', this.screen.mesh, { volume: 0.7 });
          this.shower(30 * feats.length);
        });
      }
      this.after(settle + (out.triggered ? 3.8 : 0.6), () => {
        if (this.remote === who && this.mode === 'showing') this.syncShown();
      });
      this.deck.redraw();
      return;
    }
    this.ctx.hud.setPending(PIGGY.id, 0);
    this.pendingWin = 0;
    if (!out.free) {
      this.onResult?.(this.lastStake, out.win, out.triggered ? 'bonus' : undefined);
      if (out.triggered) this.after(Math.max(settle + 0.8, celebrateFor), () => this.startIntro());
      else this.after(settle, () => this.syncShown());
    } else {
      const b = this.game.bonus!;
      this.freeTimer = (out.lineWin > 0 ? 1.4 : 0.75) + (out.jackpotWins.length ? 2.6 : 0) + 0.15 * out.jackpotCoins.length;
      this.mode = 'free';
      if (b.done) this.freeTimer += 0.4;
    }
    this.deck.redraw();
  }

  private coinArrived(ev: CoinEvent) {
    const c = ev.color;
    const p2 = this.pig2[c];
    const p3 = this.pig3[c];
    p2.squash = 1;
    this.ctx.sound.play('gulp', this.screen.mesh, { volume: 0.7 });
    if (ev.result === 'feed') {
      this.shown[c] = Math.min(POT_MAX, this.shown[c] + 1);
      p2.wiggle = 1;
      p3.wobble = 1;
      const label = c === 'blue' ? `${freeGamesFor(this.shown[c])} GAMES` : c === 'red' ? `${extraWildsFor(this.shown[c])} WILDS` : 'POT +1';
      this.floater(label, PIG_SX[c], PIG_Y - PIG_R * 1.25, PIG_PALETTE[c][0]);
    } else if (ev.result === 'trigger') {
      this.shown[c] = Math.min(POT_MAX, this.shown[c] + 1);
      p2.shake = 1.4;
      p2.glow = 2.5;
      p2.cheer = 3;
      p3.party = 2;
      this.bursts.push({ x: PIG_SX[c], y: PIG_Y, color: c, at: this.time });
      this.pigShower(c, 26);
      this.ctx.sound.play('bonus', this.screen.mesh, { volume: 0.8 });
      this.after(0.5, () => this.showBanner(`${PIG_NAMES[c]}'S POT!`, FEATURE_NAME[c], hex(PIG_COLORS[c]), 1.5));
    } else {
      p2.wiggle = 0.35;
      p3.wobble = 0.3;
    }
    this.dirty = true;
  }

  private showBanner(text: string | (() => string), sub: string | (() => string) | undefined, color: string | (() => string), dur: number, big = false) {
    this.banner = { text, sub, at: this.time, until: this.time + dur, color, big };
  }

  /**
   * BIG WIN → MEGA WIN → EPIC WIN: the amount counts up and the title steps up
   * as it passes each tier (10x, 25x, 50x the bet), with bigger coin showers,
   * a brass stinger and the pigs dancing.
   */
  private celebrateWin(amount: number, bet: number): number {
    const x = amount / bet;
    if (x < 10) return 0;
    const tiers: [number, string, string][] = [
      [10, 'BIG WIN', '#ffd23a'],
      [25, 'MEGA WIN', '#ff5ad0'],
      [50, 'EPIC WIN', '#5ae8ff'],
    ];
    const dur = x >= 50 ? 6 : x >= 25 ? 4.6 : 3.2;
    let shown = 0;
    let tier = 0;
    const title = () => tiers[tier][1];
    const color = () => tiers[tier][2];
    this.showBanner(title, () => money(shown), color, dur + 1.6, true);
    this.ctx.sound.play('fanfare', this.screen.mesh, { volume: 0.9 });
    this.shower(50);
    for (const c of COLORS) {
      this.pig3[c].party = dur;
      this.pig2[c].cheer = dur;
    }
    this.tweens.add(dur, (k) => {
      shown = Math.round(amount * easeOut(k) * 100) / 100;
      const now = shown / bet;
      while (tier < tiers.length - 1 && now >= tiers[tier + 1][0]) {
        tier++;
        this.banner && (this.banner.at = this.time);
        this.ctx.sound.play('fanfare', this.screen.mesh, { volume: 1, rate: 1 + tier * 0.12 });
        this.ctx.sound.play('winBig', this.screen.mesh, { volume: 0.8 });
        this.shower(60 + tier * 40);
        if (tier === 2) this.ctx.sound.play('cheer', this.screen.mesh, { volume: 0.9 });
      }
      if (Math.random() < 0.25) this.ctx.sound.play('chip', this.screen.mesh, { volume: 0.35, rate: 1.4 + Math.random() * 0.4 });
    });
    return dur + 1.6;
  }

  private floater(text: string, x: number, y: number, color: string) {
    this.floaters.push({ text, x, y, at: this.time, color });
  }

  /** Coin shower particles over the screen. */
  private shower(n: number, color = 'gold') {
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x: W / 2 + (Math.random() - 0.5) * 240,
        y: REELS_Y + CELL * 1.5,
        vx: (Math.random() - 0.5) * 900,
        vy: -600 - Math.random() * 750,
        spin: Math.random() * 6,
        life: 2.2 + Math.random(),
        color: Math.random() < 0.7 ? color : 'gold',
        size: 30 + Math.random() * 14,
      });
    }
  }

  /** A pig's pot bursting: its coins fly out of it. */
  private pigShower(c: CoinColor, n: number) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const v = 380 + Math.random() * 520;
      this.particles.push({ x: PIG_SX[c], y: PIG_Y - PIG_R * 0.6, vx: Math.cos(a) * v, vy: Math.sin(a) * v, spin: Math.random() * 6, life: 1.6 + Math.random() * 0.8, color: Math.random() < 0.7 ? c : 'gold', size: 26 + Math.random() * 10 });
    }
  }

  // ---------------------------------------------------------------------------
  // Free games
  // ---------------------------------------------------------------------------

  private startIntro() {
    const b = this.game.bonus!;
    const feats = COLORS.filter((c) => b.features[c]);
    this.lastFeatures = feats;
    this.mode = 'intro';
    this.bonusShownTotal = 0;
    this.bonusCounted = false;
    this.introUntil = this.time + 4.2;
    this.banner = null;
    this.ctx.sound.play('banjo', this.screen.mesh, { volume: 0.9 });
    this.ctx.sound.play('bonus', this.screen.mesh, { volume: 0.6 });
    this.ctx.hud.toast(this.describe(feats, b.totalSpins), 'win');
    feats.forEach((c, n) => this.after(0.3 + n * 0.45, () => this.celebrate(c)));
    this.shower(40 * feats.length);
    this.after(4.2, () => {
      this.mode = 'free';
      this.freeTimer = 0.2;
      // The pots that went off are empty now.
      this.syncShown();
    });
    this.deck.redraw();
  }

  private describe(feats: Feature[], spins: number): string {
    const parts: string[] = [`${spins} free games`];
    if (feats.includes('yellow')) parts.push('jackpot coins');
    if (feats.includes('red')) parts.push(`+${this.game.bonus!.extraWilds} wilds`);
    return parts.join(' · ');
  }

  /** A pot going off: the 3D pig bounces, glows and throws its coins. */
  private celebrate(c: CoinColor) {
    const p3 = this.pig3[c];
    p3.party = 3;
    this.pig2[c].glow = 3;
    this.pig2[c].shake = 0.8;
    this.pig2[c].cheer = 3;
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
    for (const c of COLORS) this.pig2[c].cheer = 3;
    this.tweens.add(
      Math.min(4, 1.2 + b.won / b.totalBet / 30),
      (k) => {
        this.bonusShownTotal = Math.round(b.won * easeOut(k) * 100) / 100;
      },
      () => {
        this.bonusCounted = true;
        this.ctx.hud.toast(`Free games paid ${money(b.won)}`, 'win');
        this.onBonusEnd?.(b.won, this.lastFeatures);
        this.freeTimer = 6; // auto-collect
        this.deck.redraw();
      },
    );
    this.deck.redraw();
  }

  collect() {
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

  /** Test/demo hook: set this bet level's pots and force free games with the given pots going off. */
  debugBonus(features: Partial<Record<Feature, boolean>>, levels: Partial<Record<Feature, number>> = {}) {
    if (this.mode !== 'idle' && this.mode !== 'showing') return;
    const lv = { blue: levels.blue ?? 5, yellow: levels.yellow ?? 5, red: levels.red ?? 5 };
    this.game.setBank({ pots: lv });
    this.syncShown(true);
    const f = { blue: false, yellow: false, red: false, ...features };
    const g = this.game as unknown as { startBonus: (m: Modifiers, bet: number) => void };
    g.startBonus({ features: f, levels: { blue: f.blue ? lv.blue : 0, yellow: f.yellow ? lv.yellow : 0, red: f.red ? lv.red : 0 } }, this.game.bet);
    this.out = null;
    this.startIntro();
  }

  /** Test/demo hook: play the big-win celebration for `x` times the bet. */
  debugBigWin(x = 30) {
    this.celebrateWin(this.game.bet * x, this.game.bet);
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
    this.screen.onSurface = (x, y) => {
      // The denomination button in the info bar steps the bet.
      if (y > BAR_Y && x > W - 120 && this.canChangeBet) return this.changeBet(1);
      if (this.mode === 'info') this.onSpinPressed();
      else if (this.mode === 'bonusEnd') this.collect();
      else if ((this.mode === 'idle' || this.mode === 'showing') && this.game.phase === 'idle') this.onSpinPressed();
    };
  }

  private coinFace(color: string, hot = false): HTMLCanvasElement {
    const key = hot ? color + '*' : color;
    let c = this.coinFaces.get(key);
    if (!c) {
      c = canvas2(CELL, CELL)[0];
      colorCoin(c.getContext('2d')!, CELL, color, JACKPOT_NAMES.includes(color as never) ? color : undefined, hot);
      this.coinFaces.set(key, c);
    }
    return c;
  }

  drawScreen() {
    const ctx = this.screen.ctx;
    ctx.drawImage(this.inBonus ? this.bgBonus : this.bg, 0, 0);
    this.drawMeters();
    ctx.drawImage(this.logoArt, 0, LOGO_Y);
    this.drawPigs();
    this.drawBadges();
    this.drawReels();
    this.drawMessage();
    this.drawBar();
    this.drawFlicks();
    this.drawParticles();
    if (this.mode === 'info') return this.drawInfo();
    if (this.mode === 'intro') this.drawIntro();
    else if (this.mode === 'bonusEnd') this.drawSummary();
    this.drawBanner();
  }

  /** Mega on top, then Grand, Major, Minor, Mini; numbers tick up toward the real values. */
  private drawMeters() {
    const ctx = this.screen.ctx;
    const b = this.game.bonus;
    const collecting = !!b?.features.yellow && this.inBonus;
    for (let j = JACKPOT_NAMES.length - 1; j >= 0; j--) {
      const name = JACKPOT_NAMES[j];
      const mega = name === 'MEGA';
      const k = JACKPOT_NAMES.length - 2 - j;
      const w = mega ? MEGA.w : SMALL.w,
        h = mega ? MEGA.h : SMALL.h;
      const x = mega ? MEGA.x : (W - (4 * SMALL.w + 3 * SMALL.gap)) / 2 + k * (SMALL.w + SMALL.gap);
      const y = mega ? MEGA.y : SMALL.y;
      const ins = meterInset(w, h, name);
      const ox = x - ins.ox,
        oy = y - ins.oy;
      const flash = Math.max(0, 1 - Math.abs(this.time - this.jpFlash[j]) * 1.2);
      if (flash > 0) {
        ctx.save();
        ctx.shadowColor = JP_COLORS[j];
        ctx.shadowBlur = 40 * flash;
        ctx.drawImage(this.meters[j], ox, oy);
        ctx.restore();
      }
      ctx.drawImage(this.meters[j], ox, oy);
      // A light sweep glints across each meter now and then.
      const sweep = ((this.time * 0.35 + j * 0.13) % 1.6) - 0.3;
      if (sweep > 0 && sweep < 1) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x + 8, y + 8, w - 16, h - 16, 10);
        ctx.clip();
        const sx = x + sweep * (w + 80) - 40;
        const g = ctx.createLinearGradient(sx - 30, 0, sx + 30, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.5, 'rgba(255,255,255,0.16)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(sx - 30, y, 60, h);
        ctx.restore();
      }
      const size = mega ? 62 : 30;
      chunkyText(ctx, money(this.jpShown[j]), x + w / 2, y + h * 0.56, size, { fill: GOLD_STOPS, outline: '#2a0a00', depth: mega ? 4 : 2, rim: mega ? '#fff3c0' : null, maxW: ins.w, glow: flash > 0 ? '#fff0a0' : undefined, shadow: false });
      if (collecting) {
        for (let i = 0; i < JACKPOT_NEED; i++) {
          const cx = x + w / 2 + (i - (JACKPOT_NEED - 1) / 2) * 16;
          ctx.beginPath();
          ctx.arc(cx, y + h - 2, 6, 0, Math.PI * 2);
          ctx.fillStyle = i < b!.counts[j] ? '#ffffff' : 'rgba(0,0,0,0.75)';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = JP_COLORS[j];
          ctx.stroke();
        }
      }
    }
  }

  private drawPigs() {
    const ctx = this.screen.ctx;
    const t = this.time;
    // Twinkles on the coin mountain.
    for (const [x, y, ph] of this.twinkles) {
      const a = Math.sin(t * 2.3 + ph * 2.1);
      if (a > 0.55) sparkle(ctx, x, y, 9 + 6 * a, (a - 0.55) / 0.45);
    }
    for (const c of COLORS) {
      const p = this.pig2[c];
      const art = this.pigArt[c];
      const x = PIG_SX[c] + (p.shake > 0 ? Math.sin(t * 55) * 6 * Math.min(1, p.shake) : 0);
      const inBonus = this.inBonus && !!this.game.bonus?.features[c];
      const near = this.shown[c] >= POT_MAX - 2 && !this.inBonus;
      const glow = Math.max(p.glow > 0 ? Math.min(1, p.glow) : 0, inBonus ? 0.65 + 0.35 * Math.sin(t * 6) : 0, near ? 0.35 + 0.25 * Math.sin(t * 4) : 0);
      if (glow > 0) {
        const g = ctx.createRadialGradient(x, PIG_Y, 10, x, PIG_Y, PIG_R * 2);
        g.addColorStop(0, hexA(PIG_PALETTE[c][0], 0.85 * glow));
        g.addColorStop(0.45, hexA(PIG_PALETTE[c][1], 0.5 * glow));
        g.addColorStop(1, hexA(PIG_PALETTE[c][1], 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - PIG_R * 2, PIG_Y - PIG_R * 2, PIG_R * 4, PIG_R * 4);
      }
      // Idle bob and breathing; gulps squash; a filling pot wiggles; a fat pig is wider.
      const breathe = Math.sin(t * 2.4 + p.phase);
      const hop = p.cheer > 0 ? Math.abs(Math.sin(t * 9 + p.phase)) * 14 : 0;
      const sq = Math.sin(p.squash * Math.PI * 3) * p.squash;
      const sx = (0.9 + p.fat * 0.26) * (1 + sq * 0.12 + breathe * 0.012);
      const sy = (0.9 + p.fat * 0.08) * (1 - sq * 0.12 - breathe * 0.012);
      const rot = Math.sin(t * 19) * 0.13 * p.wiggle + (p.cheer > 0 ? Math.sin(t * 7 + p.phase) * 0.06 : 0);
      const blink = (t + p.phase * 1.3) % 4.1 < 0.14;
      const img = p.cheer > 0 || inBonus ? art.cheer : blink ? art.blink : art.open;
      // Shadow on the pedestal.
      ctx.beginPath();
      ctx.ellipse(x, FOOT_Y, PIG_R * 0.9 * sx, 10, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fill();
      ctx.save();
      ctx.translate(x, FOOT_Y - hop - Math.max(0, breathe) * 2);
      ctx.rotate(rot);
      ctx.scale(sx, sy);
      ctx.drawImage(img, -img.width / 2, -img.height * 0.52 - PIG_R * 1.05);
      ctx.restore();
    }
    // Pots bursting.
    this.bursts = this.bursts.filter((b) => this.time - b.at < 0.9);
    for (const b of this.bursts) {
      const k = (this.time - b.at) / 0.9;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.translate(b.x, b.y);
      ctx.strokeStyle = PIG_PALETTE[b.color][0];
      ctx.lineWidth = 14 * (1 - k) + 2;
      ctx.beginPath();
      ctx.arc(0, 0, PIG_R * (0.8 + k * 1.8), 0, Math.PI * 2);
      ctx.stroke();
      ctx.rotate(k * 1.5);
      ctx.fillStyle = hexA(PIG_PALETTE[b.color][0], 0.5);
      for (let i = 0; i < 12; i++) {
        ctx.rotate(Math.PI / 6);
        ctx.beginPath();
        ctx.moveTo(PIG_R * 0.6, -6);
        ctx.lineTo(PIG_R * (1.2 + k * 2), 0);
        ctx.lineTo(PIG_R * 0.6, 6);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /** Each pig's feature badge with its pot pips; it pulses when nearly full and glows when its feature is on. */
  private drawBadges() {
    const ctx = this.screen.ctx;
    const b = this.game.bonus;
    const t = this.time;
    for (const c of COLORS) {
      const x = PIG_SX[c] - BADGE.w / 2,
        y = BADGE.y;
      const active = this.inBonus && !!b?.features[c];
      const dim = this.inBonus && !active;
      const lvl = active ? b!.levels[c] : this.shown[c];
      const near = !this.inBonus && this.shown[c] >= POT_MAX - 2;
      const pulse = active ? 1 + 0.05 * Math.sin(t * 7) : near ? 1 + 0.035 * Math.sin(t * 6) : 1;
      ctx.save();
      ctx.translate(x + BADGE.w / 2, y + BADGE.h / 2);
      ctx.scale(pulse, pulse);
      ctx.globalAlpha = dim ? 0.45 : 1;
      if (active || near) {
        ctx.shadowColor = PIG_PALETTE[c][0];
        ctx.shadowBlur = active ? 30 : 18;
      }
      const img = this.badges[c];
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.shadowBlur = 0;
      const ty = -8;
      if (c === 'blue') {
        const n = active ? b!.totalSpins : freeGamesFor(Math.max(0, lvl));
        chunkyText(ctx, `${n}`, -64, ty, 40, { fill: WHITE_STOPS, outline: '#061650', depth: 3 });
        chunkyText(ctx, 'FREE', 26, ty - 11, 19, { fill: GOLD_STOPS, outline: '#061650', depth: 1, rim: null });
        chunkyText(ctx, 'GAMES', 26, ty + 10, 19, { fill: GOLD_STOPS, outline: '#061650', depth: 1, rim: null });
      } else if (c === 'yellow') {
        chunkyText(ctx, 'JACKPOT', 0, ty - 10, 22, { fill: GOLD_STOPS, outline: '#3a1a00', depth: 2, rim: null, maxW: BADGE.w - 40 });
        chunkyText(ctx, 'FREE GAMES', 0, ty + 12, 17, { fill: WHITE_STOPS, outline: '#3a1a00', depth: 1, rim: null, maxW: BADGE.w - 50 });
      } else {
        const n = active ? b!.extraWilds : extraWildsFor(Math.max(0, lvl));
        chunkyText(ctx, 'WILDS', -26, ty, 26, { fill: [[0, '#fff0e0'], [0.45, '#ff9a60'], [0.5, '#ff3a20'], [1, '#ffb080']], outline: '#3a0004', depth: 2, rim: null });
        chunkyText(ctx, `${n}`, 64, ty, 40, { fill: WHITE_STOPS, outline: '#4a0008', depth: 3 });
      }
      // Pot pips.
      for (let i = 0; i < POT_MAX; i++) {
        const px = (i - (POT_MAX - 1) / 2) * 19,
          py = BADGE.h / 2 - 14;
        const on = i < lvl;
        ctx.beginPath();
        ctx.arc(px, py, 6.5, 0, Math.PI * 2);
        if (on) {
          const g = ctx.createRadialGradient(px - 2, py - 2, 0.5, px, py, 7);
          g.addColorStop(0, '#ffffff');
          g.addColorStop(0.4, PIG_PALETTE[c][0]);
          g.addColorStop(1, PIG_PALETTE[c][1]);
          ctx.fillStyle = g;
        } else ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = on ? '#ffffff' : 'rgba(255,255,255,0.25)';
        ctx.stroke();
      }
      ctx.restore();
    }
    // The strip under the badges: the combine slogan, or the free-game counter.
    ctx.save();
    if (b && this.inBonus) {
      const done = b.totalSpins - b.spinsLeft;
      const text = this.mode === 'intro' ? `${b.totalSpins} FREE GAMES` : this.mode === 'bonusEnd' ? 'FREE GAMES COMPLETE' : `FREE GAME ${Math.min(b.totalSpins, Math.max(1, done))} OF ${b.totalSpins}`;
      chunkyText(ctx, text, W / 2, TAG_Y, 30, { fill: WHITE_STOPS, outline: '#3a0040', depth: 3, glow: '#ff80e0', maxW: W - 40 });
    } else if (this.remote && this.remoteGames) {
      chunkyText(ctx, `${this.remote.toUpperCase()}'S FREE GAME ${this.remoteGames[1] - this.remoteGames[0]} OF ${this.remoteGames[1]}`, W / 2, TAG_Y, 26, { fill: WHITE_STOPS, outline: '#3a0040', depth: 2, maxW: W - 40 });
    } else {
      chunkyText(ctx, 'COMBINE POTS FOR BIGGER FREE GAMES!', W / 2, TAG_Y, 24, { fill: GOLD_STOPS, outline: '#5a0030', depth: 2, maxW: W - 40 });
    }
    ctx.restore();
  }

  private drawReels() {
    const ctx = this.screen.ctx;
    const out = this.out;
    const strips = this.reelStrips;
    const t = this.time;
    // Gold frame with a turquoise inner bevel.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    roundRect(ctx, REELS_X - 12, REELS_Y - 12, 5 * CELL + 24, REELS_H + 24, 20);
    ctx.fillStyle = goldFrame(ctx, REELS_Y - 12, REELS_Y + REELS_H + 12);
    ctx.fill();
    ctx.restore();
    roundRect(ctx, REELS_X - 5, REELS_Y - 5, 5 * CELL + 10, REELS_H + 10, 14);
    ctx.fillStyle = this.inBonus ? '#a030c0' : '#18b8c0';
    ctx.fill();
    this.reels.forEach((r, i) => {
      const strip = strips[i];
      const x = REELS_X + i * CELL;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, REELS_Y, CELL, REELS_H);
      ctx.clip();
      const rg = ctx.createLinearGradient(x, 0, x + CELL, 0);
      rg.addColorStop(0, '#f2dcb0');
      rg.addColorStop(0.5, '#fff8e8');
      rg.addColorStop(1, '#f2dcb0');
      ctx.fillStyle = rg;
      ctx.fillRect(x, REELS_Y, CELL, REELS_H);
      const fast = !r.stopped && r.stopAt - t > 0.2 && t - r.start > 0.1;
      const src = fast ? this.blurAtlas : this.atlas.canvas;
      const base = Math.floor(r.pos);
      const f = r.pos - base;
      const midY = REELS_Y + REELS_H / 2 - CELL / 2;
      const settled = r.stopped && out && f < 0.01;
      for (let j = -2; j <= 2; j++) {
        const idx = (((base + j) % strip.length) + strip.length) % strip.length;
        let id = strip[idx];
        const y = midY + (j - f) * CELL;
        const row = j + 1;
        let flash = 0;
        if (settled && row >= 0 && row <= 2) {
          id = out.grid[i][row];
          flash = Math.max(0, 1 - (t - this.cellFlash[i * 3 + row]) * 1.5);
        }
        if (flash > 0) {
          const hg = ctx.createRadialGradient(x + CELL / 2, y + CELL / 2, 5, x + CELL / 2, y + CELL / 2, CELL * 0.7);
          hg.addColorStop(0, `rgba(255,240,150,${0.8 * flash})`);
          hg.addColorStop(1, 'rgba(255,220,120,0)');
          ctx.fillStyle = hg;
          ctx.fillRect(x, y, CELL, CELL);
        }
        const coinHere = settled && id === 'COIN' && row >= 0 && row <= 2;
        if (coinHere) this.drawCellCoin(ctx, out!, i, row, x, y);
        else {
          const grow = 1 + flash * 0.12;
          const sz = CELL * grow;
          ctx.drawImage(src, this.atlas.index.get(id)! * CELL, 0, CELL, CELL, x + CELL / 2 - sz / 2, y + CELL / 2 - sz / 2, sz, sz);
        }
      }
      const sh = ctx.createLinearGradient(0, REELS_Y, 0, REELS_Y + REELS_H);
      sh.addColorStop(0, 'rgba(60,30,0,0.45)');
      sh.addColorStop(0.14, 'rgba(0,0,0,0)');
      sh.addColorStop(0.86, 'rgba(0,0,0,0)');
      sh.addColorStop(1, 'rgba(60,30,0,0.45)');
      ctx.fillStyle = sh;
      ctx.fillRect(x, REELS_Y, CELL, REELS_H);
      ctx.restore();
      if (i > 0) {
        ctx.fillStyle = 'rgba(180,120,40,0.5)';
        ctx.fillRect(x - 1, REELS_Y, 2, REELS_H);
      }
      // Anticipation glow on a reel that's spinning on.
      if (r.tease && !r.stopped && this.reels.slice(0, i).every((q) => q.stopped)) {
        if (this.teaseSoundFor !== i) {
          this.teaseSoundFor = i;
          this.ctx.sound.play('tension', this.screen.mesh, { volume: 0.7 });
        }
        const a = 0.6 + 0.4 * Math.sin(t * 14);
        ctx.save();
        ctx.fillStyle = `rgba(255,230,120,${0.22 * a})`;
        ctx.fillRect(x, REELS_Y, CELL, REELS_H);
        ctx.shadowColor = '#fff080';
        ctx.shadowBlur = 40;
        ctx.lineWidth = 10;
        ctx.strokeStyle = `rgba(255,236,120,${a})`;
        roundRect(ctx, x + 4, REELS_Y + 4, CELL - 8, REELS_H - 8, 12);
        ctx.stroke();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.restore();
        for (let k = 0; k < 4; k++) sparkle(ctx, x + CELL / 2 + Math.sin(t * 5 + k * 1.6) * 50, REELS_Y + ((t * 220 + k * 96) % REELS_H), 10, 0.8);
      }
    });
    // Glossy glass reflection over the reels.
    const gl = ctx.createLinearGradient(0, REELS_Y, 0, REELS_Y + REELS_H * 0.35);
    gl.addColorStop(0, 'rgba(255,255,255,0.14)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(REELS_X, REELS_Y, 5 * CELL, REELS_H * 0.35);

    if ((this.mode === 'showing' || this.mode === 'free') && out && out.lineWins.length > 0) {
      const k = Math.floor(this.winTimer / 1.3) % (out.lineWins.length + 1);
      const wins = k === 0 ? out.lineWins : [out.lineWins[k - 1]];
      const pulse = 0.6 + 0.4 * Math.sin(t * 8);
      ctx.save();
      for (const w of wins) {
        const col = ['#ffe040', '#ff5ad0', '#5ae8ff', '#7aff6a', '#ff9a3a'][w.line % 5];
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.9 * pulse;
        ctx.lineWidth = 6;
        ctx.lineJoin = 'round';
        ctx.shadowColor = col;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        PIGGY.lines[w.line].forEach((row, reel) => {
          const px = REELS_X + reel * CELL + CELL / 2,
            py = REELS_Y + row * CELL + CELL / 2;
          reel ? ctx.lineTo(px, py) : ctx.moveTo(px - CELL / 2, py);
        });
        ctx.stroke();
        ctx.globalAlpha = 1;
        for (const [reel, row] of w.cells) {
          ctx.lineWidth = 6;
          roundRect(ctx, REELS_X + reel * CELL + 4, REELS_Y + row * CELL + 4, CELL - 8, CELL - 8, 14);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  /** A pig coin (coloured, or a jackpot coin in Jackpot Free Games) on a stopped reel. */
  private drawCellCoin(ctx: CanvasRenderingContext2D, out: PiggySpin, reel: number, row: number, x: number, y: number) {
    const t = this.time;
    const jp = out.jackpotCoins.find((c) => c.reel === reel && c.row === row);
    const coin = out.coins.find((c) => c.reel === reel && c.row === row);
    let face: HTMLCanvasElement;
    let alpha = 1;
    if (jp) face = this.coinFace(JACKPOT_NAMES[jp.jackpot]);
    else if (coin) {
      face = this.coinFace(coin.color, coin.result === 'trigger');
      // Once it has flown off to its pig, a faint ghost stays behind.
      const n = out.coins.indexOf(coin);
      if (this.mode !== 'spinning' && this.time - this.cellFlashAt(out) > 0.35 + 0.3 * n) alpha = 0.3;
    } else face = this.coinFace('rose');
    const bob = coin?.result === 'trigger' && alpha === 1 ? 1 + 0.06 * Math.sin(t * 10) : 1;
    const sz = CELL * 0.98 * bob;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(face, x + CELL / 2 - sz / 2, y + CELL / 2 - sz / 2, sz, sz);
    ctx.restore();
  }

  /** When the current spin's reels settled (pig coins start flying 0.35 s later). */
  private settledAt = 0;
  private cellFlashAt(_out: PiggySpin) {
    return this.settledAt;
  }

  /** The strip under the reels: win amount and line, tips, or a friend's spin. */
  private drawMessage() {
    const ctx = this.screen.ctx;
    const out = this.out;
    const y = MSG_Y;
    roundRect(ctx, 60, y - 4, W - 120, 72, 36);
    ctx.fillStyle = 'rgba(6,20,50,0.72)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(160,255,250,0.7)';
    ctx.stroke();
    const b = this.game.bonus;
    const cy = y + 32;
    if (b && this.inBonus) {
      const v = this.mode === 'bonusEnd' ? this.bonusShownTotal : b.won;
      chunkyText(ctx, `FREE GAMES WIN ${money(v)}`, W / 2, cy, 34, { fill: GOLD_STOPS, outline: '#2a0a00', depth: 3, maxW: W - 150 });
      return;
    }
    if (this.mode === 'spinning') {
      const teasing = this.reels.some((r) => r.tease && !r.stopped);
      const who = this.remote ? `${this.remote.toUpperCase()} IS SPINNING` : teasing ? 'HERE IT COMES…' : 'GOOD LUCK!';
      chunkyText(ctx, who, W / 2, cy, 32, { fill: WHITE_STOPS, outline: '#06204a', depth: 2, maxW: W - 150 });
      return;
    }
    if (out && this.mode === 'showing' && out.win > 0) {
      const k = Math.floor(this.winTimer / 1.3) % (out.lineWins.length + 1);
      const value = this.remote ? out.win : Math.max(this.shownWin, out.win - out.lineWin > 0 ? out.win : 0);
      if (k > 0) {
        const w = out.lineWins[k - 1];
        chunkyText(ctx, `LINE ${w.line + 1} · ${w.count} × ${PIGGY.symbols.find((x) => x.id === w.symbol)!.name.toUpperCase()} · ${money(w.amount)}`, W / 2, cy, 24, { fill: WHITE_STOPS, outline: '#06204a', depth: 2, rim: null, maxW: W - 150 });
      } else chunkyText(ctx, `${this.remote ? this.remote.toUpperCase() + ' WON' : 'WIN'} ${money(value)}`, W / 2, cy, 40, { fill: GOLD_STOPS, outline: '#2a0a00', depth: 3, maxW: W - 150, glow: '#ffb030' });
      return;
    }
    const tip = TIPS[Math.floor(this.time / 4) % TIPS.length];
    chunkyText(ctx, tip, W / 2, cy, 22, { fill: WHITE_STOPS, outline: '#06204a', depth: 2, rim: null, maxW: W - 150 });
  }

  /** The dark info bar: credits, bet, win, and the denomination button. */
  private drawBar() {
    const ctx = this.screen.ctx;
    const y = BAR_Y;
    const g = ctx.createLinearGradient(0, y, 0, H);
    g.addColorStop(0, '#1a1e2a');
    g.addColorStop(1, '#05060a');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, W, H - y);
    ctx.fillStyle = 'rgba(120,240,240,0.8)';
    ctx.fillRect(0, y, W, 3);
    const b = this.game.bonus;
    const win = b && this.inBonus ? (this.mode === 'bonusEnd' ? this.bonusShownTotal : b.won) : this.mode === 'showing' && this.out && !this.remote ? Math.max(this.shownWin, this.out.win > this.out.lineWin ? this.out.win : this.shownWin) : 0;
    const cols: [string, string, number][] = [
      ['CREDIT', money(Math.round((this.ctx.bankroll.balance - this.pendingWin) * 100) / 100), 24],
      ['BET', money(this.bonusBet), 250],
      ['WIN', win > 0 ? money(win) : '', 420],
    ];
    ctx.textBaseline = 'middle';
    for (const [label, v, x] of cols) {
      ctx.textAlign = 'left';
      ctx.font = `700 17px ${DISPLAY}`;
      ctx.fillStyle = '#8ad8e0';
      ctx.fillText(label, x, y + 22);
      ctx.font = `900 32px ${DISPLAY}`;
      ctx.fillStyle = label === 'WIN' ? '#ffd860' : '#ffffff';
      ctx.fillText(v, x, y + 56, label === 'CREDIT' ? 210 : 170);
      if (x > 24) {
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(x - 16, y + 12, 2, H - y - 24);
      }
    }
    // Denomination button: a little gold coin with 1¢ on it (tap to step the bet).
    const cx = W - 60,
      cy = y + 41;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 8;
    roundRect(ctx, cx - 50, cy - 36, 100, 72, 16);
    ctx.fillStyle = goldFrame(ctx, cy - 36, cy + 36);
    ctx.fill();
    ctx.restore();
    roundRect(ctx, cx - 44, cy - 30, 88, 60, 12);
    ctx.fillStyle = '#1a0e04';
    ctx.fill();
    chunkyText(ctx, '1¢', cx, cy - 4, 34, { fill: GOLD_STOPS, outline: '#2a1000', depth: 2, rim: null });
    ctx.font = `700 12px ${DISPLAY}`;
    ctx.fillStyle = '#ffe0a0';
    ctx.textAlign = 'center';
    ctx.fillText('DENOM', cx, cy + 22);
  }

  private drawFlicks() {
    const ctx = this.screen.ctx;
    for (const f of this.flicks) {
      const k = Math.min(1, f.t / f.dur);
      const e = easeOut(k);
      const x = f.x0 + (f.x1 - f.x0) * e;
      const y = f.y0 + (f.y1 - f.y0) * k - Math.sin(k * Math.PI) * 160;
      const s = 84 * (1 - k * 0.45);
      // A sparkly trail.
      for (let i = 1; i <= 4; i++) {
        const kk = Math.max(0, k - i * 0.05);
        const tx = f.x0 + (f.x1 - f.x0) * easeOut(kk),
          ty = f.y0 + (f.y1 - f.y0) * kk - Math.sin(kk * Math.PI) * 160;
        sparkle(ctx, tx, ty, 14 - i * 2.5, 0.8 - i * 0.15);
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(Math.abs(Math.cos(f.t * 14)) * 0.7 + 0.3, 1);
      ctx.drawImage(this.coinFace(f.color, f.hot), -s / 2, -s / 2, s, s);
      ctx.restore();
    }
  }

  private drawParticles() {
    const ctx = this.screen.ctx;
    this.floaters = this.floaters.filter((f) => this.time - f.at < 1.4);
    for (const f of this.floaters) {
      const a = this.time - f.at;
      ctx.save();
      ctx.globalAlpha = Math.min(1, (1.4 - a) * 2.5);
      chunkyText(ctx, f.text, f.x, f.y - a * 50, 26 + Math.min(1, a * 6) * 4, { fill: [[0, '#ffffff'], [0.5, '#ffffff'], [0.55, f.color], [1, f.color]], outline: '#1a0420', depth: 2, maxW: 220 });
      ctx.restore();
    }
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life);
      ctx.translate(p.x, p.y);
      ctx.scale(Math.cos(p.spin), 1);
      ctx.drawImage(this.coinFace(p.color), -p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    }
  }

  /** The free-games intro: a panel with the three modifiers, lit where they combine. */
  private drawIntro() {
    const ctx = this.screen.ctx;
    const b = this.game.bonus;
    if (!b) return;
    const age = this.time - (this.introUntil - 4.2);
    const pop = age < 0.3 ? easeOut(age / 0.3) * 1.08 : age < 0.45 ? 1.08 - ((age - 0.3) / 0.15) * 0.08 : 1;
    const fade = Math.min(1, (this.introUntil - this.time) * 3);
    ctx.save();
    ctx.globalAlpha = Math.max(0, fade);
    ctx.fillStyle = 'rgba(10,0,20,0.55)';
    ctx.fillRect(0, REELS_Y - 40, W, REELS_H + 80);
    ctx.translate(W / 2, REELS_Y + REELS_H / 2);
    ctx.scale(pop, pop);
    ctx.save();
    ctx.rotate(this.time * 0.5);
    ctx.fillStyle = 'rgba(255,220,120,0.16)';
    for (let i = 0; i < 18; i++) {
      ctx.rotate((Math.PI * 2) / 18);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(460, -40);
      ctx.lineTo(460, 40);
      ctx.fill();
    }
    ctx.restore();
    roundRect(ctx, -330, -190, 660, 380, 36);
    const g = ctx.createLinearGradient(0, -190, 0, 190);
    g.addColorStop(0, 'rgba(70,10,90,0.97)');
    g.addColorStop(1, 'rgba(16,2,30,0.97)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = goldFrame(ctx, -190, 190);
    ctx.stroke();
    chunkyText(ctx, 'FREE GAMES!', 0, -138, 64, { fill: PINK_STOPS, outline: '#2a0030', depth: 5, glow: '#ff70d0' });
    const feats = COLORS.filter((c) => b.features[c]);
    COLORS.forEach((c, i) => {
      const on = b.features[c];
      const cx = (i - 1) * 210,
        cy = 10;
      ctx.save();
      ctx.globalAlpha *= on ? 1 : 0.35;
      roundRect(ctx, cx - 96, cy - 80, 192, 168, 22);
      const cg = ctx.createLinearGradient(0, cy - 80, 0, cy + 88);
      cg.addColorStop(0, PIG_PALETTE[c][1]);
      cg.addColorStop(1, PIG_PALETTE[c][2]);
      ctx.fillStyle = cg;
      if (on) {
        ctx.shadowColor = PIG_PALETTE[c][0];
        ctx.shadowBlur = 24 + 10 * Math.sin(this.time * 6);
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 4;
      ctx.strokeStyle = on ? '#fff4c0' : 'rgba(255,255,255,0.4)';
      ctx.stroke();
      const sprite = this.pigArt[c].cheer;
      ctx.drawImage(sprite, cx - 40, cy - 92, 80, 80 * (sprite.height / sprite.width));
      if (c === 'blue') {
        chunkyText(ctx, on ? `${b.totalSpins}` : `${BASE_FREE_GAMES}`, cx, cy + 22, 48, { fill: WHITE_STOPS, outline: '#061650', depth: 3 });
        chunkyText(ctx, on ? 'FREE GAMES' : 'GAMES', cx, cy + 64, 22, { fill: GOLD_STOPS, outline: '#061650', depth: 2, rim: null, maxW: 176 });
      } else if (c === 'yellow') {
        chunkyText(ctx, 'JACKPOT', cx, cy + 22, 32, { fill: GOLD_STOPS, outline: '#3a1a00', depth: 3, maxW: 176 });
        chunkyText(ctx, on ? 'COINS ON!' : '—', cx, cy + 64, 22, { fill: WHITE_STOPS, outline: '#3a1a00', depth: 2, rim: null, maxW: 176 });
      } else {
        chunkyText(ctx, on ? `+${b.extraWilds}` : '—', cx, cy + 22, 48, { fill: WHITE_STOPS, outline: '#4a0008', depth: 3 });
        chunkyText(ctx, 'WILDS', cx, cy + 64, 22, { fill: GOLD_STOPS, outline: '#4a0008', depth: 2, rim: null });
      }
      ctx.restore();
    });
    chunkyText(ctx, feats.length > 1 ? `${feats.length} POTS COMBINED!` : `${PIG_NAMES[feats[0]]}'S POT!`, 0, 148, 30, { fill: GOLD_STOPS, outline: '#3a1a00', depth: 3, maxW: 600 });
    ctx.restore();
  }

  /** The free-games total, counting up, then tap to collect. */
  private drawSummary() {
    const ctx = this.screen.ctx;
    const b = this.game.bonus;
    if (!b) return;
    ctx.save();
    ctx.fillStyle = 'rgba(10,0,20,0.5)';
    ctx.fillRect(0, REELS_Y - 40, W, REELS_H + 80);
    ctx.translate(W / 2, REELS_Y + REELS_H / 2);
    roundRect(ctx, -320, -160, 640, 320, 36);
    const g = ctx.createLinearGradient(0, -160, 0, 160);
    g.addColorStop(0, 'rgba(10,60,90,0.97)');
    g.addColorStop(1, 'rgba(4,10,30,0.97)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = goldFrame(ctx, -160, 160);
    ctx.stroke();
    chunkyText(ctx, 'FREE GAMES WIN', 0, -104, 46, { fill: WHITE_STOPS, outline: '#06204a', depth: 4 });
    chunkyText(ctx, money(this.bonusShownTotal), 0, -10, 86, { fill: GOLD_STOPS, outline: '#2a0a00', depth: 6, glow: '#ffb030', maxW: 600 });
    const feats = COLORS.filter((c) => b.features[c]).map((c) => PIG_NAMES[c]);
    const jp = b.jackpotsWon.length ? ` · ${b.jackpotsWon.map((w) => JACKPOT_NAMES[w.jackpot]).join(' + ')}` : '';
    chunkyText(ctx, `${b.totalSpins} GAMES · ${feats.join(' + ')}${jp}`, 0, 68, 22, { fill: WHITE_STOPS, outline: '#06204a', depth: 2, rim: null, maxW: 600 });
    if (this.bonusCounted) {
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.time * 5);
      chunkyText(ctx, 'TAP TO COLLECT', 0, 120, 28, { fill: PINK_STOPS, outline: '#2a0030', depth: 2 });
    }
    ctx.restore();
  }

  private drawBanner() {
    const ctx = this.screen.ctx;
    const b0 = this.banner;
    if (!b0 || this.time > b0.until) return;
    const val = (v: string | (() => string) | undefined) => (typeof v === 'function' ? v() : v);
    const b = { ...b0, text: val(b0.text)!, sub: val(b0.sub), color: val(b0.color)! };
    const age = this.time - b.at;
    const pop = age < 0.25 ? easeOut(age / 0.25) * 1.15 : age < 0.4 ? 1.15 - ((age - 0.25) / 0.15) * 0.15 : 1;
    const fade = Math.min(1, (b.until - this.time) * 3);
    const cy = REELS_Y + 1.5 * CELL;
    if (b.big) {
      // Dim the game behind a BIG / MEGA / EPIC win.
      ctx.fillStyle = `rgba(6,0,10,${0.5 * fade})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(W / 2, cy);
    ctx.scale(pop, pop);
    if (b.big) ctx.rotate(Math.sin(this.time * 3) * 0.015);
    ctx.save();
    ctx.rotate(this.time * 0.6);
    for (let i = 0; i < 18; i++) {
      ctx.rotate((Math.PI * 2) / 18);
      ctx.fillStyle = hexA(b.color, 0.25);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(460, -44);
      ctx.lineTo(460, 44);
      ctx.fill();
    }
    ctx.restore();
    const bh = b.sub ? 200 : 140;
    roundRect(ctx, -330, -100, 660, bh, 40);
    const g = ctx.createLinearGradient(0, -100, 0, 100);
    g.addColorStop(0, 'rgba(50,6,40,0.95)');
    g.addColorStop(1, 'rgba(8,0,8,0.95)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = b.color;
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 30;
    ctx.stroke();
    ctx.shadowBlur = 0;
    const tint: [number, string][] = [
      [0, '#ffffff'],
      [0.45, '#ffffff'],
      [0.55, b.color],
      [1, b.color],
    ];
    chunkyText(ctx, b.text, 0, b.sub ? -34 : -30, b.big ? 84 : 70, { fill: tint, outline: '#1a0410', depth: 6, maxW: 620, glow: b.color });
    if (b.sub) chunkyText(ctx, b.sub, 0, 52, b.big ? 62 : 44, { fill: GOLD_STOPS, outline: '#1a0410', depth: 4, maxW: 620 });
    ctx.restore();
  }

  private drawInfo() {
    const ctx = this.screen.ctx;
    ctx.fillStyle = 'rgba(8,2,20,0.86)';
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'middle';
    chunkyText(ctx, this.infoPage === 0 ? 'THE PIGGY POTS' : 'PAYS', W / 2, 60, 50, { fill: PINK_STOPS, outline: '#2a0030', depth: 4 });
    const para = (y: number, color: string, head: string, lines: string[], pig?: CoinColor) => {
      let x = 36;
      if (pig) {
        const s = this.pigArt[pig].open;
        ctx.drawImage(s, 30, y - 30, 100, 100 * (s.height / s.width));
        x = 150;
      }
      ctx.textAlign = 'left';
      ctx.font = `900 28px ${DISPLAY}`;
      ctx.fillStyle = color;
      ctx.fillText(head, x, y, W - x - 24);
      ctx.font = `25px ${SERIF}`;
      ctx.fillStyle = '#f6e7d8';
      lines.forEach((l, i) => ctx.fillText(l, x, y + 38 + i * 31, W - x - 24));
    };
    if (this.infoPage === 0) {
      para(140, '#ffd86b', 'PIG COINS', ['Pig coins land on the reels and fly to the', 'Blue, Yellow or Red pig. Most fill its pot a', 'level; a ★ coin, or a full pot (9), sets it off.']);
      para(300, '#7ab8ff', 'SKIPPER · EXTRA FREE GAMES', ['6 free games, plus one per level', 'in his pot: up to 15.'], 'blue');
      para(440, '#ffd030', 'GOLDIE · JACKPOT FREE GAMES', ['Jackpot coins land in the free games.', 'Collect 3 of a jackpot to win it.'], 'yellow');
      para(580, '#ff7a7a', 'ROCCO · EXTRA WILDS', ['6 extra wilds plus one per level', '(up to 15) on reels 2–5.'], 'red');
      para(730, '#ffffff', 'COMBINE', ['When a pot goes off, the others can join in,', 'more often the fuller they are. Their bonuses', 'combine. Pots are kept per bet level.']);
      para(890, '#ffffff', 'JACKPOTS', ['Mini, Minor, Major, Grand and Mega grow with', 'every paid spin and reset when won.']);
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
      const x = 40 + col * 340,
        y = 110 + row * 118;
      ctx.drawImage(this.atlas.canvas, this.atlas.index.get(sym.id)! * CELL, 0, CELL, CELL, x, y, cell, cell);
      ctx.textAlign = 'left';
      ctx.font = `900 24px ${DISPLAY}`;
      ctx.fillStyle = '#ffffff';
      const p = sym.pays!;
      ctx.fillText(`5  ${p[5]}`, x + 112, y + 22);
      ctx.fillText(`4  ${p[4]}`, x + 112, y + 50);
      ctx.fillText(`3  ${p[3]}`, x + 112, y + 78);
    });
    const y = 740;
    ctx.drawImage(this.atlas.canvas, this.atlas.index.get('WILD')! * CELL, 0, CELL, CELL, 40, y, cell, cell);
    ctx.drawImage(this.coinFace('blue', true), 40, y + 120, cell, cell);
    ctx.textAlign = 'left';
    ctx.font = `25px ${SERIF}`;
    ctx.fillStyle = '#f6e7d8';
    ctx.fillText('The Surfboard WILD on reels 2–5 stands in', 156, y + 34, W - 190);
    ctx.fillText('for every paying symbol.', 156, y + 64, W - 190);
    ctx.fillText('Pig coins fill the pots. A ★ coin sets its', 156, y + 154, W - 190);
    ctx.fillText('pig off. Coins pay nothing on the lines.', 156, y + 184, W - 190);
    ctx.textAlign = 'center';
    ctx.font = `italic 21px ${SERIF}`;
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
          r.tease = false;
          const len = this.reelStrips[i].length;
          r.pos = ((Math.round(r.from - r.distance) % len) + len) % len;
          const coin = this.out!.grid[i].includes('COIN');
          this.ctx.sound.play(coin ? 'chip' : 'reelStop', this.screen.mesh, { volume: 0.7 });
        } else all = false;
      });
      this.reelLoop.set(all ? 0 : 0.5, 1);
      if (all) {
        this.settledAt = this.time;
        this.onAllStopped();
      }
    }
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

    // Jackpot meters tick up toward their values.
    const jp = this.game.bankFor().jackpots;
    const bet = this.bonusBet;
    let ticking = false;
    for (let j = 0; j < jp.length; j++) {
      const target = Math.round(jp[j] * bet * 100) / 100;
      const d = target - this.jpShown[j];
      if (Math.abs(d) < 0.005) this.jpShown[j] = target;
      else {
        ticking = true;
        this.jpShown[j] = d < 0 ? target : Math.min(target, this.jpShown[j] + Math.max(0.01, d * Math.min(1, dt * 2.5)));
      }
    }

    // Pigs: fatness follows the pot, squash-and-stretch gulps, wiggles, shakes.
    for (const c of COLORS) {
      const p = this.pig2[c];
      const target = this.fullness(c);
      p.fat += (target - p.fat) * Math.min(1, dt * 5);
      p.squash = Math.max(0, p.squash - dt * 2.5);
      p.shake = Math.max(0, p.shake - dt);
      p.glow = Math.max(0, p.glow - dt);
      p.wiggle = Math.max(0, p.wiggle - dt * 1.6);
      p.cheer = Math.max(0, p.cheer - dt);
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
      q.mat.emissiveIntensity = q.party > 0 || inBonus ? 0.35 + 0.25 * Math.sin(this.time * 8) : f > 0.75 ? 0.12 + 0.08 * Math.sin(this.time * 3) : 0;
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

    // Edge light: slow turquoise breathing; rainbow chase in free games and wins.
    const hot = this.inBonus || (this.mode === 'showing' && this.shownWin > 0);
    if (hot) this.led.color.setHSL((this.time * 0.5) % 1, 0.9, 0.55);
    else this.led.color.setHSL(0.48, 0.85, 0.45 + 0.1 * Math.sin(this.time * 1.5));

    const rate = this.mode === 'spinning' ? 14 : hot ? 24 : 4;
    const phase = Math.floor(this.time * rate);
    if (phase !== this.bulbPhase) {
      this.bulbPhase = phase;
      for (let i = 0; i < this.bulbs.count; i++) this.bulbs.setColorAt(i, (i + phase) % 3 === 0 ? this.bulbOff : this.bulbOn);
      this.bulbs.instanceColor!.needsUpdate = true;
    }

    // Redraw the screen when anything on it moves: 30 fps for the action, and
    // a gentle 12 fps for idle life (bobbing pigs, twinkles) only while someone
    // nearby can see it. Kind to Quest.
    const action =
      this.mode === 'spinning' ||
      this.mode === 'intro' ||
      this.mode === 'free' ||
      this.mode === 'bonusEnd' ||
      this.flicks.length > 0 ||
      this.particles.length > 0 ||
      this.bursts.length > 0 ||
      this.floaters.length > 0 ||
      (!!this.banner && this.time < this.banner.until + 0.2) ||
      (this.mode === 'showing' && this.winTimer < 30) ||
      COLORS.some((c) => this.pig2[c].squash > 0 || this.pig2[c].shake > 0 || this.pig2[c].wiggle > 0 || Math.abs(this.pig2[c].fat - this.fullness(c)) > 0.002);
    const watched = this.time - this.seenAt < 0.5 && this.seenDist < 6;
    const idleLife = watched && this.mode !== 'info';
    this.redrawClock += dt;
    const every = action ? 1 / 30 : ticking || idleLife ? 1 / 12 : Infinity;
    if (this.dirty || this.redrawClock >= every) {
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

/** A plane bowed toward the viewer at top and bottom (a gently curved portrait screen); UVs as a flat plane. */
function curvedPanel(w: number, h: number, bulge: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, 1, 32);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) / h) * 2;
    pos.setZ(i, bulge * t * t);
  }
  g.computeVertexNormals();
  return g;
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

