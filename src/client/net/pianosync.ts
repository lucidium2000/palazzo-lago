import type { Session } from './session';
import type { Piano } from '../piano';
import { decodeNotes, encodeNotes, MAX_BATCH, type NoteEvent } from './pianowire';

/** How often your notes go out (s), and how long a friend's batch waits before it plays (smooths the network). */
const SEND_EVERY = 0.05;
const PLAY_DELAY = 0.06;

/**
 * The piano for everyone in the room: the notes you play go to your friends
 * in small batches (`pn`) and play there from the same piano, keys going down;
 * theirs play here. Knocking the pianist off his bench (`pno`) knocks him off
 * on their screens too; a friend sitting at the keys keeps him off it and his
 * music off for everyone.
 */
export class PianoSync {
  private out: NoteEvent[] = [];
  private sendT = 0;
  /** Notes each friend is holding down (to let go if they leave). */
  private held = new Map<string, Set<number>>();
  private seen = new Set<string>();

  constructor(
    private session: Session,
    private piano: Piano,
  ) {
    piano.onNote = (midi, vel) => this.queue(midi, vel);
    piano.onPedal = (on) => this.queue(0, on ? 127 : 0);
    piano.onKnock = (ux, uz, power) => session.emit('pno', { k: 'off', x: Math.round(ux * 100) / 100, z: Math.round(uz * 100) / 100, p: Math.round(power * 100) / 100 });
    session.on('pn', (f, d) => {
      let held = this.held.get(f.id);
      if (!held) this.held.set(f.id, (held = new Set()));
      for (const e of decodeNotes(d)) {
        const delay = PLAY_DELAY + e.dt;
        if (e.midi === 0) piano.remotePedal(f.id, e.vel > 0, delay);
        else {
          // A note-off for a note we never saw go down is dropped (no stuck counts).
          if (e.vel === 0 && !held.has(e.midi)) continue;
          if (e.vel > 0) held.add(e.midi);
          else held.delete(e.midi);
          piano.remote(f.id, e.midi, e.vel, delay);
        }
      }
    });
    session.on('pno', (_f, d) => {
      if (d.k !== 'off') return;
      const x = Number(d.x),
        z = Number(d.z),
        p = Number(d.p);
      if (![x, z, p].every(Number.isFinite)) return;
      const l = Math.hypot(x, z) || 1;
      piano.knockedByFriend(x / l, z / l, Math.min(1, Math.max(0, p)));
    });
  }

  private queue(midi: number, vel: number) {
    if (!this.session.friendList().length) return;
    if (this.out.length >= MAX_BATCH) this.flush();
    this.out.push({ t: performance.now(), midi, vel });
  }

  private flush() {
    if (!this.out.length) return;
    this.session.emit('pn', encodeNotes(this.out));
    this.out.length = 0;
  }

  update(dt: number) {
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = SEND_EVERY;
      this.flush();
    }
    // Who's sitting at the keys (on the bench, or sat down at the piano on a screen), and who left.
    const seen = this.seen;
    seen.clear();
    for (const f of this.session.friendList()) {
      seen.add(f.id);
      const s = f.state;
      const onBench = s.seat === 'piano' || (Number(s.st) > 0 && this.piano.onBench(Number(s.x), Number(s.z)));
      this.piano.setFriendAt(f.id, onBench);
    }
    for (const [id, notes] of this.held)
      if (!seen.has(id)) {
        this.piano.dropFriend(id, notes);
        this.held.delete(id);
      }
  }

  dispose() {
    this.piano.onNote = null;
    this.piano.onPedal = null;
    this.piano.onKnock = null;
    for (const [id, notes] of this.held) this.piano.dropFriend(id, notes);
    this.held.clear();
  }
}
