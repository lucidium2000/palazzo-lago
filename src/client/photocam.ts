import * as THREE from 'three';
import type { Grabbable, Hand, Hands } from './hands';
import type { Interaction } from './interaction';
import type { Sound } from './audio';
import { boardOrder, MAX_B64, type PhotoMeta } from './net/photowire';

/**
 * Cameras you can pick up and take photos with (hands first). In VR, grab one
 * (there's one on the bar, one at the pool bar, and the wrist menu can hand
 * you one), frame the shot on its live screen, pull the trigger: flash,
 * shutter, and a Polaroid prints out and flies to the "Tonight at Palazzo
 * Lago" board by the bar. Poke the little flip button for a selfie. On a
 * screen, K takes a photo of what you see. Photos can be downloaded from the
 * gallery (desktop). In a room, your friends see the camera in your hand and
 * your flash go off, and every photo anyone takes goes up on everyone's board
 * (net/photosync.ts), captioned with the photographer's name in their colour.
 */

export interface PhotoCamDeps {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  hands: Hands;
  interaction: Interaction;
  sound: Sound;
  inXR(): boolean;
  /** The trigger on the hand holding the camera (VR). */
  trigger(side: 'left' | 'right'): boolean;
  /** Tell your friends a flash went off here. */
  onFlash?(at: THREE.Vector3): void;
  toast(text: string): void;
  /** Your name and player colour (the caption under your photos). */
  author?(): { name: string; color: number };
}

interface Cam {
  group: THREE.Group;
  home: { p: THREE.Vector3; yaw: number };
  screen: THREE.Mesh;
  lens: THREE.Object3D;
  selfie: boolean;
  held: Hand | null;
  trigWas: boolean;
  last: number;
  /** A friend holding this camera (their id): it's in their hand, not yours to grab. */
  remote: string | null;
  grabbable: Grabbable;
  screenMat: THREE.MeshBasicMaterial;
}

export interface Photo {
  url: string;
  at: number;
  /** Who took it (absent: you). */
  by?: string;
}

/** A photo on the board: who took it, the small JPEG (what friends get) and its Polaroid. */
interface BoardEntry {
  id: string;
  t: number;
  meta: PhotoMeta;
  b64: string;
  tex: THREE.CanvasTexture;
  /** Still flying to the board (its slot stays empty until it lands). */
  landed: boolean;
}

/** Photos on the board (3 × 3), newest first. */
export const BOARD_SLOTS = 9;

const SCREEN_W = 160,
  SCREEN_H = 120;

export class PhotoCams {
  readonly photos: Photo[] = [];
  private cams: Cam[] = [];
  private view: THREE.WebGLRenderTarget;
  private shotCam = new THREE.PerspectiveCamera(58, 4 / 3, 0.05, 200);
  private viewIn = 0;
  private flashes: { m: THREE.Sprite; t: number }[] = [];
  private flashMat: THREE.SpriteMaterial;
  readonly board: THREE.Group;
  private frames: THREE.Mesh[] = [];
  private flying: { m: THREE.Mesh; from: THREE.Vector3; id: string; t: number }[] = [];
  private entries: BoardEntry[] = [];
  /** Photo ids already on the board or on their way (no duplicates). */
  private known = new Set<string>();
  private shotN = 0;
  private tag = Math.random().toString(36).slice(2, 7);
  /** A new photo was taken or arrived from a friend (for the desktop gallery). */
  onPhoto: ((p: Photo) => void) | null = null;
  /** You took a photo: its details and small JPEG (base64), to share with the room. */
  onShot: ((meta: PhotoMeta, b64: string) => void) | null = null;
  /** You set a camera down (index, where): friends see it there. */
  onPut: ((i: number, p: THREE.Vector3, q: THREE.Quaternion) => void) | null = null;

  constructor(private d: PhotoCamDeps, spots: { p: THREE.Vector3; yaw: number }[], board: { p: THREE.Vector3; yaw: number }) {
    this.view = new THREE.WebGLRenderTarget(SCREEN_W, SCREEN_H, { colorSpace: THREE.SRGBColorSpace });
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,250,235,0.7)');
    grad.addColorStop(1, 'rgba(255,240,220,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.flashMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const s of spots) this.cams.push(this.makeCam(s));
    this.board = this.makeBoard(board);
  }

