import * as THREE from 'three';
import { allLayers } from '../cull';
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
 * two-channel mixer between them, at a real booth's spacing (30 cm records,
 * their centres 66 cm apart), so from behind the console both platters and
 * the faders are within a hand's reach without a step. Walk up behind the
 * console (steps at the booth's east end) and the resident DJ steps aside.
 *
 * VR: lay a hand (fingertip or palm) on a record and it turns with your hand
 * round the spindle, forwards or back, and that record's own track follows
 * (see scratch.ts); lift the hand and the motor spins it back up. Faders slide
 * with a fingertip: the crossfader (left: deck A only, right: deck B only,
 * equal-power through the middle) and each deck's channel fader (push away
 * for louder). Deck A (left, "No Tomorrow") is the house record and the
 * crossfader rests full left; fade right to bring in deck B (the scratch and
 * beats record).
 * Screen: click and drag on a record or a fader.
 *
 * Draws: the decks and mixer (one merged mesh, vertex colours), the two
 * records (instanced) and the three fader caps (instanced). Nothing allocated per frame
 * except what the hand-tracking API hands back while you're at the decks.
 */

/** The booth (areas/pool.ts DJ) and the console top the decks stand on. */
export const CONSOLE_TOP = 1.55;
const PLINTH_H = 0.06;
const RECORD_Y = CONSOLE_TOP + PLINTH_H + 0.012;
export const RECORD_R = 0.15;
/** The decks' spindles either side of the booth's centre (m): 66 cm apart, the mixer between. */
export const DECK_SPACING = 0.66;
/** The mixer's centre (m from the booth's centre: the plinths sit a little right of their spindles). */
const MIXER_X = -0.04;
/** Fader travel (m): the crossfader across, the channel faders toward and away from you. */
const XF_TRAVEL = 0.08;
const CH_TRAVEL = 0.07;
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

