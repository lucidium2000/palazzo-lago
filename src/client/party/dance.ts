import * as THREE from 'three';
import { reach } from '../net/embody';
import type { Beat } from './beat';

/**
 * Procedural dancing layered on the characters' rigs (after their idle clip):
 * a knee bounce on the kick with the feet planted (two-bone IK on the legs),
 * hips swaying and twisting, side steps, the odd spin, a nod, and arms by
 * IK to hand targets that move with the beat: grooving elbows, fist pumps,
 * claps on 2 and 4, hands up on the drop. Every guest dances a little
 * differently (their own bounce, lag behind the beat, favourite moves).
 * Used for the guests on the floor, your friends' avatars and your own body.
 */

type Bones = Record<string, THREE.Object3D | undefined>;
export interface Rig {
  root: THREE.Object3D;
  bones: Bones;
}

export type Move = 'groove' | 'pump' | 'step' | 'spin' | 'up' | 'clap' | 'sway';
/** The moves you can pick on a screen (the dance key cycles through them). */
export const DESK_MOVES: Move[] = ['groove', 'pump', 'step', 'spin', 'up'];
export const MOVE_NAMES: Record<Move, string> = {
  groove: 'Groove',
  pump: 'Fist pump',
  step: 'Step and clap',
  spin: 'Spin',
  up: 'Hands up',
  clap: 'Clap',
  sway: 'Sway',
};

export interface DanceStyle {
  /** 0.6..1.2: how much they put into it. */
  energy: number;
  /** Knee bounce depth (m at full energy). */
  bounce: number;
  /** Hip sway (m). */
  sway: number;
  /** How far behind (or ahead of) the beat they move, in beats. */
  lag: number;
  /** Their favourite moves on the drop. */
  moves: Move[];
  /** Spins now and then. */
  spinner: boolean;
  /** 0..1: how readily the hands go up. */
  eager: number;
  /** Spin direction. */
  dir: 1 | -1;
}

export function danceStyle(seed: number): DanceStyle {
  let s = Math.floor(Math.abs(seed) * 9301 + 49297) % 233280 || 1;
  const r = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const sets: Move[][] = [
    ['groove', 'pump', 'groove', 'step'],
    ['step', 'groove', 'clap', 'groove'],
    ['pump', 'groove', 'pump', 'spin'],
    ['groove', 'sway', 'step', 'groove'],
    ['groove', 'spin', 'groove', 'pump'],
  ];
  const moves = sets[Math.floor(r() * sets.length)];
  return {
    energy: 0.65 + r() * 0.55,
    bounce: 0.03 + r() * 0.035,
    sway: 0.02 + r() * 0.05,
    lag: (r() - 0.5) * 0.14,
    moves,
    spinner: moves.includes('spin'),
    eager: r(),
    dir: r() < 0.5 ? 1 : -1,
  };
}

const V = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ease = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** A square wave with soft edges (−1..1), period 1. */
const softSquare = (x: number) => Math.tanh(Math.sin(x * Math.PI * 2) * 3) / Math.tanh(3);

export interface PoseOpts {
  beat: Beat;
  dt: number;
  /** 0..1: how much they dance (fades in and out). */
  amount: number;
  move: Move;
  /** Pose the arms too (false: a VR player's real hands drive them). */
  arms: boolean;
  /** 0..1: throw the hands up (cheering, the drop). */
  handsUp?: number;
  /** Body scale (the rig root's). */
  scale: number;
  /** Your own body in VR: the knees bend by your real head's dip (m) instead of a made-up bounce. */
  dip?: number;
  /** No stepping or spinning (your own body in VR, or anyone in the water). */
  still?: boolean;
}

export class Dancer {
  readonly style: DanceStyle;
  private hands = { l: V(), r: V() };
  private handsInit = false;
  private feet = [V(), V()];
  private tmp = [V(), V(), V(), V(), V(), V()];

  constructor(seed: number) {
    this.style = danceStyle(seed);
  }

  /** A guest's move for this moment of the music. */
  moveFor(b: Beat): Move {
    const st = this.style;
    if (b.section === 'break') return st.energy > 1 ? 'groove' : 'sway';
    if (b.section === 'build') {
      if (b.cycleBar === 31 && st.eager > 0.35) return 'up';
      return b.cycleBar >= 28 || st.eager > 0.6 ? 'clap' : 'groove';
    }
    if (b.cycleBar < 2) return st.eager > 0.3 ? 'up' : 'pump';
    const k = Math.floor(b.bar / 4 + st.eager * 7) % st.moves.length;
    return st.moves[k];
  }

