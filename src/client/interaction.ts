import * as THREE from 'three';
import { allLayers } from './cull';
import { replyPrompt } from './replyhud';

/**
 * One interaction path for every device. Games register Interactables; mouse
 * clicks, touch taps and VR controller/hand "select" all arrive as onSelect with
 * the same raycast hit. Games never know which device was used.
 */

export type InputSource = 'mouse' | 'touch' | 'xr';

export interface SelectEvent {
  hit: THREE.Intersection;
  source: InputSource;
  /** Local point on the interactable's object (handy for surfaces like the felt). */
  local: THREE.Vector3;
}

export interface Interactable {
  object: THREE.Object3D;
  kind?: 'button' | 'surface' | 'floor';
  /** A surface you can tap with a fingertip (e.g. a betting layout): pokes reach it whatever its size. */
  pokeable?: boolean;
  /**
   * A betting felt: only a deliberate point presses it (index finger out, the
   * other fingers curled, pushed into the cloth). An open hand, a palm or a
   * fist resting on it does nothing. A pointing finger over it hovers it.
   */
  felt?: boolean;
  onSelect?(e: SelectEvent): void;
  onHover?(e: SelectEvent | null): void;
  enabled?(): boolean;
  /** What a click/point would do, shown next to the crosshair (e.g. "Order a drink"). */
  label?: string | ((e: SelectEvent) => string | null);
}

/** An index fingertip this frame (VR). */
export interface Poker {
  id: 'left' | 'right';
  tip: THREE.Vector3;
  /** Index finger straight: presses buttons and menus. */
  extended: boolean;
  /** Pointing (index out, the other fingers curled): the only pose that presses a betting felt. */
  pointing?: boolean;
}

/** A pointing fingertip over a felt: the item, the spot under the tip, what it would bet, how high above. */
export interface FeltHover {
  item: Interactable;
  e: SelectEvent;
  label: string | null;
  height: number;
}

interface Pointer {
  ray: THREE.Ray;
  hovered: Interactable | null;
  lastHit: THREE.Intersection | null;
}

const HOVER_COLOR = 0xffe9a8;

interface ControllerEntry {
  ctrl: THREE.Group;
  pointer: Pointer;
  laser: THREE.Line;
  reticle: THREE.Mesh;
}

export class Interaction {
  private items: Interactable[] = [];
  private raycaster = new THREE.Raycaster();
  private mouse: Pointer = { ray: new THREE.Ray(), hovered: null, lastHit: null };
  private ndc = new THREE.Vector2();
  private pointerDown: { x: number; y: number; t: number; id: number } | null = null;
  private dragged = false;
  private controllers: ControllerEntry[] = [];
  private tmpMat = new THREE.Matrix4();
  /** Called with pixel deltas when the user drags on the desktop canvas (look around). */
  onDrag: ((dx: number, dy: number) => void) | null = null;
  /** Called with mouse deltas while the pointer is locked (first-person look). */
  onLook: ((dx: number, dy: number) => void) | null = null;

  private get locked() {
    return document.pointerLockElement === this.dom;
  }

  /** What the desktop crosshair or cursor is over right now, with its label. */
  hoverLabel(): string | null {
    const item = this.mouse.hovered;
    if (!item || !item.label || !this.mouse.lastHit) return null;
    if (typeof item.label === 'string') return item.label;
    return item.label(this.event(item, this.mouse.lastHit, 'mouse'));
  }

