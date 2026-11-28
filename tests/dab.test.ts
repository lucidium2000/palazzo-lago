import { describe, expect, it } from 'vitest';
import { DAB_HOLD, DAB_PULL, DAB_PULL_TIME, DAB_SECONDS, dabWeight, GrabTrack, pullApart } from '../src/client/dab';

const dt = 1 / 72;
/** Holds a grab for `secs`, the joined hands at height y(t). */
function hold(g: GrabTrack, secs: number, y: (t: number) => number, both = true) {
  for (let t = 0; t < secs; t += dt) g.touch(dt, y(t), both);
}

describe('dab', () => {
  it('a still grip, held long enough, arms the dab; a short one does not', () => {
    const g = new GrabTrack();
    hold(g, DAB_HOLD * 0.6, () => 1.1 + Math.random() * 0.004);
    expect(g.armed).toBe(false);
    hold(g, DAB_HOLD, () => 1.1 + Math.random() * 0.004);
    expect(g.armed).toBe(true);
    expect(g.shaking).toBe(false);
  });

  it('a gripped handshake (pumped up and down) is a handshake, not a dab', () => {
    const g = new GrabTrack();
    hold(g, 1.0, (t) => 1.05 + Math.sin(t * 2 * Math.PI * 2.5) * 0.06);
    expect(g.shaking).toBe(true);
    expect(g.armed).toBe(false);
  });

  it("an open handshake never arms it (both must grip), and letting go resets the grip", () => {
    const g = new GrabTrack();
    hold(g, 1, () => 1.1, false);
    expect(g.armed).toBe(false);
    hold(g, 0.5, () => 1.1, true);
    expect(g.armed).toBe(true);
    g.touch(dt, 1.1, false);
    expect(g.held).toBe(0);
  });

  it('pulled apart fast while still gripping: dab; slow, or let go: no', () => {
    expect(pullApart(0.1, 0.12, true)).toBe('wait');
    expect(pullApart(0.25, DAB_PULL + 0.05, true)).toBe('dab');
    expect(pullApart(0.25, DAB_PULL + 0.05, false)).toBe('no');
    expect(pullApart(DAB_PULL_TIME + 0.1, 0.2, true)).toBe('no');
  });

  it('the pose snaps in, holds, and eases out over its time', () => {
    expect(dabWeight(0)).toBe(0);
    expect(dabWeight(DAB_SECONDS)).toBe(0);
    expect(dabWeight(DAB_SECONDS - 0.2)).toBe(1);
    expect(dabWeight(0.6)).toBe(1);
    expect(dabWeight(0.1)).toBeGreaterThan(0);
    expect(dabWeight(0.1)).toBeLessThan(0.5);
  });
});
