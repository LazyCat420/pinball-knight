/**
 * ARC SWEEPS — multi-tile curved walls, the pinball-table "ball guides".
 *
 * The single-tile ROUND shapes (tile-shape.ts) fillet a corner at radius 1,
 * which still reads as "boxes with filed corners". This pass authors REAL
 * sweeping curves: circular arcs of radius 2-3 tiles at qualifying corners, and
 * a full ROUND ISLAND (an orbit) in big open plazas. Each sweep is one
 * ArcFeature (centre/radius/span, grid coords) stored in `Grid.arcs`; the tiles
 * the arc passes through carry SHAPE_ARC + the feature index. The collider
 * (collision.resolveShapeOrArc) and the mesh (build.buildArcShells) both derive
 * from the SAME descriptor — see = hit, the tile-shape contract.
 *
 * Two fillet families, same circle, opposite polarity:
 *  - CONVEX (a wall-mass outer corner): solid INSIDE the arc. Authoring only
 *    CARVES wall→floor (the corner "shoulder" outside the arc), so connectivity
 *    can only improve — safe by construction, like prefab stamps.
 *  - CONCAVE (a room's inner corner): solid OUTSIDE the arc. Authoring fills
 *    the sharp corner pocket floor→wall, so it is gated on placed content
 *    (`occupied`) and the whole batch is BFS strand-guarded with revert.
 *
 * The ORBIT ISLAND is a full-circle convex feature (span 2π) stamped into a
 * wide-open floor disc, leaving a ring lane ≥ ORBIT_RING tiles around it — the
 * ball can ride a true orbit. Adds wall, so it's strand-guarded too.
 *
 * Geometry convention (shared with tile-shape.ts): for a corner lattice point P
 * and cut/diag direction (cx,cz) ∈ {±1}², the fillet circle is centred at
 * C = P − (cx·R, cz·R) — R away from both wall faces, tangent to each — and
 * spans the quadrant facing (cx,cz). DOM- and three-free: tested.
 */
import { type Grid, type TilePos, T_WALL, T_FLOOR, T_CRACKED, at, setTile, isWalkable, setShape, shapeAt, idx, ensureArcs } from "./generator";
import { SHAPE_FULL, SHAPE_ARC, type ArcFeature, type KickBand, type LaneBand } from "../engine/tile-shape";
import { bfsDistances, bfsDistancesOwned } from "../engine/flow-field";
import { junctionClear } from "./arc-contract";
import { flowDrop, isDownhill, openRunway, phiAt } from "./flow-orient";

/**
 * Fillet radii tried largest-first at every qualifying corner.
 *
 * DELIBERATELY UNCHANGED at [3, 2], because measurement killed the obvious
 * idea. A radius-R fillet needs an R×R block where every tile passes the
 * structural tests, so the cost grows quadratically: censused over 40 real
 * floors, radius 2 fitted 3673 times, radius 3 only 161, radius 4 just 4 and
 * radius 5 twice. Bigger fillets are not the lever for longer arcs — they are
 * mostly wasted attempts, and adding radius 4 also perturbs which corners get
 * carved at all (it broke a pinned convex-site test by fitting where nothing
 * fitted before). Changing this rerolls floor layouts for no gain.
 *
 * Merging adjacent quarter-turns into one long sweep was tried too, and it does
 * not work either — for a structural reason worth recording so nobody rebuilds
 * it. Every fillet is centred at C = P − (cx·R, cz·R) for its OWN corner P, so
 * two fillets at different corners are on different circles by construction.
 * Censused on a real floor: 96 arcs, 96 distinct circles, zero sharing a
 * centre. There is nothing to merge.
 *
 * Longer banks therefore need a different AUTHORING primitive — an arc placed
 * along a corridor run rather than filleted into a corner — which is a new
 * feature, not a tuning change. Until then a rail's length is one quarter-turn,
 * and RAIL_GRACE is what makes that long enough to hold.
 */
export const FILLET_RADII: readonly number[] = [3, 2];
/** Feature cap per floor (draw-call + Int16 arcIdx sanity; generous). */
export const MAX_SWEEPS_PER_FLOOR = 96;
/** Orbit island: island radius and required clear ring beyond it (tiles). */
export const ORBIT_RADIUS = 2.3;
export const ORBIT_RING = 1.6;

// ── KICKER BANDS — the booster rubber wrapped around a sweep (see KickBand) ──
// Authoring knobs live here beside the sweeps they dress (constants.ts owns the
// physics/feel numbers the kick itself uses). A band is an angular sub-span of
// the sweep it rides, so it costs no extra geometry decisions: same circle,
// same collider, just a stretch that THROWS instead of banking.
/** Chance a qualifying fillet sweep is dressed with rubber. Cut from 0.45 with
 *  the rail rebalance: rubber on the OUTSIDE bulges was reading as "the
 *  boosters are on the wrong curves", because it out-numbered the inside
 *  lanes and gold shouts louder than arcane blue. It is now the accent. */
