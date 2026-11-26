import * as THREE from 'three';
import { GROOVE, type Sound } from '../audio';
import type { Hands } from '../hands';
import type { Interaction } from '../interaction';
import type { Viewpoint } from '../player';
import type { Session } from '../net/session';
import type { PlayerState } from '../net/transport';
import type { Crowd, Person } from '../people';
import { BeatClock, beatAt, type Beat } from './beat';
import { DESK_MOVES, Dancer, MOVE_NAMES, type Move } from './dance';
import { PartyLights, type PoolLights } from './lights';
import { DeckAudio } from './deckaudio';
import { Decks } from './decks';
import { BobDetector } from './rhythm';
import { renderHeadlinerTrack, renderScratchRecord } from './song';
import { HEADLINER, Stage } from './stage';
import { renderPartyRaw } from './track';

/**
 * The pool party: the DJ's set playing from the booth's speaker stacks (it
 * falls off with distance and is muffled through the building, and the
 * casino's own music ducks out as you come out to the deck), the beat clock
 * everything else follows, the lights, the guests dancing on the floor, you
 * dancing (VR: bob your head to the beat and your legs bounce, throw your
 * hands up on the drop; screen: J cycles dance moves) and your friends
 * dancing too (a tiny `dn` field in their state).
 *
 * Everyone in a room hears the same bar at the same time: the track's
 * position comes from the wall clock. The set list alternates the DJ's 64
 * bars and the headliner's (stage.ts, song.ts) on that clock, through one
 * engine: the decks (decks.ts, deckaudio.ts), which you can step up to and
 * scratch.
 */

export interface PartyDeps {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  sound: Sound;
  crowd: Crowd;
  dj: { x: number; z: number };
  lights: PoolLights;
  poles: [number, number][];
  dancers: Person[];
  where: (p: THREE.Vector3) => string;
  toast: (text: string) => void;
  /** VR hands (scratching the records) and the pointer/touch system (the decks' click target). */
  hands?: Hands;
  interaction?: Interaction;
  /** Screen: walk you up to the decks. */
  travel?: (v: Viewpoint) => void;
}

/** The pool deck's doors from the hotel corridor (the music leaks through them). */
const DOORS = new THREE.Vector3(36, 0, -0.5);
/** Base level of each speaker stack (two of them). */
const STACK_VOL = 0.55;

export class Party {
  readonly clock = new BeatClock();
  readonly lights: PartyLights;
  /** 0..1: how much you're at the party (casino music ducks by this). */
  presence = 0;
  /** Your dancing: VR head-bob detector, the screen move (null: not dancing), how much (0..1). */
  readonly bob = new BobDetector();
  deskMove: Move | null = null;
  level = 0;
  handsUp = false;
  private me = new Dancer(3.7);
  private guests = new Map<Person, Dancer>();
  private friends = new Map<Person, { d: Dancer; amt: number }>();
  private stacks: THREE.PositionalAudio[] = [];
  private filters: BiquadFilterNode[] = [];
  private playing: { ctx: number; offset: number; loop: number } | null = null;
  private rendering = false;
  private runningFor = 0;
  private dt = 0;
  private session: Session | null = null;
  private cheeredDrop = -1;
  private cheeredAt = -100;
  private time = 0;
  /** The turntables (and the resident DJ), the headliner's stage, and the engine that plays the set. */
  readonly decks: Decks;
  readonly stage: Stage;
  deck: DeckAudio | null = null;
  /** The headliner's set is rendered and in the set list. */
  liveReady = false;
  private announced = -1;

