import * as THREE from 'three';
import type { Item, LooseObjects } from './loose';
import type { Throwables } from './throwables';
import type { DrinkPhysics } from './drinkphysics';
import type { Sound } from './audio';
import type { Crowd, Person } from './people';

/**
 * Cocktail napkins do what napkins do. Rub one over a spill and it wipes up
 * (the napkin takes the drink's colour). Hold one to your face and wipe after
 * a splash to clear your eyes. Dab someone you soaked and they calm down
 * (they stop glaring at you). A napkin left lying in a puddle soaks it up
 * slowly.
 */
export interface NapkinDeps {
  loose: LooseObjects;
  throwables: Throwables;
  drinkPhysics: DrinkPhysics;
  sound: Sound;
  crowd: Crowd;
  camera: THREE.Camera;
  /** Someone you dabbed with a napkin (after soaking them). */
  onDab?(p: Person): void;
}

const WHITE = new THREE.Color(1, 1, 1);

export class Napkins {
  private last = new Map<string, THREE.Vector3>();
  private squeak = 0;
  private dabbed = new WeakMap<Person, number>();
  private time = 0;
  private tmp = new THREE.Vector3();
  private eye = new THREE.Vector3();

  constructor(private d: NapkinDeps) {}

  update(dt: number) {
    this.time += dt;
    this.squeak -= dt;
    this.d.camera.getWorldPosition(this.eye);
    for (const it of this.d.loose.items.values()) {
      if (it.gone || it.kind.key !== 'napkin') continue;
      const held = !!it.proxy && (it.holder === 'vr' || it.holder === 'desk');
      const at = held ? it.proxy!.getWorldPosition(this.tmp) : this.tmp.copy(it.body.pos);
      const prev = this.last.get(it.id);
      const moved = prev ? prev.distanceTo(at) : 0;
      if (prev) prev.copy(at);
      else this.last.set(it.id, at.clone());
      if (held) {
        // Rubbing (moving while held): what's under it wipes up fast.
        if (moved > 0.002) this.wipeAt(it, at, Math.min(0.5, moved * 6), 0.06);
        // Your face (wiping after a splash).
        if (moved > 0.002 && at.distanceTo(this.eye) < 0.16 && this.d.drinkPhysics.wipeFace(dt * 3)) this.rub(at);
        // Dabbing someone (their head and shoulders).
        if (moved > 0.003) {
          const who = this.d.drinkPhysics.personAt(at);
          if (who && (this.dabbed.get(who) ?? -9) < this.time - 4) {
            this.dabbed.set(who, this.time);
            this.d.onDab?.(who);
            this.rub(at);
          }
        }
      } else if (!it.body.awake) {
        // Left lying in a puddle: soaks it up slowly.
        this.wipeAt(it, at, dt * 0.08, 0.04, true);
      }
    }
  }

  private wipeAt(it: Item, at: THREE.Vector3, k: number, r: number, quiet = false) {
    // Look a little under the napkin (it's held just above the table).
    const got = this.d.throwables.wipe(at.clone().setY(at.y - 0.02), r, k);
    if (got === null) return;
    // It stains, more with every wipe.
    it.color.lerp(new THREE.Color(got).lerp(WHITE, 0.25), Math.min(0.35, k * 1.5));
    this.d.loose.recolor(it as Item);
    if (!quiet) this.rub(at);
  }

  private rub(at: THREE.Vector3) {
    if (this.squeak > 0) return;
    this.squeak = 0.35;
    this.d.sound.play('thunk', at, { volume: 0.08, rate: 2.6 + Math.random() * 0.6 });
  }
}
