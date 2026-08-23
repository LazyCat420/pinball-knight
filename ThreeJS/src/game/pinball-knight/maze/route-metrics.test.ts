/**
 * ROUTE GEOMETRY REGRESSION — pins the two audit fixes:
 *  1. pickEndpoints biases the exit toward WINDING routes (the "straight line
 *     to the exit" fix): the start→stairs artery must genuinely snake.
 *  2. The sparse-region fill guarantees no big empty quadrant: every coarse
 *     region of the maze with a meaningful share of walkable tiles hosts at
 *     least one pinball part.
 */
import { describe, it, expect } from "vitest";
import { generateMaze, thickenWalls, mulberry32, at, T_FLOOR } from "./generator";
import { pickEndpoints, widenMainArtery, traceArtery, decorateMaze } from "./decorate";
import { bfsDistances } from "../engine/flow-field";

/** Directness of the start→stairs artery: 1.0 = a dead-straight shot. */
function directness(seed: number): { direct: number; turnRate: number } {
  const rng = mulberry32(seed);
  const g = thickenWalls(generateMaze(20, 14, rng, 0.2, 0.65));
  const ends = pickEndpoints(g, rng)!;
  widenMainArtery(g, ends);
  const dist = bfsDistances(g, ends.start.i, ends.start.j);
  const path = traceArtery(g, ends.start, ends.stairs, dist);
  const pathLen = Math.max(1, path.length - 1);
  const euclid = Math.hypot(ends.stairs.i - ends.start.i, ends.stairs.j - ends.start.j);
  let turns = 0;
  for (let t = 2; t < path.length; t++) {
    const ai = path[t - 1].i - path[t - 2].i;
    const aj = path[t - 1].j - path[t - 2].j;
    const bi = path[t].i - path[t - 1].i;
    const bj = path[t].j - path[t - 1].j;
    if (ai !== bi || aj !== bj) turns++;
  }
  return { direct: euclid / pathLen, turnRate: turns / pathLen };
}

describe("route geometry", () => {
  it("the exit route snakes — never a near-straight shot", () => {
    let worst = 0;
    let sum = 0;
    const N = 24;
    for (let s = 1; s <= N; s++) {
      const { direct } = directness(s * 131);
      worst = Math.max(worst, direct);
      sum += direct;
    }
    // Directness 1.0 = straight corridor start→stairs. The winding pick keeps
    // every floor's route meaningfully bent, and the average well down.
    expect(worst).toBeLessThan(0.82);
    expect(sum / N).toBeLessThan(0.65);
  });

  it("the artery has real bends, not one long hallway", () => {
    for (let s = 1; s <= 12; s++) {
      const { turnRate } = directness(s * 977);
      // At least one direction change every ~12 tiles of the trek.
      expect(turnRate).toBeGreaterThan(1 / 12);
    }
  });

  it("no coarse region with real floor area is left without a part", () => {
    const REGION = 24;
    for (const seed of [3, 41, 88]) {
      const rng = mulberry32(seed);
      const g = thickenWalls(generateMaze(24, 16, rng, 0.2, 0.65));
      const ends = pickEndpoints(g, rng)!;
      widenMainArtery(g, ends);
      const plan = decorateMaze(g, rng, 20, 20, 12, [], { endpoints: ends });
      const regW = Math.ceil(g.w / REGION);
      const regionOf = (i: number, j: number): number => Math.floor(j / REGION) * regW + Math.floor(i / REGION);
      const floorPer = new Map<number, number>();
      for (let j = 0; j < g.h; j++) {
        for (let i = 0; i < g.w; i++) {
          if (at(g, i, j) === T_FLOOR) floorPer.set(regionOf(i, j), (floorPer.get(regionOf(i, j)) ?? 0) + 1);
        }
      }
      const withPart = new Set(plan.parts.map((p) => regionOf(p.i, p.j)));
      for (const [r, count] of floorPer) {
        // A region that is a meaningful slice of the maze must host machine.
        if (count < 120) continue; // slivers on the border can stay quiet
        expect(withPart.has(r)).toBe(true);
      }
    }
  });
});
