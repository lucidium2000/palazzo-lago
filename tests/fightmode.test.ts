import { beforeAll, describe, expect, it } from 'vitest';
import { BLOCK_THROUGH, CRIT_SPEED, MIN_SPEED, punchImpact, spotOf } from '../src/client/fight/impact';
import { MATCH_PHASES, MT, Match, MatchView, ROUND_TIME, hudState, readSnap, roundLabel, type MatchEvent, type MatchInput } from '../src/client/fight/rounds';
import { FIGHTER_LEVEL, FightMusic, MusicCue, SPECTATOR_FAR, SPECTATOR_LEVEL, loopRegion, musicTarget } from '../src/client/fight/fightmusic';
import { Brawl, QUICK_WINDUP, T } from '../src/client/fight/brawl';
import { temperament } from '../src/client/fight/anger';
import { ANNOUNCER, announcerLines, roundCall } from '../src/client/fight/fightlines';

/**
 * Fight mode: the match's rounds, the punch physics, the match and its HUD
 * over the network, and the fight music starting and stopping.
 */

const A = { id: 'p:A', name: 'Ann' };
const B = { id: 'n:A:3', name: 'Sal' };

/** Runs a match with fixed input until `until` says stop (or `secs` pass); returns the events. */
function run(m: Match, secs: number, inp: Partial<MatchInput> | (() => Partial<MatchInput>) = {}, until?: (e: MatchEvent) => boolean): MatchEvent[] {
  const ev: MatchEvent[] = [];
  const dt = 1 / 30;
  for (let t = 0; t < secs; t += dt) {
    const i = typeof inp === 'function' ? inp() : inp;
    const e = m.update(dt, { hp: [1, 1], down: [false, false], up: [true, true], ...i });
    ev.push(...e);
    if (until && e.some(until)) break;
  }
  return ev;
}

