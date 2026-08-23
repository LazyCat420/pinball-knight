/**
 * CONIC FIT — ellipses and parabolas, expressed as chains of circular arcs.
 *
 * ── Why an engine that only knows circles is the right engine ─────────────
 *
 * `ArcFeature` is a CIRCLE: centre, radius, angular span. The obvious way to
 * get a focusing wall is to teach it about ellipses, and that is a trap. The
 * closest point on an ellipse has no closed form, so every contact would run a
 * Newton iteration in the hot collider; worse, the parametric angle stops
 * matching the polar angle, which breaks `angleInSpan` and with it `kickBandAt`,
 * `laneBandAt`, `arc-contract`'s `surfaceGap`/`tangentAngle`, `backedAt` and
 * `arcSweepGeometry`. The see = hit guarantee would then hold only if the mesh
 * sampler and the collider ran the identical iteration.
 *
 * A conic is instead approximated by a CHAIN of circular arcs — and this
 * codebase is already built for that. `maze/arc-contract.ts` exists precisely
 * to judge whether two arc faces meet as one wall: C⁰ within `SURFACE_TOL`, C¹
 * within `TANGENT_TOL`, same curvature sign. A chain from this module passes
 * with a kink of ZERO, by construction, for the reason in the next section.
 *
 * Zero collider change, zero renderer change, zero rail change — the same
 * argument `LONG_BANKS_PLAN.md` made for artery banks, which shipped.
 *
 * ── The construction, and why the kink is exactly zero ────────────────────
 *
 * Sample the conic at points P₀…Pₙ, each with the unit normal Nₖ pointing at
 * that point's centre of curvature. For segment k, put the arc's centre at
 *
 *      Cₖ = intersection of the NORMAL LINES at Pₖ and Pₖ₊₁
 *
 * Now look at the join Pₖ₊₁. Arc k's centre Cₖ lies on the normal line at
 * Pₖ₊₁; so does arc k+1's centre Cₖ₊₁. Two circles whose centres lie on the
 * SAME line through a point have the same tangent there — both tangents are
 * perpendicular to that one line. So consecutive arcs share a tangent EXACTLY,
 * whatever the sampling density. G¹ is not a tolerance here, it is an identity.
 *
 * What sampling density does buy is C⁰: the two radii |Pₖ₊₁ − Cₖ| and
 * |Pₖ₊₁ − Cₖ₊₁| differ slightly, so there is a small radial STEP at the join.
 * `arcRadius` splits it evenly between the two ends, and `conic-fit.test.ts`
 * bounds what survives — it is ~0.01 tiles at the densities used here, against
 * a `SURFACE_TOL` of 0.75 and a ball radius of 0.3.
 *
 * ── What the two conics are FOR ──────────────────────────────────────────
 *
 *   PARABOLA — every ray travelling parallel to the axis reflects through the
 *     focus. A corridor delivers roughly-parallel rays, so a parabola with its
 *     focus ON the doorway is the funnel jaw: the collector.
 *   ELLIPSE — every ray through focus F₁ reflects through focus F₂. Put the two
 *     foci on two doorway mouths and the chamber between them relays a ball
 *     from one to the other in a single bank. The precondition ("the ray must
 *     pass through F₁") is satisfied by construction, because a ball that
 *     entered through door A did pass through F₁.
 *
 * DOM- and three-free. Pure.
 */
import type { ArcFeature } from "../engine/tile-shape";

export interface Pt {
  x: number;
  z: number;
}

/** A point on a conic, with the unit normal pointing AT its centre of curvature. */
export interface ConicSample {
  x: number;
  z: number;
  /** Unit normal, pointing toward the centre of curvature. */
  nx: number;
  nz: number;
}

