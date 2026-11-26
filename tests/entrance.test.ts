import { describe, expect, it } from 'vitest';
import {
  arrivalPath,
  BAYS,
  CAR,
  CURB_LANE,
  departurePath,
  ENT_CARS,
  FLEETS,
  makePath,
  onEntrance,
  PERIOD,
  poseAt,
  RIDE,
  SIGN_COLORS,
  TAXI_EPOCH,
  TAXI_SLOTS,
  THRU_LANE,
} from '../src/client/areas/entranceplan';
import { Traffic, type SimCar } from '../src/client/areas/entrancetraffic';
import { destSlot, floorLabel, floorsBetween, isLanding, LANDINGS, type CarRef, type LandingId } from '../src/client/areas/liftlogic';
import { renderCityBed, renderHorn, renderIdle, renderPass, renderThunk, renderWhistle } from '../src/client/entranceaudio';
import { onPromenade } from '../src/client/areas/promenadeplan';

/** A wall-clock time well away from zero (the schedule runs on Date.now()). */
const T0 = 1_795_000_000;

describe('Main Entrance landing', () => {
  const CARS: CarRef[] = [
    ...[2.2, 4.75, 7.25, 9.8].map((z, i) => ({ landing: 'casino' as const, index: i, slot: i, x: 42, z })),
    ...[-7.6, -5].map((z, i) => ({ landing: 'pool' as const, index: i, slot: 4 + i, x: 48, z })),
    { landing: 'suite' as const, index: 0, slot: 6, x: 600, z: 3.4 },
    ...[-1.3, 1.3].map((z, i) => ({ landing: 'promenade' as const, index: i, slot: 7 + i, x: -600, z })),
    ...ENT_CARS.zs.map((z, i) => ({ landing: 'entrance' as const, index: i, slot: 9 + i, x: ENT_CARS.doorX, z })),
  ];
  const all: LandingId[] = ['casino', 'pool', 'suite', 'promenade', 'entrance'];

  it('is reached from every landing, and reaches every landing', () => {
    for (const from of CARS)
      for (const dest of all) expect(CARS[destSlot(CARS, from, dest)].landing).toBe(dest);
    expect(destSlot(CARS, CARS[3], 'entrance')).toBe(10);
    expect(isLanding('entrance')).toBe(true);
  });

  it('is the ground floor: G, below the casino', () => {
    expect(LANDINGS.entrance.short).toBe('G');
    expect(floorLabel(LANDINGS.entrance.floor)).toBe('G');
    expect(floorsBetween(LANDINGS.casino.floor, LANDINGS.entrance.floor).map(floorLabel)).toEqual(['C', 'G']);
    expect(floorsBetween(LANDINGS.entrance.floor, LANDINGS.promenade.floor).map(floorLabel)).toEqual(['G', 'C', 'P', 'M']);
  });

  it('lies far from everything else (its own floor)', () => {
    expect(onEntrance(300)).toBe(true);
    for (const x of [0, 40, 594, -618]) expect(onEntrance(x)).toBe(false);
    expect(onPromenade(300)).toBe(false);
  });
});

describe('driveway paths', () => {
  it('bring cars in to the curb and take them out to the Strip, smoothly', () => {
    for (const x of [...TAXI_SLOTS, ...BAYS]) {
      const a = arrivalPath(x);
      const end = poseAt(a, a.length);
      expect(end.x).toBeCloseTo(x, 3);
      expect(end.z).toBeCloseTo(CURB_LANE, 3);
      const d = departurePath(x);
      const start = poseAt(d, 0);
      expect(start.x).toBeCloseTo(x, 3);
      // Never a sharp kink: heading changes little from step to step.
      for (const p of [a, d])
        for (let s = 1; s < p.length; s += 1) {
          const h0 = poseAt(p, s - 1).yaw,
            h1 = poseAt(p, s).yaw;
          expect(Math.abs(Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)))).toBeLessThan(0.5);
        }
    }
  });

  it('runs west along the through lane past the parked cars', () => {
    const d = departurePath(TAXI_SLOTS[0]);
    const mid = poseAt(d, 30);
    expect(mid.z).toBeCloseTo(THRU_LANE, 0);
    expect(Math.abs(mid.yaw + Math.PI / 2)).toBeLessThan(0.05);
    expect(makePath([[0, 0], [10, 0]]).length).toBeCloseTo(10, 3);
  });
});

