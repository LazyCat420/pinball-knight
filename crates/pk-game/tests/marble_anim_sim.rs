//! Marble & Dodge Roll Animation Systems Validation
//! PORTS-NOTHING (Bevy engine simulation tests)

use bevy::prelude::*;
use pk_game::ball_anim::{
    compute_dodge_roll_rotation, compute_dodge_roll_tuck, compute_marble_pinball_rotation,
    MarbleSpinTracker,
};

#[test]
fn dodge_roll_tuck_scaling_bounds() {
    let tuck_start = compute_dodge_roll_tuck(0.0);
    let tuck_end = compute_dodge_roll_tuck(1.0);
    assert!((tuck_start - 0.72).abs() < 1e-4);
    assert!((tuck_end - 0.72).abs() < 1e-4);

    let tuck_mid = compute_dodge_roll_tuck(0.5);
    assert!((tuck_mid - 0.84).abs() < 1e-4);

    assert!((compute_dodge_roll_tuck(-0.5) - 0.72).abs() < 1e-4);
    assert!((compute_dodge_roll_tuck(1.5) - 0.72).abs() < 1e-4);
}

#[test]
fn dodge_roll_rotation_progresses_and_completes_spin() {
    let cam_rot = Quat::IDENTITY;

    let rot_0 = compute_dodge_roll_rotation(cam_rot, 0.0, 1.0, 0.0);
    assert!((rot_0.w.abs() - 1.0).abs() < 1e-4);

    let rot_mid = compute_dodge_roll_rotation(cam_rot, 0.0, 1.0, 0.5);
    assert!(rot_mid.w.abs() < 0.1);

    let rot_end = compute_dodge_roll_rotation(cam_rot, 0.0, 1.0, 1.0);
    assert!((rot_end.w.abs() - 1.0).abs() < 1e-4);
}

#[test]
fn marble_spin_tracker_accumulates_angle_with_speed() {
    let mut tracker = MarbleSpinTracker::default();
    assert_eq!(tracker.spin_angle, 0.0);

    tracker.update(0.0, 0.016);
    assert_eq!(tracker.spin_angle, 0.0);

    tracker.update(6.0, 0.05);
    assert!((tracker.spin_angle - 1.0).abs() < 1e-4);

    for _ in 0..100 {
        tracker.update(12.0, 0.016);
    }
    assert!(tracker.spin_angle >= 0.0 && tracker.spin_angle < std::f32::consts::TAU);
}

#[test]
fn marble_pinball_rotation_combines_tilt_and_transversal_spin() {
    let cam_rot = Quat::IDENTITY;
    let rot = compute_marble_pinball_rotation(cam_rot, 1.0, 0.0, 10.0, 0.5);
    assert!(rot.is_finite());
    assert!((rot.length() - 1.0).abs() < 1e-4);
}
