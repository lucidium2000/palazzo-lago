import * as THREE from 'three';
import type { Bowling } from '../bowling/game';
import type { Session } from './session';

/**
 * Bowling with friends at Palazzo Lanes. Joining or leaving a lane, a new
 * game, taking a ball off the rack and putting one back go to everyone as
 * reliable events ('bowl'). The bowler's machine runs the physics: it sends
 * the launch when the ball leaves the hand, streams the ball and the moving
 * pins about 20 times a second ('bowls'; friends play it back a beat behind,
 * interpolated), and when the pins settle sends the count and where the
 * standing pins stand, which is final on every machine. The host gives a
 * friend who walks in late every lane's scoresheet, and drops a friend who
 * leaves from their lane.
 */
export class BowlSync {
  private seen = new Set<string>();
  private timer: ReturnType<typeof setInterval>;
  private selfWas: string;

  constructor(
    private session: Session,
    private bowling: Bowling,
  ) {
    this.selfWas = bowling.selfId;
    const tmp = new THREE.Vector3();
    bowling.net = {
      self: session.selfId,
      host: session.host,
      send: (d) => session.emit('bowl', d),
      stream: (d) => session.emit('bowls', d),
      hand: (id) => {
        const f = session.friendList().find((x) => x.id === id);
        if (!f) return null;
        const w = f.wrist('r');
        if (w) return w.p;
        const bone = f.person?.rig?.bones.WristR;
        return bone ? bone.getWorldPosition(tmp) : null;
      },
    };
    // Your place on a lane keeps its owner when you join a room (you were 'me' playing alone).
    bowling.renameSelf(this.selfWas, session.selfId);
    session.on('bowl', (f, d) => {
      if (d.k === 'sync') {
        if (!session.host && f.state.host) bowling.applySnapshot(d.s as Record<string, unknown>);
        return;
      }
      bowling.receive(f.id, d);
    });
    session.on('bowls', (_f, d) => bowling.receiveStream(d));
    this.timer = setInterval(() => this.tick(), 600);
  }

  private tick() {
    const ids = this.session.friendList().map((f) => f.id);
    if (this.session.host) {
      // Whoever just arrived gets every lane's scoresheet.
      if (ids.some((id) => !this.seen.has(id))) this.session.emit('bowl', { k: 'sync', s: this.bowling.snapshot() });
    }
    // Whoever left gives up their place on the lanes (everyone does this, so nobody waits on them).
    for (const id of this.seen) if (!ids.includes(id)) this.bowling.dropFriend(id);
    this.seen = new Set(ids);
  }

  dispose() {
    clearInterval(this.timer);
    this.bowling.renameSelf(this.session.selfId, 'me');
    this.bowling.net = null;
  }
}
