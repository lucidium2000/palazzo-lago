/**
 * The pure parts of the ON THE RUN cabinet (no DOM, no three.js, so the tests
 * run them in Node): the steering wheel you grab in VR and how its angle
 * becomes the game's analogue steering, the virtual Xbox-style controller the
 * cabinet hands the game (it reads controllers with navigator.getGamepads),
 * how VR controllers, a phone's thumb stick and the dashboard buttons map
 * onto it, the SOUND button's volume steps, when the game runs and how often
 * its screen and HUD are copied, and frozen CSS animation times for the HUD
 * snapshot.
 *
 * The frame queue, the run-rate ticker and the friends' picture wire format
 * are The Last Mile's (lastmile/logic.ts): the same technique, proven there.
 */

export { FrameQueue, Ticker, FrameAssembler, nextQuality, parseFrame, splitFrame, type KeyStroke, NET_EVERY, NET_H, NET_RANGE, NET_W } from '../lastmile/logic';

// --- The wheel ------------------------------------------------------------------------------

/** Lock to lock: the wheel turns this far each way (rad, 135 degrees, an arcade wheel's throw). */
export const WHEEL_LOCK = (135 * Math.PI) / 180;
/** No steering inside this (rad, about 2 degrees), so resting hands don't drift the car. */
export const WHEEL_DEAD = (2 * Math.PI) / 180;
/** The game's own stick dead zone (it ignores |x| < 0.14): the wheel starts steering just past it. */
export const GAME_DEAD = 0.14;
/** How fast the wheel centres itself when you let go (1/s). */
export const WHEEL_RETURN = 7;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/**
 * The game's stick value for a wheel angle (rad, + = clockwise = right).
 * Linear over the wheel's throw, and lifted past the game's own dead zone so
 * the first few degrees past ours already turn the car (the game then applies
 * its curve, |x|^1.35, like it does for a real controller's stick).
 */
export function wheelToSteer(angle: number, lock = WHEEL_LOCK): number {
  const a = Math.abs(angle);
  if (a <= WHEEL_DEAD) return 0;
  const k = clamp((a - WHEEL_DEAD) / (lock - WHEEL_DEAD), 0, 1);
  return Math.sign(angle) * (GAME_DEAD + (1 - GAME_DEAD) * k);
}

/**
 * Where a hand is on the wheel's face: the angle (rad) of its position in the
 * wheel's plane, measured clockwise from 12 o'clock as the driver sees it
 * (x right, y up in the wheel's own frame).
 */
export function rimAngle(x: number, y: number): number {
  return Math.atan2(x, y);
}

/**
 * A steering wheel held by up to two hands. Each hand remembers where on the
 * rim it took hold and the wheel's angle then; the wheel turns by how far the
 * hands have gone round since (both hands: the average), clamped to the lock.
 * Let go and it springs back to centre.
 */
export class Wheel {
  angle = 0;
  private holds = new Map<string, { at: number; from: number; last: number; turns: number }>();

  get held() {
    return this.holds.size > 0;
  }

  get hands() {
    return this.holds.size;
  }

  holding(id: string) {
    return this.holds.has(id);
  }

  /** A hand takes the rim at `phi` (rimAngle). */
  grab(id: string, phi: number) {
    // A second hand joins at the wheel's current angle (re-base the first so the two agree).
    for (const h of this.holds.values()) {
      h.at = h.last;
      h.turns = 0;
      h.from = this.angle;
    }
    this.holds.set(id, { at: phi, from: this.angle, last: phi, turns: 0 });
  }

  /** The hand is now at `phi`. */
  move(id: string, phi: number) {
    const h = this.holds.get(id);
    if (!h) return;
    // Unwrap across the bottom of the wheel (a hand can go further round than half a turn).
    h.turns += wrap(phi - h.last);
    h.last = phi;
    let sum = 0;
    for (const x of this.holds.values()) sum += x.from + x.turns;
    this.angle = clamp(sum / this.holds.size, -WHEEL_LOCK, WHEEL_LOCK);
  }

  release(id: string) {
    this.holds.delete(id);
    for (const h of this.holds.values()) {
      h.at = h.last;
      h.turns = 0;
      h.from = this.angle;
    }
  }

  /** Self-centring while nobody holds it. */
  update(dt: number) {
    if (this.holds.size) return;
    this.angle *= Math.exp(-WHEEL_RETURN * dt);
    if (Math.abs(this.angle) < 1e-3) this.angle = 0;
  }

  /** Keys or a stick turn it (screens): the wheel shows the steering. */
  show(steer: number, dt: number) {
    if (this.holds.size) return;
    const target = steer * WHEEL_LOCK * 0.6;
    this.angle += (target - this.angle) * Math.min(1, dt * 10);
  }

