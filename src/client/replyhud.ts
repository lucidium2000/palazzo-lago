import * as THREE from 'three';
import { canvas } from './textures';
import { GOLD, GOLD_LIGHT, roundRect, SERIF } from './panel';

/**
 * VR replies as a head-locked subtitle strip: a small 2D overlay low in your
 * view (about 27 degrees below centre), never an object in the room. You answer
 * without touching anything in 3D: say it (mic), press a controller button
 * (A, B, X/Y) or, with hand tracking, hold a pinch for a moment (thumb to
 * index, middle or ring finger).
 */

/**
 * Is a reply prompt holding the face buttons and hand pinches right now? Things
 * that also use A/B/X/Y (jump, the wrist menu, the piano pedal) and hand pinches
 * (grabbing, the laser) stand down while it is, and for a moment after it
 * closes, so the press that answered doesn't also jump.
 */
export const replyPrompt = {
  up: false,
  closedAt: -1e9,
  set(on: boolean) {
    if (this.up && !on) this.closedAt = performance.now() / 1000;
    this.up = on;
  },
  busy() {
    return this.up || performance.now() / 1000 - this.closedAt < 0.3;
  },
};

export type ReplyInput = 'buttons' | 'pinch';
export type MicState = 'off' | 'on' | 'listening';

interface PadLike {
  handedness: string;
  gamepad: { buttons: readonly { pressed: boolean }[] };
}

/**
 * Which reply buttons are down: reply 1 is A (right, xr-standard button 4),
 * reply 2 is B (right, 5), reply 3 is X or Y (left, 4 or 5).
 */
export function replyButtons(pads: readonly PadLike[]): [boolean, boolean, boolean] {
  const out: [boolean, boolean, boolean] = [false, false, false];
  for (const { handedness, gamepad } of pads) {
    const b = (i: number) => !!gamepad.buttons[i]?.pressed;
    if (handedness === 'right') {
      out[0] ||= b(4);
      out[1] ||= b(5);
    } else if (handedness === 'left') out[2] ||= b(4) || b(5);
  }
  return out;
}

/** Thumb and fingertip closer than this (m) start a pinch; they must part past PINCH_OFF to end it. */
export const PINCH_ON = 0.02;
export const PINCH_OFF = 0.032;
/** How long a pinch is held to answer (s). */
export const PINCH_HOLD = 0.25;

/**
 * Which finger touches the thumb: 1 index, 2 middle, 3 ring (0: none). `tips`
 * are the five fingertips, thumb first; `current` is last frame's answer, kept
 * until the fingers part (hysteresis). A new pinch must be clearly that finger
 * (the neighbours curl along with a ring pinch).
 */
export function pinchFinger(tips: readonly THREE.Vector3[], has: readonly boolean[], current = 0): number {
  if (!has[0]) return 0;
  const d = (i: number) => (has[i] ? tips[0].distanceTo(tips[i]) : Infinity);
  if (current >= 1 && current <= 3 && d(current) < PINCH_OFF) return current;
  let best = 0,
    bd = PINCH_ON;
  for (let i = 1; i <= 3; i++) {
    if (d(i) < bd) {
      bd = d(i);
      best = i;
    }
  }
  if (!best) return 0;
  for (let i = 1; i <= 3; i++) if (i !== best && d(i) < bd + 0.008) return 0;
  return best;
}

/** One hand's pinch-and-hold: a pinch held PINCH_HOLD seconds answers once, until you let go. */
export class PinchHold {
  finger = 0;
  t = 0;
  private done = false;

  /** Feed this frame's pinched finger (0 none); returns the reply index (0-based) when a hold completes. */
  step(finger: number, dt: number): number | null {
    if (finger !== this.finger) {
      this.finger = finger;
      this.t = 0;
      this.done = false;
    }
    if (!finger || this.done) return null;
    this.t += dt;
    if (this.t < PINCH_HOLD) return null;
    this.done = true;
    return finger - 1;
  }

  /** A pinch already held when the prompt appears doesn't count: let go and pinch again. */
  block() {
    this.done = true;
  }

  /** Hold progress 0..1 for a reply index (0 when not pinching that finger). */
  progress(reply: number) {
    return this.finger === reply + 1 && !this.done ? Math.min(1, this.t / PINCH_HOLD) : 0;
  }
}

/**
 * The strip's own render layer: your view (and the headset's eye cameras, which copy its layers) draws
 * it; photo cameras, mirrors and raycasters (layer 0) never see it.
 */
export const OVERLAY_LAYER = 3;

