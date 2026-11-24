import * as THREE from 'three';
import { makeChipStack, CHIP_HEIGHT, CHIP_RADIUS } from '../chips';
import { easeInOut, Tweens } from '../game';
import type { FriendBetResult } from './mirrorCodec';

const ringGeo = new THREE.RingGeometry(CHIP_RADIUS + 0.0015, CHIP_RADIUS + 0.0045, 28).rotateX(-Math.PI / 2);
const buttonGeo = new THREE.CylinderGeometry(0.0085, 0.0085, 0.0035, 18);
const mats = new Map<number, { ring: THREE.Material; button: THREE.Material }>();

function markerMats(color: number) {
  let m = mats.get(color);
  if (!m) {
    const c = new THREE.Color(color);
    m = {
      ring: new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9, depthWrite: false }),
      button: new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.6, roughness: 0.35 }),
    };
    mats.set(color, m);
  }
  return m;
}

/**
 * Your friend's chips on a shared table: ordinary chip stacks set a little off
 * each spot, each ringed in their colour with a matching marker button on top
 * so you can tell them from yours. Purely visual: nothing here touches a
 * bankroll or the table's own game.
 */
export class FriendChips {
  private stacks = new Map<string, THREE.Group>();
  private tweens = new Tweens();
  /** Where your friend is (world), so their winnings slide their way. */
  owner: THREE.Vector3 | null = null;
  /** A chip clicks down (sound hook). */
  onPlace: ((at: THREE.Object3D) => void) | null = null;

  constructor(
    private group: THREE.Group,
    private anchor: (id: string) => THREE.Vector3 | null,
    private dealer: THREE.Vector3,
    private offset: THREE.Vector3,
    private color: number,
    private shadows: boolean,
  ) {}

  /** What's shown on the felt now (spot → amount). */
  get bets(): Map<string, number> {
    const m = new Map<string, number>();
    for (const [id, s] of this.stacks) m.set(id, s.userData.amount as number);
    return m;
  }

  get count() {
    return this.stacks.size;
  }

  /** Positions of the stacks (table-local), for tests and debugging. */
  positions(): Record<string, { x: number; y: number; z: number; amount: number }> {
    const o: Record<string, { x: number; y: number; z: number; amount: number }> = {};
    for (const [id, s] of this.stacks) o[id] = { x: s.position.x, y: s.position.y, z: s.position.z, amount: s.userData.amount };
    return o;
  }

  /** Make the felt show exactly this layout (new chips drop in, removed ones lift away). */
  set(bets: ReadonlyMap<string, number>) {
    for (const [id, s] of [...this.stacks]) {
      if (bets.has(id)) continue;
      this.stacks.delete(id);
      this.liftAway(s);
    }
    let placed = false;
    for (const [id, amount] of bets) {
      const cur = this.stacks.get(id);
      if (cur && cur.userData.amount === amount) continue;
      if (cur) this.group.remove(cur);
      const s = this.make(id, amount);
      if (!s) continue;
      this.stacks.set(id, s);
      if (!cur || amount > cur.userData.amount) {
        const y = s.position.y;
        this.tweens.add(0.2, (k) => (s.position.y = y + (1 - k) ** 2 * 0.06));
        if (!placed) this.onPlace?.(s);
        placed = true;
      }
    }
  }

