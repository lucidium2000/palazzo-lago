import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PINCH_HOLD, PinchHold, pinchFinger, replyButtons, replyPrompt } from '../src/client/replyhud';

const pad = (handedness: string, down: number[]) => ({
  handedness,
  gamepad: { buttons: Array.from({ length: 7 }, (_, i) => ({ pressed: down.includes(i) })) },
});

/** Fingertips with the thumb at the origin and finger i at distance d[i-1]. */
function hand(d: number[]) {
  const tips = [new THREE.Vector3(), ...d.map((x, i) => new THREE.Vector3(x, 0, i * 0.001)), new THREE.Vector3(0.09, 0, 0)];
  return { tips, has: [true, true, true, true, true] };
}

describe('reply buttons', () => {
  it('maps A, B and X/Y to replies 1, 2 and 3', () => {
    expect(replyButtons([pad('right', [4])])).toEqual([true, false, false]);
    expect(replyButtons([pad('right', [5])])).toEqual([false, true, false]);
    expect(replyButtons([pad('left', [4])])).toEqual([false, false, true]);
    expect(replyButtons([pad('left', [5])])).toEqual([false, false, true]);
  });
  it('ignores the trigger, grip and stick clicks', () => {
    expect(replyButtons([pad('right', [0, 1, 3]), pad('left', [0, 1, 3])])).toEqual([false, false, false]);
  });
});

describe('pinch finger', () => {
  it('finds the finger touching the thumb', () => {
    const a = hand([0.01, 0.06, 0.07]);
    expect(pinchFinger(a.tips, a.has)).toBe(1);
    const b = hand([0.06, 0.012, 0.07]);
    expect(pinchFinger(b.tips, b.has)).toBe(2);
    const c = hand([0.07, 0.05, 0.011]);
    expect(pinchFinger(c.tips, c.has)).toBe(3);
  });
  it('is none for an open hand, or when two fingers are equally close', () => {
    const open = hand([0.06, 0.07, 0.08]);
    expect(pinchFinger(open.tips, open.has)).toBe(0);
    const both = hand([0.014, 0.016, 0.08]);
    expect(pinchFinger(both.tips, both.has)).toBe(0);
  });
  it('holds a pinch until the fingers part (hysteresis)', () => {
    const loose = hand([0.026, 0.06, 0.07]);
    expect(pinchFinger(loose.tips, loose.has, 0)).toBe(0);
    expect(pinchFinger(loose.tips, loose.has, 1)).toBe(1);
    const apart = hand([0.04, 0.06, 0.07]);
    expect(pinchFinger(apart.tips, apart.has, 1)).toBe(0);
  });
});

describe('pinch hold', () => {
  it('answers once after a short hold', () => {
    const h = new PinchHold();
    expect(h.step(2, 0.1)).toBeNull();
    expect(h.progress(1)).toBeCloseTo(0.1 / PINCH_HOLD);
    expect(h.step(2, 0.1)).toBeNull();
    expect(h.step(2, 0.1)).toBe(1);
    expect(h.step(2, 0.5)).toBeNull();
    expect(h.step(0, 0.1)).toBeNull();
    expect(h.step(1, 0.3)).toBe(0);
  });
  it('a quick tap does nothing', () => {
    const h = new PinchHold();
    expect(h.step(1, 0.1)).toBeNull();
    expect(h.step(0, 0.1)).toBeNull();
    expect(h.step(1, 0.1)).toBeNull();
  });
  it('a pinch already held when the prompt comes up must be let go first', () => {
    const h = new PinchHold();
    h.step(1, 0.05);
    h.block();
    expect(h.step(1, 1)).toBeNull();
    expect(h.step(0, 0.05)).toBeNull();
    expect(h.step(1, 0.3)).toBe(0);
  });
});

describe('reply prompt', () => {
  it('keeps the buttons a moment after it closes', () => {
    replyPrompt.set(true);
    expect(replyPrompt.busy()).toBe(true);
    replyPrompt.set(false);
    expect(replyPrompt.busy()).toBe(true);
    replyPrompt.closedAt -= 1;
    expect(replyPrompt.busy()).toBe(false);
  });
});
