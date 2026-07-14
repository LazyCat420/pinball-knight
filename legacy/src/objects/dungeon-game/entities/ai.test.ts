import { describe, it, expect } from "vitest";
import { generateMaze, mulberry32, at, T_FLOOR, idx } from "../maze/generator";
import { bfsDistances, flowStep } from "./ai";

describe("flow field", () => {
  it("descends from every reachable tile to the player, in exactly dist steps", () => {
    const g = generateMaze(11, 8, mulberry32(17));
    const player = { i: 9, j: 7 };
    // The backtracker always carves odd,odd cells.
    expect(at(g, player.i, player.j)).toBe(T_FLOOR);

    const dist = bfsDistances(g, player.i, player.j);

    for (let j = 0; j < g.h; j++) {
      for (let i = 0; i < g.w; i++) {
        const d = dist[idx(g, i, j)];
        if (d <= 0) continue; // wall, unreachable, or the player tile itself
        let cur = { i, j };
        for (let step = 0; step < d; step++) {
          const next = flowStep(g, dist, cur.i, cur.j);
          expect(next, `stuck at ${cur.i},${cur.j} from ${i},${j}`).not.toBeNull();
          cur = next!;
        }
        expect(cur).toEqual(player);
      }
    }
  });

  it("returns null at the player's own tile and on walls", () => {
    const g = generateMaze(5, 5, mulberry32(2));
    const dist = bfsDistances(g, 1, 1);
    expect(flowStep(g, dist, 1, 1)).toBeNull();
    expect(flowStep(g, dist, 0, 0)).toBeNull();
  });

  it("marks unreachable tiles -1 when the source is a wall", () => {
    const g = generateMaze(5, 5, mulberry32(3));
    const dist = bfsDistances(g, 0, 0);
    expect(Math.max(...Array.from(dist))).toBe(-1);
  });
});
