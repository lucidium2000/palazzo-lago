import * as THREE from 'three';
import { HintQueue, localHintStore, type ShownHint } from './hintqueue';
import { GOLD, GOLD_LIGHT, roundRect, SERIF } from './panel';
import { canvas } from './textures';
import type { Hands, Hand } from './hands';
import type { Interaction } from './interaction';
import type { Item } from './loose';
import { MERCH } from './areas/promenadeplan';
import { replyPrompt } from './replyhud';

/**
 * First-time hints: the gestures nobody would guess, taught once, in the
 * moment they apply, and never again on this device (the queue, its once-only
 * memory and its cooldown are hintqueue.ts).
 *
 * In VR a hint is a small tag (an icon and a few words) next to the hand or
 * the thing it's about, facing you, for about four seconds; if that isn't in
 * view it sits low in front of you instead. On a screen it's a brief toast
 * low in the middle of the screen. No panels: nothing stays up.
 *
 * "Show hints" (the wrist menu's Menu tab, and Help on a screen) turns them
 * off; "Reset hints" lets every one of them show again.
 */

export type HintIcon = 'point' | 'palm' | 'stick' | 'crouch' | 'keys' | 'record' | 'joystick' | 'mouth' | 'wear' | 'fist' | 'wipe' | 'watch';

interface HintData {
  text: string;
  icon: HintIcon;
  /** VR: what it's about (world); null or out of view: low in front of you. */
  anchor: (() => THREE.Vector3 | null) | null;
  /** How far above the anchor the tag floats (m). */
  lift: number;
}

type Side = 'left' | 'right';

export interface HintDeps {
  scene: THREE.Scene;
  camera: THREE.Camera;
  hands: Hands;
  interaction: Interaction;
  xr(): boolean;
  /** In the game (past the start screen, or in VR). */
  playing(): boolean;
  player: { swimming: boolean; seated: { id: string } | null; stool: unknown; feet(): THREE.Vector3; readonly floorY: number };
  /** The game you're at (hud.station). */
  station(): string | null;
  /** The piano: where you sit (the bench), and whether you're at the keys. */
  piano: { position: THREE.Vector3; mine(): boolean } | null;
  decks: { atDecks: boolean; a: { spindle: THREE.Vector3 } } | null;
  /** The arcade (its handle's `debug`): which cabinet's controls you're at (VR). */
  arcade: HintArcade | null;
  loose: { items: Map<string, Item>; deskUse(): string | null };
  fighting(): boolean;
  watch: { lookedAt: boolean; group: THREE.Object3D };
  toast(text: string): void;
}

export interface HintArcade {
  at: { cab: number; set: number } | null;
  cabinets: { sets: { stickAt: THREE.Vector3 }[] }[];
}

/** Tables where your fingertip carries the chip and the palm tray works. */
const BET_TABLE = /^(roulette|craps|bj\d+s\d+)$/;

export class Hints {
  readonly queue = new HintQueue<HintData>(localHintStore);
  private tag: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  private tagCtx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private drawn = '';
  private placed = false;
  private toastEl: HTMLDivElement;
  private shownText = '';
  private checkIn = 0;
  private xrTime = 0;
  private head = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private want = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();

