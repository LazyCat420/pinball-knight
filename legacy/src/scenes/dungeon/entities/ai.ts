/**
 * Zombie pathing — a BFS flow field.
 *
 * Once per FLOW_INTERVAL (not per frame), core.ts runs one BFS from the
 * player's tile across the whole walkable grid, producing a distance-to-player
 * field. Every zombie then just walks downhill on that field. One BFS serves
 * the entire horde — no A* per zombie per frame — and it gives every zombie
 * correct maze-aware pathing that scales to hundreds of actors.
 *
 * DOM- and three-free on purpose: this is a tested module.
 */
import { type Grid, type TilePos, idx, isWalkable } from "../maze/generator";

/**
 * Distance (in tiles) from every walkable tile to (si, sj).
 * Unreachable / wall tiles are -1.
 */
export function bfsDistances(g: Grid, si: number, sj: number): Int32Array {
  const dist = new Int32Array(g.w * g.h).fill(-1);
  if (!isWalkable(g, si, sj)) return dist;

  // Plain array queue with a moving head — fast enough at our grid sizes and
  // no allocation churn.
  const queue: number[] = [idx(g, si, sj)];
  dist[queue[0]] = 0;
  let head = 0;

  while (head < queue.length) {
    const cur = queue[head++];
    const ci = cur % g.w;
    const cj = (cur - ci) / g.w;
    const d = dist[cur] + 1;

    // 4-neighbourhood; diagonals would let zombies clip wall corners.
    if (isWalkable(g, ci, cj - 1) && dist[cur - g.w] === -1) {
      dist[cur - g.w] = d;
      queue.push(cur - g.w);
    }
    if (isWalkable(g, ci, cj + 1) && dist[cur + g.w] === -1) {
      dist[cur + g.w] = d;
      queue.push(cur + g.w);
    }
    if (isWalkable(g, ci - 1, cj) && dist[cur - 1] === -1) {
      dist[cur - 1] = d;
      queue.push(cur - 1);
    }
    if (isWalkable(g, ci + 1, cj) && dist[cur + 1] === -1) {
      dist[cur + 1] = d;
      queue.push(cur + 1);
    }
  }

  return dist;
}

const STEPS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * The UPHILL step from (i, j): the 4-neighbour with the largest distance
 * strictly above this tile's — i.e. one step further from whatever the field
 * was seeded on. This is how you retreat through a maze rather than away from
 * a compass bearing: straight-line repulsion presses an agent into the nearest
 * wall and slides it along, which is why the merchant used to ride the map's
 * edge. Null when no neighbour is further (a dead end — you're cornered).
 */
export function flowAway(g: Grid, dist: Int32Array, i: number, j: number): TilePos | null {
  const here = dist[idx(g, i, j)] ?? -1;
  if (here < 0) return null;

  let best: TilePos | null = null;
  let bestD = here;
  for (const [di, dj] of STEPS) {
    const ni = i + di;
    const nj = j + dj;
    if (!isWalkable(g, ni, nj)) continue;
    const d = dist[idx(g, ni, nj)];
    if (d > bestD) {
      bestD = d;
      best = { i: ni, j: nj };
    }
  }
  return best;
}

/**
 * The downhill step from (i, j): the 4-neighbour with the smallest distance
 * strictly below this tile's. Null at the player's own tile, on walls, and
 * anywhere unreachable. Ties break in fixed N/E/S/W order so movement is
 * deterministic.
 */
export function flowStep(g: Grid, dist: Int32Array, i: number, j: number): TilePos | null {
  const here = dist[idx(g, i, j)] ?? -1;
  if (here <= 0) return null;

  let best: TilePos | null = null;
  let bestD = here;
  for (const [di, dj] of STEPS) {
    const ni = i + di;
    const nj = j + dj;
    if (!isWalkable(g, ni, nj)) continue;
    const d = dist[idx(g, ni, nj)];
    if (d >= 0 && d < bestD) {
      bestD = d;
      best = { i: ni, j: nj };
    }
  }
  return best;
}
