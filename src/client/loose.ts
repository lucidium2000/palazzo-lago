import * as THREE from 'three';
import type { Grabbable, Hand, Hands } from './hands';
import type { Interaction } from './interaction';
import type { Hud } from './hud';
import type { Player } from './player';
import type { World } from './world';
import type { Throwables } from './throwables';
import type { DrinkPhysics, Pourable } from './drinkphysics';
import { Drink, type Lounge } from './lounge';
import { CHIP_HEIGHT, CHIP_RADIUS, makeChip } from './chips';
import { WHEEL_CENTER } from './roulette/layout';
import type { ChipDenom } from './textures';
import { LooseSim, Surfaces, extents, type LooseBody, type LooseEnv, type LooseEvent, type LooseSpec } from './loosephys';
import { BAR as POOL_BAR } from './areas/pool';
import { palmGrab, palms, type PalmReading } from './palm';
import { biteScale, promenadeKinds } from './promenadeprops';
import { MERCH, PROMENADE_SURFACES, storeStock, type MerchKey } from './areas/promenadeplan';

type SoundName = Parameters<import('./audio').Sound['play']>[0];
interface SoundLike {
  play(name: SoundName, at?: THREE.Vector3 | THREE.Object3D, opts?: { volume?: number; rate?: number }): unknown;
  playLocal(name: SoundName, volume?: number, rate?: number): void;
}

/**
 * Loose objects around the venue: things you can pick up, throw, knock over
 * and sweep off a table. Chips on the bar and the tables, a pair of souvenir
 * dice, bottles on the bar and the back bar (swig, pour, smash), garnish bowls
 * of limes and lemons, cocktail napkins, menus, crystal ashtrays and
 * champagne buckets at the bar, the lounge, the pool bar and the cabanas.
 *
 * Physics lives in loosephys.ts; this draws each kind as one instanced mesh
 * (one draw call per kind wherever they are), hooks them up to VR grabbing,
 * desktop click / X / Q / F / P, knocks with glasses and hands, and tells your
 * friend what you did with them (net/loosesync.ts).
 */

export interface LooseDeps {
  scene: THREE.Scene;
  camera: THREE.Camera;
  world: World;
  sound: SoundLike;
  hands: Hands;
  interaction: Interaction;
  hud: Hud;
  player: Player;
  lounge: Lounge;
  throwables: Throwables;
  drinkPhysics: DrinkPhysics;
  /** The roulette and craps tables' groups (their felts, rails and the wheel are surfaces). */
  roulette?: THREE.Object3D;
  craps?: THREE.Object3D;
  /** A loose chip of yours came to rest (value, where, which): true if a table took it as a bet (then it leaves the loose ones). */
  onChipRest?: (value: number, at: THREE.Vector3, id: string) => boolean;
  /** A chip let go of from your hand here: true if it went into your wallet (then it leaves the loose ones). */
  absorbChip?: (value: number, at: THREE.Vector3, id: string) => boolean;
  /** Is this loose chip one of yours from your wallet (a click puts it back rather than picking it up)? */
  isMine?: (id: string) => boolean;
  /** Click / tap on one of your own loose chips: it goes back into your wallet. */
  tapChip?: (id: string, value: number, at: THREE.Vector3) => boolean;
  /** A chip of yours left the world on someone else's side (a friend bet it). */
  onChipGone?: (id: string) => void;
}

/** What your friend should see happen to a loose object. */
export type LooseNet =
  | { k: 'take'; id: string }
  | { k: 'put'; id: string; p: number[]; q: number[] }
  | { k: 'throw'; id: string; p: number[]; q: number[]; v: number[]; w: number[] }
  | { k: 'break'; id: string }
  /** A chip went into a bet on a table (or back into a wallet): it's gone from the loose ones. */
  | { k: 'gone'; id: string }
  /** Chips let go of from a wallet stack: new loose chips, falling from p with velocity v. */
  | { k: 'cspawn'; id: string; key: string; p: number[]; v: number[] }
  /** Something new appeared (food served at a counter, a hat taken off): kind key, where, how it's turned, colour, paid for. */
  | { k: 'spawn'; id: string; key: string; p: number[]; yaw: number; c: number; paid: number }
  /** A bite out of a piece of food: `n` bites left (0: finished, it's gone). */
  | { k: 'bite'; id: string; n: number }
  /** Shop stock paid for at the counter. */
  | { k: 'paid'; id: string };

export interface KindDef {
  key: string;
  label: string;
  spec: LooseSpec;
  geo: THREE.BufferGeometry;
  mat: THREE.Material | THREE.Material[];
  /** Colours per instance (bottles, fruit). */
  tinted?: boolean;
  /** Impact sound. */
  sound: SoundName;
  rate: number;
  vol: number;
  /** How it sits in your desktop hand (camera space). */
  hold: { p: [number, number, number]; r: [number, number, number] };
  /** Bottles: holds this many glasses. */
  capacity?: number;
  /** Food: bites to finish it. */
  food?: { bites: number };
  /** Shop stock (price, wearable). */
  merch?: MerchKey;
  /** Frustum-culled by the copies' bounding sphere (kinds that only live in one place). */
  cull?: boolean;
}

interface Kind extends KindDef {
  index: number;
  mesh: THREE.InstancedMesh;
  items: Item[];
  dirty: boolean;
}

export interface Item {
  id: string;
  kind: Kind;
  body: LooseBody;
  index: number;
  color: THREE.Color;
  /** Bottles: how full (0..1) and what's in it. */
  level: number;
  liquid: number | null;
  /** In a hand: the stand-in mesh you carry. */
  proxy: THREE.InstancedMesh | null;
  holder: 'vr' | 'desk' | 'remote' | null;
  hand: Hand | null;
  gone: boolean;
  /** Made while playing (chips let go of from a wallet stack), not part of the venue's props. */
  dyn?: boolean;
  /** Food: bites left. */
  bites: number;
  /** Shop stock: bought (wearable, and yours to take). */
  paid: boolean;
}

/** The value of a loose chip (0: not a chip). */
export function chipValue(it: { kind: { key: string } }): number {
  return it.kind.key.startsWith('chip') ? Number(it.kind.key.slice(4)) || 0 : 0;
}

const tmpM = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1);
const ZERO = new THREE.Vector3(0, 0, 0);
const tmpS = new THREE.Vector3();
const round = (a: number[], d: number) => a.map((v) => Math.round(v * 10 ** d) / 10 ** d);

/** Chip geometry with its base at y = 0 and both faces in one group (two draws per denomination). */
function chipGeometry() {
  const g = new THREE.CylinderGeometry(CHIP_RADIUS, CHIP_RADIUS, CHIP_HEIGHT, 24, 1).translate(0, CHIP_HEIGHT / 2, 0);
  const [side, top, bottom] = g.groups;
  g.clearGroups();
  g.addGroup(side.start, side.count, 0);
  g.addGroup(top.start, top.count + bottom.count, 1);
  return g;
}

function lathe(points: [number, number][], seg = 14) {
  return new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    seg,
  );
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Souvenir dice: a 3 × 2 atlas of red faces with white pips, one draw. */
function diceGeometry(size: number) {
  const geo = new THREE.BoxGeometry(size, size, size).translate(0, size / 2, 0);
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
  const tex = canvasTex(384, 256, (g) => {
    const order = [2, 5, 1, 6, 3, 4];
    const o = 34;
    const pips: Record<number, [number, number][]> = {
      1: [[0, 0]],
      2: [[-o, -o], [o, o]],
      3: [[-o, -o], [0, 0], [o, o]],
      4: [[-o, -o], [o, -o], [-o, o], [o, o]],
      5: [[-o, -o], [o, -o], [0, 0], [-o, o], [o, o]],
      6: [[-o, -o], [o, -o], [-o, 0], [o, 0], [-o, o], [o, o]],
    };
    order.forEach((n, i) => {
      const ox = (i % 3) * 128,
        oy = Math.floor(i / 3) * 128;
      g.fillStyle = '#a80e1a';
      g.fillRect(ox, oy, 128, 128);
      g.strokeStyle = '#d4a94e';
      g.lineWidth = 6;
      g.strokeRect(ox + 4, oy + 4, 120, 120);
      g.fillStyle = n === 1 ? '#e8c060' : '#fbfaf4';
      for (const [x, y] of pips[n]) {
        g.beginPath();
        g.arc(ox + 64 + x, oy + 64 + y, n === 1 ? 16 : 11, 0, Math.PI * 2);
        g.fill();
      }
    });
  });
  return { geo, mat: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.2 }) };
}

