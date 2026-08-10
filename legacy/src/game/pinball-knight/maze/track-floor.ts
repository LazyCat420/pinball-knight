/**
 * TRACK FLOOR — the track-first generator, packaged as a drop-in base grid.
 *
 * `core.ts startLevel` builds a floor in two halves:
 *
 *     A. base grid   generateMaze → carveRooms → stamps → thickenWalls
 *                    → pickEndpoints → widenMainArtery
 *     B. content     decorateMaze (parts, zombies, torches, arcs, rooms…)
 *
 * This module replaces **half A only**. Half B is large, well-tested and has
 * nothing to do with topology, so it keeps running exactly as it does today —
 * it just receives a grid whose main artery is a grown circuit rather than a
 * widened accident.
 *
 * ── Why this generates at FINAL resolution ────────────────────────────────
 *
 * The shipped path builds a half-scale cell maze and then `thickenWalls`
 * doubles it, which is what turns 1-wide slots into the 2-wide corridors the
 * renderer's low-rim/tall-back trick needs. The track has no use for that: it
 * already carves lanes 3-5 tiles wide with real radii, and doubling would turn
 * a radius-6 fillet into a radius-12 one and blow the floor budget. So we
 * generate at the FINAL tile scale and skip thickening entirely.
 *
 * The consequence to keep in mind: callers must NOT call `thickenWalls` on
 * this grid, and room rects/anchors from the shipped stamp passes (which are
 * authored in half-scale cell coords and scaled ×2 afterwards) do not apply.
 * `buildTrackFloor` therefore returns a grid that is already final.
 *
 * DOM- and three-free.
 */
import { type Grid, type TilePos, T_FLOOR, T_STAIRS, T_WALL, at, idx, isWalkable, setTile, shapeAt } from "./generator";
import { growTrack, circuitRank, type TrackGraph } from "./track-grow";
import { buildTrackPath, type TrackPath } from "./track-path";
import { carveTrack, carveChamber, growMazeAround, publishArcs, connectAll, sealedWalls, type TrackMask } from "./track-carve";
import { DEFAULT_TRACK_PROFILE, trackNodeCounts, type TrackProfile } from "./archetypes";
import { uncarveDeadEnds, removeWallStubs, healRoadTerminations, nearSealed } from "./track-socket";
import { carveLaunchChute, chuteTiles, resealChute, type LaunchChute } from "./track-launch";
import { DEFAULT_RULE_WEIGHTS, perimeterScore, PERIMETER_RULE_MIN, BOSS_ARENA_R, BOSS_ARENA_MIN_WIDTH } from "./floor-rules";
import { DEFAULT_CONSTRAINTS } from "./floor-metrics";
import { authorArcSweeps, stampOrbitIsland, orientArcRails, ORBIT_RADIUS, ORBIT_RING } from "./arc-sweeps";
import { buildFlowField } from "./flow-orient";
import { compactArcs, clearOrphanArcTiles } from "./arc-contract";
import { SHAPE_ARC } from "../engine/tile-shape";
import { authorArteryBanks, traceArtery } from "./artery-banks";
import { planDoorways, resolveDoorway, carveDoorways, doorwayFootprint, arcSpanMask, clearanceField, widthFromClearance, type Doorway } from "./doorways";
import { authorDoorwayFunnels } from "./doorway-funnels";
import { authorRelayChambers } from "./relay-chambers";
import { bfsDistances } from "../engine/flow-field";
import { nearestOpenTile } from "./nearest-open-tile";

/**
 * The `occupied` predicate the curve passes take, with nothing to avoid.
 *
 * They are run before any content exists now, so there is genuinely nothing
 * placed for a fillet to eat. Naming it rather than inlining `() => false` is
 * deliberate: the empty predicate is the *statement* that geometry precedes
 * content, and an inline arrow reads like an oversight.
 *
 * Content is still not what it avoids. What it DOES avoid now is the planned
 * doorways (maze/doorways.ts) — the one thing on the grid at this point that
 * was decided before the curves and must survive them.
 */
const NOTHING_OCCUPIED = (): boolean => false;

/**
 * Walls the connectivity repair should route around if it can: a sealed lane's
 * side walls, plus every wall tile that carries a published arc face.
 *
 * The arc half is the new one and it matters more than it looks. `connectAll`
 * carves the SHORTEST wall corridor into a stranded pocket, and a fillet's rim
 * is a thin band of wall — often the shortest thing between two open spaces. A
 * corridor punched through it leaves a curved wall with a doorway in the middle
 * of the sweep: the collider still reports the whole arc as solid (it derives
 * from `Grid.arcs`, not from the tiles), so the player sees a gap and hits a
 * wall. That is the see≠hit class of bug, and it is worth a longer corridor to
 * avoid. As always this is a preference and never a prohibition — connectAll
 * retries without the mask rather than leave anything stranded.
 */
function repairKeepOut(g: Grid, mask: TrackMask): Uint8Array {
  const out = sealedWalls(g, mask);
  if (g.arcIdx) {
    for (let k = 0; k < g.arcIdx.length; k++) if (g.arcIdx[k] >= 0) out[k] = 1;
  }
  return out;
}

/**
 * What a pass boundary hands the observer. Grid and mask are the LIVE objects,
 * not copies — an observer that keeps one keeps a reference into a floor that
 * is still being built, so digest it now or copy it yourself.
 *
 * `mask` is null for the two passes that run before the track is carved.
 */
export interface PassSnapshot {
  pass: string;
  grid: Grid;
  mask: TrackMask | null;
  /** Pass-specific scalars, small enough to pin verbatim in a fixture. */
  extra: PassExtra;
}

/** Small JSON-able values a pass reports about itself. */
export type PassExtra = Record<string, number | string | null | number[] | string[]>;

/** The empty thunk, shared — a pass with nothing to say allocates nothing. */
const NO_EXTRA = (): PassExtra => ({});

/**
 * The per-pass observation seam — the Rust port's parity harness.
 *
 * ⚠️ THE ORDER OF THE PASSES IS THE CONTRACT, exactly as the order of the draws
 * is (see spawn/floor-authoring.ts). Twenty-three passes share one rng stream
 * and each mutates the grid the next one reads, so a port that gets pass 6
 * subtly wrong produces a floor that is merely DIFFERENT — it renders, it is
 * connected, and every property test passes. A whole-floor digest says "wrong"
 * and nothing more; this says WHICH pass, and the rng draw count the observer
 * keeps alongside says whether the divergence was in the draws or in the
 * geometry they fed.
 *
 * A probe never draws from the rng and never writes to the grid, and with no
 * observer attached the seam costs twenty-three falsy checks and nothing else
 * — the `extra` thunk is what keeps that true at the call site. So the floor
 * the game builds is the floor the fixture pins, and
 * `port-maze-fixtures.test.ts` measures exactly that rather than asserting it.
 * Left unconditional rather than behind a flag, on the same reasoning as
 * dev/floor-census.ts — a diagnostic that is off in the environment you care
 * about is its own trap.
 */
export type PassProbe = (snap: PassSnapshot) => void;

