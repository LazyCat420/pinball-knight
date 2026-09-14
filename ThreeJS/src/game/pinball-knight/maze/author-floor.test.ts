import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { authorMaze } from "./author-floor";
import * as tracks from "./track-floor";
import { buildFloorPlan } from "./floor-plan";
import { authorHeadlessPlan } from "../dev/headless-floor";
import { liveFloor } from "../testkit/live-floor";

afterEach(() => vi.restoreAllMocks());

// Reviewed after hallway approach clearance and final pattern validation passed geometry/population gates (2026-09-14). Include full
// geometry, surfaces, content, lamps and population RNG, not just piece counts.
// Intentional layout changes must refresh these only after the piece/floor gates.
const BASELINES = [
  [1, 1, false, false, "878bf5687f20c90e66f929f5d93424eb0175f931b871fdd8d6ad0da2b43038c7"],
  [3, 424242, true, false, "4968bf2af17b571d9b06d87700e58f94ab556136dba80a90cf2d8daab446d827"],
  [5, 12345, false, false, "73e5dbecfd2fc699d2b02def08d663a193437b2e8372fae50dbe7bd62b05c173"],
  [24, 1, true, false, "c243fab72d40346c7a069f05f8abc46960434a8f9681e7c2f8c691b888ab2ae1"],
  [6, 424242, true, true, "9ba54a871e6a300f33d3425406236d43e05b1232929ecd7fbf9c5ecdfc190b81"],
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
