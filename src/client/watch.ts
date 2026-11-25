import * as THREE from 'three';
import type { Hands } from './hands';
import type { Interaction } from './interaction';
import { VERSION } from './version';

/**
 * A gold wristwatch on your left wrist (VR). Turn your wrist to look at it:
 * the face wakes up and shows the time, your chips and where your friends are
 * (an arrow, distance and area for each). Tap the face with your other index
 * finger to open the full menu. Hands first: no floating panels to summon.
 */

export interface WatchFriend {
  name: string;
  color: string;
  /** Bearing relative to where you face (radians, 0 = ahead, + = to your left). */
  bearing: number;
  distance: number;
  area?: string;
  talking?: boolean;
}

export interface WatchDeps {
  scene: THREE.Scene;
  camera: THREE.Camera;
  hands: Hands;
  interaction: Interaction;
  chips(): number;
  friends(): WatchFriend[];
  onTap(): void;
}

const FACE = 256;

export class Watch {
  readonly group = new THREE.Group();
  private face: THREE.Mesh;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private faceMat: THREE.MeshBasicMaterial;
  private redrawIn = 0;
  private awake = 0;

  constructor(private d: WatchDeps) {
    this.canvas.width = this.canvas.height = FACE;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 1, roughness: 0.28 });
    const strap = new THREE.MeshStandardMaterial({ color: 0x2a1610, roughness: 0.7 });
    // Case, bezel, a strap round the wrist, the crown.
    const caseM = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.008, 28).rotateX(Math.PI / 2), gold);
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.0205, 0.0016, 8, 32), gold);
    bezel.position.z = 0.004;
    // The strap: a band around the wrist (the group's Y axis runs along the forearm).
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.017, 24, 1, true), strap);
    band.material.side = THREE.DoubleSide;
    band.scale.set(1, 1, 0.78);
    band.position.z = -0.027;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.004, 10).rotateZ(Math.PI / 2), gold);
    crown.position.x = 0.023;
    this.faceMat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true });
    this.face = new THREE.Mesh(new THREE.CircleGeometry(0.019, 32), this.faceMat);
    this.face.position.z = 0.0042;
    this.group.add(caseM, bezel, band, crown, this.face);
    this.group.traverse((o) => {
      o.userData.noLand = true;
      if (o !== this.face) o.raycast = () => {};
    });
    this.group.visible = false;
    d.scene.add(this.group);
    // Tap the face (touch with your other index finger) for the menu.
    d.interaction.register({ object: this.face, kind: 'button', onSelect: () => d.onTap(), enabled: () => this.group.visible });
  }

  update(dt: number, inXR: boolean) {
    const w = inXR ? this.d.hands.wristPose('left') : null;
    this.group.visible = !!w;
    if (!w) return;
    // On the back of the wrist, a little up the forearm (wrist joint: -Z to the fingers, -Y out of the palm).
    const back = new THREE.Vector3(0, 1, 0).applyQuaternion(w.q);
    const up = new THREE.Vector3(0, 0, 1).applyQuaternion(w.q);
    this.group.position.copy(w.p).addScaledVector(back, 0.024).addScaledVector(up, 0.035);
    // Face looks out of the back of the wrist, 12 o'clock toward the fingers.
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(up.clone().negate(), back).normalize(), up.clone().negate(), back);
    this.group.quaternion.setFromRotationMatrix(m);
    // Raise to wake: brighter (and redrawn more often) when you look at it.
    const eye = this.d.camera.getWorldPosition(new THREE.Vector3());
    const toEye = eye.sub(this.group.position);
    const looking = toEye.length() < 0.7 && toEye.normalize().dot(back) > 0.55;
    this.awake += ((looking ? 1 : 0) - this.awake) * Math.min(1, dt * 8);
    this.faceMat.opacity = 0.45 + 0.55 * this.awake;
    this.redrawIn -= dt;
    if (this.redrawIn <= 0) {
      this.redrawIn = looking ? 0.25 : 2;
      this.draw(looking);
    }
  }

  private draw(bright: boolean) {
    const g = this.ctx;
    const c = FACE / 2;
    g.clearRect(0, 0, FACE, FACE);
    const bg = g.createRadialGradient(c, c * 0.8, 10, c, c, c);
    bg.addColorStop(0, bright ? '#1d1a2a' : '#0e0c14');
    bg.addColorStop(1, '#05040a');
    g.fillStyle = bg;
    g.beginPath();
    g.arc(c, c, c, 0, Math.PI * 2);
    g.fill();
    // Hour ticks.
    g.strokeStyle = '#d4a94e';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.lineWidth = i % 3 === 0 ? 5 : 2;
      g.beginPath();
      g.moveTo(c + Math.sin(a) * (c - 8), c - Math.cos(a) * (c - 8));
      g.lineTo(c + Math.sin(a) * (c - (i % 3 === 0 ? 24 : 16)), c - Math.cos(a) * (c - (i % 3 === 0 ? 24 : 16)));
      g.stroke();
    }
    const now = new Date();
    g.textAlign = 'center';
    g.fillStyle = '#f6e7c1';
    g.font = '700 40px Georgia, serif';
    g.fillText(now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), c, 82);
    g.fillStyle = '#d4a94e';
    g.font = '600 28px Georgia, serif';
    g.fillText('$' + Math.round(this.d.chips()).toLocaleString('en-US'), c, 118);
    // Friends: an arrow toward each (ahead = up), distance and where they are.
    const fr = this.d.friends().slice(0, 3);
    fr.forEach((f, i) => {
      const y = 150 + i * 34;
      const ax = 62;
      g.save();
      g.translate(ax, y - 8);
      g.rotate(-f.bearing);
      g.fillStyle = f.color;
      g.beginPath();
      g.moveTo(0, -12);
      g.lineTo(8, 8);
      g.lineTo(0, 3);
      g.lineTo(-8, 8);
      g.closePath();
      g.fill();
      g.restore();
      g.textAlign = 'left';
      g.fillStyle = f.talking ? '#ffffff' : '#e8dcc0';
      g.font = '600 20px Georgia, serif';
      const where = f.distance < 25 ? `${Math.round(f.distance)} m` : f.area ?? `${Math.round(f.distance)} m`;
      g.fillText(`${f.name.slice(0, 7)} ${where}`, ax + 16, y);
    });
    if (!fr.length) {
      g.textAlign = 'center';
      g.fillStyle = '#9c8f74';
      g.font = 'italic 18px Georgia, serif';
      g.fillText('tap for menu', c, 176);
    }
    // The build's version, small, at the bottom of the dial.
    g.textAlign = 'center';
    g.fillStyle = '#7d6f55';
    g.font = '600 15px Georgia, serif';
    g.fillText(VERSION, c, FACE - 20);
    this.tex.needsUpdate = true;
  }
}
