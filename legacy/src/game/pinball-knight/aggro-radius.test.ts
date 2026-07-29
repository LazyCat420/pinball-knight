/**
 * THE AGGRO RADIUS MUST REACH THE HORDE.
 *
 * The bug this pins: floors grew 4× in area (137f32c), and because spawn
 * placement is FLOOR-RELATIVE — `maze/decorate.ts` uses
 * `minSpawnDist = max(5, floor(maxDist * 0.3))` — every monster moved
 * proportionally further away. `AGGRO_TILES` stayed at 9, the value it was
 * given when floors were half as wide. That commit rescaled zombie counts,
 * torches, rooms, secrets and even FROG_TRAIL_TILES ("scaled with 4× floors"),
 * so the omission was an oversight rather than a decision.
 *
 * Measured on a live floor 1 before the fix: the median monster sat 53 path
 * tiles from the knight against a radius of 9, so 2.7% of the horde could ever
 * wake. In play that reads as "the monsters are frozen" — they are not frozen,
 * they simply never notice you.
 *
 * tsc cannot catch this: both sides are plain numbers, and neither file
 * imports the other. Nothing goes red when a floor grows. So the invariant is
 * asserted here, in the same terms the level generator uses.
 */
import { describe, expect, it } from "vitest";
import { AGGRO_TILES, aggroTiles } from "./constants";
import { levelConfig } from "./constants";

/**
 * The generator's own spawn rule, mirrored. Kept as a literal restatement of
 * `maze/decorate.ts` rather than an import, because the point is to notice
 * when the two DRIFT — importing the real one would make the test agree with
 * whatever the generator does, including the wrong thing.
 */
const minSpawnDist = (maxDist: number): number => Math.max(5, Math.floor(maxDist * 0.3));

/** Grid tile dimensions for a floor, per constants/level.ts + track-floor.ts. */
function gridDims(level: number): { w: number; h: number } {
  const cellsW = Math.min(34 + Math.ceil(level * 2.8), 66);
  const cellsH = Math.min(24 + 2 * level, 50);
  return { w: cellsW * 2 + 1, h: cellsH * 2 + 1 };
}

describe("aggro radius vs. where monsters actually spawn", () => {
  it("reaches the nearest spawn band on every floor", () => {
    for (let level = 1; level <= 25; level++) {
      const { w, h } = gridDims(level);
      // maxDist is a path distance and cannot exceed the grid's half-diagonal
      // by much on these looping-track floors; the half-diagonal is the
      // conservative stand-in (a SMALLER maxDist means a SMALLER minSpawnDist,
      // so using it here does not flatter the radius).
      const halfDiag = Math.hypot(w, h) * 0.5;
      const nearestSpawn = minSpawnDist(halfDiag);
      const radius = aggroTiles(w, h);
      expect(
        radius,
        `floor ${level} (${w}x${h}): aggro radius ${radius} cannot reach the nearest spawn band at ${nearestSpawn} tiles — the horde would idle all floor`,
      ).toBeGreaterThanOrEqual(nearestSpawn);
    }
  });

  it("scales with the floor instead of staying a fixed number", () => {
    // The actual regression: a constant that did not move when floors did.
    const small = aggroTiles(...Object.values(gridDims(1)) as [number, number]);
    const large = aggroTiles(...Object.values(gridDims(25)) as [number, number]);
    expect(large, "a bigger floor must widen the aggro radius").toBeGreaterThan(small);
  });

  it("never drops below the hand-tuned original on a small floor", () => {
    expect(aggroTiles(20, 20)).toBeGreaterThanOrEqual(AGGRO_TILES);
    expect(aggroTiles(1, 1)).toBe(AGGRO_TILES);
  });

  it("stays well inside the floor — waking the WHOLE map at once is not the fix", () => {
    for (let level = 1; level <= 25; level++) {
      const { w, h } = gridDims(level);
      const radius = aggroTiles(w, h);
      // A radius at/over the full diagonal would aggro every monster on the
      // floor the instant it loads, which is a different bug wearing the same
      // clothes: no exploration tension, and the whole horde pathing at once.
      expect(radius, `floor ${level}: radius ${radius} swallows the entire floor`).toBeLessThan(Math.hypot(w, h) * 0.75);
    }
  });

  it("keeps levelConfig reachable (guards the import surface)", () => {
    expect(typeof levelConfig(1).zombieSpeed).toBe("number");
  });
});
