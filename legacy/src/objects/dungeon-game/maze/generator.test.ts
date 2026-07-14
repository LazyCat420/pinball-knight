import { describe, it, expect } from "vitest";
import { generateMaze, mulberry32, at, T_FLOOR, T_WALL, idx } from "./generator";
import { bfsDistances } from "../entities/ai";

describe("generateMaze", () => {
  it("produces a tile grid of 2*cells+1 per side", () => {
    const g = generateMaze(8, 6, mulberry32(1));
    expect(g.w).toBe(17);
    expect(g.h).toBe(13);
  });

  it("keeps the border solid wall", () => {
    const g = generateMaze(10, 7, mulberry32(2));
    for (let i = 0; i < g.w; i++) {
      expect(at(g, i, 0)).toBe(T_WALL);
      expect(at(g, i, g.h - 1)).toBe(T_WALL);
    }
    for (let j = 0; j < g.h; j++) {
      expect(at(g, 0, j)).toBe(T_WALL);
      expect(at(g, g.w - 1, j)).toBe(T_WALL);
    }
  });

  it("carves the start cell (1,1)", () => {
    const g = generateMaze(5, 5, mulberry32(3));
    expect(at(g, 1, 1)).toBe(T_FLOOR);
  });

  it("makes every floor tile reachable from the start (solvable)", () => {
    for (const seed of [1, 7, 42, 1234]) {
      const g = generateMaze(12, 9, mulberry32(seed));
      const dist = bfsDistances(g, 1, 1);
      for (let j = 0; j < g.h; j++) {
        for (let i = 0; i < g.w; i++) {
          if (at(g, i, j) === T_FLOOR) {
            expect(dist[idx(g, i, j)], `tile ${i},${j} seed ${seed}`).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it("stays fully reachable with heavy braiding", () => {
    const g = generateMaze(12, 9, mulberry32(5), 0.5);
    const dist = bfsDistances(g, 1, 1);
    for (let j = 0; j < g.h; j++) {
      for (let i = 0; i < g.w; i++) {
        if (at(g, i, j) === T_FLOOR) expect(dist[idx(g, i, j)]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("is deterministic for a given seed", () => {
    const a = generateMaze(9, 7, mulberry32(99));
    const b = generateMaze(9, 7, mulberry32(99));
    expect(Array.from(a.t)).toEqual(Array.from(b.t));
  });

  it("rejects degenerate sizes", () => {
    expect(() => generateMaze(1, 5, mulberry32(1))).toThrow();
  });
});
