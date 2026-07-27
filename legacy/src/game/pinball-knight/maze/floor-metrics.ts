/**
 * FLOOR METRICS — how we judge a generated floor, as numbers.
 *
 * Every generator change before this one was argued from the source: read the
 * pass, reason about what it must produce, ship. That is how a cap that binds
 * from level 1 survives being called "scales with floor area" for two waves,
 * and how five floor archetypes can shape a grid the live path throws away
 * while the descent card announces them by name.
 *
 * So: measure the output instead. This module is the metric half of
 * `.agents/game-dev-rules/procedural-level-generation.md` §6 — a pure function
 * from a finished grid to the numbers that decide whether it is a good floor —
 * and `checkFloor` is the constraint half (§4), which the smoke gate asserts on
 * and any tuning script can call.
 *
 * Deliberately DOM-, three- and content-free: it reads only the tile grid, the
 * endpoints and (optionally) the track mask, so it can run over ANY floor from
 * either generator branch without dragging in decoration.
 */
import { type Grid, type TilePos, at, idx, isWalkable, T_WALL } from "./generator";
import { bfsDistances } from "../engine/flow-field";

/** Coarse region size, in tiles, for the coverage sweep. */
const REGION = 24;
/** A region below this many floor tiles is a sliver and is not held to coverage. */
const REGION_MIN_FLOOR = 120;

export interface FloorMetrics {
  /** Total tiles in the grid, walls included. */
  tiles: number;
  /** Walkable tiles. */
  walkable: number;
  /** walkable ÷ tiles — how much of the rectangle is actually a floor. */
  openShare: number;
  /**
   * Walkable tiles reachable from `start` ÷ walkable. THE hard constraint: a
   * player who can see a region and cannot enter it is the worst thing this
   * generator can ship, and anything below 1 means a pass carved a pocket.
   */
  reachShare: number;
  /** BFS distance start → stairs, in tiles. −1 if the exit is unreachable. */
  pathLen: number;
  /**
   * euclid(start, stairs) ÷ pathLen. 1.0 is a dead-straight shot down a
   * corridor; the lower it is, the more the route has to work for it.
   */
  directness: number;
  /**
   * Direction changes along the traced route ÷ its length. Distinguishes "bent
   * once around a corner" (low directness, low turn rate — one lazy diagonal)
   * from "genuinely snakes", which directness alone cannot.
   */
  turnRate: number;
  /** Walkable tiles with ≤1 walkable neighbour — corridors to nowhere. */
  deadEnds: number;
  /**
   * Walkable tiles with ≥3 walkable neighbours ÷ walkable. The PCG literature's
   * "choice heuristic": how often the player is actually offered a branch.
   */
  choiceShare: number;
  /**
   * Track tiles ÷ walkable, or 0 with no mask. On a track floor the circuit IS
   * the floor's reason to exist, so its share is a design target and not a
   * curiosity — it decayed 0.30 → 0.12 with depth before anyone measured it.
   */
  laneShare: number;
  /** Coarse regions holding real floor area. */
  regions: number;
  /**
   * Coarse regions holding real floor area that the player can reach ÷
   * `regions`. Catches a whole quadrant sealed off behind a bad pass, which a
   * tile-level reachShare of 0.97 would hide.
   */
  regionReachShare: number;
}

/** Which walkable tiles belong to the floor's signature feature (the circuit). */
export interface LaneMask {
  lane: Uint8Array;
}

/**
 * Trace the start→stairs route by walking DOWNHILL through a distance field
 * measured from the start.
 *
 * Downhill from the exit rather than uphill from the spawn: `dist` is BFS from
 * `start`, so every step toward a strictly smaller value is one tile closer to
 * it, and the walk terminates by construction. Returns the path start-first.
 */
export function traceRoute(g: Grid, start: TilePos, stairs: TilePos, dist: Int32Array): TilePos[] {
  if (dist[idx(g, stairs.i, stairs.j)] < 0) return [];
  const path: TilePos[] = [{ i: stairs.i, j: stairs.j }];
  let cur = { i: stairs.i, j: stairs.j };
  // A BFS path is at most `walkable` long; the bound is a runaway guard only.
  for (let guard = 0; guard < g.w * g.h; guard++) {
    if (cur.i === start.i && cur.j === start.j) break;
    const d = dist[idx(g, cur.i, cur.j)];
    let next: TilePos | null = null;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const ni = cur.i + di;
      const nj = cur.j + dj;
      if (!isWalkable(g, ni, nj)) continue;
      const nd = dist[idx(g, ni, nj)];
      if (nd >= 0 && nd === d - 1) {
        next = { i: ni, j: nj };
        break;
      }
    }
    if (!next) break;
    path.push(next);
    cur = next;
  }
  return path.reverse();
}