export interface TrackFloor {
  grid: Grid;
  graph: TrackGraph;
  path: TrackPath;
  mask: TrackMask;
  /** Spawn and exit, chosen ON the circuit (see pickTrackEndpoints). */
  start: TilePos;
  stairs: TilePos;
  /**
   * The plunger lane (track-launch.ts), or null when no straight sealed run
   * fitted. When present, `start` IS `chute.base` — the floor opens parked at
   * the closed end, and firing runs the hallway before the maze begins.
   */
  chute: LaunchChute | null;
  /**
   * Rules the generator could not satisfy and DELIBERATELY stood down on, by
   * rule id (maze/floor-rules.ts).
   *
   * The point of recording rather than silently relaxing: constraints like
   * "open at the edge" and "give the chute a long straight sealed run" can be
   * jointly unsatisfiable on a floor whose circuit never reaches the border,
   * and a rule that quietly gives up is indistinguishable from a rule that
   * broke. With this the gate can hold the rule absolutely AND track how often
   * the generator has to fall back — which is the number that tells you the
   * thresholds have drifted out of reach.
   */
  relaxed: string[];
  /**
   * Centre of the floor's ORBIT ISLAND, when one fitted — the full-circle
   * curved wall you can ride a lap around. Geometry belongs to this layer;
   * `decorateMaze` reads the centre to flank it with bumpers, which is content.
   */
  orbit: { ci: number; cj: number } | null;
  /**
   * The floor's authored openings between sections (maze/doorways.ts).
   *
   * Carried on the floor rather than re-derived, and that is the whole point:
   * a widened doorway is no longer a pinch, so re-detecting the set from the
   * finished grid returns exactly the openings that were NOT fixed. An early
   * version of the gate did that and failed 78 floors out of 78 on a metric
   * that measured the opposite of what it claimed.
   */
  doorways: Doorway[];
  /**
   * The King's Hall, when one could be carved: the chamber around the exit that
   * gives the Reaper King's ground-pound somewhere to be dodged. Null on a floor
   * with no site for one, which is recorded in `relaxed` rather than passed over.
   */
  bossRoom: { ci: number; cj: number; r: number } | null;
}

/**
 * Spawn and exit, both placed ON the track.
 *
 * Deliberately different from `pickEndpoints`, which picks the tile nearest a
 * random corner and then the farthest tile from it. That rule is right for a
 * maze — where the journey IS the floor — and wrong for a circuit, because it
 * would routinely drop the player in a maze cul-de-sac with the exit in
 * another one, and the track they are meant to ride would be scenery between
 * two errands.
 *
 * Here both endpoints sit on the circuit and are pushed as far apart as the
 * lane allows, so the natural route between them RUNS THE TRACK.
 */
export function pickTrackEndpoints(
  g: Grid,
  mask: TrackMask,
  chute?: { base: TilePos; mouth: TilePos } | null,
  opts: {
    perimeterBias?: number;
    minBossEuclid?: number;
    /**
     * A PREFERENCE, inside the tie band, for where the EXIT lands. Never an
     * override: `far()` applies it only after the distance band and the
     * sight-line filter have chosen the pool, so it can only pick among equals
     * — the same allocation-not-argmax shape this module's header argues for.
     *
     * Used twice for two phases of one requirement. Before the King's Hall is
     * carved it asks "could a hall fit here at all"; after, "is this tile IN the
     * hall". One hook, because they are one question.
     */
    stairsIn?: (i: number, j: number) => boolean;
  } = {},
): { start: TilePos; stairs: TilePos; relaxed?: string[] } | null {
  const lane: TilePos[] = [];
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (mask.lane[idx(g, i, j)] && isWalkable(g, i, j)) lane.push({ i, j });
    }
  }
  if (lane.length < 2) return null;

  // Double sweep: farthest lane tile from an arbitrary one, then farthest from
  // that. The graph diameter along the actual walkable surface, so the two ends
  // are genuinely a lap apart rather than merely far in a straight line.
  //
  // ── Why the argmax is not enough ─────────────────────────────────────────
  //
  // Taking the single farthest tile treats "far" as the only thing that matters
  // about an exit, and it isn't: a big loop's farthest point is often the one
  // diametrically opposite, which is far to WALK and dead straight to LOOK at.
  // That is the `directness` metric's failure case (euclid ÷ pathLen near 1),
  // and it is not hypothetical — censused over 1200 floors, the shipped argmax
  // produced a floor above the 0.85 band about once in 1200. Rare enough that
  // the gate's fixed 48-seed sample misses it, which is precisely why it needs
  // fixing at the source rather than at the assertion.
  //
  // So: take every tile within `TIE` of the best distance — they are all "a lap
  // away" for any purpose the player can perceive — and among those pick the
  // one the route has to work HARDEST to reach. The exit becomes an allocation
  // instead of an argmax, which is the same inversion the whole track-first
  // rework is built on (docs/game-dev-rules §3).
  const TIE = 0.92;
  // ── AND A STRAIGHT-LINE FLOOR ON TOP OF IT ───────────────────────────────
  //
  // The `directness` preference below is `euclid / pathLen`, MINIMISED. With
  // pathLen already pinned to the top 8% by the tie band, minimising that ratio
  // is minimising EUCLID: of all the tiles a lap away by path, it deliberately
  // takes the one physically nearest the spawn. That is the intended feature
  // (a windy route, not a straight shot) and it had no floor under it.
  //
  // Measured in the running game, not the generator: the exit — and therefore
  // the Reaper King, who is sited on it — arrived **6.7 tiles** from the player
  // at t=0 on seed 1 and 8.9 on seed 777, while comfortably passing the
  // path-distance rule because a wall sat between them. His skulls and slam
  // both ignore walls (see `minBossEuclid`), so that is a boss shooting at your
  // spawn from the moment the floor builds.
  //
  // So the band is filtered by straight-line distance FIRST, and the windiness
  // preference then chooses among what survives. Ordering matters: applied the
  // other way round the preference would keep picking the nearest tile and the
  // filter would have nothing left to reject.
  const minEuclid = opts.minBossEuclid ?? 0;
  // `from` is where the sweep ORIGINATES; `eye` is where the player actually
  // stands. With a launch chute they differ by the whole length of the hallway
  // — the exit is swept from the mouth so the lap is measured from where the
  // launch delivers you, but the king shoots at the PARK TILE. Measuring the
  // sight line from the mouth let a 6.7-tile exit through on seed 1.
  const far = (from: TilePos, eye: TilePos): { pos: TilePos; d: number; relaxed: boolean } => {
    const dist = bfsDistances(g, from.i, from.j);
    let best = -1;
    for (const p of lane) {
      const d = dist[idx(g, p.i, p.j)];
      if (d > best && d < 0x3fffffff) best = d;
    }
    if (best <= 0) return { pos: from, d: best, relaxed: false };
    const inBand = (tie: number): TilePos[] =>
      lane.filter((p) => {
        const d = dist[idx(g, p.i, p.j)];
        return d >= best * tie && d < 0x3fffffff;
      });
    // ── WIDEN THE BAND BEFORE GIVING UP ─────────────────────────────────────
    //
    // On a small floor the top-8% band can contain nothing far enough away in a
    // straight line — measured on L1 seed 1, the whole band topped out at 9.5
    // tiles. Standing the rule down there is the wrong trade: it buys a maximal
    // WALK at the cost of the king starting in your face, and the walk is the
    // cheaper thing to give up. A shorter lap that is genuinely separated beats
    // a longer one that is not.
    //
    // So the tie band is loosened in steps until something clears the sight
    // line, and only a floor where even the loosest band fails records a
    // relaxation. TIE stays the FIRST value tried, so floors that can satisfy
    // both keep exactly the route they had.
    let band = inBand(TIE);
    let clear = band.filter((p) => Math.hypot(p.i - eye.i, p.j - eye.j) >= minEuclid);
    for (const tie of [0.8, 0.65, 0.5]) {
      if (clear.length > 0 || minEuclid <= 0) break;
      band = inBand(tie);
      clear = band.filter((p) => Math.hypot(p.i - eye.i, p.j - eye.j) >= minEuclid);
    }
    // Nothing in the band is far enough in a straight line — a genuinely small
    // or tightly-coiled floor. Take the FARTHEST available rather than the
    // windiest, and let the caller record a declared relaxation: silently
    // falling back to the windiest would pick the closest, which is the defect.
    const pool = clear.length > 0 ? clear : band;
    const relaxed = clear.length === 0 && band.length > 0 && minEuclid > 0;
    // ── THE EXIT PREFERS THE HALL WE ARE ABOUT TO CARVE FOR IT ─────────────
    //
    // A preference, and never a prohibition. If the band and the hall do not
    // intersect, the hall loses: an exit close to the spawn is a worse defect
    // than a king in a corridor, and the latter is recoverable (recorded as a
    // relaxation and reported by the gate) while the former is not.
    const hall = opts.stairsIn ? pool.filter((p) => opts.stairsIn!(p.i, p.j)) : [];
    const choose = hall.length > 0 ? hall : pool;
    let bestPos = from;
    let bestScore = Infinity;
    for (const p of choose) {
      const d = dist[idx(g, p.i, p.j)];
      const euclid = Math.hypot(p.i - eye.i, p.j - eye.j);
      const wind = Math.hypot(p.i - from.i, p.j - from.j);
      // Windiest among the compliant; farthest-in-sight when nothing complies.
      // Windiness is still judged from the sweep origin (that is what makes the
      // ROUTE snake); the straight-line floor is judged from the player.
      const score = relaxed ? -euclid : wind / d;
      if (score < bestScore) {
        bestScore = score;
        bestPos = p;
      }
    }
    return { pos: bestPos, d: dist[idx(g, bestPos.i, bestPos.j)], relaxed };
  };
  // With a launch chute the start is NOT ours to choose: the floor opens where
  // the plunger is, and the plunger is at the closed end of the chute.
  //
  // The exit is then swept from the chute's MOUTH, not from its base, and the
  // distinction is load-bearing. Sweeping from the base spends the floor's
  // diameter on the chute itself — the ~20 tiles of hallway count toward "how
  // far away is the farthest lane tile", so the exit lands correspondingly
  // nearer. Measured: warrens L1 came out with the stairs **36 steps** from the
  // mouth on a 3975-tile floor, i.e. the launch fired you out of the chute
  // almost on top of the exit. Sweeping from the mouth restores the intent —
  // a lap of the circuit from where the launch DELIVERS you.
  // ── WHERE THE FLOOR OPENS WITHOUT A CHUTE ────────────────────────────────
  //
  // The ~6% of floors (5 of 78 censused) where no straight sealed run fitted.
  // With a chute the spawn is the plunger's park tile and this is not ours to
  // choose; without one it was "the farthest lane tile from an arbitrary lane
  // tile", which is a pure function of the circuit's shape and lands wherever
  // that happens to be.
  //
  // Same treatment the chute gets, for the same reason — otherwise these floors
  // quietly ignore the archetype's `perimeterBias` and the rule check fails on
  // exactly the minority of floors nobody looks at. A BAND again, not an
  // argmax: every tile within TIE of the best distance is "as far as it gets"
  // for any purpose the player can perceive, so the perimeter term chooses
  // among equals rather than overriding the distance requirement.
  const bias = opts.perimeterBias ?? 0;
  const startBand = (from: TilePos): TilePos => {
    const dist = bfsDistances(g, from.i, from.j);
    let best = -1;
    for (const p of lane) {
      const d = dist[idx(g, p.i, p.j)];
      if (d > best && d < 0x3fffffff) best = d;
    }
    if (best <= 0) return from;
    let pick = from;
    let pickScore = -Infinity;
    for (const p of lane) {
      const d = dist[idx(g, p.i, p.j)];
      if (d < best * TIE || d >= 0x3fffffff) continue;
      // Perimeter decides; the tiny distance term only breaks exact ties, so
      // two equally-peripheral tiles resolve to the farther one deterministically.
      const sc = bias * perimeterScore(g, p.i, p.j) + (d / Math.max(1, best)) * 0.001;
      if (sc > pickScore) {
        pickScore = sc;
        pick = p;
      }
    }
    return pick;
  };
  const a = chute ? chute.base : startBand(lane[0]);
  const b = far(chute ? chute.mouth : a, a);
  if (b.d <= 0) return null;
  return { start: a, stairs: b.pos, relaxed: b.relaxed ? ["boss-not-within-sight-of-spawn"] : [] };
}


