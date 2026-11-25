import * as THREE from 'three';
import { voiceArbiter } from './dialogue';
import type { Sound } from './audio';
import type { Hud } from './hud';
import type { Crowd, Look, Person } from './people';
import type { Player } from './player';
import type { World } from './world';
import { CREW_LINES, CREW_VOICES, type CrewMoment, type VoiceId } from './speech';
import { mouthOf, voices } from './voices';
import { elVoice } from './cast';

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
      // The boys are men (their voices are): never a gown from the random look.
      const look = { ...lookFor(), ...LOOKS[i], kind: (['male_suit', 'male_casual_2', 'male_suit'] as const)[i % 3], dress: false, height: 1.76 + i * 0.04 };
      const p = crowd.add('buddy', look, start.clone().add(new THREE.Vector3(slots[i][0], 0, slots[i][1])), player.rig.rotation.y);
      if (!p) return;
      const b: Buddy = { person: p, name, slot: slots[i], voiceId: CREW_VOICES[i % CREW_VOICES.length], ...tones[i] };
      p.speed = 1;
      p.onUpdate = (pp, dt) => this.hangOut(b, pp, dt);
      this.buddies.push(b);
    });
  }

  private placed = false;

  /** They hang out together where you came in (a little circle in front of you), not on your heels. */
  private settle() {
    this.placed = true;
    const f = this.player.feet();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.player.camera.getWorldQuaternion(new THREE.Quaternion()));
    dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
    dir.normalize();
    const c = f.clone().addScaledVector(dir, 2.4);
    const free = this.world.settle(c.x, c.z, 0.6, true);
    if (free) c.set(free[0], 0, free[1]);
    this.spot.copy(c);
    this.buddies.forEach((b, i) => {
      const a = (i / Math.max(1, this.buddies.length)) * Math.PI * 2;
      const at = new THREE.Vector3(c.x + Math.sin(a) * 0.75, 0, c.z + Math.cos(a) * 0.75);
      const f = this.world.settle(at.x, at.z, 0.3, true);
      if (f) at.set(f[0], 0, f[1]);
      b.person.pos.copy(at);
      b.person.yaw = Math.atan2(c.x - at.x, c.z - at.z);
    });
  }

  /** Where the crew hangs out. */
  readonly spot = new THREE.Vector3();

  /** The buddy nearest you, if he's close enough to hear and be heard. */
  private nearest(range = 9): Buddy | null {
    const f = this.player.feet();
    let best: Buddy | null = null,
      bd = range;
    for (const b of this.buddies) {
      const d = Math.hypot(b.person.pos.x - f.x, b.person.pos.z - f.z);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  /** Standing with the others; turns to you when you come over. */
  private hangOut(_b: Buddy, p: Person, dt: number) {
    p.moving += (0 - p.moving) * Math.min(1, dt * 5);
    const f = this.player.feet();
    const dYou = Math.hypot(f.x - p.pos.x, f.z - p.pos.z);
    const ty = dYou < 4.5 ? Math.atan2(f.x - p.pos.x, f.z - p.pos.z) : Math.atan2(this.spot.x - p.pos.x, this.spot.z - p.pos.z);
    let dy = ty - p.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    p.yaw += dy * Math.min(1, dt * 2.5);
  }

  /** (The crew used to follow you everywhere; now they stay where they hang out.) */
  regroup() {}

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
    // Only the boys within earshot say anything.
    const b = this.nearest();
    if (!b) return;
    this.cooldown = 5;
    this.idleIn = 35 + Math.random() * 30;
    this.say(b, line);
    b.person.headYaw = 0;
  }

  /** The nearest buddy (if you're with them) says a line. */
  sayNear(line: string) {
    const b = this.nearest();
    if (b) this.say(b, line);
  }

  /** A buddy says something, in his own voice, from where he stands. */
  say(b: Buddy, line: string) {
    const dur = voices.talk({ who: b.name, text: line, voice: elVoice('crew_' + b.name.toLowerCase()), alt: b.voiceId, at: mouthOf(b.person), priority: true, group: 'crew', fallback: { pitch: b.pitch, rate: b.rate, voice: b.voice } });
    this.crowd.speak(b.person, dur);
    voiceArbiter.claim(dur);
    return dur;
  }

  update(dt: number) {
    if (!this.placed) this.settle();
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.idleIn -= dt;
    if (this.idleIn <= 0) this.react('idle');
  }
}
