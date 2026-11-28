import * as THREE from 'three';
import type { Crowd, FightPose, Look, Person } from '../people';
import { fightPose, staffLook } from '../people';
import type { World } from '../world';
import type { Player } from '../player';
import type { Hands } from '../hands';
import type { Sound } from '../audio';
import type { Hud } from '../hud';
import type { Dialogue } from '../dialogue';
import type { ReactKind } from '../reactlines';
import { SPEAKERS } from '../cast';
import { mouthOf, voices } from '../voices';
import type { VoiceId } from '../speech';
import type { Friend, Session } from '../net/session';
import { Anger, temperament, type Provocation, type Temperament } from './anger';
import { Brawl, MOVES, PHASES, T, type Phase, type PoseOut } from './brawl';
import type { Blow, Zone } from './health';
import { You, KO_SECONDS } from './you';
import { Bars, type OverheadBar } from './bars';
import { slapSnap, touchLean, type FaceHit } from './slap';
import { FightMode } from './mode';
import { HitSparks } from './sparks';
import { punchImpact, speedOf, type Impact, type Spot } from './impact';
import { CREW_FIGHT, CROWD_FIGHT, FIGHTER_LINES, type CrewFight, type FightMoment } from './fightlines';
import { MATCH_PHASES, type MatchEvent, type MatchPhase, type MatchSnap } from './rounds';
import { decodeAudio } from '../musicload';
import { CREW_VOICES } from '../speech';

/**
 * Fights. Push people around, punch them, slap them, soak them, and they get
 * angry (see anger.ts); push them far enough and they do something about it:
 * square up and come at you (brawl.ts), run, get loud, or (staff, and a few
 * guests) call security, two guards in dark suits who walk over to have a word
 * and fight you if you swing at them. Your crew never fights you; if you're
 * losing, one of them comes over and pulls you apart.
 *
 * You can hit anyone (fists to the face or the body, an open-handed slap
 * across the face), they can hit you (their punches are telegraphed: dodge
 * them or get your hands up), both of you have health bars while it lasts,
 * and either of you can be knocked out.
 *
 * Multiplayer: whoever starts a fight runs it (the guest's moves, their punches
 * at you); friends see it from the state you publish (`fx`: where the guest
 * is, what they're doing, their health) and a few reliable events (`fgs` start,
 * `fgh` hit, `fgk` knockout, `fge` end, `fgv` a line said). A friend who hits
 * a guest you're fighting tells you, and you apply it. Guests are named by
 * their index in the crowd; a friend whose crowd differs picks the nearest
 * guest of that kind and dresses them the same.
 */

export interface FightsDeps {
  crowd: Crowd;
  world: World;
  player: Player;
  hands: Hands;
  camera: THREE.Camera;
  scene: THREE.Scene;
  sound: Sound;
  hud: Hud;
  dialogue: Dialogue;
  /** Your crew (they never fight you). */
  crew: {
    buddies: readonly { person: Person; name: string }[];
    react(moment: 'bigwin' | 'bigloss' | 'loss', opts?: { force?: boolean; cheer?: boolean }): void;
  };
  /** Someone says so out loud (crew in their own voices). */
  react(p: Person, kind: ReactKind): number;
  /** Buzz a controller. */
  haptic(side: 'left' | 'right', strength: number, ms: number): void;
  /** Something in your hand on a screen (F sips or swigs it then). */
  handsBusy(): boolean;
  /** The canvas (right-click to block). */
  canvas: HTMLElement;
  /** Your character is a woman (your voice in a fight). */
  playerFemale?: () => boolean;
  /** Your name (on the power bars friends see). */
  myName?: () => string;
}

/** Who started it locally, and the state of it. */
interface Local {
  p: Person;
  idx: number;
  name: string;
  brawl: Brawl;
  temper: Temperament;
  /** Where the punch in flight is aimed (locked late in the wind-up), and at what. */
  aim: THREE.Vector3;
  aimLocked: boolean;
  zone: Zone;
  /** Where to go back to afterwards (their seat, their spot in a circle). */
  home: {
    pos: THREE.Vector3;
    yaw: number;
    seated: boolean;
    seatY: number;
    lie: number;
  } | null;
  guard: number;
  leaveT: number;
  lastYell: number;
  /** Security said their piece. */
  warned: boolean;
  t: number;
  phase: Phase;
  /** Fight mode: this fight is a best-of-three match (fight/rounds.ts). */
  match: boolean;
  /** Last time they said a fight line. */
  lastLine: number;
}

/** A fight a friend is running, shown here. */
interface Remote {
  key: string;
  owner: string;
  idx: number;
  p: Person;
  name: string;
  puppet: Brawl;
  hp: number;
  max: number;
  /** Where their machine says the guest is. */
  x: number;
  z: number;
  yaw: number;
  /** A strike we didn't see (the wind-up went straight to recovering): play it anyway. */
  owed: Phase | null;
  heard: number;
  home: Local['home'];
}

const PASSIVE_AFTER = 2.5;
/** A friend's avatar gets up a little quicker than a guest (their real self is already back on their feet). */
const AVATAR_GETUP = T.getup / 1.3;
/** Numbers per fight in the published state (`fx`). */
const FX = 10;
const PUNCH_COOL = 0.35;
/** A hook on a screen (G): harder, slower to throw again. */
const HEAVY_COOL = 0.85;
const rnd = () => Math.random();

const DUTY_LINES = ['Security. Let’s keep it friendly, alright?', 'Easy. Hands down, take a walk.'];

export class Fights {
  readonly you: You;
  private bars: Bars;
  private anger = new Map<Person, Anger>();
  private local = new Map<Person, Local>();
  private remote = new Map<string, Remote>();
  private remoteBy = new Map<Person, Remote>();
  private guards: Person[] = [];
  private session: Session | null = null;
  private time = 0;
  private lastAttack = -99;
  private deskCool = 0;
  private blockMouse = false;
  private blockKey = false;
  private poseOut: PoseOut = {
    guard: 0,
    block: 0,
    act: 'none',
    actT: 0,
    body: false,
    down: 0,
    wobble: 0,
  };
  /** Friends' avatars lying on the floor after a knockout (seconds left). */
  private avatarDown = new Map<Person, number>();
  /** Your buddy coming over to pull you apart. */
  private peacemaker: {
    p: Person;
    name: string;
    foe: Local;
    t: number;
    back: THREE.Vector3 | null;
  } | null = null;
  private heads: OverheadBar[] = [];
  private headPool: OverheadBar[] = [];
  // Scratch (no garbage per frame).
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private headV = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private fxOut: number[] = [];
  /** A boxing match with a friend (net/boxing.ts) shows up in the bars too. */
  boxing: { current(): { name: string; frac: number } | null; deskSlap(): boolean; their(id: string): number | null; setTheirs(id: string, hp: number): void } | null = null;
  /** Fight mode: the match, the power bars, the announcer, the music (fight/mode.ts). */
  readonly mode: FightMode;
  private sparks: HitSparks;
  /** The guest in the match you're running. */
  private matchFoe: Local | null = null;
  /** The friend in the match you're running (two players). */
  private pvpFoe: { id: string; name: string; away: number } | null = null;
  /** Fight mode's new-round health reset already done for (match id, round). */
  private resetFor = '';
  private crowdT = 6;
  private crowdTurn = 0;

  constructor(private d: FightsDeps) {
    this.mode = new FightMode({
      sound: d.sound,
      camera: d.camera,
      scene: d.scene,
      inXR: () => d.player.inXR,
      feet: () => d.player.feet(),
      selfId: () => this.session?.selfId ?? null,
      emit: (k, x) => this.session?.emit(k, x),
      playerFemale: () => d.playerFemale?.() ?? false,
      music: () => {
        const l = d.sound.listener;
        if (!l || l.context.state !== 'running') return null;
        return { ctx: l.context, out: l.getInput(), load: () => decodeAudio('fight', Math.min(44100, l.context.sampleRate)) };
      },
      myHp: () => this.you.health.fraction,
    });
    this.mode.onCall = (ph, snap, fighter) => this.onCall(ph, snap, fighter);
    this.sparks = new HitSparks(d.scene);
    this.you = new You({
      camera: d.camera,
      listener: d.sound.listener,
      haptic: (s, ms) => {
        d.haptic('left', s, ms);
        d.haptic('right', s, ms);
      },
      setStunned: (on) => (d.player.stunned = on),
    });
    this.you.onKO = () => this.knockedOut();
    this.you.onWake = () => this.cameRound();
    this.bars = new Bars(d.scene, d.camera);
    // Two security guards, parked out of sight until someone calls them.
    for (let k = 0; k < 2; k++) {
      const look: Look = {
        ...staffLook('dealer'),
        kind: 'male_suit',
        dress: false,
        main: 0x0b0b0d,
        second: 0x15161a,
        bottom: 0x0b0b0d,
        accent: 0x050506,
        accentSurf: 'silk',
        hairStyle: 'short',
        hair: 0x141010,
        height: 1.88 + k * 0.03,
      };
      const g = d.crowd.add('guard', look, new THREE.Vector3(600 + k * 2, -40, 600), 0);
      if (g) this.guards.push(g);
    }
    addEventListener('keydown', this.onKey);
    addEventListener('keyup', this.onKeyUp);
    d.canvas.addEventListener('pointerdown', this.onPointer, { capture: true });
    addEventListener('pointerup', this.onPointerUp);
    d.canvas.addEventListener('contextmenu', this.onContext);
  }

  // ---------------------------------------------------------------------------
  // Who's who
  // ---------------------------------------------------------------------------

  private isStaff(p: Person) {
    return p.role === 'croupier' || p.role === 'bartender' || p.role === 'waiter' || p.role === 'pianist';
  }

