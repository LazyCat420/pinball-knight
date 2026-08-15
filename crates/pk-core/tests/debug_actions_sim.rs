// Parity test suite for Debug Actions.
// Replicates legacy/src/game/pinball-knight/dev/debug-actions.ts

use pk_core::dev::debug_actions::DebugActionsState;

#[test]
fn debug_actions_god_mode_verbs() {
    let mut actions = DebugActionsState::new();

    // Initial state
    assert_eq!(actions.player_hp, 100);
    assert_eq!(actions.player_pos, (0.0, 0.0));
    assert_eq!(actions.stairs_pos, (10.0, 10.0));

    // Teleport to stairs
    actions.teleport_to_stairs();
    assert_eq!(actions.player_pos, (10.0, 8.0));

    // Clear enemies
    assert!(!actions.enemies_cleared);
    actions.kill_all_enemies();
    assert!(actions.enemies_cleared);

    // Max skills
    assert!(!actions.skills_maxed);
    actions.max_skills();
    assert!(actions.skills_maxed);

    // Spawn reaper
    assert!(!actions.reaper_spawned);
    actions.spawn_reaper();
    assert!(actions.reaper_spawned);
}
