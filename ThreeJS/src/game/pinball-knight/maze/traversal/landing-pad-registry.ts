/**
 * Landing Pad Registry & Valid Destination Selection
 *
 * Precomputes and reserves safe, validated landing targets across sectors.
 * Replaces unconstrained random launch coordinates with guaranteed safe pads
 * that satisfy clearance, anti-skip boundaries, and forward routability.
 */
import {
  type Grid,
  type TilePos,
  isWalkable,
  tileCenter,
} from "../generator";
import type { SectorGraph, SectorPlan } from "../sectors/sector-types";
import { sectorIdForTile, isAntiSkipTile } from "../sectors/sector-graph";
import type { FloorSpec } from "../spec/floor-spec";
import {
  type TraversalMechanismKind,
  validateTraversalLink,
} from "./traversal-tiers";

export interface LandingPad {
  id: number;
  sectorId: number;
  tile: TilePos;
  worldPos: { x: number; z: number };
  clearance: number; // minimum distance to walls/hazards
  openNeighbors: number; // number of open escape paths (1..4)
  reservedBy?: string; // e.g. "catapult_12"
}

export interface LandingPadRegistry {
  pads: LandingPad[];
  padsBySector: Map<number, LandingPad[]>;
}

const CARDINALS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Scan grid and register safe landing pads for each sector.
 */
export function buildLandingPadRegistry(
  g: Grid,
  graph: SectorGraph,
  options: {
    minClearance?: number;
    stairs?: TilePos;
    existingParts?: readonly { i: number; j: number; kind?: string }[];
  } = {},
): LandingPadRegistry {
  const minClearance = options.minClearance ?? 1.5;
  const stairsTile = options.stairs;
  const parts = options.existingParts ?? [];

  const pads: LandingPad[] = [];
  const padsBySector = new Map<number, LandingPad[]>();

  let nextPadId = 1;

  for (let j = 2; j < g.h - 2; j++) {
    for (let i = 2; i < g.w - 2; i++) {
      if (!isWalkable(g, i, j)) continue;

      // 1. Anti-skip check
      if (isAntiSkipTile(graph, i, j, stairsTile)) continue;

      // 2. Avoid existing hazard / part overlaps
      const overlapsPart = parts.some(
        (p) =>
          Math.abs(p.i - i) <= 1 &&
          Math.abs(p.j - j) <= 1 &&
          (p.kind === "pit" || p.kind === "gravepit" || p.kind === "trapdoor" || p.kind === "catapult" || p.kind === "cannon"),
      );
      if (overlapsPart) continue;

      // 3. Count open cardinal escape paths
      let openCount = 0;
      for (const [di, dj] of CARDINALS) {
        if (isWalkable(g, i + di, j + dj)) {
          openCount++;
        }
      }
      if (openCount < 2) continue; // Do not land in 1-tile dead ends

      // 4. Clearance check (surrounding 3x3 ring)
      let clearance = 2.0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          if (!isWalkable(g, i + di, j + dj)) {
            clearance = Math.min(clearance, Math.hypot(di, dj));
          }
        }
      }
      if (clearance < minClearance) continue;

      // Register pad
      const sId = sectorIdForTile(i, j, graph.cols, graph.sectorSize);
      const worldPos = tileCenter(g, i, j);
      const pad: LandingPad = {
        id: nextPadId++,
        sectorId: sId,
        tile: { i, j },
        worldPos,
        clearance,
        openNeighbors: openCount,
      };

      pads.push(pad);
      const list = padsBySector.get(sId) ?? [];
      list.push(pad);
      padsBySector.set(sId, list);
    }
  }

  return { pads, padsBySector };
}

/**
 * Select the optimal landing pad for a launch mechanism based on tier constraints.
 * Deterministic: uses seedRng or fallback PRNG, never global Math.random in production.
 */
export function selectBestLandingPad(
  kind: TraversalMechanismKind,
  fromTile: TilePos,
  graph: SectorGraph,
  registry: LandingPadRegistry,
  options: {
    stairs?: TilePos;
    preferForwardSector?: boolean;
    seedRng?: () => number;
  } = {},
): LandingPad | null {
  const fromSectorId = sectorIdForTile(fromTile.i, fromTile.j, graph.cols, graph.sectorSize);
  const rng = options.seedRng ?? (() => 0.5);

  // Filter pads that strictly pass validation rules
  const validPads: LandingPad[] = [];

  for (const pad of registry.pads) {
    if (pad.reservedBy) continue;
    const res = validateTraversalLink(
      kind,
      fromTile,
      pad.tile,
      fromSectorId,
      pad.sectorId,
      graph,
      options.stairs,
    );
    if (res.valid) {
      validPads.push(pad);
    }
  }

  if (validPads.length === 0) {
    // Fallback: look for intra-sector safe pad if possible
    const localPads = registry.padsBySector.get(fromSectorId) ?? [];
    const localCandidate = localPads.find(
      (p) => Math.hypot(p.tile.i - fromTile.i, p.tile.j - fromTile.j) >= 4,
    );
    return localCandidate ?? null;
  }

  // If forward progression is preferred, score by hop progress towards boss
  if (options.preferForwardSector) {
    const fromHop = graph.hopDistances[fromSectorId] ?? 0;
    validPads.sort((a, b) => {
      const hopA = graph.hopDistances[a.sectorId] ?? 0;
      const hopB = graph.hopDistances[b.sectorId] ?? 0;
      return hopB - hopA; // Pick furthest forward valid hop
    });
    // Pick among the top 3 candidates to preserve variety
    const pool = validPads.slice(0, Math.min(3, validPads.length));
    const chosen = pool[Math.floor(rng() * pool.length)];
    return chosen;
  }

  // Deterministic selection from valid pads
  return validPads[Math.floor(rng() * validPads.length)];
}

