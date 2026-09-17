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

export type MissionTemplate =
  | "linear_descent"
  | "branching_hunt"
  | "locked_vault"
  | "mechanism_gauntlet"
  | "boss_approach";

export interface SectorPolicy {
  sizeTiles: number;
  minCriticalPathSectors: number;
  targetOptionalSectors: number;
  minLoopCount: number;
  maxDeadEndFraction: number;
}

export interface TraversalPolicy {
  minimumTraversalRatio: number;
  maxForwardSectorSkip: number;
  bossExclusionRadius: number;
  minStartExclusionRadius: number;
}

export interface RuntimeBudget {
  maxVisibleSectorRadius: number;
  maxActiveEnemyCount: number;
  maxActiveLights: number;
  generationBudgetMs: number;
}

export interface FloorScaleBudget {
  tier: FloorScaleTier;
  cellsW: number;
  cellsH: number;
  gridW: number;
  gridH: number;
  targetWalkableMin: number;
  targetWalkableMax: number;
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
  missionTemplate: MissionTemplate;
  sectorPolicy: SectorPolicy;
  traversalPolicy: TraversalPolicy;
  runtimeBudget: RuntimeBudget;
  scale: FloorScaleBudget;
}

export function resolveMissionTemplate(level: number, bonusRoom = false): MissionTemplate {
  if (bonusRoom) return "locked_vault";
  if (level === 8 || level === 16 || level === 22) return "locked_vault";
  if (level === 10 || level === 19 || level === 25) return "mechanism_gauntlet";
  if (level % 5 === 0 && level >= 5) return "boss_approach";
  if ((level >= 6 && level <= 9) || (level >= 15 && level <= 18)) return "branching_hunt";
  return "linear_descent";
}

export const GENERATOR_REVISION = 2;
export const CANONICAL_SECTOR_SIZE = 32;


/**
 * Calculates progressive floor dimensions for a given level.
 * When progressive is enabled:
 * - Level 1: Starts at comfortable onboarding size 50x38 cells (101x77 tiles).
 * - Level 2-5: Ramps through 60x45 to 90x68 cells (121x91 to 181x137 tiles).
 * - Level 6-9: Surpasses baseline, growing from 100x75 to 130x98 cells (201x151 to 261x197 tiles).
 * - Level 10: Vast multi-sector labyrinth at 140x105 cells (281x211 tiles, 2.13x area, >7,000 walkable).
 * - Level 11-19: Deep scaling through 156x117 to 288x216 cells (up to 9.0x area).
 * - Level 20+: Full 10x Abyss ceiling at 304x228 cells (609x457 tiles, 10.0x area, ~30,000 walkable).
 */
export function calculateProgressiveCells(
  level: number,
  tier?: FloorScaleTier,
  scaleMultiplier?: number,
  legacyMode = false,
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

  // Baseline tier override or legacyMode clamp
  if (tier === "baseline" || legacyMode) {
    const l = Math.max(1, level);
    const cellsW = Math.min(34 + Math.ceil(l * 2.8), 96);
    const cellsH = Math.min(24 + 2 * l, 72);
    return { cellsW, cellsH, tier: "baseline", mult: 1.0 };
  }

  // Option A Aggressive Progressive Growth per level:
  // - Level 1: 64x48 cells (129x97 tiles, 0.44x area)
  // - Level 5: 121x91 cells (243x183 tiles, 1.59x area, exceeds old 96x72 baseline)
  // - Level 10: 192x144 cells (385x289 tiles, 4.00x area, Phase 2 "Pretty Big" milestone)
  // - Level 20+: 304x228 cells (609x457 tiles, 10.00x area Abyss ceiling)
  const l = Math.max(1, level);
  if (l <= 1) {
    const cellsW = 64;
    const cellsH = 48;
    return { cellsW, cellsH, tier: "baseline", mult: (cellsW * cellsH) / (96 * 72) };
  } else if (l <= 10) {
    const t = (l - 1) / 9; // 0..1
    const cellsW = Math.round(64 + (192 - 64) * t);
    const cellsH = Math.round(48 + (144 - 48) * t);
    const mult = (cellsW * cellsH) / (96 * 72);
    const tier: FloorScaleTier = mult < 1.0 ? "baseline" : mult < 3.0 ? "phase1" : "phase2";
    return { cellsW, cellsH, tier, mult };
  } else if (l <= 20) {
    const t = (l - 10) / 10; // 0..1
    const cellsW = Math.round(192 + (304 - 192) * t);
    const cellsH = Math.round(144 + (228 - 144) * t);
    const mult = (cellsW * cellsH) / (96 * 72);
    const tier: FloorScaleTier = mult < 7.5 ? "phase2" : "final_10x";
    return { cellsW, cellsH, tier, mult };
  } else {
    // 10x ceiling for deep abyss floors
    const cellsW = 304;
    const cellsH = 228;
    return { cellsW, cellsH, tier: "final_10x", mult: (cellsW * cellsH) / (96 * 72) };
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
    const resolved = calculateProgressiveCells(level, opts.tier, opts.scaleMultiplier, false);
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

  const missionTemplate = resolveMissionTemplate(level, opts.bonusRoom ?? false);

  const sectorPolicy: SectorPolicy = {
    sizeTiles: sectorSize,
    minCriticalPathSectors: tier === "baseline" ? 3 : tier === "phase1" ? 4 : tier === "phase2" ? 6 : 8,
    targetOptionalSectors: tier === "baseline" ? 1 : tier === "phase1" ? 2 : tier === "phase2" ? 3 : 5,
    minLoopCount: tier === "baseline" ? 0 : 1,
    maxDeadEndFraction: 0.25,
  };

  const traversalPolicy: TraversalPolicy = {
    minimumTraversalRatio: 0.60,
    maxForwardSectorSkip: 2,
    bossExclusionRadius: 18,
    minStartExclusionRadius: 12,
  };

  const runtimeBudget: RuntimeBudget = {
    maxVisibleSectorRadius: 1,
    maxActiveEnemyCount: Math.min(48, Math.round(24 * Math.sqrt(scaleMultiplier))),
    maxActiveLights: 16,
    generationBudgetMs: tier === "final_10x" ? 1200 : tier === "phase2" ? 750 : 350,
  };

  const scale: FloorScaleBudget = {
    tier,
    cellsW,
    cellsH,
    gridW,
    gridH,
    targetWalkableMin,
    targetWalkableMax,
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
    missionTemplate,
    sectorPolicy,
    traversalPolicy,
    runtimeBudget,
    scale,
  };
}
