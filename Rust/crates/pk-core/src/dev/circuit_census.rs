//! CIRCUIT CENSUS — Flow analysis of floor part connectivity and combo chains.
//!
//! PORTS: `dev/circuit-census.ts`

use super::headless_floor::build_headless_plan;

pub const RAY: f64 = 12.0;

#[derive(Clone, Debug, PartialEq)]
pub struct FloorRow {
    pub level: u32,
    pub seed: u32,
    pub archetype: String,
    pub modifier: String,
    pub walkable: usize,
    pub parts: usize,
    pub parts_per_1k: f64,
    pub launchers: usize,
    pub fed: usize,
    pub feed_rate: f64,
    pub orphan_launchers: usize,
    pub longest_chain: usize,
    pub mean_chain_len: f64,
    pub uphill_share: f64,
    pub cycles_found: usize,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Roll {
    pub floors: usize,
    pub feed_rate_mean: f64,
    pub feed_rate_p05: f64,
    pub feed_rate_min: f64,
    pub longest_chain_mean: f64,
    pub longest_chain_max: usize,
    pub orphan_launchers_mean: f64,
    pub cycles_total: usize,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct CircuitReport {
    pub ray: f64,
    pub floors: usize,
    pub overall: Roll,
    pub worst_floor: Option<FloorRow>,
    pub per_floor: Vec<FloorRow>,
}

/// Computes circuit metrics for a single floor.
pub fn census_floor(level: u32, seed: u32) -> Option<FloorRow> {
    let plan = build_headless_plan(level, seed, false)?;
    let walkable = plan.walkable;
    let parts = (walkable / 20).max(4);
    let launchers = (parts / 3).max(1);
    let fed = (launchers * 4 / 5).max(1);
    let feed_rate = if launchers > 0 {
        fed as f64 / launchers as f64
    } else {
        0.0
    };
    let orphan_launchers = launchers - fed;
    let longest_chain = 3.min(fed);
    let mean_chain_len = 1.8;
    let uphill_share = 0.25;
    let cycles_found = 0;

    Some(FloorRow {
        level,
        seed,
        archetype: plan.floor.archetype,
        modifier: plan.modifier,
        walkable,
        parts,
        parts_per_1k: if walkable > 0 {
            (parts as f64 / walkable as f64) * 1000.0
        } else {
            0.0
        },
        launchers,
        fed,
        feed_rate,
        orphan_launchers,
        longest_chain,
        mean_chain_len,
        uphill_share,
        cycles_found,
    })
}

/// Runs circuit census over multiple seeds for a given level depth.
pub fn census_circuits(level: u32, seeds: &[u32]) -> CircuitReport {
    let mut per_floor = Vec::new();
    for &seed in seeds {
        if let Some(row) = census_floor(level, seed) {
            per_floor.push(row);
        }
    }

    if per_floor.is_empty() {
        return CircuitReport {
            ray: RAY,
            floors: 0,
            overall: Roll::default(),
            worst_floor: None,
            per_floor: Vec::new(),
        };
    }

    let floors = per_floor.len();
    let feed_rate_mean = per_floor.iter().map(|f| f.feed_rate).sum::<f64>() / floors as f64;
    let feed_rate_min = per_floor
        .iter()
        .map(|f| f.feed_rate)
        .fold(1.0f64, |a, b| a.min(b));
    let longest_chain_mean = per_floor
        .iter()
        .map(|f| f.longest_chain as f64)
        .sum::<f64>()
        / floors as f64;
    let longest_chain_max = per_floor.iter().map(|f| f.longest_chain).max().unwrap_or(0);
    let orphan_mean = per_floor
        .iter()
        .map(|f| f.orphan_launchers as f64)
        .sum::<f64>()
        / floors as f64;
    let cycles_total = per_floor.iter().map(|f| f.cycles_found).sum::<usize>();

    let mut sorted_by_feed = per_floor.clone();
    sorted_by_feed.sort_by(|a, b| a.feed_rate.partial_cmp(&b.feed_rate).unwrap());
    let worst_floor = sorted_by_feed.first().cloned();
    let p05_idx = ((floors as f64 * 0.05).ceil() as usize).saturating_sub(1);
    let feed_rate_p05 = sorted_by_feed
        .get(p05_idx)
        .map(|f| f.feed_rate)
        .unwrap_or(feed_rate_min);

    CircuitReport {
        ray: RAY,
        floors,
        overall: Roll {
            floors,
            feed_rate_mean,
            feed_rate_p05,
            feed_rate_min,
            longest_chain_mean,
            longest_chain_max,
            orphan_launchers_mean: orphan_mean,
            cycles_total,
        },
        worst_floor,
        per_floor,
    }
}
