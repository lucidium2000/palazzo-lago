import { buildStrip, DIAMOND_SEVENS, LAGO_FORTUNA, ROYAL_CONSERVATORY } from '../src/rules/machines';
import { analyzeMachine, type Machine } from '../src/rules/slots';
import { SeededRng } from '../src/rules/rng';

type Counts = Record<string, number>[];
const rng = new SeededRng(7);

function tune(base: Machine, counts: Counts, spaced: string[], seeds: number[], score: (m: Machine) => number, iters = 3000, lim: Record<string,[number,number]> = {}, fixed?: (reel: number, key: string) => boolean) {
  const mk = (c: Counts): Machine => ({ ...base, reels: c.map((rc, i) => buildStrip(rc, spaced, seeds[i])) } as Machine);
  let best = counts, bestS = score(mk(counts));
  for (let it = 0; it < iters; it++) {
    const c = best.map(r => ({ ...r }));
    const n = 1 + rng.int(3);
    for (let k = 0; k < n; k++) {
      const reel = rng.int(c.length);
      const keys = Object.keys(c[reel]);
      const key = keys[rng.int(keys.length)];
      const lo = (lim[key]?.[0] ?? 1), hi = (lim[key]?.[1] ?? 99);
      if (fixed?.(reel, key)) continue;
      c[reel][key] = Math.min(hi, Math.max(lo, c[reel][key] + (rng.int(2) ? 1 : -1)));
    }
    const s = score(mk(c));
    if (s < bestS) { best = c; bestS = s; }
  }
  const m = mk(best); const a = analyzeMachine(m);
  console.log(base.name, 'score', bestS.toFixed(5), 'rtp', (a.rtp*100).toFixed(3), 'line', (a.lineRtp*100).toFixed(2), 'scat', (a.scatterRtp*100).toFixed(2), 'feat', (a.featureRtp*100).toFixed(2), '1 in', Math.round(1/(a.featureChance||1)), a.hitFrequency ? 'hit ' + (a.hitFrequency*100).toFixed(1) : '', 'lens', m.reels.map(r=>r.length).join('/'));
  console.log(JSON.stringify(best));
}

const pen = (x: number, lo: number, hi: number) => x < lo ? (lo - x) : x > hi ? (x - hi) : 0;

// Classic
tune(DIAMOND_SEVENS, [
  { DIAMOND: 1, SEVEN: 3, BAR3: 4, BAR2: 5, BAR1: 6, CHERRY: 4, BLANK: 21 },
  { DIAMOND: 1, SEVEN: 3, BAR3: 4, BAR2: 5, BAR1: 6, CHERRY: 3, BLANK: 22 },
  { DIAMOND: 1, SEVEN: 2, BAR3: 4, BAR2: 5, BAR1: 7, CHERRY: 3, BLANK: 22 }], ['DIAMOND'], [11,12,13], (m) => {
  const a = analyzeMachine(m);
  const len = m.reels.reduce((s, r) => s + r.length, 0) / 3;
  return Math.abs(a.rtp - 0.95) * 10 + pen(a.hitFrequency!, 0.12, 0.16) * 3 + pen(len, 40, 72) * 0.01;
}, 3000, { DIAMOND: [1, 2], SEVEN: [2, 6] });

const video = (feature: [number, number], share: [number, number], target: number) => (m: Machine) => {
  const a = analyzeMachine(m);
  const len = m.reels.reduce((s, r) => s + r.length, 0) / m.reels.length;
  return Math.abs(a.rtp - target) * 10 + pen(1 / a.featureChance, feature[0], feature[1]) * 0.002 + pen(a.featureRtp / a.rtp, share[0], share[1]) + pen(len, 40, 90) * 0.01;
};
const lagoC = (w: number, s: number) => ({ WILD: w, LION: 3, SWAN: 4, ROSE: 5, LEMON: 6, A: 7, K: 7, Q: 8, J: 8, T: 9, FOUNTAIN: s });
tune(LAGO_FORTUNA, [lagoC(1,2), lagoC(2,2), lagoC(2,2), lagoC(2,2), lagoC(1,2)], ['FOUNTAIN'], [21,22,23,24,25], video([100, 160], [0.25, 0.35], 0.92), 8000, { WILD: [0, 5], FOUNTAIN: [1, 3] });
const royC = (w: number, b: number) => ({ WILD: w, PEACOCK: 3, ORCHID: 4, CHANDELIER: 5, TULIP: 6, A: 7, K: 7, Q: 8, J: 8, T: 9, KEY: b });
tune(ROYAL_CONSERVATORY, [royC(1,2), royC(2,0), royC(2,2), royC(2,0), royC(1,2)], ['KEY'], [31,32,33,34,35], video([120, 220], [0.25, 0.35], 0.90), 8000, { WILD: [0, 5], KEY: [1, 4] }, (reel, key) => key === 'KEY' && (reel === 1 || reel === 3));
