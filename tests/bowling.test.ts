import { describe, expect, it } from 'vitest';
import { frames, framesDone, gameOver, LaneGame, pinsUp, position, rackFor, runningTotal, total } from '../src/client/bowling/score';
import { BALL_R, DECK_END, HEAD_Z, LaneSim, LANE_HALF, SPOTS, type Launch } from '../src/client/bowling/sim';
import { ballSpeed, launchFromHand, launchFromMeter, meterPower, THROW } from '../src/client/bowling/throw';
import { FOUL_X, laneAt, laneZ, LANES, onBowling, RETURNS, toLane, toWorld } from '../src/client/bowling/plan';
import { onEntrance } from '../src/client/areas/entranceplan';
import { onPromenade } from '../src/client/areas/promenadeplan';

const rep = (n: number, v: number) => Array.from({ length: n }, () => v);

describe('ten-pin scoring', () => {
  it('a perfect game is 300 (twelve strikes)', () => {
    const r = rep(12, 10);
    expect(total(r)).toBe(300);
    expect(gameOver(r)).toBe(true);
    const f = frames(r);
    expect(f).toHaveLength(10);
    expect(f.map((x) => x.total)).toEqual([30, 60, 90, 120, 150, 180, 210, 240, 270, 300]);
    expect(f[9].marks).toEqual(['X', 'X', 'X']);
    expect(f[0].marks).toEqual(['', 'X']);
  });

  it('a gutter game is 0, all nines is 90, all 5-spares is 150', () => {
    expect(total(rep(20, 0))).toBe(0);
    expect(gameOver(rep(20, 0))).toBe(true);
    expect(frames(rep(20, 0))[0].marks).toEqual(['-', '-']);
    expect(total(rep(10, 0).flatMap(() => [9, 0]))).toBe(90);
    const spares = rep(21, 5);
    expect(total(spares)).toBe(150);
    expect(gameOver(spares)).toBe(true);
    expect(frames(spares)[3].marks).toEqual(['5', '/']);
    expect(frames(spares)[9].marks).toEqual(['5', '/', '5']);
  });

  it('strike and spare bonuses wait for their balls', () => {
    expect(frames([10]).map((f) => f.total)).toEqual([null]);
    expect(frames([10, 3]).map((f) => f.total)).toEqual([null, null]);
    expect(frames([10, 3, 4]).map((f) => f.total)).toEqual([17, 24]);
    expect(frames([7, 3]).map((f) => f.total)).toEqual([null]);
    expect(frames([7, 3, 6]).map((f) => f.total)).toEqual([16, null]);
    expect(frames([7, 3, 6, 2]).map((f) => f.total)).toEqual([16, 24]);
    // A strike after a strike after a strike (a turkey) waits for two more balls.
    expect(frames([10, 10, 10]).map((f) => f.total)).toEqual([30, null, null]);
    expect(runningTotal([10, 10])).toBe(30);
    expect(total([10, 10])).toBe(0);
  });

  it('the tenth frame: a third ball only after a strike or a spare', () => {
    const nine = rep(18, 0);
    // Open tenth: two balls and done.
    expect(gameOver([...nine, 3, 4])).toBe(true);
    expect(total([...nine, 3, 4])).toBe(7);
    // Spare: one bonus ball.
    expect(gameOver([...nine, 3, 7])).toBe(false);
    expect(rackFor([...nine, 3, 7])).toBe('full');
    expect(total([...nine, 3, 7, 5])).toBe(15);
    expect(frames([...nine, 3, 7, 10])[9].marks).toEqual(['3', '/', 'X']);
    // Strike: two bonus balls on fresh racks, then the leftover.
    expect(rackFor([...nine, 10])).toBe('full');
    expect(rackFor([...nine, 10, 10])).toBe('full');
    expect(rackFor([...nine, 10, 6])).toBe('leftover');
    expect(pinsUp([...nine, 10, 6])).toBe(4);
    expect(frames([...nine, 10, 6, 4])[9].marks).toEqual(['X', '6', '/']);
    expect(frames([...nine, 10, 10, 7])[9].marks).toEqual(['X', 'X', '7']);
    expect(total([...nine, 10, 6, 4])).toBe(20);
    expect(gameOver([...nine, 10, 6, 4])).toBe(true);
    expect(rackFor([...nine, 10, 6, 4])).toBe('done');
    // A strike in the ninth takes its bonus from the tenth's first two balls.
    expect(total([...rep(16, 0), 10, 10, 10, 10])).toBe(30 + 30);
  });

  it('the rack between balls: leftover after a first ball, fresh after a strike or a full frame', () => {
    expect(rackFor([])).toBe('full');
    expect(rackFor([7])).toBe('leftover');
    expect(pinsUp([7])).toBe(3);
    expect(rackFor([7, 2])).toBe('full');
    expect(rackFor([10])).toBe('full');
    expect(position([10, 7])).toEqual({ frame: 1, ball: 1 });
    expect(position([])).toEqual({ frame: 0, ball: 0 });
    expect(framesDone([10, 7, 2, 3])).toBe(2);
  });

  it('fouls score 0 and show F (a foul on a first ball leaves all ten for the second)', () => {
    const g = new LaneGame();
    g.join('a', 'Ann');
    expect(g.roll('a', 8, true)?.kind).toBe('foul');
    expect(pinsUp(g.players[0].rolls)).toBe(10);
    expect(g.roll('a', 10)?.kind).toBe('spare');
    const f = frames(g.players[0].rolls, g.players[0].fouls);
    expect(f[0].marks).toEqual(['F', '/']);
    expect(g.roll('a', 4)?.kind).toBe('open');
    expect(total(g.players[0].rolls)).toBe(14);
  });
});

