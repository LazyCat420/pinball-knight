/**
 * THE ARC CONTRACT — which curved wall pieces may sit next to which.
 *
 * ── The gap this fills ────────────────────────────────────────────────────
 *
 * `track-socket.ts` gave the floor a plumbing contract with four edge labels,
 * one of which is `rim` — "the shoulder of a banked curve". But `rim` is
 * compatible with everything in that table, including another `rim`, so two
 * curved wall pieces could always sit against each other. That was fine while
 * the only question was "does a road end in mid-air"; it is not fine now that a
 * floor carries ~90 arc features, because the table was silently asserting that
 * ANY curve may meet ANY other curve.
 *
 * Measured over 40 floors, that is what happened. 11.9 arc tiles per floor sit
 * next to an arc tile belonging to a DIFFERENT feature, and of those pairs:
 *
 *      76.6%  meet at a tangent KINK steeper than 25°  (median 47.7°, p90 83°)
 *      51.3%  jump more than 1.5 tiles of radius
 *      56.1%  step more than a full tile across the shared edge
 *
 * A 48° kink between two curved walls is not a curve. It is two curves crashing
 * into each other, which is exactly what "a bunch of curves connected to each
 * other that make no sense" describes.
 *
 * ── Why it happens, structurally ──────────────────────────────────────────
 *
 * `arc-sweeps.ts` records that every fillet is centred at C = P − (cx·R, cz·R)
 * for its OWN corner P, so two fillets at different corners are on different
 * circles BY CONSTRUCTION — censused at 96 arcs, 96 distinct circles, zero
 * sharing a centre. There is nothing to merge, and nothing was ever stopping
 * two of those distinct circles from being authored one tile apart. The
 * existing guards only prevent OVERLAP ("already claimed by a shape/sweep",
 * "never carve beside another sweep's slice"); adjacency was unguarded.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * Two arc faces may meet only if a ball riding one would arrive on the other
 * without hitting a corner:
 *
 *   C⁰ — the two surfaces are within `SURFACE_TOL` of each other at the edge
 *        they share (no step);
 *   C¹ — their tangents agree within `TANGENT_TOL` (no kink);
 *   sign — both curve the same way (no convex→concave flip inside one tile).
 *
 * This is the same idea as the socket table — a piece is valid because its
 * EDGES agree with its neighbour's — applied to a continuous quantity instead
 * of a label. Which is what a curve needs: `rim` vs `rim` cannot express
 * "these two arcs are on circles 50° apart".
 *
 * Enforcement is at AUTHORING time (arc-sweeps.ts asks before committing), not
 * as a repair afterwards, because a rejected fillet costs nothing — the corner
 * simply stays square, which is legible — while an authored-then-dissolved one
 * has already carved or filled tiles.
 *
 * DOM- and three-free. Pure.
 */
import { type Grid, idx, at, T_WALL, isWalkable, setShape } from "./generator";
import { SHAPE_ARC, SHAPE_FULL, type ArcFeature } from "../engine/tile-shape";

/**
 * Largest tangent disagreement, in radians, that still reads as one continuous
 * wall. 25° is not a taste number: the measured distribution of DIFFERENT-
 * feature junctions is bimodal — the coherent ones (chained bends along the
 * circuit, which the path builder already made smooth) sit under ~20°, and the
 * incoherent ones pile up around 45-90°. 25° is the gap between the two humps,
 * so it separates them without needing to be tuned.
 */
export const TANGENT_TOL = (25 * Math.PI) / 180;
/**
 * Largest step between the two surfaces at their shared edge, in tiles. Under
 * about ¾ of a tile the renderer's two curved bands overlap enough to read as
 * one wall; past it you can see daylight between them.
 */
export const SURFACE_TOL = 0.75;

/**
 * Who authored a feature — the yield order when a junction is incoherent.
 *
 * The circuit's own fillets are NOT negotiable: they are the carved racing line
 * and the lane was widened to their radius, so dropping one leaves a banked
 * turn with no bank. Scavenged sweeps are decoration and yield. Same shape as
 * `breakLaunchDuels`, where a SPINE part never yields either — and recorded for
 * the same reason, because the tempting "simplification" is to treat all
 * features alike and it silently breaks the thing the floor is built around.
 */
