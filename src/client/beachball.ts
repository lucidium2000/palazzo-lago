import * as THREE from 'three';
import { BALL, BallSim, lobVelocity, newBall, type BallBody, type BallWorld } from './ballphys';
import type { Sound } from './audio';
import type { Grabbable, Hand, Hands } from './hands';
import type { Interaction } from './interaction';
import type { Crowd, Person } from './people';
import type { Player } from './player';
import { canvas, radial, toTexture } from './textures';

/**
 * Beach balls at the pool party. Hit them with your hands or arms (VR), grab
 * and throw them (grip), walk into one to kick it or click it to punt it
 * (desktop). They float and drift on the pool, bounce off the deck, walls,
 * furniture and people, and guests bat them back to you or to each other.
 *
 * Two players: whoever touched a ball last owns it and sends its state
 * (`ball` events) when they touch it and every so often while it moves; the
 * other side runs the same physics in between and takes each update as it comes.
 */

export interface BallSession {
  emit(k: string, data?: unknown): void;
  on(kind: string, fn: (friend: unknown, d: Record<string, unknown>) => void): void;
  readonly host: boolean;
}

export interface BeachBallDeps {
  scene: THREE.Scene;
  world: BallWorld;
  crowd: Crowd;
  player: Player;
  hands: Hands;
  interaction: Interaction;
  camera: THREE.Camera;
  sound: Sound;
  /** Where the balls start (and come back to if they get lost). */
  spawns: THREE.Vector3[];
  /** The area the balls belong in (they come back if they sit outside it for a while). */
  home: { x0: number; x1: number; z0: number; z1: number };
}

interface Ball {
  i: number;
  sim: BallSim;
  mesh: THREE.Mesh;
  shadow: THREE.Mesh;
  /** Your hand holding it (VR). */
  held: Hand | null;
  heldOff: THREE.Vector3;
  /** Who moves it: you, your friend, or nobody yet (the host's game runs it). */
  owner: 'me' | 'them' | null;
  /** Your friend is holding it: follow their updates, don't simulate. */
  remoteHeld: boolean;
  sendT: number;
  wasAsleep: boolean;
  /** Seconds sitting outside the deck. */
  lost: number;
  /** No guest bats it again until then (seconds of sim time). */
  guestCool: number;
  lastGuest: Person | null;
  /** Your feet's last contact (no machine-gun kicks). */
  kickCool: number;
  handCool: number;
}

/** Hand and forearm thickness for hitting the ball (m). */
const HAND_R = 0.06;
const ARM_R = 0.05;
const FOREARM = 0.28;
/** How often an owner re-sends a moving ball (s); a held one goes a little faster. */
const SYNC_EVERY = 0.5;
const HELD_EVERY = 0.25;

export class BeachBalls {
  readonly balls: Ball[] = [];
  private session: BallSession | null = null;
  private bodies: BallBody[] = [];
  private guestCd = new WeakMap<Person, number>();
  private lastFeet = new THREE.Vector3();
  private feetVel = new THREE.Vector3();
  private time = 0;
  private v = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private static X = new THREE.Vector3(1, 0, 0);
  private static Z = new THREE.Vector3(0, 0, 1);
  /** Guests' swats so far (for the stats and tests). */
  guestHits = 0;

