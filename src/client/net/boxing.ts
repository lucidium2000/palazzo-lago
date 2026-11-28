import * as THREE from 'three';
import type { Friend, Session } from './session';
import type { Hands } from '../hands';
import type { Sound } from '../audio';
import type { Hud } from '../hud';
import type { Player } from '../player';
import type { You } from '../fight/you';
import { boneFromPose, handSide, headTurn, slapSnap, type SlapDetector } from '../fight/slap';
import { punchImpact, speedOf } from '../fight/impact';

/**
 * Boxing with your friend. In VR, make a fist and throw a real punch: a fast
 * fist that lands on their head or body is a hit (their own hand in the way
 * is a block). On a screen, B throws a jab at whoever is right in front of
 * you. Hits flash red, thump and buzz; each of you has stamina that comes
 * back if you stop getting hit, and if it runs out, you're knocked down for a
 * moment, then back on your feet.
 *
 * An open hand (palm or back) smacked into their face is a slap (measured
 * like a guest's, fight/slap.ts): a sharp clap, their head snaps the way your
 * hand went, a red cheek; on their side a sting, a red flare on that side of
 * their view, their head jolted, a buzz. A sting more than damage. On a
 * screen, Y slaps the friend right in front of you.
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
  /** Hands on faces (fight/slap.ts), fed each frame by main.ts (sampleHands). */
  faces?: SlapDetector;
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

  /** Fight mode (fight/fights.ts): do punches with this friend count right now (not before the bell, not between rounds)? */
  gate: ((friendId: string) => boolean) | null = null;
  /** Fight mode: a punch landed between you and this friend (either way): it may start a match. */
  onExchange: ((friendId: string, name: string) => void) | null = null;
  /** Fight mode: your hands up by your face (most of a punch's damage blocked). */
  guardUp: (() => boolean) | null = null;
  /** Fight mode: a big hit (the bars shake, a freeze of a couple of frames). */
  onImpact: ((k: number) => void) | null = null;

  /** A new round: they're back to full (their own machine resets them; this is what we know of it). */
  setTheirs(id: string, hp: number) {
    this.theirs.set(id, Math.max(0, Math.min(100, hp)));
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

  /** The friend right in front of you (within `range` m), on a screen. */
  private inFront(range: number): { f: Friend; to: THREE.Vector3 } | null {
    const me = this.d.player.feet();
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(this.d.camera.getWorldQuaternion(new THREE.Quaternion()));
    look.y = 0;
    look.normalize();
    for (const f of this.d.session.friendList()) {
      const p = f.person;
      if (!p) continue;
      const to = new THREE.Vector3(p.pos.x - me.x, 0, p.pos.z - me.z);
      const dist = to.length();
      if (dist > range || dist < 0.05 || to.normalize().dot(look) < 0.8) continue;
      return { f, to };
    }
    return null;
  }

  /** Is a friend right in front of you, close enough to slap (a screen)? */
  canSlap() {
    return this.ko <= 0 && !!this.inFront(1.1);
  }

  /** Desktop/phone: a slap (right hand, across their face) for the friend right in front of you. Whether there was one. */
  deskSlap(): boolean {
    if (this.ko > 0) return false;
    const t = this.inFront(1.1);
    if (!t) return false;
    this.d.session.emit('jab', { s: 'r' });
    // Your right hand going to your left, a little forward: (to.z, -to.x) is your left facing them.
    const dir = new THREE.Vector3(t.to.z * 3.2 + t.to.x * 1.2, 0, -t.to.x * 3.2 + t.to.z * 1.2).normalize();
    this.land(t.f, 'head', 0.55, dir, false, null, true);
    return true;
  }

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
      const fist = (side === 'left' ? g.l : g.r) >= 0.55;
      const v = this.d.hands.velocity(hand);
      const speed = v.length();
      // An open hand meeting their face: a slap if it's fast into it (fight/slap.ts; once per contact).
      if (!fist) {
        const faces = this.d.faces;
        if (!faces) continue;
        const id = handSide(hand);
        for (const f of friends) {
          const p = f.person;
          const bone = p && !p.culled ? headBone(f, this.bone) : null;
          if (!bone) continue;
          const hit = faces.contact(id, p!, bone);
          if (!hit) continue;
          if (hit.kind === 'slap') {
            this.land(f, 'head', hit.power, hit.v.clone().normalize(), false, side, true, hit.side);
          } else if (hit.kind === 'punch') {
            // A hand-tracked fist (no grip button): a punch to the head after all.
            this.cool.set(key, COOLDOWN);
            this.land(f, 'head', THREE.MathUtils.clamp((hit.v.length() - 1.6) / 4, 0.2, 1), hit.v.clone().normalize(), false, side);
          } else if (hit.kind === 'touch') this.d.haptic(side, 0.08 + 0.17 * hit.strength, 15);
          break;
        }
        continue;
      }
      if ((this.cool.get(key) ?? 0) > 0) continue;
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

  private bone = new THREE.Matrix4();

  /** Your punch (or slap) lands on a friend (as you see it). `cheek`: a slap's side of their face (0 their left, 1 their right). */
  private land(f: Friend, zone: Zone, power: number, dir: THREE.Vector3, blocked: boolean, side: 'left' | 'right' | null, slap = false, cheek?: 0 | 1) {
    // Fight mode: before the bell or between rounds, a punch at your opponent doesn't count.
    if (!slap && this.gate && !this.gate(f.id)) {
      this.d.sound.playLocal('block', 0.3);
      return;
    }
    if (side) this.d.haptic(side, blocked ? 0.4 : slap ? 0.35 + power * 0.65 : 0.6 + power * 0.4, blocked ? 40 : slap ? 25 + 35 * power : 70);
    this.last = { id: f.id, name: f.name, t: this.time };
    if (!slap && !blocked) this.onExchange?.(f.id, f.name);
    cheek = this.reel(f, zone, power, dir, blocked, slap, cheek);
    this.d.session.emit('punch', {
      // Who it's for (everyone else in the room just sees it).
      to: f.id,
      z: zone,
      p: Math.round(power * 100) / 100,
      b: blocked ? 1 : 0,
      sl: slap ? 1 : 0,
      d: dir.toArray().map((x) => Math.round(x * 100) / 100),
      ...(slap && cheek !== undefined ? { cs: cheek } : {}),
    });
  }

  /** A friend's avatar takes a blow (as anyone in the room sees it): the sound at them, the head snapping, a red cheek. Returns the cheek a slap hit. */
  private reel(f: Friend, zone: Zone, power: number, dir: THREE.Vector3, blocked: boolean, slap: boolean, cheek?: 0 | 1): 0 | 1 | undefined {
    const at = targets(f)?.[zone === 'head' ? 'head' : 'chest'] ?? f.person?.pos.clone().setY(1.3);
    if (at) {
      if (slap && !blocked) this.d.sound.play('slap', at, { volume: 0.75 + power * 0.85, rate: 0.9 + power * 0.25 + Math.random() * 0.06, ref: 1.6 + power });
      else this.d.sound.play(slap ? 'slap' : blocked ? 'block' : 'punch', at, { volume: 0.6 + power * 0.5, rate: 0.9 + Math.random() * 0.2 });
    }
    // Their avatar reels (they see the real hit on their side).
    const p = f.person;
    if (p && !blocked) {
      p.gaspT = 0.6 + power * 0.5;
      const across = -dir.x * Math.cos(p.yaw) + dir.z * Math.sin(p.yaw);
      if (slap) {
        const sn = slapSnap(dir, p.yaw, power);
        p.snapY += sn.yaw;
        p.snapX += sn.pitch;
        p.blush = Math.max(p.blush, 3 + 5 * power);
        cheek ??= sn.side;
        p.blushSide = cheek;
      } else if (zone === 'head') {
        p.snapX += 0.25 + 0.3 * power;
        p.snapY += -Math.sign(across || 1) * 0.15 * power;
      }
    }
    return cheek;
  }

  /** You got hit. */
  private takeHit(f: Friend, data: Record<string, unknown>) {
    const zone: Zone = data.z === 'head' ? 'head' : 'body';
    const power = THREE.MathUtils.clamp(Number(data.p) || 0.5, 0.1, 1);
    const blocked = !!data.b;
    const slap = !!data.sl;
    // Someone else in the room got it: we see it on their avatar.
    if (typeof data.to === 'string' && data.to !== this.d.session.selfId) {
      const victim = this.d.session.friendList().find((x) => x.id === data.to);
      const d = Array.isArray(data.d) ? data.d.map(Number) : [];
      if (victim) this.reel(victim, zone, power, new THREE.Vector3(d[0] || 0, d[1] || 0, d[2] || 0), blocked, slap, data.cs === 0 || data.cs === 1 ? data.cs : undefined);
      return;
    }
    if (this.ko > 0) return;
    this.last = { id: f.id, name: f.name, t: this.time };
    // Fight mode: not before the bell, not between rounds.
    if (!slap && this.gate && !this.gate(f.id)) return;
    // A punch: its damage from its speed and where it landed (impact.ts); your hands up by your face take most of it.
    let hurt: Parameters<You['hurt']>[0] = { zone, power, blocked, slap };
    if (!slap) {
      const guard = blocked || !!this.guardUp?.();
      const imp = punchImpact({ speed: Number(data.sp) || speedOf(power), spot: guard ? 'guard' : zone });
      hurt = { zone, power: imp.power, blocked: guard, amount: imp.damage, crit: imp.crit };
      if (!guard) this.onImpact?.(imp.crit ? 0.9 : imp.power * 0.8);
      if (!guard) this.onExchange?.(f.id, f.name);
    }
    const r = this.d.you.hurt(hurt);
    if (slap) {
      // You feel it: a loud smack right at your face, a red flare on that side, your head knocked the way their hand went.
      this.d.sound.playLocal('slap', Math.min(1.6, 0.9 + power * 0.7), 0.9 + power * 0.25);
      const d = Array.isArray(data.d) ? data.d.map(Number) : [];
      const dir = new THREE.Vector3(d[0] || 0, d[1] || 0, d[2] || 0);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.d.camera.getWorldQuaternion(new THREE.Quaternion()));
      const myYaw = Math.atan2(fwd.x, fwd.z);
      const turn = headTurn(dir, myYaw, 0.08 + 0.14 * power);
      const cheek = data.cs === 0 || data.cs === 1 ? data.cs : turn.side;
      this.d.you.sting(cheek === 0 ? 'left' : 'right', power);
      this.d.player.jolt(turn.yaw, dir.x, dir.z, 0.015 + 0.025 * power);
    } else this.d.sound.playLocal(hurt.blocked ? 'block' : 'punch', hurt.blocked ? 0.6 : 0.9);
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

/** A friend's head bone (world), or one made up from where their avatar stands and how tall they are. */
function headBone(f: Friend, out: THREE.Matrix4): THREE.Matrix4 | null {
  const p = f.person;
  if (!p) return null;
  const head = p.rig?.bones?.Head;
  if (head) {
    head.updateWorldMatrix(true, false);
    return out.copy(head.matrixWorld);
  }
  const eye = p.pos.y + (Number(f.state.hh) || 1.6) - (Number(f.state.cr) || 0);
  return boneFromPose(out, p.pos.x, eye - 0.1, p.pos.z, p.yaw);
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
