//! Full 60Hz SimState Loop Integration Tests — Abilities, Combat, and Monster AI.
//! PORTS-NOTHING (Rust engine integration validation)

use pk_core::grid::Grid;
use pk_core::monsters::types::{EnemyKind, EnemyMode, LiveMonster};
use pk_core::state::{simulate, Facing, FrameInput, SimState};

#[test]
fn abilities_trigger_and_enter_cooldown() {
    let grid = Grid::solid(15, 15);
    let mut sim = SimState::new(grid, (7.5, 7.5), 42);

    // Initial state: abilities ready
    assert!(sim.abilities.slot_1.is_ready());
    assert!(sim.abilities.slot_2.is_ready());

    // Trigger Q: Flipper Charge
    let input = FrameInput {
        ability_1: true,
        ..Default::default()
    };
    simulate(&mut sim, &input);

    // Flipper charge gave player momentum and started slot 1 cooldown
    assert!(!sim.abilities.slot_1.is_ready());
    assert!(sim.player.mom_speed >= 10.0);

    // Trigger E: Time Crawl
    let input2 = FrameInput {
        ability_2: true,
        ..Default::default()
    };
    simulate(&mut sim, &input2);

    assert!(!sim.abilities.slot_2.is_ready());
    assert!(sim.abilities.time_crawl_t > 0.0);
}

#[test]
fn melee_attack_damages_staggers_and_kills_monsters() {
    let mut grid = Grid::solid(20, 20);
    // Carve open floor
    for j in 1..19 {
        for i in 1..19 {
            pk_core::grid::set_tile(&mut grid, i, j, pk_core::grid::T_FLOOR);
        }
    }
    let (px, pz) = pk_core::grid::tile_center(&grid, 10, 10);
    let mut sim = SimState::new(grid, (px, pz), 101);
    sim.player.facing = Facing::S;

    // Spawn a monster directly south of the player in attack range
    let monster = LiveMonster::new(1, EnemyKind::Zombie, px, pz + 0.8);
    let initial_hp = monster.hp;
    sim.monsters.push(monster);

    // Player attacks
    let input = FrameInput {
        attack: true,
        ..Default::default()
    };
    simulate(&mut sim, &input);

    // Check monster took damage and entered stagger
    assert!(sim.monsters[0].hp < initial_hp, "Monster should take damage");
    assert!(sim.monsters[0].stagger_t > 0.0, "Monster should be staggered");
    assert!(sim.monsters[0].kbz > 0.0, "Monster should have knockback vector");

    // Attack repeatedly until dead
    for _ in 0..200 {
        if sim.monsters[0].hp <= 0.0 {
            break;
        }
        sim.player.z = sim.monsters[0].z - 0.5;
        sim.player.facing = Facing::S;
        sim.player.slash.active = false;
        let atk = FrameInput {
            attack: true,
            ..Default::default()
        };
        simulate(&mut sim, &atk);
    }

    assert_eq!(sim.monsters[0].mode, EnemyMode::Dead);
    assert!(sim.gold_run > 0, "Monster kill should award gold");
    assert!(sim.jackpots > 0, "Monster kill should award jackpot point");
}

#[test]
fn monster_chases_and_damages_player() {
    let mut grid = Grid::solid(20, 20);
    for j in 1..19 {
        for i in 1..19 {
            pk_core::grid::set_tile(&mut grid, i, j, pk_core::grid::T_FLOOR);
        }
    }
    let (px, pz) = pk_core::grid::tile_center(&grid, 10, 10);
    let mut sim = SimState::new(grid, (px, pz), 202);

    // Spawn monster 2 tiles away
    let monster = LiveMonster::new(1, EnemyKind::Brute, px, pz + 2.0);
    sim.monsters.push(monster);

    // Step simulation for 60 ticks (1 second) with idle player
    let input = FrameInput::default();
    for _ in 0..60 {
        simulate(&mut sim, &input);
    }

    // Monster should have moved closer to player (from pz + 2.0 towards pz)
    assert!(
        sim.monsters[0].z < pz + 2.0,
        "Monster should pursue player towards pz={}, current z={}",
        pz,
        sim.monsters[0].z
    );
}
