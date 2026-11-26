import * as THREE from 'three';
import { CanvasPanel, GOLD, GOLD_LIGHT, roundRect, SERIF } from './panel';

/**
 * Bar Lago's menu, the menus you order from (an on-screen card, and a panel
 * on the bar top in VR), and the sportsbook TV above the bar.
 */

/** `cup`: a food court soda cup (opaque paper, `cup` is its colour). */
export type GlassShape = 'coupe' | 'flute' | 'rocks' | 'martini' | 'pint' | 'shot' | 'cup';

export interface DrinkKind {
  name: string;
  /** What you pay at the bar (a $2 tip is added at the register). */
  price: number;
  section: 'Cocktails' | 'Beer' | 'Whiskey' | 'Shots' | 'Champagne' | 'Mocktails' | 'Food court';
  liquid: number;
  glass: GlassShape;
  garnish?: number;
  ice?: boolean;
  foam?: boolean;
  /** Standard drinks of alcohol (0 for mocktails). */
  alcohol: number;
  /** How the bartender makes it. */
  prep: 'shake' | 'stir' | 'pour' | 'tap';
  /** A paper cup's colour (the food court's sodas). */
  cup?: number;
  /** Not on Bar Lago's menu (the food court's sodas, on the Promenade's tables). */
  offMenu?: boolean;
}

export const TIP = 2;

export const DRINKS: DrinkKind[] = [
  { name: 'Lago Spritz', price: 18, section: 'Cocktails', liquid: 0xff6a1a, glass: 'rocks', garnish: 0xffa040, ice: true, alcohol: 1, prep: 'stir' },
  { name: 'Negroni', price: 18, section: 'Cocktails', liquid: 0xb0101a, glass: 'rocks', garnish: 0xff8a30, ice: true, alcohol: 1.5, prep: 'stir' },
  { name: 'Dry Martini', price: 18, section: 'Cocktails', liquid: 0xe8ecd8, glass: 'martini', garnish: 0x5a8a2a, alcohol: 1.5, prep: 'shake' },
  { name: 'Espresso Martini', price: 18, section: 'Cocktails', liquid: 0x2a140a, glass: 'coupe', garnish: 0x3a2010, foam: true, alcohol: 1, prep: 'shake' },
  { name: 'Lager on tap', price: 12, section: 'Beer', liquid: 0xe8b040, glass: 'pint', foam: true, alcohol: 1, prep: 'tap' },
  { name: 'Hazy IPA', price: 12, section: 'Beer', liquid: 0xd8902a, glass: 'pint', foam: true, alcohol: 1.3, prep: 'tap' },
  { name: 'Bourbon, neat', price: 22, section: 'Whiskey', liquid: 0x9a4a10, glass: 'rocks', alcohol: 1.5, prep: 'pour' },
  { name: 'Scotch on the rocks', price: 22, section: 'Whiskey', liquid: 0xb8661a, glass: 'rocks', ice: true, alcohol: 1.5, prep: 'pour' },
  { name: 'Tequila shot', price: 15, section: 'Shots', liquid: 0xf2e6b0, glass: 'shot', garnish: 0x7ac043, alcohol: 1, prep: 'pour' },
  { name: 'Lemon Drop shot', price: 15, section: 'Shots', liquid: 0xf6e870, glass: 'shot', alcohol: 1, prep: 'shake' },
  { name: 'Champagne', price: 24, section: 'Champagne', liquid: 0xf2d88a, glass: 'flute', alcohol: 1, prep: 'pour' },
  { name: 'Virgin Mojito', price: 10, section: 'Mocktails', liquid: 0xb8e090, glass: 'rocks', garnish: 0x3a8a2a, ice: true, alcohol: 0, prep: 'stir' },
  { name: 'Shirley Temple', price: 10, section: 'Mocktails', liquid: 0xe8404a, glass: 'flute', garnish: 0xb0101a, alcohol: 0, prep: 'pour' },
  // The food court's fountain drinks (on the Promenade's tables, by the diners' plates). Always last: indices are sent to friends.
  { name: 'Cola', price: 4, section: 'Food court', liquid: 0x3a1a0a, glass: 'cup', cup: 0xb8101a, ice: true, alcohol: 0, prep: 'pour', offMenu: true },
  { name: 'Lemonade', price: 4, section: 'Food court', liquid: 0xf6e890, glass: 'cup', cup: 0xe8b040, ice: true, alcohol: 0, prep: 'pour', offMenu: true },
  { name: 'Iced tea', price: 4, section: 'Food court', liquid: 0x8a4a14, glass: 'cup', cup: 0x3a1a0a, ice: true, alcohol: 0, prep: 'pour', offMenu: true },
  { name: 'Vanilla shake', price: 6, section: 'Food court', liquid: 0xf2e8d0, glass: 'cup', cup: 0xf2f2f2, foam: true, alcohol: 0, prep: 'pour', offMenu: true },
];

