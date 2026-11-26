import { PARTY, beatLen, kickIn, loopLength, sectionOf, type Section } from './beat';
import { compress } from './track';

/**
 * The headliner's set: two original songs in a moody 80s synth-pop / R&B
 * style, 64 bars at the party's tempo so the beat clock, the lights and the
 * dancers carry on through it unchanged. Each song follows the same 32-bar
 * shape as the DJ's cycles (see beat.ts): a 16-bar chorus where the DJ has
 * the drop, an 8-bar verse where the DJ breaks down (no kick) and an 8-bar
 * pre-chorus where the DJ builds (gated snare roll, toms, a breath of silence).
 *
 * The sound: a LinnDrum-ish kick, a big gated-reverb snare, 16th hats, a
 * pumping eighth-note synth bass, a pulse-wave arpeggio, a warm detuned pad,
 * a sawtooth lead for the chorus hook and a wordless "ooh / ah" formant voice
 * (a sawtooth through three vowel formant filters, with vibrato and a scoop
 * into each note) that suggests singing without any words.
 *
 * Every melody and progression here was written for this file. Pure data at
 * the top (unit-tested: in key, in range, the singer's phrasing), WebAudio
 * rendering below (offline, like track.ts).
 */

/** [beat offset within the chord's 8 beats, midi note, length in beats]. */
export type Note = [number, number, number];
export interface Chord {
  name: string;
  /** Bass root (midi, around C2). */
  root: number;
  /** Voicing (midi, around middle C). */
  notes: number[];
}

const C: Record<string, Chord> = {
  Cm9: { name: 'Cm9', root: 36, notes: [63, 67, 70, 74] },
  Ab: { name: 'Abmaj7', root: 44, notes: [63, 67, 68, 72] },
  Bb6: { name: 'Bb6', root: 46, notes: [62, 65, 67, 70] },
  Gm7: { name: 'Gm7', root: 43, notes: [62, 65, 70, 74] },
  Fm9: { name: 'Fm9', root: 41, notes: [60, 63, 67, 68] },
  Eb: { name: 'Ebmaj7', root: 39, notes: [62, 63, 67, 70] },
};

export interface Song {
  title: string;
  /** Four chords, two bars each (the chorus plays them twice). */
  chorus: Chord[];
  verse: Chord[];
  pre: Chord[];
  /** The chorus hook on the lead synth: a phrase per chorus chord. */
  hook: Note[][];
  /** The voice's verse line: a phrase per verse chord. */
  verseVox: Note[][];
}

/** The pre-chorus line rises the same way in both songs (a phrase per pre-chorus chord). */
const PRE_VOX: Note[][] = [
  [
    [0, 65, 2],
    [2, 67, 2],
    [4, 68, 3],
  ],
  [
    [0, 67, 2],
    [2, 70, 2],
    [4, 72, 3],
  ],
  [
    [0, 72, 2],
    [2, 74, 2],
    [4, 75, 3],
  ],
  [
    [0, 74, 4],
    [4, 79, 3],
  ],
];