const W = 1024;
const ROW_H = 92;
const GAP = 10;
const H = 3 * ROW_H + 2 * GAP + 8;
/** Strip width in metres, distance from the eyes, and how far below centre. */
const WIDTH_M = 0.6;
const DIST = 1.1;
const BELOW = THREE.MathUtils.degToRad(27);

export interface ReplyHudState {
  input: ReplyInput;
  mic: MicState;
  /** Pinch-hold progress (0..1) per reply. */
  progress: readonly number[];
}

export class ReplyHud {
  readonly mesh: THREE.Mesh;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private mat: THREE.MeshBasicMaterial;
  private labels: string[] = [];
  private shown = false;
  private picked = -1;
  private opacity = 0;
  private sig = '';
  private q = new THREE.Quaternion();
  private placed = false;
  private tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -BELOW);
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private head = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private time = 0;

  constructor(scene: THREE.Scene) {
    const [c, ctx] = canvas(W, H);
    this.ctx = ctx;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH_M, (WIDTH_M * H) / W), this.mat);
    this.mesh.name = 'reply-hud';
    // An overlay, not a thing in the room: drawn last and on top, never hit, never shadowed.
    this.mesh.renderOrder = 10000;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.matrixAutoUpdate = true;
    this.mesh.raycast = () => {};
    this.mesh.layers.set(OVERLAY_LAYER);
    this.mesh.userData.overlay = true;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Is the strip showing (or still fading out)? */
  get visible() {
    return this.mesh.visible;
  }

  /** Is it up for answering? */
  get isShown() {
    return this.shown;
  }

  show(labels: string[]) {
    this.labels = labels.slice(0, 3);
    this.shown = true;
    this.picked = -1;
    this.sig = '';
  }

  /** Fades out; `picked` (0-based) stays lit while it goes. */
  hide(picked = -1) {
    if (!this.shown) return;
    this.shown = false;
    this.picked = picked;
    this.sig = '';
  }

  update(dt: number, camera: THREE.Camera, state: ReplyHudState) {
    this.time += dt;
    const target = this.shown ? 1 : 0;
    this.opacity += Math.sign(target - this.opacity) * Math.min(Math.abs(target - this.opacity), dt / (this.shown ? 0.2 : 0.35));
    if (this.opacity <= 0.001 && !this.shown) {
      this.mesh.visible = false;
      this.placed = false;
      return;
    }
    this.mat.opacity = this.opacity;
    this.mesh.visible = true;
    this.place(dt, camera);
    this.draw(state);
  }

  /** Head-locked: sits a fixed distance from your eyes; its direction follows your gaze lazily. */
  private place(dt: number, camera: THREE.Camera) {
    camera.layers.enable(OVERLAY_LAYER);
    camera.updateMatrixWorld();
    camera.getWorldPosition(this.head);
    this.fwd.set(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(this.tmpQ));
    // Level (no roll): built from the gaze and world up.
    if (Math.abs(this.fwd.y) > 0.98) this.fwd.y = Math.sign(this.fwd.y) * 0.98;
    this.tmpM.lookAt(ORIGIN, this.fwd, UP);
    this.tmpQ.setFromRotationMatrix(this.tmpM);
    if (!this.placed) {
      this.q.copy(this.tmpQ);
      this.placed = true;
    } else {
      // Gentle lazy-follow, a little quicker when you've turned well away.
      const off = this.q.angleTo(this.tmpQ);
      const rate = off > 0.6 ? 9 : 4.5;
      this.q.slerp(this.tmpQ, 1 - Math.exp(-dt * rate));
    }
    this.mesh.quaternion.copy(this.q).multiply(this.tilt);
    this.mesh.position.set(0, -Math.sin(BELOW) * DIST, -Math.cos(BELOW) * DIST).applyQuaternion(this.q).add(this.head);
  }

  private draw(s: ReplyHudState) {
    const pulse = s.mic === 'listening' ? Math.round(((Math.sin(this.time * 5) + 1) / 2) * 4) : 0;
    const sig = [this.labels.join('|'), this.picked, this.shown, s.input, s.mic, pulse, s.progress.map((p) => Math.round(p * 24)).join(',')].join('/');
    if (sig === this.sig) return;
    this.sig = sig;
    const g = this.ctx;
    g.clearRect(0, 0, W, H);
    this.labels.forEach((label, i) => {
      const y = 4 + i * (ROW_H + GAP);
      const lit = i === this.picked;
      roundRect(g, 6, y, W - 12, ROW_H, ROW_H / 2);
      g.fillStyle = lit ? 'rgba(92,66,24,0.92)' : 'rgba(14,10,8,0.8)';
      g.fill();
      g.strokeStyle = lit ? GOLD_LIGHT : 'rgba(216,178,90,0.7)';
      g.lineWidth = lit ? 4 : 2.5;
      g.stroke();
      const cx = 6 + ROW_H / 2,
        cy = y + ROW_H / 2;
      if (s.input === 'pinch') pinchGlyph(g, cx, cy, 34, i + 1);
      else buttonGlyph(g, cx, cy, 34, (['A', 'B', 'X/Y'] as const)[i]);
      const p = s.progress[i] ?? 0;
      if (p > 0) {
        g.beginPath();
        g.arc(cx, cy, 40, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
        g.strokeStyle = GOLD_LIGHT;
        g.lineWidth = 6;
        g.lineCap = 'round';
        g.stroke();
        g.lineCap = 'butt';
      }
      const micW = s.mic === 'off' ? 0 : 56;
      g.fillStyle = '#fbf1d6';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = `600 40px ${SERIF}`;
      g.fillText(fit(g, label, W - 12 - ROW_H - 24 - micW - 16), 6 + ROW_H + 14, cy + 2);
      if (s.mic !== 'off') micGlyph(g, W - 12 - 34, cy, s.mic === 'listening' ? 0.75 + pulse * 0.0625 : 0.4);
    });
    this.tex.needsUpdate = true;
  }
}

