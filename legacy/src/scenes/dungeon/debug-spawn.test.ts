/**
 * The spawn debugger's placement math. Pure, so it can be pinned exactly —
 * which matters more than usual here, because everything ELSE that uses this
 * (headless FX QA, AoE range checks) asserts against the horde it produces. A
 * layout that silently stacks two monsters on one tile would quietly weaken
 * every test built on top of it.
 */
import { describe, it, expect } from "vitest";
import { layoutOffsets, freeTileNear, resolveSpawnPoints } from "./debug-spawn";
import { type Grid, T_FLOOR, T_WALL, isWalkable, worldToTile } from "./maze/generator";

/** An open room with a wall shell. */
function room(w: number, h: number): Grid {
  const g: Grid = { w, h, t: new Uint8Array(w * h).fill(T_WALL), shapes: new Uint8Array(w * h) };
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) g.t[j * w + i] = T_FLOOR;
  return g;
}

describe("layoutOffsets", () => {
  it("puts everything on the centre when there is no ring", () => {
    expect(layoutOffsets({ count: 3 })).toEqual([
      { di: 0, dj: 0 },
      { di: 0, dj: 0 },
      { di: 0, dj: 0 },
    ]);
  });

  it("spreads a ring evenly at the requested radius", () => {
    const offs = layoutOffsets({ count: 8, ring: 3 });
    expect(offs).toHaveLength(8);
    for (const o of offs) expect(Math.hypot(o.di, o.dj)).toBeCloseTo(3, 6);
    // Evenly spaced: consecutive bearings differ by 2π/8.
    const angles = offs.map((o) => Math.atan2(o.dj, o.di));
    for (let k = 1; k < angles.length; k++) {
      let d = angles[k] - angles[k - 1];
      if (d < 0) d += Math.PI * 2;
      expect(d).toBeCloseTo(Math.PI / 4, 6);
    }
  });

  it("phase rotates the ring so repeat calls don't reuse the same bearings", () => {
    const a = layoutOffsets({ count: 4, ring: 2 })[0];
    const b = layoutOffsets({ count: 4, ring: 2, phase: 0.5 })[0];
    expect(Math.atan2(b.dj, b.di) - Math.atan2(a.dj, a.di)).toBeCloseTo(0.5, 6);
  });

  it("handles a zero/negative count without producing junk", () => {
    expect(layoutOffsets({ count: 0, ring: 3 })).toEqual([]);
    expect(layoutOffsets({ count: -2 })).toEqual([]);
  });
});

describe("freeTileNear", () => {
  it("returns the tile itself when it is open and unclaimed", () => {
    const g = room(12, 12);
    expect(freeTileNear(g, 5, 5, new Set())).toEqual({ i: 5, j: 5 });
  });

  it("never hands the same tile to two callers", () => {
    const g = room(12, 12);
    const taken = new Set<number>();
    const a = freeTileNear(g, 5, 5, taken)!;
    const b = freeTileNear(g, 5, 5, taken)!;
    expect(a).not.toEqual(b);
    expect(isWalkable(g, b.i, b.j)).toBe(true);
  });

  it("walks out of a wall onto real floor", () => {
    const g = room(12, 12);
    const spot = freeTileNear(g, 0, 0, new Set())!; // (0,0) is shell wall
    expect(isWalkable(g, spot.i, spot.j)).toBe(true);
  });

  it("gives up rather than lying when there is nowhere to stand", () => {
    const g: Grid = { w: 8, h: 8, t: new Uint8Array(64).fill(T_WALL), shapes: new Uint8Array(64) };
    expect(freeTileNear(g, 4, 4, new Set())).toBeNull();
  });
});

describe("resolveSpawnPoints", () => {
  it("places every monster on a DISTINCT walkable tile", () => {
    const g = room(24, 24);
    const pts = resolveSpawnPoints(g, 0, 0, { count: 10, ring: 4 });
    expect(pts).toHaveLength(10);
    const keys = new Set(pts.map((p) => `${p.i},${p.j}`));
    expect(keys.size).toBe(10); // no two on one tile
    for (const p of pts) expect(isWalkable(g, p.i, p.j)).toBe(true);
  });

  it("puts a ring at the requested range from the centre", () => {
    const g = room(24, 24);
    const pts = resolveSpawnPoints(g, 0, 0, { count: 8, ring: 4 });
    const c = worldToTile(g, 0, 0);
    for (const p of pts) {
      // Open room: snapping to tile centres is the only error, well under 1.
      expect(Math.hypot(p.i - c.i, p.j - c.j)).toBeCloseTo(4, 0);
    }
  });

  it("KEEPS THE RADIUS in a corridor instead of collapsing onto the centre", () => {
    // The regression that shipped in the first cut: every off-axis bearing is
    // wall, each slot walked back to the nearest floor — the knight's own lane —
    // and "8 at radius 3" came back at 0.0/1.0/1.41 tiles, i.e. standing on him.
    // A ring exists to put a horde at a KNOWN RANGE; losing the radius loses
    // the feature, losing some angular spread does not.
    const w = 40;
    const h = 9;
    const g: Grid = { w, h, t: new Uint8Array(w * h).fill(T_WALL), shapes: new Uint8Array(w * h) };
    for (let i = 1; i <= w - 2; i++) g.t[4 * w + i] = T_FLOOR; // one east-west lane
    const c = worldToTile(g, 0, 0);
    const pts = resolveSpawnPoints(g, 0, 0, { count: 6, ring: 5 });
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) {
      const d = Math.hypot(p.i - c.i, p.j - c.j);
      expect(d, `tile ${p.i},${p.j} sat at ${d.toFixed(2)} from a radius-5 request`).toBeGreaterThanOrEqual(3);
    }
    // And nobody is standing on the centre tile.
    expect(pts.some((p) => p.i === c.i && p.j === c.j)).toBe(false);
  });

  it("reports SHORT rather than stacking when the room can't hold them", () => {
    // A 1-wide corridor: nowhere near enough distinct tiles for 40.
    const g: Grid = { w: 12, h: 5, t: new Uint8Array(60).fill(T_WALL), shapes: new Uint8Array(60) };
    for (let i = 1; i <= 10; i++) g.t[2 * 12 + i] = T_FLOOR;
    const pts = resolveSpawnPoints(g, 0, 0, { count: 40, ring: 1 });
    expect(pts.length).toBeLessThan(40); // honest short count…
    expect(new Set(pts.map((p) => `${p.i},${p.j}`)).size).toBe(pts.length); // …still no stacking
  });
});
