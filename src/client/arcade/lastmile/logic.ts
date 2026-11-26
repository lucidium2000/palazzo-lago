/**
 * The pure parts of The Last Mile's cabinet (no DOM, no three.js, so the
 * tests run them in Node): the requestAnimationFrame queue the cabinet
 * drains from the room's own frame loop, the joystick/button/gesture to key
 * mapping, how often the game runs and its screen is copied, and the size
 * control for the low-rate picture friends see.
 */

// --- The frame queue ------------------------------------------------------------------------

/**
 * Stands in for the game's `requestAnimationFrame`: callbacks wait here until
 * the cabinet runs a frame. Like the real thing, a callback queued while a
 * frame is running waits for the next one, and cancelling one that hasn't run
 * yet (even mid-frame) stops it.
 */
export class FrameQueue {
  private nextId = 1;
  private queued = new Map<number, (t: number) => void>();
  private running: Map<number, (t: number) => void> | null = null;

  request(cb: (t: number) => void): number {
    const id = this.nextId++;
    this.queued.set(id, cb);
    return id;
  }

  cancel(id: number) {
    this.queued.delete(id);
    this.running?.delete(id);
  }

  get pending() {
    return this.queued.size;
  }

  /** Runs everything queued before this call with timestamp `t`. A throwing callback doesn't stop the rest. Returns how many ran. */
  run(t: number, onError?: (e: unknown) => void): number {
    if (!this.queued.size) return 0;
    const batch = this.queued;
    this.queued = new Map();
    this.running = batch;
    let n = 0;
    for (const [id, cb] of batch) {
      if (!batch.has(id)) continue;
      batch.delete(id);
      n++;
      try {
        cb(t);
      } catch (e) {
        onError?.(e);
      }
    }
    this.running = null;
    return n;
  }
}

// --- Keys -----------------------------------------------------------------------------------

/** A synthetic key event for the game (it reads `key`; `code` is filled in for completeness). */
export interface KeyStroke {
  type: 'keydown' | 'keyup';
  key: string;
  code: string;
  repeat: boolean;
}

export type Dir = 'up' | 'down' | 'left' | 'right';

/** The game's keys: arrows to move, Space to cross ("go" on every other screen), M to cycle the sound. */
export const KEYS = {
  up: { key: 'ArrowUp', code: 'ArrowUp' },
  down: { key: 'ArrowDown', code: 'ArrowDown' },
  left: { key: 'ArrowLeft', code: 'ArrowLeft' },
  right: { key: 'ArrowRight', code: 'ArrowRight' },
  cross: { key: ' ', code: 'Space' },
  sound: { key: 'm', code: 'KeyM' },
} as const;

/** Held direction: first repeat after this long, then one every REPEAT_EVERY (s). */
export const REPEAT_DELAY = 0.32;
export const REPEAT_EVERY = 0.16;
const ON = 0.55;
const OFF = 0.35;

/**
 * Which way an 8-way stick points, for a game that moves in four: the
 * stronger axis wins (forward on a tie, it's the move that matters), with
 * hysteresis so a hand resting near the edge doesn't chatter.
 */
export function stickDir(x: number, y: number, prev: Dir | null): Dir | null {
  const ax = Math.abs(x),
    ay = Math.abs(y);
  if (prev) {
    // Keep the current direction while it's still pushed past the release point and still the stronger axis.
    const along = prev === 'up' ? y : prev === 'down' ? -y : prev === 'right' ? x : -x;
    const across = prev === 'up' || prev === 'down' ? ax : ay;
    if (along > OFF && along >= across * 0.8) return prev;
  }
  if (Math.max(ax, ay) < ON) return null;
  if (ay >= ax) return y > 0 ? 'up' : 'down';
  return x > 0 ? 'right' : 'left';
}

/** The controls as the cabinet reads them: stick (-1..1, y up), CROSS and SOUND buttons. */
export interface PadLike {
  x: number;
  y: number;
  a: boolean;
  c: boolean;
}

/**
 * Turns the cabinet's stick and buttons into the key presses the game
 * expects: a keydown when the stick goes into a direction (and auto-repeat
 * while it's held, like a held arrow key), a keyup when it leaves; Space for
 * CROSS and M for SOUND on their press and release.
 */
export class PadKeys {
  dir: Dir | null = null;
  private rep = 0;
  private a = false;
  private c = false;

  update(p: PadLike, dt: number, out: KeyStroke[]): KeyStroke[] {
    const d = stickDir(p.x, p.y, this.dir);
    if (d !== this.dir) {
      if (this.dir) out.push(stroke('keyup', KEYS[this.dir], false));
      if (d) out.push(stroke('keydown', KEYS[d], false));
      this.dir = d;
      this.rep = REPEAT_DELAY;
    } else if (d) {
      this.rep -= dt;
      if (this.rep <= 0) {
        this.rep += REPEAT_EVERY;
        if (this.rep <= 0) this.rep = REPEAT_EVERY;
        out.push(stroke('keydown', KEYS[d], true));
      }
    }
    if (p.a !== this.a) out.push(stroke(p.a ? 'keydown' : 'keyup', KEYS.cross, false));
    if (p.c !== this.c) out.push(stroke(p.c ? 'keydown' : 'keyup', KEYS.sound, false));
    this.a = p.a;
    this.c = p.c;
    return out;
  }

