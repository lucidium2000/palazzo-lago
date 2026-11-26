import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Hands } from '../hands';
import type { Interaction } from '../interaction';
import { reach } from '../net/embody';
import type { Crowd, Person } from '../people';
import type { Viewpoint } from '../player';
import type { Beat } from './beat';
import { Dancer } from './dance';
import { DJ_SPOT, LOOK_DJ } from './performers';
import { Platter, type DeckParams } from './scratch';

/**
 * The DJ's turntables on the booth's console: two decks with vinyl and a
 * mixer between them. Walk up behind the console (steps at the booth's east
 * end) and the resident DJ steps aside for you.
 *
 * VR: lay a hand (fingertip or palm) on a record and it turns with your hand
 * round the spindle, forwards or back, and the music follows (see scratch.ts);
 * lift the hand and the motor spins it back up. The crossfader slides with a
 * fingertip. The left deck carries the party's set, the right a battle record
 * that opens up while you scratch it (or with the crossfader).
 * Screen: click and drag on a record (or the crossfader).
 *
 * Three draws: the decks and mixer (one merged mesh, vertex colours), the two
 * records (instanced) and the crossfader cap. Nothing allocated per frame
 * except what the hand-tracking API hands back while you're at the decks.
 */

/** The booth (areas/pool.ts DJ) and the console top the decks stand on. */
export const CONSOLE_TOP = 1.45;
const PLINTH_H = 0.06;
const RECORD_Y = CONSOLE_TOP + PLINTH_H + 0.012;
export const RECORD_R = 0.152;
/** Where the DJ (and you) stand behind the decks, and where he steps aside to. */
export const BOOTH_Y = 0.6;


export interface DecksDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  crowd: Crowd;
  dj: { x: number; z: number };
  /** The resident DJ, if the pool's crowd already has him (else he's added here). */
  person?: Person | null;
  hands?: Hands;
  interaction?: Interaction;
  /** Screen: take you to the decks (clicked from across the deck). */
  travel?: (v: Viewpoint) => void;
}

interface Deck {
  platter: Platter;
  spindle: THREE.Vector3;
  /** Who's holding it: a hand ('left' / 'right'), the mouse, or nobody. */
  by: 'left' | 'right' | 'mouse' | null;
}

