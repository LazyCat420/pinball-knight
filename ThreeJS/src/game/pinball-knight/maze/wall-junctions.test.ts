import { describe, expect, it } from "vitest";
import { arcContinuationTiles, arcPorts, findBrokenCornerJoins, enforceWallJoins, findBrokenWallJoins, hasSquareJoins } from "./wall-junctions";
import { T_FLOOR, T_WALL, idx, type Grid } from "./generator";
import { SHAPE_ARC, SHAPE_FULL, SHAPE_ROUND_NE } from "../engine/tile-shape";
import { authorMaze } from "./author-floor";

/** A quarter turn between a horizontal wall and a vertical wall, in grid units. */
function corner(turns = 0, concave = false): Grid {
  const g: Grid = { w: 12, h: 12, t: new Uint8Array(144).fill(T_FLOOR), shapes: new Uint8Array(144), arcIdx: new Int16Array(144).fill(-1), arcs: [] };
  const rotate = (x: number, z: number, n: number): [number, number] => {
    for (let k = 0; k < turns; k++) [x, z] = [n - z, x];
    return [x, z];
  };
  for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) {
    const solid = i >= 1 && i <= 5 && j >= 4 && j <= 9;
    const [x, z] = rotate(i, j, 11);
    g.t[idx(g, x, z)] = solid !== concave ? T_WALL : T_FLOOR;
  }
  const [cx, cz] = rotate(4, 6, 12);
  g.arcs!.push({ cx, cz, r: 2, a0: -Math.PI / 2 + turns * Math.PI / 2, span: Math.PI / 2, solidOut: concave });
  for (const [i, j] of [[4, 4], [5, 4], [5, 5]]) {
    const [x, z] = rotate(i, j, 11), k = idx(g, x, z);
    g.t[k] = T_WALL;
    g.shapes[k] = SHAPE_ARC;
    g.arcIdx![k] = 0;
  }
  return g;
}

describe("wall face connections", () => {
  for (const turns of [0, 1, 2, 3]) for (const concave of [false, true]) {
    it(`keeps a flush ${concave ? "concave" : "convex"} corner in rotation ${turns}`, () => {
      const g = corner(turns, concave);
      expect(hasSquareJoins(g, g.arcs![0])).toBe(true);
      expect(arcContinuationTiles(g).size).toBe(2);
      expect(findBrokenWallJoins(g)).toEqual([]);
      expect(enforceWallJoins(g)).toBe(0);
      expect(g.arcs).toHaveLength(1);
    });
  }

  it("detects a backwards curve even when it still owns wall tiles", () => {
    const g = corner();
    g.arcs![0].a0 += Math.PI;
    expect(findBrokenWallJoins(g)).toHaveLength(2);
    const tiles = g.t.slice();
    expect(enforceWallJoins(g)).toBe(1);
    expect(g.t).toEqual(tiles);
    expect(g.arcs).toEqual([]);
    expect(g.shapes.every(s => s === SHAPE_FULL)).toBe(true);
    expect(g.arcIdx!.every(fi => fi === -1)).toBe(true);
  });

  it("rejects a trimmed end that no longer reaches the straight wall", () => {
    const g = corner();
    g.arcs![0].a0 += 0.1;
    g.arcs![0].span -= 0.1;
    expect(findBrokenWallJoins(g).map(x => x.end)).toEqual([0]);
  });

  it("rejects a nearby round which cuts away the intended connection", () => {
    const g = corner();
    g.shapes[idx(g, 3, 4)] = SHAPE_ROUND_NE;
    expect(findBrokenWallJoins(g).map(x => x.end)).toEqual([0]);
  });

  it("does not mistake stone on both sides for an exposed wall face", () => {
    const g = corner();
    g.t[idx(g, 3, 3)] = T_WALL;
    expect(findBrokenWallJoins(g).map(x => x.end)).toEqual([0]);
  });

  it("rejects direct curve chains and remaps a surviving straight-ended feature", () => {
    const g = corner();
    const f = g.arcs![0];
    const first = { ...f, cx: 50, span: Math.PI / 4 };
    const second = { ...first, a0: first.a0 + Math.PI / 4 };
    g.arcs = [first, f, second];
    for (const k of [idx(g, 4, 4), idx(g, 5, 4), idx(g, 5, 5)]) g.arcIdx![k] = 1;
    expect(enforceWallJoins(g)).toBe(2);
    expect(g.arcs).toEqual([f]);
    expect(g.arcIdx![idx(g, 4, 4)]).toBe(0);
    expect(g.arcIdx![idx(g, 5, 5)]).toBe(0);
    expect(findBrokenWallJoins(g)).toEqual([]);
  });

  it("rejects a shifted curve and a reversed solid side", () => {
    const shifted = corner();
    shifted.arcs![0].cx += 0.25;
    expect(findBrokenWallJoins(shifted)).toHaveLength(2);
    const reversed = corner();
    reversed.arcs![0].solidOut = true;
    expect(findBrokenWallJoins(reversed)).toHaveLength(2);
  });

  it("allows a closed island without inventing endpoints", () => {
    const g = corner();
    g.arcs![0].span = Math.PI * 2;
    expect(arcPorts(g.arcs![0])).toEqual([]);
    expect(enforceWallJoins(g)).toBe(0);
  });
});

describe("finished maze connections", () => {
  it("keeps connected curves across depths and seeds after all content passes", () => {
    let curves = 0;
    for (const level of [1, 5, 8]) for (const runSeed of [777, 1234, 8675309]) {
      const { grid } = authorMaze({ level, runSeed });
      expect(findBrokenWallJoins(grid), `L${level}, seed ${runSeed}`).toEqual([]);
      expect(findBrokenCornerJoins(grid), `L${level}, seed ${runSeed}`).toEqual([]);
      curves += grid.arcs!.filter(f => f.span < Math.PI * 2 - 1e-5).length;
    }
    // Passing by deleting all the curved walls would not satisfy the request.
    expect(curves).toBeGreaterThan(30);
  });
});