describe('fight mode: the round state machine', () => {
  it('intro, ROUND 1, FIGHT, then punches count', () => {
    const m = new Match('A:1', A, B);
    expect(m.phase).toBe('intro');
    expect(m.live).toBe(false);
    const ev = run(m, MT.intro + MT.round + 0.1);
    expect(ev.map((e) => e.k)).toEqual(['round', 'fight']);
    expect(ev[0]).toMatchObject({ k: 'round', n: 1, final: false });
    expect(m.live).toBe(true);
  });

  it('a KO wins the round; the one down gets up; ROUND 2; two wins take the match', () => {
    const m = new Match('A:1', A, B);
    run(m, MT.intro + MT.round + MT.fight + 0.1);
    let hpB = 1;
    // Side B takes damage, then goes down.
    run(m, 1, () => ({ hp: [1, (hpB -= 0.02)] }));
    const ko = run(m, 0.2, { hp: [1, 0], down: [false, true] });
    expect(ko).toContainEqual({ k: 'ko', loser: 1 });
    expect(m.wins).toEqual([1, 0]);
    // The K.O. beat, then between rounds: waits while they're down and getting up.
    run(m, MT.ko + 0.05, { hp: [1, 0], down: [false, true], up: [true, false] });
    expect(m.phase).toBe('down');
    const wait = run(m, 4, { hp: [1, 0], down: [false, false], up: [true, false] });
    expect(wait).toEqual([]);
    // Up again: health back to full, ROUND 2.
    const next = run(m, MT.downMin + 0.1, { up: [true, true] }, (e) => e.k === 'round');
    expect(next.map((e) => e.k)).toEqual(['reset', 'round']);
    expect(next[1]).toMatchObject({ n: 2, final: false });
    expect(m.hp).toEqual([1, 1]);
    // Round 2 to A as well: the match is A's (and A was never touched: a perfect).
    run(m, MT.round + MT.fight + 0.1);
    const end = run(m, MT.ko + 0.2, { hp: [1, 0], down: [false, true] });
    expect(end).toContainEqual({ k: 'result', winner: 0, perfect: true });
    expect(m.phase).toBe('result');
    const over = run(m, MT.result + 0.1);
    expect(over).toContainEqual({ k: 'over', abort: false });
    run(m, MT.over + 0.1);
    expect(m.done).toBe(true);
  });

  it('one round each: the third is the FINAL ROUND; taking damage spoils a perfect', () => {
    const m = new Match('A:1', A, B);
    const toLive = () => run(m, 10, {}, (e) => e.k === 'fight');
    const koSide = (s: 0 | 1) => {
      run(m, 0.5, { hp: s === 0 ? [0.5, 1] : [1, 0.5] });
      const ev = run(m, 0.2, s === 0 ? { hp: [0, 1], down: [true, false] } : { hp: [1, 0], down: [false, true] });
      return [...ev, ...run(m, 10, {}, (e) => e.k === 'round' || e.k === 'result')];
    };
    toLive();
    let ev = koSide(1);
    expect(ev.at(-1)).toMatchObject({ k: 'round', n: 2, final: false });
    toLive();
    ev = koSide(0);
    expect(ev.at(-1)).toMatchObject({ k: 'round', n: 3, final: true });
    expect(roundLabel(3, m.wins)).toBe('FINAL ROUND');
    toLive();
    run(m, 0.3, { hp: [0.6, 0.8] });
    ev = koSide(0);
    expect(ev.at(-1)).toMatchObject({ k: 'result', winner: 1, perfect: false });
  });

  it('the clock runs out: most health left takes it (TIME)', () => {
    const m = new Match('A:1', A, B);
    run(m, 10, {}, (e) => e.k === 'fight');
    const ev = run(m, ROUND_TIME + 1, { hp: [0.4, 0.7] });
    expect(ev).toContainEqual({ k: 'time', winner: 1 });
    expect(m.wins).toEqual([0, 1]);
    expect(m.timer).toBe(0);
  });

  it('walking off, running or security cut it short: FIGHT OVER', () => {
    const m = new Match('A:1', A, B);
    run(m, 4);
    expect(m.abort()).toEqual([{ k: 'over', abort: true }]);
    expect(m.phase).toBe('over');
    expect(m.aborted).toBe(true);
    expect(hudState(m.snapshot(), 'p:A').banner?.text).toBe('FIGHT OVER');
    expect(m.abort()).toEqual([]);
  });

  it('even rounds on time go on, but never past the last round', () => {
    const m = new Match('A:1', A, B);
    for (let r = 0; r < 6 && m.phase !== 'result'; r++) {
      run(m, 10, {}, (e) => e.k === 'fight');
      run(m, ROUND_TIME + MT.time + 0.5, { hp: [0.5, 0.5] }, (e) => e.k === 'result' || e.k === 'reset');
    }
    expect(m.phase).toBe('result');
    expect(m.round).toBe(5);
    expect(m.winner).toBe(2);
    expect(hudState(m.snapshot(), 'p:A').banner?.text).toBe('DRAW');
  });

  it('the announcer calls each round, and the last one "Final round"', () => {
    expect(roundCall(1, false)).toBe(ANNOUNCER.round[0]);
    expect(roundCall(2, false)).toBe(ANNOUNCER.round[1]);
    expect(roundCall(3, true)).toBe(ANNOUNCER.final);
    expect(announcerLines()).toContain(ANNOUNCER.fight);
    expect(announcerLines()).toContain(ANNOUNCER.ko);
  });
});

