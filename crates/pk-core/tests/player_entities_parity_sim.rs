//! Comprehensive parity test suite for legacy/src/game/pinball-knight/entities/player.ts.

use pk_core::entities::player::*;
use pk_core::grid::Grid;
use pk_core::state::{Facing, FrameInput, SimState};

#[test]
fn player_motion_and_facing() {
    assert_eq!(facing_from_aim(1.0, 0.0), Facing::E);
    assert_eq!(facing_from_aim(-1.0, 0.0), Facing::W);
    assert_eq!(facing_from_aim(0.0, 1.0), Facing::S);
    assert_eq!(facing_from_aim(0.0, -1.0), Facing::N);

    let mut state = PlayerLocomotionState::new(10.0, 10.0);
    state.step((1.0, 0.0), 0.1);
    assert!(state.cur_speed > 0.0);
    assert_eq!(state.facing, Facing::E);

    state.reset_motion();
    assert_eq!(state.cur_speed, 0.0);
}

#[test]
fn player_dodge_roll_kinematics() {
    let mut state = PlayerLocomotionState::new(0.0, 0.0);
    assert!(state.trigger_roll((1.0, 0.0)));
    assert_eq!(state.roll_t, ROLL_DURATION);
    assert_eq!(state.iframes, ROLL_IFRAMES);

    state.step((0.0, 0.0), 0.1);
    assert!(state.roll_t < ROLL_DURATION);
    assert!(state.cur_speed > 0.0);
}

#[test]
fn wall_reflection_and_slingshot_physics() {
    let (rx, rz) = calculate_wall_reflection(5.0, 0.0, -1.0, 0.0, 0.8);
    assert!(rx < 0.0);
    assert_eq!(rz, 0.0);

    let (sx, sz) = resolve_slingshot_rebound(2.0, 2.0, 1.0);
    assert!(sx > 2.0);
    assert!(sz > 2.0);
}

#[test]
fn player_plunger_and_sim_step() {
    let mut sim = SimState::new(Grid::solid(20, 20), (5.0, 5.0), 42);
    assert_eq!(debug_cur_speed(&sim), 0.0);
    assert_eq!(debug_wall_normal(&sim), None);

    let mut input = FrameInput::default();
    input.dodge = true;
    let held = update_plunger(&mut sim, 0.1, &input);
    assert!(held);
    assert!(sim.plunger_charging);
}
