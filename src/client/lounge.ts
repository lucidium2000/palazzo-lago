import * as THREE from 'three';
import { allLayers } from './cull';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { GameContext } from './game';
import type { Grabbable, Hand, Hands } from './hands';
import { bakeStatic, dynamic } from './merge';
import { assets } from './assets';
import { textSign } from './panel';
import type { Crowd, Person } from './people';
import { randomLook, staffLook } from './people';
import type { Player } from './player';
import { marble, onyx, radial, toTexture, wood } from './textures';
import { SEAT_R, type World } from './world';
import { BARS, BarMenuCard, buildVrMenu, DRINKS, PREP_TIME, SportsTicker, TIP, type BarId, type DrinkKind } from './bar';
import { lagoCounter, ROUND_TOP, roundCounter, type Counter } from './barcounter';
import type { Listener } from './listen';
import { matchMenu, menuVocabulary, yesNo } from './understand';
import { DRINK_ALIASES } from './replylex';
import type { CanvasPanel } from './panel';
import type { Viewpoint } from './player';
import { voiceArbiter } from './dialogue';
import { BARTENDER_LINES, CHEERS_LINES, STAFF, guestVoice, orderLine } from './speech';
import { mouthOf, voices } from './voices';
import { characterFor, elVoice } from './cast';
import type { Throwables } from './throwables';

/**
 * The lounge: Bar Lago along the west wall (order a drink, hold it, sip it),
 * armchairs with guests, and a grand piano with a pianist playing live.
 */

export interface LoungeDeps extends GameContext {
  crowd: Crowd;
  hands: Hands;
  player: Player;
  world: World;
  /** Throwing physics (glasses fly, land, break). */
  throwables: Throwables;
}

/** Something your friend should see happen to a drink (two-player). */
export type DrinkEvent =
  | { k: 'take'; id: string }
  | { k: 'put'; id: string; p: number[] }
  | { k: 'throw'; id?: string; kind: number; level: number; p: number[]; q: number[]; v: number[] }
  /** `z`: the spot along the counter (Bar Lago's z, the angle round the pool bar); `bar`: which bar (Bar Lago if left out). */
  | { k: 'order'; kind: number; z: number; bar?: BarId }
  | { k: 'sip' }
  /** A new glass in the world (taken off a table display or out of a guest's hand): `from` names where (stock.ts). */
  | { k: 'spawn'; id: string; kind: number; level: number; p: number[]; from?: string };

const drink = (name: string) => DRINKS.find((d) => d.name === name)!;
/** Bar Lago's counter: where the bartender pours, where drinks wait for you, the taps. */
const LAGO = lagoCounter();
const POUR_X = LAGO.pourAt(0).x;
const TAP_Z = LAGO.tapSpot!;

/**
 * A bar you can order at (Bar Lago, the pool bar): its counter, its bartender,
 * its menus, and the drink she's making (one at a time; friends' orders queue).
 */
interface Station {
  c: Counter;
  title: string;
  menu: DrinkKind[];
  bartender: Person | null;
  /** The spot along the counter she's heading for. */
  work: number;
  /** The drink being made: the glass fills on the bartender's side, then slides to you. */
  pour: { kind: DrinkKind; s: number; pourS: number; t: number; total: number; glass: Drink; forNpc: boolean } | null;
  slide: { drink: Drink; from: THREE.Vector3; to: THREE.Vector3; t: number; forNpc: boolean; s: number } | null;
  /** Her bottle (or shaker) and the stream of the pour. */
  bottle: THREE.Group;
  stream: THREE.Mesh;
  card: BarMenuCard;
  vrMenu: CanvasPanel;
  /** Regulars on her stools (their spots), who order now and then. */
  patrons: number[];
  npcOrderIn: number;
  npcDrinks: Map<number, Drink>;
  /** Friends' orders waiting while she finishes another drink, and where the last one was served. */
  friendOrders: { kind: DrinkKind; s: number }[];
  friendServe: number | null;
  /** Your order, waiting while she finishes someone else's drink. */
  yours: { kind: DrinkKind; s: number } | null;
}

const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  roughness: 0.04,
  metalness: 0,
  transparent: true,
  opacity: 0.28,
  envMapIntensity: 2.2,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const mats = new Map<string, THREE.Material>();
function liquidMat(color: number, clear = true): THREE.Material {
  const key = `${color}-${clear}`;
  let m = mats.get(key);
  if (!m) {
    m = clear
      ? new THREE.MeshStandardMaterial({ color, roughness: 0.1, transparent: true, opacity: 0.82, emissive: color, emissiveIntensity: 0.12 })
      : new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    mats.set(key, m);
  }
  return m;
}
const iceMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, roughness: 0.1 });
/** Paper cups (the food court's sodas), by colour. */
const cupMats = new Map<number, THREE.Material>();
function cupMat(color: number) {
  let m = cupMats.get(color);
  if (!m) cupMats.set(color, (m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, side: THREE.DoubleSide })));
  return m;
}

export class Drink {
  readonly group = new THREE.Group();
  level = 1;
  /** Shared id for drinks both players see in the same place (two-player). */
  id: string | null = null;
  /** Shown for your friend (their glass): pours and splashes, but isn't yours to grab. */
  remote = false;
  /** Every glass in the game (physics checks the ones currently in the scene). */
  static readonly all = new Set<Drink>();
  /** Height of the rim above the glass's base, and its radius. */
  get rimHeight() {
    return this.liquidTop + 0.012;
  }
  get rimRadius() {
    return this.topR;
  }
  /** The drink's colour. */
  get color() {
    return this.mixed ?? this.kind.liquid;
  }
  /** What's in it after pouring something else in (a mix of colours), if anything was. */
  private mixed: number | null = null;
  /** What's been poured into it, by the liquid's colour (glass-fulls): mixing drinks reads this. */
  readonly poured = new Map<number, number>();

  /**
   * Pours some of another drink in (glass-fulls): the level rises and the colour mixes by how much
   * of each is in there. Returns how much fitted (the rest runs over the rim).
   */
  addLiquid(amount: number, color: number): number {
    const room = Math.max(0, 1 - this.level);
    const add = Math.min(room, amount);
    if (add <= 0) return 0;
    this.poured.set(color, (this.poured.get(color) ?? 0) + add);
    const was = this.level;
    const c = this.level > 0.02 ? new THREE.Color(this.color).lerp(new THREE.Color(color), add / (was + add)) : new THREE.Color(color);
    this.mixed = c.getHex();
    const m = this.liquid.material as THREE.MeshPhysicalMaterial;
    if (!this.ownLiquid) {
      this.liquid.material = m.clone();
      this.ownLiquid = true;
    }
    (this.liquid.material as THREE.MeshPhysicalMaterial).color.copy(c);
    this.setLevel(was + add);
    return add;
  }
  /** The mixed colour, if something else was poured in (null: still the drink's own). */
  get mixedColor(): number | null {
    return this.mixed;
  }

  /** Shows the drink as a given mix (a friend's glass after they poured into it). */
  tint(color: number | null) {
    if (color === this.mixed) return;
    if (color === null) {
      this.mixed = null;
      if (this.ownLiquid) (this.liquid.material as THREE.MeshPhysicalMaterial).color.setHex(this.kind.liquid);
      return;
    }
    this.mixed = color;
    if (!this.ownLiquid) {
      this.liquid.material = (this.liquid.material as THREE.Material).clone();
      this.ownLiquid = true;
    }
    (this.liquid.material as THREE.MeshPhysicalMaterial).color.setHex(color);
  }
  private ownLiquid = false;
  private liquid: THREE.Mesh;
  private liquidTop: number;
  private liquidBottom: number;
  private topR = 0.04;
  private foam: THREE.Mesh | null = null;
  private ice: THREE.Mesh[] = [];

  constructor(readonly kind: DrinkKind) {
    Drink.all.add(this);
    this.group.userData.loose = true;
    const profile: Record<DrinkKind['glass'], [number, number][]> = {
      rocks: [[0, 0], [0.042, 0], [0.044, 0.004], [0.046, 0.09], [0.044, 0.09], [0.042, 0.008], [0, 0.008]],
      flute: [[0, 0], [0.035, 0], [0.036, 0.004], [0.005, 0.01], [0.004, 0.1], [0.022, 0.13], [0.028, 0.21], [0.026, 0.21], [0.02, 0.13], [0, 0.11]],
      martini: [[0, 0], [0.04, 0], [0.04, 0.004], [0.005, 0.01], [0.004, 0.1], [0.06, 0.16], [0.058, 0.16], [0, 0.104]],
      coupe: [[0, 0], [0.04, 0], [0.005, 0.01], [0.004, 0.09], [0.05, 0.12], [0.06, 0.14], [0.058, 0.14], [0, 0.095]],
      pint: [[0, 0], [0.034, 0], [0.035, 0.006], [0.045, 0.15], [0.043, 0.15], [0.033, 0.012], [0, 0.012]],
      shot: [[0, 0], [0.022, 0], [0.023, 0.004], [0.026, 0.06], [0.024, 0.06], [0.019, 0.01], [0, 0.01]],
      cup: [[0, 0], [0.03, 0], [0.031, 0.004], [0.04, 0.125], [0.038, 0.125], [0.029, 0.006], [0, 0.006]],
      hurricane: [[0, 0], [0.034, 0], [0.034, 0.006], [0.01, 0.014], [0.008, 0.04], [0.03, 0.06], [0.038, 0.1], [0.031, 0.14], [0.036, 0.18], [0.042, 0.205], [0.04, 0.205], [0.034, 0.18], [0.029, 0.14], [0.036, 0.1], [0.028, 0.062], [0, 0.046]],
    };
    const pts = profile[kind.glass].map(([r, y]) => new THREE.Vector2(r, y));
    this.topR = { rocks: 0.04, flute: 0.026, martini: 0.055, coupe: 0.055, pint: 0.042, shot: 0.024, cup: 0.038, hurricane: 0.04 }[kind.glass];
    const glass = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), kind.glass === 'cup' ? cupMat(kind.cup ?? 0xf2f2f2) : glassMat);
    if (kind.glass !== 'cup') glass.renderOrder = 2;
    this.group.add(glass);
    const shapes: Record<DrinkKind['glass'], () => [THREE.BufferGeometry, number, number]> = {
      rocks: () => [new THREE.CylinderGeometry(0.04, 0.039, 1, 18).translate(0, 0.5, 0), 0.01, 0.07],
      flute: () => [new THREE.CylinderGeometry(0.024, 0.017, 1, 14).translate(0, 0.5, 0), 0.115, 0.19],
      martini: () => [new THREE.CylinderGeometry(0.052, 0.004, 1, 18).translate(0, 0.5, 0), 0.105, 0.15],
      coupe: () => [new THREE.CylinderGeometry(0.05, 0.01, 1, 18).translate(0, 0.5, 0), 0.096, 0.13],
      pint: () => [new THREE.CylinderGeometry(0.042, 0.033, 1, 18).translate(0, 0.5, 0), 0.013, 0.13],
      shot: () => [new THREE.CylinderGeometry(0.023, 0.019, 1, 14).translate(0, 0.5, 0), 0.011, 0.05],
      cup: () => [new THREE.CylinderGeometry(0.037, 0.029, 1, 16).translate(0, 0.5, 0), 0.008, 0.115],
      hurricane: () => [new THREE.CylinderGeometry(0.032, 0.026, 1, 16).translate(0, 0.5, 0), 0.05, 0.19],
    };
    const [geo, bottom, top] = shapes[kind.glass]();
    this.liquidBottom = bottom;
    this.liquidTop = top;
    // Frozen drinks are a thick slush: opaque, not see-through.
    this.liquid = new THREE.Mesh(geo, liquidMat(kind.liquid, !kind.frozen));
    this.liquid.renderOrder = 1;
    this.group.add(this.liquid);
    if (kind.ice) {
      for (const [x, y, z, r] of [[0.008, 0.05, 0.004, 0.4], [-0.012, 0.035, -0.008, 1.1]]) {
        const ice = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.028, 0.028), iceMat);
        ice.position.set(x, y, z);
        ice.rotation.set(r, 0.6, 0.2);
        this.group.add(ice);
        this.ice.push(ice);
      }
    }
    if (kind.foam) {
      this.foam = new THREE.Mesh(new THREE.CylinderGeometry(this.topR * 0.97, this.topR * 0.95, 0.014, 18), liquidMat(kind.glass === 'pint' || kind.glass === 'cup' ? 0xf6f0e0 : 0xc89a6a, false));
      this.group.add(this.foam);
    }
    if (kind.garnish) {
      const g = new THREE.Mesh(
        kind.glass === 'martini' ? new THREE.SphereGeometry(0.01, 8, 6) : new THREE.TorusGeometry(0.022, 0.006, 6, 16, Math.PI),
        liquidMat(kind.garnish, false),
      );
      if (kind.glass === 'martini') g.position.set(0.01, 0.135, 0);
      else if (kind.glass === 'hurricane') {
        g.position.set(0.036, 0.2, 0);
        g.rotation.set(0, 0, -1.2);
      } else if (kind.glass === 'coupe') {
        g.position.set(0.05, 0.135, 0);
        g.rotation.set(0, 0, -1.2);
      } else {
        g.position.set(0.04, 0.085, 0);
        g.rotation.set(0, 0, -1.2);
      }
      this.group.add(g);
    }
    this.setLevel(1);
  }

  setLevel(l: number) {
    this.level = Math.max(0, l);
    const h = (this.liquidTop - this.liquidBottom) * this.level;
    this.liquid.visible = this.level > 0.02;
    this.liquid.scale.set(1, Math.max(0.001, h), 1);
    this.liquid.position.y = this.liquidBottom;
    if (this.foam) {
      this.foam.visible = this.level > 0.05;
      this.foam.position.y = this.liquidBottom + h + 0.004;
    }
    for (const i of this.ice) i.visible = this.level > 0.08 || i.position.y < 0.04;
  }

  /** Standard drinks still in the glass. */
  get units() {
    return this.kind.alcohol * this.level;
  }
}

