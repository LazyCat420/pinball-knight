//! Pure pinball marble mode steering calculations.
//!
//! Baseline high-angle turn-radius boosting and directional counter-braking:
//! - High-angle steering assistance scales up smoothly as requested aim direction opposes travel heading.
//! - When aim opposes travel strongly (dot < PINBALL_COUNTER_BRAKE_DOT), directional forward braking
//!   slows forward carry to produce a compact, carved U-turn without snapping or stopping dead.
//! - Delta per frame is clamped to PINBALL_TURN_MAX_DELTA * dt.

use crate::constants::pinball::{
    PINBALL_COUNTER_BRAKE, PINBALL_COUNTER_BRAKE_DOT, PINBALL_STEER, PINBALL_TURN_BOOST_MAX,
    PINBALL_TURN_BOOST_START_DOT, PINBALL_TURN_MAX_DELTA,
};
use crate::jsmath::js_hypot;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PinballSteeringInput {
    pub mom_x: f64,
    pub mom_z: f64,
    pub mom_speed: f64,
    pub aim_x: f64,
    pub aim_z: f64,
    pub steer_mul: f64,
    pub dt: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PinballSteeringResult {
    pub mom_x: f64,
    pub mom_z: f64,
    pub mom_speed: f64,
    pub opposition: f64,
    pub dot: f64,
}

fn clamp01(v: f64) -> f64 {
    if v < 0.0 {
        0.0
    } else if v > 1.0 {
        1.0
    } else {
        v
    }
}

pub fn resolve_pinball_steering(input: PinballSteeringInput) -> PinballSteeringResult {
    let PinballSteeringInput {
        mom_x,
        mom_z,
        mom_speed,
        aim_x,
        aim_z,
        steer_mul,
        dt,
    } = input;

    if dt <= 0.0 || steer_mul <= 0.0 {
        return PinballSteeringResult {
            mom_x,
            mom_z,
            mom_speed,
            opposition: 0.0,
            dot: 1.0,
        };
    }

    let aim_len = js_hypot(aim_x, aim_z);
    if aim_len <= 1e-6 {
        return PinballSteeringResult {
            mom_x,
            mom_z,
            mom_speed,
            opposition: 0.0,
            dot: 1.0,
        };
    }

    let norm_aim_x = aim_x / aim_len;
    let norm_aim_z = aim_z / aim_len;

    let mom_len = js_hypot(mom_x, mom_z);
    let (norm_mom_x, norm_mom_z) = if mom_len > 1e-6 {
        (mom_x / mom_len, mom_z / mom_len)
    } else {
        (norm_aim_x, norm_aim_z)
    };

    // Dot product between current heading and desired aim (-1 = reverse, 1 = forward)
    let dot = norm_mom_x * norm_aim_x + norm_mom_z * norm_aim_z;

    // Opposition factor: 0 when aligned/slight angle (dot >= START_DOT), 1 when directly behind (dot = -1)
    let opposition = clamp01((PINBALL_TURN_BOOST_START_DOT - dot) / (PINBALL_TURN_BOOST_START_DOT + 1.0));
    let turn_mul = 1.0 + opposition * (PINBALL_TURN_BOOST_MAX - 1.0);

    // Directional counter-braking against forward travel when opposing motion
    let mut new_speed = mom_speed;
    if dot < PINBALL_COUNTER_BRAKE_DOT && mom_speed > 0.0 {
        let brake_strength = clamp01((PINBALL_COUNTER_BRAKE_DOT - dot) / (PINBALL_COUNTER_BRAKE_DOT + 1.0));
        let brake_amount = PINBALL_COUNTER_BRAKE * brake_strength * steer_mul * dt;
        new_speed = (mom_speed - brake_amount).max(0.0);
    }

    // Additive steering acceleration scaled by turn multiplier
    let mut steer_delta_x = norm_aim_x * PINBALL_STEER * steer_mul * turn_mul * dt;
    let mut steer_delta_z = norm_aim_z * PINBALL_STEER * steer_mul * turn_mul * dt;

    // Clamp per-frame delta to protect against lag spikes
    let delta_len = js_hypot(steer_delta_x, steer_delta_z);
    let max_delta = PINBALL_TURN_MAX_DELTA * dt;
    if delta_len > max_delta && delta_len > 0.0 {
        steer_delta_x = (steer_delta_x / delta_len) * max_delta;
        steer_delta_z = (steer_delta_z / delta_len) * max_delta;
    }

    // Apply steering impulse to heading
    let updated_x = norm_mom_x + steer_delta_x;
    let updated_z = norm_mom_z + steer_delta_z;
    let updated_len = js_hypot(updated_x, updated_z);

    let (final_mom_x, final_mom_z) = if updated_len > 1e-6 {
        (updated_x / updated_len, updated_z / updated_len)
    } else {
        (norm_aim_x, norm_aim_z)
    };

    PinballSteeringResult {
        mom_x: final_mom_x,
        mom_z: final_mom_z,
        mom_speed: new_speed,
        opposition,
        dot,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forward_aim_retains_baseline_steering_with_no_braking() {
        let input = PinballSteeringInput {
            mom_x: 1.0,
            mom_z: 0.0,
            mom_speed: 10.0,
            aim_x: 1.0,
            aim_z: 0.0,
            steer_mul: 1.0,
            dt: 0.016,
        };
        let res = resolve_pinball_steering(input);
        assert!((res.dot - 1.0).abs() < 1e-4);
        assert_eq!(res.opposition, 0.0);
        assert_eq!(res.mom_speed, 10.0);
        assert!((res.mom_x - 1.0).abs() < 1e-4);
        assert!(res.mom_z.abs() < 1e-4);
    }

    #[test]
    fn sideways_aim_boosts_turning_without_braking() {
        let input = PinballSteeringInput {
            mom_x: 1.0,
            mom_z: 0.0,
            mom_speed: 10.0,
            aim_x: 0.0,
            aim_z: 1.0,
            steer_mul: 1.0,
            dt: 0.016,
        };
        let res = resolve_pinball_steering(input);
        assert!(res.dot.abs() < 1e-4);
        assert!(res.opposition > 0.0);
        assert_eq!(res.mom_speed, 10.0);
        assert!(res.mom_z > 0.0);
    }

    #[test]
    fn reverse_aim_applies_turn_boost_and_counter_braking() {
        let input = PinballSteeringInput {
            mom_x: 1.0,
            mom_z: 0.0,
            mom_speed: 10.0,
            aim_x: -1.0,
            aim_z: 0.0,
            steer_mul: 1.0,
            dt: 0.016,
        };
        let res = resolve_pinball_steering(input);
        assert!((res.dot - -1.0).abs() < 1e-4);
        assert!((res.opposition - 1.0).abs() < 1e-4);
        assert!(res.mom_speed < 10.0);
    }

    #[test]
    fn open_space_u_turn_reverses_heading() {
        let mut mom_x = 1.0;
        let mut mom_z = 0.0;
        let mut mom_speed = 12.0;
        let dt = 1.0 / 60.0;

        for _ in 0..60 {
            let res = resolve_pinball_steering(PinballSteeringInput {
                mom_x,
                mom_z,
                mom_speed,
                aim_x: -1.0,
                aim_z: 0.2,
                steer_mul: 1.0,
                dt,
            });
            mom_x = res.mom_x;
            mom_z = res.mom_z;
            mom_speed = res.mom_speed;
        }

        assert!(mom_x < 0.0);
    }
}
