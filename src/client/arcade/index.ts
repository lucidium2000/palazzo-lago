import * as THREE from 'three';
import type { Bankroll } from '../../rules/bankroll';
import type { Hands } from '../hands';
import type { Hud } from '../hud';
import type { Interaction } from '../interaction';
import type { Player } from '../player';
import type { World } from '../world';
import { ATLAS_H, ATLAS_W, atlasTexture, paintCabinet, paintSwatches } from './art';
import { Cabinet, type CabinetMats } from './cabinet';
import { ControlInstances, TouchPoints } from './controls';
import { DeskControls, type DeskStation } from './desk';
import type { ArcadeLoose, FloorEnv, FloorFrame, FloorGame } from './floor';
import { MODES, type Mode } from './machine';
import { cleanSnap, friendNear, packPad, SharedControls, type ArcadeFriend, type ArcadeSession } from './net';
import { cleanInitials, packTable, ScoreBook, unpackTable, type ScoreEntry } from './scores';
import { ArcadeAudio } from './synth';
import { blankPad, type Game, type RawPad } from './types';
import { Sentinel } from './games/sentinel';
import { Prism } from './games/prism';
import { Rake } from './games/rake';
import { Strip } from './games/strip';
import { Velvet } from './games/velvet';
import { Splash } from './games/splash';
import { Hoops } from './hoops';
import { Hockey } from './hockey';
import { Claw } from './claw';
import { LastMileCabinet } from './lastmile';
import { OnTheRunCabinet } from './ontherun';
import { bakeStatic } from '../merge';

/**
 * The Palazzo Lago arcade: six upright cabinets with original games, the
 * physical floor games, a featured wide cabinet running The Last Mile (a
 * real web game, see lastmile/) and a sit-down twin racing cabinet running ON
 * THE RUN (the owner's WebGL racer, see ontherun/), mounted into whatever room
 * provides the slots.
 *
 *   mountArcade(scene, ARCADE_SLOTS, deps) => { update(dt) }
 *
 * Slots of kind 'cabinet' get the uprights (in GAMES order); 'floor' slots
 * get the floor games (air hockey, hoops, the claw), biggest slot first to
 * the game that needs the most floor. Each slot's `pos` is the centre of its
 * footprint on the floor, `yaw` turns the machine so its front (where you
 * stand) faces the direction (sin yaw, cos yaw).
 */

export interface ArcadeSlot {
  id: string;
  /** 'feature': a wider bay for a featured web game (The Last Mile; ON THE RUN takes the one whose id or hint says racing). */
  kind: 'cabinet' | 'floor' | 'feature';
  pos: THREE.Vector3;
  yaw: number;
  /** Width (across the front) and depth, metres. */
  footprint: [number, number];
  /** What the bay was laid out for ('upright', 'basketball', 'air hockey', 'claw machine'). */
  hint?: string;
}

interface SoundLike {
  listener: THREE.AudioListener;
}

export interface ArcadeDeps {
  interaction: Interaction;
  hands: Hands;
  player: Player;
  sound: SoundLike;
  bankroll: Bankroll;
  /** The room's session (or a getter for it: it comes and goes as you host / join / leave). */
  session?: ArcadeSession | null | (() => ArcadeSession | null);
  camera: THREE.Camera;
  world: World;
  hud: Hud;
  /** Your name, shown on friends' screens when they watch you play. */
  name?: () => string;
  /** Quality tier name ('quest2', 'mobile'…): the lightest tiers draw attract screens less. */
  tier?: string;
  /** The quality tier (the room passes this rather than `tier`). */
  quality?: { name: string };
  /** The room's group: the games go under it so zone culling hides them with the room. When given, the room's
   * world colliders already cover each slot and the arcade adds none of its own. */
  root?: THREE.Object3D;
  /** You're in the part of the resort the arcade is in (elsewhere it idles: no screens, no music). */
  here?: () => boolean;
  /** The room's loose objects: prizes you win become loose things everyone sees (else the claw keeps its own). */
  loose?: ArcadeLoose;
}

export interface ArcadeHandle {
  update(dt: number): void;
  readonly cabinets: Cabinet[];
  readonly floors: FloorGame[];
  /** For tests and the dev harness. */
  readonly debug: Arcade;
}

/** The cabinets, in the order cabinet slots get them, and the house's best scores on a fresh table. */
export const GAMES: { make: () => Game; top: number }[] = [
  { make: () => new Sentinel(), top: 40000 },
  { make: () => new Prism(), top: 20000 },
  { make: () => new Rake(), top: 20000 },
  { make: () => new Strip(), top: 30000 },
  { make: () => new Velvet(), top: 50000 },
  { make: () => new Splash(), top: 12000 },
];

