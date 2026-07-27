/**
 * THE LAUNCH CHUTE — the plunger lane, authored as MAZE GEOMETRY.
 *
 * ── What was wrong ────────────────────────────────────────────────────────
 *
 * Every floor already "opened on the plunger" (constants.ts D4): the knight is
 * parked, you pull, you fire. But there was no CHUTE. `core.ts startLevel` took
 * whatever tile `pickTrackEndpoints` handed back — a lane tile chosen purely for
 * being a graph diameter away from the stairs — and aimed a launch vector at
 * the nearest scoring part. So the ritual was real and the geometry was not:
 * you were parked in the middle of a corridor, or in the corner of a plaza, and
 * "release to launch" fired you diagonally across open floor into whatever
 * happened to be there. Nothing about the opening read as a pinball machine,
 * because on a pinball machine the plunger fires up a **dedicated, enclosed,
 * one-way lane** that feeds the playfield.
 *
 * ── What this is ──────────────────────────────────────────────────────────
 *
 * A real launch lane, carved in the TRACK layer with the same brush as the
 * circuit (`carveStroke`), before the maze grows:
 *
 *     [BASE] ══════════════ a straight, sealed, 3-wide hallway ══════════════> [MOUTH]
 *      park                    boosters live here (decorate.ts)                merges onto
 *      here                                                                    the circuit
 *
 * Carving it as part of the track — rather than as a decoration afterwards —
 * is the whole point, and it buys four properties for free rather than as four
 * separate special cases:
 *
 *   · `growMazeAround`'s keep-out margin respects `mask.lane`, so the maze
 *     never grows into the chute and the side walls are solid ROCK, not a
 *     corridor wall with doors in it. A sealed lane is what makes the launch
 *     *committed* — you cannot dribble sideways out of it.
 *   · `uncarveDeadEnds` skips lane tiles, so the closed end survives. A chute
 *     IS a dead end; every dead-end repair in the pipeline would otherwise
 *     correctly identify it as one and fill it in.
 *   · `socketAt` types it `road`, so the socket validator judges it as track.
 *   · `publishArcs` / the fillet passes see it as circuit, so the merge at the
 *     mouth can be banked like any other junction.
 *
 * ── Why it differs every floor without differing in KIND ──────────────────
 *
 * The user's ask was "the same starting plunger concept on every map, but
 * generating different patterns". So the CONCEPT is fixed by construction —
 * there is always exactly one chute, always straight, always sealed, always
 * ending on the circuit — while the *instance* is read off the grown circuit:
 * which lane tile it feeds, from which of the four cardinals, and how long the
 * run is (bounded, not free) all fall out of where this seed's track happens to
 * leave rock. That is the Diablo II lesson from
 * `docs/game-dev-rules/procedural-level-generation.md` §1: a learnable, fixed
 * grammar with a randomised instantiation beats maximised entropy.
 *
 * DOM- and three-free. Pure apart from the grid/mask it carves.
 */
import { type Grid, type TilePos, idx, isWalkable, setTile, T_WALL } from "./generator";
import { carveStroke, type TrackMask } from "./track-carve";

/** Half-width of the carved lane → a 3-tile-wide hallway. Matches `main`. */
export const LAUNCH_HALF = 1.5;
/**
 * Length bounds in tiles, base → mouth.
 *
 * MIN is the interesting one: below about 8 tiles the chute does not read as a
 * hallway at all, it reads as an alcove, and the whole point is that the launch
 * has somewhere to BUILD. MAX exists because the run is carved out of the rock
 * the circuit left over — uncapped, a sparse floor donates a 40-tile tunnel
 * that dominates the map and eats the maze's space budget.
 */
export const LAUNCH_MIN = 8;
export const LAUNCH_MAX = 20;
/**
 * Clearance the chute needs on either side of its centreline before it may be
 * carved: `LAUNCH_HALF` for the lane itself plus a tile of rock, so the wall
 * between the chute and whatever is beside it is never one tile thin. A
 * one-tile wall is what `removeWallStubs` deletes and what a smashable crack
 * would punch straight through — either way the lane stops being sealed.
 */
export const LAUNCH_CLEAR = 3;

export interface LaunchChute {
  /** The closed end — where the knight is PARKED at floor open. */
  base: TilePos;
  /** Where the chute merges onto the circuit. */
  mouth: TilePos;
  /** Unit cardinal pointing base → mouth. The launch direction. */
  dirI: number;
  dirJ: number;
  /** Centre line, ordered base → mouth inclusive. Boosters ride this. */
  spine: TilePos[];
  /** Half-width the lane was carved at. */
  half: number;
}

const CARDINALS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Is the cross-section at (i,j) perpendicular to (di,dj) clear enough to carve?
 *
 * "Clear" means solid rock that the circuit has not claimed. We check the
 * PERPENDICULAR band rather than a square block because the chute is straight:
 * a square probe would reject a perfectly good run for rock thickness it is
 * about to travel through anyway.
 */
