import { describe, expect, it } from "vitest";
import { type Grid, T_FLOOR, T_STAIRS, T_WALL, idx, isWalkable, setTile } from "./generator";
import { type TrackMask } from "./track-carve";
import { removeWallStubs } from "./track-socket";
import { resealChute, type LaunchChute } from "./track-launch";
import { SHAPE_ARC } from "../engine/tile-shape";
import { bfsDistances } from "../engine/flow-field";
import { checkPieces } from "./piece-rules";

function grid(): Grid {
  return { w: 9, h: 9, t: new Uint8Array(81), shapes: new Uint8Array(81), arcIdx: new Int16Array(81).fill(-1) };
}

describe("release geometry regressions", () => {
  it("cleans a former arc's wall stub but preserves a real arc rim", () => {
    for (const arc of [false, true]) {
      const g = grid();
      for (const [i, j] of [[3, 4], [5, 4], [4, 3]]) setTile(g, i, j, T_FLOOR);
      g.arcIdx![idx(g, 4, 4)] = 9;
      if (arc) g.shapes[idx(g, 4, 4)] = SHAPE_ARC;
      removeWallStubs(g, null);
      expect(g.t[idx(g, 4, 4)]).toBe(arc ? T_WALL : T_FLOOR);
    }
  });

  it("records a necessary chute door while still rejecting an undeclared leak", () => {
    const g = grid();
    const mask: TrackMask = { lane: new Uint8Array(81), sealed: new Uint8Array(81), dist: new Float32Array(81) };
    const spine = Array.from({ length: 7 }, (_, k) => ({ i: 4, j: k + 1 }));
    for (const t of spine) {
      setTile(g, t.i, t.j, T_FLOOR);
      mask.lane[idx(g, t.i, t.j)] = 1;
      mask.sealed[idx(g, t.i, t.j)] = 1;
    }
    setTile(g, 4, 7, T_STAIRS);
    setTile(g, 5, 4, T_FLOOR);
    setTile(g, 6, 4, T_FLOOR);
    const chute: LaunchChute = { base: spine[0], mouth: spine[6], spine, dirI: 0, dirJ: 1, half: 0, edgeBest: 1 };
    const reaches = () => {
      const d = bfsDistances(g, 4, 1);
      return g.t.every((_, k) => !isWalkable(g, k % 9, Math.floor(k / 9)) || d[k] >= 0);
    };
    expect(checkPieces(g, mask).some((v) => v.label === "floor-sealed")).toBe(true);
    resealChute(g, mask, chute, reaches);
    expect(reaches()).toBe(true);
    expect(mask.chuteAccessPorts?.has(idx(g, 5, 4))).toBe(true);
    expect(checkPieces(g, mask).some((v) => v.label === "floor-sealed")).toBe(false);
    setTile(g, 3, 4, T_FLOOR);
    expect(checkPieces(g, mask).some((v) => v.label === "floor-sealed")).toBe(true);
    // A now-redundant one-tile opening closes and loses any prior declaration.
    mask.chuteAccessPorts!.add(idx(g, 3, 4));
    resealChute(g, mask, chute, reaches);
    expect(g.t[idx(g, 3, 4)]).toBe(T_WALL);
    expect(mask.chuteAccessPorts!.has(idx(g, 3, 4))).toBe(false);
  });
});
