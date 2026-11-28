import * as THREE from 'three';
import type { Sound } from '../audio';
import type { Hands } from '../hands';
import type { Interaction } from '../interaction';
import type { Viewpoint } from '../player';
import type { Session } from '../net/session';
import type { PlayerState } from '../net/transport';
import type { Crowd, Person } from '../people';
import { Audience } from './audience';
import { Band } from './band';
import { BeatClock, SYNTH_SET, beatAt, plainArrangement, type Arrangement, type Beat } from './beat';
import { DESK_MOVES, Dancer, MOVE_NAMES, type Move } from './dance';
import { DeckAudio } from './deckaudio';
import { ConcertHype } from './hype';
import type { PartyTalk } from './partytalk';
import { packDecks, unpackDecks } from './deckwire';
import { Decks } from './decks';
import { PartyLights, type PoolLights } from './lights';
import { PARTY_RATE, loadConcert, loadRecord } from './music';
import { STACKS } from './pachain';
import type { Performers } from './performers';
import { BobDetector } from './rhythm';
import { afterAt, cycleLength, liveSlot, makePlan, needsPlan, newer, nightAt, nightTimes, packPlan, planTag, programAt, unpackPlan, type NightState, type NightTimes, type Plan, type Program, type Timing } from './schedule';
import { MC } from './concertlines';
import { elVoice, spoken } from '../cast';
import { voices } from '../voices';
import { AFTER_PLAN, DECK_B_PLAN, DJ_SET, HOUSE_PLAN, INDEX_SONGS, beatMatch, concertLength, deckArrangement, songAt, type SongPlan, type TrackPlan } from './setlist';
import { HEADLINER, Stage, type ShowState } from './stage';
import type { SongMaps } from './songmaps';
import { StageMic } from './stagemic';
import { renderPartyRaw } from './track';

/**
 * The pool party: the DJ's music from the booth's speaker stacks and the
 * headliner's set from the line arrays at her stage (each falls off with
 * distance and is muffled through the building the same way, and the casino's
 * own music ducks out as you come out to the deck), the beat clock everything else
 * follows, the lights, the guests dancing on the floor, you dancing (VR: bob
 * your head to the beat and your legs bounce, throw your hands up on the drop;
 * screen: J cycles dance moves) and your friends dancing too (`dn`).
 *
 * The music: the decks (decks.ts, deckaudio.ts, scratch.ts). Deck A ("No
 * Tomorrow", deck_a.mp3) is the house record the resident DJ plays, the
 * crossfader resting full left; deck B ("Woo and Oh Yeah", deck_b.mp3) comes in
 * when someone at the decks fades right. Step up behind the decks and your mix
 * is what the stacks play (and what your friends hear: `dk` in your state,
 * the faders and where each record is); step away and the house record comes
 * back. Both records run off the wall clock (deck A from its top as each round
 * of the night starts), so a room hears the same bar.
 *
 * The night (schedule.ts: the plan rides in everyone's state as `pz`, so a
 * room shares one running order): the first of you out at the pool starts the
 * party, the DJ dropping "No Tomorrow" from its top; at 1:30 he calls the
 * headliner over the booth's stacks ("in one minute...", the music ducked under
 * him: the take in his voice, el_dj, or until it's recorded a caption over an
 * air horn), the crowd cheers and starts drifting over to her stage
 * (audience.ts); at 2:30 he fades the decks out, the band walks on, she walks
 * on to a roar, and her set (concert_*.mp3) plays from her stage's PA (the
 * decks' engine has a bus for each) while the decks stay silent; then he kicks
 * back in with "One More Drop" (deck_c.mp3) as the crowd drifts back, and the
 * night goes round again.
 *
 * The beat clock follows whichever is playing: the house record's measured
 * tempo and drops, or her song's tempo and sections.
 *
 * Loading (all mono 32 kHz, handed to the audio thread, nothing kept here):
 * deck A as you head for the pool (~26 MB); deck B only while someone's at the
 * decks (released a minute and a half after); the concert from a minute before
 * her set to two minutes after it (~32 MB). If deck A can't be had, dj_set.mp3
 * plays instead, and failing that the synthesized set (track.ts). Her songs
 * are read in a worker as they load (songmaps.ts: her vocal, the drums, bass
 * and keys), so she sings and her band plays what you hear.
 */

/** Start fetching the party's music this long after the casino's started, wherever you are (ms). */
const PREFETCH_AFTER = 25000;
/** The doors from the hotel corridor (the music leaks through them). */
const DOORS = new THREE.Vector3(36, 0, -0.5);
/** Fetch her music this long before her set (s: before the DJ calls her), and let it go this long after (s). */
const CONCERT_AHEAD = 100;
const CONCERT_KEEP = 120;
/** Deck B is let go this long after anyone was last at the decks (s). */
const DECK_B_KEEP = 90;
/** The night's moments, from the house record as index.json has it (the same for everyone: schedule.ts). */
export const NIGHT_TIMES: NightTimes = nightTimes(HOUSE_PLAN.length, HOUSE_PLAN.bar);
/** The DJ's call: the air horn, then his line this long after (s); the decks ducked to this under him. */
const CALL_AFTER_HORN = 0.9;
const CALL_DUCK = 0.5;

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
  /** The DJ, the headliner, her band and her extra audience (added to the crowd early, with the pool's guests). */
  performers?: Performers;
  /** Screen: walk you up to the decks. */
  travel?: (v: Viewpoint) => void;
  /** Is a spot clear for a standing guest (her audience's places)? */
  isFree?: (x: number, z: number) => boolean;
  /** A spoken line's caption (the screen's subtitle, and in VR): the DJ's call until its take is in. */
  say?: (who: string, text: string) => void;
}

