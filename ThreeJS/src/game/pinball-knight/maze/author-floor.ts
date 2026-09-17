import { analyzePatternGrammar, isLegalSlotForPart } from './pattern-grammar';
import { placeRoomActivity } from './room-activities';
import { finishClearance } from './clearance-finish';
import { enforceLaunchExits } from './launch-exits';
import { enforceWallJoins } from "./wall-junctions";
/**
 * Shared deterministic floor authoring. No live state, lighting, or spawning.
 * All callers use the same modifier → topology → secrets → decoration → lamps
 * draw order. Surface painting owns a separate stream. Do not reorder draws:
 * population receives the returned RNG at exactly this boundary.
 */
import { floorRng, floorSeed } from "./floor-seed";
import type { Grid, TilePos } from "./generator";
import { HAZARDS_BASE, HAZARDS_MAX, HAZARDS_PER_LEVEL, PARTS_BASE, PARTS_MAX, PARTS_PER_LEVEL, ROOM_MAX_CELLS, ROOM_MIN_CELLS, SURFACE_BANDS, TARGETS_PER_FLOOR, TRACK_FIRST, TRAPDOORS_PER_FLOOR, VAULT_RAMPS_PER_FLOOR, floorBudgets, levelConfig } from "../constants";
import { ARCHETYPES, archetypeFor, windinessFor } from "./archetypes";
import { type PrefabAnchor, decorateMaze, pickEndpoints, widenMainArtery } from "./decorate";
import { walkableCount } from "./floor-metrics";
import { repairFloorDensity } from "./floor-density-repair";
import { at, T_FLOOR, carveRooms, crackSecretWalls, generateMaze, thickenWalls, tileCenter } from "./generator";
import { authorLampPuzzle, lampCountFor } from "./lamp-puzzle";
import { nearestOpenTile } from "./nearest-open-tile";
import { rollModifier } from "./modifiers";
import { pickFocusCells, stampLandmark, stampPrefabs, themeFor } from "./prefabs";
import { paintBands, paintSurfaces } from "./surface-paint";
import { buildTrackFloor } from "./track-floor";
import { nearSealed } from "./track-socket";
import { pruneSealedBands, stampSecretBands } from "../secrets";

import { resolveFloorSpec, type FloorSpec } from "./spec/floor-spec";
import type { FloorScaleTier } from "../constants/level";
import { buildSectorGraph } from "./sectors/sector-graph";
import type { SectorGraph, SectorPlan } from "./sectors/sector-types";
import { generateSectorPlan } from "./sectors/sector-plan";
import { buildLandingPadRegistry, type LandingPadRegistry } from "./traversal/landing-pad-registry";
import { computeTraversalRouteMetrics, type RouteMetricsReport } from "./traversal/route-graph-metrics";
import { repairNarrowGaps } from "./gap-clearance";

export interface FloorAuthorOptions {
  level: number;
  runSeed: number;
  bonusRoom?: boolean;
  tier?: FloorScaleTier;
  scaleMultiplier?: number;
  progressive?: boolean;
  /** Diagnostic overrides; omitted in the live game. */
  cellsW?: number;
  cellsH?: number;
  archIndex?: number;
  trackDensity?: number;
  density?: "raw" | "shipped";
  wallGrammar?: boolean;
  strictLaunchers?: boolean;
  funnels?: boolean;
  relays?: boolean;
  funnelTune?: { throatDeg?: number; depth?: number; segments?: number };
}

