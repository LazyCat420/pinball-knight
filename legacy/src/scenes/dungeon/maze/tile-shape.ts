/**
 * TILE SHAPES — the single source of truth that lets a maze tile be something
 * other than a box.
 *
 * The maze grid (generator.ts) says only WALL/FLOOR per tile. A parallel
 * `shapes` array lets a WALL tile additionally carry a SHAPE: today FULL (the
 * whole square, the default) or one of four 45° SLANTs. The SAME derivation
 * here feeds BOTH the collider (collision.ts) and the wall mesh (build.ts), so
 * what you see and what you hit can never disagree — the bug the old
 * "curve court" had (a smooth shell painted over square colliders).
 *
 * A SLANT turns the tile's SOLID region into a right triangle = half the unit
 * cell; the hypotenuse faces the open floor. We name a slant by its OPEN (cut)
 * corner, which is ALSO the outward-normal direction and the ricochet direction
 * — self-documenting physics. Directions: North = −z, South = +z, East = +x,
 * West = −x (matches build.ts's Diablo rim rule).
 *
 *   SLANT_NE : open corner NE, normal (+1,−1)/√2, backed by W + S neighbours
 *   SLANT_NW : open corner NW, normal (−1,−1)/√2, backed by E + S neighbours
 *   SLANT_SE : open corner SE, normal (+1,+1)/√2, backed by N + W neighbours
 *   SLANT_SW : open corner SW, normal (−1,+1)/√2, backed by N + E neighbours
 *
 * NB: this "named by open corner" convention is the INVERSE of
 * `computeArcCorners`'s crook naming (keyed by the SOLID diagonal). Cross-check
 * carefully if you ever map between the two.
 *
 * Coordinates are TILE-LOCAL, in [0,1]² with the tile's NW corner at (0,0):
 * x runs east, z runs south. `shapeTriangleAt` offsets these into whatever
 * space the caller works in (collision uses grid coords; build uses world).
 * DOM- and three-free: tested.
 */

export const SHAPE_FULL = 0;
export const SHAPE_SLANT_NE = 1;
export const SHAPE_SLANT_NW = 2;
export const SHAPE_SLANT_SE = 3;
export const SHAPE_SLANT_SW = 4;

/** A tile-shape id (stored one-per-tile in `Grid.shapes`). */
export type TileShape = number;

export interface Vec2 {
  x: number;
  z: number;
}

export function isSlant(shape: TileShape): boolean {
  return shape >= SHAPE_SLANT_NE && shape <= SHAPE_SLANT_SW;
}

// The four unit-cell corners (tile-local).
const NW: Vec2 = { x: 0, z: 0 };
const NE: Vec2 = { x: 1, z: 0 };
const SW: Vec2 = { x: 0, z: 1 };
const SE: Vec2 = { x: 1, z: 1 };

const SQRT1_2 = Math.SQRT1_2;

/**
 * The three SOLID corners of a slant tile (tile-local, wound so consumers can
 * read them directly). The cut corner is the one NOT listed.
 */
const SLANT_TRIS: Record<number, readonly [Vec2, Vec2, Vec2]> = {
  [SHAPE_SLANT_NE]: [NW, SW, SE], // cut NE
  [SHAPE_SLANT_NW]: [NE, SE, SW], // cut NW
  [SHAPE_SLANT_SE]: [NE, NW, SW], // cut SE
  [SHAPE_SLANT_SW]: [NE, NW, SE], // cut SW
};

/** The outward unit normal of a slant's hypotenuse (points at the open corner). */
const SLANT_NORMALS: Record<number, Vec2> = {
  [SHAPE_SLANT_NE]: { x: SQRT1_2, z: -SQRT1_2 },
  [SHAPE_SLANT_NW]: { x: -SQRT1_2, z: -SQRT1_2 },
  [SHAPE_SLANT_SE]: { x: SQRT1_2, z: SQRT1_2 },
  [SHAPE_SLANT_SW]: { x: -SQRT1_2, z: SQRT1_2 },
};

/** The two neighbour offsets whose walls must be solid to "back" a slant's legs. */
const SLANT_BACKING: Record<number, readonly [Vec2, Vec2]> = {
  [SHAPE_SLANT_NE]: [{ x: -1, z: 0 }, { x: 0, z: 1 }], // W, S
  [SHAPE_SLANT_NW]: [{ x: 1, z: 0 }, { x: 0, z: 1 }], // E, S
  [SHAPE_SLANT_SE]: [{ x: 0, z: -1 }, { x: -1, z: 0 }], // N, W
  [SHAPE_SLANT_SW]: [{ x: 0, z: -1 }, { x: 1, z: 0 }], // N, E
};