  /** Their temperament id (cast character, staff, security, crew). */
  private temperId(p: Person) {
    if (p.role === 'guard') return 'guard';
    if (p.role === 'buddy') return 'crew';
    if (this.isStaff(p)) return 'staff';
    return this.d.dialogue.character(p).id;
  }

  private nameOf(p: Person) {
    if (p.role === 'guard') return 'Security';
    const b = this.d.crew.buddies.find((x) => x.person === p);
    if (b) return b.name;
    if (this.isStaff(p)) {
      const id = this.d.dialogue.voiceOf(p).replace(/^el_/, '');
      return SPEAKERS.find((s) => s.id === id)?.name ?? 'Staff';
    }
    return this.d.dialogue.character(p).name;
  }

  private angerOf(p: Person) {
    let a = this.anger.get(p);
    if (!a) {
      a = new Anger(temperament(this.temperId(p)));
      this.anger.set(p, a);
    }
    return a;
  }

  /** In a fight on this machine or a friend's. */
  fighting(p: Person) {
    return this.local.has(p) || this.remoteBy.has(p);
  }

  /** Are you in a fight right now? */
  get active() {
    for (const f of this.local.values()) if (!f.brawl.over) return true;
    return false;
  }

  private headOf(p: Person, out: THREE.Vector3) {
    const h = p.rig?.bones.Head;
    if (h) {
      h.getWorldPosition(out);
      out.y += 0.08 * (p.look.height / 1.75);
    } else out.set(p.pos.x, p.pos.y + (p.seated ? 1.2 : 1.6 * (p.look.height / 1.75)), p.pos.z);
    return out;
  }

  // ---------------------------------------------------------------------------
  // Provocations
  // ---------------------------------------------------------------------------

  /** You got physical with someone (a shove, a splash, a thrown thing). */
  provoke(p: Person, kind: Provocation, power = 0.5) {
    // The pool party's performers don't fight back (they're working): they flinch and carry on.
    if (p.driven || this.you.out || p.performer) return;
    if (this.local.has(p)) return;
    const r = this.remoteBy.get(p);
    if (r) return;
    const a = this.angerOf(p);
    p.angry = Math.max(p.angry, Math.min(1, a.level));
    if (a.add(kind, power)) this.boil(p);
  }

  /** They've had enough. */
  private boil(p: Person) {
    const t = this.angerOf(p).t;
    switch (t.response) {
      case 'brawl':
      case 'talk':
        this.start(p, t.response === 'talk');
        return;
      case 'flee': {
        const f = this.start(p, true, true);
        if (f) {
          f.brawl.show('flee');
          this.d.react(p, 'hit');
          this.d.hud.toast(`${f.name} runs off`, 'info');
        }
        return;
      }
      case 'loud':
        // Not a fighter: they make a scene instead.
        this.d.react(p, 'punched');
        this.d.crowd.react(p.pos, 5, 'gasp');
        this.d.hud.toast(`${this.nameOf(p)} is making a scene!`, 'warn');
        this.angerOf(p).vent(0.5);
        if (this.angerOf(p).t.fuse > 0) this.callSecurity(p);
        return;
      case 'security':
        this.callSecurity(p);
        return;
      case 'never':
        return;
    }
  }

  /**
   * A punch (or a slap) of yours landed on someone: in VR your fist (bodies.ts),
   * on a screen F / a click. `v` is the hand's velocity (world).
   */
  hitPerson(p: Person, power: number, zone: Zone, v: THREE.Vector3, slap = false, cheek?: 0 | 1, opts: { speed?: number; at?: THREE.Vector3 } = {}) {
    if (this.you.out || p.driven) return;
    this.lastAttack = this.time;
    const lf = this.local.get(p);
    const rf = this.remoteBy.get(p);
    // Fight mode: before the bell and between rounds, punches don't count.
    if (lf?.match && !this.mode.hostedMatch?.live) {
      this.d.sound.play('block', this.headOf(p, this.v1), { volume: 0.4 });
      return;
    }
    // A punch: its damage from the fist's speed and where it met them (impact.ts); a slap stays a slap.
    let imp: Impact | null = null;
    const blow: Blow = { zone, power, slap };
    if (!slap) {
      const spot: Spot = opts.at && this.onGloves(p, opts.at) ? 'guard' : zone;
      imp = punchImpact({ speed: opts.speed ?? speedOf(power), spot });
      blow.power = Math.max(imp.power, 0.1);
      blow.amount = imp.damage;
      blow.stagger = imp.stagger;
      blow.crit = imp.crit;
      if (spot === 'guard') blow.blocked = true;
      power = blow.power;
    }
    let blocked = !!blow.blocked;
    if (lf) {
      const r = lf.brawl.hit(blow, rnd);
      blocked = r.blocked;
      this.afterHit(lf, blow, r);
    } else if (rf) {
      // A friend's fight: we judge the block from what we see, they apply the damage.
      blocked = rf.puppet.rollBlock(blow, rnd);
      if (blocked) rf.puppet.blockNow();
    } else {
      // Not fighting (yet).
      p.gaspT = Math.max(p.gaspT, slap ? 0.8 : 1);
    }
    this.hitFx(p, zone, power, v, blocked, slap, cheek, imp);
    if (imp && lf) {
      // Big ones: a freeze of a couple of frames, the bars shake, a crack on a crit, a rumble in your hands.
      if (!blocked) this.mode.impact(imp.crit ? 1 : imp.power);
      if (imp.crit && !blocked) {
        this.d.sound.play('crack', this.headOf(p, this.v1), { volume: 0.9 });
        this.d.haptic('left', 0.9, 90);
        this.d.haptic('right', 0.9, 90);
        if (lf.match) this.d.hud.toast('Critical hit!', 'win');
      }
      if (lf.match && !blocked && Math.random() < 0.3) this.mode.say('land');
    }
    if (slap && !blocked) {
      // Shocked: they stare at you (and their temper shows).
      p.attendUntil = Math.max(p.attendUntil, this.d.crowd.now + 3);
      p.angry = Math.max(p.angry, 0.4 + 0.4 * power);
    }
    // Out loud (in a match: their fight lines; else the usual).
    if (lf?.match && !slap) {
      if (!blocked && !lf.brawl.down) this.fighterLine(lf, 'hurt', 0.45);
    } else if (!lf || this.time - lf.lastYell > 4) {
      if (lf) lf.lastYell = this.time;
      if (blocked)
        this.d.sound.play('gasp', this.headOf(p, this.v1), {
          volume: 0.4,
          rate: 1.3,
        });
      else if (p.role === 'guard') this.d.sound.play('gasp', this.headOf(p, this.v1), { volume: 0.7, rate: 0.8 });
      // A slap gets the outraged "ouch" (recorded lines only); a feeble one a "hey!".
      else if (slap && power < 0.3) {
        if (this.d.react(p, 'pushed') <= 0) this.d.sound.play('gasp', this.headOf(p, this.v1), { volume: 0.7, rate: 1.15 });
      } else this.d.react(p, slap ? 'slapped' : 'punched');
    } else if (!blocked)
      this.d.sound.play('gasp', this.headOf(p, this.v1), {
        volume: 0.6,
        rate: 0.85 + Math.random() * 0.3,
      });
    // Tell the room.
    const s = this.session;
    if (s) {
      const owner = lf ? s.selfId : rf ? rf.owner : '';
      const idx = lf ? lf.idx : rf ? rf.idx : this.d.crowd.people.indexOf(p);
      s.emit('fgh', {
        i: idx,
        o: owner,
        by: 'p',
        z: zone === 'head' ? 1 : 0,
        p: r2(power),
        b: blocked ? 1 : 0,
        sl: slap ? 1 : 0,
        dx: r2(v.x),
        dz: r2(v.z),
        ...(cheek !== undefined ? { cs: cheek } : {}),
      });
    }
    // Not in a fight yet: this might start one.
    if (!lf && !rf) this.provoke(p, slap ? 'slapped' : 'punched', power);
    else if (lf) this.angerOf(p).add(slap ? 'slapped' : 'punched', power);
  }

  private lastTouchLine = -99;

  /**
   * A hand touched someone's face, too gently to be a slap (a graze, a pat, a
   * hand brushing past): nothing hurts. They flinch or lean away, glance at
   * you, and now and then say something ("hey", "excuse me?").
   */
  touchFace(p: Person, hit: Pick<FaceHit, 'strength' | 'v' | 'kind'>) {
    if (p.driven || p.fight?.down) return;
    const k = hit.kind === 'brush' ? hit.strength * 0.5 : hit.strength;
    // A glance (longer the more it was).
    p.attendUntil = Math.max(p.attendUntil, this.d.crowd.now + 0.8 + 2 * k);
    if (hit.kind === 'brush') return;
    // Lean away from the hand.
    const lean = touchLean(hit.v, p.yaw, k);
    p.snapY += lean.yaw;
    p.snapX += lean.pitch;
    // A flinch.
    if (k > 0.45) p.gaspT = Math.max(p.gaspT, 0.35);
    // A word, now and then (recorded lines only: "Hey!", "Excuse me?!"; dialogue.ts).
    if (k > 0.3 && !this.fighting(p) && this.time - this.lastTouchLine > 3 && Math.random() < 0.2 + 0.6 * k) {
      if (this.d.react(p, 'pushed') > 0) this.lastTouchLine = this.time;
    }
    // Repeatedly pawing at someone's face wears thin.
    if (k > 0.6) this.provoke(p, 'pushed', 0.2);
  }

