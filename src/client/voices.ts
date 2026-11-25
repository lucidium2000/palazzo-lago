import * as THREE from 'three';
import type { Sound } from './audio';
import type { Hud } from './hud';
import { lineId, type VoiceId } from './speech';

/**
 * People talking out loud. Every line is a recorded clip (public/voices, made
 * with tools/voices/render.py) played as 3D sound from the speaker's mouth, so
 * you hear who is talking and where. Lines without a clip fall back to the
 * browser's speech voice. Captions are off unless you turn them on (or a line
 * has no recording).
 */

interface Live {
  audio: THREE.PositionalAudio;
  follow: (() => THREE.Vector3 | null) | null;
  until: number;
  group: string;
  priority: boolean;
  base: number;
  /** Who is talking (their mouth moves with this clip), if known. */
  speaker: object | null;
  /** Taps the clip (before 3D panning) so mouths follow the actual words. */
  analyser: AnalyserNode | null;
  level: number;
  /** Last analysis (once per frame per speaker). */
  read: { at: number; level: number; vowel: number } | null;
}

/** A mouth-position function that also says whose mouth it is (see mouthOf). */
type MouthAt = (() => THREE.Vector3 | null) & { speaker?: object };

export interface TalkOpts {
  /** Caption speaker name. */
  who: string;
  text: string;
  voice: VoiceId;
  /** Voice to use if `voice` has no recording of this line (e.g. before ElevenLabs takes are in). */
  alt?: VoiceId;
  /** Where the speaker's mouth is, every frame (null: in your head). From mouthOf, it also tells whose mouth moves. */
  at?: MouthAt | null;
  /** Whose mouth moves with the words (defaults to the person `at` came from). */
  speaker?: object;
  volume?: number;
  /** Staff, your crew, anyone talking to you: louder, ducks the crowd's chatter. */
  priority?: boolean;
  /** Cuts off whatever this group (e.g. 'croupier') was saying. */
  group?: string;
  /** Show a caption even with captions off when there's no recording (default true). */
  captionFallback?: boolean;
  /** Browser speech fallback tone. */
  fallback?: { pitch?: number; rate?: number; voice?: number };
}

const now = () => performance.now() / 1000;

class Voices {
  private sound: Sound | null = null;
  private hud: Hud | null = null;
  private scene: THREE.Scene | null = null;
  private index: Record<string, Record<string, number>> = {};
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private order: string[] = [];
  private live: Live[] = [];
  private pool: THREE.PositionalAudio[] = [];
  private tbuf = new Float32Array(512);
  private fbuf = new Uint8Array(256);
  captions = false;

