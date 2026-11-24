import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Throwables } from '../src/client/throwables';
import { World } from '../src/client/world';

function setup() {
  const scene = new THREE.Scene();
  const world = new World();
  world.addWalkable(-5, 5, -5, 5);
  const played: string[] = [];
  const sound = { play: (n: string) => played.push(n) } as never;
  const camera = new THREE.PerspectiveCamera();
  const t = new Throwables({ scene, world, sound, camera });
  const glass = new THREE.Group();
  scene.add(glass);
  return { scene, world, t, glass, played };
}

const run = (t: Throwables, secs: number) => {
  for (let i = 0; i < secs * 60; i++) t.update(1 / 60);
};

describe('throwables', () => {
  it('a gentle toss lands on the floor and settles (unbroken)', () => {
    const { scene, t, glass } = setup();
    glass.position.set(0, 0.4, 0);
    let settled = false;
    t.throw(glass, new THREE.Vector3(0.5, 0.5, 0), { fragile: true, onSettle: () => (settled = true) });
    run(t, 3);
    expect(settled).toBe(true);
    expect(glass.parent).toBe(scene);
    expect(glass.position.y).toBeCloseTo(0, 3);
    expect(t.flying(glass)).toBe(false);
  });

  it('a hard throw at the floor breaks the glass', () => {
    const { t, glass, played } = setup();
    glass.position.set(0, 1.5, 0);
    let broke = false;
    t.throw(glass, new THREE.Vector3(1, -6, 0), { fragile: true, liquid: 0xff0000, onBreak: () => (broke = true) });
    run(t, 1);
    expect(broke).toBe(true);
    expect(glass.parent).toBeNull();
    expect(played).toContain('shatter');
  });

  it('walls turn it back', () => {
    const { t, glass } = setup();
    glass.position.set(4, 1.2, 0);
    t.throw(glass, new THREE.Vector3(3, 0.5, 0), { fragile: false });
    run(t, 3);
    expect(glass.position.x).toBeLessThanOrEqual(5);
  });

  it('can be caught mid-air', () => {
    const { t, glass } = setup();
    glass.position.set(0, 1.5, 0);
    t.throw(glass, new THREE.Vector3(0, 2, 0));
    run(t, 0.1);
    t.catch(glass);
    const y = glass.position.y;
    run(t, 1);
    expect(glass.position.y).toBe(y);
  });
});
