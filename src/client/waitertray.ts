import * as THREE from 'three';
import { DRINKS } from './bar';
import type { Grabbable, Hands } from './hands';
import { Drink, Lounge } from './lounge';
import type { Crowd, Person } from './people';

/**
 * The cocktail servers' trays of champagne: real glasses you can take. Reach
 * out and grab one in VR (or click it on desktop) and it's an ordinary drink
 * in your hand: sip it, pour it, throw it. The server stops and holds the tray
 * steady while your hand is near it, turns to offer it when she's stopped by
 * you, and tops it up at the bar (or a fresh glass appears after a while).
 */

/** Where the glasses stand on the tray (metres from its middle). */
export const TRAY_SLOTS: readonly [number, number][] = [0, 1, 2, 3].map((k) => {
  const a = Math.PI / 4 + (k * Math.PI) / 2;
  return [Math.cos(a) * 0.085, Math.sin(a) * 0.085] as [number, number];
});
/** An empty spot gets a fresh glass after this long, if she hasn't been back to the bar. */
export const REFILL_S = 40;
/** A hand this close to the tray's middle: she stops and holds it still. */
const HOLD_R = 0.6;
/** ...and this close, she doesn't turn either (the tray would swing away from you). */
const STILL_R = 0.45;

interface Slot {
  drink: Drink | null;
  grab: Grabbable | null;
  emptySince: number;
}

interface Server {
  p: Person;
  tray: THREE.Object3D;
  slots: Slot[];
  /** Already on her way back to the bar. */
  toBar: boolean;
}

export interface WaiterTrayDeps {
  crowd: Crowd;
  lounge: Lounge;
  hands: Hands;
  inXR: () => boolean;
  /** Where you're standing (feet). */
  feet: () => THREE.Vector3;
}

export class WaiterTrays {
  private servers: Server[] = [];
  private time = 0;
  private kind = DRINKS.find((d) => d.section === 'Champagne')!;
  private v = new THREE.Vector3();
  private c = new THREE.Vector3();

  constructor(
    private d: WaiterTrayDeps,
    waiters: Person[],
  ) {
    for (const p of waiters) {
      if (!p.tray) continue;
      const s: Server = { p, tray: p.tray, slots: TRAY_SLOTS.map(() => ({ drink: null, grab: null, emptySince: 0 })), toBar: false };
      s.slots.forEach((_, k) => this.fill(s, k));
      this.servers.push(s);
    }
  }

  /** How many glasses are on this person's tray. */
  glasses(p: Person): number {
    const s = this.servers.find((x) => x.p === p);
    return s ? s.slots.filter((x) => x.drink).length : 0;
  }

  /** The glasses on this person's tray (for tests and debugging). */
  onTray(p: Person): Drink[] {
    const s = this.servers.find((x) => x.p === p);
    return s ? (s.slots.map((x) => x.drink).filter(Boolean) as Drink[]) : [];
  }

  /**
   * Hands you a glass off her tray (pointing at her and pulling the trigger, or
   * clicking her). False if the tray is empty or you've no free hand.
   */
  serve(p: Person): boolean {
    const s = this.servers.find((x) => x.p === p);
    if (!s) return false;
    this.check(s);
    // The glass nearest you.
    const feet = this.d.feet();
    let best: Slot | null = null,
      bd = Infinity;
    for (const sl of s.slots) {
      if (!sl.drink || !sl.grab) continue;
      const dd = sl.drink.group.getWorldPosition(this.v).distanceToSquared(feet);
      if (dd < bd) {
        bd = dd;
        best = sl;
      }
    }
    if (!best) return false;
    const ok = this.d.lounge.handOver(best.drink!, best.grab!);
    this.check(s);
    return ok;
  }

  update(dt: number) {
    this.time += dt;
    const feet = this.d.feet();
    const xr = this.d.inXR();
    for (const s of this.servers) {
      const p = s.p;
      this.check(s);
      // Back at the bar: the bartender tops the tray up. Otherwise a glass now and then.
      const atBar = Lounge.nearBar(p.pos.x, p.pos.z);
      // There (or her route got cut short: she'll be sent again).
      if (atBar || p.route.length === 0) s.toBar = false;
      s.slots.forEach((sl, k) => {
        if (!sl.drink && (atBar || this.time - sl.emptySince > REFILL_S)) this.fill(s, k);
      });
      const empty = s.slots.filter((x) => !x.drink).length;
      if (empty >= 2 && !s.toBar && !atBar && p.pause <= 0 && this.d.crowd.headTo(p, Lounge.COUNTER_X + 1.0, (Lounge.COUNTER_Z0 + Lounge.COUNTER_Z1) / 2)) s.toBar = true;
      if (p.culled) continue;
      // Your hand coming toward the tray: she stops and keeps it still for you.
      s.tray.getWorldPosition(this.c);
      let hand = Infinity;
      if (xr)
        for (const h of this.d.hands.hands) {
          if (h.ctrl.userData.connected === false) continue;
          h.grip.getWorldPosition(this.v);
          hand = Math.min(hand, this.v.distanceTo(this.c));
        }
      if (hand < HOLD_R && s.slots.some((x) => x.drink)) {
        p.pause = Math.max(p.pause, 1.5);
        p.attendUntil = Math.max(p.attendUntil, this.d.crowd.now + 1.5);
      }
      // Stopped near you: she turns to offer you the tray (gently, and not while your hand is at it).
      const dx = feet.x - p.pos.x,
        dz = feet.z - p.pos.z;
      if (p.pause > 0 && !p.chatWith && dx * dx + dz * dz < 2.2 * 2.2 && hand > STILL_R) {
        let dy = Math.atan2(dx, dz) - p.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        p.yaw += dy * Math.min(1, dt * 2.5);
      }
    }
  }

  /** A glass left a tray here (taken, knocked off, smashed): your friends' trays lose one too. */
  onTaken: ((p: Person) => void) | null = null;

  /** Notices glasses that left the tray (taken, knocked off, smashed). */
  private check(s: Server) {
    for (const sl of s.slots)
      if (sl.drink && sl.drink.group.parent !== s.tray) {
        sl.drink = null;
        sl.grab = null;
        sl.emptySince = this.time;
        this.onTaken?.(s.p);
      }
  }

  /** A friend took a glass off this waiter's tray: one goes from it here too. True if there was one. */
  takeRemote(p: Person): boolean {
    const s = this.servers.find((x) => x.p === p);
    const sl = s?.slots.find((x) => x.drink);
    if (!s || !sl) return false;
    sl.drink!.group.removeFromParent();
    sl.drink = null;
    sl.grab = null;
    sl.emptySince = this.time;
    return true;
  }

  private fill(s: Server, k: number) {
    const dr = new Drink(this.kind);
    const [x, z] = TRAY_SLOTS[k];
    dr.group.position.set(x, 0, z);
    dr.group.rotation.y = Math.random() * Math.PI * 2;
    s.tray.add(dr.group);
    const g = dr.group;
    s.slots[k] = { drink: dr, grab: this.d.lounge.trayGlass(dr, () => g.parent === s.tray), emptySince: 0 };
  }
}