export type ArcOwner = "track" | "island" | "sweep";

/** May this feature be dropped to resolve an incoherent junction? */
export function yields(f: ArcFeature): boolean {
  return (f.owner ?? "sweep") === "sweep";
}

/** Signed distance from a point to the feature's surface (0 = on it). */
export function surfaceGap(f: ArcFeature, x: number, z: number): number {
  return Math.hypot(x - f.cx, z - f.cz) - f.r;
}

/**
 * The tangent direction of the face at the point nearest (x, z), as an angle.
 *
 * A circle's tangent at polar angle θ is θ + π/2. Returned UNDIRECTED-ready:
 * callers compare with `tangentDelta`, which folds the result into [0, π/2]
 * because a wall running north-south is the same wall whichever way you read it.
 */
export function tangentAngle(f: ArcFeature, x: number, z: number): number {
  return Math.atan2(z - f.cz, x - f.cx) + Math.PI / 2;
}

/** Difference between two tangent angles, folded to [0, π/2]. */
export function tangentDelta(a: number, b: number): number {
  const TAU = Math.PI * 2;
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  d = Math.abs(d);
  return d > Math.PI / 2 ? Math.PI - d : d;
}

/**
 * How near a tile must be to its own feature's surface before a junction there
 * means anything.
 *
 * This is the precondition the first version of this rule was missing, and
 * leaving it out is what produced a 76.6% "kink rate" that was almost entirely
 * fiction. `publishArcs` deliberately marks a band 2.0-4.5 tiles DEEP behind
 * each circuit fillet — a thin probe found barely a tile per curve — so most
 * tiles a feature owns are not on its face at all, they are the wall island the
 * face wraps. Two such islands touching is two wall masses touching, which is
 * what a wall is made of, and the renderer never draws owned tiles anyway.
 *
 * So a junction is only judged where BOTH tiles genuinely sit on their own
 * surface. Everything deeper is masonry, not geometry.
 */
export const SURFACE_NEAR = 1.2;

export interface JunctionCheck {
  ok: boolean;
  /** Which clause failed, for test messages and the audit. */
  reason: "" | "kink" | "step" | "flip";
  kink: number; // radians
  step: number; // tiles
}

/**
 * Do two arc faces meet coherently at the point (mx, mz) they share?
 *
 * `mx, mz` is the midpoint of the tile edge between them — the only place the
 * two surfaces are supposed to agree. Sampling each feature THERE (rather than
 * comparing centres or radii directly) is what makes the test independent of
 * how the two circles happen to be parameterised.
 */
export function junctionCheck(a: ArcFeature, b: ArcFeature, mx: number, mz: number): JunctionCheck {
  const kink = tangentDelta(tangentAngle(a, mx, mz), tangentAngle(b, mx, mz));
  const ga = surfaceGap(a, mx, mz);
  const gb = surfaceGap(b, mx, mz);
  const step = Math.abs(ga - gb);
  // Not a junction at all if either face is far from here — see SURFACE_NEAR.
  // Reported as ok rather than skipped so callers have one code path.
  if (Math.abs(ga) > SURFACE_NEAR || Math.abs(gb) > SURFACE_NEAR) {
    return { ok: true, reason: "", kink, step };
  }
  // Curvature sign first: a convex bulge meeting a concave bowl is an S-bend
  // inside one tile, and no tangent tolerance makes that read as one wall.
  if (!!a.solidOut !== !!b.solidOut) return { ok: false, reason: "flip", kink, step };
  if (kink > TANGENT_TOL) return { ok: false, reason: "kink", kink, step };
  if (step > SURFACE_TOL) return { ok: false, reason: "step", kink, step };
  return { ok: true, reason: "", kink, step };
}

const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * Would placing `feature` on `tiles` create an incoherent junction with a
 * feature already on the grid?
 *
 * Called by `arc-sweeps.planFillet` before it commits. Only 4-neighbours count:
 * two arc tiles touching corner-to-corner do not share an edge, so there is no
 * seam for a ball to cross and nothing for the eye to line up.
 */
