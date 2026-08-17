// Parity test suite for Dev / QA Window Inspection API.
// Replicates legacy/src/game/pinball-knight/dev/window-hooks.ts

use pk_core::abilities::AbilityId;
use pk_core::dev::window_hooks::{install_dev_hooks, DevHookDeps, DungeonWindowHooks};
use pk_core::state::SimState;

struct MockDevDeps;
impl DevHookDeps for MockDevDeps {
    fn start_level(&mut self, _level: u32) {}
    fn descend(&mut self) {}
    fn on_player_death(&mut self) {}
    fn open_shop(&mut self) {}
    fn apply_potion(&mut self, _potion: &str) {}
    fn debug_spawn(&mut self, _kind: &str, _x: f64, _z: f64) {}
    fn debug_clear_enemies(&mut self) {}
    fn exit_dungeon_game(&mut self) {}
    fn tear_grave_hole(&mut self, _x: f64, _z: f64, _name: &str) {}
}

#[test]
fn window_hooks_scriptable_test_harness_verbs() {
    let mut hooks = DungeonWindowHooks::new();

    let initial_stats = hooks.dungeon_stats();
    assert_eq!(initial_stats.floor_depth, 1);
    assert_eq!(initial_stats.active_zombies, 0);

    // Spawn enemy
    hooks.dungeon_spawn("zombie", 10.0, 15.0);
    assert_eq!(hooks.spawned_entities.len(), 1);
    assert_eq!(hooks.dungeon_stats().active_zombies, 1);

    // Give items
    assert!(hooks.dungeon_give_weapon("sword_legendary"));
    assert!(hooks.dungeon_give_potion("potion_mana"));
    assert_eq!(hooks.inventory, vec!["sword_legendary", "potion_mana"]);

    // Ability binding with rank
    assert!(hooks.dungeon_ability(0, "flippercharge", Some(3)));
    assert_eq!(
        hooks.bound_abilities[0],
        (Some(AbilityId::Flippercharge), 3)
    );
    assert!(!hooks.dungeon_ability(5, "unknown", None));

    // Descend
    hooks.dungeon_descend();
    assert_eq!(hooks.dungeon_stats().floor_depth, 2);

    // Speed override
    hooks.dungeon_set_speed(25.0);
    assert_eq!(hooks.speed_override, Some(25.0));

    // Clear enemies
    hooks.dungeon_clear_enemies();
    assert_eq!(hooks.spawned_entities.len(), 0);
    assert_eq!(hooks.dungeon_stats().active_zombies, 0);

    // Install dev hooks against simulation state
    let mut sim_state = SimState::new(pk_core::grid::Grid::solid(10, 10), (5.0, 5.0), 42);
    let mut mock_deps = MockDevDeps;
    install_dev_hooks(&mut hooks, &mut sim_state, &mut mock_deps);
    assert_eq!(hooks.stats.player_hp, sim_state.player.hp);
}
