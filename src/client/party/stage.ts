import * as THREE from 'three';
import type { Sound } from '../audio';
import { assets } from '../assets';
import type { Crowd, Person } from '../people';
import { STAGE } from '../areas/pool';
import type { Beat } from './beat';
import { Dancer } from './dance';
import { Burst } from './lights';
import { HEADLINER, LOOK_HEADLINER, SINGER_BACK, dressStar } from './performers';
import { fitToVocals, micFree, routineFor, songEndBar, stepAt, type At, type Step } from './routine';
import { frameAt, lastAt, type SongMaps } from './songmaps';
import { reachArm, turnWorld, type ShowPose } from './showanim';
import { INDEX_SONGS, type SongPlan } from './setlist';

export { HEADLINER };

/**
 * The headliner on the pool stage (the riser west of the DJ booth): NIXIE
 * VALE, an electropop star in her late twenties, an original character made
 * for Palazzo Lago (name, look and moves all invented here, after no real
 * artist), with her band behind her (band.ts). Her set comes round on the
 * party's schedule (schedule.ts: a minute or two after you arrive, then every
 * few minutes), and plays the concert's song(s) (concert_*.mp3: setlist.ts).
 *
 * Two bars before her set she walks from the back of the stage to the mic and
 * grooves there while the crowd cheers her on. Then the show (routine.ts:
 * which move on which beat, read from the song's sections; showanim.ts and
 * scripts/build-show-anims.mjs: the moves, clips played by the beat clock):
 * verses at the mic stand, a hand on the mic as she sings (sways, hip rolls,
 * isolations, a hair flip); the mic comes off the stand for each chorus and
 * she takes the whole stage: a big pose on the drop, side steps, arm sweeps
 * over the crowd, spins, a hair flip, a crowd call; back to the stand for the
 * next verse; the final pose as the music lets go, a bow, a wordless call or
 * two. The pool cheers the big moves (crowd.react) and the end of the song
 * (cheer.mp3); at the end of her set she waves goodbye to applause
 * (applause.mp3). Her audience gathers in front of her (audience.ts).
 *
 * The show around her: a neon marquee with her name over the band, two follow
 * spots from the front truss that track her across the stage, four beams
 * fanning from the back truss (wider and brighter with the song's builds and
 * drops); a strobe on the beat as the chorus drops and on the final pose (on
 * the beat only: two flashes a second at most), the stage going dark but for
 * the follow spots while she holds a freeze (the rest of the party's lights dim
 * with it: `blackout`), a burst of haze along the back of the stage as each
 * chorus comes in, confetti from the truss on the final pose.
 *
 * Draws: marquee, beams, mic, the stand's pole, her, and the haze and confetti
 * only while they fly.
 */

/** Where her set is, worked out by the party from the schedule and the concert's songs. */
export interface ShowState {
  /** Her music is loaded (else the DJ plays on through her slot). */
  ready: boolean;
  /** Her set is on. */
  live: boolean;
  /** Which song (-1: between / after them), and beats into it. */
  song: number;
  songBeat: number;
  /** Seconds until her next set (0 while it's on). */
  toLive: number;
  /** One bar now (s): she walks on two bars before her set. */
  bar: number;
  /** Seconds into the song (as you hear it). */
  t: number;
}

/** Moves that leave her free to sing and gesture (her free arm can emote over them). */
const SINGING_MOVES = new Set(['Show_Sway', 'Show_HipRoll', 'Show_Iso', 'Show_Groove', 'Show_GlideL', 'Show_GlideR', 'Show_KneePop']);

export interface StageDeps {
  scene: THREE.Scene;
  crowd: Crowd;
  sound: Sound;
  /** Her, if the pool's crowd already has her (else she's added here). */
  person?: Person | null;
}

const SING = new THREE.Vector3(STAGE.spot.x, STAGE.y, STAGE.spot.z);
const BACK = SINGER_BACK;
/** The stand's base, and the mic on it (in the stand's frame: pointing up at her mouth). */
const STAND = new THREE.Vector3(STAGE.mic.x, STAGE.y, STAGE.mic.z);
const MIC_IN_STAND = new THREE.Vector3(0, 1.52, -0.07);
/** Where her left hand takes the pole for the trick (in the stand's frame). */
const POLE_GRIP = new THREE.Vector3(0, 1.08, -0.012);
const MIC_AIM = new THREE.Vector3(STAGE.spot.x, STAGE.y + 1.68, STAGE.spot.z + 0.12);
/** How far forward of the mic she stands to sing in the chorus (m; the stand's 0.47 m in front of her at the mic). */
const CHORUS_Z = 0.08;
/** Fastest she'll move to catch up with the routine (joining mid-song). */
const CATCH_UP = 2.5;
/** The fewest seconds between the crowd's cheers for her moves. */
const CHEER_GAP = 5;