describe('a lane of friends', () => {
  it('takes turns a frame each, strikes moving play on after one ball', () => {
    const g = new LaneGame();
    expect(g.join('a', 'Ann')).toBe(true);
    expect(g.join('b', 'Bo')).toBe(true);
    expect(g.current?.id).toBe('a');
    expect(g.roll('b', 5)).toBeNull(); // not Bo's ball
    expect(g.roll('a', 10)?.kind).toBe('strike');
    expect(g.current?.id).toBe('b');
    expect(g.roll('b', 3)?.kind).toBe('open');
    expect(g.current?.id).toBe('b');
    expect(g.roll('b', 7)?.kind).toBe('spare');
    expect(g.current?.id).toBe('a');
    expect(g.roll('a', 10)?.kind).toBe('double');
    g.roll('b', 0);
    g.roll('b', 0);
    expect(g.roll('a', 10)?.kind).toBe('turkey');
  });

  it('seats four at most, finishes, and starts over when someone new walks up', () => {
    const g = new LaneGame();
    for (const id of ['a', 'b', 'c', 'd']) expect(g.join(id, id)).toBe(true);
    expect(g.join('e', 'e')).toBe(false);
    for (let i = 0; i < 12 * 4; i++) {
      const p = g.current;
      if (!p) break;
      g.roll(p.id, 10);
    }
    expect(g.over).toBe(true);
    expect(g.players.map((p) => total(p.rolls))).toEqual([300, 300, 300, 300]);
    g.leave('d');
    expect(g.join('e', 'Eve')).toBe(true);
    expect(g.over).toBe(false);
    expect(g.players.every((p) => p.rolls.length === 0)).toBe(true);
    expect(g.balls).toBe(0);
  });
});

/** Runs a throw to the end; returns the sim. */
function bowl(l: Launch, lb = 14): LaneSim {
  const s = new LaneSim();
  s.setBallMass(lb * 0.4536);
  s.launch(l);
  for (let i = 0; i < 300 * 25 && !s.settled; i++) s.steps(1);
  return s;
}
const straight = (x: number, vz = 8, wz = 0): Launch => ({ x, y: BALL_R, z: 0.3, vx: 0, vy: 0, vz, wx: (0.25 * vz) / BALL_R, wy: 0, wz });
const downCount = (m: number) => 10 - [...Array(10).keys()].filter((p) => (m >> p) & 1).length;

