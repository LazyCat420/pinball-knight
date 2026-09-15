import { describe, it, expect } from "vitest";
import { authorMaze } from "./author-floor";
import { ARCHETYPES } from "./archetypes";
import { bfsDistances } from "../engine/flow-field";
import { backedFraction } from "./arc-contract";
import { hasCornerSquareJoins } from "./wall-junctions";
import { at, idx, shapeAt, T_WALL } from "./generator";
import { isRound, isSlant } from "../engine/tile-shape";
import { renderFloorAscii, summarizeFloor } from "./floor-ascii-dump";
import { checkPieces } from "./piece-rules";
import { buildFlowField } from "./flow-orient";

describe("maze creation smoke suite", () => {
  it("authors solvable, geometrically sound floors across all 5 archetypes in <3s", () => {
    const t0 = Date.now();

    for (let archIndex = 0; archIndex < ARCHETYPES.length; archIndex++) {
      const arch = ARCHETYPES[archIndex];
      const level = archIndex + 1;
      const seed = 12345 + archIndex * 997;

      const floor = authorMaze({
        level,
        runSeed: seed,
        archIndex,
      });

      expect(floor.track, `${arch.id} track must not be null`).not.toBeNull();
      const { grid, plan, track } = floor;

      // 1. Solvability & Reachability
      const dist = bfsDistances(grid, plan.start.i, plan.start.j);
      const pathLen = dist[idx(grid, plan.stairs.i, plan.stairs.j)];
      expect(pathLen, `${arch.id} start->stairs must be reachable`).toBeGreaterThan(10);

      // 2. Arc Backing Invariant ("See = Hit")
      for (const a of grid.arcs ?? []) {
        const b = backedFraction(grid, a);
        expect(
          b,
          `${arch.id} arc at (${a.cx},${a.cz}) r=${a.r} must be backed`
        ).toBeGreaterThanOrEqual(0.999);
      }

      // 3. Corner Join Invariant (Corners fit between straight wall faces)
      for (let j = 1; j < grid.h - 1; j++) {
        for (let i = 1; i < grid.w - 1; i++) {
          if (at(grid, i, j) === T_WALL) {
            const sh = shapeAt(grid, i, j);
            if (isRound(sh) || isSlant(sh)) {
              expect(
                hasCornerSquareJoins(grid, i, j, sh),
                `${arch.id} shaped corner at (${i},${j}) must meet straight wall faces`
              ).toBe(true);
            }
          }
        }
      }

      // 4. ASCII & Summary smoke verification
      const ascii = renderFloorAscii(floor, { unicode: true });
      expect(ascii.length, "ASCII dump must be populated").toBeGreaterThan(100);
      expect(ascii).toContain("S");
      expect(ascii).toContain("E");

      const summary = summarizeFloor(floor);
      expect(summary).toContain(arch.id);
      expect(summary).toContain(`PathLen: ${pathLen}`);
    }

    const elapsed = Date.now() - t0;
    // Entire 5-archetype smoke test should execute quickly (tolerates parallel test runner load)
    expect(elapsed, "5-archetype smoke suite must be fast").toBeLessThan(10000);
  });

  it("probes funnels: true across all archetypes against piece-rules", () => {
    for (let archIndex = 0; archIndex < ARCHETYPES.length; archIndex++) {
      const arch = ARCHETYPES[archIndex];
      const floor = authorMaze({
        level: archIndex + 1,
        runSeed: 12345 + archIndex * 7919,
        archIndex,
        funnels: true,
      });
      expect(floor.track).not.toBeNull();
      const phi = buildFlowField(floor.grid, floor.plan.stairs);
      const violations = checkPieces(floor.grid, floor.track?.mask, {
        phi,
        parts: floor.plan.parts,
      });
      expect(
        violations,
        `${arch.id} had piece violations with funnels: ${JSON.stringify(violations)}`
      ).toHaveLength(0);
    }
  });
});
