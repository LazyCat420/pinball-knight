/**
 * Traversal-Aware Route Graph Metrics & Anti-Skip Validation
 *
 * Measures both ordinary walking path distance and traversal-aware shortest path
 * distance (where catapults, cannons, rails, seesaws, and trapdoors act as shortcut edges).
 * Rejects or warns on floors where a shortcut chain trivially bypasses exploration
 * or breaches anti-skip boundaries.
 */
import {
  type Grid,
  type TilePos,
  isWalkable,
} from "../generator";
import { bfsDistances } from "../../engine/flow-field";
import type { SectorGraph } from "../sectors/sector-types";
import { sectorIdForTile, isAntiSkipTile } from "../sectors/sector-graph";

export interface TraversalShortcutEdge {
  id: string;
  kind: string;
  from: TilePos;
  to: TilePos;
  costTiles: number; // Equivalent traversal time represented as tile steps
}

export interface RouteMetricsReport {
  walkingDistance: number;
  traversalDistance: number;
  distanceRatio: number; // traversalDistance / walkingDistance
  sectorsTraversed: number;
  antiSkipViolations: string[];
  isValid: boolean;
}

const CARDINALS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Compute the traversal-aware shortest path distance using Dijkstra's algorithm
 * over the walkable tile grid augmented with directed traversal shortcut edges.
 */