function crossSectionFree(g: Grid, mask: TrackMask, i: number, j: number, di: number, dj: number): boolean {
  // Perpendicular of a unit cardinal.
  const pi = -dj;
  const pj = di;
  for (let s = -LAUNCH_CLEAR; s <= LAUNCH_CLEAR; s++) {
    const x = i + pi * s;
    const y = j + pj * s;
    // The chute may not touch the border: it needs a wall on the far side of
    // its own side wall, and tile 0 has nothing beyond it.
    if (x < 2 || y < 2 || x >= g.w - 2 || y >= g.h - 2) return false;
    if (isWalkable(g, x, y)) return false;
    if (mask.lane[idx(g, x, y)] === 1) return false;
  }
  return true;
}

interface Candidate {
  mouth: TilePos;
  base: TilePos;
  dirI: number;
  dirJ: number;
  len: number;
}

/**
 * Find every legal chute: a lane tile plus a cardinal with enough solid rock
 * behind it to hold a hallway.
 *
 * We walk AWAY from the circuit and the chute then fires back toward it, which
 * is the opposite of how it plays but the right way to search — the constraint
 * ("does a straight sealed run fit here") is anchored at the merge point, and
 * anchoring the search at the far end instead would mean guessing a base tile
 * in the middle of undifferentiated rock and hoping it lines up with a lane.
 */
export function findChuteSites(g: Grid, mask: TrackMask): Candidate[] {
  const out: Candidate[] = [];
  for (let j = 2; j < g.h - 2; j++) {
    for (let i = 2; i < g.w - 2; i++) {
      if (mask.lane[idx(g, i, j)] !== 1) continue;
      if (!isWalkable(g, i, j)) continue;
      for (const [di, dj] of CARDINALS) {
        // Walk backward from the mouth into the rock. `len` counts how many
        // tiles of chute we can carve; step 1 is the first rock tile.
        let len = 0;
        for (let s = 1; s <= LAUNCH_MAX; s++) {
          const x = i - di * s;
          const y = j - dj * s;
          if (!crossSectionFree(g, mask, x, y, di, dj)) break;
          len = s;
        }
        if (len < LAUNCH_MIN) continue;
        const base = { i: i - di * len, j: j - dj * len };
        // THE CLOSED END NEEDS A REAL END CAP. `crossSectionFree` only checks
        // the band PERPENDICULAR to the run, so nothing stopped the base from
        // landing one tile off the border — leaving a single-tile membrane
        // behind it. The piece gate caught the consequence: a sealed tile at
        // (19,2) opening onto floor at (19,1). Two tiles of stone behind the
        // plunger, always.
        if (base.i < 3 || base.j < 3 || base.i >= g.w - 3 || base.j >= g.h - 3) continue;
        out.push({ mouth: { i, j }, base, dirI: di, dirJ: dj, len });
      }
    }
  }
  return out;
}

/**
 * How much of the circuit does firing out of this mouth actually FEED?
 *
 * A chute that empties onto a lane running across it delivers you into flow. A
 * chute that empties onto a lane running along it delivers you into a head-on
 * wall a few tiles later, which is the same "booster into a curved wall" defect
 * the socket work killed elsewhere ([[geometry-socket-contract]]) — just with
 * the player's whole opening launch instead of one pad.
 *
 * So the score is simply: how far can the launch keep going, in a straight
 * line, past the mouth? Cheap, and it is the exact quantity that matters.
 */
export function runoutPast(g: Grid, i: number, j: number, di: number, dj: number, max = 24): number {
  let n = 0;
  for (let s = 1; s <= max; s++) {
    if (!isWalkable(g, i + di * s, j + dj * s)) break;
    n = s;
  }
  return n;
}

/**
 * Carve the floor's one launch chute, or return null if nothing fits.
 *
 * MUST run after `carveTrack` (it needs a circuit to feed) and BEFORE
 * `growMazeAround` (so the maze grows around the chute rather than into it).
 *
 * Returning null is a legitimate outcome, not a failure: a very dense circuit
 * on a small floor can genuinely leave no straight 8-tile pocket of rock. The
 * caller falls back to the old free-air launch, which is what shipped before.
 */
