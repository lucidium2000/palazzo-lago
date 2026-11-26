import * as THREE from 'three';
import { CHIP_HEIGHT, makeChip } from './chips';
import type { FeltHover } from './interaction';
import { CHIP_COLORS, type ChipDenom } from './textures';

/**
 * The chip on your fingertip (VR). Point at a table (index out, the other
 * fingers curled) and a little chip of the denomination you're betting with
 * sits on your fingertip, glowing softly: you're loaded. Hold the finger over
 * a betting spot and a ghost chip shows where it would go, with what the spot
 * is; press into the felt and the chip drops there. Open your hand and the
 * chip goes away: an open hand, a palm or a fist on the felt never bets.
 *
 * No chip chosen (or not enough money for it): nothing on the fingertip, and
 * a press says "pick a chip" instead of betting.
 */

export interface FingerState {
  side: 'left' | 'right';
  tip: THREE.Vector3 | null;
  /** Index out, the other fingers curled. */
  pointing: boolean;
  /** Within reach of a betting felt. */
  near: boolean;
  /** The chip you'd bet (null: none chosen, or you can't cover it). */
  denom: ChipDenom | null;
  /** The felt under the fingertip, if any. */
  hover: FeltHover | null;
}

interface Finger {
  chip: THREE.Mesh;
  glow: THREE.Sprite;
  ghost: THREE.Mesh;
  label: TextSprite;
  denom: ChipDenom | null;
  loaded: boolean;
  /** Seconds since the chip dropped (it re-forms on the fingertip). */
  since: number;
  hint: number;
  spin: number;
}

const MINI = 0.75;

/** A camera-facing text label (canvas sprite) that only redraws when its text changes. */
export class TextSprite {
  readonly sprite: THREE.Sprite;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private text = '';

  constructor(
    h = 0.022,
    private color = '#f6e7c1',
  ) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 96;
    this.ctx = c.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    this.sprite.renderOrder = 1000;
    this.sprite.scale.set((h * 512) / 96, h, 1);
    this.sprite.visible = false;
    this.sprite.raycast = () => {};
  }

  set(text: string, color = this.color) {
    if (text === this.text) return;
    this.text = text;
    const g = this.ctx;
    const W = g.canvas.width,
      H = g.canvas.height;
    g.clearRect(0, 0, W, H);
    if (!text) return;
    g.font = '600 46px Georgia, serif';
    const w = Math.min(W - 8, g.measureText(text).width + 44);
    g.fillStyle = 'rgba(14,10,7,0.78)';
    g.beginPath();
    g.roundRect((W - w) / 2, 8, w, H - 16, 36);
    g.fill();
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, W / 2, H / 2 + 2, W - 30);
    this.tex.needsUpdate = true;
  }
}

let glowTex: THREE.Texture | null = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,0.9)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/** A chip with its own materials (so it can glow or fade without touching the shared ones). */
function ownChip(d: ChipDenom, look: (m: THREE.MeshStandardMaterial) => void): THREE.Mesh {
  const m = makeChip(d);
  m.material = (m.material as THREE.MeshStandardMaterial[]).map((x) => {
    const c = x.clone();
    look(c);
    return c;
  });
  return m;
}

export class FingerChips {
  readonly group = new THREE.Group();
  private fingers = new Map<'left' | 'right', Finger>();
  /** Your finger just became loaded (buzz it). */
  onReady: ((side: 'left' | 'right') => void) | null = null;
  private t = 0;

  constructor(scene: THREE.Object3D) {
    this.group.name = 'finger-chips';
    this.group.userData.dynamic = true;
    this.group.userData.noLand = true;
    scene.add(this.group);
  }

  private finger(side: 'left' | 'right'): Finger {
    let f = this.fingers.get(side);
    if (f) return f;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffe2a0, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(0.05);
    glow.raycast = () => {};
    const label = new TextSprite(0.02);
    f = { chip: new THREE.Mesh(), glow, ghost: new THREE.Mesh(), label, denom: null, loaded: false, since: 1, hint: 0, spin: 0 };
    this.group.add(glow, label.sprite);
    this.fingers.set(side, f);
    return f;
  }

