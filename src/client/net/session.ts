import * as THREE from 'three';
import { hipOnSeat } from '../sitpose';
import type { Crowd, Person } from '../people';
import { avatarLook } from './avatars';
import { Voice } from './voice';
import { makeMouth, reach, setFingers, setOpen } from './embody';
import { blendPose, OPEN, packPose, unpackPose, type FingerPose } from '../fingers';
import type { Player } from '../player';
import type { Hud } from '../hud';
import type { RouletteTable } from '../roulette/table';
import type { CrapsTable } from '../craps/table';
import { money } from '../game';
import type { Bankroll } from '../../rules/bankroll';
import type { NetEvent, PlayerState, Transport, Wire } from './transport';
import { PosedHand, skinTone } from '../posedhand';

/** Viewpoints where a player sits (the rest are played standing). */
const SEATED = (id: string | null) => !!id && id !== 'craps';

/** What other parts of the game may know about a friend in the room. */
export interface Friend {
  id: string;
  name: string;
  person: Person | null;
  state: PlayerState;
  /** Their hand model (VR players), if shown. */
  hand(side: 'l' | 'r'): PosedHand | null;
  /** Their wrist pose (VR players), if known. */
  wrist(side: 'l' | 'r'): { p: THREE.Vector3; q: THREE.Quaternion } | null;
}

interface Remote {
  id: string;
  state: PlayerState;
  person: Person | null;
  lastEvent: number;
  tag: THREE.Sprite;
  mouth: THREE.Object3D | null;
  open: number;
  talkUntil: number;
  bodyYaw: number;
  hands: { l: THREE.Vector3 | null; r: THREE.Vector3 | null };
  /** Their wrists (smoothed world poses) and the hand models shown there. */
  wrists: { l: { p: THREE.Vector3; q: THREE.Quaternion } | null; r: { p: THREE.Vector3; q: THREE.Quaternion } | null };
  posed: { l: PosedHand; r: PosedHand } | null;
  skinOf: THREE.Object3D | null;
  /** Grip squeeze shown on their hands (0..1). */
  fist: { l: number; r: number };
  /** Their finger poses as displayed (smoothed). */
  pose: { l: FingerPose; r: FingerPose };
  /** A gesture a screen player is offering (their avatar acts it out). */
  emote: { k: string; t0: number } | null;
  /** Hand-contact bookkeeping per my-hand/their-hand pair. */
  contact: Map<string, { t0: number; speed: number; done: boolean }>;
  bubble: THREE.Sprite | null;
  bubbleUntil: number;
  target: THREE.Vector3;
  name: string;
}

export interface SessionDeps {
  transport: Transport;
  host: boolean;
  name: string;
  /** Index into AVATARS. */
  avatar: number;
  crowd: Crowd;
  player: Player;
  hud: Hud;
  scene: THREE.Scene;
  bankroll: Bankroll;
  roulette: RouletteTable;
  craps: CrapsTable;
  /** Plays a reaction at a world position (cheer). */
  cheer(at: THREE.Vector3): void;
  /** A short slap/clap sound at a point (high fives). */
  slap?(at: THREE.Vector3): void;
  /** Knuckles knocking (fist bump). */
  knock?(at: THREE.Vector3): void;
  /** A soft clasp (handshake). */
  pat?(at: THREE.Vector3): void;
  /** The 3D audio listener (voice chat plays from the friend's avatar). */
  listener: THREE.AudioListener;
  /** Your real hands in VR (world positions), or null on a screen. */
  hands?(): { l: THREE.Vector3 | null; r: THREE.Vector3 | null } | null;
  /** Your wrists' world poses in VR (for the hands your friend sees). */
  wrists?(): { l: { p: THREE.Vector3; q: THREE.Quaternion } | null; r: { p: THREE.Vector3; q: THREE.Quaternion } | null } | null;
  /** Grip squeeze per hand 0..1 (VR). */
  grip?(): { l: number; r: number };
  /** Per-finger poses (VR controllers' touch sensors or hand tracking). */
  fingers?(): { l: FingerPose; r: FingerPose };
  /** Buzz a controller (VR). */
  haptic?(side: 'left' | 'right', strength: number, ms: number): void;
  /** Called when the set of connected friends changes. */
  onRoster(names: string[]): void;
}

