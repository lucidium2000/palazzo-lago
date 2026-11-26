import * as THREE from 'three';
import type { Bankroll } from '../rules/bankroll';
import { money } from './game';
import type { Interaction } from './interaction';
import { CanvasPanel, GOLD, GOLD_LIGHT, roundRect, SERIF } from './panel';
import type { Viewpoint } from './player';
import { replyPrompt } from './replyhud';

export type ToastKind = 'info' | 'win' | 'warn';

/** A button in the on-screen game controls (chips, SPIN, bet −/+ …). */
export interface Control {
  id: string;
  label: string;
  sub?: string;
  kind?: 'chip' | 'primary' | 'plain' | 'slider';
  color?: [string, string];
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
  /** Sliders: range, step, current value and what to do as it moves. */
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  onInput?: (v: number) => void;
}

export interface Goal {
  id: string;
  label: string;
  done: boolean;
}

export interface NavItem {
  id: string;
  label: string;
  viewpoint?: Viewpoint;
  disabled?: string;
}

/**
 * Browser HUD (HTML overlay) plus its VR twin: a wrist menu on the left hand
 * and toasts that float in front of the player.
 */
export class Hud {
  station: string | null = null;
  private pending = new Map<string, number>();
  private root: HTMLElement;
  private balanceEl: HTMLElement;
  private toastEl: HTMLElement;
  private navEl: HTMLElement;
  private vrToast: CanvasPanel;
  private vrToastUntil = 0;
  readonly wrist: CanvasPanel;
  /** Draws the wrist menu (the VR menu takes this over). */
  wristBuilder: (() => void) | null = null;
  private wristAttached = false;
  /** The wrist menu opens and closes with Y on the left Touch controller. */
  private wristOpen = false;
  private yWas = false;
  private nav: NavItem[] = [];
  onNavigate: ((item: NavItem) => void) | null = null;

  constructor(
    private bankroll: Bankroll,
    scene: THREE.Scene,
    private renderer: THREE.WebGLRenderer,
    private interaction: Interaction,
  ) {
    this.root = document.getElementById('hud')!;
    this.balanceEl = this.root.querySelector('#balance')!;
    this.toastEl = this.root.querySelector('#toasts')!;
    this.navEl = this.root.querySelector('#nav')!;
    bankroll.onChange(() => this.renderBalance());
    this.renderBalance();

    this.vrToast = new CanvasPanel(0.7, 1400, 200);
    this.vrToast.mesh.visible = false;
    (this.vrToast.mesh.material as THREE.MeshBasicMaterial).depthTest = false;
    this.vrToast.mesh.renderOrder = 1000;
    scene.add(this.vrToast.mesh);

    this.wrist = new CanvasPanel(0.22, 600, 900);
    this.wrist.mesh.visible = false;
    this.wrist.register(interaction);
    renderer.xr.addEventListener('sessionend', () => {
      this.wristOpen = false;
      this.wrist.mesh.visible = false;
      this.vrToast.mesh.visible = false;
    });
  }

  private controlsEl = document.getElementById('controls')!;
  private controlsSig = '';
  private controlsFns = new Map<string, () => void>();
  private subtitleEl = document.getElementById('subtitle')!;
  private subtitleTimer = 0;
  private bannerEl = document.getElementById('banner')!;
  private bannerTimer = 0;
  private goalsEl = document.getElementById('goals')!;
  private goalsSig = '';

