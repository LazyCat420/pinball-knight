/**
 * Fog-of-war tests. Pure logic over a typed array, so all of it is testable
 * without a canvas — and worth testing, because a fog bug is invisible rather
 * than loud: the map just quietly shows the wrong thing.
 */
import { describe, it, expect } from "vitest";
import { createFog, fogAt, revealAround, exploredCount, exploredFraction, FOG_HIDDEN, FOG_DIM, FOG_SEEN } from "./fog";
import { T_WALL, T_FLOOR, type Grid } from "./maze/generator";

/** A grid of open floor with a solid border. */
function openGrid(w = 21, h = 15): Grid {
  const t = new Uint8Array(w * h).fill(T_FLOOR);
  for (let i = 0; i < w; i++) {
    t[i] = T_WALL;
    t[(h - 1) * w + i] = T_WALL;
  }
  for (let j = 0; j < h; j++) {
    t[j * w] = T_WALL;
    t[j * w + w - 1] = T_WALL;
  }
  return { w, h, t, shapes: new Uint8Array(w * h) };
}

describe("createFog", () => {
  it("matches the grid's dimensions exactly", () => {
    const g = openGrid();
    const f = createFog(g);
    expect(f.w).toBe(g.w);
    expect(f.h).toBe(g.h);
    expect(f.v.length).toBe(g.t.length);
  });

  it("starts fully hidden", () => {
    const f = createFog(openGrid());
    expect(exploredCount(f)).toBe(0);
  });
});

describe("rev", () => {
  it("starts at zero and rises when a tile is newly revealed", () => {
    const g = openGrid();
    const f = createFog(g);
    expect(f.rev).toBe(0);
    revealAround(f, g, 10, 7, 3);
    expect(f.rev).toBeGreaterThan(0);
  });

  it("does NOT move when a reveal changes nothing", () => {
    // This is the property the minimap's repaint guard depends on: standing
    // still must not look like new exploration.
    const g = openGrid();
    const f = createFog(g);
    revealAround(f, g, 10, 7, 3);
    const before = f.rev;
    revealAround(f, g, 10, 7, 3);
    expect(f.rev).toBe(before);
  });
});

describe("fogAt", () => {
  it("reads out of bounds as hidden rather than throwing", () => {
    const f = createFog(openGrid());
    expect(fogAt(f, -1, 5)).toBe(FOG_HIDDEN);
    expect(fogAt(f, 5, -1)).toBe(FOG_HIDDEN);
    expect(fogAt(f, 999, 5)).toBe(FOG_HIDDEN);
    expect(fogAt(f, 5, 999)).toBe(FOG_HIDDEN);
  });
});

describe("revealAround", () => {
  it("reveals the tile you're standing on", () => {
    const g = openGrid();
    const f = createFog(g);
    revealAround(f, g, 10, 7, 3);
    expect(fogAt(f, 10, 7)).toBe(FOG_SEEN);
  });

  it("reveals a disc, not a square", () => {
    const g = openGrid(31, 31);
    const f = createFog(g);
    revealAround(f, g, 15, 15, 4);
    // On-axis at the radius: inside. The diagonal corner at (±4, ±4) is
    // distance 5.6 — outside, and must stay hidden or the reveal is a box.
    expect(fogAt(f, 19, 15)).toBe(FOG_SEEN);
    expect(fogAt(f, 19, 19)).toBe(FOG_HIDDEN);
  });

  it("never lowers an already-seen tile", () => {
    const g = openGrid();
    const f = createFog(g);
    revealAround(f, g, 10, 7, 3);
    // Walk away; the tile behind stays SEEN rather than dropping to DIM.
    revealAround(f, g, 16, 7, 3);
    expect(fogAt(f, 10, 7)).toBe(FOG_SEEN);
  });

  it("marks rim WALLS dim so corridors have visible edges", () => {
    const g = openGrid(21, 15);
    const f = createFog(g);
    // Stand next to the left border wall; the wall at x=0 is on the rim.
    revealAround(f, g, 4, 7, 3);
    expect(fogAt(f, 0, 7)).toBe(FOG_DIM);
  });

  it("does NOT dim floor beyond the radius — that would leak the layout", () => {
    const g = openGrid(31, 31);
    const f = createFog(g);
    revealAround(f, g, 15, 15, 3);
    // Floor exactly one ring out: still hidden.
    expect(fogAt(f, 19, 15)).toBe(FOG_HIDDEN);
  });

  it("clips at the grid edge without throwing", () => {
    const g = openGrid();
    const f = createFog(g);
    expect(() => revealAround(f, g, 0, 0, 5)).not.toThrow();
    expect(fogAt(f, 0, 0)).toBe(FOG_SEEN);
  });
});

describe("exploredFraction", () => {
  it("is 0 on an untouched floor", () => {
    const g = openGrid();
    expect(exploredFraction(createFog(g), g)).toBe(0);
  });

  it("reaches 1 when every walkable tile has been seen", () => {
    const g = openGrid(15, 11);
    const f = createFog(g);
    for (let j = 0; j < g.h; j++) {
      for (let i = 0; i < g.w; i++) revealAround(f, g, i, j, 1);
    }
    expect(exploredFraction(f, g)).toBe(1);
  });

  it("measures against WALKABLE tiles, not total tiles", () => {
    // Mostly-solid grid with a short corridor. Walking it end to end is 100%
    // explored even though the vast majority of the grid is rock — counting
    // against total tiles would report a fully-cleared floor as ~5%.
    const w = 21;
    const h = 15;
    const t = new Uint8Array(w * h).fill(T_WALL);
    for (let i = 5; i < 10; i++) t[7 * w + i] = T_FLOOR;
    const g: Grid = { w, h, t, shapes: new Uint8Array(w * h) };
    const f = createFog(g);
    for (let i = 5; i < 10; i++) revealAround(f, g, i, 7, 1);
    expect(exploredFraction(f, g)).toBe(1);
  });

  it("returns 0 rather than NaN for a grid with no walkable tiles", () => {
    const g: Grid = { w: 8, h: 8, t: new Uint8Array(64).fill(T_WALL), shapes: new Uint8Array(64) };
    expect(exploredFraction(createFog(g), g)).toBe(0);
  });
});
