import * as THREE from 'three';
import { controllerPose, handTrackPose, handTrackWrist, OPEN, type FingerPose } from './fingers';
import { PALM } from './net/embody';
import { GRIP_HOLD, PosedHand } from './posedhand';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import { replyPrompt } from './replyhud';

/**
 * VR hands: shows the real Quest controller (or tracked hand) models and lets
 * you grab things. Grip button (controllers) or a pinch near an object (hands)
 * grabs; letting go releases. Things you can grab: roulette chips from your
 * rack, the classic slot's lever, glasses from the bar.
 */

export interface Hand {
  index: number;
  grip: THREE.Group;
  ctrl: THREE.Group;
  held: Grabbable | null;
  /** Object attached to the hand while held (a chip, a glass). */
  carried: THREE.Object3D | null;
  pos: THREE.Vector3;
}

export interface Grabbable {
  /** World-space point and reach radius. */
  at(): THREE.Vector3;
  radius: number;
  enabled?(): boolean;
  /**
   * Taken between finger and thumb (small things: a chip off a stack): reach is
   * also measured from the pinch point, not only the palm, and it follows the
   * pinch while held (drag and release get the pinch point).
   */
  pinch?: boolean;
  /** Among grabbables in reach, a higher priority wins before distance (the wallet tray over the rail). */
  priority?: number;
  /** Return an object to carry in the hand, 'drag' to keep receiving positions, or null to refuse. */
  grab(hand: Hand): THREE.Object3D | 'drag' | null;
  drag?(hand: Hand, pos: THREE.Vector3): void;
  release?(hand: Hand, pos: THREE.Vector3, carried: THREE.Object3D | null): void;
}

/** WebXR joint names of the five fingertips, thumb first (the order of a FingerPose). */
export const TIPS = ['thumb-tip', 'index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'] as const;

export class Hands {
  readonly hands: Hand[] = [];
  private models: THREE.Object3D[] = [];
  private handModels: THREE.Object3D[] = [];
  private handSpaces: THREE.Group[] = [];
  private stands: THREE.Object3D[] = [];
  /** Your hands, seated on the controllers (see posedhand.ts). */
  readonly posed = { left: new PosedHand('left'), right: new PosedHand('right') };
  /** Skin for the hand-tracking mesh too. */
  readonly skin = new THREE.MeshStandardMaterial({ color: 0xd9a17e, roughness: 0.62, side: THREE.DoubleSide });
  private controllersShown = false;

  /** Show the plastic controllers instead of hands (off by default: hands replace them). */
  showControllers(v: boolean) {
    this.controllersShown = v;
    for (const m of this.models) m.visible = v;
    for (const st of this.stands) if (!v) st.visible = false;
  }

  /** Matches your hands to your avatar's skin. */
  setSkin(c: THREE.Color) {
    this.posed.left.setColor(c);
    this.posed.right.setColor(c);
    this.skin.color.copy(c);
  }

  /** Is this side's hand followed by hand tracking (no controller)? */
  tracked(side: 'left' | 'right') {
    const hs = this.handSpace(side) as (THREE.Object3D & { joints?: Record<string, THREE.Object3D> }) | undefined;
    return !!hs?.joints?.['wrist']?.visible;
  }

  /** Your index fingertip (world), from hand tracking or the hand on the controller. */
  fingertip(side: 'left' | 'right'): THREE.Vector3 | null {
    const hs = this.handSpace(side) as (THREE.Object3D & { joints?: Record<string, THREE.Object3D> }) | undefined;
    const j = hs?.joints?.['index-finger-tip'];
    if (j?.visible) return j.getWorldPosition(new THREE.Vector3());
    const ph = this.posed[side];
    if (!ph.visible || !ph.ready) return null;
    return ph.jointWorld('index-finger-tip');
  }

