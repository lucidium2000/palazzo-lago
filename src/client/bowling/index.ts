import type * as THREE from 'three';
import type { Sound } from '../audio';
import type { Hands } from '../hands';
import type { Interaction } from '../interaction';
import type { Crowd, Person } from '../people';
import type { Player } from '../player';
import type { Quality } from '../quality';
import type { Mats } from '../areas/kit';
import { buildAlley, registerBowling, type Alley } from './alley';
import { Bowling } from './game';

export { registerBowling } from './alley';
export * from './plan';

/** Palazzo Lanes: the room (alley.ts) and the game in it (game.ts). */
export interface BowlingArea {
  alley: Alley;
  game: Bowling;
  update(dt: number, feet: THREE.Vector3): void;
  populate(crowd: Crowd, budget: number): Person[];
}

export function buildBowling(deps: { scene: THREE.Scene; q: Quality; m: Mats; interaction: Interaction; sound: Sound; player: Player; hands: Hands; dom: HTMLElement; toast: (t: string) => void }): BowlingArea {
  const alley = buildAlley(deps.scene, deps.q, deps.m);
  const game = new Bowling({ scene: deps.scene, q: deps.q, alley, interaction: deps.interaction, player: deps.player, hands: deps.hands, sound: deps.sound, toast: deps.toast, dom: deps.dom });
  return {
    alley,
    game,
    update: (dt, feet) => game.update(dt, feet),
    populate: (crowd, budget) => game.populate(crowd, budget),
  };
}
void registerBowling;
