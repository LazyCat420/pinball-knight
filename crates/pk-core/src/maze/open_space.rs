//! Open space metrics — geodesic barrenness fields and unfurnished dead plaza analysis.
//!
//! PORTS-PARTIAL: `maze/open-space.ts` - NOT a finished port - 1 of 9 exported names carried over (11%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use std::cmp::Reverse;
use std::collections::BinaryHeap;

use crate::grid::{idx, is_walkable, Grid};

pub const ORTH: i32 = 3;
pub const DIAG: i32 = 4;

/// Computes geodesic distance across walkable floor tiles to the nearest interactive part.
/// Returns a field where distance is measured in x3 chamfer units (3 for ortho, 4 for diag).
pub fn barren_field(g: &Grid, parts: &[(i32, i32)]) -> Vec<i32> {
    let n = (g.w * g.h) as usize;
    let mut dist = vec![-1_i32; n];
    if parts.is_empty() {
        return dist;
    }

    // Min-heap for Dijkstra: (cost, x, y)
    let mut heap = BinaryHeap::new();

    for &(px, py) in parts {
        if is_walkable(g, px, py) {
            let k = idx(g, px, py);
            dist[k] = 0;
            heap.push(Reverse((0, px, py)));
        }
    }

    while let Some(Reverse((d, cx, cy))) = heap.pop() {
        let k = idx(g, cx, cy);
        if d > dist[k] && dist[k] >= 0 {
            continue;
        }

        // 8-neighborhood expansion
        for dy in -1..=1 {
            for dx in -1..=1 {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let nx = cx + dx;
                let ny = cy + dy;
                if !is_walkable(g, nx, ny) {
                    continue;
                }

                let step_cost = if dx == 0 || dy == 0 { ORTH } else { DIAG };
                let nd = d + step_cost;
                let nk = idx(g, nx, ny);

                if dist[nk] < 0 || nd < dist[nk] {
                    dist[nk] = nd;
                    heap.push(Reverse((nd, nx, ny)));
                }
            }
        }
    }

    dist
}

/// Measures the fraction of walkable floor tiles that are both open (high clearance)
/// and barren (far from any placed pinball part or furniture).
pub fn open_dead_share(g: &Grid, clearance: &[i32], barren: &[i32]) -> f64 {
    let mut walkable_count = 0;
    let mut open_dead_count = 0;

    for j in 0..g.h {
        for i in 0..g.w {
            if !is_walkable(g, i, j) {
                continue;
            }
            walkable_count += 1;
            let k = idx(g, i, j);

            let clr = clearance.get(k).copied().unwrap_or(0);
            let bar = barren.get(k).copied().unwrap_or(-1);

            // Clearance >= 6 (at least 2 tiles from nearest wall in x3 units)
            // Barren >= 15 (at least 5 tiles from nearest part in x3 units)
            if clr >= 6 && bar >= 15 {
                open_dead_count += 1;
            }
        }
    }

    if walkable_count == 0 {
        0.0
    } else {
        open_dead_count as f64 / walkable_count as f64
    }
}
