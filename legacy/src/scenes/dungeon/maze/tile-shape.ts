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
// ROUND_x rounds the same corner a SLANT_x cuts, but with a quarter-circle arc
// (radius = 1 tile) instead of a straight diagonal — a curved wall the ball
// rolls around. The solid is a quarter-DISC centred on the corner OPPOSITE the
// cut; the arc faces the open (cut) corner. Backing legs are identical to the
// matching slant (they depend only on the cut corner).
export const SHAPE_ROUND_NE = 5;
export const SHAPE_ROUND_NW = 6;
export const SHAPE_ROUND_SE = 7;
export const SHAPE_ROUND_SW = 8;
// ARC marks a tile as one slice of a MULTI-TILE arc feature (radius 2+ sweeping
// curve — the pinball "ball guide"). The geometry lives OFF-GRID in
// `Grid.arcs[Grid.arcIdx[tile]]` (an ArcFeature), because a Uint8 can't carry a
// centre/radius/span; the shape id only says "ask the feature". Like every
// shaped tile it is transparent to the square sweep and resolved analytically —
// mesh (build.ts buildArcShells) and collider (resolveArcFeature) both read the
// SAME descriptor, so see = hit.
export const SHAPE_ARC = 9;

/** A tile-shape id (stored one-per-tile in `Grid.shapes`). */
export type TileShape = number;

export interface Vec2 {
  x: number;
  z: number;
}

export function isSlant(shape: TileShape): boolean {
  return shape >= SHAPE_SLANT_NE && shape <= SHAPE_SLANT_SW;
}

export function isRound(shape: TileShape): boolean {
  return shape >= SHAPE_ROUND_NE && shape <= SHAPE_ROUND_SW;
}

/** A slice of a multi-tile arc feature (see SHAPE_ARC / ArcFeature). */
export function isArc(shape: TileShape): boolean {
  return shape === SHAPE_ARC;
}

/** Any non-FULL shape — the tile is a prism/wedge/arc-slice, transparent to the square sweep. */
export function isShaped(shape: TileShape): boolean {
  return isSlant(shape) || isRound(shape) || isArc(shape);
}

/** Which corner a ROUND shape cuts, as the equivalent SLANT id (for shared tables). */
function roundToSlant(shape: TileShape): TileShape {
  return shape - (SHAPE_ROUND_NE - SHAPE_SLANT_NE);
}

/** The ROUND that cuts the same corner as a given SLANT (curved variant). */
export function slantToRound(shape: TileShape): TileShape {
  return shape + (SHAPE_ROUND_NE - SHAPE_SLANT_NE);
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

/** The two backing-neighbour offsets a shape needs solid, or null. Depends only
 * on the cut corner, so a ROUND maps to its matching SLANT. */
export function shapeBacking(shape: TileShape): readonly [Vec2, Vec2] | null {
  if (isRound(shape)) return SLANT_BACKING[roundToSlant(shape)] ?? null;
  return SLANT_BACKING[shape] ?? null;
}

// ── ROUND geometry: solid quarter-disc centred on the corner OPPOSITE the cut. ──
const ROUND_CENTER: Record<number, Vec2> = {
  [SHAPE_ROUND_NE]: { x: 0, z: 1 }, // cut NE → centre SW
  [SHAPE_ROUND_NW]: { x: 1, z: 1 }, // cut NW → centre SE
  [SHAPE_ROUND_SE]: { x: 0, z: 0 }, // cut SE → centre NW
  [SHAPE_ROUND_SW]: { x: 1, z: 0 }, // cut SW → centre NE
};
/** Sign of the open quadrant (centre → cut corner) — used to gate the arc to its
 * open side so it never pushes a ball sitting behind a backed leg. */
const ROUND_OPEN: Record<number, Vec2> = {
  [SHAPE_ROUND_NE]: { x: 1, z: -1 },
  [SHAPE_ROUND_NW]: { x: -1, z: -1 },
  [SHAPE_ROUND_SE]: { x: 1, z: 1 },
  [SHAPE_ROUND_SW]: { x: -1, z: 1 },
};

/** Tile-local arc centre for a ROUND shape (render + collision share it), or null. */
export function roundCenter(shape: TileShape): Vec2 | null {
  return ROUND_CENTER[shape] ?? null;
}
/**
 * Resolve a circle against a ROUND tile's quarter-disc (centre C grid coords,
 * radius 1). Returns the radial push-out + contact normal (which VARIES along
 * the arc — that's the curved ricochet), or null if clear / off the open side.
 */
function resolveCircleArc(px: number, pz: number, r: number, cx: number, cz: number, openX: number, openZ: number): { nx: number; nz: number; pen: number } | null {
  const dx = px - cx;
  const dz = pz - cz;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6 || d >= 1 + r) return null; // degenerate, or beyond the arc
  if (dx * openX < -1e-6 || dz * openZ < -1e-6) return null; // behind a backed leg
  return { nx: dx / d, nz: dz / d, pen: 1 + r - d };
}

