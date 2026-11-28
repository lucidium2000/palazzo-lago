import * as THREE from 'three';
import type { Grabbable, Hand, Hands } from '../hands';
import type { RawPad } from './types';

/**
 * Physical arcade controls for VR hands: a ball-top joystick you grab and
 * tilt, and big buttons you press with a fingertip or the heel of your hand.
 * All the sticks and buttons in the room are three instanced meshes (one draw
 * each), updated only when something moves.
 */

/** Stick throw: how far your hand moves the ball for full tilt (m), and the stick's lean at full tilt (rad). */
const THROW = 0.045;
const LEAN = 0.38;
const SHAFT = 0.075;
const BALL_R = 0.021;
export const BUTTON_R = 0.024;
export const CAP_H = 0.016;
export const TRAVEL = 0.009;

/** The shared instanced meshes. */
export class ControlInstances {
  readonly balls: THREE.InstancedMesh;
  readonly shafts: THREE.InstancedMesh;
  readonly caps: THREE.InstancedMesh;
  private nSticks = 0;
  private nButtons = 0;

  constructor(maxSticks: number, maxButtons: number) {
    const ballMat = new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.05 });
    this.balls = new THREE.InstancedMesh(new THREE.SphereGeometry(BALL_R, 16, 12), ballMat, maxSticks);
    this.shafts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0055, 0.0055, SHAFT, 8).translate(0, SHAFT / 2, 0), new THREE.MeshStandardMaterial({ color: 0xc8c8d0, metalness: 0.8, roughness: 0.3 }), maxSticks);
    // Button caps: a slightly domed cylinder, lit from inside (emissive tint from the instance colour).
    const cap = new THREE.CylinderGeometry(BUTTON_R, BUTTON_R * 1.02, CAP_H, 20).translate(0, CAP_H / 2, 0);
    this.caps = new THREE.InstancedMesh(cap, new THREE.MeshStandardMaterial({ roughness: 0.3, emissive: 0xffffff, emissiveIntensity: 0.18 }), maxButtons);
    for (const m of [this.balls, this.shafts, this.caps]) {
      m.count = 0;
      m.frustumCulled = false;
      m.userData.dynamic = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
  }

  addStick(color: THREE.Color): number {
    const i = this.nSticks++;
    this.balls.count = this.shafts.count = this.nSticks;
    this.balls.setColorAt(i, color);
    if (this.balls.instanceColor) this.balls.instanceColor.needsUpdate = true;
    return i;
  }

  addButton(color: THREE.Color): number {
    const i = this.nButtons++;
    this.caps.count = this.nButtons;
    this.caps.setColorAt(i, color);
    if (this.caps.instanceColor) this.caps.instanceColor.needsUpdate = true;
    return i;
  }

  setStick(i: number, shaft: THREE.Matrix4, ball: THREE.Matrix4) {
    this.shafts.setMatrixAt(i, shaft);
    this.balls.setMatrixAt(i, ball);
    this.shafts.instanceMatrix.needsUpdate = true;
    this.balls.instanceMatrix.needsUpdate = true;
  }

  setButton(i: number, m: THREE.Matrix4) {
    this.caps.setMatrixAt(i, m);
    this.caps.instanceMatrix.needsUpdate = true;
  }

  setButtonColor(i: number, color: THREE.Color) {
    this.caps.setColorAt(i, color);
    if (this.caps.instanceColor) this.caps.instanceColor.needsUpdate = true;
  }

  addTo(parent: THREE.Object3D) {
    parent.add(this.balls, this.shafts, this.caps);
  }
}

const tmpM = new THREE.Matrix4();
const tmpM2 = new THREE.Matrix4();
const tmpM3 = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpE = new THREE.Euler();
const ONE = new THREE.Vector3(1, 1, 1);

/**
 * One player's controls on a panel: a stick and three buttons. `panel` is
 * the panel surface's world matrix (x across, y out of the surface, z toward
 * the player). Positions are in that frame.
 */
