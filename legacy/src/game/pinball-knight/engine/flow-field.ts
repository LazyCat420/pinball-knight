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
import { type Grid, type TilePos, idx, isWalkable } from "./grid";

/**
 * Distance (in tiles) from every walkable tile to (si, sj).
 * Unreachable / wall tiles are -1.
 */
/**
 * Scratch buffers for the per-frame flow field, reused across calls.
 *
 * The BFS itself is cheap — measured 2.59ms on a 53,732-tile cap floor, run at
 * 4Hz, so about 1% of a frame budget. What is NOT cheap is what it ALLOCATES:
 * a fresh 210 KB Int32Array plus a growing queue, four times a second, is
 * ~0.8 MB/sec of garbage — roughly 246 MB over a five-minute floor. That cost
 * does not show up as slow code, it shows up as GC pauses, which feel exactly
 * like the intermittent hitching this pass is chasing.
 *
 * Keyed by length so a floor change (or the intro's small grid) reallocates
 * once rather than fighting the dungeon over one buffer. `fill(-1)` on a
 * retained buffer is dramatically cheaper than allocating a new one, and the
 * queue is an Int32Array too: the old `number[]` push path could box values
 * and reallocate its backing store repeatedly as it grew to tile-count.
 */
let scratchDist: Int32Array | null = null;
let scratchQueue: Int32Array | null = null;

/**
 * Distance field from (si, sj) over walkable tiles; -1 where unreachable.
 *
 * ⚠️ THE RETURNED ARRAY IS SHARED SCRATCH. It is valid only until the next
 * call to this function, and it is NOT safe to retain.
 *
 * Use this only when the field is consumed before anything else can run a BFS.
 * If the field is stored — on `state`, in a closure, or across generation
 * passes that themselves call BFS — use `bfsDistancesOwned`, which returns a
 * private copy. Getting this wrong is nasty: the field silently becomes some
 * other query's answer, so zombies path toward the wrong tile or a generator
 * scores against the wrong distances, with nothing to point at as the cause.
 */
export function bfsDistances(g: Grid, si: number, sj: number): Int32Array {
  const n = g.w * g.h;
  if (!scratchDist || scratchDist.length !== n) {
    scratchDist = new Int32Array(n);
    scratchQueue = new Int32Array(n);
  }
  const dist = scratchDist;
  dist.fill(-1);
  if (!isWalkable(g, si, sj)) return dist;

  // Fixed-capacity ring-free queue: a BFS visits each tile at most once, so
  // `n` entries is a hard upper bound and the queue can never overflow.
  const queue = scratchQueue!;
  queue[0] = idx(g, si, sj);
  let tail = 1;
  dist[queue[0]] = 0;
  let head = 0;

  while (head < tail) {
    const cur = queue[head++];
    const ci = cur % g.w;
    const cj = (cur - ci) / g.w;
    const d = dist[cur] + 1;

    // 4-neighbourhood; diagonals would let zombies clip wall corners.
    if (isWalkable(g, ci, cj - 1) && dist[cur - g.w] === -1) {
      dist[cur - g.w] = d;
      queue[tail++] = cur - g.w;
    }
    if (isWalkable(g, ci, cj + 1) && dist[cur + g.w] === -1) {
      dist[cur + g.w] = d;
      queue[tail++] = cur + g.w;
    }
    if (isWalkable(g, ci - 1, cj) && dist[cur - 1] === -1) {
      dist[cur - 1] = d;
      queue[tail++] = cur - 1;
    }
    if (isWalkable(g, ci + 1, cj) && dist[cur + 1] === -1) {
      dist[cur + 1] = d;
      queue[tail++] = cur + 1;
    }
  }

  return dist;
}

/**
 * A distance field the caller OWNS — safe to keep for as long as you like.
 *
 * Costs one 210 KB copy on a cap floor, which is exactly what the scratch
 * buffer avoids, so use it only where the field genuinely outlives the call:
 * the per-frame flow field stored on `state`, and generation passes that hold
 * a field while running further BFS queries.
 */
export function bfsDistancesOwned(g: Grid, si: number, sj: number): Int32Array {
  return bfsDistances(g, si, sj).slice();
}

/**
 * The horde's flow field, seeded from a point that may not be walkable.
 *
 * ⚠️ THE SEED IS SNAPPED, and that is the whole point of this function. The
 * knight is a BALL, and shaped walls (slants, rounds, arc slices) are stored
 * as `T_WALL` while being transparent to the square sweep — engine/collision
 * `blocksSquare` only blocks on `SHAPE_FULL`. So a ball riding a curve
 * legitimately has its centre inside a tile that `isWalkable` rejects.
 *
 * Seed the BFS there and it bails at the first line, returning a field that is
 * -1 EVERYWHERE. Every monster then fails the `d >= 0` aggro test at once, so
 * the entire floor freezes for as long as the ball hugs that curve — which is
 * indistinguishable, in play, from the AI being broken.
 *
 * Snapping to the nearest open tile costs one small ring scan on the frames it
 * is needed and nothing on the frames it is not.
 */
export function hordeFlowField(g: Grid, si: number, sj: number): Int32Array {
  if (isWalkable(g, si, sj)) return bfsDistancesOwned(g, si, sj);
  // A local ring scan rather than maze/nearest-open-tile: engine/ does not
  // import maze/ anywhere, and a shaped tile is always adjacent to the floor
  // it was carved from, so r <= 2 finds it.
  for (let r = 1; r <= 2; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; // ring shell only
        if (isWalkable(g, si + di, sj + dj)) return bfsDistancesOwned(g, si + di, sj + dj);
      }
    }
  }
  return bfsDistancesOwned(g, si, sj); // genuinely walled in — nothing to snap to
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
