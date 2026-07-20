/**
 * The adaptive integer render-size rule (see computeRenderSizing in
 * pixel-pass.ts). This is the load-bearing arithmetic behind the game's
 * crispness, so it is extracted as a pure function and pinned here — the old
 * fractional-scale bug (x1.5 upscale ⇒ render pixels alternately 1 and 2
 * screen pixels wide) was invisible to every existing test.
 */
import { describe, it, expect } from "vitest";
import { computeRenderSizing } from "./pixel-pass";
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
      // FOV in tiles never drifts more than +25% from the reference.
      expect(s.renderW / PPU, `${w}x${h}`).toBeLessThanOrEqual((RENDER_W / PPU) * 1.25);
    }
  });

  it("never shows less of the level than the reference resolution", () => {
    for (const [w, h] of WINDOWS) {
      const s = computeRenderSizing(w, h);
      expect(s.renderW, `${w}x${h}`).toBeGreaterThanOrEqual(RENDER_W);
      expect(s.renderH, `${w}x${h}`).toBeGreaterThanOrEqual(RENDER_H);
    }
  });

  it("gives 1920x1080 a whole-number scale (the bug this replaced)", () => {
    const s = computeRenderSizing(1920, 1080);
    expect(s.scale).toBe(1);
    // The old path produced outW = round(1280 * 1.5) = 1920 over a 1280-wide
    // target: a x1.5 nearest upscale, so render pixels landed alternately on 1
    // and 2 screen pixels. Whatever the size, the ratio is now exactly `scale`.
    expect(s.outW / s.renderW).toBe(s.scale);
    // Clamped to the FOV cap rather than filling all 1920 — 160px of bar each
    // side is the accepted cost of not zooming the level out by 50%.
    expect(s.renderW).toBe(MAX_RENDER_W);
    expect(s.capped).toBe(true);
  });

  it("picks a bigger zoom once the window is a multiple of the reference", () => {
    expect(computeRenderSizing(2560, 1440).scale).toBe(2);
    expect(computeRenderSizing(3840, 2160).scale).toBe(3);
    // 3440x1440 is 2.68 x 2.0 — the SHORT axis picks the zoom.
    expect(computeRenderSizing(3440, 1440).scale).toBe(2);
    // 3440/2 = 1720 would exceed the FOV cap, so it clamps and letterboxes.
    expect(computeRenderSizing(3440, 1440).renderW).toBe(MAX_RENDER_W);
  });

  it("falls back to scale 1 below the reference floor", () => {
    const s = computeRenderSizing(800, 600);
    expect(s.scale).toBe(1);
    // Still never smaller than the reference — the floor wins over "fill".
    expect(s.renderW).toBe(RENDER_W);
    expect(s.renderH).toBe(RENDER_H);
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
    const tiny = computeRenderSizing(0, 0);
    expect(tiny.scale).toBe(1);
    expect(tiny.renderW).toBe(RENDER_W);
  });
});