  init(sound: Sound, hud: Hud, scene: THREE.Scene) {
    this.sound = sound;
    this.hud = hud;
    this.scene = scene;
    try {
      this.captions = localStorage.getItem('captions') === 'on';
    } catch {
      /* private mode */
    }
    fetch(new URL('voices/index.json', document.baseURI).href)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.voices) this.index = j.voices;
      })
      .catch(() => {});
  }

  setCaptions(on: boolean) {
    this.captions = on;
    try {
      localStorage.setItem('captions', on ? 'on' : 'off');
    } catch {
      /* private mode */
    }
  }

  /** Seconds the recorded line lasts, or null if it isn't recorded. */
  duration(voice: VoiceId, text: string): number | null {
    return this.index[voice]?.[lineId(voice, text)] ?? null;
  }

  has(voice: VoiceId, text: string) {
    return this.duration(voice, text) !== null;
  }

  /** Starts downloading a line so it plays without delay. */
  prefetch(voice: VoiceId, text: string) {
    if (this.has(voice, text)) void this.buffer(voice, lineId(voice, text));
  }

  private buffer(voice: VoiceId, id: string): Promise<AudioBuffer | null> {
    const key = `${voice}/${id}`;
    let p = this.buffers.get(key);
    if (!p) {
      const ctx = this.sound!.listener.context;
      p = fetch(new URL(`voices/${key}.mp3`, document.baseURI).href)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => ctx.decodeAudioData(b))
        .catch(() => null);
      this.buffers.set(key, p);
      this.order.push(key);
      // Keep the most recent ~80 lines decoded (a couple of MB).
      while (this.order.length > 80) this.buffers.delete(this.order.shift()!);
    }
    return p;
  }

  /** Is anyone important (staff, crew, someone talking to you) speaking? */
  get priorityBusy() {
    const t = now();
    return this.live.some((l) => l.priority && l.until > t);
  }

  /**
   * Says a line. Returns how long it takes (the recording's length, or an
   * estimate for the fallback voice).
   */
  /** The first of these voices that has this line recorded (or the first one). */
  pick(text: string, ...voices: (VoiceId | undefined)[]): VoiceId {
    const vs = voices.filter((v): v is VoiceId => !!v);
    return vs.find((v) => this.has(v, text)) ?? vs[0];
  }

  talk(o: TalkOpts): number {
    const text = o.text.trim();
    if (o.alt && !this.has(o.voice, text) && this.has(o.alt, text)) o = { ...o, voice: o.alt };
    const dur = this.duration(o.voice, text);
    const shown = text.replace(/\s*\[[^\]]+\]\s*/g, ' ').replace(/\s+/g, ' ').trim();
    const est = 0.9 + shown.length * 0.06;
    if (this.captions || (dur === null && o.captionFallback !== false)) this.hud?.say(o.who, shown);
    const s = this.sound;
    if (!s || s.muted) return dur ?? est;
    if (dur === null) {
      s.say(shown, { ...o.fallback, volume: o.volume, interrupt: !!o.group && o.priority });
      return est;
    }
    if (o.group) this.stop(o.group);
    const t0 = now();
    const audio = this.voiceAudio();
    const entry: Live = {
      audio,
      follow: o.at ?? null,
      until: Infinity /* until the clip arrives */,
      group: o.group ?? '',
      priority: !!o.priority,
      base: o.volume ?? 1,
      speaker: o.speaker ?? o.at?.speaker ?? null,
      analyser: (audio.userData.analyser as AnalyserNode | undefined) ?? null,
      level: 0,
      read: null,
    };
    this.live.push(entry);
    void this.buffer(o.voice, lineId(o.voice, text)).then((buf) => {
      // Cut off already, or so late it would answer the wrong moment: skip it.
      const late = now() - t0 > (entry.priority ? 4 : 2);
      if (!buf || !this.live.includes(entry) || late || s.listener.context.state !== 'running') {
        this.release(entry);
        return;
      }
      const a = entry.audio;
      a.setBuffer(buf);
      a.setVolume(entry.base);
      this.place(entry);
      a.play();
      // Lip sync: the mouth reads the clip itself (not the panned, distance-faded copy).
      if (entry.speaker && entry.analyser && a.source) {
        try {
          a.source.connect(entry.analyser);
        } catch {
          /* no analyser: the mouth falls back to flapping */
        }
      }
      entry.until = now() + buf.duration + 0.1;
    });
    return dur;
  }

  /** Stops what a group is saying (a new call cuts off the last one). */
  stop(group: string) {
    for (const l of [...this.live]) if (l.group === group) this.release(l);
  }

  private voiceAudio() {
    let a = this.pool.pop();
    if (!a) {
      a = new THREE.PositionalAudio(this.sound!.listener);
      a.setDistanceModel('inverse');
      a.setRefDistance(1.1);
      a.setRolloffFactor(1.5);
      a.setMaxDistance(40);
      a.panner.panningModel = 'HRTF';
      try {
        const an = a.context.createAnalyser();
        an.fftSize = 512;
        an.smoothingTimeConstant = 0.3;
        a.userData.analyser = an;
      } catch {
        /* no analysers here */
      }
    }
    // Voices limit: the oldest crowd chatter makes way.
    if (this.live.length >= 6) {
      const old = this.live.find((l) => !l.priority) ?? this.live[0];
      this.release(old);
    }
    return a;
  }

  private release(l: Live) {
    const i = this.live.indexOf(l);
    if (i >= 0) this.live.splice(i, 1);
    try {
      if (l.analyser && l.audio.source) l.audio.source.disconnect(l.analyser);
    } catch {
      /* never connected */
    }
    try {
      if (l.audio.isPlaying) l.audio.stop();
    } catch {
      /* not started */
    }
    l.audio.removeFromParent();
    this.pool.push(l.audio);
  }

  private place(l: Live) {
    const p = l.follow?.();
    if (p) {
      if (l.audio.parent !== this.scene) this.scene?.add(l.audio);
      l.audio.position.copy(p);
      l.audio.updateMatrixWorld();
    } else if (l.audio.parent !== this.sound!.listener.parent) {
      // No position: right with you (the listener sits on the camera).
      this.sound!.listener.parent?.add(l.audio);
      l.audio.position.set(0, 0, -0.3);
    }
  }

  /**
   * How loud a person's recorded line is right now (0..1) and how "open" the
   * sound is (vowels carry their energy in the low mids, consonants hiss
   * higher up), straight from the playing clip. Null when they aren't saying
   * a recorded line; level 0 between words.
   */
  mouthLevel(speaker: object): { level: number; vowel: number } | null {
    const l = this.live.find((e) => e.speaker === speaker && e.audio.isPlaying);
    const an = l?.analyser;
    if (!l || !an) return null;
    const t = now();
    if (l.read && t - l.read.at < 0.008) return l.read;
    const dt = Math.min(0.1, l.read ? t - l.read.at : 1 / 60);
    an.getFloatTimeDomainData(this.tbuf);
    an.getByteFrequencyData(this.fbuf);
    const f = speechFeatures(this.tbuf, this.fbuf, an.context.sampleRate / an.fftSize);
    // Opens fast, closes a little slower (jaws do); the same at any frame rate.
    l.level += (f.level - l.level) * (1 - Math.exp(-dt * (f.level > l.level ? 40 : 18)));
    l.read = { at: t, level: l.level, vowel: f.vowel };
    return l.read;
  }

  /** Follows the speakers, ducks the crowd under important voices, cleans up. */
  update() {
    const t = now();
    const duck = this.priorityBusy ? 0.45 : 1;
    for (const l of [...this.live]) {
      if (t > l.until && !l.audio.isPlaying) {
        this.release(l);
        continue;
      }
      if (l.audio.isPlaying) {
        this.place(l);
        l.audio.setVolume(l.base * (l.priority ? 1 : duck));
      }
    }
  }
}