/**
 * Largest arc radius worth emitting, in tiles.
 *
 * As a conic flattens its centre of curvature runs off to infinity, and the
 * normal-line intersection with it. A 10,000-tile-radius arc is a straight wall
 * with a rounding error, and it is worse than a straight wall: `backedAt` and
 * `arcSweepGeometry` would sample a band whose centre is far off the grid, so
 * every floating-point cancellation lands in the collider. Past this the
 * segment is dropped and the square tiles own that stretch.
 *
 * ⚠️ RAISED FROM 40, and the old value was silently deciding a design question.
 * A funnel jaw wants to lean in GENTLY (see `THROAT_ANGLE_DEG`), and a gentle
 * parabola is a flat one: below about a 20° throat every segment exceeded 40
 * and was dropped, so the sweep over throat angles reported "none built" for
 * exactly the settings the physics says are best. A cap meant to reject
 * degenerate geometry was rejecting the target instead. 160 tiles is still far
 * short of the precision cliff — a grid is ~130 tiles across, and hypot on
 * centres a few hundred tiles out is exact to ~1e-13.
 */
export const MAX_ARC_RADIUS = 160;

/** Smallest radius worth emitting — below a ball diameter a "curve" is a notch. */
export const MIN_ARC_RADIUS = 0.75;

const TAU = Math.PI * 2;

/**
 * Where the normal lines at two samples cross — the shared centre that makes
 * the join tangent-continuous. Null when they are too near parallel to trust.
 */
export function normalIntersection(a: ConicSample, b: ConicSample): Pt | null {
  // Solve a.P + s·a.N = b.P + t·b.N for s.
  const det = a.nx * -b.nz - a.nz * -b.nx;
  if (Math.abs(det) < 1e-9) return null;
  const rx = b.x - a.x;
  const rz = b.z - a.z;
  const s = (rx * -b.nz - rz * -b.nx) / det;
  return { x: a.x + a.nx * s, z: a.z + a.nz * s };
}

/** Radius that splits the C⁰ error evenly between a segment's two ends. */
function arcRadius(c: Pt, a: ConicSample, b: ConicSample): number {
  return (Math.hypot(a.x - c.x, a.z - c.z) + Math.hypot(b.x - c.x, b.z - c.z)) / 2;
}

/**
 * Turn a sampled conic into a chain of `ArcFeature`s.
 *
 * `solidOut` is the polarity the whole chain shares: true for a concave bowl
 * (stone outside, ball inside — every funnel jaw and relay wall), false for a
 * convex guide. It is ONE value for the chain rather than per-arc on purpose:
 * `junctionCheck` rejects a convex face meeting a concave one as a `flip`, and
 * a conic does not change its curvature sign along an arc anyway.
 *
 * Segments whose curvature is out of range are DROPPED rather than clamped —
 * a clamped arc is a face the conic does not have, and it would be tangent to
 * nothing at both ends, which is the one thing this construction guarantees.
 */
export function arcChainFromSamples(
  samples: readonly ConicSample[],
  solidOut: boolean,
  owner: ArcFeature["owner"] = "sweep",
): ArcFeature[] {
  const out: ArcFeature[] = [];
  for (let k = 0; k + 1 < samples.length; k++) {
    const a = samples[k];
    const b = samples[k + 1];
    const c = normalIntersection(a, b);
    if (!c) continue;
    const r = arcRadius(c, a, b);
    if (!(r >= MIN_ARC_RADIUS && r <= MAX_ARC_RADIUS)) continue;

    const a0raw = Math.atan2(a.z - c.z, a.x - c.x);
    const a1raw = Math.atan2(b.z - c.z, b.x - c.x);
    // Shortest sweep between the two ends. A conic segment sampled this finely
    // never turns more than a right angle, so the short way round is the arc we
    // meant; taking the long way would wrap a full circle of wall onto a face
    // that has stone behind two degrees of it.
    let d = (a1raw - a0raw) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    if (Math.abs(d) < 1e-6) continue;
    // `angleInSpan` measures span as INCREASING angle from a0, so a segment
    // that sweeps backwards is stored from its far end.
    out.push({
      cx: c.x,
      cz: c.z,
      r,
      a0: d > 0 ? a0raw : a1raw,
      span: Math.abs(d),
      solidOut,
      owner,
    });
  }
  return out;
}

// ── ELLIPSE ───────────────────────────────────────────────────────────────

export interface Ellipse {
  /** Centre. */
  ox: number;
  oz: number;
  /** Semi-major and semi-minor. */
  a: number;
  b: number;
  /** Unit vector along the major axis (F₁ → F₂). */
  ux: number;
  uz: number;
}