export const KICK_CHANCE = 0.22;
/** Fraction of a fillet's span the band covers, centred on the arc. */
export const KICK_BAND_FRAC = 0.62;
/** Bands strung evenly around an orbit island, and each one's width (rad). */
export const KICK_ISLAND_BANDS = 3;
export const KICK_ISLAND_SPAN = 0.62;
/** Hard cap per floor — a machine, not a trampoline. */
export const KICK_MAX_PER_FLOOR = 6;
/** Only sweeps with at least this much arc are worth a band (rad). */
export const KICK_MIN_SPAN = 0.9;

// ── BOOSTER LANES — the curved speed strip a ball RIDES (see LaneBand) ──
// Lanes go on CONCAVE sweeps, which is the geometric opposite of where rubber
// goes, and the reason both can exist without competing. A concave bowl is the
// INSIDE of a bend: the ball enters, follows the curve round and leaves along
// it — exactly the line a booster lane should reward. A convex sweep is an
// outside corner you glance off, which is what rubber is for. Concave sweeps
// previously wore nothing at all, so this dresses a face that was plain stone.
// REBALANCED after the playtest report: the boosters read as being on the
// OUTSIDE curves, because rubber (convex, 45% chance, cap 10) was far more
// common than lanes (concave, 55%, cap 6) and gold reads louder than blue. The
// geometry was right; the emphasis was backwards. Inside curves are now the
// PRIMARY boost surface — that is the racing line, and it is where a rail can
// be held.
/** Chance a qualifying concave sweep is dressed as a rail/lane. Near-certain:
 *  an undressed inside curve is a wasted corner. */
export const LANE_CHANCE = 0.92;
/** Fraction of the sweep's span the strip covers. Nearly the whole arc — a rail
 *  you can only hold across the middle third would fight the grace window. */
export const LANE_BAND_FRAC = 0.94;
/** Hard cap per floor. Raised well past rubber's 10: inside curves are the
 *  headline mechanic now, not a garnish. */
export const LANE_MAX_PER_FLOOR = 16;
/** Only sweeps with at least this much arc are worth a lane (rad). */
export const LANE_MIN_SPAN = 0.9;

// ── WHERE A RAIL PUTS YOU (see orientArcRails) ───────────────────────────────
/**
 * Where the ball's CENTRE sits while it rides a rail, in tiles.
 *
 * PLAYER_R exactly, and it is not an estimate: `resolveArcFeature` reports a
 * concave contact at `d = f.r − r_ball` and a convex one at `d = f.r + r_ball`,
 * so this IS the radius the collider used. The number is duplicated rather than
 * imported to keep this module's stated split intact — authoring knobs here,
 * feel numbers in constants.ts — and a test asserts the two agree.
 */
export const RAIL_RIDE_INSET = 0.3;
/**
 * Open tiles a rail's EXIT must have ahead of it.
 *
 * Deliberately larger than decorate's MIN_RUNWAY (3) and flow-loops' equivalent,
 * and the difference is measured rather than felt. Those two size a BOOSTER. A
 * rail hands you off at ARC_LANE_MIN_EXIT = 10 u/s as a FLOOR, and typically
 * well above it. At 10 u/s three tiles is 0.30 s of travel — the chevrons say
 * "this way" and 0.3 s later you are in the wall. Five tiles is 0.50 s, which is
 * past ARC_LANE_COOLDOWN (0.45 s): the rail has finished with you before the
 * runway has. That is the whole derivation — runway ≥ exit speed × cooldown.
 */
export const RAIL_MIN_RUNWAY = 5;
/** How far past the band's end the exit tile is sampled, in tiles. One tile
 *  clears the fillet's own block; the walk extends to two in case the rim is
 *  stair-stepped, then gives up rather than guess. */
const RAIL_EXIT_STEP = 1.0;
const RAIL_EXIT_MAX = 2.0;

/** A fresh, ready band covering `span` radians centred inside [a0, a0+total]. */
function centredBand(a0: number, total: number, frac: number): KickBand {
  const span = total * frac;
  return { a0: a0 + (total - span) / 2, span, cooldownT: 0, hitT: -1 };
}

/**
 * A fresh booster lane centred on the sweep, throwing in direction `cw`.
 *
 * The direction is picked per-sweep rather than derived from geometry: a
 * concave bowl is symmetric, so BOTH ways round are a legitimate racing line and
 * neither is more "correct". Fixing one per lane is what makes it a one-way
 * road — the thing that stops a lane from ever fighting a player's momentum,
 * since a ball running the other way simply isn't grabbed (see laneBandAt).
 */
function centredLane(a0: number, total: number, frac: number, cw: boolean): LaneBand {
  const span = total * frac;
  return { a0: a0 + (total - span) / 2, span, cw, cooldownT: 0, hitT: -1 };
}

