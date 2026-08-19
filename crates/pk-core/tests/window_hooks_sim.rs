// Parity test suite for Dev / QA Window Inspection API.
// Replicates legacy/src/game/pinball-knight/dev/window-hooks.ts

use pk_core::dev::window_hooks::{DebugSpawnSpec, DungeonWindowHooks};

#[test]
fn window_hooks_scriptable_test_harness_verbs() {
    let mut hooks = DungeonWindowHooks::new();

    let initial_stats = hooks.dungeon_stats();
    assert_eq!(initial_stats.floor_depth, 1);
    assert_eq!(initial_stats.active_zombies, 0);

    // Spawn enemy
    hooks.dungeon_spawn(DebugSpawnSpec {
        kind: "zombie".to_string(),
        at: Some((10.0, 15.0)),
        ..DebugSpawnSpec::default()
    });
    assert_eq!(hooks.spawned_entities.len(), 1);
    assert_eq!(hooks.dungeon_stats().active_zombies, 1);

    // Give items
    hooks.dungeon_give_weapon("sword_legendary");
    hooks.dungeon_give_potion("potion_mana");
    assert_eq!(hooks.inventory, vec!["sword_legendary", "potion_mana"]);

    // Descend
    hooks.dungeon_descend();
    assert_eq!(hooks.dungeon_stats().floor_depth, 2);

    // Speed override
    hooks.dungeon_set_speed(25.0);
    assert_eq!(hooks.speed_override, Some(25.0));
}