/**
 * A two-player night: publishes where you are and what you do, shows your
 * friend walking the floor with a name tag, chat bubbles and big-win shout
 * outs, and shares the roulette wheel and the craps dice (the host's machine
 * decides every spin and roll; each player bets their own chips).
 */
export class Session {
  readonly code: string;
  readonly host: boolean;
  private seq = 0;
  private events: NetEvent[] = [];
  private remotes = new Map<string, Remote>();
  private sendT = 0;
  private time = 0;
  private gestAt = new Map<string, number>();
  private offered: { k: string; t: number } | null = null;
  private prevHands: { l: THREE.Vector3 | null; r: THREE.Vector3 | null } = { l: null, r: null };
  readonly voice: Voice;
  /** Your friend clinked glasses with you (position, their name). */
  onCheers: ((at: THREE.Vector3, name: string) => void) | null = null;
  /** Called when anything shown in menus changes (friends, voice). */
  onChange: (() => void) | null = null;

  constructor(private d: SessionDeps) {
    this.code = d.transport.code;
    this.host = d.host;
    this.voice = new Voice((k, data) => this.emit(k, data), d.listener, d.scene, d.host);
    this.voice.onChange = () => {
      this.flush();
      this.onChange?.();
    };
    d.transport.onRemote((id, w) => this.receive(id, w));
    // Shared tables.
    d.roulette.net = {
      role: d.host ? 'host' : 'guest',
      request: () => this.emit('rspin?'),
      announce: (s) => this.emit('rspin', s),
    };
    d.craps.net = {
      role: d.host ? 'host' : 'guest',
      request: (t) => this.emit('croll?', t),
      announce: (r) => this.emit('croll', r),
    };
    // On a screen there are no tracked hands: reaching for chips or the spin
    // button shows as a reach on your avatar (any bet takes chips).
    let last = d.bankroll.balance;
    d.bankroll.onChange(() => {
      if (d.bankroll.balance < last - 0.001) this.emit('act', { k: 'reach' });
      last = d.bankroll.balance;
      this.flush();
    });
  }

  get friends(): string[] {
    return [...this.remotes.values()].map((r) => r.name);
  }

  /** Sends a moment to the other player(s). */
  emit(k: string, data?: unknown) {
    this.events.push({ n: ++this.seq, k, d: data });
    while (this.events.length > 6) this.events.shift();
    this.flush();
  }

  say(text: string) {
    const t = text.trim().slice(0, 120);
    if (!t) return;
    this.emit('say', { t });
    this.d.hud.say(this.d.name, t);
  }

  /** A notable win worth shouting about to your friend. */
  bigWin(game: string, amount: number) {
    this.emit('big', { g: game, a: Math.round(amount * 100) / 100 });
  }

  /** Switch voice chat on (asks for the microphone). Returns an error message or null. */
  async enableVoice(): Promise<string | null> {
    const err = await this.voice.enable();
    if (!err) for (const r of this.remotes.values()) this.voice.sync(r.id, !!r.state.v);
    return err;
  }

  /** Is a friend standing within `r` metres of you? */
  friendNear(r: number): boolean {
    for (const x of this.remotes.values()) if (x.person && x.person.pos.distanceTo(this.d.player.feet()) < r) return true;
    return false;
  }

  /** Change your character (your friend sees it change). */
  setAvatar(i: number) {
    this.d.avatar = i;
    this.flush();
  }

  get avatar() {
    return this.d.avatar;
  }

  leave() {
    this.voice.disable();
    this.d.transport.leave();
    for (const r of this.remotes.values()) this.drop(r);
    this.remotes.clear();
    this.d.roulette.net = null;
    this.d.craps.net = null;
  }

