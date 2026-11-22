import type { Player } from './player';

/**
 * Phone and tablet controls: a thumb joystick (bottom left) to walk, and a
 * context button (bottom right) that sits, stands, sips or sets down. Dragging
 * anywhere else on the screen looks around; tapping plays.
 */
export class TouchControls {
  private root: HTMLElement;
  private base: HTMLElement;
  private knob: HTMLElement;
  private action: HTMLButtonElement;
  private actionFn: (() => void) | null = null;
  private active: number | null = null;
  private center = { x: 0, y: 0 };
  readonly enabled: boolean;

  constructor(private player: Player) {
    this.enabled = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.root = document.getElementById('touch')!;
    this.base = document.getElementById('stick')!;
    this.knob = this.base.querySelector('.knob') as HTMLElement;
    this.action = document.getElementById('action') as HTMLButtonElement;
    document.body.classList.toggle('touch', this.enabled);
    if (!this.enabled) return;

    const R = 52;
    const set = (x: number, y: number) => {
      let dx = x - this.center.x,
        dy = y - this.center.y;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        dx *= R / d;
        dy *= R / d;
      }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.player.stick.set(dx / R, -dy / R);
    };
    this.base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.active = e.pointerId;
      this.base.setPointerCapture(e.pointerId);
      const r = this.base.getBoundingClientRect();
      this.center = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      this.base.classList.add('on');
      set(e.clientX, e.clientY);
    });
    this.base.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.active) return;
      e.preventDefault();
      set(e.clientX, e.clientY);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.active) return;
      this.active = null;
      this.base.classList.remove('on');
      this.knob.style.transform = '';
      this.player.stick.set(0, 0);
    };
    this.base.addEventListener('pointerup', end);
    this.base.addEventListener('pointercancel', end);
    this.action.addEventListener('click', (e) => {
      e.stopPropagation();
      this.actionFn?.();
    });
  }

  /** Shows the context button with a label, or hides it. */
  setAction(label: string | null, fn: (() => void) | null = null) {
    if (!this.enabled) return;
    this.actionFn = fn;
    if (label === null) {
      this.action.hidden = true;
      return;
    }
    if (this.action.textContent !== label) this.action.textContent = label;
    this.action.hidden = false;
  }

  setVisible(v: boolean) {
    this.root.hidden = !v || !this.enabled;
  }
}
