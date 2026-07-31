/**
 * READING A FRAME OUT OF A PACKED ATLAS MUST FOLLOW THE ROWS.
 *
 * Atlases wrap into rows once a single strip would pass the GPU's texture width
 * (see the `cols` comment in `sprite.ts`). A reader written against the OLD
 * single-row layout asks for `(f * GRID, 0)`; for any frame past the first row
 * that is off the right edge of the canvas, and `getImageData` answers with
 * FULLY TRANSPARENT PIXELS rather than an error.
 *
 * Which is why this is worth a test at all: the failure is silent and it looks
 * like nothing. The title intro cut its knight frames that way, so the knight
 * did not paint for the whole 2D act — his contact shadow, the parallax, the
 * HUD gag and the bonk all rendered correctly around an empty rectangle. It
 * survived because `intro/index.ts` had no caller from the day the packing
 * changed; the first live run after wiring it back in is what showed it.
 *
 * The atlas here is SYNTHETIC on purpose — one flat colour per cell, so "did
 * this frame come from the right cell" is a single pixel comparison and not a
 * judgement about art.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { SPRITE_PIXEL_GRID } from "../../constants";
import { cutFrameStrip } from "./sprite";

const realDoc = (globalThis as { document?: unknown }).document;
beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (t: string) => (t === "canvas" ? createCanvas(1, 1) : {}),
  };
});
afterAll(() => {
  (globalThis as { document?: unknown }).document = realDoc;
});

const G = SPRITE_PIXEL_GRID;

/** Frame `i` is painted rgb(i, 0, 0) — its index, readable back as a pixel. */
function atlas(cols: number, frames: number): HTMLCanvasElement {
  const rows = Math.ceil(frames / cols);
  const c = createCanvas(cols * G, rows * G);
  const ctx = c.getContext("2d");
  for (let i = 0; i < frames; i++) {
    ctx.fillStyle = `rgb(${i}, 0, 0)`;
    ctx.fillRect((i % cols) * G, Math.floor(i / cols) * G, G, G);
  }
  return c as unknown as HTMLCanvasElement;
}

/** The red channel at the centre of strip cell `i` — i.e. which frame landed. */
function frameAt(strip: HTMLCanvasElement, i: number): { r: number; a: number } {
  const ctx = (strip as unknown as ReturnType<typeof createCanvas>).getContext("2d");
  const d = ctx.getImageData(i * G + G / 2, G / 2, 1, 1).data;
  return { r: d[0], a: d[3] };
}

describe("cutFrameStrip", () => {
  it("reads a frame from the FIRST row", () => {
    const strip = cutFrameStrip(atlas(8, 20), [3]);
    expect(frameAt(strip, 0)).toEqual({ r: 3, a: 255 });
  });

  it("reads a frame from a LATER row — the case that silently returned nothing", () => {
    // Frame 11 in an 8-wide atlas is row 1, column 3. The old reader asked for
    // x = 11*GRID on row 0, which is past the right edge: transparent.
    const strip = cutFrameStrip(atlas(8, 20), [11]);
    expect(frameAt(strip, 0)).toEqual({ r: 11, a: 255 });
  });

  it("keeps the requested ORDER, across rows", () => {
    const strip = cutFrameStrip(atlas(8, 40), [9, 2, 33, 0]);
    expect([0, 1, 2, 3].map((i) => frameAt(strip, i).r)).toEqual([9, 2, 33, 0]);
  });

  it("is opaque for every frame it was asked for — nothing comes back blank", () => {
    // THE PROPERTY THE INTRO NEEDED. Every cell of the synthetic atlas is a
    // solid fill, so a transparent strip cell can only mean the read missed.
    const frames = [0, 7, 8, 15, 16, 31, 39];
    const strip = cutFrameStrip(atlas(8, 40), frames);
    for (const [i, f] of frames.entries()) {
      const px = frameAt(strip, i);
      expect(px.a, `frame ${f} (row ${Math.floor(f / 8)}) came back transparent`).toBe(255);
      expect(px.r).toBe(f);
    }
  });

  it("handles a genuinely single-row atlas unchanged", () => {
    // The layout the old code assumed still has to work — most sheets are one
    // row, which is exactly why the bug hid.
    const strip = cutFrameStrip(atlas(16, 16), [0, 5, 15]);
    expect([0, 1, 2].map((i) => frameAt(strip, i).r)).toEqual([0, 5, 15]);
  });
});
