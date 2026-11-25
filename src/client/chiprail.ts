import * as THREE from 'three';
import { ChipWallet, greedyBreakdown } from '../rules/chiprack';
import type { Sound } from './audio';
import { CHIP_HEIGHT, CHIP_RADIUS, chipMat } from './chips';
import { money } from './game';
import type { Grabbable, Hand } from './hands';
import type { Interaction } from './interaction';
import { CHIP_COLORS, chipLabel, type ChipDenom } from './textures';

/**
 * Your chips, on the rail in front of you: real stacks that always add up to
 * what you can spend. Pick a chip up (hold your hand at the stack to scoop a
 * few more), set it down on a betting spot and it's a bet; let go anywhere
 * else and it goes back on the rail. Chips on a spot you're still allowed to
 * take down can be picked back up the same way.
 *
 * One draw call for every chip on the rail (an instanced mesh), one for the
 * count label, one per hand while you're holding chips.
 */

/** A bet of yours on the layout that you could pick back up. */
export interface RailSpot {
  /** World point at the top of the stack. */
  at: THREE.Vector3;
  /** Takes the bet down (through the game's own rules) and returns what came back, 0 if it can't come down. */
  take(): number;
}

export interface ChipRailOptions {
  /** The table's group: the rail is added to it, and you place it in that frame. */
  parent: THREE.Object3D;
  denoms: readonly ChipDenom[];
  sound: Sound;
  /** Your bankroll balance. */
  balance(): number;
  /** Money that's yours but not on the rail yet (payouts still on their way, chips beside a bet). */
  away?(): number;
  /** Show the rail (you're at this table). */
  visible(): boolean;
  /** Can chips be picked up now (betting is open)? */
  canGrab(): boolean;
  /** Chips let go of here: place them as a bet if this is a betting spot. True if they were bet. */
  place(world: THREE.Vector3, amount: number, denom: ChipDenom): boolean;
  /** While carrying: where the chips would go (null: not over the layout). */
  hover?(world: THREE.Vector3 | null, denom: ChipDenom): void;
  /** Your bets that can come back down. */
  spots?(): RailSpot[];
  /** Mouse / tap on a stack picks that chip size for click betting. */
  interaction?: Interaction;
  onPick?(d: ChipDenom): void;
  selected?(): number;
  /** Gap between stacks (m). */
  spacing?: number;
  /** Visible chips per stack. */
  cap?: number;
  /** A wooden tray under the stacks. */
  tray?: boolean;
}

interface Carry {
  denom: ChipDenom;
  chips: ChipDenom[];
  amount: number;
  mesh: THREE.InstancedMesh;
  /** Scooping: the rail stack this came from (index) and when the last chip was added. */
  stack: number;
  lastAdd: number;
}

interface Flying {
  mesh: THREE.InstancedMesh;
  amount: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
}

const SPOT_POOL = 10;
const CARRY_MAX = 20;
const geo = new THREE.CylinderGeometry(CHIP_RADIUS, CHIP_RADIUS, CHIP_HEIGHT * 0.97, 16);
const hex = (d: ChipDenom) => new THREE.Color(CHIP_COLORS[d][0]);

export class ChipRail {
  readonly group = new THREE.Group();
  readonly grabbables: Grabbable[] = [];
  readonly wallet: ChipWallet;
  private stacks: THREE.InstancedMesh;
  private label: { mesh: THREE.Mesh; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; key: string };
  private carries = new Map<Hand, Carry>();
  private flying: Flying[] = [];
  private pool: THREE.InstancedMesh[] = [];
  private spotCache: RailSpot[] = [];
  private clock = 0;
  private dirty = true;
  private o = new THREE.Object3D();
  readonly spacing: number;
  readonly cap: number;

