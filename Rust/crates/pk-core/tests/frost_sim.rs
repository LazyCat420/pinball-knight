// Parity test suite for Frost Angular Crystal Growth Shader Math.
// Replicates legacy/src/game/pinball-knight/fx/elements/frost.ts

use pk_core::fx::frost::{
    compute_frost_intensity, frost_growth_front, frost_spokes, FROST_RAMP, FROST_STOPS,
};

#[test]
fn frost_palette_ramp_and_stops_match_constants() {
    assert_eq!(FROST_RAMP, [1, 29, 31, 22]);
    assert_eq!(FROST_STOPS, [0.20, 0.52, 0.82]);
}

#[test]
fn frost_growth_front_starts_at_fraction_and_clamps_at_one() {
    assert_eq!(frost_growth_front(0.0), 0.35);

    let mid = frost_growth_front(0.5);
    assert!((mid - 0.775).abs() < 1e-4);

    let full = frost_growth_front(1.5);
    assert_eq!(full, 1.0);
}

#[test]
fn frost_spokes_are_periodic_and_symmetric() {
    let s0 = frost_spokes(1.0, 0.0, 0.0); // angle 0
    let s_pi_3 = frost_spokes(0.5, (3.0f32).sqrt() / 2.0, 0.0); // angle PI/3 -> 3 * PI/3 = PI -> cos(PI) = -1 -> abs = 1

    assert!((s0 - 1.0).abs() < 1e-4);
    assert!((s_pi_3 - 1.0).abs() < 1e-4);
}

#[test]
fn compute_frost_intensity_evaluates_at_origin() {
    let val = compute_frost_intensity(
        [0.0, 0.0],
        1.0,
        0.0,
        0.0,
        1.0,
        |_, _, _| 0.2, // 1 - 0.2 = 0.8 * 1.4 = 1.0
        |_, _, _| 0.5,
    );
    assert!(val > 0.0);
}
