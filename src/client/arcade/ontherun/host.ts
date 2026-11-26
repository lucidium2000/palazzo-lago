import { HudSnap } from './hudsnap';
import { LAYOUT_H, LAYOUT_W, VirtualPad, type Gfx, type KeyStroke } from './logic';
import { installShim, type Shim, type ShimAudio } from './shim';

/**
 * Runs On the Run (a three.js WebGL game with an HTML HUD) inside the 3D room.
 *
 * The same technique as The Last Mile's cabinet (lastmile/host.ts): the game
 * is the real page in a hidden same-origin iframe, laid out off screen at
 * 1280x720 CSS pixels; its first script hands its window to
 * window.__onTheRunHook here before the game's own scripts run, and
 * installShim (shim.ts) takes over its requestAnimationFrame,
 * devicePixelRatio, controllers and audio. The cabinet then runs it frame by
 * frame from the room's loop.
 *
 * Its pictures: the WebGL canvas is uploaded straight to the cabinet's screen
 * texture (three.js texImage2D's the iframe's canvas) in the same task as the
 * game's frame callback, while its drawing buffer still holds the frame, so
 * no preserveDrawingBuffer is needed (it would cost a copy every frame on a
 * tiled mobile GPU). Its HTML HUD and menus are a second, slower picture
 * (hudsnap.ts) laid over it.
 *
 * Quality: the 3D renders at Gfx.scale of 1280x720 (devicePixelRatio), and on
 * the lighter tiers the cabinet turns off the game's shadow maps, bloom and
 * MSAA through window.__otrGfx (exposed by the sync script).
 */

type GameWindow = Window &
  typeof globalThis & {
    __otrGfx?: {
      renderer: { shadowMap: { enabled: boolean; needsUpdate?: boolean }; info?: { render: { calls: number; triangles: number } } };
      composer: { renderTarget1: { samples: number; dispose(): void }; renderTarget2: { samples: number; dispose(): void } };
      bloom: { enabled: boolean };
    };
    __reps?: number;
  };

export interface OtrHostOpts {
  url: string;
  gfx: Gfx;
  audio?: () => ShimAudio | null;
  onError?: (e: unknown) => void;
}

/** The game's fonts (sync-ontherun.mjs vendors them): file, family, weight. */
export const FONT_FILES: readonly [string, string, number][] = [
  ['chakra-petch-latin-400-normal.woff2', 'Chakra Petch', 400],
  ['chakra-petch-latin-600-normal.woff2', 'Chakra Petch', 600],
  ['chakra-petch-latin-700-normal.woff2', 'Chakra Petch', 700],
  ['russo-one-latin-400-normal.woff2', 'Russo One', 400],
];

const live = new Set<OnTheRunHost>();
function installHook() {
  const w = window as unknown as { __onTheRunHook?: (win: Window) => void };
  w.__onTheRunHook ??= (win: Window) => {
    for (const h of live) if (h.iframe?.contentWindow === win) h.attach(win as GameWindow);
  };
}

export interface HostStats {
  /** Game frames run since load. */
  frames: number;
  /** Mean ms of the game's own frame callbacks (main thread), over the last 60. */
  tickMs: number;
  /** Worst of the last 60. */
  tickMax: number;
}

export class OnTheRunHost {
  iframe: HTMLIFrameElement | null = null;
  private win: GameWindow | null = null;
  private shim: Shim | null = null;
  state: 'off' | 'loading' | 'ready' | 'failed' = 'off';
  /** The game's WebGL canvas (once loaded). */
  canvas: HTMLCanvasElement | null = null;
  /** The two controllers the game can see (player 1 and 2); `plugged` says which are connected. */
  readonly pads = [new VirtualPad(0), new VirtualPad(1)];
  plugged = [false, false];
  readonly hud: HudSnap;
  loadedAt = 0;
  readonly stats: HostStats = { frames: 0, tickMs: 0, tickMax: 0 };
  private times: number[] = [];

  constructor(readonly o: OtrHostOpts) {
    this.hud = new HudSnap(Math.round(LAYOUT_W * 0.75), Math.round(LAYOUT_H * 0.75), LAYOUT_W, LAYOUT_H);
  }

  get loaded() {
    return this.state === 'loading' || this.state === 'ready';
  }

  load() {
    if (this.iframe) return;
    installHook();
    live.add(this);
    const f = document.createElement('iframe');
    f.title = 'On the Run (arcade cabinet)';
    f.setAttribute('aria-hidden', 'true');
    f.setAttribute('allow', 'autoplay');
    f.tabIndex = -1;
    f.style.cssText = `position:fixed;left:-${LAYOUT_W + 4000}px;top:0;width:${LAYOUT_W}px;height:${LAYOUT_H}px;border:0;pointer-events:none;`;
    f.addEventListener('load', () => this.onLoad());
    f.src = this.o.url;
    this.iframe = f;
    this.state = 'loading';
    this.stats.frames = 0;
    this.loadedAt = performance.now();
    document.body.appendChild(f);
  }

