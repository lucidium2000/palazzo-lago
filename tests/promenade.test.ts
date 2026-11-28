import { describe, expect, it } from 'vitest';
import { World } from '../src/client/world';
import { CLERK_LINES, COOK_LINES, promenadeLines } from '../src/client/promenadelines';
import { SPEAKERS } from '../src/client/cast';
import { STAFF } from '../src/client/speech';
import { REACTIONS } from '../src/client/reactlines';
import { registerHall } from '../src/client/casino';
import { registerAreas } from '../src/client/areas';
import {
  ARCADE,
  ARCADE_SLOT_SPECS,
  CHANGE_MACHINE,
  COUNTER_FRONT,
  COUNTERS,
  FOOD,
  inArcade,
  inStore,
  MERCH,
  PROM,
  PROM_CARS,
  PROMENADE_NODES,
  PROMENADE_SURFACES,
  servePoint,
  STORE,
  STORE_FIX,
  storeStock,
  TABLES,
} from '../src/client/areas/promenadeplan';
import { linkRoutes, reachable } from '../src/client/routes';
import { destSlot, floorLabel, floorsBetween, isLanding, LANDINGS, type CarRef, type LandingId } from '../src/client/areas/liftlogic';
import { biteScale } from '../src/client/promenadeprops';

function resort() {
  const w = new World();
  registerHall(w, { columns: [], planters: [] } as never);
  registerAreas(w);
  return w;
}

