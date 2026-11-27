import * as THREE from 'three';
import type { Grabbable, Hand, Hands } from '../hands';
import type { Interaction } from '../interaction';
import type { Crowd, Look, Person } from '../people';
import { randomLook, staffLook } from '../people';
import type { Player } from '../player';
import type { Quality } from '../quality';
import { armTo } from '../party/decks';
import { canvas, radial, toTexture } from '../textures';
import { ballTexture, CONSOLE, FASCIA, MONITOR, pinGeometry, pinTexture, type Alley } from './alley';
import { BowlSound } from './audio';
import { APPROACH_END, BAR, FACE_PINS, FOUL_X, HOUSE_BALLS, laneAt, laneZ, LANES, onBowling, RACK, RETURNS, RIG_FACE_PINS, ROOM, SHOES, toLane } from './plan';
import { frames, LaneGame, MAX_PLAYERS, position, rackFor, runningTotal, type RollKind, type RollResult } from './score';
import { BALL_R, DECK_END, HEAD_Z, HIT, LaneSim, lbToKg, PIN_COM, type Launch } from './sim';
import { launchFromHand, launchFromMeter, meterPower } from './throw';

/**
 * The game at Palazzo Lanes: eight lanes, each with its own physics (sim.ts)
 * and scoring (score.ts), the house balls on their returns, the pinsetters,
 * the overhead monitors, and the regulars bowling on the outer lanes.
 *
 * VR: take a ball off the return (grip), walk up, swing your arm and let go:
 * the ball leaves with your hand's speed, a little help keeps it on the lane,
 * and your wrist's twist at the release hooks it (throw.ts). Step over the
 * foul line and it's a foul. On a screen: click a ball and you take your
 * stance; A/D (or the stick) to move, the mouse to aim, hold to swing back,
 * drag sideways (or ←/→) for spin, let go to throw.
 *
 * Friends (net/bowlsync.ts) join your lane and take turns: the bowler's game
 * runs the physics and streams the ball and pins (~20 Hz) to the others, who
 * play it back smoothly; when the pins settle the bowler's count is final.
 */

type Phase = 'ready' | 'rolling' | 'sweep';

/** A house ball. */
interface Ball {
  id: number;
  ret: number;
  slot: number;
  lb: number;
  color: THREE.Color;
  state: 'rack' | 'held' | 'lane' | 'return' | 'friend' | 'npc' | 'stance';
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  lane: number;
  /** Seconds into its trip back to the rack. */
  t: number;
  hand: Hand | null;
  /** Who holds it (a friend's id, or an NPC). */
  holder: string | null;
  npc: NpcBowler | null;
}

interface Remote {
  /** Stream samples (sim time → state), oldest first. */
  samples: { t: number; at: number; b: Float32Array; p: Float32Array; on: number }[];
  clock: number;
}

interface Lane {
  i: number;
  sim: LaneSim;
  game: LaneGame;
  phase: Phase;
  t: number;
  owner: 'me' | 'remote' | 'npc' | null;
  bowler: string | null;
  ball: Ball | null;
  foul: boolean;
  before: number;
  dirty: boolean;
  npc: boolean;
  /** The pinsetter's cycle: which pins stay (and stand again), whether a fresh rack comes down. */
  sweep: { keep: number; fresh: boolean; spots: boolean; done: boolean } | null;
  remote: Remote | null;
  sendT: number;
  seenImpacts: number;
  /** Seconds the foul lamp stays lit. */
  foulT: number;
  /** The result waiting to be shown once the pins settle (from a friend's final word). */
  pendingFinal: Record<string, unknown> | null;
}

interface NpcBowler {
  person: Person;
  lane: number;
  name: string;
  /** Where they wait: a spot standing by the console, or a sofa seat. */
  home: { x: number; z: number; yaw: number; seat: boolean };
  phase: 'wait' | 'fetch' | 'stance' | 'approach' | 'watch' | 'back';
  t: number;
  ball: Ball | null;
  swing: number;
  rng: () => number;
  from: THREE.Vector3;
  to: THREE.Vector3;
}

/** How the alley talks to the room (net/bowlsync.ts). */
export interface BowlNet {
  self: string;
  host: boolean;
  send(d: Record<string, unknown>): void;
  stream(d: Record<string, unknown>): void;
  /** A friend's right wrist (to show the ball they're holding), if known. */
  hand(id: string): THREE.Vector3 | null;
}

const BANNERS: Record<string, number> = { strike: 0, spare: 1, double: 2, turkey: 3, gutter: 4, foul: 5 };
const BANNER_TEXT = ['STRIKE!', 'SPARE!', 'DOUBLE!', 'TURKEY!', 'GUTTER', 'FOUL'];
const NPC_NAMES = ['Marco', 'Gianni', 'Sofia', 'Rocco', 'Dee', 'Lou'];
/** The regulars' lanes. */
const NPC_LANES = [0, 1, 6, 7];
const SEND_EVERY = 0.05;
const RACK_Y = RACK.y - 0.015;
const SWEEP_SECS = 3.0;

