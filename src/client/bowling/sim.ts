/**
 * One lane's physics (pure, no three.js, no allocation per step): a bowling
 * ball and ten rigid pins.
 *
 * The lane frame: x across the lane (positive to the bowler's LEFT, so the
 * frame is right-handed), y up, z down the lane from the foul line. The head
 * pin stands 60 ft (18.29 m) down; the pin deck ends just behind the 10 pin,
 * then the pit (a drop) and the back cushion. Gutters run either side of the
 * lane, and the kickback walls stand beside the pin deck.
 *
 * The ball skids, hooks and rolls on the lane by friction alone: the contact
 * patch's slip (from its speed and spin) is opposed by μ·m·g, low on the oiled
 * front 40 ft and high on the dry back end, so a ball thrown with side spin
 * skids straight, then curves as it reaches the dry boards and rolls into the
 * pocket. Pins are rigid bodies made of a few spheres along their axis (their
 * belly, neck and head) on a flat round base; contacts (ball-pin, pin-pin, pin
 * on the deck, the kickbacks and the cushion) are solved with sequential
 * impulses at a fixed 1/300 s step. Standing pins sleep until something hits
 * them, so a rack never wobbles over on its own.
 *
 * Fixed steps and plain arithmetic (no Math.random, no trig in the step) make
 * it deterministic: the same throw knocks down the same pins on every machine,
 * whatever the frame rate.
 */

// --- Dimensions (metres, kilograms) -------------------------------------------------------

export const LANE_HALF = 1.0541 / 2;
export const GUTTER_W = 0.235;
/** Kickback walls (beside the pin deck) and where they start. */
export const KICK_X = LANE_HALF + GUTTER_W;
export const HEAD_Z = 18.288;
export const PIN_SPACING = 0.3048;
export const ROW_Z = PIN_SPACING * 0.8660254037844386;
/** The pin deck's tail (the pit beyond it), the pit's depth, the back cushion. */
export const DECK_END = HEAD_Z + 0.868;
export const PIT_DEPTH = 0.26;
export const BACK_Z = DECK_END + 0.95;
export const KICK_Z0 = HEAD_Z - 0.6;
/** The oil pattern's length (40 ft): low friction before it, dry boards after. */
export const OIL_LEN = 12.2;
export const MU_OIL = 0.04;
export const MU_DRY = 0.19;

export const BALL_R = 0.1085;
export const PIN_H = 0.381;
export const PIN_MASS = 1.53;
/** Height of a pin's centre of mass above its base. */
export const PIN_COM = 0.143;
const PIN_BASE_R = 0.026;
/** The pin's shape: spheres along its axis (height above the base, radius). */
export const PIN_SPHERES: readonly [number, number][] = [
  [0.046, 0.043],
  [0.114, 0.0605],
  [0.19, 0.046],
  [0.256, 0.026],
  [0.334, 0.034],
];
const RIM_N = 6;

/** Pin spots (x, z) in the standard triangle: 1 at the front, 7-8-9-10 at the back. */
export const SPOTS: readonly [number, number][] = (() => {
  const s: [number, number][] = [];
  // Row k has k+1 pins; pin numbers go left to right as the bowler sees them (7 is far left).
  // Lane x is positive to the bowler's left, so within a row the first pin is at +x.
  for (let k = 0; k < 4; k++) for (let i = 0; i <= k; i++) s.push([(k / 2 - i) * PIN_SPACING, HEAD_Z + k * ROW_Z]);
  return s;
})();

const G = 9.81;
export const STEP = 1 / 300;
const ITER = 8;
const N = 11;
const NS = PIN_SPHERES.length;
const NP = RIM_N + NS;
const MAXC = 900;
const SLOP = 0.001;
const BETA = 0.25;
const MAX_BIAS = 0.6;

/** A ball as it leaves the hand (lane frame). */
export interface Launch {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Angular velocity (rad/s): wx > 0 is forward roll, wz < 0 hooks to the left (+x). */
  wx: number;
  wy: number;
  wz: number;
}

/** Something hit something (for sound): kinds below, the closing speed, where. */
export interface Impact {
  kind: number;
  speed: number;
  x: number;
  y: number;
  z: number;
}
export const HIT = { pinPin: 0, ballPin: 1, pinDeck: 2, ballThud: 3, gutter: 4, kickback: 5, cushion: 6, pit: 7 } as const;

export type BallPhase = 'idle' | 'lane' | 'gutter' | 'pit' | 'stopped';

