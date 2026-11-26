import * as THREE from 'three';
import type { Viewpoint } from '../player';
import { REGION, swatch, swatchUV, tileOrigin, uvRect } from './art';
import { box } from './cabinet';
import { PushButton } from './controls';
import type { DeskStation } from './desk';
import { floorEmit, type FloorEnv, type FloorFrame, type FloorGame } from './floor';
import { num, text } from './font';
import { aiTarget, clampMallet, driveMallet, RINK, stepRink, type Mallet, type Puck } from './hockeyphys';
import type { ArcadeFriend, ArcadeSession } from './net';
import { CabinetSound } from './synth';
import type { ArcadeSlot } from './index';

/**
 * PUCK PALAZZO: an air-hockey table. Press START at your end ($1) and play
 * the house to seven, or have a friend press START at the other end to take
 * the house's mallet. In VR you grab your mallet and slide it on the table;
 * on a screen the stick drives it. The player who started runs the puck and
 * sends it to everyone watching (20 times a second); the friend sends their
 * mallet back.
 */

const H = 0.8;
export const HOCKEY_TO = 7;

function rinkCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 256, 0);
  gr.addColorStop(0, '#cfe9ff');
  gr.addColorStop(0.5, '#f4fbff');
  gr.addColorStop(1, '#cfe9ff');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 512);
  // Air holes.
  g.fillStyle = '#9db8d0';
  for (let y = 8; y < 512; y += 12) for (let x = 8 + ((y / 12) % 2) * 6; x < 256; x += 12) g.fillRect(x, y, 1, 1);
  g.strokeStyle = '#ff3b6b';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(0, 256);
  g.lineTo(256, 256);
  g.stroke();
  g.beginPath();
  g.arc(128, 256, 46, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = '#2a7bff';
  for (const y of [0, 512]) {
    g.beginPath();
    g.arc(128, y, 60, 0, Math.PI * 2);
    g.stroke();
  }
  g.strokeStyle = '#2a7bff';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 128);
  g.lineTo(256, 128);
  g.moveTo(0, 384);
  g.lineTo(256, 384);
  g.stroke();
  g.save();
  g.translate(128, 256);
  g.rotate(-Math.PI / 2);
  g.globalAlpha = 0.25;
  text(g, 'PUCK PALAZZO', 0, -10, '#0b1a40', 3, 'center');
  g.restore();
  return c;
}

function paintHockey(g: CanvasRenderingContext2D, tile: number) {
  // The table's apron (tile 7's side region, drawn wide) and its sign (marquee).
  const [ox, oy] = tileOrigin(tile);
  g.save();
  g.translate(ox, oy);
  const r = REGION.side;
  const gr = g.createLinearGradient(0, 0, 0, r.h);
  gr.addColorStop(0, '#0a1a3a');
  gr.addColorStop(1, '#2a0a3a');
  g.fillStyle = gr;
  g.fillRect(r.x, r.y, r.w, r.h);
  g.strokeStyle = '#3ad8ff';
  g.lineWidth = 6;
  for (let k = 0; k < 6; k++) {
    g.beginPath();
    g.moveTo(0, 60 + k * 80);
    g.lineTo(r.w, 20 + k * 80);
    g.stroke();
  }
  g.save();
  g.translate(r.w / 2, 256);
  g.rotate(-Math.PI / 2);
  g.shadowColor = '#3ad8ff';
  g.shadowBlur = 10;
  text(g, 'PUCK PALAZZO', 0, -14, '#ffffff', 3, 'center');
  g.restore();
  const m = REGION.marquee;
  g.fillStyle = '#0a1a3a';
  g.fillRect(m.x, m.y, m.w, m.h);
  g.strokeStyle = '#ff3b6b';
  g.lineWidth = 3;
  g.strokeRect(m.x + 3, m.y + 3, m.w - 6, m.h - 6);
  g.save();
  g.shadowColor = '#3ad8ff';
  g.shadowBlur = 12;
  text(g, 'PUCK', m.x + m.w / 2, m.y + 12, '#ffffff', 5, 'center');
  text(g, 'PALAZZO', m.x + m.w / 2, m.y + 56, '#3ad8ff', 5, 'center');
  g.restore();
  g.restore();
}

