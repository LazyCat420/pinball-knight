// Parity test suite for Deterministic Floor Seed Avalanche.
// Replicates legacy/src/game/pinball-knight/maze/floor-seed.ts

use pk_core::maze::floor_seed::{floor_rng, floor_seed, GOLDEN32};

#[test]
fn floor_seed_avalanche_mixing_matches_specification() {
    let run_seed = 0x12345678;
    let level = 1;
    let expected = run_seed ^ (level * GOLDEN32);
    assert_eq!(floor_seed(run_seed, level), expected);

    // Consecutive floors produce distinct mixed seeds
    let seed1 = floor_seed(42, 1);
    let seed2 = floor_seed(42, 2);
    let seed3 = floor_seed(42, 3);
    assert_ne!(seed1, seed2);
    assert_ne!(seed2, seed3);
    assert_ne!(seed1, seed3);
}

#[test]
fn floor_rng_draws_reproducible_sequences() {
    let mut rng1 = floor_rng(100, 5);
    let mut rng2 = floor_rng(100, 5);

    for _ in 0..10 {
        assert_eq!(rng1.next_f64(), rng2.next_f64());
    }
}