/**
 * Tiles something else already owns: never converted by a sweep.
 *
 * Named for content (parts/items/spawns) because that is what it was for when
 * the sweeps ran inside `decorateMaze`. Now that they run in the geometry layer
 * the only thing it carries is the DOORWAY PLAN — openings decided before the
 * curves exist, which a fillet must build around rather than through.
 */
export type Occupied = (i: number, j: number) => boolean;

const HALF_PI = Math.PI / 2;

/** Quadrant start angle facing cut direction (cx,cz) — atan2 frame, z south. */
function quadrantA0(cx: number, cz: number): number {
  if (cx > 0 && cz < 0) return -HALF_PI; // NE
  if (cx > 0 && cz > 0) return 0; // SE
  if (cx < 0 && cz > 0) return HALF_PI; // SW
  return Math.PI; // NW
}

/** Distance from point C to the closest / farthest point of tile (ti,tj). */
function tileDistRange(cx: number, cz: number, ti: number, tj: number): { dmin: number; dmax: number } {
  const nx = Math.max(ti, Math.min(cx, ti + 1));
  const nz = Math.max(tj, Math.min(cz, tj + 1));
  const dmin = Math.hypot(cx - nx, cz - nz);
  let dmax = 0;
  for (const px of [ti, ti + 1]) {
    for (const pz of [tj, tj + 1]) {
      const d = Math.hypot(cx - px, cz - pz);
      if (d > dmax) dmax = d;
    }
  }
  return { dmin, dmax };
}

interface FilletPlan {
  feature: ArcFeature;
  /** Tiles the arc passes through → SHAPE_ARC (+ T_WALL for concave). */
  arcTiles: TilePos[];
  /** Tiles fully on the open side → carve to floor (convex only). */
  carveTiles: TilePos[];
  /** Tiles fully on the solid side that were floor → fill to wall (concave only). */
  fillTiles: TilePos[];
}

/**
 * Plan a fillet at corner lattice point P (px,pz) with cut/diag (cx,cz) and
 * radius R. `concave` flips which side of the block is floor. Returns null when
 * the site fails any structural requirement — every affected tile must be a
 * plain FULL, unclaimed, expected-type tile, the two wall faces must continue
 * flush past the block, and (concave) nothing placed may sit in the block.
 */
