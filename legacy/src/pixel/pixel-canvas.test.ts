/**
 * Tests for the pixel surface's scaling maths — the part that decides whether
 * the output reads as pixel art or as mush.
 *
 * Exercised through `computeFit`, which is the same code `createPixelSurface`
 * runs but without needing a DOM (vitest runs in node here). Rendering itself is
 * not tested — house rule.
 */
import { describe, it, expect } from "vitest";
import { computeFit, snap } from "./pixel-canvas";

/** Non-null helper: every case below passes a valid target box. */
function fit(logicalWidth: number, w: number, h: number, min?: number, max?: number) {
  const r = computeFit(logicalWidth, w, h, min, max);
  if (!r) throw new Error("expected a fit");
  return r;
}

describe("computeFit", () => {
  it("only ever scales by a whole number", () => {
    // 250/100 = 2.5 — a fractional scale would smear every edge.
    const f = fit(100, 250, 200);
    expect(Number.isInteger(f.scale)).toBe(true);
    expect(f.scale).toBe(2);
  });

  it("letterboxes the remainder instead of stretching to fit", () => {
    // 100 logical * 2 = 200 used of 250 available -> 25px bars either side.
    expect(fit(100, 250, 200).offsetX).toBe(25);
  });

  it("respects the max scale so a 4K display doesn't get absurd chunks", () => {
    expect(fit(100, 3840, 2160, 1, 3).scale).toBe(3);
  });

  it("never drops below scale 1, even in a box narrower than the logical width", () => {
    expect(fit(100, 40, 40).scale).toBe(1);
  });

  it("derives logical height from the space actually available", () => {
    const f = fit(100, 200, 150); // scale 2 -> 75 logical rows
    expect(f.scale).toBe(2);
    expect(f.height).toBe(75);
  });

  it("returns null for a degenerate target", () => {
    expect(computeFit(100, 0, 0)).toBe(null);
    expect(computeFit(100, 200, 0)).toBe(null);
  });

  it("keeps the logical width exactly as asked", () => {
    // The width is the contract — callers lay out against it.
    expect(fit(160, 1000, 800).width).toBe(160);
  });

  it("centres the image both ways", () => {
    const f = fit(100, 250, 205); // scale 2, height 102 -> 204 of 205
    expect(f.offsetX).toBe(25);
    expect(f.offsetY).toBe(0);
  });
});

describe("logical <-> screen mapping", () => {
  // The surface's toLogical is (x - offsetX) / scale; verify the maths that
  // hit-testing depends on, including the letterbox case.
  function toLogical(f: { offsetX: number; offsetY: number; scale: number }, x: number, y: number) {
    return { x: (x - f.offsetX) / f.scale, y: (y - f.offsetY) / f.scale };
  }

  it("round-trips a point from screen space back to logical pixels", () => {
    const f = fit(100, 250, 200); // scale 2, offsetX 25
    const p = toLogical(f, 45, 10);
    expect(p.x).toBeCloseTo(10, 5);
    expect(p.y).toBeCloseTo(5, 5);
  });

  it("maps a click in the letterbox bar outside the surface", () => {
    // Callers must be able to tell "outside the map" from "logical pixel 0",
    // or the leftmost column becomes a giant hit target.
    const f = fit(100, 250, 200);
    expect(toLogical(f, 5, 100).x).toBeLessThan(0);
  });
});

describe("snap", () => {
  it("puts coordinates on whole pixels", () => {
    expect(snap(104.37)).toBe(104);
    expect(snap(104.6)).toBe(105);
  });
});
