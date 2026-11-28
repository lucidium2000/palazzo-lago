/**
 * Fight mode's own sounds, synthesized (nothing downloaded, nothing borrowed):
 *
 *  - wordless effort sounds for fighters without a recorded take for a moment:
 *    a short grunt on a punch ("hup"), an "oof" when one lands on them (a
 *    buzzy throat through vowel formants, a breath of air; pitched up or down
 *    per person by the playback rate);
 *  - the announcer's stand-in stings until his takes are recorded: a rising
 *    stab for a round, a big hit for "fight", a swell into a boom for a
 *    knockout, a little rising fanfare for the win, a falling pair for a fight
 *    called off, and a two-strike ring bell;
 *  - a crack on top of a crit.
 *
 * Each is a few variants of mono samples (rendered the first time a fight
 * wants them: audio.ts plays them like its other effects).
 */

export const FIGHT_SFX = ['grunt', 'oof', 'ringBell', 'stingRound', 'stingFight', 'stingKO', 'stingWin', 'stingOver', 'crack'] as const;
export type FightSfx = (typeof FIGHT_SFX)[number];

/** A seeded noise source (the same sounds every session). */
function noise(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
}

/** A two-pole resonant band-pass (RBJ), stateful. */
function bandpass(sr: number, f: number, q: number) {
  const w = (2 * Math.PI * f) / sr,
    al = Math.sin(w) / (2 * q),
    c = Math.cos(w);
  const a0 = 1 + al;
  const b0 = al / a0,
    b2 = -al / a0,
    a1 = (-2 * c) / a0,
    a2 = (1 - al) / a0;
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  return (x: number) => {
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}

function lowpass1(a: number) {
  let y = 0;
  return (x: number) => (y += a * (x - y));
}

const env = (t: number, a: number, d: number) => (t < a ? t / a : Math.exp(-(t - a) / d));

/** A vowel from a throat: pulses at f0(t) through two formants, with some breath. */
function voiced(sr: number, secs: number, seed: number, o: { f0: (t: number) => number; f1: number; f2: number; amp: (t: number) => number; breath: number }) {
  const n = Math.floor(secs * sr);
  const out = new Float32Array(n);
  const rnd = noise(seed);
  const r1 = bandpass(sr, o.f1, 5),
    r2 = bandpass(sr, o.f2, 7),
    rb = bandpass(sr, 1800, 1.2);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = o.f0(t) * (1 + 0.012 * rnd());
    ph += f / sr;
    if (ph >= 1) ph -= 1;
    // A glottal-ish pulse: a sharp rise, a slower fall.
    const g = ph < 0.4 ? Math.sin((Math.PI * ph) / 0.4) : 0;
    const air = rb(rnd()) * o.breath;
    const v = (r1(g) * 1.0 + r2(g) * 0.55 + air) * o.amp(t);
    out[i] = v;
  }
  return normalise(out, 0.8);
}

function normalise(d: Float32Array, peak: number) {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
  return d;
}

function render(sr: number, secs: number, fn: (t: number, i: number) => number, peak = 0.8) {
  const n = Math.floor(secs * sr);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = fn(i / sr, i);
  return normalise(d, peak);
}

/** A detuned saw stack (a brassy stab) at these frequencies. */
function stab(freqs: number[], detune = 0.006) {
  const ph = freqs.flatMap(() => [0, 0.33, 0.67]);
  return (t: number, sr: number) => {
    let v = 0;
    freqs.forEach((f, k) => {
      for (let j = 0; j < 3; j++) {
        const i = k * 3 + j;
        ph[i] += (f * (1 + (j - 1) * detune)) / sr;
        ph[i] -= Math.floor(ph[i]);
        v += ph[i] * 2 - 1;
      }
    });
    void t;
    return v / (freqs.length * 3);
  };
}