  /** What a blow looks and sounds like on someone: the thud (or the clap), the head turning, a red cheek. */
  private hitFx(p: Person, zone: Zone, power: number, v: THREE.Vector3, blocked: boolean, slap: boolean, cheek?: 0 | 1, imp: Impact | null = null) {
    const at = zone === 'head' ? this.headOf(p, this.v2) : this.v2.set(p.pos.x, p.pos.y + 1.2 * (p.look.height / 1.75), p.pos.z);
    if (slap && !blocked)
      // A smack: louder, sharper and carrying further the harder it lands.
      this.d.sound.play('slap', at, { volume: 0.75 + power * 0.85, rate: 0.9 + power * 0.25 + Math.random() * 0.06, ref: 1.6 + power });
    else
      this.d.sound.play(slap ? 'slap' : blocked ? 'block' : 'punch', at, {
        volume: slap ? 0.9 + power * 0.5 : 0.8 + power * 0.6,
        rate: (slap ? 1.0 : 0.85) + Math.random() * 0.15,
      });
    if (!slap) this.sparks.burst(at, v, blocked ? 'block' : imp?.crit ? 'crit' : 'hit');
    if (blocked) {
      this.remoteBy.get(p)?.puppet.blockNow();
      // Even a blocked one moves them a little (momentum through the gloves).
      if (imp && this.fighting(p)) this.knock(p, v, imp.push);
      return;
    }
    if (p.fight?.down) return;
    // A fighter flinches (head snapped back, or doubled over), the body giving the way the punch went.
    if (p.fight && !slap) {
      p.fight.hitT = 0;
      p.fight.hitZone = zone;
      const l = Math.hypot(v.x, v.z) || 1;
      p.fight.hitX = v.x / l;
      p.fight.hitZ = v.z / l;
      p.fight.hitPow = imp ? Math.min(1, 0.35 + imp.energy * 0.6) : 0.3 + 0.5 * power;
    }
    // Which way the hand went, across their face: their right is (-cos yaw, sin yaw).
    const across = -v.x * Math.cos(p.yaw) + v.z * Math.sin(p.yaw);
    if (zone === 'head') {
      if (slap) {
        // The head snaps the way the hand was going, further the harder (people.ts springs it back).
        const sn = slapSnap(v, p.yaw, power);
        p.snapY += sn.yaw;
        p.snapX += sn.pitch;
        // The cheek that took it goes red (faces.ts), longer the harder.
        p.blush = Math.max(p.blush, 3 + 5 * power);
        p.blushSide = cheek ?? sn.side;
      } else {
        // (A fighter's flinch clip snaps the head back already: a touch more on top.)
        const k = p.fight ? 0.4 : 1;
        p.snapX += (0.25 + 0.3 * power) * k;
        p.snapY += -Math.sign(across || 1) * 0.15 * power * k;
      }
    }
    p.gaspT = Math.max(p.gaspT, slap ? 0.6 : 0.8);
    // A fighter is knocked back by it (the fight handles where they stand), never through a wall.
    if (this.fighting(p) && !slap) this.knock(p, v, imp ? imp.push : 0.08 + 0.12 * power);
  }

  /** Knock-back along the punch (horizontal), `d` metres, stopped by walls (world.move). */
  private knock(p: Person, v: THREE.Vector3, d: number) {
    const l = Math.hypot(v.x, v.z);
    if (l < 1e-4 || d <= 0) return;
    const [nx, nz] = this.d.world.move(p.pos.x, p.pos.z, (v.x / l) * d, (v.z / l) * d, 0.22, true);
    p.pos.x = nx;
    p.pos.z = nz;
  }

  /** Did a fist meet their gloves (held up in front of the face) rather than them? */
  private onGloves(p: Person, at: THREE.Vector3) {
    const f = p.fight;
    const b = p.rig?.bones;
    if (!f || !b || (f.guard < 0.5 && f.block < 0.3) || f.down > 0.2) return false;
    for (const n of ['WristL', 'WristR', 'HandL', 'HandR']) {
      const w = b[n];
      if (!w) continue;
      w.getWorldPosition(this.v3);
      if (this.v3.distanceTo(at) < (f.block > 0.3 ? 0.13 : 0.09)) return true;
    }
    return false;
  }

  /** The guest you're fighting took one. */
  private afterHit(f: Local, b: Blow, r: { blocked: boolean; ko: boolean; flee: boolean }) {
    const p = f.p;
    // Security keep it civil until you hit them.
    if (p.role === 'guard' && f.brawl.talker && !b.slap) {
      f.brawl.talker = false;
      this.d.hud.toast('Now you’ve done it: security’s fighting back', 'warn');
    }
    if (r.ko) this.npcKO(f);
    // Walking off (or running) and you hit them again: it's back on.
    else if (!r.flee && (f.brawl.phase === 'leave' || f.brawl.phase === 'flee') && !f.brawl.health.ko && !(f.brawl.talker && p.role !== 'guard')) {
      f.brawl.show('close');
      f.leaveT = 0;
    }
    else if (r.flee) this.d.hud.toast(`${f.name} backs off`, 'info');
  }

  private npcKO(f: Local) {
    const p = f.p;
    this.d.crowd.react(p.pos, 7, 'gasp');
    this.d.sound.play('gasp', p.pos, { volume: 1, rate: 0.85 });
    this.d.sound.play('thunk', p.pos, { volume: 1, rate: 0.5 });
    this.d.hud.toast(`You knocked ${f.name} out!`, 'win');
    this.d.crew.react('bigwin', { force: true, cheer: true });
    this.angerOf(p).vent(0);
    this.session?.emit('fgk', { i: f.idx, w: 'n' });
  }

  // ---------------------------------------------------------------------------
  // Starting and ending fights
  // ---------------------------------------------------------------------------

  private start(p: Person, talker: boolean, quiet = false): Local | null {
    if (this.local.has(p) || this.remoteBy.has(p) || p.driven || p.role === 'buddy' || p.performer) return null;
    const temper = this.angerOf(p).t;
    const brawl = new Brawl(temper, talker);
    const home = this.standUp(p);
    const f: Local = {
      p,
      idx: p.role === 'guard' ? -1 - this.guards.indexOf(p) : this.d.crowd.people.indexOf(p),
      name: this.nameOf(p),
      brawl,
      temper,
      aim: new THREE.Vector3(),
      aimLocked: false,
      zone: 'head',
      home,
      guard: 0,
      leaveT: 0,
      lastYell: this.time,
      warned: false,
      t: 0,
      phase: brawl.phase,
      match: false,
      lastLine: -99,
    };
    this.local.set(p, f);
    p.fight = fightPose();
    if (!talker && !quiet && p.role !== 'guard') this.startMatch(f);
    this.dropProp(p);
    p.angry = 1;
    p.pause = 0;
    p.chatWith = null;
    if (!quiet) {
      // They let you know (a recorded line, in their own voice).
      this.sayAngry(f);
      this.d.hud.toast(talker ? `${f.name} squares up…` : `${f.name} wants to fight you!`, 'warn');
      this.d.crowd.react(p.pos, 4, 'gasp');
    }
    this.session?.emit('fgs', {
      i: f.idx,
      r: p.role,
      lk: p.look,
      sd: p.seed,
      n: f.name,
      x: r2(p.pos.x),
      z: r2(p.pos.z),
      y: r2(p.yaw),
      t: talker ? 1 : 0,
    });
    return f;
  }

  /** Seated (a stool, the slots): they get up to fight. Returns where to go back to. */
  private standUp(p: Person): Local['home'] {
    const home = {
      pos: p.pos.clone(),
      yaw: p.seated ? p.yaw : p.homeYaw,
      seated: p.seated,
      seatY: p.seatY,
      lie: p.lie,
    };
    if (p.seated) {
      p.seated = false;
      p.lie = 0;
      const fx = Math.sin(p.yaw),
        fz = Math.cos(p.yaw);
      const s = this.d.world.settle(p.pos.x + fx * 0.6, p.pos.z + fz * 0.6, 0.25, true);
      if (s) p.pos.set(s[0], p.pos.y, s[1]);
      else p.pos.set(p.pos.x + fx * 0.6, p.pos.y, p.pos.z + fz * 0.6);
      return home;
    }
    // Walkers just carry on afterwards; people who stand somewhere go back there.
    if (p.role === 'wander' || p.role === 'waiter' || p.role === 'pair' || p.role === 'guard') return null;
    return home;
  }

  /** Fists need both hands: the drink or the phone goes away for the fight (and comes back after). */
  private props = new Map<Person, { prop: Person['prop']; photo: boolean }>();
  private dropProp(p: Person) {
    if (p.prop === 'none') return;
    this.props.set(p, { prop: p.prop, photo: p.photo });
    p.prop = 'none';
    p.photo = false;
  }

  private restore(p: Person, home: Local['home']) {
    p.fight = null;
    const prop = this.props.get(p);
    if (prop) {
      p.prop = prop.prop;
      p.photo = prop.photo;
      this.props.delete(p);
    }
    p.angry = 0;
    p.moving = 0;
    if (p.role === 'guard') {
      p.pos.set(600 + this.guards.indexOf(p) * 2, -40, 600);
      return;
    }
    if (home) {
      p.pos.copy(home.pos);
      p.yaw = home.yaw;
      p.seated = home.seated;
      p.seatY = home.seatY;
      p.lie = home.lie;
    }
    // Walkers pick up from wherever they ended up.
    p.target = null;
    p.route = [];
    p.pause = 0.5;
  }

  private end(f: Local) {
    if (f === this.matchFoe) this.mode.abortHosted();
    this.local.delete(f.p);
    this.restore(f.p, f.home);
    this.session?.emit('fge', { i: f.idx });
  }

  // ---------------------------------------------------------------------------
  // Fight mode: the match (rounds.ts, mode.ts)
  // ---------------------------------------------------------------------------

