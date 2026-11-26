import { describe, expect, it } from 'vitest';
import { blankInput, blankPad, EdgeTracker, Rng, type Game, type Input } from '../src/client/arcade/types';
import { cleanInitials, defaultTable, InitialsEntry, insertScore, packTable, qualifies, rankOf, ScoreBook, TABLE_SIZE, unpackTable } from '../src/client/arcade/scores';
import { Machine } from '../src/client/arcade/machine';
import { packPad, unpackPad, cleanSnap, friendNear } from '../src/client/arcade/net';
import { Sentinel } from '../src/client/arcade/games/sentinel';
import { clearPoints, COLS, CRACKED, crackAround, EMPTY, findGroups, Prism, riseRock, ROCK, ROWS, settle } from '../src/client/arcade/games/prism';
import { bounceBox, LEVELS, Rake, rakeBounce } from '../src/client/arcade/games/rake';
import { checkpointBonus, curveAt, Strip } from '../src/client/arcade/games/strip';
import { buildChart, comboMult, GOOD, judge, PERFECT, SETS, Velvet } from '../src/client/arcade/games/velvet';
import { paddleBounce, Splash, WIN_AT } from '../src/client/arcade/games/splash';
import { floorAt, HOOP, newHoopBall, shotVelocity, stepHoopBall } from '../src/client/arcade/hoopphys';
import { aiTarget, clampMallet, collide, RINK, stepRink, type Mallet, type Puck } from '../src/client/arcade/hockeyphys';
import { CLAW, dropDepth, grabChance, makePile, overChute, prizeUnder, stepBody } from '../src/client/arcade/clawlogic';
import { basketPoints, meterAt } from '../src/client/arcade/hoops';

/** Runs a game for `secs` with an input function. */
function run(g: Game, secs: number, input: (i: Input, s: number) => void, p2: Input = blankInput()) {
  const p = blankInput();
  const steps = Math.round(secs * 60);
  for (let s = 0; s < steps && !g.over; s++) {
    const prevA = p.a;
    input(p, s);
    p.ap = p.a && !prevA;
    g.step(p, p2);
  }
}

describe('arcade: controls', () => {
  it('turns raw pads into inputs with press edges and stick edges', () => {
    const e = new EdgeTracker();
    const raw = blankPad();
    const inp = blankInput();
    raw.a = true;
    e.apply(raw, inp);
    expect(inp.ap).toBe(true);
    e.apply(raw, inp);
    expect(inp.ap).toBe(false);
    expect(inp.a).toBe(true);
    raw.y = 0.9;
    e.apply(raw, inp);
    expect(inp.dy).toBe(1);
    e.apply(raw, inp);
    expect(inp.dy).toBe(0);
    // Held: it repeats after a delay.
    let repeats = 0;
    for (let i = 0; i < 60; i++) {
      e.apply(raw, inp);
      if (inp.dy) repeats++;
    }
    expect(repeats).toBeGreaterThan(2);
    // A wobble around the threshold doesn't re-trigger (hysteresis).
    raw.y = 0.45;
    e.apply(raw, inp);
    expect(inp.dy).toBe(0);
  });

  it('packs a pad into one number and back', () => {
    const p = { x: -1, y: 0.5, a: true, b: false, c: true };
    const q = unpackPad(packPad(p), blankPad());
    expect(q.x).toBeCloseTo(-1, 5);
    expect(q.y).toBeCloseTo(4 / 7, 5);
    expect([q.a, q.b, q.c]).toEqual([true, false, true]);
    expect(cleanSnap([1, 'x', NaN, 3])).toEqual([1, 0, 0, 3]);
    expect(cleanSnap('nope')).toBeNull();
    expect(friendNear({ id: 'a', name: 'A', state: { x: 1, z: 1 } }, 0, 0, 2)).toBe(true);
    expect(friendNear({ id: 'a', name: 'A', state: { x: 9, z: 1 } }, 0, 0, 2)).toBe(false);
  });
});