function planFillet(g: Grid, px: number, pz: number, cx: number, cz: number, R: number, concave: boolean, occupied: Occupied): FilletPlan | null {
  const x0 = cx > 0 ? px - R : px;
  const x1 = cx > 0 ? px - 1 : px + R - 1;
  const z0 = cz > 0 ? pz - R : pz;
  const z1 = cz > 0 ? pz - 1 : pz + R - 1;
  if (x0 <= 0 || z0 <= 0 || x1 >= g.w - 1 || z1 >= g.h - 1) return null;

  const C = { x: px - cx * R, z: pz - cz * R };
  const arcTiles: TilePos[] = [];
  const carveTiles: TilePos[] = [];
  const fillTiles: TilePos[] = [];

  for (let tj = z0; tj <= z1; tj++) {
    for (let ti = x0; ti <= x1; ti++) {
      const t = at(g, ti, tj);
      if (shapeAt(g, ti, tj) !== SHAPE_FULL) return null; // already claimed by a shape/sweep
      // CLAIMED BY SOMETHING ELSE — and this applies to BOTH kinds of fillet.
      // It used to be asked only on the concave branch, on the reasoning that a
      // convex fillet lives inside wall mass and so cannot land on anything.
      // That is true of CONTENT, which is what `occupied` originally meant, and
      // false of a plan: a convex sweep carves its shoulder open and marks a rim
      // right through a doorway that was planned before the curves existed. It
      // was the single largest reason doorways were later refused — 220 of 1788
      // planned openings, more than every other guard combined — and each one is
      // a threshold given up so a scavenged decorative curve could exist.
      if (occupied(ti, tj)) return null;
      const { dmin, dmax } = tileDistRange(C.x, C.z, ti, tj);
      const inside = dmax <= R + 1e-6; // fully within the circle
      const outside = dmin >= R - 1e-6; // fully beyond the circle
      if (concave) {
        // Block is room floor; solid grows OUTSIDE the circle (toward P).
        if (t !== T_FLOOR) return null;
        if (outside) fillTiles.push({ i: ti, j: tj });
        else if (!inside) arcTiles.push({ i: ti, j: tj });
        // fully inside → stays open floor
      } else {
        // Block is wall mass; the shoulder OUTSIDE the circle is carved open.
        if (t !== T_WALL) return null; // cracked/stairs/floor in the mass → not a clean corner
        if (outside) {
          // Never carve beside another sweep's slice — its backing must stay solid.
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (shapeAt(g, ti + di, tj + dj) === SHAPE_ARC) return null;
          carveTiles.push({ i: ti, j: tj });
        } else if (!inside) arcTiles.push({ i: ti, j: tj });
        // fully inside → stays FULL wall (the arc's solid backing)
      }
    }
  }
  if (arcTiles.length === 0) return null;

  // Both wall faces must run the block's full length and continue one tile past
  // the tangent point, so the arc ends flush on flat wall (no seam, no leak).
  // CONVEX: the faces are the block's own outer wall row/col (already validated
  // as wall above) — check the continuation tiles and require exposed floor
  // just outside both faces so the curve lands on a real visible corner.
  // CONCAVE: the faces are the wall row/col just OUTSIDE the room-floor block;
  // check their full run + continuation, and one extra ring of room floor past
  // the block so the bite never pinches a lane.
  const solidFace = (i: number, j: number): boolean => !isWalkable(g, i, j) && at(g, i, j) !== T_CRACKED && shapeAt(g, i, j) === SHAPE_FULL;
  const zFaceRow = cz > 0 ? z1 : z0; // block row along the z-side face
  const xFaceCol = cx > 0 ? x1 : x0; // block col along the x-side face
  const contX = cx > 0 ? x0 - 1 : x1 + 1; // continuation tile x past the tangent
  const contZ = cz > 0 ? z0 - 1 : z1 + 1; // continuation tile z past the tangent
  if (concave) {
    const wallRowZ = cz > 0 ? z1 + 1 : z0 - 1; // wall row beyond the room block
    const wallColX = cx > 0 ? x1 + 1 : x0 - 1;
    for (let ti = x0; ti <= x1; ti++) if (!solidFace(ti, wallRowZ)) return null;
    for (let tj = z0; tj <= z1; tj++) if (!solidFace(wallColX, tj)) return null;
    if (!solidFace(contX, wallRowZ) || !solidFace(wallColX, contZ)) return null;
    // Clearance ring: the room must continue past the block on both open sides.
    const openRowZ = cz > 0 ? z0 - 1 : z1 + 1;
    const openColX = cx > 0 ? x0 - 1 : x1 + 1;
    for (let ti = x0; ti <= x1; ti++) if (at(g, ti, openRowZ) !== T_FLOOR) return null;
    for (let tj = z0; tj <= z1; tj++) if (at(g, openColX, tj) !== T_FLOOR) return null;
  } else {
    if (!solidFace(contX, zFaceRow) || !solidFace(xFaceCol, contZ)) return null;
    // Exposed floor along both faces (else the sweep is buried in more wall).
    const floorRowZ = cz > 0 ? z1 + 1 : z0 - 1;
    const floorColX = cx > 0 ? x1 + 1 : x0 - 1;
    for (let ti = x0; ti <= x1; ti++) if (at(g, ti, floorRowZ) !== T_FLOOR) return null;
    for (let tj = z0; tj <= z1; tj++) if (at(g, floorColX, tj) !== T_FLOOR) return null;
  }

  const feature: ArcFeature = {
    cx: C.x,
    cz: C.z,
    r: R,
    a0: quadrantA0(cx, cz),
    span: HALF_PI,
    solidOut: concave || undefined,
    owner: "sweep",
  };

  // ── THE ARC CONTRACT (maze/arc-contract.ts) ─────────────────────────────
  //
  // The guards above stop this fillet OVERLAPPING another one. They say nothing
  // about it landing one tile away, and that is where the damage was: every
  // fillet is centred on its own corner, so two neighbouring fillets are on
  // different circles by construction and meet at whatever angle the grid
  // happened to produce. Censused over 40 floors, 76.6% of different-feature
  // adjacencies were a tangent kink steeper than 25° — median 47.7°. Two curves
  // crashing into each other, which is what "curves connected to each other
  // that make no sense" looks like from the camera.
  //
  // Rejecting costs nothing: the corner just stays square, which is legible.
  // Committing and dissolving later would already have carved or filled tiles.
  if (!junctionClear(g, arcTiles, feature)) return null;

  return { feature, arcTiles, carveTiles, fillTiles };
}

/** Commit a planned fillet: mutate tiles + register the feature. */
function commitFillet(g: Grid, plan: FilletPlan): void {
  ensureArcs(g);
  const fi = g.arcs!.length;
  g.arcs!.push(plan.feature);
  for (const t of plan.carveTiles) setTile(g, t.i, t.j, T_FLOOR);
  for (const t of plan.fillTiles) setTile(g, t.i, t.j, T_WALL);
  for (const t of plan.arcTiles) {
    setTile(g, t.i, t.j, T_WALL);
    setShape(g, t.i, t.j, SHAPE_ARC);
    g.arcIdx![idx(g, t.i, t.j)] = fi;
  }
}

