// Parity test suite for Zombie AI and Horde Movement Subsystem.
// Replicates legacy/src/game/pinball-knight/entities/zombie.ts

use pk_core::combat::Facing;
use pk_core::enemies::*;
use pk_core::grid::{set_tile, Grid, T_FLOOR};
use pk_core::monsters::types::{EnemyKind, EnemyMode, LiveMonster};
use pk_core::movement::MovementKind;
use pk_core::zombie_ai::*;
use pk_core::zombie_types::ZombieType;

fn make_open_grid(w: i32, h: i32) -> Grid {
    let mut g = Grid::solid(w, h);
    for i in 0..w {
        for j in 0..h {
            set_tile(&mut g, i, j, T_FLOOR);
        }
    }
    g
}

#[test]
fn stats_lookup_covers_all_enemy_kinds() {
    for kind in EnemyKind::ALL {
        let stats = stats_for_kind(kind);
        assert!(stats.body_r > 0.0);
        assert!(stats.windup > 0.0);
        assert!(stats.cooldown > 0.0);
    }
}

#[test]
fn movement_mapping_respects_subtypes_and_defaults() {
    // Default zombie -> Chase
    assert_eq!(movement_of(EnemyKind::Zombie, None), MovementKind::Chase);

    // Runner subtype -> Flanker
    assert_eq!(movement_of(EnemyKind::Zombie, Some(ZombieType::Runner)), MovementKind::Flanker);

    // Ghost -> Phase
    assert_eq!(movement_of(EnemyKind::Ghost, None), MovementKind::Phase);

    // Pin -> Inert
    assert_eq!(movement_of(EnemyKind::Pin, None), MovementKind::Inert);
}

#[test]
fn facing_resolution_from_world_velocity() {
    // Screen Down: wx = 1, wz = 1 -> Facing::S
    let facing_s = facing_from_world(1.0, 1.0, Facing::S);
    assert_eq!(facing_s, Facing::S);

    // Screen Up: wx = -1, wz = -1 -> Facing::N
    let facing_n = facing_from_world(-1.0, -1.0, Facing::S);
    assert_eq!(facing_n, Facing::N);

    // Screen Right: wx = 1, wz = -1 -> Facing::E
    let facing_e = facing_from_world(1.0, -1.0, Facing::S);
    assert_eq!(facing_e, Facing::E);

    // Screen Left: wx = -1, wz = 1 -> Facing::W
    let facing_w = facing_from_world(-1.0, 1.0, Facing::S);
    assert_eq!(facing_w, Facing::W);
}

#[test]
fn horde_separation_prevents_sprite_stacking() {
    let mut monsters = vec![
        LiveMonster::new(1, EnemyKind::Zombie, 5.0, 5.0),
        LiveMonster::new(2, EnemyKind::Zombie, 5.1, 5.0), // Initial d = 0.1 < SEPARATION_R (0.55)
    ];

    let grid = make_open_grid(20, 20);
    let flow = vec![0; 400];

    // Step simulation
    update_zombies(&mut monsters, &grid, 10.0, 10.0, 6, &flow, 0.0, 0.016);

    // Monsters were shoved apart past the 0.1 initial overlap
    let d = ((monsters[0].x - monsters[1].x).powi(2) + (monsters[0].z - monsters[1].z).powi(2)).sqrt();
    assert!(d > 0.45);
}

#[test]
fn attack_windup_and_strike_cycle() {
    let mut monsters = vec![
        LiveMonster::new(1, EnemyKind::Zombie, 5.0, 5.0),
    ];

    let grid = make_open_grid(20, 20);
    let flow = vec![0; 400];

    // Player standing at (5.2, 5.0) — inside contact range
    let player_x = 5.2;
    let player_z = 5.0;

    // Step 1: Enters windup
    let actions1 = update_zombies(&mut monsters, &grid, player_x, player_z, 6, &flow, 0.0, 0.1);
    assert_eq!(actions1.len(), 0);
    assert_eq!(monsters[0].mode, EnemyMode::Windup);

    // Step 2: Completes windup -> strikes
    let actions2 = update_zombies(&mut monsters, &grid, player_x, player_z, 6, &flow, 0.0, ZOMBIE_ATTACK_WINDUP);
    assert_eq!(actions2.len(), 1);
    assert_eq!(monsters[0].mode, EnemyMode::Attack);
    assert!(monsters[0].attack_cd > 0.0);
}
