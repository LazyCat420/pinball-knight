//! Self-firing hazard simulation — boxing gloves, electric grids, and fire vents.
//!
//! Port of `legacy/src/game/pinball-knight/entities/hazards.ts` (134 lines).
//!
//! PORTS: `entities/hazards.ts`

pub const GLOVE_ACTIVE: f64 = 0.22;
pub const GLOVE_LANE_LEN: f64 = 1.4;
pub const GLOVE_LANE_HALF: f64 = 0.42;
pub const GLOVE_SPEED: f64 = 18.0;
pub const GLOVE_DAMAGE: f64 = 35.0;
pub const GLOVE_KNOCKBACK: f64 = 2.4;

pub const ELEC_ON: f64 = 1.8;
pub const ELEC_OFF: f64 = 1.2;
pub const ELEC_RADIUS: f64 = 0.65;
pub const ELEC_DAMAGE: f64 = 22.0;
pub const ELEC_ZAP_COOLDOWN: f64 = 0.55;

pub const VENT_WARN: f64 = 0.8;
pub const VENT_ACTIVE: f64 = 1.5;
pub const VENT_LANE_LEN: f64 = 2.2;
pub const VENT_LANE_HALF: f64 = 0.48;
pub const VENT_DAMAGE: f64 = 16.0;
pub const VENT_BURN_COOLDOWN: f64 = 0.4;

/// Checks if point (x, z) is inside the rectangular hazard lane oriented along (dir_x, dir_z).
pub fn in_hazard_lane(
    origin_x: f64,
    origin_z: f64,
    dir_x: f64,
    dir_z: f64,
    x: f64,
    z: f64,
    len: f64,
    half: f64,
) -> bool {
    let rx = x - origin_x;
    let rz = z - origin_z;
    let along = rx * dir_x + rz * dir_z;
    if along < -0.1 || along > len {
        return false;
    }
    let across = (rx * -dir_z + rz * dir_x).abs();
    across <= half
}

/// Computes whether an electric hazard plate is currently energized.
pub fn is_electric_live(haz_time: f64, phase: f64) -> bool {
    let cycle = ELEC_ON + ELEC_OFF;
    ((haz_time + phase).rem_euclid(cycle)) < ELEC_ON
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hazard_lane_geometry_and_timings() {
        // Point along lane axis
        assert!(in_hazard_lane(0.0, 0.0, 1.0, 0.0, 0.5, 0.1, 1.0, 0.3));
        // Point behind origin
        assert!(!in_hazard_lane(0.0, 0.0, 1.0, 0.0, -0.5, 0.0, 1.0, 0.3));
        // Point outside width
        assert!(!in_hazard_lane(0.0, 0.0, 1.0, 0.0, 0.5, 0.8, 1.0, 0.3));

        // Electric phase cycling
        assert!(is_electric_live(0.5, 0.0));
        assert!(!is_electric_live(2.0, 0.0)); // > ELEC_ON
    }
}
