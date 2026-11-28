/**
 * The concert crowd's sounds, synthesized (no recordings, nobody's voice):
 * wordless whoops from men and women in the audience, a whole crowd clapping
 * together (a few dozen hands, each a hair early or late), a group "hey!"
 * shout, a roar (when she walks on, when a song ends), and a murmuring crowd
 * bed that loops under it all (party/hype.ts sets its level).
 *
 * Built lazily the first time the party needs them (audio.ts: `crowd*` sounds),
 * mono, at the audio context's rate.
 */

export type CrowdSfx = 'whooF' | 'whooM' | 'crowdClap' | 'crowdHey' | 'crowdRoar' | 'crowdBed';
export const CROWD_SFX: CrowdSfx[] = ['whooF', 'whooM', 'crowdClap', 'crowdHey', 'crowdRoar', 'crowdBed'];

type V3 = [number, number, number];

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
}

const ramp = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
const mixV = (u: number, a: V3, b: V3): V3 => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];

/** A shout: a buzzing glottal source through three gliding vowel formants (as audio.ts's ad-libs). */
function shout(sr: number, seconds: number, f0: (t: number) => number, vowel: (t: number) => V3, amp: (t: number) => number, breath: number, rand: () => number): Float32Array {
  const n = Math.floor(seconds * sr);
  const out = new Float32Array(n);
  const res = [0, 0, 0].map(() => ({ y1: 0, y2: 0 }));
  let ph = 0,
    tl = 0,
    peak = 1e-6;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = f0(t) * (1 + 0.015 * Math.sin(2 * Math.PI * 5.2 * t) + 0.006 * rand());
    ph = (ph + f / sr) % 1;
    tl += 0.25 * ((ph < 0.65 ? Math.sin((Math.PI * ph) / 0.65) ** 2 : 0) - tl);
    const x = (tl - 0.3) * amp(t) + rand() * breath * amp(t) * 0.5;
    const F = vowel(t);
    let y = 0;
    for (let k = 0; k < 3; k++) {
      const bw = [90, 110, 160][k];
      const r = Math.exp((-Math.PI * bw) / sr);
      const c = res[k];
      const v = (1 - r) * x + 2 * r * Math.cos((2 * Math.PI * F[k]) / sr) * c.y1 - r * r * c.y2;
      c.y2 = c.y1;
      c.y1 = v;
      y += v * [1, 0.55, 0.3][k];
    }
    out[i] = y;
    peak = Math.max(peak, Math.abs(y));
  }
  for (let i = 0; i < n; i++) out[i] *= 0.8 / peak;
  return out;
}

/** One person's whoop (`male`: lower, a man's vowels), varied by `k`. */
function whoop(sr: number, male: boolean, k: number): Float32Array {
  const rand = rng(1000 + k * 77 + (male ? 5 : 0));
  const base = (male ? 170 : 360) * (1 + 0.12 * rand());
  const sc = male ? 1 : 1.15;
  const fv = (v: V3): V3 => [v[0] * sc, v[1] * sc, v[2] * (male ? 1 : 1.12)];
  const len = 0.55 + 0.25 * Math.abs(rand());
  switch (k % 3) {
    case 0: // "woo-oo"
      return shout(sr, len, (t) => base * (1 + 0.8 * ramp(t, 0, 0.15) - 0.45 * ramp(t, len * 0.6, len)), (t) => fv(mixV(ramp(t, 0, 0.12), [320, 620, 2200], [400, 900, 2300])), (t) => ramp(t, 0, 0.05) * (1 - ramp(t, len * 0.7, len)), 0.15, rand);
    case 1: // "yeah!"
      return shout(sr, len * 0.8, (t) => base * (1.35 - 0.35 * ramp(t, 0.1, len * 0.8)), (t) => fv(mixV(ramp(t, 0.02, 0.2), [300, 2100, 2900], [660, 1700, 2400])), (t) => ramp(t, 0, 0.04) * (1 - ramp(t, len * 0.5, len * 0.8)), 0.18, rand);
    default: // "whoa!"
      return shout(sr, len, (t) => base * (1.25 + 0.1 * ramp(t, 0, 0.1) - 0.3 * ramp(t, len * 0.5, len)), (t) => fv(mixV(ramp(t, 0, 0.25), [300, 2200, 2900], [700, 1150, 2600])), (t) => ramp(t, 0, 0.05) * (1 - ramp(t, len * 0.65, len)), 0.16, rand);
  }
}

/** Adds `src` into `dst` at sample `at`, scaled. */
function mixIn(dst: Float32Array, src: Float32Array, at: number, g: number) {
  for (let i = 0; i < src.length && at + i < dst.length; i++) if (at + i >= 0) dst[at + i] += src[i] * g;
}

function normalize(d: Float32Array, to: number) {
  let peak = 1e-6;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < d.length; i++) d[i] *= to / peak;
  return d;
}

