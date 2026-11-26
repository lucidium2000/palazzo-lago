import * as THREE from 'three';
import type { Friend, Session } from './session';
import type { Hands } from '../hands';
import type { Sound } from '../audio';
import type { Hud } from '../hud';
import type { Player } from '../player';
import type { You } from '../fight/you';
import { SLAP_SPEED } from '../bodies';

/**
 * Boxing with your friend. In VR, make a fist and throw a real punch: a fast
 * fist that lands on their head or body is a hit (their own hand in the way
 * is a block). On a screen, B throws a jab at whoever is right in front of
 * you. Hits flash red, thump and buzz; each of you has stamina that comes
 * back if you stop getting hit, and if it runs out, you're knocked down for a
 * moment, then back on your feet.
 *
 * An open hand swiped across their face is a slap: a sharp clap, their head
 * turns, a sting more than damage.
 *
 * Each player owns their own health (the same health as fights with guests,
 * fight/you.ts: at zero you're knocked out, fade to black, come round); the
 * one who throws decides whether a punch landed (they see their fist and your
 * avatar), the one who gets hit takes the damage and tells the other how
 * they're doing.
 */

const COOLDOWN = 0.35;
/** Fist speed (m/s) for a punch to count. */
const PUNCH_SPEED = 1.9;
const HEAD_R = 0.14;
const BODY_R = 0.2;

export interface BoxingDeps {
  session: Session;
  hands: Hands;
  player: Player;
  sound: Sound;
  hud: Hud;
  camera: THREE.Camera;
  /** Grip squeeze per hand 0..1 (a fist when high). */
  grip(): { l: number; r: number };
  haptic(side: 'left' | 'right', strength: number, ms: number): void;
  /** Your health (shared with fights with guests). */
  you: You;
}

type Zone = 'head' | 'body';

export class Boxing {
  private cool = new Map<string, number>();
  private prevHand = new Map<string, THREE.Vector3>();
  /** What you know of your friends' health (they tell you after each hit). */
  private theirs = new Map<string, number>();
  private jabSide: 'l' | 'r' = 'l';
  private time = 0;
  /** Who you last traded blows with, and when (for the health bars). */
  private last: { id: string; name: string; t: number } | null = null;

  /** Your health. */
  get hp() {
    return this.d.you.health.hp;
  }

  private get ko() {
    return this.d.you.out ? 1 : 0;
  }

