import * as THREE from 'three';
import { DRINKS } from './bar';
import type { Grabbable, Hand, Hands } from './hands';
import type { Interaction } from './interaction';
import type { Item, LooseObjects } from './loose';
import type { Drink, Lounge } from './lounge';
import type { Crowd, Person } from './people';

/**
 * Food and drink on show, all of it takeable: slices of pie on the pizza
 * pass, burgers and noodle boxes on the counters, the gelato case's tubs, the
 * patties on the grill, the diners' plates and sodas, the back bar's shelves
 * of bottles, the pool bar's lit column, the drinks in guests' hands.
 *
 * Cheap on draw calls: what's on show is drawn instanced (one draw per kind
 * of thing, wherever its copies stand) and has no physics. The moment you
 * reach for one (VR: close your hand on it; or point at it and pull the
 * trigger when it's out of reach; desktop: click it) it's promoted: the copy
 * on show disappears and a real one, a loose thing (loose.ts: bite it, swig
 * and pour it, throw it) or a glass (lounge.ts: sip, pour, mix, clink, smash),
 * is in your hand in its place. A while later the kitchen (or the bartender)
 * sets out a fresh one. Some never run out: the gelato tubs and the grill
 * hand you a cone or a burger every time.
 *
 * Only so many promoted things lie about at once: past the cap, the oldest
 * one left lying somewhere is cleared away (a busboy), so the physics and the
 * draw calls stay inside the Quest budget however much you take.
 *
 * Friends see it all: what you take leaves the display on their side too
 * (loose 'spawn' / drink 'spawn' events carry where it came from) and is in
 * your hand there.
 */

/** What reaching for it gives you: a loose thing by kind key, or a glass of a drink (bar.ts) by name. */
export type Give = { loose: string; color?: number; liquid?: number; name?: string; bites?: number } | { drink: string; level: number };

export interface SlotSpec {
  /** Unique, the same on every machine (it names the display to your friends). */
  id: string;
  /** Where it stands: its base, turned (world). The drawn copy uses this matrix. */
  m: THREE.Matrix4;
  /** Tint of the drawn copy (a bottle's glass, a cup's paper). */
  color?: number;
  give: Give;
  /** Seconds until a fresh one is set out (0: never runs out; nothing drawn disappears). */
  restock: number;
  /** How close a hand has to come (VR), metres. */
  reach?: number;
  /** What a click (or a point) says. */
  label: string;
  /** Whose it is (a diner's plate): they notice when you take it. */
  owner?: () => Person | null;
}

interface Slot extends SlotSpec {
  shelf: Shelf;
  index: number;
  /** The middle of it, where a hand reaches (world). */
  at: THREE.Vector3;
  takenAt: number | null;
}

interface Shelf {
  id: string;
  mesh: THREE.InstancedMesh | null;
  slots: Slot[];
}

/** A promoted thing of yours still in the world (counted against the cap). */
type Live = { it: Item; drink?: undefined } | { drink: Drink; it?: undefined };

export interface StockDeps {
  hands: Hands;
  interaction: Interaction;
  loose: LooseObjects;
  lounge: Lounge;
  crowd: Crowd;
  inXR: () => boolean;
  /** Where you're standing (feet). */
  feet: () => THREE.Vector3;
  sound: { play(name: 'clink' | 'thunk', at: THREE.Vector3, opts?: { volume?: number; rate?: number }): unknown };
  /** You took something of theirs (a diner's plate, the drink in a guest's hand): they react. */
  onSnatch?: (p: Person) => void;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

/** The yaw a matrix is turned by. */
function yawOf(m: THREE.Matrix4) {
  const q = new THREE.Quaternion();
  m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
  return new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
}

export class Stock {
  /** At most this many promoted loose things of yours lying about (the oldest resting one is cleared). */
  static readonly MAX_LOOSE = 16;
  /** ...and this many promoted glasses (each costs a few draws). */
  static readonly MAX_DRINKS = 6;
  /** A guest whose drink you took gets another after this long. */
  static readonly NPC_REFILL_S = 90;