  private makeCam(home: { p: THREE.Vector3; yaw: number }): Cam {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.075, 0.04), new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.45, metalness: 0.3 }));
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.122, 0.012, 0.042), new THREE.MeshStandardMaterial({ color: 0xc8a050, metalness: 1, roughness: 0.3 }));
    trim.position.y = 0.03;
    const lensM = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.03, 20).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0c0c10, metalness: 0.6, roughness: 0.2 }));
    lensM.position.set(0.02, 0, -0.033);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.016, 20), new THREE.MeshStandardMaterial({ color: 0x223355, metalness: 1, roughness: 0.05 }));
    glass.rotation.y = Math.PI;
    glass.position.set(0.02, 0, -0.0485);
    const flashBox = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.012, 0.004), new THREE.MeshBasicMaterial({ color: 0xeeeeff }));
    flashBox.position.set(-0.035, 0.022, -0.021);
    // The live screen on the back (faces you when you hold it up to frame).
    const screenMat = new THREE.MeshBasicMaterial({ color: 0x101418, toneMapped: false });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.084, 0.063), screenMat);
    screen.position.set(0, -0.002, 0.0205);
    // The flip button (poke it): selfie / normal.
    const flip = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 12), new THREE.MeshStandardMaterial({ color: 0xc8a050, metalness: 1, roughness: 0.3 }));
    flip.position.set(0.045, 0.04, 0.008);
    const lens = new THREE.Object3D();
    lens.position.set(0.02, 0, -0.05);
    group.add(body, trim, lensM, glass, flashBox, screen, flip, lens);
    group.traverse((o) => (o.userData.noLand = true));
    group.position.copy(home.p);
    group.rotation.y = home.yaw;
    this.d.scene.add(group);
    const cam = { group, home, screen, lens, selfie: false, held: null, trigWas: false, last: 0, remote: null, screenMat } as Omit<Cam, 'grabbable'> as Cam;
    this.d.interaction.register({
      object: flip,
      kind: 'button',
      label: () => (cam.selfie ? 'Camera: back to normal' : 'Camera: selfie mode'),
      onSelect: () => {
        cam.selfie = !cam.selfie;
        this.d.sound.playLocal('click', 0.4);
      },
    });
    const grab: Grabbable = {
      at: () => group.getWorldPosition(new THREE.Vector3()),
      radius: 0.13,
      enabled: () => !cam.held && !cam.remote,
      grab: (hand) => {
        cam.held = hand;
        cam.trigWas = true; // the grab itself isn't a shot
        return group;
      },
      release: () => {
        cam.held = null;
        // Set it down where you let go (it doesn't fly): back home if it's far from anywhere sensible.
        this.d.scene.attach(group);
        if (group.position.y < 0.3) this.reset(cam);
        this.onPut?.(this.cams.indexOf(cam), group.position, group.quaternion);
      },
    };
    this.d.hands.register(grab);
    cam.grabbable = grab;
    return cam;
  }

  // --- Friends' cameras ------------------------------------------------------------------

  /**
   * The camera in your hand, for your friends: [index, hand (0 left / 1 right),
   * pose relative to that wrist (x, y, z, qx, qy, qz, qw), 1], or the world
   * pose with a trailing 0 when the wrist isn't known. Null: no camera.
   */
  heldState(): number[] | null {
    const i = this.cams.findIndex((c) => c.held);
    if (i < 0) return null;
    const c = this.cams[i];
    const side = c.held!.ctrl.userData.handedness === 'left' ? 'left' : 'right';
    c.group.updateMatrixWorld(true);
    const m = c.group.matrixWorld.clone();
    const w = this.d.hands.wristPose(side);
    if (w) m.premultiply(new THREE.Matrix4().compose(w.p, w.q, new THREE.Vector3(1, 1, 1)).invert());
    const p = new THREE.Vector3(),
      q = new THREE.Quaternion();
    m.decompose(p, q, new THREE.Vector3());
    const r = (v: number, k: number) => Math.round(v * k) / k;
    return [i, side === 'left' ? 0 : 1, ...p.toArray().map((v) => r(v, 1000)), ...q.toArray().map((v) => r(v, 1000)), w ? 1 : 0];
  }

  /** A friend holds camera i: it shows at this world pose (null: they're out of sight). */
  holdRemote(i: number, by: string, world: THREE.Matrix4 | null) {
    const c = this.cams[i];
    if (!c || c.held) return;
    c.remote = by;
    if (c.group.parent !== this.d.scene) this.d.scene.add(c.group);
    c.group.visible = !!world;
    if (world) world.decompose(c.group.position, c.group.quaternion, c.group.scale);
  }

  /** A friend let go of camera i (`home`: they left the room with it, so it goes back to its spot). */
  dropRemote(i: number, home = false) {
    const c = this.cams[i];
    if (!c || !c.remote) return;
    c.remote = null;
    c.group.visible = true;
    c.group.scale.setScalar(1);
    if (home && !c.held) this.reset(c);
  }

  /** A friend set camera i down here. */
  place(i: number, p: THREE.Vector3, q: THREE.Quaternion) {
    const c = this.cams[i];
    if (!c || c.held) return;
    c.remote = null;
    if (c.group.parent !== this.d.scene) this.d.scene.attach(c.group);
    c.group.visible = true;
    c.group.position.copy(p);
    c.group.quaternion.copy(q);
  }

  /** Who holds each camera (for tests and debugging). */
  debugCams() {
    return this.cams.map((c) => ({ held: !!c.held, remote: c.remote, visible: c.group.visible, at: c.group.getWorldPosition(new THREE.Vector3()).toArray() }));
  }

  private reset(cam: Cam) {
    cam.group.position.copy(cam.home.p);
    cam.group.rotation.set(0, cam.home.yaw, 0);
  }

  /** The wrist menu hands you a camera (the nearest free one comes to your hand). */
  giveCamera(near: THREE.Vector3): boolean {
    const free = this.cams.filter((c) => !c.held && !c.remote).sort((a, b) => a.group.position.distanceTo(near) - b.group.position.distanceTo(near))[0];
    if (!free) return false;
    this.d.scene.attach(free.group);
    const ok = this.d.hands.give(free.group, free.grabbable, 'right');
    if (ok) {
      // In the hand like a camera: screen toward you, lens away.
      free.group.position.set(0, 0.03, -0.05);
      free.group.rotation.set(0.35, 0, 0);
      const h = this.d.hands.hands.find((x) => x.carried === free.group) ?? null;
      free.held = h;
      free.trigWas = true;
    }
    return ok;
  }

  private makeBoard(at: { p: THREE.Vector3; yaw: number }) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x3a2214, roughness: 0.6 });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.05, 0.04), new THREE.MeshStandardMaterial({ color: 0x4a1418, roughness: 0.9 }));
    panel.position.y = 1.45;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.15, 0.03), new THREE.MeshStandardMaterial({ color: 0xc8a050, metalness: 1, roughness: 0.3 }));
    frame.position.set(0, 1.45, -0.012);
    const legA = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.5, 0.05), wood);
    legA.position.set(-0.6, 0.75, -0.08);
    legA.rotation.x = -0.12;
    const legB = legA.clone();
    legB.position.x = 0.6;
    const title = document.createElement('canvas');
    title.width = 512;
    title.height = 64;
    const tg = title.getContext('2d')!;
    tg.fillStyle = '#e8c878';
    tg.font = 'italic 600 40px Georgia, serif';
    tg.textAlign = 'center';
    tg.fillText('Tonight at Palazzo Lago', 256, 46);
    const tt = new THREE.CanvasTexture(title);
    tt.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.15), new THREE.MeshBasicMaterial({ map: tt, transparent: true }));
    label.position.set(0, 1.88, 0.025);
    g.add(frame, panel, legA, legB, label);
    // 3 x 3 Polaroid slots.
    for (let i = 0; i < BOARD_SLOTS; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.27), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
      m.position.set(-0.45 + (i % 3) * 0.45, 1.66 - Math.floor(i / 3) * 0.29, 0.025);
      m.rotation.z = (Math.random() - 0.5) * 0.12;
      m.visible = false;
      g.add(m);
      this.frames.push(m);
    }
    g.position.copy(at.p);
    g.rotation.y = at.yaw;
    g.traverse((o) => (o.userData.noLand = true));
    this.d.scene.add(g);
    return g;
  }

  /** Renders the scene from a camera into a target (works in VR too). */
  private renderFrom(cam: THREE.PerspectiveCamera, target: THREE.WebGLRenderTarget) {
    const r = this.d.renderer;
    const xr = r.xr.enabled;
    const prev = r.getRenderTarget();
    r.xr.enabled = false;
    r.setRenderTarget(target);
    r.render(this.d.scene, cam);
    r.setRenderTarget(prev);
    r.xr.enabled = xr;
  }

  private aim(c: Cam) {
    c.group.updateMatrixWorld(true);
    const p = c.lens.getWorldPosition(new THREE.Vector3());
    const q = c.group.getWorldQuaternion(new THREE.Quaternion());
    // Normal: the lens looks out of the front (-Z). Selfie: out of the back, at you.
    if (c.selfie) {
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
      p.copy(c.screen.getWorldPosition(new THREE.Vector3())).add(new THREE.Vector3(0, 0, 0.01).applyQuaternion(q));
    }
    this.shotCam.position.copy(p);
    this.shotCam.quaternion.copy(q);
    this.shotCam.updateMatrixWorld(true);
  }

  update(dt: number) {
    const t = performance.now() / 1000;
    // Live view on the screen of a camera in your hand (a few times a second: it costs a render).
    const held = this.cams.find((c) => c.held);
    this.viewIn -= dt;
    if (held && this.viewIn <= 0) {
      this.viewIn = this.d.inXR() ? 1 / 8 : 1 / 12;
      this.aim(held);
      held.group.visible = false; // don't film the camera itself
      this.renderFrom(this.shotCam, this.view);
      held.group.visible = true;
    }
    // The live view shows only on the camera in your hand (a friend's, or one lying about, is dark glass).
    for (const c of this.cams) {
      const want = c.held ? this.view.texture : null;
      if (c.screenMat.map !== want) {
        c.screenMat.map = want;
        c.screenMat.color.set(want ? 0xffffff : 0x101418);
        c.screenMat.needsUpdate = true;
      }
    }
    // Shutter: the trigger of the hand holding it.
    for (const c of this.cams) {
      if (!c.held) continue;
      const side = c.held.ctrl.userData.handedness === 'left' ? 'left' : 'right';
      const tr = this.d.trigger(side);
      if (tr && !c.trigWas && t - c.last > 0.8) {
        c.last = t;
        this.aim(c);
        this.shoot(this.shotCam, c.group, c.lens.getWorldPosition(new THREE.Vector3()));
        this.d.hands.onHaptic?.(c.held, 0.6, 60);
      }
      c.trigWas = tr;
    }
    // Flashes fade; Polaroids fly to the board.
    for (const f of [...this.flashes]) {
      f.t += dt;
      f.m.material.opacity = Math.max(0, 1 - f.t / 0.25);
      f.m.scale.setScalar(0.4 + f.t * 3);
      if (f.t > 0.25) {
        f.m.removeFromParent();
        this.flashes.splice(this.flashes.indexOf(f), 1);
      }
    }
    for (const f of [...this.flying]) {
      f.t += dt;
      const k = Math.min(1, f.t / 2.2);
      // Its slot (newer photos arriving meanwhile can move it along; pushed off the board: the board itself).
      const slot = this.slotOf(f.id);
      const target: THREE.Object3D = slot ?? this.board;
      const to = target.getWorldPosition(new THREE.Vector3());
      if (!slot) to.y += 1.45;
      if (k < 0.25) {
        // Prints out of the camera first.
        f.m.position.copy(f.from).add(new THREE.Vector3(0, -0.06 * (k / 0.25), 0));
      } else {
        const e = (k - 0.25) / 0.75;
        const s = e * e * (3 - 2 * e);
        f.m.position.lerpVectors(f.from, to, s).add(new THREE.Vector3(0, Math.sin(s * Math.PI) * 0.6, 0));
        f.m.quaternion.slerp(target.getWorldQuaternion(new THREE.Quaternion()), Math.min(1, dt * 3));
      }
      if (k >= 1) {
        f.m.removeFromParent();
        (f.m.material as THREE.Material).dispose();
        this.flying.splice(this.flying.indexOf(f), 1);
        const e = this.entries.find((x) => x.id === f.id);
        if (e) e.landed = true;
        this.layout();
      }
    }
  }

  /** A flash going off somewhere (yours or a friend's). */
  flash(at: THREE.Vector3) {
    const m = new THREE.Sprite(this.flashMat.clone());
    m.position.copy(at);
    m.raycast = () => {};
    this.d.scene.add(m);
    this.flashes.push({ m, t: 0 });
    this.d.sound.play('click', at, { volume: 0.7, rate: 1.6 });
  }

  /** Desktop: K takes a photo of what you see. */
  shootView() {
    const c = this.d.camera;
    this.shotCam.fov = c.fov;
    this.shotCam.position.copy(c.getWorldPosition(new THREE.Vector3()));
    this.shotCam.quaternion.copy(c.getWorldQuaternion(new THREE.Quaternion()));
    this.shotCam.updateMatrixWorld(true);
    const at = this.shotCam.position.clone().add(new THREE.Vector3(0, 0, -0.4).applyQuaternion(this.shotCam.quaternion));
    this.shoot(this.shotCam, null, at);
    this.shotCam.fov = 58;
  }

  private shoot(cam: THREE.PerspectiveCamera, hide: THREE.Object3D | null, flashAt: THREE.Vector3) {
    cam.updateProjectionMatrix();
    const W = 1024,
      H = 768;
    const rt = new THREE.WebGLRenderTarget(W, H, { colorSpace: THREE.SRGBColorSpace });
    if (hide) hide.visible = false;
    this.renderFrom(cam, rt);
    if (hide) hide.visible = true;
    const px = new Uint8Array(W * H * 4);
    this.d.renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
    rt.dispose();
    // Flip rows (GL reads bottom-up) into a canvas.
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d')!;
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    g.putImageData(img, 0, 0);
    const url = canvas.toDataURL('image/jpeg', 0.88);
    const photo = { url, at: Date.now() };
    this.addToGallery(photo);
    this.flash(flashAt);
    this.d.onFlash?.(flashAt);
    // The small copy that goes to your friends (and on the board): 320 × 240, ~15-30 KB.
    const b64 = smallJpeg(canvas);
    const who = this.d.author?.() ?? { name: 'You', color: 0xffc94a };
    const meta: PhotoMeta = { id: `${this.tag}-${++this.shotN}`, a: '', n: who.name.slice(0, 20), c: who.color, t: photo.at };
    this.known.add(meta.id);
    this.pin(meta, b64, canvas, flashAt);
    this.onShot?.(meta, b64);
    this.d.toast(this.d.inXR() ? 'Click! Your photo is on the board by the bar.' : 'Click! Photo saved (Photos button to download).');
  }

  private addToGallery(p: Photo) {
    this.photos.unshift(p);
    if (this.photos.length > 30) this.photos.pop();
    this.onPhoto?.(p);
  }

  /** Already on the board (or on its way). */
  has(id: string) {
    return this.known.has(id);
  }

  /** The photos on the board, newest first: what a friend who walks in gets. */
  boardPhotos(): { meta: PhotoMeta; b64: string }[] {
    return this.entries.map((e) => ({ meta: e.meta, b64: e.b64 }));
  }

  /** One photo's small JPEG and details, if it's still on the board. */
  photo(id: string): { meta: PhotoMeta; b64: string } | null {
    const e = this.entries.find((x) => x.id === id);
    return e ? { meta: e.meta, b64: e.b64 } : null;
  }

  /**
   * A friend's photo arrived: it goes on the board (flying in from `from`,
   * where they are, when given) and into the gallery. Each id once.
   */
  addShared(meta: PhotoMeta, b64: string, from: THREE.Vector3 | null) {
    if (this.known.has(meta.id)) return;
    this.known.add(meta.id);
    const url = `data:image/jpeg;base64,${b64}`;
    const img = new Image();
    img.onload = () => {
      this.pin(meta, b64, img, from);
      this.addToGallery({ url, at: meta.t, by: meta.n });
    };
    img.onerror = () => this.known.delete(meta.id);
    img.src = url;
  }

  /** Board state (for tests and debugging): what's in each slot, newest first. */
  debugBoard() {
    return this.entries.map((e, i) => ({ id: e.id, by: e.meta.n, color: e.meta.c, t: e.t, slot: i < BOARD_SLOTS ? i : -1, landed: e.landed, visible: i < BOARD_SLOTS && this.frames[i].visible }));
  }

  private slotOf(id: string): THREE.Mesh | null {
    const i = this.entries.findIndex((e) => e.id === id);
    return i >= 0 && i < BOARD_SLOTS ? this.frames[i] : null;
  }

  /** Puts the board's photos in their slots, newest first (the oldest drop off once it's full). */
  private layout() {
    this.entries = boardOrder(this.entries);
    while (this.entries.length > BOARD_SLOTS) {
      const e = this.entries.pop()!;
      e.tex.dispose();
    }
    this.frames.forEach((f, i) => {
      const e = this.entries[i];
      const m = f.material as THREE.MeshBasicMaterial;
      if (m.map !== (e?.tex ?? null)) {
        m.map = e?.tex ?? null;
        m.needsUpdate = true;
      }
      f.visible = !!e && e.landed;
    });
  }

  /** A Polaroid (captioned with who took it, in their colour) goes on the board; it prints out and flies there from `from`. */
  private pin(meta: PhotoMeta, b64: string, img: CanvasImageSource, from: THREE.Vector3 | null) {
    const tex = new THREE.CanvasTexture(polaroid(img, meta));
    tex.colorSpace = THREE.SRGBColorSpace;
    const e: BoardEntry = { id: meta.id, t: meta.t, meta, b64, tex, landed: !from };
    this.entries.push(e);
    this.layout();
    if (!this.entries.includes(e) || !from) return;
    const fly = new THREE.Mesh(this.frames[0].geometry, new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }));
    fly.position.copy(from);
    fly.quaternion.copy(this.d.camera.getWorldQuaternion(new THREE.Quaternion()));
    this.d.scene.add(fly);
    this.flying.push({ m: fly, from: from.clone(), id: meta.id, t: 0 });
  }
}

