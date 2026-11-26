/**
 * The grand piano's tone, synthesized: one note rendered to samples. Pure
 * math (no WebAudio), so it runs in a worker (pianoworker.ts) or in tests.
 *
 * A struck piano string: partials that are stretched sharp (inharmonicity
 * grows with the partial number), two or three slightly detuned strings per
 * note that beat against each other, a hammer-position comb that thins some
 * partials, a fast "prompt" decay into a long "aftersound", higher partials
 * dying sooner, and a felt-hammer knock at the start. Low notes ring for
 * seconds, high ones for a moment.
 */

/** Rendered every ZONE semitones; notes in between are pitch-shifted (at most ±2). */
export const ZONE = 4;
export const ZONE_FIRST = 23;
export const ZONE_LAST = 107;
export const TONE_RATE = 22050;

export const zoneOf = (midi: number) => {
  const k = Math.round((midi - ZONE_FIRST) / ZONE);
  return ZONE_FIRST + ZONE * Math.max(0, Math.min((ZONE_LAST - ZONE_FIRST) / ZONE, k));
};
export const zones = (): number[] => {
  const z: number[] = [];
  for (let m = ZONE_FIRST; m <= ZONE_LAST; m += ZONE) z.push(m);
  return z;
};

export const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Long-term ("aftersound") decay time constant of a note's fundamental (s). */
export const sustainTau = (midi: number) => Math.min(9, Math.max(0.35, 9 * (freq(midi) / 55) ** -0.62));

/** How long the rendered note is (s). */
export const toneLength = (midi: number) => Math.min(5.2, Math.max(1.1, sustainTau(midi) * 2.2));

/** Deterministic per-note randomness. */
function rng(seed: number) {
  let s = (seed * 7919 + 104729) % 2147483647;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Renders a note at `rate` Hz (mono, peak-normalised to 0.85). */
export function renderTone(midi: number, rate = TONE_RATE): Float32Array {
  const f0 = freq(midi);
  const len = Math.ceil(toneLength(midi) * rate);
  const out = new Float32Array(len);
  const rnd = rng(midi);
  const nyq = rate * 0.45;
  // Inharmonicity: tiny in the bass, larger in the treble.
  const B = 0.00007 * 2 ** ((midi - 21) / 22);
  // Strings per note, and how far apart they're tuned (cents).
  const strings = midi < 30 ? 1 : midi < 40 ? 2 : 3;
  const spread = 0.55 + rnd() * 0.5;
  const tau2 = sustainTau(midi);
  const tau1 = tau2 * 0.16;
  // Hammer strikes at ~1/8 of the string: every 8th partial is weak.
  const strike = 0.118 + rnd() * 0.01;
  const maxP = midi < 40 ? 34 : midi < 60 ? 22 : midi < 80 ? 14 : 8;
  for (let n = 1; n <= maxP; n++) {
    const fn = n * f0 * Math.sqrt(1 + B * n * n);
    if (fn > nyq) break;
    let amp = Math.abs(Math.sin(Math.PI * n * strike)) / n ** 0.85;
    // Bass: the fundamental is weaker than the next partials (small soundboard radiation).
    if (n === 1 && f0 < 110) amp *= 0.35 + 0.65 * (f0 / 110);
    // Brightness rolls off above ~5 kHz.
    amp /= 1 + (fn / 5000) ** 2;
    // Higher partials decay faster.
    const k = 1 + (fn / 1400) ** 1.1 + (n - 1) * 0.04;
    const d1 = Math.exp(-1 / (rate * (tau1 / k))),
      d2 = Math.exp(-1 / (rate * (tau2 / k)));
    for (let s = 0; s < strings; s++) {
      const cents = strings === 1 ? 0 : (s - (strings - 1) / 2) * spread * (1 + rnd() * 0.3);
      const f = fn * 2 ** (cents / 1200);
      const w = (2 * Math.PI * f) / rate;
      const cr = Math.cos(w),
        sr = Math.sin(w);
      // Random phase per string.
      const ph = rnd() * Math.PI * 2;
      let c = Math.cos(ph),
        sn = Math.sin(ph);
      let e1 = 0.62 * (amp / strings),
        e2 = 0.38 * (amp / strings);
      for (let i = 0; i < len; i++) {
        out[i] += sn * (e1 + e2);
        const nc = c * cr - sn * sr;
        sn = sn * cr + c * sr;
        c = nc;
        e1 *= d1;
        e2 *= d2;
        if ((i & 4095) === 4095) {
          // Keep the rotation on the unit circle.
          const m = 1 / Math.hypot(c, sn);
          c *= m;
          sn *= m;
        }
        if (e1 + e2 < 1e-6) break;
      }
    }
  }
  // The hammer: a short filtered knock (felt on steel), brighter up high, and the key bed's thump.
  const knockLen = Math.min(len, Math.ceil(rate * 0.03));
  const lpA = Math.min(0.9, (Math.min(6000, 700 + f0 * 3) * 2 * Math.PI) / rate);
  let y = 0;
  const kDecay = midi > 80 ? 0.0025 : 0.005;
  for (let i = 0; i < knockLen; i++) {
    const t = i / rate;
    y += lpA * (rnd() * 2 - 1 - y);
    out[i] += y * 0.22 * Math.exp(-t / kDecay) + Math.sin(2 * Math.PI * 110 * t) * 0.05 * Math.exp(-t / 0.012);
  }
  // A 1.5 ms rise (no click), a fade over the last 25 % (the rendered note's end is never heard as a cut).
  const rise = Math.ceil(rate * 0.0015);
  for (let i = 0; i < rise && i < len; i++) out[i] *= i / rise;
  const fade = Math.floor(len * 0.25);
  for (let i = 0; i < fade; i++) out[len - 1 - i] *= (i / fade) ** 2;
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) {
    const g = 0.85 / peak;
    for (let i = 0; i < len; i++) out[i] *= g;
  }
  return out;
}
