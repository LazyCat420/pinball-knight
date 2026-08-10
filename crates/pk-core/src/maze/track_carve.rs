//! Pass 3 of 23 — `carve-track`: burn the circuit into tiles.
//!
//! Port of `legacy/src/game/pinball-knight/maze/track-carve.ts`. Passes 1 and 2
//! produced a graph and then rideable geometry; nothing has touched the grid
//! yet. This is the pass that first writes tiles, and it also creates the
//! [`TrackMask`] every later pass reads to know where the circuit is.
//!
//! Legs are swept discs along a segment; fillets are swept discs along an arc.
//! Sweeping a brush rather than filling a polygon is what makes lane width and
//! corner radius independent — the arc is the centreline and the brush gives it
//! thickness, so a radius-6 fillet carved with a 2.5-wide brush is a genuine
//! banked turn with an inner and an outer wall.
//!
//! ## What this boundary catches — MEASURED, and it is half of what it looks
//!
//! `probe("carve-track")` passes no `extra`, but the pass writes four of the
//! seven digested arrays (`t`, `arcIdx`, and the mask's `lane` and `dist`) plus
//! two counts, so on paper it looks like a strong boundary. Ten sabotages, each
//! compiled and run against the ten corpus floors:
//!
//! ```text
//! caught      leg step 0.35 -> 0.36                   10/10 floors
//! caught      arc step floor max(2) -> max(1)          1/10
//! caught      arc sweep half-width -> hardcoded 2.0   10/10
//! caught      legs not carved at all                  10/10
//! NOT CAUGHT  libm::hypot instead of js_hypot
//! NOT CAUGHT  libm cos/sin instead of js_cos/js_sin
//! NOT CAUGHT  `d > r` relaxed to `d >= r`
//! NOT CAUGHT  the i1 clamp widened from w-2 to w-1
//! NOT CAUGHT  (span*s)/steps rewritten as span*(s/steps)
//! NOT CAUGHT  the dist compare done in f32
//! ```
//!
//! The shape is clear and it matches what pass 2 found: **this boundary gates
//! structure and is blind to one ulp.** Everything here is a threshold test
//! (`d > r`) or a rounded step count, and a last-bit difference almost never
//! flips one. So the trig and hypot guarantees for this pass rest ENTIRELY on
//! `tests/jsmath_oracle.rs`, not on ten green floors — which is exactly why the
//! primitive sweeps exist and why a corpus-green result is not a licence to
//! skip them.
//!
//! Two of the six are worth separating from the rest:
//!
//! · The f32 compare is not a gap, it is an IDENTITY. When `d as f32` equals
//!   `dist[k]` but `d` is smaller in double, the store writes `d as f32` — the
//!   value already there. The two forms cannot disagree on what is stored. The
//!   f64 form is kept because it is what the TS says, not because it differs.
//! · The `w-2` clamp is a real gap: no disc on any corpus floor reaches the
//!   last column, so the corpus never exercises a lane against the border.
//!
//! Two further cautions on reading a failure:
//!
//! · `carveTrack` draws NO rng, so the draw count matches by construction and
//!   the usual "wrong count = wrong draw sequence" localiser is silent here.
//! · On the corpus floors `lane` and `t` digest IDENTICALLY, because `T_FLOOR`
//!   is 1 and a lane mark is 1 and at this boundary the two arrays hold the same
//!   bytes. A port that returned the tile array as the mask would pass both;
//!   `sealed` and `dist` are what separate them.

use crate::grid::{ensure_arcs, idx, set_shape, set_tile, Grid, T_FLOOR};
use crate::jsmath::{js_cos, js_hypot, js_sin};
use crate::maze::track_path::TrackPath;
use crate::maze::TrackMask;
use crate::tile_shape::SHAPE_FULL;

/// Bounds-safe mask read. [`idx`] does no range check (it is on the hot path for
/// every tile loop in the game), so an out-of-bounds probe yields a nonsense
/// offset — in JS that reads as `undefined`, which is falsy and therefore
/// silently wrong rather than loud; in Rust it panics. Off-grid is never track.
pub fn on_lane(g: &Grid, mask: &TrackMask, i: i32, j: i32) -> bool {
    if i < 0 || j < 0 || i >= g.w || j >= g.h {
        return false;
    }
    mask.lane[idx(g, i, j)] == 1
}

/// Is this lane tile one nothing may tap into? Bounds-safe, like [`on_lane`].
pub fn is_sealed(g: &Grid, mask: &TrackMask, i: i32, j: i32) -> bool {
    if i < 0 || j < 0 || i >= g.w || j >= g.h {
        return false;
    }
    mask.sealed[idx(g, i, j)] == 1
}

