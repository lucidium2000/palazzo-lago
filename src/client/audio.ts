import * as THREE from 'three';
import { AMBIENCE_RATE, buildWalla, renderFloor } from './ambience';
import { decodeAudio } from './musicload';
import { arrangement, detectSections, plainArrangement, type Arrangement } from './party/beat';
import { TRACKS } from './party/setlist';

/**
 * The game's sound. Most effects are synthesized in code at startup; a few
 * are recordings (public/audio/: the slot jackpot, the pool crowd's cheer and
 * applause), fetched once audio is unlocked, with a synthesized stand-in until
 * they arrive (or if they can't be had). Sounds are positional: in VR a chip
 * clack comes from the felt, the slot jingle from the machine.
 *
 * The casino floor's music is a real track (casino_lounge.mp3, fetched after
 * the loading screen), and the room tone is procedural with a recorded room
 * underneath (see ambience.ts).
 */

type SoundName =
  | 'chip'
  | 'chips'
  | 'click'
  | 'ballRoll'
  | 'ballDrop'
  | 'reelTick'
  | 'reelStop'
  | 'winSmall'
  | 'winBig'
  | 'bonus'
  | 'lever'
  | 'denied'
  | 'stepMarble'
  | 'stepCarpet'
  | 'stepStone'
  | 'cheer'
  | 'gasp'
  | 'clink'
  | 'pour'
  | 'sip'
  | 'door'
  | 'water'
  | 'shaker'
  | 'banjo'
  | 'gulp'
  | 'tension'
  | 'fanfare'
  | 'ding'
  | 'liftHum'
  | 'splash'
  | 'shatter'
  | 'punch'
  | 'block'
  | 'slap'
  | 'whoosh'
  | 'thunk'
  | 'swim'
  | 'land'
  | 'crunch'
  | 'munch'
  | SampleName;

/** Recorded effects (public/audio/<name>.mp3) and the synthesized sound that stands in for each until it's loaded. */
const SAMPLES = { jackpot: 'winBig', crowdCheer: 'cheer', applause: 'cheer' } as const;
type SampleName = keyof typeof SAMPLES;
const SAMPLE_FILES: Record<SampleName, string> = { jackpot: 'jackpot', crowdCheer: 'cheer', applause: 'applause' };

const rand = (() => {
  let s = 12345;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
})();

function synth(ctx: BaseAudioContext, seconds: number, fn: (t: number, i: number) => number, channels = 1) {
  const sr = ctx.sampleRate;
  const len = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(channels, len, sr);
  for (let c = 0; c < channels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = fn(i / sr, i);
  }
  return buf;
}

const env = (t: number, attack: number, decay: number) => (t < attack ? t / attack : Math.exp(-(t - attack) / decay));

function bell(f: number, t: number, decay = 0.4) {
  return (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * f * 2.01 * t) + 0.15 * Math.sin(2 * Math.PI * f * 3.02 * t)) * env(t, 0.004, decay);
}

type Buffers = Record<Exclude<SoundName, SampleName>, AudioBuffer> & { variants: Partial<Record<SoundName, AudioBuffer[]>> };

