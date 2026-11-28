import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Bodies, LINE_GAP } from '../src/client/bodies';
import { Person } from '../src/client/people';
import { BODY_R, WEDGE_T, Wedge, YIELD_STEP, handShove, stepAgainst, yieldDirs } from '../src/client/push';
import { Audience } from '../src/client/party/audience';
import { STAGE } from '../src/client/areas/pool';

const look = { dress: false, main: 0, second: 0, skin: 0, hair: 0, hairStyle: 'short' as const, height: 1.75 };
const DT = 1 / 60;

/**
 * A little world for walking about: you (a fake player that walks the way
 * player.ts does: the crowd's say first, then walls), people, and optionally
 * a wall at x = wallX (nobody's middle gets within 0.25 m of it, the way
 * world.move keeps bodies clear of walls).
 */
function scene(people: Person[], opts: { wallX?: number; start?: [number, number] } = {}) {
  const wallX = opts.wallX ?? Infinity;
  const clampX = (x: number, r: number) => Math.min(x, wallX - r);
  const world = {
    move: (x: number, z: number, dx: number, dz: number, r = 0.25) => [clampX(x + dx, r), z + dz] as [number, number],
    isFree: (x: number, _z: number, r = 0.25) => x <= wallX - r,
  };
  const feet = new THREE.Vector3(...[opts.start?.[0] ?? 0, 0, opts.start?.[1] ?? 0]);
  const player = {
    feet: () => feet.clone(),
    inXR: false,
    speed: 0,
    seated: null,
    bodies: null as null | ((x: number, z: number, dx: number, dz: number, out: { dx: number; dz: number }) => void),
  };
  const crowd = { people, now: 0 };
  const voiced: { line: boolean; k: number }[] = [];
  let silent = 0;
  const bodies = new Bodies({
    crowd: crowd as never,
    world: world as never,
    player: player as never,
    hands: { hands: [] } as never,
    onBump: (_p, k, say) => (say === 'none' ? silent++ : voiced.push({ line: say === 'line', k })),
  });
  const out = { dx: 0, dz: 0 };
  /** One frame of walking (dir: unit vector, speed m/s; 0 = standing). */
  const frame = (dirX: number, dirZ: number, speed: number) => {
    player.speed = speed;
    if (speed > 0) {
      player.bodies!(feet.x, feet.z, dirX * speed * DT, dirZ * speed * DT, out);
      const [nx, nz] = world.move(feet.x, feet.z, out.dx, out.dz, 0.25);
      feet.x = nx;
      feet.z = nz;
    }
    crowd.now += DT;
    bodies.update(DT);
  };
  return { feet, frame, bodies, voiced, crowd };
}

/** A packed block of standing people: cols × rows, `gap` metres apart, from (x0, z0). */
function grid(cols: number, rows: number, gap: number, x0: number, z0: number) {
  const out: Person[] = [];
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const p = new Person('watch', look);
      p.pos.set(x0 + i * gap, 0, z0 + j * gap + (i % 2 ? gap / 2 : 0));
      out.push(p);
    }
  return out;
}