describe('arcade: high scores', () => {
  it('keeps the table sorted, capped at ten, ties below', () => {
    const t = defaultTable(10000);
    expect(t).toHaveLength(TABLE_SIZE);
    expect(qualifies(t, t[9].s)).toBe(false);
    expect(qualifies(t, t[9].s + 1)).toBe(true);
    expect(rankOf(t, t[0].s)).toBe(1);
    expect(insertScore(t, 'abc', 999999)).toBe(0);
    expect(t[0]).toEqual({ n: 'ABC', s: 999999 });
    expect(t).toHaveLength(TABLE_SIZE);
    expect(insertScore(t, 'zzz', 1)).toBe(-1);
    for (let i = 1; i < t.length; i++) expect(t[i - 1].s).toBeGreaterThanOrEqual(t[i].s);
  });

  it('cleans initials and round-trips the wire form', () => {
    expect(cleanInitials('a<b')).toBe('A B');
    expect(cleanInitials('')).toBe('   ');
    const t = defaultTable(500);
    expect(unpackTable(packTable(t))).toEqual(t);
    expect(unpackTable([1, 2, 3])).toBeTruthy();
    expect(unpackTable(['AAA', -5])).toBeNull();
  });

  it('enters initials with the stick: up steps the letter, A moves on', () => {
    const e = new InitialsEntry('AAA');
    e.input(0, 1, false, false);
    e.input(0, 1, false, false);
    expect(e.text).toBe('CAA');
    e.input(0, 0, true, false);
    e.input(0, -1, false, false);
    expect(e.text).toBe('CBA');
    e.input(0, 0, false, true);
    expect(e.pos).toBe(0);
    e.input(1, 0, false, false);
    e.input(1, 0, false, false);
    e.input(0, 0, true, false);
    expect(e.done).toBe(true);
  });

  it('a score book persists per game', () => {
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const b = new ScoreBook('k', s);
    expect(b.add('g', 'MAX', 123456, 1000)).toBe(0);
    const b2 = new ScoreBook('k', s);
    expect(b2.table('g')[0]).toEqual({ n: 'MAX', s: 123456 });
  });
});

describe('arcade: the cabinet frame', () => {
  it('coin, play, game over, initials, table', () => {
    const g = new Sentinel();
    const table = defaultTable(100);
    let paid = 0;
    const m = new Machine(g, { coin: () => (paid++, true), table: () => table, submit: (n, s) => insertScore(table, n, s), sfx: () => {} });
    expect(m.mode).toBe('attract');
    m.pad1.a = true;
    m.update(1 / 60);
    expect(paid).toBe(1);
    expect(m.mode).toBe('play');
    m.pad1.a = false;
    // Lose: let everything through.
    for (let i = 0; i < 60 * 600 && m.mode === 'play'; i++) m.update(1 / 60);
    expect(m.mode).toBe('over');
    expect(g.score).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 60 * 3; i++) m.update(1 / 60);
    // Any score beats a table topped at 100? The house table here is tiny; if it made it, enter initials.
    if (m.mode === 'initials') {
      for (let k = 0; k < 3; k++) {
        m.pad1.a = true;
        m.update(1 / 60);
        m.pad1.a = false;
        m.update(1 / 60);
      }
      expect(m.mode).toBe('scores');
      expect(table.some((e) => e.n === 'AAA')).toBe(true);
    } else expect(m.mode).toBe('scores');
  });

  it("won't start without the money", () => {
    const m = new Machine(new Prism(), { coin: () => false, table: () => [], submit: () => {}, sfx: () => {} });
    expect(m.insertCoin()).toBe(false);
    expect(m.mode).toBe('attract');
  });

  it("mirrors a friend's game from snapshots", () => {
    const a = new Rake();
    a.start(1, 5);
    run(a, 3, (p, s) => ((p.a = s % 30 === 0), (p.x = Math.sin(s / 20))));
    const snap: number[] = [];
    const mA = new Machine(a, { coin: () => true, table: () => [], submit: () => {}, sfx: () => {} });
    mA.mode = 'play';
    expect(mA.snapshot(snap)).toBe('play');
    const b = new Rake();
    const mB = new Machine(b, { coin: () => true, table: () => [], submit: () => {}, sfx: () => {} });
    mB.mirror('Rocco', 'play', snap);
    expect(mB.mode).toBe('mirror');
    expect(b.score).toBe(a.score);
    // Goes back to attract when the friend stops sending.
    for (let i = 0; i < 200; i++) mB.update(1 / 60);
    expect(mB.mode).toBe('attract');
  });
});