export class Decks {
  readonly group = new THREE.Group();
  readonly a: Deck;
  readonly b: Deck;
  /** Crossfader, 0 (left deck) .. 1 (right deck). */
  xf = 0;
  /** You're at the decks (0..1, eased). */
  here = 0;
  atDecks = false;
  /** The resident DJ (null when the crowd was full). */
  readonly dj: Person | null;
  readonly params: DeckParams = { rateA: 1, rateB: 1, holdA: 0, holdB: 0, xf: 0 };
  /** Called when a record is first touched (a buzz, a sound). */
  onTouch: ((by: 'left' | 'right' | 'mouse') => void) | null = null;
  /** The DJ's spot behind the decks (where you stand to play). */
  readonly spot: THREE.Vector3;
  private aside: THREE.Vector3;
  private records: THREE.InstancedMesh;
  private fader: THREE.Mesh;
  private faderBy: 'left' | 'right' | 'mouse' | null = null;
  private faderZ: number;
  private faderX0: number;
  private dancer = new Dancer(17.3);
  private beat: Beat | null = null;
  private dt = 0;
  private time = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);
  private t = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  // Mouse scratching.
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -RECORD_Y);
  private mouse = { id: -1, at: new THREE.Vector3(), has: false, locked: false };
  private feet = new THREE.Vector3();

  constructor(private d: DecksDeps) {
    const cx = d.dj.x,
      cz = d.dj.z + 0.5;
    this.spot = DJ_SPOT.clone();
    this.aside = new THREE.Vector3(cx - 1.65, BOOTH_Y, d.dj.z - 1.05);
    // Facing the crowd (+z), your left hand is +x: the set's deck there, the battle record on the right.
    this.a = { platter: new Platter(), spindle: new THREE.Vector3(cx + 0.65, RECORD_Y, cz), by: null };
    this.b = { platter: new Platter(), spindle: new THREE.Vector3(cx - 0.59, RECORD_Y, cz), by: null };
    this.b.platter.angle = 1.7;
    this.group.name = 'dj-decks';
    d.scene.add(this.group);
    this.group.add(buildDecks(cx, cz));

    // The records: one instanced draw for both.
    const rec = recordGeometry();
    const mat = new THREE.MeshStandardMaterial({ map: recordTexture(), roughness: 0.32, metalness: 0.15 });
    this.records = new THREE.InstancedMesh(rec, mat, 2);
    this.records.frustumCulled = false;
    this.records.name = 'records';
    this.group.add(this.records);
    // The crossfader cap.
    this.faderZ = cz - 0.125;
    this.faderX0 = cx + 0.075;
    this.fader = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.018, 0.03), new THREE.MeshStandardMaterial({ color: 0xe9e9ee, roughness: 0.4 }));
    this.fader.position.set(this.faderX0, CONSOLE_TOP + 0.06, this.faderZ);
    this.fader.raycast = () => {};
    this.group.add(this.fader);
    this.placeRecords();

    // The resident DJ.
    this.dj = d.person ?? d.crowd.add('watch', LOOK_DJ, this.spot, 0);
    if (this.dj) {
      const p = this.dj;
      p.curious = false;
      p.onUpdate = (q, dt) => this.walkDJ(q, dt);
      p.onPose = (q) => this.poseDJ(q);
    }

    // Screen: click a record and drag it round (ahead of the view-drag and the click handlers).
    addEventListener('pointerdown', (e) => this.pointerDown(e), { capture: true });
    addEventListener('pointermove', (e) => this.pointerMove(e), { capture: true });
    addEventListener('pointerup', (e) => this.pointerUp(e), { capture: true });
    addEventListener('pointercancel', (e) => this.pointerUp(e), { capture: true });

    // From across the deck: click the decks to step up to them.
    const hit = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 0.8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(cx, CONSOLE_TOP + 0.1, cz);
    this.group.add(hit);
    d.interaction?.register({
      object: hit,
      label: () => (this.atDecks ? 'Drag a record to scratch' : 'Step up to the decks'),
      enabled: () => !d.renderer.xr.isPresenting || !this.atDecks,
      onSelect: () => {
        if (this.atDecks || !d.travel) return;
        d.travel({ id: 'decks', label: 'The decks', position: this.spot.clone(), yaw: Math.PI, pitch: -0.62, eye: 1.62 });
      },
    });
  }

  /** You on the booth behind the decks? (feet on the riser, near the DJ's spot) */
  private updateHere(feet: THREE.Vector3, dt: number) {
    const dx = feet.x - this.spot.x,
      dz = feet.z - this.spot.z;
    const dist = Math.hypot(dx * 0.7, dz);
    const onRiser = feet.y > BOOTH_Y - 0.25;
    this.atDecks = onRiser && dist < (this.atDecks ? 1.5 : 1.0);
    this.here += ((this.atDecks ? 1 : 0) - this.here) * Math.min(1, dt * 3);
  }

  update(dt: number, beat: Beat, you: { feet: THREE.Vector3; xr: boolean }): DeckParams {
    this.dt = dt;
    this.time += dt;
    this.beat = beat;
    this.feet.copy(you.feet);
    this.updateHere(you.feet, dt);
    if (you.xr) this.handsOn();
    else if (this.mouse.id >= 0) this.mouseDrag();
    for (const deck of [this.a, this.b]) {
      if (!deck.by) deck.platter.release();
      deck.platter.update(dt);
    }
    this.placeRecords();
    this.fader.position.x = this.faderX0 - this.xf * 0.15;
    const P = this.params;
    P.rateA = this.a.platter.rate;
    P.rateB = this.b.platter.rate;
    P.holdA = this.a.by ? 1 : 0;
    P.holdB = this.b.by ? 1 : 0;
    P.xf = this.xf;
    return P;
  }

  private placeRecords() {
    for (const [i, deck] of [this.a, this.b].entries()) {
      this.q.setFromAxisAngle(this.up, -deck.platter.angle);
      this.m.compose(deck.spindle, this.q, this.s);
      this.records.setMatrixAt(i, this.m);
    }
    this.records.instanceMatrix.needsUpdate = true;
  }

  /** Angle of a point round a spindle (radians clockwise from above, 0 toward −z). */
  private angleAt(deck: Deck, p: THREE.Vector3) {
    return Math.atan2(p.x - deck.spindle.x, -(p.z - deck.spindle.z));
  }

  private onRecord(deck: Deck, p: THREE.Vector3, holding: boolean) {
    const r = Math.hypot(p.x - deck.spindle.x, p.z - deck.spindle.z);
    const h = p.y - RECORD_Y;
    return holding ? r < RECORD_R * 1.25 && h < 0.055 && h > -0.12 : r < RECORD_R * 1.04 && h < 0.025 && h > -0.08;
  }

  /** VR: fingertips and palms on the records and the crossfader. */
  private handsOn() {
    const H = this.d.hands;
    if (!H || this.here < 0.05) {
      for (const deck of [this.a, this.b]) if (deck.by === 'left' || deck.by === 'right') deck.by = null;
      this.faderBy = null;
      return;
    }
    for (const side of ['left', 'right'] as const) {
      const tip = H.fingertip(side);
      const wp = H.wristPose(side);
      const aim = wp ? H.handAim(side) : null;
      // The palm: a hand's width on from the wrist.
      const palm = wp && aim ? this.t[0].copy(wp.p).addScaledVector(aim.fwd, 0.085).addScaledVector(aim.palm, 0.02) : null;
      for (const deck of [this.a, this.b]) {
        const mine = deck.by === side;
        if (deck.by && !mine) continue;
        // The contact point: the palm if it's on the record, else the fingertip.
        const p = palm && this.onRecord(deck, palm, mine) ? palm : tip && this.onRecord(deck, tip, mine) ? tip : null;
        if (p) {
          const ang = this.angleAt(deck, p);
          const r = Math.hypot(p.x - deck.spindle.x, p.z - deck.spindle.z);
          if (!mine) {
            deck.by = side;
            deck.platter.touch(ang);
            this.onTouch?.(side);
          } else if (r > 0.025) deck.platter.drag(ang, this.dt);
          else deck.platter.drag(deck.platter.angle, this.dt);
        } else if (mine) deck.by = null;
      }
      // The crossfader: a fingertip on its cap slides it.
      if (tip && (this.faderBy === null || this.faderBy === side)) {
        const over = Math.abs(tip.z - this.faderZ) < 0.035 && tip.y - (CONSOLE_TOP + 0.06) < (this.faderBy ? 0.05 : 0.025) && tip.y > CONSOLE_TOP + 0.02;
        const within = Math.abs(tip.x - this.fader.position.x) < (this.faderBy ? 0.08 : 0.03);
        if (over && within) {
          this.faderBy = side;
          this.xf = THREE.MathUtils.clamp((this.faderX0 - tip.x) / 0.15, 0, 1);
        } else if (this.faderBy === side) this.faderBy = null;
      }
    }
  }

  // --- Screen: click and drag --------------------------------------------------------

  private pointAt(clientX: number, clientY: number): boolean {
    const dom = this.d.renderer.domElement;
    if (this.mouse.locked) this.ndc.set(0, 0);
    else {
      const r = dom.getBoundingClientRect();
      this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    }
    this.ray.setFromCamera(this.ndc, this.d.camera);
    return !!this.ray.ray.intersectPlane(this.plane, this.mouse.at);
  }

  private pointerDown(e: PointerEvent) {
    if (this.d.renderer.xr.isPresenting || e.button !== 0) return;
    if (e.target !== this.d.renderer.domElement) return;
    // Only from close by (at the decks, or leaning over the console).
    if (this.feet.distanceTo(this.spot) > 2.2) return;
    this.mouse.locked = document.pointerLockElement === this.d.renderer.domElement;
    if (!this.pointAt(e.clientX, e.clientY)) return;
    const p = this.mouse.at;
    let got = false;
    for (const deck of [this.a, this.b]) {
      if (deck.by || Math.hypot(p.x - deck.spindle.x, p.z - deck.spindle.z) > RECORD_R * 1.05) continue;
      deck.by = 'mouse';
      deck.platter.touch(this.angleAt(deck, p));
      this.onTouch?.('mouse');
      got = true;
      break;
    }
    if (!got && Math.abs(p.z - this.faderZ) < 0.04 && Math.abs(p.x - this.fader.position.x) < 0.04) {
      this.faderBy = 'mouse';
      got = true;
    }
    if (!got) return;
    this.mouse.id = e.pointerId;
    this.mouse.has = true;
    // Ours: no looking round, no click on whatever's behind.
    e.stopImmediatePropagation();
    e.preventDefault();
  }

  private pointerMove(e: PointerEvent) {
    if (e.pointerId !== this.mouse.id) return;
    if (this.mouse.locked) {
      // Pointer locked (first person): the movement drags a point across the record.
      const k = 0.0011;
      this.mouse.at.x -= e.movementX * k * Math.cos(this.d.camera.rotation.y);
      this.mouse.at.z += e.movementY * k;
      this.mouse.has = true;
    } else this.mouse.has = this.pointAt(e.clientX, e.clientY);
    e.stopImmediatePropagation();
  }

  private pointerUp(e: PointerEvent) {
    if (e.pointerId !== this.mouse.id) return;
    this.mouse.id = -1;
    for (const deck of [this.a, this.b]) if (deck.by === 'mouse') deck.by = null;
    if (this.faderBy === 'mouse') this.faderBy = null;
    e.stopImmediatePropagation();
  }

  private mouseDrag() {
    if (!this.mouse.has) return;
    const p = this.mouse.at;
    for (const deck of [this.a, this.b]) {
      if (deck.by !== 'mouse') continue;
      if (Math.hypot(p.x - deck.spindle.x, p.z - deck.spindle.z) > 0.02) deck.platter.drag(this.angleAt(deck, p), this.dt);
      else deck.platter.drag(deck.platter.angle, this.dt);
    }
    if (this.faderBy === 'mouse') this.xf = THREE.MathUtils.clamp((this.faderX0 - p.x) / 0.15, 0, 1);
  }

  // --- The resident DJ -----------------------------------------------------------------

  /** He steps aside while you're at the decks, and back when you leave. */
  private walkDJ(p: Person, dt: number) {
    const target = this.atDecks ? this.aside : this.spot;
    const dx = target.x - p.pos.x,
      dz = target.z - p.pos.z;
    const dist = Math.hypot(dx, dz);
    p.pos.y = BOOTH_Y;
    if (dist > 0.04) {
      const sp = Math.min(1.0, dist * 3);
      p.pos.x += (dx / dist) * Math.min(dist, sp * dt);
      p.pos.z += (dz / dist) * Math.min(dist, sp * dt);
      p.moving = sp;
      p.walkPhase += sp * dt * 5.2;
      turn(p, Math.atan2(dx, dz), dt * 6);
    } else {
      p.moving = 0;
      // At the decks: facing the crowd. Aside: watching you play.
      const want = this.atDecks ? Math.atan2(this.feet.x - p.pos.x, this.feet.z - p.pos.z) : 0;
      turn(p, want, dt * 4);
    }
    p.homeYaw = p.yaw;
  }

  private poseDJ(p: Person) {
    const rig = p.rig;
    const beat = this.beat;
    if (!rig || !beat) return;
    const playing = !this.atDecks && p.moving < 0.1 && p.pos.distanceTo(this.spot) < 0.15;
    const sc = rig.root.scale.x;
    this.dancer.pose(rig, { beat, dt: this.dt, amount: playing ? 0.55 : 0.8, move: 'groove', arms: !playing, scale: sc, still: true });
    if (!playing) return;
    const b = rig.bones;
    // Lean over the decks.
    nudge(b.Chest, 0.32);
    rig.root.updateMatrixWorld(true);
    const ph = beat.beats;
    const bar = Math.floor(ph / 4);
    // His left hand rides the set's record (a little nudge on the beat now and then); his right
    // works the mixer, and every fourth bar goes up to cup an ear (the headphones).
    const L = this.t[1].copy(this.a.spindle);
    L.x += 0.02 + 0.03 * Math.sin(ph * Math.PI * 0.5);
    L.z -= 0.115;
    L.y += 0.02 + 0.02 * Math.max(0, Math.sin(ph * Math.PI));
    const ear = bar % 4 === 3 && beat.beatInBar >= 1;
    const R = this.t[2];
    if (ear) {
      b.Head?.getWorldPosition(R);
      R.x -= 0.13 * Math.cos(p.yaw);
      R.z += 0.13 * Math.sin(p.yaw);
      R.y += 0.04;
    } else {
      R.set(this.spot.x - 0.04 + 0.03 * Math.sin(ph * Math.PI * 0.25), CONSOLE_TOP + 0.09, this.faderZ + 0.06 + 0.04 * Math.cos(ph * Math.PI * 0.5));
    }
    armTo(b, 'L', L, p.yaw, this.t[3]);
    armTo(b, 'R', R, p.yaw, this.t[3]);
  }
}

