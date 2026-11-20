import { SeededRng } from './rng';
import type { ClassicMachine, Machine, SymbolDef, VideoMachine } from './slots';

/**
 * Builds a virtual reel strip from symbol counts. "Spaced" symbols (scatter,
 * bonus, jackpot) are placed evenly so a 3-row window never shows two of them;
 * everything else is shuffled with a fixed seed so strips never change between
 * builds.
 */
export function buildStrip(counts: Record<string, number>, spaced: string[], seed: number): string[] {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const strip: (string | null)[] = new Array(total).fill(null);
  const special: string[] = [];
  for (const id of spaced) for (let i = 0; i < (counts[id] ?? 0); i++) special.push(id);
  const rng = new SeededRng(seed);
  const offset = rng.int(total);
  special.forEach((id, i) => {
    strip[(offset + Math.floor((i * total) / special.length)) % total] = id;
  });
  const rest: string[] = [];
  for (const [id, n] of Object.entries(counts)) {
    if (!spaced.includes(id)) for (let i = 0; i < n; i++) rest.push(id);
  }
  for (let i = rest.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  let k = 0;
  for (let i = 0; i < total; i++) if (strip[i] === null) strip[i] = rest[k++];
  return strip as string[];
}

// ---------------------------------------------------------------------------
// 1. Diamond Sevens: classic 3-reel, 1 line. Target RTP 95%.
// ---------------------------------------------------------------------------

const BARS = new Set(['BAR1', 'BAR2', 'BAR3']);
const all = (id: string) => (s: readonly string[]) => s.every((x) => x === id);
const cherries = (s: readonly string[]) => s.filter((x) => x === 'CHERRY').length;

export const DIAMOND_SEVENS: ClassicMachine = {
  type: 'classic',
  id: 'diamond-sevens',
  name: 'Diamond Sevens',
  tagline: 'Classic three-reel. Three diamonds pay 1,000x.',
  targetRtp: 0.95,
  betLevels: [1, 2, 5, 10, 25, 50, 100],
  symbols: [
    { id: 'DIAMOND', name: 'Diamond', kind: 'line' },
    { id: 'SEVEN', name: 'Seven', kind: 'line' },
    { id: 'BAR3', name: 'Triple Bar', kind: 'line' },
    { id: 'BAR2', name: 'Double Bar', kind: 'line' },
    { id: 'BAR1', name: 'Bar', kind: 'line' },
    { id: 'CHERRY', name: 'Cherry', kind: 'line' },
    { id: 'BLANK', name: 'Blank', kind: 'blank' },
  ],
  rules: [
    { name: 'Three Diamonds', pays: 1000, test: all('DIAMOND') },
    { name: 'Three Sevens', pays: 100, test: all('SEVEN') },
    { name: 'Three Triple Bars', pays: 40, test: all('BAR3') },
    { name: 'Three Double Bars', pays: 20, test: all('BAR2') },
    { name: 'Three Bars', pays: 10, test: all('BAR1') },
    { name: 'Any Three Bars', pays: 5, test: (s) => s.every((x) => BARS.has(x)) },
    { name: 'Three Cherries', pays: 20, test: (s) => cherries(s) === 3 },
    { name: 'Two Cherries', pays: 5, test: (s) => cherries(s) === 2 },
    { name: 'One Cherry', pays: 2, test: (s) => cherries(s) === 1 },
  ],
  reels: [
    buildStrip({ DIAMOND: 2, SEVEN: 3, BAR3: 7, BAR2: 7, BAR1: 7, CHERRY: 4, BLANK: 23 }, ['DIAMOND'], 11),
    buildStrip({ DIAMOND: 2, SEVEN: 6, BAR3: 3, BAR2: 7, BAR1: 6, CHERRY: 5, BLANK: 21 }, ['DIAMOND'], 12),
    buildStrip({ DIAMOND: 2, SEVEN: 6, BAR3: 3, BAR2: 9, BAR1: 6, CHERRY: 4, BLANK: 23 }, ['DIAMOND'], 13),
  ],
};

// ---------------------------------------------------------------------------
// Shared 20-line pattern for 5x3 video slots (row 0 top, 2 bottom).
// ---------------------------------------------------------------------------

export const LINES_20: number[][] = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [1, 0, 1, 2, 1],
  [1, 2, 1, 0, 1],
  [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2],
  [0, 1, 0, 1, 0],
  [2, 1, 2, 1, 2],
  [1, 1, 0, 1, 1],
  [1, 1, 2, 1, 1],
  [0, 0, 2, 0, 0],
  [2, 2, 0, 2, 2],
  [0, 2, 0, 2, 0],
];

const ROYAL_SYMBOLS: SymbolDef[] = [
  { id: 'A', name: 'Ace', kind: 'line', pays: { 3: 10, 4: 30, 5: 100 } },
  { id: 'K', name: 'King', kind: 'line', pays: { 3: 10, 4: 25, 5: 80 } },
  { id: 'Q', name: 'Queen', kind: 'line', pays: { 3: 8, 4: 20, 5: 60 } },
  { id: 'J', name: 'Jack', kind: 'line', pays: { 3: 6, 4: 15, 5: 50 } },
  { id: 'T', name: 'Ten', kind: 'line', pays: { 3: 5, 4: 15, 5: 40 } },
];

// ---------------------------------------------------------------------------
// 2. Lago Fortuna: 5x3, 20 lines, free spins at 2x. Target RTP 92%.
// ---------------------------------------------------------------------------