type Phase = 'idle' | 'play' | 'over';

export class Hockey implements FloorGame {
  readonly id = 'hockey';
  readonly title = 'PUCK PALAZZO';
  readonly center: THREE.Vector3;
  readonly viewpoints: Viewpoint[] = [];
  readonly desk: DeskStation = { id: 'hockey', buttons: ['START', '', ''], help: 'PUCK PALAZZO · Arrows/WASD move your mallet · Space start ($1) · Esc leave' };
  readonly group = new THREE.Group();
  readonly puck: Puck = { x: 0, z: 0, vx: 0, vz: 0 };
  readonly mallets: [Mallet, Mallet] = [
    { x: 0, z: RINK.halfL - 0.18, vx: 0, vz: 0 },
    { x: 0, z: -RINK.halfL + 0.18, vx: 0, vz: 0 },
  ];
  private malletMesh: THREE.Mesh[] = [];
  private puckMesh: THREE.Mesh;
  private sound: CabinetSound;
  private starts: PushButton[] = [];
  phase: Phase = 'idle';
  readonly score: [number, number] = [0, 0];
  /** Who runs the game: me (and which side I'm on), a friend, or nobody. */
  owner: 'me' | string | null = null;
  mySide: 0 | 1 = 0;
  /** The other side: the house, or a friend (id). */
  opp: 'ai' | string = 'ai';
  private target: [{ x: number; z: number } | null, { x: number; z: number } | null] = [null, null];
  private serveT = 0;
  private overT = 0;
  private session: ArcadeSession | null = null;
  private sendT = 0;
  private heard = 0;
  private time = 0;
  private board: { g: CanvasRenderingContext2D; tex: THREE.CanvasTexture };
  private boardT = 0;
  private inv = new THREE.Matrix4();
  private tmpV = new THREE.Vector3();
  private ownerName = '';
  private oppName = '';
  private remoteMallet: { x: number; z: number; t: number } | null = null;
  /** As a friend in someone else's game: my side. */
  private guestSide: 0 | 1 | null = null;

