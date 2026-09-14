import { expect, it } from "vitest";
import { buildMegaFloor } from "./mega-floor";
import { bfsDistancesOwned } from "../engine/flow-field";
import { isWalkable } from "../engine/grid";

for (const scale of [1, 2, 4]) {
  it(`authors a connected full floor at ${scale}x dimensions`, () => {
    const f = buildMegaFloor({ level: 5, runSeed: 777, scale })!;
    expect(f).not.toBeNull();
    const g = f.grid;
    const dist = bfsDistancesOwned(g, f.start.i, f.start.j);
    expect(dist[f.stairs.j * g.w + f.stairs.i]).toBeGreaterThanOrEqual(0);
    let unreachable = 0;
    for (let k = 0; k < g.t.length; k++) {
      if (isWalkable(g, k % g.w, Math.floor(k / g.w)) && dist[k] < 0) unreachable++;
    }
    expect(unreachable).toBe(0);
    expect(f.plan.parts.length).toBeGreaterThan(50 * scale);
    if (scale === 4) expect(g.t.length).toBeGreaterThan(100_000);
  });
}
