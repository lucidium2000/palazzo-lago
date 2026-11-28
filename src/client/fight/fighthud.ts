import * as THREE from 'three';
import type { HudState } from './rounds';

/**
 * Fight mode's HUD: the power bars across the top (names, rounds won as
 * casino chips, the round clock in a gold diamond between them) and the big
 * calls in the middle ("ROUND 1", "FIGHT!", "K.O.!", "YOU WIN"). Our own
 * look: the Palazzo's black and gold, art-deco slants, chip pips.
 *
 * Both are drawn on canvases. On a screen they sit in the page (the bars at
 * the top, the calls in the middle, both shaking a little on big hits). In
 * VR they're two panels in the world ahead of you, a little above your eye
 * line and tilted toward you, that turn to follow you only once you've
 * looked well away (no head-locked jitter, nothing to chase), and never
 * shake: the view itself is never moved.
 */

const BW = 1024,
  BH = 192;
const CW = 1024,
  CH = 288;

const GOLD = '#d8b25a';
const GOLD_HI = '#f6e2a4';
const INK = '#120a06';
const FONT = (px: number, weight = 900) => `italic ${weight} ${px}px "Arial Black", "Helvetica Neue", Impact, system-ui, sans-serif`;

interface Shown {
  hp: [number, number];
  /** The trail behind a drop (where it was a moment ago). */
  ghost: [number, number];
  flash: [number, number];
}

