import { describe, it, expect } from "vitest";
import {
  barrenField,
  measureOpenSpace,
  checkOpenSpace,
  formatOpenSpace,
  BARREN_UNREACHED,
  R_DEAD,
  R_DEAD_3,
  OPEN_SPACE_BASELINE,
} from "./open-space";
import { type Grid, type TilePos, T_WALL, T_FLOOR, setTile, idx } from "./generator";
import { buildHeadlessPlan } from "../dev/headless-floor";

/** An open room ringed by wall. */
function room(w = 41, h = 41): Grid {
  const g: Grid = { w, h, t: new Uint8Array(w * h).fill(T_WALL), shapes: new Uint8Array(w * h) };
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) setTile(g, i, j, T_FLOOR);
  return g;
}

/** Two open rooms joined by nothing — the sealed-pocket case. */
function twoSealedRooms(): Grid {
  const g: Grid = { w: 40, h: 11, t: new Uint8Array(40 * 11).fill(T_WALL), shapes: new Uint8Array(40 * 11) };
  for (let j = 1; j < 10; j++) {
    for (let i = 1; i < 15; i++) setTile(g, i, j, T_FLOOR);
    for (let i = 25; i < 39; i++) setTile(g, i, j, T_FLOOR);
  }
  return g;
}

const at = (g: Grid, f: Int32Array, i: number, j: number): number => f[idx(g, i, j)];

describe("barrenField", () => {
  it("reads 0 on a part's own tile and grows outward", () => {
    const g = room();
    const f = barrenField(g, [{ i: 20, j: 20 }]);
    expect(at(g, f, 20, 20)).toBe(0);
    expect(at(g, f, 21, 20)).toBe(3); // one orthogonal step
    expect(at(g, f, 21, 21)).toBe(4); // one diagonal step
    expect(at(g, f, 23, 20)).toBe(9); // three orthogonal steps
  });

  it("measures the DIAGONAL as 4/3 of an orthogonal step, not as 1 or as 2", () => {
    // This is the whole reason for the chamfer. A 4-connected BFS would call
    // this 20 steps; an 8-connected one would call it 10. The truth is ~14.1,
    // and 4-3 chamfer gives 10*4/3 = 13.3 — the error a plain BFS cannot get
    // anywhere near.
    const g = room();
    const f = barrenField(g, [{ i: 10, j: 10 }]);
    expect(at(g, f, 20, 20) / 3).toBeCloseTo(13.33, 1);
  });

  it("is GEODESIC — it does not see through a wall", () => {
    // The reason this is a Dijkstra and not a two-sweep chamfer like
    // clearanceField. A part one tile away through solid rock must NOT make
    // this tile look furnished.
    const g = room(41, 41);
    for (let j = 0; j < 41; j++) setTile(g, 20, j, T_WALL); // full-height divider
    const f = barrenField(g, [{ i: 19, j: 20 }]);
    expect(at(g, f, 19, 20)).toBe(0);
    // (21,20) is two tiles from the source in a straight line, but the divider
    // reaches the grid edge, so there is no path at all.
    expect(at(g, f, 21, 20)).toBe(BARREN_UNREACHED);
  });

  it("routes AROUND an obstacle rather than through it", () => {
    const g = room(41, 41);
    for (let j = 5; j < 36; j++) setTile(g, 20, j, T_WALL); // divider with gaps at both ends
    const f = barrenField(g, [{ i: 19, j: 20 }]);
    // Reachable, but only the long way round — far more than the 2 tiles of
    // straight-line separation.
    expect(at(g, f, 21, 20)).toBeGreaterThan(20 * 3);
    expect(at(g, f, 21, 20)).not.toBe(BARREN_UNREACHED);
  });

  it("marks walls and unreachable pockets as BARREN_UNREACHED", () => {
    const g = twoSealedRooms();
    const f = barrenField(g, [{ i: 5, j: 5 }]);
    expect(at(g, f, 5, 5)).toBe(0);
    expect(at(g, f, 30, 5)).toBe(BARREN_UNREACHED); // the other room
    expect(at(g, f, 0, 0)).toBe(BARREN_UNREACHED); // a wall
  });

  it("takes the NEAREST of several parts", () => {
    const g = room();
    const f = barrenField(g, [
      { i: 5, j: 20 },
      { i: 35, j: 20 },
    ]);
    expect(at(g, f, 6, 20)).toBe(3);
    expect(at(g, f, 34, 20)).toBe(3);
    expect(at(g, f, 20, 20)).toBe(15 * 3); // equidistant, 15 tiles from each
  });

  it("returns an all-unreached field when there are no parts", () => {
    const g = room();
    const f = barrenField(g, []);
    expect(at(g, f, 20, 20)).toBe(BARREN_UNREACHED);
  });

  it("tolerates duplicate and out-of-bounds sources", () => {
    const g = room();
    const f = barrenField(g, [
      { i: 20, j: 20 },
      { i: 20, j: 20 },
      { i: -5, j: 3 },
      { i: 999, j: 999 },
      { i: 0, j: 0 }, // a wall tile — not a valid source
    ]);
    expect(at(g, f, 20, 20)).toBe(0);
    expect(at(g, f, 21, 20)).toBe(3);
  });
});

