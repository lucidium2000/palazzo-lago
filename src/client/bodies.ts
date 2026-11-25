import * as THREE from 'three';
import type { Crowd, Person } from './people';
import type { Player } from './player';
import { RADIUS } from './player';
import type { World } from './world';
import type { Session } from './net/session';
import type { Hand, Hands } from './hands';
import { BODY_R, BUMP_SPEED, PUSH_HOLD, capsuleDepth, handInto, handShove, separate, shoveDistance, shoveProgress, stepAgainst } from './push';

/**
 * People are solid. You meet resistance when you walk into someone (you slow
 * down and slide around them), and if you keep pushing, or run into them,
 * they get shoved: a stumble back, a turn toward you, maybe a word. In VR your
 * hands can push people too. Guests never end up inside each other, and a
 * friend in a two-player room gets nudged on their side (their position is
 * theirs to move): see `FriendShove`.
 */

/** People who stay put however you push: seated, behind a counter or a table, at the piano. */
const ROOTED = new Set(['croupier', 'bartender', 'pianist', 'slots', 'patron']);
export const movable = (p: Person) => !p.seated && !p.driven && !ROOTED.has(p.role);

interface Shove {
  /** Accumulated pushing (seconds) and cool-down before the next reaction. */
  pushT: number;
  lastPush: number;
  cool: number;
  /** The shove in progress: direction, distance, time. */
  dx: number;
  dz: number;
  dist: number;
  t: number;
  T: number;
  /** Turned toward you until then (seconds left). */
  faceT: number;
  faceYaw: number;
  /** Where they were standing (static people drift back once you're gone). */
  homeX: number;
  homeZ: number;
  home: boolean;
  /** When they last made a sound about it (not a gasp every half second). */
  lastSound: number;
}

export interface BodiesDeps {
  crowd: Crowd;
  world: World;
  player: Player;
  hands: Hands;
  /** Someone reacts out loud (strength 0..1): a breath, a word if one's recorded. */
  onBump?(p: Person, strength: number): void;
  /** You pushed your friend: send it to their game (dx, dz metres). */
  onPushFriend?(p: Person, dx: number, dz: number): void;
}

const SHOVE_T = 0.38;

/** What your crew says when you bump them (lines they already have recorded, see speech.ts). */
export const BUMP_LINES = ['Whoa!', 'Ouch.', 'Easy there, champ!'];

export class Bodies {
  private cap = 0;
  private flat = new Float32Array(0);
  private press = new Float32Array(0);
  private near: Person[] = [];
  /** People you pushed into during this frame's step (and how far, metres). */
  private contact: Person[] = [];
  private contactPress = new Float32Array(0);
  private contactN = 0;
  private xs = new Float32Array(0);
  private zs = new Float32Array(0);
  private rs = new Float32Array(0);
  private mass = new Float32Array(0);
  private cx = new Float32Array(0);
  private cz = new Float32Array(0);
  private state = new Map<Person, Shove>();
  private time = 0;
  private friendCool = 0;
  private hp = new THREE.Vector3();
  /** Overlapping pairs found last frame (for tests and the stats line). */
  overlaps = 0;

  constructor(private d: BodiesDeps) {
    d.player.bodies = (x, z, dx, dz, out) => this.step(x, z, dx, dz, out);
  }

  private ensure(n: number) {
    if (n <= this.cap) return;
    const c = Math.max(n, this.cap * 2, 32);
    this.cap = c;
    this.flat = new Float32Array(c * 3);
    this.press = new Float32Array(c);
    this.contactPress = new Float32Array(c);
    this.xs = new Float32Array(c + 1);
    this.zs = new Float32Array(c + 1);
    this.rs = new Float32Array(c + 1);
    this.mass = new Float32Array(c + 1);
    this.cx = new Float32Array(c + 1);
    this.cz = new Float32Array(c + 1);
  }

  /** Your walking step against the people around you (called by the player). */
  private step(x: number, z: number, dx: number, dz: number, out: { dx: number; dz: number }) {
    const people = this.d.crowd.people;
    this.ensure(people.length);
    let n = 0;
    const reach = 0.6 + Math.hypot(dx, dz);
    for (const p of people) {
      if (p.culled) continue;
      if (Math.abs(p.pos.x - x) > reach || Math.abs(p.pos.z - z) > reach) continue;
      this.flat[n * 3] = p.pos.x;
      this.flat[n * 3 + 1] = p.pos.z;
      this.flat[n * 3 + 2] = BODY_R;
      this.near[n] = p;
      n++;
    }
    stepAgainst(x, z, dx, dz, RADIUS, this.flat, n, this.press, out);
    for (let i = 0; i < n; i++) {
      if (this.press[i] <= 0) continue;
      this.contact[this.contactN] = this.near[i];
      this.contactPress[this.contactN++] = this.press[i];
    }
  }

