import { describe, expect, it } from 'vitest';
import { DUCK_DB, Ducker, MIC_KEEP, MIC_LEAVE, MIC_REACH, MicProximity, SELF_MONITOR, VoiceActivity, canGrabMic, dbToGain, friendRoute, gainToDb, micReach, rms } from '../src/client/party/micstate';

const mic = { x: 43.3, y: 2.12, z: -32.02 };
const at = (dx: number, dy: number, dz: number) => ({ x: mic.x + dx, y: mic.y + dy, z: mic.z + dz });

describe('stage mic proximity', () => {
  it('VR: on within ~35 cm of the mic, in any direction', () => {
    expect(micReach(at(0.2, 0.1, -0.2), mic, false)).toBeLessThan(1);
    expect(micReach(at(0, 0, -0.34), mic, false)).toBeLessThan(1);
    expect(micReach(at(0, 0, -0.36), mic, false)).toBeGreaterThan(1);
    expect(micReach(at(0, 0.4, 0), mic, false)).toBeGreaterThan(1);
  });

  it('screens: measured across the floor, with a band for (fixed) eye height', () => {
    // A desktop player behind the stand: eyes 13 cm above the mic, 30 cm back (the pole keeps them there).
    expect(micReach(at(0, 0.13, -0.3), mic, true)).toBeLessThan(1);
    expect(micReach(at(0.45, 0.13, 0), mic, true)).toBeLessThan(1);
    expect(micReach(at(0, 0.13, -0.6), mic, true)).toBeGreaterThan(1);
    // Standing on the deck below the stage: too low.
    expect(micReach(at(0, -0.6, 0.3), mic, true)).toBeGreaterThan(1);
  });

  it('steps on at the reach and off only past the hysteresis', () => {
    const p = new MicProximity();
    expect(p.update(at(0, 0, -0.5), mic, false)).toBe(false);
    expect(p.update(at(0, 0, -0.3), mic, false)).toBe(true);
    // Leaning back a little stays on.
    expect(p.update(at(0, 0, -MIC_REACH * (MIC_LEAVE - 0.05)), mic, false)).toBe(true);
    expect(p.update(at(0, 0, -MIC_REACH * (MIC_LEAVE + 0.05)), mic, false)).toBe(false);
    // Holding the mic: it's wherever your hand is (the same rule, the mic moved).
    const held = { x: 10, y: 1.5, z: 3 };
    expect(p.update({ x: 10, y: 1.62, z: 3.15 }, held, false)).toBe(true);
  });

  it('keeps its own stream only near the stage', () => {
    expect(MIC_KEEP).toBeGreaterThan(MIC_REACH * MIC_LEAVE * 4);
  });
});

describe('voice activity', () => {
  it('starts on a word and holds through short gaps', () => {
    const v = new VoiceActivity(0.03, 0.015, 0.4);
    expect(v.update(1 / 60, 0.005)).toBe(false);
    expect(v.update(1 / 60, 0.08)).toBe(true);
    // A 0.3 s gap between words.
    for (let i = 0; i < 18; i++) v.update(1 / 60, 0.002);
    expect(v.active).toBe(true);
    // In-between levels (a trailing syllable) keep it on.
    for (let i = 0; i < 60; i++) v.update(1 / 60, 0.02);
    expect(v.active).toBe(true);
    // Half a second of quiet: stopped.
    for (let i = 0; i < 30; i++) v.update(1 / 60, 0.002);
    expect(v.active).toBe(false);
  });

  it('measures RMS', () => {
    expect(rms([0.5, -0.5, 0.5, -0.5])).toBeCloseTo(0.5);
    expect(rms([])).toBe(0);
  });
});

describe('ducking envelope', () => {
  it('dips ~6 dB fast while talking and recovers slowly', () => {
    const d = new Ducker();
    expect(DUCK_DB).toBe(-6);
    let t = 0;
    while (t < 0.25) {
      d.update(1 / 60, true);
      t += 1 / 60;
    }
    // Within a quarter second: most of the way down.
    expect(gainToDb(d.gain)).toBeLessThan(-5);
    for (let i = 0; i < 120; i++) d.update(1 / 60, true);
    expect(d.gain).toBeCloseTo(dbToGain(-6), 3);
    // Stopped talking: after a quarter second it's still well down (a slow release)...
    for (let i = 0; i < 15; i++) d.update(1 / 60, false);
    expect(gainToDb(d.gain)).toBeLessThan(-3);
    // ...and back to full after a few seconds.
    for (let i = 0; i < 300; i++) d.update(1 / 60, false);
    expect(d.gain).toBe(1);
  });

  it('never overshoots, even on a long frame', () => {
    const d = new Ducker();
    d.update(5, true);
    expect(d.gain).toBeCloseTo(dbToGain(-6), 4);
    d.update(5, false);
    expect(d.gain).toBe(1);
  });
});

describe('who has the mic', () => {
  it('VR: the stand mic lifts off only while it is on its stand and he is not singing', () => {
    expect(canGrabMic(true, false)).toBe(true);
    expect(canGrabMic(true, true)).toBe(false);
    expect(canGrabMic(false, false)).toBe(false);
  });

  it("routes a friend's voice through the PA or their avatar, never both", () => {
    expect(friendRoute(true, true)).toBe('pa');
    expect(friendRoute(false, true)).toBe('avatar');
    expect(friendRoute(true, false)).toBe('none');
  });

  it('you hear yourself a little quieter than your friends hear you', () => {
    expect(SELF_MONITOR).toBeLessThan(1);
    expect(gainToDb(SELF_MONITOR)).toBeGreaterThan(-8);
  });
});
