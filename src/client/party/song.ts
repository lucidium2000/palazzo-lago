import { beatLen } from './beat';

/**
 * The battle record on the right-hand deck, synthesized: two bars of scratch
 * sounds (a sung "ah!", a brass-like synth stab, an "oh", a vocal "hey") in
 * time with the set. (The headliner's songs themselves are recordings now:
 * public/audio/orlo_*.mp3, see setlist.ts; this file keeps the instruments the
 * record is made with: synth notes, and a wordless formant voice, a sawtooth
 * through three vowel formant filters with vibrato and a scoop into each note.)
 */

export type Vowel = 'oo' | 'ah' | 'oh';

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Vowel formants (Hz) and their levels, for a man's voice. */
const FORMANTS: Record<Vowel, { f: number[]; g: number[]; q: number[] }> = {
  oo: { f: [330, 780, 2400], g: [1, 0.32, 0.06], q: [5, 9, 16] },
  oh: { f: [480, 880, 2450], g: [1, 0.45, 0.08], q: [5, 9, 16] },
  ah: { f: [720, 1140, 2600], g: [1, 0.55, 0.12], q: [5, 9, 16] },
};

/** The instruments, built on an offline context. */
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

/** Raw mono samples of a rendered loop (no AudioBuffer: handed straight to the deck's audio thread). */
export interface RawTrack {
  data: Float32Array<ArrayBuffer>;
  sampleRate: number;
  /** Loop length (s); the data runs on a second past it (a copy of the start). */
  loop: number;
}

/**
 * The battle record on the right-hand deck: two bars of scratch sounds in
 * time with the party (a sung "ah!", a brass-like synth stab, an "oh", a
 * vocal "hey"-shaped hit). Short: it loops under the needle.
 */
export async function renderScratchRecord(sampleRate = 32000, bpm?: number): Promise<RawTrack> {
  const beat = beatLen(bpm);
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
