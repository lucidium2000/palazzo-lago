import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Viewpoint } from '../player';
import { REGION, swatch, swatchUV, tileOrigin, uvRect } from './art';
import { box } from './cabinet';
import { ControlSet } from './controls';
import type { DeskStation } from './desk';
import { floorEmit, type FloorEnv, type FloorFrame, type FloorGame } from './floor';
import { text } from './font';
import { CLAW, dropDepth, grabChance, makePile, overChute, prizeUnder, stepBody } from './clawlogic';
import type { ArcadeFriend, ArcadeSession } from './net';
import { CabinetSound } from './synth';
import { Rng } from './types';
import type { ArcadeSlot } from './index';

/**
 * LUCKY CLAW: the crane game. Press the button ($1), steer the claw with the
 * stick for up to twenty seconds, press again to drop it. It closes on
 * whatever's under it: dead centre on a plush it holds most of the time,
 * on the edge rarely, and sometimes it slips on the way up. Anything it
 * carries to the chute drops out of the prize door for you to take: grab it
 * (VR) or click it (screens) and carry it about, toss it (throw it, or G).
 *
 * The plush are the house's own: Chipper (a casino chip with feet), Dicey
 * (a dice bear), the Cherry Twins, Lucky Star and Olive the martini octopus.
 */

export const PRIZE_NAMES = ['Chipper', 'Dicey', 'the Cherry Twins', 'Lucky Star', 'Olive the Octopus'];
const DESIGNS = PRIZE_NAMES.length;
const MAX = 24;
const PILE = 14;
const MAX_LOOSE = 8;
const DOOR = { x: -0.25, y: 0.36, z: 0.5 };

type PState = 'none' | 'pile' | 'claw' | 'fall' | 'door' | 'held' | 'carry' | 'loose';

interface Prize {
  design: number;
  state: PState;
  /** Machine frame for pile/claw/fall/door; world for held/carry/loose. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  tumble: number;
  live: boolean;
  /** When it became loose (oldest go first). */
  bornAt: number;
  /** An invisible box to click it by (screens). */
  proxy: THREE.Object3D | null;
}

type Phase = 'idle' | 'aim' | 'drop' | 'close' | 'lift' | 'carry' | 'release';

// --- The plush, as vertex-coloured merged geometries ---------------------------

function tint(g: THREE.BufferGeometry, color: number) {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  const out = g.index ? g.toNonIndexed() : g;
  if (out !== g) {
    const m = out.attributes.position.count;
    const b = new Float32Array(m * 3);
    for (let i = 0; i < m; i++) b.set([c.r, c.g, c.b], i * 3);
    out.setAttribute('color', new THREE.BufferAttribute(b, 3));
  } else out.setAttribute('color', new THREE.BufferAttribute(a, 3));
  out.deleteAttribute('uv');
  return out;
}

function at(g: THREE.BufferGeometry, x: number, y: number, z: number) {
  return g.translate(x, y, z);
}

function eyes(y: number, z: number, sep = 0.016, r = 0.011): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    out.push(tint(at(new THREE.SphereGeometry(r, 10, 8), s * sep, y, z), 0xffffff));
    out.push(tint(at(new THREE.SphereGeometry(r * 0.5, 8, 6), s * sep, y, z + r * 0.7), 0x111111));
  }
  return out;
}

