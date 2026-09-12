import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { authorMaze } from "./author-floor";
import * as tracks from "./track-floor";
import { buildFloorPlan } from "./floor-plan";
import { authorHeadlessPlan } from "../dev/headless-floor";
import { liveFloor } from "../testkit/live-floor";

afterEach(() => vi.restoreAllMocks());

// Reviewed after integrating wall joins, clearance and shortcuts (2026-09-12). Include full
// geometry, surfaces, content, lamps and population RNG, not just piece counts.
// Intentional layout changes must refresh these only after the piece/floor gates.
const BASELINES = [
  [1, 1, false, false, "533da60ce55efb36292344f5c4b447497e4d7bb89223c9570b60038afd6acf79"],
  [3, 424242, true, false, "b61aef3fc52b46e1f3f1a55bf262758bc073d56ba06af2e5cca7cadc78cc2714"],
  [5, 12345, false, false, "1d4603a385fe54641b0bf3a3d81814e648b4f16133f0884175d653e5c640a095"],
  [24, 1, true, false, "ce3fcbdf200e8291a691def4fa1cef6d3f0870194f47fed09bb487788336ea20"],
  [6, 424242, true, true, "e556fc89f3c2f76673c779f0ff771ea1499b7309d8884287e6d370d916ac8561"],
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