  /** A guest's fight becomes a best-of-three match (unless you're already in one). */
  private startMatch(f: Local) {
    if (this.mode.hostedMatch || this.mode.mine()) return;
    const self = this.session?.selfId ?? 'me';
    const m = this.mode.host(
      { id: this.mode.me(), name: this.d.myName?.() ?? 'Player' },
      { id: `n:${self}:${f.idx}`, name: f.name },
      [
        { hp: () => this.you.health.fraction, down: () => this.you.out, up: () => !this.you.out },
        { hp: () => f.brawl.health.fraction, down: () => f.brawl.phase === 'ko', up: () => f.brawl.phase !== 'ko' && f.brawl.phase !== 'getup' },
      ],
      () => {
        const a = this.d.player.feet();
        return { x: (a.x + f.p.pos.x) / 2, z: (a.z + f.p.pos.z) / 2 };
      },
      (e) => this.matchEvent(f, e),
    );
    if (!m) return;
    f.match = true;
    f.brawl.hold = true;
    f.brawl.afterGetup = 'square';
    f.brawl.lie = 1.6;
    this.matchFoe = f;
  }

  /** The match you're running with a guest moves on: what the guest does about it. */
  private matchEvent(f: Local, e: MatchEvent) {
    const b = f.brawl;
    switch (e.k) {
      case 'fight':
        b.hold = false;
        break;
      case 'round':
      case 'ko':
      case 'time':
        b.hold = true;
        break;
      case 'reset':
        b.health.reset();
        if (b.phase === 'leave' || b.phase === 'flee') b.show('guard');
        break;
      case 'result': {
        b.hold = true;
        b.afterGetup = 'leave';
        const won = e.winner === 1;
        if (e.winner !== 2) setTimeout(() => this.fighterLine(f, won ? 'win' : 'lose', 1), 1300);
        if (e.winner === 0) {
          this.d.crew.react('bigwin', { force: true, cheer: true });
          this.d.crowd.react(f.p.pos, 8, 'cheer');
        }
        break;
      }
      case 'over':
        f.match = false;
        b.hold = false;
        b.afterGetup = 'leave';
        if (this.matchFoe === f) this.matchFoe = null;
        if (!b.over && !b.down && b.phase !== 'getup') b.show('leave');
        this.angerOf(f.p).vent(0.2);
        break;
    }
  }

  /** Each frame: two-player matches' ends, the new round's health, the crowd. */
  private matchTick(dt: number) {
    // A friend's match you run: over if they've left the room or walked off.
    const pv = this.pvpFoe;
    const hm = this.mode.hostedMatch;
    if (pv && hm && hm.on) {
      const fr = this.session?.friendList().find((x) => x.id === pv.id);
      const me = this.d.player.feet();
      const far = !fr?.person || Math.hypot(fr.person.pos.x - me.x, fr.person.pos.z - me.z) > 9;
      pv.away = far ? pv.away + dt : 0;
      if (pv.away > 3) this.mode.abortHosted();
    }
    if (pv && !hm) this.pvpFoe = null;
    // A new round: you're back to full (the one running it resets the guest; each player resets themself).
    const m = this.mode.mine();
    if (m && MATCH_PHASES[m.ph] === 'round' && m.r > 1) {
      const key = `${m.id}:${m.r}`;
      if (key !== this.resetFor && !this.you.out) {
        this.resetFor = key;
        this.you.health.reset();
      }
    }
    // The crowd eggs it on: your crew, the regulars watching.
    if (m && MATCH_PHASES[m.ph] === 'live') {
      this.crowdT -= dt;
      if (this.crowdT <= 0) {
        this.crowdT = 6 + Math.random() * 5;
        this.eggOn(m);
      }
    } else this.crowdT = Math.min(this.crowdT, 4);
  }

  /** A call in the match on show (mode.ts): the fighters and the crowd react. */
  private onCall(ph: MatchPhase, s: MatchSnap, fighter: boolean) {
    const at = this.v3.set(s.x, 0, s.z);
    const foe = this.matchFoe && s.id === this.mode.hostedMatch?.id ? this.matchFoe : null;
    switch (ph) {
      case 'intro':
        this.d.crowd.react(at, 7, 'gasp');
        if (foe) setTimeout(() => this.fighterLine(foe, 'taunt', 1), 900);
        break;
      case 'fight':
        if (fighter) this.d.crowd.react(at, 7, 'cheer');
        break;
      case 'ko':
        this.d.crowd.react(at, 8, 'gasp');
        break;
      case 'result':
        if (fighter) {
          const mine = s.a.id === this.mode.me() ? 0 : 1;
          if (s.win !== 2) setTimeout(() => this.crewLine(s.win === mine ? 'youWin' : 'youLose'), 2200);
        } else this.d.crowd.react(at, 8, 'cheer');
        break;
    }
  }

  /** A fighter's line (fightlines.ts), in their voice; until it's recorded, a caption and an effort sound. */
  private fighterLine(f: Local, moment: FightMoment, chance = 1) {
    const p = f.p;
    if (Math.random() > chance || this.time - f.lastLine < (moment === 'hurt' || moment === 'land' ? 4 : 1.2)) return;
    const id = p.role === 'guard' ? 'security' : this.temperId(p);
    const pool = FIGHTER_LINES[id]?.[moment];
    if (!pool?.length) return;
    f.lastLine = this.time;
    const text = pool[Math.floor(Math.random() * pool.length)];
    const [voice, alt] = p.role === 'guard' ? ['el_security', 'el_security'] : this.d.dialogue.voicesOf(p);
    this.fightTalk(p, f.name, text, voice, alt, moment === 'hurt' ? 'oof' : moment === 'land' ? 'grunt' : null);
    this.session?.emit('fgv', { i: f.idx, t: text, v: voice, a: alt });
  }

  /** Says a fight line: the take if there is one; else the caption (and an effort sound for a grunt-y moment). Never the browser voice. */
  private fightTalk(p: Person, who: string, text: string, voice: VoiceId, alt: VoiceId, effort: 'grunt' | 'oof' | null) {
    const recorded = voices.has(voice, text) || voices.has(alt, text);
    if (!recorded && effort) this.d.sound.play(effort, this.headOf(p, this.v2), { volume: 0.6, rate: this.pitchOf(p) });
    const dur = voices.talk({ who, text, voice, alt, at: mouthOf(p), priority: true, group: 'fight', volume: 1.4, recordedOnly: true, captionFallback: !effort || recorded });
    this.d.crowd.speak(p, recorded ? dur : Math.min(dur, 1.2));
  }

  /** Your crew in the crowd (the nearest of them, if they're close enough to see it). */
  private crewLine(kind: CrewFight): boolean {
    const me = this.d.player.feet();
    const near = this.d.crew.buddies.filter((b) => Math.hypot(b.person.pos.x - me.x, b.person.pos.z - me.z) < 14);
    if (!near.length) return false;
    const b = near[Math.floor(Math.random() * near.length)];
    const id = 'crew_' + b.name.toLowerCase();
    const pool = CREW_FIGHT[id]?.[kind];
    if (!pool?.length) return false;
    const text = pool[Math.floor(Math.random() * pool.length)];
    const k = ['rocco', 'dev', 'mikey'].indexOf(b.name.toLowerCase());
    const alt = CREW_VOICES[Math.max(0, k)];
    if (kind !== 'egg' || voices.has('el_' + id, text)) {
      voices.talk({ who: b.name, text, voice: 'el_' + id, alt, at: mouthOf(b.person), priority: true, group: 'crew-fight', volume: 1.2, recordedOnly: true, captionFallback: kind !== 'egg' });
      this.d.crowd.speak(b.person, 1.5);
    }
    b.person.cheer = Math.max(b.person.cheer, 1.6);
    return true;
  }

  /** Someone in the crowd eggs the fight on: your crew, or a regular watching. */
  private eggOn(s: MatchSnap) {
    this.crowdTurn++;
    if (this.crowdTurn % 2 === 1 && this.crewLine('egg')) return;
    const at = this.v3.set(s.x, 0, s.z);
    let best: Person | null = null,
      bd = 9;
    for (const p of this.d.crowd.people) {
      if (p.culled || p.driven || p.fight || p.performer || p.role === 'buddy' || p.role === 'guard' || this.isStaff(p)) continue;
      const dd = Math.hypot(p.pos.x - at.x, p.pos.z - at.z);
      if (dd < bd && dd > 1.2 && Math.random() < 0.7) {
        bd = dd;
        best = p;
      }
    }
    this.d.crowd.react(at, 7, 'cheer');
    if (!best) return;
    const ch = this.d.dialogue.character(best);
    const pool = CROWD_FIGHT[ch.id];
    if (!pool?.length) return;
    const text = pool[Math.floor(Math.random() * pool.length)];
    const [voice, alt] = this.d.dialogue.voicesOf(best);
    // Recorded: they shout it. Not yet: a cheer and their arms up (no caption: it's crowd noise).
    if (voices.has(voice, text) || voices.has(alt, text)) {
      const dur = voices.talk({ who: ch.name, text, voice, alt, at: mouthOf(best), volume: 1.2, recordedOnly: true, captionFallback: false });
      this.d.crowd.speak(best, dur);
    }
    best.cheer = Math.max(best.cheer, 1.8);
  }

  /** Higher voices for the women (the effort sounds). */
  private pitchOf(p: Person) {
    const fem = (p.look.kind ?? '').startsWith('female') || !!p.look.dress;
    return (fem ? 1.45 : 0.95) + Math.random() * 0.1;
  }

  /** Your hands up by your face (VR: a wrist within a hand's breadth of your face; screen: blocking). */
  guardUp(): boolean {
    if (!this.d.player.inXR) return this.blocking;
    const head = this.d.camera.getWorldPosition(this.headV);
    let n = 0;
    for (const s of ['left', 'right'] as const) {
      const w = this.d.hands.wrist(s);
      if (w && w.distanceTo(head) < 0.26 && w.y > head.y - 0.22) n++;
    }
    return n >= 1;
  }

