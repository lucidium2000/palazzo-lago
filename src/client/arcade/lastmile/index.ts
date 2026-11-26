import * as THREE from 'three';
import type { Viewpoint } from '../../player';
import { box, plane, slopePlane } from '../cabinet';
import { ControlSet } from '../controls';
import type { DeskStation } from '../desk';
import { floorEmit, type FloorEnv, type FloorFrame, type FloorGame } from '../floor';
import { friendNear, type ArcadeFriend, type ArcadeSession } from '../net';
import type { ArcadeSlot } from '../index';
import { blankPad, type RawPad } from '../types';
import { ART, lmSwatch, lmUV, LM_REGION, paintLastMile, paintNowPlaying, paintScreenCard, paintVolumeBadge, paintVolumeOverlay } from './art';
import { LastMileHost, type HostAudio } from './host';
import {
  ACTIVE_FOR,
  forwardsKey,
  FrameAssembler,
  gestureKey,
  isSoundKey,
  loadVolume,
  nextQuality,
  nextVolume,
  NET_EVERY,
  NET_H,
  NET_RANGE,
  NET_W,
  PadKeys,
  parseFrame,
  plan,
  saveVolume,
  splitFrame,
  Ticker,
  volumeBars,
  volumeLevel,
  volumePercent,
  VOLUME_SHOW,
  type KeyStroke,
  type Plan,
} from './logic';

/**
 * THE LAST MILE: a featured, wide cabinet for Christopher G. Hunt's own
 * browser game (MIT; public/arcade/lastmile/, synced by
 * scripts/sync-lastmile.mjs). Free to play: it's the owner's game.
 *
 * The game itself is the real web page, run in a hidden iframe by
 * LastMileHost, frame by frame from the room's loop, and its canvas is copied
 * onto this cabinet's 16:9 screen. It only exists while someone's near
 * (loaded within 9 m, gone past 13 m or when you leave the floor), runs at 10
 * fps as an attract screen and at full rate (30 on Quest 2 / phones) while
 * you're playing.
 *
 * Controls: in VR the cabinet's 8-way stick and CROSS / SOUND buttons; on a
 * screen walk up (or click the screen) and your keys go straight to the game
 * (arrows / WASD / Space, M for sound), a click or tap is CROSS and a swipe
 * moves; on a phone the arcade's thumb stick and buttons work too.
 *
 * Sound: the game plays through the room's AudioContext into a gain (`bus`)
 * on a positional speaker at the screen. SOUND (or M) steps that gain
 * 100% / 66% / 33% / mute and round again, remembered per device; the level
 * shows on a badge by the button and briefly on the screen. The game itself
 * stays at its own full volume and never sees M.
 *
 * Friends within 14 m see your game: a 160x90 JPEG of the screen up to four
 * times a second (~3.4 K base64, sent as two half-packet pieces and paced by
 * what they've acknowledged), with "NOW PLAYING" and your name on it.
 */

const ID = 'lastmile';
const TITLE = 'The Last Mile';
/** The game's own resolution: 16:9, run at half of its 1920x1080 logical size. */
export const GAME_W = 960;
export const GAME_H = 540;
const URL_PATH = 'arcade/lastmile/index.html';

// The side profile (z, y), back-bottom round to the top: kick panel, control shelf, a tall 16:9 screen, marquee.
const PROFILE: [number, number][] = [
  [-0.42, 0],
  [0.36, 0],
  [0.36, 0.84],
  [0.5, 0.89],
  [0.5, 0.95],
  [0.26, 1.02],
  [0.22, 1.04],
  [0.05, 1.74],
  [0.13, 1.78],
  [0.16, 2.06],
  [-0.42, 2.06],
];
const Z0 = -0.42,
  Z1 = 0.5,
  TOP = 2.06;
const PANEL_FRONT: [number, number] = [0.5, 0.95];
const PANEL_BACK: [number, number] = [0.26, 1.02];
const SCREEN_BOT: [number, number] = [0.22, 1.04];
const SCREEN_TOP: [number, number] = [0.05, 1.74];
const MARQ_BOT: [number, number] = [0.13, 1.78];
const MARQ_TOP: [number, number] = [0.16, 2.06];
/** Cabinet width and the screen (m). */
const WIDTH = 1.36;
const SCREEN_W = 1.12;
const SCREEN_H = (SCREEN_W * 9) / 16;
/** The panel print: stick and buttons across the panel (0..1), and how far back (v, 0 = far edge... 1 = near). */
const STICK_U = 0.28;
const BTN = [
  { u: 0.6, label: 'CROSS', col: '#ff6a13', color: 0xff3b2f },
  { u: 0.7, label: '', col: '', color: 0x000000 },
  { u: 0.8, label: 'SOUND', col: '#3ad8ff', color: 0x3ad8ff },
];

