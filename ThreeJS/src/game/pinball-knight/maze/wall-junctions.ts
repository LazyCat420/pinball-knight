/** Geometric connections between wall faces. Tile adjacency alone is not a join. */
import { at, idx, isWalkable, shapeAt, T_WALL, type Grid } from "./generator";
import { SHAPE_ARC, SHAPE_FULL, isRound, isSlant, roundCenter, slantToRound, type TileShape, type ArcFeature } from "../engine/tile-shape";

export interface WallPort {
  x: number;
  z: number;
  /** Along the face, pointing OUT of this piece. */
  tx: number;
  tz: number;
  /** Normal toward open floor, not toward the solid backing. */
  nx: number;
  nz: number;
}

const EPS = 1e-5;
const TAU = Math.PI * 2;

export function arcPorts(f: ArcFeature): WallPort[] {
  if (f.span >= TAU - EPS) return []; // closed island: no ends to attach
  return [0, 1].map((end) => {
    const a = f.a0 + end * f.span;
    const dx = Math.cos(a), dz = Math.sin(a);
    const direction = end === 0 ? -1 : 1;
    const solid = f.solidOut ? -1 : 1;
    return { x: f.cx + dx * f.r, z: f.cz + dz * f.r,
      tx: -dz * direction, tz: dx * direction, nx: dx * solid, nz: dz * solid };
  });
}

/** The square wall beyond a cardinal endpoint, if its exposed face is flush. */
function squareContinuation(g: Grid, p: WallPort): number | null {
  if (Math.min(Math.abs(p.nx), Math.abs(p.nz)) > EPS) return null;
  const faceCoord = Math.abs(p.nx) > 0.5 ? p.x : p.z;
  if (Math.abs(faceCoord - Math.round(faceCoord)) > EPS) return null;
  const x = p.x + p.tx * 0.25, z = p.z + p.tz * 0.25;
  const i = Math.floor(x - p.nx * 0.25), j = Math.floor(z - p.nz * 0.25);
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return null;
  if (at(g, i, j) !== T_WALL || shapeAt(g, i, j) !== SHAPE_FULL) return null;
  // An embedded end meets the back of a block, not the visible continuation.
  if (!isWalkable(g, Math.floor(x + p.nx * 0.25), Math.floor(z + p.nz * 0.25))) return null;
  return idx(g, i, j);
}

/** Author a fillet only where both straight wall faces reach its tangent points. */
export function hasSquareJoins(g: Grid, f: ArcFeature): boolean {
  return arcPorts(f).every(p => squareContinuation(g, p) !== null);
}

/**
 * Rounds and bevels share their endpoints and square backing faces. A bevel
 * intentionally turns 45 degrees at each end; use the equivalent round's
 * cardinal ports to locate its straight terminals, not its diagonal tangent.
 */
export function hasCornerSquareJoins(g: Grid, i: number, j: number, shape: TileShape = shapeAt(g, i, j)): boolean {
  if (!isRound(shape) && !isSlant(shape)) return false;
  const c = roundCenter(isSlant(shape) ? slantToRound(shape) : shape)!;
  const dx = c.x === 0 ? 1 : -1, dz = c.z === 0 ? 1 : -1;
  // Convex shell only: both sides and the cut quadrant must face open floor.
  if (!isWalkable(g, i + dx, j) || !isWalkable(g, i, j + dz) || !isWalkable(g, i + dx, j + dz)) return false;
  const a0 = c.x === 0 ? (c.z === 0 ? 0 : -Math.PI / 2) : (c.z === 0 ? Math.PI / 2 : Math.PI);
  return hasSquareJoins(g, { cx: i + c.x, cz: j + c.z, r: 1, a0, span: Math.PI / 2 });
}

/** Find tile corners whose orientation or straight terminals no longer fit. */
export function findBrokenCornerJoins(g: Grid): number[] {
  const broken: number[] = [];
  for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
    const shape = shapeAt(g, i, j);
    if (at(g, i, j) === T_WALL && (isRound(shape) || isSlant(shape)) && !hasCornerSquareJoins(g, i, j)) broken.push(idx(g, i, j));
  }
  return broken;
}

/** Keep a later corner-decoration pass from cutting off a curve's landing. */
export function arcContinuationTiles(g: Grid): Set<number> {
  const out = new Set<number>();
  for (const f of g.arcs ?? []) for (const p of arcPorts(f)) {
    const k = squareContinuation(g, p);
    if (k !== null) out.add(k);
  }
  return out;
}

export interface BrokenWallJoin { feature: number; end: number; port: WallPort }

/** Every ordinary curve must end on straight square masonry on both sides. */
export function findBrokenWallJoins(g: Grid): BrokenWallJoin[] {
  const ports = (g.arcs ?? []).map(arcPorts);
  const broken: BrokenWallJoin[] = [];
  for (let fi = 0; fi < ports.length; fi++) for (let end = 0; end < ports[fi].length; end++) {
    // Doorway jaws are authored conic chains with intentional throat ends,
    // not fillets between straight wall runs. Their paired-arm, backing and
    // chain continuity contract belongs to doorway-funnels/conic-fit. Do not
    // dismantle that assembly to impose a circular-fillet terminal rule.
    if (g.arcs![fi].owner === "funnel") continue;
    const p = ports[fi][end];
    if (squareContinuation(g, p) !== null) continue;
    broken.push({ feature: fi, end, port: p });
  }
  return broken;
}

/**
 * A broken curve falls back to its existing square masonry. Never rotate a
 * mesh independently of collision, or fill/carve floor to disguise a bad join.
 * Recheck after each batch: removing one link can expose the end of another.
 */
export function enforceWallJoins(g: Grid): number {
  let removed = 0;
  // Validate against one snapshot, then restore rejected shapes together. This
  // avoids row-order winners when two incompatible corners touch each other.
  for (const k of findBrokenCornerJoins(g)) {
    g.shapes[k] = SHAPE_FULL;
    if (g.arcIdx) g.arcIdx[k] = -1;
    removed++;
  }
  while (g.arcs?.length && g.arcIdx) {
    const bad = new Set(findBrokenWallJoins(g).map(x => x.feature));
    if (!bad.size) break;
    const remap = new Int32Array(g.arcs.length).fill(-1);
    const next: ArcFeature[] = [];
    for (let fi = 0; fi < g.arcs.length; fi++) {
      if (bad.has(fi)) continue;
      remap[fi] = next.length;
      next.push(g.arcs[fi]);
    }
    for (let k = 0; k < g.shapes.length; k++) {
      if (g.shapes[k] !== SHAPE_ARC) continue;
      const fi = g.arcIdx[k];
      const to = fi >= 0 && fi < remap.length ? remap[fi] : -1;
      g.arcIdx[k] = to;
      if (to < 0) g.shapes[k] = SHAPE_FULL;
    }
    removed += bad.size;
    g.arcs = next;
  }
  return removed;
}
