import { describe, expect, it } from "vitest";
import { bfsDistances, bfsDistancesOwned, hordeFlowField } from "./flow-field";
import { type Grid, T_FLOOR } from "./grid";

function room(w = 9, h = 7): Grid {
  const g = { w, h, t: new Uint8Array(w * h), shapes: new Uint8Array(w * h) };
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) g.t[j * w + i] = T_FLOOR;
  return g;
}

describe("owned horde field reuse", () => {
  it("reuses storage, tracks a moving player, and survives unrelated scratch queries", () => {
    const g = room();
    const field = hordeFlowField(g, 1, 1);
    for (const [i, j] of [[5, 3], [2, 4], [1, 1]]) {
      expect(hordeFlowField(g, i, j, field)).toBe(field);
      expect(field).toEqual(bfsDistancesOwned(g, i, j));
      const saved = field.slice();
      bfsDistances(g, 7, 5);
      expect(field).toEqual(saved);
    }
  });

  it("recomputes after walls change and clears stale distances for a blocked seed", () => {
    const g = room();
    const field = hordeFlowField(g, 1, 1);
    for (let j = 1; j < g.h - 1; j++) g.t[j * g.w + 4] = 0;
    hordeFlowField(g, 1, 1, field);
    expect(field[3 * g.w + 6]).toBe(-1);
    g.t.fill(0);
    expect(hordeFlowField(g, 1, 1, field)).toBe(field);
    expect(field.every(d => d === -1)).toBe(true);
  });

  it("snaps a wall seed using the same owned buffer", () => {
    const g = room();
    const field = hordeFlowField(g, 1, 1);
    expect(hordeFlowField(g, 0, 3, field)).toBe(field);
    expect(field).toEqual(hordeFlowField(g, 0, 3));
    expect(field.some(d => d === 0)).toBe(true);
  });

  it("reallocates on a floor size change and never adopts shared scratch", () => {
    const small = room(), large = room(17, 13);
    const field = hordeFlowField(small, 1, 1);
    const next = hordeFlowField(large, 1, 1, field);
    expect(next).not.toBe(field);
    expect(next.length).toBe(large.t.length);
    const scratch = bfsDistances(large, 1, 1);
    const owned = bfsDistancesOwned(large, 2, 3, scratch);
    expect(owned).not.toBe(scratch);
    const saved = owned.slice();
    bfsDistances(large, 7, 5);
    expect(owned).toEqual(saved);
  });
});
