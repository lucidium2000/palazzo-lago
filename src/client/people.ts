import * as THREE from 'three';
import type { Quality } from './quality';
import type { World } from './world';
import { spawnCharacter, type PeopleLib } from './assets';

// Bone offsets for poses the clips don't have (tuned against the Quaternius rig).
export const POSE = { sitThigh: 1.5, sitShin: -1.6, sitHips: 0.95, trayUpper: 0.9, trayLower: 1.2, trayAxis: 'x' as 'x' | 'z' };

/**
 * The casino's guests and staff. Every body part is one InstancedMesh shared by
 * the whole crowd, so two dozen animated people cost about a dozen draw calls.
 * People are posed procedurally (no skinned assets yet): walk cycles, sitting,
 * reaching for slot buttons, cheering, dealing, pouring, playing piano.
 */

export type Role = 'wander' | 'slots' | 'watch' | 'croupier' | 'bartender' | 'patron' | 'pianist' | 'waiter' | 'buddy';

export interface Look {
  dress: boolean;
  main: number;
  second: number;
  skin: number;
  hair: number;
  hairStyle: 'short' | 'long' | 'bald' | 'bun';
  height: number;
  /** Which character model to wear (see assets.ts). */
  kind?: string;
}

export class Person {
  pos = new THREE.Vector3();
  yaw = 0;
  /** Where the body should face when stationary. */
  homeYaw = 0;
  speed = 1;
  walkPhase = Math.random() * 10;
  moving = 0;
  /** Seconds left in a cheer / reaction. */
  cheer = 0;
  gaspT = 0;
  action = 0;
  actionKind: 'none' | 'tap' | 'sip' | 'reach' | 'pour' | 'wipe' | 'offer' = 'none';
  pause = 0;
  headYaw = 0;
  headPitch = 0;
  target: number | null = null;
  prev: number | null = null;
  seated = false;
  /** Hip height when seated (bar stools are taller than slot stools). */
  seatY = 0.62;
  /** Per-person randomness for idle motion. */
  seed = Math.random() * 100;
  /** Invisible proxy used for clicks (waiters). */
  proxy?: THREE.Mesh;
  onUpdate?: (p: Person, dt: number) => void;
  /** The animated character (when the people assets loaded). */
  rig?: ReturnType<typeof spawnCharacter>;
  /** Animation clock skipping for far-away people. */
  animSkip = 0;
  animDt = 0;
  tray?: THREE.Object3D;

  constructor(
    readonly role: Role,
    readonly look: Look,
  ) {}
}

const SKIN = [0xf1c9a5, 0xe0ac86, 0xc68a62, 0x9a6440, 0x6e4528, 0xf6d6bc];
const HAIR = [0x1a120c, 0x2e1d12, 0x5a3a22, 0x8a6a40, 0xc9a86a, 0x6a6a6a, 0x3a1a0a];
const SUITS = [0x1a1d2a, 0x121212, 0x2a2e36, 0x3a2a1e, 0x1e2a3a, 0x4a4a52];
const DRESSES = [0x8a0f1e, 0x0f4a3a, 0xc8a050, 0x14142a, 0x6a1a5a, 0xe8e0d0, 0x1a3a6a];
const SHIRTS = [0xf4f0e8, 0xdfe6ee, 0xf0e2d0];

let seedN = 7;
const rnd = () => ((seedN = (seedN * 16807) % 2147483647) / 2147483647);
const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];

export function randomLook(): Look {
  const dress = rnd() < 0.45;
  // A night at a Strip resort: mostly dressed up, some vacation casual.
  const r = rnd();
  const kind = dress ? (r < 0.45 ? 'female_formal' : r < 0.7 ? 'female_suit' : 'female_casual') : r < 0.5 ? 'male_suit' : r < 0.8 ? 'male_casual_2' : 'male_beach';
  return {
    kind,
    dress,
    main: dress ? pick(DRESSES) : pick(SUITS),
    second: pick(SHIRTS),
    skin: pick(SKIN),
    hair: pick(HAIR),
    hairStyle: dress ? (rnd() < 0.6 ? 'long' : 'bun') : rnd() < 0.15 ? 'bald' : 'short',
    height: (dress ? 1.66 : 1.78) + (rnd() - 0.5) * 0.14,
  };
}

