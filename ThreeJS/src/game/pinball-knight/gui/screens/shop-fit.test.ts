/**
 * THE CART MUST FIT WHAT IT SELLS.
 *
 * Adding a seventh ware to `SHOP_STOCK` (✨ laser, 2026-07-29) did not make the
 * sheet taller — the height was `Math.min(322, …)` and 322 was already the
 * tallest sheet the design box could hold — so the new row printed straight
 * through the footer and its price was clipped by the LEAVE button. Every test
 * passed; the only thing that said otherwise was a screenshot.
 *
 * Two guards, because the fix has two ways to fail:
 *
 *  1. THE SHEET vs THE BOX. A sheet taller than the box is not clipped by it,
 *     `sheet()` clamps to `f.h - GRID*2` and the overflow lands on top of
 *     whatever is at the bottom. Silent, and it looks like a text bug.
 *  2. THE BOX vs THE ZOOM FLOOR. The obvious fix — grow the box — has a cliff
 *     in it: `UiScreen.design` picks the largest INTEGER zoom that fits, so at
 *     451 tall a 900-line grid drops from 2x to 1x and the whole shop halves in
 *     size while every other sheet stays at 2x. That is a worse bug than the one
 *     being fixed, and nothing else in the suite would notice.
 */
import { describe, expect, it } from "vitest";
import { DESIGN, DESIGN_ROWS, shopSheetH } from "./shop";
import { SHOP_STOCK } from "../../economy/shop";
import { GRID } from "../theme";

/** The grid the game is played on; 900 lines is the desktop case that matters. */
const GRID_H = 900;

describe("the rolling cart's sheet", () => {
  it("is tall enough for every ware actually stocked", () => {
    const needed = shopSheetH(SHOP_STOCK.length);
    expect(
      needed + GRID * 2,
      `${SHOP_STOCK.length} wares need a ${needed}px sheet, which does not fit the ${DESIGN.h}px design box — ` +
        `raise DESIGN_ROWS (and re-check the zoom floor below) or make the ware list scroll`,
    ).toBeLessThanOrEqual(DESIGN.h);
  });

  it("stocks no more wares than the box is authored for", () => {
    expect(
      SHOP_STOCK.length,
      `the cart stocks ${SHOP_STOCK.length} wares but the design box is authored for ${DESIGN_ROWS}`,
    ).toBeLessThanOrEqual(DESIGN_ROWS);
  });

  it("keeps the design box inside the 2x zoom floor", () => {
    // floor(900 / h) is the zoom the screen will be painted at.
    expect(
      Math.floor(GRID_H / DESIGN.h),
      `a ${DESIGN.h}px box paints at ${Math.floor(GRID_H / DESIGN.h)}x on a ${GRID_H}-line grid — ` +
        `every other sheet is at 2x, so this one would look like a different game`,
    ).toBeGreaterThanOrEqual(2);
  });

  it("grows by exactly one row per ware, gap included", () => {
    // The old estimate was 30 per row while a row consumes 33, so it drifted
    // short by 3px per ware — invisible at six, an overprint at seven.
    expect(shopSheetH(7) - shopSheetH(6)).toBe(33);
  });
});
