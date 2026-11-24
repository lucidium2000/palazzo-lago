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
import { BarMenuCard, buildVrMenu, DRINKS, PREP_TIME, SportsTicker, TIP, type DrinkKind } from './bar';
import type { CanvasPanel } from './panel';
import type { Viewpoint } from './player';
import { voiceArbiter } from './dialogue';
import { BARTENDER_LINES, CHEERS_LINES, STAFF, guestVoice, orderLine } from './speech';
import { mouthOf, voices } from './voices';

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

const drink = (name: string) => DRINKS.find((d) => d.name === name)!;
const BAR_X = -15.0;
/** Where the bartender pours (their side of the counter) and where drinks wait for you. */
const POUR_X = BAR_X - 0.2;
const SERVE_X = BAR_X + 0.32;
const TAP_Z = 11.6;

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
  private topR = 0.04;
  private foam: THREE.Mesh | null = null;
  private ice: THREE.Mesh[] = [];

  constructor(readonly kind: DrinkKind) {
    const profile: Record<DrinkKind['glass'], [number, number][]> = {
      rocks: [[0, 0], [0.042, 0], [0.044, 0.004], [0.046, 0.09], [0.044, 0.09], [0.042, 0.008], [0, 0.008]],
      flute: [[0, 0], [0.035, 0], [0.036, 0.004], [0.005, 0.01], [0.004, 0.1], [0.022, 0.13], [0.028, 0.21], [0.026, 0.21], [0.02, 0.13], [0, 0.11]],
      martini: [[0, 0], [0.04, 0], [0.04, 0.004], [0.005, 0.01], [0.004, 0.1], [0.06, 0.16], [0.058, 0.16], [0, 0.104]],
      coupe: [[0, 0], [0.04, 0], [0.005, 0.01], [0.004, 0.09], [0.05, 0.12], [0.06, 0.14], [0.058, 0.14], [0, 0.095]],
      pint: [[0, 0], [0.034, 0], [0.035, 0.006], [0.045, 0.15], [0.043, 0.15], [0.033, 0.012], [0, 0.012]],
      shot: [[0, 0], [0.022, 0], [0.023, 0.004], [0.026, 0.06], [0.024, 0.06], [0.019, 0.01], [0, 0.01]],
    };
    const pts = profile[kind.glass].map(([r, y]) => new THREE.Vector2(r, y));
    this.topR = { rocks: 0.04, flute: 0.026, martini: 0.055, coupe: 0.055, pint: 0.042, shot: 0.024 }[kind.glass];
    const glass = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), glassMat);
    glass.renderOrder = 2;
    this.group.add(glass);
    const shapes: Record<DrinkKind['glass'], () => [THREE.BufferGeometry, number, number]> = {
      rocks: () => [new THREE.CylinderGeometry(0.04, 0.039, 1, 18).translate(0, 0.5, 0), 0.01, 0.07],
      flute: () => [new THREE.CylinderGeometry(0.024, 0.017, 1, 14).translate(0, 0.5, 0), 0.115, 0.19],
      martini: () => [new THREE.CylinderGeometry(0.052, 0.004, 1, 18).translate(0, 0.5, 0), 0.105, 0.15],
      coupe: () => [new THREE.CylinderGeometry(0.05, 0.01, 1, 18).translate(0, 0.5, 0), 0.096, 0.13],
      pint: () => [new THREE.CylinderGeometry(0.042, 0.033, 1, 18).translate(0, 0.5, 0), 0.013, 0.13],
      shot: () => [new THREE.CylinderGeometry(0.023, 0.019, 1, 14).translate(0, 0.5, 0), 0.011, 0.05],
    };
    const [geo, bottom, top] = shapes[kind.glass]();
    this.liquidBottom = bottom;
    this.liquidTop = top;
    this.liquid = new THREE.Mesh(geo, liquidMat(kind.liquid));
    this.liquid.renderOrder = 1;
    this.group.add(this.liquid);
    if (kind.ice) {
      for (const [x, y, z, r] of [[0.008, 0.05, 0.004, 0.4], [-0.012, 0.035, -0.008, 1.1]]) {
        const ice = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.028, 0.028), iceMat);
        ice.position.set(x, y, z);
        ice.rotation.set(r, 0.6, 0.2);
        this.group.add(ice);
        this.ice.push(ice);
      }
    }
    if (kind.foam) {
      this.foam = new THREE.Mesh(new THREE.CylinderGeometry(this.topR * 0.97, this.topR * 0.95, 0.014, 18), liquidMat(kind.glass === 'pint' ? 0xf6f0e0 : 0xc89a6a, false));
      this.group.add(this.foam);
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
    if (this.foam) {
      this.foam.visible = this.level > 0.05;
      this.foam.position.y = this.liquidBottom + h + 0.004;
    }
    for (const i of this.ice) i.visible = this.level > 0.08 || i.position.y < 0.04;
  }

  /** Standard drinks still in the glass. */
  get units() {
    return this.kind.alcohol * this.level;
  }
}

