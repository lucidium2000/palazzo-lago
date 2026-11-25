import * as THREE from 'three';
import type { Beat } from './beat';

/**
 * The party's lights, all cheap enough for a Quest (a handful of draw calls,
 * instanced, unlit, additive, no shadows):
 *  - an LED dance floor in front of the DJ (one shader quad: tiles pulsing in
 *    patterns that change every 8 bars, filling up through the build, a white
 *    flash when the drop lands),
 *  - moving-head beams (one instanced mesh of additive cones): four from the
 *    booth into the sky, four from the light poles sweeping the floor and the pool,
 *  - lasers fanning out over the pool on the drop (one instanced mesh),
 *  - bursts (points): confetti cannons and CO2 jets on the drop, a shower of
 *    confetti over you when you throw your hands up.
 * The pool's underwater lights and the LED wall follow the music too.
 */

export const FLOOR = { x0: 46.8, x1: 53.2, z0: -31.4, z1: -28.0, cols: 8, rows: 4 };

/** Colours of the 8-bar phrases (hues). */
const PHRASE_HUES = [0.9, 0.53, 0.76, 0.08, 0.6, 0.97, 0.45, 0.82];
export const phraseHue = (bar: number) => PHRASE_HUES[Math.floor(bar / 8) % PHRASE_HUES.length];

const hueGLSL = /* glsl */ `vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }`;

function floorMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      beats: { value: 0 },
      pulse: { value: 0 },
      intensity: { value: 1 },
      build: { value: 0 },
      flash: { value: 0 },
      section: { value: 0 },
      pattern: { value: 0 },
      hue0: { value: 0.9 },
      time: { value: 0 },
    },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float beats, pulse, intensity, build, flash, section, pattern, hue0, time;
      varying vec2 vUv;
      ${hueGLSL}
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec2 g = vUv * vec2(${FLOOR.cols}.0, ${FLOOR.rows}.0);
        vec2 id = floor(g);
        vec2 f = fract(g);
        float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
        float inset = smoothstep(0.035, 0.08, edge);
        float b = floor(beats);
        float ph = fract(beats);
        vec2 c = id - vec2(3.5, 1.5);
        float lit = 0.0;
        float h = hue0;
        if (section < 0.5) {
          // The drop: a pattern per 8 bars, on the beat.
          if (pattern < 0.5) lit = mod(id.x + id.y + b, 2.0);
          else if (pattern < 1.5) { float r = length(c * vec2(1.0, 1.7)); lit = 1.0 - smoothstep(0.0, 0.9, abs(r - ph * 5.5)); }
          else if (pattern < 2.5) { float col = mod(b * 2.0 + floor(ph * 2.0), 8.0); lit = max(step(abs(id.x - col), 0.5), step(abs(7.0 - id.x - col), 0.5)); }
          else lit = step(0.5, hash(id + b * 1.7));
          lit = lit * (0.3 + 0.7 * pulse) + 0.08;
          h += (id.x + id.y) * 0.035 + mod(b, 4.0) * 0.02;
        } else if (section < 1.5) {
          // Breakdown: slow breathing colour.
          lit = 0.18 + 0.14 * sin(time * 1.3 + id.x * 0.7 + id.y * 1.1);
          h += sin(time * 0.2 + id.x * 0.15) * 0.08;
        } else {
          // Build: rows fill from the front toward the DJ, flickering faster at the end.
          float rows = build * 4.6;
          lit = step(id.y, rows - 0.6) * 0.6 + 0.12;
          float rate = build > 0.75 ? 4.0 : build > 0.5 ? 2.0 : 1.0;
          lit *= 0.55 + 0.45 * step(0.5, fract(beats * rate));
          h += build * 0.3;
        }
        vec3 col = hue(fract(h)) * lit * (0.5 + 1.3 * intensity);
        col = mix(col, vec3(1.6), flash * (0.6 + 0.4 * hash(id)));
        // Glass tiles: dark gaps, a faint sheen.
        vec3 glass = vec3(0.012, 0.012, 0.02) + 0.03 * (1.0 - f.y);
        gl_FragColor = vec4(mix(glass, glass + col * 1.5, inset), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/** A vertical gradient (bright at uv.y = 1) for the beams' and lasers' falloff. */
function gradientTex(power: number) {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const g = c.getContext('2d')!;
  const img = g.createImageData(4, 128);
  for (let y = 0; y < 128; y++) {
    const v = Math.round(255 * Math.pow(1 - y / 127, power));
    for (let x = 0; x < 4; x++) img.data.set([v, v, v, 255], (y * 4 + x) * 4);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  return t;
}

// --- Bursts: confetti, CO2, the shower over you --------------------------------------

interface BurstParams {
  count: number;
  life: number;
  up: number;
  spread: number;
  drag: number;
  grav: number;
  size: number;
  flutter: number;
  grow: number;
  confetti: boolean;
}

const BURST_VERT = /* glsl */ `
  uniform float uT, uLife, uUp, uSpread, uDrag, uGrav, uSize, uScale, uFlutter, uGrow, uFloor, uSide;
  uniform vec3 uA, uB, uDir;
  attribute vec4 seed;
  varying vec3 vCol;
  varying float vA;
  varying float vSpin;
  ${hueGLSL}
  void main() {
    float t = uT - seed.w * 0.12;
    float tt = max(t, 0.0);
    vec3 o = seed.x < 0.5 ? uA : uB;
    float ang = seed.y * 6.2831853;
    float r = sqrt(seed.z);
    vec3 v0 = vec3(cos(ang) * r * uSpread, uUp * (0.7 + 0.6 * fract(seed.x * 7.31)), sin(ang) * r * uSpread) + uDir * uSide * (0.6 + 0.8 * fract(seed.z * 5.7));
    float e = (1.0 - exp(-uDrag * tt)) / uDrag;
    vec3 p = o + v0 * e;
    p.y -= uGrav / uDrag * (tt - e);
    float fl = uFlutter * min(tt * 0.6, 1.0);
    p.x += sin(tt * 2.3 + seed.y * 40.0) * 0.3 * fl;
    p.z += cos(tt * 1.7 + seed.z * 40.0) * 0.3 * fl;
    p.y = max(p.y, uFloor + 0.01 + seed.w * 0.01);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float life = clamp(1.0 - t / uLife, 0.0, 1.0);
    vA = step(0.0, t) * smoothstep(0.0, 0.2, life);
    gl_PointSize = uSize * uScale / max(0.2, -mv.z) * (0.7 + 0.6 * fract(seed.y * 13.1)) * (1.0 + tt * uGrow);
    vSpin = tt * (4.0 + seed.z * 8.0) + seed.x * 10.0;
    float pick = fract(seed.w * 17.3);
    vCol = pick < 0.22 ? vec3(1.0, 0.78, 0.25) : pick < 0.3 ? vec3(1.0) : hue(fract(seed.y * 3.7));
  }`;

const CONFETTI_FRAG = /* glsl */ `
  varying vec3 vCol;
  varying float vA;
  varying float vSpin;
  void main() {
    if (vA < 0.01) discard;
    vec2 q = gl_PointCoord - 0.5;
    float c = cos(vSpin), s = sin(vSpin);
    q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    float flip = abs(cos(vSpin * 1.3));
    if (abs(q.x) > 0.42 || abs(q.y) > 0.42 * (0.25 + 0.75 * flip) * 0.45) discard;
    gl_FragColor = vec4(vCol * (0.55 + 0.9 * flip), 1.0);
    #include <colorspace_fragment>
  }`;

const FOG_FRAG = /* glsl */ `
  varying float vA;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float d = 1.0 - dot(q, q) * 4.0;
    if (d <= 0.0 || vA < 0.01) discard;
    gl_FragColor = vec4(vec3(0.9, 0.95, 1.0) * d * d * 0.06 * vA, 1.0);
  }`;

export class Burst {
  readonly points: THREE.Points;
  private mat: THREE.ShaderMaterial;
  private t = 1e9;

  constructor(
    parent: THREE.Object3D,
    readonly p: BurstParams,
  ) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(p.count * 3), 3));
    const seeds = new Float32Array(p.count * 4);
    let s = 7 + p.count;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
    geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uT: { value: 0 },
        uLife: { value: p.life },
        uUp: { value: p.up },
        uSpread: { value: p.spread },
        uDrag: { value: p.drag },
        uGrav: { value: p.grav },
        uSize: { value: p.size },
        uScale: { value: 600 },
        uFlutter: { value: p.flutter },
        uGrow: { value: p.grow },
        uFloor: { value: 0 },
        uSide: { value: 0 },
        uA: { value: new THREE.Vector3() },
        uB: { value: new THREE.Vector3() },
        uDir: { value: new THREE.Vector3(0, 0, 1) },
      },
      vertexShader: BURST_VERT,
      fragmentShader: p.confetti ? CONFETTI_FRAG : FOG_FRAG,
      transparent: !p.confetti,
      depthWrite: p.confetti,
      blending: p.confetti ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.raycast = () => {};
    parent.add(this.points);
  }

  get active() {
    return this.points.visible;
  }

  /** Fires from one or two origins; `dir`/`side`: a horizontal push (cannons aimed over the floor). */
  fire(a: THREE.Vector3, b = a, opts: { dir?: THREE.Vector3; side?: number; floor?: number } = {}) {
    const u = this.mat.uniforms;
    u.uA.value.copy(a);
    u.uB.value.copy(b);
    if (opts.dir) u.uDir.value.copy(opts.dir);
    u.uSide.value = opts.side ?? 0;
    u.uFloor.value = opts.floor ?? 0;
    this.t = 0;
    this.points.visible = true;
  }

  update(dt: number, scale: number) {
    if (!this.points.visible) return;
    this.t += dt;
    this.mat.uniforms.uT.value = this.t;
    this.mat.uniforms.uScale.value = scale;
    if (this.t > this.p.life + 0.2) this.points.visible = false;
  }
}