export function junctionClear(
  g: Grid,
  tiles: ReadonlyArray<{ i: number; j: number }>,
  feature: ArcFeature,
): boolean {
  const arcs = g.arcs;
  if (!arcs || !g.arcIdx) return true;
  const own = new Set(tiles.map((t) => idx(g, t.i, t.j)));
  for (const t of tiles) {
    for (const [di, dj] of SIDES) {
      const x = t.i + di;
      const y = t.j + dj;
      if (x < 0 || y < 0 || x >= g.w || y >= g.h) continue;
      const k = idx(g, x, y);
      if (own.has(k)) continue;
      if (g.shapes[k] !== SHAPE_ARC) continue;
      const fi = g.arcIdx[k];
      if (fi < 0 || fi >= arcs.length) continue;
      // Midpoint of the shared edge, in grid coords.
      const mx = t.i + 0.5 + di * 0.5;
      const mz = t.j + 0.5 + dj * 0.5;
      if (!junctionCheck(feature, arcs[fi], mx, mz).ok) return false;
    }
  }
  return true;
}

export interface ArcJunction {
  i: number;
  j: number;
  di: number;
  dj: number;
  a: number; // feature index
  b: number;
  check: JunctionCheck;
}

/**
 * Every place two DIFFERENT features' arc tiles share an edge, with the verdict.
 *
 * The validator half of the contract — `junctionClear` is the authoring guard,
 * this is what a test or the audit asks afterwards. Same relationship as
 * `findSocketViolations` to the socket table.
 */
export function findArcJunctions(g: Grid, onlyBad = false): ArcJunction[] {
  const out: ArcJunction[] = [];
  const arcs = g.arcs;
  if (!arcs || !g.arcIdx) return out;
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const k = idx(g, i, j);
      if (g.shapes[k] !== SHAPE_ARC) continue;
      const a = g.arcIdx[k];
      if (a < 0 || a >= arcs.length) continue;
      // Only +x and +z, so each shared edge is visited exactly once.
      for (const [di, dj] of [
        [1, 0],
        [0, 1],
      ] as const) {
        const x = i + di;
        const y = j + dj;
        if (x >= g.w || y >= g.h) continue;
        const kk = idx(g, x, y);
        if (g.shapes[kk] !== SHAPE_ARC) continue;
        const b = g.arcIdx[kk];
        if (b < 0 || b >= arcs.length || b === a) continue;
        const check = junctionCheck(arcs[a], arcs[b], i + 0.5 + di * 0.5, j + 0.5 + dj * 0.5);
        if (onlyBad && check.ok) continue;
        out.push({ i, j, di, dj, a, b, check });
      }
    }
  }
  return out;
}

/**
 * ── BACKING: the rule the camera actually cares about ─────────────────────
 *
 * `arcSweepGeometry` draws each feature's FULL span from (cx, cz, r, a0, span).
 * It never asks whether there is any wall behind that band. So a feature whose
 * span runs off the end of its wall mass renders a curved ribbon standing in
 * open floor, attached to nothing — which is most of what a screenshot of a
 * generated floor actually shows: crescents enclosing nothing, curved runs that
 * stop in mid-air, wall faces that go wavy and then simply end.
 *
 * This was invisible to every metric that came before it, mine included. I
 * censused arc TILE adjacency — which features own tiles next to which — and
 * got a confident-looking 76.6% "kink" rate that turned out to be almost
 * entirely `publishArcs` marking a deliberately 2.5-tile-thick band of wall
 * behind each curve. Two thick bands touching is two wall masses touching; the
 * renderer never draws owned tiles, so the camera cannot see it. The lesson is
 * the one this codebase keeps re-learning: measure the quantity, not a proxy
 * for it. The quantity here is "is there stone behind the stone I am drawing".
 *
 * `SAMPLES_PER_TILE` is resolution along the arc; `BACK_PROBE` is how far onto
 * the solid side to look, far enough to clear the tile the surface grazes.
 */
const SAMPLES_PER_TILE = 3;
const BACK_PROBE = 0.6;

