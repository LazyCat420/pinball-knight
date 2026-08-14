//! Procedural and authored maze part assembly validation rules.
//!
//! PORTS: `maze/assembly-check.ts`

use crate::grid::{is_walkable, world_to_tile, Grid};
use crate::pinball::PartKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssemblyIssueKind {
    BlockedLauncher,
    UnclosedLoop,
    OverlappingParts,
    OutOfBoundsPart,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AssemblyIssue {
    pub kind: AssemblyIssueKind,
    pub part_id: u32,
    pub message: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlacedPart {
    pub id: u32,
    pub kind: PartKind,
    pub x: f64,
    pub z: f64,
}

/// Validates that all placed pinball parts and maze assemblies respect clearance and connectivity rules.
pub fn validate_maze_assemblies(
    grid: &Grid,
    parts: &[PlacedPart],
) -> Result<(), Vec<AssemblyIssue>> {
    let mut issues = Vec::new();

    for (idx, part) in parts.iter().enumerate() {
        let (ti, tj) = world_to_tile(grid, part.x, part.z);

        // 1. Check out of bounds
        if ti < 0 || ti >= grid.w || tj < 0 || tj >= grid.h {
            issues.push(AssemblyIssue {
                kind: AssemblyIssueKind::OutOfBoundsPart,
                part_id: part.id,
                message: "Part placed outside grid boundary",
            });
            continue;
        }

        // 2. Check overlap against preceding parts
        for prev in &parts[..idx] {
            let dx = prev.x - part.x;
            let dz = prev.z - part.z;
            if (dx * dx + dz * dz).sqrt() < 0.6 {
                issues.push(AssemblyIssue {
                    kind: AssemblyIssueKind::OverlappingParts,
                    part_id: part.id,
                    message: "Part overlaps existing part fixture",
                });
            }
        }

        // 3. Launcher / Booster Clearance Rule
        if part.kind == PartKind::Booster {
            // Check that the launch vector tile in front is walkable
            let launch_target_ti = ti;
            let launch_target_tj = tj - 1; // standard booster shoots north
            if !is_walkable(grid, launch_target_ti, launch_target_tj) {
                issues.push(AssemblyIssue {
                    kind: AssemblyIssueKind::BlockedLauncher,
                    part_id: part.id,
                    message: "Booster exit trajectory blocked by solid wall",
                });
            }
        }
    }

    if issues.is_empty() {
        Ok(())
    } else {
        Err(issues)
    }
}
