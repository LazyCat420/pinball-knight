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
import { SHAPE_FULL, SHAPE_ARC, type ArcFeature, type KickBand, type LaneBand } from "./tile-shape";
import { bfsDistances, bfsDistancesOwned } from "../entities/ai";

/** Fillet radii tried largest-first at every qualifying corner. */
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
/** Chance a qualifying fillet sweep is dressed with rubber. */
export const KICK_CHANCE = 0.45;
/** Fraction of a fillet's span the band covers, centred on the arc. */
export const KICK_BAND_FRAC = 0.62;
/** Bands strung evenly around an orbit island, and each one's width (rad). */
export const KICK_ISLAND_BANDS = 3;
export const KICK_ISLAND_SPAN = 0.62;
/** Hard cap per floor — a machine, not a trampoline. */
export const KICK_MAX_PER_FLOOR = 10;
/** Only sweeps with at least this much arc are worth a band (rad). */
export const KICK_MIN_SPAN = 0.9;

// ── BOOSTER LANES — the curved speed strip a ball RIDES (see LaneBand) ──
// Lanes go on CONCAVE sweeps, which is the geometric opposite of where rubber
// goes, and the reason both can exist without competing. A concave bowl is the
// INSIDE of a bend: the ball enters, follows the curve round and leaves along
// it — exactly the line a booster lane should reward. A convex sweep is an
// outside corner you glance off, which is what rubber is for. Concave sweeps
// previously wore nothing at all, so this dresses a face that was plain stone.
/** Chance a qualifying concave sweep is authored as a booster lane. */
export const LANE_CHANCE = 0.55;
/** Fraction of the sweep's span the strip covers, centred on the arc. */
export const LANE_BAND_FRAC = 0.78;
/** Hard cap per floor — a corner to take fast, not a conveyor belt. */
export const LANE_MAX_PER_FLOOR = 6;
/** Only sweeps with at least this much arc are worth a lane (rad). */
export const LANE_MIN_SPAN = 0.9;

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

/** Tiles that carry placed content (parts/items/spawns/…): never converted. */
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
      const { dmin, dmax } = tileDistRange(C.x, C.z, ti, tj);
      const inside = dmax <= R + 1e-6; // fully within the circle
      const outside = dmin >= R - 1e-6; // fully beyond the circle
      if (concave) {
        // Block is room floor; solid grows OUTSIDE the circle (toward P).
        if (t !== T_FLOOR || occupied(ti, tj)) return null;
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

  return {
    feature: { cx: C.x, cz: C.z, r: R, a0: quadrantA0(cx, cz), span: HALF_PI, solidOut: concave || undefined },
    arcTiles,
    carveTiles,
    fillTiles,
  };
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
        // Direction is a coin flip: both ways round a symmetric bowl are a real
        // racing line, and fixing one is what makes the lane one-way.
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

/**
 * Stamp ONE round orbit island into a wide-open floor disc: a full-circle
 * convex ArcFeature the ball can ride around, with a clear ring lane.
 * Wall-adding → BFS strand guard with full revert. Returns the island centre
 * (grid lattice coords) or null if no site qualified.
 */
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
  g.arcs!.push({ cx: site.ci, cz: site.cj, r: R, a0: 0, span: Math.PI * 2, kicks });

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
