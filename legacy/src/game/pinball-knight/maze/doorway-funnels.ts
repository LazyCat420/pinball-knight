/**
 * DOORWAY FUNNELS — flare a threshold so a ball banks THROUGH it, not off it.
 *
 * ⚠️ OFF BY DEFAULT. IT DOES NOT WORK YET. Read this before switching it on.
 *
 * Paired against the same doorways on the same seeds with the flare removed
 * (`buildTrackFloor({ funnels })`, and the pairing is the point — see below):
 *
 *      capture   52.4% → 52.3%   −0.1pp
 *      rejected  28.7% → 31.5%   +2.8pp
 *      per doorway: 5 better, 6 worse, 14 unchanged
 *
 * The pass is CORRECT — it strands nothing, produces no incoherent junctions
 * and no unbacked ribbons, and the focusing geometry behind it is proven in
 * `conic-fit.test.ts`. It simply does not pay for itself, so it does not ship
 * on. What is missing is size, not soundness: a treated doorway ends up with
 * only ~6.5 funnel-faced tiles across both approaches and both sides, piled up
 * at the threshold where the parabola runs nearly parallel to the passage and
 * therefore deflects almost nothing. The ball meets ordinary square wall for
 * the whole approach and grazes the curve at the last moment.
 *
 * The fix is a LONGER, WIDER flare, which means breaking the `f = w/4` tie that
 * pins the arms to the jambs — a design change owed its own measurement, not a
 * constant to nudge.
 *
 * ── Two things measurement caught that reasoning did not ─────────────────
 *
 * Recorded because both are the kind of mistake that ships silently:
 *
 *  · THE AGGREGATE LIES. Funnels land on a handful of doorways; the other ~150
 *    in the census are untouched, so the overall capture rate dilutes the
 *    effect ~10x. And the obvious split — funnelled doorways vs plain ones — is
 *    WORSE than useless here, because the pass deliberately picks the NARROWEST
 *    doorways and those already capture worst, so selection alone makes the
 *    treatment look harmful. Only the paired counterfactual (same doorway, same
 *    seed, flare on vs off) answers the question.
 *  · HALF A FUNNEL IS WORSE THAN NONE. Committing arms independently scored
 *    −2.3pp capture and +3.7pp rejection, 22 doorways worse against 8 better. A
 *    lone arm is not a funnel, it is a diagonal deflector beside an opening. It
 *    is now both arms or neither, which is what took the harm back to zero.
 *
 * ── The measurement this answers ──────────────────────────────────────────
 *
 * `maze/doorways.ts` made openings uniform and killed the 1-tile squeeze, but a
 * doorway is still a rectangular hole in a flat wall: nothing about its shape
 * helps you through it. `scripts/funnel-census.mjs` put a number on that, over
 * 24 real floors and 80,703 approaches:
 *
 *      CAPTURED  54.0%     REJECTED (sent back the way it came)  27.9%
 *      3 wide  45.1%   ·   5 wide  60.8%   ·   7 wide  63.5%
 *
 * Better than a coin flip, much worse than fine, and it is the NARROW doorways
 * that lose — which is exactly the complaint.
 *
 * ── The shape ────────────────────────────────────────────────────────────
 *
 * A PARABOLA with its focus on the middle of the mouth, opening back up the
 * corridor. Every ray parallel to the axis reflects through the focus, and a
 * corridor is a device for delivering parallel rays. Tying the focal length to
 * the opening — f = w/4 — puts the arms exactly on the jambs at the threshold,
 * so the funnel gathers from far wider than the door WITHOUT widening the door:
 * the vocabulary `doorways.ts` authored survives intact, which is the whole
 * reason that vocabulary exists.
 *
 * `maze/conic-fit.ts` turns that parabola into a chain of circular arcs, so
 * nothing here needs a new collider, mesh or rail path.
 *
 * ── WHY THIS PASS BOTH CARVES AND FILLS ──────────────────────────────────
 *
 * The first version was CARVE-ONLY — wall → floor and nothing else — because
 * that is safe by construction: it cannot strand a tile, so it needs no strand
 * guard and no revert, the same short argument convex fillets and prefab stamps
 * rest on.
 *
 * It built ZERO funnels on 24 real floors, and the tally said why: 401 refusals
 * of 624 were `claimed`, meaning the tile the curve wanted was already FLOOR.
 * The geometry says the same thing once you look at it. A doorway is a
 * NARROWING — that is what makes it a doorway — so the corridor on either side
 * is usually wider than the opening. The jaw starts on the jamb (stone) and
 * flares outward faster than the corridor does, so it crosses from open floor
 * into stone partway back. The stretch in stone wants carving; the stretch in
 * open floor wants FILLING, and a pass that can only carve can only ever build
 * the half of a funnel that is furthest from the door.
 *
 * So it fills too, and pays for it with the machinery `arc-sweeps.ts` already
 * uses for concave fillets: every funnel on the floor is committed, ONE
 * collective BFS reachability check is run from the start tile, and if any
 * floor tile lost its path the whole batch is reverted. Conservative, and cheap
 * because it is one BFS per floor rather than one per jaw.
 *
 * Note what the fill does NOT do: it never narrows the opening itself. The arms
 * meet the jambs exactly at the threshold, so the vocabulary `doorways.ts`
 * authored survives — the fill tapers the corridor INTO the door, which is the
 * funnel, rather than shrinking the door.
 *
 * A jaw is still declined when there is no stone to back its face: a funnel
 * with open floor behind it is a curved ribbon standing in mid-air
 * (`arc-contract.ts` records that defect and what it cost to find), and one
 * that breaks sideways into the corridor behind is `doorways.ts`'s
 * `jambsSurvive` failure wearing a different hat. Declining costs nothing: the
 * threshold stays square, which is legible.
 *
 * ── Ordering ─────────────────────────────────────────────────────────────
 *
 * Runs AFTER `carveDoorways`, because the funnel must fit the opening that was
 * actually carved — `resolveDoorway` steps 7 down to 5 down to 3 when the wide
 * one will not fit, and a funnel built for the size that was ASKED for would
 * miss the jambs of the size that was BUILT. Runs BEFORE the rail pass so the
 * jaws are eligible for booster lanes like any other curve.
 *
 * DOM- and three-free. Pure.
 */
