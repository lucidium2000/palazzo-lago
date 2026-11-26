import { NO_SFX, Rng, SCREEN_H, SCREEN_W, STEP, type Game, type GameMeta, type Input, type SfxName } from '../types';
import { num, shadowText, text } from '../font';
import { neonStroke, Sparks, Stars } from '../gfx';
import { notes } from '../music';

/**
 * NEON SENTINEL: a top-down drone-defence shooter. You fly the Warden, a
 * little hover-turret, along the bottom of the screen; drone swarms dive at
 * the three beacon pylons behind you. Shoot them down (A, hold to auto-fire),
 * or set off a pulse bomb (B) to clear the screen. A drone that reaches the
 * bottom hits the nearest beacon; lose all three beacons, or all your
 * Wardens, and the city goes dark. Quick kills chain a multiplier up to x8;
 * every fifth wave a Hive mothership comes down.
 */

const enum T {
  Dart,
  Splitter,
  Bomber,
  Hunter,
  Mini,
  Hive,
}
const RADIUS = [6, 7, 8, 6, 4, 22];
const POINTS = [100, 150, 250, 200, 50, 2500];
const HP = [1, 2, 3, 2, 1, 40];
const COLORS = ['#3ff4ff', '#ff4fd8', '#ffa630', '#7dff5a', '#9fe9ff', '#ff3864'];
const SPARK_COLORS = [...COLORS, '#ffffff', '#fff27a'];

const MAX_D = 48,
  MAX_B = 24,
  MAX_O = 64;
const BEACON_X = [60, 160, 260];
const FLOOR = 226;
const TOP = 14;

export const SENTINEL_META: GameMeta = {
  id: 'sentinel',
  title: 'NEON',
  sub: 'SENTINEL',
  tagline: 'DEFEND THE BEACONS',
  howTo: ['STICK  MOVE THE WARDEN', 'A  FIRE (HOLD)', 'B  PULSE BOMB', 'DRONES THAT REACH THE', 'BOTTOM HIT YOUR BEACONS'],
  buttons: ['FIRE', 'BOMB', ''],
  players: 1,
  colors: { body: '#14102a', trim: '#3ff4ff', accent: '#ff4fd8', accent2: '#ffa630', bg: '#05030f' },
  song: {
    bpm: 138,
    order: [0, 0, 1, 2],
    leadWave: 'pulse',
    bassWave: 'triangle',
    gain: 0.8,
    patterns: [
      {
        lead: notes('A4 . C5 . E5 . A5 - G5 . E5 . D5 . E5 .'),
        bass: notes('A2 . A2 A3 A2 . A2 A3 F2 . F2 F3 G2 . G2 G3'),
        drums: 'k.h.s.h.k.k.s.h.',
      },
      {
        lead: notes('C5 - B4 . A4 . E5 - F5 . E5 . C5 . B4 .'),
        bass: notes('F2 . F2 F3 F2 . F2 F3 E2 . E2 E3 E2 . G#2 G#3'),
        drums: 'k.h.s.h.k.h.s.ho',
      },
      {
        lead: notes('A5 . G5 . E5 . G5 . A5 . C6 . B5 - G#5 .'),
        bass: notes('A2 A2 A3 A2 G2 G2 G3 G2 F2 F2 F3 F2 E2 E2 E3 E2'),
        arp: notes('A4 C5 E5 C5 G4 B4 D5 B4 F4 A4 C5 A4 E4 G#4 B4 G#4'),
        drums: 'k.hsk.hsk.hsk.ss',
      },
    ],
  },
};

export class Sentinel implements Game {
  readonly meta = SENTINEL_META;
  score = 0;
  over = false;
  level = 1;
  sfx: (name: SfxName, vol?: number, pitch?: number) => void = NO_SFX;

  private rng = new Rng(1);
  private time = 0;
  // The Warden.
  private px = 160;
  private py = 205;
  lives = 3;
  bombs = 2;
  private inv = 0;
  private dead = 0;
  private fireCd = 0;
  private nextLife = 25000;
  beacons = [3, 3, 3];
  // Waves.
  wave = 0;
  private toSpawn = 0;
  private spawnT = 0;
  private bannerT = 0;
  private bossDue = false;
  // Chains.
  private chain = 0;
  private chainT = 0;
  mult = 1;
  private flash = 0;
  private shake = 0;