function kinds(): KindDef[] {
  const chip = (d: ChipDenom, key: string): KindDef => ({
    key,
    label: `$${d} chip`,
    spec: { name: key, shape: { type: 'cyl', r: CHIP_RADIUS, h: CHIP_HEIGHT }, mass: 0.01, bounce: 0.3, friction: 0.45, tumble: 0.3 },
    geo: chipGeometry(),
    mat: [(makeChip(d).material as THREE.Material[])[0], (makeChip(d).material as THREE.Material[])[1]],
    sound: 'chip',
    rate: 1,
    vol: 0.7,
    hold: { p: [0.16, -0.17, -0.36], r: [1.2, 0, 0] },
  });
  const dice = diceGeometry(0.022);
  const silver = new THREE.MeshStandardMaterial({ color: 0xe4e6ea, metalness: 1, roughness: 0.22 });
  const menuTex = canvasTex(256, 384, (g) => {
    g.fillStyle = '#4a1218';
    g.fillRect(0, 0, 256, 384);
    g.strokeStyle = '#d4a94e';
    g.lineWidth = 8;
    g.strokeRect(14, 14, 228, 356);
    g.fillStyle = '#e8c878';
    g.textAlign = 'center';
    g.font = 'italic bold 46px Georgia, serif';
    g.fillText('Bar', 128, 160);
    g.fillText('Lago', 128, 214);
    g.font = '20px Georgia, serif';
    g.fillText('COCKTAILS · WINE', 128, 270);
  });
  return [
    chip(5, 'chip5'),
    chip(25, 'chip25'),
    chip(100, 'chip100'),
    // The rest only ever appear when you let go of chips from your wallet.
    chip(1, 'chip1'),
    chip(500, 'chip500'),
    chip(1000, 'chip1000'),
    chip(5000, 'chip5000'),
    {
      key: 'die',
      label: 'souvenir die',
      spec: { name: 'die', shape: { type: 'box', x: 0.011, y: 0.011, z: 0.011 }, mass: 0.012, bounce: 0.45, friction: 0.35, tumble: 1 },
      geo: dice.geo,
      mat: dice.mat,
      sound: 'click',
      rate: 0.75,
      vol: 0.6,
      hold: { p: [0.16, -0.17, -0.36], r: [0.4, 0.5, 0] },
    },
    {
      key: 'bottle',
      label: 'bottle',
      spec: { name: 'bottle', shape: { type: 'cyl', r: 0.037, h: 0.32 }, mass: 1.2, bounce: 0.18, friction: 0.4, fragile: 6, floats: true, tumble: 0.5 },
      geo: lathe([[0, 0], [0.036, 0], [0.037, 0.2], [0.03, 0.235], [0.013, 0.27], [0.012, 0.32], [0, 0.32]]),
      mat: new THREE.MeshStandardMaterial({ roughness: 0.08, metalness: 0.15, envMapIntensity: 2 }),
      tinted: true,
      sound: 'clink',
      rate: 0.55,
      vol: 0.8,
      hold: { p: [0.2, -0.32, -0.45], r: [0.12, 0, 0] },
      capacity: 5,
    },
    {
      key: 'fruit',
      label: 'lime',
      spec: { name: 'fruit', shape: { type: 'sphere', r: 0.028 }, mass: 0.07, bounce: 0.3, friction: 0.5, floats: true },
      geo: new THREE.SphereGeometry(0.028, 12, 9).scale(1, 0.92, 1.12).translate(0, 0.026, 0),
      mat: new THREE.MeshStandardMaterial({ roughness: 0.55 }),
      tinted: true,
      sound: 'thunk',
      rate: 1.7,
      vol: 0.35,
      hold: { p: [0.16, -0.18, -0.38], r: [0, 0, 0] },
    },
    {
      key: 'napkin',
      label: 'cocktail napkin',
      // Stains with whatever it wipes up (see napkins.ts).
      tinted: true,
      spec: { name: 'napkin', shape: { type: 'box', x: 0.06, y: 0.0015, z: 0.06 }, mass: 0.004, bounce: 0.02, friction: 0.7, drag: 3.2, floats: true, tumble: 0.1 },
      geo: new THREE.BoxGeometry(0.12, 0.003, 0.12).translate(0, 0.0015, 0),
      mat: new THREE.MeshStandardMaterial({ color: 0xf6f1e6, roughness: 0.95 }),
      sound: 'thunk',
      rate: 2.2,
      vol: 0.05,
      hold: { p: [0.16, -0.18, -0.38], r: [1.1, 0, 0] },
    },
    {
      key: 'menu',
      label: 'menu',
      spec: { name: 'menu', shape: { type: 'box', x: 0.075, y: 0.006, z: 0.11 }, mass: 0.15, bounce: 0.1, friction: 0.6, drag: 0.8, floats: true, tumble: 0.3 },
      geo: (() => {
        const g = new THREE.BoxGeometry(0.15, 0.012, 0.22).translate(0, 0.006, 0);
        g.clearGroups();
        return g;
      })(),
      mat: new THREE.MeshStandardMaterial({ map: menuTex, roughness: 0.6 }),
      sound: 'thunk',
      rate: 1.3,
      vol: 0.45,
      hold: { p: [0.12, -0.2, -0.42], r: [1.0, 0, 0] },
    },
    {
      key: 'ashtray',
      label: 'crystal ashtray',
      spec: { name: 'ashtray', shape: { type: 'cyl', r: 0.06, h: 0.03 }, mass: 0.6, bounce: 0.15, friction: 0.5, fragile: 7, carry: 0.012, tumble: 0.4 },
      geo: lathe([[0, 0], [0.055, 0], [0.06, 0.03], [0.046, 0.03], [0.04, 0.012], [0, 0.012]], 16),
      mat: new THREE.MeshStandardMaterial({ color: 0xd8eef8, roughness: 0.04, metalness: 0.3, transparent: true, opacity: 0.72, envMapIntensity: 2.2 }),
      sound: 'clink',
      rate: 0.45,
      vol: 0.8,
      hold: { p: [0.16, -0.2, -0.4], r: [0.5, 0, 0] },
    },
    {
      key: 'bucket',
      label: 'champagne bucket',
      spec: { name: 'bucket', shape: { type: 'cyl', r: 0.1, h: 0.22 }, mass: 2.2, bounce: 0.15, friction: 0.5, carry: 0.03, tumble: 0.3 },
      geo: lathe([[0, 0], [0.075, 0], [0.09, 0.2], [0.1, 0.21], [0.098, 0.22], [0.088, 0.215], [0.074, 0.03], [0, 0.03]], 18),
      mat: silver,
      sound: 'thunk',
      rate: 0.75,
      vol: 0.9,
      hold: { p: [0.2, -0.4, -0.5], r: [0.1, 0, 0] },
    },
    {
      key: 'bowl',
      label: 'garnish bowl',
      spec: { name: 'bowl', shape: { type: 'cyl', r: 0.075, h: 0.045 }, mass: 0.35, bounce: 0.15, friction: 0.5, carry: 0.01, tumble: 0.4 },
      geo: lathe([[0, 0], [0.045, 0], [0.07, 0.035], [0.075, 0.045], [0.07, 0.045], [0.04, 0.01], [0, 0.01]], 18),
      mat: silver,
      sound: 'thunk',
      rate: 1.2,
      vol: 0.6,
      hold: { p: [0.18, -0.25, -0.45], r: [0.2, 0, 0] },
    },
    // The Promenade: food from the food court, the boutique's stock.
    ...promenadeKinds(),
  ];
}

const FRUIT = { lime: 0x6cb83a, lemon: 0xf0d23a, orange: 0xf08a1a };
export const BOTTLES = {
  champagne: { glass: 0x1c3a1e, liquid: 0xf4e2a0 },
  whisky: { glass: 0x9a5a1a, liquid: 0xb8651d },
  gin: { glass: 0x9fd0b0, liquid: 0xeaf4ee },
  vodka: { glass: 0xe6eef4, liquid: 0xf2f6fa },
  rum: { glass: 0x5a2a08, liquid: 0x8a4a1a },
  tequila: { glass: 0xe0d0a0, liquid: 0xf0e0a0 },
  wine: { glass: 0x2a0a10, liquid: 0x6a0a1a },
};

export class LooseObjects {
  readonly sim: LooseSim;
  readonly surfaces = new Surfaces();
  readonly kinds: Kind[] = [];
  readonly items = new Map<string, Item>();
  /** The thing in your desktop hand. */
  desk: Item | null = null;
  onNet: ((e: LooseNet) => void) | null = null;
  private woken = new Set<LooseBody>();
  private near = new Map<string, { t: number; list: THREE.Object3D[] }>();
  private ray = new THREE.Raycaster();
  private time = 0;
  private swigCool = 0;
  private soundCool = new Map<string, number>();
  /** Counters for tests and tuning. */
  readonly stats = { thrown: 0, landed: 0, broken: 0, knocked: 0, swept: 0, palmed: 0, offPalm: 0, bites: 0 };
  /** Your open palms (see palm.ts). */
  readonly palms = palms;
  /**
   * Where your palms are this frame. In VR it's read from your hands; tests
   * (and the desktop harness) can set this to drive them directly.
   */
  palmSource: ((side: 'left' | 'right') => PalmReading | null) | null = null;
  private grabs = new Map<Item, Grabbable>();
  private lateDone = false;