  /** Call after the rig's animation (and with its root placed, matrices current). */
  pose(rig: Rig, o: PoseOpts) {
    const b = rig.bones,
      root = rig.root,
      st = this.style;
    const beat = o.beat;
    const e = clamp01(o.amount) * st.energy * (0.5 + 0.5 * beat.intensity);
    if (e <= 0.001) {
      this.handsInit = false;
      unnudge(b.Spine ?? b.Abdomen ?? b.Torso);
      unnudge(b.Head);
      return;
    }
    const ph = beat.beats + st.lag;
    // 1 on the beat (knees down), 0 between.
    const g = 0.5 + 0.5 * Math.cos(ph * Math.PI * 2);
    const yaw0 = root.rotation.y;
    const right0 = this.tmp[0].set(-Math.cos(yaw0), 0, Math.sin(yaw0));

    // Feet where the clip has them, before the body moves (they stay planted).
    const legs = [
      [b.UpperLegL, b.LowerLegL, b.FootL],
      [b.UpperLegR, b.LowerLegR, b.FootR],
    ] as const;
    legs.forEach(([, , foot], i) => {
      if (!foot) return;
      // The clips don't move a root-parented foot: start from its standing spot (as sitpose.ts does).
      const rest = (foot.userData.restPos ??= foot.position.clone()) as THREE.Vector3;
      foot.position.copy(rest);
      foot.updateMatrixWorld(true);
      foot.getWorldPosition(this.feet[i]);
    });

    // --- The body: bounce, sway, step, twist, spin, a little hop on the drop.
    const still = !!o.still;
    let dip = o.dip !== undefined ? o.dip : st.bounce * e * (beat.kick ? g : 0.5 + 0.5 * g * 0.6);
    let lateral = st.sway * e * Math.sin(ph * Math.PI);
    let hop = 0;
    let spin = 0;
    const move = o.move;
    if (!still) {
      if (move === 'step') lateral = 0.16 * e * softSquare(ph / 4);
      if (move === 'up' && beat.section === 'drop' && st.energy > 0.9) {
        // Little jumps: up between the beats, land on the kick.
        hop = Math.max(0, -Math.cos(ph * Math.PI * 2)) * 0.06 * e;
        dip *= 0.6;
      }
      if (move === 'spin') {
        // A turn on beats 3-4 of every other bar.
        const k = clamp01(((ph % 8) - 4) / 2);
        spin = st.dir * Math.PI * 2 * ease(k);
      }
    }
    const twist = 0.13 * e * Math.sin(ph * Math.PI + 0.6) * (still ? 0.5 : 1);
    const handsUp = clamp01(o.handsUp ?? 0);
    root.position.addScaledVector(right0, lateral).addScaledVector(UP, hop - dip);
    root.rotation.y = yaw0 + twist + spin;
    root.updateMatrixWorld(true);

    // --- Legs: feet stay on the floor (they turn with a spin, slide with a step, lift on a hop).
    const yaw = yaw0 + spin;
    const fwd = this.tmp[1].set(Math.sin(yaw), 0, Math.cos(yaw));
    const ox = root.position.x,
      oz = root.position.z;
    legs.forEach(([upper, lower, foot], i) => {
      if (!upper || !lower || !foot) return;
      const f = this.feet[i];
      const t = this.tmp[2].copy(f);
      if (spin !== 0) {
        // Turn the stance about the body.
        const dx = t.x - (ox - right0.x * lateral),
          dz = t.z - (oz - right0.z * lateral);
        const c = Math.cos(spin),
          s = Math.sin(spin);
        t.x = ox - right0.x * lateral + dx * c + dz * s;
        t.z = oz - right0.z * lateral - dx * s + dz * c;
      }
      if (move === 'step' && !still) {
        // Each foot follows the hips, the leading one first, lifting as it moves.
        const lead = i === 0 ? 0.06 : -0.06;
        const w = 0.16 * e * softSquare(ph / 4 + lead);
        t.addScaledVector(right0, w);
        const speed = Math.abs(Math.cos((ph / 4 + lead) * Math.PI * 2));
        t.y += 0.05 * e * speed * speed;
      } else t.addScaledVector(right0, lateral * 0.25);
      t.y += hop;
      const hip = upper.getWorldPosition(this.tmp[3]);
      const pole = this.tmp[4]
        .copy(hip)
        .addScaledVector(fwd, 1)
        .add(this.tmp[5].set(0, 0.3, 0));
      const end = reach(upper, lower, foot, t, pole, 1);
      if (end && foot.parent && foot.parent !== lower) {
        foot.parent.updateWorldMatrix(true, false);
        foot.position.copy(foot.parent.worldToLocal(end));
        foot.updateMatrixWorld(true);
      }
    });

    // --- Nod and lean into the beat.
    const spine = b.Spine ?? b.Abdomen ?? b.Torso;
    nudgeX(spine, 0.06 * e * g);
    nudgeX(b.Head, 0.12 * e * g - 0.1 * handsUp);
    root.updateMatrixWorld(true);

    if (!o.arms) return;
    // --- Arms: hand targets relative to each shoulder (x: out to that side, y: up, z: forward), smoothed.
    const left = this.tmp[0].set(Math.cos(root.rotation.y), 0, -Math.sin(root.rotation.y));
    const fw = this.tmp[1].set(Math.sin(root.rotation.y), 0, Math.cos(root.rotation.y));
    const k = this.handsInit ? 1 - Math.exp(-o.dt * 14) : 1;
    this.handsInit = true;
    for (const [side, S, dir] of [
      ['l', 'L', 1],
      ['r', 'R', -1],
    ] as const) {
      const upper = b[`UpperArm${S}`],
        lower = b[`LowerArm${S}`],
        end = b[`Wrist${S}`] ?? b[`Hand${S}`];
      if (!upper || !lower || !end) continue;
      const want = this.tmp[2];
      armTarget(want, move, side === 'l', beat, ph, e, this.style);
      if (handsUp > 0) want.lerp(this.tmp[3].set(0.16 + 0.08 * Math.sin(ph * Math.PI + (side === 'l' ? 0 : 1)), 0.58, 0.06), handsUp);
      const h = this.hands[side];
      h.lerp(want, k);
      const shoulder = upper.getWorldPosition(this.tmp[3]);
      // Targets are for a real arm (~0.56 m shoulder to wrist): fit them to this character's arm.
      const elbow = lower.getWorldPosition(this.tmp[4]);
      const arm = shoulder.distanceTo(elbow) + elbow.distanceTo(end.getWorldPosition(this.tmp[5]));
      const sc = arm > 0.1 ? arm / 0.56 : o.scale;
      const target = this.tmp[4]
        .copy(shoulder)
        .addScaledVector(left, h.x * dir * sc)
        .addScaledVector(UP, h.y * sc)
        .addScaledVector(fw, h.z * sc);
      // Elbows down, back and out; out to the side when the hands are high.
      const high = clamp01((h.y + 0.1) / 0.5);
      const pole = this.tmp[5]
        .copy(shoulder)
        .addScaledVector(UP, -0.6 + 0.3 * high)
        .addScaledVector(fw, -0.3)
        .addScaledVector(left, (0.45 + 0.3 * high) * dir);
      reach(upper, lower, end, target, pole, Math.min(1, e * 1.6 + handsUp));
    }
  }
}

