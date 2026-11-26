import * as THREE from 'three';
import type { Act } from './fight/brawl';

/**
 * How a fighter moves (fight/ sets it, people.ts plays it): the boxing clips
 * from people/fight.glb (scripts/build-fight-anims.mjs) blended through each
 * person's animation mixer. No free IK on the arms: every pose is a clip.
 *
 * Three layers:
 *  - footwork (whole body): the guard, a forward/back shuffle and a side step,
 *    picked and sped up by how they're actually moving;
 *  - upper-body moves riding on the footwork: jab, cross (to the head or the
 *    body), hook, block, and the flinch when a punch lands;
 *  - whole-body moves that take over: the stagger, the knockdown, lying there,
 *    and the get-up.
 */
export interface FightPose {
  /** Fists up in their stance, 0..1. */
  guard: number;
  /** Gloves up over the face (blocking), 0..1. */
  block: number;
  /** The move playing (a punch, the stagger, the knockdown, the get-up) and how far into it (s). */
  act: Act;
  actT: number;
  /** The punch goes to the body. */
  body: boolean;
  /** Which fist throws: 0 = left, 1 = right. */
  side: 0 | 1;
  /** Where the punch goes (world). */
  aim: THREE.Vector3;
  /** 0 standing … 1 on the floor. */
  down: number;
  /** Groggy sway (after getting up), 0..1. */
  wobble: number;
  /** Seconds since a punch landed on them (a flinch plays), and where. */
  hitT: number;
  hitZone: 'head' | 'body';
}

export function fightPose(): FightPose {
  return { guard: 0, block: 0, act: 'none', actT: 0, body: false, side: 1, aim: new THREE.Vector3(), down: 0, wobble: 0, hitT: 99, hitZone: 'head' };
}

/** The footwork clips' design speed (m/s at timeScale 1; scripts/build-fight-anims.mjs SHUFFLE.v). */
const SHUFFLE_V = 0.5;
/** Faster than this they're walking or running in, not shuffling (m/s). */
const WALK_IN = 1.25;
/** Crossfade time between moves (s). */
const FADE = 0.12;
/** Fist height (rig metres, before the person's scale) the punches land at: head / body. */
const PUNCH_Y = { head: 1.3, body: 1.03 };

const LOCO = ['Box_Guard', 'Box_Shuffle', 'Box_Side'] as const;
const FULL = ['Box_Stagger', 'Box_KO', 'Box_Lie', 'Box_Getup'];
const UPPER = ['Box_Jab', 'Box_Cross', 'Box_JabBody', 'Box_CrossBody', 'Box_Hook', 'Box_Block', 'Box_HitHead', 'Box_HitBody'];
/** Every fight clip (the loco ones also come as legs only, worn under an upper-body move). */
export const FIGHT_CLIPS = [...LOCO, ...LOCO.map((n) => n + 'Legs'), ...FULL, ...UPPER];

interface Rig {
  root: THREE.Object3D;
  bones: Record<string, THREE.Object3D>;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
}

interface State {
  w: Record<string, number>;
  px: number;
  pz: number;
  vf: number;
  vs: number;
  /** How much the fight clips own the body (vs their ordinary clips). */
  fw: number;
  last: Act;
  lastT: number;
}

interface Fighter {
  pos: THREE.Vector3;
  yaw: number;
  fight: FightPose | null;
  driven?: boolean;
}

const target: Record<string, number> = {};
const times: Record<string, number> = {};

function state(rig: Rig, p: Fighter): State {
  return (rig.root.userData.fightAnim ??= { w: {}, px: p.pos.x, pz: p.pos.z, vf: 0, vs: 0, fw: 0, last: 'none', lastT: 0 } as State);
}

/**
 * Sets the fight clips' weights and times for this frame (call before the
 * mixer updates). Returns how much the fight owns the body (0..1): the
 * ordinary clips (idle, walk…) get the rest.
 */