  private setDenom(f: Finger, d: ChipDenom) {
    if (f.denom === d) return;
    f.denom = d;
    for (const m of [f.chip, f.ghost]) m.removeFromParent();
    const col = new THREE.Color(CHIP_COLORS[d][0]);
    f.chip = ownChip(d, (m) => {
      m.emissive = col.clone();
      m.emissiveIntensity = 0.35;
    });
    f.chip.scale.setScalar(MINI);
    f.ghost = ownChip(d, (m) => {
      m.transparent = true;
      m.opacity = 0.5;
      m.depthWrite = false;
      m.emissive = new THREE.Color(0xffe9a8);
      m.emissiveIntensity = 0.25;
    });
    f.chip.visible = f.ghost.visible = false;
    (f.glow.material as THREE.SpriteMaterial).color.copy(col).lerp(new THREE.Color(0xffe9a8), 0.5);
    this.group.add(f.chip, f.ghost);
  }

  /** Is that hand loaded (a chip on its fingertip) right now? */
  loaded(side: 'left' | 'right'): boolean {
    return this.fingers.get(side)?.loaded ?? false;
  }

  /** The chip dropped from this fingertip onto the felt. */
  placed(side: 'left' | 'right') {
    const f = this.fingers.get(side);
    if (f) f.since = 0;
  }

  /** A press with nothing loaded: a gentle "pick a chip" by the fingertip. */
  hint(side: 'left' | 'right', text = 'Pick a chip first') {
    const f = this.finger(side);
    f.hint = 1.6;
    f.label.set(text, '#ffd2a0');
  }

  update(dt: number, states: FingerState[]) {
    this.t += dt;
    const live = new Set<string>();
    for (const s of states) {
      live.add(s.side);
      const f = this.finger(s.side);
      f.since += dt;
      f.hint = Math.max(0, f.hint - dt);
      const ready = !!s.tip && s.pointing && s.near && s.denom !== null;
      if (ready && s.denom !== null) this.setDenom(f, s.denom);
      if (ready && !f.loaded) this.onReady?.(s.side);
      f.loaded = ready;
      // The chip re-forms on the fingertip a moment after it drops.
      const k = THREE.MathUtils.clamp((f.since - 0.18) / 0.22, 0, 1);
      f.chip.visible = ready && k > 0;
      f.glow.visible = f.chip.visible;
      if (f.chip.visible && s.tip) {
        f.spin += dt * 1.4;
        const pulse = 0.5 + 0.5 * Math.sin(this.t * 4);
        f.chip.position.copy(s.tip).y += 0.011 + CHIP_HEIGHT * MINI * 0.5;
        f.chip.rotation.set(0, f.spin, 0);
        f.chip.scale.setScalar(MINI * (0.4 + 0.6 * k));
        for (const m of f.chip.material as THREE.MeshStandardMaterial[]) m.emissiveIntensity = 0.25 + 0.2 * pulse;
        f.glow.position.copy(f.chip.position);
        f.glow.scale.setScalar(0.04 + 0.012 * pulse);
      }
      // Over a spot: a ghost chip where it would land, and what the spot is.
      const h = ready ? s.hover : null;
      const valid = !!h && h.label !== null;
      f.ghost.visible = valid && !h!.item.onHover;
      if (f.ghost.visible) f.ghost.position.copy(h!.e.hit.point).y += CHIP_HEIGHT * 0.5 + 0.001;
      if (f.hint > 0 && s.tip) {
        f.label.sprite.visible = true;
        f.label.sprite.position.copy(s.tip).y += 0.045;
      } else if (valid && s.tip) {
        f.label.set(h!.label!);
        f.label.sprite.visible = true;
        f.label.sprite.position.copy(s.tip).y += 0.04;
      } else f.label.sprite.visible = false;
    }
    for (const [side, f] of this.fingers) {
      if (live.has(side)) continue;
      f.loaded = false;
      f.chip.visible = f.glow.visible = f.ghost.visible = f.label.sprite.visible = false;
    }
  }
}
