import * as THREE from 'three';
import type { Hand } from '../hands';
import type { Viewpoint } from '../player';
import { REGION, swatch, swatchUV, tileOrigin, uvRect } from './art';
import { box, plane } from './cabinet';
import { PushButton } from './controls';
import type { DeskStation } from './desk';
import { floorEmit, type FloorEnv, type FloorFrame, type FloorGame } from './floor';
import { num, text } from './font';
import { HOOP, newHoopBall, shotVelocity, stepHoopBall, type HoopBall } from './hoopphys';
import type { ArcadeFriend, ArcadeSession } from './net';
import { CabinetSound } from './synth';
import type { ArcadeSlot } from './index';

/**
 * SKYLINE HOOPS: the arcade basketball machine. Press START ($1) and you
 * have 45 seconds: grab balls from the tray and throw them at the hoop (real
 * throws in VR: the ball leaves your hand with your hand's speed). Two points
 * a basket, three in the last ten seconds. On a screen: stick to aim, A to
 * shoot on the power meter.
 */

const GAME_TIME = 45;
const FEVER = 10;
const BALLS = 6;

/** The desk shot's power meter: a triangle wave 0..1..0 (period s); 0.5 is a perfect shot. */
export function meterAt(t: number, period = 1.3) {
  const p = (t / period) % 1;
  return p < 0.5 ? p * 2 : 2 - p * 2;
}

/** Points for a basket with `left` seconds on the clock. */
export function basketPoints(left: number) {
  return left <= FEVER ? 3 : 2;
}

function paintHoops(g: CanvasRenderingContext2D, tile: number) {
  const [ox, oy] = tileOrigin(tile);
  g.save();
  g.translate(ox, oy);
  // Side: city skyline at night with a ball arcing over it.
  {
    const r = REGION.side;
    const gr = g.createLinearGradient(0, 0, 0, r.h);
    gr.addColorStop(0, '#0b1240');
    gr.addColorStop(1, '#3a0d4a');
    g.fillStyle = gr;
    g.fillRect(r.x, r.y, r.w, r.h);
    for (let x = 0; x < r.w; x += 18) {
      const h = 80 + ((x * 37) % 140);
      g.fillStyle = '#120a24';
      g.fillRect(x, r.h - h, 16, h);
      g.fillStyle = '#ffd34d';
      for (let y = r.h - h + 8; y < r.h - 8; y += 12) if ((x + y) % 3) g.fillRect(x + 4, y, 3, 4);
    }
    g.strokeStyle = '#ff8a2a';
    g.lineWidth = 4;
    g.setLineDash([10, 8]);
    g.beginPath();
    g.moveTo(20, 400);
    g.quadraticCurveTo(110, 40, 210, 220);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#ff8a2a';
    g.beginPath();
    g.arc(210, 220, 16, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.translate(r.w / 2, 300);
    g.rotate(-Math.PI / 2);
    g.shadowColor = '#ff8a2a';
    g.shadowBlur = 12;
    text(g, 'SKYLINE HOOPS', 0, -14, '#ffffff', 3, 'center');
    g.restore();
    g.strokeStyle = '#ff8a2a';
    g.lineWidth = 8;
    g.strokeRect(4, 4, r.w - 8, r.h - 8);
  }
  // Marquee.
  {
    const r = REGION.marquee;
    g.fillStyle = '#0b1240';
    g.fillRect(r.x, r.y, r.w, r.h);
    g.strokeStyle = '#ff8a2a';
    g.lineWidth = 3;
    g.strokeRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
    g.save();
    g.shadowColor = '#ff8a2a';
    g.shadowBlur = 12;
    text(g, 'SKYLINE', r.x + r.w / 2, r.y + 14, '#ffffff', 5, 'center');
    text(g, 'HOOPS', r.x + r.w / 2, r.y + 58, '#ffd34d', 5, 'center');
    g.restore();
  }
  // Backboard (in the bezel region): white board, orange target square.
  {
    const r = REGION.bezel;
    g.fillStyle = '#e9eef5';
    g.fillRect(r.x, r.y, r.w, r.h);
    g.strokeStyle = '#ff6a1a';
    g.lineWidth = 6;
    g.strokeRect(r.x + 6, r.y + 6, r.w - 12, r.h - 12);
    g.strokeRect(r.x + r.w / 2 - 44, r.y + r.h - 96, 88, 66);
    text(g, 'PALAZZO LAGO', r.x + r.w / 2, r.y + 16, '#0b1240', 2, 'center');
  }
  // Front: coin door with START.
  {
    const r = REGION.door;
    g.fillStyle = '#120a24';
    g.fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle = '#ff8a2a';
    g.fillRect(r.x, r.y, r.w, 6);
    text(g, '45 SECONDS . $1', r.x + r.w / 2, r.y + 24, '#ffffff', 2, 'center');
    text(g, '2 PTS . LAST 10 SEC 3 PTS', r.x + r.w / 2, r.y + 56, '#ffd34d', 1, 'center');
  }
  g.restore();
}

/** A diamond net pattern (alpha), shared by the cage and the hoop's net. */
let netMat: THREE.MeshBasicMaterial | null = null;
export function netMaterial(): THREE.MeshBasicMaterial {
  if (netMat) return netMat;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(64, 64);
  g.moveTo(64, 0);
  g.lineTo(0, 64);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  netMat = new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, color: 0xdfe6ff });
  return netMat;
}

function ballTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8661c';
  g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#c24f10';
  for (let i = 0; i < 400; i++) g.fillRect((i * 37) % 128, (i * 23) % 64, 1, 1);
  g.strokeStyle = '#1a0c04';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, 32);
  g.lineTo(128, 32);
  g.moveTo(32, 0);
  g.lineTo(32, 64);
  g.moveTo(96, 0);
  g.lineTo(96, 64);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

type Phase = 'idle' | 'play' | 'end';

export class Hoops implements FloorGame {
  readonly id = 'hoops';
  readonly title = 'SKYLINE HOOPS';
  readonly center: THREE.Vector3;
  readonly viewpoints: Viewpoint[];
  readonly desk: DeskStation = { id: 'hoops', buttons: ['SHOOT', 'START', ''], help: 'SKYLINE HOOPS · Arrows aim · Space shoot on the meter · X start ($1) · Esc leave' };
  readonly group = new THREE.Group();
  readonly balls: HoopBall[] = [];
  private mesh: THREE.InstancedMesh;
  private sound: CabinetSound;
  private start: PushButton;
  phase: Phase = 'idle';
  timer = 0;
  score = 0;
  private endT = 0;
  private board: { c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture };
  private boardT = 0;
  private session: ArcadeSession | null = null;
  /** A friend playing (their scoreboard). */
  private remote: { name: string; score: number; timer: number; until: number } | null = null;
  private aim = 0;
  private time = 0;
  private holder = new Map<Hand, number>();
  private sendT = 0;
  private inv = new THREE.Matrix4();
  private tmpV = new THREE.Vector3();
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private spin: THREE.Quaternion[] = [];
  private ownGame = false;
  private flash = 0;