  /**
   * You and a friend traded a punch (boxing.ts, either way): it becomes a
   * match. The lower id of the two runs it; the other follows its snapshots.
   */
  pvpExchange(friendId: string, name: string) {
    const self = this.session?.selfId;
    if (!self || this.mode.versus(friendId) || this.mode.mine() || this.mode.busy('p:' + friendId) || this.matchFoe) return;
    if (self > friendId) return;
    const their = () => (this.boxing?.their(friendId) ?? 100) / 100;
    const m = this.mode.host(
      { id: this.mode.me(), name: this.d.myName?.() ?? 'Player' },
      { id: 'p:' + friendId, name },
      [
        { hp: () => this.you.health.fraction, down: () => this.you.out, up: () => !this.you.out },
        { hp: their, down: () => their() <= 0, up: () => their() > 0 },
      ],
      () => {
        const a = this.d.player.feet();
        const fp = this.session?.friendList().find((x) => x.id === friendId)?.person?.pos ?? a;
        return { x: (a.x + fp.x) / 2, z: (a.z + fp.z) / 2 };
      },
      (e) => {
        if (e.k === 'reset') this.boxing?.setTheirs(friendId, 100);
      },
    );
    if (m) this.pvpFoe = { id: friendId, name, away: 0 };
  }

  /** Punches between you and this friend count right now (fight mode: not before the bell, not between rounds). */
  gate(friendId: string) {
    return this.mode.gate(friendId);
  }

  // ---------------------------------------------------------------------------
  // Security
  // ---------------------------------------------------------------------------

  private callSecurity(caller: Person) {
    if (this.guards.length === 0) return;
    if (this.guards.some((g) => this.local.has(g) || this.remoteBy.has(g))) return;
    const name = this.nameOf(caller);
    this.d.hud.toast(`${name} called security!`, 'warn');
    // Security on the way: the match is off.
    if (this.matchFoe) {
      const foe = this.matchFoe;
      this.mode.abortHosted();
      if (!foe.brawl.down && foe.brawl.phase !== 'getup') foe.brawl.show('leave');
    }
    // They yell for it, in their own voice.
    this.d.react(caller, 'security');
    // They walk over from a few steps away (not out of thin air in front of you).
    const me = this.d.player.feet();
    let spot: THREE.Vector3 | null = null;
    for (let k = 0; k < 30 && !spot; k++) {
      const n = this.d.crowd.randomNode();
      const dd = Math.hypot(n.x - me.x, n.z - me.z);
      if (dd > 4.5 && dd < 6.5) spot = n;
    }
    if (!spot) {
      const a = Math.random() * Math.PI * 2;
      const s = this.d.world.settle(me.x + Math.sin(a) * 5, me.z + Math.cos(a) * 5, 0.3, true);
      spot = s ? new THREE.Vector3(s[0], 0, s[1]) : new THREE.Vector3(me.x + 5, 0, me.z);
    }
    this.guards.forEach((g, k) => {
      g.pos.set(spot!.x + (k ? 0.7 : 0), this.d.world.groundAt(spot!.x, spot!.z), spot!.z);
      g.yaw = Math.atan2(me.x - g.pos.x, me.z - g.pos.z);
      // Security keep it civil (talkers) until you swing at them.
      const f = this.start(g, true, true);
      if (f) f.brawl.show('close');
    });
  }

  // ---------------------------------------------------------------------------
  // Desktop / phone controls
  // ---------------------------------------------------------------------------

