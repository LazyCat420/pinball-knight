/**
 * Pure tests for the tile-shape model — the single source both the collider and
 * the wall mesh read. Pins the orientation convention (a slant is named by its
 * OPEN corner = outward normal), the triangle helpers, and the circle-vs-triangle
 * resolution collision.ts leans on.
 */
import { describe, it, expect } from "vitest";
import {
  SHAPE_FULL,
  SHAPE_SLANT_NE,
  SHAPE_SLANT_NW,
  SHAPE_SLANT_SE,
  SHAPE_SLANT_SW,
  SHAPE_ROUND_SE,
  SHAPE_ROUND_NE,
  isSlant,
  isRound,
  isShaped,
  shapeCorners,
  shapeNormal,
  shapeBacking,
  shapeTriangleAt,
  roundCenter,
  pointInTriangle,
  edgeOutwardNormal,
  resolveCircleTriangle,
  resolveCircleShape,
  type Vec2,
} from "./tile-shape";

const R2 = Math.SQRT1_2;

describe("shape model", () => {
  it("classifies slants vs full", () => {
    expect(isSlant(SHAPE_FULL)).toBe(false);
    for (const s of [SHAPE_SLANT_NE, SHAPE_SLANT_NW, SHAPE_SLANT_SE, SHAPE_SLANT_SW]) {
      expect(isSlant(s)).toBe(true);
      expect(shapeCorners(s)).toHaveLength(3);
    }
    expect(shapeCorners(SHAPE_FULL)).toBeNull();
    expect(shapeNormal(SHAPE_FULL)).toBeNull();
  });

  it("names a slant by its OPEN corner = outward normal direction", () => {
    // NE cut → normal points NE (+x,−z); etc.
    expect(shapeNormal(SHAPE_SLANT_NE)).toEqual({ x: R2, z: -R2 });
    expect(shapeNormal(SHAPE_SLANT_NW)).toEqual({ x: -R2, z: -R2 });
    expect(shapeNormal(SHAPE_SLANT_SE)).toEqual({ x: R2, z: R2 });
    expect(shapeNormal(SHAPE_SLANT_SW)).toEqual({ x: -R2, z: R2 });
  });

  it("the cut corner is NOT among the solid vertices", () => {
    // SLANT_NE cuts NE (1,0): solid corners must be NW, SW, SE.
    const tri = shapeCorners(SHAPE_SLANT_NE)!;
    const hasNE = tri.some((v) => v.x === 1 && v.z === 0);
    expect(hasNE).toBe(false);
    expect(tri).toHaveLength(3);
  });

  it("offsets the triangle into the caller's coordinate space", () => {
    const tri = shapeTriangleAt(SHAPE_SLANT_NE, 5, 7)!;
    // Every vertex shifted by (5,7); still spans one unit cell.
    for (const v of tri) {
      expect(v.x).toBeGreaterThanOrEqual(5);
      expect(v.x).toBeLessThanOrEqual(6);
      expect(v.z).toBeGreaterThanOrEqual(7);
      expect(v.z).toBeLessThanOrEqual(8);
    }
    expect(shapeTriangleAt(SHAPE_FULL, 0, 0)).toBeNull();
  });
});

describe("triangle helpers", () => {
  const a: Vec2 = { x: 0, z: 0 };
  const b: Vec2 = { x: 0, z: 1 };
  const c: Vec2 = { x: 1, z: 1 }; // SLANT_NE solid triangle

  it("pointInTriangle", () => {
    expect(pointInTriangle({ x: 0.3, z: 0.6 }, a, b, c)).toBe(true); // interior
    expect(pointInTriangle({ x: 0.8, z: 0.2 }, a, b, c)).toBe(false); // NE open side
  });

  it("edgeOutwardNormal points away from the interior (hypotenuse → NE)", () => {
    // Hypotenuse is a(0,0)→c(1,1); third vertex b(0,1) is the interior side.
    const n = edgeOutwardNormal(a, c, b);
    expect(n.x).toBeCloseTo(R2, 5);
    expect(n.z).toBeCloseTo(-R2, 5);
  });
});

