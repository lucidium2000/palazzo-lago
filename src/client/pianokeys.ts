/**
 * The grand piano's keyboard, as numbers: where each of the 88 keys is, which
 * key a point on the keyboard falls on, which computer key plays which note,
 * how a fingertip pressing down into the keys turns into note-on / note-off
 * events (with a velocity from how fast it came down), and which synth voice
 * a new note gets (24 voices, stealing the least audible one).
 *
 * Pure (no three.js, no WebAudio): piano.ts draws and plays it; unit tested.
 *
 * Keyboard frame (metres): x runs left to right across the keys (0 at the
 * keyboard's middle), y up (0 = the top of the white keys), d = depth back
 * from the front edge of the white keys (0 at the front, WHITE_L at the back).
 */

/** Lowest note (A0) and the number of keys. */
export const LOW = 21;
export const KEYS = 88;
export const HIGH = LOW + KEYS - 1;
/** A real keyboard's proportions: 52 white keys of 23.5 mm make 1.222 m. */
export const WHITE_W = 0.0235;
export const WHITE_L = 0.15;
export const BLACK_W = 0.0137;
export const BLACK_L = 0.095;
/** Black keys stand this far above the white ones. */
export const BLACK_H = 0.012;
export const WHITES = 52;
export const WIDTH = WHITES * WHITE_W;
/** How far a key goes down when pressed (at the front edge). */
export const DIP = 0.0095;

const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];
export const isBlack = (midi: number) => BLACK[((midi % 12) + 12) % 12];

/**
 * Black key centres within the octave, in white-key widths from C's left edge
 * (the classic layout: the C-E group split in five equal parts, F-B in seven).
 */
const BLACK_CENTRE: Record<number, number> = { 1: 0.9, 3: 2.1, 6: 3 + 1.5 * (4 / 7), 8: 3 + 3.5 * (4 / 7), 10: 3 + 5.5 * (4 / 7) };
/** White keys' index within the octave (C=0 … B=6). */
const WHITE_IDX: Record<number, number> = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };

/** White keys below a note (A0 is white key 0). */
function whitesBelow(midi: number): number {
  // Count white keys from C0 (midi 12) up to `midi`, minus those below A0.
  const fromC = (m: number) => {
    const oct = Math.floor((m - 12) / 12);
    const pc = (m - 12) - oct * 12;
    let w = oct * 7;
    for (let k = 0; k < pc; k++) if (!BLACK[k]) w++;
    return w;
  };
  return fromC(midi) - fromC(LOW);
}

export interface KeyInfo {
  midi: number;
  black: boolean;
  /** Centre across the keyboard (m, 0 = middle) and width. */
  x: number;
  w: number;
  /** Length from the back (black keys are shorter, set back from the front). */
  len: number;
  /** For white keys: the index among white keys; for black: among black keys. */
  slot: number;
}

/** Every key, lowest first. */
export function layout(): KeyInfo[] {
  const keys: KeyInfo[] = [];
  let wi = 0,
    bi = 0;
  for (let midi = LOW; midi <= HIGH; midi++) {
    const pc = midi % 12;
    if (!isBlack(midi)) {
      keys.push({ midi, black: false, x: (wi + 0.5) * WHITE_W - WIDTH / 2, w: WHITE_W, len: WHITE_L, slot: wi });
      wi++;
    } else {
      // Left edge of this octave's C, in white keys from A0.
      const cLeft = whitesBelow(midi) - WHITE_IDX[pc - 1] - 1;
      const centre = (cLeft + BLACK_CENTRE[pc]) * WHITE_W - WIDTH / 2;
      keys.push({ midi, black: true, x: centre, w: BLACK_W, len: BLACK_L, slot: bi });
      bi++;
    }
  }
  return keys;
}

export const KEY_LAYOUT: readonly KeyInfo[] = layout();

/**
 * The key at (x, d) on the keyboard (black keys win where they are, since they
 * sit on top), or -1. `blackOnly`/`whiteOnly` restrict the search (a point
 * level with the white keys' tops, between two black keys, is a white key).
 */
export function keyAt(x: number, d: number, which: 'any' | 'black' | 'white' = 'any'): number {
  if (d < 0 || d > WHITE_L || x < -WIDTH / 2 || x > WIDTH / 2) return -1;
  const u = x + WIDTH / 2;
  const wi = Math.min(WHITES - 1, Math.floor(u / WHITE_W));
  if (which !== 'white' && d >= WHITE_L - BLACK_L) {
    // A black key next to this white key?
    for (const k of neighbours(wi)) {
      const kk = KEY_LAYOUT[k];
      if (kk.black && Math.abs(x - kk.x) <= kk.w / 2) return kk.midi;
    }
  }
  if (which === 'black') return -1;
  return WHITE_MIDI[wi];
}

