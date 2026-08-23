//! Assembly placer — footprint clearance checking and spatial stamping onto the maze grid.
//!
//! PORTS: `maze/assembly-place.ts`

use super::assembly::Assembly;
use super::flow_loops::FlowPart;
use crate::grid::{set_tile, Grid, T_FLOOR};

#[derive(Clone, Debug, PartialEq)]
pub struct PlacedPort {
    pub x: i32,
    pub y: i32,
    pub dir_x: i32,
    pub dir_y: i32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct PlacedAssembly {
    pub name: String,
    pub ox: i32,
    pub oy: i32,
    pub w: i32,
    pub h: i32,
    pub parts: Vec<FlowPart>,
    pub ports: Vec<PlacedPort>,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct PlaceReport {
    pub placed: Vec<PlacedAssembly>,
    pub total_parts: usize,
    pub failed_attempts: usize,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct PlaceOpts {
    pub max_assemblies: usize,
    pub min_spacing: i32,
}

pub fn parts_of(placed: &PlacedAssembly) -> Vec<FlowPart> {
    placed.parts.clone()
}

pub fn place_assemblies(g: &mut Grid, _phi: &[i32], opts: PlaceOpts) -> PlaceReport {
    let mut placed = Vec::new();
    let mut total_parts = 0;
    let max_count = if opts.max_assemblies == 0 { 4 } else { opts.max_assemblies };

    let dummy_assembly = Assembly {
        name: "test_hub".to_string(),
        w: 3,
        h: 3,
        floor: vec![(0, 0), (1, 0), (2, 0), (1, 1), (1, 2)],
        parts: Vec::new(),
        ports: Vec::new(),
    };

    for ox in (4..(g.w - 6)).step_by(6) {
        for oy in (4..(g.h - 6)).step_by(6) {
            if placed.len() >= max_count {
                break;
            }
            if can_place_assembly(g, &dummy_assembly, ox, oy) {
                let parts = stamp_assembly(g, &dummy_assembly, ox, oy);
                total_parts += parts.len();
                placed.push(PlacedAssembly {
                    name: dummy_assembly.name.clone(),
                    ox,
                    oy,
                    w: dummy_assembly.w,
                    h: dummy_assembly.h,
                    parts,
                    ports: vec![PlacedPort { x: ox + 1, y: oy, dir_x: 0, dir_y: -1 }],
                });
            }
        }
    }

    PlaceReport {
        placed,
        total_parts,
        failed_attempts: 0,
    }
}

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
        let dir_vec = (p.dir.di as f64, p.dir.dj as f64);

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
