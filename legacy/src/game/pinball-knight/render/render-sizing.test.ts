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

/**
 * BROWSER ZOOM MUST NOT CHANGE THE GAME.
 *
 * Ctrl +/- scales `innerWidth` and `devicePixelRatio` by reciprocal amounts, so
 * the window's physical size is unchanged. Sizing off `innerWidth` alone read
 * that as a resize and re-derived the frustum and the UI's design zoom from it:
 * the field of view moved and the HUD stepped between 1x and 2x, both from a
 * keypress that is supposed to change resolution and nothing else.
 *
 * `computeRenderSizing`'s third argument cancels it. The property is that the
 * ZOOMED window at that factor produces a grid IDENTICAL to the unzoomed one —
 * not merely similar, because anything that differs by a pixel can still flip
 * an integer zoom on the far side of a boundary.
 */
describe("browser zoom is cancelled", () => {
  const ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5];

  it.each([
    [1920, 1080],
    [1712, 929],
    [1600, 900],
    [1366, 768],
    [2560, 1440],
  ])("gives %ix%i the same grid at every zoom step", (physW, physH) => {
    const base = computeRenderSizing(physW, physH, 1);
    for (const z of ZOOMS) {
      // What the browser reports at that zoom: CSS px shrink as dpr grows.
      const cssW = physW / z;
      const cssH = physH / z;
      const s = computeRenderSizing(cssW, cssH, z);
      expect({ z, w: s.renderW, h: s.renderH }).toEqual({ z, w: base.renderW, h: base.renderH });
      // …and the canvas still covers the same CSS window, so no bars appear and
      // nothing overflows: the ELEMENT shrinks by exactly the zoom factor while
      // the drawing buffer stays put.
      expect(s.renderW * s.cssScale).toBeCloseTo(base.outW / z, 6);
    }
  });

  it("leaves the drawing buffer alone, so only sharpness changes", () => {
    const a = computeRenderSizing(1920, 1080, 1);
    const b = computeRenderSizing(1536, 864, 1.25);
    expect([b.outW, b.outH]).toEqual([a.outW, a.outH]);
    expect(b.scale).toBe(a.scale);
    // The one thing that DOES move: CSS pixels per render pixel.
    expect(b.cssScale).toBeCloseTo(a.cssScale / 1.25, 6);
  });
});
