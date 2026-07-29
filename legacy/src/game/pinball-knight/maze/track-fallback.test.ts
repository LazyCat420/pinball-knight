/**
 * WHICH BRANCH ACTUALLY SHIPS — the test that stops the legacy generator
 * reading as coverage.
 *
 * `core.ts buildLevel` has two ways to make a floor: `buildTrackFloor`, and a
 * legacy `generateMaze → carveRooms → stampLandmark → stampPrefabs →
 * thickenWalls` chain kept as the fallback for when track growth degenerates.
 * Five test files exercise the legacy chain — `floor-pipeline`, `floor-rules`,
 * `collision`, `secret-supply`, `prefabs` — and every one of them is green.
 *
 * None of them ships. Measured over 400 floors across 5 archetypes × 10 depths,
 * `buildTrackFloor` returned null **zero** times, so the legacy chain built
 * nothing a player has ever stood on. Until this file, nothing in the suite
 * said so, and the *volume* of green tests over the dead chain read as the
 * opposite: that it was the well-covered part of the generator.
 *
 * So this test measures the thing the other five imply and none of them check:
 * WHICH generator produced the floor. Two properties, and they are different
 * claims:
 *
 *  1. The fallback rate is 0 — the legacy chain is a fallback, not a branch.
 *     If this ever goes non-zero the profiles have been retuned past the point
 *     where the flow network survives pruning, which is a real regression and
 *     one that would otherwise show up only as "some floors feel different".
 *  2. The fallback is still WIRED. A fallback nobody can reach is just dead
 *     code with a comment on it, so we build one explicitly and assert it
 *     produces a legal floor.
 */
import { describe, it, expect } from "vitest";
import { mulberry32, thickenWalls, generateMaze, carveRooms, isWalkable } from "./generator";
import { buildTrackFloor } from "./track-floor";
import { ARCHETYPES, DEFAULT_TRACK_PROFILE, windinessFor } from "./archetypes";
import { levelConfig, ROOM_MIN_CELLS, ROOM_MAX_CELLS } from "../constants";
import { floorRng } from "./floor-seed";

describe("the legacy generator is a fallback, not a branch", () => {
  it("buildTrackFloor never falls back, at depths nothing else samples", () => {
    // ── WHY THIS SWEEP IS SMALL, AND WHY THAT IS NOT NARROWING IT ──────────
    //
    // The first version built 105 floors of its own and cost 20 SECONDS —
    // roughly a fifth of the whole suite's floor-generation budget — to measure
    // a rate that was already being measured. `floor-metrics.test.ts` builds
    // 108 floors across two sweeps and pushes a failure on `generator returned
    // null` in both, so the fallback rate was observed over 108 floors before
    // this file existed. Paying for it a second time is not coverage, it is a
    // duplicate bill, and on a loaded box that bill is charged to every
    // timeout-sensitive test in the suite (see the note in piece-rules.test.ts).
    //
    // So this sweep deliberately covers what the other one does NOT: those two
    // sweeps run levels 1-12 and {1, 5, 11, 20}, and degeneracy — a flow
    // network that prunes to no edges — is likeliest on the DEEPEST floors,
    // where the node clamps bind hardest. 30 floors here at depths 2/14/26,
    // plus 108 there, is 138 observed against the old 105, for a third of the
    // cost.
    let floors = 0;
    let nulls = 0;
    const failures: string[] = [];
    for (let a = 0; a < ARCHETYPES.length; a++) {
      const arch = ARCHETYPES[a];
      for (const level of [2, 14, 26]) {
        for (let s = 0; s < 2; s++) {
          const seed = 0x77c1 + s * 15485863 + level * 7919 + a * 104729;
          const cfg = levelConfig(level);
          const rng = floorRng(seed, level);
          const windiness = windinessFor(level, arch, rng);
          const t = buildTrackFloor(cfg.cellsW, cfg.cellsH, rng, {
            profile: arch.track,
            density: Math.max(0.35, Math.min(0.85, windiness)),
          });
          floors++;
          if (!t) {
            nulls++;
            failures.push(`${arch.id} L${level} seed=${seed}`);
          }
        }
      }
    }
    // A sweep too small to see a 1-in-100 fallback would pass while saying
    // nothing, which is the failure mode this whole file exists to name — so
    // the guard stays, sized to THIS sweep, and the 108 floors floor-metrics
    // observes are what carry the rate.
    expect(floors, "sweep too small to measure a fallback rate").toBeGreaterThan(24);
    expect(`${nulls} fallbacks: ${failures.slice(0, 5).join(", ")}`).toBe("0 fallbacks: ");
  }, 300000);

  it("the fallback still builds a legal floor when it is reached", () => {
    // Property 2. `buildTrackFloor` will not fail on demand, so the legacy
    // chain is invoked directly — exactly the sequence core.ts runs inside its
    // `else`. What is asserted is the fallback's whole job: a connected floor
    // with real walls on it.
    const level = 6;
    const cfg = levelConfig(level);
    const rng = mulberry32(0xfa11ba0);
    const arch = ARCHETYPES[0];
    const raw = generateMaze(cfg.cellsW, cfg.cellsH, rng, cfg.braid * arch.braidMult, 0.7, {
      seeds: arch.seeds(cfg.cellsW, cfg.cellsH, rng) ?? undefined,
      solidSeeds: arch.solid,
      braidGradient: arch.braidGradient,
    });
    carveRooms(raw, rng, cfg.rooms, ROOM_MIN_CELLS, ROOM_MAX_CELLS);
    const grid = thickenWalls(raw);
    let walkable = 0;
    for (let j = 0; j < grid.h; j++) for (let i = 0; i < grid.w; i++) if (isWalkable(grid, i, j)) walkable++;
    expect(walkable).toBeGreaterThan(500);
    expect(walkable / (grid.w * grid.h)).toBeLessThan(0.9); // still a maze, not a field
  });

  it("a degenerate profile DOES fall back — the negative control", () => {
    // The rate above is 0, and a gate that has only ever been observed passing
    // is a gate nobody has watched fire. Starve the network of nodes and the
    // generator must hand back null rather than a floor with no circuit in it.
    const t = buildTrackFloor(6, 6, mulberry32(0x1234), {
      profile: { ...DEFAULT_TRACK_PROFILE, foodPer1k: 0, relayPer1k: 0, maxLenFrac: 0.001 },
    });
    expect(t).toBeNull();
  });
});
