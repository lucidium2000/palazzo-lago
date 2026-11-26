import {
  arrivalPath,
  BAYS,
  backSeat,
  CURB_LANE,
  curbSpot,
  departurePath,
  easeArrive,
  easeDepart,
  easeShift,
  linePath,
  PERIOD,
  poseAt,
  QUEUE,
  RIDE,
  rideCar,
  shiftPath,
  SLIDE_DOORS,
  TAXI,
  TAXI_EPOCH,
  TAXI_SLOTS,
  taxiKind,
  VALET_SPOT,
  WALK_LANE,
  WEST,
  type CarKind,
  type Path,
  type Pose,
} from './entranceplan';

/**
 * The driveway's comings and goings (pure, no three.js): the taxi line moving
 * up, the rideshare cars pulling into their bays, the guests walking out with
 * their bags and getting in, the cars driving off.
 *
 * It runs off one wall clock (the same for every player, like the pool
 * party's set), through a fixed schedule of events, so everyone in the room
 * sees the same cars at the same time. A car someone is in (or has the door
 * of open) stays put: it doesn't leave until it's free on its next turn. The
 * players' positions are shared, so every machine holds the same cars.
 *
 * Starting up, it plays the last few minutes through from a quiet driveway in
 * an instant, so a player who arrives late finds the same state as everyone.
 */

export interface SimCar {
  /** The same on every machine: t<epoch> (a taxi), r<bay>:<cycle> (a ride), v (the valet's car). */
  key: string;
  kind: CarKind;
  /** Body colour (rideshare and valet cars; taxis are painted by kind), sRGB hex. */
  paint: number;
  /** Windshield sign colour (rideshare), 0 for none. */
  sign: number;
  home: 'taxi' | 'bay' | 'valet';
  /** Bay index, or the taxi line slot. */
  spot: number;
  motion: { path: Path; t0: number; dur: number; ease: 'arrive' | 'depart' | 'shift' } | null;
  /** Where it stands when not moving. */
  rest: Pose;
  gone: boolean;
  /** Taxi roof light (for hire). */
  roof: boolean;
  hazards: boolean;
  /** Left indicator (pulling out). */
  blink: boolean;
  /** The door wanted open by the guest/valet (0/1). */
  door: number;
  /** The door wanted open by a player (0/1). */
  playerDoor: number;
  rider: SimGuest | null;
}

export interface SimGuest {
  id: number;
  line: 'taxi' | 'ride';
  /** The bay this guest's ride comes to (ride guests). */
  bay: number;
  state: 'inside' | 'walk' | 'wait' | 'seated' | 'riding';
  walk: { path: Path; t0: number; speed: number; face: number } | null;
  rest: Pose;
  car: SimCar | null;
  /** Pulling a suitcase. */
  luggage: boolean;
}

/** Where guests wait out of sight (in the lobby, behind the doors). */
const INSIDE: Pose = { x: 298, z: -6, yaw: 0 };

export class Traffic {
  readonly cars: SimCar[] = [];
  readonly guests: SimGuest[] = [];
  /** Taxis in the line (front first). */
  taxis: SimCar[] = [];
  /** The car at each rideshare bay (null when free). */
  bays: (SimCar | null)[] = BAYS.map(() => null);
  /** Taxi guests in the queue (front first). */
  queue: SimGuest[] = [];
  readonly valet: SimCar;
  /** Things that happened (for sound: a door, a car pulling up, the whistle), drained by the caller. */
  readonly events: { kind: 'door' | 'arrive' | 'depart' | 'whistle' | 'shift'; car: SimCar; t: number }[] = [];
  private cursor: number;
  private held: (c: SimCar) => boolean = () => false;
  private defs: { period: number; off: number; fn: (t: number) => void }[] = [];
  /** Recording events (not while playing the past through at start). */
  private live = false;

