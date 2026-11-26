import * as THREE from 'three';
import { controlLayout, REGION, swatch, swatchUV, uvRect } from './art';
import { ControlInstances, ControlSet } from './controls';
import { Machine, type MachineHooks } from './machine';
import { CabinetSound, type ArcadeAudio } from './synth';
import { SCREEN_H, SCREEN_W, type Game } from './types';
import type { Viewpoint } from '../player';

/**
 * An upright arcade cabinet: side panels with the game's art (the classic
 * silhouette, extruded from a side profile), a lit marquee, a bezel round a
 * tilted CRT, a sloped control panel with a ball-top stick and three buttons
 * per player, and a coin door. Its static parts go into the arcade's baked
 * meshes (shared materials, one atlas); the screen is its own canvas.
 *
 * Local frame: the cabinet's front faces +Z (players stand there), x across.
 */

/** Side profile (z, y), back-bottom round to the top: kick panel, control shelf, tilted screen, marquee. */
const PROFILE: [number, number][] = [
  [-0.39, 0],
  [0.33, 0],
  [0.33, 0.86],
  [0.46, 0.91],
  [0.46, 0.97],
  [0.22, 1.04],
  [0.18, 1.06],
  [0.04, 1.56],
  [0.12, 1.6],
  [0.14, 1.86],
  [-0.39, 1.86],
];
const Z0 = -0.39,
  Z1 = 0.46,
  TOP = 1.86;
/** The control panel's surface: front edge, back edge (z, y). */
const PANEL_FRONT: [number, number] = [0.46, 0.97];
const PANEL_BACK: [number, number] = [0.22, 1.04];
/** The screen's slope (bottom, top). */
const SCREEN_BOT: [number, number] = [0.18, 1.06];
const SCREEN_TOP: [number, number] = [0.04, 1.56];

export interface CabinetMats {
  body: THREE.Material;
  art: THREE.Material;
  lit: THREE.Material;
}

/** Rewrites a geometry's UVs (per face, as BoxGeometry/PlaneGeometry lay them out) into atlas rects. */
function remapUV(geo: THREE.BufferGeometry, rectFor: (face: number) => [number, number, number, number]) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // Box and plane geometries are indexed with 4 vertices per face, in face order.
  for (let i = 0; i < uv.count; i++) {
    const f = Math.floor(i / 4);
    const [u0, v0, u1, v1] = rectFor(f);
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
  uv.needsUpdate = true;
  return geo;
}

export function box(w: number, h: number, d: number, rect: (face: number) => [number, number, number, number]) {
  return remapUV(new THREE.BoxGeometry(w, h, d), rect);
}

export function plane(w: number, h: number, rect: [number, number, number, number]) {
  return remapUV(new THREE.PlaneGeometry(w, h), () => rect);
}

/** A slanted plane between two (z, y) points across width w, facing out (+z-ish), lifted `out` along its normal. */
function slopePlane(w: number, a: [number, number], b: [number, number], rect: [number, number, number, number], out = 0.003, mat?: THREE.Material) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const m = new THREE.Mesh(plane(w, len, rect), mat);
  // Bottom at a, top at b.
  const ang = Math.atan2(b[0] - a[0], b[1] - a[1]);
  m.rotation.x = ang;
  const n = new THREE.Vector3(0, -Math.sin(ang), Math.cos(ang));
  m.position.set(0, (a[1] + b[1]) / 2, (a[0] + b[0]) / 2).addScaledVector(n, out);
  return m;
}

/** The panel surface frame in cabinet space (x across, y out of the surface, z toward the player). */
export function panelFrame(): THREE.Matrix4 {
  const [fz, fy] = PANEL_FRONT,
    [bz, by] = PANEL_BACK;
  const ang = Math.atan2(by - fy, fz - bz);
  const m = new THREE.Matrix4().makeRotationX(ang);
  m.setPosition(0, (fy + by) / 2, (fz + bz) / 2);
  return m;
}

const PANEL_DEPTH = Math.hypot(PANEL_FRONT[0] - PANEL_BACK[0], PANEL_FRONT[1] - PANEL_BACK[1]);