export class Lounge {
  readonly bar = new THREE.Group();
  readonly piano = new THREE.Group();
  private bartender: Person | null = null;
  private bartenderZ = 9;
  private waiting: Drink | null = null;
  /** The drink you are carrying on desktop. */
  private desktopDrink: Drink | null = null;
  private sipCooldown = 0;
  private falling: { obj: THREE.Object3D; v: number; floor: number }[] = [];
  private raycaster = new THREE.Raycaster();
  onOrder: (() => void) | null = null;
  onTip: (() => void) | null = null;
  onRound: (() => void) | null = null;
  private roundPending = 0;
  /** The drink being made: the glass fills on the bartender's side, then slides to you. */
  private pour: { kind: DrinkKind; z: number; pourZ: number; t: number; total: number; glass: Drink; forNpc: boolean } | null = null;
  private slide: { drink: Drink; from: THREE.Vector3; to: THREE.Vector3; t: number; forNpc: boolean } | null = null;
  private bottle: THREE.Group;
  private stream: THREE.Mesh;
  private menuCard = new BarMenuCard();
  private vrMenu: CanvasPanel;
  private ticker = new SportsTicker();
  private menuZ = 9;
  private tipped = 0;
  private npcOrderIn = 18;
  private npcDrinks = new Map<number, Drink>();
  private patronZ: number[] = [];
  /** The glass in your VR hand, if any. */
  private vrHeld: Drink | null = null;
  private cheersCooldown = 0;
  private cheersHintShown = false;
  /** Alcohol in your system (standard drinks); it wears off over time. */
  private units = 0;
  private tipsyStage = 0;
  private time = 0;
  /** Bar stools you can sit on. */
  readonly seats: Viewpoint[] = [];
  /** You got tipsy (stage 1, 2, 3): the crew comments. */
  onTipsy: ((stage: number) => void) | null = null;
  /** You clinked glasses (with a guest; the game wires your friend too). */
  onCheers: ((at: THREE.Vector3) => void) | null = null;

  static readonly COUNTER_X = -15.0;
  static readonly COUNTER_Z0 = 6.2;
  static readonly COUNTER_Z1 = 12.4;
  static readonly TOP = 1.1;