  readonly shelves: Shelf[] = [];
  private byId = new Map<string, Slot>();
  private live: Live[] = [];
  private time = 0;
  private tick = 0;
  private n = 0;
  /** Makes the ids of things taken here unique in the room. */
  private readonly tag = Math.random().toString(36).slice(2, 6);
  /** A hand that closed on a display: the real thing's grab handle (its drag and release go there). */
  private delegates = new Map<Hand, Grabbable>();
  /** Guests whose drink you (or a friend) took, and when. */
  private snatched = new Map<Person, number>();
  /** Guests' drinks within reach this frame (VR), where they are. */
  private npcAt = new Map<Person, THREE.Vector3>();
  private npcGrabs = new Map<Person, Grabbable>();
  /** Counters for tests and tuning. */
  readonly stats = { taken: 0, restocked: 0, cleared: 0, snatched: 0 };

  constructor(private d: StockDeps) {
    d.loose.onSpawnFrom = (from) => this.remoteTook(from);
    d.lounge.onSpawnFrom = (from) => this.remoteTook(from);
    // Guests' drinks: click one (or point at it and pull the trigger) to take it.
    const g = d.crowd.glasses;
    g.userData.noLand = true;
    d.interaction.register({
      object: g,
      kind: 'button',
      enabled: () => this.handFree(),
      label: (e) => {
        const p = e.hit.instanceId !== undefined ? d.crowd.glassOwners[e.hit.instanceId] : undefined;
        return p && this.snatchable(p) ? 'Take their drink' : null;
      },
      onSelect: (e) => {
        const p = e.hit.instanceId !== undefined ? d.crowd.glassOwners[e.hit.instanceId] : undefined;
        if (p && this.snatchable(p)) this.snatch(p, null);
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Displays
  // ---------------------------------------------------------------------------

  /**
   * Food or drink on show. `draw`: drawn here, instanced (shared geometry and
   * material; tinted per slot when `tinted`), or nothing (it's already part of
   * the scenery: a tub in the gelato case; reach in and take a portion).
   * `lift`: from a slot's base up to its middle (where a hand reaches).
   */
  addShelf(id: string, parent: THREE.Object3D, draw: { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[]; tinted?: boolean } | null, specs: SlotSpec[], lift = 0.04): Shelf {
    let mesh: THREE.InstancedMesh | null = null;
    if (draw && specs.length) {
      mesh = new THREE.InstancedMesh(draw.geo, draw.mat, specs.length);
      if (draw.tinted) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(specs.length * 3).fill(1), 3);
      specs.forEach((s, i) => {
        mesh!.setMatrixAt(i, s.m);
        if (draw.tinted) mesh!.setColorAt(i, new THREE.Color(s.color ?? 0xffffff));
      });
      mesh.name = `stock-${id}`;
      mesh.castShadow = false;
      mesh.computeBoundingSphere();
      parent.add(mesh);
    }
    return this.shelf(id, mesh, specs, lift, parent);
  }

  /** An instanced mesh that's already in the scene (the back bar's bottles): instance i is `specs[i]`. */
  adopt(id: string, mesh: THREE.InstancedMesh, specs: SlotSpec[], lift = 0.12): Shelf {
    return this.shelf(id, mesh, specs, lift, mesh.parent ?? mesh);
  }

  private shelf(id: string, mesh: THREE.InstancedMesh | null, specs: SlotSpec[], lift: number, parent: THREE.Object3D): Shelf {
    const shelf: Shelf = { id, mesh, slots: [] };
    for (const [index, sp] of specs.entries()) {
      const at = new THREE.Vector3().setFromMatrixPosition(sp.m).addScaledVector(UP, lift);
      const slot: Slot = { ...sp, shelf, index, at, takenAt: null };
      shelf.slots.push(slot);
      this.byId.set(sp.id, slot);
      this.d.hands.register(this.slotGrab(slot));
    }
    const label = (s: Slot | undefined) => (s && this.available(s) ? s.label : null);
    if (mesh) {
      mesh.userData.noLand = true;
      mesh.userData.dynamic = true;
      this.d.interaction.register({
        object: mesh,
        kind: 'button',
        enabled: () => this.handFree(),
        label: (e) => label(e.hit.instanceId !== undefined ? shelf.slots[e.hit.instanceId] : undefined),
        onSelect: (e) => {
          const s = e.hit.instanceId !== undefined ? shelf.slots[e.hit.instanceId] : undefined;
          if (s && this.available(s)) this.take(s, e.source === 'xr' ? 'point' : 'desk');
        },
      });
    } else {
      // Nothing drawn (it's part of the scenery): an invisible box round each spot to click or point at.
      const hitMat = new THREE.MeshBasicMaterial({ visible: false });
      for (const s of shelf.slots) {
        const r = s.reach ?? 0.1;
        const box = new THREE.Mesh(new THREE.BoxGeometry(r * 1.6, r, r * 1.4), hitMat);
        box.position.copy(s.at);
        box.name = `stock-${s.id}`;
        box.userData.noLand = true;
        parent.add(box);
        this.d.interaction.register({ object: box, kind: 'button', enabled: () => this.handFree(), label: () => label(s), onSelect: (e) => this.available(s) && this.take(s, e.source === 'xr' ? 'point' : 'desk') });
      }
    }
    this.shelves.push(shelf);
    return shelf;
  }

  /** Still there to take? */
  private available(s: Slot) {
    return s.takenAt === null;
  }

  /** A hand free for it: VR, either hand; desktop, nothing in your hand. */
  private handFree() {
    if (this.d.inXR()) return this.d.hands.hands.some((h) => !h.held && h.ctrl.userData.connected !== false);
    return !this.d.loose.holding && !this.d.lounge.handsFull;
  }

  /** VR: close your hand on it and you're holding the real thing. */
  private slotGrab(s: Slot): Grabbable {
    return {
      at: () => s.at,
      radius: s.reach ?? 0.09,
      enabled: () => this.available(s) && this.d.inXR(),
      grab: (hand) => {
        const r = this.promote(s, new THREE.Vector3().setFromMatrixPosition(s.m));
        if (!r) return null;
        this.delegates.set(hand, r);
        return r.grab(hand);
      },
      drag: (hand, pos) => this.delegates.get(hand)?.drag?.(hand, pos),
      release: (hand, pos, carried) => {
        const g = this.delegates.get(hand);
        this.delegates.delete(hand);
        g?.release?.(hand, pos, carried);
      },
    };
  }

  /**
   * Takes one off the display: 'desk' into your desktop hand, 'point' (VR,
   * out of reach) to a free hand. True if you've got it.
   */
  take(s: Slot, how: 'desk' | 'point'): boolean {
    if (!this.available(s)) return false;
    if (how === 'point') {
      const hand = this.d.hands.hands.find((h) => !h.held && h.ctrl.userData.connected !== false);
      if (!hand) return false;
      const at = hand.grip.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.04, 0));
      const g = this.promote(s, at);
      return !!g && this.d.hands.grabWith(hand, g);
    }
    const g = this.promote(s, new THREE.Vector3().setFromMatrixPosition(s.m));
    if (!g) return false;
    return this.toDesk(g);
  }

  /** The thing just promoted, into your desktop hand. */
  private toDesk(g: Grabbable & { obj?: Item | Drink }): boolean {
    const o = g.obj;
    if (!o) return false;
    if ('kind' in o && 'body' in o) {
      this.d.loose.pickUpDesk(o);
      return this.d.loose.holding;
    }
    return this.d.lounge.handOver(o as Drink, g);
  }

  /**
   * The real thing, where the copy on show stood (or at a hand): a loose
   * thing or a glass, registered to grab. The copy disappears until restocked.
   */
  private promote(s: Slot, at: THREE.Vector3): (Grabbable & { obj?: Item | Drink }) | null {
    const yaw = yawOf(s.m);
    let out: (Grabbable & { obj?: Item | Drink }) | null = null;
    if ('loose' in s.give) {
      const gv = s.give;
      const it = this.d.loose.spawnLive(gv.loose, at.x, at.z, at.y, { at, yaw, color: gv.color, liquid: gv.liquid, name: gv.name, bites: gv.bites, from: s.id });
      const g = it && this.d.loose.grabbableOf(it);
      if (!it || !g) return null;
      this.live.push({ it });
      out = Object.assign(Object.create(null), g, { obj: it }) as Grabbable & { obj: Item };
    } else {
      const name = s.give.drink;
      const kind = DRINKS.find((k) => k.name === name);
      if (!kind) return null;
      const { drink, grab } = this.d.lounge.spawnDrink(kind, at, `${s.id}~${this.tag}${(++this.n).toString(36)}`, s.give.level, s.id);
      drink.group.rotation.y = yaw;
      this.live.push({ drink });
      this.d.sound.play('clink', at, { volume: 0.25, rate: 1.3 });
      out = Object.assign(Object.create(null), grab, { obj: drink }) as Grabbable & { obj: Drink };
    }
    this.stats.taken++;
    if (s.restock > 0) this.hide(s);
    const owner = s.owner?.();
    if (owner && !owner.culled) this.d.onSnatch?.(owner);
    this.capLive();
    return out;
  }

  private hide(s: Slot) {
    s.takenAt = this.time;
    const m = s.shelf.mesh;
    if (!m) return;
    m.setMatrixAt(s.index, ZERO);
    m.instanceMatrix.needsUpdate = true;
  }

  private show(s: Slot) {
    s.takenAt = null;
    this.stats.restocked++;
    const m = s.shelf.mesh;
    if (!m) return;
    m.setMatrixAt(s.index, s.m);
    m.instanceMatrix.needsUpdate = true;
  }

  /** A friend took it (their loose or drink 'spawn' named it): it leaves the display here too. */
  private remoteTook(from: string) {
    const s = this.byId.get(from);
    if (s) {
      if (s.restock > 0 && this.available(s)) this.hide(s);
      return;
    }
    const m = /^npc:(\d+)$/.exec(from);
    const p = m ? this.d.crowd.people[Number(m[1])] : undefined;
    if (p && p.prop === 'glass' && !p.driven) {
      p.prop = 'none';
      this.snatched.set(p, this.time);
    }
  }

  /** Past the cap: the oldest promoted thing of yours left lying about is cleared away. */
  private capLive() {
    this.live = this.live.filter((l) => (l.it ? !l.it.gone : !!l.drink!.group.parent));
    const clear = (want: 'it' | 'drink', max: number) => {
      let n = this.live.filter((l) => l[want]).length;
      for (const l of [...this.live]) {
        if (n <= max) break;
        if (!l[want]) continue;
        const ok = l.it ? !l.it.body.awake && this.d.loose.clear(l.it) : this.d.lounge.clearDrink(l.drink!);
        if (!ok) continue;
        this.live.splice(this.live.indexOf(l), 1);
        this.stats.cleared++;
        n--;
      }
    };
    clear('it', Stock.MAX_LOOSE);
    clear('drink', Stock.MAX_DRINKS);
  }

  /** Promoted things of yours still about (tests, tuning). */
  get liveCount() {
    return { loose: this.live.filter((l) => l.it && !l.it.gone).length, drinks: this.live.filter((l) => l.drink?.group.parent).length };
  }

  // ---------------------------------------------------------------------------
  // Guests' drinks
  // ---------------------------------------------------------------------------

  private snatchable(p: Person) {
    return p.prop === 'glass' && !p.driven && !!p.rig && !p.culled;
  }

  /** Takes the drink out of a guest's hand: it's a real glass in yours, and they say something about it. */
  snatch(p: Person, hand: Hand | null): (Grabbable & { obj?: Item | Drink }) | null {
    if (!this.snatchable(p)) return null;
    const top = this.d.crowd.glassAt(p);
    if (!top) return null;
    const idx = this.d.crowd.people.indexOf(p);
    const kinds = ['Scotch on the rocks', 'Bourbon, neat', 'Lago Spritz', 'Negroni', 'Virgin Mojito'];
    const kind = DRINKS.find((k) => k.name === kinds[(idx + Math.floor(this.time)) % kinds.length])!;
    let at = top.clone().add(new THREE.Vector3(0, -0.05, 0));
    const xr = this.d.inXR();
    const free = hand ?? (xr ? this.d.hands.hands.find((h) => !h.held && h.ctrl.userData.connected !== false) : null);
    if (xr && !free) return null;
    // Pointed at from across the room: it comes to your hand.
    if (xr && !hand && free) at = free.grip.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.06, 0));
    const { drink, grab } = this.d.lounge.spawnDrink(kind, at, `npc${idx}~${this.tag}${(++this.n).toString(36)}`, 0.45 + ((idx * 7) % 5) * 0.1, `npc:${idx}`);
    drink.group.rotation.y = p.yaw;
    p.prop = 'none';
    this.snatched.set(p, this.time);
    this.live.push({ drink });
    this.stats.snatched++;
    this.d.onSnatch?.(p);
    this.capLive();
    const g = Object.assign(Object.create(null), grab, { obj: drink }) as Grabbable & { obj: Drink };
    if (hand) return g;
    if (xr && free) this.d.hands.grabWith(free, g);
    else this.toDesk(g);
    return g;
  }

