/**
 * Emit a SPRITE SHEET in the shape `scripts/sprite_frames.py` expects.
 *
 *   SHEET_OUT=/abs/sheet.png npx vitest run src/game/pinball-knight/render/sheet-emit
 *
 * Not a test of the game — a fixture generator. It lays the roster's own painted
 * frames out on the same grid, at the same scale, on transparency, exactly as a
 * generated sheet arrives: smooth vector art at high resolution, no palette
 * discipline enforced, one creature per cell with a shared ground line.
 *
 * That makes the whole import pipeline runnable without the image service —
 * slicing by alpha bands, stray-blob cleanup, registration onto the painters'
 * contract, the palette snap and the census all get exercised on real input. It
 * also gives the A/B a CONTROL: run painted art through the generated-art
 * importer and you learn what the importer itself costs, separately from what
 * the model's drawing costs.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { writeFileSync } from "node:fs";
import { paintInArtSpace } from "../engine/render/sprite";
import { installSpriteTestDom } from "../testkit/atlas-census";
import { makeJesterPaints } from "./monsters/jester";
import type { FramePaint } from "../engine/render/paint-types";

const OUT = process.env.SHEET_OUT;

let restore = (): void => {};
beforeAll(() => { restore = installSpriteTestDom(); });
afterAll(() => { restore(); });

describe.skipIf(!OUT)("sheet fixture", () => {
  it("emits a 4-column sheet of painted frames on transparency", () => {
    const P = makeJesterPaints();
    const frames: FramePaint[] = [
      ...(P.E.idle ?? []).slice(0, 2),
      ...(P.E.walk ?? []).slice(0, 4),
      ...(P.E.attack ?? []).slice(0, 3),
      ...(P.E.death ?? []).slice(0, 4),
    ];
    expect(frames.length, "painter did not supply the default clip table").toBe(13);

    // A generous cell: the model is told to leave a wide margin, and the
    // importer slices on alpha rather than on a grid, so the gap between cells
    // just has to exceed its min-gap.
    const CELL = 320;
    const cols = 4;
    const rows = Math.ceil(frames.length / cols);
    const sheet = createCanvas(cols * CELL, rows * CELL);
    const ctx = sheet.getContext("2d") as unknown as CanvasRenderingContext2D;
    frames.forEach((f, i) => {
      const cell = createCanvas(CELL, CELL);
      const cctx = cell.getContext("2d") as unknown as CanvasRenderingContext2D;
      // Painted in ART space at cell resolution — smooth vector art, never
      // crushed. Feeding the importer pre-pixelated input would flatter it.
      paintInArtSpace(cctx, f, CELL);
      ctx.drawImage(cell as unknown as HTMLCanvasElement, (i % cols) * CELL, Math.floor(i / cols) * CELL);
    });

    // Anti-vacuity: a blank sheet slices into zero cells and every downstream
    // number would be computed on nothing.
    const data = ctx.getImageData(0, 0, sheet.width, sheet.height).data;
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 127) opaque++;
    expect(opaque, "emitted an EMPTY sheet").toBeGreaterThan(20_000);

    writeFileSync(OUT!, sheet.toBuffer("image/png"));
    console.log(`wrote ${OUT} (${sheet.width}x${sheet.height}, ${frames.length} frames, ${opaque} opaque px)`);
  }, 120_000);
});