  constructor(
    private dom: HTMLElement,
    private camera: THREE.PerspectiveCamera,
    private renderer: THREE.WebGLRenderer,
    rig: THREE.Object3D,
  ) {
    this.raycaster.far = 30;
    // Things culled from view (cull.ts moves them to another layer) can still be pointed at.
    allLayers(this.raycaster);
    allLayers(this.pokeRay);
    dom.addEventListener('pointerdown', (e) => {
      this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
      this.dragged = false;
    });
    dom.addEventListener('pointermove', (e) => {
      if (this.locked) {
        this.onLook?.(e.movementX, e.movementY);
        this.ndc.set(0, 0);
        return;
      }
      if (this.pointerDown && this.pointerDown.id === e.pointerId) {
        const dx = e.clientX - this.pointerDown.x,
          dy = e.clientY - this.pointerDown.y;
        if (this.dragged || Math.hypot(dx, dy) > 6) {
          this.dragged = true;
          this.onDrag?.(e.movementX, e.movementY);
        }
      }
      this.setNdc(e);
    });
    dom.addEventListener('pointerup', (e) => {
      if (!this.pointerDown) return;
      this.pointerDown = null;
      if (this.dragged) return;
      if (this.locked) this.ndc.set(0, 0);
      else this.setNdc(e);
      this.updateMouseRay();
      const hit = this.cast(this.mouse);
      // In first-person mode you walk; clicking the floor does nothing.
      if (hit && !(this.locked && hit.item.kind === 'floor')) this.fire(hit, e.pointerType === 'touch' ? 'touch' : 'mouse');
    });
    dom.addEventListener('pointerleave', () => {
      this.pointerDown = null;
      this.setHover(this.mouse, null);
    });

    for (let i = 0; i < 2; i++) this.addController(i, rig);
  }

  register(item: Interactable): Interactable {
    item.kind ??= 'button';
    this.items.push(item);
    // Children already owned by another interactable (e.g. the felt inside a table) keep it.
    item.object.traverse((o) => (o.userData.interactable ??= item));
    return item;
  }

  unregister(item: Interactable) {
    this.items = this.items.filter((i) => i !== item);
  }

  private setNdc(e: PointerEvent) {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  private updateMouseRay() {
    // The view may have turned since the last render: use the current transform.
    this.camera.updateWorldMatrix(true, false);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.mouse.ray.copy(this.raycaster.ray);
  }

  private cast(p: Pointer): { item: Interactable; hit: THREE.Intersection } | null {
    this.raycaster.ray.copy(p.ray);
    const objs = this.items.filter((i) => i.object.visible && (i.enabled?.() ?? true)).map((i) => i.object);
    const hits = this.raycaster.intersectObjects(objs, true);
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      while (o && !o.userData.interactable) o = o.parent;
      if (o) {
        p.lastHit = hit;
        return { item: o.userData.interactable as Interactable, hit };
      }
    }
    p.lastHit = null;
    return null;
  }

  private event(item: Interactable, hit: THREE.Intersection, source: InputSource): SelectEvent {
    return { hit, source, local: item.object.worldToLocal(hit.point.clone()) };
  }

  private fire(r: { item: Interactable; hit: THREE.Intersection }, source: InputSource) {
    r.item.onSelect?.(this.event(r.item, r.hit, source));
  }

  private setHover(p: Pointer, r: { item: Interactable; hit: THREE.Intersection } | null, source: InputSource = 'mouse') {
    const next = r?.item ?? null;
    if (p.hovered && p.hovered !== next) p.hovered.onHover?.(null);
    p.hovered = next;
    if (r) r.item.onHover?.(this.event(r.item, r.hit, source));
  }

