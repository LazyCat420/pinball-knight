//! TRACK PATH — a grown graph turned into RIDEABLE geometry. Pass 2 of 23.
//!
//! Port of `legacy/src/game/pinball-knight/maze/track-path.ts`.
//!
//! `track_grow` decides the topology: which junctions exist and which are
//! connected. Its edges are straight chords, and a network of straight chords
//! meeting at arbitrary angles is not a track — a ball arriving at a 40° node
//! junction at speed just stops dead. This module is the geometry half: it
//! rounds every junction into a real arc with a GUARANTEED radius.
//!
//! ## Fillet geometry
//!
//! At a junction J between two legs leaving on bearings `u` and `v`, the corner
//! fillet of radius R is tangent to both legs at a setback
//!
//! ```text
//!     t    = R / tan(θ/2)        θ = interior angle between the legs
//!     dist = R / sin(θ/2)        centre distance from J along the bisector
//! ```
//!
//! Shallow θ blows `t` up (tan(θ/2) → 0), so a hairpin's fillet would swallow
//! the whole leg — that guard is [`MIN_TURN`].
//!
//! ## What this pass draws from the rng
//!
//! NOTHING. It is pure geometry over pass 1's graph, so the cumulative draw
//! count at the `track-path` boundary equals the one at `grow-track`. That
//! makes the draw counter useless as a localiser here and puts the entire
//! weight of the gate on the geometry digests — which is why the exporter had
//! to grow a leg/arc digest before this port could be trusted (the fixture used
//! to pin `{ legs: N }` and nothing else, and a count is not a digest).
//!
//! ## What this port has to get exactly right
//!
//! 1. **Adjacency is a JS `Map` and its ITERATION ORDER is insertion order.**
//!    Nodes enter it in edge order, `e.a` before `e.b`, and the `pending` list
//!    — hence the arc authoring order, which `compact_arcs` later indexes
//!    against — is built by walking it. A `HashMap` here reorders the arcs of
//!    an otherwise perfect floor. [`Adjacency`] is that container.
//! 2. **`Math.tan` and `Math.atan2`.** Two more V8 primitives, and neither was
//!    covered by the existing sweep set — both were added to it for this port.
//!    `libm` is the implementation both agree with and STD IS NOT, which the
//!    corpus confirms independently: swapping `libm::tan` for `f64::tan` moves
//!    L3 seed 1's legs, and `libm::atan2` for `f64::atan2` moves L1 seed 1's.
//!    Do not read that as "trig is libm here" — `cos`/`sin` need the twins on
//!    this very pass, and `tan` shares their argument reduction.
//! 3. **Two passes over `pending`, and the order is load-bearing.** Every
//!    setback is settled BEFORE any arc is built. The legacy comment records
//!    what a one-pass version measured: 10.3% of arc endpoints unmatched, worst
//!    gap 3.2 tiles.
//!
//! ## What the corpus at this boundary provably does NOT discriminate
//!
//! Measured, not assumed, because "ten floors are green" is not the same claim
//! as "every call is right":
//!
//!  · **`js_hypot` vs `libm::hypot` — invisible here.** They differ on 266 of
//!    the 790 hypot calls this pass makes across the corpus (34%), and swapping
//!    one for the other changes NO pinned digest. `Math.hypot` never reaches a
//!    coordinate in this pass: it feeds `budget` and the `sa + sb >= len - 0.5`
//!    test, both of which are inequalities, and a 1-ulp shift flipped neither
//!    on any of the ten floors. `js_hypot` is still what is called — the twin
//!    is the required call, and pass 3 onward puts these lengths into geometry
//!    where a corpus CAN see them.
//!  · **`js_cos`/`js_sin` are only just visible.** They differ from `libm`'s on
//!    8 of 790 leg bearings, and the swap survives five corpus floors before
//!    L8 seed 1 catches it. The mechanism is absorption: a 1-ulp error in
//!    `cos(ang)` scaled by a ≤7-tile setback is ~8e-16, against a ~3.6e-15 ulp
//!    on the 30-tile coordinate it is added to, so it usually rounds away. A
//!    corpus that happened to stop at L5 would have called `libm::cos` correct.
//!
//! Also true, and the reason `js_hypot`'s argument order is still written to
//! match the legacy call sites: V8's hypot is a compensated sum, so
//! `js_hypot(dx, dz)` and `js_hypot(dz, dx)` are not interchangeable.
//!
//! PORTS: `maze/track-path.ts`

use crate::jsmath::{js_cos, js_hypot, js_sin};
use crate::maze::track_grow::TrackGraph;
use crate::tile_shape::ArcFeature;
use std::collections::{HashMap, HashSet};

/// A single rideable leg of the circuit: a straight run between two fillets.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TrackLeg {
    /// Endpoints in tile space, already pulled back by the fillet setbacks.
    pub x0: f64,
    pub z0: f64,
    pub x1: f64,
    pub z1: f64,
    /// Which graph nodes this leg runs between (for on-ramp siting later).
    pub a: usize,
    pub b: usize,
    /// Lane half-width in tiles — wider on the busiest tubes.
    pub half: f64,
}

