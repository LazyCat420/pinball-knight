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
import { carveRooms, crackSecretWalls, generateMaze, thickenWalls, tileCenter } from "./generator";
import { authorLampPuzzle, lampCountFor } from "./lamp-puzzle";
import { nearestOpenTile } from "./nearest-open-tile";
import { rollModifier } from "./modifiers";
import { pickFocusCells, stampLandmark, stampPrefabs, themeFor } from "./prefabs";
import { paintBands, paintSurfaces } from "./surface-paint";
import { buildTrackFloor } from "./track-floor";
import { nearSealed } from "./track-socket";
import { pruneSealedBands, stampSecretBands } from "../secrets";

export interface FloorAuthorOptions {
  level: number;
  runSeed: number;
  bonusRoom?: boolean;
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
  const reference = levelConfig(level);
  const cfg = { ...reference, cellsW: opts.cellsW ?? reference.cellsW, cellsH: opts.cellsH ?? reference.cellsH };
  const rng = floorRng(runSeed, level);
  const arch = opts.archIndex === undefined ? archetypeFor(level) : ARCHETYPES[opts.archIndex];
  if (!arch) throw new RangeError(`Unknown floor archetype index: ${opts.archIndex}`);
  const modifier = rollModifier(level, rng);
  const windiness = windinessFor(level, arch, rng);
  const trackDensity = opts.trackDensity ?? Math.max(0.35, Math.min(0.85, windiness));
  const started = Date.now();
  const track = TRACK_FIRST ? buildTrackFloor(cfg.cellsW, cfg.cellsH, rng, {
    profile: arch.track, density: trackDensity, funnels: opts.funnels,
    funnelTune: opts.funnelTune, relays: opts.relays,
  }) : null;
  return { level, runSeed, cfg, rng, arch, modifier, windiness, trackDensity, track, trackMs: Date.now() - started };
}

/** Finished floor, including the live legacy fallback if track growth declines. */
export function authorMaze(opts: FloorAuthorOptions) {
  const { level, runSeed, cfg, rng, arch, modifier, windiness, trackDensity, track, trackMs } = authorFloorTopology(opts);
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
  // Budgets use actual area. Diagnostic mega floors may scale flat terms.
  const walkable = walkableCount(grid);
  const budget = floorBudgets(level, walkable);
  const areaRatio = walkable / Math.max(1, cfg.floorTiles);
  const levelTerm = Math.min(PARTS_BASE + (level - 1) * PARTS_PER_LEVEL, PARTS_MAX);
  const scaled = opts.density === "shipped";
  const baseBudget = (scaled ? Math.round(levelTerm * areaRatio) : levelTerm) + budget.partsArea;
  const partBudget = Math.max(4, Math.round(baseBudget * modifier.partMult));
  const scaleCount = (n: number): number => scaled ? Math.max(1, Math.round(n * areaRatio)) : n;
  const decorateStart = Date.now();
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
    },
  );

  const decorateMs = Date.now() - decorateStart;

  pruneSealedBands(grid, plan.secrets);

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

  return { level, runSeed, cfg, rng, arch, modifier, windiness, trackDensity, bonusRoom,
    track, grid, plan, lampPuzzlePlan, theme, walkable, budget, partBudget, areaRatio, densityRepair,
    doorways: track?.doorways ?? [], timing: { track: trackMs, decorate: decorateMs } };
}
