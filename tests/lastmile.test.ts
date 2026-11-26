import { describe, expect, it } from 'vitest';
import { LastMileHost } from '../src/client/arcade/lastmile/host';
import {
  ACTIVE_FOR,
  FrameQueue,
  forwardsKey,
  gestureKey,
  KEYS,
  LOAD_NEAR,
  FrameAssembler,
  nextQuality,
  NET_CHUNK,
  NET_CHUNKS,
  NET_MAX_B64,
  splitFrame,
  PadKeys,
  parseFrame,
  plan,
  RATE_ATTRACT,
  RATE_PLAY,
  RATE_PLAY_LIGHT,
  REPEAT_DELAY,
  REPEAT_EVERY,
  stickDir,
  Ticker,
  UNLOAD_FAR,
  isSoundKey,
  loadVolume,
  nextVolume,
  saveVolume,
  volumeBars,
  volumeLabel,
  volumeLevel,
  volumePercent,
  VOLUME_KEY,
  VOLUME_STEPS,
  type KeyStroke,
} from '../src/client/arcade/lastmile/logic';
import { ARCADE, ARCADE_SLOT_SPECS } from '../src/client/areas/promenadeplan';
import shipped from '../public/arcade/lastmile/index.html?raw';
import shippedLicense from '../public/arcade/lastmile/LICENSE?raw';

describe('The Last Mile: the rAF queue', () => {
  it('runs what was queued before the frame, with the timestamp; new requests wait for the next frame', () => {
    const q = new FrameQueue();
    const seen: string[] = [];
    // The game's loop: each frame asks for the next one first thing.
    const frame = (t: number) => {
      q.request(frame);
      seen.push(`f${t}`);
    };
    q.request(frame);
    expect(q.pending).toBe(1);
    expect(q.run(16)).toBe(1);
    expect(seen).toEqual(['f16']);
    expect(q.pending).toBe(1);
    q.run(32);
    q.run(48);
    expect(seen).toEqual(['f16', 'f32', 'f48']);
  });

  it('cancels, even a callback due later in the same frame; a throwing callback does not stop the others', () => {
    const q = new FrameQueue();
    const seen: number[] = [];
    let second = 0;
    q.request(() => {
      seen.push(1);
      q.cancel(second);
    });
    second = q.request(() => seen.push(2));
    q.request(() => {
      throw new Error('boom');
    });
    q.request(() => seen.push(4));
    const errs: unknown[] = [];
    expect(q.run(0, (e) => errs.push(e))).toBe(3);
    expect(seen).toEqual([1, 4]);
    expect(errs.length).toBe(1);
    const id = q.request(() => seen.push(5));
    q.cancel(id);
    expect(q.run(1)).toBe(0);
    expect(seen).toEqual([1, 4]);
  });
});