  constructor(private d: BeachBallDeps) {
    const geo = new THREE.SphereGeometry(BALL.r, 32, 20);
    const tex = toTexture(ballTexture());
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.32, metalness: 0, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.22, envMapIntensity: 0.9 });
    const shadowMat = new THREE.MeshBasicMaterial({ map: toTexture(radial(64, 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0)')), transparent: true, depthWrite: false });
    const shadowGeo = new THREE.PlaneGeometry(BALL.r * 2.6, BALL.r * 2.6).rotateX(-Math.PI / 2);
    d.spawns.forEach((at, i) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `beach-ball-${i}`;
      mesh.userData.loose = true;
      mesh.position.copy(at);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      const shadow = new THREE.Mesh(shadowGeo, shadowMat);
      shadow.raycast = () => {};
      shadow.renderOrder = 3;
      d.scene.add(mesh, shadow);
      const sim = new BallSim(d.world, newBall(at.x, at.y, at.z));
      const ball: Ball = { i, sim, mesh, shadow, held: null, heldOff: new THREE.Vector3(), owner: null, remoteHeld: false, sendT: 0, wasAsleep: false, lost: 0, guestCool: 0, lastGuest: null, kickCool: 0, handCool: 0 };
      sim.onImpact = (kind, speed) => this.impact(ball, kind, speed);
      this.balls.push(ball);
      d.hands.register(this.grabbable(ball));
      d.interaction.register({
        object: mesh,
        label: () => (this.reachable(ball) ? 'Punt the beach ball' : null),
        enabled: () => !d.player.inXR,
        onSelect: () => this.punt(ball),
      });
    });
    this.lastFeet.copy(d.player.feet());
  }

  /** Two players: share the balls over the session. */
  connect(session: BallSession | null) {
    this.session = session;
    for (const b of this.balls) b.owner = null;
    session?.on('ball', (_f, m) => this.receive(m));
  }

  // --- Touches ------------------------------------------------------------------

  private reachable(b: Ball) {
    const f = this.d.player.feet();
    const p = b.sim.s;
    return Math.hypot(p.x - f.x, p.z - f.z) < 3.2 && p.y - f.y < 2.6;
  }

  /** Desktop click: a punt the way you're looking, up and away. */
  punt(b: Ball) {
    if (!this.reachable(b) || b.held) return;
    const dir = this.d.camera.getWorldDirection(this.v).setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    this.touch(b, dir.x * 5.5, 4.2, dir.z * 5.5);
    this.d.sound.play('thunk', b.mesh, { volume: 0.5, rate: 1.7 });
  }

  /** You (or a guest, on your machine) sent the ball off with this velocity. */
  private touch(b: Ball, vx: number, vy: number, vz: number) {
    b.sim.hit(vx, vy, vz);
    b.owner = 'me';
    b.remoteHeld = false;
    this.send(b);
  }

  private grabbable(b: Ball): Grabbable {
    return {
      at: () => b.mesh.position,
      radius: BALL.r + 0.12,
      enabled: () => !b.held && !b.remoteHeld,
      grab: (hand) => {
        b.held = hand;
        // Hold it by its surface where you took it.
        b.heldOff.copy(b.mesh.position).sub(hand.pos);
        if (b.heldOff.lengthSq() < 1e-6) b.heldOff.set(0, 0, -1);
        b.heldOff.setLength(BALL.r + 0.03);
        b.owner = 'me';
        b.remoteHeld = false;
        return 'drag';
      },
      drag: (_hand, pos) => {
        const at = this.v.copy(pos).add(b.heldOff);
        b.sim.set(at.x, at.y, at.z, 0, 0, 0);
      },
      release: (hand, pos) => {
        const v = this.d.hands.velocity(hand).multiplyScalar(1.1);
        const at = this.v.copy(pos).add(b.heldOff);
        b.held = null;
        b.sim.set(at.x, at.y, at.z, v.x, v.y, v.z);
        b.handCool = 0.25;
        b.owner = 'me';
        this.send(b);
      },
    };
  }

  /** VR: hands and forearms slap the ball (a hand is far heavier than an inflatable). */
  private handHits(b: Ball) {
    if (!this.d.player.inXR || b.held || b.handCool > 0) return;
    const s = b.sim.s;
    const c = this.v.set(s.x, s.y, s.z);
    for (const hand of this.d.hands.hands) {
      if (hand.ctrl.userData.connected === false || hand.held) continue;
      hand.grip.updateMatrixWorld(true);
      const hp = new THREE.Vector3().setFromMatrixPosition(hand.grip.matrixWorld);
      if (hp.lengthSq() === 0 || hp.distanceTo(c) > BALL.r + FOREARM + 0.1) continue;
      // The hand, then the forearm behind it (toward the elbow).
      const side = hand.ctrl.userData.handedness === 'left' ? 'left' : 'right';
      const aim = this.d.hands.handAim(side)?.fwd;
      const elbow = aim ? hp.clone().addScaledVector(aim, -FOREARM) : hp.clone().add(new THREE.Vector3(0, -FOREARM * 0.7, 0));
      const seg = new THREE.Line3(hp, elbow);
      const near = seg.closestPointToPoint(c, true, new THREE.Vector3());
      const r = near.distanceTo(hp) < 0.02 ? HAND_R : ARM_R;
      const n = c.clone().sub(near);
      const d = n.length();
      if (d >= BALL.r + r || d < 1e-6) continue;
      n.divideScalar(d);
      const hv = this.d.hands.velocity(hand);
      const rel = new THREE.Vector3(s.vx, s.vy, s.vz).sub(hv);
      const vn = rel.dot(n);
      if (vn >= 0) continue;
      const out = new THREE.Vector3(s.vx, s.vy, s.vz).addScaledVector(n, -(1 + BALL.restitution) * vn);
      // A slap also drags it along a bit with the hand.
      const tang = hv.clone().addScaledVector(n, -hv.dot(n));
      out.addScaledVector(tang, 0.3);
      const p = near.clone().addScaledVector(n, BALL.r + r + 0.005);
      b.sim.set(p.x, p.y, p.z, out.x, out.y, out.z);
      b.handCool = 0.12;
      this.touch(b, out.x, out.y, out.z);
      this.d.hands.onHaptic?.(hand, Math.min(0.8, 0.25 + -vn * 0.1), 30);
      this.d.sound.play('thunk', b.mesh, { volume: Math.min(0.7, 0.2 + -vn * 0.08), rate: 1.8 });
      return;
    }
  }

  /** Walking into a ball on the floor kicks it ahead of you. */
  private kicks(b: Ball, feet: THREE.Vector3) {
    if (b.held || b.kickCool > 0) return;
    const s = b.sim.s;
    if (s.y - BALL.r > feet.y + 0.6) return;
    const dx = s.x - feet.x,
      dz = s.z - feet.z;
    const dist = Math.hypot(dx, dz);
    if (dist > BALL.r + 0.3 || dist < 1e-6) return;
    const ux = dx / dist,
      uz = dz / dist;
    const fv = this.feetVel;
    const into = fv.x * ux + fv.z * uz;
    if (into < 0.25) return;
    const kick = 0.8 + into * 1.7;
    b.kickCool = 0.35;
    // Off the toe: forward and up (a running kick goes further).
    this.touch(b, ux * kick + fv.x * 0.3, 1.2 + into * 0.9, uz * kick + fv.z * 0.3);
    this.d.sound.play('thunk', b.mesh, { volume: 0.4, rate: 1.6 });
  }

  // --- Guests -------------------------------------------------------------------

  /** May the guests on this machine bat this ball? (The owner's game decides; nobody yet: the host's.) */
  private guestsPlay(b: Ball) {
    if (!this.session) return true;
    return b.owner === 'me' || (b.owner === null && this.session.host);
  }

  /** A guest within arm's reach of the ball bats it (to you, or to another guest). */
  private guestSwat(b: Ball) {
    if (b.held || b.remoteHeld || b.guestCool > this.time || !this.guestsPlay(b)) return;
    const s = b.sim.s;
    for (const p of this.d.crowd.people) {
      if (p === b.lastGuest || p.seated || p.driven || p.swimHead !== null || p.culled) continue;
      if (p.role === 'croupier' || p.role === 'bartender' || p.role === 'waiter' || p.role === 'buddy') continue;
      const dx = s.x - p.pos.x,
        dz = s.z - p.pos.z;
      if (Math.abs(dx) > 1.0 || Math.abs(dz) > 1.0 || Math.hypot(dx, dz) > 0.95) continue;
      const h = s.y - p.pos.y;
      if (h < 0.9 || h > p.look.height + 0.7) continue;
      if ((this.guestCd.get(p) ?? -1) > this.time) continue;
      this.guestCd.set(p, this.time + 3 + Math.random() * 3);
      // Not everyone joins in.
      if (Math.random() < 0.3) continue;
      const target = this.pickTarget(p);
      const dist = Math.hypot(target.x - s.x, target.z - s.z);
      const t = THREE.MathUtils.clamp(dist / 5, 0.7, 1.5);
      const [vx, vy, vz] = lobVelocity(s.x, s.y, s.z, target.x, target.y, target.z, t);
      this.touch(b, vx, vy, vz);
      b.lastGuest = p;
      b.guestCool = this.time + 0.6;
      this.guestHits++;
      // Arms up for the swat (the wave clip), and a look at where it went.
      p.cheer = Math.max(p.cheer, 0.7);
      if (p.role === 'wander') p.pause = Math.max(p.pause, 1.2);
      this.d.sound.play('thunk', b.mesh, { volume: 0.35, rate: 1.75 });
      return;
    }
  }

  /** Who a guest bats the ball to: you when you're around, else someone else playing, else up in the air. */
  private pickTarget(p: Person): THREE.Vector3 {
    const you = this.d.player.feet();
    const dYou = Math.hypot(you.x - p.pos.x, you.z - p.pos.z);
    if (dYou < 10 && dYou > 1.2 && !this.d.player.seated && Math.random() < 0.65) return you.clone().setY(you.y + (this.d.player.inXR ? 1.3 : 1.2));
    const others = this.d.crowd.people.filter((o) => {
      if (o === p || o.seated || o.driven || o.swimHead !== null || o.role === 'bartender' || o.role === 'croupier') return false;
      const dd = Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z);
      return dd > 2.5 && dd < 8;
    });
    if (others.length) {
      const o = others[Math.floor(Math.random() * others.length)];
      return new THREE.Vector3(o.pos.x, o.pos.y + o.look.height + 0.1, o.pos.z);
    }
    const a = Math.random() * Math.PI * 2;
    return new THREE.Vector3(p.pos.x + Math.cos(a) * 3, p.pos.y + 1.5, p.pos.z + Math.sin(a) * 3);
  }

  // --- Network ------------------------------------------------------------------

  private send(b: Ball) {
    b.sendT = b.held ? HELD_EVERY : SYNC_EVERY;
    if (!this.session) return;
    const s = b.sim.s;
    const r = (x: number) => Math.round(x * 100) / 100;
    this.session.emit('ball', { i: b.i, p: [r(s.x), r(s.y), r(s.z)], v: [r(s.vx), r(s.vy), r(s.vz)], h: b.held ? 1 : 0 });
  }

  /** Your friend touched a ball (or is holding it, or it's still moving on their side). */
  receive(m: Record<string, unknown>) {
    const b = this.balls[Number(m.i)];
    const p = m.p as number[] | undefined,
      v = m.v as number[] | undefined;
    if (!b || !Array.isArray(p) || !Array.isArray(v) || p.length !== 3 || v.length !== 3 || ![...p, ...v].every(Number.isFinite)) return;
    // Their touch wins over a ball held in your hand only if you've let go.
    if (b.held) return;
    b.owner = 'them';
    b.remoteHeld = !!m.h;
    const clamp = (x: number) => THREE.MathUtils.clamp(x, -30, 30);
    b.sim.set(p[0], p[1], p[2], clamp(v[0]), clamp(v[1]), clamp(v[2]));
  }

  // --- Frame --------------------------------------------------------------------

  update(dt: number) {
    if (dt <= 0) return;
    this.time += dt;
    const feet = this.d.player.feet();
    this.feetVel.copy(feet).sub(this.lastFeet).divideScalar(dt);
    if (this.feetVel.length() > 12) this.feetVel.set(0, 0, 0);
    this.lastFeet.copy(feet);
    for (const b of this.balls) {
      b.kickCool = Math.max(0, b.kickCool - dt);
      b.handCool = Math.max(0, b.handCool - dt);
      const s = b.sim.s;
      if (!b.held && !b.remoteHeld) {
        this.handHits(b);
        if (!this.d.player.seated) this.kicks(b, feet);
        this.guestSwat(b);
        this.collectBodies(b, feet);
        b.sim.step(dt, this.bodies);
        // Lost (bounced out to the lobby, stuck somewhere): back to its spot after a while.
        const home = this.d.home;
        const away = s.x < home.x0 || s.x > home.x1 || s.z < home.z0 || s.z > home.z1;
        b.lost = away && s.asleep ? b.lost + dt : 0;
        if (b.lost > 20 || !this.d.world.isInside(s.x, s.z) || s.y < -5) this.respawn(b);
      }
      // The owner keeps the other side in step while it moves (and once when it stops).
      if (b.owner === 'me' && this.session) {
        b.sendT -= dt;
        const moving = !s.asleep || b.held;
        if ((moving && b.sendT <= 0) || (s.asleep && !b.wasAsleep)) this.send(b);
      }
      b.wasAsleep = s.asleep;
      this.place(b, dt);
    }
  }

  private respawn(b: Ball) {
    const at = this.d.spawns[b.i];
    b.sim.set(at.x, at.y, at.z, 0, 0, 0);
    b.lost = 0;
    if (this.session && this.guestsPlay(b)) {
      b.owner = 'me';
      this.send(b);
    }
  }

  /** People near the ball, as capsules (you included). */
  private collectBodies(b: Ball, feet: THREE.Vector3) {
    const s = b.sim.s;
    this.bodies.length = 0;
    for (const p of this.d.crowd.people) {
      if (Math.abs(p.pos.x - s.x) > 2 || Math.abs(p.pos.z - s.z) > 2) continue;
      const h = p.look.height;
      if (p.swimHead !== null) {
        this.bodies.push({ x: p.pos.x, z: p.pos.z, y0: p.swimHead - 0.35, y1: p.swimHead - 0.05, r: 0.22 });
      } else if (p.seated) {
        if (p.lie > 0) continue; // On a lounger: the lounger is the obstacle.
        this.bodies.push({ x: p.pos.x, z: p.pos.z, y0: p.pos.y + p.seatY - 0.1, y1: p.pos.y + p.seatY + 0.6, r: 0.22 });
      } else {
        const moving = p.role === 'wander' ? p.moving : 0;
        this.bodies.push({ x: p.pos.x, z: p.pos.z, y0: p.pos.y + 0.15, y1: p.pos.y + h - 0.2, r: 0.22, vx: Math.sin(p.yaw) * moving, vz: Math.cos(p.yaw) * moving });
      }
    }
    // You: a capsule from the knees to the top of your head (your feet kick, see kicks()).
    const pl = this.d.player;
    if (!pl.seated) {
      const top = pl.inXR ? this.d.hands.head.y + 0.1 - feet.y : 1.75;
      this.bodies.push({ x: feet.x, z: feet.z, y0: feet.y + 0.45, y1: feet.y + Math.max(0.6, top - 0.15), r: 0.2, vx: this.feetVel.x, vz: this.feetVel.z });
    }
  }

  private place(b: Ball, dt: number) {
    const s = b.sim.s;
    const m = b.mesh;
    m.position.set(s.x, s.y, s.z);
    if (!s.asleep) {
      m.quaternion.premultiply(this.q.setFromAxisAngle(BeachBalls.X, s.spinX * dt));
      m.quaternion.premultiply(this.q.setFromAxisAngle(BeachBalls.Z, s.spinZ * dt));
    }
    // A soft shadow on the deck (or the pool floor), fading with height.
    const floor = this.d.world.groundAt(s.x, s.z);
    b.shadow.visible = this.d.world.waterAt(s.x, s.z) === null;
    b.shadow.position.set(s.x, floor + 0.02, s.z);
    // Wider and fainter-looking the higher it flies.
    const up = THREE.MathUtils.clamp((s.y - BALL.r - floor) / 4, 0, 1);
    b.shadow.scale.setScalar(1 + up * 0.8);
  }

  private impact(b: Ball, kind: 'ground' | 'wall' | 'body' | 'water', speed: number) {
    const near = b.mesh.position.distanceTo(this.d.player.feet()) < 25;
    if (!near) return;
    if (kind === 'water') this.d.sound.play('splash', b.mesh, { volume: Math.min(0.5, 0.1 + speed * 0.06), rate: 1.4 });
    else if (speed > 0.8) this.d.sound.play('land', b.mesh, { volume: Math.min(0.35, 0.05 + speed * 0.04), rate: 1.9 });
  }
}

/** Classic beach ball: six coloured gores, white caps at the poles. */
function ballTexture(): HTMLCanvasElement {
  const [c, g] = canvas(512, 256);
  const cols = ['#e8322a', '#ffffff', '#ffcc1a', '#1f6fe0', '#ffffff', '#2fb24a'];
  cols.forEach((col, k) => {
    g.fillStyle = col;
    g.fillRect((k / cols.length) * 512, 0, 512 / cols.length + 1, 256);
  });
  // Seams between the gores.
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let k = 0; k < cols.length; k++) g.fillRect((k / cols.length) * 512 - 1, 0, 2, 256);
  // Caps (the poles of the sphere are the top and bottom of the texture).
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 22);
  g.fillRect(0, 234, 512, 22);
  g.fillStyle = '#e8322a';
  g.fillRect(0, 0, 512, 6);
  g.fillRect(0, 250, 512, 6);
  return c;
}