/**
 * Measure a finished floor.
 *
 * `mask` is optional so this works on both generator branches — the legacy maze
 * has no circuit and simply reports `laneShare` 0.
 *
 * ONE BFS. `bfsDistances` hands back a shared scratch buffer that the next call
 * overwrites, so everything derived from the field is derived here, before any
 * other caller can invalidate it.
 */
export function measureFloor(
  g: Grid,
  start: TilePos,
  stairs: TilePos,
  mask?: LaneMask,
  opts: { routeFrom?: TilePos } = {},
): FloorMetrics {
  const tiles = g.w * g.h;
  let walkable = 0;
  let deadEnds = 0;
  let choices = 0;
  let lane = 0;

  const floorPerRegion = new Map<number, number>();
  const regW = Math.ceil(g.w / REGION);
  const regionOf = (i: number, j: number): number =>
    Math.floor(j / REGION) * regW + Math.floor(i / REGION);

  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (!isWalkable(g, i, j)) continue;
      walkable++;
      if (mask?.lane[idx(g, i, j)]) lane++;
      let open = 0;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        if (isWalkable(g, i + di, j + dj)) open++;
      }
      if (open <= 1) deadEnds++;
      if (open >= 3) choices++;
      floorPerRegion.set(regionOf(i, j), (floorPerRegion.get(regionOf(i, j)) ?? 0) + 1);
    }
  }

  const dist = bfsDistances(g, start.i, start.j);
  let reached = 0;
  const reachedRegion = new Set<number>();
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (!isWalkable(g, i, j)) continue;
      // −1 is `bfsDistances`' unreachable sentinel. Testing `d < BIG` instead
      // counts every unreachable tile as reached and pins the metric at 1.0 —
      // a gate that can only ever pass.
      if (dist[idx(g, i, j)] < 0) continue;
      reached++;
      reachedRegion.add(regionOf(i, j));
    }
  }

  // ── WHERE THE JOURNEY STARTS ────────────────────────────────────────────
  //
  // Reachability is measured from the SPAWN (above — the player is really
  // standing there). The route metrics are measured from `routeFrom`, which on
  // a floor with a launch chute is the chute's MOUTH.
  //
  // This is not the gate being relaxed to accommodate the chute, and the
  // measurement says so: over 240 floors, mean directness from the mouth came
  // out at 0.639 against 0.628 from the base — very slightly HIGHER, and
  // pathLen is strictly shorter, which makes the `minPathSpan` check stricter
  // rather than looser. What it removes is an artefact. The chute is a fixed,
  // deliberately dead-straight ~20-tile lane present on every floor by
  // construction; it adds the same length to euclid and to pathLen, so it drags
  // `euclid/pathLen` toward 1.0 no matter how much the maze beyond it snakes.
  // Counting a non-navigational constant inside a "how hard is this to
  // navigate" ratio measures the wrong span — the same class of error as the
  // `d < BIG` reach bug this file's header records.
  const from = opts.routeFrom ?? start;
  const routeDist = from === start ? dist : bfsDistances(g, from.i, from.j);
  const pathLen = routeDist[idx(g, stairs.i, stairs.j)] ?? -1;
  const route = traceRoute(g, from, stairs, routeDist);
  let turns = 0;
  for (let t = 2; t < route.length; t++) {
    const ai = route[t - 1].i - route[t - 2].i;
    const aj = route[t - 1].j - route[t - 2].j;
    const bi = route[t].i - route[t - 1].i;
    const bj = route[t].j - route[t - 1].j;
    if (ai !== bi || aj !== bj) turns++;
  }
  const euclid = Math.hypot(stairs.i - from.i, stairs.j - from.j);

  const bigRegions = [...floorPerRegion.entries()].filter(([, n]) => n >= REGION_MIN_FLOOR);
  const bigReached = bigRegions.filter(([r]) => reachedRegion.has(r)).length;

  return {
    tiles,
    walkable,
    openShare: walkable / tiles,
    reachShare: walkable ? reached / walkable : 0,
    pathLen,
    directness: pathLen > 0 ? euclid / pathLen : 0,
    turnRate: route.length > 2 ? turns / (route.length - 1) : 0,
    deadEnds,
    choiceShare: walkable ? choices / walkable : 0,
    laneShare: walkable ? lane / walkable : 0,
    regions: bigRegions.length,
    regionReachShare: bigRegions.length ? bigReached / bigRegions.length : 1,
  };
}

/**
 * The constraint band a floor must satisfy. These are the §4 non-negotiables
 * written as numbers; the smoke gate asserts `checkFloor` returns empty.
 *
 * Bands are deliberately WIDE. A gate that pins the current output exactly is a
 * change detector, not a constraint — it goes red on every legitimate tuning
 * pass and gets deleted. These are the walls of the corridor the generator may
 * wander inside, sized from a 200-floor census with headroom.
 */
