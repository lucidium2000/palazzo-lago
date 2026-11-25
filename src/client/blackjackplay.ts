import * as THREE from 'three';
import type { Bankroll } from '../rules/bankroll';
import { type Action, type Card, handValue, isPair, packSteps, RANKS, Shoe, SUITS, TableRound, type TableStep, unpackSteps } from '../rules/blackjack';
import type { Rng } from '../rules/rng';
import type { Sound } from './audio';
import { type HandSample, type Signal, SignalReader } from './bjgesture';
import { makeChip } from './chips';
import { money } from './game';
import { envelope, handTo } from './gestures';
import type { Grabbable } from './hands';
import type { Control } from './hud';
import type { Interactable } from './interaction';
import type { Person } from './people';
import { DISCARD_AT, type PitTable, SHOE_AT, spotAngle, TOP } from './pit';
import { CHIP_COLORS, chipBreakdown, chipLabel, type ChipDenom } from './textures';

/**
 * The pit's blackjack tables play real rounds: bets go out, cards slide from
 * the shoe to every seat and the dealer, guests tap for a card or wave it off,
 * the dealer turns the hole card and draws to 17, wins are paid and losses
 * taken, and the cards are swept to the discard rack.
 *
 * You (and a friend) can take a free stool and play. In VR you take chips
 * from the rack in front of your seat and drop them in your circle; when it's
 * your turn you tap the felt for a card, wave a flat hand over your cards to
 * stand, or put a matching bet beside yours to double (a split, on a pair).
 * On a screen there's a chip picker, click the circle, and Hit / Stand /
 * Double / Split buttons. The dealer waits for you, nudges you after 15 s and
 * stands you after 30 s.
 *
 * The round is played by rules/blackjack.ts (TableRound) a step at a time;
 * each batch of steps is turned into card / chip moves, gestures and sounds on
 * a timeline. In a two-player room the host's table runs the round and sends
 * its log; the guest's table plays the same steps (see net/bjsync.ts). Every
 * card on a table is one instanced quad, every chip one instanced cylinder.
 */

const LIVE_DIST = 15;
const MAX_CARDS = 48;
const MAX_CHIPS = 160;
const CARD_W = 0.063,
  CARD_H = 0.088;
const CHIP_H = 0.0034;
const ATLAS_COLS = 13,
  ATLAS_ROWS = 5;
const BACK = 4 * 13;

interface Key {
  t: number;
  p: THREE.Vector3;
  ry: number;
  /** 0 face down, 1 face up (cards only). */
  face: number;
}
interface Track {
  /** Card: atlas cell of its face. Chip: colour. */
  id: number;
  keys: Key[];
  gone: number;
}
interface Gesture {
  who: Person;
  side: 'L' | 'R';
  t0: number;
  t1: number;
  at: (t: number, out: THREE.Vector3) => THREE.Vector3;
}
interface Cue {
  t: number;
  fn: () => void;
}

let cardMaterial: THREE.MeshStandardMaterial | null = null;
let chipMaterial: THREE.MeshStandardMaterial | null = null;

/**
 * Chip face: an inlay ring and six edge spots in white over the chip's colour
 * (the instance colour). The cylinder's sides sample a slice through the same
 * picture, which reads as the stripes round a chip's edge.
 */
export function chipMat(): THREE.MeshStandardMaterial {
  if (chipMaterial) return chipMaterial;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#fff';
  for (let k = 0; k < 6; k++) {
    g.beginPath();
    g.moveTo(32, 32);
    g.arc(32, 32, 32, (k / 6) * Math.PI * 2 - 0.2, (k / 6) * Math.PI * 2 + 0.2);
    g.closePath();
    g.fill();
  }
  g.fillStyle = '#000';
  g.beginPath();
  g.arc(32, 32, 21, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#fff';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(32, 32, 17, 0, Math.PI * 2);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.45 });
  // The texture is a mask: white where the chip shows its white inlay, else the chip's colour.
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_fragment>', 'float chipMask = texture2D( map, vMapUv ).r;')
      .replace('#include <color_fragment>', '#ifdef USE_COLOR\n diffuseColor.rgb *= mix( vColor.rgb, vec3( 0.95 ), chipMask );\n#endif');
  };
  m.customProgramCacheKey = () => 'bjChips';
  return (chipMaterial = m);
}

