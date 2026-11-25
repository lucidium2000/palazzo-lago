import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MAX_DIVE, RESCUE_AFTER, StrokeHand, floatFeet, newVState, strokeThrust, verticalStep, type VInput } from '../src/client/swimphys';
import { POOL, WATER_Y, poolFloor, registerPool } from '../src/client/areas/pool';
import { World } from '../src/client/world';

// --- Pure maths -----------------------------------------------------------------

const DEEP = -2.12;
const W = WATER_Y;

function settle(eyeH: number, from: number, secs: number, dt = 1 / 72, extra: Partial<VInput> = {}) {
  const s = newVState(from);
  const heads: number[] = [];
  for (let t = 0; t < secs; t += dt) {
    verticalStep(s, { ground: DEEP, water: W, eyeH, ...extra }, dt);
    heads.push(s.feetY + eyeH - W);
  }
  return { s, heads };
}

describe('buoyancy', () => {
  for (const eyeH of [1.2, 1.5, 1.65, 1.9]) {
    it(`floats eyes just above the water without overshoot (eye ${eyeH} m)`, () => {
      // Released from the pool floor: rises and settles, never past the float height.
      const { s, heads } = settle(eyeH, DEEP + 0.3 - eyeH, 4);
      expect(Math.max(...heads)).toBeLessThan(0.12 + 0.01);
      expect(heads[heads.length - 1]).toBeCloseTo(0.12, 2);
      expect(Math.abs(s.velY)).toBeLessThan(0.01);
      // Most of the way up within 1.5 s.
      expect(heads[Math.round(1.5 * 72)]).toBeGreaterThan(0.0);
    });
  }

  it('is stable with huge frame times', () => {
    for (const dt of [0.05, 0.25, 0.5, 1]) {
      const { heads } = settle(1.65, DEEP + 0.3 - 1.65, 8, dt);
      expect(Math.max(...heads)).toBeLessThan(0.13);
      expect(heads[heads.length - 1]).toBeCloseTo(0.12, 2);
    }
  });

  it('recovers from NaN', () => {
    const s = newVState(NaN);
    verticalStep(s, { ground: DEEP, water: W, eyeH: 1.65 }, 1 / 72);
    expect(Number.isFinite(s.feetY)).toBe(true);
  });
});

describe('launch resistance', () => {
  it('maximum upward stroke thrust only treads water', () => {
    const s = newVState(floatFeet(W, 1.7));
    let maxHead = -Infinity;
    for (let t = 0; t < 5; t += 1 / 72) {
      verticalStep(s, { ground: DEEP, water: W, eyeH: 1.7, thrust: 1e6 }, 1 / 72);
      maxHead = Math.max(maxHead, s.feetY + 1.7 - W);
    }
    expect(maxHead).toBeLessThan(0.45);
  });

  it('a kick from below cannot fling you out', () => {
    const s = newVState(floatFeet(W, 1.7) - 0.5);
    s.velY = 50;
    let maxHead = -Infinity;
    for (let t = 0; t < 3; t += 1 / 72) {
      verticalStep(s, { ground: DEEP, water: W, eyeH: 1.7 }, 1 / 72);
      maxHead = Math.max(maxHead, s.feetY + 1.7 - W);
    }
    expect(maxHead).toBeLessThan(0.45);
  });

  it('caps stroke speed and drops tracking glitches', () => {
    const h = new StrokeHand();
    const v = { x: 0, y: 0, z: 0 };
    let t = 0;
    for (let i = 0; i < 10; i++) h.push((t += 1 / 72), 0.2, 1.2, -0.3);
    // The controller loses tracking and jumps 3 m for a frame, then comes back.
    h.push((t += 1 / 72), 0.2, -1.8, -0.3);
    expect(Math.hypot(...Object.values(h.velocity(v)))).toBe(0);
    h.push((t += 1 / 72), 0.2, 1.2, -0.3);
    expect(Math.hypot(...Object.values(h.velocity(v)))).toBe(0);
    // A real fast stroke (5 m/s) is capped.
    for (let i = 0; i < 20; i++) h.push((t += 1 / 72), 0.2, 1.2 - i * (5 / 72), -0.3);
    expect(Math.hypot(...Object.values(h.velocity(v)))).toBeCloseTo(StrokeHand.MAX_SPEED, 3);
    // 20 m/s jitter: a glitch, ignored.
    h.push((t += 1 / 72), 0.2, 1.2 + 20 / 72, -0.3);
    expect(Math.hypot(...Object.values(h.velocity(v)))).toBe(0);
  });

  it('stroke thrust grows with speed but is bounded', () => {
    const a = { x: 0, y: 0, z: 0 };
    strokeThrust({ x: 0, y: 0, z: 0.3 }, a);
    expect(a.z).toBe(0);
    strokeThrust({ x: 0, y: 0, z: 2 }, a);
    expect(a.z).toBeLessThan(0);
    const mid = a.z;
    strokeThrust({ x: 0, y: 0, z: 3.5 }, a);
    expect(a.z).toBeLessThan(mid);
    expect(Math.abs(a.z)).toBeLessThan(3.5 * 2.4 * 1.6 + 1e-9);
  });
});

