/**
 * THE TWO THINGS THE PLAYER SAID WERE WRONG WITH THE PLAYER SPRITE.
 *
 * Both were true, both had shipped green, and neither was reachable by any test
 * in this folder — `published.test.ts` asks whether the art reaches the game and
 * `mislabel.test.ts` asks whether a row is the clip it claims. Neither asks how
 * BIG the figure is or which way it is looking, so the knight could ship at 75%
 * of a painted actor's height with his head on backwards and every gate stayed
 * green.
 *
 *   1. "the sprite still looks like a blur" — the commit sized for the WIDEST
 *      camera rung, so the figure came out 32×60 texels at every zoom against
 *      the procedural knight's 47×80 at the default rung. See `FIT_GRID`.
 *   2. "the feet are left and the head is right" — `prep-knight.mjs`
 *      transplants an open-face head onto the closed-visor walk frames, and the
 *      donor (idle, head turned to the viewer's LEFT) faced the opposite way to
 *      the target (a ¾ profile STRIDING RIGHT). See `faceMirror`.
 *
 * Both are measured on the SHIPPED art rather than on the pipeline that made
 * it: a re-authored sheet, a hand-promoted commit or a prep that quietly loses
 * its sidecar all bypass the pipeline and none of them bypass this.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createCanvas, loadImage } from "canvas";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { installSpriteTestDom, SHIPPED_GRID, paintAtlas } from "../../testkit/atlas-census";
import { PALETTE_FAMILIES, PALETTE_HEX } from "../../render/palette";
import { makeKnightPaints } from "../../render/cel-painter";
import { FULL_PLATE } from "../../render/knight-look";
import { importedPaints, type ImportedSheet } from "../../render/imported-paints";
import type { SheetManifest } from "./manifest";
import type { ClipName, Dir } from "../../engine/render/paint-types";

const PUBLIC = join(__dirname, "..", "..", "..", "..", "..", "public", "sprites");
const SHEET = "pinball_knight";

let restore = (): void => {};
beforeAll(() => { restore = installSpriteTestDom(); });
afterAll(() => { restore(); });

async function load(dir: Dir): Promise<ImportedSheet> {
  const jsonPath = join(PUBLIC, `${SHEET}-${dir}.json`);
  const pngPath = join(PUBLIC, `${SHEET}-${dir}.png`);
  expect(existsSync(jsonPath) && existsSync(pngPath), `${SHEET}-${dir} is not published`).toBe(true);
  const manifest = JSON.parse(readFileSync(jsonPath, "utf8")) as SheetManifest;
  const image = (await loadImage(pngPath)) as unknown as CanvasImageSource;
  return { manifest, image };
}

/** Opaque bbox and texel count of one crushed cel. */
function inkOf(img: ImageData, grid: number): { w: number; h: number; opaque: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, opaque = 0;
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      if (img.data[(y * grid + x) * 4 + 3] <= 127) continue;
      opaque++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, opaque };
}

describe("the player sprite is as big as the actor standing next to it", () => {
  /**
   * Floors, not equalities, and both derived from the measurement that produced
   * the complaint rather than from the numbers that happen to ship today.
   *
   * At the default rung the procedural knight is 80 texels tall for 2301 opaque
   * texels. The imported knight was 60 / 1315 (75% and 57%) when the player
   * called it a blur, and is 71 / 1831 (89% and 80%) after `FIT_GRID` moved to
   * the default rung. A floor placed between those two states is the whole
   * assertion: it cannot be satisfied by the art that was complained about, and
   * it does not pin the exact output of a resample nobody promised to keep
   * bit-stable.
   */
  const MIN_HEIGHT_SHARE = 0.82;
  const MIN_INK_SHARE = 0.70;

  it("fills the cel to within a fifth of the painted knight, at the default rung", async () => {
    const paints = importedPaints([await load("S"), await load("N")], undefined, SHIPPED_GRID);
    expect(paints, "the published knight produced no paints").not.toBeNull();

    const painted = inkOf(paintAtlas(makeKnightPaints("sword", FULL_PLATE).S.idle![0], SHIPPED_GRID), SHIPPED_GRID);

    // Every LOCOMOTION frame, not just idle: `aliveScale`/`oneToOneScale` size
    // the whole sheet from one vote, so a walk row that shrank while idle held
    // its size is exactly the shape of defect this is here to catch.
    const complaints: string[] = [];
    let checked = 0;
    for (const clip of ["idle", "walk", "run"] as ClipName[]) {
      const frames = paints!.S[clip] ?? [];
      expect(frames.length, `the published knight has no S:${clip}`).toBeGreaterThan(0);
      frames.forEach((f, i) => {
        checked++;
        const ink = inkOf(paintAtlas(f, SHIPPED_GRID), SHIPPED_GRID);
        const hShare = ink.h / painted.h;
        const iShare = ink.opaque / painted.opaque;
        if (hShare < MIN_HEIGHT_SHARE || iShare < MIN_INK_SHARE) {
          complaints.push(
            `S:${clip}[${i}] ${ink.w}×${ink.h} texels / ${ink.opaque} opaque — ` +
              `${(hShare * 100).toFixed(0)}% of the painted knight's height, ${(iShare * 100).toFixed(0)}% of its ink`,
          );
        }
      });
    }
    expect(checked, "no locomotion frames were sampled — the assertion measured nothing").toBeGreaterThanOrEqual(9);
    expect(complaints, `at grid ${SHIPPED_GRID} the painted knight is ${painted.w}×${painted.h} / ${painted.opaque} opaque`)
      .toEqual([]);
  });
});

