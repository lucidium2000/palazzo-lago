import { NO_SFX, Rng, SCREEN_H, SCREEN_W, STEP, type Game, type GameMeta, type Input, type SfxName, type Song } from '../types';
import { num, shadowText, text } from '../font';
import { sprite } from '../gfx';
import { notes } from '../music';

/**
 * VELVET BEAT: a one-button rhythm game in a lounge. The house band plays;
 * drum hits slide along the lane to the ring and you hit any button as each
 * one lands (long bars: press and hold to the end). Perfect and Good hits
 * keep the groove meter up and build a combo (up to x4); misses drain it.
 * Three sets, each faster, then the band keeps raising the tempo. Lose the
 * groove and the band packs up.
 */

/** Hit windows (s). */
export const PERFECT = 0.055;
export const GOOD = 0.12;
const RING_X = 66;
const PX_PER_BEAT = 96;
const LANE_Y = 168;
const MAX_NOTES = 256;

interface SetDef {
  name: string;
  song: Song;
  /** Per pattern: x tap, h hold start, = hold, . nothing (16 steps). */
  charts: string[];
}

/** Drums from a chart: kicks and snares where the hits are, hats between. */
function drumsFor(chart: string): string {
  let out = '';
  for (let i = 0; i < chart.length; i++) {
    const c = chart[i];
    if (c === 'x') out += i % 8 === 4 ? 's' : i % 4 === 0 ? 'k' : i % 2 === 0 ? 's' : 'k';
    else if (c === 'h') out += 'o';
    else out += i % 2 === 0 ? 'h' : '.';
  }
  return out;
}

function set(name: string, bpm: number, lead: string[], bass: string[], charts: string[], order: number[], wave: Song['leadWave'] = 'triangle'): SetDef {
  return {
    name,
    charts,
    song: {
      bpm,
      order,
      leadWave: wave,
      bassWave: 'triangle',
      gain: 0.75,
      patterns: charts.map((c, i) => ({ lead: notes(lead[i]), bass: notes(bass[i]), drums: drumsFor(c) })),
    },
  };
}

export const SETS: SetDef[] = [
  set(
    'LATE SET',
    96,
    ['A4 . C5 . E5 - D5 . C5 . A4 . G4 - . .', 'F4 . A4 . C5 . E5 - D5 . C5 . A4 - . .', 'G4 - - - Bb4 . D5 . F5 - E5 . D5 . C5 .', 'A4 . G4 . F4 . E4 . F4 . G4 . A4 - - -'],
    ['F2 . . . A2 . . . Bb2 . . . A2 . G2 .', 'D2 . . . F2 . . . G2 . . . C3 . . .', 'G2 . . . Bb2 . . . C3 . . . E2 . . .', 'F2 . A2 . C3 . A2 . F2 . E2 . D2 . C2 .'],
    ['x...x...x...x...', 'x...x...x.x.x...', 'h=======x...x...', 'x...x.x.x...h==='],
    [0, 1, 0, 2, 0, 1, 3, 2, 0, 1, 3, 3],
  ),
  set(
    'COCKTAIL HOUR',
    112,
    ['C5 . E5 G5 . E5 C5 . D5 . F5 A5 . F5 D5 .', 'E5 . G5 B5 . A5 G5 . F5 . E5 D5 . C5 B4 .', 'C5 - - - E5 - - - G5 . F5 . E5 . D5 .', 'A5 . G5 . E5 . C5 . D5 . E5 . C5 - . .'],
    ['C2 . G2 . C3 . G2 . D2 . A2 . D3 . A2 .', 'E2 . B2 . A2 . E2 . F2 . C3 . G2 . D3 .', 'C2 . . C3 . . G2 . F2 . . F3 . . G2 .', 'A2 . E3 . F2 . C3 . G2 . D3 . C3 . C2 .'],
    ['x..xx...x..xx...', 'x...x..xx.x.x...', 'h===....h===x.x.', 'x.x.x.x.x..xx.x.'],
    [0, 1, 0, 2, 1, 0, 3, 2, 0, 1, 3, 3],
    'pulse',
  ),
  set(
    'LAST CALL',
    128,
    ['D5 . F5 . A5 . G5 F5 E5 . C5 . D5 . . .', 'F5 . A5 . C6 . A5 . G5 . E5 . C5 . E5 .', 'D5 - - - . . A4 . C5 - - - . . E5 .', 'D6 . C6 . A5 . G5 . F5 . E5 . D5 - - -'],
    ['D2 D3 D2 D3 F2 F3 F2 F3 C2 C3 C2 C3 A1 A2 A1 A2', 'Bb1 Bb2 Bb1 Bb2 C2 C3 C2 C3 F2 F3 F2 F3 A1 A2 A1 A2', 'G1 G2 G1 G2 A1 A2 A1 A2 Bb1 Bb2 Bb1 Bb2 C2 C3 C2 C3', 'D2 D3 C2 C3 Bb1 Bb2 A1 A2 G1 G2 A1 A2 D2 D3 D2 D3'],
    ['x.xxx..xx.xxx..x', 'h=======x.x.x.xx', 'x..x..x.x..x..x.', 'xxxxx...h===x.x.'],
    [0, 1, 0, 2, 1, 0, 3, 2, 1, 0, 3, 3],
    'square',
  ),
];