describe('the Promenade floor plan', () => {
  const w = resort();

  it('steps out of each elevator onto open floor', () => {
    for (const z of PROM_CARS.zs) {
      expect(w.isFree(PROM_CARS.doorX - 0.7, z, 0.25)).toBe(true);
      expect(w.isFree(PROM_CARS.doorX - 2.6, z, 0.25)).toBe(true);
    }
  });

  it('walks to the food court, into the boutique and the arcade', () => {
    const edges = linkRoutes(w, PROMENADE_NODES);
    const seen = reachable(edges, 0);
    expect(PROMENADE_NODES.filter((_, i) => !seen[i])).toEqual([]);
    for (const [x, z] of PROMENADE_NODES) expect(w.isFree(x, z, 0.3, true)).toBe(true);
    expect(PROMENADE_NODES.some(([x, z]) => x > STORE.x0 && x < STORE.x1 && z > STORE.z0 + 1)).toBe(true);
    expect(PROMENADE_NODES.some(([x, z]) => inArcade(x, z) && z > ARCADE.z0 + 1)).toBe(true);
  });

  it('keeps you out of the kitchens but lets you reach the counter top', () => {
    for (const c of COUNTERS) {
      expect(w.isInside(c.x, COUNTER_FRONT - 0.3)).toBe(false);
      // Stand at the counter: the food comes down within arm's reach.
      const sp = servePoint(c, 0);
      expect(w.isFree(sp.x, COUNTER_FRONT + 0.3, 0.25)).toBe(true);
      expect(Math.abs(sp.z - (COUNTER_FRONT + 0.3))).toBeLessThan(0.7);
      // ...and it lands on the counter's top.
      expect(PROMENADE_SURFACES().some((s) => s.kind === 'box' && Math.abs(s.x - sp.x) <= s.w / 2 && Math.abs(s.z - sp.z) <= s.d / 2 && s.y === sp.y)).toBe(true);
    }
  });

  it('has a stool to sit on round every food court table', () => {
    const stools = w.colliders().seats.filter((s) => s.x < -500);
    expect(stools.length).toBe(TABLES.length * 4);
    for (const s of stools) {
      expect(w.isInside(s.x, s.z)).toBe(true);
      expect(s.yaw).not.toBeNull();
    }
  });

  it('gives the arcade its bays: inside the room, apart, each with room to stand at it', () => {
    expect(ARCADE_SLOT_SPECS.filter((s) => s.kind === 'cabinet').length).toBeGreaterThanOrEqual(6);
    expect(ARCADE_SLOT_SPECS.filter((s) => s.kind === 'floor').length).toBeGreaterThanOrEqual(2);
    const corners = (s: (typeof ARCADE_SLOT_SPECS)[number]) => {
      const [fw, fd] = s.footprint;
      const c = Math.cos(s.yaw),
        n = Math.sin(s.yaw);
      return [
        [-fw / 2, -fd / 2],
        [fw / 2, -fd / 2],
        [-fw / 2, fd / 2],
        [fw / 2, fd / 2],
      ].map(([lx, lz]) => [s.x + lx * c + lz * n, s.z - lx * n + lz * c]);
    };
    for (const s of ARCADE_SLOT_SPECS) {
      for (const [x, z] of corners(s)) {
        expect(x).toBeGreaterThanOrEqual(ARCADE.x0 - 1e-6);
        expect(x).toBeLessThanOrEqual(ARCADE.x1 + 1e-6);
        expect(z).toBeGreaterThanOrEqual(ARCADE.z0);
        expect(z).toBeLessThanOrEqual(ARCADE.z1 + 1e-6);
      }
      // Its front: a player stands there.
      const fx = s.x + Math.sin(s.yaw) * (s.footprint[1] / 2 + 0.45),
        fz = s.z + Math.cos(s.yaw) * (s.footprint[1] / 2 + 0.45);
      expect(w.isFree(fx, fz, 0.25)).toBe(true);
      // The bay is solid (its collider covers the footprint).
      expect(w.isFree(s.x, s.z, 0.1)).toBe(false);
    }
    expect(inArcade(CHANGE_MACHINE.x, CHANGE_MACHINE.z)).toBe(true);
  });

  it('stocks the boutique on its tables, shelves and counter', () => {
    const stock = storeStock();
    for (const k of Object.keys(MERCH)) expect(stock.some((s) => s.key === k)).toBe(true);
    const tops = PROMENADE_SURFACES();
    for (const s of stock) {
      expect(s.x).toBeGreaterThan(STORE.x0);
      expect(s.x).toBeLessThan(STORE.x1);
      expect(tops.some((t) => t.kind === 'box' && t.y === s.y && Math.abs(s.x - t.x) < Math.max(t.w, t.d) / 2 + 0.01 && Math.abs(s.z - t.z) < Math.max(t.w, t.d) / 2 + 0.01)).toBe(true);
    }
  });

  it("hangs the boutique's mirror on its back wall, with room to stand in front of it", () => {
    const mr = STORE_FIX.mirror;
    expect(inStore(mr.x, mr.z - 0.01)).toBe(true);
    expect(STORE.z1 - mr.z).toBeLessThan(0.1);
    expect(mr.x - mr.w / 2).toBeGreaterThan(STORE_FIX.counter.x + STORE_FIX.counter.w / 2);
    // Eye height falls inside it, and you can walk right up to it.
    expect(mr.y + mr.h / 2).toBeGreaterThan(1.8);
    expect(mr.y - mr.h / 2).toBeLessThan(0.6);
    expect(w.isFree(mr.x, mr.z - 0.9, 0.25)).toBe(true);
  });

  it('lies far from everything else (its own floor)', () => {
    expect(PROM.x1).toBeLessThan(-500);
    expect(w.isInside(0, 0)).toBe(true);
    // Nothing of the Promenade's is walkable near the casino and vice versa (x = -300 is Palazzo Lanes now: its own floor too).
    expect(w.isInside(-200, 0)).toBe(false);
    expect(w.isInside(-450, 0)).toBe(false);
  });
});