/** Every game's snapshot loads into a fresh copy and snaps back the same. */
describe('arcade: snapshots round-trip', () => {
  const makers: [string, () => Game][] = [
    ['sentinel', () => new Sentinel()],
    ['prism', () => new Prism()],
    ['rake', () => new Rake()],
    ['strip', () => new Strip()],
    ['velvet', () => new Velvet()],
    ['splash', () => new Splash()],
  ];
  for (const [id, make] of makers)
    it(id, () => {
      const g = make();
      g.start(1, 11);
      run(g, 6, (p, s) => ((p.a = s % 20 < 10), (p.x = Math.sin(s / 30)), (p.y = Math.cos(s / 40))));
      const a: number[] = [];
      g.snap(a);
      expect(a.length).toBeLessThan(400);
      expect(a.every((v) => Number.isFinite(v))).toBe(true);
      const h = make();
      h.start(1, 99);
      h.load(a);
      const b: number[] = [];
      h.snap(b);
      expect(b).toEqual(a);
      // Small on the wire.
      expect(JSON.stringify(a).length).toBeLessThan(1500);
    });
});

describe('Neon Sentinel', () => {
  it('bolts hit drones and score with the chain', () => {
    const g = new Sentinel();
    g.start(1, 3);
    // Skip the wave banner, then put a dart right above the Warden.
    run(g, 2.3, () => {});
    g.dAlive.fill(0);
    const i = g.spawn(0, 160, 120);
    expect(i).toBeGreaterThanOrEqual(0);
    const before = g.score;
    // Follow it and fire.
    run(g, 2, (p) => ((p.a = true), (p.x = Math.max(-1, Math.min(1, (g.dx[i] - (g as unknown as { px: number }).px) / 6)))));
    expect(g.dAlive[i]).toBe(0);
    expect(g.score).toBeGreaterThan(before);
  });

  it('drones reaching the bottom break beacons, and losing them all ends it', () => {
    const g = new Sentinel();
    g.start(1, 4);
    run(g, 2.3, () => {});
    let guard = 0;
    while (!g.over && guard++ < 50) {
      g.dAlive.fill(0);
      // A dart right over a standing beacon, just above the floor.
      const b = g.beacons.findIndex((h) => h > 0);
      g.spawn(0, [60, 160, 260][b], 224);
      run(g, 0.2, () => {});
    }
    expect(g.over).toBe(true);
    expect(g.beacons).toEqual([0, 0, 0]);
  });

  it('waves come and the difficulty climbs', () => {
    const g = new Sentinel();
    g.start(1, 5);
    // A perfect gunner (drones vanish): waves advance.
    for (let s = 0; s < 60 * 40; s++) {
      g.dAlive.fill(0);
      g.step(blankInput());
    }
    expect(g.wave).toBeGreaterThan(2);
    expect(g.level).toBe(g.wave);
  });
});

describe('Prism Drop', () => {
  const B = (rows: string[]) => {
    const b = new Int8Array(COLS * ROWS);
    const off = ROWS - rows.length;
    rows.forEach((r, y) => [...r].forEach((ch, x) => (b[(y + off) * COLS + x] = ch === '.' ? 0 : ch === 'R' ? ROCK : Number(ch))));
    return b;
  };
  it('finds groups of four or more (rocks never match)', () => {
    const b = B(['11....', '11....', 'RR2222']);
    const g = findGroups(b);
    expect(g).toHaveLength(2);
    expect(g.map((x) => x.length).sort()).toEqual([4, 4]);
    expect(findGroups(B(['111...', 'RRR...']))).toHaveLength(0);
  });
  it('settles gems into gaps', () => {
    const b = B(['1.....', '......', '2.....']);
    expect(settle(b)).toBe(true);
    expect(b[(ROWS - 1) * COLS]).toBe(2);
    expect(b[(ROWS - 2) * COLS]).toBe(1);
  });
  it('rock rises with one gap, and cracks then breaks next to clears', () => {
    const b = new Int8Array(COLS * ROWS);
    expect(riseRock(b, 2)).toBe(true);
    const bottom = [...b.slice((ROWS - 1) * COLS)];
    expect(bottom.filter((v) => v === ROCK)).toHaveLength(COLS - 1);
    expect(bottom[2]).toBe(EMPTY);
    crackAround(b, [(ROWS - 2) * COLS + 0]);
    expect(b[(ROWS - 1) * COLS]).toBe(CRACKED);
    crackAround(b, [(ROWS - 2) * COLS + 0]);
    expect(b[(ROWS - 1) * COLS]).toBe(EMPTY);
    // Overflow at the top.
    const full = new Int8Array(COLS * ROWS).fill(1);
    expect(riseRock(full, 0)).toBe(false);
  });
  it('chains pay more', () => {
    expect(clearPoints(4, 0, 1)).toBe(40);
    expect(clearPoints(4, 1, 1)).toBe(80);
    expect(clearPoints(6, 0, 2)).toBe((60 + 40) * 2);
  });
  it('a game ends when the pit fills', () => {
    const g = new Prism();
    g.start(1, 8);
    run(g, 600, (p, s) => (p.y = -1));
    expect(g.over).toBe(true);
    // Dropped straight down the middle column: about six pairs fill it.
    expect(g.pieces).toBeGreaterThan(5);
  });
});

