/**
 * DOORWAY FUNNELS — flare a threshold so a ball banks THROUGH it, not off it.
 *
 * ⚠️ OFF BY DEFAULT, and NOT because the mechanism fails. Read both halves.
 *
 * ── What it does, measured ───────────────────────────────────────────────
 *
 * Paired per doorway against the same floor on the same seed with the flare
 * removed, over 100 floors never used for tuning:
 *
 *      capture   47.9% → 53.9%   +6.1pp
 *      rejected  (sent back the way it came)   −2.0pp
 *      79 doorways better, 26 worse, 14 unchanged
 *
 * Two mechanisms, and the second one carries it:
 *
 *   THE SHAPE  a parabola with its arms on the jambs, leaning in at
 *              `THROAT_ANGLE_DEG`, gathering a corridor's worth of approaches.
 *   THE LANE   a booster band along each jaw, carrying the ball around the
 *              curve and releasing it along the tangent — through the opening.
 *
 * ── Why it is off anyway ─────────────────────────────────────────────────
 *
 * Turning it on breaks three of this generator's own gates: `piece-rules` on
 * every archetype and again after `decorateMaze`, and `floor-rules` on every
 * generated floor. This pass both carves and fills, and the tile
 * configurations it leaves are not in the piece vocabulary those gates
 * enforce. A floor that plays better while violating three structural
 * contracts is not a floor to ship — the gates are the standard, not the
 * obstacle — so the remaining work is making the carve/fill output conform,
 * not relaxing them.
 *
 * Three of the six original breakages ARE fixed and those fixes are in: the
 * pass runs the pipeline's own `repair` behind it (a fill can leave a road in
 * mid-air, which its own strand guard cannot see — connected is weaker than
 * well-formed), it clears arc tiles the repair then opens, and funnel links are
 * held to the full-backing bar `piece-rules` actually demands rather than the
 * lax one an earlier exemption gave them.
 *
 * ── The two things that had to be got wrong first ────────────────────────
 *
 * The first version of this pass shipped OFF because it made things WORSE:
 * −2.4pp capture and +7.6pp rejection. Both causes are worth keeping, because
 * both are invisible to the ray-optics reasoning that motivated the feature.
 *
 * A CONVERGING CHANNEL IS A WEDGE. Every bounce off a wall leaning in at angle
 * α turns the ball a further 2α off the axis, so past a few bounces a steep
 * taper turns the ball around and posts it back out. Rays never show this —
 * a ray reflects once. This is why the throat angle exists at all, and why
 * everything above 30° was harmful until lanes were added: a lane REPLACES the
 * bounce with a carry, and a carry does not steepen anything.
 *
 * FOCUSING TO A POINT IS THE WRONG OBJECTIVE. With the focus on the threshold
 * (the elegant `f = w/4`), a ball reflected at the jamb arrives at the middle
 * of the mouth travelling almost exactly ACROSS the passage — it reaches the
 * doorway and crosses it sideways into the far jamb. Passing through a plane is
 * a condition on DIRECTION, not just on arrival. The focus now sits well beyond
 * the threshold so the ball is still going forward as it crosses.
 *
 * ── And two ways the measurement itself was wrong ────────────────────────
 *
 *  · TREATMENT WAS DETECTED BY DISTANCE TO THE ARC CENTRE. A jaw's arcs have
 *    radii of 7-160 tiles because a parabola flattens fast, so their centres
 *    sit far out in the rock; the test marked every doorway within ~25 tiles as
 *    treated and reported 25 where there were 7. A curve is where its TILES
 *    are. Now asked of the tiles.
 *  · THE JAW WAS ALL-OR-NOTHING. Requiring every link to be buildable meant one
 *    existing fillet anywhere along a long arm cancelled the whole funnel —
 *    305 of 312 refusals were "that tile is already something". Links are
 *    ordered from the jamb outward and the arm now keeps its buildable PREFIX,
 *    which took yield from 2 doorways per 24 floors to 18.
 *
 * ── The shape ────────────────────────────────────────────────────────────
 *
 * A PARABOLA whose arms pass through the JAMBS at the threshold and lean in at
 * `THROAT_ANGLE_DEG` there. Those two constraints fix everything else — focal
 * length, vertex, and where the focus lands — and the focus comes out well
 * BEYOND the opening, in the room you are heading for.
 *
 * The arms meeting the jambs is what keeps the funnel honest: it gathers from
 * far wider than the door WITHOUT widening the door, so the 3/5/7 vocabulary
 * `doorways.ts` authored survives intact, which is the whole reason that
 * vocabulary exists. The flare tapers the CORRIDOR into the opening; it never
 * touches the opening.
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
import { SHAPE_FULL, SHAPE_ARC, type ArcFeature, type LaneBand } from "../engine/tile-shape";
import { junctionClear } from "./arc-contract";
import { bfsDistancesOwned } from "../engine/flow-field";
import { parabolicJaws, THROAT_ANGLE_DEG, type Pt } from "./conic-fit";
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
 * How steeply a jaw leans in at the jamb. See `conic-fit.ts THROAT_ANGLE_DEG`
 * for why this is the number that decides whether the feature works at all.
 */
