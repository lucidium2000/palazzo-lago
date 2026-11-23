import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { GameContext } from './game';
import type { Grabbable, Hands } from './hands';
import { bakeStatic, dynamic } from './merge';
import { assets } from './assets';
import { textSign } from './panel';
import type { Crowd, Person } from './people';
import { randomLook, staffLook } from './people';
import type { Player } from './player';
import { marble, radial, toTexture, wood } from './textures';
import type { World } from './world';

/**
 * The lounge: Bar Lago along the west wall (order a drink, hold it, sip it),
 * armchairs with guests, and a grand piano with a pianist playing live.
 */

export interface LoungeDeps extends GameContext {
  crowd: Crowd;
  hands: Hands;
  player: Player;
  world: World;
}

interface DrinkKind {
  name: string;
  liquid: number;
  glass: 'coupe' | 'flute' | 'rocks' | 'martini';
  garnish?: number;
}

const MENU: DrinkKind[] = [
  { name: 'Lago Spritz', liquid: 0xff6a1a, glass: 'rocks', garnish: 0xffa040 },
  { name: 'Negroni', liquid: 0xb0101a, glass: 'rocks', garnish: 0xff8a30 },
  { name: 'Dry Martini', liquid: 0xe8ecd8, glass: 'martini', garnish: 0x5a8a2a },
  { name: 'Champagne', liquid: 0xf2d88a, glass: 'flute' },
  { name: 'Bellini', liquid: 0xffb08a, glass: 'flute' },
  { name: 'Old Fashioned', liquid: 0x9a4a10, glass: 'rocks', garnish: 0xff8a30 },
];

const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  roughness: 0.04,
  metalness: 0,
  transparent: true,
  opacity: 0.28,
  envMapIntensity: 2.2,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const mats = new Map<string, THREE.Material>();
function liquidMat(color: number, clear = true): THREE.Material {
  const key = `${color}-${clear}`;
  let m = mats.get(key);
  if (!m) {
    m = clear
      ? new THREE.MeshStandardMaterial({ color, roughness: 0.1, transparent: true, opacity: 0.82, emissive: color, emissiveIntensity: 0.12 })
      : new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    mats.set(key, m);
  }
  return m;
}
const iceMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, roughness: 0.1 });

export class Drink {
  readonly group = new THREE.Group();
  level = 1;
  private liquid: THREE.Mesh;
  private liquidTop: number;
  private liquidBottom: number;

  constructor(readonly kind: DrinkKind) {
    const profile: Record<DrinkKind['glass'], [number, number][]> = {
      rocks: [[0, 0], [0.042, 0], [0.044, 0.004], [0.046, 0.09], [0.044, 0.09], [0.042, 0.008], [0, 0.008]],
      flute: [[0, 0], [0.035, 0], [0.036, 0.004], [0.005, 0.01], [0.004, 0.1], [0.022, 0.13], [0.028, 0.21], [0.026, 0.21], [0.02, 0.13], [0, 0.11]],
      martini: [[0, 0], [0.04, 0], [0.04, 0.004], [0.005, 0.01], [0.004, 0.1], [0.06, 0.16], [0.058, 0.16], [0, 0.104]],
      coupe: [[0, 0], [0.04, 0], [0.005, 0.01], [0.004, 0.09], [0.05, 0.12], [0.06, 0.14], [0.058, 0.14], [0, 0.095]],
    };
    const pts = profile[kind.glass].map(([r, y]) => new THREE.Vector2(r, y));
    const glass = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), glassMat);
    glass.renderOrder = 2;
    this.group.add(glass);
    const shapes: Record<DrinkKind['glass'], () => [THREE.BufferGeometry, number, number]> = {
      rocks: () => [new THREE.CylinderGeometry(0.04, 0.039, 1, 18).translate(0, 0.5, 0), 0.01, 0.07],
      flute: () => [new THREE.CylinderGeometry(0.024, 0.017, 1, 14).translate(0, 0.5, 0), 0.115, 0.19],
      martini: () => [new THREE.CylinderGeometry(0.052, 0.004, 1, 18).translate(0, 0.5, 0), 0.105, 0.15],
      coupe: () => [new THREE.CylinderGeometry(0.05, 0.01, 1, 18).translate(0, 0.5, 0), 0.096, 0.13],
    };
    const [geo, bottom, top] = shapes[kind.glass]();
    this.liquidBottom = bottom;
    this.liquidTop = top;
    this.liquid = new THREE.Mesh(geo, liquidMat(kind.liquid));
    this.liquid.renderOrder = 1;
    this.group.add(this.liquid);
    if (kind.glass === 'rocks') {
      const ice = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), iceMat);
      ice.position.set(0.008, 0.06, 0.004);
      ice.rotation.set(0.4, 0.6, 0.2);
      this.group.add(ice);
    }
    if (kind.garnish) {
      const g = new THREE.Mesh(
        kind.glass === 'martini' ? new THREE.SphereGeometry(0.01, 8, 6) : new THREE.TorusGeometry(0.022, 0.006, 6, 16, Math.PI),
        liquidMat(kind.garnish, false),
      );
      if (kind.glass === 'martini') g.position.set(0.01, 0.135, 0);
      else {
        g.position.set(0.04, 0.085, 0);
        g.rotation.set(0, 0, -1.2);
      }
      this.group.add(g);
    }
    this.setLevel(1);
  }

  setLevel(l: number) {
    this.level = Math.max(0, l);
    const h = (this.liquidTop - this.liquidBottom) * this.level;
    this.liquid.visible = this.level > 0.02;
    this.liquid.scale.set(1, Math.max(0.001, h), 1);
    this.liquid.position.y = this.liquidBottom;
  }
}

