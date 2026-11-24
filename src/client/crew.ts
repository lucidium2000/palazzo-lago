import * as THREE from 'three';
import { voiceArbiter } from './dialogue';
import type { Sound } from './audio';
import type { Hud } from './hud';
import type { Crowd, Look, Person } from './people';
import type { Player } from './player';
import type { World } from './world';
import { CREW_LINES, CREW_VOICES, type CrewMoment, type VoiceId } from './speech';
import { mouthOf, voices } from './voices';

/**
 * Your crew for the night: three buddies who stick with you, crowd around
 * whatever you're playing, hype your wins, razz your losses and suggest where
 * to go next. Each has his own recorded voice (speech.ts).
 */

export type { CrewMoment } from './speech';
const LINES = CREW_LINES;

interface Buddy {
  person: Person;
  name: string;
  pitch: number;
  rate: number;
  voice: number;
  /** His recorded voice. */
  voiceId: VoiceId;
  /** Where he stands relative to you: right, back (metres). */
  slot: [number, number];
}

const LOOKS: Partial<Look>[] = [
  { main: 0x1e2c4a, second: 0xf2ece0, hair: 0x2e1d12, hairStyle: 'short' },
  { main: 0x5a1820, second: 0x101010, hair: 0x1a120c, hairStyle: 'short' },
  { main: 0x3a3a40, second: 0xdfe6ee, hair: 0x8a6a40, hairStyle: 'short' },
];

export class Crew {
  readonly buddies: Buddy[] = [];
  private cooldown = 4;
  private idleIn = 30;
  private lastLine = '';

  constructor(
    private crowd: Crowd,
    private world: World,
    private player: Player,
    _hud: Hud,
    _sound: Sound,
    lookFor: () => Look,
  ) {
    const names = ['Rocco', 'Dev', 'Mikey'];
    const slots: [number, number][] = [
      [1.25, 0.9],
      [-1.25, 0.9],
      [0.35, 1.9],
    ];
    const tones = [
      { pitch: 0.85, rate: 1.05, voice: 1 },
      { pitch: 1.1, rate: 1.12, voice: 2 },
      { pitch: 0.95, rate: 0.98, voice: 3 },
    ];
    const start = player.feet();
    names.forEach((name, i) => {
      const look = { ...lookFor(), ...LOOKS[i], dress: false, height: 1.76 + i * 0.04 };
      const p = crowd.add('buddy', look, start.clone().add(new THREE.Vector3(slots[i][0], 0, slots[i][1])), player.rig.rotation.y);
      if (!p) return;
      const b: Buddy = { person: p, name, slot: slots[i], voiceId: CREW_VOICES[i % CREW_VOICES.length], ...tones[i] };
      p.speed = 1;
      p.onUpdate = (pp, dt) => this.follow(b, pp, dt);
      this.buddies.push(b);
    });
  }

  /** Puts the crew around you immediately (after a map jump or entering VR). */
  regroup() {
    for (const b of this.buddies) {
      const t = this.slotTarget(b);
      if (this.world.groundAt(t.x, t.z) < -0.05) continue;
      b.person.pos.copy(t);
    }
  }

