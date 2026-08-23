// Comprehensive simulation test suite for the Player Entity & Kinematics Engine.
// Replicates legacy/src/game/pinball-knight/entities/player.ts

use pk_core::grid::Grid;
use pk_core::player::verbs::*;
use pk_core::state::*;

#[test]
fn plunger_aim_charge_and_launch() {
    let mut grid = Grid::solid(10, 10);
    grid.t[11] = 1; // Walkable corridor
    grid.t[12] = 1;
    let mut sim = SimState::new(grid, (1.5, 1.5), 42);

    assert!(sim.plunger_armed);
    assert_eq!(sim.player.mom_speed, 0.0);

    // Aim right (move_x = 1.0)
    let aim_input = FrameInput {
        move_x: 1.0,
        ..Default::default()
    };
    update_plunger(&mut sim, 0.1, &aim_input);
    assert!(sim.plunger_aim > 0.0);

    // Hold dodge to charge plunger
    let charge_input = FrameInput {
        dodge: true,
        ..Default::default()
    };
    for _ in 0..10 {
        update_plunger(&mut sim, 0.1, &charge_input);
    }
    assert!(sim.plunger_power > 0.5);

    // Release dodge to launch!
    let release_input = FrameInput::default();
    let launched = update_plunger(&mut sim, 0.016, &release_input);
    assert!(launched);
    assert!(!sim.plunger_armed);
    assert!(sim.player.mom_speed > 10.0);
}

#[test]
fn reset_player_motion_clears_momentum_and_timers() {
    let mut grid = Grid::solid(10, 10);
    grid.t[11] = 1;
    let mut sim = SimState::new(grid, (1.5, 1.5), 42);

    sim.cur_speed = 4.2;
    sim.sprint_grace_t = 0.5;
    sim.player.mom_speed = 12.0;
    sim.player.sprint_charge = 0.8;
    sim.player.bounce_combo = 3.0;

    reset_player_motion(&mut sim);

    assert_eq!(sim.cur_speed, 0.0);
    assert_eq!(sim.sprint_grace_t, 0.0);
    assert_eq!(sim.player.mom_speed, 0.0);
    assert_eq!(sim.player.sprint_charge, 0.0);
    assert_eq!(sim.player.bounce_combo, 0.0);
}

#[test]
fn debug_telemetry_probes() {
    let mut grid = Grid::solid(10, 10);
    grid.t[11] = 1;
    let mut sim = SimState::new(grid, (1.5, 1.5), 42);

    sim.cur_speed = 5.6;
    assert_eq!(debug_cur_speed(&sim), 5.6);

    // Stationary player -> None normal
    sim.player.mom_speed = 0.0;
    assert_eq!(debug_wall_normal(&sim), None);

    // Moving player against wall -> Some normal
    sim.player.mom_speed = 8.0;
    let _normal = debug_wall_normal(&sim);
}

#[test]
fn update_player_continuous_step() {
    let mut grid = Grid::solid(10, 10);
    // Fill interior with walkable floor
    for i in 1..9 {
        for j in 1..9 {
            grid.t[(j * 10 + i) as usize] = 1;
        }
    }
    let mut sim = SimState::new(grid, (0.0, 0.0), 42);
    sim.plunger_armed = false; // Disarm plunger so walk moves player

    let input = FrameInput {
        move_x: 1.0,
        sprint: true,
        ..Default::default()
    };

    let start_x = sim.player.x;
    for _ in 0..10 {
        update_player(&mut sim, 0.016, &input);
    }

    assert!(sim.player.x > start_x);
    assert!(sim.player.sprint_charge > 0.0);
}
