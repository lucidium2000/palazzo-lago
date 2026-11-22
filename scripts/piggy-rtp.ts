/**
 * Porkbelly Payday math check.
 *   npx tsx scripts/piggy-rtp.ts [spins] [seed]
 * Prints long-run RTP from fresh banks, then the advantage-play return by
 * starting Blue count (play until the first bonus with Blue ends).
 */
import { apValue, simulatePiggy } from '../src/rules/piggy';
import { SeededRng } from '../src/rules/rng';

const n = Number(process.argv[2] ?? 2_000_000);
const seed = Number(process.argv[3] ?? 7);
const t = Date.now();
const r = simulatePiggy(new SeededRng(seed), n);
console.log('long run from fresh banks:', {
  rtp: r.rtp.toFixed(4),
  base: r.baseRtp.toFixed(4),
  bonus: r.bonusRtp.toFixed(4),
  jackpots: r.jackpotRtp.toFixed(4),
  bonusEvery: (1 / r.bonusRate).toFixed(0),
  combos: r.combos,
  ms: Date.now() - t,
});
const sessions = Number(process.argv[4] ?? 20000);
for (const blue of [9, 15, 18, 22, 25, 30, 40, 60]) {
  const a = apValue(new SeededRng(seed + blue), blue, sessions);
  console.log(`start Blue ${String(blue).padStart(3)}: RTP ${(a.rtp * 100).toFixed(1)}%  (avg ${a.avgSpins.toFixed(0)} spins to a Blue bonus)`);
}
