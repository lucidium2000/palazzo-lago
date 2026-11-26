import * as THREE from 'three';
import type { Friend, Session } from './session';
import { BOARD_SLOTS, type PhotoCams } from '../photocam';
import { backfillFor, chunkEvents, parseChunk, Reassembler, SendQueue, type PhotoChunk } from './photowire';

/** Photo chunks in flight at once (each waits for every friend's ack before the next goes). */
const WINDOW = 2;

/**
 * Cameras and photos with the crew (up to four players):
 *
 *  - The camera in a friend's hand shows in their avatar's hand (its pose
 *    relative to their wrist rides in their state as `pc`), it leaves its spot
 *    on the bar on your side, and when they set it down it's there for you too
 *    (`pcput`). Their flash and shutter come from main.ts's `flash` event.
 *  - Every photo anyone takes goes on everyone's board: the photographer pins
 *    it locally and sends the small JPEG in chunks (`ph`, see photowire.ts),
 *    paced by acks so it never crowds out the rest of the packet; friends pin
 *    it when the last chunk lands, and ask (`ph?`) for any that went missing.
 *  - A friend who walks in gets what's on the board: each player sends the
 *    photos they took; the host also sends those whose photographer has gone.
 */
export class PhotoSync {
  private re = new Reassembler();
  private q = new SendQueue();
  private chunks = new Map<string, PhotoChunk[]>();
  private known = new Set<string>();
  /** Friends who just arrived, waiting until they hear us to be sent the board. */
  private newcomers = new Set<string>();
  /** Cameras I set down last (where, so newcomers see them there too). */
  private myPuts = new Map<number, { p: number[]; q: number[] }>();
  /** Which friend holds which camera, as shown. */
  private remoteHeld = new Map<number, string>();
  private time = 0;
  private stallT = 0;
  private prevExtra: Session['extraState'];

