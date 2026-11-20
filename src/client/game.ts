import type * as THREE from 'three';
import type { Bankroll } from '../rules/bankroll';
import type { Rng } from '../rules/rng';
import type { Sound } from './audio';
import type { Hud } from './hud';
import type { Interaction } from './interaction';
import type { Quality } from './quality';

/** Everything a game station needs from the app. */
export interface GameContext {
  scene: THREE.Scene;
  interaction: Interaction;
  sound: Sound;
  bankroll: Bankroll;
  hud: Hud;
  rng: Rng;
  quality: Quality;
}

/** Simple time-based tweens for game animations. */
export class Tweens {
  private list: { t: number; dur: number; fn: (k: number) => void; done?: () => void }[] = [];
  add(dur: number, fn: (k: number) => void, done?: () => void) {
    this.list.push({ t: 0, dur, fn, done });
  }
  update(dt: number) {
    for (const tw of [...this.list]) {
      tw.t = Math.min(tw.dur, tw.t + dt);
      tw.fn(tw.t / tw.dur);
      if (tw.t >= tw.dur) {
        this.list.splice(this.list.indexOf(tw), 1);
        tw.done?.();
      }
    }
  }
}

export const easeOut = (k: number) => 1 - (1 - k) ** 3;
export const easeInOut = (k: number) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);
export const money = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
