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
import { perimeterScore, PERIMETER_RULE_MIN } from "./floor-rules";
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
  /**
   * The most peripheral score any site in the candidate band could offer
   * (see `perimeterScore`). This is the answer to "did the generator have a
   * CHOICE?", and it is the difference between a spawn-placement rule that was
   * ignored and one that was impossible: on a floor whose circuit never reaches
   * the border there is no peripheral chute to pick, and the caller records a
   * declared relaxation rather than the rule silently failing.
   */
  edgeBest: number;
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
/**
 * Weight on the perimeter term in chute scoring, before the archetype's
 * `perimeterBias` (0..1) scales it. See the block in `carveLaunchChute`: sized
 * to break a tie between comparable sites, not to rescue a short one.
 */
const PERIMETER_WEIGHT = 14;
/**
 * Fraction of scored sites that form the candidate band. Widened from 0.15 once
 * the perimeter pass started choosing within it: a narrow band picked by
 * geometry alone often contained no peripheral site at all, so there was
 * nothing for the bias to choose between.
 */
const BAND_FRAC = 0.3;
/**
 * How much of the band a full `perimeterBias` of 1.0 narrows away, keeping the
 * most peripheral sites. At 0.75 a max-bias archetype still draws from the top
 * quarter of the band rather than a single site, which is what keeps two runs
 * of the same archetype from opening in the identical spot.
 */
const EDGE_NARROW = 0.75;

export function carveLaunchChute(
  g: Grid,
  mask: TrackMask,
  rng: () => number,
  opts: { perimeterBias?: number } = {},
): LaunchChute | null {
  const sites = findChuteSites(g, mask);
  if (!sites.length) return null;

  // Score, then pick from the top band rather than the argmax. Taking the
  // single best site makes the chute a deterministic function of the circuit's
  // extremities, and the extremities of a Physarum network are not very varied
  // — 30 seeds would put the chute against the same edge most of the time. A
  // shuffled top band keeps the quality floor while restoring the variety the
  // user asked for.
  // ── WHERE THE FLOOR OPENS ────────────────────────────────────────────────
  //
  // This function decides the player's SPAWN on 94% of floors (censused: 73 of
  // 78 fit a chute, and `pickTrackEndpoints` hands `start` straight to
  // `chute.base` when one exists). It was scoring purely on hallway geometry —
  // length plus runout — with no opinion at all about where on the map that
  // hallway sat, which is why spawn landed a mean 58-66% of the way to the
  // centre on every archetype alike, an 8-point spread across five floor types
  // that are supposed to feel different.
  //
  // `perimeterBias` (maze/floor-rules.ts, weighted per archetype) is added as a
  // TERM, never as a filter. A filter would be the wrong shape twice over: on a
  // floor whose circuit never reaches the border it would reject every site and
  // silently produce no chute at all, and it would override the runout gate
  // that stops a chute firing into a wall — trading a real playability
  // guarantee for a cosmetic one. As a term it competes, and geometry still
  // wins when the edge has nothing worth launching down.
  //
  // The weight is scaled to the other terms deliberately: `len` runs to ~20 and
  // runout contributes up to 24, so PERIMETER_WEIGHT is sized to be able to
  // separate two otherwise-comparable sites without being able to rescue a
  // short one.
  const bias = opts.perimeterBias ?? 0;
  const scored = sites.map((c) => ({
    c,
    // Length is the headline (a long hallway is the ask) but a chute that fires
    // into a wall is worthless however long it is, so the runout gates it.
    score:
      c.len +
      2 * Math.min(12, runoutPast(g, c.mouth.i, c.mouth.j, c.dirI, c.dirJ)) +
      (bias >= 0.5
        ? bias * perimeterScore(g, c.base.i, c.base.j)
        : (1 - bias) * (1 - perimeterScore(g, c.base.i, c.base.j))) * PERIMETER_WEIGHT,
  }));
  scored.sort((a, b) => b.score - a.score);
  const band = scored.slice(0, Math.max(1, Math.ceil(scored.length * BAND_FRAC)));
  // ── PERIMETER CHOOSES AMONG EQUALS ───────────────────────────────────────
  //
  // The score above already carries a perimeter term, but scoring alone was not
  // enough and the measurement says why: with the term added but the band still
  // picked at random, 17 of 78 floors still opened essentially dead centre
  // (perimeterScore as low as 0.04). Two things were fighting it — the
  // geometry terms run to ~44 so a 0.9-bias perimeter term tops out at under a
  // third of that, and whatever the score decided, the final `rng()` pick threw
  // a fair die across the whole band anyway.
  //
  // Raising the weight until perimeter dominates is the wrong fix and would
  // break a real guarantee: `runout` is a TERM here, not a filter, so a
  // perimeter weight large enough to always win is also large enough to select
  // a chute that fires straight into a wall. That trade — a playability
  // guarantee for a cosmetic one — is exactly what the block above says not to
  // make.
  //
  // So the band stays a pure GEOMETRY band (its membership is unchanged, which
  // is what preserves the quality floor) and the perimeter decides WITHIN it.
  // Allocation, not argmax — the same shape as `pickTrackEndpoints`' tie-band.
  // The rng then picks among the most peripheral slice of that, so variety
  // survives: a floor still has several genuinely different openings to choose
  // between, they are just all out at the edge.
  const byEdge =
    bias >= 0.5
      ? [...band].sort((x, y) => perimeterScore(g, y.c.base.i, y.c.base.j) - perimeterScore(g, x.c.base.i, x.c.base.j))
      : [...band].sort((x, y) => perimeterScore(g, x.c.base.i, x.c.base.j) - perimeterScore(g, y.c.base.i, y.c.base.j));
  const edgeCut = Math.max(1, Math.ceil(byEdge.length * (bias < 0.5 ? 0.35 : 1 - bias * EDGE_NARROW)));
  let pool = byEdge.slice(0, edgeCut);
  // ── RELAX ONLY WHEN FORCED ───────────────────────────────────────────────
  //
  // Narrowing to the most peripheral slice is not the same as satisfying the
  // rule, and the gap showed up as exactly one floor in 78: a ringkeep whose
  // pool ran from 0.50 down to 0.28 and whose `rng()` drew the 0.28. The site
  // was compliant-adjacent but the rule wants >= PERIMETER_RULE_MIN, and a
  // qualifying site was sitting right there in the same pool.
  //
  // So when ANY candidate clears the bar, only those are eligible. When none
  // does the pool is left alone and `buildTrackFloor` records a declared
  // relaxation — which is the whole point of separating "could not" from "did
  // not": the fallback stays available and stays counted.
  if (bias >= 0.5) {
    const compliant = pool.filter((x) => perimeterScore(g, x.c.base.i, x.c.base.j) >= PERIMETER_RULE_MIN);
    if (compliant.length > 0) pool = compliant;
  }
  const pick = pool[Math.floor(rng() * pool.length)] ?? pool[0];
  const edgeBest = band.reduce((m, x) => Math.max(m, perimeterScore(g, x.c.base.i, x.c.base.j)), 0);
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

  return { base, mouth, dirI, dirJ, spine, half: LAUNCH_HALF, edgeBest };
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