export function fightMix(p: Fighter, rig: Rig, clips: ReadonlyMap<string, THREE.AnimationClip>, dt: number): number {
  const f = p.fight;
  const st = rig.root.userData.fightAnim as State | undefined;
  if (!f && (!st || st.fw < 1e-3)) {
    if (st) {
      for (const n of Object.keys(st.w)) rig.actions[n]?.setEffectiveWeight(0);
      delete rig.root.userData.fightAnim;
    }
    return 0;
  }
  const s = state(rig, p);
  // The clips (made the first time this rig fights).
  if (!rig.actions.Box_Guard) {
    for (const n of FIGHT_CLIPS) {
      const c = clips.get(n);
      if (!c) continue;
      const a = rig.mixer.clipAction(c);
      a.play();
      a.setEffectiveWeight(0);
      rig.actions[n] = a;
    }
    if (!rig.actions.Box_Guard) return 0;
  }
  // How they're moving, in their own frame.
  if (dt > 0) {
    const vx = (p.pos.x - s.px) / dt,
      vz = (p.pos.z - s.pz) / dt;
    const fx = Math.sin(p.yaw),
      fz = Math.cos(p.yaw);
    const k = Math.min(1, dt * 8);
    const jump = Math.hypot(vx, vz) > 6;
    s.vf += ((jump ? 0 : vx * fx + vz * fz) - s.vf) * k;
    s.vs += ((jump ? 0 : vx * fz - vz * fx) - s.vs) * k;
  }
  s.px = p.pos.x;
  s.pz = p.pos.z;
  for (const n of FIGHT_CLIPS) target[n] = 0;
  const a = rig.actions;
  const dur = (n: string) => a[n]?.getClip().duration ?? 1;
  const act = f?.act ?? 'none';
  const t = f?.actT ?? 0;
  // Whole body.
  let full = 0;
  if (act === 'stagger') {
    target.Box_Stagger = full = 1;
    times.Box_Stagger = t;
  } else if (act === 'ko') {
    full = 1;
    const fall = dur('Box_KO');
    if (t < fall) {
      target.Box_KO = 1;
      times.Box_KO = t;
    } else {
      target.Box_Lie = 1;
      times.Box_Lie = (t - fall) % dur('Box_Lie');
    }
  } else if (act === 'getup') {
    target.Box_Getup = full = 1;
    times.Box_Getup = t;
  }
  // Upper body.
  let up = 0;
  if (!full && f) {
    const hitN = f.hitZone === 'head' ? 'Box_HitHead' : 'Box_HitBody';
    const hit = f.hitT < dur(hitN) ? 1 : 0;
    if (hit) {
      target[hitN] = hit;
      times[hitN] = f.hitT;
    }
    if (act === 'jab' || act === 'cross' || act === 'hook') {
      const n = act === 'jab' ? (f.body ? 'Box_JabBody' : 'Box_Jab') : act === 'cross' ? (f.body ? 'Box_CrossBody' : 'Box_Cross') : 'Box_Hook';
      target[n] = 1 - hit;
      times[n] = t;
    } else if (f.block > 0) {
      target.Box_Block = f.block * (1 - hit);
      times.Box_Block = 0.25;
    }
    for (const n of UPPER) up += target[n];
    up = Math.min(1, up);
  }
  // Footwork.
  const speed = Math.hypot(s.vf, s.vs);
  const m = Math.min(1, speed / 0.25);
  const fw = Math.abs(s.vf) + Math.abs(s.vs) || 1;
  const loco = { Box_Guard: 1 - m, Box_Shuffle: (m * Math.abs(s.vf)) / fw, Box_Side: (m * Math.abs(s.vs)) / fw };
  for (const n of LOCO) {
    target[n] = (1 - full) * (1 - up) * loco[n];
    target[n + 'Legs'] = (1 - full) * up * loco[n];
  }
  for (const n of UPPER) target[n] *= 1 - full;
  // How much the fight owns the body: all of it in a move or with fists up; none walking off.
  let own = act !== 'none' ? 1 : f ? Math.max(f.guard, f.block, up) : 0;
  if (act === 'none') own *= 1 - THREE.MathUtils.clamp((speed - WALK_IN) / 0.4, 0, 1);
  // Crossfade.
  const k = Math.min(1, dt / FADE);
  s.fw += (own - s.fw) * Math.min(1, dt / 0.18);
  for (const n of FIGHT_CLIPS) {
    const w = (s.w[n] ?? 0) + (target[n] - (s.w[n] ?? 0)) * k;
    s.w[n] = w < 1e-4 ? 0 : w;
    const ac = a[n];
    if (!ac) continue;
    ac.setEffectiveWeight(s.w[n] * s.fw);
  }
  // Times: the moves follow the fight's clock; the footwork loops at the speed they move.
  for (const n of [...FULL, ...UPPER]) {
    const ac = a[n];
    if (!ac) continue;
    ac.timeScale = 0;
    if (times[n] !== undefined && target[n] > 0) ac.time = Math.min(times[n], dur(n) - 1e-3);
    delete times[n];
  }
  const sh = a.Box_Shuffle,
    sd = a.Box_Side;
  if (sh) sh.timeScale = THREE.MathUtils.clamp(s.vf / SHUFFLE_V, -2.5, 2.5);
  if (sd) sd.timeScale = THREE.MathUtils.clamp(s.vs / SHUFFLE_V, -2.5, 2.5);
  for (const n of LOCO) {
    const legs = a[n + 'Legs'];
    if (legs && a[n]) {
      legs.timeScale = a[n].timeScale;
      legs.time = a[n].time;
    }
  }
  s.last = act;
  s.lastT = t;
  return s.fw;
}

