import type { PokerPlay, PokerRequest } from '../pokerplay';
import { makeKeys, seal, sharedSecret, unseal, type KeyPair } from './pokerkeys';
import type { Session } from './session';

/**
 * Poker with the crew: the host's table runs the hand (deck, order, NPC
 * decisions, pots); each change goes out as a snapshot of the table (seats,
 * stacks and the hand's steps so far, with every hole card hidden), and the
 * guests' tables play the same steps. A guest's own two cards come in a
 * separate message sealed with a secret only that guest and the host share
 * (net/pokerkeys.ts): everyone receives every message, but nobody else can
 * read them. Cards are only shown to the table at a showdown. Guests' seats,
 * buy-ins and decisions go to the host as requests. Snapshots carry the whole
 * hand so far, so a lost one is made good by the next; a heartbeat repeats
 * them (and the sealed cards) while anyone's seated.
 */
export class PokerSync {
  private dirty = true;
  private sentAt = -Infinity;
  private time = 0;
  private busy = false;
  private keys: KeyPair = makeKeys();
  /** Shared secrets: host by guest token; a guest keeps one for the host. */
  private secrets = new Map<string, string>();
  private hostPub = '';
  private keyAt = -Infinity;
  private sealedFor = '';

  constructor(
    private session: Session,
    private table: PokerPlay,
  ) {
    const host = session.host;
    table.net = {
      role: host ? 'host' : 'guest',
      request: (d) => session.emit('pk?', d),
      changed: () => (this.dirty = true),
      dealt: () => {
        this.dirty = true;
        this.sendHoles();
      },
    };
    session.on('pk?', (friend, d) => {
      if (!host || typeof d.me !== 'string') return;
      table.handle(d.me, String(d.name ?? friend.name), friend.id, d as unknown as PokerRequest);
    });
    session.on('pk', (friend, d) => {
      if (host || !friend.state.host) return;
      if (typeof d.hk === 'string' && d.hk !== this.hostPub) {
        this.hostPub = d.hk;
        this.secrets.clear();
      }
      // Until the host has our key, keep offering it.
      const ks = Array.isArray(d.ks) ? (d.ks as unknown[]).map(String) : [];
      if (!ks.includes(table.me) && this.time - this.keyAt > 2) this.offerKey();
      table.applySnapshot(d);
    });
    session.on('pkh', (friend, d) => {
      if (host || !friend.state.host || d.to !== table.me || !Array.isArray(d.c)) return;
      const s = this.hostSecret();
      if (!s) return;
      const id = Number(d.id);
      table.setHole(id, unseal(s, `${id}|${Number(d.s)}|${table.me}`, (d.c as unknown[]).map(Number)));
    });
    if (!host) this.offerKey();
  }

  private offerKey() {
    this.keyAt = this.time;
    this.session.emit('pk?', { a: 'key', me: this.table.me, name: '', pub: this.keys.pub });
  }

  private hostSecret(): string | null {
    if (!this.hostPub) return null;
    let s = this.secrets.get('host');
    if (!s) {
      s = sharedSecret(this.keys.priv, this.hostPub) ?? undefined;
      if (s) this.secrets.set('host', s);
    }
    return s ?? null;
  }

  /** Host: each person's two cards, sealed for them alone (the host's own aren't sent). */
  private sendHoles() {
    const t = this.table;
    for (const h of t.holeCards()) {
      if (h.token === t.me) continue;
      const pub = t.keys.get(h.token);
      if (!pub) continue;
      let s = this.secrets.get(h.token);
      if (!s) {
        s = sharedSecret(this.keys.priv, pub) ?? undefined;
        if (!s) continue;
        this.secrets.set(h.token, s);
      }
      this.session.emit('pkh', { id: t.handId, s: h.seat, to: h.token, c: seal(s, `${t.handId}|${h.seat}|${h.token}`, h.ids) });
    }
    this.sealedFor = `${t.handId}:${[...t.keys.keys()].join(',')}`;
  }

  update(dt: number) {
    this.time += dt;
    if (!this.session.host) return;
    const t = this.table;
    const present = new Set(this.session.friendList().map((f) => f.id));
    for (const o of [...t.owners.values()]) if (o.friend && !present.has(o.friend)) t.friendGone(o.friend);
    const used = t.owners.size > 0;
    // A guest's key arrived after the deal: seal their cards now.
    if (t.hand && `${t.handId}:${[...t.keys.keys()].join(',')}` !== this.sealedFor) this.sendHoles();
    const due = (this.dirty && (used || this.busy)) || (used && this.time - this.sentAt > 3);
    if (!due || this.time - this.sentAt < 0.25 || present.size === 0) return;
    if (used && this.time - this.sentAt > 3 && t.hand) this.sendHoles();
    this.dirty = false;
    this.sentAt = this.time;
    this.session.emit('pk', { ...t.snapshot(), hk: this.keys.pub });
    this.busy = used;
  }

  dispose() {
    this.table.resetNet();
  }
}
