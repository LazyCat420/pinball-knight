//! TRACK GROWTH — the circuit is GROWN, not scavenged. Pass 1 of 23.
//!
//! Port of `legacy/src/game/pinball-knight/maze/track-grow.ts`.
//!
//! ## Why slime mould
//!
//! The shipped pipeline used to author the maze first and then go looking for a
//! racing line inside it, so the "track" inherited every wiggle the maze
//! happened to produce: `artery-banks` censused 22,713 open tiles and found
//! 81.8% with an open radius of ZERO, with radius-4 fillets fitting 4 times
//! across 40 floors. Corner radius has to be an input you allocate, not an
//! output you scavenge.
//!
//! A hand-authored circuit would be identical every floor; a purely random one
//! is what we already had. Physarum polycephalum growth gives the third thing:
//! different every level, organic, and — critically — NATURALLY LOOPY. The
//! organism solves it by feedback, tubes that carry flow thicken and tubes that
//! do not atrophy, so redundant connections survive wherever two routes are
//! comparably good. That is exactly the "interconnected highways" property a
//! spanning tree (and therefore a maze generator) destroys by construction.
//!
//! Tero–Takagi–Nakagawa conductivity model:
//!
//! ```text
//!     Q_ij = D_ij (p_i − p_j) / L_ij          flow through a tube
//!     dD_ij/dt = f(|Q_ij|) − μ D_ij           thicken with flow, decay always
//! ```
//!
//! ## What this port has to get exactly right
//!
//! Four things, each of which produces a plausible floor when wrong:
//!
//!  1. **Draw order.** Every node position is two draws, in placement order,
//!     with a rejection loop that draws again on a reject. One extra rejection
//!     and the whole network shifts.
//!  2. **`js_hypot`.** V8's `Math.hypot` is not libm's — see [`crate::jsmath`].
//!     Distances here feed a K-nearest sort, so a 1-ulp difference can swap two
//!     neighbours and change which tubes exist at all.
//!  3. **Edge ORDER.** `prune_to_circuit`'s keep-set is a JS `Set`, and
//!     `delete` then `add` moves a member to the END of the iteration order.
//!     The surviving edge list is the pass's output and the carver walks it in
//!     order, so this is not bookkeeping.
//!  4. **Stable sorts.** Both sorts here are ties-preserving in JS (spec since
//!     ES2019) and in Rust; the comparators subtract, which is exact for f64s
//!     close enough to matter (Sterbenz), so ties really are ties.
//!
//! PORTS: `maze/track-grow.ts`

use crate::jsmath::{js_cos, js_hypot, js_pow, js_sin};
use crate::maze::archetypes::NodeLayout;
use crate::maze::CountingRng;

/// A junction in the growing network. Positions are in TILE space (floats).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TrackNode {
    pub id: usize,
    pub x: f64,
    pub z: f64,
    /// Food sources anchor the network and are never pruned.
    pub food: bool,
}

/// A tube between two nodes. `d` is conductivity — the thing that grows.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TrackEdge {
    pub a: usize,
    pub b: usize,
    /// Conductivity. High = a highway, low = about to atrophy.
    pub d: f64,
    /// Euclidean length in tiles, cached (it never changes).
    pub len: f64,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct TrackGraph {
    pub nodes: Vec<TrackNode>,
    pub edges: Vec<TrackEdge>,
}

/// Physarum parameters — the numbers that decide whether the output reads as
/// "a few fat highways" or "grey mush", so they are named rather than inlined.
#[derive(Clone, Copy, Debug)]
pub struct GrowOpts {
    /// Simulation steps. More = sharper separation between highway and capillary.
    pub steps: usize,
    /// Decay rate μ. Higher prunes harder, leaving fewer/fatter tubes.
    pub decay: f64,
    /// Flow-reinforcement exponent. >1 makes strong tubes win faster.
    pub gain: f64,
    /// Total flow pushed through the network each step.
    pub flow: f64,
}

/// Tuned together: at this decay/gain the network keeps ~2-4 independent cycles
/// on a typical floor, the figure-eight-or-better topology the design asks for.
/// Raising decay past ~0.16 collapses it to a tree and the whole point is lost.
pub const DEFAULT_GROW: GrowOpts = GrowOpts {
    steps: 140,
    decay: 0.07,
    gain: 1.35,
    flow: 1.0,
};

/// `Math.floor(rng() * n)` — the JS idiom, written once.
fn pick(rng: &mut CountingRng, n: usize) -> usize {
    let k = (rng.next_f64() * n as f64).floor() as usize;
    k.min(n.saturating_sub(1))
}

/// The rejection sampler shared by every layout: place a node at a random point
/// at least `min_sep` from every node already down, or give up after `tries`.
///
/// ⚠️ TWO DRAWS PER ATTEMPT, INCLUDING REJECTED ONES. A rejected attempt still
/// consumed the stream, so "place 25 relays" is not 50 draws — it is however
/// many the geometry needed. This is the single densest source of draws in the
/// whole pipeline and the reason `grow-track` alone accounts for 482 of L1's
/// 5,140 draws.
///
/// `keep_out` is a PREDICATE, not a disc. It started as `{x, z, r}` for the
/// hub's plaza, and the moment the spine needed to protect a long thin stadium
/// there was no radius that expressed it: a disc big enough to cover the
/// boulevard also covers half the floor.
#[allow(clippy::too_many_arguments)]
fn place_scattered(
    w: f64,
    h: f64,
    rng: &mut CountingRng,
    nodes: &mut Vec<TrackNode>,
    margin: f64,
    min_sep: f64,
    keep_out: Option<&dyn Fn(f64, f64) -> bool>,
    food: bool,
) -> bool {
    const TRIES: usize = 40;
    for _ in 0..TRIES {
        let x = margin + rng.next_f64() * (w - 2.0 * margin);
        let z = margin + rng.next_f64() * (h - 2.0 * margin);
        if let Some(k) = keep_out {
            if k(x, z) {
                continue;
            }
        }
        let far = nodes
            .iter()
            .all(|n| (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z) >= min_sep * min_sep);
        if !far {
            continue;
        }
        nodes.push(TrackNode {
            id: nodes.len(),
            x,
            z,
            food,
        });
        return true;
    }
    false
}

