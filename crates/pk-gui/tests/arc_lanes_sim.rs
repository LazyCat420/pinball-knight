// Parity test suite for Arc Lanes Curved Speed Boosters.
// Replicates legacy/src/game/pinball-knight/render/arc-lanes.ts

use pk_gui::render::arc_lanes::{build_bed_geometry, build_chevron_geometry, ArcLaneVisual, LaneBand, ARC_LANE_FLASH};

#[test]
fn arc_lanes_generates_bed_and_chevron_geometry() {
    let bed = build_bed_geometry(0.0, 0.0, 3.0, 0.0, std::f64::consts::PI / 2.0, 0.1, 0.9, 0.08);
    assert!(!bed.positions.is_empty());
    assert_eq!(bed.positions.len(), bed.normals.len());
    assert!(!bed.indices.is_empty());

    let chevrons = build_chevron_geometry(0.0, 0.0, 3.0, 0.0, std::f64::consts::PI / 2.0, 0.1, 0.9, 0.08, true);
    assert!(!chevrons.positions.is_empty());
    assert_eq!(chevrons.positions.len(), chevrons.normals.len());
}

#[test]
fn arc_lane_visual_triggers_boost_and_decays() {
    let band = LaneBand {
        a0: 0.0,
        span: 1.0,
        cw: true,
        mouth: (0.0, 0.0),
    };

    let mut visual = ArcLaneVisual::new(band, 0.0, 0.0, 2.5, 2.0, false);
    assert!(!visual.is_flashing());

    visual.trigger_boost();
    assert!(visual.is_flashing());
    assert_eq!(visual.flash_t, ARC_LANE_FLASH);

    visual.tick(ARC_LANE_FLASH + 0.05);
    assert!(!visual.is_flashing());
    assert_eq!(visual.flash_t, 0.0);
}
