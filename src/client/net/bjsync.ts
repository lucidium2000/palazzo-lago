import type { BlackjackPlay, TableRequest } from '../blackjackplay';
import type { Session } from './session';

/**
 * Blackjack with your friend: the host's tables run the rounds (the shoe, the
 * order, the results); each change goes out as a snapshot of the table (seats,
 * bets and the round's steps so far, with the dealer's hole card hidden), and
 * the guest's tables play the same steps. The guest's bets and decisions go to
 * the host as requests. Snapshots carry the whole round so far, so a lost
 * message is made good by the next one; a heartbeat repeats them while anyone
 * is seated.
 */
export class BlackjackSync {
  private dirty = new Set<number>();
  private sentAt = new Map<number, number>();
  private time = 0;
  /** Tables that had players at the last snapshot (one more goes out when they leave). */
  private busy = new Set<number>();

  constructor(
    private session: Session,
    private tables: BlackjackPlay[],
  ) {
    const host = session.host;
    for (const t of tables) {
      t.net = {
        role: host ? 'host' : 'guest',
        request: (d) => session.emit('bj?', { t: t.index, ...d }),
        changed: () => this.dirty.add(t.index),
      };
      if (host) this.dirty.add(t.index);
    }
    session.on('bj?', (friend, d) => {
      if (!host) return;
      const t = this.tables.find((x) => x.index === Number(d.t));
      if (!t || typeof d.me !== 'string') return;
      t.handle(d.me, String(d.name ?? friend.name), friend.id, d as unknown as TableRequest);
    });
    session.on('bj', (friend, d) => {
      if (host || !friend.state.host) return;
      const t = this.tables.find((x) => x.index === Number(d.t));
      t?.applySnapshot(d);
    });
  }

  update(dt: number) {
    this.time += dt;
    if (!this.session.host) return;
    const present = new Set(this.session.friendList().map((f) => f.id));
    for (const t of this.tables) {
      for (const o of t.owners.values()) if (o.friend && !present.has(o.friend)) t.friendGone(o.friend);
      const used = t.owners.size > 0;
      const last = this.sentAt.get(t.index) ?? -Infinity;
      // Changes go out at most ~4 times a second; a heartbeat every 3 s while anyone's seated.
      const due = (this.dirty.has(t.index) && (used || this.busy.has(t.index))) || (used && this.time - last > 3);
      if (!due || this.time - last < 0.25 || present.size === 0) continue;
      this.dirty.delete(t.index);
      this.sentAt.set(t.index, this.time);
      this.session.emit('bj', t.snapshot());
      if (used) this.busy.add(t.index);
      else this.busy.delete(t.index);
    }
  }

  dispose() {
    for (const t of this.tables) t.resetNet();
  }
}