import {
  type Grid,
  type TilePos,
  T_WALL,
  T_FLOOR,
  T_CRACKED,
  at,
  setTile,
  setShape,
  shapeAt,
  isWalkable,
  idx,
  ensureArcs,
} from "./generator";
import { SHAPE_FULL, SHAPE_ARC, type ArcFeature } from "../engine/tile-shape";
import { junctionClear } from "./arc-contract";
import { bfsDistancesOwned } from "../engine/flow-field";
import { parabolicJaws, type Pt } from "./conic-fit";
import type { Doorway } from "./doorways";

/**
 * Feature budget for this pass, on TOP of `MAX_SWEEPS_PER_FLOOR`.
 *
 * Deliberately additive rather than carved out of the sweep budget. Censused
 * over 24 floors, a floor already carries a median of 71 arc features and as
 * many as 93 against a cap of 96 — so taking the room from the sweeps would
 * silently delete up to thirty authored curves per floor and REROLL what the
 * busiest floors look like, to pay for a feature that is supposed to be added
 * to them. `arcIdx` is an Int16Array, so the ceiling was never the constraint;
 * 96 was a budget choice, and this is a second one next to it.
 */
export const FUNNEL_MAX_FEATURES = 32;

/** Doorways funnelled per floor, narrowest first. */
export const FUNNEL_MAX_DOORWAYS = 4;

/**
 * How far back up the corridor to reach for the flare, in tiles.
 *
 * The arcs will not reach this far and are not meant to: past ~4 tiles a
 * parabola's radius of curvature exceeds `MAX_ARC_RADIUS` and `parabolicJaws`
 * drops those segments as the straight taper they are. This is the ASK; the
 * chain reports `curvedDepth` for what it delivered.
 */
export const FUNNEL_DEPTH = 4;

/** Arc links per jaw. Two is enough for a quarter-turn's worth of bend. */
export const FUNNEL_SEGMENTS = 2;

/**
 * Tiles of stone that must remain behind a jaw's face.
 *
 * One is not enough and the reason is `removeWallStubs`: a face backed by a
 * single tile leaves a one-tile partition, which the de-stub pass is entitled
 * to eat, and then the funnel opens into whatever was on the other side. This
 * is the same quantity `doorways.ts` protects with `jambsSurvive`.
 */
export const FUNNEL_BACKING = 2;

/** "Is something already here?" — same contract as `arc-sweeps.ts`. */
export type Occupied = (i: number, j: number) => boolean;