/**
 * The ellipse with the given foci whose semi-major axis is `a`.
 *
 * Null when `a` is not larger than the focal half-distance — there is no such
 * ellipse, and the degenerate answer (a line segment between the foci) is not
 * a wall.
 */
export function ellipseFromFoci(f1: Pt, f2: Pt, a: number): Ellipse | null {
  const dx = f2.x - f1.x;
  const dz = f2.z - f1.z;
  const d = Math.hypot(dx, dz);
  const c = d / 2;
  if (!(a > c + 1e-6)) return null;
  return {
    ox: (f1.x + f2.x) / 2,
    oz: (f1.z + f2.z) / 2,
    a,
    b: Math.sqrt(a * a - c * c),
    // Foci coincident (a circle) has no distinguished major axis; +x will do.
    ux: d > 1e-9 ? dx / d : 1,
    uz: d > 1e-9 ? dz / d : 0,
  };
}

/**
 * Sample the ellipse over [t0, t1] of its parametric angle, as a CONCAVE bowl:
 * normals point inward, at the centre of curvature.
 *
 * The parametric angle is not the polar angle — that is exactly the mismatch
 * that makes a native ellipse hostile to `angleInSpan`, and the reason it is
 * confined to this module, which converts to circles before anything else sees
 * it.
 */
export function ellipseSamples(e: Ellipse, t0: number, t1: number, n: number): ConicSample[] {
  const vx = -e.uz;
  const vz = e.ux;
  const out: ConicSample[] = [];
  for (let k = 0; k <= n; k++) {
    const t = t0 + ((t1 - t0) * k) / n;
    const ct = Math.cos(t);
    const st = Math.sin(t);
    // Gradient of (x/a)² + (z/b)² points OUT; the bowl's centre of curvature is
    // in, so negate.
    let gx = ct / e.a;
    let gz = st / e.b;
    const gl = Math.hypot(gx, gz) || 1;
    gx /= gl;
    gz /= gl;
    out.push({
      x: e.ox + e.a * ct * e.ux + e.b * st * vx,
      z: e.oz + e.a * ct * e.uz + e.b * st * vz,
      nx: -(gx * e.ux + gz * vx),
      nz: -(gx * e.uz + gz * vz),
    });
  }
  return out;
}

// ── PARABOLA ──────────────────────────────────────────────────────────────

/**
 * Sample a parabola as a CONCAVE bowl, in the frame of an approach corridor.
 *
 * The frame is the one a doorway already carries: `axis` is the direction of
 * TRAVEL through the opening, `focus` is the point every parallel ray is to be
 * gathered to (the middle of the mouth). The parabola opens BACKWARDS up the
 * corridor, so a ball running along the axis toward the door is a ray arriving
 * parallel from the open side — the case the reflective property covers.
 *
 * In (s, u) coordinates — s along the axis from the focus, u across it — the
 * curve is
 *
 *      s = f − u² / (4f)
 *
 * so at the threshold (s = 0) the two arms sit at |u| = 2f. That is what ties
 * `f` to the door: a funnel that meets the jambs of a `w`-wide opening has
 * f = w/4, and everything about how far the mouth flares follows from it rather
 * than being tuned separately.
 *
 * `u0 … u1` selects which stretch of one arm to build. Both arms come from one
 * call each, with u ranges of opposite sign.
 */
export function parabolaSamples(focus: Pt, axis: Pt, f: number, u0: number, u1: number, n: number, s0 = f): ConicSample[] {
  const ax = axis.x;
  const az = axis.z;
  const px = -az; // across
  const pz = ax;
  const out: ConicSample[] = [];
  // n = 0 means "just evaluate the curve at u0" — a single point, which the
  // callers that only want a coordinate (where does the arm meet the jamb?)
  // ask for. Dividing by it instead would hand back a NaN sample that only
  // shows up much later as a NaN arc centre.
  const denom = n > 0 ? n : 1;
  for (let k = 0; k <= n; k++) {
    const u = u0 + ((u1 - u0) * k) / denom;
    const s = s0 - (u * u) / (4 * f);
    // Tangent d/du = (−u/2f, 1) in (s,u); the inward normal (toward the axis,
    // which is where the centre of curvature is) is (−1, −u/2f) normalised.
    let ns = -1;
    let nu = -u / (2 * f);
    const nl = Math.hypot(ns, nu) || 1;
    ns /= nl;
    nu /= nl;
    out.push({
      x: focus.x + s * ax + u * px,
      z: focus.z + s * az + u * pz,
      nx: ns * ax + nu * px,
      nz: ns * az + nu * pz,
    });
  }
  return out;
}