describe('diving', () => {
  it('desktop dive is bounded and you float back up', () => {
    const eyeH = 1.65;
    const s = newVState(floatFeet(W, eyeH));
    let minHead = Infinity;
    for (let t = 0; t < 4; t += 1 / 60) {
      verticalStep(s, { ground: DEEP, water: W, eyeH, dive: true }, 1 / 60);
      minHead = Math.min(minHead, s.feetY + eyeH);
    }
    expect(minHead).toBeGreaterThanOrEqual(W - MAX_DIVE - 1e-6);
    expect(minHead).toBeGreaterThanOrEqual(DEEP + 0.3 - 1e-6);
    expect(minHead).toBeLessThan(W - 0.5);
    let t = 0;
    while (s.feetY + eyeH < W && t < 5) {
      verticalStep(s, { ground: DEEP, water: W, eyeH }, 1 / 60);
      t += 1 / 60;
    }
    expect(t).toBeLessThan(1.5);
  });

  it('never dives into the floor in the shallow end', () => {
    const eyeH = 1.9;
    const ground = poolFloor(36, -20);
    const s = newVState(floatFeet(W, eyeH));
    for (let t = 0; t < 4; t += 1 / 72) {
      verticalStep(s, { ground, water: W, eyeH, thrust: -1e6, diving: true }, 1 / 72);
      expect(s.feetY + eyeH).toBeGreaterThanOrEqual(ground + 0.3 - 1e-6);
    }
  });

  it('the safety net brings a stuck head up', () => {
    // A crouching VR swimmer whose float height still thinks they stand tall.
    const s = newVState(floatFeet(W, 1.7));
    let under = 0,
      maxUnder = 0;
    for (let t = 0; t < 10; t += 1 / 72) {
      verticalStep(s, { ground: DEEP, water: W, eyeH: 1.7, headH: 1.0 }, 1 / 72);
      under = s.feetY + 1.0 < W - 0.03 ? under + 1 / 72 : 0;
      maxUnder = Math.max(maxUnder, under);
    }
    expect(maxUnder).toBeLessThan(RESCUE_AFTER + 1.2);
    expect(s.feetY + 1.0).toBeGreaterThan(W - 0.03);
  });
});

// --- The Player in the pool, with fakes --------------------------------------------

type Handler = (e: { code: string; target: unknown; preventDefault(): void }) => void;
const listeners: Record<string, Handler[]> = {};
const g = globalThis as unknown as Record<string, unknown>;
g.addEventListener = (type: string, fn: Handler) => (listeners[type] ??= []).push(fn);
const ctx2d = { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, fillStyle: '' };
g.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
const key = (type: 'keydown' | 'keyup', code: string) => listeners[type]?.forEach((f) => f({ code, target: {}, preventDefault() {} }));

const { Player } = await import('../src/client/player');
type PlayerT = InstanceType<typeof Player>;

function world() {
  const w = new World();
  w.addWalkable(20, 64, -38, 2);
  registerPool(w);
  return w;
}

interface Rig {
  p: PlayerT;
  cam: THREE.PerspectiveCamera;
  pads: { handedness: string; gamepad: { axes: number[]; buttons: { pressed: boolean; value: number }[] } }[];
  hands: THREE.Vector3[];
  t: number;
}

function make(vr: boolean, eyeH = 1.65): Rig {
  const cam = new THREE.PerspectiveCamera();
  const renderer = { xr: { isPresenting: vr, addEventListener() {} }, domElement: {} } as unknown as THREE.WebGLRenderer;
  const p = new Player(cam, renderer, world());
  const pad = (h: string) => ({ handedness: h, gamepad: { axes: [0, 0, 0, 0], buttons: Array.from({ length: 6 }, () => ({ pressed: false, value: 0 })) } });
  const r: Rig = { p, cam, pads: [pad('left'), pad('right')], hands: [new THREE.Vector3(-0.25, eyeH - 0.5, -0.3), new THREE.Vector3(0.25, eyeH - 0.5, -0.3)], t: 0 };
  if (vr) {
    cam.position.set(0, eyeH, 0);
    p.strokes = () => r.hands.map((v, id) => ({ id, p: v, t: r.t }));
  }
  return r;
}