/**
 * THE KING'S HALL — the one chamber a track floor carves for a fight.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * Live QA of floor 5 (ringkeep): the Reaper King fight happening "in a jumbled
 * mess in the middle of the floor". He is sited at `nearestOpenTile(stairs, 2)`
 * — whatever corridor the exit landed in — and on a ring keep that is a
 * four-tile inner gallery. `maze/floor-rules.ts` constrains how FAR he is from
 * the spawn (path distance, straight-line distance) and says nothing at all
 * about the space he fights in.
 *
 * And there was nothing else to fall back on: the four room archetypes and all
 * 13 prefabs are carved into `raw`, which `core.ts` DISCARDS on a track floor
 * (`rooms = track ? [] : ...`). A track floor ships with no authored room of any
 * kind. Floor 5 is also the worst case rather than a random one — `BOSS_EVERY`
 * makes it a double-HP king, and core.ts skips the bumper-ring antechamber on
 * exactly those floors.
 *
 * ── Why a disc, here, with this brush ─────────────────────────────────────
 *
 * `carveChamber` is the brush the greathall plaza already uses, and sharing it
 * is what makes the hall a first-class part of the floor BY CONSTRUCTION rather
 * than by remembering: `disc` sets `mask.lane`, so `uncarveDeadEnds` refuses to
 * eat it (track-socket keeps off lane tiles), the socket layer types it as road,
 * and the keep-out margin applies.
 *
 * It is wall -> floor ONLY, so it cannot disconnect anything and needs no strand
 * guard — the same argument `connectAll` and `carveDoorways` already rest on.
 * What it CAN leave is a stair-stepped rim of nubs, which is what the caller's
 * `repair()` is for.
 *
 * ── Declines rather than clips ────────────────────────────────────────────
 *
 * Three refusals, each of which is a defect this would otherwise author:
 *  · the SEALED lane and its flank (`nearSealed`) — the plunger hallway's whole
 *    value is that it commits you, and a hall opening into its side is the
 *    `floor-sealed` piece rule broken by the pass meant to improve the floor;
 *  · `carveChamber`'s own border margin — a clipped hall is not a hall;
 *  · a site that ALREADY measures big enough — a greathall whose exit landed in
 *    its plaza needs no second chamber, and carving one would merge two rooms
 *    into a field with no threshold between them.
 *
 * ONE tile of slide, no more, and the number is the same statement as the
 * gate's: the width the rule measures at the king's tile is
 * 2*(BOSS_ARENA_R - slide - 1) - 1 = 11 - 2*slide, against a required 9.
 *
 * Consumes NO rng: two co-op peers carve the identical hall.
 */
function carveBossChamber(
  g: Grid,
  mask: TrackMask,
  stairs: TilePos,
  clearance: Int32Array,
  orbit: { ci: number; cj: number } | null,
): { ci: number; cj: number; r: number } | null {
  const R = BOSS_ARENA_R;
  // Already roomy enough? Then this floor has its arena and a second carve would
  // only dissolve the boundary between two chambers.
  if (widthFromClearance(clearance[idx(g, stairs.i, stairs.j)]) >= BOSS_ARENA_MIN_WIDTH + 2) return null;
  const SLIDE = 1;
  for (let dj = -SLIDE; dj <= SLIDE; dj++) {
    for (let di = -SLIDE; di <= SLIDE; di++) {
      const ci = stairs.i + di;
      const cj = stairs.j + dj;
      if (ci - R < 2 || cj - R < 2 || ci + R > g.w - 3 || cj + R > g.h - 3) continue;
      // Never open the plunger lane's flank — see above.
      let touchesSealed = false;
      for (let y = cj - R; y <= cj + R && !touchesSealed; y++) {
        for (let x = ci - R; x <= ci + R; x++) {
          if ((x - ci) * (x - ci) + (y - cj) * (y - cj) > R * R) continue;
          if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
          if (nearSealed(g, mask, x, y)) {
            touchesSealed = true;
            break;
          }
        }
      }
      if (touchesSealed) continue;
      // ── AND IT KEEPS CLEAR OF THE ORBIT ISLAND ──────────────────────────
      //
      // The island is a FULL-CIRCLE arc feature, and `trimArcToBacking` refuses
      // to trim one — correctly, since a circle trimmed to a run stops being an
      // island and the floor loses its centrepiece. So unlike every other curve
      // family, an island cannot repair itself after the stone behind part of
      // its ring is opened: it simply ships partly unbacked, drawn as a curved
      // ribbon standing in open floor.
      //
      // That is exactly what happened the first time this pass ran — the piece
      // gate reported two islands at 71% and 96% backed, both with their centres
      // just outside the hall but their RINGS inside it. Hence the clearance is
      // measured to the ring, not the centre: R + ORBIT_RADIUS + ORBIT_RING.
      if (orbit) {
        const need = R + ORBIT_RADIUS + ORBIT_RING;
        if (Math.hypot(orbit.ci - ci, orbit.cj - cj) < need) continue;
      }
      if (!carveChamber(g, mask, ci, cj, R)) continue;
      return { ci, cj, r: R };
    }
  }
  return null;
}