export class ControlSet {
  /** Stick deflection -1..1 (x right, y away from you = up). */
  readonly stick = new THREE.Vector2();
  readonly buttons = [false, false, false];
  /** Button press depth 0..1 (visual). */
  private depth = [0, 0, 0];
  private stickIx: number;
  private buttonIx: number[];
  readonly panelInv = new THREE.Matrix4();
  private heldBy: Hand | null = null;
  /** Something changed visually this frame. */
  private dirtyStick = true;
  private dirtyButtons = true;
  /** Fired with the button index when one goes down (for haptics). */
  onPress: ((b: number, hand: 'left' | 'right' | null) => void) | null = null;
  readonly grab: Grabbable;
  private ballWorld = new THREE.Vector3();

  constructor(
    private inst: ControlInstances,
    readonly panel: THREE.Matrix4,
    readonly stickAt: THREE.Vector3,
    readonly buttonAt: THREE.Vector3[],
    stickColor: THREE.Color,
    buttonColors: THREE.Color[],
    readonly enabledButtons: boolean[],
  ) {
    this.panelInv.copy(panel).invert();
    this.stickIx = inst.addStick(stickColor);
    this.buttonIx = buttonAt.map((_, i) => inst.addButton(buttonColors[i]));
    this.redraw();
    const set = this;
    this.grab = {
      radius: 0.075,
      at: () => set.ballAt(set.ballWorld),
      enabled: () => !set.heldBy,
      grab(hand: Hand) {
        set.heldBy = hand;
        return 'drag';
      },
      drag(_hand: Hand, pos: THREE.Vector3) {
        set.dragTo(pos);
      },
      release() {
        set.heldBy = null;
        set.stick.set(0, 0);
        set.dirtyStick = true;
      },
    };
  }

  get held() {
    return !!this.heldBy;
  }

  get holdingHand(): Hand | null {
    return this.heldBy;
  }

  /** The ball's world position (where you reach for it). */
  ballAt(out: THREE.Vector3) {
    // Tilted: the ball moves with the stick.
    const lx = Math.sin(this.stick.x * LEAN) * SHAFT,
      lz = -Math.sin(this.stick.y * LEAN) * SHAFT;
    out.set(this.stickAt.x + lx, this.stickAt.y + SHAFT, this.stickAt.z + lz).applyMatrix4(this.panel);
    return out;
  }

  /** Your hand at a world point while holding the ball: the stick follows it. */
  dragTo(world: THREE.Vector3) {
    tmpV.copy(world).applyMatrix4(this.panelInv).sub(this.stickAt);
    let x = tmpV.x / THROW,
      y = -tmpV.z / THROW;
    const l = Math.hypot(x, y);
    // A small dead zone so a resting hand doesn't drift; full tilt at the edge of the throw.
    const dz = 0.12;
    const m = l < dz ? 0 : Math.min(1, (l - dz) / (1 - dz));
    x = l > 1e-6 ? (x / l) * m : 0;
    y = l > 1e-6 ? (y / l) * m : 0;
    if (Math.abs(x - this.stick.x) > 0.01 || Math.abs(y - this.stick.y) > 0.01) {
      this.stick.set(x, y);
      this.dirtyStick = true;
    }
  }

