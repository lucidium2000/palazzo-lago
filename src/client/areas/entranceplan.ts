/**
 * The resort's front entrance (pure numbers and paths, no three.js, so tests
 * can check them): the lobby's elevator landing, its glass doors, and outside
 * the porte-cochère, the covered driveway where the taxis queue and the
 * rideshare cars pull up, with the Strip beyond.
 *
 * Like the suite and the Promenade it lives far from the casino in the world
 * (east, x ≈ 300, out of the camera's range of everything else), reached only
 * by elevator ("G", the ground floor).
 *
 *    z = -8.5 ┌──────────── Main lobby (elevator landing) ─────────║ cars (east wall, x = 307)
 *             │   console            chandelier                   ║
 *    z = 0    └══ glass ══[ slide ]══( revolving )══[ slide ]══════┘   facade
 *             sidewalk (canopy above)    doorman   podium   taxi stand · queue →
 *    z = 6.5  ── curb ──[bay 3][bay 2][bay 1]─[valet car]─[taxi][taxi][taxi][taxi][taxi]──
 *             curb lane (z 7.9)              ← cars drive west ←
 *             through lane (z 11.3)
 *    z = 13   ── planter island: columns, palms, the fountain ──
 *    z = 19   ── hedges, palms ──  the Strip boulevard (z 26 … 50) and the city beyond
 *           x = 270                       300                              330
 */

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Centre of the entrance (the revolving door's x). */
export const ENT_X = 298;
/** The lobby inside (the elevator landing), its facade at z1. */
export const ENT_LOBBY = { x0: 289, x1: 307, z0: -8.5, z1: 0, h: 5.2 };
/** The elevator bank in the lobby's east wall (doors on the wall, cabs extending east). */
export const ENT_CARS = { doorX: 307, zs: [-6.2, -3.6] };
/** The glass facade line. */
export const FACADE_Z = 0;
/** The two automatic sliding doors in the facade (centre x, half-width) and the revolving door. */
export const SLIDE_DOORS = [
  { x: 293.2, half: 1.0 },
  { x: 302.8, half: 1.0 },
];
export const REVOLVING = { x: ENT_X, r: 1.45 };
/** The covered sidewalk in front of the doors, and its curb. */
export const SIDEWALK = { x0: 262, x1: 338, z0: 0, z1: 6.5 };
export const CURB_Z = 6.5;
/** Car centre lines: the curb lane (parked cars) and the through lane. */
export const CURB_LANE = 7.9;
export const THRU_LANE = 11.3;
/** The driveway's far edge, and the planter island beyond it. */
export const DRIVE = { x0: 262, x1: 338, z0: CURB_Z, z1: 13 };
export const ISLAND = { x0: 276, x1: 324, z0: 13.3, z1: 18.4 };
/** The porte-cochère's canopy (its roof), and the height of its ceiling. */
export const CANOPY = { x0: 270, x1: 330, z0: -0.2, z1: 17.2, h: 6.6 };
/** Canopy columns along the island (and the facade end). */
export const COLUMNS: [number, number][] = [
  [280, 15.0],
  [290, 15.0],
  [306, 15.0],
  [316, 15.0],
];
/** The fountain in the island's middle. */
export const FOUNTAIN = { x: ENT_X, z: 15.85, r: 2.4 };
/** The Strip boulevard: near sidewalk, westbound lanes, the median, eastbound lanes. */
export const BLVD = { z0: 26, z1: 50, median: [36.2, 39.8] as [number, number], west: [27.6, 30.9, 34.2], east: [41.8, 45.1, 48.4], walk: [22.6, 26] as [number, number] };

/** Where the walk stops: the sidewalk and the driveway (you may cross to the island). */
export const ENT_WALK = { x0: 264, x1: 336, z0: 0, z1: 21.5 };

/** How many staff and guests the entrance adds to the crowd (on top of the floor's). */
export function entranceShare(people: number) {
  return people >= 45 ? 16 : 14;
}

/** Is (x) the entrance? (It's the only thing out here.) */
export const onEntrance = (x: number) => x > 200 && x < 500;

// Taxi line: five slots along the curb, the front one by the taxi stand.
export const TAXI_SLOTS = [305.6, 310.9, 316.2, 321.5, 326.8];
/** Valet stand: the parked car in front of the revolving door. */
export const VALET_SPOT = 298.0;
/** Rideshare bays (numbered 1, 2, 3 from the doors westward). */
export const BAYS = [288.6, 278.6, 268.6];

/** Car body sizes (m): length, width (the door is on the right, the curb side). */
export const CAR = { len: 4.85, wid: 1.86 };
/** The rear right door: its hinge's distance behind the car's centre, and its length. */
export const DOOR = { hinge: -0.12, len: 0.98 };

/** Where a guest stands on the curb to get into a car parked at x (facing west). */
export const curbSpot = (x: number) => ({ x: x + 0.55, z: CURB_Z - 0.45 });
/** The back seat on the curb side of a car parked at (x, z) facing west (its world spot). */
export const backSeat = (x: number, z = CURB_LANE) => ({ x: x + 0.55, z: z - 0.4 });

// Walking lanes on the sidewalk.
export const WALK_LANE = 2.9;
/** The taxi queue (front first), along the stanchions. */
export const QUEUE = [
  { x: 307.6, z: 4.9 },
  { x: 308.7, z: 4.9 },
  { x: 309.8, z: 4.9 },
  { x: 310.9, z: 4.9 },
];

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export interface Path {
  /** Densely sampled points and the distance along the path to each. */
  xs: number[];
  zs: number[];
  s: number[];
  length: number;
}

export interface Pose {
  x: number;
  z: number;
  /** Facing (person convention: atan2(dx, dz)). */
  yaw: number;
}

/**
 * A smooth path (centripetal Catmull-Rom) through control points. Long legs are
 * split into short even steps first, so the curve keeps to the straights and
 * only rounds the corners (a spline through uneven points bulges).
 */
export function makePath(ctrl: [number, number][], per = 8, step = 5): Path {
  const pts: [number, number][] = [ctrl[0]];
  for (let i = 1; i < ctrl.length; i++) {
    const [ax, az] = ctrl[i - 1],
      [bx, bz] = ctrl[i];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 1; k <= n; k++) pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  const xs: number[] = [],
    zs: number[] = [];
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  // Extend the ends straight (so the first and last segments don't curl).
  P[0] = [2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]];
  const n = pts.length;
  P[n + 1] = [2 * pts[n - 1][0] - pts[n - 2][0], 2 * pts[n - 1][1] - pts[n - 2][1]];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    const d = (a: [number, number], b: [number, number]) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
    const t0 = 0,
      t1 = t0 + d(p0, p1),
      t2 = t1 + d(p1, p2),
      t3 = t2 + d(p2, p3);
    for (let k = 0; k < per; k++) {
      const t = t1 + ((t2 - t1) * k) / per;
      const c = (a: number, b: number, ta: number, tb: number) => ((tb - t) / (tb - ta)) * a + ((t - ta) / (tb - ta)) * b;
      const v = [0, 1].map((j) => {
        const A1 = c(p0[j], p1[j], t0, t1),
          A2 = c(p1[j], p2[j], t1, t2),
          A3 = c(p2[j], p3[j], t2, t3);
        const B1 = c(A1, A2, t0, t2),
          B2 = c(A2, A3, t1, t3);
        return c(B1, B2, t1, t2);
      });
      xs.push(v[0]);
      zs.push(v[1]);
    }
  }
  xs.push(pts[n - 1][0]);
  zs.push(pts[n - 1][1]);
  const s = [0];
  for (let i = 1; i < xs.length; i++) s.push(s[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
  return { xs, zs, s, length: s[s.length - 1] };
}

/** A straight polyline path (people walking). */
export function linePath(pts: [number, number][]): Path {
  const xs = pts.map((p) => p[0]),
    zs = pts.map((p) => p[1]);
  const s = [0];
  for (let i = 1; i < xs.length; i++) s.push(s[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
  return { xs, zs, s, length: s[s.length - 1] };
}

/** Where along a path, `d` metres from its start (clamped), and which way it's heading there. */
export function poseAt(p: Path, d: number): Pose {
  const n = p.xs.length;
  if (n === 1) return { x: p.xs[0], z: p.zs[0], yaw: 0 };
  const dd = Math.max(0, Math.min(p.length, d));
  let lo = 0,
    hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p.s[mid] <= dd) lo = mid;
    else hi = mid;
  }
  const seg = p.s[hi] - p.s[lo] || 1;
  const k = (dd - p.s[lo]) / seg;
  const dx = p.xs[hi] - p.xs[lo],
    dz = p.zs[hi] - p.zs[lo];
  return { x: p.xs[lo] + dx * k, z: p.zs[lo] + dz * k, yaw: Math.atan2(dx, dz) };
}

/** Facing west (−x), the way every car on the driveway points. */
export const WEST = -Math.PI / 2;

/** In from the Strip (the westbound near lane), into the driveway, along the through lane, and into the curb at x. */
export function arrivalPath(x: number): Path {
  const pts: [number, number][] = [
    [398, BLVD.west[0]],
    [356, BLVD.west[0]],
    [346, 24.5],
    [341, 15.5],
  ];
  if (x > 320) {
    // The back of the taxi line: straight off the ramp and in to the curb.
    pts.push([336.5, 10.6], [331.5, 8.25], [x, CURB_LANE]);
  } else {
    pts.push([335, THRU_LANE], [x + 8, THRU_LANE], [x + 3.8, CURB_LANE + 1.5], [x, CURB_LANE]);
  }
  return makePath(pts);
}

/** Out of the curb at x, west along the through lane, and out onto the Strip. */
export function departurePath(x: number): Path {
  return makePath([
    [x, CURB_LANE],
    [x - 3.4, CURB_LANE + 1.5],
    [x - 7.5, THRU_LANE],
    [Math.min(x - 11, 262), THRU_LANE],
    [253, 15.6],
    [247, 23.2],
    [238, BLVD.west[0]],
    [196, BLVD.west[0]],
  ]);
}

/** A short shuffle forward along the curb (the taxi line moving up). */
export function shiftPath(from: number, to: number): Path {
  return linePath([
    [from, CURB_LANE],
    [to, CURB_LANE],
  ]);
}

// Easing along a path (k = 0..1 of the time, returns 0..1 of the distance).
/** Coming in at speed, braking to a stop. */
export const easeArrive = (k: number) => {
  const c = Math.max(0, Math.min(1, k));
  return 1 - (1 - c) * (1 - c);
};
/** Pulling away from a stop, picking up speed. */
export const easeDepart = (k: number) => {
  const c = Math.max(0, Math.min(1, k));
  return c * c;
};
/** A short move from rest to rest. */
export const easeShift = (k: number) => {
  const c = Math.max(0, Math.min(1, k));
  return c * c * (3 - 2 * c);
};

// ---------------------------------------------------------------------------
// The cars: kinds, colours and names (all original)
// ---------------------------------------------------------------------------

export type CarKind = 'taxiY' | 'taxiBW' | 'sedan' | 'suv' | 'lux';
export const CAR_KINDS: CarKind[] = ['taxiY', 'taxiBW', 'sedan', 'suv', 'lux'];

/** The two (made-up) cab fleets: their door lettering and roof sign. */
export const FLEETS: Record<'taxiY' | 'taxiBW', { name: string; sub: string; phone: string }> = {
  taxiY: { name: 'LUCKY LANTERN', sub: 'CAB CO.', phone: '702-555-0147' },
  taxiBW: { name: 'NEON MESA', sub: 'TAXI', phone: '702-555-0193' },
};

/** Paint for rideshare cars: ordinary colours (sRGB hex). */
export const RIDE_PAINTS = [0x15171b, 0xe9e9e6, 0x8c9096, 0x4a4e55, 0x1d2a44, 0x5a1a20, 0x2e3a34, 0xb9b3a4];
/** Windshield signs: neutral glows (no brand, no logo). */
export const SIGN_COLORS = [0xe8f0ff, 0x9fe8e0, 0xffd9a0, 0xd8c8ff];

/** A tiny deterministic hash of integers to 0..1 (the same on every machine). */
export function hash01(...n: number[]): number {
  let h = 2166136261;
  for (const v of n) {
    h ^= v | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// The schedule (seconds; one wall clock for everyone, like the party's set)
// ---------------------------------------------------------------------------

/** Everything repeats every 120 s; the taxi line moves every 60 s. */
export const PERIOD = 120;
export const TAXI_EPOCH = 60;
/** Taxi line, seconds into each epoch. */
export const TAXI = { depart: 0, departDur: 11, advance: 13, advanceDur: 4.5, arrive: 28, arriveDur: 14, guestOut: 40, door: 44.5, seated: 45.8, close: 48, blink: 57 };
/**
 * Rideshare bays, seconds into each period: when each bay's car arrives and
 * when it leaves. The through lane is never used by two at once (the taxis
 * leave at 0 and 60).
 */
export const RIDE = { arrive: [73, 13, 41], depart: [26, 86, 101], arriveDur: 13, departDur: 10, guestOut: -9, door: -9, seated: -7.6, close: -5.2, blink: -3 };

/** A ride's car: its kind, paint and sign (bay b, cycle c). */
export function rideCar(b: number, c: number): { kind: CarKind; paint: number; sign: number } {
  const h = hash01(b, c, 7);
  return {
    kind: h < 0.58 ? 'sedan' : 'suv',
    paint: RIDE_PAINTS[Math.floor(hash01(b, c, 11) * RIDE_PAINTS.length)],
    sign: SIGN_COLORS[Math.floor(hash01(b, c, 13) * SIGN_COLORS.length)],
  };
}

/** A taxi (by the epoch it joined the line): one in three is a Neon Mesa black-and-white. */
export function taxiKind(n: number): 'taxiY' | 'taxiBW' {
  return hash01(n, 3) < 0.34 ? 'taxiBW' : 'taxiY';
}

/** Are the indicators lit (a shared blink, about 1.4 Hz)? */
export const blinkOn = (t: number) => t * 1.4 - Math.floor(t * 1.4) < 0.5;
