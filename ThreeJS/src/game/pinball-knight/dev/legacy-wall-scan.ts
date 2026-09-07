/**
 * FROZEN ORACLE — maze/build.ts's original per-tile wall scan, verbatim.
 *
 * ── Why a second copy of code we already have ────────────────────────────────
 *
 * `maze/wall-runs.ts legacyTriage` is a REPLACEMENT for an inline loop that
 * used to live in `maze/build.ts`. The gate that says the replacement is
 * faithful (`maze/wall-runs.test.ts` G0) needs the thing being replaced, and
 * that thing was deleted from `build.ts` when `legacyTriage` landed. Until now
 * the gate stood in for it with `dev/fixtures/wall-legacy-triage.json` — 31
 * floors' worth of counts and digests, recorded once.
 *
 * A recorded digest pins TWO things at once: the triage function, and the FLOOR
 * GENERATOR that produced the grid it ran on. Change the generator on purpose —
 * as the machine-budget work did — and the fixture goes red for a reason that
 * has nothing to do with the triage. Worse, the cheap way out of that red is to
 * re-record the fixture from `legacyTriage` itself, which turns the parity gate
 * into a tautology: the function would be checked against its own output for
 * the rest of its life, and the day it drifts is the day the fixture drifts
 * with it.
 *
 * So the oracle is code, not data. This file is the original loop, transcribed
 * from `git show c9a05458:…/maze/build.ts` lines 1245-1301, and it runs on
 * whatever grid it is handed. It cannot go stale when the generator moves.
 *
 * ── DO NOT REFACTOR THIS FILE ────────────────────────────────────────────────
 *
 * Every duplication below is deliberate, and each one is a bug this oracle can
 * catch that a shared helper could not:
 *
 *   - the 8-way exposure test is written out longhand rather than calling
 *     `wall-runs.ts exposed()`;
 *   - the moss rule is `(i * 7 + j * 13) % 4 === 0` rather than `mossHash()`.
 *
 * Point either of them at the implementation under test and the gate stops
 * being able to fail. The only edits this file should ever take are ones that
 * bring it CLOSER to `build.ts@c9a05458`.
 *
 * It lives in `dev/` because nothing shipped may import it.
 */
import { type Grid, isWalkable, isLowWall, tileCenter, at, shapeAt, T_CRACKED, idx } from "../maze/generator";
import { isShaped, isArc, type TileShape } from "../engine/tile-shape";

export interface LegacyWallScan {
  fullCells: Array<{ x: number; z: number; i: number; j: number }>;
  mossCells: Array<{ x: number; z: number; i: number; j: number }>;
  lowCells: Array<{ x: number; z: number; i: number; j: number }>;
  southFaces: Array<{ x: number; z: number; i: number; j: number }>;
  slantCells: Array<{ x: number; z: number; i: number; j: number; shape: TileShape; low: boolean }>;
  arcRim: Map<number, boolean>;
}

/** build.ts@c9a05458, lines 1245-1301. Transcribed; not re-derived. */
export function legacyWallScan(grid: Grid): LegacyWallScan {
  const fullCells: LegacyWallScan["fullCells"] = [];
  const mossCells: LegacyWallScan["mossCells"] = [];
  const lowCells: LegacyWallScan["lowCells"] = [];
  const southFaces: LegacyWallScan["southFaces"] = [];
  const slantCells: LegacyWallScan["slantCells"] = [];
  const arcRim = new Map<number, boolean>();
  for (let j = 0; j < grid.h; j++) {
    for (let i = 0; i < grid.w; i++) {
      if (isWalkable(grid, i, j)) continue;
      if (at(grid, i, j) === T_CRACKED) continue; // secret bands get their own removable meshes below
      let exposed = false;
      for (let dj = -1; dj <= 1 && !exposed; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (isWalkable(grid, i + di, j + dj)) {
            exposed = true;
            break;
          }
        }
      }
      if (!exposed) continue;
      // The Diablo rule, isometric edition — see engine/grid.ts isLowWall. It
      // lives there rather than here because the croaker's hop reads it too,
      // and a frog clearing a wall this file drew full-height is a bug.
      const rim = isLowWall(grid, i, j);
      const cc = tileCenter(grid, i, j);
      const c = { x: cc.x, z: cc.z, i, j };
      // A SHAPED tile (slant prism / round shell) is built below, never a box.
      const shape = shapeAt(grid, i, j);
      if (isShaped(shape)) {
        if (isArc(shape)) {
          // A multi-tile arc slice — rendered as one feature shell below, not
          // per-tile. Remember whether ANY slice is camera-side rim so the
          // whole sweep takes the knee-high treatment (Diablo rule).
          const fid = grid.arcIdx ? grid.arcIdx[idx(grid, i, j)] : -1;
          if (fid >= 0) arcRim.set(fid, (arcRim.get(fid) ?? false) || rim);
        } else {
          slantCells.push({ x: cc.x, z: cc.z, i, j, shape, low: rim });
        }
        continue;
      }
      if (rim) {
        lowCells.push(c);
      } else if ((i * 7 + j * 13) % 4 === 0) {
        mossCells.push(c); // every ~4th tall wall grows moss — breaks up runs
      } else {
        fullCells.push(c);
      }
      // Tall walls with a corridor to their SOUTH show their big face to the
      // camera — those faces are where the architecture hangs.
      if (!rim && isWalkable(grid, i, j + 1)) southFaces.push({ x: c.x, z: c.z, i, j });
    }
  }
  return { fullCells, mossCells, lowCells, southFaces, slantCells, arcRim };
}
