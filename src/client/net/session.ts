import * as THREE from 'three';
import type { Crowd, Person } from '../people';
import { avatarLook } from './avatars';
import type { Player } from '../player';
import type { Hud } from '../hud';
import type { RouletteTable } from '../roulette/table';
import type { CrapsTable } from '../craps/table';
import { money } from '../game';
import type { Bankroll } from '../../rules/bankroll';
import type { NetEvent, PlayerState, Transport, Wire } from './transport';

/** Viewpoints where a player sits (the rest are played standing). */
const SEATED = (id: string | null) => !!id && id !== 'craps';

interface Remote {
  id: string;
  state: PlayerState;
  person: Person | null;
  lastEvent: number;
  tag: THREE.Sprite;
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

  constructor(private d: SessionDeps) {
    this.code = d.transport.code;
    this.host = d.host;
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
    d.bankroll.onChange(() => this.flush());
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

  leave() {
    this.d.transport.leave();
    for (const r of this.remotes.values()) this.drop(r);
    this.remotes.clear();
    this.d.roulette.net = null;
    this.d.craps.net = null;
  }

  private state(): PlayerState {
    const p = this.d.player;
    const f = p.seated ? p.seated.position : p.feet();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(p.camera.getWorldQuaternion(new THREE.Quaternion()));
    return {
      name: this.d.name,
      host: this.host,
      look: this.d.avatar,
      x: Math.round(f.x * 100) / 100,
      z: Math.round(f.z * 100) / 100,
      yaw: Math.round(Math.atan2(dir.x, dir.z) * 100) / 100,
      pitch: Math.round(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)) * 100) / 100,
      moving: 0,
      seat: p.seated?.id ?? null,
      chips: Math.round(this.d.bankroll.balance),
    };
  }

  private lastSent = '';
  private flush() {
    const w: Wire = { s: this.state(), e: this.events };
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
        this.drop(r);
        this.remotes.delete(id);
        this.d.onRoster(this.friends);
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
        bubble: null,
        bubbleUntil: 0,
        target: at.clone(),
        name,
      };
      this.d.scene.add(r.tag);
      this.remotes.set(id, r);
      this.d.hud.toast(`${name} ${s.host ? 'is hosting' : 'joined'} · room LAGO-${this.code}`, 'win');
      this.d.onRoster(this.friends);
      // Tell a newcomer where the craps puck is.
      if (this.host) this.emit('csync', { point: this.d.craps.game.point });
    }
    r.state = w.s;
    r.target.set(Number(w.s.x) || 0, 0, Number(w.s.z) || 0);
    for (const e of w.e) {
      if (e.n <= r.lastEvent) continue;
      r.lastEvent = e.n;
      this.handle(r, e);
    }
  }

  private handle(r: Remote, e: NetEvent) {
    const d = (e.d ?? {}) as Record<string, unknown>;
    switch (e.k) {
      case 'say': {
        const t = String(d.t ?? '').slice(0, 120);
        if (!t) return;
        this.d.hud.say(r.name, t);
        this.showBubble(r, t);
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
      case 'csync':
        if (!this.host && r.state.host) this.d.craps.syncPoint((d.point as number | null) ?? null);
        break;
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
      this.sendT = 0.1;
      this.flush();
    }
    for (const r of this.remotes.values()) {
      const p = r.person;
      if (!p) continue;
      const s = r.state;
      const seated = SEATED(s.seat);
      const dx = r.target.x - p.pos.x,
        dz = r.target.z - p.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 6) p.pos.copy(r.target);
      else {
        const k = Math.min(1, dt * 8);
        p.pos.x += dx * k;
        p.pos.z += dz * k;
      }
      const speed = seated ? 0 : Math.min(3, dist / 0.12);
      p.moving += (speed - p.moving) * Math.min(1, dt * 6);
      p.walkPhase += p.moving * dt * 5.2;
      p.seated = seated;
      p.seatY = s.seat === 'roulette' ? 0.66 : 0.62;
      let dy = s.yaw - p.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      p.yaw += dy * Math.min(1, dt * 8);
      p.homeYaw = p.yaw;
      p.headPitch = THREE.MathUtils.clamp(-s.pitch, -0.5, 0.5);
      const top = p.pos.y + (seated ? 1.45 : 2.0);
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
