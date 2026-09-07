import { afterEach, describe, expect, it } from "vitest";
import { authorFloor } from "./floor-authoring";
import { state } from "../state";
import { __resetWallLookCache, setWallLook } from "../dev/wall-look";
import { buildHeadlessPlan } from "../dev/headless-floor";

const previous = { runSeed: state.runSeed, bonusRoomNext: state.bonusRoomNext };
afterEach(() => {
  Object.assign(state, previous);
  __resetWallLookCache();
});

function snapshot(f: Pick<ReturnType<typeof authorFloor>, "grid" | "plan">) {
  return {
    tiles: f.grid.t,
    shapes: f.grid.shapes,
    arcs: f.grid.arcs,
    arcIdx: f.grid.arcIdx,
    surfaces: f.grid.surfaces,
    plan: f.plan,
    start: f.plan.start,
    stairs: f.plan.stairs,
    parts: f.plan.parts,
  };
}

describe("live floor wall policy", () => {
  for (const level of [1, 3]) {
    it(`keeps L${level} geometry and oriented parts identical across wall looks`, () => {
      const floors = ["legacy", "runs", "tiles"].map((look) => {
        setWallLook(look as "legacy" | "runs" | "tiles");
        state.runSeed = 1;
        state.bonusRoomNext = false;
        return snapshot(authorFloor(level));
      });
      expect(floors[0].shapes.some((s) => s !== 0)).toBe(true);
      expect(floors[1]).toEqual(floors[0]);
      expect(floors[2]).toEqual(floors[0]);
      const headless = buildHeadlessPlan(level, 1)!;
      expect(headless).toBeTruthy();
      expect(headless.grid.t).toEqual(floors[0].tiles);
      expect(headless.grid.shapes).toEqual(floors[0].shapes);
      expect(headless.grid.arcs).toEqual(floors[0].arcs);
      expect(headless.grid.arcIdx).toEqual(floors[0].arcIdx);
      expect(headless.grid.surfaces).toEqual(floors[0].surfaces);
      expect(headless.plan).toEqual(floors[0].plan);
      expect(headless.plan.parts).toEqual(floors[0].parts);
    }, 120000);
  }
});