const ZERO: Readonly<RawPad> = Object.freeze(blankPad());

function remap(geo: THREE.BufferGeometry, rect: [number, number, number, number]) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const [u0, v0, u1, v1] = rect;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (u0 + u1) / 2, (v0 + v1) / 2);
  uv.needsUpdate = true;
  return geo;
}

export class LastMileCabinet implements FloorGame {
  readonly id = ID;
  readonly title = TITLE;
  readonly center: THREE.Vector3;
  readonly viewpoints: Viewpoint[];
  readonly desk: DeskStation;
  readonly group = new THREE.Group();
  readonly host: LastMileHost;
  readonly screen: THREE.Mesh;
  readonly screenCanvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  readonly set: ControlSet;
  private sg: CanvasRenderingContext2D;
  private anchor = new THREE.Object3D();
  private bus: GainNode | null = null;
  /** The cabinet's speaker (tests and the dev harness read it). */
  speaker: THREE.PositionalAudio | null = null;
  private levelTarget = -1;
  /** The SOUND button's step (an index into VOLUME_STEPS: 0 is full). */
  volumeStep = loadVolume();
  private volShownAt = -1e9;
  private badge: { g: CanvasRenderingContext2D; tex: THREE.CanvasTexture; w: number; h: number } | null = null;
  private session: ArcadeSession | null = null;
  private time = 0;
  private lastInput = -1e9;
  private padKeys = new PadKeys();
  private strokes: KeyStroke[] = [];
  private xrPad: RawPad = blankPad();
  private ticker = new Ticker();
  private cardT = 0;
  /** What the screen's card says (when the game isn't on it). */
  card = '';
  private atDesk = false;
  private satAt = -1e9;
  private ptr: { id: number; x: number; y: number } | null = null;
  /** The plan last frame (for tests and the dev harness). */
  last: Plan & { playing: boolean; friend: boolean } = { load: false, rate: 0, playing: false, friend: false };
  /** Screen copies made (tests read this). */
  uploads = 0;
  // Friends.
  private netT = 0;
  private netQ = 0.5;
  private netCanvas: HTMLCanvasElement | null = null;
  private sending = false;
  /** Friends' frames put back together (tests read this). */
  framesIn = 0;
  /** Size of the last frame sent (base64 chars), for tests and tuning. */
  lastSent = 0;
  private remote: { id: string; name: string; at: number; asm: FrameAssembler } | null = null;
  private frameId = 0;
  private netImg: HTMLImageElement | null = null;