  constructor(private d: HintDeps) {
    const [c, g] = canvas(512, 112);
    this.tagCtx = g;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    // About 16 cm by 3.5 cm: at arm's length the words read like a watch face's.
    this.tag = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.035), this.mat);
    this.tag.renderOrder = 1001;
    this.tag.visible = false;
    this.tag.raycast = () => {};
    this.tag.userData.noLand = true;
    d.scene.add(this.tag);

    this.toastEl = document.createElement('div');
    this.toastEl.id = 'hint';
    this.toastEl.setAttribute('aria-live', 'polite');
    (document.getElementById('hud') ?? document.body).appendChild(this.toastEl);

    // Help (on a screen): Show hints on/off and Reset hints.
    const toggle = document.getElementById('hints-toggle');
    const reset = document.getElementById('hints-reset');
    const label = () => toggle && (toggle.textContent = this.enabled ? 'Hints on' : 'Hints off');
    label();
    toggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.enabled = !this.enabled;
      label();
    });
    reset?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.reset();
    });
  }

  get enabled() {
    return this.queue.enabled;
  }

  set enabled(on: boolean) {
    this.queue.enabled = on;
  }

  /** Every hint can show again (and they're switched on). */
  reset() {
    this.queue.reset();
    this.queue.enabled = true;
    const t = document.getElementById('hints-toggle');
    if (t) t.textContent = 'Hints on';
    this.d.toast('Hints reset: each one shows again the next time it applies');
  }

  /** Asks for a hint (this mode's: VR and screen hints are remembered apart). */
  private ask(key: string, text: string, icon: HintIcon, anchor: HintData['anchor'] = null, lift = 0.05) {
    this.queue.want(`${key}:${this.d.xr() ? 'vr' : 'desk'}`, { text, icon, anchor, lift });
  }

  update(dt: number) {
    const xr = this.d.xr();
    this.xrTime = xr ? this.xrTime + dt : 0;
    if (this.d.playing() && this.queue.enabled && (this.checkIn -= dt) <= 0) {
      this.checkIn = 0.25;
      if (xr) this.checkVR();
      else this.checkDesk();
    }
    // Not while someone's waiting on your answer (the reply strip sits low in view too).
    const shown = this.queue.update(dt, replyPrompt.up);
    this.showVR(xr ? shown : null, dt);
    this.showDesk(xr ? null : shown);
  }

  // --- When ----------------------------------------------------------------

  private controllers() {
    return !this.d.hands.tracked('right') && this.d.interaction.gamepads().some((g) => g.handedness === 'right' && g.gamepad.buttons.length > 3);
  }

  private handPos(h: Hand) {
    return () => (h.grip.visible ? h.grip.getWorldPosition(new THREE.Vector3()) : null);
  }

  private side(side: Side) {
    return this.d.hands.hands.find((x) => x.ctrl.userData.handedness === side) ?? null;
  }

  /** Something lying on the floor within reach (worth crouching for). */
  private somethingOnFloor(): boolean {
    const f = this.d.player.feet();
    const floor = this.d.player.floorY;
    for (const it of this.d.loose.items.values()) {
      if (it.gone || it.holder) continue;
      const p = it.body.pos;
      if (Math.abs(p.x - f.x) > 1.2 || Math.abs(p.z - f.z) > 1.2) continue;
      if (p.y - floor < 0.2 && Math.hypot(p.x - f.x, p.z - f.z) < 1.2) return true;
    }
    return false;
  }

  /** What's in your hands (VR): [item, the hand]. */
  private held(): [Item, Hand][] {
    const out: [Item, Hand][] = [];
    for (const it of this.d.loose.items.values()) if (it.holder === 'vr' && it.hand) out.push([it, it.hand]);
    return out;
  }

  private checkVR() {
    const d = this.d;
    const p = d.player;
    const ctl = this.controllers();
    const station = d.station() ?? '';
    // The watch: when you look at it (or after a while, wherever your wrist is).
    if (d.watch.lookedAt || this.xrTime > 25) this.ask('watch', ctl ? 'Tap your watch (or press Y) for the menu' : 'Tap your watch for the menu', 'watch', () => (d.watch.group.visible ? d.watch.group.getWorldPosition(new THREE.Vector3()) : null), 0.05);
    // At a table: bet with a fingertip, the wallet on your palm.
    if (BET_TABLE.test(station)) {
      this.ask('bet', 'Point to bet', 'point', () => d.hands.fingertip('right'), 0.05);
      this.ask('tray', 'Palm up for chips', 'palm', () => d.hands.wrist('left'), 0.08);
    }
    // In the pool, and on land.
    const right = this.side('right');
    const rightAt = right ? this.handPos(right) : null;
    if (p.swimming) this.ask('dive', ctl ? 'Hold the right stick in to dive' : 'Push your hands up to dive', ctl ? 'stick' : 'crouch', rightAt, 0.07);
    else if (ctl && !p.seated && !p.stool && this.somethingOnFloor()) this.ask('crouch', 'Hold the right stick in to crouch', 'crouch', rightAt, 0.07);
    // The piano, the DJ's decks, an arcade cabinet.
    if (d.piano && !d.piano.mine() && this.near(d.piano.position, 2.2)) this.ask('piano', 'Sit on the bench and play', 'keys', () => d.piano!.position.clone().setY(d.piano!.position.y + 0.9), 0);
    if (d.decks?.atDecks) this.ask('decks', 'Grab a record to scratch', 'record', () => d.decks!.a.spindle.clone(), 0.12);
    const at = d.arcade?.at;
    if (at) {
      const s = d.arcade!.cabinets[at.cab]?.sets[at.set];
      if (s) this.ask('arcade', 'Grab the stick', 'joystick', () => s.stickAt.clone(), 0.1);
    }
    // What's in your hands.
    for (const [it, h] of this.held()) {
      const wear = it.kind.merch ? MERCH[it.kind.merch].wear : null;
      if (it.kind.food && it.bites > 0) this.ask('eat', 'Hold it to your mouth', 'mouth', this.handPos(h), 0.08);
      else if (wear) this.ask('tryon', wear === 'eyes' ? 'Hold it to your face to try it on' : 'Hold it on your head to try it on', 'wear', this.handPos(h), 0.08);
      else if (it.kind.key === 'napkin') this.ask('napkin', 'Rub to wipe', 'wipe', this.handPos(h), 0.07);
    }
    if (d.fighting()) this.ask('fight', 'Fists up to block, swing to punch', 'fist', null);
  }

  private checkDesk() {
    const d = this.d;
    const p = d.player;
    if (p.swimming) this.ask('dive', 'Hold C to dive', 'stick');
    else if (!p.seated && !p.stool && this.somethingOnFloor()) this.ask('crouch', 'Hold C to crouch', 'crouch');
    if (d.piano) {
      if (p.seated?.id === 'piano') this.ask('pianokeys', 'Play with A S D F… (W E T… black keys) · Z / X octave · Space pedal', 'keys');
      else if (this.near(d.piano.position, 1.8)) this.ask('piano', 'Press E to sit and play', 'keys');
    }
    if (d.decks?.atDecks) this.ask('decks', 'Drag a record to scratch, or slide the crossfader to mix in deck B', 'record');
    const use = d.loose.deskUse();
    if (use === 'Bite') this.ask('eat', 'Press F to take a bite', 'mouth');
    else if (use === 'Wear') this.ask('tryon', 'Press F to try it on (U takes it off)', 'wear');
    if (d.fighting()) this.ask('fight', 'Click or F to punch · hold H or right-click to block', 'fist');
  }

  private near(at: THREE.Vector3, r: number) {
    const f = this.d.player.feet();
    return Math.hypot(at.x - f.x, at.z - f.z) < r;
  }

  // --- Showing it ----------------------------------------------------------

  private showDesk(h: ShownHint<HintData> | null) {
    const el = this.toastEl;
    if (!h) {
      if (this.shownText) {
        this.shownText = '';
        el.classList.remove('on');
      }
      return;
    }
    if (this.shownText !== h.id) {
      this.shownText = h.id;
      el.textContent = h.data.text;
    }
    el.classList.toggle('on', h.alpha > 0.5 && h.age < this.queue.timing.show - this.queue.timing.fade);
  }

  private showVR(h: ShownHint<HintData> | null, dt: number) {
    const tag = this.tag;
    if (!h) {
      tag.visible = false;
      this.placed = false;
      return;
    }
    if (this.drawn !== h.id) {
      this.drawn = h.id;
      this.draw(h.data);
    }
    const cam = this.d.camera;
    cam.updateMatrixWorld();
    cam.getWorldPosition(this.head);
    this.fwd.set(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(this.tmpQ));
    const a = h.data.anchor?.() ?? null;
    let dist = 0.6;
    let inView = false;
    if (a) {
      this.want.copy(a);
      this.want.y += h.data.lift;
      const to = this.tmp.subVectors(this.want, this.head);
      dist = to.length();
      inView = dist > 0.15 && dist < 6 && to.normalize().dot(this.fwd) > Math.cos(THREE.MathUtils.degToRad(40));
    }
    if (!inView) {
      // Low in front of you (where you'll see it), like a subtitle but smaller.
      const f = this.tmp.copy(this.fwd).setY(0);
      if (f.lengthSq() < 1e-4) f.set(0, 0, -1);
      f.normalize();
      this.want.copy(this.head).addScaledVector(f, 0.6);
      this.want.y -= 0.2;
      dist = 0.63;
    }
    if (!this.placed || tag.position.distanceTo(this.want) > 0.6) tag.position.copy(this.want);
    else tag.position.lerp(this.want, 1 - Math.exp(-dt * 14));
    this.placed = true;
    // The same size to the eye beyond arm's length (so a tag on the piano still reads).
    tag.scale.setScalar(Math.max(1, dist / 0.55));
    tag.lookAt(this.head);
    this.mat.opacity = h.alpha;
    tag.visible = h.alpha > 0.01;
  }

  private draw(h: HintData) {
    const g = this.tagCtx;
    const W = 512,
      H = 112;
    g.clearRect(0, 0, W, H);
    g.font = `600 44px ${SERIF}`;
    let size = 44;
    while (size > 26 && g.measureText(h.text).width > W - H - 28) {
      size -= 2;
      g.font = `600 ${size}px ${SERIF}`;
    }
    const tw = Math.min(W - H - 28, g.measureText(h.text).width);
    // A pill hugging the words, centred on the tag.
    const pw = H + tw + 24;
    const x0 = (W - pw) / 2;
    roundRect(g, x0 + 2, 4, pw - 4, H - 8, (H - 8) / 2);
    g.fillStyle = 'rgba(14,10,8,0.82)';
    g.fill();
    g.strokeStyle = 'rgba(216,178,90,0.75)';
    g.lineWidth = 3;
    g.stroke();
    const cx = x0 + H / 2,
      cy = H / 2;
    g.beginPath();
    g.arc(cx, cy, 38, 0, Math.PI * 2);
    g.fillStyle = '#2a2018';
    g.fill();
    g.strokeStyle = GOLD;
    g.lineWidth = 2.5;
    g.stroke();
    drawIcon(g, h.icon, cx, cy);
    g.fillStyle = '#fbf1d6';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(h.text, x0 + H + 4, cy + 2, W - H - 28);
    this.tex.needsUpdate = true;
  }
}

