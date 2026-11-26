import { PARTY, beatLen, kickIn, loopLength, sectionOf } from './beat';

/**
 * The DJ's set: 64 bars of deep, warm house at 122 bpm in A minor, rendered
 * offline (mono, so it costs half the memory; it plays from the booth's
 * speakers as positional sources anyway) and looping seamlessly. Two 32-bar
 * cycles, each a 16-bar drop, an 8-bar breakdown (pads and the hook, no
 * kick) and an 8-bar build (filter opening, a riser, a snare roll and a
 * breath of silence) back into the drop; the second cycle has its own chords,
 * bassline and hook. The arrangement is read from beat.ts so the lights and
 * dancers follow the same bars the music plays.
 */

export interface PartyTrack {
  buffer: AudioBuffer;
  /** Loop length in seconds (the buffer runs on a little past it: loop it with loopEnd). */
  loop: number;
}

type Chord = { root: number; notes: number[] };
const PROG_A: Chord[] = [
  { root: 45, notes: [60, 64, 67, 71] }, // Am9
  { root: 41, notes: [57, 60, 64, 67] }, // Fmaj9
  { root: 38, notes: [60, 64, 65, 69] }, // Dm9
  { root: 40, notes: [59, 62, 64, 67] }, // Em7
];
const PROG_B: Chord[] = [
  { root: 41, notes: [57, 60, 64, 67] }, // Fmaj9
  { root: 43, notes: [59, 62, 64, 67] }, // G6
  { root: 40, notes: [59, 62, 67, 71] }, // Em7
  { root: 45, notes: [60, 64, 67, 72] }, // Am(add9)
];
// Two-bar hooks: [beat offset, midi note, length in beats].
const HOOK_A: [number, number, number][] = [
  [0, 76, 0.5],
  [0.75, 74, 0.5],
  [1.5, 72, 0.5],
  [2.5, 69, 0.75],
  [3.25, 72, 0.5],
  [4, 76, 0.5],
  [4.75, 79, 0.5],
  [5.5, 76, 0.75],
  [6.5, 74, 0.5],
  [7.25, 72, 0.5],
];
const HOOK_B: [number, number, number][] = [
  [0.5, 72, 0.5],
  [1, 74, 0.5],
  [1.5, 76, 1],
  [3, 74, 0.5],
  [3.5, 72, 0.5],
  [4.5, 69, 0.5],
  [5, 72, 0.5],
  [5.5, 74, 1],
  [7, 76, 0.5],
  [7.5, 79, 0.5],
];

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export async function renderPartyTrack(sampleRate = 32000): Promise<PartyTrack> {
  const { data, loop } = await renderPartyRaw(sampleRate);
  const buffer = new AudioBuffer({ numberOfChannels: 1, length: data.length, sampleRate });
  buffer.copyToChannel(data, 0);
  return { buffer, loop };
}

