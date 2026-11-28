import * as THREE from 'three';
import type { Bankroll } from '../rules/bankroll';
import { RANKS, SUITS } from '../rules/blackjack';
import {
  applyStep,
  type Card,
  cardId,
  evaluate,
  idCard,
  type Legal,
  newView,
  npcDecide,
  type NpcStyle,
  packPoker,
  type PokerAction,
  PokerHand,
  type PokerStep,
  stagedAction,
  type TableView,
  unpackPoker,
} from '../rules/poker';
import type { Rng } from '../rules/rng';
import type { Sound } from './audio';
import { cardMat, chipMat } from './blackjackplay';
import { makeChip } from './chips';
import { money } from './game';
import { envelope, handTo } from './gestures';
import type { Grabbable, Hand } from './hands';
import type { Control } from './hud';
import type { Interactable } from './interaction';
import type { Person } from './people';
import { type PokerSignal, PokerSignalReader } from './pokergesture';
import { DECK_AT, FELT_A, FELT_B, MUCK_AT, PK_TOP, type PokerRoom, RAIL_A, RAIL_B, SEATS, seatAngle } from './pokerroom';
import { CHIP_COLORS, type ChipDenom } from './textures';

/**
 * Texas Hold'em at the poker room's table, played with your hands.
 *
 * In VR you sit down and your chips are a stack in front of you with a rack of
 * $5 / $25 / $100 / $500 columns at your right. Lift your cards to look at
 * them (cup a hand over them and they tilt up toward you, or pick them up:
 * only you see their faces). On your turn: knock the table twice to check;
 * sweep your cards toward the dealer to fold (or toss them in); bet, call or
 * raise by taking chips from the rack (hold your hand there to scoop more)
 * and letting go of them over the betting line in front of you: what you put
 * out is read as a call when it matches the bet, a raise when it's more, and
 * pushing your whole stack forward is all in. The dealer nods to each action.
 * On a screen: Fold / Check / Call / a raise slider / All in, and your cards
 * stand up facing you.
 *
 * The host's table runs the hand (rules/poker.ts, PokerHand) and NPC guests
 * fill the empty seats; a guest's table plays the host's steps (net/pokersync.ts)
 * with everyone's hole cards hidden except their own, which the host seals for
 * them alone (net/pokerkeys.ts); cards show at a showdown. Everything you see
 * is folded from the steps (rules/poker.ts, applyStep) and paced so cards fly
 * and chips slide. All cards are one instanced mesh, all chips another.
 */

export const SB = 5,
  BB = 10;
export const BUY_IN = 1000;
const MIN_BUY = 100;
const NPC_BUY = 1000;
const MAX_CARDS = 40;
const MAX_CHIPS = 360;
const CARD_W = 0.063,
  CARD_H = 0.088;
const CHIP_H = 0.0034;
const BACK = 52;
const RACK: ChipDenom[] = [5, 25, 100, 500];
const LIVE_DIST = 13;
export const NUDGE_AFTER = 15;
export const AUTO_AFTER = 30;

/** The regulars who sit in for anyone who isn't here. */
const GUESTS_M: { name: string; style: NpcStyle }[] = [
  { name: 'Vinnie', style: { loose: 0.75, aggro: 0.8, bluff: 0.25 } },
  { name: 'Marcus', style: { loose: 0.5, aggro: 0.6, bluff: 0.12 } },
  { name: 'Sal', style: { loose: 0.62, aggro: 0.35, bluff: 0.08 } },
  { name: 'Dale', style: { loose: 0.45, aggro: 0.45, bluff: 0.18 } },
];
const GUESTS_F: { name: string; style: NpcStyle }[] = [
  { name: 'Eleanor', style: { loose: 0.25, aggro: 0.3, bluff: 0.04 } },
  { name: 'Priya', style: { loose: 0.4, aggro: 0.72, bluff: 0.15 } },
  { name: 'Margo', style: { loose: 0.35, aggro: 0.5, bluff: 0.1 } },
  { name: 'Rosa', style: { loose: 0.55, aggro: 0.55, bluff: 0.2 } },
];

export interface PokerCtx {
  sound: Sound;
  rng?: Rng;
  bankroll?: Bankroll;
  toast?(text: string, kind?: 'info' | 'win' | 'warn'): void;
  /** The dealer says something (subtitle / VR message). */
  say?(text: string): void;
  haptic?(side: 'left' | 'right', strength: number, ms: number): void;
  /** Your name (shown at the table). */
  name?(): string;
  /** Your head (world), for cards held up to look at. */
  head?(): THREE.Vector3;
  /** A hand's velocity (world, m/s) as you let go. */
  velocity?(hand: Hand): THREE.Vector3;
  /** A hand you played is over: what you put in, what you won. */
  onResult?(staked: number, returned: number): void;
  /** Get up from the table (screens: the Stand up button). */
  leave?(): void;
}

/** A player in a seat (the host's record; mirrored to guests). */
export interface PokerOwner {
  token: string;
  name: string;
  /** The friend's connection id (host side), or null for the host's own seat. */
  friend: string | null;
  /** Chips on the table (between hands; during a hand the hand has them). */
  stack: number;
}

export interface PokerRequest {
  a: 'sit' | 'leave' | 'act' | 'rebuy' | 'key';
  k?: number;
  buy?: number;
  id?: number;
  act?: PokerAction;
  pub?: string;
}

/** Network hooks, set by net/pokersync.ts. */
export interface PokerNet {
  role: 'host' | 'guest';
  request(d: PokerRequest & { me: string; name: string }): void;
  /** Host: the table changed. */
  changed(): void;
  /** Host: a new hand was dealt (seal the guests' hole cards). */
  dealt(): void;
}

interface CardObj {
  from: THREE.Vector3;
  to: THREE.Vector3;
  pos: THREE.Vector3;
  t0: number;
  born: number;
  ry: number;
  face: number;
  tilt: number;
  cell: number;
  seen: boolean;
  /** Table-local matrix while held in a VR hand. */
  held: THREE.Matrix4 | null;
  scale: number;
}

interface Flight {
  from: THREE.Vector3;
  to: THREE.Vector3;
  amount: number;
  t0: number;
  t1: number;
  /** Location whose shown amount waits for this to land. */
  into: string;
}

interface Gesture {
  who: Person;
  side: 'L' | 'R';
  t0: number;
  t1: number;
  at: (t: number, out: THREE.Vector3) => THREE.Vector3;
}

interface Carry {
  kind: 'rack' | 'stack';
  denom: ChipDenom;
  count: number;
  amount: number;
  mesh: THREE.Group;
  lastAdd: number;
  at: THREE.Vector3;
}

const chipHex = (d: ChipDenom) => parseInt(CHIP_COLORS[d][0].slice(1), 16);
const cardText = (c: Card) => (c.rank ? RANKS[c.rank - 1] + SUITS[c.suit] : '??');

/** An amount as chip columns: big chips broken down so stacks look like stacks. */
export function chipColumns(amount: number, minChips = 10, cap = 18): [ChipDenom, number][] {
  const denoms: ChipDenom[] = [500, 100, 25, 5];
  const n = [0, 0, 0, 0];
  let left = Math.max(0, Math.round(amount));
  denoms.forEach((d, i) => {
    n[i] = Math.floor(left / d);
    left -= n[i] * d;
  });
  const total = () => n.reduce((s, x) => s + x, 0);
  for (let guard = 0; guard < 40 && total() < minChips; guard++) {
    // Break one of the biggest chips into the next size down.
    const i = n.findIndex((x, j) => x > 0 && j < 3);
    if (i < 0) break;
    const k = denoms[i] / denoms[i + 1];
    if (n[i + 1] + k > cap) break;
    n[i]--;
    n[i + 1] += k;
  }
  const out: [ChipDenom, number][] = [];
  denoms.forEach((d, i) => {
    let c = n[i];
    while (c > 0) {
      out.push([d, Math.min(cap, c)]);
      c -= cap;
    }
  });
  return out;
}

export class PokerPlay {
  private cards: THREE.InstancedMesh;
  private cellAttr: THREE.InstancedBufferAttribute;
  private chips: THREE.InstancedMesh;
  private table: THREE.Group;
  private clock = 0;
  private live = false;
  private o = new THREE.Object3D();
  private v = new THREE.Vector3();
  private center: THREE.Vector3;
  private rng: Rng;

  // --- The game (authoritative on the host / solo; mirrored on a guest) ---
  readonly owners = new Map<number, PokerOwner>();
  readonly npcStacks: number[] = new Array(SEATS).fill(NPC_BUY);
  readonly npcNames: string[] = [];
  private npcStyles: NpcStyle[] = [];
  hand: PokerHand | null = null;
  handId = 0;
  button = 0;
  /** Seats played by a person in the current hand (seat → their token). */
  humansInHand = new Map<number, string>();
  /** The current hand's steps (host: the hand's own; guest: as received). */
  log: PokerStep[] = [];
  private startStacks: [number, number][] = [];
  /** Waiting seat's options as the host last said (guests). */
  private remoteLegal: Legal | null = null;
  private remoteWaiting: number | null = null;
  /** Guest: following the host's table (else the NPCs here play on their own). */
  mirror = false;
  net: PokerNet | null = null;

  // --- What the table shows ---
  view: TableView = newView([]);
  private cursor = 0;
  private nextAt = 0;
  private endedAt = Infinity;
  private nextHandAt = 2;
  private turnShownAt = Infinity;
  private thinkUntil = Infinity;
  private nudged = false;
  private cardObjs = new Map<string, CardObj>();
  private cardBorn = new Map<string, number>();
  private flights: Flight[] = [];
  private incoming = new Map<string, number>();
  private gestures: Gesture[] = [];
  private nodAt = -10;
  private persons: (Person | null)[] = [];
  private homes: { pos: THREE.Vector3; yaw: number }[];
  private rails: { pos: THREE.Vector3; yaw: number }[];
  private standing = new Set<number>();
  private labels: { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; mesh: THREE.Mesh; rows: string[] };