/**
 * Tips a bone about its local x by `a`, from where the clip put it this frame.
 * Some clips don't key every bone (a spine left alone keeps last frame's turn):
 * then undo our own last nudge first, so it doesn't pile up frame after frame.
 */
function nudgeX(bone: THREE.Object3D | undefined, a: number) {
  if (!bone) return;
  const ud = bone.userData as { danceIn?: THREE.Quaternion; danceOut?: THREE.Quaternion };
  if (ud.danceOut && ud.danceIn && bone.quaternion.equals(ud.danceOut)) bone.quaternion.copy(ud.danceIn);
  (ud.danceIn ??= new THREE.Quaternion()).copy(bone.quaternion);
  bone.rotateX(a);
  (ud.danceOut ??= new THREE.Quaternion()).copy(bone.quaternion);
}

function unnudge(bone: THREE.Object3D | undefined) {
  const ud = bone?.userData as { danceIn?: THREE.Quaternion; danceOut?: THREE.Quaternion } | undefined;
  if (bone && ud?.danceOut && ud.danceIn && bone.quaternion.equals(ud.danceOut)) bone.quaternion.copy(ud.danceIn);
  if (ud) ud.danceOut = undefined;
}

/** Where a hand goes (shoulder-relative, metres at a 1.8 m figure) for a move at this moment. */
function armTarget(out: THREE.Vector3, move: Move, isLeft: boolean, beat: Beat, ph: number, e: number, st: DanceStyle) {
  const g = 0.5 + 0.5 * Math.cos(ph * Math.PI * 2);
  const s = isLeft ? 1 : -1;
  // Grooving: elbows bent, fists at the belly, swinging opposite ways with the beat.
  const groove = () => out.set(0.12, -0.34 + 0.07 * g, 0.2 + 0.08 * Math.sin(ph * Math.PI + (isLeft ? 0 : Math.PI)));
  switch (move) {
    case 'pump': {
      // One fist punches up on every beat (the hands swap each bar).
      const lead = (Math.floor(beat.bar + st.eager * 3) % 2 === 0) === isLeft;
      if (!lead) return groove();
      const up = Math.pow(g, 1.5);
      return out.set(0.08, 0.05 + 0.42 * up, 0.18 + 0.1 * up);
    }
    case 'clap':
    case 'step': {
      // Clap on 2 and 4: the hands meet in front of the chest.
      const toClap = Math.abs(((((beat.beats + st.lag) % 2) + 2) % 2) - 1); // 0 on beats 2/4 (odd), 1 on 1/3
      const c = Math.pow(1 - toClap, 4);
      const y = move === 'clap' && beat.section === 'build' && beat.cycleBar >= 30 ? 0.25 : -0.12;
      return out.set(0.3 - 0.36 * c, y, 0.3 + 0.08 * c);
    }
    case 'up':
      return out.set(0.18 + 0.1 * s * Math.sin(ph * Math.PI), 0.55 + 0.04 * g, 0.08);
    case 'spin': {
      const k = ((ph % 8) + 8) % 8;
      if (k >= 3.6 && k < 6.4) return out.set(0.45, -0.08, 0.1); // arms out for the turn
      return groove();
    }
    case 'sway':
      return out.set(0.18, -0.46 + 0.03 * g, 0.12 + 0.06 * Math.sin(ph * Math.PI + (isLeft ? 0 : Math.PI)));
    default:
      void e;
      return groove();
  }
}