describe('The Last Mile: the host takes over the game window', () => {
  it("drives the game's requestAnimationFrame from tick(), with the game's own clock, and pins devicePixelRatio", () => {
    let now = 1000;
    const win: Record<string, unknown> = { performance: { now: () => now }, devicePixelRatio: 2, requestAnimationFrame: () => -1 };
    const host = new LastMileHost({ url: 'x', width: 960, height: 540 });
    host.attach(win as never);
    host.state = 'ready';
    const raf = win.requestAnimationFrame as (cb: (t: number) => void) => number;
    const ts: number[] = [];
    const frame = (t: number) => {
      raf(frame);
      ts.push(t);
    };
    raf(frame);
    expect(ts).toEqual([]);
    host.tick();
    now = 1016.5;
    host.tick();
    expect(ts).toEqual([1000, 1016.5]);
    expect(host.frameCount).toBe(2);
    expect(win.devicePixelRatio).toBe(1);
    // Cancelling through the game's own cancelAnimationFrame.
    const id = raf(() => ts.push(-1));
    (win.cancelAnimationFrame as (id: number) => void)(id);
    host.tick();
    expect(ts).not.toContain(-1);
  });

  it("gives the game the room's AudioContext: its destination is the cabinet's bus, and it can't suspend or close it", () => {
    const connected: unknown[] = [];
    const inlet = { connect: (n: unknown) => connected.push(n), disconnect() {} };
    let suspended = 0;
    const ctx = {
      state: 'running',
      currentTime: 3,
      destination: 'speakers',
      createGain() {
        return this === ctx ? inlet : null;
      },
      createOscillator() {
        // Bound to the real context (the proxy would break `this` otherwise).
        return this === ctx ? 'osc' : 'wrong-this';
      },
      suspend() {
        suspended++;
      },
    };
    const bus = { name: 'bus' };
    const win: Record<string, unknown> = { performance: { now: () => 0 } };
    const host = new LastMileHost({ url: 'x', width: 960, height: 540, audio: () => ({ ctx: ctx as never, out: bus as never }) });
    host.attach(win as never);
    const AC = win.AudioContext as new () => typeof ctx;
    expect(win.webkitAudioContext).toBe(AC);
    const ac = new AC();
    expect(ac.destination).toBe(inlet);
    expect(connected).toEqual([bus]);
    expect(ac.createOscillator()).toBe('osc');
    expect(ac.currentTime).toBe(3);
    expect(ac.state).toBe('running');
    void ac.suspend();
    expect(suspended).toBe(0);
  });
});

describe('The Last Mile: the SOUND button steps the volume', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)) };
  };

  it('each press steps 100 -> 66 -> 33 -> mute -> 100', () => {
    let step = 0;
    const seen = [volumePercent(step)];
    for (let i = 0; i < 4; i++) seen.push(volumePercent((step = nextVolume(step))));
    expect(seen).toEqual([100, 66, 33, 0, 100]);
    expect(VOLUME_STEPS.map((_, i) => volumeBars(i))).toEqual([3, 2, 1, 0]);
    expect(VOLUME_STEPS.map((_, i) => volumeLabel(i))).toEqual(['VOL ▮▮▮', 'VOL ▮▮▯', 'VOL ▮▯▯', 'VOL MUTE']);
    expect(volumeLevel(3)).toBe(0);
    expect(volumeLevel(0)).toBe(1);
  });

  it('remembers the step per device, and falls back to full on nothing, junk or blocked storage', () => {
    const s = memory();
    expect(loadVolume(s)).toBe(0);
    saveVolume(2, s);
    expect(s.m.get(VOLUME_KEY)).toBe('2');
    expect(loadVolume(s)).toBe(2);
    saveVolume(3, s);
    expect(loadVolume(s)).toBe(3);
    for (const junk of ['9', '-1', 'loud', '']) {
      s.m.set(VOLUME_KEY, junk);
      expect(loadVolume(s)).toBe(0);
    }
    const blocked = {
      getItem(): string | null {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem() {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    };
    expect(loadVolume(blocked)).toBe(0);
    expect(() => saveVolume(1, blocked)).not.toThrow();
    expect(loadVolume(null)).toBe(0);
  });

  it('SOUND is the M key, which the cabinet keeps from the game', () => {
    expect(isSoundKey(KEYS.sound)).toBe(true);
    expect(isSoundKey({ key: 'M', code: 'KeyM' })).toBe(true);
    expect(isSoundKey(KEYS.cross)).toBe(false);
    expect(isSoundKey(KEYS.up)).toBe(false);
  });

  it("keeps the game's own volume at full: clears its saved setting before it loads, and steps it back if it's down anyway", () => {
    const store = memory();
    store.m.set('lastmile.vol', '2');
    store.m.set('lastmile.mute', '1');
    const ls = { ...store, removeItem: (k: string) => void store.m.delete(k) };
    const win: Record<string, unknown> = { performance: { now: () => 0 }, localStorage: ls };
    const host = new LastMileHost({ url: 'x', width: 960, height: 540 });
    host.attach(win as never);
    expect(store.m.get('lastmile.vol')).toBe('0');
    expect(store.m.has('lastmile.mute')).toBe(false);
    // A game that came up muted regardless: onLoad steps it round to full.
    let vol = 2;
    win.AUDIO = { volIndex: () => vol, cycleVolume: () => (vol = (vol + 1) % 3) };
    (host as unknown as { unmuteGame(w: unknown): void }).unmuteGame(win);
    expect(vol).toBe(0);
    expect(host.gameVolume()).toBe(0);
    // No storage at all is fine too.
    expect(() => new LastMileHost({ url: 'x', width: 960, height: 540 }).attach({ performance: { now: () => 0 } } as never)).not.toThrow();
  });
});

