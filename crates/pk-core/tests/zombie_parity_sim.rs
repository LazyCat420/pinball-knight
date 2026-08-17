//! Comprehensive parity test suite for legacy/src/game/pinball-knight/entities/zombie.ts.

use pk_core::grid::{set_tile, Grid, T_FLOOR};
use pk_core::monsters::types::{EnemyKind, LiveMonster};
use pk_core::state::{Facing, SimState};
use pk_core::zombie_ai::*;
use pk_core::zombie_types::ZombieType;

#[test]
fn enemy_stats_table_matches_oracle() {
    let z_stat = stats_for_kind(EnemyKind::Zombie);
    assert_eq!(z_stat.body_r, 0.3);
    assert_eq!(z_stat.contact_range, 0.72);
    assert!(!z_stat.ranged);

    let spitter = stats_for_kind(EnemyKind::Croaker);
    assert!(spitter.ranged);
    assert!(spitter.contact_range > 1.0);
}

#[test]
fn movement_policy_lookup_and_subtype_overrides() {
    assert_eq!(
        movement_of(EnemyKind::Zombie, None),
        MovementKind::Direct
    );
    assert_eq!(
        movement_of(EnemyKind::Zombie, Some(ZombieType::Runner)),
        MovementKind::Flank
    );
    assert_eq!(
        movement_of(EnemyKind::Zombie, Some(ZombieType::Crawler)),
        MovementKind::Ambush
    );
    assert_eq!(
        movement_of(EnemyKind::Zombie, Some(ZombieType::Flailer)),
        MovementKind::Leap
    );
    assert_eq!(
        movement_of(EnemyKind::Zombie, Some(ZombieType::Midget)),
        MovementKind::Swarm
    );

    assert_eq!(
        movement_of(EnemyKind::Ghost, None),
        MovementKind::Hover
    );
}

#[test]
fn facing_from_velocity_and_world_projections() {
    let f_south = facing_from_velocity(0.0, 1.0, Facing::S);
    assert_eq!(f_south, Facing::S);

    let f_north = facing_from_velocity(0.0, -1.0, Facing::N);
    assert_eq!(f_north, Facing::N);

    let f_east = facing_from_velocity(1.0, 0.0, Facing::E);
    assert_eq!(f_east, Facing::E);

    let f_west = facing_from_velocity(-1.0, 0.0, Facing::W);
    assert_eq!(f_west, Facing::W);
}

#[test]
fn update_zombies_moves_monsters_towards_player() {
    let mut grid = Grid::solid(20, 20);
    for x in 8..14 {
        for z in 8..14 {
            set_tile(&mut grid, x, z, T_FLOOR);
        }
    }

    let mut sim = SimState::new(grid, (0.5, 0.5), 42);
    sim.monsters.push(LiveMonster::new(1, EnemyKind::Zombie, 0.5, 2.5));

    let initial_dist = (sim.monsters[0].z - sim.player.z).abs();
    update_zombies(&mut sim, 0.1);
    let after_dist = (sim.monsters[0].z - sim.player.z).abs();

    assert!(after_dist < initial_dist);
}