export class Lounge {
  readonly bar = new THREE.Group();
  readonly piano = new THREE.Group();
  private bartender: Person | null = null;
  private bartenderZ = 9;
  private pending: { t: number; z: number } | null = null;
  private waiting: Drink | null = null;
  /** The drink you are carrying on desktop. */
  private desktopDrink: Drink | null = null;
  private menuIndex = 0;
  private sipCooldown = 0;
  private falling: { obj: THREE.Object3D; v: number; floor: number }[] = [];
  private raycaster = new THREE.Raycaster();
  onOrder: (() => void) | null = null;
  onTip: (() => void) | null = null;
  onRound: (() => void) | null = null;
  private roundPending = 0;

  static readonly COUNTER_X = -15.0;
  static readonly COUNTER_Z0 = 6.2;
  static readonly COUNTER_Z1 = 12.4;
  static readonly TOP = 1.1;

  constructor(private d: LoungeDeps) {
    d.scene.add(this.bar, this.piano);
    this.buildBar();
    this.buildSeating();
    this.buildPiano();
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyQ') this.putDownDesktop();
      if (e.code === 'KeyF' && this.desktopDrink) this.sip(this.desktopDrink);
    });
  }

  // ---------------------------------------------------------------------------
  // Bar Lago
  // ---------------------------------------------------------------------------

  private buildBar() {
    const { world, crowd } = this.d;
    const q = this.d.quality;
    const woodTex = toTexture(wood(512));
    woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
    woodTex.repeat.set(2, 6);
    const woodMat = assets.material('walnut', { repeat: [2, 6], rough: 0.6, fallback: () => new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.35 }) });
    const top = assets.material('darkmarble', { repeat: [1, 6], rough: 0.25, envIntensity: 1.4, fallback: () => new THREE.MeshStandardMaterial({ map: toTexture(marble(512, 'dark', 21)), roughness: 0.08, envMapIntensity: 1.4 }) });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 1, roughness: 0.25 });
    const leather = assets.material('leather', { repeat: 1, rough: 0.8, tint: 0x8a5050, fallback: () => new THREE.MeshStandardMaterial({ color: 0x3a1015, roughness: 0.5 }) });
    const glow = new THREE.MeshBasicMaterial({ color: 0xffb860 });
    const x = Lounge.COUNTER_X,
      z0 = Lounge.COUNTER_Z0,
      z1 = Lounge.COUNTER_Z1;
    const len = z1 - z0,
      zc = (z0 + z1) / 2;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      this.bar.add(m);
      return m;
    };
    // Counter: wooden body with gold-trimmed panels, a dark marble top, a brass foot rail.
    add(new THREE.BoxGeometry(0.6, 1.05, len), woodMat, x, 0.525, zc);
    for (let k = 0; k < 6; k++) add(new THREE.BoxGeometry(0.01, 0.7, len / 6 - 0.16), gold, x + 0.305, 0.55, z0 + (k + 0.5) * (len / 6));
    add(new RoundedBoxGeometry(0.78, 0.06, len + 0.12, 2, 0.02), top, x + 0.05, Lounge.TOP - 0.03, zc);
    const rail = add(new THREE.CylinderGeometry(0.025, 0.025, len, 10), gold, x + 0.42, 0.2, zc);
    rail.rotation.x = Math.PI / 2;
    // Under-counter glow strip on the guest side.
    add(new THREE.BoxGeometry(0.02, 0.02, len), glow, x + 0.31, 1.0, zc);

    // Back bar: cabinet, backlit wall, three glass shelves of bottles.
    const wallX = -17.8;
    add(new THREE.BoxGeometry(0.5, 0.95, len), woodMat, wallX + 0.25, 0.475, zc);
    add(new THREE.BoxGeometry(0.55, 0.04, len), top, wallX + 0.27, 0.97, zc);
    const back = add(new THREE.PlaneGeometry(len, 1.6), new THREE.MeshBasicMaterial({ map: toTexture(radial(256, '#ffd9a0', '#7a4a20')) }), wallX + 0.03, 1.85, zc);
    back.rotation.y = Math.PI / 2;
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.05, envMapIntensity: 2 });
    const shelves = [1.3, 1.72, 2.14];
    for (const y of shelves) add(new THREE.BoxGeometry(0.3, 0.015, len - 0.2), shelfMat, wallX + 0.17, y, zc);
    for (const z of [z0 + 0.05, z1 - 0.05]) add(new THREE.BoxGeometry(0.34, 1.6, 0.06), woodMat, wallX + 0.17, 1.85, z);
    // Bottles: instanced, varied colours and heights.
    const bottleGeo = new THREE.LatheGeometry(
      [
        [0, 0],
        [0.035, 0],
        [0.036, 0.2],
        [0.03, 0.23],
        [0.012, 0.27],
        [0.012, 0.33],
        [0, 0.33],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      12,
    );
    const perShelf = Math.floor((len - 0.4) / 0.11);
    const bottles = new THREE.InstancedMesh(bottleGeo, new THREE.MeshStandardMaterial({ roughness: 0.08, envMapIntensity: 2, transparent: true, opacity: 0.9 }), shelves.length * perShelf);
    const colors = [0x2a5a1a, 0x6a3a0a, 0xd8d0b0, 0x8a1010, 0x1a2a4a, 0xc08a20, 0x3a0a20, 0xe8e8f0];
    const tmp = new THREE.Object3D();
    let n = 0;
    shelves.forEach((y, si) => {
      for (let k = 0; k < perShelf; k++) {
        tmp.position.set(wallX + 0.17 + ((k * 7) % 3 - 1) * 0.05, y + 0.008, z0 + 0.25 + k * 0.11);
        tmp.scale.set(1, 0.8 + ((k * 13 + si * 5) % 7) * 0.06, 1);
        tmp.updateMatrix();
        bottles.setMatrixAt(n, tmp.matrix);
        bottles.setColorAt(n++, new THREE.Color(colors[(k * 5 + si * 3) % colors.length]));
      }
    });
    bottles.raycast = () => {};
    this.bar.add(bottles);
    // A backlit onyx feature wall rising behind the back bar, framed in gold.
    {
      const [oc, og] = (() => {
        const cv = document.createElement('canvas');
        cv.width = 1024;
        cv.height = 384;
        return [cv, cv.getContext('2d')!] as const;
      })();
      const grd = og.createLinearGradient(0, 0, 1024, 384);
      grd.addColorStop(0, '#e9a64a');
      grd.addColorStop(0.5, '#f6cf86');
      grd.addColorStop(1, '#d98a36');
      og.fillStyle = grd;
      og.fillRect(0, 0, 1024, 384);
      let sd = 9;
      const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
      for (let k = 0; k < 90; k++) {
        og.strokeStyle = `rgba(${120 + rnd() * 60},${60 + rnd() * 40},20,${0.15 + rnd() * 0.3})`;
        og.lineWidth = 1 + rnd() * 5;
        og.beginPath();
        let x = rnd() * 1024,
          y = rnd() * 384;
        og.moveTo(x, y);
        for (let j = 0; j < 6; j++) {
          x += (rnd() - 0.3) * 200;
          y += (rnd() - 0.5) * 80;
          og.quadraticCurveTo(x - 40, y + 30, x, y);
        }
        og.stroke();
      }
      const onyxTex = new THREE.CanvasTexture(oc);
      onyxTex.colorSpace = THREE.SRGBColorSpace;
      const onyx = add(new THREE.PlaneGeometry(len - 0.4, 2.0), new THREE.MeshBasicMaterial({ map: onyxTex, color: new THREE.Color(1.15, 1.05, 0.95) }), wallX + 0.04, 3.9, zc);
      onyx.rotation.y = Math.PI / 2;
      const frameMat = new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 1, roughness: 0.3 });
      for (const y of [2.88, 4.92]) add(new THREE.BoxGeometry(0.06, 0.06, len - 0.3), frameMat, wallX + 0.06, y, zc);
      for (const z of [z0 + 0.15, z1 - 0.15]) add(new THREE.BoxGeometry(0.06, 2.1, 0.06), frameMat, wallX + 0.06, 3.9, z);
    }
    const sign = textSign('Bar Lago', { width: 2.4, px: 140, bg: 'rgba(24,14,8,0.82)' });
    sign.position.set(wallX + 0.12, 3.9, zc);
    sign.rotation.y = Math.PI / 2;
    this.bar.add(sign);

    // Stools along the guest side.
    const stoolZ = [6.9, 8.1, 9.3, 10.5, 11.7];
    for (const z of stoolZ) {
      add(new THREE.CylinderGeometry(0.2, 0.18, 0.08, 20), leather, x + 0.6, 0.78, z);
      add(new THREE.CylinderGeometry(0.025, 0.025, 0.74, 8), gold, x + 0.6, 0.38, z);
      add(new THREE.TorusGeometry(0.15, 0.012, 6, 20).rotateX(Math.PI / 2), gold, x + 0.6, 0.3, z);
      add(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 20), gold, x + 0.6, 0.015, z);
      world.addCircle(x + 0.6, z, 0.2);
    }
    void q;
    bakeStatic(this.bar);

    // Colliders: the counter, and the space behind it is staff only.
    world.addBox(x, zc, 0.8, len + 0.2);
    world.addBox(-16.5, zc, 2.6, len + 0.2);

    // Bartender and a few regulars.
    this.bartender = crowd.add('bartender', staffLook('bar'), new THREE.Vector3(-16.0, 0, 9), Math.PI / 2);
    if (this.bartender) {
      this.bartender.onUpdate = (p, dt) => {
        const dz = this.bartenderZ - p.pos.z;
        const v = THREE.MathUtils.clamp(dz * 2, -1, 1);
        p.pos.z += v * dt;
        p.moving = Math.abs(v);
        p.walkPhase += Math.abs(v) * dt * 5;
        if (p.action <= 0 && Math.random() < 0.002) {
          p.actionKind = 'wipe';
          p.action = 3;
        }
      };
    }
    for (const z of [stoolZ[0], stoolZ[3]]) {
      const pat = crowd.add('patron', randomLook(), new THREE.Vector3(x + 0.62, 0, z), -Math.PI / 2);
      if (pat) {
        pat.seatY = 0.8;
        pat.onUpdate = (p) => {
          if (p.action <= 0 && Math.random() < 0.003) {
            p.actionKind = 'sip';
            p.action = 1.4;
          }
        };
      }
    }

    // A little tent card on the bar: buy the boys a round.
    const cardTex = (() => {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 160;
      const g = c.getContext('2d')!;
      g.fillStyle = '#f6eedc';
      g.fillRect(0, 0, 256, 160);
      g.strokeStyle = '#b8862c';
      g.lineWidth = 6;
      g.strokeRect(6, 6, 244, 148);
      g.fillStyle = '#5a1a20';
      g.textAlign = 'center';
      g.font = 'italic bold 34px Georgia, serif';
      g.fillText('Buy a Round', 128, 62);
      g.font = '24px Georgia, serif';
      g.fillText('for the crew · $80', 128, 108);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const card = new THREE.Group();
    const cardMat = new THREE.MeshStandardMaterial({ map: cardTex, roughness: 0.6, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), cardMat);
      face.rotation.set(s * 0.35, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      face.rotation.order = 'YXZ';
      face.rotation.set(-0.35 * s, Math.PI / 2, 0);
      face.position.set(s * 0.017, 0.05, 0);
      card.add(face);
    }
    card.position.set(x + 0.3, Lounge.TOP, zc + 1.0);
    card.rotation.y = 0;
    this.d.scene.add(card);
    this.d.interaction.register({
      object: card,
      label: () => (this.roundPending > 0 ? 'A round is on its way…' : 'Buy the boys a round · $80 (four drinks, tip included)'),
      onSelect: () => this.buyRound(),
    });

    // Ordering: point at / click the bar top.
    // A thin strip on the bar top (glasses standing on it stay clickable).
    const counterHit = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.03, len), new THREE.MeshBasicMaterial({ visible: false }));
    counterHit.position.set(x + 0.05, Lounge.TOP - 0.005, zc);
    this.d.scene.add(counterHit);
    this.d.interaction.register({
      object: counterHit,
      kind: 'button',
      label: () => (this.pending ? 'Your drink is being made…' : this.waiting ? 'Your drink is on the bar' : `Order a ${MENU[this.menuIndex].name} · $20 with tip (cocktail servers comp you while you play)`),
      onSelect: (e) => this.order(e.hit.point.z),
    });
  }

  private order(z: number) {
    if (this.pending) return;
    if (this.waiting) {
      this.d.hud.toast('Your drink is waiting on the bar', 'info');
      return;
    }
    // Strip bar prices: an $18 cocktail plus a $2 tip. (Drinks are only free
    // from the cocktail servers on the floor while you are gambling.)
    if (!this.d.bankroll.canAfford(20)) {
      this.d.hud.toast('Not enough chips for a drink', 'warn');
      return;
    }
    this.d.bankroll.debit(20, 'bet', 'bar');
    const zz = THREE.MathUtils.clamp(z, Lounge.COUNTER_Z0 + 0.4, Lounge.COUNTER_Z1 - 0.4);
    this.bartenderZ = zz;
    this.pending = { t: 2.6, z: zz };
    if (this.bartender) {
      this.bartender.actionKind = 'pour';
      this.bartender.action = 2.6;
    }
    this.d.sound.play('shaker', new THREE.Vector3(-16, 1.2, zz), { volume: 0.7 });
    setTimeout(() => this.d.sound.play('pour', new THREE.Vector3(-15.4, 1.15, zz), { volume: 0.8 }), 1300);
    this.d.hud.toast(`“One ${MENU[this.menuIndex].name}, coming up.”`, 'info');
    this.onOrder?.();
  }

  buyRound() {
    if (this.roundPending > 0) return;
    if (!this.d.bankroll.canAfford(80)) {
      this.d.hud.toast('Not enough chips for a round', 'warn');
      return;
    }
    this.d.bankroll.debit(80, 'bet', 'bar');
    this.roundPending = 2.6;
    if (this.bartender) {
      this.bartender.actionKind = 'pour';
      this.bartender.action = 2.6;
    }
    this.d.sound.play('shaker', new THREE.Vector3(-16, 1.2, this.bartenderZ), { volume: 0.7 });
    this.d.hud.toast('“A round for the gentlemen, coming right up.”', 'info');
  }

  private serve(z: number) {
    const kind = MENU[this.menuIndex];
    this.menuIndex = (this.menuIndex + 1) % MENU.length;
    const drink = new Drink(kind);
    drink.group.position.set(Lounge.COUNTER_X + 0.28, Lounge.TOP, z);
    this.d.scene.add(drink.group);
    this.waiting = drink;
    this.d.sound.play('clink', drink.group, { volume: 0.6 });
    this.d.hud.toast(`${kind.name}, on the house. Pick it up from the bar.`, 'win');
    this.makeTakeable(drink);
  }

  /** Makes a drink sitting somewhere pick-up-able: click on desktop, grab in VR. */
  private makeTakeable(drink: Drink): Grabbable {
    // One interactable covers both states: on a surface (pick it up) and in your hand (sip).
    this.d.interaction.register({
      object: drink.group,
      kind: 'button',
      enabled: () => this.desktopDrink === drink || (drink.group.parent === this.d.scene && !this.desktopDrink),
      label: () =>
        this.desktopDrink === drink ? (drink.level > 0 ? 'Sip (F)' : 'Empty glass · Q to set it down') : `Pick up the ${drink.kind.name}`,
      onSelect: () => (this.desktopDrink === drink ? this.sip(drink) : this.pickUpDesktop(drink)),
    });
    const grab: Grabbable = {
      at: () => drink.group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.06, 0)),
      radius: 0.12,
      enabled: () => drink.group.parent === this.d.scene,
      grab: () => {
        if (this.waiting === drink) this.waiting = null;
        this.falling = this.falling.filter((f) => f.obj !== drink.group);
        return drink.group;
      },
      drag: (hand, pos) => {
        // Bring it to your mouth to sip.
        if (this.sipCooldown <= 0 && pos.distanceTo(this.d.hands.head) < 0.2 && drink.level > 0) {
          this.sip(drink);
          this.d.hands.onHaptic?.(hand, 0.2, 30);
        }
      },
      release: (_hand, _pos, carried) => {
        if (carried) this.drop(carried);
      },
    };
    this.d.hands.register(grab);
    return grab;
  }

  /** A waiter hands you a glass of champagne. */
  offerChampagne() {
    const drink = new Drink(MENU[3]);
    this.d.scene.add(drink.group);
    const grab = this.makeTakeable(drink);
    if (this.d.player.inXR) {
      if (!this.d.hands.give(drink.group, grab)) drink.group.removeFromParent();
    } else {
      if (this.desktopDrink) this.putDownDesktop();
      this.pickUpDesktop(drink);
    }
  }

  /** Sip the glass you are holding (phone button / F key). */
  sipHeld() {
    if (this.desktopDrink) this.sip(this.desktopDrink);
  }

  get holdingDrink() {
    return !!this.desktopDrink;
  }

  private pickUpDesktop(drink: Drink) {
    if (this.desktopDrink || this.d.player.inXR) return;
    if (this.waiting === drink) this.waiting = null;
    this.desktopDrink = drink;
    this.d.player.camera.add(drink.group);
    drink.group.position.set(0.2, -0.2, -0.42);
    drink.group.rotation.set(0.15, 0, 0);
    this.d.sound.play('clink', drink.group, { volume: 0.4 });
    this.d.hud.toast(`Holding a ${drink.kind.name} · F to sip · Q to set it down`, 'info');
  }

  private sip(drink: Drink) {
    if (this.sipCooldown > 0 || drink.level <= 0) return;
    this.sipCooldown = 1.4;
    drink.setLevel(drink.level - 0.25);
    this.d.sound.playLocal('sip', 0.6);
    if (this.desktopDrink === drink) {
      const g = drink.group;
      g.position.set(0.05, -0.08, -0.22);
      g.rotation.set(0.9, 0, 0);
      setTimeout(() => {
        if (this.desktopDrink === drink) {
          g.position.set(0.2, -0.2, -0.42);
          g.rotation.set(0.15, 0, 0);
        }
      }, 700);
    }
    if (drink.level <= 0) this.d.hud.toast(`That was a fine ${drink.kind.name}.`, 'info');
  }

  private putDownDesktop() {
    const drink = this.desktopDrink;
    if (!drink) return;
    this.desktopDrink = null;
    const cam = this.d.player.camera;
    const at = new THREE.Vector3(0, -0.1, -0.6).applyMatrix4(cam.matrixWorld);
    this.d.scene.add(drink.group);
    drink.group.position.copy(at);
    drink.group.rotation.set(0, 0, 0);
    this.drop(drink.group);
  }

  /** Lets go of a glass: it drops onto whatever surface is below it. */
  private drop(obj: THREE.Object3D) {
    obj.rotation.set(0, obj.rotation.y, 0);
    const origin = obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.05, 0));
    this.raycaster.set(origin, new THREE.Vector3(0, -1, 0));
    this.raycaster.far = 3;
    const hits = this.raycaster
      .intersectObjects(this.d.scene.children, true)
      .filter((h) => h.object.visible && !isInside(h.object, obj) && (h.object as THREE.Mesh).isMesh && !(h.object as THREE.InstancedMesh).isInstancedMesh);
    const floor = hits.length ? hits[0].point.y : 0;
    this.falling.push({ obj, v: 0, floor });
  }

  // ---------------------------------------------------------------------------
  // Lounge seating
  // ---------------------------------------------------------------------------

  private buildSeating() {
    const g = new THREE.Group();
    this.d.scene.add(g);
    const velvet = assets.material('velvet', { repeat: 2, tint: 0x9a3048, rough: 1, fallback: () => new THREE.MeshStandardMaterial({ color: 0x5a1a2a, roughness: 0.85 }) });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 1, roughness: 0.3 });
    const top = assets.material('marble', { repeat: 1, rough: 0.3, normal: 0.4, fallback: () => new THREE.MeshStandardMaterial({ map: toTexture(marble(256, 'cream', 31)), roughness: 0.1 }) });
    const tables: [number, number][] = [
      [-11.6, 11.4],
      [-11.4, 8.2],
    ];
    const chairGeo = {
      seat: new RoundedBoxGeometry(0.62, 0.18, 0.6, 2, 0.05),
      back: new RoundedBoxGeometry(0.62, 0.5, 0.16, 2, 0.05),
      arm: new RoundedBoxGeometry(0.12, 0.26, 0.6, 2, 0.04),
    };
    const chair = (x: number, z: number, yaw: number) => {
      const c = new THREE.Group();
      const s = new THREE.Mesh(chairGeo.seat, velvet);
      s.position.y = 0.36;
      const b = new THREE.Mesh(chairGeo.back, velvet);
      b.position.set(0, 0.68, -0.24);
      const a1 = new THREE.Mesh(chairGeo.arm, velvet);
      a1.position.set(-0.3, 0.52, 0);
      const a2 = a1.clone();
      a2.position.x = 0.3;
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.26, 0.56), velvet);
      base.position.y = 0.14;
      c.add(s, b, a1, a2, base);
      c.position.set(x, 0, z);
      c.rotation.y = yaw;
      g.add(c);
      this.d.world.addCircle(x, z, 0.4);
    };
    tables.forEach(([x, z], i) => {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.04, 28), top);
      t.position.set(x, 0.62, z);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.6, 10), gold);
      stem.position.set(x, 0.31, z);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.03, 20), gold);
      foot.position.set(x, 0.015, z);
      g.add(t, stem, foot);
      this.d.world.addCircle(x, z, 0.38);
      chair(x - 0.85, z, Math.PI / 2);
      chair(x + 0.85, z, -Math.PI / 2);
      // A couple chatting at the first table, a single guest at the second.
      const pa = this.d.crowd.add('patron', randomLook(), new THREE.Vector3(x - 0.78, 0, z), Math.PI / 2);
      if (pa) {
        pa.seatY = 0.5;
        pa.onUpdate = (p) => {
          if (p.action <= 0 && Math.random() < 0.002) {
            p.actionKind = 'sip';
            p.action = 1.4;
          }
          p.headYaw = Math.sin(performance.now() / 1700 + p.seed) * 0.3;
        };
      }
      if (i === 0) {
        const pb = this.d.crowd.add('patron', randomLook(), new THREE.Vector3(x + 0.78, 0, z), -Math.PI / 2);
        if (pb) pb.seatY = 0.5;
      }
      // Drinks on the table.
      for (const dx of [-0.15, 0.17]) {
        const d = new Drink(MENU[dx > 0 ? 3 : 1]);
        d.group.position.set(x + dx, 0.64, z + (dx > 0 ? 0.08 : -0.06));
        d.setLevel(0.6);
        g.add(d.group);
      }
    });
    bakeStatic(g);
  }

  // ---------------------------------------------------------------------------
  // Grand piano
  // ---------------------------------------------------------------------------

  private buildPiano() {
    const g = this.piano;
    g.position.set(-6.4, 0, 10.4);
    g.rotation.y = -0.5;
    const q = this.d.quality;
    const lacquer = new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.12, clearcoat: q.name === 'desktop' ? 1 : 0, envMapIntensity: 1.6 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 1, roughness: 0.25 });
    // Body outline (local XZ): straight side on the left, curved bentside on the right.
    const shape = new THREE.Shape();
    shape.moveTo(-0.74, 0.0);
    shape.lineTo(-0.74, 1.75);
    shape.bezierCurveTo(-0.74, 2.1, -0.2, 2.15, -0.05, 1.8);
    shape.bezierCurveTo(0.15, 1.3, 0.74, 1.0, 0.74, 0.55);
    shape.lineTo(0.74, 0.0);
    shape.closePath();
    const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, curveSegments: 24 });
    bodyGeo.rotateX(Math.PI / 2); // shape Y -> world -Z... (tail extends away from the keyboard)
    bodyGeo.scale(1, 1, -1);
    const body = new THREE.Mesh(bodyGeo, lacquer);
    body.position.y = 0.94;
    g.add(body);
    // Inside: gold harp plate and felt.
    const plate = new THREE.Mesh(new THREE.ShapeGeometry(shape, 24).rotateX(-Math.PI / 2).scale(0.96, 1, 0.96), gold);
    plate.position.set(0, 0.88, -0.02);
    g.add(plate);
    // Lid, propped open on the right.
    const lid = new THREE.Mesh(new THREE.ShapeGeometry(shape, 24).rotateX(-Math.PI / 2), lacquer);
    const hinge = new THREE.Group();
    hinge.position.set(-0.74, 0.95, 0);
    lid.position.x = 0.74;
    hinge.add(lid);
    hinge.rotation.z = 0.62;
    g.add(hinge);
    (lid.material as THREE.Material).side = THREE.DoubleSide;
    // Keyboard.
    const kc = document.createElement('canvas');
    kc.width = 1024;
    kc.height = 64;
    const kx = kc.getContext('2d')!;
    kx.fillStyle = '#f6f2e6';
    kx.fillRect(0, 0, 1024, 64);
    const whites = 52;
    for (let i = 0; i < whites; i++) {
      kx.fillStyle = '#9a9488';
      kx.fillRect((i * 1024) / whites, 0, 1.5, 64);
      const n = i % 7;
      if (n !== 2 && n !== 6) {
        kx.fillStyle = '#0c0c0c';
        kx.fillRect(((i + 0.68) * 1024) / whites, 0, (1024 / whites) * 0.62, 38);
      }
    }
    const keysTex = new THREE.CanvasTexture(kc);
    keysTex.colorSpace = THREE.SRGBColorSpace;
    const keys = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.03, 0.16), lacquer);
    keys.position.set(0, 0.765, 0.1);
    g.add(keys);
    const keyTop = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 0.16).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: keysTex, roughness: 0.3 }));
    keyTop.position.set(0, 0.781, 0.1);
    g.add(keyTop);
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.14, 0.2), lacquer);
    cheek.position.set(0, 0.72, 0.1);
    g.add(cheek);
    const fall = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.14, 0.03), lacquer);
    fall.position.set(0, 0.9, -0.0);
    fall.rotation.x = -0.3;
    g.add(fall);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.02), lacquer);
    stand.position.set(0, 1.08, -0.06);
    stand.rotation.x = -0.25;
    g.add(stand);
    for (const [lx, lz] of [[-0.62, -0.1], [0.62, -0.1], [-0.4, -1.7]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.64, 12), lacquer);
      leg.position.set(lx, 0.32, lz);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12), gold);
      cap.position.set(lx, 0.02, lz);
      g.add(leg, cap);
    }
    const lyre = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.04), lacquer);
    lyre.position.set(0, 0.38, -0.05);
    g.add(lyre);
    const bench = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.08, 0.36, 2, 0.02), lacquer);
    bench.position.set(0, 0.5, 0.62);
    const cushion = new THREE.Mesh(new RoundedBoxGeometry(0.78, 0.05, 0.34, 2, 0.02), new THREE.MeshStandardMaterial({ color: 0x3a1015, roughness: 0.8 }));
    cushion.position.set(0, 0.56, 0.62);
    g.add(bench, cushion);
    for (const bx of [-0.35, 0.35]) for (const bz of [0.48, 0.76]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.48, 8), lacquer);
      l.position.set(bx, 0.24, bz);
      g.add(l);
    }
    // Tip jar on the piano.
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 16, 1, true), glassMat);
    jar.position.set(0.55, 1.06, 0.15);
    g.add(jar);
    const bills = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12), new THREE.MeshStandardMaterial({ color: 0x5a8a4a }));
    bills.position.set(0.55, 1.01, 0.15);
    g.add(bills);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 3).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: toTexture(radial(128, 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0)')), transparent: true, depthWrite: false }),
    );
    shadow.position.set(0, 0.012, -0.7);
    g.add(shadow);

    const tipZone = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial({ visible: false }));
    tipZone.position.copy(jar.position);
    g.add(dynamic(tipZone));
    bakeStatic(g);

    g.updateMatrixWorld(true);
    // Collider: the piano body and bench.
    this.d.world.addLocalBox(g, 0, -0.75, 1.7, 2.3);
    this.d.world.addLocalBox(g, 0, 0.62, 0.9, 0.45);

    // The pianist, and the music: a positional loop you hear across the room.
    const seat = new THREE.Vector3(0, 0, 0.64).applyMatrix4(g.matrixWorld);
    this.d.crowd.add('pianist', staffLook('pianist'), seat, g.rotation.y + Math.PI);
    const pianist = this.d.crowd.people.at(-1);
    if (pianist) pianist.seatY = 0.6;
    const speaker = new THREE.Object3D();
    speaker.position.set(0, 1.0, -0.6);
    g.add(speaker);
    this.d.sound.ambientAt(() => this.d.sound.pianoLoop(), speaker, { volume: 0.9, ref: 2.2, rolloff: 1.1 });

    this.d.interaction.register({
      object: tipZone,
      label: 'Tip the pianist $5',
      onSelect: () => {
        if (!this.d.bankroll.canAfford(5)) return;
        this.d.bankroll.debit(5, 'bet', 'tip');
        this.d.sound.play('chip', tipZone, { volume: 0.7 });
        this.d.hud.toast('The pianist smiles and nods. “Grazie!”', 'info');
        this.onTip?.();
        if (pianist) pianist.headYaw = 0.8;
      },
    });
  }

  update(dt: number) {
    this.sipCooldown = Math.max(0, this.sipCooldown - dt);
    if (this.roundPending > 0) {
      this.roundPending -= dt;
      if (this.roundPending <= 0) {
        this.d.sound.play('clink', new THREE.Vector3(-14.7, 1.15, this.bartenderZ), { volume: 0.9 });
        this.d.hud.toast('Round served. Cheers!', 'win');
        this.onRound?.();
      }
    }
    if (this.pending) {
      this.pending.t -= dt;
      if (this.pending.t <= 0) {
        const z = this.pending.z;
        this.pending = null;
        this.serve(z);
      }
    }
    for (const f of [...this.falling]) {
      if (f.obj.parent !== this.d.scene) {
        this.falling.splice(this.falling.indexOf(f), 1);
        continue;
      }
      f.v += 9.8 * dt;
      f.obj.position.y -= f.v * dt;
      if (f.obj.position.y <= f.floor) {
        f.obj.position.y = f.floor;
        this.falling.splice(this.falling.indexOf(f), 1);
        this.d.sound.play('clink', f.obj, { volume: Math.min(1, 0.2 + f.v * 0.2) });
      }
    }
  }
}

function isInside(o: THREE.Object3D, root: THREE.Object3D) {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true;
  return false;
}


