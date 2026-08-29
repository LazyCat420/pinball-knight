import { type Grid, type TilePos, idx, isWalkable, at, T_WALL } from "./generator";

/**
 * Calculates the contiguous walkable span along row `j` containing `(i, j)`.
 */
export function horizontalSpan(g: Grid, i: number, j: number): number {
  if (!isWalkable(g, i, j)) return 0;
  let left = i;
  while (left > 0 && isWalkable(g, left - 1, j)) left--;
  let right = i;
  while (right < g.w - 1 && isWalkable(g, right + 1, j)) right++;
  return right - left + 1;
}

/**
 * Calculates the contiguous walkable span along column `i` containing `(i, j)`.
 */
export function verticalSpan(g: Grid, i: number, j: number): number {
  if (!isWalkable(g, i, j)) return 0;
  let top = j;
  while (top > 0 && isWalkable(g, i, top - 1)) top--;
  let bot = j;
  while (bot < g.h - 1 && isWalkable(g, i, bot + 1)) bot++;
  return bot - top + 1;
}

/**
 * Checks whether a walkable tile (i, j) sits in a narrow passage or gap narrower than minWidth.
 *
 * A tile is in a narrow bottleneck if:
 * 1. Both horizontal and vertical spans are < minWidth.
 * 2. It sits in a constricted horizontal slit (all tiles in its span have vertical clearance < minWidth).
 * 3. It sits in a constricted vertical slit (all tiles in its span have horizontal clearance < minWidth).
 */
export function isPassageChoke(g: Grid, i: number, j: number, minWidth = 3): boolean {
  if (!isWalkable(g, i, j)) return false;
  const h = horizontalSpan(g, i, j);
  const v = verticalSpan(g, i, j);
  if (h < minWidth && v < minWidth) return true;

  if (v < minWidth) {
    // Count consecutive tiles horizontally that have verticalSpan < minWidth
    let left = i;
    while (left > 0 && isWalkable(g, left - 1, j) && verticalSpan(g, left - 1, j) < minWidth) left--;
    let right = i;
    while (right < g.w - 1 && isWalkable(g, right + 1, j) && verticalSpan(g, right + 1, j) < minWidth) right++;
    if (right - left + 1 >= 2) return true;
  }

  if (h < minWidth) {
    // Count consecutive tiles vertically that have horizontalSpan < minWidth
    let top = j;
    while (top > 0 && isWalkable(g, i, top - 1) && horizontalSpan(g, i, top - 1) < minWidth) top--;
    let bot = j;
    while (bot < g.h - 1 && isWalkable(g, i, bot + 1) && horizontalSpan(g, i, bot + 1) < minWidth) bot++;
    if (bot - top + 1 >= 2) return true;
  }

  return false;
}

/**
 * Finds all bottleneck choke points on the grid narrower than minWidth.
 */
export function findPassageBottlenecks(g: Grid, minWidth = 3): TilePos[] {
  const bottlenecks: TilePos[] = [];
  for (let j = 1; j < g.h - 1; j++) {
    for (let i = 1; i < g.w - 1; i++) {
      if (isPassageChoke(g, i, j, minWidth)) {
        bottlenecks.push({ i, j });
      }
    }
  }
  return bottlenecks;
}

export interface FluidFlowResult {
  reachableShare: number;
  unreachedCount: number;
  totalWalkable: number;
  chokeCount: number;
  chokeLocations: TilePos[];
}

/**
 * Simulates viscous fluid / 3-wide volume flow from `start` across the grid.
 * Fluid flows through all open regions and passages with clearance >= minWidth.
 */
export function simulateFluidFlow(g: Grid, start: TilePos, minWidth = 3): FluidFlowResult {
  let totalWalkable = 0;
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (isWalkable(g, i, j)) totalWalkable++;
    }
  }

  const chokes = findPassageBottlenecks(g, minWidth);
  const chokeSet = new Uint8Array(g.w * g.h);
  for (const c of chokes) {
    chokeSet[idx(g, c.i, c.j)] = 1;
  }

  const visited = new Uint8Array(g.w * g.h);
  const queue: number[] = [];

  const startIdx = idx(g, start.i, start.j);
  if (isWalkable(g, start.i, start.j)) {
    visited[startIdx] = 1;
    queue.push(startIdx);
  }

  let reached = 0;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    reached++;
    const ci = cur % g.w;
    const cj = (cur - ci) / g.w;

    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= g.w || nj >= g.h) continue;
      const nIdx = idx(g, ni, nj);
      if (visited[nIdx] || !isWalkable(g, ni, nj)) continue;
      if (chokeSet[nIdx]) continue; // Choked passage blocks fluid of minWidth

      visited[nIdx] = 1;
      queue.push(nIdx);
    }
  }

  const unreached = totalWalkable - reached;
  return {
    reachableShare: totalWalkable > 0 ? reached / totalWalkable : 0,
    unreachedCount: unreached,
    totalWalkable,
    chokeCount: chokes.length,
    chokeLocations: chokes.slice(0, 20),
  };
}

/**
 * Validates that 100% of walkable floor is reachable by fluid flow with no choke points.
 */
export function checkFluidReachability(g: Grid, start: TilePos, minWidth = 3): string[] {
  const res = simulateFluidFlow(g, start, minWidth);
  const bad: string[] = [];

  if (res.chokeCount > 0) {
    bad.push(
      `found ${res.chokeCount} narrow choke points (< ${minWidth} squares wide) at sample tiles: ${res.chokeLocations
        .map((p) => `(${p.i},${p.j})`)
        .join(", ")}`,
    );
  }

  if (res.unreachedCount > 0 || res.reachableShare < 1.0) {
    bad.push(
      `fluid reachability ${(res.reachableShare * 100).toFixed(1)}% < 100%: ${res.unreachedCount} / ${res.totalWalkable} tiles blocked behind narrow gaps`,
    );
  }

  return bad;
}