  constructor(
    private env: FloorEnv,
    slot: ArcadeSlot,
    atlas: CanvasRenderingContext2D,
  ) {
    const tile = 6;
    paintHoops(atlas, tile);
    this.group.position.copy(slot.pos);
    this.group.rotation.y = slot.yaw;
    this.group.name = 'hoops';
    env.bakeRoot.add(this.group);
    this.group.updateMatrixWorld(true);
    this.inv.copy(this.group.matrixWorld).invert();
    this.center = slot.pos.clone();
    const m = env.mats;
    const sw = (c: string) => swatchUV(swatch(c));

    // Side cabinets carrying the ramp, with the art outside.
    const len = HOOP.tray.zLip - HOOP.back + 0.08;
    const midZ = (HOOP.tray.zLip + HOOP.back) / 2;
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(box(0.08, 1.0, len, (f) => (f === 0 || f === 1 ? uvRect(tile, REGION.side) : sw('#120a24'))), m.art);
      side.position.set(sx * (HOOP.wallX + 0.04), 0.5, midZ);
      this.group.add(side);
      // Corner posts and the top rail of the cage.
      for (const z of [HOOP.back, HOOP.tray.zLip - 0.1]) {
        const post = new THREE.Mesh(box(0.04, HOOP.top - 1, 0.04, () => sw('#2a2a36')), m.body);
        post.position.set(sx * (HOOP.wallX + 0.02), 1 + (HOOP.top - 1) / 2, z);
        this.group.add(post);
      }
      const rail = new THREE.Mesh(box(0.04, 0.04, len, () => sw('#ff8a2a')), m.lit);
      rail.position.set(sx * (HOOP.wallX + 0.02), HOOP.top, midZ);
      this.group.add(rail);
    }
    // Underneath and the ramp.
    const base = new THREE.Mesh(box(HOOP.wallX * 2, 0.74, len, (f) => (f === 4 ? uvRect(tile, REGION.door) : sw('#120a24'))), m.art);
    base.position.set(0, 0.37, midZ);
    this.group.add(base);
    const r = HOOP.ramp;
    const rampLen = Math.hypot(r.zFront - r.zBack, r.yBack - r.yFront);
    const ramp = new THREE.Mesh(box(HOOP.wallX * 2, 0.02, rampLen, () => sw('#2b6b3a')), m.art);
    ramp.position.set(0, (r.yBack + r.yFront) / 2 - 0.01, (r.zFront + r.zBack) / 2);
    ramp.rotation.x = Math.atan2(r.yBack - r.yFront, r.zFront - r.zBack);
    this.group.add(ramp);
    // Lane stripes down the ramp.
    for (const x of [-0.3, 0, 0.3]) {
      const s = new THREE.Mesh(box(0.02, 0.022, rampLen, () => sw('#f4efe4')), m.art);
      s.position.copy(ramp.position).setX(x);
      s.position.y += 0.002;
      s.rotation.copy(ramp.rotation);
      this.group.add(s);
    }
    const tray = new THREE.Mesh(box(HOOP.wallX * 2, 0.02, HOOP.tray.zLip - r.zFront, () => sw('#1a1a22')), m.body);
    tray.position.set(0, HOOP.tray.y - 0.01, (HOOP.tray.zLip + r.zFront) / 2);
    this.group.add(tray);
    const lip = new THREE.Mesh(box(HOOP.wallX * 2 + 0.1, 0.06, 0.05, () => sw('#ff8a2a')), m.lit);
    lip.position.set(0, HOOP.tray.lipTop - 0.03, HOOP.tray.zLip + 0.02);
    this.group.add(lip);
    // Backboard, rim, marquee.
    const bd = HOOP.board;
    const board = new THREE.Mesh(plane(bd.x1 - bd.x0, bd.y1 - bd.y0, uvRect(tile, REGION.bezel)), m.lit);
    board.position.set(0, (bd.y0 + bd.y1) / 2, bd.z + 0.002);
    this.group.add(board);
    const back = new THREE.Mesh(box(bd.x1 - bd.x0 + 0.06, bd.y1 - bd.y0 + 0.06, 0.04, () => sw('#2a2a36')), m.body);
    back.position.set(0, (bd.y0 + bd.y1) / 2, bd.z - 0.02);
    this.group.add(back);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(HOOP.rimR, HOOP.rimTube, 8, 32).rotateX(Math.PI / 2), m.lit);
    remap(rim.geometry, sw('#ff5a1a'));
    rim.position.set(HOOP.rim.x, HOOP.rim.y, HOOP.rim.z);
    this.group.add(rim);
    const bracket = new THREE.Mesh(box(0.08, 0.03, bd.z - (HOOP.rim.z - HOOP.rimR) + 0.02, () => sw('#ff5a1a')), m.lit);
    bracket.position.set(0, HOOP.rim.y - 0.015, (bd.z + HOOP.rim.z - HOOP.rimR) / 2);
    this.group.add(bracket);
    const marquee = new THREE.Mesh(plane(1.1, 0.4, uvRect(tile, REGION.marquee)), m.lit);
    marquee.position.set(0, HOOP.top + 0.26, HOOP.back + 0.05);
    this.group.add(marquee);
    // Nets: the hoop's and the cage's (one material, merged).
    const net = new THREE.Mesh(new THREE.CylinderGeometry(HOOP.rimR, HOOP.rimR * 0.62, 0.3, 14, 1, true), netMaterial());
    net.position.set(HOOP.rim.x, HOOP.rim.y - 0.15, HOOP.rim.z);
    this.group.add(net);
    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, HOOP.top - 1), netMaterial());
      wall.rotation.y = Math.PI / 2;
      wall.position.set(sx * HOOP.wallX, 1 + (HOOP.top - 1) / 2, midZ);
      scaleUV(wall.geometry, len * 8, (HOOP.top - 1) * 8);
      this.group.add(wall);
    }
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(HOOP.wallX * 2, len), netMaterial());
    roof.rotation.x = Math.PI / 2;
    roof.position.set(0, HOOP.top, midZ);
    scaleUV(roof.geometry, HOOP.wallX * 16, len * 8);
    this.group.add(roof);

    // The scoreboard (live canvas) on the cage's top front.
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 96;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    this.board = { c, g: c.getContext('2d')!, tex };
    const sb = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.27), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    sb.position.set(0, bd.y1 + 0.2, bd.z + 0.03);
    sb.userData.dynamic = true;
    this.group.add(sb);

    // Balls (one instanced draw).
    const bm = new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.75 });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(HOOP.ballR, 16, 12), bm, BALLS);
    this.mesh.frustumCulled = false;
    this.mesh.userData.dynamic = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.mesh);
    for (let i = 0; i < BALLS; i++) {
      this.balls.push(newHoopBall(-0.35 + (i % 4) * 0.23, HOOP.tray.y + HOOP.ballR + 0.02 + Math.floor(i / 4) * 0.2, 1.05));
      this.spin.push(new THREE.Quaternion());
    }

    // START button on the front, right of the tray.
    const frame = new THREE.Matrix4().makeTranslation(HOOP.wallX - 0.12, HOOP.tray.lipTop + 0.005, HOOP.tray.zLip + 0.02).premultiply(this.group.matrixWorld);
    this.start = new PushButton(env.inst, frame, new THREE.Color(0x3aff6a));
    // Grabbing balls (VR).
    this.balls.forEach((b, i) => {
      env.hands.register({
        radius: 0.13,
        at: () => this.toWorld(b.x, b.y, b.z, this.tmpV),
        enabled: () => !b.held,
        grab: (hand) => {
          b.held = true;
          this.holder.set(hand, i);
          return 'drag';
        },
        drag: (_hand, pos) => {
          const l = this.toLocal(pos);
          b.x = l.x;
          b.y = l.y - 0.02;
          b.z = l.z - 0.03;
        },
        release: (hand) => {
          this.holder.delete(hand);
          b.held = false;
          const v = env.hands.velocity(hand);
          this.throwBall(i, this.dirLocal(v), true);
        },
      });
    });

    this.sound = new CabinetSound(env.audio, this.mesh, { ref: 1.6, volume: 0.35 });
    // Where you stand: in front of the tray. Screens: looking up the ramp at the hoop.
    const fwd = new THREE.Vector3(Math.sin(slot.yaw), 0, Math.cos(slot.yaw));
    this.viewpoints = [
      {
        id: 'hoops',
        label: 'Skyline Hoops',
        position: this.toWorld(0, 0, HOOP.tray.zLip + 0.42, new THREE.Vector3()).setY(0),
        yaw: slot.yaw,
        pitch: 0.06,
        eye: 1.62,
        back: 0.05,
        portrait: { back: 0.5, eye: 1.7, pitch: 0.12 },
      },
    ];
    void fwd;
    if (env.colliders) env.world.addLocalBox(this.group, 0, midZ, HOOP.wallX * 2 + 0.16, len + 0.04, 'arcade hoops');
  }

  toWorld(x: number, y: number, z: number, out: THREE.Vector3) {
    return out.set(x, y, z).applyMatrix4(this.group.matrixWorld);
  }

  private toLocal(p: THREE.Vector3) {
    return this.tmpV.copy(p).applyMatrix4(this.inv);
  }

  /** A world direction (velocity) in the machine's frame. */
  private dirLocal(v: THREE.Vector3) {
    return this.tmpV.copy(v).applyQuaternion(this.tmpQ.copy(this.group.quaternion).invert());
  }

  /** Lets a ball fly with a (local) velocity; VR throws get a gentle nudge toward the hoop. */
  throwBall(i: number, v: THREE.Vector3, assist: boolean, share = true) {
    const b = this.balls[i];
    let vx = v.x,
      vy = v.y,
      vz = v.z;
    if (assist && vz < -1.5) {
      // Blend 15% toward the throw that would drop in (same flight time as yours).
      const dz = HOOP.rim.z - b.z;
      const t = Math.min(1.4, Math.max(0.45, dz / vz));
      const [ix, iy, iz] = shotVelocity(b.x, b.y, b.z, HOOP.rim.x, HOOP.rim.y + 0.04, HOOP.rim.z, t);
      vx += (ix - vx) * 0.15;
      vy += (iy - vy) * 0.15;
      vz += (iz - vz) * 0.15;
    }
    b.vx = vx;
    b.vy = vy;
    b.vz = vz;
    b.scored = false;
    if (share) floorEmit(this.session, this.id, { k: 't', i, p: [r3(b.x), r3(b.y), r3(b.z)], v: [r3(vx), r3(vy), r3(vz)] });
  }

  /** Screens: shoot the nearest ball in the tray on the meter. */
  private deskShot() {
    let best = -1,
      bd = 1e9;
    for (let i = 0; i < BALLS; i++) {
      const b = this.balls[i];
      if (b.held || b.z < HOOP.ramp.zFront - 0.3 || Math.hypot(b.vx, b.vy, b.vz) > 1.5) continue;
      const d = Math.abs(b.x);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) {
      this.sound.sfx('tick', 0.5);
      return;
    }
    const b = this.balls[best];
    // From your hands, just over the tray.
    b.x = this.aim * 0.1;
    b.y = 1.38;
    b.z = HOOP.tray.zLip + 0.05;
    const p = meterAt(this.time);
    const power = 0.82 + p * 0.36;
    const [vx, vy, vz] = shotVelocity(b.x, b.y, b.z, HOOP.rim.x + this.aim * 0.22, HOOP.rim.y + 0.05, HOOP.rim.z + 0.02, 0.92);
    this.throwBall(best, this.tmpV.set(vx * power, vy * (0.5 + power * 0.5), vz * power), false);
    this.sound.sfx('whoosh', 0.4);
  }

  private begin() {
    if (this.phase === 'play') return;
    if (this.remote && this.time < this.remote.until) {
      this.env.toast(`${this.remote.name} is playing Skyline Hoops`, 'info');
      return;
    }
    if (!this.env.pay('Skyline Hoops')) return;
    this.phase = 'play';
    this.timer = GAME_TIME;
    this.score = 0;
    this.ownGame = true;
    this.sound.sfx('start', 1);
    this.sound.sfx('buzzer', 0.5);
  }

  private finish() {
    this.phase = 'end';
    this.endT = 4;
    this.sound.sfx('buzzer', 1);
    if (this.ownGame) {
      this.env.toast(`Skyline Hoops: ${this.score} points!`, this.score >= 30 ? 'win' : 'info');
      const n = this.env.name().replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 3) || 'YOU';
      if (this.score > 0) this.env.submit?.(this.id, n, this.score);
    }
    this.ownGame = false;
  }

  connect(s: ArcadeSession | null) {
    this.session = s;
    this.remote = null;
  }

  receive(f: ArcadeFriend, d: Record<string, unknown>) {
    if (d.k === 't') {
      const i = Number(d.i);
      const b = this.balls[i];
      const p = d.p as number[],
        v = d.v as number[];
      if (!b || !Array.isArray(p) || !Array.isArray(v) || b.held) return;
      b.x = Number(p[0]) || 0;
      b.y = Number(p[1]) || 1;
      b.z = Number(p[2]) || 0;
      b.vx = Number(v[0]) || 0;
      b.vy = Number(v[1]) || 0;
      b.vz = Number(v[2]) || 0;
      b.scored = true; // Their baskets count on their machine.
    } else if (d.k === 's') {
      this.remote = { name: f.name, score: Number(d.s) || 0, timer: Number(d.t) || 0, until: this.time + (d.on ? 2 : 0) };
    }
  }

  update(f: FloorFrame) {
    const dt = f.dt;
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt);
    const near = f.dist < 12;
    // Start button: hands in VR, B on the desk pad.
    const touch = f.inXR && f.dist < 3 ? this.env.touch : null;
    if (touch && f.dist < 3) touch.gather(this.env.hands);
    if (this.start.update(touch, !!f.desk?.pad.b)) this.begin();
    if (f.desk) {
      this.aim = Math.max(-1, Math.min(1, this.aim + f.desk.pad.x * dt * 1.6));
      if (Math.abs(f.desk.pad.x) < 0.1) this.aim *= 1 - dt * 0.5;
      if (f.desk.pad.a && !this.prevA && (this.phase === 'play' || this.phase === 'idle')) this.deskShot();
      this.prevA = f.desk.pad.a;
    }
    // The clock.
    if (this.phase === 'play') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 0;
        this.finish();
      }
    } else if (this.phase === 'end') {
      this.endT -= dt;
      if (this.endT <= 0) this.phase = 'idle';
    }
    // Physics (only near: nobody sees the balls from across the room).
    if (near) {
      for (let i = 0; i < BALLS; i++) {
        const b = this.balls[i];
        const speed = Math.hypot(b.vx, b.vy, b.vz);
        stepHoopBall(b, dt, (e, s) => this.event(e, s, i));
        // Lost balls come back to the tray.
        if (b.out > 2.5) Object.assign(b, newHoopBall(-0.3 + i * 0.12, HOOP.tray.y + 0.3, 1.0));
        if (speed > 0.02 || b.held) {
          this.spin[i].multiply(this.tmpQ.setFromAxisAngle(this.tmpV.set(1, 0, 0), -b.vz * dt * 8));
        }
        this.tmpM.compose(this.tmpV.set(b.x, b.y, b.z), this.spin[i], ONE);
        this.mesh.setMatrixAt(i, this.tmpM);
      }
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    // Scoreboard: 10 fps while anything's on, 1 fps idle.
    this.boardT -= dt;
    if (near && this.boardT <= 0) {
      this.boardT = this.phase === 'play' || f.desk || (this.remote && this.time < this.remote.until) ? 0.1 : 1;
      this.drawBoard(!!f.desk);
    }
    // Tell friends the score twice a second.
    if (this.ownGame && this.phase === 'play' && this.session) {
      this.sendT -= dt;
      if (this.sendT <= 0) {
        this.sendT = 0.5;
        floorEmit(this.session, this.id, { k: 's', s: this.score, t: Math.ceil(this.timer), on: 1 });
      }
    }
  }
  private prevA = false;

  private event(e: string, s: number, _i: number) {
    if (e === 'score') {
      this.sound.sfx('swish', 0.9);
      this.flash = 0.5;
      if (this.phase === 'play') {
        this.score += basketPoints(this.timer);
        this.sound.sfx('pickup', 0.6);
      }
    } else if (e === 'rim') this.sound.sfx('clunk', Math.min(1, s / 4), 1.6);
    else if (e === 'board') this.sound.sfx('clunk', Math.min(1, s / 5), 1);
    else if (e === 'floor') this.sound.sfx('land', Math.min(1, s / 4));
  }

  private drawBoard(desk: boolean) {
    const { g, tex } = this.board;
    g.fillStyle = '#05040c';
    g.fillRect(0, 0, 256, 96);
    g.imageSmoothingEnabled = false;
    const remote = this.remote && this.time < this.remote.until ? this.remote : null;
    const playing = this.phase === 'play' || this.phase === 'end';
    const score = playing ? this.score : remote ? remote.score : 0;
    const timer = playing ? this.timer : remote ? remote.timer : GAME_TIME;
    text(g, 'TIME', 40, 6, '#ff8a2a', 2, 'center');
    num(g, Math.ceil(timer), 40, 26, timer <= FEVER && playing && Math.floor(this.time * 4) % 2 ? '#ff3864' : '#ffd34d', 4, 'center', 2);
    text(g, 'SCORE', 200, 6, '#ff8a2a', 2, 'center');
    num(g, score, 200, 26, this.flash > 0 && Math.floor(this.time * 10) % 2 ? '#ffffff' : '#3aff6a', 4, 'center', 2);
    if (this.phase === 'idle' && !remote) {
      if (Math.floor(this.time) % 2) text(g, 'PRESS START', 128, 66, '#ffffff', 1, 'center');
      else text(g, '$1 . 45 SECONDS', 128, 66, '#ffffff', 1, 'center');
    } else if (this.phase === 'play' && this.timer <= FEVER) text(g, 'FEVER 3 PTS', 128, 66, '#ff3864', 1, 'center');
    else if (remote) text(g, remote.name.toUpperCase().slice(0, 14), 128, 66, '#ffffff', 1, 'center');
    else if (this.phase === 'end') text(g, 'FINAL', 128, 66, '#ffffff', 1, 'center');
    if (desk) {
      // The shot meter and the aim marker (screens).
      const p = meterAt(this.time);
      g.fillStyle = '#20202c';
      g.fillRect(28, 80, 200, 10);
      g.fillStyle = '#2a8a3a';
      g.fillRect(28 + 100 - 14, 80, 28, 10);
      g.fillStyle = '#ffffff';
      g.fillRect(28 + Math.round(p * 196), 78, 4, 14);
      g.fillStyle = '#ff8a2a';
      g.fillRect(128 + Math.round(this.aim * 60) - 1, 74, 3, 4);
    }
    tex.needsUpdate = true;
  }
}

const ONE = new THREE.Vector3(1, 1, 1);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function remap(geo: THREE.BufferGeometry, rect: [number, number, number, number]) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2);
}

function scaleUV(geo: THREE.BufferGeometry, su: number, sv: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
}