  /** Let go of everything (keyups for whatever was down). */
  release(out: KeyStroke[]): KeyStroke[] {
    return this.update({ x: 0, y: 0, a: false, c: false }, 0, out);
  }
}

function stroke(type: KeyStroke['type'], k: { key: string; code: string }, repeat: boolean): KeyStroke {
  return { type, key: k.key, code: k.code, repeat };
}

/** Pixels a finger has to travel for a swipe rather than a tap (the game itself uses 42 on its own canvas). */
export const SWIPE_MIN = 36;

/** A tap anywhere is CROSS; a swipe is the arrow it points along (screen y down). Like the game's own touch handling. */
export function gestureKey(dx: number, dy: number, min = SWIPE_MIN): { key: string; code: string } {
  if (Math.hypot(dx, dy) <= min) return KEYS.cross;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? KEYS.right : KEYS.left;
  return dy < 0 ? KEYS.up : KEYS.down;
}

/** Real keys forwarded from a keyboard while you're at the cabinet (Escape / Backspace / E still step away). */
export function forwardsKey(code: string): boolean {
  if (code === 'Escape' || code === 'Backspace' || code === 'KeyE') return false;
  return /^(Arrow(Up|Down|Left|Right)|Key[A-Z]|Digit[0-9]|Space|Enter|NumpadEnter)$/.test(code);
}

// --- When it runs ---------------------------------------------------------------------------

/** Load the game when you come this near (m); unload it past UNLOAD_FAR when nobody's playing. */
export const LOAD_NEAR = 9;
export const UNLOAD_FAR = 13;
/** Frames a second: playing (full / light tiers), watching the attract screen. */
export const RATE_PLAY = 60;
export const RATE_PLAY_LIGHT = 30;
export const RATE_ATTRACT = 10;
/** Seconds after your last input that the game still counts as yours (then it drops to attract rate). */
export const ACTIVE_FOR = 20;

export interface PlanIn {
  /** You're on the arcade's floor. */
  here: boolean;
  /** Metres to the cabinet. */
  dist: number;
  /** You're at its controls, or gave it input recently. */
  playing: boolean;
  /** The game's already loaded (hysteresis between LOAD_NEAR and UNLOAD_FAR). */
  loaded: boolean;
  /** A friend's game is on the screen (their frames arrive; ours needn't run). */
  friend: boolean;
  /** Light quality tier (Quest 2, phones). */
  light: boolean;
}

export interface Plan {
  /** Keep the game loaded. */
  load: boolean;
  /** Game frames (and screen copies) a second; 0 = paused. */
  rate: number;
}

export function plan(i: PlanIn): Plan {
  if (!i.here) return { load: false, rate: 0 };
  const load = i.playing || i.dist < (i.loaded ? UNLOAD_FAR : LOAD_NEAR);
  if (!load) return { load, rate: 0 };
  if (i.playing) return { load, rate: i.light ? RATE_PLAY_LIGHT : RATE_PLAY };
  if (i.friend) return { load, rate: 0 };
  return { load, rate: RATE_ATTRACT };
}

/** "Is a frame due?" at a given rate (rate <= 0: never), carrying the remainder so the average rate holds. */
export class Ticker {
  private acc = 0;

  due(dt: number, rate: number): boolean {
    if (rate <= 0) {
      this.acc = 0;
      return false;
    }
    const step = 1 / rate;
    this.acc += dt;
    if (this.acc + 1e-4 < step) return false;
    // Behind by a whole frame or more (a hitch, or a display slower than the rate): don't try to catch up.
    this.acc -= step;
    if (this.acc >= step) this.acc = 0;
    return true;
  }
}

// --- Friends' view --------------------------------------------------------------------------

/**
 * The picture friends get: a 160x90 JPEG of the screen four times a second.
 * Measured on a busy street scene, 160x90 is ~3.7 K base64 characters at
 * quality 0.3 (128x72: ~2.8 K), and an event has to share a ~3.6 KB packet
 * with a VR player's state, so a frame goes as NET_CHUNKS pieces of at most
 * NET_CHUNK characters (photowire.ts does the same for photos) and its
 * quality is steered to keep the whole frame under NET_MAX_B64.
 */
export const NET_W = 160;
export const NET_H = 90;
export const NET_EVERY = 0.25;
export const NET_CHUNK = 1800;
export const NET_CHUNKS = 2;
export const NET_MAX_B64 = NET_CHUNK * NET_CHUNKS;
export const NET_RANGE = 14;