  private onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || this.d.player.inXR) return;
    if (e.code === 'KeyH') this.blockKey = true;
    if (e.code === 'KeyF' && !e.repeat && !this.d.handsBusy()) this.deskPunch();
    if (e.code === 'KeyG' && !e.repeat && !this.d.handsBusy() && this.active) this.deskPunch(true);
    if (e.code === 'KeyY' && !e.repeat && this.d.player.seated?.id !== 'piano') this.deskSlap();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'KeyH') this.blockKey = false;
  };

  private onPointer = (e: PointerEvent) => {
    if (this.d.player.inXR) return;
    if (e.button === 2) {
      this.blockMouse = true;
      return;
    }
    // A click while squared up with someone right in front of you is a punch (not a click on the room).
    if (e.button === 0 && this.active && this.target(1.3)) {
      e.stopImmediatePropagation();
      this.deskPunch();
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.button === 2) this.blockMouse = false;
  };

  private onContext = (e: Event) => {
    if (this.active) e.preventDefault();
  };

  /** Holding your guard up (screen): right mouse or H. */
  get blocking() {
    return this.blockMouse || this.blockKey;
  }

  /** The person right in front of you, within `range` metres. */
  private target(range: number): Person | null {
    const me = this.d.player.feet();
    const look = this.v3.set(0, 0, -1).applyQuaternion(this.d.camera.getWorldQuaternion(this.q));
    look.y = 0;
    look.normalize();
    let best: Person | null = null,
      bd = range;
    for (const p of this.d.crowd.people) {
      if (p.culled || p.driven || p.fight?.down) continue;
      const dx = p.pos.x - me.x,
        dz = p.pos.z - me.z;
      const dist = Math.hypot(dx, dz);
      if (dist > bd || dist < 0.05) continue;
      if ((dx * look.x + dz * look.z) / dist < 0.75) continue;
      best = p;
      bd = dist;
    }
    return best;
  }

  /** A jab at whoever is right in front of you (F, a click in a fight, the Punch button). */
  deskPunch(heavy = false) {
    if (this.you.out || this.deskCool > 0) return;
    this.deskCool = heavy ? HEAVY_COOL : PUNCH_COOL;
    const p = this.target(1.25);
    this.session?.emit('jab', { s: Math.random() < 0.5 ? 'l' : 'r' });
    if (!p) {
      this.d.sound.playLocal('whoosh', 0.5, 1.1);
      return;
    }
    // They see it coming (and may get their gloves up).
    (this.local.get(p)?.brawl ?? this.remoteBy.get(p)?.puppet)?.threat(rnd);
    const pitch = this.v1.set(0, 0, -1).applyQuaternion(this.d.camera.getWorldQuaternion(this.q)).y;
    const me = this.d.player.feet();
    this.v1
      .set(p.pos.x - me.x, 0, p.pos.z - me.z)
      .normalize()
      .multiplyScalar(heavy ? 6 : 4);
    // A jab's about 4 m/s at the fist, a thrown hook (G) a good deal more.
    const speed = heavy ? 6 + Math.random() * 0.8 : 3.9 + Math.random() * 0.8;
    this.hitPerson(p, 0.65, pitch > -0.25 ? 'head' : 'body', this.v1, false, undefined, { speed });
  }

  /** Someone to slap on a screen: a guest right in front of you (null if there's no one). */
  slapTarget(): Person | null {
    return this.target(1.1);
  }

  /**
   * A slap on a screen (Y, the Slap button on a phone): an open hand across the
   * face of whoever's right in front of you, a guest or (boxing.ts) a friend,
   * with the same outcome as one in VR: the smack, the head snapping away, the
   * red cheek, the outrage.
   */
  deskSlap() {
    if (this.you.out || this.deskCool > 0) return;
    this.deskCool = PUNCH_COOL;
    const p = this.target(1.1);
    if (!p) {
      if (this.boxing?.deskSlap()) return;
      this.session?.emit('jab', { s: 'r' });
      this.d.sound.playLocal('whoosh', 0.4, 1.3);
      return;
    }
    this.session?.emit('jab', { s: 'r' });
    // Your right hand, swung across their face from your right to your left: their left cheek (slapSnap works it out).
    const me = this.d.player.feet();
    const fx = p.pos.x - me.x,
      fz = p.pos.z - me.z;
    const l = Math.hypot(fx, fz) || 1;
    // Your left, facing them, is (fz, -fx) (yaw = atan2(x, z)): the hand goes that way, and a little forward.
    this.v1.set(((fz * 3.2 + fx * 1.2) / l), 0, ((-fx * 3.2 + fz * 1.2) / l));
    this.hitPerson(p, 0.55, 'head', this.v1, true);
  }

  // ---------------------------------------------------------------------------
  // You
  // ---------------------------------------------------------------------------

  private knockedOut() {
    this.d.hud.toast('Knocked out!', 'warn');
    this.d.crowd.react(this.d.player.feet(), 6, 'gasp');
    this.session?.emit('fgk', { i: -99, w: 'p' });
    // Whoever did it has won: they walk off (in a match, only once the match is theirs).
    for (const f of this.local.values()) {
      if (f.match) {
        f.brawl.hold = true;
        this.fighterLine(f, 'land', 1);
        continue;
      }
      if (!f.brawl.over && !f.brawl.down) f.brawl.show('leave');
    }
  }

  private cameRound() {
    this.session?.emit('fgk', { i: -99, w: 'u' });
    // In a match: back on your feet for the next round.
    const m = this.mode.mine();
    if (m && MATCH_PHASES[m.ph] !== 'result' && MATCH_PHASES[m.ph] !== 'over') {
      this.mode.say('getup');
      return;
    }
    this.d.hud.toast('You got rocked, buddy. Take a breather.', 'info');
    this.d.crew.react('bigloss', { force: true });
  }

  /** Hands down (VR: both wrists below your chin; screen: not blocking) and not throwing anything. */
  private passive(head: THREE.Vector3) {
    if (this.time - this.lastAttack < PASSIVE_AFTER) return false;
    if (!this.d.player.inXR) return !this.blocking;
    for (const s of ['left', 'right'] as const) {
      const w = this.d.hands.wrist(s);
      if (w && w.y > head.y - 0.4) return false;
    }
    return true;
  }

  /** Is your guard in the way of a punch aimed at `aim`? */
  private guarded(aim: THREE.Vector3, from: THREE.Vector3) {
    if (!this.d.player.inXR) return this.blocking;
    for (const s of ['left', 'right'] as const) {
      const w = this.d.hands.wrist(s);
      if (!w) continue;
      if (w.distanceTo(aim) < 0.2) return true;
      // Anywhere along the last part of the punch's path.
      if (distToSeg(w, from, aim) < 0.13 && w.distanceTo(aim) < 0.45) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Every frame
  // ---------------------------------------------------------------------------

  /** The people's clock in a fight (fight mode's slow-motion beat and hit-stop; main.ts slows the crowd by it). Never your view. */
  get timeScale() {
    return this.mode.timeScale;
  }

  /** The world's music level multiplier (fight mode's music ducks it). */
  get musicDuck() {
    return this.mode.duck;
  }

  update(rawDt: number) {
    // The fight runs on the people's clock (slow motion on a knockout); the match, HUD and music on real time.
    this.mode.update(rawDt);
    this.sparks.update(rawDt);
    this.matchTick(rawDt);
    const dt = rawDt * this.mode.timeScale;
    this.time += dt;
    this.deskCool = Math.max(0, this.deskCool - dt);
    for (const [p, a] of this.anger) {
      a.update(dt);
      if (!this.local.has(p) && !this.remoteBy.has(p)) p.angry = Math.max(0, Math.min(p.angry, a.level) - dt * 0.05);
    }
    const head = this.d.camera.getWorldPosition(this.headV);
    const feet = this.d.player.feet();
    this.you.update(dt, this.active);
    this.watchSwings(dt);
    for (const f of [...this.local.values()]) this.step(f, dt, feet, head);
    this.updatePeacemaker(dt);
    this.updateRemote(dt);
    for (const [p, t] of this.avatarDown) {
      const left = t - dt;
      if (left <= 0 || !p.fight) {
        this.avatarDown.delete(p);
        if (p.fight && !this.local.has(p) && !this.remoteBy.has(p)) p.fight = null;
        continue;
      }
      this.avatarDown.set(p, left);
      // The same fall, lying there and get-up as a guest (their real self is back up a little sooner).
      const k = KO_SECONDS + AVATAR_GETUP - left;
      const getup = left < AVATAR_GETUP;
      p.fight.act = getup ? 'getup' : 'ko';
      p.fight.actT = getup ? (AVATAR_GETUP - left) * (T.getup / AVATAR_GETUP) : k;
      p.fight.down = getup ? left / AVATAR_GETUP : Math.min(1, k / T.fall);
      p.fight.guard = 0;
    }
    this.drawBars();
  }

  private step(f: Local, dt: number, feet: THREE.Vector3, head: THREE.Vector3) {
    const p = f.p;
    const b = f.brawl;
    const dx = feet.x - p.pos.x,
      dz = feet.z - p.pos.z;
    const dist = Math.hypot(dx, dz);
    // You're out cold: they don't hit someone who's down.
    const passive = this.you.out || this.passive(head);
    const ev = b.update({ dt, dist, passive, rnd });
    f.phase = b.phase;
    p.attendUntil = this.d.crowd.now + 0.5;
    if (ev === 'windup') {
      f.zone = b.head ? 'head' : 'body';
      f.aimLocked = false;
      // The effort of it (a wordless grunt; their own recorded lines are for words).
      if (f.match && Math.random() < 0.55) this.d.sound.play('grunt', this.headOf(p, this.v2), { volume: 0.45, rate: this.pitchOf(p) });
    } else if (ev === 'impact') this.impact(f, head);
    else if (ev === 'ko') {
      /* counted in afterHit */
    } else if (ev === 'getup') {
      if (f.match) this.fighterLine(f, 'getup', 1);
    } else if (ev === 'giveup') {
      if (f === this.matchFoe) this.mode.abortHosted();
      this.d.hud.toast(this.you.out ? `${f.name} walks off` : `${f.name} lets it go`, 'info');
      this.angerOf(p).vent(0.3);
    }
    if (p.role === 'guard' && b.talker && b.phase === 'guard' && !f.warned && this.guards[0] === p) {
      f.warned = true;
      // The guard tells you to cool it, out loud (a caption if the line isn't recorded yet).
      if (this.d.react(p, 'security') <= 0) this.d.hud.toast(`Security: “${DUTY_LINES[Math.floor(Math.random() * DUTY_LINES.length)]}”`, 'warn');
    }
    // Aim at you (late in the wind-up the aim locks: that's your chance to slip it).
    if (b.phase === 'windup' || b.phase === 'strike') {
      if (!f.aimLocked) {
        f.aim.copy(head);
        if (f.zone === 'body') f.aim.y -= 0.45;
        if (b.phase === 'strike' || b.t > T.windup * 0.6) f.aimLocked = true;
      }
    }
    // Facing: at you while fighting, away when leaving.
    const leaving = b.phase === 'leave' || b.phase === 'flee';
    if (!b.down && b.phase !== 'getup') {
      let want = Math.atan2(dx, dz);
      if (leaving) {
        const to = this.leaveTarget(f, feet);
        want = Math.atan2(to.x - p.pos.x, to.z - p.pos.z);
      }
      turn(p, want, dt * (leaving ? 4 : 7));
    }
    // Moving: in toward you, back a half step, or away.
    let speed = b.advance;
    if (leaving) {
      f.leaveT += dt;
      const to = this.leaveTarget(f, feet);
      const tx = to.x - p.pos.x,
        tz = to.z - p.pos.z;
      const td = Math.hypot(tx, tz);
      const sp = Math.abs(b.advance);
      if (td > 0.12) {
        const st = Math.min(td, sp * dt);
        const [nx, nz] = this.d.world.move(p.pos.x, p.pos.z, (tx / td) * st, (tz / td) * st, 0.22, true);
        p.pos.x = nx;
        p.pos.z = nz;
      }
      p.moving = td > 0.12 ? sp : 0;
      const home = f.home && Math.hypot(f.home.pos.x - feet.x, f.home.pos.z - feet.z) > 2.5;
      if ((home && td <= 0.12) || (!home && (f.leaveT > 6 || dist > 9)) || f.leaveT > 14) {
        this.end(f);
        return;
      }
    } else if ((speed !== 0 || b.strafe !== 0) && dist > 0.01 && !b.down) {
      if (speed > 0) speed = Math.min(speed, Math.max(0, (dist - 0.62) / dt));
      // Toward you (or back), and circling: their left is (fz, -fx) facing you along (dx, dz).
      const ux = dx / dist,
        uz = dz / dist;
      const mx = (ux * speed + uz * b.strafe) * dt,
        mz = (uz * speed - ux * b.strafe) * dt;
      const [nx, nz] = this.d.world.move(p.pos.x, p.pos.z, mx, mz, 0.22, true);
      p.pos.x = nx;
      p.pos.z = nz;
      p.moving = Math.hypot(speed, b.strafe);
    } else p.moving = Math.max(0, p.moving - dt * 4);
    // The pose.
    const out = b.pose(this.poseOut);
    const fp = p.fight!;
    this.toPose(fp, out, b, p);
    fp.aim.copy(f.aim);
    p.angry = leaving || b.down ? Math.max(0, p.angry - dt * 0.3) : 1;
  }

  /** The fight's state (theirs or a friend's puppet) onto the body (fightanim.ts plays it). */
  private toPose(fp: FightPose, out: PoseOut, b: Brawl, p: Person) {
    // Security keep their hands down until it's a real fight.
    fp.guard = out.guard * (b.talker && p.role === 'guard' ? 0.15 : 1);
    fp.block = out.block;
    fp.act = out.act;
    fp.actT = out.actT;
    fp.body = out.body;
    fp.down = out.down;
    fp.wobble = out.wobble;
    fp.side = b.side;
  }

  private wristWas: Record<'left' | 'right', THREE.Vector3 | null> = { left: null, right: null };
  /** VR: a fist coming fast at someone you're fighting: they see it and may get their gloves up. */
  private watchSwings(dt: number) {
    if (!this.d.player.inXR || dt <= 0) return;
    for (const s of ['left', 'right'] as const) {
      const w = this.d.hands.wrist(s);
      const was = this.wristWas[s];
      if (w && was && (this.local.size || this.remote.size)) {
        const v = this.v1.copy(w).sub(was).divideScalar(dt);
        const check = (p: Person, b: Brawl) => {
          if (b.down) return;
          const to = this.headOf(p, this.v2).sub(w);
          const d = to.length();
          if (d < 0.9 && d > 0.05 && v.dot(to) / d > 2.2) b.threat(rnd);
        };
        for (const f of this.local.values()) check(f.p, f.brawl);
        for (const r of this.remote.values()) check(r.p, r.puppet);
      }
      if (w) (this.wristWas[s] ??= new THREE.Vector3()).copy(w);
      else this.wristWas[s] = null;
    }
  }

  private leaveTarget(f: Local, feet: THREE.Vector3): THREE.Vector3 {
    const p = f.p;
    if (f.home && Math.hypot(f.home.pos.x - feet.x, f.home.pos.z - feet.z) > 2.5) return f.home.pos;
    const dx = p.pos.x - feet.x,
      dz = p.pos.z - feet.z;
    const l = Math.hypot(dx, dz) || 1;
    return this.v3.set(p.pos.x + (dx / l) * 3, 0, p.pos.z + (dz / l) * 3);
  }

  /** Their punch arrives: did it land? */
  private impact(f: Local, head: THREE.Vector3) {
    if (this.you.out) return;
    const p = f.p;
    const target = this.v1.copy(head);
    if (f.zone === 'body') target.y -= 0.45;
    const reach = Math.hypot(head.x - p.pos.x, head.z - p.pos.z);
    const at = this.headOf(p, this.v2);
    // You moved out of the way (or out of reach): a miss.
    if (target.distanceTo(f.aim) > 0.28 || reach > 1.15) {
      this.d.sound.play('whoosh', f.aim, {
        volume: 0.7,
        rate: 0.9 + Math.random() * 0.2,
      });
      this.session?.emit('fgh', {
        i: f.idx,
        by: 'n',
        z: f.zone === 'head' ? 1 : 0,
        p: 0,
        b: 0,
        m: 1,
      });
      return;
    }
    // Your gloves in the way of it, or held up by your face: a block.
    const blocked = this.guarded(f.aim, at) || this.guardUp();
    // Their punch, from its speed (a hook and a cross carry more than a jab) and their strength.
    const mv = f.brawl.move;
    const speed = (mv === 'jab' ? 4.4 : mv === 'cross' ? 5.3 : 5.6) + Math.random() * 0.9;
    const imp = punchImpact({ speed, spot: blocked ? 'guard' : f.zone, strength: f.temper.power });
    const power = imp.power;
    const r = this.you.hurt({
      zone: f.zone,
      power,
      blocked,
      strength: f.temper.power,
      amount: imp.damage,
      crit: imp.crit,
    });
    if (!blocked) this.mode.impact(imp.crit ? 0.9 : imp.power * 0.8);
    if (f.match && !r.ko) {
      if (!blocked && Math.random() < 0.3) this.mode.say('hurt');
      else if (!blocked) this.fighterLine(f, 'land', 0.3);
    }
    this.d.sound.playLocal(blocked ? 'block' : 'punch', blocked ? 0.7 : 1, 0.85 + Math.random() * 0.15);
    if (!blocked && f.zone === 'head' && !r.ko && Math.random() < 0.3) this.d.hud.toast(`${f.name} rocks you!`, 'warn');
    this.session?.emit('fgh', {
      i: f.idx,
      by: 'n',
      z: f.zone === 'head' ? 1 : 0,
      p: r2(power),
      b: blocked ? 1 : 0,
    });
    // Losing badly: one of the boys comes over (not in a match: they're cheering you on).
    if (this.you.health.fraction < 0.4 && !this.peacemaker && !r.ko && !f.match) this.callBuddy(f);
  }

  /** Line in their own voice (a recorded angry one), and the same on friends' machines. */
  private sayAngry(f: Local) {
    const p = f.p;
    // (At the pool party: about the show.)
    const { lines: pool, voice, alt } = this.d.dialogue.angryLines(p);
    if (!pool.length) {
      this.d.react(p, 'pushed');
      return;
    }
    const text = pool[Math.floor(Math.random() * pool.length)];
    this.talk(p, f.name, text, voice, alt);
    this.session?.emit('fgv', { i: f.idx, t: text, v: voice, a: alt });
  }

  private talk(p: Person, who: string, text: string, voice: VoiceId, alt: VoiceId) {
    const dur = voices.talk({
      who,
      text,
      voice,
      alt,
      at: mouthOf(p),
      priority: true,
      group: 'react',
      volume: 1.4,
      // (Never the browser voice: a line with no take is a caption.)
      recordedOnly: true,
    });
    this.d.crowd.speak(p, dur);
  }

  // ---------------------------------------------------------------------------
  // Your crew pulls you apart
  // ---------------------------------------------------------------------------

  private callBuddy(foe: Local) {
    const me = this.d.player.feet();
    let best: { person: Person; name: string } | null = null,
      bd = 18;
    for (const b of this.d.crew.buddies) {
      const dd = Math.hypot(b.person.pos.x - me.x, b.person.pos.z - me.z);
      if (dd < bd) {
        bd = dd;
        best = b;
      }
    }
    if (!best) return;
    best.person.fight = fightPose();
    this.peacemaker = {
      p: best.person,
      name: best.name,
      foe,
      t: 0,
      back: best.person.pos.clone(),
    };
  }

  private updatePeacemaker(dt: number) {
    const m = this.peacemaker;
    if (!m) return;
    m.t += dt;
    const p = m.p;
    const foe = m.foe;
    const going = this.local.get(foe.p) === foe && !foe.brawl.over && !foe.brawl.down;
    const to = going ? foe.p.pos : m.back;
    if (!to || m.t > 20) {
      p.fight = null;
      this.peacemaker = null;
      return;
    }
    const dx = to.x - p.pos.x,
      dz = to.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    const stop = going ? 0.75 : 0.1;
    if (d > stop) {
      const st = Math.min(d - stop, (going ? 2.2 : 1.1) * dt);
      const [nx, nz] = this.d.world.move(p.pos.x, p.pos.z, (dx / d) * st, (dz / d) * st, 0.22, true);
      p.pos.x = nx;
      p.pos.z = nz;
      p.moving = going ? 2.2 : 1.1;
      turn(p, Math.atan2(dx, dz), dt * 6);
    } else if (going) {
      // Arms out between you: that's enough.
      p.moving = 0;
      p.fight!.guard = 0.5;
      foe.brawl.show('leave');
      this.d.hud.toast(`${m.name} pulls you two apart`, 'info');
      this.d.crew.react('loss', { force: true });
      this.angerOf(foe.p).vent(0.3);
    } else {
      p.fight = null;
      p.moving = 0;
      this.peacemaker = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Health bars
  // ---------------------------------------------------------------------------

  private drawBars() {
    const heads = this.heads;
    heads.length = 0;
    let opp: { name: string; frac: number } | null = null;
    const me = this.d.player.feet();
    const add = (p: Person, name: string, frac: number) => {
      if (p.culled || Math.hypot(p.pos.x - me.x, p.pos.z - me.z) > 12) return;
      const o =
        this.headPool[heads.length] ??
        (this.headPool[heads.length] = {
          name: '',
          frac: 1,
          at: new THREE.Vector3(),
        });
      o.name = name;
      o.frac = frac;
      this.headOf(p, o.at);
      if (p.fight?.down) o.at.y = p.pos.y + 0.5;
      heads.push(o);
    };
    for (const f of this.local.values()) {
      const h = f.brawl.health;
      if (f.brawl.phase === 'leave' && f.leaveT > 2) continue;
      if (f.p.role === 'guard' && f.brawl.talker) continue;
      add(f.p, f.name, h.fraction);
      if (!opp || h.fraction < opp.frac) opp = { name: f.name, frac: h.fraction };
    }
    for (const r of this.remote.values()) if (r.puppet.phase !== 'leave' && r.puppet.phase !== 'flee') add(r.p, r.name, r.hp / Math.max(1, r.max));
    // Friends in a fight: theirs over their heads.
    if (this.session)
      for (const fr of this.session.friendList()) {
        const fh = fr.state.fh;
        if (typeof fh === 'number' && fr.person) add(fr.person, fr.name, fh / 100);
      }
    const box = this.boxing?.current() ?? null;
    if (box && !opp) opp = box;
    const mine = this.active || box || this.you.health.hp < this.you.health.max - 0.5 ? this.you.health.fraction : null;
    // Fight mode's power bars take over while a match is on show.
    if (this.mode.show) this.bars.update(this.d.player.inXR, null, null, heads);
    else this.bars.update(this.d.player.inXR, mine, opp, heads);
  }

  // ---------------------------------------------------------------------------
  // Multiplayer
  // ---------------------------------------------------------------------------

  /** Joins a room: fights show up on everyone's machine. */
  connect(session: Session) {
    this.disconnect();
    this.session = session;
    const prev = session.extraState;
    session.extraState = () => ({
      ...(prev?.() ?? {}),
      fx: this.fx(),
      fm: this.mode.snapshot(),
      fh: this.active || this.you.health.hp < 99.5 ? Math.round(this.you.health.hp) : null,
    });
    session.on('fgs', (f, d) => this.onStart(f, d));
    session.on('fmx', (_f, d) => this.mode.onSnap(d));
    session.on('fge', (f, d) => {
      const r = this.remote.get(`${f.id}:${Math.round(Number(d.i))}`);
      if (r) this.dropRemote(r);
    });
    session.on('fgh', (f, d) => this.onHit(f, d));
    session.on('fgk', (f, d) => this.onKO(f, d));
    session.on('fgv', (f, d) => {
      const r = this.remote.get(`${f.id}:${Math.round(Number(d.i))}`);
      if (!r || typeof d.t !== 'string' || typeof d.v !== 'string') return;
      this.talk(r.p, r.name, d.t.slice(0, 200), d.v as VoiceId, (typeof d.a === 'string' ? d.a : d.v) as VoiceId);
    });
  }

  disconnect() {
    for (const r of [...this.remote.values()]) this.dropRemote(r);
    this.session = null;
  }

  /** Your fights, for your published state. */
  private fx(): number[] | null {
    const o = this.fxOut;
    o.length = 0;
    for (const f of this.local.values()) {
      const p = f.p;
      o.push(
        f.idx,
        Math.round(p.pos.x * 100),
        Math.round(p.pos.z * 100),
        Math.round(p.yaw * 100),
        PHASES.indexOf(f.brawl.phase),
        Math.round(f.brawl.health.hp),
        f.brawl.health.max,
        f.brawl.side,
        f.zone === 'head' ? 1 : 0,
        MOVES.indexOf(f.brawl.move) + (f.brawl.blocking ? 8 : 0),
      );
    }
    return o.length ? o.slice() : null;
  }

  /** The guest a friend means: same index if it's the same kind of guest here, else the nearest like them. */
  private resolve(i: number, role: string, x: number, z: number): Person | null {
    if (i < 0) return this.guards[-1 - i] ?? null;
    const ok = (p: Person | undefined): p is Person => !!p && !p.driven && p.role !== 'buddy' && p.role !== 'guard' && !this.local.has(p) && !this.remoteBy.has(p);
    const p = this.d.crowd.people[i];
    if (ok(p) && p.role === role) return p;
    let best: Person | null = null,
      bd = Infinity;
    for (const q of this.d.crowd.people) {
      if (!ok(q) || q.role !== role) continue;
      const dd = (q.pos.x - x) ** 2 + (q.pos.z - z) ** 2;
      if (dd < bd) {
        bd = dd;
        best = q;
      }
    }
    return best;
  }

  private onStart(fr: Friend, d: Record<string, unknown>) {
    const i = Math.round(Number(d.i));
    const x = Number(d.x),
      z = Number(d.z);
    if (!Number.isFinite(i) || !Number.isFinite(x) || !Number.isFinite(z)) return;
    const key = `${fr.id}:${i}`;
    if (this.remote.has(key)) return;
    const p = this.resolve(i, String(d.r), x, z);
    if (!p) return;
    // Same person on both machines: their look and their character (voice, name).
    const look = d.lk as Look | undefined;
    if (look && typeof look === 'object' && typeof look.kind === 'string' && JSON.stringify(look) !== JSON.stringify(p.look)) this.d.crowd.setLook(p, look);
    if (Number.isFinite(Number(d.sd))) p.seed = Number(d.sd);
    const home = this.standUp(p);
    p.pos.set(x, p.role === 'guard' ? this.d.world.groundAt(x, z) : p.pos.y, z);
    if (Number.isFinite(Number(d.y))) p.yaw = Number(d.y);
    p.fight = fightPose();
    this.dropProp(p);
    p.angry = 1;
    const puppet = new Brawl(temperament('x'), !!d.t);
    const r: Remote = {
      key,
      owner: fr.id,
      idx: i,
      p,
      name: typeof d.n === 'string' ? d.n.slice(0, 24) : 'Guest',
      puppet,
      hp: 100,
      max: 100,
      x,
      z,
      yaw: p.yaw,
      owed: null,
      heard: this.time,
      home,
    };
    this.remote.set(key, r);
    this.remoteBy.set(p, r);
    this.d.crowd.react(p.pos, 4, 'gasp');
  }

  private dropRemote(r: Remote) {
    this.remote.delete(r.key);
    this.remoteBy.delete(r.p);
    this.restore(r.p, r.home);
  }

  private onHit(fr: Friend, d: Record<string, unknown>) {
    const i = Math.round(Number(d.i));
    if (!Number.isFinite(i)) return;
    const zone: Zone = d.z ? 'head' : 'body';
    const power = THREE.MathUtils.clamp(Number(d.p) || 0, 0, 1);
    const blocked = !!d.b;
    if (d.by === 'n') {
      // Their guest swung at them.
      const r = this.remote.get(`${fr.id}:${i}`);
      if (r && r.puppet.phase === 'windup') r.owed = 'strike';
      const av = fr.person;
      if (!av) return;
      const at = this.v1.set(av.pos.x, av.pos.y + (zone === 'head' ? 1.6 : 1.2), av.pos.z);
      if (d.m) this.d.sound.play('whoosh', at, { volume: 0.5 });
      else {
        this.d.sound.play(blocked ? 'block' : 'punch', at, { volume: 0.9 });
        if (!blocked) {
          av.gaspT = Math.max(av.gaspT, 0.7);
          if (zone === 'head') av.snapX += 0.3;
        }
      }
      return;
    }
    // A friend hit a guest.
    const s = this.session;
    const v = this.v3.set(Number(d.dx) || 0, 0, Number(d.dz) || 0);
    const slap = !!d.sl;
    const cheek = d.cs === 0 || d.cs === 1 ? d.cs : undefined;
    const owner = typeof d.o === 'string' ? d.o : '';
    if (s && owner === s.selfId) {
      // Our fight: we apply it.
      let lf: Local | undefined;
      for (const f of this.local.values()) if (f.idx === i) lf = f;
      if (!lf) return;
      const blow: Blow = { zone, power, slap, blocked };
      const r = lf.brawl.hit(blow, rnd);
      this.afterHit(lf, blow, r);
      this.hitFx(lf.p, zone, power, v, blocked, slap, cheek);
      return;
    }
    const p = owner
      ? owner === fr.id
        ? this.remote.get(`${fr.id}:${i}`)?.p
        : this.remote.get(`${owner}:${i}`)?.p
      : this.resolve(i, this.d.crowd.people[i]?.role ?? 'wander', fr.person?.pos.x ?? 0, fr.person?.pos.z ?? 0);
    if (!p) return;
    this.hitFx(p, zone, power, v, blocked, slap, cheek);
  }

  private onKO(fr: Friend, d: Record<string, unknown>) {
    if (d.w === 'p') {
      // Your friend's out cold: their avatar goes down.
      const av = fr.person;
      if (!av) return;
      av.fight ??= fightPose();
      this.avatarDown.set(av, KO_SECONDS + AVATAR_GETUP);
      this.d.crowd.react(av.pos, 6, 'gasp');
      this.d.hud.toast(`${fr.name} got knocked out!`, 'warn');
      return;
    }
    if (d.w === 'u') {
      const av = fr.person;
      if (av && this.avatarDown.has(av)) this.avatarDown.set(av, Math.min(this.avatarDown.get(av)!, AVATAR_GETUP));
      return;
    }
    const r = this.remote.get(`${fr.id}:${Math.round(Number(d.i))}`);
    if (!r) return;
    r.puppet.show('ko');
    this.d.crowd.react(r.p.pos, 7, 'gasp');
    this.d.sound.play('thunk', r.p.pos, { volume: 1, rate: 0.5 });
    this.d.hud.toast(`${fr.name} knocked ${r.name} out!`, 'info');
  }

  private updateRemote(dt: number) {
    const s = this.session;
    if (!s) return;
    const seen = new Set<string>();
    for (const fr of s.friendList()) {
      if (fr.state.fm) this.mode.onSnap(fr.state.fm);
      const a = fr.state.fx;
      if (!Array.isArray(a)) continue;
      for (let k = 0; k + FX - 1 < a.length; k += FX) {
        const key = `${fr.id}:${Math.round(a[k])}`;
        const r = this.remote.get(key);
        if (!r) continue;
        seen.add(key);
        r.heard = this.time;
        r.x = a[k + 1] / 100;
        r.z = a[k + 2] / 100;
        r.yaw = a[k + 3] / 100;
        const ph = PHASES[a[k + 4]] ?? 'guard';
        r.hp = a[k + 5];
        r.max = a[k + 6] || 100;
        r.puppet.side = a[k + 7] ? 1 : 0;
        r.puppet.head = !!a[k + 8];
        r.puppet.move = MOVES[a[k + 9] & 7] ?? 'jab';
        if (a[k + 9] & 8) r.puppet.blockNow(0.2);
        if (ph !== r.puppet.phase) {
          // We never saw the punch itself (it's quick): show it before moving on.
          if (r.puppet.phase === 'windup' && ph !== 'strike') r.owed = ph;
          else if (r.owed === null) r.puppet.show(ph);
        }
      }
    }
    for (const r of [...this.remote.values()]) {
      // Lost track (they left the room, or the end never came): let them go.
      if (!seen.has(r.key) && this.time - r.heard > 4) {
        this.dropRemote(r);
        continue;
      }
      const p = r.p;
      const pz = r.puppet;
      pz.t += dt;
      if (r.owed) {
        if (pz.phase !== 'strike') pz.show('strike');
        else if (pz.t >= T.strike) {
          pz.show(r.owed === 'strike' ? 'recover' : r.owed);
          r.owed = null;
        }
      }
      // Follow where their machine says (smoothly).
      const k = Math.min(1, dt * 8);
      const mx = (r.x - p.pos.x) * k,
        mz = (r.z - p.pos.z) * k;
      if (Math.hypot(r.x - p.pos.x, r.z - p.pos.z) > 3) p.pos.set(r.x, p.pos.y, r.z);
      else {
        p.pos.x += mx;
        p.pos.z += mz;
      }
      p.moving = Math.min(2, Math.hypot(mx, mz) / Math.max(dt, 1e-3));
      turn(p, r.yaw, k);
      // The punch goes at the friend they're fighting.
      const target = s.friendList().find((f) => f.id === r.owner)?.person;
      const out = pz.pose(this.poseOut);
      const fp = p.fight!;
      this.toPose(fp, out, pz, p);
      if (target && (pz.phase === 'windup' || pz.phase === 'strike')) this.headOf(target, fp.aim);
      p.angry = pz.phase === 'leave' || pz.down ? 0.3 : 1;
    }
  }

  /** For tests: start a fight with someone right away (as if they'd boiled over). */
  forceFight(p: Person) {
    this.angerOf(p).level = 1.2;
    this.boil(p);
    return this.local.get(p) ?? null;
  }

  /** For tests and the debug console: what's going on. */
  debug() {
    return {
      you: Math.round(this.you.health.hp),
      out: this.you.out,
      fights: [...this.local.values()].map((f) => ({
        name: f.name,
        idx: f.idx,
        phase: f.brawl.phase,
        hp: Math.round(f.brawl.health.hp),
      })),
      remote: [...this.remote.values()].map((r) => ({
        name: r.name,
        idx: r.idx,
        phase: r.puppet.phase,
        hp: r.hp,
      })),
      angry: [...this.anger.entries()]
        .filter(([, a]) => a.level > 0.01)
        .map(([p, a]) => ({
          name: this.nameOf(p),
          level: Math.round(a.level * 100) / 100,
        })),
    };
  }

  dispose() {
    removeEventListener('keydown', this.onKey);
    removeEventListener('keyup', this.onKeyUp);
    this.d.canvas.removeEventListener('pointerdown', this.onPointer, {
      capture: true,
    });
    removeEventListener('pointerup', this.onPointerUp);
    this.d.canvas.removeEventListener('contextmenu', this.onContext);
    this.bars.dispose();
    this.you.dispose();
    this.mode.dispose();
    this.sparks.dispose();
  }
}

const r2 = (x: number) => Math.round(x * 100) / 100;

function turn(p: Person, yaw: number, k: number) {
  let dy = yaw - p.yaw;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  p.yaw += dy * Math.min(1, k);
}

const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();
function distToSeg(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  _ab.copy(b).sub(a);
  const l2 = _ab.lengthSq();
  const t = l2 > 1e-9 ? THREE.MathUtils.clamp(_ap.copy(p).sub(a).dot(_ab) / l2, 0, 1) : 0;
  return _ap.copy(a).addScaledVector(_ab, t).distanceTo(p);
}