/**
 * THE THROAT ANGLE, in degrees — how steeply a jaw leans in where it meets the
 * jamb. The single most important number in this file.
 *
 * ── Why 45° (the "natural" choice) is the WRONG one ──────────────────────
 *
 * Tying the focal length to the opening as `f = w/4` puts the focus exactly on
 * the mouth and the arms exactly on the jambs, which is elegant, and it forces
 * the wall to meet the jamb at 45°. Built and measured, it made things WORSE:
 * −2.4pp capture and **+7.6pp rejection** on the doorways that got one.
 *
 * Two reasons, and both are about a ball rather than a ray.
 *
 * A CONVERGING CHANNEL IS A WEDGE. Every reflection off a wall leaning in at
 * angle α turns the ball a further 2α away from the axis, so a ball that bounces
 * more than about π/2α times inside the taper is turned around and posted back
 * out the way it came. Steep walls reject; that is what a wedge does. Ray optics
 * never sees this because a ray reflects once.
 *
 * FOCUSING TO A POINT IS THE WRONG OBJECTIVE. A parabola gathers parallel rays
 * onto its focus, so with the focus ON the threshold a ball reflected at the
 * jamb arrives at the middle of the mouth travelling almost exactly ACROSS the
 * passage — it reaches the doorway and crosses it sideways into the far jamb. A
 * ball has to pass THROUGH a plane, which is a condition on its direction, not
 * only on where it arrives.
 *
 * Both point the same way: lean the wall in gently, and put the focus well
 * BEYOND the threshold so the ball is still travelling forward as it crosses.
 *
 * ── Where 30° comes from ─────────────────────────────────────────────────
 *
 * A sweep, then a re-run on eight seeds and eight levels that were held out of
 * the sweep, paired per doorway against the same floor with the flare removed.
 * Capture delta on the doorways that got one:
 *
 *      20°  +8.1pp   (31 doorways)      32°  +11.0pp  (135)  ← here
 *      25°  +6.7pp   (59)               35°   +7.9pp  (105)
 *      28°  +9.9pp   (78)               40°   +6.6pp  (114)
 *      30°  +9.5pp   (74)               45°   +7.2pp  (116)
 *
 * Positive across the whole range once lanes are on, peaking around the low
 * thirties — a broad plateau, so the exact value is not delicate
 * — which is the point of reporting the shape of the curve rather than the
 * winner. What IS delicate is the direction: before booster lanes were added,
 * everything above 30° was actively HARMFUL (45° cost −0.7pp capture and added
 * +2.9pp rejection) exactly as the wedge argument predicts. The lane is what
 * makes the steeper end survivable, because a carry does not steepen the ball's
 * angle the way a bounce does. Change one without re-measuring the other and
 * this number stops meaning anything.
 */
export const THROAT_ANGLE_DEG = 32;

/**
 * Both jaws of a parabolic funnel feeding an opening of width `w`.
 *
 * The arms pass through the jambs at the threshold — so the funnel never
 * widens the opening the doorway vocabulary authored — and lean in at
 * `throatDeg` there. From that pair of constraints everything else follows:
 *
 *     f  = (w/4)·tan(throat)          focal length
 *     s0 = w²/(16f)                   vertex, out beyond the threshold
 *     focus at s = s0 − f             where parallel approaches are gathered
 *
 * At 45° this collapses to the old `f = w/4` with the focus on the mouth. Below
 * it the focus slides forward into the next room, which is the point: a ball
 * reflected off the jaw crosses the threshold still heading forward, aimed at
 * something on the far side, rather than arriving at the mouth sideways.
 *
 * `depth` is how far back up the corridor to reach. The arcs will not get that
 * far and are not meant to — a parabola's radius of curvature grows as
 * `(1 + k²)^1.5`, so the far taper is straight and the square tiles collide and
 * render it for free. `curvedDepth` reports the real reach.
 *
 * Returned as two chains because the caller sites and gates them against the
 * grid; `focusAhead` is how far beyond the threshold the focus sits, which the
 * lane pass needs to aim its boost.
 */