/** Undo a committed CONCAVE fillet (floor restored; feature left orphaned —
 * harmless for collision, nothing points at it). Convex fillets never need
 * reverting.
 *
 * The bands ARE stripped, though: collision reaches a feature only through a
 * tile's arcIdx, but the RENDERERS walk `g.arcs` directly and would happily
 * build a strip of rubber or a lit lane hovering over the open floor this
 * revert just restored. Dropping them is cheaper and safer than teaching every
 * renderer to detect an orphan. */
function revertConcave(g: Grid, plan: FilletPlan): void {
  plan.feature.kicks = undefined;
  plan.feature.lanes = undefined;
  for (const t of plan.fillTiles) setTile(g, t.i, t.j, T_FLOOR);
  for (const t of plan.arcTiles) {
    setTile(g, t.i, t.j, T_FLOOR);
    setShape(g, t.i, t.j, SHAPE_FULL);
    g.arcIdx![idx(g, t.i, t.j)] = -1;
  }
}

/**
 * Author multi-tile arc fillets across the floor. Convex sweeps (carve-only)
 * commit immediately; concave sweeps commit then get ONE collective BFS strand
 * check — if any floor tile lost its path to `start`, every concave fillet is
 * reverted (rare; conservative). Returns the number of committed features.
 *
 * Qualifying sweeps are also DRESSED WITH KICKER RUBBER (see KickBand): a
 * centred band on a fraction of the sweeps, capped per floor. Only CONVEX
 * sweeps get rubber — those are the guides the ball rides along the outside of,
 * where a kick throws it back into the room; a concave bowl's rubber would fire
 * the ball into the pocket it is already trapped in.
 */
export function authorArcSweeps(g: Grid, start: TilePos, occupied: Occupied, rng: () => number): number {
  ensureArcs(g);
  let count = g.arcs!.length;
  let kickers = g.arcs!.reduce((n, f) => n + (f.kicks?.length ?? 0), 0);
  let lanes = g.arcs!.reduce((n, f) => n + (f.lanes?.length ?? 0), 0);
  const concavePlans: FilletPlan[] = [];

  for (let j = 1; j < g.h - 1 && count < MAX_SWEEPS_PER_FLOOR; j++) {
    for (let i = 1; i < g.w - 1 && count < MAX_SWEEPS_PER_FLOOR; i++) {
      const isWallTile = at(g, i, j) === T_WALL && shapeAt(g, i, j) === SHAPE_FULL;
      const isFloorTile = at(g, i, j) === T_FLOOR;
      if (!isWallTile && !isFloorTile) continue;
      const N = isWalkable(g, i, j - 1);
      const S = isWalkable(g, i, j + 1);
      const E = isWalkable(g, i + 1, j);
      const W = isWalkable(g, i - 1, j);

      // Cut/diag direction for the corner rooted at this tile, or 0 = none.
      let cx = 0;
      let cz = 0;
      let concave = false;
      if (isWallTile) {
        // Convex wall-mass corner: two adjacent open cardinals + open diagonal.
        if (N && E && isWalkable(g, i + 1, j - 1) && !S && !W) [cx, cz] = [1, -1];
        else if (N && W && isWalkable(g, i - 1, j - 1) && !S && !E) [cx, cz] = [-1, -1];
        else if (S && E && isWalkable(g, i + 1, j + 1) && !N && !W) [cx, cz] = [1, 1];
        else if (S && W && isWalkable(g, i - 1, j + 1) && !N && !E) [cx, cz] = [-1, 1];
      } else {
        // Concave crook: two adjacent WALL cardinals + solid diagonal, with the
        // far diagonal open (the ≥2×2-pocket gate — 1-wide turns stay square).
        concave = true;
        if (!N && !E && !isWalkable(g, i + 1, j - 1) && S && W && isWalkable(g, i - 1, j + 1)) [cx, cz] = [1, -1];
        else if (!N && !W && !isWalkable(g, i - 1, j - 1) && S && E && isWalkable(g, i + 1, j + 1)) [cx, cz] = [-1, -1];
        else if (!S && !E && !isWalkable(g, i + 1, j + 1) && N && W && isWalkable(g, i - 1, j - 1)) [cx, cz] = [1, 1];
        else if (!S && !W && !isWalkable(g, i - 1, j + 1) && N && E && isWalkable(g, i + 1, j - 1)) [cx, cz] = [-1, 1];
      }
      if (cx === 0) continue;

      const px = i + (cx > 0 ? 1 : 0);
      const pz = j + (cz > 0 ? 1 : 0);
      for (const R of FILLET_RADII) {
        const plan = planFillet(g, px, pz, cx, cz, R, concave, occupied);
        if (!plan) continue;
        // Rubber on the convex guides only, on a roll, under the floor cap.
        if (!concave && kickers < KICK_MAX_PER_FLOOR && plan.feature.span >= KICK_MIN_SPAN && rng() < KICK_CHANCE) {
          plan.feature.kicks = [centredBand(plan.feature.a0, plan.feature.span, KICK_BAND_FRAC)];
          kickers++;
        }
        // BOOSTER LANE on the concave bowls — the inside of a bend, which is the
        // line a speed strip should reward. Mutually exclusive with rubber by
        // construction (that branch is convex-only), so a face is never both.
        //
        // ⚠️ THE COIN FLIP IS NO LONGER THE DECISION — it is the TIE-BREAK.
        // `orientArcRails` runs at the end of the geometry layer and re-derives
        // `cw` from Φ and from whether the exit has anywhere to go, keeping this
        // roll only when both ways round score equal. It has to be that way
        // round: the old comment here argued a concave bowl is symmetric so
        // either direction is a legitimate racing line, which is true of the
        // BOWL and false of the floor beyond it — one exit opens onto the room
        // and the other onto whatever the maze put there. The roll stays because
        // on a genuinely symmetric pocket it is still the honest answer, and
        // because removing it would re-roll every floor's layout for nothing.
        if (concave && lanes < LANE_MAX_PER_FLOOR && plan.feature.span >= LANE_MIN_SPAN && rng() < LANE_CHANCE) {
          plan.feature.lanes = [centredLane(plan.feature.a0, plan.feature.span, LANE_BAND_FRAC, rng() < 0.5)];
          lanes++;
        }
        commitFillet(g, plan);
        if (concave) concavePlans.push(plan);
        count++;
        break;
      }
    }
  }

  // Collective strand guard for the wall-adding family.
  if (concavePlans.length > 0) {
    const d = bfsDistancesOwned(g, start.i, start.j); // held while scanning
    let stranded = false;
    for (let j = 0; j < g.h && !stranded; j++) {
      for (let i = 0; i < g.w; i++) {
        if (isWalkable(g, i, j) && d[idx(g, i, j)] < 0) {
          stranded = true;
          break;
        }
      }
    }
    if (stranded) {
      for (const p of concavePlans) revertConcave(g, p);
      count -= concavePlans.length;
    }
  }
  return count;
}