describe('pin physics', () => {
  it('a full rack stands still on its own (no wobble, no creep)', () => {
    const s = new LaneSim();
    s.steps(300 * 10);
    expect(s.standingMask()).toBe(0x3ff);
    for (let p = 0; p < 10; p++) {
      expect(s.pos[3 * (p + 1)]).toBeCloseTo(SPOTS[p][0], 6);
      expect(s.pos[3 * (p + 1) + 2]).toBeCloseTo(SPOTS[p][1], 6);
    }
  });

  it('is deterministic: the same throw gives the same pins, whatever the frame rate', () => {
    const l = straight(-0.07, 7.6, -6);
    const a = bowl(l);
    const b = bowl(l);
    expect(Array.from(a.pos)).toEqual(Array.from(b.pos));
    expect(Array.from(a.quat)).toEqual(Array.from(b.quat));
    // Stepped by uneven frames (72 Hz, then a stutter, then 30 Hz) instead of whole steps.
    const c = new LaneSim();
    c.setBallMass(14 * 0.4536);
    c.launch(l);
    const dts = [1 / 72, 1 / 72, 0.031, 1 / 30, 1 / 90];
    for (let i = 0; c.time + 0.05 < a.time; i++) c.step(dts[i % dts.length]);
    while (c.time < a.time - 1e-9) c.steps(1);
    expect(c.time).toBeCloseTo(a.time, 9);
    expect(Array.from(c.pos)).toEqual(Array.from(a.pos));
    expect(c.standingMask()).toBe(a.standingMask());
  });

  it('a ball in the pocket scatters the rack (pins topple, collide and fly)', () => {
    const s = bowl(straight(-0.06));
    expect(downCount(s.standingMask())).toBeGreaterThanOrEqual(9);
    expect(s.impactCount).toBeGreaterThan(20);
    // Some pins ended in the pit, some lie on the deck.
    let pit = 0;
    for (let i = 1; i <= 10; i++) if (s.pos[3 * i + 2] > DECK_END || s.pos[3 * i + 1] < 0) pit++;
    expect(pit).toBeGreaterThan(2);
    expect(s.settled).toBe(true);
  });

  it('a gutter ball touches nothing; a slow straight ball still knocks pins down', () => {
    const g = bowl({ ...straight(0.42), vx: 0.12 });
    expect(g.gutterSide).toBe(1);
    expect(g.standingMask()).toBe(0x3ff);
    expect(g.ballTouched).toBe(false);
    const slow = bowl(straight(0.0, 3.2));
    expect(downCount(slow.standingMask())).toBeGreaterThan(0);
  });

  it('side spin hooks: it skids straight on the oil, then curves on the dry back end', () => {
    const path = (wz: number) => {
      const s = new LaneSim();
      s.launch(straight(-0.3, 8, wz));
      const xs: number[] = [];
      for (let z = 6; z <= 18; z += 6) {
        while (s.pos[2] < z && s.time < 10) s.steps(1);
        xs.push(s.pos[0]);
      }
      return xs;
    };
    const flat = path(0);
    const hook = path(-12);
    expect(Math.abs(flat[2] - flat[0])).toBeLessThan(0.01);
    // Barely moves by 6 m, moves most after the oil (12 m on).
    expect(hook[0] - -0.3).toBeLessThan(0.08);
    expect(hook[2] - hook[1]).toBeGreaterThan(hook[1] - hook[0]);
    expect(hook[2]).toBeGreaterThan(-0.05);
    // The other way round for a left-hander.
    expect(path(12)[2]).toBeLessThan(-0.5);
  });

  it('the pinsetter respots the pins left standing where they stand', () => {
    const s = bowl(straight(0.2, 7));
    const m = s.standingMask();
    expect(m).not.toBe(0x3ff);
    expect(m).not.toBe(0);
    s.respot(m);
    s.clearBall();
    s.steps(300 * 3);
    expect(s.standingMask()).toBe(m);
  });
});