describe('fight mode: the damage model', () => {
  it('faster fists do more damage; nothing under the minimum speed', () => {
    const at = (v: number) => punchImpact({ speed: v, spot: 'head' }).damage;
    expect(at(MIN_SPEED - 0.2)).toBe(0);
    expect(at(3)).toBeGreaterThan(0);
    expect(at(4.5)).toBeGreaterThan(at(3));
    expect(at(6.5)).toBeGreaterThan(at(4.5));
  });

  it('head shots hurt more than body shots at the same speed', () => {
    for (const v of [2.5, 4, 6, 8]) expect(punchImpact({ speed: v, spot: 'head' }).damage).toBeGreaterThan(punchImpact({ speed: v, spot: 'body' }).damage);
  });

  it('a punch on the gloves (hands up by the face) is a block: most of it stopped, no crit, no stagger, a small push', () => {
    const clean = punchImpact({ speed: 7, spot: 'head' });
    const block = punchImpact({ speed: 7, spot: 'guard' });
    expect(block.blocked).toBe(true);
    expect(block.damage).toBeLessThanOrEqual(punchImpact({ speed: 7, spot: 'head', strength: 1 }).damage * BLOCK_THROUGH + 0.1);
    expect(block.damage).toBeLessThan(clean.damage * 0.2);
    expect(block.crit || block.stagger).toBe(false);
    expect(block.push).toBeLessThan(clean.push);
  });

  it('hard head shots crit and stagger; hard body shots stagger without a crit', () => {
    const soft = punchImpact({ speed: CRIT_SPEED - 0.5, spot: 'head' });
    const hard = punchImpact({ speed: CRIT_SPEED + 0.3, spot: 'head' });
    expect(soft.crit).toBe(false);
    expect(hard.crit && hard.stagger).toBe(true);
    expect(hard.damage).toBeGreaterThan(soft.damage * 1.4);
    const body = punchImpact({ speed: 7, spot: 'body' });
    expect(body.crit).toBe(false);
    expect(body.stagger).toBe(true);
  });

  it('more mass behind it, more damage; a stronger thrower more damage', () => {
    expect(punchImpact({ speed: 4.5, spot: 'body', mass: 2.4 }).damage).toBeGreaterThan(punchImpact({ speed: 4.5, spot: 'body', mass: 1.2 }).damage);
    expect(punchImpact({ speed: 4.5, spot: 'head', strength: 1.3 }).damage).toBeGreaterThan(punchImpact({ speed: 4.5, spot: 'head' }).damage);
  });

  it('knock-back grows with the hit and stays a step at most', () => {
    const a = punchImpact({ speed: 3, spot: 'body' }).push;
    const b = punchImpact({ speed: 8, spot: 'body' }).push;
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThanOrEqual(0.45);
  });

  it('where it landed: the gloves first, then the head, else the body', () => {
    expect(spotOf(0.05, 0.05)).toBe('guard');
    expect(spotOf(0.1, 0.4)).toBe('head');
    expect(spotOf(0.4, 0.4)).toBe('body');
  });

  it('a clean hit worked out from speed is cut to a block if their gloves get there after all', () => {
    const b = new Brawl(temperament('rosa'));
    for (let i = 0; i < 45; i++) b.update({ dt: 1 / 30, dist: 0.8, passive: false, rnd: () => 0.5 });
    const imp = punchImpact({ speed: 5, spot: 'head' });
    const hp = b.health.hp;
    const r = b.hit({ zone: 'head', power: imp.power, amount: imp.damage }, () => 0.01);
    expect(r.blocked).toBe(true);
    expect(hp - b.health.hp).toBeCloseTo(imp.damage * BLOCK_THROUGH, 3);
  });
});

