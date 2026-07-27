import { describe, it, expect } from "vitest";
import { type Grid, T_FLOOR, T_WALL, tileCenter, generateMaze, thickenWalls, mulberry32, isWalkable, setTile, setShape } from "./maze/generator";
import { stampPrefabs, themeFor } from "./maze/prefabs";
import { circleCollides, moveCircle, wallContact, computeArcCorners } from "./collision";
import { SHAPE_SLANT_NE, SHAPE_ARC } from "./maze/tile-shape";

/** A 7x5 room: solid border, open interior, one pillar at (3,2). */
function room(): Grid {
  const w = 7;
  const h = 5;
  const t = new Uint8Array(w * h).fill(T_WALL);
  for (let j = 1; j < h - 1; j++) {
    for (let i = 1; i < w - 1; i++) t[j * w + i] = T_FLOOR;
  }
  t[2 * w + 3] = T_WALL; // pillar
  return { w, h, t, shapes: new Uint8Array(w * h) };
}

const R = 0.3;

describe("collision", () => {
  it("detects overlap with walls and clear space", () => {
    const g = room();
    const open = tileCenter(g, 1, 1);
    expect(circleCollides(g, open.x, open.z, R)).toBe(false);
    const pillar = tileCenter(g, 3, 2);
    expect(circleCollides(g, pillar.x, pillar.z, R)).toBe(true);
  });

  it("cannot walk through a wall", () => {
    const g = room();
    const start = tileCenter(g, 1, 2); // pillar is two tiles east at (3,2)
    let pos = { x: start.x, z: start.z };
    for (let i = 0; i < 100; i++) pos = moveCircle(g, pos.x, pos.z, R, 0.05, 0);
    // Stopped at the pillar's west face: circle centre ≤ tile edge - r.
    const pillarWestEdge = 3 - g.w / 2;
    expect(pos.x).toBeLessThanOrEqual(pillarWestEdge - R + 1e-3);
    expect(circleCollides(g, pos.x, pos.z, R)).toBe(false);
  });

  it("slides along a wall on diagonal input", () => {
    const g = room();
    const start = tileCenter(g, 2, 1); // against the north border wall
    let pos = { x: start.x, z: start.z };
    const before = pos.x;
    for (let i = 0; i < 40; i++) pos = moveCircle(g, pos.x, pos.z, R, 0.05, -0.05);
    expect(pos.x).toBeGreaterThan(before + 1); // kept moving east...
    expect(pos.z).toBeCloseTo(start.z, 0); // ...while the wall held north
    expect(circleCollides(g, pos.x, pos.z, R)).toBe(false);
  });

  it("a zero move is a no-op", () => {
    const g = room();
    const p = tileCenter(g, 1, 1);
    expect(moveCircle(g, p.x, p.z, R, 0, 0)).toEqual({ x: p.x, z: p.z, hitN: null, hitKick: null, hitLane: null });
  });
});

/**
 * BOOSTER LANES through the real collider. arc-lanes.test.ts covers the grain
 * maths in isolation; this asserts the wiring — that a lane authored on a grid
 * feature actually comes back out of `moveCircle`, tangent and all. That seam is
 * where a lane silently does nothing despite every unit test passing.
 */
