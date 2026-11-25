/**
 * Casino room tone, built once at runtime (async, off the frame loop) as two
 * long seamless stereo loops:
 *
 *  - the floor: distant slot machines (soft, overlapping pentatonic jingles on
 *    bell / marimba-like FM tones, all in C so they agree with each other and
 *    with the music), the odd coin clatter, a big carpeted-room reverb, and a
 *    very soft HVAC air bed so the room never goes dead silent;
 *  - the walla: a crowd murmur mixed from a few dozen of the game's recorded
 *    voice clips (many voices, random times, pans and distances, low-passed
 *    and drowned in reverb so no word is intelligible).
 *
 * Both are rendered at a low sample rate (24 kHz: everything is far away and
 * low-passed anyway) to halve the memory of the loops; playback resamples.
 * Event tails past the loop end are folded back onto the start, so the wrap
 * point is seamless.
 */

export const AMBIENCE_RATE = 24000;

/** Small seeded PRNG (mulberry32), 0..1. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A synthetic room impulse: decorrelated stereo noise with an exponential, darkening decay. */
function roomImpulse(ctx: BaseAudioContext, rt60: number, predelay: number, rnd: () => number) {
  const sr = ctx.sampleRate;
  const len = Math.ceil((rt60 + predelay) * sr);
  const ir = ctx.createBuffer(2, len, sr);
  const tau = rt60 / 6.91;
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let y = 0,
      energy = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr - predelay;
      if (t < 0) continue;
      // Air and carpet absorb highs first: the low-pass closes as the tail decays.
      const a = 0.08 + 0.55 * Math.exp(-t / 0.25);
      y += a * (rnd() * 2 - 1 - y);
      const v = y * Math.exp(-t / tau) * Math.min(1, t / 0.012);
      d[i] = v;
      energy += v * v;
    }
    const k = 1 / Math.sqrt(energy || 1);
    for (let i = 0; i < len; i++) d[i] *= k;
  }
  return ir;
}

/** Folds a rendered buffer's tail (past `loopLen`) back onto its start and returns plain arrays. */
function foldLoop(rendered: AudioBuffer, loopSamples: number): Float32Array[] {
  const out: Float32Array[] = [];
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    const src = rendered.getChannelData(c);
    const dst = new Float32Array(loopSamples);
    dst.set(src.subarray(0, loopSamples));
    for (let i = loopSamples; i < src.length; i++) dst[(i - loopSamples) % loopSamples] += src[i];
    out.push(dst);
  }
  return out;
}

function rms(chs: Float32Array[]) {
  let s = 0,
    n = 0;
  for (const d of chs) for (let i = 0; i < d.length; i++) (s += d[i] * d[i]), n++;
  return Math.sqrt(s / Math.max(1, n));
}

function toBuffer(chs: Float32Array[], sampleRate: number) {
  const buf = new AudioBuffer({ numberOfChannels: chs.length, length: chs[0].length, sampleRate });
  chs.forEach((d, c) => buf.getChannelData(c).set(d));
  return buf;
}

/**
 * A periodic HVAC/air bed: filtered noise run twice around the loop so the
 * filter state at the wrap point matches and there is no seam.
 */
function addAir(chs: Float32Array[], sampleRate: number, level: number, rnd: () => number) {
  const n = chs[0].length;
  const coef = (f: number) => 1 - Math.exp((-2 * Math.PI * f) / sampleRate);
  const noise = new Float32Array(n);
  const tmp = new Float32Array(n);
  for (let c = 0; c < chs.length; c++) {
    for (let i = 0; i < n; i++) noise[i] = rnd() * 2 - 1;
    // Rumble 70..400 Hz (two low-pass poles, one high-pass) plus a faint 1.5 kHz "air" hiss.
    const a1 = coef(380),
      a2 = coef(420),
      ah = coef(70),
      am = coef(1500);
    let l1 = 0,
      l2 = 0,
      lh = 0,
      m1 = 0,
      m2 = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        const x = noise[i];
        l1 += a1 * (x - l1);
        l2 += a2 * (l1 - l2);
        lh += ah * (l2 - lh);
        m1 += am * (x - m1);
        m2 += am * (m1 - m2);
        if (pass) tmp[i] = l2 - lh + m2 * 0.08;
      }
    }
    let e = 0;
    for (let i = 0; i < n; i++) e += tmp[i] * tmp[i];
    const k = level / Math.sqrt(e / n || 1);
    // Slow, gentle swell (exactly periodic over the loop) so it breathes a little.
    const d = chs[c];
    for (let i = 0; i < n; i++) d[i] += tmp[i] * k * (0.9 + 0.1 * Math.sin((2 * Math.PI * 3 * i) / n + c * 1.7));
  }
}