/**
 * Most floor tiles one jaw may convert to wall.
 *
 * A funnel that has to build this much stone is not flaring a threshold, it is
 * carving a room around it — and the wider the fill the more likely the strand
 * guard is to revert the whole floor's batch for one greedy jaw. Refusing early
 * keeps the good jaws.
 */
export const FUNNEL_MAX_FILL = 16;

interface JawPlan {
  features: ArcFeature[];
  /** Tiles the curve straddles → WALL + SHAPE_ARC, one entry per feature. */
  arcTiles: TilePos[][];
  /** Wall tiles on the OPEN side of the curve → carved to floor (the flare). */
  carveTiles: TilePos[];
  /** Floor tiles on the SOLID side → filled to wall (the funnel's own stone). */
  fillTiles: TilePos[];
  /**
   * Every tile this jaw will mutate, with the tile id and shape it had BEFORE.
   *
   * The revert replays this verbatim instead of computing an inverse, and that
   * is not fussiness — the hand-derived inverse was wrong. It restored the
   * fills and the shapes but deliberately left the carve alone ("carving only
   * ever opens stone, so it cannot strand"), which is true in isolation and
   * false in a batch: jaws share a grid, so one jaw's carve becomes the state a
   * later jaw plans against, and undoing them out of order leaves tiles neither
   * jaw would have produced. Measured, the reverting floors still shipped
   * stranded tiles. An exact snapshot cannot have that class of bug: the grid
   * it restores is the grid that was there, which was connected.
   */
  before: Array<{ k: number; t: number; shape: number }>;
}

/** Nearest and farthest distance from a point to a tile's square. */
function tileDistRange(cx: number, cz: number, ti: number, tj: number): { dmin: number; dmax: number } {
  const nx = Math.max(ti, Math.min(cx, ti + 1));
  const nz = Math.max(tj, Math.min(cz, tj + 1));
  let dmax = 0;
  for (const px of [ti, ti + 1]) {
    for (const pz of [tj, tj + 1]) {
      const d = Math.hypot(cx - px, cz - pz);
      if (d > dmax) dmax = d;
    }
  }
  return { dmin: Math.hypot(cx - nx, cz - nz), dmax };
}

const TAU = Math.PI * 2;

/**
 * Is this tile within the feature's DRAWN span?
 *
 * Only the span is real geometry — the rest of the circle is an artefact of
 * describing an arc by its centre. A tile outside it is owned by the square
 * walls, and claiming it would put curved collision where nothing curved is
 * drawn. The margin is half a tile of arc, so a tile the face merely clips at
 * the very end still counts.
 */
function withinSpan(f: ArcFeature, ti: number, tj: number): boolean {
  const ang = Math.atan2(tj + 0.5 - f.cz, ti + 0.5 - f.cx);
  const margin = 0.5 / Math.max(f.r, 1);
  let rel = (ang - (f.a0 - margin)) % TAU;
  if (rel < 0) rel += TAU;
  return rel <= f.span + 2 * margin;
}

/** A tile that may be carved or claimed: inside the shell, plain stone, free. */
function claimable(g: Grid, ti: number, tj: number, occupied: Occupied): boolean {
  if (ti <= 0 || tj <= 0 || ti >= g.w - 1 || tj >= g.h - 1) return false; // never the shell
  if (at(g, ti, tj) !== T_WALL) return false; // floor, stairs, or a CRACKED secret
  if (shapeAt(g, ti, tj) !== SHAPE_FULL) return false; // already someone's curve
  return !occupied(ti, tj);
}

/**
 * A tile that may be turned into the funnel's own wall.
 *
 * Stricter than `claimable` in the one way that matters: only PLAIN floor
 * qualifies. Stairs, a cracked secret and the shell are all somebody else's
 * invariant, and closing one is not a funnel, it is a bug with a curve on it.
 */
function fillable(g: Grid, ti: number, tj: number, occupied: Occupied): boolean {
  if (ti <= 0 || tj <= 0 || ti >= g.w - 1 || tj >= g.h - 1) return false;
  if (at(g, ti, tj) !== T_FLOOR) return false;
  if (shapeAt(g, ti, tj) !== SHAPE_FULL) return false;
  return !occupied(ti, tj);
}

/**
 * Why a jaw was refused. Counted and returned, not swallowed.
 *
 * `doorways.ts` learned this the expensive way: a pass that silently declines
 * is indistinguishable from a pass that never ran, and the first version of
 * THIS module shipped a green test suite and built zero funnels on 24 real
 * floors. A tally is what turns "it doesn't fire" into "it doesn't fire
 * BECAUSE".
 */