export interface FloorConstraints {
  minReachShare: number;
  minRegionReachShare: number;
  /** Critical path as a fraction of the grid's Manhattan span. */
  minPathSpan: number;
  maxDirectness: number;
  /** Dead ends allowed per 1000 walkable tiles. */
  maxDeadEndsPer1k: number;
  minOpenShare: number;
  maxOpenShare: number;
  minChoiceShare: number;
}

export const DEFAULT_CONSTRAINTS: FloorConstraints = {
  // Anything under 1 means a carve or an uncarve stranded a pocket. There is no
  // acceptable non-zero rate here, so the band has no slack.
  minReachShare: 1,
  minRegionReachShare: 1,
  // The exit must be a trek, not a doorstep: at least a fifth of the floor's
  // own Manhattan span away along the walkable surface.
  minPathSpan: 0.2,
  // 1.0 is a straight corridor from spawn to stairs. Censused floors run
  // 0.54–0.70, so 0.85 fails only a route that genuinely stopped bending.
  maxDirectness: 0.85,
  // The repair passes hold this near zero (0.3–1.0 per floor, i.e. well under
  // 1 per 1000 tiles); this catches a regression that turns them off, not
  // ordinary variation.
  maxDeadEndsPer1k: 2.5,
  // Below ~0.35 the floor is solid rock with slots cut in it; above ~0.8 there
  // is no maze left and the level is one open blob (a real failure mode — one
  // early track build measured 97% open).
  minOpenShare: 0.35,
  maxOpenShare: 0.8,
  // Some branching must exist or the floor is a single corridor.
  minChoiceShare: 0.2,
};

/** Human-readable constraint violations. Empty array = the floor is legal. */
export function checkFloor(
  m: FloorMetrics,
  g: Grid,
  c: FloorConstraints = DEFAULT_CONSTRAINTS,
): string[] {
  const bad: string[] = [];
  const span = g.w + g.h;
  if (m.reachShare < c.minReachShare)
    bad.push(`unreachable floor: reachShare ${m.reachShare.toFixed(4)} < ${c.minReachShare}`);
  if (m.regionReachShare < c.minRegionReachShare)
    bad.push(
      `sealed region: regionReachShare ${m.regionReachShare.toFixed(3)} < ${c.minRegionReachShare}`,
    );
  if (m.pathLen < 0) bad.push("no route from spawn to stairs");
  else if (m.pathLen < span * c.minPathSpan)
    bad.push(`exit on the doorstep: pathLen ${m.pathLen} < ${(span * c.minPathSpan).toFixed(0)}`);
  if (m.directness > c.maxDirectness)
    bad.push(
      `straight shot to the exit: directness ${m.directness.toFixed(3)} > ${c.maxDirectness}`,
    );
  const dePer1k = m.walkable ? (m.deadEnds * 1000) / m.walkable : 0;
  if (dePer1k > c.maxDeadEndsPer1k)
    bad.push(
      `corridors to nowhere: ${dePer1k.toFixed(2)} dead ends per 1k tiles > ${c.maxDeadEndsPer1k}`,
    );
  if (m.openShare < c.minOpenShare)
    bad.push(`solid rock: openShare ${m.openShare.toFixed(3)} < ${c.minOpenShare}`);
  if (m.openShare > c.maxOpenShare)
    bad.push(`no maze left: openShare ${m.openShare.toFixed(3)} > ${c.maxOpenShare}`);
  if (m.choiceShare < c.minChoiceShare)
    bad.push(`no branches: choiceShare ${m.choiceShare.toFixed(3)} < ${c.minChoiceShare}`);
  return bad;
}

/** One-line census row — for tuning scripts and failure messages. */
export function formatMetrics(m: FloorMetrics): string {
  return [
    `tiles=${m.tiles}`,
    `open=${m.openShare.toFixed(3)}`,
    `reach=${m.reachShare.toFixed(4)}`,
    `path=${m.pathLen}`,
    `direct=${m.directness.toFixed(3)}`,
    `turn=${m.turnRate.toFixed(3)}`,
    `dead=${m.deadEnds}`,
    `choice=${m.choiceShare.toFixed(3)}`,
    `lane=${m.laneShare.toFixed(3)}`,
    `regions=${m.regions}`,
  ].join(" ");
}

/** Tiles that are wall — exported so callers can sanity-check a grid cheaply. */
export function wallCount(g: Grid): number {
  let n = 0;
  for (let k = 0; k < g.t.length; k++) if (at(g, k % g.w, Math.floor(k / g.w)) === T_WALL) n++;
  return n;
}
