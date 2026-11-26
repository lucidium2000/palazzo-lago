import * as THREE from 'three';
import type { Hands } from './hands';
import type { Interaction } from './interaction';
import type { Person } from './people';
import type { Player, Viewpoint } from './player';
import type { Hud } from './hud';
import type { Bodies } from './bodies';
import type { Sound } from './audio';
import type { FingerPose } from './fingers';
import { PianoSynth } from './pianosynth';
import {
  BLACK_H, BLACK_L, BLACK_W, DIP, HIGH, KEY_LAYOUT, KEYS, LOW, OCTAVE, WHITE_L, WHITE_W,
  keyAt, newFinger, noteName, stepFinger, TYPING, typingNote, type Finger, type FingerEvent,
} from './pianokeys';
import { replyPrompt } from './replyhud';

/**
 * The grand piano in the lounge, playable. 88 real keys (two instanced
 * meshes) that go down when played; in VR every fingertip that pushes down
 * into a key plays it (all ten with hand tracking; on controllers the index
 * finger and thumb, and the other three when the hand is open), as hard as it
 * came down, held while it's held; on a screen, sit at the bench and the
 * computer keyboard plays it (A S D F… white, W E T Y U… black, Z / X octave,
 * Space the sustain pedal), or click and tap the keys. The sound is
 * pianosynth.ts, from the soundboard.
 *
 * The pianist: shove or punch him (bodies.ts) or push him off on a screen,
 * and he's knocked off the bench; his music stops while he's off it or while
 * anyone's playing, and he comes back to sit when the bench is free.
 */

export interface PianoDeps {
  /** The piano (its group), the keyboard frame on it, the soundboard. */
  group: THREE.Group;
  keyFrame: THREE.Object3D;
  soundboard: THREE.Object3D;
  pianist: Person | null;
  /** The pianist's recorded loop. */
  loop: THREE.PositionalAudio | null;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  dom: HTMLElement;
  player: Player;
  hands: Hands;
  interaction: Interaction;
  bodies: Bodies;
  sound: Sound;
  hud: Hud;
  /** Lighter on a headset: fewer voices, a shorter room. */
  light: boolean;
  haptic(side: 'left' | 'right', strength: number, ms: number): void;
  /** Finger curls per hand (controllers' touch sensors or hand tracking). */
  fingerPoses(): { l: FingerPose; r: FingerPose };
  /** VR controllers' gamepads (the sustain pedal is A / X). */
  gamepads(): { handedness: string; gamepad: Gamepad }[];
  /** A person you got physical with says so. */
  react(p: Person, kind: 'pushed' | 'punched'): void;
}

/** A finger (or key, or pointer) in this machine's game that holds a note down. */
const SIDES = ['left', 'right'] as const;
/** The VR seat: how far below your eyes the keys should be (a seated pianist's forearms). */
const KEYS_BELOW_EYES = 0.47;

