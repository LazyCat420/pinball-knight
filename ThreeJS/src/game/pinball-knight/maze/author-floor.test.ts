import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { authorMaze } from "./author-floor";
import * as tracks from "./track-floor";
import { buildFloorPlan } from "./floor-plan";
import { authorHeadlessPlan } from "../dev/headless-floor";
import { liveFloor } from "../testkit/live-floor";

afterEach(() => vi.restoreAllMocks());

// Reviewed after dead-end interactive mechanisms (doors, catapults, cannons, trapdoors, frog) passed geometry/population gates (2026-09-15). Include full
// geometry, surfaces, content, lamps and population RNG, not just piece counts.
// Intentional layout changes must refresh these only after the piece/floor gates.
const BASELINES = [
  [1, 1, false, false, "69ed1eaacf56e2a7162b2adbdaffe552f9058ef1dd9e48bdaa23bad021a74e65"],
  [3, 424242, true, false, "3ae2078469c924a67022d20c0e6f69535b35c3c14b48eba0dfe84d669c0fb487"],
  [5, 12345, false, false, "2f96c202af87a0b177dd943bcbb549e0ed4a964d902122c2e934eaf05080359f"],
  [24, 1, true, false, "c679803be66c8489654ac21c6f4e723c91bd3d82687415371a1e579a49f619bb"],
  [6, 424242, true, true, "439ba1aa2605ca110f367def3f39f0f796b87dc4b1b982789bfe68f23c56e9c9"],
] as const;

describe("shared floor author", () => {
  for (const [level, seed, bonus, fallback, expected] of BASELINES) {
    it(`matches reviewed floor geometry and population RNG: L${level}/${seed}, bonus=${bonus}, fallback=${fallback}`, () => {
      if (fallback) vi.spyOn(tracks, "buildTrackFloor").mockReturnValue(null);
      const f = authorMaze({ level, runSeed: seed, bonusRoom: bonus });
      expect(f.track === null).toBe(fallback);
      const capture = { level, seed, bonus, fallback, grid: f.grid, plan: f.plan,
        lamp: f.lampPuzzlePlan, modifier: f.modifier, doorways: f.doorways,
        nextDraws: Array.from({ length: 8 }, () => f.rng()) };
      const json = JSON.stringify(capture, (_key, value) => value instanceof Set ? [...value] : value);
      expect(createHash("sha256").update(json).digest("hex")).toBe(expected);
    });
  }

  for (const bonusRoom of [false, true]) {
    it(`diagnostic views retain all authored content and surfaces, bonus=${bonusRoom}`, () => {
      const opts = { level: 3, runSeed: 424242, bonusRoom };
      const f = authorMaze(opts);
      const headless = authorHeadlessPlan(opts)!;
      const checked = buildFloorPlan(opts.level, opts.runSeed, { bonusRoom })!;
      expect(headless).toBeTruthy();
      expect(checked).toBeTruthy();
      for (const view of [headless, checked]) {
        expect(view.grid).toEqual(f.grid);
        expect(view.plan).toEqual(f.plan);
      }
      expect(headless.partBudget).toBe(f.partBudget);
      expect(checked.profile.partBudget).toBe(f.partBudget);
      expect(checked.profile.modifier).toEqual(f.modifier);
    });
  }

  it("archetype sweeps use the live author with an explicit override", () => {
    const opts = { level: 1, runSeed: 424242, archIndex: 2 };
    const f = authorMaze(opts);
    const views = [liveFloor(opts.level, opts.runSeed, opts.archIndex)!,
      buildFloorPlan(opts.level, opts.runSeed, { archIndex: opts.archIndex })!];
    expect(f.arch.id).toBe("greathall");
    for (const view of views) {
      expect(view).toBeTruthy();
      expect(view.grid).toEqual(f.grid);
      expect(view.plan).toEqual(f.plan);
    }
  });
});