export function prizeGeometry(design: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  switch (design) {
    case 0: {
      // Chipper: a red chip on its edge, white edge spots, eyes, little feet.
      parts.push(tint(at(new THREE.CylinderGeometry(0.05, 0.05, 0.028, 24).rotateX(Math.PI / 2), 0, 0.055, 0), 0xd8262e));
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        parts.push(tint(at(new THREE.BoxGeometry(0.012, 0.012, 0.03), Math.cos(a) * 0.046, 0.055 + Math.sin(a) * 0.046, 0), 0xffffff));
      }
      parts.push(tint(at(new THREE.CylinderGeometry(0.032, 0.032, 0.03, 20).rotateX(Math.PI / 2), 0, 0.055, 0.001), 0xf4efe4));
      parts.push(...eyes(0.065, 0.016));
      for (const s of [-1, 1]) parts.push(tint(at(new THREE.BoxGeometry(0.022, 0.012, 0.03), s * 0.02, 0.006, 0.006), 0x1a1a1a));
      break;
    }
    case 1: {
      // Dicey: a white dice body, black pips, round ears, a snout.
      parts.push(tint(at(new THREE.BoxGeometry(0.07, 0.07, 0.07), 0, 0.035, 0), 0xf6f2ea));
      for (const [px, py] of [
        [-0.02, 0.055],
        [0.02, 0.015],
        [0.02, 0.055],
        [-0.02, 0.015],
      ])
        parts.push(tint(at(new THREE.SphereGeometry(0.006, 6, 4), px, py, 0.0355), 0x111111));
      for (const s of [-1, 1]) parts.push(tint(at(new THREE.SphereGeometry(0.016, 10, 8), s * 0.026, 0.074, -0.01), 0xf6f2ea));
      parts.push(tint(at(new THREE.SphereGeometry(0.014, 10, 8), 0, 0.03, 0.037), 0xe8b89a));
      parts.push(...eyes(0.048, 0.036, 0.016, 0.008));
      break;
    }
    case 2: {
      // The Cherry Twins: two round cherries on a forked stem, a leaf.
      for (const s of [-1, 1]) {
        parts.push(tint(at(new THREE.SphereGeometry(0.033, 14, 10), s * 0.032, 0.033, 0), 0xc8102e));
        parts.push(...eyes(0.04, 0.03, 0.01, 0.007).map((g) => g.translate(s * 0.032, 0, 0)));
        const stem = new THREE.CylinderGeometry(0.004, 0.004, 0.06, 6);
        stem.rotateZ(s * 0.5);
        parts.push(tint(at(stem, s * 0.016, 0.085, 0), 0x2a8a3a));
      }
      parts.push(tint(at(new THREE.SphereGeometry(0.018, 8, 6).scale(1.6, 0.4, 1), 0.012, 0.112, 0), 0x3fb34f));
      break;
    }
    case 3: {
      // Lucky Star: a fat gold star with a face.
      const s = new THREE.Shape();
      for (let k = 0; k < 10; k++) {
        const a = Math.PI / 2 + (k / 10) * Math.PI * 2;
        const r = k % 2 ? 0.026 : 0.058;
        if (k) s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        else s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 1 });
      g.translate(0, 0.058, -0.015);
      parts.push(tint(g, 0xffc928));
      parts.push(...eyes(0.065, 0.024, 0.014, 0.008));
      parts.push(tint(at(new THREE.SphereGeometry(0.006, 6, 4).scale(2, 0.8, 1), 0, 0.048, 0.024), 0x8a3a10));
      break;
    }
    default: {
      // Olive the martini octopus: a round purple head, four curly legs, an olive hat.
      parts.push(tint(at(new THREE.SphereGeometry(0.04, 16, 12), 0, 0.06, 0), 0x9b4fd8));
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const leg = new THREE.CapsuleGeometry(0.011, 0.04, 3, 6);
        leg.rotateZ(Math.PI / 2 - 0.5).rotateY(-a);
        parts.push(tint(at(leg, Math.cos(a) * 0.04, 0.014, Math.sin(a) * 0.04), 0x8a3ec8));
      }
      parts.push(tint(at(new THREE.SphereGeometry(0.013, 10, 8), 0, 0.104, 0), 0x6b8a1a));
      parts.push(tint(at(new THREE.SphereGeometry(0.005, 6, 4), 0, 0.108, 0.011), 0xd83a2a));
      parts.push(...eyes(0.066, 0.036, 0.015, 0.009));
      break;
    }
  }
  const norm = parts.map((p) => {
    const q = p.index ? p.toNonIndexed() : p;
    if (q.attributes.uv) q.deleteAttribute('uv');
    if (!q.attributes.normal) q.computeVertexNormals();
    return q;
  });
  return mergeGeometries(norm)!;
}