  /** VR: a grab handle on each guest's drink near you. */
  private npcGrab(p: Person): Grabbable {
    let g = this.npcGrabs.get(p);
    if (g) return g;
    g = {
      at: () => this.npcAt.get(p) ?? p.pos,
      radius: 0.1,
      enabled: () => this.npcAt.has(p) && this.snatchable(p),
      grab: (hand) => {
        const r = this.snatch(p, hand);
        if (!r) return null;
        this.delegates.set(hand, r);
        return r.grab(hand);
      },
      drag: (hand, pos) => this.delegates.get(hand)?.drag?.(hand, pos),
      release: (hand, pos, carried) => {
        const d = this.delegates.get(hand);
        this.delegates.delete(hand);
        d?.release?.(hand, pos, carried);
      },
    };
    this.npcGrabs.set(p, g);
    this.d.hands.register(g);
    return g;
  }

  // ---------------------------------------------------------------------------

  update(dt: number) {
    this.time += dt;
    // VR: where the guests' drinks near you are this frame (only those within arm's reach of where you stand).
    this.npcAt.clear();
    if (this.d.inXR()) {
      const f = this.d.feet();
      for (const p of this.d.crowd.glassOwners) {
        if (Math.abs(p.pos.x - f.x) > 1.6 || Math.abs(p.pos.z - f.z) > 1.6 || !this.snatchable(p)) continue;
        const at = this.d.crowd.glassAt(p);
        if (!at) continue;
        this.npcAt.set(p, at);
        this.npcGrab(p);
      }
    }
    this.tick -= dt;
    if (this.tick > 0) return;
    this.tick = 1;
    // Guests whose drink was taken get another.
    for (const [p, t] of this.snatched)
      if (this.time - t > Stock.NPC_REFILL_S) {
        this.snatched.delete(p);
        if (p.prop === 'none' && !p.photo) p.prop = 'glass';
      }
    // Fresh ones set out where they were taken (not under your nose, and not where something's been put down).
    const f = this.d.feet();
    for (const sh of this.shelves)
      for (const s of sh.slots) {
        if (s.takenAt === null || this.time - s.takenAt < s.restock) continue;
        if (Math.hypot(f.x - s.at.x, f.z - s.at.z) < 1.2) continue;
        if (this.occupied(s.at)) continue;
        this.show(s);
      }
    this.capLive();
  }

  /** Something lying right there (a loose thing or a glass)? */
  private occupied(at: THREE.Vector3) {
    for (const it of this.d.loose.items.values()) {
      if (it.gone || it.holder) continue;
      const b = it.body.pos;
      if (Math.abs(b.x - at.x) < 0.07 && Math.abs(b.z - at.z) < 0.07 && Math.abs(b.y - at.y) < 0.2) return true;
    }
    return false;
  }
}