describe('from a swing to a ball', () => {
  it('a gentle swing is not a throw; a real one rolls faster than the hand', () => {
    expect(launchFromHand({ x: 0, y: 0.3, z: -0.2, vx: 0, vy: 0, vz: 0.3, twist: 0 })).toBeNull();
    const l = launchFromHand({ x: 0.1, y: 0.25, z: -0.2, vx: 0, vy: -0.5, vz: 4, twist: 0 })!;
    expect(l.vz).toBeCloseTo(ballSpeed(4));
    expect(l.vz).toBeGreaterThan(4);
    expect(l.vz).toBeLessThanOrEqual(THROW.maxSpeed);
    expect(ballSpeed(20)).toBe(THROW.maxSpeed);
    expect(l.wz).toBe(0);
    expect(l.wx).toBeGreaterThan(0);
  });

  it('keeps the ball on the lane: released over the gutter, swung wildly sideways', () => {
    const l = launchFromHand({ x: 0.9, y: 0.4, z: 0, vx: 3, vy: 0, vz: 5, twist: 0 })!;
    expect(Math.abs(l.x)).toBeLessThan(LANE_HALF - BALL_R);
    const xAtHead = l.x + (l.vx / l.vz) * (HEAD_Z - l.z);
    expect(Math.abs(xAtHead)).toBeLessThanOrEqual(LANE_HALF);
  });

  it("the wrist's twist and the hand's sweep give hook spin, capped", () => {
    const right = launchFromHand({ x: -0.2, y: 0.2, z: -0.1, vx: 0, vy: 0, vz: 4.5, twist: -6 })!;
    expect(right.wz).toBeLessThan(0); // a right-hander's turn hooks left (+x)
    const sweep = launchFromHand({ x: -0.2, y: 0.2, z: -0.1, vx: 0.8, vy: 0, vz: 4.5, twist: 0 })!;
    expect(sweep.wz).toBeLessThan(0);
    const wild = launchFromHand({ x: 0, y: 0.2, z: 0, vx: 0, vy: 0, vz: 4.5, twist: 80 })!;
    expect(wild.wz).toBe(THROW.maxSpin);
    // And it hooks into the pocket on a real lane.
    const s = bowl(launchFromHand({ x: -0.3, y: 0.2, z: -0.2, vx: 0.05, vy: 0, vz: 5.2, twist: -5 })!);
    expect(s.pos[0]).toBeGreaterThan(-0.3);
  });

  it('a screen throw: the meter swings up and back; power, aim and twist map to the ball', () => {
    expect(meterPower(0)).toBe(0);
    expect(meterPower(1.1)).toBeCloseTo(1);
    expect(meterPower(0.55)).toBeGreaterThan(0.6);
    expect(meterPower(2.2)).toBeCloseTo(0, 5);
    const soft = launchFromMeter({ x: 0, aim: 0, power: 0, spin: 0 });
    const hard = launchFromMeter({ x: 0, aim: 0, power: 1, spin: 0 });
    expect(hard.vz).toBeGreaterThan(soft.vz);
    expect(launchFromMeter({ x: 0, aim: 0, power: 1, spin: 1 }).wz).toBeLessThan(0);
    // A good screen throw strikes: from right of centre, angled into the 1-3 pocket.
    const s = bowl(launchFromMeter({ x: -0.06, aim: 0, power: 0.75, spin: 0 }));
    expect(downCount(s.standingMask())).toBeGreaterThanOrEqual(9);
  });
});

describe('Palazzo Lanes layout', () => {
  it('is its own place, far from every other area', () => {
    expect(onBowling(FOUL_X)).toBe(true);
    expect(onBowling(0)).toBe(false);
    expect(onPromenade(FOUL_X)).toBe(false);
    expect(onEntrance(FOUL_X)).toBe(false);
    expect(onBowling(-600)).toBe(false);
  });

  it('maps between the world and each lane', () => {
    for (let i = 0; i < LANES; i++) {
      expect(laneAt(laneZ(i))).toBe(i);
      const w = toWorld(i, 0.2, 5);
      expect(w.X).toBeCloseTo(FOUL_X - 5);
      const l = toLane(i, w.X, w.Z);
      expect(l.x).toBeCloseTo(0.2);
      expect(l.z).toBeCloseTo(5);
    }
    expect(laneAt(100)).toBe(-1);
    expect(RETURNS.flatMap((r) => r.lanes)).toEqual([...Array(LANES).keys()]);
  });
});
