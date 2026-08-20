// Parity test suite for Lightning Rod Elemental Surface Math.
// Replicates legacy/src/game/pinball-knight/fx/elements/rod.ts

use pk_core::fx::rod::{
    compute_rod_core, compute_rod_hum, compute_rod_intensity, compute_rod_ring, ROD_RAMP, ROD_STOPS,
};

#[test]
fn rod_constants_match_spec() {
    assert_eq!(ROD_RAMP, [29, 31, 22, 18]);
    assert_eq!(ROD_STOPS, [0.28, 0.60, 0.88]);
}

#[test]
fn rod_hum_bounds_within_fast_shallow_range() {
    for i in 0..100 {
        let t = i as f32 * 0.05;
        let hum = compute_rod_hum(t, 0.0);
        assert!(hum >= 0.88 && hum <= 1.12);
    }
}

#[test]
fn rod_core_pinpoint_decays_steeply() {
    let hum = 1.0;
    let core_center = compute_rod_core(0.0, hum);
    assert_eq!(core_center, 1.0);

    let core_mid = compute_rod_core(0.5, hum);
    // (0.5)^8 = 0.00390625
    assert!((core_mid - 0.00390625).abs() < 1e-5);
}

#[test]
fn rod_ring_peaks_at_ring_radius() {
    let hum = 1.0;
    let peak = compute_rod_ring(0.52, hum);
    assert_eq!(peak, 0.55);

    let far = compute_rod_ring(0.8, hum);
    assert_eq!(far, 0.0);
}

#[test]
fn rod_intensity_evaluates_at_origin() {
    let intensity = compute_rod_intensity([0.0, 0.0], 0.0, 0.0, 1.0, |_, _, _| 0.0);
    assert!(intensity > 0.99); // core is 1.0 at origin
}