  private st(p: Person): Shove {
    let s = this.state.get(p);
    if (!s) {
      s = { pushT: 0, lastPush: -9, cool: 0, dx: 0, dz: 0, dist: 0, t: 1, T: SHOVE_T, faceT: 0, faceYaw: 0, homeX: p.pos.x, homeZ: p.pos.z, home: false, lastSound: -99 };
      this.state.set(p, s);
    }
    return s;
  }

  /**
   * Shoves `p` by `dist` metres along (ux, uz) (a unit vector), and they react
   * with `strength` 0..1 (a stumble, a turn toward `from`, maybe a word).
   */
  shove(p: Person, ux: number, uz: number, dist: number, strength: number, from: THREE.Vector3) {
    const s = this.st(p);
    if (p.driven) {
      if (this.friendCool <= 0) {
        this.friendCool = 0.45;
        this.d.onPushFriend?.(p, ux * dist, uz * dist);
      }
      return;
    }
    const canMove = movable(p);
    if (canMove) {
      if (!s.home && (p.role === 'chat' || p.role === 'watch')) {
        s.home = true;
        s.homeX = p.pos.x;
        s.homeZ = p.pos.z;
      }
      s.dx = ux;
      s.dz = uz;
      s.dist = dist;
      s.t = 0;
      s.T = SHOVE_T + dist * 0.25;
      // Walkers stop to take it in.
      if (p.role === 'wander' || p.role === 'waiter') p.pause = Math.max(p.pause, 1.2 + strength);
    }
    // Stumble (the HitRecieve clip), look at whoever did it, turn toward them.
    p.gaspT = Math.max(p.gaspT, canMove ? 0.35 + 0.65 * strength : 0.3 + 0.3 * strength);
    p.attendUntil = Math.max(p.attendUntil, this.d.crowd.now + 1.5 + strength * 1.5);
    if (canMove) {
      s.faceT = 1.2 + strength;
      s.faceYaw = Math.atan2(from.x - p.pos.x, from.z - p.pos.z);
    }
    // Rooted people (seated, behind a counter) just give you a look, once in a while.
    s.cool = canMove ? 0.5 : 2.5;
    if (strength >= 0.6 || this.time - s.lastSound > 3) {
      s.lastSound = this.time;
      this.d.onBump?.(p, strength);
    }
  }

  update(dt: number) {
    this.time += dt;
    this.friendCool = Math.max(0, this.friendCool - dt);
    const { player, crowd } = this.d;
    const feet = player.feet();
    const speed = player.speed;
    for (const s of this.state.values()) s.cool = Math.max(0, s.cool - dt);

    // 1. You walked into people this frame: resistance already happened; now they give way.
    for (let k = 0; k < this.contactN; k++) {
      const p = this.contact[k];
      const s = this.st(p);
      const pressSpeed = this.contactPress[k] / Math.max(dt, 1e-3);
      if (pressSpeed > 0.15) {
        s.pushT = this.time - s.lastPush < 0.2 ? s.pushT + dt : dt;
        s.lastPush = this.time;
      }
      if (s.cool > 0) continue;
      const bump = speed >= BUMP_SPEED;
      if (!bump && s.pushT < PUSH_HOLD) continue;
      let ux = p.pos.x - feet.x,
        uz = p.pos.z - feet.z;
      const l = Math.hypot(ux, uz) || 1;
      ux /= l;
      uz /= l;
      const strength = bump ? Math.min(1, 0.6 + (speed - BUMP_SPEED) * 0.3) : Math.min(0.55, 0.25 + speed * 0.15);
      this.shove(p, ux, uz, shoveDistance(speed), strength, feet);
      s.pushT = 0;
      // Keep pushing and they keep stepping back (a little less eagerly each time).
      s.cool = Math.max(s.cool, bump ? 0.9 : 0.45);
    }
    this.contactN = 0;

    // 2. VR hands pushing into bodies.
    if (player.inXR) for (const h of this.d.hands.hands) this.handPush(h);

    // 3. Shoves in progress, turning toward you, and drifting back to where they stood.
    for (const [p, s] of this.state) {
      if (s.t < s.T) {
        const k = shoveProgress(s.t + dt, s.T) - shoveProgress(s.t, s.T);
        s.t += dt;
        const sx = s.dx * s.dist * k,
          sz = s.dz * s.dist * k;
        const [nx, nz] = this.d.world.move(p.pos.x, p.pos.z, sx, sz, 0.22);
        const moved = Math.hypot(nx - p.pos.x, nz - p.pos.z);
        p.pos.x = nx;
        p.pos.z = nz;
        // Against a wall or a table: they stop there.
        if (moved < Math.hypot(sx, sz) * 0.3) s.t = s.T;
      }
      if (s.faceT > 0) {
        s.faceT -= dt;
        turn(p, s.faceYaw, dt * 5);
      } else if (s.home && s.t >= s.T && p.pause <= 0) {
        // Static guests step back into their spot (their circle) once you're out of the way.
        const hx = s.homeX - p.pos.x,
          hz = s.homeZ - p.pos.z;
        const hd = Math.hypot(hx, hz);
        const clear = Math.hypot(s.homeX - feet.x, s.homeZ - feet.z) > 0.75;
        if (hd > 0.03 && clear) {
          const k = Math.min(hd, 0.45 * dt) / hd;
          const [nx, nz] = this.d.world.move(p.pos.x, p.pos.z, hx * k, hz * k, 0.22);
          p.pos.x = nx;
          p.pos.z = nz;
          p.moving = 0.45;
        } else {
          p.moving = Math.max(0, p.moving - dt * 3);
          if (hd <= 0.03) turn(p, p.homeYaw, dt * 3);
        }
      }
    }

    // 4. Nobody inside anybody: push overlapping people apart (you and rooted people don't budge).
    const people = crowd.people;
    const n = people.length;
    this.ensure(n);
    for (let i = 0; i < n; i++) {
      const p = people[i];
      this.xs[i] = p.pos.x;
      this.zs[i] = p.pos.z;
      this.rs[i] = BODY_R;
      this.mass[i] = movable(p) ? 1 : 0;
    }
    let m = n;
    if (!player.seated) {
      this.xs[m] = feet.x;
      this.zs[m] = feet.z;
      this.rs[m] = RADIUS;
      this.mass[m] = 0;
      m++;
    }
    this.overlaps = separate(this.xs, this.zs, this.rs, this.mass, m, this.cx, this.cz);
    if (this.overlaps > 0) {
      for (let i = 0; i < n; i++) {
        let cx = this.cx[i],
          cz = this.cz[i];
        if (cx === 0 && cz === 0) continue;
        // At most a brisk step per frame: people make room, they don't pop.
        const l = Math.hypot(cx, cz);
        const max = 1.5 * dt + 0.01;
        if (l > max) {
          cx *= max / l;
          cz *= max / l;
        }
        const p = people[i];
        const [nx, nz] = this.d.world.move(p.pos.x, p.pos.z, cx, cz, 0.22);
        p.pos.x = nx;
        p.pos.z = nz;
      }
    }
  }

