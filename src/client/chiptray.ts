import * as THREE from 'three';
import type { ChipLedger } from '../rules/chipledger';
import { greedyBreakdown } from '../rules/chiprack';
import type { Sound } from './audio';
import { CHIP_HEIGHT, CHIP_RADIUS, chipMat } from './chips';
import { TextSprite } from './fingerchip';
import { money } from './game';
import type { Grabbable, Hand, Hands } from './hands';
import { CHIP_COLORS, chipLabel, type ChipDenom } from './textures';

/**
 * Your wallet, in the palm of your hand (VR). Turn your left hand palm up and
 * open, and a little round chip tray pops up just above it: one short stack
 * per denomination you can afford, your balance over the middle.
 *
 *  - Pinch / grab a stack with your other hand: a chip of it comes out into
 *    your hand. Keep your hand there and more come (like scooping from the rail).
 *  - Point at a stack (index finger out) to bet with that chip: it loads onto
 *    your fingertip when you point at a table.
 *  - Let go of chips over the tray, your palm or your wrist, or over your rail
 *    at a table: they go back in, with a clink and a "+$" over the tray.
 *  - Let go of them over a betting spot: that's the bet. Anywhere else they fall
 *    as real chips (still yours: tap them with an open hand to scoop them back).
 *
 * The money moves through the ChipLedger (rules/chipledger.ts), so it always
 * adds up: chips out of the tray are out of your balance until they come back
 * or go on a bet.
 *
 * Sitting in at a table that plays with table chips (poker: table stakes), the
 * tray deals from your stack there instead (`stack`): same gestures, the
 * balance over the middle is your stack, and chips let go of over your betting
 * line are your bet; anywhere else they simply go back to the stack (they
 * never left it: nothing moves in the wallet's books).
 */

/** Table chips the tray deals from instead of your wallet (poker: your stack, while you're sitting in). */
export interface TrayStack {
  /** What you could still push out (your stack less chips already out). */
  available(): number;
  /** Chips the table plays with (others show greyed). */
  allows(d: ChipDenom): boolean;
  /** Chips let go of at a point: true if they went out as your bet. */
  place(world: THREE.Vector3, amount: number): boolean;
}

export interface ChipTrayDeps {
  scene: THREE.Object3D;
  hands: Hands;
  sound: Sound;
  ledger: ChipLedger;
  denoms: readonly ChipDenom[];
  /** The chip you bet with (pointing at a stack picks it). */
  selected(): ChipDenom;
  select(d: ChipDenom): void;
  /** Your left palm, facing up and open (null: not). Centre of the palm, world. */
  palm(): THREE.Vector3 | null;
  /** Your left wrist (world), if tracked. */
  wrist(): THREE.Vector3 | null;
  /** Your head (world): the tray turns its front to you. */
  head(): THREE.Vector3;
  /** Chips let go of here, paid from your balance: a bet if this is a betting spot. True if it took. */
  placeAt(world: THREE.Vector3, amount: number): boolean;
  /** Over a table's rail (chips go back to the wallet there too). */
  overRail(world: THREE.Vector3): boolean;
  /** Chips let go of anywhere else: they fall as loose chips. Returns their ids and values, or null. */
  dropLoose(world: THREE.Vector3, v: THREE.Vector3, chips: ChipDenom[]): [string, number][] | null;
  haptic(side: 'left' | 'right', strength: number, ms: number): void;
  popups: ChipPopups;
  /** Table chips to deal from instead of the wallet (null: the wallet). */
  stack?(): TrayStack | null;
}

interface Carry {
  key: 'left' | 'right';
  chips: ChipDenom[];
  mesh: THREE.InstancedMesh;
  slot: number;
  lastAdd: number;
  /** Where the hand closed on the stack: keep it there and more chips come. */
  at: THREE.Vector3;
  /** From your table stack (poker), not the wallet: no money moved while carried. */
  fromStack: boolean;
}

/** One chip per grab; keep your hand at the stack and another comes every this many seconds. */
export const SCOOP_EVERY = 0.3;

const PLATE_R = 0.085;
const SLOT_R = 0.056;
const SHOW = 4;
const CARRY_MAX = 30;
const hex = (d: ChipDenom) => new THREE.Color(CHIP_COLORS[d][0]);
const chipGeo = new THREE.CylinderGeometry(CHIP_RADIUS, CHIP_RADIUS, CHIP_HEIGHT * 0.97, 16);