const ORIGIN = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Trims a label with an ellipsis to fit `max` px. */
function fit(g: CanvasRenderingContext2D, s: string, max: number) {
  if (g.measureText(s).width <= max) return s;
  let t = s;
  while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

/** A controller face button: a dark disc with its letter. */
function buttonGlyph(g: CanvasRenderingContext2D, x: number, y: number, r: number, letter: string) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = '#2a2018';
  g.fill();
  g.strokeStyle = GOLD;
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = GOLD_LIGHT;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${letter.length > 1 ? 24 : 36}px system-ui, sans-serif`;
  g.fillText(letter, x, y + 2);
}

/**
 * A little hand in a disc: thumb, index, middle, ring and pinky; the finger to
 * pinch (1 index, 2 middle, 3 ring) curls in gold to touch the thumb tip.
 */
function pinchGlyph(g: CanvasRenderingContext2D, x: number, y: number, r: number, finger: number) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = '#2a2018';
  g.fill();
  g.strokeStyle = GOLD;
  g.lineWidth = 3;
  g.stroke();
  g.lineCap = 'round';
  const dim = 'rgba(243,220,154,0.5)';
  // Palm.
  g.fillStyle = dim;
  roundRect(g, x - 13, y + 2, 26, 18, 6);
  g.fill();
  // Thumb, up and out to the left; its tip is where the gold finger meets it.
  const tx = x - 16,
    ty = y - 4;
  g.strokeStyle = GOLD_LIGHT;
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(x - 10, y + 12);
  g.lineTo(tx, ty);
  g.stroke();
  // Fingers: index, middle, ring, pinky.
  const xs = [x - 8, x - 1, x + 6, x + 12];
  const len = [18, 21, 19, 14];
  for (let i = 0; i < 4; i++) {
    const active = i + 1 === finger;
    g.strokeStyle = active ? GOLD_LIGHT : dim;
    g.lineWidth = active ? 7 : 5;
    g.beginPath();
    g.moveTo(xs[i], y + 4);
    if (active) g.quadraticCurveTo(xs[i], y - 20, tx + 3, ty - 2);
    else g.lineTo(xs[i], y + 4 - len[i]);
    g.stroke();
  }
  // The touch.
  g.fillStyle = '#fff6d8';
  g.beginPath();
  g.arc(tx + 1, ty - 1, 5, 0, Math.PI * 2);
  g.fill();
  g.lineCap = 'butt';
}

/** A microphone ("say it"): brighter while it's listening. */
function micGlyph(g: CanvasRenderingContext2D, x: number, y: number, alpha: number) {
  g.save();
  g.globalAlpha = alpha;
  g.strokeStyle = GOLD_LIGHT;
  g.fillStyle = GOLD_LIGHT;
  g.lineWidth = 4;
  g.lineCap = 'round';
  roundRect(g, x - 8, y - 22, 16, 28, 8);
  g.fill();
  g.beginPath();
  g.arc(x, y - 4, 15, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();
  g.beginPath();
  g.moveTo(x, y + 11);
  g.lineTo(x, y + 20);
  g.moveTo(x - 8, y + 20);
  g.lineTo(x + 8, y + 20);
  g.stroke();
  g.restore();
}
