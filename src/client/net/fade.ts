import * as THREE from 'three';

/**
 * A short fade to black and back, worn on the camera (works on a screen and
 * in the headset alike): dims out, runs the jump while you can't see it,
 * dims back in. Driven by `update(dt)` so it keeps time in VR too.
 */
export class Fader {
  private mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  private k = 0;
  private dir: 0 | 1 | -1 = 0;
  private mid: (() => void) | null = null;
  private hold = 0;

  constructor(
    camera: THREE.Object3D,
    private dur = 0.22,
  ) {
    this.mat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 8), this.mat);
    this.mesh.renderOrder = 9999;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.raycast = () => {};
    this.mesh.userData.noLand = true;
    camera.add(this.mesh);
  }

  get busy() {
    return this.dir !== 0;
  }

  /** Fade out, call `fn` in the dark, fade back in. */
  run(fn: () => void) {
    if (this.dir !== 0) return false;
    this.mid = fn;
    this.dir = 1;
    this.mesh.visible = true;
    return true;
  }

  update(dt: number) {
    if (this.dir === 0) return;
    if (this.dir === 1) {
      this.k = Math.min(1, this.k + dt / this.dur);
      if (this.k >= 1) {
        const fn = this.mid;
        this.mid = null;
        try {
          fn?.();
        } finally {
          this.dir = -1;
          this.hold = 0.08;
        }
      }
    } else if ((this.hold -= dt) <= 0) {
      this.k = Math.max(0, this.k - dt / this.dur);
      if (this.k <= 0) {
        this.dir = 0;
        this.mesh.visible = false;
      }
    }
    this.mat.opacity = this.k;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
