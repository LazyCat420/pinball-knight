/**
 * THE TEXEL:PIXEL INVARIANT.
 *
 * These are the numbers that decide whether the game looks like pixel art or
 * like mush, and nothing else in the codebase would fail if they drifted — the
 * art still renders, it just quietly stops being crisp. That is precisely the
 * kind of regression a screenshot catches and a test suite normally doesn't,
 * so it gets asserted here explicitly.
 *
 * History: SPRITE_UNITS was 1.1 against a 52px grid = 70.4 render pixels for
 * 52 texels (ratio 1.354). With NearestFilter that puts some art pixels on one
 * screen pixel and some on two, in a pattern that shifts as the actor walks.
 * Nobody had written it down, so it survived for months.
 */
import { describe, it, expect } from "vitest";
import { PPU, SPRITE_PX, SPRITE_UNITS, SPRITE_PIXEL_GRID, CAMERA_ZOOMS } from "../constants";

describe("sprite scale invariants", () => {
  it("maps exactly one stored art pixel to one render pixel", () => {
    const screenPx = SPRITE_UNITS * PPU;
    expect(screenPx).toBe(SPRITE_PIXEL_GRID);

    const ratio = screenPx / SPRITE_PIXEL_GRID;
    expect(Number.isInteger(ratio)).toBe(true);
    expect(ratio).toBeGreaterThanOrEqual(1);
  });

  it("keeps SPRITE_UNITS exactly representable so the plane never lands off-grid", () => {
    // SPRITE_PIXEL_GRID / PPU must terminate in binary, or the plane size is
    // an approximation and the 1:1 mapping is only nearly true.
    expect(SPRITE_UNITS * PPU).toBe(Math.round(SPRITE_UNITS * PPU));
  });

  it("supersamples the paint box above the stored grid", () => {
    // The 128px authoring box exists to anti-alias curves BEFORE the crush.
    // If the grid ever caught up with the paint box, the downscale would stop
    // doing that job and outlines would alias again.
    expect(SPRITE_PX).toBeGreaterThan(SPRITE_PIXEL_GRID);
  });

  it("holds a grid resolution that can actually carry facial detail", () => {
    // Was >= 64, written when PPU was a single fixed number. The camera zoom is
    // now a PLAYER SETTING, and grid falls with it because a smaller actor on
    // screen cannot carry more texels than it covers — that is arithmetic, not
    // a regression. 54 is the floor of the offered ladder (`widest`, PPU 48);
    // anything below it would be a new rung, which is a deliberate decision and
    // should have to change this line to happen.
    expect(SPRITE_PIXEL_GRID).toBeGreaterThanOrEqual(54);
  });
});

/**
 * EVERY RUNG, not just the one that happens to be selected.
 *
 * The invariants above only ever see the CURRENT setting, so a rung that breaks
 * them would ship invisibly and only fail for the players who chose it — the
 * worst possible distribution for a rendering bug. These assert the whole
 * table, so adding a zoom level with an illegal PPU is a red test rather than a
 * bug report from one person.
 */
describe("every camera zoom rung is legal", () => {
  it.each(Object.entries(CAMERA_ZOOMS))("%s (PPU %i) yields a whole texel grid", (_name, ppu) => {
    // SPRITE_UNITS is 9/8, so grid = 9*PPU/8 and PPU must be a multiple of 8.
    expect(ppu % 8).toBe(0);
    const grid = (ppu * 9) / 8;
    expect(Number.isInteger(grid)).toBe(true);
    // The supersample buffer stays exactly 2x, so the crush is a clean box.
    expect(Number.isInteger(grid * 2)).toBe(true);
    // And the plane still maps one stored texel to one render pixel.
    expect((grid / ppu) * ppu).toBe(grid);
  });
});