/** A crowd clapping together on one beat: `hands` claps spread over ~45 ms. */
function crowdClap(sr: number, seed: number, hands = 28): Float32Array {
  const rand = rng(seed);
  const n = Math.floor(0.3 * sr);
  const out = new Float32Array(n);
  for (let h = 0; h < hands; h++) {
    const at = Math.floor((0.004 + 0.045 * (0.5 + 0.5 * rand()) ** 1.5) * sr);
    const g = 0.4 + 0.6 * Math.abs(rand());
    // A clap: a bright noise burst ringing in a palm-sized cavity (one resonance, 900..1700 Hz).
    const f = 900 + 800 * Math.abs(rand());
    const r = Math.exp((-Math.PI * 600) / sr);
    let y1 = 0,
      y2 = 0;
    const len = Math.floor(0.05 * sr);
    for (let i = 0; i < len && at + i < n; i++) {
      const e = Math.exp(-i / (sr * 0.008));
      const x = rand() * e;
      const v = (1 - r) * x + 2 * r * Math.cos((2 * Math.PI * f) / sr) * y1 - r * r * y2;
      y2 = y1;
      y1 = v;
      out[at + i] += (v * 3 + x * 0.35) * g;
    }
  }
  return normalize(out, 0.8);
}

/** The crowd shouting "hey!" together (men and women, a little ragged). */
function crowdHey(sr: number, seed: number): Float32Array {
  const rand = rng(seed);
  const out = new Float32Array(Math.floor(0.7 * sr));
  for (let v = 0; v < 10; v++) {
    const male = v % 2 === 0;
    const base = (male ? 180 : 380) * (1 + 0.15 * rand());
    const sc = male ? 1 : 1.15;
    const s = shout(sr, 0.42, (t) => base * (1.3 + 0.2 * ramp(t, 0.03, 0.1) - 0.4 * ramp(t, 0.15, 0.42)), (t) => mixV(ramp(t, 0.1, 0.35), [560 * sc, 1800 * sc, 2500], [330 * sc, 2250 * sc, 2900]), (t) => ramp(t, 0.03, 0.07) * (1 - ramp(t, 0.25, 0.42)), 0.3, rand);
    mixIn(out, s, Math.floor((0.01 + 0.04 * Math.abs(rand())) * sr), 0.5 + 0.5 * Math.abs(rand()));
  }
  return normalize(out, 0.85);
}

/** A big crowd roaring: shaped noise, a swell and a long tail, with whoops all through it. */
function crowdRoar(sr: number, seed: number): Float32Array {
  const rand = rng(seed);
  const T = 4.2;
  const n = Math.floor(T * sr);
  const out = new Float32Array(n);
  let l1 = 0,
    l2 = 0,
    hp = 0,
    px = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    // Band-limited noise (a room full of voices): low-pass then high-pass.
    l1 += 0.12 * (rand() - l1);
    l2 += 0.3 * (l1 - l2);
    hp = 0.96 * (hp + l2 - px);
    px = l2;
    const env = ramp(t, 0, 0.35) * (t < 1.6 ? 1 : Math.exp(-(t - 1.6) / 1.1));
    out[i] = hp * 4 * env * (0.85 + 0.15 * Math.sin(t * 17 + Math.sin(t * 5)));
  }
  for (let k = 0; k < 18; k++) {
    const w = whoop(sr, k % 2 === 0, k + seed);
    const at = Math.floor(Math.abs(rand()) * 2.6 * sr);
    mixIn(out, w, at, 0.12 + 0.1 * Math.abs(rand()));
  }
  return normalize(out, 0.9);
}

/** The crowd murmuring and chattering (a seamless 6 s loop). */
function crowdBed(sr: number): Float32Array {
  const rand = rng(4242);
  const T = 6;
  const n = Math.floor(T * sr);
  const out = new Float32Array(n);
  // Many voices, each a band of noise opening and closing at syllable rate.
  const voices = Array.from({ length: 14 }, () => ({ f: 3 + 3 * Math.abs(rand()), ph: Math.abs(rand()) * 6, lo: 0, bp: 0, a: 0.08 + 0.04 * Math.abs(rand()) }));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let s = 0;
    for (const v of voices) {
      v.lo += v.a * (rand() - v.lo);
      // Syllables: whole cycles over the loop so it wraps cleanly.
      const cyc = Math.round(v.f * T) / T;
      const open = Math.max(0, Math.sin(2 * Math.PI * cyc * t + v.ph)) ** 2;
      s += v.lo * open;
    }
    out[i] = s;
  }
  // Take the rumble out, and fold the seam.
  let hp = 0,
    px = 0;
  for (let i = 0; i < n; i++) {
    hp = 0.97 * (hp + out[i] - px);
    px = out[i];
    out[i] = hp;
  }
  const fade = Math.floor(0.3 * sr);
  for (let i = 0; i < fade; i++) {
    const a = i / fade;
    out[i] = out[i] * a + out[n - fade + i] * (1 - a);
  }
  return normalize(out.subarray(0, n - fade).slice(), 0.6);
}

/** Every variant of a crowd sound, as raw samples (audio.ts wraps them in AudioBuffers). */
export function renderCrowdSfx(name: CrowdSfx, sr: number): Float32Array[] {
  switch (name) {
    case 'whooF':
      return [0, 1, 2, 3, 4, 5].map((k) => whoop(sr, false, k));
    case 'whooM':
      return [0, 1, 2, 3, 4, 5].map((k) => whoop(sr, true, k));
    case 'crowdClap':
      return [11, 12, 13, 14].map((s) => crowdClap(sr, s));
    case 'crowdHey':
      return [21, 22].map((s) => crowdHey(sr, s));
    case 'crowdRoar':
      return [31, 32].map((s) => crowdRoar(sr, s));
    case 'crowdBed':
      return [crowdBed(sr)];
  }
}
