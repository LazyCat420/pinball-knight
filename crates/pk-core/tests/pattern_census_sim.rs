// Parity test suite for Floor Pattern & Geometry Motif Diversity Census.
// Replicates legacy/src/game/pinball-knight/dev/pattern-census.ts

use pk_core::dev::headless_floor::build_headless_floor;
use pk_core::dev::pattern_census::{canonicalize_motif_5x5, census_floor_patterns};

#[test]
fn pattern_census_canonical_d4_symmetry_invariance() {
    let mut patch_base = [0u8; 25];
    patch_base[0] = 1; // Top-left corner

    let mut patch_rot90 = [0u8; 25];
    patch_rot90[4] = 1; // Top-right corner

    let mut patch_flip = [0u8; 25];
    patch_flip[4] = 1; // Top-right corner

    let can_base = canonicalize_motif_5x5(&patch_base);
    let can_rot = canonicalize_motif_5x5(&patch_rot90);
    let can_flip = canonicalize_motif_5x5(&patch_flip);

    assert_eq!(can_base, can_rot);
    assert_eq!(can_base, can_flip);
}

#[test]
fn pattern_census_extracts_floor_diversity_metrics() {
    let floor = build_headless_floor(3, 42).expect("headless floor generation");
    let report = census_floor_patterns(&floor.grid);

    assert!(report.total_walkable_tiles > 0);
    assert!(report.unique_motifs_count > 0);
    assert!(report.top_motif_frequency > 0);
}
