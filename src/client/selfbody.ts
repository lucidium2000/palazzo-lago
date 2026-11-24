import * as THREE from 'three';
import { assets, spawnCharacter } from './assets';
import { AVATARS } from './net/avatars';
import { reach, setFingers } from './net/embody';
import type { FingerPose } from './fingers';
import { skinTone } from './posedhand';

/**
 * Your own body in VR: the character you picked, standing under your headset
 * with its head hidden (so you look out of its eyes), arms reaching to your
 * real controllers, hands closing into fists when you squeeze grip, and legs
 * walking when you move. Look down and it's you.
 */
/** How far (metres, at your size) the body sits behind your eyes. */
export const BODY_BACK = 0.13;
/** Size of the character's own (hidden) hand inside the real one. */
const HIDDEN_HAND = 0.3;
const FIST: FingerPose = [1, 1, 1, 1, 1];

export class SelfBody {
  private rig: ReturnType<typeof spawnCharacter> | null = null;
  private kind = '';
  private bodyYaw = 0;
  /** Skin tone of the character you wear (your hands are tinted to match). */
  skin: THREE.Color | null = null;
  /** Called when you change character (to re-tint your hands). */
  onSkin: ((c: THREE.Color) => void) | null = null;
  private avatar = -1;
  readonly root = new THREE.Group();

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
    this.root.visible = false;
  }

  /** Wears the character at AVATARS[i]. */
  setAvatar(i: number) {
    if (!assets.people || i === this.avatar) return;
    this.avatar = i;
    const a = AVATARS[((i % AVATARS.length) + AVATARS.length) % AVATARS.length];
    if (this.rig) this.root.remove(this.rig.root);
    this.kind = a.kind;
    const rig = spawnCharacter(assets.people, a.kind);
    rig.root.traverse((o) => {
      o.frustumCulled = false;
      (o as THREE.Mesh).castShadow = false;
    });
    for (const [name, act] of Object.entries(rig.actions)) {
      act.play();
      act.setEffectiveWeight(name === 'Idle_Neutral' ? 1 : 0);
    }
    this.root.add(rig.root);
    this.rig = rig;
    this.skin = skinTone(rig.mesh);
    if (this.skin) this.onSkin?.(this.skin);
  }

  /**
   * Poses the body for this frame. `head` is the headset (camera) world
   * position/direction, `hands` the controllers (null if not tracked), `grip`
   * how hard each grip is squeezed, `speed` walking speed.
   */
  update(dt: number, o: { on: boolean; head: THREE.Vector3; dir: THREE.Vector3; floorY: number; hands: { l: THREE.Vector3 | null; r: THREE.Vector3 | null }; poses: { l: FingerPose; r: FingerPose }; wrists?: { l: { p: THREE.Vector3; q: THREE.Quaternion } | null; r: { p: THREE.Vector3; q: THREE.Quaternion } | null }; speed: number }) {
    this.root.visible = o.on && !!this.rig;
    const rig = this.rig;
    if (!o.on || !rig) return;
    const female = this.kind.startsWith('female');
    // Scale the character so its eyes sit at your real eye height.
    const eye = Math.max(0.9, o.head.y - o.floorY);
    const sc = THREE.MathUtils.clamp(eye / ((female ? 1.72 : 1.82) * 0.93), 0.75, 1.25);
    rig.root.scale.setScalar(sc);
    // The body turns with you when you look far to one side or walk.
    const headYaw = Math.atan2(o.dir.x, o.dir.z);
    const diff = Math.atan2(Math.sin(headYaw - this.bodyYaw), Math.cos(headYaw - this.bodyYaw));
    if (Math.abs(diff) > 0.6 || o.speed > 0.2) this.bodyYaw += diff * Math.min(1, dt * (o.speed > 0.2 ? 8 : 3));
    const fwd = new THREE.Vector3(Math.sin(this.bodyYaw), 0, Math.cos(this.bodyYaw));
    // Neck under the eyes, set back so the body sits a little behind your
    // point of view (as your real one does) and the chest doesn't fill your view.
    rig.root.position.set(o.head.x, o.floorY, o.head.z).addScaledVector(fwd, -BODY_BACK * sc);
    rig.root.rotation.y = this.bodyYaw;
    const a = rig.actions;
    // Walk and run blend with your real speed (strides match the ground you cover).
    const run = THREE.MathUtils.clamp((o.speed - 1.8) / 0.8, 0, 1);
    const walk = THREE.MathUtils.clamp(o.speed / 0.9, 0, 1) * (1 - run);
    a.Idle_Neutral?.setEffectiveWeight(1 - walk - run);
    a.Walk?.setEffectiveWeight(walk);
    a.Run?.setEffectiveWeight(run);
    if (a.Walk) a.Walk.timeScale = THREE.MathUtils.clamp(o.speed / (1.15 * sc), 0.45, 1.6);
    if (a.Run) a.Run.timeScale = THREE.MathUtils.clamp(o.speed / (3.2 * sc), 0.6, 1.5);
    rig.mixer.update(dt);
    const b = rig.bones;
    // Hide the head from the inside (collapse it), keep the neck. The
    // character's own hands collapse into the wrists too: you see the real
    // hand models on your controllers (posedhand.ts), and the arms reach them.
    // (The neck too: with the body set back you'd look down into it.)
    b.Neck?.scale.setScalar(0.001);
    rig.root.updateMatrixWorld(true);
    const left = new THREE.Vector3(Math.cos(this.bodyYaw), 0, -Math.sin(this.bodyYaw));
    for (const [side, S, dir] of [['l', 'L', 1], ['r', 'R', -1]] as const) {
      const target = o.hands[side];
      const upper = b[`UpperArm${S}`],
        lower = b[`LowerArm${S}`],
        end = b[`Wrist${S}`];
      if (target && upper && lower && end) {
        const shoulder = upper.getWorldPosition(new THREE.Vector3());
        const pole = shoulder.clone().add(new THREE.Vector3(0, -0.6, 0)).addScaledVector(fwd, -0.3).addScaledVector(left, 0.45 * dir);
        reach(upper, lower, end, target, pole, 1);
      }
      // The character's own hand becomes a small fist tucked inside the real
      // hand model, turned the same way, so the forearm runs full width into it.
      const w = o.wrists?.[side];
      if (end) end.scale.setScalar(w ? HIDDEN_HAND : 1);
      if (w && end) setFingers(b, S, FIST);
    }
  }
}