describe('Rake & Break', () => {
  it('the layouts are all 12 wide', () => {
    for (const l of LEVELS) for (const row of l) expect(row).toHaveLength(12);
  });
  it('bounces off a box on the side it hit', () => {
    const b = { x: 9, y: 5, vx: 50, vy: 0 };
    expect(bounceBox(b, 10, 0, 30, 10)).toBe(1);
    expect(b.vx).toBeLessThan(0);
    const c = { x: 20, y: -1, vx: 0, vy: 40 };
    expect(bounceBox(c, 10, 0, 30, 10)).toBe(2);
    expect(c.vy).toBeLessThan(0);
    expect(bounceBox({ x: 0, y: 0, vx: 1, vy: 1 }, 10, 10, 20, 20)).toBe(0);
  });
  it('the rake sends the ball up, angled by where it hit', () => {
    const [vx0, vy0] = rakeBounce(0, 200);
    expect(vx0).toBeCloseTo(0);
    expect(vy0).toBeCloseTo(-200);
    const [vx1, vy1] = rakeBounce(1, 200);
    expect(vx1).toBeGreaterThan(150);
    expect(vy1).toBeLessThan(0);
    expect(Math.hypot(vx1, vy1)).toBeCloseTo(200);
  });
  it('cards flip, then break; gold never does; chips pay', () => {
    const g = new Rake();
    g.start(1, 1);
    const card = [...g.kind].findIndex((k) => k === 5);
    expect(card).toBeGreaterThanOrEqual(0);
    g.hitBrick(card, 0, 0);
    expect(g.kind[card]).toBe(5);
    g.hitBrick(card, 0, 0);
    expect(g.kind[card]).toBe(0);
    g.loadStage(2);
    const gold = [...g.kind].findIndex((k) => k === 6);
    g.hitBrick(gold, 0, 0);
    g.hitBrick(gold, 0, 0);
    expect(g.kind[gold]).toBe(6);
  });
  it('clearing a table moves on (and a missed ball costs a life)', () => {
    const g = new Rake();
    g.start(1, 2);
    for (let i = 0; i < g.kind.length; i++) if (g.kind[i] !== 6) g.kind[i] = 0;
    run(g, 0.1, () => {});
    expect(g.level).toBe(2);
    const lives = g.lives;
    run(g, 20, () => {});
    expect(g.lives).toBeLessThan(lives);
  });
});

describe('Midnight Strip', () => {
  it('drives, scores distance, and the clock ends it', () => {
    const g = new Strip();
    g.start(1, 3);
    run(g, 200, (p) => (p.x = 0));
    expect(g.over).toBe(true);
    expect(g.pos).toBeGreaterThan(500);
    expect(g.score).toBeGreaterThan(0);
  });
  it('checkpoint time shrinks but never below 14 s', () => {
    expect(checkpointBonus(1)).toBe(30);
    expect(checkpointBonus(100)).toBe(14);
  });
  it('the road curves both ways, gently', () => {
    let lo = 0,
      hi = 0;
    for (let z = 0; z < 20000; z += 10) {
      lo = Math.min(lo, curveAt(z));
      hi = Math.max(hi, curveAt(z));
    }
    expect(lo).toBeLessThan(-0.002);
    expect(hi).toBeGreaterThan(0.002);
    expect(Math.max(-lo, hi)).toBeLessThan(0.006);
  });
  it('hitting a car spins you down to a crawl', () => {
    const g = new Strip();
    g.start(1, 3);
    run(g, 8, () => {});
    const v = g.speed;
    g.carOn[0] = 1;
    g.carX[0] = g.px;
    g.carZ[0] = g.pos + 1;
    run(g, 1 / 60, () => {});
    expect(g.speed).toBeLessThan(v * 0.5);
  });
});

