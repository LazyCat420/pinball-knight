//! Port of `entities/rail.ts` — BANKED RAILS, the inside-curve ride you have
//! to earn. Pure math, mirrored line-for-line; the caller owns the geometry
//! (concave lane contact from `move_circle`), this owns only the rules.
//!
//! PORTS: `entities/rail.ts`

use crate::pinball::{
    PINBALL_MAX_SPEED, RAIL_ACCEL, RAIL_DECAY, RAIL_GRACE, RAIL_HOLD_DOT, RAIL_MIN_SPEED,
    RAIL_OVERSPEED,
};

/// Live rail state, carried on the player between frames.
#[derive(Debug, Clone, Copy)]
pub struct RailState {
    /// Feature index of the arc being ridden, or -1 when not railing.
    pub feature_idx: i32,
    /// Seconds since the hold was last satisfied — drives the grace window.
    pub slip_t: f64,
    /// Seconds on this rail, for FX ramping and scoring.
    pub ride_t: f64,
}

pub fn fresh_rail() -> RailState {
    RailState {
        feature_idx: -1,
        slip_t: 0.0,
        ride_t: 0.0,
    }
}

/// The ceiling while railing — the only way past `PINBALL_MAX_SPEED`.
pub fn rail_cap() -> f64 {
    PINBALL_MAX_SPEED * RAIL_OVERSPEED
}

/// How hard the player is holding INTO the wall, 0..1. `steer` is the raw
/// input (not velocity — that distinction is the whole "earn it" rule).
pub fn hold_strength(steer_x: f64, steer_z: f64, in_x: f64, in_z: f64) -> f64 {
    let len = crate::jsmath::js_hypot(steer_x, steer_z);
    if len < 1e-4 {
        return 0.0;
    }
    let dot = (steer_x / len) * in_x + (steer_z / len) * in_z;
    if dot <= 0.0 {
        0.0
    } else {
        dot
    }
}

/// Is the hold good enough to keep the rail this frame?
pub fn holds_rail(strength: f64) -> bool {
    strength >= RAIL_HOLD_DOT
}

#[derive(Debug, Clone, Copy)]
pub struct RailStep {
    /// Speed after this frame's acceleration (or unchanged if not railing).
    pub speed: f64,
    /// True while the rail is engaged.
    pub riding: bool,
    /// True on the frame the rail is lost — the exit-flourish trigger.
    pub released: bool,
}

/// Advance one frame of railing. Mirrors `stepRail` exactly, grace window and
/// all — the wobble forgiveness is part of the feel contract.
pub fn step_rail(
    rail: &mut RailState,
    contact: bool,
    strength: f64,
    speed: f64,
    dt: f64,
) -> RailStep {
    let was_riding = rail.feature_idx >= 0;

    if contact && holds_rail(strength) {
        rail.slip_t = 0.0;
    } else if was_riding {
        rail.slip_t += dt;
    }

    let lost = !contact || rail.slip_t > RAIL_GRACE || speed < RAIL_MIN_SPEED;
    if was_riding && lost {
        rail.feature_idx = -1;
        rail.slip_t = 0.0;
        rail.ride_t = 0.0;
        return RailStep {
            speed,
            riding: false,
            released: true,
        };
    }
    if !was_riding {
        return RailStep {
            speed,
            riding: false,
            released: false,
        };
    }

    rail.ride_t += dt;
    let next = rail_cap().min(speed + RAIL_ACCEL * strength * dt);
    RailStep {
        speed: next,
        riding: true,
        released: false,
    }
}

/// Try to CATCH a rail this frame.
pub fn try_catch_rail(rail: &mut RailState, feature_idx: i32, strength: f64, speed: f64) -> bool {
    if rail.feature_idx >= 0 {
        return false;
    }
    if speed < RAIL_MIN_SPEED {
        return false;
    }
    if !holds_rail(strength) {
        return false;
    }
    rail.feature_idx = feature_idx;
    rail.slip_t = 0.0;
    rail.ride_t = 0.0;
    true
}

/// Bleed overspeed back toward the normal cap once off the rail.
pub fn decay_overspeed(speed: f64, dt: f64) -> f64 {
    if speed <= PINBALL_MAX_SPEED {
        return speed;
    }
    PINBALL_MAX_SPEED.max(speed - RAIL_DECAY * dt)
}

// Ported line-for-line from legacy entities/rail.test.ts (22 cases).
#[cfg(test)]
mod tests {
    use super::*;
    const DT: f64 = 1.0 / 60.0;

    // ── holdStrength — you have to steer INTO the wall ──
    #[test]
    fn full_when_input_points_straight_at_the_bank() {
        assert!((hold_strength(0.0, -1.0, 0.0, -1.0) - 1.0).abs() < 1e-5);
    }
    #[test]
    fn zero_when_input_points_away() {
        assert_eq!(hold_strength(0.0, 1.0, 0.0, -1.0), 0.0);
    }
    #[test]
    fn zero_with_no_input_coasting_must_drop_the_rail() {
        assert_eq!(hold_strength(0.0, 0.0, 0.0, -1.0), 0.0);
    }
    #[test]
    fn scales_with_how_well_the_line_is_held() {
        let lazy = hold_strength(1.0, -1.0, 0.0, -1.0);
        let committed = hold_strength(0.0, -1.0, 0.0, -1.0);
        assert!(lazy > 0.0 && lazy < committed);
    }
    #[test]
    fn normalises_input_so_a_bigger_push_is_not_a_better_hold() {
        assert!(
            (hold_strength(0.0, -9.0, 0.0, -1.0) - hold_strength(0.0, -1.0, 0.0, -1.0)).abs()
                < 1e-5
        );
    }

