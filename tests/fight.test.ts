import { describe, expect, it } from 'vitest';
import { Anger, FIGHT_AT, temperament } from '../src/client/fight/anger';
import { Health, REGEN_AFTER, damage } from '../src/client/fight/health';
import { Brawl, T, WALKED_AWAY, type BrawlEvent, type BrawlInput } from '../src/client/fight/brawl';

const seq = (...v: number[]) => {
  let i = 0;
  return () => v[i++ % v.length];
};

/** Runs a brawl for `secs` with fixed input; returns the events seen. */
function run(b: Brawl, secs: number, inp: Partial<BrawlInput> = {}): BrawlEvent[] {
  const ev: BrawlEvent[] = [];
  const dt = 1 / 30;
  for (let t = 0; t < secs; t += dt) {
    const e = b.update({ dt, dist: 0.8, passive: false, rnd: () => 0.5, ...inp });
    if (e) ev.push(e);
  }
  return ev;
}

describe('anger', () => {
  it('hot-heads boil over faster than average people', () => {
    const sal = new Anger(temperament('sal'));
    const avg = new Anger(temperament('marcus'));
    let salAt = 0,
      avgAt = 0;
    for (let i = 1; i <= 10; i++) {
      if (!salAt && sal.add('pushed', 0.5)) salAt = i;
      if (!avgAt && avg.add('pushed', 0.5)) avgAt = i;
    }
    expect(salAt).toBeGreaterThan(0);
    expect(avgAt).toBeGreaterThan(salAt);
  });

  it('a couple of punches start a fight; one push does not', () => {
    const a = new Anger(temperament('vinnie'));
    expect(a.add('pushed')).toBe(false);
    expect(a.boiling).toBe(false);
    const crossed = a.add('punched', 0.8) || a.add('punched', 0.8);
    expect(crossed).toBe(true);
    expect(a.level).toBeGreaterThanOrEqual(FIGHT_AT);
  });

  it('slaps escalate too, less than punches', () => {
    const a = new Anger(temperament('marcus'));
    const b = new Anger(temperament('marcus'));
    a.add('slapped', 0.5);
    b.add('punched', 0.5);
    expect(a.level).toBeGreaterThan(0.25);
    expect(a.level).toBeLessThan(b.level);
  });

  it('cools off after a while, not straight away', () => {
    const a = new Anger(temperament('marcus'));
    a.add('punched', 1);
    const l = a.level;
    a.update(2);
    expect(a.level).toBe(l);
    for (let i = 0; i < 60; i++) a.update(1);
    expect(a.level).toBeLessThan(l * 0.2);
  });

  it('your crew never gets angry enough', () => {
    const a = new Anger(temperament('crew'));
    for (let i = 0; i < 10; i++) expect(a.add('punched', 1)).toBe(false);
  });

  it('temperaments: staff call security, Eleanor gets loud, Reggie is all talk', () => {
    expect(temperament('staff').response).toBe('security');
    expect(temperament('eleanor').response).toBe('loud');
    expect(temperament('reggie').response).toBe('talk');
    expect(temperament('sal').response).toBe('brawl');
    expect(temperament('unknown').response).toBe('brawl');
  });
});

describe('health', () => {
  it('head shots hurt more than body shots; blocks and slaps much less', () => {
    const head = damage({ zone: 'head', power: 0.7 });
    const body = damage({ zone: 'body', power: 0.7 });
    expect(head).toBeGreaterThan(body);
    expect(damage({ zone: 'head', power: 0.7, blocked: true })).toBeLessThan(head * 0.2);
    expect(damage({ zone: 'head', power: 0.7, slap: true })).toBeLessThan(body);
    expect(damage({ zone: 'head', power: 0.7, slap: true })).toBeGreaterThan(0);
  });

  it('knocks out at zero, comes round restored', () => {
    const h = new Health(100);
    let ko = false,
      n = 0;
    while (!ko && n < 50) {
      ko = h.take({ zone: 'head', power: 1 }, 4).ko;
      n++;
    }
    expect(ko).toBe(true);
    expect(n).toBeGreaterThan(3);
    expect(h.ko).toBe(true);
    expect(h.take({ zone: 'head', power: 1 }).dmg).toBe(0);
    let back = false;
    for (let i = 0; i < 50 && !back; i++) back = h.update(0.1);
    expect(back).toBe(true);
    expect(h.hp).toBe(100);
    expect(h.ko).toBe(false);
  });

  it('regenerates slowly, only out of combat and after a pause', () => {
    const h = new Health(100);
    h.take({ zone: 'body', power: 1 });
    const hp = h.hp;
    h.update(REGEN_AFTER - 1);
    expect(h.hp).toBe(hp);
    h.update(2, true);
    expect(h.hp).toBe(hp);
    h.update(1);
    expect(h.hp).toBeGreaterThan(hp);
    expect(h.hp).toBeLessThan(hp + 6);
  });
});