  unload() {
    live.delete(this);
    if (this.shim?.inlet) {
      try {
        this.shim.inlet.disconnect();
      } catch {
        /* gone */
      }
    }
    this.shim = null;
    this.hud.detach();
    if (this.iframe) {
      try {
        // Pause its <audio> first (a routed element keeps its source node until it's collected).
        for (const a of this.iframe.contentDocument?.querySelectorAll('audio') ?? []) (a as HTMLAudioElement).pause();
      } catch {
        /* gone */
      }
      try {
        this.iframe.src = 'about:blank';
      } catch {
        /* ignore */
      }
      this.iframe.remove();
    }
    this.iframe = null;
    this.win = null;
    this.canvas = null;
    this.state = 'off';
  }

  /** The hook: the game's window, before its scripts run. */
  attach(w: GameWindow) {
    if (this.win === w) return;
    this.win = w;
    this.shim = installShim(w, {
      dpr: this.o.gfx.scale,
      pads: () => this.pads.map((p, i) => (this.plugged[i] ? p : null)),
      audio: this.o.audio ?? null,
    });
  }

  /** While loading: ready as soon as the game's renderer exists (its load event waits for every sound it preloads). */
  poll() {
    if (this.state !== 'loading' || !this.win) return;
    try {
      if (this.win.__otrGfx && this.win.document.querySelector('#stage canvas')) this.onLoad();
    } catch {
      /* not yet */
    }
  }

  private onLoad() {
    if (this.state === 'ready') return;
    let w: GameWindow | null = null;
    try {
      w = (this.iframe?.contentWindow as GameWindow | null) ?? null;
    } catch {
      w = null;
    }
    const c = w?.document?.querySelector('#stage canvas') as HTMLCanvasElement | null | undefined;
    if (!w || !c) {
      // The module script may not have run yet (it's deferred): try again shortly.
      if (w && this.state === 'loading' && performance.now() - this.loadedAt < 30000) {
        setTimeout(() => this.iframe && this.onLoad(), 250);
        return;
      }
      this.state = 'failed';
      return;
    }
    if (this.win !== w) this.attach(w);
    this.canvas = c;
    this.applyGfx();
    this.hud.attach(w.document, new URL('fonts/', w.location.href).href, FONT_FILES);
    this.state = 'ready';
  }

  /** The lighter tiers: no shadow maps, bloom or MSAA in the game. */
  private applyGfx() {
    const g = this.win?.__otrGfx;
    if (!g) return;
    const q = this.o.gfx;
    try {
      if (!q.shadows) g.renderer.shadowMap.enabled = false;
      if (!q.bloom) g.bloom.enabled = false;
      if (!q.msaa) {
        for (const rt of [g.composer.renderTarget1, g.composer.renderTarget2]) {
          rt.samples = 0;
          rt.dispose();
        }
      }
    } catch (e) {
      this.o.onError?.(e);
    }
  }

  /** Run one game frame (its queued rAF callbacks). Copy the canvas in the same task, right after. */
  tick(): number {
    const w = this.win;
    if (!w || this.state !== 'ready' || !this.shim) return 0;
    let now = 0;
    try {
      now = w.performance.now();
    } catch {
      return 0;
    }
    for (let i = 0; i < 2; i++) if (this.plugged[i]) this.pads[i].timestamp = now;
    const t0 = performance.now();
    const n = this.shim.frames.run(now, this.o.onError);
    if (n) {
      this.stats.frames++;
      const ms = performance.now() - t0;
      this.times.push(ms);
      if (this.times.length > 60) this.times.shift();
      let s = 0,
        m = 0;
      for (const t of this.times) {
        s += t;
        m = Math.max(m, t);
      }
      this.stats.tickMs = s / this.times.length;
      this.stats.tickMax = m;
    }
    return n;
  }

  /** Send a key to the game (the window's keydown / keyup listeners). */
  key(k: KeyStroke) {
    const w = this.win;
    if (!w || this.state !== 'ready') return;
    try {
      const E = w.KeyboardEvent;
      w.document.dispatchEvent(new E(k.type, { key: k.key, code: k.code, repeat: k.repeat, bubbles: true, cancelable: true }));
    } catch (e) {
      this.o.onError?.(e);
    }
  }

  /** <audio> elements routed into the cabinet's speaker so far. */
  get mediaRouted() {
    return this.shim?.media ?? 0;
  }

  /** Draw calls of the game's last frame (for the dev harness). */
  get drawCalls(): number {
    try {
      return this.win?.__otrGfx?.renderer.info?.render.calls ?? 0;
    } catch {
      return 0;
    }
  }

  /** Runs `fn` with the game's window (tests and the dev harness). */
  peek<T>(fn: (w: GameWindow) => T): T | null {
    try {
      return this.win ? fn(this.win) : null;
    } catch {
      return null;
    }
  }
}
