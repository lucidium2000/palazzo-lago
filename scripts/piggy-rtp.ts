import { simulatePiggy } from '../src/rules/piggy';
import { SeededRng } from '../src/rules/rng';
const n = Number(process.argv[2] ?? 2_000_000);
const t = Date.now();
const r = simulatePiggy(new SeededRng(Number(process.argv[3] ?? 7)), n);
console.log({ ...r, rtp: r.rtp.toFixed(4), lineRtp: r.lineRtp.toFixed(4), bonusRtp: r.bonusRtp.toFixed(4), bonusEvery: (1 / r.bonusRate).toFixed(0), ms: Date.now() - t });
