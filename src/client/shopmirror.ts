import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { inStore, STORE_FIX } from './areas/promenadeplan';
import { SEAT, WORN_SCALE, type Slot, type Worn } from './promenadelife';

/**
 * The boutique's full-length mirror (Lago Luxe, on the back wall): a real
 * reflection, so you can try on the sunglasses or a fedora and see how they
 * look. (net/mirror.ts is something else: the multiplayer game mirror.)
 *
 * It only exists while you're in the shop (one extra view of the room, per
 * eye in VR, and only when it's in sight). In the reflection you see your own
 * body with its head on, turned the way you're looking, wearing what you
 * have on; in your own view the head stays hidden (you look out of it), and
 * the sunglasses' tinted pane in front of your eyes isn't in the reflection.
 * On a screen your body isn't drawn at all, so it's posed just for the mirror.
 */

type Figure = { root: THREE.Object3D; bones: Record<string, THREE.Object3D | undefined> };

export interface ShopMirrorDeps {
  scene: THREE.Scene;
  camera: THREE.Camera;
  player: { inXR: boolean; feet(): THREE.Vector3 };
  /** Your body (selfbody.ts). */
  self: { figure: Figure | null; root: THREE.Object3D };
  wardrobe: { worn: Record<Slot, Worn | null>; shade: THREE.Object3D };
  loose: { kindOf(key: string): { index: number } | null; makeProxy(kindIndex: number, color: THREE.Color | number, scale?: number): THREE.InstancedMesh | null };
  /** Phones and headsets: a smaller reflection, no multisampling. */
  small: boolean;
}

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler(0, 0, 0, 'YXZ');

export class ShopMirror {
  readonly glass: Reflector;
  /** Rendered the reflection (how many times: tests). */
  renders = 0;
  /** What you have on, as meshes for the reflection: slot -> the worn thing they show. */
  private on: Record<Slot, { tag: string; mesh: THREE.Object3D } | null> = { eyes: null, head: null };
  private skinned = new WeakMap<Figure, THREE.SkinnedMesh[]>();

  constructor(private d: ShopMirrorDeps) {
    const mr = STORE_FIX.mirror;
    const tw = d.small ? 384 : 640;
    this.glass = new Reflector(new THREE.PlaneGeometry(mr.w, mr.h), {
      textureWidth: tw,
      textureHeight: Math.round((tw * mr.h) / mr.w),
      color: 0xc4c8cc,
      clipBias: 0.003,
      multisample: d.small ? 0 : 4,
    });
    this.glass.name = 'boutique-mirror';
    this.glass.position.set(mr.x, mr.y, mr.z);
    // Facing into the shop (-z).
    this.glass.rotation.y = Math.PI;
    this.glass.visible = false;
    this.glass.raycast = () => {};
    this.glass.userData.noLand = true;
    d.scene.add(this.glass);
    const reflect = this.glass.onBeforeRender;
    this.glass.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
      const undo = this.dressSelf();
      try {
        reflect.call(this.glass, renderer, scene, camera, geometry, material, group);
        this.renders++;
      } finally {
        undo();
      }
    };
  }

  /** On a screen: pose your body this frame, for the reflection (you're in front of the mirror). */
  get wantsSelf() {
    return this.glass.visible && !this.d.player.inXR;
  }

  update() {
    const f = this.d.player.feet();
    this.glass.visible = inStore(f.x, f.z);
  }

  /** The mesh for what's worn in a slot (made once per kind and colour). */
  private meshFor(slot: Slot): THREE.Object3D | null {
    const w = this.d.wardrobe.worn[slot];
    const tag = w ? `${w.key}:${w.color}` : '';
    const cur = this.on[slot];
    if (cur?.tag === tag) return cur.mesh;
    cur?.mesh.removeFromParent();
    this.on[slot] = null;
    if (!w) return null;
    const kind = this.d.loose.kindOf(w.key);
    const mesh = kind ? this.d.loose.makeProxy(kind.index, w.color, WORN_SCALE[slot]) : null;
    if (!mesh) return null;
    mesh.visible = false;
    this.d.scene.add(mesh);
    this.on[slot] = { tag, mesh };
    return mesh;
  }

  /**
   * Just for the reflection: your head back on and turned the way you look,
   * what you wear on it, your body shown (on a screen), the lens pane hidden.
   * Returns the undo, which puts it all back before your own view draws on.
   */
  private dressSelf(): () => void {
    const shade = this.d.wardrobe.shade;
    const shadeWas = shade.visible;
    shade.visible = false;
    const fig = this.d.self.figure;
    const meshes = (['eyes', 'head'] as Slot[]).map((s) => [s, this.meshFor(s)] as const);
    const showBody = !!fig && (this.d.player.inXR ? this.d.self.root.visible : true);
    if (!fig || !showBody) {
      return () => {
        shade.visible = shadeWas;
      };
    }
    const b = fig.bones;
    const neck = b.Neck,
      head = b.Head;
    const neckScale = neck?.scale.clone();
    const headQ = head?.quaternion.clone();
    const rootWas = this.d.self.root.visible;
    this.d.self.root.visible = true;
    neck?.scale.setScalar(1);
    // Where you're looking (the headset / your view), as a yaw and pitch.
    const dir = this.d.camera.getWorldDirection(tmpV);
    const yaw = Math.atan2(dir.x, dir.z);
    const pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    const bodyYaw = fig.root.rotation.y;
    if (head) {
      head.rotateY(Math.atan2(Math.sin(yaw - bodyYaw), Math.cos(yaw - bodyYaw)));
      head.rotateX(-pitch * 0.8);
    }
    fig.root.updateMatrixWorld(true);
    if (head) {
      const q = tmpQ.setFromEuler(tmpE.set(-pitch * 0.8, yaw, 0, 'YXZ'));
      for (const [slot, m] of meshes) {
        if (!m) continue;
        head.getWorldPosition(m.position);
        m.position.add(SEAT[slot].clone().multiplyScalar(fig.root.scale.x).applyQuaternion(q));
        m.quaternion.copy(q);
        m.visible = true;
        m.updateMatrixWorld();
      }
    }
    return () => {
      shade.visible = shadeWas;
      for (const [, m] of meshes) if (m) m.visible = false;
      if (neck && neckScale) neck.scale.copy(neckScale);
      if (head && headQ) head.quaternion.copy(headQ);
      this.d.self.root.visible = rootWas;
      fig.root.updateMatrixWorld(true);
      // The reflection's render posed the skin with the head on: back to your own view's pose.
      for (const sm of this.skins(fig)) sm.skeleton.update();
    };
  }

  private skins(fig: Figure): THREE.SkinnedMesh[] {
    let list = this.skinned.get(fig);
    if (!list) {
      list = [];
      fig.root.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) list!.push(o as THREE.SkinnedMesh);
      });
      this.skinned.set(fig, list);
    }
    return list;
  }

  dispose() {
    this.glass.removeFromParent();
    this.glass.dispose();
    for (const s of ['eyes', 'head'] as Slot[]) this.on[s]?.mesh.removeFromParent();
  }
}
