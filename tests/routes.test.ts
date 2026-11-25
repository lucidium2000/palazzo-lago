import { describe, expect, it } from 'vitest';
import { World } from '../src/client/world';
import { registerHall } from '../src/client/casino';
import { AREA_NODES, registerAreas } from '../src/client/areas';
import { DECK, POOL } from '../src/client/areas/pool';
import { clearLine, dry, linkRoutes, pathTo, reachable } from '../src/client/routes';

/** The real layout: casino hall walls, hotel, pool deck with all its furniture. */
function resort() {
  const w = new World();
  registerHall(w, { columns: [], planters: [] } as never);
  registerAreas(w);
  return w;
}

const onDeck = ([x, z]: readonly [number, number]) => x > DECK.x0 && x < DECK.x1 && z < DECK.z1 && z > DECK.z0;

describe('walking routes', () => {
  const w = resort();
  const edges = linkRoutes(w, AREA_NODES);
  // AREA_NODES[0] is the corridor end at the casino's east door.
  const seen = reachable(edges, 0);

  it('reaches every node from the casino (nothing isolated, the deck included)', () => {
    const lost = AREA_NODES.filter((_, i) => !seen[i]);
    expect(lost).toEqual([]);
    expect(edges.every((e) => e.length > 0)).toBe(true);
  });

  it('has a real loop on the pool deck', () => {
    const deck = AREA_NODES.map((n, i) => [n, i] as const).filter(([n]) => onDeck(n));
    expect(deck.length).toBeGreaterThanOrEqual(25);
    const deckEdges = deck.reduce((a, [, i]) => a + edges[i].filter((j) => onDeck(AREA_NODES[j])).length, 0) / 2;
    // A tree would have n - 1 edges; loops round the pool need more.
    expect(deckEdges).toBeGreaterThan(deck.length);
    // Both long sides of the pool have poolside nodes.
    expect(deck.some(([[x, z]]) => z > POOL.z + POOL.d / 2 && z < POOL.z + POOL.d / 2 + 1 && x > POOL.x - 5 && x < POOL.x + 5)).toBe(true);
    expect(deck.some(([[x, z]]) => z < POOL.z - POOL.d / 2 && z > POOL.z - POOL.d / 2 - 1 && x > POOL.x - 5 && x < POOL.x + 5)).toBe(true);
  });

  it('never walks through water or furniture', () => {
    for (const [i, [ax, az]] of AREA_NODES.entries()) {
      expect(w.isFree(ax, az, 0.3, true)).toBe(true);
      expect(dry(w, ax, az, 0.3)).toBe(true);
      for (const j of edges[i]) {
        const [bx, bz] = AREA_NODES[j];
        // Sample finely along every edge: free of colliders (seats included) and dry.
        for (let t = 0; t <= 1; t += 0.02) {
          const x = ax + (bx - ax) * t,
            z = az + (bz - az) * t;
          expect(w.waterAt(x, z)).toBeNull();
          expect(w.isFree(x, z, 0.25, true)).toBe(true);
        }
      }
    }
  });

  it('refuses a line across the pool and one through the pool bar', () => {
    expect(clearLine(w, 36, -14.85, 36, -25.15)).toBe(false);
    expect(clearLine(w, 26, -26, 31, -26)).toBe(false);
  });
});

describe('route planning', () => {
  it('finds a way from the casino door to the far side of the pool deck', () => {
    const w = resort();
    const edges = linkRoutes(w, AREA_NODES);
    const far = AREA_NODES.findIndex(([x, z]) => x === 45.5 && z === -29);
    const path = pathTo(edges, 0, far)!;
    expect(path).not.toBeNull();
    expect(path[path.length - 1]).toBe(far);
    // Every step is an edge.
    let at = 0;
    for (const n of path) {
      expect(edges[at]).toContain(n);
      at = n;
    }
    expect(pathTo([[1], [0], []], 0, 2)).toBeNull();
  });
});