export function renderFightSfx(name: FightSfx, sr: number): Float32Array[] {
  switch (name) {
    case 'grunt':
      // "Hup" / "hah": short, effortful, a little different each time.
      return [0, 1, 2, 3].map((k) =>
        voiced(sr, 0.26, 101 + k, {
          f0: (t) => (118 + k * 9) * (1.12 - t * 0.9),
          f1: [640, 720, 560, 680][k],
          f2: [1190, 1100, 1250, 1050][k],
          amp: (t) => env(t, 0.012, 0.07) * (t < 0.2 ? 1 : Math.max(0, 1 - (t - 0.2) / 0.06)),
          breath: 0.5,
        }),
      );
    case 'oof':
      // The air knocked out: a burst of breath into a falling "uhf".
      return [0, 1, 2].map((k) => {
        const v = voiced(sr, 0.42, 201 + k, {
          f0: (t) => (132 + k * 11) * (1.05 - t * 0.8),
          f1: [520, 600, 470][k],
          f2: [950, 1050, 900][k],
          amp: (t) => env(t, 0.02, 0.12),
          breath: 1.3,
        });
        return v;
      });
    case 'ringBell': {
      // Two strikes of a ring bell: inharmonic partials, a long ring.
      const parts = [
        [1.0, 1],
        [2.32, 0.55],
        [4.25, 0.3],
        [6.63, 0.18],
      ];
      const strike = (t: number) => (t < 0 ? 0 : parts.reduce((s, [m, a]) => s + Math.sin(2 * Math.PI * 820 * m * t) * a * Math.exp(-t * (1.6 + m)), 0) * Math.min(1, t * 2000));
      return [render(sr, 1.8, (t) => strike(t) + strike(t - 0.34) * 0.9, 0.7)];
    }
    case 'stingRound': {
      // A rising brass stab with a drum hit under it.
      const s = stab([110, 165, 220, 277]);
      const lp = lowpass1(0.12);
      const rnd = noise(301);
      return [render(sr, 1.0, (t) => lp(s(t, sr)) * env(t, 0.02, 0.35) * (1 + 0.3 * Math.sin(t * 30)) + Math.sin(2 * Math.PI * (70 - 30 * t) * t) * env(t, 0.002, 0.12) * 0.9 + rnd() * env(t, 0.001, 0.03) * 0.3)];
    }
    case 'stingFight': {
      // The big hit: a crash, a sub drop, a stab a fifth up.
      const s = stab([147, 220, 294, 370]);
      const lp = lowpass1(0.2);
      const rnd = noise(401);
      const crash = bandpass(sr, 5200, 0.7);
      return [render(sr, 1.3, (t) => lp(s(t, sr)) * env(t, 0.008, 0.28) + Math.sin(2 * Math.PI * (60 - 25 * t) * t) * env(t, 0.002, 0.3) * 1.1 + crash(rnd()) * env(t, 0.001, 0.4) * 0.8)];
    }
    case 'stingKO': {
      // A reversed swell into a heavy boom and a ring-out.
      const rnd = noise(501);
      const sw = bandpass(sr, 3000, 0.8);
      const lp = lowpass1(0.05);
      return [
        render(sr, 2.2, (t) => {
          const swell = t < 0.7 ? sw(rnd()) * (t / 0.7) ** 3 * 0.9 : 0;
          const u = t - 0.7;
          const boom = u >= 0 ? Math.sin(2 * Math.PI * (48 - 14 * u) * u) * env(u, 0.003, 0.55) * 1.3 + lp(rnd()) * env(u, 0.001, 0.25) * 2.5 : 0;
          return swell + boom;
        }),
      ];
    }
    case 'stingWin': {
      // Three rising stabs.
      const notes = [
        [196, 247, 294],
        [220, 277, 330],
        [262, 330, 392, 523],
      ];
      const stabs = notes.map((n) => stab(n));
      const lp = lowpass1(0.18);
      return [
        render(sr, 1.6, (t) => {
          let v = 0;
          stabs.forEach((s, k) => {
            const u = t - k * 0.16;
            if (u >= 0) v += s(u, sr) * env(u, 0.01, k === 2 ? 0.5 : 0.1);
          });
          return lp(v);
        }),
      ];
    }
    case 'stingOver': {
      const a = stab([196, 233]),
        b = stab([147, 175]);
      const lp = lowpass1(0.1);
      return [render(sr, 1.2, (t) => lp(a(t, sr) * env(t, 0.01, 0.15) + (t > 0.25 ? b(t - 0.25, sr) * env(t - 0.25, 0.01, 0.4) : 0)))];
    }
    case 'crack': {
      const rnd = noise(601);
      const hp = bandpass(sr, 3800, 0.9);
      return [0, 1].map((k) => render(sr, 0.18, (t) => hp(rnd()) * env(t, 0.0004, 0.012 + k * 0.006) + Math.sin(2 * Math.PI * (240 - 300 * t) * t) * env(t, 0.001, 0.03) * 0.6, 0.9));
    }
  }
}