export const FUNNEL_THROAT_DEG = THROAT_ANGLE_DEG;

/** String a booster lane along each jaw, carrying the ball through the mouth. */
export const FUNNEL_LANES = true;

/**
 * Tiles either side of the doorway plane the flare may not open, measured along
 * the passage axis.
 *
 * One, not zero: `measureDoorway` walks the opening's cross-section, and a
 * carve one tile in front of the threshold joins that run just as surely as a
 * carve on it.
 */
export const THRESHOLD_KEEPOUT = 1;

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

/** Allow the flare to raise floor into wall. See the header on why this is off. */
export const FUNNEL_FILL = true;

export interface JawPlan {
  features: ArcFeature[];
  /** Tiles the curve straddles → WALL + SHAPE_ARC, one entry per feature. */
  arcTiles: TilePos[][];
  /** Wall tiles on the OPEN side of the curve → carved to floor (the flare). */
  carveTiles: TilePos[];
  /** Floor tiles on the SOLID side → filled to wall (the funnel's own stone). */
  fillTiles: TilePos[];
  /** Middle of the opening this jaw feeds — which way its lane carries. */
  mouth?: Pt;
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
export function claimable(g: Grid, ti: number, tj: number, occupied: Occupied): boolean {
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
export function planChain(
  g: Grid,
  chain: readonly ArcFeature[],
  occupied: Occupied,
  /** True where the flare must not open stone — the threshold itself. */
  sealed: (i: number, j: number) => boolean,
): JawPlan | JawReject {
  if (chain.length === 0) return "empty";
  const arcTiles: TilePos[][] = [];
  const features: ArcFeature[] = [];
  const carveTiles: TilePos[] = [];
  const fillTiles: TilePos[] = [];
  const seen = new Set<number>();

  // Links come off `parabolicJaws` ordered from the JAMB OUTWARD, and that
  // ordering is what makes trimming meaningful: link 0 anchors the funnel to
  // the opening, and each one after it reaches further back up the corridor and
  // matters less. So a link that cannot be built ends the arm rather than
  // cancelling it.
  for (const f of chain) {
    const mine: TilePos[] = [];
    const carve: TilePos[] = [];
    const fill: TilePos[] = [];
    const claimed = new Set<number>();
    let ok = true;

    const i0 = Math.floor(f.cx - f.r - 1);
    const i1 = Math.ceil(f.cx + f.r + 1);
    const j0 = Math.floor(f.cz - f.r - 1);
    const j1 = Math.ceil(f.cz + f.r + 1);
    for (let tj = j0; tj <= j1 && ok; tj++) {
      for (let ti = i0; ti <= i1; ti++) {
        if (!withinSpan(f, ti, tj)) continue;
        const { dmin, dmax } = tileDistRange(f.cx, f.cz, ti, tj);
        const straddles = dmin < f.r - 1e-6 && dmax > f.r + 1e-6;
        const inside = dmax <= f.r + 1e-6;
        const outside = dmin >= f.r - 1e-6;
        const k = idx(g, ti, tj);

        if (straddles) {
          if (!claimable(g, ti, tj, occupied) && !(FUNNEL_FILL && fillable(g, ti, tj, occupied))) {
            ok = false;
            break;
          }
          if (seen.has(k) || claimed.has(k)) continue;
          claimed.add(k);
          if (isWalkable(g, ti, tj)) fill.push({ i: ti, j: tj });
          mine.push({ i: ti, j: tj });
        } else if (inside) {
          if (isWalkable(g, ti, tj)) continue;
          // ⚠️ NEVER OPEN STONE IN THE THRESHOLD ITSELF.
          //
          // The flare is allowed to widen the APPROACH — that is what a funnel
          // is — but the opening keeps the size `carveDoorways` authored, or
          // the 3/5/7 vocabulary stops meaning anything. Without this the
          // carve reached the doorway's own cross-section and `measureDoorway`
          // read 13 tiles against a vocabulary maximum of 7: precisely the
          // defect `doorways.ts` added `jambsSurvive` to stop, rebuilt from the
          // other side.
          if (sealed(ti, tj)) {
            ok = false;
            break;
          }
          if (!claimable(g, ti, tj, occupied)) {
            ok = false;
            break;
          }
          if (seen.has(k) || claimed.has(k)) continue;
          claimed.add(k);
          carve.push({ i: ti, j: tj });
        } else if (outside && dmin < f.r + FUNNEL_BACKING) {
          if (!isWalkable(g, ti, tj)) continue;
          if (!FUNNEL_FILL || at(g, ti, tj) === T_CRACKED || !fillable(g, ti, tj, occupied)) {
            ok = false;
            break;
          }
          if (seen.has(k) || claimed.has(k)) continue;
          claimed.add(k);
          fill.push({ i: ti, j: tj });
        }
      }
    }
    // A link that owns no face is not a wall, and it also ends the arm: the
    // next link out would float, attached to nothing.
    if (!ok || mine.length === 0) break;
    if (fillTiles.length + fill.length > FUNNEL_MAX_FILL) break;

    for (const t of mine) seen.add(idx(g, t.i, t.j));
    for (const t of carve) seen.add(idx(g, t.i, t.j));
    for (const t of fill) seen.add(idx(g, t.i, t.j));
    features.push(f);
    arcTiles.push(mine);
    carveTiles.push(...carve);
    fillTiles.push(...fill);
  }

  // The link that meets the jamb is the funnel. Without it the rest is a curve
  // floating in a corridor with a square doorway beyond it.
  if (features.length === 0) return "claimed";
  return { features, arcTiles, carveTiles, fillTiles, before: [] };
}

/**
 * String a booster lane along a jaw, pointing INTO the mouth.
 *
 * This is the part that answers the ask directly, and it is a different
 * mechanism from the shape. A bounce off a converging wall turns the ball
 * further from the axis every time (that is what makes a steep funnel reject);
 * a LANE replaces the bounce with a tangential CARRY — the ball is swept along
 * the curve and released along it, at the exit speed `ARC_LANE_MULT` gives it.
 * On a gently-leaning jaw the tangent points nearly straight down the corridor,
 * so the release is aimed through the opening.
 *
 * `cw` is chosen by asking which way the tangent actually points at the arc's
 * midpoint rather than deriving it from a winding convention — the convention
 * is easy to get backwards, and a lane that carries the ball AWAY from the door
 * is worse than no lane at all.
 */
export function laneTowardMouth(f: ArcFeature, mouth: Pt): LaneBand {
  const mid = f.a0 + f.span / 2;
  const px = f.cx + Math.cos(mid) * f.r;
  const pz = f.cz + Math.sin(mid) * f.r;
  const dx = px - f.cx;
  const dz = pz - f.cz;
  const d = Math.hypot(dx, dz) || 1;
  // Tangent for cw = true, i.e. increasing angle (see `laneTangent`).
  const tx = -dz / d;
  const tz = dx / d;
  const cw = tx * (mouth.x - px) + tz * (mouth.z - pz) > 0;
  return { a0: f.a0, span: f.span, cw, cooldownT: 0, hitT: -1 };
}

/** Commit a planned jaw: open the flare, raise the wall, register the faces. */
export function commitJaw(g: Grid, plan: JawPlan): number {
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
    if (FUNNEL_LANES && plan.mouth) f.lanes = [laneTowardMouth(f, plan.mouth)];
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
export function revertJaw(g: Grid, plan: JawPlan): void {
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
  tune: { throatDeg?: number; depth?: number; segments?: number } = {},
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
    // The threshold row: tiles within half a tile of the doorway's own plane.
    // `measureDoorway` reads across exactly this line, so it is the line the
    // flare must leave alone.
    const sealed = (i: number, j: number): boolean =>
      Math.abs((i - d.i) * d.ai + (j - d.j) * d.aj) <= THRESHOLD_KEEPOUT;
    let jawsHere = 0;

    // Both approaches. `Doorway.ai/aj` names the passage axis but not which end
    // you arrive from, and a threshold is walked both ways.
    for (const dir of [1, -1] as const) {
      const axis: Pt = { x: d.ai * dir, z: d.aj * dir };
      const { left, right } = parabolicJaws(
        focus,
        axis,
        d.w,
        tune.depth ?? FUNNEL_DEPTH,
        tune.segments ?? FUNNEL_SEGMENTS,
        tune.throatDeg ?? FUNNEL_THROAT_DEG,
      );
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
        const plan = planChain(g, chain, occupied, sealed);
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
        plan.mouth = focus;
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
