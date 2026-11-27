import * as THREE from 'three';
import type { Viewpoint } from '../../player';
import type { Hand } from '../../hands';
import { box, plane, slopePlane } from '../cabinet';
import { PushButton } from '../controls';
import type { DeskStation } from '../desk';
import { floorEmit, type FloorEnv, type FloorFrame, type FloorGame } from '../floor';
import { friendNear, type ArcadeFriend, type ArcadeSession } from '../net';
import type { ArcadeSlot } from '../index';
import { paintVolumeBadge, paintVolumeOverlay } from '../lastmile/art';
import { ART, otrSwatch, otrUV, OTR, OTR_REGION, paintCard, paintNowPlaying, paintOnTheRun } from './art';
import { FONT_FILES, OnTheRunHost } from './host';
import {
  ACTIVE_FOR,
  blankState,
  DASH,
  forwardsKey,
  FrameAssembler,
  gfxFor,
  isSoundKey,
  loadVolume,
  nextQuality,
  nextVolume,
  NET_EVERY,
  NET_H,
  NET_RANGE,
  NET_W,
  padActive,
  parseFrame,
  plan,
  rimAngle,
  saveVolume,
  seatToPad,
  splitFrame,
  Ticker,
  touchToPad,
  volumeBars,
  volumeLevel,
  volumePercent,
  VOLUME_SHOW,
  Wheel,
  wheelToSteer,
  type Plan,
  type XRPadLike,
} from './logic';

/**
 * ON THE RUN: a classic sit-down racing cabinet (a twin cockpit) for the
 * owner's own WebGL racing game (public/arcade/ontherun/, synced from its
 * claude.ai artifact by scripts/sync-ontherun.mjs). Free to play.
 *
 * Two cockpits side by side: each an enclosed bucket seat between side walls,
 * gas and brake pedals, a steering wheel, a dashboard of buttons, and a 16:9
 * screen in front at a seated driver's eye height. The seats are world seats
 * like the stools: walk into one and you sit (in VR your body sits; on a
 * screen the camera drops to seated eye height facing the screen and the game
 * takes your keys). On a screen, E next to the cockpit sits you too.
 *
 * The game itself is the real web page, run by OnTheRunHost in a hidden
 * iframe, frame by frame from the room's loop: its WebGL canvas goes straight
 * to the screen texture, and its HTML HUD and menus are laid over it as a
 * second, slower picture. Only one copy of the game ever runs on a device: on
 * the seat you're in (or as the attract screen on both while you're near and
 * nobody's playing). It loads within 9 m and is gone past 13 m or when you
 * leave the floor.
 *
 * Controls:
 *  - VR: grab the wheel (grip, or pinch with tracked hands) with one or both
 *    hands and turn it; it turns with your hands, and its angle is the game's
 *    analogue steering (through a virtual Xbox-style controller the game reads
 *    with getGamepads). Hands on the wheel, the controllers drive: right
 *    trigger gas, left trigger brake, and the face buttons are the wheel's:
 *    A boost, B guns, X missile, Y jump (right stick click drift, left stick
 *    click oil); in the menus A is OK and B back, and turning the wheel picks.
 *    With tracked hands (no triggers) the gas stays down while you hold the
 *    wheel. The game's rumble (crashes, hits, blasts) pulses the hands on the
 *    wheel. The dashboard buttons (START, VIEW, SOUND, JUMP, BOOST, FIRE,
 *    MISSILE) press with a fingertip. While you hold the wheel you don't walk.
 *  - Screens: your keys go straight to the game (its own keys: arrows / WASD
 *    drive, Space guns, Shift boost, C drift, J jump, R missile, F oil, V view,
 *    Enter OK, P pause, F2 adds a second player on the same keyboard, split
 *    screen); the wheel turns with the arrows. M is the cabinet's SOUND. A
 *    click on the screen is Enter. Phones: the arcade's thumb stick steers and
 *    drives (up gas, down brake), its buttons are JUMP / OK, BOOST and FIRE.
 *
 * Two players: each cockpit runs its own game (two copies can't run on one
 * headset, and a friend's picture over the network is far too coarse to race
 * on), so two friends race side by side, each seeing the other's screen; on
 * one keyboard the game's own split screen (F2) puts two players in one race
 * on one seat's screen. Friends within 14 m see your screen: a 160x90 JPEG up
 * to four times a second with "NOW PLAYING" and your name.
 *
 * Sound: the game's WebAudio and its <audio> music, radio and voices all go
 * into one gain (`bus`) on a positional speaker between the screens (a node
 * source, so three.js moves its panner to the cabinet). SOUND steps it
 * 100 / 66 / 33 / 0 (saved per device); a badge by the button and a brief
 * overlay show the level. An analyser on the bus (`level()`) reads what
 * actually comes out.
 */

const ID = 'ontherun';
const TITLE = 'ON THE RUN';
const URL_PATH = 'arcade/ontherun/index.html';
const CARD_W = 640;
const CARD_H = 360;

// The front unit's side profile (z, y), back-bottom round to the top: the console (low, over a seated
// driver's knees), the screens' slope (centred at a seated driver's eye height), the marquee.
const PROFILE: [number, number][] = [
  [-0.5, 0],
  [0.45, 0],
  [0.45, 0.66],
  [0.05, 0.84],
  [0.0, 0.86],
  [-0.07, 1.44],
  [-0.03, 1.48],
  [0.02, 1.86],
  [-0.5, 1.86],
];
const Z0 = -0.5,
  Z1 = 0.45,
  TOP = 1.86;
