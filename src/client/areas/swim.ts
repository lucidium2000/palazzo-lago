import * as THREE from 'three';

/**
 * Water effects for swimming: splash droplets and spreading ripple rings on the
 * surface (one instanced draw each), and the underwater look when your head
 * goes under: a murky blue-green tint over your eyes and every sound
 * muffled through a low-pass filter on the listener.
 */
export class SwimFX {
  private drops: THREE.InstancedMesh;
  private dropState: { p: THREE.Vector3; v: THREE.Vector3; life: number }[] = [];
  private rings: THREE.InstancedMesh;
  private ringState: { p: THREE.Vector3; age: number; size: number }[] = [];
  private overlay: THREE.Mesh;
  private filter: BiquadFilterNode | null = null;
  private under = false;
  private tmp = new THREE.Object3D();
  private static readonly MAX_DROPS = 80;
  private static readonly MAX_RINGS = 12;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    private listener: THREE.AudioListener,
  ) {
    this.drops = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.025, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0xcff6ff, transparent: true, opacity: 0.85 }),
      SwimFX.MAX_DROPS,
    );
    this.drops.count = 0;
    this.drops.frustumCulled = false;
    this.drops.raycast = () => {};
    scene.add(this.drops);
    const ringGeo = new THREE.RingGeometry(0.85, 1, 40);
    ringGeo.rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xdff8ff, transparent: true, opacity: 0.35, depthWrite: false }), SwimFX.MAX_RINGS);
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    this.rings.raycast = () => {};
    scene.add(this.rings);
    // Underwater: murky blue-green, clearer in the middle, darker toward the edges.
    // (No scene fog: switching fog recompiles every shader, a long hitch on Quest.)
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 8, 64, 64, 90);
    grad.addColorStop(0, 'rgba(20,120,140,0.55)');
    grad.addColorStop(1, 'rgba(4,40,60,0.92)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    this.overlay = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.5),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false, depthWrite: false }),
    );
    this.overlay.position.z = -0.11;
    this.overlay.renderOrder = 1999;
    this.overlay.visible = false;
    this.overlay.raycast = () => {};
    camera.add(this.overlay);
  }

  /** A body hitting the water at `at` (strength 0..1). */
  splash(at: THREE.Vector3, strength: number) {
    const n = Math.round(14 + strength * 40);
    for (let i = 0; i < n; i++) {
      if (this.dropState.length >= SwimFX.MAX_DROPS) this.dropState.shift();
      const a = Math.random() * Math.PI * 2;
      const out = 0.6 + Math.random() * 1.6 * strength;
      this.dropState.push({
        p: at.clone().add(new THREE.Vector3(Math.cos(a) * 0.25, 0.02, Math.sin(a) * 0.25)),
        v: new THREE.Vector3(Math.cos(a) * out, 1.6 + Math.random() * 3.2 * strength, Math.sin(a) * out),
        life: 1.4,
      });
    }
    this.ripple(at, 0.6 + strength);
    this.ripple(at, 0.3 + strength * 0.5);
  }

  /** A ring spreading on the surface from `at`. */
  ripple(at: THREE.Vector3, size = 0.5) {
    if (this.ringState.length >= SwimFX.MAX_RINGS) this.ringState.shift();
    this.ringState.push({ p: at.clone().setY(at.y + 0.012), age: 0, size });
  }

  /** Per frame: move droplets and rings, switch the underwater look on/off. */
  update(dt: number, underwater: boolean) {
    // Droplets: fall under gravity, vanish when they drop back below the surface they left.
    let k = 0;
    for (const d of this.dropState) {
      d.life -= dt;
      d.v.y -= 9.81 * dt;
      d.p.addScaledVector(d.v, dt);
      if (d.life <= 0 || d.v.y < 0 && d.p.y < -0.2) continue;
      this.tmp.position.copy(d.p);
      this.tmp.scale.setScalar(1);
      this.tmp.updateMatrix();
      this.drops.setMatrixAt(k++, this.tmp.matrix);
    }
    this.dropState = this.dropState.filter((d) => d.life > 0 && !(d.v.y < 0 && d.p.y < -0.2));
    this.drops.count = k;
    if (k) this.drops.instanceMatrix.needsUpdate = true;
    // Rings grow and fade (their fade is baked into scale: thin out as they widen).
    let r = 0;
    for (const g of this.ringState) {
      g.age += dt;
      if (g.age > 2.2) continue;
      const s = g.size * (0.3 + g.age * 1.1);
      this.tmp.position.copy(g.p);
      this.tmp.scale.set(s, 1, s);
      this.tmp.updateMatrix();
      this.rings.setMatrixAt(r++, this.tmp.matrix);
    }
    this.ringState = this.ringState.filter((g) => g.age <= 2.2);
    this.rings.count = r;
    if (r) this.rings.instanceMatrix.needsUpdate = true;
    (this.rings.material as THREE.MeshBasicMaterial).opacity = 0.32;

    if (underwater !== this.under) {
      this.under = underwater;
      this.overlay.visible = underwater;
      if (underwater) {
        try {
          const ctx = this.listener.context;
          this.filter ??= Object.assign(ctx.createBiquadFilter(), { type: 'lowpass' as BiquadFilterType });
          this.filter.frequency.value = 420;
          this.listener.setFilter(this.filter);
        } catch {
          /* audio not started yet */
        }
      } else {
        try {
          if (this.listener.getFilter()) this.listener.removeFilter();
        } catch {
          /* nothing to remove */
        }
      }
    }
  }
}
