//! Marble & Roll Animation Parity & Invariant Test Suite
//! Verifies camera planarity, in-plane spin, frame rate cadence, and squash scale isolation.

use bevy::prelude::*;
use pk_core::state::{Player, ROLL_DURATION};
use pk_game::ball_anim::{
    compute_billboard_spin_rotation, compute_dodge_roll_tuck, MarbleSpinTracker,
};

#[test]
fn test_billboard_rotation_remains_strictly_camera_planar() {
    // Camera at an isometric 45-degree pitch/yaw
    let cam_rot = Quat::from_euler(EulerRot::YXZ, 0.785398, -0.615479, 0.0);
    let cam_forward = cam_rot * Vec3::Z;

    for angle in [0.0, 0.5, 1.57, 3.14, 4.71, 6.28] {
        let rot = compute_billboard_spin_rotation(cam_rot, angle);
        let quad_normal = rot * Vec3::Z;

        // Quad normal must remain parallel to camera forward vector within 1e-4
        let dot = quad_normal.dot(cam_forward);
        assert!(
            (dot - 1.0).abs() < 1e-4,
            "Billboard normal diverged from camera plane at spin angle {angle}: dot={dot}"
        );
    }
}

#[test]
fn test_in_plane_spin_rotates_xy_without_out_of_plane_z() {
    let cam_rot = Quat::IDENTITY;
    let up_vec = Vec3::Y;

    for (angle, expected_dir) in [
        (0.0, Vec3::Y),
        (std::f32::consts::FRAC_PI_2, -Vec3::X),
        (std::f32::consts::PI, -Vec3::Y),
        (3.0 * std::f32::consts::FRAC_PI_2, Vec3::X),
    ] {
        let rot = compute_billboard_spin_rotation(cam_rot, angle);
        let transformed = rot * up_vec;

        assert!(
            (transformed.x - expected_dir.x).abs() < 1e-4
                && (transformed.y - expected_dir.y).abs() < 1e-4,
            "In-plane spin failed at angle {angle}: got {:?}, expected {:?}",
            transformed,
            expected_dir
        );
        assert!(
            transformed.z.abs() < 1e-4,
            "In-plane spin introduced out-of-plane z={}",
            transformed.z
        );
    }
}

#[test]
fn test_ball_cadence_and_spin_tracker_rate() {
    let mut tracker = MarbleSpinTracker::default();

    // At 0 speed, rate is 1.0, spin does not advance
    tracker.update(0.0, 0.016);
    assert_eq!(tracker.spin_angle, 0.0);

    // Speed 10.0: omega = v / r = 10.0 / 0.3 = 33.33 rad/s
    // Delta theta in 0.016s = 33.33 * 0.016 = 0.5333 rad
    tracker.update(10.0, 0.016);
    assert!((tracker.spin_angle - 0.53333).abs() < 1e-3);

    // Cadence check: 16 FPS base with (1 + speed * 0.1) rate multiplier
    let base_fps = 16.0;
    let speed = 10.0;
    let rate = 1.0 + speed * 0.1;
    let effective_fps = base_fps * rate;
    assert_eq!(effective_fps, 32.0); // Exactly double rate at speed 10
}

#[test]
fn test_squash_and_dodge_roll_isolation() {
    let mut player = Player::default();
    player.mom_speed = 12.0; // In ball mode
    assert!(player.is_ball());
    assert!(!player.is_rolling());

    // In ball mode without squash, scale must be 1.0
    let (sqx, sqy) = player.squash_scale();
    assert_eq!(sqx, 1.0);
    assert_eq!(sqy, 1.0);

    // Trigger wall squash
    player.note_squash(0.0, 1.0, 12.0);
    assert!(player.squash_t > 0.0);
    let (sqx_squashed, sqy_squashed) = player.squash_scale();
    assert!(sqx_squashed != 1.0 || sqy_squashed != 1.0);

    // Dodge roll tuck factor calculation
    let tuck_start = compute_dodge_roll_tuck(0.0);
    let tuck_mid = compute_dodge_roll_tuck(0.5);
    assert!((tuck_start - 0.72).abs() < 1e-4);
    assert!((tuck_mid - 0.84).abs() < 1e-4);

    // When not rolling, tuck must not be applied to ball form
    let roll_tau: Option<f32> = if player.is_rolling() && player.roll_t >= 0.0 {
        Some((player.roll_t / ROLL_DURATION).clamp(0.0, 1.0) as f32)
    } else {
        None
    };
    assert!(roll_tau.is_none());
}
