import { describe, it, expect } from "vitest";
import { findBends, chainBends, turnOf, arcForBend, chainArcLength } from "./artery-banks";
import type { TilePos } from "./generator";

/** Build a path from a start and a list of [heading, steps] legs. */
function walk(si: number, sj: number, legs: Array<[number, number, number]>): TilePos[] {
  const out: TilePos[] = [{ i: si, j: sj }];
  let i = si, j = sj;
  for (const [di, dj, n] of legs) {
    for (let k = 0; k < n; k++) {
      i += di;
      j += dj;
      out.push({ i, j });
    }
  }
  return out;
}

describe("turnOf", () => {
  it("reads clockwise as positive in grid space (+i right, +j down)", () => {
    // East then South is a right-hand turn on screen.
    expect(turnOf({ di: 1, dj: 0 }, { di: 0, dj: 1 })).toBeGreaterThan(0);
  });

  it("reads anticlockwise as negative", () => {
    expect(turnOf({ di: 1, dj: 0 }, { di: 0, dj: -1 })).toBeLessThan(0);
  });

  it("is zero for straight AND for a reversal", () => {
    // Both are unbankable, and both must be excluded — a reversal especially,
    // since no arc turns a corridor back on itself without pinching it shut.
    expect(turnOf({ di: 1, dj: 0 }, { di: 1, dj: 0 })).toBe(0);
    expect(turnOf({ di: 1, dj: 0 }, { di: -1, dj: 0 })).toBe(0);
  });
});

describe("findBends", () => {
  it("finds a single L", () => {
    const p = walk(0, 0, [[1, 0, 5], [0, 1, 5]]);
    const b = findBends(p);
    expect(b).toHaveLength(1);
    expect(b[0].turn).toBe(1);
    expect(b[0].runIn).toBe(5);
  });

  it("records the straight run BEFORE each bend — that is arrival speed", () => {
    const p = walk(0, 0, [[1, 0, 7], [0, 1, 2], [1, 0, 3]]);
    const b = findBends(p);
    expect(b).toHaveLength(2);
    expect(b[0].runIn).toBe(7);
    expect(b[1].runIn).toBe(2);
  });

  it("ignores a straight path entirely", () => {
    expect(findBends(walk(0, 0, [[1, 0, 10]]))).toHaveLength(0);
  });

  it("ignores a 180 reversal", () => {
    const p = walk(0, 0, [[1, 0, 4], [-1, 0, 4]]);
    expect(findBends(p)).toHaveLength(0);
  });

  it("handles a degenerate short path", () => {
    expect(findBends([])).toHaveLength(0);
    expect(findBends([{ i: 0, j: 0 }])).toHaveLength(0);
    expect(findBends([{ i: 0, j: 0 }, { i: 1, j: 0 }])).toHaveLength(0);
  });

  it("distinguishes an S-curve from a sweep by turn sign", () => {
    // right then left = S; right then right = sweep. Both are chainable, but
    // they are different rides and the sign is how a caller tells them apart.
    const s = findBends(walk(0, 0, [[1, 0, 3], [0, 1, 3], [1, 0, 3]]));
    expect(s.map((b) => b.turn)).toEqual([1, -1]);
    const sweep = findBends(walk(0, 0, [[1, 0, 3], [0, 1, 3], [-1, 0, 3]]));
    expect(sweep.map((b) => b.turn)).toEqual([1, 1]);
  });
});

describe("chainBends", () => {
  it("groups bends within the gap into one ride", () => {
    const p = walk(0, 0, [[1, 0, 4], [0, 1, 2], [1, 0, 2], [0, 1, 4]]);
    const chains = chainBends(findBends(p), 3);
    expect(chains).toHaveLength(1);
    expect(chains[0].bends.length).toBe(3);
  });

  it("splits bends that are far apart", () => {
    const p = walk(0, 0, [[1, 0, 4], [0, 1, 20], [1, 0, 4]]);
    const chains = chainBends(findBends(p), 3);
    expect(chains).toHaveLength(2);
  });

  it("totals the turning so arc length can be derived", () => {
    const p = walk(0, 0, [[1, 0, 3], [0, 1, 2], [1, 0, 2]]);
    const chains = chainBends(findBends(p), 3);
    expect(chains[0].totalTurn).toBeCloseTo(Math.PI, 5); // two quarter-turns
  });

  it("returns nothing for no bends", () => {
    expect(chainBends([], 3)).toHaveLength(0);
  });
});