  /**
   * All five fingertips (world, thumb first) into `out`, and which are known into `has`.
   * Returns where they came from: 'hand' (hand tracking: the real joints), 'ctrl' (the hand
   * posed on a controller from its touch sensors), or null (no hand). No allocation.
   */
  fingertips(side: 'left' | 'right', out: THREE.Vector3[], has: boolean[]): 'hand' | 'ctrl' | null {
    const hs = this.handSpace(side) as (THREE.Object3D & { joints?: Record<string, THREE.Object3D> }) | undefined;
    const joints = hs?.joints;
    if (joints?.['wrist']?.visible) {
      for (let i = 0; i < 5; i++) {
        const j = joints[TIPS[i]];
        has[i] = !!j?.visible;
        if (has[i]) j!.getWorldPosition(out[i]);
      }
      return 'hand';
    }
    const ph = this.posed[side];
    if (!ph.visible || !ph.ready) {
      for (let i = 0; i < 5; i++) has[i] = false;
      return null;
    }
    for (let i = 0; i < 5; i++) has[i] = !!ph.jointWorld(TIPS[i], out[i]);
    return 'ctrl';
  }

  /** The wrist's world pose (for the avatar's forearm, and for your friend's view of you). */
  wristPose(side: 'left' | 'right'): { p: THREE.Vector3; q: THREE.Quaternion } | null {
    const hs = this.handSpace(side) as (THREE.Object3D & { joints?: Record<string, THREE.Object3D> }) | undefined;
    const j = hs?.joints?.['wrist'];
    if (j?.visible) return { p: j.getWorldPosition(new THREE.Vector3()), q: j.getWorldQuaternion(new THREE.Quaternion()) };
    const ph = this.posed[side];
    if (!ph.visible || !ph.ready) return null;
    const h = this.hands.find((x) => x.ctrl.userData.handedness === side);
    if (!h || h.ctrl.userData.connected === false || !h.grip.visible) return null;
    ph.root.updateMatrixWorld(true);
    return ph.wristPoseWorld();
  }