// ---------------------------------------------------------------------------
// The slot floor
// ---------------------------------------------------------------------------

/** MIDI note numbers: C major pentatonic (C D E G A), which also sits inside the music's A minor and the piano's F. */
const PENTA = [0, 2, 4, 7, 9];
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export async function renderFloor(opts: { seconds?: number; seed?: number; sampleRate?: number } = {}): Promise<AudioBuffer> {
  const sr = opts.sampleRate ?? AMBIENCE_RATE;
  const L = opts.seconds ?? 41;
  const tail = 3.5;
  const rnd = rng(opts.seed ?? (Math.random() * 2 ** 31) | 0);
  const ctx = new OfflineAudioContext(2, Math.ceil((L + tail) * sr), sr);

  const master = ctx.createGain();
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.value = 160;
  master.connect(hpf).connect(ctx.destination);
  const verb = ctx.createConvolver();
  verb.normalize = false;
  verb.buffer = roomImpulse(ctx, 1.9, 0.025, rnd);
  const wet = ctx.createGain();
  wet.gain.value = 0.9;
  verb.connect(wet).connect(master);

  // Banks of machines at different distances and directions: each bus has its own pan and air-absorption low-pass.
  const buses = Array.from({ length: 7 }, (_, k) => {
    const far = rnd();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3800 - far * 2400;
    lp.Q.value = 0.5;
    const pan = ctx.createStereoPanner();
    pan.pan.value = -0.85 + (1.7 * k) / 6 + (rnd() - 0.5) * 0.15;
    const dry = ctx.createGain();
    dry.gain.value = 0.16 * (1 - far * 0.7);
    const send = ctx.createGain();
    send.gain.value = 1;
    lp.connect(pan);
    pan.connect(dry).connect(master);
    pan.connect(send).connect(verb);
    return { input: lp, far };
  });
  const pickBus = () => buses[Math.floor(rnd() * buses.length)];

  // One FM tone: bell (inharmonic 3.5:1), marimba (1:4 with a fast index decay) or soft e-piano (1:1).
  type Timbre = 'bell' | 'marimba' | 'epiano';
  const tone = (out: AudioNode, at: number, f: number, vel: number, timbre: Timbre) => {
    const ratio = timbre === 'bell' ? 3.5 : timbre === 'marimba' ? 4 : 1;
    const decay = timbre === 'bell' ? 0.9 : timbre === 'marimba' ? 0.28 : 0.55;
    const idx0 = timbre === 'bell' ? 1.6 : timbre === 'marimba' ? 2.2 : 1.2;
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f * ratio;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(idx0 * f * ratio, at);
    mg.gain.exponentialRampToValueAtTime(idx0 * f * ratio * 0.05, at + decay * 0.35);
    mod.connect(mg).connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vel, at + 0.006);
    g.gain.setTargetAtTime(0, at + 0.006, decay / 4.6);
    car.connect(g).connect(out);
    const end = at + decay * 1.2 + 0.05;
    car.start(at);
    mod.start(at);
    car.stop(end);
    mod.stop(end);
  };

  const note = (degree: number, octave: number) => {
    let m = 12 * (octave + 1) + PENTA[((degree % 5) + 5) % 5] + 12 * Math.floor(degree / 5);
    while (m > 93) m -= 12; // keep runs below A6: nothing shrill, and FM sidebands stay under Nyquist
    return hz(m);
  };
  const timbres: Timbre[] = ['bell', 'marimba', 'epiano', 'marimba', 'bell'];

  // A jingle: a short run up (or down) the pentatonic scale, sometimes ending on a held chord tone.
  const jingle = (at: number) => {
    const bus = pickBus();
    const g = ctx.createGain();
    g.gain.value = 0.03 + rnd() * 0.035;
    g.connect(bus.input);
    const timbre = timbres[Math.floor(rnd() * timbres.length)];
    const octave = timbre === 'marimba' ? 5 : rnd() < 0.5 ? 5 : 6;
    const len = 3 + Math.floor(rnd() * 5);
    const step = 0.065 + rnd() * 0.06;
    const up = rnd() < 0.75;
    let deg = Math.floor(rnd() * 5);
    for (let k = 0; k < len; k++) {
      tone(g, at + k * step + (rnd() - 0.5) * 0.006, note(deg, octave), 0.6 + rnd() * 0.4, timbre);
      deg += up ? 1 + (rnd() < 0.25 ? 1 : 0) : -1;
    }
    if (rnd() < 0.4) {
      const t = at + len * step + 0.04;
      tone(g, t, note(0, octave), 0.6, timbre);
      tone(g, t + 0.004, note(2, octave), 0.45, timbre);
    }
  };

  // A small win: a soft repeating two-note trill for a second or two.
  const trill = (at: number) => {
    const bus = pickBus();
    const g = ctx.createGain();
    g.gain.value = 0.025 + rnd() * 0.03;
    g.connect(bus.input);
    const timbre: Timbre = rnd() < 0.5 ? 'bell' : 'epiano';
    const d0 = Math.floor(rnd() * 5);
    const octave = 6;
    const dur = 1 + rnd() * 1.5;
    const step = 0.075 + rnd() * 0.03;
    for (let t = 0, k = 0; t < dur; t += step, k++) {
      const fade = Math.min(1, t / 0.2, (dur - t) / 0.4);
      tone(g, at + t, note(d0 + (k % 2 ? 2 : 0), octave), 0.5 * fade + 0.1, timbre);
    }
  };

  // Coins into a tray: a decelerating cascade of short metallic ticks, band-limited.
  const noise = ctx.createBuffer(1, sr, sr);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = rnd() * 2 - 1;
  const clatter = (at: number) => {
    const bus = pickBus();
    const g = ctx.createGain();
    g.gain.value = 0.04 + rnd() * 0.04;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600 + rnd() * 1000;
    bp.Q.value = 1.2;
    g.connect(bp).connect(bus.input);
    const n = 10 + Math.floor(rnd() * 20);
    let t = at;
    for (let k = 0; k < n; k++) {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      const hg = ctx.createGain();
      const v = (0.4 + rnd() * 0.6) * Math.min(1, 1.6 - k / n);
      hg.gain.setValueAtTime(v, t);
      hg.gain.setTargetAtTime(0, t + 0.001, 0.006);
      s.connect(hg).connect(g);
      s.start(t, rnd() * 0.9, 0.05);
      // A faint ring from the coin itself.
      const o = ctx.createOscillator();
      o.frequency.value = 2200 + rnd() * 2200;
      const og = ctx.createGain();
      og.gain.setValueAtTime(v * 0.12, t);
      og.gain.setTargetAtTime(0, t + 0.001, 0.015);
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 0.1);
      t += 0.018 + rnd() * 0.05 + (k / n) * 0.05;
    }
  };

  // Events on jittered grids (not pure random) so they never bunch up or leave long gaps.
  const scatter = (every: number, fn: (at: number) => void) => {
    for (let t = rnd() * every; t < L; t += every * (0.5 + rnd())) fn(t);
  };
  scatter(0.55, jingle);
  scatter(5, trill);
  scatter(7, clatter);

  const rendered = await ctx.startRendering();
  const chs = foldLoop(rendered, Math.round(L * sr));
  const k = 0.05 / (rms(chs) || 1); // normalise the slot layer to about -26 dBFS
  for (const d of chs) for (let i = 0; i < d.length; i++) d[i] *= k;
  addAir(chs, sr, 0.022, rnd); // about -33 dBFS of air under it
  return toBuffer(chs, sr);
}

