// Parity test suite for Dev Floor Lock Funnel.
// Replicates legacy/src/game/pinball-knight/dev/floor-lock.ts

use pk_core::dev::floor_lock::DevFloorLock;

#[test]
fn identity_passthrough_when_unlocked() {
    let dev_lock = DevFloorLock::new();
    let (floor, msg) = dev_lock.apply_floor_lock(3);
    assert_eq!(floor, 3);
    assert!(msg.is_none());
}

#[test]
fn floor_lock_overrides_target_with_diagnostic() {
    let mut dev_lock = DevFloorLock::new();
    dev_lock.set_lock(Some(1));

    let (floor, msg) = dev_lock.apply_floor_lock(5);
    assert_eq!(floor, 1);
    assert!(msg.unwrap().contains("[floor-lock] descent to 5 -> 1"));
}

#[test]
fn ghost_maze_takes_strict_precedence_over_floor_lock() {
    let mut dev_lock = DevFloorLock::new();
    dev_lock.set_lock(Some(2));
    dev_lock.set_ghost(Some(7));

    let (floor, msg) = dev_lock.apply_floor_lock(1);
    assert_eq!(floor, 7);
    assert!(msg.unwrap().contains("[ghost-maze] descent to 1 -> 7"));
}
