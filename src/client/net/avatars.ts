import * as THREE from 'three';
import { assets, spawnCharacter } from '../assets';
import type { Look } from '../people';

/** The characters a player can be. Index is what travels over the network. */
export const AVATARS: { kind: string; label: string; height: number; dress: boolean }[] = [
  { kind: 'male_suit', label: 'The Closer', height: 1.82, dress: false },
  { kind: 'female_formal', label: 'Evening Gown', height: 1.7, dress: true },
  { kind: 'male_casual_2', label: 'Night Out', height: 1.8, dress: false },
  { kind: 'female_suit', label: 'Power Suit', height: 1.72, dress: true },
  { kind: 'male_beach', label: 'Pool Party', height: 1.78, dress: false },
  { kind: 'female_casual', label: 'Weekend Vibes', height: 1.68, dress: true },
];

export function avatarLook(i: number): Look {
  const a = AVATARS[((i % AVATARS.length) + AVATARS.length) % AVATARS.length];
  return { kind: a.kind, dress: a.dress, main: 0x1a1d2a, second: 0xf4f0e8, skin: 0xe0ac86, hair: 0x2e1d12, hairStyle: a.dress ? 'long' : 'short', height: a.height };
}

/**
 * A small turntable that shows the chosen character on the start screen.
 * Uses its own little renderer on a canvas in the card.
 */
export class AvatarPreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  private rig: ReturnType<typeof spawnCharacter> | null = null;
  private clock = new THREE.Clock();
  private raf = 0;
  private spin = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.add(new THREE.HemisphereLight(0xffe8c8, 0x3a2018, 1.6));
    const key = new THREE.DirectionalLight(0xfff0d8, 2.2);
    key.position.set(1.5, 3, 2.5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffc070, 1.4);
    rim.position.set(-2, 2, -2);
    this.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.55, 40), new THREE.MeshBasicMaterial({ color: 0xd4a94e, transparent: true, opacity: 0.25 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.camera.position.set(0, 1.15, 4.1);
    this.camera.lookAt(0, 0.9, 0);
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.render();
    };
    loop();
  }

  show(i: number) {
    if (!assets.people) return;
    if (this.rig) this.scene.remove(this.rig.root);
    const a = AVATARS[i];
    const rig = spawnCharacter(assets.people, a.kind);
    rig.root.scale.setScalar(a.height / (a.dress ? 1.72 : 1.82));
    for (const [name, act] of Object.entries(rig.actions)) {
      act.play();
      act.setEffectiveWeight(name === 'Wave' ? 1 : name === 'Idle_Neutral' ? 0 : 0);
    }
    // Wave hello, then settle into idle.
    setTimeout(() => {
      if (this.rig !== rig) return;
      for (const [name, act] of Object.entries(rig.actions)) act.setEffectiveWeight(name === 'Idle_Neutral' ? 1 : 0);
    }, 1600);
    this.scene.add(rig.root);
    this.rig = rig;
    this.spin = 0;
  }

  private render() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    if (w && h && (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio()) || this.canvas.height !== Math.round(h * this.renderer.getPixelRatio()))) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (this.rig) {
      this.rig.mixer.update(dt);
      this.spin += dt;
      this.rig.root.rotation.y = Math.sin(this.spin * 0.6) * 0.5;
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