/** Turns a person toward a heading. */
function turn(p: Person, want: number, k: number) {
  let dy = want - p.yaw;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  p.yaw += dy * Math.min(1, k);
}

/** Reaches an arm's wrist to a world point (elbow down and out). */
export function armTo(b: Record<string, THREE.Object3D | undefined>, S: 'L' | 'R', target: THREE.Vector3, yaw: number, tmp: THREE.Vector3, weight = 1) {
  const upper = b[`UpperArm${S}`],
    lower = b[`LowerArm${S}`],
    end = b[`Wrist${S}`] ?? b[`Hand${S}`];
  if (!upper || !lower || !end) return;
  const dir = S === 'L' ? 1 : -1;
  upper.getWorldPosition(tmp);
  // Elbow: down, back and out to that side.
  tmp.y -= 0.5;
  tmp.x += Math.cos(yaw) * 0.4 * dir - Math.sin(yaw) * 0.25;
  tmp.z += -Math.sin(yaw) * 0.4 * dir - Math.cos(yaw) * 0.25;
  reach(upper, lower, end, target, tmp, weight);
}

/** Tips a bone forward from its clip pose, without piling up where the clip doesn't key it. */
export function nudge(bone: THREE.Object3D | undefined, a: number) {
  if (!bone) return;
  const ud = bone.userData as { nIn?: THREE.Quaternion; nOut?: THREE.Quaternion };
  if (ud.nOut && ud.nIn && bone.quaternion.equals(ud.nOut)) bone.quaternion.copy(ud.nIn);
  (ud.nIn ??= new THREE.Quaternion()).copy(bone.quaternion);
  bone.rotateX(a);
  (ud.nOut ??= new THREE.Quaternion()).copy(bone.quaternion);
}

