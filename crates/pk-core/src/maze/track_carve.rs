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
//!
//! PORTS: `maze/track-carve.ts`

use crate::grid::{
    at, ensure_arcs, idx, is_walkable, set_shape, set_tile, shape_at, Grid, T_FLOOR, T_WALL,
};
use crate::jsmath::{js_cos, js_hypot, js_sin};
use crate::jssort::js_sort_by;
use crate::maze::track_path::TrackPath;
use crate::maze::CountingRng;
use crate::maze::TrackMask;
use crate::tile_shape::{SHAPE_ARC, SHAPE_FULL};

/// Publish the circuit's own banked turns into `Grid.arcs` and mark their wall shoulder tiles with `SHAPE_ARC`.
pub fn publish_arcs(g: &mut Grid, path: &TrackPath) {
    ensure_arcs(g);
    for a in &path.arcs {
        let mut own = Vec::new();
        let steps = (8_i32).max(((a.r * a.span) / 0.3).ceil() as i32);
        for s in 0..=steps {
            let ang = a.a0 + (a.span * s as f64) / steps as f64;
            let mut d = 2.0_f64;
            while d <= 4.50001 {
                let i = (a.cx + js_cos(ang) * (a.r - d)).floor() as i32;
                let j = (a.cz + js_sin(ang) * (a.r - d)).floor() as i32;
                d += 0.5;
                if i < 0 || j < 0 || i >= g.w || j >= g.h {
                    continue;
                }
                if at(g, i, j) != T_WALL {
                    continue;
                }
                if shape_at(g, i, j) == SHAPE_ARC {
                    continue;
                }
                own.push(idx(g, i, j));
            }
        }
        if own.is_empty() {
            continue;
        }
        let fi = g.arcs.len() as i16;
        let mut feat = a.clone();
        feat.owner = Some("track");
        g.arcs.push(feat);
        for &k in &own {
            g.shapes[k] = SHAPE_ARC;
            if let Some(arr) = g.arc_idx.as_mut() {
                arr[k] = fi;
            }
        }
    }
}


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

/// Wall tiles pressed against a SEALED lane — the keep-out for [`connect_all`].
///
/// Derived on demand from the mask rather than handed around, so it is always in
/// step with whatever is currently sealed.
pub fn sealed_walls(g: &Grid, mask: &TrackMask) -> Vec<u8> {
    let mut out = vec![0_u8; (g.w * g.h) as usize];
    for j in 1..g.h - 1 {
        for i in 1..g.w - 1 {
            if is_walkable(g, i, j) {
                continue;
            }
            // Two tiles deep: a repair corridor that merely clips the outer
            // column still leaves a one-tile membrane, and `removeWallStubs`
            // deletes those.
            //
            // The TS breaks out by assigning `di = 3; dj = 3` inside the loops,
            // which ends both. A labelled break is the same control flow.
            'probe: for dj in -2..=2 {
                for di in -2..=2 {
                    if is_sealed(g, mask, i + di, j + dj) {
                        out[idx(g, i, j)] = 1;
                        break 'probe;
                    }
                }
            }
        }
    }
    out
}

