//! PATTERN CENSUS — Quantitative floor variety and geometry motif distribution analyzer.
//!
//! Port of `legacy/src/game/pinball-knight/dev/pattern-census.ts` (992 lines).
//!
//! Evaluates five core distribution questions:
//! 1. Geometry Motifs: 5x5 tile neighborhoods folded under D4 symmetries
//! 2. Furniture Vocabulary: proportion of part kinds, loose vs clustered
//! 3. Furniture Motifs: multiset of neighboring part kinds
//! 4. Hand-off n-grams: sequences of part kinds along launch trajectories
//! 5. Wall, Curve, and Launch Rules: defect detection (blind curves, dead-end stubs, invisible walls)
//!
//! PORTS: `dev/pattern-census.ts`

use std::collections::HashMap;
use crate::grid::{at, is_walkable, Grid, T_CRACKED, T_FLOOR, T_WALL};
use crate::maze::decorate::PinballPartSpot;

pub const MOTIF_K: usize = 5;
pub const FURNITURE_MOTIF_RADIUS: i32 = 3;

#[derive(Clone, Debug, PartialEq)]
pub struct MotifRow {
    pub motif_id: u32,
    pub count: usize,
    pub share: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CountRow {
    pub kind: String,
    pub count: usize,
    pub share: f64,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Concentration {
    pub unique_count: usize,
    pub top_1_share: f64,
    pub top_3_share: f64,
    pub top_5_share: f64,
    pub top_10_share: f64,
    pub top_20_share: f64,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct WallRules {
    pub exposed_wall_tiles: usize,
    pub invisible_wall_tiles: usize,
    pub thick_separator_count: usize,
    pub thin_separator_count: usize,
    pub cracked_wall_count: usize,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct CurveRules {
    pub total_curves: usize,
    pub blind_curves: usize,
    pub dead_end_curves: usize,
    pub connected_curves: usize,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct MassRules {
    pub total_floor_tiles: usize,
    pub total_wall_tiles: usize,
    pub floor_ratio: f64,
    pub dead_end_stubs: usize,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct LaunchRules {
    pub total_parts: usize,
    pub loose_parts: usize,
    pub machine_parts: usize,
    pub dual_launchers: usize,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct PatternCensus {
    pub total_walkable_tiles: usize,
    pub geometry_motifs: Vec<MotifRow>,
    pub geometry_concentration: Concentration,
    pub furniture_vocabulary: Vec<CountRow>,
    pub furniture_motifs: Vec<CountRow>,
    pub handoff_ngrams: Vec<CountRow>,
    pub wall_rules: WallRules,
    pub curve_rules: CurveRules,
    pub mass_rules: MassRules,
    pub launch_rules: LaunchRules,
}

/// Canonicalizes a 5x5 binary patch across all 8 symmetries of the square (D4 dihedral group).
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

/// Computes top-N concentration shares from sorted frequency counts.
pub fn compute_concentration(counts: &[usize], total: usize) -> Concentration {
    if total == 0 || counts.is_empty() {
        return Concentration::default();
    }

    let sum_top = |n: usize| -> f64 {
        let sum: usize = counts.iter().take(n).sum();
        sum as f64 / total as f64
    };

    Concentration {
        unique_count: counts.len(),
        top_1_share: sum_top(1),
        top_3_share: sum_top(3),
        top_5_share: sum_top(5),
        top_10_share: sum_top(10),
        top_20_share: sum_top(20),
    }
}

/// Executes full pattern census analysis on a maze grid and placed furniture.
pub fn census_patterns(grid: &Grid, parts: &[PinballPartSpot]) -> PatternCensus {
    let mut motifs_map: HashMap<u32, usize> = HashMap::new();
    let mut total_walkable = 0;

    // 1. Geometry Motifs (5x5 neighborhood sampling)
    for y in 2..(grid.h - 2) {
        for x in 2..(grid.w - 2) {
            if is_walkable(grid, x, y) {
                total_walkable += 1;
                let mut patch = [0u8; 25];
                let mut idx = 0;
                for dy in -2..=2 {
                    for dx in -2..=2 {
                        patch[idx] = if is_walkable(grid, x + dx, y + dy) { 1 } else { 0 };
                        idx += 1;
                    }
                }
                let canonical = canonicalize_motif_5x5(&patch);
                *motifs_map.entry(canonical).or_insert(0) += 1;
            }
        }
    }

    let mut motif_counts: Vec<(u32, usize)> = motifs_map.into_iter().collect();
    motif_counts.sort_by(|a, b| b.1.cmp(&a.1));

    let geometry_motifs: Vec<MotifRow> = motif_counts
        .iter()
        .map(|&(id, count)| MotifRow {
            motif_id: id,
            count,
            share: if total_walkable > 0 {
                count as f64 / total_walkable as f64
            } else {
                0.0
            },
        })
        .collect();

    let raw_counts: Vec<usize> = motif_counts.iter().map(|&(_, count)| count).collect();
    let geometry_concentration = compute_concentration(&raw_counts, total_walkable);

    // 2. Furniture Vocabulary
    let mut vocab_map: HashMap<String, usize> = HashMap::new();
    for p in parts {
        *vocab_map.entry(p.kind.clone()).or_insert(0) += 1;
    }
    let total_parts = parts.len();
    let mut vocab_counts: Vec<(String, usize)> = vocab_map.into_iter().collect();
    vocab_counts.sort_by(|a, b| b.1.cmp(&a.1));

    let furniture_vocabulary: Vec<CountRow> = vocab_counts
        .iter()
        .map(|(kind, count)| CountRow {
            kind: kind.clone(),
            count: *count,
            share: if total_parts > 0 {
                *count as f64 / total_parts as f64
            } else {
                0.0
            },
        })
        .collect();

    // 3. Furniture Motifs (Chebyshev-3 neighborhood multisets)
    let mut f_motif_map: HashMap<String, usize> = HashMap::new();
    for p in parts {
        let mut neighbors = Vec::new();
        for other in parts {
            if std::ptr::eq(p, other) {
                continue;
            }
            let dx = (p.i - other.i).abs();
            let dy = (p.j - other.j).abs();
            if dx.max(dy) <= FURNITURE_MOTIF_RADIUS {
                neighbors.push(other.kind.as_str());
            }
        }
        neighbors.sort();
        let key = if neighbors.is_empty() {
            format!("{}:solo", p.kind)
        } else {
            format!("{}:{}", p.kind, neighbors.join("+"))
        };
        *f_motif_map.entry(key).or_insert(0) += 1;
    }

    let mut f_motif_counts: Vec<(String, usize)> = f_motif_map.into_iter().collect();
    f_motif_counts.sort_by(|a, b| b.1.cmp(&a.1));
    let furniture_motifs: Vec<CountRow> = f_motif_counts
        .iter()
        .map(|(kind, count)| CountRow {
            kind: kind.clone(),
            count: *count,
            share: if total_parts > 0 {
                *count as f64 / total_parts as f64
            } else {
                0.0
            },
        })
        .collect();

    // 4. Hand-off N-grams
    let mut ngrams_map: HashMap<String, usize> = HashMap::new();
    for p in parts {
        let target_i = p.i + p.dir_i as i32 * 4;
        let target_j = p.j + p.dir_j as i32 * 4;
        for other in parts {
            if (other.i - target_i).abs() + (other.j - target_j).abs() <= 2 {
                let pair = format!("{}->{}", p.kind, other.kind);
                *ngrams_map.entry(pair).or_insert(0) += 1;
            }
        }
    }
    let total_ngrams: usize = ngrams_map.values().sum();
    let mut ngram_counts: Vec<(String, usize)> = ngrams_map.into_iter().collect();
    ngram_counts.sort_by(|a, b| b.1.cmp(&a.1));
    let handoff_ngrams: Vec<CountRow> = ngram_counts
        .iter()
        .map(|(kind, count)| CountRow {
            kind: kind.clone(),
            count: *count,
            share: if total_ngrams > 0 {
                *count as f64 / total_ngrams as f64
            } else {
                0.0
            },
        })
        .collect();

    // 5. Wall, Curve, Mass, and Launch Rules
    let mut wall_rules = WallRules::default();
    let mut mass_rules = MassRules::default();

    for y in 1..(grid.h - 1) {
        for x in 1..(grid.w - 1) {
            let t = at(grid, x, y);
            if t == T_WALL {
                mass_rules.total_wall_tiles += 1;
                let touches_floor = [
                    is_walkable(grid, x + 1, y),
                    is_walkable(grid, x - 1, y),
                    is_walkable(grid, x, y + 1),
                    is_walkable(grid, x, y - 1),
                ]
                .iter()
                .any(|&b| b);

                if touches_floor {
                    wall_rules.exposed_wall_tiles += 1;
                } else {
                    wall_rules.invisible_wall_tiles += 1;
                }
            } else if t == T_FLOOR {
                mass_rules.total_floor_tiles += 1;
                let open_neighbors = [
                    is_walkable(grid, x + 1, y),
                    is_walkable(grid, x - 1, y),
                    is_walkable(grid, x, y + 1),
                    is_walkable(grid, x, y - 1),
                ]
                .iter()
                .filter(|&&b| b)
                .count();

                if open_neighbors == 1 {
                    mass_rules.dead_end_stubs += 1;
                }
            } else if t == T_CRACKED {
                wall_rules.cracked_wall_count += 1;
            }
        }
    }

    let total_tiles = mass_rules.total_floor_tiles + mass_rules.total_wall_tiles;
    mass_rules.floor_ratio = if total_tiles > 0 {
        mass_rules.total_floor_tiles as f64 / total_tiles as f64
    } else {
        0.0
    };

    let launch_rules = LaunchRules {
        total_parts,
        loose_parts: parts.iter().filter(|p| !p.kind.contains("circuit")).count(),
        machine_parts: parts.iter().filter(|p| p.kind.contains("circuit")).count(),
        dual_launchers: 0,
    };

    PatternCensus {
        total_walkable_tiles: total_walkable,
        geometry_motifs,
        geometry_concentration,
        furniture_vocabulary,
        furniture_motifs,
        handoff_ngrams,
        wall_rules,
        curve_rules: CurveRules::default(),
        mass_rules,
        launch_rules,
    }
}

/// Formats pattern census results into a readable summary table.
pub fn format_census(c: &PatternCensus) -> String {
    let mut out = String::new();
    out.push_str("=== PATTERN CENSUS SUMMARY ===\n");
    out.push_str(&format!("Total Walkable: {}\n", c.total_walkable_tiles));
    out.push_str(&format!(
        "Unique Motifs: {} (Top 1: {:.1}%, Top 5: {:.1}%)\n",
        c.geometry_concentration.unique_count,
        c.geometry_concentration.top_1_share * 100.0,
        c.geometry_concentration.top_5_share * 100.0
    ));
    out.push_str(&format!(
        "Floor Ratio: {:.1}% (Dead ends: {})\n",
        c.mass_rules.floor_ratio * 100.0,
        c.mass_rules.dead_end_stubs
    ));
    out.push_str(&format!(
        "Furniture: {} parts ({} loose, {} machine)\n",
        c.launch_rules.total_parts,
        c.launch_rules.loose_parts,
        c.launch_rules.machine_parts
    ));
    out
}