describe('Velvet Beat', () => {
  it('builds charts from the sets', () => {
    for (const s of SETS) {
      const c = buildChart(s);
      expect(c.length).toBeGreaterThan(30);
      for (let i = 1; i < c.length; i++) expect(c[i].beat).toBeGreaterThan(c[i - 1].beat);
      expect(c.some((n) => n.len > 0)).toBe(true);
    }
  });
  it('judges timing', () => {
    expect(judge(0)).toBe('perfect');
    expect(judge(-PERFECT)).toBe('perfect');
    expect(judge(GOOD * 0.9)).toBe('good');
    expect(judge(GOOD * 1.1)).toBeNull();
    expect(comboMult(0)).toBe(1);
    expect(comboMult(35)).toBe(4);
    expect(comboMult(99)).toBe(4);
  });
  it('a perfect drummer finishes the set; a sleeping one loses the groove', () => {
    const g = new Velvet();
    g.start(1, 1);
    const chart = buildChart(SETS[0]);
    const spb = 60 / SETS[0].song.bpm;
    let down = false;
    for (let s = 0; s < 60 * 60 && g.setIx === 0 && !g.over; s++) {
      const p = blankInput();
      const f = 1 / 60 / spb;
      const want = chart.some((n) => g.beat >= n.beat - f * 0.5 && g.beat < n.beat + n.len + f * 0.5);
      p.a = want;
      p.ap = want && !down;
      down = want;
      g.step(p);
    }
    expect(g.over).toBe(false);
    expect(g.misses).toBeLessThan(4);
    expect(g.score).toBeGreaterThan(10000);
    const h = new Velvet();
    h.start(1, 1);
    run(h, 60, () => {});
    expect(h.over).toBe(true);
  });
});

describe('Splash Rally', () => {
  it('paddle bounce heads away from the paddle', () => {
    const [vx, vy] = paddleBounce(0.5, 200, true);
    expect(vx).toBeGreaterThan(0);
    expect(vy).toBeGreaterThan(0);
    expect(Math.hypot(vx, vy)).toBeCloseTo(200);
    expect(paddleBounce(0, 100, false)[0]).toBeCloseTo(-100);
  });
  it('a player who never moves loses the match to the house', () => {
    const g = new Splash();
    g.start(1, 2);
    run(g, 300, () => {});
    expect(g.over).toBe(true);
    expect(g.s2).toBe(WIN_AT);
  });
  it('a friend can take player two (versus: no high score)', () => {
    const g = new Splash();
    g.start(1, 2);
    g.setHuman2(true);
    expect(g.versus).toBe(true);
    expect(g.s1 + g.s2).toBe(0);
    // P2 tracks the ball perfectly, P1 never moves: P2 wins.
    const p2 = blankInput();
    for (let s = 0; s < 60 * 300 && !g.over; s++) {
      p2.y = Math.max(-1, Math.min(1, -(g.by - g.p2) / 6));
      g.step(blankInput(), p2);
    }
    expect(g.over).toBe(true);
    expect(g.s2).toBe(WIN_AT);
    expect(g.score).toBe(0);
  });
});

describe('Skyline Hoops physics', () => {
  it('a ball dropped in the tray stays in the tray', () => {
    const b = newHoopBall(0, 1.2, 1.05);
    for (let i = 0; i < 180; i++) stepHoopBall(b, 1 / 60);
    expect(b.y).toBeCloseTo(HOOP.tray.y + HOOP.ballR, 2);
    expect(b.z).toBeLessThan(HOOP.tray.zLip);
  });
  it('balls on the ramp roll back down to the player', () => {
    const b = newHoopBall(0.1, floorAt(-0.5) + HOOP.ballR + 0.01, -0.5);
    for (let i = 0; i < 360; i++) stepHoopBall(b, 1 / 60);
    expect(b.z).toBeGreaterThan(HOOP.ramp.zFront - 0.2);
  });
  it('a good shot goes in; a short one misses', () => {
    let scored = 0;
    const b = newHoopBall(0, 1.4, 1.25);
    const [vx, vy, vz] = shotVelocity(b.x, b.y, b.z, HOOP.rim.x, HOOP.rim.y + 0.05, HOOP.rim.z + 0.02, 0.92);
    Object.assign(b, { vx, vy, vz });
    for (let i = 0; i < 300; i++) stepHoopBall(b, 1 / 60, (e) => e === 'score' && scored++);
    expect(scored).toBe(1);
    const c = newHoopBall(0, 1.4, 1.25);
    Object.assign(c, { vx: vx * 0.7, vy: vy * 0.7, vz: vz * 0.7 });
    let s2 = 0;
    for (let i = 0; i < 300; i++) stepHoopBall(c, 1 / 60, (e) => e === 'score' && s2++);
    expect(s2).toBe(0);
  });
  it('the desk meter peaks mid-swing; the last ten seconds pay three', () => {
    expect(meterAt(0)).toBeCloseTo(0);
    expect(meterAt(0.65)).toBeCloseTo(1);
    expect(basketPoints(30)).toBe(2);
    expect(basketPoints(5)).toBe(3);
  });
});