  /** On-screen controls for the game you are at (re-rendered only when they change). */
  setControls(list: Control[] | null) {
    const sig = list ? JSON.stringify(list.map((c) => [c.id, c.label, c.sub, c.active, c.disabled, c.min, c.max])) : '';
    for (const c of list ?? []) {
      this.controlsFns.set(c.id, c.onPress);
      if (c.onInput) this.inputFns.set(c.id, c.onInput);
    }
    if (sig === this.controlsSig) return;
    this.controlsSig = sig;
    // Same controls, new labels: update them in place (keeps a slider being dragged alive).
    const shape = list ? list.map((c) => `${c.id}:${c.kind ?? ''}`).join() : '';
    if (shape && shape === this.controlsShape) {
      list!.forEach((c, i) => {
        const el = this.controlsEl.children[i] as HTMLElement;
        if (c.kind === 'slider') {
          const r = el.querySelector('input') as HTMLInputElement;
          r.min = String(c.min ?? 0);
          r.max = String(c.max ?? 100);
          if (document.activeElement !== r) r.value = String(c.value ?? 0);
          return;
        }
        const b = el as HTMLButtonElement;
        b.className = `ctl ${c.kind ?? 'plain'}${c.active ? ' active' : ''}`;
        b.disabled = !!c.disabled;
        b.innerHTML = `<span>${c.label}</span>${c.sub ? `<small>${c.sub}</small>` : ''}`;
      });
      return;
    }
    this.controlsShape = shape;
    this.controlsEl.innerHTML = '';
    this.controlsEl.classList.toggle('on', !!list);
    for (const c of list ?? []) {
      if (c.kind === 'slider') {
        const wrap = document.createElement('label');
        wrap.className = 'ctl slider';
        const r = document.createElement('input');
        r.type = 'range';
        r.min = String(c.min ?? 0);
        r.max = String(c.max ?? 100);
        r.step = String(c.step ?? 1);
        r.value = String(c.value ?? 0);
        r.addEventListener('input', (e) => {
          e.stopPropagation();
          this.inputFns.get(c.id)?.(Number(r.value));
        });
        for (const ev of ['pointerdown', 'click', 'mousedown', 'touchstart'] as const) r.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
        wrap.appendChild(r);
        this.controlsEl.appendChild(wrap);
        continue;
      }
      const b = document.createElement('button');
      b.className = `ctl ${c.kind ?? 'plain'}${c.active ? ' active' : ''}`;
      b.disabled = !!c.disabled;
      if (c.kind === 'chip' && c.color) {
        b.style.background = `radial-gradient(circle, ${c.color[0]} 52%, ${c.color[1]} 54%, ${c.color[1]} 62%, ${c.color[0]} 64%)`;
        b.style.color = c.color[1];
      }
      b.innerHTML = `<span>${c.label}</span>${c.sub ? `<small>${c.sub}</small>` : ''}`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.controlsFns.get(c.id)?.();
      });
      this.controlsEl.appendChild(b);
    }
  }
  private controlsShape = '';
  private inputFns = new Map<string, (v: number) => void>();

  /** A spoken line from a person, shown as a subtitle (and as a toast in VR). */
  say(speaker: string, text: string) {
    this.subtitleEl.innerHTML = `<b>${speaker}</b> ${text}`;
    this.subtitleEl.classList.add('on');
    clearTimeout(this.subtitleTimer);
    this.subtitleTimer = window.setTimeout(() => this.subtitleEl.classList.remove('on'), 3800);
    if (this.renderer.xr.isPresenting) this.vrMessage(`${speaker}: ${text}`, 'info');
  }

  /** The big moment: BIG WIN, ON FIRE, goal complete. */
  banner(title: string, sub = '') {
    this.bannerEl.innerHTML = `<span>${title}</span>${sub ? `<small>${sub}</small>` : ''}`;
    this.bannerEl.classList.remove('on');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('on');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove('on'), 3000);
    if (this.renderer.xr.isPresenting) this.vrMessage(sub ? `${title} · ${sub}` : title, 'win');
  }

  setGoals(goals: Goal[]) {
    const sig = goals.map((g) => g.id + (g.done ? 1 : 0)).join();
    if (sig === this.goalsSig) return;
    this.goalsSig = sig;
    const done = goals.filter((g) => g.done).length;
    this.goalsEl.innerHTML =
      `<button class="head">Tonight · ${done}/${goals.length}</button><ul>` +
      goals.map((g) => `<li class="${g.done ? 'done' : ''}">${g.label}</li>`).join('') +
      '</ul>';
    (this.goalsEl.querySelector('.head') as HTMLElement).onclick = () => this.goalsEl.classList.toggle('open');
  }

  private crosshair = document.getElementById('crosshair')!;
  private promptEl = document.getElementById('prompt')!;

  /** Desktop crosshair (first-person mode) and the hint under it. */
  setAim(locked: boolean, label: string | null) {
    this.crosshair.classList.toggle('on', locked);
    this.crosshair.classList.toggle('active', locked && !!label);
    const text = label ?? '';
    if (this.promptEl.textContent !== text) this.promptEl.textContent = text;
    this.promptEl.classList.toggle('on', !!label);
    if (!locked) this.promptEl.style.top = '';
  }

  toggleMap(open?: boolean) {
    this.navEl.classList.toggle('open', open);
  }

  setNav(items: NavItem[]) {
    this.nav = items;
    this.navEl.innerHTML = '';
    for (const item of items) {
      const b = document.createElement('button');
      b.textContent = item.label;
      b.dataset.id = item.id;
      if (item.disabled) {
        b.disabled = true;
        b.title = item.disabled;
      }
      b.onclick = () => {
        this.onNavigate?.(item);
        this.toggleMap(false);
      };
      this.navEl.appendChild(b);
    }
    this.buildWrist();
  }

  setStation(id: string | null) {
    this.station = id;
    this.navEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.id === id));
    this.wrist.redraw();
  }

  /** Hides a win from the balance until the reels show it. */
  setPending(key: string, amount: number) {
    if (amount > 0) this.pending.set(key, amount);
    else this.pending.delete(key);
    this.renderBalance();
  }

  balanceShown() {
    return this.shownBalance();
  }

  get navItems() {
    return this.nav;
  }

  private shownBalance() {
    let p = 0;
    for (const v of this.pending.values()) p += v;
    return this.bankroll.balance - p;
  }

  private renderBalance() {
    this.balanceEl.textContent = money(this.shownBalance());
    if (this.wristBuilder) this.wristBuilder();
    else this.wrist?.redraw();
  }

  toast(text: string, kind: ToastKind = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toastEl.prepend(el);
    while (this.toastEl.children.length > 3) this.toastEl.lastElementChild!.remove();
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3200);

    this.vrMessage(text, kind);
  }

  private vrMessage(text: string, kind: ToastKind) {
    const p = this.vrToast;
    const ctx = p.ctx;
    ctx.clearRect(0, 0, p.pxW, p.pxH);
    roundRect(ctx, 6, 6, p.pxW - 12, p.pxH - 12, 60);
    ctx.fillStyle = kind === 'win' ? 'rgba(46,30,6,0.92)' : kind === 'warn' ? 'rgba(60,12,12,0.92)' : 'rgba(14,10,8,0.9)';
    ctx.fill();
    ctx.strokeStyle = kind === 'warn' ? '#e07a6a' : GOLD;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.fillStyle = kind === 'win' ? '#ffe08a' : GOLD_LIGHT;
    ctx.font = `600 ${text.length > 40 ? 58 : 70}px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, p.pxW / 2, p.pxH / 2 + 4);
    p.texture.needsUpdate = true;
    this.vrToastUntil = performance.now() + 2800;
  }

  private buildWrist() {
    if (this.wristBuilder) return this.wristBuilder();
    const w = this.wrist;
    w.buttons.length = 0;
    w.background = (ctx) => {
      roundRect(ctx, 4, 4, w.pxW - 8, w.pxH - 8, 36);
      ctx.fillStyle = 'rgba(14,10,8,0.92)';
      ctx.fill();
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.fillStyle = GOLD_LIGHT;
      ctx.textAlign = 'center';
      ctx.font = `italic 600 40px ${SERIF}`;
      ctx.fillText('Palazzo Lago', w.pxW / 2, 58);
      ctx.font = `600 52px ${SERIF}`;
      ctx.fillText(money(this.shownBalance()), w.pxW / 2, 120);
    };
    const items = this.nav.filter((n) => !n.disabled);
    items.forEach((item, i) => {
      w.add({
        id: item.id,
        x: 40,
        y: 160 + i * 92,
        w: w.pxW - 80,
        h: 78,
        label: item.label,
        active: () => this.station === item.id,
        onPress: () => this.onNavigate?.(item),
      });
    });
    w.redraw();
  }

  /** Opens or closes the wrist menu (Y button, or tapping your watch). */
  toggleWrist(open = !this.wristOpen) {
    this.wristOpen = open;
    if (open) this.wristBuilder?.();
  }

  get wristMenuOpen() {
    return this.wristOpen;
  }

  /** Per-frame VR placement for the wrist menu and toasts. */
  update(camera: THREE.Camera) {
    if (!this.renderer.xr.isPresenting) return;
    if (!this.wristAttached) {
      const left = this.interaction.controller('left');
      if (left) {
        left.add(this.wrist.mesh);
        this.wrist.mesh.position.set(0, 0.1, 0.05);
        this.wrist.mesh.rotation.set(-1.0, 0, 0);
        this.wristAttached = true;
      }
    }
    // Y (left controller, xr-standard button 5) toggles the menu. With hand tracking
    // there are no buttons, so the menu simply stays on the wrist.
    const gp = this.interaction.gamepads().find((g) => g.handedness === 'left')?.gamepad;
    const y = !!gp?.buttons[5]?.pressed;
    // (Not while Y answers a reply, see replyhud.ts.)
    if (y && !this.yWas && !replyPrompt.busy()) {
      this.wristOpen = !this.wristOpen;
      if (this.wristOpen) this.wristBuilder?.();
      (gp as Gamepad & { hapticActuators?: { pulse(v: number, ms: number): void }[] }).hapticActuators?.[0]?.pulse(0.4, 40);
    }
    this.yWas = y;
    // The menu shows when opened (Y, or a tap on your watch).
    if (this.wristAttached) this.wrist.mesh.visible = this.wristOpen;
    // (Where the menu is: a first-time hint by the watch, see hints.ts.)

    const p = this.vrToast.mesh;
    camera.updateMatrixWorld(true);
    const head = camera.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    fwd.y = 0;
    fwd.normalize();
    const target = head.clone().addScaledVector(fwd, 1.3);
    target.y = head.y - 0.28;
    if (!p.visible) p.position.copy(target);
    else p.position.lerp(target, 0.08);
    p.lookAt(head);
    p.visible = performance.now() < this.vrToastUntil;
  }
}