fn default_margin(w: f64, h: f64) -> f64 {
    3.0_f64.max(w.min(h) * 0.12)
}

fn default_min_sep(w: f64, h: f64) -> f64 {
    4.0_f64.max(w.min(h) * 0.16)
}

/// Seed the network: food sources plus a scattering of relay nodes.
///
/// Relays matter. With food-only nodes the solver connects them in near-straight
/// lines and the result is a spiderweb of chords — geometrically dull and, worse,
/// full of shallow angles that rasterize into unrideable zigzags. Relays give
/// the network intermediate points to route THROUGH, so surviving tubes bend.
pub fn seed_nodes(
    w: f64,
    h: f64,
    rng: &mut CountingRng,
    foods: usize,
    relays: usize,
    margin: Option<f64>,
    min_sep: Option<f64>,
) -> Vec<TrackNode> {
    let margin = margin.unwrap_or_else(|| default_margin(w, h));
    let min_sep = min_sep.unwrap_or_else(|| default_min_sep(w, h));
    let mut nodes = Vec::new();
    // Food first so they claim the good spread; relays fill between them.
    for _ in 0..foods {
        place_scattered(w, h, rng, &mut nodes, margin, min_sep, None, true);
    }
    for _ in 0..relays {
        place_scattered(w, h, rng, &mut nodes, margin, min_sep, None, false);
    }
    nodes
}

pub struct LayoutOpts {
    pub layout: NodeLayout,
    pub foods: usize,
    pub relays: usize,
    pub margin: Option<f64>,
    pub min_sep: Option<f64>,
}

