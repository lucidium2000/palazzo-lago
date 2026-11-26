import { describe, expect, it, vi } from 'vitest';
import {
  BTN,
  blankState,
  cssForSvg,
  DASH,
  forwardsKey,
  frozenDelay,
  GAME_DEAD,
  gfxFor,
  isSoundKey,
  loadVolume,
  nextVolume,
  padActive,
  padList,
  plan,
  RATE_ATTRACT,
  RATE_PLAY,
  RATE_PLAY_LIGHT,
  rimAngle,
  saveVolume,
  seatToPad,
  touchToPad,
  VirtualPad,
  volumeLevel,
  VOLUME_KEY,
  Wheel,
  WHEEL_DEAD,
  WHEEL_LOCK,
  wheelToSteer,
  type XRPadLike,
} from '../src/client/arcade/ontherun/logic';
import { installShim } from '../src/client/arcade/ontherun/shim';
// @ts-expect-error: plain ES module (the sync script's patches)
import { addonImports, patchGame, stripWrapper, threeVersion } from '../scripts/ontherun-patch.mjs';
import { ARCADE, ARCADE_SLOT_SPECS } from '../src/client/areas/promenadeplan';
import shipped from '../public/arcade/ontherun/index.html?raw';

// Every file shipped next to the game (paths only; nothing is loaded).
const SHIPPED = new Set(Object.keys(import.meta.glob('../public/arcade/ontherun/**/*.{js,css,woff2,mp3,txt}')).map((k) => k.replace('../public/arcade/ontherun/', '')));
const existsSync = (rel: string) => SHIPPED.has(rel.replace(/^\.\//, ''));

const deg = (d: number) => (d * Math.PI) / 180;

describe('On the Run: the wheel', () => {
  it('maps the wheel angle to analogue steering: centre is straight, lock is full, past the game’s own dead zone', () => {
    expect(wheelToSteer(0)).toBe(0);
    expect(wheelToSteer(WHEEL_DEAD * 0.9)).toBe(0);
    expect(wheelToSteer(WHEEL_LOCK)).toBeCloseTo(1);
    expect(wheelToSteer(-WHEEL_LOCK)).toBeCloseTo(-1);
    expect(wheelToSteer(WHEEL_LOCK * 2)).toBeCloseTo(1);
    // Just past ours, already past the game's 0.14 (so the car turns as soon as the wheel does).
    expect(wheelToSteer(deg(3))).toBeGreaterThan(GAME_DEAD);
    // Monotonic and symmetric.
    let prev = 0;
    for (let a = 0; a <= WHEEL_LOCK; a += 0.05) {
      const s = wheelToSteer(a);
      expect(s).toBeGreaterThanOrEqual(prev);
      expect(wheelToSteer(-a)).toBeCloseTo(-s);
      prev = s;
    }
  });

  it('reads where a hand is round the rim, clockwise from 12 o’clock', () => {
    expect(rimAngle(0, 1)).toBeCloseTo(0);
    expect(rimAngle(1, 0)).toBeCloseTo(Math.PI / 2);
    expect(rimAngle(-1, 0)).toBeCloseTo(-Math.PI / 2);
  });

  it('turns with one hand, with two (their average), clamps at the lock and springs back when let go', () => {
    const w = new Wheel();
    w.grab('r', deg(90));
    w.move('r', deg(120));
    expect(w.angle).toBeCloseTo(deg(30));
    // Round past the bottom of the wheel: no jump from +180 to -180.
    w.move('r', deg(170));
    w.move('r', deg(-170));
    expect(w.angle).toBeCloseTo(deg(100));
    w.move('r', deg(-100));
    expect(w.angle).toBeCloseTo(WHEEL_LOCK);
    w.release('r');
    expect(w.held).toBe(false);
    for (let i = 0; i < 60; i++) w.update(1 / 60);
    expect(Math.abs(w.angle)).toBeLessThan(0.01);
    // Both hands: one turns, one stays: half the turn.
    w.grab('l', deg(-90));
    w.grab('r', deg(90));
    w.move('r', deg(130));
    expect(w.angle).toBeCloseTo(deg(20));
    w.move('l', deg(-50));
    expect(w.angle).toBeCloseTo(deg(40));
    // One lets go: the other carries on from where the wheel is.
    w.release('l');
    w.move('r', deg(140));
    expect(w.angle).toBeCloseTo(deg(50));
    // Held, it doesn't centre itself.
    w.update(1);
    expect(w.angle).toBeCloseTo(deg(50));
  });
});

const xr = (buttons: number[], axes = [0, 0, 0, 0]): XRPadLike => ({ buttons: buttons.map((v) => ({ value: v, pressed: v > 0.5 })), axes });

describe('On the Run: the virtual controller', () => {
  it('looks like a connected standard pad and passes rumble to the cabinet', () => {
    const p = new VirtualPad(0);
    expect(p.connected).toBe(true);
    expect(p.mapping).toBe('standard');
    expect(p.buttons.length).toBe(17);
    const s = blankState();
    s.axes[0] = -0.5;
    s.buttons[BTN.RT] = 0.3;
    s.buttons[BTN.A] = 1;
    s.buttons[BTN.B] = 0.4;
    p.set(s, 123);
    expect(p.axes[0]).toBe(-0.5);
    expect(p.buttons[BTN.RT]).toEqual({ pressed: true, touched: true, value: 0.3 });
    expect(p.buttons[BTN.A].pressed).toBe(true);
    expect(p.buttons[BTN.B].pressed).toBe(false);
    expect(p.timestamp).toBe(123);
    const r = vi.fn();
    p.rumble = r;
    void p.vibrationActuator.playEffect('dual-rumble', { duration: 120, strongMagnitude: 0.8, weakMagnitude: 0.2 });
    expect(r).toHaveBeenCalledWith(0.8, 0.2, 120);
    expect(padList([p, null])).toEqual([p, null, null, null]);
  });

  it('drives from the VR controllers while the wheel is held: triggers are gas and brake, the face buttons boost and weapons', () => {
    const right = xr([0.8, 0, 0, 1, 1, 0]); // trigger, squeeze, -, stick click, A, B
    const left = xr([0.5, 0, 0, 0, 0, 1], [0, 0, 0.5, -0.6]); // trigger, ..., Y; stick pushed
    const out = seatToPad({ steer: 0.4, wheelHeld: true, right, left, dash: DASH.map(() => false), racing: true }, blankState());
    expect(out.buttons[BTN.RT]).toBeCloseTo(0.8);
    expect(out.buttons[BTN.LT]).toBeCloseTo(0.5);
    expect(out.buttons[BTN.B]).toBe(1); // A: boost
    expect(out.buttons[BTN.RB]).toBe(0); // B (not pressed): guns
    expect(out.buttons[BTN.A]).toBe(1); // Y: jump
    expect(out.buttons[BTN.X]).toBe(1); // right stick click: drift
    // In the menus the face buttons are the game's own: A is OK.
    const menu = seatToPad({ steer: 0, wheelHeld: true, right, left, dash: DASH.map(() => false), racing: false }, blankState());
    expect(menu.buttons[BTN.A]).toBe(1);
    expect(menu.buttons[BTN.B]).toBe(0);
    expect(menu.buttons[BTN.Y]).toBe(1);
    // The left stick adds to the wheel and pitches.
    expect(out.axes[0]).toBeCloseTo(0.9);
    expect(out.axes[1]).toBeCloseTo(-0.6);
    // Hands off the wheel: the controllers are yours again (no gas), the dashboard still works.
    const off = seatToPad({ steer: 0, wheelHeld: false, right, left, dash: DASH.map((d) => d === 'BOOST' || d === 'START') }, blankState());
    expect(off.buttons[BTN.RT]).toBe(0);
    expect(off.buttons[BTN.B]).toBe(1);
    expect(off.buttons[BTN.START]).toBe(1);
    expect(padActive(off)).toBe(true);
    expect(padActive(blankState())).toBe(false);
    // Tracked hands on the wheel: no triggers, so the gas stays down.
    const hands = seatToPad({ steer: -0.3, wheelHeld: true, right: null, left: null, dash: DASH.map(() => false), autoGas: true }, blankState());
    expect(hands.buttons[BTN.RT]).toBe(1);
    expect(hands.axes[0]).toBeCloseTo(-0.3);
  });

  it('drives from a phone’s thumb stick: x steers, up is gas, down is brake', () => {
    const o = touchToPad({ x: 0.6, y: 0.9, a: false, b: true, c: false }, blankState());
    expect(o.axes[0]).toBeCloseTo(0.6);
    expect(o.buttons[BTN.RT]).toBeCloseTo(0.9);
    expect(o.buttons[BTN.LT]).toBe(0);
    expect(o.buttons[BTN.B]).toBe(1);
    const b = touchToPad({ x: 0, y: -1, a: true, b: false, c: true }, blankState());
    expect(b.buttons[BTN.LT]).toBe(1);
    expect(b.buttons[BTN.A]).toBe(1);
    expect(b.buttons[BTN.RB]).toBe(1);
  });

  it('forwards the game’s keys from a keyboard, keeps M for the cabinet and Esc to leave', () => {
    for (const k of ['ArrowUp', 'KeyW', 'Space', 'ShiftLeft', 'KeyC', 'KeyJ', 'KeyR', 'KeyF', 'Enter', 'F2', 'Period']) expect(forwardsKey(k)).toBe(true);
    for (const k of ['Escape', 'Backspace', 'KeyE', 'Tab', 'F5']) expect(forwardsKey(k)).toBe(false);
    expect(isSoundKey({ key: 'm', code: 'KeyM' })).toBe(true);
    expect(isSoundKey({ key: 'n', code: 'KeyN' })).toBe(false);
  });
});

describe('On the Run: sound', () => {
  it('steps the volume 100 → 66 → 33 → 0 → 100 and remembers it per device', () => {
    let s = 0;
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      seen.push(Math.round(volumeLevel(s) * 100));
      s = nextVolume(s);
    }
    expect(seen).toEqual([100, 66, 33, 0, 100]);
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(loadVolume(store)).toBe(0);
    saveVolume(2, store);
    expect(m.get(VOLUME_KEY)).toBe('2');
    expect(loadVolume(store)).toBe(2);
    m.set(VOLUME_KEY, 'junk');
    expect(loadVolume(store)).toBe(0);
    expect(loadVolume(null)).toBe(0);
    // Its own key (The Last Mile keeps its own).
    expect(VOLUME_KEY).toMatch(/ontherun/);
  });
});

describe('On the Run: when it runs, and how well', () => {
  it('loads near, runs at full rate playing (30 on light tiers), 10 fps attract, nothing far away or off the floor', () => {
    expect(plan({ here: false, dist: 1, playing: true, loaded: true, friend: false, light: false })).toEqual({ load: false, rate: 0, hud: 0 });
    expect(plan({ here: true, dist: 20, playing: false, loaded: false, friend: false, light: false }).load).toBe(false);
    expect(plan({ here: true, dist: 5, playing: false, loaded: false, friend: false, light: false }).rate).toBe(RATE_ATTRACT);
    expect(plan({ here: true, dist: 11, playing: false, loaded: true, friend: false, light: false }).load).toBe(true);
    expect(plan({ here: true, dist: 11, playing: false, loaded: false, friend: false, light: false }).load).toBe(false);
    expect(plan({ here: true, dist: 1, playing: true, loaded: true, friend: false, light: false }).rate).toBe(RATE_PLAY);
    expect(plan({ here: true, dist: 1, playing: true, loaded: true, friend: false, light: true }).rate).toBe(RATE_PLAY_LIGHT);
    expect(plan({ here: true, dist: 3, playing: false, loaded: true, friend: true, light: false }).rate).toBe(0);
  });

  it('renders smaller and plainer on the lighter headsets', () => {
    expect(gfxFor('quest2')).toEqual({ scale: 0.5, shadows: false, bloom: false, msaa: false });
    expect(gfxFor('mobile').scale).toBe(0.5);
    expect(gfxFor('quest3').scale).toBe(0.75);
    expect(gfxFor('desktop')).toEqual({ scale: 1, shadows: true, bloom: true, msaa: true });
  });

  it('freezes CSS animations where the live page has them (HUD snapshot)', () => {
    expect(frozenDelay(0, 1500)).toBeCloseTo(-1.5);
    expect(frozenDelay(500, 200)).toBeCloseTo(0.3);
    expect(cssForSvg('a>b{content:"<&>"}')).toBe('a>b{content:"\\3c \\26 >"}');
  });
});

describe('On the Run: the shim in the game’s window', () => {
  const fakeWindow = () => {
    const routed: unknown[] = [];
    const ctx = {
      destination: { real: true },
      createGain: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
      createMediaElementSource: (el: unknown) => ({ connect: () => routed.push(el) }),
      decodeAudioData: () => Promise.resolve({}),
      suspend: vi.fn(() => Promise.resolve()),
      currentTime: 4,
    };
    class RealAudio {
      src: string;
      constructor(src = '') {
        this.src = src;
      }
    }
    const w: Record<string, unknown> = {
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {},
      devicePixelRatio: 2,
      matchMedia: (q: string) => ({ matches: true, media: q }),
      navigator: { getGamepads: () => [] },
      Audio: RealAudio,
      Element: class {},
    };
    return { w, ctx, routed, RealAudio };
  };

  it('takes over requestAnimationFrame, the pixel ratio, touch detection and the controllers', () => {
    const { w } = fakeWindow();
    const pad = new VirtualPad(0);
    let on = false;
    const shim = installShim(w, { dpr: 0.5, pads: () => [on ? pad : null, null] });
    const ran: number[] = [];
    const rAF = w.requestAnimationFrame as (cb: (t: number) => void) => number;
    rAF((t) => ran.push(t));
    const id = rAF(() => ran.push(-1));
    (w.cancelAnimationFrame as (id: number) => void)(id);
    expect(ran).toEqual([]);
    expect(shim.frames.run(16)).toBe(1);
    expect(ran).toEqual([16]);
    expect(w.devicePixelRatio).toBe(0.5);
    const mm = w.matchMedia as (q: string) => { matches: boolean };
    expect(mm('(pointer: coarse)').matches).toBe(false);
    expect(mm('(hover: none)').matches).toBe(false);
    expect(mm('(prefers-reduced-motion: reduce)').matches).toBe(true);
    const gp = (w.navigator as { getGamepads(): unknown[] }).getGamepads;
    expect(gp()).toEqual([null, null, null, null]);
    on = true;
    expect(gp()[0]).toBe(pad);
  });

  it('gives the game the room’s audio: its destination is the cabinet’s speaker, it can’t suspend it, and <audio> is routed there too', () => {
    const { w, ctx, routed, RealAudio } = fakeWindow();
    const out = { speaker: true };
    const shim = installShim(w, { dpr: 1, pads: () => [], audio: () => ({ ctx: ctx as unknown as AudioContext, out: out as unknown as AudioNode }) });
    const AC = w.AudioContext as new () => typeof ctx;
    const a = new AC();
    expect(a.destination).toBe(shim.inlet);
    expect(a.destination).not.toBe(ctx.destination);
    void (a as unknown as { suspend(): Promise<void> }).suspend();
    expect(ctx.suspend).not.toHaveBeenCalled();
    expect(a.currentTime).toBe(4);
    const A = w.Audio as new (src: string) => InstanceType<typeof RealAudio>;
    const el = new A('snd/TitleTheme.mp3');
    expect(el).toBeInstanceOf(RealAudio);
    expect(el.src).toBe('snd/TitleTheme.mp3');
    expect(routed).toEqual([el]);
    expect(shim.media).toBe(1);
  });
});

describe('On the Run: the sync script’s patches', () => {
  const GAME = [
    '<!doctype html><meta charset="utf-8"><title>On the Run</title>',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link href="https://fonts.googleapis.com/css2?family=Russo+One&display=swap" rel="stylesheet">',
    '<div id="stage"></div>',
    '<script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js", "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/" } }</script>',
    "<script type=\"module\">import * as THREE from 'three'; import { X } from 'three/addons/postprocessing/EffectComposer.js';",
    "$('stage').appendChild(renderer.domElement);",
    'composer.addPass(gradePass);',
    'const C = window.AudioContext || window.webkitAudioContext;',
    "addEventListener('keydown', e => {}); navigator.getGamepads();",
    'function frame(now) {\n  requestAnimationFrame(frame);\n}</script>',
  ].join('\n');

  it('strips the artifact viewer’s wrapper', () => {
    const wrapped = `<!doctype html><html><head><meta charset=utf8><style>body{background:#fff}</style></head><body>\n${GAME}\n</body></html>`;
    const { html, stripped } = stripWrapper(wrapped);
    expect(stripped).toBe(true);
    expect(html.startsWith('<!doctype html><meta charset="utf-8">')).toBe(true);
    expect(html).not.toContain('background:#fff');
    expect(html.trimEnd().endsWith('</script>')).toBe(true);
    expect(stripWrapper(GAME)).toEqual({ html: GAME, stripped: false });
  });

  it('adds the hook first, vendors three.js and the fonts, and exposes the renderer', () => {
    expect(threeVersion(GAME)).toBe('0.160.0');
    expect(addonImports(GAME)).toEqual(['postprocessing/EffectComposer.js']);
    const { html, done } = patchGame(GAME, { vendor: 'vendor/three-0.160.0', fonts: 'fonts/fonts.css' });
    expect(done).toEqual(['hook', 'three', 'fonts', 'gfx']);
    expect(html.indexOf('__onTheRunHook')).toBeLessThan(html.indexOf('<script type="importmap">'));
    expect(html).toContain('"three": "./vendor/three-0.160.0/three.module.min.js"');
    expect(html).toContain('"three/addons/": "./vendor/three-0.160.0/addons/"');
    expect(html).toContain('href="./fonts/fonts.css"');
    expect(html).not.toMatch(/googleapis|gstatic|jsdelivr/);
    expect(html).toContain('window.__otrGfx = { renderer, composer, bloom');
    // Run twice on its own output: refused (sync from the game, not the copy).
    expect(() => patchGame(html, { vendor: 'v', fonts: 'f' })).toThrow();
    // A game that changed shape: refused loudly.
    expect(() => patchGame(GAME.replace('requestAnimationFrame(frame)', 'setTimeout(frame)'), { vendor: 'v', fonts: 'f' })).toThrow(/requestAnimationFrame/);
  });
});

describe('On the Run: the bay and the shipped copy', () => {
  it('has a racing bay in the arcade, against the back wall, facing in', () => {
    const r = ARCADE_SLOT_SPECS.filter((s) => /rac(ing|er)/i.test(s.id + ' ' + s.hint));
    expect(r.length).toBe(1);
    expect(r[0].kind).toBe('feature');
    expect(r[0].footprint[0]).toBeGreaterThan(2);
    expect(r[0].z + r[0].footprint[1] / 2).toBeLessThanOrEqual(ARCADE.z1 + 1e-6);
    expect(Math.cos(r[0].yaw)).toBeCloseTo(-1);
  });

  it('ships the patched game with three.js, its fonts and its sounds, all same-origin', () => {
    const html = shipped;
    expect(html.startsWith('<!doctype html><meta charset="utf-8">')).toBe(true);
    expect(html.indexOf('__onTheRunHook')).toBeLessThan(html.indexOf('<script type="module">'));
    expect(html).not.toMatch(/https:\/\/(fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr)/);
    const m = /"three": "\.\/([^"]+)"/.exec(html)!;
    expect(existsSync(m[1])).toBe(true);
    const addons = /"three\/addons\/": "\.\/([^"]+)"/.exec(html)![1];
    for (const a of addonImports(html)) expect(existsSync(addons + a)).toBe(true);
    expect(existsSync('fonts/fonts.css')).toBe(true);
    expect(existsSync('fonts/OFL-RussoOne.txt')).toBe(true);
    // The sounds it preloads by name, and the music it plays by path.
    const pre = /OTR_SND = Object\.fromEntries\(\[([^\]]*)\]/.exec(html)![1];
    const sounds = new Set([...pre.matchAll(/"([A-Za-z0-9_]+)"/g)].map((x) => x[1]));
    for (const x of html.matchAll(/snd\/([A-Za-z0-9_]+)\.mp3/g)) sounds.add(x[1]);
    expect(sounds.size).toBeGreaterThan(30);
    for (const s of sounds) expect(existsSync(`snd/${s}.mp3`)).toBe(true);
  });
});