  // Pools.
  readonly dAlive = new Uint8Array(MAX_D);
  readonly dType = new Uint8Array(MAX_D);
  readonly dx = new Float32Array(MAX_D);
  readonly dy = new Float32Array(MAX_D);
  private dvx = new Float32Array(MAX_D);
  private dvy = new Float32Array(MAX_D);
  private dbase = new Float32Array(MAX_D);
  private dt = new Float32Array(MAX_D);
  readonly dhp = new Float32Array(MAX_D);
  private dcd = new Float32Array(MAX_D);
  private dHit = new Float32Array(MAX_D);
  readonly bAlive = new Uint8Array(MAX_B);
  readonly bx = new Float32Array(MAX_B);
  readonly by = new Float32Array(MAX_B);
  readonly oAlive = new Uint8Array(MAX_O);
  readonly ox = new Float32Array(MAX_O);
  readonly oy = new Float32Array(MAX_O);
  private ovx = new Float32Array(MAX_O);
  private ovy = new Float32Array(MAX_O);
  private sparks = new Sparks(180, SPARK_COLORS);
  private stars = new Stars(70, 3);

  start(_players: 1 | 2, seed: number) {
    this.rng.seed(seed);
    this.score = 0;
    this.over = false;
    this.time = 0;
    this.px = 160;
    this.py = 205;
    this.lives = 3;
    this.bombs = 2;
    this.inv = 2;
    this.dead = 0;
    this.nextLife = 25000;
    this.beacons = [3, 3, 3];
    this.wave = 0;
    this.chain = 0;
    this.mult = 1;
    this.dAlive.fill(0);
    this.bAlive.fill(0);
    this.oAlive.fill(0);
    this.sparks.clear();
    this.nextWave();
  }

  private nextWave() {
    this.wave++;
    this.level = this.wave;
    this.bossDue = this.wave % 5 === 0;
    this.toSpawn = this.bossDue ? 6 : Math.min(36, 12 + this.wave * 3);
    this.spawnT = 2.2;
    this.bannerT = 2.2;
    if (this.wave > 1) {
      // Wave cleared: repair the weakest beacon and pay for the ones still standing.
      let w = -1;
      for (let i = 0; i < 3; i++) if (this.beacons[i] > 0 && this.beacons[i] < 3 && (w < 0 || this.beacons[i] < this.beacons[w])) w = i;
      if (w >= 0) this.beacons[w]++;
      this.add(500 * (this.wave - 1) + (this.beacons[0] + this.beacons[1] + this.beacons[2]) * 200);
      if ((this.wave - 1) % 5 === 0) this.bombs = Math.min(5, this.bombs + 1);
      this.sfx('fanfare', 0.6);
    }
  }

  private get speedK() {
    return Math.min(2.2, 1 + 0.07 * (this.wave - 1));
  }

  private add(points: number) {
    this.score += points;
    if (this.score >= this.nextLife) {
      this.nextLife += 25000;
      this.lives = Math.min(6, this.lives + 1);
      this.sfx('power', 0.8);
    }
  }

  /** Spawns a drone (returns its slot or -1). */
  spawn(type: number, x: number, y: number): number {
    for (let i = 0; i < MAX_D; i++) {
      if (this.dAlive[i]) continue;
      this.dAlive[i] = 1;
      this.dType[i] = type;
      this.dx[i] = x;
      this.dy[i] = y;
      this.dbase[i] = x;
      this.dvx[i] = 0;
      this.dvy[i] = 0;
      this.dt[i] = this.rng.next() * 6;
      this.dhp[i] = type === T.Hive ? HP[T.Hive] + 12 * Math.floor(this.wave / 5) : HP[type];
      this.dcd[i] = 1 + this.rng.next() * 1.5;
      this.dHit[i] = 0;
      if (type === T.Bomber) {
        this.dvx[i] = x < 160 ? 45 : -45;
        this.dy[i] = 26 + this.rng.next() * 40;
      }
      if (type === T.Mini) this.dvx[i] = this.rng.next() < 0.5 ? -60 : 60;
      return i;
    }
    return -1;
  }

