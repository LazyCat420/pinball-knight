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
import { PPU, SPRITE_PX, SPRITE_UNITS, SPRITE_PIXEL_GRID } from "../constants";

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
    // ~52px is the awkward middle: too big to read as charmingly minimal, too
    // small for a face. ~72px is where characters stop looking low-res.
    expect(SPRITE_PIXEL_GRID).toBeGreaterThanOrEqual(64);
  });
});