  private addController(index: number, rig: THREE.Object3D) {
    const ctrl = this.renderer.xr.getController(index);
    rig.add(ctrl);
    const laserGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
    const laser = new THREE.Line(
      laserGeo,
      new THREE.LineBasicMaterial({ color: 0xfff1c7, transparent: true, opacity: 0.7 }),
    );
    laser.scale.z = 5;
    laser.visible = false;
    ctrl.add(laser);
    const reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.008, 0.013, 24),
      new THREE.MeshBasicMaterial({ color: HOVER_COLOR, depthTest: false, transparent: true }),
    );
    reticle.renderOrder = 999;
    reticle.visible = false;
    rig.parent ? rig.parent.add(reticle) : rig.add(reticle);
    const pointer: Pointer = { ray: new THREE.Ray(), hovered: null, lastHit: null };
    const entry = { ctrl, pointer, laser, reticle };
    this.controllers.push(entry);
    ctrl.addEventListener('connected', (e: any) => {
      const mode = e.data?.targetRayMode;
      laser.visible = mode === 'tracked-pointer' || mode === 'transient-pointer' || !!e.data?.hand;
      ctrl.userData.connected = true;
      ctrl.userData.handedness = e.data?.handedness;
      ctrl.userData.gamepad = e.data?.gamepad;
      ctrl.userData.isHand = !!e.data?.hand;
    });
    // A hand pinch while a reply prompt is up answers the reply (replyhud.ts): it doesn't also press
    // whatever the laser points at, even when it's let go after the prompt has closed.
    ctrl.addEventListener('selectstart', () => {
      if (ctrl.userData.isHand && replyPrompt.busy()) ctrl.userData.suppressSelect = true;
    });
    ctrl.addEventListener('disconnected', () => {
      laser.visible = false;
      reticle.visible = false;
      ctrl.userData.connected = false;
      this.setHover(pointer, null);
    });
    ctrl.addEventListener('select', () => {
      // A pinch/trigger that grabbed something is not also a laser select.
      if (ctrl.userData.grabbing || ctrl.userData.suppressSelect) {
        ctrl.userData.suppressSelect = false;
        return;
      }
      // Hands only: with the lasers off, things are pressed by touch, not pointed at.
      if (!this.lasersOn()) return;
      this.updateControllerRay(entry);
      const r = this.cast(pointer);
      if (r) {
        this.fire(r, 'xr');
        this.pulse(ctrl, 0.4, 30);
      }
    });
  }

  controller(handedness: 'left' | 'right'): THREE.Group | undefined {
    return this.controllers.find((c) => c.ctrl.userData.handedness === handedness)?.ctrl;
  }

  gamepads(): { handedness: string; gamepad: Gamepad }[] {
    const out: { handedness: string; gamepad: Gamepad }[] = [];
    for (const c of this.controllers) {
      if (c.ctrl.userData.connected && c.ctrl.userData.gamepad) {
        out.push({ handedness: c.ctrl.userData.handedness, gamepad: c.ctrl.userData.gamepad });
      }
    }
    return out;
  }

  pulse(ctrl: THREE.Group, intensity: number, ms: number) {
    const gp = ctrl.userData.gamepad as Gamepad | undefined;
    (gp?.hapticActuators?.[0] as any)?.pulse?.(intensity, ms);
  }

  private updateControllerRay(c: ControllerEntry) {
    this.tmpMat.identity().extractRotation(c.ctrl.matrixWorld);
    c.pointer.ray.origin.setFromMatrixPosition(c.ctrl.matrixWorld);
    c.pointer.ray.direction.set(0, 0, -1).applyMatrix4(this.tmpMat);
  }

  /** Laser pointers on? (Off by default: real hands, touch and grab.) */
  lasersOn: () => boolean = () => true;
  /**
   * Fingertips that can press things by touch (VR): each frame the game says
   * where your index fingertips are, whether the index finger is straight
   * (`extended`: presses buttons and menus) and whether the hand is pointing
   * (`pointing`: index out, the other fingers curled; the only thing that
   * presses a betting felt).
   */
  pokers: (() => Poker[]) | null = null;
  /** A fingertip pressed something (buzz that hand). */
  onPoke: ((id: 'left' | 'right') => void) | null = null;
  /** A pointing finger is about to press a felt: false stops it (no chip to put down; say why). */
  feltGate: ((id: 'left' | 'right', item: Interactable, e: SelectEvent) => boolean) | null = null;
  /** A pointing finger pressed a felt (after its onSelect ran). */
  onFeltPoke: ((id: 'left' | 'right', item: Interactable, e: SelectEvent) => void) | null = null;
  private pokePrev = new Map<string, THREE.Vector3>();
  private pokeCool = new Map<string, number>();
  private pokeRay = new THREE.Raycaster();
  private tmpV = new THREE.Vector3();
  private feltBox = new Map<Interactable, { box: THREE.Box3; key: string }>();
  private hovering = new Map<'left' | 'right', FeltHover>();

  /** What a pointing fingertip is over (a felt just under it), per hand. */
  fingerHover(id: 'left' | 'right'): FeltHover | null {
    return this.hovering.get(id) ?? null;
  }

  /** Is a fingertip within reach of a betting felt (over the table, a hand's length above it)? */
  nearFelt(tip: THREE.Vector3, margin = 0.35): boolean {
    for (const i of this.items) {
      if (!i.felt || !i.object.visible || !(i.enabled?.() ?? true)) continue;
      // Cached, and measured again only if the felt moved (poker's follows your seat).
      const m = i.object.matrixWorld.elements;
      const key = `${m[12].toFixed(3)},${m[13].toFixed(3)},${m[14].toFixed(3)},${m[0].toFixed(3)}`;
      let c = this.feltBox.get(i);
      if (!c || c.key !== key) this.feltBox.set(i, (c = { box: new THREE.Box3().setFromObject(i.object), key }));
      const b = c.box;
      if (tip.x > b.min.x - margin && tip.x < b.max.x + margin && tip.z > b.min.z - margin && tip.z < b.max.z + margin && tip.y > b.min.y - 0.1 && tip.y < b.max.y + margin) return true;
    }
    return false;
  }

  /**
   * Touch to press: a fingertip that pushes into a button or a menu panel
   * (face first) presses it, at the spot it touched. Betting felts only take a
   * pointing finger pressed into the cloth; a pointing finger held over one
   * hovers the spot under it (the table shows a ghost chip there).
   */
  updatePokes() {
    const now = performance.now() / 1000;
    const seen = new Set<string>();
    for (const f of this.pokers?.() ?? []) {
      seen.add(f.id);
      const prev = this.pokePrev.get(f.id);
      this.pokePrev.set(f.id, f.tip.clone());
      this.updateFeltHover(f);
      if (!prev || !f.extended || now < (this.pokeCool.get(f.id) ?? 0)) continue;
      const move = f.tip.clone().sub(prev);
      const len = move.length();
      if (len < 0.002 || len > 0.25) continue;
      const dir = move.divideScalar(len);
      // Buttons and panels near the fingertip only; felts only for a pointing hand.
      const near = this.items.filter((i) => {
        if (!i.object.visible || !(i.enabled?.() ?? true)) return false;
        if (i.felt) return !!f.pointing;
        if (i.pokeable) return true;
        if (i.kind === 'surface' || i.kind === 'floor') return false;
        // Big things (a whole counter, a table) aren't buttons to poke.
        const r = (i.object.userData.pokeR ??= new THREE.Box3().setFromObject(i.object).getBoundingSphere(new THREE.Sphere()).radius) as number;
        if (r > 0.8) return false;
        return i.object.getWorldPosition(this.tmpV).distanceTo(f.tip) < 1.2;
      });
      if (!near.length) continue;
      this.pokeRay.set(prev.clone().addScaledVector(dir, -0.01), dir);
      this.pokeRay.far = len + 0.022;
      const hits = this.pokeRay.intersectObjects(
        near.map((i) => i.object),
        true,
      );
      for (const hit of hits) {
        let o: THREE.Object3D | null = hit.object;
        while (o && !o.userData.interactable) o = o.parent;
        if (!o) continue;
        const item = o.userData.interactable as Interactable;
        // A felt hit through a hand-sized table group may be another interactable's mesh: only the felt's own.
        if (!near.includes(item)) continue;
        const n = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld);
        // Pressing into the face (not grazing along it, not from behind). A felt wants a press, not a brush.
        if (n && Math.abs(n.dot(dir)) < (item.felt ? 0.55 : 0.3)) continue;
        this.pokeCool.set(f.id, now + 0.4);
        const e = this.event(item, hit, 'xr');
        if (item.felt && this.feltGate && !this.feltGate(f.id, item, e)) break;
        item.onSelect?.(e);
        this.onPoke?.(f.id);
        if (item.felt) this.onFeltPoke?.(f.id, item, e);
        break;
      }
    }
    for (const id of ['left', 'right'] as const) if (!seen.has(id)) this.setFingerHover(id, null);
  }

  /** The felt just under a pointing fingertip (straight down, a few cm), hovered. */
  private updateFeltHover(f: Poker) {
    let next: FeltHover | null = null;
    if (f.pointing) {
      const felts = this.items.filter((i) => i.felt && i.object.visible && (i.enabled?.() ?? true));
      if (felts.length && this.nearFelt(f.tip, 0.05)) {
        this.pokeRay.set(f.tip.clone().setY(f.tip.y + 0.01), new THREE.Vector3(0, -1, 0));
        this.pokeRay.far = 0.13;
        for (const hit of this.pokeRay.intersectObjects(
          felts.map((i) => i.object),
          true,
        )) {
          let o: THREE.Object3D | null = hit.object;
          while (o && !o.userData.interactable) o = o.parent;
          const item = o?.userData.interactable as Interactable | undefined;
          if (!item || !felts.includes(item)) continue;
          const e = this.event(item, hit, 'xr');
          const label = typeof item.label === 'function' ? item.label(e) : (item.label ?? null);
          next = { item, e, label, height: f.tip.y - hit.point.y };
          break;
        }
      }
    }
    this.setFingerHover(f.id, next);
  }

  private setFingerHover(id: 'left' | 'right', next: FeltHover | null) {
    const was = this.hovering.get(id) ?? null;
    if (was && was.item !== next?.item) was.item.onHover?.(null);
    if (next) {
      this.hovering.set(id, next);
      next.item.onHover?.(next.e);
    } else this.hovering.delete(id);
  }

  /** Per-frame hover update for mouse and VR pointers. */
  update() {
    if (this.renderer.xr.isPresenting) {
      this.updatePokes();
      for (const c of this.controllers) {
        if (!c.ctrl.userData.connected) continue;
        this.updateControllerRay(c);
        if (c.ctrl.userData.grabbing || c.ctrl.userData.nearGrab || !this.lasersOn()) {
          // Hand is busy holding or reaching for something: hide the laser.
          c.laser.visible = false;
          c.reticle.visible = false;
          this.setHover(c.pointer, null, 'xr');
          continue;
        }
        c.laser.visible = !!c.ctrl.userData.connected;
        const r = this.cast(c.pointer);
        this.setHover(c.pointer, r, 'xr');
        if (r) {
          c.laser.scale.z = r.hit.distance;
          c.reticle.visible = true;
          c.reticle.position.copy(r.hit.point);
          const n = r.hit.face?.normal.clone().transformDirection(r.hit.object.matrixWorld) ?? new THREE.Vector3(0, 1, 0);
          c.reticle.lookAt(r.hit.point.clone().add(n));
          c.reticle.position.addScaledVector(n, 0.002);
          c.reticle.scale.setScalar(Math.max(1, r.hit.distance * 0.6));
        } else {
          c.laser.scale.z = 5;
          c.reticle.visible = false;
        }
      }
    } else if (!this.pointerDown) {
      this.updateMouseRay();
      const r = this.cast(this.mouse);
      this.setHover(this.mouse, r);
      this.dom.style.cursor = this.locked ? 'none' : r && r.item.kind !== 'floor' ? 'pointer' : r ? 'crosshair' : 'grab';
    }
  }
}

/** Gives a mesh a gentle highlight on hover (emissive lift). */
export function hoverGlow(mesh: THREE.Mesh, amount = 0.25): (e: SelectEvent | null) => void {
  const mat = mesh.material as THREE.MeshStandardMaterial;
  const base = mat.emissive?.clone() ?? new THREE.Color(0);
  const baseIntensity = mat.emissiveIntensity ?? 1;
  return (e) => {
    if (!mat.emissive) return;
    if (e) {
      mat.emissive.set(HOVER_COLOR);
      mat.emissiveIntensity = amount;
    } else {
      mat.emissive.copy(base);
      mat.emissiveIntensity = baseIntensity;
    }
  };
}
