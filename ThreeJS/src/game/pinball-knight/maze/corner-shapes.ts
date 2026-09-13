import { arcContinuationTiles, hasCornerSquareJoins } from "./wall-junctions";
import { type Grid, at, T_WALL, idx, isWalkable, setShape, shapeAt } from "./generator";
import { SHAPE_FULL, SHAPE_SLANT_NE, SHAPE_SLANT_NW, SHAPE_SLANT_SE, SHAPE_SLANT_SW, shapeBacking, slantToRound, type TileShape } from "../engine/tile-shape";
import { runInteriorMask, runLengthMask } from "./wall-runs";

/**
 * Cut convex wall corners only. Shape names describe the open quadrant;
 * their two endpoints must terminate on exposed, permanent square wall faces.
 * Inward room corners need solid-out multi-tile arcs (arc-sweeps), not these
 * solid quarter-discs. Otherwise the visible ends are buried behind masonry.
 * Candidate discovery precedes assignment so adjacent corners cannot consume
 * each other's straight backing. The run policy additionally keeps stubs square.
 */
export function assignCornerShapes(g: Grid, policy: { grammar?: boolean } = {}): void {
  const arcJoins = arcContinuationTiles(g);
  const cand = new Int8Array(g.w * g.h).fill(-1); // -1 = none, else the TileShape
  // Geometry policy is shared by every renderer and co-op peer. Only explicit
  // headless A/B diagnostics may disable the run vetoes.
  const grammar = policy.grammar ?? true;
  const interior = grammar ? runInteriorMask(g, 3) : null;
  const runLen = grammar ? runLengthMask(g) : null;
  const NUB_MAX = 2;
  // Mix: ~3/4 of the corners CURVE, the rest bevel — deterministic by position.
  // (Was 50/50; playtest 07-23 read the maze as "still all boxes", so rounds
  // now dominate and the bevels are the accent.)
  const styled = (slant: TileShape, i: number, j: number): TileShape => ((i * 3 + j * 5) % 4 !== 1 ? slantToRound(slant) : slant);
  const put = (i: number, j: number, shape: TileShape): void => {
    if (arcJoins.has(idx(g, i, j))) return;
    // Skip tiles already claimed by a multi-tile arc sweep (shape ≠ FULL).
    if (i > 0 && j > 0 && i < g.w - 1 && j < g.h - 1 && at(g, i, j) === T_WALL && shapeAt(g, i, j) === SHAPE_FULL) cand[idx(g, i, j)] = shape;
  };

  // ── CONVEX corners (wall tips / pillars): shape the wall tile itself. ──
  for (let j = 1; j < g.h - 1; j++) {
    for (let i = 1; i < g.w - 1; i++) {
      if (at(g, i, j) !== T_WALL) continue;
      const N = isWalkable(g, i, j - 1);
      const S = isWalkable(g, i, j + 1);
      const E = isWalkable(g, i + 1, j);
      const W = isWalkable(g, i - 1, j);
      if (N && E && isWalkable(g, i + 1, j - 1) && !S && !W) put(i, j, styled(SHAPE_SLANT_NE, i, j));
      else if (N && W && isWalkable(g, i - 1, j - 1) && !S && !E) put(i, j, styled(SHAPE_SLANT_NW, i, j));
      else if (S && E && isWalkable(g, i + 1, j + 1) && !N && !W) put(i, j, styled(SHAPE_SLANT_SE, i, j));
      else if (S && W && isWalkable(g, i - 1, j + 1) && !N && !E) put(i, j, styled(SHAPE_SLANT_SW, i, j));
    }
  }

  // ── Pass 2: assign only where both backing legs stay solid FULL squares. ──
  const isCand = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < g.w && j < g.h && cand[idx(g, i, j)] >= 0;
  for (let j = 1; j < g.h - 1; j++) {
    for (let i = 1; i < g.w - 1; i++) {
      const shape = cand[idx(g, i, j)] as TileShape;
      if (shape < 0) continue;
      if (interior && interior[idx(g, i, j)]) continue; // V1 — no hole in a wall's middle
      if (runLen && runLen[idx(g, i, j)] <= NUB_MAX) continue; // V2 — nothing to round off
      const back = shapeBacking(shape)!;
      const b0i = i + back[0].x;
      const b0j = j + back[0].z;
      const b1i = i + back[1].x;
      const b1j = j + back[1].z;
      // Breakable walls cannot permanently support a curved shell.
      if (at(g, b0i, b0j) !== T_WALL || at(g, b1i, b1j) !== T_WALL) continue;
      if (isCand(b0i, b0j) || isCand(b1i, b1j)) continue; // backing would itself reshape
      // An arc-sweep slice is sweep-transparent — it can't back a leg either.
      if (shapeAt(g, b0i, b0j) !== SHAPE_FULL || shapeAt(g, b1i, b1j) !== SHAPE_FULL) continue;
      if (!hasCornerSquareJoins(g, i, j, shape)) continue;
      setShape(g, i, j, shape);
    }
  }
}

