import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { state } from "../state";
import { getKnightSheet, loadImportedKnightArt, setImportedKnightPaintsForTest } from "./knight-sheets";
import { FULL_PLATE } from "./knight-look";
import type { ActorPaints } from "../engine/render/paint-types";

const realDoc = (globalThis as { document?: unknown }).document;

function ensureDoc(): void {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}),
  };
}

beforeAll(() => {
  ensureDoc();
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
});

describe("knight-sheets", () => {
  beforeEach(() => {
    ensureDoc();
    state.playerSheets.clear();
    setImportedKnightPaintsForTest(null);
  });

  it("builds a procedural knight sheet when imported art is not set", () => {
    const sheet = getKnightSheet("sword", FULL_PLATE, "dungeon");
    expect(sheet).toBeDefined();
    expect(sheet.texture).toBeDefined();
    expect(state.playerSheets.size).toBe(1);
  });

  it("uses imported pinball_knight paints when set", () => {
    const mockPaint = (ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = "#ff00ff";
      ctx.fillRect(0, 0, 10, 10);
    };
    const mockPaints: ActorPaints = {
      S: { idle: [mockPaint], walk: [mockPaint], attack: [mockPaint], death: [mockPaint] },
      N: { idle: [mockPaint], walk: [mockPaint], attack: [mockPaint], death: [mockPaint] },
      E: { idle: [mockPaint], walk: [mockPaint], attack: [mockPaint], death: [mockPaint] },
    };

    setImportedKnightPaintsForTest(mockPaints);
    const sheet = getKnightSheet("sword", FULL_PLATE, "dungeon");
    expect(sheet).toBeDefined();
    expect(state.playerSheets.size).toBe(1);
  });

  it("exports loadImportedKnightArt function", () => {
    expect(typeof loadImportedKnightArt).toBe("function");
  });
});
