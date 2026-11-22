import * as THREE from 'three';
import type { Bankroll } from '../rules/bankroll';
import type { Sound } from './audio';
import type { Crew } from './crew';
import { money } from './game';
import type { Goal, Hud } from './hud';
import type { Crowd } from './people';

/**
 * The shape of a night out: goals to tick off, hot streaks, and big-win
 * celebrations (banner, confetti, the crowd and the boys going wild).
 */

export type GoalId = 'roulette' | 'bonus' | 'round' | 'tip' | 'finale' | 'up1k';

const GOALS: Record<GoalId, string> = {
  roulette: 'Win a spin at roulette',
  bonus: 'Hit a slot bonus',
  round: 'Buy the boys a round',
  tip: 'Tip the piano man',
  finale: 'Catch the fountain finale outside',
  up1k: 'Be up $1,000 on the night',
};

export class Night {
  private done = new Set<GoalId>();
  private streak = 0;
  private startBalance: number;
  private confetti: Confetti;

  constructor(
    scene: THREE.Scene,
    private hud: Hud,
    private sound: Sound,
    private crew: Crew,
    private crowd: Crowd,
    private bankroll: Bankroll,
  ) {
    this.startBalance = bankroll.balance;
    this.confetti = new Confetti(scene);
    bankroll.onChange((c) => {
      // Free chips (daily bonus, a reset) don't count as being up on the night.
      if (c.reason === 'daily-bonus' || c.reason === 'reset') {
        this.startBalance = this.bankroll.balance;
        return;
      }
      if (this.bankroll.balance >= this.startBalance + 1000) this.complete('up1k');
    });
    this.render();
  }

  /** Measure "up on the night" from here (after the daily bonus is paid). */
  resetBaseline() {
    this.startBalance = this.bankroll.balance;
  }

  goals(): Goal[] {
    return (Object.keys(GOALS) as GoalId[]).map((id) => ({ id, label: GOALS[id], done: this.done.has(id) }));
  }

  private render() {
    this.hud.setGoals(this.goals());
  }

  complete(id: GoalId) {
    if (this.done.has(id)) return;
    this.done.add(id);
    this.render();
    const n = this.done.size,
      total = Object.keys(GOALS).length;
    this.sound.play('bonus', undefined, { volume: 0.5 });
    if (n === total) {
      this.hud.banner('LEGENDARY NIGHT', 'Every goal done. The boys will talk about this for years.');
      this.crew.react('legend', { force: true });
    } else {
      this.hud.toast(`Tonight ${n}/${total}: ${GOALS[id]} ✓`, 'win');
      if (id !== 'round' && id !== 'tip' && id !== 'finale') this.crew.react('goal', { chance: 0.5 });
    }
  }

  /** A game finished. `at` is where to throw the confetti. */
  result(game: 'roulette' | 'slots', staked: number, returned: number, at: THREE.Vector3) {
    if (staked === 0 && returned === 0) return;
    const win = staked === 0 ? returned > 0 : returned >= staked && returned > 0;
    const big = returned >= Math.max(staked * 10, 500) || returned - staked >= 1000;
    if (win) {
      this.streak++;
      if (game === 'roulette') this.complete('roulette');
    } else {
      this.streak = 0;
    }
    if (big) {
      this.hud.banner('BIG WIN', money(returned));
      this.confetti.burst(at.clone().setY(at.y + 1.2), 220);
      this.crowd.react(at, 4, 'cheer');
      this.sound.play('cheer', at, { volume: 1 });
      this.crew.react('bigwin', { force: true });
    } else if (win && this.streak === 3) {
      this.hud.banner('ON FIRE', 'Three wins in a row');
      this.confetti.burst(at.clone().setY(at.y + 1.2), 90);
      this.crew.react('streak', { force: true });
    } else if (win) {
      this.crew.react('win', { chance: 0.45 });
    } else if (staked >= 200) {
      this.crew.react('bigloss', { chance: 0.8 });
    } else {
      this.crew.react('loss', { chance: 0.22 });
    }
  }

  update(dt: number) {
    this.confetti.update(dt);
  }
}

/** Gold, red and white confetti: one instanced draw, simulated on the CPU. */
class Confetti {
  private mesh: THREE.InstancedMesh;
  private parts: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; life: number }[] = [];
  private tmp = new THREE.Object3D();
  private max = 320;

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.035, 0.022),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }),
      this.max,
    );
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => {};
    const colors = [0xffd45c, 0xffe9a8, 0xd61a2a, 0xffffff, 0xf2b02e];
    for (let i = 0; i < this.max; i++) this.mesh.setColorAt(i, new THREE.Color(colors[i % colors.length]));
    scene.add(this.mesh);
  }

  burst(at: THREE.Vector3, n: number) {
    for (let i = 0; i < n; i++) {
      if (this.parts.length >= this.max) this.parts.shift();
      const a = Math.random() * Math.PI * 2;
      const s = 1.5 + Math.random() * 3;
      this.parts.push({
        p: at.clone(),
        v: new THREE.Vector3(Math.cos(a) * s * 0.5, 3 + Math.random() * 3.5, Math.sin(a) * s * 0.5),
        r: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        w: new THREE.Vector3(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6),
        life: 3 + Math.random() * 1.5,
      });
    }
  }

  update(dt: number) {
    if (this.parts.length === 0) {
      this.mesh.count = 0;
      return;
    }
    this.parts = this.parts.filter((c) => (c.life -= dt) > 0);
    this.parts.forEach((c, i) => {
      // Paper falls slowly with drag and a little flutter.
      c.v.y -= 6 * dt;
      c.v.multiplyScalar(1 - Math.min(1, dt * 1.6));
      c.v.y = Math.max(c.v.y, -0.9);
      c.p.addScaledVector(c.v, dt);
      c.p.x += Math.sin(c.life * 5 + i) * 0.004;
      if (c.p.y < 0.01) {
        c.p.y = 0.01;
        c.v.set(0, 0, 0);
      }
      c.r.x += c.w.x * dt;
      c.r.y += c.w.y * dt;
      this.tmp.position.copy(c.p);
      this.tmp.rotation.copy(c.r);
      this.tmp.updateMatrix();
      this.mesh.setMatrixAt(i, this.tmp.matrix);
    });
    this.mesh.count = this.parts.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