  reset() {
    this.holds.clear();
    this.angle = 0;
  }
}

// --- The virtual controller -----------------------------------------------------------------

/** Standard-mapping button indices (the game's Xbox layout). */
export const BTN = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  L3: 10,
  R3: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
  HOME: 16,
} as const;
export const N_BUTTONS = 17;

/**
 * What the game does with each button (its own controller layout): RT gas, LT
 * brake (hold when stopped to reverse), left stick steer, A jump / OK, B boost
 * / back, X drift, Y oil or smoke, RB guns, LB missile (hold to lock, let go
 * to fire), L3 horn, D-pad up camera, Start pause.
 */

/** One controller's state as the cabinet sets it: axes (left x, left y, right x, right y) and button values 0..1. */
export interface PadState {
  axes: number[];
  buttons: number[];
}

export function blankState(): PadState {
  return { axes: [0, 0, 0, 0], buttons: new Array(N_BUTTONS).fill(0) };
}

export function clearState(s: PadState): PadState {
  s.axes.fill(0);
  s.buttons.fill(0);
  return s;
}

/** A button object as the Gamepad API has them. */
export interface VButton {
  pressed: boolean;
  touched: boolean;
  value: number;
}

/**
 * A Gamepad the game can read: it looks like a connected standard-mapping
 * controller. `rumble` gets the game's rumble requests (the cabinet turns them
 * into haptic pulses on the hands holding the wheel).
 */
export class VirtualPad {
  readonly id: string;
  readonly mapping = 'standard';
  readonly connected = true;
  readonly axes: number[] = [0, 0, 0, 0];
  readonly buttons: VButton[] = Array.from({ length: N_BUTTONS }, () => ({ pressed: false, touched: false, value: 0 }));
  timestamp = 0;
  readonly hapticActuators: unknown[] = [];
  readonly vibrationActuator: { type: string; playEffect(type: string, p: { duration?: number; strongMagnitude?: number; weakMagnitude?: number }): Promise<string>; reset(): Promise<string> };
  rumble: ((strong: number, weak: number, ms: number) => void) | null = null;

  constructor(readonly index: number) {
    this.id = `Palazzo Lago racing cabinet ${index + 1} (STANDARD GAMEPAD)`;
    this.vibrationActuator = {
      type: 'dual-rumble',
      playEffect: (_t, p) => {
        this.rumble?.(Number(p?.strongMagnitude) || 0, Number(p?.weakMagnitude) || 0, Number(p?.duration) || 0);
        return Promise.resolve('complete');
      },
      reset: () => Promise.resolve('complete'),
    };
  }

  /** Copies a state in (the game polls these every frame). */
  set(s: PadState, now: number) {
    for (let i = 0; i < 4; i++) this.axes[i] = clamp(s.axes[i] || 0, -1, 1);
    for (let i = 0; i < N_BUTTONS; i++) {
      const v = clamp(s.buttons[i] || 0, 0, 1);
      const b = this.buttons[i];
      b.value = v;
      // Triggers count as pressed past a light squeeze, like a real controller.
      b.pressed = v > (i === BTN.LT || i === BTN.RT ? 0.1 : 0.5);
      b.touched = v > 0;
    }
    this.timestamp = now;
  }
}

/** The controllers the game sees: the virtual pads that are plugged in, padded to the usual four slots. */
export function padList(pads: readonly (VirtualPad | null)[]): (VirtualPad | null)[] {
  const out: (VirtualPad | null)[] = [null, null, null, null];
  pads.forEach((p, i) => {
    if (p && i < 4) out[i] = p;
  });
  return out;
}

// --- Mapping the cabinet's controls onto the pad --------------------------------------------

/** The parts of a WebXR controller the cabinet reads (xr-standard mapping). */
export interface XRPadLike {
  buttons: readonly { pressed: boolean; value: number }[];
  axes: readonly number[];
}

/** The dashboard's push buttons, in order. */
export const DASH = ['START', 'VIEW', 'BOOST', 'FIRE', 'MISSILE', 'JUMP', 'SOUND'] as const;
export type DashButton = (typeof DASH)[number];
/** Which pad button each dashboard button holds (SOUND is the cabinet's own). */
export const DASH_TO_BTN: Record<DashButton, number> = { START: BTN.START, VIEW: BTN.UP, BOOST: BTN.B, FIRE: BTN.RB, MISSILE: BTN.LB, JUMP: BTN.A, SOUND: -1 };

