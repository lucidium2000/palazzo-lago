import * as THREE from 'three';
import { SHOW_CLIPS, type ShowMove } from './routine';

/**
 * How the headliner dances (party/stage.ts says what, people.ts plays it): his
 * stage moves, clips from people/show.glb (scripts/build-show-anims.mjs),
 * played through his own animation mixer by the beat clock. Each clip is set
 * to where the music is in the move (no clock of its own, so it can't drift
 * off the beat), and a change of move crossfades over a tenth of a second, on
 * the beat the routine changes. Only he gets these actions (they're made the
 * first time he dances); nobody else pays for them.
 */
export interface ShowPose {
  /** The move, and how far through its clip (0..1). */
  move: ShowMove;
  f: number;
  /** 0..1: how much the moves own his body (fades in as he starts, out as he stops). */
  own: number;
}

/** Crossfade between moves (s). */
const FADE = 0.1;

interface Rig {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Record<string, THREE.AnimationAction>;
}

interface State {
  cur: ShowMove | null;
  prev: ShowMove | null;
  prevF: number;
  /** 0..1 into the crossfade from prev to cur. */
  k: number;
  own: number;
}

/**
 * Sets his stage clips' weights and times for this frame (call before the
 * mixer updates). Returns how much they own the body (0..1); his ordinary
 * clips get the rest.
 */
export function showMix(p: { show: ShowPose | null }, rig: Rig, clips: ReadonlyMap<string, THREE.AnimationClip>, dt: number): number {
  const sp = p.show;
  let st = rig.root.userData.showAnim as State | undefined;
  if (!sp && (!st || st.own < 1e-3)) {
    if (st) {
      for (const n of SHOW_CLIPS) rig.actions[n]?.setEffectiveWeight(0);
      st.own = 0;
    }
    return 0;
  }
  if (!rig.actions.Show_Groove) {
    for (const n of SHOW_CLIPS) {
      const c = clips.get(n);
      if (!c) continue;
      const a = rig.mixer.clipAction(c);
      a.play();
      a.timeScale = 0;
      a.setEffectiveWeight(0);
      rig.actions[n] = a;
    }
    if (!rig.actions.Show_Groove) return 0;
  }
  st ??= rig.root.userData.showAnim = { cur: null, prev: null, prevF: 0, k: 1, own: 0 } as State;
  const want = sp ? sp.own : 0;
  st.own += (want - st.own) * Math.min(1, dt / 0.15);
  if (sp && sp.move !== st.cur) {
    st.prev = st.cur;
    st.k = st.cur ? 0 : 1;
    st.cur = sp.move;
  }
  st.k = Math.min(1, st.k + dt / FADE);
  const a = rig.actions;
  for (const n of SHOW_CLIPS) {
    const ac = a[n];
    if (!ac) continue;
    let w = 0;
    if (n === st.cur) w = st.k;
    else if (n === st.prev && st.k < 1) w = 1 - st.k;
    ac.setEffectiveWeight(w * st.own);
    if (w > 0) {
      const dur = ac.getClip().duration;
      // The outgoing move holds where it was; the current one follows the beat.
      const f = n === st.cur && sp ? sp.f : st.prevF;
      ac.time = Math.min(dur - 1e-3, Math.max(0, f) * dur);
    }
  }
  if (sp) st.prevF = sp.f;
  return st.own;
}

// --- Arms on top of the clips (allocation-free two-bone IK) ------------------------------

const _s = new THREE.Vector3(),
  _e = new THREE.Vector3(),
  _w = new THREE.Vector3(),
  _t = new THREE.Vector3(),
  _d = new THREE.Vector3(),
  _p = new THREE.Vector3(),
  _e2 = new THREE.Vector3(),
  _from = new THREE.Vector3(),
  _to = new THREE.Vector3(),
  _q = new THREE.Quaternion(),
  _qw = new THREE.Quaternion(),
  _qp = new THREE.Quaternion();

function rotateWorld(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3) {
  if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
  _q.setFromUnitVectors(from.normalize(), to.normalize());
  bone.getWorldQuaternion(_qw).premultiply(_q);
  if (bone.parent) _qw.premultiply(bone.parent.getWorldQuaternion(_qp).invert());
  bone.quaternion.copy(_qw).normalize();
  bone.updateMatrixWorld(true);
}

/**
 * Bends an arm so its wrist goes `weight` of the way from where the clip put
 * it to `target`, the elbow toward `pole` (world points).
 */
export function reachArm(upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3, weight: number) {
  if (weight <= 0.001) return;
  upper.getWorldPosition(_s);
  lower.getWorldPosition(_e);
  end.getWorldPosition(_w);
  const a = _s.distanceTo(_e),
    b = _e.distanceTo(_w);
  _t.copy(_w).lerp(target, Math.min(1, weight));
  _d.copy(_t).sub(_s);
  const d = THREE.MathUtils.clamp(_d.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  _d.normalize();
  const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _p.copy(pole).sub(_s);
  _p.addScaledVector(_d, -_p.dot(_d));
  if (_p.lengthSq() < 1e-8) _p.set(0, -1, 0);
  _p.normalize();
  _e2.copy(_s).addScaledVector(_d, a * cosA).addScaledVector(_p, a * sinA);
  rotateWorld(upper, _from.copy(_e).sub(_s), _to.copy(_e2).sub(_s));
  lower.getWorldPosition(_e);
  end.getWorldPosition(_w);
  rotateWorld(lower, _from.copy(_w).sub(_e), _to.copy(_t).sub(_e));
}