describe('Promenade elevators', () => {
  // The real layout's cars in their slot order: casino ×4, pool ×2, suite, promenade ×2.
  const CARS: CarRef[] = [
    ...[2.2, 4.75, 7.25, 9.8].map((z, i) => ({ landing: 'casino' as const, index: i, slot: i, x: 42, z })),
    ...[-7.6, -5].map((z, i) => ({ landing: 'pool' as const, index: i, slot: 4 + i, x: 48, z })),
    { landing: 'suite' as const, index: 0, slot: 6, x: 600, z: 3.4 },
    ...PROM_CARS.zs.map((z, i) => ({ landing: 'promenade' as const, index: i, slot: 7 + i, x: PROM_CARS.doorX, z })),
  ];
  const all: LandingId[] = ['casino', 'pool', 'suite', 'promenade'];

  it('reaches the Promenade from every landing, and every landing from it', () => {
    for (const from of CARS)
      for (const dest of all) {
        const to = CARS[destSlot(CARS, from, dest)];
        expect(to.landing).toBe(dest);
      }
    expect(destSlot(CARS, CARS[3], 'promenade')).toBe(8); // casino car 3 → the last promenade car
    expect(destSlot(CARS, CARS[8], 'casino')).toBe(1);
    expect(isLanding('promenade')).toBe(true);
  });

  it('counts C, M on the way up (the pool deck is the casino floor)', () => {
    expect(LANDINGS.promenade.short).toBe('M');
    expect(floorLabel(LANDINGS.promenade.floor)).toBe('M');
    expect(floorsBetween(LANDINGS.casino.floor, LANDINGS.promenade.floor).map(floorLabel)).toEqual(['C', 'M']);
    expect(floorLabel(32)).toBe('32');
  });
});

describe('food', () => {
  it('gets smaller with every bite and is never invisible before the last', () => {
    for (const f of Object.values(FOOD)) {
      let prev = biteScale(f.bites, f.bites);
      expect(prev).toBe(1);
      for (let n = f.bites - 1; n >= 1; n--) {
        const s = biteScale(n, f.bites);
        expect(s).toBeLessThan(prev);
        expect(s).toBeGreaterThan(0.4);
        prev = s;
      }
    }
  });
});

describe('Promenade staff voices', () => {
  const ids = ['cook_pizza', 'cook_burger', 'cook_noodles', 'cook_gelato', 'clerk'] as const;

  it('every dish on every counter has its own order and ready lines (fixed strings to record)', () => {
    for (const c of COUNTERS) {
      const l = COOK_LINES[c.id as keyof typeof COOK_LINES];
      expect(l, c.id).toBeTruthy();
      for (const it of c.items) {
        expect(l.order[it.name]?.length, `${c.id} order ${it.name}`).toBeGreaterThan(0);
        expect(l.ready[it.name]?.length, `${c.id} ready ${it.name}`).toBeGreaterThan(0);
      }
      expect(l.hello.length && l.busy.length && l.broke.length).toBeTruthy();
    }
    for (const k of Object.keys(MERCH)) expect(CLERK_LINES.paid[k as keyof typeof MERCH].length, k).toBeGreaterThan(0);
  });

  it('each speaker has a cast entry, a stand-in voice and reactions', () => {
    const lines = promenadeLines();
    for (const id of ids) {
      expect(SPEAKERS.find((s) => s.id === id)?.voiceHint, id).toBeTruthy();
      expect((STAFF as Record<string, string>)[id], id).toBeTruthy();
      expect(lines[id].length, id).toBeGreaterThan(5);
      for (const k of ['pushed', 'punched', 'doused', 'hit', 'security'] as const) expect(REACTIONS[id]?.[k]?.length, `${id} ${k}`).toBeGreaterThan(0);
    }
  });
});

describe('Promenade ambience', () => {
  it('renders quiet, finite, seamless loops', async () => {
    const { renderMurmur, renderSizzle, renderArcadeBed } = await import('../src/client/promenadeaudio');
    for (const f of [renderMurmur, renderSizzle, renderArcadeBed]) {
      const sr = 8000;
      const a = f(sr, 2);
      expect(a.length).toBe(sr * 2);
      let peak = 0;
      for (const v of a) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
      expect(peak).toBeGreaterThan(0.3);
      expect(peak).toBeLessThanOrEqual(0.5 + 1e-6);
    }
  });
});
