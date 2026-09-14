import { describe, expect, it } from "vitest";
import { assignCornerShapes } from "./corner-shapes";
import { type Grid, T_FLOOR, T_CRACKED, idx, setTile, shapeAt, setShape } from "./generator";
import { SHAPE_FULL, SHAPE_ARC } from "../engine/tile-shape";

function stone(): Grid {
  return { w: 11, h: 11, t: new Uint8Array(121), shapes: new Uint8Array(121) };
}

// Mirror the same pocket into each quadrant. (5,5) is the open crook;
// (5+di,5+dj) is the diagonal wall receiving its inward-facing corner.
function pocket(di: number, dj: number, wide: boolean): Grid {
  const g = stone();
  for (const [i, j] of [[5, 5], [5 - di, 5], [5, 5 - dj]]) setTile(g, i, j, T_FLOOR);
  if (wide) setTile(g, 5 - di, 5 - dj, T_FLOOR);
  return g;
}

describe("single-tile corner placement", () => {
  for (const [di, dj] of [[1, -1], [-1, -1], [1, 1], [-1, 1]]) {
    it(`keeps a narrow dogleg square (${di},${dj})`, () => {
      const g = pocket(di, dj, false);
      assignCornerShapes(g, { grammar: false });
      expect(shapeAt(g, 5 + di, 5 + dj)).toBe(SHAPE_FULL);
    });

    it(`keeps inward room-corner masonry square even at a complete pocket (${di},${dj})`, () => {
      const g = pocket(di, dj, true);
      assignCornerShapes(g, { grammar: false });
      const shape = shapeAt(g, 5 + di, 5 + dj);
      expect(shape).toBe(SHAPE_FULL);
    });

    it(`rejects breakable backing (${di},${dj})`, () => {
      const g = pocket(di, dj, true);
      setTile(g, 5 + 2 * di, 5 + dj, T_CRACKED);
      assignCornerShapes(g, { grammar: false });
      expect(shapeAt(g, 5 + di, 5 + dj)).toBe(SHAPE_FULL);
    });
  }

  it("never reshapes the perimeter or existing arc slices", () => {
    const g = stone();
    for (let j = 1; j < 10; j++) for (let i = 1; i < 10; i++) setTile(g, i, j, T_FLOOR);
    // An interior wall tip would qualify without the ownership check.
    for (const [i, j] of [[5, 5], [5, 6], [4, 5], [4, 6]]) setTile(g, i, j, 0);
    setShape(g, 5, 5, SHAPE_ARC);
    assignCornerShapes(g);
    expect(shapeAt(g, 5, 5)).toBe(SHAPE_ARC);
    for (let k = 0; k < 11; k++) {
      for (const [i, j] of [[0, k], [10, k], [k, 0], [k, 10]]) expect(g.shapes[idx(g, i, j)]).toBe(SHAPE_FULL);
    }
  });

  it("does not change floor topology", () => {
    const g = pocket(1, -1, true);
    const before = g.t.slice();
    assignCornerShapes(g);
    expect(g.t).toEqual(before);
  });

  it("builds round corner wall shells with watertight top caps (no hollow tube holes)", async () => {
    const { roundShellGeometry } = await import("./build");
    const { SHAPE_ROUND_NE, SHAPE_ROUND_NW, SHAPE_ROUND_SE, SHAPE_ROUND_SW } = await import("../engine/tile-shape");
    for (const shape of [SHAPE_ROUND_NE, SHAPE_ROUND_NW, SHAPE_ROUND_SE, SHAPE_ROUND_SW]) {
      const geo = roundShellGeometry(shape, 1.2, 8);
      expect(geo.groups.length).toBe(2);
      expect(geo.groups[0].materialIndex).toBe(1); // caps -> capMat
      expect(geo.groups[1].materialIndex).toBe(0); // sides -> wallFaceMat

      const pos = geo.attributes.position;
      const nor = geo.attributes.normal;
      expect(pos.count).toBeGreaterThan(0);

      // Verify at least one top cap vertex exists at y = 1.2 with normal (0, 1, 0)
      let foundTopCap = false;
      for (let v = 0; v < geo.groups[0].count; v++) {
        if (Math.abs(pos.getY(v) - 1.2) < 1e-4 && Math.abs(nor.getY(v) - 1.0) < 1e-4) {
          foundTopCap = true;
          break;
        }
      }
      expect(foundTopCap, `shape ${shape} must have top cap vertices at wall height`).toBe(true);
    }
  });
});

