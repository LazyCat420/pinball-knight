import { describe, expect, it } from "vitest";
import { authorMaze } from "./author-floor";
import { repairFloorDensity } from "./floor-density-repair";
import { checkDensity, measureDensity } from "./floor-density";
import type { LevelPlan, PinballPartSpot } from "./decorate";

const part = (i: number, extra: Partial<PinballPartSpot> = {}): PinballPartSpot =>
  ({ kind: "bumper", i, j: 0, dirI: 0, dirJ: 0, dir2I: 0, dir2J: 0, ...extra });

it("trims surplus ambient content while preserving structures, rooms, lamps and spawn anchors", () => {
  const protectedParts = [part(0, { spine: true }), part(1, { circuit: 0 }), part(2, { kind: "lamp" }), part(3, { chain: true }), part(4)];
  const plan = { parts: [...protectedParts, ...Array.from({ length: 20 }, (_, i) => part(i + 5))],
    rooms: [{ i0: 4, j0: 0, w: 1, h: 1, kind: "arena" }],
    spawns: [{ i: 4, j: 0 }, { i: 99, j: 0 }, ...Array.from({ length: 40 }, (_, i) => ({ i, j: 1 }))],
    props: [], items: [], torches: [] } as unknown as LevelPlan;
  const repaired = repairFloorDensity(plan, 1000, [{ i: 99, j: 0 }]);
  for (const p of protectedParts) expect(plan.parts).toContain(p);
  expect(plan.parts).toHaveLength(10);
  expect(plan.spawns).toHaveLength(28);
  expect(plan.spawns).toContainEqual({ i: 4, j: 0 });
  expect(plan.spawns).toContainEqual({ i: 99, j: 0 });
  expect(repaired.removedParts).toHaveLength(15);
  expect(repaired.removedSpawns).toHaveLength(14);
  expect(repairFloorDensity(plan, 1000)).toEqual({ removedParts: [], removedSpawns: [] });
});

describe("floors exposed by the corrected live density sweep", () => {
  for (const [level, runSeed, archIndex] of [[10, 18072, 1], [14, 19156, 1], [10, 27498, 2], [10, 24698, 3], [6, 33040, 4]]) {
    it(`L${level}/${runSeed} respects the unchanged legibility bounds`, () => {
      const f = authorMaze({ level, runSeed, archIndex });
      expect(checkDensity(measureDensity(f.plan, f.walkable))).toEqual([]);
      expect(f.densityRepair!.removedParts.length + f.densityRepair!.removedSpawns.length).toBeGreaterThan(0);
      for (const lamp of f.lampPuzzlePlan?.lamps ?? []) expect(f.plan.parts).toContain(lamp);
    });
  }
});
