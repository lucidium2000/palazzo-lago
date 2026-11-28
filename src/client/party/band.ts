import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BAND, STAGE } from '../areas/pool';
import type { Person } from '../people';
import type { Beat } from './beat';
import { armTo, nudge } from './decks';
import { turnWorld } from './showanim';
import { DRUM, lastAt, strikeLift, type SongMaps } from './songmaps';

/**
 * Her band on the pool stage (all original characters): a keyboard player at
 * a two-tier synth rig stage left, a drummer at a kit on a riser at the back,
 * a bassist stage right. While she's on they play the song as it sounds: what
 * they hit is read from the recording itself (songmaps.ts, worked out when her
 * set loads), so each stick comes down on its drum on the hit you hear:
 *
 * - the drummer: the right stick on the hi-hat hits (the crash on the big
 *   drops), the left on the snare, both round the toms where the snare hits
 *   bunch up into a fill, the right foot pumping the kick pedal on each kick;
 * - the keys player: the left hand pressing a new chord where the harmony
 *   changes (moving along the keys with it), the right playing the synths'
 *   own hits, a sway with the phrase;
 * - the bassist: the plucking hand on each bass note, the fretting hand
 *   sliding along the neck to each new note, bobbing with the beat.
 *
 * Until the maps are in (a second or two), they play to the beat clock
 * instead. All of them breathe and nod between hits, and between her sets
 * they're on the stage, standing easy.
 *
 * Draws: the drum kit and keyboard rig (one merged mesh, vertex colours), the
 * bass guitar (a small mesh that rides in the bassist's hands), the two sticks.
 */

type Part = { g: THREE.BufferGeometry; c: number };

function colored(parts: Part[]): THREE.BufferGeometry {
  const out = parts.map(({ g, c }) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
    const col = new THREE.Color(c);
    const a = new Float32Array(n.attributes.position.count * 3);
    for (let i = 0; i < a.length; i += 3) a.set([col.r, col.g, col.b], i);
    n.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return n;
  });
  const g = mergeGeometries(out)!;
  out.forEach((p) => p.dispose());
  return g;
}

const cyl = (r: number, h: number, seg = 18) => new THREE.CylinderGeometry(r, r, h, seg);

/** Where the drummer's sticks land, in the kit's frame (drummer at the origin, facing +z, y up from the riser). */
const KIT = {
  snare: new THREE.Vector3(-0.22, 0.66, 0.36),
  hat: new THREE.Vector3(-0.46, 0.92, 0.34),
  tom1: new THREE.Vector3(-0.14, 0.86, 0.58),
  tom2: new THREE.Vector3(0.16, 0.86, 0.58),
  floor: new THREE.Vector3(0.44, 0.58, 0.36),
  crash: new THREE.Vector3(-0.5, 1.32, 0.66),
  ride: new THREE.Vector3(0.56, 1.18, 0.58),
};
const SEAT_Y = 0.52;

