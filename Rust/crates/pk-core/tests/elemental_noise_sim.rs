// Parity test suite for Elemental Procedural Noise Building Blocks.
// Replicates legacy/src/game/pinball-knight/fx/elements/noise.ts

use pk_core::fx::noise::{band_ramp, disc_mask, disc_p, fbm01, warp};

#[test]
fn disc_p_centers_coordinates_at_origin() {
    let (cx, cy) = disc_p(0.5, 0.5);
    assert!((cx - 0.0).abs() < 1e-6);
    assert!((cy - 0.0).abs() < 1e-6);

    let (rx, ry) = disc_p(1.0, 1.0);
    assert!((rx - 1.0).abs() < 1e-6);
    assert!((ry - 1.0).abs() < 1e-6);
}

#[test]
fn disc_mask_evaluates_smooth_radial_falloff() {
    // Inside inner radius
    assert_eq!(disc_mask(0.5, 0.5, 0.2, 0.8), 1.0);

    // Outside outer radius
    assert_eq!(disc_mask(1.0, 1.0, 0.2, 0.8), 0.0);

    // Midpoint falloff
    let mid = disc_mask(0.5, 0.75, 0.2, 0.8);
    assert!(mid > 0.0 && mid < 1.0);
}

#[test]
fn fbm_and_warp_produce_bounded_continuous_outputs() {
    for i in 0..5 {
        for j in 0..5 {
            let u = i as f64 * 0.2;
            let v = j as f64 * 0.2;
            let (wu, wv) = warp(u, v, 0.1);
            let n = fbm01(wu, wv, 3);
            assert!(n >= 0.0 && n <= 1.0);
        }
    }
}

#[test]
fn band_ramp_quantizes_to_palette_stops() {
    let stops = [0.33, 0.66];
    let ramp = [10, 20, 30];

    assert_eq!(band_ramp(0.1, &stops, &ramp), 10);
    assert_eq!(band_ramp(0.5, &stops, &ramp), 20);
    assert_eq!(band_ramp(0.9, &stops, &ramp), 30);
}