export class Lounge {
  readonly bar = new THREE.Group();
  readonly piano = new THREE.Group();
  /** The grand piano's keyboard frame (see piano.ts), its soundboard, the pianist and his music. */
  readonly keyFrame = new THREE.Object3D();
  readonly soundboard = new THREE.Object3D();
  pianist: Person | null = null;
  pianoLoop: THREE.PositionalAudio | null = null;
  /** The back bar's shelves of bottles (one instanced draw; stock.ts makes each one takeable). */
  backBottles: THREE.InstancedMesh | null = null;
  /** The bars you can order at (Bar Lago; the pool bar once the pool's built: addPoolBar). */
  private stations = new Map<BarId, Station>();
  private get lago(): Station {
    return this.stations.get('lago')!;
  }
  /** The bar whose menu is up (or was last), and the spot along its counter. */
  private menuAt: Station | null = null;
  private waiting: Drink | null = null;
  /** The drink you are carrying on desktop. */
  private desktopDrink: Drink | null = null;
  private sipCooldown = 0;
  private falling: { obj: THREE.Object3D; v: number; floor: number }[] = [];
  private raycaster = allLayers(new THREE.Raycaster());
  onOrder: (() => void) | null = null;
  onTip: (() => void) | null = null;
  onRound: (() => void) | null = null;
  private roundPending = 0;
  private ticker = new SportsTicker();
  private menuZ = 9;
  private tipped = 0;
  /** The glass in your VR hand, if any. */
  private vrHeld: Drink | null = null;
  private cheersCooldown = 0;
  private cheersHintShown = false;
  /** Alcohol in your system (standard drinks); it wears off over time. */
  private units = 0;
  private tipsyStage = 0;
  private time = 0;
  /** Bar stools you can sit on. */
  readonly seats: Viewpoint[] = [];
  /** You got tipsy (stage 1, 2, 3): the crew comments. */
  onTipsy: ((stage: number) => void) | null = null;
  /** You clinked glasses (with a guest; the game wires your friend too). */
  onCheers: ((at: THREE.Vector3) => void) | null = null;
  /** Listens for a drink ordered out loud while the menu is up (main.ts sets it). */
  listener: Listener | null = null;
  private orderListen = 0;
  private orderListening = false;

  static readonly COUNTER_X = -15.0;
  static readonly COUNTER_Z0 = 6.2;
  static readonly COUNTER_Z1 = 12.4;
  static readonly TOP = 1.1;

  /** On the guests' side of the bar counter, close enough to be served across it. */
  static nearBar(x: number, z: number): boolean {
    const dz = z < Lounge.COUNTER_Z0 ? Lounge.COUNTER_Z0 - z : z > Lounge.COUNTER_Z1 ? z - Lounge.COUNTER_Z1 : 0;
    const dx = x - Lounge.COUNTER_X;
    return dx > 0 && dx < 2.2 && dz < 0.8;
  }