/** Where a ball sits on its return's rack (slot 0 at the end stop). */
function rackSpot(ret: number, slot: number, out: THREE.Vector3) {
  return out.set(RACK.x1 - 0.13 - slot * 0.222, RACK_Y, RETURNS[ret].z);
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BowlingDeps {
  scene: THREE.Scene;
  q: Quality;
  alley: Alley;
  interaction: Interaction;
  player: Player;
  hands: Hands;
  sound: import('../audio').Sound;
  toast: (t: string) => void;
  /** The canvas (a press there swings, on a screen). */
  dom: HTMLElement;
}

export class Bowling {
  readonly lanes: Lane[] = [];
  readonly balls: Ball[] = [];
  readonly sound: BowlSound;
  /** Your name on the monitors. */
  name: () => string = () => 'You';
  net: BowlNet | null = null;
  /** Desktop/phone: your stance at a lane with a ball, or null. */
  stance: { lane: number; ball: Ball; x: number; holding: boolean; held: number; spin: number; power: number; wait: number } | null = null;
  readonly npcs: NpcBowler[] = [];
  /** Throws made here (yours, friends', the regulars'), for tests. */
  throws = 0;
  private pins: THREE.InstancedMesh;
  private ballMesh: THREE.InstancedMesh;
  private sweeps: THREE.InstancedMesh;
  private banner: THREE.Mesh;
  private bannerT = -1;
  private sparks: THREE.InstancedMesh;
  private sparkV: Float32Array;
  private sparkP: Float32Array;
  private here = false;
  private time = 0;
  private monT = 0;
  private hud: HTMLDivElement | null = null;
  private keys = new Set<string>();
  private twist = new Map<Hand, { q: THREE.Quaternion; w: THREE.Vector3; t: number }>();
  private m4 = new THREE.Matrix4();
  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private qa = new THREE.Quaternion();
  private qb = new THREE.Quaternion();
  private s1 = new THREE.Vector3(1, 1, 1);
  private zero = new THREE.Vector3(0, 0, 0);
  private laneQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
  private consoleItems: import('../interaction').Interactable[] = [];

  constructor(private d: BowlingDeps) {
    const { alley } = d;
    this.sound = new BowlSound(d.sound, alley.root);
    for (let i = 0; i < LANES; i++) {
      const sim = new LaneSim();
      sim.assist = 1;
      this.lanes.push({ i, sim, game: new LaneGame(), phase: 'ready', t: 0, owner: null, bowler: null, ball: null, foul: false, before: 0x3ff, dirty: true, npc: NPC_LANES.includes(i), sweep: null, remote: null, sendT: 0, seenImpacts: 0, foulT: 0, pendingFinal: null });
    }
    // Pins: one instanced mesh for every lane.
    const pinTex = toTexture(pinTexture());
    this.pins = new THREE.InstancedMesh(pinGeometry(), new THREE.MeshStandardMaterial({ map: pinTex, roughness: 0.22, envMapIntensity: 1.1, emissive: 0xffffff, emissiveMap: pinTex, emissiveIntensity: 0.32 }), LANES * 10);
    this.pins.frustumCulled = false;
    this.pins.raycast = () => {};
    this.pins.name = 'bowling-pins';
    alley.root.add(this.pins);
    // Balls: one instanced mesh (a colour each), the house finish's swirl and finger holes.
    const bt = toTexture(ballTexture());
    this.ballMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(BALL_R, 22, 16), new THREE.MeshStandardMaterial({ map: bt, roughness: 0.14, metalness: 0.05, envMapIntensity: 1.5, emissive: 0xffffff, emissiveMap: bt, emissiveIntensity: 0.06 }), RETURNS.length * HOUSE_BALLS.length);
    this.ballMesh.frustumCulled = false;
    this.ballMesh.name = 'bowling-balls';
    alley.root.add(this.ballMesh);
    RETURNS.forEach((_, r) =>
      HOUSE_BALLS.forEach((hb, k) => {
        const id = this.balls.length;
        const ball: Ball = { id, ret: r, slot: k, lb: hb.lb, color: new THREE.Color(hb.color), state: 'rack', pos: rackSpot(r, k, new THREE.Vector3()), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3 * k, 1.1 * k + r, 0.2)), lane: -1, t: 0, hand: null, holder: null, npc: null };
        this.balls.push(ball);
        this.ballMesh.setColorAt(id, ball.color);
        d.hands.register(this.grabbable(ball));
      }),
    );
    if (this.ballMesh.instanceColor) this.ballMesh.instanceColor.needsUpdate = true;
    d.interaction.register({
      object: this.ballMesh,
      label: (e) => {
        const b = this.balls[e.hit.instanceId ?? -1];
        return b && b.state === 'rack' && !this.stance ? `Pick up the ${b.lb} lb ball` : null;
      },
      enabled: () => !d.player.inXR && !this.stance,
      onSelect: (e) => {
        const b = this.balls[e.hit.instanceId ?? -1];
        if (b && b.state === 'rack') this.pickUp(b);
      },
    });
    // The pinsetters' sweep bars.
    this.sweeps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.12, 1.08), new THREE.MeshStandardMaterial({ color: 0x1a1a1e, metalness: 0.6, roughness: 0.35, emissive: 0x302010, emissiveIntensity: 0.4 }), LANES);
    this.sweeps.frustumCulled = false;
    this.sweeps.raycast = () => {};
    alley.root.add(this.sweeps);
    // The STRIKE!/SPARE! banner and its sparks.
    this.banner = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.6), new THREE.MeshBasicMaterial({ map: bannerTexture(), transparent: true, depthWrite: false, toneMapped: false }));
    const bm = this.banner.material as THREE.MeshBasicMaterial;
    bm.map!.repeat.set(1, 1 / 6);
    this.banner.rotation.y = Math.PI / 2;
    this.banner.visible = false;
    this.banner.renderOrder = 5;
    this.banner.raycast = () => {};
    alley.root.add(this.banner);
    this.sparks = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.07, 0.07),
      new THREE.MeshBasicMaterial({ map: toTexture(radial(64, 'rgba(255,240,200,1)', 'rgba(255,160,60,0)')), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
      36,
    );
    this.sparks.count = 0;
    this.sparks.frustumCulled = false;
    this.sparks.raycast = () => {};
    alley.root.add(this.sparks);
    this.sparkV = new Float32Array(36 * 3);
    this.sparkP = new Float32Array(36 * 3);
    // Lane consoles: join, leave, new game.
    alley.consoles.meshes.forEach((mesh, k) => {
      const li = Number(mesh.name.split('-').pop());
      this.consoleItems.push(
        d.interaction.register({
          object: mesh,
          label: (e) => this.consoleButton(li, e.hit.uv)?.label ?? `Lane ${li + 1}`,
          onSelect: (e) => {
            const btn = this.consoleButton(li, e.hit.uv);
            btn?.run();
          },
        }),
      );
      void k;
    });
    // NPC lanes: the regulars' games.
    for (const li of NPC_LANES) {
      const lane = this.lanes[li];
      lane.game.join(`npc-${li}-a`, NPC_NAMES[(li * 2) % NPC_NAMES.length]);
      if (li % 2 === 0) lane.game.join(`npc-${li}-b`, NPC_NAMES[(li * 2 + 1) % NPC_NAMES.length]);
    }
    this.drawConsoles();
    this.input();
    this.placeAll();
  }

  // --- Input (screens) --------------------------------------------------------------------

  private input() {
    const dom = this.d.interaction as unknown as { onLook: ((dx: number, dy: number) => void) | null; onDrag: ((dx: number, dy: number) => void) | null };
    const look = dom.onLook,
      drag = dom.onDrag;
    // While you're swinging, sideways mouse (or a sideways drag on a phone) twists the ball instead of looking.
    dom.onLook = (dx, dy) => {
      if (this.stance?.holding) return void (this.stance.spin = THREE.MathUtils.clamp(this.stance.spin - dx * 0.006, -1, 1));
      look?.(dx, this.stance ? dy * 0.3 : dy);
    };
    dom.onDrag = (dx, dy) => {
      if (this.stance?.holding) return void (this.stance.spin = THREE.MathUtils.clamp(this.stance.spin + dx * 0.008, -1, 1));
      drag?.(dx, this.stance ? dy * 0.3 : dy);
    };
    this.d.dom.addEventListener('pointerdown', (e) => {
      if (!this.stance || this.d.player.inXR || e.button > 0) return;
      this.startSwing();
    });
    addEventListener('pointerup', () => {
      if (this.stance?.holding) this.releaseSwing();
    });
    addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      this.keys.add(e.code);
      if (!this.stance) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) this.startSwing();
      }
      if (e.code === 'KeyS' || e.code === 'KeyW' || e.code === 'KeyE' || e.code === 'Backspace') this.leaveStance(true);
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space' && this.stance?.holding) this.releaseSwing();
    });
    addEventListener('blur', () => this.keys.clear());
  }

  private startSwing() {
    const s = this.stance;
    if (!s || s.holding || s.wait > 0) return;
    const lane = this.lanes[s.lane];
    if (lane.phase !== 'ready') return;
    s.holding = true;
    s.held = 0;
  }

  private releaseSwing() {
    const s = this.stance;
    if (!s || !s.holding) return;
    s.holding = false;
    if (s.held < 0.12) return; // a tap: no throw
    const launch = launchFromMeter({ x: s.x, aim: this.d.player.rig.rotation.y - RIG_FACE_PINS, power: s.power, spin: s.spin });
    const lane = this.lanes[s.lane];
    this.sound.shot('whoosh', this.d.player.feet().setY(0.6), 0.4, 1.1);
    this.bowl(lane, s.ball, launch, false);
    s.wait = 0.4;
  }

  // --- Picking up a ball ------------------------------------------------------------------

  /** The lane a return's ball is for: the one you're playing on, else the nearer free one. */
  private laneFor(ball: Ball, at: THREE.Vector3): number {
    const [a, b] = RETURNS[ball.ret].lanes;
    const me = this.selfId;
    for (const li of [a, b]) if (this.lanes[li].game.has(me)) return li;
    const free = [a, b].filter((li) => !this.lanes[li].npc && this.lanes[li].game.players.length < MAX_PLAYERS);
    if (!free.length) return -1;
    return free.sort((x, y) => Math.abs(at.z - laneZ(x)) - Math.abs(at.z - laneZ(y)))[0];
  }

  get selfId() {
    return this.net?.self ?? 'me';
  }

  /** Joins you to a lane's game (and tells friends). */
  join(li: number): boolean {
    const lane = this.lanes[li];
    if (lane.npc) {
      this.d.toast('That lane is taken: the regulars are bowling a game');
      return false;
    }
    if (lane.game.has(this.selfId)) return true;
    if (!lane.game.join(this.selfId, this.name())) {
      this.d.toast(`Lane ${li + 1} is full (four bowlers)`);
      return false;
    }
    lane.dirty = true;
    this.net?.send({ k: 'join', l: li, id: this.selfId, n: this.name() });
    this.d.toast(`You're on lane ${li + 1}${lane.game.players.length > 1 ? ` with ${lane.game.players.length - 1} other${lane.game.players.length > 2 ? 's' : ''}` : ''}`);
    return true;
  }

  leave(li: number) {
    const lane = this.lanes[li];
    if (!lane.game.has(this.selfId)) return;
    lane.game.leave(this.selfId);
    lane.dirty = true;
    this.net?.send({ k: 'leave', l: li, id: this.selfId });
    if (this.stance?.lane === li) this.leaveStance(true);
  }

  newGame(li: number) {
    const lane = this.lanes[li];
    if (!lane.game.has(this.selfId) || lane.phase === 'rolling') return;
    lane.game.reset();
    lane.dirty = true;
    this.net?.send({ k: 'new', l: li });
    this.startSweep(lane, 0, true);
  }

  /** Is it your ball on this lane? (Toasts why not.) */
  private myTurn(lane: Lane, quiet = false): boolean {
    const cur = lane.game.current;
    if (lane.phase !== 'ready') {
      if (!quiet) this.d.toast(lane.phase === 'sweep' ? 'Wait for the pinsetter' : 'The ball is still rolling');
      return false;
    }
    if (!cur) {
      if (!quiet) this.d.toast('Game over: press NEW GAME on the console');
      return false;
    }
    if (cur.id !== this.selfId) {
      if (!quiet) this.d.toast(`It's ${cur.name}'s ball`);
      return false;
    }
    return true;
  }

  /** Desktop / phone: take a ball off the rack and step up to your lane. */
  pickUp(ball: Ball) {
    if (this.d.player.inXR) return;
    const li = this.laneFor(ball, this.d.player.feet());
    if (li < 0) return void this.d.toast('Both of these lanes are taken');
    if (!this.join(li)) return;
    const lane = this.lanes[li];
    if (!this.myTurn(lane)) return;
    ball.state = 'stance';
    this.net?.send({ k: 'take', b: ball.id, id: this.selfId });
    this.enterStance(li, ball);
  }

  private enterStance(li: number, ball: Ball) {
    const p = this.d.player;
    this.stance = { lane: li, ball, x: this.stance?.lane === li ? this.stance.x : -0.12, holding: false, held: 0, spin: 0, power: 0, wait: 0.3 };
    p.held = true;
    const V = THREE.Vector3;
    p.place({ id: 'bowl', label: '', position: new V(FOUL_X + 2.1, 0, laneZ(li) + this.stance.x), yaw: RIG_FACE_PINS, pitch: -0.1, eye: 1.62 });
    p.current = null;
    p.lockPointer();
    this.showHud(true);
  }

  /** Steps back from the line; the ball goes back on the rack if you still have it. */
  leaveStance(returnBall: boolean) {
    const s = this.stance;
    if (!s) return;
    if (returnBall && s.ball.state === 'stance') this.toRack(s.ball, true);
    this.stance = null;
    this.d.player.held = false;
    this.showHud(false);
  }

  private grabbable(ball: Ball): Grabbable {
    const off = new THREE.Vector3(0, -0.075, 0.02);
    return {
      at: () => ball.pos,
      radius: BALL_R + 0.1,
      enabled: () => ball.state === 'rack' && this.d.player.inXR,
      grab: (hand) => {
        ball.state = 'held';
        ball.hand = hand;
        this.twist.delete(hand);
        this.net?.send({ k: 'take', b: ball.id, id: this.selfId });
        this.sound.shot('clunk', ball.pos, 0.25, 1.4);
        return 'drag';
      },
      drag: (hand, pos) => {
        // The ball sits in the hand (fingers in the holes): under the palm, a touch forward.
        hand.grip.getWorldQuaternion(this.qa);
        ball.pos.copy(off).applyQuaternion(this.qa).add(pos);
        ball.quat.copy(this.qa);
        this.trackTwist(hand);
      },
      release: (hand, pos) => {
        ball.hand = null;
        const v = this.d.hands.velocity(hand);
        const tw = this.twist.get(hand)?.w ?? this.zero;
        this.vrRelease(ball, pos.clone().add(off.clone().applyQuaternion(this.qa)), v, tw);
      },
    };
  }

  /** The wrist's angular velocity (world, smoothed over ~50 ms) while holding a ball. */
  private trackTwist(hand: Hand) {
    const now = performance.now() / 1000;
    hand.grip.getWorldQuaternion(this.qb);
    let s = this.twist.get(hand);
    if (!s) {
      this.twist.set(hand, { q: this.qb.clone(), w: new THREE.Vector3(), t: now });
      return;
    }
    const dt = now - s.t;
    if (dt < 0.004) return;
    // dq = q · prev⁻¹: its axis-angle over dt.
    const dq = this.qa.copy(this.qb).multiply(s.q.clone().invert());
    if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
    const ang = 2 * Math.acos(Math.min(1, dq.w));
    const sn = Math.sqrt(Math.max(1e-12, 1 - dq.w * dq.w));
    const k = 1 - Math.exp(-dt / 0.05);
    s.w.x += ((dq.x / sn) * (ang / dt) - s.w.x) * k;
    s.w.y += ((dq.y / sn) * (ang / dt) - s.w.y) * k;
    s.w.z += ((dq.z / sn) * (ang / dt) - s.w.z) * k;
    s.q.copy(this.qb);
    s.t = now;
  }

  /** VR: you let go of a ball. A swing down a lane throws it; anything else sets it back on the rack. */
  vrRelease(ball: Ball, at: THREE.Vector3, vel: THREE.Vector3, twist: THREE.Vector3) {
    const li = at.x < APPROACH_END + 0.8 && at.x > FOUL_X - 1.2 ? laneAt(at.z) : -1;
    const lane = li >= 0 ? this.lanes[li] : null;
    const lp = lane ? toLane(li, at.x, at.z) : null;
    // Lane frame: x = world z (the bowler's left), z = -world x (down the lane).
    const launch = lp
      ? launchFromHand({ x: lp.x, y: at.y, z: lp.z, vx: vel.z, vy: vel.y, vz: -vel.x, twist: -twist.x })
      : null;
    if (!lane || !launch) {
      this.toRack(ball, true);
      if (lane && vel.length() > 0.4) this.d.toast('Swing toward the pins and let go as your hand comes forward');
      return;
    }
    if (lane.npc) {
      this.toRack(ball, true);
      return void this.d.toast('That lane is taken: the regulars are bowling a game');
    }
    if (!lane.game.has(this.selfId) && !this.join(li)) return void this.toRack(ball, true);
    if (!this.myTurn(lane)) return void this.toRack(ball, true);
    // Over the line (your feet, or the ball let go past it): a foul.
    const feet = toLane(li, this.d.player.feet().x, this.d.player.feet().z);
    const foul = feet.z > 0.02 || lp!.z > 0.25;
    this.bowl(lane, ball, launch, foul);
  }

  /** A ball goes back to its rack (rolls out of the hood after a beat if `trip`). */
  private toRack(ball: Ball, quick: boolean) {
    ball.state = 'return';
    ball.t = quick ? 1.2 : 0;
    ball.hand = null;
    ball.holder = null;
    ball.npc = null;
    ball.lane = -1;
    this.net?.send({ k: 'put', b: ball.id });
  }

  // --- Bowling --------------------------------------------------------------------------

  /** Your throw (or a regular's): the ball's on the lane. */
  private bowl(lane: Lane, ball: Ball, launch: Launch, foul: boolean, npc = false) {
    lane.sim.setBallMass(lbToKg(ball.lb));
    lane.sim.launch(launch);
    lane.phase = 'rolling';
    lane.t = 0;
    lane.owner = npc ? 'npc' : 'me';
    lane.bowler = npc ? (lane.game.current?.id ?? null) : this.selfId;
    lane.ball = ball;
    lane.foul = foul;
    lane.before = lane.sim.standingMask();
    lane.seenImpacts = 0;
    lane.sendT = 0;
    ball.state = 'lane';
    ball.lane = lane.i;
    ball.hand = null;
    this.throws++;
    if (foul) this.foul(lane);
    if (!npc)
      this.net?.send({ k: 'roll', l: lane.i, b: ball.id, id: this.selfId, s: lane.game.balls, f: foul ? 1 : 0, L: [launch.x, launch.y, launch.z, launch.vx, launch.vy, launch.vz, launch.wx, launch.wy, launch.wz].map((n) => Math.round(n * 1000) / 1000) });
  }

  private foul(lane: Lane) {
    lane.foulT = 2.5;
    this.sound.shot('buzz', new THREE.Vector3(FOUL_X, 0.4, laneZ(lane.i)), 0.7, 1, 3, 1);
  }

  /** The pins have settled: count, score, celebrate, and start the pinsetter. */
  private settle(lane: Lane) {
    const after = lane.sim.standingMask();
    const knocked = popcount(lane.before & ~after);
    const id = lane.bowler;
    let res: RollResult | null = null;
    if (id) res = lane.game.roll(id, knocked, lane.foul);
    if (res) this.celebrate(lane, res, lane.sim.gutterSide !== 0 && knocked === 0);
    // Tell everyone the final count and where the standing pins stand (the authoritative word).
    if (lane.owner === 'me') {
      const P: number[][] = [];
      for (let p = 0; p < 10; p++) if ((after >> p) & 1) P.push([p, round3(lane.sim.pos[3 * (p + 1)]), round3(lane.sim.pos[3 * (p + 1) + 2])]);
      this.net?.send({ k: 'done', l: lane.i, id, s: lane.game.balls - 1, n: knocked, f: lane.foul ? 1 : 0, m: after, P });
    }
    lane.dirty = true;
    // A foul: its pins are respotted (the next ball faces the same pins as this one did).
    const rolls = id ? (lane.game.players.find((p) => p.id === id)?.rolls ?? []) : [];
    void rolls;
    const keep = lane.foul ? lane.before : after;
    // The next bowler's rack: their own frame's leftover, or a fresh ten.
    const next = lane.game.current;
    const fresh = next ? rackFor(next.rolls) === 'full' || next.id !== id : true;
    this.startSweep(lane, keep, fresh, lane.foul);
    if (lane.ball) this.toRack(lane.ball, false);
    lane.ball = null;
    lane.owner = null;
  }

  private startSweep(lane: Lane, keep: number, fresh: boolean, spots = false) {
    lane.phase = 'sweep';
    lane.t = 0;
    lane.sweep = { keep: fresh ? 0 : keep, fresh, spots, done: false };
    this.sound.shot('whoosh', new THREE.Vector3(FOUL_X - HEAD_Z, 0.6, laneZ(lane.i)), 0.35, 0.6, 3);
  }

  private celebrate(lane: Lane, res: RollResult, gutter: boolean) {
    const kind: RollKind | 'gutter' = res.kind === 'open' && gutter ? 'gutter' : res.kind;
    const mine = res.player.id === this.selfId;
    const players = !lane.npc;
    const at = new THREE.Vector3(MONITOR.x, MONITOR.y, laneZ(lane.i));
    if (kind in BANNERS && (players || kind === 'strike' || kind === 'double' || kind === 'turkey')) this.showBanner(lane.i, BANNERS[kind]);
    if (kind === 'strike' || kind === 'double' || kind === 'turkey') {
      this.sound.crowd('cheer', at.clone().setX(FOUL_X + 4), players ? 0.75 : 0.3);
      if (mine) this.d.toast(kind === 'turkey' ? 'TURKEY! Three strikes in a row' : kind === 'double' ? 'DOUBLE! Two strikes in a row' : 'STRIKE!');
    } else if (kind === 'spare') {
      this.sound.crowd('applause', at.clone().setX(FOUL_X + 4), players ? 0.55 : 0.2);
      if (mine) this.d.toast('SPARE!');
    }
  }

  private showBanner(li: number, idx: number) {
    this.bannerT = 0;
    const m = this.banner.material as THREE.MeshBasicMaterial;
    m.map!.offset.set(0, 1 - (idx + 1) / 6);
    this.banner.position.set(MONITOR.x + 0.25, MONITOR.y - 0.05, laneZ(li));
    this.banner.visible = true;
    // Sparks burst from the banner (strikes and spares).
    if (idx <= 3) {
      this.sparks.count = 36;
      const r = mulberry(li * 31 + this.throws);
      for (let k = 0; k < 36; k++) {
        this.sparkP.set([this.banner.position.x + 0.05, this.banner.position.y, this.banner.position.z], k * 3);
        const a = r() * Math.PI * 2,
          s = 0.8 + r() * 1.6;
        this.sparkV.set([0.3 + r() * 0.6, Math.sin(a) * s + 0.8, Math.cos(a) * s * 1.4], k * 3);
      }
    }
  }

  // --- Frame --------------------------------------------------------------------------

  update(dt: number, feet: THREE.Vector3) {
    this.time += dt;
    this.here = onBowling(feet.x);
    this.sound.update(dt, this.here);
    if (!this.here) {
      // Away: the regulars' games pause (nobody's watching); your own lane's ball finishes.
      for (const lane of this.lanes) if (lane.phase === 'rolling' && lane.owner === 'me') lane.sim.step(dt);
      if (this.stance) this.leaveStance(true);
      return;
    }
    if (this.stance) this.updateStance(dt);
    for (const lane of this.lanes) this.updateLane(lane, dt);
    this.updateBalls(dt);
    this.updateNpcs(dt);
    this.updateBanner(dt);
    this.placeAll();
    this.monT -= dt;
    if (this.monT <= 0 && this.lanes.some((l) => l.dirty)) {
      this.monT = 0.4;
      this.drawMonitors();
      this.drawConsoles();
    }
  }

  private updateLane(lane: Lane, dt: number) {
    lane.t += dt;
    if (lane.foulT > 0) lane.foulT -= dt;
    if (lane.phase === 'rolling') {
      // A friend's roll whose result never came (they left): the pinsetter clears it.
      if (lane.owner === 'remote' && lane.t > 25) {
        lane.owner = null;
        lane.remote = null;
        if (lane.ball) this.toRackRemote(lane.ball);
        lane.ball = null;
        this.startSweep(lane, 0, true);
        return;
      }
      if (lane.owner === 'remote') this.playRemote(lane, dt);
      else {
        lane.sim.step(dt);
        this.impacts(lane);
        if (lane.owner === 'me') this.streamOut(lane, dt);
        if (lane.sim.settled && lane.t > 1) this.settle(lane);
      }
      // The ball's rumble.
      const s = lane.sim;
      if (s.active[0] && (s.ballPhase === 'lane' || s.ballPhase === 'gutter')) {
        this.laneToWorld(lane.i, s.pos[0], s.pos[1], s.pos[2], this.v);
        this.v2.set(-s.vel[2], s.vel[1], s.vel[0]);
        this.sound.roll(lane.i, this.v, this.v2, s.ballPhase === 'gutter');
      }
    } else if (lane.phase === 'sweep' && lane.sweep) {
      const sw = lane.sweep;
      // Halfway: the dead wood is gone, the table sets the pins (the ones kept, or a fresh rack).
      if (!sw.done && lane.t > 1.75) {
        sw.done = true;
        if (sw.fresh) lane.sim.rack(0x3ff);
        else if (sw.spots) lane.sim.rack(sw.keep);
        else lane.sim.respot(sw.keep);
        lane.sim.clearBall();
        lane.dirty = true;
      }
      if (lane.t > SWEEP_SECS) {
        lane.phase = 'ready';
        lane.sweep = null;
        lane.dirty = true;
        // On a screen, still at the line and it's your ball again: the ball comes back to your hand.
        if (this.stance?.lane === lane.i && this.stance.ball.state !== 'stance') this.stance.wait = 0.2;
      }
    }
    if (lane.pendingFinal && lane.phase !== 'rolling') lane.pendingFinal = null;
  }

  /** Sounds for what the sim hit since last frame. */
  private impacts(lane: Lane) {
    const s = lane.sim;
    const n = s.impactCount;
    let budget = 3;
    for (let k = Math.max(lane.seenImpacts, n - s.impacts.length); k < n && budget > 0; k++) {
      const e = s.impacts[k % s.impacts.length];
      this.laneToWorld(lane.i, e.x, e.y, e.z, this.v);
      const sp = e.speed;
      switch (e.kind) {
        case HIT.ballPin:
          if (sp > 1) {
            this.sound.shot(sp > 4 ? 'crack' : 'tock', this.v, Math.min(1.3, 0.3 + sp * 0.14), 0.92 + (k % 5) * 0.03, 3);
            if (sp > 4) this.sound.shot('clatter', this.v, Math.min(1.2, 0.4 + sp * 0.1), 1, 3);
            budget--;
          }
          break;
        case HIT.pinPin:
        case HIT.kickback:
          if (sp > 0.8) {
            this.sound.shot('tock', this.v, Math.min(0.9, 0.12 + sp * 0.12), 0.85 + ((k * 7) % 9) * 0.04, 2);
            budget--;
          }
          break;
        case HIT.pinDeck:
          if (sp > 1.2) {
            this.sound.shot('tock', this.v, Math.min(0.6, sp * 0.1), 0.6 + ((k * 3) % 5) * 0.05, 2);
            budget--;
          }
          break;
        case HIT.gutter:
          this.sound.shot('thunk', this.v, 0.8, 1.1, 2.5);
          budget--;
          break;
        case HIT.ballThud:
          this.sound.shot('thunk', this.v, Math.min(1.2, 0.3 + sp * 0.25), 0.8, 2.5);
          budget--;
          break;
        case HIT.cushion:
        case HIT.pit:
          this.sound.shot('thunk', this.v, Math.min(0.7, 0.2 + sp * 0.1), 0.6, 2.5);
          budget--;
          break;
      }
    }
    lane.seenImpacts = n;
  }

  /** Bowler: the ball and the moving pins to friends, ~20 times a second. */
  private streamOut(lane: Lane, dt: number) {
    if (!this.net) return;
    lane.sendT -= dt;
    if (lane.sendT > 0) return;
    lane.sendT = SEND_EVERY;
    const s = lane.sim;
    const r = (n: number) => Math.round(n * 1000);
    const b = [r(s.pos[0]), r(s.pos[1]), r(s.pos[2]), r(s.quat[0]), r(s.quat[1]), r(s.quat[2]), r(s.quat[3])];
    const p: number[] = [];
    // Pins that moved (all of them now and then, so a lost packet heals).
    const all = Math.floor(lane.t * 20) % 10 === 0;
    for (let k = 1; k <= 10; k++) {
      if (!all && !s.awake[k]) continue;
      p.push(k, s.active[k] ? 1 : 0, r(s.pos[3 * k]), r(s.pos[3 * k + 1]), r(s.pos[3 * k + 2]), r(s.quat[4 * k]), r(s.quat[4 * k + 1]), r(s.quat[4 * k + 2]), r(s.quat[4 * k + 3]));
    }
    this.net.stream({ l: lane.i, t: Math.round(s.time * 1000), b, p, g: s.ballPhase === 'gutter' ? 1 : 0 });
  }

  /** A friend's roll: play their stream back a beat behind, smoothly. */
  private playRemote(lane: Lane, dt: number) {
    const R = lane.remote;
    if (!R || !R.samples.length) return;
    R.clock += dt;
    const delay = 0.12;
    const t = R.clock - delay;
    const list = R.samples;
    while (list.length > 2 && list[1].at <= t) list.shift();
    const a = list[0],
      b = list[1] ?? list[0];
    const k = b.at > a.at ? THREE.MathUtils.clamp((t - a.at) / (b.at - a.at), 0, 1) : 1;
    const s = lane.sim;
    // Ball.
    s.active[0] = 1;
    s.ballPhase = a.on & 2 ? 'gutter' : 'lane';
    for (let c = 0; c < 3; c++) s.pos[c] = a.b[c] + (b.b[c] - a.b[c]) * k;
    this.qa.set(a.b[3], a.b[4], a.b[5], a.b[6]);
    this.qb.set(b.b[3], b.b[4], b.b[5], b.b[6]);
    this.qa.slerp(this.qb, k);
    s.quat[0] = this.qa.x;
    s.quat[1] = this.qa.y;
    s.quat[2] = this.qa.z;
    s.quat[3] = this.qa.w;
    // Velocity for the rumble.
    const span = Math.max(0.02, b.at - a.at);
    s.vel[0] = (b.b[0] - a.b[0]) / span;
    s.vel[1] = 0;
    s.vel[2] = (b.b[2] - a.b[2]) / span;
    // Pins.
    for (let i = 1; i <= 10; i++) {
      const o = 8 * (i - 1);
      if (!a.p[o] && !b.p[o]) continue;
      const x = a.p[o + 1] + (b.p[o + 1] - a.p[o + 1]) * k;
      const y = a.p[o + 2] + (b.p[o + 2] - a.p[o + 2]) * k;
      const z = a.p[o + 3] + (b.p[o + 3] - a.p[o + 3]) * k;
      this.qa.set(a.p[o + 4], a.p[o + 5], a.p[o + 6], a.p[o + 7]);
      this.qb.set(b.p[o + 4], b.p[o + 5], b.p[o + 6], b.p[o + 7]);
      if (this.qa.lengthSq() < 0.5) this.qa.copy(this.qb);
      if (this.qb.lengthSq() < 0.5) this.qb.copy(this.qa);
      this.qa.slerp(this.qb, k);
      const on = (a.on >> (i + 1)) & 1 || (b.on >> (i + 1)) & 1;
      if (y < -2) continue;
      s.setPin(i, x, y, z, this.qa.x, this.qa.y, this.qa.z, this.qa.w, !!on || y > -0.5);
    }
    // A strike's crash on this side too (from the stream's motion): one crack when the pins first move.
    if (!R.samples.length) return;
  }

  /** A stream packet from the bowler. */
  receiveStream(d: Record<string, unknown>) {
    const li = Number(d.l);
    const lane = this.lanes[li];
    if (!lane || lane.owner !== 'remote') return;
    const R = (lane.remote ??= { samples: [], clock: 0 });
    const b = d.b as number[];
    const p = d.p as number[];
    if (!Array.isArray(b) || b.length !== 7 || !Array.isArray(p)) return;
    const prev = R.samples[R.samples.length - 1];
    const bs = new Float32Array(7);
    for (let c = 0; c < 7; c++) bs[c] = (Number(b[c]) || 0) / 1000;
    // Pins carry over from the last sample (only the moving ones are sent).
    const ps = prev ? prev.p.slice() : this.pinSnapshot(lane);
    let on = prev ? prev.on : this.pinOnMask(lane);
    for (let j = 0; j + 8 < p.length + 0; j += 9) {
      const i = Number(p[j]);
      if (!(i >= 1 && i <= 10)) continue;
      const o = 8 * (i - 1);
      ps[o] = 1;
      for (let c = 0; c < 7; c++) ps[o + 1 + c] = (Number(p[j + 2 + c]) || 0) / 1000;
      if (p[j + 1]) on |= 1 << (i + 1);
      else on &= ~(1 << (i + 1));
    }
    if (d.g) on |= 2;
    else on &= ~2;
    const t = (Number(d.t) || 0) / 1000;
    if (prev && t <= prev.t) return;
    if (!prev) R.clock = t;
    R.samples.push({ t, at: t, b: bs, p: ps, on });
    if (R.samples.length > 12) R.samples.shift();
    // The crash, heard here too: the first sample with pins moving fast.
    if (prev && !(prev.on & 1)) {
      for (let i = 1; i <= 10; i++) {
        const o = 8 * (i - 1);
        if (Math.abs(ps[o + 2] - prev.p[o + 2]) > 0.01 || Math.abs(ps[o + 3] - prev.p[o + 3]) > 0.03) {
          this.laneToWorld(li, bs[0], bs[1], bs[2], this.v);
          this.sound.shot('crack', this.v, 1, 1, 3);
          this.sound.shot('clatter', this.v, 0.9, 1, 3);
          R.samples[R.samples.length - 1].on |= 1;
          break;
        }
      }
    } else if (prev) R.samples[R.samples.length - 1].on |= prev.on & 1;
  }

  private pinSnapshot(lane: Lane) {
    const ps = new Float32Array(80);
    const s = lane.sim;
    for (let i = 1; i <= 10; i++) {
      const o = 8 * (i - 1);
      ps[o] = 1;
      ps[o + 1] = s.pos[3 * i];
      ps[o + 2] = s.pos[3 * i + 1];
      ps[o + 3] = s.pos[3 * i + 2];
      ps[o + 4] = s.quat[4 * i];
      ps[o + 5] = s.quat[4 * i + 1];
      ps[o + 6] = s.quat[4 * i + 2];
      ps[o + 7] = s.quat[4 * i + 3];
    }
    return ps;
  }

  private pinOnMask(lane: Lane) {
    let on = 0;
    for (let i = 1; i <= 10; i++) if (lane.sim.active[i]) on |= 1 << (i + 1);
    return on;
  }

  // --- Friends' events (net/bowlsync.ts) -------------------------------------------------

  receive(from: string, d: Record<string, unknown>) {
    const li = Number(d.l);
    const lane = Number.isInteger(li) ? this.lanes[li] : undefined;
    const ball = Number.isInteger(d.b) ? this.balls[d.b as number] : undefined;
    switch (d.k) {
      case 'join':
        if (lane && !lane.npc && typeof d.id === 'string') {
          lane.game.join(d.id, String(d.n ?? 'Friend'));
          lane.dirty = true;
        }
        break;
      case 'leave':
        if (lane && typeof d.id === 'string') {
          lane.game.leave(d.id);
          lane.dirty = true;
        }
        break;
      case 'new':
        if (lane && lane.phase !== 'rolling') {
          lane.game.reset();
          lane.dirty = true;
          this.startSweep(lane, 0, true);
        }
        break;
      case 'take':
        if (ball && (ball.state === 'rack' || ball.state === 'return')) {
          ball.state = 'friend';
          ball.holder = String(d.id ?? from);
        }
        break;
      case 'put':
        if (ball && (ball.state === 'friend' || ball.state === 'lane')) this.toRackRemote(ball);
        break;
      case 'roll': {
        if (!lane || lane.npc || !Array.isArray(d.L)) break;
        const L = (d.L as number[]).map(Number);
        lane.phase = 'rolling';
        lane.t = 0;
        lane.owner = 'remote';
        lane.bowler = String(d.id ?? from);
        lane.foul = !!d.f;
        lane.before = lane.sim.standingMask();
        lane.remote = { samples: [], clock: 0 };
        lane.ball = ball ?? null;
        if (ball) {
          ball.state = 'lane';
          ball.lane = lane.i;
          ball.holder = null;
        }
        lane.sim.launch({ x: L[0], y: L[1], z: L[2], vx: L[3], vy: L[4], vz: L[5], wx: L[6], wy: L[7], wz: L[8] });
        if (lane.foul) this.foul(lane);
        this.throws++;
        break;
      }
      case 'done': {
        if (!lane || lane.npc) break;
        const id = String(d.id ?? from);
        const n = Number(d.n) || 0;
        // Only the ball we expect (a repeat or a stale message is ignored).
        if (Number(d.s) !== lane.game.balls) break;
        const res = lane.game.roll(id, n, !!d.f);
        if (res) this.celebrate(lane, res, false);
        // The pins as the bowler saw them: the standing ones where they stand, the rest gone.
        const m = Number(d.m) || 0;
        const P = Array.isArray(d.P) ? (d.P as number[][]) : [];
        // Pins the stream left standing that the bowler saw fall go; the standing ones stand where the bowler's did.
        for (let p = 0; p < 10; p++) if (!((m >> p) & 1) && lane.sim.pinUp(p)) lane.sim.placePin(p + 1, 0, 0, false);
        for (const [p, x, z] of P) if (p >= 0 && p < 10) lane.sim.placePin(p + 1, Number(x) || 0, Number(z) || 0, true);
        const next = lane.game.current;
        const fresh = next ? rackFor(next.rolls) === 'full' || next.id !== id : true;
        this.startSweep(lane, d.f ? lane.before : m, fresh, !!d.f);
        if (lane.ball) this.toRackRemote(lane.ball);
        lane.ball = null;
        lane.owner = null;
        lane.remote = null;
        lane.dirty = true;
        break;
      }
    }
  }

  private toRackRemote(ball: Ball) {
    ball.state = 'return';
    ball.t = 0.6;
    ball.holder = null;
    ball.lane = -1;
  }

  /** Everything a friend who walks in needs (host → them). */
  snapshot(): Record<string, unknown> {
    return {
      lanes: this.lanes.filter((l) => !l.npc).map((l) => ({ l: l.i, p: l.game.players.map((p) => [p.id, p.name, p.rolls, p.fouls.map((f) => (f ? 1 : 0))]), m: l.sim.standingMask() })),
    };
  }

  applySnapshot(d: Record<string, unknown>) {
    const lanes = Array.isArray(d.lanes) ? (d.lanes as Record<string, unknown>[]) : [];
    for (const s of lanes) {
      const lane = this.lanes[Number(s.l)];
      if (!lane || lane.npc || lane.phase === 'rolling') continue;
      const ps = Array.isArray(s.p) ? (s.p as unknown[][]) : [];
      // Keep a game of our own the host doesn't know about yet (we just joined).
      if (ps.length === 0 && lane.game.players.length) continue;
      lane.game.players = ps.slice(0, MAX_PLAYERS).map((p) => ({
        id: String(p[0]),
        name: String(p[1]).slice(0, 14),
        rolls: (Array.isArray(p[2]) ? (p[2] as number[]) : []).map((n) => Math.max(0, Math.min(10, Math.round(Number(n) || 0)))),
        fouls: (Array.isArray(p[3]) ? (p[3] as number[]) : []).map((n) => !!n),
      }));
      const m = Number(s.m);
      if (Number.isInteger(m) && m !== lane.sim.standingMask() && lane.phase === 'ready') lane.sim.rack(m);
      lane.dirty = true;
    }
  }

  /** A friend left the room: their place on any lane goes. */
  dropFriend(id: string) {
    for (const lane of this.lanes)
      if (lane.game.has(id)) {
        lane.game.leave(id);
        lane.dirty = true;
      }
    for (const b of this.balls) if (b.state === 'friend' && b.holder === id) this.toRackRemote(b);
  }

  /** Your room id changed (you joined or left a room): your place on the lanes keeps. */
  renameSelf(from: string, to: string) {
    if (from === to) return;
    for (const lane of this.lanes) for (const p of lane.game.players) if (p.id === from) p.id = to;
  }

  // --- Desktop stance ---------------------------------------------------------------------

  private updateStance(dt: number) {
    const s = this.stance!;
    const lane = this.lanes[s.lane];
    const p = this.d.player;
    if (s.wait > 0) s.wait -= dt;
    // The ball came back and it's still your ball: it's in your hand again.
    if (s.ball.state !== 'stance' && lane.phase === 'ready' && s.wait <= 0) {
      if (lane.game.current?.id === this.selfId) {
        const b = s.ball;
        if (b.state === 'rack' || b.state === 'return') {
          b.state = 'stance';
          this.net?.send({ k: 'take', b: b.id, id: this.selfId });
        }
      } else if (lane.game.current && lane.game.current.id !== this.selfId) {
        // Someone else's ball now: step back.
        return this.leaveStance(false);
      } else if (lane.game.over && lane.t > 1.5) {
        this.d.toast(`Game over: ${lane.game.players.map((p) => `${p.name} ${runningTotal(p.rolls)}`).join(' · ')}`);
        return this.leaveStance(false);
      }
    }
    // Move along the line (A/D, the stick), never past the boards.
    if (!s.holding && s.ball.state === 'stance') {
      const k = this.keys;
      const mv = (k.has('KeyA') ? 1 : 0) - (k.has('KeyD') ? 1 : 0) + (k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0) - p.stick.x;
      s.x = THREE.MathUtils.clamp(s.x + mv * dt * 0.6, -0.42, 0.42);
    }
    if (s.holding) {
      s.held += dt;
      s.power = meterPower(s.held);
      const k = this.keys;
      s.spin = THREE.MathUtils.clamp(s.spin + ((k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0) - (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0)) * dt * 1.6, -1, 1);
    }
    // Stay on the line; the aim is a slight turn either way.
    p.rig.position.x = FOUL_X + 2.1;
    p.rig.position.z = laneZ(s.lane) + s.x;
    p.rig.rotation.y = THREE.MathUtils.clamp(p.rig.rotation.y, RIG_FACE_PINS - 0.07, RIG_FACE_PINS + 0.07);
    // The ball in your hand: low on the right, swinging back as you hold.
    if (s.ball.state === 'stance') {
      const sw = s.holding ? s.power * 1.3 : 0;
      const cam = p.camera;
      cam.getWorldPosition(this.v);
      const yaw = p.rig.rotation.y;
      const fx = -Math.sin(yaw),
        fz = -Math.cos(yaw);
      const rx = -fz,
        rz = fx;
      const fwd = 0.42 - Math.sin(sw) * 0.55,
        down = 0.5 + (1 - Math.cos(sw)) * 0.2;
      s.ball.pos.set(this.v.x + fx * fwd + rx * 0.24, this.v.y - down, this.v.z + fz * fwd + rz * 0.24);
    }
    this.drawHud();
  }

  private showHud(on: boolean) {
    if (!this.hud) {
      const el = document.createElement('div');
      el.id = 'bowl-hud';
      el.style.cssText =
        'position:fixed;left:50%;bottom:86px;transform:translateX(-50%);z-index:30;pointer-events:none;font:600 13px/1.35 Georgia,serif;color:#f2e2bc;text-align:center;text-shadow:0 1px 3px #000;width:min(92vw,520px)';
      el.innerHTML =
        '<div style="display:flex;gap:14px;align-items:center;justify-content:center"><div style="width:220px"><div style="font-size:11px;letter-spacing:.2em;opacity:.8">POWER</div><div style="height:12px;border:1px solid #c9a050;border-radius:7px;background:rgba(10,8,20,.6);overflow:hidden"><div data-p style="height:100%;width:0;background:linear-gradient(90deg,#2fe0d8,#ffc65a 70%,#ff3fa8)"></div></div></div><div style="width:160px"><div style="font-size:11px;letter-spacing:.2em;opacity:.8">SPIN</div><div style="position:relative;height:12px;border:1px solid #c9a050;border-radius:7px;background:rgba(10,8,20,.6)"><div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:#c9a050"></div><div data-s style="position:absolute;top:1px;width:10px;height:10px;border-radius:50%;background:#ff3fa8;left:calc(50% - 5px)"></div></div></div></div><div data-t style="margin-top:6px;font-weight:400;opacity:.9"></div>';
      document.body.appendChild(el);
      this.hud = el;
    }
    this.hud.style.display = on ? 'block' : 'none';
  }

  private drawHud() {
    const s = this.stance;
    if (!s || !this.hud) return;
    (this.hud.querySelector('[data-p]') as HTMLElement).style.width = `${Math.round(s.power * 100)}%`;
    (this.hud.querySelector('[data-s]') as HTMLElement).style.left = `calc(${50 - s.spin * 45}% - 5px)`;
    const touch = matchMedia('(pointer: coarse)').matches;
    const t = this.hud.querySelector('[data-t]') as HTMLElement;
    const lane = this.lanes[s.lane];
    const txt =
      s.ball.state !== 'stance'
        ? lane.phase === 'rolling'
          ? 'Watch it go…'
          : 'The pinsetter is resetting…'
        : s.holding
          ? touch
            ? 'Let go to throw · drag sideways for spin'
            : 'Let go to throw · move the mouse sideways (or ←/→) for spin'
          : touch
            ? 'Stick to move · hold the screen to swing back · S to step away'
            : 'A/D to move · aim with the mouse · hold click or Space to swing · S to step away';
    if (t.textContent !== txt) t.textContent = txt;
  }

  // --- Balls ----------------------------------------------------------------------------

  private updateBalls(dt: number) {
    for (const b of this.balls) {
      if (b.state === 'return') {
        b.t += dt;
        // Out of the pit, through the machine, out of the hood and down the rack to its slot.
        if (b.t < 1.4) {
          b.pos.set(0, -5, 0);
          continue;
        }
        const k = Math.min(1, (b.t - 1.4) / 0.9);
        rackSpot(b.ret, b.slot, this.v);
        const hx = RACK.x0 + 0.25;
        b.pos.set(hx + (this.v.x - hx) * easeOut(k), RACK_Y + Math.sin(k * Math.PI) * 0.02, this.v.z);
        this.qa.setFromAxisAngle(this.v2.set(0, 0, 1), -dt * 9 * (1 - k));
        b.quat.premultiply(this.qa);
        if (k >= 1) {
          b.state = 'rack';
          if (this.here) this.sound.shot('clunk', b.pos, 0.6, 0.95 + (b.id % 4) * 0.04, 2);
        }
      } else if (b.state === 'rack') rackSpot(b.ret, b.slot, b.pos);
      else if (b.state === 'lane') {
        const s = this.lanes[b.lane]?.sim;
        if (!s) continue;
        this.laneToWorld(b.lane, s.pos[0], s.pos[1], s.pos[2], b.pos);
        b.quat.set(s.quat[0], s.quat[1], s.quat[2], s.quat[3]).premultiply(this.laneQ);
        if (s.ballPhase === 'pit' && s.pos[2] > DECK_END + 0.3) b.pos.y = Math.min(b.pos.y, -0.1);
      } else if (b.state === 'friend') {
        const h = b.holder ? this.net?.hand(b.holder) : null;
        if (h) b.pos.copy(h).add(this.v.set(0, -0.08, 0));
        else b.pos.set(0, -5, 0);
      }
    }
  }

  // --- Drawing ----------------------------------------------------------------------------

  private laneToWorld(li: number, x: number, y: number, z: number, out: THREE.Vector3) {
    return out.set(FOUL_X - z, y, laneZ(li) + x);
  }

  private placeAll() {
    const P = this.pins;
    for (const lane of this.lanes) {
      const s = lane.sim;
      const sw = lane.phase === 'sweep' ? lane.sweep : null;
      const t = lane.t;
      // The pinsetter's table: lifts the kept pins (0.5-1.0 s), sets them back / lowers a fresh rack (1.8-2.4 s).
      const lift = sw ? (t < 0.5 ? 0 : t < 1.0 ? (t - 0.5) / 0.5 : t < 1.8 ? 1 : t < 2.4 ? 1 - (t - 1.8) / 0.6 : 0) * 0.32 : 0;
      // The sweep bar: down (1.0-1.3), back across the deck (1.3-1.75), up after the set (2.4-3.0).
      const barDown = sw ? (t < 1.0 ? 0 : t < 1.3 ? (t - 1.0) / 0.3 : t < 2.4 ? 1 : t < 3.0 ? 1 - (t - 2.4) / 0.6 : 0) : 0;
      const barZ = sw ? (t < 1.3 ? HEAD_Z - 0.35 : t < 1.75 ? HEAD_Z - 0.35 + ((t - 1.3) / 0.45) * 1.3 : t < 2.4 ? DECK_END + 0.1 : HEAD_Z - 0.35) : HEAD_Z - 0.35;
      for (let p = 0; p < 10; p++) {
        const i = p + 1;
        const idx = lane.i * 10 + p;
        let y = s.pos[3 * i + 1];
        let hide = y < -2;
        if (sw && !sw.done) {
          const kept = (sw.keep >> p) & 1 && s.pinUp(p);
          if (kept) y += lift;
          else if (barDown > 0.5 && s.pos[3 * i + 2] < barZ) hide = true;
        } else if (sw && sw.done) {
          // The set: kept pins (or a fresh rack) come down with the table.
          if (s.active[i]) y += lift;
        }
        if (hide) {
          this.m4.makeScale(0, 0, 0);
          P.setMatrixAt(idx, this.m4);
          continue;
        }
        this.laneToWorld(lane.i, s.pos[3 * i], y, s.pos[3 * i + 2], this.v);
        this.qa.set(s.quat[4 * i], s.quat[4 * i + 1], s.quat[4 * i + 2], s.quat[4 * i + 3]).premultiply(this.laneQ);
        this.m4.compose(this.v, this.qa, this.s1);
        P.setMatrixAt(idx, this.m4);
      }
      // The sweep bar.
      const by = sw ? 0.95 - barDown * 0.87 : 0.95;
      this.laneToWorld(lane.i, 0, by, barZ, this.v);
      this.m4.makeTranslation(this.v.x, this.v.y, this.v.z);
      this.sweeps.setMatrixAt(lane.i, this.m4);
      // The foul lamp.
      if (lane.foulT > 0 !== (this.d.alley.foulLamps.userData[`on${lane.i}`] === true)) {
        this.d.alley.foulLamps.userData[`on${lane.i}`] = lane.foulT > 0;
        this.d.alley.foulLamps.setColorAt(lane.i, new THREE.Color(lane.foulT > 0 ? 0xff2020 : 0x401010));
        if (this.d.alley.foulLamps.instanceColor) this.d.alley.foulLamps.instanceColor.needsUpdate = true;
      }
    }
    P.instanceMatrix.needsUpdate = true;
    this.sweeps.instanceMatrix.needsUpdate = true;
    for (const b of this.balls) {
      if (b.pos.y < -2) this.m4.makeScale(0, 0, 0);
      else this.m4.compose(b.pos, b.quat, this.s1);
      this.ballMesh.setMatrixAt(b.id, this.m4);
    }
    this.ballMesh.instanceMatrix.needsUpdate = true;
  }

  private updateBanner(dt: number) {
    if (this.bannerT < 0) return;
    this.bannerT += dt;
    const t = this.bannerT;
    const m = this.banner.material as THREE.MeshBasicMaterial;
    // Pop in (overshoot), hold with a pulse, fade.
    const pop = t < 0.35 ? easeOutBack(t / 0.35) : 1 + Math.sin(t * 9) * 0.03 * Math.max(0, 1 - (t - 0.35) / 1.5);
    this.banner.scale.setScalar(Math.max(0.01, pop));
    this.banner.rotation.z = t < 0.35 ? (1 - t / 0.35) * 0.25 : 0;
    m.opacity = t < 2.0 ? 1 : Math.max(0, 1 - (t - 2.0) / 0.5);
    m.color.setScalar(1 + 0.4 * Math.max(0, Math.sin(t * 14)) * Math.max(0, 1 - t));
    if (t > 2.5) {
      this.bannerT = -1;
      this.banner.visible = false;
    }
    // Sparks: out, falling, fading.
    if (this.sparks.count) {
      const fade = Math.max(0, 1 - t / 1.6);
      for (let k = 0; k < this.sparks.count; k++) {
        const o = k * 3;
        this.sparkV[o + 1] -= 2.6 * dt;
        this.sparkP[o] += this.sparkV[o] * dt;
        this.sparkP[o + 1] += this.sparkV[o + 1] * dt;
        this.sparkP[o + 2] += this.sparkV[o + 2] * dt;
        this.v.set(this.sparkP[o], this.sparkP[o + 1], this.sparkP[o + 2]);
        this.qa.setFromAxisAngle(this.v2.set(0, 1, 0), Math.PI / 2);
        this.m4.compose(this.v, this.qa, this.v2.setScalar(fade * (0.6 + (k % 3) * 0.3)));
        this.sparks.setMatrixAt(k, this.m4);
      }
      this.sparks.instanceMatrix.needsUpdate = true;
      if (fade <= 0) this.sparks.count = 0;
    }
  }

  /** The overhead monitors: each lane's scoresheet (or its idle screen). */
  drawMonitors() {
    const A = this.d.alley.monitors;
    const g = A.canvas.getContext('2d')!;
    for (const lane of this.lanes) {
      if (!lane.dirty) continue;
      const { x, y } = A.cellAt(lane.i);
      drawMonitor(g, x, y, A.cell.w, A.cell.h, lane, this.selfId);
    }
    A.tex.needsUpdate = true;
    for (const lane of this.lanes) lane.dirty = false;
  }

  private drawConsoles() {
    const C = this.d.alley.consoles;
    const g = C.canvas.getContext('2d')!;
    for (const lane of this.lanes) {
      const { x, y } = C.cellAt(lane.i);
      drawConsole(g, x, y, C.cell.w, C.cell.h, lane, lane.game.has(this.selfId));
    }
    C.tex.needsUpdate = true;
  }

  /** The console's buttons: JOIN / LEAVE on the left, NEW GAME on the right (bottom strip). */
  private consoleButton(li: number, uv: THREE.Vector2 | undefined): { label: string; run: () => void } | null {
    if (!uv || uv.y > 0.32) return null;
    const lane = this.lanes[li];
    if (lane.npc) return null;
    const mine = lane.game.has(this.selfId);
    if (uv.x < 0.5) return mine ? { label: `Leave lane ${li + 1}`, run: () => this.leave(li) } : { label: `Join lane ${li + 1}`, run: () => void this.join(li) };
    return mine ? { label: 'Start a new game', run: () => this.newGame(li) } : null;
  }

  // --- The regulars ---------------------------------------------------------------------

  populate(crowd: Crowd, budget: number): Person[] {
    const people: Person[] = [];
    const add = (role: Parameters<Crowd['add']>[0], look: Look, x: number, z: number, yaw: number) => {
      if (people.length >= budget) return null;
      const p = crowd.add(role, look, new THREE.Vector3(x, 0, z), yaw);
      if (p) people.push(p);
      return p;
    };
    // The bartender and the shoe clerk.
    add('watch', staffLook('bar'), (BAR.x0 + BAR.x1) / 2 + 0.6, BAR.z1 - 0.95, 0);
    add('watch', { ...staffLook('waiter'), kind: 'male_casual_2', dress: false, main: 0x5a0e18, second: 0x5a0e18, height: 1.78 }, (SHOES.x0 + SHOES.x1) / 2 - 0.4, SHOES.z0 + 0.95, Math.PI);
    // The regulars: one or two per lane on the outer lanes (they keep score like anyone).
    let n = 0;
    for (const li of NPC_LANES) {
      const lane = this.lanes[li];
      lane.game.players.forEach((pl, k) => {
        const ret = RETURNS.findIndex((r) => r.lanes.includes(li));
        const side = RETURNS[ret].lanes[0] === li ? 1 : -1;
        const home = k === 0 ? { x: CONSOLE.x + 0.55, z: laneZ(li) + side * 0.15, yaw: FACE_PINS + side * 0.4, seat: false } : { x: -291.27, z: RETURNS[ret].z + side * 0.75, yaw: FACE_PINS, seat: true };
        const look = randomLook();
        const p = add('watch', look, home.x, home.z, home.yaw);
        if (!p) return;
        if (home.seat) {
          p.seated = true;
          p.seatY = 0.46;
        }
        const npc: NpcBowler = { person: p, lane: li, name: pl.name, home, phase: 'wait', t: 2 + n * 3.1, ball: null, swing: 0, rng: mulberry(1000 + li * 17 + k), from: new THREE.Vector3(), to: new THREE.Vector3() };
        pl.id = `npc-${this.npcs.length}`;
        this.npcs.push(npc);
        p.onPose = (q) => this.poseNpc(npc, q);
        n++;
      });
    }
    // A few guests in the lounge and at the bar.
    if (people.length + 2 <= budget) for (const p of crowd.addGroup(-287.6, -1.2, 2, { drinks: 0.8 })) people.push(p);
    for (let i = 0; i < 2 && people.length < budget; i++) {
      const p = add('watch', randomLook(), BAR.x0 + 0.6 + (i * 2 + 1) * 1.15, BAR.z1 + 0.42, Math.PI);
      if (p) {
        p.seated = true;
        p.seatY = 0.76;
        p.prop = 'glass';
      }
    }
    return people;
  }

  private updateNpcs(dt: number) {
    for (const n of this.npcs) {
      const p = n.person;
      const lane = this.lanes[n.lane];
      n.t -= dt;
      const id = lane.game.players.find((x) => x.name === n.name)?.id;
      const myTurn = lane.game.current?.id === id;
      const walk = (to: THREE.Vector3, speed: number) => {
        const dx = to.x - p.pos.x,
          dz = to.z - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.03) {
          p.moving = 0;
          return true;
        }
        const step = Math.min(d, speed * dt);
        p.pos.x += (dx / d) * step;
        p.pos.z += (dz / d) * step;
        p.yaw = Math.atan2(dx, dz);
        p.moving = speed;
        return false;
      };
      switch (n.phase) {
        case 'wait':
          p.moving = 0;
          if (lane.game.over && n.t < 0) {
            // A new game after a while.
            lane.game.reset();
            lane.dirty = true;
            n.t = 6;
          }
          if (myTurn && lane.phase === 'ready' && n.t < 0) {
            n.phase = 'fetch';
            p.seated = false;
            const ret = RETURNS.findIndex((r) => r.lanes.includes(n.lane));
            n.ball = this.balls.filter((b) => b.ret === ret && b.state === 'rack').sort((a, b) => Math.abs(a.lb - 14) - Math.abs(b.lb - 14))[0] ?? null;
            if (!n.ball) {
              n.phase = 'wait';
              n.t = 2;
            } else {
              n.ball.state = 'npc';
              n.ball.npc = n;
            }
          }
          break;
        case 'fetch': {
          const b = n.ball!;
          const side = RETURNS[b.ret].lanes[0] === n.lane ? 1 : -1;
          if (walk(this.v.set(b.pos.x + 0.1, 0, b.pos.z + side * 0.42), 1.1)) {
            n.phase = 'stance';
            n.t = 0.6;
          }
          break;
        }
        case 'stance':
          if (n.t > 0) {
            p.yaw = FACE_PINS;
            break;
          }
          if (walk(this.v.set(FOUL_X + 3.4, 0, laneZ(n.lane) - 0.18), 1.2)) {
            p.yaw = FACE_PINS;
            n.phase = 'approach';
            n.t = 0;
            n.swing = 0;
          }
          break;
        case 'approach': {
          n.t += dt * 2; // (t counts up here)
          const T = n.t / 2;
          // Four steps to the line while the arm swings: push away, down, back, through.
          const x = FOUL_X + 3.4 - Math.min(1, T / 1.6) * 2.95;
          p.pos.x = x;
          p.yaw = FACE_PINS;
          p.moving = T < 1.6 ? 1.6 : 0;
          n.swing = T < 0.3 ? -0.6 * (T / 0.3) : T < 0.7 ? -0.6 + 0.6 * ((T - 0.3) / 0.4) : T < 1.15 ? 1.7 * ((T - 0.7) / 0.45) : T < 1.6 ? 1.7 - 1.95 * ((T - 1.15) / 0.45) : Math.max(-2.3, -0.25 - (T - 1.6) * 6);
          if (T >= 1.6 && n.ball && n.ball.state === 'npc' && lane.phase === 'ready') this.npcThrow(n, lane);
          if (T > 2.6) {
            n.phase = 'watch';
            n.t = 0;
          }
          break;
        }
        case 'watch':
          n.swing = Math.min(0, n.swing + dt * 1.2);
          p.moving = 0;
          n.t += dt;
          if (lane.phase !== 'rolling' && n.t > 1.2) {
            n.phase = 'back';
            const prev = lane.game.players.find((x) => x.name === n.name);
            const last = prev ? frames(prev.rolls).at(-1) : null;
            if (last?.strike || last?.spare) p.cheer = 1.6;
          }
          break;
        case 'back':
          n.swing = 0;
          if (p.cheer > 0) break;
          if (walk(this.v.set(n.home.x, 0, n.home.z), 1.1)) {
            p.yaw = n.home.yaw;
            p.seated = n.home.seat;
            p.seatY = 0.46;
            n.phase = 'wait';
            n.t = 3 + n.rng() * 6;
          }
          break;
      }
      // The ball in their hand.
      const b = n.ball;
      if (b && b.state === 'npc' && n.phase !== 'fetch') {
        const w = p.rig?.bones.WristR;
        if (w && p.rig?.root.visible !== false) {
          w.getWorldPosition(b.pos);
          b.pos.y -= 0.08;
        } else {
          // (No rig: carry it at the hip.)
          b.pos.set(p.pos.x + Math.sin(p.yaw) * 0.2 + Math.cos(p.yaw) * -0.25, 0.75, p.pos.z + Math.cos(p.yaw) * 0.2 - Math.sin(p.yaw) * -0.25);
        }
      }
    }
  }

  /** A regular lets go at the line: a decent bowler, mostly into the pocket with a modest hook. */
  private npcThrow(n: NpcBowler, lane: Lane) {
    const r = n.rng;
    const vz = 6.6 + r() * 1.6;
    const wz = -(2 + r() * 7);
    const x0 = -0.18 + (r() - 0.5) * 0.12;
    const hook = 0.03 * -wz;
    const err = (r() + r() + r() - 1.5) * 0.09 + (r() < 0.04 ? (r() < 0.5 ? -1 : 1) * 0.5 : 0);
    const target = -0.06 - hook + err;
    const vx = ((target - x0) / HEAD_Z) * vz;
    const ball = n.ball!;
    n.ball = null;
    ball.npc = null;
    this.bowl(lane, ball, { x: x0, y: BALL_R + 0.03, z: -0.15, vx, vy: -0.2, vz, wx: (0.3 * vz) / BALL_R, wy: 0, wz }, false, true);
  }

  /** Their right arm through the swing (θ: 0 hanging, + back, − forward). */
  private poseNpc(n: NpcBowler, p: Person) {
    const rig = p.rig;
    if (!rig || Math.abs(n.swing) < 0.01) return;
    const yaw = p.yaw;
    const fx = Math.sin(yaw),
      fz = Math.cos(yaw);
    // Right of a person facing (fx, fz) is (-fz, fx)... their right hand side.
    const rx = -fz,
      rz = fx;
    const sc = rig.root.scale.x;
    const sh = this.v2.set(p.pos.x - rx * 0.19 * sc, 1.42 * sc, p.pos.z - rz * 0.19 * sc);
    const L = 0.6 * sc;
    const th = n.swing;
    const target = this.v.set(sh.x - fx * Math.sin(th) * L, sh.y - Math.cos(th) * L, sh.z - fz * Math.sin(th) * L);
    rig.root.updateMatrixWorld(true);
    armTo(rig.bones, 'R', target, yaw, new THREE.Vector3());
  }
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = '"Futura", "Avenir Next", "Century Gothic", Arial, sans-serif';
const PLAYER_TINTS = ['#ffc94a', '#2fd8ff', '#ff6ad5', '#a6ff4a'];