describe("measureOpenSpace", () => {
  it("scores an empty plaza as almost entirely open-and-dead", () => {
    // The screenshot case: one big open room, one lonely part in a corner.
    const g = room(61, 61);
    const m = measureOpenSpace(g, [{ i: 2, j: 2 }]);
    expect(m.worstBarren).toBeGreaterThan(R_DEAD);
    expect(m.openDeadShare).toBeGreaterThan(0.8);
  });

  it("scores a well-furnished room near zero", () => {
    const g = room(61, 61);
    const parts: TilePos[] = [];
    for (let j = 4; j < 58; j += 8) for (let i = 4; i < 58; i += 8) parts.push({ i, j });
    const m = measureOpenSpace(g, parts);
    expect(m.worstBarren).toBeLessThan(R_DEAD);
    expect(m.openDeadShare).toBe(0);
  });

  it("does NOT punish a long empty corridor — that is transit, not a blank space", () => {
    // The discrimination the whole module exists for. A 2-wide corridor 50
    // tiles long with a part at each end is barren in the middle, but it is not
    // OPEN, so openDeadShare must stay 0 while deadShare does not.
    const g: Grid = { w: 60, h: 9, t: new Uint8Array(60 * 9).fill(T_WALL), shapes: new Uint8Array(60 * 9) };
    for (let j = 4; j < 6; j++) for (let i = 1; i < 59; i++) setTile(g, i, j, T_FLOOR);
    const m = measureOpenSpace(g, [
      { i: 2, j: 4 },
      { i: 57, j: 4 },
    ]);
    expect(m.worstBarren).toBeGreaterThan(R_DEAD);
    expect(m.deadShare).toBeGreaterThan(0);
    expect(m.openDeadShare).toBe(0);
  });

  it("catches the hierarchy defect: the biggest room is the emptiest room", () => {
    // A big bare hall joined to a small busy one. Floor-wide density looks
    // fine; biggestSectionRatio is what says the hall is a desert.
    const g: Grid = { w: 80, h: 41, t: new Uint8Array(80 * 41).fill(T_WALL), shapes: new Uint8Array(80 * 41) };
    for (let j = 1; j < 40; j++) for (let i = 1; i < 45; i++) setTile(g, i, j, T_FLOOR); // the hall
    for (let j = 14; j < 27; j++) for (let i = 45; i < 79; i++) setTile(g, i, j, T_FLOOR); // the busy room
    const parts: TilePos[] = [];
    for (let j = 16; j < 26; j += 3) for (let i = 47; i < 78; i += 3) parts.push({ i, j });
    const m = measureOpenSpace(g, parts);
    expect(m.sections.length).toBeGreaterThanOrEqual(1);
    expect(m.biggestSectionRatio).toBeLessThan(1);
    expect(m.openDeadShare).toBeGreaterThan(0.3);
  });

  it("reports R_DEAD in tiles and R_DEAD_3 in field units, consistently", () => {
    expect(R_DEAD_3).toBe(R_DEAD * 3);
  });

  it("counts every walkable tile exactly once", () => {
    const g = room(31, 21);
    const m = measureOpenSpace(g, [{ i: 15, j: 10 }]);
    expect(m.walkable).toBe(29 * 19);
  });

  it("RESPONDS MONOTONICALLY to how much is on the floor — the instrument's own control", () => {
    // A metric that does not move when the quantity it claims to measure moves
    // is not an instrument. Thinning a furnished room must raise every barren
    // number, every time, with no ties.
    const g = room(61, 61);
    const grid8: TilePos[] = [];
    for (let j = 4; j < 58; j += 8) for (let i = 4; i < 58; i += 8) grid8.push({ i, j });
    const steps = [grid8, grid8.filter((_, n) => n % 2 === 0), grid8.filter((_, n) => n % 4 === 0)];
    const barren = steps.map((p) => measureOpenSpace(g, p).worstBarren);
    const dead = steps.map((p) => measureOpenSpace(g, p).deadShare);
    // `worstBarren` is continuous, so it must move at EVERY step.
    expect(barren[0]).toBeLessThan(barren[1]);
    expect(barren[1]).toBeLessThan(barren[2]);
    // `deadShare` counts tiles past a THRESHOLD, so it is flat by construction
    // while the whole room is still inside `R_DEAD` — at 8-tile spacing the
    // furthest tile is 5.6 t away and at 16-tile spacing 11.3 t, both under 12.
    // Requiring it to move at every step would be requiring the metric not to
    // be the metric. It must be non-decreasing throughout and strictly higher
    // once the thinning actually crosses the line.
    expect(dead[0]).toBeLessThanOrEqual(dead[1]);
    expect(dead[1]).toBeLessThanOrEqual(dead[2]);
    expect(dead[0]).toBeLessThan(dead[2]);
  });
});

