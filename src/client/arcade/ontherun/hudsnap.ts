import { cssForSvg, frozenDelay } from './logic';

/**
 * On the Run draws its 3D on a WebGL canvas, but its HUD (speedometer, bars,
 * score, minimap frame), its menus (title, garage, armory, stage map,
 * briefings) and its loading screen are HTML over the canvas. WebXR can't
 * show HTML, so the cabinet takes a picture of that layer now and then and
 * lays it over the game's 3D on the cabinet screen.
 *
 * The picture: the game's visible HTML (scripts, hidden overlays and the
 * WebGL stage left out) and its stylesheets, with its fonts inlined, as an
 * SVG <foreignObject> in a data: URL, drawn onto a transparent canvas. A
 * data: URL keeps the canvas clean in Chromium (a blob: URL, or
 * createImageBitmap, would taint it); where the browser taints it anyway the
 * HUD is switched off and the 3D still shows. Running CSS animations are
 * frozen where the live page has them (each animated element gets a
 * temporary attribute and a negative animation-delay rule), and the game's
 * other on-page canvases (the minimap) are drawn over the picture at their
 * place. One picture is in flight at a time.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyDoc = any;

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META']);

export interface SnapStats {
  /** Pictures drawn. */
  count: number;
  /** Last serialise time (ms, main thread). */
  serMs: number;
  /** Last draw time (ms, main thread: drawImage rasterises the SVG). */
  drawMs: number;
  /** Size of the last SVG (characters). */
  bytes: number;
}

export class HudSnap {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private img: HTMLImageElement | null = null;
  private busy = false;
  private fontCss = '';
  private fontsLoading = false;
  private css = '';
  private cssKey = '';
  private dirty = true;
  private observer: MutationObserver | null = null;
  private doc: AnyDoc = null;
  /** The browser tainted the picture: no HUD from here on. */
  broken = false;
  readonly stats: SnapStats = { count: 0, serMs: 0, drawMs: 0, bytes: 0 };
  /** A new picture is on the canvas (the cabinet uploads it). */
  onDraw: (() => void) | null = null;

  constructor(
    readonly w: number,
    readonly h: number,
    /** The page's layout size (the picture is scaled to w x h). */
    readonly lw: number,
    readonly lh: number,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.g = this.canvas.getContext('2d')!;
  }

  /** Watch a (new) game document. */
  attach(doc: AnyDoc, fontsBase: string, fontFiles: readonly [string, string, number][]) {
    this.detach();
    this.doc = doc;
    this.dirty = true;
    this.cssKey = '';
    try {
      const MO = doc.defaultView?.MutationObserver ?? MutationObserver;
      this.observer = new MO(() => (this.dirty = true));
      this.observer!.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    } catch {
      this.observer = null;
    }
    if (!this.fontCss && !this.fontsLoading) void this.loadFonts(fontsBase, fontFiles);
  }

  detach() {
    this.observer?.disconnect();
    this.observer = null;
    this.doc = null;
    this.g.clearRect(0, 0, this.w, this.h);
  }

  private async loadFonts(base: string, files: readonly [string, string, number][]) {
    this.fontsLoading = true;
    const faces: string[] = [];
    for (const [file, family, weight] of files) {
      try {
        const r = await fetch(base + file);
        if (!r.ok) continue;
        const b = new Uint8Array(await r.arrayBuffer());
        let s = '';
        for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
        faces.push(`@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${btoa(s)}) format('woff2')}`);
      } catch {
        /* that face falls back to the game's own fallback stack */
      }
    }
    this.fontCss = faces.join('\n');
    this.fontsLoading = false;
    this.dirty = true;
  }

  /** Anything changed since the last picture (DOM mutations, or animations running). */
  get changed(): boolean {
    if (this.dirty) return true;
    try {
      return (this.doc?.getAnimations?.() ?? []).some((a: Animation) => a.playState === 'running');
    } catch {
      return false;
    }
  }

