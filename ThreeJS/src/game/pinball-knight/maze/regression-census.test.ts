import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  REPRESENTATIVE_MATRIX,
  captureFloorSnapshot,
  renderFloorSvg,
  type FloorSnapshot,
} from "./regression-census";

const FIXTURES_DIR = path.resolve(__dirname, "regression-fixtures");

describe("Phase 0 — Regression Census & Fixtures Baseline", () => {
  // Ensure fixtures directory exists
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }

  for (const item of REPRESENTATIVE_MATRIX) {
    const label = `L${item.level}s${item.seed}-${item.archetype}`;
    const jsonPath = path.join(FIXTURES_DIR, `${label}.json`);
    const svgPath = path.join(FIXTURES_DIR, `${label}.svg`);

    it(`captures deterministic floor snapshot for ${label}`, () => {
      const result = captureFloorSnapshot(item.level, item.seed);
      expect(result).not.toBeNull();
      if (!result) return;

      const { snapshot, grid } = result;

      // Invariants check
      expect(snapshot.gridDigest.w).toBeGreaterThan(10);
      expect(snapshot.gridDigest.h).toBeGreaterThan(10);
      expect(snapshot.gridDigest.floors).toBeGreaterThan(0);
      expect(snapshot.gridDigest.walls).toBeGreaterThan(0);
      expect(snapshot.gridDigest.stairs).toBe(1);
      expect(snapshot.endpoints.routeDistance).toBeGreaterThan(0);

      const updateFixtures = process.env.UPDATE_FIXTURES === "1" || !fs.existsSync(jsonPath);

      if (updateFixtures) {
        fs.writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2), "utf8");
        const svg = renderFloorSvg(snapshot, grid);
        fs.writeFileSync(svgPath, svg, "utf8");
      } else {
        const recorded: FloorSnapshot = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

        // Bit-identical invariants
        expect(snapshot.gridDigest.tileHash).toBe(recorded.gridDigest.tileHash);
        expect(snapshot.gridDigest.floors).toBe(recorded.gridDigest.floors);
        expect(snapshot.gridDigest.walls).toBe(recorded.gridDigest.walls);
        expect(snapshot.endpoints.start).toEqual(recorded.endpoints.start);
        expect(snapshot.endpoints.stairs).toEqual(recorded.endpoints.stairs);
        expect(snapshot.endpoints.routeDistance).toBe(recorded.endpoints.routeDistance);
        expect(snapshot.clusteringMetrics.totalParts).toBe(recorded.clusteringMetrics.totalParts);
      }
    });
  }
});