export type JawReject = "empty" | "claimed" | "unfillable" | "too-much-fill" | "no-backing" | "no-tiles";

/**
 * Plan one jaw: the tiles the chain claims, the stone the flare opens, and the
 * floor the funnel's own wall stands on.
 *
 * Returns a reason the moment anything cannot be built, rather than committing
 * a partial jaw. Half a funnel with a hole in it deflects a ball into the hole.
 */
function planJaw(g: Grid, chain: readonly ArcFeature[], occupied: Occupied): JawPlan | JawReject {
  if (chain.length === 0) return "empty";
  const arcTiles: TilePos[][] = [];
  const carveTiles: TilePos[] = [];
  const fillTiles: TilePos[] = [];
  const seen = new Set<number>();

  for (const f of chain) {
    const mine: TilePos[] = [];
    const i0 = Math.floor(f.cx - f.r - 1);
    const i1 = Math.ceil(f.cx + f.r + 1);
    const j0 = Math.floor(f.cz - f.r - 1);
    const j1 = Math.ceil(f.cz + f.r + 1);
    for (let tj = j0; tj <= j1; tj++) {
      for (let ti = i0; ti <= i1; ti++) {
        if (!withinSpan(f, ti, tj)) continue;
        const { dmin, dmax } = tileDistRange(f.cx, f.cz, ti, tj);
        // Solid is OUTSIDE for these (concave bowls): free space is d < r.
        const straddles = dmin < f.r - 1e-6 && dmax > f.r + 1e-6;
        const inside = dmax <= f.r + 1e-6;
        const outside = dmin >= f.r - 1e-6;

        const k = idx(g, ti, tj);

        if (straddles) {
          // THE FACE. Wall already there is claimed as-is; open floor becomes
          // the funnel's own stone. This is the case the carve-only version
          // could not express, and it is the common one — a doorway is a
          // narrowing, so the corridor beside it is usually wider than the arm.
          if (!claimable(g, ti, tj, occupied) && !fillable(g, ti, tj, occupied)) return "claimed";
          if (seen.has(k)) continue; // a neighbouring link already claimed it
          seen.add(k);
          if (isWalkable(g, ti, tj)) fillTiles.push({ i: ti, j: tj });
          mine.push({ i: ti, j: tj });
        } else if (inside) {
          // The flare: stone on the ball's side of the curve comes out. Tiles
          // that are ALREADY open need nothing — this is where the funnel meets
          // the corridor it belongs to.
          if (isWalkable(g, ti, tj)) continue;
          if (!claimable(g, ti, tj, occupied)) return "claimed";
          if (seen.has(k)) continue;
          seen.add(k);
          carveTiles.push({ i: ti, j: tj });
        } else if (outside && dmin < f.r + FUNNEL_BACKING) {
          // BACKING. A face needs stone behind it or it is a curved ribbon
          // standing in mid-air. Open floor here is filled — that is the
          // funnel's wall — but only if it is fillable; a doorway, a secret or
          // the shell is not ours to close, and then the jaw is refused rather
          // than built unbacked.
          if (!isWalkable(g, ti, tj)) continue;
          if (at(g, ti, tj) === T_CRACKED) return "no-backing"; // a secret route is not backing
          if (!fillable(g, ti, tj, occupied)) return "no-backing";
          if (seen.has(k)) continue;
          seen.add(k);
          fillTiles.push({ i: ti, j: tj });
        }
      }
    }
    if (mine.length === 0) return "no-tiles"; // a link nothing references is not a wall
    arcTiles.push(mine);
  }
  if (fillTiles.length > FUNNEL_MAX_FILL) return "too-much-fill";
  return { features: [...chain], arcTiles, carveTiles, fillTiles, before: [] };
}

/** Commit a planned jaw: open the flare, raise the wall, register the faces. */
function commitJaw(g: Grid, plan: JawPlan): number {
  ensureArcs(g);
  // Snapshot first, and snapshot EVERYTHING this jaw is about to touch.
  const note = (t: TilePos): void => {
    const k = idx(g, t.i, t.j);
    if (plan.before.some((b) => b.k === k)) return;
    plan.before.push({ k, t: at(g, t.i, t.j), shape: shapeAt(g, t.i, t.j) });
  };
  for (const t of plan.carveTiles) note(t);
  for (const t of plan.fillTiles) note(t);
  for (const list of plan.arcTiles) for (const t of list) note(t);

  for (const t of plan.carveTiles) setTile(g, t.i, t.j, T_FLOOR);
  for (const t of plan.fillTiles) setTile(g, t.i, t.j, T_WALL);
  plan.features.forEach((f, k) => {
    const fi = g.arcs!.length;
    g.arcs!.push(f);
    for (const t of plan.arcTiles[k]) {
      setTile(g, t.i, t.j, T_WALL);
      setShape(g, t.i, t.j, SHAPE_ARC);
      g.arcIdx![idx(g, t.i, t.j)] = fi;
    }
  });
  return plan.features.length;
}

