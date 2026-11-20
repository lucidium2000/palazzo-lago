import * as THREE from 'three';
import type { Interaction } from './interaction';

/**
 * The player rig. Desktop: a camera with yaw on the rig and pitch on the
 * camera, moved by travel/WASD/drag. VR: the headset drives the camera inside
 * the rig; we move the rig to teleport and snap-turn around the head.
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
}

const desktopSpot = (v: Viewpoint) =>
  v.position.clone().add(new THREE.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw)).multiplyScalar(v.back ?? 0));

const BOUNDS = { minX: -17.5, maxX: 17.5, minZ: -13.5, maxZ: 13.5 };

export class Player {
  readonly rig = new THREE.Group();
  private pitch = 0;
  private eye = 1.6;
  private tween: { from: Viewpoint; to: Viewpoint; t: number; dur: number } | null = null;
  private keys = new Set<string>();
  private snapReady = true;
  current: Viewpoint | null = null;
  onArrive: ((v: Viewpoint) => void) | null = null;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private renderer: THREE.WebGLRenderer,
  ) {
    this.rig.add(camera);
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    renderer.xr.addEventListener('sessionstart', () => {
      camera.position.set(0, 0, 0);
      camera.rotation.set(0, 0, 0);
    });
    renderer.xr.addEventListener('sessionend', () => this.applyDesktopCamera());
  }

  get inXR() {
    return this.renderer.xr.isPresenting;
  }

  attach(interaction: Interaction) {
    interaction.onDrag = (dx, dy) => {
      if (this.inXR) return;
      this.tween = null;
      this.rig.rotation.y += dx * 0.004;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, -1.2, 1.0);
      this.applyDesktopCamera();
    };
  }

  private applyDesktopCamera() {
    if (this.inXR) return;
    this.camera.position.set(0, this.eye, 0);
    this.camera.rotation.set(this.pitch, 0, 0, 'YXZ');
  }

  /** Jump straight to a viewpoint (start-up, VR travel). */
  place(v: Viewpoint) {
    this.tween = null;
    this.current = v;
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
  travel(v: Viewpoint) {
    if (this.inXR) return this.place(v);
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
    this.current = v;
  }

  /** Teleport so the player's head ends up over the given floor point. */
  teleportTo(point: THREE.Vector3) {
    const p = point.clone();
    p.x = THREE.MathUtils.clamp(p.x, BOUNDS.minX, BOUNDS.maxX);
    p.z = THREE.MathUtils.clamp(p.z, BOUNDS.minZ, BOUNDS.maxZ);
    this.current = null;
    if (this.inXR) {
      this.teleportHeadTo(p);
    } else {
      this.travel({ id: 'walk', label: '', position: p, yaw: this.rig.rotation.y, pitch: this.pitch * 0.5, eye: 1.6 });
      this.current = null;
    }
  }

  /** Head position in the world. three.js copies the XR pose into the camera's local transform each frame. */
  private headWorld(): THREE.Vector3 {
    this.rig.updateMatrixWorld(true);
    return this.camera.getWorldPosition(new THREE.Vector3());
  }

  private teleportHeadTo(p: THREE.Vector3, yaw?: number) {
    if (yaw !== undefined) {
      // Turn the rig so the head faces `yaw`, keeping the head where it is, then move.
      const head = this.headWorld();
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()));
      const headYaw = Math.atan2(-dir.x, -dir.z);
      this.rotateAround(head, yaw - headYaw);
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

    if (!this.inXR) {
      // WASD / arrow keys walk on desktop.
      const f = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
      const s = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
      const turn = (this.keys.has('ArrowLeft') ? 1 : 0) - (this.keys.has('ArrowRight') ? 1 : 0);
      if (f || s || turn) {
        this.tween = null;
        this.current = null;
        this.rig.rotation.y += turn * dt * 1.6;
        const yaw = this.rig.rotation.y;
        const speed = 2.4 * dt;
        this.rig.position.x += (-Math.sin(yaw) * f + Math.cos(yaw) * s) * speed;
        this.rig.position.z += (-Math.cos(yaw) * f - Math.sin(yaw) * s) * speed;
        this.rig.position.x = THREE.MathUtils.clamp(this.rig.position.x, BOUNDS.minX, BOUNDS.maxX);
        this.rig.position.z = THREE.MathUtils.clamp(this.rig.position.z, BOUNDS.minZ, BOUNDS.maxZ);
        if (this.eye < 1.6) {
          this.eye = Math.min(1.6, this.eye + dt);
          this.applyDesktopCamera();
        }
      }
      return;
    }

    // VR: snap turn 30 degrees on either thumbstick's X axis.
    let x = 0;
    for (const { gamepad } of interaction.gamepads()) {
      const ax = gamepad.axes.length >= 4 ? gamepad.axes[2] : gamepad.axes[0] ?? 0;
      if (Math.abs(ax) > Math.abs(x)) x = ax;
    }
    if (Math.abs(x) > 0.7 && this.snapReady) {
      this.snapReady = false;
      this.rotateAround(this.headWorld(), x > 0 ? -Math.PI / 6 : Math.PI / 6);
    } else if (Math.abs(x) < 0.3) {
      this.snapReady = true;
    }
  }
}