// ---------------------------------------------------------------------------
// The crowd walla
// ---------------------------------------------------------------------------

/** Fetches and decodes a spread of recorded voice clips (decoded straight at the walla's sample rate). */
export async function loadWallaClips(ctx: BaseAudioContext, count = 36, rnd: () => number = Math.random): Promise<AudioBuffer[]> {
  const res = await fetch(new URL('voices/index.json', document.baseURI).href);
  const index = (await res.json()) as { voices: Record<string, Record<string, number>> };
  const pools = Object.entries(index.voices).map(([voice, clips]) => {
    const ids = Object.entries(clips)
      .filter(([, s]) => s >= 1.0 && s <= 4)
      .map(([id]) => `${voice}/${id}`);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids;
  });
  // Round-robin across voices so the crowd has as many different people in it as possible.
  const picks: string[] = [];
  for (let round = 0; picks.length < count && round < 10; round++) {
    for (const p of pools) if (p[round] && picks.length < count) picks.push(p[round]);
  }
  const decoded = await Promise.all(
    picks.map((key) =>
      fetch(new URL(`voices/${key}.mp3`, document.baseURI).href)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => ctx.decodeAudioData(b))
        .catch(() => null),
    ),
  );
  return decoded.filter((b): b is AudioBuffer => !!b);
}