export function stampOrbitIsland(g: Grid, start: TilePos, occupied: Occupied, rng: () => number): { ci: number; cj: number } | null {
  ensureArcs(g);
  const R = ORBIT_RADIUS;
  const need = R + ORBIT_RING; // the whole disc that must be open floor
  const candidates: Array<{ ci: number; cj: number }> = [];
  const m = Math.ceil(need) + 1;
  for (let cj = m; cj < g.h - m; cj += 2) {
    for (let ci = m; ci < g.w - m; ci += 2) {
      let ok = true;
      for (let tj = Math.floor(cj - need); tj <= Math.ceil(cj + need) - 1 && ok; tj++) {
        for (let ti = Math.floor(ci - need); ti <= Math.ceil(ci + need) - 1; ti++) {
          const { dmin } = tileDistRange(ci, cj, ti, tj);
          if (dmin >= need) continue; // outside the required disc
          // The whole disc must be plain open floor; placed content only vetoes
          // where the island actually CONVERTS tiles (the ring lane can keep
          // its bumpers — a part in the orbit is good pinball).
          const converts = dmin < R + 0.8;
          if (at(g, ti, tj) !== T_FLOOR || shapeAt(g, ti, tj) !== SHAPE_FULL || (converts && occupied(ti, tj))) {
            ok = false;
            break;
          }
        }
      }
      if (ok) candidates.push({ ci, cj });
    }
  }
  if (candidates.length === 0) return null;
  const site = candidates[Math.floor(rng() * candidates.length)];

  const fi = g.arcs!.length;
  const changed: Array<{ i: number; j: number; arc: boolean }> = [];
  for (let tj = Math.floor(site.cj - R) - 1; tj <= Math.ceil(site.cj + R); tj++) {
    for (let ti = Math.floor(site.ci - R) - 1; ti <= Math.ceil(site.ci + R); ti++) {
      const { dmin, dmax } = tileDistRange(site.ci, site.cj, ti, tj);
      if (dmin >= R - 1e-6) continue; // clear of the island
      const arc = dmax > R + 1e-6; // straddles the rim
      setTile(g, ti, tj, T_WALL);
      if (arc) {
        setShape(g, ti, tj, SHAPE_ARC);
        g.arcIdx![idx(g, ti, tj)] = fi;
      }
      changed.push({ i: ti, j: tj, arc });
    }
  }
  if (changed.length === 0) return null;
  // The island always wears rubber: KICK_ISLAND_BANDS strung evenly around it,
  // so a lap of the orbit is a chain of kicks rather than a free coast. Phase is
  // rolled so two floors' islands don't read identically.
  const phase = rng() * Math.PI * 2;
  const kicks: KickBand[] = [];
  for (let k = 0; k < KICK_ISLAND_BANDS; k++) {
    kicks.push({ a0: phase + (k * Math.PI * 2) / KICK_ISLAND_BANDS, span: KICK_ISLAND_SPAN, cooldownT: 0, hitT: -1 });
  }
  g.arcs!.push({ cx: site.ci, cz: site.cj, r: R, a0: 0, span: Math.PI * 2, kicks, owner: "island" });

  // Strand guard: the open ring should keep everything connected, but verify.
  const d = bfsDistancesOwned(g, start.i, start.j); // held while scanning
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (isWalkable(g, i, j) && d[idx(g, i, j)] < 0) {
        for (const c of changed) {
          setTile(g, c.i, c.j, T_FLOOR);
          if (c.arc) {
            setShape(g, c.i, c.j, SHAPE_FULL);
            g.arcIdx![idx(g, c.i, c.j)] = -1;
          }
        }
        g.arcs!.pop();
        return null;
      }
    }
  }
  return site;
}