/** The small copy of a photo that travels: 320 × 240 JPEG (smaller still if it's a busy one), as base64. */
function smallJpeg(src: HTMLCanvasElement): string {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 240;
  c.getContext('2d')!.drawImage(src, 0, 0, 320, 240);
  let b64 = '';
  for (const q of [0.7, 0.55, 0.4, 0.25]) {
    b64 = c.toDataURL('image/jpeg', q).replace(/^data:image\/jpeg;base64,/, '');
    if (b64.length <= MAX_B64) break;
  }
  return b64;
}

/** A Polaroid: the photo, and under it who took it (their name on a dark tag in their colour) and when. */
function polaroid(img: CanvasImageSource, meta: PhotoMeta): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 340;
  c.height = 300;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fbf8f0';
  g.fillRect(0, 0, 340, 300);
  g.drawImage(img, 14, 14, 312, 234);
  g.font = 'italic 600 20px Georgia, serif';
  const name = meta.n || 'Friend';
  const w = Math.min(200, g.measureText(name).width + 34);
  g.fillStyle = '#2a1a12';
  g.beginPath();
  g.roundRect(14, 258, w, 30, 15);
  g.fill();
  g.fillStyle = `#${meta.c.toString(16).padStart(6, '0')}`;
  g.beginPath();
  g.arc(29, 273, 5, 0, Math.PI * 2);
  g.fill();
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillText(name, 40, 274, w - 32);
  g.fillStyle = '#5a4a3a';
  g.font = 'italic 18px Georgia, serif';
  g.textAlign = 'right';
  g.fillText(new Date(meta.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), 326, 274);
  return c;
}
