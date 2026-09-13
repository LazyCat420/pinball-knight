import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { authorMaze } from "./author-floor";
import * as tracks from "./track-floor";
import { buildFloorPlan } from "./floor-plan";
import { authorHeadlessPlan } from "../dev/headless-floor";
import { liveFloor } from "../testkit/live-floor";

afterEach(() => vi.restoreAllMocks());

// Reviewed after straight-terminal corner rules passed the piece/floor gates (2026-09-13). Include full
// geometry, surfaces, content, lamps and population RNG, not just piece counts.
// Intentional layout changes must refresh these only after the piece/floor gates.
const BASELINES = [
  [1, 1, false, false, "94c8672d2764bdf1b54c4f75343871bcbef3bfa2187ff136b7208845da6fb478"],
  [3, 424242, true, false, "e92522d4f943079d354fb5e34743c0a7d3b435779c223659d0f242a483aa74e3"],
  [5, 12345, false, false, "978e66d37d1d8918f194fcd4f4cfd384a3688bffec82167e5ff439db73d15537"],
  [24, 1, true, false, "1da295d878749b4ca5e6bf4906cabd719283becdebb1c0e6ea0c2ff00a629f02"],
  [6, 424242, true, true, "43a9e98505155f0704b66b2eafb0efc35ca018f8ba0601155e22cfe1f321fe50"],
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