  /** A VR hand moving into someone's body pushes them (gently) that way. */
  private handPush(h: Hand) {
    if (h.ctrl.userData.connected === false) return;
    h.grip.updateMatrixWorld(true);
    const hp = this.hp.setFromMatrixPosition(h.grip.matrixWorld);
    if (hp.lengthSq() === 0) return;
    const people = this.d.crowd.people;
    for (const p of people) {
      if (p.culled) continue;
      const ox = hp.x - p.pos.x,
        oz = hp.z - p.pos.z;
      if (Math.abs(ox) > 0.45 || Math.abs(oz) > 0.45) continue;
      const k = p.look.height / 1.75;
      const y0 = p.pos.y + (p.seated ? p.seatY - 0.1 : 0.5 * k);
      const y1 = p.pos.y + (p.seated ? p.seatY + 0.55 * k : 1.42 * k);
      if (capsuleDepth(hp.x, hp.y, hp.z, p.pos.x, p.pos.z, y0, y1, 0.2) <= 0) continue;
      const s = this.st(p);
      if (s.cool > 0) continue;
      const v = this.d.hands.velocity(h);
      const into = handInto(v.x, v.z, ox, oz);
      if (into < 0.5) continue;
      const vl = Math.hypot(v.x, v.z) || 1;
      this.shove(p, v.x / vl, v.z / vl, handShove(into), Math.min(0.5, 0.15 + into * 0.12), this.d.player.feet());
      s.cool = Math.max(s.cool, 0.7);
      this.d.hands.onHaptic?.(h, Math.min(0.6, 0.25 + into * 0.1), 40);
    }
  }
}

function turn(p: Person, yaw: number, k: number) {
  let dy = yaw - p.yaw;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  p.yaw += dy * Math.min(1, k);
}

/**
 * Two-player shoves: when you push your friend's avatar, their game moves
 * THEIR player (it's their position); when they push you, yours does, with a
 * buzz in the controllers.
 */
export type FriendShoveSession = Pick<Session, 'emit' | 'on'>;

export const SHOVE_EVENT = 'shove';

/** Wires the shove event both ways. Returns the function that sends a push. */
export function friendShove(session: FriendShoveSession, player: Player, haptic?: (side: 'left' | 'right', strength: number, ms: number) => void) {
  session.on(SHOVE_EVENT, (_f, d) => {
    const dx = Number(d.x),
      dz = Number(d.z);
    if (!Number.isFinite(dx) || !Number.isFinite(dz)) return;
    // Never more than half a metre, whatever arrives.
    const l = Math.hypot(dx, dz);
    const k = l > 0.5 ? 0.5 / l : 1;
    player.nudge(dx * k, dz * k, 0.25);
    const s = Math.min(1, 0.35 + l);
    haptic?.('left', s, 90);
    haptic?.('right', s, 90);
  });
  return (dx: number, dz: number) => session.emit(SHOVE_EVENT, { x: Math.round(dx * 100) / 100, z: Math.round(dz * 100) / 100 });
}