export interface SeatInput {
  /** Steering from the wheel (-1..1, already through wheelToSteer). */
  steer: number;
  /** Someone's hands are on the wheel (VR): the controllers drive. */
  wheelHeld: boolean;
  /** The VR controllers (null: none, or hand tracking). */
  right: XRPadLike | null;
  left: XRPadLike | null;
  /** Dashboard buttons held (by a fingertip, or a click on a screen), index as DASH. */
  dash: readonly boolean[];
  /** Tracked hands on the wheel and no controllers: the gas stays down (there are no triggers to squeeze). */
  autoGas?: boolean;
  /** The game is mid-race (the face buttons are the wheel's boost and weapons; in menus they're A / B / X / Y). */
  racing?: boolean;
}

const btn = (p: XRPadLike | null, i: number) => (p?.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0);
const axis = (p: XRPadLike | null, i: number) => {
  if (!p) return 0;
  // xr-standard: the thumbstick is axes 2, 3 (0, 1 are the touchpad, absent on Quest).
  const v = p.axes.length >= 4 ? p.axes[i + 2] : (p.axes[i] ?? 0);
  return Math.abs(v) < 0.12 ? 0 : v;
};

/**
 * VR in the cockpit, hands on the wheel: the controllers become the game's
 * controller. Right trigger gas, left trigger brake. While racing, the face
 * buttons are the wheel's buttons: A boost, B guns, X missile (hold to lock,
 * let go to fire), Y jump; right stick click drifts, left stick click drops
 * oil / smoke. In the menus they are the game's own A (OK), B (back), X, Y,
 * and turning the wheel picks. The left stick adds steering and pitches the
 * car in the air, the right stick looks round. The dashboard buttons work
 * with or without the wheel. Writes `out`.
 */
export function seatToPad(i: SeatInput, out: PadState): PadState {
  clearState(out);
  const { right: r, left: l } = i;
  let steer = i.steer;
  if (i.wheelHeld) {
    steer = clamp(steer + axis(l, 0), -1, 1);
    out.axes[1] = axis(l, 1);
    out.axes[2] = axis(r, 0);
    out.axes[3] = axis(r, 1);
    out.buttons[BTN.RT] = btn(r, 0);
    out.buttons[BTN.LT] = btn(l, 0);
    if (i.autoGas && !r && !l) out.buttons[BTN.RT] = 1;
    if (i.racing) {
      out.buttons[BTN.B] = btn(r, 4);
      out.buttons[BTN.RB] = btn(r, 5);
      out.buttons[BTN.LB] = btn(l, 4);
      out.buttons[BTN.A] = btn(l, 5);
      out.buttons[BTN.X] = btn(r, 3);
      out.buttons[BTN.Y] = btn(l, 3);
    } else {
      out.buttons[BTN.A] = btn(r, 4);
      out.buttons[BTN.B] = btn(r, 5);
      out.buttons[BTN.X] = btn(l, 4);
      out.buttons[BTN.Y] = btn(l, 5);
    }
  }
  out.axes[0] = steer;
  // The wheel turned hard is a D-pad flick in the menus (the garage reads the stick too).
  i.dash.forEach((on, k) => {
    const b = DASH_TO_BTN[DASH[k]];
    if (on && b >= 0) out.buttons[b] = 1;
  });
  return out;
}

/**
 * A phone at the cabinet: the arcade's thumb stick steers (x) and drives (up
 * is gas, down is brake), its three buttons are A (jump, OK), B (boost, back)
 * and the guns.
 */
export function touchToPad(p: { x: number; y: number; a: boolean; b: boolean; c: boolean }, out: PadState): PadState {
  clearState(out);
  out.axes[0] = Math.abs(p.x) < 0.1 ? 0 : clamp(p.x, -1, 1);
  out.buttons[BTN.RT] = p.y > 0.15 ? clamp(p.y, 0, 1) : 0;
  out.buttons[BTN.LT] = p.y < -0.15 ? clamp(-p.y, 0, 1) : 0;
  out.buttons[BTN.A] = p.a ? 1 : 0;
  out.buttons[BTN.B] = p.b ? 1 : 0;
  out.buttons[BTN.RB] = p.c ? 1 : 0;
  return out;
}

/** Any input at all on the pad (it counts as playing). */
export function padActive(s: PadState): boolean {
  if (Math.abs(s.axes[0]) > 0.05 || Math.abs(s.axes[1]) > 0.2 || Math.abs(s.axes[2]) > 0.2 || Math.abs(s.axes[3]) > 0.2) return true;
  return s.buttons.some((v) => v > 0.05);
}

/** Real keys forwarded from a keyboard while you're at the cabinet (Escape / Backspace / E still step away). */
export function forwardsKey(code: string): boolean {
  if (code === 'Escape' || code === 'Backspace' || code === 'KeyE') return false;
  return /^(Arrow(Up|Down|Left|Right)|Key[A-Z]|Digit[0-9]|Space|Enter|NumpadEnter|Shift(Left|Right)|Control(Left|Right)|Period|Comma|Semicolon|Quote|Slash|Backslash|Bracket(Left|Right)|F2)$/.test(code);
}

