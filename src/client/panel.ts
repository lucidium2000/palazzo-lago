import * as THREE from 'three';
import { canvas } from './textures';
import type { Interaction, SelectEvent } from './interaction';

/**
 * In-world UI: a canvas drawn onto a plane, with hit-tested buttons. Works the
 * same with a mouse and a VR laser, so the VR player gets every control.
 */

export interface PanelButton {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string | (() => string);
  sub?: string | (() => string);
  enabled?: () => boolean;
  active?: () => boolean;
  /** Custom painter instead of the default button style. */
  paint?: (ctx: CanvasRenderingContext2D, b: PanelButton, state: { hover: boolean; enabled: boolean; active: boolean }) => void;
  onPress: () => void;
}

export const GOLD = '#d8b25a';
export const GOLD_LIGHT = '#f3dc9a';
export const INK = '#1a1410';
export const SERIF = 'Georgia, "Times New Roman", serif';

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class CanvasPanel {
  readonly mesh: THREE.Mesh;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  readonly buttons: PanelButton[] = [];
  private hover: string | null = null;
  background: ((ctx: CanvasRenderingContext2D) => void) | null = null;
  overlay: ((ctx: CanvasRenderingContext2D) => void) | null = null;
  /** Called with canvas-space coordinates when a click misses every button. */
  onSurface: ((x: number, y: number) => void) | null = null;

  constructor(
    widthM: number,
    readonly pxW: number,
    readonly pxH: number,
    opts: { transparent?: boolean; doubleSided?: boolean } = {},
  ) {
    const [c, ctx] = canvas(pxW, pxH);
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: opts.transparent ?? true,
      toneMapped: false,
      side: opts.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(widthM, (widthM * pxH) / pxW), mat);
  }

  add(b: PanelButton) {
    this.buttons.push(b);
    return b;
  }

  register(interaction: Interaction) {
    interaction.register({
      object: this.mesh,
      kind: 'button',
      onSelect: (e) => this.press(e),
      onHover: (e) => {
        const b = e ? this.buttonAt(e) : null;
        const id = b && (b.enabled?.() ?? true) ? b.id : null;
        if (id !== this.hover) {
          this.hover = id;
          this.redraw();
        }
      },
    });
  }

  private toCanvas(e: SelectEvent) {
    const uv = e.hit.uv!;
    return { x: uv.x * this.pxW, y: (1 - uv.y) * this.pxH };
  }

  private buttonAt(e: SelectEvent) {
    if (!e.hit.uv) return null;
    const { x, y } = this.toCanvas(e);
    return this.buttons.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) ?? null;
  }

  private press(e: SelectEvent) {
    const b = this.buttonAt(e);
    if (b) {
      if (b.enabled?.() ?? true) b.onPress();
    } else if (this.onSurface && e.hit.uv) {
      const { x, y } = this.toCanvas(e);
      this.onSurface(x, y);
    }
  }

  redraw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.pxW, this.pxH);
    this.background?.(ctx);
    for (const b of this.buttons) {
      const state = { hover: this.hover === b.id, enabled: b.enabled?.() ?? true, active: b.active?.() ?? false };
      (b.paint ?? paintButton)(ctx, b, state);
    }
    this.overlay?.(ctx);
    this.texture.needsUpdate = true;
  }
}

export function paintButton(
  ctx: CanvasRenderingContext2D,
  b: PanelButton,
  s: { hover: boolean; enabled: boolean; active: boolean },
) {
  const r = Math.min(b.h / 2, 18);
  roundRect(ctx, b.x, b.y, b.w, b.h, r);
  const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
  if (s.active) {
    g.addColorStop(0, '#fbe7a6');
    g.addColorStop(1, '#c8973c');
  } else {
    g.addColorStop(0, s.hover ? '#3a2d22' : '#2a201a');
    g.addColorStop(1, s.hover ? '#241b15' : '#15100c');
  }
  ctx.fillStyle = g;
  ctx.globalAlpha = s.enabled ? 1 : 0.4;
  ctx.fill();
  ctx.lineWidth = s.hover ? 4 : 2.5;
  ctx.strokeStyle = s.hover ? GOLD_LIGHT : GOLD;
  ctx.stroke();
  ctx.fillStyle = s.active ? INK : GOLD_LIGHT;
  const label = typeof b.label === 'function' ? b.label() : b.label;
  const sub = typeof b.sub === 'function' ? b.sub() : b.sub;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(b.h * (sub ? 0.34 : 0.42))}px ${SERIF}`;
  ctx.fillText(label, b.x + b.w / 2, b.y + b.h * (sub ? 0.38 : 0.53));
  if (sub) {
    ctx.font = `${Math.round(b.h * 0.22)}px ${SERIF}`;
    ctx.fillStyle = s.active ? INK : '#cbb991';
    ctx.fillText(sub, b.x + b.w / 2, b.y + b.h * 0.72);
  }
  ctx.globalAlpha = 1;
}

/** A plain floating text label (signage, prices). */
export function textSign(
  text: string,
  opts: { width?: number; px?: number; color?: string; bg?: string; font?: string; sub?: string } = {},
): THREE.Mesh {
  const pxW = 1024,
    pxH = opts.sub ? 300 : 220;
  const p = new CanvasPanel(opts.width ?? 2, pxW, pxH);
  const ctx = p.ctx;
  if (opts.bg) {
    roundRect(ctx, 6, 6, pxW - 12, pxH - 12, 28);
    ctx.fillStyle = opts.bg;
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 6;
    ctx.stroke();
  }
  ctx.fillStyle = opts.color ?? GOLD_LIGHT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = opts.font ?? `italic 600 ${opts.px ?? 120}px ${SERIF}`;
  ctx.shadowColor = 'rgba(255,200,90,0.6)';
  ctx.shadowBlur = 18;
  ctx.fillText(text, pxW / 2, opts.sub ? pxH * 0.4 : pxH / 2);
  if (opts.sub) {
    ctx.shadowBlur = 0;
    let size = Math.round((opts.px ?? 120) * 0.38);
    ctx.font = `${size}px ${SERIF}`;
    while (ctx.measureText(opts.sub).width > pxW - 80 && size > 12) ctx.font = `${--size}px ${SERIF}`;
    ctx.fillStyle = '#e9dcc0';
    ctx.fillText(opts.sub, pxW / 2, pxH * 0.78);
  }
  p.texture.needsUpdate = true;
  return p.mesh;
}
