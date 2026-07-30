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
    // RAGGED ROWS, ON PURPOSE, with a row that does not start at column 1 —
    // matching a real supplied sheet (4 / 6 / 4 / 2 / 3, HURT indented). A
    // fixture with tidy equal rows would not exercise the slicer's actual job.
    const pick = (clip: FramePaint[] | undefined, n: number): FramePaint[] =>
      Array.from({ length: n }, (_, i) => (clip ?? [])[i % Math.max(1, (clip ?? []).length)]).filter(Boolean);
    const ROWS: { label: string; frames: FramePaint[]; indent: number }[] = [
      { label: "IDLE", frames: pick(P.E.idle, 4), indent: 0 },
      { label: "SPRING ATTACK", frames: pick(P.E.attack, 6), indent: 0 },
      { label: "WALK", frames: pick(P.E.walk, 4), indent: 0 },
      { label: "HURT", frames: pick(P.E.death, 2), indent: 1 },
      { label: "DEATH", frames: pick(P.E.death, 3), indent: 0 },
    ];
    const frames = ROWS.flatMap((r) => r.frames);
    expect(frames.length, "fixture rows did not fill").toBe(19);

    // A generous cell: the model is told to leave a wide margin, and the
    // importer slices on alpha rather than on a grid, so the gap between cells
    // just has to exceed its min-gap.
    const CELL = 260;
    const CAPTION = 34;
    const cols = Math.max(...ROWS.map((r) => r.frames.length + r.indent));
    const sheet = createCanvas(cols * CELL, ROWS.length * (CELL + CAPTION));
    const ctx = sheet.getContext("2d") as unknown as CanvasRenderingContext2D;
    ctx.textAlign = "center";
    ROWS.forEach((row, ri) => {
      const top = ri * (CELL + CAPTION);
      row.frames.forEach((f, ci) => {
        const x = (ci + row.indent) * CELL;
        // RULED CELL BORDER — opaque, spanning the sheet, exactly the thing that
        // makes a naive alpha-slice return one giant cell.
        ctx.strokeStyle = "#9aa4b4";
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, top + 1, CELL - 2, CELL - 2);
        const cell = createCanvas(CELL, CELL);
        const cctx = cell.getContext("2d") as unknown as CanvasRenderingContext2D;
        // Painted in ART space at cell resolution — smooth vector art, never
        // crushed. Feeding the importer pre-pixelated input would flatter it.
        paintInArtSpace(cctx, f, CELL);
        ctx.drawImage(cell as unknown as HTMLCanvasElement, x, top);
      });
      // ROW CAPTION, on the background between rows — the other thing a naive
      // slicer imports as a pose.
      ctx.fillStyle = "#2b303b";
      ctx.font = "bold 22px sans-serif";
      ctx.fillText(row.label, (cols * CELL) / 2, top + CELL + 24);
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