  /** `now`: the wall clock (s). `taxiGuests` / `rideGuests`: how many people to use. */
  constructor(now: number, taxiGuests = 4) {
    this.valet = this.makeCar('v', 'lux', 0x0c0d10, 0, 'valet', 0);
    this.valet.rest = { x: VALET_SPOT, z: CURB_LANE, yaw: WEST };
    // Start a few minutes back, at the top of a period, with the line full and nobody out.
    const start = Math.floor(now / PERIOD) * PERIOD - 3 * PERIOD;
    const k0 = Math.round(start / TAXI_EPOCH);
    for (let j = 0; j < TAXI_SLOTS.length; j++) {
      const n = k0 - TAXI_SLOTS.length + j;
      const c = this.makeCar(`t${n}`, taxiKind(n), 0, 0, 'taxi', j);
      c.rest = { x: TAXI_SLOTS[j], z: CURB_LANE, yaw: WEST };
      c.roof = true;
      this.taxis.push(c);
    }
    for (let i = 0; i < taxiGuests; i++) {
      const g = this.makeGuest(i, 'taxi', 0);
      g.luggage = i % 2 === 0;
      this.guests.push(g);
    }
    // The queue's order turns with the epochs (so it's the same whenever you start).
    const rot = ((k0 % taxiGuests) + taxiGuests) % taxiGuests;
    this.queue = this.guests.slice(rot).concat(this.guests.slice(0, rot));
    this.queue.forEach((g, i) => {
      g.state = 'wait';
      g.rest = { ...QUEUE[Math.min(i, QUEUE.length - 1)], yaw: -Math.PI / 2 };
    });
    BAYS.forEach((_, b) => {
      const g = this.makeGuest(100 + b, 'ride', b);
      g.luggage = b !== 1;
      this.guests.push(g);
    });
    this.defineEvents();
    this.cursor = start;
    this.step(now);
    this.live = true;
  }

  private makeCar(key: string, kind: CarKind, paint: number, sign: number, home: SimCar['home'], spot: number): SimCar {
    const c: SimCar = { key, kind, paint, sign, home, spot, motion: null, rest: { x: 0, z: 0, yaw: WEST }, gone: false, roof: false, hazards: false, blink: false, door: 0, playerDoor: 0, rider: null };
    this.cars.push(c);
    return c;
  }

  private makeGuest(id: number, line: SimGuest['line'], bay: number): SimGuest {
    return { id, line, bay, state: 'inside', walk: null, rest: { ...INSIDE }, car: null, luggage: false };
  }

  // --- Clock --------------------------------------------------------------------