  private pickType(): number {
    const w = this.wave,
      r = this.rng.next();
    if (w >= 4 && r < 0.18) return T.Hunter;
    if (w >= 3 && r < 0.34) return T.Bomber;
    if (w >= 2 && r < 0.56) return T.Splitter;
    return T.Dart;
  }

  private shot(x: number, y: number, vx: number, vy: number) {
    for (let i = 0; i < MAX_O; i++) {
      if (this.oAlive[i]) continue;
      this.oAlive[i] = 1;
      this.ox[i] = x;
      this.oy[i] = y;
      this.ovx[i] = vx;
      this.ovy[i] = vy;
      return;
    }
  }

  private aimShot(x: number, y: number, speed: number) {
    const ddx = this.px - x,
      ddy = this.py - y,
      l = Math.hypot(ddx, ddy) || 1;
    this.shot(x, y, (ddx / l) * speed, (ddy / l) * speed);
  }

  private kill(i: number, bombed = false) {
    const type = this.dType[i];
    this.dAlive[i] = 0;
    const x = this.dx[i],
      y = this.dy[i];
    this.sparks.burst(this.rng, x, y, type === T.Hive ? 70 : 16, type === T.Hive ? 160 : 90, type, type === T.Hive ? 1.4 : 0.6);
    if (!bombed) {
      this.chain = this.chainT > 0 ? this.chain + 1 : 1;
      this.chainT = 1.1;
      this.mult = Math.min(8, 1 + Math.floor(this.chain / 4));
    }
    const pts = type === T.Hive ? POINTS[T.Hive] * Math.ceil(this.wave / 5) : POINTS[type];
    this.add(bombed ? pts / 2 : pts * this.mult);
    if (type === T.Splitter) {
      this.spawn(T.Mini, x - 4, y);
      this.spawn(T.Mini, x + 4, y);
    }
    if (type === T.Hive) {
      this.flash = 0.5;
      this.shake = 0.8;
      this.sfx('bigboom', 1);
    } else this.sfx('boom', 0.45, 0.8 + this.rng.next() * 0.4);
  }

  private hurt() {
    if (this.inv > 0 || this.dead > 0) return;
    this.lives--;
    this.sparks.burst(this.rng, this.px, this.py, 40, 130, 6, 1);
    this.shake = 0.5;
    this.chain = 0;
    this.mult = 1;
    this.sfx('hurt', 1);
    if (this.lives <= 0) this.end();
    else this.dead = 1.2;
  }

  private end() {
    if (this.over) return;
    this.over = true;
    this.sfx('over', 1);
  }

