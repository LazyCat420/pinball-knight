/**
 * TINTED RESKINS MUST STAY ON THE PALETTE.
 *
 * The expansion roster borrows another monster's atlas and re-dyes it. The
 * first implementation dyed with `sprite.setTint` — a live GPU multiply by a
 * free RGB value — which pushed every palette-exact texel OFF the palette and
 * left the screen quantizer to reassign each pixel to whatever family was
 * nearest: the sapper rendered as flat yellow mush with dissolved ink, the
 * necromancer as blood red on a warm floor. The dye is now BAKED
 * (`bakeTintedSheet`): multiplied once on the CPU and snapped back through the
 * same LUT the crush uses.
 *
 * What is pinned here:
 *   1. Every EXPANSION_SKIN kind's baked atlas is 100% palette-exact — the
 *      property that makes the post chain a no-op on the monster's body.
 *   2. The bake actually CHANGED the sheet (a tint of white would pass #1
 *      while silently shipping the base monster's colours).
 *   3. The bake is cached — one atlas per kind, not one per spawn.
 *   4. Layout is shared verbatim: same clips map, frame count and grid, so the
 *      animator drives a baked sheet exactly like the base one.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { PALETTE_HEX, PALETTE_SIZE, paletteToFloatArray, paletteCss } from "../render/palette";
import { setEnginePalette } from "../engine/palette-source";
import { bakeTintedSheet, invalidatePaletteCaches } from "../engine/render/sprite";
import { EXPANSION_SKIN } from "./factory";
import { state, type EnemyKind } from "../state";

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

const PAL = new Set(PALETTE_HEX.map((h) => `${(h >> 16) & 255},${(h >> 8) & 255},${h & 255}`));

interface Stats { total: number; offPalette: number; changed: number }
function compareSheets(base: HTMLCanvasElement, baked: HTMLCanvasElement): Stats {
  const bctx = (base.getContext("2d") as unknown as { getImageData: (a: number, b: number, c: number, d: number) => ImageData });
  const kctx = (baked.getContext("2d") as unknown as { getImageData: (a: number, b: number, c: number, d: number) => ImageData });
  const a = bctx.getImageData(0, 0, base.width, base.height).data;
  const b = kctx.getImageData(0, 0, base.width, base.height).data;
  const s: Stats = { total: 0, offPalette: 0, changed: 0 };
  for (let i = 0; i < b.length; i += 4) {
    if (b[i + 3] <= 127) continue; // below the alphaTest cutout — GPU never shows it
    s.total++;
    if (!PAL.has(`${b[i]},${b[i + 1]},${b[i + 2]}`)) s.offPalette++;
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) s.changed++;
  }
  return s;
}

describe("bakeTintedSheet", () => {
  it("keeps every expansion kind's atlas 100% palette-exact, and actually dyes it", () => {
    for (const [kind, skin] of Object.entries(EXPANSION_SKIN)) {
      const base = skin.sheet();
      expect(base, `${kind}: base sheet`).toBeTruthy();
      const baked = bakeTintedSheet(base!, skin.tint);
      const stats = compareSheets(base!.texture.image as HTMLCanvasElement, baked.texture.image as HTMLCanvasElement);
      expect(stats.total, `${kind}: opaque pixels`).toBeGreaterThan(1000);
      // #1 — the whole point. One off-palette pixel is one the quantizer will
      // reinterpret under lighting; the count must be ZERO, not merely small.
      expect(stats.offPalette, `${kind}: off-palette pixels after bake`).toBe(0);
      // #2 — the dye visibly landed. Every tint in the table is saturated
      // enough that well over a tenth of the body must change entries.
      expect(stats.changed / stats.total, `${kind}: fraction re-dyed`).toBeGreaterThan(0.1);
      // #4 — layout shared verbatim.
      expect(baked.clips).toBe(base!.clips);
      expect(baked.frameCount).toBe(base!.frameCount);
      expect(baked.cols).toBe(base!.cols);
      expect(baked.rows).toBe(base!.rows);
    }
  });

  it("is cached by makeExpansion — one baked atlas per kind", async () => {
    // makeExpansion needs a scene to attach sprites to; a bare Object3D-ish
    // stub is enough for the two adds this test performs.
    const { makeExpansion } = await import("./factory");
    const added: unknown[] = [];
    state.scene = { add: (o: unknown) => added.push(o), remove: () => {} } as never;
    state.expansionSheets = {};
    const a = makeExpansion("wisp" as EnemyKind, 1, 1, 1);
    const b = makeExpansion("wisp" as EnemyKind, 2, 2, 1);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(state.expansionSheets.wisp, "cached sheet").toBeTruthy();
    expect(a!.sprite.sheet, "both spawns share the baked sheet").toBe(b!.sprite.sheet);
    // The dye lives in the art now — a damage-flash restore must go to null,
    // not re-apply a tint over the baked colours.
    expect(a!.baseTint ?? null).toBeNull();
    state.scene = null as never;
    state.expansionSheets = {};
  });
});
