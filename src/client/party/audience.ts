import * as THREE from 'three';
import { STAGE } from '../areas/pool';
import type { Person } from '../people';

/**
 * Her audience. When she comes on, the dancers on the DJ's floor make their
 * way over and gather in front of her stage, and over the next minute and a
 * half as many again arrive (walking in from the deck's east and west edges)
 * and join them, all facing her. When her set ends the newcomers drift off the
 * way they came (and are away again: not drawn, not animated) and the dancers
 * go back to the DJ's floor.
 *
 * Where everyone is comes from the shared clock alone (seconds into her set,
 * or since it ended: schedule.ts), each person's walk a pure function of it
 * along fixed paths, so a room sees the same crowd move the same way, and
 * someone arriving mid-set finds everyone where they'd be.
 */

export interface AudienceTime {
  /** Seconds into her set (live), else -1. */
  into: number;
  /** Seconds since her last set ended (Infinity before her first). */
  since: number;
}

interface Walker {
  p: Person;
  /** Home (the DJ's floor; an extra: where they come in), the way there, and their place in front of her. */
  home: THREE.Vector2;
  via: THREE.Vector2[];
  spot: THREE.Vector2;
  /** When they set off (s into her set), and when they leave (s after it). */
  go: number;
  back: number;
  extra: boolean;
  /** Which way they face at home. */
  homeYaw: number;
  /** The whole way (home, via, spot) and its length. */
  path: THREE.Vector2[];
  L: number;
}

/** Walking pace (m/s). */
const PACE = 1.05;
/** The extras arrive over this long (s) after the first of them. */
const ARRIVE_OVER = 75;
/** Where the extras come in: the deck's east and west edges, and the turn toward the stage from each. */
const EAST = [new THREE.Vector2(60.2, -29.6), new THREE.Vector2(48.2, -29.3)];
const WEST = [new THREE.Vector2(23.9, -30.6), new THREE.Vector2(38.4, -30.0)];
/** The corner from the DJ's floor round to the front of her stage. */
const CORNER = new THREE.Vector2(46.9, -29.2);

/** Places in front of her stage, best first (the middle of the front rows), clear of `free`'s obstacles. */
export function audienceSpots(free: (x: number, z: number) => boolean, avoid: THREE.Vector2[] = []): THREE.Vector2[] {
  const out: { v: THREE.Vector2; score: number }[] = [];
  const rows = [STAGE.z1 + 1.0, STAGE.z1 + 1.85, STAGE.z1 + 2.7];
  const mid = STAGE.spot.x;
  rows.forEach((z, r) => {
    for (let k = -5; k <= 5; k++) {
      const x = mid + k * 0.82 + (r % 2 ? 0.41 : 0);
      if (x < STAGE.x0 + 0.3 || x > STAGE.x1 + 0.2) continue;
      const v = new THREE.Vector2(x, z + ((k * 37 + r * 11) % 7) * 0.03);
      if (avoid.some((a) => a.distanceTo(v) < 0.62)) continue;
      if (!free(v.x, v.y)) continue;
      out.push({ v, score: r * 1.2 + Math.abs(x - mid) * 0.5 });
    }
  });
  return out.sort((a, b) => a.score - b.score).map((o) => o.v);
}

/** Along a path (points) at distance `d` (clamped): the point, and the heading there. */
function along(pts: THREE.Vector2[], d: number, out: THREE.Vector2): number {
  let left = Math.max(0, d);
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i],
      b = pts[i + 1];
    const len = a.distanceTo(b);
    if (left <= len || i + 2 === pts.length) {
      const f = len > 0 ? Math.min(1, left / len) : 1;
      out.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
      return Math.atan2(b.x - a.x, b.y - a.y);
    }
    left -= len;
  }
  out.copy(pts[pts.length - 1]);
  return 0;
}

const pathLength = (pts: THREE.Vector2[]) => pts.reduce((s, p, i) => (i ? s + p.distanceTo(pts[i - 1]) : 0), 0);

export class Audience {
  private walkers: Walker[] = [];
  private v = new THREE.Vector2();
  /** How many extras are here now (for the curious, and the report). */
  here = 0;

  constructor(
    dancers: Person[],
    extras: Person[],
    free: (x: number, z: number) => boolean,
    djYaw: number,
  ) {
    // The fans already in front of her stage stay where they are; everyone else gets a place.
    const near = (p: Person) => p.pos.x < STAGE.x1 + 0.5 && p.pos.z < STAGE.z1 + 1.6;
    const fans = dancers.filter(near);
    const spots = audienceSpots(free, fans.map((p) => new THREE.Vector2(p.pos.x, p.pos.z)));
    let s = 0;
    dancers.forEach((p, k) => {
      const home = new THREE.Vector2(p.pos.x, p.pos.z);
      const fan = near(p);
      const spot = fan ? home.clone() : (spots[s++] ?? home.clone());
      this.walkers.push({ p, home, via: fan || home.x < CORNER.x ? [] : [CORNER], spot, go: 2 + k * 1.1, back: 1 + k * 0.9, extra: false, homeYaw: p.homeYaw ?? djYaw, path: [], L: 0 });
    });
    extras.forEach((p, k) => {
      const spot = spots[s++];
      if (!spot) return;
      const [entry, turn] = k % 2 ? WEST : EAST;
      this.walkers.push({ p, home: entry.clone(), via: [turn], spot, go: 8 + (k * ARRIVE_OVER) / Math.max(1, extras.length), back: 3 + k * 1.4, extra: true, homeYaw: djYaw, path: [], L: 0 });
      p.away = true;
    });
    for (const w of this.walkers) {
      w.path = [w.home, ...w.via, w.spot];
      w.L = pathLength(w.path);
    }
  }

  /** One frame: where her set is (`t`), where she is (they face her). */
  update(dt: number, t: AudienceTime, her: THREE.Vector3) {
    let here = 0;
    for (const w of this.walkers) {
      const p = w.p;
      const path = w.path,
        L = w.L;
      let d: number;
      if (t.into >= 0) d = (t.into - w.go) * PACE;
      else if (Number.isFinite(t.since)) d = L - (t.since - w.back) * PACE;
      else d = -1;
      const at = THREE.MathUtils.clamp(d, 0, L);
      // Extras are away until they set off, and once they're back out.
      const gone = w.extra && d <= 0;
      if (gone !== p.away) p.away = gone;
      if (gone) continue;
      if (w.extra) here++;
      const heading = along(path, at, this.v);
      const walking = d > 0 && d < L;
      p.pos.x = this.v.x;
      p.pos.z = this.v.y;
      p.pos.y = 0;
      let want: number;
      if (walking) {
        want = t.into >= 0 ? heading : heading + Math.PI;
        p.moving = PACE;
        p.walkPhase += PACE * dt * 5.2;
      } else {
        p.moving = 0;
        want = at >= L - 1e-6 ? Math.atan2(her.x - p.pos.x, her.z - p.pos.z) : w.homeYaw;
      }
      let dy = want - p.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      p.yaw += dy * Math.min(1, dt * (walking ? 6 : 1.5));
      p.homeYaw = p.yaw;
    }
    this.here = here;
  }

  /** Everyone (dancers and extras) and where they're headed (tests and debugging). */
  get members() {
    return this.walkers.map((w) => ({ extra: w.extra, home: w.home.toArray(), spot: w.spot.toArray(), away: w.p.away, at: [+w.p.pos.x.toFixed(2), +w.p.pos.z.toFixed(2)] }));
  }
}