describe('brawl', () => {
  it('squares up, closes in and throws a telegraphed punch', () => {
    const b = new Brawl(temperament('sal'));
    expect(b.phase).toBe('square');
    run(b, T.square + 0.1, { dist: 2 });
    expect(b.phase).toBe('close');
    expect(b.advance).toBeGreaterThan(0);
    const ev = run(b, 4, { dist: 0.8 });
    const w = ev.indexOf('windup');
    expect(w).toBeGreaterThanOrEqual(0);
    expect(ev.indexOf('impact')).toBeGreaterThan(w);
  });

  it('the wind-up lasts long enough to see it coming', () => {
    const b = new Brawl(temperament('vinnie'));
    run(b, T.square + 0.05);
    let t = 0;
    const dt = 1 / 60;
    let sawWindup = -1,
      impact = -1;
    while (t < 6 && impact < 0) {
      const e = b.update({ dt, dist: 0.8, passive: false, rnd: () => 0.5 });
      if (e === 'windup') sawWindup = t;
      if (e === 'impact') impact = t;
      t += dt;
    }
    expect(impact - sawWindup).toBeGreaterThanOrEqual(T.windup);
  });

  it('gives up when you walk away', () => {
    const b = new Brawl(temperament('sal'));
    const ev = run(b, T.away + 1, { dist: WALKED_AWAY + 1 });
    expect(ev).toContain('giveup');
    expect(b.over).toBe(true);
  });

  it('it is over when you put your hands down and back off for a few seconds', () => {
    const b = new Brawl(temperament('marcus'));
    run(b, 2);
    expect(run(b, 1.5, { dist: 2, passive: true })).not.toContain('giveup');
    expect(run(b, 2, { dist: 2, passive: true })).toContain('giveup');
  });

  it('their guard blocks some head shots, never body shots', () => {
    const b = new Brawl(temperament('rosa'));
    run(b, 1.5);
    expect(b.phase).toBe('guard');
    expect(b.hit({ zone: 'head', power: 0.6 }, () => 0.1).blocked).toBe(true);
    expect(b.hit({ zone: 'body', power: 0.6 }, () => 0.1).blocked).toBe(false);
  });

  it('goes down when out of health, gets up groggy and leaves', () => {
    const b = new Brawl(temperament('marcus'));
    let ko = false;
    for (let i = 0; i < 40 && !ko; i++) ko = b.hit({ zone: 'head', power: 1 }, seq(0.99)).ko;
    expect(ko).toBe(true);
    expect(b.phase).toBe('ko');
    const pose = { guard: 0, block: 0, windup: 0, punch: 0, down: 0, wobble: 0 };
    run(b, T.fall + 0.1);
    expect(b.pose(pose).down).toBeGreaterThan(0.9);
    const ev = run(b, T.lie + T.getup + 0.2);
    expect(ev).toContain('getup');
    expect(b.phase).toBe('leave');
    expect(b.pose(pose).wobble).toBeGreaterThan(0);
  });

  it('a talker never throws and runs once you hit back', () => {
    const b = new Brawl(temperament('reggie'), true);
    const ev = run(b, 6);
    expect(ev).not.toContain('windup');
    b.hit({ zone: 'body', power: 0.5 }, () => 0.99);
    const r = b.hit({ zone: 'body', power: 0.5 }, () => 0.99);
    expect(r.flee).toBe(true);
    expect(b.over).toBe(true);
  });
});
