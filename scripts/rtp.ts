import { MACHINES } from '../src/rules/machines';
import { analyzeMachine } from '../src/rules/slots';
for (const m of MACHINES) {
  const a = analyzeMachine(m);
  console.log(m.name.padEnd(20), 'len', m.reels.map(r=>r.length).join('/'), 'rtp', (a.rtp*100).toFixed(3), 'line', (a.lineRtp*100).toFixed(2), 'scat', (a.scatterRtp*100).toFixed(2), 'feat', (a.featureRtp*100).toFixed(2), '1 in', Math.round(1/(a.featureChance||1)), a.hitFrequency?'hit '+(a.hitFrequency*100).toFixed(1):'');
}
