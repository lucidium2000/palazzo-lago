import * as THREE from 'three';
import type { Session } from './session';
import type { LooseNet, LooseObjects } from '../loose';

/**
 * Two-player loose objects: every chip, bottle, napkin and bucket placed at
 * build time has the same id on both machines, so when your friend picks one
 * up it leaves the table on your side, you see it in their hand, and when
 * they throw it, it flies (and lands, and breaks) here too. Knocks they cause
 * arrive as throws; where things finally come to rest arrives as a put.
 */
export class LooseSync {
  private shown = new Map<string, { mesh: THREE.InstancedMesh; key: string }>();
  private prevExtra: Session['extraState'];

  constructor(
    private session: Session,
    private loose: LooseObjects,
    private scene: THREE.Scene,
  ) {
    loose.onNet = (e) => session.emit('loose', e);
    session.on('loose', (_f, d) => loose.remote(d as unknown as LooseNet));
    // Ride along with whatever else goes in the state (the drink in your hand).
    this.prevExtra = session.extraState;
    session.extraState = () => ({ ...(this.prevExtra?.() ?? {}), lo: loose.heldState() });
  }

  /** Puts what each friend is holding in their hand. */
  update() {
    const seen = new Set<string>();
    for (const f of this.session.friendList()) {
      seen.add(f.id);
      const lh = f.state.lo;
      let s = this.shown.get(f.id);
      const ok = Array.isArray(lh) && lh.length === 3 && lh.every((x) => Number.isFinite(x)) && f.person && !f.person.culled;
      if (!ok) {
        if (s) s.mesh.visible = false;
        continue;
      }
      const [kind, color, side] = lh as number[];
      const key = `${kind}:${color}`;
      if (!s || s.key !== key) {
        s?.mesh.removeFromParent();
        const mesh = this.loose.makeProxy(kind, color);
        if (!mesh) continue;
        this.scene.add(mesh);
        s = { mesh, key };
        this.shown.set(f.id, s);
      }
      const m = s.mesh;
      m.visible = true;
      const w = f.wrist(side === 0 ? 'l' : 'r');
      if (w && f.state.lw !== undefined) {
        // VR friend: just off their palm.
        m.position.copy(new THREE.Vector3(0, -0.05, -0.065).applyQuaternion(w.q).add(w.p)).add(new THREE.Vector3(0, -0.05, 0));
        m.rotation.set(0, f.person!.yaw, 0, 'YXZ');
      } else {
        const wr = f.person!.rig?.bones['WristR'];
        if (!wr) {
          m.visible = false;
          continue;
        }
        wr.getWorldPosition(m.position);
        m.position.y -= 0.05;
        m.rotation.set(0, f.person!.yaw, 0, 'YXZ');
      }
    }
    for (const [id, s] of this.shown)
      if (!seen.has(id)) {
        s.mesh.removeFromParent();
        this.shown.delete(id);
      }
  }

  dispose() {
    for (const s of this.shown.values()) s.mesh.removeFromParent();
    this.shown.clear();
    this.loose.onNet = null;
    this.session.extraState = this.prevExtra;
  }
}