  constructor(private opts: ChipRailOptions) {
    this.spacing = opts.spacing ?? 0.05;
    this.cap = opts.cap ?? 20;
    this.wallet = new ChipWallet(opts.denoms);
    const n = opts.denoms.length;
    const g = this.group;
    g.userData.dynamic = true;
    opts.parent.add(g);

    if (opts.tray) {
      const tray = new THREE.Mesh(new THREE.BoxGeometry(n * this.spacing + 0.03, 0.008, 0.06), new THREE.MeshStandardMaterial({ color: 0x2a1408, roughness: 0.4 }));
      tray.position.y = -0.004;
      tray.raycast = () => {};
      g.add(tray);
    }

    this.stacks = new THREE.InstancedMesh(geo, chipMat(), n * this.cap);
    for (let i = 0; i < n * this.cap; i++) this.stacks.setColorAt(i, hex(opts.denoms[Math.floor(i / this.cap)]));
    this.stacks.count = 0;
    this.stacks.frustumCulled = false;
    this.stacks.raycast = () => {};
    g.add(this.stacks);

    // Counts under each stack, and the total.
    const c = document.createElement('canvas');
    c.width = (n + 2) * 96;
    c.height = 48;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const lw = (n + 2) * this.spacing;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(lw, lw / ((n + 2) * 2)), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    mesh.rotation.x = -Math.PI / 2 + 0.5;
    mesh.position.set(this.spacing / 2, 0.002, 0.04);
    mesh.raycast = () => {};
    g.add(mesh);
    this.label = { mesh, ctx: c.getContext('2d')!, tex, key: '' };

    opts.denoms.forEach((d, i) => this.grabbables.push(this.stackGrabbable(d, i)));
    if (opts.spots) for (let i = 0; i < SPOT_POOL; i++) this.grabbables.push(this.spotGrabbable(i));

    if (opts.interaction && opts.onPick) {
      const hit = new THREE.Mesh(new THREE.BoxGeometry(n * this.spacing, 0.06, 0.07), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.y = 0.03;
      // Only while the rail is shown (a parent may be an interactable too).
      hit.raycast = (r, out) => {
        if (g.visible) THREE.Mesh.prototype.raycast.call(hit, r, out);
      };
      g.add(hit);
      const which = (x: number) => opts.denoms[THREE.MathUtils.clamp(Math.round(x / this.spacing + (n - 1) / 2), 0, n - 1)];
      opts.interaction.register({
        object: hit,
        kind: 'surface',
        enabled: () => g.visible,
        label: (e) => `Bet ${money(which(e.local.x))} chips`,
        onSelect: (e) => {
          const d = which(e.local.x);
          opts.onPick!(d);
          this.dirty = true;
          opts.sound.play('chip', this.stackTop(opts.denoms.indexOf(d)), { volume: 0.4, rate: 1.2 });
        },
      });
    }
  }

  /** Money in your hands or flying back to the rail. */
  get held(): number {
    let s = 0;
    for (const c of this.carries.values()) s += c.amount;
    for (const f of this.flying) s += f.amount;
    return s;
  }

  /** What the rail should show: what you can spend right now. */
  get onRail(): number {
    return Math.max(0, this.opts.balance() - (this.opts.away?.() ?? 0) - this.held);
  }

  private stackX(i: number) {
    return (i - (this.opts.denoms.length - 1) / 2) * this.spacing;
  }

  /** World point at the top of stack i. */
  private stackTop(i: number): THREE.Vector3 {
    const h = Math.min(this.wallet.counts[i] ?? 0, this.cap) * CHIP_HEIGHT;
    return this.group.localToWorld(new THREE.Vector3(this.stackX(i), h + 0.008, 0));
  }

  private buzz(hand: Hand, s: number, ms: number) {
    const gp = hand.ctrl.userData.gamepad as (Gamepad & { hapticActuators?: { pulse(v: number, ms: number): void }[] }) | undefined;
    gp?.hapticActuators?.[0]?.pulse(s, ms);
  }

  private meshFor(): THREE.InstancedMesh {
    const busy = new Set([...[...this.carries.values()].map((c) => c.mesh), ...this.flying.map((f) => f.mesh)]);
    let m = this.pool.find((p) => !busy.has(p));
    if (!m) {
      m = new THREE.InstancedMesh(geo, chipMat(), CARRY_MAX);
      m.frustumCulled = false;
      m.raycast = () => {};
      m.userData.dynamic = true;
      this.pool.push(m);
    }
    m.count = 0;
    this.opts.parent.add(m);
    return m;
  }

  private fill(m: THREE.InstancedMesh, chips: ChipDenom[]) {
    m.count = Math.min(CARRY_MAX, chips.length);
    for (let k = 0; k < m.count; k++) {
      this.o.position.set(0, (k + 0.5) * CHIP_HEIGHT, 0);
      this.o.rotation.set(0, k * 1.3, 0);
      this.o.updateMatrix();
      m.setMatrixAt(k, this.o.matrix);
      m.setColorAt(k, hex(chips[k]));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  private startCarry(hand: Hand, chips: ChipDenom[], amount: number, stack: number) {
    const mesh = this.meshFor();
    this.fill(mesh, chips);
    this.carries.set(hand, { denom: chips[0], chips, amount, mesh, stack, lastAdd: this.clock });
    this.dirty = true;
    this.buzz(hand, 0.35, 25);
  }

  private stackGrabbable(d: ChipDenom, i: number): Grabbable {
    return {
      at: () => this.stackTop(i),
      // Hands measure from the palm, a few cm behind the pinch: nearest stack wins.
      radius: 0.075,
      enabled: () => this.group.visible && this.opts.canGrab() && this.wallet.counts[i] > 0,
      grab: (hand) => {
        if (!this.wallet.take(d)) {
          this.opts.sound.play('denied', this.stackTop(i), { volume: 0.4 });
          return null;
        }
        this.startCarry(hand, [d], d, i);
        this.opts.sound.play('chip', this.stackTop(i), { volume: 0.5 });
        return 'drag';
      },
      drag: (hand, pos) => this.drag(hand, pos),
      release: (hand, pos) => this.release(hand, pos),
    };
  }

  private spotGrabbable(i: number): Grabbable {
    return {
      at: () => this.spotCache[i]?.at ?? new THREE.Vector3(0, -1e6, 0),
      radius: 0.07,
      enabled: () => this.group.visible && this.opts.canGrab() && i < this.spotCache.length,
      grab: (hand) => {
        const spot = this.spotCache[i];
        if (!spot) return null;
        const back = spot.take();
        if (back <= 0) {
          this.opts.sound.play('denied', spot.at, { volume: 0.4 });
          return null;
        }
        const g = greedyBreakdown(back, this.opts.denoms);
        const chips: ChipDenom[] = [];
        for (let k = g.counts.length - 1; k >= 0; k--) for (let j = 0; j < g.counts[k]; j++) chips.push(this.opts.denoms[k]);
        // Big chips at the bottom, as a dealer would stack them.
        chips.sort((a, b) => b - a);
        this.startCarry(hand, chips.length ? chips : [this.opts.denoms[0]], back, -1);
        this.opts.sound.play('chips', spot.at, { volume: 0.5 });
        this.refreshSpots();
        return 'drag';
      },
      drag: (hand, pos) => this.drag(hand, pos),
      release: (hand, pos) => this.release(hand, pos),
    };
  }

  private drag(hand: Hand, pos: THREE.Vector3) {
    const c = this.carries.get(hand);
    if (!c) return;
    c.mesh.position.copy(this.opts.parent.worldToLocal(pos.clone())).y -= 0.01;
    // Hold your hand at the stack you took from to scoop a few more.
    if (c.stack >= 0 && c.chips.length < CARRY_MAX && this.clock - c.lastAdd > 0.3 && pos.distanceTo(this.stackTop(c.stack)) < 0.07) {
      if (this.wallet.take(c.denom)) {
        c.chips.push(c.denom);
        c.amount += c.denom;
        c.lastAdd = this.clock;
        this.fill(c.mesh, c.chips);
        this.dirty = true;
        this.buzz(hand, 0.2, 15);
        this.opts.sound.play('chip', pos, { volume: 0.3, rate: 1.1 });
      }
    }
    this.opts.hover?.(pos, c.denom);
  }

  private release(hand: Hand, pos: THREE.Vector3) {
    const c = this.carries.get(hand);
    if (!c) return;
    this.opts.hover?.(null, c.denom);
    // Placing debits the bankroll as the chips leave the hand: the rail's total doesn't move.
    const placed = this.opts.canGrab() && this.opts.place(pos, c.amount, c.denom);
    this.carries.delete(hand);
    if (placed) {
      c.mesh.removeFromParent();
      this.buzz(hand, 0.45, 35);
    } else {
      // Back to the rail (they count as yours, in flight, until they land).
      const i = c.stack >= 0 ? c.stack : this.opts.denoms.indexOf(c.denom);
      const to = this.opts.parent.worldToLocal(this.stackTop(Math.max(0, i)));
      this.flying.push({ mesh: c.mesh, amount: c.amount, from: c.mesh.position.clone(), to, t: 0 });
    }
    this.dirty = true;
    this.refreshSpots();
  }

  private refreshSpots() {
    const all = this.opts.spots?.() ?? [];
    const me = this.group.getWorldPosition(new THREE.Vector3());
    this.spotCache = all.sort((a, b) => a.at.distanceTo(me) - b.at.distanceTo(me)).slice(0, SPOT_POOL);
  }

  update(dt: number) {
    this.clock += dt;
    const show = this.opts.visible();
    this.group.visible = show;
    for (const f of [...this.flying]) {
      f.t = Math.min(1, f.t + dt / 0.3);
      f.mesh.position.lerpVectors(f.from, f.to, f.t);
      f.mesh.position.y += Math.sin(f.t * Math.PI) * 0.04;
      if (f.t >= 1) {
        f.mesh.removeFromParent();
        this.flying.splice(this.flying.indexOf(f), 1);
        this.dirty = true;
        this.opts.sound.play('chip', this.opts.parent.localToWorld(f.to.clone()), { volume: 0.3, rate: 0.85 });
      }
    }
    if (!show) {
      // Away from the table: nothing in hand from here.
      return;
    }
    this.refreshSpots();
    if (this.wallet.sync(this.onRail)) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    this.layout();
  }

  private layout() {
    const ds = this.opts.denoms;
    let k = 0;
    ds.forEach((d, i) => {
      const n = Math.min(this.wallet.counts[i], this.cap);
      for (let j = 0; j < n; j++) {
        // A little messy, like real stacks (but steady from frame to frame).
        const h = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
        const r = h - Math.floor(h);
        this.o.position.set(this.stackX(i) + (r - 0.5) * 0.0016, (j + 0.5) * CHIP_HEIGHT, (((r * 7) % 1) - 0.5) * 0.0016);
        this.o.rotation.set(0, r * 6.28, 0);
        this.o.updateMatrix();
        this.stacks.setMatrixAt(k, this.o.matrix);
        this.stacks.setColorAt(k, hex(d));
        k++;
      }
    });
    this.stacks.count = k;
    this.stacks.instanceMatrix.needsUpdate = true;
    if (this.stacks.instanceColor) this.stacks.instanceColor.needsUpdate = true;
    this.drawLabel();
  }

  private drawLabel() {
    const ds = this.opts.denoms;
    const sel = this.opts.selected?.();
    const total = this.wallet.total;
    const key = `${this.wallet.counts.join(',')}|${sel}|${total}`;
    if (key === this.label.key) return;
    this.label.key = key;
    const g = this.label.ctx;
    const W = g.canvas.width,
      H = g.canvas.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(14,10,7,0.72)';
    g.beginPath();
    g.roundRect(2, 2, W - 4, H - 4, 12);
    g.fill();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    ds.forEach((d, i) => {
      const x = (i + 0.5) * 96;
      const n = this.wallet.counts[i];
      g.fillStyle = n > 0 ? CHIP_COLORS[d][0] : '#5a5048';
      g.beginPath();
      g.arc(x - 26, H / 2, 9, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = n > 0 ? '#f3e7c8' : '#7a6d5e';
      g.font = `600 24px Georgia, serif`;
      g.fillText(n > 0 ? `×${n}` : chipLabel(d), x + 10, H / 2 + 1);
      if (sel === d) {
        g.strokeStyle = '#ffd98a';
        g.lineWidth = 3;
        g.strokeRect(x - 44, 6, 88, H - 12);
      }
    });
    g.fillStyle = '#ffd98a';
    g.font = `600 26px Georgia, serif`;
    g.fillText(money(total), (ds.length + 1) * 96, H / 2 + 1);
    this.label.tex.needsUpdate = true;
  }
}