/// The circuit as rideable geometry.
///
/// No `PartialEq`: `ArcFeature` has none, and comparing two paths field-by-
/// field is not what this port checks anyway — [`digest_legs`] and
/// `digest::digest_arcs` are, because a bitwise digest is what the oracle pins.
#[derive(Clone, Debug, Default)]
pub struct TrackPath {
    pub legs: Vec<TrackLeg>,
    /// Junction fillets, as engine-native arc descriptors.
    pub arcs: Vec<ArcFeature>,
    /// Half-width the CARVER must sweep every fillet at, in tiles.
    ///
    /// It rides here rather than being a constant in `carve_track` because it
    /// has to track `lane_scale`: widening the straights without widening the
    /// corners turns every junction into a funnel, and a ball carrying pinball
    /// momentum into a funnel wedges. One number, one owner.
    pub arc_half: f64,
}

/// Junctions shallower than this are straightened rather than filleted.
///
/// At θ below ~35° the setback `t = R/tan(θ/2)` exceeds 3R and the fillet eats
/// the whole leg — the two straights vanish and the "corner" becomes a long
/// lazy drift that reads as a kink, not a curve.
///
/// Written as the legacy expression rather than as a decimal literal: `35 *
/// Math.PI / 180` is two IEEE operations in a fixed order and the nearest
/// double to 35π/180 is not necessarily the same bit pattern.
pub const MIN_TURN: f64 = (35.0 * std::f64::consts::PI) / 180.0;

/// Corner radii, tried largest-first.
///
/// LARGE compared to the shipped fillets (`[3, 2]` in `arc-sweeps`) and that is
/// the point: a radius-6 quarter-turn is 9.4 tiles of arc against the shipped
/// 3.1. We can ask for it because the space is allocated before the maze
/// exists.
///
/// ⚠️ DESCENDING is not decoration. The search below takes the FIRST radius
/// that fits, and the clamp in pass 2b reads `radii[0]` as "the largest".
pub const TRACK_RADII: [f64; 5] = [7.0, 6.0, 5.0, 4.0, 3.0];

/// Lane half-widths. The busiest tubes become the widest highways.
pub const LANE_HALF_TRUNK: f64 = 2.5;
pub const LANE_HALF_MAIN: f64 = 2.0;
pub const LANE_HALF_SPUR: f64 = 1.5;

const TAU: f64 = std::f64::consts::PI * 2.0;

/// Shortest signed angular difference b−a, wrapped to (−π, π].
///
/// JS `%` on doubles is C `fmod` — truncated, sign of the dividend — and Rust's
/// `%` on `f64` is the same operation, so this is a transcription and not a
/// re-derivation. (`rem_euclid` is NOT it, and would wrap the negative half
/// wrongly.)
pub fn ang_diff(a: f64, b: f64) -> f64 {
    let mut d = (b - a) % TAU;
    if d > std::f64::consts::PI {
        d -= TAU;
    }
    if d <= -std::f64::consts::PI {
        d += TAU;
    }
    d
}

/// Options `build_track_floor` hands the path stage.
#[derive(Clone, Debug, Default)]
pub struct TrackPathOpts<'a> {
    /// Radii to try, largest first. `None` = [`TRACK_RADII`].
    pub radii: Option<&'a [f64]>,
    /// Multiplier on every lane half-width. `None` = 1.
    pub lane_scale: Option<f64>,
}

/// One leg leaving a junction, with the bearing it leaves on.
#[derive(Clone, Copy, Debug)]
struct AdjLeg {
    to: usize,
    ang: f64,
    /// Conductivity of the tube. Carried because the legacy record carries it;
    /// nothing downstream of the sort reads it.
    #[allow(dead_code)]
    d: f64,
}

/// The JS `Map<number, AdjLeg[]>` this pass walks, INSERTION-ORDERED.
///
/// A `HashMap` would give the same adjacency and a different `pending` list,
/// and `pending` order is the order the arcs are authored in — which
/// `compact_arcs` remaps `arc_idx` against three passes later. So the container
/// is the contract, exactly as `InsertionSet` is in `track_grow`.
#[derive(Default)]
struct Adjacency {
    slots: Vec<(usize, Vec<AdjLeg>)>,
    index: HashMap<usize, usize>,
}

impl Adjacency {
    /// `if (!adj.has(k)) adj.set(k, [])` — first touch fixes the position.
    fn ensure(&mut self, k: usize) -> usize {
        *self.index.entry(k).or_insert_with(|| {
            self.slots.push((k, Vec::new()));
            self.slots.len() - 1
        })
    }

    fn push(&mut self, k: usize, leg: AdjLeg) {
        let at = self.ensure(k);
        self.slots[at].1.push(leg);
    }
}

/// A junction pair that survived the radius search, awaiting the settled
/// setback. `L0`/`L1` are the two consecutive legs in bearing order.
struct Pending {
    nid: usize,
    l0: AdjLeg,
    l1: AdjLeg,
    theta: f64,
}

