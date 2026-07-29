/**
 * THE SNAP TABLE IS THE OLD SCAN, EXACTLY — and the crush only emits palette.
 *
 * `crushToGrid` used to find each texel's palette entry by scanning all 32
 * colours. That inner loop is essentially the whole cost of the atlas build,
 * which runs synchronously during a boot a headless run already measures in the
 * thirties of seconds, so it is now a lookup table (engine/render/sprite.ts).
 *
 * A table that is merely CLOSE would be a silent art change: a centre-sampled
 * one puts ~2% of texels on the second-nearest entry, which looks the same and
 * is not the same. The table therefore refuses to answer for cells it cannot
 * prove, and the first test here is the proof.
 *
 * ── WHY THIS FILE WAS REWRITTEN (2026-07-29) ────────────────────────────────
 *
 * It used to prove that by restating the ENTIRE surrounding crush pipeline —
 * downscale, alpha cutout, dither matrix, amplitude — and diffing whole crushed
 * frames against it. Two things were wrong with that, and the sharpening pass
 * exposed both at once:
 *
 *   1. It failed on a change to the DOWNSCALE, which is not what it tests. The
 *      lookup table was untouched and correct the whole time.
 *   2. The restatement was a hand-maintained mirror of production code, i.e.
 *      the same trap as `ALL_KEYS` in boot/lazy-sheets.test.ts — honest only for
 *      as long as someone remembers to update it in lockstep.
 *
 * So the claim is now tested where it lives: `snapColor` against a linear scan,
 * over a dense sweep of the colour cube. That is strictly stronger than the old
 * version (which only covered whatever colours a handful of frames happened to
 * contain) and it cannot rot when the pipeline around it changes.
 *
 * The second test is new, and exists because of a bug this suite did not catch:
 * a normalisation slip in the rewritten downscale made every texel transparent,
 * and the atlas built ENTIRELY BLANK with 1,386 tests still green. A pipeline
 * that produces no pixels, or pixels outside the palette, is now a failure
 * rather than something you have to notice by looking.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { PALETTE_HEX, PALETTE_SIZE, paletteToFloatArray, paletteCss } from "./palette";
import { setEnginePalette } from "../engine/palette-source";
import { crushToGrid, invalidatePaletteCaches, snapColor } from "../engine/render/sprite";
import { makeKnightPaints, makeSpiderPaints, makeGoblinPaints, ITEM_PAINTS } from "./cel-painter";
import { FULL_PLATE } from "./knight-look";
import { SPRITE_PX, SPRITE_PIXEL_GRID } from "../constants";
import type { FramePaint } from "../engine/render/paint-types";

const realDoc = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}),
  };
  setEnginePalette({ size: PALETTE_SIZE, toFloatArray: paletteToFloatArray, hex: () => PALETTE_HEX, css: paletteCss, occlusionIndex: 30 });
  invalidatePaletteCaches();
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
});

const PAL = PALETTE_HEX.map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]);

/** The original implementation: a linear scan of all 32 entries. */
function scan(r: number, g: number, b: number): number {
  let best = 0;
  let bd = Infinity;
  for (let p = 0; p < PAL.length; p++) {
    const dr = (r - PAL[p][0]) * 0.3;
    const dg = (g - PAL[p][1]) * 0.59;
    const db = (b - PAL[p][2]) * 0.11;
    const q = dr * dr + dg * dg + db * db;
    if (q < bd) { bd = q; best = p; }
  }
  return best;
}

describe("the palette snap lookup table", () => {
  it("REGRESSION: answers exactly what the 32-entry scan it replaced would", () => {
    let checked = 0;
    let mismatched = 0;
    const check = (r: number, g: number, b: number): void => {
      checked++;
      if (snapColor(r, g, b) !== scan(r, g, b)) mismatched++;
    };

    // A stride-5 lattice. Deliberately NOT the LUT's own cell centres (stride 4,
    // offset 2), which the table computed directly and would pass trivially —
    // the whole claim is about colours OFF the centre, where a merely-close
    // table would answer for the wrong entry.
    for (let r = 0; r < 256; r += 5) {
      for (let g = 0; g < 256; g += 5) {
        for (let b = 0; b < 256; b += 5) check(r, g, b);
      }
    }
    // The palette entries themselves and their immediate neighbourhoods — the
    // densest part of the distribution a real cel presents.
    const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);
    for (const [r, g, b] of PAL) {
      check(r, g, b);
      for (const d of [-3, -1, 1, 3]) {
        check(clamp(r + d), g, b);
        check(r, clamp(g + d), b);
        check(r, g, clamp(b + d));
      }
    }
    // Deterministic pseudo-random probes (no Math.random — a flaky art test is
    // worse than no art test).
    let seed = 0x9e3779b9;
    for (let i = 0; i < 30_000; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      check(seed & 255, (seed >>> 8) & 255, (seed >>> 16) & 255);
    }

    expect(checked).toBeGreaterThan(150_000);
    expect(mismatched, `${mismatched} of ${checked} colours snapped to a different palette entry`).toBe(0);
  }, 60_000);

  it("emits a non-empty sprite whose every opaque texel is a palette colour", () => {
    const frames: FramePaint[] = [
      makeKnightPaints("sword", FULL_PLATE).S.idle![0],
      makeSpiderPaints().S.idle![0],
      makeGoblinPaints().S.walk![0],
      ITEM_PAINTS.coin,
    ];
    const allowed = new Set(PALETTE_HEX);
    for (const f of frames) {
      const cv = createCanvas(SPRITE_PX, SPRITE_PX);
      f(cv.getContext("2d") as unknown as CanvasRenderingContext2D);
      const out = (crushToGrid(cv as unknown as HTMLCanvasElement) as unknown as {
        getContext: (s: string) => { getImageData: (a: number, b: number, c: number, d: number) => ImageData };
      }).getContext("2d").getImageData(0, 0, SPRITE_PIXEL_GRID, SPRITE_PIXEL_GRID).data;
      let opaque = 0;
      let bad = 0;
      for (let i = 0; i < out.length; i += 4) {
        if (out[i + 3] === 0) continue;
        opaque++;
        // The crush writes 0 or 255 and nothing between — a partial alpha means
        // the hard cutout stopped happening and the silhouette is feathered.
        if (out[i + 3] !== 255) bad++;
        else if (!allowed.has((out[i] << 16) | (out[i + 1] << 8) | out[i + 2])) bad++;
      }
      // 200, not 400: the smallest thing in the list is the coin, which really
      // is only ~380 texels. The bug this guards against produces ZERO, so the
      // bar only has to sit clear of the floor, not close to the smallest real
      // sprite — a tight bound here would just be a second thing to retune.
      expect(opaque, "the crush produced a BLANK cel").toBeGreaterThan(200);
      expect(bad, "texels escaped the palette or the alpha cutout").toBe(0);
    }
  }, 30_000);
});
