import * as THREE from 'three';
import { type Card, playRound, RANKS, type Round, Shoe, SUITS } from '../rules/blackjack';
import type { Rng } from '../rules/rng';
import type { Sound } from './audio';
import { envelope, handTo } from './gestures';
import type { Person } from './people';
import { DISCARD_AT, type PitTable, SHOE_AT, spotAngle, TOP } from './pit';

/**
 * The pit's blackjack tables deal real hands to their guests: bets go out,
 * cards slide from the shoe to every player and the dealer, players tap for a
 * card or wave it off, the dealer turns the hole card and draws to 17, wins
 * are paid and losses taken, and the cards are swept to the discard rack.
 * The hands are played by the rules in rules/blackjack.ts; this compiles a
 * round into a timeline of card / chip moves, gestures and sounds and plays
 * it back. Every card on a table is one instanced quad (one shared card-face
 * atlas), every chip one instanced cylinder: two draw calls per table. It only
 * runs while you're within 15 m.
 */

const LIVE_DIST = 15;
const MAX_CARDS = 48;
const MAX_CHIPS = 96;
const CARD_W = 0.063,
  CARD_H = 0.088;
const CHIP_H = 0.0034;
/** Chip colours by denomination (as in the tray: white 1, red 5, green 25, black 100, purple 500). */
const CHIP = { 1: 0xf2f0ea, 5: 0xc0262d, 25: 0x1e7a3a, 100: 0x1b1b1f, 500: 0x6b2f8f } as const;
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
function chipMat(): THREE.MeshStandardMaterial {
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

function cardMat(): THREE.MeshStandardMaterial {
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

export class BlackjackPlay {
  private cards: THREE.InstancedMesh;
  private cellAttr: THREE.InstancedBufferAttribute;
  private chips: THREE.InstancedMesh;
  private shoe: Shoe;
  private clock = 0;
  private roundEnd = 0;
  private cardTracks: Track[] = [];
  private chipTracks: Track[] = [];
  private gestures: Gesture[] = [];
  private cues: Cue[] = [];
  private stash: Track[] = [];
  private live = false;
  private o = new THREE.Object3D();
  private v = new THREE.Vector3();
  private center: THREE.Vector3;
  /** The last round played (for debugging and tests in the page). */
  last: Round | null = null;

  constructor(
    private ctx: { sound: Sound; rng?: Rng },
    private table: PitTable,
    private dealer: Person | null,
    private seats: { seat: number; person: Person | null }[],
    private min: number,
  ) {
    const rng: Rng = ctx.rng ?? { int: (n) => Math.floor(Math.random() * n) };
    this.shoe = new Shoe(rng, 6);
    this.seats.sort((a, b) => a.seat - b.seat);
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
    for (const s of this.seats) {
      const [u, t] = this.frame(s.seat);
      for (let j = 0; j < 5; j++) {
        const p = new THREE.Vector3(u.x * 0.93 + t.x * 0.05, TOP + CHIP_H / 2 + j * CHIP_H, u.z * 0.93 + t.z * 0.05);
        this.stash.push({ id: this.chipColor(j < 3 ? this.min : this.min * 4), keys: [{ t: -1, p, ry: 0, face: 0 }], gone: Infinity });
      }
    }
    // Dealers and guests move their hands through `onPose` (animated characters).
    const pose = (who: Person) => (p: Person) => {
      for (const g of this.gestures) {
        if (g.who !== who || !this.live) continue;
        const w = envelope(this.clock, g.t0, g.t1, 0.22);
        if (w <= 0) continue;
        g.at(this.clock, this.v);
        this.table.group.localToWorld(this.v);
        handTo(p, g.side, this.v, w);
      }
    };
    if (dealer) dealer.onPose = pose(dealer);
    for (const s of this.seats) if (s.person) s.person.onPose = pose(s.person);
    this.clock = 0;
    this.roundEnd = 2 + Math.random() * 6;
  }

  /** Table-local unit vectors at a betting spot: out toward the player, and across (to the player's left). */
  private frame(k: number): [THREE.Vector3, THREE.Vector3] {
    const a = spotAngle(k);
    return [new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), new THREE.Vector3(-Math.sin(a), 0, Math.cos(a))];
  }

  private chipColor(amount: number): number {
    const d = amount >= 500 ? 500 : amount >= 100 ? 100 : amount >= 25 ? 25 : amount >= 5 ? 5 : 1;
    return CHIP[d as keyof typeof CHIP];
  }

  /** Plays out a round with the rules and turns it into a timeline. */
  private compile(T0: number) {
    this.cardTracks = [];
    this.chipTracks = [];
    this.gestures = [];
    this.cues = [];
    const n = this.seats.length;
    const unit = this.min;
    const bets = this.seats.map(() => unit * (1 + Math.floor(Math.random() * 3)));
    const round = playRound(this.shoe, bets);
    this.last = round;
    let T = T0 + 0.4;
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const sound = (t: number, name: Parameters<Sound['play']>[0], at: THREE.Vector3, volume: number, rate = 1) =>
      this.cues.push({ t, fn: () => this.ctx.sound.play(name, this.table.group.localToWorld(at.clone()), { volume, rate }) });
    const move = (tr: Track, t0: number, t1: number, p: THREE.Vector3, ry: number, face: number) => {
      const last = tr.keys[tr.keys.length - 1];
      tr.keys.push({ t: t0, p: last.p, ry: last.ry, face: last.face }, { t: t1, p, ry, face });
    };
    const seatPerson = (s: number) => this.seats[s].person;
    const gesture = (who: Person | null, side: 'L' | 'R', t0: number, t1: number, at: Gesture['at']) => {
      if (who) this.gestures.push({ who, side, t0, t1, at });
    };
    const fixed = (p: THREE.Vector3) => (_t: number, out: THREE.Vector3) => out.copy(p);
    const follow = (tr: Track, dy = 0.035) => (t: number, out: THREE.Vector3) => {
      this.sample(tr, t, out);
      out.y += dy;
      return out;
    };
    // Simple bodies (no animated character) use the stock 'reach' action.
    const dealerReach = (t: number) => {
      if (this.dealer && !this.dealer.rig) this.cues.push({ t, fn: () => ((this.dealer!.actionKind = 'reach'), (this.dealer!.action = 0.6)) });
    };

    // --- Bets: each guest slides a stack into the circle.
    const betChips: Track[][] = [];
    const payChips: Track[][] = this.seats.map(() => []);
    this.seats.forEach((s, i) => {
      const [u, t] = this.frame(s.seat);
      const stack: Track[] = [];
      const count = bets[i] / unit;
      const t0 = T + i * 0.35;
      for (let j = 0; j < count; j++) {
        const from = V(u.x * 0.93 - t.x * 0.04, TOP + CHIP_H / 2 + j * CHIP_H, u.z * 0.93 - t.z * 0.04);
        const tr: Track = { id: this.chipColor(unit), keys: [{ t: t0 - 0.01, p: from, ry: 0, face: 0 }], gone: Infinity };
        move(tr, t0 + 0.15, t0 + 0.6, V(u.x * 0.8, TOP + CHIP_H / 2 + j * CHIP_H, u.z * 0.8), 0, 0);
        stack.push(tr);
        this.chipTracks.push(tr);
      }
      betChips.push(stack);
      gesture(s.person, 'R', t0 - 0.1, t0 + 0.8, (k, out) => out.set(u.x * 0.8, TOP + 0.04, u.z * 0.8).lerp(V(u.x * 0.93, TOP + 0.04, u.z * 0.93), 1 - THREE.MathUtils.clamp((k - t0 - 0.1) / 0.5, 0, 1)));
      sound(t0 + 0.6, 'chip', V(u.x * 0.8, TOP, u.z * 0.8), 0.25);
    });
    T += n * 0.35 + 0.9;

    // --- Card placement.
    const hands: Track[][] = this.seats.map(() => []);
    const dealerHand: Track[] = [];
    const handSpot = (i: number, j: number): [THREE.Vector3, number] => {
      const k = this.seats[i].seat;
      const [u, t] = this.frame(k);
      const p = V(u.x * 0.6 + t.x * j * 0.022 + u.x * j * 0.012, TOP + 0.0012 + j * 0.0007, u.z * 0.6 + t.z * j * 0.022 + u.z * j * 0.012);
      return [p, Math.PI / 2 - spotAngle(k)];
    };
    const dealerSpot = (j: number): [THREE.Vector3, number] => [V(-0.05 + j * 0.05, TOP + 0.0012 + j * 0.0007, 0.3), 0];
    const dealCard = (card: Card, faceUp: boolean, spot: [THREE.Vector3, number], t0: number, into: Track[]) => {
      const tr: Track = { id: cell(card), keys: [{ t: t0, p: SHOE_AT.clone(), ry: -0.4, face: 0 }], gone: Infinity };
      tr.keys.push({ t: t0 + 0.38, p: spot[0], ry: spot[1], face: faceUp ? 1 : 0 });
      this.cardTracks.push(tr);
      into.push(tr);
      const side = spot[0].x > 0.05 ? 'L' : 'R';
      // The dealer's hand rides along with the card for the first half of its slide.
      gesture(this.dealer, side, t0 - 0.12, t0 + 0.32, follow(tr));
      dealerReach(t0);
      sound(t0 + 0.36, 'click', spot[0], 0.12, 1.7);
      return tr;
    };

    let step = 0;
    const steps = round.steps;
    // --- Initial deal: two passes.
    for (; step < steps.length && steps[step].kind === 'deal'; step++) {
      const st = steps[step] as Extract<Round['steps'][number], { kind: 'deal' }>;
      if (st.to === 'dealer') dealCard(st.card, st.faceUp, dealerSpot(dealerHand.length), T, dealerHand);
      else dealCard(st.card, st.faceUp, handSpot(st.to, hands[st.to].length), T, hands[st.to]);
      T += 0.45;
    }
    T += 0.4;

    const discard = (trs: Track[], t0: number) => {
      trs.forEach((tr, k) => {
        const t = t0 + k * 0.06;
        move(tr, t, t + 0.45, V(DISCARD_AT.x, DISCARD_AT.y + 0.002, DISCARD_AT.z), 0.4, 0);
        tr.gone = t + 0.45;
      });
    };
    const toTray = (trs: Track[], t0: number) => {
      trs.forEach((tr, k) => {
        move(tr, t0 + k * 0.04, t0 + 0.5 + k * 0.04, V(-0.15 + Math.random() * 0.3, TOP + 0.04, 0.12), 0, 0);
        tr.gone = t0 + 0.5 + k * 0.04;
      });
    };
    const taken = new Set<number>();

    for (; step < steps.length; step++) {
      const st = steps[step];
      switch (st.kind) {
        case 'peek': {
          // The dealer checks under the ace or ten: lift the hole card's corner.
          const hole = dealerHand[1];
          const [p] = dealerSpot(1);
          move(hole, T + 0.2, T + 0.45, V(p.x, p.y + 0.012, p.z + 0.01), 0.15, 0);
          move(hole, T + 0.9, T + 1.1, p, 0, 0);
          gesture(this.dealer, 'R', T, T + 1.2, fixed(V(p.x, TOP + 0.03, p.z)));
          T += 1.3;
          break;
        }
        case 'hit': {
          const [u] = this.frame(this.seats[st.seat].seat);
          // Two taps on the felt behind the cards.
          const base = V(u.x * 0.8, TOP + 0.015, u.z * 0.8);
          const t0 = T;
          gesture(seatPerson(st.seat), 'R', t0, t0 + 0.85, (t, out) => out.copy(base).setY(TOP + 0.015 + 0.035 * Math.abs(Math.sin(((t - t0) / 0.85) * Math.PI * 2))));
          sound(T + 0.3, 'click', base, 0.08, 0.7);
          dealCard(st.card, true, handSpot(st.seat, hands[st.seat].length), T + 0.7, hands[st.seat]);
          T += 1.25;
          break;
        }
        case 'stand': {
          const [u, t] = this.frame(this.seats[st.seat].seat);
          const t0 = T;
          // Wave it off: flat hand side to side over the cards.
          gesture(seatPerson(st.seat), 'R', t0, t0 + 1.0, (k, out) =>
            out.set(u.x * 0.83, TOP + 0.1, u.z * 0.83).addScaledVector(t, 0.07 * Math.sin(((k - t0) / 1.0) * Math.PI * 3)),
          );
          T += 1.05;
          break;
        }
        case 'bust': {
          // Busted: the dealer takes the cards and the bet straight away.
          discard(hands[st.seat], T + 0.3);
          toTray(betChips[st.seat], T + 0.5);
          gesture(this.dealer, 'R', T + 0.2, T + 1.0, follow(hands[st.seat][0], 0.03));
          sound(T + 0.9, 'chips', V(0, TOP, 0.12), 0.18);
          taken.add(st.seat);
          const who = seatPerson(st.seat);
          if (who) this.cues.push({ t: T + 0.2, fn: () => (who.gaspT = 0.9) });
          T += 1.2;
          break;
        }
        case 'reveal': {
          const hole = dealerHand[1];
          const [p] = dealerSpot(1);
          move(hole, T + 0.15, T + 0.6, p, 0, 1);
          gesture(this.dealer, 'R', T, T + 0.7, follow(hole, 0.03));
          dealerReach(T);
          sound(T + 0.55, 'click', p, 0.12, 1.4);
          T += 1.0;
          break;
        }
        case 'dealerHit': {
          dealCard(st.card, true, dealerSpot(dealerHand.length), T, dealerHand);
          T += 0.8;
          break;
        }
        case 'settle': {
          // Handled below, from third base back to first.
          break;
        }
      }
    }
    T += 0.5;
    // --- Pay and take, third base first (the dealer's right).
    const settles = steps.filter((s): s is Extract<Round['steps'][number], { kind: 'settle' }> => s.kind === 'settle').reverse();
    for (const st of settles) {
      if (taken.has(st.seat)) continue;
      const [u, t] = this.frame(this.seats[st.seat].seat);
      const who = seatPerson(st.seat);
      const circle = V(u.x * 0.8, 0, u.z * 0.8);
      if (st.outcome === 'win' || st.outcome === 'blackjack') {
        const count = Math.ceil(((st.returned - st.bet) / unit) * 1);
        const stack: Track[] = [];
        for (let j = 0; j < count; j++) {
          const from = V(-0.25 + 0.2 + (j % 2) * 0.1, TOP + 0.04, 0.08);
          const tr: Track = { id: this.chipColor(unit), keys: [{ t: T + j * 0.05, p: from, ry: 0, face: 0 }], gone: Infinity };
          move(tr, T + j * 0.05, T + 0.45 + j * 0.05, V(circle.x + t.x * 0.045, TOP + CHIP_H / 2 + j * CHIP_H, circle.z + t.z * 0.045), 0, 0);
          stack.push(tr);
          this.chipTracks.push(tr);
        }
        payChips[st.seat] = stack;
        gesture(this.dealer, u.x > 0 ? 'L' : 'R', T - 0.1, T + 0.6, fixed(V(circle.x * 0.8, TOP + 0.05, circle.z * 0.8)));
        dealerReach(T);
        sound(T + 0.45, 'chips', circle, 0.22);
        if (who) this.cues.push({ t: T + 0.5, fn: () => (who.cheer = Math.max(who.cheer, st.outcome === 'blackjack' ? 1.6 : 0.9)) });
        T += 0.9;
      } else if (st.outcome === 'lose') {
        toTray(betChips[st.seat], T + 0.15);
        gesture(this.dealer, u.x > 0 ? 'L' : 'R', T, T + 0.7, fixed(V(circle.x * 0.85, TOP + 0.04, circle.z * 0.85)));
        dealerReach(T);
        sound(T + 0.6, 'chips', V(0, TOP, 0.12), 0.15);
        T += 0.75;
      } else {
        // Push: the dealer taps the felt by the bet.
        gesture(this.dealer, u.x > 0 ? 'L' : 'R', T, T + 0.6, fixed(V(circle.x * 0.85, TOP + 0.02, circle.z * 0.85)));
        T += 0.6;
      }
    }
    // Guests pull in what's theirs.
    this.seats.forEach((s, i) => {
      if (taken.has(i)) return;
      const r = round.results[i];
      if (r.outcome === 'lose' || r.outcome === 'bust') return;
      const [u, t] = this.frame(s.seat);
      const mine = [...betChips[i], ...payChips[i]];
      const t0 = T + 0.2 + i * 0.15;
      mine.forEach((tr, j) => {
        move(tr, t0 + 0.2, t0 + 0.65, V(u.x * 0.93 + t.x * 0.05, TOP + CHIP_H / 2 + (5 + j) * CHIP_H, u.z * 0.93 + t.z * 0.05), 0, 0);
        tr.gone = t0 + 1.4;
      });
      gesture(s.person, 'R', t0, t0 + 0.8, (k, out) => out.set(u.x * 0.8, TOP + 0.04, u.z * 0.8).lerp(V(u.x * 0.93, TOP + 0.04, u.z * 0.93), THREE.MathUtils.clamp((k - t0 - 0.2) / 0.45, 0, 1)));
    });
    T += 0.8;
    // --- Sweep the cards to the discard rack, dealer's hand last.
    const left = this.cardTracks.filter((tr) => tr.gone === Infinity && !dealerHand.includes(tr));
    discard(left, T);
    if (left[0]) gesture(this.dealer, 'R', T - 0.1, T + 0.6 + left.length * 0.06, follow(left[Math.floor(left.length / 2)], 0.03));
    T += 0.4 + left.length * 0.06;
    discard(dealerHand, T);
    gesture(this.dealer, 'R', T - 0.1, T + 0.6, follow(dealerHand[0], 0.03));
    sound(T + 0.4, 'click', DISCARD_AT, 0.1, 1.2);
    T += 0.9;
    // Rounds come round every ~20–30 s.
    this.roundEnd = Math.max(T + 2, T0 + 20 + Math.random() * 8);
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

  update(dt: number, playerPos: THREE.Vector3) {
    this.live = playerPos.distanceTo(this.center) < LIVE_DIST;
    if (!this.live) return;
    this.clock += Math.min(dt, 0.1);
    const t = this.clock;
    if (t >= this.roundEnd) this.compile(t);
    // Sounds and actions that come due.
    if (this.cues.length) {
      const due = this.cues.filter((c) => c.t <= t);
      if (due.length) {
        this.cues = this.cues.filter((c) => c.t > t);
        for (const c of due) c.fn();
      }
    }
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
    for (const list of [this.stash, this.chipTracks]) for (const tr of list) {
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
}
