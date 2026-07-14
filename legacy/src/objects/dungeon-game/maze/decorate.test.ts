import { describe, it, expect } from "vitest";
import { generateMaze, mulberry32, at, T_FLOOR, T_STAIRS, T_WALL, idx } from "./generator";
import { decorateMaze } from "./decorate";
import { bfsDistances } from "../entities/ai";

function makeLevel(seed: number, zombies = 8, torches = 10) {
  const g = generateMaze(10, 8, mulberry32(seed));
  // Snapshot distances BEFORE decorate stamps the stairs tile.
  const dist = bfsDistances(g, 1, 1);
  const plan = decorateMaze(g, mulberry32(seed + 1), zombies, torches);
  return { g, dist, plan };
}

describe("decorateMaze", () => {
  it("puts the stairs at the maximum BFS distance from the start", () => {
    const { g, dist, plan } = makeLevel(11);
    const max = Math.max(...Array.from(dist));
    expect(dist[idx(g, plan.stairs.i, plan.stairs.j)]).toBe(max);
    expect(at(g, plan.stairs.i, plan.stairs.j)).toBe(T_STAIRS);
  });

  it("places the requested number of spawns, none near the start", () => {
    const { g, dist, plan } = makeLevel(23);
    expect(plan.spawns.length).toBe(8);
    for (const s of plan.spawns) {
      expect(at(g, s.i, s.j)).toBe(T_FLOOR);
      expect(dist[idx(g, s.i, s.j)]).toBeGreaterThanOrEqual(5);
    }
  });

  it("mounts every torch on a real wall", () => {
    const { g, plan } = makeLevel(37);
    expect(plan.torches.length).toBeGreaterThan(0);
    for (const t of plan.torches) {
      expect(at(g, t.i, t.j)).toBe(T_FLOOR);
      expect(at(g, t.i + t.di, t.j + t.dj)).toBe(T_WALL);
    }
  });

  it("keeps the start tile a plain floor", () => {
    const { g, plan } = makeLevel(53);
    expect(plan.start).toEqual({ i: 1, j: 1 });
    expect(at(g, 1, 1)).toBe(T_FLOOR);
  });
});
