// Parity test suite for Pinball Ground Aim Indicator Visuals.
// Replicates legacy/src/game/pinball-knight/render/aim-indicator.ts

use pk_gui::render::aim_indicator::AimIndicatorVisual;

#[test]
fn aim_indicator_hides_below_minimum_roll_speed() {
    let mut indicator = AimIndicatorVisual::new();

    indicator.update(10.0, 10.0, 1.0, 0.0, None, 0.2, 10.0);
    assert!(!indicator.is_visible());

    indicator.update(10.0, 10.0, 1.0, 0.0, None, 2.5, 10.0);
    assert!(indicator.is_visible());
}

#[test]
fn aim_indicator_resolves_heading_steer_and_bend() {
    let mut indicator = AimIndicatorVisual::new();

    // Moving East (1.0, 0.0), steering North (0.0, -1.0)
    indicator.update(0.0, 0.0, 1.0, 0.0, Some((0.0, -1.0)), 5.0, 10.0);
    assert!(indicator.is_visible());

    let state = &indicator.state;
    assert_eq!(state.heading_angle, 0.0);
    assert!(state.steer_angle.is_some());
    assert!(state.bend_fraction > 0.0 && state.bend_fraction <= 1.0);
    assert_eq!(state.scale, 0.5);
}