  constructor(private d: LoungeDeps) {
    d.scene.add(this.bar, this.piano);
    addEventListener('keyup', (e) => {
      if (e.code === 'KeyP') this.pouringDesktop = false;
    });
    this.stations.set('lago', this.makeStation(LAGO));
    this.buildBar();
    this.buildSeating();
    this.buildPiano();
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyQ') this.putDownDesktop();
      if (e.code === 'KeyX') this.throwHeld();
      if (e.code === 'KeyP') this.pouringDesktop = true;
      if (e.code === 'KeyF' && this.desktopDrink) this.sip(this.desktopDrink);
      if (e.code === 'KeyG') this.tryCheers();
    });
  }

  // ---------------------------------------------------------------------------
  // Bar Lago
  // ---------------------------------------------------------------------------

  /** A bar's working parts: her bottle and pour stream, its menus (a card on screens, a panel on the top in VR). */
  private makeStation(c: Counter, bartender: Person | null = null): Station {
    const { title, menu } = BARS[c.id];
    const bottle = new THREE.Group();
    const bottleBody = new THREE.Mesh(
      new THREE.LatheGeometry([[0, 0], [0.03, 0], [0.031, 0.16], [0.012, 0.21], [0.01, 0.25], [0, 0.25]].map(([r, y]) => new THREE.Vector2(r, y)), 12),
      new THREE.MeshStandardMaterial({ color: 0x2a5a1a, roughness: 0.1, transparent: true, opacity: 0.9, envMapIntensity: 2 }),
    );
    bottleBody.rotation.x = Math.PI / 2;
    bottle.add(bottleBody);
    bottle.visible = false;
    const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.005, 1, 6, 1, true).translate(0, -0.5, 0), new THREE.MeshStandardMaterial({ color: 0xffaa44, transparent: true, opacity: 0.75, roughness: 0.1 }));
    stream.visible = false;
    stream.raycast = () => {};
    this.d.scene.add(stream);
    // (The VR menu draws its status line as it's built, before the station exists.)
    let made: Station | null = null;
    const st: Station = {
      c,
      title,
      menu,
      bartender,
      work: c.clamp(c.id === 'lago' ? 9 : 0),
      pour: null,
      slide: null,
      bottle,
      stream,
      card: new BarMenuCard(title, menu, c.id === 'lago' ? 'bar-menu' : `bar-menu-${c.id}`),
      vrMenu: buildVrMenu(
        (k) => this.order(this.menuZ, k, c.id),
        () => this.tipBartender(c.id),
        () => (made?.pour && !made.pour.forNpc ? `Making your ${made.pour.kind.name}…` : this.waiting ? 'Your drink is on the bar' : 'Point at a drink and pull the trigger'),
        menu,
        title,
      ),
      patrons: [],
      npcOrderIn: 18,
      npcDrinks: new Map(),
      friendOrders: [],
      friendServe: null,
      yours: null,
    };
    made = st;
    st.vrMenu.mesh.visible = false;
    st.vrMenu.register(this.d.interaction);
    this.d.scene.add(st.vrMenu.mesh);
    st.card.onPick = (k) => this.order(this.menuZ, k, c.id);
    st.card.onTip = () => this.tipBartender(c.id);
    return st;
  }

  /** The bartender walks along (or round) her side of the counter to the spot she's working, and wipes it down now and then. */
  private tend(st: Station, p: Person, dt: number) {
    const w = st.c.workAt(st.work);
    const dx = w.x - p.pos.x,
      dz = w.z - p.pos.z;
    const dist = Math.hypot(dx, dz);
    const v = Math.min(1, dist * 2);
    if (dist > 1e-3) {
      const step = Math.min(dist, v * dt);
      p.pos.x += (dx / dist) * step;
      p.pos.z += (dz / dist) * step;
    }
    p.moving = v;
    p.walkPhase += v * dt * 5;
    if (st.c.id !== 'lago') {
      // Round the island: she keeps facing out over the counter.
      const a = st.c.spotAt(p.pos.x, p.pos.z);
      const yaw = st.c.workAt(a).yaw;
      p.yaw = yaw;
      p.homeYaw = yaw;
    }
    if (p.action <= 0 && Math.random() < 0.002) {
      p.actionKind = 'wipe';
      p.action = 3;
    }
  }

  /**
   * The pool bar becomes a bar you can order at: the same menus (its poolside
   * list), the same bartender's lines, drinks made and served on its round
   * counter. `bartender`: the pool's bartender (areas/poolguests.ts adds her).
   */
  addPoolBar(bar: { x: number; z: number; r: number }, bartender: Person | null) {
    if (this.stations.has('pool')) return;
    const c = roundCounter('pool', bar);
    const st = this.makeStation(c, bartender);
    this.stations.set('pool', st);
    if (bartender) {
      // She starts facing the deck (toward the pool), and works round the ring from there.
      st.work = c.spotAt(bartender.pos.x, bartender.pos.z);
      bartender.onUpdate = (p, dt) => this.tend(st, p, dt);
    }
    // Regulars on the stools order now and then too.
    for (const p of this.d.crowd.people) {
      if (p.role !== 'patron') continue;
      const d = Math.hypot(p.pos.x - bar.x, p.pos.z - bar.z);
      if (d > ROUND_TOP.outer && d < ROUND_TOP.outer + 0.7) st.patrons.push(c.spotAt(p.pos.x, p.pos.z));
    }
    st.npcOrderIn = 25;
    // Ordering: point at / click the counter top (a thin ring; glasses standing on it stay clickable).
    const ring = new THREE.Mesh(new THREE.RingGeometry(ROUND_TOP.inner, ROUND_TOP.outer + 0.02, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ visible: false }));
    ring.position.set(bar.x, ROUND_TOP.y + 0.006, bar.z);
    this.d.scene.add(ring);
    this.d.interaction.register({
      object: ring,
      kind: 'button',
      enabled: () => !this.d.player.inXR,
      label: () => (this.makingMine() ? 'Your drink is being made…' : this.waiting ? 'Your drink is on the bar' : 'Order a drink · see the pool bar menu'),
      onSelect: (e) => this.openMenu(c.spotAt(e.hit.point.x, e.hit.point.z), 'pool'),
    });
  }

  /** Whether you're standing at a bar's counter (where you can order), and which. */
  barAt(x: number, z: number): BarId | null {
    for (const st of this.stations.values()) if (st.c.near(x, z)) return st.c.id;
    return null;
  }

  /** Is your own drink being made (at any bar)? */
  private makingMine(): Station | null {
    for (const st of this.stations.values()) if (st.yours || (st.pour && !st.pour.forNpc) || (st.slide && !st.slide.forNpc)) return st;
    return null;
  }

  private buildBar() {
    const { world, crowd } = this.d;
    const q = this.d.quality;
    const woodTex = toTexture(wood(512));
    woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
    woodTex.repeat.set(2, 6);
    const woodMat = assets.material('walnut', { repeat: [2, 6], rough: 0.6, fallback: () => new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.35 }) });
    const top = assets.material('darkmarble', { repeat: [1, 6], rough: 0.25, envIntensity: 1.4, fallback: () => new THREE.MeshStandardMaterial({ map: toTexture(marble(512, 'dark', 21)), roughness: 0.08, envMapIntensity: 1.4 }) });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 1, roughness: 0.25 });
    const leather = assets.material('leather', { repeat: 1, rough: 0.8, tint: 0x8a5050, fallback: () => new THREE.MeshStandardMaterial({ color: 0x3a1015, roughness: 0.5 }) });
    const glow = new THREE.MeshBasicMaterial({ color: 0xffb860 });
    const x = Lounge.COUNTER_X,
      z0 = Lounge.COUNTER_Z0,
      z1 = Lounge.COUNTER_Z1;
    const len = z1 - z0,
      zc = (z0 + z1) / 2;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      this.bar.add(m);
      return m;
    };
    // Counter: wooden body with gold-trimmed panels, a dark marble top, a brass foot rail.
    add(new THREE.BoxGeometry(0.6, 1.05, len), woodMat, x, 0.525, zc);
    for (let k = 0; k < 6; k++) add(new THREE.BoxGeometry(0.01, 0.7, len / 6 - 0.16), gold, x + 0.305, 0.55, z0 + (k + 0.5) * (len / 6));
    add(new RoundedBoxGeometry(0.78, 0.06, len + 0.12, 2, 0.02), top, x + 0.05, Lounge.TOP - 0.03, zc);
    const rail = add(new THREE.CylinderGeometry(0.025, 0.025, len, 10), gold, x + 0.42, 0.2, zc);
    rail.rotation.x = Math.PI / 2;
    // Under-counter glow strip on the guest side.
    add(new THREE.BoxGeometry(0.02, 0.02, len), glow, x + 0.31, 1.0, zc);

    // Back bar: cabinet, backlit wall, three glass shelves of bottles.
    const wallX = -17.8;
    add(new THREE.BoxGeometry(0.5, 0.95, len), woodMat, wallX + 0.25, 0.475, zc);
    add(new THREE.BoxGeometry(0.55, 0.04, len), top, wallX + 0.27, 0.97, zc);
    // Backlit honey onyx behind the bottles: glows through the stone's bands, brightest in the middle.
    const backOnyx = toTexture(onyx(512, 128, 13));
    const back = add(new THREE.PlaneGeometry(len, 1.6), new THREE.MeshBasicMaterial({ map: backOnyx, color: new THREE.Color(0.82, 0.7, 0.56) }), wallX + 0.03, 1.85, zc);
    back.rotation.y = Math.PI / 2;
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.05, envMapIntensity: 2 });
    const shelves = [1.3, 1.72, 2.14];
    for (const y of shelves) add(new THREE.BoxGeometry(0.3, 0.015, len - 0.2), shelfMat, wallX + 0.17, y, zc);
    for (const z of [z0 + 0.05, z1 - 0.05]) add(new THREE.BoxGeometry(0.34, 1.6, 0.06), woodMat, wallX + 0.17, 1.85, z);
    // Bottles: instanced, varied colours and heights.
    const bottleGeo = new THREE.LatheGeometry(
      [
        [0, 0],
        [0.035, 0],
        [0.036, 0.2],
        [0.03, 0.23],
        [0.012, 0.27],
        [0.012, 0.33],
        [0, 0.33],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      12,
    );
    const perShelf = Math.floor((len - 0.4) / 0.11);
    const bottles = new THREE.InstancedMesh(bottleGeo, new THREE.MeshStandardMaterial({ roughness: 0.08, envMapIntensity: 2, transparent: true, opacity: 0.9 }), shelves.length * perShelf);
    const colors = [0x2a5a1a, 0x6a3a0a, 0xd8d0b0, 0x8a1010, 0x1a2a4a, 0xc08a20, 0x3a0a20, 0xe8e8f0];
    const tmp = new THREE.Object3D();
    let n = 0;
    shelves.forEach((y, si) => {
      for (let k = 0; k < perShelf; k++) {
        tmp.position.set(wallX + 0.17 + ((k * 7) % 3 - 1) * 0.05, y + 0.008, z0 + 0.25 + k * 0.11);
        tmp.scale.set(1, 0.8 + ((k * 13 + si * 5) % 7) * 0.06, 1);
        tmp.updateMatrix();
        bottles.setMatrixAt(n, tmp.matrix);
        bottles.setColorAt(n++, new THREE.Color(colors[(k * 5 + si * 3) % colors.length]));
      }
    });
    bottles.name = 'back-bar-bottles';
    // Every one can be taken (stock.ts: point at it, or click it, and the bartender hands it over).
    bottles.computeBoundingSphere();
    this.backBottles = bottles;
    this.bar.add(bottles);
    // A backlit onyx feature wall rising behind the back bar, framed in gold.
    {
      const onyxTex = toTexture(onyx(768, 288, 7));
      const panel = add(new THREE.PlaneGeometry(len - 0.4, 2.0), new THREE.MeshBasicMaterial({ map: onyxTex, color: new THREE.Color(1.0, 0.92, 0.82) }), wallX + 0.04, 3.9, zc);
      panel.rotation.y = Math.PI / 2;
      const frameMat = new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 1, roughness: 0.3 });
      for (const y of [2.88, 4.92]) add(new THREE.BoxGeometry(0.06, 0.06, len - 0.3), frameMat, wallX + 0.06, y, zc);
      for (const z of [z0 + 0.15, z1 - 0.15]) add(new THREE.BoxGeometry(0.06, 2.1, 0.06), frameMat, wallX + 0.06, 3.9, z);
    }
    const sign = textSign('Bar Lago', { width: 2.4, px: 140, bg: 'rgba(24,14,8,0.82)' });
    sign.position.set(wallX + 0.12, 3.9, zc);
    sign.rotation.y = Math.PI / 2;
    this.bar.add(sign);

    // Stools along the guest side.
    const stoolZ = [6.9, 8.1, 9.3, 10.5, 11.7];
    // Free stools are seats: sit, lean on the bar and order.
    stoolZ.forEach((z, i) => {
      if (i === 0 || i === 3) return; // regulars sit here
      this.seats.push({ id: `bar-stool-${i}`, label: 'Bar stool', position: new THREE.Vector3(x + 0.62, 0, z), yaw: Math.PI / 2, pitch: -0.28, eye: 1.42, back: 0 });
    });
    this.lago.patrons = [stoolZ[0], stoolZ[3]];
    // Sportsbook TV hanging over the near end of the bar.
    this.ticker.group.position.set(x - 0.15, 2.55, z0 + 0.35);
    this.ticker.group.rotation.y = Math.PI / 2;
    dynamic(this.ticker.group);
    this.bar.add(this.ticker.group);
    const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 8), gold);
    mount.position.set(x - 0.18, 3.45, z0 + 0.35);
    this.bar.add(mount);
    // A beer tap tower on the bartender's side.
    const chrome = new THREE.MeshStandardMaterial({ color: 0xdadde2, metalness: 1, roughness: 0.15 });
    add(new THREE.CylinderGeometry(0.035, 0.04, 0.32, 14), chrome, POUR_X, Lounge.TOP + 0.16, TAP_Z);
    add(new THREE.BoxGeometry(0.06, 0.05, 0.3), chrome, POUR_X, Lounge.TOP + 0.33, TAP_Z);
    for (const dz of [-0.09, 0, 0.09]) {
      add(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 6), chrome, POUR_X + 0.03, Lounge.TOP + 0.29, TAP_Z + dz);
      add(new THREE.CylinderGeometry(0.012, 0.009, 0.12, 8), new THREE.MeshStandardMaterial({ color: [0x7a1a10, 0xd4a94e, 0x1a3a6a][Math.round(dz / 0.09) + 1], roughness: 0.4 }), POUR_X + 0.01, Lounge.TOP + 0.42, TAP_Z + dz);
    }
    for (const z of stoolZ) {
      add(new THREE.CylinderGeometry(0.2, 0.18, 0.08, 20), leather, x + 0.6, 0.78, z);
      add(new THREE.CylinderGeometry(0.025, 0.025, 0.74, 8), gold, x + 0.6, 0.38, z);
      add(new THREE.TorusGeometry(0.15, 0.012, 6, 20).rotateX(Math.PI / 2), gold, x + 0.6, 0.3, z);
      add(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 20), gold, x + 0.6, 0.015, z);
      world.addSeat(x + 0.6, z, SEAT_R, 0.82, -Math.PI / 2, 'bar stool');
    }
    void q;
    bakeStatic(this.bar);

    // Colliders: the counter, and the space behind it is staff only.
    world.addBox(x + 0.05, zc, 0.9, len + 0.2, 0, 'bar');
    world.addBox(-16.5, zc, 2.6, len + 0.2, 0, 'bar');

    // Bartender and a few regulars.
    const lago = this.lago;
    lago.bartender = crowd.add('bartender', staffLook('bar'), new THREE.Vector3(-16.0, 0, 9), Math.PI / 2);
    if (lago.bartender) lago.bartender.onUpdate = (p, dt) => this.tend(lago, p, dt);
    for (const z of [stoolZ[0], stoolZ[3]]) {
      const pat = crowd.add('patron', randomLook(), new THREE.Vector3(x + 0.62, 0, z), -Math.PI / 2);
      if (pat) {
        pat.seatY = 0.8;
        pat.onUpdate = (p) => {
          if (p.action <= 0 && Math.random() < 0.003) {
            p.actionKind = 'sip';
            p.action = 1.4;
          }
        };
      }
    }

    // A little tent card on the bar: buy the boys a round.
    const cardTex = (() => {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 160;
      const g = c.getContext('2d')!;
      g.fillStyle = '#f6eedc';
      g.fillRect(0, 0, 256, 160);
      g.strokeStyle = '#b8862c';
      g.lineWidth = 6;
      g.strokeRect(6, 6, 244, 148);
      g.fillStyle = '#5a1a20';
      g.textAlign = 'center';
      g.font = 'italic bold 34px Georgia, serif';
      g.fillText('Buy a Round', 128, 62);
      g.font = '24px Georgia, serif';
      g.fillText('for the crew · $80', 128, 108);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const card = new THREE.Group();
    const cardMat = new THREE.MeshStandardMaterial({ map: cardTex, roughness: 0.6, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), cardMat);
      face.rotation.set(s * 0.35, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      face.rotation.order = 'YXZ';
      face.rotation.set(-0.35 * s, Math.PI / 2, 0);
      face.position.set(s * 0.017, 0.05, 0);
      card.add(face);
    }
    card.position.set(x + 0.3, Lounge.TOP, zc + 1.0);
    card.rotation.y = 0;
    this.d.scene.add(card);
    this.d.interaction.register({
      object: card,
      label: () => (this.roundPending > 0 ? 'A round is on its way…' : 'Buy the boys a round · $80 (four drinks, tip included)'),
      onSelect: () => this.buyRound(),
    });

    // Tip cup at the far end of the counter: a tip makes the bartender your friend.
    const cup = new THREE.Group();
    const cupGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.12, 14, 1, true), glassMat);
    cupGlass.position.y = 0.06;
    const cash = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.05, 10), new THREE.MeshStandardMaterial({ color: 0x5a8a4a, roughness: 0.8 }));
    cash.position.y = 0.03;
    const cupHit = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.16), new THREE.MeshBasicMaterial({ visible: false }));
    cupHit.position.y = 0.08;
    cup.add(cupGlass, cash, cupHit);
    cup.position.set(x + 0.22, Lounge.TOP, z1 - 0.35);
    this.d.scene.add(cup);
    this.d.interaction.register({ object: cup, label: () => 'Tip the bartender $5', onSelect: () => this.tipBartender() });

    // Ordering: point at / click the bar top.
    // A thin strip on the bar top (glasses standing on it stay clickable).
    const counterHit = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.03, len), new THREE.MeshBasicMaterial({ visible: false }));
    counterHit.position.set(x + 0.05, Lounge.TOP - 0.005, zc);
    this.d.scene.add(counterHit);
    this.d.interaction.register({
      object: counterHit,
      kind: 'button',
      enabled: () => !this.d.player.inXR,
      label: () => (this.makingMine() ? 'Your drink is being made…' : this.waiting ? 'Your drink is on the bar' : 'Order a drink · see the menu'),
      onSelect: (e) => this.openMenu(e.hit.point.z, 'lago'),
    });
  }

  /** Opens a bar's menu (screens) for a spot along its counter; the bartender greets you. */
  openMenu(z: number, bar: BarId = 'lago') {
    const st = this.stations.get(bar);
    if (!st) return;
    if (this.makingMine()) {
      this.d.hud.toast('Your drink is being made…', 'info');
      return;
    }
    if (this.waiting) {
      this.d.hud.toast('Your drink is waiting on the bar', 'info');
      return;
    }
    for (const o of this.stations.values()) if (o !== st) o.card.close();
    this.menuAt = st;
    this.menuZ = st.c.clamp(z);
    st.work = this.menuZ;
    this.greet(this.tipped > 0 ? BARTENDER_LINES.regular : BARTENDER_LINES.hello, false, st);
    st.card.show();
    this.listenForOrder();
  }

  /** Is a menu up (the card on screens, the panel on the bar in VR)? */
  get menuOpen() {
    for (const st of this.stations.values()) if (st.card.open || st.vrMenu.mesh.visible) return true;
    return false;
  }

  /** The bar you'd order from now: the one whose menu is up, else the counter you're standing at, else the nearest bartender's. */
  private stationForYou(): Station {
    if (this.menuOpen && this.menuAt) return this.menuAt;
    const f = this.d.player.feet();
    const at = this.barAt(f.x, f.z);
    if (at) return this.stations.get(at)!;
    let best = this.lago,
      bd = Infinity;
    for (const st of this.stations.values()) {
      const b = st.bartender;
      const dist = b ? b.pos.distanceTo(f) : Infinity;
      if (dist < bd) {
        bd = dist;
        best = st;
      }
    }
    return best;
  }

  /**
   * A drink you asked for out loud ("can I get an old fashioned", "a beer
   * please", "surprise me"): the bartender makes it. False if it didn't name a
   * drink on the menu.
   */
  voiceOrder(heard: string): boolean {
    const st = this.stationForYou();
    let menu = st.menu;
    let m = matchMenu(heard, menu.map((d) => d.name), DRINK_ALIASES);
    if (m === null) {
      // Not on this bar's menu, but the other bar's: she has the bottles, she'll make it.
      menu = DRINKS.filter((d) => !d.offMenu);
      m = matchMenu(heard, menu.map((d) => d.name), DRINK_ALIASES);
      if (m === 'surprise') m = null;
    }
    if (m === null) return false;
    const pool = menu.filter((d) => d.alcohol > 0);
    const kind = m === 'surprise' ? pool[Math.floor(Math.random() * pool.length)] : menu[m];
    const f = this.d.player.feet();
    const z = this.menuOpen && this.menuAt === st ? this.menuZ : st.c.spotAt(f.x, f.z);
    st.card.close();
    this.order(z, kind, st.c.id);
    return true;
  }

  /** While the menu is up, the bartender listens for your order (after her hello). */
  private listenForOrder(tries = 2) {
    const l = this.listener;
    if (!l?.enabled) return;
    const id = ++this.orderListen;
    const menu = (this.menuAt ?? this.lago).menu;
    setTimeout(() => {
      if (id !== this.orderListen || !this.menuOpen || this.makingMine() || this.waiting || l.state !== 'idle') return;
      this.orderListening = true;
      void l.listen(menuVocabulary(menu.map((d) => d.name), DRINK_ALIASES), 8).then((heard) => {
        if (id === this.orderListen) this.orderListening = false;
        if (id !== this.orderListen || !heard || !this.menuOpen || this.makingMine() || this.waiting) return;
        if (this.voiceOrder(heard)) return;
        if (yesNo(heard) === 'no') return;
        this.d.hud.toast('Say a drink from the menu (or pick one)', 'info');
        if (tries > 1) this.listenForOrder(tries - 1);
      });
    }, 1300);
  }

  /** Someone at the bar said a line to you (your friends nearby hear it too: net/npcsync.ts). */
  onLine: ((p: Person, l: { text: string; voice: string; alt?: string; who: string }) => void) | null = null;

  /** The bartender talks to you (her own voice, from behind the bar). */
  private greet(line: string, force = false, st: Station = this.lago) {
    if (!force && voiceArbiter.busy()) return;
    const b = st.bartender;
    if (b) this.onLine?.(b, { text: line, voice: elVoice('bartender'), alt: STAFF.bartender, who: 'Bartender' });
    const dur = voices.talk({ who: 'Bartender', text: line, voice: elVoice('bartender'), alt: STAFF.bartender, at: b ? mouthOf(b) : null, priority: true, group: 'bartender', fallback: { pitch: 1.1, rate: 1.02, voice: 2 } });
    if (b) this.d.crowd.speak(b, dur);
    voiceArbiter.claim(dur);
  }

  /** Orders a drink: Strip prices plus a tip. (Cocktail servers comp you only while you gamble.) */
  order(z: number, kind: DrinkKind = DRINKS[0], bar: BarId = 'lago') {
    const st = this.stations.get(bar);
    if (!st) return;
    if (this.makingMine() || this.waiting) {
      this.d.hud.toast(this.waiting ? 'Your drink is waiting on the bar' : 'Your drink is being made…', 'info');
      return;
    }
    const cost = kind.price + TIP;
    if (!this.d.bankroll.canAfford(cost)) {
      this.d.hud.toast('Not enough chips for a drink', 'warn');
      return;
    }
    this.d.bankroll.debit(cost, 'bet', 'bar');
    if (this.orderListening) this.listener?.stop();
    this.orderListen++;
    const s = st.c.clamp(z);
    this.menuAt = st;
    // She may be finishing a regular's (or a friend's) drink: yours is next.
    if (st.pour || st.slide) st.yours = { kind, s };
    else this.startPour(st, kind, s, false);
    this.onDrinkEvent?.({ k: 'order', kind: DRINKS.indexOf(kind), z: Math.round(s * 100) / 100, ...(bar !== 'lago' ? { bar } : {}) });
    this.greet(kind.line ?? orderLine(kind.name, kind.prep), true, st);
    this.onOrder?.();
  }

  /** The bartender makes a drink: walks over, shakes or pours, the glass fills, then slides it along. */
  private startPour(st: Station, kind: DrinkKind, s: number, forNpc: boolean) {
    const c = st.c;
    const pourS = kind.prep === 'tap' && c.tapSpot !== null ? c.tapSpot : s;
    const total = PREP_TIME[kind.prep] * (this.tipped > 0 ? 0.75 : 1);
    const glass = new Drink(kind);
    glass.setLevel(0);
    glass.group.position.copy(c.pourAt(pourS));
    this.d.scene.add(glass.group);
    st.pour = { kind, s, pourS, t: 0, total, glass, forNpc };
    st.work = pourS;
    const bt = st.bartender;
    if (bt) {
      bt.actionKind = 'pour';
      bt.action = total;
      const wrist = bt.rig?.bones['WristR'];
      if (wrist && kind.prep !== 'tap') {
        wrist.add(st.bottle);
        st.bottle.position.set(0, 0.08, 0.04);
        st.bottle.visible = true;
        const body = st.bottle.children[0] as THREE.Mesh;
        const m = body.material as THREE.MeshStandardMaterial;
        m.color.set(kind.prep === 'shake' ? 0xc8ccd2 : kind.alcohol ? 0x6a3a0a : 0x2a5a1a);
        m.metalness = kind.prep === 'shake' ? 1 : 0;
      }
    }
    (st.stream.material as THREE.MeshStandardMaterial).color.set(kind.prep === 'tap' ? 0xe8b040 : kind.liquid);
    const at = c.pourAt(pourS).add(new THREE.Vector3(0, 0.2, 0));
    if (kind.prep === 'shake') this.d.sound.play('shaker', at, { volume: forNpc ? 0.35 : 0.7 });
    setTimeout(() => this.d.sound.play('pour', at, { volume: forNpc ? 0.4 : 0.8 }), total * 450);
  }

  buyRound() {
    if (this.roundPending > 0) return;
    if (!this.d.bankroll.canAfford(80)) {
      this.d.hud.toast('Not enough chips for a round', 'warn');
      return;
    }
    this.d.bankroll.debit(80, 'bet', 'bar');
    this.roundPending = 2.6;
    const bt = this.lago.bartender;
    if (bt) {
      bt.actionKind = 'pour';
      bt.action = 2.6;
    }
    this.d.sound.play('shaker', new THREE.Vector3(-16, 1.2, this.lago.work), { volume: 0.7 });
    this.d.hud.toast('“A round for the gentlemen, coming right up.”', 'info');
  }

  /** The finished glass arrives in front of you (or a regular). */
  private served(st: Station, drink: Drink, forNpc: boolean, z: number) {
    this.d.sound.play('clink', drink.group, { volume: 0.6 });
    if (forNpc) {
      // The last glass at that spot goes (unless someone picked it up or it's flying).
      const old = st.npcDrinks.get(z);
      if (old && old.group.parent === this.d.scene && !this.d.throwables.flying(old.group)) old.group.removeFromParent();
      st.npcDrinks.set(z, drink);
      // Guests' drinks on the bar can be picked up too.
      this.makeTakeable(drink);
      return;
    }
    this.waiting = drink;
    this.d.hud.toast(`${drink.kind.name} · pick it up from the bar${drink.kind.glass === 'shot' ? ' (one go!)' : ''}`, 'win');
    this.makeTakeable(drink);
  }

  /** $5 in the tip cup: the bartender remembers you (faster drinks, warmer welcome). */
  tipBartender(bar: BarId = 'lago') {
    const st = this.stations.get(bar) ?? this.lago;
    if (!this.d.bankroll.canAfford(5)) {
      this.d.hud.toast('Not enough chips to tip', 'warn');
      return;
    }
    this.d.bankroll.debit(5, 'bet', 'tip');
    this.tipped++;
    const at = bar === 'lago' ? new THREE.Vector3(Lounge.COUNTER_X + 0.22, Lounge.TOP, Lounge.COUNTER_Z1 - 0.35) : st.c.serveAt(st.work);
    this.d.sound.play('chip', at, { volume: 0.7 });
    this.greet(this.tipped === 1 ? BARTENDER_LINES.tip1 : BARTENDER_LINES.tipMore, false, st);
    if (st.bartender) st.bartender.cheer = 0.8;
  }

  /**
   * Makes a drink sitting somewhere pick-up-able: click on desktop, grab in VR.
   * `opts.on` says where else it may rest and still be taken (a waiter's tray),
   * besides standing loose in the scene; `opts.label` is the click label there.
   */
  /** Sets an (empty) glass down in the world, ready to pick up, pour into and drink (the suite's minibar). */
  placeGlass(kind: DrinkKind, at: THREE.Vector3, id: string): Drink {
    const d = new Drink(kind);
    d.group.position.copy(at);
    d.setLevel(0);
    d.id = id;
    this.drinks.set(d.id, d);
    this.d.scene.add(d.group);
    this.makeTakeable(d);
    return d;
  }

  /**
   * A new real glass standing at `at` (taken off a display, out of a guest's
   * hand: see stock.ts), ready to grab, sip, pour and throw. Your friends get it
   * too, with the same id, and `from` (where it came from) so it leaves there.
   */
  spawnDrink(kind: DrinkKind, at: THREE.Vector3, id: string, level: number, from?: string): { drink: Drink; grab: Grabbable } {
    const d = new Drink(kind);
    d.group.position.copy(at);
    d.setLevel(level);
    d.id = id;
    this.drinks.set(id, d);
    this.d.scene.add(d.group);
    const grab = this.makeTakeable(d);
    const k = DRINKS.indexOf(kind);
    this.onDrinkEvent?.({ k: 'spawn', id, kind: k, level: Math.round(level * 10) / 10, p: round(at.toArray(), 3), ...(from ? { from } : {}) });
    return { drink: d, grab };
  }

  /** Clears a glass away (the busboy: too many standing about). False if someone has it or it's flying. */
  clearDrink(d: Drink): boolean {
    if (d.group.parent !== this.d.scene || this.holder(d) || this.d.throwables.flying(d.group)) return false;
    d.group.removeFromParent();
    if (d.id) {
      this.onDrinkEvent?.({ k: 'take', id: d.id });
      this.drinks.delete(d.id);
    }
    return true;
  }

  /** A friend took a glass from somewhere (stock.ts hides it there). */
  onSpawnFrom: ((from: string) => void) | null = null;

  /** Your hands are full (desktop: a drink or something else in your hand). */
  get handsFull() {
    return !!this.desktopDrink || this.otherHeld();
  }

  private makeTakeable(drink: Drink, opts: { on?: () => boolean; label?: string } = {}): Grabbable {
    const resting = () => drink.group.parent === this.d.scene || !!opts.on?.();
    // One interactable covers both states: on a surface (pick it up) and in your hand (sip).
    this.d.interaction.register({
      object: drink.group,
      kind: 'button',
      enabled: () => this.desktopDrink === drink || (resting() && !this.desktopDrink && !this.otherHeld()),
      label: () =>
        this.desktopDrink === drink
          ? drink.level > 0
            ? 'Sip (F)'
            : 'Empty glass · Q to set it down'
          : opts.label && opts.on?.()
            ? opts.label
            : `Pick up the ${drink.kind.name}`,
      onSelect: (e) => {
        // VR: point at a glass and pull the trigger, and it comes to a free hand.
        if (e.source === 'xr') {
          if (resting() && !this.holder(drink)) {
            if (this.handOver(drink, grab) && drink.id) this.onDrinkEvent?.({ k: 'take', id: drink.id });
          }
          return;
        }
        if (this.desktopDrink === drink) this.sip(drink);
        else this.pickUpDesktop(drink);
      },
    });
    const grab: Grabbable = {
      at: () => drink.group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.06, 0)),
      radius: 0.12,
      enabled: resting,
      grab: () => {
        if (this.waiting === drink) this.waiting = null;
        this.falling = this.falling.filter((f) => f.obj !== drink.group);
        // Caught out of the air.
        this.d.throwables.catch(drink.group);
        this.vrHeld = drink;
        if (drink.id) this.onDrinkEvent?.({ k: 'take', id: drink.id });
        return drink.group;
      },
      drag: (hand, pos) => {
        // Bring it to your mouth to sip.
        if (this.sipCooldown <= 0 && pos.distanceTo(this.d.hands.head) < 0.2 && drink.level > 0) {
          this.sip(drink);
          this.d.hands.onHaptic?.(hand, 0.2, 30);
        }
      },
      release: (hand, _pos, carried) => {
        if (this.vrHeld === drink) this.vrHeld = null;
        if (!carried) return;
        // Let go while moving: it flies (your hand's speed, a touch of extra so throws feel right).
        const v = this.d.hands.velocity(hand);
        if (v.length() > 1.2) this.throwDrink(drink, v.multiplyScalar(1.15));
        else this.drop(carried, drink);
      },
    };
    this.d.hands.register(grab);
    return grab;
  }

  /** Two-player: what happened to a drink (wired to the session). */
  onDrinkEvent: ((e: DrinkEvent) => void) | null = null;

  /** Throws a glass: it flies, lands, maybe breaks. `remote`: your friend threw it (don't echo). */
  throwDrink(drink: Drink, v: THREE.Vector3, remote = false) {
    const g = drink.group;
    if (g.parent !== this.d.scene) this.d.scene.attach(g);
    if (this.desktopDrink === drink) this.desktopDrink = null;
    if (this.vrHeld === drink) this.vrHeld = null;
    if (this.waiting === drink) this.waiting = null;
    this.falling = this.falling.filter((f) => f.obj !== g);
    if (!remote)
      this.onDrinkEvent?.({ k: 'throw', id: drink.id ?? undefined, kind: DRINKS.indexOf(drink.kind), level: Math.round(drink.level * 10) / 10, p: round(g.position.toArray(), 3), q: round(g.quaternion.toArray(), 2), v: round(v.toArray(), 2) });
    this.d.throwables.throw(g, v, {
      fragile: true,
      radius: 0.045,
      liquid: drink.level > 0.05 ? drink.kind.liquid : null,
      onSettle: () => {
        if (!remote && drink.id) this.onDrinkEvent?.({ k: 'put', id: drink.id, p: round(g.position.toArray(), 3) });
      },
      onBreak: () => {
        if (this.drinks.has(drink.id ?? '')) this.drinks.delete(drink.id!);
      },
    });
  }

  /** Drinks with shared ids (the ones on the lounge tables). */
  private drinks = new Map<string, Drink>();

  /** Your friend did something to a drink: show it here. */
  friendDrink(e: DrinkEvent) {
    if (e.k === 'spawn') {
      const kind = DRINKS[e.kind];
      if (!kind || typeof e.id !== 'string' || e.id.length > 60 || this.drinks.has(e.id) || !Array.isArray(e.p) || e.p.length !== 3 || !e.p.every(Number.isFinite)) return;
      const d = new Drink(kind);
      d.group.position.fromArray(e.p);
      d.setLevel(THREE.MathUtils.clamp(Number(e.level) || 0, 0, 1));
      d.id = e.id;
      this.drinks.set(e.id, d);
      this.d.scene.add(d.group);
      this.makeTakeable(d);
      if (typeof e.from === 'string' && e.from.length < 60) this.onSpawnFrom?.(e.from);
      return;
    }
    if (e.k === 'take') {
      const dr = this.drinks.get(e.id);
      if (dr) {
        this.d.throwables.catch(dr.group);
        dr.group.removeFromParent();
      }
    } else if (e.k === 'put') {
      const dr = this.drinks.get(e.id);
      if (dr && e.p.length === 3 && e.p.every(Number.isFinite)) {
        this.d.scene.add(dr.group);
        dr.group.position.fromArray(e.p);
        dr.group.rotation.set(0, dr.group.rotation.y, 0);
      }
    } else if (e.k === 'throw') {
      const kind = DRINKS[e.kind];
      if (!kind || e.p.length !== 3 || e.v.length !== 3 || ![...e.p, ...e.v].every(Number.isFinite)) return;
      let dr = e.id ? this.drinks.get(e.id) : undefined;
      if (!dr) {
        dr = new Drink(kind);
        this.makeTakeable(dr);
      }
      dr.setLevel(Number(e.level) || 0);
      this.d.scene.add(dr.group);
      dr.group.position.fromArray(e.p);
      if (e.q?.length === 4) dr.group.quaternion.fromArray(e.q).normalize();
      this.throwDrink(dr, new THREE.Vector3().fromArray(e.v), true);
    } else if (e.k === 'order') {
      const kind = DRINKS[e.kind];
      const st = this.stations.get(e.bar === 'pool' ? 'pool' : 'lago');
      if (!kind || !st) return;
      const n = Number(e.z);
      const s = st.c.clamp(Number.isFinite(n) ? n : st.work);
      // The bartender may be pouring yours: theirs is next (never skipped).
      if (st.pour || st.slide) st.friendOrders.push({ kind, s });
      else {
        st.friendServe = s;
        this.startPour(st, kind, s, true);
      }
    }
  }

  /** Your friend picked up the drink they ordered (`kind`, if known): it leaves the counter here. */
  friendPickedUp(kind?: number) {
    for (const st of this.stations.values()) {
      if (st.friendServe === null) continue;
      const dr = st.npcDrinks.get(st.friendServe);
      if (kind !== undefined && dr && DRINKS.indexOf(dr.kind) !== kind) continue;
      if (dr && dr.group.parent === this.d.scene) dr.group.removeFromParent();
      st.npcDrinks.delete(st.friendServe);
      st.friendServe = null;
      return;
    }
  }

  /** The drink you're holding (for your friend's view): kind, level, which hand. */
  heldDrink(): { kind: number; level: number; side: 'l' | 'r'; pouring: boolean; mixed: number | null } | null {
    const tipped = (dr: Drink) => dr.level > 0.01 && new THREE.Vector3(0, 1, 0).applyQuaternion(dr.group.getWorldQuaternion(new THREE.Quaternion())).y < 0.17;
    if (this.desktopDrink) return { kind: DRINKS.indexOf(this.desktopDrink.kind), level: this.desktopDrink.level, side: 'r', pouring: tipped(this.desktopDrink), mixed: this.desktopDrink.mixedColor };
    if (this.vrHeld) {
      const h = this.d.hands.hands.find((x) => x.carried === this.vrHeld!.group);
      return { kind: DRINKS.indexOf(this.vrHeld.kind), level: this.vrHeld.level, side: h?.ctrl.userData.handedness === 'left' ? 'l' : 'r', pouring: tipped(this.vrHeld), mixed: this.vrHeld.mixedColor };
    }
    return null;
  }

  /** Who holds a glass: one of your VR hands, your desktop hand, or nobody. */
  holder(drink: Drink): { hand: Hand | null; desktop: boolean } | null {
    if (this.desktopDrink === drink) return { hand: null, desktop: true };
    const h = this.d.hands.hands.find((x) => x.carried === drink.group);
    return h ? { hand: h, desktop: false } : null;
  }

  /** A glass was smashed (against another, or on someone): forget it everywhere. */
  forget(drink: Drink) {
    if (this.desktopDrink === drink) this.desktopDrink = null;
    if (this.vrHeld === drink) this.vrHeld = null;
    if (this.waiting === drink) this.waiting = null;
    for (const h of this.d.hands.hands)
      if (h.carried === drink.group) {
        h.carried = null;
        h.held = null;
        h.ctrl.userData.grabbing = false;
      }
    this.falling = this.falling.filter((f) => f.obj !== drink.group);
    if (drink.id) this.drinks.delete(drink.id);
  }

  /** Desktop: hold P to tip your glass forward and pour it out. */
  pouringDesktop = false;

  /** Desktop/phone: throw the drink you're holding where you're looking. */
  throwHeld() {
    const drink = this.desktopDrink;
    if (!drink) return;
    const cam = this.d.player.camera;
    cam.updateMatrixWorld(true);
    const g = drink.group;
    this.d.scene.attach(g);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    const v = dir.multiplyScalar(7).add(new THREE.Vector3(0, 2.2, 0));
    this.throwDrink(drink, v);
  }

  /** A waiter hands you a glass of champagne. */
  offerChampagne() {
    const drink = new Drink(DRINKS.find((d) => d.section === 'Champagne')!);
    this.d.scene.add(drink.group);
    if (!this.handOver(drink, this.makeTakeable(drink))) drink.group.removeFromParent();
  }

  /**
   * A glass on a waiter's tray: grab it off the tray in VR (or click it on
   * desktop) and it's an ordinary drink in your hand, to sip, pour and throw.
   * `onTray` says whether it's still standing on the tray.
   */
  trayGlass(drink: Drink, onTray: () => boolean): Grabbable {
    return this.makeTakeable(drink, { on: onTray, label: `Take a ${drink.kind.name} from the tray` });
  }

  /**
   * Puts a glass straight into your hand (a free VR hand, or your desktop hand,
   * setting down what you held). False if there was no hand for it.
   */
  handOver(drink: Drink, grab: Grabbable): boolean {
    if (this.d.player.inXR) {
      if (!this.d.hands.give(drink.group, grab)) return false;
      if (this.waiting === drink) this.waiting = null;
      this.d.throwables.catch(drink.group);
      this.vrHeld = drink;
      this.d.sound.play('clink', drink.group, { volume: 0.4 });
      return true;
    }
    if (this.desktopDrink) this.putDownDesktop();
    this.pickUpDesktop(drink);
    return this.desktopDrink === drink;
  }

  /** Sip the glass you are holding (phone button / F key). */
  sipHeld() {
    if (this.desktopDrink) this.sip(this.desktopDrink);
  }

  get holdingDrink() {
    return !!this.desktopDrink;
  }

  /** Desktop: your hand is already full with something else (a bottle, a chip). */
  otherHeld: () => boolean = () => false;

  /** A swig straight from a bottle (counts like a drink). */
  swig(units: number) {
    if (this.sipCooldown > 0) return false;
    this.sipCooldown = 1.2;
    this.drank(units);
    this.d.sound.playLocal('gulp', 0.6);
    this.onDrinkEvent?.({ k: 'sip' });
    return true;
  }

  private pickUpDesktop(drink: Drink) {
    if (this.desktopDrink || this.d.player.inXR || this.otherHeld()) return;
    if (this.waiting === drink) this.waiting = null;
    this.d.throwables.catch(drink.group);
    this.desktopDrink = drink;
    if (drink.id) this.onDrinkEvent?.({ k: 'take', id: drink.id });
    this.d.player.camera.add(drink.group);
    drink.group.position.set(0.2, -0.2, -0.42);
    drink.group.rotation.set(0.15, 0, 0);
    this.d.sound.play('clink', drink.group, { volume: 0.4 });
    this.d.hud.toast(`Holding a ${drink.kind.name} · F to sip · Q to set it down · X to throw`, 'info');
  }

  private sip(drink: Drink) {
    if (this.sipCooldown > 0 || drink.level <= 0) return;
    this.sipCooldown = 1.4;
    const before = drink.units;
    // Shots go down in one; everything else in sips.
    drink.setLevel(drink.kind.glass === 'shot' ? 0 : drink.level - 0.2);
    this.drank(before - drink.units);
    if (drink.kind.glass === 'shot' && voices.captions) this.d.hud.say('You', 'Woo!');
    this.d.sound.playLocal('sip', 0.6);
    this.onDrinkEvent?.({ k: 'sip' });
    if (this.desktopDrink === drink) {
      const g = drink.group;
      g.position.set(0.05, -0.08, -0.22);
      g.rotation.set(0.9, 0, 0);
      setTimeout(() => {
        if (this.desktopDrink === drink) {
          g.position.set(0.2, -0.2, -0.42);
          g.rotation.set(0.15, 0, 0);
        }
      }, 700);
    }
    if (drink.level <= 0) this.d.hud.toast(`That was a fine ${drink.kind.name}.`, 'info');
  }

  private putDownDesktop() {
    const drink = this.desktopDrink;
    if (!drink) return;
    this.desktopDrink = null;
    const cam = this.d.player.camera;
    const at = new THREE.Vector3(0, -0.1, -0.6).applyMatrix4(cam.matrixWorld);
    this.d.scene.add(drink.group);
    drink.group.position.copy(at);
    drink.group.rotation.set(0, 0, 0);
    this.drop(drink.group, drink);
  }

  /** Lets go of a glass: it drops onto whatever surface is below it. */
  private drop(obj: THREE.Object3D, drink?: Drink) {
    obj.rotation.set(0, obj.rotation.y, 0);
    const origin = obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.05, 0));
    this.raycaster.set(origin, new THREE.Vector3(0, -1, 0));
    this.raycaster.far = 3;
    this.raycaster.camera = this.d.player.camera; // sprites need it to raycast
    const hits = this.raycaster
      .intersectObjects(this.d.scene.children, true)
      .filter((h) => h.object.visible && !isInside(h.object, obj) && (h.object as THREE.Mesh).isMesh && !(h.object as THREE.InstancedMesh).isInstancedMesh);
    const floor = hits.length ? hits[0].point.y : 0;
    this.falling.push({ obj, v: 0, floor });
    if (drink?.id) this.onDrinkEvent?.({ k: 'put', id: drink.id, p: round([origin.x, floor, origin.z], 3) });
  }

  // ---------------------------------------------------------------------------
  // Lounge seating
  // ---------------------------------------------------------------------------

  private buildSeating() {
    const g = new THREE.Group();
    this.d.scene.add(g);
    const velvet = assets.material('velvet', { repeat: 2, tint: 0x9a3048, rough: 1, fallback: () => new THREE.MeshStandardMaterial({ color: 0x5a1a2a, roughness: 0.85 }) });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 1, roughness: 0.3 });
    const top = assets.material('marble', { repeat: 1, rough: 0.3, normal: 0.4, fallback: () => new THREE.MeshStandardMaterial({ map: toTexture(marble(256, 'cream', 31)), roughness: 0.1 }) });
    const tables: [number, number][] = [
      [-11.6, 11.4],
      [-11.4, 8.2],
    ];
    const chairGeo = {
      seat: new RoundedBoxGeometry(0.62, 0.18, 0.6, 2, 0.05),
      back: new RoundedBoxGeometry(0.62, 0.5, 0.16, 2, 0.05),
      arm: new RoundedBoxGeometry(0.12, 0.26, 0.6, 2, 0.04),
    };
    const chair = (x: number, z: number, yaw: number) => {
      const c = new THREE.Group();
      const s = new THREE.Mesh(chairGeo.seat, velvet);
      s.position.y = 0.36;
      const b = new THREE.Mesh(chairGeo.back, velvet);
      b.position.set(0, 0.68, -0.24);
      const a1 = new THREE.Mesh(chairGeo.arm, velvet);
      a1.position.set(-0.3, 0.52, 0);
      const a2 = a1.clone();
      a2.position.x = 0.3;
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.26, 0.56), velvet);
      base.position.y = 0.14;
      c.add(s, b, a1, a2, base);
      c.position.set(x, 0, z);
      c.rotation.y = yaw;
      g.add(c);
      this.d.world.addLocalBox(c, 0, -0.01, 0.72, 0.64, 'armchair');
    };
    tables.forEach(([x, z], i) => {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.04, 28), top);
      t.position.set(x, 0.62, z);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.6, 10), gold);
      stem.position.set(x, 0.31, z);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.03, 20), gold);
      foot.position.set(x, 0.015, z);
      g.add(t, stem, foot);
      this.d.world.addCircle(x, z, 0.38, 'cocktail table');
      chair(x - 0.85, z, Math.PI / 2);
      chair(x + 0.85, z, -Math.PI / 2);
      // A couple chatting at the first table, a single guest at the second.
      const pa = this.d.crowd.add('patron', randomLook(), new THREE.Vector3(x - 0.78, 0, z), Math.PI / 2);
      if (pa) {
        pa.seatY = 0.5;
        pa.onUpdate = (p) => {
          if (p.action <= 0 && Math.random() < 0.002) {
            p.actionKind = 'sip';
            p.action = 1.4;
          }
          p.headYaw = Math.sin(performance.now() / 1700 + p.seed) * 0.3;
        };
      }
      if (i === 0) {
        const pb = this.d.crowd.add('patron', randomLook(), new THREE.Vector3(x + 0.78, 0, z), -Math.PI / 2);
        if (pb) pb.seatY = 0.5;
      }
      // Drinks on the table (real ones: pick them up, sip, throw them).
      for (const dx of [-0.15, 0.17]) {
        const d = new Drink(dx > 0 ? drink('Champagne') : drink('Negroni'));
        d.group.position.set(x + dx, 0.64, z + (dx > 0 ? 0.08 : -0.06));
        d.setLevel(0.6);
        d.id = `lt${i}${dx > 0 ? 'b' : 'a'}`;
        this.drinks.set(d.id, d);
        this.d.scene.add(d.group);
        this.makeTakeable(d);
      }
    });
    bakeStatic(g);
  }

  // ---------------------------------------------------------------------------
  // Grand piano
  // ---------------------------------------------------------------------------

  private buildPiano() {
    const g = this.piano;
    g.position.set(-6.4, 0, 10.4);
    g.rotation.y = -0.5;
    const q = this.d.quality;
    const lacquer = new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.12, clearcoat: q.name === 'desktop' ? 1 : 0, envMapIntensity: 1.6 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 1, roughness: 0.25 });
    // Body outline (local XZ): straight side on the left, curved bentside on the right.
    const shape = new THREE.Shape();
    shape.moveTo(-0.74, 0.0);
    shape.lineTo(-0.74, 1.75);
    shape.bezierCurveTo(-0.74, 2.1, -0.2, 2.15, -0.05, 1.8);
    shape.bezierCurveTo(0.15, 1.3, 0.74, 1.0, 0.74, 0.55);
    shape.lineTo(0.74, 0.0);
    shape.closePath();
    const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, curveSegments: 24 });
    bodyGeo.rotateX(Math.PI / 2); // shape Y -> world -Z... (tail extends away from the keyboard)
    bodyGeo.scale(1, 1, -1);
    const body = new THREE.Mesh(bodyGeo, lacquer);
    body.position.y = 0.94;
    g.add(body);
    // Inside: gold harp plate and felt.
    const plate = new THREE.Mesh(new THREE.ShapeGeometry(shape, 24).rotateX(-Math.PI / 2).scale(0.96, 1, 0.96), gold);
    plate.position.set(0, 0.88, -0.02);
    g.add(plate);
    // Lid, propped open on the right.
    const lid = new THREE.Mesh(new THREE.ShapeGeometry(shape, 24).rotateX(-Math.PI / 2), lacquer);
    const hinge = new THREE.Group();
    hinge.position.set(-0.74, 0.95, 0);
    lid.position.x = 0.74;
    hinge.add(lid);
    hinge.rotation.z = 0.62;
    g.add(hinge);
    (lid.material as THREE.Material).side = THREE.DoubleSide;
    // Key bed: the keys themselves (88, instanced, playable) are piano.ts's; this is what they sit in.
    // White key tops at y 0.78, their front edge at z 0.2; cheek blocks either side, a key slip in front.
    const keyBed = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.04, 0.2), lacquer);
    keyBed.position.set(0, 0.735, 0.105);
    g.add(keyBed);
    for (const side of [-1, 1]) {
      const cheek = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.075, 0.24, 2, 0.012), lacquer);
      cheek.position.set(side * 0.665, 0.765, 0.1);
      g.add(cheek);
    }
    const slip = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.03, 0.012), lacquer);
    slip.position.set(0, 0.752, 0.208);
    g.add(slip);
    // Red felt along the back of the keys, and the name board behind it.
    const velvet = new THREE.MeshStandardMaterial({ color: 0x3a1015, roughness: 0.8 });
    const felt = new THREE.Mesh(new THREE.BoxGeometry(1.23, 0.012, 0.012), velvet);
    felt.position.set(0, 0.79, 0.046);
    g.add(felt);
    const nameBoard = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.07, 0.03), lacquer);
    nameBoard.position.set(0, 0.8, 0.025);
    g.add(nameBoard);
    /** Where the keys go (origin: middle of the white keys' front edge, at their top). */
    this.keyFrame.position.set(0, 0.78, 0.2);
    g.add(dynamic(this.keyFrame));
    // The fallboard, folded back, and the music stand with a page of music on it.
    const fall = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 0.025), lacquer);
    fall.position.set(0, 0.86, -0.02);
    fall.rotation.x = -0.35;
    g.add(fall);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.3, 0.015), lacquer);
    stand.position.set(0, 1.07, -0.1);
    stand.rotation.x = -0.26;
    g.add(stand);
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.012, 0.035), lacquer);
    ledge.position.set(0, 0.93, -0.055);
    g.add(ledge);
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.28), new THREE.MeshStandardMaterial({ map: sheetMusic(), roughness: 0.9 }));
    sheet.position.set(0, 1.075, -0.088);
    sheet.rotation.x = -0.26;
    g.add(sheet);
    for (const [lx, lz] of [[-0.62, -0.1], [0.62, -0.1], [-0.4, -1.7]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.64, 12), lacquer);
      leg.position.set(lx, 0.32, lz);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12), gold);
      cap.position.set(lx, 0.02, lz);
      g.add(leg, cap);
    }
    const lyre = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.04), lacquer);
    lyre.position.set(0, 0.38, -0.05);
    g.add(lyre);
    const bench = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.08, 0.36, 2, 0.02), lacquer);
    bench.position.set(0, 0.5, 0.62);
    const cushion = new THREE.Mesh(new RoundedBoxGeometry(0.78, 0.05, 0.34, 2, 0.02), velvet);
    cushion.position.set(0, 0.56, 0.62);
    g.add(bench, cushion);
    for (const bx of [-0.35, 0.35]) for (const bz of [0.48, 0.76]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.48, 8), lacquer);
      l.position.set(bx, 0.24, bz);
      g.add(l);
    }
    // Tip jar on the piano.
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 16, 1, true), glassMat);
    jar.position.set(0.5, 1.03, -0.3);
    g.add(jar);
    const bills = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12), new THREE.MeshStandardMaterial({ color: 0x5a8a4a }));
    bills.position.set(0.5, 0.98, -0.3);
    g.add(bills);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 3).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: toTexture(radial(128, 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0)')), transparent: true, depthWrite: false }),
    );
    shadow.position.set(0, 0.012, -0.7);
    g.add(shadow);

    const tipZone = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial({ visible: false }));
    tipZone.position.copy(jar.position);
    g.add(dynamic(tipZone));
    bakeStatic(g);

    g.updateMatrixWorld(true);
    // Collider: the piano body (its keyboard end stops short of the bench). The bench is a seat:
    // walk onto it and you sit at the keys (walking guests go round it).
    this.d.world.addLocalBox(g, 0, -0.75, 1.7, 2.3, 'piano');
    this.d.world.addLocalSeat(g, 0, 0.64, 0.3, 0.585, Math.PI, 'piano bench');

    // The pianist, and the music: a positional loop you hear across the room.
    const seat = new THREE.Vector3(0, 0, 0.64).applyMatrix4(g.matrixWorld);
    this.d.crowd.add('pianist', staffLook('pianist'), seat, g.rotation.y + Math.PI);
    const pianist = this.d.crowd.people.at(-1);
    if (pianist) pianist.seatY = 0.6;
    this.pianist = pianist ?? null;
    const speaker = this.soundboard;
    speaker.position.set(0, 1.0, -0.6);
    g.add(speaker);
    this.pianoLoop = this.d.sound.ambientAt(() => this.d.sound.pianoLoop(), speaker, { volume: 0.9, ref: 2.2, rolloff: 1.1 });

    this.d.interaction.register({
      object: tipZone,
      label: 'Tip the pianist $5',
      enabled: () => !!pianist?.seated,
      onSelect: () => {
        if (!this.d.bankroll.canAfford(5)) return;
        this.d.bankroll.debit(5, 'bet', 'tip');
        this.d.sound.play('chip', tipZone, { volume: 0.7 });
        this.d.hud.toast('The pianist smiles and nods. “Grazie!”', 'info');
        this.onTip?.();
        if (pianist) pianist.headYaw = 0.8;
      },
    });
  }

  /** Alcohol in: tipsiness builds; the crew notices. */
  private drank(units: number) {
    if (units <= 0) return;
    this.units += units;
    const stage = this.units >= 6 ? 3 : this.units >= 4 ? 2 : this.units >= 2.5 ? 1 : 0;
    if (stage > this.tipsyStage) {
      this.tipsyStage = stage;
      this.onTipsy?.(stage);
    }
  }

  /** Clink glasses with a guest who's holding a drink (desktop G, or bring glasses together in VR). */
  private tryCheers(at?: THREE.Vector3) {
    if (this.cheersCooldown > 0) return false;
    const held = this.desktopDrink ?? this.vrHeld;
    if (!held) return false;
    const mine = at ?? held.group.getWorldPosition(new THREE.Vector3());
    const feet = this.d.player.feet();
    let best: Person | null = null,
      bd = at ? 0.25 : 1.6;
    for (const p of this.d.crowd.people) {
      if (p.prop !== 'glass' || !p.rig) continue;
      const w = p.rig.bones['WristR'];
      if (!w) continue;
      const g = w.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.05, 0));
      const dist = at ? g.distanceTo(mine) : p.pos.distanceTo(feet);
      if (dist < bd) {
        bd = dist;
        best = p;
      }
    }
    if (!best) return false;
    this.cheers(mine, best);
    return true;
  }

  /** Desktop: is a guest with a glass close enough for G to clink with? */
  clinkable(): boolean {
    const feet = this.d.player.feet();
    return this.d.crowd.people.some((p) => p.prop === 'glass' && !!p.rig && p.pos.distanceTo(feet) < 1.6);
  }

  /** The clink: sound, 'Cheers!', both of you take a sip. Also called when your friend clinks yours. */
  cheers(at: THREE.Vector3, with_?: Person, fromFriend = false) {
    if (this.cheersCooldown > 0) return;
    this.cheersCooldown = 2;
    this.d.sound.play('clink', at, { volume: 1, rate: 1.15 });
    if (with_) {
      const female = (with_.look.kind ?? '').startsWith('female') || !!with_.look.dress;
      const ch = characterFor(with_.seed, female);
      const pool = Math.random() < 0.7 ? ch.cheers : CHEERS_LINES;
      const text = pool[Math.floor(Math.random() * pool.length)];
      const alt = voices.pick(text, ch.fallback, guestVoice(with_.seed, female));
      this.onLine?.(with_, { text, voice: elVoice(ch.id), alt, who: ch.name });
      const dur = voices.talk({ who: ch.name, text, voice: elVoice(ch.id), alt, at: mouthOf(with_), priority: true });
      this.d.crowd.speak(with_, dur);
    } else if (voices.captions) this.d.hud.say('You', 'Cheers!');
    if (with_) {
      with_.sipT = 1.6;
      with_.cheer = 0.6;
    }
    const held = this.desktopDrink ?? this.vrHeld;
    if (held && held.level > 0) setTimeout(() => this.sip(held), 600);
    if (!fromFriend) this.onCheers?.(at);
  }

  /** Debug/screenshots: one glass of each drink along the bar top. */
  debugLineup() {
    DRINKS.forEach((k, i) => {
      const d = new Drink(k);
      d.group.position.copy(LAGO.serveAt(Lounge.COUNTER_Z0 + 0.6 + i * 0.32)).add(new THREE.Vector3(-0.05, 0, 0));
      this.d.scene.add(d.group);
    });
  }

  /** The drinks on the menu (by name), for scripted orders. */
  kind(name: string): DrinkKind | undefined {
    return DRINKS.find((d) => d.name === name);
  }

  /** Where your glass is (for clinking with your friend), or null. */
  heldGlass(): THREE.Vector3 | null {
    const held = this.desktopDrink ?? this.vrHeld;
    return held ? held.group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.08, 0)) : null;
  }

  update(dt: number) {
    for (const st of this.stations.values()) {
      if (st.yours && !st.pour && !st.slide) {
        const o = st.yours;
        st.yours = null;
        this.startPour(st, o.kind, o.s, false);
      } else if (st.friendOrders.length && !st.pour && !st.slide) {
        const o = st.friendOrders.shift()!;
        st.friendServe = o.s;
        this.startPour(st, o.kind, o.s, true);
      }
    }
    this.time += dt;
    this.sipCooldown = Math.max(0, this.sipCooldown - dt);
    this.cheersCooldown = Math.max(0, this.cheersCooldown - dt);
    this.ticker.update(dt);
    for (const st of this.stations.values()) {
      this.updatePour(st, dt);
      this.updateBarLife(st, dt);
    }
    this.updateVrMenu();
    this.updateTipsy(dt);
    // VR: bring your glass to a guest's glass to clink.
    if (this.vrHeld) {
      const g = this.vrHeld.group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.06, 0));
      this.tryCheers(g);
    } else if (this.desktopDrink && !this.cheersHintShown) {
      for (const p of this.d.crowd.people) {
        if (p.prop === 'glass' && p.pos.distanceTo(this.d.player.feet()) < 1.6) {
          this.cheersHintShown = true;
          this.d.hud.toast('Press G to clink glasses: cheers!', 'info');
          break;
        }
      }
    }
    if (this.roundPending > 0) {
      this.roundPending -= dt;
      if (this.roundPending <= 0) {
        this.d.sound.play('clink', new THREE.Vector3(-14.7, 1.15, this.lago.work), { volume: 0.9 });
        this.d.hud.toast('Round served. Cheers!', 'win');
        this.onRound?.();
      }
    }
    for (const f of [...this.falling]) {
      if (f.obj.parent !== this.d.scene) {
        this.falling.splice(this.falling.indexOf(f), 1);
        continue;
      }
      f.v += 9.8 * dt;
      f.obj.position.y -= f.v * dt;
      if (f.obj.position.y <= f.floor) {
        f.obj.position.y = f.floor;
        this.falling.splice(this.falling.indexOf(f), 1);
        this.d.sound.play('clink', f.obj, { volume: Math.min(1, 0.2 + f.v * 0.2) });
      }
    }
  }

  private updatePour(st: Station, dt: number) {
    const po = st.pour;
    if (po) {
      po.t += dt;
      const k = po.t / po.total;
      // Shake first (no stream), then pour: the glass fills over the last part.
      const fillStart = po.kind.prep === 'shake' ? 0.62 : po.kind.prep === 'stir' ? 0.45 : 0.25;
      const fill = THREE.MathUtils.clamp((k - fillStart) / (0.95 - fillStart), 0, 1);
      po.glass.setLevel(fill);
      const pouring = fill > 0 && fill < 1;
      st.stream.visible = pouring;
      if (pouring) {
        const top = po.glass.group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.15 * fill + 0.02, 0));
        let src: THREE.Vector3;
        if (po.kind.prep === 'tap') src = st.c.tapAt(po.pourS);
        else if (st.bottle.visible) src = st.bottle.localToWorld(new THREE.Vector3(0, 0, 0.25));
        else src = top.clone().add(new THREE.Vector3(0, 0.25, 0));
        if (src.distanceTo(top) > 0.6) src = top.clone().add(new THREE.Vector3(-0.08, 0.25, 0));
        st.stream.position.copy(src);
        const dir = top.clone().sub(src);
        st.stream.scale.set(1, dir.length(), 1);
        st.stream.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
      }
      if (po.t >= po.total) {
        st.pour = null;
        st.stream.visible = false;
        st.bottle.visible = false;
        st.bottle.removeFromParent();
        const to = st.c.serveAt(po.s, po.forNpc);
        st.slide = { drink: po.glass, from: po.glass.group.position.clone(), to, t: 0, forNpc: po.forNpc, s: po.s };
        st.work = po.s;
        this.d.sound.play('chip', po.glass.group, { volume: 0.35, rate: 0.5 });
      }
    }
    const sl = st.slide;
    if (sl) {
      sl.t += dt / (sl.from.distanceTo(sl.to) > 1 ? 1.1 : 0.5);
      const e = 1 - (1 - Math.min(1, sl.t)) ** 3;
      sl.drink.group.position.lerpVectors(sl.from, sl.to, e);
      if (sl.t >= 1) {
        st.slide = null;
        this.served(st, sl.drink, sl.forNpc, sl.s);
      }
    }
  }

  /** VR: the menu stands on the bar in front of you when you walk up (at Bar Lago, or round the pool bar). */
  private updateVrMenu() {
    const xr = this.d.player.inXR;
    const f = this.d.player.feet();
    const busy = !!this.makingMine() || !!this.waiting;
    for (const st of this.stations.values()) {
      const m = st.vrMenu.mesh;
      const near = xr && st.c.near(f.x, f.z);
      const show = near && !busy;
      if (show && !m.visible) {
        this.menuAt = st;
        this.menuZ = st.c.spotAt(f.x, f.z);
        st.work = this.menuZ;
        const at = st.c.menuAt(this.menuZ);
        m.position.copy(at.pos);
        m.rotation.set(0, at.yaw, 0);
        m.rotateX(-0.25);
        this.greet(this.tipped > 0 ? BARTENDER_LINES.regularShort : BARTENDER_LINES.hello, false, st);
        st.vrMenu.redraw();
        m.visible = show;
        this.listenForOrder();
      }
      // Walking round the pool bar: the panel follows you along the counter.
      if (show && st.c.gap(st.c.spotAt(f.x, f.z), this.menuZ) > 0.9 && this.menuAt === st) {
        this.menuZ = st.c.spotAt(f.x, f.z);
        st.work = this.menuZ;
        const at = st.c.menuAt(this.menuZ);
        m.position.copy(at.pos);
        m.rotation.set(0, at.yaw, 0);
        m.rotateX(-0.25);
      }
      m.visible = show;
    }
  }

  /** Life at the bar: the bartender makes drinks for the regulars too. */
  private updateBarLife(st: Station, dt: number) {
    if (st.pour || st.slide) return;
    st.npcOrderIn -= dt;
    if (st.npcOrderIn > 0) return;
    st.npcOrderIn = 22 + Math.random() * 25;
    const z = st.patrons[Math.floor(Math.random() * st.patrons.length)];
    if (z === undefined) return;
    // Not while you're ordering: she's yours.
    if (this.menuOpen && this.menuAt === st) return;
    const choices = st.menu.filter((d) => d.section !== 'Mocktails');
    this.startPour(st, choices[Math.floor(Math.random() * choices.length)], z, true);
  }

  /** Several drinks in, the room sways a little (screens only; never in VR, for comfort). */
  private updateTipsy(dt: number) {
    this.units = Math.max(0, this.units - dt / 180);
    if (this.units < 2 && this.tipsyStage > 0) this.tipsyStage = 0;
    const a = this.d.player.inXR ? 0 : THREE.MathUtils.clamp((this.units - 2) / 4, 0, 1);
    const canvas = document.querySelector('#app canvas') as HTMLCanvasElement | null;
    if (canvas) {
      const blur = a > 0.05 ? `blur(${(a * 1.1).toFixed(2)}px)` : '';
      if (canvas.style.filter !== blur) canvas.style.filter = blur;
    }
    if (a > 0) {
      const cam = this.d.player.camera;
      cam.rotation.z += Math.sin(this.time * 0.7) * 0.025 * a;
      cam.rotation.x += Math.sin(this.time * 0.43 + 1) * 0.012 * a;
    }
  }
}

