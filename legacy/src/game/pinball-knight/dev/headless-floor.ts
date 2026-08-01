/**
 * A REAL FLOOR, BUILT WITHOUT A BROWSER.
 *
 * The maze layer is DOM- and three-free by contract, so the shipping generator
 * can be called straight from node. This module is that call chain and nothing
 * else — no budget arithmetic, no re-derived constants, no local copy of what
 * `core.ts startLevel` decides. Every number it uses comes from `levelConfig`
 * and `archetypeFor`, which is what makes it safe to measure against.
 *
 * ⚠️ TWIN: `maze/floor-rules.test.ts` `floorContext()` runs the SAME chain to
 * build the floors the rule gate judges. The two must move together. If you add
 * a stage to `startLevel` that changes geometry, add it in both or the census
 * and the gate stop describing the same floor.
 *
 * The distinction that matters — and the scar it comes from — is recorded on
 * `maze/floor-pipeline.test.ts`: a harness that RE-IMPLEMENTS the pipeline
 * drifts, and drifts in exactly the direction that hides the bug (that one went
 * three tunings stale while testing a floor nobody had shipped in months).
 * Calling the shipped function is the opposite of that.
 */
import { generateMaze, carveRooms, crackSecretWalls, type Grid, type TilePos } from "../maze/generator";
import { stampPrefabs, stampLandmark, pickFocusCells, themeFor } from "../maze/prefabs";
import { archetypeFor, windinessFor } from "../maze/archetypes";
import { buildTrackFloor } from "../maze/track-floor";
import { floorRng } from "../maze/floor-seed";
import { rollModifier } from "../maze/modifiers";
import { decorateMaze, type LevelPlan } from "../maze/decorate";
import { walkableCount } from "../maze/floor-metrics";
import { stampSecretBands } from "../secrets";
import { nearSealed } from "../maze/track-socket";
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
import type { Doorway } from "../maze/doorways";

export interface HeadlessFloor {
  grid: Grid;
  start: TilePos;
  stairs: TilePos;
  doorways: Doorway[];
  archetype: string;
  level: number;
  runSeed: number;
  relaxed: string[];
}

/** Build one floor exactly as `core.ts startLevel` does. Null if the generator declined. */
export function buildHeadlessFloor(
  level: number,
  runSeed: number,
  funnels = false,
  funnelTune: { throatDeg?: number; depth?: number; segments?: number } = {},
  relays = false,
): HeadlessFloor | null {
  const rng = floorRng(runSeed, level);
  const cfg = levelConfig(level);
  const arch = archetypeFor(level);
  const windiness = windinessFor(level, arch, rng);
  const raw = generateMaze(cfg.cellsW, cfg.cellsH, rng, cfg.braid * arch.braidMult, windiness, {
    seeds: arch.seeds(cfg.cellsW, cfg.cellsH, rng) ?? undefined,
    solidSeeds: arch.solid,
    braidGradient: arch.braidGradient,
  });
  carveRooms(raw, rng, cfg.rooms, 3, 6);
  const theme = themeFor(level, runSeed);
  const landmark = stampLandmark(raw, rng, theme);
  const focus = pickFocusCells(raw, rng);
  stampPrefabs(raw, rng, Math.min(3 + Math.floor((level - 1) / 2), 6), theme, landmark.claimed, focus);
  crackSecretWalls(raw, rng, cfg.secrets);
  const track = buildTrackFloor(cfg.cellsW, cfg.cellsH, rng, {
    profile: arch.track,
    density: Math.max(0.35, Math.min(0.85, windiness)),
    funnels,
    funnelTune,
    relays,
  });
  if (!track) return null;
  return {
    grid: track.grid,
    start: track.start,
    stairs: track.stairs,
    doorways: track.doorways,
    archetype: arch.id,
    level,
    runSeed,
    relaxed: track.relaxed,
  };
}