/**
 * Unified collider for a shaped tile at (i, j): a slant resolves against its
 * triangle, a round against its quarter-disc arc. Returns the push-out normal +
 * penetration, or null. The one entry point collision.ts calls.
 */
export function resolveCircleShape(shape: TileShape, i: number, j: number, px: number, pz: number, r: number): { nx: number; nz: number; pen: number } | null {
  if (isSlant(shape)) {
    const tri = shapeTriangleAt(shape, i, j)!;
    return resolveCircleTriangle({ x: px, z: pz }, r, tri[0], tri[1], tri[2]);
  }
  if (isRound(shape)) {
    const c = ROUND_CENTER[shape];
    const o = ROUND_OPEN[shape];
    return resolveCircleArc(px, pz, r, i + c.x, j + c.z, o.x, o.z);
  }
  return null;
}

// ── MULTI-TILE ARC FEATURES — sweeping curved walls (radius 2+ tiles) ─────────

/**
 * One sweeping curved wall: a circular arc of radius `r` tiles centred at a
 * GRID-space point, solid on the INSIDE (d ≤ r — the wall bulges toward the
 * ball, the convex "ball guide" of a pinball table). Tiles the arc passes
 * through carry SHAPE_ARC + this feature's index; tiles fully inside stay FULL
 * squares (they back the arc against sweep leaks); tiles fully outside are
 * carved to floor by the authoring pass.
 *
 * Angles are in the atan2(z, x) frame (x east, z south): 0 = east, π/2 = south.
 * The solid span is [a0, a0 + span] going CCW-in-screen-terms (increasing
 * angle); span = 2π means a full round island.
 */
export interface ArcFeature {
  /** Arc centre in GRID coords (tile units; (0,0) = the grid's NW corner). */
  cx: number;
  cz: number;
  /** Radius in tiles. */
  r: number;
  /** Start angle (radians, atan2 frame). Ignored when span ≥ 2π. */
  a0: number;
  /** Angular extent (radians, > 0). 2π = full circle. */
  span: number;
  /**
   * Which side is wall. false/absent = solid INSIDE (d ≤ r): a convex guide the
   * ball sweeps around (island, rounded wall-mass corner). true = solid OUTSIDE
   * (d ≥ r): a concave bowl — a room's inner corner rounded into a curved
   * pocket the ball banks through.
   */
  solidOut?: boolean;
}

const TWO_PI = Math.PI * 2;

/** Is angle `ang` within [a0, a0+span] (mod 2π)? */
export function angleInSpan(ang: number, a0: number, span: number): boolean {
  if (span >= TWO_PI - 1e-9) return true;
  let rel = (ang - a0) % TWO_PI;
  if (rel < 0) rel += TWO_PI;
  return rel <= span + 1e-9;
}

/**
 * Resolve a circle (centre px,pz grid coords, radius r) against an arc
 * feature's curved face. Solid is INSIDE the arc, so contact happens at
 * d < f.r + r; the push-out is radial (normal VARIES along the sweep — the
 * curved ricochet, same contract as the single-tile rounds). Outside the
 * angular span the straight walls own the contact, so this returns null there.
 */
export function resolveArcFeature(f: ArcFeature, px: number, pz: number, r: number): { nx: number; nz: number; pen: number } | null {
  const dx = px - f.cx;
  const dz = pz - f.cz;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return null; // degenerate centre
  if (f.solidOut) {
    // Concave bowl: free space is d ≤ f.r − r; push back toward the centre.
    if (d <= f.r - r) return null;
    if (!angleInSpan(Math.atan2(dz, dx), f.a0, f.span)) return null;
    return { nx: -dx / d, nz: -dz / d, pen: d + r - f.r };
  }
  // Convex guide: free space is d ≥ f.r + r; push radially outward.
  if (d >= f.r + r) return null;
  if (!angleInSpan(Math.atan2(dz, dx), f.a0, f.span)) return null;
  return { nx: dx / d, nz: dz / d, pen: f.r + r - d };
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