/// Site nodes for a layout. `Scatter` is exactly [`seed_nodes`], draw for draw.
///
/// This is the archetype's real lever on macro topology, and the reason it
/// lives here rather than in a tile pass: Physarum reinforces routes BETWEEN
/// food sources, so where the food sits decides what the surviving circuit
/// looks like. Every layout still runs through the SAME growth and pruning, so
/// the downstream guarantees hold unchanged — a layout biases the outcome, it
/// does not bypass the machinery.
pub fn layout_nodes(w: f64, h: f64, rng: &mut CountingRng, opts: &LayoutOpts) -> Vec<TrackNode> {
    if opts.layout == NodeLayout::Scatter {
        return seed_nodes(
            w,
            h,
            rng,
            opts.foods,
            opts.relays,
            opts.margin,
            opts.min_sep,
        );
    }

    let margin = opts.margin.unwrap_or_else(|| default_margin(w, h));
    let min_sep = opts.min_sep.unwrap_or_else(|| default_min_sep(w, h));
    let mut nodes: Vec<TrackNode> = Vec::new();
    let (x0, z0, x1, z1) = (margin, margin, w - margin, h - margin);

    // Structured food is placed on the shape whatever the spacing says — the
    // shape IS the point — but never closer than half the separation, or two
    // nodes fuse into one blob when the graph is smoothed into arcs.
    fn put(
        nodes: &mut Vec<TrackNode>,
        bounds: (f64, f64, f64, f64),
        min_sep: f64,
        x: f64,
        z: f64,
        food: bool,
    ) {
        let (x0, z0, x1, z1) = bounds;
        let cx = x.clamp(x0, x1);
        let cz = z.clamp(z0, z1);
        let half = min_sep * 0.5;
        if nodes
            .iter()
            .any(|n| (n.x - cx) * (n.x - cx) + (n.z - cz) * (n.z - cz) < half * half)
        {
            return;
        }
        nodes.push(TrackNode {
            id: nodes.len(),
            x: cx,
            z: cz,
            food,
        });
    }

    /// Walk a polyline and drop `n` food nodes at equal arc length.
    fn along_polyline(
        nodes: &mut Vec<TrackNode>,
        bounds: (f64, f64, f64, f64),
        min_sep: f64,
        pts: &[(f64, f64)],
        n: usize,
    ) {
        let mut segs = Vec::with_capacity(pts.len().saturating_sub(1));
        let mut total = 0.0;
        for k in 1..pts.len() {
            let d = js_hypot(pts[k].0 - pts[k - 1].0, pts[k].1 - pts[k - 1].1);
            segs.push(d);
            total += d;
        }
        if total <= 0.0 {
            return;
        }
        for i in 0..n {
            let mut want = (total * i as f64) / (n.max(2) - 1) as f64;
            for k in 0..segs.len() {
                if want > segs[k] && k < segs.len() - 1 {
                    want -= segs[k];
                    continue;
                }
                let t = if segs[k] > 0.0 {
                    (want / segs[k]).min(1.0)
                } else {
                    0.0
                };
                put(
                    nodes,
                    bounds,
                    min_sep,
                    pts[k].0 + (pts[k + 1].0 - pts[k].0) * t,
                    pts[k].1 + (pts[k + 1].1 - pts[k].1) * t,
                    true,
                );
                break;
            }
        }
    }

    let bounds = (x0, z0, x1, z1);
    // Boxed so each layout can state its exclusion in its own geometry.
    let keep_out: Box<dyn Fn(f64, f64) -> bool>;

    match opts.layout {
        NodeLayout::Spine => {
            // ── THE SPINE MUST BE A LOOP, and this is the whole lesson ───────
            //
            // The first version strung food along an open polyline — a straight
            // run, an elbow, a Z — which is what "spine" sounds like. Measured
            // over 10 seeds × 5 depths it produced nothing: lane share
            // 0.016–0.056, circuit rank 1.1, and 8-10 floors in 10 failing the
            // exit-distance constraint with a stairwell 13 tiles from spawn.
            //
            // The cause is `prune_leaves`. A path is ALL leaves: both ends have
            // degree 1, so they go, exposing the next pair, cascading until only
            // a cycle is left. Whatever the flow simulation reinforced, the
            // boulevard was deleted after the fact — and the pruner is right,
            // because an open-ended road IS a road that dead-ends in rock.
            //
            // So the spine is a STADIUM: one long thin closed circuit, out along
            // one side and back along the other.
            let cx = (x0 + x1) / 2.0;
            let cz = (z0 + z1) / 2.0;
            // Four poses: along each axis and the two diagonals.
            // ⚠️ These four `js_*` calls (here and the `ux`/`uz` pair below) are
            // DEFENSIVE, not load-bearing, and no fixture can ever prove them:
            // `pick(rng, 4)` makes theta one of {0, pi/4, pi/2, 3pi/4}, and at
            // all four `js_cos`/`js_sin` agree with `libm` bit-for-bit
            // (measured under sabotage 2026-08-10 — reverting them to `libm`
            // leaves the whole corpus green). They stay `js_*` so the rule
            // "mirrored trig goes through jsmath" has no exceptions to
            // remember; the hub-layout calls below are the live ones.
            let theta = (pick(rng, 4) as f64 * std::f64::consts::PI) / 4.0;
            let cos = js_cos(theta).abs();
            let sin = js_sin(theta).abs();
            // Half-width — the gap between the outbound and return runs. Widened
            // from 0.16-0.24: the Spine runs the widest lanes in the game
            // (laneScale 1.25) and at the old half-width the two U-turns were not
            // hairpins but FILLED BOWLS, giving the Spine the largest open blob
            // of any archetype (0.230 of walkable against the Great Hall's
            // 0.213). The floor promising "one long road" was quietly the floor
            // with the biggest room.
            let half = 8.0_f64.max((x1 - x0).min(z1 - z0) * (0.22 + rng.next_f64() * 0.08));
            // Longest half-length whose rotated bounding box still fits the
            // margins. Solving both extents at once keeps the shape centred
            // instead of shoved against a wall.
            let room_x = (x1 - x0) / 2.0;
            let room_z = (z1 - z0) / 2.0;
            let len_x = if cos > 1e-6 {
                (room_x - half * sin) / cos
            } else {
                f64::INFINITY
            };
            let len_z = if sin > 1e-6 {
                (room_z - half * cos) / sin
            } else {
                f64::INFINITY
            };
            let len = (half + 4.0).max(len_x.min(len_z));
            let ux = js_cos(theta);
            let uz = js_sin(theta);
            // Perpendicular, for the two runs.
            let px = -uz;
            let pz = ux;
            let corner = |a: f64, b: f64| {
                (
                    cx + ux * len * a + px * half * b,
                    cz + uz * len * a + pz * half * b,
                )
            };
            let ring = [
                corner(-1.0, -1.0),
                corner(1.0, -1.0),
                corner(1.0, 1.0),
                corner(-1.0, 1.0),
                corner(-1.0, -1.0),
            ];
            along_polyline(&mut nodes, bounds, min_sep, &ring, opts.foods + 1);
            // ── KEEP THE RELAYS OUT OF THE INFIELD ──────────────────────────
            //
            // The stadium survives `prune_leaves` by being a loop, but nothing
            // stopped a relay landing INSIDE it — and a relay in the infield is
            // a node the mesh will chord across the middle of the boulevard,
            // handing the solver a shortcut worth half the lap. Censused over 36
            // floors, the longest 3-wide road ran 0.463 of the long side with an
            // sd of 0.22: some Spine floors had no boulevard at all.
            let infield = 2.0_f64.max(half - 3.0);
            keep_out = Box::new(move |x: f64, z: f64| {
                let dx = x - cx;
                let dz = z - cz;
                let along = dx * ux + dz * uz;
                let across = dx * px + dz * pz;
                along.abs() < len && across.abs() < infield
            });
        }
        NodeLayout::Ring => {
            // ── CONCENTRIC GALLERIES, AND WHAT MAKES THEM GALLERIES ─────────
            //
            // `mesh_neighbours` wires every node to its K NEAREST. If the gap
            // BETWEEN rings is smaller than the gap between food nodes ALONG a
            // ring, each node's nearest neighbours are the ones on the ring next
            // door and the mesh comes out as RUNGS — a ladder — before the flow
            // solver ever runs. The concentric layout is then meshed away.
            //
            // That was happening: on a level-20 floor the old numbers put 20 food
            // on a 342-tile outer ring (spacing ~17) with an inset of 8.4, so
            // every cross-ring neighbour was twice as close as every along-ring
            // one. The Ring Keep's banding score ran 1.75 against 1.08-1.36 for
            // archetypes with no rings at all, and it was the confusion sink of a
            // blind classifier.
            //
            // So the inset is derived FROM the spacing, and the ring count drops
            // until both fit. Fix topology in topology-land: no amount of
            // tile-level work downstream puts a gallery back once the mesh has
            // decided it is a rung.
            let span = (x1 - x0).min(z1 - z0);
            let foods = opts.foods;
            let share_of = |r: usize, n: usize| -> usize {
                let v = (foods * (n - r)) as f64 / ((n * (n + 1)) / 2) as f64;
                3.max(js_round(v) as usize)
            };
            let mut rings = 2.max(3.min(js_round(w.min(h) / 34.0) as usize + 1));
            let mut inset = 0.0_f64;
            while rings >= 2 {
                // Widest along-ring spacing over the rings we would draw. The
                // outermost is the longest road but gets the most food, so it is
                // not automatically the loosest — measure them all.
                let mut worst = 0.0_f64;
                let mut placed_guess = 0usize;
                for r in 0..rings {
                    let n = share_of(r, rings).min(1.max(foods.saturating_sub(placed_guess)));
                    placed_guess += n;
                    // The perimeter under the inset we are solving for is itself
                    // inset-dependent, so use the outermost as an upper bound: it
                    // can only overestimate spacing, the safe direction for a
                    // separation constraint.
                    worst = worst.max((2.0 * (x1 - x0 + z1 - z0)) / 1.0_f64.max(n as f64));
                }
                // 1.25x, not 1.0: equal is a coin flip in a K-nearest tie, and a
                // tie broken the wrong way is a rung.
                inset = (span / (2.0 * (rings + 1) as f64)).max(worst * 1.25);
                // Every ring must still enclose real area, or the innermost
                // "gallery" is a dot in the middle of the floor.
                if inset * (rings - 1) as f64 * 2.0 < span * 0.62 {
                    break;
                }
                rings -= 1;
            }
            let rings = 2.max(rings);
            let mut placed = 0usize;
            for r in 0..rings {
                if placed >= foods {
                    break;
                }
                let a0 = x0 + inset * r as f64;
                let b0 = z0 + inset * r as f64;
                let a1 = x1 - inset * r as f64;
                let b1 = z1 - inset * r as f64;
                if a1 - a0 < 6.0 || b1 - b0 < 6.0 {
                    break; // a ring with no room left is not a gallery
                }
                let n = share_of(r, rings).min(foods - placed);
                along_polyline(
                    &mut nodes,
                    bounds,
                    min_sep,
                    &[(a0, b0), (a1, b0), (a1, b1), (a0, b1), (a0, b0)],
                    n + 1, // the closing point coincides with the opener
                );
                placed += n;
            }
            // Relays between the galleries are the same defect as relays in the
            // spine's infield: they are exactly the intermediate points a chord
            // needs to cut from one gallery to the next. Keep them within a band
            // of a ring so they BEND the galleries instead of bridging them.
            let band = inset * 0.34;
            keep_out = Box::new(move |x: f64, z: f64| {
                for r in 0..rings {
                    let a0 = x0 + inset * r as f64;
                    let b0 = z0 + inset * r as f64;
                    let a1 = x1 - inset * r as f64;
                    let b1 = z1 - inset * r as f64;
                    if a1 - a0 < 6.0 || b1 - b0 < 6.0 {
                        break;
                    }
                    // Chebyshev distance to the rectangle's outline.
                    let dx = (a0 - x).max(0.0).max(x - a1);
                    let dz = (b0 - z).max(0.0).max(z - b1);
                    let outside = dx.max(dz);
                    let inside = if x > a0 && x < a1 && z > b0 && z < b1 {
                        (x - a0).min(a1 - x).min(z - b0).min(b1 - z)
                    } else {
                        0.0
                    };
                    if outside.max(inside) <= band {
                        return false; // near a gallery — allowed
                    }
                }
                true
            });
        }
        _ => {
            // hub — a chamber with spokes. The centre node is what the carver
            // later opens into the plaza, so it must be FOOD: relays get pruned,
            // food never is.
            let cx = (x0 + x1) / 2.0 + (rng.next_f64() - 0.5) * (x1 - x0) * 0.1;
            let cz = (z0 + z1) / 2.0 + (rng.next_f64() - 0.5) * (z1 - z0) * 0.1;
            put(&mut nodes, bounds, min_sep, cx, cz, true);
            let ring_r = (x1 - x0).min(z1 - z0) * 0.3;
            let spokes = 4.max(8.min(opts.foods.saturating_sub(2)));
            let phase = rng.next_f64() * std::f64::consts::PI * 2.0;
            for s in 0..spokes {
                let a = phase + (s as f64 / spokes as f64) * std::f64::consts::PI * 2.0;
                put(
                    &mut nodes,
                    bounds,
                    min_sep,
                    // Live: `a` is a continuous angle off `phase`. Across the
                    // 5 hub floors, 153 trig calls, only 3 differ between
                    // `js_*` and `libm` and only ONE moves a node into another
                    // cell — the maze-side gate on trig rests on that single
                    // sample, which is why the jsmath sweeps carry the weight.
                    cx + js_cos(a) * ring_r,
                    cz + js_sin(a) * ring_r * ((z1 - z0) / (x1 - x0)),
                    true,
                );
            }
            // The rest of the food goes out near the walls, so the plaza has an
            // outer world to be the centre OF rather than sitting alone in rock.
            let outer = opts.foods.saturating_sub(spokes + 1);
            for s in 0..outer {
                let a = phase
                    + 0.4
                    + (s as f64 / 1.0_f64.max(outer as f64)) * std::f64::consts::PI * 2.0;
                put(
                    &mut nodes,
                    bounds,
                    min_sep,
                    cx + js_cos(a) * (x1 - x0) * 0.45,
                    cz + js_sin(a) * (z1 - z0) * 0.45,
                    true,
                );
            }
            // Keep relays out of the chamber, or the maze grows through the plaza.
            let chamber_r = ring_r * 0.72;
            keep_out = Box::new(move |x: f64, z: f64| {
                (x - cx) * (x - cx) + (z - cz) * (z - cz) < chamber_r * chamber_r
            });
        }
    }

    for _ in 0..opts.relays {
        place_scattered(
            w,
            h,
            rng,
            &mut nodes,
            margin,
            min_sep,
            Some(keep_out.as_ref()),
            false,
        );
    }
    nodes
}

