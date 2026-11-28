import * as THREE from 'three';

/**
 * Hit sparks: a small, quick burst where a punch lands (warm white for a
 * clean hit, a bigger gold burst for a crit, a few dull flecks off a block),
 * thrown along the punch. Subtle: a quarter of a second, a few centimetres.
 * One Points object, a fixed pool, no allocation per hit.
 */

const N = 96;
const LIFE = 0.26;

export class HitSparks {
  private pos = new Float32Array(N * 3);
  private vel = new Float32Array(N * 3);
  private col = new Float32Array(N * 3);
  private base = new Float32Array(N * 3);
  private age = new Float32Array(N).fill(99);
  private geo = new THREE.BufferGeometry();
  private pts: THREE.Points;
  private next = 0;
  private live = 0;

  constructor(scene: THREE.Scene) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.pts = new THREE.Points(
      this.geo,
      new THREE.PointsMaterial({ size: 0.022, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, sizeAttenuation: true }),
    );
    this.pts.frustumCulled = false;
    this.pts.renderOrder = 60;
    this.pts.raycast = () => {};
    this.pts.visible = false;
    scene.add(this.pts);
  }

  /** A burst at `at`, thrown along `dir` (world; any length). */
  burst(at: THREE.Vector3, dir: THREE.Vector3, kind: 'hit' | 'crit' | 'block') {
    const n = kind === 'crit' ? 18 : kind === 'hit' ? 9 : 5;
    const sp = kind === 'crit' ? 2.6 : kind === 'hit' ? 1.7 : 1.0;
    const l = dir.length() || 1;
    const [r, g, b] = kind === 'crit' ? [1, 0.82, 0.4] : kind === 'hit' ? [1, 0.95, 0.85] : [0.55, 0.5, 0.45];
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % N;
      const o = i * 3;
      this.pos[o] = at.x;
      this.pos[o + 1] = at.y;
      this.pos[o + 2] = at.z;
      // Mostly along the punch, sprayed out.
      const rx = Math.random() * 2 - 1,
        ry = Math.random() * 2 - 1,
        rz = Math.random() * 2 - 1;
      const s = sp * (0.4 + Math.random() * 0.8);
      this.vel[o] = ((dir.x / l) * 0.8 + rx) * s;
      this.vel[o + 1] = ((dir.y / l) * 0.8 + ry + 0.3) * s;
      this.vel[o + 2] = ((dir.z / l) * 0.8 + rz) * s;
      this.base[o] = r;
      this.base[o + 1] = g;
      this.base[o + 2] = b;
      this.age[i] = 0;
    }
    this.live = LIFE;
    this.pts.visible = true;
  }

  update(dt: number) {
    if (this.live <= 0) return;
    this.live -= dt;
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      if (this.age[i] >= LIFE) {
        this.col[o] = this.col[o + 1] = this.col[o + 2] = 0;
        continue;
      }
      this.age[i] += dt;
      const k = Math.max(0, 1 - this.age[i] / LIFE);
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      this.vel[o + 1] -= 6 * dt;
      this.col[o] = this.base[o] * k;
      this.col[o + 1] = this.base[o + 1] * k;
      this.col[o + 2] = this.base[o + 2] * k;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    if (this.live <= 0) this.pts.visible = false;
  }

  dispose() {
    this.pts.removeFromParent();
    this.geo.dispose();
  }
}
