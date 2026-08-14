//! Piece rules — correctness validation for arc feature backing, launcher runways, and socket contracts.
//!
//! PORTS: `maze/piece-rules.ts`

use super::arc_sweeps::{has_clear_rail_runway, rail_exit, RAIL_MIN_RUNWAY};
use super::flow_loops::{exit_ray, FlowPart};
use crate::grid::{at, idx, Grid, T_FLOOR, T_WALL};
use crate::tile_shape::{is_shaped, shape_backing};

pub const MIN_PART_RUNWAY: usize = 3;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PieceViolationKind {
    UnbackedArc,
    BlockedLauncherRunway,
    BlockedRailExit,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PieceViolation {
    pub kind: PieceViolationKind,
    pub tile: (i32, i32),
    pub description: String,
}

/// Validates all placed maze pieces and parts against design invariants.
pub fn validate_piece_rules(g: &Grid, parts: &[FlowPart]) -> Vec<PieceViolation> {
    let mut violations = Vec::new();

    // 1. Validate Arc Features: every shaped wall tile must have solid backing
    for j in 1..(g.h - 1) {
        for i in 1..(g.w - 1) {
            let shape = g.shapes[idx(g, i, j)];
            if at(g, i, j) == T_WALL && is_shaped(shape) {
                if let Some(backings) = shape_backing(shape) {
                    for b in backings {
                        let bx = i + b.x.round() as i32;
                        let by = j + b.z.round() as i32;
                        if at(g, bx, by) == T_FLOOR {
                            violations.push(PieceViolation {
                                kind: PieceViolationKind::UnbackedArc,
                                tile: (i, j),
                                description: format!(
                                    "Shaped wall at ({i}, {j}) is missing solid backing at ({bx}, {by})"
                                ),
                            });
                        }
                    }
                }
            }
        }
    }

    // 2. Validate Rail Exits for curved arcs
    for feature in &g.arcs {
        let (ex, ez, dx, dz) = rail_exit(feature);
        if !has_clear_rail_runway(g, ex, ez, dx, dz, RAIL_MIN_RUNWAY) {
            violations.push(PieceViolation {
                kind: PieceViolationKind::BlockedRailExit,
                tile: (ex, ez),
                description: format!(
                    "Arc rail exit at ({ex}, {ez}) is blocked ahead along heading ({dx:.2}, {dz:.2})"
                ),
            });
        }
    }

    // 3. Validate Interactive Parts forward runways
    for part in parts {
        if part.kind == "launcher" || part.kind == "boostcorner" || part.kind == "plunger" {
            let ray = exit_ray(g, part.pos, part.dir, MIN_PART_RUNWAY);
            if ray.len() < MIN_PART_RUNWAY {
                violations.push(PieceViolation {
                    kind: PieceViolationKind::BlockedLauncherRunway,
                    tile: part.pos,
                    description: format!(
                        "Part '{}' at ({}, {}) has insufficient forward runway ({} of {} clear)",
                        part.kind,
                        part.pos.0,
                        part.pos.1,
                        ray.len(),
                        MIN_PART_RUNWAY
                    ),
                });
            }
        }
    }

    violations
}
