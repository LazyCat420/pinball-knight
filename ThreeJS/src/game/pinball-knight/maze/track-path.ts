/**
 * TRACK PATH — turning a grown graph into RIDEABLE geometry.
 *
 * `track-grow.ts` decides the topology: which junctions exist and which are
 * connected. Its edges are straight chords, and a network of straight chords
 * meeting at arbitrary angles is not a track — a ball arriving at a 40° node
 * junction at speed just stops dead. This module is the geometry half: it
 * rounds every junction into a real arc with a GUARANTEED radius.
 *
 * ── The inversion that makes this work ────────────────────────────────────
 *
 * The shipped pipeline scavenges for curves: `arc-sweeps.ts` scans finished
 * maze corners and keeps whichever radius happens to fit, which is why 81.8%
 * of open tiles have an open radius of zero and radius-4 fillets fit 4 times
 * in 40 floors (censused in `artery-banks.ts`).
 *
 * Here the radius is an INPUT. We pick the fillet radius we want, and the
 * carver is then obliged to clear the space for it — because the carver runs
 * BEFORE the maze exists and nothing else has claimed the tiles yet. Turning a
 * scavenging problem into an allocation problem is the whole point of the
 * track-first ordering.
 *
 * ── Fillet geometry ───────────────────────────────────────────────────────
 *
 * At a junction J between incoming direction u and outgoing direction v (both
 * unit vectors), the standard corner fillet of radius R is tangent to both legs
 * at a setback distance
 *
 *     t = R / tan(θ/2)        where θ is the interior angle between the legs
 *
 * so the arc centre sits at distance R/sin(θ/2) from J along the angle
 * bisector. Shallow angles blow `t` up (tan(θ/2) → 0), which is why very
 * shallow junctions are straightened instead of filleted — a fillet there
 * would swallow the entire leg. That guard is `MIN_TURN`.
 *
 * Emitted as `ArcFeature`s in the SAME descriptor the collider and mesh
 * already share (tile-shape.ts), so a curve the player sees is a curve the
 * player hits — the "see = hit" contract this codebase keeps.
 *
 * DOM- and three-free, and deterministic. Pure geometry.
 */
import type { ArcFeature } from "../engine/tile-shape";
import type { TrackGraph } from "./track-grow";

/** A single rideable leg of the circuit: a straight run between two fillets. */
export interface TrackLeg {
  /** Endpoints in tile space, already pulled back by the fillet setbacks. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Which graph nodes this leg runs between (for on-ramp siting later). */
  a: number;
  b: number;
  /** Lane half-width in tiles — wider on the busiest tubes. */
  half: number;
}

/** The circuit as rideable geometry. */
export interface TrackPath {
  legs: TrackLeg[];
  /** Junction fillets, as engine-native arc descriptors. */
  arcs: ArcFeature[];
  /**
   * Half-width the CARVER must sweep every fillet at, in tiles.
   *
   * It rides here rather than being a constant in `carveTrack` because it has
   * to track `laneScale`: widening the straights without widening the corners
   * turns every junction into a funnel, and a ball carrying pinball momentum
   * into a funnel wedges. One number, one owner.
   */
  arcHalf: number;
}

/**
 * Junctions shallower than this are straightened rather than filleted.
 *
 * At θ below ~35° the setback t = R/tan(θ/2) exceeds 3R and the fillet eats the
 * whole leg — the two straights vanish and the "corner" becomes a long lazy
 * drift that reads as a kink, not a curve. Straightening looks better and, more
 * importantly, cannot consume a neighbouring junction's space.
 */
export const MIN_TURN = (35 * Math.PI) / 180;

/**
 * Corner radii, tried largest-first.
 *
 * These are LARGE compared to the shipped fillets ([3, 2] in arc-sweeps.ts) and
 * that is the entire point: the ball needs a curve long enough to hold a line.
 * A radius-6 quarter-turn is 9.4 tiles of arc against the shipped 3.1. We can
 * ask for it because we allocate the space before the maze exists.
 */
export const TRACK_RADII = [7, 6, 5, 4, 3] as const;

/** Lane half-widths. The busiest tubes become the widest highways. */
export const LANE_HALF = { trunk: 2.5, main: 2, spur: 1.5 } as const;

const TAU = Math.PI * 2;

/** Shortest signed angular difference b−a, wrapped to (−π, π]. */
export function angDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/**
 * Order the edges around each node by bearing, then fillet consecutive pairs.
 *
 * A node of degree 2 is a simple corner. Degree 3+ is a real junction, and each
 * ADJACENT pair of legs (in bearing order) gets its own fillet — that is what
 * makes a junction rideable from any approach rather than only along one
 * favoured pair. Non-adjacent pairs are skipped: their fillets would cross the
 * junction interior and overlap each other.
 */