describe("the player sprite looks the way it is walking", () => {
  /** Exact palette match — the sheets are palette-locked, so skin is countable. */
  const SKIN = new Set(PALETTE_FAMILIES.skin.map((i) => PALETTE_HEX[i]));

  /**
   * A frame is only asked the question when its stance ANSWERS it.
   *
   * The signal is where the boots sit relative to the torso: a stride puts the
   * leading foot ahead of the body, a planted idle puts them under it. Measured
   * on the published sheet the walk frames lead by 1.4-3.1 texels and the idle
   * frames by 0.2-0.9 — so a frame under this threshold is not a weak stride,
   * it is a stance with no direction to disagree with, and scoring it would
   * turn boot-shading noise into a failure.
   */
  const STRIDE_MIN = 1.2;

  /** Where the face sits inside the head, and where the boots sit under the torso. */
  function facing(ctx: CanvasRenderingContext2D, cell: readonly number[], grid: number) {
    const [cx0, cy0, cx1, cy1] = cell;
    const w = Math.round((cx1 - cx0 + 1) / grid);
    const h = Math.round((cy1 - cy0 + 1) / grid);
    const small = createCanvas(w, h);
    const sctx = small.getContext("2d");
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(ctx.canvas as never, cx0, cy0, cx1 - cx0 + 1, cy1 - cy0 + 1, 0, 0, w, h);
    const px = sctx.getImageData(0, 0, w, h).data;

    const at = (x: number, y: number): number => (y * w + x) * 4;
    const opaque = (x: number, y: number): boolean => px[at(x, y) + 3] > 127;

    let y0 = h, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (opaque(x, y)) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (y1 < 0) return null;
    const tall = y1 - y0 + 1;

    // The head is the top 38% — the same fraction `prep-knight.mjs`'s `headBox`
    // uses to find the helmet, so the two agree on what a head is by
    // construction rather than by coincidence.
    const headEnd = y0 + 0.38 * tall;
    let hx0 = w, hx1 = -1, skinSum = 0, skinN = 0;
    for (let y = y0; y <= Math.min(y1, Math.floor(headEnd)); y++) {
      for (let x = 0; x < w; x++) {
        if (!opaque(x, y)) continue;
        if (x < hx0) hx0 = x;
        if (x > hx1) hx1 = x;
        const hex = (px[at(x, y)] << 16) | (px[at(x, y) + 1] << 8) | px[at(x, y) + 2];
        if (SKIN.has(hex)) { skinSum += x; skinN++; }
      }
    }
    const mean = (lo: number, hi: number): number | null => {
      let s = 0, n = 0;
      for (let y = Math.max(y0, Math.floor(lo)); y <= Math.min(y1, Math.ceil(hi)); y++)
        for (let x = 0; x < w; x++) if (opaque(x, y)) { s += x; n++; }
      return n ? s / n : null;
    };
    const boots = mean(y1 - 0.15 * tall, y1);
    const torso = mean(y0 + 0.35 * tall, y0 + 0.65 * tall);
    if (!skinN || hx1 < 0 || boots === null || torso === null) return null;
    return { face: skinSum / skinN - (hx0 + hx1) / 2, stride: boots - torso };
  }

  it("the head and the feet point the same way in every stride frame", async () => {
    const complaints: string[] = [];
    let checked = 0;
    for (const dir of ["S", "N"] as Dir[]) {
      const { manifest, image } = await load(dir);
      const canvas = createCanvas((image as { width: number }).width, (image as { height: number }).height);
      const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
      ctx.drawImage(image as never, 0, 0);
      const grid = manifest.grid ?? 1;

      for (const row of manifest.rows) {
        if (row.clip !== "walk" && row.clip !== "run") continue;
        row.cells.forEach((cell, i) => {
          const m = facing(ctx, cell, grid);
          // The N sheet's helm shows no skin at all — a back view has no face
          // to disagree with the feet, and `facing` returns null rather than
          // inventing a direction from zero samples.
          if (!m || Math.abs(m.stride) < STRIDE_MIN) return;
          checked++;
          if (Math.sign(m.face) !== Math.sign(m.stride)) {
            complaints.push(
              `${dir}:${row.clip}[${i}] — face ${m.face >= 0 ? "+" : ""}${m.face.toFixed(2)} texels from the head's ` +
                `centre, boots ${m.stride >= 0 ? "+" : ""}${m.stride.toFixed(2)} from the torso: he is looking back ` +
                `over his shoulder`,
            );
          }
        });
      }
    }
    expect(checked, "no stride frame carried a face — the assertion measured nothing").toBeGreaterThanOrEqual(3);
    expect(complaints).toEqual([]);
  });
});