/** Raw topology for geometry-only probes; deliberately stops before content. */
export function authorFloorTopology(opts: FloorAuthorOptions) {
  const { level, runSeed } = opts;
  const spec = resolveFloorSpec(opts);
  const cfg = spec.cfg;
  const rng = floorRng(runSeed, level);
  const arch = opts.archIndex === undefined ? archetypeFor(level) : ARCHETYPES[opts.archIndex];
  if (!arch) throw new RangeError(`Unknown floor archetype index: ${opts.archIndex}`);
  const modifier = rollModifier(level, rng);
  const windiness = windinessFor(level, arch, rng);
  const trackDensity = opts.trackDensity ?? Math.max(0.35, Math.min(0.85, windiness));
  const started = performance.now();
  const track = TRACK_FIRST ? buildTrackFloor(cfg.cellsW, cfg.cellsH, rng, {
    profile: arch.track, density: trackDensity, funnels: opts.funnels,
    funnelTune: opts.funnelTune, relays: opts.relays,
  }) : null;
  const sectorPlan = generateSectorPlan(spec);
  return { level, runSeed, cfg, spec, sectorPlan, rng, arch, modifier, windiness, trackDensity, track, trackMs: performance.now() - started };
}

/** Finished floor, including the live legacy fallback if track growth declines. */
export function authorMaze(opts: FloorAuthorOptions) {
  const { level, runSeed, cfg, spec, sectorPlan, rng, arch, modifier, windiness, trackDensity, track, trackMs } = authorFloorTopology(opts);
  const bonusRoom = opts.bonusRoom ?? false;
  const theme = themeFor(level);
  let grid: Grid;
  let endpoints: { start: TilePos; stairs: TilePos } | null;
  let rooms: Array<{ i0: number; j0: number; w: number; h: number }> = [];
  let anchors: PrefabAnchor[] = [];
  // Geometry is authored before content, with a reachable legacy fallback.
  if (track) {
    grid = track.grid;
    endpoints = { start: track.start, stairs: track.stairs };
    rooms = track.chambers;
  } else {
    const raw = generateMaze(cfg.cellsW, cfg.cellsH, rng, cfg.braid * arch.braidMult, windiness, {
      seeds: arch.seeds(cfg.cellsW, cfg.cellsH, rng) ?? undefined,
      solidSeeds: arch.solid,
      braidGradient: arch.braidGradient,
    });
    const rawRooms = carveRooms(raw, rng, cfg.rooms + (bonusRoom ? 1 : 0), ROOM_MIN_CELLS, ROOM_MAX_CELLS);
    const landmark = stampLandmark(raw, rng, theme);
    const focus = pickFocusCells(raw, rng);
    const prefabCount = Math.min(3 + Math.floor((level - 1) / 2), 6);
    const stamped = stampPrefabs(raw, rng, prefabCount, theme, landmark.claimed, focus);
    crackSecretWalls(raw, rng, cfg.secrets);
    grid = thickenWalls(raw);
    endpoints = pickEndpoints(grid, rng);
    if (endpoints) widenMainArtery(grid, endpoints);
    rooms = rawRooms.map((r) => ({ i0: r.i0 * 2, j0: r.j0 * 2, w: r.w * 2, h: r.h * 2 }));
    anchors = [...landmark.anchors, ...stamped.anchors].map((a) => ({ i: a.i * 2, j: a.j * 2, kind: a.kind }));
  }
  if (track) {
    stampSecretBands(grid, rng, cfg.secrets, {
      avoid: (i, j) => nearSealed(grid, track.mask, i, j),
    });
  }
  // On scaled floors, repair any diagonal narrow gaps to ensure 0 narrow apertures
  if (spec.cellsW > 96 || spec.cellsH > 72 || spec.tier !== "baseline") {
    repairNarrowGaps(grid, () => false);
  }
  // Budgets use actual area. Diagnostic mega floors may scale flat terms.
  let walkable = walkableCount(grid);
  const budget = floorBudgets(level, walkable, spec.tier);
  const areaRatio = walkable / Math.max(1, cfg.floorTiles);
  const levelTerm = Math.min(PARTS_BASE + (level - 1) * PARTS_PER_LEVEL, PARTS_MAX);
  const scaled = opts.density === "shipped";
  const baseBudget = (scaled ? Math.round(levelTerm * areaRatio) : levelTerm) + budget.partsArea;
  const partBudget = Math.max(4, Math.round(baseBudget * modifier.partMult));
  const scaleCount = (n: number): number => scaled ? Math.max(1, Math.round(n * areaRatio)) : n;
  const sectorGraph = buildSectorGraph(grid, { start: endpoints?.start, stairs: endpoints?.stairs });
  const landingPads = buildLandingPadRegistry(grid, sectorGraph, {
    stairs: endpoints?.stairs,
  });

  const decorateStart = performance.now();
  const plan = decorateMaze(
    grid,
    rng,
    Math.max(1, Math.round(budget.zombies * modifier.hordeMult)),
    Math.max(4, Math.round(budget.torches * modifier.torchMult)),
    partBudget,
    rooms,
    {
      anchors,
      deal: modifier.dealBias.length ? ([...modifier.dealBias, ...theme.deal] as typeof theme.deal) : theme.deal,
      targets: scaleCount(TARGETS_PER_FLOOR),
      trapdoors: scaleCount(Math.round(TRAPDOORS_PER_FLOOR * modifier.trapdoorMult)),
      vaultRamps: scaleCount(VAULT_RAMPS_PER_FLOOR), // ramps aimed ACROSS a band, so the hop jumps the maze
      hazards: scaleCount(Math.round(Math.min(HAZARDS_BASE + (level - 1) * HAZARDS_PER_LEVEL, HAZARDS_MAX) * modifier.hazardMult)),
      forceVault: bonusRoom, // a grade-unlocked bonus floor guarantees a vault
      launchBreaks: cfg.launchBreaks, // A1 — smashable walls at launch-runway ends, scaled by depth
      bonusItems: modifier.bonusItems,
      endpoints: endpoints ?? undefined,
      assemblySeed: floorSeed(runSeed, level),
      strictLaunchers: opts.strictLaunchers ?? !!track,
      chute: track?.chute ?? null,
      orbit: track?.orbit ?? null,
      wallsAuthored: !!track,
      wallGrammar: opts.wallGrammar ?? true,
      floor: level, // ITEM RARITY is depth-biased — see rollItemRarity
      doorways: track?.doorways,
      playSpaces: track?.playSpaces,
      sectorPlan,
      sectorGraph,
      landingPadRegistry: landingPads,
      floorSpec: spec,
    },
  );

  const decorateMs = performance.now() - decorateStart;

  pruneSealedBands(grid, plan.secrets);
  // Secret pruning can change a shaped wall's exposed straight terminals.
  enforceWallJoins(grid);

  // Final geometry audit must observe secret bands and decoration, not only
  // the planned doorways. Only open stone here, never occupy furnished floor.
  const clearanceAudit = track ? finishClearance(grid, track.mask) : null;
  walkable = walkableCount(grid);

  // Lamps share the floor RNG and reserve all existing content.
  const puzzleOccupied = new Set<string>();
  const markOcc = (t: { i: number; j: number } | null | undefined): void => {
    if (t) puzzleOccupied.add(`${t.i},${t.j}`);
  };
  markOcc(plan.start);
  markOcc(plan.stairs);
  const bossSpot = nearestOpenTile(grid, plan.stairs.i, plan.stairs.j, 2) ?? plan.stairs;
  markOcc(bossSpot);
  plan.parts.forEach(markOcc);
  plan.spawns.forEach(markOcc);
  plan.items.forEach(markOcc);
  plan.props.forEach(markOcc);
  plan.torches.forEach(markOcc);
  const lampPuzzlePlan = authorLampPuzzle(grid, plan.start, (i, j) => puzzleOccupied.has(`${i},${j}`), rng, lampCountFor(level), bossSpot);
  if (lampPuzzlePlan) {
    plan.parts.push(...lampPuzzlePlan.lamps);
    markOcc(lampPuzzlePlan.vault);
  }

  // Materials use an independent stream, leaving the population RNG intact.
  const surfaceSeed = (runSeed ^ (level * 0x85ebca6b)) >>> 0;
  const surfaceSafe = [tileCenter(grid, plan.start.i, plan.start.j), tileCenter(grid, plan.stairs.i, plan.stairs.j)];
  paintSurfaces(grid, surfaceSeed, {
    mix: modifier.surfaceMix,
    coverage: modifier.surfaceCoverage,
    safeSpots: surfaceSafe,
  });
  if (SURFACE_BANDS && arch.track.bands) {
    paintBands(grid, surfaceSeed, plan.start, arch.track.bands, surfaceSafe);
  }

  const densityRepair = track ? repairFloorDensity(plan, walkable, anchors.filter(a => a.kind === "spawn")) : null;

  // Finished open-room pockets get a compact slalom activity when the normal
  // corridor placer could not fit one. Spend only actual remaining capacity.
  if (track?.playSpaces?.length && !plan.parts.some(p => p.pattern === 'chicane')) {
    const roomGrammar = analyzePatternGrammar(grid, track.doorways, rooms);
    const activityReserved = new Set([...plan.items, ...plan.props, ...plan.spawns, ...plan.torches].map(p => `${p.i},${p.j}`));
    if (lampPuzzlePlan) activityReserved.add(`${lampPuzzlePlan.vault.i},${lampPuzzlePlan.vault.j}`);
    const activityCandidates: TilePos[] = [];
    // Irregular rooms need more than their square-window centres: inspect
    // actual open pockets, still requiring clear floor around every part.
    for (let j = 2; j < grid.h - 2; j += 2) for (let i = 2; i < grid.w - 2; i += 2)
      if (at(grid, i, j) === T_FLOOR) activityCandidates.push({ i, j });
    // Preserve the coarse search order, then inspect the skipped offsets.
    // Closing a diagonal aperture can shift a valid small pattern by one tile.
    for (let j = 2; j < grid.h - 2; j++) for (let i = 2; i < grid.w - 2; i++)
      if ((i % 2 || j % 2) && at(grid, i, j) === T_FLOOR) activityCandidates.push({ i, j });
    placeRoomActivity(grid, plan.parts, activityCandidates, {
      budget: Math.max(partBudget, Math.floor(walkable * 31 / 1000)),
      allowed: p => {
        if (activityReserved.has(`${p.i},${p.j}`) || nearSealed(grid, track.mask, p.i, p.j) ||
            Math.abs(p.i - plan.start.i) + Math.abs(p.j - plan.start.j) < 5 ||
            Math.abs(p.i - plan.stairs.i) + Math.abs(p.j - plan.stairs.j) < 5) return false;
        return isLegalSlotForPart(p.kind, roomGrammar.getSlot(p.i, p.j).slotType);
      },
    });
    plan.parts.forEach(markOcc);
  }

  enforceLaunchExits(grid, plan.parts);

  const shortcuts = plan.parts
    .filter((p) => (p.kind === "catapult" || p.kind === "cannon" || p.kind === "spring") && p.destI !== undefined && p.destJ !== undefined)
    .map((p, idx) => ({
      id: `shortcut_${idx}`,
      kind: p.kind,
      from: { i: p.i, j: p.j },
      to: { i: p.destI!, j: p.destJ! },
      costTiles: p.kind === "cannon" ? 8 : 5,
    }));
  const routeMetrics = computeTraversalRouteMetrics(
    grid,
    plan.start,
    plan.stairs,
    shortcuts,
    sectorGraph,
    { minTraversalRatio: spec.traversalPolicy.minimumTraversalRatio },
  );

  return { level, runSeed, cfg, spec, sectorPlan, rng, arch, modifier, windiness, trackDensity, bonusRoom,
    track, grid, plan, lampPuzzlePlan, clearanceAudit, theme, walkable, budget, partBudget, areaRatio, densityRepair,
    doorways: track?.doorways ?? [], timing: { track: trackMs, decorate: decorateMs },
    sectorGraph, landingPads, routeMetrics };
}
