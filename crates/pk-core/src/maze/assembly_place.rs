//! Assembly placer — footprint clearance checking and spatial stamping onto the maze grid.
//!
//! PORTS-PARTIAL: `maze/assembly-place.ts` - NOT a finished port - 37 rust code lines against 201 legacy (18%). Downgraded by the 2026-08-16 ledger audit; see docs/src/status/incidents.md

use super::assembly::Assembly;
use super::flow_loops::FlowPart;
use crate::grid::{set_tile, Grid, T_FLOOR};

/// Checks if an assembly footprint fits cleanly on the grid without clipping outer borders.
pub fn can_place_assembly(g: &Grid, a: &Assembly, ox: i32, oy: i32) -> bool {
    if ox < 1 || oy < 1 || ox + a.w >= g.w - 1 || oy + a.h >= g.h - 1 {
        return false;
    }

    for &(fi, fj) in &a.floor {
        let x = ox + fi;
        let y = oy + fj;
        if x < 1 || y < 1 || x >= g.w - 1 || y >= g.h - 1 {
            return false;
        }
    }

    true
}

/// Carves the floor footprint for an assembly and returns placed FlowParts.
pub fn stamp_assembly(g: &mut Grid, a: &Assembly, ox: i32, oy: i32) -> Vec<FlowPart> {
    // 1. Carve walkable floor footprint
    for &(fi, fj) in &a.floor {
        set_tile(g, ox + fi, oy + fj, T_FLOOR);
    }

    // 2. Instantiate and position all constituent parts
    let mut placed = Vec::with_capacity(a.parts.len());
    for p in &a.parts {
        let px = ox + p.ci;
        let py = oy + p.cj;
        let dir_vec = if let Some(d) = p.dir {
            (d.di as f64, d.dj as f64)
        } else {
            (0.0, 0.0)
        };

        placed.push(FlowPart {
            i: px,
            j: py,
            kind: p.kind.clone(),
            dir_i: dir_vec.0.round() as i32,
            dir_j: dir_vec.1.round() as i32,
            pos: (px, py),
            dir: dir_vec,
            ..Default::default()
        });
    }

    placed
}