/** Is the feature's face at angle `ang` backed by solid stone? */
export function backedAt(g: Grid, f: ArcFeature, ang: number): boolean {
  // Solid is INSIDE for a convex guide, OUTSIDE for a concave bowl.
  const rr = f.solidOut ? f.r + BACK_PROBE : f.r - BACK_PROBE;
  if (rr <= 0) return false;
  const i = Math.floor(f.cx + Math.cos(ang) * rr);
  const j = Math.floor(f.cz + Math.sin(ang) * rr);
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return false;
  return !isWalkable(g, i, j);
}

/** Fraction of a feature's drawn span that has stone behind it. */
export function backedFraction(g: Grid, f: ArcFeature): number {
  const n = Math.max(4, Math.ceil(f.r * f.span * SAMPLES_PER_TILE));
  let ok = 0;
  for (let s = 0; s <= n; s++) if (backedAt(g, f, f.a0 + (f.span * s) / n)) ok++;
  return ok / (n + 1);
}

/**
 * Minimum arc LENGTH, in tiles, worth drawing after trimming. Below about a
 * tile and a half a curve reads as a chamfer rather than a bank, and the
 * collider's rounded face starts to fight the square tiles beside it.
 */
export const MIN_ARC_LEN = 1.6;

/**
 * Shrink a feature's span to the longest run that is actually backed, or
 * return null if nothing worth drawing survives.
 *
 * TRIM rather than REJECT, because the common case is a good curve that simply
 * overshoots its wall at one end: a quarter-turn authored on a corner where the
 * wall mass runs out after 60°. Rejecting throws away the 60° that were right;
 * trimming keeps the bank and drops the ribbon.
 *
 * Full circles (the orbit island) are exempt — an island trimmed to an arc is
 * no longer an island, and its backing is guaranteed by the stamp anyway.
 */
export function trimArcToBacking(g: Grid, f: ArcFeature): ArcFeature | null {
  if (f.span >= Math.PI * 2 - 1e-6 || f.owner === "island") {
    return backedFraction(g, f) > 0.5 ? f : null;
  }
  const n = Math.max(4, Math.ceil(f.r * f.span * SAMPLES_PER_TILE));
  const step = f.span / n;
  let bestStart = -1;
  let bestLen = 0;
  let runStart = -1;
  for (let s = 0; s <= n; s++) {
    if (backedAt(g, f, f.a0 + step * s)) {
      if (runStart < 0) runStart = s;
      const len = s - runStart;
      if (len > bestLen) {
        bestLen = len;
        bestStart = runStart;
      }
    } else {
      runStart = -1;
    }
  }
  if (bestStart < 0 || bestLen === 0) return null;
  const span = bestLen * step;
  if (span * f.r < MIN_ARC_LEN) return null;
  if (bestStart === 0 && bestLen === n) return f; // already fully backed
  const a0 = f.a0 + bestStart * step;

  // ⚠️ THE BANDS MUST BE CLIPPED TOO, and this is not bookkeeping.
  //
  // A `KickBand` (rubber) and a `LaneBand` (speed strip) are angular sub-spans
  // of the feature, but `render/arc-kickers.ts` and `render/arc-lanes.ts` draw
  // them from their OWN a0/span on the feature's circle — they never consult
  // the feature's span. So trimming the wall without trimming its bands leaves
  // crimson rubber curving through open air past the end of the stone it is
  // supposed to be bolted to.
  //
  // Found by looking at a screenshot, not by a test: the first render after the
  // trim rule showed exactly that, and no metric I had would have flagged it,
  // because every feature was 100% backed — the defect had moved into a field
  // the backing check does not read.
  const clip = <T extends { a0: number; span: number }>(bands: T[] | undefined): T[] | undefined => {
    if (!bands?.length) return undefined;
    const out: T[] = [];
    for (const b of bands) {
      const s = Math.max(b.a0, a0);
      const e = Math.min(b.a0 + b.span, a0 + span);
      // A sliver of rubber reads as a speck of noise on the wall, so a band
      // that survives only marginally is dropped rather than shrunk to nothing.
      if ((e - s) * f.r >= MIN_ARC_LEN * 0.5) out.push({ ...b, a0: s, span: e - s });
    }
    return out.length ? out : undefined;
  };
  return { ...f, a0, span, kicks: clip(f.kicks), lanes: clip(f.lanes) };
}