export function parabolicJaws(
  mouth: Pt,
  axis: Pt,
  w: number,
  depth: number,
  segments = 4,
  throatDeg: number = THROAT_ANGLE_DEG,
): { left: ArcFeature[]; right: ArcFeature[]; curvedDepth: number; focusAhead: number } {
  const t = Math.tan((Math.max(1, Math.min(80, throatDeg)) * Math.PI) / 180);
  const f = (w / 4) * t;
  const s0 = (w * w) / (16 * f);
  const uThroat = w / 2; // the arm meets the jamb, by construction
  // s = s0 − u²/4f, so the flare reaches s = −depth at:
  const asked = Math.sqrt(4 * f * (s0 + depth));
  // Clip to where the curve is still tight enough to emit as an arc rather than
  // sampling into the flat tail and having every segment dropped — that would
  // spend the segment budget on nothing and leave the throat coarsely fitted.
  //   R(u) = 2f(1 + (u/2f)²)^1.5 ≤ MAX_ARC_RADIUS
  const kMax = Math.sqrt(Math.max(0, Math.cbrt((MAX_ARC_RADIUS / (2 * f)) ** 2) - 1));
  const uEnd = Math.min(asked, Math.max(uThroat * 1.02, 2 * f * kMax));
  const mk = (a: number, b: number): ArcFeature[] =>
    arcChainFromSamples(parabolaSamples(mouth, axis, f, a, b, segments, s0), true, "funnel");
  return {
    left: mk(-uThroat, -uEnd),
    right: mk(uThroat, uEnd),
    curvedDepth: (uEnd * uEnd) / (4 * f) - s0,
    focusAhead: s0 - f,
  };
}

// ── Evaluation helpers (used by the tests and the census) ─────────────────

/** Signed distance from a point to an arc's circle (0 = on the face). */
export function gapToArc(f: ArcFeature, x: number, z: number): number {
  return Math.hypot(x - f.cx, z - f.cz) - f.r;
}

/**
 * The chain's surface point nearest a given point, and its outward normal —
 * "outward" meaning toward the free space the ball occupies.
 *
 * Only faces whose angular span actually contains the point are considered,
 * which is the same test `resolveArcFeature` applies. A point past the end of
 * every arc is off the chain and returns null rather than snapping to an end,
 * because an arc that owns nothing there does not deflect anything there.
 */
export function nearestOnChain(
  chain: readonly ArcFeature[],
  x: number,
  z: number,
): { gap: number; nx: number; nz: number; feature: ArcFeature } | null {
  let best: { gap: number; nx: number; nz: number; feature: ArcFeature } | null = null;
  for (const f of chain) {
    const dx = x - f.cx;
    const dz = z - f.cz;
    const d = Math.hypot(dx, dz);
    if (d < 1e-9) continue;
    let rel = (Math.atan2(dz, dx) - f.a0) % TAU;
    if (rel < 0) rel += TAU;
    // A point sitting EXACTLY on the arc's start angle can come back from
    // atan2 an ulp short of `a0`, which wraps to ~2π and reads as "past the far
    // end" — the face rejects its own first sample. Fold the top of the circle
    // back to a small negative before testing, so the tolerance is symmetric
    // about both ends instead of only the far one.
    if (rel > TAU - 1e-9) rel -= TAU;
    if (rel < -1e-9 || rel > f.span + 1e-9) continue;
    // Free space is inside a concave bowl, outside a convex guide, so the
    // outward normal flips with the polarity.
    const sign = f.solidOut ? -1 : 1;
    const gap = Math.abs(d - f.r);
    if (!best || gap < best.gap) best = { gap, nx: (sign * dx) / d, nz: (sign * dz) / d, feature: f };
  }
  return best;
}