const WHITE_MIDI: number[] = KEY_LAYOUT.filter((k) => !k.black).map((k) => k.midi);
/** Index into KEY_LAYOUT of each white key. */
const WHITE_AT: number[] = KEY_LAYOUT.map((k, i) => (k.black ? -1 : i)).filter((i) => i >= 0);
const NB: number[] = [];
function neighbours(wi: number): number[] {
  const i = WHITE_AT[wi];
  NB.length = 0;
  if (i > 0) NB.push(i - 1);
  if (i < KEYS - 1) NB.push(i + 1);
  return NB;
}

/** The top of a key (y), pressed down by `dip` (0..1). */
export const keyTop = (midi: number) => (isBlack(midi) ? BLACK_H : 0);

// ---------------------------------------------------------------------------
// The computer keyboard: two rows, like a DAW's typing keyboard.
// ---------------------------------------------------------------------------

/** Semitones above the octave's C for each key (A S D F … white, W E T Y U … black). */
export const TYPING: Readonly<Record<string, number>> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
  KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
};
/** Octave of the A key's C (4: middle C), and how far Z / X can shift it. */
export const OCTAVE = { start: 4, min: 0, max: 7 };

/** The note a typing key plays at this octave, or null (not a note key, or off the keyboard). */
export function typingNote(code: string, octave: number): number | null {
  const s = TYPING[code];
  if (s === undefined) return null;
  const midi = 12 * (octave + 1) + s;
  return midi >= LOW && midi <= HIGH ? midi : null;
}

export function noteName(midi: number): string {
  return ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][midi % 12] + (Math.floor(midi / 12) - 1);
}

// ---------------------------------------------------------------------------
// Fingertips pressing keys.
// ---------------------------------------------------------------------------

/** The fingertip joint sits mid-finger: its pad is this far below it. */
export const PAD = 0.007;
/** Pressed this far into a key (from its top) sounds it; back above `RELEASE` lets go. */
export const PRESS = 0.003;
export const RELEASE = 0.0008;
/** A finger more than this far below the keys (in the piano) or this far off them presses nothing. */
const DEEP = 0.07;
const SIDE = 0.004;

export interface Finger {
  /** The key it's holding down (midi), or -1. */
  key: number;
  /** Last pad height and when (for the speed), and the smoothed downward speed (m/s). */
  y: number;
  has: boolean;
  down: number;
  /** Wasn't pressed into the keys last frame (strikes come from above, not in from the side underneath). */
  above: boolean;
}

export const newFinger = (): Finger => ({ key: -1, y: 0, has: false, down: 0, above: false });

/** Velocity 0..1 from how fast the fingertip came down (m/s). */
export function strikeVelocity(speed: number): number {
  const v = (speed - 0.04) / 1.1;
  return Math.min(1, Math.max(0.1, 0.1 + 0.9 * Math.min(1, Math.max(0, v)) ** 0.75));
}

/** What a fingertip did this frame: `on` a note (with velocity) and/or `off` one. -1 for none. */
export interface FingerEvent {
  on: number;
  vel: number;
  off: number;
}

/**
 * Steps one fingertip at keyboard-frame position (x, y, d) — `y` is the
 * joint, the pad is PAD below. `present` false: the finger isn't tracked this
 * frame (it lets go). Writes into `out` (no allocation).
 */
export function stepFinger(f: Finger, present: boolean, x: number, y: number, d: number, dt: number, out: FingerEvent): FingerEvent {
  out.on = -1;
  out.off = -1;
  out.vel = 0;
  if (!present) {
    if (f.key >= 0) out.off = f.key;
    f.key = -1;
    f.has = false;
    f.above = false;
    f.down = 0;
    return out;
  }
  const pad = y - PAD;
  // Downward speed: fast to rise (a strike is a few frames), slow to fade.
  if (f.has && dt > 0) {
    const inst = (f.y - pad) / dt;
    f.down = inst > f.down ? inst : f.down * 0.5 + inst * 0.5;
  } else f.down = 0;
  f.y = pad;
  f.has = true;
  const onKeys = d >= -SIDE && d <= WHITE_L + SIDE && x >= -WIDTH / 2 - SIDE && x <= WIDTH / 2 + SIDE && pad > -DEEP;
  if (f.key >= 0) {
    // Holding a key: let go when the pad comes back up, or slides off it.
    const top = keyTop(f.key);
    const k = KEY_LAYOUT[f.key - LOW];
    const off = !onKeys || pad > top - RELEASE || Math.abs(x - k.x) > k.w / 2 + SIDE || (k.black && d < WHITE_L - BLACK_L - SIDE);
    if (!off) {
      f.above = false;
      return out;
    }
    out.off = f.key;
    f.key = -1;
    // Sliding along (a glissando): straight onto the next key.
    if (onKeys && pad <= top - RELEASE) {
      const next = keyAt(x, d, pad < -PRESS ? 'white' : 'any');
      if (next >= 0 && next !== out.off && pad <= keyTop(next) - PRESS) {
        f.key = next;
        out.on = next;
        out.vel = strikeVelocity(Math.max(f.down, 0.25));
      }
    }
    f.above = pad > (onKeys ? surfaceAt(x, d) : 0) - PRESS;
    return out;
  }
  if (onKeys) {
    // The key under the pad: coming down from above, a black key catches it first.
    const key = keyAt(x, d, f.above || pad >= -PRESS ? 'any' : 'white');
    if (key >= 0 && pad <= keyTop(key) - PRESS && f.above) {
      f.key = key;
      out.on = key;
      out.vel = strikeVelocity(f.down);
      f.above = false;
      return out;
    }
  }
  f.above = pad > (onKeys ? surfaceAt(x, d) : 0) - PRESS;
  return out;
}