/** Tile-local solid corners for a slant (or null for FULL / unknown). */
export function shapeCorners(shape: TileShape): readonly [Vec2, Vec2, Vec2] | null {
  return SLANT_TRIS[shape] ?? null;
}

/** The hypotenuse outward normal (unit) for a slant, or null. */
export function shapeNormal(shape: TileShape): Vec2 | null {
  return SLANT_NORMALS[shape] ?? null;
}

/** The two backing-neighbour offsets a slant needs solid, or null. */
export function shapeBacking(shape: TileShape): readonly [Vec2, Vec2] | null {
  return SLANT_BACKING[shape] ?? null;
}

/**
 * The three solid-triangle vertices of a slant at tile (i, j), offset into the
 * caller's coordinate space (grid coords for collision, world for render — pass
 * the tile's min-corner origin). Returns null for FULL.
 */
export function shapeTriangleAt(shape: TileShape, i: number, j: number): [Vec2, Vec2, Vec2] | null {
  const tri = SLANT_TRIS[shape];
  if (!tri) return null;
  return [
    { x: i + tri[0].x, z: j + tri[0].z },
    { x: i + tri[1].x, z: j + tri[1].z },
    { x: i + tri[2].x, z: j + tri[2].z },
  ];
}

// ── 2D geometry helpers (x/z plane) — used by collision.resolveShaped ──

/** Squared distance. */
function d2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

/** Closest point on segment a→b to point p. */
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz || 1e-12;
  let t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: a.x + abx * t, z: a.z + abz * t };
}

/** Is point p inside triangle (a,b,c)? (winding-independent sign test) */
export function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = sign(p, a, b);
  const d2s = sign(p, b, c);
  const d3 = sign(p, c, a);
  const hasNeg = d1 < 0 || d2s < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2s > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function sign(p: Vec2, a: Vec2, b: Vec2): number {
  return (p.x - b.x) * (a.z - b.z) - (a.x - b.x) * (p.z - b.z);
}

/**
 * Outward unit normal of the edge (a→b) of a triangle whose third vertex is
 * `third` — the perpendicular pointing AWAY from the triangle interior.
 */
export function edgeOutwardNormal(a: Vec2, b: Vec2, third: Vec2): Vec2 {
  let nx = b.z - a.z; // perpendicular to the edge
  let nz = -(b.x - a.x);
  // Flip so it points away from the third vertex (the interior side).
  const mx = third.x - (a.x + b.x) / 2;
  const mz = third.z - (a.z + b.z) / 2;
  if (nx * mx + nz * mz > 0) {
    nx = -nx;
    nz = -nz;
  }
  const len = Math.hypot(nx, nz) || 1;
  return { x: nx / len, z: nz / len };
}

/**
 * Resolve a circle (centre p, radius r) against a solid triangle. Returns the
 * push-out delta to apply to the centre and the contact NORMAL (unit), or null
 * if the circle doesn't touch the triangle.
 *
 * - Circle centre INSIDE the triangle → push out through the nearest edge.
 * - Centre outside but within r of the boundary → push along (centre − closest).
 */
export function resolveCircleTriangle(
  p: Vec2,
  r: number,
  a: Vec2,
  b: Vec2,
  c: Vec2,
): { nx: number; nz: number; pen: number } | null {
  if (pointInTriangle(p, a, b, c)) {
    // Deepest edge = smallest distance from centre to an edge; push out there.
    const edges: Array<[Vec2, Vec2, Vec2]> = [
      [a, b, c],
      [b, c, a],
      [c, a, b],
    ];
    let bestDist = Infinity;
    let bestN: Vec2 = { x: 0, z: 0 };
    for (const [e0, e1, third] of edges) {
      const q = closestOnSegment(p, e0, e1);
      const dist = Math.sqrt(d2(p.x, p.z, q.x, q.z));
      if (dist < bestDist) {
        bestDist = dist;
        bestN = edgeOutwardNormal(e0, e1, third);
      }
    }
    return { nx: bestN.x, nz: bestN.z, pen: r + bestDist };
  }
  // Outside: closest point over the three edges.
  const edges: Array<[Vec2, Vec2]> = [
    [a, b],
    [b, c],
    [c, a],
  ];
  let best: Vec2 | null = null;
  let bestD2 = Infinity;
  for (const [e0, e1] of edges) {
    const q = closestOnSegment(p, e0, e1);
    const dd = d2(p.x, p.z, q.x, q.z);
    if (dd < bestD2) {
      bestD2 = dd;
      best = q;
    }
  }
  if (!best || bestD2 >= r * r) return null;
  const dist = Math.sqrt(bestD2) || 1e-6;
  return { nx: (p.x - best.x) / dist, nz: (p.z - best.z) / dist, pen: r - dist };
}
