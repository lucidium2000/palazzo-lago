import * as THREE from 'three';
import { assets, spawnCharacter } from '../assets';
import { lookPaint, type Look } from '../people';

/** The characters a player can be. Index is what travels over the network. */
export const AVATARS: { kind: string; label: string; height: number; dress: boolean }[] = [
  { kind: 'male_suit', label: 'The Closer', height: 1.82, dress: false },
  { kind: 'female_formal', label: 'Evening Gown', height: 1.7, dress: true },
  { kind: 'male_casual_2', label: 'Night Out', height: 1.8, dress: false },
  { kind: 'female_suit', label: 'Power Suit', height: 1.72, dress: true },
  { kind: 'male_beach', label: 'Pool Party', height: 1.78, dress: false },
  { kind: 'female_casual', label: 'Weekend Vibes', height: 1.68, dress: true },
];

/** Each avatar's outfit (the same on every screen: only the index travels). */
const OUTFITS: Omit<Look, 'kind' | 'dress' | 'height' | 'hairStyle'>[] = [
  // The Closer: midnight-navy suit, white shirt, burgundy silk tie, gold watch.
  { main: 0x141a2c, second: 0xf4f2ec, accent: 0x4e1220, accentSurf: 'silk', topSurf: 'wool', bottomSurf: 'wool', shoes: 0x0c0a09, shoeSurf: 'leather', skin: 0xd29b74, hair: 0x2e1f15, jewel: 0xd8b46a, glint: true },
  // Evening Gown: deep emerald satin, gold necklace that catches the light.
  { main: 0x0c4030, second: 0x0c4030, topSurf: 'satin', bottomSurf: 'satin', shoes: 0x0c0b0b, shoeSurf: 'patent', skin: 0xe2b08c, hair: 0x45301f, jewel: 0xd8b46a, glint: true, lipstick: 0x8a1e28 },
  // Night Out: black tee, dark denim, white sneakers.
  { main: 0x121214, second: 0x121214, bottom: 0x1b2030, topSurf: 'cotton', bottomSurf: 'denim', shoes: 0xeceae4, shoeSurf: 'cotton', skin: 0x8e5a3a, hair: 0x120d0b, jewel: 0xd4d4da },
  // Power Suit: ivory suit over a black silk camisole.
  { main: 0xe4dccc, second: 0x0e0e10, shirtSurf: 'silk', topSurf: 'wool', bottomSurf: 'wool', shoes: 0x0c0b0b, shoeSurf: 'patent', skin: 0xc08660, hair: 0x1e1510, jewel: 0xd8b46a, glint: true, lipstick: 0x9a4a4a },
  // Pool Party: sea-blue resort shirt, white shorts, flip-flops.
  { main: 0x2f747c, second: 0x2f747c, bottom: 0xece8de, accent: 0xece8de, topSurf: 'silk', bottomSurf: 'cotton', shoes: 0x4a3020, shoeSurf: 'rubber', skin: 0xecc4a6, hair: 0xb8955e, jewel: 0xd8b46a },
  // Weekend Vibes: blush silk top, white linen trousers.
  { main: 0xd8b0a8, second: 0xd8b0a8, bottom: 0xefebe2, topSurf: 'silk', bottomSurf: 'cotton', shoes: 0xb88e70, shoeSurf: 'leather', skin: 0x70432a, hair: 0x1e1510, jewel: 0xd8b46a },
];

export function avatarLook(i: number): Look {
  const k = ((i % AVATARS.length) + AVATARS.length) % AVATARS.length;
  const a = AVATARS[k];
  return { ...OUTFITS[k], kind: a.kind, dress: a.dress, hairStyle: a.dress ? 'long' : 'short', height: a.height };
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
    const rig = spawnCharacter(assets.people, a.kind, lookPaint(avatarLook(i)));
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