/// Pass 6 of 23 — `grow-maze`: grow the maze into everything the track did not
/// claim, then punch the on-ramps.
///
/// A randomised-flood growth (a growing-tree over open cells) rather than the
/// classic perfect-maze backtracker, because a perfect maze would wall the track
/// off into a corridor with two exits. Every carved cell is checked against the
/// track mask and a KEEP-OUT margin, so corridors approach the circuit and stop.
///
/// `link_chance` then punches the ON-RAMPS: controlled openings from the maze
/// onto the track. That is the one place the two systems touch, and it is a
/// single tunable rather than an emergent accident.
///
/// ⚠️ **This pass is where the rng budget goes**, and three separate draw
/// sources feed one stream in a fixed interleaving: the growing-tree pick, the
/// direction shuffle (see [`crate::jssort`] — its comparison COUNT is itself
/// part of the stream, four or five draws depending on the results), and the
/// per-wall on-ramp roll.
pub fn grow_maze_around(
    g: &mut Grid,
    mask: &TrackMask,
    rng: &mut CountingRng,
    margin: i32,
    link_chance: f64,
    density: f64,
    fill: f64,
) {
    // A cell may be carved only if it is clear of the track by `margin`.
    let clear_of_track = |g: &Grid, i: i32, j: i32| -> bool {
        for dj in -margin..=margin {
            for di in -margin..=margin {
                let x = i + di;
                let y = j + dj;
                if x < 0 || y < 0 || x >= g.w || y >= g.h {
                    continue;
                }
                if on_lane(g, mask, x, y) {
                    return false;
                }
            }
        }
        true
    };

    // Odd-coordinate cell lattice, the same convention the shipped generator
    // uses (odd = cell, even = the wall between two cells), so downstream passes
    // that assume it keep working.
    let mut frontier: Vec<(i32, i32)> = Vec::new();
    let mut in_maze = vec![0_u8; (g.w * g.h) as usize];

    // Seed from cells adjacent to the track — the maze grows OUT of the circuit,
    // which is what makes the layout read as "highways with districts hanging
    // off them" rather than two unrelated systems sharing a grid.
    let mut j = 1;
    while j < g.h - 1 {
        let mut i = 1;
        while i < g.w - 1 {
            if clear_of_track(g, i, j) {
                let mut near_track = false;
                let mut d = 1;
                while d <= 3 && !near_track {
                    for (di, dj) in [(d, 0), (-d, 0), (0, d), (0, -d)] {
                        let x = i + di;
                        let y = j + dj;
                        if x < 0 || y < 0 || x >= g.w || y >= g.h {
                            continue;
                        }
                        if on_lane(g, mask, x, y) {
                            near_track = true;
                        }
                    }
                    d += 1;
                }
                if near_track {
                    frontier.push((i, j));
                }
            }
            i += 2;
        }
        j += 2;
    }
    // Fall back to any legal cell if the track hugged the walls.
    if frontier.is_empty() {
        let mut j = 1;
        while j < g.h - 1 {
            let mut i = 1;
            while i < g.w - 1 {
                if clear_of_track(g, i, j) {
                    frontier.push((i, j));
                }
                i += 2;
            }
            j += 2;
        }
    }
    if frontier.is_empty() {
        return;
    }

    // GROW FROM EVERY SEED, not one. A single seed only fills the pocket it
    // happens to land in, and the track cuts the leftover space into SEVERAL
    // disjoint pockets — observed, one seed left a floor 97% track with a single
    // tiny maze scrap.
    let mut active: Vec<(i32, i32)> = Vec::new();
    for &(fi, fj) in &frontier {
        if in_maze[idx(g, fi, fj)] != 0 {
            continue;
        }
        set_tile(g, fi, fj, T_FLOOR);
        in_maze[idx(g, fi, fj)] = 1;
        active.push((fi, fj));
    }

    // Budget: stop once `fill` of the legal cells are carved, leaving rock.
    let mut legal = 0_i64;
    let mut j = 1;
    while j < g.h - 1 {
        let mut i = 1;
        while i < g.w - 1 {
            if clear_of_track(g, i, j) {
                legal += 1;
            }
            i += 2;
        }
        j += 2;
    }
    // `Math.round` is HALF-UP toward +infinity, which is NOT Rust's `round`
    // (half away from zero). Identical for the positive values here; written
    // this way so the difference is on the page rather than in someone's head.
    let budget = ((legal as f64 * fill).round() as i64).max(1);
    let mut carved = active.len() as i64;

    while !active.is_empty() && carved < budget {
        // Growing-tree: mostly newest-first (long winding corridors), sometimes
        // random (branching). One knob spans backtracker↔Prim.
        let pick = if rng.next_f64() < density {
            active.len() - 1
        } else {
            (rng.next_f64() * active.len() as f64).floor() as usize
        };
        let c = active[pick];
        let mut order = [(2, 0), (-2, 0), (0, 2), (0, -2)];
        // THE BROKEN SHUFFLE IS THE ORACLE. One draw per comparison, and V8
        // makes four or five of them depending on the results — see `jssort`.
        js_sort_by(&mut order, |_, _| rng.next_f64() - 0.5);
        let mut grew = false;
        for (di, dj) in order {
            let ni = c.0 + di;
            let nj = c.1 + dj;
            if ni < 1 || nj < 1 || ni >= g.w - 1 || nj >= g.h - 1 {
                continue;
            }
            if in_maze[idx(g, ni, nj)] != 0 {
                continue;
            }
            if !clear_of_track(g, ni, nj) {
                continue;
            }
            let wi = c.0 + di / 2;
            let wj = c.1 + dj / 2;
            if !clear_of_track(g, wi, wj) {
                continue;
            }
            set_tile(g, wi, wj, T_FLOOR);
            set_tile(g, ni, nj, T_FLOOR);
            in_maze[idx(g, ni, nj)] = 1;
            active.push((ni, nj));
            carved += 1;
            grew = true;
            break;
        }
        if !grew {
            active.remove(pick);
        }
    }

    // ON-RAMPS — the only sanctioned way in and out of the circuit. Without
    // these the maze is a sealed district beside a sealed track and the floor is
    // unplayable; with too many the circuit stops reading as a circuit.
    for j in 1..g.h - 1 {
        for i in 1..g.w - 1 {
            if at(g, i, j) != T_WALL {
                continue;
            }
            let touches_track = on_lane(g, mask, i - 1, j)
                || on_lane(g, mask, i + 1, j)
                || on_lane(g, mask, i, j - 1)
                || on_lane(g, mask, i, j + 1);
            if !touches_track {
                continue;
            }
            // A SEALED lane (the launch chute) takes no on-ramps. This is the
            // pass that was drilling them: measured before the check, only 28/60
            // floors kept both chute walls intact.
            if is_sealed(g, mask, i - 1, j)
                || is_sealed(g, mask, i + 1, j)
                || is_sealed(g, mask, i, j - 1)
                || is_sealed(g, mask, i, j + 1)
            {
                continue;
            }
            let mut maze_side = false;
            for (di, dj) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let x = i + di;
                let y = j + dj;
                if is_walkable(g, x, y) && !on_lane(g, mask, x, y) {
                    maze_side = true;
                }
            }
            // ⚠️ The draw happens ONLY when `maze_side`. `&&` short-circuits in
            // JS too, so a port that rolls first and tests after spends draws
            // the oracle never spends and desynchronises everything downstream.
            if maze_side && rng.next_f64() < link_chance {
                set_tile(g, i, j, T_FLOOR);
            }
        }
    }

    widen_maze_corridors(g, mask, rng, 0.72);
    let avoid = sealed_walls(g, mask);
    connect_all(g, Some(&avoid));
}

