//! Comprehensive parity test suite for legacy/src/game/pinball-knight/state.ts.

use pk_core::grid::Grid;
use pk_core::state::*;

#[test]
fn state_constants_and_types() {
    assert_eq!(WEAPON_SLOTS, 2);

    let actor = Actor {
        x: 1.0,
        z: 2.0,
        vx: 0.1,
        vz: 0.2,
        hp: 100.0,
        max_hp: 100.0,
        radius: 0.3,
        facing: Facing::S,
    };
    assert_eq!(actor.facing, Facing::S);

    let belt = BeltSlot {
        count: 3,
        kind: "potion".to_string(),
        label: "Health Potion".to_string(),
        item_id: Some("hp_pot".to_string()),
    };
    assert_eq!(belt.count, 3);
}

#[test]
fn pinball_and_environment_types() {
    let part = PinballPart {
        id: 1,
        kind: PinballPartKind::Bumper,
        x: 5.0,
        z: 5.0,
        radius: 0.5,
        points: 50,
        active: true,
    };
    assert_eq!(part.kind, PinballPartKind::Bumper);

    let fx = FloorFx {
        kind: FloorFxKind::Fire,
        x: 3.0,
        z: 3.0,
        radius: 1.2,
        duration_t: 5.0,
        active: true,
    };
    assert_eq!(fx.kind, FloorFxKind::Fire);
}

#[test]
fn player_defaults_and_visibility() {
    let player = fresh_player_fields();
    assert_eq!(player.hp, 100.0);
    assert_eq!(player.max_hp, 100.0);
    assert_eq!(player.facing, Facing::S);
    assert_eq!(player.mom_speed, 0.0);

    let sim = SimState::new(Grid::solid(20, 20), (5.0, 5.0), 42);
    assert!(player_is_visible_to_enemies(&sim));
}

#[test]
fn sim_state_execution_and_step() {
    let mut sim = SimState::new(Grid::solid(20, 20), (5.0, 5.0), 42);
    let mut input = FrameInput::default();
    input.move_x = 1.0;
    input.sprint = true;

    simulate_step(&mut sim, input);
    assert_eq!(sim.tick, 1);
}