function drumKit(): THREE.BufferGeometry {
  const P: Part[] = [];
  const shell = 0x8a1c2c,
    chrome = 0xc8c8d0,
    head = 0xe8e4da,
    brass = 0xc9a24a,
    black = 0x121214;
  // Kick drum lying on its side, front head facing the crowd.
  P.push({ g: cyl(0.27, 0.42, 24).rotateX(Math.PI / 2).translate(0, 0.27, 0.62), c: shell });
  P.push({ g: new THREE.CircleGeometry(0.255, 24).translate(0, 0.27, 0.835), c: head });
  P.push({ g: new THREE.CircleGeometry(0.1, 16).translate(0, 0.27, 0.837), c: 0xff3a6a });
  const drum = (at: THREE.Vector3, r: number, h: number, tilt = 0.12) => {
    P.push({ g: cyl(r, h).rotateX(-tilt).translate(at.x, at.y - h / 2, at.z), c: shell });
    P.push({ g: cyl(r * 0.98, 0.004).rotateX(-tilt).translate(at.x, at.y + 0.002, at.z), c: head });
    P.push({ g: cyl(0.012, at.y - h, 8).translate(at.x, (at.y - h) / 2, at.z), c: chrome });
  };
  drum(KIT.snare, 0.17, 0.13);
  drum(KIT.tom1, 0.13, 0.15, 0.3);
  drum(KIT.tom2, 0.14, 0.16, 0.3);
  drum(KIT.floor, 0.19, 0.38, 0);
  const cymbal = (at: THREE.Vector3, r: number) => {
    P.push({ g: new THREE.CylinderGeometry(r * 0.15, r, 0.02, 24).rotateX(-0.15).translate(at.x, at.y, at.z), c: brass });
    P.push({ g: cyl(0.01, at.y, 8).translate(at.x, at.y / 2, at.z), c: chrome });
  };
  cymbal(KIT.hat, 0.17);
  P.push({ g: new THREE.CylinderGeometry(0.17, 0.026, 0.02, 24).translate(KIT.hat.x, KIT.hat.y - 0.03, KIT.hat.z), c: brass });
  cymbal(KIT.crash, 0.22);
  cymbal(KIT.ride, 0.25);
  // The throne.
  P.push({ g: cyl(0.17, 0.07).translate(0, SEAT_Y - 0.035, 0), c: black });
  P.push({ g: cyl(0.025, SEAT_Y - 0.07, 8).translate(0, (SEAT_Y - 0.07) / 2, 0), c: chrome });
  return colored(P);
}

/** The keyboard rig, its player at the origin facing +z: an X-stand, a weighted keyboard, a synth above it. */
const KEYS_TOP = 0.98;
function keyboardRig(): THREE.BufferGeometry {
  const P: Part[] = [];
  const steel = 0x2a2a31,
    body = 0x18181d,
    white = 0xf0eee8,
    accent = 0xff4fa0;
  for (const s of [-1, 1]) {
    P.push({ g: new THREE.BoxGeometry(0.04, 1.2, 0.04).rotateZ(s * 0.62).translate(0, 0.46, 0.42), c: steel });
    P.push({ g: new THREE.BoxGeometry(0.04, 0.04, 0.4).translate(s * 0.34, 0.92, 0.42), c: steel });
  }
  P.push({ g: new THREE.BoxGeometry(1.04, 0.07, 0.32).translate(0, KEYS_TOP - 0.035, 0.44), c: body });
  P.push({ g: new THREE.BoxGeometry(0.92, 0.012, 0.13).translate(0, KEYS_TOP + 0.006, 0.36), c: white });
  for (let k = 0; k < 22; k++) if (k % 7 !== 2 && k % 7 !== 6) P.push({ g: new THREE.BoxGeometry(0.018, 0.014, 0.07).translate(-0.44 + k * 0.042, KEYS_TOP + 0.012, 0.395), c: 0x0a0a0c });
  P.push({ g: new THREE.BoxGeometry(0.9, 0.012, 0.03).translate(0, KEYS_TOP + 0.004, 0.51), c: accent });
  // The synth on the upper tier.
  P.push({ g: new THREE.BoxGeometry(0.04, 0.32, 0.04).translate(-0.3, KEYS_TOP + 0.14, 0.56), c: steel });
  P.push({ g: new THREE.BoxGeometry(0.04, 0.32, 0.04).translate(0.3, KEYS_TOP + 0.14, 0.56), c: steel });
  P.push({ g: new THREE.BoxGeometry(0.8, 0.05, 0.22).rotateX(-0.35).translate(0, KEYS_TOP + 0.3, 0.58), c: body });
  P.push({ g: new THREE.BoxGeometry(0.66, 0.008, 0.08).rotateX(-0.35).translate(0, KEYS_TOP + 0.33, 0.55), c: white });
  return colored(P);
}