  private state(): PlayerState {
    const p = this.d.player;
    // On a stool you walked onto: you're sitting on its centre.
    const stool = !p.seated && p.stool ? p.stool : null;
    const f = p.seated ? p.seated.position : stool ? new THREE.Vector3(stool.x, p.feetY, stool.z) : p.feet();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(p.camera.getWorldQuaternion(new THREE.Quaternion()));
    return {
      name: this.d.name,
      host: this.host,
      look: this.d.avatar,
      x: Math.round(f.x * 100) / 100,
      y: Math.round(f.y * 100) / 100,
      z: Math.round(f.z * 100) / 100,
      yaw: Math.round(Math.atan2(dir.x, dir.z) * 100) / 100,
      pitch: Math.round(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)) * 100) / 100,
      moving: 0,
      seat: p.seated?.id ?? null,
      st: stool ? Math.round(stool.y * 100) / 100 : undefined,
      chips: Math.round(this.d.bankroll.balance),
      v: this.voice?.enabled ?? false,
      hh: Math.round((p.camera.getWorldPosition(new THREE.Vector3()).y - p.rig.position.y) * 100) / 100,
      sw: p.swimming ? 1 : 0,
      mo: this.voice?.enabled ? Math.round(this.voice.level() * 9) : 0,
      ...this.handState(),
      ...(this.extraState?.() ?? {}),
    };
  }

  private handState(): Partial<PlayerState> {
    const h = this.d.hands?.();
    if (!h) return {};
    const r = (v: THREE.Vector3 | null) => (v ? v.toArray().map((x) => Math.round(x * 100) / 100) : null);
    const g = this.d.grip?.() ?? { l: 0, r: 0 };
    const f = this.d.fingers?.();
    const w = this.d.wrists?.();
    const pose = (x: { p: THREE.Vector3; q: THREE.Quaternion } | null | undefined) =>
      x ? [...x.p.toArray().map((v) => Math.round(v * 1000) / 1000), ...x.q.toArray().map((v) => Math.round(v * 100) / 100)] : null;
    return {
      lh: r(h.l),
      rh: r(h.r),
      lg: Math.round(g.l * 10) / 10,
      rg: Math.round(g.r * 10) / 10,
      ...(f ? { lf: packPose(f.l), rf: packPose(f.r) } : {}),
      ...(w ? { lw: pose(w.l), rw: pose(w.r) } : {}),
    };
  }

  private lastSent = '';
  private flush() {
    const w: Wire = { s: this.state(), e: [...this.events] };
    let sig = JSON.stringify(w);
    // The claude.ai room carries at most 4 KiB per player: drop the oldest events if needed.
    while (sig.length > 3600 && w.e.length > 1) {
      w.e.shift();
      sig = JSON.stringify(w);
    }
    if (sig === this.lastSent) return;
    this.lastSent = sig;
    this.d.transport.publish(w);
  }

  private receive(id: string, w: Wire | null) {
    let r = this.remotes.get(id);
    if (!w) {
      if (r) {
        this.d.hud.toast(`${r.name} left the casino`, 'info');
        this.voice.drop(r.id);
        this.drop(r);
        this.remotes.delete(id);
        this.d.onRoster(this.friends);
        this.onChange?.();
      }
      return;
    }
    if (!r) {
      const s = w.s;
      const name = String(s.name || 'Friend').slice(0, 20);
      const look = avatarLook(Math.floor(Number(s.look) || 0));
      const at = new THREE.Vector3(Number(s.x) || 0, 0, Number(s.z) || 0);
      const person = this.d.crowd.add('buddy', look, at, s.yaw);
      r = {
        id,
        state: s,
        person,
        // Ignore events sent before we arrived, except table state we need now.
        lastEvent: w.e.length ? Math.max(...w.e.map((e) => e.n)) : 0,
        tag: nameTag(name),
        mouth: null,
        open: 0,
        talkUntil: 0,
        bodyYaw: Number(s.yaw) || 0,
        hands: { l: null, r: null },
        wrists: { l: null, r: null },
        posed: null,
        skinOf: null,
        fist: { l: 0, r: 0 },
        pose: { l: [...OPEN] as FingerPose, r: [...OPEN] as FingerPose },
        emote: null,
        contact: new Map(),
        bubble: null,
        bubbleUntil: 0,
        target: at.clone(),
        name,
      };
      this.d.scene.add(r.tag);
      this.remotes.set(id, r);
      if (person) {
        const rr = r;
        person.driven = true;
        person.onPose = (pp) => this.embody(rr, pp);
      }
      this.d.hud.toast(`${name} ${s.host ? 'is hosting' : 'joined'} · room LAGO-${this.code}`, 'win');
      this.d.onRoster(this.friends);
      // Tell a newcomer where the craps puck is.
      if (this.host) this.emit('csync', { point: this.d.craps.game.point });
    }
    if (r.person && w.s.look !== r.state.look) this.d.crowd.setLook(r.person, avatarLook(Math.floor(Number(w.s.look) || 0)));
    if (!!w.s.v !== !!r.state.v || (w.s.v && this.voice.enabled)) this.voice.sync(r.id, !!w.s.v);
    r.state = w.s;
    r.target.set(Number(w.s.x) || 0, Number(w.s.y) || 0, Number(w.s.z) || 0);
    for (const e of w.e) {
      if (e.n <= r.lastEvent) continue;
      r.lastEvent = e.n;
      this.handle(r, e);
    }
  }

  /** Extra fields published with your state (e.g. the drink in your hand). */
  extraState: (() => Partial<PlayerState>) | null = null;

  /** Extra event handlers (game mirroring, drinks…): `on('kind', (friend, data) => …)`. */
  private handlers = new Map<string, (friend: Friend, d: Record<string, unknown>) => void>();
  on(kind: string, fn: (friend: Friend, d: Record<string, unknown>) => void) {
    this.handlers.set(kind, fn);
  }

  /** The friends in the room (name, avatar, where their hands are). */
  friendList(): Friend[] {
    return [...this.remotes.values()].map((r) => this.friendOf(r));
  }

  private friendOf(r: Remote): Friend {
    return { id: r.id, name: r.name, person: r.person, state: r.state, hand: (side) => r.posed?.[side] ?? null, wrist: (side) => r.wrists[side] ?? (r.hands[side] ? { p: r.hands[side]!, q: new THREE.Quaternion() } : null) };
  }

  private handle(r: Remote, e: NetEvent) {
    const d = (e.d ?? {}) as Record<string, unknown>;
    const extra = this.handlers.get(e.k);
    if (extra) {
      extra(this.friendOf(r), d);
      return;
    }
    switch (e.k) {
      case 'say': {
        const t = String(d.t ?? '').slice(0, 120);
        if (!t) return;
        this.d.hud.say(r.name, t);
        this.showBubble(r, t);
        r.talkUntil = this.time + Math.min(3.5, 0.6 + t.length * 0.055);
        break;
      }
      case 'big':
        this.d.hud.toast(`${r.name} just won ${money(Number(d.a) || 0)} at ${String(d.g ?? 'the tables')}!`, 'win');
        if (r.person) {
          r.person.cheer = 2.5;
          this.d.cheer(r.person.pos);
        }
        break;
      case 'rspin?':
        if (this.host && this.d.roulette.game.phase === 'betting') {
          this.d.hud.toast(`${r.name} calls for the spin`, 'info');
          this.d.roulette.startSpin();
        }
        break;
      case 'rspin':
        if (!this.host && r.state.host) this.d.roulette.applyRemoteSpin(Number(d.pocket), Number(d.seed), Number(d.rotor));
        break;
      case 'croll?':
        if (this.host && this.d.craps.phase === 'betting') {
          const from = Array.isArray(d.from) ? new THREE.Vector3().fromArray(d.from as number[]) : null;
          const v = Array.isArray(d.v) ? new THREE.Vector3().fromArray(d.v as number[]) : null;
          this.d.hud.toast(`${r.name} is shooting`, 'info');
          this.d.craps.hostRoll(from, v);
        }
        break;
      case 'croll':
        if (!this.host && r.state.host) {
          const dice = d.dice as [number, number];
          if (!Array.isArray(dice) || dice.some((x) => !(x >= 1 && x <= 6))) return;
          this.d.craps.applyRemoteRoll([dice[0], dice[1]], Number(d.seed), d.from as number[], (d.v as number[] | null) ?? null, (d.point as number | null) ?? null);
        }
        break;
      case 'gest':
        this.celebrate(r, String(d.k), null, false);
        break;
      case 'emote':
        if (r.person) {
          const k = String(d.k);
          if (k === 'wave') r.person.cheer = 1.6;
          else r.emote = { k, t0: this.time };
          // Both offered the same thing within a few seconds and close by: it happens.
          if (this.offered && this.offered.k === k && this.time - this.offered.t < 4 && r.person.pos.distanceTo(this.d.player.feet()) < 2.6) {
            this.offered = null;
            this.celebrate(r, k, null, true);
          }
        }
        break;
      case 'cheers':
        if (r.person && r.person.pos.distanceTo(this.d.player.feet()) < 3) this.onCheers?.(r.person.pos.clone().setY(r.person.pos.y + 1.3), r.name);
        break;
      case 'act':
        if (r.person && d.k === 'reach' && !r.state.lh && !r.state.rh) {
          r.person.actionKind = 'reach';
          r.person.action = 0.9;
        }
        break;
      case 'vsig':
        void this.voice.signal(r.id, null, d as never);
        break;
      case 'csync':
        if (!this.host && r.state.host) this.d.craps.syncPoint((d.point as number | null) ?? null);
        break;
    }
  }

  /** Offer a gesture from a screen (no tracked hands): your avatar acts it out for your friend. */
  offer(k: 'highfive' | 'fistbump' | 'handshake' | 'wave') {
    this.offered = { k, t: this.time };
    this.emit('emote', { k });
    // If your friend is already offering the same, it happens now.
    for (const r of this.remotes.values()) {
      if (r.emote && r.emote.k === k && this.time - r.emote.t0 < 4 && r.person && r.person.pos.distanceTo(this.d.player.feet()) < 2.6) {
        this.offered = null;
        this.celebrate(r, k, null, true);
        return;
      }
    }
    const label = { highfive: 'a high five', fistbump: 'a fist bump', handshake: 'a handshake', wave: 'a wave' }[k];
    this.d.hud.toast(k === 'wave' ? 'You wave' : `You offer ${label}`, 'info');
  }

  /** Real hand contact in VR: classify and celebrate high fives, fist bumps and handshakes. */
  private gestures(r: Remote, p: Person, dt: number) {
    // A screen player's offered gesture: their avatar holds the hand out (and VR players can meet it).
    if (r.emote && !r.state.lh && !r.state.rh) {
      const age = this.time - r.emote.t0;
      if (age > 4) r.emote = null;
      else {
        const fwd = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
        const right = new THREE.Vector3(-Math.cos(p.yaw), 0, Math.sin(p.yaw));
        const female = (p.look.kind ?? '').startsWith('female');
        const sc = p.look.height / (female ? 1.72 : 1.82);
        const k = Math.min(1, age * 3);
        const h = r.emote.k === 'highfive' ? 1.75 : r.emote.k === 'fistbump' ? 1.3 : 1.05;
        const reachOut = r.emote.k === 'highfive' ? 0.3 : 0.45;
        const t = p.pos.clone().setY(p.pos.y + h * sc).addScaledVector(fwd, reachOut * k).addScaledVector(right, 0.18);
        if (r.emote.k === 'handshake') t.y += Math.sin(age * 14) * 0.03 * k;
        r.hands.r = t;
        r.fist.r = r.emote.k === 'fistbump' ? 1 : 0;
      }
    }
    const mine = this.d.hands?.();
    if (!mine) return;
    const grip = this.d.grip?.() ?? { l: 0, r: 0 };
    for (const ms of ['l', 'r'] as const) {
      const a = mine[ms];
      const prev = this.prevHands[ms];
      const speed = a && prev ? a.distanceTo(prev) / Math.max(dt, 1e-3) : 0;
      this.prevHands[ms] = a ? a.clone() : null;
      if (!a) continue;
      for (const ts of ['l', 'r'] as const) {
        const b = r.hands[ts];
        const key = ms + ts;
        const c = r.contact.get(key);
        if (!b || a.distanceTo(b) > 0.13) {
          if (c) r.contact.delete(key);
          continue;
        }
        const fp = this.d.fingers?.();
        const curl = (q: FingerPose) => (q[2] + q[3] + q[4]) / 3;
        const myFist = (fp ? curl(fp[ms]) : grip[ms]) > 0.6,
          theirFist = Math.max(r.fist[ts], curl(r.pose[ts])) > 0.6;
        if (!c) {
          const entry = { t0: this.time, speed, done: false };
          r.contact.set(key, entry);
          if (myFist && theirFist && speed > 0.3) {
            entry.done = true;
            this.celebrate(r, 'fistbump', ms, true);
          } else if (!myFist && !theirFist && a.y > 1.25 && speed > 0.35) {
            entry.done = true;
            this.celebrate(r, 'highfive', ms, true);
          }
        } else if (!c.done && this.time - c.t0 > 0.45 && a.y < 1.45 && a.y > 0.7) {
          c.done = true;
          this.celebrate(r, 'handshake', ms, true);
        } else if (c && this.time - c.t0 > 0.45) {
          // Shaking: a little buzz while hands are held.
          if (Math.random() < 0.1) this.d.haptic?.(ms === 'l' ? 'left' : 'right', 0.15, 20);
        }
      }
    }
  }

  /** A gesture landed: sound, buzz, toast, cheers. `mine` says whether we detected it (then tell them). */
  private celebrate(r: Remote, k: string, hand: 'l' | 'r' | null, mine: boolean) {
    if (this.time - (this.gestAt.get(k) ?? -10) < 1.5) return;
    this.gestAt.set(k, this.time);
    if (mine) this.emit('gest', { k });
    const at = r.person ? r.person.pos.clone().setY(1.4) : this.d.player.feet().setY(1.4);
    const names: Record<string, string> = { highfive: 'High five', fistbump: 'Fist bump', handshake: 'Handshake', wave: 'Wave' };
    this.d.hud.toast(`${names[k] ?? 'Nice'} with ${r.name}!`, 'win');
    if (k === 'highfive') this.d.slap?.(at);
    else if (k === 'fistbump') this.d.knock?.(at);
    else this.d.pat?.(at);
    const side = hand === 'l' ? 'left' : 'right';
    this.d.haptic?.(side, k === 'handshake' ? 0.5 : 1, k === 'handshake' ? 120 : 70);
    if (r.person) r.person.cheer = k === 'handshake' ? 0.6 : 1.2;
    if (k !== 'handshake') this.d.cheer(at);
  }

  /** After the avatar's animation: reach for the real hands, open the mouth. */
  private embody(r: Remote, p: Person) {
    const rig = p.rig;
    if (!rig) return;
    const b = rig.bones;
    const female = (p.look.kind ?? '').startsWith('female');
    const sc = p.look.height / (female ? 1.72 : 1.82);
    if (!r.mouth && b.Head) r.mouth = makeMouth(b.Head, rig.root, p.yaw, sc, rig.mesh);
    if (r.mouth) setOpen(r.mouth, r.open);
    const fwd = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    const left = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    // Their real hands (same hand models you see on your own controllers), placed at their wrists.
    if (!r.posed && (r.wrists.l || r.wrists.r)) {
      r.posed = { l: new PosedHand('left'), r: new PosedHand('right') };
      this.d.scene.add(r.posed.l.root, r.posed.r.root);
    }
    if (r.posed && r.skinOf !== rig.mesh) {
      r.skinOf = rig.mesh;
      const c = skinTone(rig.mesh);
      if (c) {
        r.posed.l.setColor(c);
        r.posed.r.setColor(c);
      }
    }
    for (const [side, dir] of [['l', 1], ['r', -1]] as const) {
      const S = side === 'l' ? 'L' : 'R';
      const wrist = r.wrists[side];
      const ph = r.posed?.[side];
      const target = wrist ? wrist.p.clone().addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(wrist.q), 0.035) : r.hands[side];
      const upper = b[`UpperArm${S}`],
        lower = b[`LowerArm${S}`],
        end = b[`Wrist${S}`] ?? b[`Hand${S}`];
      if (ph) {
        ph.visible = !!wrist && !p.culled;
        if (wrist) {
          ph.placeByWrist(wrist.p, wrist.q);
          ph.setPose(r.pose[side]);
        }
      }
      // The avatar's own hand becomes a small fist tucked inside the real-looking one.
      end?.scale.setScalar(wrist ? 0.001 : 1);
      if (!target || !upper || !lower || !end) continue;
      const shoulder = upper.getWorldPosition(new THREE.Vector3());
      const pole = shoulder.clone().add(new THREE.Vector3(0, -0.6, 0)).addScaledVector(fwd, -0.35).addScaledVector(left, 0.45 * dir);
      reach(upper, lower, end, target, pole, 1);
      setFingers(b, S, wrist ? [1, 1, 1, 1, 1] : r.pose[side]);
    }
  }

  private showBubble(r: Remote, text: string) {
    if (r.bubble) {
      this.d.scene.remove(r.bubble);
      r.bubble.material.map?.dispose();
      r.bubble.material.dispose();
    }
    r.bubble = bubble(text);
    r.bubbleUntil = this.time + 6;
    this.d.scene.add(r.bubble);
  }

  private drop(r: Remote) {
    this.d.scene.remove(r.tag);
    if (r.posed) {
      this.d.scene.remove(r.posed.l.root, r.posed.r.root);
      r.posed = null;
    }
    if (r.bubble) this.d.scene.remove(r.bubble);
    if (r.person) {
      // Park the avatar out of sight (the crowd keeps its slot for a rejoin).
      r.person.pos.set(0, -50, 0);
    }
  }

  update(dt: number) {
    this.time += dt;
    // Publish my state ~10 times a second when it changes (events go at once).
    this.sendT -= dt;
    if (this.sendT <= 0) {
      // Faster while your hands are tracked or you're talking, so motion and lips look live.
      this.sendT = this.d.hands?.() || (this.voice.enabled && this.voice.level() > 0.05) ? 0.05 : 0.1;
      this.flush();
    }
    for (const r of this.remotes.values()) {
      const p = r.person;
      if (!p) continue;
      const s = r.state;
      const stool = Number(s.st) || 0;
      const seated = SEATED(s.seat) || stool > 0;
      const dx = r.target.x - p.pos.x,
        dz = r.target.z - p.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 6) p.pos.copy(r.target);
      else {
        const k = Math.min(1, dt * 8);
        p.pos.x += dx * k;
        p.pos.z += dz * k;
        // Height (jumping, wading, swimming) follows quickly.
        p.pos.y += (r.target.y - p.pos.y) * Math.min(1, dt * 12);
      }
      const speed = seated ? 0 : Math.min(3, dist / 0.12);
      p.moving += (speed - p.moving) * Math.min(1, dt * 6);
      p.walkPhase += p.moving * dt * 5.2;
      p.seated = seated;
      // Swimming: their body lies along the surface, head where theirs is.
      p.swimHead = s.sw ? p.pos.y + (Number(s.hh) || 1.6) : null;
      p.seatY = stool > 0 ? p.pos.y + hipOnSeat(stool) : s.seat === 'roulette' ? 0.66 : 0.62;
      // The body follows where they look only when they turn far or walk; the head does the rest.
      const headYaw = Number(s.yaw) || 0;
      let diff = Math.atan2(Math.sin(headYaw - r.bodyYaw), Math.cos(headYaw - r.bodyYaw));
      if (Math.abs(diff) > 0.75 || p.moving > 0.3 || seated) {
        r.bodyYaw += diff * Math.min(1, dt * (p.moving > 0.3 ? 8 : 4));
        diff = Math.atan2(Math.sin(headYaw - r.bodyYaw), Math.cos(headYaw - r.bodyYaw));
      }
      let dy = r.bodyYaw - p.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      p.yaw += dy * Math.min(1, dt * 10);
      p.homeYaw = p.yaw;
      p.headYaw += (THREE.MathUtils.clamp(diff / 0.8, -1.3, 1.3) - p.headYaw) * Math.min(1, dt * 12);
      p.headPitch += (THREE.MathUtils.clamp(-s.pitch, -0.6, 0.6) - p.headPitch) * Math.min(1, dt * 12);
      // Smooth the hands and the mouth between network updates.
      for (const side of ['l', 'r'] as const) {
        const arr = side === 'l' ? s.lh : s.rh;
        if (Array.isArray(arr) && arr.length === 3) {
          const t = new THREE.Vector3(arr[0], arr[1], arr[2]);
          if (!r.hands[side] || r.hands[side]!.distanceTo(t) > 1.5) r.hands[side] = t;
          else r.hands[side]!.lerp(t, Math.min(1, dt * 18));
        } else r.hands[side] = null;
        const w = side === 'l' ? s.lw : s.rw;
        if (Array.isArray(w) && w.length === 7 && w.every(Number.isFinite)) {
          const p = new THREE.Vector3(w[0], w[1], w[2]);
          const q = new THREE.Quaternion(w[3], w[4], w[5], w[6]).normalize();
          const cur = r.wrists[side];
          if (!cur || cur.p.distanceTo(p) > 1.5) r.wrists[side] = { p, q };
          else {
            cur.p.lerp(p, Math.min(1, dt * 18));
            cur.q.slerp(q, Math.min(1, dt * 18));
          }
        } else r.wrists[side] = null;
      }
      this.gestures(r, p, dt);
      r.fist.l += ((Number(s.lg) || 0) - r.fist.l) * Math.min(1, dt * 14);
      r.fist.r += ((Number(s.rg) || 0) - r.fist.r) * Math.min(1, dt * 14);
      // Their fingers: the real per-finger pose when sent, else a fist from grip alone.
      for (const side of ['l', 'r'] as const) {
        const sent = unpackPose(side === 'l' ? s.lf : s.rf);
        const g = r.fist[side];
        const target = sent ?? ([0.1 + 0.8 * g, 0.1 + 0.85 * g, 0.15 + 0.85 * g, 0.15 + 0.85 * g, 0.15 + 0.8 * g] as FingerPose);
        blendPose(r.pose[side], target, Math.min(1, dt * 16));
      }
      // Their mouth follows the voice you hear (analysed here, so it's in sync),
      // or the mic level they send; typed chat makes them "talk" too.
      const talkFlap = this.time < r.talkUntil ? 0.35 + 0.35 * Math.sin(this.time * 17) * Math.sin(this.time * 7.3) : 0;
      const heard = this.voice.remoteLevel(r.id);
      let speech = heard ? heard.level * (0.45 + 0.75 * heard.vowel) : (Number(s.mo) || 0) / 9;
      if (!heard && speech > 0.05) speech *= 0.55 + 0.45 * Math.abs(Math.sin(this.time * 11.3 + Math.sin(this.time * 3.1) * 2));
      const want = Math.max(speech, talkFlap);
      // Jaws open fast and close a touch slower.
      r.open += (want - r.open) * Math.min(1, dt * (want > r.open ? 28 : 16));
      // A talking head moves a little: small nods with the emphasis.
      if (want > 0.15) p.headPitch += Math.sin(this.time * 5.3) * 0.0035 * want;
      const top = p.pos.y + (seated ? 1.45 : 2.0);
      this.voice.update(r.id, new THREE.Vector3(p.pos.x, top - 0.25, p.pos.z));
      r.tag.position.set(p.pos.x, top + 0.12, p.pos.z);
      if (r.bubble) {
        r.bubble.position.set(p.pos.x, top + 0.42, p.pos.z);
        if (this.time > r.bubbleUntil) {
          this.d.scene.remove(r.bubble);
          r.bubble = null;
        }
      }
    }
  }
}