  constructor(
    private env: FloorEnv,
    slot: ArcadeSlot,
  ) {
    this.center = slot.pos.clone();
    // Centre the body on the slot (it runs from Z0 behind its origin to Z1 in front).
    const fwd = new THREE.Vector3(Math.sin(slot.yaw), 0, Math.cos(slot.yaw));
    this.group.position.copy(slot.pos).addScaledVector(fwd, -(Z0 + Z1) / 2);
    this.group.rotation.y = slot.yaw;
    this.group.name = 'cabinet-lastmile';
    env.bakeRoot.add(this.group);
    this.group.updateMatrixWorld(true);

    // Art: its own canvas and materials (the arcade's shared atlas is full).
    const art = document.createElement('canvas');
    art.width = art.height = ART;
    const ag = art.getContext('2d')!;
    const tex = new THREE.CanvasTexture(art);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mats = {
      body: new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.55, metalness: 0.1 }),
      art: new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.42, metalness: 0.05, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.14 }),
      lit: new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
    };
    this.build(mats);
    paintLastMile(
      ag,
      STICK_U,
      BTN.filter((b) => b.label),
    );
    tex.needsUpdate = true;

    // The screen.
    this.screenCanvas = document.createElement('canvas');
    this.screenCanvas.width = GAME_W;
    this.screenCanvas.height = GAME_H;
    this.sg = this.screenCanvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.screenCanvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.screen = slopePlane(SCREEN_W, SCREEN_BOT, SCREEN_TOP, [0, 0, 1, 1], 0.006, new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }));
    this.screen.geometry.dispose();
    this.screen.geometry = new THREE.PlaneGeometry(SCREEN_W, SCREEN_H);
    this.screen.name = 'lastmile-screen';
    this.screen.userData.dynamic = true;
    this.screen.matrixAutoUpdate = false;
    this.screen.updateMatrix();
    this.screen.matrix.premultiply(this.group.matrixWorld);
    this.screen.matrixWorldNeedsUpdate = true;
    env.liveRoot.add(this.screen);
    const screenCenter = new THREE.Vector3().setFromMatrixPosition(this.screen.matrix);
    this.anchor.position.copy(screenCenter);
    env.liveRoot.add(this.anchor);
    this.showCard('FREE PLAY  ·  WALK UP TO PLAY');

    // Controls on the panel: the stick, CROSS and SOUND (the middle button isn't fitted).
    const [fz, fy] = PANEL_FRONT,
      [bz, by] = PANEL_BACK;
    const depth = Math.hypot(fz - bz, fy - by);
    const pf = new THREE.Matrix4().makeRotationX(Math.atan2(by - fy, fz - bz));
    pf.setPosition(0, (fy + by) / 2, (fz + bz) / 2);
    pf.premultiply(this.group.matrixWorld);
    const inner = WIDTH - 0.04;
    const at = (u: number, v: number) => new THREE.Vector3((u - 0.5) * inner, 0, -depth / 2 + v * depth);
    this.set = new ControlSet(
      env.inst,
      pf,
      at(STICK_U, 0.5),
      BTN.map((b) => at(b.u, 0.45).setY(0.002)),
      new THREE.Color(0xff6a13),
      BTN.map((b) => new THREE.Color(b.color)),
      BTN.map((b) => !!b.label),
    );
    env.hands.register(this.set.grab);
    this.buildBadge(pf, at(0.905, 0.45));
    this.set.onPress = (_b, side) => {
      if (side) env.haptic(side, 0.6, 30);
    };

    // Where you stand: in front of the panel. Desktop: framed on the whole screen.
    const stand = slot.pos.clone().addScaledVector(fwd, slot.footprint[1] / 2 + 0.45);
    this.viewpoints = [
      {
        id: ID,
        label: TITLE,
        position: stand,
        yaw: slot.yaw,
        pitch: -0.1,
        eye: screenCenter.y + 0.06,
        back: 0.32,
        portrait: { back: 0.95, eye: screenCenter.y + 0.08, pitch: -0.12 },
      },
    ];
    this.desk = {
      id: ID,
      buttons: ['CROSS', '', 'SOUND'],
      help: `${TITLE} · free play · Arrows/WASD move · Space cross · M sound · click = cross, drag = move · Esc leave`,
      onKey: (e, down) => this.deskKey(e, down),
    };
    if (env.colliders) env.world.addLocalBox(this.group, 0, (Z0 + Z1) / 2, WIDTH + 0.02, Z1 - Z0 + 0.02, 'arcade cabinet');
    env.interaction.register({
      object: this.screen,
      label: () => (this.atDesk ? null : `Play ${TITLE} · free`),
      enabled: () => !env.player.inXR && !this.atDesk,
      onSelect: () => env.sit?.(ID, 0),
    });

    this.host = new LastMileHost({
      url: URL_PATH,
      width: GAME_W,
      height: GAME_H,
      audio: () => this.audioOut(),
      onError: (e) => console.warn('[lastmile]', e),
    });

    // Screens: a tap or click anywhere on the view is CROSS, a swipe or drag moves (while you're at the cabinet).
    if (typeof window !== 'undefined') {
      addEventListener('pointerdown', (e) => {
        if (!this.atDesk || this.env.player.inXR || !(e.target instanceof HTMLCanvasElement)) return;
        this.ptr = { id: e.pointerId, x: e.clientX, y: e.clientY };
      });
      addEventListener('pointerup', (e) => {
        const p = this.ptr;
        if (!p || p.id !== e.pointerId) return;
        this.ptr = null;
        if (!this.atDesk || this.time - this.satAt < 0.4) return;
        const k = gestureKey(e.clientX - p.x, e.clientY - p.y);
        this.unlockAudio();
        this.send({ type: 'keydown', key: k.key, code: k.code, repeat: false });
        this.send({ type: 'keyup', key: k.key, code: k.code, repeat: false });
      });
      addEventListener('pointercancel', () => (this.ptr = null));
    }
  }

  private build(m: { body: THREE.Material; art: THREE.Material; lit: THREE.Material }) {
    const g = this.group;
    const inner = WIDTH - 0.04;
    const shape = new THREE.Shape(PROFILE.map(([z, y]) => new THREE.Vector2(z, y)));
    const core = new THREE.ExtrudeGeometry(shape, { depth: inner, bevelEnabled: false });
    core.rotateY(-Math.PI / 2);
    core.translate(inner / 2, 0, 0);
    g.add(new THREE.Mesh(remap(core, lmSwatch('#0d0a0b')), m.body));
    // Side panels with the art (right of the picture is the cabinet's front, seen from either side).
    const [u0, v0, u1, v1] = lmUV(LM_REGION.side, 2);
    for (const sgn of [-1, 1]) {
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.022, bevelEnabled: false });
      geo.rotateY(-Math.PI / 2);
      geo.translate(sgn > 0 ? WIDTH / 2 : -WIDTH / 2 + 0.022, 0, 0);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        let k = (pos.getZ(i) - Z0) / (Z1 - Z0);
        if (sgn > 0) k = 1 - k;
        uv.setXY(i, u0 + k * (u1 - u0), v0 + (pos.getY(i) / TOP) * (v1 - v0));
      }
      g.add(new THREE.Mesh(geo, m.art));
    }
    g.add(slopePlane(inner, MARQ_BOT, MARQ_TOP, lmUV(LM_REGION.marquee), 0.003, m.lit));
    g.add(slopePlane(inner, SCREEN_BOT, SCREEN_TOP, lmUV(LM_REGION.bezel), 0.003, m.lit));
    g.add(slopePlane(inner, PANEL_FRONT, PANEL_BACK, lmUV(LM_REGION.panel), 0.002, m.art));
    const door = new THREE.Mesh(plane(inner, 0.8, lmUV(LM_REGION.door)), m.art);
    door.position.set(0, 0.46, 0.363);
    g.add(door);
    // Orange neon: under the marquee, along the panel's lip, and up both front edges.
    const orange = lmSwatch('#ff6a13');
    const strip = new THREE.Mesh(box(WIDTH + 0.004, 0.014, 0.03, () => orange), m.lit);
    strip.position.set(0, 1.78, 0.13);
    g.add(strip);
    const lip = new THREE.Mesh(box(WIDTH + 0.004, 0.012, 0.012, () => orange), m.lit);
    lip.position.set(0, 0.92, 0.506);
    g.add(lip);
    for (const sx of [-1, 1]) {
      const edge = new THREE.Mesh(box(0.012, 0.84, 0.012, () => orange), m.lit);
      edge.position.set(sx * (WIDTH / 2 + 0.002), 0.42, 0.366);
      g.add(edge);
    }
    const kick = new THREE.Mesh(box(WIDTH, 0.06, 0.02, () => lmSwatch('#050507')), m.body);
    kick.position.set(0, 0.03, 0.365);
    g.add(kick);
  }

  // --- Sound ------------------------------------------------------------------------

  /** The game's sound goes through the room's audio: a gain into a panner at the screen. */
  private audioOut(): HostAudio | null {
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
      // As the speaker's node source, not a bare connect: three only moves a PositionalAudio's panner
      // to where it is once it's "playing" or has no playback control (a node source), so wired in
      // directly the panner stayed at the world origin, hundreds of metres from the arcade, and the
      // game came out ~56 dB down: silent.
      pa.setNodeSource(this.bus as unknown as AudioBufferSourceNode);
      this.speaker = pa;
    }
    return { ctx, out: this.bus };
  }

  private unlockAudio() {
    const c = this.env.audio.listener?.context;
    if (c && c.state === 'suspended') void c.resume().catch(() => {});
  }

  private setLevel(v: number) {
    const b = this.bus;
    if (!b) return;
    if (v === this.levelTarget) return;
    this.levelTarget = v;
    const g = b.gain,
      now = b.context.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.setTargetAtTime(v, now, 0.06);
  }

  /** The cabinet's own level (0..1) for the SOUND step. */
  get volume() {
    return volumeLevel(this.volumeStep);
  }

  /** SOUND (or M): one step down, from mute back to full; remembered on this device. */
  stepVolume() {
    this.volumeStep = nextVolume(this.volumeStep);
    saveVolume(this.volumeStep);
    this.volShownAt = this.time;
    this.paintBadge();
  }

  private buildBadge(pf: THREE.Matrix4, at: THREE.Vector3) {
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 48;
    const g = c.getContext('2d');
    if (!g) return;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.badge = { g, tex, w: c.width, h: c.height };
    this.paintBadge();
    // Flat on the panel, beside the SOUND button, reading the right way up from where you stand.
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.084, 0.042), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    m.name = 'lastmile-volume';
    m.userData.dynamic = true;
    m.matrixAutoUpdate = false;
    m.matrix.makeRotationX(-Math.PI / 2).setPosition(at.x, at.y + 0.003, at.z).premultiply(pf);
    m.matrixWorldNeedsUpdate = true;
    this.env.liveRoot.add(m);
  }

  private paintBadge() {
    const b = this.badge;
    if (!b) return;
    paintVolumeBadge(b.g, b.w, b.h, volumeBars(this.volumeStep));
    b.tex.needsUpdate = true;
  }

  /** The level over the game for a moment after a press (fading out). Returns whether it drew. */
  private volumeOverlay(): boolean {
    const t = this.time - this.volShownAt;
    if (t > VOLUME_SHOW) return false;
    const a = t < VOLUME_SHOW - 0.4 ? 1 : (VOLUME_SHOW - t) / 0.4;
    paintVolumeOverlay(this.sg, GAME_W, GAME_H, volumeBars(this.volumeStep), volumePercent(this.volumeStep), a);
    return true;
  }

  // --- Input ------------------------------------------------------------------------

  private send(k: KeyStroke) {
    this.lastInput = this.time;
    // SOUND is the cabinet's: it steps our level, and the game (kept at full) never sees it.
    if (isSoundKey(k)) {
      if (k.type === 'keydown' && !k.repeat) this.stepVolume();
      return;
    }
    this.host.key(k);
  }

  /** Real keys at the desk go straight to the game. */
  private deskKey(e: KeyboardEvent, down: boolean): boolean {
    if (!forwardsKey(e.code)) return false;
    if (down) this.unlockAudio();
    this.send({ type: down ? 'keydown' : 'keyup', key: e.key, code: e.code, repeat: e.repeat });
    return true;
  }

  // --- The screen -------------------------------------------------------------------

  private showCard(line: string) {
    this.card = line;
    paintScreenCard(this.sg, GAME_W, GAME_H, line, this.time);
    this.texture.needsUpdate = true;
    this.uploads++;
  }

  private friendFrame(img: HTMLImageElement, name: string) {
    const g = this.sg;
    g.imageSmoothingEnabled = true;
    g.drawImage(img, 0, 0, GAME_W, GAME_H);
    paintNowPlaying(g, GAME_W, GAME_H, name);
    this.texture.needsUpdate = true;
    this.uploads++;
  }

  // --- The frame --------------------------------------------------------------------

  update(f: FloorFrame) {
    const dt = f.dt;
    this.time += dt;
    const env = this.env;
    const strokes = this.strokes;
    strokes.length = 0;
    const vp = this.viewpoints[0].position;
    const dStand = Math.hypot(f.feet.x - vp.x, f.feet.z - vp.z);
    const wasDesk = this.atDesk;
    this.atDesk = !!f.desk;
    if (this.atDesk && !wasDesk) this.satAt = this.time;
    if (f.inXR && (dStand < 0.9 || this.set.held)) {
      env.touch.gather(env.hands);
      this.set.pressFrom(env.touch.points, env.touch.sides, env.touch.count);
      this.set.readInto(this.xrPad);
      this.padKeys.update(this.xrPad, dt, strokes);
    } else if (f.desk) {
      // Keys are forwarded as they are (deskKey); the stick shows them. The phone's thumb stick and buttons go through the pad.
      this.set.setFrom(f.desk.pad);
      this.padKeys.update(f.desk.touch ?? ZERO, dt, strokes);
    } else {
      if (!this.atDesk && wasDesk) this.set.release();
      this.padKeys.release(strokes);
    }
    this.set.redraw();
    if (strokes.length) {
      this.unlockAudio();
      for (const s of strokes) this.send(s);
    }

    const playing = this.atDesk || this.time - this.lastInput < ACTIVE_FOR;
    const friend = !playing && !!this.remote && this.time - this.remote.at < 2.5;
    const wasFriend = this.last.friend;
    const host = this.host;
    const p = plan({ here: true, dist: f.dist, playing, loaded: host.loaded, friend, light: !!env.light });
    this.last = { ...p, playing, friend };
    if (p.load && host.state === 'off') host.load();
    else if (!p.load && host.state !== 'off') {
      host.unload();
      this.ticker = new Ticker();
      this.showCard('FREE PLAY  ·  WALK UP TO PLAY');
    }

    if (host.state === 'ready') {
      if (!friend && this.ticker.due(dt, p.rate) && host.tick() > 0 && host.copyTo(this.sg, GAME_W, GAME_H)) {
        this.volumeOverlay();
        this.texture.needsUpdate = true;
        this.uploads++;
      }
    } else if (friend) {
      // Their frames paint the screen as they arrive (receive).
    } else if (host.state === 'loading' || host.state === 'failed') {
      this.cardT -= dt;
      if (this.cardT <= 0 && f.dist < 14) {
        this.cardT = 0.25;
        this.showCard(host.state === 'loading' ? 'LOADING…' : 'OUT OF ORDER');
      }
    }

    if (wasFriend && !friend && host.state === 'off') this.showCard('FREE PLAY  ·  WALK UP TO PLAY');

    // Its sound: up while you're playing, lower while it's just the attract screen (the panner does the distance).
    this.setLevel(env.audio.muted ? 0 : (playing ? 1.6 : 0.7) * this.volume);
    this.sendFrame(dt, playing);
  }

  /** You've left the arcade's floor: everything stops and the game goes. */
  sleep() {
    if (this.host.state !== 'off') this.host.unload();
    this.padKeys.release(this.strokes);
    this.strokes.length = 0;
    this.lastInput = -1e9;
    this.remote = null;
    this.setLevel(0);
    if (this.sending) {
      this.sending = false;
      floorEmit(this.session, ID, { k: 'x' });
    }
  }

  leaveDesk() {
    this.ptr = null;
  }

  // --- Friends ----------------------------------------------------------------------

  connect(s: ArcadeSession | null) {
    this.session = s;
    this.remote = null;
    this.sending = false;
  }

  private sendFrame(dt: number, playing: boolean) {
    const s = this.session;
    if (!s) return;
    if (!playing || this.host.state !== 'ready') {
      if (this.sending) {
        this.sending = false;
        floorEmit(s, ID, { k: 'x' });
      }
      return;
    }
    this.netT -= dt;
    if (this.netT > 0) return;
    this.netT = NET_EVERY;
    let anyone = false;
    for (const fr of s.friendList()) if (friendNear(fr, this.center.x, this.center.z, NET_RANGE)) anyone = true;
    if (!anyone) return;
    // Don't queue pictures faster than friends confirm them (each piece is half a packet).
    if ((s.unconfirmed?.('arcF') ?? 0) > 1) return;
    const b64 = this.encodeFrame();
    if (!b64) return;
    this.sending = true;
    const parts = splitFrame(b64);
    const id = this.frameId++;
    const n = this.env.name();
    parts.forEach((f, i) => floorEmit(s, ID, { k: 'f', id, i, c: parts.length, f, n }));
  }

  /** The screen as a small JPEG (base64, no prefix), its quality steered to fit one packet. */
  encodeFrame(): string | null {
    if (!this.netCanvas) {
      this.netCanvas = document.createElement('canvas');
      this.netCanvas.width = NET_W;
      this.netCanvas.height = NET_H;
    }
    const g = this.netCanvas.getContext('2d');
    if (!g) return null;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.screenCanvas, 0, 0, NET_W, NET_H);
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
    if (d.k === 'x') {
      if (this.remote?.id === from.id) this.remote = null;
      return;
    }
    if (d.k !== 'f') return;
    const fr = parseFrame(d);
    if (!fr) return;
    if (this.remote?.id !== from.id) this.remote = { id: from.id, name: '', at: this.time, asm: new FrameAssembler() };
    const r = this.remote;
    r.name = from.name || fr.name;
    r.at = this.time;
    const jpeg = r.asm.push(fr);
    if (!jpeg || typeof Image === 'undefined') return;
    const img = (this.netImg ??= new Image());
    const name = r.name;
    img.onload = () => {
      if (!this.last.playing) this.friendFrame(img, name);
    };
    img.src = `data:image/jpeg;base64,${jpeg}`;
    this.framesIn++;
  }
}