export class Piano {
  readonly synth: PianoSynth;
  readonly viewpoint: Viewpoint;
  private white: THREE.InstancedMesh;
  private black: THREE.InstancedMesh;
  /** Per key (midi - LOW): how many things hold it down, and how far down it is (0..1). */
  private holders = new Int16Array(KEYS);
  private dip = new Float32Array(KEYS);
  private inv = new THREE.Matrix4();
  private m = new THREE.Matrix4();
  private m2 = new THREE.Matrix4();
  private v = new THREE.Vector3();
  /** Ten fingertips (left thumb … right pinky) and their state. */
  private tips = [Array.from({ length: 5 }, () => new THREE.Vector3()), Array.from({ length: 5 }, () => new THREE.Vector3())];
  private has = [[false, false, false, false, false], [false, false, false, false, false]];
  private fingers: Finger[] = Array.from({ length: 10 }, () => newFinger());
  private ev: FingerEvent = { on: -1, vel: 0, off: -1 };
  private octave = OCTAVE.start;
  private typed = new Map<string, number>();
  private pointers = new Map<number, number>();
  private sustainKeys = false;
  private sustainVR = false;
  private sustainRemote = new Map<string, boolean>();
  private time = 0;
  /** When a note was last played here by anyone (you or a friend), seconds. */
  private lastNote = -99;
  /** The pianist's music, faded (0..1). */
  private loopLevel = 1;
  /** Friends sitting at the bench (their ids). */
  private friendsAt = new Set<string>();
  /** You were on the bench last frame (walking onto it on a screen sits you down). */
  private wasOnBench = false;
  private hinted = false;
  private dropWant = 0;
  private headRef = -1;
  private headOff = 0;
  /** Nobody played while the pianist was off his bench (he grumbles coming back), and it was you who knocked him off. */
  private tookOver = false;
  private iKnocked = false;
  private ray = new THREE.Raycaster();
  private proxy: THREE.Mesh;
  private benchAt = new THREE.Vector3();
  private keysAt = new THREE.Vector3();
  /** Notes you play (vel 0 = let go), and your sustain pedal: for your friends. */
  onNote: ((midi: number, vel: number) => void) | null = null;
  onPedal: ((on: boolean) => void) | null = null;
  /** You knocked the pianist off his bench. */
  onKnock: ((ux: number, uz: number, power: number) => void) | null = null;
  /** Counters for tests. */
  readonly stats = { local: 0, remote: 0, knocked: 0 };