export const SONGS: Song[] = [
  {
    title: 'Glass Horizon',
    chorus: [C.Ab, C.Bb6, C.Gm7, C.Cm9],
    verse: [C.Cm9, C.Ab, C.Fm9, C.Gm7],
    pre: [C.Fm9, C.Gm7, C.Ab, C.Bb6],
    hook: [
      [
        [0, 75, 0.75],
        [0.75, 74, 0.25],
        [1, 72, 1.5],
        [3, 67, 0.5],
        [3.5, 72, 0.5],
        [4, 75, 1],
        [5, 74, 0.5],
        [5.5, 72, 2],
      ],
      [
        [0, 74, 0.75],
        [0.75, 72, 0.25],
        [1, 70, 1.5],
        [3, 65, 0.5],
        [3.5, 70, 0.5],
        [4, 74, 1],
        [5, 77, 0.5],
        [5.5, 74, 2],
      ],
      [
        [0, 74, 0.75],
        [0.75, 72, 0.25],
        [1, 70, 1],
        [2, 67, 1],
        [3.5, 70, 0.5],
        [4, 72, 1],
        [5, 70, 0.5],
        [5.5, 67, 1.5],
      ],
      [
        [0, 72, 3],
        [3.5, 70, 0.25],
        [3.75, 72, 0.25],
        [4, 75, 1],
        [5, 74, 1],
        [6, 72, 1],
        [7, 70, 0.75],
      ],
    ],
    verseVox: [
      [
        [0.5, 63, 1],
        [1.5, 62, 0.5],
        [2, 60, 1.5],
        [4, 63, 0.5],
        [4.5, 65, 0.5],
        [5, 67, 2],
      ],
      [
        [0.5, 68, 1],
        [1.5, 67, 0.5],
        [2, 63, 1.5],
        [4, 60, 0.5],
        [4.5, 63, 0.5],
        [5, 65, 2],
      ],
      [
        [0.5, 63, 1],
        [1.5, 65, 0.5],
        [2, 67, 1.5],
        [4, 68, 0.5],
        [4.5, 67, 0.5],
        [5, 65, 2],
      ],
      [
        [0.5, 62, 1.5],
        [2, 65, 1],
        [3, 67, 3],
        [6.5, 70, 1],
      ],
    ],
  },
  {
    title: 'Low Tide Neon',
    chorus: [C.Fm9, C.Ab, C.Eb, C.Bb6],
    verse: [C.Cm9, C.Eb, C.Ab, C.Gm7],
    pre: [C.Ab, C.Bb6, C.Cm9, C.Bb6],
    hook: [
      [
        [0.5, 68, 0.5],
        [1, 67, 0.5],
        [1.5, 68, 1],
        [2.5, 72, 1.5],
        [4.5, 75, 0.5],
        [5, 72, 1],
        [6, 68, 0.5],
        [6.5, 67, 1.5],
      ],
      [
        [0.5, 67, 0.5],
        [1, 68, 0.5],
        [1.5, 72, 1],
        [2.5, 75, 1.5],
        [4.5, 79, 0.5],
        [5, 77, 1],
        [6, 75, 2],
      ],
      [
        [0.5, 74, 0.5],
        [1, 75, 0.5],
        [1.5, 74, 1],
        [2.5, 70, 1.5],
        [4.5, 67, 0.5],
        [5, 70, 1],
        [6, 74, 2],
      ],
      [
        [0.5, 74, 0.5],
        [1, 72, 0.5],
        [1.5, 70, 1],
        [2.5, 67, 1],
        [3.5, 65, 0.5],
        [4, 67, 2],
        [6.5, 70, 0.5],
        [7, 72, 0.75],
      ],
    ],
    verseVox: [
      [
        [1, 67, 1],
        [2, 70, 1],
        [3, 67, 0.5],
        [3.5, 63, 2.5],
      ],
      [
        [1, 67, 1],
        [2, 70, 1],
        [3, 74, 0.5],
        [3.5, 70, 2.5],
      ],
      [
        [1, 72, 1],
        [2, 70, 0.5],
        [2.5, 67, 1.5],
        [4.5, 63, 0.5],
        [5, 65, 2],
      ],
      [
        [1, 62, 1],
        [2, 65, 1],
        [3, 67, 4],
      ],
    ],
  },
];

/** The key: C natural minor (C D Eb F G Ab Bb), as pitch classes. */
export const KEY_PCS = [0, 2, 3, 5, 7, 8, 10];

export type Vowel = 'oo' | 'ah' | 'oh';