describe('The Last Mile: keys', () => {
  it('reads an 8-way stick as four directions: the stronger axis, forward on a tie, with hysteresis', () => {
    expect(stickDir(0, 0, null)).toBe(null);
    expect(stickDir(0, 0.4, null)).toBe(null);
    expect(stickDir(0, 0.9, null)).toBe('up');
    expect(stickDir(0, -0.9, null)).toBe('down');
    expect(stickDir(0.9, 0.2, null)).toBe('right');
    expect(stickDir(-0.9, 0.2, null)).toBe('left');
    expect(stickDir(0.7, 0.7, null)).toBe('up');
    expect(stickDir(0.7, -0.7, null)).toBe('down');
    // Held: stays until it drops below the release point.
    expect(stickDir(0.1, 0.45, 'up')).toBe('up');
    expect(stickDir(0.1, 0.3, 'up')).toBe(null);
    // A diagonal you were already holding one way keeps that way.
    expect(stickDir(0.7, 0.7, 'right')).toBe('right');
  });

  it('turns the stick and buttons into keydown/keyup with auto-repeat, like a held arrow key', () => {
    const pk = new PadKeys();
    const out: KeyStroke[] = [];
    const step = (x: number, y: number, a = false, c = false, dt = 1 / 60) => {
      out.length = 0;
      pk.update({ x, y, a, c }, dt, out);
      return out.map((s) => `${s.type === 'keydown' ? '+' : '-'}${s.code}${s.repeat ? '*' : ''}`);
    };
    expect(step(0, 0)).toEqual([]);
    expect(step(0, 1)).toEqual(['+ArrowUp']);
    // Held: nothing until the repeat delay, then a repeat every REPEAT_EVERY.
    let repeats = 0,
      t = 0;
    while (t < REPEAT_DELAY + REPEAT_EVERY * 3 + 0.001) {
      t += 1 / 60;
      repeats += step(0, 1).filter((s) => s === '+ArrowUp*').length;
    }
    expect(repeats).toBe(4);
    // Straight to another direction: the old one goes up, the new one down.
    expect(step(1, 0)).toEqual(['-ArrowUp', '+ArrowRight']);
    expect(step(0, 0)).toEqual(['-ArrowRight']);
    expect(step(-1, 0)).toEqual(['+ArrowLeft']);
    expect(step(0, -1)).toEqual(['-ArrowLeft', '+ArrowDown']);
    expect(step(0, 0)).toEqual(['-ArrowDown']);
    // CROSS is Space, SOUND is M: press and release.
    expect(step(0, 0, true)).toEqual(['+Space']);
    expect(step(0, 0, true)).toEqual([]);
    expect(step(0, 0, false)).toEqual(['-Space']);
    expect(step(0, 0, false, true)).toEqual(['+KeyM']);
    expect(step(0, 0)).toEqual(['-KeyM']);
    // Letting go of everything at once.
    step(0, 1, true);
    out.length = 0;
    pk.release(out);
    expect(out.map((s) => s.type + s.code).sort()).toEqual(['keyupArrowUp', 'keyupSpace']);
  });

  it('sends the keys the game reads (e.key) for each action', () => {
    expect(KEYS.cross.key).toBe(' ');
    expect(KEYS.up.key).toBe('ArrowUp');
    expect(KEYS.sound.key).toBe('m');
  });

  it('a tap is CROSS, a swipe the arrow it points along', () => {
    expect(gestureKey(3, -4)).toBe(KEYS.cross);
    expect(gestureKey(0, -120)).toBe(KEYS.up);
    expect(gestureKey(0, 120)).toBe(KEYS.down);
    expect(gestureKey(-120, 30)).toBe(KEYS.left);
    expect(gestureKey(120, -30)).toBe(KEYS.right);
  });

  it('forwards game keys from a keyboard but keeps the ones that step away', () => {
    for (const c of ['ArrowUp', 'KeyW', 'KeyM', 'Space', 'Enter', 'KeyQ', 'Digit3']) expect(forwardsKey(c)).toBe(true);
    for (const c of ['Escape', 'Backspace', 'KeyE', 'Tab', 'F5', 'ShiftLeft']) expect(forwardsKey(c)).toBe(false);
  });
});

