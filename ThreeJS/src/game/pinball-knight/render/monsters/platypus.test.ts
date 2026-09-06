import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { makePlatypusPaints } from "./platypus";
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

function countPainted(img: ImageData): number {
  let count = 0;
  for (let i = 3; i < img.data.length; i += 4) {
    if (img.data[i] > 8) count++;
  }
  return count;
}

describe("Iron Platypus Cel-Painter", () => {
  it("provides non-empty frames for all facings and key clips", () => {
    const paints = makePlatypusPaints();
    const facings: Dir[] = ["S", "N", "E"];
    const clips = ["idle", "walk", "attack", "stumble", "death"] as const;

    for (const dir of facings) {
      const face = paints[dir];
      expect(face, `facing ${dir} defined`).toBeDefined();

      for (const clip of clips) {
        const frames = face[clip];
        expect(frames, `clip ${dir}:${clip} defined`).toBeDefined();
        if (!frames) continue;
        expect(frames.length, `clip ${dir}:${clip} has frames`).toBeGreaterThanOrEqual(2);

        for (let i = 0; i < frames.length; i++) {
          const img = paint(frames[i]);
          const pixels = countPainted(img);
          expect(pixels, `facing ${dir}, clip ${clip}, frame ${i} has painted pixels`).toBeGreaterThan(50);
        }
      }
    }
  });

  it("renders ground slam attack with impact features on the final attack frame", () => {
    const paints = makePlatypusPaints();
    const attackFrames = paints.S.attack;
    expect(attackFrames).toBeDefined();
    if (!attackFrames) return;
    expect(attackFrames.length).toBe(4);

    const windup = paint(attackFrames[0]);
    const impact = paint(attackFrames[3]);

    expect(countPainted(windup)).toBeGreaterThan(100);
    expect(countPainted(impact)).toBeGreaterThan(100);
  });
});