  /** The dealer settles a spin or roll: losers swept, winners paid beside the stack, then gone. */
  resolve(results: FriendBetResult[]) {
    let delay = 0.5;
    for (const r of results) {
      const s = this.stacks.get(r.id);
      if (!s) continue;
      const from = s.position.clone();
      if (r.outcome === 'lose') {
        this.stacks.delete(r.id);
        this.later(delay * 0.5, () =>
          this.tweens.add(0.85, (k) => {
            const e = easeInOut(k);
            s.position.lerpVectors(from, this.dealer, e);
            s.scale.setScalar(1 - e * 0.6);
          }, () => this.group.remove(s)),
        );
      } else if (r.outcome === 'move' && r.to) {
        this.stacks.delete(r.id);
        const to = this.spotPos(r.to);
        this.later(delay * 0.5, () =>
          this.tweens.add(0.7, (k) => {
            if (to) s.position.lerpVectors(from, to, easeInOut(k));
            s.position.y += Math.sin(k * Math.PI) * 0.03;
          }, () => {
            this.group.remove(s);
            const amount = (this.stacks.get(r.to!)?.userData.amount ?? 0) + r.stake;
            const old = this.stacks.get(r.to!);
            if (old) this.group.remove(old);
            const n = this.make(r.to!, amount);
            if (n) this.stacks.set(r.to!, n);
          }),
        );
      } else if (r.outcome === 'win') {
        const pay = r.won > 0 ? this.decorate(makeChipStack(r.won), r.won) : null;
        if (pay) {
          pay.position.copy(from).add(new THREE.Vector3(0.042, 0, 0.012));
          pay.visible = false;
          this.group.add(pay);
        }
        const comesDown = !r.staysUp;
        if (comesDown) this.stacks.delete(r.id);
        const d = delay;
        this.later(d, () => {
          if (pay) {
            pay.visible = true;
            this.onPlace?.(pay);
          }
        });
        this.later(d + 1.4, () => {
          const items = [pay, comesDown ? s : null].filter(Boolean) as THREE.Group[];
          const starts = items.map((o) => o.position.clone());
          const ends = starts.map((p) => this.towardOwner(p));
          this.tweens.add(1.0, (k) => {
            const e = easeInOut(k);
            items.forEach((o, i) => {
              o.position.lerpVectors(starts[i], ends[i], e);
              o.scale.setScalar(1 - e * 0.5);
            });
          }, () => items.forEach((o) => this.group.remove(o)));
        });
        delay += 0.25;
      }
      // Pushes stay where they are.
    }
  }

  clear() {
    for (const s of this.stacks.values()) this.liftAway(s);
    this.stacks.clear();
  }

  dispose() {
    for (const s of this.stacks.values()) this.group.remove(s);
    this.stacks.clear();
  }

  update(dt: number) {
    this.tweens.update(dt);
  }

  private spotPos(id: string): THREE.Vector3 | null {
    const a = this.anchor(id);
    return a ? a.clone().add(this.offset) : null;
  }

  private make(id: string, amount: number): THREE.Group | null {
    const at = this.spotPos(id);
    if (!at || !(amount > 0)) return null;
    const s = this.decorate(makeChipStack(amount), amount);
    s.position.copy(at);
    this.group.add(s);
    return s;
  }

  /** Wrap a chip stack with your friend's colour: a ring on the felt and a marker on top. */
  private decorate(stack: THREE.Group, amount: number): THREE.Group {
    const g = new THREE.Group();
    const m = markerMats(this.color);
    stack.traverse((o) => (o.castShadow = this.shadows));
    g.add(stack);
    const ring = new THREE.Mesh(ringGeo, m.ring);
    ring.position.y = 0.0006;
    ring.renderOrder = 2;
    const button = new THREE.Mesh(buttonGeo, m.button);
    button.position.y = stack.children.length * CHIP_HEIGHT + 0.0018;
    for (const o of [ring, button]) o.raycast = () => {};
    g.add(ring, button);
    g.userData.amount = amount;
    g.userData.friend = true;
    return g;
  }

  private liftAway(s: THREE.Group) {
    const from = s.position.clone();
    this.tweens.add(0.35, (k) => {
      s.position.y = from.y + k * 0.05;
      s.scale.setScalar(Math.max(0.01, 1 - k));
    }, () => this.group.remove(s));
  }

  /** A point on the felt toward your friend (or toward the near rail if unknown). */
  private towardOwner(p: THREE.Vector3): THREE.Vector3 {
    const dir = this.owner ? this.group.worldToLocal(this.owner.clone()).sub(p).setY(0) : new THREE.Vector3(0, 0, 1);
    const len = Math.min(0.45, dir.length());
    if (dir.lengthSq() < 1e-6) return p.clone();
    return p.clone().addScaledVector(dir.normalize(), len);
  }

  private later(s: number, fn: () => void) {
    this.tweens.add(Math.max(0.001, s), () => {}, fn);
  }
}
