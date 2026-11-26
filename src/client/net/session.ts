import * as THREE from 'three';
import { crouchLegs, hipOnSeat } from '../sitpose';
import type { Crowd, Person } from '../people';
import { AVATARS, avatarLook } from './avatars';
import { Fader } from './fade';
import { assignSlots, cssColor, freshEvents, landingSpot, MAX_PLAYERS, Outbox, PLAYER_COLORS, rankScores, relativeBearing, resolveAvatar, type AreaId, type FriendDirection, type Ground, type ScoreRow } from './party';
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
  /** Their player colour (0xRRGGBB): name tag, chip markers, scoreboard, watch. */
  color: number;
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
  /** When we last heard from them (session clock): only friends still talking hold up the outbox. */
  heardAt: number;
  /** Their name tag: drawn normally, plus a faint copy that shows through walls. */
  tag: THREE.Sprite;
  ghost: THREE.Sprite;
  /** The colour slot the tag was drawn with. */
  tagSlot: number;
  mouth: THREE.Object3D | null;
  open: number;
  talkUntil: number;
  bodyYaw: number;
  /** How far they're crouching (m, smoothed). */
  crouch: number;
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
  /** Chips won (+) or lost (−) tonight, for the room's scoreboard. */
  night?(): number;
  /** Which part of the resort a point is in (areas/index.ts `where`). */
  where?(p: THREE.Vector3): AreaId;
  /** The floor, for landing beside a friend ("go to friend"). */
  ground?: Ground;
  /** You're mid-ride in an elevator (no jumping out of a moving car). */
  liftBusy?(): boolean;
  /** Your outfit was changed because a friend who got here first wears the same one. */
  onAvatar?(i: number): void;
}

/**
 * A night out with the crew (up to four players: the host and three friends):
 * publishes where you are and what you do, shows your friends walking the
 * floor with name tags in their own colours (readable from across the room,
 * faintly through walls), chat bubbles and big-win shout outs, shares the
 * roulette wheel and the craps dice (the host's machine decides every spin
 * and roll; each player bets their own chips), points the way to each friend
 * (`friendDirections`, for the watch), jumps you beside one (`goToFriend`),
 * and keeps the night's scoreboard.
 */
export class Session {
  readonly code: string;
  readonly host: boolean;
  private outbox = new Outbox();
  /** Host: the colour slot of each guest. Guests read theirs from the host's state. */
  private slots: Record<string, number> = {};
  private fader: Fader;
  private slotT = 0;
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
    this.voice = new Voice((k, data) => this.emit(k, data), d.listener, d.scene, d.transport.self);
    this.fader = new Fader(d.player.camera);
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

  /** Your id in the room (what friends know you by). */
  get selfId(): string {
    return this.d.transport.self;
  }

  get friends(): string[] {
    return [...this.remotes.values()].map((r) => r.name);
  }

  /** Sends a moment to everyone in the room (it rides along until each friend has it). */
  emit(k: string, data?: unknown) {
    this.outbox.push(k, data, this.time);
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

  /** Change your character (your friends see it change). */
  setAvatar(i: number) {
    this.d.avatar = i;
    this.flush();
  }

  get avatar() {
    return this.d.avatar;
  }

  leave() {
    this.left = true;
    this.fader.dispose();
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
      cr: p.crouch.drop > 0.01 && !p.seated && !stool ? Math.round(p.crouch.drop * 100) / 100 : undefined,
      mo: this.voice?.enabled ? Math.round(this.voice.level() * 9) : 0,
      nt: this.d.night ? Math.round(this.d.night()) : undefined,
      a: this.acks(),
      sl: this.host ? this.slots : undefined,
      ...this.handState(),
      ...(this.extraState?.() ?? {}),
    };
  }

