import * as THREE from 'three';

/**
 * Synthesized sound effects. Every sound is generated in code at startup, so
 * there are no audio files to download. Sounds are positional: in VR a chip
 * clack comes from the felt, the slot jingle from the machine.
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
  | 'ambience'
  | 'denied';

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

function buildBuffers(ctx: BaseAudioContext): Record<SoundName, AudioBuffer> {
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
  const denied = synth(ctx, 0.25, (t) => (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 233 * t)) * 0.18 * env(t, 0.005, 0.1));

  // Casino room tone: a soft crowd murmur with distant chimes. Stereo, loops.
  const ambience = (() => {
    const L = [lp(0.02), lp(0.02)],
      M = [lp(0.12), lp(0.12)];
    const chimes = Array.from({ length: 14 }, () => ({ at: Math.abs(rand()) * 11.5, f: [C6, E6, G6, G5][Math.floor(Math.abs(rand()) * 4)], g: 0.04 + Math.abs(rand()) * 0.05 }));
    const sr = ctx.sampleRate,
      len = 12 * sr;
    const buf = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const murmur = M[c](L[c](rand()) * 4) * (0.8 + 0.2 * Math.sin(t * 1.3 + c));
        let ch = 0;
        for (const k of chimes) if (t > k.at && t - k.at < 1) ch += bell(k.f * (c ? 1.002 : 1), t - k.at, 0.3) * k.g;
        d[i] = murmur * 0.5 + ch;
      }
      // Crossfade the loop seam.
      const fade = Math.floor(sr * 0.5);
      for (let i = 0; i < fade; i++) {
        const a = i / fade;
        d[i] = d[i] * a + d[len - fade + i] * (1 - a);
      }
    }
    return buf;
  })();

  return { chip, chips, click, ballRoll, ballDrop, reelTick, reelStop, winSmall, winBig, bonus, lever, ambience, denied };
}

export class Sound {
  readonly listener = new THREE.AudioListener();
  private buffers: Record<SoundName, AudioBuffer> | null = null;
  private pool: THREE.PositionalAudio[] = [];
  private ambient: THREE.Audio | null = null;
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
    };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
  }

  private ensure() {
    if (!this.buffers) this.buffers = buildBuffers(this.listener.context);
    return this.buffers;
  }

  private startAmbience() {
    if (this.ambient) return;
    this.ambient = new THREE.Audio(this.listener);
    this.ambient.setBuffer(this.ensure().ambience);
    this.ambient.setLoop(true);
    this.ambient.setVolume(this.muted ? 0 : 0.35);
    this.ambient.play();
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.listener.setMasterVolume(m ? 0 : 1);
  }

  /** Plays a one-shot at a world position (or attached to an object). */
  play(name: SoundName, at?: THREE.Vector3 | THREE.Object3D, opts: { volume?: number; rate?: number } = {}) {
    if (this.listener.context.state !== 'running') return null;
    const buffers = this.ensure();
    let a = this.pool.find((p) => !p.isPlaying);
    if (!a) {
      if (this.pool.length >= 24) return null;
      a = new THREE.PositionalAudio(this.listener);
      a.setRefDistance(1.2);
      a.setRolloffFactor(1.4);
      this.pool.push(a);
    }
    a.removeFromParent();
    if (at instanceof THREE.Object3D) {
      a.position.set(0, 0, 0);
      at.add(a);
    } else {
      a.position.copy(at ?? new THREE.Vector3());
      this.scene.add(a);
    }
    a.setBuffer(buffers[name]);
    a.setLoop(false);
    a.setVolume(opts.volume ?? 1);
    a.setPlaybackRate(opts.rate ?? 1);
    a.play();
    return a;
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
          a.setBuffer(this.ensure()[name]);
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
