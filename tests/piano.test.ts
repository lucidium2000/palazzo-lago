import { describe, expect, it } from 'vitest';
import {
  BLACK_H, BLACK_L, HIGH, KEY_LAYOUT, KEYS, LOW, PAD, PRESS, Voices, WHITE_L, WHITE_W, WIDTH, isBlack, keyAt, newFinger, stepFinger, strikeVelocity, typingNote,
  type FingerEvent,
} from '../src/client/pianokeys';
import { decodeNotes, encodeNotes, MAX_BATCH } from '../src/client/net/pianowire';
import { renderTone, toneLength, TONE_RATE, zoneOf, zones } from '../src/client/pianotone';

const key = (midi: number) => KEY_LAYOUT[midi - LOW];

describe('keyboard layout', () => {
  it('has 88 keys: 52 white, 36 black, A0 to C8, 1.222 m wide', () => {
    expect(KEY_LAYOUT.length).toBe(88);
    expect(KEYS).toBe(88);
    expect(KEY_LAYOUT.filter((k) => !k.black).length).toBe(52);
    expect(KEY_LAYOUT.filter((k) => k.black).length).toBe(36);
    expect(LOW).toBe(21);
    expect(HIGH).toBe(108);
    expect(WIDTH).toBeCloseTo(1.222, 3);
    expect(isBlack(61)).toBe(true);
    expect(isBlack(60)).toBe(false);
  });

  it('spaces white keys evenly and puts every black key between its two white neighbours', () => {
    const whites = KEY_LAYOUT.filter((k) => !k.black);
    for (let i = 1; i < whites.length; i++) expect(whites[i].x - whites[i - 1].x).toBeCloseTo(WHITE_W, 6);
    expect(whites[0].x).toBeCloseTo(-WIDTH / 2 + WHITE_W / 2, 6);
    for (const b of KEY_LAYOUT.filter((k) => k.black)) {
      const lo = key(b.midi - 1),
        hi = key(b.midi + 1);
      expect(b.x).toBeGreaterThan(lo.x);
      expect(b.x).toBeLessThan(hi.x);
      // Straddles the boundary between them.
      const edge = (lo.x + hi.x) / 2;
      expect(b.x - b.w / 2).toBeLessThan(edge);
      expect(b.x + b.w / 2).toBeGreaterThan(edge);
    }
    // The classic offsets: C# sits left of the C/D line, D# right of the D/E line.
    expect(key(61).x).toBeLessThan((key(60).x + key(62).x) / 2);
    expect(key(63).x).toBeGreaterThan((key(62).x + key(64).x) / 2);
    expect(key(68).x).toBeCloseTo((key(67).x + key(69).x) / 2, 6);
  });

  it('finds the key at a point: black keys in their region, white below and in front', () => {
    const c4 = key(60),
      cs4 = key(61);
    expect(keyAt(c4.x, 0.01)).toBe(60);
    expect(keyAt(cs4.x, WHITE_L - 0.02)).toBe(61);
    // In front of the black keys the same x is a white key.
    expect(keyAt(cs4.x, WHITE_L - BLACK_L - 0.01)).toBeGreaterThanOrEqual(60);
    expect(isBlack(keyAt(cs4.x, WHITE_L - BLACK_L - 0.01))).toBe(false);
    expect(keyAt(cs4.x, WHITE_L - 0.02, 'white')).not.toBe(61);
    expect(keyAt(c4.x, 0.01, 'black')).toBe(-1);
    // Off the keyboard.
    expect(keyAt(WIDTH, 0.05)).toBe(-1);
    expect(keyAt(0, -0.01)).toBe(-1);
    expect(keyAt(0, WHITE_L + 0.01)).toBe(-1);
    // Every key's own centre (in its own region) maps back to it.
    for (const k of KEY_LAYOUT) expect(keyAt(k.x, k.black ? WHITE_L - 0.03 : 0.01)).toBe(k.midi);
  });
});

