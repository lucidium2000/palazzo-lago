import { describe, expect, it } from 'vitest';
import { DealerClock, type DealerEvent } from '../src/rules/dealerclock';

/** Runs the clock at 10 Hz from `t0` to `t1` with a fixed input; returns the events and when. */
function run(c: DealerClock, t0: number, t1: number, input: { bets: boolean; layout: string; placing?: boolean; busy?: boolean }) {
  const out: [number, DealerEvent][] = [];
  for (let t = t0; t <= t1 + 1e-9; t = Math.round((t + 0.1) * 10) / 10) {
    const e = c.update({ now: t, ...input });
    if (e) out.push([t, e]);
  }
  return out;
}

describe('the croupier calls the spin', () => {
  it('never spins an empty layout', () => {
    const c = new DealerClock();
    expect(run(c, 0, 60, { bets: false, layout: '' })).toEqual([]);
  });

  it('calls "No more bets" after 4 quiet seconds, then spins after the warning', () => {
    const c = new DealerClock();
    run(c, 0, 2, { bets: false, layout: '' });
    // A bet goes down at t=2.1 and nobody touches the layout after it.
    const ev = run(c, 2.1, 9, { bets: true, layout: 'red:10' });
    expect(ev.map((e) => e[1])).toEqual(['call', 'go']);
    expect(ev[0][0]).toBeCloseTo(6.1, 5);
    expect(ev[1][0]).toBeCloseTo(6.1 + c.opts.warn, 5);
  });

  it('waits while someone keeps placing chips, but not past the betting window', () => {
    const c = new DealerClock();
    let calls: number[] = [];
    // A new chip every 2 s: never 4 s quiet, so the 20 s window decides.
    for (let t = 0; t <= 30; t = Math.round((t + 0.1) * 10) / 10) {
      const e = c.update({ now: t, bets: true, layout: `red:${10 + Math.floor(t / 2) * 5}` });
      if (e === 'call') calls.push(t);
      if (e === 'go') break;
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeCloseTo(20, 5);
    // Holding chips over the table counts as placing too.
    const d = new DealerClock();
    calls = [];
    for (let t = 0; t <= 12; t = Math.round((t + 0.1) * 10) / 10) if (d.update({ now: t, bets: true, layout: 'red:10', placing: t < 6 }) === 'call') calls.push(t);
    expect(calls[0]).toBeCloseTo(10 - 0.1, 0); // 6 s of holding, then 4 quiet: not before t≈9.9
  });

  it('READY calls straight away, and a busy table starts the next round fresh', () => {
    const c = new DealerClock();
    expect(c.update({ now: 0, bets: true, layout: 'a' })).toBeNull();
    c.hurry();
    expect(c.update({ now: 0.5, bets: true, layout: 'a' })).toBe('call');
    expect(run(c, 0.6, 3, { bets: true, layout: 'a' }).map((e) => e[1])).toEqual(['go']);
    // Spinning: nothing; then the layout is cleared and betting opens again.
    expect(run(c, 3.1, 15, { bets: true, layout: 'a', busy: true })).toEqual([]);
    expect(run(c, 15.1, 17, { bets: false, layout: '' })).toEqual([]);
    const ev = run(c, 17.1, 30, { bets: true, layout: 'b' });
    expect(ev[0][1]).toBe('call');
    expect(ev[0][0]).toBeCloseTo(21.1, 5);
  });

  it('a call that cannot go ahead (table minimums) reopens and waits again', () => {
    const c = new DealerClock();
    const ev = run(c, 0, 4.0, { bets: true, layout: 'x' });
    expect(ev).toEqual([[4, 'call']]);
    c.reopen(4.0);
    expect(c.state).toBe('open');
    expect(run(c, 4.1, 7.9, { bets: true, layout: 'x' })).toEqual([]);
    expect(run(c, 8.0, 8.0, { bets: true, layout: 'x' })).toEqual([[8, 'call']]);
  });

  it('counts down for the status line', () => {
    const c = new DealerClock();
    expect(c.untilCall(0)).toBeNull();
    c.update({ now: 1, bets: true, layout: 'a' });
    expect(c.untilCall(2)).toBeCloseTo(3, 5);
  });
});