export interface ChartNote {
  /** Beat it lands on, and how long it's held (0: a tap). */
  beat: number;
  len: number;
}

/** The notes of a set, in beats from the set's start. */
export function buildChart(s: SetDef): ChartNote[] {
  const out: ChartNote[] = [];
  s.song.order.forEach((pi, bar) => {
    const c = s.charts[pi];
    for (let i = 0; i < c.length; i++) {
      if (c[i] === 'x') out.push({ beat: bar * 4 + i / 4, len: 0 });
      else if (c[i] === 'h') {
        let j = i + 1;
        while (j < c.length && c[j] === '=') j++;
        out.push({ beat: bar * 4 + i / 4, len: (j - i) / 4 });
      }
    }
  });
  return out;
}

/** Judges a press `dt` seconds off the note (negative: early). */
export function judge(dt: number): 'perfect' | 'good' | null {
  const a = Math.abs(dt);
  return a <= PERFECT ? 'perfect' : a <= GOOD ? 'good' : null;
}

/** The combo multiplier for a combo count. */
export function comboMult(combo: number): number {
  return Math.min(4, 1 + Math.floor(combo / 10));
}

export const VELVET_META: GameMeta = {
  id: 'velvet',
  title: 'VELVET',
  sub: 'BEAT',
  tagline: 'KEEP THE BAND IN THE GROOVE',
  howTo: ['ONE BUTTON: ANY BUTTON', 'HIT AS THE DRUM REACHES', 'THE RING. LONG BARS: HOLD', 'PERFECT HITS BUILD COMBO', 'MISSES DRAIN THE GROOVE'],
  buttons: ['HIT', 'HIT', 'HIT'],
  players: 1,
  colors: { body: '#2a0610', trim: '#ff5a6e', accent: '#ffd34d', accent2: '#f4efe4', bg: '#1a0309' },
  song: SETS[0].song,
};

/** Lead-in before the first set's first beat (beats). */
const LEAD_IN = 4;

export class Velvet implements Game {
  readonly meta = VELVET_META;
  score = 0;
  over = false;
  level = 1;
  sfx: (name: SfxName, vol?: number, pitch?: number) => void = NO_SFX;
  private rng = new Rng(1);
  /** Which set is playing (0-based, keeps counting past three), and the beat within it (negative: lead-in). */
  setIx = 0;
  beat = -LEAD_IN;
  private chart: ChartNote[] = [];
  /** Per note: 0 waiting, 1 hit (holding for holds), 2 done, 3 missed. */
  private state = new Uint8Array(MAX_NOTES);
  combo = 0;
  maxCombo = 0;
  groove = 0.6;
  hits = 0;
  perfects = 0;
  misses = 0;
  private judgeText: 'PERFECT' | 'GOOD' | 'MISS' | '' = '';
  private judgeT = 0;
  private hitAnim = 0;
  private setDone = 0;
  private held = -1;
  private time = 0;
  private bpmNow = 96;
  private songNow: Song = SETS[0].song;

