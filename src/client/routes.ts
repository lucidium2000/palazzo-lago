/**
 * The guests' walking routes: a graph of waypoints in open floor, joined
 * wherever the straight line between two of them is clear of furniture, walls
 * and water (nobody strolls into the pool). Pure geometry, so it's testable
 * against the real world layout.
 */

export interface RouteWorld {
  isFree(x: number, z: number, r?: number, seats?: boolean): boolean;
  waterAt(x: number, z: number): number | null;
}

/** Longest straight walk between two waypoints (metres). */
export const MAX_EDGE = 7.5;
/** Half the width a guest needs along a route. */
export const ROUTE_CLEAR = 0.3;

/** Dry footing for a body of radius r at (x, z): no water under it or at its edge. */
export function dry(world: RouteWorld, x: number, z: number, r: number): boolean {
  return world.waterAt(x, z) === null && world.waterAt(x + r, z) === null && world.waterAt(x - r, z) === null && world.waterAt(x, z + r) === null && world.waterAt(x, z - r) === null;
}

/** Can a guest walk the straight line from a to b? */
export function clearLine(world: RouteWorld, ax: number, az: number, bx: number, bz: number, r = ROUTE_CLEAR): boolean {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / 0.3));
  for (let s = 0; s <= n; s++) {
    const t = s / n;
    const x = ax + (bx - ax) * t,
      z = az + (bz - az) * t;
    if (!world.isFree(x, z, r, true) || !dry(world, x, z, r)) return false;
  }
  return true;
}

/** Edges (adjacency lists) between every pair of waypoints within `maxEdge` with a clear, dry line. */
export function linkRoutes(world: RouteWorld, nodes: readonly (readonly [number, number])[], maxEdge = MAX_EDGE): number[][] {
  const edges: number[][] = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const [ax, az] = nodes[i],
        [bx, bz] = nodes[j];
      if (Math.hypot(bx - ax, bz - az) > maxEdge) continue;
      if (!clearLine(world, ax, az, bx, bz)) continue;
      edges[i].push(j);
      edges[j].push(i);
    }
  }
  return edges;
}

/** Which nodes can be reached from `from` (breadth first). */
export function reachable(edges: readonly (readonly number[])[], from: number): boolean[] {
  const seen = edges.map(() => false);
  if (from < 0 || from >= edges.length) return seen;
  const queue = [from];
  seen[from] = true;
  while (queue.length) {
    const i = queue.shift()!;
    for (const j of edges[i])
      if (!seen[j]) {
        seen[j] = true;
        queue.push(j);
      }
  }
  return seen;
}

/** The nodes to walk through from `from` to `to` (excluding `from`), or null when there's no way. */
export function pathTo(edges: readonly (readonly number[])[], from: number, to: number): number[] | null {
  if (from === to) return [];
  const prev = new Int32Array(edges.length).fill(-1);
  prev[from] = from;
  const queue = [from];
  while (queue.length) {
    const i = queue.shift()!;
    for (const j of edges[i]) {
      if (prev[j] !== -1) continue;
      prev[j] = i;
      if (j === to) {
        const out = [j];
        for (let k = i; k !== from; k = prev[k]) out.push(k);
        return out.reverse();
      }
      queue.push(j);
    }
  }
  return null;
}