/**
 * Undo a committed jaw by replaying its snapshot.
 *
 * The features are left in `g.arcs` but ORPHANED — no tile's `arcIdx` points at
 * one, so collision can never reach it, and `compactArcs` drops it on its next
 * pass for owning no tiles. Their bands are stripped for the reason
 * `arc-sweeps.ts revertConcave` records: collision reaches a feature through a
 * tile, but the RENDERERS walk `g.arcs` directly and would happily light a
 * booster lane hanging over the floor this revert just restored.
 */
function revertJaw(g: Grid, plan: JawPlan): void {
  for (const f of plan.features) {
    f.kicks = undefined;
    f.lanes = undefined;
  }
  for (const b of plan.before) {
    const i = b.k % g.w;
    const j = (b.k - i) / g.w;
    setTile(g, i, j, b.t);
    setShape(g, i, j, b.shape);
    g.arcIdx![b.k] = -1;
  }
}

export interface FunnelReport {
  /** Doorways with at least one jaw built. */
  doorways: number;
  /** Jaws built (up to 4 per doorway: two sides, two arms). */
  jaws: number;
  /** Arc features added. */
  features: number;
  /** Wall tiles opened into the flare. */
  carved: number;
  /** Floor tiles raised into the funnel's own wall. */
  filled: number;
  /** Features undone by the strand guard. Non-zero means a floor lost its funnels. */
  reverted: number;
  /** Why the refused jaws were refused — see `JawReject`. */
  rejects: Record<string, number>;
}

/**
 * Flare the floor's narrowest doorways into parabolic funnels.
 *
 * Doorways are taken NARROWEST FIRST — that is where the census says the
 * capture rate collapses, and a 7-wide opening is already most of a funnel. Ties
 * break on position so the pass is deterministic without drawing from `rng`;
 * this runs inside `buildTrackFloor`'s single seeded stream, and taking a draw
 * here would reroll every floor downstream of it.
 */