/** What Bar Lago serves (its menus list these). */
export const BAR_MENU = DRINKS.filter((d) => !d.offMenu);

/** Seconds the bartender takes, by method. */
export const PREP_TIME: Record<DrinkKind['prep'], number> = { shake: 4.2, stir: 3.4, pour: 2.4, tap: 3.0 };

// ---------------------------------------------------------------------------
// On-screen menu card (desktop and phones)
// ---------------------------------------------------------------------------

const CSS = `
#bar-menu{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(92vw,560px);max-height:min(86vh,640px);overflow-y:auto;
 background:rgba(18,12,8,.96);border:1.5px solid #d8b25a;border-radius:18px;padding:18px 20px;color:#ecdfc2;z-index:30;font-family:Georgia,serif;display:none}
#bar-menu.on{display:block}
#bar-menu h3{margin:0 0 2px;text-align:center;font-style:italic;font-size:30px;color:#f6d98a}
#bar-menu .sub{text-align:center;font-size:13px;color:#b9a77e;margin-bottom:10px}
#bar-menu h4{margin:12px 0 4px;font-size:14px;letter-spacing:.12em;color:#d8b25a;text-transform:uppercase}
#bar-menu button.item{display:flex;width:100%;justify-content:space-between;align-items:center;margin:4px 0;padding:9px 14px;border-radius:12px;font-size:16px;text-align:left}
#bar-menu button.item .sw{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:10px;vertical-align:-1px;border:1px solid rgba(255,255,255,.4)}
#bar-menu .row{display:flex;gap:8px;justify-content:center;margin-top:12px}
`;

export class BarMenuCard {
  private el: HTMLDivElement;
  onPick: ((k: DrinkKind) => void) | null = null;
  onTip: (() => void) | null = null;
  onClose: (() => void) | null = null;

  constructor() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.id = 'bar-menu';
    document.body.appendChild(this.el);
    const sections = [...new Set(BAR_MENU.map((d) => d.section))];
    let html = `<h3>Bar Lago</h3><div class="sub">Prices plus a $${TIP} tip · keys 1–9 to order fast · Esc to close</div>`;
    let n = 0;
    for (const s of sections) {
      html += `<h4>${s}</h4>`;
      for (const d of BAR_MENU.filter((x) => x.section === s)) {
        const hex = '#' + new THREE.Color(d.liquid).getHexString();
        html += `<button class="item" data-i="${DRINKS.indexOf(d)}"><span><span class="sw" style="background:${hex}"></span>${++n <= 9 ? `<b>${n}</b> · ` : ''}${d.name}</span><span>$${d.price}</span></button>`;
      }
    }
    html += `<div class="row"><button class="tip">Tip the bartender $5</button><button class="close">Close</button></div>`;
    this.el.innerHTML = html;
    this.el.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
      if (!b) return;
      if (b.classList.contains('close')) return this.close();
      if (b.classList.contains('tip')) return this.onTip?.();
      const i = Number(b.dataset.i);
      if (DRINKS[i]) {
        this.close();
        this.onPick?.(DRINKS[i]);
      }
    });
    addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.key === 'Escape') this.close();
      const k = Number(e.key);
      if (k >= 1 && k <= 9 && DRINKS[k - 1]) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.close();
        this.onPick?.(DRINKS[k - 1]);
      }
    }, true);
  }

  get open() {
    return this.el.classList.contains('on');
  }

  show() {
    if (document.pointerLockElement) document.exitPointerLock();
    this.el.classList.add('on');
  }

  close() {
    if (!this.open) return;
    this.el.classList.remove('on');
    this.onClose?.();
  }
}

// ---------------------------------------------------------------------------
// VR menu: a panel standing on the bar top in front of you
// ---------------------------------------------------------------------------