  step(p: Input) {
    const dt = STEP;
    this.time += dt;
    if (this.over) {
      this.sparks.step(dt);
      return;
    }
    this.flash = Math.max(0, this.flash - dt);
    this.shake = Math.max(0, this.shake - dt);
    this.bannerT = Math.max(0, this.bannerT - dt);
    this.chainT -= dt;
    if (this.chainT <= 0 && this.chain) {
      this.chain = 0;
      this.mult = 1;
    }

    // The Warden.
    if (this.dead > 0) {
      this.dead -= dt;
      if (this.dead <= 0) {
        this.px = 160;
        this.py = 205;
        this.inv = 2.2;
      }
    } else {
      this.inv = Math.max(0, this.inv - dt);
      const sp = 135;
      this.px = Math.min(312, Math.max(8, this.px + p.x * sp * dt));
      this.py = Math.min(218, Math.max(140, this.py - p.y * sp * dt));
      this.fireCd -= dt;
      if (p.a && this.fireCd <= 0) {
        this.fireCd = 0.11;
        let fired = 0;
        for (let i = 0; i < MAX_B && fired < 2; i++) {
          if (this.bAlive[i]) continue;
          this.bAlive[i] = 1;
          this.bx[i] = this.px + (fired ? 4 : -4);
          this.by[i] = this.py - 6;
          fired++;
        }
        if (fired) this.sfx('shoot', 0.25, 1 + this.rng.next() * 0.1);
      }
      if (p.bp && this.bombs > 0) {
        this.bombs--;
        this.flash = 0.6;
        this.shake = 0.6;
        this.sfx('bigboom', 1, 1.3);
        for (let i = 0; i < MAX_D; i++) {
          if (!this.dAlive[i]) continue;
          if (this.dType[i] === T.Hive) {
            this.dhp[i] -= 12;
            if (this.dhp[i] <= 0) this.kill(i, true);
          } else this.kill(i, true);
        }
        this.oAlive.fill(0);
      }
    }

    // Spawning.
    if (this.bannerT <= 0) {
      this.spawnT -= dt;
      if (this.spawnT <= 0 && this.toSpawn > 0) {
        this.spawnT = Math.max(0.45, 1.25 - this.wave * 0.06);
        // They come in small flights: one type, side by side.
        const type = this.pickType();
        const n = Math.min(this.toSpawn, type === T.Bomber ? 1 : 1 + this.rng.int(Math.min(4, 2 + (this.wave >> 1))));
        const x0 = 30 + this.rng.next() * (260 - n * 22);
        for (let k = 0; k < n; k++) this.spawn(type, x0 + k * 22, -10 - k * 6);
        this.toSpawn -= n;
      }
      if (this.bossDue) {
        this.bossDue = false;
        this.spawn(T.Hive, 160, -30);
        this.sfx('rise', 1);
      }
    }

    // Bolts.
    for (let i = 0; i < MAX_B; i++) {
      if (!this.bAlive[i]) continue;
      this.by[i] -= 330 * dt;
      if (this.by[i] < TOP) {
        this.bAlive[i] = 0;
        continue;
      }
      for (let j = 0; j < MAX_D; j++) {
        if (!this.dAlive[j]) continue;
        const r = RADIUS[this.dType[j]] + 2;
        const ddx = this.dx[j] - this.bx[i],
          ddy = this.dy[j] - this.by[i];
        if (ddx * ddx + ddy * ddy < r * r) {
          this.bAlive[i] = 0;
          this.dhp[j]--;
          this.dHit[j] = 0.08;
          this.sparks.burst(this.rng, this.bx[i], this.by[i], 3, 50, 7, 0.25);
          if (this.dhp[j] <= 0) this.kill(j);
          else this.sfx('hit', 0.25, 1.4);
          break;
        }
      }
    }

    // Drones.
    const k = this.speedK;
    let alive = 0;
    for (let i = 0; i < MAX_D; i++) {
      if (!this.dAlive[i]) continue;
      alive++;
      const type = this.dType[i];
      this.dt[i] += dt;
      this.dHit[i] = Math.max(0, this.dHit[i] - dt);
      switch (type) {
        case T.Dart: {
          // Weave down toward the nearest standing beacon.
          let target = this.dbase[i],
            best = 1e9;
          for (let b = 0; b < 3; b++) {
            const d = Math.abs(BEACON_X[b] - this.dbase[i]);
            if (this.beacons[b] > 0 && d < best) {
              best = d;
              target = BEACON_X[b];
            }
          }
          this.dbase[i] += Math.sign(target - this.dbase[i]) * Math.min(Math.abs(target - this.dbase[i]), 14 * dt * k);
          this.dy[i] += 38 * k * dt;
          this.dx[i] = this.dbase[i] + Math.sin(this.dt[i] * 2.3) * 26;
          break;
        }
        case T.Splitter:
          this.dy[i] += 26 * k * dt;
          this.dx[i] = this.dbase[i] + Math.sin(this.dt[i] * 0.9) * 40;
          break;
        case T.Mini:
          this.dx[i] += this.dvx[i] * dt;
          if (this.dx[i] < 6 || this.dx[i] > 314) this.dvx[i] = -this.dvx[i];
          this.dy[i] += 55 * k * dt;
          break;
        case T.Bomber:
          this.dx[i] += this.dvx[i] * k * dt;
          if (this.dx[i] < 14 || this.dx[i] > 306) this.dvx[i] = -this.dvx[i];
          if (this.dt[i] > 12) this.dy[i] += 30 * dt;
          this.dcd[i] -= dt;
          if (this.dcd[i] <= 0 && this.dead <= 0) {
            this.dcd[i] = Math.max(0.8, 1.8 - this.wave * 0.05);
            this.aimShot(this.dx[i], this.dy[i] + 6, 70 + this.wave * 2);
          }
          break;
        case T.Hunter: {
          const ddx = this.px - this.dx[i],
            ddy = this.py - this.dy[i],
            l = Math.hypot(ddx, ddy) || 1;
          this.dvx[i] += (ddx / l) * 70 * dt;
          this.dvy[i] += (ddy / l) * 70 * dt + 8 * dt;
          const s = Math.hypot(this.dvx[i], this.dvy[i]),
            cap = 46 * k;
          if (s > cap) {
            this.dvx[i] *= cap / s;
            this.dvy[i] *= cap / s;
          }
          this.dx[i] += this.dvx[i] * dt;
          this.dy[i] += this.dvy[i] * dt;
          break;
        }
        case T.Hive: {
          this.dy[i] += (52 - this.dy[i]) * Math.min(1, dt * 0.8);
          this.dx[i] = 160 + Math.sin(this.dt[i] * 0.6) * 100;
          this.dcd[i] -= dt;
          if (this.dcd[i] <= 0) {
            this.dcd[i] = 2.1;
            const n = 10 + Math.floor(this.wave / 5) * 2;
            for (let s = 0; s < n; s++) {
              const a = (s / n) * Math.PI * 2 + this.dt[i];
              this.shot(this.dx[i], this.dy[i], Math.cos(a) * 62, Math.sin(a) * 62 + 20);
            }
            if (this.rng.next() < 0.7) {
              this.spawn(T.Dart, this.dx[i] - 20, this.dy[i] + 10);
              this.spawn(T.Dart, this.dx[i] + 20, this.dy[i] + 10);
            }
            this.sfx('zap', 0.5, 0.7);
          }
          break;
        }
      }
      // Touching the Warden.
      if (this.dead <= 0) {
        const r = RADIUS[type] + 4;
        const ddx = this.dx[i] - this.px,
          ddy = this.dy[i] - this.py;
        if (ddx * ddx + ddy * ddy < r * r) {
          if (type !== T.Hive) this.kill(i, true);
          this.hurt();
          if (this.over) return;
          continue;
        }
      }
      // Reaching the bottom: hit a beacon, or loop back to the top.
      if (this.dy[i] > FLOOR) {
        let hitB = -1;
        for (let b = 0; b < 3; b++) if (this.beacons[b] > 0 && Math.abs(BEACON_X[b] - this.dx[i]) < 34) hitB = b;
        if (hitB >= 0) {
          this.beacons[hitB]--;
          this.dAlive[i] = 0;
          this.sparks.burst(this.rng, BEACON_X[hitB], FLOOR, 30, 120, 6, 0.8);
          this.shake = 0.4;
          this.flash = 0.15;
          this.sfx('crash', 0.9);
          if (this.beacons[0] + this.beacons[1] + this.beacons[2] === 0) {
            this.end();
            return;
          }
        } else {
          this.dy[i] = -8;
          this.dbase[i] = this.dx[i];
        }
      }
    }

    // Orbs.
    for (let i = 0; i < MAX_O; i++) {
      if (!this.oAlive[i]) continue;
      this.ox[i] += this.ovx[i] * dt;
      this.oy[i] += this.ovy[i] * dt;
      if (this.ox[i] < -4 || this.ox[i] > 324 || this.oy[i] < 0 || this.oy[i] > 244) {
        this.oAlive[i] = 0;
        continue;
      }
      if (this.dead <= 0) {
        const ddx = this.ox[i] - this.px,
          ddy = this.oy[i] - this.py;
        if (ddx * ddx + ddy * ddy < 36) {
          this.oAlive[i] = 0;
          this.hurt();
          if (this.over) return;
        }
      }
    }
    this.sparks.step(dt);

    if (alive === 0 && this.toSpawn === 0 && !this.bossDue && this.bannerT <= 0) this.nextWave();
  }