  private yaw() {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.player.camera.getWorldQuaternion(new THREE.Quaternion()));
    return Math.atan2(-dir.x, -dir.z);
  }

  private slotTarget(b: Buddy): THREE.Vector3 {
    const seat = this.player.seated;
    const seated = !!seat;
    // At a game they gather around your seat, whichever way the camera looks.
    const yaw = seat ? seat.yaw : this.yaw();
    // Seated: they line up alongside you at the table or the next machines, out of your view line.
    const seatedSlots: [number, number][] = [
      [1.9, 0.15],
      [-1.9, 0.15],
      [2.75, -0.2],
    ];
    const k = this.buddies.indexOf(b);
    const right = seated ? seatedSlots[k][0] : b.slot[0];
    const back = seated ? seatedSlots[k][1] : b.slot[1];
    const f = seat ? seat.position.clone() : this.player.feet();
    const t = new THREE.Vector3(f.x + Math.cos(yaw) * right + Math.sin(yaw) * back, 0, f.z - Math.sin(yaw) * right + Math.cos(yaw) * back);
    const free = this.world.settle(t.x, t.z, 0.3);
    if (free) t.set(free[0], 0, free[1]);
    return t;
  }

  private follow(b: Buddy, p: Person, dt: number) {
    const target = this.slotTarget(b);
    const dx = target.x - p.pos.x,
      dz = target.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    // The crew stays dry: they wait on the deck while you're in the pool.
    const dry = (x: number, z: number) => this.world.groundAt(x, z) > -0.05;
    if (d > 12) {
      // You jumped across the room: they catch up off-screen.
      if (dry(target.x, target.z)) p.pos.copy(target);
      return;
    }
    const want = d < 0.35 ? 0 : Math.min(2.6, 0.9 + d * 0.6);
    p.moving += (want - p.moving) * Math.min(1, dt * 5);
    if (p.moving > 0.02 && d > 0.05) {
      const step = Math.min(d, p.moving * dt);
      const [nx, nz] = this.world.move(p.pos.x, p.pos.z, (dx / d) * step, (dz / d) * step, 0.24);
      if (!dry(nx, nz) && dry(p.pos.x, p.pos.z)) {
        p.moving = 0;
        return;
      }
      p.pos.x = nx;
      p.pos.z = nz;
      p.walkPhase += p.moving * dt * 5.2;
      const ty = Math.atan2(dx, dz);
      let dy = ty - p.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      p.yaw += dy * Math.min(1, dt * 6);
    } else {
      // Stand facing the same way you do (toward the game), turned a little toward you.
      const seat = this.player.seated;
      const f = seat ? seat.position : this.player.feet();
      const toYou = Math.atan2(f.x - p.pos.x, f.z - p.pos.z);
      const yourDir = (seat ? seat.yaw : this.yaw()) + Math.PI;
      const ty = yourDir + Math.atan2(Math.sin(toYou - yourDir), Math.cos(toYou - yourDir)) * 0.35;
      let dy = ty - p.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      p.yaw += dy * Math.min(1, dt * 3);
    }
  }

  /** Something happened: maybe one of the boys says something. */
  react(moment: CrewMoment, opts: { chance?: number; force?: boolean; cheer?: boolean } = {}) {
    if (opts.cheer || moment === 'bigwin' || moment === 'streak' || moment === 'round' || moment === 'legend' || moment === 'finale') {
      for (const b of this.buddies) b.person.cheer = 1.6 + Math.random() * 0.6;
    }
    if (moment === 'bigloss') for (const b of this.buddies) b.person.gaspT = 1.0;
    if (moment === 'round' || moment === 'order') {
      for (const b of this.buddies) {
        b.person.actionKind = 'sip';
        b.person.action = 1.4;
      }
    }
    if (!opts.force && (this.cooldown > 0 || Math.random() > (opts.chance ?? 1))) return;
    // Don't talk over a guest or the staff (forced lines still cut in, like friends do).
    if (!opts.force && (voiceArbiter.busy() || voices.priorityBusy)) return;
    const lines = LINES[moment];
    let line = lines[Math.floor(Math.random() * lines.length)];
    if (line === this.lastLine) line = lines[(lines.indexOf(line) + 1) % lines.length];
    this.lastLine = line;
    const b = this.buddies[Math.floor(Math.random() * this.buddies.length)];
    if (!b) return;
    this.cooldown = 5;
    this.idleIn = 35 + Math.random() * 30;
    this.say(b, line);
    b.person.headYaw = 0;
  }

  /** A buddy says something, in his own voice, from where he stands. */
  say(b: Buddy, line: string) {
    const dur = voices.talk({ who: b.name, text: line, voice: b.voiceId, at: mouthOf(b.person), priority: true, group: 'crew', fallback: { pitch: b.pitch, rate: b.rate, voice: b.voice } });
    this.crowd.speak(b.person, dur);
    voiceArbiter.claim(dur);
    return dur;
  }

  update(dt: number) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.idleIn -= dt;
    if (this.idleIn <= 0) this.react('idle');
  }
}