describe('fight mode: smarter guests', () => {
  const settle = (b: Brawl) => {
    for (let i = 0; i < 45; i++) b.update({ dt: 1 / 30, dist: 0.85, passive: false, rnd: () => 0.5 });
  };

  it('between rounds (hold) they keep their guard and throw nothing, and a calm opponent does not end it', () => {
    const b = new Brawl(temperament('sal'));
    b.hold = true;
    const ev: string[] = [];
    for (let i = 0; i < 300; i++) {
      const e = b.update({ dt: 1 / 30, dist: 2, passive: true, rnd: () => 0.5 });
      if (e) ev.push(e);
    }
    expect(ev).not.toContain('windup');
    expect(ev).not.toContain('giveup');
  });

  it('they slip a punch (a quick side step) and counter with a quick one', () => {
    const b = new Brawl(temperament('rosa'));
    settle(b);
    // Not blocked (0.99 > guard), then slips it (0.01), to their left (0.2).
    const rolls = [0.99, 0.01, 0.2];
    let k = 0;
    expect(b.threat(() => rolls[k++] ?? 0.5)).toBe(false);
    expect(b.dodging).toBe(true);
    b.update({ dt: 1 / 30, dist: 0.85, passive: false, rnd: () => 0.5 });
    expect(Math.abs(b.strafe)).toBeGreaterThan(1.5);
    let wind = -1;
    for (let i = 0; i < 60 && wind < 0; i++) if (b.update({ dt: 1 / 30, dist: 0.85, passive: false, rnd: () => 0.5 }) === 'windup') wind = i;
    expect(wind).toBeGreaterThanOrEqual(0);
    expect(b.windupLen).toBe(QUICK_WINDUP);
  });

  it('they throw combinations: straight into the other hand after a punch', () => {
    const b = new Brawl(temperament('vinnie'));
    settle(b);
    let combos = 0;
    let lastSide = -1;
    for (let i = 0; i < 30 * 20; i++) {
      const e = b.update({ dt: 1 / 30, dist: 0.85, passive: false, rnd: () => 0.05 });
      if (e === 'windup' && b.combo > 0) {
        combos++;
        expect(b.side).not.toBe(lastSide);
      }
      if (e === 'windup') lastSide = b.side;
    }
    expect(combos).toBeGreaterThan(0);
  });

  it('after a knockdown in a match they get up for the next round (full health), not walk off', () => {
    const b = new Brawl(temperament('marcus'));
    b.afterGetup = 'square';
    b.lie = 1;
    for (let i = 0; i < 40 && b.phase !== 'ko'; i++) b.hit({ zone: 'head', power: 1 }, () => 0.99);
    expect(b.phase).toBe('ko');
    for (let t = 0; t < T.fall + 1 + T.getup + 0.2; t += 1 / 30) b.update({ dt: 1 / 30, dist: 1, passive: false, rnd: () => 0.5 });
    expect(b.phase).not.toBe('leave');
    expect(b.health.fraction).toBe(1);
  });
});