  constructor(private d: LoungeDeps) {
    d.scene.add(this.bar, this.piano);
    // The bartender's bottle (or shaker) and the stream of the pour.
    this.bottle = new THREE.Group();
    const bottleBody = new THREE.Mesh(
      new THREE.LatheGeometry([[0, 0], [0.03, 0], [0.031, 0.16], [0.012, 0.21], [0.01, 0.25], [0, 0.25]].map(([r, y]) => new THREE.Vector2(r, y)), 12),
      new THREE.MeshStandardMaterial({ color: 0x2a5a1a, roughness: 0.1, transparent: true, opacity: 0.9, envMapIntensity: 2 }),
    );
    bottleBody.rotation.x = Math.PI / 2;
    this.bottle.add(bottleBody);
    this.bottle.visible = false;
    this.stream = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.005, 1, 6, 1, true).translate(0, -0.5, 0), new THREE.MeshStandardMaterial({ color: 0xffaa44, transparent: true, opacity: 0.75, roughness: 0.1 }));
    this.stream.visible = false;
    this.stream.raycast = () => {};
    d.scene.add(this.stream);
    this.vrMenu = buildVrMenu(
      (k) => this.order(this.menuZ, k),
      () => this.tipBartender(),
      () => (this.pour ? `Making your ${this.pour.kind.name}…` : this.waiting ? 'Your drink is on the bar' : 'Point at a drink and pull the trigger'),
    );
    this.vrMenu.mesh.visible = false;
    this.vrMenu.register(d.interaction);
    d.scene.add(this.vrMenu.mesh);
    this.menuCard.onPick = (k) => this.order(this.menuZ, k);
    this.menuCard.onTip = () => this.tipBartender();
    this.buildBar();
    this.buildSeating();
    this.buildPiano();
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyQ') this.putDownDesktop();
      if (e.code === 'KeyF' && this.desktopDrink) this.sip(this.desktopDrink);
      if (e.code === 'KeyG') this.tryCheers();
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
    // Free stools are seats: sit, lean on the bar and order.
    stoolZ.forEach((z, i) => {
      if (i === 0 || i === 3) return; // regulars sit here
      this.seats.push({ id: `bar-stool-${i}`, label: 'Bar stool', position: new THREE.Vector3(x + 0.62, 0, z), yaw: Math.PI / 2, pitch: -0.28, eye: 1.42, back: 0 });
    });
    this.patronZ = [stoolZ[0], stoolZ[3]];
    // Sportsbook TV hanging over the near end of the bar.
    this.ticker.group.position.set(x - 0.15, 2.55, z0 + 0.35);
    this.ticker.group.rotation.y = Math.PI / 2;
    dynamic(this.ticker.group);
    this.bar.add(this.ticker.group);
    const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 8), gold);
    mount.position.set(x - 0.18, 3.45, z0 + 0.35);
    this.bar.add(mount);
    // A beer tap tower on the bartender's side.
    const chrome = new THREE.MeshStandardMaterial({ color: 0xdadde2, metalness: 1, roughness: 0.15 });
    add(new THREE.CylinderGeometry(0.035, 0.04, 0.32, 14), chrome, POUR_X, Lounge.TOP + 0.16, TAP_Z);
    add(new THREE.BoxGeometry(0.06, 0.05, 0.3), chrome, POUR_X, Lounge.TOP + 0.33, TAP_Z);
    for (const dz of [-0.09, 0, 0.09]) {
      add(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 6), chrome, POUR_X + 0.03, Lounge.TOP + 0.29, TAP_Z + dz);
      add(new THREE.CylinderGeometry(0.012, 0.009, 0.12, 8), new THREE.MeshStandardMaterial({ color: [0x7a1a10, 0xd4a94e, 0x1a3a6a][Math.round(dz / 0.09) + 1], roughness: 0.4 }), POUR_X + 0.01, Lounge.TOP + 0.42, TAP_Z + dz);
    }
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

    // Tip cup at the far end of the counter: a tip makes the bartender your friend.
    const cup = new THREE.Group();
    const cupGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.12, 14, 1, true), glassMat);
    cupGlass.position.y = 0.06;
    const cash = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.05, 10), new THREE.MeshStandardMaterial({ color: 0x5a8a4a, roughness: 0.8 }));
    cash.position.y = 0.03;
    const cupHit = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.16), new THREE.MeshBasicMaterial({ visible: false }));
    cupHit.position.y = 0.08;
    cup.add(cupGlass, cash, cupHit);
    cup.position.set(x + 0.22, Lounge.TOP, z1 - 0.35);
    this.d.scene.add(cup);
    this.d.interaction.register({ object: cup, label: () => 'Tip the bartender $5', onSelect: () => this.tipBartender() });

    // Ordering: point at / click the bar top.
    // A thin strip on the bar top (glasses standing on it stay clickable).
    const counterHit = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.03, len), new THREE.MeshBasicMaterial({ visible: false }));
    counterHit.position.set(x + 0.05, Lounge.TOP - 0.005, zc);
    this.d.scene.add(counterHit);
    this.d.interaction.register({
      object: counterHit,
      kind: 'button',
      enabled: () => !this.d.player.inXR,
      label: () => (this.pour || this.slide ? 'Your drink is being made…' : this.waiting ? 'Your drink is on the bar' : 'Order a drink · see the menu'),
      onSelect: (e) => this.openMenu(e.hit.point.z),
    });
  }

  /** Opens the menu (screens) for a spot along the bar; the bartender greets you. */
  openMenu(z: number) {
    if (this.pour || this.slide) {
      this.d.hud.toast('Your drink is being made…', 'info');
      return;
    }
    if (this.waiting) {
      this.d.hud.toast('Your drink is waiting on the bar', 'info');
      return;
    }
    this.menuZ = THREE.MathUtils.clamp(z, Lounge.COUNTER_Z0 + 0.4, Lounge.COUNTER_Z1 - 0.4);
    this.bartenderZ = this.menuZ;
    this.greet(this.tipped > 0 ? BARTENDER_LINES.regular : BARTENDER_LINES.hello);
    this.menuCard.show();
  }

  /** The bartender talks to you (her own voice, from behind the bar). */
  private greet(line: string, force = false) {
    if (!force && voiceArbiter.busy()) return;
    const b = this.bartender;
    const dur = voices.talk({ who: 'Bartender', text: line, voice: STAFF.bartender, at: b ? mouthOf(b) : null, priority: true, group: 'bartender', fallback: { pitch: 1.1, rate: 1.02, voice: 2 } });
    if (b) this.d.crowd.speak(b, dur);
    voiceArbiter.claim(dur);
  }

  /** Orders a drink: Strip prices plus a tip. (Cocktail servers comp you only while you gamble.) */
  order(z: number, kind: DrinkKind = DRINKS[0]) {
    if (this.pour || this.slide || this.waiting) {
      this.d.hud.toast(this.waiting ? 'Your drink is waiting on the bar' : 'Your drink is being made…', 'info');
      return;
    }
    const cost = kind.price + TIP;
    if (!this.d.bankroll.canAfford(cost)) {
      this.d.hud.toast('Not enough chips for a drink', 'warn');
      return;
    }
    this.d.bankroll.debit(cost, 'bet', 'bar');
    this.startPour(kind, THREE.MathUtils.clamp(z, Lounge.COUNTER_Z0 + 0.4, Lounge.COUNTER_Z1 - 0.4), false);
    this.greet(orderLine(kind.name, kind.prep), true);
    this.onOrder?.();
  }

  /** The bartender makes a drink: walks over, shakes or pours, the glass fills, then slides it along. */
  private startPour(kind: DrinkKind, z: number, forNpc: boolean) {
    const pourZ = kind.prep === 'tap' ? TAP_Z : z;
    const total = PREP_TIME[kind.prep] * (this.tipped > 0 ? 0.75 : 1);
    const glass = new Drink(kind);
    glass.setLevel(0);
    glass.group.position.set(POUR_X, Lounge.TOP, pourZ);
    this.d.scene.add(glass.group);
    this.pour = { kind, z, pourZ, t: 0, total, glass, forNpc };
    this.bartenderZ = pourZ;
    if (this.bartender) {
      this.bartender.actionKind = 'pour';
      this.bartender.action = total;
      const wrist = this.bartender.rig?.bones['WristR'];
      if (wrist && kind.prep !== 'tap') {
        wrist.add(this.bottle);
        this.bottle.position.set(0, 0.08, 0.04);
        this.bottle.visible = true;
        const body = this.bottle.children[0] as THREE.Mesh;
        const m = body.material as THREE.MeshStandardMaterial;
        m.color.set(kind.prep === 'shake' ? 0xc8ccd2 : kind.alcohol ? 0x6a3a0a : 0x2a5a1a);
        m.metalness = kind.prep === 'shake' ? 1 : 0;
      }
    }
    (this.stream.material as THREE.MeshStandardMaterial).color.set(kind.prep === 'tap' ? 0xe8b040 : kind.liquid);
    const at = new THREE.Vector3(POUR_X, Lounge.TOP + 0.2, pourZ);
    if (kind.prep === 'shake') this.d.sound.play('shaker', at, { volume: forNpc ? 0.35 : 0.7 });
    setTimeout(() => this.d.sound.play('pour', at, { volume: forNpc ? 0.4 : 0.8 }), total * 450);
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

  /** The finished glass arrives in front of you (or a regular). */
  private served(drink: Drink, forNpc: boolean, z: number) {
    this.d.sound.play('clink', drink.group, { volume: 0.6 });
    if (forNpc) {
      this.npcDrinks.get(z)?.group.removeFromParent();
      this.npcDrinks.set(z, drink);
      return;
    }
    this.waiting = drink;
    this.d.hud.toast(`${drink.kind.name} · pick it up from the bar${drink.kind.glass === 'shot' ? ' (one go!)' : ''}`, 'win');
    this.makeTakeable(drink);
  }

  /** $5 in the tip cup: the bartender remembers you (faster drinks, warmer welcome). */
  tipBartender() {
    if (!this.d.bankroll.canAfford(5)) {
      this.d.hud.toast('Not enough chips to tip', 'warn');
      return;
    }
    this.d.bankroll.debit(5, 'bet', 'tip');
    this.tipped++;
    this.d.sound.play('chip', new THREE.Vector3(Lounge.COUNTER_X + 0.22, Lounge.TOP, Lounge.COUNTER_Z1 - 0.35), { volume: 0.7 });
    this.greet(this.tipped === 1 ? BARTENDER_LINES.tip1 : BARTENDER_LINES.tipMore);
    if (this.bartender) this.bartender.cheer = 0.8;
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
        this.vrHeld = drink;
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
        if (this.vrHeld === drink) this.vrHeld = null;
        if (carried) this.drop(carried);
      },
    };
    this.d.hands.register(grab);
    return grab;
  }

  /** A waiter hands you a glass of champagne. */
  offerChampagne() {
    const drink = new Drink(DRINKS.find((d) => d.section === 'Champagne')!);
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
    const before = drink.units;
    // Shots go down in one; everything else in sips.
    drink.setLevel(drink.kind.glass === 'shot' ? 0 : drink.level - 0.2);
    this.drank(before - drink.units);
    if (drink.kind.glass === 'shot' && voices.captions) this.d.hud.say('You', 'Woo!');
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
    this.raycaster.camera = this.d.player.camera; // sprites need it to raycast
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
        const d = new Drink(dx > 0 ? drink('Champagne') : drink('Negroni'));
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

  /** Alcohol in: tipsiness builds; the crew notices. */
  private drank(units: number) {
    if (units <= 0) return;
    this.units += units;
    const stage = this.units >= 6 ? 3 : this.units >= 4 ? 2 : this.units >= 2.5 ? 1 : 0;
    if (stage > this.tipsyStage) {
      this.tipsyStage = stage;
      this.onTipsy?.(stage);
    }
  }

  /** Clink glasses with a guest who's holding a drink (desktop G, or bring glasses together in VR). */
  private tryCheers(at?: THREE.Vector3) {
    if (this.cheersCooldown > 0) return false;
    const held = this.desktopDrink ?? this.vrHeld;
    if (!held) return false;
    const mine = at ?? held.group.getWorldPosition(new THREE.Vector3());
    const feet = this.d.player.feet();
    let best: Person | null = null,
      bd = at ? 0.25 : 1.6;
    for (const p of this.d.crowd.people) {
      if (p.prop !== 'glass' || !p.rig) continue;
      const w = p.rig.bones['WristR'];
      if (!w) continue;
      const g = w.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.05, 0));
      const dist = at ? g.distanceTo(mine) : p.pos.distanceTo(feet);
      if (dist < bd) {
        bd = dist;
        best = p;
      }
    }
    if (!best) return false;
    this.cheers(mine, best);
    return true;
  }

  /** The clink: sound, 'Cheers!', both of you take a sip. Also called when your friend clinks yours. */
  cheers(at: THREE.Vector3, with_?: Person, fromFriend = false) {
    if (this.cheersCooldown > 0) return;
    this.cheersCooldown = 2;
    this.d.sound.play('clink', at, { volume: 1, rate: 1.15 });
    if (with_) {
      const text = CHEERS_LINES[Math.floor(Math.random() * CHEERS_LINES.length)];
      const female = (with_.look.kind ?? '').startsWith('female') || !!with_.look.dress;
      const dur = voices.talk({ who: 'Guest', text, voice: guestVoice(with_.seed, female), at: mouthOf(with_), priority: true });
      this.d.crowd.speak(with_, dur);
    } else if (voices.captions) this.d.hud.say('You', 'Cheers!');
    if (with_) {
      with_.sipT = 1.6;
      with_.cheer = 0.6;
    }
    const held = this.desktopDrink ?? this.vrHeld;
    if (held && held.level > 0) setTimeout(() => this.sip(held), 600);
    if (!fromFriend) this.onCheers?.(at);
  }

  /** Debug/screenshots: one glass of each drink along the bar top. */
  debugLineup() {
    DRINKS.forEach((k, i) => {
      const d = new Drink(k);
      d.group.position.set(SERVE_X - 0.05, Lounge.TOP, Lounge.COUNTER_Z0 + 0.6 + i * 0.32);
      this.d.scene.add(d.group);
    });
  }

  /** The drinks on the menu (by name), for scripted orders. */
  kind(name: string): DrinkKind | undefined {
    return DRINKS.find((d) => d.name === name);
  }

  /** Where your glass is (for clinking with your friend), or null. */
  heldGlass(): THREE.Vector3 | null {
    const held = this.desktopDrink ?? this.vrHeld;
    return held ? held.group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.08, 0)) : null;
  }

  update(dt: number) {
    this.time += dt;
    this.sipCooldown = Math.max(0, this.sipCooldown - dt);
    this.cheersCooldown = Math.max(0, this.cheersCooldown - dt);
    this.ticker.update(dt);
    this.updatePour(dt);
    this.updateVrMenu();
    this.updateBarLife(dt);
    this.updateTipsy(dt);
    // VR: bring your glass to a guest's glass to clink.
    if (this.vrHeld) {
      const g = this.vrHeld.group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.06, 0));
      this.tryCheers(g);
    } else if (this.desktopDrink && !this.cheersHintShown) {
      for (const p of this.d.crowd.people) {
        if (p.prop === 'glass' && p.pos.distanceTo(this.d.player.feet()) < 1.6) {
          this.cheersHintShown = true;
          this.d.hud.toast('Press G to clink glasses: cheers!', 'info');
          break;
        }
      }
    }
    if (this.roundPending > 0) {
      this.roundPending -= dt;
      if (this.roundPending <= 0) {
        this.d.sound.play('clink', new THREE.Vector3(-14.7, 1.15, this.bartenderZ), { volume: 0.9 });
        this.d.hud.toast('Round served. Cheers!', 'win');
        this.onRound?.();
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

  private updatePour(dt: number) {
    const po = this.pour;
    if (po) {
      po.t += dt;
      const k = po.t / po.total;
      // Shake first (no stream), then pour: the glass fills over the last part.
      const fillStart = po.kind.prep === 'shake' ? 0.62 : po.kind.prep === 'stir' ? 0.45 : 0.25;
      const fill = THREE.MathUtils.clamp((k - fillStart) / (0.95 - fillStart), 0, 1);
      po.glass.setLevel(fill);
      const pouring = fill > 0 && fill < 1;
      this.stream.visible = pouring;
      if (pouring) {
        const top = po.glass.group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.15 * fill + 0.02, 0));
        let src: THREE.Vector3;
        if (po.kind.prep === 'tap') src = new THREE.Vector3(POUR_X + 0.03, Lounge.TOP + 0.26, po.pourZ);
        else if (this.bottle.visible) src = this.bottle.localToWorld(new THREE.Vector3(0, 0, 0.25));
        else src = top.clone().add(new THREE.Vector3(0, 0.25, 0));
        if (src.distanceTo(top) > 0.6) src = top.clone().add(new THREE.Vector3(-0.08, 0.25, 0));
        this.stream.position.copy(src);
        const dir = top.clone().sub(src);
        this.stream.scale.set(1, dir.length(), 1);
        this.stream.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
      }
      if (po.t >= po.total) {
        this.pour = null;
        this.stream.visible = false;
        this.bottle.visible = false;
        this.bottle.removeFromParent();
        const to = new THREE.Vector3(po.forNpc ? BAR_X + 0.28 : SERVE_X, Lounge.TOP, po.z);
        this.slide = { drink: po.glass, from: po.glass.group.position.clone(), to, t: 0, forNpc: po.forNpc };
        this.bartenderZ = po.z;
        this.d.sound.play('chip', po.glass.group, { volume: 0.35, rate: 0.5 });
      }
    }
    const sl = this.slide;
    if (sl) {
      sl.t += dt / (sl.from.distanceTo(sl.to) > 1 ? 1.1 : 0.5);
      const e = 1 - (1 - Math.min(1, sl.t)) ** 3;
      sl.drink.group.position.lerpVectors(sl.from, sl.to, e);
      if (sl.t >= 1) {
        this.slide = null;
        this.served(sl.drink, sl.forNpc, sl.to.z);
      }
    }
  }

  /** VR: the menu stands on the bar in front of you when you walk up. */
  private updateVrMenu() {
    const m = this.vrMenu.mesh;
    const xr = this.d.player.inXR;
    const f = this.d.player.feet();
    const near = xr && f.x > Lounge.COUNTER_X + 0.3 && f.x < Lounge.COUNTER_X + 2.0 && f.z > Lounge.COUNTER_Z0 && f.z < Lounge.COUNTER_Z1;
    const show = near && !this.pour && !this.slide && !this.waiting;
    if (show && !m.visible) {
      this.menuZ = THREE.MathUtils.clamp(f.z, Lounge.COUNTER_Z0 + 0.5, Lounge.COUNTER_Z1 - 0.5);
      this.bartenderZ = this.menuZ;
      m.position.set(Lounge.COUNTER_X + 0.02, Lounge.TOP + 0.36, this.menuZ);
      m.rotation.set(0, Math.PI / 2, 0);
      m.rotateX(-0.25);
      this.greet(this.tipped > 0 ? BARTENDER_LINES.regularShort : BARTENDER_LINES.hello);
      this.vrMenu.redraw();
    }
    m.visible = show;
  }

  /** Life at the bar: the bartender makes drinks for the regulars too. */
  private updateBarLife(dt: number) {
    if (this.pour || this.slide) return;
    this.npcOrderIn -= dt;
    if (this.npcOrderIn > 0) return;
    this.npcOrderIn = 22 + Math.random() * 25;
    const z = this.patronZ[Math.floor(Math.random() * this.patronZ.length)];
    if (z === undefined) return;
    const choices = DRINKS.filter((d) => d.section !== 'Mocktails');
    this.startPour(choices[Math.floor(Math.random() * choices.length)], z, true);
  }

  /** Several drinks in, the room sways a little (screens only; never in VR, for comfort). */
  private updateTipsy(dt: number) {
    this.units = Math.max(0, this.units - dt / 180);
    if (this.units < 2 && this.tipsyStage > 0) this.tipsyStage = 0;
    const a = this.d.player.inXR ? 0 : THREE.MathUtils.clamp((this.units - 2) / 4, 0, 1);
    const canvas = document.querySelector('#app canvas') as HTMLCanvasElement | null;
    if (canvas) {
      const blur = a > 0.05 ? `blur(${(a * 1.1).toFixed(2)}px)` : '';
      if (canvas.style.filter !== blur) canvas.style.filter = blur;
    }
    if (a > 0) {
      const cam = this.d.player.camera;
      cam.rotation.z += Math.sin(this.time * 0.7) * 0.025 * a;
      cam.rotation.x += Math.sin(this.time * 0.43 + 1) * 0.012 * a;
    }
  }
}

function isInside(o: THREE.Object3D, root: THREE.Object3D) {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true;
  return false;
}


