import * as THREE from 'three';
import type { Interaction } from './interaction';
import type { Surface, World } from './world';

/**
 * The player. Desktop: first-person walking (mouse-look with pointer lock, or
 * drag to look), WASD, Shift to hurry, collisions, footsteps and a little head
 * bob; sit down at a game for a framed view. VR: the headset drives the camera
 * inside the rig; the left stick walks (with a comfort vignette), the right
 * stick snap-turns, and pointing at the floor still teleports.
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
const GRAVITY = 9.81;
/** Take-off speed for a ~0.45 m jump. */
const JUMP_V = Math.sqrt(2 * GRAVITY * 0.45);
/** Highest ledge you can walk up (a stair, a curb). */
const STEP_UP = 0.36;

export class Player {
  readonly rig = new THREE.Group();
  private pitch = 0;
  private eye = EYE;
  private tween: { from: Viewpoint; to: Viewpoint; t: number; dur: number } | null = null;
  private keys = new Set<string>();
  private snapReady = true;
  private stride = 0;
  private bob = 0;
  private speedNow = 0;
  private vignette: THREE.Mesh;
  private turnFlash = 0;
  /** The game the player is sitting at (desktop), if any. */
  seated: Viewpoint | null = null;
  current: Viewpoint | null = null;
  onArrive: ((v: Viewpoint) => void) | null = null;
  onStep: ((surface: Surface, run: boolean) => void) | null = null;
  onStand: (() => void) | null = null;
  /** Height of your feet (0 on the casino floor; lower in the pool). */
  feetY = 0;
  private velY = 0;
  private airborne = false;
  private jumpQueued = false;
  private diving = false;
  private aWas = false;
  private strokeT = 0;
  private swimT = 0;
  /** Water surface over you (null when dry), whether you're floating, and whether your head is under. */
  water: number | null = null;
  swimming = false;
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
    });
    renderer.xr.addEventListener('sessionend', () => this.applyDesktopCamera());

    // Comfort vignette: a soft dark ring in front of the eyes while moving in VR.
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(128, 128, 40, 128, 128, 128);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    this.vignette = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.5),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
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
    this.camera.position.set(0, this.eye + Math.sin(this.bob * 2) * 0.018 * Math.min(1, this.speedNow / WALK), 0);
    this.camera.rotation.set(this.pitch, 0, Math.sin(this.bob) * 0.004 * Math.min(1, this.speedNow / WALK), 'YXZ');
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
    const ok = (nx: number, nz: number) => this.world.groundAt(nx, nz) <= this.feetY + STEP_UP;
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

  /** Speed factor for wading or swimming. */
  private waterDrag() {
    if (this.water === null) return 1;
    if (this.swimming) return 0.55;
    const depth = this.water - this.feetY;
    return depth > 0.6 ? 0.5 : depth > 0.25 ? 0.75 : 1;
  }

  /** Gravity, jumping, landing, floating and swimming: runs after the horizontal move. */
  private updateVertical(dt: number, at: THREE.Vector3, moving: boolean) {
    const ground = this.world.groundAt(at.x, at.z);
    const water = this.world.waterAt(at.x, at.z);
    this.water = water;
    const eyeH = this.eyeHeight();
    // Floating: feet hang so your eyes ride just above the surface.
    const float = water !== null ? water + 0.16 - eyeH : -Infinity;
    const deep = water !== null && ground < float - 0.05;
    const crouchDive = this.keys.has('KeyC') && !this.inXR;
    this.diving = deep && crouchDive;
    const prevFeet = this.feetY;

    if (this.jumpQueued) {
      this.jumpQueued = false;
      if (water !== null && (deep || water - this.feetY > 0.9)) {
        // Haul out at the edge if you're facing a wall you could climb.
        const fwd = this.inXR ? new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion())) : new THREE.Vector3(-Math.sin(this.rig.rotation.y), 0, -Math.cos(this.rig.rotation.y));
        fwd.y = 0;
        fwd.normalize();
        const edge = at.clone().addScaledVector(fwd, 0.55);
        const top = this.world.groundAt(edge.x, edge.z);
        if (top > this.feetY + STEP_UP && top <= (water ?? 0) + 0.4 && this.world.isFree(edge.x, edge.z, RADIUS)) {
          this.moveBodyTo(edge);
          this.feetY = top;
          this.velY = 0;
          this.airborne = false;
          this.onSplash?.(at.clone().setY(water ?? 0), 0.35);
          this.applyY();
          return;
        }
        this.velY = Math.max(this.velY, 1.6); // a kick up in the water
        this.airborne = true;
      } else if (!this.airborne) {
        this.velY = JUMP_V;
        this.airborne = true;
      }
    }

    const rest = deep && !this.diving ? Math.max(ground, float) : ground;
    if (this.airborne || this.feetY > rest + 0.01) {
      this.airborne = true;
      this.velY -= GRAVITY * dt;
      if (water !== null && this.feetY + 0.6 < water) {
        // In the water: heavy drag, and buoyancy lifting you to the surface.
        this.velY *= Math.exp(-3.5 * dt);
        if (deep && !this.diving && this.feetY < float) this.velY += (float - this.feetY) * 14 * dt;
      }
      this.feetY += this.velY * dt;
      if (this.feetY <= rest && this.velY <= 0) {
        if (!deep && this.velY < -2.2) this.onLand?.(at.clone().setY(rest), Math.min(1, -this.velY / 6));
        this.feetY = rest;
        this.velY = 0;
        this.airborne = false;
      } else if (deep && !this.diving && Math.abs(this.feetY - float) < 0.03 && Math.abs(this.velY) < 0.4) {
        this.airborne = false;
        this.velY = 0;
      }
    } else {
      this.feetY += (rest - this.feetY) * Math.min(1, dt * 6);
    }
    // Entering the water: a splash sized to how fast you hit it.
    if (water !== null && prevFeet > water - 0.15 && this.feetY <= water - 0.15) {
      const v = Math.max(-this.velY, this.speedNow * 0.5);
      if (v > 0.6) this.onSplash?.(at.clone().setY(water), THREE.MathUtils.clamp(v / 5, 0.25, 1));
    }
    this.swimming = deep && !this.diving;
    // Strokes and ripples while you move through the water.
    if (water !== null && water - this.feetY > 0.5 && moving) {
      this.strokeT -= dt;
      if (this.strokeT <= 0) {
        this.strokeT = this.swimming ? 0.95 : 0.7;
        this.onStroke?.(at.clone().setY(water));
      }
    }
    // A gentle bob while floating.
    this.swimT += dt;
    const bob = this.swimming && !this.airborne ? Math.sin(this.swimT * 1.7) * 0.025 : 0;
    this.applyY(bob);
    const head = (this.inXR ? this.camera.getWorldPosition(new THREE.Vector3()).y : this.feetY + this.eye + bob);
    this.underwater = water !== null && head < water - 0.03;
  }

  private applyY(bob = 0) {
    this.rig.position.y = this.feetY + bob;
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
    this.feetY = this.world.groundAt(v.position.x, v.position.z);
    this.velY = 0;
    this.airborne = false;
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
    if (!this.inXR) this.updateDesktop(dt);
    else this.updateXR(dt, interaction);
    if (this.nudgeT > 0) this.updateNudge(dt);
    if (!this.tween && !this.seated) this.updateVertical(dt, this.feet(), this.speedNow > 0.2);
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
    const target = (push > 0.05 ? (run ? RUN : WALK) * (stickMag > 0.15 ? Math.max(0.35, push) : 1) : 0) * this.waterDrag();
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
      if (this.eye !== EYE) this.eye += (EYE - this.eye) * Math.min(1, dt * 4);
    }
    if (!this.tween) this.applyDesktopCamera();
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
    // Jump: A on the right controller.
    for (const { handedness, gamepad } of interaction.gamepads()) {
      if (handedness !== 'right') continue;
      const a = !!gamepad.buttons[4]?.pressed;
      if (a && !this.aWas) this.jump();
      this.aWas = a;
    }
    // Snap turn on the right stick.
    if (Math.abs(turnX) > 0.7 && this.snapReady) {
      this.snapReady = false;
      this.rotateAround(this.headWorld(), turnX > 0 ? -Math.PI / 6 : Math.PI / 6);
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
    target *= this.waterDrag();
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
    this.turnFlash = Math.max(0, this.turnFlash - dt);
    const want = Math.min(0.9, (speed / WALK) * 0.75 + this.turnFlash * 3);
    const mat = this.vignette.material as THREE.MeshBasicMaterial;
    mat.opacity += (want - mat.opacity) * Math.min(1, dt * 8);
    this.vignette.visible = mat.opacity > 0.02;
  }
}
