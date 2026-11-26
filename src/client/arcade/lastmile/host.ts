import { FrameQueue, type KeyStroke } from './logic';

/**
 * Runs The Last Mile (a self-contained canvas-2D web game) inside the 3D room.
 *
 * WebXR can't show DOM, so the game lives in a hidden same-origin iframe and
 * its canvas is copied onto the cabinet's screen texture. The iframe sits off
 * screen at the game's 16:9 size (laid out, so the game sizes its canvas from
 * innerWidth/innerHeight like it does in a browser window; `display:none`
 * would give it no size).
 *
 * The copy of the game carries a one-line hook (scripts/sync-lastmile.mjs)
 * that calls `window.__lastMileHook(window)` in the parent before the game's
 * own script runs. The host then:
 *   - replaces the iframe's requestAnimationFrame / cancelAnimationFrame with
 *     a queue the cabinet drains from the room's frame loop (the page's rAF
 *     stops during an immersive WebXR session, and off-screen iframes get
 *     throttled), passing the iframe's own performance.now() as the timestamp
 *     (the game measures frame deltas from it);
 *   - pins devicePixelRatio to 1 so the canvas is exactly the iframe's size;
 *   - optionally gives the game the room's AudioContext (through a proxy
 *     whose `destination` is a gain feeding a positional panner at the
 *     cabinet, and whose suspend/close do nothing), so its sounds come from
 *     the cabinet and unlock with the room's audio.
 * Keys go in as synthetic KeyboardEvents on the iframe's document (the game
 * listens for keydown on its window).
 *
 * The game is always kept at its own full volume: it remembers a volume
 * (FULL / LOW / MUTED, cycled by M) in localStorage, and the cabinet's level
 * is a gain of its own, so the host clears the game's setting before its
 * script reads it (and the cabinet never sends it M).
 */

type GameWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: unknown;
    G?: { state?: number; row?: number; col?: number; saver?: boolean } | null;
    ST_PLAY?: number;
    AUDIO?: { volIndex?: () => number; cycleVolume?: () => number } | null;
  };

/** The game's own volume setting (an index: 0 is full), which it keeps in localStorage. */
const GAME_VOL_KEY = 'lastmile.vol';
const GAME_MUTE_KEY = 'lastmile.mute';

export interface HostAudio {
  ctx: AudioContext;
  /** Where the game's sound goes (the cabinet's panner bus). */
  out: AudioNode;
}

export interface HostOpts {
  url: string;
  width: number;
  height: number;
  /** The room's audio to play the game through (null: the game keeps its own AudioContext, plain stereo). */
  audio?: () => HostAudio | null;
  /** Something in the game threw while the cabinet was running a frame. */
  onError?: (e: unknown) => void;
}

const live = new Set<LastMileHost>();
function installHook() {
  const w = window as unknown as { __lastMileHook?: (win: Window) => void };
  w.__lastMileHook ??= (win: Window) => {
    for (const h of live) if (h.iframe?.contentWindow === win) h.attach(win as GameWindow);
  };
}

export class LastMileHost {
  iframe: HTMLIFrameElement | null = null;
  private win: GameWindow | null = null;
  private frames = new FrameQueue();
  private inlet: GainNode | null = null;
  private methods = new Map<PropertyKey, unknown>();
  state: 'off' | 'loading' | 'ready' | 'failed' = 'off';
  /** The game's canvas (once loaded). */
  canvas: HTMLCanvasElement | null = null;
  /** Game frames run since load (tests and the dev harness read this). */
  frameCount = 0;
  loadedAt = 0;

  constructor(readonly o: HostOpts) {}

  get loaded() {
    return this.state === 'loading' || this.state === 'ready';
  }

  load() {
    if (this.iframe) return;
    installHook();
    live.add(this);
    const f = document.createElement('iframe');
    f.title = 'The Last Mile (arcade cabinet)';
    f.setAttribute('aria-hidden', 'true');
    f.tabIndex = -1;
    f.style.cssText = `position:fixed;left:-${this.o.width + 4000}px;top:0;width:${this.o.width}px;height:${this.o.height}px;border:0;pointer-events:none;contain:strict;`;
    f.addEventListener('load', () => this.onLoad());
    f.src = this.o.url;
    this.iframe = f;
    this.state = 'loading';
    this.frameCount = 0;
    this.loadedAt = performance.now();
    document.body.appendChild(f);
  }

