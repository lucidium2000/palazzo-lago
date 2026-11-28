import * as THREE from 'three';
import type { Bankroll } from '../rules/bankroll';
import type { Sound } from './audio';
import type { Grabbable, Hand, Hands } from './hands';
import type { Hud } from './hud';
import type { Interaction } from './interaction';
import type { Item, LooseObjects } from './loose';
import type { Crowd, Person } from './people';
import type { Player } from './player';
import { CanvasPanel, GOLD, GOLD_LIGHT, roundRect, SERIF } from './panel';
import { COUNTER, COUNTERS, inStore, MERCH, onPromenade, servePoint, type CounterSpec, type FoodItemSpec, type MerchKey } from './areas/promenadeplan';
import type { PromenadeArea, PromenadeCast } from './areas/promenade';
import { elVoice } from './cast';
import { CLERK_LINES, COOK_LINES, cookSpeaker, type CookId, type PromSpeaker } from './promenadelines';
import { STAFF } from './speech';
import { mouthOf, voices } from './voices';
import type { Listener } from './listen';
import { matchMenu, menuVocabulary } from './understand';
import { FOOD_ALIASES } from './replylex';

/**
 * Life on the Promenade: ordering at the food court's counters (like ordering
 * at the bar: pick from the menu, pay in chips, the cook makes it and puts it
 * on the counter for you to pick up), the boutique's register (pick something
 * up, pay at the counter), and your wardrobe (sunglasses on your eyes, a hat
 * on your head, shown to your friends).
 *
 * Staff speak in their own recorded voices (promenadelines.ts: Tony, Duke,
 * Mei and Lucia at the counters, Simone at the register), from their mouths.
 * A line that isn't recorded yet is a caption only: never the browser's
 * robot voice. Your friends nearby hear (or read) the same line (onLine:
 * net/npcsync.ts).
 */

const pick = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
/** A dish's name mid-sentence ("one slice of pepperoni", but "one Lago double cheeseburger"). */
const dish = (name: string) => (/^(Lago|Palazzo)\b/.test(name) ? name : name[0].toLowerCase() + name.slice(1));

/** A staff line for your friends (the same take, from the same person). */
export type StaffLine = { text: string; voice: string; alt?: string; who: string };

/**
 * One of the Promenade's staff says a line: their recorded voice from their
 * mouth, or a caption if it isn't recorded (never synthesized speech).
 * Returns how long they talk.
 */
export function staffSay(crowd: Crowd, p: Person | null, speaker: PromSpeaker, who: string, text: string, at: THREE.Vector3, onLine: ((p: Person, l: StaffLine) => void) | null): number {
  const voice = elVoice(speaker);
  const alt = STAFF[speaker];
  if (p) onLine?.(p, { text, voice, alt, who });
  const dur = voices.talk({ who, text, voice, alt, at: p ? mouthOf(p) : () => at, priority: true, group: speaker, recordedOnly: true });
  if (p) {
    crowd.speak(p, dur);
    p.attendUntil = crowd.now + dur + 1;
  }
  return dur;
}

// ---------------------------------------------------------------------------
// Food court
// ---------------------------------------------------------------------------

interface Order {
  counter: CounterSpec;
  item: FoodItemSpec;
  t: number;
  total: number;
}

export interface FoodCourtDeps {
  scene: THREE.Scene;
  interaction: Interaction;
  sound: Sound;
  hud: Hud;
  bankroll: Bankroll;
  crowd: Crowd;
  loose: LooseObjects;
  player: Player;
  area: PromenadeArea;
  cast: () => PromenadeCast | null;
  /** Listens for a dish ordered out loud after the cook says hello. */
  listener?: Listener;
}

/** You're standing at a counter (close enough to order). */
const atCounter = (f: THREE.Vector3, c: CounterSpec) => onPromenade(f.x) && Math.abs(f.x - c.x) <= 2.2 && f.z <= -9.4;

export class FoodCourt {
  private orders = new Map<string, Order>();
  private panels = new Map<string, CanvasPanel>();
  private served = new Map<string, number>();
  private greeted = new Map<string, number>();
  private time = 0;
  /** Orders you've had (tests and tuning). */
  readonly stats = { ordered: 0, served: 0 };
  /** You got food (night goals, the crew can comment). */
  onServed: ((item: Item, spec: FoodItemSpec) => void) | null = null;
  /** A cook said a line to you (your friends nearby hear it too: net/npcsync.ts). */
  onLine: ((p: Person, l: StaffLine) => void) | null = null;

