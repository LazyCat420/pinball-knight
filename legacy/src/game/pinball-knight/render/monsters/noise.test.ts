/**
 * THE SPRITE NOISE GATE — the roster's confetti budget, measured on the atlas.
 *
 * Every other art test in this tree asserts something about ONE monster. This
 * one asserts the property the whole roster shares: a sprite is made of RUNS,
 * and noise is runs of one. It exists because "the monsters look noisy" was a
 * complaint nobody could act on for months — there was no number, so every
 * proposed fix was an opinion.
 *
 * Metrics and their edge cases are defined in `render/atlas-census.ts`; read
 * them there before changing a bound, because the bounds are meaningless
 * without them.
 *
 * ── WHY THREE RUNGS AND NOT THE AMBIENT ONE ──
 * `SPRITE_PIXEL_GRID` is a PLAYER SETTING (`CAMERA_ZOOMS`: 90/81/72/63/54),
 * captured at module load. Asserting on whatever the test process happens to
 * boot at turns this guard OFF for anyone who picked a different camera — the
 * trap `atlas-size.test.ts` documents. 54 / 63 / 90 spans the range; 72 and 81
 * are interior on all three metrics and buy nothing for the runtime.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { installSpriteTestDom, rosterSubjects, censusSubject, SHIPPED_GRID } from "../../testkit/atlas-census";
import { formatNoise, type NoiseRow } from "../atlas-census";

let restore = (): void => {};
beforeAll(() => { restore = installSpriteTestDom(); });
afterAll(() => { restore(); });

/** The rungs the gate runs at. */
const RUNGS = [54, SHIPPED_GRID, 90];

/**
 * Roster-wide ceilings, per rung.
 *
 * MEASURED 2026-07-29 across all 20 actors, after the unsharp mask was retired
 * (see the table on `CRUSH_DEFAULTS` in engine/render/sprite.ts). Each value is
 * the worst observed, rounded outward for headroom — these are CEILINGS meant to
 * catch a new painter shipping confetti, not a description of the current state.
 * The per-monster ratchet is `noise-baseline.json`'s job, not this one.
 *
 * The numbers get worse as the grid gets smaller, because the same art is being
 * crushed harder — which is exactly why a single ambient bound cannot work.
 */
const CEILING: Record<number, { entries: number; isolatedPct: number; runLen: number }> = {
  54: { entries: 34, isolatedPct: 52, runLen: 1.2 },
  63: { entries: 34, isolatedPct: 45, runLen: 1.25 },
  90: { entries: 36, isolatedPct: 42, runLen: 1.3 },
};

describe("sprite noise budget", () => {
  for (const grid of RUNGS) {
    it(`stays inside the confetti budget at grid ${grid}`, () => {
      const cap = CEILING[grid];
      const rows: NoiseRow[] = [];
      const over: string[] = [];
      let best = Infinity;

      for (const s of rosterSubjects()) {
        const st = censusSubject(s, grid);
        // ANTI-VACUITY, per subject. Every metric here is a ratio over opaque
        // texels, so a paint that silently produced nothing reports entries 0,
        // isolated 0, runLen 0 — and sails through every ceiling below looking
        // like the cleanest sprite in the game.
        expect(st.opaque, `${s.key}: censused an EMPTY cell at grid ${grid}`).toBeGreaterThan(300);
        // The crush snaps every kept texel, so an off-palette one means the
        // filter changed underneath us — and it would silently deflate `entries`.
        expect(st.unmatched, `${s.key}: off-palette texels at grid ${grid}`).toBe(0);

        rows.push({ key: s.key, entries: st.entries, isolatedPct: st.isolatedPct, runLen: st.runLen, invented: st.inventedIdx.length });
        if (st.entries > cap.entries || st.isolatedPct > cap.isolatedPct || st.runLen < cap.runLen) over.push(s.key);
        best = Math.min(best, st.isolatedPct);
      }

      // Report the WHOLE table, then assert once. Asserting inside the loop
      // would abort at the first offender and hide the other nineteen — and the
      // point of a roster census is seeing which monster drifted RELATIVE to its
      // neighbours.
      expect(over, `\ngrid ${grid} — over budget:\n${formatNoise(rows)}`).toEqual([]);

      // ANTI-VACUITY, roster-wide. A ceiling accidentally set to infinity passes
      // everything; requiring the CLEANEST monster to sit well inside it proves
      // the bound is somewhere near the data it is supposed to bound.
      expect(best, `cleanest monster is ${best.toFixed(1)}% isolated against a ${cap.isolatedPct}% ceiling — the ceiling is not measuring anything`)
        .toBeLessThan(cap.isolatedPct * 0.75);
    }, 120_000);
  }
});