describe("arcForBend — the geometry that makes a bank long", () => {
  const bend = findBends(walk(0, 0, [[1, 0, 4], [0, 1, 4]]))[0];

  it("puts the turn centre on the INSIDE of the bend", () => {
    // Travelling east then south, the inside of the turn is to the south-east.
    const a = arcForBend(bend, 2, 3);
    expect(a.cx).toBeGreaterThan(bend.corner.i);
    expect(a.cz).toBeGreaterThan(bend.corner.j);
  });

  it("rides the OUTER radius: ro = ri + corridor width", () => {
    // This is the whole point — the outside of a bend is the long, fast line.
    expect(arcForBend(bend, 2, 3).r).toBeCloseTo(5, 5);
    expect(arcForBend(bend, 1, 3).r).toBeCloseTo(4, 5);
  });

  it("keeps the corner on the arc it authors", () => {
    // The corner tile centre must sit at radius ro from the computed centre,
    // or the arc is not the wall the ball actually meets.
    const a = arcForBend(bend, 2, 3);
    const d = Math.hypot(bend.corner.i + 0.5 - a.cx, bend.corner.j + 0.5 - a.cz);
    expect(d).toBeCloseTo(a.r, 5);
  });

  it("places the centre AHEAD along travel, not behind — distance is not enough", () => {
    // The trap this pins: `-in + out` also puts the corner at exactly radius
    // ro, so a distance-only check passes while the centre sits on the wrong
    // side and the arc curves away from the corridor. The centre must be
    // forward of the corner along the INCOMING heading.
    const a = arcForBend(bend, 2, 3);
    const ahead = (a.cx - (bend.corner.i + 0.5)) * bend.inDir.di + (a.cz - (bend.corner.j + 0.5)) * bend.inDir.dj;
    expect(ahead).toBeGreaterThan(0);
    // ...and inward along the OUTGOING heading too.
    const inward = (a.cx - (bend.corner.i + 0.5)) * bend.outDir.di + (a.cz - (bend.corner.j + 0.5)) * bend.outDir.dj;
    expect(inward).toBeGreaterThan(0);
  });

  it("spans a quarter turn", () => {
    expect(arcForBend(bend, 2, 3).span).toBeCloseTo(Math.PI / 2, 5);
  });
});

describe("chainArcLength — is a bank even worth authoring?", () => {
  it("beats the shipped fillet by a wide margin", () => {
    // The number that justifies this whole module. A radius-2 quarter fillet is
    // ~3.14 tiles of arc; a W=3 corridor bend at ri=2 is ~7.85.
    const one = chainBends(findBends(walk(0, 0, [[1, 0, 4], [0, 1, 4]])), 3)[0];
    expect(chainArcLength(one, 2, 3)).toBeGreaterThan(7);
    expect(chainArcLength(one, 2, 3)).toBeGreaterThan(2 * (2 * Math.PI / 4));
  });

  it("scales with chain length — three bends is a long ride", () => {
    const p = walk(0, 0, [[1, 0, 4], [0, 1, 2], [1, 0, 2], [0, 1, 2]]);
    const chain = chainBends(findBends(p), 3)[0];
    expect(chain.bends.length).toBe(3);
    // ~23.5 tiles: nearly a second of held rail at RAIL_ACCEL.
    expect(chainArcLength(chain, 2, 3)).toBeGreaterThan(20);
  });

  it("grows with the corridor width, since the ball rides the outer wall", () => {
    const chain = chainBends(findBends(walk(0, 0, [[1, 0, 4], [0, 1, 4]])), 3)[0];
    expect(chainArcLength(chain, 2, 5)).toBeGreaterThan(chainArcLength(chain, 2, 3));
  });
});

describe("banks land on real floors and are rideable", () => {
  it("authors LONG railed banks without breaking the floor", async () => {
    const { generateMaze, thickenWalls, isWalkable, idx } = await import("./generator");
    const { decorateMaze, widenMainArtery, pickEndpoints } = await import("./decorate");
    const { bfsDistancesOwned } = await import("../entities/ai");
    const { levelConfig } = await import("../constants");
    const { mulberry32 } = await import("../../../utils/rng");

    let longRailed = 0;
    let floors = 0;
    for (let seed = 0; seed < 8; seed++) {
      const cfg = levelConfig(1 + seed);
      const rng = mulberry32(4242 + seed);
      const grid = thickenWalls(generateMaze(cfg.cellsW, cfg.cellsH, rng, cfg.braid, cfg.windiness));
      const ep = pickEndpoints(grid, rng);
      if (!ep) continue;
      widenMainArtery(grid, ep);
      decorateMaze(grid, rng, cfg.zombies, cfg.torches, 16, [], { endpoints: ep });
      floors++;

      // Every floor must still be solvable — banks ADD WALL, so this is the
      // invariant that matters most.
      const d = bfsDistancesOwned(grid, ep.start.i, ep.start.j);
      for (let j = 0; j < grid.h; j++) {
        for (let i = 0; i < grid.w; i++) {
          expect(!(isWalkable(grid, i, j) && d[idx(grid, i, j)] < 0), `orphan at ${i},${j}`).toBe(true);
        }
      }
      for (const f of grid.arcs ?? []) {
        if (f.span <= 1e-6) continue;
        if (f.r * f.span >= 6 && (f.lanes?.length ?? 0) > 0) longRailed++;
      }
    }
    // The whole point of the module: arcs long enough to actually hold a rail.
    // A shipped fillet is ~3.1 tiles; these are ~7.9.
    expect(floors).toBeGreaterThan(0);
    expect(longRailed / floors).toBeGreaterThan(1);
  }, 300000);
});