/** The stand trick: how far the stand leans back toward her (radians) `b` beats in. */
function standTilt(b: number): number {
  const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const MAX = 0.48;
  if (b < 0.6) return 0;
  if (b < 1.8) return MAX * ease((b - 0.6) / 1.2);
  if (b < 2.1) return MAX;
  // Let go: it swings back up and over, and she catches it.
  if (b < 2.5) return MAX - (MAX + 0.12) * ease((b - 2.1) / 0.4);
  if (b < 3.0) return -0.12 * (1 - ease((b - 2.5) / 0.5));
  return 0;
}
/** Hands on the stand during the trick (0..1): her right on the mic, `left` her left on the pole. */
function standGrip(b: number, left: boolean): number {
  const win = (a: number, z: number, e: number) => Math.max(0, Math.min(1, (b - a) / e, (z - b) / e));
  return left ? win(0.4, 2.05, 0.25) : Math.max(win(0.2, 2.1, 0.25), win(2.45, 4.2, 0.12));
}

export class Stage {
  readonly root = new THREE.Group();
  readonly singer: Person | null;
  /** Her PA's two line arrays (where her set and the stage mic play from). */
  readonly pa: THREE.Object3D[] = [];
  /** She's on (her set is playing and she's at the mic or out performing). */
  live = false;
  /** 0..1: the stage dark but for her follow spots (she's holding a freeze); the party's lights dim with it. */
  blackout = 0;
  private marquee: THREE.ShaderMaterial;
  private beams: THREE.InstancedMesh;
  private mic: THREE.Mesh;
  /** The stand's pole and clip, turning about its base. */
  private stand: THREE.Mesh;
  private micOnStandAt = new THREE.Vector3();
  private haze: Burst;
  private confetti: Burst;
  private dancer = new Dancer(42.7);
  private beat: Beat | null = null;
  private dt = 0;
  private time = 0;
  /** Where she's headed (and facing when there). */
  private goal = BACK;
  private goalYaw = Math.PI / 2;
  private onStage = false;
  /** She's got to the mic this set (from then on the routine places her). */
  private arrived = false;
  /** 0..1: the mic in her hand (chorus) rather than on the stand. */
  private held = 0;
  private sing = 0;
  private point = 0;
  private prevPart = '';
  private hands = { l: new THREE.Vector3(), r: new THREE.Vector3(), lw: 0, rw: 0, init: false };
  /** You've lifted the mic off its stand (VR): it's in your hand, not her. */
  private youHold = false;
  /** Someone on the mic she points out to (and how long she keeps pointing). */
  private fan = new THREE.Vector3();
  private fanT = 0;
  // The routine.
  private routines: Step[][] = [];
  private at: At = { step: routineFor(['verse', 'verse', 'verse', 'verse', 'outro'], 4)[0], i: 0, f: 0, into: 0, x: 0 };
  private wasLive = false;
  private prevSong = -1;
  private prevTo = Infinity;
  /** Performing a routine now (the clips have loaded and her set is on). */
  private performing = false;
  private song = -1;
  private stepKey = -1;
  private fired = { confetti: -1, adlib: -1 };
  private lastCheer = -100;
  private movesReady = false;
  private movesAsked = false;
  private pose_: ShowPose = { move: 'Show_Groove', f: 0, own: 1 };
  private spot = new THREE.Vector3();
  private tilt = 0;
  private flash = 0;
  private t = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private col = new THREE.Color();
  private down = new THREE.Vector3(0, -1, 0);
  private lv = new THREE.Vector3();
  // (Its top leans back toward her and a little to her left: the axis is up × that way.)
  private tiltAxis = new THREE.Vector3(-1, 0, -0.35).normalize();
  private crowdAt = new THREE.Vector3(STAGE.spot.x + 2.5, 0, STAGE.z1 + 2.2);
  private cheerAt = new THREE.Vector3(STAGE.spot.x + 2.5, 1.5, STAGE.z1 + 2.2);
  private headAt = new THREE.Vector3();
  private dressed: unknown = null;

  /** Her routines, one per song, from the songs' sections (and, once they're in, where she really sings). */
  setSongs(songs: (SongPlan | null)[]) {
    this.songPlans = songs;
    this.routines = songs.map((p, i) => {
      if (!p) return [];
      const parts = p.info.map((b) => b.part);
      const r = routineFor(parts, songEndBar(parts));
      const m = this.maps[i];
      return m ? fitToVocals(r, m.beatVocal) : r;
    });
  }
  private songPlans: (SongPlan | null)[] = [];

  /** A song's maps (songmaps.ts) are in: her mouth, her mic and her moves follow its vocal from now on. */
  setMaps(i: number, m: SongMaps | null) {
    this.maps[i] = m;
    this.setSongs(this.songPlans);
  }
  private maps: (SongMaps | null)[] = [];
  /** Her voice now: how open her mouth is (0..1) and the vowel (0..1: open "ah" .. narrow "ee"); null when she isn't singing. */
  private voice_ = { level: 0, vowel: 0 };
  private voicing = false;
  /** In a sung line (or about to be), held out to the crowd in an instrumental break, seconds to her next line. */
  private inLine = false;
  private breakOut = 0;
  private toLine = Infinity;
  /** Her body singing: a breath in before a line (0..1), a held note (s, and 0..1 eased), leaning back, the free arm. */
  private breath = 0;
  private holdS = 0;
  private holdK = 0;
  private lean = 0;
  private emote = 0;
  private eyes = 0;
  private lineNo = 0;

