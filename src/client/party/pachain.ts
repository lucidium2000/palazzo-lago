/**
 * The stage PA's vocal chain, one per voice on the mic (yours, a friend's):
 *
 *   in → high-pass 120 Hz → compressor (3.5:1, -24 dB) → make-up → presence (+3.5 dB at 3.2 kHz)
 *      ├─ dry ─────────────────────────────────────────────────┐
 *      ├─ send → plate reverb (generated impulse, ~1.2 s) ────┤
 *      └─ slap delay 90 ms (low feedback, darkened) ──────────┴→ limiter (-3 dB, 20:1) → level → out
 *
 * `vad` taps the signal after the high-pass (what the voice-activity detector
 * and the ducking listen to); `meter` taps the end of the chain.
 */

/**
 * The pool's speaker stacks (the music and the stage PA play from both): each
 * stack's level, and how it carries. Inverse distance from 6 m (full level
 * anywhere on the dance floor and in front of the stage), halving every
 * doubling past that, so the pool bar ~20 m off hears it ~10 dB down: a real
 * pool party, loud on the floor and still there across the deck. (Measured at
 * the listener with the house record: ~-15 dBFS RMS on the dance floor, peaks
 * under -3 dBFS; see README.)
 */
export const STACKS = { vol: 0.45, ref: 6, rolloff: 1, max: 200 };
/** The stage PA's voices at the stacks: a voice sits a little over the music. */
export const PA_VOL = STACKS.vol * 1.6;

export interface PaChain {
  readonly input: GainNode;
  /** The end of the chain (its gain is this voice's level on the PA). */
  readonly output: GainNode;
  readonly vad: AnalyserNode;
  readonly meter: AnalyserNode;
  dispose(): void;
}

const plates = new WeakMap<BaseAudioContext, AudioBuffer>();

/**
 * A short plate-ish impulse response: a few ms of pre-delay, a dense noise
 * tail decaying to -60 dB in `rt60` seconds, getting darker as it decays
 * (a one-pole low-pass that closes over the tail), no early reflections.
 * Deterministic (seeded), shared per audio context.
 */
export function plateImpulse(ctx: BaseAudioContext, rt60 = 1.2): AudioBuffer {
  const cached = plates.get(ctx);
  if (cached) return cached;
  const sr = ctx.sampleRate;
  const pre = Math.round(sr * 0.008);
  const n = pre + Math.round(sr * rt60);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let seed = 0x9e3779b9 ^ (ch * 0x85ebca6b);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const noise = seed / 2147483648 - 1;
      const t = (i - pre) / sr;
      // Brightness: the low-pass closes from ~12 kHz to ~2 kHz over the tail.
      const fc = 12000 * Math.pow(2000 / 12000, Math.min(1, t / rt60));
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      lp += (noise - lp) * a;
      const env = Math.pow(10, (-3 * t) / rt60) * Math.min(1, t / 0.004);
      d[i] = lp * env;
    }
  }
  plates.set(ctx, buf);
  return buf;
}

export function buildPaChain(ctx: BaseAudioContext): PaChain {
  const nodes: AudioNode[] = [];
  const add = <T extends AudioNode>(n: T): T => {
    nodes.push(n);
    return n;
  };
  const input = add(ctx.createGain());
  const hpf = add(ctx.createBiquadFilter());
  hpf.type = 'highpass';
  hpf.frequency.value = 120;
  hpf.Q.value = 0.707;
  const comp = add(ctx.createDynamicsCompressor());
  comp.threshold.value = -24;
  comp.knee.value = 10;
  comp.ratio.value = 3.5;
  comp.attack.value = 0.006;
  comp.release.value = 0.18;
  const makeup = add(ctx.createGain());
  makeup.gain.value = 1.8;
  const presence = add(ctx.createBiquadFilter());
  presence.type = 'peaking';
  presence.frequency.value = 3200;
  presence.Q.value = 0.9;
  presence.gain.value = 3.5;
  const sum = add(ctx.createGain());
  const dry = add(ctx.createGain());
  dry.gain.value = 1;
  const send = add(ctx.createGain());
  send.gain.value = 0.28;
  const verb = add(ctx.createConvolver());
  verb.buffer = plateImpulse(ctx);
  const delay = add(ctx.createDelay(0.5));
  delay.delayTime.value = 0.09;
  const dark = add(ctx.createBiquadFilter());
  dark.type = 'lowpass';
  dark.frequency.value = 3500;
  const fb = add(ctx.createGain());
  fb.gain.value = 0.18;
  const slap = add(ctx.createGain());
  slap.gain.value = 0.22;
  const limiter = add(ctx.createDynamicsCompressor());
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.08;
  const output = add(ctx.createGain());
  const vad = add(ctx.createAnalyser());
  vad.fftSize = 1024;
  const meter = add(ctx.createAnalyser());
  meter.fftSize = 1024;

  input.connect(hpf);
  hpf.connect(vad);
  hpf.connect(comp);
  comp.connect(makeup);
  makeup.connect(presence);
  presence.connect(dry);
  dry.connect(sum);
  presence.connect(send);
  send.connect(verb);
  verb.connect(sum);
  presence.connect(delay);
  delay.connect(dark);
  dark.connect(fb);
  fb.connect(delay);
  dark.connect(slap);
  slap.connect(sum);
  sum.connect(limiter);
  limiter.connect(output);
  output.connect(meter);

  return {
    input,
    output,
    vad,
    meter,
    dispose() {
      for (const n of nodes) n.disconnect();
    },
  };
}