/** Do two cars' footprints (grown by `m`) overlap? (Separating axes.) */
function overlap(a: { x: number; z: number; yaw: number }, b: { x: number; z: number; yaw: number }, m: number): boolean {
  const corners = (p: typeof a) => {
    const fx = Math.sin(p.yaw),
      fz = Math.cos(p.yaw);
    const hl = CAR.len / 2 + m,
      hw = CAR.wid / 2 + m;
    return [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
    ].map(([l, w]) => [p.x + fx * hl * l + fz * hw * w, p.z + fz * hl * l - fx * hw * w]);
  };
  const A = corners(a),
    B = corners(b);
  for (const P of [A, B])
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = P[i],
        [x1, z1] = P[(i + 1) % 4];
      const nx = z1 - z0,
        nz = x0 - x1;
      const pa = A.map(([x, z]) => x * nx + z * nz),
        pb = B.map(([x, z]) => x * nx + z * nz);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  return true;
}

/** Every car on the driveway at time t, with its pose. */
function snapshot(tr: Traffic, t: number) {
  return tr.here.map((c) => ({ c, p: tr.carPose(c, t) }));
}

describe('the schedule', () => {
  it('is the same for everyone, whenever they arrived', () => {
    const a = new Traffic(T0);
    const b = new Traffic(T0 + 437);
    const c = new Traffic(T0 + 1000);
    for (const t of [T0 + 1000, T0 + 1033.5, T0 + 1077, T0 + 1140]) {
      a.step(t);
      b.step(t);
      c.step(t);
      const key = (x: Traffic) => JSON.stringify(snapshot(x, t).map(({ c, p }) => [c.key, c.kind, c.paint, +p.x.toFixed(3), +p.z.toFixed(3), c.door]));
      expect(key(a)).toBe(key(b));
      expect(key(a)).toBe(key(c));
      const g = (x: Traffic) => JSON.stringify(x.guests.map((q) => [q.id, q.state, +x.guestPose(q, t).x.toFixed(3)]));
      expect(g(a)).toBe(g(b));
    }
  });

  it('never puts two cars in the same place', () => {
    const tr = new Traffic(T0);
    for (let t = T0; t < T0 + 2 * PERIOD; t += 0.25) {
      tr.step(t);
      const s = snapshot(tr, t);
      for (let i = 0; i < s.length; i++)
        for (let j = i + 1; j < s.length; j++) {
          // Their footprints (a little margin round each body) never touch.
          expect(overlap(s[i].p, s[j].p, 0.1), `${s[i].c.key} / ${s[j].c.key} at ${(t - T0).toFixed(2)}`).toBe(false);
        }
    }
  });

  it('a taxi leaves every minute with a guest in it, and the line fills up again', () => {
    const tr = new Traffic(T0);
    const left = new Set<string>();
    const riders = new Set<string>();
    for (let t = T0; t < T0 + 4 * TAXI_EPOCH; t += 0.5) {
      tr.step(t);
      for (const c of tr.cars) if (c.home === 'taxi' && c.motion?.ease === 'depart') {
        left.add(c.key);
        if (c.rider) riders.add(c.key);
      }
    }
    expect(left.size).toBeGreaterThanOrEqual(4);
    expect(riders.size).toBe(left.size);
    expect(tr.taxis.length).toBe(TAXI_SLOTS.length);
  });

  it('each bay gets a car with its sign lit and hazards on, a guest gets in, it drives off', () => {
    const tr = new Traffic(T0);
    const seen = BAYS.map(() => ({ hazards: false, boarded: false, left: false, sign: false }));
    for (let t = T0; t < T0 + 2 * PERIOD; t += 0.5) {
      tr.step(t);
      for (const c of tr.cars) {
        if (c.home !== 'bay') continue;
        const s = seen[c.spot];
        if (c.hazards) s.hazards = true;
        if (c.rider) s.boarded = true;
        if (c.motion?.ease === 'depart') s.left = true;
        if (SIGN_COLORS.includes(c.sign)) s.sign = true;
      }
    }
    for (const s of seen) expect(s).toEqual({ hazards: true, boarded: true, left: true, sign: true });
    // A bay's car waits a good while (long enough to walk over and get in).
    for (let b = 0; b < BAYS.length; b++) {
      const wait = (((RIDE.depart[b] - RIDE.arrive[b] - RIDE.arriveDur) % PERIOD) + PERIOD) % PERIOD;
      expect(wait).toBeGreaterThan(30);
    }
  });

  it("a car with someone in it stays put, and leaves on its next turn once they're out", () => {
    const tr = new Traffic(T0);
    let inCar: SimCar | null = null;
    const held = (c: SimCar) => c === inCar;
    // Find a bay car parked and waiting, and get in.
    let t = T0;
    for (; t < T0 + PERIOD; t += 0.5) {
      tr.step(t, held);
      const c = tr.bays.find((x) => x && !x.motion && x.hazards);
      if (c) {
        inCar = c;
        break;
      }
    }
    expect(inCar).not.toBeNull();
    const car = inCar!;
    const at = tr.carPose(car, t);
    for (const end = t + 2 * PERIOD; t < end; t += 0.5) {
      tr.step(t, held);
      const p = tr.carPose(car, t);
      expect(p.x).toBeCloseTo(at.x, 6);
      expect(car.motion).toBeNull();
    }
    // Out again: it goes at its bay's next departure.
    inCar = null;
    let gone = false;
    for (const end = t + PERIOD + 1; t < end; t += 0.5) {
      tr.step(t, held);
      if (car.motion?.ease === 'depart' || car.gone) gone = true;
    }
    expect(gone).toBe(true);
  });

  it('the taxi at the front holds the line while someone sits in it', () => {
    const tr = new Traffic(T0);
    tr.step(T0 + 1);
    const front = tr.taxis[0];
    const held = (c: SimCar) => c === front;
    for (let t = T0 + 1; t < T0 + 3 * TAXI_EPOCH; t += 0.5) {
      tr.step(t, held);
      expect(tr.taxis[0]).toBe(front);
      for (const c of tr.taxis) expect(c.motion?.ease === 'depart').toBe(false);
    }
    expect(tr.taxis.length).toBeLessThanOrEqual(TAXI_SLOTS.length);
  });
});

describe('the cars', () => {
  it('are original: made-up fleets, no real company names', () => {
    const banned = /uber|lyft|yellow cab|checker|curb|via|didi|bolt|grab|ola|gett|addison lee|whc|desert cab|western cab|vegas cab/i;
    for (const f of Object.values(FLEETS)) expect(`${f.name} ${f.sub}`).not.toMatch(banned);
    expect(CAR.len).toBeGreaterThan(4);
  });
});

describe('the sound out front', () => {
  it('renders quiet, finite clips', () => {
    const sr = 8000;
    for (const buf of [renderCityBed(sr, 3), renderIdle(sr, 2), renderPass(sr, 2), renderHorn(sr), renderThunk(sr), renderWhistle(sr)]) {
      expect(buf.length).toBeGreaterThan(sr * 0.2);
      let peak = 0;
      for (const v of buf) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
      expect(peak).toBeGreaterThan(0.1);
      expect(peak).toBeLessThanOrEqual(0.81);
    }
  });
});