/** A tiny line icon (gold, about 50 px) for each hint, centred on (x, y). */
export function drawIcon(g: CanvasRenderingContext2D, icon: HintIcon, x: number, y: number) {
  g.save();
  g.translate(x, y);
  g.strokeStyle = GOLD_LIGHT;
  g.fillStyle = GOLD_LIGHT;
  g.lineWidth = 4;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const line = (...pts: number[]) => {
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.stroke();
  };
  const circle = (cx: number, cy: number, r: number, fill = false) => {
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    if (fill) g.fill();
    else g.stroke();
  };
  switch (icon) {
    case 'point':
      // A fist with the index finger out, and a chip on its tip.
      roundRect(g, -14, -2, 24, 20, 6);
      g.stroke();
      line(-8, -2, -8, -22);
      circle(-8, -27, 5, true);
      break;
    case 'palm':
      // An open hand, palm up, with a stack of chips over it.
      line(-20, 14, 20, 14);
      line(-20, 14, -22, 6);
      line(20, 14, 22, 6);
      for (let i = 0; i < 3; i++) line(-8, 4 - i * 7, 8, 4 - i * 7);
      break;
    case 'stick':
      // A thumbstick pressed in.
      circle(0, 6, 16);
      circle(0, 6, 7, true);
      line(0, -22, 0, -10);
      line(-5, -15, 0, -10, 5, -15);
      break;
    case 'crouch':
      // Down arrow onto a floor line.
      line(0, -20, 0, 10);
      line(-9, 2, 0, 11, 9, 2);
      line(-18, 18, 18, 18);
      break;
    case 'keys':
      g.strokeRect(-20, -14, 40, 28);
      for (const k of [-10, 0, 10]) line(k, -14, k, 14);
      for (const k of [-15, -5, 5, 15]) g.fillRect(k - 3, -14, 6, 15);
      break;
    case 'record':
      circle(0, 0, 20);
      circle(0, 0, 6, true);
      g.beginPath();
      g.arc(0, 0, 13, -0.6, 0.6);
      g.stroke();
      break;
    case 'joystick':
      line(-18, 16, 18, 16);
      line(0, 16, 6, -6);
      circle(7, -12, 7, true);
      break;
    case 'mouth':
      // A smile, and a little morsel coming to it.
      g.beginPath();
      g.arc(0, -2, 16, 0.2 * Math.PI, 0.8 * Math.PI);
      g.stroke();
      circle(14, -14, 5, true);
      break;
    case 'wear':
      // Sunglasses.
      circle(-11, 2, 9);
      circle(11, 2, 9);
      line(-2, 0, 2, 0);
      line(-20, -2, -24, -8);
      line(20, -2, 24, -8);
      break;
    case 'fist':
      roundRect(g, -14, -12, 28, 24, 7);
      g.stroke();
      line(-14, -3, 14, -3);
      line(-5, -12, -5, -3);
      line(4, -12, 4, -3);
      break;
    case 'wipe':
      // A napkin rubbing back and forth.
      g.strokeRect(-12, -16, 24, 18);
      line(-20, 12, -8, 18, 4, 12, 16, 18);
      break;
    case 'watch':
      circle(0, 0, 13);
      line(0, -13, 0, -22);
      line(0, 13, 0, 22);
      line(0, 0, 0, -7);
      line(0, 0, 6, 3);
      break;
  }
  g.restore();
}