const interaction = (r: Rig) => ({ gamepads: () => r.pads }) as never;

function place(r: Rig, x: number, z: number, yaw: number, eye = 1.65) {
  r.p.place({ id: 't', label: '', position: new THREE.Vector3(x, 0, z), yaw, pitch: 0, eye });
}

/** Head height above the water (or above the deck level when dry). */
function headAbove(r: Rig) {
  r.p.rig.updateMatrixWorld(true);
  const h = r.cam.getWorldPosition(new THREE.Vector3());
  return h.y - WATER_Y;
}

/** Runs frames, recording the head height above the water and the time spent under. */
function run(r: Rig, secs: number, dt = 1 / 72, each?: (t: number) => void) {
  const out = { min: Infinity, max: -Infinity, maxUnder: 0, end: 0 };
  let under = 0;
  for (let t = 0; t < secs; t += dt) {
    each?.(t);
    r.t += dt;
    r.p.update(dt, interaction(r));
    const h = headAbove(r);
    out.min = Math.min(out.min, h);
    out.max = Math.max(out.max, h);
    under = r.p.underwater ? under + dt : 0;
    out.maxUnder = Math.max(out.maxUnder, under);
    out.end = h;
  }
  return out;
}

const stick = (r: Rig, x: number, y: number) => {
  r.pads[0].gamepad.axes[2] = x;
  r.pads[0].gamepad.axes[3] = y;
};
const pressA = (r: Rig, on: boolean) => (r.pads[1].gamepad.buttons[4].pressed = on);
const headXZ = (r: Rig) => {
  r.p.rig.updateMatrixWorld(true);
  return r.cam.getWorldPosition(new THREE.Vector3());
};

