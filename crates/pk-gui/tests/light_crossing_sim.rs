// Parity test suite for Scene Light Crossing Palette Model.
// Replicates legacy/src/game/pinball-knight/render/light-crossing.ts

use pk_gui::palette::PALETTE_HEX;
use pk_gui::render::light_crossing::{
    crossing_rate_for_rig, hex_to_srgb, snap_to_palette, Rig,
};

#[test]
fn snap_to_palette_maps_exact_hex_colors_to_their_own_indices() {
    for (i, &h) in PALETTE_HEX.iter().enumerate() {
        let srgb = hex_to_srgb(h);
        let snapped = snap_to_palette(srgb);
        assert_eq!(snapped, i);
    }
}

#[test]
fn light_crossing_negative_control_has_zero_crossing() {
    // A neutral rig with multiplier exactly PI (so irradiance/PI = 1.0) crosses 0 families
    let mut flat_rig = Rig::default();
    flat_rig.ambient_hex = 0xffffff;
    flat_rig.ambient_intensity = std::f64::consts::PI;
    flat_rig.hemi_intensity = 0.0;
    flat_rig.dir_intensity = 0.0;
    flat_rig.torch_intensity = 0.0;

    let rate = crossing_rate_for_rig(&flat_rig);
    assert_eq!(rate, 0.0);
}

#[test]
fn light_crossing_evaluates_default_rig_crossing_rate() {
    let rig = Rig::default();
    let rate = crossing_rate_for_rig(&rig);
    assert!(rate > 0.0 && rate <= 1.0);
}
