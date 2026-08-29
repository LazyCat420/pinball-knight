import { describe, it, expect } from "vitest";
import { computeRenderSizing } from "../engine/render/pixel-pass";
import { screenToUi, canvasOrigin } from "./coords";

/**
 * These run against the REAL `computeRenderSizing`, not a hand-made sizing
 * literal. The mapping's whole job is to be the exact inverse of what the pixel
 * pass does to the canvas, so testing it against an invented sizing would
 * happily pass while the two drifted apart.
 */
describe("screenToUi", () => {
  it("maps the canvas origin to (0,0) at every scale", () => {
    for (const [w, h] of [[1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]] as const) {
      const s = computeRenderSizing(w, h);
      const { left, top } = canvasOrigin(s, w, h);
      const p = screenToUi(left, top, s, w, h);
      expect([w, h, p.x, p.y]).toEqual([w, h, 0, 0]);
    }
  });

  it("maps the far corner to the far edge of the UI grid", () => {
    const w = 2560;
    const h = 1440;
    const s = computeRenderSizing(w, h);
    const { left, top } = canvasOrigin(s, w, h);
    // One window pixel short of the far edge is one UI pixel short, scaled.
    const p = screenToUi(left + s.outW - s.scale, top + s.outH - s.scale, s, w, h);
    expect(p.x).toBe(s.renderW - 1);
    expect(p.y).toBe(s.renderH - 1);
    expect(p.inside).toBe(true);
  });

  it("divides by the integer scale, not by the window ratio", () => {
    // 3840x2160 is scale 2 over a 1920x1080 grid: 200 window px in from the
    // canvas edge must be UI pixel 100, NOT 200. (It was 2560x1440 until the
    // ceiling moved to 2560x1440 — that window now fills at scale 1, so it no
    // longer exercises the division this test is about.)
    const w = 3840;
    const h = 2160;
    const s = computeRenderSizing(w, h);
    expect(s.scale).toBe(2);
    const { left, top } = canvasOrigin(s, w, h);
    const p = screenToUi(left + 200, top + 80, s, w, h);
    expect([p.x, p.y]).toEqual([100, 40]);
  });

  it("keeps the fraction, so adjacent widgets do not both claim a boundary", () => {
    const w = 3840;
    const h = 2160;
    const s = computeRenderSizing(w, h);
    const { left, top } = canvasOrigin(s, w, h);
    // One window pixel at scale 2 is half a UI pixel. A hit test that floored
    // here would put this click in the row above.
    const p = screenToUi(left + 1, top + 1, s, w, h);
    expect([p.x, p.y]).toEqual([0.5, 0.5]);
  });

  it("reports points in the letterbox bars as outside", () => {
    // A very wide, short window is the capped case: renderW hits MAX_RENDER_W
    // and real bars appear. This is the only configuration where `inside` can
    // be false, and it is exactly the one nobody tests by hand.
    const w = 7680;
    const h = 1080;
    const s = computeRenderSizing(w, h);
    expect(s.capped).toBe(true);
    const { left } = canvasOrigin(s, w, h);
    expect(left).toBeGreaterThan(0);
    expect(screenToUi(0, 540, s, w, h).inside).toBe(false);
    expect(screenToUi(w - 1, 540, s, w, h).inside).toBe(false);
    expect(screenToUi(left + 4, 540, s, w, h).inside).toBe(true);
  });

  it("mirrors the floor() the canvas is positioned with", () => {
    // An odd letterbox: the canvas cannot sit on a half pixel, so resize()
    // floors, and so must this. A rounding mismatch here is a one-pixel drift
    // that only shows up at some window widths.
    const w = 7681;
    const h = 1080;
    const s = computeRenderSizing(w, h);
    const { left } = canvasOrigin(s, w, h);
    expect(left).toBe(Math.floor((w - s.outW) / 2));
    // The pixel just inside the left edge of the canvas is UI pixel 0.
    expect(screenToUi(left, 540, s, w, h).x).toBe(0);
  });
});
