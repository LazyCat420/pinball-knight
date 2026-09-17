import { describe, expect, it } from "vitest";
import { resolveFloorSpec, calculateProgressiveCells } from "./floor-spec";
import { authorFloor } from "../../spawn/floor-authoring";
import { state } from "../../state";
import { isWalkable, type Grid } from "../generator";
import { bfsDistances } from "../../engine/flow-field";
import { FLOOR_SCALE_TIERS } from "../../constants/level";

describe("Canonical FloorSpec & Progressive Scaling (P0 Integration)", () => {
  it("progressively scales cellsW and cellsH monotonically across depths", () => {
    let prevW = 0;
    let prevH = 0;
    for (let l = 1; l <= 35; l++) {
      const res = calculateProgressiveCells(l, undefined, undefined, true);
      expect(res.cellsW).toBeGreaterThanOrEqual(prevW);
      expect(res.cellsH).toBeGreaterThanOrEqual(prevH);
      prevW = res.cellsW;
      prevH = res.cellsH;
    }
  });

  it("produces exact baseline dimensions on shallow floors and when tier is baseline", () => {
    const l1 = calculateProgressiveCells(1, "baseline");
    expect(l1.cellsW).toBe(37);
    expect(l1.cellsH).toBe(26);

    const l20 = calculateProgressiveCells(20, "baseline");
    expect(l20.cellsW).toBe(90);
    expect(l20.cellsH).toBe(64);

    const l24 = calculateProgressiveCells(24, "baseline");
    expect(l24.cellsW).toBe(96);
    expect(l24.cellsH).toBe(72);
  });

  it("reaches intermediate phase1 (132x100) and phase2 (192x144) targets", () => {
    const p1 = resolveFloorSpec({ level: 20, tier: "phase1" });
    expect(p1.cellsW).toBe(132);
    expect(p1.cellsH).toBe(100);
    expect(p1.gridW).toBe(265);
    expect(p1.gridH).toBe(201);

    const p2 = resolveFloorSpec({ level: 25, tier: "phase2" });
    expect(p2.cellsW).toBe(192);
    expect(p2.cellsH).toBe(144);
    expect(p2.gridW).toBe(385);
    expect(p2.gridH).toBe(289);
  });

  it("reaches final 10x target (304x228 macro cells / 609x457 tiles)", () => {
    const finalSpec = resolveFloorSpec({ level: 34, progressive: true });
    expect(finalSpec.cellsW).toBe(304);
    expect(finalSpec.cellsH).toBe(228);
    expect(finalSpec.gridW).toBe(609);
    expect(finalSpec.gridH).toBe(457);
    expect(finalSpec.predictedWalkable).toBeGreaterThan(25000);
  });

  it("authorFloor shipping pipeline builds materially larger grids on deeper levels", () => {
    state.runSeed = 424242;
    state.floorScaleOverrideTier = undefined;
    state.floorScaleOverrideMultiplier = undefined;

    // Level 1: roomy onboarding room (129x97 tiles)
    const f1 = authorFloor(1);
    expect(f1.grid.w).toBe(129);
    expect(f1.grid.h).toBe(97);

    // Level 10: expands into vast multi-sector labyrinth (385x289 tiles, >12,000 walkable)
    const f10 = authorFloor(10);
    expect(f10.grid.w).toBe(385);
    expect(f10.grid.h).toBe(289);
    expect(f10.walkable).toBeGreaterThan(10000);

    // Level 25: expands into 10x ceiling (609x457 tiles)
    const f25 = authorFloor(25);
    expect(f25.grid.w).toBe(609);
    expect(f25.grid.h).toBe(457);
    expect(f25.walkable).toBeGreaterThan(f10.walkable * 1.5);

    // Start and stairs are mutually connected in the shipping floor
    const walkDist = bfsDistances(f25.grid, f25.plan.start.i, f25.plan.start.j);
    const stairsIdx = f25.plan.stairs.j * f25.grid.w + f25.plan.stairs.i;
    expect(walkDist[stairsIdx]).toBeGreaterThan(0);
  });

  it("respects dev scale overrides in authorFloor", () => {
    state.runSeed = 777;
    const f10x = authorFloor(5, { tier: "final_10x" });
    expect(f10x.grid.w).toBe(609);
    expect(f10x.grid.h).toBe(457);
    expect(f10x.walkable).toBeGreaterThan(25000);

    // Sector graph, landing pads, and route metrics are present on the authored floor
    expect(f10x.sectorGraph).toBeDefined();
    expect(f10x.landingPads).toBeDefined();
    expect(f10x.routeMetrics).toBeDefined();

    // Verify 0 landing pads violate anti-skip zone (distance <= 18 tiles from stairs)
    for (const pad of f10x.landingPads.pads) {
      const distToStairs = Math.hypot(pad.tile.i - f10x.plan.stairs.i, pad.tile.j - f10x.plan.stairs.j);
      expect(distToStairs).toBeGreaterThanOrEqual(18);
    }
  });

  it("is fully deterministic for identical seed and level", () => {
    state.runSeed = 99999;
    const run1 = authorFloor(12);
    const run2 = authorFloor(12);

    expect(run1.grid.w).toBe(run2.grid.w);
    expect(run1.grid.h).toBe(run2.grid.h);
    expect(run1.walkable).toBe(run2.walkable);
    expect(run1.plan.start).toEqual(run2.plan.start);
    expect(run1.plan.stairs).toEqual(run2.plan.stairs);
  });
});
