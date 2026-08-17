//! Comprehensive parity test suite for legacy/src/game/pinball-knight/dev/pattern-census.ts.

use pk_core::dev::pattern_census::*;
use pk_core::grid::{set_tile, Grid, T_FLOOR};
use pk_core::maze::decorate::PinballPartSpot;

#[test]
fn motif_canonicalization_d4_invariance() {
    let mut patch1 = [0u8; 25];
    patch1[0] = 1; // Top-left corner

    let mut patch2 = [0u8; 25];
    patch2[4] = 1; // Top-right corner (horizontal reflection / 90-deg rotation)

    let mut patch3 = [0u8; 25];
    patch3[24] = 1; // Bottom-right corner (180-deg rotation)

    let c1 = canonicalize_motif_5x5(&patch1);
    let c2 = canonicalize_motif_5x5(&patch2);
    let c3 = canonicalize_motif_5x5(&patch3);

    // All single-corner patches must fold into the exact same canonical motif id
    assert_eq!(c1, c2);
    assert_eq!(c2, c3);
}

#[test]
fn concentration_top_n_calculation() {
    let counts = vec![50, 30, 20, 10, 5];
    let total = 115;
    let conc = compute_concentration(&counts, total);

    assert_eq!(conc.unique_count, 5);
    assert!((conc.top_1_share - (50.0 / 115.0)).abs() < 1e-6);
    assert!((conc.top_3_share - (100.0 / 115.0)).abs() < 1e-6);
}

#[test]
fn pattern_census_grid_evaluation_and_formatting() {
    let mut grid = Grid::solid(25, 25);
    for y in 2..23 {
        for x in 2..23 {
            set_tile(&mut grid, x, y, T_FLOOR);
        }
    }

    let parts = vec![
        PinballPartSpot {
            i: 5,
            j: 5,
            kind: "bumper".to_string(),
            dir_i: 1,
            dir_j: 0,
            dir2_i: 0,
            dir2_j: 0,
            hits: 0,
        },
        PinballPartSpot {
            i: 6,
            j: 5,
            kind: "booster".to_string(),
            dir_i: 1,
            dir_j: 0,
            dir2_i: 0,
            dir2_j: 0,
            hits: 0,
        },
    ];

    let census = census_patterns(&grid, &parts);
    assert!(census.total_walkable_tiles > 0);
    assert!(!census.geometry_motifs.is_empty());
    assert_eq!(census.furniture_vocabulary.len(), 2);
    assert_eq!(census.launch_rules.total_parts, 2);

    let summary = format_census(&census);
    assert!(summary.contains("PATTERN CENSUS SUMMARY"));
    assert!(summary.contains("Total Walkable:"));
}
