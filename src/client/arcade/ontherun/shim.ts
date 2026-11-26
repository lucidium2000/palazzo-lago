import { FrameQueue, padList, type VirtualPad } from './logic';

/**
 * What the cabinet changes in the game's window, before the game's own
 * scripts run (the page's first script calls window.parent.__onTheRunHook,
 * see scripts/ontherun-patch.mjs). No three.js here and nothing beyond what
 * a window has, so tests install it on a plain object.
 *
 *  - requestAnimationFrame / cancelAnimationFrame: a queue the cabinet drains
 *    from the room's own frame loop (the page's rAF stops during an immersive
 *    WebXR session, and an off-screen iframe's gets throttled anyway). The
 *    timestamp is the game window's own performance.now(), which the game
 *    also reads directly, so its clock stays consistent.
 *  - devicePixelRatio: the render scale (the game sizes its WebGL canvas as
 *    innerWidth x innerHeight x min(devicePixelRatio, 1.5)), so its HTML HUD
 *    lays out at 1280x720 while its 3D renders at 640x360 to 1280x720.
 *  - matchMedia('(pointer: coarse)') and friends answer "no": on a phone the
 *    game would otherwise switch to its own touch layout inside the hidden
 *    frame. The cabinet's controls stand in for touch.
 *  - navigator.getGamepads: the cabinet's virtual controllers (the wheel,
 *    triggers and buttons arrive as an Xbox-style pad, analogue steering
 *    included). Real controllers aren't passed through.
 *  - AudioContext: the room's context, through a proxy whose destination is
 *    the cabinet's speaker and whose suspend / close do nothing (the room's
 *    audio must keep playing); Audio (its music, radio and voice lines are
 *    <audio> elements) is routed into the same speaker with a
 *    MediaElementSource, so everything comes out of the cabinet.
 *  - requestFullscreen: a no-op (the game asks on a tap).
 */

export interface ShimAudio {
  ctx: AudioContext;
  /** Where the game's sound goes (the cabinet's speaker bus). */
  out: AudioNode;
}

export interface ShimOpts {
  /** The 3D render scale (devicePixelRatio the game sees). */
  dpr: number;
  pads: () => readonly (VirtualPad | null)[];
  audio?: (() => ShimAudio | null) | null;
}

export interface Shim {
  frames: FrameQueue;
  /** The gain the game's sound goes into (once it made a sound). */
  inlet: GainNode | null;
  /** <audio> elements routed into the speaker. */
  media: number;
  dispose(): void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyWin = any;

const COARSE = /\(\s*(pointer|any-pointer)\s*:\s*coarse\s*\)|\(\s*(hover|any-hover)\s*:\s*none\s*\)/;

export function installShim(w: AnyWin, o: ShimOpts): Shim {
  const frames = new FrameQueue();
  const shim: Shim = { frames, inlet: null, media: 0, dispose: () => {} };
  w.requestAnimationFrame = (cb: FrameRequestCallback) => frames.request(cb);
  w.cancelAnimationFrame = (id: number) => frames.cancel(id);
  try {
    Object.defineProperty(w, 'devicePixelRatio', { get: () => o.dpr, configurable: true });
  } catch {
    /* the canvas is just bigger */
  }
  const mm = typeof w.matchMedia === 'function' ? w.matchMedia.bind(w) : null;
  w.matchMedia = (q: string) => {
    if (COARSE.test(q)) return { matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false };
    return mm ? mm(q) : { matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false };
  };
  const nav = w.navigator;
  if (nav) {
    const get = () => padList(o.pads());
    try {
      Object.defineProperty(nav, 'getGamepads', { value: get, configurable: true, writable: true });
    } catch {
      nav.getGamepads = get;
    }
  }
  try {
    const El = w.Element?.prototype;
    if (El) El.requestFullscreen = () => Promise.resolve();
  } catch {
    /* fine */
  }

  const audio = o.audio?.();
  if (audio) {
    const methods = new Map<PropertyKey, unknown>();
    const inlet = () => {
      if (!shim.inlet) {
        shim.inlet = audio.ctx.createGain();
        shim.inlet.connect(audio.out);
      }
      return shim.inlet;
    };
    const decode = (buf: ArrayBuffer, ok?: DecodeSuccessCallback, err?: DecodeErrorCallback) => {
      const p = audio.ctx.decodeAudioData(buf, ok, err);
      p.catch(() => {});
      return p;
    };
    const proxy = new Proxy(audio.ctx, {
      get(t, k) {
        if (k === 'destination') return inlet();
        if (k === 'suspend' || k === 'close') return () => Promise.resolve();
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
    // `new AudioContext()` hands back the proxy (a constructor that returns an object returns that object).
    const Make = function () {
      return proxy;
    };
    w.AudioContext = Make;
    w.webkitAudioContext = Make;
    // <audio> elements: the same element, its output taken into the speaker.
    const RealAudio = w.Audio;
    if (typeof RealAudio === 'function') {
      const route = (el: HTMLMediaElement) => {
        try {
          audio.ctx.createMediaElementSource(el).connect(inlet());
          shim.media++;
        } catch {
          /* already routed, or not routable: it plays on its own */
        }
        return el;
      };
      const A = function (src?: string) {
        return route(src === undefined ? new RealAudio() : new RealAudio(src));
      };
      A.prototype = RealAudio.prototype;
      w.Audio = A;
    }
  }
  return shim;
}
