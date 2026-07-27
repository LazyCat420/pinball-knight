import { describe, it, expect } from "vitest";
import { createSpacingGrid, type Metric } from "../engine/spacing-grid";
import { mulberry32 } from "../../../utils/rng";

/** The linear scan this replaces — the definition of correct. */
function bruteOccupied(pts: Array<[number, number]>, i: number, j: number, radius: number, metric: Metric): boolean {
  if (radius <= 0) return false;
  return pts.some(([pi, pj]) =>
    metric === "manhattan" ? Math.abs(pi - i) + Math.abs(pj - j) < radius : Math.hypot(pi - i, pj - j) < radius,
  );
}

describe("spacing grid matches the linear scan it replaces", () => {
  // This is the test that matters. The grid is an ACCELERATOR: if it ever
  // disagrees with the brute-force answer, generated floors change, and every
  // generation test that asserts against real seeds breaks in a way that looks
  // like a maze bug rather than an indexing bug.
  for (const metric of ["euclid", "manhattan"] as const) {
    for (const radius of [1, 2.5, 4, 7]) {
      it(`agrees on random point sets (${metric}, r=${radius})`, () => {
        const rng = mulberry32(0xbeef + Math.round(radius * 10));
        const grid = createSpacingGrid(radius, metric);
        const pts: Array<[number, number]> = [];

        for (let step = 0; step < 600; step++) {
          const i = Math.floor(rng() * 260);
          const j = Math.floor(rng() * 200);
          expect(grid.occupied(i, j), `query ${i},${j} after ${pts.length} points`).toBe(
            bruteOccupied(pts, i, j, radius, metric),
          );
          // Insert some of the queried points, so the set grows and queries
          // are tested against both empty and dense neighbourhoods.
          if (rng() < 0.35) {
            grid.add(i, j);
            pts.push([i, j]);
          }
        }
      });
    }
  }

  it("agrees when points cluster in one bucket", () => {
    // Dense clusters are where a bucket-grid bug hides: everything lands in one
    // bucket and the 3x3 neighbourhood scan has to still be right.
    const rng = mulberry32(7);
    const grid = createSpacingGrid(3);
    const pts: Array<[number, number]> = [];
    for (let n = 0; n < 200; n++) {
      const i = 50 + Math.floor(rng() * 4);
      const j = 50 + Math.floor(rng() * 4);
      expect(grid.occupied(i, j)).toBe(bruteOccupied(pts, i, j, 3, "euclid"));
      grid.add(i, j);
      pts.push([i, j]);
    }
  });

  it("handles points near the origin and across bucket boundaries", () => {
    // Negative and zero coordinates exercise the key offset; a naive key would
    // alias -1 onto a positive bucket.
    const grid = createSpacingGrid(2);
    grid.add(0, 0);
    expect(grid.occupied(1, 0)).toBe(true);
    expect(grid.occupied(-1, 0)).toBe(true);
    expect(grid.occupied(5, 5)).toBe(false);
  });
});

describe("spacing grid semantics", () => {
  it("treats radius 0 as no spacing rule at all", () => {
    // Several callers run a second 'fill anyway' pass with the rule disabled.
    const grid = createSpacingGrid(0);
    grid.add(5, 5);
    expect(grid.occupied(5, 5)).toBe(false);
  });

  it("is exclusive at exactly the radius, like the < it replaces", () => {
    // The old scans used `< r`, so a point at exactly r is NOT too close.
    // Flipping this to <= would quietly tighten every spacing rule in the game.
    const grid = createSpacingGrid(3, "manhattan");
    grid.add(0, 0);
    expect(grid.occupied(3, 0)).toBe(false);
    expect(grid.occupied(2, 0)).toBe(true);
  });

  it("counts what it stores", () => {
    const grid = createSpacingGrid(2);
    grid.add(1, 1);
    grid.add(9, 9);
    expect(grid.size).toBe(2);
  });
});
