/**
 * Physical roulette spin, simulated in advance.
 *
 * Angles are radians about the wheel axis (counter-clockwise positive). The
 * rotor turns counter-clockwise and slowly loses speed; the ball is launched
 * clockwise on the track at 4–5 m/s, slowed by rolling friction and air drag.
 * When centripetal force can no longer hold it on the sloped track it spirals
 * down the cone, rattling off the deflectors, drops onto the spinning rotor and
 * hops over the pocket frets (real gravity, energy lost on each hit, sometimes
 * kicked backwards) until it settles in a pocket.
 *
 * The pocket is decided fairly by the RNG first; the whole trajectory is then
 * rotated so it ends in that pocket (the launch point is arbitrary anyway).
 */

export const WHEEL_R = { track: 0.372, rotorEdge: 0.29, pocket: 0.218 };
const Y = { track: 0.104, rotorEdge: 0.07, pocket: 0.058 };
const G = 9.81;
const POCKETS = 38;
const SECTOR = (Math.PI * 2) / POCKETS;

export interface SpinSample {
  t: number;
  /** Rotor angle relative to its angle at launch. */
  rotor: number;
  /** Ball angle (absolute, before the final rotation). */
  ball: number;
  r: number;
  y: number;
  /** Ball speed along its path, m/s (drives the rolling sound). */
  speed: number;
  phase: 'track' | 'spiral' | 'rotor' | 'rest';
}

export interface SpinPlan {
  samples: SpinSample[];
  /** Fret and deflector hits: time and strength 0..1 (for clicks). */
  hits: { t: number; strength: number }[];
  duration: number;
  /** Ball angle relative to the rotor at rest (a pocket centre). */
  finalRel: number;
  rotorSpeedEnd: number;
}

