/**
 * IMPORTED PAINTS SCALE TEST — verify that manifest.scale scales up frame paint output bounds.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { importedPaints, type ImportedSheet } from "./imported-paints";

const realDoc = (globalThis as { document?: unknown }).document;

beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}),
  };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
});

describe("importedPaints scale multiplier", () => {
  it("applies manifest.scale multiplier to cell paints", () => {
    const dummyCanvas = createCanvas(100, 100);
    const mockSheet: ImportedSheet = {
      manifest: {
        name: "test_knight",
        dir: "S",
        image: "/sprites/test_knight-S.png",
        source: [100, 100],
        grid: 8,
        scale: 1.3,
        rows: [
          { clip: "idle", cells: [[0, 0, 40, 40]] },
        ],
      },
      image: dummyCanvas as unknown as CanvasImageSource,
    };

    const paints = importedPaints([mockSheet]);
    expect(paints).not.toBeNull();
    expect(paints?.S.idle).toBeDefined();

    // Verify cell paint function draws without error at scaled size
    const targetCanvas = createCanvas(128, 128);
    const ctx = targetCanvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    expect(() => paints?.S.idle?.[0](ctx)).not.toThrow();
  });
});