/** Where a bar of the set falls: which song, its section, the chord and the voice's phrase. */
export function songPart(bar: number): { song: Song; index: number; section: Section; chord: Chord; chordIndex: number; half: number; vox: Note[]; vowel: Vowel; hook: Note[] | null } {
  const b = ((Math.floor(bar) % PARTY.bars) + PARTY.bars) % PARTY.bars;
  const index = Math.floor(b / PARTY.cycle) % SONGS.length;
  const song = SONGS[index];
  const c = b % PARTY.cycle;
  const section = sectionOf(b);
  let chordIndex: number, chord: Chord, vox: Note[], hook: Note[] | null, vowel: Vowel;
  if (section === 'drop') {
    chordIndex = Math.floor(c / 2) % 4;
    chord = song.chorus[chordIndex];
    hook = song.hook[chordIndex];
    // The voice sings the hook an octave down ("ah"), under the lead.
    vox = hook.map(([o, n, l]) => [o, n - 12, l] as Note);
    vowel = 'ah';
  } else if (section === 'break') {
    chordIndex = Math.floor((c - PARTY.drop) / 2);
    chord = song.verse[chordIndex];
    hook = null;
    vox = song.verseVox[chordIndex];
    vowel = 'oo';
  } else {
    chordIndex = Math.floor((c - PARTY.drop - PARTY.breakdown) / 2);
    chord = song.pre[chordIndex];
    hook = null;
    vox = PRE_VOX[chordIndex];
    vowel = 'oh';
  }
  return { song, index, section, chord, chordIndex, half: c % 2, vox, vowel, hook };
}

/**
 * How much the voice is singing at a moment of the set (0..1), from the
 * continuous beat count: 1 through a sung note, easing off after it. Drives
 * the singer's mic and his breathing between lines.
 */
export function singingAt(beats: number): number {
  const bar = Math.floor(beats / 4);
  const p = songPart(bar);
  // Beats into the chord's 8-beat phrase.
  const at = p.half * 4 + (beats - bar * 4);
  let s = 0;
  for (const [o, , l] of p.vox) {
    if (at >= o && at < o + l) return 1;
    // Just before a note (drawing breath, leaning in) and just after it.
    if (at >= o - 0.35 && at < o) s = Math.max(s, 1 - (o - at) / 0.35);
    if (at >= o + l && at < o + l + 0.6) s = Math.max(s, 1 - (at - o - l) / 0.6);
  }
  return s;
}

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Vowel formants (Hz) and their levels, for a man's voice. */
const FORMANTS: Record<Vowel, { f: number[]; g: number[]; q: number[] }> = {
  oo: { f: [330, 780, 2400], g: [1, 0.32, 0.06], q: [5, 9, 16] },
  oh: { f: [480, 880, 2450], g: [1, 0.45, 0.08], q: [5, 9, 16] },
  ah: { f: [720, 1140, 2600], g: [1, 0.55, 0.12], q: [5, 9, 16] },
};

