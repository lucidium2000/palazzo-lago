import * as THREE from 'three';
import { Health, type Blow } from './health';

/**
 * Your health in a fight, and what getting hit feels like: a red flash round
 * the edge of your view (never over the middle of it), a thud, a buzz in both
 * hands. At zero you're knocked out: the world fades to black and goes muffled
 * with a ringing in your ears, then fades back a few seconds later, health
 * restored. Nothing ever moves or turns your view (comfort in VR): you come
 * round exactly where you went down.
 */

export const KO_SECONDS = 5.5;

export interface YouDeps {
  camera: THREE.Camera;
  listener: THREE.AudioListener | null;
  /** Buzz both controllers. */
  haptic(strength: number, ms: number): void;
  /** Keep you where you are while you're out. */
  setStunned(on: boolean): void;
}

export class You {
  readonly health = new Health(100);
  /** Fires when you're knocked out, and when you come round. */
  onKO: (() => void) | null = null;
  onWake: (() => void) | null = null;
  private flash: THREE.Mesh;
  private flashMat: THREE.MeshBasicMaterial;
  private black: THREE.Mesh;
  private blackMat: THREE.MeshBasicMaterial;
  private flashA = 0;
  /** The flash pushed toward one side (a slap), metres at the flash plane; settles back to the middle. */
  private flashX = 0;
  private dark = 0;
  private filter: BiquadFilterNode | null = null;
  private ring: {
    osc: OscillatorNode;
    osc2: OscillatorNode;
    gain: GainNode;
  } | null = null;
  /** Seconds out cold so far (for the fade timing). */
  private outT = 0;
  private filtered = false;

  constructor(private d: YouDeps) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    // Clear in the middle, red round the edge: you still see what's coming.
    const grad = g.createRadialGradient(64, 64, 26, 64, 64, 90);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    this.flashMat = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(c),
      color: 0xb00010,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), this.flashMat);
    this.flash.position.z = -0.11;
    this.flash.renderOrder = 2001;
    this.flash.visible = false;
    this.flash.raycast = () => {};
    this.flash.userData.noLand = true;
    d.camera.add(this.flash);
    this.blackMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this.black = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 8), this.blackMat);
    this.black.renderOrder = 9998;
    this.black.frustumCulled = false;
    this.black.visible = false;
    this.black.raycast = () => {};
    this.black.userData.noLand = true;
    d.camera.add(this.black);
  }

  get out() {
    return this.health.ko;
  }

  /** You got hit. `strength` of the flash/buzz follows the damage. */
  hurt(b: Blow): { dmg: number; ko: boolean } {
    const r = this.health.take(b, KO_SECONDS);
    const k = Math.min(1, r.dmg / 18);
    this.flashA = Math.min(0.55, this.flashA + (b.blocked ? 0.08 : 0.18 + 0.3 * k));
    this.d.haptic(b.blocked ? 0.3 : 0.45 + 0.55 * k, b.blocked ? 50 : 90 + 60 * k);
    if (r.ko) this.knockOut();
    return r;
  }

  /**
   * A slap's sting on one side of your face: the red edge flares on that side
   * (then settles back round the whole edge).
   */
  sting(side: 'left' | 'right', power: number) {
    this.flashA = Math.min(0.6, this.flashA + 0.12 + 0.2 * power);
    // (Moving the clear middle away from a side brings the red in on that side.)
    this.flashX = (side === 'left' ? 1 : -1) * (0.04 + 0.03 * power);
  }

  /** Knocked out by something else (a friend in a boxing match). */
  private knockOut() {
    this.outT = 0;
    this.d.setStunned(true);
    this.d.haptic(1, 260);
    this.startMuffle();
    this.onKO?.();
  }

  update(dt: number, inCombat: boolean) {
    const wasOut = this.health.ko;
    const woke = this.health.update(dt, inCombat);
    if (wasOut) this.outT += dt;
    if (woke) {
      this.d.setStunned(false);
      this.stopMuffle();
      this.onWake?.();
    }
    // Black: in over ~0.9 s, held, out over the last 1.5 s.
    if (this.health.ko) {
      const left = this.health.out;
      this.dark = left < 1.5 ? Math.min(this.dark, left / 1.5) : Math.min(1, this.dark + dt / 0.9);
    } else this.dark = Math.max(0, this.dark - dt / 0.6);
    this.blackMat.opacity = this.dark;
    this.black.visible = this.dark > 0.005;
    this.flashA = Math.max(0, this.flashA - dt * 1.8);
    this.flashX *= Math.max(0, 1 - dt * 3);
    this.flash.position.x = this.flashX;
    // Hurt and low: a faint red edge that stays.
    const low = this.health.ko ? 0 : Math.max(0, 0.35 - this.health.fraction) * 0.6;
    const a = Math.max(this.flashA, low);
    this.flashMat.opacity = a;
    this.flash.visible = a > 0.01;
    if (this.ring) {
      // The ringing fades as you come round.
      const g = this.health.ko ? 0.035 * Math.max(0.25, Math.min(1, this.health.out / KO_SECONDS + 0.2)) : 0;
      this.ring.gain.gain.value += (g - this.ring.gain.gain.value) * Math.min(1, dt * 3);
      if (!this.health.ko && this.ring.gain.gain.value < 0.001) this.stopRing();
    }
    if (this.filter && this.health.ko) {
      // Muffled most while you're out cold, opening up as you come back.
      const f = this.health.out < 1.5 ? 350 + (1 - this.health.out / 1.5) * 6000 : 350;
      this.filter.frequency.value = f;
    }
  }

  private startMuffle() {
    const l = this.d.listener;
    if (!l) return;
    try {
      const ctx = l.context;
      if (l.getFilter()) return; // underwater already: that'll do
      this.filter ??= Object.assign(ctx.createBiquadFilter(), {
        type: 'lowpass' as BiquadFilterType,
      });
      this.filter.frequency.value = 350;
      l.setFilter(this.filter);
      this.filtered = true;
      // A high ringing in your ears (two close tones beating), straight to the output.
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const osc = ctx.createOscillator();
      osc.frequency.value = 3400;
      const osc2 = ctx.createOscillator();
      osc2.frequency.value = 3407;
      osc.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc2.start();
      this.ring = { osc, osc2, gain };
    } catch {
      /* audio not running */
    }
  }

  private stopMuffle() {
    const l = this.d.listener;
    if (l && this.filtered) {
      try {
        if (l.getFilter() === this.filter) l.removeFilter();
      } catch {
        /* nothing to remove */
      }
    }
    this.filtered = false;
  }

  private stopRing() {
    if (!this.ring) return;
    try {
      this.ring.osc.stop();
      this.ring.osc2.stop();
      this.ring.gain.disconnect();
    } catch {
      /* already stopped */
    }
    this.ring = null;
  }

  dispose() {
    this.stopMuffle();
    this.stopRing();
    this.flash.removeFromParent();
    this.black.removeFromParent();
  }
}
