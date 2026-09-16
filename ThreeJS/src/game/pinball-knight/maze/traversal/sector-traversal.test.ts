import { describe, it, expect } from "vitest";
import { generateMaze, thickenWalls, mulberry32, type Grid } from "../generator";
import { scaledLevelConfig, FLOOR_SCALE_TIERS, type FloorScaleTier } from "../../constants/level";
import { buildSectorGraph, isAntiSkipTile, DEFAULT_SECTOR_SIZE } from "../sectors/sector-graph";
import { validateTraversalLink, MECHANISM_TIERS } from "./traversal-tiers";
import { buildLandingPadRegistry, selectBestLandingPad } from "./landing-pad-registry";
import { computeTraversalRouteMetrics, type TraversalShortcutEdge } from "./route-graph-metrics";

describe("10x Sector World Architecture & Traversal Rework", () => {
  describe("Scale Ladder Sizing & Config", () => {
    it("provides the exact 4-tier scaling ladder", () => {
      expect(FLOOR_SCALE_TIERS.baseline.cellsW).toBe(96);
      expect(FLOOR_SCALE_TIERS.baseline.cellsH).toBe(72);
      expect(FLOOR_SCALE_TIERS.baseline.areaMultiplier).toBe(1.0);

      expect(FLOOR_SCALE_TIERS["phase1_1.9x"].cellsW).toBe(132);
      expect(FLOOR_SCALE_TIERS["phase1_1.9x"].cellsH).toBe(100);
      expect(FLOOR_SCALE_TIERS["phase1_1.9x"].areaMultiplier).toBeCloseTo(1.9, 1);

      expect(FLOOR_SCALE_TIERS["phase2_4.0x"].cellsW).toBe(192);
      expect(FLOOR_SCALE_TIERS["phase2_4.0x"].cellsH).toBe(144);
      expect(FLOOR_SCALE_TIERS["phase2_4.0x"].areaMultiplier).toBe(4.0);

      expect(FLOOR_SCALE_TIERS.final_10x.cellsW).toBe(304);
      expect(FLOOR_SCALE_TIERS.final_10x.cellsH).toBe(228);
      expect(FLOOR_SCALE_TIERS.final_10x.areaMultiplier).toBeCloseTo(10.0, 1);
    });

    it("scales level budgets by walkable area without breaking baseline", () => {
      const baseCfg = scaledLevelConfig(24, "baseline");
      expect(baseCfg.cellsW).toBe(96);
      expect(baseCfg.cellsH).toBe(72);
      expect(baseCfg.zombies).toBe(135); // capped at baseline draw budget
      expect(baseCfg.torches).toBe(80);

      const finalCfg = scaledLevelConfig(24, "final_10x");
      expect(finalCfg.cellsW).toBe(304);
      expect(finalCfg.cellsH).toBe(228);
      expect(finalCfg.floorTiles).toBeGreaterThan(150_000);
      expect(finalCfg.zombies).toBeGreaterThan(baseCfg.zombies);
      expect(finalCfg.torches).toBeGreaterThan(baseCfg.torches);
    });
  });

  describe("Sector Graph & Role Allocation", () => {
    function testGrid(w: number, h: number): Grid {
      return {
        w,
        h,
        t: new Uint8Array(w * h).fill(1),
        shapes: new Uint8Array(w * h),
      };
    }

    it("partitions large grid into structured sectors with entry and boss arena", () => {
      // 10x grid: ~609 x 457 tiles
      const g = testGrid(609, 457);
      const start = { i: 10, j: 10 };
      const stairs = { i: 590, j: 440 };
      const graph = buildSectorGraph(g, { start, stairs, sectorSize: 32 });

      expect(graph.cols).toBe(Math.ceil(609 / 32)); // 20
      expect(graph.rows).toBe(Math.ceil(457 / 32)); // 15
      expect(graph.sectors.length).toBe(graph.cols * graph.rows); // 300

      // Entry sector
      const entrySector = graph.sectors[graph.entrySectorId];
      expect(entrySector.role).toBe("entry_district");

      // Boss arena sector
      const bossSector = graph.sectors[graph.bossArenaSectorId];
      expect(bossSector.role).toBe("boss_arena");

      // Boss antechamber sector
      const antechamberSector = graph.sectors[graph.bossAntechamberSectorId];
      expect(antechamberSector.role).toBe("boss_antechamber");

      // Boss must be topologically distant (> 10 sector hops on 10x map)
      expect(graph.hopDistances[bossSector.id]).toBeGreaterThanOrEqual(10);
    });

    it("correctly identifies anti-skip exclusion zones", () => {
      const g = testGrid(609, 457);
      const start = { i: 10, j: 10 };
      const stairs = { i: 590, j: 440 };
      const graph = buildSectorGraph(g, { start, stairs, sectorSize: 32 });

      // Tiles inside boss arena sector
      const bossSector = graph.sectors[graph.bossArenaSectorId];
      const bossTileI = Math.floor((bossSector.bounds.minI + bossSector.bounds.maxI) / 2);
      const bossTileJ = Math.floor((bossSector.bounds.minJ + bossSector.bounds.maxJ) / 2);
      expect(isAntiSkipTile(graph, bossTileI, bossTileJ, stairs)).toBe(true);

      // Tile within 20 tiles of stairs
      expect(isAntiSkipTile(graph, stairs.i - 10, stairs.j - 5, stairs)).toBe(true);

      // Entry district tile is NOT in boss anti-skip zone
      expect(isAntiSkipTile(graph, start.i, start.j, stairs)).toBe(false);
    });
  });

  describe("Mechanism Reach Tiers & Anti-Skip Validation", () => {
    it("validates catapult reaches and rejects out-of-tier launches", () => {
      const g: Grid = { w: 300, h: 300, t: new Uint8Array(90000).fill(1), shapes: new Uint8Array(90000) };
      const start = { i: 10, j: 10 };
      const stairs = { i: 280, j: 280 };
      const graph = buildSectorGraph(g, { start, stairs, sectorSize: 32 });

      const from = { i: 20, j: 20 };
      const fromSectorId = graph.entrySectorId;

      // 1. Catapult too short (< 12 tiles)
      const tooShort = { i: 24, j: 24 }; // dist ~ 5.6
      const r1 = validateTraversalLink("catapult", from, tooShort, fromSectorId, fromSectorId, graph, stairs);
      expect(r1.valid).toBe(false);
      expect(r1.reason).toContain("minDistance");

      // 2. Catapult valid middle-distance launch (18 tiles within allowed sector hop)
      const validTarget = { i: 35, j: 30 }; // dist ~ 18.0
      const targetSector = graph.sectors.find((s) => s.bounds.minI <= validTarget.i && s.bounds.maxI >= validTarget.i && s.bounds.minJ <= validTarget.j && s.bounds.maxJ >= validTarget.j)!;
      const r2 = validateTraversalLink("catapult", from, validTarget, fromSectorId, targetSector.id, graph, stairs);
      expect(r2.valid).toBe(true);

      // 3. Catapult attempting to land directly near stairs / boss
      const nearBossFrom = { i: stairs.i - 18, j: stairs.j };
      const nearBossTarget = { i: stairs.i - 4, j: stairs.j }; // dist = 14 (within tier reach)
      const r3 = validateTraversalLink("catapult", nearBossFrom, nearBossTarget, graph.bossArenaSectorId, graph.bossArenaSectorId, graph, stairs);
      expect(r3.valid).toBe(false);
      expect(r3.reason).toContain("Anti-Skip");

      // 4. Seesaw attempting to jump across sector boundaries
      const r4 = validateTraversalLink("seesaw", from, validTarget, fromSectorId, targetSector.id, graph, stairs);
      expect(r4.valid).toBe(false); // seesaw is intra-sector only
    });
  });

  describe("Landing Pad Registry", () => {
    it("registers safe landing pads avoiding walls and hazards", () => {
      // Build a small test maze
      const rng = mulberry32(101);
      const g = thickenWalls(generateMaze(16, 12, rng, 0.2, 0.65));
      const start = { i: 2, j: 2 };
      const stairs = { i: g.w - 3, j: g.h - 3 };
      const graph = buildSectorGraph(g, { start, stairs, sectorSize: 16 });

      const registry = buildLandingPadRegistry(g, graph, { stairs });
      expect(registry.pads.length).toBeGreaterThan(0);

      // Every registered pad must be walkable and outside anti-skip zones
      for (const pad of registry.pads) {
        expect(g.t[pad.tile.j * g.w + pad.tile.i]).toBe(1); // walkable
        expect(isAntiSkipTile(graph, pad.tile.i, pad.tile.j, stairs)).toBe(false);
        expect(pad.clearance).toBeGreaterThanOrEqual(1.0);
        expect(pad.openNeighbors).toBeGreaterThanOrEqual(2);
      }

      // Select best landing pad for catapult
      const pad = selectBestLandingPad("catapult", start, graph, registry, { stairs, preferForwardSector: true });
      if (pad) {
        expect(pad.tile.i).toBeGreaterThan(0);
        expect(pad.tile.j).toBeGreaterThan(0);
        expect(isAntiSkipTile(graph, pad.tile.i, pad.tile.j, stairs)).toBe(false);
      }
    });
  });

  describe("Dual-Path Traversal-Aware Route Metrics", () => {
    it("computes walking distance and evaluates shortcut impact", () => {
      const rng = mulberry32(777);
      const g = thickenWalls(generateMaze(20, 16, rng, 0.2, 0.65));
      const start = { i: 2, j: 2 };
      const stairs = { i: g.w - 3, j: g.h - 3 };
      const graph = buildSectorGraph(g, { start, stairs, sectorSize: 16 });

      // Measure baseline without shortcuts
      const baseline = computeTraversalRouteMetrics(g, start, stairs, [], graph);
      expect(baseline.walkingDistance).toBeGreaterThan(40);
      expect(baseline.traversalDistance).toBe(baseline.walkingDistance);
      expect(baseline.distanceRatio).toBe(1.0);
      expect(baseline.isValid).toBe(true);

      // Add a legitimate local shortcut (saves ~6 tiles)
      const validShortcut: TraversalShortcutEdge = {
        id: "catapult_local",
        kind: "catapult",
        from: { i: 4, j: 4 },
        to: { i: 12, j: 10 },
        costTiles: 5, // 0.5s equivalent
      };
      const reportWithShortcut = computeTraversalRouteMetrics(g, start, stairs, [validShortcut], graph);
      expect(reportWithShortcut.isValid).toBe(true);
      expect(reportWithShortcut.distanceRatio).toBeGreaterThan(0.50);

      // Add an illegal cheat shortcut that lands directly on stairs
      const cheatShortcut: TraversalShortcutEdge = {
        id: "cheat_catapult",
        kind: "catapult",
        from: { i: 2, j: 2 },
        to: { i: stairs.i, j: stairs.j },
        costTiles: 1,
      };
      const cheatReport = computeTraversalRouteMetrics(g, start, stairs, [cheatShortcut], graph);
      expect(cheatReport.isValid).toBe(false);
      expect(cheatReport.antiSkipViolations.length).toBeGreaterThan(0);
    });
  });
});
