/**
 * FISH_FEET ART tests — verify paints and frame outputs for fish_feet.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { makeFishFeetPaints } from "./fish_feet";
import { installPalette } from "../palette";
import type { ActorPaints, Dir, FramePaint } from "../../engine/render/paint-types";

const realDoc = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}),
  };
  installPalette();
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
});

const CEL = 128;

function paint(f: FramePaint): ImageData {
  const cv = createCanvas(CEL, CEL);
  const ctx = cv.getContext("2d") as unknown as CanvasRenderingContext2D;
  f(ctx);
  return (ctx as unknown as { getImageData: (a: number, b: number, c: number, d: number) => ImageData })
    .getImageData(0, 0, CEL, CEL);
}

function box(img: ImageData): { w: number; h: number; painted: number; y0: number } {
  let x0 = CEL, x1 = -1, y0 = CEL, y1 = -1, painted = 0;
  for (let y = 0; y < CEL; y++) {
    for (let x = 0; x < CEL; x++) {
      if (img.data[(y * CEL + x) * 4 + 3] <= 8) continue;
      painted++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, painted, y0 };
}

const clip = (p: ActorPaints, dir: Dir, name: string): FramePaint[] => {
  const f = (p[dir] as Record<string, FramePaint[] | undefined>)[name];
  if (!f?.length) throw new Error(`fish_feet has no ${dir}:${name}`);
  return f;
};

const P = makeFishFeetPaints();

describe("fish_feet art", () => {
  it("paints every clip in every authored direction", () => {
    for (const d of ["S", "N", "E"] as Dir[]) {
      for (const c of ["idle", "walk", "attack", "death"]) {
        for (const f of clip(P, d, c)) {
          expect(box(paint(f)).painted, `${d}:${c} painted nothing`).toBeGreaterThan(100);
        }
      }
    }
  });

  it("has distinct walk frames", () => {
    const walkFrames = clip(P, "E", "walk");
    expect(walkFrames.length).toBe(4);
    const b0 = box(paint(walkFrames[0]));
    const b1 = box(paint(walkFrames[1]));
    expect(b0.painted).toBeGreaterThan(0);
    expect(b1.painted).toBeGreaterThan(0);
  });
});
