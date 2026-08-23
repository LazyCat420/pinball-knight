//! Open-Space Census — Analyzes spatial openness, barren distance fields, and density statistics across archetypes.
//!
//! PORTS: `dev/open-space-census.ts`

use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq)]
pub struct FloorCensusRow {
    pub level: u32,
    pub seed: u64,
    pub archetype: String,
    pub modifier: String,
    pub walkable: usize,
    pub parts: usize,
    pub parts_per_1k: f64,
    pub worst_barren: f64,
    pub dead_share: f64,
    pub open_dead_share: f64,
    pub open_share: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ArchetypeCensusRoll {
    pub floors: usize,
    pub worst_barren_mean: f64,
    pub worst_barren_p95: f64,
    pub worst_barren_max: f64,
    pub open_dead_share_mean: f64,
    pub dead_share_mean: f64,
    pub parts_per_1k_mean: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CensusReport {
    pub r_dead: f64,
    pub floors: usize,
    pub overall: ArchetypeCensusRoll,
    pub by_archetype: HashMap<String, ArchetypeCensusRoll>,
    pub worst_floor: Option<FloorCensusRow>,
}

/// Aggregates statistical metrics (mean, p95, max) over a slice of floor census rows.
pub fn compute_roll(rows: &[&FloorCensusRow]) -> ArchetypeCensusRoll {
    if rows.is_empty() {
        return ArchetypeCensusRoll {
            floors: 0,
            worst_barren_mean: 0.0,
            worst_barren_p95: 0.0,
            worst_barren_max: 0.0,
            open_dead_share_mean: 0.0,
            dead_share_mean: 0.0,
            parts_per_1k_mean: 0.0,
        };
    }

    let n = rows.len() as f64;
    let mut barren_vals: Vec<f64> = rows.iter().map(|r| r.worst_barren).collect();
    barren_vals.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let worst_barren_mean = barren_vals.iter().sum::<f64>() / n;
    let p95_idx = ((barren_vals.len() as f64 * 0.95).floor() as usize).min(barren_vals.len() - 1);
    let worst_barren_p95 = barren_vals[p95_idx];
    let worst_barren_max = *barren_vals.last().unwrap_or(&0.0);

    let open_dead_share_mean = rows.iter().map(|r| r.open_dead_share).sum::<f64>() / n;
    let dead_share_mean = rows.iter().map(|r| r.dead_share).sum::<f64>() / n;
    let parts_per_1k_mean = rows.iter().map(|r| r.parts_per_1k).sum::<f64>() / n;

    ArchetypeCensusRoll {
        floors: rows.len(),
        worst_barren_mean,
        worst_barren_p95,
        worst_barren_max,
        open_dead_share_mean,
        dead_share_mean,
        parts_per_1k_mean,
    }
}

/// Runs full census rollup across all floors and grouped by archetype.
pub fn run_open_space_census(rows: &[FloorCensusRow], r_dead: f64) -> CensusReport {
    let row_refs: Vec<&FloorCensusRow> = rows.iter().collect();
    let overall = compute_roll(&row_refs);

    let mut by_arch_map: HashMap<String, Vec<&FloorCensusRow>> = HashMap::new();
    for row in rows {
        by_arch_map
            .entry(row.archetype.clone())
            .or_default()
            .push(row);
    }

    let mut by_archetype = HashMap::new();
    for (arch, arch_rows) in by_arch_map {
        by_archetype.insert(arch, compute_roll(&arch_rows));
    }

    let worst_floor = rows
        .iter()
        .max_by(|a, b| {
            a.open_dead_share
                .partial_cmp(&b.open_dead_share)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .cloned();

    CensusReport {
        r_dead,
        floors: rows.len(),
        overall,
        by_archetype,
        worst_floor,
    }
}