describe('Puck Palazzo physics', () => {
  const mallets = (): [Mallet, Mallet] => [
    { x: 0, z: 0.8, vx: 0, vz: 0 },
    { x: 0, z: -0.8, vx: 0, vz: 0 },
  ];
  it('rails bounce, goals score', () => {
    const p: Puck = { x: 0.3, z: 0, vx: 2, vz: 0 };
    stepRink(p, mallets(), 0.3);
    expect(p.vx).toBeLessThan(0);
    const q: Puck = { x: 0, z: 0, vx: 0, vz: 3 };
    let goal: number | null = null;
    for (let i = 0; i < 100 && goal === null; i++) goal = stepRink(q, [{ x: 0.4, z: 0.9, vx: 0, vz: 0 }, mallets()[1]], 1 / 60);
    expect(goal).toBe(0);
    // Off-centre at an end: the rail, not a goal.
    const r: Puck = { x: 0.35, z: 0.5, vx: 0, vz: 3 };
    let g2: number | null = null;
    for (let i = 0; i < 40 && g2 === null; i++) g2 = stepRink(r, [{ x: -0.4, z: 0.2, vx: 0, vz: 0 }, mallets()[1]], 1 / 60);
    expect(g2).toBeNull();
    expect(r.vz).toBeLessThan(0);
  });
  it('a moving mallet drives the puck', () => {
    const p: Puck = { x: 0, z: 0.5, vx: 0, vz: 0 };
    const m: Mallet = { x: 0, z: 0.5 + RINK.puckR + RINK.malletR - 0.01, vx: 0, vz: -3 };
    expect(collide(p, m)).toBeGreaterThan(0);
    expect(p.vz).toBeLessThan(-3);
  });
  it('mallets stay in their half', () => {
    const m: Mallet = { x: 2, z: -0.5, vx: 0, vz: 0 };
    clampMallet(m, 0);
    expect(m.z).toBeGreaterThan(0);
    expect(m.x).toBeLessThan(RINK.halfW);
  });
  it('the house defends its goal', () => {
    const t = aiTarget({ x: 0.2, z: 0.4, vx: 0, vz: -2 }, { x: 0, z: -0.8, vx: 0, vz: 0 }, 1, 0.5);
    expect(t.z).toBeLessThan(-0.5);
  });
});

describe('Lucky Claw logic', () => {
  it('lays out a pile away from the chute, the same for everyone', () => {
    const a = makePile(7);
    expect(a.length).toBeGreaterThan(8);
    expect(makePile(7)).toEqual(a);
    for (const p of a) {
      expect(overChute(p.x, p.z)).toBe(false);
      expect(Math.abs(p.x)).toBeLessThan(CLAW.half);
      expect(p.y).toBeGreaterThan(CLAW.floor);
    }
  });
  it('dead centre is likely, the edge is a long shot, outside is nothing', () => {
    expect(grabChance(0)).toBeCloseTo(0.85);
    expect(grabChance(0.07)).toBeLessThan(0.4);
    expect(grabChance(0.1)).toBe(0);
  });
  it('the claw stops on top of what is under it', () => {
    const pile = [{ x: 0, y: CLAW.floor + 0.05, z: 0, live: true }];
    expect(dropDepth(pile, 0, 0)).toBeLessThan(dropDepth(pile, 0.3, 0.3));
    expect(prizeUnder(pile, 0.02, 0)).toBe(0);
    expect(prizeUnder(pile, 0.2, 0)).toBe(-1);
  });
  it('a dropped prize lands and stops', () => {
    const b = { x: 0, y: 1.5, z: 0, vx: 0.2, vy: 0, vz: 0 };
    for (let i = 0; i < 240; i++) stepBody(b, 1 / 60, 0.5);
    expect(b.y).toBeCloseTo(0.5 + CLAW.prizeR, 3);
    expect(Math.abs(b.vx)).toBeLessThan(0.01);
  });
});

describe('arcade: seeded randomness', () => {
  it('repeats from a seed', () => {
    const a = new Rng(42),
      b = new Rng(42);
    for (let i = 0; i < 10; i++) expect(a.next()).toBe(b.next());
  });
});
