import * as THREE from 'three';
import type { Session, Friend } from './session';
import { DRINKS } from '../bar';
import { Drink, type DrinkEvent, type Lounge } from '../lounge';

/**
 * Two-player drinks: you see your friend order at the bar (the bartender
 * pours it), carry it in their hand, sip it, and throw it; drinks they pick up
 * from the lounge tables leave the table on your side too, and come back
 * where they set them down.
 */
export class DrinkSync {
  private shown = new Map<string, { drink: Drink; kind: number }>();

  constructor(
    private session: Session,
    private lounge: Lounge,
    private scene: THREE.Scene,
    /** You got soaked by your friend (their pour or a thrown drink). */
    private onSoaked: (color: number) => void = () => {},
  ) {
    session.on('doused', (_f, d) => this.onSoaked(Math.floor(Number(d.c)) || 0xffaa44));
    lounge.onDrinkEvent = (e) => session.emit('drink', e);
    session.on('drink', (f, d) => this.receive(f, d as unknown as DrinkEvent));
    session.extraState = () => {
      const h = lounge.heldDrink();
      return { dh: h ? [h.kind, Math.round(h.level * 10), h.side === 'l' ? 0 : 1, h.pouring ? 1 : 0] : null };
    };
  }

  private receive(f: Friend, e: DrinkEvent) {
    if (!e || typeof e !== 'object') return;
    if (e.k === 'sip') {
      // Desktop players' avatars lift the glass; VR players' real hands already do.
      if (f.person && !f.wrist('r')) {
        f.person.sipT = 1.6;
      }
      return;
    }
    if (e.k === 'throw') {
      // The glass leaves their hand (state catches up a moment later).
      const s = this.shown.get(f.id);
      if (s) s.drink.group.visible = false;
    }
    this.lounge.friendDrink(e);
  }

  /** Puts each friend's drink in their hand. */
  update() {
    const seen = new Set<string>();
    for (const f of this.session.friendList()) {
      seen.add(f.id);
      const dh = f.state.dh;
      let s = this.shown.get(f.id);
      const kind = Array.isArray(dh) ? Math.floor(dh[0]) : -1;
      if (!DRINKS[kind] || !f.person || f.person.culled) {
        if (s) s.drink.group.visible = false;
        if (f.person && f.person.prop === 'glass' && !DRINKS[kind]) f.person.prop = 'none';
        continue;
      }
      if (!s || s.kind !== kind) {
        if (s) s.drink.group.removeFromParent();
        // They just picked up the drink they ordered: it leaves the counter.
        this.lounge.friendPickedUp();
        s = { drink: new Drink(DRINKS[kind]), kind };
        s.drink.remote = true;
        s.drink.group.traverse((o) => (o.raycast = () => {}));
        this.scene.add(s.drink.group);
        this.shown.set(f.id, s);
      }
      const g = s.drink.group;
      g.visible = true;
      s.drink.setLevel((Number(dh![1]) || 0) / 10);
      const side = dh![2] === 0 ? 'l' : 'r';
      const w = f.wrist(side);
      if (w && f.state.lw !== undefined) {
        // VR friend: in their real hand (just off the palm, toward the fingers), upright.
        const at = new THREE.Vector3(0, -0.05, -0.065).applyQuaternion(w.q).add(w.p);
        g.position.copy(at).add(new THREE.Vector3(0, -0.06, 0));
        g.rotation.set(0, f.person.yaw, 0, 'YXZ');
      } else {
        // Desktop/phone friend: the avatar holds it (glass pose), at their right wrist.
        f.person.prop = 'glass';
        const wr = f.person.rig?.bones['WristR'];
        if (wr) {
          wr.getWorldPosition(g.position);
          g.position.y -= 0.05;
          g.rotation.set(0, f.person.yaw, 0, 'YXZ');
        } else g.visible = false;
      }
    }
    // Pouring: their glass tips forward (the drink physics pours it).
    for (const f of this.session.friendList()) {
      const s = this.shown.get(f.id);
      const dh = f.state.dh;
      if (s && Array.isArray(dh) && dh[3] === 1) s.drink.group.rotation.x = 2.0;
    }
    for (const [id, s] of this.shown) {
      if (!seen.has(id)) {
        s.drink.group.removeFromParent();
        this.shown.delete(id);
      }
    }
  }

  /** You poured on (or threw a drink at) your friend's avatar: they get soaked on their side. */
  douse(person: import('../people').Person, color: number): boolean {
    const f = this.session.friendList().find((x) => x.person === person);
    if (!f) return false;
    this.session.emit('doused', { c: color });
    return true;
  }

  dispose() {
    for (const s of this.shown.values()) s.drink.group.removeFromParent();
    this.shown.clear();
    this.lounge.onDrinkEvent = null;
  }
}