  // ---------------------------------------------------------------------------

  draw(g: CanvasRenderingContext2D, t: number) {
    const sh = this.shake > 0 ? Math.sin(t * 90) * this.shake * 4 : 0;
    g.fillStyle = '#05030f';
    g.fillRect(0, 0, SCREEN_W, SCREEN_H);
    g.save();
    g.translate(sh | 0, 0);
    this.stars.draw(g, t, 18, '#b9c8ff');
    this.grid(g, t);
    // Beacons.
    for (let b = 0; b < 3; b++) this.beacon(g, BEACON_X[b], this.beacons[b], t);
    // Drones.
    for (let i = 0; i < MAX_D; i++) if (this.dAlive[i]) this.drone(g, this.dType[i], this.dx[i], this.dy[i], this.dt[i] + t * 0, this.dHit[i] > 0, i);
    // Orbs.
    g.fillStyle = '#ff6a3d';
    for (let i = 0; i < MAX_O; i++) {
      if (!this.oAlive[i]) continue;
      g.globalAlpha = 0.35;
      g.fillRect((this.ox[i] - 3) | 0, (this.oy[i] - 3) | 0, 6, 6);
      g.globalAlpha = 1;
      g.fillRect((this.ox[i] - 1.5) | 0, (this.oy[i] - 1.5) | 0, 3, 3);
    }
    // Bolts.
    for (let i = 0; i < MAX_B; i++) {
      if (!this.bAlive[i]) continue;
      g.fillStyle = '#3ff4ff';
      g.globalAlpha = 0.35;
      g.fillRect((this.bx[i] - 2) | 0, (this.by[i] - 1) | 0, 4, 9);
      g.globalAlpha = 1;
      g.fillStyle = '#e8ffff';
      g.fillRect((this.bx[i] - 1) | 0, this.by[i] | 0, 2, 7);
    }
    // The Warden.
    if (this.dead <= 0 && !this.over && !(this.inv > 0 && Math.floor(t * 16) % 2 === 0)) this.warden(g, this.px, this.py, t);
    this.sparks.draw(g, 2);
    g.restore();
    if (this.flash > 0) {
      g.fillStyle = '#ffffff';
      g.globalAlpha = Math.min(0.7, this.flash);
      g.fillRect(0, 0, SCREEN_W, SCREEN_H);
      g.globalAlpha = 1;
    }
    this.hud(g, t);
  }

