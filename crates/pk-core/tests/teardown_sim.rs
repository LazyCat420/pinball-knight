// Parity test suite for Floor Lifecycle Teardown Engine.
// Replicates legacy/src/game/pinball-knight/dispose.ts

use pk_core::engine::teardown::{
    dispose_all, dispose_level, PersistentGameState, TransientFloorState,
};

#[test]
fn dispose_level_clears_transient_entities_and_preserves_progression() {
    let mut floor = TransientFloorState {
        zombies: 45,
        ground_items: 12,
        props: 8,
        projectiles: 3,
        floor_fx: 16,
        multiball_echoes: 2,
        lamp_puzzles: 1,
        maze_active: true,
        grid_active: true,
        flow_field_active: true,
    };

    let game = PersistentGameState {
        player_hp: 120,
        player_gold: 350,
        player_level: 4,
        floor_index: 3,
        multiball_time_remaining: 5.5,
    };

    dispose_level(&mut floor);

    // Floor entities are wiped
    assert_eq!(floor.zombies, 0);
    assert_eq!(floor.ground_items, 0);
    assert_eq!(floor.projectiles, 0);
    assert!(!floor.maze_active);
    assert!(!floor.grid_active);

    // Persistent game progression is preserved
    assert_eq!(game.player_hp, 120);
    assert_eq!(game.player_gold, 350);
    assert_eq!(game.player_level, 4);
    assert_eq!(game.floor_index, 3);
    assert_eq!(game.multiball_time_remaining, 5.5);
}

#[test]
fn dispose_all_resets_full_game_state() {
    let mut floor = TransientFloorState {
        zombies: 10,
        ground_items: 5,
        props: 2,
        projectiles: 1,
        floor_fx: 4,
        multiball_echoes: 0,
        lamp_puzzles: 0,
        maze_active: true,
        grid_active: true,
        flow_field_active: true,
    };

    let mut game = PersistentGameState {
        player_hp: 80,
        player_gold: 500,
        player_level: 6,
        floor_index: 5,
        multiball_time_remaining: 0.0,
    };

    dispose_all(&mut floor, &mut game);

    assert_eq!(floor.zombies, 0);
    assert_eq!(game.player_hp, 100);
    assert_eq!(game.player_gold, 0);
    assert_eq!(game.player_level, 1);
    assert_eq!(game.floor_index, 1);
}
