import * as THREE from 'three';
import type { Crowd, Look, Person } from '../people';
import { fightPose, staffLook } from '../people';
import type { World } from '../world';
import type { Player } from '../player';
import type { Hands } from '../hands';
import type { Sound } from '../audio';
import type { Hud } from '../hud';
import type { Dialogue } from '../dialogue';
import type { ReactKind } from '../reactlines';
import { REACTIONS } from '../reactlines';
import { SPEAKERS } from '../cast';
import { mouthOf, voices } from '../voices';
import type { VoiceId } from '../speech';
import type { Friend, Session } from '../net/session';
import { Anger, temperament, type Provocation, type Temperament } from './anger';
import { Brawl, PHASES, T, type Phase, type PoseOut } from './brawl';
import type { Blow, Zone } from './health';
import { You, KO_SECONDS } from './you';
import { Bars, type OverheadBar } from './bars';

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
const PUNCH_COOL = 0.35;
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
    windup: 0,
    punch: 0,
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
  boxing: { current(): { name: string; frac: number } | null } | null = null;

  constructor(private d: FightsDeps) {
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
    if (p.driven || this.you.out) return;
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
  hitPerson(p: Person, power: number, zone: Zone, v: THREE.Vector3, slap = false) {
    if (this.you.out || p.driven) return;
    this.lastAttack = this.time;
    const blow: Blow = { zone, power, slap };
    const lf = this.local.get(p);
    const rf = this.remoteBy.get(p);
    let blocked = false;
    if (lf) {
      const r = lf.brawl.hit(blow, rnd);
      blocked = r.blocked;
      this.afterHit(lf, blow, r);
    } else if (rf) {
      // A friend's fight: we judge the block from what we see, they apply the damage.
      blocked = rf.puppet.rollBlock(blow, rnd);
      if (blocked) rf.puppet.show('guard');
    } else {
      // Not fighting (yet).
      p.gaspT = Math.max(p.gaspT, slap ? 0.8 : 1);
    }
    this.hitFx(p, zone, power, v, blocked, slap);
    // Out loud.
    if (!lf || this.time - lf.lastYell > 4) {
      if (lf) lf.lastYell = this.time;
      if (blocked)
        this.d.sound.play('gasp', this.headOf(p, this.v1), {
          volume: 0.4,
          rate: 1.3,
        });
      else if (p.role === 'guard') this.d.sound.play('gasp', this.headOf(p, this.v1), { volume: 0.7, rate: 0.8 });
      else this.d.react(p, slap && power < 0.6 ? 'hit' : 'punched');
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
      });
    }
    // Not in a fight yet: this might start one.
    if (!lf && !rf) this.provoke(p, slap ? 'slapped' : 'punched', power);
    else if (lf) this.angerOf(p).add(slap ? 'slapped' : 'punched', power);
  }

  /** What a blow looks and sounds like on someone: the thud (or the clap), the head turning, a red cheek. */
  private hitFx(p: Person, zone: Zone, power: number, v: THREE.Vector3, blocked: boolean, slap: boolean) {
    const at = zone === 'head' ? this.headOf(p, this.v2) : this.v2.set(p.pos.x, p.pos.y + 1.2 * (p.look.height / 1.75), p.pos.z);
    this.d.sound.play(slap ? 'slap' : blocked ? 'block' : 'punch', at, {
      volume: slap ? 0.9 + power * 0.5 : 0.8 + power * 0.6,
      rate: (slap ? 1.0 : 0.85) + Math.random() * 0.15,
    });
    if (blocked || p.fight?.down) return;
    // Which way the hand went, across their face: their right is (-cos yaw, sin yaw).
    const across = -v.x * Math.cos(p.yaw) + v.z * Math.sin(p.yaw);
    if (zone === 'head') {
      if (slap) {
        p.snapY += -Math.sign(across || 1) * (0.45 + 0.35 * power);
        p.snapX += 0.05;
        p.blush = 6;
        // A hand going to their left came from their right: that cheek.
        p.blushSide = across < 0 ? 1 : 0;
      } else {
        p.snapX += 0.25 + 0.3 * power;
        p.snapY += -Math.sign(across || 1) * 0.15 * power;
      }
    }
    p.gaspT = Math.max(p.gaspT, slap ? 0.6 : 0.8);
    // A fighter rocks back a little (the fight handles where they stand).
    if (this.fighting(p) && !slap) {
      const l = Math.hypot(v.x, v.z) || 1;
      const k = 0.08 + 0.12 * power;
      const [nx, nz] = this.d.world.move(p.pos.x, p.pos.z, (v.x / l) * k, (v.z / l) * k, 0.22, true);
      p.pos.x = nx;
      p.pos.z = nz;
    }
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
    if (this.local.has(p) || this.remoteBy.has(p) || p.driven || p.role === 'buddy') return null;
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
    };
    this.local.set(p, f);
    p.fight = fightPose();
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
    this.local.delete(f.p);
    this.restore(f.p, f.home);
    this.session?.emit('fge', { i: f.idx });
  }

  // ---------------------------------------------------------------------------
  // Security
  // ---------------------------------------------------------------------------

  private callSecurity(caller: Person) {
    if (this.guards.length === 0) return;
    if (this.guards.some((g) => this.local.has(g) || this.remoteBy.has(g))) return;
    const name = this.nameOf(caller);
    this.d.hud.toast(`${name} called security!`, 'warn');
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
  deskPunch() {
    if (this.you.out || this.deskCool > 0) return;
    this.deskCool = PUNCH_COOL;
    const p = this.target(1.25);
    this.session?.emit('jab', { s: Math.random() < 0.5 ? 'l' : 'r' });
    if (!p) {
      this.d.sound.playLocal('whoosh', 0.5, 1.1);
      return;
    }
    const pitch = this.v1.set(0, 0, -1).applyQuaternion(this.d.camera.getWorldQuaternion(this.q)).y;
    const me = this.d.player.feet();
    this.v1
      .set(p.pos.x - me.x, 0, p.pos.z - me.z)
      .normalize()
      .multiplyScalar(3);
    this.hitPerson(p, 0.65, pitch > -0.25 ? 'head' : 'body', this.v1);
  }

  // ---------------------------------------------------------------------------
  // You
  // ---------------------------------------------------------------------------

  private knockedOut() {
    this.d.hud.toast('Knocked out!', 'warn');
    this.d.crowd.react(this.d.player.feet(), 6, 'gasp');
    this.session?.emit('fgk', { i: -99, w: 'p' });
    // Whoever did it has won: they walk off.
    for (const f of this.local.values()) if (!f.brawl.over && !f.brawl.down) f.brawl.show('leave');
  }

  private cameRound() {
    this.d.hud.toast('You got rocked, buddy. Take a breather.', 'info');
    this.d.crew.react('bigloss', { force: true });
    this.session?.emit('fgk', { i: -99, w: 'u' });
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

  update(dt: number) {
    this.time += dt;
    this.deskCool = Math.max(0, this.deskCool - dt);
    for (const [p, a] of this.anger) {
      a.update(dt);
      if (!this.local.has(p) && !this.remoteBy.has(p)) p.angry = Math.max(0, Math.min(p.angry, a.level) - dt * 0.05);
    }
    const head = this.d.camera.getWorldPosition(this.headV);
    const feet = this.d.player.feet();
    this.you.update(dt, this.active);
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
      const k = KO_SECONDS - left;
      p.fight.down = left < 1.2 ? left / 1.2 : Math.min(1, (k / 0.7) ** 2);
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
    } else if (ev === 'impact') this.impact(f, head);
    else if (ev === 'ko') {
      /* counted in afterHit */
    } else if (ev === 'giveup') {
      this.d.hud.toast(this.you.out ? `${f.name} walks off` : `${f.name} lets it go`, 'info');
      this.angerOf(p).vent(0.3);
    }
    if (p.role === 'guard' && b.talker && b.phase === 'guard' && !f.warned && this.guards[0] === p) {
      f.warned = true;
      this.d.hud.toast(`Security: “${DUTY_LINES[Math.floor(Math.random() * DUTY_LINES.length)]}”`, 'warn');
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
    } else if (speed !== 0 && dist > 0.01 && !b.down) {
      if (speed > 0) speed = Math.min(speed, Math.max(0, (dist - 0.62) / dt));
      const st = speed * dt;
      const [nx, nz] = this.d.world.move(p.pos.x, p.pos.z, (dx / dist) * st, (dz / dist) * st, 0.22, true);
      p.pos.x = nx;
      p.pos.z = nz;
      p.moving = Math.abs(speed);
    } else p.moving = Math.max(0, p.moving - dt * 4);
    // The pose.
    const out = b.pose(this.poseOut);
    const fp = p.fight!;
    fp.guard = out.guard * (b.talker && p.role === 'guard' ? 0.15 : 1);
    fp.block = out.block;
    fp.windup = out.windup;
    fp.punch = out.punch;
    fp.down = out.down;
    fp.wobble = out.wobble;
    fp.side = b.side;
    fp.aim.copy(f.aim);
    p.angry = leaving || b.down ? Math.max(0, p.angry - dt * 0.3) : 1;
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
    const blocked = this.guarded(f.aim, at);
    const power = 0.6 + Math.random() * 0.35;
    const r = this.you.hurt({
      zone: f.zone,
      power,
      blocked,
      strength: f.temper.power,
    });
    this.d.sound.playLocal(blocked ? 'block' : 'punch', blocked ? 0.7 : 1, 0.85 + Math.random() * 0.15);
    if (!blocked && f.zone === 'head' && !r.ko && Math.random() < 0.3) this.d.hud.toast(`${f.name} rocks you!`, 'warn');
    this.session?.emit('fgh', {
      i: f.idx,
      by: 'n',
      z: f.zone === 'head' ? 1 : 0,
      p: r2(power),
      b: blocked ? 1 : 0,
    });
    // Losing badly: one of the boys comes over.
    if (this.you.health.fraction < 0.4 && !this.peacemaker && !r.ko) this.callBuddy(f);
  }

  /** Line in their own voice (a recorded angry one), and the same on friends' machines. */
  private sayAngry(f: Local) {
    const p = f.p;
    const [voice, alt] = this.d.dialogue.voicesOf(p);
    const id = voice.replace(/^el_/, '');
    const sets = REACTIONS[id];
    if (!sets) return;
    const pool = [...(sets.doused ?? []), ...(sets.hit ?? [])].filter((l) => voices.has(voice, l) || voices.has(alt, l));
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
    this.bars.update(this.d.player.inXR, mine, opp, heads);
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
      fh: this.active || this.you.health.hp < 99.5 ? Math.round(this.you.health.hp) : null,
    });
    session.on('fgs', (f, d) => this.onStart(f, d));
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
    const owner = typeof d.o === 'string' ? d.o : '';
    if (s && owner === s.selfId) {
      // Our fight: we apply it.
      let lf: Local | undefined;
      for (const f of this.local.values()) if (f.idx === i) lf = f;
      if (!lf) return;
      const blow: Blow = { zone, power, slap, blocked };
      const r = lf.brawl.hit(blow, rnd);
      this.afterHit(lf, blow, r);
      this.hitFx(lf.p, zone, power, v, blocked, slap);
      return;
    }
    const p = owner
      ? owner === fr.id
        ? this.remote.get(`${fr.id}:${i}`)?.p
        : this.remote.get(`${owner}:${i}`)?.p
      : this.resolve(i, this.d.crowd.people[i]?.role ?? 'wander', fr.person?.pos.x ?? 0, fr.person?.pos.z ?? 0);
    if (!p) return;
    this.hitFx(p, zone, power, v, blocked, slap);
  }

  private onKO(fr: Friend, d: Record<string, unknown>) {
    if (d.w === 'p') {
      // Your friend's out cold: their avatar goes down.
      const av = fr.person;
      if (!av) return;
      av.fight ??= fightPose();
      this.avatarDown.set(av, KO_SECONDS);
      this.d.crowd.react(av.pos, 6, 'gasp');
      this.d.hud.toast(`${fr.name} got knocked out!`, 'warn');
      return;
    }
    if (d.w === 'u') {
      const av = fr.person;
      if (av && this.avatarDown.has(av)) this.avatarDown.set(av, Math.min(this.avatarDown.get(av)!, 1.2));
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
      const a = fr.state.fx;
      if (!Array.isArray(a)) continue;
      for (let k = 0; k + 8 < a.length; k += 9) {
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
      fp.guard = out.guard * (pz.talker && p.role === 'guard' ? 0.15 : 1);
      fp.block = out.block;
      fp.windup = out.windup;
      fp.punch = out.punch;
      fp.down = out.down;
      fp.wobble = out.wobble;
      fp.side = pz.side;
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
