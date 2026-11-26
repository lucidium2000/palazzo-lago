import { blankPad, type RawPad } from './types';

/**
 * Screens (desktop and phones): when you walk up to a machine the game takes
 * over the keys: arrows / WASD move the stick, Space / Enter / Z = A,
 * X / Shift = B, C = C, Esc / Backspace / E to step away. On a touch screen
 * an overlay shows a thumb stick and the machine's buttons instead of the
 * walking controls.
 */

const STYLE = `
#arc-touch{position:fixed;inset:auto 0 0 0;height:46vh;pointer-events:none;z-index:40;display:none;touch-action:none;user-select:none;-webkit-user-select:none}
body.arc-on #arc-touch{display:block}
body.arc-on #touch{display:none !important}
body.arc-on #controls{display:none !important}
#arc-touch .stick{position:absolute;left:5vw;bottom:6vh;width:150px;height:150px;border-radius:50%;background:radial-gradient(circle,#ffffff22,#ffffff0a 70%);border:2px solid #ffffff55;pointer-events:auto}
#arc-touch .stick .knob{position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#ff8a9a,#c8102e);box-shadow:0 4px 12px #0008}
#arc-touch .btns{position:absolute;right:4vw;bottom:5vh;display:flex;gap:12px;align-items:flex-end;pointer-events:auto}
#arc-touch .btns button{width:76px;height:76px;border-radius:50%;border:3px solid #fff8;color:#fff;font:700 13px system-ui,sans-serif;letter-spacing:.04em;box-shadow:0 5px 0 #0007;touch-action:none}
#arc-touch .btns button.on{transform:translateY(4px);box-shadow:0 1px 0 #0007;filter:brightness(1.3)}
#arc-touch .btns button[data-b="0"]{background:#d81b33;margin-bottom:18px}
#arc-touch .btns button[data-b="1"]{background:#d8a800}
#arc-touch .btns button[data-b="2"]{background:#138fb8;margin-bottom:18px}
#arc-touch .leave{position:fixed;top:68px;right:12px;pointer-events:auto;padding:8px 14px;border-radius:18px;border:1px solid #fff6;background:#000a;color:#fff;font:600 14px system-ui,sans-serif}
#arc-help{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);padding:6px 14px;border-radius:14px;background:#000b;color:#fff;font:600 13px system-ui,sans-serif;letter-spacing:.02em;z-index:40;display:none;pointer-events:none;white-space:nowrap}
body.arc-on:not(.touch) #arc-help{display:block}
`;

export interface DeskStation {
  id: string;
  /** What the three buttons do (empty: unused). */
  buttons: [string, string, string];
  help: string;
}

export class DeskControls {
  readonly pad: RawPad = blankPad();
  station: DeskStation | null = null;
  private keys = new Set<string>();
  private touchPad = blankPad();
  private root: HTMLElement | null = null;
  private helpEl: HTMLElement | null = null;
  private btnEls: HTMLButtonElement[] = [];
  /** Step away (Esc, the Leave button). */
  onLeave: (() => void) | null = null;
  readonly touch: boolean;

  constructor() {
    this.touch = typeof window !== 'undefined' && (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);
    addEventListener('keydown', (e) => this.key(e, true), true);
    addEventListener('keyup', (e) => this.key(e, false), true);
    addEventListener('blur', () => this.keys.clear());
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (!this.station) return;
    const t = e.target as HTMLElement | null;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
    const c = e.code;
    const game = /^(Arrow(Up|Down|Left|Right)|Key[WASDZXCJKLE]|Space|Enter|NumpadEnter|Shift(Left|Right)|Escape|Backspace)$/.test(c);
    if (!game) return;
    e.preventDefault();
    // Key-ups still reach the rest of the game (so walking keys never stick).
    if (down) e.stopImmediatePropagation();
    if (down && (c === 'Escape' || c === 'Backspace' || c === 'KeyE') && !e.repeat) {
      this.onLeave?.();
      return;
    }
    if (down) this.keys.add(c);
    else this.keys.delete(c);
  }

  /** Merge keys and touch into the pad (call once a frame). */
  poll(): RawPad {
    const k = this.keys;
    const kx = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
    const ky = (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0) - (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0);
    const tp = this.touchPad;
    this.pad.x = Math.max(-1, Math.min(1, kx + tp.x));
    this.pad.y = Math.max(-1, Math.min(1, ky + tp.y));
    this.pad.a = k.has('Space') || k.has('Enter') || k.has('NumpadEnter') || k.has('KeyZ') || k.has('KeyJ') || tp.a;
    this.pad.b = k.has('KeyX') || k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyK') || tp.b;
    this.pad.c = k.has('KeyC') || k.has('KeyL') || tp.c;
    return this.pad;
  }

  enter(st: DeskStation) {
    this.station = st;
    this.keys.clear();
    this.build();
    for (let b = 0; b < 3; b++) {
      const el = this.btnEls[b];
      el.textContent = st.buttons[b];
      el.hidden = !st.buttons[b];
    }
    if (this.helpEl) this.helpEl.textContent = st.help;
    document.body.classList.add('arc-on');
  }

  exit() {
    this.station = null;
    this.keys.clear();
    Object.assign(this.touchPad, blankPad());
    document.body.classList.remove('arc-on');
  }

  private build() {
    if (this.root) return;
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    const root = document.createElement('div');
    root.id = 'arc-touch';
    root.innerHTML = `<div class="stick"><div class="knob"></div></div><div class="btns"><button data-b="2">C</button><button data-b="1">B</button><button data-b="0">A</button></div><button class="leave">Leave</button>`;
    document.body.appendChild(root);
    this.root = root;
    const help = document.createElement('div');
    help.id = 'arc-help';
    document.body.appendChild(help);
    this.helpEl = help;
    root.querySelector('.leave')!.addEventListener('click', () => this.onLeave?.());
    // Buttons: held while a finger is on them.
    this.btnEls = [0, 1, 2].map((b) => root.querySelector(`button[data-b="${b}"]`) as HTMLButtonElement);
    this.btnEls.forEach((el, b) => {
      const set = (on: boolean) => {
        if (b === 0) this.touchPad.a = on;
        else if (b === 1) this.touchPad.b = on;
        else this.touchPad.c = on;
        el.classList.toggle('on', on);
      };
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
        set(true);
      });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, () => set(false));
    });
    // The thumb stick.
    const base = root.querySelector('.stick') as HTMLElement;
    const knob = base.querySelector('.knob') as HTMLElement;
    let id: number | null = null;
    const move = (x: number, y: number) => {
      const r = base.getBoundingClientRect();
      const R = r.width / 2 - 10;
      let dx = x - (r.left + r.width / 2),
        dy = y - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d > R) {
        dx *= R / d;
        dy *= R / d;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.touchPad.x = dx / R;
      this.touchPad.y = -dy / R;
    };
    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      id = e.pointerId;
      base.setPointerCapture(e.pointerId);
      move(e.clientX, e.clientY);
    });
    base.addEventListener('pointermove', (e) => {
      if (e.pointerId === id) move(e.clientX, e.clientY);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      knob.style.transform = '';
      this.touchPad.x = this.touchPad.y = 0;
    };
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
  }
}