describe('typing keys', () => {
  it('maps two rows to white and black keys, Z/X octaves move it', () => {
    expect(typingNote('KeyA', 4)).toBe(60);
    expect(typingNote('KeyW', 4)).toBe(61);
    expect(typingNote('KeyS', 4)).toBe(62);
    expect(typingNote('KeyE', 4)).toBe(63);
    expect(typingNote('KeyD', 4)).toBe(64);
    expect(typingNote('KeyF', 4)).toBe(65);
    expect(typingNote('KeyT', 4)).toBe(66);
    expect(typingNote('KeyK', 4)).toBe(72);
    expect(typingNote('KeyA', 3)).toBe(48);
    expect(typingNote('KeyQ', 4)).toBeNull();
    // Off the ends of the keyboard: nothing.
    expect(typingNote('KeyA', 0)).toBeNull();
    expect(typingNote('KeyH', 0)).toBe(21);
    expect(typingNote('KeyA', 7)).toBe(96);
    expect(typingNote('KeyK', 7)).toBe(108);
    expect(typingNote('KeyO', 7)).toBeNull();
    // White row keys are white keys, the upper row black.
    for (const c of ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote']) expect(isBlack(typingNote(c, 4)!)).toBe(false);
    for (const c of ['KeyW', 'KeyE', 'KeyT', 'KeyY', 'KeyU', 'KeyO', 'KeyP']) expect(isBlack(typingNote(c, 4)!)).toBe(true);
  });
});

describe('fingertips on the keys', () => {
  const ev: FingerEvent = { on: -1, vel: 0, off: -1 };
  /** Moves a fingertip joint (y is the joint; the pad is PAD below) through heights over frames at 72 fps. */
  function run(path: [number, number, number][], dt = 1 / 72) {
    const f = newFinger();
    const out: { on: number[]; off: number[]; vel: number[] } = { on: [], off: [], vel: [] };
    for (const [x, y, d] of path) {
      stepFinger(f, true, x, y + PAD, d, dt, ev);
      if (ev.off >= 0) out.off.push(ev.off);
      if (ev.on >= 0) {
        out.on.push(ev.on);
        out.vel.push(ev.vel);
      }
    }
    return { out, f };
  }
  const c4 = key(60);

  it('a finger coming down into a white key plays it once, holds it, and lets go when it lifts', () => {
    const path: [number, number, number][] = [];
    for (let y = 0.03; y > -0.008; y -= 0.004) path.push([c4.x, y, 0.03]);
    for (let i = 0; i < 10; i++) path.push([c4.x, -0.008, 0.03]);
    for (let y = -0.008; y < 0.03; y += 0.004) path.push([c4.x, y, 0.03]);
    const { out } = run(path);
    expect(out.on).toEqual([60]);
    expect(out.off).toEqual([60]);
  });

  it('a resting finger that does not push in plays nothing', () => {
    const path: [number, number, number][] = [];
    for (let i = 0; i < 30; i++) path.push([c4.x, -PRESS * 0.5, 0.03]);
    expect(run(path).out.on).toEqual([]);
  });

  it('velocity follows how fast the finger came down', () => {
    const strike = (speed: number) => {
      const path: [number, number, number][] = [];
      for (let y = 0.04; y > -0.03; y -= speed / 72) path.push([c4.x, y, 0.03]);
      return run(path).out.vel[0];
    };
    const soft = strike(0.15),
      loud = strike(1.5);
    expect(soft).toBeGreaterThan(0);
    expect(loud).toBeGreaterThan(soft + 0.3);
    expect(strikeVelocity(0)).toBeCloseTo(0.1);
    expect(strikeVelocity(10)).toBe(1);
  });

  it('coming down on a black key plays the black key, not the white one under it', () => {
    const cs = key(61);
    const path: [number, number, number][] = [];
    for (let y = 0.04; y > 0.002; y -= 0.005) path.push([cs.x, y, WHITE_L - 0.03]);
    const { out } = run(path);
    expect(out.on).toEqual([61]);
    expect(BLACK_H).toBeGreaterThan(0.01);
  });

  it('sliding along the keys pressed (a glissando) plays each key in turn', () => {
    const path: [number, number, number][] = [[key(60).x, 0.02, 0.02]];
    path.push([key(60).x, -0.006, 0.02]);
    for (let m = 60; m <= 72; m++) if (!isBlack(m)) path.push([key(m).x, -0.006, 0.02]);
    const { out } = run(path);
    expect(out.on).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
    expect(out.off).toEqual([60, 62, 64, 65, 67, 69, 71]);
  });

  it('a finger lost from tracking lets its key go', () => {
    const f = newFinger();
    stepFinger(f, true, c4.x, 0.02 + PAD, 0.03, 1 / 72, ev);
    stepFinger(f, true, c4.x, -0.006 + PAD, 0.03, 1 / 72, ev);
    expect(ev.on).toBe(60);
    stepFinger(f, false, 0, 0, 0, 1 / 72, ev);
    expect(ev.off).toBe(60);
    expect(f.key).toBe(-1);
  });

  it('a hand deep inside the piano or sweeping in from the side below the keys plays nothing', () => {
    const path: [number, number, number][] = [];
    // From in front of the keyboard (off the keys), below the key tops, sliding in.
    for (let d = -0.05; d < 0.05; d += 0.01) path.push([c4.x, -0.03, d]);
    expect(run(path).out.on).toEqual([]);
    expect(run([[c4.x, -0.2, 0.05], [c4.x, -0.2, 0.05]]).out.on).toEqual([]);
  });
});

describe('voices', () => {
  it('allocates free voices, restrikes the same note on its own voice, and steals released ones first', () => {
    const v = new Voices(4);
    const rel: number[] = [];
    const a = v.alloc(60, 0, 1),
      b = v.alloc(62, 0.1, 1),
      c = v.alloc(64, 0.2, 1),
      d = v.alloc(65, 0.3, 1);
    expect(new Set([a, b, c, d]).size).toBe(4);
    expect(v.active).toBe(4);
    // Same note again: same voice.
    expect(v.alloc(62, 0.4, 1)).toBe(b);
    // Let 64 go: it's the one stolen next, even though 60 is older.
    expect(v.keyUp(64, 0.5, rel)).toEqual([c]);
    expect(v.alloc(67, 0.6, 1)).toBe(c);
    // All held: the oldest goes.
    expect(v.alloc(69, 0.7, 1)).toBe(a);
    v.free(d);
    expect(v.alloc(71, 0.8, 1)).toBe(d);
  });

  it('the pedal holds released notes until it comes up', () => {
    const v = new Voices(8);
    const rel: number[] = [];
    const a = v.alloc(60, 0, 1);
    v.pedal(true, 0.1, rel);
    expect(v.keyUp(60, 0.2, rel)).toEqual([]);
    expect(v.v[a].pedal).toBe(true);
    const b = v.alloc(64, 0.3, 1);
    // Up with the pedal: only notes whose keys are up let go.
    expect(v.pedal(false, 0.4, rel)).toEqual([a]);
    expect(v.v[b].held).toBe(true);
    expect(v.keyUp(64, 0.5, rel)).toEqual([b]);
  });

  it('keeps to its voice count under a flurry', () => {
    const v = new Voices(24);
    const rel: number[] = [];
    for (let i = 0; i < 200; i++) {
      const n = 30 + ((i * 7) % 60);
      v.alloc(n, i * 0.01, 0.5);
      if (i % 3) v.keyUp(n, i * 0.01 + 0.005, rel);
    }
    expect(v.active).toBeLessThanOrEqual(24);
  });
});

describe('note batches on the wire', () => {
  it('round-trips note-ons, note-offs and the pedal with their timing', () => {
    const t0 = 1000;
    const batch = encodeNotes([
      { t: t0, midi: 60, vel: 100 },
      { t: t0 + 120, midi: 0, vel: 127 },
      { t: t0 + 250, midi: 60, vel: 0 },
    ]);
    expect(decodeNotes(batch)).toEqual([
      { dt: 0, midi: 60, vel: 100 },
      { dt: 0.12, midi: 0, vel: 127 },
      { dt: 0.25, midi: 60, vel: 0 },
    ]);
    expect(JSON.stringify(batch).length).toBeLessThan(40);
  });

  it('drops anything out of range or malformed', () => {
    expect(decodeNotes(null)).toEqual([]);
    expect(decodeNotes({ n: 'x' })).toEqual([]);
    expect(decodeNotes({ n: [0, 200, 50, 0, 60, 300, 0, 60.5, 1, -1, 60, 1, 0, 64, 90] })).toEqual([{ dt: 0, midi: 64, vel: 90 }]);
    expect(decodeNotes({ n: new Array(MAX_BATCH * 3 + 3).fill(0) })).toEqual([]);
    const many = Array.from({ length: 100 }, (_, i) => ({ t: i, midi: 60, vel: 1 }));
    expect(encodeNotes(many).n.length).toBe(MAX_BATCH * 3);
  });
});

describe('piano tone', () => {
  it('renders every zone, low notes longer than high ones, and every note is near a zone', () => {
    expect(toneLength(23)).toBeGreaterThan(toneLength(100));
    for (let m = LOW; m <= HIGH; m++) expect(Math.abs(m - zoneOf(m))).toBeLessThanOrEqual(2);
    expect(zones().length).toBe(22);
  });

  it('is a struck string: loud at the start, decaying, normalised, no clicks at the ends', () => {
    const b = renderTone(60, TONE_RATE);
    expect(b.length).toBe(Math.ceil(toneLength(60) * TONE_RATE));
    const rms = (a: number, n: number) => {
      let s = 0;
      for (let i = a; i < a + n; i++) s += b[i] * b[i];
      return Math.sqrt(s / n);
    };
    const early = rms(500, 2000),
      late = rms(Math.floor(b.length * 0.6), 2000);
    expect(early).toBeGreaterThan(late * 3);
    let peak = 0;
    for (const x of b) peak = Math.max(peak, Math.abs(x));
    expect(peak).toBeCloseTo(0.85, 2);
    expect(Math.abs(b[0])).toBeLessThan(0.01);
    expect(Math.abs(b[b.length - 1])).toBeLessThan(0.001);
  });

  it('plays the right pitch (autocorrelation of a mid note)', () => {
    const b = renderTone(69, TONE_RATE); // A4
    const from = Math.floor(0.3 * TONE_RATE),
      n = 4096;
    let best = 0,
      bestLag = 0;
    for (let lag = Math.floor(TONE_RATE / 520); lag <= Math.ceil(TONE_RATE / 380); lag++) {
      let s = 0;
      for (let i = from; i < from + n; i++) s += b[i] * b[i + lag];
      if (s > best) {
        best = s;
        bestLag = lag;
      }
    }
    const hz = TONE_RATE / bestLag;
    expect(hz).toBeGreaterThan(425);
    expect(hz).toBeLessThan(455);
  });
});

describe('the pianist', () => {
  it('can be knocked off his bench like any seated guest', async () => {
    const { unseatable } = await import('../src/client/bodies');
    const base = { seated: true, driven: false, keepSeat: false, offSeat: false };
    expect(unseatable({ ...base, role: 'pianist' } as never)).toBe(true);
    expect(unseatable({ ...base, role: 'pianist', offSeat: true } as never)).toBe(false);
    expect(unseatable({ ...base, role: 'bartender' } as never)).toBe(false);
  });
});
