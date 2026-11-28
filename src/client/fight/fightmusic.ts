import INDEX from '../../../public/audio/index.json';

/**
 * Fight mode's music: "Ring of Steel" (public/audio/fight.mp3, the owner's
 * own track) on a 2D music bus, not placed anywhere in the world. It kicks
 * in with the versus intro, plays through the rounds (looping on its bar
 * lines), and fades out over a few seconds once the fight's over.
 *
 * Who hears it:
 *  - the fighters: loud, and the world's music (the casino lounge, the pool
 *    party's decks) ducks under it;
 *  - a player watching: faintly when close (it's their friends' fight, not
 *    theirs), nothing from across the room; the world's music dips a little;
 *  - nobody else.
 *
 * The bus goes through the listener's input, so your knockout's muffle
 * (fight/you.ts) and the mute button take it too.
 *
 * MusicCue is the pure part (levels, start and stop; tests/fightmode.test.ts);
 * FightMusic plays it.
 */

/** The fighters' level (the track is mastered at -14 LUFS, like the party's records). */
export const FIGHTER_LEVEL = 0.5;
/** A spectator's level, close by (falls to nothing by SPECTATOR_FAR). */
export const SPECTATOR_LEVEL = 0.09;
export const SPECTATOR_NEAR = 3;
export const SPECTATOR_FAR = 14;
/** How far the world's music ducks under it (fighters), as a gain multiplier. */
export const FIGHTER_DUCK = 0.15;
/** Seconds to come in, and to fade out after. */
export const ATTACK = 0.35;
export const RELEASE = 3.2;

export type MusicRole = 'fighter' | 'spectator' | 'none';

/** How loud the fight's music should be for you. */
export function musicTarget(on: boolean, role: MusicRole, dist = 0): number {
  if (!on || role === 'none') return 0;
  if (role === 'fighter') return FIGHTER_LEVEL;
  const k = 1 - (dist - SPECTATOR_NEAR) / (SPECTATOR_FAR - SPECTATOR_NEAR);
  return SPECTATOR_LEVEL * Math.min(1, Math.max(0, k));
}

export class MusicCue {
  /** Current level (gain). */
  level = 0;
  playing = false;
  private role: MusicRole = 'none';

  /** Eases toward the target; says when to start the track and when to stop it. */
  update(dt: number, on: boolean, role: MusicRole, dist = 0): { start: boolean; stop: boolean } {
    if (on) this.role = role;
    const target = musicTarget(on, role, dist);
    let start = false,
      stop = false;
    if (target > 0 && !this.playing) {
      this.playing = true;
      start = true;
    }
    if (target > this.level) this.level = Math.min(target, this.level + (dt * Math.max(target, FIGHTER_LEVEL)) / ATTACK);
    else this.level = Math.max(target, this.level - (dt * FIGHTER_LEVEL) / RELEASE);
    if (this.playing && target === 0 && this.level <= 1e-3) {
      this.level = 0;
      this.playing = false;
      this.role = 'none';
      stop = true;
    }
    return { start, stop };
  }

  /** The world's music level multiplier while this plays. */
  get duck(): number {
    if (this.level <= 0) return 1;
    if (this.role === 'fighter') return 1 - (1 - FIGHTER_DUCK) * Math.min(1, this.level / FIGHTER_LEVEL);
    return 1 - 0.3 * Math.min(1, this.level / SPECTATOR_LEVEL);
  }
}

/** Where the track loops (on its bar lines: past the intro, before the ending), in seconds. */
export function loopRegion(): { start: number; end: number } {
  const e = (INDEX as unknown as Record<string, { bpm: number; firstBeat: number; bars: number }>).fight;
  if (!e) return { start: 0, end: 0 };
  const bar = (4 * 60) / e.bpm;
  return { start: e.firstBeat + 8 * bar, end: e.firstBeat + Math.max(16, e.bars - 4) * bar };
}

/** The bits of Web Audio FightMusic uses (so tests can stand in for them). */
export interface MusicOut {
  ctx: Pick<BaseAudioContext, 'createGain' | 'createBufferSource' | 'currentTime'>;
  /** Where the bus goes (the listener's input). */
  out: AudioNode;
  load(): Promise<AudioBuffer>;
}

export class FightMusic {
  readonly cue = new MusicCue();
  private gain: GainNode | null = null;
  private src: AudioBufferSourceNode | null = null;
  private buf: Promise<AudioBuffer | null> | null = null;
  private want = false;

  constructor(private o: () => MusicOut | null) {}

  /** Once a frame: is a fight on that you should hear, as what, and how far from it. */
  update(dt: number, on: boolean, role: MusicRole, dist = 0) {
    const r = this.cue.update(dt, on, role, dist);
    if (r.start) this.start();
    if (r.stop) this.stop();
    const g = this.gain;
    if (g) {
      try {
        g.gain.setTargetAtTime(this.cue.level, this.o()?.ctx.currentTime ?? 0, 0.03);
      } catch {
        g.gain.value = this.cue.level;
      }
    }
  }

  get duck() {
    return this.cue.duck;
  }

  get playing() {
    return this.cue.playing;
  }

  /** Starts fetching the track (a fight's about to start). */
  preload() {
    const o = this.o();
    if (!o || this.buf) return;
    this.buf = o.load().catch((e) => {
      console.warn('Fight music: not available', e);
      this.buf = null;
      return null;
    });
  }

  private start() {
    const o = this.o();
    if (!o) return;
    this.want = true;
    this.preload();
    void this.buf?.then((b) => {
      if (!b || !this.want || this.src) return;
      const g = o.ctx.createGain();
      g.gain.value = 0;
      g.connect(o.out);
      const s = o.ctx.createBufferSource();
      s.buffer = b;
      const lr = loopRegion();
      if (lr.end > lr.start + 4 && lr.end < b.duration) {
        s.loop = true;
        s.loopStart = lr.start;
        s.loopEnd = lr.end;
      }
      s.connect(g);
      s.start();
      this.gain = g;
      this.src = s;
    });
  }

  private stop() {
    this.want = false;
    try {
      this.src?.stop();
    } catch {
      /* never started */
    }
    this.src?.disconnect();
    this.gain?.disconnect();
    this.src = null;
    this.gain = null;
  }

  dispose() {
    this.stop();
  }
}