/**
 * Build a complete track-first base grid at FINAL tile resolution.
 *
 * `cellsW/cellsH` are the caller's half-scale numbers (what `generateMaze`
 * takes) and the grid comes out at `(2c+1)` per side.
 *
 * `profile` is the floor archetype's grip on the topology (archetypes.ts). It
 * is optional so every existing caller keeps the shipped behaviour, but the
 * game always passes one — without it the five archetypes are names on a card
 * over five identical floors.
 */
export function buildTrackFloor(
  cellsW: number,
  cellsH: number,
  rng: () => number,
  opts: {
    linkChance?: number;
    fill?: number;
    minLoops?: number;
    profile?: TrackProfile;
    density?: number;
    /**
     * Author doorway funnels. DEFAULT OFF — and the reason is not the gameplay
     * number, which is good.
     *
     * Measured on 100 floors never used for tuning, paired per doorway against
     * the same floor with the flare removed: capture 47.9% → 53.9% (+6.1pp),
     * rejection −2.0pp, 79 doorways better against 26 worse. The mechanism
     * works.
     *
     * What is not finished is the INTEGRATION. Turning it on breaks three of
     * this generator's own gates — `piece-rules` on every archetype and again
     * after `decorateMaze`, and `floor-rules` on every generated floor. The
     * funnel both carves and fills, and the tile configurations it leaves are
     * not in the piece vocabulary those gates enforce. A floor that plays
     * better while violating three structural contracts is not a floor to ship;
     * the gates are the standard, not an obstacle.
     *
     * Three of the six original breakages ARE fixed and those fixes are in:
     * the pass now runs the pipeline's own `repair` behind it, clears arc tiles
     * the repair opens (`clearOrphanArcTiles`), and holds funnel links to the
     * full-backing bar `piece-rules` actually demands. What remains is making
     * the carve/fill output conform to the piece vocabulary.
     */
    funnels?: boolean;
    /** Author elliptical relay walls between doorway pairs (maze/relay-chambers.ts). */
    relays?: boolean;
    /** Funnel tuning, for the parameter sweep. Not a gameplay setting. */
    funnelTune?: { throatDeg?: number; depth?: number; segments?: number };
    /** Per-pass observation seam for the port-parity harness (see PassProbe). */
    onPass?: PassProbe;
  } = {},
): TrackFloor | null {
  const w = cellsW * 2 + 1;
  const h = cellsH * 2 + 1;
  const grid: Grid = { w, h, t: new Uint8Array(w * h), shapes: new Uint8Array(w * h) };

  // Explicit `opts` still win over the profile, so the debug spawner and the
  // tuning scripts can override one knob without inventing a whole profile.
  const prof = opts.profile ?? DEFAULT_TRACK_PROFILE;
  const { foods, relays } = trackNodeCounts(prof, w, h);

  // The observation seam (PassProbe). `probeMask` exists because the mask is
  // born mid-pipeline and every line below wants it non-null; the alternative
  // is a nullable `mask` and a `!` on forty call sites.
  let probeMask: TrackMask | null = null;
  // `extra` is a THUNK, not a value: `probe(pass, {…})` would build the object
  // at the CALL SITE, outside the guard below, so a floor with no observer
  // would still pay for twenty-three of them plus four walks of the arc list.
  const probe = (pass: string, extra: () => PassExtra = NO_EXTRA): void => {
    if (opts.onPass) opts.onPass({ pass, grid, mask: probeMask, extra: extra() });
  };
  /** Arc features and the rail lanes strung along them — one thunk, used four times. */
  const arcCounts = (): PassExtra => ({
    arcs: grid.arcs?.length ?? 0,
    lanes: (grid.arcs ?? []).reduce((n, f) => n + (f.lanes?.length ?? 0), 0),
  });

  const graph = growTrack(w, h, rng, {
    minLoops: opts.minLoops ?? prof.minLoops,
    layout: prof.layout,
    foods,
    relays,
    maxLenFrac: prof.maxLenFrac,
    survive: prof.survive,
  });
  if (graph.edges.length === 0) return null;
  probe("grow-track", () => ({ nodes: graph.nodes.length, edges: graph.edges.length, foods, relays }));
  const path = buildTrackPath(graph, { laneScale: prof.laneScale });
  if (path.legs.length === 0) return null;
  probe("track-path", () => ({ legs: path.legs.length }));

  const mask = carveTrack(grid, path);
  probeMask = mask;
  probe("carve-track");
  // THE PLAZA GOES DOWN BEFORE THE MAZE, never after. Carved afterwards it
  // would bulldoze finished corridors and leave severed stubs pointing into it;
  // carved here it is simply part of the circuit, and the maze's keep-out
  // margin respects it like any other lane. Sited on the surviving graph node
  // nearest the floor's centre — under the `hub` layout that IS the centre food
  // node — and `carveChamber` declines rather than clip a plaza on the border.
  //
  // ── AND IT HAS TO WIN. ─────────────────────────────────────────────────────
  //
  // The Great Hall's card says "one vast chamber · room to really move", and
  // censused over 36 floors it did not have the floor's biggest chamber: the
  // largest fully-open blob covered 0.153 of its walkable area against 0.185 on
  // a Warrens, which has no plaza at all and gets there by accident where lanes
  // merge. A single call that returns false on a bad site made it worse than
  // that — on those floors the archetype's ONLY structural feature silently did
  // not exist, and nothing recorded that it hadn't.
  //
  // So: try the largest radius the profile asks for and step down until one
  // fits, and if none does, say so in `relaxed` rather than shipping a Great
  // Hall with no hall in it. Stepping down beats moving the site, because the
  // site is the topological centre of the circuit and a chamber somewhere else
  // is a chamber the roads do not lead to.
  const plazaRelaxed: string[] = [];
  if (prof.plazaFrac > 0 && graph.nodes.length) {
    const cx = w / 2;
    const cz = h / 2;
    let hub = graph.nodes[0];
    for (const n of graph.nodes) {
      if ((n.x - cx) ** 2 + (n.z - cz) ** 2 < (hub.x - cx) ** 2 + (hub.z - cz) ** 2) hub = n;
    }
    const want = Math.min(w, h) * prof.plazaFrac;
    let carved = false;
    for (let r = want; r >= want * 0.6 && !carved; r -= 1) carved = carveChamber(grid, mask, hub.x, hub.z, r);
    if (!carved) plazaRelaxed.push("archetype-has-its-chamber");
  }
  probe("plaza", () => ({ relaxed: [...plazaRelaxed] }));
  // ── THE LAUNCH CHUTE (track-launch.ts) ──────────────────────────────────
  //
  // Carved HERE, between the circuit and the maze, for the same reason the
  // plaza is: it must be part of the track by the time anything else looks at
  // the grid. Carved after `growMazeAround` it would bulldoze finished
  // corridors; carved as decoration (which is effectively what the old free-air
  // plunger was) it would be a launch ritual with no lane behind it.
  // The archetype's spawn-placement weight reaches the chute here — this call
  // is what decides where the floor opens on 94% of floors (see the scoring
  // block in track-launch.ts).
  const profBias = prof.rules?.perimeterBias ?? DEFAULT_RULE_WEIGHTS.perimeterBias;
  const profEuclid = prof.rules?.minBossEuclid ?? DEFAULT_RULE_WEIGHTS.minBossEuclid;
  const chute = carveLaunchChute(grid, mask, rng, { perimeterBias: profBias });
  probe("launch-chute", () => ({
    chute: chute ? [chute.base.i, chute.base.j, chute.mouth.i, chute.mouth.j] : null,
  }));
  growMazeAround(grid, mask, rng, {
    linkChance: opts.linkChance ?? prof.linkChance,
    fill: opts.fill ?? prof.fill,
    density: opts.density,
  });
  probe("grow-maze");

  // ── PLUMBING REPAIR (track-socket.ts) ───────────────────────────────────
  //
  // The growth model makes an interesting layout but not a legible one. Before
  // these passes, 20 floors measured 105.8 dead ends and 116.4 wall stubs EACH
  // — corridors to nowhere and one-tile nubs jutting into rooms, which is what
  // made the floor read as "a bunch of walls that go nowhere".
  //
  // Order inside the block is load-bearing:
  //  1. UNCARVE first. It fills floor→wall and so can disconnect things, which
  //     is fine only because connectAll runs after it.
  //  2. connectAll next, to restore the one-component invariant uncarve may
  //     have broken. Carving wall→floor can only add connectivity, so nothing
  //     after this can strand the player.
  //  3. DE-STUB after both — widening leaves one-tile pillars when a corridor
  //     thickens, and connectAll's repair corridors carve fresh nubs of their
  //     own. Running it before either left 25.2 stubs + 5.2 isolated pillars
  //     per floor still standing.
  //  4. HEAL road terminations last: a lane that still ends in mid-air is
  //     DEMOTED to plain room floor, so no booster or bank is ever sited along
  //     a road to nowhere. Note what this does NOT do — it no longer tries to
  //     EXTEND the stub to rejoin the circuit. That chases its own tail, since
  //     each extension creates a new tile that is itself the new end of the
  //     road ("joined" fired 8-24x per floor while the count never moved). The
  //     real cause was topological (degree-1 graph leaves) and is fixed
  //     upstream by pruneLeaves; this is the belt-and-braces sweep.
  //
  // It is a FUNCTION because it runs TWICE — once after the maze grows, and
  // again after the curved walls are authored. That second call is not
  // defensive padding: a concave fillet fills a corner pocket floor→wall, which
  // is precisely the operation that manufactures a dead end. When the sweeps
  // lived in the content pass they ran after every repair had finished and
  // whatever they left simply shipped; measured on the live gate, moving them
  // here without re-running repair pushed six floors over the dead-end ceiling
  // (up to 5.31 per 1k tiles against a limit of 2.5).
  const endsEarly = pickTrackEndpoints(grid, mask, chute, { perimeterBias: profBias, minBossEuclid: profEuclid });
  const protect = endsEarly ? [endsEarly.start, endsEarly.stairs] : [];
  probe("endpoints-early", () => ({
    start: endsEarly ? [endsEarly.start.i, endsEarly.start.j] : null,
    stairs: endsEarly ? [endsEarly.stairs.i, endsEarly.stairs.j] : null,
  }));
  const repair = (keep: readonly TilePos[]): void => {
    uncarveDeadEnds(grid, mask, keep);
    // The keep-out steers the repair around any SEALED lane's walls — today the
    // launch chute's — and around published arc faces, because carving one is
    // how a swept curve becomes a curved wall with a hole in it. Neither can
    // refuse a connection; see connectAll.
    connectAll(grid, rng, repairKeepOut(grid, mask));
    removeWallStubs(grid, mask);
    if (endsEarly) healRoadTerminations(grid, mask, keep, { reach: 0 });
  };
  repair(protect);
  probe("repair-1");

  // ── DOORWAYS: PLANNED HERE, CARVED AT THE END (maze/doorways.ts) ─────────
  //
  // Planned on clean pre-curve geometry and carved after every floor→wall pass
  // has run. The split is not tidiness, it is the fix for the failure that sank
  // the first attempt: deciding what counts as a "room" from clearance
  // re-derived on every pass is SELF-AMPLIFYING, because widening an opening
  // promotes the corridor beyond it into a room, which manufactures a fresh
  // doorway. Measured, 34 → 107 doorways per floor while the pinches barely
  // moved. Labelling the sections once, here, makes a doorway "the opening
  // between section 3 and section 7" — a statement carving cannot invalidate.
  //
  // The plan is also what the curve passes are told to avoid. A fillet built on
  // a planned threshold is a curve the doorway would later have to cut through,
  // and cutting it un-backs the drawn arc; steering the curves around the plan
  // is far cheaper than arbitrating between them afterwards.
  const doorSites = planDoorways(grid);
  const doorGuard = new Set<number>();
  for (const s of doorSites) {
    const d = resolveDoorway(grid, s, { mask });
    if (d) for (const t of doorwayFootprint(grid, d)) doorGuard.add(idx(grid, t.i, t.j));
  }
  const onDoorway = (i: number, j: number): boolean =>
    i >= 0 && j >= 0 && i < grid.w && j < grid.h && doorGuard.has(idx(grid, i, j));
  probe("plan-doorways", () => ({ sites: doorSites.length, guard: doorGuard.size }));

  // ── CURVED WALLS, ALL OF THEM, HERE ─────────────────────────────────────
  //
  // A floor's curves used to be authored by TWO different layers. This one
  // published the circuit's own fillets; then `decorateMaze` — the CONTENT pass
  // that places bumpers, loot and zombies — ran `stampOrbitIsland` and
  // `authorArcSweeps` and built more. Censused over 30 floors, the content pass
  // owned the majority of them: 48.8 features per floor against this layer's
  // 35.5, and 179.3 tiles of arc length against 146.7. It also converted **44.9
  // tiles per floor from floor to wall** — the content pass was building walls.
  //
  // That is the defect the user named ("the walls that are curved are in the
  // pinball logic and not in the maze wall logic"), and it is a layering bug in
  // the sense of docs/game-dev-rules §3: layer 2 owns corner radii, layer 4
  // owns detail and "never contradicts" the macro intent. Curves authored after
  // content are curves fitted around furniture; curves authored here are curves
  // the furniture is then placed around. Same passes, opposite precedence.
  //
  // Three concrete things fall out of the move, none of them cosmetic:
  //
  //  · the repair passes now run BEFORE the curves exist and the de-stub pass
  //    runs again after, so a nub a fillet leaves behind is cleaned like any
  //    other. Previously the sweeps ran after every repair had finished and
  //    whatever they left stood.
  //  · `occupied` becomes trivially empty. That is the point, not a
  //    regression: a concave fillet no longer declines because a torch is in
  //    the way, it simply gets built and the torch is placed elsewhere.
  //  · `publishArcs` goes FIRST, so the circuit's own banked turns claim their
  //    tiles before the scavenging pass looks at corners. `authorArcSweeps`
  //    only considers tiles whose shape is still SHAPE_FULL, so this ordering
  //    is what makes "the track's curves win" true by construction.
  publishArcs(grid, path);
  probe("publish-arcs", arcCounts);
  const arcStart = endsEarly?.start ?? { i: 1, j: 1 };
  const orbit = stampOrbitIsland(grid, arcStart, onDoorway, rng);
  probe("orbit-island", () => ({ ...arcCounts(), orbit: orbit ? [orbit.ci, orbit.cj] : null }));
  authorArcSweeps(grid, arcStart, onDoorway, rng);
  probe("arc-sweeps", arcCounts);
  // The curves change geometry, so the geometry gets repaired — see `repair`.
  repair(protect);
  probe("repair-2");

  // ⚠️ NO `stairsIn` HERE, and that is deliberate. Biasing the FINAL exit toward
  // tiles a hall could be centred on excludes a nine-tile band around the whole
  // border, and `floor-metrics` caught the cost immediately: "exit on the
  // doorstep" and "straight shot to the exit" on greathall floors, because the
  // distance-and-windiness optimum is often exactly out there. The hall is a
  // room we build for the exit, not a constraint the exit serves — where one
  // genuinely cannot fit, `carveBossChamber` declines and the floor records a
  // relaxation, which is the honest outcome.
  const ends = pickTrackEndpoints(grid, mask, chute, { perimeterBias: profBias, minBossEuclid: profEuclid });
  if (!ends) return null;
  probe("endpoints-final", () => ({
    start: [ends.start.i, ends.start.j],
    stairs: [ends.stairs.i, ends.stairs.j],
    relaxed: [...(ends.relaxed ?? [])],
  }));

  // ── THE KING'S HALL ─────────────────────────────────────────────────────
  //
  // AFTER the final endpoints, and that position is the whole design.
  //
  // The obvious place is beside the plaza carve, or right after `endsEarly` so
  // `planDoorways` can author the hall's mouths from the standard 3/5/7
  // vocabulary for free. Both were tried and both are wrong, for two separate
  // measured reasons:
  //
  //  · CARVED EARLY, IT GETS EATEN. `stampOrbitIsland` hunts for "a wide-open
  //    floor disc" to stamp a full circle into, and the King's Hall is by
  //    construction the widest open disc on the floor; the concave fillets want
  //    its rim crooks and the artery banks want to shell its turns. All three
  //    convert floor to WALL. Measured: the hall came out ONE TILE wide at the
  //    king's tile on a third of floors — carved, then filled back in.
  //  · CARVED AROUND THE PROVISIONAL EXIT, IT IS BUILT AROUND THE WRONG TILE.
  //    `endsEarly` is re-picked here on a grid the curve passes have changed,
  //    and `far()` scores by `wind/d` — a ratio that flips between distant
  //    candidates on small perturbations. Measured: the final exit landed 17 to
  //    81 tiles from the early one on half the floors. Forcing the exit to stay
  //    put instead was tried too, and it costs exit QUALITY: `floor-metrics`
  //    immediately reported "exit on the doorstep" and "straight shot to the
  //    exit", because the early pick was never optimised for the final geometry.
  //
  // Carving here answers both at once. Every wall-adding curve family has
  // already run, so there is nothing left to eat it (the artery banks below are
  // the one exception, and they are guarded); and the exit is final, so the room
  // is around the tile the player actually walks to. The price is that the hall
  // is not in the doorway PLAN, so its mouths are ordinary openings rather than
  // authored 3/5/7 thresholds. That is a real cost and it is the cheaper one:
  // an exit on the doorstep ruins the floor, an unauthored mouth does not.
  //
  // ── AND IT IS GUARDED, because opening 154 tiles AT THE EXIT is a shortcut ──
  //
  // The hall adds floor, so it cannot strand anything — but it can shorten the
  // route to the exit and straighten it, and on an already-open archetype that
  // is enough to break the floor gate: measured, greathall L8 fell to pathLen 32
  // against a required 39, and greathall L5 to directness 0.871 against 0.85.
  // Both are the same story — a greathall already IS a chamber (plazaFrac carves
  // one), so a second one next to the exit merges into it and the last stretch
  // of the journey disappears.
  //
  // Same shape as `resealChute`'s guard: do it, re-measure, put it back if it
  // was load-bearing. Reverting is exact because `disc` only ever converts wall
  // to floor, so restoring the snapshot restores the floor precisely.
  // ⚠️ MEASURED FROM THE CHUTE MOUTH, exactly as `measureFloor` does, not from
  // the spawn. The two differ by the whole ~20-tile plunger lane, so a guard
  // written from the spawn passes a floor the gate then fails — which is what
  // happened: greathall L8 read 52 here and 32 there. A guard that measures a
  // different quantity from the gate it exists to satisfy is not a guard.
  const routeFrom = chute ? chute.mouth : ends.start;
  const routeOk = (): boolean => {
    const d = bfsDistances(grid, routeFrom.i, routeFrom.j);
    const len = d[idx(grid, ends.stairs.i, ends.stairs.j)];
    if (len < 0) return false;
    if (len < (grid.w + grid.h) * DEFAULT_CONSTRAINTS.minPathSpan) return false;
    const euclid = Math.hypot(ends.stairs.i - routeFrom.i, ends.stairs.j - routeFrom.j);
    return len === 0 || euclid / len <= DEFAULT_CONSTRAINTS.maxDirectness;
  };
  const tilesBefore = Uint8Array.from(grid.t);
  const laneBefore = Uint8Array.from(mask.lane);
  const shapesBefore = Uint8Array.from(grid.shapes);
  let bossRoom = carveBossChamber(grid, mask, ends.stairs, clearanceField(grid), orbit);
  // A disc's rim is stair-stepped, so it leaves nubs like every other carve and
  // gets the same treatment every other carve gets.
  if (bossRoom) repair([ends.start, ends.stairs]);
  if (bossRoom && !routeOk()) {
    grid.t.set(tilesBefore);
    grid.shapes.set(shapesBefore);
    mask.lane.set(laneBefore);
    bossRoom = null;
  }
  probe("boss-chamber", () => ({ boss: bossRoom ? [bossRoom.ci, bossRoom.cj, bossRoom.r] : null }));
  /** The hall's interior, kept clear of the one wall-adding pass still to come.
   *  `r - 1` rather than `r` so the rim itself stays available to be filleted
   *  round — a jagged arena rim is the artefact the curve work exists to remove. */
  const inBossRoom = (i: number, j: number): boolean =>
    bossRoom !== null && (i + 0.5 - bossRoom.ci) ** 2 + (j + 0.5 - bossRoom.cj) ** 2 <= (bossRoom.r - 1) ** 2;

  // ── ARTERY BANKS — the last of the three curve families to come home ─────
  //
  // A bank is the OUTER shell of a turn on the start→stairs route: it converts
  // floor to wall to give a bend a rideable outside edge. It ran inside
  // `decorateMaze` — as the very first thing that pass did, before any content,
  // which is the tell that it never belonged there. Location was the only thing
  // making it "content"; measured, it was the last remaining source of the
  // content pass building walls (1.62 banks per floor, 82% of floors).
  //
  // It runs AFTER the sweeps and the repair, on the final endpoints, because a
  // bank is defined by the route and the route is defined by the finished
  // geometry. `authorArteryBanks` commits each bank behind its own strand
  // guard, so this cannot orphan anything; the repair below then cleans the
  // nubs the new wall shells leave, exactly as it does for the fillets.
  //
  // THE WHOLE CHUTE IS PROTECTED, mouth included. The route is traced from the
  // spawn, and the spawn is the chute's park tile, so the artery runs the full
  // length of the launch hallway and the mouth is its first real bend — exactly
  // the shape the bank pass reaches for. Unprotected it walls the mouth in:
  // measured on the live gate, 8 floors came back "no route from spawn to
  // stairs" while reachability still read 1.0000, which is the signature of the
  // route's second tile being solid rather than of anything being stranded.
  //
  // Protecting `mask.sealed` alone is NOT enough and that was the first fix
  // tried: the mouth cross-section is deliberately left unsealed so the merge
  // can open into the maze, which makes it the one part of the chute a bank may
  // still eat. `chuteTiles` is the lane in full.
  const arteryDist = bfsDistances(grid, ends.start.i, ends.start.j);
  const artery = traceArtery(grid, ends.start, ends.stairs, arteryDist);
  if (artery.length >= 8) {
    const guarded = new Set<number>(doorGuard);
    if (chute) for (const t of chuteTiles(grid, chute)) guarded.add(idx(grid, t.i, t.j));
    for (let k = 0; k < mask.sealed.length; k++) if (mask.sealed[k] === 1) guarded.add(k);
    const isGuarded = (i: number, j: number): boolean =>
      (i >= 0 && j >= 0 && i < grid.w && j < grid.h && guarded.has(idx(grid, i, j))) || inBossRoom(i, j);
    authorArteryBanks(grid, artery, ends.start, NOTHING_OCCUPIED, isGuarded);
    repair([ends.start, ends.stairs]);
  }
  probe("artery-banks", () => ({ ...arcCounts(), artery: artery.length }));

  // ── LAST: prune curves nothing meaningfully owns ────────────────────────
  //
  // `arcSweepGeometry` walks `Grid.arcs` and draws every feature's FULL span
  // without ever asking which tiles reference it, so a feature whittled down to
  // one tile by a later pass still renders a whole quarter-circle band hanging
  // off a single stone. Measured before this pass: 5.1% of features owned 1-2
  // tiles and 0.1% owned none, and all of them were being drawn.
  //
  // It has to run here, after every pass that can take tiles away. It only
  // rewrites shapes and remaps indices — no tile changes walkability — so it
  // cannot affect connectivity.
  // Close any side door `connectAll` had to punch into the plunger lane rather
  // than strand a pocket (about one floor in forty). Strand-guarded: a tile
  // that turns out to be load-bearing is put straight back.
  if (chute) {
    resealChute(grid, mask, chute, () => {
      const d = bfsDistances(grid, ends.start.i, ends.start.j);
      for (let j = 0; j < grid.h; j++) {
        for (let i = 0; i < grid.w; i++) {
          if (isWalkable(grid, i, j) && d[idx(grid, i, j)] < 0) return false;
        }
      }
      return true;
    });
  }
  probe("reseal-chute");

  // ── AND NOW THE DOORWAYS ARE CUT ────────────────────────────────────────
  //
  // After every pass that converts floor to wall, so nothing can wall an
  // opening back up — and BEFORE `compactArcs`, which is the ordering the piece
  // gate forced. The arc-span guard refuses to cut under a drawn band, but the
  // guard is a mask over tiles and a cut two tiles away can still take the last
  // stone from under the END of a span. `compactArcs` is exactly the pass that
  // trims a feature back to the part still backed, so it has to see the floor
  // WITH the doorways in it. Carved after it, two floors in 150 shipped a
  // curved ribbon over open ground (91% and 94% backed).
  //
  // The guard is therefore built from the pre-compaction feature list, which is
  // a superset of the final one — strictly more conservative, never less.
  //
  // Before `removeWallStubs` too, because opening a doorway raises the open-
  // neighbour count of every wall beside it: the nubs the cut leaves are
  // exactly what that pass exists to clean, and running it first would leave
  // them standing.
  //
  // Nothing needs to run after this to keep the floor connected. The carve is
  // wall → floor only, so it cannot strand a tile; and the throat is extended
  // until the full-width cross-section is already open on both sides, so every
  // column of an opening ends on floor and the cut creates no dead ends.
  const doors = carveDoorways(grid, doorSites, { mask, spanMask: arcSpanMask(grid) });
  probe("carve-doorways", () => ({ doorways: doors.doorways.length }));

  // ── AND THEN FLARE THEM, SO THE BALL CAN ACTUALLY GET THROUGH ───────────
  //
  // A uniform opening is not yet a usable one. `scripts/funnel-census.mjs`
  // fires balls at every doorway on real floors from every position and angle a
  // player could arrive at: 54.0% get through and 27.9% are sent back the way
  // they came, and it is the NARROW doorways that lose (3 wide: 45.1%; 7 wide:
  // 63.5%). `doorway-funnels.ts` gives the worst of them parabolic jaws — focus
  // on the mouth, so a corridor's worth of parallel approaches is gathered onto
  // the opening.
  //
  // HERE, and the position is doing three things:
  //
  //  · after `carveDoorways`, because the jaws are fitted to the size that was
  //    actually built. `resolveDoorway` steps 7 down to 5 down to 3 when the
  //    wide one will not fit, and f = w/4 is what puts the arms on the jambs —
  //    a funnel built for the size that was ASKED for misses them.
  //  · before the compaction/de-stub fixed point below, so a nub the flare
  //    leaves is cleaned like any other and the jaws' backing is certified by
  //    the same `compactArcs` that certifies every other face. Running after it
  //    would ship exactly the unbacked-ribbon defect that loop exists to stop.
  //  · before the rail pass, so a jaw is eligible for a booster lane like any
  //    other curve — a lane on a jaw CARRIES the ball through the door rather
  //    than bouncing it at the door.
  //
  // It both carves and FILLS — a funnel's arm is wall the corridor did not have
  // — so it carries the same collective BFS strand guard with revert that the
  // concave fillets do, taking `ends.start` as the root.
  if (opts.funnels === true)
    authorDoorwayFunnels(
      grid,
      doors.doorways,
      ends.start,
      (i: number, j: number) => nearSealed(grid, mask, i, j),
      opts.funnelTune ?? {},
    );
  // ⚠️ AND THE FLOOR IS REPAIRED AFTER IT, like every other pass that moves
  // stone. The funnel is the only pass down here that FILLS — it raises a
  // corridor's floor into the funnel's own wall — and a fill is precisely what
  // the repair machinery exists to clean up after: it can leave a road ending
  // in mid-air, a stub, or a pocket the circuit no longer reaches. The pass's
  // own strand guard proves the floor is still CONNECTED, which is a weaker
  // claim than "still well-formed", and three structural gates said so —
  // `track-socket`'s no-road-in-mid-air, the arc-ownership check, and
  // buildable-and-solvable across every depth and seed.
  //
  // `repair` is idempotent-ish and cheap next to the generation above it, and
  // running it here puts the funnel on the same footing as the doorway carve
  // and the curve passes rather than trusting it to be special.
  // RELAY CHAMBERS — the two-focus ellipse between a section's two doorways.
  // After the funnels so a relay wall cannot claim a jaw's tiles, and inside
  // the same repair below.
  if (opts.relays === true)
    authorRelayChambers(grid, doors.doorways, ends.start, (i: number, j: number) => nearSealed(grid, mask, i, j));

  if (opts.funnels === true || opts.relays === true) {
    repair([ends.start, ends.stairs]);
    // The repair OPENS stone, and `removeWallStubs`/`uncarveDeadEnds` do not
    // consult `repairKeepOut` — so a jaw can come out of it with a tile or two
    // that still claims a curved face while standing on open floor. Two per
    // fifteen floors, and every one is a see≠hit. Cleared here rather than
    // guarded against, because the repair is right to open them.
    clearOrphanArcTiles(grid);
  }
  // Emitted even when both are off, so the pass INDEX of everything after it is
  // the same number on every floor — a harness that has to know whether a floor
  // ran the optional passes cannot report "pass 19 diverged".
  probe("funnels-relays", () => ({ funnels: opts.funnels === true ? 1 : 0, relays: opts.relays === true ? 1 : 0 }));

  // ── TRIM CURVES AND CLEAN NUBS, TO A JOINT FIXED POINT ──────────────────
  //
  // These two passes feed each other, and running them once each — which is
  // what shipped — leaves whichever defect the other one just created.
  //
  //  · compaction turns a dropped feature's rim tiles back into plain stone,
  //    and a former rim can be a three-sided nub. `removeWallStubs` skips arc
  //    tiles, so it had no opinion on them while they were still rims.
  //  · de-stubbing opens wall tiles, and a wall tile can be the last stone
  //    BEHIND a drawn arc span without carrying an arc face itself — the
  //    backing probe sits 0.6 tiles inside the radius, well short of the 2.0-4.5
  //    band `publishArcs` claims. Opening one leaves a curved ribbon over open
  //    floor, which is what the piece gate caught on 1 floor in 150 once
  //    doorways started creating stubs next to backing stone.
  //
  // ITERATING IS SAFE HERE, unlike the doorway pass itself (see doorways.ts on
  // self-amplification), and the reason is that both passes are MONOTONE in
  // opposite directions: `removeWallStubs` only ever converts wall → floor, and
  // `compactArcs` only ever drops or trims features. Neither can undo the
  // other's work, so the pair strictly decreases the work left and must reach a
  // fixed point. The loop exits on the round that removes no stub — at which
  // point nothing can have been unbacked since the last compaction.
  //
  // 8 is a runaway guard, not an operative value; measured, floors settle in
  // two rounds. If it is ever hit, something is oscillating and that is a bug
  // to find rather than a limit to raise.
  for (let round = 0; round < 8; round++) {
    compactArcs(grid);
    if (removeWallStubs(grid, mask) === 0) break;
  }
  // ── AND COMPACTION HAS THE LAST WORD ────────────────────────────────────
  //
  // The loop above ends on `removeWallStubs`, which converts wall to FLOOR — so
  // whenever the final round actually removes a stub, it can un-back an arc face
  // that the compaction at the top of that same round had just certified. The
  // loop's exit condition hides this in the common case (it breaks when the stub
  // pass changed nothing, and then nothing can have been un-backed), which is
  // why it went unnoticed until the King's Hall gave the stub pass more to do:
  // three floors in 180 shipped a feature 71-96% backed, i.e. a curved ribbon
  // with one end standing in open air — the exact defect the arc contract
  // exists to prevent.
  //
  // One more compaction, unconditionally. It only ever trims or drops features,
  // so it cannot create work for the stub pass and the fixed point still holds.
  compactArcs(grid);
  probe("compact-fixed-point", arcCounts);

  setTile(grid, ends.stairs.i, ends.stairs.j, T_STAIRS);
  probe("stairs", () => ({ stairs: [ends.stairs.i, ends.stairs.j] }));

  // ── AND THE RAILS COME UNDER THE Φ CONTRACT, LAST ───────────────────────
  //
  // Here, and not with the sweeps at `authorArcSweeps` above, for three reasons
  // that are each independently sufficient:
  //
  //  · Φ needs ONE SINK and it is the stairs — which only exist as of the line
  //    above. `endsEarly` was provisional; `ends` is what ships.
  //  · A rail's exit runway is a property of the FINISHED grid. Between the
  //    sweeps and here the artery banks converted floor→wall, the doorways
  //    converted wall→floor, `removeWallStubs` opened more, and `compactArcs`
  //    rewrote the bands' own a0/span. Judging earlier judges a floor that does
  //    not ship.
  //  · `authorArteryBanks` authors rails TOO. A phi-aware `authorArcSweeps`
  //    would leave that second author unchecked — the two-owner problem, in the
  //    rail layer.
  //
  // Writes only `feature.lanes`: no tile, no shape, no arcIdx, no rng. So it
  // cannot perturb a layout, and `orientArcRails`' own test pins that.
  orientArcRails(grid, buildFlowField(grid, ends.stairs));
  probe("arc-rails", arcCounts);

  // A high-bias floor that opened centrally: was a peripheral option ever on
  // the table? `edgeBest` is the band's best, so "no" means impossible, not
  // ignored. Without a chute the same question is asked of the lane itself.
  const relaxed: string[] = [...(ends.relaxed ?? []), ...plazaRelaxed];
  // ── ENDPOINTS THAT CAME OUT TOO CLOSE ───────────────────────────────────
  //
  // `pickTrackEndpoints` puts start and stairs on the circuit "a lap apart",
  // and on nearly every floor it does: censused over 78 REAL floors the
  // start→stairs walk runs min 26, p5 57, median 118 tiles. But it is a search,
  // and on a bad seed it settles short — L1 warrens seed 424242 lands 26 tiles
  // apart on a floor whose reach is 128, i.e. a fifth of the way across.
  //
  // That is a generator shortfall, not a rule that is set too high (p5 = 57
  // against a floor of 30 is nearly a two-fold margin), so it is recorded the
  // way every other shortfall on this floor is: `relaxed` stands the rule down
  // for this floor and `floor-rules.test.ts` caps how OFTEN that may happen, at
  // 12%. Measured rate at the time of writing: 2/78 = 2.6%.
  //
  // ⚠️ This was invisible until 2026-07-31 because the rule gate's harness built
  // a different floor population than the game — see `floorContext`'s header.
  // Making `pickTrackEndpoints` actually hit the target on those seeds is the
  // real fix and is NOT done here; this makes the shortfall visible and counted
  // instead of failing the suite on a defect nobody had measured.
  //
  // Each rule is measured against ITS OWN tile, not one shared distance. The
  // king rides the stairs but `nearestOpenTile` can seat him up to 2 tiles off
  // them, so the two genuinely come apart — L1 warrens seed 7777 has the stairs
  // a legal 30 away and the king 29. Standing both down off the stairs figure
  // would have quietly exempted a rule that was still being met.
  {
    const dist = bfsDistances(grid, ends.start.i, ends.start.j);
    const want = (prof.rules?.minBossTiles ?? DEFAULT_RULE_WEIGHTS.minBossTiles) as number;
    const bossSpot = nearestOpenTile(grid, ends.stairs.i, ends.stairs.j, 2) ?? ends.stairs;
    const dBoss = dist[idx(grid, bossSpot.i, bossSpot.j)];
    const dExit = dist[idx(grid, ends.stairs.i, ends.stairs.j)];
    if (dBoss >= 0 && dBoss < want) relaxed.push("boss-not-near-spawn");
    if (dExit >= 0 && dExit < want) relaxed.push("exit-not-near-spawn");
    // ── THE SAME SEATING SLACK, ON THE STRAIGHT-LINE RULE ────────────────
    //
    // The block above exists because the king rides the stairs but
    // `nearestOpenTile` can seat him up to 2 tiles off them, so the two come
    // apart. That reasoning was applied to the PATH rules and not to the
    // straight-line one, which left the generator and the gate answering "how
    // far is the boss from the spawn" differently: `pickTrackEndpoints` tests
    // `minBossEuclid` against the STAIRS, `boss-not-within-sight-of-spawn`
    // tests it against the SEATED KING.
    //
    // Up to two tiles of disagreement, and it is reachable — L28 greathall
    // seeds 1 and 7777 land at 19.0 and 19.2 against a wanted 20, on floors the
    // endpoint search believed were legal. It went unseen because the old level
    // sweep sampled the saturated regime at only L20 and L25.
    //
    // Recorded as a relaxation rather than repaired, because that is what it
    // is: the endpoint search DID satisfy its constraint and the seating moved
    // the king afterwards. The relaxation rate is itself gated (< 0.12), so a
    // version of this that fired often would still fail.
    const euclidWant = (prof.rules?.minBossEuclid ?? DEFAULT_RULE_WEIGHTS.minBossEuclid) as number;
    const euclid = Math.hypot(bossSpot.i - ends.start.i, bossSpot.j - ends.start.j);
    if (euclid < euclidWant && !relaxed.includes("boss-not-within-sight-of-spawn")) {
      relaxed.push("boss-not-within-sight-of-spawn");
    }
  }
  if (profBias >= 0.5 && perimeterScore(grid, ends.start.i, ends.start.j) < PERIMETER_RULE_MIN) {
    const available = chute
      ? chute.edgeBest
      : (() => {
          let m = 0;
          for (let j = 0; j < grid.h; j++) {
            for (let i = 0; i < grid.w; i++) {
              if (mask.lane[idx(grid, i, j)] && isWalkable(grid, i, j)) m = Math.max(m, perimeterScore(grid, i, j));
            }
          }
          return m;
        })();
    if (available < PERIMETER_RULE_MIN) relaxed.push("spawn-respects-perimeter-bias");
  }
  // No hall could be sited, or the final exit walked out of the one that was.
  // RECORDED rather than silently accepted: the rule then reports OK for this
  // floor while floor-rules.test.ts separately caps how OFTEN that may happen,
  // which is what stops a relaxation from hollowing the rule out.
  if (!bossRoom || !inBossRoom(ends.stairs.i, ends.stairs.j)) relaxed.push("boss-has-room-to-fight");

  probe("done", () => ({ relaxed: [...relaxed] }));
  return {
    grid,
    graph,
    path,
    mask,
    start: ends.start,
    stairs: ends.stairs,
    chute,
    orbit,
    relaxed,
    doorways: doors.doorways,
    bossRoom,
  };
}

/** Independent cycles in the circuit — exposed for HUD/debug and tests. */
export function floorCircuitRank(f: TrackFloor): number {
  return circuitRank(f.graph);
}
