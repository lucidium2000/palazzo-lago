import * as THREE from 'three';
import type { Crowd, Person } from './people';
import type { Player } from './player';
import { RADIUS } from './player';
import type { World } from './world';
import type { Session } from './net/session';
import type { Hand, Hands } from './hands';
import { BODY_R, BUMP_SPEED, SLIDE, SOFT, Wedge, YIELD_HOLD, YIELD_STEP, capsuleDepth, handInto, handShove, separate, shoveDistance, shoveProgress, stepAgainst, yieldDirs } from './push';
import { knocksOffSeat, stepUnseat, unseat, UNSEAT, walking, type Unseat } from './seatshove';
import { SLAP, SlapDetector, handSide, sampleHands, type FaceHit } from './fight/slap';

/**
 * People are solid. You meet resistance when you walk into someone (you slow
 * down and slide around them), and if you keep pushing, or run into them,
 * they get shoved: a stumble back, a turn toward you, maybe a word. In VR your
 * hands can push people too. Guests never end up inside each other, and a
 * friend in a two-player room gets nudged on their side (their position is
 * theirs to move): see `FriendShove`.
 *
 * Walking into a crowd, people make way: whoever you press into steps aside
 * (or back) out of your path, nudging whoever they bump in turn, and if you
 * still get wedged (trying to walk, getting nowhere, for WEDGE_T) the crowd
 * gives: you squeeze on through, slowly, like through a concert crowd (walls
 * and furniture stay solid: that's world.ts). Friends' avatars walking
 * through the crowd part it the same way on this machine. Out loud, it's a
 * line now and then across the whole crowd, gasps in between.
 */

/** People who stay put however you push: seated, behind a counter or a table, at the piano. */
const ROOTED = new Set(['croupier', 'bartender', 'pianist', 'slots', 'patron']);
/** Seated guests a hard enough shove knocks off their seat (staff behind counters aren't seated), and the pianist off his bench. */
const UNSEATABLE = new Set(['slots', 'patron', 'pianist']);
export const movable = (p: Person) => !p.seated && !p.driven && (!ROOTED.has(p.role) || p.offSeat);
/** Could a hard shove or a punch knock this person off their seat? */
export const unseatable = (p: Person) => p.seated && !p.driven && !p.keepSeat && !p.offSeat && UNSEATABLE.has(p.role);

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
  /** The motion in progress is making way (a sidestep: walking legs, no stumble). */
  yield: boolean;
}

/** At most one spoken line (about being pushed) this often across the whole crowd (s), and a gasp this often. */
export const LINE_GAP = 4;
export const GASP_GAP = 0.7;
/** How many people one push can pass on to in a frame (a path opens; the whole crowd doesn't ripple). */
const CHAIN = 10;
/** How far a push passes on (you → them → whoever they bump → whoever they bump). */
const CHAIN_GEN = 2;

export interface BodiesDeps {
  crowd: Crowd;
  world: World;
  player: Player;
  hands: Hands;
  /**
   * Someone reacts (strength 0..1), out loud as `say`s: a word if one's
   * recorded ('line', at most one every LINE_GAP across the whole crowd), a
   * breath ('gasp', at most one every GASP_GAP), or nothing just now ('none':
   * it still counts, e.g. toward losing their temper).
   */
  onBump?(p: Person, strength: number, say: 'line' | 'gasp' | 'none'): void;
  /** A fist (or a very fast hand) landed on someone: power 0..1, where it landed, head or body, the hand's velocity. */
  onPunch?(p: Person, power: number, at: THREE.Vector3, zone: 'head' | 'body', v: THREE.Vector3): void;
  /** An open hand (palm or back) smacked into someone's face: power 0..1, where, the hand's velocity (relative to their head), and the contact. */
  onSlap?(p: Person, power: number, at: THREE.Vector3, v: THREE.Vector3, hit?: FaceHit): void;
  /** A hand touched someone's face too gently to be a slap (a graze, a pat): `hit.strength` 0..1. */
  onFaceTouch?(p: Person, hit: FaceHit): void;
  /**
   * The hands-on-faces detector (fight/slap.ts), shared with boxing.ts. When
   * given, whoever owns it feeds it the hands each frame (sampleHands);
   * without it, Bodies keeps its own and feeds it.
   */
  faces?: SlapDetector;
  /** In a fight (fight/): punches don't shove them around (the fight handles the knock-back). */
  fighting?(p: Person): boolean;
  /** Is this hand making a fist (grip squeezed)? */
  isFist?(h: Hand): boolean;
  /** You pushed your friend: send it to their game (dx, dz metres). */
  onPushFriend?(p: Person, dx: number, dz: number): void;
  /** Someone was knocked off their seat here (not from a friend's game): pushed along (ux, uz). */
  onUnseat?(p: Person, ux: number, uz: number, power: number, punch: boolean): void;
  /** Someone knocked off their seat sat back down. */
  onReseat?(p: Person): void;
  /** Is their seat taken by someone the crowd doesn't know about (you, sitting at a game there)? */
  seatTaken?(x: number, z: number): boolean;
}