  constructor(private d: PartyDeps) {
    this.lights = new PartyLights(d.scene, d.dj, d.lights, d.poles);
    this.decks = new Decks({ scene: d.scene, camera: d.camera, renderer: d.renderer, crowd: d.crowd, dj: d.dj, hands: d.hands, interaction: d.interaction, travel: d.travel });
    this.decks.onTouch = (by) => {
      for (const { handedness, gamepad } of d.interaction?.gamepads() ?? []) {
        if (handedness !== by) continue;
        (gamepad as Gamepad & { hapticActuators?: { pulse(v: number, ms: number): void }[] }).hapticActuators?.[0]?.pulse(0.45, 30);
      }
    };
    this.stage = new Stage({ scene: d.scene, crowd: d.crowd, sound: d.sound, dancers: d.dancers, djYaw: Math.PI });
    for (const [k, p] of d.dancers.entries()) {
      const dancer = new Dancer(p.seed + k * 7.1);
      this.guests.set(p, dancer);
      p.onPose = (q) => {
        if (!q.rig) return;
        const b = this.clock.now;
        dancer.pose(q.rig, { beat: b, dt: this.dt, amount: 1, move: dancer.moveFor(b), arms: true, handsUp: q.cheer > 0 ? Math.min(1, q.cheer * 2) : 0, scale: q.rig.root.scale.x });
      };
    }
    for (const [k, x] of [-2.6, 2.6].entries()) {
      const anchor = new THREE.Object3D();
      anchor.position.set(d.dj.x + x, 1.7, d.dj.z - 0.5);
      anchor.name = `party-stack-${k}`;
      d.scene.add(anchor);
      const a = new THREE.PositionalAudio(d.sound.listener);
      a.setRefDistance(5);
      a.setRolloffFactor(1.05);
      a.setDistanceModel('inverse');
      a.setMaxDistance(200);
      const f = d.sound.listener.context.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 20000;
      a.setFilter(f);
      anchor.add(a);
      this.stacks.push(a);
      this.filters.push(f);
    }
    addEventListener('keydown', (e) => {
      if (e.code !== 'KeyJ' || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      this.nextMove();
    });
  }

  /** Screen: the next dance move (after the last one, stop). */
  nextMove(): Move | null {
    const i = this.deskMove ? DESK_MOVES.indexOf(this.deskMove) : -1;
    this.deskMove = i + 1 < DESK_MOVES.length ? DESK_MOVES[i + 1] : null;
    this.d.toast(this.deskMove ? `Dancing: ${MOVE_NAMES[this.deskMove]} · J for the next move` : 'You stop dancing');
    return this.deskMove;
  }

  /** Where the DJ's track is now (seconds into the loop): the audio clock while it plays, else the wall clock. */
  trackTime(): number {
    const loop = this.clock.loop;
    if (this.playing) {
      const ctx = this.d.sound.listener.context;
      const lat = ctx.outputLatency || ctx.baseLatency || 0;
      return (ctx.currentTime - this.playing.ctx + this.playing.offset - lat) % loop;
    }
    return (Date.now() / 1000) % loop;
  }

  /** Where the set list is (seconds into two loops: the DJ's, then the headliner's). */
  setTime(): number {
    const period = this.clock.loop * 2;
    if (this.playing) {
      const ctx = this.d.sound.listener.context;
      const lat = ctx.outputLatency || ctx.baseLatency || 0;
      return (((ctx.currentTime - this.playing.ctx + this.playing.offset - lat) % period) + period) % period;
    }
    return (Date.now() / 1000) % period;
  }

  /** Who's playing now. */
  get onAir(): 'dj' | 'live' {
    return this.liveReady && this.setTime() >= this.clock.loop ? 'live' : 'dj';
  }

  /** How much a spot is at the party (1 on the deck, a little by the doors in the corridor). */
  presenceAt(p: THREE.Vector3): number {
    const w = this.d.where(p);
    if (w === 'pool') return 1;
    if (w === 'hotel') return THREE.MathUtils.clamp(1 - Math.hypot(p.x - DOORS.x, p.z - DOORS.z) / 9, 0, 1) * 0.6;
    return 0;
  }

  /** The beat to dance to at a spot: the DJ's out here, the casino's groove inside. */
  beatFor(p: THREE.Vector3): Beat {
    if (this.presenceAt(p) > 0.25) return this.clock.now;
    const t = this.d.sound.musicTime();
    return t === null ? this.clock.now : beatAt(t, GROOVE.bpm, GROOVE.bars);
  }

  /** Your body's size follows your average head height while you dance (the knees take the bob). */
  selfEye(headY: number): number {
    const avg = this.bob.average;
    return Number.isFinite(avg) ? headY + (avg - headY) * this.level : headY;
  }

  /** Hooks the room: publish your dancing, dance your friends' avatars, share confetti. */
  connect(session: Session) {
    this.session = session;
    const prev = session.extraState;
    session.extraState = () => ({ ...(prev?.() ?? {}), dn: this.netState() });
    session.dancer = (p, s, tracked) => this.danceFriend(p, s, tracked);
    session.on('confetti', (f, dd) => {
      const at = f.person ? f.person.pos.clone().setY(f.person.pos.y + 1.7) : new THREE.Vector3(Number(dd.x) || 0, Number(dd.y) || 0, Number(dd.z) || 0);
      if (Number.isFinite(at.x)) this.lights.showerAt(at, f.person?.pos.y ?? 0);
    });
  }

  private netState(): number | undefined {
    const lv = Math.round(this.level * 9);
    if (lv <= 0) return undefined;
    const move = this.deskMove ? DESK_MOVES.indexOf(this.deskMove) + 1 : 0;
    return move * 10 + lv;
  }

  private danceFriend(p: Person, s: PlayerState, tracked: boolean) {
    if (!p.rig) return;
    let f = this.friends.get(p);
    if (!f) this.friends.set(p, (f = { d: new Dancer(p.seed), amt: 0 }));
    const dn = Math.floor(Number(s.dn) || 0);
    const want = dn > 0 ? (dn % 10) / 9 : 0;
    f.amt += (want - f.amt) * Math.min(1, this.dt * 4);
    if (f.amt < 0.01 || p.seated || p.swimHead !== null) return;
    const m = Math.floor(dn / 10);
    const move: Move = m >= 1 && m <= DESK_MOVES.length ? DESK_MOVES[m - 1] : 'groove';
    f.d.pose(p.rig, { beat: this.beatFor(p.pos), dt: this.dt, amount: f.amt, move, arms: !tracked, scale: p.rig.root.scale.x, still: m === 0 });
  }

  /**
   * Renders the DJ's set and starts it through the decks (in time with the wall
   * clock), then the battle record and the headliner's set, which joins the set list.
   */
  private startAudio() {
    if (this.rendering) return;
    this.rendering = true;
    const ctx = this.d.sound.listener.context;
    (async () => {
      const [dj, deck] = await Promise.all([renderPartyRaw(32000), DeckAudio.create(ctx)]);
      const period = dj.loop * 2;
      this.stacks.forEach((a, i) => {
        deck.output.connect(this.filters[i]);
        this.filters[i].connect(a.getOutput());
        a.setVolume(0);
      });
      const offset = (Date.now() / 1000) % period;
      deck.setTrack(0, 2, dj);
      deck.sync(ctx.currentTime, offset);
      this.deck = deck;
      this.playing = { ctx: ctx.currentTime, offset, loop: dj.loop };
      deck.setRecord(await renderScratchRecord(32000));
      deck.setTrack(1, 2, await renderHeadlinerTrack(32000));
      this.liveReady = true;
    })().catch((e) => console.warn('Party track failed', e));
  }

  /**
   * One frame. `you`: your feet and head, VR hands (null on a screen), and
   * whether you're in VR; `selfDancing` set from here for your own body.
   */
  update(dt: number, you: { feet: THREE.Vector3; head: THREE.Vector3; hands: { l: THREE.Vector3 | null; r: THREE.Vector3 | null } | null; xr: boolean; dancingAllowed: boolean }) {
    this.dt = dt;
    this.time += dt;
    this.lastFeet.copy(you.feet);
    const b = this.clock.update(this.trackTime());
    const ctx = this.d.sound.listener.context;
    if (ctx.state === 'running') {
      this.runningFor += dt;
      if (this.runningFor > 3) this.startAudio();
    }

    // Where you are: the music opens up as you come out to the deck.
    const pres = this.presenceAt(you.feet);
    this.presence += (pres - this.presence) * Math.min(1, dt * 2);
    const open = this.presence;
    const cutoff = 260 * Math.pow(75, open);
    const vol = STACK_VOL * (0.05 + 0.95 * Math.pow(open, 1.5)) * (this.d.sound.musicOn ? 1 : 0);
    for (const f of this.filters) f.frequency.setTargetAtTime(cutoff, ctx.currentTime, 0.08);
    if (this.playing) for (const a of this.stacks) a.setVolume(vol);

    // The set list: the headliner on the stage, the decks (and you on them).
    const P = this.setTime();
    this.stage.update(dt, b, P, this.clock.loop, this.liveReady);
    const params = this.decks.update(dt, b, { feet: you.feet, xr: you.xr });
    this.deck?.set(params);
    const set = Math.floor((Date.now() / 1000) / (this.clock.loop * 2));
    if (this.stage.live && this.presence > 0.5 && this.announced !== set) {
      this.announced = set;
      this.d.toast(`Live on the pool stage: ${HEADLINER.name}`);
    }

    // The drop lands.
    if (this.clock.onDrop) this.lights.drop(true);
    else if (this.clock.onBar && b.section === 'drop' && b.cycleBar === 8) this.lights.drop(false);

    // You dancing.
    const myBeat = this.beatFor(you.feet);
    let want = 0;
    if (you.xr) {
      this.bob.update(dt, you.head.y, myBeat.beats);
      want = you.dancingAllowed ? this.bob.level : 0;
      this.deskMove = null;
    } else {
      this.bob.reset();
      if (!you.dancingAllowed && this.deskMove) this.deskMove = null;
      want = this.deskMove ? 1 : 0;
    }
    this.level += (want - this.level) * Math.min(1, dt * (you.xr ? 8 : 4));
    if (this.level < 0.01 && want === 0) this.level = 0;

    // Hands up (both above your head in VR; the hands-up move on a screen).
    const h = you.hands;
    this.handsUp = you.xr ? !!(h && h.l && h.r && h.l.y > you.head.y + 0.02 && h.r.y > you.head.y + 0.02) : this.deskMove === 'up';
    const dropWindow = (b.section === 'drop' && b.sinceDrop < 16) || (b.section === 'build' && b.cycleBar === 31);
    const dropBar = b.bar - b.cycleBar + (b.section === 'build' ? 32 : 0);
    if (this.handsUp && dropWindow && this.presence > 0.5 && dropBar !== this.cheeredDrop && this.time - this.cheeredAt > 8) {
      this.cheeredDrop = dropBar;
      this.cheeredAt = this.time;
      const at = you.head.clone();
      this.lights.showerAt(at, you.feet.y);
      this.d.crowd.react(you.feet, 9, 'cheer');
      this.d.sound.play('cheer', you.feet.clone().setY(1.5), { volume: 0.9 });
      this.session?.emit('confetti', { x: +at.x.toFixed(2), y: +at.y.toFixed(2), z: +at.z.toFixed(2) });
    }
    // The dancers near you throw their hands up with you on the drop.
    if (this.handsUp && b.section === 'drop' && this.presence > 0.5) {
      for (const p of this.guests.keys()) if (p.pos.distanceTo(you.feet) < 7 && p.cheer < 0.4) p.cheer = 0.6;
    }

    // Lights.
    const r = this.d.renderer;
    const scale = r.xr.isPresenting ? 750 : r.getDrawingBufferSize(this.v2).y / (2 * Math.tan(THREE.MathUtils.degToRad(this.d.camera.fov) / 2));
    this.lights.update(dt, b, scale);
  }
  private v2 = new THREE.Vector2();

  /** Screen dancing: the view bounces and sways with the beat (applied by the player). */
  deskBob(): { bob: number; roll: number } {
    if (this.level <= 0 || !this.deskMove) return { bob: 0, roll: 0 };
    const b = this.beatFor(this.lastFeet);
    const g = 0.5 + 0.5 * Math.cos(b.beats * Math.PI * 2);
    const k = this.level * (0.5 + 0.5 * b.intensity);
    const hop = this.deskMove === 'up' ? Math.max(0, -Math.cos(b.beats * Math.PI * 2)) * 0.03 : 0;
    return { bob: (-0.03 * g + hop) * k, roll: 0.025 * Math.sin(b.beats * Math.PI) * k * (this.deskMove === 'step' ? 1.6 : 1) };
  }
  lastFeet = new THREE.Vector3();

  /** Your own VR body: legs bend with your real head's bob, hips sway on the beat. */
  danceSelf(rig: { root: THREE.Object3D; bones: Record<string, THREE.Object3D | undefined> }, _yaw: number, dt: number) {
    if (this.level <= 0.01) return;
    this.me.pose(rig, { beat: this.beatFor(this.lastFeet), dt, amount: this.level, move: 'groove', arms: false, scale: rig.root.scale.x, dip: Math.min(0.12, this.bob.dip) * this.level, still: true });
  }
}