/// `Math.round` — half toward +∞, which is not Rust's half-away-from-zero.
fn js_round(v: f64) -> f64 {
    (v + 0.5).floor()
}

/// The initial mesh: connect each node to its K nearest neighbours.
///
/// K is the loop budget. K=2 is essentially a ring or a tree and the solver has
/// nothing to choose between; K=4+ is dense enough that decay has real work to
/// do and the SURVIVING topology is genuinely emergent rather than preordained.
/// Duplicate edges are collapsed (the relation is symmetric).
pub fn mesh_neighbours(nodes: &[TrackNode], k: usize, max_len: f64) -> Vec<TrackEdge> {
    let mut seen: std::collections::HashSet<(usize, usize)> = std::collections::HashSet::new();
    let mut edges = Vec::new();
    for n in nodes {
        let mut near: Vec<&TrackNode> = nodes
            .iter()
            .filter(|m| m.id != n.id)
            .filter(|m| js_hypot(m.x - n.x, m.z - n.z) <= max_len)
            .collect();
        // Stable, by SQUARED distance — the legacy comparator subtracts the two
        // squared distances, and a stable sort keeps equidistant neighbours in
        // node order, which is what decides ties.
        near.sort_by(|p, q| {
            let dp = (p.x - n.x) * (p.x - n.x) + (p.z - n.z) * (p.z - n.z);
            let dq = (q.x - n.x) * (q.x - n.x) + (q.z - n.z) * (q.z - n.z);
            dp.partial_cmp(&dq).expect("node positions are finite")
        });
        for m in near.into_iter().take(k) {
            let a = n.id.min(m.id);
            let b = n.id.max(m.id);
            if !seen.insert((a, b)) {
                continue;
            }
            let len = js_hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z);
            // Start every tube equal and let flow decide. Seeding `d` from
            // length would prejudge the outcome — short tubes would win before
            // the simulation ran, which is "nearest-neighbour graph" with extra
            // steps.
            edges.push(TrackEdge {
                a,
                b,
                d: 1.0,
                len: len.max(0.001),
            });
        }
    }
    edges
}