describe('fight mode over the network: the rounds and the HUD', () => {
  it('a friend follows the match from snapshots (newest wins) and their HUD shows the same fight', () => {
    const m = new Match('A:1', { id: 'p:A', name: 'Ann' }, { id: 'p:B', name: 'Bo' });
    const wire = () => readSnap(JSON.parse(JSON.stringify(m.snapshot())))!;
    const v = new MatchView(wire());
    const old = wire();
    run(m, MT.intro + MT.round + MT.fight + 1);
    run(m, 0.5, { hp: [0.7, 0.45] });
    expect(v.apply(wire())).toBe(true);
    // An old packet arriving late changes nothing.
    expect(v.apply(old)).toBe(false);
    expect(v.phase).toBe('live');
    // The clock runs on between snapshots.
    const tm = v.snap.tm;
    v.update(2);
    expect(v.snap.tm).toBeCloseTo(tm - 2, 5);
    // Ann (A, running it) and Bo (B, following): each sees themself on the left.
    const ha = hudState(m.snapshot(), 'p:A');
    const hb = hudState(v.snap, 'p:B');
    expect(ha.left).toMatchObject({ name: 'YOU', hp: 0.7, you: true });
    expect(ha.right).toMatchObject({ name: 'BO', hp: 0.45 });
    expect(hb.left).toMatchObject({ name: 'YOU', hp: 0.45, you: true });
    expect(hb.right).toMatchObject({ name: 'ANN', hp: 0.7 });
    expect(ha.round).toBe(hb.round);
    expect(ha.fighter && hb.fighter).toBe(true);
    // A third player watching: A on the left, names, no YOU.
    const hc = hudState(v.snap, 'p:C');
    expect(hc.fighter).toBe(false);
    expect([hc.left.name, hc.right.name]).toEqual(['ANN', 'BO']);
    // The knockout and the result reach them with the right words for each.
    run(m, 0.2, { hp: [1, 0], down: [false, true] });
    v.apply(wire());
    expect(hudState(v.snap, 'p:B').banner?.text).toBe('K.O.!');
    expect(v.snap.w).toEqual([1, 0]);
    run(m, 30, { up: [true, true] }, (e) => e.k === 'fight');
    run(m, MT.ko + 0.2, { hp: [1, 0], down: [false, true] });
    v.apply(wire());
    expect(MATCH_PHASES[v.snap.ph]).toBe('result');
    expect(hudState(v.snap, 'p:A').banner?.text).toMatch(/PERFECT|YOU WIN/);
    expect(hudState(v.snap, 'p:B').banner?.text).toBe('YOU LOSE');
    expect(hudState(v.snap, 'p:C').banner?.text).toMatch(/ANN WINS|PERFECT/);
  });

  it('nonsense off the wire is not a match', () => {
    expect(readSnap(null)).toBeNull();
    expect(readSnap({ id: 'x' })).toBeNull();
    expect(readSnap({ id: 'x', ph: 2, w: [0, 0], a: { id: 'p:A', n: 'A', hp: 9 }, b: { id: 'p:B', n: 'B' } })?.a.hp).toBe(1);
  });

  it('two machines: the runner publishes, the friend in it sees the calls, punches only count once the bell goes', async () => {
    installDom();
    const { FightMode } = await import('../src/client/fight/mode');
    const THREE = await import('three');
    const wire: unknown[] = [];
    const mk = (id: string, emit: (k: string, d: unknown) => void) =>
      new FightMode({
        sound: { playLocal() {}, play() {}, listener: null } as never,
        camera: new THREE.PerspectiveCamera(),
        scene: new THREE.Scene(),
        inXR: () => false,
        feet: () => new THREE.Vector3(),
        selfId: () => id,
        emit,
        playerFemale: () => false,
        music: () => null,
        myHp: () => 1,
      });
    const a = mk('A', (k, d) => k === 'fmx' && wire.push(JSON.parse(JSON.stringify(d))));
    const b = mk('B', () => {});
    let hpB = 1;
    const m = a.host({ id: 'p:A', name: 'Ann' }, { id: 'p:B', name: 'Bo' }, [{ hp: () => 1, down: () => false, up: () => true }, { hp: () => hpB, down: () => hpB <= 0, up: () => hpB > 0 }], () => ({ x: 0, z: 0 }), () => {})!;
    expect(m).not.toBeNull();
    const step = (s: number) => {
      for (let t = 0; t < s; t += 1 / 30) {
        a.update(1 / 30);
        while (wire.length) b.onSnap(wire.shift());
        b.onSnap(JSON.parse(JSON.stringify(a.snapshot())));
        b.update(1 / 30);
      }
    };
    step(0.2);
    expect(b.show).toMatchObject({ phase: 'intro', fighter: true });
    expect(b.gate('A')).toBe(false);
    expect(b.versus('A')).toBe(true);
    step(MT.intro + MT.round + 0.1);
    expect(b.gate('A')).toBe(true);
    // The announcer called the round and the fight on both machines.
    expect(a.called).toEqual([ANNOUNCER.round[0], ANNOUNCER.fight]);
    expect(b.called).toEqual([ANNOUNCER.round[0], ANNOUNCER.fight]);
    // A knockout: the slow-motion beat (the people's clock), on both.
    hpB = 0;
    step(0.1);
    expect(b.show?.phase).toBe('ko');
    expect(a.timeScale).toBeLessThan(0.5);
    expect(b.timeScale).toBeLessThan(0.5);
    expect(b.gate('A')).toBe(false);
    // The HUD on B: B on the left, the round to A.
    const hud = b.debug().hud!;
    expect(hud.left.you).toBe(true);
    expect(hud.right.wins).toBe(1);
    step(2);
    expect(a.timeScale).toBe(1);
    a.dispose();
    b.dispose();
  });
});