function rng(seed: number) {
  let s = (Math.imul(seed ^ 0x9e3779b9, 2654435761) ^ (seed >>> 7)) >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function simulateSpin(opts: { rotorSpeed: number; seed: number; ballSpeed?: number; dt?: number }): SpinPlan {
  const dt = opts.dt ?? 1 / 120;
  const rand = rng(opts.seed);
  let t = 0;
  let rotor = 0;
  let wr = opts.rotorSpeed;
  // Launch: 4–5 m/s clockwise on the track.
  let wb = -((opts.ballSpeed ?? 4.2 + rand() * 0.8) / WHEEL_R.track);
  let ball = 0;
  let r = WHEEL_R.track;
  let y = Y.track;
  let vy = 0;
  let h = 0; // height above the pocket floor while hopping on the rotor
  let phase: SpinSample['phase'] = 'track';
  let settleT = 0;
  let rel = 0;
  let wrel = 0;
  const samples: SpinSample[] = [];
  const hits: { t: number; strength: number }[] = [];
  // The ball leaves the track when ω²r falls below g·tan(track slope ≈ 22°).
  const wDrop = Math.sqrt((G * Math.tan((22 * Math.PI) / 180)) / WHEEL_R.track);
  let spiralK = 0;
  let nextRattle = 0.15 + rand() * 0.2;

  while (t < 30) {
    // Rotor: bearings and air slowly take its speed.
    wr *= Math.exp(-0.06 * dt);
    rotor += wr * dt;

    if (phase === 'track') {
      // Rolling friction plus air drag (∝ v²).
      const w = Math.abs(wb);
      const decel = 0.42 + 0.018 * w * w;
      wb = -Math.max(0, w - decel * dt);
      ball += wb * dt;
      y = Y.track + Math.sin(t * 37) * 0.0004;
      if (Math.abs(wb) < wDrop) phase = 'spiral';
    } else if (phase === 'spiral') {
      // Down the cone: radius shrinks, friction rises, deflectors rattle it.
      spiralK = Math.min(1, spiralK + dt / 0.7);
      const w = Math.abs(wb);
      wb = -Math.max(0.5, w - (1.4 + 0.02 * w * w) * dt);
      ball += wb * dt;
      r = WHEEL_R.track + (WHEEL_R.rotorEdge - WHEEL_R.track) * spiralK * spiralK;
      vy -= G * dt;
      y += vy * dt;
      const floor = Y.track + (Y.rotorEdge - Y.track) * spiralK;
      if (y < floor) {
        y = floor;
        vy = 0;
      }
      if (t > nextRattle && spiralK > 0.2 && spiralK < 0.85) {
        // A deflector: the ball jumps a little and loses speed.
        nextRattle = t + 0.18 + rand() * 0.25;
        vy = 0.25 + rand() * 0.35;
        wb *= 0.82 + rand() * 0.1;
        hits.push({ t, strength: 0.5 + rand() * 0.3 });
      }
      if (spiralK >= 1) {
        phase = 'rotor';
        rel = ball - rotor;
        wrel = wb - wr;
        h = Math.max(0, y - Y.rotorEdge);
        vy = Math.min(vy, 0);
      }
    } else if (phase === 'rotor') {
      // Hopping over frets, relative to the spinning rotor.
      vy -= G * dt;
      h += vy * dt;
      rel += wrel * dt;
      wrel *= Math.exp(-0.9 * dt);
      // Roll inward toward the pocket ring.
      r += (WHEEL_R.pocket - r) * Math.min(1, dt * 3.5);
      if (h <= 0) {
        h = 0;
        const v = Math.abs(wrel) * r;
        if (v > 0.12) {
          // Struck a fret: bounce up, lose energy, sometimes kicked back.
          vy = v * (0.22 + rand() * 0.3);
          wrel *= rand() < 0.22 ? -(0.2 + rand() * 0.3) : 0.35 + rand() * 0.35;
          r = Math.min(WHEEL_R.rotorEdge, r + 0.006 + rand() * 0.01);
          hits.push({ t, strength: Math.min(1, v / 1.2) });
        } else {
          vy = 0;
          wrel *= Math.exp(-6 * dt);
          if (Math.abs(wrel) < 0.08) {
            phase = 'rest';
            settleT = 0;
          }
        }
      }
      ball = rotor + rel;
      y = Y.pocket + h;
    } else {
      // Settle into the nearest pocket centre and ride the rotor.
      const target = Math.round(rel / SECTOR) * SECTOR;
      rel += (target - rel) * Math.min(1, dt * 8);
      r += (WHEEL_R.pocket - r) * Math.min(1, dt * 8);
      settleT += dt;
      ball = rotor + rel;
      y = Y.pocket;
      if (settleT > 0.5) {
        rel = target;
        ball = rotor + rel;
        samples.push({ t, rotor, ball, r: WHEEL_R.pocket, y, speed: 0, phase });
        break;
      }
    }
    const speed = phase === 'rotor' || phase === 'rest' ? Math.abs(wrel) * r : Math.abs(wb) * r;
    samples.push({ t, rotor, ball, r, y, speed, phase });
    t += dt;
  }
  const last = samples[samples.length - 1];
  return { samples, hits, duration: last.t, finalRel: last.ball - last.rotor, rotorSpeedEnd: wr };
}

/** Rotation to apply to the ball so the plan ends in pocket index `pocketIndex`. */
export function aimFor(plan: SpinPlan, pocketIndex: number): number {
  return pocketIndex * SECTOR - plan.finalRel;
}

/** The sample at time t (linear interpolation). */
export function sampleAt(plan: SpinPlan, t: number): SpinSample {
  const s = plan.samples;
  if (t <= 0) return s[0];
  if (t >= plan.duration) return s[s.length - 1];
  const dt = s[1].t - s[0].t;
  const i = Math.min(s.length - 2, Math.floor(t / dt));
  const a = s[i],
    b = s[i + 1];
  const k = (t - a.t) / (b.t - a.t || 1);
  return {
    t,
    rotor: a.rotor + (b.rotor - a.rotor) * k,
    ball: a.ball + (b.ball - a.ball) * k,
    r: a.r + (b.r - a.r) * k,
    y: a.y + (b.y - a.y) * k,
    speed: a.speed + (b.speed - a.speed) * k,
    phase: k < 0.5 ? a.phase : b.phase,
  };
}