function isInside(o: THREE.Object3D, root: THREE.Object3D) {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true;
  return false;
}

function round(a: number[], digits: number) {
  const k = 10 ** digits;
  return a.map((v) => Math.round(v * k) / k);
}

/** A page of piano music for the stand: staves, bar lines and a scatter of notes. */
function sheetMusic(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 170;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f2ead6';
  x.fillRect(0, 0, 256, 170);
  x.strokeStyle = '#2a2620';
  x.fillStyle = '#2a2620';
  x.lineWidth = 1;
  let seed = 5;
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let sys = 0; sys < 3; sys++) {
    for (const st of [0, 1]) {
      const y0 = 18 + sys * 52 + st * 22;
      for (let l = 0; l < 5; l++) {
        x.beginPath();
        x.moveTo(12, y0 + l * 3.4);
        x.lineTo(244, y0 + l * 3.4);
        x.stroke();
      }
      for (const bx of [12, 70, 128, 186, 244]) x.fillRect(bx, y0, 1, 13.6);
      for (let n = 0; n < 14; n++) {
        const nx = 20 + n * 16 + r() * 4,
          ny = y0 + Math.floor(r() * 9) * 1.7;
        x.beginPath();
        x.ellipse(nx, ny, 2.4, 1.7, -0.4, 0, Math.PI * 2);
        x.fill();
        x.fillRect(nx + 1.8, ny - 10, 0.8, 10);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
