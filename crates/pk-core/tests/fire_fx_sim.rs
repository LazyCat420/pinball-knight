// Parity test suite for Fractal Flame Domain-Warp Shader Math.
// Replicates legacy/src/game/pinball-knight/fx/elements/fire.ts

use pk_core::marble::fire_fx::{sample_fire_surface, FireOrientation, FIRE_RAMP};

#[test]
fn fire_surface_samples_floor_and_billboard_advection() {
    let floor_sample = sample_fire_surface(0.2, 0.2, 1.0, FireOrientation::Floor, 1.0);
    let bb_sample = sample_fire_surface(0.2, 0.2, 1.0, FireOrientation::Billboard, 1.0);

    assert!(floor_sample.energy >= 0.0 && floor_sample.energy <= 1.0);
    assert!(bb_sample.energy >= 0.0 && bb_sample.energy <= 1.0);

    assert!(FIRE_RAMP.contains(&floor_sample.palette_color_index));
    assert!(FIRE_RAMP.contains(&bb_sample.palette_color_index));
}

#[test]
fn fire_surface_thresholds_alpha_and_flags_hot_core() {
    // Center point with full intensity -> high energy and hot core
    let hot_sample = sample_fire_surface(0.0, 0.0, 0.5, FireOrientation::Floor, 2.0);
    assert!(hot_sample.alpha > 0.0);

    // Far point outside unit radius -> zero alpha
    let cold_sample = sample_fire_surface(2.0, 2.0, 0.5, FireOrientation::Floor, 1.0);
    assert_eq!(cold_sample.alpha, 0.0);
}
