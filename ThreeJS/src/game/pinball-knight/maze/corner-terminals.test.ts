import { describe, expect, it } from "vitest";
import { assignCornerShapes } from "./corner-shapes";
import { enforceWallJoins, findBrokenWallJoins } from "./wall-junctions";
import { type Grid, T_FLOOR, T_WALL, T_CRACKED, setTile, setShape, shapeAt } from "./generator";
import { SHAPE_FULL, SHAPE_ARC, SHAPE_ROUND_NE, SHAPE_ROUND_NW, SHAPE_ROUND_SE, SHAPE_ROUND_SW } from "../engine/tile-shape";

function convex(dx: number, dz: number): Grid {
  const g: Grid = { w: 13, h: 13, t: new Uint8Array(169).fill(T_FLOOR), shapes: new Uint8Array(169) };
  for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) setTile(g, 6 - a * dx, 6 - b * dz, T_WALL);
  return g;
}

describe("corners connect to exposed straight wall middles", () => {
  for (const [dx, dz, round] of [[1, -1, SHAPE_ROUND_NE], [-1, -1, SHAPE_ROUND_NW], [1, 1, SHAPE_ROUND_SE], [-1, 1, SHAPE_ROUND_SW]]) {
    it(`keeps the flush outward corner ${dx},${dz}`, () => {
      const g = convex(dx, dz);
      assignCornerShapes(g, { grammar: false });
      expect(shapeAt(g, 6, 6)).toBe(round);
    });

    it(`keeps a flush bevel with straight terminals ${dx},${dz}`, () => {
      const g = convex(dx, dz);
      setShape(g, 6, 6, round - 4);
      expect(enforceWallJoins(g)).toBe(0);
      expect(shapeAt(g, 6, 6)).toBe(round - 4);
    });

    for (const neighbour of [SHAPE_ROUND_NE, SHAPE_ROUND_NW, SHAPE_ROUND_SE, SHAPE_ROUND_SW, SHAPE_ARC]) {
      it(`rejects shaped terminal ${neighbour} at ${dx},${dz}`, () => {
        const g = convex(dx, dz);
        setShape(g, 6, 6, round);
        setShape(g, 6 - dx, 6, neighbour);
        enforceWallJoins(g);
        expect(shapeAt(g, 6, 6)).toBe(SHAPE_FULL);
      });
    }

    it(`rejects a breakable terminal ${dx},${dz}`, () => {
      const g = convex(dx, dz);
      setShape(g, 6, 6, round);
      setTile(g, 6 - dx, 6, T_CRACKED);
      enforceWallJoins(g);
      expect(shapeAt(g, 6, 6)).toBe(SHAPE_FULL);
    });

    it(`rejects a corner whose backing face is buried ${dx},${dz}`, () => {
      const g = convex(dx, dz);
      setTile(g, 6 - dx, 6 + dz, T_WALL);
      assignCornerShapes(g, { grammar: false });
      expect(shapeAt(g, 6, 6)).toBe(SHAPE_FULL);
    });

    it(`does not put an outward disc behind an inward room corner ${dx},${dz}`, () => {
      const g: Grid = { w: 13, h: 13, t: new Uint8Array(169), shapes: new Uint8Array(169) };
      for (let a = 1; a <= 4; a++) for (let b = 1; b <= 4; b++) setTile(g, 6 + a * dx, 6 + b * dz, T_FLOOR);
      assignCornerShapes(g, { grammar: false });
      expect(shapeAt(g, 6, 6)).toBe(SHAPE_FULL);
    });

    it(`revalidates a corner after a later pass opens its backing ${dx},${dz}`, () => {
      const g = convex(dx, dz);
      setShape(g, 6, 6, round);
      setTile(g, 6 - dx, 6, T_FLOOR);
      const tiles = g.t.slice();
      enforceWallJoins(g);
      expect(shapeAt(g, 6, 6)).toBe(SHAPE_FULL);
      expect(g.t).toEqual(tiles);
    });
  }

  it("rejects two curved pieces touching even when their tangents match", () => {
    const g = convex(1, -1);
    g.arcs = [
      { cx: 4, cz: 6, r: 2, a0: -Math.PI / 2, span: Math.PI / 4 },
      { cx: 4, cz: 6, r: 2, a0: -Math.PI / 4, span: Math.PI / 4 },
    ];
    expect(findBrokenWallJoins(g).some(j => j.feature === 0 && j.end === 1)).toBe(true);
    expect(findBrokenWallJoins(g).some(j => j.feature === 1 && j.end === 0)).toBe(true);
  });
});