describe('people make way', () => {
  it('step aside, perpendicular to your way, toward the side they were on, then back, then the other side', () => {
    const d = yieldDirs(1, 0, 1, 0.1, new Float32Array(6));
    // Aside toward +z (their side), a little ahead.
    expect(d[1]).toBeGreaterThan(0.9);
    expect(d[0]).toBeGreaterThan(0);
    // Then straight back along your way.
    expect(d[2]).toBeCloseTo(1);
    // Then the other side.
    expect(d[5]).toBeLessThan(-0.9);
  });

  it('someone you walk into steps out of your path, at a walk (not a teleport)', () => {
    const p = new Person('watch', look);
    p.pos.set(0.55, 0, 0.05);
    const w = scene([p]);
    let maxStep = 0,
      maxZ = 0;
    let last = p.pos.clone();
    for (let i = 0; i < 90; i++) {
      w.frame(1, 0, 1.4);
      maxStep = Math.max(maxStep, p.pos.distanceTo(last));
      maxZ = Math.max(maxZ, p.pos.z);
      last = p.pos.clone();
    }
    // You got past (1.5 s at a walk: well beyond where they stood)...
    expect(w.feet.x).toBeGreaterThan(1.2);
    // ...because they stepped aside, to their side of your line (a good step, and you barely swerved)...
    expect(maxZ).toBeGreaterThan(0.4);
    expect(Math.abs(w.feet.z)).toBeLessThan(0.05);
    expect(maxStep).toBeLessThan(0.05);
    expect(w.bodies.yieldStats.yields).toBeGreaterThan(0);
    // ...and once you're by, they step back to where they stood.
    for (let i = 0; i < 240; i++) w.frame(1, 0, 0);
    expect(Math.hypot(p.pos.x - 0.55, p.pos.z - 0.05)).toBeLessThan(0.05);
  });

  it('a player walking into a packed crowd makes steady progress through it', () => {
    // 8 deep, 9 wide, 0.6 m apart (0.1 m between shoulders): a concert crowd.
    const people = grid(8, 9, 0.6, 1, -2.4);
    const w = scene(people, { start: [0, 0] });
    const xs: number[] = [];
    for (let i = 0; i < 60 * 14; i++) {
      w.frame(1, 0, 1.4);
      if (i % 60 === 59) xs.push(w.feet.x);
    }
    // Through and out the far side (the crowd ends at x ≈ 5.2) within 14 s...
    expect(w.feet.x).toBeGreaterThan(6);
    // ...and never stalled for long: every second you got somewhere until you were through.
    for (let k = 1; k < xs.length && xs[k - 1] < 6; k++) expect(xs[k] - xs[k - 1]).toBeGreaterThan(0.15);
    // Slower than open floor (1.4 m/s).
    const t = xs.findIndex((x) => x > 5.5);
    expect(t).toBeGreaterThan(3);
    // Nobody ends up inside anybody (much).
    let worst = 0;
    for (let i = 0; i < people.length; i++)
      for (let j = i + 1; j < people.length; j++) worst = Math.max(worst, 2 * BODY_R - people[i].pos.distanceTo(people[j].pos));
    expect(worst).toBeLessThan(0.1);
  });

  it('only a line now and then across the whole crowd while you squeeze through, gasps otherwise', () => {
    const people = grid(8, 9, 0.6, 1, -2.4);
    const w = scene(people);
    for (let i = 0; i < 60 * 10; i++) w.frame(1, 0, 1.4);
    const lines = w.voiced.filter((v) => v.line).length;
    expect(w.bodies.yieldStats.yields).toBeGreaterThan(8);
    expect(lines).toBeGreaterThan(0);
    expect(lines).toBeLessThanOrEqual(Math.ceil(10 / LINE_GAP));
    // Never more than about a gasp a second, and they're gasps (light), not lines.
    expect(w.voiced.length).toBeLessThanOrEqual(16);
    for (const v of w.voiced.filter((v) => !v.line)) expect(v.k).toBeLessThanOrEqual(0.2);
  });
});

