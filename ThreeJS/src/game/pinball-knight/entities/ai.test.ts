import { describe, it, expect } from "vitest";
import { generateMaze, mulberry32, at, T_FLOOR, idx } from "../maze/generator";
import { bfsDistances, bfsDistancesOwned, flowStep } from "../engine/flow-field";

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

describe("bfsDistances scratch-buffer contract", () => {
  it("REUSES its buffer — a retained field is clobbered by the next call", () => {
    // Documents the hazard rather than hiding it. bfsDistances hands back
    // shared scratch so the 4Hz flow field stops producing ~0.8MB/sec of
    // garbage; anything that KEEPS a field must use bfsDistancesOwned.
    const g = generateMaze(9, 7, mulberry32(3));
    const a = bfsDistances(g, 1, 1);
    const b = bfsDistances(g, 3, 3);
    expect(a).toBe(b); // same object, by design
  });

  it("bfsDistancesOwned survives a later query", () => {
    const g = generateMaze(9, 7, mulberry32(3));
    const owned = bfsDistancesOwned(g, 1, 1);
    const before = Array.from(owned);
    bfsDistances(g, 3, 3); // would corrupt shared scratch
    expect(Array.from(owned)).toEqual(before);
  });

  it("gives the same answers as a freshly allocated run", () => {
    // The reuse must not change RESULTS — a stale value surviving fill(-1)
    // would silently mispath the whole horde.
    const g = generateMaze(11, 9, mulberry32(5));
    const first = Array.from(bfsDistancesOwned(g, 1, 1));
    bfsDistances(g, 3, 3); // dirty the buffer with a different query
    const again = Array.from(bfsDistancesOwned(g, 1, 1));
    expect(again).toEqual(first);
  });

  it("handles a grid size change without leaking the old buffer's values", () => {
    const small = generateMaze(7, 5, mulberry32(11));
    const big = generateMaze(21, 15, mulberry32(13));
    bfsDistances(small, 1, 1);
    const d = bfsDistancesOwned(big, 1, 1);
    expect(d.length).toBe(big.w * big.h);
  });
});
