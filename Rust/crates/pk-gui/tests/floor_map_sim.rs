// Parity test suite for Floor Map Overlay Screen.
// Replicates legacy/src/game/pinball-knight/gui/screens/floor-map.ts

use pk_gui::screens::floor_map::{compute_map_viewport, floor_map_pauses_game, LEGEND};

#[test]
fn floor_map_does_not_pause_game() {
    assert!(!floor_map_pauses_game());
}

#[test]
fn floor_map_legend_has_four_priority_entries() {
    assert_eq!(LEGEND.len(), 4);
    assert_eq!(LEGEND[0], ("#ffd700", "YOU"));
    assert_eq!(LEGEND[1], ("#7852ff", "STAIRS"));
    assert_eq!(LEGEND[2], ("#2ecc71", "PARTS"));
    assert_eq!(LEGEND[3], ("#a46fe8", "SECRET"));
}

#[test]
fn compute_map_viewport_reserves_hud_space() {
    // Screen 800 x 450, pad 16, HUD panel 76 * 2x zoom = 152
    let vp = compute_map_viewport(800.0, 450.0, 16.0, 76.0, 2.0);
    assert_eq!(vp.x, 16.0);
    assert_eq!(vp.y, 16.0);
    assert_eq!(vp.w, 800.0 - 32.0);
    // h = 450 - 152 - 32 = 266
    assert_eq!(vp.h, 266.0);
}