// --- Geometry ----------------------------------------------------------------------------

function tint(g: THREE.BufferGeometry, color: number, x: number, y: number, z: number, ry = 0): THREE.BufferGeometry {
  const geo = (g.index ? g.toNonIndexed() : g) as THREE.BufferGeometry;
  if (ry) geo.rotateY(ry);
  geo.translate(x, y, z);
  for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** Both turntables and the mixer, merged into one mesh. */
function buildDecks(cx: number, cz: number): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const T = CONSOLE_TOP;
  const box = (w: number, h: number, d: number, color: number, x: number, y: number, z: number, ry = 0) => parts.push(tint(new THREE.BoxGeometry(w, h, d), color, x, y, z, ry));
  const cyl = (r: number, h: number, color: number, x: number, y: number, z: number, seg = 20) => parts.push(tint(new THREE.CylinderGeometry(r, r, h, seg), color, x, y, z));
  for (const [k, sx] of [cx + 0.65, cx - 0.59].entries()) {
    const px = sx - 0.03; // the plinth sits a little to the right of the spindle
    box(0.45, PLINTH_H, 0.36, 0x18181c, px, T + PLINTH_H / 2, cz);
    // Platter ring under the record, strobe dots' rim.
    cyl(0.158, 0.008, 0x8e8e96, sx, T + PLINTH_H + 0.004, cz, 40);
    // Tonearm: pivot at the back right (the far side from you), arm to the outer grooves.
    const pvx = sx - 0.19,
      pvz = cz + 0.13;
    cyl(0.024, 0.035, 0xb8b8c0, pvx, T + PLINTH_H + 0.017, pvz, 14);
    const tx = sx - 0.075,
      tz = cz - 0.085;
    const len = Math.hypot(tx - pvx, tz - pvz);
    box(0.012, 0.01, len, 0xd0d0d6, (pvx + tx) / 2, T + PLINTH_H + 0.03, (pvz + tz) / 2, Math.atan2(tx - pvx, tz - pvz));
    box(0.022, 0.012, 0.04, 0x222226, tx, T + PLINTH_H + 0.024, tz - 0.01, Math.atan2(tx - pvx, tz - pvz));
    cyl(0.018, 0.03, 0x2a2a2e, pvx, T + PLINTH_H + 0.03, pvz + 0.05, 12); // counterweight
    // Pitch fader on the right edge, start/stop at the near left corner.
    box(0.014, 0.004, 0.16, 0x050506, px + 0.19, T + PLINTH_H + 0.002, cz - 0.02);
    box(0.026, 0.012, 0.016, 0xd8d8dc, px + 0.19, T + PLINTH_H + 0.008, cz - 0.02 + (k ? 0.02 : -0.01));
    box(0.05, 0.008, 0.035, 0x3a3a40, px - 0.17, T + PLINTH_H + 0.004, cz - 0.14);
    cyl(0.006, 0.006, 0xff3a2a, px - 0.2, T + PLINTH_H + 0.003, cz + 0.15, 8); // the power light
  }
  // The mixer.
  const mx = cx + 0.03;
  box(0.3, 0.05, 0.36, 0x121216, mx, T + 0.025, cz);
  // Channel faders (two slots and caps), EQ knobs, a VU column of LEDs per channel.
  for (const s of [-1, 1]) {
    box(0.008, 0.002, 0.11, 0x020203, mx + s * 0.05, T + 0.051, cz - 0.03);
    box(0.02, 0.014, 0.012, 0xd8d8dc, mx + s * 0.05, T + 0.058, cz - 0.05);
    for (let r = 0; r < 3; r++) cyl(0.011, 0.014, [0x9a9aa2, 0x9a9aa2, 0xc83a3a][r], mx + s * 0.05, T + 0.057, cz + 0.06 + r * 0.035, 10);
    for (let l = 0; l < 7; l++) box(0.008, 0.003, 0.008, l < 4 ? 0x3cff6a : l < 6 ? 0xffd23c : 0xff3a3a, mx + s * 0.012, T + 0.052, cz - 0.06 + l * 0.018);
  }
  // Crossfader slot (the cap is its own mesh).
  box(0.17, 0.002, 0.008, 0x020203, mx, T + 0.051, cz - 0.125);
  const geo = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.35 }));
  mesh.name = 'decks';
  mesh.raycast = () => {};
  return mesh;
}

