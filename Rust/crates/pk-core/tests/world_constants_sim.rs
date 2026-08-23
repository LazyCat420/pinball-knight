// Parity test suite for World Scale and Fixed-Step Constants.
// Replicates legacy/src/game/pinball-knight/constants/world.ts

use pk_core::constants::world::{FIXED_STEP, MAX_FRAME, TILE, WALL_H, WALL_LOW};

#[test]
fn world_constants_match_engine_scale() {
    assert_eq!(TILE, 1.0);
    assert_eq!(WALL_H, 1.1);
    assert_eq!(WALL_LOW, 0.35);

    // Wall low is strictly less than full wall height for Diablo 1 camera cutaway
    assert!(WALL_LOW < WALL_H);
}

#[test]
fn game_loop_timing_constants_match_sixty_hertz_accumulator() {
    assert_eq!(FIXED_STEP, 1.0 / 60.0);
    assert_eq!(MAX_FRAME, 0.1);

    let hz = 1.0 / FIXED_STEP;
    assert!((hz - 60.0).abs() < 1e-9);
}