/** The instruments, built on an offline context (shared by the set and the scratch record). */
function kit(ctx: OfflineAudioContext, noise: AudioBuffer, rnd: () => number) {
  const noiseVoice = (t0: number, t1: number, type: BiquadFilterType, f: number, q: number, out: AudioNode) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = f;
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    s.connect(flt).connect(g).connect(out);
    s.start(t0, rnd() * 1.5);
    s.stop(t1);
    return { g: g.gain, f: flt.frequency };
  };
  const tap = (g: AudioParam, at: number, v: number, len: number) => {
    g.setValueAtTime(0, at);
    g.linearRampToValueAtTime(v, at + 0.002);
    g.exponentialRampToValueAtTime(Math.max(1e-4, v * 0.002), at + len);
    g.setValueAtTime(0, at + len + 0.001);
  };
  /** A synth note (or chord) through its own lowpass, into `out`. */
  const note = (
    at: number,
    f: number | number[],
    len: number,
    v: number,
    type: OscillatorType,
    cutoff: number | null,
    out: AudioNode,
    o: { attack?: number; release?: number; detune?: number; q?: number; cutEnv?: number; vibrato?: number } = {},
  ) => {
    const g = ctx.createGain();
    let into: AudioNode = g;
    if (cutoff !== null) {
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.Q.value = o.q ?? 0.8;
      flt.frequency.setValueAtTime(cutoff * (o.cutEnv ?? 1), at);
      if (o.cutEnv) flt.frequency.exponentialRampToValueAtTime(cutoff, at + Math.min(len, 0.3));
      flt.connect(g);
      into = flt;
    }
    const a = o.attack ?? 0.005,
      r = Math.min(o.release ?? 0.08, len * 0.9);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(v, at + a);
    g.gain.setValueAtTime(v, at + Math.max(a, len - r));
    g.gain.linearRampToValueAtTime(0, at + len);
    g.connect(out);
    let vib: GainNode | null = null;
    if (o.vibrato) {
      // Vibrato that blooms after the attack (cents on every oscillator's detune).
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.4;
      vib = ctx.createGain();
      vib.gain.setValueAtTime(0, at);
      vib.gain.setValueAtTime(0, at + Math.min(0.22, len * 0.4));
      vib.gain.linearRampToValueAtTime(o.vibrato, at + Math.min(0.6, len * 0.8));
      lfo.connect(vib);
      lfo.start(at);
      lfo.stop(at + len + 0.02);
    }
    const dets = o.detune ? [-o.detune, o.detune] : [0];
    for (const fr of Array.isArray(f) ? f : [f])
      for (const d of dets) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = fr;
        osc.detune.value = d;
        if (vib) vib.connect(osc.detune);
        osc.connect(into);
        osc.start(at);
        osc.stop(at + len + 0.02);
      }
    return g;
  };
  /**
   * The wordless voice: a sawtooth at the sung pitch (scooping up into the note,
   * vibrato blooming as it holds) through three formant band-passes for the vowel,
   * with a breath of noise on the attack.
   */
  const voice = (at: number, midi: number, len: number, v: number, vowel: Vowel, out: AudioNode, next?: Vowel) => {
    const f0 = hz(midi);
    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    src.frequency.value = f0;
    src.detune.setValueAtTime(-70, at);
    src.detune.exponentialRampToValueAtTime(-1, at + 0.07);
    src.detune.linearRampToValueAtTime(0, at + 0.08);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.1 + rnd() * 0.5;
    const vib = ctx.createGain();
    vib.gain.setValueAtTime(0, at);
    vib.gain.setValueAtTime(0, at + Math.min(0.25, len * 0.4));
    vib.gain.linearRampToValueAtTime(len > 0.5 ? 26 : 8, at + Math.min(0.7, len * 0.9));
    lfo.connect(vib).connect(src.detune);
    const env = ctx.createGain();
    const a = 0.06,
      r = Math.min(0.18, len * 0.5);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(v, at + a);
    env.gain.setValueAtTime(v, at + Math.max(a, len - r));
    env.gain.linearRampToValueAtTime(0, at + len + 0.04);
    env.connect(out);
    const F = FORMANTS[vowel],
      N = next ? FORMANTS[next] : null;
    for (let k = 0; k < 3; k++) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = F.q[k];
      bp.frequency.setValueAtTime(F.f[k], at);
      // A held note opens toward the next vowel ("oo-ah").
      if (N && len > 1) bp.frequency.linearRampToValueAtTime(N.f[k], at + len);
      const g = ctx.createGain();
      // Narrow band-passes take a lot out of a sawtooth: make it back up.
      g.gain.value = F.g[k] * (k === 0 ? 3.2 : k === 1 ? 5 : 8);
      src.connect(bp).connect(g).connect(env);
    }
    // A breath on the way in.
    const b0 = Math.max(0, at - 0.02);
    const br = noiseVoice(b0, at + 0.2, 'bandpass', F.f[1] * 1.6, 1.2, out);
    br.g.setValueAtTime(0, b0);
    br.g.linearRampToValueAtTime(v * 0.25, at + 0.02);
    br.g.linearRampToValueAtTime(0, at + 0.18);
    src.start(at);
    src.stop(at + len + 0.06);
    lfo.start(at);
    lfo.stop(at + len + 0.06);
  };
  return { noiseVoice, tap, note, voice };
}