    // ── catching a rail ──
    #[test]
    fn catches_when_fast_enough_and_holding() {
        let mut r = fresh_rail();
        assert!(try_catch_rail(&mut r, 3, 1.0, 12.0));
        assert_eq!(r.feature_idx, 3);
    }
    #[test]
    fn refuses_below_the_speed_floor() {
        let mut r = fresh_rail();
        assert!(!try_catch_rail(&mut r, 3, 1.0, RAIL_MIN_SPEED - 0.1));
    }
    #[test]
    fn refuses_without_a_hold_however_fast() {
        let mut r = fresh_rail();
        assert!(!try_catch_rail(&mut r, 3, 0.0, 22.0));
    }
    #[test]
    fn does_not_re_catch_while_already_riding() {
        let mut r = fresh_rail();
        try_catch_rail(&mut r, 3, 1.0, 12.0);
        assert!(!try_catch_rail(&mut r, 7, 1.0, 12.0));
        assert_eq!(r.feature_idx, 3);
    }

    // ── stepRail — the ride ──
    fn ride() -> RailState {
        let mut r = fresh_rail();
        try_catch_rail(&mut r, 1, 1.0, 12.0);
        r
    }
    #[test]
    fn accelerates_while_held() {
        let mut r = ride();
        let out = step_rail(&mut r, true, 1.0, 12.0, DT);
        assert!(out.riding && out.speed > 12.0);
    }
    #[test]
    fn exceeds_the_normal_speed_cap() {
        let mut r = ride();
        let mut s = PINBALL_MAX_SPEED;
        for _ in 0..120 {
            s = step_rail(&mut r, true, 1.0, s, DT).speed;
        }
        assert!(s > PINBALL_MAX_SPEED);
    }
    #[test]
    fn is_still_bounded_overspeed_is_a_ceiling() {
        let mut r = ride();
        let mut s = PINBALL_MAX_SPEED;
        for _ in 0..2000 {
            s = step_rail(&mut r, true, 1.0, s, DT).speed;
        }
        assert!(s <= rail_cap() + 1e-6);
        assert!((rail_cap() - PINBALL_MAX_SPEED * RAIL_OVERSPEED).abs() < 1e-5);
    }
    #[test]
    fn accelerates_harder_for_a_better_held_line() {
        let (mut a, mut b) = (ride(), ride());
        let lazy = step_rail(&mut a, true, 0.4, 12.0, DT).speed;
        let committed = step_rail(&mut b, true, 1.0, 12.0, DT).speed;
        assert!(committed > lazy);
    }
    #[test]
    fn forgives_a_brief_wobble_inside_the_grace_window() {
        let mut r = ride();
        let out = step_rail(&mut r, true, 0.0, 12.0, RAIL_GRACE * 0.5);
        assert!(out.riding && !out.released);
    }
    #[test]
    fn drops_you_once_the_grace_window_elapses() {
        let mut r = ride();
        step_rail(&mut r, true, 0.0, 12.0, RAIL_GRACE * 0.7);
        let out = step_rail(&mut r, true, 0.0, 12.0, RAIL_GRACE * 0.7);
        assert!(!out.riding && out.released);
        assert_eq!(r.feature_idx, -1);
    }
    #[test]
    fn drops_you_the_instant_contact_is_lost() {
        let mut r = ride();
        let out = step_rail(&mut r, false, 1.0, 12.0, DT);
        assert!(!out.riding && out.released);
    }
    #[test]
    fn drops_you_if_you_slow_below_the_floor() {
        let mut r = ride();
        let out = step_rail(&mut r, true, 1.0, RAIL_MIN_SPEED - 0.5, DT);
        assert!(out.released);
    }
    #[test]
    fn reports_released_exactly_once() {
        let mut r = ride();
        step_rail(&mut r, false, 1.0, 12.0, DT);
        let after = step_rail(&mut r, false, 1.0, 12.0, DT);
        assert!(!after.released);
    }
    #[test]
    fn does_nothing_when_not_riding() {
        let mut r = fresh_rail();
        let out = step_rail(&mut r, true, 1.0, 12.0, DT);
        assert!(!out.riding);
        assert_eq!(out.speed, 12.0);
    }

    // ── decayOverspeed — the reward is carried, not confiscated ──
    #[test]
    fn bleeds_overspeed_back_toward_the_cap() {
        let after = decay_overspeed(rail_cap(), 0.5);
        assert!(after < rail_cap() && after > PINBALL_MAX_SPEED);
    }
    #[test]
    fn never_falls_below_the_normal_cap() {
        assert_eq!(decay_overspeed(rail_cap(), 100.0), PINBALL_MAX_SPEED);
    }
    #[test]
    fn leaves_ordinary_pinball_speeds_alone() {
        assert_eq!(decay_overspeed(9.0, 1.0), 9.0);
        assert_eq!(decay_overspeed(PINBALL_MAX_SPEED, 1.0), PINBALL_MAX_SPEED);
    }
    #[test]
    fn takes_a_real_moment_to_bleed_off() {
        let mut s = rail_cap();
        for _ in 0..12 {
            s = decay_overspeed(s, DT);
        }
        assert!(s > PINBALL_MAX_SPEED);
    }
}
