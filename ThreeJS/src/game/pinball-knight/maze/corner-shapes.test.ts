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
});