function noiseBuffer(sampleRate: number, rnd: () => number) {
  const b = new AudioBuffer({ numberOfChannels: 1, length: sampleRate * 2, sampleRate });
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;
  return b;
}

function reverbIR(sampleRate: number, seconds: number, decay: number, rnd: () => number, gate = false) {
  const b = new AudioBuffer({ numberOfChannels: 1, length: Math.floor(sampleRate * seconds), sampleRate });
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const x = i / d.length;
    // A gated room stays loud then stops dead (the 80s snare); a hall dies away.
    const env = gate ? (x < 0.85 ? 0.75 + 0.25 * (1 - x) : (1 - x) / 0.15) : Math.pow(1 - x, decay);
    d[i] = (rnd() * 2 - 1) * env;
  }
  return b;
}

/** Raw mono samples of a rendered loop (no AudioBuffer: handed straight to the deck's audio thread). */
export interface RawTrack {
  data: Float32Array<ArrayBuffer>;
  sampleRate: number;
  /** Loop length (s); the data runs on a second past it (a copy of the start). */
  loop: number;
}

/** Renders the headliner's 64-bar set (both songs), looping seamlessly like the DJ's. */
export async function renderHeadlinerTrack(sampleRate = 32000, opts: { mute?: string[] } = {}): Promise<RawTrack> {
  const beat = beatLen();
  const bar = beat * 4;
  const loop = loopLength();
  const CHUNK = 2;
  const tail = 3;
  let seed0 = 4242;
  const rnd0 = () => (seed0 = (seed0 * 16807) % 2147483647) / 2147483647;
  const noise = noiseBuffer(sampleRate, rnd0);
  const hall = reverbIR(sampleRate, 2.4, 2.6, rnd0);
  const gated = reverbIR(sampleRate, 0.3, 1, rnd0, true);
  const mute = new Set(opts.mute ?? []);

  const renderChunk = async (b0: number, nb: number): Promise<Float32Array> => {
    const ctx = new OfflineAudioContext(1, Math.ceil((nb * bar + tail) * sampleRate), sampleRate);
    let seed = 777 + b0 * 7919;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const { noiseVoice, tap, note, voice } = kit(ctx, noise, rnd);

    const master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
    const bus = (name: string, to: AudioNode) => {
      const g = ctx.createGain();
      g.gain.value = mute.has(name) ? 0 : 1;
      g.connect(to);
      return g;
    };
    // A soft pump on the music from the kick (the chorus only).
    const duck = ctx.createGain();
    duck.connect(master);
    const drums = bus('drums', master);
    // Echo (dotted eighth) and a lush hall; the snare's own gated room.
    const echo = ctx.createDelay(2);
    echo.delayTime.value = beat * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.36;
    const dark = ctx.createBiquadFilter();
    dark.type = 'lowpass';
    dark.frequency.value = 2400;
    echo.connect(dark).connect(fb).connect(echo);
    const echoOut = ctx.createGain();
    echoOut.gain.value = 0.32;
    dark.connect(echoOut).connect(duck);
    const room = ctx.createConvolver();
    room.buffer = hall;
    const roomOut = ctx.createGain();
    roomOut.gain.value = 0.2;
    room.connect(roomOut).connect(master);
    const gate = ctx.createConvolver();
    gate.buffer = gated;
    const gateOut = ctx.createGain();
    gateOut.gain.value = 0.16;
    gate.connect(gateOut).connect(drums);
    const send = (node: AudioNode, e = 0, r = 0) => {
      if (e > 0) {
        const g = ctx.createGain();
        g.gain.value = e;
        node.connect(g).connect(echo);
      }
      if (r > 0) {
        const g = ctx.createGain();
        g.gain.value = r;
        node.connect(g).connect(room);
      }
    };
    const bassBus = bus('bass', duck);
    const padBus = bus('pad', duck);
    send(padBus, 0, 0.8);
    const arpBus = bus('arp', duck);
    send(arpBus, 0.5, 0.35);
    const leadBus = bus('lead', duck);
    send(leadBus, 0.55, 0.5);
    const voxBus = bus('vox', master);
    send(voxBus, 0.3, 0.75);
    // The snare and toms go to the gated room.
    const snBus = ctx.createGain();
    snBus.connect(drums);
    snBus.connect(gate);

    const kick = (at: number, v = 1) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(128, at);
      o.frequency.exponentialRampToValueAtTime(50, at + 0.06);
      o.frequency.exponentialRampToValueAtTime(42, at + 0.25);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(v * 0.95, at + 0.002);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
      o.connect(g).connect(drums);
      o.start(at);
      o.stop(at + 0.32);
      const click = noiseVoice(at, at + 0.03, 'highpass', 3000, 0.7, drums);
      tap(click.g, at, 0.12 * v, 0.012);
    };
    const snare = (at: number, v = 0.5) => {
      const n = noiseVoice(at, at + 0.35, 'bandpass', 1700, 0.6, snBus);
      tap(n.g, at, v, 0.2);
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(240, at);
      o.frequency.exponentialRampToValueAtTime(170, at + 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(v * 0.9, at + 0.002);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.12);
      o.connect(g).connect(snBus);
      o.start(at);
      o.stop(at + 0.14);
    };
    const tom = (at: number, f: number, v = 0.5) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f * 1.6, at);
      o.frequency.exponentialRampToValueAtTime(f, at + 0.08);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(v, at + 0.003);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.35);
      o.connect(g).connect(snBus);
      o.start(at);
      o.stop(at + 0.37);
    };

    for (let b = b0; b < b0 + nb; b++) {
      const t0 = (b - b0) * bar;
      const c = b % PARTY.cycle;
      const p = songPart(b);
      const sec = p.section;
      const k = kickIn(b);
      const ch = p.chord;
      const last = c === PARTY.cycle - 1;
      // The last half beat of a song is a breath of silence.
      const end = last ? t0 + beat * 3.5 : t0 + bar;

      // --- Drums
      for (let i = 0; i < 4; i++) {
        const t = t0 + i * beat;
        if (k) {
          kick(t, sec === 'build' ? 0.85 : 1);
          if (sec === 'drop') {
            duck.gain.setValueAtTime(0.62, t);
            duck.gain.linearRampToValueAtTime(1, t + beat * 0.5);
          } else duck.gain.setValueAtTime(1, t);
        } else duck.gain.setValueAtTime(1, t);
        // The big snare on 2 and 4 (a rimshot through the verse).
        if (i === 1 || i === 3) {
          if (sec === 'drop' || (sec === 'build' && k)) snare(t, 0.55);
          else if (sec === 'break') {
            const rim = noiseVoice(t, t + 0.1, 'bandpass', 2600, 4, drums);
            tap(rim.g, t, 0.22, 0.05);
          }
        }
      }
      {
        const hats = noiseVoice(t0, t0 + bar + 0.2, 'highpass', 7500, 0.7, drums);
        for (let s = 0; s < 16; s++) {
          const t = t0 + (s * beat) / 4;
          if (t >= end) break;
          if (sec === 'drop') tap(hats.g, t, s % 4 === 2 ? 0.12 : s % 2 ? 0.035 : 0.06, s % 4 === 2 ? 0.09 : 0.03);
          else if (sec === 'break') {
            if (s % 2 === 0) tap(hats.g, t, s % 4 === 2 ? 0.05 : 0.03, 0.05);
          } else tap(hats.g, t, (s % 2 ? 0.03 : 0.05) * (0.6 + 0.4 * ((c - 24) / 8)), 0.03);
        }
      }
      // Pre-chorus, no kick: the gated snare rolls in (eighths, then sixteenths), toms down the kit to finish.
      if (sec === 'build' && !k) {
        const div = c < 30 ? 2 : 4;
        for (let s = 0; s < 4 * div; s++) {
          const t = t0 + (s * beat) / div;
          if (c === 30 && s >= 4 * div - 4) break;
          if (t >= end) break;
          if (c === 31 && s >= 8) break;
          snare(t, 0.18 + 0.35 * ((c - 28) / 4 + s / (16 * div)));
        }
        if (c === 30) for (let s = 0; s < 4; s++) tom(t0 + beat * 3 + (s * beat) / 4, [196, 165, 131, 98][s], 0.5);
        if (c === 31) for (let s = 0; s < 6; s++) tom(t0 + beat * 2 + (s * beat) / 4, [220, 196, 165, 131, 110, 98][s], 0.45);
      }
      // A crash as each chorus lands.
      if (c === 0 || c === 8) {
        const cr = noiseVoice(t0, t0 + 2.6, 'highpass', 5000, 0.5, drums);
        tap(cr.g, t0, c === 0 ? 0.26 : 0.16, 2.3);
      }

      // --- Bass: pumping eighths in the chorus (octave on the off-beats), a slower line in the verse.
      const root = hz(ch.root);
      if (sec === 'drop' || (sec === 'build' && k)) {
        for (let s = 0; s < 8; s++) {
          const t = t0 + (s * beat) / 2;
          const f = s % 2 && sec === 'drop' ? root * 2 : root;
          note(t, f, beat * 0.42, 0.085, 'sawtooth', 650, bassBus, { cutEnv: 2.4, q: 3, release: 0.04 });
          note(t, root, beat * 0.42, 0.11, 'sine', null, bassBus, { release: 0.04 });
        }
      } else if (sec === 'break') {
        for (const [o, l] of [
          [0, 1.5],
          [1.5, 1],
          [2.5, 1.5],
        ]) {
          note(t0 + o * beat, root, beat * l * 0.92, 0.12, 'sine', null, bassBus, { release: 0.06 });
          note(t0 + o * beat, root, beat * l * 0.92, 0.035, 'sawtooth', 420, bassBus, { release: 0.06 });
        }
      } else {
        note(t0, root, (end - t0) * 0.98, 0.1, 'sine', null, bassBus, { attack: 0.02, release: 0.3 });
      }

      // --- Pad: two bars per chord.
      if (c % 2 === 0) {
        const len = c === PARTY.cycle - 2 ? bar * 2 - beat * 0.5 : bar * 2 + 0.2;
        const v = sec === 'drop' ? 0.022 : 0.04;
        note(t0, ch.notes.map(hz), len, v, 'sawtooth', sec === 'break' ? 1300 : 1800, padBus, { attack: 0.5, release: 0.8, detune: 11 });
      }

      // --- Arpeggio: up the chord and an octave over it, sixteenths (eighths in the verse).
      {
        const seq = [ch.notes[0], ch.notes[1], ch.notes[2], ch.notes[3], ch.notes[0] + 12, ch.notes[3], ch.notes[2], ch.notes[1]];
        const step = sec === 'break' ? 2 : 1;
        const cut = sec === 'drop' ? 2600 : sec === 'break' ? 1200 : 1400 + 1400 * ((c - 24) / 8);
        for (let s = 0; s < 16; s += step) {
          const t = t0 + (s * beat) / 4;
          if (t >= end) break;
          const v = (sec === 'drop' ? 0.048 : 0.042) * (s % 4 === 0 ? 1.2 : 1);
          note(t, hz(seq[(s / step) % seq.length] + 12), beat * 0.22, v, 'square', cut, arpBus, { q: 4, release: 0.05 });
        }
      }

      // --- The lead's hook in the chorus.
      if (p.hook) {
        for (const [o, n, l] of p.hook) {
          if (o < p.half * 4 || o >= p.half * 4 + 4) continue;
          const t = t0 + (o - p.half * 4) * beat;
          note(t, hz(n), beat * l, 0.095, 'sawtooth', 3200, leadBus, { detune: 6, release: Math.min(0.15, beat * l * 0.4), vibrato: 14 });
          note(t, hz(n - 12), beat * l, 0.04, 'square', 1800, leadBus, { release: 0.08 });
        }
      }

      // --- The voice.
      p.vox.forEach(([o, n, l], i) => {
        if (o < p.half * 4 || o >= p.half * 4 + 4) return;
        const t = t0 + (o - p.half * 4) * beat;
        if (t >= end) return;
        const v = sec === 'drop' ? 0.09 : 0.1;
        const next = p.vox[i + 1] ? undefined : p.vowel === 'oo' ? 'ah' : undefined;
        voice(t, n, Math.min(beat * l, end - t), v, p.vowel, voxBus, next);
      });
    }
    const rendered = await ctx.startRendering();
    return rendered.getChannelData(0);
  };

  const n = Math.ceil(loop * sampleRate);
  const pad = sampleRate;
  const out = new Float32Array(n + pad);
  for (let b0 = 0; b0 < PARTY.bars; b0 += CHUNK) {
    const d = await renderChunk(b0, CHUNK);
    const off = Math.round(b0 * bar * sampleRate);
    for (let i = 0; i < d.length; i++) out[(off + i) % n] += d[i];
  }
  // (Stems, for balancing the mix: left uncompressed so they compare.)
  if (!opts.mute) compress(out, n, sampleRate);
  for (let i = 0; i < pad; i++) out[n + i] = out[i];
  return { data: out, sampleRate, loop };
}