describe('The Last Mile: the stick moves him all four ways in the real game', () => {
  // The game's own keydown branches, read from the shipped copy: which e.key values make which move.
  const reads = (dir: string) => {
    const m = shipped.match(new RegExp(`if \\(([^)]*)\\)\\{ act\\("${dir}"\\); e\\.preventDefault\\(\\); \\}`));
    expect(m, `the game's keydown handler for "${dir}"`).not.toBeNull();
    return [...m![1].matchAll(/k==="([^"]+)"/g)].map((x) => x[1]);
  };
  const handler = { f: reads('f'), b: reads('b'), l: reads('l'), r: reads('r') };

  /** A pad held at (x, y) for `frames` frames at 72 Hz, then let go: the moves the game makes. */
  const moves = (pk: PadKeys, x: number, y: number, frames = 1) => {
    const out: KeyStroke[] = [];
    for (let i = 0; i < frames; i++) pk.update({ x, y, a: false, c: false }, 1 / 72, out);
    pk.update({ x: 0, y: 0, a: false, c: false }, 1 / 72, out);
    return out
      .filter((s) => s.type === 'keydown')
      .map((s) => (Object.keys(handler) as (keyof typeof handler)[]).find((d) => handler[d].includes(s.key)) ?? `?${s.key}`);
  };

  it('reads arrows (and WASD / Space) for the four moves', () => {
    expect(handler.r).toContain('ArrowRight');
    expect(handler.l).toContain('ArrowLeft');
    expect(handler.f).toEqual(expect.arrayContaining(['ArrowUp', ' ']));
    expect(handler.b).toContain('ArrowDown');
  });

  it('a push each way is one move that way, even a one-frame flick; diagonals go along the stronger axis', () => {
    const pk = new PadKeys();
    expect(moves(pk, 1, 0)).toEqual(['r']);
    expect(moves(pk, -1, 0)).toEqual(['l']);
    expect(moves(pk, 0, 1)).toEqual(['f']);
    expect(moves(pk, 0, -1)).toEqual(['b']);
    expect(moves(pk, 0.75, 0.7, 10)).toEqual(['r']);
    expect(moves(pk, 0.8, -0.6, 10)).toEqual(['r']);
    expect(moves(pk, -0.7, 0.7, 10)).toEqual(['f']);
    // A VR stick at partial tilt (past the 0.55 threshold) still counts.
    expect(moves(pk, 0.6, 0.1, 5)).toEqual(['r']);
    // Straight from left to right without passing through the middle.
    const out: KeyStroke[] = [];
    pk.update({ x: -1, y: 0, a: false, c: false }, 1 / 72, out);
    pk.update({ x: 1, y: 0, a: false, c: false }, 1 / 72, out);
    expect(out.filter((s) => s.type === 'keydown').map((s) => s.key)).toEqual(['ArrowLeft', 'ArrowRight']);
  });

  it('held right keeps stepping right (repeats are keydowns the game acts on)', () => {
    const pk = new PadKeys();
    const got = moves(pk, 1, 0, Math.round(72 * 1.2));
    expect(got.every((d) => d === 'r')).toBe(true);
    expect(got.length).toBe(1 + Math.floor((1.2 - REPEAT_DELAY) / REPEAT_EVERY) + 1);
  });
});