function drawMonitor(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, lane: Lane, self: string) {
  g.save();
  g.translate(x, y);
  g.beginPath();
  g.rect(0, 0, w, h);
  g.clip();
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#0d1030');
  bg.addColorStop(1, '#05060f');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#c9a050';
  g.fillRect(0, 0, w, 3);
  // Header: lane and what's happening.
  g.fillStyle = '#f2d38a';
  g.font = `bold 26px ${SANS}`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillText(`LANE ${lane.i + 1}`, 14, 24);
  const cur = lane.game.current;
  g.textAlign = 'right';
  g.font = `italic 20px ${SERIF}`;
  g.fillStyle = '#e8e0ff';
  const status = !lane.game.players.length ? 'Open lane' : lane.game.over ? 'Game over' : cur ? `${cur.name}${cur.id === self ? ' (you)' : ''} · frame ${position(cur.rolls).frame + 1}` : '';
  g.fillText(status, w - 12, 24);
  if (!lane.game.players.length) {
    // Idle: the house's card.
    g.textAlign = 'center';
    g.fillStyle = '#f2d38a';
    g.font = `italic 700 54px ${SERIF}`;
    g.fillText('Palazzo Lanes', w / 2, h / 2 + 4);
    g.font = `18px ${SANS}`;
    g.fillStyle = '#9ad8ff';
    g.fillText('PICK UP A BALL TO PLAY', w / 2, h / 2 + 50);
    g.strokeStyle = 'rgba(201,160,80,0.6)';
    g.lineWidth = 2;
    g.strokeRect(40, 60, w - 80, h - 90);
    g.restore();
    return;
  }
  const players = lane.game.players;
  const top = 46;
  const rowH = Math.min(58, (h - top - 6) / Math.max(1, players.length));
  const nameW = 86,
    totW = 54;
  const fw = (w - nameW - totW - 16) / 10;
  players.forEach((pl, r) => {
    const ry = top + r * rowH;
    const active = cur?.id === pl.id && !lane.game.over;
    g.fillStyle = active ? 'rgba(255,198,90,0.16)' : 'rgba(255,255,255,0.04)';
    g.fillRect(8, ry, w - 16, rowH - 4);
    g.fillStyle = PLAYER_TINTS[r % 4];
    g.fillRect(8, ry, 4, rowH - 4);
    g.textAlign = 'left';
    g.fillStyle = '#ffffff';
    g.font = `bold ${rowH > 40 ? 17 : 14}px ${SANS}`;
    g.fillText(pl.name.slice(0, 9), 16, ry + rowH * 0.32);
    if (pl.id === self) {
      g.fillStyle = '#ffc65a';
      g.font = `11px ${SANS}`;
      g.fillText('YOU', 16, ry + rowH * 0.7);
    }
    const fs = frames(pl.rolls, pl.fouls);
    for (let f = 0; f < 10; f++) {
      const fx = 8 + nameW + f * fw;
      g.strokeStyle = 'rgba(201,160,80,0.55)';
      g.lineWidth = 1;
      g.strokeRect(fx, ry, fw, rowH - 4);
      const fr = fs[f];
      const boxes = f === 9 ? 3 : 2;
      const bw = fw / boxes;
      g.strokeRect(fx + fw - bw * (boxes - 1), ry, bw * (boxes - 1), (rowH - 4) * 0.45);
      if (!fr) continue;
      g.font = `bold ${rowH > 40 ? 15 : 12}px ${SANS}`;
      g.textAlign = 'center';
      fr.marks.forEach((mk, k) => {
        if (!mk) return;
        const bx = f === 9 ? fx + bw * (k + 0.5) : fx + (k === 0 ? bw * 0.5 : bw * 1.5);
        g.fillStyle = mk === 'X' ? '#ff5aa8' : mk === '/' ? '#2fe0d8' : mk === 'F' ? '#ff4040' : '#ffffff';
        g.fillText(mk, bx, ry + (rowH - 4) * 0.24);
      });
      if (fr.total !== null) {
        g.fillStyle = '#f2d38a';
        g.font = `bold ${rowH > 40 ? 16 : 13}px ${SANS}`;
        g.fillText(String(fr.total), fx + fw / 2, ry + (rowH - 4) * 0.74);
      }
    }
    g.textAlign = 'center';
    g.fillStyle = '#ffffff';
    g.font = `bold ${rowH > 40 ? 22 : 17}px ${SANS}`;
    g.fillText(String(runningTotal(pl.rolls)), w - 8 - totW / 2, ry + rowH * 0.45);
  });
  g.restore();
}