  /** What I've handled from each friend (they drop those events from their outbox). */
  private acks(): Record<string, number> | undefined {
    if (!this.remotes.size) return undefined;
    const a: Record<string, number> = {};
    for (const r of this.remotes.values()) a[r.id] = r.lastEvent;
    return a;
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
  private left = false;
  /** Forget events every friend still in touch has confirmed; the rest ride along (oldest first, within ~3.6 KB). */
  private prune() {
    const live = [...this.remotes.values()].filter((r) => this.time - r.heardAt < 1.5);
    this.outbox.prune(
      live.map((r) => {
        const a = r.state.a?.[this.d.transport.self];
        return typeof a === 'number' ? a : undefined;
      }),
      this.time,
    );
  }

  /** How many of my events of this kind friends haven't confirmed yet (for pacing bulky transfers). */
  unconfirmed(k: string): number {
    this.prune();
    let n = 0;
    for (const e of this.outbox.pending) if (e.k === k) n++;
    return n;
  }

  /** A friend has heard from me (acked at least once), so events I send now reach them. */
  hears(friendId: string): boolean {
    return typeof this.remotes.get(friendId)?.state.a?.[this.d.transport.self] === 'number';
  }

  private flush() {
    if (this.left) return;
    this.prune();
    const w: Wire = this.outbox.packet(this.state());
    const sig = JSON.stringify(w);
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
        this.refreshSlots();
        this.d.onRoster(this.friends);
        this.onChange?.();
      }
      return;
    }
    if (!r) {
      // Host + three: nobody beyond that gets a seat at the table (the transports turn a fifth away at the door).
      if (this.remotes.size >= MAX_PLAYERS - 1) return;
      const s = w.s;
      const name = String(s.name || 'Friend').slice(0, 20);
      const look = avatarLook(Math.floor(Number(s.look) || 0));
      const at = new THREE.Vector3(Number(s.x) || 0, 0, Number(s.z) || 0);
      const person = this.d.crowd.add('buddy', look, at, s.yaw);
      // Their mouth follows their voice (embody); faces.ts gives them blinks and glances.
      if (person) person.ownMouth = true;
      r = {
        id,
        state: s,
        person,
        // Ignore events sent before we arrived, except table state we need now.
        lastEvent: w.e.length ? Math.max(...w.e.map((e) => e.n)) : 0,
        heardAt: this.time,
        tag: nameTag(name, PLAYER_COLORS[0]),
        ghost: nameTag(name, PLAYER_COLORS[0], true),
        tagSlot: -1,
        mouth: null,
        open: 0,
        talkUntil: 0,
        bodyYaw: Number(s.yaw) || 0,
        crouch: 0,
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
      this.d.scene.add(r.tag, r.ghost);
      this.remotes.set(id, r);
      this.refreshSlots();
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
    r.heardAt = this.time;
    r.target.set(Number(w.s.x) || 0, Number(w.s.y) || 0, Number(w.s.z) || 0);
    const { fresh, last } = freshEvents(r.lastEvent, Array.isArray(w.e) ? w.e : []);
    r.lastEvent = last;
    for (const e of fresh) this.handle(r, e);
  }

  // --- The crew: colours, finding each other, the scoreboard ------------------------------

  /** My colour slot (0 = host; guests get theirs from the host), or -1 until the host has said. */
  get slot(): number {
    if (this.host) return 0;
    for (const r of this.remotes.values()) {
      const s = r.state.host ? r.state.sl?.[this.d.transport.self] : undefined;
      if (Number.isInteger(s)) return s as number;
    }
    return -1;
  }

  /** My player colour. */
  get color(): number {
    return PLAYER_COLORS[Math.max(0, this.slot)];
  }

  private slotOf(r: Remote): number {
    if (r.state.host) return 0;
    const s = this.host ? this.slots[r.id] : [...this.remotes.values()].find((x) => x.state.host)?.state.sl?.[r.id];
    if (Number.isInteger(s) && (s as number) >= 0 && (s as number) < MAX_PLAYERS) return s as number;
    // Not handed out yet: a stand-in by order of arrival.
    return 1 + Math.min(MAX_PLAYERS - 2, [...this.remotes.keys()].indexOf(r.id));
  }

  private colorOf(r: Remote): number {
    return PLAYER_COLORS[this.slotOf(r)];
  }

  /** Host: hand out colour slots to whoever's here. */
  private refreshSlots() {
    if (!this.host) return;
    const next = assignSlots(this.slots, [...this.remotes.keys()]);
    if (JSON.stringify(next) !== JSON.stringify(this.slots)) {
      this.slots = next;
      this.flush();
    }
  }

  /** Each friend's tag in their colour; and if a friend who got here first wears my outfit, I change. */
  private refreshLooks() {
    for (const r of this.remotes.values()) {
      const slot = this.slotOf(r);
      if (slot === r.tagSlot) continue;
      r.tagSlot = slot;
      for (const old of [r.tag, r.ghost]) {
        this.d.scene.remove(old);
        old.material.map?.dispose();
        old.material.dispose();
      }
      r.tag = nameTag(r.name, PLAYER_COLORS[slot]);
      r.ghost = nameTag(r.name, PLAYER_COLORS[slot], true);
      this.d.scene.add(r.tag, r.ghost);
      this.onChange?.();
    }
    const mine = this.slot;
    if (mine < 0) return;
    const others = [...this.remotes.values()].map((r) => ({ slot: this.slotOf(r), look: Math.floor(Number(r.state.look) || 0) }));
    const want = resolveAvatar(this.d.avatar, mine, others, AVATARS.length);
    if (want !== this.d.avatar) {
      const taker = [...this.remotes.values()].find((r) => Math.floor(Number(r.state.look) || 0) === this.d.avatar);
      this.d.hud.toast(`${taker?.name ?? 'A friend'} is already wearing ${AVATARS[this.d.avatar].label}: you're ${AVATARS[want].label} tonight`, 'info');
      this.d.avatar = want;
      this.d.onAvatar?.(want);
      this.flush();
    }
  }

  private isTalking(r: Remote) {
    const heard = this.voice.remoteLevel(r.id);
    return this.time < r.talkUntil || (heard ? heard.level > 0.08 : (Number(r.state.mo) || 0) >= 2);
  }

  /** Your heading (atan2(dx, dz) of where your head faces) and where you stand. */
  myHeading(): { pos: THREE.Vector3; yaw: number } {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.d.player.camera.getWorldQuaternion(new THREE.Quaternion()));
    return { pos: this.d.player.feet(), yaw: Math.atan2(dir.x, dir.z) };
  }

