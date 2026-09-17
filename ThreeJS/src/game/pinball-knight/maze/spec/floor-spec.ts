/**
 * CANONICAL FLOOR SPECIFICATION (FloorSpec)
 *
 * The single source of truth for floor scale, generator policy, dimensions,
 * sector structure, and content budgets. Replaces ad-hoc per-level dimension
 * calculations across the codebase.
 */
import {
  type FloorScaleTier,
  FLOOR_SCALE_TIERS,
  levelConfig,
  type LevelConfig,
  scaledLevelConfig,
} from "../../constants/level";

export interface FloorSpecOptions {
  level: number;
  runSeed?: number;
  tier?: FloorScaleTier;
  scaleMultiplier?: number;
  cellsW?: number;
  cellsH?: number;
  archIndex?: number;
  bonusRoom?: boolean;
  density?: "raw" | "shipped" | "sparse";
  progressive?: boolean;
}

export interface FloorSpec {
  level: number;
  runSeed: number;
  generatorRevision: number;
  tier: FloorScaleTier;
  scaleMultiplier: number;
  cellsW: number;
  cellsH: number;
  gridW: number;
  gridH: number;
  predictedWalkable: number;
  targetWalkableMin: number;
  targetWalkableMax: number;
  sectorSize: number;
  sectorsX: number;
  sectorsY: number;
  cfg: LevelConfig;
}

export const GENERATOR_REVISION = 2;
export const CANONICAL_SECTOR_SIZE = 32;

/**
 * Calculates progressive floor dimensions for a given level.
 * When progressive is enabled:
 * - Shallow floors (L1-5) scale from 37x26 to 50x35 cells (baseline feel).
 * - Mid floors (L6-15) expand from 54x38 to 96x72 cells.
 * - Deep floors (L16-24) expand past the old ceiling to 132x100 (1.9x).
 * - Delve floors (L25-30) expand through 192x144 (4.0x).
 * - True Abyss floors (L31+) reach 304x228 (10.0x final ceiling).
 */
export function calculateProgressiveCells(
  level: number,
  tier?: FloorScaleTier,
  scaleMultiplier?: number,
  progressive = false,
): { cellsW: number; cellsH: number; tier: FloorScaleTier; mult: number } {
  // Explicit tier overrides
  if (tier && tier !== "baseline") {
    const info = FLOOR_SCALE_TIERS[tier];
    return {
      cellsW: info.cellsW,
      cellsH: info.cellsH,
      tier,
      mult: info.areaMultiplier,
    };
  }

  // Custom multiplier override
  if (scaleMultiplier && scaleMultiplier > 0 && Math.abs(scaleMultiplier - 1.0) > 0.05) {
    const baseW = 96;
    const baseH = 72;
    const linearScale = Math.sqrt(scaleMultiplier);
    const cellsW = Math.round(baseW * linearScale);
    const cellsH = Math.round(baseH * linearScale);
    return {
      cellsW,
      cellsH,
      tier: scaleMultiplier >= 8 ? "final_10x" : scaleMultiplier >= 3 ? "phase2" : "phase1",
      mult: scaleMultiplier,
    };
  }

  // Baseline legacy clamp mode or non-progressive mode
  if (tier === "baseline" || !progressive) {
    const l = Math.max(1, level);
    const cellsW = Math.min(34 + Math.ceil(l * 2.8), 96);
    const cellsH = Math.min(24 + 2 * l, 72);
    return { cellsW, cellsH, tier: "baseline", mult: 1.0 };
  }

  // Default progressive growth per level:
  // Continuous smooth curve that grows slightly larger on every level
  const l = Math.max(1, level);
  if (l <= 20) {
    // Normal campaign growth: smooth expansion
    const cellsW = 34 + Math.ceil(l * 2.8);
    const cellsH = 24 + 2 * l;
    return { cellsW, cellsH, tier: "baseline", mult: (cellsW * cellsH) / (37 * 26) };
  } else if (l <= 25) {
    // Phase 1 expansion range (1.9x)
    const t = (l - 20) / 5; // 0..1
    const cellsW = Math.round(90 + (132 - 90) * t);
    const cellsH = Math.round(64 + (100 - 64) * t);
    return { cellsW, cellsH, tier: "phase1", mult: 1.0 + 0.9 * t };
  } else if (l <= 30) {
    // Phase 2 expansion range (4.0x)
    const t = (l - 25) / 5; // 0..1
    const cellsW = Math.round(132 + (192 - 132) * t);
    const cellsH = Math.round(100 + (144 - 100) * t);
    return { cellsW, cellsH, tier: "phase2", mult: 1.9 + 2.1 * t };
  } else {
    // Final 10x deep world (reaches 304x228 at L34)
    const t = Math.min(1.0, (l - 30) / 4);
    const cellsW = Math.round(192 + (304 - 192) * t);
    const cellsH = Math.round(144 + (228 - 144) * t);
    return { cellsW, cellsH, tier: "final_10x", mult: 4.0 + 6.0 * t };
  }
}

/**
 * Resolves the canonical FloorSpec from generation options.
 */
export function resolveFloorSpec(opts: FloorSpecOptions): FloorSpec {
  const level = Math.max(1, opts.level);
  const runSeed = opts.runSeed ?? 1;

  let cellsW: number;
  let cellsH: number;
  let tier: FloorScaleTier;
  let scaleMultiplier: number;

  if (opts.cellsW !== undefined && opts.cellsH !== undefined) {
    cellsW = opts.cellsW;
    cellsH = opts.cellsH;
    tier = opts.tier ?? "baseline";
    scaleMultiplier = opts.scaleMultiplier ?? (cellsW * cellsH) / (96 * 72);
  } else {
    const resolved = calculateProgressiveCells(level, opts.tier, opts.scaleMultiplier, opts.progressive ?? false);
    cellsW = resolved.cellsW;
    cellsH = resolved.cellsH;
    tier = resolved.tier;
    scaleMultiplier = resolved.mult;
  }

  const gridW = cellsW * 2 + 1;
  const gridH = cellsH * 2 + 1;

  // Derive predicted walkable from empirical 0.617 factor on track-first mazes
  const predictedWalkable = Math.round(cellsW * cellsH * 2.53);
  const targetWalkableMin = Math.round(predictedWalkable * 0.85);
  const targetWalkableMax = Math.round(predictedWalkable * 1.25);

  const sectorSize = CANONICAL_SECTOR_SIZE;
  const sectorsX = Math.max(1, Math.ceil(gridW / sectorSize));
  const sectorsY = Math.max(1, Math.ceil(gridH / sectorSize));

  // Compute parameterized LevelConfig for this scale.
  // floorTiles must be baseCfg.floorTiles (the reference floor) so that areaRatio = walkable / cfg.floorTiles
  // correctly reflects the enlargement factor vs the reference floor (as required by decorate and mega-floor).
  const baseCfg = levelConfig(level);
  const cfg: LevelConfig = {
    ...baseCfg,
    cellsW,
    cellsH,
    floorTiles: baseCfg.floorTiles,
  };

  return {
    level,
    runSeed,
    generatorRevision: GENERATOR_REVISION,
    tier,
    scaleMultiplier,
    cellsW,
    cellsH,
    gridW,
    gridH,
    predictedWalkable,
    targetWalkableMin,
    targetWalkableMax,
    sectorSize,
    sectorsX,
    sectorsY,
    cfg,
  };
}
