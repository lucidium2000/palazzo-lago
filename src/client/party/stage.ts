import * as THREE from 'three';
import type { Sound } from '../audio';
import type { Crowd, Person } from '../people';
import { STAGE } from '../areas/pool';
import type { Beat } from './beat';
import { Dancer, type Move } from './dance';
import { armTo } from './decks';
import { HEADLINER, LOOK_HEADLINER, SINGER_BACK } from './performers';
import { SLOT_BARS, SONG_BARS } from './setlist';

export { HEADLINER };

/**
 * The headliner on the pool stage (the riser west of the DJ booth): ORLO
 * VANTE, an original R&B / synth-pop singer made for Palazzo Lago (name,
 * look and songs all invented here; the songs are recordings with real sung
 * vocals, orlo_*.mp3). The party alternates sets on the wall clock: the DJ's
 * 64 bars, then his 64 (two 32-bar songs), then the DJ again.
 *
 * He follows each song's sections (verse, pre-chorus, chorus: setlist.ts):
 * two bars before his set he walks from the back of the stage to the mic and
 * the crowd applauds him on. He sings all the way through, a hand on the mic
 * on its stand through the verse (the other out at the end of each line),
 * reaching out higher as the pre-chorus builds; on the chorus he takes the
 * mic off the stand and steps side to side with it, pointing out at the crowd
 * as it lands and with his free hand up through its last bars. As a song's
 * music ends he lowers the mic and the pool cheers (cheer.mp3); at the end of
 * his set he waves goodbye to applause (applause.mp3). The crowd turns to
 * face him while he's on.
 *
 * The light show: a neon marquee with his name behind him (dim between sets,
 * chasing bulbs and the beat when he's on), two follow spots from the stage's
 * front truss on him and four beams fanning out from the back truss.
 * Four draws (marquee, beams, mic, and him); the stage itself is static (pool.ts).
 */


export interface StageDeps {
  scene: THREE.Scene;
  crowd: Crowd;
  sound: Sound;
  /** The guests dancing in front of the booth and the stage (they turn to face him). */
  dancers: Person[];
  /** Him, if the pool's crowd already has him (else he's added here). */
  person?: Person | null;
  /** Which way the dancers face when he's off (toward the DJ). */
  djYaw: number;
}

const SING = new THREE.Vector3(STAGE.spot.x, STAGE.y, STAGE.spot.z);
const BACK = SINGER_BACK;
/** The mic on its stand (pointing up at his mouth). */
const MIC_ON_STAND = new THREE.Vector3(STAGE.mic.x, STAGE.y + 1.52, STAGE.mic.z - 0.07);
const MIC_AIM = new THREE.Vector3(STAGE.spot.x, STAGE.y + 1.68, STAGE.spot.z + 0.12);

export class Stage {
  readonly root = new THREE.Group();
  readonly singer: Person | null;
  /** He's on (his set is playing and he's at the mic). */
  live = false;
  private marquee: THREE.ShaderMaterial;
  private beams: THREE.InstancedMesh;
  private mic: THREE.Mesh;
  private dancer = new Dancer(42.7);
  private beat: Beat | null = null;
  private dt = 0;
  private time = 0;
  /** Where he's headed (and facing when there). */
  private goal = BACK;
  private goalYaw = Math.PI / 2;
  private onStage = false;
  /** 0..1: the mic in his hand (chorus) rather than on the stand. */
  private held = 0;
  private sing = 0;
  private point = 0;
  private prevP = -1;
  private prevPart = '';
  private hands = { l: new THREE.Vector3(), r: new THREE.Vector3(), init: false };
  /** You've lifted the mic off its stand (VR): it's in your hand, not his. */
  private youHold = false;
  /** Someone on the mic he points out to (and how long he keeps pointing). */
  private fan = new THREE.Vector3();
  private fanT = 0;
  private t = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private col = new THREE.Color();
  private down = new THREE.Vector3(0, -1, 0);
  private crowdAt = new THREE.Vector3(STAGE.spot.x + 2.5, 0, STAGE.z1 + 2.2);

