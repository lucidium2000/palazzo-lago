/**
 * The stage mic's rules, kept pure (no audio, no DOM) so they're unit-tested
 * (tests/stagemic.test.ts): when your head is "on the mic", when you're
 * talking into it (voice activity from the mic's level), and how far the
 * music ducks under you.
 */

export interface P3 {
  x: number;
  y: number;
  z: number;
}

/** VR: your head within this of the mic (on its stand, in the performer's hand or in yours) puts you on it (m). */
export const MIC_REACH = 0.35;
/**
 * Screens: your eye height is fixed and the stand's pole keeps your body back
 * a little, so the same walk-up is measured on the floor (and a looser band
 * for height): within this of the mic across, and of its height up or down.
 */
export const MIC_REACH_SCREEN = { across: 0.5, height: 0.5 };
/** Off the mic again only past this many times the reach (so leaning about doesn't flicker it). */
export const MIC_LEAVE = 1.4;
/** Your own mic stream (when voice chat isn't lending you its own) is kept while you're within this of the stage mic (m). */
export const MIC_KEEP = 4;
/** How far the music dips while someone talks into the mic (dB). */
export const DUCK_DB = -6;
/** You hear yourself through the PA a little quieter than your friends hear you (gain; ~ -4.4 dB). */
export const SELF_MONITOR = 0.6;

/** How far your head is from being on the mic: 1 at the edge of reach, under 1 inside it. */
export function micReach(head: P3, mic: P3, screen: boolean): number {
  const dx = head.x - mic.x,
    dy = head.y - mic.y,
    dz = head.z - mic.z;
  if (!screen) return Math.hypot(dx, dy, dz) / MIC_REACH;
  return Math.max(Math.hypot(dx, dz) / MIC_REACH_SCREEN.across, Math.abs(dy) / MIC_REACH_SCREEN.height);
}

/** On the mic, with a little hysteresis. */
export class MicProximity {
  on = false;
  update(head: P3, mic: P3, screen: boolean): boolean {
    const r = micReach(head, mic, screen);
    if (!this.on && r <= 1) this.on = true;
    else if (this.on && r > MIC_LEAVE) this.on = false;
    return this.on;
  }
  reset() {
    this.on = false;
  }
}

/** RMS of a block of samples. */
export function rms(buf: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return buf.length ? Math.sqrt(s / buf.length) : 0;
}

export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const gainToDb = (g: number) => 20 * Math.log10(Math.max(1e-9, g));

/**
 * Voice activity from the mic's level: on as soon as the level crosses `on`,
 * off once it's stayed under `off` for `hold` seconds (the gaps between words
 * don't count as stopping).
 */
export class VoiceActivity {
  active = false;
  private quiet = 0;
  constructor(
    readonly onLevel = 0.03,
    readonly offLevel = 0.015,
    readonly hold = 0.4,
  ) {}

  update(dt: number, level: number): boolean {
    if (level >= this.onLevel) {
      this.active = true;
      this.quiet = 0;
    } else if (level < this.offLevel) {
      this.quiet += dt;
      if (this.quiet >= this.hold) this.active = false;
    } else if (this.active) this.quiet = 0;
    return this.active;
  }

  reset() {
    this.active = false;
    this.quiet = 0;
  }
}

/**
 * The music's ducking envelope: down to `depth` dB with a fast attack while
 * someone talks, back up slowly when they stop (time constants in seconds).
 */
export class Ducker {
  gain = 1;
  constructor(
    readonly depthDb = DUCK_DB,
    readonly attack = 0.08,
    readonly release = 0.7,
  ) {}

  update(dt: number, talking: boolean): number {
    const target = talking ? dbToGain(this.depthDb) : 1;
    const tau = target < this.gain ? this.attack : this.release;
    this.gain += (target - this.gain) * (1 - Math.exp(-Math.max(0, dt) / tau));
    if (Math.abs(this.gain - target) < 1e-3) this.gain = target;
    return this.gain;
  }
}

/**
 * Who has the stage mic, VR grab: you can lift it off its stand only while
 * it's on the stand and the headliner isn't singing into it (between his
 * sets; he keeps it for his own). Walking up to it works any time: while he's
 * live you're singing over his track.
 */
export function canGrabMic(onStand: boolean, live: boolean): boolean {
  return onStand && !live;
}

/**
 * A friend's voice routing: through the PA while their `onMic` flag is on and
 * their voice reaches you, else from their avatar (never both).
 */
export function friendRoute(onMic: boolean, hasVoice: boolean): 'pa' | 'avatar' | 'none' {
  if (!hasVoice) return 'none';
  return onMic ? 'pa' : 'avatar';
}