/// Order the edges around each node by bearing, then fillet consecutive pairs.
///
/// A node of degree 2 is a simple corner. Degree 3+ is a real junction, and
/// each ADJACENT pair of legs (in bearing order) gets its own fillet — that is
/// what makes a junction rideable from any approach rather than only along one
/// favoured pair. Non-adjacent pairs are skipped: their fillets would cross the
/// junction interior and overlap each other.
// `manual_range_contains` fires on the `theta < MIN_TURN || theta > π − 1e-6`
// guard and its suggestion is WRONG here on two counts. It inverts a
// float-comparison pair into `!(..).contains(&theta)`, which flips the NaN
// answer — two `<`/`>` tests are both false on NaN so the legacy guard does not
// fire, and `!contains` is true so the rewrite does. And it hides the shape of
// the transcription: this line is `if (theta < MIN_TURN || theta > Math.PI -
// 1e-6) continue;` and its value is that it can be read against the TypeScript
// word for word.
#[allow(clippy::manual_range_contains)]
pub fn build_track_path(g: &TrackGraph, opts: &TrackPathOpts<'_>) -> TrackPath {
    let radii: &[f64] = opts.radii.unwrap_or(&TRACK_RADII);
    // Clamped: below ~0.6 the lane is narrower than the ball's own manoeuvring
    // room, and above ~2 a trunk road paves the floor on its own.
    let lane_scale = opts.lane_scale.unwrap_or(1.0).clamp(0.6, 2.0);

    let by_id: HashMap<usize, usize> = g.nodes.iter().enumerate().map(|(k, n)| (n.id, k)).collect();
    // ⚠️ `new Map(g.nodes.map(...))` keeps the LAST node for a duplicate id;
    // `HashMap::from_iter` does too. Same tie-break, stated so it is a decision
    // rather than a coincidence.
    let node = |id: usize| by_id.get(&id).map(|&k| &g.nodes[k]);

    let mut max_d = 1e-9_f64;
    for e in &g.edges {
        max_d = max_d.max(e.d);
    }

    // ── Adjacency with bearings ─────────────────────────────────────────────
    let mut adj = Adjacency::default();
    for e in &g.edges {
        let (Some(a), Some(b)) = (node(e.a), node(e.b)) else {
            continue;
        };
        // Both slots are created before either is pushed to, exactly as the two
        // `if (!adj.has(...))` guards do — `e.a` first, then `e.b`.
        adj.ensure(e.a);
        adj.ensure(e.b);
        adj.push(
            e.a,
            AdjLeg {
                to: e.b,
                ang: libm::atan2(b.z - a.z, b.x - a.x),
                d: e.d,
            },
        );
        adj.push(
            e.b,
            AdjLeg {
                to: e.a,
                ang: libm::atan2(a.z - b.z, a.x - b.x),
                d: e.d,
            },
        );
    }
    for (_, list) in &mut adj.slots {
        // `sort((p, q) => p.ang - q.ang)`. V8's sort is TimSort and stable, and
        // Rust's `sort_by` is stable, so equal bearings keep insertion order —
        // which is edge order, which is what decides the pairing at a node with
        // two collinear tubes. `atan2` of finite inputs is never NaN, so the
        // JS "NaN comparator result counts as 0" path is unreachable; it is
        // spelled out anyway rather than left to `unwrap`.
        list.sort_by(|p, q| {
            p.ang
                .partial_cmp(&q.ang)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    }

    // ── PASS 1 — the radius search ──────────────────────────────────────────
    //
    // Per-node, per-leg setback: how far back from the junction this leg's
    // straight must stop so the fillets have room. TWO PASSES, and the ordering
    // is load-bearing. A single pass that emitted each arc as it was computed
    // produced arcs whose tangent points no longer touched their legs: at a
    // degree-3+ junction the shared leg ends up with the MAX setback, but an
    // arc built earlier had already committed to its own smaller `t`. Measured
    // on the one-pass version: 10.3% of arc endpoints unmatched, worst gap 3.2
    // tiles. So: resolve all setbacks first, then build every arc against the
    // FINAL value.
    let mut pending: Vec<Pending> = Vec::new();
    /// One setback per JUNCTION, not per leg. Every fillet at a node shares it,
    /// so the arcs stay mutually consistent and each one's tangent point is
    /// exactly where its legs stop. (Per-leg maxima looked more precise but let
    /// one leg pair inflate a neighbour's radius — re-deriving R from a
    /// borrowed setback produced radii up to r=2161 on shallow junctions.)
    type NodeSetback = HashMap<usize, f64>;
    let mut node_t: NodeSetback = HashMap::new();

    for (nid, legs) in &adj.slots {
        let Some(j) = node(*nid) else { continue };
        if legs.len() < 2 {
            continue;
        }
        for k in 0..legs.len() {
            // Only consecutive pairs in bearing order (and skip the wrap pair
            // when degree is 2 — a 2-leg node has exactly ONE corner).
            if legs.len() == 2 && k == 1 {
                break;
            }
            let l0 = legs[k];
            let l1 = legs[(k + 1) % legs.len()];

            // Interior angle between the two legs as they LEAVE the junction —
            // both bearings point away from J.
            let theta = ang_diff(l0.ang, l1.ang).abs();
            if theta < MIN_TURN || theta > std::f64::consts::PI - 1e-6 {
                continue; // too shallow / straight through
            }

            let half_t = libm::tan(theta / 2.0);
            if half_t < 1e-6 {
                continue;
            }

            // Longest available leg lengths bound how much setback we can
            // afford. Argument order mirrors the legacy `Math.hypot` calls —
            // V8's compensated sum is order-sensitive.
            let a0 = node(l0.to).expect("adjacency only names nodes that exist");
            let a1 = node(l1.to).expect("adjacency only names nodes that exist");
            let len0 = js_hypot(a0.x - j.x, a0.z - j.z);
            let len1 = js_hypot(a1.x - j.x, a1.z - j.z);
            let budget = len0.min(len1) * 0.42; // leave most of each leg straight

            let mut chosen = false;
            let mut t = 0.0_f64;
            for &r in radii {
                let need = r / half_t;
                if need <= budget {
                    chosen = true;
                    t = need;
                    break;
                }
            }
            if !chosen {
                continue; // no radius fits — leave it a sharp junction
            }

            pending.push(Pending {
                nid: *nid,
                l0,
                l1,
                theta,
            });
            let slot = node_t.entry(*nid).or_insert(0.0);
            *slot = slot.max(t);
        }
    }

    // Settle: every leg leaving a junction pulls back by that junction's
    // setback. Keyed `(node, to)` — the legacy `` `${n}>${to}` `` string, which
    // is a lookup table and never iterated, so a hash map is faithful here.
    let mut setback: HashMap<(usize, usize), f64> = HashMap::new();
    for p in &pending {
        let t = node_t.get(&p.nid).copied().unwrap_or(0.0);
        for to in [p.l0.to, p.l1.to] {
            let slot = setback.entry((p.nid, to)).or_insert(0.0);
            *slot = slot.max(t);
        }
    }

    // ── PASS 2a — the LEGS, so pass 2b knows which survived ─────────────────
    //
    // Order matters: a short edge can be entirely eaten by the fillets at its
    // two ends and drop out. An arc tangent to a leg that no longer exists is a
    // curve floating in space attached to nothing — exactly the orphaned-
    // fragment look this rework is meant to end — so arcs are emitted only for
    // live legs.
    let mut legs: Vec<TrackLeg> = Vec::new();
    let mut live_edge: HashSet<(usize, usize)> = HashSet::new();
    let edge_key = |a: usize, b: usize| (a.min(b), a.max(b));
    for e in &g.edges {
        let (Some(a), Some(b)) = (node(e.a), node(e.b)) else {
            continue;
        };
        let ang = libm::atan2(b.z - a.z, b.x - a.x);
        let sa = setback.get(&(e.a, e.b)).copied().unwrap_or(0.0);
        let sb = setback.get(&(e.b, e.a)).copied().unwrap_or(0.0);
        let len = js_hypot(b.x - a.x, b.z - a.z);
        if sa + sb >= len - 0.5 {
            continue; // fully consumed by its own fillets
        }
        let rel = e.d / max_d;
        live_edge.insert(edge_key(e.a, e.b));
        legs.push(TrackLeg {
            x0: a.x + js_cos(ang) * sa,
            z0: a.z + js_sin(ang) * sa,
            x1: b.x - js_cos(ang) * sb,
            z1: b.z - js_sin(ang) * sb,
            a: e.a,
            b: e.b,
            // Conductivity IS traffic, so the busiest tube becomes the widest
            // road. This is the visual payoff of the growth model: highway
            // hierarchy comes out of the simulation instead of being assigned.
            half: (if rel > 0.66 {
                LANE_HALF_TRUNK
            } else if rel > 0.28 {
                LANE_HALF_MAIN
            } else {
                LANE_HALF_SPUR
            }) * lane_scale,
        });
    }

    // ── PASS 2b — the ARCS ──────────────────────────────────────────────────
    //
    // Against the settled setbacks, and only where both filleted legs survived.
    let mut arcs: Vec<ArcFeature> = Vec::new();
    for p in &pending {
        let j = node(p.nid).expect("pending only names nodes that exist");
        let t = node_t.get(&p.nid).copied().unwrap_or(0.0);
        if t <= 1e-6 {
            continue;
        }
        if !live_edge.contains(&edge_key(p.nid, p.l0.to))
            || !live_edge.contains(&edge_key(p.nid, p.l1.to))
        {
            continue;
        }
        // R follows from the shared setback and THIS pair's angle, so the arc
        // is tangent to both legs exactly where they stop. Clamped to the
        // authored range: an unclamped R at a very shallow pair runs to
        // hundreds of tiles, which is a straight line pretending to be a curve.
        let r = radii[0].min((t * libm::tan(p.theta / 2.0)).max(1.0));
        if r < 1.0 {
            // ⚠️ UNREACHABLE, and transcribed anyway. `max(1.0)` above already
            // guarantees `r >= 1`, so the legacy `if (R < 1) continue` can only
            // fire on NaN — where `<` is false and it does not fire either. It
            // is kept because deleting a guard is a change to the source of
            // truth, and the port's job is to be diffable against it.
            continue;
        }

        let bis = p.l0.ang + ang_diff(p.l0.ang, p.l1.ang) / 2.0;
        let dist = r / js_sin(p.theta / 2.0);
        let cx = j.x + js_cos(bis) * dist;
        let cz = j.z + js_sin(bis) * dist;

        let p0x = j.x + js_cos(p.l0.ang) * t;
        let p0z = j.z + js_sin(p.l0.ang) * t;
        let p1x = j.x + js_cos(p.l1.ang) * t;
        let p1z = j.z + js_sin(p.l1.ang) * t;
        let a0 = libm::atan2(p0z - cz, p0x - cx);
        let a1 = libm::atan2(p1z - cz, p1x - cx);
        let mut span = ang_diff(a0, a1);
        let start = if span >= 0.0 { a0 } else { a1 };
        span = span.abs();
        if span < 1e-3 {
            continue;
        }

        arcs.push(ArcFeature {
            cx,
            cz,
            r,
            a0: start,
            span,
            // Solid INSIDE: the ball sweeps around the OUTSIDE of the fillet,
            // which is the NASCAR high line the artery-banks census argued for.
            solid_out: false,
            owner: None,
            kicks: Vec::new(),
            lanes: Vec::new(),
        });
    }

    TrackPath {
        legs,
        arcs,
        arc_half: 2.0 * lane_scale,
    }
}

/// Total rideable straight length — a sanity metric for tests.
pub fn total_leg_length(p: &TrackPath) -> f64 {
    p.legs
        .iter()
        .fold(0.0, |s, l| s + js_hypot(l.x1 - l.x0, l.z1 - l.z0))
}

/// Total arc length across every fillet, in tiles.
pub fn total_arc_length(p: &TrackPath) -> f64 {
    p.arcs.iter().fold(0.0, |s, a| s + a.r * a.span)
}

// ── PARITY DIGEST ────────────────────────────────────────────────────────────

/// Digest the LEGS in emission order — endpoints, node ids and lane width.
///
/// Twin of `digestLegs` in the legacy exporter, and the reason the exporter
/// grew one: before this, the only thing pinned at the `track-path` boundary
/// was `{ legs: N }`. A count cannot tell a leg that starts a tile early from
/// one that starts where it should, and this pass draws no rng at all — so the
/// draw counter, the localiser every other pass leans on, says nothing here.
///
/// Order is part of the signal: the leg list is walked in order by `carve_track`
/// and the on-ramp siting reads `a`/`b`, so two legs swapped is a different
/// floor even when every number in the list is right.
pub fn digest_legs(legs: &[TrackLeg]) -> u32 {
    let mut h = crate::maze::digest::Fnv1a::new();
    for l in legs {
        for v in [l.x0, l.z0, l.x1, l.z1] {
            h.f64(v);
        }
        h.count(l.a);
        h.count(l.b);
        h.f64(l.half);
    }
    h.count(legs.len()).finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::maze::track_grow::{TrackEdge, TrackNode};

    fn node(id: usize, x: f64, z: f64) -> TrackNode {
        TrackNode {
            id,
            x,
            z,
            food: false,
        }
    }

    fn edge(a: usize, b: usize, d: f64, len: f64) -> TrackEdge {
        TrackEdge { a, b, d, len }
    }

    /// The wrap semantics `build_track_path` leans on: `angDiff` is the JS
    /// truncated `%`, not a Euclidean remainder, and the half-open interval is
    /// (−π, π] — π maps to itself, −π maps to π.
    #[test]
    fn ang_diff_wraps_to_the_half_open_turn() {
        assert_eq!(ang_diff(0.0, 0.0), 0.0);
        assert_eq!(ang_diff(0.0, std::f64::consts::PI), std::f64::consts::PI);
        assert_eq!(ang_diff(0.0, -std::f64::consts::PI), std::f64::consts::PI);
        assert!((ang_diff(3.0, -3.0) - (TAU - 6.0)).abs() < 1e-12);
        assert!((ang_diff(-3.0, 3.0) - (6.0 - TAU)).abs() < 1e-12);
        // Many turns out, still inside the interval.
        for k in -5..=5 {
            let d = ang_diff(0.4, 0.4 + 1.1 + TAU * f64::from(k));
            assert!((d - 1.1).abs() < 1e-9, "k={k} gave {d}");
        }
    }

    /// A right-angle corner, by hand: two legs of length 20 meeting at 90°.
    /// θ = π/2, so t = R/tan(π/4) = R and the budget is 20·0.42 = 8.4, which
    /// admits R = 7 — the largest authored radius.
    #[test]
    fn a_right_angle_corner_takes_the_largest_radius_that_fits() {
        let g = TrackGraph {
            nodes: vec![node(0, 0.0, 0.0), node(1, 20.0, 0.0), node(2, 0.0, 20.0)],
            edges: vec![edge(0, 1, 1.0, 20.0), edge(0, 2, 1.0, 20.0)],
        };
        let p = build_track_path(&g, &TrackPathOpts::default());
        assert_eq!(p.arcs.len(), 1, "one corner, one fillet");
        assert!((p.arcs[0].r - 7.0).abs() < 1e-9, "r={}", p.arcs[0].r);
        // A quarter turn.
        assert!(
            (p.arcs[0].span - std::f64::consts::FRAC_PI_2).abs() < 1e-9,
            "span={}",
            p.arcs[0].span
        );
        // Both legs pulled back by t = R = 7 at node 0 only.
        assert_eq!(p.legs.len(), 2);
        assert!((p.legs[0].x0 - 7.0).abs() < 1e-9);
        assert!((p.legs[0].x1 - 20.0).abs() < 1e-9);
        assert_eq!(p.arc_half, 2.0);
    }

    /// The straight-through guard. Two collinear legs are θ = π, which the
    /// `π − 1e-6` test rejects: filleting a straight is a fillet of radius 0.
    #[test]
    fn a_straight_through_node_is_not_filleted() {
        let g = TrackGraph {
            nodes: vec![node(0, 0.0, 0.0), node(1, 20.0, 0.0), node(2, -20.0, 0.0)],
            edges: vec![edge(0, 1, 1.0, 20.0), edge(0, 2, 1.0, 20.0)],
        };
        let p = build_track_path(&g, &TrackPathOpts::default());
        assert!(p.arcs.is_empty(), "a straight line got a corner");
        // …and with no setback anywhere, both legs run their full length.
        assert_eq!(p.legs.len(), 2);
        assert!((total_leg_length(&p) - 40.0).abs() < 1e-9);
    }

    /// The hairpin guard, `MIN_TURN`. Two legs leaving 20° apart would need
    /// `t = R/tan(10°)` ≈ 5.7R of setback, so they are straightened instead.
    #[test]
    fn a_hairpin_below_min_turn_is_straightened() {
        let a = 20.0_f64.to_radians();
        let g = TrackGraph {
            nodes: vec![
                node(0, 0.0, 0.0),
                node(1, 30.0, 0.0),
                node(2, 30.0 * a.cos(), 30.0 * a.sin()),
            ],
            edges: vec![edge(0, 1, 1.0, 30.0), edge(0, 2, 1.0, 30.0)],
        };
        assert!(a < MIN_TURN, "the fixture must be inside the guard");
        let p = build_track_path(&g, &TrackPathOpts::default());
        assert!(p.arcs.is_empty(), "a 20° hairpin was filleted");
    }

    /// `laneScale` multiplies the lane half-widths AND `arcHalf`, and is
    /// clamped to [0.6, 2] — widening the straights without the corners turns
    /// every junction into a funnel.
    #[test]
    fn lane_scale_is_clamped_and_reaches_both_widths() {
        let g = TrackGraph {
            nodes: vec![node(0, 0.0, 0.0), node(1, 20.0, 0.0)],
            edges: vec![edge(0, 1, 1.0, 20.0)],
        };
        let wide = build_track_path(
            &g,
            &TrackPathOpts {
                radii: None,
                lane_scale: Some(9.0),
            },
        );
        assert_eq!(wide.arc_half, 4.0, "clamped at 2");
        // rel = d/maxD = 1 > 0.66 → trunk.
        assert_eq!(wide.legs[0].half, LANE_HALF_TRUNK * 2.0);
        let tight = build_track_path(
            &g,
            &TrackPathOpts {
                radii: None,
                lane_scale: Some(0.0),
            },
        );
        assert_eq!(tight.arc_half, 1.2, "clamped at 0.6");
    }

    /// The lane-width tiers come off `d / maxD`, so the widest tube sets the
    /// scale and everything else is measured against it.
    #[test]
    fn lane_width_tiers_follow_relative_conductivity() {
        let g = TrackGraph {
            nodes: vec![
                node(0, 0.0, 0.0),
                node(1, 20.0, 0.0),
                node(2, 0.0, 20.0),
                node(3, -20.0, 0.0),
            ],
            edges: vec![
                edge(0, 1, 1.0, 20.0),  // rel 1.00 → trunk
                edge(0, 2, 0.5, 20.0),  // rel 0.50 → main
                edge(0, 3, 0.10, 20.0), // rel 0.10 → spur
            ],
        };
        let p = build_track_path(&g, &TrackPathOpts::default());
        let halves: Vec<f64> = p.legs.iter().map(|l| l.half).collect();
        assert_eq!(
            halves,
            vec![LANE_HALF_TRUNK, LANE_HALF_MAIN, LANE_HALF_SPUR]
        );
    }

    /// The property `track-system.test.ts` pins on the shipping generator, on a
    /// hand-built corner: an arc's endpoints must LAND on the legs it joins.
    /// A fillet floating free of the track is the orphaned-fragment artefact
    /// the whole track-first rework exists to remove.
    #[test]
    fn arc_endpoints_land_on_the_legs_they_join() {
        // A three-way junction with the legs 120° apart and all the same
        // length, so every pair asks for the SAME setback and no arc has to
        // borrow a bigger one — see the clamp test below for what happens when
        // they do differ.
        let leg = |deg: f64| {
            let a: f64 = deg.to_radians();
            (40.0 * a.cos(), 40.0 * a.sin())
        };
        let (x1, z1) = leg(90.0);
        let (x2, z2) = leg(210.0);
        let (x3, z3) = leg(330.0);
        let g = TrackGraph {
            nodes: vec![
                node(0, 0.0, 0.0),
                node(1, x1, z1),
                node(2, x2, z2),
                node(3, x3, z3),
            ],
            edges: vec![
                edge(0, 1, 1.0, 40.0),
                edge(0, 2, 1.0, 40.0),
                edge(0, 3, 1.0, 40.0),
            ],
        };
        let p = build_track_path(&g, &TrackPathOpts::default());
        assert_eq!(p.arcs.len(), 3, "three legs, three consecutive pairs");
        let ends: Vec<(f64, f64)> = p
            .legs
            .iter()
            .flat_map(|l| [(l.x0, l.z0), (l.x1, l.z1)])
            .collect();
        for a in &p.arcs {
            for ang in [a.a0, a.a0 + a.span] {
                let x = a.cx + js_cos(ang) * a.r;
                let z = a.cz + js_sin(ang) * a.r;
                let near = ends
                    .iter()
                    .map(|&(ex, ez)| js_hypot(ex - x, ez - z))
                    .fold(f64::INFINITY, f64::min);
                assert!(near < 1e-9, "arc endpoint {x},{z} floats {near} off a leg");
            }
        }
    }

    /// ⚠️ A PROPERTY OF THE ORIGINAL, pinned so the port is not blamed for it.
    ///
    /// One setback per JUNCTION plus a radius CLAMPED to `radii[0]` cannot both
    /// hold at a junction whose pairs turn through different angles. The arc for
    /// a pair that did not set the junction's `t` re-derives
    /// `R = t·tan(θ/2)`, and when that exceeds 7 the clamp takes 7 — at which
    /// point the arc is no longer tangent to the legs it was built for and its
    /// endpoints sit off them.
    ///
    /// Measured on the fixture below: 1.81 tiles, which is PAST the 1.2-tile
    /// threshold the legacy test (`track-system.test.ts`, "arcs are TANGENT to
    /// the legs they join") counts as a floating fragment. That test survives
    /// because it is statistical — it allows 6% of endpoints past 1.2 — so this
    /// is authored behaviour rather than a regression, and the carver's 4-5
    /// tile lane covers it. Recorded because "arc endpoints land on legs" reads
    /// like an invariant, is asserted like one, and is not one.
    #[test]
    fn the_radius_clamp_breaks_tangency_for_a_junctions_non_maximal_pair() {
        let g = TrackGraph {
            nodes: vec![
                node(0, 30.0, 30.0),
                node(1, 30.0, 0.0),
                node(2, 0.0, 30.0),
                node(3, 60.0, 45.0),
            ],
            edges: vec![
                edge(0, 1, 1.0, 30.0),
                edge(0, 2, 1.0, 30.0),
                edge(0, 3, 1.0, 33.5),
            ],
        };
        let p = build_track_path(&g, &TrackPathOpts::default());
        let ends: Vec<(f64, f64)> = p
            .legs
            .iter()
            .flat_map(|l| [(l.x0, l.z0), (l.x1, l.z1)])
            .collect();
        let worst = p
            .arcs
            .iter()
            .flat_map(|a| {
                [a.a0, a.a0 + a.span].map(|ang| {
                    let x = a.cx + js_cos(ang) * a.r;
                    let z = a.cz + js_sin(ang) * a.r;
                    ends.iter()
                        .map(|&(ex, ez)| js_hypot(ex - x, ez - z))
                        .fold(f64::INFINITY, f64::min)
                })
            })
            .fold(0.0_f64, f64::max);
        // The right-angle pair sets t = 7; the 116.6° pair would need R = 11.34
        // to stay tangent to it and is clamped back to 7.
        assert!(
            p.arcs.iter().any(|a| a.r == TRACK_RADII[0]),
            "the fixture no longer reaches the clamp"
        );
        assert!(
            (1.7..1.9).contains(&worst),
            "the tangency gap moved: {worst} (was 1.81 tiles)"
        );
        assert!(
            worst > 1.2,
            "…and 1.2 is what the legacy tangency test calls a floating fragment"
        );
    }

    /// Radii stay inside the authored range. Re-deriving R from a shared
    /// setback once produced radii up to 2161 tiles on shallow junctions — a
    /// straight line pretending to be a curve — which is what the `radii[0]`
    /// clamp in pass 2b exists to stop.
    #[test]
    fn every_radius_stays_inside_the_authored_range() {
        // A degree-4 junction: four legs, four consecutive pairs, one shared
        // setback. The shallow pairs are the ones that used to blow up.
        let g = TrackGraph {
            nodes: vec![
                node(0, 40.0, 40.0),
                node(1, 80.0, 41.0),
                node(2, 78.0, 60.0),
                node(3, 40.0, 5.0),
                node(4, 5.0, 44.0),
            ],
            edges: vec![
                edge(0, 1, 1.0, 40.0),
                edge(0, 2, 0.8, 42.0),
                edge(0, 3, 0.6, 35.0),
                edge(0, 4, 0.4, 35.2),
            ],
        };
        let p = build_track_path(&g, &TrackPathOpts::default());
        assert!(!p.arcs.is_empty());
        for a in &p.arcs {
            assert!(a.r >= 1.0, "r={} below the floor", a.r);
            assert!(a.r <= TRACK_RADII[0] + 1e-6, "r={} above the cap", a.r);
            assert!(a.span.is_finite() && a.span > 0.0, "span={}", a.span);
        }
        assert!(total_arc_length(&p) > 0.0);
    }

    /// A leg shorter than the fillets at its two ends drops out entirely, and
    /// the arcs that would have been tangent to it drop out with it.
    #[test]
    fn a_leg_eaten_by_its_own_fillets_takes_its_arcs_with_it() {
        // The setback is ONE PER JUNCTION, so a short leg is pulled back by
        // whatever the node's WIDEST pair asked for — not by its own budget.
        // Here node 0's 20°-apart pair (nodes 2 and 3, 50 tiles each) needs
        // t = 7/tan(10°) = 19.2, and the 12-tile leg to node 1 inherits it.
        //
        // This is the only way the drop can happen: a leg's own pair can never
        // eat it, because that pair's budget is capped at 0.42 × the shorter
        // leg and two such setbacks come to 0.84 L < L − 0.5.
        let at = |deg: f64, r: f64| {
            let a: f64 = deg.to_radians();
            (r * a.cos(), r * a.sin())
        };
        let (x2, z2) = at(60.0, 50.0);
        let (x3, z3) = at(20.0, 50.0);
        let g = TrackGraph {
            nodes: vec![
                node(0, 0.0, 0.0),
                node(1, -12.0, 0.0),
                node(2, x2, z2),
                node(3, x3, z3),
            ],
            edges: vec![
                edge(0, 1, 1.0, 12.0),
                edge(0, 2, 1.0, 50.0),
                edge(0, 3, 1.0, 50.0),
            ],
        };
        let p = build_track_path(&g, &TrackPathOpts::default());
        let live: HashSet<(usize, usize)> = p
            .legs
            .iter()
            .map(|l| (l.a.min(l.b), l.a.max(l.b)))
            .collect();
        assert!(
            !live.contains(&(0, 1)),
            "the 12-tile leg survived the junction's 19.2-tile setback"
        );
        assert_eq!(live.len(), 2, "the two long legs must still be there");
        // Three pairs were pending; the two that touch the dead leg lose their
        // arcs, and only the pair that set the setback keeps one.
        assert_eq!(
            p.arcs.len(),
            1,
            "an arc outlived the leg it was tangent to: {:?}",
            p.arcs.iter().map(|a| (a.cx, a.cz, a.r)).collect::<Vec<_>>()
        );
    }

    /// A degree-2 node has exactly ONE corner, not two — the wrap pair is
    /// skipped. Without the guard every simple corner would author its fillet
    /// twice and `compact_arcs` would index a duplicated list.
    #[test]
    fn a_degree_two_node_authors_one_fillet_not_two() {
        let g = TrackGraph {
            nodes: vec![node(0, 0.0, 0.0), node(1, 30.0, 0.0), node(2, 0.0, 30.0)],
            edges: vec![edge(0, 1, 1.0, 30.0), edge(0, 2, 1.0, 30.0)],
        };
        let p = build_track_path(&g, &TrackPathOpts::default());
        assert_eq!(p.arcs.len(), 1);
    }

    /// Adjacency iteration is INSERTION order — first touch by edge order, `a`
    /// before `b` — and that order is the order the arcs come out in. This is
    /// the assertion that fails if the container is ever swapped for a HashMap.
    #[test]
    fn arcs_are_authored_in_node_first_touch_order() {
        // Node 5 is touched first (edge 0 names it as `a`), then 1, then 9.
        // Both 5 and 9 are corners; 1 is a straight-through.
        let g = TrackGraph {
            nodes: vec![
                node(5, 0.0, 0.0),
                node(1, 30.0, 0.0),
                node(9, 60.0, 0.0),
                node(7, 0.0, 30.0),
                node(3, 60.0, 30.0),
            ],
            edges: vec![
                edge(5, 1, 1.0, 30.0),
                edge(1, 9, 1.0, 30.0),
                edge(5, 7, 1.0, 30.0),
                edge(9, 3, 1.0, 30.0),
            ],
        };
        let p = build_track_path(&g, &TrackPathOpts::default());
        assert_eq!(p.arcs.len(), 2, "two corners");
        // Node 5 sits at the origin, node 9 at x=60: the first arc's centre
        // must be the one near 5.
        assert!(
            p.arcs[0].cx < p.arcs[1].cx,
            "arc order followed the hash, not the first-touch order: {:?}",
            p.arcs.iter().map(|a| a.cx).collect::<Vec<_>>()
        );
    }

    /// The digest's own claim: a leg list that differs only in ORDER, or only
    /// in one endpoint's last bit, must not collide.
    #[test]
    fn the_leg_digest_sees_order_and_the_last_bit() {
        let a = TrackLeg {
            x0: 1.0,
            z0: 2.0,
            x1: 3.0,
            z1: 4.0,
            a: 0,
            b: 1,
            half: 2.0,
        };
        let mut b = a;
        b.a = 1;
        b.b = 0;
        assert_ne!(digest_legs(&[a, b]), digest_legs(&[b, a]));
        let mut c = a;
        c.x0 = f64::from_bits(a.x0.to_bits() + 1);
        assert_ne!(digest_legs(&[a]), digest_legs(&[c]));
        assert_ne!(digest_legs(&[]), digest_legs(&[a]));
    }
}