/** Draws the power bars (pure canvas; also used for the screenshot check). */
export function drawBars(g: CanvasRenderingContext2D, s: HudState, shown: Shown, time: number) {
  g.clearRect(0, 0, BW, BH);
  const k = Math.min(1, s.intro / 0.45);
  // The slam-in: each bar comes in from its own side.
  const slide = s.intro < 99 ? (1 - easeOutBack(k)) * 520 : 0;
  const bar = (side: 0 | 1) => {
    const sd = side === 0 ? s.left : s.right;
    const dir = side === 0 ? -1 : 1;
    const x0 = side === 0 ? 34 : BW - 34;
    const x1 = side === 0 ? 432 : BW - 432;
    const y = 42,
      h = 42,
      sk = 16;
    g.save();
    g.translate(dir * slide, 0);
    // Frame: a slanted gold-edged slab.
    const slab = (inset: number) => {
      g.beginPath();
      g.moveTo(x0 - dir * inset, y + inset);
      g.lineTo(x1 + dir * inset - dir * sk, y + inset);
      g.lineTo(x1 + dir * inset, y + h - inset);
      g.lineTo(x0 - dir * inset + dir * sk, y + h - inset);
      g.closePath();
    };
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = 10;
    slab(-5);
    g.fillStyle = INK;
    g.fill();
    g.shadowBlur = 0;
    const edge = g.createLinearGradient(0, y - 5, 0, y + h + 5);
    edge.addColorStop(0, GOLD_HI);
    edge.addColorStop(0.5, GOLD);
    edge.addColorStop(1, '#7a5a22');
    g.lineWidth = 4;
    g.strokeStyle = edge;
    slab(-5);
    g.stroke();
    // Empty: deep red.
    slab(2);
    g.fillStyle = '#3a0a0e';
    g.fill();
    // Fill (and the trail behind a drop), from the outside in: the empty part grows toward the clock.
    const len = Math.abs(x1 - x0);
    const clipTo = (frac: number) => {
      g.save();
      slab(2);
      g.clip();
      const w = len * Math.max(0, Math.min(1, frac));
      g.beginPath();
      if (side === 0) g.rect(x0 - 10, y, w + 10, h);
      else g.rect(x0 - w, y, w + 10, h);
    };
    clipTo(shown.ghost[side]);
    g.fillStyle = '#f2ead8';
    g.fill();
    g.restore();
    const hp = shown.hp[side];
    clipTo(hp);
    const fill = g.createLinearGradient(0, y, 0, y + h);
    if (hp > 0.3) {
      fill.addColorStop(0, '#ffe9a0');
      fill.addColorStop(0.45, '#e8b445');
      fill.addColorStop(1, '#a8661c');
    } else {
      const p = 0.5 + 0.5 * Math.sin(time * 9);
      fill.addColorStop(0, `rgb(255,${120 + 60 * p},${110 + 40 * p})`);
      fill.addColorStop(0.5, '#e0302a');
      fill.addColorStop(1, '#801018');
    }
    g.fillStyle = fill;
    g.fill();
    // Deco stripes across the fill.
    g.globalAlpha = 0.14;
    g.fillStyle = '#fff';
    for (let sx = -40; sx < len + 40; sx += 22) {
      const bx = side === 0 ? x0 + sx : x0 - sx;
      g.beginPath();
      g.moveTo(bx, y);
      g.lineTo(bx + 8, y);
      g.lineTo(bx + 8 - sk, y + h);
      g.lineTo(bx - sk, y + h);
      g.fill();
    }
    g.globalAlpha = 1;
    g.restore();
    // A white flash on a hit.
    if (shown.flash[side] > 0) {
      g.save();
      g.globalAlpha = Math.min(1, shown.flash[side]) * 0.7;
      slab(2);
      g.fillStyle = '#fff';
      g.fill();
      g.restore();
    }
    // Name (yours gets a gold tag).
    g.font = FONT(30);
    g.textBaseline = 'top';
    g.textAlign = side === 0 ? 'left' : 'right';
    const nx = side === 0 ? x0 + 6 : x0 - 6;
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.strokeText(sd.name, nx, y + h + 10);
    g.fillStyle = sd.you ? GOLD_HI : '#f3e6c4';
    g.fillText(sd.name, nx, y + h + 10);
    // Rounds won: chips by the clock end of the bar.
    for (let c = 0; c < 2; c++) {
      const cx = side === 0 ? x1 - 30 - c * 34 : x1 + 30 + c * 34;
      chip(g, cx, y + h + 26, 13, c < sd.wins);
    }
    g.restore();
  };
  bar(0);
  bar(1);
  // The clock: a gold diamond in the middle.
  const cx = BW / 2,
    cy = 64;
  g.save();
  g.globalAlpha = Math.min(1, k * 1.5 + (s.intro < 99 ? 0 : 1));
  g.beginPath();
  g.moveTo(cx, cy - 50);
  g.lineTo(cx + 54, cy);
  g.lineTo(cx, cy + 50);
  g.lineTo(cx - 54, cy);
  g.closePath();
  g.fillStyle = INK;
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = GOLD;
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = FONT(40);
  g.fillStyle = s.timer <= 10 ? '#ff6a5a' : GOLD_HI;
  g.fillText(String(Math.max(0, s.timer)), cx, cy + 2);
  g.font = FONT(17, 800);
  g.fillStyle = GOLD;
  g.fillText(s.final ? 'FINAL' : `ROUND ${s.round}`, cx, cy + 66);
  g.restore();
}

function chip(g: CanvasRenderingContext2D, x: number, y: number, r: number, won: boolean) {
  g.save();
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = won ? '#b8202a' : 'rgba(20,12,8,0.85)';
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = won ? '#f6e2a4' : 'rgba(216,178,90,0.6)';
  g.setLineDash([4, 3.2]);
  g.stroke();
  g.setLineDash([]);
  g.beginPath();
  g.arc(x, y, r * 0.5, 0, Math.PI * 2);
  g.lineWidth = 2;
  g.strokeStyle = won ? '#f6e2a4' : 'rgba(216,178,90,0.4)';
  g.stroke();
  g.restore();
}