  // --- You ---
  readonly me = Math.random().toString(36).slice(2, 10);
  mySeat: number | null = null;
  /** Your hole cards on a guest (unsealed from the host). */
  myHole: { id: number; cards: Card[] } | null = null;
  private pendingBuy: { k: number; amount: number; t: number } | null = null;
  raiseTo = 0;
  /** Chips you've pushed out on your turn but the dealer hasn't taken as an action yet. */
  staged = 0;
  private stagedAt = 0;
  private stagedSent = false;
  private warned = '';
  private decided = { at: -10, steps: -1 };
  private peek = 0;
  private peekWant = 0;
  private myPut = 0;

  // --- VR ---
  readonly grabbables: Grabbable[] = [];
  readonly targets: Interactable[] = [];
  private rack: THREE.Group;
  private rebuyPlaque: THREE.Mesh;
  private readers = { left: new PokerSignalReader(), right: new PokerSignalReader() };
  private carries = new Map<Hand, Carry>();
  private vr = false;
  lastSignal: { side: string; signal: PokerSignal; t: number } | null = null;

  constructor(
    private ctx: PokerCtx,
    room: PokerRoom,
    private dealer: Person | null,
    seated: { person: Person | null; female: boolean }[],
  ) {
    this.rng = ctx.rng ?? { int: (n) => Math.floor(Math.random() * n) };
    this.table = room.table;
    this.center = room.table.getWorldPosition(new THREE.Vector3());
    this.homes = room.seats;
    this.rails = room.rail;
    const fm = [...GUESTS_F],
      mm = [...GUESTS_M];
    for (let k = 0; k < SEATS; k++) {
      const s = seated[k];
      const g = (s?.female ? fm : mm).shift() ?? GUESTS_M[k % GUESTS_M.length];
      this.npcNames.push(g.name);
      this.npcStyles.push(g.style);
      this.persons.push(s?.person ?? null);
    }
    const geo = new THREE.PlaneGeometry(CARD_W, CARD_H);
    geo.rotateX(-Math.PI / 2);
    this.cellAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARDS), 1);
    this.cellAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aCell', this.cellAttr);
    this.cards = new THREE.InstancedMesh(geo, cardMat(), MAX_CARDS);
    this.cards.count = 0;
    this.cards.frustumCulled = false;
    this.cards.raycast = () => {};
    this.cards.userData.dynamic = true;
    this.chips = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0195, 0.0195, CHIP_H * 0.97, 14), chipMat(), MAX_CHIPS);
    this.chips.count = 0;
    this.chips.frustumCulled = false;
    this.chips.raycast = () => {};
    this.chips.userData.dynamic = true;
    this.table.add(this.cards, this.chips);

    // Guests' hands move through `onPose` (animated characters).
    const pose = (who: Person) => (p: Person) => {
      if (!this.live) return;
      for (const g of this.gestures) {
        if (g.who !== who) continue;
        const w = envelope(this.clock, g.t0, g.t1, 0.2);
        if (w <= 0) continue;
        g.at(this.clock, this.v);
        this.table.localToWorld(this.v);
        handTo(p, g.side, this.v, w);
      }
      const n = (this.clock - this.nodAt) / 0.7;
      if (who === this.dealer && n > 0 && n < 1) p.rig?.bones['Head']?.rotateX(0.3 * Math.sin(n * Math.PI * 2) * (1 - n));
    };
    if (dealer) dealer.onPose = pose(dealer);
    for (const p of this.persons) if (p) p.onPose = pose(p);

    this.rack = this.buildRack();
    this.labels = this.buildLabels();
    // Rebuy (VR): a little brass plaque at your seat, pressed with a finger or the laser.
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 96;
    const g = c.getContext('2d')!;
    g.fillStyle = '#1a0e08';
    g.fillRect(0, 0, 256, 96);
    g.strokeStyle = '#d4a94e';
    g.lineWidth = 6;
    g.strokeRect(4, 4, 248, 88);
    g.fillStyle = '#ffe2a0';
    g.font = '600 34px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(`Rebuy ${money(BUY_IN)}`, 128, 50);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.rebuyPlaque = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.012), [
      ...new Array(4).fill(new THREE.MeshStandardMaterial({ color: 0xb08a3e, metalness: 0.9, roughness: 0.3 })),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
      new THREE.MeshStandardMaterial({ color: 0xb08a3e }),
    ]);
    this.rebuyPlaque.visible = false;
    this.rebuyPlaque.userData.dynamic = true;
    this.table.add(this.rebuyPlaque);
    this.targets.push({ object: this.rebuyPlaque, label: () => `Rebuy ${money(BUY_IN)}`, enabled: () => this.rebuyPlaque.visible, onSelect: () => this.rebuy() });
    // Your betting line as a betting felt (VR): point and press it to push out one chip at a time
    // (the chip you picked on your wallet tray), the same as at the other tables.
    const hit = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.44).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ visible: false }));
    hit.visible = false;
    hit.userData.dynamic = true;
    this.table.add(hit);
    this.betLine = hit;
    this.felt = {
      object: hit,
      kind: 'surface',
      pokeable: true,
      felt: true,
      enabled: () => this.vr && this.mySeat !== null,
      label: () => (this.isMyTurn ? `Bet ${money(this.chip)}${this.staged > 0 ? ` · ${money(this.staged)} out` : ''}` : null),
      onSelect: (e) => {
        this.dropChips(this.chip, e.hit.point);
      },
    };
    this.targets.push(this.felt);
  }

  /** The chip a pointing finger pushes out (chosen on the wallet tray, the watch or the HUD). */
  chip: ChipDenom = 25;
  /** Your betting line, pressed by a pointing finger (VR). */
  readonly felt: Interactable;
  private betLine: THREE.Mesh;

  /** Sitting in with a stack (the wallet tray deals from it while you're here). */
  get seated(): boolean {
    return this.mySeat !== null;
  }

  /** Chips this table plays with ($5 and up: the blinds are $5/$10). */
  allows(d: ChipDenom): boolean {
    return d >= SB;
  }

  /** Chips set down at a point (from the wallet tray or a fingertip): your bet if it's over your betting line on your turn. */
  betAt(world: THREE.Vector3, amount: number): boolean {
    return this.dropChips(amount, world);
  }

  /** Your money at this table (your stack, or the buy-in on its way to the seat), for the chip books. */
  get myStaked(): number {
    const k = this.mySeat;
    if (k === null) return 0;
    const o = this.owners.get(k);
    if (o && o.token === this.me) return this.myStack;
    return this.pendingBuy?.k === k ? this.pendingBuy.amount : 0;
  }

  // ===========================================================================
  // Geometry: each seat's spot on the felt
  // ===========================================================================

  /** A seat's frame (table-local): `o` its cards on the felt, `u` toward the player, `t` across to their left. */
  spot(k: number): { o: THREE.Vector3; u: THREE.Vector3; t: THREE.Vector3 } {
    const a = seatAngle(k);
    const o = new THREE.Vector3(Math.cos(a) * (FELT_A - 0.3), PK_TOP, Math.sin(a) * (FELT_B - 0.21));
    const chair = new THREE.Vector3(Math.cos(a) * (RAIL_A + 0.4), PK_TOP, Math.sin(a) * (RAIL_B + 0.42));
    const u = chair.sub(o).setY(0).normalize();
    return { o, u, t: new THREE.Vector3(-u.z, 0, u.x) };
  }

  private at(k: number, x: number, z: number, y = 0): THREE.Vector3 {
    const s = this.spot(k);
    return s.o.clone().addScaledVector(s.t, x).addScaledVector(s.u, z).setY(PK_TOP + y);
  }

  private stackPos = (k: number) => this.at(k, 0.15, 0.07);
  private betPos = (k: number) => this.at(k, 0, -0.2);
  private potPos = () => new THREE.Vector3(0, PK_TOP, 0.13);
  private boardPos = (i: number) => new THREE.Vector3((i - 2) * 0.075, PK_TOP + 0.0012 + i * 0.0002, -0.05);

  /** A world point in your seat's frame (see pokergesture.ts): x across, y up off the felt, z toward you. */
  spotLocal(world: THREE.Vector3, k = this.mySeat ?? 0): { x: number; y: number; z: number } {
    const l = this.table.worldToLocal(world.clone());
    const s = this.spot(k);
    const dx = l.x - s.o.x,
      dz = l.z - s.o.z;
    return { x: dx * s.t.x + dz * s.t.z, y: l.y - PK_TOP, z: dx * s.u.x + dz * s.u.z };
  }

  /** The inverse: a point in a seat's frame to world (tests and simulated hands). */
  spotWorld(p: { x: number; y: number; z: number }, k = this.mySeat ?? 0): THREE.Vector3 {
    return this.table.localToWorld(this.at(k, p.x, p.z, p.y));
  }

  get authority() {
    return !this.net || this.net.role === 'host';
  }

  /** Runs hands here: the host or solo, or a guest whose NPCs play on their own. */
  private get runs() {
    return this.authority || !this.mirror;
  }

  // ===========================================================================
  // Your turn
  // ===========================================================================

  /** You're in the current hand as a person (not someone you replaced). */
  get inHand(): boolean {
    const k = this.mySeat;
    if (k === null || this.humansInHand.get(k) !== this.me) return false;
    const s = this.view.seats.get(k);
    return !!s && s.inHand && !s.folded && !this.view.ended;
  }

  /** The display has caught up with the hand. */
  private get caughtUp() {
    return this.cursor >= this.log.length && this.clock >= this.nextAt;
  }

  private get waitingSeat(): number | null {
    if (this.authority || !this.mirror) return this.hand?.waiting ?? null;
    return this.remoteWaiting;
  }

  get isMyTurn(): boolean {
    return this.inHand && this.caughtUp && this.waitingSeat === this.mySeat && this.view.turn === this.mySeat;
  }

  /** What you may do now. */
  legal(): Legal | null {
    if (!this.isMyTurn) return null;
    if (this.log.length === this.decided.steps && this.clock - this.decided.at < 4) return null;
    return this.authority ? this.hand!.legal() : this.remoteLegal;
  }

  /** Your decision (buttons, a hand signal or chips pushed out). */
  decide(a: PokerAction): boolean {
    const L = this.legal();
    if (!L) return false;
    if (a.kind === 'check' && !L.check) return false;
    if (a.kind === 'call' && L.call <= 0) return false;
    if (a.kind === 'raise' && (!L.maxTo || a.to < L.minTo)) return false;
    this.decided = { at: this.clock, steps: this.log.length };
    this.request({ a: 'act', k: this.mySeat!, id: this.handId, act: a });
    this.nodAt = this.clock;
    this.ctx.sound.play('click', this.table.localToWorld(this.betPos(this.mySeat!)), { volume: 0.25 });
    return true;
  }

  /** Your hole cards as far as you know them. */
  myCards(): Card[] {
    const k = this.mySeat;
    if (k === null) return [];
    const s = this.view.seats.get(k);
    if (!s || !s.inHand || this.humansInHand.get(k) !== this.me) return [];
    if (s.cards.length === 2 && s.cards[0].rank) return s.cards;
    if (this.myHole && this.myHole.id === this.handId) return this.myHole.cards;
    return [];
  }

  /** Your stack: chips behind (what you can still bet). */
  get myStack(): number {
    const k = this.mySeat;
    if (k === null) return 0;
    const o = this.owners.get(k);
    if (!o || o.token !== this.me) return 0;
    const s = this.view.seats.get(k);
    if (s && this.humansInHand.get(k) === this.me && !this.view.ended) return s.stack;
    return o.stack;
  }

  // ===========================================================================
  // Sitting down, standing up, rebuying (bankroll ↔ table)
  // ===========================================================================

  /** Which seat you're on (null: not at the table). Called each frame by main. */
  setLocal(k: number | null) {
    if (k !== null && this.owners.has(k) && this.owners.get(k)!.token !== this.me) {
      k = null;
    }
    if (k === this.mySeat) return;
    if (this.mySeat !== null) this.cashOut();
    this.mySeat = k;
    this.staged = 0;
    if (k === null) {
      this.rack.visible = false;
      this.betLine.visible = false;
      return;
    }
    const bank = this.ctx.bankroll;
    const amount = bank ? Math.min(BUY_IN, Math.floor(bank.balance / 5) * 5) : BUY_IN;
    if (bank && amount < MIN_BUY) {
      this.ctx.toast?.(`You need ${money(MIN_BUY)} to sit in`, 'warn');
      this.mySeat = null;
      return;
    }
    bank?.debit(amount, 'bet', 'poker');
    this.pendingBuy = { k, amount, t: this.clock };
    this.request({ a: 'sit', k, buy: amount });
    const s = this.spot(k);
    const rp = this.at(k, -0.19, 0.13);
    this.rack.position.set(rp.x, PK_TOP + 0.002, rp.z);
    this.rack.rotation.y = Math.atan2(s.u.x, s.u.z);
    const bp = this.at(k, 0, -0.32, 0.001);
    this.betLine.position.copy(bp);
    this.betLine.rotation.y = Math.atan2(s.u.x, s.u.z);
    this.betLine.visible = this.vr;
    const pp = this.at(k, 0.2, 0.2, 0.05);
    this.rebuyPlaque.position.copy(pp);
    this.rebuyPlaque.rotation.set(-0.7, Math.atan2(s.u.x, s.u.z), 0, 'YXZ');
    this.ctx.toast?.(`Hold'em $${SB}/$${BB} · bought in for ${money(amount)}`, 'info');
    this.ctx.sound.play('chips', this.table.localToWorld(this.stackPos(k)), { volume: 0.4 });
  }

  /** Standing up: your chips go back to your bankroll (a hand you're in is folded). */
  private cashOut() {
    const k = this.mySeat!;
    const o = this.owners.get(k);
    let back = 0;
    if (o && o.token === this.me) back = this.myStack;
    else if (this.pendingBuy?.k === k) back = this.pendingBuy.amount;
    this.pendingBuy = null;
    if (back > 0) {
      this.ctx.bankroll?.credit(back, 'refund', 'poker');
      this.ctx.toast?.(`Cashed out ${money(back)}`, 'info');
    }
    this.request({ a: 'leave', k });
    if (this.authority) this.owners.delete(k);
  }

  canRebuy(): boolean {
    const k = this.mySeat;
    if (k === null || this.inHand) return false;
    const o = this.owners.get(k);
    return !!o && o.token === this.me && o.stack < BB * 2 && !!this.ctx.bankroll?.canAfford(MIN_BUY);
  }

  rebuy() {
    if (!this.canRebuy()) return;
    const bank = this.ctx.bankroll!;
    const amount = Math.min(BUY_IN, Math.floor(bank.balance / 5) * 5);
    bank.debit(amount, 'bet', 'poker');
    this.request({ a: 'rebuy', k: this.mySeat!, buy: amount });
    this.ctx.sound.play('chips', this.table.localToWorld(this.stackPos(this.mySeat!)), { volume: 0.4 });
    this.ctx.toast?.(`Rebought for ${money(amount)}`, 'info');
  }

  private request(d: PokerRequest) {
    if (this.authority) this.handle(this.me, this.ctx.name?.() ?? 'You', null, d);
    else this.net!.request({ ...d, me: this.me, name: this.ctx.name?.() ?? 'Guest' });
  }

  // ===========================================================================
  // The table (host / solo)
  // ===========================================================================

  /** Guests' public keys (host): token → hex, for sealing their cards (pokersync reads this). */
  readonly keys = new Map<string, string>();

  /** A player's request (the host's own, or a guest's over the net). */
  handle(token: string, name: string, friend: string | null, d: PokerRequest) {
    if (!this.authority) return;
    const k = Number.isInteger(d.k) ? (d.k as number) : -1;
    const o = this.owners.get(k);
    const mine = !!o && o.token === token;
    switch (d.a) {
      case 'sit': {
        const buy = Math.floor(Number(d.buy) || 0);
        if (k < 0 || k >= SEATS || (o && !mine) || buy < MIN_BUY || buy > 100000) return;
        for (const [kk, oo] of this.owners) if (oo.token === token && kk !== k) this.leaveSeat(kk);
        if (!mine) this.owners.set(k, { token, name: String(name).slice(0, 16), friend, stack: buy });
        break;
      }
      case 'leave':
        if (mine) this.leaveSeat(k);
        break;
      case 'rebuy': {
        const buy = Math.floor(Number(d.buy) || 0);
        if (!mine || buy < MIN_BUY || buy > 100000) return;
        o!.stack += buy;
        break;
      }
      case 'key':
        if (typeof d.pub === 'string' && d.pub.length < 700) this.keys.set(token, d.pub);
        break;
      case 'act': {
        if (!mine || d.id !== this.handId || !this.hand || this.humansInHand.get(k) !== token || !d.act) return;
        const a = d.act;
        const ok = ['fold', 'check', 'call', 'raise', 'allin'].includes(a.kind) && (a.kind !== 'raise' || Number.isFinite(Number((a as { to: number }).to)));
        if (!ok) return;
        const steps = this.hand.act(k, a.kind === 'raise' ? { kind: 'raise', to: Number(a.to) } : a);
        if (steps) this.feed();
        break;
      }
    }
    this.net?.changed();
  }

  private leaveSeat(k: number) {
    this.owners.delete(k);
    if (this.hand && !this.hand.done && this.humansInHand.has(k)) {
      this.hand.fold(k);
      this.humansInHand.delete(k);
      this.feed();
    }
  }

  /** A friend left the room: free their seat. */
  friendGone(id: string) {
    for (const [k, o] of this.owners) if (o.friend === id) this.leaveSeat(k);
    this.net?.changed();
  }

  /** The hand moved on (host / solo). */
  private feed() {
    if (this.hand) this.log = this.hand.steps;
    this.net?.changed();
  }

  private startHand() {
    const entries: { seat: number; stack: number }[] = [];
    const humans = new Map<number, string>();
    for (let k = 0; k < SEATS; k++) {
      const o = this.owners.get(k);
      if (o) {
        if (o.stack >= BB) {
          entries.push({ seat: k, stack: o.stack });
          humans.set(k, o.token);
        }
      } else {
        // The regulars reload when they're short.
        if (this.npcStacks[k] < BB * 20) this.npcStacks[k] = NPC_BUY;
        entries.push({ seat: k, stack: this.npcStacks[k] });
      }
    }
    if (entries.length < 2) return;
    // The button moves one seat clockwise to someone in the hand.
    const seats = entries.map((e) => e.seat);
    const next = seats.find((s) => s > this.button) ?? seats[0];
    this.button = next;
    this.handId++;
    this.humansInHand = humans;
    this.hand = new PokerHand(this.rng, entries, this.button, SB, BB);
    this.startStacks = entries.map((e) => [e.seat, e.stack]);
    this.beginHand();
    this.hand.start();
    this.feed();
    this.net?.dealt();
  }

  /** Host / solo: the hand is over; stacks go back to their owners. */
  private settleHand() {
    const h = this.hand;
    if (!h) return;
    for (const [seat, stack] of h.stacks()) {
      const tok = this.humansInHand.get(seat);
      const o = this.owners.get(seat);
      if (tok && o && o.token === tok) o.stack = stack;
      else if (!tok) this.npcStacks[seat] = stack;
    }
    this.hand = null;
    this.net?.changed();
  }

  // ===========================================================================
  // Two-player rooms: what the host sends and guests follow
  // ===========================================================================

  snapshot(): Record<string, unknown> {
    const L = this.hand && !this.hand.done ? this.hand.legal() : null;
    return {
      id: this.handId,
      b: this.button,
      o: [...this.owners].map(([k, o]) => [k, o.token, o.name, o.stack]),
      n: this.npcStacks.slice(),
      h: [...this.humansInHand],
      s0: this.startStacks,
      s: this.log.length ? packPoker(this.log) : [],
      w: this.hand?.waiting ?? -1,
      L: L ? [L.toCall, L.check ? 1 : 0, L.call, L.minTo, L.maxTo, L.bet, L.stack] : 0,
      ks: [...this.keys.keys()],
    };
  }

  /** Guest: the host's table as of now. */
  applySnapshot(d: Record<string, unknown>) {
    if (this.authority) return;
    this.owners.clear();
    if (Array.isArray(d.o))
      for (const r of d.o as unknown[][]) {
        const k = Number(r[0]);
        if (!Number.isInteger(k) || k < 0 || k >= SEATS) continue;
        this.owners.set(k, { token: String(r[1]), name: String(r[2]).slice(0, 16), friend: null, stack: Math.max(0, Number(r[3]) || 0) });
      }
    if (Array.isArray(d.n)) (d.n as unknown[]).forEach((v, i) => i < SEATS && (this.npcStacks[i] = Math.max(0, Number(v) || 0)));
    const mineThere = [...this.owners.values()].some((o) => o.token === this.me);
    if (mineThere) this.pendingBuy = null;
    const want = this.mySeat !== null || this.owners.size > 0;
    if (want && !this.mirror) {
      this.mirror = true;
      this.hand = null;
      this.handId = -1;
    }
    if (!this.mirror) return;
    if (!want) {
      // Nobody's playing at the host's table: our NPCs play on their own again.
      this.mirror = false;
      this.resetHand();
      return;
    }
    this.button = Number(d.b) || 0;
    const id = Number(d.id) || 0;
    const steps = unpackPoker(d.s);
    this.humansInHand = new Map(Array.isArray(d.h) ? (d.h as unknown[][]).map((r) => [Number(r[0]), String(r[1])] as [number, string]) : []);
    if (id !== this.handId) {
      this.handId = id;
      this.startStacks = Array.isArray(d.s0) ? (d.s0 as unknown[][]).map((r) => [Number(r[0]), Number(r[1])] as [number, number]) : [];
      this.beginHand();
    }
    if (steps.length >= this.log.length) this.log = steps;
    const w = Number(d.w);
    this.remoteWaiting = Number.isInteger(w) && w >= 0 ? w : null;
    const L = d.L as number[] | 0;
    this.remoteLegal = Array.isArray(L) ? { toCall: L[0], check: L[1] === 1, call: L[2], minTo: L[3], maxTo: L[4], bet: L[5], stack: L[6] } : null;
  }

  /** Guest: our sealed hole cards arrived (already unsealed by pokersync). */
  setHole(id: number, ids: number[]) {
    if (ids.length !== 2 || ids.some((n) => !Number.isInteger(n) || n < 0 || n > 51)) return;
    this.myHole = { id, cards: ids.map(idCard) };
  }

  /** Host: the hole cards of each person in this hand (for sealing). */
  holeCards(): { seat: number; token: string; ids: number[] }[] {
    if (!this.hand) return [];
    return [...this.humansInHand].map(([seat, token]) => ({ seat, token, ids: (this.hand!.player(seat)?.hole ?? []).map(cardId) }));
  }

  /** Back to the table's own game (left the room). */
  resetNet() {
    this.net = null;
    this.mirror = false;
    this.owners.clear();
    this.resetHand();
  }

  private resetHand() {
    this.hand = null;
    this.log = [];
    this.humansInHand.clear();
    this.view = newView([]);
    this.cursor = 0;
    this.cardObjs.clear();
    this.flights = [];
    this.incoming.clear();
    this.nextHandAt = this.clock + 2;
    this.endedAt = Infinity;
  }

  // ===========================================================================
  // Showing the hand: steps → cards, chips, gestures and sounds
  // ===========================================================================

  private beginHand() {
    this.log = [];
    this.cursor = 0;
    this.nextAt = this.clock + 0.4;
    this.view = newView(this.startStacks);
    // Last hand's cards still on the felt go to the muck.
    for (const key of [...this.cardObjs.keys()]) if (!key.startsWith(`${this.handId}:`)) this.cardObjs.delete(key);
    this.cardBorn.clear();
    this.flights = [];
    this.incoming.clear();
    this.endedAt = Infinity;
    this.turnShownAt = Infinity;
    this.thinkUntil = Infinity;
    this.staged = 0;
    this.stagedSent = false;
    this.myPut = 0;
    this.peek = 0;
  }

  private isNpc(k: number) {
    return !this.humansInHand.has(k);
  }

  private fly(from: THREE.Vector3, to: THREE.Vector3, amount: number, into: string, delay = 0, dur = 0.42) {
    if (amount <= 0) return;
    this.flights.push({ from: from.clone(), to: to.clone(), amount, t0: this.clock + delay, t1: this.clock + delay + dur, into });
    this.incoming.set(into, (this.incoming.get(into) ?? 0) + amount);
  }

  private gesture(who: Person | null | undefined, side: 'L' | 'R', t0: number, t1: number, at: Gesture['at']) {
    if (who) this.gestures.push({ who, side, t0, t1, at });
  }

  private sound(name: Parameters<Sound['play']>[0], local: THREE.Vector3, volume: number, rate = 1) {
    this.ctx.sound.play(name, this.table.localToWorld(local.clone()), { volume, rate });
  }

  /** Seconds a step takes to show. */
  private pace(st: PokerStep): number {
    switch (st.kind) {
      case 'button':
        return 0.3;
      case 'blind':
        return 0.45;
      case 'act':
        return st.act === 'fold' ? 0.55 : 0.75;
      case 'turn':
        return 0.05;
      case 'return':
        return 0.45;
      case 'collect':
        return 0.8;
      case 'board':
        return st.street === 'flop' ? 1.1 : 0.85;
      case 'show':
        return 0.9;
      case 'win':
        return 1.0;
      case 'end':
        return 0.5;
      default:
        return 0.2;
    }
  }

  /** Plays the next step(s) of the log onto the table. */
  private advanceDisplay() {
    while (this.cursor < this.log.length && this.clock >= this.nextAt) {
      const st = this.log[this.cursor];
      if (st.kind === 'deal') {
        // All the hole cards at once: one card each round the table, twice.
        const deals: Extract<PokerStep, { kind: 'deal' }>[] = [];
        while (this.cursor < this.log.length && this.log[this.cursor].kind === 'deal') deals.push(this.log[this.cursor++] as Extract<PokerStep, { kind: 'deal' }>);
        const n = deals.length;
        deals.forEach((d, i) => {
          // Only your own cards are ever known here (the host's screen hides the others too).
          const mine = d.seat === this.mySeat && this.humansInHand.get(d.seat) === this.me;
          applyStep(this.view, mine ? d : { ...d, cards: d.cards.map(() => ({ rank: 0, suit: 0 })) });
          for (let c = 0; c < 2; c++) {
            const t = this.clock + (c * n + i) * 0.14;
            this.cardBorn.set(`${this.handId}:h${d.seat}:${c}`, t);
            const tgt = this.at(d.seat, (c - 0.5) * 0.04, 0);
            this.gesture(this.dealer, 'R', t - 0.05, t + 0.3, (_t, out) => out.lerpVectors(DECK_AT, tgt, 0.35));
            this.ctx.sound.play('click', this.table.localToWorld(DECK_AT.clone()), { volume: 0.08, rate: 1.6 });
          }
        });
        this.nextAt = this.clock + n * 2 * 0.14 + 0.3;
        if (this.mySeat !== null && deals.some((d) => d.seat === this.mySeat) && this.humansInHand.get(this.mySeat) === this.me && this.vr)
          setTimeout(() => this.ctx.toast?.('Cup your cards (or pick them up) to look', 'info'), 1200);
        continue;
      }
      // Bets in front of players before the step (for chip flights).
      const bets = new Map([...this.view.seats].map(([k, s]) => [k, s.bet]));
      applyStep(this.view, st);
      this.cursor++;
      this.nextAt = this.clock + this.pace(st);
      this.animate(st, bets);
    }
  }

  private animate(st: PokerStep, bets: Map<number, number>) {
    const t = this.clock;
    const person = (k: number) => (this.isNpc(k) && !this.standing.has(k) ? this.persons[k] : null);
    switch (st.kind) {
      case 'button':
        this.sound('chip', this.at(st.seat, 0.1, -0.1), 0.2, 0.7);
        break;
      case 'blind':
        this.fly(this.stackPos(st.seat), this.betPos(st.seat), st.amount, `bet:${st.seat}`);
        this.sound('chip', this.betPos(st.seat), 0.35);
        break;
      case 'act': {
        const k = st.seat;
        const p = person(k);
        if (st.put > 0) {
          this.fly(this.stackPos(k), this.betPos(k), st.put, `bet:${k}`, 0.15);
          this.gesture(p, 'R', t, t + 0.75, (tt, out) => out.lerpVectors(this.stackPos(k), this.betPos(k), THREE.MathUtils.clamp((tt - t) / 0.5, 0, 1)).setY(PK_TOP + 0.04));
          this.sound(st.allIn ? 'chips' : 'chip', this.betPos(k), 0.45);
        } else if (st.act === 'check') {
          // Two knocks on the felt.
          this.gesture(p, 'R', t, t + 0.75, (tt, out) => out.copy(this.at(k, -0.02, -0.06, 0.012 + 0.05 * Math.abs(Math.sin((tt - t) * Math.PI * 3.2)))));
          this.sound('chip', this.at(k, 0, -0.06), 0.25, 0.4);
          setTimeout(() => this.sound('chip', this.at(k, 0, -0.06), 0.25, 0.42), 220);
        } else if (st.act === 'fold') {
          this.gesture(p, 'R', t, t + 0.6, (tt, out) => out.lerpVectors(this.at(k, 0, 0.02, 0.03), this.at(k, 0, -0.3, 0.03), THREE.MathUtils.clamp((tt - t) / 0.45, 0, 1)));
          this.sound('click', this.at(k, 0, -0.1), 0.15, 0.8);
        }
        if (k === this.mySeat && this.humansInHand.get(k) === this.me) {
          this.staged = 0;
          this.stagedSent = false;
          this.myPut += st.put;
          this.nodAt = t;
          if (this.ctx.say) this.ctx.say(st.act === 'fold' ? 'Fold.' : st.act === 'check' ? 'Check.' : st.act === 'call' ? `Call, ${money(st.to)}.` : st.act === 'allin' ? 'All in!' : `${st.act === 'bet' ? 'Bet' : 'Raise to'} ${money(st.to)}.`);
        } else if (!this.isNpc(k)) this.nodAt = t;
        break;
      }
      case 'turn': {
        const k = st.seat;
        this.turnShownAt = t;
        this.nudged = false;
        if (this.isNpc(k)) this.thinkUntil = t + 0.8 + this.rng.int(1400) / 1000;
        if (k === this.mySeat && this.humansInHand.get(k) === this.me) {
          this.ctx.sound.play('ding', this.table.localToWorld(this.betPos(k)), { volume: 0.18 });
          for (const side of ['left', 'right'] as const) this.ctx.haptic?.(side, 0.3, 60);
          this.raiseTo = 0;
        }
        // The dealer's open palm toward whoever's turn it is.
        this.gesture(this.dealer, 'L', t, t + 1.0, (_t, out) => out.copy(this.betPos(k)).lerp(DECK_AT, 0.55).setY(PK_TOP + 0.12));
        break;
      }
      case 'return':
        this.fly(this.betPos(st.seat), this.stackPos(st.seat), st.amount, `stack:${st.seat}`);
        break;
      case 'collect': {
        let i = 0;
        for (const [k, b] of bets) if (b > 0) this.fly(this.betPos(k), this.potPos(), b, 'pot', 0.06 * i++, 0.5);
        this.gesture(this.dealer, 'R', t, t + 0.8, (tt, out) => out.copy(this.potPos()).add(new THREE.Vector3(Math.sin((tt - t) * 6) * 0.25, 0.04, 0)));
        this.sound('chips', this.potPos(), 0.4);
        break;
      }
      case 'board': {
        const first = this.view.board.length - st.cards.length;
        st.cards.forEach((_, j) => {
          const i = first + j;
          this.cardBorn.set(`${this.handId}:b${i}`, t + j * 0.18);
          this.gesture(this.dealer, 'R', t + j * 0.18, t + j * 0.18 + 0.4, (_t, out) => out.lerpVectors(DECK_AT, this.boardPos(i), 0.6).setY(PK_TOP + 0.04));
        });
        this.sound('click', DECK_AT, 0.2, 1.3);
        break;
      }
      case 'show':
        this.sound('click', this.at(st.seat, 0, 0), 0.25, 1.1);
        break;
      case 'win': {
        const k = st.seat;
        this.fly(this.potPos(), this.stackPos(k), st.amount, `stack:${k}`, 0.1, 0.65);
        this.gesture(this.dealer, 'R', t, t + 1.0, (tt, out) => out.lerpVectors(this.potPos(), this.betPos(k), THREE.MathUtils.clamp((tt - t) / 0.8, 0, 1)).setY(PK_TOP + 0.05));
        this.sound('chips', this.potPos(), 0.55);
        const name = this.seatName(k);
        const s = this.view.seats.get(k);
        const hand = s?.hand ? ` with ${s.hand}` : '';
        if (k === this.mySeat && this.humansInHand.get(k) === this.me) {
          this.ctx.toast?.(`You win ${money(st.amount)}${hand}!`, 'win');
          for (const side of ['left', 'right'] as const) this.ctx.haptic?.(side, 0.7, 120);
        } else if (this.mySeat !== null) this.ctx.toast?.(`${name} wins ${money(st.amount)}${hand}`, 'info');
        break;
      }
      case 'end': {
        this.endedAt = t;
        const k = this.mySeat;
        if (k !== null && this.humansInHand.get(k) === this.me) {
          const won = this.view.seats.get(k)?.won ?? 0;
          this.ctx.onResult?.(this.myPut, won);
        }
        break;
      }
    }
  }

  seatName(k: number): string {
    const o = this.owners.get(k);
    if (o && this.humansInHand.get(k) === o.token) return o.token === this.me ? 'You' : o.name;
    if (o && !this.humansInHand.has(k)) return this.npcNames[k];
    return o ? o.name : this.npcNames[k];
  }

  // ===========================================================================
  // VR: the rack, your stack, your cards
  // ===========================================================================

  private buildRack(): THREE.Group {
    const g = new THREE.Group();
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.06), new THREE.MeshStandardMaterial({ color: 0x2a1408, roughness: 0.4 }));
    tray.position.y = 0.006;
    g.add(tray);
    const per = 10;
    const inst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0195, 0.0195, 0.0033, 16), new THREE.MeshStandardMaterial({ roughness: 0.45 }), RACK.length * per);
    const tmp = new THREE.Object3D();
    RACK.forEach((d, i) => {
      const x = (i - (RACK.length - 1) / 2) * 0.046;
      for (let k = 0; k < per; k++) {
        tmp.position.set(x, 0.012 + 0.0017 + k * 0.0033, 0);
        tmp.updateMatrix();
        inst.setMatrixAt(i * per + k, tmp.matrix);
        inst.setColorAt(i * per + k, new THREE.Color(chipHex(d)));
      }
      const top = new THREE.Vector3(x, 0.012 + per * 0.0033, 0);
      this.grabbables.push({
        at: () => g.localToWorld(top.clone()),
        radius: 0.035,
        enabled: () => g.visible,
        grab: (hand) => {
          if (this.available() < d) {
            this.ctx.sound.play('denied', g, { volume: 0.4 });
            return null;
          }
          const mesh = new THREE.Group();
          mesh.add(makeChip(d));
          this.table.add(mesh);
          const at = g.localToWorld(top.clone());
          this.carries.set(hand, { kind: 'rack', denom: d, count: 1, amount: d, mesh, lastAdd: this.clock, at });
          this.ctx.sound.play('chip', at, { volume: 0.5 });
          return 'drag';
        },
        drag: (hand, pos) => this.dragChips(hand, pos),
        release: (hand, pos) => this.releaseChips(hand, pos),
      });
    });
    inst.raycast = () => {};
    g.add(inst);
    g.visible = false;
    g.userData.dynamic = true;
    this.table.add(g);
    // Your whole stack (grab it and push it out: all in).
    this.grabbables.push({
      at: () => this.table.localToWorld(this.stackPos(this.mySeat ?? 0).setY(PK_TOP + 0.02)),
      radius: 0.05,
      enabled: () => this.vr && this.inHand && this.available() > 0,
      grab: (hand) => {
        const amount = this.available();
        if (amount <= 0) return null;
        const mesh = new THREE.Group();
        let y = 0;
        for (const [d, n] of chipColumns(amount, 6, 8).slice(0, 4))
          for (let i = 0; i < Math.min(n, 6); i++) {
            const c = makeChip(d);
            c.position.y = (y++ % 12) * CHIP_H;
            mesh.add(c);
          }
        this.table.add(mesh);
        this.carries.set(hand, { kind: 'stack', denom: 500, count: 1, amount, mesh, lastAdd: this.clock, at: new THREE.Vector3() });
        this.ctx.sound.play('chips', this.table.localToWorld(this.stackPos(this.mySeat!)), { volume: 0.5 });
        return 'drag';
      },
      drag: (hand, pos) => this.dragChips(hand, pos),
      release: (hand, pos) => this.releaseChips(hand, pos),
    });
    // Your cards: pick them up to look, toss them toward the dealer to fold.
    this.grabbables.push({
      at: () => this.table.localToWorld(this.at(this.mySeat ?? 0, 0, 0, 0.01)),
      radius: 0.06,
      enabled: () => this.vr && this.inHand && this.myCards().length === 2,
      grab: (hand) => {
        return 'drag';
      },
      drag: (_hand, pos) => this.holdCards(pos),
      release: (hand, pos) => this.releaseCards(hand, pos),
    });
    return g;
  }

  /** Chips you can still push out: your stack less what's already out. */
  available(): number {
    return Math.max(0, this.myStack - this.staged);
  }

  private dragChips(hand: Hand, pos: THREE.Vector3) {
    const c = this.carries.get(hand);
    if (!c) return;
    c.mesh.position.copy(this.table.worldToLocal(pos.clone()));
    // Holding your hand at the rack scoops more chips, one at a time.
    if (c.kind === 'rack' && pos.distanceTo(c.at) < 0.07 && this.clock - c.lastAdd > 0.28 && c.count < 10 && this.available() >= c.amount + c.denom) {
      const chip = makeChip(c.denom);
      chip.position.y = c.count * CHIP_H;
      c.mesh.add(chip);
      c.count++;
      c.amount += c.denom;
      c.lastAdd = this.clock;
      this.ctx.haptic?.(this.sideOf(hand), 0.2, 15);
      this.ctx.sound.play('chip', pos, { volume: 0.3, rate: 1.1 });
    }
  }

  private sideOf(hand: Hand): 'left' | 'right' {
    return hand.ctrl.userData.handedness === 'left' ? 'left' : 'right';
  }

  private releaseChips(hand: Hand, pos: THREE.Vector3) {
    const c = this.carries.get(hand);
    this.carries.delete(hand);
    if (!c) return;
    c.mesh.removeFromParent();
    this.dropChips(c.amount, pos, hand, c.kind === 'stack');
  }

  /** Chips let go of over the table: over the betting line on your turn they're your bet; else back to your stack. */
  dropChips(amount: number, world: THREE.Vector3, hand?: Hand, whole = false): boolean {
    const k = this.mySeat;
    if (k === null) return false;
    const l = this.spotLocal(world, k);
    const out = Math.abs(l.x) < 0.32 && l.z < -0.05 && l.z > -0.55 && l.y < 0.3 && l.y > -0.05;
    if (!out) {
      this.ctx.sound.play('chip', world, { volume: 0.3, rate: 0.8 });
      return false;
    }
    if (!this.isMyTurn) {
      this.ctx.toast?.(this.inHand ? 'Wait for your turn' : 'Wait for the next hand', 'info');
      this.ctx.sound.play('chip', world, { volume: 0.3, rate: 0.8 });
      return false;
    }
    const add = whole ? this.available() : Math.min(amount, this.available());
    if (add <= 0) return false;
    this.staged += add;
    this.stagedAt = this.clock;
    this.stagedSent = false;
    this.warned = '';
    if (hand) this.ctx.haptic?.(this.sideOf(hand), 0.45, 35);
    this.ctx.sound.play('chip', world, { volume: 0.5, rate: 0.95 + Math.random() * 0.1 });
    return true;
  }

  /** Chips out on your turn become your action once you stop adding (sooner when they're exactly a call or all you have). */
  private commitStaged() {
    const S = this.staged;
    if (S <= 0 || this.stagedSent) return;
    const L = this.legal();
    if (!L) return;
    const quiet = this.clock - this.stagedAt;
    const allIn = S >= L.stack;
    const exact = L.call > 0 && S === L.call;
    // Long enough to press out chip after chip with a pointing finger (or scoop more from the tray) before it counts.
    if (quiet < (allIn ? 0.5 : exact ? 1 : 2)) return;
    const r = stagedAction(L, S);
    if (!r) return;
    if ('say' in r) {
      if (this.warned === r.say) return;
      this.warned = r.say;
      this.ctx.toast?.(r.say, 'info');
      return;
    }
    if (this.decide(r.action)) this.stagedSent = true;
  }

  private holdCards(pos: THREE.Vector3) {
    // Cards held up in your hand, faces toward your eyes.
    const head = this.ctx.head?.() ?? pos.clone().add(new THREE.Vector3(0, 0.3, 0.3));
    const m = new THREE.Matrix4().lookAt(head, pos, new THREE.Vector3(0, 1, 0));
    // A card's face points up (+y); turn it to face the head (+z of lookAt is toward the eye).
    m.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    m.setPosition(pos);
    const inv = new THREE.Matrix4().copy(this.table.matrixWorld).invert();
    this.heldMatrix = inv.multiply(m);
  }
  private heldMatrix: THREE.Matrix4 | null = null;

  private releaseCards(hand: Hand, pos: THREE.Vector3) {
    this.heldMatrix = null;
    const k = this.mySeat;
    if (k === null) return;
    const l = this.spotLocal(pos, k);
    const v = this.ctx.velocity?.(hand) ?? new THREE.Vector3();
    const s = this.spot(k);
    const uw = s.u.clone().transformDirection(this.table.matrixWorld);
    const forward = -v.dot(uw);
    if ((l.z < -0.2 && l.y < 0.35) || forward > 1.1) {
      if (this.isMyTurn && this.decide({ kind: 'fold' })) {
        this.lastSignal = { side: this.sideOf(hand), signal: 'fold', t: this.clock };
        this.ctx.haptic?.(this.sideOf(hand), 0.5, 50);
      } else if (!this.isMyTurn) this.ctx.toast?.('Wait for your turn to fold', 'info');
    }
  }

  /**
   * Your real hands over the table (VR), each frame: fingertip and palm
   * (world), how open the hand is. Cupping a hand over your cards lifts them
   * for you to see; on your turn a double knock checks and a sweep folds.
   */
  handInput(side: 'left' | 'right', tip: THREE.Vector3 | null, palm: THREE.Vector3 | null, open: number, t: number, pointing = false): PokerSignal | null {
    const k = this.mySeat;
    const reader = this.readers[side];
    // A pointing finger is betting chips on the felt, not knocking it.
    if (k === null || !this.inHand || pointing) {
      reader.reset();
      return null;
    }
    const lt = tip ? this.spotLocal(tip, k) : null;
    const lp = palm ? this.spotLocal(palm, k) : null;
    const near = lp ?? lt;
    if (near && Math.hypot(near.x, near.z - 0.04) < 0.13 && near.y < 0.16 && near.y > -0.03) this.peekWant = Math.max(this.peekWant, 1);
    if (!this.isMyTurn) {
      reader.reset();
      return null;
    }
    const sig = reader.update({ t, tip: lt, palm: lp, open });
    if (!sig) return null;
    const L = this.legal();
    if (sig === 'check' && L && !L.check) {
      this.ctx.toast?.(`${money(L.call)} to call: you can't check`, 'info');
      this.ctx.sound.play('denied', this.table.localToWorld(this.betPos(k)), { volume: 0.3 });
      return sig;
    }
    if (this.decide(sig === 'check' ? { kind: 'check' } : { kind: 'fold' })) {
      this.lastSignal = { side, signal: sig, t };
      this.ctx.haptic?.(side, 0.6, 45);
      this.readers.left.reset();
      this.readers.right.reset();
    }
    return sig;
  }

  /** Show the chip rack (VR only; screens use buttons). */
  showRack(v: boolean) {
    this.vr = v;
    this.rack.visible = v && this.mySeat !== null;
    this.betLine.visible = this.rack.visible;
  }

  // ===========================================================================
  // Screens
  // ===========================================================================

  controls(): Control[] | null {
    const k = this.mySeat;
    if (k === null) return null;
    const out: Control[] = [];
    const mine = this.myCards();
    const board = this.view.board;
    if (mine.length === 2) {
      const name = board.length >= 3 ? evaluate([...mine, ...board]).name : mine[0].rank === mine[1].rank ? 'Pocket pair' : 'Preflop';
      out.push({ id: 'pkcards', label: mine.map(cardText).join(' '), sub: name, kind: 'plain', disabled: true, onPress: () => {} });
    }
    const L = this.legal();
    if (L) {
      const minTo = L.minTo,
        maxTo = L.maxTo;
      if (maxTo) this.raiseTo = THREE.MathUtils.clamp(this.raiseTo || minTo, minTo, maxTo);
      out.push({ id: 'pkfold', label: 'FOLD', kind: 'primary', onPress: () => this.decide({ kind: 'fold' }) });
      if (L.check) out.push({ id: 'pkcheck', label: 'CHECK', kind: 'primary', onPress: () => this.decide({ kind: 'check' }) });
      else out.push({ id: 'pkcall', label: L.call >= L.stack ? 'CALL ALL IN' : 'CALL', sub: money(L.call), kind: 'primary', onPress: () => this.decide({ kind: 'call' }) });
      if (maxTo && maxTo > minTo) {
        out.push({
          id: 'pkslider',
          label: '',
          kind: 'slider',
          min: minTo,
          max: maxTo,
          step: 5,
          value: this.raiseTo,
          onPress: () => {},
          onInput: (v) => (this.raiseTo = Math.round(v / 5) * 5 >= maxTo - 2 ? maxTo : Math.max(minTo, Math.round(v / 5) * 5)),
        });
      }
      if (maxTo) {
        const all = this.raiseTo >= maxTo;
        out.push({ id: 'pkraise', label: all ? 'ALL IN' : L.check && L.bet === 0 ? 'BET' : 'RAISE TO', sub: money(this.raiseTo), onPress: () => this.decide(all ? { kind: 'allin' } : { kind: 'raise', to: this.raiseTo }) });
        if (!all) out.push({ id: 'pkallin', label: 'All in', sub: money(maxTo), onPress: () => this.decide({ kind: 'allin' }) });
      }
      return out;
    }
    const o = this.owners.get(k);
    const status = !o || o.token !== this.me ? 'Sitting down…' : this.inHand ? 'Waiting…' : this.view.seats.get(k)?.folded && !this.view.ended ? 'Folded' : 'Next hand soon';
    out.push({ id: 'pkstatus', label: status, sub: `stack ${money(this.myStack)} · pot ${money(this.view.pot + [...this.view.seats.values()].reduce((s, x) => s + x.bet, 0))}`, kind: 'plain', disabled: true, onPress: () => {} });
    if (this.canRebuy()) out.push({ id: 'pkrebuy', label: 'Rebuy', sub: money(Math.min(BUY_IN, this.ctx.bankroll?.balance ?? 0)), kind: 'primary', onPress: () => this.rebuy() });
    if (this.ctx.leave) out.push({ id: 'pkleave', label: 'Stand up', sub: `cash out ${money(this.myStack)}`, onPress: () => this.ctx.leave?.() });
    return out;
  }

  // ===========================================================================
  // Labels: name, stack and last action at every seat (one billboard mesh)
  // ===========================================================================

  private buildLabels() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const g = canvas.getContext('2d')!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const n = SEATS + 1;
    const pos = new Float32Array(n * 4 * 3);
    const uv = new Float32Array(n * 4 * 2);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const v0 = 1 - (i * 72) / 512,
        v1 = 1 - ((i + 1) * 72 - 4) / 512;
      uv.set([0, v0, 1, v0, 0, v1, 1, v1], i * 8);
      idx.push(i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    mesh.userData.dynamic = true;
    mesh.renderOrder = 2;
    this.table.add(mesh);
    return { canvas, g, tex, mesh, rows: new Array(n).fill('') };
  }

  private drawLabels(camLocal: THREE.Vector3) {
    const L = this.labels;
    const pos = L.mesh.geometry.attributes.position as THREE.BufferAttribute;
    let dirty = false;
    const quad = (i: number, c: THREE.Vector3, w: number, h: number, show: boolean) => {
      if (!show) {
        for (let j = 0; j < 4; j++) pos.setXYZ(i * 4 + j, 0, -10, 0);
        return;
      }
      const f = camLocal.clone().sub(c);
      const right = new THREE.Vector3(f.z, 0, -f.x).normalize().multiplyScalar(w / 2);
      const up = new THREE.Vector3(0, h / 2, 0);
      pos.setXYZ(i * 4, c.x - right.x + up.x, c.y + up.y, c.z - right.z);
      pos.setXYZ(i * 4 + 1, c.x + right.x, c.y + up.y, c.z + right.z);
      pos.setXYZ(i * 4 + 2, c.x - right.x, c.y - up.y, c.z - right.z);
      pos.setXYZ(i * 4 + 3, c.x + right.x, c.y - up.y, c.z + right.z);
    };
    const playing = this.log.length > 0 || this.owners.size > 0;
    for (let k = 0; k < SEATS; k++) {
      const s = this.view.seats.get(k);
      const human = this.owners.has(k);
      const stack = s && !this.view.ended ? s.stack - (this.incoming.get(`stack:${k}`) ?? 0) : human ? this.owners.get(k)!.stack : this.npcStacks[k];
      const shownStack = k === this.mySeat ? stack - this.staged : stack;
      const turn = this.view.turn === k && this.caughtUp;
      const last = s?.shown && s.hand ? s.hand : s?.last ?? '';
      const text = [this.seatName(k), money(Math.max(0, shownStack)), last, turn ? 1 : 0, s?.folded ? 1 : 0, human ? 1 : 0].join('|');
      if (L.rows[k] !== text) {
        L.rows[k] = text;
        this.drawRow(k, this.seatName(k), money(Math.max(0, shownStack)), last, turn, !!s?.folded, human);
        dirty = true;
      }
      const c = this.at(k, 0, -0.36, 0.1);
      quad(k, c, 0.3, 0.042, playing && this.live);
    }
    const pot = this.view.pot + [...this.view.seats.values()].reduce((a, x) => a + x.bet, 0) + this.staged;
    const ptext = pot > 0 && !this.view.ended ? `Pot ${money(pot)}` : '';
    if (L.rows[SEATS] !== ptext) {
      L.rows[SEATS] = ptext;
      this.drawRow(SEATS, ptext, '', '', false, false, false);
      dirty = true;
    }
    quad(SEATS, this.potPos().setY(PK_TOP + 0.13), 0.22, 0.031, !!ptext && this.live);
    pos.needsUpdate = true;
    if (dirty) L.tex.needsUpdate = true;
  }

  private drawRow(i: number, name: string, stack: string, last: string, turn: boolean, folded: boolean, human: boolean) {
    const g = this.labels.g;
    const y = i * 72;
    g.clearRect(0, y, 512, 72);
    if (!name) return;
    g.fillStyle = turn ? 'rgba(60,40,6,0.88)' : 'rgba(10,8,6,0.72)';
    g.beginPath();
    g.roundRect(2, y + 2, 508, 66, 18);
    g.fill();
    g.strokeStyle = turn ? '#ffd56a' : human ? '#8fc8ff' : '#a8844a';
    g.lineWidth = turn ? 5 : 2.5;
    g.stroke();
    g.textBaseline = 'middle';
    if (i === SEATS) {
      g.fillStyle = '#ffe9b8';
      g.font = '600 40px Georgia, serif';
      g.textAlign = 'center';
      g.fillText(name, 256, y + 37);
      return;
    }
    g.globalAlpha = folded ? 0.55 : 1;
    g.fillStyle = '#ffffff';
    g.font = '600 28px Georgia, serif';
    g.textAlign = 'left';
    g.fillText(name, 18, y + 22);
    g.fillStyle = '#ffe28a';
    g.textAlign = 'right';
    g.fillText(stack, 494, y + 22);
    g.fillStyle = last.startsWith('Wins') ? '#8cff9a' : '#e8d8c0';
    g.font = 'italic 26px Georgia, serif';
    g.textAlign = 'center';
    g.fillText(last, 256, y + 52);
    g.globalAlpha = 1;
  }

  // ===========================================================================
  // Each frame
  // ===========================================================================

  /** Guests who give up their chair stand by the wall; they sit back down when it's free. */
  private placeGuests() {
    for (let k = 0; k < SEATS; k++) {
      const p = this.persons[k];
      if (!p) continue;
      // A person takes the chair once the regular's last hand there is over.
      const stand = this.owners.has(k) && !(this.hand && !this.hand.done && this.isNpc(k) && this.view.seats.get(k)?.inHand && !this.view.seats.get(k)?.folded);
      if (stand === this.standing.has(k)) continue;
      if (stand) {
        this.standing.add(k);
        const r = this.rails[k % this.rails.length];
        p.pos.copy(r.pos);
        p.yaw = p.homeYaw = r.yaw;
        p.seated = false;
      } else {
        this.standing.delete(k);
        p.pos.copy(this.homes[k].pos);
        p.yaw = p.homeYaw = this.homes[k].yaw;
        p.seated = true;
        p.seatY = 0.62;
      }
    }
  }

  update(dt: number, playerPos: THREE.Vector3, camera?: THREE.Camera) {
    this.live = playerPos.distanceTo(this.center) < LIVE_DIST || this.mySeat !== null || this.owners.size > 0;
    if (!this.live) {
      this.labels.mesh.visible = false;
      return;
    }
    this.labels.mesh.visible = true;
    this.clock += Math.min(dt, 0.1);
    const t = this.clock;
    // A seat that never came through: the chips go back.
    if (this.pendingBuy && !this.authority && t - this.pendingBuy.t > 6) {
      if (this.mySeat === this.pendingBuy.k) {
        this.ctx.bankroll?.credit(this.pendingBuy.amount, 'refund', 'poker');
        this.ctx.toast?.("Couldn't get that seat", 'warn');
        this.mySeat = null;
      }
      this.pendingBuy = null;
    }
    if (this.authority && this.pendingBuy && this.owners.get(this.pendingBuy.k)?.token === this.me) this.pendingBuy = null;
    if (this.runs) this.tick();
    this.advanceDisplay();
    this.placeGuests();
    this.gestures = this.gestures.filter((g) => g.t1 > t);
    this.commitStaged();
    // Your turn: nudge, then the dealer acts for you (host decides; guests just see it).
    if (this.isMyTurn && t - this.turnShownAt > NUDGE_AFTER && !this.nudged) {
      this.nudged = true;
      this.ctx.toast?.('Your turn: knock to check, push chips to bet, or sweep your cards to fold', 'info');
      this.nodAt = t;
    }
    this.peek += (this.peekWant - this.peek) * Math.min(1, dt * 10);
    this.peekWant = 0;
    this.rebuyPlaque.visible = this.vr && this.canRebuy();
    this.renderCards(dt);
    this.renderChips();
    if (camera) this.drawLabels(this.table.worldToLocal(camera.getWorldPosition(new THREE.Vector3())));
  }

  /** Host / solo: deal hands, let NPCs think, time players out. */
  private tick() {
    const t = this.clock;
    const h = this.hand;
    if (!h) {
      if (t >= this.nextHandAt) this.startHand();
      return;
    }
    if (h.done) {
      if (this.caughtUp && t - this.endedAt > 3.2) {
        this.settleHand();
        this.nextHandAt = t + 0.6;
      }
      return;
    }
    if (!this.caughtUp) return;
    const w = h.waiting;
    if (w === null) return;
    const human = this.humansInHand.get(w);
    const owner = this.owners.get(w);
    if (!human) {
      // A regular who gave up the seat folds; the others think it over.
      if (owner) {
        if (t - this.turnShownAt > 0.6) this.npcAct(w, { kind: 'fold' });
        return;
      }
      if (t < this.thinkUntil) return;
      const p = h.player(w)!;
      const live = h.players.filter((q) => !q.folded).length - 1;
      const a = npcDecide({ hole: p.hole, board: h.board, legal: h.legal(), pot: h.totalPot, opponents: live, bb: BB }, this.npcStyles[w], this.rng as Rng & { next?(): number });
      this.npcAct(w, a);
      return;
    }
    if (!owner || owner.token !== human) {
      // They left: fold their hand.
      h.fold(w);
      this.feed();
      return;
    }
    const waited = t - this.turnShownAt;
    if (waited > AUTO_AFTER) {
      const L = h.legal();
      h.act(w, L.check ? { kind: 'check' } : { kind: 'fold' });
      if (w === this.mySeat) this.ctx.toast?.(L.check ? 'The dealer checked for you' : 'The dealer folded your hand', 'info');
      this.feed();
    } else if (waited > NUDGE_AFTER && !this.nudged && w !== this.mySeat) {
      this.nudged = true;
      this.nodAt = t;
    }
  }

  private npcAct(seat: number, a: PokerAction) {
    const h = this.hand!;
    if (!h.act(seat, a)) h.act(seat, h.legal().check ? { kind: 'check' } : { kind: 'fold' });
    this.feed();
  }

  /** A card's place on the table now (table-local), and whether its face shows. */
  private renderCards(dt: number) {
    const t = this.clock;
    const want = new Map<string, { p: THREE.Vector3; ry: number; face: number; tilt: number; cell: number; held?: THREE.Matrix4 | null; scale?: number }>();
    const id = this.handId;
    const sweep = t - this.endedAt > 2.6;
    const mine = this.myCards();
    for (const [k, s] of this.view.seats) {
      if (!s.inHand) continue;
      const sp = this.spot(k);
      const ry = Math.atan2(sp.u.x, sp.u.z);
      const meHere = k === this.mySeat && this.humansInHand.get(k) === this.me;
      for (let c = 0; c < 2; c++) {
        const key = `${id}:h${k}:${c}`;
        const card = meHere && mine.length === 2 ? mine[c] : s.cards[c];
        const cell = card && card.rank ? card.suit * 13 + card.rank - 1 : BACK;
        let p = this.at(k, (c - 0.5) * 0.036, c * 0.004, 0.0012 + c * 0.0007);
        let face = s.shown ? 1 : 0;
        let tilt = 0;
        let ryc = ry + (c - 0.5) * 0.12;
        let held: THREE.Matrix4 | null = null;
        let scale = 1;
        if (s.folded || sweep) {
          p = MUCK_AT.clone().add(new THREE.Vector3(c * 0.01, c * 0.0007, 0));
          face = 0;
          ryc = 0.4 + c * 0.3;
        } else if (meHere && !s.shown && cell !== BACK) {
          if (this.heldMatrix) held = this.heldMatrix.clone().multiply(new THREE.Matrix4().makeTranslation((c - 0.5) * 0.035, 0.001 * c, 0));
          else {
            // Screens: your cards stand up facing you. VR: they lift as you cup them.
            const lift = this.vr ? this.peek : 1;
            tilt = lift * (this.vr ? 1.15 : 1.0);
            face = lift > 0.05 ? 1 : 0;
            // On a screen they're shown a bit larger, spread, and nearer you so you can read them.
            if (!this.vr) {
              scale = 1.45;
              p = this.at(k, (c - 0.5) * 0.075, 0.07, 0.0012);
              ryc = ry + (c - 0.5) * 0.1;
            }
            p.addScaledVector(sp.u, 0.03 * lift).y += Math.sin(tilt) * CARD_H * 0.5 * scale + 0.01 * lift;
          }
        }
        want.set(key, { p, ry: ryc, face, tilt, cell, held, scale });
      }
    }
    this.view.board.forEach((card, i) => {
      const key = `${id}:b${i}`;
      want.set(key, { p: sweep ? MUCK_AT.clone().setY(PK_TOP + 0.003 + i * 0.0007) : this.boardPos(i), ry: Math.PI / 2 * 0 + (sweep ? 0.6 : 0), face: sweep ? 0 : 1, tilt: 0, cell: card.suit * 13 + card.rank - 1 });
    });
    for (const [key, w] of want) {
      let c = this.cardObjs.get(key);
      if (!c) {
        const born = this.cardBorn.get(key) ?? t;
        c = { from: DECK_AT.clone(), to: w.p.clone(), pos: DECK_AT.clone(), t0: born, born, ry: 0, face: 0, tilt: 0, cell: w.cell, seen: false, held: null, scale: 1 };
        this.cardObjs.set(key, c);
      }
      if (c.to.distanceToSquared(w.p) > 1e-6 && t >= c.born) {
        c.from.copy(c.pos);
        c.to.copy(w.p);
        c.t0 = t;
      }
      c.cell = w.cell;
      c.held = w.held ?? null;
      c.scale = w.scale ?? 1;
      const k = Math.min(1, dt * 9);
      c.ry += (w.ry - c.ry) * k;
      c.face += (w.face - c.face) * Math.min(1, dt * 7);
      c.tilt += (w.tilt - c.tilt) * k;
    }
    for (const key of [...this.cardObjs.keys()]) if (!want.has(key)) this.cardObjs.delete(key);
    let n = 0;
    for (const c of this.cardObjs.values()) {
      if (t < c.born || n >= MAX_CARDS) continue;
      const u = THREE.MathUtils.clamp((t - c.t0) / 0.38, 0, 1);
      const e = u * u * (3 - 2 * u);
      c.pos.lerpVectors(c.from, c.to, e);
      c.pos.y += Math.sin(u * Math.PI) * Math.min(0.05, c.from.distanceTo(c.to) * 0.1);
      // Gone into the muck: hidden once there.
      if (c.to.distanceTo(MUCK_AT) < 0.05 && u >= 1) continue;
      if (c.held) {
        this.cards.setMatrixAt(n, c.held);
        this.cellAttr.setX(n, c.cell);
        n++;
        continue;
      }
      const phi = Math.PI * (1 - c.face);
      const showFace = phi < Math.PI / 2;
      this.o.position.copy(c.pos);
      this.o.rotation.set(c.tilt, c.ry, showFace ? phi : phi - Math.PI, 'YXZ');
      this.o.scale.setScalar(c.scale);
      this.o.updateMatrix();
      this.cards.setMatrixAt(n, this.o.matrix);
      this.cellAttr.setX(n, showFace ? c.cell : BACK);
      n++;
    }
    this.cards.count = n;
    this.cards.instanceMatrix.needsUpdate = true;
    this.cellAttr.needsUpdate = true;
  }

  private renderChips() {
    const t = this.clock;
    let m = 0;
    const col = new THREE.Color();
    const put = (p: THREE.Vector3, hex: number, sx = 1, sy = 1) => {
      if (m >= MAX_CHIPS) return;
      this.o.position.copy(p);
      this.o.rotation.set(0, 0, 0);
      this.o.scale.set(sx, sy, sx);
      this.o.updateMatrix();
      this.chips.setMatrixAt(m, this.o.matrix);
      this.chips.setColorAt(m, col.setHex(hex));
      m++;
    };
    const stack = (amount: number, at: THREE.Vector3, along: THREE.Vector3, minChips = 10) => {
      if (amount <= 0) return;
      const cols = chipColumns(amount, minChips);
      cols.forEach(([d, n], i) => {
        const x = (i - (cols.length - 1) / 2) * 0.041;
        for (let j = 0; j < n; j++) put(at.clone().addScaledVector(along, x).setY(PK_TOP + CHIP_H * (j + 0.5)), chipHex(d));
      });
    };
    // Landed flights stop holding their amount back.
    this.flights = this.flights.filter((f) => {
      if (t < f.t1) return true;
      this.incoming.set(f.into, Math.max(0, (this.incoming.get(f.into) ?? 0) - f.amount));
      return false;
    });
    const showSeats = this.log.length > 0;
    for (let k = 0; k < SEATS; k++) {
      const sp = this.spot(k);
      const s = this.view.seats.get(k);
      let behind: number;
      let bet = 0;
      if (s && showSeats && !this.view.ended) {
        behind = s.stack - (this.incoming.get(`stack:${k}`) ?? 0);
        bet = s.bet - (this.incoming.get(`bet:${k}`) ?? 0);
      } else if (s && showSeats) behind = s.stack - (this.incoming.get(`stack:${k}`) ?? 0);
      else behind = this.owners.get(k)?.stack ?? this.npcStacks[k];
      if (k === this.mySeat && this.humansInHand.get(k) === this.me) {
        behind -= this.staged;
        bet += this.staged;
      }
      // The regular who's standing doesn't leave chips on the felt; an empty human seat shows nothing.
      if (this.standing.has(k) && !this.owners.has(k)) behind = 0;
      if (!this.owners.has(k) && this.standing.has(k)) behind = 0;
      stack(behind, this.stackPos(k), sp.t);
      stack(bet, this.betPos(k), sp.t, 3);
    }
    if (this.view.button !== null && showSeats) put(this.at(this.view.button, 0.11, -0.1, 0.004), 0xf4f0e6, 1.35, 2.2);
    stack(this.view.pot - (this.incoming.get('pot') ?? 0), this.potPos(), new THREE.Vector3(1, 0, 0), 8);
    // Chips in the air.
    for (const f of this.flights) {
      if (t < f.t0) continue;
      const u = THREE.MathUtils.clamp((t - f.t0) / (f.t1 - f.t0), 0, 1);
      const e = u * u * (3 - 2 * u);
      const p = new THREE.Vector3().lerpVectors(f.from, f.to, e);
      p.y = PK_TOP + 0.01 + Math.sin(u * Math.PI) * 0.05;
      const cols = chipColumns(f.amount, 1, 5);
      let j = 0;
      for (const [d, n] of cols) for (let i = 0; i < n && j < 6; i++, j++) put(p.clone().setY(p.y + j * CHIP_H), chipHex(d));
    }
    this.chips.count = m;
    this.chips.instanceMatrix.needsUpdate = true;
    if (this.chips.instanceColor) this.chips.instanceColor.needsUpdate = true;
  }

  /** For tests and debugging in the page. */
  debug() {
    const k = this.mySeat;
    return {
      handId: this.handId,
      mySeat: k,
      inHand: this.inHand,
      myTurn: this.isMyTurn,
      legal: this.legal(),
      myCards: this.myCards().map(cardText),
      myStack: this.myStack,
      staged: this.staged,
      mirror: this.mirror,
      owners: [...this.owners].map(([kk, o]) => ({ k: kk, name: o.name, stack: o.stack, me: o.token === this.me })),
      seats: [...this.view.seats].map(([kk, s]) => `${kk}:${this.seatName(kk)} $${s.stack}${s.bet ? ` bet ${s.bet}` : ''}${s.folded ? ' folded' : ''} [${s.cards.map(cardText).join(' ')}]${s.last ? ' ' + s.last : ''}`),
      board: this.view.board.map(cardText),
      pot: this.view.pot,
      ended: this.view.ended,
      turn: this.view.turn,
      steps: this.log.length,
      cursor: this.cursor,
      clock: this.clock,
      lastSignal: this.lastSignal,
      peek: this.peek,
    };
  }
}