  /** Start a new picture (if none is in flight and something changed). Returns whether one was started. */
  snap(force = false): boolean {
    const doc = this.doc;
    if (!doc || this.busy || this.broken || this.fontsLoading) return false;
    if (!force && !this.changed) return false;
    const t0 = performance.now();
    let svg: string;
    let marks: Element[] = [];
    let canvases: { c: HTMLCanvasElement; r: DOMRect }[] = [];
    try {
      const r = this.serialise(doc);
      svg = r.svg;
      marks = r.marks;
      canvases = r.canvases;
    } catch {
      return false;
    } finally {
      for (const m of marks) m.removeAttribute('data-otr-a');
      // Our own marks aren't changes.
      this.observer?.takeRecords();
    }
    this.dirty = false;
    this.stats.serMs = performance.now() - t0;
    this.stats.bytes = svg.length;
    this.busy = true;
    const img = (this.img ??= new Image());
    img.onload = () => {
      this.busy = false;
      if (this.doc !== doc) return;
      const t1 = performance.now();
      const g = this.g;
      g.clearRect(0, 0, this.w, this.h);
      g.drawImage(img, 0, 0, this.w, this.h);
      const sx = this.w / this.lw,
        sy = this.h / this.lh;
      for (const { c, r } of canvases) {
        try {
          if (c.width && c.height) g.drawImage(c, r.left * sx, r.top * sy, r.width * sx, r.height * sy);
        } catch {
          /* a canvas that won't draw is left out */
        }
      }
      if (this.stats.count === 0) {
        try {
          g.getImageData(0, 0, 1, 1);
        } catch {
          // Tainted (a browser that won't let SVG HTML into a canvas): HUD off for good.
          this.broken = true;
          g.clearRect(0, 0, this.w, this.h);
          return;
        }
      }
      this.stats.drawMs = performance.now() - t1;
      this.stats.count++;
      this.onDraw?.();
    };
    img.onerror = () => {
      this.busy = false;
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    return true;
  }

  private serialise(doc: AnyDoc) {
    // Stylesheets: the game's own (it adds a few at start-up), plus its fonts and the picture's own rules.
    const styles = doc.querySelectorAll('style');
    let key = String(styles.length);
    for (const s of styles) key += ':' + (s.textContent?.length ?? 0);
    if (key !== this.cssKey) {
      this.cssKey = key;
      let css = '';
      for (const s of styles) css += s.textContent + '\n';
      this.css = cssForSvg(css);
    }
    // Animations frozen where they are: each animated element is marked, and gets its delays.
    const marks: Element[] = [];
    let frozen = '';
    const byEl = new Map<Element, Map<string, number>>();
    for (const a of (doc.getAnimations?.() ?? []) as Animation[]) {
      const ca = a as Animation & { animationName?: string };
      const el = (a.effect as KeyframeEffect | null)?.target as Element | null;
      if (!ca.animationName || !el || (a.effect as KeyframeEffect).pseudoElement) continue;
      const timing = a.effect!.getTiming();
      const d = frozenDelay(Number(timing.delay) || 0, Number(a.currentTime) || 0);
      let m = byEl.get(el);
      if (!m) byEl.set(el, (m = new Map()));
      m.set(ca.animationName, d);
    }
    let k = 0;
    const view = doc.defaultView;
    for (const [el, m] of byEl) {
      const names = String(view?.getComputedStyle(el).animationName ?? '')
        .split(',')
        .map((s) => s.trim());
      const delays = names.map((n) => `${(m.get(n) ?? 0).toFixed(3)}s`);
      el.setAttribute('data-otr-a', String(k));
      marks.push(el);
      frozen += `[data-otr-a="${k}"]{animation-delay:${delays.join(',')}!important}\n`;
      k++;
    }
    // The visible HTML: body's children minus scripts, hidden things and the 3D stage.
    const ser = new (view?.XMLSerializer ?? XMLSerializer)();
    let body = '';
    const canvases: { c: HTMLCanvasElement; r: DOMRect }[] = [];
    for (const el of doc.body.children as HTMLCollectionOf<HTMLElement>) {
      if (SKIP.has(el.tagName) || el.id === 'stage' || el.hasAttribute('hidden')) continue;
      body += ser.serializeToString(el);
      for (const c of el.querySelectorAll('canvas') as NodeListOf<HTMLCanvasElement>) {
        if (!c.offsetParent) continue;
        const r = c.getBoundingClientRect();
        if (r.width > 1 && r.height > 1) canvases.push({ c, r });
      }
    }
    const root = doc.documentElement as HTMLElement;
    const bodyEl = doc.body as HTMLElement;
    const attr = (e: HTMLElement) => `${e.className ? ` class="${esc(String(e.className))}"` : ''}${e.getAttribute('style') ? ` style="${esc(e.getAttribute('style')!)}"` : ''}`;
    const own = `#stage,canvas{visibility:hidden!important}html,body{background:transparent!important;margin:0;overflow:hidden;width:${this.lw}px;height:${this.lh}px}*{transition:none!important;caret-color:transparent}`;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${this.lw}" height="${this.lh}"><foreignObject x="0" y="0" width="${this.lw}" height="${this.lh}">` +
      `<html xmlns="http://www.w3.org/1999/xhtml"${attr(root)}><head><style>${this.fontCss}\n${this.css}\n${frozen}${own}</style></head>` +
      `<body${attr(bodyEl)}>${body}</body></html></foreignObject></svg>`;
    return { svg, marks, canvases };
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