describe("collision — booster lanes", () => {
  /** A big open room with ONE convex arc feature, wearing a lane over its span. */
  function laneRoom(cw: boolean): Grid {
    const w = 16;
    const h = 16;
    const t = new Uint8Array(w * h).fill(T_FLOOR);
    for (let i = 0; i < w; i++) {
      t[i] = T_WALL;
      t[(h - 1) * w + i] = T_WALL;
    }
    for (let j = 0; j < h; j++) {
      t[j * w] = T_WALL;
      t[j * w + w - 1] = T_WALL;
    }
    const g: Grid = { w, h, t, shapes: new Uint8Array(w * h), arcs: [], arcIdx: new Int16Array(w * h).fill(-1) };
    // A radius-3 quarter guide centred at grid (8,8), solid inside, wearing a
    // lane across its whole span.
    g.arcs!.push({
      cx: 8,
      cz: 8,
      r: 3,
      a0: 0,
      span: Math.PI / 2,
      lanes: [{ a0: 0, span: Math.PI / 2, cw, cooldownT: 0, hitT: -1 }],
    });
    // Mark the tiles the arc passes through as ARC slices pointing at feature 0.
    for (let j = 8; j <= 11; j++) {
      for (let i = 8; i <= 11; i++) {
        const d = Math.hypot(i + 0.5 - 8, j + 0.5 - 8);
        if (d > 2 && d < 4) {
          setTile(g, i, j, T_WALL);
          setShape(g, i, j, SHAPE_ARC);
          g.arcIdx![j * w + i] = 0;
        }
      }
    }
    return g;
  }

  /** Drive a circle into the arc face at `ang`, travelling `(dx,dz)`. */
  function probe(g: Grid, ang: number, dx: number, dz: number) {
    // Start just outside the face and move inward-ish along the given vector.
    const r = 3.55;
    const x = 8 + Math.cos(ang) * r - g.w / 2;
    const z = 8 + Math.sin(ang) * r - g.h / 2;
    return moveCircle(g, x, z, R, dx, dz);
  }

  it("reports a lane hit for a ball running WITH the grain", () => {
    const g = laneRoom(true);
    const ang = 0.6;
    // Tangent for cw at this angle, nudged inward so contact actually happens.
    const tx = -Math.sin(ang);
    const tz = Math.cos(ang);
    const inx = -Math.cos(ang) * 0.35;
    const inz = -Math.sin(ang) * 0.35;
    const res = probe(g, ang, tx * 0.3 + inx, tz * 0.3 + inz);
    expect(res.hitN).not.toBeNull();
    expect(res.hitLane).not.toBeNull();
    // The exit tangent must be a unit vector along the lane.
    expect(Math.hypot(res.hitLane!.tx, res.hitLane!.tz)).toBeCloseTo(1, 6);
    // …and must point the way the lane throws.
    expect(res.hitLane!.tx * tx + res.hitLane!.tz * tz).toBeGreaterThan(0.9);
  });

  it("reports NO lane for a ball running against the grain", () => {
    const g = laneRoom(true);
    const ang = 0.6;
    const tx = -Math.sin(ang);
    const tz = Math.cos(ang);
    const inx = -Math.cos(ang) * 0.35;
    const inz = -Math.sin(ang) * 0.35;
    // Same contact, opposite travel along the lane.
    const res = probe(g, ang, -tx * 0.3 + inx, -tz * 0.3 + inz);
    expect(res.hitN).not.toBeNull(); // still hits the wall…
    expect(res.hitLane).toBeNull(); // …but the lane does not grab it
  });

  it("a spent lane reports nothing until its cooldown clears", () => {
    const g = laneRoom(true);
    g.arcs![0].lanes![0].cooldownT = 0.5;
    const ang = 0.6;
    const tx = -Math.sin(ang);
    const tz = Math.cos(ang);
    const res = probe(g, ang, tx * 0.3 - Math.cos(ang) * 0.35, tz * 0.3 - Math.sin(ang) * 0.35);
    expect(res.hitN).not.toBeNull();
    expect(res.hitLane).toBeNull();
  });
});

describe("slant (shaped) collision", () => {
  /** A 7×7 open room with a single SLANT_NE wall at tile (3,3) (world origin),
   * backed by solid W (2,3) and S (3,4) neighbours — a real convex slant. */
  function slantRoom(): Grid {
    const w = 7;
    const h = 7;
    const t = new Uint8Array(w * h).fill(T_WALL);
    for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) t[j * w + i] = T_FLOOR;
    const g: Grid = { w, h, t, shapes: new Uint8Array(w * h) };
    setTile(g, 3, 3, T_WALL); // the slant tile
    setTile(g, 2, 3, T_WALL); // west backing leg
    setTile(g, 3, 4, T_WALL); // south backing leg
    setShape(g, 3, 3, SHAPE_SLANT_NE);
    return g;
  }

  it("is SOLID on the cut-off (SW) side and OPEN on the NE side", () => {
    const g = slantRoom(); // tile (3,3) centre is world (0,0)
    expect(circleCollides(g, -0.3, 0.3, 0.2)).toBe(true); // SW solid half
    expect(circleCollides(g, 0.3, -0.3, 0.2)).toBe(false); // NE open half — walkable
  });

  it("moveCircle into the diagonal pushes back along the NE normal", () => {
    const g = slantRoom();
    // Start on the open NE side, drive SW into the hypotenuse.
    const res = moveCircle(g, 0.35, -0.35, 0.25, -0.3, 0.3);
    expect(res.hitN).not.toBeNull();
    expect(res.hitN!.nx).toBeGreaterThan(0); // pushed east...
    expect(res.hitN!.nz).toBeLessThan(0); // ...and north → NE
    // And the resolved position is no longer penetrating the triangle.
    expect(circleCollides(g, res.x, res.z, 0.25)).toBe(false);
  });

  it("a move that never touches a slant reports hitN = null", () => {
    const g = slantRoom();
    const res = moveCircle(g, 1.2, 1.2, 0.25, 0.1, 0); // far in open floor
    expect(res.hitN).toBeNull();
  });
});

