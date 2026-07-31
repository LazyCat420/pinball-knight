/**
 * DOES AN IMPORTED FRAME COME OUT THE OTHER END OF THE REAL PIPELINE?
 *
 * The claim this module makes is that an image-backed `FramePaint` is
 * indistinguishable from a painted one to everything downstream. That is
 * checkable without a browser: build paints from a manifest, run one through
 * the SAME `paintInArtSpace` → `crushToGrid` path the atlas builder uses, and
 * census the result against the live palette.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas } from "canvas";
import { importedPaints, type ImportedSheet } from "./imported-paints";
import { installSpriteTestDom, SHIPPED_GRID, bufferFor } from "../testkit/atlas-census";
import { censusCell, paletteRgb } from "./atlas-census";
import { crushToGrid, paintInArtSpace } from "../engine/render/sprite";
import type { SheetManifest } from "../tools/sprite-forge/manifest";

let restore = (): void => {};
beforeAll(() => { restore = installSpriteTestDom(); });
afterAll(() => { restore(); });

/** A sheet of solid blocks, one per cell — enough to be crushed and censused. */
function fakeSheet(rows: { clip: string; n: number }[]): ImportedSheet {
  const CELL = 100;
  const cols = Math.max(...rows.map((r) => r.n));
  const w = cols * CELL;
  const h = rows.length * CELL;
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  rows.forEach((r, ri) => {
    for (let ci = 0; ci < r.n; ci++) {
      ctx.fillStyle = ["#c0392b", "#e0a030", "#3c6e71", "#8e5ea2"][ri % 4];
      ctx.fillRect(ci * CELL + 10, ri * CELL + 10, CELL - 20, CELL - 20);
    }
  });
  const manifest: SheetManifest = {
    name: "fake", dir: "S", image: "/sprites/fake-S.png", source: [w, h],
    rows: rows.map((r, ri) => ({
      clip: r.clip,
      cells: Array.from({ length: r.n }, (_, ci) =>
        [ci * CELL + 10, ri * CELL + 10, ci * CELL + CELL - 11, ri * CELL + CELL - 11] as
          [number, number, number, number]),
    })),
  };
  return { manifest, image: c as unknown as CanvasImageSource };
}

describe("importedPaints", () => {
  it("maps each row to its clip", () => {
    const p = importedPaints([fakeSheet([{ clip: "idle", n: 2 }, { clip: "walk", n: 4 }])]);
    expect(p).not.toBeNull();
    expect(p?.S.idle).toHaveLength(2);
    expect(p?.S.walk).toHaveLength(4);
  });

  it("drops rows that are not ClipNames", () => {
    // `hurt` is the name every reference sheet prints; the engine calls it
    // `stumble`. Packing it under a name nothing plays would give an actor no
    // stagger and no error to explain it.
    const p = importedPaints([fakeSheet([{ clip: "idle", n: 2 }, { clip: "hurt", n: 2 }])]);
    expect(p?.S.idle).toHaveLength(2);
    expect(Object.keys(p?.S ?? {})).not.toContain("hurt");
  });

  it("refuses a sheet with no idle", () => {
    // withRecoil derives stagger and wake from idle[0], and the animator falls
    // back to it for any unauthored clip. Without one there is no actor.
    expect(importedPaints([fakeSheet([{ clip: "walk", n: 4 }])])).toBeNull();
  });

  it("reuses the authored facing for the others, BY REFERENCE", () => {
    const p = importedPaints([fakeSheet([{ clip: "idle", n: 2 }])]);
    // Identity, not equality: startSpriteSheet dedupes on FramePaint identity,
    // so sharing the object is what keeps one sheet from packing three times.
    expect(p?.N.idle?.[0]).toBe(p?.S.idle?.[0]);
    expect(p?.E.idle?.[0]).toBe(p?.S.idle?.[0]);
  });
});

describe("an imported frame through the real crush", () => {
  it("lands on the palette, opaque, at the shipped rung", () => {
    const p = importedPaints([fakeSheet([{ clip: "idle", n: 2 }])]);
    const paint = p?.S.idle?.[0];
    expect(paint).toBeTruthy();

    const G = SHIPPED_GRID;
    const px = bufferFor(G);
    const buf = createCanvas(px, px);
    const ctx = buf.getContext("2d") as unknown as CanvasRenderingContext2D;
    paintInArtSpace(ctx, paint!, px);
    const cell = crushToGrid(buf as unknown as HTMLCanvasElement, G);
    const img = (cell.getContext("2d") as unknown as CanvasRenderingContext2D).getImageData(0, 0, G, G);
    const st = censusCell(img.data, G, paletteRgb());

    // Non-empty, and every texel is a real palette entry — the same two
    // assertions the forge makes about its own output. If an imported paint
    // could not satisfy these it would not be equivalent to a painter, which is
    // the entire premise.
    expect(st.opaque).toBeGreaterThan(20);
    expect(st.unmatched).toBe(0);
  });

  it("is registered on the ground line, not floating", () => {
    const p = importedPaints([fakeSheet([{ clip: "idle", n: 2 }])]);
    const G = SHIPPED_GRID;
    const px = bufferFor(G);
    const buf = createCanvas(px, px);
    const ctx = buf.getContext("2d") as unknown as CanvasRenderingContext2D;
    paintInArtSpace(ctx, p!.S.idle![0], px);
    const d = (ctx as unknown as { getImageData(a: number, b: number, c: number, e: number): ImageData })
      .getImageData(0, 0, px, px).data;
    let lowest = -1;
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) if (d[(y * px + x) * 4 + 3] > 8) { lowest = y; break; }
    }
    // GROUND is 118 of the 128-unit art box; the blit puts the cell's lowest
    // ink there. Allow a texel of resample slop.
    expect(lowest / px).toBeGreaterThan(118 / 128 - 0.02);
    expect(lowest / px).toBeLessThan(118 / 128 + 0.02);
  });
});
