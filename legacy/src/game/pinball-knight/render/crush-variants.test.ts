/**
 * CRUSH VARIANT MEASUREMENT — a bench, not a gate.
 *
 * Asserts almost nothing and prints a table. Gated behind `CRUSH_AB=1` because
 * it paints the whole roster several times over; the shipping gate is
 * `render/monsters/noise.test.ts`.
 *
 *   CRUSH_AB=1 npx vitest run src/game/pinball-knight/render/crush-variants
 *
 * THE METRIC THAT DECIDES: `invented` — palette indices present in the atlas that
 * the painter never asked for, measured as `entries(atlas) \ declared(buffer)`.
 * NOT `isolated%` on its own: a filter that makes every sprite duller scores well
 * on isolation for the wrong reason, and would be adopted on that evidence.
 *
 * THE FALSIFIER: the ink share (palette index 1). The unsharp mask exists to keep
 * the 3.2-unit selout ink from averaging into the fill it separates. If turning it
 * off does NOT cost ink, its stated job is not being done and removing it is on
 * the table; if it does, the pass is load-bearing however ugly its side effects.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withCrushOptions, type CrushOptions } from "../engine/render/sprite";
import { installSpriteTestDom, rosterSubjects, censusSubject, SHIPPED_GRID, RUNGS } from "../testkit/atlas-census";
import { formatNoise, type NoiseRow } from "./atlas-census";

const RUN = process.env.CRUSH_AB === "1";

let restore = (): void => {};
beforeAll(() => { restore = installSpriteTestDom(); });
afterAll(() => { restore(); });

interface Arm { name: string; opts: Partial<CrushOptions> }

const ARMS: Arm[] = [
  // Arm A is whatever ships. Since 2026-07-29 that IS sharpen 0, so A and B
  // agree — keep both: A drifts with the default, B is pinned, and the day they
  // stop matching is the day someone changed the default without re-benching.
  { name: "A shipped defaults", opts: {} },
  { name: "B sharpen off (pinned)", opts: { sharpen: 0 } },
  { name: "R per-channel 1.3 (retired)", opts: { sharpen: 1.3 } },
  { name: "C sharpen 0.65", opts: { sharpen: 0.65 } },
  { name: "D luma-only 1.3", opts: { sharpen: 1.3, sharpenLuma: true } },
  { name: "E luma-only, selout off", opts: { sharpen: 1.3, sharpenLuma: true, selout: 0 } },
];

describe.skipIf(!RUN)("crush variants", () => {
  it("measures every arm across the roster at the shipped rung", () => {
    const subjects = rosterSubjects();
    const lines: string[] = [];
    for (const arm of ARMS) {
      const rows: NoiseRow[] = [];
      let inkTotal = 0;
      let opaqueTotal = 0;
      let inventedTotal = 0;
      withCrushOptions(arm.opts, () => {
        for (const s of subjects) {
          const st = censusSubject(s, SHIPPED_GRID);
          expect(st.unmatched, `${s.key}: off-palette texels in a crushed cell`).toBe(0);
          // ANTI-VACUITY. Every metric below is a ratio over opaque texels, so a
          // paint that silently produced nothing reports entries 0 / isolated 0 /
          // runLen 0 and sails through every assertion looking like a triumph.
          expect(st.opaque, `${s.key}: censused an EMPTY cell — the harness is broken, not the art`).toBeGreaterThan(500);
          rows.push({
            key: s.key,
            entries: st.entries,
            isolatedPct: st.isolatedPct,
            runLen: st.runLen,
            invented: st.inventedIdx.length,
          });
          inkTotal += st.counts[1];
          opaqueTotal += st.opaque;
          inventedTotal += st.inventedIdx.length;
        }
      });
      const meanIso = rows.reduce((a, r) => a + r.isolatedPct, 0) / rows.length;
      const meanRun = rows.reduce((a, r) => a + r.runLen, 0) / rows.length;
      const meanEnt = rows.reduce((a, r) => a + r.entries, 0) / rows.length;
      lines.push(
        `\n=== ${arm.name} ===\n${formatNoise(rows)}\n` +
          `MEAN entries ${meanEnt.toFixed(1)}  isolated ${meanIso.toFixed(1)}%  runLen ${meanRun.toFixed(2)}` +
          `  invented(total) ${inventedTotal}  INK SHARE ${((inkTotal / opaqueTotal) * 100).toFixed(2)}%`,
      );
    }
    console.log(lines.join("\n"));
  }, 300_000);

  it("shows how the shipped default compares across camera rungs", () => {
    const subjects = rosterSubjects();
    const lines: string[] = [];
    for (const grid of RUNGS) {
      const rows: NoiseRow[] = subjects.map((s) => {
        const st = censusSubject(s, grid);
        return { key: s.key, entries: st.entries, isolatedPct: st.isolatedPct, runLen: st.runLen, invented: st.inventedIdx.length };
      });
      const meanIso = rows.reduce((a, r) => a + r.isolatedPct, 0) / rows.length;
      const meanRun = rows.reduce((a, r) => a + r.runLen, 0) / rows.length;
      const meanEnt = rows.reduce((a, r) => a + r.entries, 0) / rows.length;
      lines.push(
        `\n=== grid ${grid}${grid === SHIPPED_GRID ? "  (SHIPPED DEFAULT)" : ""} ===\n${formatNoise(rows)}\n` +
          `MEAN entries ${meanEnt.toFixed(1)}  isolated ${meanIso.toFixed(1)}%  runLen ${meanRun.toFixed(2)}`,
      );
    }
    console.log(lines.join("\n"));
  }, 300_000);
});