function paintClaw(g: CanvasRenderingContext2D) {
  // Side art in tile 7's bezel region; marquee in tile 6's panel region; prize door in tile 7's door region.
  {
    const [ox, oy] = tileOrigin(7);
    const r = REGION.bezel;
    g.save();
    g.translate(ox + r.x, oy + r.y);
    const gr = g.createLinearGradient(0, 0, 0, r.h);
    gr.addColorStop(0, '#ff5ab4');
    gr.addColorStop(1, '#7a1fa0');
    g.fillStyle = gr;
    g.fillRect(0, 0, r.w, r.h);
    g.fillStyle = '#ffffff';
    g.globalAlpha = 0.18;
    for (let k = 0; k < 14; k++) {
      g.beginPath();
      g.arc((k * 53) % r.w, (k * 37) % r.h, 10 + (k % 4) * 6, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    g.shadowColor = '#ffffff';
    g.shadowBlur = 8;
    text(g, 'LUCKY', r.w / 2, 60, '#ffffff', 5, 'center');
    text(g, 'CLAW', r.w / 2, 110, '#ffd34d', 6, 'center');
    g.shadowBlur = 0;
    text(g, 'WIN A PLUSH PAL', r.w / 2, 178, '#ffffff', 2, 'center');
    g.restore();
  }
  {
    const [ox, oy] = tileOrigin(6);
    const r = REGION.panel;
    g.save();
    g.translate(ox + r.x, oy + r.y);
    g.fillStyle = '#2a0a3a';
    g.fillRect(0, 0, r.w, r.h);
    g.strokeStyle = '#ffd34d';
    g.lineWidth = 3;
    g.strokeRect(3, 3, r.w - 6, r.h - 6);
    for (let k = 0; k < 18; k++) {
      g.fillStyle = k % 2 ? '#ffd34d' : '#ffffff';
      g.fillRect(8 + k * 15, 8, 5, 5);
      g.fillRect(8 + k * 15, r.h - 13, 5, 5);
    }
    g.shadowColor = '#ff5ab4';
    g.shadowBlur = 10;
    text(g, 'LUCKY CLAW', r.w / 2, 30, '#ffffff', 4, 'center');
    g.restore();
  }
  {
    const [ox, oy] = tileOrigin(7);
    const r = REGION.door;
    g.save();
    g.translate(ox + r.x, oy + r.y);
    g.fillStyle = '#2a0a3a';
    g.fillRect(0, 0, r.w, r.h);
    g.fillStyle = '#0a0410';
    g.fillRect(16, 14, 90, 64);
    g.strokeStyle = '#ffd34d';
    g.lineWidth = 3;
    g.strokeRect(16, 14, 90, 64);
    text(g, 'PRIZE', 61, 40, '#ffd34d', 2, 'center');
    text(g, '$1 A PLAY', 196, 30, '#ffffff', 2, 'center');
    text(g, 'STICK . BUTTON', 196, 58, '#ff5ab4', 1, 'center');
    g.restore();
  }
}

export class Claw implements FloorGame {
  readonly id = 'claw';
  readonly title = 'LUCKY CLAW';
  readonly center: THREE.Vector3;
  readonly viewpoints: Viewpoint[];
  readonly desk: DeskStation = { id: 'claw', buttons: ['DROP', '', ''], help: 'LUCKY CLAW · Space to play ($1) and drop · Arrows/WASD steer · Esc leave' };
  readonly group = new THREE.Group();
  readonly prizes: Prize[] = [];
  private meshes: THREE.InstancedMesh[] = [];
  private set: ControlSet;
  private sound: CabinetSound;
  phase: Phase = 'idle';
  cx = CLAW.chute.x;
  cz = CLAW.chute.z;
  drop = 0;
  open = 1;
  held = -1;
  private slipAt = -1;
  private timer = 0;
  private rng = new Rng((Math.random() * 1e9) | 0);
  private session: ArcadeSession | null = null;
  /** Someone else is at the controls (their id) until then. */
  private remote: { id: string; name: string; until: number } | null = null;
  private time = 0;
  private sendT = 0;
  private dirty = true;
  private trolley: THREE.Mesh;
  private cable: THREE.Mesh;
  private hub: THREE.Mesh;
  private fingers: THREE.Mesh[] = [];
  private tmpM = new THREE.Matrix4();
  private tmpQ2 = new THREE.Quaternion();
  private xrPad = { x: 0, y: 0, a: false };
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private inv = new THREE.Matrix4();
  private prevA = false;
  /** Desktop: the prize you're carrying (index), or -1. */
  private carrying = -1;
  private mine = false;

  constructor(
    private env: FloorEnv,
    slot: ArcadeSlot,
    atlas: CanvasRenderingContext2D,
  ) {
    paintClaw(atlas);
    this.group.position.copy(slot.pos);
    this.group.rotation.y = slot.yaw;
    this.group.name = 'claw';
    env.bakeRoot.add(this.group);
    this.group.updateMatrixWorld(true);
    this.inv.copy(this.group.matrixWorld).invert();
    this.center = slot.pos.clone();
    const m = env.mats;
    const sw = (c: string) => swatchUV(swatch(c));
    const W = 0.9;
    // Base with art on every side, glass box, posts, top sign.
    const base = new THREE.Mesh(box(W, 0.9, W, (f) => (f === 4 ? uvRect(7, REGION.door) : f === 2 || f === 3 ? sw('#2a0a3a') : uvRect(7, REGION.bezel))), m.art);
    base.position.set(0, 0.45, 0);
    this.group.add(base);
    const floor = new THREE.Mesh(box(W - 0.04, 0.02, W - 0.04, () => sw('#3a1050')), m.art);
    floor.position.set(0, CLAW.floor - 0.01, 0);
    this.group.add(floor);
    // The chute's clear rim (a low wall round the hole) and the hole itself.
    const hole = new THREE.Mesh(box(CLAW.chute.half * 2, 0.022, CLAW.chute.half * 2, () => sw('#050507')), m.body);
    hole.position.set(CLAW.chute.x, CLAW.floor - 0.009, CLAW.chute.z);
    this.group.add(hole);
    for (const [dx, dz, w, d] of [
      [CLAW.chute.half, 0, 0.01, CLAW.chute.half * 2],
      [0, -CLAW.chute.half, CLAW.chute.half * 2, 0.01],
    ]) {
      const wall = new THREE.Mesh(box(w, 0.1, d, () => sw('#ffd34d')), m.lit);
      wall.position.set(CLAW.chute.x + dx, CLAW.floor + 0.05, CLAW.chute.z + dz);
      this.group.add(wall);
    }
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(box(0.04, 1.0, 0.04, () => sw('#ffd34d')), m.lit);
        post.position.set(sx * (W / 2 - 0.02), 1.4, sz * (W / 2 - 0.02));
        this.group.add(post);
      }
    const top = new THREE.Mesh(box(W + 0.04, 0.22, W + 0.04, (f) => (f === 4 || f === 5 || f === 0 || f === 1 ? uvRect(6, REGION.panel) : sw('#2a0a3a'))), m.lit);
    top.position.set(0, 2.01, 0);
    this.group.add(top);
    // Gantry rails.
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(box(0.02, 0.02, W - 0.06, () => sw('#c8c8d0')), m.body);
      rail.position.set(sx * (CLAW.half + 0.02), CLAW.top + 0.16, 0);
      this.group.add(rail);
    }
    // The control shelf.
    const shelf = new THREE.Mesh(box(W, 0.05, 0.16, (f) => (f === 2 ? sw('#16101e') : sw('#ff5ab4'))), m.art);
    shelf.position.set(0, 0.94, W / 2 + 0.07);
    this.group.add(shelf);
    // Glass (one transparent mesh).
    const glassGeo = mergeGeometries([
      new THREE.PlaneGeometry(W - 0.04, 0.96).translate(0, 1.42, W / 2 - 0.02),
      new THREE.PlaneGeometry(W - 0.04, 0.96).rotateY(Math.PI).translate(0, 1.42, -W / 2 + 0.02),
      new THREE.PlaneGeometry(W - 0.04, 0.96).rotateY(Math.PI / 2).translate(W / 2 - 0.02, 1.42, 0),
      new THREE.PlaneGeometry(W - 0.04, 0.96).rotateY(-Math.PI / 2).translate(-W / 2 + 0.02, 1.42, 0),
    ])!;
    const glass = new THREE.Mesh(glassGeo, new THREE.MeshStandardMaterial({ color: 0xbfe4ff, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.2, depthWrite: false }));
    glass.renderOrder = 2;
    glass.userData.dynamic = true;
    this.group.add(glass);
    // The prize door's little shelf, out front.
    const ledge = new THREE.Mesh(box(0.2, 0.02, 0.12, () => sw('#ffd34d')), m.lit);
    ledge.position.set(DOOR.x, DOOR.y - CLAW.prizeR - 0.01, DOOR.z - 0.02);
    this.group.add(ledge);

    // The claw: trolley, cable, hub, three fingers (live).
    const steel = new THREE.MeshStandardMaterial({ color: 0xd8d8e0, metalness: 0.85, roughness: 0.25 });
    this.trolley = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.1), steel);
    this.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 1, 5).translate(0, -0.5, 0), steel);
    this.hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.05, 12), new THREE.MeshStandardMaterial({ color: 0xffd34d, metalness: 0.6, roughness: 0.3 }));
    const fingerGeo = new THREE.BoxGeometry(0.008, 0.075, 0.014).translate(0, -0.0375, 0);
    for (const o of [this.trolley, this.cable, this.hub]) {
      o.userData.dynamic = true;
      this.group.add(o);
    }
    for (let k = 0; k < 3; k++) {
      const f = new THREE.Mesh(fingerGeo, steel);
      f.userData.dynamic = true;
      this.group.add(f);
      this.fingers.push(f);
    }
    // Prizes: one instanced mesh per plush design.
    const pm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    for (let d = 0; d < DESIGNS; d++) {
      const im = new THREE.InstancedMesh(prizeGeometry(d), pm, MAX);
      im.frustumCulled = false;
      im.userData.dynamic = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      env.liveRoot.add(im);
      this.meshes.push(im);
    }
    for (let i = 0; i < MAX; i++) this.prizes.push({ design: 0, state: 'none', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, tumble: 0, live: false, bornAt: 0, proxy: null });
    this.refill(7);

    // The stick and the button on the shelf (stick left, button right).
    const panel = new THREE.Matrix4().makeTranslation(0, 0.965, W / 2 + 0.07).premultiply(this.group.matrixWorld);
    this.set = new ControlSet(env.inst, panel, new THREE.Vector3(-0.16, 0, 0), [new THREE.Vector3(0.14, 0.002, 0), new THREE.Vector3(0.3, 0, 0), new THREE.Vector3(0.3, 0, 0.03)], new THREE.Color(0xff5ab4), [new THREE.Color(0xffd34d), new THREE.Color(0), new THREE.Color(0)], [true, false, false]);
    env.hands.register(this.set.grab);
    this.set.onPress = (_b, side) => {
      if (side) env.haptic(side, 0.6, 30);
    };

    // Taking prizes: grab them (VR) or click them (screens).
    this.prizes.forEach((p, i) => {
      env.hands.register({
        radius: 0.1,
        at: () => this.worldPos(p, this.tmpV),
        enabled: () => p.state === 'door' || p.state === 'loose',
        grab: () => {
          this.toWorld(p);
          p.state = 'held';
          this.dirty = true;
          if (this.carrying === i) this.carrying = -1;
          return 'drag';
        },
        drag: (_h, pos) => {
          p.x = pos.x;
          p.y = pos.y - 0.04;
          p.z = pos.z;
          this.dirty = true;
        },
        release: (hand) => {
          const v = env.hands.velocity(hand);
          p.vx = v.x;
          p.vy = v.y;
          p.vz = v.z;
          this.makeLoose(p);
        },
      });
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), new THREE.MeshBasicMaterial({ visible: false }));
      proxy.userData.dynamic = true;
      env.liveRoot.add(proxy);
      env.interaction.register({
        object: proxy,
        label: () => `Take ${PRIZE_NAMES[p.design]}`,
        enabled: () => !env.player.inXR && (p.state === 'door' || p.state === 'loose') && this.carrying < 0,
        onSelect: () => this.pickUpDesk(i),
      });
      p.proxy = proxy;
    });
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyG' && this.carrying >= 0 && !env.player.inXR) this.tossDesk();
    });

    this.sound = new CabinetSound(env.audio, this.hub, { ref: 1.4, volume: 0.35 });
    this.viewpoints = [
      {
        id: 'claw',
        label: 'Lucky Claw',
        position: new THREE.Vector3(0, 0, W / 2 + 0.5).applyMatrix4(this.group.matrixWorld).setY(0),
        yaw: slot.yaw,
        pitch: -0.34,
        eye: 1.62,
        back: 0.5,
        portrait: { back: 0.55, eye: 1.6, pitch: -0.32 },
      },
    ];
    if (env.colliders) env.world.addLocalBox(this.group, 0, 0.04, W + 0.04, W + 0.12, 'arcade claw');
  }

  /** A fresh pile (the same for everyone: the seed is shared). */
  refill(seed: number) {
    const pile = makePile(seed, PILE, DESIGNS);
    let k = 0;
    for (const p of this.prizes) {
      if (p.state === 'loose' || p.state === 'held' || p.state === 'carry' || p.state === 'door') continue;
      const s = pile[k++];
      if (!s) {
        p.state = 'none';
        p.live = false;
        continue;
      }
      Object.assign(p, { design: s.design, state: 'pile', x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, yaw: s.yaw, live: true });
    }
    this.dirty = true;
  }

  private pileCount() {
    let n = 0;
    for (const p of this.prizes) if (p.state === 'pile' || p.state === 'claw' || p.state === 'fall') n++;
    return n;
  }

  private worldPos(p: Prize, out: THREE.Vector3) {
    out.set(p.x, p.y, p.z);
    if (p.state !== 'held' && p.state !== 'carry' && p.state !== 'loose') out.applyMatrix4(this.group.matrixWorld);
    return out;
  }

  private toWorld(p: Prize) {
    if (p.state === 'held' || p.state === 'carry' || p.state === 'loose') return;
    this.worldPos(p, this.tmpV);
    p.x = this.tmpV.x;
    p.y = this.tmpV.y;
    p.z = this.tmpV.z;
  }

  private makeLoose(p: Prize) {
    p.state = 'loose';
    p.bornAt = this.time;
    this.dirty = true;
    // Too many lying about: the oldest one goes back to the house.
    const loose = this.prizes.filter((q) => q.state === 'loose');
    if (loose.length > MAX_LOOSE) {
      loose.sort((a, b) => a.bornAt - b.bornAt);
      loose[0].state = 'none';
      loose[0].live = false;
    }
  }

  private pickUpDesk(i: number) {
    const p = this.prizes[i];
    if (p.state !== 'door' && p.state !== 'loose') return;
    this.toWorld(p);
    p.state = 'carry';
    this.carrying = i;
    this.dirty = true;
    this.env.toast(`You have ${PRIZE_NAMES[p.design]}! Press G to toss it`, 'win');
  }

  private tossDesk() {
    const p = this.prizes[this.carrying];
    this.carrying = -1;
    if (!p) return;
    const cam = this.env.camera;
    const fwd = this.tmpV.set(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(this.tmpQ));
    p.vx = fwd.x * 3.5;
    p.vy = fwd.y * 3.5 + 1.8;
    p.vz = fwd.z * 3.5;
    this.makeLoose(p);
    this.sound.sfx('whoosh', 0.4);
  }

  // --- Playing ---------------------------------------------------------------

  private coin() {
    if (this.remote && this.time < this.remote.until) {
      this.env.toast(`${this.remote.name} is at the Lucky Claw`, 'info');
      return;
    }
    if (!this.env.pay('Lucky Claw')) return;
    this.phase = 'aim';
    this.timer = CLAW.aimTime;
    this.mine = true;
    this.sound.sfx('coin', 0.8);
    if (this.pileCount() < 5) {
      const seed = (Math.random() * 1e6) | 0;
      this.refill(seed);
      floorEmit(this.session, this.id, { k: 'r', s: seed });
    }
  }

  private pileView() {
    return this.prizes.map((p) => ({ x: p.x, y: p.y, z: p.z, live: p.state === 'pile' }));
  }

  private runClaw(dt: number, pad: { x: number; y: number; a: boolean } | null) {
    const press = !!pad?.a && !this.prevA;
    this.prevA = !!pad?.a;
    switch (this.phase) {
      case 'idle':
        if (press) this.coin();
        break;
      case 'aim': {
        this.timer -= dt;
        if (pad) {
          const lim = CLAW.half - 0.04;
          const nx = Math.max(-lim, Math.min(lim, this.cx + pad.x * CLAW.move * dt));
          const nz = Math.max(-lim, Math.min(lim, this.cz - pad.y * CLAW.move * dt));
          if (nx !== this.cx || nz !== this.cz) {
            if (Math.floor(this.time * 8) !== Math.floor((this.time - dt) * 8)) this.sound.sfx('move', 0.2);
            this.cx = nx;
            this.cz = nz;
          }
        }
        if (press || this.timer <= 0) {
          this.phase = 'drop';
          this.sound.sfx('zap', 0.4, 0.5);
        }
        break;
      }
      case 'drop': {
        const target = dropDepth(this.pileView(), this.cx, this.cz);
        this.drop = Math.min(target, this.drop + CLAW.drop * dt);
        if (this.drop >= target - 1e-4) {
          this.phase = 'close';
          this.timer = 0.6;
        }
        break;
      }
      case 'close':
        this.open = Math.max(0, this.open - dt / 0.5);
        this.timer -= dt;
        if (this.timer <= 0) {
          const i = prizeUnder(this.pileView(), this.cx, this.cz);
          if (i >= 0) {
            const p = this.prizes[i];
            const chance = grabChance(Math.hypot(p.x - this.cx, p.z - this.cz));
            if (this.rng.next() < chance) {
              this.held = i;
              p.state = 'claw';
              this.slipAt = this.rng.next() < 0.14 ? this.rng.range(0.05, Math.max(0.06, this.drop - 0.05)) : -1;
              this.sound.sfx('clunk', 0.6, 1.4);
              floorEmit(this.session, this.id, { k: 'k', i });
              this.settlePile();
            } else this.sound.sfx('miss', 0.5);
          }
          this.phase = 'lift';
        }
        break;
      case 'lift':
        this.drop = Math.max(0, this.drop - CLAW.drop * 0.8 * dt);
        if (this.held >= 0 && this.slipAt >= 0 && this.drop <= this.slipAt) this.slip();
        if (this.drop <= 0) this.phase = 'carry';
        break;
      case 'carry': {
        const dx = CLAW.chute.x - this.cx,
          dz = CLAW.chute.z - this.cz;
        const d = Math.hypot(dx, dz);
        const step = CLAW.move * dt;
        if (d <= step) {
          this.cx = CLAW.chute.x;
          this.cz = CLAW.chute.z;
          this.phase = 'release';
          this.timer = 0.8;
        } else {
          this.cx += (dx / d) * step;
          this.cz += (dz / d) * step;
        }
        break;
      }
      case 'release':
        this.open = Math.min(1, this.open + dt / 0.3);
        if (this.held >= 0) {
          const p = this.prizes[this.held];
          p.state = 'fall';
          p.vx = p.vy = p.vz = 0;
          this.held = -1;
        }
        this.timer -= dt;
        if (this.timer <= 0) {
          this.phase = 'idle';
          this.mine = false;
          floorEmit(this.session, this.id, { k: 'c', x: r3(this.cx), z: r3(this.cz), d: 0, o: 1, h: -1, ph: 0 });
        }
        break;
    }
    // Keep the claw's open/closed look moving back to open when idle/aiming.
    if (this.phase === 'aim' || this.phase === 'idle' || this.phase === 'drop') this.open = Math.min(1, this.open + dt / 0.3);
  }

  private slip() {
    const p = this.prizes[this.held];
    p.state = 'fall';
    p.vx = this.rng.range(-0.2, 0.2);
    p.vz = this.rng.range(-0.2, 0.2);
    this.held = -1;
    this.sound.sfx('miss', 0.7);
  }

  /** Prizes left without anything under them fall. */
  private settlePile() {
    for (const p of this.prizes) {
      if (p.state !== 'pile' || p.y < CLAW.floor + CLAW.prizeR * 1.4) continue;
      let held = false;
      for (const q of this.prizes) if (q !== p && q.state === 'pile' && q.y < p.y && Math.hypot(q.x - p.x, q.z - p.z) < CLAW.prizeR * 1.6) held = true;
      if (!held) p.state = 'fall';
    }
  }

  connect(s: ArcadeSession | null) {
    this.session = s;
    this.remote = null;
  }

  receive(f: ArcadeFriend, d: Record<string, unknown>) {
    switch (d.k) {
      case 'c':
        if (this.mine) return;
        this.remote = { id: f.id, name: f.name, until: this.time + (Number(d.ph) ? 2 : 0) };
        this.cx = Number(d.x) || 0;
        this.cz = Number(d.z) || 0;
        this.drop = Number(d.d) || 0;
        this.open = Number(d.o) || 0;
        {
          const h = Number(d.h);
          if (h >= 0 && this.prizes[h] && this.prizes[h].state === 'pile') this.prizes[h].state = 'claw';
          if (this.held >= 0 && h !== this.held && this.prizes[this.held].state === 'claw') this.prizes[this.held].state = 'fall';
          this.held = h >= 0 ? h : -1;
        }
        this.dirty = true;
        break;
      case 'k': {
        const p = this.prizes[Number(d.i)];
        if (p && p.state === 'pile') {
          p.state = 'claw';
          this.held = Number(d.i);
          this.settlePile();
        }
        break;
      }
      case 'w': {
        const p = this.prizes[Number(d.i)];
        if (p && p.state !== 'door' && p.state !== 'held' && p.state !== 'carry' && p.state !== 'loose') this.toDoor(p);
        this.env.toast(`${f.name} won ${PRIZE_NAMES[p?.design ?? 0]} at the Lucky Claw!`, 'win');
        break;
      }
      case 'r':
        this.refill(Number(d.s) || 7);
        break;
    }
  }

  private toDoor(p: Prize) {
    p.state = 'door';
    p.x = DOOR.x;
    p.y = DOOR.y;
    p.z = DOOR.z;
    p.vx = p.vy = p.vz = 0;
    this.dirty = true;
  }

  update(f: FloorFrame) {
    const dt = f.dt;
    this.time += dt;
    const near = f.dist < 12;
    // Controls: hands in VR when you're at it; the desk pad on a screen.
    const busyRemote = !!this.remote && this.time < this.remote.until && !this.mine;
    let pad: { x: number; y: number; a: boolean } | null = null;
    if (f.inXR && f.dist < 1.6) {
      this.env.touch.gather(this.env.hands);
      this.set.pressFrom(this.env.touch.points, this.env.touch.sides, this.env.touch.count);
      this.xrPad.x = this.set.stick.x;
      this.xrPad.y = this.set.stick.y;
      this.xrPad.a = this.set.buttons[0];
      pad = this.xrPad;
    } else if (f.desk) {
      this.set.setFrom(f.desk.pad);
      pad = f.desk.pad;
    }
    this.set.redraw();
    if (!busyRemote) this.runClaw(dt, pad);
    // Tell friends where the claw is (10 Hz while it's working).
    if (this.mine && this.session && this.phase !== 'idle') {
      this.sendT -= dt;
      if (this.sendT <= 0) {
        this.sendT = 0.1;
        floorEmit(this.session, this.id, { k: 'c', x: r3(this.cx), z: r3(this.cz), d: r3(this.drop), o: r3(this.open), h: this.held, ph: 1 });
      }
    }
    // Prizes moving.
    for (let i = 0; i < MAX; i++) {
      const p = this.prizes[i];
      if (p.state === 'claw') {
        p.x = this.cx;
        p.z = this.cz;
        p.y = CLAW.top - this.drop - 0.02 - CLAW.prizeR;
        this.dirty = true;
      } else if (p.state === 'fall') {
        const chute = overChute(p.x, p.z);
        const hit = stepBody(p, dt, chute ? DOOR.y - 0.2 : CLAW.floor);
        // Keep inside the glass.
        const lim = CLAW.half;
        if (Math.abs(p.x) > lim) ((p.x = Math.sign(p.x) * lim), (p.vx = -p.vx * 0.3));
        if (Math.abs(p.z) > lim) ((p.z = Math.sign(p.z) * lim), (p.vz = -p.vz * 0.3));
        if (chute && p.y < CLAW.floor - 0.1) {
          this.toDoor(p);
          if (this.mine || !this.session) {
            this.sound.sfx('fanfare', 1);
            this.env.toast(`You won ${PRIZE_NAMES[p.design]}! Take it from the prize door`, 'win');
            floorEmit(this.session, this.id, { k: 'w', i });
          }
        } else if (hit > 0 && Math.abs(p.vy) < 0.01 && !chute) {
          p.state = 'pile';
          this.sound.sfx('land', 0.4);
        }
        this.dirty = true;
      } else if (p.state === 'loose') {
        const prevX = p.x,
          prevZ = p.z;
        const moving = Math.abs(p.vx) + Math.abs(p.vy) + Math.abs(p.vz) > 0.01 || p.y > this.env.world.groundAt(p.x, p.z) + CLAW.prizeR + 0.005;
        if (moving) {
          const hit = stepBody(p, dt, this.env.world.groundAt(p.x, p.z));
          if (!this.env.world.isInside(p.x, p.z)) {
            p.x = prevX;
            p.z = prevZ;
            p.vx = -p.vx * 0.3;
            p.vz = -p.vz * 0.3;
          }
          p.tumble += (Math.abs(p.vx) + Math.abs(p.vz)) * dt * 6;
          if (hit > 1.2 && near) this.sound.sfx('land', Math.min(1, hit / 4));
          this.dirty = true;
        }
      } else if (p.state === 'carry') {
        const cam = this.env.camera;
        this.tmpV.set(0.17, -0.2, -0.45);
        cam.localToWorld(this.tmpV);
        p.x = this.tmpV.x;
        p.y = this.tmpV.y;
        p.z = this.tmpV.z;
        this.dirty = true;
      }
    }
    if (this.dirty || near) this.render(near);
  }

  private render(near: boolean) {
    // The claw.
    if (near) {
      const tipY = CLAW.top - this.drop;
      this.trolley.position.set(this.cx, CLAW.top + 0.16, this.cz);
      this.cable.position.set(this.cx, CLAW.top + 0.14, this.cz);
      this.cable.scale.set(1, Math.max(0.02, this.drop + 0.06), 1);
      this.hub.position.set(this.cx, tipY + 0.075, this.cz);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        const f = this.fingers[k];
        f.position.set(this.cx + Math.cos(a) * 0.026, tipY + 0.055, this.cz + Math.sin(a) * 0.026);
        f.rotation.set(0, -a, 0);
        f.rotateZ(0.15 + this.open * 0.55);
      }
    }
    if (!this.dirty) return;
    this.dirty = false;
    // Every prize's instance in its design's mesh (others hidden).
    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < MAX; i++) {
      const p = this.prizes[i];
      const proxy = p.proxy;
      if (p.state === 'none') {
        if (proxy) proxy.position.set(0, -50, 0);
        continue;
      }
      const world = p.state === 'held' || p.state === 'carry' || p.state === 'loose';
      this.tmpQ.setFromAxisAngle(this.up, p.yaw);
      if (p.tumble) this.tmpQ.multiply(this.tmpQ2.setFromAxisAngle(this.tmpS.set(1, 0, 0), p.tumble));
      // The plush model sits on its base; centre it on the body's point.
      this.tmpM.compose(this.tmpV.set(p.x, p.y - CLAW.prizeR, p.z), this.tmpQ, this.tmpS.set(1, 1, 1));
      if (!world) this.tmpM.premultiply(this.group.matrixWorld);
      const mesh = this.meshes[p.design];
      mesh.setMatrixAt(counts[p.design]++, this.tmpM);
      if (proxy) proxy.position.setFromMatrixPosition(this.tmpM).y += 0.05;
    }
    for (let d = 0; d < DESIGNS; d++) {
      this.meshes[d].count = counts[d];
      this.meshes[d].instanceMatrix.needsUpdate = true;
    }
  }
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