  /** Poses the controller hands for this frame (fingers from the touch sensors). */
  poseHands(poses: { l: FingerPose; r: FingerPose }) {
    for (const side of ['left', 'right'] as const) {
      const ph = this.posed[side];
      const h = this.hands.find((x) => x.ctrl.userData.handedness === side);
      const on = !this.controllersShown && !!h && h.ctrl.userData.connected !== false && !h.ctrl.userData.isHand;
      if (on && ph.root.parent !== h!.grip) {
        h!.grip.add(ph.root);
        ph.calibrateToGrip(GRIP_HOLD.fwd(), GRIP_HOLD.palm(side), GRIP_HOLD.fit);
      }
      ph.visible = on;
      if (on) ph.setPose(poses[side === 'left' ? 'l' : 'r'], { controller: true });
    }
    // Hand tracking: the real joints drive the same hand mesh (tinted to your skin).
    for (const hm of this.handModels)
      hm.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (m.isSkinnedMesh && m.material !== this.skin) {
          m.material = this.skin;
          m.frustumCulled = false;
        }
      });
  }

  /** The tracked-hand space for a side (when hand tracking is active). */
  private handSpace(side: 'left' | 'right') {
    const i = this.hands.findIndex((x) => x.ctrl.userData.handedness === side);
    return i >= 0 ? this.handSpaces[i] : undefined;
  }

  /** Your finger pose for a side, from hand tracking or the controller's touch sensors. */
  fingerPose(side: 'left' | 'right', gamepad: Gamepad | undefined): FingerPose {
    const hs = this.handSpace(side);
    const tracked = hs ? handTrackPose(hs as never) : null;
    if (tracked) return tracked;
    const h = this.hands.find((x) => x.ctrl.userData.handedness === side);
    const pose = gamepad ? controllerPose(gamepad) : ([...OPEN] as FingerPose);
    // Holding something: the hand closes around it.
    if (h?.carried || h?.held) for (let i = 0; i < 5; i++) pose[i] = Math.max(pose[i], i === 0 ? 0.55 : 0.6);
    return pose;
  }

  /**
   * Which way your real hand points and faces (world): from hand-tracking joints when
   * tracked, else from the controller grip (you hold it like a stick: knuckles run
   * along the handle, palm wrapped around it).
   */
  handAim(side: 'left' | 'right'): { fwd: THREE.Vector3; palm: THREE.Vector3 } | null {
    const S = side === 'left' ? 'L' : 'R';
    const sign = PALM.sign[S];
    const hs = this.handSpace(side) as (THREE.Object3D & { joints?: Record<string, THREE.Object3D> }) | undefined;
    const j = hs?.joints;
    const P = (n: string) => (j?.[n]?.visible ? j[n].getWorldPosition(new THREE.Vector3()) : null);
    const wr = P('wrist'),
      mid = P('middle-finger-phalanx-proximal'),
      idx = P('index-finger-phalanx-proximal'),
      pin = P('pinky-finger-phalanx-proximal');
    if (wr && mid && idx && pin) {
      const fwd = mid.sub(wr).normalize();
      const across = idx.sub(pin);
      return { fwd, palm: new THREE.Vector3().crossVectors(fwd, across).normalize().multiplyScalar(sign) };
    }
    const h = this.hands.find((x) => x.ctrl.userData.handedness === side);
    if (!h || h.ctrl.userData.connected === false || !h.grip.visible) return null;
    const q = h.grip.getWorldQuaternion(new THREE.Quaternion());
    const across = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const palm = new THREE.Vector3(side === 'left' ? 1 : -1, 0, 0).applyQuaternion(q);
    // Knuckles forward of the wrist, perpendicular to the handle (see handFrame in embody.ts).
    const fwd = new THREE.Vector3().crossVectors(across, palm).normalize().multiplyScalar(sign);
    return { fwd, palm };
  }

  /** Where your wrist is for a hand ('left'/'right'): just behind the controller's grip. */
  wrist(side: 'left' | 'right'): THREE.Vector3 | null {
    const h = this.hands.find((x) => x.ctrl.userData.handedness === side);
    const hs = this.handSpace(side);
    const tw = hs ? handTrackWrist(hs as never) : null;
    if (tw) return tw;
    if (!h || h.ctrl.userData.connected === false || !h.grip.visible) return null;
    const wp = this.wristPose(side);
    if (wp) return wp.p;
    h.grip.updateMatrixWorld(true);
    return new THREE.Vector3(0, -0.01, 0.07).applyMatrix4(h.grip.matrixWorld);
  }
  private items: Grabbable[] = [];
  /** The headset position, for "bring the glass to your mouth". */
  head = new THREE.Vector3();
  onHaptic: ((hand: Hand, strength: number, ms: number) => void) | null = null;

  constructor(
    private renderer: THREE.WebGLRenderer,
    rig: THREE.Object3D,
    private scene: THREE.Scene,
  ) {
    const controllerModels = new XRControllerModelFactory();
    const handModels = new XRHandModelFactory();
    // The hand-tracking mesh: the same hand model, bundled with the game (no CDN).
    handModels.setPath(new URL('assets/hands/', document.baseURI).href);
    // A simple built-in hand shown until (or unless) the real controller model loads.
    const glove = new THREE.MeshStandardMaterial({ color: 0xe9d7c0, roughness: 0.6 });
    const cuff = new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.5 });
    const fallback = () => {
      const g = new THREE.Group();
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.025, 0.09), glove);
      palm.position.set(0, -0.01, 0.01);
      const fingers = new THREE.Mesh(new THREE.CapsuleGeometry(0.013, 0.05, 3, 6).rotateX(Math.PI / 2), glove);
      for (let k = 0; k < 4; k++) {
        const f = fingers.clone();
        f.position.set(-0.027 + k * 0.018, -0.012, -0.065);
        g.add(f);
      }
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.08, 12).rotateX(Math.PI / 2), cuff);
      sleeve.position.set(0, -0.01, 0.09);
      g.add(palm, sleeve);
      g.traverse((o) => (o.raycast = () => {}));
      return g;
    };
    for (let i = 0; i < 2; i++) {
      const grip = renderer.xr.getControllerGrip(i);
      const model = controllerModels.createControllerModel(grip);
      grip.add(model);
      model.visible = false;
      this.models.push(model);
      const stand = fallback();
      stand.visible = false;
      grip.add(stand);
      this.stands.push(stand);
      // Hide the stand-in once the real model has loaded.
      const check = setInterval(() => {
        if (model.children.length > 0) {
          stand.visible = false;
          clearInterval(check);
        }
      }, 1000);
      rig.add(grip);
      const handSpace = renderer.xr.getHand(i);
      const hm = handModels.createHandModel(handSpace, 'mesh');
      handSpace.add(hm);
      this.handModels.push(hm);
      this.handSpaces.push(handSpace);
      rig.add(handSpace);
      const ctrl = renderer.xr.getController(i);
      const hand: Hand = { index: i, grip, ctrl, held: null, carried: null, pos: new THREE.Vector3() };
      this.hands.push(hand);
      ctrl.addEventListener('connected', (e: any) => (ctrl.userData.isHand = !!e.data?.hand));
      ctrl.addEventListener('squeezestart', () => this.tryGrab(hand));
      ctrl.addEventListener('squeezeend', () => this.release(hand));
      // Hand tracking has no grip button: a pinch near something grabs it.
      ctrl.addEventListener('selectstart', () => {
        // While a reply prompt is up, pinches answer it (replyhud.ts) instead of grabbing.
        if (ctrl.userData.isHand && replyPrompt.busy()) return;
        if (this.nearest(hand)) {
          ctrl.userData.suppressSelect = true;
          ctrl.userData.grabbedBySelect = this.tryGrab(hand);
        }
      });
      ctrl.addEventListener('selectend', () => {
        if (ctrl.userData.grabbedBySelect) {
          ctrl.userData.grabbedBySelect = false;
          this.release(hand);
        }
      });
    }
  }

  register(g: Grabbable) {
    this.items.push(g);
    return g;
  }

  /** Forgets a grabbable (a loose thing whose slot was reused). */
  unregister(g: Grabbable) {
    const i = this.items.indexOf(g);
    if (i >= 0) this.items.splice(i, 1);
  }

  /** Empties a hand without letting go (what it held is gone: eaten, or put on your head). */
  empty(hand: Hand) {
    hand.carried?.removeFromParent();
    hand.held = null;
    hand.carried = null;
    hand.ctrl.userData.grabbing = false;
  }

  private handPos(hand: Hand) {
    // Grip space is the palm; tracked hands report it too.
    hand.grip.updateMatrixWorld(true);
    return hand.pos.setFromMatrixPosition(hand.grip.matrixWorld);
  }

  private tipBuf = [0, 1, 2, 3, 4].map(() => new THREE.Vector3());
  private tipHas = [false, false, false, false, false];

  /** Between thumb and index fingertips (where a pinch closes), or the index tip alone; null if the fingers aren't known. */
  pinchPos(hand: Hand): THREE.Vector3 | null {
    const side = hand.ctrl.userData.handedness as 'left' | 'right' | undefined;
    if (side !== 'left' && side !== 'right') return null;
    if (!this.fingertips(side, this.tipBuf, this.tipHas)) return null;
    if (this.tipHas[0] && this.tipHas[1]) return this.tipBuf[0].clone().lerp(this.tipBuf[1], 0.5);
    return this.tipHas[1] ? this.tipBuf[1].clone() : null;
  }

  /** Where this hand takes small things right now (the pinch, else the palm), world. */
  reach(hand: Hand): THREE.Vector3 {
    return (this.pinchPos(hand) ?? this.handPos(hand)).clone();
  }

  /** Where a held grabbable follows the hand: the pinch for small things, else the palm. */
  private holdPos(hand: Hand, g: Grabbable): THREE.Vector3 {
    return (g.pinch && this.pinchPos(hand)) || this.handPos(hand);
  }

  private nearest(hand: Hand): Grabbable | null {
    const p = this.handPos(hand).clone();
    let pinch: THREE.Vector3 | null | undefined;
    let best: Grabbable | null = null,
      bd = Infinity,
      bp = -Infinity;
    for (const g of this.items) {
      if (g.enabled && !g.enabled()) continue;
      const at = g.at();
      let d = at.distanceTo(p);
      if (g.pinch) {
        if (pinch === undefined) pinch = this.pinchPos(hand);
        if (pinch) d = Math.min(d, at.distanceTo(pinch));
      }
      if (d >= g.radius) continue;
      const pr = g.priority ?? 0;
      if (pr > bp || (pr === bp && d < bd)) {
        bd = d;
        bp = pr;
        best = g;
      }
    }
    return best;
  }

  private tryGrab(hand: Hand): boolean {
    if (hand.held) return false;
    const g = this.nearest(hand);
    if (!g) return false;
    return this.grabWith(hand, g);
  }

  /** Closes a free hand around a particular grabbable (whatever is resting in your palm when you close it). */
  grabWith(hand: Hand, g: Grabbable): boolean {
    if (hand.held || (g.enabled && !g.enabled())) return false;
    const r = g.grab(hand);
    if (!r) return false;
    hand.held = g;
    hand.ctrl.userData.grabbing = true;
    if (r !== 'drag') {
      hand.carried = r;
      hand.grip.attach(r);
    }
    this.onHaptic?.(hand, 0.5, 40);
    return true;
  }

  private release(hand: Hand) {
    const g = hand.held;
    if (!g) return;
    const pos = this.holdPos(hand, g).clone();
    const carried = hand.carried;
    if (carried) this.scene.attach(carried);
    hand.held = null;
    hand.carried = null;
    hand.ctrl.userData.grabbing = false;
    g.release?.(hand, pos, carried);
  }

  /** Gives an object straight to a free hand (a drink from a waiter). */
  give(obj: THREE.Object3D, g: Grabbable, prefer?: 'left' | 'right'): boolean {
    const free = this.hands.filter((h) => !h.held && h.ctrl.userData.connected !== false);
    const hand = free.find((h) => h.ctrl.userData.handedness === prefer) ?? free[0];
    if (!hand) return false;
    hand.held = g;
    hand.carried = obj;
    hand.ctrl.userData.grabbing = true;
    hand.grip.add(obj);
    obj.position.set(0, 0.02, -0.04);
    obj.rotation.set(0, 0, 0);
    return true;
  }

  /** Recent hand positions (for throw speed). */
  private trail = new Map<Hand, { t: number; p: THREE.Vector3 }[]>();

  /**
   * How fast a hand is moving right now (m/s, world): averaged over the last
   * ~70 ms, which is what a throw "feels" like when you let go.
   */
  velocity(hand: Hand): THREE.Vector3 {
    const tr = this.trail.get(hand);
    if (!tr || tr.length < 2) return new THREE.Vector3();
    const last = tr[tr.length - 1];
    // The oldest sample within ~70 ms (or the previous frame, on a slow frame rate).
    let first = tr[tr.length - 2];
    for (const s of tr)
      if (last.t - s.t <= 0.07 && s !== last) {
        first = s;
        break;
      }
    const dt = last.t - first.t;
    return dt > 0.008 ? last.p.clone().sub(first.p).divideScalar(dt) : new THREE.Vector3();
  }

  update() {
    if (!this.renderer.xr.isPresenting) return;
    const now = performance.now() / 1000;
    for (const hand of this.hands) {
      const p = this.handPos(hand);
      let tr = this.trail.get(hand);
      if (!tr) this.trail.set(hand, (tr = []));
      tr.push({ t: now, p: p.clone() });
      while (tr.length > 2 && now - tr[0].t > 0.2) tr.shift();
      hand.ctrl.userData.nearGrab = !hand.held && !!this.nearest(hand);
      if (hand.held?.drag) hand.held.drag(hand, hand.held.pinch ? this.holdPos(hand, hand.held) : p);
    }
  }
}