  /**
   * Where each friend is from you, for the watch and the room menus:
   * distance on the floor plan, bearing relative to the way you face (0
   * ahead, positive to your right / clockwise, ±π behind), which part of the
   * resort they're in, and whether they're talking. `fromYaw` is a heading,
   * atan2(dx, dz) of your facing direction (`myHeading()` gives yours);
   * leave both out to measure from your own head.
   */
  friendDirections(fromPos?: THREE.Vector3, fromYaw?: number): FriendDirection[] {
    const me = fromPos && fromYaw !== undefined ? null : this.myHeading();
    const pos = fromPos ?? me!.pos;
    const yaw = fromYaw ?? me!.yaw;
    const out: FriendDirection[] = [];
    for (const r of this.remotes.values()) {
      const at = r.person ? r.person.pos : r.target;
      const dx = at.x - pos.x,
        dz = at.z - pos.z;
      out.push({
        id: r.id,
        name: r.name,
        color: this.colorOf(r),
        distance: Math.hypot(dx, dz),
        bearing: relativeBearing(yaw, dx, dz),
        area: this.d.where ? this.d.where(r.target) : 'casino',
        talking: this.isTalking(r),
      });
    }
    return out;
  }

  /**
   * Jump to a friend: a short fade, and you're standing beside them (a free
   * spot in front of them if there is one, never in the pool, a lift car or
   * through a wall), facing them. Returns why not, or null when on the way.
   */
  goToFriend(id: string): string | null {
    const r = this.remotes.get(id);
    if (!r) return 'They left the room';
    if (this.d.liftBusy?.()) return 'Wait for the elevator to arrive';
    if (this.fader.busy) return 'Already on the way';
    const p = this.d.player;
    const at = r.target.clone();
    const heading = r.person ? r.person.yaw : Number(r.state.yaw) || 0;
    const others = [...this.remotes.values()].filter((x) => x !== r).map((x) => ({ x: x.target.x, z: x.target.z }));
    let spot = this.d.ground ? landingSpot({ x: at.x, z: at.z, heading }, this.d.ground, others) : null;
    if (!spot) spot = { x: at.x + Math.sin(heading) * 1.1, z: at.z + Math.cos(heading) * 1.1, heading: heading + Math.PI };
    const s = spot;
    this.fader.run(() => {
      if (p.seated) p.stand();
      // Viewpoint yaw is the camera's (it looks down −z): facing heading h means yaw h + π.
      p.place({ id: 'friend', label: r.name, position: new THREE.Vector3(s.x, 0, s.z), yaw: s.heading + Math.PI, pitch: -0.05, eye: 1.65 });
      p.current = null;
      this.flush();
    });
    this.d.hud.toast(`Off to find ${r.name}`, 'info');
    return null;
  }

  /** The night so far for everyone in the room: chips won or lost tonight, biggest winner first. */
  scoreboard(): ScoreRow[] {
    const rows: ScoreRow[] = [{ id: this.d.transport.self, name: this.d.name, color: this.color, net: this.d.night ? Math.round(this.d.night()) : 0, chips: Math.round(this.d.bankroll.balance), me: true }];
    for (const r of this.remotes.values()) rows.push({ id: r.id, name: r.name, color: this.colorOf(r), net: Math.round(Number(r.state.nt) || 0), chips: Math.round(Number(r.state.chips) || 0), me: false });
    return rankScores(rows);
  }