/** Builds the static meshes of a cabinet into `g` (to be baked). */
export function buildCabinetBody(g: THREE.Group, tile: number, width: number, trim: string, mats: CabinetMats) {
  const inner = width - 0.04;
  const shape = new THREE.Shape(PROFILE.map(([z, y]) => new THREE.Vector2(z, y)));
  // The core, between the side panels.
  const core = new THREE.ExtrudeGeometry(shape, { depth: inner, bevelEnabled: false });
  core.rotateY(-Math.PI / 2);
  core.translate(inner / 2, 0, 0);
  const coreUV = swatchUV(swatch('#0c0b10'));
  {
    const uv = core.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (coreUV[0] + coreUV[2]) / 2, (coreUV[1] + coreUV[3]) / 2);
  }
  g.add(new THREE.Mesh(core, mats.body));
  // Side panels with the art, mapped from their shape (so the art reads the right way round from either side).
  const side = REGION.side;
  for (const sgn of [-1, 1]) {
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.022, bevelEnabled: false });
    geo.rotateY(-Math.PI / 2);
    geo.translate(sgn > 0 ? width / 2 : -width / 2 + 0.022, 0, 0);
    const [u0, v0, u1, v1] = uvRect(tile, side, 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i),
        y = pos.getY(i);
      // Seen from outside, the front is to your right on the left panel and to your left on the right one.
      let k = (z - Z0) / (Z1 - Z0);
      if (sgn > 0) k = 1 - k;
      uv.setXY(i, u0 + k * (u1 - u0), v0 + (y / TOP) * (v1 - v0));
    }
    g.add(new THREE.Mesh(geo, mats.art));
  }
  // Marquee (lit), bezel, control panel print, coin door.
  g.add(slopePlane(inner, [0.12, 1.6], [0.14, 1.86], uvRect(tile, REGION.marquee), 0.003, mats.lit));
  g.add(slopePlane(inner, SCREEN_BOT, SCREEN_TOP, uvRect(tile, REGION.bezel), 0.003, mats.lit));
  g.add(slopePlane(inner, PANEL_FRONT, PANEL_BACK, uvRect(tile, REGION.panel), 0.002, mats.art));
  const door = new THREE.Mesh(plane(inner, 0.8, uvRect(tile, REGION.door)), mats.art);
  door.position.set(0, 0.06 + 0.4, 0.333);
  g.add(door);
  // Neon trim: along the marquee's lower edge and down the front of the panel.
  const t = swatchUV(swatch(trim));
  const strip = new THREE.Mesh(box(width + 0.004, 0.012, 0.03, () => t), mats.lit);
  strip.position.set(0, 1.6, 0.115);
  g.add(strip);
  const lip = new THREE.Mesh(box(width + 0.004, 0.012, 0.012, () => t), mats.lit);
  lip.position.set(0, 0.94, 0.466);
  g.add(lip);
  // Button bezels (chrome rings) and the stick's dust washer are part of the print; a black kick plate.
  const kick = new THREE.Mesh(box(width, 0.06, 0.02, () => swatchUV(swatch('#050507'))), mats.body);
  kick.position.set(0, 0.03, 0.335);
  g.add(kick);
}

export interface CabinetOpts {
  game: Game;
  tile: number;
  pos: THREE.Vector3;
  yaw: number;
  hooks: Omit<MachineHooks, 'sfx'>;
  audio: ArcadeAudio;
  inst: ControlInstances;
  mats: CabinetMats;
  /** Where the baked parts go. */
  bakeRoot: THREE.Group;
  /** Where live parts (the screen) go. */
  liveRoot: THREE.Group;
}

const BUTTON_COLORS = [0xff3b4f, 0xffd34d, 0x3ad8ff];

export class Cabinet {
  readonly group = new THREE.Group();
  readonly machine: Machine;
  readonly sound: CabinetSound;
  readonly sets: ControlSet[] = [];
  readonly width: number;
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  readonly screen: THREE.Mesh;
  /** Where each player stands (world), and the desktop framing per player. */
  readonly viewpoints: Viewpoint[] = [];
  readonly screenCenter = new THREE.Vector3();
  /** Seconds since the screen was last drawn. */
  private drawT = 0;
  readonly id: string;

