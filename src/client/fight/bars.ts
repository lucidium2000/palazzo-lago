import * as THREE from 'three';

/**
 * Health bars, only while someone's fighting. On a screen: two slim bars at
 * the top of the HUD (you, and who you're fighting). In VR: a small bar
 * floating over each fighter's head (turned to face you), and yours as a thin
 * strip low in your view, out of the way.
 */

const W = 0.34,
  H = 0.032;

export interface OverheadBar {
  name: string;
  frac: number;
  /** Top of their head (world). */
  at: THREE.Vector3;
}

class Overhead {
  readonly group = new THREE.Group();
  private fill: THREE.Mesh;
  private fillMat: THREE.MeshBasicMaterial;
  private label: THREE.Mesh;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private name = '';
  shown = 0;

  constructor() {
    const flat = (w: number, h: number, color: number, opacity = 1) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          depthWrite: false,
          fog: false,
        }),
      );
      m.raycast = () => {};
      return m;
    };
    const frame = flat(W + 0.014, H + 0.014, 0x0b0b0d, 0.75);
    const back = flat(W, H, 0x3a0a0e);
    back.position.z = 0.001;
    this.fill = flat(W, H, 0xd8b46a);
    this.fillMat = this.fill.material as THREE.MeshBasicMaterial;
    this.fill.geometry.translate(W / 2, 0, 0);
    this.fill.position.set(-W / 2, 0, 0.002);
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 48;
    this.ctx = c.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.24, 0.045),
      new THREE.MeshBasicMaterial({
        map: this.tex,
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    );
    this.label.position.y = H / 2 + 0.032;
    this.label.raycast = () => {};
    this.group.add(frame, back, this.fill, this.label);
    this.group.visible = false;
    this.group.renderOrder = 50;
  }

  set(b: OverheadBar, cam: THREE.Vector3) {
    if (b.name !== this.name) {
      this.name = b.name;
      const g = this.ctx;
      g.clearRect(0, 0, 256, 48);
      g.font = '600 30px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 6;
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.strokeText(b.name, 128, 26);
      g.fillStyle = '#f3e6c4';
      g.fillText(b.name, 128, 26);
      this.tex.needsUpdate = true;
    }
    const f = Math.max(0.001, Math.min(1, b.frac));
    this.shown += (f - this.shown) * 0.25;
    this.fill.scale.x = Math.max(0.001, this.shown);
    this.fillMat.color.setHex(f > 0.5 ? 0xd8b46a : f > 0.25 ? 0xe07a2a : 0xd0202a);
    this.group.position.set(b.at.x, b.at.y + 0.28, b.at.z);
    this.group.lookAt(cam);
    // Same apparent size near or far (within reason).
    const d = this.group.position.distanceTo(cam);
    this.group.scale.setScalar(THREE.MathUtils.clamp(d / 2.2, 0.6, 2));
    this.group.visible = true;
  }
}

export class Bars {
  private over: Overhead[] = [];
  private mine: THREE.Group;
  private mineFill: THREE.Mesh;
  private mineFillMat: THREE.MeshBasicMaterial;
  private dom: HTMLElement;
  private domYou: HTMLElement;
  private domThem: HTMLElement;
  private domThemName: HTMLElement;
  private domThemRow: HTMLElement;
  private cam = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
  ) {
    // Yours in VR: a thin strip low in your view.
    this.mine = new THREE.Group();
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(0.15, 0.009),
      new THREE.MeshBasicMaterial({
        color: 0x2a0a0c,
        transparent: true,
        opacity: 0.7,
        depthTest: false,
        depthWrite: false,
        fog: false,
      }),
    );
    this.mineFill = new THREE.Mesh(
      new THREE.PlaneGeometry(0.15, 0.009).translate(0.075, 0, 0),
      new THREE.MeshBasicMaterial({
        color: 0x6fd06a,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        depthWrite: false,
        fog: false,
      }),
    );
    this.mineFillMat = this.mineFill.material as THREE.MeshBasicMaterial;
    this.mineFill.position.set(-0.075, 0, 0.0005);
    back.renderOrder = this.mineFill.renderOrder = 1990;
    for (const m of [back, this.mineFill]) m.raycast = () => {};
    this.mine.add(back, this.mineFill);
    this.mine.position.set(0, -0.3, -0.75);
    this.mine.visible = false;
    camera.add(this.mine);
    // On a screen: HUD bars.
    this.dom = document.createElement('div');
    this.dom.id = 'fightbars';
    this.dom.innerHTML = `
      <div class="fb-row"><span class="fb-name">You</span><div class="fb-bar"><div class="fb-fill fb-you"></div></div></div>
      <div class="fb-row fb-them-row"><span class="fb-name fb-them-name"></span><div class="fb-bar"><div class="fb-fill fb-them"></div></div></div>`;
    this.domYou = this.dom.querySelector('.fb-you')!;
    this.domThem = this.dom.querySelector('.fb-them')!;
    this.domThemName = this.dom.querySelector('.fb-them-name')!;
    this.domThemRow = this.dom.querySelector('.fb-them-row')!;
    (document.getElementById('hud') ?? document.body).appendChild(this.dom);
  }

  /**
   * Once a frame. `you`: your health fraction while you're fighting (null: no
   * bar). `opp`: who you're fighting (HUD). `heads`: bars over fighters' heads (VR).
   */
  update(inXR: boolean, you: number | null, opp: { name: string; frac: number } | null, heads: readonly OverheadBar[]) {
    this.camera.getWorldPosition(this.cam);
    for (let i = 0; i < heads.length; i++) {
      let o = this.over[i];
      if (!o) {
        o = this.over[i] = new Overhead();
        this.scene.add(o.group);
      }
      o.set(heads[i], this.cam);
      o.group.visible = inXR;
    }
    for (let i = heads.length; i < this.over.length; i++) this.over[i].group.visible = false;
    this.mine.visible = inXR && you !== null;
    if (you !== null) {
      this.mineFill.scale.x = Math.max(0.001, you);
      this.mineFillMat.color.setHex(you > 0.5 ? 0x6fd06a : you > 0.25 ? 0xe0a02a : 0xd0202a);
    }
    const showDom = !inXR && (you !== null || opp !== null);
    this.dom.classList.toggle('on', showDom);
    if (showDom) {
      this.domYou.style.width = `${Math.round((you ?? 1) * 100)}%`;
      this.domYou.classList.toggle('low', (you ?? 1) < 0.3);
      this.domThemRow.style.display = opp ? '' : 'none';
      if (opp) {
        if (this.domThemName.textContent !== opp.name) this.domThemName.textContent = opp.name;
        this.domThem.style.width = `${Math.round(Math.max(0, opp.frac) * 100)}%`;
      }
    }
  }

  dispose() {
    this.dom.remove();
    this.mine.removeFromParent();
    for (const o of this.over) o.group.removeFromParent();
  }
}