  /** Her mouth as the song sings it (faces.ts), or null when she's not singing. */
  get mouth(): { level: number; vowel: number } | null {
    return this.voicing ? this.voice_ : null;
  }

  /** 0..1: her eyes closed (a long held note). */
  get eyesClosed(): number {
    return this.eyes;
  }

  constructor(private d: StageDeps) {
    this.setSongs(INDEX_SONGS);
    this.root.name = 'pool-stage';
    d.scene.add(this.root);

    // The marquee behind her.
    this.marquee = marqueeMaterial();
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.0), this.marquee);
    sign.position.set(STAGE.spot.x, STAGE.y + 2.35, STAGE.z0 + 0.12);
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

    // The stand's pole and clip (the base is the stage's), pivoting at the base.
    const pole = new THREE.CylinderGeometry(0.011, 0.011, 1.44, 8).translate(0, 0.72, 0);
    const clip = new THREE.BoxGeometry(0.02, 0.05, 0.07).translate(0, 1.47, -0.03);
    this.stand = new THREE.Mesh(mergeTwo(pole, clip), new THREE.MeshStandardMaterial({ color: 0x2a2a31, metalness: 0.85, roughness: 0.35 }));
    this.stand.position.copy(STAND);
    this.stand.raycast = () => {};
    this.stand.name = 'mic-stand';
    this.root.add(this.stand);
    this.stand.updateMatrixWorld(true);
    this.micOnStandAt.copy(MIC_IN_STAND).applyMatrix4(this.stand.matrixWorld);

    // The mic (on the stand, or in her hand).
    const head = new THREE.SphereGeometry(0.026, 12, 8).translate(0, 0, 0.03);
    const handle = new THREE.CylinderGeometry(0.017, 0.012, 0.16, 10).rotateX(Math.PI / 2).translate(0, 0, -0.06);
    const mg = mergeTwo(head, handle);
    this.mic = new THREE.Mesh(mg, new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.8, roughness: 0.35 }));
    this.mic.position.copy(this.micOnStandAt);
    this.mic.lookAt(MIC_AIM);
    this.mic.raycast = () => {};
    this.root.add(this.mic);

    // Her PA: a line array flown from the front of the truss either side of her (her set plays from
    // these, and the stage mic: party/index.ts, stagemic.ts), five cabinets curving down toward the crowd.
    const cabs: THREE.BufferGeometry[] = [];
    let y = 0,
      tilt = 0.05;
    cabs.push(new THREE.BoxGeometry(0.66, 0.05, 0.5).translate(0, 0.05, 0));
    for (let k = 0; k < 5; k++) {
      const box = new THREE.BoxGeometry(0.62, 0.2, 0.42).translate(0, -0.1, 0).rotateX(tilt).translate(0, y, 0);
      cabs.push(box);
      y -= 0.2 * Math.cos(tilt) + 0.01;
      tilt += 0.07 + k * 0.03;
    }
    const grille = new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.85, metalness: 0.2 });
    for (const [k, x] of [STAGE.x0 + 0.55, STAGE.x1 - 0.55].entries()) {
      const arr = new THREE.Mesh(mergeAll(cabs), grille);
      arr.position.set(x, STAGE.y + 3.42, STAGE.z1 - 0.12);
      arr.rotation.y = (k ? 1 : -1) * 0.12;
      arr.raycast = () => {};
      arr.name = `stage-pa-${k}`;
      this.root.add(arr);
      // Where the sound comes from: the middle of the array.
      const anchor = new THREE.Object3D();
      anchor.position.set(0, -0.5, 0.05);
      anchor.name = `stage-pa-anchor-${k}`;
      arr.add(anchor);
      this.pa.push(anchor);
    }
    this.root.updateMatrixWorld(true);

    // Haze along the back of the stage (chorus), confetti from the front truss (the final pose).
    this.haze = new Burst(this.root, { count: 56, life: 5, up: 0.5, spread: 2.2, drag: 1.0, grav: -0.05, size: 0.6, flutter: 0.35, grow: 0.6, confetti: false });
    this.confetti = new Burst(this.root, { count: 420, life: 7.5, up: 2.6, spread: 2.4, drag: 1.7, grav: 1.2, size: 0.05, flutter: 1, grow: 0, confetti: true });

    // Her: waiting at the back of the stage until her set.
    this.singer = d.person ?? d.crowd.add('watch', LOOK_HEADLINER, BACK, Math.PI / 2);
    if (this.singer) {
      const p = this.singer;
      p.curious = false;
      p.onUpdate = (q, dt) => this.walk(q, dt);
      p.onPose = (q) => this.pose(q);
    }
  }

  /** Where the mic's head is (world): on its stand, in her hand or in yours. */
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
    this.mic.position.copy(this.micOnStandAt);
    this.mic.lookAt(MIC_AIM);
  }

  /** Someone just stepped up to the mic while she's on: she points out to them. */
  pointAt(at: THREE.Vector3) {
    this.fan.copy(at);
    this.fanT = 2.2;
  }

  /** What she's doing (for the curious: window.casino.party.stage.now). */
  get now() {
    return { performing: this.performing, song: this.song, move: this.at.step.move, f: +this.at.f.toFixed(3), x: +this.at.x.toFixed(2), hand: this.at.step.hand, blackout: +this.blackout.toFixed(2) };
  }

  /** One frame: where her set is (`show`); `fxScale` the points' size scale (pixels per metre at 1 m: lights.ts). */
  update(dt: number, b: Beat, show: ShowState, fxScale = 600) {
    this.dt = dt;
    this.time += dt;
    this.beat = b;
    const ready = show.ready;
    // Walk on two bars before her set; off when it's over.
    this.onStage = ready && (show.live || show.toLive <= 2 * show.bar);
    if (!this.onStage) this.arrived = false;
    else if (this.singer && this.singer.pos.distanceTo(SING) < 0.12) this.arrived = true;
    this.goal = this.onStage ? SING : BACK;
    this.goalYaw = this.onStage ? 0 : Math.PI / 2;
    this.live = ready && show.live && (this.arrived || !this.singer);
    // Her stage moves: fetched once she's in the scene (the first time the party needs her).
    if (!this.movesAsked && this.singer?.rig && ready) {
      this.movesAsked = true;
      void assets.loadShowClips().then((ok) => (this.movesReady = ok));
    }

    // The routine: which song, which move, where.
    this.song = this.live && show.song >= 0 && this.routines[show.song]?.length ? show.song : -1;
    this.performing = this.live && this.song >= 0 && this.movesReady && !!this.singer?.rig;
    if (this.performing) {
      stepAt(this.routines[this.song], show.songBeat, this.at);
      this.cues(b);
    }
    // The crowd: she walks on, a song's music ends, her set's over.
    const prevPart = this.prevPart;
    this.prevPart = b.part;
    if (ready) {
      if (show.live && !this.wasLive) this.react('on');
      else if (!show.live && this.wasLive) this.react('off');
      else if (show.live && show.song !== this.prevSong && this.prevSong >= 0 && show.song >= 0) this.point = 2.5;
      else if (show.live && b.part === 'outro' && prevPart !== 'outro') this.react('song');
      // A call as she gets to the mic.
      if (this.prevTo > show.bar && show.toLive <= show.bar && show.toLive > 0 && this.singer) this.adlib(0.9);
    }
    this.wasLive = ready && show.live;
    this.prevSong = show.song;
    this.prevTo = show.toLive;
    this.point = Math.max(0, this.point - dt);
    this.fanT = Math.max(0, this.fanT - dt);

    // The mic: in her hand from the end of the pre-chorus to the end of the song, else on the stand.
    const inHand = this.live && !this.youHold && (this.performing ? this.at.step.hand : b.part === 'chorus' || (b.part === 'outro' && this.held > 0.5));
    this.held += ((inHand ? 1 : 0) - this.held) * Math.min(1, dt * 5);
    // Singing: where the recording's vocal is (songmaps.ts), else the section map's sung bars.
    this.voiceAt(show, b, dt);
    // The stand (tilted by the trick).
    const tilt = this.performing && this.at.step.move === 'Show_StandTilt' ? standTilt(this.at.into) : 0;
    if (tilt !== this.tilt) {
      this.tilt = tilt;
      this.stand.quaternion.setFromAxisAngle(this.tiltAxis, tilt);
      this.stand.updateMatrixWorld(true);
      this.micOnStandAt.copy(MIC_IN_STAND).applyMatrix4(this.stand.matrixWorld);
    }
    if (!this.youHold && (!this.singer?.rig || this.held < 0.01)) {
      this.mic.position.copy(this.micOnStandAt);
      this.mic.lookAt(MIC_AIM);
    }
    // What she's doing, for the mixer (people.ts plays it).
    if (this.singer) {
      const groove = !this.performing && this.movesReady && this.arrived && this.onStage && this.singer.moving < 0.1 && this.singer.cheer < 0.3;
      if (this.performing || groove) {
        const sp = this.pose_;
        sp.move = this.performing ? this.at.step.move : 'Show_Groove';
        sp.f = this.performing ? this.at.f : (b.beats % 2) / 2;
        sp.own = 1;
        this.singer.show = sp;
      } else this.singer.show = null;
    }

    // Lights: the strobe, the blackout, the marquee and the beams.
    this.lightCues(b, dt);
    const u = this.marquee.uniforms;
    u.time.value = this.time;
    u.pulse.value = (b.pulse * (this.live ? 1 : 0.3) + this.flash * 1.5) * (1 - 0.8 * this.blackout);
    const lv = (this.onStage ? 1 : 0.25) * (1 - 0.85 * this.blackout);
    u.live.value += (lv - u.live.value) * Math.min(1, dt * (this.blackout > 0.1 ? 10 : 1.5));
    u.hue.value = (Math.floor(b.bar / 8) % 2) * 0.5 + 0.08 * Math.sin(this.time * 0.2);
    this.updateBeams(b);
    this.haze.update(dt, fxScale);
    this.confetti.update(dt, fxScale);
  }

  /**
   * Where her voice is: in a sung line or between them (the vocal map's
   * phrases), her mouth from the vocal's envelope and vowel (closed in the
   * gaps), a breath in just before each line, a held note's tilt, closed eyes
   * and lean, her free arm with the vocal's intensity; and when the band plays
   * on without her for a while, the mic out to the crowd.
   */
  private voiceAt(show: ShowState, b: Beat, dt: number) {
    const m = this.live && show.song >= 0 ? (this.maps[show.song] ?? null) : null;
    const k = (rate: number) => Math.min(1, dt * rate);
    let sing = 0,
      out = 0,
      breath = 0,
      hold = false,
      level = 0,
      vowel = 0.5;
    if (m) {
      const T = show.t;
      const ph = m.phrases;
      const i = lastAt(ph, T);
      const inPh = i >= 0 && i % 2 === 0;
      const prevEnd = inPh ? T : i >= 1 ? ph[i] : -Infinity;
      const next = inPh ? T : i + 1 < ph.length ? ph[i + 1] : Infinity;
      const gap = next - prevEnd;
      this.toLine = inPh ? 0 : next - T;
      if (inPh && !this.inLine) this.lineNo++;
      this.inLine = inPh;
      // The mic comes up a moment before a line and stays up through a quick breath between two.
      sing = inPh || this.toLine < 0.4 || gap < 1.6 ? 1 : 0;
      // A real break (the band on its own a couple of seconds or more): out to the crowd.
      out = !inPh && gap >= 2.4 && T - prevEnd > 0.35 && this.toLine > 0.8 ? 1 : 0;
      // A breath in over the half second before a line.
      breath = !inPh && this.toLine < 0.5 ? 1 - this.toLine / 0.5 : 0;
      // The jaw follows the vocal a touch ahead (it moves before the sound comes out), shut in the gaps.
      level = frameAt(m.vocal, T + 0.03);
      if (!inPh && this.toLine > 0.03) level *= Math.max(0, 1 - (T - prevEnd) / 0.08);
      vowel = frameAt(m.vowel, T + 0.03);
      hold = inPh && frameAt(m.steady, T) > 0.5 && level > 0.35;
      this.voicing = true;
    } else if (this.live) {
      // No map (yet): the section map's sung bars, a natural-looking flap.
      sing = b.voice;
      const t = this.time;
      level = b.voice * Math.max(0, 0.3 + 0.35 * Math.sin(t * 15) * Math.sin(t * 6.1));
      this.toLine = Infinity;
      this.voicing = b.voice > 0.05;
    } else this.voicing = false;
    this.voice_.level = level;
    // (The vowel colour drifts rather than flickers: lips don't change shape every 10 ms.)
    this.voice_.vowel += (vowel - this.voice_.vowel) * k(12);
    this.sing += (sing - this.sing) * k(sing > this.sing ? 14 : 5);
    this.breakOut += (out - this.breakOut) * k(3);
    this.breath += (breath - this.breath) * k(breath > this.breath ? 20 : 6);
    this.holdS = hold ? this.holdS + dt : Math.max(0, this.holdS - dt * 3);
    const held = Math.min(1, Math.max(0, (this.holdS - 0.25) / 0.35));
    this.holdK += (held - this.holdK) * k(4);
    // Eyes shut on a long note; the big ones (loud, held, in a chorus) lean her back.
    this.eyes += ((this.holdS > 0.6 ? 1 : 0) - this.eyes) * k(10);
    const big = hold && level > 0.6 && (b.part === 'chorus' || b.section === 'drop') ? 1 : 0;
    this.lean += (big * Math.min(1, this.holdS / 0.5) - this.lean) * k(3);
    this.emote += ((this.inLine ? 0.35 + 0.65 * level : 0) - this.emote) * k(3);
  }

  /** The beat the routine's on: what happens as each step starts (and the confetti a beat into the final pose). */
  private cues(b: Beat) {
    const at = this.at,
      s = at.step;
    const key = this.song * 1000 + at.i;
    if (key !== this.stepKey) {
      const first = this.stepKey >= 0 && Math.floor(this.stepKey / 1000) === this.song && at.into < 1;
      this.stepKey = key;
      if (first) {
        if (s.cue === 'jump') {
          // The chorus comes in: haze along the back of the stage, the crowd goes up with her.
          this.haze.fire(this.t[0].set(STAGE.x0 + 0.6, STAGE.y + 0.05, STAGE.z0 + 0.35), this.t[1].set(STAGE.x1 - 0.6, STAGE.y + 0.05, STAGE.z0 + 0.35), { dir: this.t[2].set(0, 0, 1), side: 0.5, floor: STAGE.y });
          this.cheer(1, true);
        } else if (s.cue === 'spin' && s.move === 'Show_Spin2') this.cheer(0.7);
        else if (s.cue === 'kick' && this.routines[this.song][at.i - 1]?.move !== 'Show_Kick') this.cheer(0.6);
        else if (s.cue === 'call') this.cheer(0.8);
        else if (s.cue === 'trick') this.cheer(0.5);
      }
    }
    // A beat into the final pose (she lands it): confetti, and the crowd goes wild.
    if (s.cue === 'final' && at.into >= 1 && at.into < 3 && this.fired.confetti !== key) {
      this.fired.confetti = key;
      const y = STAGE.y + 3.35;
      this.confetti.fire(this.t[0].set(STAGE.x0 + 1.4, y, STAGE.z1 - 0.3), this.t[1].set(STAGE.x1 - 1.4, y, STAGE.z1 - 0.3), { dir: this.t[2].set(0, 0, 1), side: 0.8, floor: 0 });
      this.cheer(1, true);
    }
    // Between songs (the music's let go): a wordless shout or two.
    if (this.fired.adlib !== key && b.voice < 0.05 && ((s.cue === 'final' && at.into >= 1.6) || (s.cue === 'bow' && at.into >= 3.2))) {
      this.fired.adlib = key;
      this.adlib(1);
    }
  }

  private lightCues(b: Beat, dt: number) {
    let dark = 0,
      strobe = false;
    if (this.performing) {
      const { step, into } = this.at;
      if (step.move === 'Show_JumpFreeze') {
        strobe = into < 1.05;
        dark = into > 1.15 && into < 3.5 ? 1 : 0;
      } else if (step.move === 'Show_Freeze') dark = into > 0.12 && into < 1.6 ? 1 : 0;
      else if (step.move === 'Show_Final') strobe = into >= 0.95 && into < 2.05;
    }
    // Into the dark at once, back up quickly.
    this.blackout += (dark - this.blackout) * Math.min(1, dt * (dark ? 18 : 6));
    // The strobe: a white flash on each beat (two a second at most), decaying fast.
    this.flash = strobe ? Math.exp(-b.phase * 9) : Math.max(0, this.flash - dt * 6);
  }

  /** The crowd cheers a big move (`big`: whatever the gap since the last). */
  private cheer(volume: number, big = false) {
    if (!big && this.time - this.lastCheer < CHEER_GAP) return;
    this.lastCheer = this.time;
    this.d.crowd.react(this.crowdAt, 15, 'cheer');
    this.d.sound.play('crowdCheer', this.cheerAt, { volume: 0.55 * volume, ref: 6, rolloff: 1 });
    this.reacted.push('move');
    if (this.reacted.length > 16) this.reacted.shift();
  }

  /** A shout from her (synthesized, wordless: audio.ts 'adlib'). */
  private adlib(volume: number) {
    const p = this.singer;
    if (!p) return;
    this.headAt.copy(p.pos).setY(p.pos.y + 1.6);
    this.d.sound.play('adlib', this.headAt, { volume, ref: 4, rolloff: 1 });
    this.reacted.push('adlib');
    if (this.reacted.length > 16) this.reacted.shift();
  }

  /** The crowd: `on` she walks on, `song` a song's music just ended, `off` her set is over. */
  private react(what: 'on' | 'song' | 'off') {
    this.d.crowd.react(this.crowdAt, 15, 'cheer');
    const at = this.cheerAt;
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
    const lvl = this.marquee.uniforms.live.value as number;
    const lv = Math.max(lvl, this.onStage ? 0.6 : 0) * (0.7 + 0.3 * b.intensity);
    const head = this.t[0];
    if (this.singer) head.copy(this.singer.pos).setY(this.singer.pos.y + 1.2);
    else head.copy(SING).setY(SING.y + 1.2);
    // Follow spots: warm white, from the front corners of the truss, on her wherever she goes
    // (hard white and tight when the rest goes dark).
    const dark = this.blackout;
    const spotR = 0.55 - 0.18 * dark;
    for (let j = 0; j < 2; j++) {
      const src = this.t[1].set(j ? STAGE.x1 - 0.25 : STAGE.x0 + 0.25, STAGE.y + 3.55, STAGE.z1 - 0.2);
      this.col.setRGB(1, 0.92 + 0.08 * dark, 0.8 + 0.2 * dark).multiplyScalar(lv * 1.2 + dark * 0.9 + this.flash * 0.6);
      this.beam(n++, src, this.t[2].copy(head).sub(src), spotR, this.col);
    }
    // Back fans: out over the crowd, sweeping with the beat (wide on the chorus, whipping round in a spin),
    // white on the strobe, off in a blackout.
    const wide = b.part === 'chorus' || b.section === 'drop' ? 1 : b.section === 'build' ? 0.4 + 0.6 * b.build : 0.3;
    const spin = this.performing && this.at.step.cue === 'spin' ? 2.5 : 1;
    const fin = this.performing && this.at.step.cue === 'final' && this.at.into >= 1 ? 1 : 0;
    for (let k = 0; k < 4; k++) {
      const x = STAGE.x0 + 1.1 + k * 1.75;
      const src = this.t[1].set(x, STAGE.y + 3.45, STAGE.z0 + 0.15);
      const sw = (Math.sin(b.beats * Math.PI * 0.25 * spin + k * 1.3) * 0.5 * wide + (k - 1.5) * 0.28) * (1 - fin) + (k - 1.5) * 0.35 * fin;
      const dir = this.t[2].set(Math.sin(sw), (0.35 + 0.25 * Math.sin(b.beats * Math.PI * 0.5 + k)) * (1 - fin) + 1.1 * fin, 1).normalize();
      const h = (0.83 + k * 0.06 + (this.marquee.uniforms.hue.value as number)) % 1;
      this.col.setHSL(h, 0.9 * (1 - this.flash), 0.55 + 0.3 * this.flash).multiplyScalar(lv * (0.6 + 0.6 * b.pulse + this.flash) * (1 - dark));
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

  // --- Her ---------------------------------------------------------------------------

  private walk(p: Person, dt: number) {
    p.pos.y = STAGE.y;
    // The glass: a drink between sets, put down before she goes on.
    p.prop = this.onStage ? 'none' : 'glass';
    if (this.performing) {
      // The routine places her (glides at their own speed; catching up if she's behind).
      const s = this.at.step;
      const out = s.hand ? CHORUS_Z * Math.min(1, Math.abs(this.at.x) / 0.3) : 0;
      this.spot.set(SING.x + this.at.x, STAGE.y, SING.z + out);
      const dx = this.spot.x - p.pos.x,
        dz = this.spot.z - p.pos.z;
      const dist = Math.hypot(dx, dz);
      const k = Math.min(1, (CATCH_UP * dt) / Math.max(dist, 1e-6));
      p.pos.x += dx * k;
      p.pos.z += dz * k;
      p.moving = 0;
      turn(p, 0, dt * 8);
      p.homeYaw = p.yaw;
      return;
    }
    const dx = this.goal.x - p.pos.x,
      dz = this.goal.z - p.pos.z;
    const dist = Math.hypot(dx, dz);
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
    if (rig !== this.dressed) {
      this.dressed = rig;
      dressStar(rig);
    }
    const sc = rig.root.scale.x;
    if (!this.performing) {
      // Off (or her moves haven't loaded): a little groove at the back with her drink, watching the
      // DJ, or at the mic before her set.
      if (p.moving < 0.1 && !p.show) this.dancer.pose(rig, { beat: b, dt: this.dt, amount: 0.35, move: 'groove', arms: false, scale: sc, still: true });
      this.hands.init = false;
      return;
    }
    if (p.cheer > 0.3) return; // waving goodbye (the clip's wave)
    rig.root.updateMatrixWorld(true);
    const bones = rig.bones;
    const yaw = rig.root.rotation.y;
    // Her facing (the clip's spins turn her; the hands follow the head).
    const headP = this.t[0];
    if (bones.Head) bones.Head.getWorldPosition(headP);
    else headP.copy(p.pos).setY(p.pos.y + 1.65);
    const hq = this.q;
    (bones.Head ?? rig.root).getWorldQuaternion(hq);
    const fwd = this.t[5].set(0, 0, 1).applyQuaternion(hq).setY(0);
    if (fwd.lengthSq() < 1e-4) fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    fwd.normalize();
    const fx = fwd.x,
      fz = fwd.z;
    // Her left.
    const lx = fz,
      lz = -fx;
    const { step, into, f } = this.at;
    const sing = this.sing;

    // Her body singing, over the clip: a breath in before each line (the chest lifts, the shoulders
    // rise), on a held note the head tilts (one way, then the other line) and the chin comes up, and
    // on the big ones she leans back into it. (Softer over the dance-heavy moves: they own her body.)
    const calm = SINGING_MOVES.has(step.move) ? 1 : 0.4;
    const left = this.lv.set(lx, 0, lz);
    const br = this.breath * calm,
      hold = this.holdK * calm;
    turnWorld(bones.Abdomen ?? bones.Torso, left, -0.14 * this.lean * calm);
    turnWorld(bones.Chest, left, -0.06 * br - 0.012 * Math.sin(this.time * 1.6));
    turnWorld(bones.ShoulderL, fwd, 0.1 * br);
    turnWorld(bones.ShoulderR, fwd, -0.1 * br);
    if (bones.Head) {
      turnWorld(bones.Head, fwd, (this.lineNo % 2 ? 0.15 : -0.15) * hold);
      turnWorld(bones.Head, left, -0.12 * hold - 0.05 * br);
      bones.Head.getWorldPosition(headP);
    }
    let rw = 0,
      lw = 0;
    const R = this.t[1],
      L = this.t[2];
    if (step.move === 'Show_StandTilt' && !this.youHold) {
      // The trick: hands on the stand (it leans back with her; she lets go and catches it).
      R.copy(MIC_IN_STAND).applyMatrix4(this.stand.matrixWorld);
      R.y -= 0.06;
      L.copy(POLE_GRIP).applyMatrix4(this.stand.matrixWorld);
      rw = standGrip(into, false);
      lw = standGrip(into, true);
    } else if (this.held > 0.5) {
      // The mic at her mouth as she sings (down at her chest between lines), unless the move needs the
      // arm; in an instrumental break, held out to the crowd.
      const k = sing;
      R.set(headP.x + fx * (0.15 + 0.1 * (1 - k)) - lx * 0.02, headP.y - 0.19 - 0.3 * (1 - k), headP.z + fz * (0.15 + 0.1 * (1 - k)) - lz * 0.02);
      if (this.breakOut > 0.01 && bones.UpperArmR) {
        const sh = bones.UpperArmR.getWorldPosition(this.t[3]);
        const o = this.t[4].set(sh.x + fx * 0.5 - lx * 0.08, sh.y + 0.1, sh.z + fz * 0.5 - lz * 0.08);
        R.lerp(o, this.breakOut);
      }
      rw = 1 - micFree(step.move, f);
    } else if (!this.youHold) {
      // At the stand: a hand on the mic as she sings.
      R.copy(this.micOnStandAt);
      R.x -= lx * 0.03;
      R.y -= 0.08;
      R.z -= lz * 0.03 + 0.02;
      rw = sing * 0.85;
    }
    if (this.fanT > 0) {
      // Pointing out to whoever just stepped up to the mic.
      const shoulder = this.t[3];
      (bones.UpperArmL ?? bones.Head)?.getWorldPosition(shoulder);
      const dir = this.t[4].copy(this.fan).sub(shoulder).normalize();
      L.set(shoulder.x + dir.x * 0.55, shoulder.y + 0.1 + dir.y * 0.3, shoulder.z + dir.z * 0.55);
      lw = 1;
    } else if (lw < 0.01 && calm === 1 && this.emote > 0.05 && bones.UpperArmL) {
      // Her free arm with the song: out and up as the line swells, higher on a held note, drifting.
      const e = this.emote;
      const sh = bones.UpperArmL.getWorldPosition(this.t[3]);
      const out = 0.26 + 0.12 * e,
        side = 0.2 + 0.12 * e;
      const drift = Math.sin(this.time * 1.3) * 0.04;
      L.set(sh.x + fx * out + lx * side, sh.y - 0.4 + 0.4 * e * (0.6 + 0.4 * this.holdK) + drift, sh.z + fz * out + lz * side);
      lw = Math.min(0.8, e * 1.2);
    }
    // Smoothed, so the hands don't jump between the clip and a target.
    const k = this.hands.init ? 1 - Math.exp(-this.dt * 14) : 1;
    if (!this.hands.init) {
      this.hands.r.copy(R);
      this.hands.l.copy(L);
    }
    this.hands.init = true;
    this.hands.l.lerp(L, k);
    this.hands.r.lerp(R, k);
    this.hands.rw += (rw - this.hands.rw) * k;
    this.hands.lw += (lw - this.hands.lw) * k;
    this.arm(bones, 'R', this.hands.r, this.hands.rw, fx, fz);
    this.arm(bones, 'L', this.hands.l, this.hands.lw, fx, fz);

    // The mic follows her hand when she holds it.
    if (this.held >= 0.01 && !this.youHold) {
      const wrist = bones.WristR ?? bones.HandR;
      if (wrist) {
        const hand = wrist.getWorldPosition(this.t[1]);
        // Mouth: a little in front of and below the head bone.
        const mouth = this.t[3].set(headP.x + fx * 0.09, headP.y + 0.06, headP.z + fz * 0.09);
        const free = micFree(step.move, f);
        // Held up at the mouth, or pointing along her forearm when the arm's away.
        const inHand = this.t[2].copy(mouth).sub(hand).normalize().multiplyScalar(0.09).add(hand);
        this.mic.position.copy(this.micOnStandAt).lerp(inHand, this.held);
        if (free > 0.5 && bones.LowerArmR) {
          // Along the forearm: from the elbow, out past the hand.
          const elbow = bones.LowerArmR.getWorldPosition(this.t[4]);
          this.mic.lookAt(elbow.sub(hand).negate().add(hand));
        } else if (this.held > 0.5 && this.breakOut > 0.5) {
          // Out to the crowd: the mic's head at them.
          this.mic.lookAt(this.t[4].set(hand.x + fx * 3, hand.y - 0.6, hand.z + fz * 3));
        } else this.mic.lookAt(this.held > 0.5 ? mouth : MIC_AIM);
      }
    }
  }

  /** One of her arms toward `to` by `w` (over the clip), the elbow down, out and back. */
  private arm(b: Record<string, THREE.Object3D | undefined>, S: 'L' | 'R', to: THREE.Vector3, w: number, fx: number, fz: number) {
    const upper = b[`UpperArm${S}`],
      lower = b[`LowerArm${S}`],
      end = b[`Wrist${S}`] ?? b[`Hand${S}`];
    if (!upper || !lower || !end || w <= 0.001) return;
    const dir = S === 'L' ? 1 : -1;
    const pole = upper.getWorldPosition(this.t[4]);
    pole.y -= 0.5;
    pole.x += fz * 0.4 * dir - fx * 0.25;
    pole.z += -fx * 0.4 * dir - fz * 0.25;
    reachArm(upper, lower, end, to, pole, w);
  }
}

function turn(p: Person, want: number, k: number) {
  let dy = want - p.yaw;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  p.yaw += dy * Math.min(1, k);
}

function mergeAll(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return gs.reduce((a, b) => mergeTwo(a, b));
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
 * The marquee: her name in neon (one canvas, channels as masks: R the name,
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
        // Bulbs round the border, chasing when she's on.
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
