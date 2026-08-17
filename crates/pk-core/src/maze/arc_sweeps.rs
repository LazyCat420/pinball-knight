//! Arc wall sweeps — tangent vectors, rail curves, and wallride trajectories.
//!
//! PORTS-PARTIAL: `maze/arc-sweeps.ts` - NOT a finished port - 54 rust code lines against 341 legacy (16%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use crate::grid::{is_walkable, Grid};
use crate::tile_shape::ArcFeature;

pub const RAIL_MIN_RUNWAY: usize = 3;

#[derive(Debug, Clone, PartialEq)]
pub struct ArcSweep {
    pub feature_idx: usize,
    pub entry_pos: (i32, i32),
    pub exit_pos: (i32, i32),
    pub exit_dir: (f64, f64),
    pub length: f64,
}

/// Calculates the exit tile position and forward heading vector from an arc feature.
pub fn rail_exit(f: &ArcFeature) -> (i32, i32, f64, f64) {
    let end_angle = f.a0 + f.span;
    let ex = (f.cx + f.r * end_angle.cos()).round() as i32;
    let ez = (f.cz + f.r * end_angle.sin()).round() as i32;

    let sign = if f.span < 0.0 { -1.0 } else { 1.0 };
    let dir_x = -end_angle.sin() * sign;
    let dir_z = end_angle.cos() * sign;

    (ex, ez, dir_x, dir_z)
}

/// Computes the normalized tangent unit vector along an arc curve at parameter u in [0, 1].
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