/** "+$25" floating up and fading, over where chips went home. */
export class ChipPopups {
  private live: { s: TextSprite; t: number; at: THREE.Vector3 }[] = [];
  private pool: TextSprite[] = [];

  constructor(private parent: THREE.Object3D) {}

  add(at: THREE.Vector3, text: string, color = '#ffe08a') {
    const s = this.pool.pop() ?? new TextSprite(0.024);
    s.set(text, color);
    s.sprite.visible = true;
    (s.sprite.material as THREE.SpriteMaterial).opacity = 1;
    this.parent.add(s.sprite);
    this.live.push({ s, t: 0, at: at.clone() });
  }

  update(dt: number) {
    // (Backwards, so finished ones come out as we go: no copy of the list every frame.)
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.t += dt;
      p.s.sprite.position.copy(p.at).y += 0.02 + p.t * 0.06;
      (p.s.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - Math.max(0, p.t - 0.6) / 0.6);
      if (p.t > 1.2) {
        p.s.sprite.visible = false;
        p.s.sprite.removeFromParent();
        this.live.splice(i, 1);
        this.pool.push(p.s);
      }
    }
  }

  get count() {
    return this.live.length;
  }
}

export class ChipTray {
  readonly group = new THREE.Group();
  readonly grabbables: Grabbable[] = [];
  private stacks: THREE.InstancedMesh;
  private face: { ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; key: string };
  private balance = new TextSprite(0.026, '#ffd98a');
  private carries = new Map<Hand, Carry>();
  private o = new THREE.Object3D();
  private shown = 0;
  private hideT = 0;
  private clock = 0;
  private pointed = new Map<string, number>();
  /** Shown above your palm right now. */
  open = false;
  /** Tests: show the tray at this point regardless of your palm. */
  force: THREE.Vector3 | null = null;

