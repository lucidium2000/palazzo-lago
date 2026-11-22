import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { Quality } from './quality';

/**
 * Screen-space finishing for flat screens (WebXR renders directly):
 *  - ambient occlusion (desktop) so furniture sits in the room,
 *  - bloom so chandeliers, sconces, slot screens and the glass ceiling glow,
 *  - a warm grade and soft vignette.
 */
export class PostFX {
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private ao: GTAOPass | null = null;

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    q: Quality,
  ) {
    if (q.post === 'none') return;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.antialias ? 4 : 0 });
    const composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    if (q.post === 'full') {
      const ao = new GTAOPass(scene, camera, size.x, size.y);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.blendIntensity = 0.85;
      ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      // Glows, sprites and other see-through things must not occlude in the AO depth/normal pass.
      const vis = ao as unknown as { scene: THREE.Scene; _visibilityCache: THREE.Object3D[]; _overrideVisibility: () => void };
      vis._overrideVisibility = function () {
        const cache = this._visibilityCache;
        this.scene.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.Material | undefined;
          const see = (o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (m && !Array.isArray(m) && (m.transparent || m.blending === THREE.AdditiveBlending));
          if (see && o.visible) {
            o.visible = false;
            cache.push(o);
          }
        });
      };
      composer.addPass(ao);
      this.ao = ao;
    }
    const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), q.post === 'full' ? 0.26 : 0.2, 0.32, 1.25);
    composer.addPass(bloom);
    this.bloom = bloom;
    composer.addPass(new OutputPass());
    composer.addPass(new ShaderPass(GRADE));
    this.composer = composer;
  }

  get active() {
    return !!this.composer && !this.renderer.xr.isPresenting;
  }

  setSize(w: number, h: number) {
    if (!this.composer) return;
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom?.setSize((w * pr) / 2, (h * pr) / 2);
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    if (this.active) this.composer!.render();
    else this.renderer.render(scene, camera);
  }

  /** Lower cost when the frame rate drops (adaptive quality). */
  setLight(light: boolean) {
    if (this.ao) this.ao.enabled = !light;
  }
}

/** Warm grade, gentle contrast and a soft vignette (applied after tone mapping, in sRGB). */
const GRADE = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      // Gentle S-curve and warmth.
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
      col *= vec3(1.03, 1.0, 0.94);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, 1.08);
      vec2 d = vUv - 0.5;
      col *= 1.0 - smoothstep(0.35, 0.85, length(d * vec2(1.25, 1.0))) * 0.35;
      gl_FragColor = vec4(col, c.a);
    }`,
};
