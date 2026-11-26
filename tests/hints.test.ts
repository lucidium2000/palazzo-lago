import { describe, expect, it } from 'vitest';
import { HintQueue, localHintStore, type HintStore } from '../src/client/hintqueue';

/** An in-memory stand-in for localStorage (shared between queues = "the same device"). */
function memStore(init: { seen: string[]; off: boolean } | null = null) {
  const box = { v: init };
  const store: HintStore = { load: () => (box.v ? { seen: [...box.v.seen], off: box.v.off } : null), save: (s) => (box.v = { seen: [...s.seen], off: s.off }) };
  return { store, box };
}

/** Runs the queue for `secs`, asking for `ids` every 0.25 s; returns the ids that came up, in order. */
function run(q: HintQueue<number>, secs: number, ids: () => string[]) {
  const shown: string[] = [];
  let ask = 0;
  for (let t = 0; t < secs; t += 0.05) {
    if ((ask -= 0.05) <= 0) {
      ask = 0.25;
      for (const id of ids()) q.want(id, 0);
    }
    const c = q.update(0.05);
    if (c && shown[shown.length - 1] !== c.id) shown.push(c.id);
  }
  return shown;
}

describe('first-time hints', () => {
  it('shows a hint once, then never again (on this device, across sessions)', () => {
    const { store, box } = memStore();
    const q = new HintQueue<number>(store);
    expect(run(q, 6, () => ['pool'])).toEqual(['pool']);
    // Still swimming: no repeat.
    expect(run(q, 20, () => ['pool'])).toEqual([]);
    expect(box.v?.seen).toContain('pool');
    // A new session on the same device remembers it.
    const again = new HintQueue<number>(store);
    expect(again.seenBefore('pool')).toBe(true);
    expect(again.want('pool', 0)).toBe(false);
    expect(run(again, 10, () => ['pool'])).toEqual([]);
  });

  it('shows one at a time for about 4 s, with a fade, and a cooldown before the next', () => {
    const { store } = memStore();
    const q = new HintQueue<number>(store, { show: 4, fade: 0.5, cooldown: 6 });
    q.want('a', 0);
    q.want('b', 0);
    const a = q.update(0.01)!;
    expect(a.id).toBe('a');
    expect(a.alpha).toBeLessThan(0.1);
    expect(q.update(1)!.alpha).toBe(1);
    // Up for 4 s in all; b waits (kept fresh), through the cooldown.
    let t = 1.01;
    let firstB = -1;
    while (t < 16) {
      q.want('b', 0);
      const c = q.update(0.1);
      t += 0.1;
      if (c?.id === 'b' && firstB < 0) firstB = t;
      if (t > 1.2 && t < 3.9) expect(c?.id).toBe('a');
      if (t > 4.1 && t < 9.9) expect(c).toBeNull();
    }
    expect(firstB).toBeGreaterThan(9.9);
    expect(firstB).toBeLessThan(10.3);
  });

  it('never piles up: many situations at once still come one by one', () => {
    const { store } = memStore();
    const q = new HintQueue<number>(store, { show: 4, cooldown: 6 });
    let maxUp = 0;
    const ids = ['a', 'b', 'c', 'd'];
    const shown = run(q, 50, () => {
      maxUp = Math.max(maxUp, q.current ? 1 : 0);
      return ids;
    });
    expect(shown).toEqual(ids);
    expect(maxUp).toBe(1);
  });

  it('drops a queued hint whose moment has passed, without remembering it', () => {
    const { store } = memStore();
    const q = new HintQueue<number>(store, { show: 4, cooldown: 6, stale: 1 });
    q.want('a', 0);
    q.want('piano', 0); // walked past the piano while "a" was up...
    run(q, 12, () => []); // ...and left
    expect(q.seenBefore('piano')).toBe(false);
    expect(q.waiting).toBe(0);
    // Back at the piano: now it shows.
    expect(run(q, 5, () => ['piano'])).toEqual(['piano']);
  });

  it('"Show hints" off shows nothing (and is remembered); reset brings them all back', () => {
    const { store, box } = memStore();
    const q = new HintQueue<number>(store);
    run(q, 5, () => ['a']);
    q.enabled = false;
    expect(box.v?.off).toBe(true);
    expect(run(q, 30, () => ['b', 'c'])).toEqual([]);
    expect(new HintQueue<number>(store).enabled).toBe(false);
    q.enabled = true;
    q.reset();
    expect(q.seenBefore('a')).toBe(false);
    expect(box.v?.seen).toEqual([]);
    expect(run(q, 5, () => ['a'])).toEqual(['a']);
  });

  it('turning hints off clears the one showing', () => {
    const q = new HintQueue<number>(memStore().store);
    q.want('a', 1);
    expect(q.update(0.1)?.id).toBe('a');
    q.enabled = false;
    expect(q.update(0.1)).toBeNull();
  });

  it('the localStorage store survives storage that throws or holds junk', () => {
    const g = globalThis as unknown as { localStorage?: unknown };
    const had = g.localStorage;
    try {
      g.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
      expect(localHintStore.load()).toBeNull();
      expect(() => localHintStore.save({ seen: ['a'], off: false })).not.toThrow();
      const q = new HintQueue<number>(localHintStore);
      expect(run(q, 5, () => ['a'])).toEqual(['a']);
      g.localStorage = { getItem: () => '{not json', setItem: () => {} };
      expect(localHintStore.load()).toBeNull();
      g.localStorage = { getItem: () => JSON.stringify({ seen: ['a', 3, null], off: 'yes' }), setItem: () => {} };
      expect(localHintStore.load()).toEqual({ seen: ['a'], off: false });
    } finally {
      g.localStorage = had;
    }
  });

  it('holds new hints back while told to (a reply prompt is up), then shows them', () => {
    const q = new HintQueue<number>(memStore().store, { stale: 100 });
    q.want('a', 0);
    expect(q.update(0.1, true)).toBeNull();
    expect(q.update(0.1, true)).toBeNull();
    expect(q.update(0.1)?.id).toBe('a');
    // One already up keeps going through a hold.
    expect(q.update(1, true)?.id).toBe('a');
  });
});
