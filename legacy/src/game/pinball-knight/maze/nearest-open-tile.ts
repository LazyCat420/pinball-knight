/**
 * Find open floor near a tile — the "put this thing SOMEWHERE sensible" helper
 * every spawner reaches for.
 *
 * Moved out of core.ts: ten call sites across level building, corpse piles,
 * merchants and pin crews all want it, and none of them are core's business.
 */
import { isWalkable, type Grid, type TilePos } from "./generator";

/**
 * The `n`-th walkable tile found scanning outward in ring shells from (ci, cj).
 *
 * NOTE the semantics: `n` is an ORDINAL, not a distance. Asking for n = 6 does
 * NOT get you a tile 6 tiles out — it gets the 6th walkable tile found, which
 * in an open area is still inside the r = 1 ring. Pass `minRing` when you
 * actually mean "no closer than this".
 */
export function nearestOpenTile(g: Grid, ci: number, cj: number, n: number, minRing = 1): TilePos | null {
  const found: TilePos[] = [];
  for (let r = Math.max(1, minRing); r <= Math.max(6, minRing + 5) && found.length < n; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; // ring shell only
        const i = ci + di;
        const j = cj + dj;
        if (isWalkable(g, i, j)) found.push({ i, j });
        if (found.length >= n) break;
      }
    }
  }
  return found[n - 1] ?? found[found.length - 1] ?? null;
}
