//! PATTERN CENSUS — Quantitative floor variety and geometry motif distribution analyzer.
//!
//! Measures local 5x5 tile neighborhood diversity folded under the eight symmetries of the square (D4).
//!
//! PORTS: `dev/pattern-census.ts`

use crate::grid::{at, Grid, T_FLOOR};
use std::collections::HashMap;

/// Canonicalizes a 5x5 binary patch across all 8 symmetries of the square (D4).
pub fn canonicalize_motif_5x5(patch: &[u8; 25]) -> u32 {
    let mut min_val = u32::MAX;

    // Helper to evaluate 5x5 rotation and reflection
    for flip in [false, true] {
        for rot in 0..4 {
            let mut val: u32 = 0;
            for y in 0..5 {
                for x in 0..5 {
                    let (mut src_x, mut src_y) = (x, y);
                    if flip {
                        src_x = 4 - src_x;
                    }
                    for _ in 0..rot {
                        let tmp = src_x;
                        src_x = src_y;
                        src_y = 4 - tmp;
                    }
                    let bit = patch[src_y * 5 + src_x] & 1;
                    val = (val << 1) | (bit as u32);
                }
            }
            min_val = min_val.min(val);
        }
    }

    min_val
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct PatternCensusReport {
    pub total_walkable_tiles: usize,
    pub unique_motifs_count: usize,
    pub top_motif_frequency: usize,
}

/// Evaluates a grid to produce geometric motif diversity statistics.
pub fn census_floor_patterns(grid: &Grid) -> PatternCensusReport {
    let mut motifs_map: HashMap<u32, usize> = HashMap::new();
    let mut total_walkable = 0;

    for y in 2..(grid.h - 2) {
        for x in 2..(grid.w - 2) {
            if at(grid, x, y) == T_FLOOR {
                total_walkable += 1;
                let mut patch = [0u8; 25];
                let mut idx = 0;
                for dy in -2..=2 {
                    for dx in -2..=2 {
                        patch[idx] = if at(grid, x + dx, y + dy) == T_FLOOR {
                            1
                        } else {
                            0
                        };
                        idx += 1;
                    }
                }
                let canonical = canonicalize_motif_5x5(&patch);
                *motifs_map.entry(canonical).or_insert(0) += 1;
            }
        }
    }

    let unique_motifs_count = motifs_map.len();
    let top_motif_frequency = motifs_map.values().cloned().max().unwrap_or(0);

    PatternCensusReport {
        total_walkable_tiles: total_walkable,
        unique_motifs_count,
        top_motif_frequency,
    }
}
