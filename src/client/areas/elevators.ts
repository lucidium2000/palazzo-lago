import * as THREE from 'three';
import type { Interaction } from '../interaction';
import type { Player } from '../player';
import type { Quality } from '../quality';
import type { World } from '../world';
import type { Sound } from '../audio';
import { canvas } from '../textures';
import { Batch, type Mats } from './kit';

/**
 * Hotel elevators that actually work. Every car is built the same way, with
 * its doors on the west side and the cab extending east (+x), so a ride is
 * seamless: the doors close, the car hums and the floor counter ticks, and
 * while you're sealed in you're moved to the identical car at the other
 * landing, whose doors then open with a chime.
 *
 * Press the call button beside a car (click, tap, or point and pull the
 * trigger in VR); its doors open. Step in and press a floor on the panel.
 */

export type LandingId = 'casino' | 'pool' | 'suite';

const LANDINGS: Record<LandingId, { label: string; short: string; floor: number }> = {
  pool: { label: 'Pool Deck', short: 'P', floor: 2 },
  casino: { label: 'Casino', short: 'C', floor: 1 },
  suite: { label: 'Suite 3201', short: '32', floor: 32 },
};
const PANEL_ROWS: (LandingId | 'open')[] = ['suite', 'pool', 'casino', 'open'];
const DEPTH = 2.2;
const HALF = 0.95;
const DOOR_W = 0.78;
const DOOR_H = 2.4;

interface Car {
  landing: LandingId;
  index: number;
  x: number;
  z: number;
  open: number;
  want: number;
  holdUntil: number;
  arriveAt: number;
  slot: number;
  display: string;
}

interface Ride {
  car: Car;
  dest: LandingId;
  t: number;
  moved: boolean;
  floors: number[];
}

export class Elevators {
  readonly cars: Car[] = [];
  private doors: THREE.InstancedMesh;
  private atlas: HTMLCanvasElement;
  private atlasTex: THREE.CanvasTexture;
  private ride: Ride | null = null;
  private time = 0;
  private hum: { set(v: number, r?: number): void; stop(): void } | null = null;
  private lastFx = new Map<Car, number>();
  private group = new THREE.Group();
  private tmp = new THREE.Object3D();
  private shake = 0;
  onRide: ((dest: LandingId) => void) | null = null;