/**
 * The battle record on the right-hand deck: two bars of scratch sounds in
 * time with the party (a sung "ah!", a brass-like synth stab, an "oh", a
 * vocal "hey"-shaped hit). Short: it loops under the needle.
 */
export async function renderScratchRecord(sampleRate = 32000): Promise<RawTrack> {
  const beat = beatLen();
  const loop = beat * 8;
  let seed = 99;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const noise = noiseBuffer(sampleRate, rnd);
  const ctx = new OfflineAudioContext(1, Math.ceil((loop + 1) * sampleRate), sampleRate);
  const { note, voice } = kit(ctx, noise, rnd);
  const out = ctx.createGain();
  out.gain.value = 0.8;
  out.connect(ctx.destination);
  const stab = [60, 63, 67, 70].map(hz);
  voice(0, 60, beat * 0.55, 0.16, 'ah', out);
  note(beat * 1.5, stab, beat * 0.4, 0.07, 'sawtooth', 2600, out, { detune: 9, cutEnv: 2.5, release: 0.08 });
  voice(beat * 2.5, 63, beat * 0.45, 0.15, 'oh', out);
  note(beat * 4, stab.map((f) => f * 0.75), beat * 0.35, 0.07, 'sawtooth', 2400, out, { detune: 9, cutEnv: 2.5, release: 0.08 });
  voice(beat * 5, 67, beat * 0.35, 0.16, 'ah', out);
  voice(beat * 6, 58, beat * 1.2, 0.14, 'oo', out, 'ah');
  const r = await ctx.startRendering();
  const d = r.getChannelData(0);
  const n = Math.ceil(loop * sampleRate);
  const data = new Float32Array(n + sampleRate);
  data.set(d.subarray(0, Math.min(d.length, data.length)));
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak > 0) for (let i = 0; i < data.length; i++) data[i] *= 0.9 / peak;
  return { data, sampleRate, loop };
}