function buildBuffers(ctx: BaseAudioContext): Buffers {
  // One-pole filters, stateful per buffer.
  const lp = (a: number) => {
    let y = 0;
    return (x: number) => (y += a * (x - y));
  };
  const hp = (a: number) => {
    let y = 0,
      px = 0;
    return (x: number) => {
      y = a * (y + x - px);
      px = x;
      return y;
    };
  };

  const chipHit = () => {
    const h = hp(0.55);
    return (t: number) => (h(rand()) * 0.6 * env(t, 0.0005, 0.006) + Math.sin(2 * Math.PI * 4300 * t) * 0.35 * env(t, 0.0005, 0.018));
  };

  const chip = (() => {
    const a = chipHit(),
      b = chipHit();
    return synth(ctx, 0.12, (t) => a(t) + (t > 0.035 ? b(t - 0.035) * 0.6 : 0));
  })();

  const chips = (() => {
    const hits = Array.from({ length: 7 }, (_, k) => ({ at: k * 0.028 + Math.abs(rand()) * 0.015, f: chipHit(), g: 0.4 + Math.abs(rand()) * 0.5 }));
    return synth(ctx, 0.35, (t) => hits.reduce((s, h) => s + (t > h.at ? h.f(t - h.at) * h.g : 0), 0) * 0.8);
  })();

  const click = synth(ctx, 0.05, (t) => Math.sin(2 * Math.PI * 1800 * t) * env(t, 0.001, 0.008) * 0.5);

  const ballRoll = (() => {
    const l = lp(0.05),
      l2 = lp(0.2);
    return synth(ctx, 2, (t) => {
      const wobble = 0.7 + 0.3 * Math.sin(2 * Math.PI * 7 * t);
      return (l(rand()) * 2.5 + l2(rand()) * 0.25) * wobble * 0.8;
    });
  })();

  const ballDrop = (() => {
    const bounces = [0, 0.09, 0.16, 0.21, 0.25];
    return synth(ctx, 0.4, (t) =>
      bounces.reduce((s, b, k) => s + (t > b ? Math.sin(2 * Math.PI * (2600 - k * 200) * (t - b)) * env(t - b, 0.0005, 0.01) * (1 - k * 0.18) : 0), 0) * 0.6,
    );
  })();

  const reelTick = (() => {
    const h = hp(0.7);
    return synth(ctx, 1, (t) => {
      const ph = (t * 18) % 1;
      return (h(rand()) * 0.25 * env(ph / 18, 0.0005, 0.004) + Math.sin(2 * Math.PI * 900 * t) * 0.05 * env(ph / 18, 0.001, 0.01));
    });
  })();

  const reelStop = (() => {
    const l = lp(0.08);
    return synth(ctx, 0.25, (t) => (Math.sin(2 * Math.PI * 110 * t) * 0.7 + l(rand()) * 1.2) * env(t, 0.002, 0.05));
  })();

  const notes = (seq: [number, number][], len: number, decay = 0.35) =>
    synth(ctx, len, (t) => seq.reduce((s, [f, at]) => s + (t > at ? bell(f, t - at, decay) : 0), 0) * 0.22);

  const C5 = 523.25,
    E5 = 659.25,
    G5 = 783.99,
    C6 = 1046.5,
    E6 = 1318.5,
    G6 = 1568;
  const winSmall = notes([[C5, 0], [E5, 0.08], [G5, 0.16], [C6, 0.24]], 1.0);
  const winBig = notes(
    [[C5, 0], [E5, 0.1], [G5, 0.2], [C6, 0.3], [G5, 0.45], [C6, 0.55], [E6, 0.65], [G6, 0.8], [C6, 1.0], [E6, 1.05], [G6, 1.1]],
    2.4,
    0.5,
  );
  const bonus = synth(ctx, 1.4, (t) => {
    const f = 600 + 1800 * Math.min(1, t / 1.0);
    return bell(f, t % 0.06, 0.05) * 0.25 * (1 - t / 1.4);
  });
  const lever = (() => {
    const l = lp(0.03);
    return synth(ctx, 0.5, (t) => l(rand()) * 3 * env(t, 0.05, 0.12) + Math.sin(2 * Math.PI * 70 * t) * 0.4 * env(t - 0.3 > 0 ? t - 0.3 : 0, 0.002, 0.06) * (t > 0.3 ? 1 : 0));
  })();
  // A bright banjo-style roll (plucked strings, G major) for bonuses, and a cartoon gulp.
  const pluck = (f: number, t: number) => {
    if (t < 0) return 0;
    const tw = f * (1 + 0.012 * Math.exp(-t * 40));
    let v = 0;
    for (let h = 1; h <= 6; h++) v += (Math.sin(2 * Math.PI * tw * h * t) / h) * Math.exp(-t * (3 + h * 2.2));
    return v * Math.min(1, t * 900);
  };
  const G3 = 196,
    B3 = 246.94,
    D4 = 293.66,
    G4 = 392,
    B4 = 493.88,
    D5 = 587.33,
    G5b = 783.99;
  const roll: [number, number][] = [
    [G4, 0], [B4, 0.09], [D5, 0.18], [G3, 0.27], [G4, 0.36], [B4, 0.45], [D5, 0.54], [G5b, 0.63],
    [D4, 0.72], [B4, 0.81], [D5, 0.9], [G5b, 0.99], [B3, 1.08], [D5, 1.17], [G5b, 1.26],
  ];
  const banjo = synth(ctx, 2.0, (t) => roll.reduce((acc, [f, at]) => acc + pluck(f, t - at), 0) * 0.16);
  const gulp = synth(ctx, 0.28, (t) => {
    const f = 260 + 900 * (t / 0.28) ** 1.5;
    return Math.sin(2 * Math.PI * f * t) * 0.35 * env(t, 0.01, 0.08) + bell(1400, Math.max(0, t - 0.12), 0.08) * 0.12 * (t > 0.12 ? 1 : 0);
  });
  // Rising tremolo riser while a coin flies to a pig (will it pop?).
  const tension = synth(ctx, 0.9, (t) => {
    const f = 330 * Math.pow(2, t / 0.9);
    const trem = 0.6 + 0.4 * Math.sin(2 * Math.PI * 14 * t);
    return (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * f * 1.5 * t)) * 0.16 * trem * Math.min(1, t * 8) * Math.min(1, (0.9 - t) * 10);
  });
  // A cheeky brass-band stinger for BIG / MEGA / EPIC wins.
  const brass = (f: number, t: number, len: number) => {
    if (t < 0 || t > len) return 0;
    let v = 0;
    for (let h = 1; h <= 7; h++) v += Math.sin(2 * Math.PI * f * h * t + h) / (h * 0.9);
    return v * Math.min(1, t * 40) * Math.min(1, (len - t) * 12) * (1 + 0.04 * Math.sin(2 * Math.PI * 6 * t));
  };
  const fanfareNotes: [number, number, number][] = [
    [392, 0, 0.14], [392, 0.16, 0.14], [392, 0.32, 0.14], [523.25, 0.48, 0.9], [659.25, 0.48, 0.9], [783.99, 0.48, 0.9],
  ];
  const fanfare = synth(ctx, 1.5, (t) => fanfareNotes.reduce((a, [f, at, len]) => a + brass(f, t - at, len), 0) * 0.07);
  const denied = synth(ctx, 0.25, (t) => (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 233 * t)) * 0.18 * env(t, 0.005, 0.1));

  // Footsteps: leather soles indoors. A soft heel tap with a dull low-mid body
  // (no ringing partials), a little scuff, then a quieter toe/sole landing.
  // Several variants of each so consecutive steps never sound identical.
  const biquad = (type: 'lp' | 'hp' | 'bp', f: number, q = 0.707) => {
    const w = (2 * Math.PI * f) / ctx.sampleRate,
      al = Math.sin(w) / (2 * q),
      cw = Math.cos(w);
    const [b0, b1, b2] = type === 'lp' ? [(1 - cw) / 2, 1 - cw, (1 - cw) / 2] : type === 'hp' ? [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2] : [al, 0, -al];
    const a0 = 1 + al,
      a1 = -2 * cw,
      a2 = 1 - al;
    let x1 = 0,
      x2 = 0,
      y1 = 0,
      y2 = 0;
    return (x: number) => {
      const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      return y;
    };
  };
  const jit = (k: number) => 1 + rand() * k;
  const step = (surface: 'marble' | 'carpet' | 'stone') => {
    if (surface === 'carpet') {
      const body = biquad('lp', 320 * jit(0.15), 0.8),
        body2 = biquad('lp', 300),
        fibre = biquad('bp', 900 * jit(0.2), 0.7);
      const thump = 85 * jit(0.1),
        toe = 0.06 * jit(0.15);
      return synth(ctx, 0.2, (t) => {
        const e = env(t, 0.006, 0.026) + (t > toe ? 0.4 * env(t - toe, 0.005, 0.022) : 0);
        return body2(body(rand())) * 2.2 * e + Math.sin(2 * Math.PI * thump * t) * 0.1 * env(t, 0.004, 0.03) + fibre(rand()) * 0.05 * env(t, 0.015, 0.04);
      });
    }
    const stone = surface === 'stone';
    const lo = stone ? 420 : 520;
    const body = biquad('lp', lo * jit(0.12), 0.9),
      bodyHp = biquad('hp', 140),
      tap = biquad('bp', (stone ? 1300 : 1700) * jit(0.15), 0.9),
      scuff = biquad('bp', 1100 * jit(0.2), 0.6),
      grit = biquad('bp', 2200 * jit(0.2), 1.2);
    const thock = (stone ? 170 : 230) * jit(0.12),
      toe = 0.045 + Math.abs(rand()) * 0.02,
      toeLevel = 0.35 + Math.abs(rand()) * 0.15;
    // Sparse sand grains under the sole on the outdoor deck.
    const grains = stone ? Array.from({ length: 9 }, () => ({ at: Math.abs(rand()) * 0.07, g: 0.15 + Math.abs(rand()) * 0.25 })) : [];
    return synth(ctx, 0.2, (t) => {
      const strike = (u: number) => (u < 0 ? 0 : env(u, 0.0015, 0.012));
      const e = strike(t) + toeLevel * strike(t - toe);
      let v = bodyHp(body(rand())) * 2.2 * e;
      v += Math.sin(2 * Math.PI * thock * t) * 0.16 * (t < 0 ? 0 : env(t, 0.0015, 0.018));
      v += tap(rand()) * 0.22 * (env(t, 0.0004, 0.0035) + toeLevel * (t > toe ? env(t - toe, 0.0004, 0.003) : 0));
      v += scuff(rand()) * 0.035 * (t > 0.01 && t < 0.09 ? Math.sin((Math.PI * (t - 0.01)) / 0.08) : 0);
      let gr = 0;
      for (const g of grains) if (t > g.at && t - g.at < 0.004) gr += g.g;
      if (stone) v += grit(rand()) * (0.05 * env(t, 0.004, 0.04) + gr * 0.2);
      return v * 0.85;
    });
  };
  const stepVariants = {
    stepMarble: Array.from({ length: 4 }, () => step('marble')),
    stepCarpet: Array.from({ length: 4 }, () => step('carpet')),
    stepStone: Array.from({ length: 4 }, () => step('stone')),
  };
  const [stepMarble, stepCarpet, stepStone] = [stepVariants.stepMarble[0], stepVariants.stepCarpet[0], stepVariants.stepStone[0]];

  // A table erupting: shaped crowd noise with a few rising whoops.
  const cheer = (() => {
    const l = [lp(0.08), lp(0.08)],
      b = [hp(0.9), hp(0.9)];
    const whoops = Array.from({ length: 7 }, () => ({ at: Math.abs(rand()) * 0.8, f: 300 + Math.abs(rand()) * 300, g: 0.05 + Math.abs(rand()) * 0.05 }));
    return synth(
      ctx,
      2.4,
      (t) => {
        const crowd = b[0](l[0](rand())) * 3.2 * env(t, 0.08, 0.7) * (0.8 + 0.2 * Math.sin(t * 23));
        let w = 0;
        for (const k of whoops) {
          const u = t - k.at;
          if (u > 0 && u < 0.6) w += Math.sin(2 * Math.PI * (k.f + u * 500) * u) * k.g * env(u, 0.03, 0.2);
        }
        return crowd + w;
      },
    );
  })();
  const gasp = (() => {
    const l = lp(0.1),
      b = hp(0.85);
    return synth(ctx, 0.9, (t) => b(l(rand())) * 2.5 * env(t, 0.06, 0.25));
  })();
  // Elevator arrival chime (two soft bell tones) and the low hum of a moving car.
  const chime = (t: number, f: number) => (Math.sin(2 * Math.PI * f * t) * 0.5 + Math.sin(2 * Math.PI * f * 2.76 * t) * 0.12) * Math.exp(-t * 3.2) * Math.min(1, t * 400);
  const ding = synth(ctx, 1.6, (t) => 0.35 * (chime(t, 1318.5) + (t > 0.32 ? chime(t - 0.32, 1046.5) : 0)));
  // Water: a big splash (body entering), a stroke (moving through water), and a landing thud.
  const splash = (() => {
    const f = lp(0.35),
      f2 = hp(0.97);
    return synth(ctx, 1.3, (t) => {
      const body = f(rand() * 2 - 1) * Math.exp(-t * 5) * 1.4;
      const fizz = f2(rand() * 2 - 1) * Math.exp(-t * 2.2) * (0.35 + 0.25 * Math.sin(t * 60)) * Math.min(1, t * 20);
      const plop = Math.sin(2 * Math.PI * (90 - 40 * t) * t) * Math.exp(-t * 14) * 0.6;
      return (body + fizz + plop) * 0.8;
    });
  })();
  const swim = (() => {
    const f = lp(0.12);
    return synth(ctx, 0.6, (t) => f(rand() * 2 - 1) * Math.sin(Math.PI * Math.min(1, t / 0.6)) * 1.6);
  })();
  const land = (() => {
    const f = lp(0.08);
    return synth(ctx, 0.35, (t) => (f(rand() * 2 - 1) * 2.2 + Math.sin(2 * Math.PI * 70 * t) * 0.5) * Math.exp(-t * 18));
  })();
  const liftHum = synth(ctx, 2.0, (t) => 0.25 * (Math.sin(2 * Math.PI * 55 * t) * 0.6 + Math.sin(2 * Math.PI * 110 * t) * 0.25 + rand() * 0.08) * Math.min(1, t * 3, (2.0 - t) * 3));
  const clink = synth(ctx, 0.8, (t) => (Math.sin(2 * Math.PI * 3520 * t) * 0.3 + Math.sin(2 * Math.PI * 5270 * t) * 0.15 + Math.sin(2 * Math.PI * 2210 * t) * 0.1) * env(t, 0.0008, 0.18));
  // A glass breaking: a sharp crack, then a spray of tinkling shards.
  const shatter = (() => {
    const h = hp(0.6);
    const tinkles = Array.from({ length: 26 }, () => ({ t0: 0.02 + Math.random() * 0.5, f: 2400 + Math.random() * 5200, a: 0.05 + Math.random() * 0.12, d: 0.03 + Math.random() * 0.08 }));
    return synth(ctx, 1.0, (t) => {
      let v = h(rand()) * 1.4 * env(t, 0.001, 0.06);
      for (const k of tinkles) if (t > k.t0) v += Math.sin(2 * Math.PI * k.f * (t - k.t0)) * k.a * env(t - k.t0, 0.0005, k.d);
      return v;
    });
  })();
  // Boxing: a punch that lands (a meaty low thump with a slap on top) and one that's blocked (dull, muffled).
  const punch = (() => {
    const b = hp(0.35);
    return synth(ctx, 0.35, (t) => Math.sin(2 * Math.PI * (95 - t * 120) * t) * 0.9 * env(t, 0.001, 0.07) + b(rand()) * 0.55 * env(t, 0.0005, 0.018));
  })();
  const block = (() => {
    const l = lp(0.08);
    return synth(ctx, 0.25, (t) => Math.sin(2 * Math.PI * 140 * t) * 0.5 * env(t, 0.001, 0.035) + l(rand()) * 1.2 * env(t, 0.001, 0.03));
  })();
  // A slap: a crisp, bright clap (skin on skin), no low thump.
  const slap = (() => {
    const b = hp(0.55),
      b2 = hp(0.8);
    return synth(ctx, 0.22, (t) => b(rand()) * 1.1 * env(t, 0.0003, 0.012) + b2(rand()) * 0.45 * env(t, 0.0004, 0.035) + Math.sin(2 * Math.PI * 1150 * t) * 0.12 * env(t, 0.0005, 0.02));
  })();
  // A punch that misses: air going past.
  const whoosh = (() => {
    const l = lp(0.25),
      b = hp(0.6);
    return synth(ctx, 0.3, (t) => b(l(rand())) * 2.4 * Math.sin(Math.PI * Math.min(1, t / 0.3)) ** 2);
  })();
  // A glass landing without breaking: a dull knock with a little ring.
  const thunk = synth(ctx, 0.35, (t) => Math.sin(2 * Math.PI * 180 * t) * 0.5 * env(t, 0.001, 0.04) + Math.sin(2 * Math.PI * 2900 * t) * 0.08 * env(t, 0.001, 0.09));
  const pour = (() => {
    const l = lp(0.12);
    return synth(ctx, 1.6, (t) => {
      const gl = 0.6 + 0.4 * Math.sin(2 * Math.PI * (9 + t * 4) * t);
      return l(rand()) * 1.6 * gl * env(t, 0.1, 0.9) * (t < 1.3 ? 1 : (1.6 - t) / 0.3);
    });
  })();
  // A bite of something crisp (pizza crust, a burger's bun): a few quick crackles, then a chew.
  const crunch = (() => {
    const h = hp(0.55),
      l = lp(0.5);
    const cracks = [0, 0.045, 0.1, 0.16, 0.3, 0.42];
    return synth(ctx, 0.6, (t) => {
      let k = 0;
      for (const c of cracks) if (t >= c) k += env(t - c, 0.002, c < 0.2 ? 0.025 : 0.04) * (c < 0.2 ? 1 : 0.45);
      return h(l(rand())) * 1.5 * k;
    });
  })();
  // A soft mouthful (gelato, noodles): muffled, wet chews.
  const munch = (() => {
    const l = lp(0.08);
    return synth(ctx, 0.55, (t) => {
      const chew = Math.max(0, Math.sin(2 * Math.PI * 4.2 * t)) ** 2;
      return l(rand()) * 3.2 * chew * env(t, 0.02, 0.3);
    });
  })();
  const sip = (() => {
    const l = lp(0.2);
    return synth(ctx, 0.5, (t) => l(rand()) * 0.8 * env(t, 0.05, 0.12) + Math.sin(2 * Math.PI * (300 - t * 200) * t) * 0.05 * env(t, 0.1, 0.08));
  })();
  const door = (() => {
    const l = lp(0.02);
    return synth(ctx, 0.9, (t) => l(rand()) * 3 * env(t, 0.15, 0.3) + Math.sin(2 * Math.PI * 55 * t) * 0.2 * env(t > 0.6 ? t - 0.6 : 0, 0.002, 0.08) * (t > 0.6 ? 1 : 0));
  })();
  const shaker = (() => {
    const h = hp(0.7);
    return synth(ctx, 1.4, (t) => h(rand()) * 0.5 * Math.abs(Math.sin(2 * Math.PI * 4.5 * t)) ** 3 * (t < 1.2 ? 1 : (1.4 - t) / 0.2));
  })();
  // Lake water and fountains: a broad stereo wash.
  const water = (() => {
    const sr = ctx.sampleRate,
      len = 6 * sr;
    const buf = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      const l = lp(0.25),
        h = hp(0.6);
      for (let i = 0; i < len; i++) d[i] = h(l(rand())) * 1.4 * (0.75 + 0.25 * Math.sin((i / sr) * 0.9 + c * 2));
      const fade = Math.floor(sr * 0.4);
      for (let i = 0; i < fade; i++) {
        const a = i / fade;
        d[i] = d[i] * a + d[len - fade + i] * (1 - a);
      }
    }
    return buf;
  })();

  return {
    chip, chips, click, ballRoll, ballDrop, reelTick, reelStop, winSmall, winBig, bonus, lever, denied,
    stepMarble, stepCarpet, stepStone, cheer, gasp, clink, shatter, thunk, punch, block, slap, whoosh, pour, sip, door, water, shaker, banjo, gulp, tension, fanfare,
    ding, liftHum, splash, swim, land, crunch, munch,
    variants: stepVariants,
  };
}