export const voices = new Voices();

/**
 * A mouth position for a person (a little below the top of the head). It
 * also carries who the person is, so their mouth moves with the line.
 */
export function mouthOf(p: { pos: THREE.Vector3; seated: boolean; look: { height: number } }): MouthAt {
  const v = new THREE.Vector3();
  return Object.assign(() => v.set(p.pos.x, p.pos.y + (p.seated ? 1.22 : 1.62 * (p.look.height / 1.8)), p.pos.z), { speaker: p });
}

/**
 * Loudness (0..1, from the waveform's RMS) and vowel-ness (0..1: the share of
 * spectrum energy in the ~250–1000 Hz vowel band against 1–6 kHz, where
 * consonants hiss) of one analyser frame. `bin` is Hz per frequency bin.
 */
export function speechFeatures(wave: ArrayLike<number>, spectrum: ArrayLike<number>, bin: number): { level: number; vowel: number } {
  let sum = 0;
  for (let i = 0; i < wave.length; i++) sum += wave[i] * wave[i];
  const rms = Math.sqrt(sum / Math.max(1, wave.length));
  const level = Math.min(1, Math.max(0, (rms - 0.01) * 5));
  let lo = 0,
    hi = 1;
  for (let i = 1; i < spectrum.length; i++) {
    const f = i * bin;
    if (f > 250 && f < 1000) lo += spectrum[i];
    else if (f >= 1000 && f < 6000) hi += spectrum[i];
  }
  return { level, vowel: Math.min(1, (lo / (lo + hi)) * 1.6) };
}
