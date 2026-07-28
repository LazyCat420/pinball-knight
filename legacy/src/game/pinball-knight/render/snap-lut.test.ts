/**
 * THE SNAP TABLE IS THE OLD SCAN, EXACTLY.
 *
 * `crushToGrid` used to find each texel's palette entry by scanning all 32
 * colours. That inner loop is essentially the whole cost of the atlas build,
 * which runs synchronously during a boot a headless run already measures in the
 * thirties of seconds, so it is now a lookup table (engine/render/sprite.ts).
 *
 * A table that is merely CLOSE would be a silent art change: a centre-sampled
 * one puts ~2% of texels on the second-nearest entry, which looks the same and
 * is not the same. The table therefore refuses to answer for cells it cannot
 * prove, and this test is the proof: every texel of a representative slice of
 * the roster, snapped both ways, byte for byte.
 *
 * It paints real frames, so it states its own timeout rather than inheriting
 * the global 30s — a suite sitting near its budget is a deploy hazard on a
 * loaded box.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { PALETTE_HEX, PALETTE_SIZE, paletteToFloatArray, paletteCss } from "./palette";
import { setEnginePalette } from "../engine/palette-source";
import { crushToGrid, invalidatePaletteCaches } from "../engine/render/sprite";
import { makeZombiePaints, makeSpiderPaints, makeGhostPaints, makeGoblinPaints, withRecoil, ZOMBIE_VARIANTS, ITEM_PAINTS } from "./cel-painter";
import { makeKnightPaints } from "./cel-painter";
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
/** The dither matrix and amplitude crushToGrid uses — restated, not imported,
 *  so a change to either shows up here as a failure rather than as agreement. */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((r) => r.map((v) => v / 16 - 0.5));
const AMP = 10;

/** The original implementation: downscale, alpha cutout, dither, linear scan. */
function crushByScan(src: any): Uint8ClampedArray {
  const g = SPRITE_PIXEL_GRID;
  const cv = createCanvas(g, g);
  const ctx = cv.getContext("2d") as any;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, g, g);
  const im = ctx.getImageData(0, 0, g, g);
  const d = im.data;
  for (let py = 0; py < g; py++) {
    for (let px = 0; px < g; px++) {
      const i = (py * g + px) * 4;
      if (d[i + 3] < 128) {
        d[i + 3] = 0;
        continue;
      }
      const bias = BAYER[py & 3][px & 3] * AMP;
      let best = 0;
      let bd = Infinity;
      for (let p = 0; p < PAL.length; p++) {
        const dr = (d[i] + bias - PAL[p][0]) * 0.3;
        const dg = (d[i + 1] + bias - PAL[p][1]) * 0.59;
        const db = (d[i + 2] + bias - PAL[p][2]) * 0.11;
        const q = dr * dr + dg * dg + db * db;
        if (q < bd) {
          bd = q;
          best = p;
        }
      }
      d[i] = PAL[best][0];
      d[i + 1] = PAL[best][1];
      d[i + 2] = PAL[best][2];
      d[i + 3] = 255;
    }
  }
  return d;
}

function paint(f: FramePaint): any {
  const cv = createCanvas(SPRITE_PX, SPRITE_PX);
  const c = cv.getContext("2d") as any;
  c.imageSmoothingEnabled = true;
  f(c);
  return cv;
}

describe("the palette snap lookup table", () => {
  it("REGRESSION: is byte-identical to the 32-entry scan it replaced", () => {
    const frames: FramePaint[] = [];
    const sets = [
      withRecoil(makeZombiePaints(ZOMBIE_VARIANTS[0])),
      withRecoil(makeSpiderPaints()),
      withRecoil(makeGhostPaints()),
      withRecoil(makeGoblinPaints()),
      makeKnightPaints("sword", FULL_PLATE),
    ];
    for (const p of sets) {
      for (const dir of ["S", "N", "E"] as const) {
        for (const list of Object.values(p[dir] as Record<string, FramePaint[] | undefined>)) {
          if (list) frames.push(...list);
        }
      }
    }
    frames.push(ITEM_PAINTS.coin, ITEM_PAINTS.helmet);

    let texels = 0;
    let mismatched = 0;
    for (const f of frames) {
      const src = paint(f);
      const got = (crushToGrid(src) as any).getContext("2d").getImageData(0, 0, SPRITE_PIXEL_GRID, SPRITE_PIXEL_GRID).data;
      const want = crushByScan(paint(f));
      for (let i = 0; i < want.length; i += 4) {
        if (want[i + 3] === 0) continue;
        texels++;
        if (got[i] !== want[i] || got[i + 1] !== want[i + 1] || got[i + 2] !== want[i + 2]) mismatched++;
      }
    }
    expect(texels, "the harness painted nothing — the comparison is vacuous").toBeGreaterThan(100_000);
    expect(mismatched, `${mismatched} of ${texels} texels moved to a different palette entry`).toBe(0);
  }, 60_000);
});
