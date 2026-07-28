/**
 * FLOW ORIENTATION — the floor's single source of truth for "which way is
 * onward", and the reason a booster route can no longer eat its own tail.
 *
 * ── The defect this exists to kill ────────────────────────────────────────
 *
 * Live QA, with a screenshot: two booster runs a few tiles apart pushing
 * OPPOSITE ways, and routes that hand the knight back to where he came from
 * until he can't get out. Censused over 78 generated floors on the shipping
 * path, before this module:
 *
 *   · 16.2% of all launch parts (544/3364) fired toward the SPAWN;
 *   · 57.2% of non-spine boosters did, and 42.5% of flippers — because
 *     `booster` and `flipper` were never in decorate's FORWARD_FLOW_KINDS, so
 *     their heading came straight off `classifyTopology`, which picks one of a
 *     straight tile's two ends with `rng() < 0.5`. A literal coin flip;
 *   · 1.58 anti-parallel duels per floor survived `breakLaunchDuels`, and 121
 *     of the 123 were spine-vs-spine — precisely the pair that function
 *     `continue`s past by design;
 *   · 130 launchers sat in a CLOSED exit-ray cycle: pad A throws you at pad B
 *     which throws you back at A. The runtime BOOSTER_JAM guard cannot see
 *     this one, because it keys off the ball returning to the SAME spot and in
 *     a multi-pad loop it never does.
 *
 * ── Why a potential field rather than more repair passes ──────────────────
 *
 * Every previous attempt was a pairwise fix: notice two parts disagree, re-aim
 * one. That is chasing the symptom, and it cannot converge — re-aiming a part
 * can start a fresh duel with a third, which is why `breakLaunchDuels` iterates
 * to a fixed point and still leaves 1.58 per floor on the floor.
 *
 * The property actually wanted is global: **no cycle of shoves exists**. That is
 * not a pairwise property and no pairwise pass can guarantee it. But it follows
 * for free from a scalar potential. Let Φ(tile) be the BFS step distance to the
 * STAIRS. If every launch part fires from a tile of higher Φ toward one of
 * strictly lower Φ, then any chain of shoves is a strictly decreasing sequence
 * in Φ — and a strictly decreasing sequence cannot return to a value it has
 * already left. Loops become impossible rather than rare.
 *
 * The same field answers the other half of the ask ("MOST of the tracks going
 * one direction, but multiple paths, not one set path") without any extra
 * machinery: Φ is defined on EVERY walkable tile, not just on one traced
 * artery, so every leg of the grown circuit gets a consistent forward direction
 * and they all drain to the exit. Several genuinely different routes, none of
 * them fighting another.
 *
 * ── Why Φ is distance-to-STAIRS, not distance-from-start ──────────────────
 *
 * decorate's old flow test compared dist-from-start either side of a pad and
 * kept the larger. Those are not the same field and the difference is not
 * academic: "away from the spawn" is satisfied by any of the floor's dead-end
 * branches, so a pad could be perfectly "forward" by that test while pointing
 * down a pocket the exit isn't in. Distance-to-stairs has one sink — the exit —
 * so downhill always means progress, and the field is defined on the branches
 * too. That is what makes multiple routes work instead of merely not-crash.
 *
 * DOM- and three-free, allocation-light, and deterministic: no rng in here at
 * all, so a floor orients identically for every co-op peer.
 */
import { type Grid, type TilePos, at, idx, isWalkable, T_FLOOR, T_STAIRS } from "./generator";

/** The four cardinals, in a fixed order so orientation is deterministic. */
const CARDS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Φ at an unreachable or out-of-bounds tile. Large, and never negative, so a
 *  caller that forgets to test it gets "infinitely far from the exit" rather
 *  than a silently-winning -1. */
export const UNREACHED = 0x3fffffff;

/**
 * Build Φ: BFS step distance from the STAIRS to every walkable tile.
 *
 * 4-connected on purpose — the parts fire on cardinals, so a diagonal-aware
 * field would report gradients no pad can actually follow.
 */
export function buildFlowField(g: Grid, stairs: TilePos): Int32Array {
  const phi = new Int32Array(g.w * g.h).fill(UNREACHED);
  if (!isWalkable(g, stairs.i, stairs.j)) return phi;
  const q = new Int32Array(g.w * g.h);
  let head = 0;
  let tail = 0;
  const s = idx(g, stairs.i, stairs.j);
  phi[s] = 0;
  q[tail++] = s;
  while (head < tail) {
    const k = q[head++];
    const i = k % g.w;
    const j = (k - i) / g.w;
    const d = phi[k] + 1;
    for (const [di, dj] of CARDS) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= g.w || nj >= g.h) continue;
      const nk = idx(g, ni, nj);
      if (phi[nk] !== UNREACHED) continue;
      const t = g.t[nk];
      if (t !== T_FLOOR && t !== T_STAIRS) continue;
      phi[nk] = d;
      q[tail++] = nk;
    }
  }
  return phi;
}

/** Φ at a tile, clamped for out-of-bounds. */
export function phiAt(g: Grid, phi: Int32Array, i: number, j: number): number {
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return UNREACHED;
  return phi[idx(g, i, j)];
}

/**
 * Does firing from (i,j) along (di,dj) go DOWNHILL — i.e. onward toward the
 * exit? This is the one predicate the whole no-loops guarantee rests on, so it
 * is deliberately strict: equal Φ is NOT downhill.
 *
 * A tie means the shove makes no progress, and a chain of ties is exactly the
 * cycle we are ruling out (a ball can go round a level set of Φ forever). Two
 * pads on the same contour firing at each other is the standing wave the census
 * found; treating a tie as acceptable would let it straight back in.
 */
