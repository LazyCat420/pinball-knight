import { describe, it, expect } from "vitest";
import { generateMaze, thickenWalls, mulberry32, at, T_FLOOR, T_WALL, idx } from "./generator";
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

describe("thickenWalls", () => {
  it("doubles the grid: 2-wide corridors behind a 2-thick border", () => {
    const g = thickenWalls(generateMaze(6, 5, mulberry32(9)));
    expect(g.w).toBe((6 * 2 + 1) * 2);
    expect(g.h).toBe((5 * 2 + 1) * 2);
    // First corridor cell lands at (2,2)..(3,3) behind a 2-thick border.
    expect(at(g, 0, 0)).toBe(T_WALL);
    expect(at(g, 1, 1)).toBe(T_WALL);
    expect(at(g, 2, 2)).toBe(T_FLOOR);
    expect(at(g, 3, 3)).toBe(T_FLOOR);
  });

  it("preserves connectivity exactly — every floor tile still reachable", () => {
    for (const seed of [3, 21, 77]) {
      const g = thickenWalls(generateMaze(9, 7, mulberry32(seed)));
      const dist = bfsDistances(g, 2, 2);
      for (let j = 0; j < g.h; j++) {
        for (let i = 0; i < g.w; i++) {
          if (at(g, i, j) === T_FLOOR) {
            expect(dist[idx(g, i, j)], `tile ${i},${j} seed ${seed}`).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it("gives every corridor a 2-thick wall band to its south (the tall-back guarantee)", () => {
    const g = thickenWalls(generateMaze(7, 6, mulberry32(4)));
    for (let j = 0; j < g.h; j++) {
      for (let i = 0; i < g.w; i++) {
        if (at(g, i, j) !== T_FLOOR) continue;
        // Directly south: either more corridor (an opening) or a wall whose
        // own south neighbour is also wall — never a lone 1-thick wall row.
        if (at(g, i, j + 1) === T_WALL) {
          const southOfWall = at(g, i, j + 2);
          expect(southOfWall === T_WALL || southOfWall === T_FLOOR).toBe(true);
          if (southOfWall === T_FLOOR) {
            // A 1-thick wall between two corridors can only be a braid tunnel
            // mouth — which is vertical floor, not wall, so this can't happen.
            expect.fail(`1-thick wall at ${i},${j + 1}`);
          }
        }
      }
    }
  });
});