// ── RAILS COME UNDER THE Φ CONTRACT ──────────────────────────────────────────
//
// Live QA of floor 5, with a screenshot: chevroned rails firing into walls.
// Two independent causes, either one sufficient.
//
//  1. THE DIRECTION WAS A COIN FLIP. `authorArcSweeps` above rolled `rng() < 0.5`
//     for `cw`. The argument in centredLane's comment — a concave bowl is
//     symmetric, so both ways round are a legitimate racing line — is true of the
//     BOWL and false of the FLOOR BEYOND IT: one exit opens onto the room, the
//     other onto whatever the maze happened to put there.
//
//  2. NOTHING EVER LOOKED PAST THE EXIT. `planFillet`'s clearance ring proves
//     exactly ONE open tile past the block. A rail hands you off at
//     ARC_LANE_MIN_EXIT (10 u/s) as a floor.
//
// And the reason neither was caught: a rail is a `LaneBand` on an `ArcFeature`,
// not a `PinballPartSpot`. The entire Φ apparatus — flow-orient, flow-loops,
// breakLaunchDuels, openLaunchTargets — iterates parts. It has never seen a rail.
// So the one-way-road family that the floor's fastest surface belongs to was the
// only launch family with no orientation contract at all.

/**
 * Where a rail SPITS YOU OUT, and which way — or null when it spits you at rock.
 *
 * Two answers, both needed. The exact tangent is what the ball actually leaves
 * along (and what `laneTangent` hands the physics); the CARDINAL it snaps to is
 * what the Φ predicates take, because they are 4-connected on purpose — see
 * flow-orient's header: the parts fire on cardinals, so a diagonal-aware field
 * would report gradients no pad can follow.
 *
 * ⚠️ THE SNAP IS SAFE FOR A CHECKABLE REASON, not a hopeful one. A band covers
 * `LANE_BAND_FRAC` of its feature centred inside it, so it ends
 * `(1 − LANE_BAND_FRAC)/2 · span` short of the span boundary — at the shipped
 * 0.94 over a quadrant that is 2.7°, and a quadrant boundary is exactly where a
 * fillet's tangent IS cardinal. The error bound is pinned by a test so that
 * widening the band cannot silently invalidate the Φ tests downstream.
 */
export function railExit(
  g: Grid,
  f: ArcFeature,
  l: LaneBand,
  cw: boolean,
): { i: number; j: number; di: number; dj: number; tx: number; tz: number } | null {
  // The end you leave by: the far end going clockwise, the near end otherwise.
  const aE = cw ? l.a0 + l.span : l.a0;
  const s = cw ? 1 : -1;
  const tx = -Math.sin(aE) * s;
  const tz = Math.cos(aE) * s;
  // The ride radius the COLLIDER uses, not the nominal one — a concave bowl is
  // ridden inside its circle and a convex guide outside it.
  const rr = f.solidOut ? f.r - RAIL_RIDE_INSET : f.r + RAIL_RIDE_INSET;
  const ex = f.cx + Math.cos(aE) * rr;
  const ez = f.cz + Math.sin(aE) * rr;
  // Step along the tangent until we are off the feature's own block and on a
  // tile that exists. Two tiles, then give up: a rim we cannot walk off in two
  // is a rim whose exit we should not be guessing at.
  for (let d = RAIL_EXIT_STEP; d <= RAIL_EXIT_MAX + 1e-9; d += RAIL_EXIT_STEP) {
    const i = Math.floor(ex + tx * d);
    const j = Math.floor(ez + tz * d);
    if (i < 0 || j < 0 || i >= g.w || j >= g.h) return null;
    if (!isWalkable(g, i, j)) continue;
    const [di, dj] = Math.abs(tx) >= Math.abs(tz) ? [Math.sign(tx), 0] : [0, Math.sign(tz)];
    if (di === 0 && dj === 0) return null; // degenerate tangent
    return { i, j, di, dj, tx, tz };
  }
  return null;
}

