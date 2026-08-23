/**
 * Floor-map renderer tests, focused on the off-window stairs indicator.
 *
 * The minimap is a canvas inside a `pointer-events: none` HUD panel, so none of
 * this is observable from the DOM. Two things make it testable anyway:
 *
 *  - `clampRayToBorder` is pure arithmetic, extracted precisely so the fiddly
 *    part can be pinned without a canvas at all.
 *  - `drawFloorMap` only ever touches a handful of 2D-context members, so a
 *    recording stub is enough to assert WHAT was drawn and in which colour.
 *
 * The gate that matters most is the fog one: an indicator that pointed at
 * undiscovered stairs would turn the minimap into an aimbot.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { drawFloorMap, clampRayToBorder } from "./map-render";
import { state } from "./state";
import { createFog, revealAround } from "./fog";
import { T_WALL, T_FLOOR, tileCenter, type Grid } from "./maze/generator";

/** Cyan, from the renderer's `C_STAIRS`. Duplicated because it is module-private. */
const C_STAIRS = "#6fd0e8";

const PX = 116;
const WINDOW = 11;
const TILE_PX = 5;

/** A grid of open floor with a solid border. */
function openGrid(w = 61, h = 61): Grid {
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

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

/** The smallest thing `drawFloorMap` will accept, recording every fill. */
function stubCtx(): { ctx: CanvasRenderingContext2D; rects: Rect[] } {
  const rects: Rect[] = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, color: String(ctx.fillStyle) });
    },
    strokeRect() {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects };
}

/** Put the player on tile (i, j) and clear every other marker source. */
function placePlayer(g: Grid, i: number, j: number): void {
  const c = tileCenter(g, i, j);
  state.grid = g;
  state.player = { x: c.x, z: c.z, momX: 0, momZ: 0 } as unknown as typeof state.player;
  state.zombies = [];
  state.pinballParts = [];
  state.groundItems = [];
  state.maze = null;
  state.stairs = null;
}

/**
 * Fills that are stairs-cyan and lie outside the window's tile grid — i.e. the
 * edge chevron rather than the in-window stairs marker or a stairs tile.
 */
function chevronRects(rects: Rect[]): Rect[] {
  return rects.filter((r) => r.color === C_STAIRS && (r.w === 1 || r.h === 1));
}

describe("clampRayToBorder", () => {
  it("returns null when there is no direction to point in", () => {
    expect(clampRayToBorder(50, 50, 0, 0, PX, PX, 2)).toBeNull();
  });

  it("lands on the right border for a due-east target", () => {
    const e = clampRayToBorder(58, 58, 10, 0, PX, PX, 2);
    expect(e).not.toBeNull();
    expect(e!.x).toBe(PX - 1 - 2);
    expect(e!.y).toBe(58);
    expect(e!.dx).toBeCloseTo(1);
  });

  it("lands on the top border for a due-north target", () => {
    const e = clampRayToBorder(58, 58, 0, -10, PX, PX, 2)!;
    expect(e.y).toBe(2);
    expect(e.x).toBe(58);
  });

  it("hits the corner for an exact diagonal", () => {
    const e = clampRayToBorder(58, 58, 10, 10, PX, PX, 2)!;
    expect(e.x).toBe(PX - 3);
    expect(e.y).toBe(PX - 3);
  });

  it("never returns a point outside the inset border", () => {
    for (const [dx, dy] of [
      [1, 0.2],
      [-3, 7],
      [0.1, -9],
      [-5, -0.5],
      [40, -1],
    ]) {
      const e = clampRayToBorder(58, 58, dx, dy, PX, PX, 2)!;
      expect(e.x).toBeGreaterThanOrEqual(2);
      expect(e.x).toBeLessThanOrEqual(PX - 3);
      expect(e.y).toBeGreaterThanOrEqual(2);
      expect(e.y).toBeLessThanOrEqual(PX - 3);
    }
  });

  it("clamps an origin that sits outside the border before casting", () => {
    // Player drawn off the left edge (window clipped at the grid edge) and the
    // target is further east: the ray must still travel east, not backwards.
    const e = clampRayToBorder(-20, 58, 10, 0, PX, PX, 2)!;
    expect(e.x).toBe(PX - 3);
  });

  it("returns null when the canvas is too small to inset", () => {
    expect(clampRayToBorder(1, 1, 1, 0, 4, 4, 2)).toBeNull();
  });
});