  constructor(private d: StageDeps) {
    this.root.name = 'pool-stage';
    d.scene.add(this.root);

    // The marquee behind him.
    this.marquee = marqueeMaterial();
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.0), this.marquee);
    sign.position.set(STAGE.spot.x, STAGE.y + 1.95, STAGE.z0 + 0.12);
    sign.raycast = () => {};
    sign.name = 'headliner-marquee';
    this.root.add(sign);

    // Beams: two follow spots from the front truss, four fanning from the back.
    const geo = new THREE.ConeGeometry(1, 1, 18, 1, true).translate(0, -0.5, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, alphaMap: beamTex(), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.beams = new THREE.InstancedMesh(geo, mat, 6);
    this.beams.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(18), 3);
    this.beams.frustumCulled = false;
    this.beams.raycast = () => {};
    this.beams.count = 0;
    this.root.add(this.beams);

    // The mic (on the stand, or in his hand).
    const head = new THREE.SphereGeometry(0.026, 12, 8).translate(0, 0, 0.03);
    const handle = new THREE.CylinderGeometry(0.017, 0.012, 0.16, 10).rotateX(Math.PI / 2).translate(0, 0, -0.06);
    const mg = mergeTwo(head, handle);
    this.mic = new THREE.Mesh(mg, new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.8, roughness: 0.35 }));
    this.mic.position.copy(MIC_ON_STAND);
    this.mic.lookAt(MIC_AIM);
    this.mic.raycast = () => {};
    this.root.add(this.mic);

    // Him: waiting at the back of the stage until his set.
    this.singer = d.person ?? d.crowd.add('watch', LOOK_HEADLINER, BACK, Math.PI / 2);
    if (this.singer) {
      const p = this.singer;
      p.curious = false;
      p.onUpdate = (q, dt) => this.walk(q, dt);
      p.onPose = (q) => this.pose(q);
    }
  }

  /** Where the mic's head is (world): on its stand, in his hand or in yours. */
  micHead(out = new THREE.Vector3()): THREE.Vector3 {
    this.mic.updateWorldMatrix(true, false);
    return this.mic.localToWorld(out.set(0, 0, 0.03));
  }

  /** The mic is resting on its stand. */
  get micOnStand(): boolean {
    return !this.youHold && this.held < 0.01;
  }

  /** You lift the mic off its stand: the mesh to carry in your hand. */
  takeMic(): THREE.Object3D {
    this.youHold = true;
    this.held = 0;
    return this.mic;
  }

  /** You let go of it: back on its stand. */
  returnMic() {
    this.youHold = false;
    this.root.add(this.mic);
    this.mic.position.copy(MIC_ON_STAND);
    this.mic.lookAt(MIC_AIM);
  }

  /** Someone just stepped up to the mic while he's on: he points out to them. */
  pointAt(at: THREE.Vector3) {
    this.fan.copy(at);
    this.fanT = 2.2;
  }

  /**
   * One frame: `P` seconds into the set list (two loops: the DJ's, then his),
   * `ready` his track is loaded (else the DJ plays on through).
   */
  update(dt: number, b: Beat, P: number, loop: number, ready: boolean) {
    this.dt = dt;
    this.time += dt;
    this.beat = b;
    const bar = loop / SLOT_BARS;
    const his = ready && P >= loop;
    // Walk on two bars before his set; off when it's over.
    this.onStage = ready && P >= loop - 2 * bar;
    this.goal = this.onStage ? SING : BACK;
    this.goalYaw = this.onStage ? 0 : Math.PI / 2;
    const at = !!this.singer && this.singer.pos.distanceTo(SING) < 0.12;
    this.live = his && (at || !this.singer);

    // The crowd: applause as he comes on, a cheer as each song's music ends, applause as he goes.
    const prev = this.prevP;
    this.prevP = P;
    const prevPart = this.prevPart;
    this.prevPart = b.part;
    if (ready && prev >= 0) {
      const crossed = (x: number) => (prev < x && P >= x) || (x === 0 && P < prev - loop);
      if (crossed(loop)) this.react('on');
      else if (crossed(loop + SONG_BARS * bar)) this.point = 2.5;
      else if (crossed(0)) this.react('off');
      else if (his && b.part === 'outro' && prevPart !== 'outro') this.react('song');
    }
    this.point = Math.max(0, this.point - dt);
    this.fanT = Math.max(0, this.fanT - dt);

    // The crowd faces him while he's on.
    const want = this.onStage;
    for (const p of this.d.dancers) {
      const yaw = want ? Math.atan2(SING.x - p.pos.x, SING.z - p.pos.z) : this.d.djYaw;
      let dy = yaw - p.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      p.yaw += dy * Math.min(1, dt * 1.5);
      p.homeYaw = p.yaw;
    }

    // The mic: off the stand for the chorus (still in his hand as the song ends, back on the stand for the next verse).
    const chorus = this.live && !this.youHold && (b.part === 'chorus' || (b.part === 'outro' && this.held > 0.5));
    this.held += ((chorus ? 1 : 0) - this.held) * Math.min(1, dt * 5);
    // Singing (the recordings are sung all the way through: a breath at the end of each line).
    this.sing += ((this.live ? b.voice : 0) - this.sing) * Math.min(1, dt * 12);
    if (!this.youHold && (!this.singer?.rig || this.held < 0.01)) {
      this.mic.position.copy(MIC_ON_STAND);
      this.mic.lookAt(MIC_AIM);
    }

    // The marquee and the beams.
    const u = this.marquee.uniforms;
    u.time.value = this.time;
    u.pulse.value = b.pulse * (this.live ? 1 : 0.3);
    u.live.value += ((this.onStage ? 1 : 0.25) - u.live.value) * Math.min(1, dt * 1.5);
    u.hue.value = (Math.floor(b.bar / 8) % 2) * 0.5 + 0.08 * Math.sin(this.time * 0.2);
    this.updateBeams(b);
  }

  /** The crowd: `on` he walks on, `song` a song's music just ended, `off` his set is over. */
  private react(what: 'on' | 'song' | 'off') {
    this.d.crowd.react(this.crowdAt, 15, 'cheer');
    const at = this.crowdAt.clone().setY(1.5);
    // The crowd's out on the deck in front of the stage: it carries.
    const far = { ref: 6, rolloff: 1 };
    if (what === 'song') this.d.sound.play('crowdCheer', at, { volume: 1, ...far });
    else this.d.sound.play('applause', at, { volume: what === 'off' ? 1 : 0.85, ...far });
    if (what === 'off') this.d.sound.play('crowdCheer', at, { volume: 0.6, ...far });
    this.reacted.push(what);
    if (this.reacted.length > 16) this.reacted.shift();
    if (!this.singer) return;
    if (what === 'off') this.singer.cheer = 2.2;
    else if (what === 'song') this.point = 2.5;
  }
  /** What the crowd has done (for the curious: window.casino.party.stage). */
  readonly reacted: string[] = [];

  private updateBeams(b: Beat) {
    const on = this.onStage || this.live;
    if (!on) {
      this.beams.count = 0;
      return;
    }
    let n = 0;
    const lv = (this.marquee.uniforms.live.value as number) * (0.7 + 0.3 * b.intensity);
    const head = this.t[0];
    if (this.singer) head.copy(this.singer.pos).setY(this.singer.pos.y + 1.2);
    else head.copy(SING).setY(SING.y + 1.2);
    // Follow spots: warm white, from the front corners of the truss.
    for (const x of [STAGE.x0 + 0.25, STAGE.x1 - 0.25]) {
      const src = this.t[1].set(x, STAGE.y + 3.55, STAGE.z1 - 0.2);
      this.beam(n++, src, this.t[2].copy(head).sub(src), 0.55, this.col.setRGB(1, 0.92, 0.8).multiplyScalar(lv * 1.2));
    }
    // Back fans: out over the crowd, sweeping with the beat (wide on the chorus).
    const wide = b.part === 'chorus' || b.section === 'drop' ? 1 : b.section === 'build' ? 0.4 + 0.6 * b.build : 0.3;
    for (let k = 0; k < 4; k++) {
      const x = STAGE.x0 + 1.1 + k * 1.75;
      const src = this.t[1].set(x, STAGE.y + 3.45, STAGE.z0 + 0.15);
      const sw = Math.sin(b.beats * Math.PI * 0.25 + k * 1.3) * 0.5 * wide + (k - 1.5) * 0.28;
      const dir = this.t[2].set(Math.sin(sw), 0.35 + 0.25 * Math.sin(b.beats * Math.PI * 0.5 + k), 1).normalize();
      const h = (0.83 + k * 0.06 + (this.marquee.uniforms.hue.value as number)) % 1;
      this.col.setHSL(h, 0.9, 0.55).multiplyScalar(lv * (0.6 + 0.6 * b.pulse));
      this.beam(n++, src, dir.multiplyScalar(12), 0.9, this.col);
    }
    this.beams.count = n;
    this.beams.instanceMatrix.needsUpdate = true;
    if (this.beams.instanceColor) this.beams.instanceColor.needsUpdate = true;
  }

  /** A beam from `src` along `v` (its length), opening to radius `r`. */
  private beam(i: number, src: THREE.Vector3, v: THREE.Vector3, r: number, c: THREE.Color) {
    const len = v.length();
    this.q.setFromUnitVectors(this.down, this.t[3].copy(v).divideScalar(len));
    this.m.compose(src, this.q, this.s.set(r, len, r));
    this.beams.setMatrixAt(i, this.m);
    this.beams.setColorAt(i, c);
  }

  // --- Him ---------------------------------------------------------------------------

  private walk(p: Person, dt: number) {
    p.pos.y = STAGE.y;
    const dx = this.goal.x - p.pos.x,
      dz = this.goal.z - p.pos.z;
    const dist = Math.hypot(dx, dz);
    // The glass: a drink between sets, put down before he goes on.
    p.prop = this.onStage ? 'none' : 'glass';
    if (dist > 0.04) {
      const sp = Math.min(1.1, dist * 2.5);
      p.pos.x += (dx / dist) * Math.min(dist, sp * dt);
      p.pos.z += (dz / dist) * Math.min(dist, sp * dt);
      p.moving = sp;
      p.walkPhase += sp * dt * 5.2;
      turn(p, Math.atan2(dx, dz), dt * 6);
    } else {
      p.moving = 0;
      turn(p, this.goalYaw, dt * 3);
    }
    p.homeYaw = p.yaw;
  }

  private pose(p: Person) {
    const rig = p.rig,
      b = this.beat;
    if (!rig || !b) return;
    const sc = rig.root.scale.x;
    const performing = this.live && p.moving < 0.1;
    if (!performing) {
      // Off: a little groove at the back with his drink, watching the DJ.
      if (p.moving < 0.1) this.dancer.pose(rig, { beat: b, dt: this.dt, amount: 0.35, move: 'groove', arms: false, scale: sc, still: true });
      this.hands.init = false;
      return;
    }
    // His moves: swaying at the stand in the verse, grooving into the pre-chorus, a step with the mic on the chorus.
    const chorus = b.part === 'chorus';
    const move: Move = chorus ? 'step' : b.part === 'pre-chorus' ? 'groove' : 'sway';
    this.dancer.pose(rig, { beat: b, dt: this.dt, amount: b.part === 'outro' ? 0.4 : 0.85, move, arms: false, scale: sc, still: !chorus });
    if (p.cheer > 0.3) return; // waving goodbye (the clip's wave)
    rig.root.updateMatrixWorld(true);
    const bones = rig.bones;
    const yaw = rig.root.rotation.y;
    const fx = Math.sin(yaw),
      fz = Math.cos(yaw);
    // Left, from his point of view (he faces +z: his left is +x).
    const lx = Math.cos(yaw),
      lz = -Math.sin(yaw);
    const headP = this.t[0];
    if (bones.Head) bones.Head.getWorldPosition(headP);
    else headP.copy(p.pos).setY(p.pos.y + 1.65);
    const sing = this.sing;
    const ph = b.beats;

    // Right hand: the mic.
    const R = this.t[1];
    if (this.held > 0.5) {
      // In hand: at his mouth when he sings, down at his chest between lines.
      const k = sing;
      R.set(headP.x + fx * (0.11 + 0.1 * (1 - k)) - lx * 0.03, headP.y - 0.1 - 0.32 * (1 - k), headP.z + fz * (0.11 + 0.1 * (1 - k)) - lz * 0.03);
    } else {
      // On the stand: a hand on the mic as he sings, else resting on the pole.
      const k = sing;
      R.set(MIC_ON_STAND.x - lx * 0.03, MIC_ON_STAND.y - 0.08 - 0.42 * (1 - k), MIC_ON_STAND.z - 0.02);
    }
    // Left hand: points at the crowd as the chorus lands (and as a song ends), up through the
    // chorus's last bars, reaching out as the pre-chorus builds and at the end of each verse line, else sways.
    const L = this.t[2];
    const shoulder = this.t[3];
    (bones.UpperArmL ?? bones.Head)?.getWorldPosition(shoulder);
    const lineEnd = b.bar % 2 === 1 && b.beatInBar >= 2;
    if (this.fanT > 0) {
      // Pointing out to whoever just stepped up to the mic.
      const dir = this.t[4].copy(this.fan).sub(shoulder).normalize();
      L.set(shoulder.x + dir.x * 0.55, shoulder.y + 0.1 + dir.y * 0.3, shoulder.z + dir.z * 0.55);
    } else if (this.point > 0 || (chorus && b.secBar < 1)) {
      L.set(shoulder.x + fx * 0.48 + lx * 0.22, shoulder.y + 0.16, shoulder.z + fz * 0.48 + lz * 0.22);
    } else if (chorus && b.secLen - b.secBar <= 4 && sing > 0.3) {
      // The big finish: his free hand up and out.
      L.set(shoulder.x + fx * 0.25 + lx * 0.3, shoulder.y + 0.42 + 0.04 * Math.sin(ph * Math.PI), shoulder.z + fz * 0.25 + lz * 0.3);
    } else if (sing > 0.6 && !chorus && (b.part === 'pre-chorus' || lineEnd)) {
      const lift = 0.05 * Math.sin(ph * Math.PI * 0.5);
      L.set(shoulder.x + fx * 0.32 + lx * 0.3, shoulder.y - 0.05 + lift + 0.14 * (b.section === 'build' ? b.build : 0), shoulder.z + fz * 0.32 + lz * 0.3);
    } else {
      const sw = Math.sin(ph * Math.PI);
      L.set(shoulder.x + fx * 0.22 + lx * (0.12 + 0.05 * sw), shoulder.y - 0.36 + 0.05 * Math.abs(sw), shoulder.z + fz * 0.22 + lz * (0.12 + 0.05 * sw));
    }
    // Smoothed, so the gestures flow.
    const k = this.hands.init ? 1 - Math.exp(-this.dt * 9) : 1;
    this.hands.init = true;
    this.hands.l.lerp(L, k);
    this.hands.r.lerp(R, k);
    armTo(bones, 'L', this.hands.l, yaw, this.t[4]);
    armTo(bones, 'R', this.hands.r, yaw, this.t[4]);

    // The mic follows his hand when he holds it.
    if (this.held >= 0.01 && !this.youHold) {
      const wrist = bones.WristR ?? bones.HandR;
      if (wrist) {
        const hand = wrist.getWorldPosition(this.t[1]);
        // Mouth: a little in front of and below the head bone.
        const mouth = this.t[3].set(headP.x + fx * 0.09, headP.y + 0.06, headP.z + fz * 0.09);
        const inHand = this.t[2].copy(mouth).sub(hand).normalize().multiplyScalar(0.07).add(hand);
        this.mic.position.copy(MIC_ON_STAND).lerp(inHand, this.held);
        this.mic.lookAt(this.held > 0.5 ? mouth : MIC_AIM);
      }
    }
  }
}