/** The bass: its body at the origin, the neck along +x, the strings' face toward +z. */
function bassGuitar(): THREE.BufferGeometry {
  const P: Part[] = [];
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, 0.2, 0.15, 0, Math.PI * 2, false, 0);
  P.push({ g: new THREE.ExtrudeGeometry(shape, { depth: 0.045, bevelEnabled: false, curveSegments: 18 }).translate(-0.04, 0, -0.022), c: 0x1e5aa8 });
  P.push({ g: new THREE.BoxGeometry(0.1, 0.07, 0.006).translate(0.02, 0, 0.026), c: 0xf0eee8 });
  P.push({ g: new THREE.BoxGeometry(0.8, 0.05, 0.03).translate(0.55, 0, 0.005), c: 0x3a2414 });
  P.push({ g: new THREE.BoxGeometry(0.16, 0.08, 0.025).translate(1.02, 0, 0.005), c: 0x101012 });
  for (let k = 0; k < 4; k++) P.push({ g: new THREE.BoxGeometry(1.12, 0.002, 0.002).translate(0.5, -0.015 + k * 0.01, 0.024), c: 0xd8d8de });
  return colored(P);
}

/** The bass neck's angle up from level (radians), and where his hands go along it (m from the body's centre). */
const NECK_UP = 0.42;

/** The kit's pieces by DRUM id (songmaps.ts). */
const DRUMS = [KIT.snare, KIT.hat, KIT.tom1, KIT.tom2, KIT.floor, KIT.crash, KIT.ride];
const STICK = 0.4;

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** The keys player's left-hand chords for a song: where the harmony changes, and each bar's downbeat. */
const chordHits = new WeakMap<SongMaps, Float32Array>();
function chordsOf(m: SongMaps): Float32Array {
  let c = chordHits.get(m);
  if (!c) {
    const t: number[] = [];
    for (let b = 0; b < m.chordChange.length; b++) if (m.chordChange[b] || b % 4 === 0) t.push(b * m.beat);
    chordHits.set(m, (c = Float32Array.from(t)));
  }
  return c;
}

export class Band {
  readonly root = new THREE.Group();
  private bass: THREE.Mesh;
  private sticks: THREE.Mesh[] = [];
  private beat: Beat | null = null;
  /** 0..1: playing (eased: they start and stop on the beat, not with a jolt). */
  private play = 0;
  private live = false;
  /** Seconds into her song (-1: not in one), and its maps (null: not worked out yet). */
  private songT = -1;
  private maps: SongMaps | null = null;
  private time = 0;
  private fret = 0.42;
  private t = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private rh = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private left = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  /** The drummer's stick tips this frame: height over the drum they're on (m), and the song time (for the curious and the tests). */
  readonly strike = { t: -1, r: 0, l: 0, kick: 0 };