export function staffLook(kind: 'dealer' | 'bar' | 'waiter' | 'pianist'): Look {
  const base = randomLook();
  if (kind === 'dealer') return { ...base, dress: false, main: 0x14100e, second: 0xf6f2ea, hairStyle: base.hairStyle === 'long' ? 'bun' : base.hairStyle, kind: 'male_suit', height: 1.8 };
  if (kind === 'bar') return { ...base, dress: false, main: 0x5a0e18, second: 0xf6f2ea, kind: 'female_suit', height: 1.7 };
  if (kind === 'pianist') return { ...base, dress: false, main: 0x0c0c10, second: 0xf6f2ea, kind: 'male_suit', height: 1.8 };
  return { ...base, dress: false, main: 0xf0ead8, second: 0x14100e, hairStyle: base.hairStyle === 'long' ? 'bun' : base.hairStyle, kind: 'female_formal', height: 1.7 };
}

// Body proportions for a 1.75 m person (scaled per height).
const HIP_Y = 0.92;
const THIGH = 0.45;
const SHIN = 0.44;
const TORSO = 0.58;
const UPPER = 0.3;
const FORE = 0.27;

interface Part {
  mesh: THREE.InstancedMesh;
  perPerson: number;
}

function faceTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 128);
  // Front of a SphereGeometry is at u = 0.25.
  const cx = 64;
  g.fillStyle = '#2a1a12';
  g.beginPath();
  g.ellipse(cx - 10, 58, 3.2, 2.4, 0, 0, Math.PI * 2);
  g.ellipse(cx + 10, 58, 3.2, 2.4, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(60,35,20,0.7)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(cx - 15, 51);
  g.quadraticCurveTo(cx - 10, 48, cx - 5, 51);
  g.moveTo(cx + 5, 51);
  g.quadraticCurveTo(cx + 10, 48, cx + 15, 51);
  g.stroke();
  g.fillStyle = 'rgba(150,70,60,0.75)';
  g.beginPath();
  g.ellipse(cx, 76, 6, 2.2, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(120,70,50,0.25)';
  g.beginPath();
  g.ellipse(cx, 66, 2.5, 4, 0, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const down = (g: THREE.BufferGeometry, len: number) => g.translate(0, -len / 2, 0);

export class Crowd {
  readonly people: Person[] = [];
  private parts: Record<string, Part> = {};
  private max: number;
  private m = new THREE.Matrix4();
  private tmp = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private nodes: THREE.Vector2[] = [];
  private edges: number[][] = [];
  private shadowMesh: THREE.InstancedMesh;
  private trays: THREE.InstancedMesh;
  readonly group = new THREE.Group();

  constructor(
    scene: THREE.Scene,
    q: Quality,
    private world: World,
    private lib: PeopleLib | null = null,
  ) {
    // Three extra slots are always kept for your crew.
    this.max = q.people + 4; // 3 crew + 1 remote player reserved
    scene.add(this.group);
    const cloth = new THREE.MeshStandardMaterial({ roughness: 0.75, envMapIntensity: 0.6 });
    const satin = new THREE.MeshStandardMaterial({ roughness: 0.35, envMapIntensity: 1.0 });
    const skin = new THREE.MeshStandardMaterial({ roughness: 0.6, map: faceTexture() });
    const skinPlain = new THREE.MeshStandardMaterial({ roughness: 0.6 });
    const hairMat = new THREE.MeshStandardMaterial({ roughness: 0.55 });
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 0.25, envMapIntensity: 1.2 });
    const add = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material, perPerson: number) => {
      const mesh = new THREE.InstancedMesh(geo, mat, this.max * perPerson);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.raycast = () => {};
      if (mat !== shoeMat) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.max * perPerson * 3), 3);
      this.group.add(mesh);
      this.parts[name] = { mesh, perPerson };
    };
    add('thigh', down(new THREE.CapsuleGeometry(0.075, THIGH - 0.1, 4, 8), THIGH), cloth, 2);
    add('shin', down(new THREE.CapsuleGeometry(0.06, SHIN - 0.08, 4, 8), SHIN), cloth, 2);
    add('shoe', new THREE.BoxGeometry(0.09, 0.07, 0.24).translate(0, -0.02, 0.05), shoeMat, 2);
    add('torso', new THREE.CylinderGeometry(0.19, 0.155, TORSO, 12, 1).translate(0, TORSO / 2, 0), cloth, 1);
    add('skirt', new THREE.CylinderGeometry(0.16, 0.33, 0.78, 14, 1, true).translate(0, -0.39, 0), satin, 1);
    add('shirt', new THREE.BoxGeometry(0.12, 0.2, 0.02).translate(0, TORSO - 0.12, 0.165), cloth, 1);
    add('upper', down(new THREE.CapsuleGeometry(0.05, UPPER - 0.08, 4, 8), UPPER), cloth, 2);
    add('fore', down(new THREE.CapsuleGeometry(0.042, FORE - 0.06, 4, 8), FORE), cloth, 2);
    add('hand', new THREE.SphereGeometry(0.045, 8, 6).scale(0.8, 1.1, 0.6), skinPlain, 2);
    const head = new THREE.SphereGeometry(0.105, 18, 12).scale(0.92, 1.08, 1.0).translate(0, 0.16, 0);
    add('head', head, skin, 1);
    add('neck', new THREE.CylinderGeometry(0.045, 0.05, 0.1, 8).translate(0, 0.05, 0), skinPlain, 1);
    add('hair', new THREE.SphereGeometry(0.115, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.95, 1.05, 1.05).translate(0, 0.17, -0.012), hairMat, 1);

    // Soft contact shadows under everyone.
    const sc = document.createElement('canvas');
    sc.width = sc.height = 64;
    const sg = sc.getContext('2d')!;
    const grad = sg.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    sg.fillStyle = grad;
    sg.fillRect(0, 0, 64, 64);
    this.shadowMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.75, 0.75).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }),
      this.max,
    );
    this.shadowMesh.frustumCulled = false;
    this.shadowMesh.count = 0;
    this.shadowMesh.raycast = () => {};
    this.group.add(this.shadowMesh);

    // Waiters' trays with two flutes each.
    const tray = new THREE.CylinderGeometry(0.17, 0.17, 0.012, 20);
    const flute = new THREE.CylinderGeometry(0.022, 0.012, 0.16, 8).translate(0, 0.085, 0);
    const trayGeo = mergeAll([tray, flute.clone().translate(0.06, 0, 0.02), flute.clone().translate(-0.05, 0, -0.03)]);
    this.trays = new THREE.InstancedMesh(trayGeo, new THREE.MeshStandardMaterial({ color: 0xd9c08a, metalness: 0.9, roughness: 0.25 }), 6);
    this.trays.frustumCulled = false;
    this.trays.count = 0;
    this.trays.raycast = () => {};
    this.group.add(this.trays);
  }

  get capacity() {
    return this.max - 4;
  }

  add(role: Role, look: Look, at: THREE.Vector3, yaw = 0): Person | null {
    const limit = role === 'buddy' ? this.max : this.max - 4;
    if (this.people.length >= limit) return null;
    const p = new Person(role, look);
    p.pos.copy(at);
    p.yaw = p.homeYaw = yaw;
    p.speed = 0.85 + rnd() * 0.4;
    p.seated = role === 'slots' || role === 'patron' || role === 'pianist';
    this.people.push(p);
    const i = this.people.length - 1;
    const set = (name: string, color: number) => {
      const part = this.parts[name];
      for (let k = 0; k < part.perPerson; k++) part.mesh.setColorAt(i * part.perPerson + k, new THREE.Color(color));
      part.mesh.count = this.people.length * part.perPerson;
    };
    const legColor = look.dress ? look.skin : look.main;
    set('thigh', legColor);
    set('shin', look.dress ? look.skin : look.main);
    this.parts.shoe.mesh.count = this.people.length * 2;
    set('torso', look.main);
    set('skirt', look.main);
    set('shirt', look.second);
    set('upper', look.dress && role !== 'waiter' ? look.skin : look.main);
    set('fore', look.dress && role !== 'waiter' ? look.skin : look.main);
    set('hand', look.skin);
    set('head', look.skin);
    set('neck', look.skin);
    set('hair', look.hair);
    this.shadowMesh.count = this.people.length;
    for (const part of Object.values(this.parts)) if (part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true;
    if (this.lib) {
      const rig = spawnCharacter(this.lib, look.kind ?? (look.dress ? 'female_formal' : 'male_suit'));
      p.rig = rig;
      this.group.add(rig.root);
      for (const [name, a] of Object.entries(rig.actions)) {
        a.play();
        a.setEffectiveWeight(name === 'Idle_Neutral' ? 1 : 0);
        a.time = Math.random() * a.getClip().duration;
      }
      if (role === 'waiter') {
        const tray = new THREE.Mesh(this.trays.geometry, this.trays.material);
        tray.raycast = () => {};
        p.tray = tray;
        rig.bones['WristR']?.add(tray);
        tray.position.set(0, 0.08, 0.05);
      }
      for (const part of Object.values(this.parts)) part.mesh.visible = false;
    }
    return p;
  }

  /** Builds the walking graph: nodes in open floor, edges where the straight line is clear. */
  setGraph(points: [number, number][]) {
    this.nodes = points.map(([x, z]) => new THREE.Vector2(x, z));
    this.edges = this.nodes.map(() => []);
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i],
          b = this.nodes[j];
        const d = a.distanceTo(b);
        if (d > 7.5) continue;
        let clear = true;
        for (let s = 0; s <= Math.ceil(d / 0.3); s++) {
          const t = s / Math.ceil(d / 0.3);
          if (!this.world.isFree(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 0.3)) {
            clear = false;
            break;
          }
        }
        if (clear) {
          this.edges[i].push(j);
          this.edges[j].push(i);
        }
      }
    }
  }

  graphInfo() {
    return { nodes: this.nodes.length, edges: this.edges.reduce((a, e) => a + e.length, 0) / 2, isolated: this.edges.filter((e) => e.length === 0).length };
  }

  randomNode(): THREE.Vector3 {
    const n = this.nodes[Math.floor(rnd() * this.nodes.length)];
    return new THREE.Vector3(n.x, 0, n.y);
  }

  private nearestNode(x: number, z: number) {
    let best = 0,
      bd = Infinity;
    this.nodes.forEach((n, i) => {
      const d = (n.x - x) ** 2 + (n.y - z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  /** Makes everyone near a point react: cheer (big win) or gasp. */
  react(at: THREE.Vector3, radius: number, kind: 'cheer' | 'gasp') {
    for (const p of this.people) {
      if (p.role === 'croupier' || p.pos.distanceTo(at) > radius) continue;
      if (kind === 'cheer') p.cheer = 1.6 + Math.random() * 0.6;
      else p.gaspT = 1.0;
    }
  }

  update(dt: number, time: number, player: THREE.Vector3, playerHead: THREE.Vector3) {
    let trayN = 0;
    this.people.forEach((p, i) => {
      p.onUpdate?.(p, dt);
      if (p.role === 'wander' || p.role === 'waiter') this.walk(p, dt, player);
      p.cheer = Math.max(0, p.cheer - dt);
      p.gaspT = Math.max(0, p.gaspT - dt);
      if (p.action > 0) p.action = Math.max(0, p.action - dt);
      else p.actionKind = 'none';

      // Turn the head toward the player when close; otherwise idle glances.
      const toP = this.v.set(playerHead.x - p.pos.x, 0, playerHead.z - p.pos.z);
      const dist = toP.length();
      let wantYaw = Math.sin(time * 0.3 + p.seed) * 0.35;
      let wantPitch = p.role === 'slots' ? -0.15 : 0;
      if (dist < 3.2 && p.role !== 'pianist') {
        let rel = Math.atan2(toP.x, toP.z) - p.yaw;
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        if (Math.abs(rel) < 1.7) {
          wantYaw = THREE.MathUtils.clamp(rel, -1.1, 1.1);
          wantPitch = THREE.MathUtils.clamp(Math.atan2(playerHead.y - (p.pos.y + 1.6), dist), -0.4, 0.4);
        }
      }
      p.headYaw += (wantYaw - p.headYaw) * Math.min(1, dt * 3);
      p.headPitch += (wantPitch - p.headPitch) * Math.min(1, dt * 3);
      if (p.rig) this.poseRig(p, i, dt, dist);
      else this.pose(p, i, time);
      if (p.role === 'waiter' && trayN < this.trays.instanceMatrix.count) {
        this.trays.setMatrixAt(trayN++, this.trayMatrix);
      }
    });
    this.trays.count = trayN;
    this.trays.instanceMatrix.needsUpdate = trayN > 0;
    for (const part of Object.values(this.parts)) part.mesh.instanceMatrix.needsUpdate = true;
    this.shadowMesh.instanceMatrix.needsUpdate = true;
  }

  private walk(p: Person, dt: number, player: THREE.Vector3) {
    if (this.nodes.length === 0) return;
    if (p.target === null) p.target = this.nearestNode(p.pos.x, p.pos.z);
    if (p.pause > 0) {
      p.pause -= dt;
      p.moving += (0 - p.moving) * Math.min(1, dt * 6);
      return;
    }
    const t = this.nodes[p.target];
    const dx = t.x - p.pos.x,
      dz = t.y - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.25) {
      const options = this.edges[p.target].filter((n) => n !== p.prev);
      const list = options.length ? options : this.edges[p.target];
      p.prev = p.target;
      p.target = list.length ? list[Math.floor(Math.random() * list.length)] : p.target;
      if (Math.random() < 0.18) p.pause = 1.5 + Math.random() * 3.5;
      return;
    }
    // Make way for the player: stop if they are right in front.
    const px = player.x - p.pos.x,
      pz = player.z - p.pos.z;
    const pd = Math.hypot(px, pz);
    const ahead = (px * dx + pz * dz) / (d * Math.max(pd, 1e-3));
    let want = p.speed;
    if (pd < 1.1 && ahead > 0.5) want = 0;
    else if (pd < 2 && ahead > 0.6) want = p.speed * 0.5;
    p.moving += (want - p.moving) * Math.min(1, dt * 4);
    const step = Math.min(d, p.moving * dt);
    let nx = p.pos.x + (dx / d) * step,
      nz = p.pos.z + (dz / d) * step;
    // Keep a little personal space between guests.
    for (const o of this.people) {
      if (o === p) continue;
      const ox = nx - o.pos.x,
        oz = nz - o.pos.z;
      const od = Math.hypot(ox, oz);
      if (od < 0.55 && od > 1e-3) {
        nx += (ox / od) * (0.55 - od) * 0.5;
        nz += (oz / od) * (0.55 - od) * 0.5;
      }
    }
    if (this.world.isFree(nx, nz, 0.22) || !this.world.isFree(p.pos.x, p.pos.z, 0.22)) {
      p.pos.x = nx;
      p.pos.z = nz;
    }
    const targetYaw = Math.atan2(dx, dz);
    let dy = targetYaw - p.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    p.yaw += dy * Math.min(1, dt * 5);
    p.walkPhase += p.moving * dt * 5.2;
  }

  private trayMatrix = new THREE.Matrix4();

  /** Drives an animated character: blends clips by what the person is doing, then poses bones. */
  private poseRig(p: Person, i: number, dt: number, dist: number) {
    const rig = p.rig!;
    const female = (p.look.kind ?? '').startsWith('female');
    const sc = p.look.height / (female ? 1.72 : 1.82);
    rig.root.position.set(p.pos.x, 0, p.pos.z);
    rig.root.rotation.y = p.yaw;
    rig.root.scale.setScalar(sc);
    // Far away people animate at a third of the rate (saves CPU on Quest and phones).
    p.animDt += dt;
    const every = dist > 14 ? 3 : dist > 8 ? 2 : 1;
    if (++p.animSkip % every !== 0 && !p.seated) {
      this.shadowAt(p, i, sc);
      return;
    }
    const step = p.animDt;
    p.animDt = 0;
    const a = rig.actions;
    const mv = p.seated ? 0 : p.moving;
    const run = THREE.MathUtils.clamp((mv - 1.9) / 0.6, 0, 1);
    const walk = THREE.MathUtils.clamp(mv / 0.6, 0, 1) * (1 - run);
    const cheer = p.cheer > 0 ? Math.min(1, p.cheer * 3) : 0;
    const gasp = p.gaspT > 0 ? Math.min(1, p.gaspT * 3) : 0;
    const busy =
      p.role === 'pianist' || (p.role !== 'slots' && p.action > 0 && p.actionKind !== 'none' && p.actionKind !== 'offer') ? 1 : 0;
    const over = Math.max(cheer, gasp, busy * 0.9);
    const baseW = 1 - over;
    const w = (name: string, v: number) => a[name]?.setEffectiveWeight(v);
    w('Idle_Neutral', baseW * (1 - walk - run) * 0.7);
    w('Idle', baseW * (1 - walk - run) * 0.3);
    w('Walk', baseW * walk);
    w('Run', baseW * run);
    w('Wave', cheer);
    w('HitRecieve', gasp * (1 - cheer));
    w('Interact', busy * (1 - cheer) * 0.9);
    if (a.Walk) a.Walk.timeScale = THREE.MathUtils.clamp(mv / (1.15 * sc), 0.5, 1.6);
    if (a.Run) a.Run.timeScale = THREE.MathUtils.clamp(mv / (3.2 * sc), 0.6, 1.4);
    if (a.Interact) a.Interact.timeScale = p.role === 'pianist' ? 1.6 : 1;
    rig.mixer.update(step);

    const b = rig.bones;
    if (p.seated) {
      // Sit: lower the body onto the seat, thighs forward, shins down.
      rig.root.position.y = p.seatY - POSE.sitHips * sc;
      for (const s of ['L', 'R']) {
        b[`UpperLeg${s}`]?.rotateX(POSE.sitThigh);
        b[`LowerLeg${s}`]?.rotateX(POSE.sitShin);
      }
    }
    if (p.role === 'waiter' && b['UpperArmR']) {
      b['UpperArmR'].rotateX(POSE.trayUpper);
      b['LowerArmR']?.rotateX(POSE.trayLower);
    }
    // Look at the player / glance around.
    b.Head?.rotateY(p.headYaw * 0.8);
    b.Head?.rotateX(-p.headPitch);
    this.shadowAt(p, i, sc);
    if (p.proxy) p.proxy.position.set(p.pos.x, 1.0, p.pos.z);
  }

  private shadowAt(p: Person, i: number, sc: number) {
    this.v.set(p.pos.x, 0.015, p.pos.z);
    this.shadowMesh.setMatrixAt(i, this.m.compose(this.v, this.q.identity(), this.s.set(sc, 1, sc)));
  }

  /** Writes every body part's matrix for one person. */
  private pose(p: Person, i: number, time: number) {
    this.pi = 0;
    const L = p.look;
    const sc = L.height / 1.75;
    const root = this.nm().compose(p.pos, this.q.setFromEuler(this.e.set(0, p.yaw, 0)), this.s.set(sc, sc, sc));
    const walk = Math.min(1, p.moving / 1.0);
    const ph = p.walkPhase;
    const swing = Math.sin(ph) * 0.48 * walk;
    const breathe = Math.sin(time * 1.6 + p.seed) * 0.01;
    const bounce = Math.abs(Math.cos(ph)) * 0.025 * walk;
    const cheer = p.cheer > 0 ? Math.min(1, p.cheer * 3, (2.2 - p.cheer) * 4) : 0;

    // --- Hips & legs
    const hipY = (p.seated ? p.seatY / sc : HIP_Y) + bounce;
    const hip = this.tmp.copy(root).multiply(this.m.makeTranslation(0, hipY, p.seated ? -0.05 : 0));
    const hipM = this.nm().copy(hip);
    for (const side of [-1, 1]) {
      const k = side < 0 ? 0 : 1;
      let thighA: number, kneeA: number;
      if (p.seated) {
        thighA = -1.45 + (p.role === 'pianist' ? Math.sin(time * 2 + side) * 0.03 : 0);
        kneeA = 1.35;
      } else {
        const s = swing * side;
        thighA = -s;
        kneeA = Math.max(0, Math.sin(ph + (side > 0 ? 0 : Math.PI) - 0.6)) * 0.7 * walk;
      }
      const thigh = this.nm().copy(hipM).multiply(this.m.makeTranslation(0.095 * side, 0, 0)).multiply(this.rot(thighA, 0, 0));
      this.set('thigh', i, k, thigh);
      const knee = this.nm().copy(thigh).multiply(this.m.makeTranslation(0, -THIGH, 0)).multiply(this.rot(kneeA, 0, 0));
      this.set('shin', i, k, knee);
      const ankle = this.nm().copy(knee).multiply(this.m.makeTranslation(0, -SHIN, 0)).multiply(this.rot(p.seated ? 0.1 : -kneeA * 0.3, 0, 0));
      this.set('shoe', i, k, ankle);
    }

    // --- Skirt (dresses only)
    if (L.dress) {
      const skirt = this.nm().copy(hipM).multiply(this.m.makeTranslation(0, 0.02, 0));
      if (p.seated) skirt.multiply(this.m.makeScale(1.15, 0.55, 1.35)).multiply(this.rot(-0.5, 0, 0));
      else skirt.multiply(this.rot(-swing * 0.12, 0, 0));
      this.set('skirt', i, 0, skirt);
    } else {
      this.set('skirt', i, 0, this.nm().makeScale(0, 0, 0));
    }

    // --- Torso
    const lean = p.role === 'slots' ? -0.12 : p.role === 'croupier' ? -0.08 : p.gaspT > 0 ? 0.08 : 0;
    const torso = this.nm().copy(hipM).multiply(this.rot(lean + breathe, Math.sin(ph) * 0.06 * walk, 0));
    this.set('torso', i, 0, torso);
    this.set('shirt', i, 0, L.dress ? this.nm().makeScale(0, 0, 0) : torso);
    const neck = this.nm().copy(torso).multiply(this.m.makeTranslation(0, TORSO - 0.02, 0));
    this.set('neck', i, 0, neck);
    const head = this.nm().copy(neck).multiply(this.m.makeTranslation(0, 0.05, 0)).multiply(this.rot(-p.headPitch - cheer * 0.25, p.headYaw, 0));
    this.set('head', i, 0, head);
    if (L.hairStyle === 'bald') this.set('hair', i, 0, this.nm().makeScale(0, 0, 0));
    else if (L.hairStyle === 'long') this.set('hair', i, 0, this.nm().copy(head).multiply(this.m.makeTranslation(0, -0.06, -0.01)).multiply(this.m.makeScale(1.05, 1.6, 1.08)));
    else if (L.hairStyle === 'bun') this.set('hair', i, 0, this.nm().copy(head).multiply(this.m.makeScale(1.0, 1.0, 1.12)));
    else this.set('hair', i, 0, head);

    // --- Arms
    for (const side of [-1, 1]) {
      const k = side < 0 ? 0 : 1;
      const right = side > 0;
      let ua = swing * side * 0.9, // forward swing (negative = forward)
        roll = 0.08 * side,
        fa = -0.25 - Math.abs(swing) * 0.3;
      const act = p.action > 0 ? Math.sin(Math.min(1, p.action) * Math.PI) : 0;
      switch (p.role) {
        case 'slots':
          ua = right ? -0.45 - act * 0.2 : -0.35;
          fa = right ? -0.75 + act * 0.25 : -0.9;
          roll = 0.15 * side;
          break;
        case 'patron':
          ua = right && p.actionKind === 'sip' ? -0.9 - act * 0.6 : -0.45;
          fa = right && p.actionKind === 'sip' ? -1.4 - act * 0.6 : -1.1;
          roll = 0.12 * side;
          break;
        case 'pianist':
          ua = -0.55;
          fa = -0.95;
          roll = 0.18 * side + Math.sin(time * (right ? 9 : 7) + p.seed) * 0.06;
          break;
        case 'croupier':
          if (p.actionKind === 'reach' && right) {
            ua = -1.0 - act * 0.25;
            fa = -0.4;
            roll = -0.35;
          } else {
            ua = -0.35;
            fa = -0.9;
            roll = 0.1 * side;
          }
          break;
        case 'bartender':
          if (p.actionKind === 'pour' && right) {
            ua = -1.5;
            fa = -0.4 + Math.sin(time * 4) * 0.05;
          } else if (p.actionKind === 'wipe' && right) {
            ua = -0.6 + Math.sin(time * 6) * 0.15;
            fa = -0.9;
            roll = -0.2 + Math.cos(time * 6) * 0.15;
          } else {
            ua = -0.25;
            fa = -0.7;
          }
          break;
        case 'waiter':
          if (right) {
            ua = -0.25;
            fa = -1.55;
            roll = 0.35;
          }
          break;
        case 'buddy':
          if (right && p.actionKind === 'sip') {
            ua = -0.9 - act * 0.6;
            fa = -1.4 - act * 0.6;
            break;
          }
          if (walk > 0.1) break;
          ua = right ? -0.12 : -0.15;
          fa = right ? -0.35 : -1.25;
          roll = right ? 0.1 : 0.32;
          break;
        case 'watch':
          if (!right) {
            ua = -0.15;
            fa = -1.2;
            roll = 0.3;
          } else {
            ua = -0.1;
            fa = -0.4;
          }
          break;
      }
      if (cheer > 0) {
        ua = THREE.MathUtils.lerp(ua, -2.7 + Math.sin(time * 14 + side) * 0.15, cheer);
        fa = THREE.MathUtils.lerp(fa, -0.3, cheer);
        roll = THREE.MathUtils.lerp(roll, 0.35 * side, cheer);
      } else if (p.gaspT > 0) {
        const g = Math.min(1, p.gaspT * 3);
        ua = THREE.MathUtils.lerp(ua, -1.2, g);
        fa = THREE.MathUtils.lerp(fa, -1.6, g);
        roll = THREE.MathUtils.lerp(roll, -0.4 * side, g);
      }
      const shoulder = this.nm().copy(torso).multiply(this.m.makeTranslation(0.205 * side, TORSO - 0.07, 0)).multiply(this.rot(ua, 0, roll));
      this.set('upper', i, k, shoulder);
      const elbow = this.nm().copy(shoulder).multiply(this.m.makeTranslation(0, -UPPER, 0)).multiply(this.rot(fa, 0, 0));
      this.set('fore', i, k, elbow);
      const hand = this.nm().copy(elbow).multiply(this.m.makeTranslation(0, -FORE - 0.02, 0));
      this.set('hand', i, k, hand);
      if (p.role === 'waiter' && right) {
        this.trayMatrix.copy(hand).multiply(this.m.makeTranslation(0, 0.03, 0)).multiply(this.rot(-fa - ua, 0, -roll));
      }
    }

    // Contact shadow.
    this.v.set(p.pos.x, 0.015, p.pos.z);
    this.shadowMesh.setMatrixAt(i, this.m.compose(this.v, this.q.identity(), this.s.set(sc, 1, sc)));
    if (p.proxy) {
      p.proxy.position.set(p.pos.x, 1.0, p.pos.z);
    }
  }

  private rot(x: number, y: number, z: number) {
    return this.nm().makeRotationFromEuler(this.e.set(x, y, z, 'YXZ'));
  }

  /** Scratch matrices reused every frame (no garbage, no GC hitches in VR). */
  private pool = Array.from({ length: 96 }, () => new THREE.Matrix4());
  private pi = 0;
  private nm() {
    return this.pool[this.pi++ % this.pool.length];
  }

  private set(name: string, i: number, k: number, m: THREE.Matrix4) {
    const part = this.parts[name];
    part.mesh.setMatrixAt(i * part.perPerson + k, m);
  }
}

function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [],
    nor: number[] = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...(g.attributes.position.array as Float32Array));
    nor.push(...(g.attributes.normal.array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
