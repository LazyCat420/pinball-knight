// Parity test suite for Floor Descent Hold Coordinator.
// Replicates legacy/src/game/pinball-knight/run/floor-hold.ts

use pk_core::run::floor_hold::FloorHoldCoordinator;

#[test]
fn floor_hold_suspends_and_releases_rendering() {
    let mut coord = FloorHoldCoordinator::new();
    assert!(!coord.is_render_held());

    let token = coord.hold_for_floor_load(3);
    assert!(coord.is_render_held());
    assert_eq!(coord.active_level, Some(3));

    // Release matching token
    coord.release_floor_load(Some(token));
    assert!(!coord.is_render_held());
    assert_eq!(coord.active_level, None);
}

#[test]
fn stale_token_does_not_clear_newer_hold() {
    let mut coord = FloorHoldCoordinator::new();

    let old_token = coord.hold_for_floor_load(1);
    let new_token = coord.hold_for_floor_load(2);

    // Stale release ignored
    coord.release_floor_load(Some(old_token));
    assert!(coord.is_render_held());
    assert_eq!(coord.active_level, Some(2));

    // Valid release clears
    coord.release_floor_load(Some(new_token));
    assert!(!coord.is_render_held());
}