  start(_players: 1 | 2, seed: number) {
    this.rng.seed(seed);
    this.score = 0;
    this.over = false;
    this.combo = 0;
    this.maxCombo = 0;
    this.groove = 0.6;
    this.hits = this.perfects = this.misses = 0;
    this.time = 0;
    this.loadSet(0);
  }

  private loadSet(i: number) {
    this.setIx = i;
    this.level = i + 1;
    const def = SETS[Math.min(i, SETS.length - 1)];
    this.chart = buildChart(def);
    this.state.fill(0);
    this.beat = -LEAD_IN;
    this.held = -1;
    // Past the third set the band speeds up each time round.
    this.bpmNow = def.song.bpm + Math.max(0, i - (SETS.length - 1)) * 8;
  }

  /** The song the cabinet should play now and where in it we are (beats), for the music to follow the chart. */
  musicSong(): Song | null {
    if (this.over || this.setDone > 0) return null;
    const def = SETS[Math.min(this.setIx, SETS.length - 1)];
    if (this.songNow.bpm !== this.bpmNow || this.songNow.patterns !== def.song.patterns) this.songNow = { ...def.song, bpm: this.bpmNow };
    return this.songNow;
  }

  musicBeat(): number {
    return this.beat;
  }

  get bpm() {
    return this.bpmNow;
  }

  private get spb() {
    return 60 / this.bpmNow;
  }

  step(p: Input) {
    const dt = STEP;
    this.time += dt;
    this.judgeT = Math.max(0, this.judgeT - dt);
    this.hitAnim = Math.max(0, this.hitAnim - dt);
    if (this.over) return;
    if (this.setDone > 0) {
      this.setDone -= dt;
      if (this.setDone <= 0) this.loadSet(this.setIx + 1);
      return;
    }
    this.beat += dt / this.spb;
    const press = p.ap || p.bp || p.cp;
    const down = p.a || p.b || p.c;
    if (press) {
      this.hitAnim = 0.12;
      // The nearest waiting note in the window.
      let best = -1,
        bd = 1e9;
      for (let i = 0; i < this.chart.length; i++) {
        if (this.state[i] !== 0) continue;
        const d = (this.beat - this.chart[i].beat) * this.spb;
        if (d < -GOOD) break;
        if (Math.abs(d) < bd) {
          bd = Math.abs(d);
          best = i;
        }
      }
      const j = best >= 0 ? judge((this.beat - this.chart[best].beat) * this.spb) : null;
      if (best >= 0 && j) {
        this.hits++;
        this.combo++;
        this.maxCombo = Math.max(this.maxCombo, this.combo);
        if (j === 'perfect') this.perfects++;
        this.score += (j === 'perfect' ? 300 : 100) * comboMult(this.combo);
        this.groove = Math.min(1, this.groove + (j === 'perfect' ? 0.035 : 0.018));
        this.judgeText = j === 'perfect' ? 'PERFECT' : 'GOOD';
        this.judgeT = 0.45;
        this.sfx(j === 'perfect' ? 'perfect' : 'hit', 0.6);
        if (this.chart[best].len > 0) {
          this.state[best] = 1;
          this.held = best;
        } else this.state[best] = 2;
      } else this.sfx('tick', 0.3);
    }
    // Holding a long note: points as you hold, done at its end, dropped if you let go.
    if (this.held >= 0) {
      const n = this.chart[this.held];
      const end = n.beat + n.len;
      if (!down && this.beat < end - 0.15) {
        this.state[this.held] = 2;
        this.held = -1;
        this.combo = 0;
        this.judgeText = 'MISS';
        this.judgeT = 0.45;
        this.sfx('miss', 0.4);
      } else if (this.beat >= end) {
        this.state[this.held] = 2;
        this.held = -1;
        this.score += 200 * comboMult(this.combo);
        this.sfx('perfect', 0.5, 1.5);
      } else this.score += Math.round(dt * 60);
    }
    // Notes that went by.
    for (let i = 0; i < this.chart.length; i++) {
      if (this.state[i] !== 0) continue;
      const d = (this.beat - this.chart[i].beat) * this.spb;
      if (d < GOOD) break;
      this.state[i] = 3;
      this.misses++;
      this.combo = 0;
      this.groove -= 0.11;
      this.judgeText = 'MISS';
      this.judgeT = 0.45;
      this.sfx('miss', 0.5);
      if (this.groove <= 0) {
        this.groove = 0;
        this.over = true;
        this.sfx('over', 1);
        return;
      }
    }
    // End of the set.
    const last = this.chart[this.chart.length - 1];
    if (last && this.beat > last.beat + last.len + 2) {
      this.setDone = 3;
      const acc = this.accuracy();
      this.score += Math.round(acc * 50) * 100;
      this.sfx('fanfare', 1);
    }
  }