export function authorDoorwayFunnels(
  g: Grid,
  doorways: readonly Doorway[],
  start: TilePos,
  occupied: Occupied = () => false,
): FunnelReport {
  const report: FunnelReport = { doorways: 0, jaws: 0, features: 0, carved: 0, filled: 0, reverted: 0, rejects: {} };
  if (!doorways.length) return report;
  ensureArcs(g);
  const committed: JawPlan[] = [];

  const order = [...doorways].sort((a, b) => a.w - b.w || a.i - b.i || a.j - b.j);
  let built = 0;

  for (const d of order) {
    if (report.doorways >= FUNNEL_MAX_DOORWAYS) break;
    if (built >= FUNNEL_MAX_FEATURES) break;
    // Arc geometry lives in GRID coords, where tile (i,j) spans [i,i+1]; the
    // mouth's middle is therefore the tile CENTRE, not its corner.
    const focus: Pt = { x: d.i + 0.5, z: d.j + 0.5 };
    let jawsHere = 0;

    // Both approaches. `Doorway.ai/aj` names the passage axis but not which end
    // you arrive from, and a threshold is walked both ways.
    for (const dir of [1, -1] as const) {
      const axis: Pt = { x: d.ai * dir, z: d.aj * dir };
      const { left, right } = parabolicJaws(focus, axis, d.w, FUNNEL_DEPTH, FUNNEL_SEGMENTS);
      // ⚠️ BOTH ARMS OR NEITHER, and this is the difference between the feature
      // working and actively hurting.
      //
      // Committing arms independently looks harmlessly generous — "half a
      // funnel is still a funnel" — and it is measured false. A lone arm is not
      // a funnel, it is a diagonal deflector beside an opening: it takes balls
      // that would have gone straight in and steers them across the mouth into
      // the far jamb. Paired against the same doorways with the flare removed,
      // the independent version scored -2.3pp capture and +3.7pp REJECTION,
      // with 22 doorways worse against 8 better. The geometry was never wrong —
      // the focusing tests pass — it was only ever half-built.
      const pair: JawPlan[] = [];
      let armsOk = true;
      for (const chain of [left, right]) {
        const plan = planJaw(g, chain, occupied);
        if (typeof plan === "string") {
          report.rejects[plan] = (report.rejects[plan] ?? 0) + 1;
          armsOk = false;
          break;
        }
        // The arc contract, asked BEFORE committing: a jaw that meets an
        // existing curve at a 48-degree kink is two walls crashing, not one.
        // Links of this chain agree with each other by construction, so what
        // this really tests is the neighbourhood.
        if (!plan.features.every((f, k) => junctionClear(g, plan.arcTiles[k], f))) {
          report.rejects.junction = (report.rejects.junction ?? 0) + 1;
          armsOk = false;
          break;
        }
        pair.push(plan);
      }
      const cost = pair.reduce((n, p) => n + p.features.length, 0);
      if (!armsOk || pair.length !== 2) continue;
      if (built + cost > FUNNEL_MAX_FEATURES) continue;
      for (const plan of pair) {
        built += commitJaw(g, plan);
        committed.push(plan);
        report.jaws++;
        report.carved += plan.carveTiles.length;
        report.filled += plan.fillTiles.length;
        jawsHere++;
      }
    }
    if (jawsHere > 0) report.doorways++;
  }

  // ── THE STRAND GUARD, ONCE FOR THE WHOLE FLOOR ──────────────────────────
  //
  // One collective BFS from the start tile, and if any floor tile lost its path
  // every funnel on the floor is undone. Collective rather than per-jaw for the
  // reason `authorArcSweeps` gives: one BFS per floor instead of one per
  // candidate, and the conservative outcome (a floor with no funnels) is a
  // floor that still works.
  //
  // ⚠️ UNCONDITIONAL, and the version that was not cost 10 stranded tiles
  // across 24 floors against a control of zero. It used to skip the BFS unless
  // some jaw had a non-empty `fillTiles`, on the reasoning that only a fill can
  // strand and carving stone open never can. The reasoning is right and the
  // GATE is wrong, because `fillTiles` is not the whole list of tiles this pass
  // makes impassable: an arc tile is `T_WALL` with `SHAPE_ARC`, transparent to
  // the ball's square sweep but opaque to `isWalkable`, so claiming a face can
  // close a BFS route without ever touching `fillTiles`.
  //
  // The general lesson, which this codebase keeps paying for: a precondition
  // that decides whether to RUN a safety check has to be as correct as the
  // check itself, and it is never the place to be clever. One BFS per floor is
  // nothing.
  //
  // ⚠️ UNWOUND ONE JAW AT A TIME, not all at once, and the difference is most
  // of the feature. `authorArcSweeps` reverts its whole concave batch on any
  // strand because its fillets are scattered decoration and losing them all
  // costs a floor nothing. Funnels are not scattered: there are only a handful
  // per floor and each one is the answer to a measured defect at a specific
  // doorway. Measured, the collective revert fired on 11 floors in 24 and took
  // the yield from 79% of floors down to 33% — one greedy jaw was cancelling
  // every good jaw beside it.
  //
  // So: revert the most recent jaw, re-check, repeat. Last-first because a
  // later jaw planned against the grid an earlier one had already changed, so
  // unwinding in reverse order is the only order in which each snapshot
  // describes the state it was taken from. Worst case is one BFS per committed
  // jaw — a handful on a 9,000-tile grid, which is nothing next to the pass
  // that generated the floor.
  const stranded = (): boolean => {
    const d = bfsDistancesOwned(g, start.i, start.j); // held while scanning
    for (let j = 0; j < g.h; j++) {
      for (let i = 0; i < g.w; i++) {
        if (isWalkable(g, i, j) && d[idx(g, i, j)] < 0) return true;
      }
    }
    return false;
  };

  while (committed.length > 0 && stranded()) {
    const p = committed.pop()!;
    revertJaw(g, p);
    built -= p.features.length;
    report.reverted += p.features.length;
    report.jaws--;
    report.carved -= p.carveTiles.length;
    report.filled -= p.fillTiles.length;
  }
  // A doorway keeps its count only while it still has a jaw standing. Recounted
  // rather than decremented, because one doorway owns up to four jaws and
  // "which doorway did that jaw belong to" is not worth threading through.
  report.doorways = Math.min(report.doorways, report.jaws);

  report.features = built;
  return report;
}