  /**
   * Run up to wall-clock time `t`. `held` says whether a player is in a car (or
   * has its door open): it stays where it is.
   */
  step(t: number, held?: (c: SimCar) => boolean) {
    if (held) this.held = held;
    for (;;) {
      let best = Infinity;
      for (const d of this.defs) best = Math.min(best, nextAfter(this.cursor, d.period, d.off));
      if (best > t) break;
      this.settle(best);
      for (const d of this.defs) if (nextAfter(this.cursor, d.period, d.off) === best) d.fn(best);
      this.cursor = best;
    }
    this.settle(t);
    // Cars that have left (and nobody's riding): forget them.
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (c.gone && !c.rider) this.cars.splice(i, 1);
    }
  }

  /** Finish whatever motion and walk is over by time t. */
  private settle(t: number) {
    for (const c of this.cars) {
      const m = c.motion;
      if (!m || t < m.t0 + m.dur) continue;
      const end = poseAt(m.path, m.path.length);
      c.motion = null;
      if (m.ease === 'depart') {
        c.gone = true;
        c.blink = false;
        if (c.rider) {
          c.rider.state = 'inside';
          c.rider.car = null;
          c.rider.rest = { ...INSIDE };
          c.rider = null;
        }
      } else {
        c.rest = { x: end.x, z: end.z, yaw: WEST };
        if (m.ease === 'arrive' && c.home === 'bay') c.hazards = true;
        if (m.ease === 'arrive' && this.live) this.events.push({ kind: 'whistle', car: c, t });
      }
    }
    for (const g of this.guests) {
      const w = g.walk;
      if (!w || t < w.t0 + w.path.length / w.speed) continue;
      const end = poseAt(w.path, w.path.length);
      g.walk = null;
      g.state = 'wait';
      g.rest = { x: end.x, z: end.z, yaw: w.face };
    }
  }

  private defineEvents() {
    const T = TAXI_EPOCH;
    const on = (period: number, off: number, fn: (t: number) => void) => this.defs.push({ period, off: ((off % period) + period) % period, fn });
    // --- The taxi line.
    on(T, TAXI.depart, (t) => {
      const f = this.taxis[0];
      if (!f || f.spot !== 0 || f.motion || this.held(f)) return;
      this.taxis.shift();
      this.depart(f, t, TAXI.departDur);
    });
    on(T, TAXI.advance, (t) => {
      // Move up, front first; a car someone's in stays (and everyone behind it).
      let prev = -1;
      for (const [i, c] of this.taxis.entries()) {
        const want = prev + 1;
        if (c.spot > want && !c.motion && !this.held(c)) {
          c.motion = { path: shiftPath(TAXI_SLOTS[c.spot], TAXI_SLOTS[want]), t0: t + 0.7 * i, dur: TAXI.advanceDur, ease: 'shift' };
          c.spot = want;
          if (this.live) this.events.push({ kind: 'shift', car: c, t });
        }
        prev = c.spot;
      }
    });
    on(T, TAXI.arrive, (t) => {
      const last = this.taxis[this.taxis.length - 1];
      const spot = last ? last.spot + 1 : 0;
      if (spot >= TAXI_SLOTS.length) return;
      const n = Math.round((t - TAXI.arrive) / T);
      const c = this.makeCar(`t${n}`, taxiKind(n), 0, 0, 'taxi', spot);
      c.roof = true;
      c.motion = { path: arrivalPath(TAXI_SLOTS[spot]), t0: t, dur: TAXI.arriveDur, ease: 'arrive' };
      c.rest = { x: TAXI_SLOTS[spot], z: CURB_LANE, yaw: WEST };
      this.taxis.push(c);
      if (this.live) this.events.push({ kind: 'arrive', car: c, t });
    });
    on(T, TAXI.guestOut, (t) => {
      const f = this.taxis[0];
      const g = this.queue[0];
      if (!f || f.spot !== 0 || f.motion || f.rider || !g || g.state !== 'wait' || this.held(f)) return;
      // Nobody else already at its door.
      if (this.guests.some((x) => x.car === f)) return;
      this.queue.shift();
      const door = curbSpot(TAXI_SLOTS[0]);
      this.walk(g, [[g.rest.x, g.rest.z], [door.x + 0.6, door.z - 0.3], [door.x, door.z]], t, 1.0, Math.PI);
      g.car = f;
      // The rest move up one place.
      this.queue.forEach((q, i) => {
        if (q.state !== 'wait') return;
        this.walk(q, [[q.rest.x, q.rest.z], [QUEUE[i].x, QUEUE[i].z]], t + 1 + 0.5 * i, 0.8, -Math.PI / 2);
      });
    });
    on(T, TAXI.door, (t) => {
      const f = this.taxis[0];
      const g = f && this.guests.find((x) => x.car === f && x.state === 'wait');
      if (!f || !g || f.motion || this.held(f)) return;
      this.setDoor(f, 1, t);
    });
    on(T, TAXI.seated, () => {
      const f = this.taxis[0];
      const g = f && this.guests.find((x) => x.car === f && x.state === 'wait');
      if (!f || !g || f.door !== 1) return;
      this.board(g, f);
    });
    on(T, TAXI.close, (t) => {
      const f = this.taxis[0];
      if (f && f.door) this.setDoor(f, 0, t);
      if (f && f.rider) f.roof = false;
    });
    on(T, TAXI.blink, () => {
      const f = this.taxis[0];
      if (f && f.rider && !this.held(f)) f.blink = true;
    });
    // Guests who rode off come back out (another trip), to the end of the queue.
    on(T, 20, (t) => {
      for (const g of this.guests) {
        if (g.line !== 'taxi' || g.state !== 'inside') continue;
        const i = this.queue.length;
        if (i >= QUEUE.length) break;
        const q = QUEUE[i];
        const door = SLIDE_DOORS[1].x;
        g.rest = { x: door, z: -1.4, yaw: 0 };
        this.walk(g, [[door, -1.4], [door, WALK_LANE], [312.6, WALK_LANE], [312.6, q.z], [q.x, q.z]], t, 1.05, -Math.PI / 2);
        this.queue.push(g);
      }
    });

    // --- The rideshare bays.
    BAYS.forEach((bx, b) => {
      const A = RIDE.arrive[b],
        D = RIDE.depart[b];
      const guest = () => this.guests.find((g) => g.line === 'ride' && g.bay === b)!;
      on(PERIOD, A + RIDE.guestOut, (t) => {
        const g = guest();
        if (g.state !== 'inside' || this.bays[b]) return;
        const spot = curbSpot(bx);
        const door = SLIDE_DOORS[0].x;
        g.rest = { x: door, z: -1.4, yaw: 0 };
        this.walk(g, [[door, -1.4], [door, WALK_LANE], [spot.x + 0.4, WALK_LANE + 0.2], [spot.x, spot.z]], t, 1.0, Math.PI);
      });
      on(PERIOD, A, (t) => {
        if (this.bays[b]) return;
        const c = Math.round((t - A) / PERIOD);
        const r = rideCar(b, c);
        const car = this.makeCar(`r${b}:${c}`, r.kind, r.paint, r.sign, 'bay', b);
        car.motion = { path: arrivalPath(bx), t0: t, dur: RIDE.arriveDur, ease: 'arrive' };
        car.rest = { x: bx, z: CURB_LANE, yaw: WEST };
        this.bays[b] = car;
        guest().car = car;
        if (this.live) this.events.push({ kind: 'arrive', car, t });
      });
      on(PERIOD, D + RIDE.door, (t) => {
        const car = this.bays[b];
        const g = guest();
        if (!car || car.motion || this.held(car) || g.state !== 'wait' || g.car !== car) return;
        this.setDoor(car, 1, t);
      });
      on(PERIOD, D + RIDE.seated, () => {
        const car = this.bays[b];
        const g = guest();
        if (!car || car.door !== 1 || g.state !== 'wait' || g.car !== car) return;
        this.board(g, car);
      });
      on(PERIOD, D + RIDE.close, (t) => {
        const car = this.bays[b];
        if (car && car.door) this.setDoor(car, 0, t);
      });
      on(PERIOD, D + RIDE.blink, () => {
        const car = this.bays[b];
        if (!car || car.motion || this.held(car)) return;
        car.hazards = false;
        car.blink = true;
      });
      on(PERIOD, D, (t) => {
        const car = this.bays[b];
        if (!car || car.motion || this.held(car)) return;
        // Nobody came (or they're still at the door): the ride's cancelled, the guest goes back in.
        const g = guest();
        if (g.car === car && g.state !== 'seated') {
          g.car = null;
          g.state = 'inside';
          g.walk = null;
          g.rest = { ...INSIDE };
        }
        this.bays[b] = null;
        this.depart(car, t, RIDE.departDur);
      });
    });
  }

  private depart(c: SimCar, t: number, dur: number) {
    // Anyone still waiting at its door (it's leaving without them) goes back in for another.
    for (const g of this.guests) {
      if (g.car !== c || g === c.rider) continue;
      g.car = null;
      g.state = 'inside';
      g.walk = null;
      g.rest = { ...INSIDE };
    }
    c.motion = { path: departurePath(c.rest.x), t0: t, dur, ease: 'depart' };
    c.hazards = false;
    c.blink = true;
    c.door = 0;
    if (c.rider) c.rider.state = 'riding';
    if (this.live) this.events.push({ kind: 'depart', car: c, t });
  }

  private board(g: SimGuest, c: SimCar) {
    g.state = 'seated';
    g.walk = null;
    g.car = c;
    c.rider = g;
  }

  private setDoor(c: SimCar, v: number, t: number) {
    if (c.door === v) return;
    c.door = v;
    if (this.live) this.events.push({ kind: 'door', car: c, t });
  }

  private walk(g: SimGuest, pts: [number, number][], t: number, speed: number, face: number) {
    g.state = 'walk';
    g.walk = { path: linePath(pts), t0: t, speed, face };
  }

  // --- Where things are ------------------------------------------------------------

  /** A car's pose at time t (cars that have left: their last pose). */
  carPose(c: SimCar, t: number): Pose & { speed: number } {
    const m = c.motion;
    if (!m) return { ...c.rest, speed: 0 };
    const k = (t - m.t0) / m.dur;
    if (k <= 0) {
      const p = poseAt(m.path, 0);
      return { x: p.x, z: p.z, yaw: m.ease === 'shift' ? WEST : p.yaw, speed: 0 };
    }
    const f = m.ease === 'arrive' ? easeArrive : m.ease === 'depart' ? easeDepart : easeShift;
    const d = f(k) * m.path.length;
    const p = poseAt(m.path, d);
    const dk = 0.02;
    const speed = ((f(Math.min(1, k + dk)) - f(Math.max(0, k - dk))) * m.path.length) / (2 * dk * m.dur);
    return { x: p.x, z: p.z, yaw: m.ease === 'shift' ? WEST : p.yaw, speed };
  }

  /** Is a car on its way in (braking)? */
  braking(c: SimCar, t: number) {
    const m = c.motion;
    return !!m && m.ease !== 'depart' && t > m.t0 + m.dur * 0.45;
  }

  /** A guest's pose at time t, and whether they're walking (m/s) or sitting. */
  guestPose(g: SimGuest, t: number): Pose & { moving: number; seated: boolean; hidden: boolean } {
    if ((g.state === 'seated' || g.state === 'riding') && g.car) {
      const c = this.carPose(g.car, t);
      const s = seatOf(c);
      return { x: s.x, z: s.z, yaw: c.yaw, moving: 0, seated: true, hidden: false };
    }
    if (g.state === 'inside') return { ...g.rest, moving: 0, seated: false, hidden: true };
    const w = g.walk;
    if (w) {
      const e = t - w.t0;
      if (e < 0) return { ...g.rest, moving: 0, seated: false, hidden: false };
      const d = e * w.speed;
      const p = poseAt(w.path, d);
      return { ...p, moving: d < w.path.length ? w.speed : 0, seated: false, hidden: false };
    }
    return { ...g.rest, moving: 0, seated: false, hidden: false };
  }

  /** Cars on the driveway now (not those that have left). */
  get here(): SimCar[] {
    return [this.valet, ...this.cars.filter((c) => !c.gone && c !== this.valet)];
  }
}

/** The next time strictly after `t` that an event at `off` every `period` happens. */
function nextAfter(t: number, period: number, off: number): number {
  const n = Math.floor((t - off) / period) + 1;
  return n * period + off;
}

/** The curb-side back seat of a car at a pose. */
export function seatOf(p: Pose): { x: number; z: number } {
  // Local (right −x, rear −z): (−0.4, −0.55) turned by the car's yaw.
  const lx = -0.4,
    lz = -0.55;
  const c = Math.cos(p.yaw),
    s = Math.sin(p.yaw);
  return { x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c };
}

void backSeat;