function label(text: string, opts: { bg: string; fg: string; font: string; pad: number; height: number; tail?: boolean }): THREE.Sprite {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  g.font = opts.font;
  const w = Math.min(900, Math.ceil(g.measureText(text).width) + opts.pad * 2);
  c.width = w;
  c.height = 64 + (opts.tail ? 18 : 0);
  g.font = opts.font;
  g.fillStyle = opts.bg;
  g.beginPath();
  g.roundRect(2, 2, w - 4, 60, 28);
  g.fill();
  if (opts.tail) {
    g.beginPath();
    g.moveTo(w / 2 - 12, 60);
    g.lineTo(w / 2, 80);
    g.lineTo(w / 2 + 12, 60);
    g.fill();
  }
  g.strokeStyle = '#d4a94e';
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(2, 2, w - 4, 60, 28);
  g.stroke();
  g.fillStyle = opts.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, 33);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true }));
  const h = opts.height;
  s.scale.set((h * c.width) / c.height, h, 1);
  s.raycast = () => {};
  s.renderOrder = 10;
  return s;
}

function nameTag(name: string) {
  return label(name, { bg: 'rgba(20,12,8,0.82)', fg: '#ffd98a', font: 'italic 600 36px Georgia, serif', pad: 26, height: 0.16 });
}

function bubble(text: string) {
  return label(text, { bg: 'rgba(250,244,230,0.95)', fg: '#2a1a10', font: '32px Georgia, serif', pad: 24, height: 0.2, tail: true });
}