export function carveLaunchChute(g: Grid, mask: TrackMask, rng: () => number): LaunchChute | null {
  const sites = findChuteSites(g, mask);
  if (!sites.length) return null;

  // Score, then pick from the top band rather than the argmax. Taking the
  // single best site makes the chute a deterministic function of the circuit's
  // extremities, and the extremities of a Physarum network are not very varied
  // — 30 seeds would put the chute against the same edge most of the time. A
  // shuffled top band keeps the quality floor while restoring the variety the
  // user asked for.
  const scored = sites.map((c) => ({
    c,
    // Length is the headline (a long hallway is the ask) but a chute that fires
    // into a wall is worthless however long it is, so the runout gates it.
    score: c.len + 2 * Math.min(12, runoutPast(g, c.mouth.i, c.mouth.j, c.dirI, c.dirJ)),
  }));
  scored.sort((a, b) => b.score - a.score);
  const band = scored.slice(0, Math.max(1, Math.ceil(scored.length * 0.15)));
  const pick = band[Math.floor(rng() * band.length)] ?? band[0];
  const { mouth, base, dirI, dirJ, len } = pick.c;

  // Carve base → mouth with the circuit's own brush, so every downstream pass
  // treats the chute as track. Stroke to the mouth EXACTLY: overshooting would
  // widen the lane it merges into and blunt the junction.
  carveStroke(g, mask, base.i + 0.5, base.j + 0.5, mouth.i + 0.5, mouth.j + 0.5, LAUNCH_HALF);

  const spine: TilePos[] = [];
  for (let s = 0; s <= len; s++) spine.push({ i: base.i + dirI * s, j: base.j + dirJ * s });

  // SEAL everything but the last two cross-sections. The on-ramp pass in
  // `growMazeAround` opens any wall with track on one side, which is right for
  // the circuit and wrong for a launch lane — measured, it left only 28/60
  // floors with both chute walls intact. The mouth end stays unsealed on
  // purpose: that is where the chute is SUPPOSED to open, and sealing it would
  // isolate the junction from the maze that surrounds it.
  const pi = -dirJ;
  const pj = dirI;
  const reach = Math.ceil(LAUNCH_HALF);
  for (let s = 0; s <= len - 2; s++) {
    const c = spine[s];
    for (let d = -reach; d <= reach; d++) {
      const x = c.i + pi * d;
      const y = c.j + pj * d;
      if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
      const k = idx(g, x, y);
      if (mask.lane[k] === 1) mask.sealed[k] = 1;
    }
  }

  return { base, mouth, dirI, dirJ, spine, half: LAUNCH_HALF };
}

/**
 * Close any side door the connectivity repair had to punch into the chute.
 *
 * `connectAll` prefers to route around a sealed lane's walls but will go
 * through one rather than strand a pocket — correct precedence, and it leaves a
 * rare hole: measured, about one floor in forty ends up with a sealed tile
 * opening onto off-lane floor.
 *
 * This closes it, and the ORDER of the two operations is the whole design.
 * Sealing first and checking after is what makes it safe: the alternative
 * (refuse the repair up front) would trade a cosmetic defect for a stranded
 * player, which is the one bug this generator may never ship. Here the seal is
 * applied, connectivity is re-checked with the caller's own reachability test,
 * and the tile is put back if it stranded anything. Worst case we are exactly
 * where we started.
 *
 * `reaches` must answer "is every walkable tile still reachable from spawn".
 * Returns the number of tiles sealed.
 */
export function resealChute(
  g: Grid,
  mask: TrackMask,
  chute: LaunchChute,
  reaches: () => boolean,
): number {
  let sealed = 0;
  for (const t of chuteTiles(g, chute)) {
    if (mask.sealed[idx(g, t.i, t.j)] !== 1) continue;
    for (const [di, dj] of CARDINALS) {
      const x = t.i + di;
      const y = t.j + dj;
      if (x < 1 || y < 1 || x >= g.w - 1 || y >= g.h - 1) continue;
      if (!isWalkable(g, x, y)) continue;
      if (mask.lane[idx(g, x, y)] === 1) continue; // part of the circuit: fine
      const before = g.t[idx(g, x, y)];
      setTile(g, x, y, T_WALL);
      if (!reaches()) {
        g.t[idx(g, x, y)] = before; // it was load-bearing — leave the door
      } else {
        sealed++;
      }
    }
  }
  return sealed;
}

/**
 * Every tile of the chute's LANE (not just its centre line).
 *
 * The content pass needs this to keep the hallway clear of everything that is
 * not the launch itself — a zombie, a chest or a stray bumper parked in the
 * plunger lane turns the opening commitment into a coin flip.
 */
export function chuteTiles(g: Grid, chute: LaunchChute): TilePos[] {
  const out: TilePos[] = [];
  const pi = -chute.dirJ;
  const pj = chute.dirI;
  const reach = Math.ceil(chute.half);
  const seen = new Set<number>();
  for (const c of chute.spine) {
    for (let d = -reach; d <= reach; d++) {
      const x = c.i + pi * d;
      const y = c.j + pj * d;
      if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
      if (!isWalkable(g, x, y)) continue;
      const k = idx(g, x, y);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ i: x, j: y });
    }
  }
  return out;
}