  accuracy() {
    const judged = this.hits + this.misses;
    return judged ? (this.perfects + (this.hits - this.perfects) * 0.5) / judged : 1;
  }

  // ---------------------------------------------------------------------------
  private art: { stage: HTMLCanvasElement } | null = null;
  private sprites() {
    if (this.art) return this.art;
    const stage = sprite(SCREEN_W, SCREEN_H, (g) => {
      // Velvet curtains, a little stage, a spotlight.
      g.fillStyle = '#1a0309';
      g.fillRect(0, 0, SCREEN_W, SCREEN_H);
      for (let x = 0; x < SCREEN_W; x += 10) {
        const gr = g.createLinearGradient(x, 0, x + 10, 0);
        gr.addColorStop(0, '#3a0610');
        gr.addColorStop(0.5, '#8a1428');
        gr.addColorStop(1, '#3a0610');
        g.fillStyle = gr;
        g.fillRect(x, 0, 10, 130);
      }
      const sp = g.createRadialGradient(200, 110, 6, 200, 120, 110);
      sp.addColorStop(0, 'rgba(255,230,180,0.45)');
      sp.addColorStop(1, 'rgba(255,230,180,0)');
      g.fillStyle = sp;
      g.fillRect(0, 0, SCREEN_W, 150);
      g.fillStyle = '#2a1408';
      g.fillRect(0, 128, SCREEN_W, 12);
      g.fillStyle = '#ffd34d';
      g.fillRect(0, 128, SCREEN_W, 1);
      g.fillStyle = '#0c0306';
      g.fillRect(0, 140, SCREEN_W, 100);
      // Footlights.
      for (let x = 8; x < SCREEN_W; x += 22) {
        g.fillStyle = '#ffd34d';
        g.fillRect(x, 136, 3, 2);
      }
    });
    return (this.art = { stage });
  }