export function buildTrackPath(g: TrackGraph, opts: { radii?: readonly number[]; laneScale?: number } = {}): TrackPath {
  const radii = opts.radii ?? TRACK_RADII;
  // Multiplier on every lane half-width. A Great Hall's roads are broad and a
  // Warrens' are tight, and that is a thing the player FEELS at speed long
  // before they read the descent card. Clamped: below ~0.6 the lane is narrower
  // than the ball's own manoeuvring room, and above ~2 a trunk road paves the
  // floor on its own.
  const laneScale = Math.max(0.6, Math.min(2, opts.laneScale ?? 1));
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const maxD = g.edges.reduce((m, e) => Math.max(m, e.d), 1e-9);

  // Adjacency with bearings.
  const adj = new Map<number, Array<{ to: number; ang: number; d: number }>>();
  for (const e of g.edges) {
    const A = byId.get(e.a);
    const B = byId.get(e.b);
    if (!A || !B) continue;
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a)!.push({ to: e.b, ang: Math.atan2(B.z - A.z, B.x - A.x), d: e.d });
    adj.get(e.b)!.push({ to: e.a, ang: Math.atan2(A.z - B.z, A.x - B.x), d: e.d });
  }
  for (const list of adj.values()) list.sort((p, q) => p.ang - q.ang);

  // Per-node, per-leg setback: how far back from the junction this leg's
  // straight must stop so the fillets have room. A leg shared by two fillets
  // takes the LARGER setback, or the two arcs would overlap.
  //
  // TWO PASSES, and the ordering is load-bearing. A single pass that emitted
  // each arc as it was computed produced arcs whose tangent points no longer
  // touched their legs: at a degree-3+ junction the shared leg ends up with the
  // MAX setback, but an arc built earlier had already committed to its own
  // smaller `t`. Measured on the one-pass version: 10.3% of arc endpoints
  // unmatched, worst gap 3.2 tiles — every one a visible kink where the ball
  // would clip a corner that isn't drawn. So: resolve all setbacks first, then
  // build every arc against the FINAL value.
  const setback = new Map<string, number>();
  const arcs: ArcFeature[] = [];
  const key = (n: number, to: number): string => `${n}>${to}`;

  interface Pending {
    nid: number;
    L0: { to: number; ang: number };
    L1: { to: number; ang: number };
    theta: number;
    R: number;
  }
  const pending: Pending[] = [];
  /** One setback per junction — see the note where it is filled. */
  const nodeT = new Map<number, number>();

  for (const [nid, legs] of adj) {
    const J = byId.get(nid)!;
    if (legs.length < 2) continue;
    for (let k = 0; k < legs.length; k++) {
      // Only consecutive pairs in bearing order (and skip the wrap pair when
      // degree is 2 — a 2-leg node has exactly ONE corner, not two).
      if (legs.length === 2 && k === 1) break;
      const L0 = legs[k];
      const L1 = legs[(k + 1) % legs.length];

      // Interior angle between the two legs as they LEAVE the junction.
      const turn = Math.abs(angDiff(L0.ang, L1.ang));
      const theta = turn; // both bearings point away from J
      if (theta < MIN_TURN || theta > Math.PI - 1e-6) continue; // too shallow / straight through

      const halfT = Math.tan(theta / 2);
      if (halfT < 1e-6) continue;

      // Longest available leg lengths bound how much setback we can afford.
      const A0 = byId.get(L0.to)!;
      const A1 = byId.get(L1.to)!;
      const len0 = Math.hypot(A0.x - J.x, A0.z - J.z);
      const len1 = Math.hypot(A1.x - J.x, A1.z - J.z);
      const budget = Math.min(len0, len1) * 0.42; // leave most of each leg straight

      let chosen = 0;
      let t = 0;
      for (const R of radii) {
        const need = R / halfT;
        if (need <= budget) {
          chosen = R;
          t = need;
          break;
        }
      }
      if (!chosen) continue; // no radius fits — leave it a sharp junction

      pending.push({ nid, L0, L1, theta, R: chosen });
      // ONE setback per JUNCTION, not per leg. Every fillet at a node shares it,
      // so the arcs stay mutually consistent and each one's tangent point is
      // exactly where its legs stop. (Per-leg maxima looked more precise but
      // let one leg pair inflate a neighbour's radius — re-deriving R from a
      // borrowed setback produced radii up to r=2161 on shallow junctions.)
      nodeT.set(nid, Math.max(nodeT.get(nid) ?? 0, t));
    }
  }

  // Settle: every leg leaving a junction pulls back by that junction's setback.
  for (const { nid, L0, L1 } of pending) {
    const t = nodeT.get(nid) ?? 0;
    for (const to of [L0.to, L1.to]) {
      const kk = key(nid, to);
      setback.set(kk, Math.max(setback.get(kk) ?? 0, t));
    }
  }

  // PASS 2a — the LEGS, so pass 2b knows which survived.
  //
  // Order matters: a short edge can be entirely eaten by the fillets at its two
  // ends and drop out. An arc tangent to a leg that no longer exists is a curve
  // floating in space attached to nothing — exactly the orphaned-fragment look
  // this whole rework is meant to end — so arcs are emitted only for live legs.
  const legs: TrackLeg[] = [];
  const liveEdge = new Set<string>();
  const edgeKey = (a: number, b: number): string => `${Math.min(a, b)}:${Math.max(a, b)}`;
  for (const e of g.edges) {
    const A = byId.get(e.a);
    const B = byId.get(e.b);
    if (!A || !B) continue;
    const ang = Math.atan2(B.z - A.z, B.x - A.x);
    const sa = setback.get(key(e.a, e.b)) ?? 0;
    const sb = setback.get(key(e.b, e.a)) ?? 0;
    const len = Math.hypot(B.x - A.x, B.z - A.z);
    if (sa + sb >= len - 0.5) continue; // fully consumed by its own fillets
    const rel = e.d / maxD;
    liveEdge.add(edgeKey(e.a, e.b));
    legs.push({
      x0: A.x + Math.cos(ang) * sa,
      z0: A.z + Math.sin(ang) * sa,
      x1: B.x - Math.cos(ang) * sb,
      z1: B.z - Math.sin(ang) * sb,
      a: e.a,
      b: e.b,
      // Conductivity IS traffic, so the busiest tube becomes the widest road.
      // This is the visual payoff of the growth model: highway hierarchy comes
      // out of the simulation instead of being assigned arbitrarily.
      half: Math.max(1.5, (rel > 0.66 ? LANE_HALF.trunk : rel > 0.28 ? LANE_HALF.main : LANE_HALF.spur) * laneScale),
    });
  }

  // PASS 2b — the ARCS, against the settled setbacks and only where both of the
  // filleted legs actually survived.
  for (const { nid, L0, L1, theta } of pending) {
    const J = byId.get(nid)!;
    const t = nodeT.get(nid) ?? 0;
    if (t <= 1e-6) continue;
    if (!liveEdge.has(edgeKey(nid, L0.to)) || !liveEdge.has(edgeKey(nid, L1.to))) continue;
    // R follows from the shared setback and THIS pair's angle, so the arc is
    // tangent to both legs exactly where they stop. Clamped to the authored
    // range: an unclamped R at a very shallow pair runs to hundreds of tiles,
    // which is a straight line pretending to be a curve.
    const R = Math.min(radii[0], Math.max(1, t * Math.tan(theta / 2)));
    if (R < 1) continue; // degenerate — not a curve worth drawing

    const bis = L0.ang + angDiff(L0.ang, L1.ang) / 2;
    const dist = R / Math.sin(theta / 2);
    const cx = J.x + Math.cos(bis) * dist;
    const cz = J.z + Math.sin(bis) * dist;

    const p0x = J.x + Math.cos(L0.ang) * t;
    const p0z = J.z + Math.sin(L0.ang) * t;
    const p1x = J.x + Math.cos(L1.ang) * t;
    const p1z = J.z + Math.sin(L1.ang) * t;
    const a0 = Math.atan2(p0z - cz, p0x - cx);
    const a1 = Math.atan2(p1z - cz, p1x - cx);
    let span = angDiff(a0, a1);
    const start = span >= 0 ? a0 : a1;
    span = Math.abs(span);
    if (span < 1e-3) continue;

    arcs.push({
      cx,
      cz,
      r: R,
      a0: start,
      span,
      // Solid INSIDE: the ball sweeps around the outside of the fillet, which
      // is the NASCAR high line the artery-banks census argued for.
      solidOut: false,
    });
  }

  return { legs, arcs, arcHalf: Math.max(1.5, 2 * laneScale) };
}

/** Total rideable straight length — a sanity metric for tests. */
export function totalLegLength(p: TrackPath): number {
  return p.legs.reduce((s, l) => s + Math.hypot(l.x1 - l.x0, l.z1 - l.z0), 0);
}

/** Total arc length across every fillet, in tiles. */
export function totalArcLength(p: TrackPath): number {
  return p.arcs.reduce((s, a) => s + a.r * a.span, 0);
}