  /**
   * Fingertips and palms pressing buttons (VR). `points` are world positions
   * with the side they belong to; a button is down while any point is inside
   * its cap's column.
   */
  pressFrom(points: readonly THREE.Vector3[], sides: readonly ('left' | 'right')[], count: number) {
    for (let b = 0; b < 3; b++) {
      if (!this.enabledButtons[b]) continue;
      const at = this.buttonAt[b];
      let best = 0;
      let who: 'left' | 'right' | null = null;
      for (let i = 0; i < count; i++) {
        tmpV.copy(points[i]).applyMatrix4(this.panelInv);
        const dx = tmpV.x - at.x,
          dz = tmpV.z - at.z;
        if (dx * dx + dz * dz > (BUTTON_R + 0.012) ** 2) continue;
        const h = tmpV.y - at.y;
        if (h > CAP_H + 0.008 || h < -0.04) continue;
        // How far into the cap's travel.
        const d = Math.min(1, Math.max(0, (CAP_H + 0.008 - h) / TRAVEL));
        if (d > best) {
          best = d;
          who = sides[i];
        }
      }
      const down = best > 0.55 || (this.buttons[b] && best > 0.25);
      if (down && !this.buttons[b]) this.onPress?.(b, who);
      this.buttons[b] = down;
      if (Math.abs(best - this.depth[b]) > 0.02) {
        this.depth[b] = best;
        this.dirtyButtons = true;
      }
    }
  }

  /** Keys or touch drive the same controls (the cabinet shows them moving). */
  setFrom(pad: RawPad) {
    if (Math.abs(pad.x - this.stick.x) > 0.01 || Math.abs(pad.y - this.stick.y) > 0.01) {
      this.stick.set(pad.x, pad.y);
      this.dirtyStick = true;
    }
    for (let b = 0; b < 3; b++) {
      const on = b === 0 ? pad.a : b === 1 ? pad.b : pad.c;
      this.buttons[b] = on;
      const d = on ? 1 : 0;
      if (d !== this.depth[b]) {
        this.depth[b] = d;
        this.dirtyButtons = true;
      }
    }
  }

  /** Writes this set's state into a raw pad. */
  readInto(pad: RawPad) {
    pad.x = this.stick.x;
    pad.y = this.stick.y;
    pad.a = this.buttons[0];
    pad.b = this.buttons[1];
    pad.c = this.buttons[2];
  }

  release() {
    if (this.heldBy) {
      this.heldBy = null;
    }
    this.stick.set(0, 0);
    this.buttons[0] = this.buttons[1] = this.buttons[2] = false;
    this.depth[0] = this.depth[1] = this.depth[2] = 0;
    this.dirtyStick = this.dirtyButtons = true;
  }

  redraw() {
    if (this.dirtyStick) {
      this.dirtyStick = false;
      // Shaft leans from its pivot; the ball sits on top.
      tmpE.set(-this.stick.y * LEAN, 0, -this.stick.x * LEAN);
      tmpQ.setFromEuler(tmpE);
      tmpM.compose(this.stickAt, tmpQ, ONE);
      tmpM2.multiplyMatrices(this.panel, tmpM);
      tmpM3.makeTranslation(0, SHAFT, 0).premultiply(tmpM2);
      this.inst.setStick(this.stickIx, tmpM2, tmpM3);
    }
    if (this.dirtyButtons) {
      this.dirtyButtons = false;
      for (let b = 0; b < 3; b++) {
        tmpM.makeTranslation(this.buttonAt[b].x, this.buttonAt[b].y - this.depth[b] * TRAVEL, this.buttonAt[b].z);
        if (!this.enabledButtons[b]) tmpM.scale(tmpV.set(0.0001, 0.0001, 0.0001));
        tmpM2.multiplyMatrices(this.panel, tmpM);
        this.inst.setButton(this.buttonIx[b], tmpM2);
      }
    }
  }
}

/** Every fingertip and palm of both VR hands this frame (world), without allocating. */
export class TouchPoints {
  readonly points: THREE.Vector3[] = Array.from({ length: 12 }, () => new THREE.Vector3());
  readonly sides: ('left' | 'right')[] = Array.from({ length: 12 }, () => 'left' as const);
  count = 0;
  private tips = Array.from({ length: 5 }, () => new THREE.Vector3());
  private has = [false, false, false, false, false];