describe('fight mode: the music', () => {
  it('loud for the fighters, faint for a friend watching close by, nothing from across the room', () => {
    expect(musicTarget(true, 'fighter')).toBe(FIGHTER_LEVEL);
    expect(musicTarget(true, 'spectator', 2)).toBe(SPECTATOR_LEVEL);
    expect(musicTarget(true, 'spectator', 8)).toBeGreaterThan(0);
    expect(musicTarget(true, 'spectator', 8)).toBeLessThan(SPECTATOR_LEVEL);
    expect(musicTarget(true, 'spectator', SPECTATOR_FAR + 1)).toBe(0);
    expect(musicTarget(false, 'fighter')).toBe(0);
  });

  it('kicks in at the start, ducks the world music, fades out after and stops', () => {
    const c = new MusicCue();
    expect(c.duck).toBe(1);
    const r0 = c.update(1 / 60, true, 'fighter');
    expect(r0.start).toBe(true);
    for (let i = 0; i < 60; i++) expect(c.update(1 / 60, true, 'fighter').start).toBe(false);
    expect(c.level).toBeCloseTo(FIGHTER_LEVEL, 5);
    expect(c.duck).toBeLessThan(0.2);
    // Over: a fade of a few seconds, then it stops (once).
    let stops = 0,
      t = 0;
    for (; t < 6 && c.playing; t += 1 / 60) if (c.update(1 / 60, false, 'none').stop) stops++;
    expect(stops).toBe(1);
    expect(t).toBeGreaterThan(2);
    expect(c.level).toBe(0);
    expect(c.duck).toBe(1);
  });

  it('a spectator only dips the world a little', () => {
    const c = new MusicCue();
    for (let i = 0; i < 60; i++) c.update(1 / 60, true, 'spectator', 2);
    expect(c.duck).toBeGreaterThan(0.6);
    expect(c.duck).toBeLessThan(1);
  });

  it('plays the track on a 2D bus (looping on its bar lines) and stops it after the fade', async () => {
    const log: string[] = [];
    const src = {
      buffer: null as unknown,
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      connect: () => log.push('src.connect'),
      start: () => log.push('start'),
      stop: () => log.push('stop'),
      disconnect: () => log.push('src.disconnect'),
    };
    const gain = { gain: { value: 0, setTargetAtTime: (v: number) => (gain.gain.value = v) }, connect: () => log.push('gain.connect'), disconnect: () => log.push('gain.disconnect') };
    const out = { ctx: { createGain: () => gain, createBufferSource: () => src, currentTime: 0 }, out: {} as AudioNode, load: async () => ({ duration: 72.5 }) as AudioBuffer };
    const fm = new FightMusic(() => out as never);
    fm.update(1 / 60, true, 'fighter');
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toContain('start');
    const lr = loopRegion();
    expect(src.loop).toBe(true);
    expect(src.loopStart).toBeCloseTo(lr.start, 5);
    expect(src.loopEnd).toBeCloseTo(lr.end, 5);
    expect(lr.end).toBeLessThan(72.5);
    expect(lr.end - lr.start).toBeGreaterThan(30);
    for (let i = 0; i < 60; i++) fm.update(1 / 60, true, 'fighter');
    expect(gain.gain.value).toBeCloseTo(FIGHTER_LEVEL, 3);
    for (let i = 0; i < 60 * 6; i++) fm.update(1 / 60, false, 'none');
    expect(log).toContain('stop');
    expect(fm.playing).toBe(false);
  });
});

/** Just enough DOM for the HUD (no browser). */
function installDom() {
  const g = globalThis as Record<string, unknown>;
  const el = (): Record<string, unknown> => ({
    style: {},
    classList: { toggle() {}, add() {}, remove() {} },
    width: 0,
    height: 0,
    appendChild() {},
    remove() {},
    addEventListener() {},
    getContext: () => ctx2d(),
  });
  g.document ??= { createElement: () => el(), getElementById: () => null, body: el() };
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
}

/** A 2D context that accepts anything. */
export function ctx2d(): unknown {
  const grad = { addColorStop() {} };
  return new Proxy({}, { get: (_t, k) => (k === 'createLinearGradient' || k === 'createRadialGradient' ? () => grad : () => {}), set: () => true });
}

beforeAll(() => installDom());
