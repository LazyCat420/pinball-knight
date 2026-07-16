import { describe, it, expect } from "vitest";
import { generateMaze, thickenWalls, carveRooms, crackSecretWalls, mulberry32, at, T_FLOOR, T_WALL, T_CRACKED, idx } from "./generator";
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

describe("carveRooms", () => {
  it("carves fully-floor rects that keep the maze solvable", () => {
    for (const seed of [2, 19, 101]) {
      const g = generateMaze(14, 11, mulberry32(seed));
      const rooms = carveRooms(g, mulberry32(seed + 1), 3, 2, 4);
      expect(rooms.length).toBeGreaterThan(0);
      for (const r of rooms) {
        expect(r.i0).toBeGreaterThanOrEqual(1);
        expect(r.j0).toBeGreaterThanOrEqual(1);
        expect(r.i0 + r.w).toBeLessThan(g.w);
        expect(r.j0 + r.h).toBeLessThan(g.h);
        for (let j = r.j0; j < r.j0 + r.h; j++) {
          for (let i = r.i0; i < r.i0 + r.w; i++) {
            expect(at(g, i, j)).toBe(T_FLOOR);
          }
        }
      }
      // Connectivity preserved by construction — verify anyway.
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

  it("keeps rooms apart — no two rects touch", () => {
    const g = generateMaze(16, 12, mulberry32(31));
    const rooms = carveRooms(g, mulberry32(32), 4, 2, 3);
    for (const a of rooms) {
      for (const b of rooms) {
        if (a === b) continue;
        const overlap = a.i0 < b.i0 + b.w + 2 && b.i0 < a.i0 + a.w + 2 && a.j0 < b.j0 + b.h + 2 && b.j0 < a.j0 + a.h + 2;
        expect(overlap).toBe(false);
      }
    }
  });
});

describe("crackSecretWalls", () => {
  it("marks walls that sit between two floors, so every break is a shortcut", () => {
    const g = generateMaze(14, 11, mulberry32(7), 0); // perfect maze: plenty of closed walls
    const picked = crackSecretWalls(g, mulberry32(8), 3);
    expect(picked.length).toBeGreaterThan(0);
    for (const c of picked) {
      expect(at(g, c.i, c.j)).toBe(T_CRACKED);
      const horizontal = at(g, c.i - 1, c.j) === T_FLOOR && at(g, c.i + 1, c.j) === T_FLOOR;
      const vertical = at(g, c.i, c.j - 1) === T_FLOOR && at(g, c.i, c.j + 1) === T_FLOOR;
      expect(horizontal || vertical).toBe(true);
    }
  });

  it("stays solid until broken: cracked tiles are not walkable, and thicken to a 2×2 band", () => {
    const g = generateMaze(12, 9, mulberry32(13), 0);
    const picked = crackSecretWalls(g, mulberry32(14), 2);
    const thick = thickenWalls(g);
    for (const c of picked) {
      for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        expect(at(thick, c.i * 2 + di, c.j * 2 + dj)).toBe(T_CRACKED);
      }
    }
    // Cracked is a wall to BFS — the shortcut doesn't exist until the smash.
    const dist = bfsDistances(thick, 2, 2);
    for (const c of picked) {
      expect(dist[idx(thick, c.i * 2, c.j * 2)]).toBeLessThan(0);
    }
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