export class LaneSim {
  readonly pos = new Float64Array(3 * N);
  readonly vel = new Float64Array(3 * N);
  readonly quat = new Float64Array(4 * N);
  readonly ang = new Float64Array(3 * N);
  private invM = new Float64Array(N);
  private invIb = new Float64Array(3 * N);
  private invIw = new Float64Array(9 * N);
  private rot = new Float64Array(9 * N);
  readonly awake = new Uint8Array(N);
  readonly active = new Uint8Array(N);
  private still = new Float64Array(N);
  /** Contact points of each pin in world (lane) space: rim points then spheres. */
  private pts = new Float64Array(3 * NP * N);
  // Contacts (structure of arrays).
  private cA = new Int16Array(MAXC);
  private cB = new Int16Array(MAXC);
  private cN = new Float64Array(3 * MAXC);
  private cRa = new Float64Array(3 * MAXC);
  private cRb = new Float64Array(3 * MAXC);
  private cT1 = new Float64Array(3 * MAXC);
  private cT2 = new Float64Array(3 * MAXC);
  private cK = new Float64Array(3 * MAXC);
  private cJ = new Float64Array(3 * MAXC);
  private cMu = new Float64Array(MAXC);
  private cTarget = new Float64Array(MAXC);
  private nc = 0;
  private acc = 0;
  /** Seconds simulated since the launch. */
  time = 0;
  ballPhase: BallPhase = 'idle';
  ballMass = 6.35;
  /** Side of the gutter the ball dropped into (+1 left, -1 right), 0 if none. */
  gutterSide = 0;
  /** Seconds since the ball reached the pins (or the gutter took it past them). */
  private sincePins = -1;
  private stoppedT = 0;
  /** How much the game helps: damps the ball's sideways drift on the oil (0 = pure physics). */
  assist = 0;
  /** The pins' contact ever touched by the ball (for "the ball hit something"). */
  ballTouched = false;
  /** Impacts since last read (ring buffer, newest last). */
  readonly impacts: Impact[] = Array.from({ length: 32 }, () => ({ kind: 0, speed: 0, x: 0, y: 0, z: 0 }));
  impactCount = 0;

  constructor() {
    for (let i = 0; i < N; i++) this.quat[4 * i + 3] = 1;
    // Pins: a cylinder's inertia (radius ~4.5 cm, the pin's length).
    const iPerp = (PIN_MASS * (3 * 0.045 * 0.045 + PIN_H * PIN_H)) / 12;
    const iAxis = 0.5 * PIN_MASS * 0.04 * 0.04;
    for (let i = 1; i < N; i++) {
      this.invM[i] = 1 / PIN_MASS;
      this.invIb[3 * i] = 1 / iPerp;
      this.invIb[3 * i + 1] = 1 / iAxis;
      this.invIb[3 * i + 2] = 1 / iPerp;
    }
    this.setBallMass(6.35);
    this.rack(0x3ff);
  }

  setBallMass(kg: number) {
    this.ballMass = kg;
    this.invM[0] = 1 / kg;
    const ii = 1 / (0.4 * kg * BALL_R * BALL_R);
    this.invIb[0] = this.invIb[1] = this.invIb[2] = ii;
  }

  // --- Setting up ------------------------------------------------------------------------

  /** A fresh rack: the pins in `mask` (bit i = pin i+1) on their spots, standing still; the rest gone. */
  rack(mask: number) {
    for (let p = 0; p < 10; p++) {
      const i = p + 1;
      const on = (mask >> p) & 1;
      this.placePin(i, SPOTS[p][0], SPOTS[p][1], on === 1);
    }
  }

  /** The pinsetter's respot: pins in `mask` stand again where they are (upright, still); the rest are swept. */
  respot(mask: number) {
    for (let p = 0; p < 10; p++) {
      const i = p + 1;
      const on = (mask >> p) & 1 && this.active[i];
      this.placePin(i, this.pos[3 * i], this.pos[3 * i + 2], !!on);
    }
  }

  /** Puts a pin standing at (x, z), or takes it off the deck. */
  placePin(i: number, x: number, z: number, on: boolean) {
    const o = 3 * i;
    this.pos[o] = on ? x : 0;
    this.pos[o + 1] = on ? PIN_COM : -5;
    this.pos[o + 2] = on ? z : 0;
    this.vel[o] = this.vel[o + 1] = this.vel[o + 2] = 0;
    this.ang[o] = this.ang[o + 1] = this.ang[o + 2] = 0;
    const q = 4 * i;
    this.quat[q] = this.quat[q + 1] = this.quat[q + 2] = 0;
    this.quat[q + 3] = 1;
    this.active[i] = on ? 1 : 0;
    this.awake[i] = 0;
    this.still[i] = 0;
    this.updateBody(i);
  }

  /** Sets a pin's whole state (a friend's stream), asleep unless it's moving. */
  setPin(i: number, x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number, on = true) {
    const o = 3 * i;
    this.pos[o] = x;
    this.pos[o + 1] = y;
    this.pos[o + 2] = z;
    const q = 4 * i;
    const l = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1;
    this.quat[q] = qx / l;
    this.quat[q + 1] = qy / l;
    this.quat[q + 2] = qz / l;
    this.quat[q + 3] = qw / l;
    this.vel[o] = this.vel[o + 1] = this.vel[o + 2] = 0;
    this.ang[o] = this.ang[o + 1] = this.ang[o + 2] = 0;
    this.active[i] = on ? 1 : 0;
    this.awake[i] = 0;
    this.updateBody(i);
  }

