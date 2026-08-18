//! Flow loops — track circuit raycasts and directional flow part trajectories.
//!
//! Port of `legacy/src/game/pinball-knight/maze/flow-loops.ts`.
//!
//! PORTS: `maze/flow-loops.ts`

use crate::grid::{is_walkable, Grid};

#[derive(Debug, Clone, PartialEq)]
pub struct FlowPart {
    pub i: i32,
    pub j: i32,
    pub kind: String,
    pub dir_i: i32,
    pub dir_j: i32,
    pub dir2_i: i32,
    pub dir2_j: i32,
    pub spine: bool,
    pub chain: bool,
    pub chute: bool,
    pub vault: bool,
    pub pos: (i32, i32),
    pub dir: (f64, f64),
}

impl Default for FlowPart {
    fn default() -> Self {
        Self {
            i: 0,
            j: 0,
            kind: String::new(),
            dir_i: 0,
            dir_j: 0,
            dir2_i: 0,
            dir2_j: 0,
            spine: false,
            chain: false,
            chute: false,
            vault: false,
            pos: (0, 0),
            dir: (0.0, 0.0),
        }
    }
}

impl FlowPart {
    pub fn new(i: i32, j: i32, kind: impl Into<String>, dir_i: i32, dir_j: i32) -> Self {
        let kind_str = kind.into();
        Self {
            i,
            j,
            kind: kind_str,
            dir_i,
            dir_j,
            dir2_i: 0,
            dir2_j: 0,
            spine: false,
            chain: false,
            chute: false,
            vault: false,
            pos: (i, j),
            dir: (dir_i as f64, dir_j as f64),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FlowLoopSummary {
    pub total_parts: usize,
    pub open_exits: usize,
    pub blocked_exits: usize,
}

/// Which way a part actually THROWS you: for boostcorner uses dir2, otherwise dir.
pub fn exit_ray(p: &FlowPart) -> (i32, i32) {
    if p.kind == "boostcorner" && (p.dir2_i.abs() + p.dir2_j.abs() == 1) {
        (p.dir2_i, p.dir2_j)
    } else if p.dir_i != 0 || p.dir_j != 0 {
        (p.dir_i, p.dir_j)
    } else {
        (p.dir.0.round() as i32, p.dir.1.round() as i32)
    }
}

/// Traces a forward straight line ray from an interactive part along its heading.
/// Stops when encountering a solid obstacle or reaching max_dist.
pub fn trace_exit_ray(g: &Grid, pos: (i32, i32), dir: (f64, f64), max_dist: usize) -> Vec<(i32, i32)> {
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
        let (di, dj) = exit_ray(part);
        let ray = trace_exit_ray(g, (part.i, part.j), (di as f64, dj as f64), min_runway);
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