/** Height of the key tops under (x, d): a black key's, or the white keys'. */
function surfaceAt(x: number, d: number): number {
  const k = keyAt(x, d);
  return k >= 0 ? keyTop(k) : 0;
}

// ---------------------------------------------------------------------------
// Voices.
// ---------------------------------------------------------------------------

export interface Voice {
  /** The note it's sounding (-1: free). */
  note: number;
  /** When it started, its velocity. */
  start: number;
  vel: number;
  /** Key still down; held on by the pedal after the key came up. */
  held: boolean;
  pedal: boolean;
  /** When it was let go (-1 while held or pedalled). */
  released: number;
}

/**
 * Polyphony with voice stealing. A new note takes: the voice already sounding
 * that note (a piano restrikes its own string), else a free voice, else the
 * released voice that's faded longest, else the oldest note.
 */
export class Voices {
  readonly v: Voice[];
  private sustain = false;
  constructor(readonly max = 24) {
    this.v = Array.from({ length: max }, () => ({ note: -1, start: 0, vel: 0, held: false, pedal: false, released: -1 }));
  }

  /** Index of the voice to play `note` on (the caller stops whatever it was playing). */
  alloc(note: number, now: number, vel: number): number {
    let pick = -1;
    for (let i = 0; i < this.max && pick < 0; i++) if (this.v[i].note === note) pick = i;
    for (let i = 0; i < this.max && pick < 0; i++) if (this.v[i].note < 0) pick = i;
    if (pick < 0) {
      let best = Infinity;
      for (let i = 0; i < this.max; i++) {
        const x = this.v[i];
        if (x.released >= 0 && x.released < best) {
          best = x.released;
          pick = i;
        }
      }
    }
    if (pick < 0) {
      let best = Infinity;
      for (let i = 0; i < this.max; i++) {
        // Pedalled notes go before held ones of the same age.
        const age = this.v[i].start + (this.v[i].held ? 0.5 : 0);
        if (age < best) {
          best = age;
          pick = i;
        }
      }
    }
    const x = this.v[pick];
    x.note = note;
    x.start = now;
    x.vel = vel;
    x.held = true;
    x.pedal = false;
    x.released = -1;
    return pick;
  }

  /** The key came up: returns the voices to release now (into `out`), none if the pedal holds them. */
  keyUp(note: number, now: number, out: number[]): number[] {
    out.length = 0;
    for (let i = 0; i < this.max; i++) {
      const x = this.v[i];
      if (x.note !== note || !x.held) continue;
      x.held = false;
      if (this.sustain) x.pedal = true;
      else {
        x.released = now;
        out.push(i);
      }
    }
    return out;
  }

  /** Pedal down / up: lifting it releases every note whose key is already up. */
  pedal(on: boolean, now: number, out: number[]): number[] {
    out.length = 0;
    this.sustain = on;
    if (on) return out;
    for (let i = 0; i < this.max; i++) {
      const x = this.v[i];
      if (x.note >= 0 && x.pedal) {
        x.pedal = false;
        x.released = now;
        out.push(i);
      }
    }
    return out;
  }

  get pedalDown() {
    return this.sustain;
  }

  /** A voice finished fading out: it's free. */
  free(i: number) {
    const x = this.v[i];
    x.note = -1;
    x.held = false;
    x.pedal = false;
    x.released = -1;
  }

  /** Voices sounding (held, pedalled or still fading). */
  get active() {
    let n = 0;
    for (const x of this.v) if (x.note >= 0) n++;
    return n;
  }
}
