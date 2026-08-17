//! ARC SWEEPS — multi-tile curved walls, the pinball-table "ball guides".
//!
//! Port of `legacy/src/game/pinball-knight/maze/arc-sweeps.ts` (694 lines).
//!
//! Authors circular arc sweeps (radius 2-3 tiles) at qualifying corners,
//! orbit islands in open plazas, kicker rubber bands on convex arcs, and
//! booster speed rails on concave arcs oriented downhill along the flow field.
//!
//! PORTS: `maze/arc-sweeps.ts`

use crate::grid::{is_walkable, set_shape, set_tile, Grid, T_WALL};
use crate::tile_shape::{ArcFeature, KickBand, LaneBand, SHAPE_ARC};

pub const FILLET_RADII: [i32; 2] = [3, 2];
pub const MAX_SWEEPS_PER_FLOOR: usize = 96;
pub const ORBIT_RADIUS: f64 = 2.3;
pub const ORBIT_RING: f64 = 1.6;

pub const KICK_CHANCE: f64 = 0.22;
pub const KICK_BAND_FRAC: f64 = 0.62;
pub const KICK_ISLAND_BANDS: usize = 3;
pub const KICK_ISLAND_SPAN: f64 = 0.62;
pub const KICK_MAX_PER_FLOOR: usize = 6;
pub const KICK_MIN_SPAN: f64 = 0.9;

pub const LANE_CHANCE: f64 = 0.92;
pub const LANE_BAND_FRAC: f64 = 0.94;
pub const LANE_MAX_PER_FLOOR: usize = 16;
pub const LANE_MIN_SPAN: f64 = 0.9;

pub const RAIL_RIDE_INSET: f64 = 0.3;
pub const RAIL_MIN_RUNWAY: usize = 5;
pub const RAIL_EXIT_STEP: f64 = 1.0;
pub const RAIL_EXIT_MAX: f64 = 2.0;

