/**
 * A FINISHED FLOOR, built the way core.ts builds one.
 *
 * Extracted from `maze/floor-density.test.ts`, which had the only faithful copy
 * of this in the tree, so that a second test file could stop guessing at what a
 * floor looks like.
 *
 * ## Why the guessing was a problem
 *
 * Several maze tests build their world as `thickenWalls(generateMaze(...))` —
 * fine for what those files assert, and a perfectly good corridor maze. It is
 * not, however, a floor this game ever ships: the real pipeline carves ROOMS
 * into it and lays a TRACK through it first, and both of those are most of the
 * open space on a floor.
 *
 * `maze/plaza-place.test.ts` was written against the hand-rolled version and
 * drew two conclusions from it, both false:
 *
 *   1. The swingarm pass was broken — it placed 0 arms across 24 seeds. A
 *      swingarm needs a clear disc to sweep, and the fabricated world had
 *      almost none: open discs of radius 2 numbered 0-6 per floor against
 *      28-206 once rooms were carved. The pass was correct; relaxing it to
 *      satisfy that floor would have put arms inside corridors, sweeping
 *      through rock, on every real one.
 *   2. Later, that nothing placed at all — because the small hand-rolled floors
 *      were already at the density cap, leaving the plaza passes no budget.
 *
 * Both times the harness was the thing that was wrong, and both times it
 * presented as a confident, specific, reproducible failure in the code.
 *
 * ## The rule this encodes
 *
 * If a test's conclusion depends on what a floor CONTAINS — space, density,
 * furniture — build it with this. Hand-rolled grids are for assertions about
 * tiles.
 *
 * Test-only: `testkit-boundary.test.ts` enforces that nothing here reaches the
 * client bundle.
 */
import { ARCHETYPES, archetypeFor, windinessFor } from "../maze/archetypes";
import { buildTrackFloor } from "../maze/track-floor";
import { decorateMaze } from "../maze/decorate";
import { walkableCount } from "../maze/floor-metrics";
import { floorRng } from "../maze/floor-seed";
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

export type LiveFloor = NonNullable<ReturnType<typeof liveFloor>>;

/**
 * Geometry, then content. `archIndex` pins the archetype (so a sweep can cover
 * all of them); omit it to take the one the level would really get.
 *
 * Returns null when `buildTrackFloor` declines a seed — callers skip those.
 */
export function liveFloor(level: number, seed: number, archIndex?: number) {
  const cfg = levelConfig(level);
  const arch = archIndex === undefined ? archetypeFor(level) : ARCHETYPES[archIndex];
  const rng = floorRng(seed, level);
  const windiness = windinessFor(level, arch, rng);
  const track = buildTrackFloor(cfg.cellsW, cfg.cellsH, rng, {
    profile: arch.track,
    density: Math.max(0.35, Math.min(0.85, windiness)),
  });
  if (!track) return null;
  const grid = track.grid;
  const walkable = walkableCount(grid);
  const budget = floorBudgets(level, walkable);
  const partBudget = Math.min(PARTS_BASE + (level - 1) * PARTS_PER_LEVEL, PARTS_MAX) + budget.partsArea;
  const plan = decorateMaze(grid, rng, budget.zombies, budget.torches, partBudget, [], {
    targets: TARGETS_PER_FLOOR,
    trapdoors: TRAPDOORS_PER_FLOOR,
    vaultRamps: VAULT_RAMPS_PER_FLOOR,
    hazards: Math.min(HAZARDS_BASE + (level - 1) * HAZARDS_PER_LEVEL, HAZARDS_MAX),
    launchBreaks: cfg.launchBreaks,
    endpoints: { start: track.start, stairs: track.stairs },
    strictLaunchers: true,
    chute: track.chute ?? null,
    orbit: track.orbit ?? null,
    wallsAuthored: true,
    floor: level,
  });
  return { grid, plan, arch, walkable };
}

/** The sweep both the density gate and the plaza gate run: every archetype, six
 *  depths, two seeds each. Skips the seeds `buildTrackFloor` declines. */
export function sweepFloors(levels: readonly number[] = [1, 3, 6, 10, 14, 20], seedsPer = 2): LiveFloor[] {
  const out: LiveFloor[] = [];
  for (let a = 0; a < ARCHETYPES.length; a++) {
    for (const level of levels) {
      for (let s = 0; s < seedsPer; s++) {
        const f = liveFloor(level, 0x2f11 + s * 6113 + level * 271 + a * 3313, a);
        if (f) out.push(f);
      }
    }
  }
  return out;
}
