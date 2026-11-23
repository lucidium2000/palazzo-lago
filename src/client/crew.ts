import * as THREE from 'three';
import { lineTime, voiceArbiter } from './dialogue';
import type { Sound } from './audio';
import type { Hud } from './hud';
import type { Crowd, Look, Person } from './people';
import type { Player } from './player';
import type { World } from './world';

/**
 * Your crew for the night: three buddies who stick with you, crowd around
 * whatever you're playing, hype your wins, razz your losses and suggest where
 * to go next. They talk with the browser's speech voices, with subtitles.
 */

export type CrewMoment =
  | 'arrive'
  | 'idle'
  | 'spin'
  | 'win'
  | 'bigwin'
  | 'loss'
  | 'bigloss'
  | 'streak'
  | 'bonus'
  | 'order'
  | 'round'
  | 'tip'
  | 'terrace'
  | 'finale'
  | 'goal'
  | 'legend';

const LINES: Record<CrewMoment, string[]> = {
  arrive: ["Alright boys. Vegas, baby!", "I've got a good feeling about tonight.", "First stop: the tables. Let's make some money."],
  idle: [
    "This place is unreal.",
    "We should hit the bar at some point.",
    "Have you seen the fountains? We gotta go out on the terrace.",
    "Roulette's calling your name, I'm telling you.",
    "Red is due. I can feel it.",
    "That piano guy is smooth.",
    "Somebody's gonna hit big tonight. Might as well be us.",
    "Look at this ceiling. Who even builds this?",
  ],
  spin: ["Come on, come on!", "Big money, big money!", "Here we go!", "Let it ride!"],
  win: ["There it is!", "Nice!", "Ka-ching!", "That's what I'm talking about!", "Easy money."],
  bigwin: ["Let's gooo!", "No way! No way!", "Drinks are on you tonight!", "You're a legend!", "Somebody call my mom!"],
  loss: ["Shake it off.", "Run it back.", "That's alright, next one.", "Ouch.", "The house got lucky."],
  bigloss: ["Oof. Brutal.", "That one hurt to watch.", "Okay, deep breath. We go again."],
  streak: ["He's heating up!", "Don't touch him, he's on fire!", "Three in a row! Who is this guy?"],
  bonus: ["Bonus round!", "Here we go, here we go!", "Oh it's happening!"],
  order: ["Make it a double!", "Ooh, fancy.", "Cheers to that."],
  round: ["Now that's a friend!", "Salute!", "To the best night ever!", "Cheers, brother!"],
  tip: ["Classy move.", "Big tipper over here.", "He's gonna play our song now."],
  terrace: ["Now that's a view.", "Wait for the finale. Trust me.", "This is the best spot in Vegas."],
  finale: ["Whoa!", "That's insane!", "Okay, that was worth the trip."],
  goal: ["Checking boxes tonight!", "Look at us go."],
  legend: ["Legendary night, boys. Legendary.", "Nobody's gonna believe this back home."],
};

interface Buddy {
  person: Person;
  name: string;
  pitch: number;
  rate: number;
  voice: number;
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
    crowd: Crowd,
    private world: World,
    private player: Player,
    private hud: Hud,
    private sound: Sound,
    lookFor: () => Look,
  ) {
    const names = ['Rocco', 'Dev', 'Mikey'];
    const slots: [number, number][] = [
      [1.25, 0.9],
      [-1.25, 0.9],
      [0.35, 1.9],
    ];
    const voices = [
      { pitch: 0.85, rate: 1.05, voice: 1 },
      { pitch: 1.1, rate: 1.12, voice: 2 },
      { pitch: 0.95, rate: 0.98, voice: 3 },
    ];
    const start = player.feet();
    names.forEach((name, i) => {
      const look = { ...lookFor(), ...LOOKS[i], dress: false, height: 1.76 + i * 0.04 };
      const p = crowd.add('buddy', look, start.clone().add(new THREE.Vector3(slots[i][0], 0, slots[i][1])), player.rig.rotation.y);
      if (!p) return;
      const b: Buddy = { person: p, name, slot: slots[i], ...voices[i] };
      p.speed = 1;
      p.onUpdate = (pp, dt) => this.follow(b, pp, dt);
      this.buddies.push(b);
    });
  }

  /** Puts the crew around you immediately (after a map jump or entering VR). */
  regroup() {
    for (const b of this.buddies) {
      const t = this.slotTarget(b);
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
    if (d > 12) {
      // You jumped across the room: they catch up off-screen.
      p.pos.copy(target);
      return;
    }
    const want = d < 0.35 ? 0 : Math.min(2.6, 0.9 + d * 0.6);
    p.moving += (want - p.moving) * Math.min(1, dt * 5);
    if (p.moving > 0.02 && d > 0.05) {
      const step = Math.min(d, p.moving * dt);
      const [nx, nz] = this.world.move(p.pos.x, p.pos.z, (dx / d) * step, (dz / d) * step, 0.24);
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
    if (!opts.force && voiceArbiter.busy()) return;
    const lines = LINES[moment];
    let line = lines[Math.floor(Math.random() * lines.length)];
    if (line === this.lastLine) line = lines[(lines.indexOf(line) + 1) % lines.length];
    this.lastLine = line;
    const b = this.buddies[Math.floor(Math.random() * this.buddies.length)];
    if (!b) return;
    this.cooldown = 5;
    this.idleIn = 35 + Math.random() * 30;
    this.hud.say(b.name, line);
    this.sound.say(line, { pitch: b.pitch, rate: b.rate, voice: b.voice, interrupt: opts.force });
    voiceArbiter.claim(lineTime(line));
    b.person.headYaw = 0;
  }

  update(dt: number) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.idleIn -= dt;
    if (this.idleIn <= 0) this.react('idle');
  }
}