  constructor(private d: LooseDeps) {
    const env: LooseEnv = {
      ground: (x, z) => d.world.groundAt(x, z),
      water: (x, z) => d.world.waterAt(x, z),
      inside: (x, z) => d.world.isInside(x, z),
      blocked: (x, z) => this.blocked(x, z),
      top: (x, z, fromY) => this.top(x, z, fromY),
      topFast: (x, z, fromY) => this.surfaces.top(x, z, fromY),
    };
    this.sim = new LooseSim(env, 7);
    this.sim.platforms = palms.platforms;
    this.sim.onEvent = (e) => this.event(e);
    // Things in your palm when you close it (or reach in with your other hand).
    palmGrab.grab = (side, g) => {
      const h = d.hands.hands.find((x) => x.ctrl.userData.handedness === side);
      return !!h && d.hands.grabWith(h, g);
    };
    d.throwables.extraTop = (x, z, fromY) => this.surfaces.top(x, z, fromY)?.y ?? null;
    d.drinkPhysics.pourables = () => this.pourables();
    d.lounge.otherHeld = () => !!this.desk;
    for (const def of kinds()) this.addKind(def);
    this.build();
    addEventListener('keydown', (e) => {
      if (!this.desk || d.player.inXR) return;
      if (e.code === 'KeyQ') this.putDownDesk();
      if (e.code === 'KeyX') this.throwDesk();
      if (e.code === 'KeyF') this.useDesk();
    });
  }

  private kind(key: string) {
    return this.kinds.find((k) => k.key === key)!;
  }

  /**
   * Adds kinds made elsewhere (the arcade's claw prizes) after the venue's.
   * Every player's game adds the same ones in the same order, so a kind's
   * index (what friends are told you're holding) is the same everywhere.
   */
  addKinds(defs: KindDef[]) {
    for (const def of defs) if (!this.kindOf(def.key)) this.addKind(def);
  }

  private addKind(def: KindDef) {
    const cap = def.key.startsWith('chip') ? 64 : 40;
    const mesh = new THREE.InstancedMesh(def.geo, def.mat, cap);
    mesh.count = 0;
    mesh.frustumCulled = !!def.cull;
    mesh.castShadow = false;
    mesh.userData.dynamic = true;
    mesh.userData.noLand = true;
    mesh.name = `loose-${def.key}`;
    if (def.tinted) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    const k: Kind = { ...def, index: this.kinds.length, mesh, items: [], dirty: true };
    this.kinds.push(k);
    this.d.scene.add(mesh);
    // Desktop: click to pick it up (the instance under the cursor).
    this.d.interaction.register({
      object: mesh,
      kind: 'button',
      enabled: () => !this.desk && !this.d.lounge.holdingDrink,
      label: (e) => {
        const it = e.hit.instanceId !== undefined ? k.items[e.hit.instanceId] : undefined;
        if (!it || it.holder || it.gone) return null;
        if (this.d.isMine?.(it.id)) return `Put the ${this.labelOf(it)} back in your wallet`;
        return this.pickLabel(it);
      },
      onSelect: (e) => {
        const it = e.hit.instanceId !== undefined ? k.items[e.hit.instanceId] : undefined;
        if (!it) return;
        // Your own chips lying about: a click (or a tap on a phone) scoops them back.
        if (!it.holder && !it.gone && this.d.isMine?.(it.id) && this.d.tapChip?.(it.id, chipValue(it), it.body.pos.clone())) return;
        this.pickUpDesk(it);
      },
    });
  }

  private labelOf(it: Item) {
    if (it.kind.key === 'fruit') {
      const hex = it.color.getHex();
      return hex === new THREE.Color(FRUIT.lemon).getHex() ? 'lemon' : hex === new THREE.Color(FRUIT.orange).getHex() ? 'orange' : 'lime';
    }
    if (it.kind.key === 'bottle') return (it.level > 0.02 ? '' : 'empty ') + ((it.body.data.name as string) ?? 'bottle');
    if (it.kind.food && it.bites < it.kind.food.bites) return `half-eaten ${it.kind.label}`;
    return it.kind.label;
  }

  /** What a click on it says: shop stock shows its price until it's paid for. */
  private pickLabel(it: Item) {
    const m = it.kind.merch;
    if (m && !it.paid) return `Pick up the ${this.labelOf(it)} · $${MERCH[m].price}`;
    return `Pick up the ${this.labelOf(it)}`;
  }

  /** Adds an object at build time; `fromY` is just above where it sits (it stacks on what's there). */
  private spawn(key: string, x: number, z: number, fromY: number, o: { yaw?: number; color?: number; liquid?: number; name?: string } = {}) {
    const k = this.kind(key);
    const index = k.items.length;
    const id = `${key}${index}`;
    const body = this.sim.add(k.spec, id, new THREE.Vector3(x, fromY, z), o.yaw ?? 0);
    this.sim.place(body, x, z, fromY);
    if (o.name) body.data.name = o.name;
    const color = new THREE.Color(o.color ?? 0xffffff);
    const it: Item = { id, kind: k, body, index, color, level: o.liquid !== undefined ? 1 : 0, liquid: o.liquid ?? null, proxy: null, holder: null, hand: null, gone: false, bites: k.food?.bites ?? 0, paid: !k.merch };
    body.data.item = it;
    k.items.push(it);
    k.mesh.count = k.items.length;
    if (k.mesh.instanceColor) k.mesh.setColorAt(index, color);
    this.items.set(id, it);
    this.writeMatrix(it);
    this.registerGrab(it);
    return it;
  }

  // ---------------------------------------------------------------------------
  // Where things are
  // ---------------------------------------------------------------------------

  private build() {
    const S = this.surfaces;
    // Bar Lago: counter (guest side reachable), back-bar counter.
    const BX = -15.0,
      Z0 = 6.2,
      Z1 = 12.4,
      TOP = 1.1;
    S.box(BX + 0.05, (Z0 + Z1) / 2, 0.78, Z1 - Z0 + 0.12, TOP);
    S.box(-17.53, (Z0 + Z1) / 2, 0.55, Z1 - Z0, 0.99);
    // Lounge cocktail tables, blackjack tables (a half disc toward the players, plus the dealer's edge).
    const lounge: [number, number][] = [
      [-11.6, 11.4],
      [-11.4, 8.2],
    ];
    for (const [x, z] of lounge) S.disc(x, z, 0.38, 0.64);
    const pit: [number, number][] = [
      [-11.1, -4.4],
      [-3.95, -4.4],
    ];
    for (const [x, z] of pit) {
      S.box(x, z + 0.3, 2.04, 0.72, 0.762);
      S.box(x, z + 0.8, 1.2, 0.32, 0.762);
      S.box(x, z - 0.06, 2.1, 0.16, 0.762);
    }
    // Pool deck: the round pool bar's ledge, the cabana cushions.
    S.ring(POOL_BAR.x, POOL_BAR.z, POOL_BAR.r - 0.03, POOL_BAR.r + 0.13, 1.16);
    const cabanas = [-30, -24, -18];
    for (const z of cabanas) S.box(59.7, z, 2.0, 2.8, 0.5, 0, true);
    this.tableSurfaces();
    // Hotel lobby (baked scenery: too big to raycast): the round table, the corridor consoles, the benches.
    S.disc(36, 6, 1.0, 0.82);
    for (const x of [21, 27]) S.box(x, 5, 1.4, 0.55, 0.825);
    for (const z of [2.8, 9.2]) S.box(32, z, 1.8, 0.6, 0.56);
    // Suite 3201: coffee table, dining table, nightstands, the entry console, the bench at the foot of the bed.
    S.box(592.2, -1.2, 1.3, 0.7, 0.43);
    S.box(596.8, -1.0, 1.4, 0.9, 0.765);
    for (const x of [591.7, 594.7]) S.box(x, 4.9, 0.58, 0.48, 0.6);
    S.box(599.5, 0.8, 0.48, 1.32, 0.825);
    S.box(593.2, 2.35, 1.62, 0.48, 0.5);
    // The minibar's marble top (bottles to pour and mix with; see suiteperks.ts).
    S.box(598.5, -5.3, 2.7, 0.66, 0.985);
    // The pool's DJ stage and the decks on it.
    S.box(50, -32.8, 6.0, 2.4, 0.6);
    S.box(50, -31.95, 2.3, 0.65, 1.45);
    // The Promenade: food counters, food court tables, the boutique's tables, shelves and counter.
    for (const f of PROMENADE_SURFACES()) {
      if (f.kind === 'disc') S.disc(f.x, f.z, f.r, f.y);
      else S.box(f.x, f.z, f.w, f.d, f.y, f.yaw);
    }

    const up = (y: number) => y + 0.4;
    // --- On the bar counter ---
    this.spawn('bucket', -14.95, 6.55, up(TOP));
    this.spawn('bottle', -14.95, 6.55, up(TOP), { color: BOTTLES.champagne.glass, liquid: BOTTLES.champagne.liquid, name: 'champagne' });
    this.spawn('bottle', -14.92, 6.85, up(TOP), { color: BOTTLES.whisky.glass, liquid: BOTTLES.whisky.liquid, name: 'whisky' });
    this.spawn('bottle', -15.08, 6.98, up(TOP), { color: BOTTLES.gin.glass, liquid: BOTTLES.gin.liquid, name: 'gin' });
    this.fruitBowl(-14.85, 7.38, up(TOP));
    for (let i = 0; i < 6; i++) this.spawn('napkin', -14.74, 7.82, up(TOP), { yaw: (i * 0.37) % 0.5 });
    this.spawn('die', -14.76, 8.45, up(TOP), { yaw: 0.4 });
    this.spawn('die', -14.72, 8.5, up(TOP), { yaw: 1.3 });
    this.spawn('menu', -14.97, 9.8, up(TOP), { yaw: 0.25 });
    this.spawn('ashtray', -14.76, 11.0, up(TOP));
    for (let i = 0; i < 5; i++) this.spawn('chip25', -14.72, 11.7, up(TOP), { yaw: i });
    this.spawn('chip5', -14.63, 11.55, up(TOP));
    this.spawn('chip5', -14.67, 11.46, up(TOP), { yaw: 2 });
    this.spawn('chip5', -14.8, 11.5, up(TOP), { yaw: 4 });
    // --- On the back bar (the bartender's side) ---
    const back: [keyof typeof BOTTLES, number][] = [
      ['vodka', 7.2],
      ['rum', 8.0],
      ['tequila', 10.6],
      ['wine', 11.4],
    ];
    for (const [name, z] of back) this.spawn('bottle', -17.4, z, up(0.99), { color: BOTTLES[name].glass, liquid: BOTTLES[name].liquid, name });
    // --- Suite 3201 minibar: a full set of bottles to mix with, a bowl of fruit, an ice bucket ---
    {
      const names: (keyof typeof BOTTLES)[] = ['gin', 'vodka', 'rum', 'tequila', 'whisky', 'champagne', 'wine'];
      names.forEach((name, i) => this.spawn('bottle', 598.75 + i * 0.13, -5.12 + (i % 2) * 0.05, up(0.985), { color: BOTTLES[name].glass, liquid: BOTTLES[name].liquid, name }));
      this.fruitBowl(597.55, -5.1, up(0.985));
      this.spawn('bucket', 597.25, -5.18, up(0.985));
    }
    // --- The boutique's stock (on the Promenade) ---
    for (const s of storeStock()) this.spawn(s.key, s.x, s.z, up(s.y), { yaw: s.yaw, color: s.color });
    // --- Lounge tables ---
    {
      const [x, z] = lounge[0];
      this.spawn('ashtray', x + 0.03, z + 0.22, up(0.64));
      for (let i = 0; i < 4; i++) this.spawn('chip100', x - 0.14, z + 0.17, up(0.64), { yaw: i * 1.7 });
    }
    {
      const [x, z] = lounge[1];
      this.spawn('menu', x + 0.05, z - 0.22, up(0.64), { yaw: 0.4 });
      for (let i = 0; i < 3; i++) this.spawn('napkin', x - 0.05, z + 0.22, up(0.64), { yaw: i * 0.3 });
    }
    // --- Blackjack tables: a stack and a couple of strays by the dealer ---
    for (const [x, z] of pit) {
      for (let i = 0; i < 5; i++) this.spawn(i < 3 ? 'chip25' : 'chip5', x - 0.55, z + 0.12, up(0.762), { yaw: i * 2.1 });
      this.spawn('chip5', x + 0.5, z + 0.15, up(0.762));
      this.spawn('chip100', x + 0.56, z + 0.21, up(0.762), { yaw: 1 });
    }
    // --- Pool bar ledge ---
    const ring = (a: number): [number, number] => [POOL_BAR.x + Math.cos(a) * (POOL_BAR.r + 0.05), POOL_BAR.z + Math.sin(a) * (POOL_BAR.r + 0.05)];
    {
      const [x, z] = ring(Math.PI * 0.75);
      this.spawn('bucket', x, z, up(1.16));
      this.spawn('bottle', x, z, up(1.16), { color: BOTTLES.champagne.glass, liquid: BOTTLES.champagne.liquid, name: 'champagne' });
      const [ax, az] = ring(Math.PI * 0.75 + 0.22);
      this.spawn('ashtray', ax, az, up(1.16));
      const [nx, nz] = ring(Math.PI * 0.75 - 0.2);
      for (let i = 0; i < 3; i++) this.spawn('napkin', nx, nz, up(1.16), { yaw: i * 0.4 });
    }
    // --- Cabanas ---
    this.spawn('bucket', 60.3, -24.3, up(0.5));
    this.spawn('bottle', 60.3, -24.3, up(0.5), { color: BOTTLES.champagne.glass, liquid: BOTTLES.champagne.liquid, name: 'champagne' });
    this.fruitBowl(60.3, -30.2, up(0.5));
    this.spawn('menu', 60.2, -18.3, up(0.5), { yaw: 1.2 });
    for (let i = 0; i < 2; i++) this.spawn('napkin', 60.45, -17.8, up(0.5), { yaw: i * 0.6 });
  }