/** A record on its platter: the disc (textured on top) and the spindle. Origin: the spindle at the record's top. */
function recordGeometry(): THREE.BufferGeometry {
  const disc = new THREE.CylinderGeometry(RECORD_R, RECORD_R, 0.004, 56, 1).toNonIndexed();
  disc.translate(0, -0.002, 0);
  const spindle = new THREE.CylinderGeometry(0.0035, 0.0035, 0.016, 8, 1).toNonIndexed();
  spindle.translate(0, 0.006, 0);
  // The spindle samples the texture's silver corner.
  const uv = spindle.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.01, 0.01);
  const g = mergeGeometries([disc, spindle])!;
  return g;
}

/** Vinyl: grooves, a label (with a cue sticker you can see turn), silver in the corners for the spindle. */
function recordTexture(): THREE.CanvasTexture {
  const S = 512,
    c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c4c4ca';
  g.fillRect(0, 0, S, S);
  const C = S / 2;
  g.fillStyle = '#0b0b0d';
  g.beginPath();
  g.arc(C, C, C - 1, 0, Math.PI * 2);
  g.fill();
  // Grooves (with a couple of gaps between the tracks).
  for (let r = 92; r < C - 6; r += 2.2) {
    const gap = Math.abs(r - 150) < 3 || Math.abs(r - 200) < 3;
    g.strokeStyle = gap ? '#1c1c20' : r % 4.4 < 2.2 ? '#151518' : '#0e0e10';
    g.lineWidth = gap ? 3 : 1;
    g.beginPath();
    g.arc(C, C, r, 0, Math.PI * 2);
    g.stroke();
  }
  // A sheen across the grooves.
  const sh = g.createLinearGradient(0, 0, S, S);
  sh.addColorStop(0.3, 'rgba(255,255,255,0)');
  sh.addColorStop(0.5, 'rgba(255,255,255,0.08)');
  sh.addColorStop(0.7, 'rgba(255,255,255,0)');
  g.fillStyle = sh;
  g.beginPath();
  g.arc(C, C, C - 4, 0, Math.PI * 2);
  g.arc(C, C, 90, 0, Math.PI * 2, true);
  g.fill();
  // Label.
  g.fillStyle = '#d4a63a';
  g.beginPath();
  g.arc(C, C, 84, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1a0f22';
  g.font = 'bold 22px Georgia, serif';
  g.textAlign = 'center';
  g.fillText('PALAZZO', C, C - 30);
  g.fillText('LAGO', C, C - 6);
  g.font = '15px Georgia, serif';
  g.fillText('POOL SESSIONS · 33⅓', C, C + 40);
  // The cue sticker: a white strip from the label out (shows the record turning, and where your sample starts).
  g.fillStyle = '#f4f4f0';
  g.fillRect(C - 5, C - 84 - 70, 10, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
