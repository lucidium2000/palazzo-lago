import * as THREE from 'three';
import type { Interaction, Interactable } from '../interaction';
import type { Player } from '../player';
import type { Quality } from '../quality';
import type { World } from '../world';
import type { Sound } from '../audio';
import { canvas } from '../textures';
import { Batch, type Mats } from './kit';
import {
  ARRIVE_OPEN_SECS,
  CALL_SECS,
  canRide,
  canSend,
  DEPTH,
  destSlot,
  DOOR_SECS,
  floorLabel,
  floorsBetween,
  HALF,
  HOLD_SECS,
  inDoorway,
  insideCab,
  LANDINGS,
  PANEL,
  PANEL_ROWS,
  panelDest,
  panelRowAt,
  panelRowH,
  panelRowY,
  readSnapshot,
  RideClock,
  type LandingId,
  type LiftSnapshot,
  type PanelRow,
} from './liftlogic';

export type { LandingId } from './liftlogic';

/**
 * Hotel elevators that actually work. Every car is built the same way, with
 * its doors on the west side and the cab extending east (+x), so a ride is
 * seamless: the doors close, the car hums and the floor counter ticks, and
 * while you're sealed in you're moved to the identical car at the other
 * landing, whose doors then open with a chime.
 *
 * Press the call button beside a car (click, tap, point and pull the trigger,
 * or push it with a fingertip in VR); its doors open. Step in and press a
 * floor on the panel.
 *
 * With friends (see net/liftsync.ts) the cars are shared: everyone sees the
 * same doors and indicators, the host decides which ride goes (so two
 * presses never conflict), and everyone standing in a cab when its doors
 * shut rides it, each keeping their spot in the cab. People outside stay put.
 */

const DOOR_W = 0.78;
const DOOR_H = 2.4;
/** Landing side: how far in front of the door line the fixtures sit (clear of the walls, wainscot and rail). */
const FACE = 0.17;
/** Call plate: size, centre height, and how far along the wall from the car's centre. */
const PLATE_W = 0.16;
const PLATE_H = 0.22;
const PLATE_Y = 1.26;
const PLATE_Z = 1.12;

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
  /** The call plate's material (lit while the car is on its way). */
  plateMat: THREE.MeshBasicMaterial | null;
}

interface Ride {
  id: number;
  car: Car;
  to: Car;
  dest: LandingId;
  clock: RideClock;
  floors: number[];
  hum: { set(v: number, r?: number): void; stop(): void } | null;
  anchor: THREE.Object3D;
}

/** How a shared elevator talks to the room (net/liftsync.ts). */
export interface LiftNet {
  host: boolean;
  /** Tell everyone something happened: a call, the open button, or (host) a ride starting. */
  send(k: 'call' | 'open' | 'ride', d: Record<string, unknown>): void;
  /** Guest: ask the host to start a ride. */
  request(d: { c: number; d: LandingId }): void;
}

/** Someone besides you who can ride along (an NPC standing in the cab). */
export interface Passenger {
  pos: THREE.Vector3;
}

