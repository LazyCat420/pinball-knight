// Simulation test suite for Monster Spawning Factory.
// Replicates legacy/src/game/pinball-knight/spawn/factory.ts

use pk_core::grid::{set_tile, Grid, T_FLOOR};
use pk_core::monsters::types::EnemyKind;
use pk_core::spawn::factory::*;
use pk_core::state::SimState;

#[test]
fn spawn_factory_expansion_and_reskins() {
    assert_eq!(EXPANSION_SKIN.len(), 7);
    assert_eq!(RESKIN.len(), 12);

    let bloater = make_expansion(EnemyKind::Bloater, 5.0, 5.0, 3.0).expect("bloater expansion");
    assert_eq!(bloater.kind, EnemyKind::Bloater);
    assert!(bloater.radius > 0.0);

    let goblin = make_reskin(EnemyKind::Goblin, 2.0, 2.0, 4.0).expect("goblin reskin");
    assert_eq!(goblin.kind, EnemyKind::Goblin);
}

#[test]
fn spawn_kind_and_horde_member_depth_gating() {
    // Level 1: Brute should not spawn
    assert!(spawn_kind(EnemyKind::Brute, 0.0, 0.0, 2.0, 1).is_none());

    // Level 5: Brute spawns
    let brute = spawn_kind(EnemyKind::Brute, 0.0, 0.0, 2.0, 5).expect("brute spawns on level 5");
    assert_eq!(brute.kind, EnemyKind::Brute);

    // Horde member picks
    let m1 = spawn_horde_member(12345, 0.0, 0.0, 2.0, 1);
    let m2 = spawn_horde_member(12345, 0.0, 0.0, 2.0, 5);
    assert_eq!(m1.speed > 0.0, true);
    assert_eq!(m2.speed > 0.0, true);
}

#[test]
fn deferred_spawn_queues_drain_correctly() {
    let mut monsters = Vec::new();

    queue_mini(10.0, 10.0, 2.5);
    assert!(monsters.is_empty());

    drain_pending_minis(&mut monsters);
    assert_eq!(monsters.len(), 2); // Split into 2 minis
    assert_eq!(monsters[0].kind, EnemyKind::Slime);
    assert_eq!(monsters[1].kind, EnemyKind::Slime);

    queue_summon(15.0, 15.0);
    drain_pending_summons(&mut monsters, 2.0);
    assert_eq!(monsters.len(), 3);
}

#[test]
fn bowling_pin_crew_spawns_triangular_formation() {
    let mut g = Grid::solid(20, 20);
    for i in 1..19 {
        for j in 1..19 {
            set_tile(&mut g, i, j, T_FLOOR);
        }
    }
    let mut sim = SimState::new(g.clone(), (5.0, 5.0), 12345);

use pk_core::maze::track_launch::TilePos;

    spawn_pin_crew(&g, TilePos { i: 5, j: 5 }, &mut sim);
    assert_eq!(sim.monsters.len(), 6);
    for m in &sim.monsters {
        assert_eq!(m.kind, EnemyKind::Pin);
    }
}
