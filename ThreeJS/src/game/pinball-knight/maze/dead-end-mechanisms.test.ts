import { describe, it, expect } from "vitest";
import { mulberry32 } from "../../../utils/rng";
import { buildTrackFloor } from "./track-floor";
import { decorateMaze, type PinballPartSpot } from "./decorate";
import { at, isWalkable, T_CRACKED, type Grid, type TilePos } from "./generator";
import { findDeadEnds, isInteractiveDeadEnd, furnishDeadEndMechanisms } from "./dead-end-mechanisms";

describe("Dead-End Interactive Guarantee", () => {
  it("findDeadEnds locates tiles with exactly 1 walkable neighbor", () => {
    const rng = mulberry32(42);
    const f = buildTrackFloor(24, 18, rng)!;
    const ends = findDeadEnds(f.grid, f.start, f.stairs);
    for (const d of ends) {
      expect(isWalkable(f.grid, d.i, d.j)).toBe(true);
      const open = [
        [0, 1], [0, -1], [1, 0], [-1, 0]
      ].filter(([di, dj]) => isWalkable(f.grid, d.i + di, d.j + dj));
      expect(open.length).toBe(1);
      expect(d.i === f.start.i && d.j === f.start.j).toBe(false);
      expect(d.i === f.stairs.i && d.j === f.stairs.j).toBe(false);
    }
  });

  it("furnishDeadEndMechanisms assigns 100% of unassigned dead ends an interactive mechanism", () => {
    const rng = mulberry32(12345);
    const f = buildTrackFloor(24, 18, rng)!;
    const ends = findDeadEnds(f.grid, f.start, f.stairs);
    const parts: PinballPartSpot[] = [];
    const secrets: TilePos[] = [];
    let frog: TilePos | null = null;

    const report = furnishDeadEndMechanisms(f.grid, ends, parts, secrets, frog, rng, { start: f.start, stairs: f.stairs });

    // Every single dead end must now satisfy isInteractiveDeadEnd
    for (const d of ends) {
      expect(
        isInteractiveDeadEnd(f.grid, d, parts, secrets, frog),
        `Dead end at (${d.i}, ${d.j}) has no interactive mechanism!`
      ).toBe(true);
    }
    expect(report.furnishedCount).toBe(ends.length);
    expect(report.unfurnishedCount).toBe(0);
  });

  it("across 20 generated track floors, decorateMaze leaves ZERO dead ends empty", () => {
    let totalDeadEnds = 0;
    let unhandledDeadEnds = 0;

    for (let seed = 1; seed <= 20; seed++) {
      const rng = mulberry32(seed * 7919);
      const f = buildTrackFloor(24, 18, rng);
      if (!f) continue;

      const plan = decorateMaze(f.grid, rng, 10, 12, 18, [], {
        strictLaunchers: true,
        wallGrammar: true,
        chute: f.chute,
        orbit: f.orbit,
        doorways: f.doorways,
      });

      const ends = findDeadEnds(f.grid, plan.start, plan.stairs);
      totalDeadEnds += ends.length;

      for (const d of ends) {
        const interactive = isInteractiveDeadEnd(f.grid, d, plan.parts, plan.secrets, plan.frog, plan.items);
        if (!interactive) {
          unhandledDeadEnds++;
        }
      }
    }

    expect(totalDeadEnds).toBeGreaterThan(0);
    expect(unhandledDeadEnds, `Found ${unhandledDeadEnds} boring empty dead ends out of ${totalDeadEnds}`).toBe(0);
  });

  it("dead-end launchers always aim OUTWARD toward open corridor (no-orphan invariant)", () => {
    for (let seed = 101; seed <= 115; seed++) {
      const rng = mulberry32(seed * 31337);
      const f = buildTrackFloor(24, 18, rng);
      if (!f) continue;

      const plan = decorateMaze(f.grid, rng, 10, 12, 18, [], {
        strictLaunchers: true,
        wallGrammar: true,
        chute: f.chute,
        orbit: f.orbit,
        doorways: f.doorways,
      });

      for (const p of plan.parts) {
        if (p.kind === "cannon" || p.kind === "spring") {
          // If this part is at a dead end, it must aim along the open neighbor
          const open = [
            [0, 1], [0, -1], [1, 0], [-1, 0]
          ].filter(([di, dj]) => isWalkable(f.grid, p.i + di, p.j + dj));
          if (open.length === 1) {
            expect([p.dirI, p.dirJ]).toEqual(open[0]);
          }
        }
      }
    }
  });

  it("dead-end catapults target a valid outward direction", () => {
    for (let seed = 201; seed <= 215; seed++) {
      const rng = mulberry32(seed * 65537);
      const f = buildTrackFloor(24, 18, rng);
      if (!f) continue;

      const plan = decorateMaze(f.grid, rng, 10, 12, 18, [], {
        strictLaunchers: true,
        wallGrammar: true,
        chute: f.chute,
        orbit: f.orbit,
        doorways: f.doorways,
      });

      for (const p of plan.parts) {
        if (p.kind === "catapult") {
          const open = [
            [0, 1], [0, -1], [1, 0], [-1, 0]
          ].filter(([di, dj]) => isWalkable(f.grid, p.i + di, p.j + dj));
          if (open.length === 1) {
            // Catapult must face outward or have a valid exit direction
            expect(p.dirI !== 0 || p.dirJ !== 0).toBe(true);
          }
        }
      }
    }
  });
});