  /** The drummer: a hand-drawn cat-eyed jazzman in shades (original), arms by hit. */
  private drummer(g: CanvasRenderingContext2D, t: number, hit: number, bob: number, x = 200) {
    const y = 96 + bob;
    // Kit: bass drum, snare, cymbals.
    g.fillStyle = '#d8d0e8';
    g.beginPath();
    g.arc(x, 112, 16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#8a1428';
    g.beginPath();
    g.arc(x, 112, 13, 0, Math.PI * 2);
    g.fill();
    text(g, 'VB', x, 109, '#ffd34d', 1, 'center');
    g.fillStyle = '#ffd34d';
    g.fillRect(x - 40, 86 - (hit > 0 ? 2 : 0), 22, 2);
    g.fillRect(x + 20, 84, 24, 2);
    g.fillStyle = '#a0a0b0';
    g.fillRect(x - 30, 88, 1, 36);
    g.fillRect(x + 31, 86, 1, 38);
    g.fillStyle = '#e8e8f0';
    g.fillRect(x - 26, 100, 16, 5);
    // Body.
    g.fillStyle = '#16121c';
    g.fillRect(x - 9, y - 6, 18, 22);
    g.fillStyle = '#f4efe4';
    g.fillRect(x - 2, y - 6, 4, 10);
    g.fillStyle = '#ff5a6e';
    g.fillRect(x - 2, y - 5, 4, 2);
    // Head, shades, a hat.
    g.fillStyle = '#c98a5a';
    g.fillRect(x - 6, y - 18, 12, 12);
    g.fillStyle = '#05050a';
    g.fillRect(x - 6, y - 14, 12, 3);
    g.fillStyle = '#16121c';
    g.fillRect(x - 9, y - 20, 18, 2);
    g.fillRect(x - 6, y - 26, 12, 6);
    g.fillStyle = '#ff5a6e';
    g.fillRect(x - 6, y - 22, 12, 1);
    // Arms and sticks.
    const up = hit > 0 ? 0 : 1;
    g.strokeStyle = '#16121c';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x - 8, y - 2);
    g.lineTo(x - 18, y + 2 + up * -6);
    g.moveTo(x + 8, y - 2);
    g.lineTo(x + 18, y + 2 + (Math.floor(t * 4) % 2) * -4);
    g.stroke();
    g.strokeStyle = '#f4d9a0';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x - 18, y + 2 + up * -6);
    g.lineTo(x - 28, y + (hit > 0 ? 8 : -10));
    g.moveTo(x + 18, y + 2);
    g.lineTo(x + 30, y - 8);
    g.stroke();
  }

  draw(g: CanvasRenderingContext2D, t: number) {
    const a = this.sprites();
    g.drawImage(a.stage, 0, 0);
    const beatPh = this.beat - Math.floor(this.beat);
    const bob = beatPh < 0.2 ? 1 : 0;
    this.drummer(g, t, this.hitAnim, bob);
    // The lane.
    g.fillStyle = '#05010a';
    g.fillRect(0, LANE_Y - 18, SCREEN_W, 36);
    g.fillStyle = '#ff5a6e';
    g.fillRect(0, LANE_Y - 18, SCREEN_W, 1);
    g.fillRect(0, LANE_Y + 17, SCREEN_W, 1);
    // Beat ticks scrolling in.
    g.fillStyle = '#3a1020';
    const first = Math.ceil(this.beat);
    for (let b = first; (b - this.beat) * PX_PER_BEAT + RING_X < SCREEN_W; b++) {
      const x = RING_X + (b - this.beat) * PX_PER_BEAT;
      g.fillRect(x | 0, LANE_Y - 16, 1, 32);
    }
    // The ring, pulsing on the beat.
    const pulse = beatPh < 0.15 ? 3 : 0;
    g.strokeStyle = this.hitAnim > 0 ? '#ffffff' : '#ffd34d';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(RING_X, LANE_Y, 12 + pulse, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 0.25;
    g.lineWidth = 6;
    g.stroke();
    g.globalAlpha = 1;
    // Notes.
    for (let i = 0; i < this.chart.length; i++) {
      const st = this.state[i];
      if (st === 2 || st === 3) continue;
      const n = this.chart[i];
      const x = RING_X + (n.beat - this.beat) * PX_PER_BEAT;
      if (x > SCREEN_W + 10) break;
      if (n.len > 0) {
        const x2 = RING_X + (n.beat + n.len - this.beat) * PX_PER_BEAT;
        g.fillStyle = st === 1 ? '#ffd34d' : '#a8641a';
        g.fillRect(Math.max(RING_X, x) | 0, LANE_Y - 4, Math.max(0, x2 - Math.max(RING_X, x)) | 0, 8);
      }
      if (st === 1) continue;
      const kick = Math.round(n.beat) === n.beat;
      g.fillStyle = '#000000';
      g.beginPath();
      g.arc(x, LANE_Y + 1, 9, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = kick ? '#ffb03a' : '#f4efe4';
      g.beginPath();
      g.arc(x, LANE_Y, 8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = kick ? '#8a4a10' : '#9a90b0';
      g.beginPath();
      g.arc(x, LANE_Y, 5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffffff';
      g.fillRect(x - 4, LANE_Y - 5, 3, 2);
    }
    // Judgement and combo.
    if (this.judgeT > 0) {
      const c = this.judgeText === 'PERFECT' ? '#ffd34d' : this.judgeText === 'GOOD' ? '#4de2c1' : '#ff3864';
      shadowText(g, this.judgeText, RING_X, LANE_Y - 40 - (0.45 - this.judgeT) * 20, c, 2, 'center');
    }
    if (this.combo >= 5) {
      text(g, 'COMBO', 160, 200, '#ff5a6e', 1, 'center');
      num(g, this.combo, 160, 210, '#ffffff', 2, 'center');
      text(g, 'X', 230, 210, '#ffd34d', 2);
      num(g, comboMult(this.combo), 244, 210, '#ffd34d', 2);
    }
    // Top: score, set, groove meter.
    g.fillStyle = '#000000';
    g.globalAlpha = 0.6;
    g.fillRect(0, 0, SCREEN_W, 22);
    g.globalAlpha = 1;
    text(g, 'SCORE', 4, 3, '#ff5a6e');
    num(g, this.score, 4, 12, '#ffffff');
    text(g, SETS[Math.min(this.setIx, SETS.length - 1)].name, 160, 3, '#ffd34d', 1, 'center');
    text(g, 'BPM', 140, 12, '#ff5a6e');
    num(g, this.bpmNow, 162, 12, '#ffffff');
    text(g, 'GROOVE', 316, 3, '#ff5a6e', 1, 'right');
    g.fillStyle = '#2a0610';
    g.fillRect(256, 12, 60, 6);
    g.fillStyle = this.groove < 0.25 && Math.floor(t * 6) % 2 ? '#ff3864' : '#4de2c1';
    g.fillRect(256, 12, Math.round(60 * this.groove), 6);
    if (this.beat < 0 && !this.over) {
      const n = Math.ceil(-this.beat);
      shadowText(g, n <= 3 ? '' : 'READY', 160, 60, '#ffffff', 2, 'center');
      if (n <= 3) num(g, n, 160, 56, '#ffd34d', 3, 'center');
    }
    if (this.setDone > 0) {
      shadowText(g, 'SET COMPLETE', 160, 50, '#ffd34d', 2, 'center');
      text(g, 'ACCURACY', 150, 74, '#ffffff', 1, 'right');
      num(g, Math.round(this.accuracy() * 100), 170, 74, '#4de2c1');
      text(g, '%', 190, 74, '#4de2c1');
    }
  }

  attract(g: CanvasRenderingContext2D, t: number) {
    const a = this.sprites();
    g.drawImage(a.stage, 0, 0);
    this.drummer(g, t, Math.floor(t * 4) % 2 ? 0.1 : 0, Math.floor(t * 2) % 2, 262);
    for (let k = 0; k < 6; k++) {
      const x = ((k * 60 - t * 50) % 360) + 30;
      g.fillStyle = k % 2 ? '#ffb03a' : '#f4efe4';
      g.beginPath();
      g.arc(x < 0 ? x + 360 : x, LANE_Y, 8, 0, Math.PI * 2);
      g.fill();
    }
    // Floating notes.
    for (let k = 0; k < 5; k++) text(g, '*', (40 + k * 60 + Math.sin(t + k) * 10) | 0, (60 + Math.sin(t * 1.3 + k * 2) * 20) | 0, '#ffd34d', 1);
  }

  snap(o: number[]) {
    o.length = 0;
    o.push(this.score, this.setIx, Math.round(this.beat * 100), this.combo, Math.round(this.groove * 100), this.held, Math.round(this.setDone * 10), this.over ? 1 : 0, this.hitAnim > 0 ? 1 : 0);
    // Notes near the lane: which have gone (index offset + flags).
    let firstLive = 0;
    while (firstLive < this.chart.length && this.state[firstLive] >= 2) firstLive++;
    o.push(firstLive);
    for (let i = firstLive; i < Math.min(this.chart.length, firstLive + 24); i++) o.push(this.state[i]);
  }

  load(a: readonly number[]) {
    let k = 0;
    const r = () => Number(a[k++]) || 0;
    this.score = r();
    const s = r();
    if (s !== this.setIx || !this.chart.length) this.loadSet(s);
    this.beat = r() / 100;
    this.combo = r();
    this.groove = r() / 100;
    this.held = r();
    this.setDone = r() / 10;
    this.over = r() === 1;
    if (r()) this.hitAnim = 0.12;
    const first = r();
    for (let i = 0; i < first && i < this.chart.length; i++) if (this.state[i] < 2) this.state[i] = 2;
    for (let i = first; k < a.length && i < this.chart.length; i++) this.state[i] = r();
  }

  /** Watching a friend: the lane keeps scrolling between their updates. */
  predict(dt: number) {
    if (!this.over && this.setDone <= 0) this.beat += dt / this.spb;
  }
}
