/**
 * BALL CLIPS — the ordinary ride vs the Ball Form potion.
 *
 * Regression: the steel sphere was first wired as the visual for EVERY momentum
 * ride, so the knight never tumbled again — the potion's transformation had no
 * identity because it was already the default. `ball` must stay the spinning
 * tucked knight; `steelball` is the potion only (player.ts gates on ironT).
 */
import { describe, expect, it } from "vitest";
import { createCanvas } from "canvas";
import { makeKnightPaints } from "./cel-painter";
import { FULL_PLATE } from "./knight-look";

describe("the knight keeps a spinning-figure ball clip", () => {
  const paints = makeKnightPaints("sword", FULL_PLATE);

  it("authors BOTH clips, four frames each, for every facing", () => {
    for (const dir of ["S", "N", "E"] as const) {
      expect(paints[dir].ball, `${dir}:ball`).toHaveLength(4);
      expect(paints[dir].steelball, `${dir}:steelball`).toHaveLength(4);
    }
  });

  it("draws them DIFFERENTLY — steelball is not just the knight again", () => {
    // Rasterise frame 0 of each through node-canvas (a devDependency, so this
    // asserts for real headlessly rather than skipping without a DOM).
    const px = (paint: (c: CanvasRenderingContext2D) => void) => {
      const cv = createCanvas(128, 128);
      const ctx = cv.getContext("2d");
      paint(ctx as unknown as CanvasRenderingContext2D);
      return ctx.getImageData(0, 0, 128, 128).data;
    };
    const a = px(paints.S.ball![0]);
    const b = px(paints.S.steelball![0]);
    let diff = 0;
    for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 3] !== b[i + 3]) diff++;
    // Thousands of pixels differ between a tucked figure and a chrome sphere.
    expect(diff).toBeGreaterThan(500);
  });
});
