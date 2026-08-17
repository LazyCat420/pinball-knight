//! Comprehensive test suite for legacy/src/game/pinball-knight/entities/combat.ts.

use pk_core::combat::*;
use pk_core::grid::Grid;
use pk_core::items::WeaponId;
use pk_core::monsters::types::{EnemyKind, LiveMonster};
use pk_core::state::{Facing, SimState};

#[test]
fn combat_constants_and_facing_vectors() {
    assert_eq!(UNIT_MELEE.damage, 1.0);
    assert_eq!(UNIT_MELEE.knockback, 1.0);
    assert_eq!(UNIT_MELEE.reach, 1.0);
    assert_eq!(UNIT_MELEE.arc, 1.0);

    assert_eq!(facing_vector(Facing::S), (0.0, 1.0));
    assert_eq!(facing_vector(Facing::N), (0.0, -1.0));
    assert_eq!(facing_vector(Facing::W), (-1.0, 0.0));
    assert_eq!(facing_vector(Facing::E), (1.0, 0.0));
}

#[test]
fn player_damage_scaling_and_calculations() {
    let weapon = WeaponId::Sword.def();

    // Base damage + weapon
    let dmg1 = player_damage(10.0, Some(&weapon), 0.0, None);
    assert_eq!(dmg1, 10.0 + weapon.damage as f64);

    // Momentum speed scaling
    let dmg2 = player_damage(10.0, Some(&weapon), 10.0, None);
    assert!(dmg2 > dmg1);
}

#[test]
fn enemy_hit_resolution_and_stagger() {
    let hit = resolve_enemy_hit(
        50.0, // current hp
        50.0, // max hp
        20.0, // incoming dmg
        1.0, 0.0, // dir
        1.1, // base knockback
        2.0, // combo count
        5.0, // mom speed
    );

    assert!(hit.damage_dealt >= 20.0);
    assert!(!hit.is_kill);
    assert!(hit.knockback_x > 0.0);
    assert_eq!(hit.knockback_z, 0.0);
}

#[test]
fn sim_state_combat_verbs() {
    let mut sim = SimState::new(Grid::solid(20, 20), (5.0, 5.0), 42);
    sim.player.hp = 100.0;
    sim.player.mom_speed = 4.0;
    sim.player.facing = Facing::S;

    // Add a live monster
    sim.monsters.push(LiveMonster::new(1, EnemyKind::Zombie, 5.5, 6.0));

    // Damage zombie
    let hit_res = damage_zombie(&mut sim, 0, 15.0, DamageSource::Steel, (0.0, 1.0));
    assert!(hit_res.is_some());
    assert!(sim.monsters[0].hp < 30.0);

    // Player attack sweep
    assert!(resolve_player_attack(&mut sim, UNIT_MELEE));

    // Hit player
    hit_player(&mut sim, EnemyKind::Zombie, (5.5, 6.0));
    assert!(sim.player.hp < 100.0);
    assert!(sim.player.iframes > 0.0);

    // Tick combat timers
    tick_combat_timers(&mut sim, 0.1);
    assert!(sim.player.iframes < PLAYER_IFRAMES);

    // Web player
    web_player(&mut sim);
    assert!(sim.player.mom_speed < 4.0);

    // Kill zombie
    kill_zombie(&mut sim, 0);
    assert_eq!(sim.monsters.len(), 0);
}
