import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BAR_MENU, DRINKS } from '../src/client/bar';
import { Stock, type SlotSpec } from '../src/client/stock';

/** Just enough of the game for the stock: loose things and glasses that remember what was made. */
function rig() {
  const grabs: { at(): THREE.Vector3; grab(h: unknown): unknown }[] = [];
  const made: { id: string; key: string; gone: boolean; holder: string | null; body: { pos: THREE.Vector3; awake: boolean }; from?: string }[] = [];
  const net: unknown[] = [];
  const feet = new THREE.Vector3(100, 0, 100);
  const loose = {
    items: new Map(),
    holding: false,
    onSpawnFrom: null as ((f: string) => void) | null,
    spawnLive(key: string, x: number, z: number, y: number, o: { from?: string }) {
      const it = { id: `${key}${made.length}`, key, gone: false, holder: null, kind: { key }, body: { pos: new THREE.Vector3(x, y, z), awake: false }, from: o.from };
      made.push(it);
      net.push({ k: 'spawn', from: o.from });
      return it;
    },
    grabbableOf: () => ({ at: () => new THREE.Vector3(), radius: 0.1, grab: () => new THREE.Object3D() }),
    clear(it: { gone: boolean }) {
      it.gone = true;
      return true;
    },
    pickUpDesk(it: { holder: string | null }) {
      it.holder = 'desk';
      loose.holding = true;
    },
  };
  const lounge = { onSpawnFrom: null as ((f: string) => void) | null, handsFull: false, spawnDrink: () => ({ drink: { group: new THREE.Group() }, grab: {} }), clearDrink: () => true, handOver: () => true };
  const crowd = { glasses: new THREE.Object3D(), glassOwners: [], people: [], glassAt: () => null };
  const stock = new Stock({
    hands: { register: (g: never) => grabs.push(g), hands: [] } as never,
    interaction: { register: () => {} } as never,
    loose: loose as never,
    lounge: lounge as never,
    crowd: crowd as never,
    inXR: () => false,
    feet: () => feet,
    sound: { play: () => {} },
  });
  return { stock, loose, made, net, feet, grabs };
}

const slot = (id: string, x: number, restock: number): SlotSpec => ({ id, m: new THREE.Matrix4().makeTranslation(x, 1, 0), give: { loose: 'pizza' }, restock, label: 'Take a slice' });

describe('food and drink on show (stock.ts)', () => {
  it('hands you the real thing and takes it off the display, then sets out a fresh one later', () => {
    const { stock, loose, made } = rig();
    const sh = stock.addShelf('t', new THREE.Group(), null, [slot('a', 0, 30), slot('b', 1, 30)]);
    expect(stock.take(sh.slots[0], 'desk')).toBe(true);
    expect(made.length).toBe(1);
    expect(made[0].from).toBe('a');
    expect(made[0].holder).toBe('desk');
    // Gone from the display: can't be taken twice.
    loose.holding = false;
    expect(stock.take(sh.slots[0], 'desk')).toBe(false);
    // Not restocked before its time...
    for (let t = 0; t < 20; t++) stock.update(1);
    expect(sh.slots[0].takenAt).not.toBeNull();
    // ...then it's back.
    for (let t = 0; t < 15; t++) stock.update(1);
    expect(sh.slots[0].takenAt).toBeNull();
  });

  it('never runs out of what a dispenser gives (a tub in the gelato case)', () => {
    const { stock, loose, made } = rig();
    const sh = stock.addShelf('tubs', new THREE.Group(), null, [slot('tub', 0, 0)]);
    for (let i = 0; i < 3; i++) {
      loose.holding = false;
      expect(stock.take(sh.slots[0], 'desk')).toBe(true);
    }
    expect(made.length).toBe(3);
    expect(sh.slots[0].takenAt).toBeNull();
  });

  it("hides what a friend took (their spawn names the display)", () => {
    const { stock, loose } = rig();
    const sh = stock.addShelf('t', new THREE.Group(), null, [slot('pie0-1', 0, 60)]);
    loose.onSpawnFrom!('pie0-1');
    expect(sh.slots[0].takenAt).not.toBeNull();
  });

  it('clears the oldest things you took once too many are lying about', () => {
    const { stock, loose, made } = rig();
    const specs = Array.from({ length: Stock.MAX_LOOSE + 5 }, (_, i) => slot(`s${i}`, i, 60));
    const sh = stock.addShelf('t', new THREE.Group(), null, specs);
    for (const s of sh.slots) {
      loose.holding = false;
      stock.take(s, 'desk');
      made[made.length - 1].holder = null; // set down
    }
    expect(stock.liveCount.loose).toBe(Stock.MAX_LOOSE);
    expect(made.slice(0, 5).every((m) => m.gone)).toBe(true);
    expect(made.slice(5).every((m) => !m.gone)).toBe(true);
  });
});

describe('the food court sodas', () => {
  it("are drinks you can hold and sip, but not on Bar Lago's menu", () => {
    const sodas = DRINKS.filter((d) => d.offMenu);
    expect(sodas.map((d) => d.name)).toEqual(['Cola', 'Lemonade', 'Iced tea', 'Vanilla shake']);
    for (const d of sodas) {
      expect(d.glass).toBe('cup');
      expect(d.alcohol).toBe(0);
      expect(BAR_MENU).not.toContain(d);
    }
    // Appended after the bar's drinks (indices go to friends, and keys 1-9 order from the menu).
    expect(DRINKS.slice(0, BAR_MENU.length)).toEqual(BAR_MENU);
  });
});
