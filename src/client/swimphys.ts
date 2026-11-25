/**
 * Swimming maths, kept free of three.js scene state so it can be unit-tested:
 * the vertical motion of your body (gravity, landing, wading, floating,
 * diving) and the filtering of VR hand motion into stroke velocities.
 *
 * Heights are of your feet (the rig's floor). While swimming your body lies
 * flat along the surface, so the "feet" sit wherever puts your eyes just above
 * the water; in VR that can be well below the pool floor, which is fine.
 */

export const GRAVITY = 9.81;
/** Water this much deeper than the floor (or more) is swum in, not waded through. */
export const SWIM_DEPTH = 1.0;
/** Eyes float this far above the surface. */
export const EYES_ABOVE = 0.12;
/** Buoyancy spring (rad/s): critically damped, settles in about a second. */
const OMEGA = 3.6;
/** Vertical speed limits in the water (m/s): water is thick, nothing launches you. */
const MAX_UP = 1.4;
const MAX_DOWN = 2.5;
/** Deepest dive: the head goes at most this far under (and never near the floor). */
export const MAX_DIVE = 1.0;
const HEAD_OVER_FLOOR = 0.3;
/**
 * Stroke thrust limit (m/s²), both ways, so flailing evens out: pushing the water
 * up dives you (a quick push, a slow recovery), pushing it down treads water,
 * and that lift fades out as you rise above your floating height.
 */
const THRUST_MAX = 9;
/** Head under water this long (s) without diving: you're brought back up. */
export const RESCUE_AFTER = 3;
/** ...and this long even while diving: you come up for air. */
export const MAX_BREATH = 6;
/** Physics sub-step (s): the frame dt can be large (slow devices, emulators). */
const SUBSTEP = 1 / 120;

export interface VState {
  feetY: number;
  velY: number;
  /** In the air (or sinking/rising toward the floor or the surface). */
  airborne: boolean;
  /** Seconds your head has been under water without diving, and in all. */
  under: number;
  held: number;
  /** Being brought back to the surface by the safety net. */
  rescue: boolean;
}

export interface VInput {
  /** Floor height under you. */
  ground: number;
  /** Water surface over you, or null when dry. */
  water: number | null;
  /** Eye height above the feet to float at (smoothed in VR). */
  eyeH: number;
  /** Actual eye height above the feet right now (VR: the headset), for the floor clearance. */
  headH?: number;
  /** Holding a dive (desktop C). */
  dive?: boolean;
  /** Vertical acceleration from arm strokes (m/s², + up). */
  thrust?: number;
  /** Dived with your arms recently (the safety net leaves you alone). */
  diving?: boolean;
  /** Swimming (deep enough, see isDeep); worked out from the depth when left out. */
  deep?: boolean;
}

export interface VEvents {
  /** Speed you landed on the floor at (0: no landing). */
  land: number;
  /** Speed you entered the water at (0: no splash). */
  splash: number;
}

export const newVState = (feetY = 0): VState => ({ feetY, velY: 0, airborne: false, under: 0, held: 0, rescue: false });

/**
 * Deep enough to swim? Once swimming you keep swimming a little shallower
 * (over the last step), so a head swaying over the edge of a step doesn't flip
 * you between floating and standing.
 */
export const isDeep = (ground: number, water: number | null, swimming = false) => water !== null && water - ground > SWIM_DEPTH - (swimming ? 0.25 : 0);

/** Feet height that puts your eyes just above the water. */
export const floatFeet = (water: number, eyeH: number) => water + EYES_ABOVE - eyeH;

/** The lowest your feet may go in deep water: the head stays off the floor and within MAX_DIVE of the surface. */
export const lowestFeet = (ground: number, water: number, headH: number) => Math.max(ground + HEAD_OVER_FLOOR, water - MAX_DIVE) - headH;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/**
 * Advances the vertical motion by dt (sub-stepped, so any dt is stable).
 * Writes impact speeds into `ev` (taking the largest over the sub-steps).
 */
