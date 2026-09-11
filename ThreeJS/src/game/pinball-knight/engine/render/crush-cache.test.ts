/**
 * The crushed-cell cache: a FramePaint that has been crushed once at a given
 * palette is a drawImage on the next build, never a paint and a readback.
 *
 * This is what makes a knight re-dress on a gear pickup cheap: the imported
 * clips are stable FramePaint functions, so the second sheet that uses them
 * reads nothing back (docs/perf/maze-lag-audit.md measured 4-156 ms per
 * readback during play).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas, CanvasRenderingContext2D as NodeCtx } from "canvas";
import { PALETTE_HEX, PALETTE_SIZE, paletteToFloatArray, paletteCss } from "../../render/palette";
import { setEnginePalette } from "../palette-source";
import { buildSpriteSheet, invalidatePaletteCaches } from "./sprite";
import type { ActorPaints, FramePaint } from "./paint-types";

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

/** Count getImageData calls made anywhere while `fn` runs. */
function countReadbacks(fn: () => void): number {
  const proto = NodeCtx.prototype as unknown as { getImageData: (...a: unknown[]) => unknown };
  const orig = proto.getImageData;
  let n = 0;
  proto.getImageData = function (this: unknown, ...a: unknown[]) { n++; return orig.apply(this, a); };
  try { fn(); } finally { proto.getImageData = orig; }
  return n;
}

function blob(hue: number): FramePaint {
  return (ctx) => { ctx.fillStyle = `hsl(${hue} 60% 50%)`; ctx.beginPath(); ctx.ellipse(64, 80, 30, 36, 0, 0, Math.PI * 2); ctx.fill(); };
}

function paints(frames: FramePaint[]): ActorPaints {
  const clips = { idle: frames };
  return { S: clips, N: clips, E: clips };
}

describe("crushed-cell cache", () => {
  it("reads back once per distinct paint, and never again for the same paint at the same palette", () => {
    const frames = [blob(20), blob(120), blob(220)];
    const first = countReadbacks(() => buildSpriteSheet(paints(frames)));
    expect(first).toBeGreaterThanOrEqual(frames.length);
    const second = countReadbacks(() => buildSpriteSheet(paints(frames)));
    // The strip's own palette lock may read the finished sheet; no CELL reads back.
    expect(second).toBeLessThan(first);
    expect(second).toBeLessThanOrEqual(1);
  });

  it("does not confuse two paints or two palettes", () => {
    const a = blob(40), b = blob(300);
    buildSpriteSheet(paints([a]));
    const fresh = countReadbacks(() => buildSpriteSheet(paints([b])));
    expect(fresh).toBeGreaterThanOrEqual(1);
    const otherPal = countReadbacks(() => buildSpriteSheet(paints([a]), { sheetPalette: [[10, 200, 30]] }));
    expect(otherPal).toBeGreaterThanOrEqual(1);
  });

  it("produces the same pixels from the cache as from a fresh crush", () => {
    const f = blob(200);
    const s1 = buildSpriteSheet(paints([f]));
    const s2 = buildSpriteSheet(paints([f]));
    const c1 = s1.texture.image as unknown as { getContext(k: "2d"): { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } };
    const c2 = s2.texture.image as typeof c1;
    const w = (s1.texture.image as { width: number }).width, h = (s1.texture.image as { height: number }).height;
    const d1 = c1.getContext("2d").getImageData(0, 0, w, h).data;
    const d2 = c2.getContext("2d").getImageData(0, 0, w, h).data;
    expect(Buffer.compare(Buffer.from(d1.buffer), Buffer.from(d2.buffer))).toBe(0);
  });
});