export class Elevators {
  readonly cars: Car[] = [];
  private doors: THREE.InstancedMesh;
  private atlas: HTMLCanvasElement;
  private atlasTex: THREE.CanvasTexture;
  private rides: Ride[] = [];
  private nextRide = 1;
  private time = 0;
  private lastFx = new Map<Car, number>();
  private group = new THREE.Group();
  private tmp = new THREE.Object3D();
  private shake = 0;
  private mine: Ride | null = null;
  /** A guest's ride request waiting for the host's word. */
  private pending: { car: Car; at: number } | null = null;
  private plateTex: { idle: THREE.CanvasTexture; lit: THREE.CanvasTexture } | null = null;
  /** The interactables (tests and tools can press them). */
  readonly plates: Interactable[] = [];
  readonly panels: Interactable[] = [];
  /** You rode somewhere: `from` and `to` are the two cars (their door lines). */
  onRide: ((dest: LandingId, info: { from: THREE.Vector3; to: THREE.Vector3 }) => void) | null = null;
  /** Shared with friends (null when playing alone). */
  net: LiftNet | null = null;
  /** Where your friends' feet are (so the doors don't close on them). */
  others: () => { x: number; z: number }[] = () => [];
  /** NPCs who could be standing in a cab (they ride along too). */
  passengers: () => Passenger[] = () => [];

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
    for (const l of landings) l.zs.forEach((z, i) => this.cars.push({ landing: l.id, index: i, x: l.doorX, z, open: 0, want: 0, holdUntil: 0, arriveAt: 0, slot: this.cars.length, display: LANDINGS[l.id].short, plateMat: null }));
    const [c] = canvas(256, 64 * this.cars.length);
    this.atlas = c;
    this.atlasTex = new THREE.CanvasTexture(c);
    this.atlasTex.colorSpace = THREE.SRGBColorSpace;
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 1, roughness: 0.35, envMapIntensity: 1.3 });
    this.doors = new THREE.InstancedMesh(new THREE.BoxGeometry(0.04, DOOR_H, DOOR_W), doorMat, this.cars.length * 2);
    this.doors.raycast = () => {};
    this.doors.frustumCulled = false;
    this.group.add(this.doors);
    this.group.name = 'elevators';
    scene.add(this.group);
    this.build();
    this.drawAtlas();
    this.placeDoors();
  }

  // ---------------------------------------------------------------------------

  private build() {
    // One batch per landing (not one across the resort): each landing's cabs can then be culled
    // with its own area (the culler can't place a mesh spanning the casino, the suite and the Promenade).
    const batches = new Map<LandingId, { b: Batch; indicators: THREE.BufferGeometry[] }>();
    const m = this.m;
    const mirror = new THREE.MeshStandardMaterial({ color: 0x8a8070, metalness: 1, roughness: 0.08, envMapIntensity: 1.6 });
    const cabWall = new THREE.MeshStandardMaterial({ color: 0x5a2c18, roughness: 0.45, emissive: 0x2a120a, emissiveIntensity: 0.6 });
    const cabLight = m.glow(0xfff0d8, 1.4);
    // Indicator planes share the atlas: one merged mesh (per landing).
    const panelMat = new THREE.MeshBasicMaterial({ map: panelTexture(), toneMapped: false });
    this.plateTex = plateTextures();
    for (const car of this.cars) {
      const { x, z } = car;
      let per = batches.get(car.landing);
      if (!per) batches.set(car.landing, (per = { b: new Batch(), indicators: [] }));
      const { b, indicators } = per;
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
      // Front wall inside the cab around the door opening (the header sits under the ceiling).
      b.box(cabWall, x + 0.05, 1.3, z - 0.88, 0.1, 2.6, 0.16);
      b.box(cabWall, x + 0.05, 1.3, z + 0.88, 0.1, 2.6, 0.16);
      b.box(cabWall, x + 0.05, 2.5, z, 0.1, 0.2, 1.7);
      // Floor indicators: above the doors on the landing (proud of the gilt header) and
      // inside the cab on the header over the doors (below the ceiling).
      for (const [px, py, ry] of [
        [x - FACE, 2.72, -Math.PI / 2],
        [x + 0.105, 2.5, Math.PI / 2],
      ] as const) {
        const g = new THREE.PlaneGeometry(0.42, 0.105);
        const uv = g.attributes.uv as THREE.BufferAttribute;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k), 1 - (car.slot + 1 - uv.getY(k)) / this.cars.length);
        g.rotateY(ry);
        g.translate(px, py, z);
        indicators.push(g);
      }
      // Floor panel on the cab's right-hand wall (as you walk in), facing into the cab.
      // One small mesh per car, so a fingertip can poke it (pokes skip big objects).
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(PANEL.w, PANEL.h), panelMat);
      panel.position.set(x + 0.55, PANEL.y, z + HALF - 0.005);
      panel.rotation.y = Math.PI;
      panel.name = `lift-panel-${car.slot}`;
      this.group.add(panel);
      this.panels.push(
        this.interaction.register({
          object: panel,
          label: (e) => {
            const row = this.rowAt(e.hit);
            if (!row) return null;
            if (row === 'open') return 'Open the doors';
            const dest = panelDest(car.landing, row);
            return dest === car.landing ? `${LANDINGS[row].panel} (this floor)` : `Go to ${LANDINGS[dest].panel}`;
          },
          onSelect: (e) => {
            const row = this.rowAt(e.hit);
            if (!row) return;
            this.sound.play('click', e.hit.point, { volume: 0.5 });
            if (row === 'open') this.open(car);
            else this.go(car, panelDest(car.landing, row));
          },
        }),
      );
      // Call plate on the landing wall, right of the door, on a gilt mount standing proud of the
      // wall, the wainscot and its rail (it used to sink into them and was cut in half).
      b.box(m.gold, x - FACE + 0.02, PLATE_Y, z + PLATE_Z, 0.04, PLATE_H + 0.03, PLATE_W + 0.03);
      const plateMat = new THREE.MeshBasicMaterial({ map: this.plateTex.idle, toneMapped: false });
      car.plateMat = plateMat;
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(PLATE_W, PLATE_H), plateMat);
      plate.position.set(x - FACE - 0.003, PLATE_Y, z + PLATE_Z);
      plate.rotation.y = -Math.PI / 2;
      plate.name = `lift-call-${car.slot}`;
      this.group.add(plate);
      this.plates.push(
        this.interaction.register({
          object: plate,
          label: 'Call the elevator',
          onSelect: (e) => {
            this.sound.play('click', e.hit.point, { volume: 0.5 });
            this.call(car);
          },
        }),
      );
    }
    const indMat = new THREE.MeshBasicMaterial({ map: this.atlasTex, toneMapped: false });
    for (const [landing, { b, indicators }] of batches) {
      b.build(this.group, `elevators-${landing}`);
      const indMesh = new THREE.Mesh(mergeList(indicators), indMat);
      indMesh.raycast = () => {};
      this.group.add(indMesh);
    }
  }

  private rowAt(hit: THREE.Intersection): PanelRow | null {
    if (!hit.uv) return null;
    return panelRowAt((1 - hit.uv.y) * PANEL.h);
  }

  /** Walkable cabs (doors are enforced in update). */
  registerWorld(world: World) {
    for (const c of this.cars) {
      world.addWalkable(c.x - 0.4, c.x + DEPTH - 0.1, c.z - 0.62, c.z + 0.62);
      world.addWalkable(c.x + 0.05, c.x + DEPTH - 0.1, c.z - HALF + 0.1, c.z + HALF - 0.1);
      world.addSurface('marble', c.x, c.x + DEPTH, c.z - HALF, c.z + HALF);
    }
  }

  // --- What people do ---------------------------------------------------------

  /** The ride a car is part of (leaving or arriving), if any. */
  private rideOf(car: Car): Ride | null {
    return this.rides.find((r) => r.car === car || r.to === car) ?? null;
  }

  /** Press a car's call button (you, or a friend: `remote`). */
  call(car: Car, remote = false) {
    if (!remote) this.net?.send('call', { c: car.slot });
    // A car on a ride comes when it's done (one arriving opens anyway).
    if (this.rideOf(car)) return;
    if (car.want === 1 || car.arriveAt > this.time) {
      car.holdUntil = this.time + HOLD_SECS;
      return;
    }
    // Still here with its doors closing: they open again.
    if (car.open > 0) return this.openCar(car);
    car.arriveAt = this.time + CALL_SECS;
    car.display = '▲';
    this.setLit(car, true);
    this.drawAtlas();
  }

  /** The panel's open-doors button (you, or a friend). Does nothing once a ride is under way. */
  open(car: Car, remote = false) {
    if (this.rideOf(car)) return;
    if (!remote) this.net?.send('open', { c: car.slot });
    this.openCar(car);
  }

  private openCar(car: Car) {
    car.want = 1;
    car.holdUntil = this.time + HOLD_SECS;
    car.display = LANDINGS[car.landing].short;
    this.setLit(car, false);
    this.drawAtlas();
  }

  /** Press a floor on the panel of `car` (`dest`: where that button goes from this car, see panelDest). */
  go(car: Car, dest: LandingId) {
    if (this.rideOf(car)) return;
    if (dest === car.landing) return this.open(car);
    if (!canSend(car.landing, dest)) return;
    if (!insideCab(car, this.player.feet())) {
      this.toast('Step into the elevator first');
      return;
    }
    if (this.net && !this.net.host) {
      // The host decides (two presses at once mustn't send the car two ways).
      if (this.pending?.car === car && this.time - this.pending.at < 3) return;
      this.pending = { car, at: this.time };
      this.net.request({ c: car.slot, d: dest });
      return;
    }
    if (!this.hostRide(car.slot, dest)) this.toast('The elevator is busy');
  }

  /**
   * Host (or playing alone): start a ride if neither car is busy, and tell
   * everyone. Returns false when it can't go (first press wins).
   */
  hostRide(slot: number, dest: LandingId): boolean {
    const car = this.cars[slot];
    // (Only to a floor on the car's panel: a guest's request is checked here too.)
    if (!car || !canSend(car.landing, dest)) return false;
    const to = destSlot(this.cars, car, dest);
    if (!canRide(this.rides.map((r) => ({ id: r.id, car: r.car.slot, dest: r.to.slot })), slot, to)) return false;
    const id = this.nextRide++;
    this.startRide(id, slot, dest);
    this.net?.send('ride', { id, c: slot, d: dest });
    return true;
  }

  /** A ride begins (decided here, or by the host): the doors shut and everyone inside goes. */
  startRide(id: number, slot: number, dest: LandingId, travelled = 0) {
    const car = this.cars[slot];
    if (!car || dest === car.landing || this.rides.some((r) => r.id === id) || this.rideOf(car)) return;
    const to = this.cars[destSlot(this.cars, car, dest)];
    if (this.rideOf(to)) return;
    if (this.pending?.car === car) this.pending = null;
    // Both cars shut: this one leaves, its twin is the car arriving at the other end.
    for (const c of [car, to]) {
      c.want = 0;
      c.arriveAt = 0;
      this.setLit(c, false);
    }
    const anchor = new THREE.Object3D();
    anchor.position.set(car.x + DEPTH / 2, 1.4, car.z);
    this.group.add(anchor);
    const clock = new RideClock();
    clock.t = travelled;
    this.rides.push({ id, car, to, dest, clock, floors: floorsBetween(LANDINGS[car.landing].floor, LANDINGS[dest].floor), hum: null, anchor });
    if (insideCab(car, this.player.feet())) this.toast(`Going to ${LANDINGS[dest].label}`);
  }

  /** You're sealed in a moving car (no jumping out). */
  get riding() {
    return !!this.mine;
  }

  /** Is (x, z) inside any car (or in its doorway)? Teleports shouldn't land you there. */
  inCab(x: number, z: number) {
    return this.cars.some((c) => x > c.x - 0.45 && x < c.x + DEPTH && Math.abs(z - c.z) < HALF + 0.05);
  }

  // --- Sharing ----------------------------------------------------------------

  /** Everything a friend who just walked in needs to see the same cars. */
  snapshot(): LiftSnapshot {
    return {
      cars: this.cars.map((c) => [c.want, c.display]),
      rides: this.rides.map((r) => [r.id, r.car.slot, r.dest, Math.round(r.clock.t * 100) / 100]),
    };
  }

  /** Join the room's state (the host's snapshot). */
  applySnapshot(d: unknown) {
    const s = readSnapshot(d, this.cars.length);
    if (!s) return;
    s.cars.forEach(([want, display], i) => {
      const c = this.cars[i];
      c.want = want;
      c.open = want;
      c.arriveAt = 0;
      c.holdUntil = this.time + HOLD_SECS;
      if (display) c.display = display;
    });
    for (const [id, slot, dest, t] of s.rides) this.startRide(id, slot, dest, t);
    // Ride doors are shut already.
    for (const r of this.rides) r.car.open = r.to.open = 0;
    this.nextRide = Math.max(this.nextRide, ...s.rides.map((r) => r[0] + 1));
    this.drawAtlas();
    this.placeDoors();
  }

  // ---------------------------------------------------------------------------

  update(dt: number) {
    this.time += dt;
    const feet = this.player.feet();
    const people = [feet, ...this.others()];
    let doorsMoved = false;
    for (const car of this.cars) {
      if (car.arriveAt && this.time >= car.arriveAt) {
        car.arriveAt = 0;
        this.sound.play('ding', new THREE.Vector3(car.x, 2.5, car.z), { volume: 0.9 });
        this.openCar(car);
      }
      const ride = this.rideOf(car);
      // Close after a while, unless someone (you or a friend) is standing in the doorway or inside.
      const occupied = people.some((p) => insideCab(car, p) || inDoorway(car, p));
      if (car.want === 1 && this.time > car.holdUntil && !occupied && !ride) car.want = 0;
      if (ride) car.want = 0;
      const before = car.open;
      car.open = THREE.MathUtils.clamp(car.open + Math.sign(car.want - car.open) * (dt / DOOR_SECS), 0, 1);
      if (before !== car.open) doorsMoved = true;
      if (before === 1 && car.open < 1) this.sound.play('door', new THREE.Vector3(car.x, 1.2, car.z), { volume: 0.25, rate: 1.4 });
      // Closed doors are solid: keep the player on the side they were on.
      const fx = feet.x - car.x;
      const prev = this.lastFx.get(car) ?? fx;
      if (car.open < 0.55 && Math.abs(feet.z - car.z) < 0.85 && Math.abs(fx) < 0.28 && !this.mine) {
        const side = prev >= 0 ? 0.3 : -0.3;
        this.player.rig.position.x += side - fx;
      }
      this.lastFx.set(car, fx);
    }
    if (doorsMoved) this.placeDoors();

    // A guest's request the host turned down (the car was busy).
    if (this.pending && this.time - this.pending.at > 3) {
      this.pending = null;
      this.toast('The elevator is busy, try again');
    }

    // Rides: doors shut, then the trip. Everyone sees the indicators count;
    // whoever is in the cab feels it and arrives.
    this.mine = null;
    let shake = 0;
    for (const r of [...this.rides]) {
      const sealed = r.car.open <= 0.001 && r.to.open <= 0.001;
      const inside = insideCab(r.car, this.player.feet());
      if (inside) this.mine = r;
      const arrived = r.clock.step(dt, sealed);
      if (r.clock.moving || arrived) {
        if (!r.hum) r.hum = this.sound.loop('liftHum', r.anchor);
        r.hum.set((inside ? 0.5 : 0.25) * Math.sin(Math.PI * r.clock.k), 1);
        if (inside) shake = 0.004 * Math.sin(Math.PI * r.clock.k);
        const label = floorLabel(r.clock.floor(r.floors));
        if (r.car.display !== label || r.to.display !== label) {
          r.car.display = r.to.display = label;
          this.drawAtlas();
        }
      }
      if (arrived) this.arrive(r);
    }
    this.shake = shake;
    if (this.shake > 0 && this.mine) {
      // (Keeping a VR crouch: the rig is lowered while you hold it.)
      this.player.rig.position.y = Math.sin(this.time * 47) * this.shake - (this.player.inXR ? this.player.crouch.drop : 0);
    }
    // (Otherwise the player sets the rig's height itself each frame: feet on the ground, in the pool, mid-jump.)
  }

  /** The car reaches the other landing: whoever's in it is now in the twin car there, which opens. */
  private arrive(r: Ride) {
    const { car, to } = r;
    const dx = to.x - car.x,
      dz = to.z - car.z;
    // NPCs standing in the cab come too (where they stood).
    for (const p of this.passengers()) {
      if (!insideCab(car, p.pos)) continue;
      p.pos.x += dx;
      p.pos.z += dz;
    }
    const wasIn = insideCab(car, this.player.feet());
    if (wasIn) {
      this.player.rig.position.x += dx;
      this.player.rig.position.z += dz;
      this.player.rig.position.y = this.player.inXR ? -this.player.crouch.drop : 0;
      this.player.current = null;
      this.lastFx.set(to, this.player.feet().x - to.x);
      this.mine = null;
      this.shake = 0;
    }
    // The car is at the other landing now: the one left behind shows where it went.
    to.display = LANDINGS[r.dest].short;
    car.display = LANDINGS[r.dest].short;
    to.open = 0;
    to.arriveAt = this.time + ARRIVE_OPEN_SECS;
    r.hum?.stop();
    r.anchor.removeFromParent();
    this.rides = this.rides.filter((x) => x !== r);
    this.drawAtlas();
    this.placeDoors();
    if (wasIn) this.onRide?.(r.dest, { from: new THREE.Vector3(car.x, 0, car.z), to: new THREE.Vector3(to.x, 0, to.z) });
  }

  private setLit(car: Car, lit: boolean) {
    if (!car.plateMat || !this.plateTex) return;
    const map = lit ? this.plateTex.lit : this.plateTex.idle;
    if (car.plateMat.map !== map) {
      car.plateMat.map = map;
      car.plateMat.needsUpdate = true;
    }
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
      g.strokeRect(2.5, y + 2.5, 251, 59);
      g.fillStyle = '#ff9a3a';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (c.display === '▲') {
        // Drawn, not a font glyph (not every font has it): an arrow centred in the window.
        g.beginPath();
        g.moveTo(128, y + 14);
        g.lineTo(110, y + 48);
        g.lineTo(146, y + 48);
        g.closePath();
        g.fill();
      } else {
        g.font = 'bold 50px Georgia, serif';
        g.fillText(c.display, 128, y + 34);
      }
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
  // About 1.2 px per mm: crisp at arm's length.
  const PX = 1200;
  const W = Math.round(PANEL.w * PX),
    H = Math.round(PANEL.h * PX);
  const [c, g] = canvas(W, H);
  const grd = g.createLinearGradient(0, 0, W, 0);
  grd.addColorStop(0, '#8a6a32');
  grd.addColorStop(0.5, '#d8b46a');
  grd.addColorStop(1, '#8a6a32');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#5a4018';
  g.lineWidth = 7;
  g.strokeRect(3.5, 3.5, W - 7, H - 7);
  g.fillStyle = '#1a0e06';
  g.font = 'italic 600 30px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('Palazzo Lago', W / 2, (PANEL.header * PX) / 2 + 2);
  const rowH = panelRowH() * PX;
  const R = (PANEL.button / 2) * PX;
  const bx = PANEL.buttonX * PX;
  const tx = bx + R + 14;
  const maxText = W - tx - 22;
  PANEL_ROWS.forEach((row, i) => {
    const y = panelRowY(i) * PX;
    // A hairline between rows (where a poke presses nothing).
    if (i) {
      g.strokeStyle = 'rgba(60,40,12,0.35)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(20, y - rowH / 2);
      g.lineTo(W - 20, y - rowH / 2);
      g.stroke();
    }
    g.beginPath();
    g.arc(bx, y, R, 0, Math.PI * 2);
    g.fillStyle = '#2a1a0a';
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = '#fff0c8';
    g.stroke();
    g.fillStyle = '#ffe9b0';
    g.textAlign = 'center';
    if (row === 'open') {
      // ◀ ▶ (doors apart) drawn as two triangles pointing out (a font may not have the glyphs).
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(bx + s * 21, y);
        g.lineTo(bx + s * 5, y - 13);
        g.lineTo(bx + s * 5, y + 13);
        g.closePath();
        g.fill();
      }
    } else {
      const label = LANDINGS[row].short;
      g.font = `bold ${label.length > 1 ? 32 : 38}px Georgia, serif`;
      g.fillText(label, bx, y + 1);
    }
    // The name: as big as fits (about 3 cm letters).
    const name = row === 'open' ? 'Doors' : LANDINGS[row].panel;
    let size = 38;
    g.font = `600 ${size}px Georgia, serif`;
    while (size > 24 && g.measureText(name).width > maxText) g.font = `600 ${(size -= 1)}px Georgia, serif`;
    g.textAlign = 'left';
    g.fillStyle = '#1a0e06';
    g.fillText(name, tx, y + 1);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** The call plate: one round button in the middle (idle, and lit while the car comes). */
function plateTextures(): { idle: THREE.CanvasTexture; lit: THREE.CanvasTexture } {
  const draw = (lit: boolean) => {
    const W = 128,
      H = 176;
    const [c, g] = canvas(W, H);
    g.fillStyle = '#c9a25a';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#7a5a22';
    g.lineWidth = 6;
    g.strokeRect(3, 3, W - 6, H - 6);
    const cx = W / 2,
      cy = H / 2;
    if (lit) {
      const glow = g.createRadialGradient(cx, cy, 20, cx, cy, 56);
      glow.addColorStop(0, 'rgba(255,190,80,0.9)');
      glow.addColorStop(1, 'rgba(255,190,80,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, W, H);
    }
    g.beginPath();
    g.arc(cx, cy, 38, 0, Math.PI * 2);
    g.fillStyle = '#7a5a22';
    g.fill();
    g.beginPath();
    g.arc(cx, cy, 32, 0, Math.PI * 2);
    g.fillStyle = lit ? '#ffd27a' : '#fff4d0';
    g.fill();
    g.fillStyle = lit ? '#8a4a00' : '#c07a10';
    g.beginPath();
    g.moveTo(cx, cy - 15);
    g.lineTo(cx - 14, cy + 10);
    g.lineTo(cx + 14, cy + 10);
    g.closePath();
    g.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { idle: draw(false), lit: draw(true) };
}
