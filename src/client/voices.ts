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
}

export interface TalkOpts {
  /** Caption speaker name. */
  who: string;
  text: string;
  voice: VoiceId;
  /** Where the speaker's mouth is, every frame (null: in your head). */
  at?: (() => THREE.Vector3 | null) | null;
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
  talk(o: TalkOpts): number {
    const text = o.text.trim();
    const dur = this.duration(o.voice, text);
    const est = 0.9 + text.length * 0.06;
    if (this.captions || (dur === null && o.captionFallback !== false)) this.hud?.say(o.who, text);
    const s = this.sound;
    if (!s || s.muted) return dur ?? est;
    if (dur === null) {
      s.say(text, { ...o.fallback, volume: o.volume, interrupt: !!o.group && o.priority });
      return est;
    }
    if (o.group) this.stop(o.group);
    const t0 = now();
    const entry: Live = { audio: this.voiceAudio(), follow: o.at ?? null, until: Infinity /* until the clip arrives */, group: o.group ?? '', priority: !!o.priority, base: o.volume ?? 1 };
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

/** A mouth position for a person (a little below the top of the head). */
export function mouthOf(p: { pos: THREE.Vector3; seated: boolean; look: { height: number } }) {
  const v = new THREE.Vector3();
  return () => v.set(p.pos.x, p.pos.y + (p.seated ? 1.22 : 1.62 * (p.look.height / 1.8)), p.pos.z);
}
