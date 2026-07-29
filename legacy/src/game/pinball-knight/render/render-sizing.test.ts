/**
 * The adaptive integer render-size rule (see computeRenderSizing in
 * pixel-pass.ts). This is the load-bearing arithmetic behind the game's
 * crispness, so it is extracted as a pure function and pinned here — the old
 * fractional-scale bug (x1.5 upscale ⇒ render pixels alternately 1 and 2
 * screen pixels wide) was invisible to every existing test.
 */
import { describe, it, expect } from "vitest";
import { computeRenderSizing } from "../engine/render/pixel-pass";
import { RENDER_W, RENDER_H, MAX_RENDER_W, MAX_RENDER_H, PPU } from "../constants";

/** Real-world windows, including deliberately awkward ones. */
const WINDOWS: ReadonlyArray<[number, number]> = [
  [1280, 720], // exactly the reference
  [1366, 768], // the classic awkward laptop
  [1280, 800], // 16:10
  [1440, 900],
  [1920, 1080], // used to be the x1.5 disaster
  [1600, 900],
  [2560, 1440],
  [3440, 1440], // ultrawide
  [3840, 2160],
  [1024, 600], // BELOW the reference floor
  [800, 600],
  [1921, 1081], // odd numbers on both axes
];

describe("computeRenderSizing", () => {
  it("always yields an integer scale of at least 1", () => {
    for (const [w, h] of WINDOWS) {
      const s = computeRenderSizing(w, h);
      expect(Number.isInteger(s.scale), `${w}x${h}`).toBe(true);
      expect(s.scale, `${w}x${h}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("always yields EVEN render dimensions", () => {
    // An odd width puts the ortho frustum centre on a half-texel and every
    // sprite inherits the offset.
    for (const [w, h] of WINDOWS) {
      const s = computeRenderSizing(w, h);
      expect(s.renderW % 2, `${w}x${h} renderW=${s.renderW}`).toBe(0);
      expect(s.renderH % 2, `${w}x${h} renderH=${s.renderH}`).toBe(0);
    }
  });

  it("covers the window with no letterbox bars until the FOV cap bites", () => {
    for (const [w, h] of WINDOWS) {
      const s = computeRenderSizing(w, h);
      expect(s.outW).toBe(s.renderW * s.scale);
      expect(s.outH).toBe(s.renderH * s.scale);
      if (s.capped) continue; // capped windows letterbox on purpose — see below
      expect(s.renderW * s.scale, `${w}x${h}`).toBeGreaterThanOrEqual(w);
      expect(s.renderH * s.scale, `${w}x${h}`).toBeGreaterThanOrEqual(h);
    }
  });

  it("bounds how much of the level a big window can reveal", () => {
    // THE point of MAX_RENDER_*. PPU is pinned at 64, so render width IS the
    // field of view: an unclamped 1920-wide target shows 30 tiles where the
    // game was designed around 20, and every sprite gets physically smaller on
    // screen — the opposite of the fidelity this whole change was chasing.
    // Letterboxing past the cap is the deliberate trade.
    for (const [w, h] of WINDOWS) {
      const s = computeRenderSizing(w, h);
      expect(s.renderW, `${w}x${h}`).toBeLessThanOrEqual(MAX_RENDER_W);
      expect(s.renderH, `${w}x${h}`).toBeLessThanOrEqual(MAX_RENDER_H);
      // FOV is bounded by the cap, which is 1920 wide = 30 tiles against the
      // designed 20. That +50% is a DELIBERATE cost of filling a 1080p screen
      // at a whole-number scale — see MAX_RENDER_W. It is not a small drift and
      // should not be quietly widened further: raising the cap raises how much
      // of the level a big monitor reveals, which is a gameplay difference
      // between players, not a rendering detail.
      expect(s.renderW / PPU, `${w}x${h}`).toBeLessThanOrEqual(MAX_RENDER_W / PPU);
    }
  });

  it("NEVER hands back a canvas bigger than the window", () => {
    // This replaced "never shows less of the level than the reference", which
    // asserted a FLOOR at 1280x720 and allowed the canvas to overflow a smaller
    // window. That guarantee shipped a bug: the canvas is centred, so an
    // oversized one gets a negative `top`, and the HUD — anchored to the
    // frame's bottom edge — slides out of the viewport. At 200% browser zoom on
    // a 1080p screen it was gone completely.
    //
    // Fitting is now the invariant, and it is the stronger one: a slightly
    // smaller view is a compromise, an invisible HUD is a broken game.
    for (const [w, h] of WINDOWS) {
      const s = computeRenderSizing(w, h);
      if (s.capped) continue; // MAX_RENDER_* letterboxes on purpose
      expect(s.outW, `${w}x${h} canvas wider than the window`).toBeLessThanOrEqual(Math.ceil(w) + 1);
      expect(s.outH, `${w}x${h} canvas taller than the window`).toBeLessThanOrEqual(Math.ceil(h) + 1);
    }
  });

  it("gives 1920x1080 a whole-number scale (the bug this replaced)", () => {
    const s = computeRenderSizing(1920, 1080);
    expect(s.scale).toBe(1);
    // The old path produced outW = round(1280 * 1.5) = 1920 over a 1280-wide
    // target: a x1.5 nearest upscale, so render pixels landed alternately on 1
    // and 2 screen pixels. Whatever the size, the ratio is now exactly `scale`.
    expect(s.outW / s.renderW).toBe(s.scale);
    // 1080p FILLS THE SCREEN. This is the case the cap exists to serve: it used
    // to clamp to 1600x900 here, putting 160px bars each side and 90px top and
    // bottom — 31% of the display black — which is a worse deal than the wider
    // field of view it was buying.
    expect(s.renderW).toBe(1920);
    expect(s.renderH).toBe(1080);
    expect(s.outW).toBe(1920);
    expect(s.outH).toBe(1080);
    expect(s.capped).toBe(false);
  });

  it("picks a bigger zoom once the window is a multiple of the reference", () => {
    expect(computeRenderSizing(2560, 1440).scale).toBe(2);
    expect(computeRenderSizing(3840, 2160).scale).toBe(3);
    // 3440x1440 is 2.68 x 2.0 — the SHORT axis picks the zoom.
    expect(computeRenderSizing(3440, 1440).scale).toBe(2);
    // 3440/2 = 1720, comfortably under the 1920 cap, so the ultrawide fills.
    expect(computeRenderSizing(3440, 1440).renderW).toBe(1720);
  });

  it("falls back to scale 1 below the reference floor", () => {
    const s = computeRenderSizing(800, 600);
    expect(s.scale).toBe(1);
    // The target TRACKS the window now — see the fitting test above. The old
    // assertion here was `renderW === RENDER_W` (1280 on an 800px window),
    // which is precisely the overflow that pushed the HUD off-screen.
    expect(s.renderW).toBe(800);
    expect(s.renderH).toBe(600);
    expect(s.outW).toBeLessThanOrEqual(800);
  });

  it("clamps a pathological ultrawide and reports it as capped", () => {
    // Wide and short: the scale pins at 1 while the width runs away.
    const s = computeRenderSizing(7680, 1080);
    expect(s.scale).toBe(1);
    expect(s.renderW).toBe(MAX_RENDER_W);
    expect(s.capped).toBe(true);
    // Crispness is preserved (integer scale); the window letterboxes instead.
    expect(s.outW).toBeLessThan(7680);
    expect(s.renderH).toBeLessThanOrEqual(MAX_RENDER_H);
  });

  it("keeps the frustum centre on a whole texel", () => {
    // pixel-pass derives half-extents as renderW / (2 * PPU); with an even
    // renderW that is a whole number of texels.
    for (const [w, h] of WINDOWS) {
      const s = computeRenderSizing(w, h);
      expect(((s.renderW / 2) * PPU) % PPU, `${w}x${h}`).toBe(0);
      expect(Number.isInteger(s.renderH / 2), `${w}x${h}`).toBe(true);
    }
  });

  it("is stable — recomputing the same window changes nothing", () => {
    for (const [w, h] of WINDOWS) {
      expect(computeRenderSizing(w, h)).toEqual(computeRenderSizing(w, h));
    }
  });

  it("tolerates fractional and degenerate window sizes", () => {
    const s = computeRenderSizing(1920.6, 1080.4);
    expect(Number.isInteger(s.scale)).toBe(true);
    expect(s.renderW % 2).toBe(0);
    // A degenerate window must not divide by zero or allocate a 0-wide target.
    const tiny = computeRenderSizing(0, 0);
    expect(tiny.scale).toBe(1);
    expect(tiny.renderW).toBeGreaterThan(0);
    expect(tiny.renderW % 2).toBe(0);
  });
});