  constructor(
    private session: Session,
    private cams: PhotoCams,
  ) {
    const me = session.selfId;
    // Photos you took before the room opened are yours to share.
    for (const p of cams.boardPhotos()) {
      if (!p.meta.a) p.meta.a = me;
      this.re.markDone(p.meta.id);
    }
    cams.onShot = (meta, b64) => {
      meta.a = me;
      this.re.markDone(meta.id);
      if (session.friendList().length) this.queue(meta.id);
    };
    cams.onPut = (i, p, q) => {
      const put = { p: p.toArray().map((v) => Math.round(v * 1000) / 1000), q: q.toArray().map((v) => Math.round(v * 1000) / 1000) };
      this.myPuts.set(i, put);
      session.emit('pcput', { i, ...put });
    };
    session.on('ph', (f, d) => this.chunk(f, d));
    session.on('ph?', (_f, d) => {
      if (d.to !== me || typeof d.id !== 'string') return;
      const all = this.chunksOf(d.id);
      if (!all) return;
      const m = Array.isArray(d.m) ? d.m.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < all.length) : [];
      this.q.add(d.id, m.length ? m : all.map((_, i) => i));
    });
    session.on('pcput', (_f, d) => {
      const i = Math.floor(Number(d.i));
      const p = d.p as number[],
        q = d.q as number[];
      if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite) || !Array.isArray(q) || q.length !== 4 || !q.every(Number.isFinite)) return;
      this.myPuts.delete(i);
      this.remoteHeld.delete(i);
      cams.place(i, new THREE.Vector3().fromArray(p), new THREE.Quaternion().fromArray(q).normalize());
    });
    this.prevExtra = session.extraState;
    session.extraState = () => ({ ...(this.prevExtra?.() ?? {}), pc: cams.heldState() });
  }

  private chunksOf(id: string): PhotoChunk[] | null {
    let c = this.chunks.get(id);
    if (c) return c;
    const p = this.cams.photo(id);
    if (!p) return null;
    c = chunkEvents(p.meta, p.b64);
    this.chunks.set(id, c);
    return c;
  }

  private queue(id: string) {
    const all = this.chunksOf(id);
    if (all) this.q.add(id, all.map((_, i) => i));
  }

  private chunk(f: Friend, d: unknown) {
    const c = parseChunk(d);
    if (!c || this.cams.has(c.id)) return;
    const done = this.re.add(c, f.id, this.time);
    if (!done) return;
    // Flies in from where they are, when they're in sight of the board.
    let from: THREE.Vector3 | null = null;
    if (f.person && !f.person.culled) {
      const p = f.person.pos.clone().setY(f.person.pos.y + 1.4);
      if (p.distanceTo(this.cams.board.position) < 25) from = p;
    }
    this.cams.addShared(done.meta, done.b64, from);
  }

  update(dt: number) {
    this.time += dt;
    const s = this.session;
    const friends = s.friendList();
    const ids = new Set(friends.map((f) => f.id));
    // Who walked in (send them the board once they can hear us) and who left.
    for (const f of friends)
      if (!this.known.has(f.id)) {
        this.known.add(f.id);
        this.newcomers.add(f.id);
      }
    for (const id of [...this.known]) if (!ids.has(id)) this.known.delete(id);
    for (const id of [...this.newcomers]) {
      if (!ids.has(id)) {
        this.newcomers.delete(id);
        continue;
      }
      if (!s.hears(id)) continue;
      this.newcomers.delete(id);
      const present = new Set([s.selfId, ...ids]);
      present.delete(id);
      const send = backfillFor(
        this.cams.boardPhotos().map((p) => p.meta),
        { me: s.selfId, host: s.host, present, newcomer: id, limit: BOARD_SLOTS },
      );
      // Oldest first, so the board fills up the way it did here.
      for (const pid of send.reverse()) this.queue(pid);
      for (const [i, put] of this.myPuts) s.emit('pcput', { i, ...put });
    }
    // Send photo chunks a couple at a time as friends confirm them.
    if (!friends.length) this.q.clear();
    while (this.q.length && s.unconfirmed('ph') < WINDOW) {
      const n = this.q.next()!;
      const c = this.chunksOf(n.id)?.[n.i];
      if (c) s.emit('ph', c);
    }
    for (const id of this.chunks.keys()) if (!this.cams.photo(id)) this.chunks.delete(id);
    // Transfers that stalled: ask for the missing chunks again.
    this.stallT -= dt;
    if (this.stallT <= 0) {
      this.stallT = 1;
      for (const r of this.re.stalled(this.time, (id) => ids.has(id))) s.emit('ph?', r);
    }
    this.showCameras(friends);
  }

  /** Each friend's camera in their hand. */
  private showCameras(friends: Friend[]) {
    const holding = new Map<number, string>();
    for (const f of friends) {
      const pc = f.state.pc;
      if (!Array.isArray(pc) || pc.length !== 10 || !pc.every(Number.isFinite)) continue;
      const i = Math.floor(pc[0]);
      if (holding.has(i)) continue;
      holding.set(i, f.id);
      this.cams.holdRemote(i, f.id, this.poseOf(f, pc));
    }
    for (const [i, id] of this.remoteHeld)
      if (!holding.has(i)) this.cams.dropRemote(i, !this.session.friendList().some((f) => f.id === id));
    this.remoteHeld = holding;
  }

  /** Where a friend's camera is (world), or null when they're out of sight. */
  private poseOf(f: Friend, pc: number[]): THREE.Matrix4 | null {
    const p = f.person;
    if (!p || p.culled) return null;
    const pos = new THREE.Vector3(pc[2], pc[3], pc[4]);
    const q = new THREE.Quaternion(pc[5], pc[6], pc[7], pc[8]).normalize();
    const local = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
    if (pc[9] === 0) return local;
    const side = pc[1] === 0 ? 'l' : 'r';
    const tracked = f.state[side === 'l' ? 'lw' : 'rw'];
    const w = f.wrist(side);
    // VR friend: in their real hand, exactly as they hold it.
    if (Array.isArray(tracked) && w) return new THREE.Matrix4().compose(w.p, w.q, new THREE.Vector3(1, 1, 1)).multiply(local);
    // Their wrist isn't known: at the avatar's wrist, facing where they face.
    const bone = p.rig?.bones[side === 'l' ? 'WristL' : 'WristR'];
    if (!bone) return null;
    const at = bone.getWorldPosition(new THREE.Vector3());
    return new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, p.yaw + Math.PI, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
  }

  /** For tests and debugging. */
  debug() {
    return { queued: this.q.length, inProgress: this.re.inProgress, remoteHeld: [...this.remoteHeld], newcomers: [...this.newcomers] };
  }

  dispose() {
    for (const [i] of this.remoteHeld) this.cams.dropRemote(i);
    this.remoteHeld.clear();
    this.cams.onShot = null;
    this.cams.onPut = null;
    this.session.extraState = this.prevExtra;
  }
}