const ZERO_PAD: Readonly<RawPad> = Object.freeze(blankPad());

const FLOOR_TOPS: Record<string, number> = { hoops: 60, hockey: 30, claw: 5 };

/** Screen refresh (per second): being played or watched up close, attract mode nearby. */
const RATE_PLAY = 60;
const RATE_ATTRACT = 5;
const ATTRACT_RANGE = 14;

export class Arcade {
  readonly root = new THREE.Group();
  private bake = new THREE.Group();
  private live = new THREE.Group();
  readonly cabinets: Cabinet[] = [];
  readonly floors: FloorGame[] = [];
  readonly desk = new DeskControls();
  readonly book = new ScoreBook();
  readonly audio: ArcadeAudio;
  private inst: ControlInstances;
  private touch = new TouchPoints();
  private mats: CabinetMats;
  private time = 0;
  /** Who runs each cabinet's game: me, a friend (id), or nobody. */
  private owner: (string | null)[] = [];
  private ownerName: string[] = [];
  /** Each cabinet's controls, shared: friends' hands on it, and the owner's last whole state (net.ts). */
  private share: SharedControls[] = [];
  /** Whether a human is on each two-player cabinet's second set (for the join toast). */
  private human2: boolean[] = [];
  /** The friend's cabinet whose controls I'm on (my hands go to them), or null. */
  private remoteAt: { c: number; set: number } | null = null;
  private remoteSent = 0;
  private lastPadSent = -1;
  /** Time to the next whole-state message per cabinet (while I own it and someone shares it). */
  private stateT: number[] = [];
  /** Just took a game over from this friend: their last few screens are stale, not a clash. */
  private tookFrom: ({ id: string; until: number } | null)[] = [];
  /** Where I am: the cabinet and control set I'm working, or null. */
  at: { cab: number; set: number } | null = null;
  /** Which floor game's desk spot I'm at. */
  private floorAt: { game: number; spot: number } | null = null;
  private pad: RawPad = blankPad();
  private session: ArcadeSession | null = null;
  private sendT: number[] = [];
  private snapBuf: number[] = [];
  /** Tables the room's host keeps (while in a room). */
  private roomTables = new Map<string, ScoreEntry[]>();
  private knownFriends = '';
  private lastInitials = 'AAA';
  /** After stepping away from a machine on a screen: don't sit again until you've walked off. */
  private rearm: THREE.Vector3 | null = null;
  private walkAway: { cab: number; t: number } | null = null;
  private feet = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private awake = true;
  /** The floor games' per-frame info (reused). */
  private ff: FloorFrame = { dt: 0, t: 0, feet: new THREE.Vector3(), inXR: false, desk: null, dist: 0 };
  private ffDesk: { pad: RawPad; spot: number; touch: RawPad } = { pad: blankPad(), spot: 0, touch: blankPad() };
  /** Every game's id and its fresh table's top score. */
  private tops = new Map<string, number>();

