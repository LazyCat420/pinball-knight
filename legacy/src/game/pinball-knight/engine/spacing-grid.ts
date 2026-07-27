/**
 * SPACING GRID — "is anything already placed within R of here?" in O(1).
 *
 * Decoration is full of the same shape: walk a shuffled list of ~26,000 floor
 * tiles and, for each, ask whether anything placed so far is too close. Written
 * the obvious way that is `placed.some(p => hypot(...) < r)` — a linear scan per
 * candidate, so the cost is candidates x placed. At the caps that is 26,400 x
 * 135 for the horde alone, and the pattern repeats for torches, items, props
 * and parts.
 *
 * A uniform bucket grid makes each query look at a fixed neighbourhood instead
 * of the whole placed set. Bucket size is the query radius, so anything within
 * R is guaranteed to sit in the 3x3 block of buckets around the candidate —
 * that is the entire trick, and it is why the radius is fixed per grid rather
 * than passed per query.
 *
 * Two things worth knowing before reusing this:
 *
 *  - It answers in TILE space with Euclidean distance by default, matching the
 *    `Math.hypot` the old scans used. `manhattan` switches the metric for the
 *    call sites that used |di| + |dj| (torches), because changing a spacing
 *    metric silently changes level layout, and layout is pinned by tests.
 *  - It is an ACCELERATOR, not a policy. It must return exactly what the linear
 *    scan returned, or floors reroll and every generation test that asserts on
 *    real seeds breaks. The test file pins it against a brute-force oracle over
 *    random point sets for that reason.
 */

/** How points are measured apart. */
export type Metric = "euclid" | "manhattan";

export interface SpacingGrid {
  /** Is any inserted point strictly closer than `radius` to (i, j)? */
  occupied(i: number, j: number): boolean;
  /** Record a point. */
  add(i: number, j: number): void;
  /** Points inserted so far. */
  readonly size: number;
}

/**
 * Build a grid that answers "within `radius`" queries.
 *
 * `radius` 0 disables the distance test entirely (the second, fill-anyway pass
 * several callers run), in which case `occupied` is always false.
 */
export function createSpacingGrid(radius: number, metric: Metric = "euclid"): SpacingGrid {
  // Bucket edge = radius, so a hit can only be in the 3x3 around the query.
  // Guard the degenerate case: a zero cell would make every key NaN/Infinity.
  const cell = Math.max(1, Math.ceil(radius));
  const buckets = new Map<number, number[]>();
  let count = 0;

  // Key packs two 16-bit bucket coords into one number. Tile grids top out
  // around 266x202, so bucket indices stay far inside that range even at
  // radius 1; the offset keeps negatives (which callers can produce near the
  // grid edge) from colliding with positives.
  const key = (bi: number, bj: number): number => (bi + 32768) * 65536 + (bj + 32768);

  const close = (di: number, dj: number): boolean =>
    metric === "manhattan" ? Math.abs(di) + Math.abs(dj) < radius : Math.hypot(di, dj) < radius;

  return {
    get size() {
      return count;
    },
    occupied(i: number, j: number): boolean {
      if (radius <= 0) return false;
      const bi = Math.floor(i / cell);
      const bj = Math.floor(j / cell);
      for (let dbi = -1; dbi <= 1; dbi++) {
        for (let dbj = -1; dbj <= 1; dbj++) {
          const arr = buckets.get(key(bi + dbi, bj + dbj));
          if (!arr) continue;
          // Entries are packed pairs, so this walks two numbers at a time.
          for (let k = 0; k < arr.length; k += 2) {
            if (close(arr[k] - i, arr[k + 1] - j)) return true;
          }
        }
      }
      return false;
    },
    add(i: number, j: number): void {
      const bi = Math.floor(i / cell);
      const bj = Math.floor(j / cell);
      const k = key(bi, bj);
      let arr = buckets.get(k);
      if (!arr) {
        arr = [];
        buckets.set(k, arr);
      }
      arr.push(i, j);
      count++;
    },
  };
}
