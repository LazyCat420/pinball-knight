// Parity test suite for Maze Generation Tuning Constants.
// Replicates legacy/src/game/pinball-knight/constants/maze.ts

use pk_core::constants::maze::{
    compute_room_count, compute_secrets_count, ROOMS_BASE, ROOMS_MAX, ROOM_MAX_CELLS,
    ROOM_MIN_CELLS, SECRETS_BASE, SECRETS_MAX, SECRET_BREAK_SPEED, SURFACE_BANDS, TRACK_FIRST,
    WALL_BREAK_DEPTH, WALL_BREAK_SPEED, WALL_BREAK_SPEED_COST,
};

#[test]
fn maze_generation_pipeline_flags_enabled() {
    assert!(TRACK_FIRST);
    assert!(SURFACE_BANDS);
}

#[test]
fn room_dimensions_and_progression_curve() {
    assert_eq!(ROOM_MIN_CELLS, 3);
    assert_eq!(ROOM_MAX_CELLS, 6);
    assert_eq!(ROOMS_BASE, 5.0);
    assert_eq!(ROOMS_MAX, 14);

    // Level 1 -> 5
    assert_eq!(compute_room_count(1), 5);
    // Level 2 -> 5 + 1.2 = 6.2 -> 6
    assert_eq!(compute_room_count(2), 6);
    // Level 5 -> 5 + 4*1.2 = 9.8 -> 9
    assert_eq!(compute_room_count(5), 9);
    // Deep level 20 -> capped at 14
    assert_eq!(compute_room_count(20), 14);
}

#[test]
fn wall_breaking_physics_and_secret_counts() {
    assert_eq!(SECRET_BREAK_SPEED, 7.0);
    assert_eq!(WALL_BREAK_SPEED, 15.0);
    assert_eq!(WALL_BREAK_DEPTH, 2);
    assert_eq!(WALL_BREAK_SPEED_COST, 0.7);

    assert_eq!(SECRETS_BASE, 4.0);
    assert_eq!(SECRETS_MAX, 10);

    // Level 1 -> 4
    assert_eq!(compute_secrets_count(1), 4);
    // Level 3 -> 4 + 2 = 6
    assert_eq!(compute_secrets_count(3), 6);
    // Deep level 15 -> capped at 10
    assert_eq!(compute_secrets_count(15), 10);
}
