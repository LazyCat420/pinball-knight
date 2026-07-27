/**
 * The aim indicator's geometry, headless. An axis flip or a sign error here
 * would put the "you are turning left" wedge on the right of the ball, which is
 * worse than no indicator at all — so both helpers are pinned directly.
 */
import { describe, expect, it } from "vitest";
import { bendFraction, steerSign } from "./aim-indicator-math";

describe("bendFraction", () => {
  it("is 0 when the steer matches the heading", () => {
    expect(bendFraction(1, 0, 1, 0)).toBeCloseTo(0);
    expect(bendFraction(0, 1, 0, 1)).toBeCloseTo(0);
    // Magnitude must not matter — only direction.
    expect(bendFraction(1, 0, 5, 0)).toBeCloseTo(0);
  });

  it("is 0.5 at a right angle and 1 when fully reversed", () => {
    expect(bendFraction(1, 0, 0, 1)).toBeCloseTo(0.5);
    expect(bendFraction(1, 0, 0, -1)).toBeCloseTo(0.5);
    expect(bendFraction(1, 0, -1, 0)).toBeCloseTo(1);
  });

  it("ramps linearly in ANGLE, so a 45° turn is half a 90° one", () => {
    const h = Math.SQRT1_2;
    expect(bendFraction(1, 0, h, h)).toBeCloseTo(0.25);
    // A dot-product ramp would give ~0.29 here; the linear-in-degrees property
    // is the whole reason acos is used.
    expect(bendFraction(1, 0, h, h)).toBeCloseTo(bendFraction(1, 0, 0, 1) / 2);
  });

  it("never returns NaN or escapes 0..1, including on degenerate input", () => {
    for (const v of [bendFraction(0, 0, 1, 0), bendFraction(1, 0, 0, 0), bendFraction(0, 0, 0, 0)]) {
      expect(Number.isNaN(v)).toBe(false);
      expect(v).toBe(0);
    }
    // Slightly non-unit vectors must not push acos out of domain.
    expect(bendFraction(1.0000001, 0, 1.0000001, 0)).toBeCloseTo(0);
  });
});

describe("steerSign", () => {
  it("separates the two turn directions", () => {
    const left = steerSign(1, 0, 0, 1);
    const right = steerSign(1, 0, 0, -1);
    expect(left).toBe(1);
    expect(right).toBe(-1);
    expect(left).not.toBe(right);
  });

  it("is 0 when collinear either way", () => {
    expect(steerSign(1, 0, 1, 0)).toBe(0);
    expect(steerSign(1, 0, -1, 0)).toBe(0);
  });

  it("is consistent as the heading rotates", () => {
    // Turning "toward +Z from +X" and "toward -X from +Z" are the same handed
    // turn and must agree in sign.
    expect(steerSign(1, 0, 0, 1)).toBe(steerSign(0, 1, -1, 0));
  });
});
