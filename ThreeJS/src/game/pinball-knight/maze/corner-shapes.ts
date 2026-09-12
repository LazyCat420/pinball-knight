import { arcContinuationTiles } from "./wall-junctions";
import { type Grid, at, T_WALL, idx, isWalkable, setShape, shapeAt } from "./generator";
import { SHAPE_FULL, SHAPE_SLANT_NE, SHAPE_SLANT_NW, SHAPE_SLANT_SE, SHAPE_SLANT_SW, shapeBacking, slantToRound, type TileShape } from "../engine/tile-shape";
import { runInteriorMask, runLengthMask } from "./wall-runs";

/**
 * Reshape wall corners into 45° SLANTS and quarter-round CURVES (tile-shape.ts):
 * the maze stops being all right angles. Rendered AND collided from the one
 * shape (build.ts + collision.ts). Two families of corner:
 *
 *  - CONVEX (a wall tip / pillar corner): a WALL tile with FLOOR on two adjacent
 *    cardinals + their shared diagonal, the other two cardinals solid.
 *  - CONCAVE (a room corner / wide bend): the SOLID DIAGONAL wall tile of an
 *    inner "crook" — detected with the SAME gate as collision.computeArcCorners
 *    (a ≥2×2 open pocket, so 1-wide dogleg turns are excluded → tight corridors
 *    stay square, the "rooms + wide bends only" rule). We cut the diagonal
 *    tile's corner that faces the open crook.
 *
 * Each candidate is SLANT or ROUND by a deterministic per-tile hash (mixed
 * patterns). Two passes so a reshape never strips its own backing: a shaped
 * tile is transparent to the square sweep (collision.blocksSquare), so its two
 * legs are held by backing-neighbour SQUARES — a corner is reshaped only when
 * BOTH backing neighbours stay full squares (not themselves candidates). Leaves
 * tiny 2×2 nubs square and never opens a leak.
 */
export function assignCornerShapes(g: Grid, policy: { grammar?: boolean } = {}): void {
  const arcJoins = arcContinuationTiles(g);
  const cand = new Int8Array(g.w * g.h).fill(-1); // -1 = none, else the TileShape
  /**
   * WHERE A CURVE IS ALLOWED TO LAND (maze/wall-runs.ts).
   *
   * Measured over 31 floors before this existed: 41,484 wall boxes fell into
   * 16,260 runs — a mean of 2.55 tiles — and the single commonest thing ENDING
   * a run was a shaped tile, 10,755 of them, ahead of "the wall genuinely
   * stops" at 10,116. The curves were not decorating the walls; they were
   * cutting them up. A round shell is drawn CAPLESS, so one in the middle of a
   * wall is a hole in that wall's top surface, and the two halves left either
   * side read as separate lumps — which is exactly the complaint this answers.
   *
   * Two vetoes, both computed on the grid as it stands BEFORE any shape is
   * assigned, which is the wall the player would have seen without the curve:
   *
   *   V1  a candidate in the MIDDLE of a run of 3+ tiles. Only concave crooks
   *       can be interior — a convex tip has floor on one side of each axis —
   *       so this is precisely the "hole punched in a continuous wall" case.
   *   V2  a candidate on a run of 1-2 tiles. There is no wall left to end:
   *       curving a stub that short turns the whole thing into ornament.
   *
   * A curve at the END of a real wall is untouched, which is the shape the
   * complaint actually asked for: rounded ends, straight middles.
   *
   * ── WHICH ONE ACTUALLY DOES THE WORK, measured over the same 31 floors ──
   *                         shells   run ends cut by a curve
   *   as shipped              8291                    10755
   *   V1 only                 8182                    10511
   *   V2 only                 3360                     5684
   *   V1 + V2                 3251                     5459
   *
   * V1 was the hypothesis and it is worth ~1%: a curve genuinely stranded in
   * the middle of a long wall is rare. **60% of every quarter-round shell on a
   * floor is stuck to a wall fragment one or two tiles long** — they are not
   * decorating walls, they are decorating debris, which is what "clusters of
   * edge pieces trying to make a corner or a wall" turned out to mean. V1 is
   * kept because it is free and the defect it names is real, but the number
   * belongs to V2 and the record should say so.
   */
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

  // ── CONCAVE corners (room / wide-bend inner corners): shape the SOLID DIAGONAL
  // wall tile, cutting the corner that faces the open crook. Same gate as
  // computeArcCorners (far diagonal must be open) → 1-wide turns stay square. ──
  const floor = (i: number, j: number): boolean => isWalkable(g, i, j);
  const wall = (i: number, j: number): boolean => !isWalkable(g, i, j);
  // Per crook: two wall dirs, the solid diagonal, far diagonal, two open legs,
  // and the corner the diagonal tile cuts (facing the crook).
  const crooks = [
    { wa: [0, -1], wb: [1, 0], diag: [1, -1], opp: [-1, 1], l1: [-1, 0], l2: [0, 1], cut: SHAPE_SLANT_SW }, // NE crook → diag SW-cut
    { wa: [0, -1], wb: [-1, 0], diag: [-1, -1], opp: [1, 1], l1: [1, 0], l2: [0, 1], cut: SHAPE_SLANT_SE }, // NW → SE
    { wa: [0, 1], wb: [1, 0], diag: [1, 1], opp: [-1, -1], l1: [-1, 0], l2: [0, -1], cut: SHAPE_SLANT_NW }, // SE → NW
    { wa: [0, 1], wb: [-1, 0], diag: [-1, 1], opp: [1, -1], l1: [1, 0], l2: [0, -1], cut: SHAPE_SLANT_NE }, // SW → NE
  ] as const;
  for (let j = 1; j < g.h - 1; j++) {
    for (let i = 1; i < g.w - 1; i++) {
      if (!floor(i, j)) continue;
      for (const c of crooks) {
        if (
          wall(i + c.wa[0], j + c.wa[1]) &&
          wall(i + c.wb[0], j + c.wb[1]) &&
          wall(i + c.diag[0], j + c.diag[1]) &&
          floor(i + c.l1[0], j + c.l1[1]) &&
          floor(i + c.l2[0], j + c.l2[1]) &&
          floor(i + c.opp[0], j + c.opp[1])
        ) {
          const ti = i + c.diag[0];
          const tj = j + c.diag[1];
          put(ti, tj, styled(c.cut, ti, tj));
        }
      }
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
      setShape(g, i, j, shape);
    }
  }
}