  constructor(private d: BoxingDeps) {
    d.session.on('punch', (f, data) => this.takeHit(f, data));
    d.session.on('ouch', (f, data) => {
      this.theirs.set(f.id, Math.max(0, Math.min(100, Number(data.hp) || 0)));
      // Knocked out: their game tells everyone (fight/fights.ts shows them going down).
      if (data.ko && f.person) f.person.gaspT = 2.5;
    });
    d.session.on('jab', (f, data) => {
      // A screen player's avatar throws the jab.
      if (f.person && !f.wrist(data.s === 'l' ? 'l' : 'r')) {
        f.person.actionKind = 'reach';
        f.person.action = 0.35;
      }
    });
    addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'KeyB' || e.repeat || e.target instanceof HTMLInputElement || this.d.player.inXR) return;
    this.jab();
  };

  /** Desktop/phone: a jab at the friend right in front of you. */
  jab() {
    if (this.ko > 0 || (this.cool.get('jab') ?? 0) > 0) return;
    this.cool.set('jab', 0.45);
    this.jabSide = this.jabSide === 'l' ? 'r' : 'l';
    this.d.session.emit('jab', { s: this.jabSide });
    const me = this.d.player.feet();
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(this.d.camera.getWorldQuaternion(new THREE.Quaternion()));
    look.y = 0;
    look.normalize();
    for (const f of this.d.session.friendList()) {
      const p = f.person;
      if (!p) continue;
      const to = new THREE.Vector3(p.pos.x - me.x, 0, p.pos.z - me.z);
      const dist = to.length();
      if (dist > 1.3 || dist < 0.05 || to.normalize().dot(look) < 0.8) continue;
      // Looking up at them aims for the head.
      const pitch = new THREE.Vector3(0, 0, -1).applyQuaternion(this.d.camera.getWorldQuaternion(new THREE.Quaternion())).y;
      this.land(f, pitch > -0.15 ? 'head' : 'body', 0.6, to, false, null);
      return;
    }
    this.d.sound.playLocal('block', 0.15);
  }

  private wasOut = false;

  update(dt: number) {
    this.time += dt;
    for (const [k, v] of this.cool) this.cool.set(k, v - dt);
    // Came round after a knockout: tell them.
    if (this.wasOut && !this.d.you.out) this.d.session.emit('ouch', { hp: Math.round(this.hp) });
    this.wasOut = this.d.you.out;
    if (this.d.player.inXR && this.ko <= 0) this.vrPunches();
  }

  /** The friend you're trading blows with (for the health bars), if it's been recent. */
  current(): { name: string; frac: number } | null {
    const l = this.last;
    if (!l || this.time - l.t > 12) return null;
    return { name: l.name, frac: (this.theirs.get(l.id) ?? 100) / 100 };
  }

  /** VR: is either fist flying into your friend? */
  private vrPunches() {
    const friends = this.d.session.friendList();
    if (!friends.length) return;
    const g = this.d.grip();
    for (const hand of this.d.hands.hands) {
      const side = hand.ctrl.userData.handedness === 'left' ? 'left' : 'right';
      const key = side;
      const now = hand.pos.clone();
      const prev = this.prevHand.get(key) ?? now;
      this.prevHand.set(key, now);
      if (hand.held || hand.carried) continue;
      if ((this.cool.get(key) ?? 0) > 0) continue;
      const fist = (side === 'left' ? g.l : g.r) >= 0.55;
      const v = this.d.hands.velocity(hand);
      const speed = v.length();
      // An open hand across their face: a slap (any direction across it counts).
      if (!fist) {
        if (speed < SLAP_SPEED) continue;
        for (const f of friends) {
          const t = targets(f);
          if (!t || distToSegment(t.head, prev, now) > HEAD_R) continue;
          this.cool.set(key, 0.5);
          this.land(f, 'head', THREE.MathUtils.clamp((speed - SLAP_SPEED) / 2.5 + 0.2, 0.2, 1), v.clone().normalize(), false, side, true);
          break;
        }
        continue;
      }
      if (speed < PUNCH_SPEED) continue;
      for (const f of friends) {
        const t = targets(f);
        if (!t) continue;
        for (const [zone, at, r] of [['head', t.head, HEAD_R], ['body', t.chest, BODY_R]] as const) {
          // Did the fist's path this frame pass into the target, moving toward it?
          const d = distToSegment(at, prev, now);
          if (d > r || v.dot(at.clone().sub(prev)) <= 0) continue;
          // Their own hand right there takes it: a block.
          const blocker = (['l', 'r'] as const).map((s) => f.wrist(s)?.p).find((w) => w && w.distanceTo(now) < 0.13);
          this.cool.set(key, COOLDOWN);
          this.land(f, zone, THREE.MathUtils.clamp((speed - 1.6) / 4, 0.2, 1), v.clone().normalize(), !!blocker, side);
          break;
        }
        if ((this.cool.get(key) ?? 0) > 0) break;
      }
    }
  }

  /** Your punch lands on a friend (as you see it). */
  private land(f: Friend, zone: Zone, power: number, dir: THREE.Vector3, blocked: boolean, side: 'left' | 'right' | null, slap = false) {
    const at = targets(f)?.[zone === 'head' ? 'head' : 'chest'] ?? f.person?.pos.clone().setY(1.3);
    if (at) this.d.sound.play(slap ? 'slap' : blocked ? 'block' : 'punch', at, { volume: 0.6 + power * 0.5, rate: 0.9 + Math.random() * 0.2 });
    if (side) this.d.haptic(side, blocked ? 0.4 : slap ? 0.45 + power * 0.3 : 0.6 + power * 0.4, blocked || slap ? 40 : 70);
    this.last = { id: f.id, name: f.name, t: this.time };
    // Their avatar reels (they see the real hit on their side).
    const p = f.person;
    if (p && !blocked) {
      p.gaspT = 0.6 + power * 0.5;
      const across = -dir.x * Math.cos(p.yaw) + dir.z * Math.sin(p.yaw);
      if (slap) {
        p.snapY += -Math.sign(across || 1) * (0.45 + 0.35 * power);
        p.blush = 6;
        p.blushSide = across < 0 ? 1 : 0;
      } else if (zone === 'head') {
        p.snapX += 0.25 + 0.3 * power;
        p.snapY += -Math.sign(across || 1) * 0.15 * power;
      }
    }
    this.d.session.emit('punch', { z: zone, p: Math.round(power * 100) / 100, b: blocked ? 1 : 0, sl: slap ? 1 : 0, d: dir.toArray().map((x) => Math.round(x * 100) / 100) });
  }

  /** You got hit. */
  private takeHit(f: Friend, data: Record<string, unknown>) {
    if (this.ko > 0) return;
    const zone: Zone = data.z === 'head' ? 'head' : 'body';
    const power = THREE.MathUtils.clamp(Number(data.p) || 0.5, 0.1, 1);
    const blocked = !!data.b;
    const slap = !!data.sl;
    this.last = { id: f.id, name: f.name, t: this.time };
    const r = this.d.you.hurt({ zone, power, blocked, slap });
    this.d.sound.playLocal(slap ? 'slap' : blocked ? 'block' : 'punch', blocked ? 0.6 : 0.9);
    if (r.ko) {
      this.d.hud.toast(`${f.name} knocked you out!`, 'warn');
      this.d.session.emit('ouch', { hp: 0, ko: 1 });
      return;
    }
    if (slap) this.d.hud.toast(`${f.name} slapped you!`, 'warn');
    else if (!blocked && zone === 'head' && power > 0.6) this.d.hud.toast(`Big shot from ${f.name}!`, 'warn');
    this.d.session.emit('ouch', { hp: Math.round(this.hp) });
  }

  /** Their stamina as they last told you (for a scoreboard), or null if no fight yet. */
  their(id: string) {
    return this.theirs.get(id) ?? null;
  }

  dispose() {
    removeEventListener('keydown', this.onKey);
  }
}

/** Where a friend's head and chest are (from their avatar's bones). */
function targets(f: Friend): { head: THREE.Vector3; chest: THREE.Vector3 } | null {
  const p = f.person;
  const b = p?.rig?.bones;
  if (!p || p.culled) return null;
  if (b?.Head && b?.Chest) {
    const head = b.Head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.08, 0));
    const chest = b.Chest.getWorldPosition(new THREE.Vector3());
    return { head, chest };
  }
  const h = p.pos.y + (Number(f.state.hh) || 1.6) - (Number(f.state.cr) || 0);
  return { head: new THREE.Vector3(p.pos.x, h, p.pos.z), chest: new THREE.Vector3(p.pos.x, h - 0.45, p.pos.z) };
}

function distToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const ab = b.clone().sub(a);
  const t = ab.lengthSq() > 1e-9 ? THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1) : 0;
  return a.clone().addScaledVector(ab, t).distanceTo(p);
}