describe("computeArcCorners (curved walls)", () => {
  /** Build a grid from an ASCII map ('.' floor, '#' wall). Row 0 is j=0. */
  function fromAscii(rows: string[]): Grid {
    const h = rows.length;
    const w = rows[0].length;
    const t = new Uint8Array(w * h).fill(T_WALL);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) if (rows[j][i] === ".") t[j * w + i] = T_FLOOR;
    }
    return { w, h, t, shapes: new Uint8Array(w * h) };
  }

  it("rounds all four inner corners of a 2×2 open pocket", () => {
    // A lone 2×2 floor block: every one of its inner corners banks.
    const g = fromAscii([
      "#####",
      "#####",
      "#..##",
      "#..##",
      "#####",
    ]);
    const arcs = computeArcCorners(g);
    expect(arcs.length).toBe(4);
    // The NE crook sits on tile (2,2): open legs are West and South.
    const ne = arcs.find((a) => a.qi === 1 && a.qj === 0);
    expect(ne).toBeTruthy();
    const legs = new Set([`${ne!.d1x},${ne!.d1z}`, `${ne!.d2x},${ne!.d2z}`]);
    expect(legs.has("-1,0")).toBe(true); // west
    expect(legs.has("0,1")).toBe(true); // south
  });

  it("never places a curve on a 1-wide dogleg bend (no pinch)", () => {
    // An L-corridor one tile wide: the far diagonal is always wall, so the
    // gate rejects every corner — corridors stay their full width.
    const g = fromAscii([
      "####",
      "#.##",
      "#..#",
      "####",
    ]);
    expect(computeArcCorners(g)).toHaveLength(0);
  });

  it("finds the single inner corner where a corridor meets an open room", () => {
    // A 3×3 room with a 1-wide corridor poking east out of its middle row;
    // only genuine ≥2×2 inner corners qualify (the 4 room corners), never the
    // corridor mouth.
    const g = fromAscii([
      "######",
      "#...##",
      "#....#",
      "#...##",
      "######",
    ]);
    const arcs = computeArcCorners(g);
    // The room's four corners qualify; the corridor mouth tiles do not pinch.
    expect(arcs.length).toBeGreaterThanOrEqual(2);
    for (const a of arcs) {
      // Every reported leg is a unit cardinal.
      expect(Math.abs(a.d1x) + Math.abs(a.d1z)).toBe(1);
      expect(Math.abs(a.d2x) + Math.abs(a.d2z)).toBe(1);
      // The two legs are perpendicular (a genuine corner, not a straight).
      expect(Math.abs(a.d1x * a.d2x + a.d1z * a.d2z)).toBe(0);
    }
  });
});

describe("computeArcCorners on real generated mazes", () => {
  it("produces valid banks across depths (each on a floor tile with the right L)", () => {
    let totalArcs = 0;
    for (let level = 1; level <= 8; level++) {
      const rng = mulberry32(level * 2654435761);
      const raw = generateMaze(21, 15, rng);
      stampPrefabs(raw, rng, 4, themeFor(level));
      const g = thickenWalls(raw);
      const arcs = computeArcCorners(g);
      totalArcs += arcs.length;
      for (const a of arcs) {
        const i = Math.round(a.cx + g.w / 2 - 0.5);
        const j = Math.round(a.cz + g.h / 2 - 0.5);
        expect(isWalkable(g, i, j)).toBe(true); // the crook tile is floor
        // Both open legs point to floor; both wall dirs point to wall.
        expect(isWalkable(g, i + a.d1x, j + a.d1z)).toBe(true);
        expect(isWalkable(g, i + a.d2x, j + a.d2z)).toBe(true);
      }
    }
    expect(totalArcs).toBeGreaterThan(0); // the feature isn't dead on real maps
  });
});

describe("wallContact (wall-move detection)", () => {
  const PROBE = 0.14;

  it("returns null in open floor", () => {
    const g = room();
    const open = tileCenter(g, 3, 3); // interior, no adjacent wall within a body+probe
    // (3,3) sits one tile from every border in this 7x5 room's interior band.
    expect(wallContact(g, open.x, open.z, R, PROBE)).toBeNull();
  });

  it("points AWAY from a single wall the body is pressed against", () => {
    const g = room();
    // Slide east into the pillar's west face at (3,2), then probe.
    const start = tileCenter(g, 1, 2);
    let pos = { x: start.x, z: start.z };
    for (let i = 0; i < 100; i++) pos = moveCircle(g, pos.x, pos.z, R, 0.05, 0);
    const n = wallContact(g, pos.x, pos.z, R, PROBE);
    expect(n).not.toBeNull();
    expect(n!.nx).toBeLessThan(0); // wall is to the EAST → launch WEST (−x)
    expect(Math.abs(n!.nz)).toBeLessThan(0.01); // no north/south component
    expect(Math.hypot(n!.nx, n!.nz)).toBeCloseTo(1, 5); // unit normal
  });

  it("sums two faces into a diagonal in a corner", () => {
    const g = room();
    // Drive into the NW corner (north + west border walls both adjacent).
    const start = tileCenter(g, 3, 3);
    let pos = { x: start.x, z: start.z };
    for (let i = 0; i < 100; i++) pos = moveCircle(g, pos.x, pos.z, R, -0.05, -0.05);
    const n = wallContact(g, pos.x, pos.z, R, PROBE);
    expect(n).not.toBeNull();
    expect(n!.nx).toBeGreaterThan(0); // west wall → launch east (+x)
    expect(n!.nz).toBeGreaterThan(0); // north wall → launch south (+z)
    expect(Math.hypot(n!.nx, n!.nz)).toBeCloseTo(1, 5); // still normalised
  });
});
