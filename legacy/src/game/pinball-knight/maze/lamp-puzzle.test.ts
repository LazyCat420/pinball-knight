/**
 * LIGHT PUZZLE authoring — braziers + vault land on reachable, unoccupied,
 * well-spread floor, and the pass never touches walkability.
 */
import { describe, it, expect } from "vitest";
import { type Grid, T_FLOOR, T_WALL, at, isWalkable, idx, mulberry32 } from "./generator";
import { authorLampPuzzle, lampCountFor } from "./lamp-puzzle";
import { bfsDistances } from "../engine/flow-field";

function emptyGrid(w: number, h: number): Grid {
  const g: Grid = { w, h, t: new Uint8Array(w * h).fill(T_WALL), shapes: new Uint8Array(w * h) };
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) g.t[j * w + i] = T_FLOOR;
  return g;
}
const never = (): boolean => false;

describe("lampCountFor", () => {
  it("scales 3→5 with depth and never leaves the band", () => {
    expect(lampCountFor(1)).toBe(3);
    expect(lampCountFor(9)).toBe(5);
    expect(lampCountFor(40)).toBe(5);
    for (const l of [1, 3, 7, 12, 30]) {
      expect(lampCountFor(l)).toBeGreaterThanOrEqual(3);
      expect(lampCountFor(l)).toBeLessThanOrEqual(5);
    }
  });
});

describe("authorLampPuzzle", () => {
  it("places the requested braziers + a vault on reachable, unoccupied floor", () => {
    const g = emptyGrid(24, 20);
    const start = { i: 1, j: 1 };
    const plan = authorLampPuzzle(g, start, never, mulberry32(3), 4);
    expect(plan).toBeTruthy();
    expect(plan!.lamps.length).toBe(4);
    const d = bfsDistances(g, start.i, start.j);
    for (const l of plan!.lamps) {
      expect(l.kind).toBe("lamp");
      expect(at(g, l.i, l.j)).toBe(T_FLOOR);
      expect(d[idx(g, l.i, l.j)]).toBeGreaterThanOrEqual(4);
    }
    expect(at(g, plan!.vault.i, plan!.vault.j)).toBe(T_FLOOR);
    expect(plan!.loot.length).toBeGreaterThan(0);
  });

  it("spreads braziers apart and keeps them clear of the vault", () => {
    const g = emptyGrid(30, 24);
    const plan = authorLampPuzzle(g, { i: 1, j: 1 }, never, mulberry32(9), 5)!;
    expect(plan).toBeTruthy();
    for (const a of plan.lamps) {
      expect(Math.abs(a.i - plan.vault.i) + Math.abs(a.j - plan.vault.j)).toBeGreaterThanOrEqual(3);
      for (const b of plan.lamps) {
        if (a === b) continue;
        expect(Math.abs(a.i - b.i) + Math.abs(a.j - b.j)).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it("respects occupied tiles", () => {
    const g = emptyGrid(24, 20);
    const taken = new Set<string>();
    // Occupy a big chunk; authoring must avoid all of it.
    for (let j = 1; j < 19; j++) for (let i = 12; i < 23; i++) taken.add(`${i},${j}`);
    const plan = authorLampPuzzle(g, { i: 1, j: 1 }, (i, j) => taken.has(`${i},${j}`), mulberry32(1), 4);
    if (plan) {
      for (const l of [...plan.lamps, plan.vault]) expect(taken.has(`${l.i},${l.j}`)).toBe(false);
    }
  });

  it("declines a floor too small to host a puzzle", () => {
    const g = emptyGrid(6, 6); // maxD < 8
    expect(authorLampPuzzle(g, { i: 1, j: 1 }, never, mulberry32(1), 4)).toBeNull();
  });

  it("never mutates the grid (walkability unchanged)", () => {
    const g = emptyGrid(24, 20);
    const before = Uint8Array.from(g.t);
    authorLampPuzzle(g, { i: 1, j: 1 }, never, mulberry32(5), 4);
    expect(Array.from(g.t)).toEqual(Array.from(before));
  });
});
