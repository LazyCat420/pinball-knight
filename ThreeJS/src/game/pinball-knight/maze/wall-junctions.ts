/** Geometric connections between wall faces. Tile adjacency alone is not a join. */
import { at, idx, isWalkable, shapeAt, T_WALL, type Grid } from "./generator";
import { SHAPE_ARC, SHAPE_FULL, isRound, isSlant, roundCenter, shapeNormal, shapeCorners, type ArcFeature } from "../engine/tile-shape";

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

/** Same endpoint and floor side, with each piece continuing away from the other. */
export function portsMatch(a: WallPort, b: WallPort): boolean {
  return Math.hypot(a.x - b.x, a.z - b.z) < EPS &&
    a.tx * b.tx + a.tz * b.tz < -1 + EPS &&
    a.nx * b.nx + a.nz * b.nz > 1 - EPS;
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

function tilePorts(g: Grid, i: number, j: number): WallPort[] {
  if (at(g, i, j) !== T_WALL) return [];
  const shape = shapeAt(g, i, j);
  if (isRound(shape)) {
    const c = roundCenter(shape)!;
    const a0 = c.x === 0 ? (c.z === 0 ? 0 : -Math.PI / 2) : (c.z === 0 ? Math.PI / 2 : Math.PI);
    return arcPorts({ cx: i + c.x, cz: j + c.z, r: 1, a0, span: Math.PI / 2 });
  }
  if (isSlant(shape)) {
    const n = shapeNormal(shape)!;
    // The diagonal is the only edge with two changing coordinates.
    const points = shapeCorners(shape)!;
    for (let k = 0; k < 3; k++) {
      const a = points[k], b = points[(k + 1) % 3];
      if (a.x === b.x || a.z === b.z) continue;
      const tx = (b.x - a.x) / Math.SQRT2, tz = (b.z - a.z) / Math.SQRT2;
      return [
        { x: i + a.x, z: j + a.z, tx: -tx, tz: -tz, nx: n.x, nz: n.z },
        { x: i + b.x, z: j + b.z, tx, tz, nx: n.x, nz: n.z },
      ];
    }
  }
  return [];
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

/** Judge the actual drawn endpoints against square, bevel, round and arc faces. */
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
    if (ports.some((other, oi) => oi !== fi && other.some(q => portsMatch(p, q)))) continue;
    // At an integer corner up to four tile-local shapes may meet this point.
    let connected = false;
    for (let j = Math.floor(p.z - EPS); j <= Math.floor(p.z + EPS); j++) {
      for (let i = Math.floor(p.x - EPS); i <= Math.floor(p.x + EPS); i++) {
        if (tilePorts(g, i, j).some(q => portsMatch(p, q))) connected = true;
      }
    }
    if (!connected) broken.push({ feature: fi, end, port: p });
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