describe("resolveCircleTriangle (collision core)", () => {
  // SLANT_NE at tile (0,0): solid = NW,SW,SE; hypotenuse NW(0,0)→SE(1,1).
  const tri = shapeTriangleAt(SHAPE_SLANT_NE, 0, 0)!;

  it("returns null when the circle is clear of the triangle", () => {
    // Well out on the open (NE) side.
    expect(resolveCircleTriangle({ x: 0.9, z: 0.1 }, 0.2, tri[0], tri[1], tri[2])).toBeNull();
  });

  it("pushes a circle grazing the hypotenuse out along the NE normal", () => {
    // Centre just NE of the diagonal, within r.
    const hit = resolveCircleTriangle({ x: 0.6, z: 0.4 }, 0.3, tri[0], tri[1], tri[2])!;
    expect(hit).not.toBeNull();
    expect(hit.nx).toBeCloseTo(R2, 3); // points NE
    expect(hit.nz).toBeCloseTo(-R2, 3);
    expect(hit.pen).toBeGreaterThan(0);
    // dist from (0.6,0.4) to line z=x is |0.6-0.4|/√2 ≈ 0.141; pen = r − dist.
    expect(hit.pen).toBeCloseTo(0.3 - 0.2 / Math.SQRT2, 2);
  });

  it("pushes a circle whose centre is INSIDE the solid out through the nearest face", () => {
    const hit = resolveCircleTriangle({ x: 0.3, z: 0.6 }, 0.2, tri[0], tri[1], tri[2])!;
    expect(hit).not.toBeNull();
    // Nearest face is the hypotenuse → normal NE, penetration = r + dist_to_edge.
    expect(hit.nx).toBeCloseTo(R2, 3);
    expect(hit.nz).toBeCloseTo(-R2, 3);
    expect(hit.pen).toBeGreaterThan(0.2); // r plus the inside distance
  });
});

describe("ROUND shapes + arc collision", () => {
  it("classifies rounds and shares backing with the matching slant", () => {
    expect(isRound(SHAPE_ROUND_SE)).toBe(true);
    expect(isSlant(SHAPE_ROUND_SE)).toBe(false);
    expect(isShaped(SHAPE_ROUND_SE)).toBe(true);
    expect(isShaped(SHAPE_SLANT_SE)).toBe(true);
    expect(isShaped(SHAPE_FULL)).toBe(false);
    // ROUND_SE and SLANT_SE cut the same corner → same backing legs (N + W).
    expect(shapeBacking(SHAPE_ROUND_SE)).toEqual(shapeBacking(SHAPE_SLANT_SE));
  });

  it("centres the quarter-disc on the corner opposite the cut", () => {
    expect(roundCenter(SHAPE_ROUND_SE)).toEqual({ x: 0, z: 0 }); // cut SE → centre NW
    expect(roundCenter(SHAPE_ROUND_NE)).toEqual({ x: 0, z: 1 }); // cut NE → centre SW
  });

  it("reflects the ball radially off the arc — a CURVED normal that varies", () => {
    // ROUND_SE at tile (0,0): solid quarter-disc centred at NW (0,0), r=1, arc
    // faces SE. A ball on the SE side within reach is pushed radially out.
    const a = resolveCircleShape(SHAPE_ROUND_SE, 0, 0, 0.9, 0.62, 0.25)!;
    const b = resolveCircleShape(SHAPE_ROUND_SE, 0, 0, 0.62, 0.9, 0.25)!;
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    for (const h of [a, b]) {
      expect(h.nx).toBeGreaterThan(0);
      expect(h.nz).toBeGreaterThan(0);
      expect(Math.hypot(h.nx, h.nz)).toBeCloseTo(1, 5); // unit normal
    }
    // The normals DIFFER along the arc — a curve, not one flat face.
    expect(Math.abs(a.nx - b.nx)).toBeGreaterThan(0.1);
  });

  it("does not collide beyond the arc's reach or behind a backed leg", () => {
    expect(resolveCircleShape(SHAPE_ROUND_SE, 0, 0, 1.9, 1.9, 0.25)).toBeNull(); // too far
    expect(resolveCircleShape(SHAPE_ROUND_SE, 0, 0, -0.5, -0.5, 0.25)).toBeNull(); // behind legs
  });
});