const PANEL_FRONT: [number, number] = [0.45, 0.66];
const PANEL_BACK: [number, number] = [0.05, 0.84];
const SCREEN_BOT: [number, number] = [0.0, 0.86];
const SCREEN_TOP: [number, number] = [-0.07, 1.44];
const MARQ_BOT: [number, number] = [-0.03, 1.48];
const MARQ_TOP: [number, number] = [0.02, 1.86];
/** The cockpit behind the front unit: side walls from the console back past the seat (local z), and their height. */
const COCKPIT_Z1 = 1.5;
const COCKPIT_H = 1.0;
/** Seated: the seat's top, and a seated driver's eye height. */
const SEAT_Y = 0.46;
const SEATED_EYE = 1.17;
/** Cabinet width; the seat's centre; its screen. */
export const WIDTH = 1.1;
/** One seat, in the middle (it was a twin cockpit: two copies of the screen and the game's feed cost too much). */
const SEAT_X = 0;
const SCREEN_W = 0.9;
const SCREEN_H = (SCREEN_W * 9) / 16;
/** The wheel: centre (local), rim radius, tilt back from vertical. */
const WHEEL_AT = new THREE.Vector3(0, 0.8, 0.52);
const WHEEL_R = 0.165;
const WHEEL_TILT = 0.62;
/** The seat: local z of its centre (where you sit; the viewpoint is here too). */
const SEAT_Z = 1.08;
/** Dashboard buttons across one seat's console (u 0..1) and how far back (v). */
const DASH_U: Record<(typeof DASH)[number], number> = { START: 0.08, VIEW: 0.17, SOUND: 0.26, JUMP: 0.72, BOOST: 0.8, FIRE: 0.88, MISSILE: 0.96 };
const DASH_COL: Record<(typeof DASH)[number], string> = { START: OTR.cream, VIEW: OTR.cyan, SOUND: OTR.cyan, JUMP: OTR.gold, BOOST: OTR.amber, FIRE: OTR.red, MISSILE: OTR.magenta };
const DASH_V = 0.36;

function remap(geo: THREE.BufferGeometry, rect: [number, number, number, number]) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const [u0, v0, u1, v1] = rect;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (u0 + u1) / 2, (v0 + v1) / 2);
  uv.needsUpdate = true;
  return geo;
}

interface Seat {
  i: number;
  wheel: Wheel;
  /** The turning part (rim, spokes, hub) and the wheel's frame (world, unrotated). */
  rim: THREE.Group;
  frame: THREE.Matrix4;
  frameInv: THREE.Matrix4;
  grips: { g: { at(): THREE.Vector3; radius: number }; side: -1 | 1 }[];
  hands: Map<string, Hand>;
  dash: PushButton[];
  screen: THREE.Mesh;
  hudMesh: THREE.Mesh;
  volMesh: THREE.Mesh;
  card: { c: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; line: string };
  mode: 'live' | 'card' | 'friend';
  stand: THREE.Vector3;
  remote: { id: string; name: string; at: number; asm: FrameAssembler } | null;
}

export class OnTheRunCabinet implements FloorGame {
  readonly id = ID;
  readonly title = TITLE;
  readonly sitOnE = true;
  readonly center: THREE.Vector3;
  readonly viewpoints: Viewpoint[] = [];
  readonly desk: DeskStation;
  readonly group = new THREE.Group();
  readonly host: OnTheRunHost;
  readonly seats: Seat[] = [];
  private screenMat: THREE.MeshBasicMaterial[] = [];
  private liveTex: THREE.Texture | null = null;
  readonly hudTex: THREE.CanvasTexture;
  private volCanvas: HTMLCanvasElement;
  private volTex: THREE.CanvasTexture;
  private anchor = new THREE.Object3D();
  private bus: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private abuf: Float32Array<ArrayBuffer> | null = null;
  speaker: THREE.PositionalAudio | null = null;
  private levelTarget = -1;
  /** The SOUND button's step (an index into VOLUME_STEPS: 0 is full). */
  volumeStep = loadVolume();
  private volShownAt = -1e9;
  private badges: { g: CanvasRenderingContext2D; tex: THREE.CanvasTexture }[] = [];
  private session: ArcadeSession | null = null;
  private time = 0;
  private lastInput = -1e9;
  /** The seat my game is on (the last one I drove from). */
  mySeat = 0;
  private state = blankState();
  private ticker = new Ticker();
  private hudTicker = new Ticker();
  private atDesk = false;
  private satAt = -1e9;
  private soundWas = false;
  private cardT = 0;
  private artCtx: CanvasRenderingContext2D;
  private artTex: THREE.CanvasTexture;
  /** The plan last frame (tests and the dev harness). */
  last: Plan & { playing: boolean; friend: boolean } = { load: false, rate: 0, hud: 0, playing: false, friend: false };
  /** Game frames copied to the screen, HUD pictures uploaded (tests read these). */
  uploads = 0;
  hudUploads = 0;
  /** Main-thread ms the cabinet spent this frame on the game (frame + copy + HUD), smoothed. */
  costMs = 0;
  // Friends.
  private netT = 0;
  private netQ = 0.5;
  private netCanvas: HTMLCanvasElement | null = null;
  private sending = false;
  private frameId = 0;
  private netImg: HTMLImageElement | null = null;
  framesIn = 0;
  lastSent = 0;
  private gfx = gfxFor(undefined);
  private tmp = new THREE.Vector3();