/** Card faces: 13 ranks x 4 suits, and a back. Readable big ranks for VR. */
function cardAtlas(): THREE.CanvasTexture {
  const W = 100,
    H = 140;
  const c = document.createElement('canvas');
  c.width = W * ATLAS_COLS;
  c.height = H * ATLAS_ROWS;
  const g = c.getContext('2d')!;
  const round = (x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  };
  g.fillStyle = '#20402c';
  g.fillRect(0, 0, c.width, c.height);
  for (let s = 0; s < 4; s++) {
    for (let r = 0; r < 13; r++) {
      const x = r * W,
        y = s * H;
      g.fillStyle = '#fbf8f0';
      round(x + 1, y + 1, W - 2, H - 2, 9);
      g.fill();
      g.strokeStyle = '#b8b0a0';
      g.lineWidth = 2;
      g.stroke();
      const red = s === 1 || s === 2;
      g.fillStyle = red ? '#c4161c' : '#141414';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const rank = RANKS[r];
      // Corner index, top left and (upside down) bottom right.
      g.font = `bold ${rank === '10' ? 24 : 28}px Arial, sans-serif`;
      g.fillText(rank, x + 17, y + 19);
      g.font = '24px Arial, sans-serif';
      g.fillText(SUITS[s], x + 17, y + 43);
      g.save();
      g.translate(x + W - 17, y + H - 19);
      g.rotate(Math.PI);
      g.font = `bold ${rank === '10' ? 24 : 28}px Arial, sans-serif`;
      g.fillText(rank, 0, 0);
      g.restore();
      // Big rank and suit in the middle: what you read from across the table.
      g.font = `bold ${rank === '10' ? 46 : 54}px Georgia, serif`;
      g.fillText(rank, x + W / 2 + 6, y + H / 2 - 14);
      g.font = '46px Arial, sans-serif';
      g.fillText(SUITS[s], x + W / 2 + 6, y + H / 2 + 34);
    }
  }
  // Back: casino red with a gold border and lattice.
  const x = 0,
    y = 4 * H;
  g.fillStyle = '#fbf8f0';
  round(x + 1, y + 1, W - 2, H - 2, 9);
  g.fill();
  g.fillStyle = '#8e1420';
  round(x + 7, y + 7, W - 14, H - 14, 6);
  g.fill();
  g.strokeStyle = 'rgba(240,200,110,0.55)';
  g.lineWidth = 2;
  g.save();
  round(x + 7, y + 7, W - 14, H - 14, 6);
  g.clip();
  for (let k = -H; k < W + H; k += 12) {
    g.beginPath();
    g.moveTo(x + k, y);
    g.lineTo(x + k + H, y + H);
    g.moveTo(x + k + H, y);
    g.lineTo(x + k, y + H);
    g.stroke();
  }
  g.restore();
  g.strokeStyle = '#e0b860';
  g.lineWidth = 3;
  round(x + 7, y + 7, W - 14, H - 14, 6);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function cardMat(): THREE.MeshStandardMaterial {
  if (cardMaterial) return cardMaterial;
  const m = new THREE.MeshStandardMaterial({ map: cardAtlas(), roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aCell;')
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        vec2 cellXY = vec2(mod(aCell, ${ATLAS_COLS}.0), floor(aCell / ${ATLAS_COLS}.0));
        vMapUv = vec2((cellXY.x + uv.x) / ${ATLAS_COLS}.0, 1.0 - (cellXY.y + 1.0 - uv.y) / ${ATLAS_ROWS}.0);`,
      );
  };
  m.customProgramCacheKey = () => 'bjCards';
  return (cardMaterial = m);
}

const cell = (c: Card) => c.suit * 13 + (c.rank - 1);

const chipHex = (d: ChipDenom) => parseInt(CHIP_COLORS[d][0].slice(1), 16);
/** Seconds a player has to decide before the dealer nudges, and before the dealer stands them. */
export const NUDGE_AFTER = 15;
export const AUTO_STAND_AFTER = 30;

/** A player sitting at the table (the host's record; mirrored to the guest). */
export interface SeatOwner {
  token: string;
  name: string;
  /** The friend's connection id (host side), or null for the host's own seat. */
  friend: string | null;
  /** All chips they've put in their circle since sitting (only grows). */
  betTotal: number;
  /** Of that, what went into rounds, and what was handed back. */
  consumed: number;
  refunded: number;
}

/** A request from a player to the table (from the host's own player or the guest, over the net). */
export interface TableRequest {
  a: 'sit' | 'leave' | 'bet' | 'clear' | 'act' | 'deal';
  k?: number;
  total?: number;
  act?: Action;
  r?: number;
}

/** Network hooks (two-player rooms), set by net/bjsync.ts. */
export interface TableNet {
  role: 'host' | 'guest';
  /** Guest: send a request to the host. */
  request(d: TableRequest & { me: string; name: string }): void;
  /** Host: the table changed; publish a snapshot soon. */
  changed(): void;
}

export interface BlackjackCtx {
  sound: Sound;
  rng?: Rng;
  bankroll?: Bankroll;
  toast?(text: string, kind?: 'info' | 'win' | 'warn'): void;
  /** Buzz a VR controller. */
  haptic?(side: 'left' | 'right', strength: number, ms: number): void;
  /** Your name (shown to your friend). */
  name?(): string;
  /** A round you played is settled: total staked and returned. */
  onResult?(staked: number, returned: number): void;
}

const pend = (o: SeatOwner) => Math.max(0, o.betTotal - o.consumed - o.refunded);

export class BlackjackPlay {
  private cards: THREE.InstancedMesh;
  private cellAttr: THREE.InstancedBufferAttribute;
  private chips: THREE.InstancedMesh;
  private shoe: Shoe;
  private clock = 0;
  /** Timeline cursor: where the next animated step starts. */
  private T = 0;
  private cardTracks: Track[] = [];
  private chipTracks: Track[] = [];
  private gestures: Gesture[] = [];
  private cues: Cue[] = [];
  private stash: Track[] = [];
  private live = false;
  private o = new THREE.Object3D();
  private v = new THREE.Vector3();
  private center: THREE.Vector3;
  private npcSeats: number[];
  private persons = new Map<number, Person | null>();

  // --- The table (authoritative on the host / solo; mirrored on a guest) ---
  readonly owners = new Map<number, SeatOwner>();
  phase: 'betting' | 'round' = 'betting';
  roundId = 0;
  /** Every step of the current round so far. */
  log: TableStep[] = [];
  private round: TableRound | null = null;
  /** The seat and hand the dealer is waiting on. */
  waiting: { seat: number; hand: number } | null = null;
  /** Timeline time the current turn shows (cards in place); decisions count from here. */
  private turnAt = Infinity;
  private nudged = false;
  private roundStart = 0;
  private sweepEnd = 0;
  private nextAuto = 0;
  private bettingSince = 0;
  private lastBetChange = 0;
  private dealAsked = false;
  /** Guest: steps of the host's round already played here. */
  private applied = 0;
  /** Guest: following the host's table (else the guests play a round of their own). */
  mirror = false;
  net: TableNet | null = null;

  // --- You ---
  readonly me = Math.random().toString(36).slice(2, 10);
  mySeat: number | null = null;
  private refusedSeat: number | null = null;
  /** Chips you've put in your circle since sitting (your side of SeatOwner.betTotal). */
  private betTotal = 0;
  private creditedRefund = 0;
  /** The seat you're playing in the current round, if any. */
  private myRoundSeat: number | null = null;
  private staked = 0;
  private returned = 0;
  private lastBet = 0;
  chip: number;
  readonly denoms: ChipDenom[];
  /** Chips put beside your bet during your turn, toward a double or split. */
  private side = 0;
  private sideTracks: Track[] = [];

  // --- Per-round visuals ---
  private hands = new Map<number, Track[][]>();
  private cardsOf = new Map<string, Card[]>();
  private betChips = new Map<string, Track[]>();
  private payChips = new Map<string, Track[]>();
  private dealerHand: Track[] = [];
  private taken = new Set<string>();
  private pending = new Map<number, { amount: number; tracks: Track[] }>();
  private nodAt = -10;
  private backdating = false;

  // --- VR and screen controls ---
  readonly grabbables: Grabbable[] = [];
  readonly target: Interactable;
  private rack: THREE.Group;
  private marker: THREE.Mesh;
  private label: { mesh: THREE.Mesh; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; text: string };
  private readers = { left: new SignalReader(), right: new SignalReader() };
  /** In VR (hand signals and the rack) rather than on a screen. */
  private vr = false;
  /** Last signal read (for tests and the page's debug handle). */
  lastSignal: { side: string; signal: Signal; t: number } | null = null;

  constructor(
    private ctx: BlackjackCtx,
    private table: PitTable,
    private dealer: Person | null,
    seats: { seat: number; person: Person | null }[],
    readonly min: number,
    readonly max = min * 200,
    readonly index = 0,
  ) {
    const rng: Rng = ctx.rng ?? { int: (n) => Math.floor(Math.random() * n) };
    this.shoe = new Shoe(rng, 6);
    this.npcSeats = seats.map((s) => s.seat).sort((a, b) => a - b);
    for (const s of seats) this.persons.set(s.seat, s.person);
    this.denoms = (min >= 100 ? [25, 100, 500, 1000, 5000] : [5, 25, 100, 500, 1000]) as ChipDenom[];
    this.chip = min;
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
    table.group.add(this.cards, this.chips);
    this.center = table.group.position.clone();
    // Each guest keeps a little stack of chips by the rail.
    for (const k of this.npcSeats) {
      const [u, t] = this.frame(k);
      for (let j = 0; j < 5; j++) {
        const p = new THREE.Vector3(u.x * 0.93 + t.x * 0.05, TOP + CHIP_H / 2 + j * CHIP_H, u.z * 0.93 + t.z * 0.05);
        this.stash.push({ id: this.colorOf(j < 3 ? this.min : this.min * 4), keys: [{ t: -1, p, ry: 0, face: 0 }], gone: Infinity });
      }
    }
    // Dealers and guests move their hands through `onPose` (animated characters).
    const pose = (who: Person) => (p: Person) => {
      if (!this.live) return;
      for (const g of this.gestures) {
        if (g.who !== who) continue;
        const w = envelope(this.clock, g.t0, g.t1, 0.22);
        if (w <= 0) continue;
        g.at(this.clock, this.v);
        this.table.group.localToWorld(this.v);
        handTo(p, g.side, this.v, w);
      }
      // The dealer nods when you signal.
      const n = (this.clock - this.nodAt) / 0.7;
      if (who === this.dealer && n > 0 && n < 1) p.rig?.bones['Head']?.rotateX(0.32 * Math.sin(n * Math.PI * 2) * (1 - n));
    };
    if (dealer) dealer.onPose = pose(dealer);
    for (const s of seats) if (s.person) s.person.onPose = pose(s.person);
    this.nextAuto = 2 + Math.random() * 6;

    this.rack = this.buildRack();
    // Your turn: a soft gold ring around the hand being played.
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.062, 0.07, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }));
    this.marker.visible = false;
    this.marker.raycast = () => {};
    this.marker.userData.dynamic = true;
    table.group.add(this.marker);
    // A little card on the felt that tells you what to do (and your total).
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 112;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const lm = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.066), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    lm.visible = false;
    lm.raycast = () => {};
    lm.userData.dynamic = true;
    table.group.add(lm);
    this.label = { mesh: lm, g: c.getContext('2d')!, tex, text: '' };
    // Screens: click your circle to bet the selected chip.
    this.target = {
      object: table.group,
      kind: 'surface',
      enabled: () => this.mySeat !== null,
      label: (e) => (this.mySeat !== null && this.inCircle(e.local, this.mySeat) && this.canBet() ? `Bet ${money(this.chip)}` : null),
      onSelect: (e) => {
        if (this.mySeat !== null && this.inCircle(e.local, this.mySeat)) this.addBet(this.chip);
      },
    };
  }

  // ===========================================================================
  // Geometry
  // ===========================================================================

  /** Table-local unit vectors at a betting spot: out toward the player, and across (to the player's left). */
  private frame(k: number): [THREE.Vector3, THREE.Vector3] {
    const a = spotAngle(k);
    return [new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), new THREE.Vector3(-Math.sin(a), 0, Math.cos(a))];
  }

  private colorOf(amount: number): number {
    const d = [5000, 1000, 500, 100, 25, 5, 1].find((x) => amount >= x) ?? 1;
    return chipHex(d as ChipDenom);
  }

  /** Where a hand's chips sit: the bet in the circle (a split hand's beside it), a double in front, winnings to the side. */
  private stackAt(k: number, h: number, slot: 'bet' | 'double' | 'pay' | 'side'): THREE.Vector3 {
    const [u, t] = this.frame(k);
    const p = u.clone().multiplyScalar(0.8);
    if (h === 1) p.addScaledVector(t, -0.11);
    if (slot === 'double') p.addScaledVector(u, -0.048);
    if (slot === 'pay') p.addScaledVector(t, h === 1 ? -0.045 : 0.045);
    if (slot === 'side') p.addScaledVector(t, -0.11);
    p.y = TOP;
    return p;
  }

  private handSpot(k: number, h: number, j: number, nh: number, sideways = false): [THREE.Vector3, number] {
    const [u, t] = this.frame(k);
    const base = u.clone().multiplyScalar(0.6);
    if (nh === 2) base.addScaledVector(t, h === 0 ? 0.06 : -0.06);
    const step = nh === 2 ? 0.016 : 0.022;
    base.addScaledVector(t, j * step).addScaledVector(u, j * 0.012);
    base.y = TOP + 0.0012 + j * 0.0007;
    return [base, Math.PI / 2 - spotAngle(k) + (sideways ? Math.PI / 2 : 0)];
  }

  private dealerSpot(j: number): [THREE.Vector3, number] {
    return [new THREE.Vector3(-0.05 + j * 0.05, TOP + 0.0012 + j * 0.0007, 0.3), 0];
  }

  /** Is a table-local point over your betting circle? */
  private inCircle(l: THREE.Vector3, k: number, r = 0.085) {
    const c = this.stackAt(k, 0, 'bet');
    return Math.hypot(l.x - c.x, l.z - c.z) < r && l.y > TOP - 0.05 && l.y < TOP + 0.3;
  }

  /** A world point in your spot's frame (see bjgesture.ts): x across, y up off the felt, z toward you. */
  spotLocal(world: THREE.Vector3, k = this.mySeat ?? 0): { x: number; y: number; z: number } {
    const l = this.table.group.worldToLocal(world.clone());
    const [u, t] = this.frame(k);
    const ox = u.x * 0.6,
      oz = u.z * 0.6;
    const dx = l.x - ox,
      dz = l.z - oz;
    return { x: dx * t.x + dz * t.z, y: l.y - TOP, z: dx * u.x + dz * u.z };
  }

  /** The inverse: a point in a spot's frame to world (for tests and simulated hands). */
  spotWorld(p: { x: number; y: number; z: number }, k = this.mySeat ?? 0): THREE.Vector3 {
    const [u, t] = this.frame(k);
    const l = new THREE.Vector3(u.x * 0.6 + t.x * p.x + u.x * p.z, TOP + p.y, u.z * 0.6 + t.z * p.x + u.z * p.z);
    return this.table.group.localToWorld(l);
  }

  /** The seats a player may take (stools without a guest on them). */
  get freeSeats(): number[] {
    return [0, 1, 2, 3, 4, 5, 6].filter((k) => !this.npcSeats.includes(k));
  }

  seatPos(k: number) {
    return this.table.seats[k];
  }

  get authority() {
    return !this.net || this.net.role === 'host';
  }

  // ===========================================================================
  // Your chips: the rack (VR) and the circle
  // ===========================================================================

  private buildRack(): THREE.Group {
    const g = new THREE.Group();
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.06), new THREE.MeshStandardMaterial({ color: 0x2a1408, roughness: 0.4 }));
    tray.position.y = 0.006;
    g.add(tray);
    const per = 10;
    const inst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0195, 0.0195, 0.0033, 18), new THREE.MeshStandardMaterial({ roughness: 0.45 }), this.denoms.length * per);
    const tmp = new THREE.Object3D();
    this.denoms.forEach((d, i) => {
      const x = (i - (this.denoms.length - 1) / 2) * 0.055;
      for (let k = 0; k < per; k++) {
        tmp.position.set(x, 0.012 + 0.0017 + k * 0.0033, 0);
        tmp.updateMatrix();
        inst.setMatrixAt(i * per + k, tmp.matrix);
        inst.setColorAt(i * per + k, new THREE.Color(chipHex(d)));
      }
      const top = new THREE.Vector3(x, 0.012 + per * 0.0033, 0);
      this.grabbables.push({
        at: () => g.localToWorld(top.clone()),
        radius: 0.05,
        enabled: () => g.visible,
        grab: () => {
          if (!this.ctx.bankroll?.canAfford(d)) {
            this.ctx.sound.play('denied', g, { volume: 0.4 });
            return null;
          }
          const chip = makeChip(d);
          chip.position.copy(g.localToWorld(top.clone()));
          this.ctx.sound.play('chip', chip, { volume: 0.5 });
          return chip;
        },
        release: (_h, pos, carried) => {
          carried?.removeFromParent();
          this.dropChip(d, pos);
        },
      });
    });
    inst.raycast = () => {};
    g.add(inst);
    g.visible = false;
    g.userData.dynamic = true;
    this.table.group.add(g);
    return g;
  }

  /** Can you put chips in your circle right now? (Not while your hand is being played.) */
  canBet(): boolean {
    if (this.mySeat === null) return false;
    if (this.mirror && !this.owners.has(this.mySeat)) return false;
    return !(this.phase === 'round' && this.myRoundSeat !== null);
  }

  /** Chips in your circle waiting for the next round. */
  get myPending(): number {
    const o = this.mySeat !== null ? this.owners.get(this.mySeat) : undefined;
    if (!o || o.token !== this.me) return 0;
    return Math.max(0, this.betTotal - o.consumed - o.refunded);
  }

  get isMyTurn(): boolean {
    return !!this.waiting && this.waiting.seat === this.myRoundSeat && this.waiting.seat === this.mySeat && this.clock >= this.turnAt;
  }

  /** Log length when you last decided (no second decision until the dealer has answered). */
  private decided = { at: -10, steps: -1 };

  /** What your waiting hand may do. */
  legal(): Record<Action, boolean> {
    const none = { hit: false, stand: false, double: false, split: false };
    if (!this.isMyTurn || !this.waiting) return none;
    if (this.log.length === this.decided.steps && this.clock - this.decided.at < 3) return none;
    const cards = this.cardsOf.get(`${this.waiting.seat}:${this.waiting.hand}`) ?? [];
    const nh = this.hands.get(this.waiting.seat)?.length ?? 1;
    const bet = this.handBet(this.waiting.seat, this.waiting.hand);
    const afford = !!this.ctx.bankroll?.canAfford(bet);
    return { hit: true, stand: true, double: cards.length === 2 && afford, split: cards.length === 2 && nh === 1 && isPair(cards) && afford };
  }

  private handBet(k: number, h: number) {
    let bet = 0;
    for (const st of this.log) {
      if (st.kind === 'bet' && st.seat === k) bet = st.amount;
      if (st.kind === 'double' && st.seat === k && st.hand === h) bet += st.bet;
    }
    return bet;
  }

  /** Put a chip in your circle (debited now; it plays in the next round). */
  addBet(amount: number): boolean {
    const k = this.mySeat;
    const bank = this.ctx.bankroll;
    if (k === null || !bank) return false;
    if (!this.canBet()) {
      this.ctx.toast?.('Wait for this hand to finish', 'info');
      return false;
    }
    if (this.myPending + amount > this.max) {
      this.ctx.toast?.(`Table maximum is ${money(this.max)}`, 'warn');
      return false;
    }
    if (!bank.canAfford(amount)) {
      this.ctx.toast?.('Not enough chips', 'warn');
      this.ctx.sound.play('denied', this.table.group.localToWorld(this.stackAt(k, 0, 'bet')), { volume: 0.4 });
      return false;
    }
    bank.debit(amount, 'bet', 'blackjack');
    this.betTotal += amount;
    this.ctx.sound.play('chip', this.table.group.localToWorld(this.stackAt(k, 0, 'bet')), { volume: 0.5, rate: 0.95 + Math.random() * 0.1 });
    this.request({ a: 'bet', k, total: this.betTotal });
    if (this.myPending < this.min) this.ctx.toast?.(`Table minimum ${money(this.min)} · ${money(this.myPending)} down`, 'info');
    return true;
  }

  /** Take your chips back out of the circle (before the deal). */
  clearBet() {
    if (this.mySeat === null || this.myPending <= 0 || !this.canBet()) return;
    this.request({ a: 'clear', k: this.mySeat });
  }

  /** The same bet as last round. */
  rebet() {
    if (this.lastBet <= 0 || this.myPending > 0) return;
    this.addBet(Math.min(this.lastBet, this.max));
  }

  /** Ask the dealer to deal now. */
  deal() {
    this.request({ a: 'deal' });
  }

  /** A chip let go of in VR: into your circle (a bet), beside it on your turn (double / split), else back to the rack. */
  dropChip(d: ChipDenom, world: THREE.Vector3) {
    const k = this.mySeat;
    if (k === null) return;
    const l = this.table.group.worldToLocal(world.clone());
    const near = (p: THREE.Vector3, r: number) => Math.hypot(l.x - p.x, l.z - p.z) < r && l.y > TOP - 0.05 && l.y < TOP + 0.3;
    if (this.isMyTurn && this.waiting && near(this.stackAt(k, 0, 'bet'), 0.24)) {
      this.addSide(d);
      return;
    }
    if (near(this.stackAt(k, 0, 'bet'), 0.1) && this.canBet()) {
      this.addBet(d);
      return;
    }
    this.ctx.sound.play('chip', world, { volume: 0.3, rate: 0.8 });
  }

  /** Chips beside your bet on your turn: once they match it, that's a double (or a split, on a pair). */
  private addSide(d: number) {
    const w = this.waiting!;
    const bet = this.handBet(w.seat, w.hand);
    const legal = this.legal();
    if (!legal.double && !legal.split) {
      this.ctx.toast?.(this.ctx.bankroll?.canAfford(bet) ? 'You can only double on your first two cards' : 'Not enough chips to double', 'info');
      this.ctx.sound.play('chip', this.table.group.localToWorld(this.stackAt(w.seat, w.hand, 'side')), { volume: 0.3, rate: 0.8 });
      return;
    }
    this.side += d;
    const p = this.stackAt(w.seat, w.hand, 'side');
    const tr: Track = { id: chipHex(d as ChipDenom), keys: [{ t: this.clock, p: new THREE.Vector3(p.x, TOP + CHIP_H / 2 + this.sideTracks.length * CHIP_H, p.z), ry: 0, face: 0 }], gone: Infinity };
    this.sideTracks.push(tr);
    this.chipTracks.push(tr);
    this.ctx.sound.play('chip', this.table.group.localToWorld(p), { volume: 0.5 });
    if (this.side >= bet) this.decide(legal.split ? 'split' : 'double');
    else this.ctx.toast?.(`${money(bet - this.side)} more to ${legal.split ? 'split' : 'double'}`, 'info');
  }

  private clearSide() {
    for (const tr of this.sideTracks) tr.gone = this.clock;
    this.sideTracks = [];
    this.side = 0;
  }

  /** Your decision on your turn (buttons or a hand signal). */
  decide(action: Action): boolean {
    if (!this.legal()[action] || !this.waiting) return false;
    this.decided = { at: this.clock, steps: this.log.length };
    this.request({ a: 'act', k: this.waiting.seat, act: action, r: this.roundId });
    // Feedback straight away; the card follows when the dealer deals it.
    this.nodAt = this.clock;
    return true;
  }

  /**
   * Your real hands over the table (VR), each frame: index fingertip and palm
   * (world), how open the hand is (0 fist .. 1 flat). Reads tap and wave signals on your turn.
   */
  handInput(side: 'left' | 'right', tip: THREE.Vector3 | null, palm: THREE.Vector3 | null, open: number, t: number): Signal | null {
    const reader = this.readers[side];
    if (!this.isMyTurn || this.mySeat === null) {
      reader.reset();
      return null;
    }
    const s: HandSample = { t, tip: tip ? this.spotLocal(tip) : null, palm: palm ? this.spotLocal(palm) : null, open };
    const sig = reader.update(s);
    if (!sig) return null;
    if (this.decide(sig)) {
      this.lastSignal = { side, signal: sig, t };
      this.ctx.haptic?.(side, 0.6, 45);
      this.ctx.sound.play('click', this.table.group.localToWorld(this.handSpot(this.mySeat, this.waiting?.hand ?? 0, 0, 1)[0]), { volume: 0.25, rate: sig === 'hit' ? 0.7 : 1.1 });
      this.readers.left.reset();
      this.readers.right.reset();
    }
    return sig;
  }

  /** On-screen controls while you're at a seat here. */
  controls(): Control[] | null {
    if (this.mySeat === null) return null;
    if (this.isMyTurn) {
      const l = this.legal();
      const cards = this.waiting ? this.cardsOf.get(`${this.waiting.seat}:${this.waiting.hand}`) ?? [] : [];
      const v = handValue(cards);
      return [
        { id: 'bjhit', label: 'HIT', sub: `${v.soft ? 'soft ' : ''}${v.total}`, kind: 'primary', disabled: !l.hit, onPress: () => this.decide('hit') },
        { id: 'bjstand', label: 'STAND', kind: 'primary', disabled: !l.stand, onPress: () => this.decide('stand') },
        { id: 'bjdouble', label: 'Double', disabled: !l.double, onPress: () => this.decide('double') },
        { id: 'bjsplit', label: 'Split', disabled: !l.split, onPress: () => this.decide('split') },
      ];
    }
    const betting = this.canBet();
    const pending = this.myPending;
    return [
      ...this.denoms.map((d) => ({ id: `bjchip${d}`, label: chipLabel(d), kind: 'chip' as const, color: CHIP_COLORS[d], active: this.chip === d, onPress: () => (this.chip = d) })),
      { id: 'bjbet', label: 'Bet', sub: money(this.chip), disabled: !betting, onPress: () => this.addBet(this.chip) },
      { id: 'bjclear', label: 'Clear', disabled: !betting || pending <= 0, onPress: () => this.clearBet() },
      { id: 'bjrebet', label: 'Rebet', disabled: !betting || pending > 0 || this.lastBet <= 0, onPress: () => this.rebet() },
      {
        id: 'bjdeal',
        label: this.phase === 'round' ? '…' : 'DEAL',
        sub: pending > 0 ? `bet ${money(pending)}` : `min ${money(this.min)}`,
        kind: 'primary',
        disabled: this.phase === 'round' || pending < this.min,
        onPress: () => this.deal(),
      },
    ];
  }

  /** Which seat you're on (null: not at this table). Called each frame by main. */
  setLocal(k: number | null) {
    if (k !== null && !this.freeSeats.includes(k)) {
      if (this.refusedSeat !== k) this.ctx.toast?.('That seat is taken', 'info');
      this.refusedSeat = k;
      k = null;
    } else this.refusedSeat = null;
    if (k === this.mySeat) return;
    if (this.mySeat !== null) {
      // Getting up: your chips that weren't in a round come back to you.
      const back = this.myPending;
      if (back > 0) this.ctx.bankroll?.credit(back, 'refund', 'blackjack');
      this.request({ a: 'leave', k: this.mySeat });
      this.betTotal = 0;
    }
    this.mySeat = k;
    this.clearSide();
    if (k !== null) {
      this.betTotal = 0;
      this.creditedRefund = 0;
      this.request({ a: 'sit', k });
      const [u, t] = this.frame(k);
      this.rack.position.set(u.x * 0.925, TOP + 0.002, u.z * 0.925);
      this.rack.rotation.y = Math.atan2(-t.z, t.x);
      this.ctx.toast?.(`Blackjack ${money(this.min)}–${money(this.max)} · place your bet`, 'info');
    }
    this.rack.visible = false;
  }

  /** Show the chip rack (VR only; screens use the chip picker). */
  showRack(v: boolean) {
    this.rack.visible = v && this.mySeat !== null;
    this.vr = v;
  }

  private request(d: TableRequest) {
    if (this.authority) this.handle(this.me, this.ctx.name?.() ?? 'You', null, d);
    else this.net!.request({ ...d, me: this.me, name: this.ctx.name?.() ?? 'Guest' });
  }

  // ===========================================================================
  // The table (host / solo)
  // ===========================================================================

  /** A player's request (the host's own, or the guest's from the net). */
  handle(token: string, name: string, friend: string | null, d: TableRequest) {
    if (!this.authority) return;
    const k = Number.isInteger(d.k) ? (d.k as number) : -1;
    const o = this.owners.get(k);
    const mine = !!o && o.token === token;
    switch (d.a) {
      case 'sit': {
        if (!this.freeSeats.includes(k) || (o && !mine)) return;
        for (const [kk, oo] of this.owners) if (oo.token === token && kk !== k) this.owners.delete(kk);
        if (!mine) this.owners.set(k, { token, name: String(name).slice(0, 20), friend, betTotal: 0, consumed: 0, refunded: 0 });
        if (this.phase === 'betting') this.bettingSince = this.clock;
        break;
      }
      case 'leave':
        if (mine) this.owners.delete(k);
        break;
      case 'bet':
        if (!mine || !(Number(d.total) >= 0)) return;
        o!.betTotal = Math.max(o!.betTotal, Math.round(Number(d.total) * 100) / 100);
        this.lastBetChange = this.clock;
        break;
      case 'clear':
        if (!mine) return;
        o!.refunded += pend(o!);
        break;
      case 'deal':
        if ([...this.owners.values()].some((x) => x.token === token)) this.dealAsked = true;
        break;
      case 'act': {
        if (!mine || d.r !== this.roundId || !this.round || !d.act || !['hit', 'stand', 'double', 'split'].includes(d.act)) return;
        const steps = this.round.act(k, d.act);
        if (steps) this.feed(steps);
        break;
      }
    }
    this.net?.changed();
    this.syncMine();
  }

  /** A friend left the room: free their seat. */
  friendGone(id: string) {
    for (const [k, o] of this.owners) if (o.friend === id) this.owners.delete(k);
    this.net?.changed();
  }

  /** Your own record: hand back chips the dealer returned to you. */
  private syncMine() {
    const o = this.mySeat !== null ? this.owners.get(this.mySeat) : undefined;
    if (!o || o.token !== this.me) return;
    if (o.refunded > this.creditedRefund + 0.001) {
      this.ctx.bankroll?.credit(Math.round((o.refunded - this.creditedRefund) * 100) / 100, 'refund', 'blackjack');
      this.creditedRefund = o.refunded;
      this.ctx.sound.play('chips', this.table.group.localToWorld(this.stackAt(this.mySeat!, 0, 'bet')), { volume: 0.3 });
    }
  }

  private humanReady(): { k: number; bet: number }[] {
    const out: { k: number; bet: number }[] = [];
    for (const [k, o] of this.owners) {
      const p = pend(o);
      if (p >= this.min) out.push({ k, bet: Math.min(p, this.max) });
    }
    return out;
  }

  /** When does the dealer deal? Guests alone: every 20-30 s. With players: once bets are down. */
  private shouldDeal(): boolean {
    if (this.phase !== 'betting' || this.clock < this.sweepEnd) return false;
    if (this.owners.size === 0) return this.clock >= this.nextAuto;
    const ready = this.humanReady();
    const since = this.clock - this.bettingSince,
      quiet = this.clock - this.lastBetChange;
    if (ready.length) {
      if (this.dealAsked) return true;
      if (ready.length === this.owners.size && quiet > 4) return true;
      return since > 15 && quiet > 3;
    }
    // Nobody's betting: the guests play on without you every so often.
    return since > 25 && quiet > 6;
  }

  private startRound() {
    const ready = this.humanReady();
    const entries = [
      ...this.npcSeats.map((k) => ({ seat: k, bet: this.min * (1 + Math.floor(Math.random() * 3)), auto: true })),
      ...ready.map((r) => ({ seat: r.k, bet: r.bet, auto: false })),
    ];
    this.round = new TableRound(this.shoe, entries);
    this.roundId++;
    this.beginRound();
    this.feed(this.round.start());
  }

  /** Steps from the round (host / solo): log them, play them, tell the guest. */
  private feed(steps: TableStep[]) {
    for (const st of steps) {
      if (st.kind === 'bet') {
        const o = this.owners.get(st.seat);
        if (o) o.consumed += st.amount;
      }
    }
    this.play(steps);
    this.waiting = this.round?.waiting ?? null;
    this.net?.changed();
  }

  // ===========================================================================
  // Two-player tables: what the host sends and the guest follows
  // ===========================================================================

  snapshot(): Record<string, unknown> {
    return {
      t: this.index,
      id: this.roundId,
      ph: this.phase === 'round' ? 1 : 0,
      o: [...this.owners].map(([k, o]) => [k, o.token, o.name, o.betTotal, o.consumed, o.refunded]),
      s: this.phase === 'round' || this.log.length ? packSteps(this.log) : [],
      w: this.waiting ? [this.waiting.seat, this.waiting.hand, this.nudged ? 1 : 0] : 0,
    };
  }

  /** Guest: the host's table, as of now. */
  applySnapshot(d: Record<string, unknown>) {
    if (this.authority) return;
    this.owners.clear();
    if (Array.isArray(d.o))
      for (const r of d.o as unknown[][]) {
        const k = Number(r[0]);
        if (!Number.isInteger(k) || k < 0 || k > 6) continue;
        this.owners.set(k, { token: String(r[1]), name: String(r[2]).slice(0, 20), friend: null, betTotal: Number(r[3]) || 0, consumed: Number(r[4]) || 0, refunded: Number(r[5]) || 0 });
      }
    const want = this.mySeat !== null || this.owners.size > 0 || this.myRoundSeat !== null;
    if (want && !this.mirror) this.enterMirror();
    if (!this.mirror) return;
    const id = Number(d.id) || 0;
    const steps = unpackSteps(d.s);
    const fresh = id !== this.roundId;
    if (fresh) {
      this.roundId = id;
      this.applied = 0;
      if (steps.length) this.beginRound();
    }
    if (steps.length > this.applied) {
      const add = steps.slice(this.applied);
      this.applied = steps.length;
      this.play(add);
    }
    const w = d.w as number[] | 0;
    const before = this.waiting;
    this.waiting = Array.isArray(w) ? { seat: Number(w[0]), hand: Number(w[1]) } : null;
    if (Array.isArray(w) && w[2] && !this.nudged && this.waiting?.seat === this.mySeat) this.nudge();
    this.nudged = Array.isArray(w) && !!w[2];
    if (before?.seat !== this.waiting?.seat || before?.hand !== this.waiting?.hand) this.clearSide();
    this.backdating = false;
    this.syncMine();
    if (!want && this.phase === 'betting') this.leaveMirror();
  }

  /** Guest: start following the host's table (whatever was showing goes). */
  private enterMirror() {
    this.mirror = true;
    this.resetVisuals();
    this.round = null;
    this.roundId = -1;
    this.applied = 0;
    this.phase = 'betting';
    // Steps already played at the host land where they are now, without replaying sounds.
    this.backdating = true;
  }

  private leaveMirror() {
    this.mirror = false;
    this.resetVisuals();
    this.owners.clear();
    this.phase = 'betting';
    this.waiting = null;
    this.nextAuto = this.clock + 3;
  }

  /** Back to the table's own game (left the room). */
  resetNet() {
    this.net = null;
    if (this.mirror) this.leaveMirror();
    for (const [k, o] of this.owners) if (o.token !== this.me) this.owners.delete(k);
    if (this.mySeat !== null && !this.owners.has(this.mySeat)) {
      const k = this.mySeat;
      this.mySeat = null;
      this.setLocal(k);
    }
  }

  private resetVisuals() {
    this.cardTracks = [];
    this.chipTracks = [];
    this.gestures = [];
    this.cues = [];
    this.hands.clear();
    this.cardsOf.clear();
    this.betChips.clear();
    this.payChips.clear();
    this.dealerHand = [];
    this.taken.clear();
    this.pending.clear();
    this.sideTracks = [];
    this.side = 0;
    this.log = [];
    this.myRoundSeat = null;
    this.T = this.clock;
  }

  private nudge() {
    if (this.waiting?.seat !== this.mySeat) return;
    this.ctx.toast?.('The dealer is waiting on you · tap for a card, wave to stand', 'info');
    this.ctx.haptic?.('left', 0.4, 60);
    this.ctx.haptic?.('right', 0.4, 60);
    this.ctx.sound.play('ding', this.table.group.localToWorld(this.handSpot(this.mySeat!, 0, 0, 1)[0]), { volume: 0.25 });
    this.nodAt = this.clock;
    this.attend(this.mySeat!, 0, 0.9);
  }

  /** The dealer gestures toward a spot (a palm-up "your call"). */
  private attend(k: number, h: number, dur: number) {
    const [p] = this.handSpot(k, h, 0, this.hands.get(k)?.length ?? 1);
    const at = p.clone().multiplyScalar(0.7);
    at.y = TOP + 0.08;
    const t0 = Math.max(this.T, this.clock);
    if (this.dealer) this.gestures.push({ who: this.dealer, side: at.x > 0 ? 'L' : 'R', t0, t1: t0 + dur, at: (_t, out) => out.copy(at) });
  }

  // ===========================================================================
  // Turning steps into a timeline
  // ===========================================================================

  /** A new round's visuals (the last one's sweep may still be finishing). */
  private beginRound() {
    this.phase = 'round';
    this.roundStart = this.clock;
    this.log = [];
    this.hands.clear();
    this.cardsOf.clear();
    this.betChips.clear();
    this.payChips.clear();
    this.dealerHand = [];
    this.taken.clear();
    this.myRoundSeat = null;
    this.staked = 0;
    this.returned = 0;
    this.waiting = null;
    this.turnAt = Infinity;
    this.dealAsked = false;
    this.clearSide();
    this.T = Math.max(this.T, this.clock) + 0.3;
    // Old tracks that have finished can go.
    this.cardTracks = this.cardTracks.filter((tr) => tr.gone > this.clock);
    this.chipTracks = this.chipTracks.filter((tr) => tr.gone > this.clock);
    this.gestures = this.gestures.filter((g) => g.t1 > this.clock);
  }

  private cue(t: number, fn: () => void) {
    if (!this.backdating) this.cues.push({ t, fn });
  }

  private sound(t: number, name: Parameters<Sound['play']>[0], at: THREE.Vector3, volume: number, rate = 1) {
    this.cue(t, () => this.ctx.sound.play(name, this.table.group.localToWorld(at.clone()), { volume, rate }));
  }

  private move(tr: Track, t0: number, t1: number, p: THREE.Vector3, ry: number, face: number) {
    const last = tr.keys[tr.keys.length - 1];
    tr.keys.push({ t: t0, p: last.p, ry: last.ry, face: last.face }, { t: t1, p, ry, face });
  }

  private gesture(who: Person | null | undefined, side: 'L' | 'R', t0: number, t1: number, at: Gesture['at']) {
    if (who) this.gestures.push({ who, side, t0, t1, at });
  }

  private follow(tr: Track, dy = 0.035) {
    return (t: number, out: THREE.Vector3) => {
      this.sample(tr, t, out);
      out.y += dy;
      return out;
    };
  }

  private dealerReach(t: number) {
    const d = this.dealer;
    if (d && !d.rig) this.cue(t, () => ((d.actionKind = 'reach'), (d.action = 0.6)));
  }

  /** A stack of chips for an amount, appearing at `at` (or sliding there from `from`). */
  private stack(amount: number, at: THREE.Vector3, t0: number, from?: THREE.Vector3, base = 0): Track[] {
    const out: Track[] = [];
    chipBreakdown(amount)
      .slice(0, 12)
      .forEach((d, j) => {
        const p = new THREE.Vector3(at.x, TOP + CHIP_H / 2 + (base + j) * CHIP_H, at.z);
        const tr: Track = { id: chipHex(d), keys: [{ t: t0, p: from ? new THREE.Vector3(from.x, TOP + 0.04, from.z) : p, ry: 0, face: 0 }], gone: Infinity };
        if (from) this.move(tr, t0 + j * 0.04, t0 + 0.45 + j * 0.04, p, 0, 0);
        out.push(tr);
        this.chipTracks.push(tr);
      });
    return out;
  }

  private dealCard(card: Card, faceUp: boolean, spot: [THREE.Vector3, number], t0: number, into: Track[]) {
    const tr: Track = { id: card.rank ? cell(card) : BACK, keys: [{ t: t0, p: SHOE_AT.clone(), ry: -0.4, face: 0 }], gone: Infinity };
    tr.keys.push({ t: t0 + 0.38, p: spot[0], ry: spot[1], face: faceUp ? 1 : 0 });
    this.cardTracks.push(tr);
    into.push(tr);
    const side = spot[0].x > 0.05 ? 'L' : 'R';
    // The dealer's hand rides along with the card for the first half of its slide.
    this.gesture(this.dealer, side, t0 - 0.12, t0 + 0.32, this.follow(tr));
    this.dealerReach(t0);
    this.sound(t0 + 0.36, 'click', spot[0], 0.12, 1.7);
    return tr;
  }

  private discard(trs: Track[], t0: number) {
    trs.forEach((tr, k) => {
      const t = t0 + k * 0.06;
      this.move(tr, t, t + 0.45, new THREE.Vector3(DISCARD_AT.x, DISCARD_AT.y + 0.002, DISCARD_AT.z), 0.4, 0);
      tr.gone = t + 0.45;
    });
  }

  private toTray(trs: Track[], t0: number) {
    trs.forEach((tr, k) => {
      this.move(tr, t0 + k * 0.04, t0 + 0.5 + k * 0.04, new THREE.Vector3(-0.15 + Math.random() * 0.3, TOP + 0.04, 0.12), 0, 0);
      tr.gone = t0 + 0.5 + k * 0.04;
    });
  }

  private seatHands(k: number): Track[][] {
    let h = this.hands.get(k);
    if (!h) this.hands.set(k, (h = [[]]));
    return h;
  }

  private addCard(k: number, h: number, card: Card) {
    const key = `${k}:${h}`;
    const list = this.cardsOf.get(key) ?? [];
    list.push(card);
    this.cardsOf.set(key, list);
  }

  private mine(k: number) {
    return k === this.myRoundSeat;
  }

  /** Plays a batch of steps onto the timeline. */
  private play(steps: TableStep[]) {
    if (!this.backdating) this.T = Math.max(this.T, this.clock);
    else this.T = this.clock - 120;
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const settles: Extract<TableStep, { kind: 'settle' }>[] = [];
    let bets = 0,
      betT0 = -1;
    for (const st of steps) {
      this.log.push(st);
      let T = this.T;
      switch (st.kind) {
        case 'bet': {
          const k = st.seat;
          const [u, t] = this.frame(k);
          const at = this.stackAt(k, 0, 'bet');
          const npc = this.npcSeats.includes(k);
          if (betT0 < 0) betT0 = T;
          const t0 = betT0 + bets * 0.3;
          bets++;
          if (npc) {
            this.betChips.set(`${k}:0`, this.stack(st.amount, at, t0, V(u.x * 0.93 - t.x * 0.04, 0, u.z * 0.93 - t.z * 0.04)));
            this.gesture(this.persons.get(k), 'R', t0 - 0.1, t0 + 0.8, (kk, out) => out.set(u.x * 0.8, TOP + 0.04, u.z * 0.8).lerp(V(u.x * 0.93, TOP + 0.04, u.z * 0.93), 1 - THREE.MathUtils.clamp((kk - t0 - 0.1) / 0.5, 0, 1)));
          } else {
            // A player's chips are already in the circle.
            const p = this.pending.get(k);
            this.pending.delete(k);
            if (p) for (const tr of p.tracks) tr.gone = t0;
            this.betChips.set(`${k}:0`, this.stack(st.amount, at, t0));
            const o = this.owners.get(k);
            if (k === this.mySeat && (!o || o.token === this.me)) {
              this.myRoundSeat = k;
              this.staked += st.amount;
              this.lastBet = st.amount;
            }
          }
          this.sound(t0 + 0.6, 'chip', at, 0.25);
          // Bets are all down before the first card.
          this.T = t0 + 0.9;
          continue;
        }
        case 'deal': {
          if (st.to === 'dealer') this.dealCard(st.card, st.faceUp, this.dealerSpot(this.dealerHand.length), T, this.dealerHand);
          else {
            const hs = this.seatHands(st.to);
            this.dealCard(st.card, true, this.handSpot(st.to, 0, hs[0].length, 1), T, hs[0]);
            this.addCard(st.to, 0, st.card);
          }
          T += 0.45;
          break;
        }
        case 'peek': {
          const hole = this.dealerHand[1];
          if (!hole) break;
          const [p] = this.dealerSpot(1);
          this.move(hole, T + 0.2, T + 0.45, V(p.x, p.y + 0.012, p.z + 0.01), 0.15, 0);
          this.move(hole, T + 0.9, T + 1.1, p, 0, 0);
          this.gesture(this.dealer, 'R', T, T + 1.2, (_t, out) => out.set(p.x, TOP + 0.03, p.z));
          T += 1.3;
          break;
        }
        case 'turn': {
          // The dealer looks to you and waits.
          this.turnAt = T + 0.2;
          this.nudged = false;
          const k = st.seat;
          this.T = T;
          this.attend(k, st.hand, 1.2);
          if (k === this.mySeat && this.mine(k)) {
            this.cue(T + 0.2, () => {
              this.ctx.haptic?.('left', 0.25, 30);
              this.ctx.haptic?.('right', 0.25, 30);
              this.ctx.sound.play('ding', this.table.group.localToWorld(this.handSpot(k, st.hand, 0, 1)[0]), { volume: 0.18, rate: 1.2 });
            });
          }
          T += 0.4;
          break;
        }
        case 'hit': {
          const k = st.seat;
          const hs = this.seatHands(k);
          const [u] = this.frame(k);
          const npc = this.npcSeats.includes(k);
          if (npc) {
            // Two taps on the felt behind the cards.
            const base = V(u.x * 0.8, TOP + 0.015, u.z * 0.8);
            const t0 = T;
            this.gesture(this.persons.get(k), 'R', t0, t0 + 0.85, (t, out) => out.copy(base).setY(TOP + 0.015 + 0.035 * Math.abs(Math.sin(((t - t0) / 0.85) * Math.PI * 2))));
            this.sound(T + 0.3, 'click', base, 0.08, 0.7);
            T += 0.7;
          } else {
            this.cue(T, () => (this.nodAt = this.clock));
            T += 0.15;
          }
          const hand = hs[st.hand] ?? (hs[st.hand] = []);
          this.dealCard(st.card, true, this.handSpot(k, st.hand, hand.length, hs.length), T, hand);
          this.addCard(k, st.hand, st.card);
          T += 0.55;
          if (!npc && this.turnAt !== Infinity) {
            // Your next call counts from when the card has landed.
            this.turnAt = T;
            this.nudged = false;
          }
          break;
        }
        case 'double': {
          const k = st.seat;
          const hs = this.seatHands(k);
          this.cue(T, () => (this.nodAt = this.clock));
          // The second stack goes down beside the first.
          const dbl = this.stackAt(k, st.hand, 'double');
          const add = this.stack(st.bet, dbl, T);
          this.betChips.set(`${k}:${st.hand}`, [...(this.betChips.get(`${k}:${st.hand}`) ?? []), ...add]);
          this.sound(T, 'chip', dbl, 0.3);
          if (this.mine(k)) {
            this.clearSide();
            try {
              this.ctx.bankroll?.debit(st.bet, 'bet', 'blackjack');
            } catch {
              /* already spent elsewhere: the house lets it go */
            }
            this.staked += st.bet;
          }
          const hand = hs[st.hand] ?? (hs[st.hand] = []);
          // Doubled: one card, dealt sideways.
          this.dealCard(st.card, true, this.handSpot(k, st.hand, hand.length, hs.length, true), T + 0.3, hand);
          this.addCard(k, st.hand, st.card);
          T += 0.95;
          break;
        }
        case 'split': {
          const k = st.seat;
          const hs = this.seatHands(k);
          this.cue(T, () => (this.nodAt = this.clock));
          const first = hs[0];
          const second = first.splice(1, 1);
          hs[1] = second;
          const c0 = this.cardsOf.get(`${k}:0`) ?? [];
          this.cardsOf.set(`${k}:1`, c0.splice(1, 1));
          for (const [h, list] of hs.entries()) {
            const [p, ry] = this.handSpot(k, h, 0, 2);
            if (list[0]) this.move(list[0], T, T + 0.4, p, ry, 1);
          }
          this.gesture(this.dealer, 'R', T - 0.1, T + 0.5, this.follow(second[0] ?? first[0], 0.03));
          const b1 = this.stack(st.bet, this.stackAt(k, 1, 'bet'), T);
          this.betChips.set(`${k}:1`, b1);
          this.sound(T + 0.3, 'chip', this.stackAt(k, 1, 'bet'), 0.3);
          if (this.mine(k)) {
            this.clearSide();
            try {
              this.ctx.bankroll?.debit(st.bet, 'bet', 'blackjack');
            } catch {
              /* already spent elsewhere */
            }
            this.staked += st.bet;
          }
          T += 0.7;
          break;
        }
        case 'stand': {
          const k = st.seat;
          if (this.npcSeats.includes(k)) {
            const [u, t] = this.frame(k);
            const t0 = T;
            // Wave it off: flat hand side to side over the cards.
            this.gesture(this.persons.get(k), 'R', t0, t0 + 1.0, (kk, out) => out.set(u.x * 0.83, TOP + 0.1, u.z * 0.83).addScaledVector(t, 0.07 * Math.sin(((kk - t0) / 1.0) * Math.PI * 3)));
            T += 1.05;
          } else {
            this.cue(T, () => (this.nodAt = this.clock));
            T += 0.3;
          }
          break;
        }
        case 'bust': {
          const k = st.seat;
          const key = `${k}:${st.hand}`;
          const cards = this.seatHands(k)[st.hand] ?? [];
          this.discard(cards, T + 0.3);
          this.toTray(this.betChips.get(key) ?? [], T + 0.5);
          if (cards[0]) this.gesture(this.dealer, 'R', T + 0.2, T + 1.0, this.follow(cards[0], 0.03));
          this.sound(T + 0.9, 'chips', V(0, TOP, 0.12), 0.18);
          this.taken.add(key);
          const who = this.persons.get(k);
          if (who) this.cue(T + 0.2, () => (who.gaspT = 0.9));
          T += 1.2;
          break;
        }
        case 'reveal': {
          const hole = this.dealerHand[1];
          if (!hole) break;
          hole.id = cell(st.card);
          const [p] = this.dealerSpot(1);
          this.move(hole, T + 0.15, T + 0.6, p, 0, 1);
          this.gesture(this.dealer, 'R', T, T + 0.7, this.follow(hole, 0.03));
          this.dealerReach(T);
          this.sound(T + 0.55, 'click', p, 0.12, 1.4);
          this.waiting = null;
          this.turnAt = Infinity;
          T += 1.0;
          break;
        }
        case 'dealerHit': {
          this.dealCard(st.card, true, this.dealerSpot(this.dealerHand.length), T, this.dealerHand);
          T += 0.8;
          break;
        }
        case 'settle':
          settles.push(st);
          break;
      }
      this.T = T;
    }
    if (settles.length) this.payout(settles);
    this.backdating = false;
  }

  /** Pay and take, third base first (the dealer's right), then sweep the cards. */
  private payout(settles: Extract<TableStep, { kind: 'settle' }>[]) {
    let T = this.T + 0.5;
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const won: { k: number; h: number }[] = [];
    for (const st of [...settles].reverse()) {
      const k = st.seat,
        h = st.hand;
      const key = `${k}:${h}`;
      const [u] = this.frame(k);
      const who = this.persons.get(k);
      const circle = this.stackAt(k, h, 'bet');
      const mine = this.mine(k);
      if (mine) {
        this.returned += st.returned;
        if (st.returned > 0) {
          const amt = st.returned;
          const reason = st.outcome === 'push' ? 'refund' : 'win';
          this.cue(T + 0.5, () => this.ctx.bankroll?.credit(amt, reason, 'blackjack'));
        }
      }
      if (this.taken.has(key)) continue;
      if (st.outcome === 'win' || st.outcome === 'blackjack') {
        this.payChips.set(key, this.stack(st.returned - st.bet, this.stackAt(k, h, 'pay'), T, V(0.05, 0, 0.08)));
        this.gesture(this.dealer, u.x > 0 ? 'L' : 'R', T - 0.1, T + 0.6, (_t, out) => out.set(circle.x * 0.8, TOP + 0.05, circle.z * 0.8));
        this.dealerReach(T);
        this.sound(T + 0.45, 'chips', circle, 0.22);
        if (who) this.cue(T + 0.5, () => (who.cheer = Math.max(who.cheer, st.outcome === 'blackjack' ? 1.6 : 0.9)));
        if (mine) this.sound(T + 0.5, st.outcome === 'blackjack' ? 'winBig' : 'winSmall', circle, 0.35);
        won.push({ k, h });
        T += 0.9;
      } else if (st.outcome === 'lose') {
        this.toTray(this.betChips.get(key) ?? [], T + 0.15);
        this.gesture(this.dealer, u.x > 0 ? 'L' : 'R', T, T + 0.7, (_t, out) => out.set(circle.x * 0.85, TOP + 0.04, circle.z * 0.85));
        this.dealerReach(T);
        this.sound(T + 0.6, 'chips', V(0, TOP, 0.12), 0.15);
        T += 0.75;
      } else if (st.outcome === 'push') {
        // Push: the dealer taps the felt by the bet.
        this.gesture(this.dealer, u.x > 0 ? 'L' : 'R', T, T + 0.6, (_t, out) => out.set(circle.x * 0.85, TOP + 0.02, circle.z * 0.85));
        won.push({ k, h });
        T += 0.6;
      }
    }
    // Everyone pulls in what's theirs (guests to their stacks, you toward your rack).
    won.forEach(({ k, h }, i) => {
      const key = `${k}:${h}`;
      const [u, t] = this.frame(k);
      const mineChips = [...(this.betChips.get(key) ?? []), ...(this.payChips.get(key) ?? [])];
      const t0 = T + 0.2 + i * 0.15;
      const npc = this.npcSeats.includes(k);
      const dest = npc ? V(u.x * 0.93 + t.x * 0.05, 0, u.z * 0.93 + t.z * 0.05) : V(u.x * 0.92, 0, u.z * 0.92);
      mineChips.forEach((tr, j) => {
        this.move(tr, t0 + 0.2, t0 + 0.65, V(dest.x, TOP + CHIP_H / 2 + (5 + j) * CHIP_H, dest.z), 0, 0);
        tr.gone = t0 + (npc ? 1.4 : 0.7);
      });
      this.gesture(this.persons.get(k), 'R', t0, t0 + 0.8, (kk, out) => out.set(u.x * 0.8, TOP + 0.04, u.z * 0.8).lerp(V(u.x * 0.93, TOP + 0.04, u.z * 0.93), THREE.MathUtils.clamp((kk - t0 - 0.2) / 0.45, 0, 1)));
    });
    T += 0.8;
    if (this.myRoundSeat !== null) {
      const staked = this.staked,
        returned = this.returned;
      this.cue(T, () => {
        this.ctx.bankroll?.countRound();
        const net = returned - staked;
        this.ctx.toast?.(net > 0 ? `Blackjack: you win ${money(net)}` : net < 0 ? `Blackjack: you lose ${money(-net)}` : 'Blackjack: push', net > 0 ? 'win' : 'info');
        this.ctx.onResult?.(staked, returned);
      });
    }
    // Sweep the cards to the discard rack, dealer's hand last.
    const left = this.cardTracks.filter((tr) => tr.gone === Infinity && !this.dealerHand.includes(tr));
    this.discard(left, T);
    if (left[0]) this.gesture(this.dealer, 'R', T - 0.1, T + 0.6 + left.length * 0.06, this.follow(left[Math.floor(left.length / 2)], 0.03));
    T += 0.4 + left.length * 0.06;
    this.discard(this.dealerHand, T);
    if (this.dealerHand[0]) this.gesture(this.dealer, 'R', T - 0.1, T + 0.6, this.follow(this.dealerHand[0], 0.03));
    this.sound(T + 0.4, 'click', DISCARD_AT, 0.1, 1.2);
    T += 0.9;
    this.T = T;
    this.sweepEnd = T;
    this.nextAuto = Math.max(T + 2, this.roundStart + 20 + Math.random() * 8);
    this.waiting = null;
    this.round = null;
  }

  /** A track's table-local position at `t` (with an arc between distant keys). */
  private sample(tr: Track, t: number, out: THREE.Vector3): { ry: number; face: number } {
    const ks = tr.keys;
    let i = 0;
    while (i < ks.length - 1 && ks[i + 1].t <= t) i++;
    const a = ks[i],
      b = ks[Math.min(i + 1, ks.length - 1)];
    if (a === b || t <= a.t) {
      out.copy(a.p);
      return { ry: a.ry, face: a.face };
    }
    const u = THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1);
    const e = u * u * (3 - 2 * u);
    out.lerpVectors(a.p, b.p, e);
    const d = a.p.distanceTo(b.p);
    out.y += Math.sin(u * Math.PI) * Math.min(0.04, d * 0.08) + Math.sin(u * Math.PI) * Math.abs(b.face - a.face) * 0.035;
    return { ry: a.ry + (b.ry - a.ry) * e, face: a.face + (b.face - a.face) * e };
  }

  /** Chips sitting in players' circles before the deal. */
  private refreshPending() {
    for (const [k, o] of this.owners) {
      const amount = o.token === this.me ? this.myPending : pend(o);
      const cur = this.pending.get(k);
      if ((cur?.amount ?? 0) === amount) continue;
      if (cur) for (const tr of cur.tracks) tr.gone = this.clock;
      this.pending.delete(k);
      if (amount > 0) this.pending.set(k, { amount, tracks: this.stack(amount, this.stackAt(k, 0, 'bet'), this.clock - 1) });
    }
    for (const [k, cur] of this.pending)
      if (!this.owners.has(k)) {
        for (const tr of cur.tracks) tr.gone = this.clock;
        this.pending.delete(k);
      }
  }

  private drawLabel() {
    const k = this.mySeat;
    let text = '';
    if (k !== null) {
      const cards = this.myRoundSeat === k ? this.cardsOf.get(`${k}:${this.waiting?.seat === k ? this.waiting.hand : 0}`) ?? [] : [];
      const v = handValue(cards);
      const tot = cards.length ? `${v.soft && v.total < 21 ? 'soft ' : ''}${v.total}` : '';
      if (this.isMyTurn) text = this.vr ? `${tot} · tap = hit · wave = stand` : `${tot} · hit or stand?`;
      else if (this.myRoundSeat === k && this.phase === 'round') text = tot ? `Your hand: ${tot}` : '';
      else if (this.canBet()) text = this.vr && this.myPending === 0 ? 'Drop chips in your circle' : this.myPending > 0 ? `Bet ${money(this.myPending)}${this.myPending < this.min ? ` · min ${money(this.min)}` : ''}` : `Place your bet · ${money(this.min)}–${money(this.max)}`;
    }
    const L = this.label;
    L.mesh.visible = !!text;
    if (text === L.text) return;
    L.text = text;
    if (!text || k === null) return;
    const g = L.g;
    g.clearRect(0, 0, 512, 112);
    g.fillStyle = 'rgba(10,8,6,0.72)';
    g.beginPath();
    g.roundRect(4, 4, 504, 104, 26);
    g.fill();
    g.strokeStyle = '#d4a94e';
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = '#ffe9b8';
    g.font = `600 ${text.length > 30 ? 34 : 42}px Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 58);
    L.tex.needsUpdate = true;
    const [u] = this.frame(k);
    L.mesh.position.set(u.x * 0.43, TOP + 0.06, u.z * 0.43);
    const eye = this.table.group.localToWorld(new THREE.Vector3(u.x * 1.5, TOP + 0.55, u.z * 1.5));
    L.mesh.lookAt(eye);
  }

  update(dt: number, playerPos: THREE.Vector3) {
    this.live = playerPos.distanceTo(this.center) < LIVE_DIST || this.owners.size > 0 || this.myRoundSeat !== null || this.mySeat !== null;
    if (!this.live) return;
    this.clock += Math.min(dt, 0.1);
    const t = this.clock;
    if (this.authority) this.tick();
    else if (!this.mirror && this.mySeat === null) this.tickLocal();
    else if (this.mirror && this.phase === 'betting' && this.mySeat === null && this.owners.size === 0 && this.myRoundSeat === null) this.leaveMirror();
    if (this.phase === 'round' && !this.round && t >= this.sweepEnd && (this.authority || this.mirror ? this.log.some((s) => s.kind === 'settle') : true)) {
      this.phase = 'betting';
      this.bettingSince = t;
      this.myRoundSeat = null;
      if (this.authority) this.net?.changed();
    }
    this.refreshPending();
    // Sounds and actions that come due.
    if (this.cues.length) {
      const due = this.cues.filter((c) => c.t <= t);
      if (due.length) {
        this.cues = this.cues.filter((c) => c.t > t);
        for (const c of due) c.fn();
      }
    }
    // Your turn: a ring round the hand being played.
    const w = this.waiting;
    const showRing = !!w && t >= this.turnAt && !this.npcSeats.includes(w.seat);
    this.marker.visible = showRing;
    if (showRing && w) {
      const [p] = this.handSpot(w.seat, w.hand, 0, this.hands.get(w.seat)?.length ?? 1);
      this.marker.position.set(p.x, TOP + 0.003, p.z);
      (this.marker.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.35 * Math.sin(t * 4);
    }
    this.drawLabel();
    // Cards.
    let n = 0;
    for (const tr of this.cardTracks) {
      if (t < tr.keys[0].t || t >= tr.gone || n >= MAX_CARDS) continue;
      const { ry, face } = this.sample(tr, t, this.o.position);
      // Turning over about the card's long edge; the face shows once it's past upright.
      const phi = Math.PI * (1 - face);
      const showFace = phi < Math.PI / 2;
      this.o.rotation.set(0, ry, 0, 'YXZ');
      this.o.rotateZ(showFace ? phi : phi - Math.PI);
      this.o.updateMatrix();
      this.cards.setMatrixAt(n, this.o.matrix);
      this.cellAttr.setX(n, showFace ? tr.id : BACK);
      n++;
    }
    this.cards.count = n;
    this.cards.instanceMatrix.needsUpdate = true;
    this.cellAttr.needsUpdate = true;
    // Chips (the guests' stacks by the rail, bets and payouts).
    let m = 0;
    const col = new THREE.Color();
    for (const list of [this.stash, this.chipTracks])
      for (const tr of list) {
        if (t < tr.keys[0].t || t >= tr.gone || m >= MAX_CHIPS) continue;
        this.sample(tr, t, this.o.position);
        this.o.rotation.set(0, 0, 0);
        this.o.updateMatrix();
        this.chips.setMatrixAt(m, this.o.matrix);
        this.chips.setColorAt(m, col.setHex(tr.id));
        m++;
      }
    this.chips.count = m;
    this.chips.instanceMatrix.needsUpdate = true;
    if (this.chips.instanceColor) this.chips.instanceColor.needsUpdate = true;
  }

  /** Host / solo: deal when it's time, and keep the turn moving. */
  private tick() {
    const t = this.clock;
    if (this.shouldDeal()) this.startRound();
    const w = this.round?.waiting;
    if (this.round && w && t >= this.turnAt) {
      const o = this.owners.get(w.seat);
      const waited = t - this.turnAt;
      if (!o && waited > 1.5) this.autoStand(w.seat);
      else if (waited > AUTO_STAND_AFTER) {
        this.autoStand(w.seat);
        if (w.seat === this.mySeat) this.ctx.toast?.('The dealer stood your hand for you', 'info');
      } else if (waited > NUDGE_AFTER && !this.nudged) {
        this.nudged = true;
        this.nudge();
        this.net?.changed();
      }
    }
  }

  private autoStand(seat: number) {
    const steps = this.round?.act(seat, 'stand');
    if (steps) this.feed(steps);
  }

  /** Guest, not playing: the guests here play a round of their own (nobody to sync with). */
  private tickLocal() {
    if (this.phase === 'betting' && this.clock >= Math.max(this.nextAuto, this.sweepEnd)) {
      this.round = new TableRound(this.shoe, this.npcSeats.map((k) => ({ seat: k, bet: this.min * (1 + Math.floor(Math.random() * 3)), auto: true })));
      this.beginRound();
      this.play(this.round.start());
    }
  }

  /** For tests and debugging in the page. */
  debug() {
    return {
      phase: this.phase,
      roundId: this.roundId,
      mySeat: this.mySeat,
      myRoundSeat: this.myRoundSeat,
      pending: this.myPending,
      waiting: this.waiting,
      myTurn: this.isMyTurn,
      mirror: this.mirror,
      owners: [...this.owners].map(([k, o]) => ({ k, name: o.name, pending: pend(o) })),
      hands: [...this.cardsOf].map(([k, c]) => `${k}=${c.map((x) => (x.rank ? RANKS[x.rank - 1] + SUITS[x.suit] : '??')).join(' ')}`),
      dealer: this.log.filter((s) => s.kind === 'deal' && s.to === 'dealer').length,
      steps: this.log.length,
      clock: this.clock,
      turnAt: this.turnAt,
    };
  }
}