const easeOutBack = (x: number) => {
  const c1 = 1.70158,
    c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/** Draws the big call in the middle (pure canvas). */
export function drawCall(g: CanvasRenderingContext2D, b: NonNullable<HudState['banner']>) {
  g.clearRect(0, 0, CW, CH);
  const t = b.t;
  // In with a punch (big to size), held, then a little fade for the long ones.
  const inK = Math.min(1, t / 0.16);
  const scale = 1 + (1 - inK) * 0.9;
  const alpha = Math.min(1, t / 0.08);
  g.save();
  g.globalAlpha = alpha;
  g.translate(CW / 2, CH / 2 - 14);
  // A slanted gold band behind it.
  const bw = Math.min(1, t / 0.22) * CW * 0.92;
  g.save();
  g.transform(1, 0, -0.25, 1, 0, 0);
  const band = g.createLinearGradient(-bw / 2, 0, bw / 2, 0);
  const hot = b.kind === 'ko' || b.kind === 'fight' || b.kind === 'lose';
  band.addColorStop(0, 'rgba(0,0,0,0)');
  band.addColorStop(0.2, hot ? 'rgba(120,10,16,0.82)' : 'rgba(18,10,6,0.82)');
  band.addColorStop(0.8, hot ? 'rgba(120,10,16,0.82)' : 'rgba(18,10,6,0.82)');
  band.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = band;
  g.fillRect(-bw / 2, -66, bw, 132);
  g.fillStyle = GOLD;
  g.fillRect(-bw / 2 + bw * 0.1, -70, bw * 0.8, 4);
  g.fillRect(-bw / 2 + bw * 0.1, 66, bw * 0.8, 4);
  g.restore();
  g.scale(scale, scale);
  const size = b.text.length > 9 ? 92 : b.kind === 'vs' ? 120 : 118;
  g.font = FONT(size);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 16;
  g.strokeStyle = INK;
  g.strokeText(b.text, 0, 0);
  const grad = g.createLinearGradient(0, -size / 2, 0, size / 2);
  if (b.kind === 'ko' || b.kind === 'lose') {
    grad.addColorStop(0, '#ffd2a0');
    grad.addColorStop(0.5, '#ff4a2a');
    grad.addColorStop(1, '#9a1010');
  } else {
    grad.addColorStop(0, '#fff6d2');
    grad.addColorStop(0.5, '#f0c860');
    grad.addColorStop(1, '#a8701c');
  }
  g.fillStyle = grad;
  g.fillText(b.text, 0, 0);
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.strokeText(b.text, 0, 0);
  if (b.sub) {
    g.font = FONT(36, 800);
    g.lineWidth = 7;
    g.strokeStyle = INK;
    g.strokeText(b.sub, 0, 92);
    g.fillStyle = '#f3e6c4';
    g.fillText(b.sub, 0, 92);
  }
  g.restore();
}

export class FightHud {
  private bars: HTMLCanvasElement;
  private call: HTMLCanvasElement;
  private bg: CanvasRenderingContext2D | null;
  private cg: CanvasRenderingContext2D | null;
  private wrap: HTMLElement;
  private callWrap: HTMLElement;
  private barTex: THREE.CanvasTexture;
  private callTex: THREE.CanvasTexture;
  private barMesh: THREE.Mesh;
  private callMesh: THREE.Mesh;
  private panel = new THREE.Group();
  private panelYaw: number | null = null;
  private shown: Shown = { hp: [1, 1], ghost: [1, 1], flash: [0, 0] };
  private lastHp: [number, number] = [1, 1];
  private shakeK = 0;
  private time = 0;
  private lastCall = '';
  private v = new THREE.Vector3();
  private q = new THREE.Quaternion();
  /** The last state drawn (for tests and the debug console). */
  last: HudState | null = null;

  constructor(
    scene: THREE.Scene,
    private camera: THREE.Camera,
  ) {
    this.bars = document.createElement('canvas');
    this.bars.width = BW;
    this.bars.height = BH;
    this.call = document.createElement('canvas');
    this.call.width = CW;
    this.call.height = CH;
    this.bg = this.bars.getContext('2d');
    this.cg = this.call.getContext('2d');
    this.wrap = document.createElement('div');
    this.wrap.id = 'fighthud';
    this.wrap.appendChild(this.bars);
    this.callWrap = document.createElement('div');
    this.callWrap.id = 'fightcall';
    this.callWrap.appendChild(this.call);
    const root = document.getElementById('hud') ?? document.body;
    root.appendChild(this.wrap);
    root.appendChild(this.callWrap);
    // VR: two panels ahead of you.
    const mk = (c: HTMLCanvasElement, w: number, h: number) => {
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }),
      );
      m.renderOrder = 1995;
      m.raycast = () => {};
      m.userData.noLand = true;
      m.frustumCulled = false;
      return { tex, m };
    };
    const b = mk(this.bars, 1.0, (1.0 * BH) / BW);
    const c = mk(this.call, 0.95, (0.95 * CH) / CW);
    this.barTex = b.tex;
    this.callTex = c.tex;
    this.barMesh = b.m;
    this.callMesh = c.m;
    // Bars a little above your eye line and tilted down toward you; the calls just above centre.
    this.barMesh.position.set(0, 0.5, -1.7);
    this.barMesh.rotation.x = 0.26;
    this.callMesh.position.set(0, 0.12, -1.9);
    this.panel.add(this.barMesh, this.callMesh);
    this.panel.visible = false;
    scene.add(this.panel);
  }

  /** A hit landed: the bars shake (screen HUD only; nothing moves your view in VR). */
  shake(k: number) {
    this.shakeK = Math.min(1.2, this.shakeK + k);
  }

  update(dt: number, s: HudState | null, inXR: boolean) {
    this.time += dt;
    this.last = s;
    const on = !!s && s.show > 0.01;
    this.wrap.classList.toggle('on', on && !inXR);
    this.callWrap.classList.toggle('on', on && !inXR && !!s?.banner);
    this.panel.visible = on && inXR;
    if (!s || !on) {
      this.panelYaw = null;
      return;
    }
    // Bars ease to their health; a drop leaves a trail that catches up after a beat.
    const tgt: [number, number] = [s.left.hp, s.right.hp];
    for (const i of [0, 1] as const) {
      const sh = this.shown;
      if (tgt[i] < this.lastHp[i] - 0.004) sh.flash[i] = 1;
      this.lastHp[i] = tgt[i];
      sh.hp[i] += (tgt[i] - sh.hp[i]) * Math.min(1, dt * 14);
      if (sh.ghost[i] < sh.hp[i]) sh.ghost[i] = sh.hp[i];
      else sh.ghost[i] = Math.max(sh.hp[i], sh.ghost[i] - dt * 0.35);
      sh.flash[i] = Math.max(0, sh.flash[i] - dt * 6);
    }
    if (this.bg) drawBars(this.bg, s, this.shown, this.time);
    this.barTex.needsUpdate = true;
    const key = s.banner ? s.banner.text + (s.banner.t < 0.5 ? s.banner.t.toFixed(2) : '') + s.banner.sub : '';
    if (key !== this.lastCall) {
      this.lastCall = key;
      if (this.cg) {
        if (s.banner) drawCall(this.cg, s.banner);
        else this.cg.clearRect(0, 0, CW, CH);
      }
      this.callTex.needsUpdate = true;
    }
    this.callMesh.visible = !!s.banner;
    this.shakeK = Math.max(0, this.shakeK - dt * 4);
    const a = s.show;
    if (!inXR) {
      const sx = (Math.random() - 0.5) * 14 * this.shakeK,
        sy = (Math.random() - 0.5) * 10 * this.shakeK;
      this.wrap.style.opacity = String(a);
      this.wrap.style.transform = `translate(calc(-50% + ${sx.toFixed(1)}px), ${sy.toFixed(1)}px)`;
      this.callWrap.style.transform = `translate(calc(-50% + ${(sx * 0.6).toFixed(1)}px), calc(-50% + ${(sy * 0.6).toFixed(1)}px))`;
      return;
    }
    // VR: where you are, facing where you've been facing (it turns to follow once you look well away).
    this.camera.getWorldPosition(this.v);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.getWorldQuaternion(this.q));
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    if (this.panelYaw === null) this.panelYaw = yaw;
    let d = yaw - this.panelYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) > 0.45) this.panelYaw += d * Math.min(1, dt * 2.5);
    this.panel.position.copy(this.v);
    this.panel.rotation.set(0, this.panelYaw, 0);
    for (const m of [this.barMesh, this.callMesh]) (m.material as THREE.MeshBasicMaterial).opacity = a;
  }

  dispose() {
    this.wrap.remove();
    this.callWrap.remove();
    this.panel.removeFromParent();
    this.barTex.dispose();
    this.callTex.dispose();
  }
}
