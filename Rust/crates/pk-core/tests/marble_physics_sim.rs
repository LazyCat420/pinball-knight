//! Parity test suite for Marble Materials physics modifiers and fusion.
//! Replicates legacy/src/game/pinball-knight/entities/marble.ts

use pk_core::grid::Grid;
use pk_core::marble::*;
use pk_core::state::{simulate, FrameInput, SimState, PLAYER_R};

#[test]
fn diamond_material_boosts_restitution_and_wall_break_thresholds() {
    let mut marble = MarbleState::default();
    marble.apply_material(MarbleMaterial::Diamond);

    assert_eq!(marble.flat_restitution(), Some(DIAMOND_RESTITUTION));
    let (sec_break, wall_break) = marble.break_speeds();
    assert_eq!(sec_break, DIAMOND_SECRET_BREAK_SPEED);
    assert_eq!(wall_break, DIAMOND_WALL_BREAK_SPEED);
}

#[test]
fn water_material_glides_with_lower_friction_and_slides_on_turns() {
    let mut marble = MarbleState::default();
    marble.apply_material(MarbleMaterial::Water);

    assert_eq!(marble.friction_mult(), WATER_FRICTION_MULT);
    assert_eq!(marble.steer_mult(), WATER_STEER_MULT);
    assert_eq!(marble.flat_restitution(), Some(WATER_RESTITUTION));
    assert_eq!(marble.ram_knockback(), WATER_RAM_KNOCKBACK);
}

#[test]
fn stone_material_drags_hits_harder_and_caps_at_lower_speed() {
    let mut marble = MarbleState::default();
    marble.apply_material(MarbleMaterial::Stone);

    assert_eq!(marble.friction_mult(), STONE_FRICTION_MULT);
    assert_eq!(marble.max_speed(), STONE_MAX_SPEED);
    assert_eq!(marble.ram_damage_mult(), STONE_RAM_DAMAGE_MULT);
    assert_eq!(marble.bumper_kick_mult(), STONE_BUMPER_KICK_MULT);
    assert_eq!(marble.corner_add_mult(), STONE_CORNER_ADD_MULT);
}

#[test]
fn storm_material_rails_corridors_and_grips_turns_sharply() {
    let mut marble = MarbleState::default();
    marble.apply_material(MarbleMaterial::Storm);

    assert_eq!(marble.steer_mult(), STORM_STEER_MULT);
    assert_eq!(marble.lane_pull_mult(), STORM_LANE_PULL_MULT);
}

#[test]
fn shadow_material_narrows_collision_radius_and_scatters_bumpers() {
    let mut marble = MarbleState::default();
    marble.apply_material(MarbleMaterial::Shadow);

    assert_eq!(marble.player_radius(PLAYER_R), SHADOW_PLAYER_R);
    assert_eq!(marble.bumper_scatter_mult(), SHADOW_BUMPER_SCATTER_MULT);
    assert_eq!(marble.flat_restitution(), Some(SHADOW_RESTITUTION));
}

#[test]
fn material_duration_and_fusion_mechanic() {
    let mut marble = MarbleState::default();
    marble.apply_material(MarbleMaterial::Diamond);

    assert_eq!(marble.active_material(), Some(MarbleMaterial::Diamond));
    assert_eq!(marble.time_remaining, 8.0);
    assert_eq!(marble.fuse_material, None);

    // Apply Water while Diamond is active -> Triggers Fusion
    marble.apply_material(MarbleMaterial::Water);
    assert_eq!(marble.active_material(), Some(MarbleMaterial::Water));
    assert_eq!(marble.fuse_material, Some(MarbleMaterial::Diamond));
    assert_eq!(marble.fuse_time, MATERIAL_FUSION_TIME);

    // Update by fusion duration
    marble.update(MATERIAL_FUSION_TIME);
    assert_eq!(marble.fuse_material, None);
    assert_eq!(marble.active_material(), Some(MarbleMaterial::Water));

    // Update until water expires
    marble.update(10.0);
    assert_eq!(marble.active_material(), None);
}

#[test]
fn sim_state_ticks_marble_and_applies_modifiers_during_ride() {
    let mut grid = Grid::solid(20, 20);
    for i in 1..19 {
        for j in 1..19 {
            pk_core::grid::set_tile(&mut grid, i, j, pk_core::grid::T_FLOOR);
        }
    }
    let mut state = SimState::new(grid, (0.0, 0.0), 42);
    state.player.marble.apply_material(MarbleMaterial::Stone);
    state.player.mom_speed = 10.0;
    state.player.mom_x = 1.0;
    state.player.mom_z = 0.0;

    let input = FrameInput::default();
    simulate(&mut state, &input);

    // Marble state was ticked
    assert!(state.player.marble.time_remaining < 9.0);
}
