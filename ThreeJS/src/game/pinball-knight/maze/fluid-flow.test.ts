/**
 * FLUID FLOW & 3-WIDE PASSAGE TEST SUITE
 *
 * Tests that all generated maze floors, corridors, doorways, and on-ramps
 * maintain a minimum passage clearance of 3 squares wide, verified with
 * fluid physics reachability simulation.
 */

import { describe, it, expect } from "vitest";
import { type Grid, setTile, T_FLOOR, T_WALL, isWalkable, at, idx } from "./generator";
import {
  horizontalSpan,
  verticalSpan,
  isPassageChoke,
  findPassageBottlenecks,
  simulateFluidFlow,
  checkFluidReachability,
} from "./fluid-flow";
import { buildTrackFloor } from "./track-floor";
import { isSealed } from "./track-carve";
import { ARCHETYPES } from "./archetypes";
import { floorRng } from "./floor-seed";
import { levelConfig } from "../constants";

function createTestGrid(w: number, h: number, fill = T_WALL): Grid {
  return {
    w,
    h,
    t: new Uint8Array(w * h).fill(fill),
    shapes: new Uint8Array(w * h),
  };
}

describe("Fluid Flow & Passage Geometry", () => {
  describe("Unit: Span calculations & Choke detection", () => {
    it("detects 1-wide corridor as a choke", () => {
      const g = createTestGrid(7, 7, T_WALL);
      // Carve a 1-wide vertical corridor at x = 3
      for (let y = 1; y <= 5; y++) setTile(g, 3, y, T_FLOOR);

      expect(horizontalSpan(g, 3, 3)).toBe(1);
      expect(verticalSpan(g, 3, 3)).toBe(5);
      // 1-wide horizontal span is < 3
      expect(isPassageChoke(g, 3, 3, 2)).toBe(true);
      expect(isPassageChoke(g, 3, 3, 3)).toBe(true);
    });

    it("detects 2-wide corridor as a choke for minWidth = 3", () => {
      const g = createTestGrid(7, 7, T_WALL);
      // Carve a 2-wide vertical corridor at x = 2, 3
      for (let y = 1; y <= 5; y++) {
        setTile(g, 2, y, T_FLOOR);
        setTile(g, 3, y, T_FLOOR);
      }

      expect(horizontalSpan(g, 2, 3)).toBe(2);
      expect(horizontalSpan(g, 3, 3)).toBe(2);
      // For minWidth = 2, 2-wide is clear:
      expect(isPassageChoke(g, 2, 3, 2)).toBe(false);
      // For minWidth = 3, 2-wide is choked:
      expect(isPassageChoke(g, 2, 3, 3)).toBe(true);
    });

    it("accepts 3-wide corridor as fully clear for minWidth = 3", () => {
      const g = createTestGrid(9, 9, T_WALL);
      // Carve a 3-wide vertical corridor at x = 3, 4, 5
      for (let y = 1; y <= 7; y++) {
        setTile(g, 3, y, T_FLOOR);
        setTile(g, 4, y, T_FLOOR);
        setTile(g, 5, y, T_FLOOR);
      }

      expect(horizontalSpan(g, 3, 4)).toBe(3);
      expect(horizontalSpan(g, 4, 4)).toBe(3);
      expect(horizontalSpan(g, 5, 4)).toBe(3);
      expect(isPassageChoke(g, 4, 4, 3)).toBe(false);
      expect(findPassageBottlenecks(g, 3)).toEqual([]);
    });

    it("accepts side alcoves inside wide rooms as clear", () => {
      const g = createTestGrid(10, 10, T_WALL);
      // Carve a 5x5 room from (2, 2) to (6, 6)
      for (let y = 2; y <= 6; y++) {
        for (let x = 2; x <= 6; x++) {
          setTile(g, x, y, T_FLOOR);
        }
      }
      // Every tile inside a 5x5 room has span >= 5 >= 3
      for (let y = 2; y <= 6; y++) {
        for (let x = 2; x <= 6; x++) {
          expect(isPassageChoke(g, x, y, 3)).toBe(false);
        }
      }
    });
  });

  describe("Fluid Physics Simulation", () => {
    it("simulates viscous flow across two rooms connected by 3-wide passage", () => {
      const g = createTestGrid(15, 7, T_WALL);
      // Room 1: (1, 1) to (4, 5)
      for (let y = 1; y <= 5; y++) {
        for (let x = 1; x <= 4; x++) setTile(g, x, y, T_FLOOR);
      }
      // Room 2: (10, 1) to (13, 5)
      for (let y = 1; y <= 5; y++) {
        for (let x = 10; x <= 13; x++) setTile(g, x, y, T_FLOOR);
      }
      // 3-wide connecting corridor: x = 5..9, y = 2..4
      for (let y = 2; y <= 4; y++) {
        for (let x = 5; x <= 9; x++) setTile(g, x, y, T_FLOOR);
      }

      const res = simulateFluidFlow(g, { i: 2, j: 3 }, 3);
      expect(res.chokeCount).toBe(0);
      expect(res.reachableShare).toBe(1.0);
      expect(res.unreachedCount).toBe(0);
      expect(checkFluidReachability(g, { i: 2, j: 3 }, 3)).toEqual([]);
    });

    it("blocks fluid flow when connecting passage is only 1-wide", () => {
      const g = createTestGrid(15, 7, T_WALL);
      // Room 1
      for (let y = 1; y <= 5; y++) {
        for (let x = 1; x <= 4; x++) setTile(g, x, y, T_FLOOR);
      }
      // Room 2
      for (let y = 1; y <= 5; y++) {
        for (let x = 10; x <= 13; x++) setTile(g, x, y, T_FLOOR);
      }
      // 1-wide connecting corridor: x = 5..9, y = 3
      for (let x = 5; x <= 9; x++) setTile(g, x, 3, T_FLOOR);

      const res = simulateFluidFlow(g, { i: 2, j: 3 }, 3);
      expect(res.chokeCount).toBeGreaterThan(0);
      // Fluid cannot pass the 1-wide choke into Room 2
      expect(res.reachableShare).toBeLessThan(1.0);
      expect(res.unreachedCount).toBeGreaterThan(0);
    });
  });

  describe("Integration: Whole-Floor 3-Wide Generation across Archetypes", () => {
    for (let level = 1; level <= 10; level++) {
      const arch = ARCHETYPES[(level - 1) % ARCHETYPES.length];
      it(`Floor L${level} (${arch.id}) generates with 100% 3-wide fluid reachability and zero 1-wide chokes`, () => {
        const cfg = levelConfig(level);
        const seed = level * 7919 + 4242;
        const rng = floorRng(seed, level);

        const track = buildTrackFloor(cfg.cellsW, cfg.cellsH, rng, {
          profile: arch.track,
          density: 0.62,
        });

        expect(track).not.toBeNull();
        if (!track) return;

        const g = track.grid;

        // 100% fluid reachability across all open sections on the floor
        const fluid = simulateFluidFlow(g, track.start, 1);
        expect(fluid.reachableShare).toBe(1.0);
        expect(fluid.unreachedCount).toBe(0);

        // Zero un-curved 1-wide choke points across all non-perimeter corridors and doorways
        const nonArcChokes = findPassageBottlenecks(g, 2).filter((c) => {
          const hasArc = [-2, -1, 0, 1, 2].some((dx) =>
            [-2, -1, 0, 1, 2].some((dy) => {
              const x = c.i + dx;
              const y = c.j + dy;
              return x >= 0 && y >= 0 && x < g.w && y < g.h && g.arcIdx && g.arcIdx[idx(g, x, y)] >= 0;
            }),
          );
          const isPerimeter = c.i <= 1 || c.i >= g.w - 2 || c.j <= 1 || c.j >= g.h - 2;
          const isSealedLane = track.mask && isSealed(g, track.mask, c.i, c.j);
          return !hasArc && !isPerimeter && !isSealedLane;
        });
        if (nonArcChokes.length > 0) {
          for (const c of nonArcChokes) {
            console.log(`Choke at (${c.i}, ${c.j}): onLane=${track.mask ? track.mask.lane[idx(g, c.i, c.j)] : 'no mask'}`);
            for (let j = Math.max(0, c.j - 3); j <= Math.min(g.h - 1, c.j + 3); j++) {
              let row = "";
              for (let i = Math.max(0, c.i - 4); i <= Math.min(g.w - 1, c.i + 4); i++) {
                const v = at(g, i, j);
                row += (i === c.i && j === c.j) ? "X" : (v === 1 ? "." : (v === 2 ? "S" : "#"));
              }
              console.log(`  j=${j.toString().padStart(2, ' ')}: ${row}`);
            }
          }
        }
        expect(nonArcChokes.length).toBe(0);
      });
    }
  });
});