  private grid(g: CanvasRenderingContext2D, t: number) {
    const hy = 150;
    g.strokeStyle = '#5b1d8f';
    g.lineWidth = 1;
    g.globalAlpha = 0.55;
    g.beginPath();
    for (let i = -8; i <= 8; i++) {
      g.moveTo(160 + i * 12, hy);
      g.lineTo(160 + i * 60, SCREEN_H);
    }
    const ph = (t * 0.6) % 1;
    for (let k = 0; k < 7; k++) {
      const z = (k + ph) / 7;
      const y = hy + (SCREEN_H - hy) * z * z;
      g.moveTo(0, y | 0);
      g.lineTo(SCREEN_W, y | 0);
    }
    g.stroke();
    g.globalAlpha = 1;
  }

  private beacon(g: CanvasRenderingContext2D, x: number, hp: number, t: number) {
    const on = hp > 0;
    g.fillStyle = on ? '#1b2b4a' : '#1a1418';
    g.fillRect(x - 10, FLOOR, 20, 14);
    g.fillRect(x - 4, FLOOR - 14, 8, 14);
    if (on) {
      const pulse = 0.6 + 0.4 * Math.sin(t * 4 + x);
      g.fillStyle = hp === 3 ? '#3ff4ff' : hp === 2 ? '#fff27a' : '#ff3864';
      g.globalAlpha = 0.3 * pulse;
      g.beginPath();
      g.arc(x, FLOOR - 16, 9, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      g.fillRect(x - 2, FLOOR - 18, 4, 4);
      for (let k = 0; k < hp; k++) g.fillRect(x - 7 + k * 5, FLOOR + 6, 4, 3);
    } else {
      g.fillStyle = '#ff3864';
      g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 10);
      g.fillRect(x - 1, FLOOR - 16, 2, 2);
      g.globalAlpha = 1;
    }
  }