export function buildVrMenu(onPick: (k: DrinkKind) => void, onTip: () => void, status: () => string): CanvasPanel {
  const p = new CanvasPanel(0.62, 900, 1040, { transparent: true, doubleSided: false });
  p.background = (ctx) => {
    roundRect(ctx, 4, 4, p.pxW - 8, p.pxH - 8, 30);
    ctx.fillStyle = 'rgba(18,12,8,0.94)';
    ctx.fill();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = GOLD_LIGHT;
    ctx.textAlign = 'center';
    ctx.font = `italic 600 54px ${SERIF}`;
    ctx.fillText('Bar Lago', p.pxW / 2, 70);
    ctx.font = `italic 26px ${SERIF}`;
    ctx.fillStyle = '#cbb991';
    ctx.fillText(status(), p.pxW / 2, 112);
  };
  const cols = 2;
  const bw = (p.pxW - 60 - 12) / cols;
  BAR_MENU.forEach((d, i) =>
    p.add({
      id: `d${i}`,
      x: 30 + (i % cols) * (bw + 12),
      y: 136 + Math.floor(i / cols) * 112,
      w: bw,
      h: 100,
      label: d.name,
      sub: `$${d.price} · ${d.section.toLowerCase()}`,
      onPress: () => onPick(d),
    }),
  );
  p.add({ id: 'tip', x: 30, y: p.pxH - 106, w: p.pxW - 60, h: 80, label: 'Tip the bartender $5', onPress: () => onTip() });
  p.redraw();
  return p;
}

// ---------------------------------------------------------------------------
// Sportsbook TV over the bar
// ---------------------------------------------------------------------------

const GAMES = [
  ['Las Vegas', 'Denver', '-3.5', 'O/U 47.5'],
  ['Phoenix', 'Dallas', '+2', 'O/U 221'],
  ['Seattle', 'San Diego', '-1.5', 'O/U 8.5'],
  ['Chicago', 'Boston', '+6', 'O/U 44'],
  ['Miami', 'New York', '-4', 'O/U 216.5'],
  ['Utah', 'Portland', 'PK', 'O/U 6'],
];

export class SportsTicker {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  private c: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private t = 0;
  private last = -1;
  private scores = GAMES.map(() => [Math.floor(Math.random() * 30), Math.floor(Math.random() * 30)]);

  constructor() {
    this.c = document.createElement('canvas');
    this.c.width = 768;
    this.c.height = 432;
    this.g = this.c.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.675), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.73, 0.05), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.3 }));
    bezel.position.z = -0.03;
    this.group.add(bezel, screen);
    screen.raycast = () => {};
    bezel.raycast = () => {};
    this.mesh = screen;
    this.draw();
  }

  update(dt: number) {
    this.t += dt;
    if (this.t - this.last < 0.16) return;
    this.last = this.t;
    if (Math.random() < 0.01) {
      const i = Math.floor(Math.random() * this.scores.length);
      this.scores[i][Math.random() < 0.5 ? 0 : 1] += Math.random() < 0.5 ? 3 : 7;
    }
    this.draw();
  }

  private draw() {
    const g = this.g;
    const W = this.c.width,
      H = this.c.height;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0a1a3a');
    bg.addColorStop(1, '#040812');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#d4a94e';
    g.fillRect(0, 0, W, 56);
    g.fillStyle = '#140c06';
    g.font = 'bold 32px Georgia, serif';
    g.textAlign = 'left';
    g.fillText('LAGO SPORTSBOOK', 22, 40);
    g.textAlign = 'right';
    g.font = 'bold 24px Georgia, serif';
    g.fillText('LIVE', W - 22, 38);
    g.textAlign = 'left';
    GAMES.slice(0, 4).forEach((row, i) => {
      const y = 100 + i * 70;
      const page = Math.floor(this.t / 6) % 2;
      const r = GAMES[(i + page * 2) % GAMES.length];
      const s = this.scores[(i + page * 2) % GAMES.length];
      g.fillStyle = i % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.08)';
      g.fillRect(14, y - 40, W - 28, 62);
      g.fillStyle = '#ffffff';
      g.font = '26px Georgia, serif';
      g.fillText(`${r[0]}  ${s[0]}`, 30, y - 2);
      g.fillText(`${r[1]}  ${s[1]}`, 300, y - 2);
      g.fillStyle = '#ffd98a';
      g.fillText(r[2], 560, y - 2);
      g.fillStyle = '#9ad0ff';
      g.font = '20px Georgia, serif';
      g.fillText(r[3], 640, y - 2);
      void row;
    });
    // Scrolling crawl along the bottom.
    const crawl = 'Fight night Saturday · Lines move fast, bet responsibly · Parlay of the night pays 12 to 1 · Ask your bartender about the game-day special · ';
    g.fillStyle = '#b8101a';
    g.fillRect(0, H - 50, W, 50);
    g.fillStyle = '#ffffff';
    g.font = 'bold 24px Georgia, serif';
    const w = g.measureText(crawl).width;
    const off = (this.t * 90) % w;
    g.fillText(crawl + crawl, -off, H - 17);
    this.tex.needsUpdate = true;
  }
}
