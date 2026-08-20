// Parity test suite for Arc Kickers Curved Rubber Boosters.
// Replicates legacy/src/game/pinball-knight/render/arc-kickers.ts

use pk_gui::render::arc_kickers::{
    build_kicker_geometry, ArcKickerVisual, KickBand, ARC_KICK_FLASH,
};

#[test]
fn arc_kickers_generates_band_and_cap_geometry() {
    let kicker_geo = build_kicker_geometry(
        0.0,
        0.0,
        3.0,
        0.0,
        std::f64::consts::PI / 2.0,
        0.1,
        0.9,
        0.08,
    );
    assert!(!kicker_geo.positions.is_empty());
    assert_eq!(kicker_geo.positions.len(), kicker_geo.normals.len());
    assert!(!kicker_geo.indices.is_empty());
}

#[test]
fn arc_kicker_visual_triggers_kick_and_decays() {
    let band = KickBand { a0: 0.0, span: 1.0 };

    let mut visual = ArcKickerVisual::new(band, 0.0, 0.0, 2.5, 2.0, false);
    assert!(!visual.is_flashing());

    visual.trigger_kick();
    assert!(visual.is_flashing());
    assert_eq!(visual.flash_t, ARC_KICK_FLASH);

    visual.tick(ARC_KICK_FLASH + 0.05);
    assert!(!visual.is_flashing());
    assert_eq!(visual.flash_t, 0.0);
}