export const LAGO_FORTUNA: VideoMachine = {
  type: 'video',
  id: 'lago-fortuna',
  name: 'Lago Fortuna',
  tagline: '3 fountains = 10 free spins, all wins doubled.',
  targetRtp: 0.92,
  rows: 3,
  betLevels: [1, 2, 5, 10, 25, 50, 100],
  lines: LINES_20,
  symbols: [
    { id: 'WILD', name: 'Golden Crest (wild)', kind: 'wild', pays: { 3: 100, 4: 400, 5: 2000 } },
    { id: 'LION', name: 'Lion', kind: 'line', pays: { 2: 5, 3: 40, 4: 150, 5: 500 } },
    { id: 'SWAN', name: 'Swan', kind: 'line', pays: { 3: 30, 4: 100, 5: 300 } },
    { id: 'ROSE', name: 'Rose', kind: 'line', pays: { 3: 20, 4: 75, 5: 200 } },
    { id: 'LEMON', name: 'Lemon', kind: 'line', pays: { 3: 15, 4: 50, 5: 150 } },
    ...ROYAL_SYMBOLS,
    { id: 'FOUNTAIN', name: 'Fountain (scatter)', kind: 'scatter' },
  ],
  scatterPays: { 3: 2, 4: 10, 5: 50 },
  feature: { type: 'freeSpins', trigger: 3, spins: 10, multiplier: 2 },
  reels: [
    buildStrip({ WILD: 1, LION: 9, SWAN: 3, ROSE: 4, LEMON: 5, A: 6, K: 6, Q: 9, J: 7, T: 8, FOUNTAIN: 3 }, ['FOUNTAIN'], 21),
    buildStrip({ WILD: 3, LION: 3, SWAN: 2, ROSE: 3, LEMON: 7, A: 5, K: 7, Q: 10, J: 5, T: 6, FOUNTAIN: 3 }, ['FOUNTAIN'], 22),
    buildStrip({ WILD: 4, LION: 3, SWAN: 1, ROSE: 5, LEMON: 5, A: 7, K: 4, Q: 7, J: 6, T: 9, FOUNTAIN: 3 }, ['FOUNTAIN'], 23),
    buildStrip({ WILD: 5, LION: 6, SWAN: 5, ROSE: 4, LEMON: 7, A: 7, K: 4, Q: 9, J: 8, T: 7, FOUNTAIN: 1 }, ['FOUNTAIN'], 24),
    buildStrip({ WILD: 3, LION: 4, SWAN: 2, ROSE: 3, LEMON: 7, A: 6, K: 5, Q: 9, J: 8, T: 13, FOUNTAIN: 2 }, ['FOUNTAIN'], 25),
  ],
};

// ---------------------------------------------------------------------------
// 3. Royal Conservatory: 5x3, 20 lines, pick bonus. Target RTP 90%.
// ---------------------------------------------------------------------------

export const ROYAL_CONSERVATORY: VideoMachine = {
  type: 'video',
  id: 'royal-conservatory',
  name: 'Royal Conservatory',
  tagline: 'Keys on reels 1, 3 and 5 open the Garden Pick bonus.',
  targetRtp: 0.9,
  rows: 3,
  betLevels: [1, 2, 5, 10, 25, 50, 100],
  lines: LINES_20,
  symbols: [
    { id: 'WILD', name: 'Crown (wild)', kind: 'wild', pays: { 3: 50, 4: 300, 5: 2000 } },
    { id: 'PEACOCK', name: 'Peacock', kind: 'line', pays: { 3: 30, 4: 120, 5: 500 } },
    { id: 'ORCHID', name: 'Orchid', kind: 'line', pays: { 3: 20, 4: 80, 5: 300 } },
    { id: 'CHANDELIER', name: 'Chandelier', kind: 'line', pays: { 3: 15, 4: 60, 5: 200 } },
    { id: 'TULIP', name: 'Tulip', kind: 'line', pays: { 3: 10, 4: 40, 5: 120 } },
    ...ROYAL_SYMBOLS,
    { id: 'KEY', name: 'Golden Key (bonus)', kind: 'bonus' },
  ],
  scatterPays: {},
  feature: {
    type: 'pick',
    reels: [0, 2, 4],
    picks: 3,
    prizes: [2, 3, 5, 5, 8, 10, 10, 15, 20, 25, 50, 100],
  },
  reels: [
    buildStrip({ WILD: 3, PEACOCK: 3, ORCHID: 1, CHANDELIER: 5, TULIP: 6, A: 2, K: 7, Q: 6, J: 5, T: 9, KEY: 3 }, ['KEY'], 31),
    buildStrip({ WILD: 4, PEACOCK: 4, ORCHID: 2, CHANDELIER: 5, TULIP: 8, A: 6, K: 7, Q: 7, J: 7, T: 8, KEY: 0 }, ['KEY'], 32),
    buildStrip({ WILD: 3, PEACOCK: 4, ORCHID: 4, CHANDELIER: 3, TULIP: 6, A: 5, K: 6, Q: 5, J: 8, T: 8, KEY: 3 }, ['KEY'], 33),
    buildStrip({ WILD: 4, PEACOCK: 5, ORCHID: 2, CHANDELIER: 5, TULIP: 7, A: 6, K: 7, Q: 4, J: 8, T: 11, KEY: 0 }, ['KEY'], 34),
    buildStrip({ WILD: 1, PEACOCK: 2, ORCHID: 4, CHANDELIER: 4, TULIP: 5, A: 6, K: 7, Q: 8, J: 6, T: 9, KEY: 3 }, ['KEY'], 35),
  ],
};

export const MACHINES: readonly Machine[] = [DIAMOND_SEVENS, LAGO_FORTUNA, ROYAL_CONSERVATORY];