// --- Sound ----------------------------------------------------------------------------------

/**
 * The SOUND button steps the cabinet's own level (a gain on its speaker),
 * 100 -> 66 -> 33 -> 0 -> 100, like The Last Mile's (the steps, the badge and
 * the on-screen level are shared); the game itself stays at its own volume.
 * Kept per device under its own key.
 */
export { VOLUME_STEPS, VOLUME_SHOW, nextVolume, volumeBars, volumeLabel, volumeLevel, volumePercent } from '../lastmile/logic';
export const VOLUME_KEY = 'palazzo-lago.ontherun.volume';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The saved step (0, full, if there's none, it's unreadable, or storage is blocked). */
export function loadVolume(store: Store | null = defaultStore()): number {
  try {
    const v = store?.getItem(VOLUME_KEY);
    if (v == null) return 0;
    const i = Number.parseInt(v, 10);
    return Number.isInteger(i) && i >= 0 && i < 4 ? i : 0;
  } catch {
    return 0;
  }
}

export function saveVolume(step: number, store: Store | null = defaultStore()): void {
  try {
    store?.setItem(VOLUME_KEY, String(step));
  } catch {
    /* private window, blocked storage: it just isn't remembered */
  }
}

/** The game's own sound key (M): the cabinet's SOUND, never sent to the game. */
export const isSoundKey = (k: { key: string; code: string }) => k.code === 'KeyM' || k.key === 'm' || k.key === 'M';

// --- When it runs ---------------------------------------------------------------------------

/** Load the game when you come this near (m); unload it past UNLOAD_FAR when nobody's playing. */
export const LOAD_NEAR = 9;
export const UNLOAD_FAR = 13;
/** Game frames (and screen copies) a second: playing (full / light tiers), the attract screen. */
export const RATE_PLAY = 60;
export const RATE_PLAY_LIGHT = 30;
export const RATE_ATTRACT = 10;
/** HUD snapshots a second (the game's HUD and menus are HTML, drawn separately): playing, light tiers, attract. */
export const HUD_PLAY = 10;
export const HUD_PLAY_LIGHT = 6;
export const HUD_ATTRACT = 3;
/** Seconds after your last input that the game still counts as yours. */
export const ACTIVE_FOR = 8;

export interface PlanIn {
  here: boolean;
  dist: number;
  playing: boolean;
  loaded: boolean;
  /** Friends' games are on both screens (ours needn't run). */
  friend: boolean;
  light: boolean;
}

export interface Plan {
  load: boolean;
  /** Game frames a second (0: paused). */
  rate: number;
  /** HUD snapshots a second. */
  hud: number;
}

/**
 * The game (a whole second WebGL renderer) only runs while someone's driving: it loads when you sit
 * down, and goes when you get out (after ACTIVE_FOR). Walking past, the screen shows the cabinet's
 * own attract card, so nobody near the arcade pays for it.
 */
export function plan(i: PlanIn): Plan {
  if (!i.here || !i.playing) return { load: false, rate: 0, hud: 0 };
  return { load: true, rate: i.light ? RATE_PLAY_LIGHT : RATE_PLAY, hud: i.light ? HUD_PLAY_LIGHT : HUD_PLAY };
}

/** The game's picture size and quality for a tier: its CSS layout stays 1280x720 (the HUD's size), the 3D renders at `scale` of it. */
export interface Gfx {
  scale: number;
  shadows: boolean;
  bloom: boolean;
  msaa: boolean;
}

export const LAYOUT_W = 1280;
export const LAYOUT_H = 720;

export function gfxFor(tier: string | undefined): Gfx {
  if (tier === 'quest2' || tier === 'mobile') return { scale: 0.5, shadows: false, bloom: false, msaa: false };
  // Quest 3: a second renderer inside the casino's own frame; keep it light (the cabinet screen is under a metre wide).
  if (tier === 'quest3') return { scale: 0.55, shadows: false, bloom: false, msaa: false };
  return { scale: 1, shadows: true, bloom: true, msaa: true };
}

// --- The HUD snapshot -----------------------------------------------------------------------

/**
 * A CSS animation's delay for a frozen copy of the page that starts at time
 * 0: the copy shows the animation exactly where the live page has it (delay
 * and current time in ms; the answer in seconds, usually negative).
 */
export function frozenDelay(delayMs: number, currentTimeMs: number): number {
  return (delayMs - currentTimeMs) / 1000;
}

/** CSS text safe inside an XHTML <style> in an SVG: no '<' or '&' (CSS escapes instead; '>' is fine in XML text and is a selector combinator). */
export function cssForSvg(css: string): string {
  return css.replace(/&/g, '\\26 ').replace(/</g, '\\3c ');
}
