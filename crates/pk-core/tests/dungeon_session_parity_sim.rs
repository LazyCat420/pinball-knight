//! Comprehensive parity test suite for legacy/src/game/pinball-knight/core.ts.

use pk_core::dungeon_session::*;

#[test]
fn dungeon_session_lifecycle_flags() {
    exit_dungeon_game();
    assert!(!is_dungeon_game_active());

    launch_dungeon_game();
    assert!(is_dungeon_game_active());

    exit_dungeon_game();
    assert!(!is_dungeon_game_active());
}

#[test]
fn dungeon_weapon_slots_and_swapping() {
    let mut session = DungeonSessionState::new();
    assert_eq!(session.active_slot, 0);
    assert_eq!(session.active_weapon().map(|s| s.as_str()), Some("sword_basic"));

    // Equip second weapon into slot 1
    let dropped = session.equip_weapon("axe_iron");
    assert_eq!(dropped, None);
    assert_eq!(session.active_slot, 1);
    assert_eq!(session.active_weapon().map(|s| s.as_str()), Some("axe_iron"));

    // Swap back to slot 0
    session.swap_weapon();
    assert_eq!(session.active_slot, 0);
    assert_eq!(session.active_weapon().map(|s| s.as_str()), Some("sword_basic"));

    // Equip third weapon: should exchange in-place with active slot (slot 0)
    let old = session.equip_weapon("hammer_thunder");
    assert_eq!(old.as_deref(), Some("sword_basic"));
    assert_eq!(session.active_weapon().map(|s| s.as_str()), Some("hammer_thunder"));
}

#[test]
fn dungeon_session_progression_and_reaper_timer() {
    let mut session = DungeonSessionState::new();
    session.enter_dungeon(42);
    assert!(session.is_active);
    assert_eq!(session.floor_depth, 1);

    // Advance 60 seconds
    session.advance_time(60.0);
    assert!(!session.reaper_spawned);
    assert_eq!(session.reaper_timer, 60.0);

    // Advance another 65 seconds to trigger reaper
    session.advance_time(65.0);
    assert!(session.reaper_spawned);
    assert_eq!(session.reaper_timer, 0.0);

    // Record kills
    session.record_kill(25, 100);
    assert_eq!(session.enemies_slain, 1);
    assert_eq!(session.gold_collected, 25);
    assert_eq!(session.score, 100);

    // Descend
    session.descend_next_floor();
    assert_eq!(session.floor_depth, 2);
    assert!(!session.reaper_spawned);
    assert!(session.reaper_timer > 0.0);
}