describe('Player in the pool', () => {
  for (const eyeH of [1.2, 1.65, 1.9]) {
    it(`VR floats at the surface (eye ${eyeH} m)`, () => {
      const r = make(true, eyeH);
      place(r, 44, -20, Math.PI / 2);
      run(r, 3);
      const s = run(r, 3);
      expect(r.p.swimming).toBe(true);
      expect(s.min).toBeGreaterThan(0.06);
      expect(s.max).toBeLessThan(0.18);
    });
  }

  for (const eye of [1.2, 1.65, 1.9]) {
    it(`desktop floats at the surface (eye ${eye} m)`, () => {
      const r = make(false);
      place(r, 44, -20, Math.PI / 2, eye);
      run(r, 3);
      const s = run(r, 3);
      expect(r.p.swimming).toBe(true);
      expect(s.min).toBeGreaterThan(0.06);
      expect(s.max).toBeLessThan(0.18);
    });
  }

  it('VR: violent downward strokes and tracking glitches never launch you', () => {
    for (const eyeH of [1.2, 1.9]) {
      const r = make(true, eyeH);
      place(r, 44, -20, Math.PI / 2);
      run(r, 2);
      // Hands slammed down through the water as fast as a hand can go, over and over,
      // with the controllers glitching metres away every few frames.
      for (const glitches of [false, true]) {
        const s = run(r, 6, 1 / 72, (t) => {
          // A fast slam down (4 m/s, past the stroke cap), a slower lift.
          const ph = t % 1;
          const y = ph < 0.25 ? eyeH - 0.2 - (ph / 0.25) * 1.0 : eyeH - 1.2 + ((ph - 0.25) / 0.75) * 1.0;
          const glitch = glitches && Math.floor(t * 72) % 9 === 0;
          for (const [i, v] of r.hands.entries()) v.set(i ? 0.25 : -0.25, glitch ? y + (i ? 6 : -6) : y, glitch ? 3 : -0.3);
        });
        expect(s.max).toBeLessThan(0.5);
      }
      expect(r.p.water).not.toBeNull();
      run(r, 3);
      expect(headAbove(r)).toBeGreaterThan(0.05);
      expect(headAbove(r)).toBeLessThan(0.2);
    }
  });

  it('VR: snap turns are not strokes', () => {
    const r = make(true, 1.7);
    place(r, 44, -20, Math.PI / 2);
    run(r, 2);
    const x0 = headXZ(r);
    for (let i = 0; i < 6; i++) {
      r.pads[1].gamepad.axes[2] = 1;
      run(r, 0.1);
      r.pads[1].gamepad.axes[2] = 0;
      run(r, 0.1);
    }
    expect(headXZ(r).distanceTo(x0)).toBeLessThan(0.05);
    expect(r.p.swimSpeed).toBeLessThan(0.05);
  });

  it('VR: breaststrokes swim forward at a believable speed', () => {
    const r = make(true, 1.7);
    place(r, 38, -20, -Math.PI / 2); // facing +X, toward the deep end
    run(r, 2);
    const x0 = headXZ(r).x;
    let top = 0;
    run(r, 6, 1 / 72, (t) => {
      // Pull back under water (local +Z is behind you) fast, recover above the water.
      const ph = t % 1;
      const pull = ph < 0.4;
      const z = pull ? -0.5 + (ph / 0.4) * 0.8 : 0.3 - ((ph - 0.4) / 0.6) * 0.8;
      for (const [i, v] of r.hands.entries()) v.set(i ? 0.3 : -0.3, pull ? 1.2 : 1.85, z);
      top = Math.max(top, r.p.swimSpeed);
    });
    const dx = headXZ(r).x - x0;
    expect(dx).toBeGreaterThan(2);
    expect(top).toBeLessThanOrEqual(2.0 + 1e-6);
  });

  it('VR: pushing your hands up dives a little, then you float back up', () => {
    const r = make(true, 1.7);
    place(r, 44, -20, Math.PI / 2);
    run(r, 2);
    const d = run(r, 2, 1 / 72, (t) => {
      // A quick push up, a slow recovery down.
      const ph = t % 1;
      const y = ph < 0.25 ? 0.9 + (ph / 0.25) * 0.6 : 1.5 - ((ph - 0.25) / 0.75) * 0.6;
      for (const [i, v] of r.hands.entries()) v.set(i ? 0.25 : -0.25, y, -0.3);
    });
    expect(d.min).toBeLessThan(-0.1);
    expect(d.min).toBeGreaterThan(-MAX_DIVE - 0.05);
    for (const v of r.hands) v.set(v.x, 1.9, -0.3);
    let t = 0;
    while (headAbove(r) < 0 && t < 4) {
      run(r, 1 / 72);
      t += 1 / 72;
    }
    expect(t).toBeLessThan(2);
    const after = run(r, 3);
    expect(after.max).toBeLessThan(0.25);
  });

  it('VR: leaning out over the deck does not lift you out of the pool', () => {
    const r = make(true, 1.7);
    place(r, 44, -16.0, Math.PI); // 0.5 m from the south wall (z = -15.5), facing it
    run(r, 2);
    const feet = r.p.feetY;
    r.cam.position.set(0, 1.7, -0.9); // lean 0.9 m forward, over the deck
    const s = run(r, 2);
    expect(r.p.feetY).toBeCloseTo(feet, 1);
    expect(s.max).toBeLessThan(0.25);
    expect(headXZ(r).z).toBeLessThan(-15.5 - 0.15);
  });

  it('VR: crouching low for a long time does not leave you stuck under', () => {
    const r = make(true, 1.7);
    place(r, 44, -20, Math.PI / 2);
    run(r, 2);
    r.cam.position.y = 0.5;
    const s = run(r, 8);
    expect(s.maxUnder).toBeLessThan(3);
    expect(s.end).toBeGreaterThan(0);
    r.cam.position.y = 1.7;
    const up = run(r, 4);
    expect(up.max).toBeLessThan(1.3); // standing up in real life briefly lifts the head, then it settles
    expect(up.end).toBeLessThan(0.2);
  });

  it('VR: a head swaying over the edge of the last step does not bounce you', () => {
    const r = make(true, 1.7);
    place(r, 33.6, -20, Math.PI / 2); // just past the last step (x < 33.5), facing it
    run(r, 3);
    let lo = Infinity,
      hi = -Infinity;
    run(r, 4, 1 / 72, (t) => {
      r.cam.position.z = Math.sin(t * 5) * 0.2; // the head sways 20 cm back and forth across it
      lo = Math.min(lo, headAbove(r));
      hi = Math.max(hi, headAbove(r));
    });
    expect(r.p.swimming).toBe(true);
    expect(hi - lo).toBeLessThan(0.12);
  });

  it('VR: stepping off the deck by the wall drops you in, clear of the wall', () => {
    const r = make(true, 1.7);
    let splashes = 0;
    r.p.onSplash = () => splashes++;
    place(r, 44, -15.3, 0); // on the deck, the pool 20 cm ahead (-Z)
    run(r, 0.5);
    r.cam.position.z = -0.4; // step forward over the water
    const s = run(r, 4);
    expect(r.p.swimming).toBe(true);
    expect(splashes).toBeGreaterThan(0);
    expect(headXZ(r).z).toBeLessThan(-15.5 - 0.19);
    expect(s.maxUnder).toBeLessThan(1);
    expect(s.end).toBeGreaterThan(0.05);
    expect(s.end).toBeLessThan(0.2);
  });

  it('desktop: walking in down the steps starts swimming', () => {
    const r = make(false);
    place(r, 30.5, -20, -Math.PI / 2); // on the deck facing +X, the steps ahead
    key('keydown', 'KeyW');
    const s = run(r, 6, 1 / 60);
    key('keyup', 'KeyW');
    run(r, 2);
    expect(r.p.swimming).toBe(true);
    expect(s.maxUnder).toBeLessThan(0.3);
    expect(headAbove(r)).toBeGreaterThan(0.05);
    expect(headAbove(r)).toBeLessThan(0.2);
  });

  it('VR: walking in down the steps starts swimming', () => {
    for (const eyeH of [1.2, 1.9]) {
      const r = make(true, eyeH);
      place(r, 30.5, -20, -Math.PI / 2);
      stick(r, 0, -1);
      const s = run(r, 6);
      stick(r, 0, 0);
      run(r, 2);
      expect(r.p.swimming).toBe(true);
      expect(s.maxUnder).toBeLessThan(0.3);
      expect(headAbove(r)).toBeGreaterThan(0.05);
      expect(headAbove(r)).toBeLessThan(0.2);
    }
  });

  it('desktop: jumping in lands you swimming at the surface with a splash', () => {
    const r = make(false);
    let splashes = 0;
    r.p.onSplash = () => splashes++;
    place(r, 44, -14.6, 0); // on the deck by the north edge, facing the water
    key('keydown', 'KeyW');
    run(r, 0.2, 1 / 60);
    key('keydown', 'Space');
    key('keyup', 'Space');
    const s = run(r, 0.6, 1 / 60);
    key('keyup', 'KeyW');
    const after = run(r, 4, 1 / 60);
    expect(splashes).toBeGreaterThan(0);
    expect(r.p.swimming).toBe(true);
    expect(Math.min(s.min, after.min)).toBeGreaterThan(-0.6);
    expect(after.maxUnder).toBeLessThan(1);
    expect(after.end).toBeGreaterThan(0.05);
    expect(after.end).toBeLessThan(0.2);
  });

  it('VR: jumping in (A) lands you swimming at the surface', () => {
    const r = make(true, 1.75);
    place(r, 44, -14.6, 0);
    stick(r, 0, -1);
    run(r, 0.3);
    pressA(r, true);
    run(r, 0.05);
    pressA(r, false);
    const s = run(r, 1);
    stick(r, 0, 0);
    const after = run(r, 4);
    expect(r.p.swimming).toBe(true);
    expect(Math.min(s.min, after.min)).toBeGreaterThan(-0.6);
    expect(after.end).toBeGreaterThan(0.05);
    expect(after.end).toBeLessThan(0.2);
  });

  it('desktop and VR: swim to the steps and walk out onto the deck', () => {
    for (const vr of [false, true]) {
      const r = make(vr, 1.7);
      place(r, 36, -20, Math.PI / 2); // facing -X, toward the steps
      run(r, 2);
      if (vr) stick(r, 0, -1);
      else key('keydown', 'KeyW');
      run(r, 8, 1 / 60);
      if (vr) stick(r, 0, 0);
      else key('keyup', 'KeyW');
      run(r, 1);
      expect(r.p.water).toBeNull();
      expect(r.p.feetY).toBe(0);
      expect(headXZ(r).x).toBeLessThan(POOL.x - POOL.w / 2);
    }
  });

  it('desktop and VR: haul out at the edge', () => {
    for (const vr of [false, true]) {
      const r = make(vr, 1.7);
      place(r, 44, -16.0, Math.PI); // facing the wall at z = -15.5
      run(r, 2);
      if (vr) {
        pressA(r, true);
        run(r, 0.05);
        pressA(r, false);
      } else {
        key('keydown', 'Space');
        key('keyup', 'Space');
      }
      run(r, 1);
      expect(r.p.feetY).toBe(0);
      expect(r.p.water).toBeNull();
      expect(r.p.underwater).toBe(false);
    }
  });

  it('is stable with the largest frame time the game uses', () => {
    const r = make(true, 1.7);
    place(r, 44, -20, Math.PI / 2);
    const s = run(r, 10, 0.05, (t) => {
      const ph = t % 1;
      for (const [i, v] of r.hands.entries()) v.set(i ? 0.25 : -0.25, ph < 0.5 ? 1.5 - ph * 2 : 0.5 + (ph - 0.5) * 2, -0.3);
    });
    expect(s.max).toBeLessThan(0.5);
    expect(s.maxUnder).toBeLessThan(1);
  });
});
