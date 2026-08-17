//! Comprehensive parity test suite for legacy/src/game/pinball-knight/bestiary.ts and spawn/factory.ts.

use std::collections::HashMap;
use pk_core::bestiary::*;
use pk_core::grid::Grid;
use pk_core::monsters::types::EnemyKind;
use pk_core::spawn::factory::*;

#[test]
fn bestiary_roster_and_progress() {
    assert_eq!(KIND_INFO.len(), 28);
    assert_eq!(KIND_IDS.len(), 28);

    let mut kills = HashMap::new();
    kills.insert("zombie".to_string(), 15);
    kills.insert("spider".to_string(), 55);

    let (seen, total) = bestiary_progress(&kills);
    assert_eq!(seen, 2);
    assert_eq!(total, 28);

    let list = build_bestiary(&kills);
    assert_eq!(list.len(), 28);

    let zombie_entry = list.iter().find(|e| e.kind == "zombie").unwrap();
    assert!(zombie_entry.revealed);
    assert_eq!(zombie_entry.milestone.name, "Hunter");

    let spider_entry = list.iter().find(|e| e.kind == "spider").unwrap();
    assert_eq!(spider_entry.milestone.name, "Master");

    let reaper_entry = list.iter().find(|e| e.kind == "reaper").unwrap();
    assert!(!reaper_entry.revealed);
    assert_eq!(reaper_entry.milestone.name, "Unknown");
}

#[test]
fn monster_factory_spawns_and_nids() {
    reset_zombie_nid();
    let z1 = make_zombie(EnemyKind::Zombie, 5.0, 5.0, 3.0, 1);
    assert_eq!(z1.id, 1);
    assert!(z1.hp > 0.0);

    let z2 = spawn_kind(EnemyKind::Brute, 10.0, 10.0, 2.5, 2).unwrap();
    assert_eq!(z2.id, 2);
    assert!(z2.hp > z1.hp);

    bump_zombie_nid("z_50");
    let z3 = make_zombie(EnemyKind::Bat, 2.0, 2.0, 4.0, 1);
    assert_eq!(z3.id, 51);
}

#[test]
fn deferred_spawn_queues_and_pin_crew() {
    queue_mini(1.0, 2.0, 4.5);
    queue_mini(3.0, 4.0, 5.0);
    let minis = drain_pending_minis();
    assert_eq!(minis.len(), 2);
    assert_eq!(drain_pending_minis().len(), 0);

    queue_summon(10.0, 20.0);
    let summons = drain_pending_summons();
    assert_eq!(summons.len(), 1);
    assert_eq!(drain_pending_summons().len(), 0);

    let grid = Grid::solid(20, 20);
    let crew = spawn_pin_crew(&grid, pk_core::maze::decorate::TilePos { i: 10, j: 10 });
    assert_eq!(crew.len(), 10);
}