export function verticalStep(s: VState, i: VInput, dt: number, ev: VEvents = { land: 0, splash: 0 }): VEvents {
  ev.land = 0;
  ev.splash = 0;
  if (!Number.isFinite(s.feetY) || !Number.isFinite(s.velY)) {
    s.feetY = i.water !== null && (i.deep ?? isDeep(i.ground, i.water)) ? floatFeet(i.water, i.eyeH) : i.ground;
    s.velY = 0;
    s.airborne = false;
  }
  if (!(dt > 0)) return ev;
  dt = Math.min(dt, 0.5);
  const deep = i.deep ?? isDeep(i.ground, i.water);
  const n = Math.max(1, Math.ceil(dt / SUBSTEP));
  const h = dt / n;
  for (let k = 0; k < n; k++) subStep(s, i, deep, h, ev);
  // The safety net: head under for too long without diving.
  if (i.water !== null) {
    const head = s.feetY + (i.headH ?? i.eyeH);
    const under = head < i.water - 0.03;
    if (under && !i.diving && !i.dive) s.under += dt;
    else if (!under) s.under = 0;
    if (under) s.held += dt;
    else s.held = 0;
    if ((s.under > RESCUE_AFTER || s.held > MAX_BREATH) && deep) s.rescue = true;
    // Back up: done, unless what sank you (floating on a standing eye height while
    // your real head is low) is still there.
    if (!under && (i.headH === undefined || Math.abs(i.headH - i.eyeH) < 0.1)) s.rescue = false;
  } else {
    s.under = s.held = 0;
    s.rescue = false;
  }
  return ev;
}

function subStep(s: VState, i: VInput, deep: boolean, h: number, ev: VEvents) {
  const { ground, water } = i;
  const prev = s.feetY;
  if (water !== null && deep) {
    const headH = i.headH ?? i.eyeH;
    // Being rescued: float on your real head height right now (you may be crouching).
    const float = floatFeet(water, s.rescue ? headH : i.eyeH);
    const low = lowestFeet(ground, water, headH);
    const target = i.dive && !s.rescue ? Math.max(low + 0.05, float - MAX_DIVE) : float;
    const above = s.feetY - float;
    // Well above the floating height and out of the water: falling (or jumping) in.
    if (above > 0.25 && s.feetY > water - 0.3) {
      s.velY -= GRAVITY * h;
      s.airborne = true;
    } else {
      // In the water: a critically damped spring to the float (or dive) height,
      // strokes on top, no gravity, the speed held to what water allows.
      let thrust = s.rescue ? Math.max(0, i.thrust ?? 0) : (i.thrust ?? 0);
      thrust = clamp(thrust, -THRUST_MAX, THRUST_MAX);
      // Pushing water down only lifts you while you're still in it.
      if (thrust > 0) thrust *= clamp(1 - above / 0.2, 0, 1);
      // Diving with your arms: a softer pull back up, so a stroke takes you under.
      const w = s.rescue ? OMEGA * 1.4 : i.diving || i.dive ? OMEGA * 0.55 : OMEGA;
      let acc = w * w * (target - s.feetY) - 2 * w * s.velY + thrust;
      acc = clamp(acc, -GRAVITY, 8);
      if (s.feetY > water - 0.3 && s.velY < 0) {
        // Hitting the water from above: it brakes you hard.
        if (s.velY < -MAX_DOWN) s.velY = -MAX_DOWN;
      }
      s.velY = clamp(s.velY + acc * h, -MAX_DOWN, MAX_UP);
      s.airborne = Math.abs(s.feetY - target) > 0.03 || Math.abs(s.velY) > 0.05;
    }
    s.feetY += s.velY * h;
    if (s.feetY < low) {
      // Never into the floor: stop, and ease back up if the floor clearance moved (you stood up).
      s.feetY = Math.min(low, Math.max(s.feetY, prev) + 2 * h);
      if (s.velY < 0) s.velY = 0;
    }
  } else {
    // Dry, or wading: stand on the floor.
    const rest = ground;
    if (s.airborne || s.feetY > rest + 0.01) {
      s.airborne = true;
      s.velY -= GRAVITY * h;
      if (water !== null && s.feetY + 0.6 < water) s.velY *= Math.exp(-3.5 * h);
      if (water !== null && s.feetY < water) s.velY = Math.max(s.velY, -MAX_DOWN * 2);
      s.feetY += s.velY * h;
      if (s.feetY <= rest && s.velY <= 0) {
        ev.land = Math.max(ev.land, -s.velY);
        s.feetY = rest;
        s.velY = 0;
        s.airborne = false;
      }
    } else {
      // Below the floor (you swam into the shallows): stand up smoothly.
      s.feetY += (rest - s.feetY) * Math.min(1, h * 6);
      if (rest - s.feetY < 0.002) s.feetY = rest;
      s.velY = 0;
    }
  }
  // Entering the water: a splash sized to how fast you hit it.
  if (water !== null && prev > water - 0.15 && s.feetY <= water - 0.15) ev.splash = Math.max(ev.splash, -s.velY, 0.001);
}