  unload() {
    live.delete(this);
    if (this.inlet) {
      try {
        this.inlet.disconnect();
      } catch {
        /* already gone */
      }
      this.inlet = null;
    }
    this.methods.clear();
    if (this.iframe) {
      // Navigate away first so the game's timers and audio graph are torn down promptly.
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
    this.frames = new FrameQueue();
    this.state = 'off';
  }

  /** The hook: the game's window, before its script runs. */
  attach(w: GameWindow) {
    if (this.win === w) return;
    this.win = w;
    const q = (this.frames = new FrameQueue());
    w.requestAnimationFrame = ((cb: FrameRequestCallback) => q.request(cb)) as typeof w.requestAnimationFrame;
    w.cancelAnimationFrame = ((id: number) => q.cancel(id)) as typeof w.cancelAnimationFrame;
    try {
      Object.defineProperty(w, 'devicePixelRatio', { get: () => 1, configurable: true });
    } catch {
      /* the game caps it at 1.5 anyway */
    }
    // Before its script reads it: the game's own volume is full (the cabinet does the volume).
    try {
      w.localStorage.setItem(GAME_VOL_KEY, '0');
      w.localStorage.removeItem(GAME_MUTE_KEY);
    } catch {
      /* no storage: the game starts at full anyway */
    }
    const audio = this.o.audio?.();
    if (audio) {
      const host = this;
      // `new AudioContext()` in the game gets the room's context (a constructor that returns an object hands that object back).
      const Make = function () {
        return host.audioProxy(audio);
      };
      (w as unknown as { AudioContext: unknown }).AudioContext = Make;
      w.webkitAudioContext = Make;
    }
  }

  private audioProxy(a: HostAudio): AudioContext {
    if (!this.inlet) {
      this.inlet = a.ctx.createGain();
      this.inlet.connect(a.out);
    }
    const inlet = this.inlet;
    const methods = this.methods;
    const decode = (buf: ArrayBuffer, ok?: DecodeSuccessCallback, err?: DecodeErrorCallback) => {
      const p = a.ctx.decodeAudioData(buf, ok, err);
      p.catch(() => {});
      return p;
    };
    return new Proxy(a.ctx, {
      get(t, k) {
        if (k === 'destination') return inlet;
        // The game suspends its context when the page hides; the room's must keep playing.
        if (k === 'suspend' || k === 'close') return () => Promise.resolve();
        // The game handles a clip that won't decode in its callback; keep the promise from also reporting it as unhandled.
        if (k === 'decodeAudioData') return decode;
        const v = Reflect.get(t, k, t) as unknown;
        if (typeof v !== 'function') return v;
        let b = methods.get(k);
        if (!b) methods.set(k, (b = (v as (...a: unknown[]) => unknown).bind(t)));
        return b;
      },
      set(t, k, v) {
        return Reflect.set(t, k, v, t);
      },
    });
  }

  private onLoad() {
    const f = this.iframe;
    let w: GameWindow | null = null;
    try {
      w = (f?.contentWindow as GameWindow | null) ?? null;
    } catch {
      w = null;
    }
    const c = w?.document?.getElementById('c') as HTMLCanvasElement | null | undefined;
    if (!w || !c) {
      this.state = 'failed';
      return;
    }
    // A copy without the hook: take over now (the game asks for its next frame through the global each time).
    if (this.win !== w) this.attach(w);
    this.unmuteGame(w);
    this.canvas = c;
    this.state = 'ready';
  }

  /** If the game came up below full volume anyway (an old setting it read before the hook), step it back to full. */
  private unmuteGame(w: GameWindow) {
    try {
      const A = w.AUDIO;
      if (!A?.volIndex || !A.cycleVolume) return;
      for (let i = 0; i < 4 && A.volIndex() !== 0; i++) A.cycleVolume();
    } catch {
      /* its sound is its own business if it won't say */
    }
  }

  /** The game's own volume step (0 is full), or null if it isn't running. */
  gameVolume(): number | null {
    try {
      const v = this.win?.AUDIO?.volIndex?.();
      return typeof v === 'number' ? v : null;
    } catch {
      return null;
    }
  }

  /** Run one game frame (its queued rAF callbacks). */
  tick(): number {
    const w = this.win;
    if (!w || this.state !== 'ready') return 0;
    let now = 0;
    try {
      now = w.performance.now();
    } catch {
      return 0;
    }
    const n = this.frames.run(now, this.o.onError);
    if (n) this.frameCount++;
    return n;
  }

  /** Send a key to the game. */
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

  /** Copy the game's picture onto a 2D context (scaled to fill w x h). */
  copyTo(g: CanvasRenderingContext2D, w: number, h: number): boolean {
    const c = this.canvas;
    if (!c || !c.width || !c.height) return false;
    try {
      g.drawImage(c, 0, 0, c.width, c.height, 0, 0, w, h);
      return true;
    } catch {
      return false;
    }
  }

  /** The game's state, read from its globals (null until it's running). */
  game(): { state: number; playing: boolean; row: number; col: number; saver: boolean } | null {
    const w = this.win;
    if (!w || this.state !== 'ready') return null;
    try {
      const G = w.G;
      if (!G) return null;
      return { state: Number(G.state), playing: G.state === w.ST_PLAY, row: Number(G.row), col: Number(G.col), saver: !!G.saver };
    } catch {
      return null;
    }
  }
}
