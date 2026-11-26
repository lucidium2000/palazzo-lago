import { describe, expect, it } from 'vitest';
import { controllerPose, isOpenHand, isPointing, type FingerPose } from '../src/client/fingers';

/** A Touch controller's buttons: trigger, grip (values 0..1), nothing else pressed. */
const pad = (trigger: number, grip: number) =>
  ({ buttons: [{ value: trigger, pressed: trigger > 0.5, touched: trigger > 0 }, { value: grip, pressed: grip > 0.5, touched: grip > 0 }, {}, {}, {}, {}, {}] }) as unknown as Gamepad;

describe('only a point bets', () => {
  it('controllers: grip squeezed with the finger off the trigger is a point', () => {
    expect(isPointing(controllerPose(pad(0, 1)))).toBe(true);
    expect(isPointing(controllerPose(pad(0, 0.7)))).toBe(true);
  });
  it('controllers: a resting (open) hand, a fist, a half grip are not', () => {
    expect(isPointing(controllerPose(pad(0, 0)))).toBe(false);
    expect(isOpenHand(controllerPose(pad(0, 0)))).toBe(true);
    expect(isPointing(controllerPose(pad(1, 1)))).toBe(false);
    expect(isPointing(controllerPose(pad(0.3, 1)))).toBe(false);
    expect(isPointing(controllerPose(pad(0, 0.2)))).toBe(false);
  });
  it('tracked hands: index straight and the rest curled', () => {
    const point: FingerPose = [0.6, 0.1, 0.8, 0.85, 0.8];
    const flat: FingerPose = [0.1, 0.05, 0.08, 0.1, 0.1];
    const fist: FingerPose = [0.9, 0.9, 0.95, 0.95, 0.9];
    const relaxed: FingerPose = [0.3, 0.3, 0.35, 0.4, 0.45];
    expect(isPointing(point)).toBe(true);
    expect([flat, fist, relaxed].map(isPointing)).toEqual([false, false, false]);
    expect(isOpenHand(flat)).toBe(true);
    expect(isOpenHand(point)).toBe(false);
  });
});
