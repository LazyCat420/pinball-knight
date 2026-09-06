import { describe, it, expect } from "vitest";
import {
  createLaunchChuteRecipe,
  createFlipperReturnRecipe,
  placeRecipe,
} from "./recipes";
import { ReservationGrid } from "./reservations";

describe("Phase 6 — Gameplay Recipes & Atomic Composites", () => {
  it("creates a valid launch chute recipe with boosters and ports", () => {
    const chuteRecipe = createLaunchChuteRecipe(6);
    expect(chuteRecipe.relativeFootprint.length).toBe(6);
    expect(chuteRecipe.relativeBuffer.length).toBeGreaterThan(0);
    expect(chuteRecipe.parts.length).toBeGreaterThan(0);
    expect(chuteRecipe.relativePorts.length).toBe(1);
    expect(chuteRecipe.relativePorts[0].role).toBe("out");
  });

  it("places and reserves a flipper-return recipe transactionally", () => {
    const grid = new ReservationGrid(30, 30);
    const flipperRecipe = createFlipperReturnRecipe();

    const result = placeRecipe(flipperRecipe, { i: 10, j: 10 }, grid, "flipper-return-1");
    expect(result.ok).toBe(true);
    expect(result.parts.length).toBe(2);
    expect(result.parts[0].kind).toBe("flipper");
    expect(result.parts[1].kind).toBe("booster");

    // Invariant: Footprint and buffer must be occupied
    expect(grid.isFootprintOccupied(10, 10)).toBe(true);
    expect(grid.isFootprintOccupied(10, 12)).toBe(true);
    expect(grid.isBufferOccupied(9, 10)).toBe(true);
  });

  it("rejects recipe and places no parts if any tile in footprint is obstructed", () => {
    const grid = new ReservationGrid(30, 30);
    // Pre-occupy tile (10, 12) with an immutable obstacle
    grid.reserve({
      id: "wall-block",
      kind: "track",
      priority: 10,
      mutable: false,
      footprint: [{ i: 10, j: 12 }],
    });

    const flipperRecipe = createFlipperReturnRecipe();
    const result = placeRecipe(flipperRecipe, { i: 10, j: 10 }, grid, "flipper-return-blocked");

    // Entire recipe must be rejected
    expect(result.ok).toBe(false);
    expect(result.parts.length).toBe(0);

    // No partial claims left behind
    expect(grid.isFootprintOccupied(10, 10)).toBe(false);
  });
});