/// WIDEN the maze from 1-wide slots into 2-wide corridors and small chambers.
///
/// The maze grows on the odd-coordinate lattice, so its corridors are one tile
/// wide, and at this floor's resolution that reads as graph paper — a dead-end
/// census reported 38.3 maze dead ends per floor against the track's 0.1.
///
/// Deleting them was tried first and is the wrong tool: an unbounded dead-end
/// cascade unravels a 1-wide corridor completely (each tile becomes a dead end
/// as soon as the one ahead is filled), which reduced off-track floor to 1.5% of
/// the grid — the maze vanished and the level read as one track blob. Widening
/// fixes the cause instead: a 2-wide corridor has no 3-walled tiles by
/// construction.
fn widen_maze_corridors(g: &mut Grid, mask: &TrackMask, rng: &mut CountingRng, chance: f64) {
    let mut add: Vec<usize> = Vec::new();
    for j in 1..g.h - 1 {
        for i in 1..g.w - 1 {
            if !is_walkable(g, i, j) || on_lane(g, mask, i, j) {
                continue;
            }
            // Widen toward a solid neighbour that is itself clear of the track,
            // so corridors thicken into the rock rather than eating into the
            // lane's shoulder.
            for (di, dj) in [(1, 0), (0, 1)] {
                let x = i + di;
                let y = j + dj;
                if x < 1 || y < 1 || x >= g.w - 1 || y >= g.h - 1 {
                    continue;
                }
                if is_walkable(g, x, y) {
                    continue;
                }
                if on_lane(g, mask, x, y) {
                    continue;
                }
                // Keep off the lane's immediate shoulder (and any published arc
                // rim). The TS breaks the outer loop early via `&& !nearLane`.
                let mut near_lane = false;
                for dj2 in -1..=1 {
                    if near_lane {
                        break;
                    }
                    for di2 in -1..=1 {
                        if on_lane(g, mask, x + di2, y + dj2) {
                            near_lane = true;
                        }
                    }
                }
                if near_lane {
                    continue;
                }
                if let Some(ai) = g.arc_idx.as_ref() {
                    if ai[idx(g, x, y)] >= 0 {
                        continue;
                    }
                }
                if rng.next_f64() < chance {
                    add.push(idx(g, x, y));
                }
            }
        }
    }
    // Applied after the scan so the result does not depend on scan order.
    for k in add {
        let w = g.w as usize;
        set_tile(g, (k % w) as i32, (k / w) as i32, T_FLOOR);
    }
}

