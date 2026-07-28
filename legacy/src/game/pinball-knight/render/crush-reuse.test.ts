/**
 * THE SHARED CRUSH CANVAS MUST NOT REACH A CALLER THAT KEEPS IT.
 *
 * `paintFrame` crushes 824 atlas frames per load, and it used to allocate two
 * fresh canvases for every one of them (1,828 per `/dungeon` load). Those are
 * pooled now — see `crushToGridShared` in engine/render/sprite.ts.
 *
 * The pooling is only safe because the retaining callers were left alone.
 * `staticTexture()` does `new THREE.CanvasTexture(crushToGrid(canvas))` and
 * caches the result for the session: hand THAT the shared canvas and every
 * cached item texture silently becomes whichever sprite was crushed last. The
 * tavern shop's icons would all turn into the same picture, and it would read
 * as an art bug — nobody would look for it in a perf change.
 *
 * So this file pins the contract in both directions:
 *   1. `crushToGrid` returns a canvas the caller OWNS — two calls never alias,
 *      and an earlier result is not disturbed by a later crush.
 *   2. The frames within one atlas actually differ, which is what proves the
 *      pooled paint scratch is being CLEARED between frames rather than
 *      compositing each pose on top of the last.
 *
 * (1) is the trap. (2) is the bug you would ship if you pooled the scratch and
 * forgot the clearRect.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { PALETTE_HEX, PALETTE_SIZE, paletteToFloatArray, paletteCss } from "./palette";
import { setEnginePalette } from "../engine/palette-source";
import { crushToGrid, invalidatePaletteCaches, buildSpriteSheet } from "../engine/render/sprite";
import { makeSpiderPaints, makeGoblinPaints, withRecoil, ITEM_PAINTS } from "./cel-painter";
import { SPRITE_PX, SPRITE_PIXEL_GRID } from "../constants";
import type { SpriteSheet } from "../engine/render/sprite";
import type { FramePaint } from "../engine/render/paint-types";

/** The atlas bitmap lives on the texture — SpriteSheet exposes no canvas field. */
function atlasCanvas(sheet: SpriteSheet): HTMLCanvasElement {
  return sheet.texture.image as unknown as HTMLCanvasElement;
}

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

/** Paint one FramePaint onto a fresh SPRITE_PX box, the way paintFrame does. */
function paintBox(paint: FramePaint): HTMLCanvasElement {
  const cv = createCanvas(SPRITE_PX, SPRITE_PX) as unknown as HTMLCanvasElement;
  const ctx = (cv as unknown as { getContext(k: string): CanvasRenderingContext2D }).getContext("2d");
  ctx.imageSmoothingEnabled = true;
  paint(ctx);
  return cv;
}

/** Content fingerprint of a canvas, so "same art" is a value, not a vibe. */
function fingerprint(cv: HTMLCanvasElement): string {
  const ctx = (cv as unknown as { getContext(k: string): CanvasRenderingContext2D }).getContext("2d");
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let h = 2166136261;
  for (let i = 0; i < d.length; i += 4) {
    h ^= d[i]; h = Math.imul(h, 16777619);
    h ^= d[i + 1]; h = Math.imul(h, 16777619);
    h ^= d[i + 3]; h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

describe("crushToGrid ownership (the retaining-caller trap)", () => {
  it("returns a DISTINCT canvas per call — never a shared one", () => {
    const a = crushToGrid(paintBox(ITEM_PAINTS.coin));
    const b = crushToGrid(paintBox(ITEM_PAINTS.health));
    expect(a).not.toBe(b);
  });

  it("does not mutate an earlier result when a later crush runs", () => {
    // This is exactly the staticTexture cache's usage: crush, HOLD the canvas,
    // crush something else, and expect the held one to be untouched.
    const coin = crushToGrid(paintBox(ITEM_PAINTS.coin));
    const before = fingerprint(coin);

    crushToGrid(paintBox(ITEM_PAINTS.health));
    crushToGrid(paintBox(ITEM_PAINTS.gold));

    expect(fingerprint(coin)).toBe(before);
  });

  it("gives two different painters two different pictures", () => {
    // The failure this catches is every cached icon rendering as the last
    // sprite crushed — which is a hash COLLISION, not a crash.
    const coin = fingerprint(crushToGrid(paintBox(ITEM_PAINTS.coin)));
    const health = fingerprint(crushToGrid(paintBox(ITEM_PAINTS.health)));
    expect(coin).not.toBe(health);
  });
});

describe("pooled paint scratch is cleared between frames", () => {
  /**
   * THE ORACLE IS THE UNPOOLED PATH, not "the frames look different".
   *
   * The first version of this test asserted that an atlas's walk frames hash
   * differently from one another. That assertion cannot fail: delete the
   * `clearRect` and every frame composites onto the previous one, so they still
   * differ — they are just each wrong. Measured, not assumed: with the clear
   * removed, that test passed.
   *
   * So compare against something that cannot drift with the code under test.
   * Each cell of the pooled atlas must be byte-identical to crushing that same
   * frame through `crushToGrid`, which allocates its own canvas every call and
   * therefore has no cross-frame state to leak.
   */
  it("every pooled atlas cell equals the same frame crushed in isolation", () => {
    const paints = withRecoil(makeSpiderPaints());
    const sheet = buildSpriteSheet(paints);
    const ctx = (atlasCanvas(sheet) as unknown as { getContext(k: string): CanvasRenderingContext2D }).getContext("2d");
    const g = SPRITE_PIXEL_GRID;

    // South-facing walk: several distinct poses, drawn consecutively, so a
    // scratch that failed to clear shows up on the second cell onward.
    const walk = sheet.clips.get("S:walk");
    expect(walk?.length ?? 0).toBeGreaterThan(1);

    const poses = paints.S?.walk;
    expect(poses?.length ?? 0).toBe(walk!.length);

    for (let n = 0; n < walk!.length; n++) {
      const idx = walk![n];
      const col = idx % sheet.cols;
      const row = Math.floor(idx / sheet.cols);
      const packed = ctx.getImageData(col * g, row * g, g, g).data;

      // The independent answer: fresh paint box, fresh crush canvas.
      const solo = crushToGrid(paintBox(poses![n]));
      const soloCtx = (solo as unknown as { getContext(k: string): CanvasRenderingContext2D }).getContext("2d");
      const expected = soloCtx.getImageData(0, 0, g, g).data;

      let diff = 0;
      for (let i = 0; i < expected.length; i++) if (packed[i] !== expected[i]) diff++;
      expect(diff, `walk frame ${n} differs from its isolated crush in ${diff} bytes`).toBe(0);
    }
  });

  it("builds two different monsters as two different atlases", () => {
    const spider = buildSpriteSheet(withRecoil(makeSpiderPaints()));
    const goblin = buildSpriteSheet(withRecoil(makeGoblinPaints()));
    expect(fingerprint(atlasCanvas(spider))).not.toBe(fingerprint(atlasCanvas(goblin)));
  });
});
