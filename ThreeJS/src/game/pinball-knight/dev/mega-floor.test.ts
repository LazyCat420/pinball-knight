/**
 * THE ANTI-DRIFT GATE for the mega map.
 *
 * `dev/headless-floor.ts` records what this test exists to prevent, measured:
 * `buildHeadlessFloor` and the shipped chain agreed on **0 of 15** (level, seed)
 * pairs, because the harness had quietly grown an extra stage that drew from the
 * shared rng. A harness that re-implements the pipeline drifts, and it drifts in
 * the direction that hides the bug.
 *
 * ── WHAT THIS GATE IS NOW, AND WHY IT CHANGED ──────────────────────────────
 *
 * `buildMegaFloor` WAS a second such re-implementation, and this gate caught it
 * drifting for real on 2026-09-06: `buildHeadlessPlan` was fixed to pass
 * `track.chambers` and `track.doorways` and to run `authorLampPuzzle`, the mega
 * builder was not, and the parts lists came apart on three braziers. The fix
 * was not to transcribe the three stages a second time — it was to delete the
 * transcription. Both harnesses now call `authorHeadlessPlan`.
 *
 * So this no longer guards two copies of a draw order against each other; there
 * is one copy, and drift of that kind is now impossible rather than merely
 * detected. What it still genuinely checks is the OPTION MAPPING, which is the
 * only thing left that can be wrong: `scale: 1` must resolve to the level's own
 * shipped cell grid, and `density: "raw"` must resolve to the shipped budget
 * formula with the flat counts unscaled. Get either wrong and the two calls
 * diverge here exactly as they did before.
 *
 * That identity is also what makes the census's SCALE CHECK meaningful: the
 * "shipped" column is produced by this same function, so a difference between
 * the columns is a difference in GRID SIZE and nothing else.
 */
import { describe, it, expect } from "vitest";
import { buildMegaFloor } from "./mega-floor";
import { buildHeadlessPlan } from "./headless-floor";
import { levelConfig } from "../constants";

/** Levels 1-5 cover all five archetypes; the seeds are the census's own. */
const LEVELS = [1, 2, 3, 4, 5];
const SEEDS = [1, 424242, 0x6057];

describe("buildMegaFloor", () => {
  it("at scale 1 with the raw budget IS buildHeadlessPlan, floor for floor", () => {
    let compared = 0;
    for (const level of LEVELS) {
      for (const runSeed of SEEDS) {
        const mine = buildMegaFloor({ level, runSeed, scale: 1, density: "raw" });
        const theirs = buildHeadlessPlan(level, runSeed);
        // A declined floor is a legitimate outcome, but both must decline
        // together — one declining alone is already a drift.
        expect(!!mine, `L${level}/${runSeed} decline disagreement`).toBe(!!theirs);
        if (!mine || !theirs) continue;
        compared++;

        const where = `L${level} seed ${runSeed}`;
        expect(mine.grid.w, `${where} grid w`).toBe(theirs.grid.w);
        expect(mine.grid.h, `${where} grid h`).toBe(theirs.grid.h);
        // The tile array is the whole floor. Comparing a digest of it rather
        // than a summary statistic is deliberate: walkable count is equal for
        // many different floors, and this test's job is to catch the case where
        // the count survives and the layout does not.
        expect(Array.from(mine.grid.t), `${where} tiles`).toEqual(Array.from(theirs.grid.t));
        expect(Array.from(mine.grid.shapes), `${where} shapes`).toEqual(Array.from(theirs.grid.shapes));
        expect(mine.start, `${where} start`).toEqual(theirs.start);
        expect(mine.stairs, `${where} stairs`).toEqual(theirs.stairs);
        expect(mine.modifier, `${where} modifier`).toBe(theirs.modifier);
        expect(mine.walkable, `${where} walkable`).toBe(theirs.walkable);
        // Parts carry the rng's whole tail: kind, position and facing all come
        // from draws made after the grid was carved.
        expect(
          mine.plan.parts.map((p) => `${p.kind}@${p.i},${p.j}:${p.dirI},${p.dirJ}`),
          `${where} parts`,
        ).toEqual(theirs.plan.parts.map((p) => `${p.kind}@${p.i},${p.j}:${p.dirI},${p.dirJ}`));
        expect(mine.plan.spawns.length, `${where} spawns`).toBe(theirs.plan.spawns.length);
        expect((mine.grid.arcs ?? []).length, `${where} arcs`).toBe((theirs.grid.arcs ?? []).length);
      }
    }
    // An empty comparison is a failed test, not a clean one — the same trap
    // `floor-census.mjs` guards against when it refuses to bless an empty
    // capture.
    expect(compared, "compared no floors at all").toBeGreaterThanOrEqual(LEVELS.length * SEEDS.length - 2);
  });

  it("scale 1 is the level's own shipped cell grid", () => {
    for (const level of LEVELS) {
      const cfg = levelConfig(level);
      const f = buildMegaFloor({ level, runSeed: 7, scale: 1 });
      if (!f) continue;
      expect(f.cellsW).toBe(cfg.cellsW);
      expect(f.cellsH).toBe(cfg.cellsH);
    }
  });

  it("grows past the shipped cap that levelConfig clamps at 96x72", () => {
    // The whole point of the module: `levelConfig` saturates, and this does not.
    const f = buildMegaFloor({ level: 5, runSeed: 0x6057, cellsW: 130, cellsH: 96 });
    expect(f).not.toBeNull();
    expect(f!.grid.w).toBe(130 * 2 + 1);
    expect(f!.grid.h).toBe(96 * 2 + 1);
    expect(f!.areaRatio).toBeGreaterThan(3);
  });

  it("holds part DENSITY across scales, which is what `shipped` means", () => {
    // `raw` dilutes because the level term is a flat count on a bigger floor;
    // that dilution is exactly why `shipped` is the default, and a regression
    // here would quietly make every mega map sparser than the game.
    const ref = buildMegaFloor({ level: 5, runSeed: 0x6057, scale: 1, density: "raw" })!;
    const big = buildMegaFloor({ level: 5, runSeed: 0x6057, scale: 2.5, density: "shipped" })!;
    const raw = buildMegaFloor({ level: 5, runSeed: 0x6057, scale: 2.5, density: "raw" })!;
    const per1k = (f: typeof ref) => (f.plan.parts.length * 1000) / f.walkable;
    expect(per1k(big) / per1k(ref)).toBeGreaterThan(0.6);
    expect(per1k(big) / per1k(ref)).toBeLessThan(1.7);
    expect(per1k(raw)).toBeLessThan(per1k(big));
  });
});
