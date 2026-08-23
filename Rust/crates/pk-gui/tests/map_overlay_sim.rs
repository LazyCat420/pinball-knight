// Parity test suite for Floor Map Overlay State Gate.
// Replicates legacy/src/game/pinball-knight/map-overlay.ts

use pk_gui::map_overlay::MapOverlayState;

#[test]
fn map_overlay_toggle_and_suppression_lifecycle() {
    let mut map = MapOverlayState::new();
    assert!(!map.is_floor_map_open());

    // Toggle open
    let opened = map.toggle_floor_map();
    assert!(opened);
    assert!(map.is_floor_map_open());

    // Toggle close
    let closed = map.toggle_floor_map();
    assert!(!closed);
    assert!(!map.is_floor_map_open());

    // Reopen, then suppress
    map.toggle_floor_map();
    assert!(map.is_floor_map_open());
    map.set_map_suppressed(true);
    assert!(!map.is_floor_map_open());

    // While suppressed, toggle refuses
    assert!(!map.toggle_floor_map());
    assert!(!map.is_floor_map_open());

    // Unsuppress enables toggle again
    map.set_map_suppressed(false);
    assert!(map.toggle_floor_map());
    assert!(map.is_floor_map_open());
}