/** A fader on the mixer: which control, which way it slides, where its cap is at 0 and which way is up. */
interface Fader {
  id: 'xf' | 'volA' | 'volB';
  axis: 'x' | 'z';
  /** The cap's centre at value 0, and the way (+1/−1 along the axis) the value rises. */
  x0: number;
  z0: number;
  dir: number;
  travel: number;
  by: 'left' | 'right' | 'mouse' | null;
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
  /** Both decks (made once: the frame loop walks them every frame). */
  private both: Deck[] = [];
  readonly b: Deck;
  /** Crossfader, 0 (deck A only: where it rests) .. 1 (deck B only). */
  xf = 0;
  /** Channel faders (0..1). */
  volA = 1;
  volB = 1;
  /** You're at the decks (0..1, eased). */
  here = 0;
  atDecks = false;
  /** The resident DJ (null when the crowd was full). */
  readonly dj: Person | null;
  readonly params: DeckParams = { rateA: 1, rateB: 1, holdA: 0, holdB: 0, xf: 0, volA: 1, volB: 1 };
  /** Called when a record is first touched (a buzz, a sound). */
  onTouch: ((by: 'left' | 'right' | 'mouse') => void) | null = null;
  /** The DJ's spot behind the decks (where you stand to play). */
  readonly spot: THREE.Vector3;
  private aside: THREE.Vector3;
  private records: THREE.InstancedMesh;
  private caps: THREE.InstancedMesh;
  readonly faders: Fader[];
  private faderZ: number;
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
  private ray = allLayers(new THREE.Raycaster());
  private ndc = new THREE.Vector2();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -RECORD_Y);
  private mouse = { id: -1, at: new THREE.Vector3(), has: false, locked: false };
  private feet = new THREE.Vector3();

  constructor(private d: DecksDeps) {
    const cx = d.dj.x,
      cz = d.dj.z + 0.36;
    this.spot = DJ_SPOT.clone();
    this.aside = new THREE.Vector3(cx - 1.65, BOOTH_Y, d.dj.z - 1.05);
    // Facing the crowd (+z), your left hand is +x: deck A (the house record) there, deck B on the right.
    this.a = { platter: new Platter(), spindle: new THREE.Vector3(cx + DECK_SPACING / 2, RECORD_Y, cz), by: null };
    this.b = { platter: new Platter(), spindle: new THREE.Vector3(cx - DECK_SPACING / 2, RECORD_Y, cz), by: null };
    this.both = [this.a, this.b];
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
    // The faders: the crossfader across the mixer's front (left: deck A), the channel faders behind it.
    const mx = cx + MIXER_X;
    this.faderZ = cz - 0.13;
    this.faders = [
      { id: 'xf', axis: 'x', x0: mx + XF_TRAVEL / 2, z0: this.faderZ, dir: -1, travel: XF_TRAVEL, by: null },
      { id: 'volA', axis: 'z', x0: mx + 0.05, z0: cz - 0.09, dir: 1, travel: CH_TRAVEL, by: null },
      { id: 'volB', axis: 'z', x0: mx - 0.05, z0: cz - 0.09, dir: 1, travel: CH_TRAVEL, by: null },
    ];
    this.caps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.022, 0.018, 0.022), new THREE.MeshStandardMaterial({ color: 0xe9e9ee, roughness: 0.4 }), 3);
    this.caps.frustumCulled = false;
    this.caps.raycast = () => {};
    this.group.add(this.caps);
    this.placeCaps();
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
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 0.6), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(cx, CONSOLE_TOP + 0.1, cz);
    this.group.add(hit);
    d.interaction?.register({
      object: hit,
      label: () => (this.atDecks ? 'Drag a record to scratch, or a fader' : 'Step up to the decks'),
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
    for (const deck of this.both) {
      if (!deck.by) deck.platter.release();
      deck.platter.update(dt);
    }
    // Nobody at the decks: the mixer comes back to rest (deck A only, both channels up).
    if (!this.atDecks) {
      const k = Math.min(1, dt * 1.5);
      this.xf += (0 - this.xf) * k;
      if (this.xf < 0.002) this.xf = 0;
      this.volA += (1 - this.volA) * k;
      this.volB += (1 - this.volB) * k;
    }
    this.placeRecords();
    this.placeCaps();
    const P = this.params;
    P.rateA = this.a.platter.rate;
    P.rateB = this.b.platter.rate;
    P.holdA = this.a.by ? 1 : 0;
    P.holdB = this.b.by ? 1 : 0;
    P.xf = this.xf;
    P.volA = this.volA;
    P.volB = this.volB;
    return P;
  }

  /** A fader's value (0..1). */
  value(f: Fader): number {
    return f.id === 'xf' ? this.xf : f.id === 'volA' ? this.volA : this.volB;
  }

  private setValue(f: Fader, v: number) {
    const c = THREE.MathUtils.clamp(v, 0, 1);
    if (f.id === 'xf') this.xf = c;
    else if (f.id === 'volA') this.volA = c;
    else this.volB = c;
  }

  /** Where a fader's cap is now (world x, z). */
  capAt(f: Fader, out = this.t[3]): THREE.Vector3 {
    const d = this.value(f) * f.travel * f.dir;
    return out.set(f.x0 + (f.axis === 'x' ? d : 0), CONSOLE_TOP + 0.06, f.z0 + (f.axis === 'z' ? d : 0));
  }

  /** The fader value for a hand (or the mouse) at (x, z). */
  private valueAt(f: Fader, x: number, z: number): number {
    return ((f.axis === 'x' ? x - f.x0 : z - f.z0) * f.dir) / f.travel;
  }

  private placeCaps() {
    for (let i = 0; i < this.faders.length; i++) {
      this.m.makeTranslation(this.capAt(this.faders[i]));
      this.caps.setMatrixAt(i, this.m);
    }
    this.caps.instanceMatrix.needsUpdate = true;
  }

  private placeRecords() {
    for (let i = 0; i < 2; i++) {
      const deck = this.both[i];
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
      for (const deck of this.both) if (deck.by === 'left' || deck.by === 'right') deck.by = null;
      for (const f of this.faders) if (f.by !== 'mouse') f.by = null;
      return;
    }
    for (const side of ['left', 'right'] as const) {
      const tip = H.fingertip(side);
      const wp = H.wristPose(side);
      const aim = wp ? H.handAim(side) : null;
      // The palm: a hand's width on from the wrist.
      const palm = wp && aim ? this.t[0].copy(wp.p).addScaledVector(aim.fwd, 0.085).addScaledVector(aim.palm, 0.02) : null;
      for (const deck of this.both) {
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
      // The faders: a fingertip on a cap slides it (one fader per hand).
      for (const f of this.faders) {
        if (!tip || (f.by !== null && f.by !== side)) continue;
        if (f.by === null && this.faders.some((g) => g !== f && g.by === side)) continue;
        const cap = this.capAt(f);
        const held = f.by === side;
        const along = f.axis === 'x' ? Math.abs(tip.x - cap.x) : Math.abs(tip.z - cap.z);
        const across = f.axis === 'x' ? Math.abs(tip.z - cap.z) : Math.abs(tip.x - cap.x);
        const over = across < (held ? 0.03 : 0.02) && tip.y - cap.y < (held ? 0.05 : 0.025) && tip.y > CONSOLE_TOP + 0.02;
        if (over && along < (held ? 0.06 : 0.02)) {
          f.by = side;
          this.setValue(f, this.valueAt(f, tip.x, tip.z));
        } else if (held) f.by = null;
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
    for (const deck of this.both) {
      if (deck.by || Math.hypot(p.x - deck.spindle.x, p.z - deck.spindle.z) > RECORD_R * 1.05) continue;
      deck.by = 'mouse';
      deck.platter.touch(this.angleAt(deck, p));
      this.onTouch?.('mouse');
      got = true;
      break;
    }
    if (!got) {
      // The nearest fader cap under the pointer.
      let best: Fader | null = null,
        bd = 0.03;
      for (const f of this.faders) {
        const c = this.capAt(f);
        const d = Math.hypot(p.x - c.x, p.z - c.z);
        if (d < bd) {
          bd = d;
          best = f;
        }
      }
      if (best) {
        best.by = 'mouse';
        got = true;
      }
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
    for (const deck of this.both) if (deck.by === 'mouse') deck.by = null;
    for (const f of this.faders) if (f.by === 'mouse') f.by = null;
    e.stopImmediatePropagation();
  }

  private mouseDrag() {
    if (!this.mouse.has) return;
    const p = this.mouse.at;
    for (const deck of this.both) {
      if (deck.by !== 'mouse') continue;
      if (Math.hypot(p.x - deck.spindle.x, p.z - deck.spindle.z) > 0.02) deck.platter.drag(this.angleAt(deck, p), this.dt);
      else deck.platter.drag(deck.platter.angle, this.dt);
    }
    for (const f of this.faders) if (f.by === 'mouse') this.setValue(f, this.valueAt(f, p.x, p.z));
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
  for (const [k, sx] of [cx + DECK_SPACING / 2, cx - DECK_SPACING / 2].entries()) {
    const px = sx - 0.04; // the plinth sits a little to the right of the spindle (the tonearm's side)
    box(0.4, PLINTH_H, 0.36, 0x18181c, px, T + PLINTH_H / 2, cz);
    // Platter ring under the record, strobe dots' rim.
    cyl(0.156, 0.008, 0x8e8e96, sx, T + PLINTH_H + 0.004, cz, 40);
    // Tonearm: pivot at the back right (the far side from you), arm to the outer grooves.
    const pvx = sx - 0.19,
      pvz = cz + 0.13;
    cyl(0.02, 0.035, 0xb8b8c0, pvx, T + PLINTH_H + 0.017, pvz, 14);
    const tx = sx - 0.07,
      tz = cz - 0.08;
    const len = Math.hypot(tx - pvx, tz - pvz);
    box(0.011, 0.01, len, 0xd0d0d6, (pvx + tx) / 2, T + PLINTH_H + 0.03, (pvz + tz) / 2, Math.atan2(tx - pvx, tz - pvz));
    box(0.02, 0.012, 0.038, 0x222226, tx, T + PLINTH_H + 0.024, tz - 0.01, Math.atan2(tx - pvx, tz - pvz));
    cyl(0.016, 0.03, 0x2a2a2e, pvx, T + PLINTH_H + 0.03, pvz + 0.045, 12); // counterweight
    // Pitch fader on the right edge, start/stop at the near left corner.
    box(0.012, 0.004, 0.12, 0x050506, px - 0.18, T + PLINTH_H + 0.002, cz - 0.06);
    box(0.022, 0.012, 0.014, 0xd8d8dc, px - 0.18, T + PLINTH_H + 0.008, cz - 0.06 + (k ? 0.015 : -0.008));
    box(0.045, 0.008, 0.03, 0x3a3a40, px + 0.16, T + PLINTH_H + 0.004, cz - 0.15);
    cyl(0.006, 0.006, 0xff3a2a, px + 0.18, T + PLINTH_H + 0.003, cz + 0.15, 8); // the power light
  }
  // The mixer, between the decks: a fader per channel, EQ knobs and a VU column each, the crossfader across the front.
  const mx = cx + MIXER_X;
  box(0.24, 0.05, 0.36, 0x121216, mx, T + 0.025, cz);
  for (const s of [-1, 1]) {
    box(0.008, 0.002, CH_TRAVEL + 0.02, 0x020203, mx + s * 0.05, T + 0.051, cz - 0.09 + CH_TRAVEL / 2);
    for (let r = 0; r < 3; r++) cyl(0.011, 0.014, [0x9a9aa2, 0x9a9aa2, 0xc83a3a][r], mx + s * 0.05, T + 0.057, cz + 0.03 + r * 0.035, 10);
    for (let l = 0; l < 7; l++) box(0.008, 0.003, 0.008, l < 4 ? 0x3cff6a : l < 6 ? 0xffd23c : 0xff3a3a, mx + s * 0.012, T + 0.052, cz - 0.06 + l * 0.018);
  }
  // The crossfader's slot (the caps are their own mesh).
  box(XF_TRAVEL + 0.02, 0.002, 0.008, 0x020203, mx, T + 0.051, cz - 0.13);
  // A channel label under each fader: A in the house record's gold, B in deck B's blue.
  box(0.02, 0.002, 0.01, 0xd4a63a, mx + 0.05, T + 0.051, cz - 0.105);
  box(0.02, 0.002, 0.01, 0x3a8ad4, mx - 0.05, T + 0.051, cz - 0.105);
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