  private warden(g: CanvasRenderingContext2D, x: number, y: number, t: number) {
    g.beginPath();
    g.moveTo(x, y - 8);
    g.lineTo(x + 8, y + 5);
    g.lineTo(x + 3, y + 3);
    g.lineTo(x, y + 6);
    g.lineTo(x - 3, y + 3);
    g.lineTo(x - 8, y + 5);
    g.closePath();
    g.fillStyle = '#123044';
    g.fill();
    neonStroke(g, '#e8ffff', 1.2);
    // Engine flicker.
    g.fillStyle = Math.floor(t * 30) % 2 ? '#ffa630' : '#fff27a';
    g.fillRect(x - 1, y + 6, 2, 3 + (Math.floor(t * 30) % 3));
  }

  private drone(g: CanvasRenderingContext2D, type: number, x: number, y: number, ph: number, hit: boolean, i: number) {
    const c = hit ? '#ffffff' : COLORS[type];
    const r = RADIUS[type];
    g.beginPath();
    switch (type) {
      case T.Dart:
      case T.Mini:
        g.moveTo(x, y + r);
        g.lineTo(x + r, y - r * 0.7);
        g.lineTo(x, y - r * 0.2);
        g.lineTo(x - r, y - r * 0.7);
        g.closePath();
        break;
      case T.Splitter:
        g.moveTo(x, y - r);
        g.lineTo(x + r, y);
        g.lineTo(x, y + r);
        g.lineTo(x - r, y);
        g.closePath();
        g.moveTo(x - r * 0.5, y);
        g.lineTo(x + r * 0.5, y);
        break;
      case T.Bomber:
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
          if (k) g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.7);
          else g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.7);
        }
        g.closePath();
        break;
      case T.Hunter: {
        const a = ph * 3;
        for (let k = 0; k < 4; k++) {
          const b = a + (k * Math.PI) / 2;
          g.moveTo(x, y);
          g.lineTo(x + Math.cos(b) * r, y + Math.sin(b) * r);
        }
        g.moveTo(x + 3, y);
        g.arc(x, y, 3, 0, Math.PI * 2);
        break;
      }
      case T.Hive: {
        g.arc(x, y, r, 0, Math.PI * 2);
        g.moveTo(x + r * 0.55, y);
        g.arc(x, y, r * 0.55, 0, Math.PI * 2);
        for (let k = 0; k < 8; k++) {
          const a = ph * 0.8 + (k * Math.PI) / 4;
          g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
          g.lineTo(x + Math.cos(a) * (r + 6), y + Math.sin(a) * (r + 6));
        }
        break;
      }
    }
    g.fillStyle = '#0d0a1e';
    if (type !== T.Hunter) g.fill();
    neonStroke(g, c, type === T.Hive ? 2 : 1.3);
    if (type === T.Hive) {
      // Its health bar and its eye.
      const max = HP[T.Hive] + 12 * Math.floor(this.wave / 5);
      g.fillStyle = '#3a0d1c';
      g.fillRect(110, 18, 100, 4);
      g.fillStyle = '#ff3864';
      g.fillRect(110, 18, Math.max(0, (this.dhp[i] / max) * 100) | 0, 4);
      g.fillStyle = Math.floor(ph * 4) % 2 ? '#ffffff' : '#ff3864';
      g.fillRect(x - 3, y - 3, 6, 6);
    }
  }

  private hud(g: CanvasRenderingContext2D, t: number) {
    g.fillStyle = '#000000';
    g.globalAlpha = 0.5;
    g.fillRect(0, 0, SCREEN_W, 12);
    g.globalAlpha = 1;
    text(g, 'SCORE', 4, 3, '#3ff4ff');
    num(g, this.score, 38, 3, '#ffffff');
    text(g, 'WAVE', 132, 3, '#ff4fd8');
    num(g, this.wave, 160, 3, '#ffffff');
    // Lives and bombs as icons.
    // Spare Wardens as little ships.
    g.fillStyle = '#e8ffff';
    for (let k = 0; k < Math.min(5, this.lives); k++) {
      const x = 238 + k * 9;
      g.fillRect(x + 2, 3, 1, 2);
      g.fillRect(x + 1, 5, 3, 2);
      g.fillRect(x, 7, 5, 2);
    }
    for (let k = 0; k < this.bombs; k++) {
      g.fillStyle = '#ffa630';
      g.fillRect(288 + k * 6, 4, 4, 5);
      g.fillStyle = '#fff27a';
      g.fillRect(289 + k * 6, 5, 2, 2);
    }
    if (this.mult > 1) shadowText(g, 'X', 194, 3, '#fff27a'), num(g, this.mult, 201, 3, '#fff27a');
    if (this.bannerT > 0 && !this.over) {
      const blink = Math.floor(t * 6) % 2 === 0;
      shadowText(g, this.wave % 5 === 0 ? 'WARNING' : 'WAVE', 160, 92, this.wave % 5 === 0 ? '#ff3864' : '#ff4fd8', 3, 'center');
      if (this.wave % 5 === 0) {
        if (blink) shadowText(g, 'HIVE INBOUND', 160, 120, '#fff27a', 2, 'center');
      } else num(g, this.wave, 160, 120, '#ffffff', 3, 'center');
    }
  }

  attract(g: CanvasRenderingContext2D, t: number) {
    g.fillStyle = '#05030f';
    g.fillRect(0, 0, SCREEN_W, SCREEN_H);
    this.stars.draw(g, t, 18, '#b9c8ff');
    this.grid(g, t);
    // A swarm circling the beacons.
    for (let k = 0; k < 9; k++) {
      const a = t * 0.9 + (k / 9) * Math.PI * 2;
      this.drone(g, k % 4, 160 + Math.cos(a) * 120, 150 + Math.sin(a * 1.3) * 30, t + k, false, 0);
    }
    for (let b = 0; b < 3; b++) this.beacon(g, BEACON_X[b], 3, t);
    this.warden(g, 160 + Math.sin(t * 1.4) * 60, 205, t);
  }

  // --- Mirroring for friends watching -----------------------------------------
  snap(o: number[]) {
    o.length = 0;
    o.push(this.score, this.wave, this.lives, this.bombs, this.mult, Math.round(this.px), Math.round(this.py), this.dead > 0 ? 1 : 0, this.beacons[0], this.beacons[1], this.beacons[2], Math.round(this.flash * 10), Math.round(this.bannerT * 10), this.over ? 1 : 0);
    let n = 0;
    const at = o.length;
    o.push(0);
    for (let i = 0; i < MAX_D; i++) if (this.dAlive[i]) o.push(this.dType[i], Math.round(this.dx[i]), Math.round(this.dy[i]), Math.max(0, Math.round(this.dhp[i]))), n++;
    o[at] = n;
    const at2 = o.length;
    o.push(0);
    n = 0;
    for (let i = 0; i < MAX_O; i++) if (this.oAlive[i]) o.push(Math.round(this.ox[i]), Math.round(this.oy[i])), n++;
    o[at2] = n;
    const at3 = o.length;
    o.push(0);
    n = 0;
    for (let i = 0; i < MAX_B; i++) if (this.bAlive[i]) o.push(Math.round(this.bx[i]), Math.round(this.by[i])), n++;
    o[at3] = n;
  }

  load(a: readonly number[]) {
    let k = 0;
    const r = () => Number(a[k++]) || 0;
    this.score = r();
    this.wave = r();
    this.lives = r();
    this.bombs = r();
    this.mult = r();
    this.px = r();
    this.py = r();
    this.dead = r() ? 1 : 0;
    this.beacons[0] = r();
    this.beacons[1] = r();
    this.beacons[2] = r();
    this.flash = r() / 10;
    this.bannerT = r() / 10;
    this.over = r() === 1;
    this.inv = 0;
    this.dAlive.fill(0);
    const nd = Math.min(MAX_D, r());
    for (let i = 0; i < nd; i++) {
      this.dAlive[i] = 1;
      this.dType[i] = r();
      this.dx[i] = r();
      this.dy[i] = r();
      this.dhp[i] = r();
    }
    this.oAlive.fill(0);
    const no = Math.min(MAX_O, r());
    for (let i = 0; i < no; i++) {
      this.oAlive[i] = 1;
      this.ox[i] = r();
      this.oy[i] = r();
    }
    this.bAlive.fill(0);
    const nb = Math.min(MAX_B, r());
    for (let i = 0; i < nb; i++) {
      this.bAlive[i] = 1;
      this.bx[i] = r();
      this.by[i] = r();
    }
  }
}