  /** The ball leaves the hand. */
  launch(l: Launch) {
    const o = 0;
    this.pos[o] = l.x;
    this.pos[o + 1] = Math.max(BALL_R, l.y);
    this.pos[o + 2] = l.z;
    this.vel[o] = l.vx;
    this.vel[o + 1] = l.vy;
    this.vel[o + 2] = l.vz;
    this.ang[o] = l.wx;
    this.ang[o + 1] = l.wy;
    this.ang[o + 2] = l.wz;
    this.quat[0] = this.quat[1] = this.quat[2] = 0;
    this.quat[3] = 1;
    this.active[0] = 1;
    this.awake[0] = 1;
    this.updateBody(0);
    this.ballPhase = 'lane';
    this.gutterSide = 0;
    this.time = 0;
    this.acc = 0;
    this.sincePins = -1;
    this.stoppedT = 0;
    this.ballTouched = false;
    this.impactCount = 0;
  }

  /** No ball on the lane. */
  clearBall() {
    this.active[0] = 0;
    this.awake[0] = 0;
    this.ballPhase = 'idle';
    this.pos[1] = -5;
  }

  // --- Reading ---------------------------------------------------------------------------

  /** Is pin p (0..9) standing on the deck? */
  pinUp(p: number): boolean {
    const i = p + 1;
    if (!this.active[i]) return false;
    const q = 4 * i;
    const qx = this.quat[q],
      qz = this.quat[q + 2];
    // The pin's axis: its y component is 1 - 2(qx² + qz²).
    const upY = 1 - 2 * (qx * qx + qz * qz);
    const o = 3 * i;
    return upY > 0.87 && this.pos[o + 1] > PIN_COM - 0.03 && this.pos[o + 2] < DECK_END && Math.abs(this.pos[o]) < LANE_HALF + 0.03;
  }

  /** Bit mask of the pins standing (bit p = pin p+1). */
  standingMask(): number {
    let m = 0;
    for (let p = 0; p < 10; p++) if (this.pinUp(p)) m |= 1 << p;
    return m;
  }

  /** Is anything still moving? (The ball is done and every pin is asleep or gone.) */
  get settled(): boolean {
    if (this.ballPhase === 'lane' || this.ballPhase === 'gutter') {
      if (this.time < 16) return false;
    }
    for (let i = 1; i < N; i++) if (this.active[i] && this.awake[i]) return this.sincePins > 6 || this.time > 18;
    return this.ballPhase !== 'lane' && this.ballPhase !== 'gutter' ? true : this.time > 16;
  }

  /** The ball's speed (m/s). */
  get ballSpeed() {
    return Math.sqrt(this.vel[0] ** 2 + this.vel[1] ** 2 + this.vel[2] ** 2);
  }

  // --- Stepping --------------------------------------------------------------------------