/// Solve node pressures for a source/sink pair by Gauss–Seidel relaxation.
///
/// Kirchhoff at every non-terminal node: Σ D_ij (p_i − p_j)/L_ij = 0, which
/// rearranges to the weighted-average update below. Gauss–Seidel rather than a
/// matrix solve because the network is tiny (tens of nodes), it needs no
/// allocation, and it degrades gracefully — a not-quite-converged pressure field
/// still yields a sane flow direction, which is all the conductivity update
/// consumes.
///
/// ⚠️ IN-PLACE AND IN NODE-INDEX ORDER. Gauss–Seidel reads values updated
/// earlier in the same sweep, so the sweep order is part of the answer; a
/// Jacobi rewrite (or iterating a hash map) converges to the same fixed point
/// by a different path and lands on different last bits.
fn solve_pressures(
    g: &TrackGraph,
    source: usize,
    sink: usize,
    flow: f64,
    iters: usize,
) -> Vec<f64> {
    let n = g.nodes.len();
    let mut p = vec![0.0; n];
    p[source] = flow;
    p[sink] = 0.0;
    // Adjacency with conductance per edge (D/L), built in EDGE order.
    let mut adj: Vec<Vec<(usize, f64)>> = vec![Vec::new(); n];
    for e in &g.edges {
        let c = e.d / e.len;
        adj[e.a].push((e.b, c));
        adj[e.b].push((e.a, c));
    }
    for _ in 0..iters {
        for i in 0..n {
            if i == source || i == sink {
                continue;
            }
            let mut num = 0.0;
            let mut den = 0.0;
            for &(to, c) in &adj[i] {
                num += c * p[to];
                den += c;
            }
            if den > 1e-12 {
                p[i] = num / den;
            }
        }
    }
    p
}

/// Run the growth. Every step picks a food pair, pushes flow between them, and
/// updates conductivities.
///
/// Cycling the source/sink pair across ALL food nodes (rather than fixing one
/// pair) is what produces loops: each pair reinforces its own best route, and
/// where two routes overlap they compound, while a tube useful to only one pair
/// still survives if its flow beats decay. A single fixed pair would reinforce
/// exactly one path and decay everything else — a tree again.
pub fn grow_network(g: &mut TrackGraph, rng: &mut CountingRng, opts: &GrowOpts) {
    let foods: Vec<usize> = g.nodes.iter().filter(|n| n.food).map(|n| n.id).collect();
    if foods.len() < 2 || g.edges.is_empty() {
        return;
    }

    let mut qs = vec![0.0_f64; g.edges.len()];
    for _ in 0..opts.steps {
        // Deterministic pair selection from the seeded rng — TWO draws every
        // step, whether or not the second one is used.
        let s = foods[pick(rng, foods.len())];
        let mut t = foods[pick(rng, foods.len())];
        if t == s {
            let at = foods
                .iter()
                .position(|&f| f == s)
                .expect("s came from foods");
            t = foods[(at + 1) % foods.len()];
        }

        let p = solve_pressures(g, s, t, opts.flow, 60);

        // NORMALISE THE FLOW FIELD BEFORE REINFORCING.
        //
        // The raw magnitudes are the trap. |Q| = D·Δp/L with Δp ≤ 1 spread over
        // ~4 hops and L ~ 15 tiles gives |Q| ~ 0.02, so Q^1.35 ~ 5e-3 against a
        // decay term μD ~ 0.1 — reinforcement runs ~20× weaker than decay and
        // EVERY tube starves to the 1e-4 floor whatever its flow. The first
        // draft did exactly that and produced a uniformly dead graph, which the
        // pruner then read as "all edges equal" (measured: 42/42 edges at 0.000).
        //
        // Scaling by the step's own strongest flow makes the update scale-free:
        // the busiest tube always gains ~1 unit and the rest gain in proportion.
        // The ABSOLUTE flow is an artifact of floor size and node count; only
        // the RELATIVE flow carries information.
        let mut q_max = 0.0_f64;
        for (i, e) in g.edges.iter().enumerate() {
            let q = ((e.d * (p[e.a] - p[e.b])) / e.len).abs();
            qs[i] = q;
            if q > q_max {
                q_max = q;
            }
        }
        if q_max < 1e-12 {
            continue; // no flow this step (degenerate pair) — skip
        }

        for (i, e) in g.edges.iter_mut().enumerate() {
            // f(|Q|) − μD. The exponent sharpens: with gain > 1 a tube carrying
            // twice the flow gains more than twice the conductivity, so the mesh
            // separates into highways and capillaries instead of drifting to a
            // uniform value.
            e.d += js_pow(qs[i] / q_max, opts.gain) - opts.decay * e.d;
            if e.d < 1e-4 {
                e.d = 1e-4; // never negative; a dead tube can revive
            }
        }
    }
}