describe('never stuck', () => {
  it('counts you wedged only after trying and getting nowhere for a while, touching people', () => {
    const w = new Wedge();
    const want = 1.4 / 60;
    // Getting through fine: never wedged.
    for (let i = 0; i < 120; i++) w.update(DT, want, want * 0.6, true);
    expect(w.squeeze).toBe(0);
    // Stuck, but not touching anyone (a wall): not a crowd wedge.
    for (let i = 0; i < 120; i++) w.update(DT, want, 0, false);
    expect(w.squeeze).toBe(0);
    // Stuck against people: not yet at first...
    for (let i = 0; i < Math.floor((WEDGE_T - 0.1) * 60); i++) w.update(DT, want, 0, true);
    expect(w.wedged).toBe(false);
    expect(w.squeeze).toBe(0);
    // ...then wedged, and the crowd gives.
    for (let i = 0; i < 30; i++) w.update(DT, want, 0, true);
    expect(w.wedged).toBe(true);
    expect(w.squeeze).toBeGreaterThan(0.5);
    // Squeezing through (moving again, still touching): it holds.
    for (let i = 0; i < 60; i++) w.update(DT, want, want * 0.5, true);
    expect(w.squeeze).toBeGreaterThan(0.5);
    // Out the other side: it eases off.
    for (let i = 0; i < 60; i++) w.update(DT, want, want, false);
    expect(w.squeeze).toBe(0);
  });

  it('squeezing lets you sink into people a little and push on, which plain contact never does', () => {
    const press = new Float32Array(1);
    const out = { dx: 0, dz: 0 };
    stepAgainst(0, 0, 0.02, 0, 0.25, [0.5, 0, BODY_R], 1, press, out);
    expect(out.dx).toBeLessThanOrEqual(1e-9);
    stepAgainst(0, 0, 0.02, 0, 0.25, [0.5, 0, BODY_R], 1, press, out, 0.85, 0.14, 0.55);
    expect(out.dx).toBeGreaterThan(0.005);
  });

  it('wedged between people that cannot move away (backs to a wall), you still get through between them', () => {
    // A row of people with their backs to a wall just past them, and you walking along the row's line into them.
    const people = grid(1, 6, 0.55, 1, -1.4);
    const w = scene(people, { start: [0, 0] });
    for (let i = 0; i < 60 * 8; i++) w.frame(1, 0, 1.4);
    expect(w.feet.x).toBeGreaterThan(1.5);
  });

  it('walls stay solid, however wedged you are', () => {
    // A crowd pressed against a wall at x = 3, and you pushing into it toward the wall.
    const people = grid(4, 7, 0.6, 0.9, -1.8);
    const w = scene(people, { wallX: 3 });
    let maxX = -Infinity;
    for (let i = 0; i < 60 * 12; i++) {
      w.frame(1, 0, 1.4);
      maxX = Math.max(maxX, w.feet.x);
      for (const p of people) expect(p.pos.x).toBeLessThanOrEqual(3 - 0.22 + 1e-6);
    }
    expect(maxX).toBeLessThanOrEqual(3 - 0.25 + 1e-6);
  });
});

describe('hand pushes', () => {
  it('move someone a full step back', () => {
    expect(handShove(0.5)).toBeGreaterThanOrEqual(0.35);
    expect(handShove(1)).toBeGreaterThanOrEqual(YIELD_STEP * 0.95);
    expect(handShove(10)).toBeLessThanOrEqual(0.6);
  });
});

describe('her audience after you pass', () => {
  it('stays pushed aside while you are there, then drifts back to their places', () => {
    const dancers = Array.from({ length: 4 }, (_, k) => {
      const p = new Person('watch', look);
      p.pos.set(48 + k, 0, -29.5);
      p.homeYaw = Math.PI;
      return p;
    });
    const a = new Audience(dancers, [], () => true, Math.PI);
    const her = new THREE.Vector3(STAGE.spot.x, STAGE.y, STAGE.spot.z);
    const t = { into: 120, since: Infinity };
    a.update(DT, t, her);
    const p = dancers[0];
    expect(p.placed).toBe(true);
    const spot = p.pos.clone();
    // You push them 0.5 m aside (bodies.ts moves them), standing right by their spot.
    const you = spot.clone().add(new THREE.Vector3(0, 0, 0.3));
    for (let i = 0; i < 10; i++) {
      p.pos.x += 0.05;
      a.update(DT, t, her, you);
    }
    expect(p.pos.x - spot.x).toBeCloseTo(0.5, 2);
    // You're still there: they stay put.
    for (let i = 0; i < 60; i++) a.update(DT, t, her, you);
    expect(p.pos.x - spot.x).toBeCloseTo(0.5, 2);
    // You've gone: they stroll back over a couple of seconds.
    const far = new THREE.Vector3(0, 0, 0);
    a.update(DT, t, her, far);
    expect(p.pos.x - spot.x).toBeLessThan(0.5);
    expect(p.pos.x - spot.x).toBeGreaterThan(0.48);
    for (let i = 0; i < 60 * 3; i++) a.update(DT, t, her, far);
    expect(p.pos.distanceTo(spot)).toBeLessThan(1e-3);
  });
});