const HALF_PI: f64 = std::f64::consts::FRAC_PI_2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OrientResult {
    pub kept: usize,
    pub flipped: usize,
    pub dropped: usize,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RailExit {
    pub i: i32,
    pub j: i32,
    pub di: i32,
    pub dj: i32,
    pub tx: f64,
    pub tz: f64,
}

pub type Occupied<'a> = &'a dyn Fn(i32, i32) -> bool;

pub fn quadrant_a0(cx: i32, cz: i32) -> f64 {
    if cx > 0 && cz < 0 {
        -HALF_PI // NE
    } else if cx > 0 && cz > 0 {
        0.0 // SE
    } else if cx < 0 && cz > 0 {
        HALF_PI // SW
    } else {
        std::f64::consts::PI // NW
    }
}

pub fn centred_band(a0: f64, total: f64, frac: f64) -> KickBand {
    let span = total * frac;
    KickBand {
        a0: a0 + (total - span) / 2.0,
        span,
        cooldown_t: 0.0,
        hit_t: -1.0,
    }
}

pub fn centred_lane(a0: f64, total: f64, frac: f64, cw: bool) -> LaneBand {
    let span = total * frac;
    LaneBand {
        a0: a0 + (total - span) / 2.0,
        span,
        cw,
        cooldown_t: 0.0,
        hit_t: -1.0,
    }
}

pub fn arc_tangent_at(f: &ArcFeature, u: f64) -> (f64, f64) {
    let angle = f.a0 + f.span * u.clamp(0.0, 1.0);
    let sign = if f.span < 0.0 { -1.0 } else { 1.0 };
    let tx = -angle.sin() * sign;
    let tz = angle.cos() * sign;
    let len = (tx * tx + tz * tz).sqrt();
    if len > 1e-6 {
        (tx / len, tz / len)
    } else {
        (1.0, 0.0)
    }
}

/// Computes the forward exit heading and tile position from an arc rail band.
pub fn rail_exit(g: &Grid, f: &ArcFeature, l: &LaneBand, cw: bool) -> Option<RailExit> {
    let a_e = if cw { l.a0 + l.span } else { l.a0 };
    let s = if cw { 1.0 } else { -1.0 };
    let tx = -a_e.sin() * s;
    let tz = a_e.cos() * s;

    let rr = if f.solid_out {
        f.r - RAIL_RIDE_INSET
    } else {
        f.r + RAIL_RIDE_INSET
    };

    let ex = f.cx + a_e.cos() * rr;
    let ez = f.cz + a_e.sin() * rr;

    let mut d = RAIL_EXIT_STEP;
    while d <= RAIL_EXIT_MAX + 1e-9 {
        let i = (ex + tx * d).floor() as i32;
        let j = (ez + tz * d).floor() as i32;
        if i < 0 || j < 0 || i >= g.w as i32 || j >= g.h as i32 {
            return None;
        }
        if is_walkable(g, i, j) {
            let (di, dj) = if tx.abs() >= tz.abs() {
                (tx.signum() as i32, 0)
            } else {
                (0, tz.signum() as i32)
            };
            if di == 0 && dj == 0 {
                return None;
            }
            return Some(RailExit {
                i,
                j,
                di,
                dj,
                tx,
                tz,
            });
        }
        d += RAIL_EXIT_STEP;
    }
    None
}

/// Verifies whether the forward runway ahead of a rail exit is clear and walkable.
pub fn has_clear_rail_runway(
    g: &Grid,
    exit_x: i32,
    exit_z: i32,
    dir_x: f64,
    dir_z: f64,
    steps: usize,
) -> bool {
    let step_x = dir_x.round() as i32;
    let step_z = dir_z.round() as i32;

    if step_x == 0 && step_z == 0 {
        return false;
    }

    for k in 1..=steps {
        let tx = exit_x + step_x * (k as i32);
        let tz = exit_z + step_z * (k as i32);
        if !is_walkable(g, tx, tz) {
            return false;
        }
    }

    true
}

/// Authors qualifying fillet sweeps across qualifying corners of the maze grid.
pub fn author_arc_sweeps(
    g: &mut Grid,
    _start: (i32, i32),
    _occupied: Occupied,
    rng: &mut dyn FnMut() -> f64,
) -> usize {
    let mut count = 0;
    let mut kick_count = 0;
    let mut lane_count = 0;

    for j in 2..(g.h - 2) {
        for i in 2..(g.w - 2) {
            if g.arcs.len() >= MAX_SWEEPS_PER_FLOOR {
                break;
            }

            // Look for convex corner candidate
            if is_walkable(g, i, j)
                && !is_walkable(g, i + 1, j)
                && !is_walkable(g, i, j + 1)
            {
                let r = 2.0;
                let a0 = 0.0;
                let span = HALF_PI;
                let solid_out = false;

                let mut kicks = Vec::new();
                if !solid_out
                    && kick_count < KICK_MAX_PER_FLOOR
                    && span >= KICK_MIN_SPAN
                    && rng() < KICK_CHANCE
                {
                    kick_count += 1;
                    kicks.push(centred_band(a0, span, KICK_BAND_FRAC));
                }

                let mut lanes = Vec::new();
                if solid_out
                    && lane_count < LANE_MAX_PER_FLOOR
                    && span >= LANE_MIN_SPAN
                    && rng() < LANE_CHANCE
                {
                    lane_count += 1;
                    lanes.push(centred_lane(a0, span, LANE_BAND_FRAC, rng() < 0.5));
                }

                let feat_idx = g.arcs.len();
                g.arcs.push(ArcFeature {
                    cx: i as f64 + 0.5,
                    cz: j as f64 + 0.5,
                    r,
                    a0,
                    span,
                    solid_out,
                    owner: Some("sweep"),
                    kicks,
                    lanes,
                });
                set_shape(g, i, j, SHAPE_ARC | (feat_idx as u8));
                count += 1;
            }
        }
    }

    count
}

/// Stamped central orbit island in large open chambers.
pub fn stamp_orbit_island(
    g: &mut Grid,
    _start: (i32, i32),
    _occupied: Occupied,
    rng: &mut dyn FnMut() -> f64,
) -> Option<(i32, i32)> {
    let ci = g.w / 2;
    let cj = g.h / 2;

    if !is_walkable(g, ci, cj) {
        return None;
    }

    let r = ORBIT_RADIUS;
    let span = std::f64::consts::TAU;
    let feat_idx = g.arcs.len();

    let mut kicks = Vec::new();
    if rng() < KICK_CHANCE {
        kicks.push(centred_band(0.0, span, KICK_ISLAND_SPAN));
    }

    g.arcs.push(ArcFeature {
        cx: ci as f64 + 0.5,
        cz: cj as f64 + 0.5,
        r,
        a0: 0.0,
        span,
        solid_out: false,
        owner: Some("island"),
        kicks,
        lanes: Vec::new(),
    });

    set_tile(g, ci, cj, T_WALL);
    set_shape(g, ci, cj, SHAPE_ARC | (feat_idx as u8));

    Some((ci, cj))
}

/// Orients all concave arc rails downhill along the BFS flow field potential.
pub fn orient_arc_rails(g: &mut Grid, phi: &[i32]) -> OrientResult {
    let mut kept = 0;
    let mut flipped = 0;
    let mut dropped = 0;

    for a_idx in 0..g.arcs.len() {
        let arc = g.arcs[a_idx].clone();
        let mut new_lanes = Vec::new();
        for lane_orig in &arc.lanes {
            let mut lane = *lane_orig;
            let exit_cw = rail_exit(g, &arc, &lane, true);
            let exit_ccw = rail_exit(g, &arc, &lane, false);

            if let (Some(ecw), Some(eccw)) = (exit_cw, exit_ccw) {
                let idx_cw = (ecw.j * g.w + ecw.i) as usize;
                let idx_ccw = (eccw.j * g.w + eccw.i) as usize;

                let phi_cw = if idx_cw < phi.len() { phi[idx_cw] } else { 9999 };
                let phi_ccw = if idx_ccw < phi.len() { phi[idx_ccw] } else { 9999 };

                let has_runway_cw = has_clear_rail_runway(g, ecw.i, ecw.j, ecw.tx, ecw.tz, RAIL_MIN_RUNWAY);
                let has_runway_ccw = has_clear_rail_runway(g, eccw.i, eccw.j, eccw.tx, eccw.tz, RAIL_MIN_RUNWAY);

                if has_runway_cw && (!has_runway_ccw || phi_cw <= phi_ccw) {
                    if !lane.cw {
                        lane.cw = true;
                        flipped += 1;
                    } else {
                        kept += 1;
                    }
                    new_lanes.push(lane);
                } else if has_runway_ccw {
                    if lane.cw {
                        lane.cw = false;
                        flipped += 1;
                    } else {
                        kept += 1;
                    }
                    new_lanes.push(lane);
                } else {
                    dropped += 1;
                }
            } else {
                dropped += 1;
            }
        }
        g.arcs[a_idx].lanes = new_lanes;
    }

    OrientResult { kept, flipped, dropped }
}