describe('The Last Mile: when it runs', () => {
  const base = { here: true, dist: 3, playing: false, loaded: false, friend: false, light: false };

  it('loads near, unloads far (with hysteresis), and never runs off the floor', () => {
    expect(plan({ ...base, dist: LOAD_NEAR + 1 }).load).toBe(false);
    expect(plan({ ...base, dist: LOAD_NEAR - 1 }).load).toBe(true);
    expect(plan({ ...base, dist: LOAD_NEAR + 1, loaded: true }).load).toBe(true);
    expect(plan({ ...base, dist: UNLOAD_FAR + 1, loaded: true }).load).toBe(false);
    expect(plan({ ...base, here: false, playing: true, loaded: true })).toEqual({ load: false, rate: 0 });
    // Playing keeps it, however far you wander (the game times out after ACTIVE_FOR without input).
    expect(plan({ ...base, dist: 30, playing: true, loaded: true }).load).toBe(true);
    expect(ACTIVE_FOR).toBeGreaterThan(5);
  });

  it('full rate while playing (lower on light tiers), attract rate when watching, nothing while a friend’s game is shown', () => {
    expect(plan({ ...base, playing: true }).rate).toBe(RATE_PLAY);
    expect(plan({ ...base, playing: true, light: true }).rate).toBe(RATE_PLAY_LIGHT);
    expect(plan(base).rate).toBe(RATE_ATTRACT);
    expect(plan({ ...base, friend: true }).rate).toBe(0);
    expect(RATE_ATTRACT).toBeLessThanOrEqual(10);
  });

  it('the ticker keeps the average rate at any display rate and never bursts to catch up', () => {
    for (const hz of [60, 72, 90, 120]) {
      const t = new Ticker();
      let n = 0;
      for (let i = 0; i < hz * 10; i++) if (t.due(1 / hz, 10)) n++;
      expect(n).toBeGreaterThanOrEqual(99);
      expect(n).toBeLessThanOrEqual(101);
      const full = new Ticker();
      let m = 0;
      for (let i = 0; i < hz * 10; i++) if (full.due(1 / hz, 60)) m++;
      expect(m).toBeLessThanOrEqual(Math.min(hz, 60) * 10 + 1);
      expect(m).toBeGreaterThanOrEqual(Math.min(hz, 60) * 10 - 2);
    }
    // A long hitch is one frame, not a burst.
    const t = new Ticker();
    expect(t.due(2, 10)).toBe(true);
    expect(t.due(0.001, 10)).toBe(false);
    expect(new Ticker().due(1, 0)).toBe(false);
  });
});