  constructor(
    readonly index: number,
    o: CabinetOpts,
  ) {
    const meta = o.game.meta;
    this.id = `arc${index}`;
    this.width = meta.players === 2 ? 1.02 : 0.76;
    this.group.position.copy(o.pos);
    this.group.rotation.y = o.yaw;
    this.group.name = `cabinet-${meta.id}`;
    o.bakeRoot.add(this.group);
    buildCabinetBody(this.group, o.tile, this.width, meta.colors.trim, o.mats);
    this.group.updateMatrixWorld(true);

    // The screen: a 320x240 canvas, crisp pixels.
    this.canvas = document.createElement('canvas');
    this.canvas.width = SCREEN_W;
    this.canvas.height = SCREEN_H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.NearestFilter;
    const sw = Math.min(0.56, this.width - 0.2);
    const len = Math.hypot(SCREEN_TOP[0] - SCREEN_BOT[0], SCREEN_TOP[1] - SCREEN_BOT[1]);
    const sh = Math.min(sw * 0.75, len - 0.1);
    this.screen = slopePlane(sh / 0.75, SCREEN_BOT, SCREEN_TOP, [0, 0, 1, 1], 0.006, new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }));
    this.screen.geometry.dispose();
    this.screen.geometry = new THREE.PlaneGeometry(sh / 0.75, sh);
    this.screen.userData.dynamic = true;
    this.screen.matrixAutoUpdate = false;
    this.screen.updateMatrix();
    this.screen.matrix.premultiply(this.group.matrixWorld);
    this.screen.matrixWorldNeedsUpdate = true;
    o.liveRoot.add(this.screen);
    this.screenCenter.setFromMatrixPosition(this.screen.matrix);

    // Controls.
    const pf = panelFrame().premultiply(this.group.matrixWorld);
    const inner = this.width - 0.04;
    const layout = controlLayout(meta.players);
    for (const set of layout) {
      const at = (u: number, v: number) => new THREE.Vector3((u - 0.5) * inner, 0, -PANEL_DEPTH / 2 + v * PANEL_DEPTH);
      const cs = new ControlSet(
        o.inst,
        pf,
        at(set.stick[0], set.stick[1]),
        set.buttons.map(([u, v]) => at(u, v).setY(0.002)),
        new THREE.Color(meta.colors.accent),
        BUTTON_COLORS.map((c) => new THREE.Color(c)),
        meta.buttons.map((b) => !!b),
      );
      this.sets.push(cs);
    }

    this.sound = new CabinetSound(o.audio, this.screen);
    this.machine = new Machine(o.game, { ...o.hooks, sfx: (n, v, p) => this.sound.sfx(n, v, p) });

    // Where you stand to play: in front of each control set. Desktop: framed on the screen.
    const fwd = new THREE.Vector3(Math.sin(o.yaw), 0, Math.cos(o.yaw));
    const right = new THREE.Vector3(Math.cos(o.yaw), 0, -Math.sin(o.yaw));
    layout.forEach((set, k) => {
      const across = (set.stick[0] + 0.1 - 0.5) * inner;
      const stand = o.pos
        .clone()
        .addScaledVector(fwd, 0.82)
        .addScaledVector(right, meta.players === 2 ? across * 0.9 : 0);
      this.viewpoints.push({
        id: `${this.id}p${k + 1}`,
        label: meta.sub ? `${meta.title} ${meta.sub}` : meta.title,
        position: stand,
        // Facing the cabinet (player yaw: 0 looks toward -Z).
        yaw: o.yaw,
        pitch: -0.2,
        eye: this.screenCenter.y + 0.07,
        back: -0.22,
        portrait: { back: 0.05, eye: this.screenCenter.y + 0.12, pitch: -0.24 },
      });
    });
  }

  /** Is a world point in front of this cabinet, near enough to play? Returns the control set index or -1. */
  standingAt(p: THREE.Vector3, reach = 0.75): number {
    let best = -1,
      bd = reach;
    for (let k = 0; k < this.viewpoints.length; k++) {
      const v = this.viewpoints[k].position;
      const d = Math.hypot(p.x - v.x, p.z - v.z);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  }

  /**
   * Draws the screen if it's due: every frame while it's being played or
   * watched, ~5 fps in attract mode, never when nobody's near.
   */
  draw(dt: number, t: number, rate: number) {
    this.drawT += dt;
    if (rate <= 0 || this.drawT < 1 / rate - 1e-4) return false;
    this.drawT = 0;
    this.machine.render(this.ctx, t);
    this.texture.needsUpdate = true;
    return true;
  }

  forceDraw(t: number) {
    this.machine.render(this.ctx, t);
    this.texture.needsUpdate = true;
  }
}
