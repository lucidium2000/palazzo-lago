import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BAND, STAGE } from '../areas/pool';
import type { Person } from '../people';
import type { Beat } from './beat';
import { armTo, nudge } from './decks';

/**
 * Her band on the pool stage (all original characters): a keyboard player at
 * a two-tier synth rig stage left, a drummer at a kit on a riser at the back,
 * a bassist stage right. While she's on they play in time with the beat clock
 * (so with the song, and the same for everyone in a room): the drummer's right
 * stick on the hi-hat's eighths and the left on the snare's backbeat, a crash
 * on each drop, a fill into each new section; the keys player's hands working
 * the keys; the bassist plucking eighths with the fretting hand moving up the
 * neck each bar; all of them nodding on the beat. Between her sets they're on
 * the stage, standing easy.
 *
 * Draws: the drum kit and keyboard rig (one merged mesh, vertex colours) and
 * the bass guitar (a small mesh that rides in the bassist's hands).
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

export class Band {
  readonly root = new THREE.Group();
  private bass: THREE.Mesh;
  private beat: Beat | null = null;
  /** 0..1: playing (eased: they start and stop on the beat, not with a jolt). */
  private play = 0;
  private live = false;
  private t = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private m = new THREE.Matrix4();
  private rh = new THREE.Vector3();

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

  /** One frame: the beat, and whether she's on (they play) or not (they stand easy). */
  update(dt: number, b: Beat, live: boolean) {
    this.beat = b;
    this.live = live;
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
    // A nod on every beat (harder in the chorus), more while they play.
    const nod = (0.06 + 0.1 * b.intensity * w) * Math.exp(-b.phase * 5);
    bones.Head?.rotateX(nod);
    const T = this.t;
    if (role === 'drums') {
      if (w < 0.02) return;
      nudge(bones.Chest, 0.12 * w);
      rig.root.updateMatrixWorld(true);
      const kit = (v: THREE.Vector3, out: THREE.Vector3) => out.set(p.pos.x + v.x * lx + v.z * fx, BAND[k].riser + STAGE.y + v.y, p.pos.z + v.x * lz + v.z * fz);
      // The sticks: up between hits, down on them (a quick fall, a slower lift).
      const lift = (ph: number) => 0.13 * Math.min(1, ph * 3) * (1 - 0.35 * ph);
      const ph8 = (b.phase * 2) % 1;
      const fill = b.secBar === b.secLen - 1 && b.beatInBar >= 2 && b.secLen > 1;
      const crash = b.secBar === 0 && b.beatInBar === 0 && (b.section === 'drop' || b.part === 'chorus');
      let R: THREE.Vector3, L: THREE.Vector3;
      if (fill) {
        // A fill into the next section: round the toms on sixteenths, hands alternating.
        const s16 = Math.floor(b.phase * 4) + b.beatInBar * 4;
        const ph16 = (b.phase * 4) % 1;
        const drums = [KIT.tom1, KIT.tom2, KIT.floor, KIT.snare];
        R = kit(drums[Math.floor(s16 / 2) % 4], T[0]);
        L = kit(drums[(Math.floor(s16 / 2) + 1) % 4], T[1]);
        (s16 % 2 ? L : R).y += lift(ph16);
        (s16 % 2 ? R : L).y += 0.1;
      } else {
        R = kit(crash ? KIT.crash : b.section === 'drop' && b.part !== 'chorus' ? KIT.ride : KIT.hat, T[0]);
        R.y += lift(ph8);
        L = kit(KIT.snare, T[1]);
        const back = b.beatInBar % 2 === 1;
        L.y += back ? lift(b.phase) : 0.14;
      }
      R.lerp(kit(KIT.snare, T[2]).setY(T[2].y + 0.25), 1 - w);
      L.lerp(kit(KIT.snare, T[3]).setY(T[3].y + 0.25), 1 - w);
      armTo(bones, 'R', R, yaw, T[4], w);
      armTo(bones, 'L', L, yaw, T[4], w);
    } else if (role === 'keys') {
      // A sway, and both hands on the keys: chords pressed on the beat, the right hand running up and down.
      bones.Spine?.rotateZ(0.04 * Math.sin(b.beats * Math.PI * 0.5) * w);
      if (w < 0.02) return;
      nudge(bones.Chest, 0.18 * w);
      rig.root.updateMatrixWorld(true);
      const keyAt = (across: number, depth: number, out: THREE.Vector3) => out.set(p.pos.x + across * lx + depth * fx, p.pos.y + KEYS_TOP + 0.03, p.pos.z + across * lz + depth * fz);
      const press = Math.exp(-b.phase * 6) * 0.025;
      const run = 0.12 * Math.sin(b.beats * Math.PI * 0.5);
      const L = keyAt(0.2, 0.37, T[0]);
      L.y += 0.02 - press;
      const R = keyAt(-0.14 + run, 0.37, T[1]);
      R.y += 0.02 - Math.exp(-((b.phase * 2) % 1) * 6) * 0.02;
      armTo(bones, 'L', L, yaw, T[4], w);
      armTo(bones, 'R', R, yaw, T[4], w);
    } else {
      // The bassist: a bounce on the beat, the bass across his body.
      rig.root.position.y -= Math.exp(-b.phase * 4) * 0.02 * w;
      rig.root.updateMatrixWorld(true);
      const sc = rig.root.scale.x;
      const body = T[0].set(p.pos.x + fx * 0.16 - lx * 0.04, rig.root.position.y + 1.0 * sc, p.pos.z + fz * 0.16 - lz * 0.04);
      // The neck runs up to his left: the guitar's +x along it, +z out toward the crowd.
      const ax = T[1].set(lx * Math.cos(NECK_UP), Math.sin(NECK_UP), lz * Math.cos(NECK_UP));
      const az = T[2].set(fx, 0, fz);
      const ay = T[3].crossVectors(az, ax).normalize();
      this.m.makeBasis(ax, ay, az).setPosition(body);
      this.bass.matrix.copy(this.m);
      this.bass.matrixWorldNeedsUpdate = true;
      // Fretting hand along the neck (a new position each bar), plucking hand over the strings.
      const fret = 0.42 + 0.12 * ((Math.floor(b.beats / 4) * 7) % 3) / 2;
      const Lh = T[4].copy(body).addScaledVector(ax, fret).addScaledVector(az, 0.04);
      const pl = Math.exp(-((b.phase * 2) % 1) * 7) * 0.035 * w;
      const Rh = this.rh.copy(body).addScaledVector(ax, 0.06).addScaledVector(ay, 0.02 - pl).addScaledVector(az, 0.06);
      armTo(bones, 'L', Lh, yaw, T[1], 1);
      armTo(bones, 'R', Rh, yaw, T[2], 1);
    }
  }

  /** For the curious (window.casino.party.band). */
  get now() {
    return { live: this.live, play: +this.play.toFixed(2), members: this.people.filter(Boolean).length };
  }
}