  constructor(private d: PianoDeps) {
    this.synth = new PianoSynth(d.sound.listener, d.soundboard, { voices: d.light ? 20 : 24, reverb: d.light ? 0.9 : 1.3 });
    this.synth.muted = () => d.sound.muted;
    // The keys: ivory and ebony, a hair narrower than their spacing (the gaps show).
    const wg = new THREE.BoxGeometry(WHITE_W - 0.0011, 0.022, WHITE_L - 0.001).translate(0, -0.011, -WHITE_L / 2);
    const bg = new THREE.BoxGeometry(BLACK_W, 0.022, BLACK_L).translate(0, BLACK_H - 0.011, -WHITE_L + BLACK_L / 2);
    // Black keys taper toward the top and the front.
    const p = bg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > BLACK_H - 0.011) {
        p.setX(i, p.getX(i) * 0.78);
        if (p.getZ(i) > -WHITE_L + BLACK_L / 2) p.setZ(i, p.getZ(i) - 0.006);
      }
    }
    bg.computeVertexNormals();
    this.white = new THREE.InstancedMesh(wg, new THREE.MeshStandardMaterial({ color: 0xf2ede0, roughness: 0.34, envMapIntensity: 0.8 }), 52);
    this.black = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.22, envMapIntensity: 1.2 }), 36);
    for (const im of [this.white, this.black]) {
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.name = 'piano keys';
      d.keyFrame.add(im);
    }
    for (let k = 0; k < KEYS; k++) this.place(k);
    this.white.computeBoundingSphere();
    this.black.computeBoundingSphere();
    // The pieces stay where they are: the keyboard's frame is fixed.
    d.group.updateMatrixWorld(true);
    this.inv.copy(d.keyFrame.matrixWorld).invert();
    d.keyFrame.getWorldPosition(this.keysAt);
    this.benchAt.set(0, 0, 0.64).applyMatrix4(d.group.matrixWorld);
    const yaw = new THREE.Euler().setFromQuaternion(d.group.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
    // Sitting at the keys: in VR your head over the front of the bench; on a screen a framed view of the keyboard.
    this.viewpoint = {
      id: 'piano',
      label: 'Piano',
      position: new THREE.Vector3(0, 0, 0.58).applyMatrix4(d.group.matrixWorld),
      yaw,
      pitch: -0.62,
      eye: 1.42,
      back: 0.32,
      portrait: { back: 0.9, eye: 1.7, pitch: -0.8 },
    };
    // On a screen: push the pianist off his bench (in VR you shove him with your hands).
    this.proxy = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 0.5), new THREE.MeshBasicMaterial({ visible: false }));
    d.scene.add(this.proxy);
    d.interaction.register({
      object: this.proxy,
      label: 'Push the pianist off the bench',
      enabled: () => !!d.pianist?.seated && !d.player.inXR,
      onSelect: () => this.pushPianist(),
    });
    // Sit at the piano (a press on the bench; walking onto it works too).
    const benchZone = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.36), new THREE.MeshBasicMaterial({ visible: false }));
    benchZone.position.set(0, 0.5, 0.64);
    d.group.add(benchZone);
    d.interaction.register({
      object: benchZone,
      label: 'Sit at the piano',
      enabled: () => !d.pianist?.seated && !this.mine,
      onSelect: () => this.sit(),
    });
    this.listen();
  }

  /** Writes key k's instance matrix for its current dip. */
  private place(k: number) {
    const key = KEY_LAYOUT[k];
    // Keys pivot well behind the fallboard: the front goes down DIP, the back barely moves.
    const pivot = -0.42;
    const a = (this.dip[k] * DIP) / -pivot;
    this.m.makeTranslation(key.x, 0, pivot).multiply(this.m2.makeRotationX(a));
    this.m.multiply(this.m2.makeTranslation(0, 0, -pivot));
    (key.black ? this.black : this.white).setMatrixAt(key.slot, this.m);
  }

  /** Are you at the keys (sat down, or on the bench; in VR leaning in to play counts too)? */
  get mine(): boolean {
    const p = this.d.player;
    return p.seated?.id === 'piano' || p.stool?.kind === 'piano bench' || this.vrSeated;
  }

  /** VR: you sat on the bench and haven't left it (leaning over the keys takes your head off it). */
  private vrSeated = false;

  /** Sit at the piano: a framed view on a screen, onto the bench in VR. */
  sit() {
    const p = this.d.player;
    if (this.d.pianist?.seated) return;
    if (p.inXR) p.place(this.viewpoint);
    else p.sit(this.viewpoint);
  }

  /** Is (x, z) on the piano bench? */
  onBench(x: number, z: number): boolean {
    return Math.hypot(x - this.benchAt.x, z - this.benchAt.z) < 0.4;
  }

  /** Is the pianist's bench taken (you, or a friend, sitting at the keys)? */
  benchTaken(x: number, z: number): boolean {
    if (!this.onBench(x, z)) return false;
    return this.mine || this.friendsAt.size > 0;
  }

  /** Screen players: push the pianist off his bench (away from you). */
  pushPianist() {
    const pi = this.d.pianist;
    if (!pi?.seated) return;
    const f = this.d.player.feet();
    let ux = pi.pos.x - f.x,
      uz = pi.pos.z - f.z;
    const l = Math.hypot(ux, uz) || 1;
    ux /= l;
    uz /= l;
    this.d.bodies.knockOffSeat(pi, ux, uz, 0.5, false, pi.pos.clone().setY(1.2));
  }

  /** The pianist was knocked off here (by you): tell your friends. */
  knocked(p: Person, ux: number, uz: number, power: number) {
    if (p !== this.d.pianist) return;
    this.stats.knocked++;
    this.tookOver = false;
    this.iKnocked = true;
    this.onKnock?.(ux, uz, power);
  }

  /** A friend knocked him off: he stumbles off the bench here too (they voiced it). */
  knockedByFriend(ux: number, uz: number, power: number) {
    const pi = this.d.pianist;
    if (!pi?.seated) return;
    this.tookOver = false;
    this.iKnocked = false;
    this.d.bodies.knockOffSeat(pi, ux, uz, power, false, pi.pos.clone().setY(1.2), { quiet: true });
  }

  /** He sat back down: if nobody played while he was gone, he lets you know what he thinks of it. */
  reseated(p: Person) {
    if (p !== this.d.pianist) return;
    // (Only on the machine of whoever knocked him off: friends hear that line through the room.)
    if (!this.tookOver && this.iKnocked) this.d.react(p, 'pushed');
    this.iKnocked = false;
    this.loopLevel = Math.min(this.loopLevel, 0);
  }

  /** A friend is (or isn't) sitting at the bench. */
  setFriendAt(id: string, at: boolean) {
    if (at) this.friendsAt.add(id);
    else this.friendsAt.delete(id);
  }

  // ---------------------------------------------------------------------------
  // Notes.
  // ---------------------------------------------------------------------------

  /** You played a key (finger, typing, click): sound it, show it, tell your friends. */
  press(midi: number, vel: number) {
    if (midi < LOW || midi > HIGH) return;
    this.synth.prepare();
    this.synth.noteOn(midi, vel);
    this.hold(midi, 1);
    this.lastNote = this.time;
    this.tookOver = true;
    this.stats.local++;
    this.onNote?.(midi, Math.max(1, Math.round(vel * 127)));
  }

  release(midi: number) {
    if (midi < LOW || midi > HIGH) return;
    if (this.hold(midi, -1) === 0) this.synth.noteOff(midi);
    this.onNote?.(midi, 0);
  }

  /** A friend's note (vel 0..127, 0 = let go), `delay` seconds from now. */
  remote(id: string, midi: number, vel: number, delay: number) {
    if (midi < LOW || midi > HIGH) return;
    if (vel > 0) {
      this.synth.prepare();
      this.synth.noteOn(midi, vel / 127, delay);
      this.hold(midi, 1);
      this.lastNote = this.time;
      this.tookOver = true;
      this.stats.remote++;
    } else if (this.hold(midi, -1) === 0) this.synth.noteOff(midi, delay);
    void id;
  }

  remotePedal(id: string, on: boolean, delay: number) {
    this.sustainRemote.set(id, on);
    this.applyPedal(delay);
  }

  /** A friend left: their notes and pedal let go. */
  dropFriend(id: string, notes: Iterable<number>) {
    for (const n of notes) this.remote(id, n, 0, 0);
    this.sustainRemote.delete(id);
    this.friendsAt.delete(id);
    this.applyPedal(0);
  }

  private pedalOn = false;
  private applyPedal(delay: number) {
    let on = this.sustainKeys || this.sustainVR;
    for (const v of this.sustainRemote.values()) on ||= v;
    if (on === this.pedalOn) return;
    this.pedalOn = on;
    this.synth.pedal(on, delay);
  }

  private setMyPedal(keys: boolean, vr: boolean) {
    const was = this.sustainKeys || this.sustainVR;
    this.sustainKeys = keys;
    this.sustainVR = vr;
    const now = keys || vr;
    if (now !== was) this.onPedal?.(now);
    this.applyPedal(0);
  }

  /** Changes how many hold key `midi` down; returns the new count. */
  private hold(midi: number, n: number): number {
    const k = midi - LOW;
    this.holders[k] = Math.max(0, this.holders[k] + n);
    return this.holders[k];
  }

  /** Is this key down right now (anyone's)? */
  isDown(midi: number) {
    return this.holders[midi - LOW] > 0;
  }

  // ---------------------------------------------------------------------------
  // Screens: the computer keyboard, the mouse and touch.
  // ---------------------------------------------------------------------------

  private listen() {
    const typingOK = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !(t instanceof HTMLInputElement) && !(t instanceof HTMLTextAreaElement) && !this.d.player.inXR && this.d.player.seated?.id === 'piano';
    };
    addEventListener(
      'keydown',
      (e) => {
        if (!typingOK(e)) return;
        const code = e.code;
        let used = true;
        if (code === 'KeyZ' || code === 'KeyX') {
          if (!e.repeat) this.shiftOctave(code === 'KeyZ' ? -1 : 1);
        } else if (code === 'Space') {
          if (!e.repeat) this.setMyPedal(true, this.sustainVR);
        } else if (code === 'Escape' || code === 'Backspace') {
          this.d.player.stand();
        } else {
          const midi = typingNote(code, this.octave);
          // A note key past the end of the keyboard does nothing (but doesn't walk you off the bench either).
          if (midi === null) used = code in TYPING;
          else if (!e.repeat && !this.typed.has(code)) {
            this.typed.set(code, midi);
            this.press(midi, e.shiftKey ? 0.95 : 0.7);
          }
        }
        if (used) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true,
    );
    addEventListener(
      'keyup',
      (e) => {
        const midi = this.typed.get(e.code);
        if (midi !== undefined) {
          this.typed.delete(e.code);
          this.release(midi);
          e.stopImmediatePropagation();
        }
        if (e.code === 'Space' && this.sustainKeys) {
          this.setMyPedal(false, this.sustainVR);
          e.stopImmediatePropagation();
        }
      },
      true,
    );
    addEventListener('blur', () => this.letGoTyped());
    // Click or tap a key (hold it down; slide along for a glissando).
    const dom = this.d.dom;
    const down = (e: PointerEvent) => {
      if (e.target !== dom || this.d.player.inXR || e.button > 0) return;
      const midi = this.pointKey(e);
      if (midi < 0) return;
      e.stopImmediatePropagation();
      this.pointers.set(e.pointerId, midi);
      this.press(midi, 0.72);
    };
    const move = (e: PointerEvent) => {
      const held = this.pointers.get(e.pointerId);
      if (held === undefined) return;
      e.stopImmediatePropagation();
      const midi = this.pointKey(e);
      if (midi >= 0 && midi !== held) {
        this.release(held);
        this.pointers.set(e.pointerId, midi);
        this.press(midi, 0.6);
      }
    };
    const up = (e: PointerEvent) => {
      const held = this.pointers.get(e.pointerId);
      if (held === undefined) return;
      e.stopImmediatePropagation();
      this.pointers.delete(e.pointerId);
      this.release(held);
    };
    addEventListener('pointerdown', down, true);
    addEventListener('pointermove', move, true);
    addEventListener('pointerup', up, true);
    addEventListener('pointercancel', up, true);
  }

  private letGoTyped() {
    for (const midi of this.typed.values()) this.release(midi);
    this.typed.clear();
    if (this.sustainKeys) this.setMyPedal(false, this.sustainVR);
  }

  /** The key under a screen point (or the crosshair, with the mouse captured), or -1. */
  private pointKey(e: PointerEvent): number {
    const cam = this.d.camera;
    if (cam.getWorldPosition(this.v).distanceTo(this.keysAt) > 2.4) return -1;
    const r = this.d.dom.getBoundingClientRect();
    const locked = document.pointerLockElement === this.d.dom;
    const ndc = locked ? new THREE.Vector2() : new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    cam.updateMatrixWorld();
    this.ray.setFromCamera(ndc, cam);
    return this.rayKey(this.ray.ray);
  }

  /** The key a world ray lands on: a black key's top, else a white key's. */
  rayKey(ray: THREE.Ray): number {
    const local = ray.clone().applyMatrix4(this.inv);
    for (const [y, which] of [[BLACK_H, 'black'], [0, 'white']] as const) {
      if (Math.abs(local.direction.y) < 1e-4) continue;
      const t = (y - local.origin.y) / local.direction.y;
      if (t <= 0) continue;
      const x = local.origin.x + local.direction.x * t,
        z = local.origin.z + local.direction.z * t;
      const k = keyAt(x, -z, which);
      if (k >= 0) return k;
    }
    return -1;
  }

  // ---------------------------------------------------------------------------
  // Every frame.
  // ---------------------------------------------------------------------------

  update(dt: number) {
    this.time += dt;
    const { player, pianist } = this.d;
    const head = this.d.camera.getWorldPosition(this.v);
    const near = head.distanceTo(this.keysAt) < 9;
    if (near) this.synth.prepare();
    // VR: on the bench until your head is well away from it (or you're not in VR).
    if (!player.inXR) this.vrSeated = false;
    else if (player.stool?.kind === 'piano bench') this.vrSeated = true;
    else if (this.vrSeated && Math.hypot(head.x - this.benchAt.x, head.z - this.benchAt.z) > 0.75) this.vrSeated = false;
    const mine = this.mine;
    // Walk onto the bench on a screen: you sit down at the keys (once; standing up leaves you be).
    if (!player.inXR && player.stool?.kind === 'piano bench' && !this.wasOnBench && !player.seated) this.sit();
    this.wasOnBench = player.stool?.kind === 'piano bench' || player.seated?.id === 'piano';
    if (mine && !this.hinted && !player.inXR) {
      this.hinted = true;
      this.d.hud.toast('Piano: A S D F G H J K L white keys · W E T Y U O P black · Z / X octave · Space sustain · Esc to stand', 'info');
    }
    if (!mine && player.seated?.id !== 'piano' && this.typed.size) this.letGoTyped();
    if (!mine) this.hinted = false;

    // VR: your fingertips on the keys, the pedal, the seat height.
    if (player.inXR && head.distanceTo(this.keysAt) < 1.6) this.fingertips(dt);
    else this.liftFingers();
    this.seatHeight(dt, mine && player.inXR);

    // The keys go down fast and come up a little slower.
    let wChanged = false,
      bChanged = false;
    for (let k = 0; k < KEYS; k++) {
      const want = this.holders[k] > 0 ? 1 : 0;
      const cur = this.dip[k];
      if (cur === want) continue;
      const step = dt * (want > cur ? 40 : 22);
      this.dip[k] = want > cur ? Math.min(want, cur + step) : Math.max(want, cur - step);
      this.place(k);
      if (KEY_LAYOUT[k].black) bChanged = true;
      else wChanged = true;
    }
    if (wChanged) this.white.instanceMatrix.needsUpdate = true;
    if (bChanged) this.black.instanceMatrix.needsUpdate = true;

    // The pianist's music: only while he's at the keys and nobody else is playing.
    const playing = this.time - this.lastNote < 6 || mine || this.friendsAt.size > 0;
    const want = pianist?.seated && !playing ? 1 : 0;
    this.loopLevel += (want - this.loopLevel) * Math.min(1, dt * (want ? 0.8 : 3));
    const loop = this.d.loop;
    if (loop?.buffer) {
      const vol = 0.9 * this.loopLevel;
      if (this.loopLevel < 0.01 && loop.isPlaying) loop.pause();
      else if (this.loopLevel >= 0.01 && !loop.isPlaying) loop.play();
      if (Math.abs(loop.getVolume() - vol) > 0.005) loop.setVolume(vol);
    }
    if (pianist) {
      this.proxy.position.set(pianist.pos.x, pianist.pos.y + 0.8, pianist.pos.z);
    }
  }

  private ctrls: { id: string; label: string; sub?: string; kind?: 'primary' | 'plain'; active?: boolean; onPress: () => void }[] | null = null;
  /** On-screen buttons while you sit at the piano (octave, pedal, stand). */
  controls() {
    this.ctrls ??= [
      { id: 'pdown', label: '◀ Octave', kind: 'plain', onPress: () => this.shiftOctave(-1) },
      { id: 'pup', label: 'Octave ▶', kind: 'plain', onPress: () => this.shiftOctave(1) },
      { id: 'ppedal', label: 'Pedal', sub: 'sustain', kind: 'plain', onPress: () => this.setMyPedal(!this.sustainKeys, this.sustainVR) },
      { id: 'pstand', label: 'Stand', kind: 'primary', onPress: () => this.d.player.stand() },
    ];
    this.ctrls[2].active = this.sustainKeys;
    this.ctrls[0].sub = this.ctrls[1].sub = noteName(12 * (this.octave + 1));
    return this.ctrls;
  }

  private shiftOctave(n: number) {
    this.octave = Math.max(OCTAVE.min, Math.min(OCTAVE.max, this.octave + n));
    this.d.hud.toast(`Octave: ${noteName(12 * (this.octave + 1))} – ${noteName(12 * (this.octave + 1) + 17)}`, 'info');
  }

  /** The pianist's music level now (0..1, for tests). */
  get music() {
    return this.loopLevel;
  }

  private fingertips(dt: number) {
    const { hands } = this.d;
    const poses = this.d.fingerPoses();
    // The sustain pedal: A or X held down.
    let pedal = false;
    // (A/X answer replies while a reply prompt is up: no pedal then.)
    if (!replyPrompt.busy()) for (const g of this.d.gamepads()) if (g.gamepad.buttons[4]?.pressed) pedal = true;
    if (pedal !== this.sustainVR) this.setMyPedal(this.sustainKeys, pedal);
    for (let s = 0; s < 2; s++) {
      const side = SIDES[s];
      let busy = false;
      for (const h of hands.hands) if (h.ctrl.userData.handedness === side && (h.held || h.carried)) busy = true;
      const tips = this.tips[s],
        has = this.has[s];
      const src = busy ? null : hands.fingertips(side, tips, has);
      const pose = side === 'left' ? poses.l : poses.r;
      for (let i = 0; i < 5; i++) {
        const f = s * 5 + i;
        // Controllers: the index finger and thumb play; the other three only with the hand open.
        let present = !!src && has[i];
        if (present && src === 'ctrl' && i >= 2 && pose[i] > 0.3) present = false;
        if (present && src === 'ctrl' && i === 0 && pose[0] > 0.5) present = false;
        let x = 0,
          y = 0,
          dd = 0;
        if (present) {
          const t = tips[i].applyMatrix4(this.inv);
          x = t.x;
          y = t.y;
          dd = -t.z;
        }
        const ev = stepFinger(this.fingers[f], present, x, y, dd, dt, this.ev);
        if (ev.off >= 0) this.release(ev.off);
        if (ev.on >= 0) {
          this.press(ev.on, ev.vel);
          if (src === 'ctrl') this.d.haptic(side, 0.12 + 0.5 * ev.vel, 24);
        }
      }
    }
  }

  private liftFingers() {
    for (const f of this.fingers) {
      if (f.key < 0 && !f.has) continue;
      const ev = stepFinger(f, false, 0, 0, 0, 0, this.ev);
      if (ev.off >= 0) this.release(ev.off);
    }
    if (this.sustainVR) this.setMyPedal(this.sustainKeys, false);
  }

  /**
   * VR on the bench: the world comes up (or you come down) so the keys sit just below your
   * hands whether you're standing or sitting for real. Measured when you sit, and again if you
   * change posture (stand up or sit down for real) for more than a moment.
   */
  private seatHeight(dt: number, on: boolean) {
    const p = this.d.player;
    if (!on) {
      this.headRef = -1;
      this.dropWant = 0;
    } else {
      const eyes = this.d.camera.position.y; // above the rig's floor
      if (this.headRef < 0 || Math.abs(eyes - this.headRef) < 0.2) {
        if (this.headRef < 0) this.headRef = eyes;
        this.headOff = 0;
      } else if ((this.headOff += dt) > 1.5) this.headRef = eyes;
      // Keys at 0.78 m; your eyes should be KEYS_BELOW_EYES above them.
      this.dropWant = THREE.MathUtils.clamp(this.headRef - (this.keysAt.y + KEYS_BELOW_EYES), 0, 0.7);
    }
    p.seatDrop += (this.dropWant - p.seatDrop) * Math.min(1, dt * 3);
    if (Math.abs(p.seatDrop) < 1e-4) p.seatDrop = 0;
  }

  /** Every key you hold, let go (leaving, losing the hands). */
  allOff() {
    this.liftFingers();
    this.letGoTyped();
    for (const [, midi] of this.pointers) this.release(midi);
    this.pointers.clear();
  }
}
