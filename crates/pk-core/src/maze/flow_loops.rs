//! Flow loops — track circuit raycasts and directional flow part trajectories.
//!
//! PORTS: `maze/flow-loops.ts`

use crate::grid::{is_walkable, Grid};

#[derive(Debug, Clone, PartialEq)]
pub struct FlowPart {
    pub kind: String,
    pub pos: (i32, i32),
    pub dir: (f64, f64),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FlowLoopSummary {
    pub total_parts: usize,
    pub open_exits: usize,
    pub blocked_exits: usize,
}

/// Traces a forward straight line ray from an interactive part along its heading.
/// Stops when encountering a solid obstacle or reaching max_dist.
pub fn exit_ray(g: &Grid, pos: (i32, i32), dir: (f64, f64), max_dist: usize) -> Vec<(i32, i32)> {
    let mut ray = Vec::new();
    let step_x = dir.0.round() as i32;
    let step_z = dir.1.round() as i32;

    if step_x == 0 && step_z == 0 {
        return ray;
    }

    let mut cx = pos.0;
    let mut cz = pos.1;

    for _ in 0..max_dist {
        cx += step_x;
        cz += step_z;
        if !is_walkable(g, cx, cz) {
            break;
        }
        ray.push((cx, cz));
    }

    ray
}

/// Analyzes all placed flow parts on a floor and reports exit clearance statistics.
pub fn summarize_flow_loops(g: &Grid, parts: &[FlowPart], min_runway: usize) -> FlowLoopSummary {
    let mut open_exits = 0;
    let mut blocked_exits = 0;

    for part in parts {
        let ray = exit_ray(g, part.pos, part.dir, min_runway);
        if ray.len() >= min_runway {
            open_exits += 1;
        } else {
            blocked_exits += 1;
        }
    }

    FlowLoopSummary {
        total_parts: parts.len(),
        open_exits,
        blocked_exits,
    }
}