  constructor(private d: ChipTrayDeps) {
    const g = this.group;
    g.name = 'chip-tray';
    g.visible = false;
    g.userData.dynamic = true;
    g.userData.noLand = true;
    d.scene.add(g);
    // A round of green baize in a thin gold rim, with the denominations round the edge.
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.face = { ctx: c.getContext('2d')!, tex, key: '' };
    const plate = new THREE.Mesh(new THREE.CircleGeometry(PLATE_R, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false }));
    plate.raycast = () => {};
    plate.renderOrder = 2;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(PLATE_R, 0.0028, 6, 48).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 1, roughness: 0.3 }));
    rim.raycast = () => {};
    this.stacks = new THREE.InstancedMesh(chipGeo, chipMat(), d.denoms.length * SHOW);
    this.stacks.count = 0;
    this.stacks.frustumCulled = false;
    this.stacks.raycast = () => {};
    this.balance.sprite.position.set(0, 0.045, 0);
    g.add(plate, rim, this.stacks, this.balance.sprite);
    d.denoms.forEach((den, i) => this.grabbables.push(this.slotGrabbable(den, i)));
  }

  /** Where slot i sits on the tray (tray-local, on the baize). */
  private slotLocal(i: number, out = new THREE.Vector3()) {
    const n = this.d.denoms.length;
    // Round the ring like a clock (local +z is toward you): the smallest on your left, up over the far side.
    const a = Math.PI * (1 + 1 / n) - (i * 2 * Math.PI) / n;
    return out.set(Math.cos(a) * SLOT_R, 0, -Math.sin(a) * SLOT_R);
  }

  /** World point at the top of slot i's stack. */
  slotTop(i: number): THREE.Vector3 {
    const h = this.visibleCount(i) * CHIP_HEIGHT + 0.006;
    return this.group.localToWorld(this.slotLocal(i).setY(h));
  }

  /** The table stack the tray deals from right now (null: the wallet). */
  get stack(): TrayStack | null {
    return this.d.stack?.() ?? null;
  }

  /** What you could take out of the tray right now (wallet: spendable; at poker: your stack less chips in hand). */
  available(src = this.stack): number {
    if (!src) return this.d.ledger.spendable;
    let out = 0;
    for (const c of this.carries.values()) if (c.fromStack) out += this.amount(c);
    return Math.max(0, src.available() - out);
  }

  private canTake(den: ChipDenom, src = this.stack) {
    return (!src || src.allows(den)) && this.available(src) + 1e-9 >= den;
  }

  /** Take one chip out (from the wallet's books, or just count it out of your table stack). */
  private takeOne(key: 'left' | 'right', den: ChipDenom, fromStack: boolean): boolean {
    if (fromStack) return this.canTake(den);
    return this.d.ledger.take(key, den);
  }

  /** How many chips of slot i to draw (how many of it you could take, up to a short stack). */
  private visibleCount(i: number) {
    const d = this.d.denoms[i];
    const src = this.stack;
    if (src && !src.allows(d)) return 0;
    return Math.min(SHOW, Math.floor((this.available(src) + 1e-9) / d));
  }

  private slotGrabbable(den: ChipDenom, i: number): Grabbable {
    return {
      at: () => this.slotTop(i),
      // Measured from the pinch too (fingers on the chip, the palm a few cm back); the tray wins over a rail under it.
      radius: 0.045,
      pinch: true,
      priority: 2,
      enabled: () => this.open && this.canTake(den),
      grab: (hand) => {
        const key = hand.ctrl.userData.handedness as 'left' | 'right';
        // The hand the tray sits on can't reach into it.
        if (key !== 'right' && !this.force) return null;
        const fromStack = !!this.stack;
        if (!this.takeOne(key, den, fromStack)) {
          this.d.sound.play('denied', this.slotTop(i), { volume: 0.3 });
          return null;
        }
        const mesh = new THREE.InstancedMesh(chipGeo, chipMat(), CARRY_MAX);
        mesh.frustumCulled = false;
        mesh.raycast = () => {};
        mesh.userData.dynamic = true;
        this.d.scene.add(mesh);
        const c: Carry = { key, chips: [den], mesh, slot: i, lastAdd: this.clock, at: this.d.hands.reach(hand), fromStack };
        this.carries.set(hand, c);
        this.fill(c);
        mesh.position.copy(this.slotTop(i));
        this.d.sound.play('chip', this.slotTop(i), { volume: 0.5, rate: 1.1 });
        this.d.haptic(key, 0.35, 25);
        return 'drag';
      },
      drag: (hand, pos) => this.drag(hand, pos),
      release: (hand, pos) => this.release(hand, pos),
    };
  }

  private fill(c: Carry) {
    const m = c.mesh;
    m.count = Math.min(CARRY_MAX, c.chips.length);
    for (let k = 0; k < m.count; k++) {
      this.o.position.set(0, (k + 0.5) * CHIP_HEIGHT, 0);
      this.o.rotation.set(0, k * 1.3, 0);
      this.o.updateMatrix();
      m.setMatrixAt(k, this.o.matrix);
      m.setColorAt(k, hex(c.chips[k]));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  private amount(c: Carry) {
    return c.chips.reduce((s, d) => s + d, 0);
  }

  private drag(hand: Hand, pos: THREE.Vector3) {
    const c = this.carries.get(hand);
    if (!c) return;
    c.mesh.position.copy(pos).y -= 0.01;
    // Keep your hand where it took the chip: another one every third of a second, one at a time.
    const den = this.d.denoms[c.slot];
    const still = pos.distanceTo(c.at) < 0.04 || pos.distanceTo(this.slotTop(c.slot)) < 0.035;
    if (this.open && c.chips.length < CARRY_MAX && this.clock - c.lastAdd >= SCOOP_EVERY && still && (!c.fromStack || this.stack) && this.takeOne(c.key, den, c.fromStack)) {
      c.chips.push(den);
      c.lastAdd = this.clock;
      this.fill(c);
      this.d.sound.play('chip', pos, { volume: 0.35, rate: 1.15 + Math.min(0.3, c.chips.length * 0.02) });
      this.d.haptic(c.key, 0.2, 15);
    }
  }

  /** Is a point over your wallet: the tray, your left palm, your left wrist? */
  overWallet(p: THREE.Vector3): boolean {
    if (this.open && p.distanceTo(this.group.position) < PLATE_R + 0.06) return true;
    const palm = this.d.palm();
    if (palm && p.distanceTo(palm) < 0.11) return true;
    const w = this.d.wrist();
    return !!w && p.distanceTo(w) < 0.08;
  }

  /** Where the "+$" goes up: over the tray if it's open, else where the chips went. */
  private homeAt(p: THREE.Vector3) {
    return this.open ? this.group.position.clone().setY(this.group.position.y + 0.03) : p;
  }

  /** Chips came home: the clink and the "+$". */
  welcome(at: THREE.Vector3, amount: number, side?: 'left' | 'right') {
    if (!(amount > 0)) return;
    const p = this.homeAt(at);
    this.d.sound.play('chips', p, { volume: 0.6, rate: 1.05 });
    this.d.popups.add(p, `+${money(amount)}`);
    if (side) this.d.haptic(side, 0.4, 30);
    this.d.haptic('left', 0.25, 20);
  }

  private release(hand: Hand, pos: THREE.Vector3) {
    const c = this.carries.get(hand);
    if (!c) return;
    this.carries.delete(hand);
    const amount = this.amount(c);
    const done = () => c.mesh.removeFromParent();
    if (c.fromStack) {
      // Table chips: over your betting line they're your bet; anywhere else they go back to your stack.
      const src = this.stack;
      done();
      if (src && src.place(pos, amount)) this.d.haptic(c.key, 0.5, 35);
      else this.welcome(pos, amount, c.key);
      return;
    }
    // Home: over the wallet, or over your rail at a table.
    if (this.overWallet(pos) || this.d.overRail(pos)) {
      const back = this.d.ledger.returnHand(c.key, amount);
      done();
      this.welcome(pos, back, c.key);
      return;
    }
    // On a betting spot: the bet.
    if (this.d.ledger.betFromHand(c.key, amount, (a) => this.d.placeAt(pos, a))) {
      done();
      this.d.haptic(c.key, 0.5, 35);
      return;
    }
    // Anywhere else they fall, real chips (still yours).
    const v = this.d.hands.velocity(hand);
    const made = this.d.dropLoose(pos, v.length() > 1.2 ? v.multiplyScalar(1.1) : v.multiplyScalar(0.8), c.chips);
    if (made && this.d.ledger.drop(c.key, made)) {
      done();
      return;
    }
    // No room for more loose chips: they go home.
    this.welcome(pos, this.d.ledger.returnHand(c.key, amount), c.key);
    done();
  }

  /** Wallet chips in your hands from the tray (for the audit): their total. */
  get carried(): number {
    let s = 0;
    for (const c of this.carries.values()) if (!c.fromStack) s += this.amount(c);
    return s;
  }

  /** Table-stack chips in your hands (poker): counted out, not yet bet. */
  get carriedStack(): number {
    let s = 0;
    for (const c of this.carries.values()) if (c.fromStack) s += this.amount(c);
    return s;
  }

  /** Give back whatever is in hand (the tray is going away for good, or XR ended). */
  returnAll() {
    for (const [hand, c] of [...this.carries]) {
      this.carries.delete(hand);
      c.mesh.removeFromParent();
      if (!c.fromStack) this.d.ledger.returnHand(c.key, this.amount(c));
    }
  }

  /**
   * Per frame. `tips`: your index fingertips and whether each is pointing
   * (pointing at a stack picks that chip to bet with).
   */
  update(dt: number, tips: { side: 'left' | 'right'; tip: THREE.Vector3 | null; pointing: boolean }[]) {
    this.clock += dt;
    const palm = this.force ?? this.d.palm();
    // Palm up for a moment to open it; it stays a moment after you turn away (or while you hold its chips).
    if (palm) {
      this.shown += dt;
      this.hideT = 0;
    } else {
      this.hideT += dt;
      if (this.hideT > (this.carries.size ? 0.8 : 0.3)) this.shown = 0;
    }
    const was = this.open;
    this.open = this.shown > 0.12 || (!!this.force && !!palm);
    if (this.open && !was) {
      this.d.sound.playLocal?.('click', 0.15, 1.6);
      this.d.haptic('left', 0.15, 15);
    }
    this.group.visible = this.open;
    if (palm) {
      // Hover just above the palm, flat, its near edge toward you.
      const p = this.group.position;
      const want = palm.clone().setY(palm.y + 0.065);
      if (!was || p.distanceTo(want) > 0.3) p.copy(want);
      else p.lerp(want, 1 - Math.exp(-dt * 25));
      const head = this.d.head();
      this.group.rotation.set(0, Math.atan2(head.x - p.x, head.z - p.z), 0);
      // Pops up.
      const s = THREE.MathUtils.clamp((this.shown - 0.12) / 0.12, 0.2, 1);
      this.group.scale.setScalar(this.force ? 1 : 0.6 + 0.4 * s);
    }
    if (!this.open) return;
    this.group.updateMatrixWorld(true);
    // Point at a stack to bet with it.
    for (const f of tips) {
      if (!f.tip || !f.pointing || (f.side === 'left' && !this.force)) {
        this.pointed.delete(f.side);
        continue;
      }
      let best = -1,
        bd = 0.028;
      this.d.denoms.forEach((_, i) => {
        const dd = f.tip!.distanceTo(this.slotTop(i));
        if (dd < bd) {
          bd = dd;
          best = i;
        }
      });
      if (best >= 0 && this.pointed.get(f.side) !== best) {
        const den = this.d.denoms[best];
        this.d.select(den);
        this.d.sound.play('chip', this.slotTop(best), { volume: 0.4, rate: 1.3 });
        this.d.haptic(f.side, 0.3, 20);
      }
      if (best >= 0) this.pointed.set(f.side, best);
      else this.pointed.delete(f.side);
    }
    this.layout();
  }

  private layout() {
    const ds = this.d.denoms;
    let k = 0;
    const v = new THREE.Vector3();
    ds.forEach((den, i) => {
      const n = this.visibleCount(i);
      this.slotLocal(i, v);
      for (let j = 0; j < n; j++) {
        this.o.position.set(v.x, (j + 0.5) * CHIP_HEIGHT + 0.0005, v.z);
        this.o.rotation.set(0, i + j * 1.7, 0);
        this.o.updateMatrix();
        this.stacks.setMatrixAt(k, this.o.matrix);
        this.stacks.setColorAt(k, hex(den));
        k++;
      }
    });
    this.stacks.count = k;
    this.stacks.instanceMatrix.needsUpdate = true;
    if (this.stacks.instanceColor) this.stacks.instanceColor.needsUpdate = true;
    const src = this.stack;
    this.balance.set(src ? `Stack ${money(this.available(src))}` : money(this.d.ledger.spendable));
    this.drawFace();
  }

  private drawFace() {
    const ds = this.d.denoms;
    const sel = this.d.selected();
    const avail = ds.map((_, i) => this.visibleCount(i) > 0);
    const src = this.stack;
    const key = `${sel}|${avail.join('')}|${!!src}`;
    if (key === this.face.key) return;
    this.face.key = key;
    const g = this.face.ctx;
    const S = 512,
      R = S / 2;
    g.clearRect(0, 0, S, S);
    const grad = g.createRadialGradient(R, R, 20, R, R, R);
    grad.addColorStop(0, '#13492c');
    grad.addColorStop(1, '#0a2a19');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(R, R, R - 2, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(212,169,78,0.6)';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(R, R, R - 14, 0, Math.PI * 2);
    g.stroke();
    const v = new THREE.Vector3();
    const px = (m: number) => (m / PLATE_R) * R;
    ds.forEach((den, i) => {
      this.slotLocal(i, v);
      const x = R + px(v.x),
        y = R + px(v.z);
      // A pocket for the stack, gold-ringed if it's the chip you bet with.
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.beginPath();
      g.arc(x, y, px(CHIP_RADIUS) + 6, 0, Math.PI * 2);
      g.fill();
      if (den === sel) {
        g.strokeStyle = '#ffd98a';
        g.lineWidth = 8;
        g.stroke();
      }
      // Its value, toward the middle of the tray.
      const lx = R + px(v.x) * 0.48,
        ly = R + px(v.z) * 0.48 + 6;
      g.fillStyle = avail[i] ? (den === sel ? '#ffe08a' : '#f3e7c8') : 'rgba(243,231,200,0.3)';
      g.font = `600 ${den >= 1000 ? 30 : 34}px Georgia, serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(chipLabel(den), lx, ly);
    });
    this.face.tex.needsUpdate = true;
  }

  /** The chips a stack of `amount` breaks into (biggest first), for dropping loose. */
  static breakdown(amount: number, denoms: readonly ChipDenom[]): ChipDenom[] {
    const g = greedyBreakdown(amount, denoms);
    const out: ChipDenom[] = [];
    g.counts.forEach((n, i) => {
      for (let k = 0; k < n; k++) out.push(denoms[i]);
    });
    return out.sort((a, b) => b - a);
  }
}