export function computeTraversalRouteMetrics(
  g: Grid,
  start: TilePos,
  stairs: TilePos,
  shortcuts: readonly TraversalShortcutEdge[],
  graph?: SectorGraph,
): RouteMetricsReport {
  // 1. Compute standard walking distance via BFS
  const walkDist = bfsDistances(g, start.i, start.j);
  const targetIdx = stairs.j * g.w + stairs.i;
  const rawWalkingDistance = walkDist[targetIdx] >= 0 ? walkDist[targetIdx] : -1;

  if (rawWalkingDistance <= 0) {
    return {
      walkingDistance: 0,
      traversalDistance: 0,
      distanceRatio: 1.0,
      sectorsTraversed: 0,
      antiSkipViolations: ["Start and stairs are disconnected"],
      isValid: false,
    };
  }

  // 2. Build index of shortcut edges originating at tile indices
  const shortcutsByFromTile = new Map<number, TraversalShortcutEdge[]>();
  const violations: string[] = [];

  for (const sc of shortcuts) {
    const fIdx = sc.from.j * g.w + sc.from.i;
    const list = shortcutsByFromTile.get(fIdx) ?? [];
    list.push(sc);
    shortcutsByFromTile.set(fIdx, list);

    // Validate anti-skip rules if graph is supplied
    if (graph) {
      if (isAntiSkipTile(graph, sc.to.i, sc.to.j, stairs)) {
        violations.push(`Shortcut ${sc.id} (${sc.kind}) lands inside Anti-Skip Zone (${sc.to.i}, ${sc.to.j})`);
      }
      const fromSector = sectorIdForTile(sc.from.i, sc.from.j, graph.cols, graph.sectorSize);
      const toSector = sectorIdForTile(sc.to.i, sc.to.j, graph.cols, graph.sectorSize);
      const fromHop = graph.hopDistances[fromSector] ?? 0;
      const toHop = graph.hopDistances[toSector] ?? 0;
      if (fromHop <= 1 && toSector === graph.bossArenaSectorId) {
        violations.push(`Shortcut ${sc.id} directly delivers early sector ${fromSector} into boss arena ${toSector}`);
      }
    }
  }

  // 3. Dijkstra on augmented grid
  // Use Float64Array for distance tracking
  const totalTiles = g.w * g.h;
  const dist = new Float64Array(totalTiles).fill(Infinity);
  const visited = new Uint8Array(totalTiles);
  const predecessor = new Int32Array(totalTiles).fill(-1);

  const startIdx = start.j * g.w + start.i;
  dist[startIdx] = 0;

  // Min-priority queue simulated via small bucket / binary heap or simple priority search
  // Given grid size, priority queue with paired arrays
  interface PQNode {
    idx: number;
    d: number;
  }
  const pq: PQNode[] = [{ idx: startIdx, d: 0 }];

  function pqPush(node: PQNode) {
    pq.push(node);
    let curr = pq.length - 1;
    while (curr > 0) {
      const parent = Math.floor((curr - 1) / 2);
      if (pq[parent].d <= pq[curr].d) break;
      const tmp = pq[parent];
      pq[parent] = pq[curr];
      pq[curr] = tmp;
      curr = parent;
    }
  }

  function pqPop(): PQNode | undefined {
    if (pq.length === 0) return undefined;
    const top = pq[0];
    const bottom = pq.pop()!;
    if (pq.length > 0) {
      pq[0] = bottom;
      let curr = 0;
      while (true) {
        let left = 2 * curr + 1;
        let right = 2 * curr + 2;
        let smallest = curr;
        if (left < pq.length && pq[left].d < pq[smallest].d) smallest = left;
        if (right < pq.length && pq[right].d < pq[smallest].d) smallest = right;
        if (smallest === curr) break;
        const tmp = pq[curr];
        pq[curr] = pq[smallest];
        pq[smallest] = tmp;
        curr = smallest;
      }
    }
    return top;
  }

  while (pq.length > 0) {
    const cur = pqPop()!;
    const u = cur.idx;
    if (visited[u]) continue;
    visited[u] = 1;

    if (u === targetIdx) break; // Reached stairs

    const ui = u % g.w;
    const uj = Math.floor(u / g.w);

    // Normal cardinal neighbors (cost = 1 tile)
    for (const [di, dj] of CARDINALS) {
      const ni = ui + di;
      const nj = uj + dj;
      if (ni >= 0 && ni < g.w && nj >= 0 && nj < g.h && isWalkable(g, ni, nj)) {
        const v = nj * g.w + ni;
        const newD = dist[u] + 1;
        if (newD < dist[v]) {
          dist[v] = newD;
          predecessor[v] = u;
          pqPush({ idx: v, d: newD });
        }
      }
    }

    // Traversal shortcut edges originating at this tile
    const edges = shortcutsByFromTile.get(u);
    if (edges) {
      for (const edge of edges) {
        const v = edge.to.j * g.w + edge.to.i;
        if (v >= 0 && v < totalTiles && isWalkable(g, edge.to.i, edge.to.j)) {
          const newD = dist[u] + edge.costTiles;
          if (newD < dist[v]) {
            dist[v] = newD;
            predecessor[v] = u;
            pqPush({ idx: v, d: newD });
          }
        }
      }
    }
  }

  const traversalDistance = dist[targetIdx] < Infinity ? Math.round(dist[targetIdx]) : rawWalkingDistance;
  const ratio = rawWalkingDistance > 0 ? traversalDistance / rawWalkingDistance : 1.0;

  // Count distinct sectors along traversal path
  const sectorsSeen = new Set<number>();
  if (graph) {
    let curr = targetIdx;
    while (curr >= 0 && curr !== startIdx) {
      const ci = curr % g.w;
      const cj = Math.floor(curr / g.w);
      sectorsSeen.add(sectorIdForTile(ci, cj, graph.cols, graph.sectorSize));
      curr = predecessor[curr];
    }
    sectorsSeen.add(sectorIdForTile(start.i, start.j, graph.cols, graph.sectorSize));
  }

  // If shortcuts reduce total path by more than 55%, mark as invalid skip
  if (ratio < 0.45 && rawWalkingDistance > 50) {
    violations.push(`Traversal path ratio (${ratio.toFixed(2)}) excessively trivializes distance (< 0.45)`);
  }

  return {
    walkingDistance: rawWalkingDistance,
    traversalDistance,
    distanceRatio: ratio,
    sectorsTraversed: sectorsSeen.size,
    antiSkipViolations: violations,
    isValid: violations.length === 0,
  };
}
