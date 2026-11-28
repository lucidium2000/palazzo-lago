import * as THREE from 'three';
/** The overlay render layer (the same one as replyhud.ts's OVERLAY_LAYER: your view draws it, photos and mirrors don't). */
const OVERLAY_LAYER = 3;
import { GOLD, GOLD_LIGHT, roundRect, SERIF } from './panel';
import { canvas } from './textures';

/**
 * The VR heads-up corner: everything that only *tells* you something (tips,
 * toasts, captions, banners, the reply choices) sits in a 2D panel at the top
 * right of your view instead of floating in the room. It is head-locked with a
 * gentle lazy follow (no roll, so it never tilts with your head), about a metre
 * away, drawn on top of everything on the overlay layer (never hit, shadowed,
 * photographed or mirrored). Things you touch (menus, buttons, chips, signs)
 * stay in the world.
 *
 * Layout, in degrees from the centre of your view: the info panel's middle sits
 * CORNER.right° right and CORNER.infoUp° up; the reply strip (replyhud.ts) sits just below it.
 */

/** Distance from the eyes (metres) and the corner's direction (degrees). */
export const CORNER = { dist: 1.0, right: 21, infoUp: 14, replyUp: 0 };

/** The corner's shared frame: level, following your gaze lazily, so both panels move as one. */
export class CornerAnchor {
  private q = new THREE.Quaternion();
  private placed = false;
  private head = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private m = new THREE.Matrix4();
  private tq = new THREE.Quaternion();
  private lastT = -1;

  /** Follows your gaze (call once a frame before placing anything). */
  update(dt: number, camera: THREE.Camera) {
    camera.layers.enable(OVERLAY_LAYER);
    camera.updateMatrixWorld();
    camera.getWorldPosition(this.head);
    this.fwd.set(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(this.tq));
    if (Math.abs(this.fwd.y) > 0.98) this.fwd.y = Math.sign(this.fwd.y) * 0.98;
    this.m.lookAt(ORIGIN, this.fwd, UP);
    this.tq.setFromRotationMatrix(this.m);
    if (!this.placed) {
      this.q.copy(this.tq);
      this.placed = true;
    } else {
      // Gentle lazy-follow, quicker when you've turned well away (it never leaves your view for long).
      const off = this.q.angleTo(this.tq);
      this.q.slerp(this.tq, 1 - Math.exp(-dt * (off > 0.6 ? 9 : 4.5)));
    }
    this.lastT = performance.now();
  }

  /** Snap straight to your gaze next time (e.g. after a teleport or a new VR session). */
  reset() {
    this.placed = false;
  }

  /** Puts `obj` at `right`° right and `up`° up of your (lazily followed) gaze, `dist` away, facing your eyes. */
  place(obj: THREE.Object3D, right: number, up: number, dist = CORNER.dist) {
    const yaw = THREE.MathUtils.degToRad(-right),
      pitch = THREE.MathUtils.degToRad(up);
    const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    obj.quaternion.copy(this.q).multiply(turn);
    obj.position.set(0, 0, -dist).applyQuaternion(obj.quaternion).add(this.head);
  }

  get fresh() {
    return this.lastT > 0 && performance.now() - this.lastT < 500;
  }
}

/** The one corner everything shares. */
export const corner = new CornerAnchor();

export type InfoKind = 'info' | 'win' | 'warn' | 'tip' | 'caption';

interface Entry {
  id: number;
  text: string;
  kind: InfoKind;
  born: number;
  until: number;
}

const W = 768;
const H = 470;
const PAD = 8;
const FONT = 40;
const LINE = 48;
/** Panel width in metres (at a metre: about 23°, with text about 1.3° tall). */
const WIDTH_M = 0.4;
const FADE = 350;

/**
 * The info panel: up to three messages (newest on top, each wrapped to two
 * lines), plus the current first-time tip pinned above them. Messages fade in
 * and out; a repeat of the newest just stays up longer.
 */
export class InfoHud {
  readonly mesh: THREE.Mesh;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private mat: THREE.MeshBasicMaterial;
  private entries: Entry[] = [];
  private tip: { text: string; alpha: number } | null = null;
  private nextId = 1;
  private sig = '';
  private active = false;

