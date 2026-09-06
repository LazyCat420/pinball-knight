/**
 * FLOOR PLAN — The authoritative composition root for floor generation.
 *
 * ── The pipeline contract ──────────────────────────────────────────────────
 *
 * Replaces scattered and divergent callers with a single typed pipeline:
 *
 *   seed
 *     → floor profile (archetype, modifier, budgets, windiness)
 *     → track topology (buildTrackFloor: cells, rooms, spine, chute, orbit)
 *     → content realization (decorateMaze: furniture, assemblies, items, spawns)
 *     → validation (checkPieces: backing, runways, down-flow)
 *     → FloorPlan result
 *
 * Kept DOM- and three-free so vitest and headless harnesses can run it directly.
 */
import { type Grid, type TilePos } from "./generator";
import { archetypeFor, windinessFor, ARCHETYPES } from "./archetypes";
import { rollModifier } from "./modifiers";
import { buildTrackFloor, type TrackFloor } from "./track-floor";
import { decorateMaze, type LevelPlan, type PinballPartSpot } from "./decorate";
import { walkableCount } from "./floor-metrics";
import { floorRng } from "./floor-seed";
import { checkPieces, type PieceViolation } from "./piece-rules";
import type { FlowPart } from "./flow-loops";
import {
  levelConfig,
  floorBudgets,
  PARTS_BASE,
  PARTS_PER_LEVEL,
  PARTS_MAX,
  TARGETS_PER_FLOOR,
  TRAPDOORS_PER_FLOOR,
  VAULT_RAMPS_PER_FLOOR,
  HAZARDS_BASE,
  HAZARDS_PER_LEVEL,
  HAZARDS_MAX,
} from "../constants";

export interface FloorProfile {
  level: number;
  seed: number;
  arch: (typeof ARCHETYPES)[number];
  modifier: ReturnType<typeof rollModifier>;
  windiness: number;
  density: number;
  walkableBudget: ReturnType<typeof floorBudgets>;
  partBudget: number;
}

export interface FloorPlanOptions {
  archIndex?: number;
  density?: number;
  wallGrammar?: boolean;
  strictLaunchers?: boolean;
}

export interface FloorPlan {
  profile: FloorProfile;
  track: TrackFloor;
  grid: Grid;
  plan: LevelPlan;
  violations: PieceViolation[];
}

/**
 * Authoritative pipeline orchestrator.
 * Returns null if track generation declines the seed.
 */
export function buildFloorPlan(
  level: number,
  seed: number,
  opts: FloorPlanOptions = {},
): FloorPlan | null {
  const cfg = levelConfig(level);
  const arch = opts.archIndex !== undefined ? ARCHETYPES[opts.archIndex] : archetypeFor(level);
  const rng = floorRng(seed, level);
  const modifier = rollModifier(level, rng);
  const windiness = windinessFor(level, arch, rng);
  const density = opts.density ?? Math.max(0.35, Math.min(0.85, windiness));

  // Stage 1: Topology
  const track = buildTrackFloor(cfg.cellsW, cfg.cellsH, rng, {
    profile: arch.track,
    density,
  });
  if (!track) return null;

  const grid = track.grid;
  const walkable = walkableCount(grid);
  const budget = floorBudgets(level, walkable);
  const partBudget =
    Math.min(PARTS_BASE + (level - 1) * PARTS_PER_LEVEL, PARTS_MAX) + budget.partsArea;

  const profile: FloorProfile = {
    level,
    seed,
    arch,
    modifier,
    windiness,
    density,
    walkableBudget: budget,
    partBudget,
  };

  // Stage 2: Realization
  const plan = decorateMaze(grid, rng, budget.zombies, budget.torches, partBudget, [], {
    targets: TARGETS_PER_FLOOR,
    trapdoors: TRAPDOORS_PER_FLOOR,
    vaultRamps: VAULT_RAMPS_PER_FLOOR,
    hazards: Math.min(HAZARDS_BASE + (level - 1) * HAZARDS_PER_LEVEL, HAZARDS_MAX),
    launchBreaks: cfg.launchBreaks,
    endpoints: { start: track.start, stairs: track.stairs },
    strictLaunchers: opts.strictLaunchers ?? true,
    chute: track.chute ?? null,
    orbit: track.orbit ?? null,
    wallsAuthored: true,
    wallGrammar: opts.wallGrammar ?? false,
    floor: level,
  });

  // Stage 3: Validation
  const violations = checkPieces(grid, track.mask, { parts: plan.parts as FlowPart[] });

  return {
    profile,
    track,
    grid,
    plan,
    violations,
  };
}