  private fruitBowl(x: number, z: number, fromY: number) {
    this.spawn('bowl', x, z, fromY);
    const fruit = [FRUIT.lime, FRUIT.lemon, FRUIT.lime, FRUIT.orange];
    fruit.forEach((c, i) => {
      const a = (i / fruit.length) * Math.PI * 2 + 0.3;
      this.spawn('fruit', x + Math.cos(a) * 0.03, z + Math.sin(a) * 0.03, fromY, { color: c, yaw: i });
    });
  }

  /** A table group's position and turn (as Object3D.rotation.y turns it). */
  private frameOf(o: THREE.Object3D): [number, number, number] {
    o.updateWorldMatrix(true, false);
    const p = o.getWorldPosition(new THREE.Vector3());
    const yaw = new THREE.Euler().setFromQuaternion(o.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
    return [p.x, p.z, yaw];
  }

  /**
   * The roulette and craps tables: felt, padded rails, the wheel, the tub's
   * walls (measured off the models; see craps/table.ts and roulette/table.ts).
   * Declared so landing is exact and cheap, and so the rails stop a chip
   * sliding across the felt instead of letting it pass through.
   */
  private tableSurfaces() {
    const S = this.surfaces;
    if (this.d.roulette) {
      const [x, z, yaw] = this.frameOf(this.d.roulette);
      // Layout felt; the padded rail round it; the lower front and end ledges.
      S.boxIn(x, z, yaw, 0.15, 0, 1.8, 0.8, 0.8);
      S.boxIn(x, z, yaw, -0.3, -0.5, 2.9, 0.2, 0.88);
      S.boxIn(x, z, yaw, -0.3, 0.45, 2.9, 0.1, 0.88);
      S.boxIn(x, z, yaw, 1.1, 0, 0.1, 0.8, 0.88);
      S.boxIn(x, z, yaw, -1.65, 0, 0.2, 0.8, 0.88);
      S.boxIn(x, z, yaw, -0.3, 0.55, 2.9, 0.1, 0.69);
      S.boxIn(x, z, yaw, 1.2, 0, 0.1, 1.2, 0.69);
      // The wheel: the bowl's rim and, inside it, the pockets and the cone.
      const c = Math.cos(yaw),
        s = Math.sin(yaw);
      const wx = x + WHEEL_CENTER.x * c + WHEEL_CENTER.z * s,
        wz = z - WHEEL_CENTER.x * s + WHEEL_CENTER.z * c;
      S.ring(wx, wz, 0.33, 0.43, 0.905);
      S.disc(wx, wz, 0.33, 0.86);
    }
    if (this.d.craps) {
      const [x, z, yaw] = this.frameOf(this.d.craps);
      // The tub: felt at the bottom, the inner wall's top, the rail round the outside.
      S.boxIn(x, z, yaw, 0, 0, 3.1, 1.3, 0.72);
      S.frameIn(x, z, yaw, 1.75, 0.75, 1.55, 0.65, 0.92);
      S.frameIn(x, z, yaw, 1.83, 0.81, 1.75, 0.75, 0.97);
    }
  }

  /**
   * Surfaces of things built after the loose objects (every slot machine's
   * cabinet top and sloping deck), declared from their colliders on the first
   * frame.
   */
  private late() {
    if (this.lateDone) return;
    this.lateDone = true;
    const S = this.surfaces;
    for (const b of this.d.world.colliders().boxes) {
      if (b.kind !== 'slot machine') continue;
      const featured = b.hw * 2 > 0.74;
      if (featured) {
        S.boxIn(b.x, b.z, b.yaw, 0, -0.085, 0.66, 0.35, 2.15);
        S.boxIn(b.x, b.z, b.yaw, 0, 0.275, 0.62, 0.17, 0.86, -0.4);
      } else {
        S.boxIn(b.x, b.z, b.yaw, 0, -0.09, 0.66, 0.34, 1.95);
        S.boxIn(b.x, b.z, b.yaw, 0, 0.21, 0.66, 0.24, 0.88, -0.3);
      }
    }
    this.near.clear();
  }

  private blockCache = new Map<number, boolean>();

  /** Furniture footprints (the world's colliders), looked up on a 3 cm grid: colliders don't move. */
  private blocked(x: number, z: number) {
    const ix = Math.round(x / 0.03),
      iz = Math.round(z / 0.03);
    const key = ix * 100003 + iz;
    let v = this.blockCache.get(key);
    if (v === undefined) {
      const cx = ix * 0.03,
        cz = iz * 0.03;
      v = this.d.world.isInside(cx, cz) && !this.d.world.isFree(cx, cz, 0.005);
      if (this.blockCache.size > 40000) this.blockCache.clear();
      this.blockCache.set(key, v);
    }
    return v;
  }

  /** Furniture tops: declared surfaces, else the meshes near there (raycast, cached per area). */
  private top(x: number, z: number, fromY: number): { y: number; soft?: boolean } | null {
    const s = this.surfaces.top(x, z, fromY);
    // Declared tops are the truth where there are any (the raycast would find lamps and shelves above).
    if (s || this.surfaces.top(x, z) !== null) return s;
    const key = `${Math.round(x / 4)},${Math.round(z / 4)}`;
    let n = this.near.get(key);
    if (!n || this.time - n.t > 15) {
      // Meshes whose bounds reach this 4 m cell.
      const cc = new THREE.Vector3(Math.round(x / 4) * 4, 1, Math.round(z / 4) * 4);
      const sph = new THREE.Sphere();
      const list = this.d.throwables.nearby(cc).filter((o) => {
        const g = (o as THREE.Mesh).geometry;
        sph.copy(g.boundingSphere!).applyMatrix4(o.matrixWorld);
        return Math.hypot(sph.center.x - cc.x, sph.center.z - cc.z) - sph.radius < 3.2;
      });
      n = { t: this.time, list };
      this.near.set(key, n);
    }
    if (!n.list.length || fromY > 50) return null;
    this.ray.set(new THREE.Vector3(x, Math.min(fromY, 4) + 0.03, z), new THREE.Vector3(0, -1, 0));
    this.ray.far = 4;
    (this.ray as THREE.Raycaster & { camera: THREE.Camera }).camera = this.d.camera;
    for (const h of this.ray.intersectObjects(n.list, false)) {
      const nn = h.face?.normal.clone().transformDirection(h.object.matrixWorld);
      if (nn && nn.y < 0.5) continue;
      if (h.point.y < 0.05) break;
      return { y: h.point.y };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------

  private writeMatrix(it: Item) {
    const k = it.kind;
    const hide = it.gone || !!it.holder;
    tmpM.compose(it.body.pos, it.body.q, hide ? ZERO : it.kind.food ? tmpS.setScalar(this.scaleOf(it)) : ONE);
    k.mesh.setMatrixAt(it.index, tmpM);
    k.dirty = true;
  }

  /** Shows an item's colour again after it changed (a stained napkin): where it lies and in a hand. */
  recolor(it: Item) {
    const k = it.kind;
    if (k.mesh.instanceColor) {
      k.mesh.setColorAt(it.index, it.color);
      k.mesh.instanceColor.needsUpdate = true;
    }
    if (it.proxy?.instanceColor) {
      it.proxy.setColorAt(0, it.color);
      it.proxy.instanceColor.needsUpdate = true;
    }
  }

  /** A carryable stand-in (one instance) for an item in someone's hand. */
  makeProxy(kindIndex: number, color: THREE.Color | number, scale = 1): THREE.InstancedMesh | null {
    const k = this.kinds[kindIndex];
    if (!k) return null;
    const m = new THREE.InstancedMesh(k.geo, k.mat, 1);
    m.setMatrixAt(0, new THREE.Matrix4().makeScale(scale, scale, scale));
    if (k.tinted) {
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3);
      m.setColorAt(0, new THREE.Color(color));
    }
    m.frustumCulled = false;
    m.raycast = () => {};
    m.userData.noLand = true;
    m.userData.loose = true;
    return m;
  }

  // ---------------------------------------------------------------------------
  // Picking up, throwing, putting down
  // ---------------------------------------------------------------------------

  private registerGrab(it: Item) {
    const g: Grabbable = {
      at: () => extents(it.kind.spec.shape, it.body.pos, it.body.q).c,
      radius: Math.max(0.07, extents(it.kind.spec.shape, it.body.pos, it.body.q).eh + 0.035),
      enabled: () => !it.holder && !it.gone,
      grab: (hand) => {
        const p = this.take(it, 'vr');
        it.hand = hand;
        return p;
      },
      drag: (hand, pos) => {
        // Bottles: bring it to your mouth for a swig.
        if (it.kind.key === 'bottle' && pos.distanceTo(this.d.hands.head) < 0.2 && this.swig(it)) this.d.hands.onHaptic?.(hand, 0.2, 30);
        // Food: to your mouth for a bite (and another, every second or so you hold it there).
        if (it.kind.food && this.atMouth(pos) && this.bite(it)) this.d.hands.onHaptic?.(hand, 0.3, 40);
        // Sunglasses to your eyes, a hat on top of your head: hold it there a moment and it's on.
        const wear = it.kind.merch ? MERCH[it.kind.merch].wear : null;
        if (wear) {
          const ok = wear === 'eyes' ? this.atEyes(pos) : this.onHead(pos);
          if (!ok) this.wearDwell.delete(it);
          else {
            const t0 = this.wearDwell.get(it) ?? this.time;
            this.wearDwell.set(it, t0);
            if (this.time - t0 > 0.35) {
              this.wearDwell.delete(it);
              if (this.wear(it)) this.d.hands.onHaptic?.(hand, 0.4, 50);
            }
          }
        }
      },
      release: (hand, pos, carried) => {
        if (it.holder !== 'vr' || !carried) return;
        // A chip let go of over your wallet (the tray over your palm, your wrist, your rail) goes back in.
        const value = chipValue(it);
        if (value > 0 && this.d.absorbChip?.(value, pos.clone(), it.id)) {
          carried.removeFromParent();
          it.proxy = null;
          it.holder = null;
          it.hand = null;
          this.collect(it);
          this.onNet?.({ k: 'gone', id: it.id });
          return;
        }
        const v = this.d.hands.velocity(hand);
        this.let(it, carried, v.length() > 1.2 ? v.multiplyScalar(1.15) : v.multiplyScalar(0.8));
      },
    };
    this.d.hands.register(g);
    this.grabs.set(it, g);
  }

  /** Takes an item out of the world into a hand; returns the mesh to carry. */
  private take(it: Item, who: 'vr' | 'desk'): THREE.InstancedMesh {
    this.sim.hold(it.body);
    it.holder = who;
    const p = this.makeProxy(it.kind.index, it.color, this.scaleOf(it))!;
    p.position.copy(it.body.pos);
    p.quaternion.copy(it.body.q);
    this.d.scene.add(p);
    it.proxy = p;
    this.writeMatrix(it);
    this.d.sound.play(it.kind.sound, it.body.pos.clone(), { volume: it.kind.vol * 0.5, rate: it.kind.rate * 1.1 });
    this.onNet?.({ k: 'take', id: it.id });
    return p;
  }

  /** Lets go of an item at the carried mesh's pose with velocity v (0: just drop it). */
  private let(it: Item, carried: THREE.Object3D, v: THREE.Vector3) {
    carried.updateMatrixWorld(true);
    carried.matrixWorld.decompose(it.body.pos, it.body.q, new THREE.Vector3());
    carried.removeFromParent();
    it.proxy = null;
    it.holder = null;
    it.hand = null;
    this.launch(it, v, undefined, true);
    // Let go just over an open palm (or opened the hand it was in, palm up): it rests there.
    if (v.length() < 1.5) this.sim.restOnPlatform(it.body);
  }

  private launch(it: Item, v: THREE.Vector3, w: THREE.Vector3 | undefined, mine: boolean) {
    this.sim.launch(it.body, v, w, mine);
    if (v.length() > 1.2) this.stats.thrown++;
    this.writeMatrix(it);
    if (mine) this.woken.add(it.body);
  }

  pickUpDesk(it: Item) {
    if (this.desk || this.d.player.inXR || this.d.lounge.holdingDrink || it.holder || it.gone) return;
    const p = this.take(it, 'desk');
    this.desk = it;
    this.d.camera.add(p);
    p.position.set(...it.kind.hold.p);
    p.rotation.set(...it.kind.hold.r);
    const m = it.kind.merch;
    const extra =
      it.kind.key === 'bottle'
        ? ' · F to swig · hold P to pour'
        : it.kind.food
          ? ' · F to take a bite'
          : m && !it.paid
            ? ` · $${MERCH[m].price}, pay at the counter`
            : m && MERCH[m].wear
              ? ` · F to put ${m === 'hat' ? 'it' : 'them'} on`
              : '';
    this.d.hud.toast(`Holding the ${this.labelOf(it)} · X to throw · Q to set it down${extra}`, 'info');
  }

  /** Desktop/phone: throw what you're holding where you're looking. */
  throwDesk() {
    const it = this.desk;
    if (!it || !it.proxy) return;
    const cam = this.d.camera;
    cam.updateMatrixWorld(true);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    const heavy = it.kind.spec.mass > 1;
    const v = dir.multiplyScalar(heavy ? 5 : 7).add(new THREE.Vector3(0, heavy ? 1.8 : 2.2, 0));
    this.desk = null;
    this.let(it, it.proxy, v);
  }

  /** Desktop: set it down on whatever is in front of you (gently). */
  putDownDesk() {
    const it = this.desk;
    if (!it || !it.proxy) return;
    const cam = this.d.camera;
    cam.updateMatrixWorld(true);
    const at = new THREE.Vector3(0, -0.15, -0.6).applyMatrix4(cam.matrixWorld);
    const yaw = new THREE.Euler().setFromQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
    it.proxy.removeFromParent();
    it.proxy = null;
    it.holder = null;
    this.desk = null;
    const b = it.body;
    b.held = false;
    b.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.sim.place(b, at.x, at.z, at.y);
    this.writeMatrix(it);
    this.d.sound.play(it.kind.sound, b.pos.clone(), { volume: it.kind.vol * 0.6, rate: it.kind.rate });
    this.onNet?.({ k: 'put', id: it.id, p: round(b.pos.toArray(), 3), q: round(b.q.toArray(), 3) });
  }

  get holding() {
    return !!this.desk;
  }

  /** A swig from a bottle in your hand. */
  swig(it: Item): boolean {
    if (it.kind.key !== 'bottle' || it.level <= 0.02 || this.swigCool > 0) return false;
    if (!this.d.lounge.swig(0.5)) return false;
    this.swigCool = 1.4;
    it.level = Math.max(0, it.level - 0.08);
    if (it.proxy && it.holder === 'desk') {
      // Up to your lips and back.
      const p = it.proxy;
      p.position.set(0.04, -0.1, -0.24);
      p.rotation.set(1.3, 0, 0);
      setTimeout(() => {
        if (this.desk === it && it.proxy === p) {
          p.position.set(...it.kind.hold.p);
          p.rotation.set(...it.kind.hold.r);
        }
      }, 700);
    }
    if (it.level <= 0.02) this.d.hud.toast(`That's the ${this.labelOf(it).replace('empty ', '')} finished.`, 'info');
    return true;
  }

  /** Bottles in your hands pour when you tip them (the drink physics streams them). */
  private pourables(): Pourable[] {
    const out: Pourable[] = [];
    for (const it of this.items.values()) {
      if (it.kind.key !== 'bottle' || !it.proxy || it.liquid === null || it.holder === 'remote') continue;
      const self = it;
      out.push({
        group: it.proxy,
        get level() {
          return self.level;
        },
        setLevel: (l) => (self.level = Math.max(0, l)),
        rimHeight: 0.32,
        rimRadius: 0.012,
        color: it.liquid,
        remote: false,
        capacity: it.kind.capacity,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------

  update(dt: number) {
    this.time += dt;
    this.swigCool = Math.max(0, this.swigCool - dt);
    this.biteCool = Math.max(0, this.biteCool - dt);
    for (const [k, t] of this.soundCool) if (t < this.time) this.soundCool.delete(k);
    // Desktop: P tips the bottle in your hand forward to pour.
    if (this.desk?.proxy && this.desk.kind.key === 'bottle') {
      const want = this.d.lounge.pouringDesktop ? -2.1 : this.desk.kind.hold.r[0];
      const p = this.desk.proxy;
      p.rotation.x += (want - p.rotation.x) * Math.min(1, dt * 6);
    }
    this.late();
    this.updatePalms(dt);
    this.knocks();
    this.sim.update(dt);
    // Tell your friend about things you set moving.
    if (this.onNet && this.woken.size) {
      for (const b of this.woken) {
        if (!b.awake || b.gone) continue;
        this.onNet({ k: 'throw', id: b.id, p: round(b.pos.toArray(), 3), q: round(b.q.toArray(), 3), v: round(b.v.toArray(), 2), w: round(b.w.toArray(), 1) });
      }
    }
    this.woken.clear();
    for (const k of this.kinds) {
      for (const it of k.items) if (it.body.awake) this.writeMatrix(it);
      if (k.dirty) {
        k.mesh.instanceMatrix.needsUpdate = true;
        if (k.mesh.instanceColor) k.mesh.instanceColor.needsUpdate = true;
        // Clicks find instances where they are now.
        k.mesh.boundingSphere = null;
        k.mesh.boundingBox = null;
        k.dirty = false;
      }
    }
  }

  /** Hands, held things and flying glasses push loose things; loose things knock glasses over. */
  private knocks() {
    const sim = this.sim;
    // VR hands sweeping across a table.
    if (this.d.player.inXR) {
      for (const h of this.d.hands.hands) {
        if (h.ctrl.userData.connected === false) continue;
        const v = this.d.hands.velocity(h);
        const held = h.carried ? [...this.items.values()].find((it) => it.proxy === h.carried) : undefined;
        const hit = sim.sweep(h.pos, v, 0.045, true, 0.9, held?.body);
        if (h.carried) {
          // Whatever you're holding hits things too (a bottle swung across the bar).
          const c = h.carried.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.06, 0).applyQuaternion(h.carried.getWorldQuaternion(new THREE.Quaternion())));
          hit.push(...sim.sweep(c, v, held ? Math.min(0.08, extents(held.kind.spec.shape, held.body.pos, held.body.q).eh) : 0.05, true, 0.9, held?.body));
        }
        for (const b of hit) {
          this.woken.add(b);
          this.stats.swept++;
          this.d.hands.onHaptic?.(h, 0.25, 25);
        }
      }
    }
    // Flying glasses knock loose things.
    for (const f of this.d.throwables.flyingObjects) {
      const c = f.obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.04, 0));
      for (const b of sim.sweep(c, f.v, 0.05, true, 0.8)) {
        this.woken.add(b);
        this.stats.knocked++;
        f.v.multiplyScalar(0.7);
        this.d.sound.play('clink', c, { volume: 0.5, rate: 0.9 });
      }
    }
    // Moving loose things knock glasses standing on tables (yours to knock: your friend sees the glass fly).
    let glasses: Drink[] | null = null;
    for (const b of sim.bodies) {
      if (!b.awake || !b.mine) continue;
      const sp = b.v.length();
      if (sp < 0.6) continue;
      glasses ??= [...Drink.all].filter((dr) => dr.group.parent === this.d.scene && !this.d.throwables.flying(dr.group) && !this.d.lounge.holder(dr));
      const e = extents(b.spec.shape, b.pos, b.q);
      for (const dr of glasses) {
        const g = dr.group.position;
        if (Math.hypot(g.x - e.c.x, g.z - e.c.z) > e.eh + 0.04 || e.c.y - e.ey > g.y + 0.16 || e.c.y + e.ey < g.y) continue;
        const push = b.v.clone().multiplyScalar(Math.min(1.2, 0.5 + b.spec.mass));
        push.y = Math.max(push.y, 0.4 + Math.random() * 0.3);
        this.d.lounge.throwDrink(dr, push);
        this.d.sound.play('clink', g.clone(), { volume: 0.7 });
        b.v.multiplyScalar(0.6);
        this.stats.knocked++;
        glasses = glasses.filter((x) => x !== dr);
      }
    }
  }

  private event(e: LooseEvent) {
    const it = e.body.data.item as Item | undefined;
    if (!it) return;
    if (e.type === 'wake') {
      // Knocked by something of yours: your friend should see it go.
      if (e.body.mine && e.by) this.woken.add(e.body);
      if (e.by) this.stats.knocked++;
    } else if (e.type === 'impact') {
      this.impactSound(it, e.speed, e.other, e.soft);
    } else if (e.type === 'settle') {
      this.stats.landed++;
      this.writeMatrix(it);
      // A chip you set down on a betting spot plays (and joins the table's chips).
      const value = chipValue(it);
      if (value > 0 && e.body.mine && this.d.onChipRest?.(value, it.body.pos.clone(), it.id)) {
        this.collect(it);
        this.onNet?.({ k: 'gone', id: it.id });
        return;
      }
      // A bottle lying on its side glugs out what's left.
      if (it.kind.key === 'bottle' && it.liquid !== null && it.level > 0.05 && Math.abs(it.body.axis().y) < 0.5) {
        const at = extents(it.kind.spec.shape, it.body.pos, it.body.q).c;
        this.d.throwables.spill(new THREE.Vector3(at.x, it.body.pos.y - 0.03, at.z), it.liquid, 0.1 + it.level * 0.25);
        this.d.sound.play('pour', at, { volume: 0.4, rate: 0.8 });
        it.level = 0;
      }
      if (e.body.mine) this.onNet?.({ k: 'put', id: it.id, p: round(it.body.pos.toArray(), 3), q: round(it.body.q.toArray(), 3) });
    } else if (e.type === 'break') {
      this.smash(it, e.at, e.v);
      if (e.body.mine) this.onNet?.({ k: 'break', id: it.id });
    } else if (e.type === 'ride') {
      this.stats.palmed++;
      this.d.sound.play(it.kind.sound, it.body.pos.clone(), { volume: it.kind.vol * 0.25, rate: it.kind.rate * 1.15 });
      const h = this.handOf(e.on.id);
      if (h) this.d.hands.onHaptic?.(h, 0.15, 20);
    } else if (e.type === 'unride') {
      this.stats.offPalm++;
      if (e.on.mine) this.woken.add(e.body);
    }
  }

  private handOf(platformId: string): Hand | null {
    const side = platformId.replace('palm-', '');
    return this.d.hands.hands.find((h) => h.ctrl.userData.handedness === side) ?? null;
  }

  /** Your palm, from your hand this frame: centre of the skin, which way it faces, how open, how squeezed. */
  private readPalm(side: 'left' | 'right'): PalmReading | null {
    if (!this.d.player.inXR) return null;
    const hands = this.d.hands;
    const h = hands.hands.find((x) => x.ctrl.userData.handedness === side);
    if (!h || h.ctrl.userData.connected === false) return null;
    const aim = hands.handAim(side);
    const wr = hands.wrist(side);
    if (!aim || !wr) return null;
    const tracked = hands.tracked(side);
    const gp = this.d.interaction.gamepads().find((g) => g.handedness === side)?.gamepad;
    const pose = hands.fingerPose(side, gp);
    const open = 1 - (pose[1] + pose[2] + pose[3] + pose[4]) / 4;
    const grip = h.held ? 1 : tracked ? 0 : (gp?.buttons[1]?.value ?? 0);
    // Middle of the palm, on the skin (a controller in the hand lifts things a little).
    const p = wr.clone().addScaledVector(aim.fwd, 0.07).addScaledVector(aim.palm, tracked ? 0.022 : 0.04);
    return { p, normal: aim.palm.clone(), fwd: aim.fwd.clone(), open, grip };
  }

  /** Palms as surfaces; closing a hand that has something in it picks it up. */
  private updatePalms(dt: number) {
    const was = palms.platforms.map((pl) => pl.active);
    palms.sides.forEach((side, i) => {
      const src = this.palmSource ?? ((s: 'left' | 'right') => this.readPalm(s));
      palms.set(i, src(side as 'left' | 'right'), dt);
    });
    palms.platforms.forEach((pl, i) => {
      if (!was[i] || pl.active) return;
      // The hand closed (not just turned over): it closes on what's in it.
      if (palms.grip[i] < 0.35 && palms.open[i] >= 0.5) return;
      const riders = this.sim.bodies.filter((b) => b.plat === pl && !b.held && !b.gone);
      if (!riders.length) return;
      // The top one (the hand closes around the stack's top).
      riders.sort((a, b) => b.pos.y - a.pos.y);
      for (const b of riders) {
        const it = b.data.item as Item | undefined;
        const g = it && this.grabs.get(it);
        if (g && palmGrab.grab?.(palms.sides[i], g)) break;
      }
    });
  }

  private impactSound(it: Item, speed: number, other: LooseBody | null, soft: boolean) {
    const key = it.id;
    if (this.soundCool.has(key)) return;
    this.soundCool.set(key, this.time + 0.06);
    const at = it.body.pos.clone();
    const vol = Math.min(1, speed / 3) * it.kind.vol * (soft ? 0.4 : 1);
    if (vol < 0.03) return;
    const k = it.kind.key;
    const chipOnChip = k.startsWith('chip') && other?.spec.name.startsWith('chip');
    const name: SoundName = it.body.inWater ? 'splash' : chipOnChip ? 'chips' : it.kind.sound;
    this.d.sound.play(name, at, { volume: vol, rate: it.kind.rate * (0.9 + Math.random() * 0.2) });
  }

  /**
   * A loose object made while playing (a chip let go of from a wallet stack):
   * reuses a slot of one that's gone for good, else a new one. Null if that
   * kind is full.
   */
  private spawnDyn(key: string, id: string, at: THREE.Vector3): Item | null {
    const k = this.kind(key);
    if (!k) return null;
    let it = k.items.find((x) => x.dyn && x.gone && !x.holder);
    const body = this.sim.add(k.spec, id, at.clone(), Math.random() * 6.28);
    if (it) {
      this.items.delete(it.id);
      it.id = id;
      it.body = body;
      it.gone = false;
      it.proxy = null;
      it.hand = null;
    } else {
      if (k.items.length >= k.mesh.instanceMatrix.count) {
        this.sim.remove(body);
        return null;
      }
      const index = k.items.length;
      it = { id, kind: k, body, index, color: new THREE.Color(0xffffff), level: 0, liquid: null, proxy: null, holder: null, hand: null, gone: false, dyn: true, bites: 0, paid: false };
      k.items.push(it);
      k.mesh.count = k.items.length;
      this.registerGrab(it);
    }
    body.data.item = it;
    this.items.set(id, it);
    this.writeMatrix(it);
    return it;
  }

  /**
   * Chips let go of from your hand (a wallet stack): they fall from `at` with
   * velocity `v`, one loose chip each, fanned a little. Returns each new
   * chip's id and value, or null (and nothing made) if there's no room.
   */
  dropChips(at: THREE.Vector3, v: THREE.Vector3, chips: readonly number[], tag: string): [string, number][] | null {
    const made: Item[] = [];
    for (const [i, d] of chips.entries()) {
      const id = `w${tag}${(this.dynCount++).toString(36)}`;
      const p = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.01, i * 0.004, (Math.random() - 0.5) * 0.01));
      const it = this.spawnDyn(`chip${d}`, id, p);
      if (!it) {
        for (const m of made) this.collect(m);
        return null;
      }
      made.push(it);
    }
    for (const it of made) {
      const vel = v.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.15, 0, (Math.random() - 0.5) * 0.15));
      this.launch(it, vel, undefined, true);
      this.onNet?.({ k: 'cspawn', id: it.id, key: it.kind.key, p: round(it.body.pos.toArray(), 3), v: round(vel.toArray(), 2) });
    }
    return made.map((it) => [it.id, chipValue(it)]);
  }
  private dynCount = 0;

  /** Takes a chip off the table for good (it went back into a wallet); tells your friend. */
  removeChip(id: string): boolean {
    const it = this.items.get(id);
    if (!it || it.gone || it.holder || chipValue(it) <= 0) return false;
    this.collect(it);
    this.onNet?.({ k: 'gone', id });
    return true;
  }

  /** Chips lying still within r of p (not in a hand). */
  chipsNear(p: THREE.Vector3, r: number): Item[] {
    const out: Item[] = [];
    for (const it of this.items.values()) {
      // Not ones riding a palm (they're in your hand already).
      if (it.gone || it.holder || it.body.awake || it.body.plat || chipValue(it) <= 0) continue;
      const e = extents(it.kind.spec.shape, it.body.pos, it.body.q);
      if (e.c.distanceTo(p) < r + e.eh) out.push(it);
    }
    return out;
  }

  /** Total value of the loose chips with these ids that are still in the world (in a hand counts). */
  valueOf(ids: Iterable<string>): number {
    let s = 0;
    for (const id of ids) {
      const it = this.items.get(id);
      if (it && !it.gone) s += chipValue(it);
    }
    return s;
  }

  /** Takes a loose object out of the world quietly (a chip that became a bet). */
  private collect(it: Item) {
    if (it.gone) return;
    this.sim.remove(it.body);
    it.gone = true;
    this.writeMatrix(it);
  }

  private smash(it: Item, at: THREE.Vector3, v: THREE.Vector3) {
    it.gone = true;
    this.stats.broken++;
    this.writeMatrix(it);
    const wet = it.liquid !== null && it.level > 0.05 ? it.liquid : null;
    this.d.throwables.shatter(at, v, wet);
    if (it.kind.key === 'bottle') {
      this.d.throwables.shatter(at.clone().add(new THREE.Vector3(0.05, 0.05, -0.04)), v.clone().multiplyScalar(0.6), null);
      if (wet !== null) {
        const floor = this.d.throwables.surfaceBelow(at.clone().add(new THREE.Vector3(0, 0.2, 0)));
        this.d.throwables.spill(new THREE.Vector3(at.x + 0.08, floor, at.z - 0.05), wet, 0.25 + it.level * 0.35);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Food and shop stock (the Promenade)
  // ---------------------------------------------------------------------------

  private biteCool = 0;
  private wearDwell = new Map<Item, number>();
  private liveN = 0;
  /** Makes ids of things spawned here unique in the room (your friends spawn theirs too). */
  private readonly tag = Math.random().toString(36).slice(2, 7);
  /** You finished something (the last bite). */
  onAte: ((it: Item) => void) | null = null;
  /** Put on a hat or sunglasses: the wardrobe shows it on you (and your friends). False if it can't. */
  onWear: ((key: MerchKey, color: number) => boolean) | null = null;

  /** How big it's drawn: food shrinks with each bite. */
  scaleOf(it: Item) {
    return it.kind.food ? biteScale(it.bites, it.kind.food.bites) : 1;
  }

  /**
   * Zone culling: draw only the kinds with something lying within `here` (by x;
   * null draws them all). The rest are hundreds of metres away, out of sight,
   * but instanced and never frustum culled they'd still cost a draw each.
   */
  cullTo(here: ((x: number) => boolean) | null) {
    for (const k of this.kinds) {
      if (k.cull) continue;
      const v = !here || k.items.some((it) => !it.gone && !it.holder && here(it.body.pos.x));
      if (k.mesh.visible !== v) k.mesh.visible = v;
    }
  }

  /** The kind with this key (food and shop kinds, for the food court and the wardrobe). */
  kindOf(key: string) {
    return this.kinds.find((k) => k.key === key) ?? null;
  }

  /** In front of your mouth (a little below and ahead of your eyes)? */
  private atMouth(p: THREE.Vector3) {
    const h = this.d.hands.head;
    return Math.hypot(p.x - h.x, p.z - h.z) < 0.2 && p.y < h.y + 0.02 && p.y > h.y - 0.25;
  }

  /** Up at your eyes (sunglasses)? */
  private atEyes(p: THREE.Vector3) {
    const h = this.d.hands.head;
    return p.distanceTo(h) < 0.13;
  }

  /** On top of your head (a hat)? */
  private onHead(p: THREE.Vector3) {
    const h = this.d.hands.head;
    return Math.hypot(p.x - h.x, p.z - h.z) < 0.16 && p.y > h.y + 0.02 && p.y < h.y + 0.35;
  }

  /**
   * Puts something new into the world now: food served at a counter, a hat
   * you took off. Reuses the slot of one that was eaten or worn. Your friends
   * get it too (with the same id) unless it came from them (`remote`).
   */
  spawnLive(key: string, x: number, z: number, fromY: number, o: { id?: string; yaw?: number; color?: number; paid?: boolean; remote?: boolean } = {}): Item | null {
    const k = this.kindOf(key);
    if (!k) return null;
    const id = o.id ?? `${key}-${this.tag}-${++this.liveN}`;
    const known = this.items.get(id);
    if (known) return known.gone ? null : known;
    let index = k.items.findIndex((x) => x.gone && !x.holder);
    if (index < 0) {
      if (k.items.length >= k.mesh.instanceMatrix.count) return null;
      index = k.items.length;
    } else {
      const old = k.items[index];
      this.items.delete(old.id);
      const g = this.grabs.get(old);
      if (g) this.d.hands.unregister(g);
      this.grabs.delete(old);
      this.wearDwell.delete(old);
    }
    const yaw = o.yaw ?? 0;
    const body = this.sim.add(k.spec, id, new THREE.Vector3(x, fromY, z), yaw);
    this.sim.place(body, x, z, fromY);
    const color = new THREE.Color(o.color ?? 0xffffff);
    const it: Item = { id, kind: k, body, index, color, level: 0, liquid: null, proxy: null, holder: null, hand: null, gone: false, bites: k.food?.bites ?? 0, paid: o.paid ?? !k.merch };
    body.data.item = it;
    k.items[index] = it;
    k.mesh.count = k.items.length;
    if (k.mesh.instanceColor) k.mesh.setColorAt(index, color);
    this.items.set(id, it);
    this.writeMatrix(it);
    this.registerGrab(it);
    if (!o.remote) this.onNet?.({ k: 'spawn', id, key, p: round(body.pos.toArray(), 3), yaw: Math.round(yaw * 100) / 100, c: color.getHex(), paid: it.paid ? 1 : 0 });
    return it;
  }

  /** A bite of the food in your hand (crunch, it gets smaller; the last bite finishes it). */
  bite(it: Item): boolean {
    if (!it.kind.food || it.bites <= 0 || this.biteCool > 0 || it.gone) return false;
    this.biteCool = 0.9;
    it.bites--;
    const soft = it.kind.key === 'gelato' || it.kind.key === 'noodles';
    this.d.sound.playLocal(soft ? 'munch' : 'crunch', soft ? 0.55 : 0.7, 0.9 + Math.random() * 0.2);
    this.stats.bites++;
    this.onNet?.({ k: 'bite', id: it.id, n: it.bites });
    if (it.proxy) {
      const s = this.scaleOf(it);
      it.proxy.setMatrixAt(0, tmpM.makeScale(s, s, s));
      it.proxy.instanceMatrix.needsUpdate = true;
    }
    if (it.proxy && it.holder === 'desk') {
      // Up to your mouth and back.
      const p = it.proxy;
      p.position.set(0.02, -0.09, -0.2);
      setTimeout(() => {
        if (this.desk === it && it.proxy === p) p.position.set(...it.kind.hold.p);
      }, 450);
    }
    if (it.bites <= 0) {
      this.leaveHand(it);
      this.collect(it);
      this.d.hud.toast(`That's the ${it.kind.label} finished.`, 'info');
      this.onAte?.(it);
    }
    return true;
  }

  /** It's out of your hand for good (eaten, or on your head now). */
  private leaveHand(it: Item) {
    if (this.desk === it) this.desk = null;
    if (it.holder === 'vr' && it.hand) this.d.hands.empty(it.hand);
    it.proxy?.removeFromParent();
    it.proxy = null;
    it.holder = null;
    it.hand = null;
  }

  /** Put on the hat or sunglasses you're holding (paid for). */
  wear(it: Item): boolean {
    const m = it.kind.merch;
    if (!m || !MERCH[m].wear || it.gone) return false;
    if (!it.paid) {
      this.d.hud.toast(`Pay for the ${this.labelOf(it)} at the counter first ($${MERCH[m].price})`, 'warn');
      return false;
    }
    if (!this.onWear?.(m, it.color.getHex())) return false;
    this.leaveHand(it);
    this.collect(it);
    this.onNet?.({ k: 'gone', id: it.id });
    return true;
  }

  /** Took a hat or sunglasses off: it's in your hand (VR: the hand that reached for it). */
  takeOff(key: MerchKey, color: number, hand: Hand | null): Item | null {
    const at = this.d.hands.head;
    const it = this.spawnLive(key, at.x, at.z, at.y, { color, paid: true });
    if (!it) return null;
    // Not straight back on: it has to leave your head first.
    this.wearDwell.set(it, Infinity);
    if (hand) {
      const g = this.grabs.get(it);
      if (g && this.d.hands.grabWith(hand, g) && it.proxy) {
        it.proxy.position.set(0, 0.02, -0.06);
        it.proxy.quaternion.identity();
      }
    } else this.pickUpDesk(it);
    return it;
  }

  /** The boutique took your money for it. */
  markPaid(it: Item) {
    if (it.paid) return;
    it.paid = true;
    this.onNet?.({ k: 'paid', id: it.id });
  }

  /** Every unpaid piece of stock in your hands. */
  unpaidHeld(): Item[] {
    return [...this.items.values()].filter((x) => x.kind.merch && !x.paid && (x.holder === 'desk' || x.holder === 'vr'));
  }

  /** Desktop F: swig a bottle, bite food, put on a hat or sunglasses. */
  useDesk() {
    const it = this.desk;
    if (!it) return;
    if (it.kind.key === 'bottle') this.swig(it);
    else if (it.kind.food) this.bite(it);
    else if (it.kind.merch && MERCH[it.kind.merch].wear) this.wear(it);
  }

  /** What F (or the phone's action button) does with what you're holding, if anything. */
  deskUse(): string | null {
    const it = this.desk;
    if (!it) return null;
    if (it.kind.key === 'bottle') return 'Swig';
    if (it.kind.food) return 'Bite';
    if (it.kind.merch && MERCH[it.kind.merch].wear) return 'Wear';
    return null;
  }

  // ---------------------------------------------------------------------------
  // Two-player
  // ---------------------------------------------------------------------------

  /** What you're holding, for your friend's view: [kind, colour, hand (0 left, 1 right), size (%)]. */
  heldState(): number[] | null {
    const it = this.desk ?? [...this.items.values()].find((x) => x.holder === 'vr');
    if (!it) return null;
    const side = it.hand?.ctrl.userData.handedness === 'left' ? 0 : 1;
    return [it.kind.index, it.color.getHex(), side, Math.round(this.scaleOf(it) * 100)];
  }

  /** Your friend did something to a loose object. */
  remote(e: LooseNet) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string') return;
    const finite = (a: unknown, n: number) => Array.isArray(a) && a.length === n && a.every((x) => Number.isFinite(x));
    if (e.k === 'cspawn') {
      if (this.items.has(e.id) || typeof e.key !== 'string' || !/^chip\d+$/.test(e.key) || !finite(e.p, 3) || !finite(e.v, 3)) return;
      if (!this.kinds.some((k) => k.key === e.key)) return;
      const it = this.spawnDyn(e.key, e.id, new THREE.Vector3().fromArray(e.p));
      if (it) this.launch(it, new THREE.Vector3().fromArray(e.v), undefined, false);
      return;
    }
    if (e.k === 'spawn') {
      if (typeof e.key !== 'string' || !finite(e.p, 3) || e.id.length > 40) return;
      this.spawnLive(e.key, e.p[0], e.p[2], e.p[1] + 0.03, { id: e.id, yaw: Number(e.yaw) || 0, color: Math.floor(Number(e.c)) & 0xffffff, paid: !!e.paid, remote: true });
      return;
    }
    const it = this.items.get(e.id);
    if (!it || it.gone) return;
    if (e.k === 'paid') {
      it.paid = true;
      return;
    }
    if (e.k === 'bite') {
      // Their bite (it's in their hand); the last one finishes it.
      if (!it.kind.food || !Number.isInteger(e.n)) return;
      it.bites = Math.max(0, Math.min(it.bites, e.n));
      if (it.bites <= 0) {
        it.holder = null;
        this.collect(it);
      } else this.writeMatrix(it);
      return;
    }
    // If it's in your hand, you have it: their copy catches up when you let go.
    if (it.holder === 'vr' || it.holder === 'desk') return;
    if (e.k === 'take') {
      this.sim.hold(it.body);
      it.holder = 'remote';
      this.writeMatrix(it);
    } else if (e.k === 'put') {
      if (!finite(e.p, 3) || !finite(e.q, 4)) return;
      it.holder = null;
      const b = it.body;
      this.sim.hold(b);
      b.held = false;
      b.pos.fromArray(e.p);
      b.q.fromArray(e.q).normalize();
      b.mine = false;
      this.writeMatrix(it);
    } else if (e.k === 'throw') {
      if (!finite(e.p, 3) || !finite(e.q, 4) || !finite(e.v, 3)) return;
      it.holder = null;
      it.body.pos.fromArray(e.p);
      it.body.q.fromArray(e.q).normalize();
      this.launch(it, new THREE.Vector3().fromArray(e.v), finite(e.w, 3) ? new THREE.Vector3().fromArray(e.w) : new THREE.Vector3(), false);
    } else if (e.k === 'break') {
      const at = extents(it.kind.spec.shape, it.body.pos, it.body.q).c.clone();
      this.sim.remove(it.body);
      this.smash(it, at, new THREE.Vector3());
    } else if (e.k === 'gone') {
      this.collect(it);
      this.d.onChipGone?.(it.id);
    }
  }
}