/// GUARANTEE ONE COMPONENT. Non-negotiable, and it must run last.
///
/// The probabilistic on-ramp pass is a look-and-feel dial, not a connectivity
/// mechanism, and treating it as one is a trap: it only considers walls that
/// TOUCH the track, so a district two corridors deep can never be reached
/// however high `link_chance` goes. Measured without this pass: 83 components on
/// a single 70×44 floor, and 75/75 test floors fragmented.
///
/// Flood from the largest component, find any floor tile that was not reached,
/// and punch the shortest wall run back to reached space. Carving wall→floor
/// only ever ADDS connectivity, so this cannot break anything upstream, and it
/// terminates because every pass strictly grows the reached set.
///
/// `avoid` marks walls the repair should route AROUND if it can — today the
/// launch chute's side walls, which a shortest-path corridor otherwise loves to
/// punch straight through. It is a preference, not a prohibition: if the only
/// route to a stranded pocket crosses an avoided wall the search retries without
/// the mask. **Connectivity always wins**, and that precedence is why
/// `reseal_chute` exists to clean up afterwards rather than the other way round.
///
/// Draws NOTHING, despite the legacy signature taking an `rng` — so the
/// parameter is dropped rather than carried, since an unused rng in a port whose
/// whole contract is draw order is a thing someone will eventually draw from.
pub fn connect_all(g: &mut Grid, avoid: Option<&[u8]>) {
    let n = (g.w * g.h) as usize;
    let w = g.w as usize;

    let flood = |g: &Grid, from: usize| -> Vec<u8> {
        let mut seen = vec![0_u8; n];
        // A STACK popped from the END — the TS uses `Array.prototype.pop`, so
        // this is depth-first in a specific order.
        let mut st = vec![from];
        seen[from] = 1;
        while let Some(k) = st.pop() {
            let i = (k % w) as i32;
            let j = (k / w) as i32;
            for (di, dj) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let x = i + di;
                let y = j + dj;
                if x < 0 || y < 0 || x >= g.w || y >= g.h {
                    continue;
                }
                let kk = idx(g, x, y);
                if seen[kk] != 0 || !is_walkable(g, x, y) {
                    continue;
                }
                seen[kk] = 1;
                st.push(kk);
            }
        }
        seen
    };

    // Anchor on the biggest component — that is the track, and everything else
    // should join TO the circuit rather than to some stray pocket.
    let mut anchor: i64 = -1;
    let mut best: i64 = -1;
    let mut visited = vec![0_u8; n];
    for k in 0..n {
        if visited[k] != 0 || !is_walkable(g, (k % w) as i32, (k / w) as i32) {
            continue;
        }
        let seen = flood(g, k);
        let mut count = 0_i64;
        for m in 0..n {
            if seen[m] != 0 {
                count += 1;
                visited[m] = 1;
            }
        }
        // Strictly greater: the FIRST component of the maximal size wins, which
        // on a tie is the one with the lowest index.
        if count > best {
            best = count;
            anchor = k as i64;
        }
    }
    if anchor < 0 {
        return;
    }

    for _guard in 0..400 {
        let seen = flood(g, anchor as usize);
        // Any unreached floor tile is a stranded pocket. FIRST by index — not
        // nearest, not largest. Arbitrary, and it is the oracle's arbitrary.
        let mut target: i64 = -1;
        for k in 0..n {
            if is_walkable(g, (k % w) as i32, (k / w) as i32) && seen[k] == 0 {
                target = k as i64;
                break;
            }
        }
        if target < 0 {
            return; // one component — done
        }
        let target = target as usize;

        // BFS through WALLS from the stranded tile until it touches reached
        // space, then carve that corridor. Shortest-path so the opening is
        // minimal and the circuit keeps its shape.
        //
        // Run once respecting `avoid`, and again ignoring it if that found
        // nothing. Ordering the attempts this way (rather than weighting one
        // search) keeps the guarantee crisp: pass 2 is exactly the search that
        // shipped before, so the mask can change WHICH corridor gets carved but
        // never WHETHER one does.
        let search = |g: &Grid, blocked: Option<&[u8]>| -> (i64, Vec<i32>) {
            let mut prev = vec![-1_i32; n];
            // A QUEUE shifted from the FRONT — `Array.prototype.shift`.
            let mut q = std::collections::VecDeque::from([target]);
            let mut mark = vec![0_u8; n];
            mark[target] = 1;
            let mut hit: i64 = -1;
            while let Some(k) = q.pop_front() {
                if hit >= 0 {
                    break;
                }
                let i = (k % w) as i32;
                let j = (k / w) as i32;
                for (di, dj) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                    let x = i + di;
                    let y = j + dj;
                    if x < 1 || y < 1 || x >= g.w - 1 || y >= g.h - 1 {
                        continue;
                    }
                    let kk = idx(g, x, y);
                    if mark[kk] != 0 {
                        continue;
                    }
                    if blocked.is_some_and(|b| b[kk] != 0) && seen[kk] == 0 {
                        continue;
                    }
                    mark[kk] = 1;
                    prev[kk] = k as i32;
                    if seen[kk] != 0 {
                        hit = kk as i64;
                        break;
                    }
                    q.push_back(kk);
                }
            }
            (hit, prev)
        };

        let mut r = search(g, avoid);
        if r.0 < 0 && avoid.is_some() {
            r = search(g, None);
        }
        if r.0 < 0 {
            return; // nothing reachable at all — leave it rather than loop
        }
        // Walk the parent chain back, carving. Stops BEFORE `target` itself,
        // which is already floor.
        let mut k = r.0;
        while k != -1 && k as usize != target {
            set_tile(g, (k as usize % w) as i32, (k as usize / w) as i32, T_FLOOR);
            k = i64::from(r.1[k as usize]);
        }
    }
}

/// Every tile the circuit claimed — used to keep later passes off the track.
pub fn lane_tiles(g: &Grid, mask: &TrackMask) -> Vec<(i32, i32)> {
    let mut out = Vec::new();
    for j in 0..g.h {
        for i in 0..g.w {
            if on_lane(g, mask, i, j) {
                out.push((i, j));
            }
        }
    }
    out
}
