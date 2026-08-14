//! High-speed line segment sweep pickup detection.
//!
//! PORTS: `economy/pickups.ts`

pub const PICKUP_RANGE_BASE: f64 = 0.65;
pub const CARD_PICKUP_RANGE: f64 = 1.10;

/// Distance from point (px, pz) to the line SEGMENT (ax, az) -> (bx, bz).
///
/// This ensures high-velocity ball rolls (>15 u/s) never skip over pickups between ticks.
pub fn segment_distance(ax: f64, az: f64, bx: f64, bz: f64, px: f64, pz: f64) -> f64 {
    let dx = bx - ax;
    let dz = bz - az;
    let len_sq = dx * dx + dz * dz;

    if len_sq < 1e-12 {
        let ex = px - ax;
        let ez = pz - az;
        return (ex * ex + ez * ez).sqrt();
    }

    // Projection scalar clamped to [0, 1] segment
    let t = (((px - ax) * dx + (pz - az) * dz) / len_sq).clamp(0.0, 1.0);
    let proj_x = ax + t * dx;
    let proj_z = az + t * dz;

    let rx = px - proj_x;
    let rz = pz - proj_z;
    (rx * rx + rz * rz).sqrt()
}

/// Checks if a player's movement segment intersects an item's grab radius.
pub fn check_segment_pickup(
    prev_x: f64,
    prev_z: f64,
    curr_x: f64,
    curr_z: f64,
    item_x: f64,
    item_z: f64,
    grab_range: f64,
) -> bool {
    segment_distance(prev_x, prev_z, curr_x, curr_z, item_x, item_z) <= grab_range
}