const SHOVE_T = 0.38;
/** An open hand into a face faster than this (m/s, along the contact normal: see fight/slap.ts) is a slap; slower is a touch. */
export const SLAP_SPEED = SLAP.speed;
/** A closed fist faster than this (m/s) is a punch (any hand faster than PUNCH_ANY). */
export const PUNCH_SPEED = 1.9;
export const PUNCH_ANY = 3.2;

/** What a fast hand meeting someone's head is: a punch, a slap, or just a touch (the full grading is fight/slap.ts gradeTouch). */
export function faceContact(speed: number, fist: boolean): 'punch' | 'slap' | null {
  if (fist && speed > PUNCH_SPEED) return 'punch';
  if (!fist && speed >= SLAP_SPEED) return 'slap';
  return null;
}

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
  /** People knocked off their seats, and what they're doing about it. */
  private unseated = new Map<Person, Unseat & { onPose?: Person['onPose']; onUpdate?: Person['onUpdate']; dx: number; dz: number }>();
  /** Seeded randomness for who comes straight back and who wanders off. */
  private rnd = (() => {
    let s = 9173;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  })();
  /** Counters for tests: knocked off seats, sat back down. */
  readonly seatStats = { unseated: 0, reseated: 0 };
  private time = 0;
  private friendCool = 0;
  private hp = new THREE.Vector3();
  /** Overlapping pairs found last frame (for tests and the stats line). */
  overlaps = 0;
  /** Stuck in a crowd: how much it gives (see Wedge). */
  readonly wedge = new Wedge();
  /** This frame's intended walking (metres) and its direction, and where your feet were last frame. */
  private want = 0;
  private wantX = 0;
  private wantZ = 0;
  private lastFeet = new THREE.Vector3(NaN, 0, 0);
  private dirs = new Float32Array(6);
  private chain = 0;
  /** When anyone last said a line about being pushed, or gasped. */
  private lastLine = -99;
  private lastGasp = -99;
  /** Counters for tests: people who made way, spoken lines, gasps. */
  readonly yieldStats = { yields: 0, lines: 0, gasps: 0 };
  /** Friends' avatars' positions last frame (they part the crowd too). */
  private friendLast = new Map<Person, THREE.Vector2>();

  constructor(private d: BodiesDeps) {
    this.faces = d.faces ?? new SlapDetector();
    this.ownFaces = !d.faces;
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
    const l = Math.hypot(dx, dz);
    this.want += l;
    if (l > 1e-6) {
      this.wantX = dx / l;
      this.wantZ = dz / l;
    }
    // Wedged: the crowd gives (you sink in a little, and part of your push carries on into them).
    const sq = this.wedge.squeeze;
    stepAgainst(x, z, dx, dz, RADIUS, this.flat, n, this.press, out, SLIDE + (0.85 - SLIDE) * sq, SOFT + 0.12 * sq, 0.55 * sq);
    for (let i = 0; i < n; i++) {
      if (this.press[i] <= 0) continue;
      this.contact[this.contactN] = this.near[i];
      this.contactPress[this.contactN++] = this.press[i];
    }
  }

  private st(p: Person): Shove {
    let s = this.state.get(p);
    if (!s) {
      s = { pushT: 0, lastPush: -9, cool: 0, dx: 0, dz: 0, dist: 0, t: 1, T: SHOVE_T, faceT: 0, faceYaw: 0, homeX: p.pos.x, homeZ: p.pos.z, home: false, lastSound: -99, yield: false };
      this.state.set(p, s);
    }
    return s;
  }

  /**
   * Shoves `p` by `dist` metres along (ux, uz) (a unit vector), and they react
   * with `strength` 0..1 (a stumble, a turn toward `from`, maybe a word).
   */
  shove(p: Person, ux: number, uz: number, dist: number, strength: number, from: THREE.Vector3, quiet = false) {
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
      this.chain = 0;
      this.moveBy(p, ux, uz, dist, SHOVE_T + dist * 0.25, false, 0);
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
    if (quiet) s.lastSound = this.time;
    else if (strength >= 0.6 || this.time - s.lastSound > 3) {
      s.lastSound = this.time;
      this.voice(p, strength);
    }
  }

  /** Someone says something about it: a line if nobody has for a while, else a gasp (if nobody just did). */
  private voice(p: Person, strength: number) {
    if (this.time - this.lastLine >= LINE_GAP) {
      this.lastLine = this.lastGasp = this.time;
      this.yieldStats.lines++;
      this.d.onBump?.(p, strength, 'line');
    } else if (this.time - this.lastGasp >= GASP_GAP) {
      this.lastGasp = this.time;
      this.yieldStats.gasps++;
      this.d.onBump?.(p, strength, 'gasp');
    } else this.d.onBump?.(p, strength, 'none');
  }

  /**
   * Starts `p` moving `dist` metres along (ux, uz) over T seconds (the shove
   * motion: quick, then easing out; a sidestep when `yielding`), and passes it
   * on to whoever stands where they'll end up (`gen` steps from you, within
   * CHAIN people per push), so a path opens through a packed crowd.
   */
  private moveBy(p: Person, ux: number, uz: number, dist: number, T: number, yielding: boolean, gen: number) {
    const s = this.st(p);
    if (!s.home && !p.placed && (p.role === 'chat' || p.role === 'watch')) {
      s.home = true;
      s.homeX = p.pos.x;
      s.homeZ = p.pos.z;
    }
    s.dx = ux;
    s.dz = uz;
    s.dist = dist;
    s.t = 0;
    s.T = T;
    s.yield = yielding;
    if (gen >= CHAIN_GEN) return;
    const tx = p.pos.x + ux * dist,
      tz = p.pos.z + uz * dist;
    const touch = BODY_R * 2 + 0.04;
    for (const q of this.d.crowd.people) {
      if (this.chain >= CHAIN) return;
      if (q === p || q.away || q.culled || !movable(q)) continue;
      const ex = q.pos.x - tx,
        ez = q.pos.z - tz;
      if (Math.abs(ex) > touch || Math.abs(ez) > touch) continue;
      const e = Math.hypot(ex, ez);
      if (e >= touch) continue;
      const qs = this.st(q);
      // Already on the move.
      if (qs.t < qs.T) continue;
      // Away from where p lands, and on along p's way.
      let vx = (e > 1e-4 ? ex / e : ux) + ux * 0.6,
        vz = (e > 1e-4 ? ez / e : uz) + uz * 0.6;
      const vl = Math.hypot(vx, vz) || 1;
      vx /= vl;
      vz /= vl;
      const qd = Math.min(0.4, Math.max(0.15, touch - e + 0.06));
      this.chain++;
      this.yieldStats.yields++;
      if (q.role === 'wander' || q.role === 'waiter') q.pause = Math.max(q.pause, 0.8);
      q.attendUntil = Math.max(q.attendUntil, this.d.crowd.now + 0.8);
      this.moveBy(q, vx, vz, qd, 0.3 + qd * 0.5, true, gen + 1);
    }
  }

  /**
   * `p` is in the way of someone walking from (fx0, fz0) along (fx, fz): they
   * step aside out of the path (or back, or to the other side, whichever is
   * clear: walls and furniture first, then the fewest people), a full step,
   * at a walk. `squeeze` (0..1: the walker is wedged) makes it a bigger step.
   */
  makeWay(p: Person, fx0: number, fz0: number, fx: number, fz: number, squeeze = 0, quiet = false) {
    if (!movable(p)) return;
    const d = yieldDirs(fx, fz, p.pos.x - fx0, p.pos.z - fz0, this.dirs);
    const dist = YIELD_STEP * (1 + 0.35 * squeeze);
    let best = -1,
      bestScore = Infinity;
    for (let c = 0; c < 3; c++) {
      const tx = p.pos.x + d[c * 2] * dist,
        tz = p.pos.z + d[c * 2 + 1] * dist;
      if (!(this.d.world.isFree?.(tx, tz, 0.22, true) ?? true)) continue;
      let crowded = 0;
      for (const q of this.d.crowd.people) {
        if (q === p || q.away || q.culled) continue;
        const ex = q.pos.x - tx,
          ez = q.pos.z - tz;
        if (ex * ex + ez * ez < 0.45 * 0.45) crowded += movable(q) ? 1 : 3;
      }
      const score = crowded + c * 0.6;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    // Hemmed in by walls every way: straight back (the shove stops at the wall).
    const ux = best >= 0 ? d[best * 2] : d[2],
      uz = best >= 0 ? d[best * 2 + 1] : d[3];
    this.chain = 0;
    this.yieldStats.yields++;
    this.moveBy(p, ux, uz, dist, 0.3 + dist * 0.5, true, 0);
    if (p.role === 'wander' || p.role === 'waiter') p.pause = Math.max(p.pause, 1.0);
    // A glance at whoever it is; a little start if they were really squashed.
    p.attendUntil = Math.max(p.attendUntil, this.d.crowd.now + 1.2);
    if (squeeze > 0.5) p.gaspT = Math.max(p.gaspT, 0.2);
    const s = this.st(p);
    if (!quiet && this.time - s.lastSound > 3) {
      s.lastSound = this.time;
      this.voice(p, 0.15);
    }
  }

  update(dt: number) {
    this.time += dt;
    this.friendCool = Math.max(0, this.friendCool - dt);
    const { player, crowd } = this.d;
    const feet = player.feet();
    const speed = player.speed;
    for (const s of this.state.values()) s.cool = Math.max(0, s.cool - dt);

    // 0. Wedged? (Trying to walk, touching people, getting nowhere.)
    {
      // Progress is along the way you're trying to go (sliding sideways along someone isn't getting through).
      const mx = feet.x - this.lastFeet.x,
        mz = feet.z - this.lastFeet.z;
      let got = Number.isFinite(mx) ? Math.max(0, mx * this.wantX + mz * this.wantZ) : this.want;
      if (Math.hypot(mx, mz) > 1) got = this.want; // a teleport isn't progress (or the lack of it)
      this.wedge.update(dt, this.want, got, this.contactN > 0);
      this.want = 0;
      this.lastFeet.copy(feet);
    }
    const squeeze = this.wedge.squeeze;

    // 1. You walked into people this frame: resistance already happened; now they give way.
    for (let k = 0; k < this.contactN; k++) {
      const p = this.contact[k];
      const s = this.st(p);
      const pressSpeed = this.contactPress[k] / Math.max(dt, 1e-3);
      if (pressSpeed > 0.1) {
        s.pushT = this.time - s.lastPush < 0.2 ? s.pushT + dt : dt;
        s.lastPush = this.time;
      }
      if (s.cool > 0) continue;
      const bump = speed >= BUMP_SPEED;
      if (!bump && s.pushT < YIELD_HOLD && squeeze < 0.5) continue;
      if (!bump && movable(p)) {
        // Walking into them: they make way (aside, out of your path), and keep doing so while you press on.
        this.makeWay(p, feet.x, feet.z, this.wantX, this.wantZ, squeeze);
        s.pushT = 0;
        s.cool = Math.max(s.cool, squeeze > 0.5 ? 0.2 : 0.35);
        continue;
      }
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

    // 1b. Friends' avatars walking into people: they make way for them too (people here are this machine's).
    this.friendsPart(dt);

    // 2. VR hands pushing into bodies.
    if (player.inXR) {
      this.faceStep();
      for (const h of this.d.hands.hands) this.handPush(h);
    }

    // 3. Shoves in progress, turning toward you, and drifting back to where they stood.
    for (const [p, s] of this.state) {
      if (s.t < s.T) {
        const k = shoveProgress(s.t + dt, s.T) - shoveProgress(s.t, s.T);
        s.t += dt;
        const sx = s.dx * s.dist * k,
          sz = s.dz * s.dist * k;
        const [nx, nz] = this.d.world.move(p.pos.x, p.pos.z, sx, sz, 0.22, true);
        const moved = Math.hypot(nx - p.pos.x, nz - p.pos.z);
        p.pos.x = nx;
        p.pos.z = nz;
        // Against a wall or a table: they stop there.
        if (moved < Math.hypot(sx, sz) * 0.3) s.t = s.T;
        if (s.yield) {
          // Stepping aside: walking legs, turning the way they go (not a stumble).
          const v = Math.min(1.3, (s.dist / s.T) * 1.4);
          p.moving = Math.max(p.moving, v);
          p.walkPhase += v * dt * 5.2;
          turn(p, Math.atan2(s.dx, s.dz), dt * 4);
          if (s.t >= s.T) s.yield = false;
        }
      } else if (!s.home && !p.placed && p.moving > 0 && p.role !== 'wander' && p.role !== 'waiter' && p.role !== 'pair') {
        // Done stepping aside: stand.
        p.moving = Math.max(0, p.moving - dt * 4);
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
          const [nx, nz] = this.d.world.move(p.pos.x, p.pos.z, hx * k, hz * k, 0.22, true);
          p.pos.x = nx;
          p.pos.z = nz;
          p.moving = 0.45;
        } else {
          p.moving = Math.max(0, p.moving - dt * 3);
          if (hd <= 0.03) turn(p, p.homeYaw, dt * 3);
        }
      }
    }

    // 3b. People you knocked off their seats.
    this.updateUnseated(dt, feet);

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
      // Not here (a concert-goer not arrived yet): nobody to bump.
      if (p.away) {
        this.rs[i] = 0;
        this.mass[i] = 0;
      }
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
        const [nx, nz] = this.d.world.move(p.pos.x, p.pos.z, cx, cz, 0.22, true);
        p.pos.x = nx;
        p.pos.z = nz;
      }
    }
  }

  /** Friends' avatars (driven) walking into people part the crowd here as you do (quietly: their game voices it). */
  private friendsPart(dt: number) {
    const people = this.d.crowd.people;
    for (const f of people) {
      if (!f.driven) continue;
      let last = this.friendLast.get(f);
      if (!last) this.friendLast.set(f, (last = new THREE.Vector2(f.pos.x, f.pos.z)));
      const vx = (f.pos.x - last.x) / Math.max(dt, 1e-3),
        vz = (f.pos.z - last.y) / Math.max(dt, 1e-3);
      last.set(f.pos.x, f.pos.z);
      const v = Math.hypot(vx, vz);
      if (f.away || v < 0.3 || v > 8) continue;
      const touch = BODY_R * 2 + 0.06;
      for (const q of people) {
        if (q === f || q.driven || q.away || q.culled || !movable(q)) continue;
        const ox = q.pos.x - f.pos.x,
          oz = q.pos.z - f.pos.z;
        if (Math.abs(ox) > touch || Math.abs(oz) > touch || ox * ox + oz * oz > touch * touch) continue;
        // Only who's ahead of them.
        if (ox * vx + oz * vz <= 0) continue;
        const s = this.st(q);
        if (s.cool > 0 || s.t < s.T) continue;
        this.makeWay(q, f.pos.x, f.pos.z, vx, vz, 0, true);
        s.cool = 0.4;
      }
    }
  }

  /**
   * Knocks a seated guest off their seat, pushed along (ux, uz): they stand up
   * and stumble off it (the HitRecieve stumble and the shove motion), say so,
   * look at you, and later come back to sit down or wander off for a while
   * (see seatshove.ts). `at` is where the hand landed.
   */
  knockOffSeat(p: Person, ux: number, uz: number, power: number, punch: boolean, at: THREE.Vector3, opts: { quiet?: boolean } = {}) {
    if (!unseatable(p)) return false;
    const u = unseat(p.pos.x, p.pos.z, p.homeYaw, p.seatY, p.lie);
    this.unseated.set(p, { ...u, onPose: p.onPose, onUpdate: p.onUpdate, dx: ux, dz: uz });
    // Off the stool: no more reaching for the spin button or the cards.
    p.onPose = undefined;
    p.onUpdate = undefined;
    p.seated = false;
    p.offSeat = true;
    p.lie = 0;
    p.action = 0;
    this.seatStats.unseated++;
    // Clear of the stool, then the shove carries them on.
    // Quiet: it happened in a friend's game (their machine already said so, and sends the line).
    this.shove(p, ux, uz, 0.45 + power * 0.35, punch ? 0.7 : 0.8, this.d.player.feet(), punch || !!opts.quiet);
    const s = this.st(p);
    s.cool = Math.max(s.cool, 1);
    p.gaspT = Math.max(p.gaspT, 0.9);
    if (punch && !opts.quiet) this.d.onPunch?.(p, power, at.clone(), 'body', new THREE.Vector3(ux, 0, uz).multiplyScalar(2 + power * 2));
    if (!opts.quiet) this.d.onUnseat?.(p, ux, uz, power, punch);
    return true;
  }

  /** People who were knocked off their seats: glare, then walk back and sit, or wander off and come back later. */
  private updateUnseated(dt: number, feet: THREE.Vector3) {
    for (const [p, u] of this.unseated) {
      // Something else sat them down (or took them over): forget it.
      if (p.seated || p.driven) {
        this.unseated.delete(p);
        p.offSeat = false;
        continue;
      }
      const seatFree =
        Math.hypot(feet.x - u.homeX, feet.z - u.homeZ) > 0.55 &&
        !this.d.seatTaken?.(u.homeX, u.homeZ) &&
        !this.d.crowd.people.some((o) => o !== p && Math.hypot(o.pos.x - u.homeX, o.pos.z - u.homeZ) < 0.3);
      const toGoal = Math.hypot(u.goalX - p.pos.x, u.goalZ - p.pos.z);
      const phase = stepUnseat(u, dt, {
        toGoal,
        seatFree,
        rnd: this.rnd,
        wanderGoal: (dist) => this.wanderGoal(u.homeX, u.homeZ, u.dx, u.dz, dist),
      });
      if (phase === 'glare' || phase === 'stumble') {
        // Glaring at you (head and body).
        p.attendUntil = Math.max(p.attendUntil, this.d.crowd.now + 0.5);
        if (phase === 'glare') turn(p, Math.atan2(feet.x - p.pos.x, feet.z - p.pos.z), dt * 3);
        p.moving = Math.max(0, p.moving - dt * 3);
      } else if (walking(u)) {
        const waiting = phase === 'return' && !seatFree && toGoal < UNSEAT.near + 0.35;
        const d = Math.hypot(u.goalX - p.pos.x, u.goalZ - p.pos.z);
        if (waiting || d < 1e-3) {
          p.moving = Math.max(0, p.moving - dt * 3);
          if (waiting) turn(p, Math.atan2(feet.x - p.pos.x, feet.z - p.pos.z), dt * 3);
          continue;
        }
        const step = Math.min(d, UNSEAT.walk * dt);
        const sx = ((u.goalX - p.pos.x) / d) * step,
          sz = ((u.goalZ - p.pos.z) / d) * step;
        // Round furniture; the last stretch onto their own stool goes straight there.
        const [nx, nz] = d < 0.6 || u.stuck > 2.5 ? [p.pos.x + sx, p.pos.z + sz] : this.d.world.move(p.pos.x, p.pos.z, sx, sz, 0.22, false);
        const moved = Math.hypot(nx - p.pos.x, nz - p.pos.z);
        u.stuck = moved < step * 0.3 ? u.stuck + dt : Math.max(0, u.stuck - dt);
        p.pos.x = nx;
        p.pos.z = nz;
        p.moving = UNSEAT.walk;
        p.walkPhase += UNSEAT.walk * dt * 5;
        turn(p, Math.atan2(sx, sz), dt * 6);
      } else if (phase === 'loiter') {
        p.moving = Math.max(0, p.moving - dt * 3);
      } else if (phase === 'sit') {
        // Back on their seat.
        p.pos.x = u.homeX;
        p.pos.z = u.homeZ;
        p.yaw = p.homeYaw = u.homeYaw;
        p.seatY = u.seatY;
        p.lie = u.lie;
        p.moving = 0;
        p.seated = true;
        p.offSeat = false;
        p.onPose = u.onPose;
        p.onUpdate = u.onUpdate;
        this.unseated.delete(p);
        this.state.delete(p);
        this.seatStats.reseated++;
        this.d.onReseat?.(p);
      }
    }
  }

  /** Who's off their seat, and what they're up to (for tests and debugging). */
  offSeat(): { p: Person; phase: string; home: [number, number] }[] {
    return [...this.unseated].map(([p, u]) => ({ p, phase: u.phase, home: [u.homeX, u.homeZ] }));
  }

  /** Somewhere free a few metres from the seat, roughly the way they were pushed (out into the open). */
  private wanderGoal(hx: number, hz: number, dx: number, dz: number, dist: number): [number, number] {
    const w = this.d.world;
    const base = Math.atan2(dx, dz);
    for (const da of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, Math.PI]) {
      for (const k of [1, 0.7, 0.45]) {
        const a = base + da;
        const x = hx + Math.sin(a) * dist * k,
          z = hz + Math.cos(a) * dist * k;
        if (!w.isFree(x, z, 0.3, true)) continue;
        // A clear walk there (a few samples along the way).
        let clear = true;
        for (let t = 0.25; t < 1; t += 0.25) if (!w.isFree(hx + (x - hx) * t, hz + (z - hz) * t, 0.18, false)) clear = false;
        if (clear) return [x, z];
      }
    }
    return [hx + dx * 1.2, hz + dz * 1.2];
  }

  /** Hands on faces (fight/slap.ts): Bodies' own when none is shared. */
  private faces: SlapDetector;
  private ownFaces: boolean;
  /** Faces each hand met this frame. */
  private faceTouched = new Map<Hand, Set<Person>>();

  /**
   * VR hands meeting faces: a touch, a slap (open hand, palm or back, fast
   * into the face) or a punch (a fist). Swept from last frame, so a fast
   * swing can't pass through a head between frames.
   */
  faceStep() {
    const det = this.faces;
    if (this.ownFaces) {
      det.beginFrame(this.time);
      sampleHands(det, this.d.hands, (h) => this.d.isFist?.(h) ?? null);
    }
    for (const h of this.d.hands.hands) {
      let set = this.faceTouched.get(h);
      if (!set) this.faceTouched.set(h, (set = new Set()));
      set.clear();
      const id = handSide(h);
      const hp = det.palmAt(id);
      if (!hp) continue;
      for (const p of this.d.crowd.people) {
        if (p.culled || p.driven) continue;
        const head = p.rig?.bones.Head;
        if (!head) continue;
        if (Math.abs(hp.x - p.pos.x) > 0.7 || Math.abs(hp.z - p.pos.z) > 0.7) continue;
        head.updateWorldMatrix(true, false);
        const hit = det.contact(id, p, head.matrixWorld);
        if (!hit) continue;
        set.add(p);
        this.faceHit(h, p, hit);
      }
    }
  }

  private faceHit(h: Hand, p: Person, hit: FaceHit) {
    const s = this.st(p);
    const fighting = this.d.fighting?.(p) ?? false;
    const v = hit.v;
    if (hit.kind === 'punch') {
      // A fist to the face: the punch it always was.
      if (s.cool > 0) return;
      const power = hit.power;
      const vl = Math.hypot(v.x, v.z) || 1;
      if (!fighting) this.shove(p, v.x / vl, v.z / vl, 0.35, Math.min(0.7, 0.3 + power * 0.4), this.d.player.feet(), true);
      s.cool = Math.max(s.cool, fighting ? 0.3 : 0.8);
      this.d.hands.onHaptic?.(h, 0.6 + power * 0.4, 70);
      this.d.onPunch?.(p, power, hit.at.clone(), 'head', v.clone());
      return;
    }
    // (A slap or a touch: no body shove from the follow-through.)
    s.cool = Math.max(s.cool, 0.4);
    if (hit.kind === 'slap') {
      // The sting in your own hand: sharp, stronger the harder.
      this.d.hands.onHaptic?.(h, 0.35 + 0.65 * hit.power, 25 + 35 * hit.power);
      this.d.onSlap?.(p, hit.power, hit.at.clone(), v.clone(), hit);
      return;
    }
    this.d.hands.onHaptic?.(h, 0.08 + 0.17 * hit.strength, 15);
    this.d.onFaceTouch?.(p, hit);
  }

  /** A VR hand moving into someone's body pushes them a step back that way; a fast one punches (faces: faceStep). */
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
      const s = this.st(p);
      if (s.cool > 0) continue;
      const fighting = this.d.fighting?.(p) ?? false;
      // The face was this hand's this frame (faceStep): no shove from the same touch.
      if (this.faceTouched.get(h)?.has(p)) continue;
      const k = p.look.height / 1.75;
      const y0 = p.pos.y + (p.seated ? p.seatY - 0.1 : 0.5 * k);
      const y1 = p.pos.y + (p.seated ? p.seatY + 0.55 * k : 1.42 * k);
      if (capsuleDepth(hp.x, hp.y, hp.z, p.pos.x, p.pos.z, y0, y1, 0.2) <= 0) continue;
      const v = this.d.hands.velocity(h);
      const into = handInto(v.x, v.z, ox, oz);
      if (into < 0.5) continue;
      const vl = Math.hypot(v.x, v.z) || 1;
      // A punch: a fist moving fast, or any hand moving very fast (hand tracking has no grip button).
      const speed = v.length();
      const punch = (speed > PUNCH_SPEED && !!this.d.isFist?.(h)) || speed > PUNCH_ANY;
      // Hard enough, and they're sitting (and not squared up for a fight): off the seat they go.
      if (!fighting && unseatable(p) && knocksOffSeat(into, punch)) {
        const power = Math.min(1, (speed - 1.2) / 3);
        this.knockOffSeat(p, v.x / vl, v.z / vl, power, punch, hp);
        this.d.hands.onHaptic?.(h, 0.6 + power * 0.4, 70);
        continue;
      }
      if (punch) {
        const power = Math.min(1, (speed - 1.6) / 3);
        if (!fighting) this.shove(p, v.x / vl, v.z / vl, Math.min(1, handShove(into) + 0.4), Math.min(0.7, 0.3 + power * 0.4), this.d.player.feet(), true);
        s.cool = Math.max(s.cool, fighting ? 0.3 : 1);
        this.d.hands.onHaptic?.(h, 0.6 + power * 0.4, 70);
        this.d.onPunch?.(p, power, hp.clone(), 'body', v);
        continue;
      }
      if (fighting) continue;
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
