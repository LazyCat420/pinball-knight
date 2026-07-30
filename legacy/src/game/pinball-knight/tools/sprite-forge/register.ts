/**
 * REGISTRATION — a sliced cell onto the painters' contract, then through the
 * real crush.
 *
 * This is the stage that decides where an imported figure STANDS and how BIG it
 * is, and both answers have to match what a painter would have produced, or the
 * import reads as a different creature at a different scale on the same floor.
 *
 * Extracted from `sprite-ingest.test.ts`. Behaviour is unchanged; the two magic
 * numbers that were inline are now named and the third comes from the engine.
 */
import { crushToGrid } from "../../engine/render/sprite";
import { CX, GROUND } from "../../engine/render/figure";
import type { Cell } from "./slice";

/**
 * The painters' cel box. Everything an actor draws is placed in a 128×128 art
 * space with the feet on `GROUND` and the body centred on `CX`; the rasteriser
 * scales that box to `SPRITE_PX` for whatever rung is live.
 */
export const ART_SPACE = CX * 2;

/**
 * The box an imported figure is allowed to fill inside the cel, in art units.
 *
 * Slightly under the full 128 on both axes: a painter's silhouette is authored
 * to leave room for its own selout and contact shadow, and an imported figure
 * scaled to the full box would be visibly the largest thing on the floor. These
 * are ingest's own numbers, not an engine contract — the engine only fixes
 * `GROUND` and `CX`.
 */
export const ART_W = 108;
export const ART_H = 110;

/**
 * ONE uniform scale for the WHOLE sheet.
 *
 * Per-cell normalisation is the obvious alternative and it is wrong: it makes
 * the flipbook pulse, because every frame would be scaled to its own extent and
 * a crouched pose would inflate to the same height as a standing one. So the
 * scale is set by the sheet's most extreme frame and every other frame pays for
 * it — which is exactly why a sheet must not waste its extent on an extended
 * spring or a projectile that has already left the actor.
 */
export function sheetScale(cells: readonly Cell[], px: number): number {
  const unit = px / ART_SPACE;
  const maxW = Math.max(...cells.map(([x0, , x1]) => x1 - x0 + 1));
  const maxH = Math.max(...cells.map(([, y0, , y1]) => y1 - y0 + 1));
  return Math.min((ART_W * unit) / maxW, (ART_H * unit) / maxH);
}

/**
 * Blit one source cell into a fresh pre-crush buffer, centred and grounded.
 *
 * ⚠️ REGISTRATION IS BY BOUNDING BOX, not by the figure's feet. The cell is
 * centred on its own opaque extent and its LOWEST ink is planted on `GROUND`.
 * That is correct for a grounded pose and wrong for two cases the art has to
 * avoid: debris drawn below the feet lifts the character off the floor, and an
 * asymmetric effect (a projectile leaving to the right) moves the bbox centre,
 * so the BODY shifts the other way. Both read as the sprite popping between
 * frames. A declared per-frame anchor is the eventual fix; keeping effects off
 * the actor sheet is the cheap one.
 *
 * ONE resample: the source cell goes straight into the crush buffer. Measured
 * cost of resampling twice was isolated 34.9% → 42.7%.
 */
export function registerCell(
  source: CanvasImageSource,
  cell: Cell,
  k: number,
  px: number,
): HTMLCanvasElement {
  const unit = px / ART_SPACE;
  const [x0, y0, x1, y1] = cell;
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const buf = document.createElement("canvas");
  buf.width = px;
  buf.height = px;
  const ctx = buf.getContext("2d");
  if (!ctx) throw new Error("[ingest] could not get a 2D context for the cel buffer");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, x0, y0, cw, ch, (px - cw * k) / 2, GROUND * unit - ch * k, cw * k, ch * k);
  return buf;
}

/** The pre-crush buffer through the REAL crush, at `grid` texels. */
export function crushCell(buf: HTMLCanvasElement, grid: number): ImageData {
  const cell = crushToGrid(buf, grid);
  const ctx = cell.getContext("2d");
  if (!ctx) throw new Error("[ingest] could not get a 2D context for the crushed cell");
  return ctx.getImageData(0, 0, grid, grid);
}