  constructor(scene: THREE.Scene) {
    const [c, ctx] = canvas(W, H);
    this.ctx = ctx;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH_M, (WIDTH_M * H) / W), this.mat);
    this.mesh.name = 'info-hud';
    // An overlay: on top of the room (under the black teleport fades), never hit or shadowed.
    this.mesh.renderOrder = 9000;
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => {};
    this.mesh.layers.set(OVERLAY_LAYER);
    this.mesh.userData.overlay = true;
    this.mesh.userData.noLand = true;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** A message for `ms` milliseconds (a toast, a caption, a banner). */
  push(text: string, kind: InfoKind = 'info', ms = 3200) {
    const now = performance.now();
    const top = this.entries[0];
    if (top && top.text === text) {
      top.until = Math.max(top.until, now + ms);
      return;
    }
    this.entries.unshift({ id: this.nextId++, text, kind, born: now, until: now + ms });
    if (this.entries.length > 3) this.entries.length = 3;
  }

  /** The first-time tip showing now (hints.ts), and how faded in it is; null when there's none. */
  setTip(text: string | null, alpha = 1) {
    this.tip = text ? { text, alpha } : null;
  }

  /** Clears everything (VR ended). */
  clear() {
    this.entries.length = 0;
    this.tip = null;
    this.mesh.visible = false;
    this.sig = '';
  }

  /** Places and redraws it (only while you're in VR). Call after `corner.update`. */
  update(presenting: boolean) {
    const now = performance.now();
    this.entries = this.entries.filter((e) => now < e.until + FADE);
    if (!presenting) {
      if (this.active) this.clear();
      this.active = false;
      return;
    }
    this.active = true;
    const any = this.entries.length > 0 || (this.tip && this.tip.alpha > 0.01);
    this.mesh.visible = !!any;
    if (!any) return;
    corner.place(this.mesh, CORNER.right, CORNER.infoUp);
    this.draw(now);
  }

  private draw(now: number) {
    const fade = (e: Entry) => Math.min(1, (now - e.born) / 200, Math.max(0, (e.until + FADE - now) / FADE));
    const sig = [this.tip ? `${this.tip.text}@${Math.round(this.tip.alpha * 8)}` : '', ...this.entries.map((e) => `${e.id}@${Math.round(fade(e) * 8)}`)].join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    const g = this.ctx;
    g.clearRect(0, 0, W, H);
    g.textBaseline = 'middle';
    let y = PAD;
    const block = (text: string, kind: InfoKind, alpha: number) => {
      g.font = `${kind === 'caption' ? 'italic ' : ''}600 ${FONT}px ${SERIF}`;
      const label = kind === 'tip' ? 'Tip' : '';
      const labelW = label ? g.measureText(label).width + 26 : 0;
      const lines = wrap(g, text, W - 2 * PAD - 44 - labelW, 2);
      const h = lines.length * LINE + 26;
      if (y + h > H - PAD) return;
      g.globalAlpha = alpha;
      roundRect(g, PAD, y, W - 2 * PAD, h, 22);
      g.fillStyle = kind === 'win' ? 'rgba(46,30,6,0.9)' : kind === 'warn' ? 'rgba(60,12,12,0.9)' : kind === 'tip' ? 'rgba(10,26,30,0.9)' : 'rgba(14,10,8,0.86)';
      g.fill();
      g.strokeStyle = kind === 'warn' ? '#e07a6a' : kind === 'tip' ? '#7fd0d8' : GOLD;
      g.lineWidth = kind === 'win' ? 5 : 3;
      g.stroke();
      if (label) {
        g.fillStyle = '#7fd0d8';
        g.textAlign = 'left';
        g.fillText(label, PAD + 22, y + 13 + LINE / 2 + 2);
      }
      g.fillStyle = kind === 'win' ? '#ffe08a' : kind === 'warn' ? '#ffd2c8' : kind === 'caption' ? '#efe3c6' : GOLD_LIGHT;
      g.textAlign = 'left';
      lines.forEach((l, i) => g.fillText(l, PAD + 22 + labelW, y + 13 + i * LINE + LINE / 2 + 2));
      g.globalAlpha = 1;
      y += h + 10;
    };
    if (this.tip && this.tip.alpha > 0.01) block(this.tip.text, 'tip', this.tip.alpha);
    for (const e of this.entries) block(e.text, e.kind, fade(e));
    this.tex.needsUpdate = true;
  }
}

const ORIGIN = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Word-wraps to at most `max` lines (the last one ends in an ellipsis if it doesn't all fit). */
export function wrap(g: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const t = line ? `${line} ${words[i]}` : words[i];
    if (g.measureText(t).width <= width || !line) {
      line = t;
      continue;
    }
    lines.push(line);
    line = words[i];
    if (lines.length === max - 1) {
      // Last line: whatever's left, trimmed to fit.
      let rest = words.slice(i).join(' ');
      if (g.measureText(rest).width > width) {
        while (rest.length > 1 && g.measureText(rest + '…').width > width) rest = rest.slice(0, -1);
        rest = rest.trimEnd() + '…';
      }
      lines.push(rest);
      return lines;
    }
  }
  if (line) lines.push(line);
  return lines;
}
