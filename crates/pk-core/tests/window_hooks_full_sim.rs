// Comprehensive simulation test suite for Dev / QA Window Hooks Subsystem.
// Replicates legacy/src/game/pinball-knight/dev/window-hooks.ts

use pk_core::dev::window_hooks::*;

#[test]
fn monster_spawning_and_horde_clearing() {
    let mut hooks = DungeonWindowHooks::new();
    assert_eq!(hooks.stats.active_zombies, 0);

    // Spawn horde ring
    let res = hooks.dungeon_spawn(DebugSpawnSpec {
        kind: "zombie".to_string(),
        count: 8,
        ring: Some(3.0),
        ..DebugSpawnSpec::default()
    });
    assert_eq!(res.spawned, 8);
    assert_eq!(hooks.stats.active_zombies, 8);

    // Spawn boss at coordinates
    let res_boss = hooks.dungeon_spawn(DebugSpawnSpec {
        kind: "boss".to_string(),
        count: 1,
        at: Some((12.0, 12.0)),
        ..DebugSpawnSpec::default()
    });
    assert_eq!(res_boss.spawned, 1);
    assert_eq!(hooks.stats.active_zombies, 9);

    // Clear floor
    let cleared = hooks.dungeon_clear();
    assert_eq!(cleared, 9);
    assert_eq!(hooks.stats.active_zombies, 0);
}

#[test]
fn cheats_god_mode_and_inventory_injection() {
    let mut hooks = DungeonWindowHooks::new();

    // God mode & infinite mana toggles
    let (god, mana, nocd, card_drops) = hooks.dungeon_debug(Some(true), Some(true), Some(true), Some(true));
    assert!(god);
    assert!(mana);
    assert!(nocd);
    assert!(card_drops);

    // Inventory injection
    assert!(hooks.dungeon_give_weapon("bow"));
    assert!(hooks.dungeon_give_potion("freeze"));
    assert_eq!(hooks.inventory.len(), 2);

    // Ability slot assignment with rank
    assert!(hooks.dungeon_ability(0, "slickfield", Some(2)));
    assert_eq!(hooks.ability_slots[0], Some("slickfield".to_string()));
    assert_eq!(hooks.ability_ranks.get("slickfield"), Some(&2));

    // Material override
    assert!(hooks.dungeon_material("lava"));
    assert_eq!(hooks.active_material, Some("lava".to_string()));

    // Socket card & drop card
    assert!(hooks.dungeon_socket("spidersilk"));
    assert!(hooks.dungeon_drop_card("ember", 1.5, 0.0));
    assert_eq!(hooks.sockets.len(), 1);
    assert_eq!(hooks.ground_items.len(), 1);
}

#[test]
fn dungeon_flow_descent_and_fresh_run() {
    let mut hooks = DungeonWindowHooks::new();
    assert_eq!(hooks.level, 1);

    // Descend to floor 2 and 3
    assert_eq!(hooks.dungeon_descend(), 2);
    assert_eq!(hooks.dungeon_descend(), 3);

    // Jump to specific floor
    assert!(hooks.dungeon_level(5));
    assert_eq!(hooks.level, 5);

    // Die and generate corpse marker
    let (floor, corpses) = hooks.dungeon_die();
    assert_eq!(floor, 5);
    assert_eq!(corpses, 1);

    // Fresh run resets progress
    assert!(hooks.dungeon_fresh_run());
    assert_eq!(hooks.level, 1);
    assert!(hooks.corpses.is_empty());
}

#[test]
fn gamepad_simulation_and_stick_inputs() {
    let mut hooks = DungeonWindowHooks::new();
    assert!(!hooks.pad.plugged);

    hooks.pad_connect();
    assert!(hooks.pad.plugged);

    // Button hold and release
    hooks.pad_hold(4); // LB
    assert!(hooks.pad.buttons[4]);
    hooks.pad_release(4);
    assert!(!hooks.pad.buttons[4]);

    // Stick and aim axes
    hooks.pad_stick(0.75, -0.5);
    assert_eq!(hooks.pad.axes[0], 0.75);
    assert_eq!(hooks.pad.axes[1], -0.5);

    hooks.pad_aim(1.0, 0.0);
    assert_eq!(hooks.pad.axes[2], 1.0);
    assert_eq!(hooks.pad.axes[3], 0.0);

    hooks.pad_disconnect();
    assert!(!hooks.pad.plugged);
}

#[test]
fn telemetry_probes_and_queries() {
    let mut hooks = DungeonWindowHooks::new();
    hooks.dungeon_teleport(5.0, 5.0);
    hooks.dungeon_set_speed(14.0);

    let probe = hooks.dungeon_probe();
    assert_eq!(probe.level, 1);
    assert!(!probe.game_over);

    let player = hooks.dungeon_player();
    assert_eq!(player.x, 5.0);
    assert_eq!(player.z, 5.0);
    assert_eq!(player.cur_speed, 14.0);
    assert!(player.moving);

    let boss = hooks.dungeon_boss();
    assert!(boss.dist.unwrap() > 0.0);

    let floor = hooks.dungeon_floor();
    assert_eq!(floor.level, 1);
    assert_eq!(floor.targets, "2/4");

    let rail = hooks.dungeon_rail();
    assert_eq!(rail.speed, 14.0);
    assert_eq!(rail.cap, 18.0);
}