  constructor(
    private env: FloorEnv,
    slot: ArcadeSlot,
    tier?: string,
  ) {
    this.gfx = gfxFor(tier);
    this.center = slot.pos.clone();
    const fwd = new THREE.Vector3(Math.sin(slot.yaw), 0, Math.cos(slot.yaw));
    // The body fills the slot's footprint (its depth); the seats are in front of it.
    this.group.position.copy(slot.pos).addScaledVector(fwd, -(Z0 + Z1) / 2);
    this.group.rotation.y = slot.yaw;
    this.group.name = 'cabinet-ontherun';
    env.bakeRoot.add(this.group);
    this.group.updateMatrixWorld(true);

    // Art: its own canvas and materials.
    const art = document.createElement('canvas');
    art.width = art.height = ART;
    this.artCtx = art.getContext('2d')!;
    const tex = (this.artTex = new THREE.CanvasTexture(art));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mats = {
      body: new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.5, metalness: 0.15 }),
      art: new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.42, metalness: 0.05, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.16 }),
      lit: new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
    };
    this.build(mats);
    this.paintArt();
    // The game's own display face, once it's here (the art is repainted with it).
    if (typeof FontFace !== 'undefined' && typeof document !== 'undefined') {
      const base = 'arcade/ontherun/fonts/';
      const faces = FONT_FILES.map(([f, fam, w]) => new FontFace(fam, `url(${base}${f})`, { weight: String(w) }));
      Promise.all(faces.map((f) => f.load().then((ff) => document.fonts.add(ff))))
        .then(() => this.paintArt())
        .catch(() => {});
    }

    // The game's HUD layer and the volume overlay (shared by both screens: only one game runs).
    this.host = new OnTheRunHost({ url: URL_PATH, gfx: this.gfx, audio: () => this.audioOut(), onError: (e) => console.warn('[ontherun]', e) });
    this.hudTex = new THREE.CanvasTexture(this.host.hud.canvas);
    this.hudTex.colorSpace = THREE.SRGBColorSpace;
    this.hudTex.generateMipmaps = false;
    this.hudTex.minFilter = THREE.LinearFilter;
    this.host.hud.onDraw = () => {
      this.hudTex.needsUpdate = true;
      this.hudUploads++;
    };
    this.volCanvas = document.createElement('canvas');
    this.volCanvas.width = CARD_W;
    this.volCanvas.height = CARD_H;
    this.volTex = new THREE.CanvasTexture(this.volCanvas);
    this.volTex.colorSpace = THREE.SRGBColorSpace;

    this.seats.push(this.buildSeat(0, slot));
    const mid = this.seats[0].screen.position.clone();
    this.anchor.position.copy(mid);
    env.liveRoot.add(this.anchor);

    this.desk = {
      id: ID,
      buttons: ['JUMP / OK', 'BOOST', 'FIRE'],
      help: `${TITLE} · free · Arrows/WASD drive · Space guns · Shift boost · C drift · J jump · R missile · F oil · V view · Enter OK · P pause · F2 2nd player · M sound · Esc/E get out`,
      onKey: (e, down) => this.deskKey(e, down),
    };
    if (env.colliders) env.world.addLocalBox(this.group, 0, (Z0 + Z1) / 2, WIDTH + 0.02, Z1 - Z0 + 0.02, 'arcade cabinet');
    // The cockpit walls are solid (the room's collider is only the front unit): you get in from behind the seats.
    for (const wx of [-WIDTH / 2 + 0.02, WIDTH / 2 - 0.02]) env.world.addLocalBox(this.group, wx, (Z1 + COCKPIT_Z1) / 2, 0.06, COCKPIT_Z1 - Z1, 'racing cockpit wall');

    // Screens: a click on the screen while you're seated is Enter (OK / start).
    if (typeof window !== 'undefined') {
      addEventListener('pointerup', (e) => {
        if (!this.atDesk || this.env.player.inXR || !(e.target instanceof HTMLCanvasElement)) return;
        if (this.time - this.satAt < 0.4) return;
        this.unlockAudio();
        this.send('keydown', 'Enter', 'Enter');
        this.send('keyup', 'Enter', 'Enter');
      });
    }
    for (const p of this.host.pads)
      p.rumble = (strong, weak, ms) => {
        const s = this.seats[this.mySeat];
        for (const h of s.hands.values()) {
          const side = h.ctrl.userData.handedness as 'left' | 'right';
          if (side) this.env.haptic(side, Math.min(1, Math.max(strong, weak)), Math.min(300, ms || 60));
        }
      };
  }

  private paintArt() {
    const buttons = DASH.map((d) => [DASH_U[d], d, DASH_COL[d]] as [number, string, string]);
    paintOnTheRun(this.artCtx, buttons, DASH_V);
    this.artTex.needsUpdate = true;
  }

  private build(m: { body: THREE.Material; art: THREE.Material; lit: THREE.Material }) {
    const g = this.group;
    const inner = WIDTH - 0.04;
    const shape = new THREE.Shape(PROFILE.map(([z, y]) => new THREE.Vector2(z, y)));
    const core = new THREE.ExtrudeGeometry(shape, { depth: inner, bevelEnabled: false });
    core.rotateY(-Math.PI / 2);
    core.translate(inner / 2, 0, 0);
    g.add(new THREE.Mesh(remap(core, otrSwatch('#120b22')), m.body));
    // Side panels with the art.
    const [u0, v0, u1, v1] = otrUV(OTR_REGION.side, 2);
    for (const sgn of [-1, 1]) {
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.022, bevelEnabled: false });
      geo.rotateY(-Math.PI / 2);
      geo.translate(sgn > 0 ? WIDTH / 2 : -WIDTH / 2 + 0.022, 0, 0);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        let k = (pos.getZ(i) - Z0) / (Z1 - Z0);
        if (sgn < 0) k = 1 - k;
        uv.setXY(i, u0 + k * (u1 - u0), v0 + (pos.getY(i) / TOP) * (v1 - v0));
      }
      g.add(new THREE.Mesh(geo, m.art));
    }
    g.add(slopePlane(inner, MARQ_BOT, MARQ_TOP, otrUV(OTR_REGION.marquee), 0.003, m.lit));
    g.add(slopePlane(inner, SCREEN_BOT, SCREEN_TOP, otrUV(OTR_REGION.bezel), 0.003, m.lit));
    for (const sx of [SEAT_X]) {
      const dash = slopePlane(0.98, PANEL_FRONT, PANEL_BACK, otrUV(OTR_REGION.dash), 0.002, m.art);
      dash.position.x = sx;
      g.add(dash);
      const kick = new THREE.Mesh(plane(0.98, 0.6, otrUV(OTR_REGION.kick)), m.art);
      kick.position.set(sx, 0.34, Z1 + 0.003);
      g.add(kick);
    }
    // Neon: cyan under the marquee, magenta along the console's lip, amber up the front edges and between the seats.
    const strip = (col: string, w: number, h: number, d: number, x: number, y: number, z: number) => {
      const s = new THREE.Mesh(
        box(w, h, d, () => otrSwatch(col)),
        m.lit,
      );
      s.position.set(x, y, z);
      g.add(s);
    };
    strip(OTR.cyan, WIDTH + 0.004, 0.016, 0.03, 0, 1.47, -0.02);
    strip(OTR.magenta, WIDTH + 0.004, 0.012, 0.012, 0, 0.665, Z1 + 0.006);
    // The cockpits: each driver sits enclosed between side walls (outer ones with the side art, a shared one between
    // the seats), on a raised floor, in a bucket seat, with gas and brake pedals under the console.
    const wall = new THREE.Shape(
      (
        [
          [Z1 - 0.02, 0],
          [COCKPIT_Z1, 0],
          [COCKPIT_Z1, 0.62],
          [COCKPIT_Z1 - 0.3, COCKPIT_H],
          [Z1 - 0.02, COCKPIT_H - 0.12],
        ] as [number, number][]
      ).map(([z, y]) => new THREE.Vector2(z, y)),
    );
    const [s0, t0, s1, t1] = otrUV(OTR_REGION.side, 2);
    for (const wx of [-WIDTH / 2, WIDTH / 2]) {
      const geo = new THREE.ExtrudeGeometry(wall, { depth: 0.04, bevelEnabled: false });
      geo.rotateY(-Math.PI / 2);
      geo.translate(wx + 0.02, 0, 0);
      if (wx === 0) remap(geo, otrSwatch('#1d1233'));
      else {
        // The side art, its lower front part (the road and the stripes), on the outside walls.
        const pos = geo.attributes.position as THREE.BufferAttribute;
        const uv = geo.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          let k = (pos.getZ(i) - (Z1 - 0.02)) / (COCKPIT_Z1 - Z1 + 0.02);
          if (wx < 0) k = 1 - k;
          uv.setXY(i, s0 + k * (s1 - s0), t0 + (pos.getY(i) / COCKPIT_H) * (t1 - t0) * 0.55);
        }
      }
      g.add(new THREE.Mesh(geo, wx === 0 ? m.body : m.art));
      // Amber along the top edge.
      strip(OTR.amber, 0.05, 0.012, COCKPIT_Z1 - 0.3 - Z1, wx, COCKPIT_H - 0.05, (Z1 + COCKPIT_Z1 - 0.3) / 2);
    }
    for (const sx of [SEAT_X]) {
      for (const [px, col] of [
        [-0.1, '#2a2a30'],
        [0.1, '#3a3a42'],
      ] as const) {
        const pedal = new THREE.Mesh(
          box(0.08, 0.02, 0.2, () => otrSwatch(col)),
          m.body,
        );
        pedal.position.set(sx + px, 0.12, Z1 + 0.14);
        pedal.rotation.x = -0.7;
        g.add(pedal);
      }
      const floorPlate = new THREE.Mesh(
        box(WIDTH / 2 - 0.06, 0.05, COCKPIT_Z1 - Z1, () => otrSwatch('#1a1426')),
        m.body,
      );
      floorPlate.position.set(sx, 0.025, (Z1 + COCKPIT_Z1) / 2);
      g.add(floorPlate);
      const base = new THREE.Mesh(
        box(0.34, SEAT_Y - 0.12, 0.34, () => otrSwatch('#241838')),
        m.body,
      );
      base.position.set(sx, (SEAT_Y - 0.12) / 2, SEAT_Z + 0.05);
      g.add(base);
      const cushion = new THREE.Mesh(
        box(0.48, 0.12, 0.44, () => otrSwatch('#4a2a6e')),
        m.body,
      );
      cushion.position.set(sx, SEAT_Y - 0.06, SEAT_Z + 0.05);
      g.add(cushion);
      const back = new THREE.Mesh(
        box(0.48, 0.66, 0.1, () => otrSwatch('#4a2a6e')),
        m.body,
      );
      back.position.set(sx, SEAT_Y + 0.3, SEAT_Z + 0.33);
      back.rotation.x = 0.2;
      g.add(back);
      for (const bx of [-0.21, 0.21]) {
        const bolster = new THREE.Mesh(
          box(0.06, 0.52, 0.12, () => otrSwatch(OTR.amber)),
          m.lit,
        );
        bolster.position.set(sx + bx, SEAT_Y + 0.3, SEAT_Z + 0.27);
        bolster.rotation.x = 0.2;
        g.add(bolster);
      }
    }
  }

  private buildSeat(i: number, slot: ArcadeSlot): Seat {
    const env = this.env;
    const sx = i === 0 ? -SEAT_X : SEAT_X;
    const gm = this.group.matrixWorld;
    // The screen, on the slope (centred), with the HUD layer and the volume overlay just in front.
    const [bz, by] = SCREEN_BOT,
      [tz, ty] = SCREEN_TOP;
    const ang = Math.atan2(bz - tz, ty - by);
    const smat = new THREE.MeshBasicMaterial({ toneMapped: false, color: 0xffffff });
    this.screenMat.push(smat);
    const mk = (mat: THREE.Material, out: number, w = SCREEN_W, h = SCREEN_H, dy = 0) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      const local = new THREE.Matrix4().makeRotationX(-ang);
      const n = new THREE.Vector3(0, Math.sin(ang), Math.cos(ang)).multiplyScalar(0.006 + out);
      local.setPosition(sx, (by + ty) / 2 + dy, (bz + tz) / 2);
      local.elements[12] += n.x;
      local.elements[13] += n.y;
      local.elements[14] += n.z;
      mesh.matrixAutoUpdate = false;
      mesh.matrix.multiplyMatrices(gm, local);
      mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.matrixWorldNeedsUpdate = true;
      mesh.userData.dynamic = true;
      env.liveRoot.add(mesh);
      return mesh;
    };
    const screen = mk(smat, 0);
    screen.name = `ontherun-screen-${i}`;
    const hudMesh = mk(new THREE.MeshBasicMaterial({ map: this.hudTex, transparent: true, toneMapped: false, depthWrite: false }), 0.002);
    hudMesh.visible = false;
    const volMesh = mk(new THREE.MeshBasicMaterial({ map: this.volTex, transparent: true, toneMapped: false, depthWrite: false }), 0.004);
    volMesh.visible = false;
    const cc = document.createElement('canvas');
    cc.width = CARD_W;
    cc.height = CARD_H;
    const card = { c: cc, g: cc.getContext('2d')!, tex: new THREE.CanvasTexture(cc), line: '' };
    card.tex.colorSpace = THREE.SRGBColorSpace;

    // The wheel: a frame at the column's top (x right, y up the wheel's face, z toward the driver), and the turning part.
    const frame = new THREE.Matrix4().makeRotationX(-WHEEL_TILT);
    frame.setPosition(sx + WHEEL_AT.x, WHEEL_AT.y, WHEEL_AT.z);
    frame.premultiply(gm);
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(frame);
    holder.userData.dynamic = true;
    env.liveRoot.add(holder);
    const rim = new THREE.Group();
    holder.add(rim);
    const grip = new THREE.MeshStandardMaterial({ color: 0x1a1420, roughness: 0.7, metalness: 0.05 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9a96a8, roughness: 0.35, metalness: 0.8 });
    const amber = new THREE.MeshBasicMaterial({ color: new THREE.Color(OTR.amber), toneMapped: false });
    rim.add(new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R, 0.019, 10, 40), grip));
    // A top-centre marker (so you see the wheel turn) and three spokes.
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.042), amber);
    mark.position.set(0, WHEEL_R, 0);
    rim.add(mark);
    for (const a of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(WHEEL_R, 0.026, 0.012), metal);
      sp.position.set((Math.sin(a) * WHEEL_R) / 2, (Math.cos(a) * WHEEL_R) / 2, -0.006);
      sp.rotation.z = Math.PI / 2 - a;
      rim.add(sp);
    }
    const hubMat = new THREE.MeshBasicMaterial({ map: this.artTex, toneMapped: false });
    const hub = new THREE.Mesh(new THREE.CircleGeometry(0.05, 24), hubMat);
    const [h0, h1, h2, h3] = otrUV(OTR_REGION.hub, 2);
    const huv = hub.geometry.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < huv.count; k++) huv.setXY(k, h0 + huv.getX(k) * (h2 - h0), h1 + huv.getY(k) * (h3 - h1));
    hub.position.z = 0.004;
    rim.add(hub);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.2, 12), metal);
    col.rotation.x = Math.PI / 2;
    col.position.z = -0.1;
    holder.add(col);
    holder.updateMatrixWorld(true);
    const frameInv = frame.clone().invert();

    const seat: Seat = {
      i,
      wheel: new Wheel(),
      rim,
      frame,
      frameInv,
      grips: [],
      hands: new Map(),
      dash: [],
      screen,
      hudMesh,
      volMesh,
      card,
      mode: 'card',
      stand: new THREE.Vector3(),
      remote: null,
    };
    // Two grab zones on the rim, at 9 and 3 o'clock as the wheel stands (one hand or both).
    for (const side of [-1, 1] as const) {
      const pt = new THREE.Vector3();
      const g = {
        radius: 0.12,
        at: () => {
          const a = seat.wheel.angle + (side * Math.PI) / 2;
          return pt.set(Math.sin(a) * WHEEL_R, Math.cos(a) * WHEEL_R, 0).applyMatrix4(frame);
        },
        enabled: () => true,
        grab: (hand: Hand) => {
          const key = String(hand.index);
          if (seat.wheel.holding(key)) return null;
          seat.hands.set(key, hand);
          seat.wheel.grab(key, this.handAngle(seat, hand.pos));
          this.mySeat = i;
          this.lastInput = this.time;
          this.unlockAudio();
          return 'drag' as const;
        },
        drag: (hand: Hand, pos: THREE.Vector3) => seat.wheel.move(String(hand.index), this.handAngle(seat, pos)),
        release: (hand: Hand) => {
          seat.wheel.release(String(hand.index));
          seat.hands.delete(String(hand.index));
        },
      };
      env.hands.register(g);
      seat.grips.push({ g, side });
    }
    // Dashboard buttons.
    const [fz, fy] = PANEL_FRONT,
      [pz, py] = PANEL_BACK;
    const depth = Math.hypot(fz - pz, fy - py);
    const pf = new THREE.Matrix4().makeRotationX(Math.atan2(py - fy, fz - pz));
    pf.setPosition(sx, (fy + py) / 2, (fz + pz) / 2);
    pf.premultiply(gm);
    for (const d of DASH) {
      const at = new THREE.Matrix4().makeTranslation((DASH_U[d] - 0.5) * 0.98, 0.002, -depth / 2 + DASH_V * depth);
      seat.dash.push(new PushButton(env.inst, at.premultiply(pf), new THREE.Color(DASH_COL[d])));
    }
    this.buildBadge(pf, (DASH_U.SOUND - 0.5) * 0.98, -depth / 2 + (DASH_V + 0.3) * depth);

    // Where you sit, and the desktop view framed on that seat's screen.
    seat.stand.set(sx, 0, SEAT_Z).applyMatrix4(gm);
    seat.stand.y = 0;
    // A seat like the stools': walk into the cockpit and you sit (in VR your body sits; on a screen the game takes your keys).
    env.world.addLocalSeat(this.group, sx, SEAT_Z, 0.3, SEAT_Y, Math.PI, 'racing seat');
    const sc = new THREE.Vector3().setFromMatrixPosition(screen.matrix);
    this.viewpoints.push({
      id: `${ID}${i}`,
      label: `${TITLE} · seat ${i + 1}`,
      position: seat.stand.clone(),
      yaw: slot.yaw,
      pitch: Math.atan2(sc.y - SEATED_EYE, SEAT_Z + 0.06) * 0.5 - 0.03,
      eye: SEATED_EYE,
      back: 0,
      portrait: { back: 1.05, eye: sc.y, pitch: -0.05 },
    });
    env.interaction.register({
      object: screen,
      label: () => (this.atDesk ? null : `Drive ${TITLE} · free (E)`),
      enabled: () => !env.player.inXR && !this.atDesk,
      onSelect: () => env.sit?.(ID, i),
    });
    this.showCard(seat, 'FREE PLAY  ·  SIT DOWN TO DRIVE');
    return seat;
  }

  /** Where a hand (world) is round the wheel's rim. */
  private handAngle(seat: Seat, world: THREE.Vector3) {
    const p = this.tmp.copy(world).applyMatrix4(seat.frameInv);
    return rimAngle(p.x, p.y);
  }

  private buildBadge(pf: THREE.Matrix4, x: number, z: number) {
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 48;
    const g = c.getContext('2d')!;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.035), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    m.setPosition(x, 0.003, z);
    m.premultiply(pf);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(m);
    mesh.userData.dynamic = true;
    this.env.liveRoot.add(mesh);
    this.badges.push({ g, tex });
    this.paintBadges();
  }

  private paintBadges() {
    for (const b of this.badges) {
      paintVolumeBadge(b.g, 96, 48, volumeBars(this.volumeStep));
      b.tex.needsUpdate = true;
    }
  }

  // --- Sound ------------------------------------------------------------------------

  /** The game's sound goes through the room's audio: a gain into a panner between the screens. */
  private audioOut() {
    const listener = this.env.audio.listener;
    const ctx = listener?.context;
    if (!ctx) return null;
    if (!this.bus) {
      const pa = new THREE.PositionalAudio(listener);
      pa.panner.panningModel = 'equalpower';
      pa.setDistanceModel('inverse');
      pa.setRefDistance(1.4);
      pa.setRolloffFactor(1.4);
      pa.setMaxDistance(30);
      this.anchor.add(pa);
      this.bus = ctx.createGain();
      this.bus.gain.value = 0;
      // As the speaker's node source (not a bare connect): three.js only moves a PositionalAudio's panner to where it is
      // once it's playing or has no playback control, and the arcade is ~630 m from the origin.
      pa.setNodeSource(this.bus as unknown as AudioBufferSourceNode);
      this.speaker = pa;
      // What actually comes out (before the level and the distance): the dev harness and tests read it.
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.bus.connect(this.analyser);
    }
    return { ctx, out: this.bus };
  }

  /** RMS of the cabinet's speaker feed right now (after the SOUND level), 0 when silent or not running. */
  level(): number {
    const a = this.analyser;
    if (!a) return 0;
    const buf = (this.abuf ??= new Float32Array(a.fftSize));
    a.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  private unlockAudio() {
    const c = this.env.audio.listener?.context;
    if (c && c.state === 'suspended') void c.resume().catch(() => {});
  }

  private setLevel(v: number) {
    const b = this.bus;
    if (!b || v === this.levelTarget) return;
    this.levelTarget = v;
    const g = b.gain,
      now = b.context.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.setTargetAtTime(v, now, 0.06);
  }

  /** SOUND: one step down, and from off back to full. */
  cycleVolume() {
    this.volumeStep = nextVolume(this.volumeStep);
    saveVolume(this.volumeStep);
    this.volShownAt = this.time;
    this.paintBadges();
    const g = this.volCanvas.getContext('2d')!;
    g.clearRect(0, 0, CARD_W, CARD_H);
    paintVolumeOverlay(g, CARD_W, CARD_H, volumeBars(this.volumeStep), volumePercent(this.volumeStep));
    this.volTex.needsUpdate = true;
  }

  // --- Input ------------------------------------------------------------------------

  private send(type: 'keydown' | 'keyup', key: string, code: string, repeat = false) {
    this.lastInput = this.time;
    this.host.key({ type, key, code, repeat });
  }

  /** Real keys at the seat go straight to the game; M is the cabinet's SOUND. */
  private deskKey(e: KeyboardEvent, down: boolean): boolean {
    if (isSoundKey(e)) {
      if (down && !e.repeat) this.cycleVolume();
      return true;
    }
    if (!forwardsKey(e.code)) return false;
    if (down) this.unlockAudio();
    this.send(down ? 'keydown' : 'keyup', e.key, e.code, e.repeat);
    return true;
  }

  // --- The screens ------------------------------------------------------------------

  private showCard(s: Seat, line: string, sub = '') {
    if (s.card.line !== line + sub) {
      s.card.line = line + sub;
      paintCard(s.card.g, CARD_W, CARD_H, line, sub);
      s.card.tex.needsUpdate = true;
    }
    this.setMode(s, 'card');
  }

  private setMode(s: Seat, mode: Seat['mode']) {
    s.mode = mode;
    const mat = this.screenMat[s.i];
    const map = mode === 'live' ? this.liveTex : s.card.tex;
    if (mat.map !== map) {
      mat.map = map;
      mat.needsUpdate = true;
    }
    s.hudMesh.visible = mode === 'live' && !this.host.hud.broken;
  }

  private friendFrame(s: Seat, img: HTMLImageElement, name: string) {
    const g = s.card.g;
    g.imageSmoothingEnabled = true;
    g.drawImage(img, 0, 0, CARD_W, CARD_H);
    paintNowPlaying(g, CARD_W, CARD_H, name);
    s.card.line = '';
    s.card.tex.needsUpdate = true;
    this.setMode(s, 'friend');
  }

  /** The game's WebGL canvas as a texture (three.js uploads it with texImage2D in this frame's render). */
  private ensureLiveTex() {
    const c = this.host.canvas;
    if (!c) return;
    const t = this.liveTex;
    if (t && t.image === c && (t.userData.w === c.width && t.userData.h === c.height)) return;
    t?.dispose();
    const nt = new THREE.Texture(c as unknown as HTMLImageElement);
    nt.colorSpace = THREE.SRGBColorSpace;
    nt.generateMipmaps = false;
    nt.minFilter = THREE.LinearFilter;
    nt.magFilter = THREE.LinearFilter;
    nt.userData.w = c.width;
    nt.userData.h = c.height;
    this.liveTex = nt;
    for (const s of this.seats) if (s.mode === 'live') this.screenMat[s.i].map = nt;
  }

  // --- The frame --------------------------------------------------------------------

  /** Mid-race (not in the game's menus, pause or a scene)? */
  private racing(): boolean {
    return this.host.peek((w) => (w as unknown as { __otr?: { state?: string } }).__otr?.state === 'play') ?? false;
  }

  /** Which seat you're at in VR (a hand on its wheel, or standing in it), or -1. */
  private xrSeat(feet: THREE.Vector3): number {
    for (const s of this.seats) if (s.wheel.held) return s.i;
    let best = -1,
      bd = 0.8;
    for (const s of this.seats) {
      const d = Math.hypot(feet.x - s.stand.x, feet.z - s.stand.z);
      if (d < bd) {
        bd = d;
        best = s.i;
      }
    }
    return best;
  }

  update(f: FloorFrame) {
    const t0 = performance.now();
    const dt = f.dt;
    this.time += dt;
    const env = this.env;
    const wasDesk = this.atDesk;
    this.atDesk = !!f.desk;
    if (this.atDesk && !wasDesk) {
      this.satAt = this.time;
      this.mySeat = f.desk!.spot;
      this.lastInput = this.time;
    }
    const st = this.state;
    let plugged = false;
    let soundBtn = false;
    for (const s of this.seats) s.wheel.update(dt);

    if (f.inXR) {
      const seat = this.xrSeat(f.feet);
      // Sitting in the cockpit counts as driving: the game loads as you get in, not as you walk past.
      if (seat >= 0) this.lastInput = this.time;
      const near = seat >= 0 || f.dist < 2.5;
      if (near) env.touch.gather(env.hands);
      for (const s of this.seats) {
        const downs = s.dash.map((b) => (b.update(near ? env.touch : null, false), b.down));
        if (downs.some(Boolean) && s.i === seat) {
          this.mySeat = s.i;
          this.lastInput = this.time;
          plugged = true;
        }
        if (s.i !== this.mySeat) continue;
        soundBtn = downs[DASH.indexOf('SOUND')];
        let right: XRPadLike | null = null,
          left: XRPadLike | null = null;
        let tracked = false;
        for (const h of s.hands.values()) if (h.ctrl.userData.isHand) tracked = true;
        for (const { handedness, gamepad } of env.interaction.gamepads()) {
          if (handedness === 'right') right = gamepad;
          else if (handedness === 'left') left = gamepad;
        }
        if (tracked) right = left = null;
        seatToPad({ steer: wheelToSteer(s.wheel.angle), wheelHeld: s.wheel.held, right, left, dash: downs, autoGas: tracked, racing: this.racing() }, st);
        if (s.wheel.held || downs.some(Boolean)) {
          plugged = true;
          if (padActive(st)) this.lastInput = this.time;
        }
      }
      // Hands on the wheel: the sticks are the game's, so no walking off.
      env.player.anchored = this.seats.some((s) => s.wheel.held);
    } else {
      env.player.anchored = false;
      for (const s of this.seats) for (const b of s.dash) b.update(null, false);
      if (f.desk) {
        const tp = f.desk.touch;
        if (tp && (Math.abs(tp.x) > 0.1 || Math.abs(tp.y) > 0.1 || tp.a || tp.b || tp.c)) {
          touchToPad(tp, st);
          plugged = true;
          this.lastInput = this.time;
        } else st.axes.fill(0), st.buttons.fill(0);
        // The wheel shows the steering (keys or the thumb stick).
        const k = f.desk.pad;
        this.seats[f.desk.spot].wheel.show(Math.max(-1, Math.min(1, k.x)), dt);
      } else st.axes.fill(0), st.buttons.fill(0);
    }
    // The pad stays plugged in while it's in use (and a little after, so a let-go doesn't read as unplugging).
    if (plugged) this.padUntil = this.time + 3;
    this.host.plugged[0] = this.time < this.padUntil;
    this.host.pads[0].set(st, 0);
    if (soundBtn && !this.soundWas) this.cycleVolume();
    this.soundWas = soundBtn;
    for (const s of this.seats) s.rim.rotation.z = -s.wheel.angle;
    if (this.host.plugged[0] && padActive(st)) this.unlockAudio();

    const playing = this.atDesk || this.time - this.lastInput < ACTIVE_FOR;
    const fresh = (s: Seat) => !!s.remote && this.time - s.remote.at < 2.5;
    const friend = !playing && this.seats.every(fresh);
    const host = this.host;
    const p = plan({ here: true, dist: f.dist, playing, loaded: host.loaded, friend, light: !!env.light || this.gfx.scale < 1 });
    this.last = { ...p, playing, friend };
    if (p.load && host.state === 'off') host.load();
    else if (!p.load && host.state !== 'off') {
      host.unload();
      this.ticker = new Ticker();
      this.hudTicker = new Ticker();
      this.gateSent = false;
    }

    let ran = 0;
    host.poll();
    if (host.state === 'ready') {
      this.ensureLiveTex();
      // Attract: past the "press any key" gate onto the game's own title (its loading rehearsal runs first).
      if (!this.gateSent && host.stats.frames > 2) {
        this.gateSent = true;
        this.send('keydown', 'Enter', 'Enter');
        this.send('keyup', 'Enter', 'Enter');
        if (!this.atDesk) this.lastInput = -1e9;
      }
      if (p.rate > 0 && this.ticker.due(dt, p.rate)) {
        ran = host.tick();
        if (ran > 0 && this.liveTex) {
          // Same task as the game's frame: its drawing buffer still holds the picture.
          this.liveTex.needsUpdate = true;
          this.uploads++;
          if (this.shotWanted) this.takeShot();
          this.sendFrame(dt, playing);
        }
      }
      if (p.hud > 0 && this.hudTicker.due(dt, p.hud)) host.hud.snap();
    }

    // What each screen shows.
    for (const s of this.seats) {
      const mine = playing && s.i === this.mySeat;
      if (host.state === 'ready' && (mine || (!playing && !fresh(s)))) this.setMode(s, 'live');
      else if (fresh(s) && !mine) {
        if (s.mode !== 'friend') this.showCard(s, 'WAITING FOR A FRIEND’S PICTURE…');
      } else if (host.state === 'loading' || host.state === 'failed') {
        this.cardT -= dt;
        if (this.cardT <= 0 && f.dist < 14) {
          this.cardT = 0.25;
          this.showCard(s, host.state === 'loading' ? 'LOADING…' : 'OUT OF ORDER');
        }
      } else this.showCard(s, playing ? 'FREE SEAT  ·  SIT DOWN TO RACE' : 'FREE PLAY  ·  SIT DOWN TO DRIVE');
    }
    for (const s of this.seats) {
      const tv = this.time - this.volShownAt;
      s.volMesh.visible = tv < VOLUME_SHOW && (s.i === this.mySeat || !playing);
      (s.volMesh.material as THREE.MeshBasicMaterial).opacity = tv < VOLUME_SHOW - 0.4 ? 1 : Math.max(0, (VOLUME_SHOW - tv) / 0.4);
    }

    this.setLevel(env.audio.muted ? 0 : volumeLevel(this.volumeStep) * (playing ? 1 : 0.45));
    if (!ran) this.sendFrame(dt, playing, true);
    const ms = performance.now() - t0;
    this.costMs += (ms - this.costMs) * 0.1;
  }

  private padUntil = -1;
  /** The dev harness asks for the next game frame as a picture (3D and HUD, as the screen shows it). */
  shotWanted = false;
  shot: HTMLCanvasElement | null = null;

  private takeShot() {
    this.shotWanted = false;
    const gl = this.host.canvas;
    if (!gl) return;
    const c = (this.shot ??= document.createElement('canvas'));
    c.width = 960;
    c.height = 540;
    const g = c.getContext('2d')!;
    g.drawImage(gl, 0, 0, 960, 540);
    g.drawImage(this.host.hud.canvas, 0, 0, 960, 540);
  }
  private gateSent = false;

  /** You've left the arcade's floor: everything stops and the game goes. */
  sleep() {
    if (this.host.state !== 'off') this.host.unload();
    this.gateSent = false;
    this.lastInput = -1e9;
    this.padUntil = -1;
    this.host.plugged[0] = false;
    for (const s of this.seats) {
      s.remote = null;
      s.wheel.reset();
      this.showCard(s, 'FREE PLAY  ·  SIT DOWN TO DRIVE');
    }
    this.env.player.anchored = false;
    this.setLevel(0);
    if (this.sending) {
      this.sending = false;
      floorEmit(this.session, ID, { k: 'x', s: this.mySeat });
    }
  }

  leaveDesk() {
    // Let go of every key the game might think is still down.
    for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyC']) this.send('keyup', '', code);
  }

  // --- Friends ----------------------------------------------------------------------

  connect(s: ArcadeSession | null) {
    this.session = s;
    for (const x of this.seats) x.remote = null;
    this.sending = false;
  }

  private sendFrame(dt: number, playing: boolean, timeOnly = false) {
    const s = this.session;
    if (!s) return;
    if (!playing || this.host.state !== 'ready') {
      if (this.sending) {
        this.sending = false;
        floorEmit(s, ID, { k: 'x', s: this.mySeat });
      }
      return;
    }
    if (timeOnly) {
      this.netT -= dt;
      return;
    }
    if (this.netT > 0) {
      this.netT -= dt;
      return;
    }
    this.netT = NET_EVERY;
    let anyone = false;
    for (const fr of s.friendList()) if (friendNear(fr, this.center.x, this.center.z, NET_RANGE)) anyone = true;
    if (!anyone) return;
    if ((s.unconfirmed?.('arcF') ?? 0) > 1) return;
    const b64 = this.encodeFrame();
    if (!b64) return;
    this.sending = true;
    const parts = splitFrame(b64);
    const id = this.frameId++;
    const n = this.env.name();
    parts.forEach((fr, i) => floorEmit(s, ID, { k: 'f', s: this.mySeat, id, i, c: parts.length, f: fr, n }));
  }

  /** My screen as a small JPEG (base64, no prefix): the game's 3D and its HUD. Call right after a game frame. */
  encodeFrame(): string | null {
    const gl = this.host.canvas;
    if (!gl) return null;
    if (!this.netCanvas) {
      this.netCanvas = document.createElement('canvas');
      this.netCanvas.width = NET_W;
      this.netCanvas.height = NET_H;
    }
    const g = this.netCanvas.getContext('2d');
    if (!g) return null;
    g.imageSmoothingEnabled = true;
    try {
      g.drawImage(gl, 0, 0, NET_W, NET_H);
      if (!this.host.hud.broken) g.drawImage(this.host.hud.canvas, 0, 0, NET_W, NET_H);
    } catch {
      return null;
    }
    let b64 = '';
    for (let tries = 0; tries < 3; tries++) {
      const url = this.netCanvas.toDataURL('image/jpeg', this.netQ);
      b64 = url.slice(url.indexOf(',') + 1);
      const q = nextQuality(this.netQ, b64.length);
      const tooBig = q < this.netQ;
      this.netQ = q;
      if (!tooBig) break;
      b64 = '';
    }
    this.lastSent = b64.length;
    return b64 || null;
  }

  receive(from: ArcadeFriend, d: Record<string, unknown>) {
    const seat = this.seats[0];
    if (d.k === 'x') {
      if (seat.remote?.id === from.id) seat.remote = null;
      return;
    }
    if (d.k !== 'f') return;
    const fr = parseFrame(d);
    if (!fr) return;
    // A friend moved seats: forget them on the other one.
    for (const s of this.seats) if (s !== seat && s.remote?.id === from.id) s.remote = null;
    if (seat.remote?.id !== from.id) seat.remote = { id: from.id, name: '', at: this.time, asm: new FrameAssembler() };
    const r = seat.remote;
    r.name = from.name || fr.name;
    r.at = this.time;
    const jpeg = r.asm.push(fr);
    if (!jpeg || typeof Image === 'undefined') return;
    const img = (this.netImg ??= new Image());
    const name = r.name;
    img.onload = () => {
      const mine = this.last.playing && seat.i === this.mySeat;
      if (!mine) this.friendFrame(seat, img, name);
    };
    img.src = `data:image/jpeg;base64,${jpeg}`;
    this.framesIn++;
  }
}

