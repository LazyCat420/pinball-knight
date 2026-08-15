// Parity test suite for Maze Sweep Testing Axis.
// Replicates legacy/src/game/pinball-knight/maze/sweep-axis.ts

use pk_core::maze::sweep_axis::{
    archetype_index_for_level, is_level_saturated, sweep_pairs, DEEP, SATURATION_LEVEL, SHALLOW,
    SWEEP_LEVELS,
};

#[test]
fn sweep_level_sets_cover_shallow_and_deep_budget_regimes() {
    assert_eq!(SATURATION_LEVEL, 24);
    assert_eq!(SHALLOW, [1, 2, 3, 4, 5]);
    assert_eq!(DEEP, [24, 25, 26, 27, 28]);
    assert_eq!(SWEEP_LEVELS, [1, 2, 3, 4, 5, 24, 25, 26, 27, 28]);
}

#[test]
fn archetype_index_cycles_modulo_five() {
    let expected_indices = [0, 1, 2, 3, 4, 3, 4, 0, 1, 2];
    for (i, &lvl) in SWEEP_LEVELS.iter().enumerate() {
        assert_eq!(
            archetype_index_for_level(lvl),
            expected_indices[i],
            "Level {} archetype index mismatch",
            lvl
        );
    }
}

#[test]
fn saturation_status_is_pinned_at_floor_twenty_four() {
    for lvl in 1..24 {
        assert!(!is_level_saturated(lvl));
    }
    for lvl in 24..=40 {
        assert!(is_level_saturated(lvl));
    }
}

#[test]
fn sweep_pairs_generates_balanced_matrix() {
    let pairs = sweep_pairs(None, None);
    // 5 shallow * 4 seeds + 5 deep * 2 seeds = 20 + 10 = 30 pairs
    assert_eq!(pairs.len(), 30);

    let explicit_pairs = sweep_pairs(Some(&[42]), Some(&[42]));
    // 5 shallow * 1 seed + 5 deep * 1 seed = 10 pairs
    assert_eq!(explicit_pairs.len(), 10);
}