/** Mix levels of the room-tone layers (their loops are normalised: walla ~-23 dBFS, floor ~-26 dBFS). */
const AMB_WALLA = 0.135;
const AMB_FLOOR = 0.115;

/** The recorded room under the procedural floor (floor_loop.mp3), mixed low. */
const AMB_ROOM = 0.06;

const pick = (b: Buffers, name: Exclude<SoundName, SampleName>) => {
  const v = b.variants[name];
  return v ? v[Math.floor(Math.random() * v.length)] : b[name];
};

/** A loop's seam smoothed: its last `fade` seconds crossfaded into its start (the loop gets that much shorter). */
function smoothSeam(buf: AudioBuffer, fade = 0.08): AudioBuffer {
  const sr = buf.sampleRate,
    f = Math.round(fade * sr),
    n = buf.length - f;
  const out = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: n, sampleRate: sr });
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c),
      dst = out.getChannelData(c);
    dst.set(src.subarray(0, n));
    for (let i = 0; i < f; i++) {
      const k = i / f;
      dst[i] = src[i] * Math.sin((k * Math.PI) / 2) + src[n + i] * Math.cos((k * Math.PI) / 2);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The casino floor's music: casino_lounge.mp3, lounge house at 116 bpm.
// ---------------------------------------------------------------------------

/** The lounge track as measured. */
export const LOUNGE = TRACKS.casino_lounge;
/** Bars of it that are music (it rings out into silence after its 56th bar): the loop. */
export const LOUNGE_BARS = (() => {
  const lv = LOUNGE.perBar.map((p) => p.level);
  const loud = Math.max(...lv);
  let n = lv.length;
  while (n > 1 && lv[n - 1] < loud - 30) n--;
  return n;
})();
/** What the lounge track is doing bar by bar (the guests dance to it). */
export const LOUNGE_SET: Arrangement = arrangement(LOUNGE.bpm, detectSections(LOUNGE.perBar.slice(0, LOUNGE_BARS), true));
/** Decoded and kept at this rate (stereo): ~30 MB for the 116 s loop instead of ~45 MB at 48 kHz. */
const MUSIC_RATE = 32000;

/**
 * The lounge track as a seamless loop: from its first beat, `LOUNGE_BARS` long,
 * with its ring-out folded back onto the start and its pickup onto the end.
 */
async function loadLounge(): Promise<AudioBuffer> {
  const src = await decodeAudio('casino_lounge', MUSIC_RATE);
  const sr = src.sampleRate;
  const n = Math.round(((LOUNGE_BARS * 4 * 60) / LOUNGE.bpm) * sr);
  const s0 = Math.round(LOUNGE.firstBeat * sr);
  const out = new AudioBuffer({ numberOfChannels: src.numberOfChannels, length: n, sampleRate: sr });
  for (let c = 0; c < src.numberOfChannels; c++) {
    const d = src.getChannelData(c),
      o = out.getChannelData(c);
    o.set(d.subarray(s0, s0 + n));
    // The tail past the loop (up to 4 s of ring-out) onto the start, faded out so nothing is cut.
    const tail = Math.min(d.length - s0 - n, 4 * sr);
    for (let i = 0; i < tail; i++) o[i % n] += d[s0 + n + i] * (1 - i / tail);
    for (let i = 0; i < s0; i++) o[n - s0 + i] += d[i];
  }
  return out;
}


export class Sound {
  readonly listener = new THREE.AudioListener();
  private buffers: Buffers | null = null;
  private pool: THREE.PositionalAudio[] = [];
  muted = false;

  constructor(
    private scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    camera.add(this.listener);
    const unlock = () => {
      const ctx = this.listener.context;
      if (ctx.state !== 'running') ctx.resume();
      this.ensure();
      this.startAmbience();
      this.flushAmbient();
      this.startMusic();
      this.loadSamples();
    };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
  }

  private ensure() {
    if (!this.buffers) this.buffers = buildBuffers(this.listener.context);
    return this.buffers;
  }

  /** The recorded effects, once loaded (until then, and if they fail, their synthesized stand-ins play). */
  private samples: Partial<Record<SampleName, AudioBuffer>> = {};
  private samplesAsked = false;

  private loadSamples() {
    if (this.samplesAsked) return;
    this.samplesAsked = true;
    for (const name of Object.keys(SAMPLES) as SampleName[]) {
      decodeAudio(SAMPLE_FILES[name], this.listener.context.sampleRate).then(
        (b) => (this.samples[name] = b),
        (e) => console.warn('Sound: no recording for', name, e),
      );
    }
  }

  /** The buffer a sound plays (a recording if it's in, else synthesized). */
  private bufferOf(name: SoundName): AudioBuffer {
    if (name in SAMPLES) {
      const s = name as SampleName;
      return this.samples[s] ?? pick(this.ensure(), SAMPLES[s]);
    }
    return pick(this.ensure(), name as Exclude<SoundName, SampleName>);
  }

  /** Whether a recorded effect is loaded (else its stand-in plays). */
  hasRecording(name: SampleName): boolean {
    return !!this.samples[name];
  }

  // Room tone: two seamless loops (see ambience.ts). The slot floor + air
  // arrives first; the crowd walla (built from recorded voice clips) fades in
  // once its clips are fetched and mixed. If they fail, the floor plays alone.
  private ambLayers: { audio: THREE.Audio; base: number; curve: number }[] = [];
  private ambStarted = false;
  private ambLevel = 1;

  private startAmbience() {
    if (this.ambStarted) return;
    this.ambStarted = true;
    const add = (buf: AudioBuffer | null, base: number, curve: number) => {
      if (!buf) return;
      const a = new THREE.Audio(this.listener);
      a.setBuffer(buf);
      a.setLoop(true);
      // Fade in through a gain stage of our own, so the per-frame level updates don't cut it short.
      const ctx = this.listener.context;
      const fade = ctx.createGain();
      fade.gain.setValueAtTime(0, ctx.currentTime);
      fade.gain.linearRampToValueAtTime(1, ctx.currentTime + 4);
      a.setFilter(fade);
      const layer = { audio: a, base, curve };
      this.ambLayers.push(layer);
      a.setVolume(base * this.ambLevel ** curve);
      // Start each loop somewhere random so sessions don't all open the same way.
      a.offset = Math.random() * buf.duration * 0.9;
      a.play();
    };
    // Slots thin out faster than the crowd as you step outside (curve > 1).
    renderFloor().then((b) => add(b, AMB_FLOOR, 1.6), () => {});
    buildWalla().then((b) => add(b, AMB_WALLA, 1), () => {});
    // A recorded room under it, low: real air and distance the synthesized floor doesn't have.
    decodeAudio('floor_loop', AMBIENCE_RATE).then((b) => add(smoothSeam(b), AMB_ROOM, 1.6), () => {});
  }

  /** Room tone level (quieter out on the terrace). */
  setAmbience(level: number) {
    this.ambLevel = Math.max(0, Math.min(1, level));
    for (const l of this.ambLayers) l.audio.setVolume(l.base * this.ambLevel ** l.curve);
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.listener.setMasterVolume(m ? 0 : 1);
  }

  /** Plays a one-shot at a world position (or attached to an object). */
  play(name: SoundName, at?: THREE.Vector3 | THREE.Object3D, opts: { volume?: number; rate?: number; ref?: number; rolloff?: number } = {}) {
    if (this.listener.context.state !== 'running') return null;
    let a = this.pool.find((p) => !p.isPlaying);
    if (!a) {
      if (this.pool.length >= 24) return null;
      a = new THREE.PositionalAudio(this.listener);
      this.pool.push(a);
    }
    // A crowd far across the deck carries (ref/rolloff); a chip clack doesn't.
    a.setRefDistance(opts.ref ?? 1.2);
    a.setRolloffFactor(opts.rolloff ?? 1.4);
    a.removeFromParent();
    if (at instanceof THREE.Object3D) {
      a.position.set(0, 0, 0);
      at.add(a);
    } else {
      a.position.copy(at ?? new THREE.Vector3());
      this.scene.add(a);
    }
    a.setBuffer(this.bufferOf(name));
    a.setLoop(false);
    a.setVolume(opts.volume ?? 1);
    a.setPlaybackRate(opts.rate ?? 1);
    a.play();
    return a;
  }

  private local: THREE.Audio[] = [];

  /** A one-shot that is not placed in the world (your own footsteps). */
  playLocal(name: SoundName, volume = 1, rate = 1) {
    if (this.listener.context.state !== 'running') return;
    let a = this.local.find((p) => !p.isPlaying);
    if (!a) {
      if (this.local.length >= 6) return;
      a = new THREE.Audio(this.listener);
      this.local.push(a);
    }
    a.setBuffer(this.bufferOf(name));
    a.setVolume(volume);
    a.setPlaybackRate(rate);
    a.play();
  }

  /** A looping sound fixed in the world (piano, fountains). Starts once audio is unlocked. */
  ambientAt(name: SoundName | (() => Promise<AudioBuffer>), at: THREE.Object3D, opts: { volume?: number; ref?: number; rolloff?: number } = {}) {
    const a = new THREE.PositionalAudio(this.listener);
    a.setRefDistance(opts.ref ?? 2);
    a.setRolloffFactor(opts.rolloff ?? 1.2);
    a.setDistanceModel('inverse');
    at.add(a);
    const start = async () => {
      const buf = typeof name === 'function' ? await name() : this.bufferOf(name);
      a.setBuffer(buf);
      a.setLoop(true);
      a.setVolume(opts.volume ?? 1);
      a.play();
    };
    this.pendingAmbient.push(start);
    if (this.listener.context.state === 'running') this.flushAmbient();
    return a;
  }

  private pendingAmbient: (() => Promise<void>)[] = [];
  private flushAmbient() {
    const list = this.pendingAmbient;
    this.pendingAmbient = [];
    for (const f of list) f().catch(() => {});
  }

  /** Renders a looping lounge-piano progression offline (async, off the frame loop). */
  pianoLoop(): Promise<AudioBuffer> {
    return renderPiano(this.listener.context.sampleRate);
  }

  /**
   * A spoken line (croupier calls, the crew's banter). Uses the browser's own
   * speech voices; each speaker gets a distinct voice, pitch and pace.
   */
  say(text: string, opts: { pitch?: number; rate?: number; voice?: number; interrupt?: boolean; volume?: number } = {}) {
    if (this.muted) return;
    try {
      const synthApi = globalThis.speechSynthesis;
      if (!synthApi) return;
      if (opts.interrupt) synthApi.cancel();
      // Don't let a backlog build up: drop lines if two are already waiting.
      if (synthApi.pending && !opts.interrupt) return;
      const u = new SpeechSynthesisUtterance(text);
      const voices = synthApi.getVoices().filter((v) => /^en/i.test(v.lang));
      if (voices.length) u.voice = voices[(opts.voice ?? 0) % voices.length];
      u.rate = opts.rate ?? 1;
      u.pitch = opts.pitch ?? 1;
      u.volume = Math.max(0, Math.min(1, opts.volume ?? 1));
      synthApi.speak(u);
    } catch {
      /* no speech on this device */
    }
  }

  private music: THREE.Audio | null = null;
  private musicLevel = 0.2;
  musicOn = true;
  /** What the casino music is doing bar by bar (the lounge track's, or the synthesized groove's if it failed). */
  musicArr: Arrangement = LOUNGE_SET;
  /** performance.now() when the casino music started (the party's tracks load after it), or -1. */
  musicReadyAt = -1;
  /** Which casino music is playing: the recording, or the synthesized fallback. */
  musicSource: 'track' | 'synth' | null = null;
  private musicLoad: Promise<AudioBuffer> | null = null;

  /** Fetches and decodes the casino track ahead of time (after the loading screen: it doesn't need audio unlocked). */
  preloadMusic() {
    if (!this.musicLoad) {
      this.musicLoad = loadLounge();
      this.musicLoad.catch(() => {});
    }
    return this.musicLoad;
  }

  /** Starts the casino-floor music once audio is unlocked (the synthesized groove if the track can't be had). */
  startMusic() {
    if (this.music) return;
    const m = new THREE.Audio(this.listener);
    this.music = m;
    const sr = this.listener.context.sampleRate;
    this.preloadMusic()
      .then(
        (buf) => ({ buf, arr: LOUNGE_SET, source: 'track' as const }),
        async (e) => {
          console.warn('Casino music: falling back to the synthesized groove', e);
          return { buf: await renderGroove(sr), arr: GROOVE_SET, source: 'synth' as const };
        },
      )
      .then(({ buf, arr, source }) => {
        this.musicArr = arr;
        this.musicSource = source;
        m.setBuffer(buf);
        m.setLoop(true);
        m.setVolume(this.musicOn ? this.musicLevel : 0);
        m.play();
        this.musicAt = this.listener.context.currentTime;
        this.musicReadyAt = performance.now();
      });
  }

  private musicAt = -1;
  /** Seconds into the casino music's loop from its first beat (for dancing to it), or null before it plays. */
  musicTime(): number | null {
    if (this.musicAt < 0 || !this.music?.isPlaying) return null;
    const ctx = this.listener.context;
    return ctx.currentTime - this.musicAt - (ctx.outputLatency || ctx.baseLatency || 0);
  }

  /** Mixes the music for where you are (quieter by the piano and outside). */
  setMusicLevel(level: number) {
    this.musicLevel = level;
    if (this.music && this.music.buffer) this.music.setVolume(this.musicOn ? level : 0);
  }

  toggleMusic(): boolean {
    this.musicOn = !this.musicOn;
    if (this.music && this.music.buffer) this.music.setVolume(this.musicOn ? this.musicLevel : 0);
    return this.musicOn;
  }

  /** A looping positional sound whose volume/rate the caller drives (ball roll, reel spin). */
  loop(name: SoundName, at: THREE.Object3D): { set(volume: number, rate?: number): void; stop(): void } {
    const a = new THREE.PositionalAudio(this.listener);
    a.setRefDistance(1.2);
    at.add(a);
    let started = false;
    return {
      set: (volume, rate = 1) => {
        if (this.listener.context.state !== 'running') return;
        if (!started) {
          a.setBuffer(this.bufferOf(name));
          a.setLoop(true);
          a.play();
          started = true;
        }
        a.setVolume(volume);
        a.setPlaybackRate(rate);
      },
      stop: () => {
        if (started && a.isPlaying) a.stop();
        started = false;
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Lounge piano: an 8-bar progression in F, voiced like a hotel-bar pianist.
// ---------------------------------------------------------------------------

const NOTE = (n: string) => {
  const m = /^([A-G])(b|#)?(\d)$/.exec(n)!;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as 'C'];
  const semis = base + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0) + (Number(m[3]) + 1) * 12;
  return 440 * 2 ** ((semis - 69) / 12);
};

async function renderPiano(sampleRate: number): Promise<AudioBuffer> {
  const bpm = 76;
  const beat = 60 / bpm;
  const bars: { bass: string; chord: string[]; scale: string[] }[] = [
    { bass: 'F2', chord: ['A3', 'C4', 'E4', 'G4'], scale: ['A4', 'C5', 'E5', 'G5', 'F5'] },
    { bass: 'D2', chord: ['F3', 'A3', 'C4', 'E4'], scale: ['F4', 'A4', 'C5', 'E5', 'D5'] },
    { bass: 'G2', chord: ['Bb3', 'D4', 'F4', 'A4'], scale: ['Bb4', 'D5', 'F5', 'A4', 'G4'] },
    { bass: 'C2', chord: ['Bb3', 'E4', 'A4', 'D5'], scale: ['E5', 'D5', 'A4', 'Bb4', 'G4'] },
    { bass: 'A2', chord: ['G3', 'C4', 'E4', 'G4'], scale: ['C5', 'E5', 'G5', 'E5', 'A4'] },
    { bass: 'D2', chord: ['F#3', 'C4', 'Eb4', 'A4'], scale: ['F#4', 'A4', 'C5', 'Eb5', 'D5'] },
    { bass: 'G2', chord: ['F3', 'Bb3', 'D4', 'A4'], scale: ['D5', 'F5', 'A5', 'G5', 'Bb4'] },
    { bass: 'C2', chord: ['E3', 'Bb3', 'D4', 'G4'], scale: ['G4', 'Bb4', 'D5', 'E5', 'C5'] },
  ];
  const loopLen = bars.length * 4 * beat;
  const tail = 3;
  const ctx = new OfflineAudioContext(2, Math.ceil((loopLen + tail) * sampleRate), sampleRate);
  const harmonics = new Float32Array([0, 1, 0.55, 0.32, 0.2, 0.12, 0.08, 0.05, 0.03]);
  const wave = ctx.createPeriodicWave(harmonics, new Float32Array(harmonics.length));
  const master = ctx.createGain();
  master.gain.value = 0.16;
  const verb = ctx.createDelay(1);
  verb.delayTime.value = 0.23;
  const fb = ctx.createGain();
  fb.gain.value = 0.28;
  const wet = ctx.createGain();
  wet.gain.value = 0.35;
  master.connect(ctx.destination);
  master.connect(verb);
  verb.connect(fb);
  fb.connect(verb);
  verb.connect(wet);
  wet.connect(ctx.destination);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const play = (note: string, at: number, vel: number, len: number, pan: number) => {
    const f = NOTE(note);
    const o = ctx.createOscillator();
    o.setPeriodicWave(wave);
    o.frequency.value = f;
    o.detune.value = (rnd() - 0.5) * 6;
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.setValueAtTime(Math.min(9000, f * 9), at);
    lpf.frequency.exponentialRampToValueAtTime(Math.max(300, f * 2), at + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vel, at + 0.006);
    g.gain.exponentialRampToValueAtTime(vel * 0.35, at + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0005, at + len);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(lpf).connect(g).connect(p).connect(master);
    o.start(at);
    o.stop(at + len + 0.05);
  };
  const swing = (eighth: number) => (eighth % 2 ? beat * 0.62 : 0);
  bars.forEach((bar, i) => {
    const t0 = i * 4 * beat;
    play(bar.bass, t0, 0.9, 3.2, -0.3);
    play(bar.bass.replace(/\d/, (d) => String(Number(d) + 1)), t0 + 2 * beat, 0.45, 1.8, -0.3);
    bar.chord.forEach((n, k) => {
      play(n, t0 + beat * 1 + swing(1) + k * 0.012, 0.32, 1.6, -0.05);
      play(n, t0 + beat * 2.5 + k * 0.01, 0.26, 1.4, -0.05);
    });
    // Right hand: a lazy swung line through the chord's colour tones.
    for (let e = 0; e < 8; e++) {
      if (rnd() < 0.28) continue;
      const n = bar.scale[Math.floor(rnd() * bar.scale.length)];
      const at = t0 + Math.floor(e / 2) * beat + swing(e) + (rnd() - 0.5) * 0.015;
      play(n, at, 0.3 + rnd() * 0.25, 1.2 + rnd() * 0.8, 0.25);
    }
  });
  const rendered = await ctx.startRendering();
  // Fold the tail back onto the start so the loop is seamless.
  const n = Math.ceil(loopLen * sampleRate);
  const out = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate });
  for (let c = 0; c < 2; c++) {
    const src = rendered.getChannelData(c);
    const dst = out.getChannelData(c);
    dst.set(src.subarray(0, n));
    for (let i = n; i < src.length; i++) dst[i - n] += src[i];
  }
  return out;
}

// ---------------------------------------------------------------------------
// The fallback casino-floor groove (if casino_lounge.mp3 can't be fetched):
// 8 bars of lounge house in A minor at 116 bpm, synthesized.
// ---------------------------------------------------------------------------

export const GROOVE = { bpm: 116, bars: 8 };
const GROOVE_SET = plainArrangement(GROOVE.bpm, GROOVE.bars);

async function renderGroove(sampleRate: number): Promise<AudioBuffer> {
  const bpm = GROOVE.bpm;
  const beat = 60 / bpm;
  const bars = GROOVE.bars;
  const loopLen = bars * 4 * beat;
  const ctx = new OfflineAudioContext(2, Math.ceil((loopLen + 1.5) * sampleRate), sampleRate);
  const out = ctx.createGain();
  out.gain.value = 0.55;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 4;
  out.connect(comp).connect(ctx.destination);
  // A short stereo echo for space.
  const echo = ctx.createDelay(1);
  echo.delayTime.value = beat * 0.75;
  const fb = ctx.createGain();
  fb.gain.value = 0.25;
  const wet = ctx.createGain();
  wet.gain.value = 0.22;
  echo.connect(fb).connect(echo);
  echo.connect(wet).connect(comp);

  const noise = ctx.createBuffer(1, sampleRate, sampleRate);
  const nd = noise.getChannelData(0);
  let seed = 7;
  for (let i = 0; i < nd.length; i++) nd[i] = ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const hit = (at: number, f: number, q: number, type: BiquadFilterType, len: number, vol: number, pan = 0) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = f;
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0008, at + len);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    s.connect(flt).connect(g).connect(p).connect(out);
    s.start(at, Math.random() * 0.5, len + 0.05);
  };
  const kick = (at: number) => {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, at);
    o.frequency.exponentialRampToValueAtTime(42, at + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(1.0, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.32);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + 0.35);
  };
  const tone = (at: number, f: number, len: number, vol: number, type: OscillatorType, cutoff: number, pan = 0, send = false) => {
    for (const det of type === 'sawtooth' ? [-7, 7] : [0]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.setValueAtTime(cutoff, at);
      flt.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * 0.35), at + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(vol, at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0008, at + len);
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      o.connect(flt).connect(g).connect(p).connect(out);
      if (send) p.connect(echo);
      o.start(at);
      o.stop(at + len + 0.05);
    }
  };
  const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
  // Am  F  C  G, two bars each.
  const prog = [
    { root: 45, chord: [57, 60, 64] },
    { root: 41, chord: [57, 60, 65] },
    { root: 48, chord: [55, 60, 64] },
    { root: 43, chord: [55, 59, 62] },
  ];
  const hook = [76, 74, 72, 74, 76, 79, 76, 74];
  for (let bar = 0; bar < bars; bar++) {
    const t0 = bar * 4 * beat;
    const c = prog[Math.floor(bar / 2) % prog.length];
    for (let b = 0; b < 4; b++) {
      const t = t0 + b * beat;
      kick(t);
      hit(t + beat / 2, 9000, 0.7, 'highpass', 0.05, 0.16, 0.3);
      if (b % 2 === 1) hit(t, 1600, 1.2, 'bandpass', 0.18, 0.55, -0.1);
      hit(t + beat * 0.75, 11000, 0.7, 'highpass', 0.03, 0.07, -0.3);
    }
    // Syncopated bass.
    for (const [off, oct] of [[0, 0], [0.75, 0], [1.5, 12], [2.5, 0], [3.25, 0], [3.5, 12]] as const) {
      tone(t0 + off * beat, hz(c.root + oct - 12), beat * 0.45, 0.42, 'sawtooth', 700);
    }
    // Off-beat chord stabs.
    for (const off of [0.5, 1.5, 2.5, 3.0, 3.5]) {
      for (const n of c.chord) tone(t0 + off * beat, hz(n), beat * 0.3, 0.06, 'sawtooth', 2600, (n % 3) * 0.2 - 0.2, true);
    }
    // A bell hook on the second half.
    if (bar >= 4) hook.forEach((n, k) => tone(t0 + k * beat * 0.5, hz(n), beat * 0.6, 0.05, 'triangle', 6000, 0.25, true));
  }
  const rendered = await ctx.startRendering();
  const n = Math.ceil(loopLen * sampleRate);
  const buf = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate });
  for (let ch = 0; ch < 2; ch++) {
    const src = rendered.getChannelData(ch);
    const dst = buf.getChannelData(ch);
    dst.set(src.subarray(0, n));
    for (let i = n; i < src.length; i++) dst[i - n] += src[i];
  }
  return buf;
}