  /** Advance by `dt` seconds of real time (whole fixed steps; the rest carries over). */
  step(dt: number) {
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= STEP && n < 40) {
      this.acc -= STEP;
      this.substep();
      n++;
    }
  }

  /** Runs `n` fixed steps (tests). */
  steps(n: number) {
    for (let i = 0; i < n; i++) this.substep();
  }

  private substep() {
    const h = STEP;
    this.time += h;
    if (this.active[0]) this.ballLane(h);
    // Gravity and damping on the awake pins.
    for (let i = 1; i < N; i++) {
      if (!this.active[i] || !this.awake[i]) continue;
      const o = 3 * i;
      this.vel[o + 1] -= G * h;
      // Lying on the boards a pin rolls in arcs and wobbles to a stop (its shape): it slows sooner than in the air.
      const lying = this.pos[o + 1] < 0.09;
      const ld = 1 - (lying ? 1.2 : 0.25) * h,
        ad = 1 - (lying ? 2.2 : 0.9) * h;
      this.vel[o] *= ld;
      this.vel[o + 2] *= ld;
      this.ang[o] *= ad;
      this.ang[o + 1] *= ad;
      this.ang[o + 2] *= ad;
    }
    this.collide();
    this.solve(h);
    this.integrate(h);
    this.sleepCheck(h);
  }

  /** The ball on the lane: rolling friction, hook, the gutters, the pit. */
  private ballLane(h: number) {
    const p = this.pos,
      v = this.vel,
      w = this.ang;
    const r = BALL_R;
    const m = this.ballMass;
    const z = p[2];
    // Into the gutter: the ball's centre past the lane's edge, between the foul line and the deck's end.
    if (this.ballPhase === 'lane' && z > 0 && z < DECK_END && Math.abs(p[0]) > LANE_HALF && p[1] < r + 0.05) {
      this.ballPhase = 'gutter';
      this.gutterSide = p[0] > 0 ? 1 : -1;
      this.impact(HIT.gutter, Math.abs(v[0]) + 1, p[0], p[1], z);
    }
    if (this.ballPhase === 'gutter') {
      // In the channel: it runs straight down the gutter, sunk a little, its side spin scrubbed off.
      const tx = this.gutterSide * (LANE_HALF + GUTTER_W / 2);
      p[0] += (tx - p[0]) * Math.min(1, h * 14);
      v[0] = 0;
      w[2] *= 1 - 3 * h;
      const gy = z < DECK_END ? r - 0.06 : r - PIT_DEPTH;
      if (z >= DECK_END) {
        this.ballPhase = 'pit';
        if (this.sincePins < 0) this.sincePins = 0;
      }
      v[1] = 0;
      p[1] = gy;
      v[2] = Math.max(0, v[2] - 0.01 * G * h);
      if (this.sincePins < 0 && z > HEAD_Z) this.sincePins = 0;
      if (v[2] < 0.05) {
        this.stoppedT += h;
        if (this.stoppedT > 0.5) this.ballPhase = 'stopped';
      }
      p[2] += v[2] * h;
      return;
    }
    // Gravity, and the ground under it (the lane, the pit beyond the deck).
    const ground = z < DECK_END ? 0 : -PIT_DEPTH;
    if (z >= DECK_END && this.ballPhase === 'lane') {
      this.ballPhase = 'pit';
      if (this.sincePins < 0) this.sincePins = 0;
    }
    v[1] -= G * h;
    const onGround = p[1] <= ground + r + 1e-4;
    if (onGround) {
      if (v[1] < 0) v[1] = 0;
      // Friction at the contact patch opposes its slip.
      const ux = v[0] + r * w[2],
        uz = v[2] - r * w[0];
      const slip = Math.sqrt(ux * ux + uz * uz);
      const mu = this.ballPhase === 'pit' ? 0.5 : z < OIL_LEN ? MU_OIL : MU_DRY;
      if (slip > 1e-4) {
        const J = Math.min(mu * m * G * h, (slip * m) / 3.5);
        const fx = (-J * ux) / slip,
          fz = (-J * uz) / slip;
        v[0] += fx / m;
        v[2] += fz / m;
        const ii = this.invIb[0];
        w[0] += -r * fz * ii;
        w[2] += r * fx * ii;
      }
      // Rolling resistance, and the spin about the vertical dying away.
      const sp = Math.sqrt(v[0] * v[0] + v[2] * v[2]);
      if (sp > 1e-6) {
        const k = Math.max(0, 1 - (0.009 * G * h) / sp);
        v[0] *= k;
        v[2] *= k;
        w[0] *= k;
        w[2] = w[2] * k;
      }
      w[1] *= 1 - 0.3 * h;
      // The game's help: on the oil, a little of the ball's sideways drift fades (not its hook).
      if (this.assist > 0 && z < OIL_LEN && z > 0) v[0] *= 1 - this.assist * 0.35 * h;
    }
    // Kickbacks and the back cushion.
    if (z > KICK_Z0 && Math.abs(p[0]) + r > KICK_X) {
      const s = p[0] > 0 ? 1 : -1;
      p[0] = s * (KICK_X - r);
      if (v[0] * s > 0) {
        this.impact(HIT.kickback, Math.abs(v[0]), p[0], p[1], z);
        v[0] = -v[0] * 0.3;
      }
    }
    if (z + r > BACK_Z) {
      p[2] = BACK_Z - r;
      if (v[2] > 0) {
        this.impact(HIT.cushion, v[2], p[0], p[1], p[2]);
        v[2] = -v[2] * 0.08;
        v[0] *= 0.3;
      }
    }
    if (this.sincePins < 0 && z > HEAD_Z - 0.2) this.sincePins = 0;
    // A ball that stops on the lane (thrown too softly) is done.
    if (this.ballPhase === 'lane' && sqr2(v[0], v[2]) < 0.0025 && onGround) {
      this.stoppedT += h;
      if (this.stoppedT > 0.6) this.ballPhase = 'stopped';
    } else this.stoppedT = 0;
  }

  private impact(kind: number, speed: number, x: number, y: number, z: number) {
    const e = this.impacts[this.impactCount % this.impacts.length];
    e.kind = kind;
    e.speed = speed;
    e.x = x;
    e.y = y;
    e.z = z;
    this.impactCount++;
  }

  /** Each body's rotation, world inverse inertia and (pins) contact points. */
  private updateBody(i: number) {
    const q = 4 * i;
    const x = this.quat[q],
      y = this.quat[q + 1],
      z = this.quat[q + 2],
      w = this.quat[q + 3];
    const R = this.rot,
      o = 9 * i;
    R[o] = 1 - 2 * (y * y + z * z);
    R[o + 1] = 2 * (x * y - z * w);
    R[o + 2] = 2 * (x * z + y * w);
    R[o + 3] = 2 * (x * y + z * w);
    R[o + 4] = 1 - 2 * (x * x + z * z);
    R[o + 5] = 2 * (y * z - x * w);
    R[o + 6] = 2 * (x * z - y * w);
    R[o + 7] = 2 * (y * z + x * w);
    R[o + 8] = 1 - 2 * (x * x + y * y);
    const d0 = this.invIb[3 * i],
      d1 = this.invIb[3 * i + 1],
      d2 = this.invIb[3 * i + 2];
    const I = this.invIw;
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++) I[o + 3 * a + b] = R[o + 3 * a] * d0 * R[o + 3 * b] + R[o + 3 * a + 1] * d1 * R[o + 3 * b + 1] + R[o + 3 * a + 2] * d2 * R[o + 3 * b + 2];
    if (i === 0) return;
    // Contact points: the base's rim, then the spheres' centres.
    const px = this.pos[3 * i],
      py = this.pos[3 * i + 1],
      pz = this.pos[3 * i + 2];
    const P = this.pts;
    let k = 3 * NP * i;
    for (let j = 0; j < RIM_N; j++) {
      const lx = PIN_BASE_R * RIM_C[j],
        ly = -PIN_COM,
        lz = PIN_BASE_R * RIM_S[j];
      P[k++] = px + R[o] * lx + R[o + 1] * ly + R[o + 2] * lz;
      P[k++] = py + R[o + 3] * lx + R[o + 4] * ly + R[o + 5] * lz;
      P[k++] = pz + R[o + 6] * lx + R[o + 7] * ly + R[o + 8] * lz;
    }
    for (let j = 0; j < NS; j++) {
      const ly = PIN_SPHERES[j][0] - PIN_COM;
      P[k++] = px + R[o + 1] * ly;
      P[k++] = py + R[o + 4] * ly;
      P[k++] = pz + R[o + 7] * ly;
    }
  }

  // --- Contacts --------------------------------------------------------------------------

  private collide() {
    this.nc = 0;
    const P = this.pts;
    // Pins on the deck (or the pit floor), against the kickbacks and the cushion.
    for (let i = 1; i < N; i++) {
      if (!this.active[i] || !this.awake[i]) continue;
      const base = 3 * NP * i;
      for (let j = 0; j < NP; j++) {
        const k = base + 3 * j;
        const cx = P[k],
          cy = P[k + 1],
          cz = P[k + 2];
        const r = j < RIM_N ? 0 : PIN_SPHERES[j - RIM_N][1];
        const ground = cz < DECK_END ? 0 : -PIT_DEPTH;
        const d = ground - (cy - r);
        if (d > -0.004) this.addStatic(i, cx, cy - r, cz, 0, 1, 0, d, 0.32, 0.15, HIT.pinDeck);
        if (r > 0) {
          if (cz > KICK_Z0 && Math.abs(cx) + r > KICK_X) {
            const s = cx > 0 ? 1 : -1;
            this.addStatic(i, cx + s * r, cy, cz, -s, 0, 0, Math.abs(cx) + r - KICK_X, 0.3, 0.35, HIT.kickback);
          }
          if (cz + r > BACK_Z) this.addStatic(i, cx, cy, cz + r, 0, 0, -1, cz + r - BACK_Z, 0.6, 0.05, HIT.cushion);
          // The face of the deck, from the pit.
          if (cy < -0.02 && cz - r < DECK_END && cz > DECK_END - 0.2) this.addStatic(i, cx, cy, cz - r, 0, 0, 1, DECK_END - (cz - r), 0.3, 0.1, HIT.pit);
        }
      }
    }
    // The ball and the pins.
    if (this.active[0] && (this.ballPhase === 'lane' || this.ballPhase === 'pit')) {
      const bx = this.pos[0],
        by = this.pos[1],
        bz = this.pos[2];
      if (bz > HEAD_Z - 0.8) {
        for (let i = 1; i < N; i++) {
          if (!this.active[i]) continue;
          const o = 3 * i;
          if (sqr3(this.pos[o] - bx, this.pos[o + 1] - by, this.pos[o + 2] - bz) > 0.5 * 0.5) continue;
          const base = 3 * NP * i + 3 * RIM_N;
          for (let j = 0; j < NS; j++) {
            const k = base + 3 * j;
            const rr = BALL_R + PIN_SPHERES[j][1];
            const dx = bx - P[k],
              dy = by - P[k + 1],
              dz = bz - P[k + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= (rr + 0.003) * (rr + 0.003) || d2 < 1e-12) continue;
            const d = Math.sqrt(d2);
            if (!this.awake[i]) {
              // A ball resting against a sleeping pin (both in the pit) leaves it be.
              if (!this.moving(0)) continue;
              this.wake(i);
            }
            this.ballTouched = true;
            this.addPair(0, i, dx / d, dy / d, dz / d, P[k] + (dx / d) * PIN_SPHERES[j][1], P[k + 1] + (dy / d) * PIN_SPHERES[j][1], P[k + 2] + (dz / d) * PIN_SPHERES[j][1], rr - d, 0.12, 0.62, HIT.ballPin);
          }
        }
      }
    }
    // Pin on pin.
    for (let a = 1; a < N; a++) {
      if (!this.active[a]) continue;
      for (let b = a + 1; b < N; b++) {
        if (!this.active[b] || (!this.awake[a] && !this.awake[b])) continue;
        const oa = 3 * a,
          ob = 3 * b;
        if (sqr3(this.pos[oa] - this.pos[ob], this.pos[oa + 1] - this.pos[ob + 1], this.pos[oa + 2] - this.pos[ob + 2]) > 0.42 * 0.42) continue;
        for (let i = 0; i < NS; i++) {
          const ka = 3 * NP * a + 3 * (RIM_N + i);
          const ra = PIN_SPHERES[i][1];
          for (let j = 0; j < NS; j++) {
            const kb = 3 * NP * b + 3 * (RIM_N + j);
            const rr = ra + PIN_SPHERES[j][1];
            const dx = P[ka] - P[kb],
              dy = P[ka + 1] - P[kb + 1],
              dz = P[ka + 2] - P[kb + 2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= (rr + 0.002) * (rr + 0.002) || d2 < 1e-12) continue;
            const d = Math.sqrt(d2);
            // A pin only wakes a sleeping one by moving into it (pins resting together stay asleep).
            if (!this.awake[a] || !this.awake[b]) {
              if (!this.moving(this.awake[a] ? a : b)) continue;
              this.wake(a);
              this.wake(b);
            }
            const nx = dx / d,
              ny = dy / d,
              nz = dz / d;
            this.addPair(a, b, nx, ny, nz, P[kb] + nx * PIN_SPHERES[j][1], P[kb + 1] + ny * PIN_SPHERES[j][1], P[kb + 2] + nz * PIN_SPHERES[j][1], rr - d, 0.3, 0.42, HIT.pinPin);
          }
        }
      }
    }
  }

  private moving(i: number) {
    const o = 3 * i;
    return sqr3(this.vel[o], this.vel[o + 1], this.vel[o + 2]) > 0.0025 || sqr3(this.ang[o], this.ang[o + 1], this.ang[o + 2]) > 0.04;
  }

  private wake(i: number) {
    this.awake[i] = 1;
    this.still[i] = 0;
  }

  private addStatic(a: number, px: number, py: number, pz: number, nx: number, ny: number, nz: number, depth: number, mu: number, e: number, kind: number) {
    this.addContact(a, -1, nx, ny, nz, px, py, pz, depth, mu, e, kind);
  }

  private addPair(a: number, b: number, nx: number, ny: number, nz: number, px: number, py: number, pz: number, depth: number, mu: number, e: number, kind: number) {
    this.addContact(a, b, nx, ny, nz, px, py, pz, depth, mu, e, kind);
  }

  /** A contact: `n` pushes body a away from b (or from the world, b = -1) at point p. */
  private addContact(a: number, b: number, nx: number, ny: number, nz: number, px: number, py: number, pz: number, depth: number, mu: number, e: number, kind: number) {
    if (this.nc >= MAXC) return;
    const c = this.nc++;
    this.cA[c] = a;
    this.cB[c] = b;
    const c3 = 3 * c;
    this.cN[c3] = nx;
    this.cN[c3 + 1] = ny;
    this.cN[c3 + 2] = nz;
    const pa = 3 * a;
    this.cRa[c3] = px - this.pos[pa];
    this.cRa[c3 + 1] = py - this.pos[pa + 1];
    this.cRa[c3 + 2] = pz - this.pos[pa + 2];
    if (b >= 0) {
      const pb = 3 * b;
      this.cRb[c3] = px - this.pos[pb];
      this.cRb[c3 + 1] = py - this.pos[pb + 1];
      this.cRb[c3 + 2] = pz - this.pos[pb + 2];
    }
    // Tangents: any two directions across the normal.
    let t1x: number, t1y: number, t1z: number;
    if (Math.abs(nx) > 0.7) {
      const l = Math.sqrt(ny * ny + nx * nx);
      t1x = -ny / l;
      t1y = nx / l;
      t1z = 0;
    } else {
      const l = Math.sqrt(nz * nz + ny * ny);
      t1x = 0;
      t1y = -nz / l;
      t1z = ny / l;
    }
    this.cT1[c3] = t1x;
    this.cT1[c3 + 1] = t1y;
    this.cT1[c3 + 2] = t1z;
    this.cT2[c3] = ny * t1z - nz * t1y;
    this.cT2[c3 + 1] = nz * t1x - nx * t1z;
    this.cT2[c3 + 2] = nx * t1y - ny * t1x;
    this.cK[c3] = 1 / this.effMass(c, this.cN, c3);
    this.cK[c3 + 1] = 1 / this.effMass(c, this.cT1, c3);
    this.cK[c3 + 2] = 1 / this.effMass(c, this.cT2, c3);
    this.cJ[c3] = this.cJ[c3 + 1] = this.cJ[c3 + 2] = 0;
    this.cMu[c] = mu;
    // The approach speed sets the bounce (and the sound); penetration is pushed out gently; a gap may close.
    const vn = this.relVel(c, this.cN, c3);
    let target = depth > 0 ? Math.min(MAX_BIAS, (BETA * Math.max(0, depth - SLOP)) / STEP) : depth / STEP;
    if (vn < -0.5) target = Math.max(target, -e * vn);
    this.cTarget[c] = target;
    if (vn < -0.35 && depth > -0.002) this.impact(kind, -vn, px, py, pz);
  }

  private effMass(c: number, D: Float64Array, d3: number): number {
    const a = this.cA[c],
      b = this.cB[c];
    const c3 = 3 * c;
    let k = this.invM[a] + this.angTerm(a, this.cRa, c3, D, d3);
    if (b >= 0) k += this.invM[b] + this.angTerm(b, this.cRb, c3, D, d3);
    return k;
  }

  /** (I⁻¹ (r × d)) · (r × d). */
  private angTerm(i: number, R: Float64Array, r3: number, D: Float64Array, d3: number): number {
    const rx = R[r3],
      ry = R[r3 + 1],
      rz = R[r3 + 2];
    const dx = D[d3],
      dy = D[d3 + 1],
      dz = D[d3 + 2];
    const cx = ry * dz - rz * dy,
      cy = rz * dx - rx * dz,
      cz = rx * dy - ry * dx;
    const I = this.invIw,
      o = 9 * i;
    const ix = I[o] * cx + I[o + 1] * cy + I[o + 2] * cz;
    const iy = I[o + 3] * cx + I[o + 4] * cy + I[o + 5] * cz;
    const iz = I[o + 6] * cx + I[o + 7] * cy + I[o + 8] * cz;
    return ix * cx + iy * cy + iz * cz;
  }

  /** Relative velocity of a over b at the contact, along direction D. */
  private relVel(c: number, D: Float64Array, d3: number): number {
    const a = this.cA[c],
      b = this.cB[c];
    const c3 = 3 * c;
    let v = this.pointVel(a, this.cRa, c3, D, d3);
    if (b >= 0) v -= this.pointVel(b, this.cRb, c3, D, d3);
    return v;
  }

  private pointVel(i: number, R: Float64Array, r3: number, D: Float64Array, d3: number): number {
    const o = 3 * i;
    const wx = this.ang[o],
      wy = this.ang[o + 1],
      wz = this.ang[o + 2];
    const rx = R[r3],
      ry = R[r3 + 1],
      rz = R[r3 + 2];
    const vx = this.vel[o] + wy * rz - wz * ry,
      vy = this.vel[o + 1] + wz * rx - wx * rz,
      vz = this.vel[o + 2] + wx * ry - wy * rx;
    return vx * D[d3] + vy * D[d3 + 1] + vz * D[d3 + 2];
  }

  private applyImpulse(c: number, D: Float64Array, d3: number, j: number) {
    const a = this.cA[c],
      b = this.cB[c];
    const c3 = 3 * c;
    this.push(a, this.cRa, c3, D, d3, j);
    if (b >= 0) this.push(b, this.cRb, c3, D, d3, -j);
  }

  private push(i: number, R: Float64Array, r3: number, D: Float64Array, d3: number, j: number) {
    const o = 3 * i;
    const im = this.invM[i];
    const px = D[d3] * j,
      py = D[d3 + 1] * j,
      pz = D[d3 + 2] * j;
    this.vel[o] += px * im;
    this.vel[o + 1] += py * im;
    this.vel[o + 2] += pz * im;
    const rx = R[r3],
      ry = R[r3 + 1],
      rz = R[r3 + 2];
    const tx = ry * pz - rz * py,
      ty = rz * px - rx * pz,
      tz = rx * py - ry * px;
    const I = this.invIw,
      q = 9 * i;
    this.ang[o] += I[q] * tx + I[q + 1] * ty + I[q + 2] * tz;
    this.ang[o + 1] += I[q + 3] * tx + I[q + 4] * ty + I[q + 5] * tz;
    this.ang[o + 2] += I[q + 6] * tx + I[q + 7] * ty + I[q + 8] * tz;
  }

  private solve(_h: number) {
    const n = this.nc;
    for (let it = 0; it < ITER; it++) {
      for (let c = 0; c < n; c++) {
        const c3 = 3 * c;
        // Normal: no pulling, aim for the target separation speed.
        const vn = this.relVel(c, this.cN, c3);
        let dj = (this.cTarget[c] - vn) * this.cK[c3];
        const old = this.cJ[c3];
        const nj = Math.max(0, old + dj);
        dj = nj - old;
        this.cJ[c3] = nj;
        if (dj !== 0) this.applyImpulse(c, this.cN, c3, dj);
        // Friction: within the cone of the normal impulse.
        const lim = this.cMu[c] * nj;
        const v1 = this.relVel(c, this.cT1, c3);
        let j1 = -v1 * this.cK[c3 + 1];
        const o1 = this.cJ[c3 + 1];
        const n1 = clamp(o1 + j1, -lim, lim);
        j1 = n1 - o1;
        this.cJ[c3 + 1] = n1;
        if (j1 !== 0) this.applyImpulse(c, this.cT1, c3, j1);
        const v2 = this.relVel(c, this.cT2, c3);
        let j2 = -v2 * this.cK[c3 + 2];
        const o2 = this.cJ[c3 + 2];
        const n2 = clamp(o2 + j2, -lim, lim);
        j2 = n2 - o2;
        this.cJ[c3 + 2] = n2;
        if (j2 !== 0) this.applyImpulse(c, this.cT2, c3, j2);
      }
    }
  }

  private integrate(h: number) {
    for (let i = 0; i < N; i++) {
      if (!this.active[i]) continue;
      if (i > 0 && !this.awake[i]) continue;
      const o = 3 * i;
      if (i === 0 && this.ballPhase === 'gutter') continue;
      this.pos[o] += this.vel[o] * h;
      this.pos[o + 1] += this.vel[o + 1] * h;
      this.pos[o + 2] += this.vel[o + 2] * h;
      if (i === 0) {
        // The ball never sinks into the lane.
        const ground = this.pos[2] < DECK_END ? 0 : -PIT_DEPTH;
        if (this.pos[1] < ground + BALL_R) {
          this.pos[1] = ground + BALL_R;
          // Dropped or lofted: it lands with a thud and a little bounce.
          if (this.vel[1] < -0.9) {
            this.impact(this.pos[2] < DECK_END ? HIT.ballThud : HIT.pit, -this.vel[1], this.pos[0], ground, this.pos[2]);
            this.vel[1] = -this.vel[1] * 0.18;
          } else if (this.vel[1] < 0) this.vel[1] = 0;
        }
      }
      const wx = this.ang[o],
        wy = this.ang[o + 1],
        wz = this.ang[o + 2];
      const q = 4 * i;
      const qx = this.quat[q],
        qy = this.quat[q + 1],
        qz = this.quat[q + 2],
        qw = this.quat[q + 3];
      const k = 0.5 * h;
      let nx = qx + k * (wx * qw + wy * qz - wz * qy);
      let ny = qy + k * (wy * qw + wz * qx - wx * qz);
      let nz = qz + k * (wz * qw + wx * qy - wy * qx);
      let nw = qw + k * (-wx * qx - wy * qy - wz * qz);
      const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
      nx *= l;
      ny *= l;
      nz *= l;
      nw *= l;
      this.quat[q] = nx;
      this.quat[q + 1] = ny;
      this.quat[q + 2] = nz;
      this.quat[q + 3] = nw;
      this.updateBody(i);
      // A pin that falls far down (off the deck's side, into the pit) and lies still is out of play.
      if (i > 0 && this.pos[o + 1] < -1) this.active[i] = 0;
    }
    if (this.sincePins >= 0) this.sincePins += h;
  }

  private sleepCheck(h: number) {
    for (let i = 1; i < N; i++) {
      if (!this.active[i] || !this.awake[i]) continue;
      const o = 3 * i;
      const v2 = sqr3(this.vel[o], this.vel[o + 1], this.vel[o + 2]);
      const w2 = sqr3(this.ang[o], this.ang[o + 1], this.ang[o + 2]);
      // In the pit it's out of play: it settles sooner.
      const pit = this.pos[o + 1] < -0.05;
      if (pit ? v2 < 0.04 && w2 < 1 : v2 < 0.01 && w2 < 0.25) {
        this.still[i] += h;
        if (this.still[i] > (pit ? 0.25 : 0.35)) {
          this.awake[i] = 0;
          this.vel[o] = this.vel[o + 1] = this.vel[o + 2] = 0;
          this.ang[o] = this.ang[o + 1] = this.ang[o + 2] = 0;
        }
      } else this.still[i] = 0;
    }
  }
}

const RIM_C = Array.from({ length: RIM_N }, (_, j) => Math.cos((j / RIM_N) * Math.PI * 2));
const RIM_S = Array.from({ length: RIM_N }, (_, j) => Math.sin((j / RIM_N) * Math.PI * 2));
const sqr2 = (a: number, b: number) => a * a + b * b;
const sqr3 = (a: number, b: number, c: number) => a * a + b * b + c * c;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Pounds to kilograms. */
export const lbToKg = (lb: number) => lb * 0.45359237;