  constructor(private d: FoodCourtDeps) {
    for (const spot of d.area.menuSpots) {
      const c = spot.counter;
      const p = new CanvasPanel(0.56, 640, 600, { transparent: true });
      p.background = (ctx) => this.paintMenu(ctx, c, p);
      c.items.forEach((it, i) =>
        p.add({
          id: `${c.id}-${i}`,
          x: 30,
          y: 150 + i * 150,
          w: 580,
          h: 130,
          label: it.name,
          sub: `$${it.price} · ${it.bites} bites`,
          enabled: () => !this.orders.has(c.id),
          onPress: () => this.order(c, it),
        }),
      );
      p.mesh.position.copy(spot.pos);
      p.mesh.rotation.set(-0.35, spot.yaw, 0, 'YXZ');
      p.mesh.name = `menu-${c.id}`;
      p.register(d.interaction);
      d.area.root.add(p.mesh);
      p.redraw();
      this.panels.set(c.id, p);
      // The stand it's on.
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.12), new THREE.MeshStandardMaterial({ color: 0xc9a050, metalness: 1, roughness: 0.3 }));
      stand.position.set(spot.pos.x, spot.pos.y - 0.24, spot.pos.z + 0.06);
      stand.raycast = () => {};
      d.area.root.add(stand);
    }
  }

  private paintMenu(ctx: CanvasRenderingContext2D, c: CounterSpec, p: CanvasPanel) {
    roundRect(ctx, 4, 4, p.pxW - 8, p.pxH - 8, 26);
    ctx.fillStyle = 'rgba(18,12,8,0.94)';
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = GOLD_LIGHT;
    ctx.textAlign = 'center';
    ctx.font = `italic 600 46px ${SERIF}`;
    ctx.fillText(c.brand, p.pxW / 2, 64, p.pxW - 40);
    ctx.font = `italic 24px ${SERIF}`;
    ctx.fillStyle = '#cbb991';
    const o = this.orders.get(c.id);
    ctx.fillText(o ? `Making your ${dish(o.item.name)}…` : 'Point at a dish and pull the trigger (or click)', p.pxW / 2, 108, p.pxW - 40);
    ctx.font = `20px ${SERIF}`;
    ctx.fillStyle = '#9a8a6a';
    ctx.fillText('Pay with chips · pick it up off the counter', p.pxW / 2, p.pxH - 26);
  }

  /** A cook, by counter. */
  private cook(c: CounterSpec): Person | null {
    return this.d.cast()?.servers.get(c.id) ?? null;
  }

  private lines(c: CounterSpec) {
    return COOK_LINES[c.id as CookId];
  }

  /**
   * After the cook's hello, they listen for your order: say a dish ("a slice of
   * pepperoni", "the spicy noodles", "pistachio") and it's made, as if you'd
   * pointed at it on the menu.
   */
  private listenForDish(c: CounterSpec, after: number, tries = 2) {
    const l = this.d.listener;
    if (!l?.enabled) return;
    const names = c.items.map((i) => i.name);
    setTimeout(() => {
      if (l.state !== 'idle' || this.orders.has(c.id) || !atCounter(this.d.player.feet(), c)) return;
      void l.listen(menuVocabulary(names, FOOD_ALIASES, []), 8).then((heard) => {
        if (!heard || this.orders.has(c.id) || !atCounter(this.d.player.feet(), c)) return;
        if (this.heardAt(c, heard)) return;
        if (tries > 1) this.listenForDish(c, 0, tries - 1);
      });
    }, Math.max(0.4, after) * 1000);
  }

  /** You said something at a counter: a dish on its menu is ordered (true). */
  heardAt(c: CounterSpec, heard: string): boolean {
    const m = matchMenu(heard, c.items.map((i) => i.name), FOOD_ALIASES, []);
    if (typeof m !== 'number') return false;
    this.order(c, c.items[m]);
    return true;
  }

  private say(c: CounterSpec, text: string) {
    return staffSay(this.d.crowd, this.cook(c), cookSpeaker(c.id), c.brand, text, new THREE.Vector3(c.x, 1.6, COUNTER.z - 0.85), this.onLine);
  }

  /** Order a dish at a counter: pay, the cook makes it, it lands on the counter for you. */
  order(c: CounterSpec, item: FoodItemSpec): boolean {
    if (this.orders.has(c.id)) {
      this.say(c, pick(this.lines(c).busy));
      return false;
    }
    if (!this.d.bankroll.canAfford(item.price)) {
      this.say(c, pick(this.lines(c).broke));
      this.d.sound.play('denied', this.d.area.menuSpots.find((s) => s.counter === c)!.pos, { volume: 0.5 });
      return false;
    }
    this.d.bankroll.debit(item.price, 'bet', 'food');
    this.orders.set(c.id, { counter: c, item, t: 0, total: item.prep });
    this.stats.ordered++;
    this.say(c, pick(this.lines(c).order[item.name] ?? this.lines(c).hello));
    const cook = this.cook(c);
    if (cook) {
      cook.actionKind = 'pour';
      cook.action = item.prep;
    }
    const at = new THREE.Vector3(c.x, 1.1, -12.8);
    this.d.sound.play(c.id === 'gelato' ? 'click' : 'pour', at, { volume: c.id === 'gelato' ? 0.4 : 0.35, rate: c.id === 'pizza' ? 0.6 : 1.4 });
    this.panels.get(c.id)?.redraw();
    return true;
  }

  /** The dish is ready: it appears on the counter (your friends see it there too). */
  private serve(o: Order) {
    const c = o.counter;
    const slot = (this.served.get(c.id) ?? 0) % 4;
    this.served.set(c.id, slot + 1);
    const sp = servePoint(c, slot);
    const it = this.d.loose.spawnLive(o.item.key, sp.x, sp.z, sp.y + 0.25, { yaw: Math.PI + (Math.random() - 0.5) * 0.4 });
    this.d.sound.play('ding', new THREE.Vector3(sp.x, sp.y + 0.3, sp.z), { volume: 0.5, rate: 1.3 });
    this.say(c, pick(this.lines(c).ready[o.item.name] ?? this.lines(c).hello));
    this.d.hud.toast(this.d.player.inXR ? `Your ${dish(o.item.name)} is on the counter · grab it, bring it to your mouth` : `Your ${dish(o.item.name)} is on the counter · click it, F to take a bite`, 'win');
    this.stats.served++;
    if (it) this.onServed?.(it, o.item);
  }

  update(dt: number) {
    this.time += dt;
    for (const [id, o] of this.orders) {
      o.t += dt;
      if (o.t >= o.total) {
        this.orders.delete(id);
        this.serve(o);
        this.panels.get(id)?.redraw();
      }
    }
    // Walk up to a counter and its cook says hello (once in a while).
    const f = this.d.player.feet();
    if (!onPromenade(f.x)) return;
    for (const c of COUNTERS) {
      if (Math.abs(f.x - c.x) > 2 || f.z > -9.6) continue;
      const last = this.greeted.get(c.id) ?? -Infinity;
      if (this.time - last > 60 && !this.orders.has(c.id)) {
        this.greeted.set(c.id, this.time);
        const dur = this.say(c, pick(this.lines(c).hello));
        this.listenForDish(c, dur);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The boutique's register
// ---------------------------------------------------------------------------

export interface BoutiqueDeps {
  scene: THREE.Scene;
  interaction: Interaction;
  sound: Sound;
  hud: Hud;
  bankroll: Bankroll;
  crowd: Crowd;
  loose: LooseObjects;
  player: Player;
  area: PromenadeArea;
  cast: () => PromenadeCast | null;
  wardrobe: Wardrobe;
}

/** How a piece of stock is called in a toast ("Charged $60 for the shades"). */
const SHORT: Record<MerchKey, string> = { sunglasses: 'the shades', hat: 'the fedora', plush: 'Lucky the lion', diceset: 'the dice set' };
const listOf = (keys: MerchKey[]) => keys.map((k) => SHORT[k]).join(keys.length > 2 ? ', ' : ' and ');

export class Boutique {
  private wasIn = false;
  private greetedAt = -Infinity;
  private warnedAt = -Infinity;
  private time = 0;
  readonly stats = { sold: 0, spent: 0 };
  /** The clerk said a line to you (your friends nearby hear it too). */
  onLine: ((p: Person, l: StaffLine) => void) | null = null;

  constructor(private d: BoutiqueDeps) {
    // Try anything on in the shop, paid for or not (walk out wearing it and it's charged).
    d.loose.canTryOn = () => {
      const f = d.player.feet();
      return inStore(f.x, f.z);
    };
    // The register: click it (or point and pull the trigger) with stock in your hand to pay.
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.45), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.copy(d.area.register).add(new THREE.Vector3(0, 0.18, 0));
    hit.name = 'boutique-register';
    d.area.root.add(hit);
    d.interaction.register({
      object: hit,
      kind: 'button',
      label: () => {
        const due = this.due();
        if (!due.length) return 'The register · pick something up (or try it on) to buy it';
        return `Pay $${this.total(due)} for ${listOf(due)}`;
      },
      onSelect: () => this.pay(),
    });
  }

  /** Everything you'd pay for now: unpaid stock in your hands and on you. */
  private due(): MerchKey[] {
    return [...this.d.loose.unpaidHeld().map((it) => it.kind.merch!), ...this.d.wardrobe.unpaid()];
  }

  private total(keys: MerchKey[]) {
    return keys.reduce((a, k) => a + MERCH[k].price, 0);
  }

  /** Takes the money for everything due; false if you're short. */
  private charge(keys: MerchKey[]): boolean {
    const cost = this.total(keys);
    if (!this.d.bankroll.canAfford(cost)) return false;
    this.d.bankroll.debit(cost, 'bet', 'boutique');
    for (const it of this.d.loose.unpaidHeld()) this.d.loose.markPaid(it);
    this.d.wardrobe.markPaid();
    this.stats.sold += keys.length;
    this.stats.spent += cost;
    this.d.sound.play('chips', this.d.area.register, { volume: 0.6 });
    setTimeout(() => this.d.sound.play('ding', this.d.area.register, { volume: 0.45, rate: 1.6 }), 250);
    return true;
  }

  private say(text: string) {
    staffSay(this.d.crowd, this.d.cast()?.clerk ?? null, 'clerk', 'Lago Luxe', text, this.d.area.register.clone().setY(1.6), this.onLine);
  }

  /** Pays for whatever stock you're holding. */
  pay(): boolean {
    const due = this.due();
    if (!due.length) {
      this.d.hud.toast('Pick something up (or try it on) first, then pay for it here', 'info');
      return false;
    }
    const cost = this.total(due);
    // What you're holding (not wearing yet) decides the "how to put it on" hint.
    const heldKey = this.d.loose.unpaidHeld()[0]?.kind.merch ?? null;
    if (!this.charge(due)) {
      this.say(pick(CLERK_LINES.broke));
      this.d.sound.play('denied', this.d.area.register, { volume: 0.5 });
      return false;
    }
    this.say(pick(CLERK_LINES.paid[due[0]]));
    const wear = heldKey ? MERCH[heldKey].wear : null;
    const them = wear === 'eyes' ? 'them' : 'it';
    this.d.hud.toast(
      wear ? (this.d.player.inXR ? `Paid $${cost} · hold ${wear === 'eyes' ? 'them to your face' : 'it on your head'} to put ${them} on` : `Paid $${cost} · F to put ${them} on`) : `Paid $${cost} · ${due.length > 1 ? "they're" : "it's"} yours`,
      'win',
    );
    return true;
  }

  /**
   * You walked out with stock you hadn't paid for (in your hand, or still on
   * you from trying it on): Simone calls after you and it goes on your bill,
   * or, if you're short, back on the shelf.
   */
  private walkedOut() {
    const due = this.due();
    if (!due.length) return;
    const cost = this.total(due);
    if (this.time - this.warnedAt > 20) {
      this.warnedAt = this.time;
      this.say(pick(CLERK_LINES.shoplift));
    }
    if (this.charge(due)) {
      this.d.hud.toast(`Charged $${cost} for ${listOf(due)}`, 'win');
      return;
    }
    for (const it of this.d.loose.unpaidHeld()) this.d.loose.backToShelf(it);
    this.d.wardrobe.shelveUnpaid();
    this.d.sound.play('denied', this.d.area.register, { volume: 0.5 });
    this.d.hud.toast(`Not enough chips for ${listOf(due)} ($${cost}) · back on the shelf`, 'warn');
  }

  update(dt: number) {
    this.time += dt;
    const f = this.d.player.feet();
    const inside = inStore(f.x, f.z);
    if (inside && !this.wasIn && this.time - this.greetedAt > 90) {
      this.greetedAt = this.time;
      this.say(pick(CLERK_LINES.hello));
    }
    // Walking out with something you haven't paid for: the clerk notices, and it goes on your bill.
    if (!inside && this.wasIn) this.walkedOut();
    this.wasIn = inside;
    // VR: hold a piece of stock up to the register and it rings up.
    if (this.d.player.inXR && inside) {
      for (const it of this.d.loose.unpaidHeld()) {
        const p = it.proxy?.getWorldPosition(new THREE.Vector3());
        if (p && p.distanceTo(this.d.area.register) < 0.3) {
          this.pay();
          break;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Wardrobe: what you (and people) wear
// ---------------------------------------------------------------------------

export type Slot = 'eyes' | 'head';
export interface Worn {
  key: MerchKey;
  color: number;
  /** Bought (false: trying it on in the shop). */
  paid: boolean;
}

/** Where an accessory sits relative to the head bone (head-turned frame: x right, y up, z forward). */
/** Worn, a hat is drawn a size up (the shop's fedoras are sized for the table, and avatars have plenty of hair). */
export const WORN_SCALE: Record<Slot, number> = { eyes: 1, head: 1.15 };
export const SEAT: Record<Slot, THREE.Vector3> = {
  eyes: new THREE.Vector3(0, 0.058, 0.112),
  head: new THREE.Vector3(0, 0.15, -0.01),
};

/**
 * Puts an accessory mesh on a person's head: at their head bone, turned with
 * their body and head. Returns false when they have no rig (or are culled).
 */
export function seatOnHead(mesh: THREE.Object3D, p: Person, slot: Slot): boolean {
  const head = p.rig?.bones.Head;
  if (!head || p.culled || !p.rig!.root.visible) return false;
  head.getWorldPosition(mesh.position);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(slot === 'eyes' ? -p.headPitch : -p.headPitch * 0.6, p.yaw + p.headYaw, 0, 'YXZ'));
  mesh.position.add(SEAT[slot].clone().applyQuaternion(q));
  mesh.quaternion.copy(q);
  return true;
}

export interface WardrobeDeps {
  scene: THREE.Scene;
  camera: THREE.Camera;
  loose: LooseObjects;
  hands: Hands;
  hud: Hud;
  player: Player;
  sound: Sound;
}

/** The lenses, as you see them from behind: the world tinted, the frame soft and dark round the edge of your view. */
const LENS = { w: 0.4, h: 0.3, at: 0.05, hx: 0.06, hy: 0.044 };

function lensTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const W = 512,
    H = 384;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g) return null;
  const lx = (LENS.hx / LENS.w) * W,
    ly = (LENS.hy / LENS.h) * H;
  // The frame everywhere, then the lens cut out of it (soft-edged, as a frame this close is out of focus).
  g.fillStyle = 'rgba(12,8,5,0.93)';
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'destination-out';
  g.filter = 'blur(9px)';
  g.fillStyle = '#000';
  roundRect(g, W / 2 - lx, H / 2 - ly, lx * 2, ly * 2, Math.min(lx, ly) * 0.55);
  g.fill();
  g.filter = 'none';
  // The tint behind it all (a warm brown, like the shop's lenses).
  g.globalCompositeOperation = 'destination-over';
  g.fillStyle = 'rgba(30,20,10,0.34)';
  g.fillRect(0, 0, W, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Wardrobe {
  readonly worn: Record<Slot, Worn | null> = { eyes: null, head: null };
  /** What you see through the sunglasses (a tinted pane with the frame round it, just in front of your eyes). */
  readonly shade: THREE.Mesh;
  /** Accessories on NPCs (the clerk's sunglasses): person, slot, mesh. */
  private npc: { p: Person; slot: Slot; mesh: THREE.Object3D }[] = [];
  private pending: { slot: Slot; hand: Hand } | null = null;
  /** Changed what you wear (friends see it in your state; this is for anything else). */
  onChange: (() => void) | null = null;

  constructor(private d: WardrobeDeps) {
    // Sunglasses on: the world a shade darker, the frame's edge round your view (a pane just in front of your eyes).
    const tex = lensTexture();
    this.shade = new THREE.Mesh(
      new THREE.PlaneGeometry(LENS.w, LENS.h),
      tex
        ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false })
        : new THREE.MeshBasicMaterial({ color: 0x1a120a, transparent: true, opacity: 0.32, depthTest: false, depthWrite: false, toneMapped: false, fog: false }),
    );
    this.shade.name = 'sunglasses-view';
    this.shade.position.set(0, 0, -LENS.at);
    this.shade.frustumCulled = false;
    this.shade.renderOrder = 999;
    this.shade.visible = false;
    this.shade.raycast = () => {};
    d.camera.add(this.shade);
    d.loose.onWear = (key, color, paid) => this.putOn(key, color, paid);
    // VR: reach up and grab at your eyes or temples (the brim, for a hat) to take it off: it comes away in your hand.
    // (The headset keeps your hand ~10 cm out from your eyes, so the reach is generous.)
    for (const slot of ['eyes', 'head'] as Slot[]) {
      const g: Grabbable = {
        at: () => {
          const h = this.d.hands.head;
          return slot === 'head' ? h.clone().add(new THREE.Vector3(0, 0.14, 0)) : h.clone();
        },
        radius: slot === 'head' ? 0.18 : 0.19,
        enabled: () => this.d.player.inXR && !!this.worn[slot],
        grab: (hand) => {
          // The hand closes on it next frame, as the real thing (so it throws, drops and syncs like any).
          this.pending = { slot, hand };
          return null;
        },
      };
      d.hands.register(g);
    }
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyU' && !d.player.inXR) this.takeOffDesk();
    });
  }

  /** You put something on (from your hand): paid for, or trying it on in the shop. */
  putOn(key: MerchKey, color: number, paid = true): boolean {
    const slot = MERCH[key].wear;
    if (!slot) return false;
    const had = this.worn[slot];
    // Swapping: the pair you had on comes off (the shop's goes back on its shelf; your own drops in front of you).
    if (had && !had.paid) this.d.loose.shelve(had.key, had.color);
    else if (had) this.d.loose.takeOff(had.key, had.color, null, true);
    this.worn[slot] = { key, color, paid };
    this.shade.visible = !!this.worn.eyes;
    // A satisfying snap: the arms fold onto your ears (a hat: settles on), and a little sparkle.
    this.d.sound.playLocal('click', 0.7, slot === 'eyes' ? 1.5 : 0.7);
    setTimeout(() => this.d.sound.playLocal('click', 0.45, slot === 'eyes' ? 1.1 : 0.55), 70);
    setTimeout(() => this.d.sound.playLocal('ding', 0.12, 2.4), 120);
    const what = key === 'hat' ? 'the fedora' : 'the shades';
    const off = this.d.player.inXR ? `grab at your ${slot === 'eyes' ? 'eyes' : 'hat'} to take ${slot === 'eyes' ? 'them' : 'it'} off` : 'U to take off';
    this.d.hud.toast(paid ? `Wearing ${what} · looking sharp · ${off}` : `Trying on ${what} · $${MERCH[key].price} at the register · ${off}`, 'win');
    this.onChange?.();
    return true;
  }

  /** What you're wearing that you haven't paid for (trying it on). */
  unpaid(): MerchKey[] {
    return (['eyes', 'head'] as Slot[]).flatMap((s) => (this.worn[s] && !this.worn[s]!.paid ? [this.worn[s]!.key] : []));
  }

  /** The boutique took your money for what you're wearing. */
  markPaid() {
    for (const s of ['eyes', 'head'] as Slot[]) if (this.worn[s]) this.worn[s]!.paid = true;
  }

  /** Couldn't pay: what you were trying on goes back on the shelf. */
  shelveUnpaid() {
    for (const s of ['eyes', 'head'] as Slot[]) {
      const w = this.worn[s];
      if (!w || w.paid) continue;
      this.worn[s] = null;
      this.d.loose.shelve(w.key, w.color);
    }
    this.shade.visible = !!this.worn.eyes;
    this.onChange?.();
  }

  /** Desktop U: the hat comes off first, then the shades; into your hand. */
  takeOffDesk() {
    const slot: Slot | null = this.worn.head ? 'head' : this.worn.eyes ? 'eyes' : null;
    if (!slot) return;
    if (this.d.loose.holding) {
      this.d.hud.toast('Your hands are full', 'info');
      return;
    }
    this.takeOff(slot, null);
  }

  private takeOff(slot: Slot, hand: Hand | null) {
    const w = this.worn[slot];
    if (!w) return;
    this.worn[slot] = null;
    this.shade.visible = !!this.worn.eyes;
    this.d.loose.takeOff(w.key, w.color, hand, w.paid);
    this.onChange?.();
  }

  /** What you wear, for your friends: [eyes kind, colour, head kind, colour] (-1: nothing). */
  state(): number[] | null {
    const e = this.worn.eyes,
      h = this.worn.head;
    if (!e && !h) return null;
    const k = (w: Worn | null) => (w ? (this.d.loose.kindOf(w.key)?.index ?? -1) : -1);
    return [k(e), e?.color ?? 0, k(h), h?.color ?? 0];
  }

  /** Dresses a guest or staff member (the clerk wears her own shades). */
  dress(p: Person, key: MerchKey, color: number) {
    const slot = MERCH[key].wear;
    const kind = this.d.loose.kindOf(key);
    if (!slot || !kind) return;
    const mesh = this.d.loose.makeProxy(kind.index, color, WORN_SCALE[slot]);
    if (!mesh) return;
    mesh.visible = false;
    this.d.scene.add(mesh);
    this.npc.push({ p, slot, mesh });
  }

  update() {
    // On a screen, the frame's edge sits just inside the edges of the window (in VR it's fixed: your lenses' field of view).
    if (this.shade.visible) {
      const cam = this.d.camera as THREE.PerspectiveCamera;
      if (this.d.player.inXR || !cam.isPerspectiveCamera) this.shade.scale.set(1, 1, 1);
      else {
        const hh = LENS.at * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
        this.shade.scale.set((0.97 * hh * cam.aspect) / LENS.hx, (0.97 * hh) / LENS.hy, 1);
      }
    }
    if (this.pending) {
      const { slot, hand } = this.pending;
      this.pending = null;
      if (!hand.held) this.takeOff(slot, hand);
    }
    for (const n of this.npc) n.mesh.visible = seatOnHead(n.mesh, n.p, n.slot);
  }
}

/** Your friends' accessories, from their state (`wa`): drawn on their avatars' heads. */
export class WearView {
  private shown = new Map<string, { key: string; eyes: THREE.Object3D | null; head: THREE.Object3D | null }>();

  constructor(
    private scene: THREE.Scene,
    private loose: LooseObjects,
  ) {}

  update(friends: { id: string; person: Person | null; state: { wa?: number[] | null } }[]) {
    const seen = new Set<string>();
    for (const f of friends) {
      seen.add(f.id);
      const wa = f.state.wa;
      const ok = Array.isArray(wa) && wa.length === 4 && wa.every((x) => Number.isFinite(x));
      const key = ok ? wa!.join(',') : '';
      let s = this.shown.get(f.id);
      if (!s || s.key !== key) {
        s?.eyes?.removeFromParent();
        s?.head?.removeFromParent();
        const make = (kind: number, color: number, slot: Slot) => {
          if (kind < 0) return null;
          const m = this.loose.makeProxy(kind, color, WORN_SCALE[slot]);
          if (m) this.scene.add(m);
          return m;
        };
        s = { key, eyes: ok ? make(wa![0], wa![1], 'eyes') : null, head: ok ? make(wa![2], wa![3], 'head') : null };
        this.shown.set(f.id, s);
      }
      if (!f.person) continue;
      if (s.eyes) s.eyes.visible = seatOnHead(s.eyes, f.person, 'eyes');
      if (s.head) s.head.visible = seatOnHead(s.head, f.person, 'head');
    }
    for (const [id, s] of this.shown)
      if (!seen.has(id)) {
        s.eyes?.removeFromParent();
        s.head?.removeFromParent();
        this.shown.delete(id);
      }
  }

  dispose() {
    for (const s of this.shown.values()) {
      s.eyes?.removeFromParent();
      s.head?.removeFromParent();
    }
    this.shown.clear();
  }
}