describe('The Last Mile: what friends see', () => {
  it('steers JPEG quality to fit the frame budget', () => {
    let q = 0.6;
    q = nextQuality(q, NET_MAX_B64 + 500);
    expect(q).toBeLessThan(0.6);
    expect(nextQuality(0.11, NET_MAX_B64 * 2)).toBeGreaterThanOrEqual(0.1);
    expect(nextQuality(0.4, 200)).toBeGreaterThan(0.4);
    expect(nextQuality(0.7, 200)).toBeLessThanOrEqual(0.7);
    expect(nextQuality(0.4, NET_MAX_B64 * 0.85)).toBe(0.4);
  });

  it('cuts a frame into packet-sized pieces and puts it back together, newest frame only', () => {
    const b64 = 'A'.repeat(NET_CHUNK) + 'B'.repeat(NET_CHUNK - 5);
    const parts = splitFrame(b64);
    expect(parts.length).toBe(NET_CHUNKS);
    expect(parts.every((p) => p.length <= NET_CHUNK)).toBe(true);
    const wire = (id: number, i: number, f: string) => parseFrame({ k: 'f', id, i, c: parts.length, f, n: 'Rocco' })!;
    const asm = new FrameAssembler();
    // Out of order, with a repeat.
    expect(asm.push(wire(1, 1, parts[1]))).toBe(null);
    expect(asm.push(wire(1, 1, parts[1]))).toBe(null);
    expect(asm.push(wire(1, 0, parts[0]))).toBe(b64);
    // Late pieces of a finished frame are ignored.
    expect(asm.push(wire(1, 0, parts[0]))).toBe(null);
    // A newer frame abandons a half-heard one; an older piece arriving late is dropped.
    expect(asm.push(wire(3, 0, parts[0]))).toBe(null);
    expect(asm.push(wire(2, 1, parts[1]))).toBe(null);
    expect(asm.push(wire(4, 0, 'CCCC'))).toBe(null);
    expect(asm.push(wire(4, 1, 'DDDD'))).toBe('CCCCDDDD');
  });

  it('checks pieces off the wire', () => {
    expect(parseFrame({ id: 0, i: 0, c: 1, f: '/9j/4AAQSkZJRg==', n: 'Rocco' })).toEqual({ id: 0, i: 0, k: 1, d: '/9j/4AAQSkZJRg==', name: 'Rocco' });
    expect(parseFrame({ id: 0, i: 0, c: 1, f: '' })).toBe(null);
    expect(parseFrame({ id: 0, i: 0, c: 1, f: 'not base64!' })).toBe(null);
    expect(parseFrame({ id: 0, i: 0, c: 1, f: 'A'.repeat(NET_CHUNK + 1) })).toBe(null);
    expect(parseFrame({ id: 0, i: 2, c: 2, f: 'AAAA' })).toBe(null);
    expect(parseFrame({ id: -1, i: 0, c: 1, f: 'AAAA' })).toBe(null);
    expect(parseFrame({ id: 0, i: 0, c: 99, f: 'AAAA' })).toBe(null);
    expect(parseFrame({ id: 0, i: 0, c: 1, f: 42 })).toBe(null);
    expect(parseFrame({ id: 0, i: 0, c: 1, f: 'AAAA', n: 'x'.repeat(50) })!.name.length).toBe(20);
  });

  it('a frame (two pieces) plus a VR player state fits the packet budget', () => {
    // Each piece rides in its own event; the outbox packs as many as fit in PACKET_BUDGET alongside the state.
    const ev = JSON.stringify({ n: 123456, k: 'arcF', d: { k: 'f', id: 99999, i: 1, c: 2, f: 'A'.repeat(NET_CHUNK), n: 'A Long Player Name', g: 'lastmile' } });
    expect(ev.length).toBeLessThan(2000);
  });
});

describe('The Last Mile: the bay and the shipped copy', () => {
  it('has a featured bay in the arcade', () => {
    // The Last Mile's is the feature bay that isn't the racing cabinet's (ON THE RUN has the other).
    const f = ARCADE_SLOT_SPECS.filter((s) => s.kind === 'feature' && !/rac(ing|er)/i.test(s.id + ' ' + s.hint));
    expect(f.length).toBe(1);
    expect(f[0].x).toBeGreaterThan(ARCADE.x0);
    expect(f[0].x).toBeLessThan(ARCADE.x1);
    expect(f[0].footprint[0]).toBeGreaterThan(1.3);
  });

  it('ships the game with the cabinet hook and without the third-party clips', () => {
    const html = shipped;
    const hook = html.indexOf('__lastMileHook');
    expect(hook).toBeGreaterThan(0);
    // Before the game's own script.
    expect(hook).toBeLessThan(html.indexOf('"use strict"'));
    for (const k of ['FREE', 'WOAH', 'KEN', 'RING']) expect(html).toMatch(new RegExp(`var ${k}_B64 = "";`));
    expect(html).toContain('requestAnimationFrame(frame)');
    expect(shippedLicense).toMatch(/MIT License[\s\S]*Christopher G\. Hunt/);
  });
});
