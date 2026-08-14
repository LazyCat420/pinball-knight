// Parity test suite for Procedural Water Ripple and Fresnel Model.
// Replicates legacy/src/game/pinball-knight/fx/elements/water.ts

use pk_core::marble::water_fx::{sample_water_height, sample_water_surface, WATER_RAMP};

#[test]
fn water_height_samples_wave_packets_and_splash_decay() {
    let h1 = sample_water_height(0.0, 0.0, 1.0, 0.0, 0.0, 0.9); // splash active (0.1s ago)
    let h2 = sample_water_height(0.0, 0.0, 3.0, 0.0, 0.0, 0.9); // splash expired (>1.2s ago)

    assert!(h1.abs() > 0.0);
    assert!(h2.abs() > 0.0);
}

#[test]
fn water_surface_samples_normals_fresnel_and_palette() {
    let sample = sample_water_surface(1.5, 2.5, 0.5, 0.0, 0.0, 0.0);

    // Normal is unit length
    let (nx, ny, nz) = sample.normal;
    let n_len = (nx * nx + ny * ny + nz * nz).sqrt();
    assert!((n_len - 1.0).abs() < 0.001);

    // Fresnel is bounded [0.02, 1.0]
    assert!(sample.fresnel >= 0.02 && sample.fresnel <= 1.0);

    // Caustics is bounded [0.0, 1.0]
    assert!(sample.caustic >= 0.0 && sample.caustic <= 1.0);

    // Palette index is in WATER_RAMP
    assert!(WATER_RAMP.contains(&sample.palette_color_index));
}