/**
 * THE GATE — over real floors, built by the chain that ships.
 *
 * Deliberately NOT part of `FLOOR_RULES`: `floor-rules.test.ts`'s own context
 * stops at geometry, and `piece-rules.test.ts:305` records `decorateMaze` at
 * ~40x the cost of the geometry pass, which is why that suite caps its sweep.
 * This one pays the same cost, so it holds itself to a small sweep across the
 * depths where the census found the numbers worst.
 */
describe("open space, over real floors", () => {
  const LEVELS = [3, 9, 15, 21, 27];
  const SEEDS = [1, 12345, 987654321];

  it("no shipping floor is mostly open and empty", () => {
    const bad: string[] = [];
    let floors = 0;
    for (const level of LEVELS) {
      for (const seed of SEEDS) {
        const f = buildHeadlessPlan(level, seed);
        if (!f) continue;
        floors++;
        const m = measureOpenSpace(f.grid, f.plan.parts);
        const v = checkOpenSpace(m);
        if (v.length) bad.push(`L${level} ${f.archetype} seed=${seed}: ${v.join("; ")}\n    ${formatOpenSpace(m)}`);
      }
    }
    expect(floors, "sweep too small to see a depth-specific defect").toBeGreaterThan(12);
    expect(`${bad.length}/${floors} floors:\n${bad.slice(0, 4).join("\n")}`).toBe(`0/${floors} floors:\n`);
  }, 300000);

  it("the biggest room is not routinely the emptiest one", () => {
    // A RATE, not a per-floor band, and the reason is in `open-space.ts`'s
    // header: 2 of the 180 census floors ship with zero parts in their largest
    // section, so a per-floor form could only pass if it were set to 0.
    //
    // The cap is set off the census (17/180 = 9.4% of floors below 0.5) with
    // room for seed noise on a sweep this small. It is armed, not decorative:
    // halving the part budget takes this straight past the line.
    let floors = 0;
    let starved = 0;
    for (const level of LEVELS) {
      for (const seed of SEEDS) {
        const f = buildHeadlessPlan(level, seed);
        if (!f) continue;
        floors++;
        if (measureOpenSpace(f.grid, f.plan.parts).biggestSectionRatio < 0.5) starved++;
      }
    }
    expect(OPEN_SPACE_BASELINE.bigRatioBelowHalf).toBeLessThan(0.2); // the census, pinned
    expect(`${starved}/${floors}`, "the floor's largest room carries almost nothing").toBe(
      `${starved <= Math.ceil(floors * 0.25) ? starved : "TOO MANY"}/${floors}`,
    );
  }, 300000);

  it("POSITIVE CONTROL — the gate fires when a floor really is empty", () => {
    // A gate that has never been seen to fail is not known to work. Take a real
    // floor and strip its furniture; every band must break.
    const f = buildHeadlessPlan(9, 12345);
    expect(f).not.toBeNull();
    const full = measureOpenSpace(f!.grid, f!.plan.parts);
    expect(checkOpenSpace(full)).toEqual([]);

    const stripped = measureOpenSpace(f!.grid, f!.plan.parts.slice(0, 1));
    const broke = checkOpenSpace(stripped);
    expect(broke.join(" ")).toContain("worstBarren");
    expect(broke.join(" ")).toContain("deadShare");
    expect(stripped.worstBarren).toBeGreaterThan(full.worstBarren);
  }, 300000);
});