  constructor(
    scene: THREE.Scene,
    _q: Quality,
    private m: Mats,
    private interaction: Interaction,
    private sound: Sound,
    private player: Player,
    private toast: (t: string) => void,
    landings: { id: LandingId; doorX: number; zs: number[] }[],
  ) {
    for (const l of landings) l.zs.forEach((z, i) => this.cars.push({ landing: l.id, index: i, x: l.doorX, z, open: 0, want: 0, holdUntil: 0, arriveAt: 0, slot: this.cars.length, display: LANDINGS[l.id].short }));
    const [c] = canvas(256, 64 * this.cars.length);
    this.atlas = c;
    this.atlasTex = new THREE.CanvasTexture(c);
    this.atlasTex.colorSpace = THREE.SRGBColorSpace;
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 1, roughness: 0.35, envMapIntensity: 1.3 });
    this.doors = new THREE.InstancedMesh(new THREE.BoxGeometry(0.04, DOOR_H, DOOR_W), doorMat, this.cars.length * 2);
    this.doors.raycast = () => {};
    this.doors.frustumCulled = false;
    this.group.add(this.doors);
    scene.add(this.group);
    this.build();
    this.drawAtlas();
    this.placeDoors();
  }

  // ---------------------------------------------------------------------------

  private build() {
    const b = new Batch();
    const m = this.m;
    const mirror = new THREE.MeshStandardMaterial({ color: 0x8a8070, metalness: 1, roughness: 0.08, envMapIntensity: 1.6 });
    const cabWall = new THREE.MeshStandardMaterial({ color: 0x5a2c18, roughness: 0.45, emissive: 0x2a120a, emissiveIntensity: 0.6 });
    const cabLight = m.glow(0xfff0d8, 1.4);
    // Indicator and panel planes share textures: one merged mesh each.
    const indicators: THREE.BufferGeometry[] = [];
    const panels: THREE.BufferGeometry[] = [];
    const plates: THREE.BufferGeometry[] = [];
    for (const car of this.cars) {
      const { x, z } = car;
      // Gilded portal on the landing side.
      b.box(m.gold, x - 0.06, 1.3, z - 0.83, 0.16, 2.6, 0.12);
      b.box(m.gold, x - 0.06, 1.3, z + 0.83, 0.16, 2.6, 0.12);
      b.box(m.gold, x - 0.06, 2.72, z, 0.18, 0.26, 1.9);
      // Cab: floor, ceiling with a glowing panel, walnut side walls, mirrored back, handrail.
      b.box(m.darkMarble, x + DEPTH / 2, 0.005, z, DEPTH, 0.01, HALF * 2);
      b.box(m.cream, x + DEPTH / 2, 2.62, z, DEPTH, 0.04, HALF * 2);
      b.box(cabLight, x + DEPTH / 2, 2.595, z, DEPTH - 0.5, 0.01, HALF * 2 - 0.5);
      b.box(cabWall, x + DEPTH / 2, 1.3, z - HALF - 0.03, DEPTH, 2.6, 0.06);
      b.box(cabWall, x + DEPTH / 2, 1.3, z + HALF + 0.03, DEPTH, 2.6, 0.06);
      b.box(mirror, x + DEPTH + 0.03, 1.3, z, 0.06, 2.6, HALF * 2);
      b.box(m.gold, x + DEPTH - 0.06, 0.95, z, 0.05, 0.05, HALF * 2 - 0.2);
      // Front wall inside the cab around the door opening.
      b.box(cabWall, x + 0.05, 1.3, z - 0.88, 0.1, 2.6, 0.16);
      b.box(cabWall, x + 0.05, 1.3, z + 0.88, 0.1, 2.6, 0.16);
      b.box(cabWall, x + 0.05, 2.55, z, 0.1, 0.3, 1.7);
      // Floor indicator above the door (landing side) and inside the cab.
      for (const [px, ry] of [
        [x - 0.15, -Math.PI / 2],
        [x + 0.12, Math.PI / 2],
      ] as const) {
        const g = new THREE.PlaneGeometry(0.42, 0.105);
        const uv = g.attributes.uv as THREE.BufferAttribute;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k), 1 - (car.slot + 1 - uv.getY(k)) / this.cars.length);
        g.rotateY(ry);
        g.translate(px, 2.72, z);
        indicators.push(g);
      }
      // Floor panel on the cab's right-hand wall (as you walk in).
      const pg = new THREE.PlaneGeometry(0.26, 0.46);
      pg.translate(x + 0.55, 1.3, z + HALF - 0.005);
      pg.rotateY(0); // faces -z? flip so it faces into the cab
      const pg2 = new THREE.PlaneGeometry(0.26, 0.46);
      pg2.rotateY(Math.PI);
      pg2.translate(x + 0.55, 1.3, z + HALF - 0.005);
      panels.push(pg2);
      pg.dispose();
      // Call plate on the landing wall, right of the door.
      const cg = new THREE.PlaneGeometry(0.14, 0.24);
      cg.rotateY(-Math.PI / 2);
      cg.translate(x - 0.02, 1.15, z + 1.12);
      plates.push(cg);
    }
    const g = b.build(this.group, 'elevators');
    void g;
    const merge = (list: THREE.BufferGeometry[]) => {
      const out = list[0].clone();
      if (list.length === 1) return out;
      return mergeList(list);
    };
    const indMesh = new THREE.Mesh(merge(indicators), new THREE.MeshBasicMaterial({ map: this.atlasTex, toneMapped: false }));
    indMesh.raycast = () => {};
    this.group.add(indMesh);

    const panelMesh = new THREE.Mesh(merge(panels), new THREE.MeshBasicMaterial({ map: panelTexture(), toneMapped: false }));
    this.group.add(panelMesh);
    this.interaction.register({
      object: panelMesh,
      label: (e) => {
        const row = this.rowAt(e.hit);
        return row === 'open' ? 'Open the doors' : row ? `Go to ${LANDINGS[row].label}` : null;
      },
      onSelect: (e) => {
        const car = this.nearest(e.hit.point);
        const row = this.rowAt(e.hit);
        if (!car || !row) return;
        this.sound.play('click', e.hit.point, { volume: 0.5 });
        if (row === 'open') this.openCar(car);
        else this.go(car, row);
      },
    });
    const plateMesh = new THREE.Mesh(merge(plates), new THREE.MeshBasicMaterial({ map: plateTexture(), toneMapped: false }));
    this.group.add(plateMesh);
    this.interaction.register({
      object: plateMesh,
      label: 'Call the elevator',
      onSelect: (e) => {
        const car = this.nearest(e.hit.point);
        if (!car) return;
        this.sound.play('click', e.hit.point, { volume: 0.5 });
        this.call(car);
      },
    });
  }

  private rowAt(hit: THREE.Intersection): (LandingId | 'open') | null {
    if (!hit.uv) return null;
    const v = 1 - hit.uv.y; // 0 at top
    const top = 0.18;
    if (v < top) return null;
    const i = Math.floor(((v - top) / (1 - top)) * PANEL_ROWS.length);
    return PANEL_ROWS[Math.min(PANEL_ROWS.length - 1, Math.max(0, i))];
  }

  private nearest(p: THREE.Vector3): Car | null {
    let best: Car | null = null,
      bd = 3;
    for (const c of this.cars) {
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  /** Walkable cabs (doors are enforced in update). */
  registerWorld(world: World) {
    for (const c of this.cars) {
      world.addWalkable(c.x - 0.4, c.x + DEPTH - 0.1, c.z - 0.62, c.z + 0.62);
      world.addWalkable(c.x + 0.05, c.x + DEPTH - 0.1, c.z - HALF + 0.1, c.z + HALF - 0.1);
      world.addSurface('marble', c.x, c.x + DEPTH, c.z - HALF, c.z + HALF);
    }
  }

  // ---------------------------------------------------------------------------

  call(car: Car) {
    if (this.ride?.car === car) return;
    if (car.open > 0.5 || car.arriveAt > this.time) {
      car.holdUntil = this.time + 9;
      return;
    }
    // The car arrives after a moment.
    car.arriveAt = this.time + 1.4;
    car.display = '▲';
    this.drawAtlas();
  }

  private openCar(car: Car) {
    car.want = 1;
    car.holdUntil = this.time + 9;
    car.display = LANDINGS[car.landing].short;
    this.drawAtlas();
  }

  go(car: Car, dest: LandingId) {
    if (this.ride) return;
    if (dest === car.landing) return this.openCar(car);
    const feet = this.player.feet();
    if (!this.inside(car, feet)) {
      this.toast('Step into the elevator first');
      return;
    }
    car.want = 0;
    const from = LANDINGS[car.landing].floor,
      to = LANDINGS[dest].floor;
    const steps = Math.min(8, Math.abs(to - from));
    const floors = Array.from({ length: steps + 1 }, (_, i) => Math.round(from + ((to - from) * i) / steps));
    this.ride = { car, dest, t: 0, moved: false, floors };
    this.toast(`Going to ${LANDINGS[dest].label}`);
  }

  private inside(car: Car, p: THREE.Vector3) {
    return p.x > car.x + 0.15 && p.x < car.x + DEPTH && Math.abs(p.z - car.z) < HALF;
  }

  // ---------------------------------------------------------------------------

  update(dt: number) {
    this.time += dt;
    const feet = this.player.feet();
    let doorsMoved = false;
    for (const car of this.cars) {
      if (car.arriveAt && this.time >= car.arriveAt) {
        car.arriveAt = 0;
        this.sound.play('ding', new THREE.Vector3(car.x, 2.5, car.z), { volume: 0.9 });
        this.openCar(car);
      }
      // Close after a while, unless someone is standing in the doorway or inside.
      const occupied = this.inside(car, feet) || Math.abs(feet.x - car.x) < 0.4 && Math.abs(feet.z - car.z) < 0.7;
      if (car.want === 1 && this.time > car.holdUntil && !occupied && this.ride?.car !== car) car.want = 0;
      const speed = 1 / 1.1;
      const before = car.open;
      car.open = THREE.MathUtils.clamp(car.open + Math.sign(car.want - car.open) * dt * speed, 0, 1);
      if (before !== car.open) doorsMoved = true;
      if (before === 1 && car.open < 1) this.sound.play('door', new THREE.Vector3(car.x, 1.2, car.z), { volume: 0.25, rate: 1.4 });
      // Closed doors are solid: keep the player on the side they were on.
      const fx = feet.x - car.x;
      const prev = this.lastFx.get(car) ?? fx;
      if (car.open < 0.55 && Math.abs(feet.z - car.z) < 0.85 && Math.abs(fx) < 0.28 && !this.ride) {
        const side = prev >= 0 ? 0.3 : -0.3;
        this.player.rig.position.x += side - fx;
      }
      this.lastFx.set(car, fx);
    }
    if (doorsMoved) this.placeDoors();

    // The ride.
    const r = this.ride;
    if (r) {
      r.t += dt;
      const closed = r.car.open <= 0.001;
      if (closed && !r.moved) {
        if (!this.hum) {
          this.hum = this.sound.loop('liftHum', this.group);
        }
        const travel = 2.6;
        const k = Math.min(1, r.t / travel);
        this.hum.set(0.5 * Math.sin(Math.PI * k), 1);
        this.shake = 0.004 * Math.sin(Math.PI * k);
        const fi = Math.min(r.floors.length - 1, Math.floor(k * r.floors.length));
        const label = r.floors[fi] === 1 ? 'C' : r.floors[fi] === 2 ? 'P' : String(r.floors[fi]);
        if (r.car.display !== label) {
          r.car.display = label;
          this.drawAtlas();
        }
        if (k >= 1) this.arrive(r);
      } else if (!closed) r.t = 0;
    }
    if (this.shake > 0 && this.ride) {
      this.player.rig.position.y = Math.sin(this.time * 47) * this.shake;
    } else if (this.player.rig.position.y !== 0 && !this.player.inXR) {
      this.player.rig.position.y = 0;
    }
  }

  /** Sealed in: move to the identical car at the destination, then open up. */
  private arrive(r: Ride) {
    const destCars = this.cars.filter((c) => c.landing === r.dest);
    const dest = destCars[Math.min(r.car.index, destCars.length - 1)];
    const dx = dest.x - r.car.x,
      dz = dest.z - r.car.z;
    this.player.rig.position.x += dx;
    this.player.rig.position.z += dz;
    this.player.rig.position.y = 0;
    this.player.current = null;
    this.lastFx.set(dest, this.player.feet().x - dest.x);
    dest.open = 0;
    dest.display = LANDINGS[r.dest].short;
    r.car.display = LANDINGS[r.car.landing].short;
    this.drawAtlas();
    this.placeDoors();
    this.hum?.stop();
    this.hum = null;
    this.shake = 0;
    r.moved = true;
    this.ride = null;
    setTimeout(() => {
      this.sound.play('ding', new THREE.Vector3(dest.x + 1, 2.4, dest.z), { volume: 0.9 });
      this.openCar(dest);
    }, 250);
    this.onRide?.(r.dest);
  }

  private placeDoors() {
    const t = this.tmp;
    this.cars.forEach((c, i) => {
      const slide = c.open * (DOOR_W - 0.06);
      for (const s of [-1, 1]) {
        t.position.set(c.x + 0.02, DOOR_H / 2, c.z + s * (DOOR_W / 2 + slide));
        t.updateMatrix();
        this.doors.setMatrixAt(i * 2 + (s > 0 ? 1 : 0), t.matrix);
      }
    });
    this.doors.instanceMatrix.needsUpdate = true;
  }

  private drawAtlas() {
    const g = this.atlas.getContext('2d')!;
    this.cars.forEach((c, i) => {
      const y = i * 64;
      g.fillStyle = '#0a0606';
      g.fillRect(0, y, 256, 64);
      g.strokeStyle = '#d4a94e';
      g.lineWidth = 3;
      g.strokeRect(2, y + 2, 252, 60);
      g.fillStyle = '#ff9a3a';
      g.font = 'bold 44px Georgia, serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(c.display, 128, y + 34);
    });
    this.atlasTex.needsUpdate = true;
  }

  /** Where to stand to use an elevator at a landing (for the map). */
  viewpoint(landing: LandingId) {
    const c = this.cars.find((x) => x.landing === landing)!;
    return { x: c.x - 2.2, z: c.z + 1.4, yaw: Math.PI / 2 + 0.35 };
  }
}

function mergeList(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const norm = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of norm) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3),
    nor = new Float32Array(n * 3),
    uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of norm) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    uv.set(g.attributes.uv.array as Float32Array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

function panelTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 452);
  const grd = g.createLinearGradient(0, 0, 256, 0);
  grd.addColorStop(0, '#8a6a32');
  grd.addColorStop(0.5, '#d8b46a');
  grd.addColorStop(1, '#8a6a32');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 452);
  g.fillStyle = '#1a0e06';
  g.font = 'italic 600 26px Georgia, serif';
  g.textAlign = 'center';
  g.fillText('Palazzo Lago', 128, 44);
  const top = 452 * 0.18;
  const h = (452 - top) / PANEL_ROWS.length;
  PANEL_ROWS.forEach((row, i) => {
    const y = top + i * h + h / 2;
    g.beginPath();
    g.arc(58, y, 30, 0, Math.PI * 2);
    g.fillStyle = '#2a1a0a';
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = '#fff0c8';
    g.stroke();
    g.fillStyle = '#ffe9b0';
    g.font = 'bold 26px Georgia, serif';
    g.textBaseline = 'middle';
    g.fillText(row === 'open' ? '◀▶' : LANDINGS[row].short, 58, y + 1);
    g.textAlign = 'left';
    g.fillStyle = '#1a0e06';
    g.font = '600 24px Georgia, serif';
    g.fillText(row === 'open' ? 'Doors' : LANDINGS[row].label, 100, y + 1);
    g.textAlign = 'center';
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function plateTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 220);
  g.fillStyle = '#c9a25a';
  g.fillRect(0, 0, 128, 220);
  g.strokeStyle = '#7a5a22';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 122, 214);
  for (const [y, up] of [[78, true], [150, false]] as const) {
    g.beginPath();
    g.arc(64, y, 30, 0, Math.PI * 2);
    g.fillStyle = up ? '#fff4d0' : '#2a1a0a';
    g.fill();
    g.fillStyle = up ? '#c07a10' : '#e8cf94';
    g.beginPath();
    g.moveTo(64, y + (up ? -14 : 14));
    g.lineTo(50, y + (up ? 10 : -10));
    g.lineTo(78, y + (up ? 10 : -10));
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