function drawConsole(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, lane: Lane, mine: boolean) {
  g.save();
  g.translate(x, y);
  g.fillStyle = '#080a18';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#c9a050';
  g.lineWidth = 3;
  g.strokeRect(2, 2, w - 4, h - 4);
  g.fillStyle = '#f2d38a';
  g.font = `bold 24px ${SANS}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(`LANE ${lane.i + 1}`, w / 2, 22);
  g.font = `14px ${SANS}`;
  g.fillStyle = '#d8d0ff';
  const names = lane.game.players.map((p) => p.name).join(' · ') || 'Open: pick up a ball';
  g.fillText(names.length > 30 ? names.slice(0, 29) + '…' : names, w / 2, 52);
  if (lane.npc) {
    g.fillStyle = '#9a90b8';
    g.fillText('League play', w / 2, 80);
  } else {
    const by = h * 0.68;
    const bh = h * 0.28;
    g.fillStyle = mine ? '#5a1426' : '#14505a';
    g.fillRect(10, by, w / 2 - 15, bh);
    g.fillStyle = mine ? '#2a2a50' : '#202030';
    g.fillRect(w / 2 + 5, by, w / 2 - 15, bh);
    g.fillStyle = '#ffffff';
    g.font = `bold 18px ${SANS}`;
    g.fillText(mine ? 'LEAVE' : 'JOIN', w / 4, by + bh / 2);
    g.fillStyle = mine ? '#ffffff' : '#606070';
    g.fillText('NEW GAME', (w * 3) / 4, by + bh / 2);
  }
  g.restore();
}

function bannerTexture(): THREE.CanvasTexture {
  const W = 1024,
    H = 256 * 6;
  const [c, g] = canvas(W, H);
  g.clearRect(0, 0, W, H);
  BANNER_TEXT.forEach((text, i) => {
    const y = i * 256;
    const good = i <= 3;
    g.save();
    g.translate(W / 2, y + 128);
    // A starburst behind the word.
    if (good) {
      for (let k = 0; k < 18; k++) {
        g.rotate(Math.PI / 9);
        g.fillStyle = k % 2 ? 'rgba(255,198,90,0.35)' : 'rgba(255,63,168,0.3)';
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(480, -40);
        g.lineTo(480, 40);
        g.closePath();
        g.fill();
      }
    }
    g.restore();
    g.font = `italic 900 ${good ? 150 : 120}px ${SERIF}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 14;
    g.strokeStyle = good ? '#2a0a3a' : '#1a0606';
    g.strokeText(text, W / 2, y + 132);
    g.shadowColor = good ? '#ff3fa8' : '#ff4040';
    g.shadowBlur = 30;
    const gr = g.createLinearGradient(0, y + 50, 0, y + 210);
    gr.addColorStop(0, good ? '#fff4c8' : '#ffd0d0');
    gr.addColorStop(0.5, good ? '#ffc65a' : '#ff6060');
    gr.addColorStop(1, good ? '#ff7a2a' : '#a01818');
    g.fillStyle = gr;
    g.fillText(text, W / 2, y + 132);
    g.shadowBlur = 0;
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const popcount = (m: number) => {
  let n = 0;
  for (let p = 0; p < 10; p++) if ((m >> p) & 1) n++;
  return n;
};
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const easeOut = (k: number) => 1 - (1 - k) ** 3;
const easeOutBack = (k: number) => 1 + 2.4 * (k - 1) ** 3 + 1.4 * (k - 1) ** 2;
void ROOM;
void FASCIA;
void PIN_COM;
