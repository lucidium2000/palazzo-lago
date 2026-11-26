import * as THREE from 'three';
import type { Interaction } from './interaction';
import type { Seat, Surface, World } from './world';
import { Crouch } from './crouch';
import { GRAVITY, MAX_SWIM_SPEED, StrokeHand, floatFeet, isDeep, newVState, strokeThrust, verticalStep, type VEvents } from './swimphys';
import { replyPrompt } from './replyhud';

/**
 * The player. Desktop: first-person walking (mouse-look with pointer lock, or
 * drag to look), WASD, Shift to hurry, collisions, footsteps and a little head
 * bob; sit down at a game for a framed view. VR: the headset drives the camera
 * inside the rig; the left stick walks (with a comfort vignette), the right
 * stick snap-turns, and pointing at the floor still teleports. Hold the right
 * stick in (desktop: C) to crouch, or in deep water to swim down.
 */

export interface Viewpoint {
  id: string;
  label: string;
  /** Floor point the player stands (or sits) at. */
  position: THREE.Vector3;
  /** Facing direction, radians (0 looks toward -Z). */
  yaw: number;
  /** Desktop only: camera pitch and eye height. */
  pitch: number;
  eye: number;
  /** Desktop only: step back this far along the view for a wider shot. */
  back?: number;
  /** A framing for tall portrait screens (phones): replaces back/eye/pitch, shifts sideways. */
  portrait?: { back: number; eye: number; pitch: number; side?: number; at?: THREE.Vector3; yaw?: number };
}

/** On a portrait screen, use the viewpoint's portrait framing if it has one. */
function framed(v: Viewpoint, aspect: number): Viewpoint {
  if (aspect >= 0.85 || !v.portrait) return v;
  const p = v.portrait;
  const yaw = p.yaw ?? v.yaw;
  const side = p.side ?? 0;
  const base = p.at ?? v.position;
  const pos = base.clone().add(new THREE.Vector3(Math.cos(yaw) * side, 0, -Math.sin(yaw) * side));
  return { ...v, position: pos, yaw, back: p.back, eye: p.eye, pitch: p.pitch };
}

const desktopSpot = (v: Viewpoint) =>
  v.position.clone().add(new THREE.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw)).multiplyScalar(v.back ?? 0));

const EYE = 1.65;
const WALK = 1.45;
const RUN = 3.0;
/** Your body's radius on the floor (walls, furniture, people). */
export const RADIUS = 0.25;
/** Take-off speed for a ~0.45 m jump. */
const JUMP_V = Math.sqrt(2 * GRAVITY * 0.45);
/** Highest ledge you can walk up (a stair, a curb). */
const STEP_UP = 0.36;
/** Desktop eye height sitting on a stool: this far above its seat. */
const SEATED_EYE = 0.52;
/** Once on a stool, you stay on it until your feet are this much further out. */
const SEAT_STAY = 0.08;
/** Eye height while sitting on a stool (desktop). */
export const stoolEye = (seat: Seat) => THREE.MathUtils.clamp(seat.y + SEATED_EYE, 1.1, 1.45);

export class Player {
  readonly rig = new THREE.Group();
  private pitch = 0;
  private eye = EYE;
  private tween: { from: Viewpoint; to: Viewpoint; t: number; dur: number } | null = null;
  private keys = new Set<string>();
  private snapReady = true;
  /** VR comfort settings (saved per device; see the VR menu). */
  readonly comfort = loadComfort();
  private stride = 0;
  private bob = 0;
  /** Dancing on a screen (party/index.ts): the view bounces (m) and sways (radians) with the beat. */
  danceBob = 0;
  danceRoll = 0;
  private speedNow = 0;
  private vignette: THREE.Mesh;
  private turnFlash = 0;
  /** The game the player is sitting at (desktop), if any. */
  seated: Viewpoint | null = null;
  /**
   * The stool you're on: walk onto a slot, table or bar stool and you sit on
   * it (desktop: your eyes come down to seated height; VR: your body sits).
   * Null when you're not over one, sitting at a game, airborne or swimming.
   */
  stool: Seat | null = null;
  /** Easing your eyes back up after a stool (desktop). */
  private stoolEyeT = false;
  current: Viewpoint | null = null;
  onArrive: ((v: Viewpoint) => void) | null = null;
  onStep: ((surface: Surface, run: boolean) => void) | null = null;
  onStand: (() => void) | null = null;
  /** Vertical motion (feet height, speed, in the air) and the water safety net: see swimphys.ts. */
  private vs = newVState();
  private vEv: VEvents = { land: 0, splash: 0 };
  /** Height of your feet (0 on the casino floor; lower in the pool). */
  /** Knocked out (fight/): no walking or turning until you come round. */
  stunned = false;
  /** VR: your hands are on a game that uses the thumbsticks (the racing cabinet's wheel): no stick walking or turning. */
  anchored = false;