/** Mixes clips into a seamless murmur of a busy room. */
export async function renderWalla(clips: AudioBuffer[], opts: { seconds?: number; seed?: number; sampleRate?: number; density?: number } = {}): Promise<AudioBuffer> {
  if (clips.length < 6) throw new Error('not enough clips for a crowd');
  const sr = opts.sampleRate ?? AMBIENCE_RATE;
  const L = opts.seconds ?? 48;
  const tail = 6;
  const rnd = rng(opts.seed ?? (Math.random() * 2 ** 31) | 0);
  const ctx = new OfflineAudioContext(2, Math.ceil((L + tail) * sr), sr);

  const master = ctx.createGain();
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.value = 150;
  hpf.Q.value = 0.6;
  // A gentle dip in the presence range (where consonants live) keeps it a murmur, not words.
  const dip = ctx.createBiquadFilter();
  dip.type = 'peaking';
  dip.frequency.value = 2500;
  dip.Q.value = 0.8;
  dip.gain.value = -4;
  master.connect(hpf).connect(dip).connect(ctx.destination);
  const verb = ctx.createConvolver();
  verb.normalize = false;
  verb.buffer = roomImpulse(ctx, 1.6, 0.02, rnd);
  const wet = ctx.createGain();
  wet.gain.value = 0.85;
  verb.connect(wet).connect(master);

  // Groups of people around the room: each with a direction and a distance (low-pass + level).
  const buses = Array.from({ length: 10 }, (_, k) => {
    const far = 0.25 + rnd() * 0.75;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3400 - far * 1900;
    lp.Q.value = 0.5;
    const pan = ctx.createStereoPanner();
    pan.pan.value = -0.9 + (1.8 * k) / 9 + (rnd() - 0.5) * 0.1;
    const dry = ctx.createGain();
    dry.gain.value = 0.55 * (1 - far * 0.7);
    lp.connect(pan);
    pan.connect(dry).connect(master);
    pan.connect(verb);
    return lp;
  });

  // Average clip length ~1.9 s: aim for ~14 people talking at any moment, on a jittered grid.
  const concurrency = opts.density ?? 14;
  const avg = clips.reduce((s, c) => s + c.duration, 0) / clips.length;
  const every = avg / concurrency;
  let last = -1;
  for (let t = rnd() * every; t < L; t += every * (0.5 + rnd())) {
    let ci = Math.floor(rnd() * clips.length);
    if (ci === last) ci = (ci + 1) % clips.length;
    last = ci;
    const s = ctx.createBufferSource();
    s.buffer = clips[ci];
    s.playbackRate.value = 0.9 + rnd() * 0.2; // different people, different pitch and pace
    const g = ctx.createGain();
    g.gain.value = 0.35 + rnd() * 0.65;
    s.connect(g).connect(buses[Math.floor(rnd() * buses.length)]);
    s.start(t);
  }

  const rendered = await ctx.startRendering();
  const chs = foldLoop(rendered, Math.round(L * sr));
  const k = 0.07 / (rms(chs) || 1); // about -23 dBFS
  for (const d of chs) for (let i = 0; i < d.length; i++) d[i] *= k;
  return toBuffer(chs, sr);
}

/** Loads clips and renders the walla; resolves null if the clips can't be had. */
export async function buildWalla(seconds = 48): Promise<AudioBuffer | null> {
  try {
    const decoder = new OfflineAudioContext(1, 1, AMBIENCE_RATE);
    const clips = await loadWallaClips(decoder);
    return await renderWalla(clips, { seconds });
  } catch {
    return null;
  }
}