// --- The rig of lights ---------------------------------------------------------------

export interface PoolLights {
  water: THREE.ShaderMaterial;
  led: THREE.ShaderMaterial;
  tile: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  glow: THREE.MeshBasicMaterial;
}

interface Head {
  pos: THREE.Vector3;
  /** Rest aim (yaw about +y from +z, pitch from horizontal, radians), length, end radius. */
  yaw: number;
  pitch: number;
  len: number;
  rad: number;
  sky: boolean;
  k: number;
}

export class PartyLights {
  readonly root = new THREE.Group();
  private floorMat = floorMaterial();
  private beams: THREE.InstancedMesh;
  private lasers: THREE.InstancedMesh;
  private heads: Head[] = [];
  readonly confetti: Burst;
  readonly co2: Burst;
  readonly shower: Burst;
  private flash = 0;
  private time = 0;
  private dummy = new THREE.Object3D();
  private col = new THREE.Color();
  private baseTile: THREE.Color;
  private baseFloor: THREE.Color;
  private baseGlow: THREE.Color;
  private q = new THREE.Quaternion();
  private dir = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private dj: { x: number; z: number },
    private pool: PoolLights,
    /** Light poles near the DJ that carry moving heads. */
    poles: [number, number][],
  ) {
    this.root.name = 'party-lights';
    scene.add(this.root);
    // Dance floor (flush with the deck).
    const F = FLOOR;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(F.x1 - F.x0, F.z1 - F.z0), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((F.x0 + F.x1) / 2, 0.008, (F.z0 + F.z1) / 2);
    floor.raycast = () => {};
    this.root.add(floor);

    // Moving heads: four on the booth into the sky, two on each pole over the floor and the pool.
    for (let k = 0; k < 4; k++) this.heads.push({ pos: new THREE.Vector3(dj.x - 2.2 + k * 1.45, 3.7, dj.z - 1.2), yaw: 0, pitch: Math.PI / 2, len: 16, rad: 0.9, sky: true, k });
    poles.forEach(([x, z], i) => {
      for (let j = 0; j < 2; j++) {
        const toward = Math.atan2(dj.x - x, dj.z + 5 - z);
        this.heads.push({ pos: new THREE.Vector3(x + (j - 0.5) * 0.3, 4.9, z), yaw: toward + (j ? 0.35 : -0.35) * (i ? -1 : 1), pitch: -0.45, len: 15, rad: 0.75, sky: false, k: 4 + i * 2 + j });
      }
    });
    const beamGeo = new THREE.ConeGeometry(1, 1, 16, 1, true).translate(0, -0.5, 0).rotateX(Math.PI);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      alphaMap: gradientTex(1.6),
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.beams = new THREE.InstancedMesh(beamGeo, beamMat, this.heads.length);
    this.beams.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.heads.length * 3), 3);
    this.beams.frustumCulled = false;
    this.beams.raycast = () => {};
    this.root.add(this.beams);

    // Lasers: thin crossed strips from the top of the booth.
    const strip = (rot: number) => new THREE.PlaneGeometry(0.03, 1).translate(0, 0.5, 0).rotateY(rot);
    const lg = new THREE.BufferGeometry();
    {
      const a = strip(0),
        b = strip(Math.PI / 2);
      const pos = new Float32Array([...(a.toNonIndexed().attributes.position.array as Float32Array), ...(b.toNonIndexed().attributes.position.array as Float32Array)]);
      const uv = new Float32Array([...(a.toNonIndexed().attributes.uv.array as Float32Array), ...(b.toNonIndexed().attributes.uv.array as Float32Array)]);
      // Bright at the source (uv.y = 0 at the start of the strip): flip v.
      for (let i = 1; i < uv.length; i += 2) uv[i] = 1 - uv[i];
      lg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      lg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    const laserMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      alphaMap: gradientTex(0.6),
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.lasers = new THREE.InstancedMesh(lg, laserMat, 14);
    this.lasers.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(14 * 3), 3);
    this.lasers.frustumCulled = false;
    this.lasers.raycast = () => {};
    this.lasers.count = 0;
    this.root.add(this.lasers);

    this.confetti = new Burst(this.root, { count: 900, life: 10, up: 11, spread: 3.2, drag: 1.9, grav: 1.3, size: 0.05, flutter: 1, grow: 0, confetti: true });
    this.co2 = new Burst(this.root, { count: 160, life: 2.4, up: 16, spread: 0.9, drag: 3.2, grav: 1.5, size: 0.45, flutter: 0.4, grow: 0.9, confetti: false });
    this.shower = new Burst(this.root, { count: 260, life: 7, up: 4.2, spread: 2.6, drag: 2.2, grav: 1.2, size: 0.045, flutter: 1, grow: 0, confetti: true });

    this.baseTile = pool.tile.emissive.clone();
    this.baseFloor = pool.floor.emissive.clone();
    this.baseGlow = pool.glow.color.clone();
  }

  /** The drop lands: flash, confetti cannons, CO2. */
  drop(big: boolean) {
    this.flash = 1;
    const d = this.dj;
    this.co2.fire(new THREE.Vector3(d.x - 2.6, 2.6, d.z - 0.5), new THREE.Vector3(d.x + 2.6, 2.6, d.z - 0.5));
    if (big) this.confetti.fire(new THREE.Vector3(d.x - 3.1, 1.2, d.z + 0.8), new THREE.Vector3(d.x + 3.1, 1.2, d.z + 0.8), { dir: new THREE.Vector3(0, 0, 1), side: 2.2 });
  }

  /** Confetti showering down over someone (you, raising your hands on the drop). */
  showerAt(at: THREE.Vector3, floorY = 0) {
    const o = at.clone();
    o.y += 0.4;
    this.shower.fire(o, o, { floor: floorY });
  }

  update(dt: number, b: Beat, pointScale: number) {
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt * 1.6);
    const sectionId = b.section === 'drop' ? 0 : b.section === 'break' ? 1 : 2;
    const u = this.floorMat.uniforms;
    u.beats.value = b.beats;
    u.pulse.value = b.pulse;
    u.intensity.value = b.intensity;
    u.build.value = b.build;
    u.flash.value = this.flash;
    u.section.value = sectionId;
    u.pattern.value = Math.floor(b.bar / 8) % 4;
    u.hue0.value = phraseHue(b.bar);
    u.time.value = this.time;

    // Moving heads.
    const hue = phraseHue(b.bar);
    const ph = b.beats;
    this.heads.forEach((h, i) => {
      let yaw = h.yaw,
        pitch = h.pitch,
        bright = 0.5;
      const s = h.k % 2 ? 1 : -1;
      if (h.sky) {
        // Into the sky: fans that open and close with the bar on the drop, slow drifts in the breakdown.
        let tilt: number, roll: number;
        if (b.section === 'drop') {
          tilt = Math.sin((ph / 4) * Math.PI * 2 + h.k * 0.4) * 0.55 * s;
          roll = Math.sin((ph / 8) * Math.PI * 2) * 0.35;
          bright = 0.55 + 0.45 * b.pulse;
        } else if (b.section === 'break') {
          tilt = Math.sin(this.time * 0.35 + h.k) * 0.4;
          roll = Math.cos(this.time * 0.27 + h.k * 1.3) * 0.3;
          bright = 0.35;
        } else {
          // Build: closing into a column, flickering faster.
          tilt = (1 - b.build) * Math.sin(this.time * 0.8 + h.k) * 0.5;
          roll = 0;
          bright = 0.4 + 0.4 * b.build * (b.build > 0.75 ? Math.round(0.5 + 0.5 * Math.sin(ph * Math.PI * 8)) : 1);
        }
        this.dir.set(Math.sin(tilt), Math.cos(tilt) * Math.cos(roll), Math.sin(roll)).normalize();
      } else {
        // Over the floor and across the pool: figure-eights on the drop, slow sweeps otherwise.
        if (b.section === 'drop') {
          yaw += Math.sin((ph / 4) * Math.PI * 2 + h.k) * 0.6;
          pitch += Math.sin((ph / 2) * Math.PI * 2 + h.k * 0.7) * 0.2;
          bright = 0.5 + 0.5 * b.pulse;
        } else {
          yaw += Math.sin(this.time * 0.4 + h.k) * 0.45;
          pitch += Math.sin(this.time * 0.31 + h.k) * 0.12;
          bright = b.section === 'build' ? 0.35 + 0.5 * b.build : 0.3;
        }
        this.dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      }
      this.q.setFromUnitVectors(UP, this.dir);
      this.dummy.position.copy(h.pos);
      this.dummy.quaternion.copy(this.q);
      this.dummy.scale.set(h.rad, h.len, h.rad);
      this.dummy.updateMatrix();
      this.beams.setMatrixAt(i, this.dummy.matrix);
      const hh = h.sky ? hue + (h.k % 2) * 0.5 : hue + 0.33 + h.k * 0.05;
      this.col.setHSL(((hh % 1) + 1) % 1, 0.85, 0.55).multiplyScalar(bright + this.flash * 0.8);
      this.beams.setColorAt(i, this.col);
    });
    this.beams.instanceMatrix.needsUpdate = true;
    this.beams.instanceColor!.needsUpdate = true;

    // Lasers on the drop (and strobing through the build's last bar).
    const lastBar = b.section === 'build' && b.cycleBar === 31;
    const laserOn = b.section === 'drop' || lastBar;
    const n = laserOn ? this.lasers.instanceMatrix.count : 0;
    this.lasers.count = n;
    if (n) {
      const src = this.dummy.position.set(this.dj.x, 3.05, this.dj.z - 1.3);
      const lh = (hue + 0.4) % 1;
      const open = 0.55 + 0.4 * Math.sin((ph / 16) * Math.PI * 2);
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1) - 0.5;
        const yaw = f * 2 * 0.95 * open + Math.sin((ph / 8) * Math.PI * 2) * 0.25;
        const pitch = 0.025 + 0.06 * Math.sin((ph / 2) * Math.PI * 2 + f * 3);
        this.dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
        this.dummy.quaternion.setFromUnitVectors(UP, this.dir);
        this.dummy.position.copy(src);
        this.dummy.scale.set(1, 34, 1);
        this.dummy.updateMatrix();
        this.lasers.setMatrixAt(i, this.dummy.matrix);
        // Alternate halves blink on the beat in the second half of the drop.
        let on = 1;
        if (b.cycleBar >= 8 && b.section === 'drop') on = (i + b.beat) % 2 ? 1 : 0.15;
        if (lastBar) on = Math.sin(ph * Math.PI * 8) > 0 ? 1 : 0;
        this.col.setHSL(i % 3 === 0 ? (lh + 0.5) % 1 : lh, 1, 0.5).multiplyScalar(on * (0.6 + 0.4 * b.pulse));
        this.lasers.setColorAt(i, this.col);
      }
      this.lasers.instanceMatrix.needsUpdate = true;
      this.lasers.instanceColor!.needsUpdate = true;
    }

    // The pool's underwater lights take the phrase's colour, pulsing on the drop.
    const P = this.pool;
    const amt = b.section === 'drop' ? 0.45 + 0.2 * b.pulse : b.section === 'break' ? 0.3 + 0.1 * Math.sin(this.time * 0.8) : 0.3 + 0.4 * b.build;
    this.col.setHSL((hue + (b.section === 'break' ? Math.sin(this.time * 0.1) * 0.1 : 0)) % 1, 0.9, 0.5);
    P.water.uniforms.tint.value.copy(this.col);
    P.water.uniforms.tintAmt.value = amt;
    P.tile.emissive.copy(this.baseTile).lerp(this.col, amt * 0.8);
    P.floor.emissive.copy(this.baseFloor).lerp(this.col, amt * 0.8);
    P.glow.color.copy(this.baseGlow).lerp(this.col, amt * 0.7);
    P.led.uniforms.pulse.value = b.pulse * (b.kick ? 1 : 0.3);
    P.led.uniforms.level.value = b.intensity;

    this.confetti.update(dt, pointScale);
    this.co2.update(dt, pointScale);
    this.shower.update(dt, pointScale);
  }
}

const UP = new THREE.Vector3(0, 1, 0);
