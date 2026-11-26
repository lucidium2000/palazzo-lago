import type { Elevators } from '../areas/elevators';
import { isLanding, readSlot } from '../areas/liftlogic';
import type { Session } from './session';

/**
 * Shared elevators: car calls and the open button go to everyone (reliable
 * events); a floor press goes to the host, who decides (first press wins)
 * and announces the ride, which every machine then runs the same way.
 * Everyone standing in the cab when its doors shut rides it; nobody else
 * moves. A friend who walks in late gets the host's snapshot of every car.
 */
export class LiftSync {
  private seen = new Set<string>();
  private timer: ReturnType<typeof setInterval>;

  constructor(
    private session: Session,
    private lifts: Elevators,
  ) {
    const n = lifts.cars.length;
    lifts.net = {
      host: session.host,
      send: (k, d) => session.emit('lift', { k, ...d }),
      request: (d) => session.emit('lift?', d),
    };
    lifts.others = () => session.friendList().map((f) => (f.person ? f.person.pos : { x: Number(f.state.x) || 0, z: Number(f.state.z) || 0 }));
    session.on('lift?', (_f, d) => {
      if (!session.host) return;
      const c = readSlot(d.c, n);
      if (c === null || !isLanding(d.d)) return;
      lifts.hostRide(c, d.d);
    });
    session.on('lift', (f, d) => {
      const c = readSlot(d.c, n);
      switch (d.k) {
        case 'call':
          if (c !== null) lifts.call(lifts.cars[c], true);
          break;
        case 'open':
          if (c !== null) lifts.open(lifts.cars[c], true);
          break;
        case 'ride':
          // Only the host starts rides.
          if (c !== null && f.state.host && Number.isInteger(d.id) && isLanding(d.d)) lifts.startRide(d.id as number, c, d.d);
          break;
        case 'sync':
          if (!session.host && f.state.host) lifts.applySnapshot(d.s);
          break;
      }
    });
    // Host: whoever just arrived gets the current state of every car.
    this.timer = setInterval(() => this.welcome(), 500);
  }

  private welcome() {
    if (!this.session.host) return;
    const ids = this.session.friendList().map((f) => f.id);
    if (ids.some((id) => !this.seen.has(id))) this.session.emit('lift', { k: 'sync', s: this.lifts.snapshot() });
    this.seen = new Set(ids);
  }

  dispose() {
    clearInterval(this.timer);
    this.lifts.net = null;
    this.lifts.others = () => [];
  }
}
