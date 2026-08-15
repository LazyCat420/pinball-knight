// Parity test suite for Dungeon Session Lifecycle Orchestrator.
// Replicates legacy/src/game/pinball-knight/core.ts

use pk_core::dungeon_session::DungeonSessionState;

#[test]
fn dungeon_session_lifecycle_and_weapon_swapping() {
    let mut session = DungeonSessionState::new();

    assert!(!session.is_active);
    session.enter_dungeon(42);
    assert!(session.is_active);
    assert_eq!(session.world_seed, 42);
    assert_eq!(session.floor_depth, 1);
    assert_eq!(session.active_weapon(), Some(&"sword_basic".to_string()));

    // Equip second weapon into slot 1
    let dropped = session.equip_weapon("axe_heavy");
    assert_eq!(dropped, None);
    assert_eq!(session.active_slot, 1);
    assert_eq!(session.active_weapon(), Some(&"axe_heavy".to_string()));

    // Swap back to slot 0
    session.swap_weapon();
    assert_eq!(session.active_slot, 0);
    assert_eq!(session.active_weapon(), Some(&"sword_basic".to_string()));

    // Equip third weapon with full hands -> should drop current active ("sword_basic")
    let dropped2 = session.equip_weapon("hammer_thunder");
    assert_eq!(dropped2, Some("sword_basic".to_string()));
    assert_eq!(session.active_weapon(), Some(&"hammer_thunder".to_string()));

    session.exit_dungeon();
    assert!(!session.is_active);
}
