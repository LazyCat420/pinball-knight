//! Floor navigation metrics — topological depth, critical path, and dead-end analysis.
//!
//! PORTS-PARTIAL: `maze/floor-metrics.ts` - NOT a finished port - 67 rust code lines against 256 legacy (26%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use crate::flow_field::bfs_distances;
use crate::grid::{at, idx, Grid, T_FLOOR};

#[derive(Debug, Clone, PartialEq)]
pub struct FloorConstraints {
    pub min_reach_share: f64,
    pub min_region_reach_share: f64,
    pub min_path_span: f64,
    pub max_directness: f64,
    pub max_dead_ends_per_1k: f64,
    pub min_open_share: f64,
    pub max_open_share: f64,
    pub min_choice_share: f64,
}

pub const DEFAULT_CONSTRAINTS: FloorConstraints = FloorConstraints {
    min_reach_share: 1.0,
    min_region_reach_share: 1.0,
    min_path_span: 0.2,
    max_directness: 0.85,
    max_dead_ends_per_1k: 2.5,
    min_open_share: 0.35,
    max_open_share: 0.8,
    min_choice_share: 0.2,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FloorMetrics {
    pub total_floor_tiles: usize,
    pub reachable_tiles: usize,
    pub max_depth: i32,
    pub critical_path_length: i32,
    pub dead_ends: usize,
}

/// Analyzes navigational complexity of a generated floor layout.
pub fn analyze_floor_metrics(g: &Grid, start: (i32, i32), exit: (i32, i32)) -> FloorMetrics {
    let mut total_floor_tiles = 0;
    for j in 0..g.h {
        for i in 0..g.w {
            if at(g, i, j) == T_FLOOR {
                total_floor_tiles += 1;
            }
        }
    }

    let dists = bfs_distances(g, start.0, start.1);
    let mut reachable_tiles = 0;
    let mut max_depth = 0;

    for &d in &dists {
        if d >= 0 {
            reachable_tiles += 1;
            if d > max_depth {
                max_depth = d;
            }
        }
    }

    let critical_path_length = dists[idx(g, exit.0, exit.1)];

    let mut dead_ends = 0;
    for j in 1..(g.h - 1) {
        for i in 1..(g.w - 1) {
            if at(g, i, j) != T_FLOOR || dists[idx(g, i, j)] < 0 {
                continue;
            }

            let mut floor_neighbors = 0;
            if at(g, i + 1, j) == T_FLOOR {
                floor_neighbors += 1;
            }
            if at(g, i - 1, j) == T_FLOOR {
                floor_neighbors += 1;
            }
            if at(g, i, j + 1) == T_FLOOR {
                floor_neighbors += 1;
            }
            if at(g, i, j - 1) == T_FLOOR {
                floor_neighbors += 1;
            }

            if floor_neighbors == 1 && (i, j) != start && (i, j) != exit {
                dead_ends += 1;
            }
        }
    }

    FloorMetrics {
        total_floor_tiles,
        reachable_tiles,
        max_depth,
        critical_path_length,
        dead_ends,
    }
}