  /** "#rrggbb" for a player colour (UI). */
  static css(c: number) {
    return cssColor(c);
  }

  /** Extra fields published with your state (e.g. the drink in your hand). */
  extraState: (() => Partial<PlayerState>) | null = null;
  /** Poses a friend's avatar dancing (party/index.ts), before their real hands take the arms. */
  dancer: ((p: Person, s: PlayerState, tracked: boolean) => void) | null = null;

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
    return { id: r.id, name: r.name, person: r.person, state: r.state, color: this.colorOf(r), hand: (side) => r.posed?.[side] ?? null, wrist: (side) => r.wrists[side] ?? (r.hands[side] ? { p: r.hands[side]!, q: new THREE.Quaternion() } : null) };
  }

  /** Host: a friend asked for the wheel to spin / the dice to roll (done as soon as the table is free). */
  private wantSpin: { name: string; t: number } | null = null;
  private wantRoll: { name: string; t: number; from: THREE.Vector3 | null; v: THREE.Vector3 | null } | null = null;
  /** Guest: the host's spins and rolls that arrived while our table was still busy with the last one. */
  private spinQueue: (() => boolean)[] = [];
  private rollQueue: (() => boolean)[] = [];

  /**
   * Keeps the shared tables in step: requests wait for the host's table to be free, and the
   * host's results wait for ours (a slower machine plays the waiting ones a little faster).
   */
  private tables(dt: number) {
    const { roulette, craps, hud } = this.d;
    if (this.wantSpin && this.time - this.wantSpin.t > 12) this.wantSpin = null;
    if (this.wantSpin && roulette.game.phase === 'betting') {
      hud.toast(`${this.wantSpin.name} calls for the spin`, 'info');
      this.wantSpin = null;
      roulette.startSpin();
    }
    if (this.wantRoll && this.time - this.wantRoll.t > 12) this.wantRoll = null;
    if (this.wantRoll && craps.phase === 'betting') {
      const w = this.wantRoll;
      this.wantRoll = null;
      hud.toast(`${w.name} is shooting`, 'info');
      craps.hostRoll(w.from, w.v);
    }
    if (this.spinQueue.length) {
      // Catch up: the wheel runs double time while the host is ahead.
      if (roulette.game.phase !== 'betting') roulette.update(dt);
      else if (this.spinQueue[0]()) this.spinQueue.shift();
    }
    if (this.rollQueue.length) {
      if (craps.phase !== 'betting') craps.update(dt);
      else if (this.rollQueue[0]()) this.rollQueue.shift();
    }
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
        // The wheel may still be finishing the last spin here: the call waits for it (a few seconds at most).
        if (this.host) this.wantSpin = { name: r.name, t: this.time };
        break;
      case 'rspin':
        if (!this.host && r.state.host) {
          const pocket = Number(d.pocket),
            seed = Number(d.seed),
            rotor = Number(d.rotor);
          if (!Number.isInteger(pocket) || pocket < 0 || pocket > 37) return;
          // Never drop the host's spin: if our wheel is still on the last one, it plays right after.
          if (this.spinQueue.length || !this.d.roulette.applyRemoteSpin(pocket, seed, rotor)) this.spinQueue.push(() => this.d.roulette.applyRemoteSpin(pocket, seed, rotor));
          if (this.spinQueue.length > 3) this.spinQueue.shift();
        }
        break;
      case 'croll?': {
        const from = Array.isArray(d.from) && d.from.length === 3 && (d.from as unknown[]).every(Number.isFinite) ? new THREE.Vector3().fromArray(d.from as number[]) : null;
        const v = Array.isArray(d.v) && d.v.length === 3 && (d.v as unknown[]).every(Number.isFinite) ? new THREE.Vector3().fromArray(d.v as number[]) : null;
        if (this.host) this.wantRoll = { name: r.name, t: this.time, from, v };
        break;
      }
      case 'croll':
        if (!this.host && r.state.host) {
          const dice = d.dice as [number, number];
          if (!Array.isArray(dice) || dice.some((x) => !(x >= 1 && x <= 6))) return;
          const go = () => this.d.craps.applyRemoteRoll([dice[0], dice[1]], Number(d.seed), d.from as number[], (d.v as number[] | null) ?? null, (d.point as number | null) ?? null);
          // Never drop the host's roll: if our dice are still out, it plays right after.
          if (this.rollQueue.length || !go()) this.rollQueue.push(go);
          if (this.rollQueue.length > 3) this.rollQueue.shift();
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
        void this.voice.signal(r.id, this.d.transport.self, d as never);
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
    if (this.time - (this.gestAt.get(k + r.id) ?? -10) < 1.5) return;
    this.gestAt.set(k + r.id, this.time);
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
    this.dancer?.(p, r.state, !!(r.hands.l || r.hands.r));
    // Crouching: hips down, knees bent, feet on the floor (before the arms reach their real hands).
    if (r.crouch > 0.005 && !p.seated && p.swimHead === null) {
      rig.root.updateMatrixWorld(true);
      crouchLegs(rig.root, b, p.yaw, r.crouch, p.moving > 0.2);
    }
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
    this.d.scene.remove(r.tag, r.ghost);
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
    if (this.left) return;
    this.time += dt;
    this.fader.update(dt);
    this.tables(dt);
    // Publish my state ~10 times a second when it changes (events go at once).
    this.sendT -= dt;
    if (this.sendT <= 0) {
      // Faster while your hands are tracked or you're talking, so motion and lips look live;
      // a little slower with a full room (the host relays every packet to the others).
      const crowd = this.remotes.size >= 3 ? 1.35 : this.remotes.size === 2 ? 1.15 : 1;
      this.sendT = (this.d.hands?.() || (this.voice.enabled && this.voice.level() > 0.05) ? 0.05 : 0.1) * crowd;
      this.flush();
    }
    this.slotT -= dt;
    if (this.slotT <= 0) {
      this.slotT = 0.5;
      this.refreshSlots();
      this.refreshLooks();
    }
    const cam = this.d.player.camera.getWorldPosition(new THREE.Vector3());
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
      // Crouching (the button crouch; sent as how far their eyes came down).
      const cr = seated || s.sw ? 0 : THREE.MathUtils.clamp(Number(s.cr) || 0, 0, 0.6);
      r.crouch += (cr - r.crouch) * Math.min(1, dt * 12);
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
      const top = p.pos.y + (seated ? 1.45 : 2.0) - r.crouch;
      this.voice.update(r.id, new THREE.Vector3(p.pos.x, top - 0.25, p.pos.z));
      // Name tags stay readable across the room: they grow with distance (keeping their
      // size on screen past a few metres), and a faint copy shows through walls.
      r.tag.position.set(p.pos.x, top + 0.12, p.pos.z);
      const far = THREE.MathUtils.clamp(cam.distanceTo(r.tag.position) / 3.5, 1, 7);
      r.tag.scale.set(r.tag.userData.w * far, r.tag.userData.h * far, 1);
      r.tag.position.y += (far - 1) * 0.08;
      r.ghost.position.copy(r.tag.position);
      r.ghost.scale.copy(r.tag.scale);
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

function label(text: string, opts: { bg: string; fg: string; font: string; pad: number; height: number; tail?: boolean; edge?: string; dot?: string; ghost?: boolean }): THREE.Sprite {
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
  g.strokeStyle = opts.edge ?? '#d4a94e';
  g.lineWidth = opts.edge ? 5 : 3;
  g.beginPath();
  g.roundRect(2, 2, w - 4, 60, 28);
  g.stroke();
  if (opts.dot) {
    g.fillStyle = opts.dot;
    g.beginPath();
    g.arc(opts.pad + 2, 32, 9, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = opts.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2 + (opts.dot ? 12 : 0), 33);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial(opts.ghost ? { map: t, depthWrite: false, depthTest: false, transparent: true, opacity: 0.42, fog: false } : { map: t, depthWrite: false, transparent: true, fog: false }),
  );
  const h = opts.height;
  s.scale.set((h * c.width) / c.height, h, 1);
  s.userData.w = s.scale.x;
  s.userData.h = h;
  s.raycast = () => {};
  s.renderOrder = opts.ghost ? 11 : 10;
  return s;
}

/** A friend's name tag in their colour. `ghost`: the faint copy drawn through walls. */
function nameTag(name: string, color: number, ghost = false) {
  const c = cssColor(color);
  return label(name, { bg: 'rgba(20,12,8,0.82)', fg: '#fff1d0', font: 'italic 600 36px Georgia, serif', pad: 34, height: 0.16, edge: c, dot: c, ghost });
}

function bubble(text: string) {
  return label(text, { bg: 'rgba(250,244,230,0.95)', fg: '#2a1a10', font: '32px Georgia, serif', pad: 24, height: 0.2, tail: true });
}