export interface TraversalDestinationAssignment {
  success: boolean;
  landingPad?: LandingPad;
  destTile?: TilePos;
  hopDistance?: number;
  reason?: string;
}

/**
 * Authoritative Traversal Destination Assignment (Phase 3).
 *
 * All placed launch mechanisms (catapult, cannon, rail, seesaw, portal) must
 * route through this function to guarantee destination validity, anti-skip compliance,
 * reservation on the landing pad registry, and deterministic reproduction.
 */
export function assignTraversalDestination(params: {
  mechanism: TraversalMechanismKind;
  sourceTile: TilePos;
  sectorPlan?: SectorPlan;
  sectorGraph: SectorGraph;
  landingPadRegistry: LandingPadRegistry;
  floorSpec: FloorSpec;
  stairs?: TilePos;
  start?: TilePos;
  rng?: () => number;
}): TraversalDestinationAssignment {
  const {
    mechanism,
    sourceTile,
    sectorGraph,
    landingPadRegistry,
    floorSpec,
    stairs,
    start,
  } = params;
  const rng = params.rng ?? (() => 0.5);

  const fromSectorId = sectorIdForTile(
    sourceTile.i,
    sourceTile.j,
    sectorGraph.cols,
    sectorGraph.sectorSize,
  );

  const candidates: { pad: LandingPad; hopDiff: number; dist: number }[] = [];

  for (const pad of landingPadRegistry.pads) {
    if (pad.reservedBy) continue;
    if (pad.clearance < 1.5) continue;

    // Check boss exclusion zone (default 18 tiles)
    if (stairs) {
      const distToStairs = Math.hypot(pad.tile.i - stairs.i, pad.tile.j - stairs.j);
      if (distToStairs < floorSpec.traversalPolicy.bossExclusionRadius) continue;
    }

    // Check start protection zone (default 12 tiles)
    if (start) {
      const distToStart = Math.hypot(pad.tile.i - start.i, pad.tile.j - start.j);
      if (distToStart < floorSpec.traversalPolicy.minStartExclusionRadius) continue;
    }

    // Never land inside boss arena or boss antechamber
    if (
      pad.sectorId === sectorGraph.bossArenaSectorId ||
      pad.sectorId === sectorGraph.bossAntechamberSectorId
    ) {
      continue;
    }

    // Validate reach bounds
    const linkVal = validateTraversalLink(
      mechanism,
      sourceTile,
      pad.tile,
      fromSectorId,
      pad.sectorId,
      sectorGraph,
      stairs,
    );

    if (linkVal.valid) {
      const fromHop = sectorGraph.hopDistances[fromSectorId] ?? 0;
      const toHop = sectorGraph.hopDistances[pad.sectorId] ?? 0;
      const hopDiff = toHop - fromHop;
      const dist = Math.hypot(pad.tile.i - sourceTile.i, pad.tile.j - sourceTile.j);

      if (hopDiff <= floorSpec.traversalPolicy.maxForwardSectorSkip) {
        candidates.push({ pad, hopDiff, dist });
      }
    }
  }

  if (candidates.length === 0) {
    return {
      success: false,
      reason: "No unreserved pad satisfied reach and anti-skip constraints",
    };
  }

  // Sort: prioritize forward sector hops, then distance
  candidates.sort((a, b) => {
    if (b.hopDiff !== a.hopDiff) return b.hopDiff - a.hopDiff;
    return b.dist - a.dist;
  });

  const pool = candidates.slice(0, Math.min(3, candidates.length));
  const chosen = pool[Math.floor(rng() * pool.length)].pad;

  // Reserve the pad
  chosen.reservedBy = `${mechanism}_${sourceTile.i}_${sourceTile.j}`;

  const fromHop = sectorGraph.hopDistances[fromSectorId] ?? 0;
  const toHop = sectorGraph.hopDistances[chosen.sectorId] ?? 0;

  return {
    success: true,
    landingPad: chosen,
    destTile: chosen.tile,
    hopDistance: Math.abs(toHop - fromHop),
  };
}