/**
 * Minimum tiles a feature must own to be worth drawing.
 *
 * `arcSweepGeometry` walks `Grid.arcs` and draws each feature's FULL span — it
 * never looks at which tiles reference it. So a feature reduced to one tile by
 * a later pass still renders a complete quarter-circle band: a curved wall
 * hanging off a single stone. Measured before this pass, 5.1% of features owned
 * 1-2 tiles and 0.1% owned none at all, and every one of them was being drawn.
 */
export const MIN_ARC_TILES = 3;

/**
 * Drop features nothing meaningful references, and REMAP the survivors.
 *
 * ⚠️ The remap is the whole job and it is the easy thing to get wrong. Every
 * SHAPE_ARC tile stores its feature as an index into `Grid.arcs`, so removing
 * an element without rewriting those indices leaves every later tile pointing
 * one slot short — the collider then reads a NEIGHBOURING curve's geometry,
 * which is the worst kind of see≠hit bug because it looks almost right. The
 * same trap is recorded in `publishArcs` for the same array.
 *
 * Reverting a dropped feature's tiles to SHAPE_FULL changes no tile's
 * walkability (they are and stay wall), so this pass cannot affect
 * connectivity — safe by construction, like `publishArcs`.
 *
 * Returns the number of features dropped.
 */
export function compactArcs(g: Grid, minTiles = MIN_ARC_TILES): number {
  const arcs = g.arcs;
  if (!arcs || !g.arcIdx || arcs.length === 0) return 0;

  const count = new Int32Array(arcs.length);
  for (let k = 0; k < g.shapes.length; k++) {
    if (g.shapes[k] !== SHAPE_ARC) continue;
    // A tile that is no longer wall is not a rim, whatever its shape says.
    const i = k % g.w;
    const j = (k - i) / g.w;
    if (at(g, i, j) !== T_WALL) continue;
    const fi = g.arcIdx[k];
    if (fi >= 0 && fi < arcs.length) count[fi]++;
  }

  // TWO tests, and the second is the one the camera sees.
  //
  //  · tile count — a feature nothing references is a curve with no wall;
  //  · BACKING    — a feature whose drawn span runs past its wall mass is a
  //                 curved ribbon standing in open floor. Trimmed to the part
  //                 that is genuinely backed, and dropped if nothing survives.
  //
  // A full-circle island is exempt from the tile floor: it is one feature by
  // design and its rim is thin, so judging it by the same count as a quarter
  // fillet would delete the floor's centrepiece.
  const trimmed = arcs.map((f) => trimArcToBacking(g, f));
  const keep = arcs.map((f, fi) => trimmed[fi] !== null && (f.owner === "island" || count[fi] >= minTiles));
  if (keep.every(Boolean) && trimmed.every((t, fi) => t === arcs[fi])) return 0;

  const remap = new Int32Array(arcs.length).fill(-1);
  const next: ArcFeature[] = [];
  for (let fi = 0; fi < arcs.length; fi++) {
    if (!keep[fi]) continue;
    remap[fi] = next.length;
    next.push(trimmed[fi]!);
  }

  for (let k = 0; k < g.shapes.length; k++) {
    if (g.shapes[k] !== SHAPE_ARC) continue;
    const fi = g.arcIdx[k];
    const to = fi >= 0 && fi < remap.length ? remap[fi] : -1;
    if (to < 0) {
      // Back to plain stone. The tile keeps its walkability either way.
      const i = k % g.w;
      const j = (k - i) / g.w;
      setShape(g, i, j, SHAPE_FULL);
      g.arcIdx[k] = -1;
    } else {
      g.arcIdx[k] = to;
    }
  }
  const dropped = arcs.length - next.length;
  g.arcs = next;
  return dropped;
}

/** Arc tiles that are no longer wall — a curve claiming collision on open floor. */
export function findOrphanArcTiles(g: Grid): Array<{ i: number; j: number }> {
  const out: Array<{ i: number; j: number }> = [];
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (g.shapes[idx(g, i, j)] !== SHAPE_ARC) continue;
      if (isWalkable(g, i, j)) out.push({ i, j });
    }
  }
  return out;
}
