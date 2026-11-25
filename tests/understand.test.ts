import { describe, expect, it } from 'vitest';
import { interpret, stance, yesNo } from '../src/client/understand';
import { OPENERS } from '../src/client/dialogueLines';

describe('understanding voice replies', () => {
  it('hears yes and no', () => {
    expect(yesNo('yeah sure')).toBe('yes');
    expect(yesNo('yes please')).toBe('yes');
    expect(yesNo('uh huh')).toBe('yes');
    expect(yesNo('no thanks')).toBe('no');
    expect(yesNo("nah I'm good")).toBe('no');
    expect(yesNo('not really')).toBe('no');
    expect(yesNo('the weather')).toBeNull();
  });

  it('reads reply labels', () => {
    expect(stance('Yes, please')).toBe('yes');
    expect(stance("I'm good, thanks")).toBe('no');
    expect(stance('Maybe later')).toBe('no');
    expect(stance('Craps')).toBeNull();
  });

  it('picks the reply you meant', () => {
    const waiter = [{ label: 'Yes, please' }, { label: "I'm good, thanks" }];
    expect(interpret('yeah', waiter)).toBe(0);
    expect(interpret('no thank you', waiter)).toBe(1);
    const game = [{ label: 'Craps' }, { label: 'Roulette' }, { label: 'Slots' }];
    expect(interpret('I play craps mostly', game)).toBe(2 - 2);
    expect(interpret('slots', game)).toBe(2);
    expect(interpret('blah blah', game)).toBeNull();
    const bar = [{ label: 'Surprise me' }, { label: "What's popular?" }, { label: 'Just looking' }];
    expect(interpret('surprise me', bar)).toBe(0);
    expect(interpret("what's popular", bar)).toBe(1);
    expect(interpret('no just looking', bar)).toBe(2);
  });

  it('every yes/no question in the game has a yes and a no', () => {
    // Two-way questions where one side agrees: "yes" or "no" should always land somewhere.
    for (const list of Object.values(OPENERS))
      for (const n of list) {
        const r = n.replies ?? [];
        if (r.length !== 2) continue;
        const y = interpret('yes', r),
          no = interpret('no', r);
        if (y !== null || no !== null) expect(y).not.toBe(no);
      }
  });
});