/// Stamp a filled disc of floor — the brush every carve stroke uses.
fn disc(g: &mut Grid, mask: &mut TrackMask, cx: f64, cz: f64, r: f64) {
    // `Math.max(1, Math.floor(cx - r))` and friends: the clamp happens in f64,
    // on the FLOORED value, before anything becomes an index.
    let i0 = (cx - r).floor().max(1.0) as i32;
    let i1 = (cx + r).ceil().min(f64::from(g.w - 2)) as i32;
    let j0 = (cz - r).floor().max(1.0) as i32;
    let j1 = (cz + r).ceil().min(f64::from(g.h - 2)) as i32;
    for j in j0..=j1 {
        for i in i0..=i1 {
            let dx = f64::from(i) + 0.5 - cx;
            let dz = f64::from(j) + 0.5 - cz;
            // V8's `Math.hypot`, not the C library's — they differ by 1 ulp on
            // real inputs and this one decides tile membership at `d > r`.
            let d = js_hypot(dx, dz);
            if d > r {
                continue;
            }
            let k = idx(g, i, j);
            set_tile(g, i, j, T_FLOOR);
            set_shape(g, i, j, SHAPE_FULL);
            mask.lane[k] = 1;
            // `Float32Array` READS widen to f64 and WRITES round to f32, so the
            // TS compares in double and stores in single. Transcribed that way
            // — but note it is a transcription and not a defence: an f32
            // compare here is provably the same function, because the only
            // inputs where the two disagree are ones whose store is a no-op.
            // Sabotage-checked; see the module header's table.
            if d < f64::from(mask.dist[k]) {
                mask.dist[k] = d as f32;
            }
        }
    }
}

/// Sweep the disc brush along a straight segment — one carve STROKE.
///
/// Public because the launch chute (pass 5) is carved with the same brush as
/// the circuit itself, deliberately: the chute must be a lane in every sense the
/// rest of the pipeline understands (mask, keep-out margin, dead-end exemption,
/// socket type), not a corridor that merely looks like one.
pub fn carve_stroke(
    g: &mut Grid,
    mask: &mut TrackMask,
    x0: f64,
    z0: f64,
    x1: f64,
    z1: f64,
    half: f64,
) {
    let len = js_hypot(x1 - x0, z1 - z0);
    let steps = (len / 0.35).ceil().max(1.0);
    // `steps` stays f64 for the division: `s / steps` is what the TS computes,
    // and an integer round-trip through the divisor is a different expression.
    let n = steps as i64;
    for s in 0..=n {
        let t = s as f64 / steps;
        disc(g, mask, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, half);
    }
}

/// Carve the circuit into the grid. Returns the mask the rest of the pipeline
/// reads to know where the track is.
///
/// The step is deliberately fine (0.35 tiles). A coarse step leaves scalloped
/// edges along diagonals, which is exactly the "why does this wall have a notch
/// in it" artefact that makes generated geometry look accidental.
pub fn carve_track(g: &mut Grid, path: &TrackPath) -> TrackMask {
    let mut mask = TrackMask::for_grid(g);
    ensure_arcs(g);

    // NOT `carve_stroke`, even though the body is the same three lines. The TS
    // inlines the sweep here and factors it out for the chute, and the two
    // copies are free to drift — reaching for the helper would be a
    // simplification of the ORACLE, which is not this port's job.
    for leg in &path.legs {
        let len = js_hypot(leg.x1 - leg.x0, leg.z1 - leg.z0);
        let steps = (len / 0.35).ceil().max(1.0);
        let n = steps as i64;
        for s in 0..=n {
            let t = s as f64 / steps;
            disc(
                g,
                &mut mask,
                leg.x0 + (leg.x1 - leg.x0) * t,
                leg.z0 + (leg.z1 - leg.z0) * t,
                leg.half,
            );
        }
    }

    for a in &path.arcs {
        let arc_len = a.r * a.span;
        let steps = (arc_len / 0.35).ceil().max(2.0);
        // Fillets are carved at the MAIN width: a corner narrower than the
        // straight feeding it is a funnel, and a ball carrying pinball momentum
        // into a funnel wedges. The path owns the number so it stays in step
        // with the archetype's lane scale.
        let half = path.arc_half;
        let n = steps as i64;
        for s in 0..=n {
            // `(span * s) / steps`, multiply-then-divide, in that order.
            let ang = a.a0 + (a.span * s as f64) / steps;
            let cx = a.cx + js_cos(ang) * a.r;
            let cz = a.cz + js_sin(ang) * a.r;
            disc(g, &mut mask, cx, cz, half);
        }
    }

    mask
}

/// Open one big CHAMBER on the circuit — the Great Hall's plaza (pass 4).
///
/// A disc rather than a rect, and carved into the lane mask rather than beside
/// it, so it is genuinely part of the track: the maze's keep-out margin respects
/// it, on-ramps can open onto its rim, and the endpoint picker will happily put
/// spawn or stairs in it. Carved AFTER the maze it would instead bulldoze
/// finished corridors and leave severed stubs pointing into it.
///
/// Returns false if the radius does not fit, so the caller steps the radius down
/// rather than clipping a plaza against the border.
pub fn carve_chamber(g: &mut Grid, mask: &mut TrackMask, cx: f64, cz: f64, r: f64) -> bool {
    if r < 3.0 {
        return false;
    }
    if cx - r < 2.0 || cz - r < 2.0 || cx + r > f64::from(g.w - 3) || cz + r > f64::from(g.h - 3) {
        return false;
    }
    disc(g, mask, cx, cz, r);
    true
}
