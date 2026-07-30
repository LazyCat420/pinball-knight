/**
 * CONTACT SHEET for the crush A/B. Writes a PNG; asserts nothing.
 *
 *   CRUSH_SHEET=/abs/path.png npx vitest run src/game/pinball-knight/render/crush-sheet
 *
 * Numbers decide which arm is CLEANER; they cannot decide whether it still reads
 * as the creature. The sharpen was added to stop the roster looking "soft
 * airbrushed", and no isolated-pixel count measures that — so an arm never ships
 * on the table alone.
 *
 * Cells are the real atlas cell, nearest-upscaled. Anything else is concept art.
 */

import { describe, it, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { writeFileSync } from "node:fs";
import { withCrushOptions, type CrushOptions } from "../engine/render/sprite";
import { installSpriteTestDom, rosterSubjects, censusFrames, paintAtlas, SHIPPED_GRID } from "../testkit/atlas-census";

const OUT = process.env.CRUSH_SHEET;

let restore = (): void => {};
beforeAll(() => { restore = installSpriteTestDom(); });
afterAll(() => { restore(); });

const ARMS: { name: string; opts: Partial<CrushOptions> }[] = [
  { name: "A today", opts: {} },
  { name: "B sharp off", opts: { sharpen: 0 } },
  { name: "C sharp .65", opts: { sharpen: 0.65 } },
  { name: "D luma 1.3", opts: { sharpen: 1.3, sharpenLuma: true } },
];

const SHOW = ["brute", "jester", "rotortail", "stiltneck", "croaker", "chomper", "hound", "goblin"];

describe.skipIf(!OUT)("crush contact sheet", () => {
  it("writes an atlas-true A/B sheet", () => {
    const G = SHIPPED_GRID;
    const Z = 4;                      // nearest upscale
    const cell = G * Z;
    const pad = 8;
    const labelW = 110;
    const subjects = rosterSubjects().filter((s) => SHOW.includes(s.key));
    const w = labelW + subjects.length * (cell + pad) + pad;
    const h = 26 + ARMS.length * (cell + pad) + pad;
    const out = createCanvas(w, h);
    const ctx = out.getContext("2d");
    ctx.fillStyle = "#14161c";
    ctx.fillRect(0, 0, w, h);
    ctx.font = "13px sans-serif";
    ctx.fillStyle = "#cfd6e4";
    subjects.forEach((s, i) => ctx.fillText(s.key, labelW + i * (cell + pad), 18));

    ARMS.forEach((arm, r) => {
      const y = 26 + r * (cell + pad);
      ctx.fillStyle = "#cfd6e4";
      ctx.fillText(arm.name, 6, y + cell / 2);
      withCrushOptions(arm.opts, () => {
        subjects.forEach((s, i) => {
          const f = censusFrames(s.paints)[0];
          const img = paintAtlas(f, G);
          const src = createCanvas(G, G);
          (src.getContext("2d") as unknown as CanvasRenderingContext2D).putImageData(img, 0, 0);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(src, labelW + i * (cell + pad), y, cell, cell);
        });
      });
    });
    writeFileSync(OUT!, out.toBuffer("image/png"));
    console.log(`wrote ${OUT} (${w}x${h})`);
  }, 300_000);
});