  get feetY() {
    return this.vs.feetY;
  }
  set feetY(y: number) {
    this.vs.feetY = y;
  }
  private get velY() {
    return this.vs.velY;
  }
  private set velY(v: number) {
    this.vs.velY = v;
  }
  private get airborne() {
    return this.vs.airborne;
  }
  private set airborne(a: boolean) {
    this.vs.airborne = a;
  }
  private jumpQueued = false;
  private diving = false;
  /** The crouch / dive button: right stick clicked in (VR), C (desktop). */
  private crouchBtn = false;
  /** Crouching on the button (lowers your view on land; see crouch.ts). */
  readonly crouch = new Crouch();
  private aWas = false;
  private strokeT = 0;
  private swimT = 0;
  /** Water surface over you (null when dry), whether you're floating, and whether your head is under. */
  water: number | null = null;
  swimming = false;
  /**
   * VR arm strokes: each tracked hand's id, position in the rig's own frame
   * (controllers are children of the rig) and the time in seconds (set by the game).
   * Pull your hands back through the water to swim forward; push them up to dive.
   */
  strokes: (() => { id: number; p: THREE.Vector3; t: number }[]) | null = null;
  private strokeHands = new Map<number, StrokeHand>();
  /** Momentum from your strokes (horizontal, m/s). */
  private swimVel = new THREE.Vector2();
  /** VR: the eye height you float at (your headset's, smoothed: a quick duck peeks under). */
  private swimEye = EYE;
  /** Seconds since your arms last drove you down (a dive: the safety net waits). */
  private armDive = 0;
  private thrustAvg = 0;
  private bobAmp = 0;
  /** VR: last head spot in the water that was allowed (leaning out over the deck is held back). */
  private wetSpot: THREE.Vector2 | null = null;
  underwater = false;
  /** May Space jump right now? (Not at a table, where Space spins.) */
  jumpAllowed: () => boolean = () => true;
  onSplash: ((at: THREE.Vector3, strength: number) => void) | null = null;
  onLand: ((at: THREE.Vector3, strength: number) => void) | null = null;
  onStroke: ((at: THREE.Vector3) => void) | null = null;
  /** Analog walk input from a touch joystick: x right, y forward, each -1..1. */
  readonly stick = new THREE.Vector2();
  /**
   * People in the way: adjusts a walking step from (x, z) by (dx, dz) before
   * walls are checked, writing the step to take into `out` (see bodies.ts).
   */
  bodies: ((x: number, z: number, dx: number, dz: number, out: { dx: number; dz: number }) => void) | null = null;
  private bodyStep = { dx: 0, dz: 0 };
  /** A push from outside (a friend shoving you), still to be applied. */
  private nudgeLeft = new THREE.Vector2();
  private nudgeT = 0;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private renderer: THREE.WebGLRenderer,
    private world: World,
  ) {
    this.rig.add(camera);
    addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'BUTTON') return;
      this.keys.add(e.code);
      if (e.code === 'Space' && !this.inXR && !this.seated && this.jumpAllowed()) {
        e.preventDefault();
        this.jump();
      }
      // Walking away from a seat stands you up and recaptures the mouse.
      if (/^(KeyW|KeyA|KeyS|KeyD|ArrowUp|ArrowDown)$/.test(e.code) && !this.inXR) {
        if (this.seated) this.stand();
        this.lockPointer();
      }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    renderer.xr.addEventListener('sessionstart', () => {
      camera.position.set(0, 0, 0);
      camera.rotation.set(0, 0, 0);
      this.seated = null;
      this.crouch.reset();
    });
    renderer.xr.addEventListener('sessionend', () => this.applyDesktopCamera());

    // Comfort vignette: a soft dark ring round the edge of your view while moving in VR. Drawn by a
    // shader on a plane far wider than any headset's view, so it has no edges (a small textured
    // square showed up as a dark box on wide-view headsets).
    this.vignette = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.ShaderMaterial({
        uniforms: { opacity: { value: 0 } },
        vertexShader: 'varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        // Radius in metres at 0.12 m: clear to ~45 degrees off centre, darkening to the edge.
        fragmentShader: 'uniform float opacity; varying vec2 vP; void main() { float r = length(vP * vec2(0.9, 1.0)); float a = smoothstep(0.1, 0.24, r); gl_FragColor = vec4(0.0, 0.0, 0.0, a * opacity); }',
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.vignette.position.z = -0.12;
    this.vignette.renderOrder = 2000;
    this.vignette.visible = false;
    this.vignette.raycast = () => {};
    camera.add(this.vignette);
  }

  /** Current walking speed (m/s), for the body's walk animation. */
  get speed() {
    return this.speedNow;
  }

  get inXR() {
    return this.renderer.xr.isPresenting;
  }

  get pointerLocked() {
    return document.pointerLockElement === this.renderer.domElement;
  }

  lockPointer() {
    if (this.inXR || this.pointerLocked || this.seated) return;
    const el = this.renderer.domElement as HTMLCanvasElement & { requestPointerLock(): Promise<void> | void };
    try {
      const p = el.requestPointerLock();
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => {});
    } catch {
      /* not allowed here (e.g. embedded viewer): drag-to-look still works */
    }
  }

  attach(interaction: Interaction) {
    const look = (dx: number, dy: number, k: number) => {
      if (this.inXR) return;
      this.tween = null;
      this.rig.rotation.y -= dx * k;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * k, -1.3, 1.1);
      this.applyDesktopCamera();
    };
    interaction.onDrag = (dx, dy) => look(-dx, -dy, 0.004);
    interaction.onLook = (dx, dy) => look(dx, dy, 0.0022);
  }

  private applyDesktopCamera() {
    if (this.inXR) return;
    this.camera.position.set(0, this.eye - this.crouch.drop + Math.sin(this.bob * 2) * 0.018 * Math.min(1, this.speedNow / WALK) + this.danceBob, 0);
    this.camera.rotation.set(this.pitch, 0, Math.sin(this.bob) * 0.004 * Math.min(1, this.speedNow / WALK) + this.danceRoll, 'YXZ');
  }

  /** Feet position (desktop rig position, or the point under the VR head), at your feet's height. */
  feet(): THREE.Vector3 {
    if (!this.inXR) return this.rig.position.clone().setY(this.feetY);
    return this.headWorld().setY(this.feetY);
  }

  /** Jump (or, in the water by the edge, haul yourself out). */
  jump() {
    this.jumpQueued = true;
  }

  /** Eye height above your feet (desktop eye, or your real head in VR). */
  private eyeHeight() {
    return this.inXR ? THREE.MathUtils.clamp(this.camera.position.y, 0.8, 2.1) : this.eye;
  }

  /**
   * Moves horizontally like World.move, but ledges higher than a stair block
   * you (the pool wall from inside), unless you're in the air above them.
   */
  private walkMove(x: number, z: number, dx: number, dz: number): [number, number] {
    const ok = (nx: number, nz: number) => {
      const g = this.world.groundAt(nx, nz);
      // Swimming: anywhere the water is still over the floor (the steps, the shallows).
      if (this.swimming || this.diving) return this.swimSpot(nx, nz, g);
      return g <= this.feetY + STEP_UP;
    };
    const tries: [number, number][] = [
      [dx, dz],
      [dx, 0],
      [0, dz],
    ];
    for (const [ax, az] of tries) {
      const [nx, nz] = this.world.move(x, z, ax, az, RADIUS);
      if (ok(nx, nz)) return [nx, nz];
    }
    return [x, z];
  }

  /**
   * Somewhere you can swim to: water over the floor, and your head kept a hand's
   * width from the pool walls (right against them the camera would clip into the deck).
   */
  private swimSpot(x: number, z: number, g = this.world.groundAt(x, z)) {
    const w = this.world.waterAt(x, z);
    if (w === null || g > w - 0.15) return false;
    const m = 0.2;
    return this.world.waterAt(x + m, z) !== null && this.world.waterAt(x - m, z) !== null && this.world.waterAt(x, z + m) !== null && this.world.waterAt(x, z - m) !== null;
  }

  /**
   * VR, in the water: your real head can move about the room. Leaning out over
   * the deck (or a ledge you couldn't wade up) is held back like a wall, rather
   * than lifting your whole body out of the pool.
   */
  private keepHeadInWater() {
    if (!this.inXR || this.water === null) {
      this.wetSpot = null;
      return;
    }
    const head = this.headWorld();
    const g = this.world.groundAt(head.x, head.z);
    const ok = this.swimming || this.diving ? this.swimSpot(head.x, head.z, g) : g <= this.feetY + STEP_UP;
    if (ok) {
      (this.wetSpot ??= new THREE.Vector2()).set(head.x, head.z);
      return;
    }
    if (!this.wetSpot && (this.swimming || this.diving)) {
      // Fell in right by the wall: find the nearest spot clear of it.
      for (let r = 0.1; r <= 0.6 && !this.wetSpot; r += 0.1)
        for (let a = 0; a < 8; a++) {
          const x = head.x + Math.cos((a * Math.PI) / 4) * r,
            z = head.z + Math.sin((a * Math.PI) / 4) * r;
          if (this.swimSpot(x, z)) {
            this.wetSpot = new THREE.Vector2(x, z);
            break;
          }
        }
    }
    if (this.wetSpot) {
      this.rig.position.x += this.wetSpot.x - head.x;
      this.rig.position.z += this.wetSpot.y - head.z;
    }
  }

  /** Speed factor for wading or swimming. */
  private waterDrag() {
    if (this.water === null) return 1;
    if (this.swimming) return 0.55;
    const depth = this.water - this.feetY;
    return depth > 0.6 ? 0.5 : depth > 0.25 ? 0.75 : 1;
  }

  /** Gravity, jumping, landing, floating and swimming: runs after the horizontal move. */
  private updateVertical(dt: number, at0: THREE.Vector3, moving: boolean) {
    this.keepHeadInWater();
    const at = this.inXR ? this.feet() : at0;
    const ground = this.world.groundAt(at.x, at.z);
    const water = this.world.waterAt(at.x, at.z);
    const wasWet = this.water !== null;
    this.water = water;
    // Chest-deep water or more: you swim (your body lies along the surface, so
    // your real height doesn't matter) with your eyes just above the water.
    const deep = isDeep(ground, water, this.swimming || this.diving);
    // The eye height you float at. VR: your headset's real height (not clamped to
    // a standing one, or a crouching swimmer's head would sit under the water),
    // smoothed so a quick duck peeks under and a lasting one floats you back up.
    const headNow = this.inXR ? THREE.MathUtils.clamp(this.camera.position.y, 0.05, 2.4) : this.eye;
    if (water === null || !wasWet || !this.inXR) this.swimEye = headNow;
    else this.swimEye += (headNow - this.swimEye) * Math.min(1, dt / 0.8);
    this.diving = deep && this.crouchBtn;

    if (this.jumpQueued) {
      this.jumpQueued = false;
      if (water !== null && (deep || water - this.feetY > 0.9)) {
        // Haul out at the edge if you're facing a wall you could climb.
        const fwd = this.inXR ? new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion())) : new THREE.Vector3(-Math.sin(this.rig.rotation.y), 0, -Math.cos(this.rig.rotation.y));
        fwd.y = 0;
        fwd.normalize();
        // (Reach a little further when swimming: your head is kept off the wall.)
        let edge = at.clone().addScaledVector(fwd, 0.55);
        if (this.world.waterAt(edge.x, edge.z) !== null && deep) edge = at.clone().addScaledVector(fwd, 0.8);
        const top = this.world.groundAt(edge.x, edge.z);
        if (top > this.feetY + STEP_UP && top <= (water ?? 0) + 0.4 && this.world.isFree(edge.x, edge.z, RADIUS)) {
          this.moveBodyTo(edge);
          this.feetY = top;
          this.velY = 0;
          this.airborne = false;
          this.swimVel.set(0, 0);
          this.vs.under = this.vs.held = 0;
          this.vs.rescue = false;
          this.swimming = false;
          this.wetSpot = null;
          this.onSplash?.(at.clone().setY(water ?? 0), 0.35);
          this.applyY();
          this.underwater = false;
          return;
        }
        this.velY = Math.max(this.velY, 1.2); // a kick up in the water
        this.airborne = true;
      } else if (!this.airborne) {
        this.velY = JUMP_V;
        this.airborne = true;
      }
    }

    // VR arm strokes: always track the hands (so a stroke starts clean), push only in deep water.
    const thrustY = this.armStrokes(dt, deep ? water : null, at);
    // Diving = pushing yourself down on average, not just flailing.
    this.thrustAvg += (thrustY - this.thrustAvg) * Math.min(1, dt / 0.5);
    this.armDive = this.thrustAvg < -1.2 ? 1.2 : Math.max(0, this.armDive - dt);
    const ev = verticalStep(
      this.vs,
      { ground, water, deep, eyeH: deep ? this.swimEye : this.eyeHeight(), headH: deep ? headNow : undefined, dive: this.diving, thrust: thrustY, diving: this.armDive > 0 },
      dt,
      this.vEv,
    );
    if (!deep && ev.land > 2.2) this.onLand?.(at.clone().setY(ground), Math.min(1, ev.land / 6));
    // Entering the water: a splash sized to how fast you hit it.
    if (water !== null && ev.splash > 0) {
      const v = Math.max(ev.splash, this.speedNow * 0.5);
      if (v > 0.6) this.onSplash?.(at.clone().setY(water), THREE.MathUtils.clamp(v / 5, 0.25, 1));
    }
    this.swimming = deep && !this.diving;
    // On land the same button crouches (not swimming, not on a stool).
    this.updateCrouch(dt, !deep && !this.stool);
    // Strokes and ripples while you move through the water.
    if (water !== null && water - this.feetY > 0.5 && moving) {
      this.strokeT -= dt;
      if (this.strokeT <= 0) {
        this.strokeT = this.swimming ? 0.95 : 0.7;
        this.onStroke?.(at.clone().setY(water));
      }
    }
    // A gentle bob while floating (faded in and out, never a jolt).
    this.swimT += dt;
    const settled = this.swimming && Math.abs(this.velY) < 0.3 ? 1 : 0;
    this.bobAmp += (settled - this.bobAmp) * Math.min(1, dt * 2);
    const bob = Math.sin(this.swimT * 1.7) * 0.025 * this.bobAmp;
    this.applyY(bob);
    const head = this.inXR ? this.headWorld().y : this.feetY + this.eye - this.crouch.drop + bob;
    this.underwater = water !== null && head < water - 0.03;
  }

  /**
   * VR swimming: your hands push the water, the water pushes you. Hand motion is
   * measured in the rig's frame (turning, floating up or hauling out isn't a
   * stroke) and filtered for tracking glitches; the thrust is capped.
   * Moves you horizontally; returns the vertical thrust (m/s², + up).
   */
  private armStrokes(dt: number, water: number | null, at: THREE.Vector3): number {
    const hands = this.inXR ? (this.strokes?.() ?? []) : [];
    if (!hands.length) this.strokeHands.clear();
    let thrustY = 0;
    const yaw = this.rig.rotation.y,
      c = Math.cos(yaw),
      s = Math.sin(yaw);
    const lv = { x: 0, y: 0, z: 0 },
      acc = { x: 0, y: 0, z: 0 };
    for (const h of hands) {
      let tr = this.strokeHands.get(h.id);
      if (!tr) this.strokeHands.set(h.id, (tr = new StrokeHand()));
      tr.push(h.t, h.p.x, h.p.y, h.p.z);
      if (water === null || this.rig.position.y + h.p.y > water - 0.03) continue;
      tr.velocity(lv);
      // How the hand moves through the water: its motion in the rig, turned to
      // world axes, plus your own drift.
      const rel = { x: lv.x * c + lv.z * s + this.swimVel.x, y: lv.y + this.velY, z: -lv.x * s + lv.z * c + this.swimVel.y };
      strokeThrust(rel, acc);
      this.swimVel.x += acc.x * dt;
      this.swimVel.y += acc.z * dt;
      thrustY += acc.y;
    }
    if (water === null) {
      this.swimVel.multiplyScalar(Math.exp(-4 * dt));
      return 0;
    }
    this.swimVel.multiplyScalar(Math.exp(-1.2 * dt));
    if (this.swimVel.length() > MAX_SWIM_SPEED) this.swimVel.setLength(MAX_SWIM_SPEED);
    if (this.swimVel.lengthSq() > 1e-4) {
      const p = this.headWorld();
      const [nx, nz] = this.walkMove(p.x, p.z, this.swimVel.x * dt, this.swimVel.y * dt);
      if (Math.abs(nx - p.x - this.swimVel.x * dt) > 1e-4) this.swimVel.x *= -0.2;
      if (Math.abs(nz - p.z - this.swimVel.y * dt) > 1e-4) this.swimVel.y *= -0.2;
      this.rig.position.x += nx - p.x;
      this.rig.position.z += nz - p.z;
      this.strokeT -= dt * this.swimVel.length();
      if (this.strokeT <= 0) {
        this.strokeT = 0.8;
        this.onStroke?.(at.clone().setY(water));
      }
    }
    return thrustY;
  }

  /** Swim speed right now (for the body's kick). */
  get swimSpeed() {
    return this.swimVel.length();
  }

  private applyY(bob = 0) {
    // VR: the button crouch lowers the whole rig (your real head still moves the view), and so
    // does sitting at the piano (the keys come up to where your hands are, standing or sitting).
    this.rig.position.y = this.feetY + bob - (this.inXR ? this.crouch.drop + this.seatDrop : 0);
  }

  /**
   * VR: how far the world comes up to meet you while seated somewhere that needs your hands
   * at a set height (the piano bench). Set by whoever seats you; 0 otherwise.
   */
  seatDrop = 0;

  /** The floor under you as the rig sees it (the rig is lowered while you crouch in VR). */
  get floorY() {
    return this.rig.position.y + (this.inXR ? this.crouch.drop + this.seatDrop : 0);
  }

  private updateCrouch(dt: number, allowed: boolean) {
    const eye = this.inXR ? THREE.MathUtils.clamp(this.camera.position.y, 0.3, 2.4) : this.eye;
    this.crouch.update(dt, allowed && this.crouchBtn, eye);
  }

  /** Moves the rig so the feet (desktop) / head (VR) are over a floor point. */
  private moveBodyTo(p: THREE.Vector3) {
    if (this.inXR) {
      const head = this.headWorld();
      this.rig.position.x += p.x - head.x;
      this.rig.position.z += p.z - head.z;
    } else {
      this.rig.position.x = p.x;
      this.rig.position.z = p.z;
    }
  }

  /** Jump straight to a viewpoint (start-up, VR travel). */
  place(v0: Viewpoint) {
    const v = this.inXR ? v0 : framed(v0, this.camera.aspect);
    this.tween = null;
    this.current = v0;
    if (this.inXR) {
      this.teleportHeadTo(v.position, v.yaw);
    } else {
      this.rig.position.copy(desktopSpot(v));
      this.rig.rotation.y = v.yaw;
      this.pitch = v.pitch;
      this.eye = v.eye;
      this.applyDesktopCamera();
    }
    const ground = this.world.groundAt(v.position.x, v.position.z),
      water = this.world.waterAt(v.position.x, v.position.z);
    // Placed in deep water: floating at the surface, not standing on the bottom.
    this.feetY = water !== null && isDeep(ground, water) ? floatFeet(water, this.inXR ? THREE.MathUtils.clamp(this.camera.position.y, 0.05, 2.4) : this.eye) : ground;
    this.velY = 0;
    this.airborne = false;
    this.water = null;
    this.swimVel.set(0, 0);
    this.vs.under = this.vs.held = 0;
    this.vs.rescue = false;
    this.applyY();
    this.onArrive?.(v);
  }

  /** Glide to a viewpoint on desktop; instant in VR (comfort). */
  travel(v0: Viewpoint) {
    if (this.inXR) return this.place(v0);
    const v = framed(v0, this.camera.aspect);
    const from: Viewpoint = {
      id: 'from',
      label: '',
      position: this.rig.position.clone(),
      yaw: this.rig.rotation.y,
      pitch: this.pitch,
      eye: this.eye,
    };
    let dyaw = v.yaw - from.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const to = { ...v, position: desktopSpot(v), yaw: from.yaw + dyaw };
    const dist = from.position.distanceTo(v.position);
    this.tween = { from, to, t: 0, dur: THREE.MathUtils.clamp(dist / 4, 0.6, 2.2) };
    this.current = v0;
  }

  /** Sit down at a game (desktop): framed view, free mouse cursor for betting. */
  sit(v: Viewpoint) {
    if (this.inXR) return;
    this.seated = v;
    if (this.pointerLocked) document.exitPointerLock?.();
    this.travel(v);
  }

  stand() {
    if (!this.seated) return;
    this.seated = null;
    this.current = null;
    this.tween = null;
    this.onStand?.();
  }

  /** Teleport so the player's head ends up over the given floor point. */
  teleportTo(point: THREE.Vector3) {
    const spot = this.world.settle(point.x, point.z, RADIUS);
    if (!spot) return;
    const p = new THREE.Vector3(spot[0], 0, spot[1]);
    this.current = null;
    if (this.inXR) {
      this.teleportHeadTo(p);
    } else {
      if (this.seated) this.stand();
      this.travel({ id: 'walk', label: '', position: p, yaw: this.rig.rotation.y, pitch: this.pitch * 0.5, eye: EYE });
      this.current = null;
    }
  }

  /** Head position in the world. three.js copies the XR pose into the camera's local transform each frame. */
  private headWorld(): THREE.Vector3 {
    this.rig.updateMatrixWorld(true);
    return this.camera.getWorldPosition(new THREE.Vector3());
  }

  private headYaw(): number {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));
    return Math.atan2(-dir.x, -dir.z);
  }

  private teleportHeadTo(p: THREE.Vector3, yaw?: number) {
    if (yaw !== undefined) {
      const head = this.headWorld();
      this.rotateAround(head, yaw - this.headYaw());
    }
    const head = this.headWorld();
    this.rig.position.x += p.x - head.x;
    this.rig.position.z += p.z - head.z;
  }

  private rotateAround(pivot: THREE.Vector3, angle: number) {
    const offset = this.rig.position.clone().sub(pivot);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    this.rig.position.copy(pivot).add(offset);
    this.rig.rotation.y += angle;
  }

  private step(dist: number, run: boolean, at: THREE.Vector3) {
    this.stride += dist;
    const len = run ? 0.85 : 0.68;
    if (this.stride >= len) {
      this.stride -= len;
      this.onStep?.(this.world.surfaceAt(at.x, at.z), run);
    }
  }

  update(dt: number, interaction: Interaction) {
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const k = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - (-2 * tw.t + 2) ** 3 / 2;
      this.rig.position.lerpVectors(tw.from.position, tw.to.position, k);
      this.rig.rotation.y = THREE.MathUtils.lerp(tw.from.yaw, tw.to.yaw, k);
      this.pitch = THREE.MathUtils.lerp(tw.from.pitch, tw.to.pitch, k);
      this.eye = THREE.MathUtils.lerp(tw.from.eye, tw.to.eye, k);
      this.applyDesktopCamera();
      if (tw.t >= 1) {
        this.tween = null;
        if (tw.to.id !== 'walk' && this.current) this.onArrive?.(this.current);
      }
    }

    if (this.tween) {
      // Travelling to a viewpoint: land on whatever floor it's on.
      this.feetY = this.rig.position.y;
      this.velY = 0;
      this.airborne = false;
    }
    this.crouchBtn = this.inXR ? interaction.gamepads().some(({ handedness, gamepad }) => handedness === 'right' && !!gamepad.buttons[3]?.pressed) : this.keys.has('KeyC');
    // Knocked out: you stay where you are (nothing moves you, nothing turns you) until you come round.
    if (this.stunned || (this.inXR && this.anchored)) this.speedNow = 0;
    else if (!this.inXR) this.updateDesktop(dt);
    else this.updateXR(dt, interaction);
    if (this.nudgeT > 0) this.updateNudge(dt);
    if (!this.tween && !this.seated) this.updateVertical(dt, this.feet(), this.speedNow > 0.2);
    else this.updateCrouch(dt, false);
    if (!this.inXR && !this.tween) this.applyDesktopCamera();
  }

  private updateDesktop(dt: number) {
    const k = this.keys;
    const stickMag = this.stick.length();
    let f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    if (stickMag > 0.15) {
      f += this.stick.y;
      s += this.stick.x;
      if (this.seated) this.stand();
    }
    const turn = (k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0);
    const run = k.has('ShiftLeft') || k.has('ShiftRight') || stickMag > 0.92;
    const push = Math.min(1, Math.hypot(f, s));
    // Over a stool you shuffle (you're sitting down on it, or getting up).
    const target = (push > 0.05 ? (run ? RUN : WALK) * (stickMag > 0.15 ? Math.max(0.35, push) : 1) : 0) * this.waterDrag() * (this.stool ? 0.6 : 1) * this.crouch.speedFactor;
    // Ease into and out of walking so starts and stops feel like a body, not a cursor.
    this.speedNow += (target - this.speedNow) * Math.min(1, dt * (target > this.speedNow ? 6 : 9));
    if (turn) {
      this.tween = null;
      this.rig.rotation.y += turn * dt * 1.8;
    }
    if (this.speedNow > 0.02 && !this.seated) {
      this.tween = null;
      this.current = null;
      const yaw = this.rig.rotation.y;
      const len = Math.hypot(f, s) || 1;
      const fx = f / len,
        sx = s / len;
      // Keep moving in the last direction while easing out.
      if (push > 0.05) this.lastDir.set(-Math.sin(yaw) * fx + Math.cos(yaw) * sx, -Math.cos(yaw) * fx - Math.sin(yaw) * sx);
      let dx = this.lastDir.x * this.speedNow * dt,
        dz = this.lastDir.y * this.speedNow * dt;
      const p = this.rig.position;
      if (this.bodies) {
        this.bodies(p.x, p.z, dx, dz, this.bodyStep);
        dx = this.bodyStep.dx;
        dz = this.bodyStep.dz;
      }
      const [nx, nz] = this.walkMove(p.x, p.z, dx, dz);
      const moved = Math.hypot(nx - p.x, nz - p.z);
      p.x = nx;
      p.z = nz;
      this.bob += moved * (run ? 5.4 : 6.6);
      if (this.water === null || this.water - this.feetY < 0.25) this.step(moved, run, p);
      if (this.eye !== EYE && !this.stool && !this.stoolEyeT) this.eye += (EYE - this.eye) * Math.min(1, dt * 4);
    }
    this.updateStool(this.rig.position);
    // Sitting on a stool: ease your eyes down to seated height, and back up as you get off.
    if (!this.seated && !this.tween && (this.stool || this.stoolEyeT)) {
      const want = this.stool ? stoolEye(this.stool) : EYE;
      this.eye += (want - this.eye) * Math.min(1, dt * (this.stool ? 3.2 : 4));
      this.stoolEyeT = !!this.stool || Math.abs(this.eye - EYE) > 0.004;
      if (!this.stoolEyeT) this.eye = EYE;
    }
    if (!this.tween) this.applyDesktopCamera();
  }

  /**
   * Which stool you're on (feet over its seat, on the ground, not playing a
   * game, not swimming). Leaving takes a little more than arriving, so you
   * don't flicker on and off at the edge.
   */
  private updateStool(at: THREE.Vector3) {
    if (this.seated || this.tween || this.airborne || this.water !== null) {
      this.stool = null;
      return;
    }
    const s = this.world.seatAt(at.x, at.z, this.stool ? SEAT_STAY : 0);
    this.stool = s && Math.abs(this.feetY - this.world.groundAt(s.x, s.z)) < 0.1 ? s : null;
  }

  /**
   * Somebody pushed you: slide (dx, dz) metres over `seconds`, easing out,
   * stopped by walls like walking is. Stands you up if you were sitting.
   */
  nudge(dx: number, dz: number, seconds = 0.25) {
    if (this.seated) this.stand();
    this.tween = null;
    this.nudgeLeft.set(this.nudgeLeft.x + dx, this.nudgeLeft.y + dz);
    this.nudgeT = Math.max(seconds, 0.05);
  }

  private updateNudge(dt: number) {
    // Ease out: cover the rest in proportion to the time left.
    const k = Math.min(1, (dt / this.nudgeT) * 1.6);
    const sx = this.nudgeLeft.x * k,
      sz = this.nudgeLeft.y * k;
    this.nudgeLeft.multiplyScalar(1 - k);
    this.nudgeT -= dt;
    if (this.nudgeT <= 0 || this.nudgeLeft.lengthSq() < 1e-6) {
      this.nudgeT = 0;
      this.nudgeLeft.set(0, 0);
    }
    const at = this.inXR ? this.headWorld() : this.rig.position;
    const [nx, nz] = this.walkMove(at.x, at.z, sx, sz);
    this.rig.position.x += nx - at.x;
    this.rig.position.z += nz - at.z;
    this.current = null;
  }

  private lastDir = new THREE.Vector2();
  private xrDir = new THREE.Vector2(0, -1);

  private updateXR(dt: number, interaction: Interaction) {
    let moveX = 0,
      moveY = 0,
      turnX = 0;
    for (const { handedness, gamepad } of interaction.gamepads()) {
      const ax = gamepad.axes.length >= 4 ? gamepad.axes[2] : gamepad.axes[0] ?? 0;
      const ay = gamepad.axes.length >= 4 ? gamepad.axes[3] : gamepad.axes[1] ?? 0;
      if (handedness === 'left') {
        moveX = ax;
        moveY = ay;
      } else {
        turnX = ax;
      }
    }
    // Jump: A on the right controller (not while A answers a reply, see replyhud.ts).
    for (const { handedness, gamepad } of interaction.gamepads()) {
      if (handedness !== 'right') continue;
      const a = !!gamepad.buttons[4]?.pressed;
      if (a && !this.aWas && !replyPrompt.busy()) this.jump();
      this.aWas = a;
    }
    // Turning on the right stick: snap (default) or smooth, as chosen in comfort settings.
    if (this.comfort.smoothTurn) {
      if (Math.abs(turnX) > 0.15) {
        const k = (Math.abs(turnX) - 0.15) / 0.85;
        this.rotateAround(this.headWorld(), -Math.sign(turnX) * k * this.comfort.turnSpeed * dt);
        this.turnFlash = Math.max(this.turnFlash, 0.08 * k);
      }
    } else if (Math.abs(turnX) > 0.7 && this.snapReady) {
      this.snapReady = false;
      this.rotateAround(this.headWorld(), (turnX > 0 ? -1 : 1) * this.comfort.snapAngle);
      this.turnFlash = 0.25;
    } else if (Math.abs(turnX) < 0.3) {
      this.snapReady = true;
    }
    // Walking on the left stick, relative to where you look. Analog: a light push
    // strolls, a firm push walks, all the way runs; click the stick in to sprint.
    // Speed eases in and out so it never feels robotic.
    const mag = Math.min(1, Math.hypot(moveX, moveY));
    const dead = 0.15;
    let sprint = false;
    for (const { handedness, gamepad } of interaction.gamepads()) if (handedness === 'left' && gamepad.buttons[3]?.pressed) sprint = true;
    let target = 0;
    if (mag > dead) {
      const k = (mag - dead) / (1 - dead);
      target = k < 0.8 ? 0.35 + (WALK - 0.35) * (k / 0.8) : WALK + (RUN - WALK) * ((k - 0.8) / 0.2);
      if (sprint) target = RUN * 1.25;
      const yaw = this.headYaw();
      const nx = moveX / Math.max(mag, 1e-4),
        ny = moveY / Math.max(mag, 1e-4);
      const fwdX = -Math.sin(yaw),
        fwdZ = -Math.cos(yaw);
      const rightX = Math.cos(yaw),
        rightZ = -Math.sin(yaw);
      this.xrDir.set(fwdX * -ny + rightX * nx, fwdZ * -ny + rightZ * nx).normalize();
    }
    target *= this.waterDrag() * this.crouch.speedFactor;
    this.speedNow += (target - this.speedNow) * Math.min(1, dt * (target > this.speedNow ? 5 : 8));
    let speed = 0;
    if (this.speedNow > 0.03) {
      const head = this.headWorld();
      let dx = this.xrDir.x * this.speedNow * dt,
        dz = this.xrDir.y * this.speedNow * dt;
      if (this.bodies) {
        this.bodies(head.x, head.z, dx, dz, this.bodyStep);
        dx = this.bodyStep.dx;
        dz = this.bodyStep.dz;
      }
      const [hx, hz] = this.walkMove(head.x, head.z, dx, dz);
      this.rig.position.x += hx - head.x;
      this.rig.position.z += hz - head.z;
      speed = Math.hypot(hx - head.x, hz - head.z) / Math.max(dt, 1e-4);
      if (speed < this.speedNow * 0.3) this.speedNow = speed; // walked into something
      if (this.water === null || this.water - this.feetY < 0.25) this.step(speed * dt, this.speedNow > WALK * 1.2, new THREE.Vector3(hx, 0, hz));
      this.current = null;
    }
    this.updateStool(this.headWorld());
    this.turnFlash = Math.max(0, this.turnFlash - dt);
    const want = this.comfort.vignette ? Math.min(0.8, (speed / WALK) * 0.6 + this.turnFlash * 3) : 0;
    const op = (this.vignette.material as THREE.ShaderMaterial).uniforms.opacity;
    op.value += (want - op.value) * Math.min(1, dt * 8);
    this.vignette.visible = op.value > 0.02;
  }
}

export interface Comfort {
  smoothTurn: boolean;
  /** Smooth turn speed, radians per second. */
  turnSpeed: number;
  /** Snap turn step, radians. */
  snapAngle: number;
  /** Darken the edges of your view while moving/turning. */
  vignette: boolean;
  /** Show laser pointers (off: you do everything with your hands, by touch). */
  lasers: boolean;
}

export function loadComfort(): Comfort {
  const d: Comfort = { smoothTurn: false, turnSpeed: 2.2, snapAngle: Math.PI / 6, vignette: true, lasers: false };
  try {
    return { ...d, ...JSON.parse(localStorage.getItem('palazzo-lago.comfort') || '{}') };
  } catch {
    return d;
  }
}

export function saveComfort(c: Comfort) {
  try {
    localStorage.setItem('palazzo-lago.comfort', JSON.stringify(c));
  } catch {
    /* private mode */
  }
}