export class Party {
  /** The beat everything follows (the house record's, or her song's while she's on). */
  readonly clock = new BeatClock(DJ_SET);
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
  /** The DJ booth's stacks (the decks), and her stage's PA (her set). */
  private stacks: THREE.PositionalAudio[] = [];
  private stagePa: THREE.PositionalAudio[] = [];
  private filters: BiquadFilterNode[] = [];
  private playing: { ctx: number; wall: number } | null = null;
  /** Where the night is (schedule.ts nightAt): for the curious, and the headless checks. */
  night: NightState = nightAt(0, null, { bar: 2, liveLen: 1, lead: 1, after: 0 }, NIGHT_TIMES);
  private calledRound = -1;
  private toldRound = -1;
  private wasFade = false;
  private callUntil = -Infinity;
  private ducked = 1;
  private mcBus: GainNode | null = null;
  /** The night's moments as they happened here (wall s, for the curious: window.casino.party.show.timeline). */
  readonly timeline: { at: number; what: string }[] = [];
  private lastPhase = '';
  /** Where the music comes from: the records, dj_set standing in for deck A, or the synthesized fallback. */
  source: 'decks' | 'dj_set' | 'synth' | null = null;
  private rendering = false;
  private runningFor = 0;
  private dt = 0;
  private session: Session | null = null;
  private cheeredDrop = -1;
  private cheeredAt = -100;
  private time = 0;
  /** The turntables (and the resident DJ), her stage and band, and the engine that plays it all. */
  readonly decks: Decks;
  readonly stage: Stage;
  readonly band: Band | null;
  readonly audience: Audience | null;
  /** Friends' avatars this frame (her audience waits for them to pass too). */
  private friendsAt: THREE.Vector3[] = [];
  deck: DeckAudio | null = null;
  /** The house record (deck A) and deck B as they're playing (index.json's, or measured from the files). */
  house: TrackPlan = HOUSE_PLAN;
  deckB: TrackPlan | null = DECK_B_PLAN;
  private houseArr: Arrangement = DJ_SET;
  private bLoaded = false;
  private bLoading = false;
  private bUsedAt = -Infinity;
  /** Her songs (index.json's until the files are in, then as measured), and whether her set's loaded. */
  songs: (SongPlan | null)[] = INDEX_SONGS;
  liveReady = false;
  private concertLoading = false;
  private concertFailedAt = -Infinity;
  /** The running order (schedule.ts): when her first set starts; the newest anyone in the room made wins. */
  plan: Plan | null = null;
  private wasHere = false;
  /** The records' offsets (s) as the stacks are playing them (yours at the decks, a friend's, or the house's: 0). */
  private off = [0, 0];
  private sentOff = [0, 0];
  private remote: ReturnType<typeof unpackDecks> = null;
  /** Seconds since anyone was at the decks (from the start: nobody, so deck A is on the night's grid at once). */
  private emptyFor = 3;
  private prevXf = 0;
  private program: Program = { live: false, into: -1, next: Infinity, set: -1 };
  private announced = -1;
  /** Drops that have landed (for the curious: window.casino.party). */
  drops = 0;
  /** The stage's mic: step up and you're on the PA (stagemic.ts). */
  readonly mic: StageMic;
  /** The crowd's hype around her set: its sound, hands and phones up, the fans at the back (hype.ts). */
  readonly hype: ConcertHype;
  /** The party as the guests' chatter sees it (partytalk.ts: dialogue.ts and crew.ts). */
  readonly talk: PartyTalk;
  /** Each of her songs' maps (songmaps.ts), once they're worked out (kept: they're small). */
  readonly maps: (SongMaps | null)[] = [];

  /** Her mouth as she sings (faces.ts: like a recorded voice line), for her alone. */
  mouthLevel(p: Person): { level: number; vowel: number } | null {
    return p === this.stage.singer ? this.stage.mouth : null;
  }

  /** How closed someone's eyes are beyond blinking (hers, on a long held note). */
  eyesClosed(p: Person): number {
    return p === this.stage.singer ? this.stage.eyesClosed : 0;
  }