function turn(p: Person, want: number, k: number) {
  let dy = want - p.yaw;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  p.yaw += dy * Math.min(1, k);
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const A = a.toNonIndexed(),
    B = b.toNonIndexed();
  const out = new THREE.BufferGeometry();
  for (const k of ['position', 'normal'] as const) {
    const x = A.attributes[k].array as Float32Array,
      y = B.attributes[k].array as Float32Array;
    const z = new Float32Array(x.length + y.length);
    z.set(x);
    z.set(y, x.length);
    out.setAttribute(k, new THREE.BufferAttribute(z, 3));
  }
  return out;
}

function beamTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d')!;
  // Bright at the lamp (the cone's tip: the top of the texture), fading out along the beam.
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(0.35, '#555555');
  grd.addColorStop(1, '#000000');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 64);
  return new THREE.CanvasTexture(c);
}

/**
 * The marquee: his name in neon (one canvas, channels as masks: R the name,
 * G its glow, B the tagline), bulbs chasing round the border; dim between sets.
 */
function marqueeMaterial(): THREE.ShaderMaterial {
  const W = 1024,
    H = 366;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const font = 'italic bold 132px "Trebuchet MS", "Helvetica Neue", Arial, sans-serif';
  // Glow (green channel): the name, blurred wide.
  g.globalCompositeOperation = 'lighter';
  g.font = font;
  g.shadowColor = '#00ff00';
  g.shadowBlur = 38;
  g.fillStyle = '#00ff00';
  for (let i = 0; i < 2; i++) g.fillText(HEADLINER.name, W / 2, H * 0.44);
  g.shadowBlur = 0;
  // The name (red channel): an outline tube, like neon.
  g.strokeStyle = '#ff0000';
  g.lineWidth = 7;
  g.strokeText(HEADLINER.name, W / 2, H * 0.44);
  // Tagline (blue).
  g.font = 'bold 34px "Trebuchet MS", Arial, sans-serif';
  g.fillStyle = '#0000ff';
  g.fillText(HEADLINER.tagline.split('').join(String.fromCharCode(8202)), W / 2, H * 0.79);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, time: { value: 0 }, pulse: { value: 0 }, live: { value: 0.25 }, hue: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float time, pulse, live, hue;
      varying vec2 vUv;
      void main() {
        vec3 t = texture2D(map, vUv).rgb;
        // Neon colour: hot magenta and teal, swapping every 8 bars.
        vec3 a = vec3(1.0, 0.18, 0.62), b = vec3(0.1, 0.95, 0.95);
        vec3 neon = mix(a, b, clamp(hue * 2.0, 0.0, 1.0));
        float on = mix(0.3, 1.0, live) * (0.88 + 0.35 * pulse);
        // A flicker as the sign comes on.
        on *= 0.92 + 0.08 * step(0.5, fract(sin(floor(time * 18.0)) * 43758.5)) * (1.0 - live);
        vec3 col = vec3(0.025, 0.012, 0.045);
        col += neon * t.g * 0.9 * on;
        col += mix(neon, vec3(1.0), 0.55) * t.r * 1.7 * on;
        col += vec3(1.0, 0.86, 0.6) * t.b * mix(0.35, 1.0, live);
        // Bulbs round the border, chasing when he's on.
        vec2 p = vUv * vec2(5.6, 2.0);
        vec2 e = min(p, vec2(5.6, 2.0) - p);
        float edge = min(e.x, e.y);
        float s = (e.y < e.x) ? p.x : p.y;
        float cell = fract(s / 0.14);
        float dot = smoothstep(0.045, 0.02, length(vec2(cell - 0.5, (edge - 0.07) / 0.14) * vec2(0.14, 0.14)));
        float idx = floor(s / 0.14) + (e.y < e.x ? 0.0 : 100.0);
        float chase = step(0.5, fract(idx / 3.0 - time * 2.5 * live));
        col += vec3(1.0, 0.82, 0.5) * dot * mix(0.35, 1.3 * chase + 0.15, live);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
