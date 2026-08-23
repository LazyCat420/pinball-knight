//! Flow loops — track circuit raycasts and directional flow part trajectories.
//!
//! Port of `legacy/src/game/pinball-knight/maze/flow-loops.ts` (372 lines).
//!
//! PORTS: `maze/flow-loops.ts`

use std::collections::HashMap;

use crate::grid::{idx, is_walkable, Grid};

pub const RAY: i32 = 8;
pub const MIN_RUN: i32 = 3;
pub const UNREACHED: i32 = 999_999;

pub const CARDS: [(i32, i32); 4] = [(0, -1), (0, 1), (1, 0), (-1, 0)];

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

pub fn exit_ray(p: &FlowPart) -> (i32, i32) {
    if p.kind == "boostcorner" && (p.dir2_i.abs() + p.dir2_j.abs()) == 1 {
        (p.dir2_i, p.dir2_j)
    } else {
        (p.dir_i, p.dir_j)
    }
}

pub fn snap_cardinal(di: f64, dj: f64) -> (i32, i32) {
    if di.abs() > dj.abs() {
        (if di > 0.0 { 1 } else { -1 }, 0)
    } else {
        (0, if dj > 0.0 { 1 } else { -1 })
    }
}

fn ray_cardinal(p: &FlowPart) -> (i32, i32) {
    exit_ray(p)
}

fn open(g: &Grid, i: i32, j: i32) -> bool {
    is_walkable(g, i, j)
}

fn phi_at(g: &Grid, phi: &[i32], i: i32, j: i32) -> i32 {
    if i < 0 || j < 0 || i >= g.w || j >= g.h {
        return UNREACHED;
    }
    let k = idx(g, i, j);
    if k < phi.len() {
        phi[k]
    } else {
        UNREACHED
    }
}

fn is_downhill(g: &Grid, phi: &[i32], i: i32, j: i32, di: i32, dj: i32) -> bool {
    let cur = phi_at(g, phi, i, j);
    let next = phi_at(g, phi, i + di, j + dj);
    next < cur
}

fn flow_drop(g: &Grid, phi: &[i32], i: i32, j: i32, di: i32, dj: i32, max_steps: i32) -> i32 {
    let cur = phi_at(g, phi, i, j);
    if cur >= UNREACHED {
        return 0;
    }
    let mut best_drop = 0;
    for s in 1..=max_steps {
        let ni = i + di * s;
        let nj = j + dj * s;
        if !open(g, ni, nj) {
            break;
        }
        let p = phi_at(g, phi, ni, nj);
        if p < UNREACHED {
            let drop = cur - p;
            if drop > best_drop {
                best_drop = drop;
            }
        }
    }
    best_drop
}

fn runway(g: &Grid, i: i32, j: i32, di: i32, dj: i32) -> i32 {
    let mut run = 0;
    for s in 1..=RAY {
        if open(g, i + di * s, j + dj * s) {
            run += 1;
        } else {
            break;
        }
    }
    run
}

fn movable(p: &FlowPart) -> bool {
    p.kind == "booster" || p.kind == "boostcorner" || p.kind == "spring"
}

fn countable_kind(p: &FlowPart) -> Option<&'static str> {
    if p.kind == "booster" || p.kind == "boostcorner" || p.kind == "spring" {
        Some("cardinal")
    } else if p.kind == "boostcurve" {
        Some("tangent")
    } else {
        None
    }
}

fn successors(
    g: &Grid,
    parts: &[FlowPart],
    live: &[usize],
    targets: Option<&[usize]>,
) -> HashMap<usize, usize> {
    let mut by_tile = HashMap::new();
    let target_list = targets.unwrap_or(live);
    for &n in target_list {
        by_tile.insert(idx(g, parts[n].i, parts[n].j), n);
    }

    let mut next = HashMap::new();
    for &n in live {
        let p = &parts[n];
        let (di, dj) = ray_cardinal(p);
        for s in 1..=RAY {
            let ni = p.i + di * s;
            let nj = p.j + dj * s;
            if !open(g, ni, nj) {
                break;
            }
            if let Some(&hit) = by_tile.get(&idx(g, ni, nj)) {
                if hit != n {
                    next.insert(n, hit);
                    break;
                }
            }
        }
    }
    next
}