/**
 * One hand's stroke velocity, from its position in the rig's own frame (so
 * turning, teleports, hauling out or floating up don't look like strokes).
 * Implausible samples (tracking glitches: the controller jumping when it loses
 * tracking) are thrown away and the hand is ignored for a moment; the rest
 * are averaged over ~70 ms and capped.
 */
export class StrokeHand {
  /** Faster than a hand can move (m/s): a glitch. */
  static readonly GLITCH_SPEED = 7;
  /** Strongest stroke speed used (m/s). */
  static readonly MAX_SPEED = 3.5;
  private trail: { t: number; x: number; y: number; z: number }[] = [];
  private quietUntil = -Infinity;

  /** Add a sample: time (s) and position in the rig's frame. */
  push(t: number, x: number, y: number, z: number) {
    const last = this.trail[this.trail.length - 1];
    if (last) {
      const dt = t - last.t;
      if (dt <= 0) return;
      const d = Math.hypot(x - last.x, y - last.y, z - last.z);
      if (dt > 0.25) this.trail.length = 0;
      else if (d / dt > StrokeHand.GLITCH_SPEED) {
        this.trail.length = 0;
        this.quietUntil = t + 0.15;
      }
    }
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) {
      this.trail.length = 0;
      return;
    }
    this.trail.push({ t, x, y, z });
    while (this.trail.length > 2 && t - this.trail[0].t > 0.2) this.trail.shift();
  }

  reset() {
    this.trail.length = 0;
  }

  /** Velocity (m/s, rig frame) into `out`; zero right after a glitch or with too few samples. */
  velocity(out: { x: number; y: number; z: number }) {
    out.x = out.y = out.z = 0;
    const tr = this.trail;
    if (tr.length < 2) return out;
    const last = tr[tr.length - 1];
    if (last.t < this.quietUntil) return out;
    let first = tr[tr.length - 2];
    for (const s of tr)
      if (last.t - s.t <= 0.07 && s !== last) {
        first = s;
        break;
      }
    const dt = last.t - first.t;
    if (dt < 0.008) return out;
    out.x = (last.x - first.x) / dt;
    out.y = (last.y - first.y) / dt;
    out.z = (last.z - first.z) / dt;
    const sp = Math.hypot(out.x, out.y, out.z);
    if (sp > StrokeHand.MAX_SPEED) {
      const k = StrokeHand.MAX_SPEED / sp;
      out.x *= k;
      out.y *= k;
      out.z *= k;
    }
    return out;
  }
}

/**
 * Turns one hand's motion through the water into thrust.
 * `rel` is the hand's velocity relative to the water (m/s, world axes: its
 * velocity in the rig plus your own), returns accelerations (m/s²) into `out`:
 * the water pushes back against the hand, harder the faster you pull.
 */
export function strokeThrust(rel: { x: number; y: number; z: number }, out: { x: number; y: number; z: number }) {
  out.x = out.y = out.z = 0;
  const sp = Math.hypot(rel.x, rel.y, rel.z);
  if (sp < 0.35) return out;
  const k = Math.min(1.6, (sp - 0.35) * 0.9);
  out.x = -rel.x * 2.4 * k;
  out.z = -rel.z * 2.4 * k;
  out.y = -rel.y * 1.6 * k;
  return out;
}

/** Strongest horizontal swim speed from strokes (m/s). */
export const MAX_SWIM_SPEED = 2.0;
