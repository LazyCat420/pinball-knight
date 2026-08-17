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

/// State tracker for self-firing environmental hazards.
#[derive(Debug, Clone, Default)]
pub struct HazardState {
    pub haz_time: f64,
    pub elec_cd: f64,
    pub vent_cd: f64,
}

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

/// Ticks hazard cooldowns and hazard clock.
pub fn simulate_hazards(state: &mut HazardState, dt: f64) {
    state.haz_time += dt;
    state.elec_cd = (state.elec_cd - dt).max(0.0);
    state.vent_cd = (state.vent_cd - dt).max(0.0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hazard_lane_geometry_and_timings() {
        // Point along lane axis
        assert!(in_hazard_lane(0.0, 0.0, 1.0, 0.0, 0.5, 0.1, 1.0, 0.3));
        // Point outside across-lane half width
        assert!(!in_hazard_lane(0.0, 0.0, 1.0, 0.0, 0.5, 0.4, 1.0, 0.3));
        // Point behind origin
        assert!(!in_hazard_lane(0.0, 0.0, 1.0, 0.0, -0.2, 0.0, 1.0, 0.3));
    }

    #[test]
    fn electric_plate_duty_cycle() {
        assert!(is_electric_live(0.5, 0.0));
        assert!(is_electric_live(1.7, 0.0));
        assert!(!is_electric_live(1.9, 0.0));
        assert!(!is_electric_live(2.9, 0.0));
        assert!(is_electric_live(3.1, 0.0)); // 3.1 % 3.0 = 0.1 < 1.8
    }

    #[test]
    fn simulate_hazards_ticks_state() {
        let mut haz = HazardState {
            haz_time: 0.0,
            elec_cd: 1.0,
            vent_cd: 1.0,
        };
        simulate_hazards(&mut haz, 0.5);
        assert!((haz.haz_time - 0.5).abs() < 1e-6);
        assert!((haz.elec_cd - 0.5).abs() < 1e-6);
        assert!((haz.vent_cd - 0.5).abs() < 1e-6);
    }
}