/// A JS `Set<number>` used as an ordered collection.
///
/// ⚠️ THIS IS NOT A HASHSET, and the difference is the pass's output. In JS,
/// `delete(i)` then `add(i)` moves `i` to the END of the iteration order, and
/// `prune_to_circuit` does exactly that every time it undoes a cut. The
/// surviving edge list is spread out of this set in iteration order and the
/// carver walks it in that order, so an unordered set would produce the same
/// SET of roads laid down in a different sequence — which the digest catches
/// and a screenshot does not.
struct InsertionSet {
    order: Vec<usize>,
    member: Vec<bool>,
}

impl InsertionSet {
    fn full(n: usize) -> Self {
        Self {
            order: (0..n).collect(),
            member: vec![true; n],
        }
    }
    fn remove(&mut self, i: usize) {
        if self.member[i] {
            self.member[i] = false;
            self.order.retain(|&k| k != i);
        }
    }
    fn insert(&mut self, i: usize) {
        if !self.member[i] {
            self.member[i] = true;
            self.order.push(i);
        }
    }
    fn iter(&self) -> impl Iterator<Item = usize> + '_ {
        self.order.iter().copied()
    }
}

/// Prune atrophied tubes, then guarantee the result is still one connected
/// component with at least `min_loops` independent cycles.
///
/// The cycle count is `E − V + 1` per component (the circuit rank). That number
/// IS the design requirement — "figure-eight or better" means rank ≥ 2 — so it
/// is measured directly rather than inferred from a proxy like edge count.
///
/// Pruning walks weakest-first and REFUSES any cut that would disconnect the
/// graph or drop the rank below the floor. That ordering matters: pruning by a
/// fixed threshold is what produced disconnected islands in the first draft,
/// because conductivity distributions vary wildly between seeds and no single
/// threshold is right for all of them.
pub fn prune_to_circuit(g: &TrackGraph, min_loops: i64, survive: Option<f64>) -> TrackGraph {
    let mut keep = InsertionSet::full(g.edges.len());
    let mut order: Vec<(usize, f64)> = g.edges.iter().enumerate().map(|(i, e)| (i, e.d)).collect();
    order.sort_by(|a, b| a.1.partial_cmp(&b.1).expect("conductivities are finite"));

    // A tube that ended the simulation genuinely THRIVING is kept regardless of
    // how many loops we already have. Without this the loop count pins to
    // exactly `min_loops` on every seed — the pruner shaves until the floor
    // stops it, so "organic, different every level" collapses into "always a
    // figure-eight". Relative to the network's own strongest tube, because
    // absolute conductivity varies by an order of magnitude between seeds.
    let max_d = g.edges.iter().fold(0.0_f64, |m, e| m.max(e.d));
    let survive_at = max_d * survive.unwrap_or(0.12);

    for (i, d) in order {
        if d >= survive_at {
            continue; // thriving — the flow earned it, keep it
        }
        keep.remove(i);
        let (ok, rank) = connected_and_rank(g, &keep);
        if !ok || rank < min_loops {
            keep.insert(i); // undo — this tube is load-bearing
        }
    }

    let kept: Vec<TrackEdge> = keep.iter().map(|i| g.edges[i]).collect();
    let mut used = std::collections::HashSet::new();
    for e in &kept {
        used.insert(e.a);
        used.insert(e.b);
    }
    TrackGraph {
        nodes: g
            .nodes
            .iter()
            .copied()
            .filter(|n| used.contains(&n.id))
            .collect(),
        edges: kept,
    }
}

