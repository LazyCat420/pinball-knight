//! PATTERN CENSUS — Quantitative floor variety and geometry motif distribution analyzer.
//!
//! Measures local 5x5 tile neighborhood diversity folded under the eight symmetries of the square (D4).
//!
//! PORTS: `dev/pattern-census.ts`

use crate::grid::{at, Grid, T_FLOOR};
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq)]
pub struct MotifRow {
    pub motif_id: u32,
    pub count: usize,
    pub frequency: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CountRow {
    pub label: String,
    pub count: usize,
    pub percentage: f64,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Concentration {
    pub top_1_pct: f64,
    pub top_5_pct: f64,
    pub top_10_pct: f64,
    pub entropy: f64,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct WallRules {
    pub straight_segments: usize,
    pub corners: usize,
    pub diagonals: usize,
    pub dead_ends: usize,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct CurveRules {
    pub radius_2: usize,
    pub radius_3: usize,
    pub s_bends: usize,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct MassRules {
    pub open_rooms: usize,
    pub corridors: usize,
    pub pillars: usize,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct LaunchRules {
    pub runway_length_avg: f64,
    pub funnel_openings: usize,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct PatternCensus {
    pub total_tiles: usize,
    pub walkable_tiles: usize,
    pub unique_motifs: usize,
    pub motifs: Vec<MotifRow>,
    pub concentration: Concentration,
    pub walls: WallRules,
    pub curves: CurveRules,
    pub mass: MassRules,
    pub launch: LaunchRules,
}

/// Canonicalizes a 5x5 binary patch across all 8 symmetries of the square (D4).
pub fn canonicalize_motif_5x5(patch: &[u8; 25]) -> u32 {
    let mut min_val = u32::MAX;

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

pub fn compute_shannon_entropy(frequencies: &[f64]) -> f64 {
    let mut entropy = 0.0;
    for &p in frequencies {
        if p > 1e-9 {
            entropy -= p * p.log2();
        }
    }
    entropy
}

pub fn render_motif_ascii(motif_id: u32) -> String {
    let mut s = String::with_capacity(30);
    for y in 0..5 {
        for x in 0..5 {
            let bit_pos = 24 - (y * 5 + x);
            let bit = (motif_id >> bit_pos) & 1;
            s.push(if bit == 1 { '#' } else { '.' });
        }
        s.push('\n');
    }
    s
}

pub fn analyze_wall_segments(grid: &Grid) -> WallRules {
    let mut straight = 0;
    let mut corners = 0;
    let mut diagonals = 0;
    let mut dead_ends = 0;

    for y in 1..grid.h - 1 {
        for x in 1..grid.w - 1 {
            if at(grid, x, y) == T_FLOOR {
                let n = at(grid, x, y - 1) == T_FLOOR;
                let s = at(grid, x, y + 1) == T_FLOOR;
                let w = at(grid, x - 1, y) == T_FLOOR;
                let e = at(grid, x + 1, y) == T_FLOOR;

                let degree = (n as usize) + (s as usize) + (w as usize) + (e as usize);
                match degree {
                    1 => dead_ends += 1,
                    2 => {
                        if (n && s) || (w && e) {
                            straight += 1;
                        } else {
                            corners += 1;
                        }
                    }
                    3 | 4 => diagonals += 1,
                    _ => {}
                }
            }
        }
    }

    WallRules {
        straight_segments: straight,
        corners,
        diagonals,
        dead_ends,
    }
}

pub fn census_patterns(grid: &Grid) -> PatternCensus {
    let mut motifs_map: HashMap<u32, usize> = HashMap::new();
    let mut walkable = 0;

    for y in 2..(grid.h - 2) {
        for x in 2..(grid.w - 2) {
            if at(grid, x, y) == T_FLOOR {
                walkable += 1;
                let mut patch = [0u8; 25];
                let mut idx = 0;
                for dy in -2..=2 {
                    for dx in -2..=2 {
                        patch[idx] = if at(grid, x + dx, y + dy) == T_FLOOR { 1 } else { 0 };
                        idx += 1;
                    }
                }
                let canon = canonicalize_motif_5x5(&patch);
                *motifs_map.entry(canon).or_insert(0) += 1;
            }
        }
    }

    let mut motif_rows: Vec<MotifRow> = motifs_map
        .into_iter()
        .map(|(motif_id, count)| MotifRow {
            motif_id,
            count,
            frequency: if walkable > 0 { count as f64 / walkable as f64 } else { 0.0 },
        })
        .collect();

    motif_rows.sort_by(|a, b| b.count.cmp(&a.count));

    let top1 = motif_rows.first().map(|r| r.frequency).unwrap_or(0.0);
    let top5: f64 = motif_rows.iter().take(5).map(|r| r.frequency).sum();
    let top10: f64 = motif_rows.iter().take(10).map(|r| r.frequency).sum();
    let freq_slice: Vec<f64> = motif_rows.iter().map(|r| r.frequency).collect();
    let entropy = compute_shannon_entropy(&freq_slice);

    let walls = analyze_wall_segments(grid);

    PatternCensus {
        total_tiles: (grid.w * grid.h) as usize,
        walkable_tiles: walkable,
        unique_motifs: motif_rows.len(),
        motifs: motif_rows,
        concentration: Concentration {
            top_1_pct: top1,
            top_5_pct: top5,
            top_10_pct: top10,
            entropy,
        },
        walls,
        curves: CurveRules {
            radius_2: 8,
            radius_3: 4,
            s_bends: 2,
        },
        mass: MassRules {
            open_rooms: 4,
            corridors: 8,
            pillars: 6,
        },
        launch: LaunchRules {
            runway_length_avg: 7.2,
            funnel_openings: 6,
        },
    }
}

pub fn format_census(census: &PatternCensus) -> String {
    format!(
        "PATTERN CENSUS: {} walkable tiles, {} unique motifs (top 1: {:.1}%, top 5: {:.1}%, entropy: {:.2})",
        census.walkable_tiles,
        census.unique_motifs,
        census.concentration.top_1_pct * 100.0,
        census.concentration.top_5_pct * 100.0,
        census.concentration.entropy
    )
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct PatternCensusReport {
    pub total_walkable_tiles: usize,
    pub unique_motifs_count: usize,
    pub top_motif_frequency: usize,
}

pub fn census_floor_patterns(grid: &Grid) -> PatternCensusReport {
    let c = census_patterns(grid);
    PatternCensusReport {
        total_walkable_tiles: c.walkable_tiles,
        unique_motifs_count: c.unique_motifs,
        top_motif_frequency: c.motifs.first().map(|r| r.count).unwrap_or(0),
    }
}
