import { describe, it, expect } from "vitest";
import { authorFloor } from "./floor-authoring";
import { pickSpawnTile } from "./tide";
import { state } from "../state";
import { tileCenter, type Grid } from "../maze/generator";
import { TIDE_SPAWN_MAX_TILES, TIDE_SPAWN_MIN_TILES } from "../constants";

/**
 * CAN THE TIDE REACH THE KNIGHT ON A REAL FLOOR?
 *
 * tide.test.ts proves the placement RULE on a synthetic open grid. That is the
 * whole of the logic and none of the risk.
 *
 * The risk is geometric and lives entirely outside that file. The tide draws
 * from `plan.spawns`, and those tiles are placed by `maze/decorate.ts` on a
 * spacing grid at a minimum distance from the START — not from wherever the
 * knight happens to be ninety seconds later. If a floor outgrows the band, the
 * tide quietly switches off exactly where a player is most likely to be
 * farming, and the symptom is the dead floor the tide exists to prevent.
 *
 * WHAT THIS MEASURED, and what it changed:
 *
 * The first version of pickSpawnTile had no fallback — band or nothing. Run
 * against the shipping floors it reported 2-4% of standable tiles with no
 * spawn tile in the band at all, worst at depth as floors outgrow it, and on
 * those tiles the nearest one sat at a median of ~38 against a 34 cap. Across
 * six depths and three seeds, EVERY such tile was too-far; not one was ever
 * ringed by tiles that were all too near. That asymmetry is why the fix is a
 * nearest-tile fallback rather than a wider band: widening pushes every
 * ordinary reinforcement further out to serve a corner case.
 *
 * So there are two properties here and they are not the same property:
 *   §reach   the tide can ALWAYS find somewhere — the guarantee, no exceptions
 *   §band    …and it is the tight, preferred band nearly all of the time,
 *            which is the number that silently rots when floors are rescaled
 */

const T_FLOOR_ID = 1;
const T_STAIRS_ID = 2;

function standable(g: Grid, i: number, j: number): boolean {
  const t = g.t[j * g.w + i];
  return t === T_FLOOR_ID || t === T_STAIRS_ID;
}

/** Put the knight on a tile, as buildLevel would. */
function standOn(g: Grid, i: number, j: number): void {
  const c = tileCenter(g, i, j);
  state.player = { x: c.x, z: c.z } as unknown as typeof state.player;
}

/**
 * The band, restated rather than imported. The point is to notice when the band
 * and the floors DRIFT apart — calling the implementation would make this
 * agree with whatever the implementation does, including the wrong thing.
 */
function inBand(px: number, pz: number, tx: number, tz: number): boolean {
  const d = Math.hypot(tx - px, tz - pz);
  return d >= TIDE_SPAWN_MIN_TILES && d <= TIDE_SPAWN_MAX_TILES;
}

/** Every 3rd tile in each axis — a ~9x sample, still thousands of positions
 *  per floor, and the geometry it measures does not vary tile-to-tile. */
const STRIDE = 3;

const LEVELS = [1, 3, 6, 10, 16, 24];
const SEEDS = [0x51a7, 0xbeef, 0x1234];

describe("the tide can reach the knight on a real floor", () => {
  it("always finds somewhere legal to spawn, from anywhere a player can stand", () => {
    const starved: string[] = [];
    const tooClose: string[] = [];
    for (const level of LEVELS) {
      for (const seed of SEEDS) {
        state.runSeed = seed;
        const { grid, plan } = authorFloor(level);
        state.grid = grid;
        state.tideTiles = plan.spawns;
        for (let j = 0; j < grid.h; j += STRIDE) {
          for (let i = 0; i < grid.w; i += STRIDE) {
            if (!standable(grid, i, j)) continue;
            standOn(grid, i, j);
            const spot = pickSpawnTile();
            if (!spot) {
              if (starved.length < 5) starved.push(`L${level} seed=${seed} @(${i},${j})`);
              continue;
            }
            // The minimum is the half that has no fallback and never bends:
            // nothing may surface inside the knight's aggro ring, ever.
            const d = Math.hypot(spot.x - state.player!.x, spot.z - state.player!.z);
            if (d < TIDE_SPAWN_MIN_TILES && tooClose.length < 5) {
              tooClose.push(`L${level} seed=${seed} @(${i},${j}) → ${d.toFixed(1)} tiles`);
            }
          }
        }
      }
    }
    expect(tooClose, `spawned inside the aggro ring:\n${tooClose.join("\n")}`).toHaveLength(0);
    expect(starved, `nowhere to spawn from:\n${starved.join("\n")}`).toHaveLength(0);
  });

  it("uses the tight preferred band for the overwhelming majority of positions", () => {
    const report: string[] = [];
    let worst = 1;
    for (const level of LEVELS) {
      for (const seed of SEEDS) {
        state.runSeed = seed;
        const { grid, plan } = authorFloor(level);
        const spawns = plan.spawns.map((s) => tileCenter(grid, s.i, s.j));
        let covered = 0;
        let total = 0;
        for (let j = 0; j < grid.h; j += STRIDE) {
          for (let i = 0; i < grid.w; i += STRIDE) {
            if (!standable(grid, i, j)) continue;
            const c = tileCenter(grid, i, j);
            total++;
            if (spawns.some((s) => inBand(c.x, c.z, s.x, s.z))) covered++;
          }
        }
        const share = covered / Math.max(1, total);
        if (share < worst) worst = share;
        if (share < 0.9) report.push(`L${level} seed=${seed}: only ${(share * 100).toFixed(1)}% in band`);
      }
    }
    // Measured 2026-08-05 across these 18 floors: worst case 96.2% (L10), and
    // the uncovered remainder is always too-FAR, served by the fallback. 90% is
    // the alarm, not the target — if a floor rescale or a TIDE_SPAWN_* retune
    // drags this down, the tide is running on its fallback as the normal case
    // and every reinforcement has a long walk before it reaches anyone.
    expect(report, `band coverage regressed:\n${report.join("\n")}`).toHaveLength(0);
    expect(worst).toBeGreaterThan(0.9);
  });
});