/// Is the kept sub-graph one component, and what is its circuit rank?
///
/// `rank` is only consulted when `ok` — a disconnected graph is put back
/// whatever its rank — so the DFS start node (which the legacy code takes from
/// a `Map`'s first key, i.e. from edge iteration order) cannot change the
/// outcome. Stated here because it is the one place the ordered set could have
/// leaked into the decision and does not.
fn connected_and_rank(g: &TrackGraph, keep: &InsertionSet) -> (bool, i64) {
    let mut adj: std::collections::HashMap<usize, Vec<usize>> = std::collections::HashMap::new();
    let mut order: Vec<usize> = Vec::new();
    let mut edge_count = 0i64;
    for i in keep.iter() {
        let e = g.edges[i];
        edge_count += 1;
        for (from, to) in [(e.a, e.b), (e.b, e.a)] {
            // `order` records FIRST-INSERTION, which is what the legacy `Map`'s
            // key order is and where the DFS starts. The entry API is used so
            // the "is it new" question is asked exactly once.
            match adj.entry(from) {
                std::collections::hash_map::Entry::Vacant(slot) => {
                    order.push(from);
                    slot.insert(vec![to]);
                }
                std::collections::hash_map::Entry::Occupied(mut slot) => slot.get_mut().push(to),
            }
        }
    }
    let Some(&start) = order.first() else {
        return (false, 0);
    };
    let mut seen = std::collections::HashSet::new();
    let mut stack = vec![start];
    seen.insert(start);
    while let Some(v) = stack.pop() {
        for &u in adj.get(&v).map(Vec::as_slice).unwrap_or(&[]) {
            if seen.insert(u) {
                stack.push(u);
            }
        }
    }
    let ok = seen.len() == adj.len();
    (ok, edge_count - seen.len() as i64 + 1)
}

/// PRUNE LEAVES — drop degree-1 nodes, cascading.
///
/// This is where "roads that dead-end in mid-air" actually come from.
/// `prune_to_circuit` guarantees the graph stays CONNECTED and keeps its LOOPS,
/// but neither property forbids a dangling spur: a degree-1 node is attached to
/// the network and destroys no cycle, so the pruner happily keeps it. Carved,
/// that spur is a lane running out into solid rock — measured, 2-4 leaf nodes
/// per floor, matching the 1.3 road terminations per floor seen downstream.
///
/// Repairing it at TILE level (extend the stub until it rejoins something) does
/// not work — it was tried, and it "joined" 8-24 times per floor while the
/// termination count never moved, because every extension creates a new tile
/// that is itself the new end of the road. The defect is topological, so the fix
/// is topological: remove the leaf, not the tile.
pub fn prune_leaves(g: &TrackGraph) -> TrackGraph {
    let mut edges = g.edges.clone();
    for _ in 0..200 {
        let mut deg: std::collections::HashMap<usize, usize> = std::collections::HashMap::new();
        for e in &edges {
            *deg.entry(e.a).or_insert(0) += 1;
            *deg.entry(e.b).or_insert(0) += 1;
        }
        let leaf: std::collections::HashSet<usize> = deg
            .iter()
            .filter(|(_, &d)| d <= 1)
            .map(|(&n, _)| n)
            .collect();
        if leaf.is_empty() {
            break;
        }
        edges.retain(|e| !leaf.contains(&e.a) && !leaf.contains(&e.b));
    }
    let mut used = std::collections::HashSet::new();
    for e in &edges {
        used.insert(e.a);
        used.insert(e.b);
    }
    TrackGraph {
        nodes: g
            .nodes
            .iter()
            .copied()
            .filter(|n| used.contains(&n.id))
            .collect(),
        edges,
    }
}

/// Circuit rank (independent cycles) of a graph assumed connected.
pub fn circuit_rank(g: &TrackGraph) -> i64 {
    let mut used = std::collections::HashSet::new();
    for e in &g.edges {
        used.insert(e.a);
        used.insert(e.b);
    }
    if used.is_empty() {
        0
    } else {
        g.edges.len() as i64 - used.len() as i64 + 1
    }
}

/// Options `build_track_floor` hands the growth stage.
#[derive(Default)]
pub struct GrowTrackOpts {
    pub foods: Option<usize>,
    pub relays: Option<usize>,
    pub min_loops: Option<i64>,
    pub grow: Option<GrowOpts>,
    pub layout: Option<NodeLayout>,
    pub max_len_frac: Option<f64>,
    pub survive: Option<f64>,
}

/// The whole growth stage: seed → mesh → grow → prune.
///
/// Returns a connected, loopy graph in tile space. It is NOT yet a track — the
/// edges are straight chords between nodes. `track_path` turns it into rideable
/// geometry; this module only decides the TOPOLOGY.
pub fn grow_track(w: i32, h: i32, rng: &mut CountingRng, opts: &GrowTrackOpts) -> TrackGraph {
    let wf = f64::from(w);
    let hf = f64::from(h);
    // FOOD COUNT IS THE COMPLEXITY DIAL, and it was worth measuring rather than
    // guessing: physarum optimises toward a MINIMAL efficient network, so with
    // few food sources it converges on the same small answer every seed — at 5
    // foods the output was 8 nodes / 9 edges / rank 2 on 30/30 seeds, a textbook
    // figure-eight, identical every floor, which is the one thing this design
    // was supposed to avoid. Measured rank (min/avg/max) over 30 seeds: 5 foods
    // 2/2.00/2 · 8 foods 2/2.13/3 · 10 foods 2/2.37/4 · 12 foods 2/2.87/6 ·
    // 14 foods 2/3.97/7 — genuine per-floor variety.
    //
    // The clamps below used to be min(15) and min(22) and a census showed both
    // BINDING FROM FLOOR 1 while the grid grew 3,975 → 11,125 tiles, so "scale
    // the seed count with floor area" is precisely what did not happen and the
    // circuit's share of the walkable floor decayed 0.30 → 0.12 with depth.
    let area = wf * hf;
    let foods = opts
        .foods
        .unwrap_or_else(|| 6.max(44.min(js_round(area / 260.0) as usize + 4)));
    let relays = opts
        .relays
        .unwrap_or_else(|| 8.max(64.min(js_round(area / 190.0) as usize + 6)));
    let nodes = layout_nodes(
        wf,
        hf,
        rng,
        &LayoutOpts {
            layout: opts.layout.unwrap_or(NodeLayout::Scatter),
            foods,
            relays,
            margin: None,
            min_sep: Some(5.0),
        },
    );
    // CAP THE CHORD LENGTH. A nearest-neighbour mesh on a sparse region can pair
    // two nodes across the whole floor, and a long chord swept with a 2.5-tile
    // brush paves everything it crosses: measured 8/40 floors ending up >70%
    // track, one at 97% — a floor with no maze left in it. Keeping tubes local
    // also keeps the network planar-ish, so legs cross far less and the circuit
    // reads as roads rather than a cat's cradle.
    let max_len = wf.min(hf) * opts.max_len_frac.unwrap_or(0.42);
    let edges = mesh_neighbours(&nodes, 4, max_len);
    let mut grown = TrackGraph { nodes, edges };
    grow_network(&mut grown, rng, &opts.grow.unwrap_or(DEFAULT_GROW));
    // Prune to a loopy connected core, THEN drop dangling spurs. Both are
    // needed: `prune_to_circuit` protects cycles but happily keeps a degree-1
    // tail, and that tail is exactly what carves into a road ending in rock.
    prune_leaves(&prune_to_circuit(
        &grown,
        opts.min_loops.unwrap_or(2),
        opts.survive,
    ))
}

