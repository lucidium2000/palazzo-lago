import { describe, expect, it } from 'vitest';
import { blankPad } from '../src/client/arcade/types';
import { Machine, deepState, loadDeepState } from '../src/client/arcade/machine';
import { mergePads, packPad, SharedControls } from '../src/client/arcade/net';
import { Sentinel } from '../src/client/arcade/games/sentinel';
import { Prism } from '../src/client/arcade/games/prism';
import { Rake } from '../src/client/arcade/games/rake';
import { Strip } from '../src/client/arcade/games/strip';
import { Velvet } from '../src/client/arcade/games/velvet';
import { Splash } from '../src/client/arcade/games/splash';

const hooks = () => ({ coin: () => true, table: () => [], submit: () => {}, sfx: () => {} });

/** The same scripted hands every frame (both sets), by frame number. */
function hands(m: Machine, f: number) {
  m.pad1.x = Math.sin(f / 17);
  m.pad1.y = Math.cos(f / 23) * 0.8;
  m.pad1.a = f % 13 < 3;
  m.pad1.b = f % 41 === 0;
  m.pad2.x = Math.sin(f / 11);
  m.pad2.a = f % 19 < 2;
}

describe('arcade: shared controls', () => {
  it('merges hands on one set: a button is down if anyone holds it, the stick adds up (clamped)', () => {
    const a = { ...blankPad(), x: 0.7, a: true };
    const b = { ...blankPad(), x: 0.6, y: -0.4, c: true };
    const out = mergePads(blankPad(), [a, b, null]);
    expect(out).toEqual({ x: 1, y: -0.4, a: true, b: false, c: true });
    expect(mergePads(blankPad(), [{ ...blankPad(), x: -0.5 }, { ...blankPad(), x: 0.5 }]).x).toBe(0);
    expect(mergePads(blankPad(), [])).toEqual(blankPad());
  });

  it("merges a friend's pad (by message) with the owner's own on the right set", () => {
    const sc = new SharedControls(2);
    sc.hear('ben', 0, packPad({ ...blankPad(), a: true }), 10);
    sc.hear('cat', 1, packPad({ ...blankPad(), x: 1 }), 10);
    const p0 = sc.merged(blankPad(), 0, { ...blankPad(), x: -1 }, 10.2);
    expect(p0.a).toBe(true);
    expect(p0.x).toBe(-1);
    const p1 = sc.merged(blankPad(), 1, null, 10.2);
    expect(p1.x).toBe(1);
    expect(p1.a).toBe(false);
    // Gone quiet: their hands no longer count.
    expect(sc.merged(blankPad(), 0, null, 12).a).toBe(false);
    sc.hear('ben', 0, packPad({ ...blankPad(), a: true }), 20);
    sc.leave('ben');
    expect(sc.merged(blankPad(), 0, null, 20).a).toBe(false);
  });

  it('hands a game to the friend at the controls (set 0 first, then the lowest id)', () => {
    const sc = new SharedControls(2);
    expect(sc.handTo(5)).toBe(null);
    sc.hear('zed', 1, 0, 5);
    sc.hear('max', 0, 0, 5);
    sc.hear('amy', 1, 0, 5);
    expect(sc.handTo(5.1)).toBe('max');
    sc.leave('max');
    expect(sc.handTo(5.1)).toBe('amy');
    expect(sc.handTo(9)).toBe(null);
  });

  it('when the owner vanishes, exactly one friend at the controls takes over (with a state to carry on from)', () => {
    const forMe = (me: string) => {
      const sc = new SharedControls(1);
      sc.ownerHeard = 10;
      for (const id of ['bob', 'cy', 'ann'].filter((x) => x !== me)) sc.hear(id, 0, 0, 12.5);
      return sc;
    };
    const ids = ['bob', 'cy', 'ann'].filter((x) => x !== 'ann'); // ann is the owner who vanished
    const takers = ids.filter((me) => {
      const sc = forMe(me);
      sc.lastState = { mode: 'play' };
      return sc.shouldTakeOver(me, 'ann', 12.6);
    });
    expect(takers).toEqual(['bob']);
    // Not while the owner is still talking, nor without a state.
    const sc = forMe('bob');
    sc.lastState = { mode: 'play' };
    expect(sc.shouldTakeOver('bob', 'ann', 11)).toBe(false);
    sc.lastState = null;
    expect(sc.shouldTakeOver('bob', 'ann', 12.6)).toBe(false);
  });
});

describe('arcade: handing a running game over', () => {
  const GAMES = { Sentinel, Prism, Rake, Strip, Velvet, Splash };
  for (const [name, G] of Object.entries(GAMES)) {
    it(`${name}: a new owner carries on exactly where the game was`, () => {
      const a = new Machine(new G(), hooks());
      a.pad1.a = true;
      a.update(1 / 60);
      expect(a.mode).toBe('play');
      let f = 0;
      for (; f < 400 && a.mode === 'play'; f++) {
        hands(a, f);
        a.update(1 / 60);
      }
      // Over the wire and back.
      const st = JSON.parse(JSON.stringify(a.saveState()));
      expect(JSON.stringify(st).length).toBeLessThan(60000);
      const b = new Machine(new G(), hooks());
      expect(b.loadState(st)).toBe(true);
      expect(b.mode).toBe(a.mode);
      expect(b.game.score).toBe(a.game.score);
      // Both carry on with the same hands: the same game, frame for frame.
      for (let k = 0; k < 300; k++, f++) {
        hands(a, f);
        hands(b, f);
        a.update(1 / 60);
        b.update(1 / 60);
      }
      const sa: number[] = [];
      const sb: number[] = [];
      a.snapshot(sa);
      b.snapshot(sb);
      expect(b.mode).toBe(a.mode);
      expect(b.game.score).toBe(a.game.score);
      expect(sb).toEqual(sa);
    });
  }

  it('keeps class instances and typed arrays alive when loading (methods still work)', () => {
    class Inner {
      v = 1;
      twice() {
        return this.v * 2;
      }
    }
    const src = { n: 3, inf: -Infinity, arr: [new Inner()], ta: new Float32Array([1, 2]), m: new Map([[1, 'a']]), fn: () => 1 };
    src.arr[0].v = 7;
    const data = JSON.parse(JSON.stringify(deepState(src)));
    const dst = { n: 0, inf: 0, arr: [new Inner()], ta: new Float32Array(2), m: new Map(), fn: () => 2 };
    loadDeepState(dst, data);
    expect(dst.n).toBe(3);
    expect(dst.inf).toBe(-Infinity);
    expect(dst.arr[0].twice()).toBe(14);
    expect(dst.ta).toBeInstanceOf(Float32Array);
    expect([...dst.ta]).toEqual([1, 2]);
    expect(dst.m.get(1)).toBe('a');
    expect(dst.fn()).toBe(2);
  });

  it('hands over mid initials entry', () => {
    const a = new Machine(new Prism(), hooks());
    (a as unknown as { mode: string }).mode = 'initials';
    (a as unknown as { entry: unknown }).entry = null;
    a.loadState({ ...a.saveState(), mode: 'initials', entry: { text: 'BEN', pos: 2 } });
    expect(a.initialsText).toBe('BEN');
    const b = new Machine(new Prism(), hooks());
    b.loadState(JSON.parse(JSON.stringify(a.saveState())));
    expect(b.mode).toBe('initials');
    expect(b.initialsText).toBe('BEN');
  });
});
