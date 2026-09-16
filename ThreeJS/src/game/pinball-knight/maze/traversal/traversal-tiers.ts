/**
 * Traversal Mechanism Tiers & Strategic Reach Contracts
 *
 * Enforces explicit strategic reach constraints on every movement mechanism
 * to guarantee that movement tools save time without skipping entire districts
 * or delivering the player directly into the boss approach.
 */
import type { TilePos } from "../generator";
import type { SectorGraph } from "../sectors/sector-types";
import { isAntiSkipTile } from "../sectors/sector-graph";

export type TraversalMechanismKind =
  | "seesaw"
  | "catapult"
  | "cannon"
  | "rail"
  | "trapdoor"
  | "portal";

export interface MechanismReachRule {
  kind: TraversalMechanismKind;
  minDistance: number; // in tiles
  maxDistance: number; // in tiles
  maxSectorHop: number; // 0 = intra-sector only, 1 = adjacent sector, etc.
  allowInBossApproach: boolean;
  allowInBossArena: boolean;
}

export const MECHANISM_TIERS: Record<TraversalMechanismKind, MechanismReachRule> = {
  seesaw: {
    kind: "seesaw",
    minDistance: 3,
    maxDistance: 8,
    maxSectorHop: 0, // Must remain within same sector
    allowInBossApproach: false,
    allowInBossArena: false,
  },
  catapult: {
    kind: "catapult",
    minDistance: 12,
    maxDistance: 26,
    maxSectorHop: 1, // Cannot skip more than 1 sector boundary
    allowInBossApproach: false,
    allowInBossArena: false,
  },
  cannon: {
    kind: "cannon",
    minDistance: 14,
    maxDistance: 32,
    maxSectorHop: 1,
    allowInBossApproach: false,
    allowInBossArena: false,
  },
  trapdoor: {
    kind: "trapdoor",
    minDistance: 8,
    maxDistance: 18,
    maxSectorHop: 1,
    allowInBossApproach: false,
    allowInBossArena: false,
  },
  rail: {
    kind: "rail",
    minDistance: 18,
    maxDistance: 55,
    maxSectorHop: 2,
    allowInBossApproach: false,
    allowInBossArena: false,
  },
  portal: {
    kind: "portal",
    minDistance: 20,
    maxDistance: 100,
    maxSectorHop: 4,
    allowInBossApproach: false,
    allowInBossArena: false,
  },
};

export interface TraversalValidationResult {
  valid: boolean;
  reason?: string;
  distance: number;
}

/**
 * Validates whether a traversal link from `from` to `to` satisfies its tier rules.
 */
export function validateTraversalLink(
  kind: TraversalMechanismKind,
  from: TilePos,
  to: TilePos,
  fromSectorId: number,
  toSectorId: number,
  graph: SectorGraph,
  stairsTile?: TilePos,
): TraversalValidationResult {
  const rule = MECHANISM_TIERS[kind];
  if (!rule) {
    return { valid: false, reason: `Unknown mechanism kind: ${kind}`, distance: 0 };
  }

  const dist = Math.hypot(to.i - from.i, to.j - from.j);

  if (dist < rule.minDistance) {
    return { valid: false, reason: `Distance ${dist.toFixed(1)} < minDistance ${rule.minDistance}`, distance: dist };
  }
  if (dist > rule.maxDistance) {
    return { valid: false, reason: `Distance ${dist.toFixed(1)} > maxDistance ${rule.maxDistance}`, distance: dist };
  }

  // Check sector hop distance
  const fromCol = fromSectorId % graph.cols;
  const fromRow = Math.floor(fromSectorId / graph.cols);
  const toCol = toSectorId % graph.cols;
  const toRow = Math.floor(toSectorId / graph.cols);
  const sectorHop = Math.abs(toCol - fromCol) + Math.abs(toRow - fromRow);

  if (sectorHop > rule.maxSectorHop) {
    return {
      valid: false,
      reason: `Sector hop distance ${sectorHop} > maxAllowed ${rule.maxSectorHop}`,
      distance: dist,
    };
  }

  // Anti-skip check: cannot land in boss arena or antechamber
  if (!rule.allowInBossArena || !rule.allowInBossApproach) {
    if (isAntiSkipTile(graph, to.i, to.j, stairsTile)) {
      return {
        valid: false,
        reason: `Target tile (${to.i}, ${to.j}) falls within Anti-Skip Zone`,
        distance: dist,
      };
    }
  }

  // Cannot jump directly from early sector (hop 0 or 1 from entry) into high-tier sector (hop >= 4)
  const fromHopFromEntry = graph.hopDistances[fromSectorId] ?? 0;
  const toHopFromEntry = graph.hopDistances[toSectorId] ?? 0;
  if (fromHopFromEntry <= 1 && toHopFromEntry >= 3) {
    return {
      valid: false,
      reason: `Early sector launch skips directly into late district (hop ${fromHopFromEntry} -> ${toHopFromEntry})`,
      distance: dist,
    };
  }

  return { valid: true, distance: dist };
}
