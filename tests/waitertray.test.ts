import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { REFILL_S, TRAY_SLOTS, WaiterTrays } from '../src/client/waitertray';
import { Lounge, type Drink } from '../src/client/lounge';
import { Person, TRAY_R, staffLook, type Crowd } from '../src/client/people';
import type { Grabbable, Hand, Hands } from '../src/client/hands';

/** A waiter with a bare tray (no rig), a fake lounge/crowd/hands around her. */
function setup(opts: { xr?: boolean } = {}) {
  const scene = new THREE.Scene();
  const p = new Person('waiter', staffLook('waiter'));
  p.pos.set(0, 0, 0);
  p.tray = new THREE.Group();
  p.tray.position.set(0.3, 1.3, 0.2);
  scene.add(p.tray);
  const held: Drink[] = [];
  const lounge = {
    trayGlass: (_d: Drink, _on: () => boolean): Grabbable => ({ at: () => new THREE.Vector3(), radius: 0.12, grab: () => null }),
    handOver: (d: Drink) => {
      scene.attach(d.group);
      held.push(d);
      return true;
    },
  } as unknown as Lounge;
  const sentTo: [number, number][] = [];
  const crowd = { now: 0, headTo: (_p: Person, x: number, z: number) => (sentTo.push([x, z]), true) } as unknown as Crowd;
  const grip = new THREE.Group();
  grip.position.set(5, 5, 5);
  scene.add(grip);
  const hand = { grip, ctrl: new THREE.Group() } as unknown as Hand;
  const hands = { hands: [hand] } as unknown as Hands;
  const feet = new THREE.Vector3(1, 0, 1);
  const trays = new WaiterTrays({ crowd, lounge, hands, inXR: () => !!opts.xr, feet: () => feet }, [p]);
  return { p, trays, held, sentTo, grip, scene };
}

describe('waiter trays', () => {
  it('glasses stand on the tray, clear of each other', () => {
    for (const [x, z] of TRAY_SLOTS) expect(Math.hypot(x, z) + 0.036).toBeLessThan(TRAY_R);
    for (let i = 0; i < TRAY_SLOTS.length; i++)
      for (let j = i + 1; j < TRAY_SLOTS.length; j++) expect(Math.hypot(TRAY_SLOTS[i][0] - TRAY_SLOTS[j][0], TRAY_SLOTS[i][1] - TRAY_SLOTS[j][1])).toBeGreaterThan(0.075);
  });

  it('a full tray to start; taking one leaves a gap that refills after a while', () => {
    const { p, trays, held } = setup();
    expect(trays.glasses(p)).toBe(TRAY_SLOTS.length);
    expect(trays.serve(p)).toBe(true);
    expect(held.length).toBe(1);
    expect(trays.glasses(p)).toBe(TRAY_SLOTS.length - 1);
    trays.update(REFILL_S * 0.5);
    expect(trays.glasses(p)).toBe(TRAY_SLOTS.length - 1);
    trays.update(REFILL_S * 0.6);
    expect(trays.glasses(p)).toBe(TRAY_SLOTS.length);
  });

  it('a glass knocked or grabbed off the tray counts as gone', () => {
    const { p, trays, scene } = setup();
    scene.attach(trays.onTray(p)[0].group);
    trays.update(0.01);
    expect(trays.glasses(p)).toBe(TRAY_SLOTS.length - 1);
  });

  it('half empty: she heads for the bar, and tops up there', () => {
    const { p, trays, sentTo } = setup();
    trays.serve(p);
    trays.serve(p);
    trays.update(0.01);
    expect(sentTo.length).toBe(1);
    p.pos.set(Lounge.COUNTER_X + 0.8, 0, (Lounge.COUNTER_Z0 + Lounge.COUNTER_Z1) / 2);
    trays.update(0.01);
    expect(trays.glasses(p)).toBe(TRAY_SLOTS.length);
  });

  it('stops and holds the tray still while your hand is near it (VR)', () => {
    const { p, trays, grip } = setup({ xr: true });
    trays.update(0.01);
    expect(p.pause).toBe(0);
    grip.position.set(0.35, 1.35, 0.25);
    const yaw = p.yaw;
    trays.update(0.01);
    expect(p.pause).toBeGreaterThan(1);
    // Not turning while your hand is at the tray.
    trays.update(0.1);
    expect(p.yaw).toBe(yaw);
  });

  it('an empty tray has nothing to give', () => {
    const { p, trays } = setup();
    for (let i = 0; i < TRAY_SLOTS.length; i++) expect(trays.serve(p)).toBe(true);
    expect(trays.serve(p)).toBe(false);
  });
});