describe("off-window stairs indicator", () => {
  const opts = { scale: TILE_PX, detail: "mini" as const, window: WINDOW };

  beforeEach(() => {
    placePlayer(openGrid(), 30, 30);
  });

  it("draws nothing when the stairs are undiscovered", () => {
    const g = state.grid!;
    const fog = createFog(g);
    revealAround(fog, g, 30, 30, 4); // the player's own surroundings only
    state.stairs = { i: 55, j: 30 }; // far east, never seen

    const { ctx, rects } = stubCtx();
    drawFloorMap(ctx, g, fog, PX, PX, opts);
    expect(chevronRects(rects)).toHaveLength(0);
  });

  it("draws a border chevron once the stairs are discovered but off-window", () => {
    const g = state.grid!;
    const fog = createFog(g);
    revealAround(fog, g, 30, 30, 4);
    revealAround(fog, g, 55, 30, 2); // been there, walked away
    state.stairs = { i: 55, j: 30 };

    const { ctx, rects } = stubCtx();
    drawFloorMap(ctx, g, fog, PX, PX, opts);

    const chev = chevronRects(rects);
    expect(chev.length).toBeGreaterThan(0);
    // Pointing east: every run is a vertical column, hugging the right border.
    for (const r of chev) {
      expect(r.w).toBe(1);
      expect(r.x).toBeGreaterThan(PX * 0.75);
      expect(r.x).toBeLessThanOrEqual(PX - 3);
    }
    // A single-pixel tip, as a chevron should have.
    expect(chev.some((r) => r.h === 1)).toBe(true);
  });

  it("points the other way when the stairs are west", () => {
    const g = state.grid!;
    const fog = createFog(g);
    revealAround(fog, g, 30, 30, 4);
    revealAround(fog, g, 5, 30, 2);
    state.stairs = { i: 5, j: 30 };

    const { ctx, rects } = stubCtx();
    drawFloorMap(ctx, g, fog, PX, PX, opts);

    const chev = chevronRects(rects);
    expect(chev.length).toBeGreaterThan(0);
    for (const r of chev) expect(r.x).toBeLessThan(PX * 0.25);
  });

  it("draws no chevron while the stairs are inside the window", () => {
    const g = state.grid!;
    const fog = createFog(g);
    revealAround(fog, g, 30, 30, 6);
    state.stairs = { i: 33, j: 30 }; // 3 tiles away, well inside 11

    const { ctx, rects } = stubCtx();
    drawFloorMap(ctx, g, fog, PX, PX, opts);
    expect(chevronRects(rects)).toHaveLength(0);
  });

  it("stays off the full-screen map, which has no off-screen", () => {
    const g = state.grid!;
    const fog = createFog(g);
    revealAround(fog, g, 30, 30, 4);
    revealAround(fog, g, 55, 30, 2);
    state.stairs = { i: 55, j: 30 };

    const { ctx, rects } = stubCtx();
    drawFloorMap(ctx, g, fog, PX, PX, { scale: 1, detail: "full" });
    expect(chevronRects(rects)).toHaveLength(0);
  });
});

/**
 * Room-archetype washes on the full map.
 *
 * These exist only because `startLevel` now stashes `plan.rooms` on
 * `state.levelRooms` — the plan used to be a local const, so the archetypes
 * were computed, used to furnish the floor, then thrown away and the map had
 * nothing to label. Worth pinning: the wash is a pure additive draw with no
 * visible failure mode, so a regression here would be silent.
 */
describe("room archetype wash", () => {
  const VAULT = "rgba(240,192,64,0.18)";

  beforeEach(() => {
    placePlayer(openGrid(), 30, 30);
    state.levelRooms = [];
  });

  function washRects(rects: Rect[], color: string): Rect[] {
    return rects.filter((r) => r.color === color);
  }

  it("washes a discovered vault room on the full map", () => {
    const g = state.grid!;
    const fog = createFog(g);
    revealAround(fog, g, 30, 30, 6);
    state.levelRooms = [{ i0: 28, j0: 28, w: 4, h: 4, kind: "vault" }];

    const { ctx, rects } = stubCtx();
    drawFloorMap(ctx, g, fog, PX, PX, { scale: 1, detail: "full" });
    expect(washRects(rects, VAULT).length).toBeGreaterThan(0);
  });

  it("does NOT wash undiscovered rooms — that would leak the floor plan", () => {
    // Same principle as the stairs chevron and the aggro-only enemy markers:
    // the map shows what you have SEEN, never what is out there.
    const g = state.grid!;
    const fog = createFog(g);
    revealAround(fog, g, 30, 30, 3);
    state.levelRooms = [{ i0: 50, j0: 50, w: 4, h: 4, kind: "vault" }];

    const { ctx, rects } = stubCtx();
    drawFloorMap(ctx, g, fog, PX, PX, { scale: 1, detail: "full" });
    expect(washRects(rects, VAULT)).toHaveLength(0);
  });

  it("stays off the minimap, where one room can fill the whole window", () => {
    const g = state.grid!;
    const fog = createFog(g);
    revealAround(fog, g, 30, 30, 6);
    state.levelRooms = [{ i0: 28, j0: 28, w: 4, h: 4, kind: "vault" }];

    const { ctx, rects } = stubCtx();
    // Minimap opts: windowed and "mini", the combination the wash opts out of.
    drawFloorMap(ctx, g, fog, PX, PX, { scale: TILE_PX, detail: "mini", window: WINDOW });
    expect(washRects(rects, VAULT)).toHaveLength(0);
  });

  it("draws nothing for an unknown archetype rather than guessing a colour", () => {
    const g = state.grid!;
    const fog = createFog(g);
    revealAround(fog, g, 30, 30, 6);
    state.levelRooms = [{ i0: 28, j0: 28, w: 4, h: 4, kind: "not-a-real-archetype" }];

    const { ctx, rects } = stubCtx();
    const before = rects.length;
    drawFloorMap(ctx, g, fog, PX, PX, { scale: 1, detail: "full" });
    // Only tiles and markers — no wash colour was invented for the unknown kind.
    expect(rects.every((r) => !r.color.startsWith("rgba("))).toBe(true);
    expect(rects.length).toBeGreaterThan(before);
  });
});