// ── PARITY DIGESTS ───────────────────────────────────────────────────────────
//
// The first two passes write nothing to the grid: their entire output is this
// graph. A boundary that only digests tiles would certify an all-wall grid
// twice and call the topology verified, and counts are no better — two
// different networks with the same node and edge totals is the normal case.
// Twins of `digestNodes`/`digestEdges` in the legacy exporter.

/// Digest the nodes in PLACEMENT order — which is the order the rng drew them.
///
/// `id` is folded although it equals the index today: `prune_to_circuit` filters
/// nodes and does NOT reindex, so downstream the two come apart and a digest
/// that assumed otherwise would stop noticing.
pub fn digest_nodes(nodes: &[TrackNode]) -> u32 {
    let mut h = crate::maze::digest::Fnv1a::new();
    for n in nodes {
        h.count(n.id);
        h.f64(n.x);
        h.f64(n.z);
        h.byte(u8::from(n.food));
    }
    h.count(nodes.len()).finish()
}

/// Digest the tubes in edge order — endpoints, conductivity and length.
///
/// `d` is the solver's output after 140 steps of Gauss–Seidel, so it is the
/// number in the whole floor most likely to diverge in the last ulp. Digested
/// rather than compared loosely on purpose: `prune_to_circuit` SORTS by `d`, so
/// a 1-ulp difference can swap two tubes in the survival order and delete a
/// different road.
pub fn digest_edges(edges: &[TrackEdge]) -> u32 {
    let mut h = crate::maze::digest::Fnv1a::new();
    for e in edges {
        h.count(e.a);
        h.count(e.b);
        h.f64(e.d);
        h.f64(e.len);
    }
    h.count(edges.len()).finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The ordered-set semantics `prune_to_circuit` depends on — pinned here
    /// because they are a JS `Set` behaviour a Rust reader has no reason to
    /// expect, and because getting them wrong reorders roads silently.
    #[test]
    fn a_reinserted_member_goes_to_the_end() {
        let mut s = InsertionSet::full(4);
        assert_eq!(s.iter().collect::<Vec<_>>(), vec![0, 1, 2, 3]);
        s.remove(1);
        assert_eq!(s.iter().collect::<Vec<_>>(), vec![0, 2, 3]);
        s.insert(1);
        assert_eq!(
            s.iter().collect::<Vec<_>>(),
            vec![0, 2, 3, 1],
            "re-add must APPEND"
        );
        // Idempotent both ways, like the JS Set.
        s.insert(1);
        s.remove(3);
        assert_eq!(s.iter().collect::<Vec<_>>(), vec![0, 2, 1]);
    }

    /// A rejected placement still consumed two draws. Without this the draw
    /// count drifts on exactly the crowded floors where it matters.
    #[test]
    fn a_rejected_placement_still_spends_the_stream() {
        let mut rng = CountingRng::new(1);
        let mut nodes = Vec::new();
        // min_sep bigger than the whole box: every attempt after the first is
        // rejected, so the second call burns all 40 tries.
        assert!(place_scattered(
            20.0, 20.0, &mut rng, &mut nodes, 2.0, 1000.0, None, true
        ));
        let after_first = rng.draws();
        assert_eq!(after_first, 2);
        assert!(!place_scattered(
            20.0, 20.0, &mut rng, &mut nodes, 2.0, 1000.0, None, true
        ));
        assert_eq!(rng.draws() - after_first, 80, "40 tries × 2 draws");
        assert_eq!(nodes.len(), 1, "nothing was placed");
    }

    #[test]
    fn circuit_rank_counts_independent_cycles() {
        // A triangle: 3 edges, 3 nodes → rank 1.
        let g = TrackGraph {
            nodes: (0..3)
                .map(|id| TrackNode {
                    id,
                    x: 0.0,
                    z: 0.0,
                    food: true,
                })
                .collect(),
            edges: vec![
                TrackEdge {
                    a: 0,
                    b: 1,
                    d: 1.0,
                    len: 1.0,
                },
                TrackEdge {
                    a: 1,
                    b: 2,
                    d: 1.0,
                    len: 1.0,
                },
                TrackEdge {
                    a: 2,
                    b: 0,
                    d: 1.0,
                    len: 1.0,
                },
            ],
        };
        assert_eq!(circuit_rank(&g), 1);
        assert_eq!(circuit_rank(&TrackGraph::default()), 0);
    }
}
