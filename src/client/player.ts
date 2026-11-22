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
const RADIUS = 0.25;

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
  /** Analog walk input from a touch joystick: x right, y forward, each -1..1. */
  readonly stick = new THREE.Vector2();

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

  /** Feet position (desktop rig position, or the point under the VR head). */
  feet(): THREE.Vector3 {
    if (!this.inXR) return this.rig.position.clone().setY(0);
    return this.headWorld().setY(0);
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

    if (!this.inXR) return this.updateDesktop(dt);
    this.updateXR(dt, interaction);
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
    const target = push > 0.05 ? (run ? RUN : WALK) * (stickMag > 0.15 ? Math.max(0.35, push) : 1) : 0;
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
      const dx = this.lastDir.x * this.speedNow * dt,
        dz = this.lastDir.y * this.speedNow * dt;
      const p = this.rig.position;
      const [nx, nz] = this.world.move(p.x, p.z, dx, dz, RADIUS);
      const moved = Math.hypot(nx - p.x, nz - p.z);
      p.x = nx;
      p.z = nz;
      this.bob += moved * (run ? 5.4 : 6.6);
      this.step(moved, run, p);
      if (this.eye !== EYE) this.eye += (EYE - this.eye) * Math.min(1, dt * 4);
    }
    if (!this.tween) this.applyDesktopCamera();
  }

  private lastDir = new THREE.Vector2();

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
    // Snap turn on the right stick.
    if (Math.abs(turnX) > 0.7 && this.snapReady) {
      this.snapReady = false;
      this.rotateAround(this.headWorld(), turnX > 0 ? -Math.PI / 6 : Math.PI / 6);
      this.turnFlash = 0.25;
    } else if (Math.abs(turnX) < 0.3) {
      this.snapReady = true;
    }
    // Smooth walking on the left stick, relative to where you look.
    const mag = Math.hypot(moveX, moveY);
    const dead = 0.18;
    let speed = 0;
    if (mag > dead) {
      const yaw = this.headYaw();
      const amt = ((mag - dead) / (1 - dead)) * (mag > 0.95 ? RUN * 0.75 : WALK);
      const nx = moveX / mag,
        ny = moveY / mag;
      // Stick up (negative Y) walks forward.
      const fwdX = -Math.sin(yaw),
        fwdZ = -Math.cos(yaw);
      const rightX = Math.cos(yaw),
        rightZ = -Math.sin(yaw);
      const dirX = fwdX * -ny + rightX * nx;
      const dirZ = fwdZ * -ny + rightZ * nx;
      const head = this.headWorld();
      const [hx, hz] = this.world.move(head.x, head.z, dirX * amt * dt, dirZ * amt * dt, RADIUS);
      this.rig.position.x += hx - head.x;
      this.rig.position.z += hz - head.z;
      speed = Math.hypot(hx - head.x, hz - head.z) / Math.max(dt, 1e-4);
      this.step(speed * dt, mag > 0.95, new THREE.Vector3(hx, 0, hz));
      this.current = null;
    }
    this.turnFlash = Math.max(0, this.turnFlash - dt);
    const want = Math.min(0.9, (speed / WALK) * 0.75 + this.turnFlash * 3);
    const mat = this.vignette.material as THREE.MeshBasicMaterial;
    mat.opacity += (want - mat.opacity) * Math.min(1, dt * 8);
    this.vignette.visible = mat.opacity > 0.02;
  }
}