/** JPEG quality for the next frame, from how big the last came out: down quickly when too big, up slowly when there's room. */
export function nextQuality(q: number, b64Len: number, max = NET_MAX_B64): number {
  if (b64Len > max) return Math.max(0.1, q * 0.8);
  if (b64Len < max * 0.75) return Math.min(0.7, q + 0.03);
  return q;
}

/** A frame cut into wire-sized pieces. */
export function splitFrame(b64: string, size = NET_CHUNK): string[] {
  const out: string[] = [];
  for (let i = 0; i < b64.length; i += size) out.push(b64.slice(i, i + size));
  return out;
}

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

export interface FramePiece {
  /** Frame number (per sender), piece index and count. */
  id: number;
  i: number;
  k: number;
  d: string;
  name: string;
}

/** A piece of a friend's frame off the wire, checked (null if malformed or too big). */
export function parseFrame(d: Record<string, unknown>): FramePiece | null {
  const id = Number(d.id),
    i = Number(d.i),
    k = Number(d.c);
  const f = d.f;
  if (!Number.isInteger(id) || id < 0 || !Number.isInteger(k) || k < 1 || k > NET_CHUNKS + 1 || !Number.isInteger(i) || i < 0 || i >= k) return null;
  if (typeof f !== 'string' || !f.length || f.length > NET_CHUNK || !B64.test(f)) return null;
  return { id, i, k, d: f, name: String(d.n ?? 'A friend').slice(0, 20) };
}

/**
 * Puts a friend's frames back together. Only the newest frame counts: a
 * piece of an older one is dropped, and a newer frame abandons a half-heard
 * one (the next picture is a quarter of a second away anyway).
 */
export class FrameAssembler {
  private id = -1;
  private parts: (string | undefined)[] = [];
  private got = 0;
  /** The newest frame completed. */
  done = -1;

  push(p: FramePiece): string | null {
    if (p.id <= this.done) return null;
    if (p.id < this.id) return null;
    if (p.id > this.id || this.parts.length !== p.k) {
      this.id = p.id;
      this.parts = new Array(p.k);
      this.got = 0;
    }
    if (this.parts[p.i] === undefined) {
      this.parts[p.i] = p.d;
      this.got++;
    }
    if (this.got < p.k) return null;
    this.done = p.id;
    const out = this.parts.join('');
    this.parts = [];
    this.got = 0;
    return out;
  }

  reset() {
    this.id = this.done = -1;
    this.parts = [];
    this.got = 0;
  }
}

// --- Volume ---------------------------------------------------------------------------------

/**
 * The cabinet's SOUND button steps the volume: each press goes one step down,
 * and from mute back to full. The level is ours (a gain on the cabinet's
 * speaker); the game itself is kept at its own full volume, so its mute and
 * ours never disagree.
 */
export const VOLUME_STEPS = [1, 0.66, 0.33, 0] as const;
/** Where the level is kept, per device (an index into VOLUME_STEPS). */
export const VOLUME_KEY = 'palazzo-lago.lastmile.volume';
/** How long the screen shows the level after a press (s). */
export const VOLUME_SHOW = 1.6;

/** Whether a key is the game's sound key (the cabinet handles it; the game never sees it). */
export function isSoundKey(k: { key: string; code: string }): boolean {
  return k.code === KEYS.sound.code || k.key === 'm' || k.key === 'M';
}

export function nextVolume(step: number): number {
  return (step + 1) % VOLUME_STEPS.length;
}

export function volumeLevel(step: number): number {
  return VOLUME_STEPS[step] ?? 1;
}

/** The level as a whole percent (100, 66, 33, 0). */
export function volumePercent(step: number): number {
  return Math.round(volumeLevel(step) * 100);
}

/** Lit bars out of three: 3 at full, 0 muted. */
export function volumeBars(step: number): number {
  return VOLUME_STEPS.length - 1 - Math.min(VOLUME_STEPS.length - 1, Math.max(0, step));
}

/** The level as the screen shows it, e.g. "VOL ▮▮▯" or "VOL MUTE". */
export function volumeLabel(step: number): string {
  const n = volumeBars(step);
  return n ? `VOL ${'▮'.repeat(n)}${'▯'.repeat(VOLUME_STEPS.length - 1 - n)}` : 'VOL MUTE';
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The saved step (full if there's none, it's unreadable, or storage is blocked). */
export function loadVolume(store: Store | null = defaultStore()): number {
  try {
    const v = store?.getItem(VOLUME_KEY);
    if (v == null) return 0;
    const i = Number.parseInt(v, 10);
    return Number.isInteger(i) && i >= 0 && i < VOLUME_STEPS.length ? i : 0;
  } catch {
    return 0;
  }
}

export function saveVolume(step: number, store: Store | null = defaultStore()): void {
  try {
    store?.setItem(VOLUME_KEY, String(step));
  } catch {
    /* private window, blocked storage, quota: it just isn't remembered */
  }
}