  constructor(
    private env: FloorEnv,
    slot: ArcadeSlot,
    atlas: CanvasRenderingContext2D,
  ) {
    const tile = 7;
    paintHockey(atlas, tile);
    this.group.position.copy(slot.pos);
    this.group.rotation.y = slot.yaw;
    this.group.name = 'hockey';
    env.bakeRoot.add(this.group);
    this.group.updateMatrixWorld(true);
    this.inv.copy(this.group.matrixWorld).invert();
    this.center = slot.pos.clone();
    const m = env.mats;
    const sw = (c: string) => swatchUV(swatch(c));
    const W = RINK.halfW * 2,
      L = RINK.halfL * 2;
    // Body with the art on its long sides, legs, rails.
    const body = new THREE.Mesh(box(W + 0.16, 0.28, L + 0.16, (f) => (f === 0 || f === 1 ? uvRect(tile, REGION.side) : sw('#0a1a3a'))), m.art);
    body.position.set(0, H - 0.14, 0);
    this.group.add(body);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(box(0.08, H - 0.28, 0.08, () => sw('#1a1a22')), m.body);
        leg.position.set(sx * (W / 2 - 0.02), (H - 0.28) / 2, sz * (L / 2 - 0.05));
        this.group.add(leg);
      }
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(box(0.08, 0.05, L + 0.16, () => sw('#3ad8ff')), m.lit);
      rail.position.set(sx * (W / 2 + 0.04), H + 0.025, 0);
      this.group.add(rail);
    }
    for (const sz of [-1, 1]) {
      for (const sx of [-1, 1]) {
        const seg = (W - RINK.goalHalf * 2) / 2 + 0.08;
        const end = new THREE.Mesh(box(seg, 0.05, 0.08, () => sw('#ff3b6b')), m.lit);
        end.position.set(sx * (RINK.goalHalf + seg / 2), H + 0.025, sz * (L / 2 + 0.04));
        this.group.add(end);
      }
      const slotBox = new THREE.Mesh(box(RINK.goalHalf * 2, 0.02, 0.08, () => sw('#050507')), m.body);
      slotBox.position.set(0, H - 0.01, sz * (L / 2 + 0.04));
      this.group.add(slotBox);
    }
    // The rink surface (its own small texture).
    const rt = new THREE.CanvasTexture(rinkCanvas());
    rt.colorSpace = THREE.SRGBColorSpace;
    const rink = new THREE.Mesh(new THREE.PlaneGeometry(W, L), new THREE.MeshStandardMaterial({ map: rt, roughness: 0.25, metalness: 0 }));
    rink.rotation.x = -Math.PI / 2;
    rink.position.y = H + 0.001;
    this.group.add(rink);
    // Overhead sign with the score, both ways (live canvas), on a post.
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 96;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    this.board = { g: c.getContext('2d')!, tex };
    const signMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    for (const k of [0, 1]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.3), signMat);
      // Back to back: one faces each end of the table.
      sign.position.set(W / 2 + 0.2, 1.95, k ? -0.012 : 0.012);
      sign.rotation.y = k ? Math.PI : 0;
      sign.userData.dynamic = true;
      this.group.add(sign);
    }
    const post = new THREE.Mesh(box(0.05, 1.8, 0.05, () => sw('#2a2a36')), m.body);
    post.position.set(W / 2 + 0.2, 0.9, 0);
    this.group.add(post);
    const head = new THREE.Mesh(box(0.84, 0.34, 0.02, (f) => (f === 4 || f === 5 ? uvRect(tile, REGION.marquee) : sw('#0a1a3a'))), m.lit);
    head.position.set(W / 2 + 0.2, 2.3, 0);
    this.group.add(head);
    // Puck and mallets (live).
    this.puckMesh = new THREE.Mesh(new THREE.CylinderGeometry(RINK.puckR, RINK.puckR, 0.012, 20), new THREE.MeshStandardMaterial({ color: 0xff2a4a, roughness: 0.4, emissive: 0x400010 }));
    this.puckMesh.userData.dynamic = true;
    this.group.add(this.puckMesh);
    const mg = new THREE.LatheGeometry(
      [
        [0, 0],
        [RINK.malletR, 0],
        [RINK.malletR, 0.018],
        [0.022, 0.03],
        [0.018, 0.06],
        [0.026, 0.075],
        [0.022, 0.09],
        [0, 0.092],
      ].map(([x, y]) => new THREE.Vector2(x, y)),
      20,
    );
    [0xff5ab4, 0x3ad8ff].forEach((col) => {
      const mm = new THREE.Mesh(mg, new THREE.MeshStandardMaterial({ color: col, roughness: 0.35 }));
      mm.userData.dynamic = true;
      this.group.add(mm);
      this.malletMesh.push(mm);
    });
    // START at each end, and the play spots.
    for (const side of [0, 1] as const) {
      const dir = side === 0 ? 1 : -1;
      const frame = new THREE.Matrix4().makeTranslation(dir * (W / 2 + 0.04), H + 0.05, dir * (L / 2 - 0.12)).premultiply(this.group.matrixWorld);
      this.starts.push(new PushButton(env.inst, frame, new THREE.Color(side ? 0x3ad8ff : 0xff5ab4)));
      const stand = new THREE.Vector3(0, 0, dir * (L / 2 + 0.45)).applyMatrix4(this.group.matrixWorld).setY(0);
      this.viewpoints.push({
        id: `hockey${side}`,
        label: 'Puck Palazzo',
        position: stand,
        yaw: slot.yaw + (side === 0 ? 0 : Math.PI),
        pitch: -0.62,
        eye: 1.5,
        back: 0.25,
        portrait: { back: 0.7, eye: 1.9, pitch: -0.8 },
      });
      // Grab your mallet (VR).
      env.hands.register({
        radius: 0.1,
        at: () => this.tmpV.set(this.mallets[side].x, H + 0.07, this.mallets[side].z).applyMatrix4(this.group.matrixWorld),
        enabled: () => this.canDrive(side),
        grab: () => 'drag',
        drag: (_h, pos) => {
          const l = this.tmpV.copy(pos).applyMatrix4(this.inv);
          this.target[side] = { x: l.x, z: l.z };
        },
        release: () => {
          this.target[side] = null;
        },
      });
    }
    this.sound = new CabinetSound(env.audio, this.puckMesh, { ref: 1.6, volume: 0.4 });
    if (env.colliders) env.world.addLocalBox(this.group, 0, 0, W + 0.16, L + 0.16, 'arcade hockey');
    this.resetPositions(0);
  }

  /** Can I move this side's mallet? (My side in my game, my side as the guest, or anything when nobody's playing.) */
  private canDrive(side: 0 | 1) {
    if (this.owner === 'me') return side === this.mySide;
    if (this.owner) return this.guestSide === side;
    return true;
  }

  private resetPositions(serveTo: 0 | 1) {
    this.puck.x = 0;
    this.puck.z = serveTo === 0 ? 0.3 : -0.3;
    this.puck.vx = this.puck.vz = 0;
    this.serveT = 1;
  }

  private start(side: 0 | 1) {
    if (this.owner === 'me') return;
    if (this.owner && this.owner !== 'me') {
      // Someone's game: ask to take the house's mallet.
      if (this.session) floorEmit(this.session, this.id, { k: 'j', side });
      return;
    }
    if (!this.env.pay('Puck Palazzo')) return;
    this.owner = 'me';
    this.mySide = side;
    this.opp = 'ai';
    this.oppName = 'HOUSE';
    this.ownerName = this.env.name();
    this.phase = 'play';
    this.score[0] = this.score[1] = 0;
    this.resetPositions(side === 0 ? 1 : 0);
    this.sound.sfx('start', 1);
  }

  connect(s: ArcadeSession | null) {
    this.session = s;
    if (this.owner && this.owner !== 'me') this.owner = null;
    if (this.opp !== 'ai') this.opp = 'ai';
    this.guestSide = null;
  }

  receive(f: ArcadeFriend, d: Record<string, unknown>) {
    switch (d.k) {
      case 'j': {
        // A friend wants the other mallet.
        const side = Number(d.side) === 1 ? 1 : 0;
        if (this.owner !== 'me' || this.phase !== 'play' || side === this.mySide || this.opp !== 'ai') return;
        this.opp = f.id;
        this.oppName = f.name;
        this.score[0] = this.score[1] = 0;
        this.resetPositions(side);
        this.heard = this.time;
        this.env.toast(`${f.name} takes on you at Puck Palazzo!`, 'win');
        this.sound.sfx('fanfare', 0.8);
        floorEmit(this.session, this.id, { k: 'a', side, id: f.id });
        break;
      }
      case 'a':
        if (d.id === this.session?.selfId) {
          this.guestSide = Number(d.side) === 1 ? 1 : 0;
          this.env.toast('You have the other mallet: first to 7!', 'win');
        }
        break;
      case 'm':
        if (this.owner === 'me' && this.opp === f.id) {
          this.remoteMallet = { x: Number(d.x) || 0, z: Number(d.z) || 0, t: this.time };
          this.heard = this.time;
        }
        break;
      case 's': {
        if (this.owner === 'me') return;
        // The owner's game.
        this.owner = f.id;
        this.ownerName = f.name;
        const p = d.p as number[],
          m0 = d.m0 as number[],
          m1 = d.m1 as number[],
          sc = d.sc as number[];
        if (!Array.isArray(p) || !Array.isArray(m0) || !Array.isArray(m1) || !Array.isArray(sc)) return;
        this.puck.x = Number(p[0]) || 0;
        this.puck.z = Number(p[1]) || 0;
        this.puck.vx = Number(p[2]) || 0;
        this.puck.vz = Number(p[3]) || 0;
        const ms = [m0, m1];
        for (const s of [0, 1] as const) {
          // My own mallet (as the guest) stays where my hand is.
          if (this.guestSide === s) continue;
          this.mallets[s].x = Number(ms[s][0]) || 0;
          this.mallets[s].z = Number(ms[s][1]) || 0;
        }
        this.score[0] = Number(sc[0]) || 0;
        this.score[1] = Number(sc[1]) || 0;
        this.phase = d.ph === 'over' ? 'over' : d.ph === 'idle' ? 'idle' : 'play';
        this.mySide = Number(d.os) === 1 ? 1 : 0;
        this.oppName = String(d.on ?? 'HOUSE');
        this.heard = this.time;
        if (d.ph === 'idle') {
          this.owner = null;
          this.guestSide = null;
        }
        break;
      }
    }
  }

  update(f: FloorFrame) {
    const dt = f.dt;
    this.time += dt;
    const near = f.dist < 14;
    // START buttons (hands, or A on the desk pad at that end).
    const touch = f.inXR && f.dist < 3.5 ? this.env.touch : null;
    if (touch) touch.gather(this.env.hands);
    for (const side of [0, 1] as const) if (this.starts[side].update(touch, !!f.desk && f.desk.spot === side && f.desk.pad.a)) this.start(side);
    // Desk driving: the stick moves your mallet (forward = toward the far end).
    if (f.desk) {
      const side = f.desk.spot as 0 | 1;
      if (this.canDrive(side)) {
        const s = side === 0 ? 1 : -1;
        const m = this.mallets[side];
        const tgt = (this.target[side] ??= { x: m.x, z: m.z });
        tgt.x += f.desk.pad.x * s * 1.9 * dt;
        tgt.z += -f.desk.pad.y * s * 1.9 * dt;
        const r = RINK.malletR;
        tgt.x = Math.max(-RINK.halfW + r, Math.min(RINK.halfW - r, tgt.x));
        tgt.z = side === 0 ? Math.max(r, Math.min(RINK.halfL - r, tgt.z)) : Math.min(-r, Math.max(-RINK.halfL + r, tgt.z));
      }
    }
    // Drive the mallets I control.
    for (const side of [0, 1] as const) {
      const t = this.target[side];
      if (t && this.canDrive(side)) driveMallet(this.mallets[side], t.x, t.z, 9, dt, side);
      else if (!t) {
        this.mallets[side].vx = 0;
        this.mallets[side].vz = 0;
      }
    }
    if (this.owner === 'me') this.runGame(dt);
    else if (this.owner) {
      // Watching / guest: glide the puck between the owner's updates.
      this.puck.x += this.puck.vx * dt;
      this.puck.z += this.puck.vz * dt;
      if (this.time - this.heard > 3) {
        this.owner = null;
        this.guestSide = null;
        this.phase = 'idle';
      }
      if (this.guestSide !== null && this.session) {
        this.sendT -= dt;
        if (this.sendT <= 0) {
          this.sendT = 0.05;
          const m = this.mallets[this.guestSide];
          floorEmit(this.session, this.id, { k: 'm', x: r3(m.x), z: r3(m.z) });
        }
      }
    } else if (near) {
      // Nobody's game: the puck still slides if you bat it about.
      stepRink(this.puck, this.mallets, dt, (e) => this.sfxFor(e));
      if (Math.abs(this.puck.z) > RINK.halfL + 0.05) this.resetPositions(this.puck.z > 0 ? 0 : 1);
    }
    if (near) this.place();
    this.boardT -= dt;
    if (near && this.boardT <= 0) {
      this.boardT = this.phase === 'play' ? 0.15 : 1;
      this.drawBoard();
    }
  }

  private runGame(dt: number) {
    const opp = (1 - this.mySide) as 0 | 1;
    if (this.phase === 'play') {
      if (this.opp === 'ai') {
        const a = aiTarget(this.puck, this.mallets[opp], opp, 0.55);
        driveMallet(this.mallets[opp], a.x, a.z, a.speed, dt, opp);
      } else if (this.remoteMallet) {
        const m = this.mallets[opp];
        driveMallet(m, this.remoteMallet.x, this.remoteMallet.z, 9, dt, opp);
        clampMallet(m, opp);
        if (this.time - this.heard > 4) {
          this.env.toast(`${this.oppName} left the table: the house takes over`, 'info');
          this.opp = 'ai';
          this.oppName = 'HOUSE';
        }
      }
      if (this.serveT > 0) this.serveT -= dt;
      else {
        const g = stepRink(this.puck, this.mallets, dt, (e) => this.sfxFor(e));
        if (g !== null) {
          // A goal into end g: the other side scores.
          const scorer = (1 - g) as 0 | 1;
          this.score[scorer]++;
          this.sound.sfx(scorer === this.mySide ? 'fanfare' : 'hurt', 0.8);
          if (this.score[scorer] >= HOCKEY_TO) {
            this.phase = 'over';
            this.overT = 4;
            const won = scorer === this.mySide;
            this.env.toast(won ? `You win at Puck Palazzo, ${this.score[scorer]}-${this.score[1 - scorer]}!` : `${this.oppName === 'HOUSE' ? 'The house' : this.oppName} wins at Puck Palazzo`, won ? 'win' : 'info');
            if (won && this.opp === 'ai') {
              const n = this.env.name().replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 3) || 'YOU';
              this.env.submit?.(this.id, n, (this.score[this.mySide] - this.score[opp]) * 3 + 10);
            }
          }
          this.resetPositions(g);
        }
      }
    } else if (this.phase === 'over') {
      this.overT -= dt;
      if (this.overT <= 0) {
        this.phase = 'idle';
        this.owner = null;
        if (this.session) floorEmit(this.session, this.id, { k: 's', p: [0, 0, 0, 0], m0: [0, 0.8], m1: [0, -0.8], sc: this.score, ph: 'idle' });
        return;
      }
    }
    // Tell the room (20 Hz).
    if (this.session) {
      this.sendT -= dt;
      if (this.sendT <= 0) {
        this.sendT = 0.05;
        const p = this.puck,
          [a, b] = this.mallets;
        floorEmit(this.session, this.id, { k: 's', p: [r3(p.x), r3(p.z), r3(p.vx), r3(p.vz)], m0: [r3(a.x), r3(a.z)], m1: [r3(b.x), r3(b.z)], sc: this.score, ph: this.phase, os: this.mySide, on: this.opp === 'ai' ? 'HOUSE' : this.oppName });
      }
    }
  }

  private sfxFor(e: { k: string; speed?: number }) {
    if (e.k === 'rail') this.sound.sfx('clunk', Math.min(1, (e.speed ?? 1) / 3), 2.2);
    else if (e.k === 'hit') this.sound.sfx('bounce', Math.min(1, (e.speed ?? 1) / 2), 1.6);
    else if (e.k === 'goal') this.sound.sfx('buzzer', 0.4);
  }

  leaveDesk() {
    this.target[0] = this.target[1] = null;
  }

  private place() {
    this.puckMesh.position.set(this.puck.x, H + 0.006, this.puck.z);
    for (let s = 0; s < 2; s++) this.malletMesh[s].position.set(this.mallets[s].x, H, this.mallets[s].z);
  }

  private drawBoard() {
    const { g, tex } = this.board;
    g.fillStyle = '#05040c';
    g.fillRect(0, 0, 256, 96);
    g.imageSmoothingEnabled = false;
    if (this.phase === 'idle') {
      text(g, 'PUCK PALAZZO', 128, 10, '#3ad8ff', 2, 'center');
      text(g, Math.floor(this.time) % 2 ? 'PRESS START  $1' : 'FIRST TO 7', 128, 48, '#ffffff', 2, 'center');
      text(g, 'PLAY THE HOUSE OR A FRIEND', 128, 76, '#ff5ab4', 1, 'center');
    } else {
      // Pink end (side 0) on the left, blue on the right.
      num(g, this.score[0], 64, 20, '#ff5ab4', 6, 'center');
      num(g, this.score[1], 192, 20, '#3ad8ff', 6, 'center');
      text(g, '-', 128, 34, '#ffffff', 3, 'center');
      const n0 = this.mySide === 0 ? this.ownerName : this.oppName;
      const n1 = this.mySide === 1 ? this.ownerName : this.oppName;
      text(g, (n0 || 'P1').toUpperCase().slice(0, 10), 64, 78, '#ffffff', 1, 'center');
      text(g, (n1 || 'P2').toUpperCase().slice(0, 10), 192, 78, '#ffffff', 1, 'center');
      if (this.phase === 'over') text(g, 'GAME', 128, 64, '#ffd34d', 2, 'center');
    }
    tex.needsUpdate = true;
  }
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
