import * as THREE from 'three';

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
  onSelect?(e: SelectEvent): void;
  onHover?(e: SelectEvent | null): void;
  enabled?(): boolean;
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

  constructor(
    private dom: HTMLElement,
    private camera: THREE.PerspectiveCamera,
    private renderer: THREE.WebGLRenderer,
    rig: THREE.Object3D,
  ) {
    this.raycaster.far = 30;
    dom.addEventListener('pointerdown', (e) => {
      this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
      this.dragged = false;
    });
    dom.addEventListener('pointermove', (e) => {
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
      this.setNdc(e);
      this.updateMouseRay();
      const hit = this.cast(this.mouse);
      if (hit) this.fire(hit, e.pointerType === 'touch' ? 'touch' : 'mouse');
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
    });
    ctrl.addEventListener('disconnected', () => {
      laser.visible = false;
      reticle.visible = false;
      ctrl.userData.connected = false;
      this.setHover(pointer, null);
    });
    ctrl.addEventListener('select', () => {
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

  /** Per-frame hover update for mouse and VR pointers. */
  update() {
    if (this.renderer.xr.isPresenting) {
      for (const c of this.controllers) {
        if (!c.ctrl.userData.connected) continue;
        this.updateControllerRay(c);
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
      this.dom.style.cursor = r && r.item.kind !== 'floor' ? 'pointer' : r ? 'crosshair' : 'grab';
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
