// Parity test suite for Aim Indicator Ground Geometry.
// Replicates legacy/src/game/pinball-knight/render/aim-indicator-math.ts

use pk_gui::render::aim_indicator_math::{bend_fraction, steer_sign};

#[test]
fn bend_fraction_evaluates_linear_degree_proportions() {
    // Collinear heading and steer
    assert_eq!(bend_fraction(1.0, 0.0, 1.0, 0.0), 0.0);

    // 90 degree perpendicular turn
    let b90 = bend_fraction(1.0, 0.0, 0.0, 1.0);
    assert!((b90 - 0.5).abs() < 1e-6);

    // 180 degree exact reversal
    let b180 = bend_fraction(1.0, 0.0, -1.0, 0.0);
    assert!((b180 - 1.0).abs() < 1e-6);

    // Degenerate zero vector guard
    assert_eq!(bend_fraction(0.0, 0.0, 1.0, 0.0), 0.0);
    assert_eq!(bend_fraction(1.0, 0.0, 0.0, 0.0), 0.0);
}

#[test]
fn steer_sign_determines_turn_orientation() {
    // Forward +Z, steer +X (right turn)
    assert_eq!(steer_sign(0.0, 1.0, 1.0, 0.0), -1); // momX*steerZ - momZ*steerX = 0 - 1 = -1

    // Forward +X, steer +Z
    assert_eq!(steer_sign(1.0, 0.0, 0.0, 1.0), 1); // 1*1 - 0*0 = 1

    // Collinear
    assert_eq!(steer_sign(1.0, 0.0, 2.0, 0.0), 0);
}