/** How good is this direction round the bowl? −1 = disqualified. */
function scoreRail(g: Grid, phi: Int32Array, f: ArcFeature, l: LaneBand, cw: boolean): number {
  const x = railExit(g, f, l, cw);
  if (!x) return -1;
  // THE SCREENSHOT'S DEFECT: somewhere to go.
  if (openRunway(g, x.i, x.j, x.di, x.dj, RAIL_MIN_RUNWAY) < RAIL_MIN_RUNWAY) return -1;
  // THE Φ CONTRACT, extended to the family that was never in it.
  if (!isDownhill(g, phi, x.i, x.j, x.di, x.dj)) return -1;
  // Rank by how much floor the hand-off actually covers, plus the drop across
  // the bowl itself. The exit ray is weighted 4× deliberately: a rail whose two
  // ends sit on the same Φ contour but which DELIVERS you six tiles down the
  // floor is still a good rail; the reverse is not.
  const entry = railExit(g, f, l, !cw);
  const entryDrop = entry ? phiAt(g, phi, entry.i, entry.j) - phiAt(g, phi, x.i, x.j) : 0;
  return flowDrop(g, phi, x.i, x.j, x.di, x.dj, RAIL_MIN_RUNWAY) * 4 + Math.max(0, entryDrop);
}

/**
 * Bring every rail on the floor under the Φ contract: derive `cw` from the flow
 * field, prove the exit has runway, and DROP the band when neither way round
 * qualifies.
 *
 * ── Why a pass, and not a parameter to the authors ────────────────────────
 *
 * Two different functions put LaneBands on this grid — `authorArcSweeps` here on
 * the concave fillets, and `authorArteryBanks` on the racing line — and only one
 * of them ever had an opinion about direction (`arcForBend` returns
 * `cw = turn > 0`, which is right, and survives as the tie-break below). Handing
 * `phi` to each author separately would give the floor two owners of one
 * decision, which is exactly what moving the curve families into the geometry
 * layer was paid for to remove (track-floor.ts). One pass, over `g.arcs`.
 *
 * ── Why at the END of the geometry layer ──────────────────────────────────
 *
 * A rail's exit runway is a property of the FINISHED floor. Between the sweeps
 * and here, `authorArteryBanks` converts floor→wall, `carveDoorways` converts
 * wall→floor, `removeWallStubs` opens more, and `compactArcs` rewrites the
 * band's own a0/span. Judging a runway any earlier measures a grid that does not
 * ship — which is the same staleness that forced decorate's runway re-aim into
 * existence (see its comment there).
 *
 * ── What it does NOT do ───────────────────────────────────────────────────
 *
 * It never writes a tile, a shape or an arcIdx, and it never draws from rng.
 * Only `feature.lanes`. That is what makes it safe to insert mid-pipeline: a
 * floor generated before and after is byte-identical in geometry and in rng
 * consumption, so no pinned layout test re-rolls. A test asserts it.
 */
export function orientArcRails(g: Grid, phi: Int32Array): { kept: number; flipped: number; dropped: number } {
  let kept = 0;
  let flipped = 0;
  let dropped = 0;
  for (const f of g.arcs ?? []) {
    if (!f.lanes || f.lanes.length === 0) continue;
    // A FUNNEL LANE IS NOT A RAIL AND Φ HAS NO OPINION ON IT.
    //
    // Every other lane is oriented by the floor's flow toward the stairs, which
    // is right for a bank on the racing line. A funnel lane's direction is
    // decided by the doorway it feeds — it carries the ball THROUGH the
    // opening — and that is a local fact about two rooms, not about where the
    // exit is. Worse, a doorway is funnelled from BOTH sides, so one of the two
    // always opposes Φ and would be flipped into carrying balls away from the
    // door it was built to serve, or dropped outright.
    if (f.owner === "funnel") continue;
    const keep: LaneBand[] = [];
    for (const l of f.lanes) {
      const asAuthored = scoreRail(g, phi, f, l, l.cw);
      const reversed = scoreRail(g, phi, f, l, !l.cw);
      if (asAuthored < 0 && reversed < 0) {
        dropped++;
        continue;
      }
      // TIE KEEPS THE AUTHORED DIRECTION. That is not indifference: it preserves
      // `arcForBend`'s turn-following answer on every artery bank (the author
      // that was already correct), and on a genuinely symmetric bowl it leaves
      // the rolled coin meaningful instead of replacing variety with a rule.
      if (reversed > asAuthored) {
        l.cw = !l.cw;
        flipped++;
      } else {
        kept++;
      }
      keep.push(l);
    }
    if (keep.length === 0) f.lanes = undefined;
    else f.lanes = keep;
  }
  return { kept, flipped, dropped };
}
