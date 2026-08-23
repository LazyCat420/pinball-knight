import { describe, it, expect } from "vitest";
import { paintSurfaces, SAFE_R } from "./surface-paint";
import { type Grid, T_WALL, T_FLOOR, setTile, surfaceAt, isWalkable, tileCenter, worldToTile } from "./generator";
import { material, MAT_ICE, MAT_MUD, WALL_STONE, FLOOR_STONE } from "../engine/surfaces";

/** An open room ringed by wall, big enough to hold several patches. */
function makeGrid(w = 40, h = 30): Grid {
  const g: Grid = { w, h, t: new Uint8Array(w * h).fill(T_WALL), shapes: new Uint8Array(w * h) };
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) setTile(g, i, j, T_FLOOR);
  return g;
}

function countPainted(g: Grid): number {
  let n = 0;
  for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) if (surfaceAt(g, i, j) !== 0) n++;
  return n;
}

describe("paintSurfaces", () => {
  it("is a no-op for an empty mix — an unpainted floor stays bit-identical", () => {
    // This is the guarantee that makes the whole system safe to merge: a floor
    // whose modifier carries no mix must play exactly as it did before.
    const g = makeGrid();
    expect(paintSurfaces(g, 1234, { mix: {}, coverage: 0.5 })).toBe(0);
    expect(g.surfaces).toBeUndefined(); // not even allocated
  });

  it("is a no-op at zero coverage", () => {
    const g = makeGrid();
    expect(paintSurfaces(g, 1234, { mix: { [MAT_ICE]: 1 }, coverage: 0 })).toBe(0);
  });

  it("paints something when asked", () => {
    const g = makeGrid();
    const n = paintSurfaces(g, 99, { mix: { [MAT_ICE]: 1 }, coverage: 0.4 });
    expect(n).toBeGreaterThan(0);
    expect(countPainted(g)).toBe(n);
  });

  it("is deterministic in (seed, grid, opts)", () => {
    const a = makeGrid();
    const b = makeGrid();
    const opts = { mix: { [MAT_ICE]: 2, [MAT_MUD]: 1 }, coverage: 0.35 };
    paintSurfaces(a, 4242, opts);
    paintSurfaces(b, 4242, opts);
    expect(Array.from(a.surfaces!)).toEqual(Array.from(b.surfaces!));
  });

  it("different seeds paint differently", () => {
    const a = makeGrid();
    const b = makeGrid();
    const opts = { mix: { [MAT_ICE]: 1 }, coverage: 0.35 };
    paintSurfaces(a, 1, opts);
    paintSurfaces(b, 2, opts);
    expect(Array.from(a.surfaces!)).not.toEqual(Array.from(b.surfaces!));
  });

  it("writes the WALL id into solid tiles and the FLOOR id into walkable ones", () => {
    // The one branch that matters. Getting it backwards would give every icy
    // floor mud physics, silently — both vocabularies are small integers.
    const g = makeGrid();
    paintSurfaces(g, 7, { mix: { [MAT_ICE]: 1 }, coverage: 0.9 });
    const ice = material(MAT_ICE);
    let sawWall = false;
    let sawFloor = false;
    for (let j = 0; j < g.h; j++) {
      for (let i = 0; i < g.w; i++) {
        const s = surfaceAt(g, i, j);
        if (s === 0) continue;
        if (isWalkable(g, i, j)) {
          expect(s).toBe(ice.floor);
          sawFloor = true;
        } else {
          expect(s).toBe(ice.wall);
          sawWall = true;
        }
      }
    }
    expect(sawFloor).toBe(true);
    expect(sawWall).toBe(true);
  });

  it("never moves a tile — topology is untouched", () => {
    // Painting must not be able to break reachability, which is what lets it
    // skip the whole floor-pipeline solvability re-check.
    const g = makeGrid();
    const before = Array.from(g.t);
    paintSurfaces(g, 31337, { mix: { [MAT_MUD]: 1 }, coverage: 0.8 });
    expect(Array.from(g.t)).toEqual(before);
  });

  it("keeps the start and stairs baseline", () => {
    // Mud underfoot on arrival reads as broken controls, not as terrain.
    const g = makeGrid();
    const start = tileCenter(g, 6, 6);
    const stairs = tileCenter(g, 33, 23);
    paintSurfaces(g, 5, { mix: { [MAT_MUD]: 1 }, coverage: 0.95, safeSpots: [start, stairs] });
    for (const spot of [worldToTile(g, start.x, start.z), worldToTile(g, stairs.x, stairs.z)]) {
      for (let dj = -SAFE_R; dj <= SAFE_R; dj++) {
        for (let di = -SAFE_R; di <= SAFE_R; di++) {
          const i = spot.i + di;
          const j = spot.j + dj;
          if (i < 0 || j < 0 || i >= g.w || j >= g.h) continue;
          expect(surfaceAt(g, i, j)).toBe(isWalkable(g, i, j) ? FLOOR_STONE : WALL_STONE);
        }
      }
    }
  });

  it("more coverage paints more", () => {
    const light = makeGrid();
    const heavy = makeGrid();
    paintSurfaces(light, 11, { mix: { [MAT_ICE]: 1 }, coverage: 0.1 });
    paintSurfaces(heavy, 11, { mix: { [MAT_ICE]: 1 }, coverage: 0.7 });
    expect(countPainted(heavy)).toBeGreaterThan(countPainted(light));
  });

  it("paints at least one patch even on a tiny floor with low coverage", () => {
    // Rounding to zero would make a floor silently ignore its own modifier.
    const g = makeGrid(12, 10);
    expect(paintSurfaces(g, 3, { mix: { [MAT_ICE]: 1 }, coverage: 0.01 })).toBeGreaterThan(0);
  });
});