/**
 * A finished floor WITH ITS CONTENT — geometry, then `decorateMaze`.
 *
 * ── Why this does not call `buildHeadlessFloor` ───────────────────────────
 *
 * Because `buildHeadlessFloor` does not build the floor the game ships, and
 * neither does the `liveFloor()` helper in `maze/floor-density.test.ts`. This
 * was measured, not assumed — a probe comparing walkable count and endpoints
 * over 15 (level, seed) pairs found the shipped chain and the
 * `buildHeadlessFloor` chain agreeing on **0 of 15**.
 *
 * `spawn/floor-authoring.ts` `authorFloor` states the contract in its own
 * header — "THE ORDER OF THE DRAWS IS THE CONTRACT" — and its order is:
 *
 *     floorRng → rollModifier → windinessFor → buildTrackFloor
 *              → stampSecretBands → decorateMaze
 *
 * `buildHeadlessFloor` inserts an entire legacy maze (`generateMaze`,
 * `carveRooms`, `stampLandmark`, `pickFocusCells`, `stampPrefabs`,
 * `crackSecretWalls`) between `windinessFor` and `buildTrackFloor`. On the
 * TRACK branch — the branch that ships, and `buildTrackFloor` has declined 0
 * times in 400 measured floors — none of those calls happen; that whole block
 * lives in `authorFloor`'s `else`. Every one of them draws from the shared rng,
 * so the track floor built afterwards is a different floor. `liveFloor` drifts
 * the other way, omitting `rollModifier` and `stampSecretBands`, which also
 * draw.
 *
 * So this function mirrors `authorFloor` draw for draw instead of reusing
 * either. It stops after `decorateMaze` — the pass that decides every part —
 * and therefore does NOT run `authorLampPuzzle` or `pruneSealedBands`, which
 * come after it and do not place parts.
 *
 * The two inputs `authorFloor` reads from live run state rather than from the
 * seed are surfaced as options, so a census can hold them fixed: `bonusRoom`
 * (a grade-S/A descent unlocks a guaranteed vault) and the run seed itself.
 */
export interface HeadlessPlan extends HeadlessFloor {
  plan: LevelPlan;
  walkable: number;
  modifier: string;
}

export function buildHeadlessPlan(level: number, runSeed: number, bonusRoom = false): HeadlessPlan | null {
  const rng = floorRng(runSeed, level);
  const cfg = levelConfig(level);
  const arch = archetypeFor(level);
  const modifier = rollModifier(level, rng);
  const windiness = windinessFor(level, arch, rng);
  const theme = themeFor(level, runSeed);
  const track = buildTrackFloor(cfg.cellsW, cfg.cellsH, rng, {
    profile: arch.track,
    density: Math.max(0.35, Math.min(0.85, windiness)),
  });
  if (!track) return null;
  const grid = track.grid;
  stampSecretBands(grid, rng, cfg.secrets, {
    avoid: (i, j) => nearSealed(grid, track.mask, i, j),
  });
  const walkable = walkableCount(grid);
  const budget = floorBudgets(level, walkable);
  const partBudget = Math.min(PARTS_BASE + (level - 1) * PARTS_PER_LEVEL, PARTS_MAX) + budget.partsArea;
  const plan = decorateMaze(
    grid,
    rng,
    Math.max(1, Math.round(budget.zombies * modifier.hordeMult)),
    Math.max(4, Math.round(budget.torches * modifier.torchMult)),
    Math.max(4, Math.round(partBudget * modifier.partMult)),
    [],
    {
      anchors: [],
      deal: modifier.dealBias.length ? ([...modifier.dealBias, ...theme.deal] as typeof theme.deal) : theme.deal,
      targets: TARGETS_PER_FLOOR,
      trapdoors: Math.round(TRAPDOORS_PER_FLOOR * modifier.trapdoorMult),
      vaultRamps: VAULT_RAMPS_PER_FLOOR,
      hazards: Math.round(Math.min(HAZARDS_BASE + (level - 1) * HAZARDS_PER_LEVEL, HAZARDS_MAX) * modifier.hazardMult),
      forceVault: bonusRoom,
      launchBreaks: cfg.launchBreaks,
      bonusItems: modifier.bonusItems,
      endpoints: { start: track.start, stairs: track.stairs },
      strictLaunchers: true,
      chute: track.chute ?? null,
      orbit: track.orbit ?? null,
      wallsAuthored: true,
      floor: level,
    },
  );
  return {
    grid,
    start: track.start,
    stairs: track.stairs,
    doorways: track.doorways,
    archetype: arch.id,
    level,
    runSeed,
    relaxed: track.relaxed,
    plan,
    walkable,
    modifier: modifier.id,
  };
}
