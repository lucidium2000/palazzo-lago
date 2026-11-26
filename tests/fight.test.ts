import { describe, expect, it } from 'vitest';
import { Anger, FIGHT_AT, temperament } from '../src/client/fight/anger';
import { Health, REGEN_AFTER, damage } from '../src/client/fight/health';
import { Brawl, STAGGER_BACK, T, WALKED_AWAY, type BrawlEvent, type BrawlInput, type PoseOut } from '../src/client/fight/brawl';

const seq = (...v: number[]) => {
  let i = 0;
  return () => v[i++ % v.length];
};

/** Runs a brawl for `secs` with fixed input; returns the events seen. */
function run(b: Brawl, secs: number, inp: Partial<BrawlInput> = {}): BrawlEvent[] {
  const ev: BrawlEvent[] = [];
  const dt = 1 / 30;
  for (let t = 0; t < secs; t += dt) {
    const e = b.update({
      dt,
      dist: 0.8,
      passive: false,
      rnd: () => 0.5,
      ...inp,
    });
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
    const pose: PoseOut = { guard: 0, block: 0, act: 'none', actT: 0, body: false, down: 0, wobble: 0 };
    expect(b.pose(pose).act).toBe('ko');
    run(b, T.fall + 0.1);
    expect(b.pose(pose).down).toBeGreaterThan(0.9);
    // Lying there, then the get-up clip runs on the fight's clock.
    const ev = run(b, T.lie);
    expect(b.pose(pose).act).toBe('getup');
    expect(pose.actT).toBeLessThan(0.3);
    ev.push(...run(b, T.getup + 0.2));
    expect(ev).toContain('getup');
    expect(b.phase).toBe('leave');
    expect(b.pose(pose).wobble).toBeGreaterThan(0);
    expect(pose.act).toBe('none');
  });

  it('throws jabs, crosses and hooks on one clock: wind-up, strike, recovery', () => {
    const b = new Brawl(temperament('vinnie'));
    run(b, T.square + 0.05);
    const seen = new Set<string>();
    const pose: PoseOut = { guard: 0, block: 0, act: 'none', actT: 0, body: false, down: 0, wobble: 0 };
    let r = 0;
    const rnd = () => ((r = (r * 9301 + 49297) % 233280), r / 233280);
    for (let i = 0; i < 60 * 40; i++) {
      const e = b.update({ dt: 1 / 60, dist: 0.9, passive: false, rnd });
      b.pose(pose);
      if (e === 'impact') {
        seen.add(b.move);
        // The punch lands at the end of the strike (the clip's impact frame).
        expect(pose.actT).toBeCloseTo(T.windup + T.strike, 1);
        expect(b.move === 'cross' ? b.side : 0).toBe(b.move === 'cross' ? 1 : 0);
      }
      if (b.phase === 'windup') expect(pose.act).toBe(b.move);
    }
    expect([...seen].sort()).toEqual(['cross', 'hook', 'jab']);
  });

  it('circles and keeps its distance between punches', () => {
    const b = new Brawl(temperament('sal'));
    run(b, T.square + 0.05, { dist: 0.9 });
    let strafe = 0;
    for (let i = 0; i < 300; i++) {
      b.update({ dt: 1 / 60, dist: 0.9, passive: false, rnd: () => 0.9 });
      if (b.phase === 'guard') strafe = Math.max(strafe, Math.abs(b.strafe));
    }
    expect(strafe).toBeGreaterThan(0.2);
    // Crowded: they step back out.
    b.show('guard');
    b.update({ dt: 1 / 60, dist: 0.6, passive: false, rnd: () => 0.9 });
    expect(b.advance).toBeLessThan(0);
  });

  it('gets its gloves up when it sees your punch coming (and that block holds)', () => {
    const b = new Brawl(temperament('rosa'));
    run(b, 1.5);
    const pose: PoseOut = { guard: 0, block: 0, act: 'none', actT: 0, body: false, down: 0, wobble: 0 };
    expect(b.threat(() => 0.01)).toBe(true);
    expect(b.pose(pose).block).toBeGreaterThan(0.9);
    expect(b.hit({ zone: 'head', power: 0.6 }, () => 0.99).blocked).toBe(true);
    const c = new Brawl(temperament('rosa'));
    run(c, 1.5);
    expect(c.threat(() => 0.99)).toBe(false);
    expect(c.hit({ zone: 'head', power: 0.6 }, () => 0.01).blocked).toBe(false);
  });

  it('a stagger stumbles back as far as the clip steps', () => {
    const b = new Brawl(temperament('marcus'));
    run(b, 1.5);
    b.hit({ zone: 'head', power: 0.9 }, () => 0.99);
    expect(b.phase).toBe('stagger');
    let back = 0;
    const dt = 1 / 240;
    for (let t = 0; t < T.stagger - 0.01; t += dt) {
      b.update({ dt, dist: 1, passive: false, rnd: () => 0.5 });
      back -= b.advance * dt;
    }
    expect(back).toBeCloseTo(STAGGER_BACK.d, 2);
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

describe('slaps', () => {
  it('an open hand across the face is a slap above ~1.2 m/s, a touch below; a fast fist is a punch', async () => {
    const { faceContact, SLAP_SPEED, PUNCH_SPEED } = await import('../src/client/bodies');
    expect(faceContact(0.3, false)).toBe(null);
    expect(faceContact(0.9, false)).toBe(null);
    expect(faceContact(SLAP_SPEED + 0.1, false)).toBe('slap');
    expect(faceContact(SLAP_SPEED + 0.1, true)).toBe(null);
    expect(faceContact(PUNCH_SPEED + 0.1, true)).toBe('punch');
    expect(SLAP_SPEED).toBeLessThan(PUNCH_SPEED);
  });

  it('a slap stings less than a punch but still escalates to a fight', () => {
    expect(damage({ zone: 'head', power: 1, slap: true })).toBeLessThan(damage({ zone: 'head', power: 0.3 }));
    const a = new Anger(temperament('sal'));
    let n = 0;
    while (!a.boiling && n < 10) {
      a.add('slapped', 0.6);
      n++;
    }
    expect(a.boiling).toBe(true);
    expect(n).toBeLessThanOrEqual(3);
  });
});

describe('hands on faces (VR)', () => {
  it('an open hand swiping across a face slaps; a fist punches the head; a slow hand only touches', async () => {
    const THREE = await import('three');
    const { Bodies } = await import('../src/client/bodies');
    const { Person } = await import('../src/client/people');
    const p = new Person('watch', { dress: false, main: 0, second: 0, skin: 0, hair: 0, hairStyle: 'short', height: 1.75 });
    const head = new THREE.Object3D();
    head.position.set(0, 1.6, 0);
    head.updateMatrixWorld(true);
    p.rig = { bones: { Head: head } } as never;
    const grip = new THREE.Group();
    const hand = { grip, ctrl: { userData: {} }, held: null, carried: null, pos: new THREE.Vector3(), index: 0 };
    let vel = new THREE.Vector3();
    let fist = false;
    const got: string[] = [];
    const bodies = new Bodies({
      crowd: { people: [p], now: 0 } as never,
      world: { move: (x: number, z: number) => [x, z] } as never,
      player: { feet: () => new THREE.Vector3(0, 0, 1), inXR: false, speed: 0, seated: null } as never,
      hands: { hands: [hand], velocity: () => vel, onHaptic: null } as never,
      isFist: () => fist,
      onSlap: (_p, power) => got.push('slap ' + power.toFixed(2)),
      onPunch: (_p, _pw, _at, zone) => got.push('punch ' + zone),
    });
    const at = (x: number, y: number, z: number) => {
      grip.position.set(x, y, z);
      grip.updateMatrixWorld(true);
    };
    const swipe = (v: [number, number, number], f: boolean) => {
      vel = new THREE.Vector3(...v);
      fist = f;
      at(0.03, 1.66, 0.1);
      (bodies as unknown as { handPush(h: unknown): void }).handPush(hand);
      // Let the per-person cool-down pass.
      bodies.update(2);
    };
    swipe([0.3, 0, 0], false); // a touch
    expect(got).toEqual([]);
    swipe([2, 0, 0.2], false); // across the face, open hand
    expect(got[0]).toMatch(/^slap/);
    swipe([0, 0, -2.5], true); // a fist into the face
    expect(got[1]).toBe('punch head');
  });
});
