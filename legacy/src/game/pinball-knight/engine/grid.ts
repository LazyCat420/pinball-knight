/**
 * TILE GRID — the substrate every spatial system in the engine reads.
 *
 * Extracted from `maze/generator.ts`. The split is between the DATA STRUCTURE
 * (a row-major tile array plus its accessors and world mapping — engine) and
 * the GENERATION of a maze into it (growing-tree, braiding, room carving,
 * secret walls — game content). Collision and the flow field only ever needed
 * the former, and taking the whole generator to get `at()` and `isWalkable()`
 * is what kept them tied to this game's level design.
 *
 * `generator.ts` re-exports everything here, so the ~40 modules that import
 * these names from their historical home keep working untouched.
 *
 * DELIBERATELY DOM- and three-free. Keep it pure — this and collision are the
 * game's real test surface.
 */

export const T_WALL = 0;
export const T_FLOOR = 1;
export const T_STAIRS = 2;
/**
 * A CRACKED wall — solid to collision like any wall, but pinball momentum past
 * SECRET_BREAK_SPEED shatters it (see secrets.ts). Placed by crackSecretWalls
 * on walls that separate two corridors, so every break opens a real shortcut.
 */
export const T_CRACKED = 3;

export interface Grid {
  w: number;
  h: number;
  /** Row-major tiles, `t[j * w + i]`. */
  t: Uint8Array;
  /**
   * Row-major per-tile SHAPE ids (tile-shape.ts), same layout as `t`. Default 0
   * = SHAPE_FULL (a plain square), so a grid that never assigns shapes behaves
   * exactly as before. Only meaningful on WALL tiles; walkability ignores it.
   */
  shapes: Uint8Array;
  /**
   * Multi-tile arc features (sweeping curved walls — tile-shape.ts ArcFeature).
   * A tile with SHAPE_ARC stores its feature's index in `arcIdx` (-1 = none).
   * OPTIONAL so hand-built test grids don't have to carry them; use
   * `ensureArcs(g)` before writing and `arcFeatureAt(g,i,j)` to read.
   */
  arcs?: import("./tile-shape").ArcFeature[];
  arcIdx?: Int16Array;
  /**
   * Row-major per-tile SURFACE ids (surfaces.ts) — what the tile is MADE OF.
   * Same layout as `t`. Default 0 is the neutral surface in BOTH vocabularies,
   * so a grid that never assigns one plays exactly as it did before surfaces
   * existed.
   *
   * One array serves walls and floors because a tile is never both: `isWalkable`
   * decides whether a byte means a WallSurface or a FloorSurface. OPTIONAL so
   * the ~40 hand-built test grids don't have to carry it; write through
   * `ensureSurfaces(g)` and read through `surfaceAt(g,i,j)`.
   */
  surfaces?: Uint8Array;
}

export interface TilePos {
  i: number;
  j: number;
}

export function idx(g: Grid, i: number, j: number): number {
  return j * g.w + i;
}

/** Tile lookup. Out of bounds reads as wall, so callers never bounds-check. */
export function at(g: Grid, i: number, j: number): number {
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return T_WALL;
  return g.t[idx(g, i, j)];
}

export function setTile(g: Grid, i: number, j: number, v: number): void {
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return;
  g.t[idx(g, i, j)] = v;
}

export function isWalkable(g: Grid, i: number, j: number): boolean {
  const t = at(g, i, j);
  return t === T_FLOOR || t === T_STAIRS;
}

/** Per-tile shape (tile-shape.ts). Out of bounds → 0 (SHAPE_FULL). */
export function shapeAt(g: Grid, i: number, j: number): number {
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return 0;
  return g.shapes[idx(g, i, j)];
}

export function setShape(g: Grid, i: number, j: number, v: number): void {
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return;
  g.shapes[idx(g, i, j)] = v;
}

/** Lazily create the arc-feature storage (see Grid.arcs). */
export function ensureArcs(g: Grid): void {
  if (!g.arcs) g.arcs = [];
  if (!g.arcIdx) g.arcIdx = new Int16Array(g.w * g.h).fill(-1);
}

/** The arc feature owning tile (i,j), or null (tile isn't an arc slice). */
export function arcFeatureAt(
  g: Grid,
  i: number,
  j: number,
): import("./tile-shape").ArcFeature | null {
  if (!g.arcs || !g.arcIdx) return null;
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return null;
  const a = g.arcIdx[idx(g, i, j)];
  return a >= 0 ? (g.arcs[a] ?? null) : null;
}

/** Lazily create the per-tile surface storage (see Grid.surfaces). */
export function ensureSurfaces(g: Grid): void {
  if (!g.surfaces) g.surfaces = new Uint8Array(g.w * g.h);
}

/**
 * Per-tile surface id (surfaces.ts). Out of bounds, or a grid that carries no
 * surface array, reads as 0 — the neutral surface in both tables — so every
 * caller can read unconditionally and the physics never branches on absence.
 */
export function surfaceAt(g: Grid, i: number, j: number): number {
  if (!g.surfaces) return 0;
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return 0;
  return g.surfaces[idx(g, i, j)];
}

export function setSurface(g: Grid, i: number, j: number, v: number): void {
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return;
  ensureSurfaces(g);
  g.surfaces![idx(g, i, j)] = v;
}

/**
 * World mapping: the maze is centred on the origin, one tile = one world unit,
 * so tile (i, j) occupies [i - w/2, i+1 - w/2] × [j - h/2, j+1 - h/2].
 */
export function tileCenter(g: Grid, i: number, j: number): { x: number; z: number } {
  return { x: i + 0.5 - g.w / 2, z: j + 0.5 - g.h / 2 };
}

export function worldToTile(g: Grid, x: number, z: number): TilePos {
  return { i: Math.floor(x + g.w / 2), j: Math.floor(z + g.h / 2) };
}