  constructor(
    scene: THREE.Scene,
    private people: (Person | null)[],
  ) {
    this.root.name = 'stage-band';
    scene.add(this.root);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.35 });
    const geos: THREE.BufferGeometry[] = [];
    for (const b of BAND) {
      const y = STAGE.y + b.riser;
      if (b.role === 'drums') geos.push(drumKit().rotateY(b.yaw).translate(b.x, y, b.z));
      if (b.role === 'keys') geos.push(keyboardRig().rotateY(b.yaw).translate(b.x, y, b.z));
    }
    const rigs = new THREE.Mesh(mergeGeometries(geos)!, mat);
    rigs.name = 'band-rigs';
    rigs.raycast = () => {};
    this.root.add(rigs);
    this.bass = new THREE.Mesh(bassGuitar(), mat);
    this.bass.name = 'band-bass';
    this.bass.matrixAutoUpdate = false;
    this.bass.raycast = () => {};
    this.root.add(this.bass);
    // The drumsticks (hickory, a pale tip), placed each frame from the drummer's hands to where they strike.
    const stickGeo = colored([
      { g: new THREE.CylinderGeometry(0.0065, 0.0075, STICK, 6).translate(0, STICK / 2, 0), c: 0xc8a878 },
      { g: new THREE.SphereGeometry(0.009, 6, 4).translate(0, STICK, 0), c: 0xe8dcc0 },
    ]);
    for (let k = 0; k < 2; k++) {
      const st = new THREE.Mesh(stickGeo, mat);
      st.name = `band-stick-${k}`;
      st.matrixAutoUpdate = false;
      st.raycast = () => {};
      st.visible = false;
      this.root.add(st);
      this.sticks.push(st);
    }
    BAND.forEach((b, k) => {
      const p = people[k];
      if (!p) return;
      const home = new THREE.Vector3(b.x, STAGE.y + b.riser, b.z);
      if (b.role === 'drums') {
        p.seated = true;
        p.seatY = home.y + SEAT_Y;
      }
      p.onUpdate = (q) => {
        // Shoved about, they're back at their instruments.
        q.pos.copy(home);
        q.yaw = q.homeYaw = b.yaw;
        q.moving = 0;
      };
      p.onPose = (q) => this.pose(k, q);
    });
  }

  /**
   * One frame: the beat, whether she's on (they play) or not (they stand
   * easy), and where her song is (`songT` s in, -1 between songs) and its maps.
   */
  update(dt: number, b: Beat, live: boolean, songT = -1, maps: SongMaps | null = null) {
    this.beat = b;
    this.live = live;
    this.time += dt;
    this.dtGuess = Math.max(1e-3, dt);
    this.songT = songT;
    this.maps = songT >= 0 ? maps : null;
    if (maps) this.beatLen = maps.beat;
    this.play += ((live ? 1 : 0) - this.play) * Math.min(1, dt * 3);
    if (!this.people[2]) this.bass.visible = false;
  }

  private pose(k: number, p: Person) {
    const rig = p.rig,
      b = this.beat;
    if (!rig || !b) return;
    const bones = rig.bones;
    const role = BAND[k].role;
    const w = this.play;
    const yaw = p.yaw;
    const fx = Math.sin(yaw),
      fz = Math.cos(yaw);
    // Their left (facing the crowd).
    const lx = fz,
      lz = -fx;
    const fwd = this.fwd.set(fx, 0, fz),
      left = this.left.set(lx, 0, lz);
    rig.root.updateMatrixWorld(true);
    // Breathing, always (a slow rise and fall of the chest), and a little sway of the head.
    turnWorld(bones.Chest, left, -0.025 * Math.sin(this.time * 1.8 + k * 2.1));
    turnWorld(bones.Neck, fwd, 0.03 * Math.sin(this.time * 0.7 + k));
    const m = this.maps;
    const T = this.songT;
    if (role === 'drums') {
      if (w < 0.02) {
        this.restSticks(bones, fwd);
        return;
      }
      this.drums(k, p, b, m, T, w, fwd, left);
    } else if (role === 'keys') this.keys(p, b, m, T, w, fwd, left);
    else this.bassist(p, b, m, T, w, fwd, left);
  }

  /** A point on the drum kit (its frame: KIT) for drummer `p`. */
  private kit(k: number, p: Person, v: THREE.Vector3, out: THREE.Vector3) {
    const lx = this.left.x,
      lz = this.left.z,
      fx = this.fwd.x,
      fz = this.fwd.z;
    return out.set(p.pos.x + v.x * lx + v.z * fx, BAND[k].riser + STAGE.y + v.y, p.pos.z + v.x * lz + v.z * fz);
  }

  private drums(k: number, p: Person, b: Beat, m: SongMaps | null, T: number, w: number, fwd: THREE.Vector3, left: THREE.Vector3) {
    const rig = p.rig!,
      bones = rig.bones,
      yaw = p.yaw,
      Tv = this.t;
    nudge(bones.Chest, 0.12 * w);
    if (m) {
      // The kick pedal: the right foot's toes come up between kicks and stamp down on each one;
      // the thigh lifts a touch with it (heel up), and the head nods on the kick.
      const kick = strikeLift(m.kick, T, 1, 0.35);
      this.strike.kick = kick;
      turnWorld(bones.UpperLegR, left, -0.07 * kick * w);
      turnWorld(bones.FootR, left, -0.32 * kick * w);
      const ki = lastAt(m.kick, T);
      const since = ki >= 0 ? T - m.kick[ki] : 9;
      turnWorld(bones.Head, left, 0.1 * Math.exp(-since * 7) * w);
    } else bones.Head?.rotateX((0.06 + 0.1 * b.intensity * w) * Math.exp(-b.phase * 5));
    rig.root.updateMatrixWorld(true);
    const tipR = Tv[5],
      tipL = Tv[6];
    let R: THREE.Vector3, L: THREE.Vector3;
    if (m) {
      R = this.stickTo(k, p, m.rHits, m.rDrum, T, DRUM.hat, tipR, Tv[0]);
      this.strike.r = tipR.y - this.surface;
      L = this.stickTo(k, p, m.lHits, m.lDrum, T, DRUM.snare, tipL, Tv[1]);
      this.strike.l = tipL.y - this.surface;
      this.strike.t = T;
    } else {
      // No map yet: to the beat clock (the right on the hats' eighths, the left on the backbeat).
      const lift = (ph: number) => 0.13 * Math.min(1, ph * 3) * (1 - 0.35 * ph);
      const ph8 = (b.phase * 2) % 1;
      const crash = b.secBar === 0 && b.beatInBar === 0 && (b.section === 'drop' || b.part === 'chorus');
      this.kit(k, p, crash ? KIT.crash : KIT.hat, tipR).y += lift(ph8);
      this.kit(k, p, KIT.snare, tipL).y += b.beatInBar % 2 === 1 ? lift(b.phase) : 0.14;
      R = this.handFor(p, tipR, 0.4, Tv[0]);
      L = this.handFor(p, tipL, 0.4, Tv[1]);
      this.strike.t = -1;
    }
    // Coming in / stopping: hands over the snare.
    const rest = this.kit(k, p, KIT.snare, Tv[2]).setY(Tv[2].y + 0.25);
    R.lerp(rest, 1 - w);
    L.lerp(rest, 1 - w);
    armTo(bones, 'R', R, yaw, Tv[4], w);
    armTo(bones, 'L', L, yaw, Tv[4], w);
    // The sticks, from each hand to its tip (the tip on the drum at the hit).
    this.placeStick(0, bones.WristR ?? bones.HandR, tipR);
    this.placeStick(1, bones.WristL ?? bones.HandL, tipL);
  }
  private surface = 0;
  private beatLen = 0.5;

  /**
   * One stick's tip over a list of strikes (`hits`, on `drums`) at song time
   * `T`: on the drum at each strike, lifting off after it and coming down on
   * the next (moving over to the next drum while it's up). Returns where the
   * hand goes; the tip in `tip`.
   */
  private stickTo(k: number, p: Person, hits: Float32Array, drums: Uint8Array, T: number, idleDrum: number, tip: THREE.Vector3, hand: THREE.Vector3): THREE.Vector3 {
    const i = lastAt(hits, T);
    const d0 = i >= 0 ? drums[i] : idleDrum,
      d1 = i + 1 < hits.length ? drums[i + 1] : d0;
    const t0 = i >= 0 ? hits[i] : -Infinity,
      t1 = i + 1 < hits.length ? hits[i + 1] : Infinity;
    const u = Number.isFinite(t0) && Number.isFinite(t1) ? (T - t0) / Math.max(1e-3, t1 - t0) : 0;
    const a = this.kit(k, p, DRUMS[d0], this.t[3]);
    const bpos = this.kit(k, p, DRUMS[d1], this.t[4]);
    tip.copy(a).lerp(bpos, smooth((u - 0.1) / 0.55));
    this.surface = tip.y;
    const h = strikeLift(hits, T, 0.17, 0.1);
    // Up between hits it isn't still: the stick bobs with the beat (zero on the hits themselves).
    tip.y += h * (1 + 0.18 * Math.sin((T / this.beatLen) * Math.PI * 2 + k));

    return this.handFor(p, tip, h, hand);
  }

  /** Where a hand holds a stick to put its tip at `tip`, the stick `lift` up (the wrist snaps: the hand rises less). */
  private handFor(p: Person, tip: THREE.Vector3, lift: number, out: THREE.Vector3): THREE.Vector3 {
    const dx = tip.x - p.pos.x,
      dz = tip.z - p.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    // The stick runs back toward the body from its tip, sloping up to the hand.
    return out.set(tip.x - (dx / d) * 0.3, tip.y + 0.09 - lift * 0.55, tip.z - (dz / d) * 0.3);
  }

  private placeStick(i: number, wrist: THREE.Object3D | undefined, tip: THREE.Vector3) {
    const st = this.sticks[i];
    if (!wrist) {
      st.visible = false;
      return;
    }
    const grip = wrist.getWorldPosition(this.rh);
    // From a little behind the hand, through it, to the tip.
    const dir = this.t[2].copy(tip).sub(grip);
    const len = dir.length();
    if (len < 1e-3) return void (st.visible = false);
    dir.divideScalar(len);
    const butt = this.t[3].copy(grip).addScaledVector(dir, -0.06);
    this.q.setFromUnitVectors(this.up, dir);
    this.m.compose(butt, this.q, this.t[4].set(1, (len + 0.06) / STICK, 1));
    st.matrix.copy(this.m);
    st.matrixWorldNeedsUpdate = true;
    st.visible = true;
  }

  /** Not playing: the sticks in his hands, tips down to the snare's rim. */
  private restSticks(bones: Record<string, THREE.Object3D | undefined>, fwd: THREE.Vector3) {
    for (let i = 0; i < 2; i++) {
      const wr = i === 0 ? (bones.WristR ?? bones.HandR) : (bones.WristL ?? bones.HandL);
      if (!wr) continue;
      const tip = wr.getWorldPosition(this.t[5]).addScaledVector(fwd, 0.3);
      tip.y -= 0.2;
      this.placeStick(i, wr, tip);
    }
    this.strike.t = -1;
  }

  private keys(p: Person, b: Beat, m: SongMaps | null, T: number, w: number, fwd: THREE.Vector3, left: THREE.Vector3) {
    const rig = p.rig!,
      bones = rig.bones,
      yaw = p.yaw,
      Tv = this.t;
    // A sway with the phrase (two bars side to side), a dip into each bar, a nod on the beat.
    const phrase = m ? T / (8 * m.beat) : b.beats / 8;
    turnWorld(bones.Torso ?? bones.Abdomen, fwd, 0.05 * Math.sin(phrase * Math.PI * 2) * (0.4 + 0.6 * w));
    bones.Head?.rotateX((0.05 + 0.08 * b.intensity * w) * Math.exp(-b.phase * 5));
    if (w < 0.02) return;
    nudge(bones.Chest, (0.16 + 0.04 * Math.exp(-((b.beats % 4) / 4) * 6)) * w);
    rig.root.updateMatrixWorld(true);
    const keyAt = (across: number, depth: number, out: THREE.Vector3) => out.set(p.pos.x + across * left.x + depth * fwd.x, p.pos.y + KEYS_TOP + 0.03, p.pos.z + across * left.z + depth * fwd.z);
    let L: THREE.Vector3, R: THREE.Vector3;
    if (m) {
      // Left hand: a chord where the harmony changes (and each bar), along the keys with its root.
      const ch = chordsOf(m);
      const li = lastAt(ch, T);
      const beatOf = (t: number) => Math.max(0, Math.min(m.chord.length - 1, Math.round(t / m.beat)));
      const acrossL = (j: number) => 0.08 + 0.22 * (m.chord[beatOf(j >= 0 && j < ch.length ? ch[j] : T)] / 11);
      const lu = li >= 0 && li + 1 < ch.length ? (T - ch[li]) / Math.max(1e-3, ch[li + 1] - ch[li]) : 0;
      L = keyAt(acrossL(li) + (acrossL(li + 1) - acrossL(li)) * smooth((lu - 0.5) / 0.4), 0.37, Tv[0]);
      L.y += 0.015 + strikeLift(ch, T, 0.04, 0.03);
      // Right hand: the synths' own hits, wandering up and down the upper keys.
      const ri = lastAt(m.keys, T);
      const acrossR = (j: number) => -0.04 - 0.24 * ((((j * 5) % 7) + 7) % 7) / 6;
      const ru = ri >= 0 && ri + 1 < m.keys.length ? (T - m.keys[ri]) / Math.max(1e-3, m.keys[ri + 1] - m.keys[ri]) : 0;
      R = keyAt(acrossR(ri) + (acrossR(ri + 1) - acrossR(ri)) * smooth((ru - 0.3) / 0.5), 0.37, Tv[1]);
      R.y += 0.015 + strikeLift(m.keys, T, 0.035, 0.025);
    } else {
      const press = Math.exp(-b.phase * 6) * 0.025;
      const run = 0.12 * Math.sin(b.beats * Math.PI * 0.5);
      L = keyAt(0.2, 0.37, Tv[0]);
      L.y += 0.02 - press;
      R = keyAt(-0.14 + run, 0.37, Tv[1]);
      R.y += 0.02 - Math.exp(-((b.phase * 2) % 1) * 6) * 0.02;
    }
    armTo(bones, 'L', L, yaw, Tv[4], w);
    armTo(bones, 'R', R, yaw, Tv[4], w);
  }

  private bassist(p: Person, b: Beat, m: SongMaps | null, T: number, w: number, fwd: THREE.Vector3, left: THREE.Vector3) {
    const rig = p.rig!,
      bones = rig.bones,
      yaw = p.yaw,
      Tv = this.t;
    // A bob on the beat (knees), leaning into it with the song.
    rig.root.position.y -= Math.exp(-b.phase * 4) * 0.022 * w;
    turnWorld(bones.Abdomen ?? bones.Torso, left, (0.04 + 0.04 * b.intensity) * w * (0.6 + 0.4 * Math.exp(-b.phase * 4)));
    bones.Head?.rotateX((0.05 + 0.1 * b.intensity * w) * Math.exp(-b.phase * 5));
    rig.root.updateMatrixWorld(true);
    const sc = rig.root.scale.x;
    const body = Tv[0].set(p.pos.x + fwd.x * 0.16 - left.x * 0.04, rig.root.position.y + 1.0 * sc, p.pos.z + fwd.z * 0.16 - left.z * 0.04);
    // The neck runs up to his left: the guitar's +x along it, +z out toward the crowd.
    const ax = Tv[1].set(left.x * Math.cos(NECK_UP), Math.sin(NECK_UP), left.z * Math.cos(NECK_UP));
    const az = Tv[2].set(fwd.x, 0, fwd.z);
    const ay = Tv[3].crossVectors(az, ax).normalize();
    this.m.makeBasis(ax, ay, az).setPosition(body);
    this.bass.matrix.copy(this.m);
    this.bass.matrixWorldNeedsUpdate = true;
    let fret: number, pl: number;
    if (m) {
      // Fretting hand: to each new note's place on the neck (sliding there just before it's played).
      const i = lastAt(m.bass, T + 0.06);
      const note = i >= 0 ? m.bassNote[i] : 40;
      fret = 0.34 + 0.3 * ((((note - 28) % 12) + 12) % 12) / 11;
      // Plucking hand: through the strings on each note.
      pl = strikeLift(m.bass, T, 0.04, 0.02) * w;
    } else {
      fret = 0.42 + 0.12 * ((Math.floor(b.beats / 4) * 7) % 3) / 2;
      pl = (0.035 - Math.exp(-((b.phase * 2) % 1) * 7) * 0.035) * w;
    }
    this.fret += (fret - this.fret) * Math.min(1, this.dtGuess * 25);
    const Lh = Tv[4].copy(body).addScaledVector(ax, this.fret).addScaledVector(az, 0.04);
    const Rh = this.rh.copy(body).addScaledVector(ax, 0.06).addScaledVector(ay, 0.035 - pl * 0.6).addScaledVector(az, 0.035 + pl);
    armTo(bones, 'L', Lh, yaw, Tv[5], 1);
    armTo(bones, 'R', Rh, yaw, Tv[6], 1);
  }
  private dtGuess = 1 / 60;

  /** For the curious (window.casino.party.band). */
  get now() {
    return { live: this.live, play: +this.play.toFixed(2), members: this.people.filter(Boolean).length, mapped: !!this.maps, strike: this.strike };
  }
}
