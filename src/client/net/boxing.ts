import * as THREE from 'three';
import type { Friend, Session } from './session';
import type { Hands } from '../hands';
import type { Sound } from '../audio';
import type { Hud } from '../hud';
import type { Player } from '../player';

/**
 * Boxing with your friend. In VR, make a fist and throw a real punch: a fast
 * fist that lands on their head or body is a hit (their own hand in the way
 * is a block). On a screen, B throws a jab at whoever is right in front of
 * you. Hits flash red, thump and buzz; each of you has stamina that comes
 * back if you stop getting hit, and if it runs out, you're knocked down for a
 * moment, then back on your feet.
 *
 * Each player owns their own stamina; the one who throws decides whether a
 * punch landed (they see their fist and your avatar), the one who gets hit
 * takes the damage and tells the other how they're doing.
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
}

type Zone = 'head' | 'body';

export class Boxing {
  /** Your stamina (0..100). */
  hp = 100;
  private sinceHit = 99;
  private ko = 0;
  private cool = new Map<string, number>();
  private prevHand = new Map<string, THREE.Vector3>();
  private flash: THREE.Mesh;
  private flashA = 0;
  private dark = 0;
  /** What you know of your friends' stamina (they tell you after each hit). */
  private theirs = new Map<string, number>();
  private jabSide: 'l' | 'r' = 'l';
  private time = 0;

  constructor(private d: BoxingDeps) {
    // A red (or, when knocked down, dark) veil over your eyes, on the camera.
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 20, 64, 64, 92);
    grad.addColorStop(0, 'rgba(255,255,255,0.15)');
    grad.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.6, 0.6),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), color: 0xc00010, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
    );
    this.flash.position.z = -0.12;
    this.flash.renderOrder = 2000;
    this.flash.visible = false;
    this.flash.raycast = () => {};
    d.camera.add(this.flash);

    d.session.on('punch', (f, data) => this.takeHit(f, data));
    d.session.on('ouch', (f, data) => {
      this.theirs.set(f.id, Math.max(0, Math.min(100, Number(data.hp) || 0)));
      if (data.ko) {
        this.d.hud.toast(`You knocked ${f.name} down!`, 'win');
        if (f.person) f.person.gaspT = 2.5;
      }
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

  update(dt: number) {
    this.time += dt;
    for (const [k, v] of this.cool) this.cool.set(k, v - dt);
    this.sinceHit += dt;
    // Stamina comes back once you stop getting hit.
    if (this.sinceHit > 2.5 && this.hp < 100 && this.ko <= 0) this.hp = Math.min(100, this.hp + 12 * dt);
    if (this.ko > 0) {
      this.ko -= dt;
      if (this.ko <= 0) {
        this.hp = 100;
        this.d.hud.toast('Back on your feet!', 'info');
        this.d.session.emit('ouch', { hp: this.hp });
      }
    }
    // The veil: red flashes fade fast; a knockdown dims the world, then lifts.
    this.flashA = Math.max(0, this.flashA - dt * 2.4);
    this.dark = this.ko > 0 ? Math.min(0.85, this.dark + dt * 2) : Math.max(0, this.dark - dt * 1.2);
    const m = this.flash.material as THREE.MeshBasicMaterial;
    const a = Math.max(this.flashA, this.dark);
    this.flash.visible = a > 0.01;
    m.opacity = a;
    m.color.set(this.dark > this.flashA ? 0x100808 : 0xc00010);
    if (this.d.player.inXR && this.ko <= 0) this.vrPunches();
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
      if ((side === 'left' ? g.l : g.r) < 0.55) continue; // only a fist
      if ((this.cool.get(key) ?? 0) > 0) continue;
      const v = this.d.hands.velocity(hand);
      const speed = v.length();
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
  private land(f: Friend, zone: Zone, power: number, dir: THREE.Vector3, blocked: boolean, side: 'left' | 'right' | null) {
    const at = targets(f)?.[zone === 'head' ? 'head' : 'chest'] ?? f.person?.pos.clone().setY(1.3);
    if (at) this.d.sound.play(blocked ? 'block' : 'punch', at, { volume: 0.6 + power * 0.5, rate: 0.9 + Math.random() * 0.2 });
    if (side) this.d.haptic(side, blocked ? 0.4 : 0.6 + power * 0.4, blocked ? 40 : 70);
    // Their avatar reels (they see the real hit on their side).
    if (f.person && !blocked) {
      f.person.gaspT = 0.6 + power * 0.5;
      if (zone === 'head') f.person.headYaw += (Math.random() < 0.5 ? -1 : 1) * 0.5 * power;
    }
    this.d.session.emit('punch', { z: zone, p: Math.round(power * 100) / 100, b: blocked ? 1 : 0, d: dir.toArray().map((x) => Math.round(x * 100) / 100) });
  }

  /** You got hit. */
  private takeHit(f: Friend, data: Record<string, unknown>) {
    if (this.ko > 0) return;
    const zone: Zone = data.z === 'head' ? 'head' : 'body';
    const power = THREE.MathUtils.clamp(Number(data.p) || 0.5, 0.1, 1);
    const blocked = !!data.b;
    const dmg = (zone === 'head' ? 20 : 11) * power * (blocked ? 0.2 : 1);
    this.hp = Math.max(0, this.hp - dmg);
    this.sinceHit = 0;
    this.d.sound.playLocal(blocked ? 'block' : 'punch', blocked ? 0.6 : 0.9);
    this.flashA = Math.min(0.75, this.flashA + (blocked ? 0.12 : 0.3 + power * 0.35));
    for (const s of ['left', 'right'] as const) this.d.haptic(s, blocked ? 0.3 : 0.5 + power * 0.5, blocked ? 50 : 110);
    if (this.hp <= 0) {
      this.ko = 3;
      this.d.hud.toast(`${f.name} knocked you down!`, 'warn');
      this.d.session.emit('ouch', { hp: 0, ko: 1 });
      return;
    }
    if (!blocked && zone === 'head' && power > 0.6) this.d.hud.toast(`Big shot from ${f.name}!`, 'warn');
    this.d.session.emit('ouch', { hp: Math.round(this.hp) });
  }

  /** Their stamina as they last told you (for a scoreboard), or null if no fight yet. */
  their(id: string) {
    return this.theirs.get(id) ?? null;
  }

  dispose() {
    removeEventListener('keydown', this.onKey);
    this.flash.removeFromParent();
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