export function isDownhill(g: Grid, phi: Int32Array, i: number, j: number, di: number, dj: number): boolean {
  const here = phiAt(g, phi, i, j);
  const there = phiAt(g, phi, i + di, j + dj);
  if (here >= UNREACHED || there >= UNREACHED) return false;
  return there < here;
}

/**
 * How far downhill a shove travels: the drop in Φ between the pad and where the
 * launch actually puts you, walking up to `reach` open tiles along the ray.
 *
 * The drop matters more than the sign for CHOOSING between candidate headings —
 * a pad that drops Φ by 6 is railing you down a real leg of the circuit, one
 * that drops it by 1 is nudging you round a corner into the same contour. Used
 * to rank re-aims so the repair passes prefer the heading that most obviously
 * reads as "onward".
 *
 * Returns 0 when the ray leaves the reachable region immediately, which is the
 * correct "no progress" answer and keeps callers from special-casing it.
 */
export function flowDrop(g: Grid, phi: Int32Array, i: number, j: number, di: number, dj: number, reach = 8): number {
  const here = phiAt(g, phi, i, j);
  if (here >= UNREACHED) return 0;
  let best = here;
  for (let s = 1; s <= reach; s++) {
    const ni = i + di * s;
    const nj = j + dj * s;
    if (at(g, ni, nj) !== T_FLOOR && at(g, ni, nj) !== T_STAIRS) break;
    const v = phiAt(g, phi, ni, nj);
    if (v < best) best = v;
  }
  return here - best;
}

/**
 * Open tiles along a ray from (i,j), up to `max`.
 *
 * The other half of `flowDrop`, and it belongs beside it: that one answers "how
 * much progress does this shove make", this one answers "is there anywhere to
 * make it". Every consumer of the Φ contract needs both, and until now each one
 * carried its own copy — `decorate.launchRunway` and `flow-loops.runway` are the
 * same eight lines, the latter with a comment saying so ("Matches decorate's
 * MIN_RUNWAY — the same physical claim"). A comment is not a compiler.
 *
 * STAIRS COUNT AS RUNWAY. `flow-loops` already accepted them and `decorate` did
 * not, which made decorate's launchers under-count by a tile whenever the exit
 * sat in their lane — the one tile on the floor a shove is most entitled to
 * reach. Unifying on the permissive reading is a behaviour change, and a small
 * deliberate one: it can only lengthen a runway, never shorten one, so it can
 * only turn a repair OFF, never on.
 */
export function openRunway(g: Grid, i: number, j: number, di: number, dj: number, max = 8): number {
  let n = 0;
  for (let s = 1; s <= max; s++) {
    const t = at(g, i + di * s, j + dj * s);
    if (t !== T_FLOOR && t !== T_STAIRS) break;
    n++;
  }
  return n;
}

/**
 * The steepest downhill cardinal from a tile, or null if the tile is a local
 * minimum (only the stairs and unreachable pockets should be).
 *
 * Ties are broken by the CARDS order rather than by rng: this is called from
 * passes that must stay reproducible across co-op peers, and an rng tiebreak
 * would make two peers orient the same pad differently.
 */
export function steepestDown(g: Grid, phi: Int32Array, i: number, j: number): readonly [number, number] | null {
  let best: readonly [number, number] | null = null;
  let bestDrop = 0;
  for (const c of CARDS) {
    const drop = flowDrop(g, phi, i, j, c[0], c[1]);
    if (drop > bestDrop) {
      bestDrop = drop;
      best = c;
    }
  }
  return best;
}

/**
 * Descend the field from `from` until it reaches Φ ≤ `until` or can descend no
 * further, returning the tile path (inclusive of `from`).
 *
 * This is how ALTERNATE ROUTES are found. `traceArtery` walks one gradient from
 * the stairs back to the spawn and yields THE path; this walks the same field
 * downhill from anywhere, so every lane tile on the circuit is the head of a
 * route that provably ends at the exit. Feeding several of those to the station
 * pass is what turns "one set path" into "multiple paths, all going one way".
 *
 * `stop` lets a caller halt early — the alternate routes stop as soon as they
 * merge into an already-furnished route, so two routes never double-pad the
 * same corridor.
 */
export function descend(
  g: Grid,
  phi: Int32Array,
  from: TilePos,
  opts: { until?: number; maxLen?: number; stop?: (p: TilePos) => boolean } = {},
): TilePos[] {
  const until = opts.until ?? 0;
  const maxLen = opts.maxLen ?? g.w * g.h;
  const path: TilePos[] = [];
  let cur = from;
  for (let guard = 0; guard < maxLen; guard++) {
    path.push(cur);
    if (phiAt(g, phi, cur.i, cur.j) <= until) break;
    // Strictly-decreasing single steps, so the walk terminates: Φ is a
    // non-negative integer and every iteration lowers it by exactly one.
    let next: TilePos | null = null;
    const here = phiAt(g, phi, cur.i, cur.j);
    for (const [di, dj] of CARDS) {
      const ni = cur.i + di;
      const nj = cur.j + dj;
      if (phiAt(g, phi, ni, nj) === here - 1) {
        next = { i: ni, j: nj };
        break;
      }
    }
    if (!next) break;
    if (opts.stop?.(next)) break;
    cur = next;
  }
  return path;
}