/**
 * Up from the floor: the get-up ends with them standing where their head lay,
 * facing the other way. Before the clip lets go, move the person there (the
 * root follows the pose: nobody slides or spins back).
 */
export function fightHandoff(p: Fighter, rig: Rig) {
  const st = rig.root.userData.fightAnim as State | undefined;
  if (!st || st.last !== 'getup' || p.fight?.act === 'getup' || p.driven) return;
  st.last = 'none';
  const fl = rig.bones.FootL,
    fr = rig.bones.FootR;
  if (!fl || !fr) return;
  const a = fl.getWorldPosition(new THREE.Vector3()),
    b = fr.getWorldPosition(new THREE.Vector3());
  p.pos.x = (a.x + b.x) / 2;
  p.pos.z = (a.z + b.z) / 2;
  p.yaw += Math.PI;
  st.px = p.pos.x;
  st.pz = p.pos.z;
}

const _a = new THREE.Vector3(),
  _q = new THREE.Quaternion(),
  _p = new THREE.Quaternion();
/**
 * The punch finds its target: the clip lands at a set height, so the upper
 * body leans a little up or down (a few degrees, on the spine) toward where
 * the punch is aimed. Call after the mixer.
 */
export function fightAim(p: Fighter, rig: Rig, scale: number) {
  const f = p.fight;
  if (!f || (f.act !== 'jab' && f.act !== 'cross' && f.act !== 'hook')) return;
  // Strongest through the strike, easing in over the wind-up and out over the recovery.
  const t = f.actT;
  const w = t < 0.4 ? 0 : t < 0.75 ? (t - 0.4) / 0.35 : t < 1.0 ? 1 : Math.max(0, 1 - (t - 1.0) / 0.4);
  const spine = rig.bones.Torso;
  if (w <= 0 || !spine?.parent) return;
  const dx = f.aim.x - p.pos.x,
    dz = f.aim.z - p.pos.z;
  const d = Math.max(0.5, Math.hypot(dx, dz));
  const want = f.aim.y - p.pos.y - (f.body && f.act !== 'hook' ? PUNCH_Y.body : PUNCH_Y.head) * scale;
  const ang = THREE.MathUtils.clamp(Math.atan2(want, d), -0.22, 0.22) * w;
  // Pitch about their right-hand axis (positive leans down toward a low target).
  _a.set(-Math.cos(p.yaw), 0, Math.sin(p.yaw));
  _q.setFromAxisAngle(_a, ang);
  spine.parent.getWorldQuaternion(_p);
  const world = _p.clone().multiply(spine.quaternion);
  spine.quaternion.copy(_p.invert().multiply(_q.multiply(world)));
}