/** The same set as raw mono samples (handed straight to the decks' audio thread, no AudioBuffer copy). */
export async function renderPartyRaw(sampleRate = 32000): Promise<{ data: Float32Array<ArrayBuffer>; sampleRate: number; loop: number }> {
  const beat = beatLen();
  const bar = beat * 4;
  const loop = loopLength();
  // Rendered a couple of bars at a time (each piece with a tail for the echo, the room and
  // the pad's release), then overlap-added round the loop: an offline context with every
  // note of the whole track scheduled up front renders orders of magnitude slower.
  const CHUNK = 2;
  const tail = 2.6;
  let seed0 = 1234;
  const rnd0 = () => (seed0 = (seed0 * 16807) % 2147483647) / 2147483647;
  // A short room (noise impulse, ~1.6 s) and a noise source, shared by every piece.
  const ir = new AudioBuffer({ numberOfChannels: 1, length: Math.floor(sampleRate * 1.6), sampleRate });
  {
    const d = ir.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (rnd0() * 2 - 1) * Math.pow(1 - i / d.length, 3.2);
  }
  const noise = new AudioBuffer({ numberOfChannels: 1, length: sampleRate * 2, sampleRate });
  {
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = rnd0() * 2 - 1;
  }

  const renderChunk = async (b0: number, nb: number): Promise<Float32Array> => {
    const ctx = new OfflineAudioContext(1, Math.ceil((nb * bar + tail) * sampleRate), sampleRate);
    let seed = 1234 + b0 * 7919;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

    // --- Busses: drums dry, music ducked by the kick (sidechain pump), sends to echo and a small room.
    const master = ctx.createGain();
    master.gain.value = 0.62;
    master.connect(ctx.destination);
    const drums = ctx.createGain();
    drums.connect(master);
    const music = ctx.createGain();
    const duck = ctx.createGain();
    music.connect(duck).connect(master);
    // Echo (dotted eighth), darkened in the feedback loop.
    const echo = ctx.createDelay(2);
    echo.delayTime.value = beat * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const dark = ctx.createBiquadFilter();
    dark.type = 'lowpass';
    dark.frequency.value = 2600;
    echo.connect(dark).connect(fb).connect(echo);
    const echoOut = ctx.createGain();
    echoOut.gain.value = 0.35;
    dark.connect(echoOut).connect(duck);
    const room = ctx.createConvolver();
    room.buffer = ir;
    const roomOut = ctx.createGain();
    roomOut.gain.value = 0.22;
    room.connect(roomOut).connect(master);
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

    /** A noise voice over [t0, t1): filtered, its gain automated by the caller. */
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
    /** A percussive tap on a gain param: up to `v`, decaying over `len`. */
    const tap = (g: AudioParam, at: number, v: number, len: number) => {
      g.setValueAtTime(0, at);
      g.linearRampToValueAtTime(v, at + 0.002);
      g.exponentialRampToValueAtTime(Math.max(1e-4, v * 0.002), at + len);
      g.setValueAtTime(0, at + len + 0.001);
    };

    const kick = (at: number, v = 1) => {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(155, at);
      o.frequency.exponentialRampToValueAtTime(52, at + 0.07);
      o.frequency.exponentialRampToValueAtTime(44, at + 0.3);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(v, at + 0.003);
      g.gain.setValueAtTime(v, at + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.38);
      o.connect(g).connect(drums);
      o.start(at);
      o.stop(at + 0.4);
    };
    const clap = (at: number, v = 0.34) => {
      const n = noiseVoice(at, at + 0.4, 'bandpass', 1500, 1.1, drums);
      // Three quick slaps then the body.
      for (const [dt, k] of [
        [0, 0.6],
        [0.011, 0.75],
        [0.022, 1],
      ] as const) {
        n.g.setValueAtTime(v * k, at + dt);
        n.g.exponentialRampToValueAtTime(v * k * 0.15, at + dt + 0.009);
      }
      n.g.setValueAtTime(v, at + 0.03);
      n.g.exponentialRampToValueAtTime(0.0005, at + 0.28);
    };
    /** Pitched synth note through its own lowpass, into `out`. */
    const note = (
      at: number,
      f: number | number[],
      len: number,
      v: number,
      type: OscillatorType,
      cutoff: number | null,
      out: AudioNode,
      opts: { attack?: number; release?: number; detune?: number; q?: number; cutEnv?: number } = {},
    ) => {
      // (A chord shares one filter and envelope; no filter when `cutoff` is null: fewer nodes renders faster.)
      const g = ctx.createGain();
      let into: AudioNode = g;
      if (cutoff !== null) {
        const flt = ctx.createBiquadFilter();
        flt.type = 'lowpass';
        flt.Q.value = opts.q ?? 0.8;
        flt.frequency.setValueAtTime(cutoff * (opts.cutEnv ?? 1), at);
        if (opts.cutEnv) flt.frequency.exponentialRampToValueAtTime(cutoff, at + Math.min(len, 0.25));
        flt.connect(g);
        into = flt;
      }
      const a = opts.attack ?? 0.005,
        r = opts.release ?? 0.08;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(v, at + a);
      g.gain.setValueAtTime(v, at + Math.max(a, len - r));
      g.gain.linearRampToValueAtTime(0, at + len);
      g.connect(out);
      const dets = opts.detune ? [-opts.detune, opts.detune] : [0];
      for (const fr of Array.isArray(f) ? f : [f])
        for (const d of dets) {
          const o = ctx.createOscillator();
          o.type = type;
          o.frequency.value = fr;
          o.detune.value = d;
          o.connect(into);
          o.start(at);
          o.stop(at + len + 0.02);
        }
      return g;
    };

    // Sends for the melodic parts.
    // The stabs and the hook go through a filter that opens through the build (wide open on the drop).
    const sweep = ctx.createBiquadFilter();
    sweep.type = 'lowpass';
    sweep.Q.value = 2.2;
    sweep.frequency.value = 18000;
    sweep.connect(music);
    send(sweep, 0.6, 0.45);
    const stabBus = ctx.createGain();
    stabBus.connect(sweep);
    const padBus = ctx.createGain();
    padBus.connect(music);
    send(padBus, 0, 0.7);
    const hookBus = ctx.createGain();
    hookBus.connect(sweep);
    const bassBus = ctx.createGain();
    bassBus.connect(duck);

    for (let b = b0; b < b0 + nb; b++) {
      const t0 = (b - b0) * bar;
      const half = b < PARTY.cycle ? 0 : 1;
      const c = b % PARTY.cycle;
      const sec = sectionOf(b);
      const prog = half ? PROG_B : PROG_A;
      const ch = prog[Math.floor(c / 2) % prog.length];
      const hook = half ? HOOK_B : HOOK_A;
      const k = kickIn(b);
      const last = c === PARTY.cycle - 1;

      // Filter sweep: shut in the breakdown, opening through the build, wide on the drop.
      if (sec === 'drop') sweep.frequency.setValueAtTime(18000, t0);
      else if (sec === 'break') sweep.frequency.setValueAtTime(900 + (c - 16) * 60, t0);
      else {
        const p0 = (c - 24) / 8,
          p1 = (c - 23) / 8;
        sweep.frequency.setValueAtTime(1000 * Math.pow(9, p0), t0);
        sweep.frequency.exponentialRampToValueAtTime(1000 * Math.pow(9, p1), t0 + bar - 0.01);
      }

      // --- Drums
      for (let i = 0; i < 4; i++) {
        const t = t0 + i * beat;
        if (k) {
          kick(t, sec === 'build' ? 0.85 : 1);
          // Sidechain pump on the music.
          duck.gain.setValueAtTime(0.42, t);
          duck.gain.linearRampToValueAtTime(1, t + beat * 0.55);
        } else duck.gain.setValueAtTime(1, t);
        if ((i === 1 || i === 3) && (sec === 'drop' || (sec === 'build' && k))) clap(t);
      }
      {
        // Open hats on the off-beats (drop), 16th closed hats in the second half of a drop
        // and all through the second cycle's drop, a soft shaker in the breakdown, hats rising in the build.
        const hats = noiseVoice(t0, t0 + bar + 0.3, 'highpass', 8000, 0.7, drums);
        for (let s = 0; s < 16; s++) {
          const t = t0 + (s * beat) / 4 + (s % 2 ? beat * 0.02 : 0); // a touch of swing
          if (sec === 'drop') {
            if (s % 4 === 2) tap(hats.g, t, 0.2, 0.16);
            else if (c >= 8 || half) tap(hats.g, t, s % 2 ? 0.05 : 0.075, 0.035);
          } else if (sec === 'break') {
            if (s % 2 === 0) tap(hats.g, t, s % 4 === 2 ? 0.06 : 0.035, 0.06);
          } else {
            const p = (c - 24) / 8;
            if (s % 4 === 2) tap(hats.g, t, 0.14 + 0.06 * p, 0.12);
            else if (p > 0.25) tap(hats.g, t, 0.03 + 0.05 * p, 0.03);
          }
        }
      }
      // A rim on the last 16th of every other drop bar, a little groove.
      if (sec === 'drop' && b % 2 === 1) {
        const rim = noiseVoice(t0 + beat * 3.75, t0 + bar + 0.1, 'bandpass', 3200, 6, drums);
        tap(rim.g, t0 + beat * 3.75, 0.18, 0.05);
      }
      // Snare roll through the last 4 bars of the build, then a breath of silence.
      if (sec === 'build' && !k) {
        const div = c < 29 ? 2 : c < 31 ? 4 : 8;
        const sn = noiseVoice(t0, t0 + bar, 'bandpass', 1900, 0.9, drums);
        const steps = div * 4;
        for (let s = 0; s < steps; s++) {
          const t = t0 + (s * beat * 4) / steps;
          if (last && t >= t0 + beat * 3.5) break;
          const v = 0.3 + 0.6 * ((c - 28) / 4 + s / steps / 4);
          tap(sn.g, t, v, Math.min(0.09, (beat * 4) / steps));
        }
      }
      // Riser across the whole build (a piece per bar, following one long curve).
      if (sec === 'build') {
        const span = bar * 8 - beat * 0.5;
        const x0 = ((c - 24) * bar) / span,
          x1 = Math.min(1, ((c - 23) * bar) / span);
        const end = t0 + (x1 - x0) * span;
        const rs = noiseVoice(t0, end + 0.05, 'bandpass', 300, 1.6, music);
        rs.g.setValueAtTime(0.0006 * Math.pow(1000, x0), t0);
        rs.g.exponentialRampToValueAtTime(0.0006 * Math.pow(1000, x1), end - 0.02);
        if (x1 >= 1) rs.g.linearRampToValueAtTime(0, end);
        rs.f.setValueAtTime(300 * Math.pow(23.3, x0), t0);
        rs.f.exponentialRampToValueAtTime(300 * Math.pow(23.3, x1), end);
      }
      // The drop lands: a crash and a sub boom.
      if (c === 0) {
        const cr = noiseVoice(t0, t0 + 3, 'highpass', 5200, 0.5, drums);
        tap(cr.g, t0, 0.3, 2.6);
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(70, t0);
        o.frequency.exponentialRampToValueAtTime(32, t0 + 1.4);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.7, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.6);
        o.connect(g).connect(master);
        o.start(t0);
        o.stop(t0 + 1.7);
      }

      // --- Bass: off-beat house bass on the drop (busier in its second half and the second cycle),
      // plain roots in the first half of the build, nothing in the breakdown.
      if (sec === 'drop') {
        const pat: [number, number][] =
          c >= 8 || half
            ? [
                [0.5, 0],
                [1.25, 12],
                [1.5, 0],
                [2.5, 0],
                [3, 7],
                [3.5, 0],
                [3.75, 12],
              ]
            : [
                [0.5, 0],
                [1.5, 0],
                [2.5, 0],
                [3.5, 0],
                [3.75, 0],
              ];
        for (const [off, iv] of pat) {
          const f = hz(ch.root - 12 + iv + 12);
          const len = beat * (off % 1 === 0.75 ? 0.22 : 0.42);
          note(t0 + off * beat, f, len, 0.36, 'sine', null, bassBus, { release: 0.04 });
          note(t0 + off * beat, f, len, 0.11, 'sawtooth', 520, bassBus, { release: 0.04, cutEnv: 2.2, q: 2 });
        }
      } else if (sec === 'build' && k) {
        for (let i = 0; i < 4; i++) note(t0 + (i + 0.5) * beat, hz(ch.root), beat * 0.4, 0.3, 'sine', null, bassBus, { release: 0.04 });
      }

      // --- Chords: stabs on the drop, a pad in the breakdown and build (and softly under the drop).
      if (sec === 'drop') {
        for (const off of half ? [0.75, 2.25, 3.5] : [0.75, 2.5]) {
          note(t0 + off * beat, ch.notes.map(hz), beat * 0.32, 0.05, 'sawtooth', 2400, stabBus, { detune: 9, cutEnv: 2.5, release: 0.06 });
        }
      }
      if (c % 2 === 0 && (sec !== 'drop' || c >= 8)) {
        const v = sec === 'drop' ? 0.012 : sec === 'break' ? 0.055 : 0.035;
        note(t0, ch.notes.map(hz), bar * 2 + 0.3, v, 'sawtooth', sec === 'drop' ? 1400 : 1800, padBus, { attack: 0.6, release: 0.9, detune: 12 });
      }

      // --- The hook: a bright pluck on the drop's second half (all through the second cycle's drop),
      // and softly in the breakdown.
      const hookOn = (sec === 'drop' && (c >= 8 || half)) || sec === 'break' || (sec === 'build' && c < 28);
      if (hookOn) {
        const v = sec === 'drop' ? 0.1 : 0.11;
        for (const [off, n, len] of hook) {
          if (off < (c % 2) * 4 || off >= (c % 2) * 4 + 4) continue;
          const t = t0 + (off - (c % 2) * 4) * beat;
          if (sec === 'break' && rnd() < 0.25) continue;
          note(t, hz(n), beat * len, v, 'triangle', null, hookBus, { release: beat * len * 0.6 });
          note(t, hz(n + 12), beat * len * 0.5, v * 0.25, 'sine', null, hookBus, { release: beat * len * 0.3 });
        }
      }
    }

    const rendered = await ctx.startRendering();
    return rendered.getChannelData(0);
  };

  const n = Math.ceil(loop * sampleRate);
  const pad = sampleRate; // a second past the loop end, a copy of the start (loopEnd lands cleanly)
  const out = new Float32Array(n + pad);
  for (let b0 = 0; b0 < PARTY.bars; b0 += CHUNK) {
    const d = await renderChunk(b0, CHUNK);
    const off = Math.round(b0 * bar * sampleRate);
    // Overlap-add, folding the very end's tail back onto the start: a seamless loop.
    for (let i = 0; i < d.length; i++) out[(off + i) % n] += d[i];
  }
  compress(out, n, sampleRate);
  for (let i = 0; i < pad; i++) out[n + i] = out[i];
  return { data: out, sampleRate, loop };
}

/** Bus compression (−14 dB, 3.5:1, fast attack, ~180 ms release), done once over the whole loop, then a peak of 0.9. */
export function compress(d: Float32Array, n: number, sampleRate: number) {
  const th = Math.pow(10, -14 / 20),
    ratio = 3.5;
  const att = 1 - Math.exp(-1 / (0.006 * sampleRate)),
    rel = 1 - Math.exp(-1 / (0.18 * sampleRate));
  // Two passes so the envelope at the loop start is already settled from the end.
  let env = 0;
  for (let i = n - Math.floor(sampleRate * 0.5); i < n; i++) {
    const a = Math.abs(d[i]);
    env += (a - env) * (a > env ? att : rel);
  }
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(d[i]);
    env += (a - env) * (a > env ? att : rel);
    const g = env > th ? Math.pow(th / env, 1 - 1 / ratio) : 1;
    d[i] *= g;
    peak = Math.max(peak, Math.abs(d[i]));
  }
  const k = peak > 0 ? 0.9 / peak : 1;
  for (let i = 0; i < n; i++) d[i] *= k;
}