  constructor(
    readonly scene: THREE.Scene,
    slots: readonly ArcadeSlot[],
    readonly d: ArcadeDeps,
  ) {
    this.root.name = 'arcade';
    this.bake.name = 'arcade-baked';
    this.live.name = 'arcade-live';
    this.root.add(this.bake, this.live);
    (d.root ?? scene).add(this.root);
    const colliders = !d.root;
    this.audio = new ArcadeAudio(d.sound.listener);

    // One atlas for every printed surface.
    const atlas = document.createElement('canvas');
    atlas.width = ATLAS_W;
    atlas.height = ATLAS_H;
    const ag = atlas.getContext('2d')!;
    const tex = atlasTexture(atlas);
    this.mats = {
      body: new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.55, metalness: 0.1 }),
      art: new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.42, metalness: 0.05, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12 }),
      lit: new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
    };

    const cabSlots = slots.filter((s) => s.kind === 'cabinet');
    const floorSlots = slots.filter((s) => s.kind === 'floor');
    const isRacer = (s: ArcadeSlot) => /rac(ing|er)/i.test(s.id) || /rac(ing|er)/i.test(s.hint ?? '');
    const featureSlot = slots.find((s) => s.kind === 'feature' && !isRacer(s));
    const racerSlot = slots.find((s) => s.kind === 'feature' && isRacer(s));
    const tierName = d.tier ?? d.quality?.name;
    // Fewer bays than games: keep the head-to-head game (friends want it).
    let games = GAMES.slice(0, cabSlots.length);
    if (cabSlots.length < GAMES.length && cabSlots.length > 0) games = [...GAMES.slice(0, cabSlots.length - 1), GAMES[GAMES.length - 1]];
    this.inst = new ControlInstances(cabSlots.length * 2 + 4, cabSlots.length * 6 + 6 + (racerSlot ? 14 : 0));
    this.inst.addTo(this.live);

    games.forEach((gd, i) => {
      const slot = cabSlots[i];
      const game = gd.make();
      paintCabinet(ag, i, game.meta);
      const cab = new Cabinet(i, {
        game,
        tile: i,
        pos: slot.pos,
        yaw: slot.yaw,
        audio: this.audio,
        inst: this.inst,
        mats: this.mats,
        bakeRoot: this.bake,
        liveRoot: this.live,
        hooks: {
          coin: () => this.pay(game.meta.title),
          table: () => this.table(game.meta.id, gd.top),
          submit: (n, s) => this.submit(game.meta.id, n, s, gd.top),
          lastInitials: () => this.lastInitials,
          seed: () => (Math.random() * 2 ** 31) | 0,
        },
      });
      this.cabinets.push(cab);
      this.tops.set(game.meta.id, gd.top);
      this.owner.push(null);
      this.ownerName.push('');
      this.share.push(new SharedControls(cab.sets.length));
      this.human2.push(false);
      this.stateT.push(0);
      this.tookFrom.push(null);
      this.sendT.push(0);
      if (colliders) d.world.addLocalBox(cab.group, 0, 0.02, cab.width + 0.02, 0.86, 'arcade cabinet');
      // Click the screen (screens only) to step up and play.
      d.interaction.register({
        object: cab.screen,
        label: () => (this.at?.cab === i ? null : `Play ${game.meta.title}${game.meta.sub ? ' ' + game.meta.sub : ''} · $1`),
        enabled: () => !d.player.inXR,
        onSelect: () => this.sitAt(i, this.freeSet(i)),
      });
      for (const s of cab.sets) {
        d.hands.register(s.grab);
        s.onPress = (_b, side) => {
          if (side) this.haptic(side, 0.6, 30);
        };
      }
    });

    // Floor games: the biggest floor slot to the game that needs the most room.
    const env: FloorEnv = {
      scene,
      bakeRoot: this.bake,
      liveRoot: this.live,
      mats: this.mats,
      audio: this.audio,
      inst: this.inst,
      touch: this.touch,
      hands: d.hands,
      interaction: d.interaction,
      player: d.player,
      world: d.world,
      camera: d.camera,
      colliders,
      pay: (what) => this.pay(what),
      toast: (t, k) => d.hud.toast(t, k ?? 'info'),
      submit: (g, n, s) => this.submit(g, n, s, FLOOR_TOPS[g] ?? 100),
      haptic: (side, s, ms) => this.haptic(side, s, ms),
      name: () => this.name(),
      sit: (id, spot) => {
        const g = this.floors.findIndex((f) => f.id === id);
        if (g >= 0) this.sitAtFloor(g, spot);
      },
      light: tierName === 'quest2' || tierName === 'mobile',
      loose: d.loose ?? null,
    };
    // Each floor game to the slot laid out for it (by id or hint), else by size: hoops wants the longest lane.
    const makers: { id: string; match: RegExp; make: (s: ArcadeSlot) => FloorGame }[] = [
      { id: 'hoops', match: /hoop|basket/i, make: (s) => new Hoops(env, s, ag) },
      { id: 'hockey', match: /hockey/i, make: (s) => new Hockey(env, s, ag) },
      { id: 'claw', match: /claw|crane/i, make: (s) => new Claw(env, s, ag) },
    ];
    const free = [...floorSlots].sort((a, b) => b.footprint[0] * b.footprint[1] - a.footprint[0] * a.footprint[1]);
    const pick = (re: RegExp) => {
      const i = free.findIndex((s) => re.test(s.id) || re.test(s.hint ?? ''));
      return i >= 0 ? free.splice(i, 1)[0] : null;
    };
    const chosen = makers.map((m) => pick(m.match));
    makers.forEach((m, k) => {
      const s = chosen[k] ?? free.shift();
      if (!s) return;
      const g = m.make(s);
      this.floors.push(g);
      this.tops.set(g.id, FLOOR_TOPS[g.id] ?? 100);
    });
    // The featured bay: The Last Mile (a real web game on a wide cabinet; free to play).
    if (featureSlot) this.floors.push(new LastMileCabinet(env, featureSlot));
    // The racing bay: ON THE RUN (the owner's WebGL racer on a sit-down twin cabinet; free to play).
    if (racerSlot) this.floors.push(new OnTheRunCabinet(env, racerSlot, tierName));

    paintSwatches(ag);
    tex.needsUpdate = true;
    // Merge every static part (one draw per material for the whole arcade).
    bakeStatic(this.bake, { shadows: false });

    this.desk.onLeave = () => this.leaveDesk();
  }

  private name() {
    if (this.d.name) return this.d.name();
    // The name you typed on the start screen.
    const el = typeof document !== 'undefined' ? (document.getElementById('player-name') as HTMLInputElement | null) : null;
    return el?.value.trim() || 'Player';
  }

  private haptic(side: 'left' | 'right', s: number, ms: number) {
    for (const { handedness, gamepad } of this.d.interaction.gamepads()) {
      if (handedness !== side) continue;
      (gamepad as Gamepad & { hapticActuators?: { pulse(v: number, ms: number): void }[] }).hapticActuators?.[0]?.pulse(s, ms);
    }
  }

  private pay(what: string): boolean {
    const b = this.d.bankroll;
    if (!b.canAfford(1)) {
      this.d.hud.toast(`You need $1 in chips to play ${what}`, 'warn');
      return false;
    }
    b.debit(1, 'bet', 'arcade');
    return true;
  }

  // --- High scores (the host keeps the room's) ---------------------------------

  table(game: string, top: number): ScoreEntry[] {
    if (this.session && !this.session.host) {
      const t = this.roomTables.get(game);
      if (t) return t;
    }
    return this.book.table(game, top);
  }

  private submit(game: string, initials: string, score: number, top: number) {
    const n = cleanInitials(initials);
    this.lastInitials = n;
    const s = this.session;
    if (s && !s.host) {
      // Show it at once on my copy of the room's table; the host's answer replaces it.
      const t = this.roomTables.get(game) ?? this.book.table(game, top).map((e) => ({ ...e }));
      this.roomTables.set(game, t);
      const local = t.slice();
      local.push({ n, s: Math.floor(score) });
      local.sort((a, b) => b.s - a.s);
      this.roomTables.set(game, local.slice(0, 10));
      s.emit('arcH+', { g: game, n, s: Math.floor(score) });
    } else {
      this.book.add(game, n, score, top);
      if (s?.host) s.emit('arcHT', { g: game, t: packTable(this.book.table(game, top)) });
    }
  }

  // --- Network --------------------------------------------------------------------

  private attach(s: ArcadeSession | null) {
    this.session = s;
    this.roomTables.clear();
    this.knownFriends = '';
    for (let i = 0; i < this.cabinets.length; i++) {
      if (this.owner[i] !== 'me') this.owner[i] = null;
      this.share[i].pressers.clear();
      this.share[i].lastState = null;
    }
    this.remoteAt = null;
    for (const f of this.floors) f.connect(s);
    if (!s) return;
    s.on('arcS', (f, d) => this.onScreen(f, d));
    // Hands on a cabinet: the owner merges them in; everyone notes who's at the controls (for takeovers).
    s.on('arcI', (f, d) => {
      const c = Number(d.c);
      if (!this.cabinets[c]) return;
      this.share[c].hear(f.id, Number(d.s) || 0, Number(d.p), this.time);
    });
    s.on('arcJ', (f, d) => {
      const c = Number(d.c);
      if (!this.cabinets[c]) return;
      if (d.on) this.share[c].hear(f.id, Number(d.s) || 0, 0, this.time);
      else this.share[c].leave(f.id);
    });
    // The running game, whole (to carry on from if its owner vanishes).
    s.on('arcX', (f, d) => {
      const c = Number(d.c);
      if (!this.cabinets[c] || this.owner[c] !== f.id) return;
      this.share[c].lastState = d.st;
      this.share[c].ownerHeard = this.time;
    });
    // The owner walked away and handed their game to someone at the controls.
    s.on('arcO', (f, d) => {
      const c = Number(d.c);
      const cab = this.cabinets[c];
      if (!cab) return;
      if (d.to === this.session?.selfId) {
        if (this.owner[c] === 'me') return;
        this.takeOver(c, d.st, f.id, `${f.name} stepped away: ${cab.machine.game.meta.title} is yours`);
      } else if (typeof d.to === 'string') {
        this.owner[c] = d.to;
        this.share[c].ownerHeard = this.time;
      }
    });
    s.on('arcH+', (_f, d) => {
      if (!this.session?.host) return;
      const g = String(d.g ?? '');
      const top = this.tops.get(g);
      if (top === undefined) return;
      this.book.add(g, cleanInitials(d.n), Number(d.s) || 0, top);
      this.session.emit('arcHT', { g, t: packTable(this.book.table(g, top)) });
    });
    s.on('arcHT', (_f, d) => {
      if (this.session?.host) return;
      const t = unpackTable(d.t);
      if (t) this.roomTables.set(String(d.g ?? ''), t);
    });
    s.on('arcF', (f, d) => {
      const g = this.floors.find((x) => x.id === d.g);
      g?.receive(f, d);
    });
  }

  /** I carry on a friend's running game from its whole state (they walked away, or vanished). */
  private takeOver(c: number, st: unknown, from: string, msg: string): boolean {
    const m = this.cabinets[c].machine;
    if (!m.loadState(st)) return false;
    this.owner[c] = 'me';
    this.human2[c] = m.human2; // the routing re-tells the game if that changed (who is on the second set here)
    this.tookFrom[c] = { id: from, until: this.time + 1.5 };
    this.share[c].leave(from);
    this.share[c].lastState = null;
    this.sendT[c] = 0;
    this.d.hud.toast(msg, 'win');
    return true;
  }

  /** A friend's name, by id. */
  private friendName(id: string) {
    return this.session?.friendList().find((f) => f.id === id)?.name ?? 'A friend';
  }

  /** A friend's cabinet screen. */
  private onScreen(f: ArcadeFriend, d: Record<string, unknown>) {
    const c = Number(d.c);
    const cab = this.cabinets[c];
    if (!cab) return;
    const mode = MODES[Number(d.m)] ?? 'attract';
    // The friend I just took over from: their last screens were already on the way.
    const took = this.tookFrom[c];
    if (took && took.id === f.id && this.time < took.until) return;
    this.share[c].ownerHeard = this.time;
    if (this.owner[c] === 'me') {
      // Both started at once: the lower id keeps it.
      if (mode === 'play' && f.id < (this.session?.selfId ?? '')) {
        cab.machine.abandon();
        this.owner[c] = null;
      } else return;
    }
    if (mode === 'attract') {
      if (this.owner[c] === f.id) this.owner[c] = null;
      return;
    }
    this.owner[c] = f.id;
    this.ownerName[c] = f.name;
    const snap = cleanSnap(d.a);
    cab.machine.mirror(f.name, mode, snap, typeof d.i === 'string' ? d.i : '');
  }

  private sendScreens(dt: number) {
    const s = this.session;
    if (!s) return;
    const friends = s.friendList();
    // New friends get the room's tables from the host.
    if (s.host) {
      let ids = '';
      for (const f of friends) ids += f.id + ',';
      if (ids !== this.knownFriends) {
        const grew = ids.length > this.knownFriends.length;
        this.knownFriends = ids;
        if (grew) for (const [id, top] of this.tops) s.emit('arcHT', { g: id, t: packTable(this.book.table(id, top)) });
      }
    }
    for (let c = 0; c < this.cabinets.length; c++) {
      if (this.owner[c] !== 'me') continue;
      const cab = this.cabinets[c];
      const m = cab.machine;
      this.sendT[c] -= dt;
      if (this.sendT[c] > 0) continue;
      let anyone = false;
      for (const f of friends) if (friendNear(f, cab.screenCenter.x, cab.screenCenter.z, 14)) anyone = true;
      const busy = m.busy;
      if (!busy) {
        // Finished: tell watchers once, and let it go.
        s.emit('arcS', { c, m: 0 });
        this.owner[c] = null;
        continue;
      }
      // Someone shares the controls: now and then the whole game, so they can carry on if I vanish.
      this.stateT[c] -= dt;
      if (this.share[c].any(this.time) && this.stateT[c] <= 0) {
        this.stateT[c] = 1;
        s.emit('arcX', { c, st: m.saveState() });
      }
      if (!anyone) {
        this.sendT[c] = 0.5;
        continue;
      }
      const two = m.game.meta.players === 2;
      this.sendT[c] = two ? 1 / 20 : 1 / 12;
      const mode = m.snapshot(this.snapBuf);
      const msg: Record<string, unknown> = { c, m: MODES.indexOf(mode), a: this.snapBuf.slice(), n: this.name() };
      if (mode === 'initials') msg.i = m.initialsText;
      s.emit('arcS', msg);
    }
    // My hands on a friend's cabinet (any set: the controls belong to the machine).
    const ra = this.remoteAt;
    if (ra) {
      const p = packPad(this.pad);
      this.remoteSent -= dt;
      if (p !== this.lastPadSent || this.remoteSent <= 0) {
        this.lastPadSent = p;
        this.remoteSent = 0.25;
        s.emit('arcI', { c: ra.c, s: ra.set, p });
      }
    }
  }

  // --- Where you are ------------------------------------------------------------

  /** The first control set nobody's using (set 1 on a two-player game a friend is playing). */
  private freeSet(c: number): number {
    const cab = this.cabinets[c];
    if (cab.sets.length > 1 && this.owner[c] && this.owner[c] !== 'me') return 1;
    return 0;
  }

  private stationFor(c: number, set: number): DeskStation {
    const m = this.cabinets[c].machine.game.meta;
    const b = m.buttons;
    const keys = ['Space', 'X', 'C'];
    const parts = ['Arrows/WASD stick'];
    for (let k = 0; k < 3; k++) if (b[k]) parts.push(`${keys[k]} ${b[k].toLowerCase()}`);
    parts.push('Esc leave');
    return { id: this.cabinets[c].viewpoints[set].id, buttons: b, help: `${m.title}${m.sub ? ' ' + m.sub : ''} · ${parts.join(' · ')}` };
  }

  /** Screens: step up to a cabinet (framed on its screen, keys and touch go to the game). */
  sitAt(c: number, set: number) {
    const p = this.d.player;
    if (p.inXR) return;
    const cab = this.cabinets[c];
    const vp = cab.viewpoints[Math.min(set, cab.viewpoints.length - 1)];
    p.sit(vp);
    this.at = { cab: c, set };
    this.floorAt = null;
    this.desk.enter(this.stationFor(c, set));
    if (this.owner[c] && this.owner[c] !== 'me')
      this.d.hud.toast(
        cab.sets.length > 1 && set === 1 ? `You're player 2 in ${this.ownerName[c] || 'a friend'}'s game` : `You're on the controls with ${this.ownerName[c] || 'a friend'}: your presses count in their game`,
        'info',
      );
  }

  private sitAtFloor(g: number, spot: number) {
    const p = this.d.player;
    if (p.inXR) return;
    const fg = this.floors[g];
    p.sit(fg.viewpoints[spot]);
    this.floorAt = { game: g, spot };
    this.at = null;
    // The station is the spot you sat at (air hockey has one per end): it must match your seat, or the
    // next frame thinks something stood you up and leaves the game.
    this.desk.enter({ ...fg.desk, id: fg.viewpoints[spot].id });
  }

  private leaveDesk() {
    const p = this.d.player;
    this.rearm = p.feet().clone();
    if (this.at) this.cabinets[this.at.cab].sets[this.at.set]?.release();
    if (this.floorAt) this.floors[this.floorAt.game].leaveDesk?.();
    this.at = null;
    this.floorAt = null;
    this.desk.exit();
    if (p.seated) p.stand();
    if (!this.desk.touch) p.lockPointer();
  }

  /** Which of my stations is the player at this frame (screens: seated there; VR: standing there). */
  private locate() {
    const p = this.d.player;
    const feet = this.feet.copy(p.feet());
    if (p.inXR) {
      if (this.desk.station) this.desk.exit();
      this.floorAt = null;
      let best: { cab: number; set: number } | null = null;
      let bd = 0.95;
      for (let c = 0; c < this.cabinets.length; c++) {
        const cab = this.cabinets[c];
        if (Math.abs(cab.group.position.x - feet.x) > 2.5 || Math.abs(cab.group.position.z - feet.z) > 2.5) continue;
        for (let k = 0; k < cab.viewpoints.length; k++) {
          const v = cab.viewpoints[k].position;
          const dd = Math.hypot(v.x - feet.x, v.z - feet.z);
          if (dd < bd) {
            bd = dd;
            best = { cab: c, set: k };
          }
        }
      }
      // Holding a stick keeps you on that cabinet even leaning away.
      for (let c = 0; c < this.cabinets.length; c++) for (let k = 0; k < this.cabinets[c].sets.length; k++) if (this.cabinets[c].sets[k].held) best = { cab: c, set: k };
      this.at = best;
      return;
    }
    // Screens: seated at one of ours?
    const seat = p.seated?.id ?? null;
    if (this.desk.station && seat !== this.desk.station.id) {
      // Something else stood you up (the map, walking keys on a touch stick).
      if (this.at) this.cabinets[this.at.cab].sets[this.at.set]?.release();
      if (this.floorAt) this.floors[this.floorAt.game].leaveDesk?.();
      this.at = null;
      this.floorAt = null;
      this.desk.exit();
      this.rearm = feet.clone();
    }
    if (this.rearm && Math.hypot(this.rearm.x - feet.x, this.rearm.z - feet.z) > 0.9) this.rearm = null;
    if (!p.seated && !this.rearm && !this.desk.station) {
      // Walk up and the game takes over.
      const fwd = this.tmp.set(0, 0, -1).applyQuaternion(this.d.camera.getWorldQuaternion(this.tmpQ));
      for (let c = 0; c < this.cabinets.length; c++) {
        const cab = this.cabinets[c];
        const k = cab.standingAt(feet, 0.42);
        if (k < 0) continue;
        const dx = cab.screenCenter.x - feet.x,
          dz = cab.screenCenter.z - feet.z;
        if ((fwd.x * dx + fwd.z * dz) / (Math.hypot(dx, dz) || 1) < 0.3) continue;
        this.sitAt(c, cab.sets.length > 1 ? k : 0);
        return;
      }
      for (let g = 0; g < this.floors.length; g++) {
        const vps = this.floors[g].viewpoints;
        for (let k = 0; k < vps.length; k++) {
          const v = vps[k].position;
          if (Math.hypot(v.x - feet.x, v.z - feet.z) < 0.4) {
            this.sitAtFloor(g, k);
            return;
          }
        }
      }
    }
  }

  // --- The frame ------------------------------------------------------------------

  update(dt: number) {
    this.time += dt;
    const t = this.time;
    const sess = typeof this.d.session === 'function' ? this.d.session() : (this.d.session ?? null);
    if (sess !== this.session) this.attach(sess);
    const p = this.d.player;
    // Elsewhere in the resort: everything idles (games you left end, screens and music stop).
    if (this.d.here && !this.d.here()) {
      if (this.awake) {
        this.awake = false;
        if (this.desk.station) this.leaveDesk();
        for (let c = 0; c < this.cabinets.length; c++) {
          if (this.owner[c] === 'me') this.cabinets[c].machine.abandon();
          this.cabinets[c].sound.music(null);
        }
        for (const f of this.floors) f.sleep?.();
      }
      this.sendScreens(dt);
      return;
    }
    this.awake = true;
    this.locate();
    const feet = this.feet;
    const inXR = p.inXR;

    // My controls this frame.
    const at = this.at;
    const pad = this.pad;
    if (at) {
      const cab = this.cabinets[at.cab];
      const set = cab.sets[at.set];
      if (inXR) {
        this.touch.gather(this.d.hands);
        for (const s of cab.sets) s.pressFrom(this.touch.points, this.touch.sides, this.touch.count);
        set.readInto(pad);
      } else {
        const dp = this.desk.poll();
        Object.assign(pad, dp);
        set.setFrom(pad);
      }
    } else Object.assign(pad, ZERO_PAD);

    // Route them. The controls belong to the machine: whoever runs the game merges everyone's hands on
    // each set (net.ts mergePads); at a friend's machine my hands go to them (arcI) and I watch their game.
    const was = this.remoteAt;
    this.remoteAt = null;
    const now = this.time;
    const selfId = this.session?.selfId ?? '';
    for (let c = 0; c < this.cabinets.length; c++) {
      const cab = this.cabinets[c];
      const m = cab.machine;
      const sh = this.share[c];
      sh.prune(now);
      const mine = at?.cab === c;
      let friendOwns = !!this.owner[c] && this.owner[c] !== 'me';
      // The owner vanished (left, closed the tab) while I'm at the controls: carry on their game.
      if (friendOwns && mine && this.session && sh.shouldTakeOver(selfId, this.owner[c]!, now)) {
        const from = this.owner[c]!;
        if (this.takeOver(c, sh.lastState, from, `${this.ownerName[c] || 'Your friend'} left: you carry on ${m.game.meta.title}`)) friendOwns = false;
      }
      if (mine && friendOwns) {
        Object.assign(m.pad1, ZERO_PAD);
        Object.assign(m.pad2, ZERO_PAD);
        if (this.session) this.remoteAt = { c, set: at!.set };
        continue;
      }
      // My game (or nobody's): my hands on my set, plus friends' hands if I run it.
      const shared = this.owner[c] === 'me';
      sh.merged(m.pad1, 0, mine && at!.set === 0 ? pad : null, now, shared);
      sh.merged(m.pad2, 1, mine && at!.set === 1 ? pad : null, now, shared);
      if (cab.sets.length === 1 && mine && at!.set > 0) Object.assign(m.pad1, pad);
      if (mine && m.mode === 'play' && this.owner[c] !== 'me') this.owner[c] = 'me';
      // Two-player games: a friend on the second set is player 2.
      if (cab.sets.length > 1) {
        const h2 = shared && sh.at(1, now).length > 0;
        if (h2 !== this.human2[c]) {
          this.human2[c] = h2;
          m.setHuman2(h2);
          if (h2) this.d.hud.toast(`${this.friendName(sh.at(1, now)[0])} joined ${m.game.meta.title} as player 2`, 'win');
        }
      }
      // Walked away from a game in progress: hand it to a friend still at the controls, else it waits a little, then ends.
      if (this.owner[c] === 'me' && !mine && m.busy) {
        if (!this.walkAway || this.walkAway.cab !== c) this.walkAway = { cab: c, t: 0 };
        this.walkAway.t += dt;
        const to = this.walkAway.t > 0.8 ? sh.handTo(now) : null;
        if (to && this.session) {
          this.session.emit('arcO', { c, to, st: m.saveState() });
          this.owner[c] = to;
          this.ownerName[c] = this.friendName(to);
          sh.leave(to);
          sh.ownerHeard = now;
          m.handOff(this.ownerName[c]);
          this.walkAway = null;
        } else if (this.walkAway.t > 20 && m.mode === 'play') {
          m.abandon();
          this.walkAway = null;
        }
      } else if (this.walkAway?.cab === c) this.walkAway = null;
      if (m.mode === 'play' || m.mode === 'over' || m.mode === 'initials' || m.mode === 'scores') {
        if (!friendOwns && m.busy) this.owner[c] = 'me';
      }
    }
    const ra = this.remoteAt as { c: number; set: number } | null;
    if (was && (!ra || ra.c !== was.c || ra.set !== was.set)) this.session?.emit('arcJ', { c: was.c, s: was.set, on: 0 });
    if (ra && (!was || ra.c !== was.c || ra.set !== was.set)) {
      this.session?.emit('arcJ', { c: ra.c, s: ra.set, on: 1 });
      this.remoteSent = 0;
    }

    // Run, draw and sound the cabinets.
    const tier = this.d.tier ?? this.d.quality?.name;
    const light = tier === 'quest2' || tier === 'mobile';
    for (let c = 0; c < this.cabinets.length; c++) {
      const cab = this.cabinets[c];
      const m = cab.machine;
      const dx = cab.screenCenter.x - feet.x,
        dz = cab.screenCenter.z - feet.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const active = m.mode !== 'attract';
      if (active || dist < ATTRACT_RANGE) m.update(dt);
      const rate = active ? (at?.cab === c || dist < 5 ? RATE_PLAY : 15) : dist < ATTRACT_RANGE ? (light && dist > 6 ? 2 : RATE_ATTRACT) : 0;
      cab.draw(dt, t, dist < 30 ? rate : 0);
      cab.sound.music(dist < 18 ? m.music() : null);
      for (const s of cab.sets) s.redraw();
    }

    // Floor games.
    for (let g = 0; g < this.floors.length; g++) {
      const fg = this.floors[g];
      const dist = Math.hypot(fg.center.x - feet.x, fg.center.z - feet.z);
      const ff = this.ff;
      ff.dt = dt;
      ff.t = t;
      ff.feet = feet;
      ff.inXR = inXR;
      ff.dist = dist;
      if (this.floorAt?.game === g) {
        this.ffDesk.pad = this.desk.poll();
        this.ffDesk.spot = this.floorAt.spot;
        this.ffDesk.touch = this.desk.touchPad;
        ff.desk = this.ffDesk;
      } else ff.desk = null;
      fg.update(ff);
    }

    this.sendScreens(dt);
  }
}

export function mountArcade(scene: THREE.Scene, slots: readonly ArcadeSlot[], deps: ArcadeDeps): ArcadeHandle {
  const a = new Arcade(scene, slots, deps);
  return {
    update: (dt) => a.update(dt),
    cabinets: a.cabinets,
    floors: a.floors,
    debug: a,
  };
}

export type { Mode };