  constructor(private d: PartyDeps) {
    this.lights = new PartyLights(d.scene, d.dj, d.lights, d.poles);
    this.decks = new Decks({ scene: d.scene, camera: d.camera, renderer: d.renderer, crowd: d.crowd, dj: d.dj, person: d.performers?.dj, hands: d.hands, interaction: d.interaction, travel: d.travel });
    this.decks.onTouch = (by) => {
      for (const { handedness, gamepad } of d.interaction?.gamepads() ?? []) {
        if (handedness !== by) continue;
        (gamepad as Gamepad & { hapticActuators?: { pulse(v: number, ms: number): void }[] }).hapticActuators?.[0]?.pulse(0.45, 30);
      }
    };
    this.stage = new Stage({ scene: d.scene, crowd: d.crowd, sound: d.sound, person: d.performers?.singer });
    this.band = d.performers?.band?.length ? new Band(d.scene, d.performers.band) : null;
    const extras = d.performers?.extras ?? [];
    const dance = (p: Person, dancer: Dancer) => {
      p.onPose = (q) => {
        if (!q.rig || q.moving > 0.2) return;
        const b = this.clock.now;
        dancer.pose(q.rig, { beat: b, dt: this.dt, amount: 1, move: dancer.moveFor(b), arms: true, handsUp: q.cheer > 0 ? Math.min(1, q.cheer * 2) : 0, scale: q.rig.root.scale.x, film: q.prop === 'phone' && q.photo ? 1 : 0 });
      };
    };
    for (const [k, p] of [...d.dancers, ...extras].entries()) {
      const dancer = new Dancer(p.seed + k * 7.1);
      this.guests.set(p, dancer);
      dance(p, dancer);
    }
    this.audience = d.dancers.length || extras.length ? new Audience(d.dancers, extras, d.isFree ?? (() => true), Math.PI) : null;
    this.hype = new ConcertHype({ scene: d.scene, sound: d.sound, crowd: d.crowd, audience: this.audience, singer: this.stage.singer, band: d.performers?.band ?? [], dj: d.performers?.dj ?? null, isFree: d.isFree });
    const at = new THREE.Vector3();
    this.talk = { phase: () => this.hype.phase, at: (x, z) => d.where(at.set(x, 0, z)) === 'pool' };
    // The DJ booth's two stacks (the decks), and the two line arrays at her stage (her set): the same
    // speakers, carrying the same way (STACKS), muffled the same way through the building.
    const speaker = (anchor: THREE.Object3D) => {
      const a = new THREE.PositionalAudio(d.sound.listener);
      // Equal-power panning: the speakers' direction without HRTF's per-source convolution (four big
      // sources, cheaper on a headset), and a level that follows the distances, not the ear's filtering.
      a.panner.panningModel = 'equalpower';
      a.setRefDistance(STACKS.ref);
      a.setRolloffFactor(STACKS.rolloff);
      a.setDistanceModel('inverse');
      a.setMaxDistance(STACKS.max);
      // Fed from the decks' node (no playback control of its own): without this its panner never leaves the origin.
      (a as { hasPlaybackControl: boolean }).hasPlaybackControl = false;
      const f = d.sound.listener.context.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 20000;
      a.setFilter(f);
      f.connect(a.getOutput());
      anchor.add(a);
      this.filters.push(f);
      return a;
    };
    for (const [k, x] of [-2.6, 2.6].entries()) {
      const anchor = new THREE.Object3D();
      anchor.position.set(d.dj.x + x, 1.7, d.dj.z - 0.5);
      anchor.name = `party-stack-${k}`;
      d.scene.add(anchor);
      this.stacks.push(speaker(anchor));
    }
    for (const anchor of this.stage.pa) this.stagePa.push(speaker(anchor));
    // The stage mic plays from her PA.
    this.mic = new StageMic({ listener: d.sound.listener, stacks: this.stage.pa, stage: this.stage, hands: d.hands, toast: d.toast });
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

  /** The schedule's grid, her set's length, the DJ's lead-in and his record after her (index.json's: the same for everyone). */
  timing(): Timing {
    return { bar: HOUSE_PLAN.bar, liveLen: Math.max(HOUSE_PLAN.bar, concertLength(this.songs)), lead: NIGHT_TIMES.lead, after: AFTER_PLAN?.length ?? 0 };
  }

  /** Wall-clock seconds as the music hears them (the audio clock while it plays, so the lights sit on the beat). */
  wall(): number {
    if (this.playing) {
      const ctx = this.d.sound.listener.context;
      const lat = ctx.outputLatency || ctx.baseLatency || 0;
      return ctx.currentTime - this.playing.ctx + this.playing.wall - lat;
    }
    return Date.now() / 1000;
  }

  /** Who's playing now. */
  get onAir(): 'dj' | 'live' {
    return this.liveReady && this.program.live ? 'live' : 'dj';
  }

  /** What's on (for the curious and the tests: window.casino.party.show). */
  get show() {
    const p = this.program;
    const n = this.night;
    return { phase: n.phase, party: +n.party.toFixed(1), toSet: Number.isFinite(n.toSet) ? +n.toSet.toFixed(1) : null, gather: +n.gather.toFixed(1), fade: +n.gain.toFixed(3), round: n.round, houseAt: +this.housePos(this.wall()).toFixed(1), timeline: this.timeline.slice(-12), onAir: this.onAir, after: +this.afterInto(this.wall()).toFixed(1), afterReady: this.afterReady, plan: this.plan && { start: this.plan.start, rev: this.plan.rev }, inSec: Number.isFinite(p.next) ? +p.next.toFixed(1) : null, into: +p.into.toFixed(1), set: p.set, liveReady: this.liveReady, cycle: +cycleLength(this.timing()).toFixed(1), slot: +liveSlot(this.timing()).toFixed(1), extras: this.audience?.here ?? 0, deckB: this.bLoaded, off: this.off.map((v) => +v.toFixed(3)), remote: !!this.remote };
  }

  /** How much a spot is at the party (1 on the deck, a little by the doors in the corridor). */
  presenceAt(p: THREE.Vector3): number {
    const w = this.d.where(p);
    if (w === 'pool') return 1;
    if (w === 'hotel') return THREE.MathUtils.clamp(1 - Math.hypot(p.x - DOORS.x, p.z - DOORS.z) / 9, 0, 1) * 0.6;
    return 0;
  }

  /** The beat to dance to at a spot: the party's out here, the casino's groove inside. */
  beatFor(p: THREE.Vector3): Beat {
    if (this.presenceAt(p) > 0.25) return this.clock.now;
    const t = this.d.sound.musicTime();
    return t === null ? this.clock.now : beatAt(t, this.d.sound.musicArr);
  }

  /** Your body's size follows your average head height while you dance (the knees take the bob). */
  selfEye(headY: number): number {
    const avg = this.bob.average;
    return Number.isFinite(avg) ? headY + (avg - headY) * this.level : headY;
  }

  /** Hooks the room: publish your dancing, the running order and your decks; dance your friends' avatars; share confetti. */
  connect(session: Session) {
    this.session = session;
    const prev = session.extraState;
    session.extraState = () => ({
      ...(prev?.() ?? {}),
      dn: this.netState(),
      pz: packPlan(this.plan),
      ...(this.decks.atDecks ? { dk: packDecks({ ...this.decks.params, offA: this.off[0], offB: this.off[1] }) } : {}),
      // On the stage mic: friends route your voice through the PA (and see your mouth move even without voice chat).
      ...(this.mic.onMic ? { onMic: true, ...(session.voice.enabled ? {} : { mo: Math.round(this.mic.level * 9) }) } : {}),
    });
    this.mic.connect(session);
    session.dancer = (p, s, tracked) => this.danceFriend(p, s, tracked);
    session.on('confetti', (f, dd) => {
      const at = f.person ? f.person.pos.clone().setY(f.person.pos.y + 1.7) : new THREE.Vector3(Number(dd.x) || 0, Number(dd.y) || 0, Number(dd.z) || 0);
      if (Number.isFinite(at.x)) this.lights.showerAt(at, f.person?.pos.y ?? 0);
    });
  }

  /** You left the room. */
  disconnect() {
    this.session = null;
    this.remote = null;
    this.mic.connect(null);
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

  /** The room's running order and decks, from your friends' states. */
  private hearFriends() {
    this.remote = null;
    if (!this.session) return;
    for (const { state } of this.session.friendStates()) {
      const s = state as PlayerState & { pz?: unknown; dk?: unknown };
      const p = unpackPlan(s.pz);
      if (p) this.plan = newer(this.plan, p);
      if (!this.remote) this.remote = unpackDecks(s.dk);
    }
  }

  /**
   * Fetches deck A and starts the decks (in time with the wall clock); her
   * music and deck B come when they're needed. dj_set stands in for deck A,
   * and the synthesized set for that.
   */
  private startAudio() {
    if (this.rendering) return;
    this.rendering = true;
    const ctx = this.d.sound.listener.context;
    (async () => {
      const deckP = DeckAudio.create(ctx);
      let rec: { plan: TrackPlan; raw: { data: Float32Array<ArrayBuffer>; sampleRate: number; loop: number } };
      try {
        rec = await loadRecord('deck_a');
        this.source = 'decks';
      } catch (e) {
        console.warn('Party: deck A could not be loaded, playing dj_set', e);
        try {
          rec = await loadRecord('dj_set');
          this.source = 'dj_set';
        } catch (e2) {
          console.warn('Party: no DJ set either, playing the synthesized set', e2);
          const raw = await renderPartyRaw(PARTY_RATE);
          rec = { plan: { ...HOUSE_PLAN, bpm: 122, bar: 240 / 122, length: raw.loop, bars: 64, firstBeat: 0, perBar: [] }, raw };
          this.source = 'synth';
        }
      }
      const deck = await deckP;
      // Each bus → a limiter (the PA's protection: nothing past -1 dBFS reaches the speakers) → its speakers:
      // the decks to the booth's stacks, her set to her stage's line arrays.
      const limiter = () => {
        const lim = ctx.createDynamicsCompressor();
        lim.threshold.value = -3;
        lim.knee.value = 0;
        lim.ratio.value = 20;
        lim.attack.value = 0.002;
        lim.release.value = 0.12;
        return lim;
      };
      const djLim = limiter(),
        liveLim = limiter();
      deck.output.connect(djLim);
      deck.liveOutput.connect(liveLim);
      this.stacks.forEach((a, i) => {
        djLim.connect(this.filters[i]);
        a.setVolume(0);
      });
      this.stagePa.forEach((a, i) => {
        liveLim.connect(this.filters[this.stacks.length + i]);
        a.setVolume(0);
      });
      this.house = rec.plan;
      this.houseArr = this.source === 'synth' ? SYNTH_SET : rec.plan.perBar.length ? deckArrangement(rec.plan) : plainArrangement(rec.plan.bpm, rec.plan.bars);
      this.clock.setArrangement(this.houseArr);
      deck.setRecord(0, rec.raw);
      const w = Date.now() / 1000;
      deck.sync(ctx.currentTime, w);
      deck.onOffset = (off) => {
        // You let go of a record somewhere new (at the decks): that's where it is now.
        if (this.decks.atDecks) {
          this.off[0] = off[0];
          this.off[1] = off[1];
          this.sentOff[0] = off[0];
          this.sentOff[1] = off[1];
        } else this.sentOff[0] = this.sentOff[1] = NaN; // (a friend's record: put it back where they have it)
      };
      this.deck = deck;
      this.playing = { ctx: ctx.currentTime, wall: w };
      this.pushSchedule();
    })().catch((e) => console.warn('Party track failed', e));
  }

  /** Tells the audio thread when she's on (only once her music's in). */
  private pushSchedule() {
    if (!this.deck) return;
    const t = this.timing();
    const on = this.liveReady && !!this.plan;
    const after = this.afterReady && this.afterPlan && this.plan ? Math.min(this.afterPlan.length, cycleLength(t) - liveSlot(t) - t.lead) : 0;
    const N = NIGHT_TIMES;
    this.deck.setSchedule({ on: on ? 1 : 0, start: this.plan?.start ?? 0, slot: liveSlot(t), cycle: cycleLength(t), after, fadeTo: t.lead - N.fadeAt, fadeLen: N.fadeLen });
  }

  /** Seconds into the DJ's after-set record at wall time `w` (-1: not on, or not loaded). */
  private afterInto(w: number): number {
    return this.afterReady && this.afterPlan ? afterAt(w, this.plan, this.timing(), this.afterPlan.length) : -1;
  }

  /**
   * The DJ's after-set record ("One More Drop", deck_c.mp3): fetched with her
   * music (a minute before her set) and kept through to its end; let go once
   * the house record's back and her next set is still a while off.
   */
  private manageAfter(p: Program, w: number) {
    if (!this.deck || this.source === 'synth' || !this.afterPlan) return;
    const need = p.live || p.next < CONCERT_AHEAD || afterAt(w, this.plan, this.timing(), this.afterPlan.length) >= 0;
    if (need && !this.afterReady && !this.afterLoading && this.time - this.afterFailedAt > 30) {
      this.afterLoading = true;
      loadRecord('deck_c')
        .then(({ plan, raw }) => {
          this.afterPlan = plan;
          this.afterArr = deckArrangement(plan);
          this.deck?.setAfter(raw);
          this.afterReady = true;
        })
        .catch((e) => {
          console.warn("Party: the DJ's after-set record could not be loaded (the house record plays on)", e);
          this.afterFailedAt = this.time;
        })
        .finally(() => (this.afterLoading = false));
    } else if (!need && this.afterReady) {
      this.deck.setAfter(null);
      this.afterReady = false;
    }
  }
  /** The after-set record as it plays (index.json's, or measured from the file) and its sections. */
  afterPlan: TrackPlan | null = AFTER_PLAN;
  private afterArr: Arrangement | null = AFTER_PLAN ? deckArrangement(AFTER_PLAN) : null;
  afterReady = false;
  private afterLoading = false;
  private afterFailedAt = -Infinity;
  private pushedSchedule = '';

  /** Deck B: fetched while anyone's at the decks, let go a while after. */
  private manageDeckB(inUse: boolean) {
    if (!this.deck) return;
    if (inUse) this.bUsedAt = this.time;
    if (inUse && !this.bLoaded && !this.bLoading) {
      this.bLoading = true;
      loadRecord('deck_b')
        .then(({ plan, raw }) => {
          this.deckB = plan;
          this.deck?.setRecord(1, raw);
          this.deck?.setSpeed(1, beatMatch(this.house.bpm, plan.bpm));
          this.bLoaded = true;
        })
        .catch((e) => console.warn('Party: deck B could not be loaded', e))
        .finally(() => (this.bLoading = false));
    } else if (!inUse && this.bLoaded && this.time - this.bUsedAt > DECK_B_KEEP) {
      this.deck.setRecord(1, null);
      this.bLoaded = false;
    }
  }

  /** Her music: fetched a minute before her set, let go two minutes after. */
  private manageConcert(p: Program, w: number) {
    if (!this.deck || this.source === 'synth') return;
    const soon = p.live || p.next < CONCERT_AHEAD;
    if (soon && !this.liveReady && !this.concertLoading && this.time - this.concertFailedAt > 30) {
      this.concertLoading = true;
      loadConcert()
        .then(({ songs, raw, maps }) => {
          this.songs = songs;
          this.stage.setSongs(songs);
          this.deck?.setLive(raw);
          this.liveReady = true;
          // Her songs' maps (her vocal, the drums, bass and keys), worked out in a worker a moment later.
          maps.forEach((p, i) =>
            p.then((m) => {
              if (!m) return;
              this.maps[i] = m;
              this.stage.setMaps(i, m);
            }),
          );
        })
        .catch((e) => {
          console.warn("Party: the concert's music could not be loaded (the DJ plays on)", e);
          this.concertFailedAt = this.time;
        })
        .finally(() => (this.concertLoading = false));
    } else if (!soon && this.liveReady && this.plan && p.set >= 0 && w - (this.plan.start + p.set * cycleLength(this.timing()) + liveSlot(this.timing())) > CONCERT_KEEP) {
      // (Two minutes after her set ended, not when her next is two minutes off: her audience walks
      // back to the DJ's floor on the time since it ended, which needs her set's timing kept that long.)
      this.deck.setLive(null);
      this.liveReady = false;
    }
  }

  /**
   * One frame. `you`: your feet and head, VR hands (null on a screen), and
   * whether you're in VR; `selfDancing` set from here for your own body.
   */
  update(dt: number, you: { feet: THREE.Vector3; head: THREE.Vector3; hands: { l: THREE.Vector3 | null; r: THREE.Vector3 | null } | null; xr: boolean; dancingAllowed: boolean }) {
    this.dt = dt;
    this.time += dt;
    this.lastFeet.copy(you.feet);
    const ctx = this.d.sound.listener.context;
    const w0 = this.d.where(you.feet);
    if (ctx.state === 'running') {
      this.runningFor += dt;
      // Fetched as you head for the pool, or once the casino's music has been playing a while.
      const ready = this.d.sound.musicReadyAt;
      const idle = ready >= 0 && performance.now() - ready > PREFETCH_AFTER;
      if (this.runningFor > 1 && (w0 === 'pool' || w0 === 'hotel' || idle)) this.startAudio();
    }

    // The running order: the room's newest plan; arriving with her next set far off, bring it closer.
    this.hearFriends();
    const W = this.wall();
    const here = w0 === 'pool';
    // (The first of you out at the pool starts the party: "No Tomorrow" from its top, her set `lead` later.)
    if (here && !this.wasHere && needsPlan(this.plan)) {
      this.plan = makePlan(W, this.timing(), planTag(), Date.now());
    }
    this.wasHere = here;
    const prog = (this.program = programAt(W, this.plan, this.timing()));
    const night = (this.night = nightAt(W, this.plan, this.timing(), NIGHT_TIMES));
    this.logPhase(night, W);
    const sched = JSON.stringify([this.liveReady, this.afterReady, this.afterPlan?.length, this.plan?.start, this.plan?.rev, this.timing().liveLen]);
    if (sched !== this.pushedSchedule) {
      this.pushedSchedule = sched;
      this.pushSchedule();
    }
    this.manageConcert(prog, W);
    this.manageAfter(prog, W);
    const live = prog.live && this.liveReady;
    const afterT = live ? -1 : this.afterInto(W);

    // The decks: yours if you're at them, else a friend's, else the house record at rest.
    const local = this.decks.atDecks;
    const remote = local ? null : this.remote;
    this.manageDeckB(local || !!remote);
    // The beat: her song while she's on, the house record (where deck A is) otherwise.
    let b: Beat;
    let song = -1,
      songBeat = 0,
      songT = 0;
    if (live) {
      const at = songAt(this.songs, prog.into);
      song = at.song;
      const sp = song >= 0 ? this.songs[song] : null;
      if (sp) {
        this.clock.setArrangement(sp.arr);
        b = this.clock.update(at.t);
        songBeat = at.t / (60 / sp.bpm);
        songT = at.t;
      } else {
        this.clock.setArrangement(this.houseArr);
        b = this.clock.update(this.housePos(W));
      }
    } else if (afterT >= 0 && this.afterArr) {
      // After her set: the DJ's record, its own tempo and drops.
      this.clock.setArrangement(this.afterArr);
      b = this.clock.update(afterT);
    } else {
      this.clock.setArrangement(this.houseArr);
      b = this.clock.update(this.housePos(W));
    }

    // Where you are: the music opens up as you come out to the deck.
    const pres = this.presenceAt(you.feet);
    this.presence += (pres - this.presence) * Math.min(1, dt * 2);
    const open = this.presence;
    const cutoff = 260 * Math.pow(75, open);
    const vol = STACKS.vol * (0.05 + 0.95 * Math.pow(open, 1.5)) * (this.d.sound.musicOn ? 1 : 0);
    for (const f of this.filters) f.frequency.setTargetAtTime(cutoff, ctx.currentTime, 0.08);
    // The stage mic (its PA plays from the same stacks); the music ducks while someone talks into it.
    this.mic.update(dt, you.head, !you.xr, open, cutoff);
    this.callHer(night, W);
    if (this.playing) {
      for (const a of this.stacks) a.gain.gain.setTargetAtTime(vol * this.mic.duck, ctx.currentTime, 0.02);
      for (const a of this.stagePa) a.gain.gain.setTargetAtTime(vol * this.mic.duck, ctx.currentTime, 0.02);
    }

    // The stage, her band and her audience.
    const r = this.d.renderer;
    const scale = r.xr.isPresenting ? 750 : r.getDrawingBufferSize(this.v2).y / (2 * Math.tan(THREE.MathUtils.degToRad(this.d.camera.fov) / 2));
    const show: ShowState = { ready: this.liveReady, live, song, songBeat, toLive: prog.next, bar: 240 / this.clock.bpm, t: songT };
    this.stage.update(dt, b, show, scale);
    this.band?.update(dt, b, live || (this.liveReady && prog.next < 4 * this.house.bar), live && song >= 0 ? songT : -1, live && song >= 0 ? (this.maps[song] ?? null) : null);
    if (this.audience) {
      // Her crowd gathers from just after the DJ's call (unless her music's just failed to load: the DJ plays on).
      const show = this.liveReady || this.time - this.concertFailedAt > 60;
      this.friendsAt.length = 0;
      for (const q of this.d.crowd.people) if (q.driven && !q.away) this.friendsAt.push(q.pos);
      this.audience.update(dt, { gather: show ? night.gather : -1, since: night.since }, this.stage.singer?.pos ?? this.v3.set(43.3, 0.6, -32.4), you.feet, this.friendsAt);
    }
    const called = night.phase === 'called' || night.phase === 'fade' || night.phase === 'walkon';
    this.hype.update(dt, { beat: b, onBeat: this.clock.onBeat, onBar: this.clock.onBar, ready: this.liveReady, live, song, into: prog.into, toLive: prog.next, bar: 240 / this.clock.bpm, called, presence: this.presence, you: you.feet });
    if (this.stage.live && this.presence > 0.5 && this.announced !== prog.set) {
      this.announced = prog.set;
      this.d.toast(`Live on the pool stage: ${HEADLINER.name}`);
    }

    // The decks (and the DJ's hand on deck A's fader as he fades out for her: the audio thread fades the sound itself).
    const fading = this.liveReady && !!this.plan;
    this.decks.djFade = fading ? night.gain : 1;
    this.decks.onFader = fading && (night.phase === 'fade' || (night.phase === 'called' && night.party > NIGHT_TIMES.fadeAt - 1.2));
    if (fading && night.phase === 'fade' && !this.wasFade && this.decks.atDecks) this.d.toast(`The DJ's fading out: ${HEADLINER.name} is on next`);
    this.wasFade = night.phase === 'fade';
    const params = this.decks.update(dt, b, { feet: you.feet, xr: you.xr });
    this.mixDecks(params, local, remote, W);

    // The drop lands (where the measured drums jump), and the lights kick again half a phrase in.
    if (this.clock.onDrop) {
      this.lights.drop(true);
      this.drops++;
    } else if (this.clock.onBar && b.section === 'drop' && b.secBar === 8) this.lights.drop(false);

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
    const dropWindow = (b.section === 'drop' && b.sinceDrop < 16) || (b.section === 'build' && b.secBar === b.secLen - 1);
    const dropBar = b.section === 'build' ? b.bar + 1 : b.bar - Math.floor(b.sinceDrop / 4);
    if (this.handsUp && dropWindow && this.presence > 0.5 && dropBar !== this.cheeredDrop && this.time - this.cheeredAt > 8) {
      this.cheeredDrop = dropBar;
      this.cheeredAt = this.time;
      const at = you.head.clone();
      this.lights.showerAt(at, you.feet.y);
      this.d.crowd.react(you.feet, 9, 'cheer');
      this.d.sound.play('crowdCheer', you.feet.clone().setY(1.5), { volume: 0.8, ref: 3, rolloff: 1 });
      this.session?.emit('confetti', { x: +at.x.toFixed(2), y: +at.y.toFixed(2), z: +at.z.toFixed(2) });
    }
    // The dancers near you throw their hands up with you on the drop.
    if (this.handsUp && b.section === 'drop' && this.presence > 0.5) {
      for (const p of this.guests.keys()) if (p.pos.distanceTo(you.feet) < 7 && p.cheer < 0.4) p.cheer = 0.6;
    }

    // Lights (dimmed while she holds a freeze).
    this.lights.dim = this.stage.blackout;
    this.lights.update(dt, b, scale);
  }
  private v2 = new THREE.Vector2();
  private v3 = new THREE.Vector3();

  /**
   * The DJ calls her (once a round, as the moment comes: everyone at the same
   * wall time): an air horn from the booth's stacks, then his line over them
   * (the music ducked under it), or its caption until the take's recorded. The
   * crowd cheers. Arriving after the call, you're told how long she'll be.
   */
  private callHer(n: NightState, w: number) {
    const ctx = this.d.sound.listener.context;
    if (n.sinceCall >= 0 && n.sinceCall < 4 && this.calledRound !== n.round) {
      this.calledRound = this.toldRound = n.round;
      const here = this.presence > 0.05;
      this.hype.called(here);
      this.note(`call (${n.party.toFixed(1)} s into the night)`, w);
      if (here) {
        for (const a of this.stacks) if (a.parent) this.d.sound.play('airHorn', a.parent, { volume: 0.9, ref: STACKS.ref, rolloff: STACKS.rolloff });
        const est = 0.9 + spoken(MC.call).length * 0.06;
        this.callUntil = this.time + CALL_AFTER_HORN + (voices.duration(elVoice(MC.id), MC.call) ?? est) + 0.3;
        const voice = elVoice(MC.id);
        setTimeout(() => {
          if (!voices.has(voice, MC.call)) {
            // No take yet: a caption (on screen and in VR), never the browser's voice.
            (this.d.say ?? ((who: string, t: string) => this.d.toast(`${who}: ${t}`)))(MC.name, spoken(MC.call));
            return;
          }
          if (voices.captions) this.d.say?.(MC.name, spoken(MC.call));
          void voices.clip(voice, MC.call).then((buf) => {
            if (!buf || ctx.state !== 'running') return;
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.connect(this.callBus());
            src.start();
          });
        }, CALL_AFTER_HORN * 1000);
      }
    } else if (n.sinceCall >= 4 && n.toSet > 4 && this.toldRound !== n.round && this.presence > 0.5) {
      this.toldRound = n.round;
      this.d.toast(`${HEADLINER.name} takes the pool stage in ${Math.ceil(n.toSet)} s`);
    }
    // The music ducked under him.
    const duck = this.time < this.callUntil ? CALL_DUCK : 1;
    if (duck !== this.ducked && this.deck) {
      this.ducked = duck;
      this.deck.duck(duck);
    }
  }

  /** His mic on the booth's stacks (their distance and muffling, not the music's limiter or duck). */
  private callBus(): GainNode {
    if (!this.mcBus) {
      const ctx = this.d.sound.listener.context;
      this.mcBus = ctx.createGain();
      this.mcBus.gain.value = 1.4;
      for (let i = 0; i < this.stacks.length; i++) this.mcBus.connect(this.filters[i]);
    }
    return this.mcBus;
  }

  /** The night's moments as they happen here (and the console, for the headless checks). */
  private logPhase(n: NightState, w: number) {
    if (n.phase === this.lastPhase) return;
    const first = this.lastPhase === '';
    this.lastPhase = n.phase;
    this.note(`${first ? 'joined: ' : ''}${n.phase} (${n.party.toFixed(1)} s into the night, set in ${Number.isFinite(n.toSet) ? n.toSet.toFixed(1) : '-'} s)`, w);
  }

  private note(what: string, w: number) {
    this.timeline.push({ at: +w.toFixed(2), what });
    if (this.timeline.length > 40) this.timeline.shift();
    console.info(`Party night @${w.toFixed(2)}: ${what}`);
  }

  /** Deck A's offset at rest: the house record at its top as this round of the night started (no plan: the wall clock's). */
  private houseOff(): number {
    const L = this.house.length;
    if (!this.plan || !(L > 0)) return 0;
    return ((-this.night.anchor % L) + L) % L;
  }

  /** Where deck A (the house record) is at rest at wall time `w` (s into its loop). */
  private housePos(w: number): number {
    const L = this.house.length;
    return L > 0 ? ((((w + this.off[0]) % L) + L) % L) : 0;
  }

  /**
   * What the decks play this frame: your hands and faders (and where you've
   * left the records), a friend's at the decks (their faders, platters and
   * records' places), or the house at rest (deck A, crossfader left, both
   * records back on the wall clock's grid once the decks have been empty a moment).
   */
  private mixDecks(local: DeckParamsLike, mine: boolean, remote: ReturnType<typeof unpackDecks>, w: number) {
    const deck = this.deck;
    if (!deck) return;
    if (mine) {
      this.emptyFor = 0;
      // Fading in from full left: deck B comes in on deck A's bar line (unless you've already moved it).
      if (this.prevXf <= 0.001 && local.xf > 0.001 && local.holdB < 0.5 && Math.abs(local.rateB - 1) < 0.01 && this.deckB) {
        const sinceBar = ((((w + this.off[0]) % this.house.bar) + this.house.bar) % this.house.bar);
        const sp = beatMatch(this.house.bpm, this.deckB.bpm);
        const L = this.deckB.length;
        this.off[1] = ((((sinceBar * sp - w * sp) % L) + L) % L);
      }
      this.prevXf = local.xf;
      deck.set(local);
    } else if (remote) {
      this.emptyFor = 0;
      this.off[0] = remote.offA;
      this.off[1] = remote.offB;
      deck.set(remote);
    } else {
      this.emptyFor += this.dt;
      this.prevXf = local.xf;
      // Nobody at the decks: the records go back on the grid (the house record where everyone's is:
      // from its top when this round of the night started).
      if (this.emptyFor > 2) {
        this.off[0] = this.houseOff();
        this.off[1] = 0;
      }
      deck.set(local);
    }
    for (let i = 0; i < 2; i++)
      if (this.off[i] !== this.sentOff[i]) {
        this.sentOff[i] = this.off[i];
        deck.setOffset(i, this.off[i]);
      }
  }

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

type DeckParamsLike = { rateA: number; rateB: number; holdA: number; holdB: number; xf: number; volA: number; volB: number };