pub fn successors_of(g: &Grid, parts: &[FlowPart]) -> HashMap<usize, usize> {
    let live: Vec<usize> = parts
        .iter()
        .enumerate()
        .filter(|(_, p)| countable_kind(p).is_some())
        .map(|(n, _)| n)
        .collect();
    let targets: Vec<usize> = parts
        .iter()
        .enumerate()
        .filter(|(_, p)| !p.vault && !p.chute)
        .map(|(n, _)| n)
        .collect();
    successors(g, parts, &live, Some(&targets))
}

pub fn find_flow_cycles(g: &Grid, parts: &[FlowPart]) -> Vec<Vec<usize>> {
    let live: Vec<usize> = parts
        .iter()
        .enumerate()
        .filter(|(_, p)| movable(p))
        .map(|(n, _)| n)
        .collect();
    let next = successors(g, parts, &live, None);
    let mut colour = HashMap::new();
    let mut cycles = Vec::new();

    for &seed in &live {
        if colour.get(&seed).copied().unwrap_or(0) > 0 {
            continue;
        }
        let mut path = Vec::new();
        let mut pos = HashMap::new();
        let mut cur = Some(seed);

        while let Some(c) = cur {
            if colour.get(&c).copied().unwrap_or(0) > 0 {
                break;
            }
            colour.insert(c, 1);
            pos.insert(c, path.len());
            path.push(c);
            cur = next.get(&c).copied();
        }

        if let Some(c) = cur {
            if colour.get(&c).copied() == Some(1) {
                if let Some(&start_idx) = pos.get(&c) {
                    cycles.push(path[start_idx..].to_vec());
                }
            }
        }

        for &n in &path {
            colour.insert(n, 2);
        }
    }

    cycles
}

pub fn break_flow_loops(g: &Grid, phi: &[i32], parts: &mut Vec<FlowPart>) -> usize {
    let mut broken = 0;
    for _ in 0..24 {
        let cycles = find_flow_cycles(g, parts);
        if cycles.is_empty() {
            break;
        }
        let mut changed = false;
        for cycle in cycles {
            let mut victim = cycle[0];
            let mut worst = i32::MAX;

            for &n in &cycle {
                let p = &parts[n];
                let (di, dj) = exit_ray(p);
                let drop = flow_drop(g, phi, p.i, p.j, di, dj, RAY);
                if drop < worst {
                    worst = drop;
                    victim = n;
                }
            }

            let p = &mut parts[victim];

            // 1) Re-aim downhill
            let mut best: Option<(i32, i32)> = None;
            let mut best_drop = 0;
            for c in CARDS {
                if c.0 == p.dir_i && c.1 == p.dir_j {
                    continue;
                }
                if runway(g, p.i, p.j, c.0, c.1) < MIN_RUN {
                    continue;
                }
                if !is_downhill(g, phi, p.i, p.j, c.0, c.1) {
                    continue;
                }
                let drop = flow_drop(g, phi, p.i, p.j, c.0, c.1, RAY);
                if drop > best_drop {
                    best_drop = drop;
                    best = Some(c);
                }
            }

            if let Some(b) = best {
                p.dir_i = b.0;
                p.dir_j = b.1;
                if p.kind == "boostcorner" {
                    p.kind = "booster".to_string();
                    p.dir2_i = 0;
                    p.dir2_j = 0;
                }
                broken += 1;
                changed = true;
                continue;
            }

            // 2) Demote where a bumper legitimately lives
            let legs = CARDS.iter().filter(|c| open(g, p.i + c.0, p.j + c.1)).count();
            if legs >= 3 {
                p.kind = "bumper".to_string();
                p.dir_i = 0;
                p.dir_j = 0;
                p.dir2_i = 0;
                p.dir2_j = 0;
                broken += 1;
                changed = true;
                continue;
            }

            // 3) Remove
            parts.remove(victim);
            broken += 1;
            changed = true;
        }

        if !changed {
            break;
        }
    }

    broken
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct UphillCount {
    pub uphill: usize,
    pub total: usize,
}

pub fn count_uphill(g: &Grid, phi: &[i32], parts: &[FlowPart]) -> UphillCount {
    let mut uphill = 0;
    let mut total = 0;

    for p in parts {
        let countable = countable_kind(p);
        if countable.is_none() {
            continue;
        }
        if phi_at(g, phi, p.i, p.j) >= UNREACHED {
            continue;
        }
        total += 1;
        let (di, dj) = exit_ray(p);
        if !is_downhill(g, phi, p.i, p.j, di, dj) {
            uphill += 1;
        }
    }

    UphillCount { uphill, total }
}
