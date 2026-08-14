//! Combat and Monster Horde Integration Tests
//!
//! Verifies melee attacks, combo chains, pinball ball ramming, and enemy AI simulation.

use pk_core::grid::{set_tile, Grid, T_FLOOR};
use pk_core::state::{simulate, Facing, FrameInput, SimState};
use pk_core::zombie_ai::{EnemyMode, LiveEnemy};

#[test]
fn melee_attack_damages_and_staggers_living_monster() {
    let mut grid = Grid::solid(15, 15);
    for i in 1..14 {
        for j in 1..14 {
            set_tile(&mut grid, i, j, T_FLOOR);
        }
    }
    let mut sim = SimState::new(grid, (5.0, 5.0), 1);
    sim.plunger_armed = false;
    sim.player.facing = Facing::E;

    // Spawn an enemy 0.8 tiles directly in front of the knight
    let enemy = LiveEnemy::new_by_index(1, 0, 5.8, 5.0);
    let initial_hp = enemy.hp;
    sim.enemies.push(enemy);

    // Trigger melee attack (KeyK / LMB pressed on frame 1)
    let attack_press = FrameInput {
        move_x: 0.0,
        move_z: 0.0,
        sprint: false,
        dodge: false,
        attack: true,
        attack_just_pressed: true,
    };
    simulate(&mut sim, &attack_press);

    let attack_hold = FrameInput {
        move_x: 0.0,
        move_z: 0.0,
        sprint: false,
        dodge: false,
        attack: true,
        attack_just_pressed: false,
    };

    // Step simulation through swing active window
    for _ in 1..20 {
        simulate(&mut sim, &attack_hold);
    }

    // Verify enemy took damage and was knocked back east
    assert!(sim.enemies[0].hp < initial_hp, "enemy took melee damage");
    assert!(sim.enemies[0].x > 5.8, "enemy was knocked back east");
}

#[test]
fn pinball_ball_ramming_smashes_enemy_horde() {
    let mut grid = Grid::solid(20, 20);
    for i in 1..19 {
        for j in 1..19 {
            set_tile(&mut grid, i, j, T_FLOOR);
        }
    }
    let mut sim = SimState::new(grid, (5.0, 5.0), 1);
    sim.plunger_armed = false;

    // Launch player at high speed
    sim.player.mom_x = 10.0;
    sim.player.mom_z = 0.0;
    sim.player.mom_speed = 10.0;
    sim.player.overcharge = 1.0; // In ball mode

    // Spawn enemy in the direct flight path
    let enemy = LiveEnemy::new_by_index(2, 0, 6.0, 5.0);
    let initial_hp = enemy.hp;
    sim.enemies.push(enemy);

    // Step simulation
    for _ in 0..10 {
        simulate(&mut sim, &FrameInput::default());
    }

    // Verify high-speed ball ram dealt heavy damage
    assert!(sim.enemies[0].hp < initial_hp, "ball ram dealt damage");
    assert!(sim.enemies[0].mode == EnemyMode::Dead || sim.enemies[0].hp < initial_hp);
}