  gather(hands: Hands) {
    this.count = 0;
    for (const side of ['left', 'right'] as const) {
      const src = hands.fingertips(side, this.tips, this.has);
      if (src) {
        for (let i = 0; i < 5; i++) {
          if (!this.has[i]) continue;
          this.points[this.count].copy(this.tips[i]);
          this.sides[this.count++] = side;
        }
      }
      // The palm (the grip point): slapping a button with your hand works too.
      let h: Hand | null = null;
      for (const x of hands.hands) if (x.ctrl.userData.handedness === side) h = x;
      if (h && h.ctrl.userData.connected !== false && h.grip.visible && !h.held) {
        h.grip.updateMatrixWorld(true);
        this.points[this.count].setFromMatrixPosition(h.grip.matrixWorld);
        this.sides[this.count++] = side;
      }
    }
  }
}

/** Options for a PushButton: its size (times a stick cabinet's button) and whether its cap lights up while it's down. */
export interface PushButtonOpts {
  scale?: number;
  glow?: boolean;
}

/**
 * A single big push button (the floor games' START, The Last Mile's arrows):
 * pressed by a fingertip or palm in VR, or by the desk pad's A. Shares the
 * instanced button caps.
 */
export class PushButton {
  down = false;
  /** The hand that pressed it last (VR), for haptics. */
  by: 'left' | 'right' | null = null;
  private depth = -1;
  private ix: number;
  private inv = new THREE.Matrix4();
  private scale: number;
  private base: THREE.Color;
  private lit: THREE.Color | null;
  private shownLit = false;

  /** `frame`: the button's world matrix (y out of the surface it sits on). */
  constructor(
    private inst: ControlInstances,
    private frame: THREE.Matrix4,
    color: THREE.Color,
    o: PushButtonOpts = {},
  ) {
    this.scale = o.scale ?? 1.5;
    this.base = color.clone();
    // Lit: the cap colour pushed past 1 (instance colours are float), so it brightens without washing out to white.
    this.lit = o.glow ? color.clone().multiplyScalar(2.2) : null;
    this.ix = inst.addButton(color);
    this.inv.copy(frame).invert();
    this.show(0);
  }

  /** Where it is (world). */
  at(out: THREE.Vector3) {
    return out.setFromMatrixPosition(this.frame);
  }

  /** How far it's pushed in (0..1, as drawn). */
  get pressDepth() {
    return Math.max(0, this.depth);
  }

  /** The cap's radius (m). */
  get radius() {
    return BUTTON_R * this.scale;
  }

  private show(d: number) {
    if (Math.abs(d - this.depth) < 0.02) return;
    this.depth = d;
    tmpM.makeTranslation(0, -d * TRAVEL, 0).scale(tmpV.set(this.scale, 1, this.scale));
    tmpM2.multiplyMatrices(this.frame, tmpM);
    this.inst.setButton(this.ix, tmpM2);
  }

  /** Feed this frame's hands (VR) or the pad's button: true the moment it goes down. */
  update(touch: TouchPoints | null, padDown: boolean): boolean {
    let best = padDown ? 1 : 0;
    let who: 'left' | 'right' | null = null;
    if (touch) {
      const R = BUTTON_R * this.scale + 0.012;
      for (let i = 0; i < touch.count; i++) {
        tmpV.copy(touch.points[i]).applyMatrix4(this.inv);
        if (tmpV.x * tmpV.x + tmpV.z * tmpV.z > R * R) continue;
        if (tmpV.y > CAP_H + 0.008 || tmpV.y < -0.04) continue;
        const d = Math.min(1, (CAP_H + 0.008 - tmpV.y) / TRAVEL);
        if (d > best) {
          best = d;
          who = touch.sides[i];
        }
      }
    }
    this.show(best);
    const now = best > 0.55 || (this.down && best > 0.25);
    const edge = now && !this.down;
    if (edge) this.by = who;
    this.down = now;
    if (this.lit && now !== this.shownLit) {
      this.shownLit = now;
      this.inst.setButtonColor(this.ix, now ? this.lit : this.base);
    }
    return edge;
  }
}
