import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';

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
  /** Return an object to carry in the hand, 'drag' to keep receiving positions, or null to refuse. */
  grab(hand: Hand): THREE.Object3D | 'drag' | null;
  drag?(hand: Hand, pos: THREE.Vector3): void;
  release?(hand: Hand, pos: THREE.Vector3, carried: THREE.Object3D | null): void;
}

export class Hands {
  readonly hands: Hand[] = [];
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
      const stand = fallback();
      grip.add(stand);
      // Hide the stand-in once the real model has loaded.
      const check = setInterval(() => {
        if (model.children.length > 0) {
          stand.visible = false;
          clearInterval(check);
        }
      }, 1000);
      rig.add(grip);
      const handSpace = renderer.xr.getHand(i);
      handSpace.add(handModels.createHandModel(handSpace, 'mesh'));
      rig.add(handSpace);
      const ctrl = renderer.xr.getController(i);
      const hand: Hand = { index: i, grip, ctrl, held: null, carried: null, pos: new THREE.Vector3() };
      this.hands.push(hand);
      ctrl.addEventListener('connected', (e: any) => (ctrl.userData.isHand = !!e.data?.hand));
      ctrl.addEventListener('squeezestart', () => this.tryGrab(hand));
      ctrl.addEventListener('squeezeend', () => this.release(hand));
      // Hand tracking has no grip button: a pinch near something grabs it.
      ctrl.addEventListener('selectstart', () => {
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

  private handPos(hand: Hand) {
    // Grip space is the palm; tracked hands report it too.
    hand.grip.updateMatrixWorld(true);
    return hand.pos.setFromMatrixPosition(hand.grip.matrixWorld);
  }

  private nearest(hand: Hand): Grabbable | null {
    const p = this.handPos(hand);
    let best: Grabbable | null = null,
      bd = Infinity;
    for (const g of this.items) {
      if (g.enabled && !g.enabled()) continue;
      const d = g.at().distanceTo(p);
      if (d < g.radius && d < bd) {
        bd = d;
        best = g;
      }
    }
    return best;
  }

  private tryGrab(hand: Hand): boolean {
    if (hand.held) return false;
    const g = this.nearest(hand);
    if (!g) return false;
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
    const pos = this.handPos(hand).clone();
    const carried = hand.carried;
    if (carried) this.scene.attach(carried);
    hand.held = null;
    hand.carried = null;
    hand.ctrl.userData.grabbing = false;
    g.release?.(hand, pos, carried);
  }

  /** Gives an object straight to a free hand (a drink from a waiter). */
  give(obj: THREE.Object3D, g: Grabbable): boolean {
    const hand = this.hands.find((h) => !h.held && h.ctrl.userData.connected !== false);
    if (!hand) return false;
    hand.held = g;
    hand.carried = obj;
    hand.ctrl.userData.grabbing = true;
    hand.grip.add(obj);
    obj.position.set(0, 0.02, -0.04);
    obj.rotation.set(0, 0, 0);
    return true;
  }

  update() {
    if (!this.renderer.xr.isPresenting) return;
    for (const hand of this.hands) {
      const p = this.handPos(hand);
      hand.ctrl.userData.nearGrab = !hand.held && !!this.nearest(hand);
      if (hand.held?.drag) hand.held.drag(hand, p);
    }
  }
}
