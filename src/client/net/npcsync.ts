import * as THREE from 'three';
import type { Bodies } from '../bodies';
import type { Dialogue, SpokenLine } from '../dialogue';
import type { Crowd, Person } from '../people';
import type { Sound } from '../audio';
import type { Session } from './session';
import { decodeNpcLine, encodeNpcLine, resolveNpc, type NpcLine } from './npcCodec';

/** How far away a friend's moment still reaches you (m): reactions carry, conversation is quieter. */
const HEAR_REACT = 22;
const HEAR_TALK = 12;
/** Close enough to see someone stumble. */
const SEE = 40;

export interface NpcSyncDeps {
  session: Session;
  dialogue: Dialogue;
  crowd: Crowd;
  bodies: Bodies;
  sound: Sound;
  /** Where you are (feet). */
  feet(): THREE.Vector3;
}

/**
 * The people in the casino react the same for everyone in the room: when a
 * friend pushes, punches, douses or hits a guest, you hear that guest's same
 * recorded line from that guest (and see them stumble or flinch); the lines a
 * guest says to your friend in a conversation, and your friend's replies, are
 * heard by anyone standing nearby. One small reliable event per line (`npc`).
 */
export class NpcSync {
  /** Lines played here for tests and debugging (newest last). */
  readonly heard: { kind: string; text: string; who: string; matched: boolean; at: number[] }[] = [];

  constructor(private d: NpcSyncDeps) {
    d.dialogue.onSpeak = (l) => this.send(l);
    d.session.on('npc', (f, data) => {
      const l = decodeNpcLine(data);
      if (l) this.receive(l, f.person, f.name);
    });
  }

  private send(l: SpokenLine) {
    if (!this.d.session.friendList().length) return;
    const at = l.p ? l.p.pos : this.d.feet();
    this.d.session.emit(
      'npc',
      encodeNpcLine({ kind: l.kind, uid: l.p?.uid ?? -1, role: l.p?.role ?? 'buddy', pos: [at.x, at.y, at.z], text: l.text, voice: l.voice, alt: l.alt, who: l.who, volume: l.volume }),
    );
  }

  private receive(l: NpcLine, friend: Person | null, friendName: string) {
    const at = new THREE.Vector3(...l.pos);
    const far = at.distanceTo(this.d.feet());
    if (l.kind === 'reply') {
      // Your friend's own answer, from their avatar.
      if (far > HEAR_TALK) return;
      this.d.dialogue.hear({ ...l, who: friendName }, null, friend?.pos ?? at, friend);
      this.log(l, !!friend);
      return;
    }
    const p = resolveNpc(this.d.crowd.people, l);
    const react = l.kind !== 'line';
    if (far > SEE) return;
    if (p && react) this.flinch(p, l, friend);
    if (far > (react ? HEAR_REACT : HEAR_TALK)) return;
    if (l.kind === 'punched') this.d.sound.play('punch', (p?.pos ?? at).clone().setY((p?.pos.y ?? at.y) + 1.3), { volume: 0.9, rate: 0.85 + Math.random() * 0.15 });
    this.d.dialogue.hear(l, p, at);
    this.log(l, !!p);
  }

  /** They stumble back from your friend (push, punch) or flinch (soaked, hit), and look at them. */
  private flinch(p: Person, l: NpcLine, friend: Person | null) {
    const from = friend?.pos ?? p.pos.clone().add(new THREE.Vector3(0, 0, 1));
    let ux = p.pos.x - from.x,
      uz = p.pos.z - from.z;
    const n = Math.hypot(ux, uz) || 1;
    ux /= n;
    uz /= n;
    if (l.kind === 'punched' || l.kind === 'pushed' || (l.kind === 'gasp' && l.volume >= 1)) {
      const hard = l.kind !== 'pushed';
      this.d.bodies.shove(p, ux, uz, hard ? 0.55 : 0.28, hard ? 0.7 : 0.4, from, true);
      if (hard) p.gaspT = Math.max(p.gaspT, 1);
    } else {
      p.gaspT = Math.max(p.gaspT, 0.9);
    }
  }

  private log(l: NpcLine, matched: boolean) {
    this.heard.push({ kind: l.kind, text: l.text, who: l.who, matched, at: l.pos });
    if (this.heard.length > 30) this.heard.shift();
  }

  dispose() {
    this.d.dialogue.onSpeak = null;
  }
}
