//! Assembly validation — the real-table feel rules, as checkable predicates.
//!
//! Port of `legacy/src/game/pinball-knight/maze/assembly-check.ts` (220 lines).
//!
//! PORTS: `maze/assembly-check.ts`

use std::collections::{HashMap, HashSet};

use crate::maze::assembly::{
    is_two_leg_kind, Assembly, PortFlow, PortWay,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssemblyProblem {
    pub machine: String,
    pub code: &'static str,
    pub detail: String,
}

fn key(ci: i32, cj: i32) -> (i32, i32) {
    (ci, cj)
}

fn floor_set(a: &Assembly) -> HashSet<(i32, i32)> {
    a.floor.iter().copied().collect()
}

fn check_on_floor(a: &Assembly, out: &mut Vec<AssemblyProblem>) {
    let floor = floor_set(a);
    for p in &a.parts {
        if !floor.contains(&key(p.ci, p.cj)) {
            out.push(AssemblyProblem {
                machine: a.name.clone(),
                code: "part-off-floor",
                detail: format!("{} at {},{} is not on carved floor", p.kind, p.ci, p.cj),
            });
        }
    }
    for p in &a.ports {
        if !floor.contains(&key(p.ci, p.cj)) {
            out.push(AssemblyProblem {
                machine: a.name.clone(),
                code: "port-off-floor",
                detail: format!(
                    "port {} at {},{} is not on carved floor",
                    p.tag.as_deref().unwrap_or("?"),
                    p.ci,
                    p.cj
                ),
            });
        }
    }
}

fn check_overlap(a: &Assembly, out: &mut Vec<AssemblyProblem>) {
    let mut seen = HashSet::new();
    for p in &a.parts {
        let k = key(p.ci, p.cj);
        if !seen.insert(k) {
            out.push(AssemblyProblem {
                machine: a.name.clone(),
                code: "part-overlap",
                detail: format!("two parts on cell {},{}", k.0, k.1),
            });
        }
    }
}

fn check_has_entry(a: &Assembly, out: &mut Vec<AssemblyProblem>) {
    if !a.ports.iter().any(|p| p.way != PortWay::Out) {
        out.push(AssemblyProblem {
            machine: a.name.clone(),
            code: "no-entry",
            detail: "no in/both port — nothing can reach it".to_string(),
        });
    }
}

fn check_exit_lines(a: &Assembly, out: &mut Vec<AssemblyProblem>) {
    let mut rebounders = HashMap::new();
    for p in &a.parts {
        if p.role.as_deref() == Some("rebound") {
            rebounders.insert(key(p.ci, p.cj), p);
        }
    }
    if rebounders.is_empty() {
        return;
    }

    for port in &a.ports {
        if port.way == PortWay::In || port.flow == PortFlow::Impact {
            continue;
        }
        let mut ci = port.ci + port.dir.di;
        let mut cj = port.cj + port.dir.dj;
        while ci >= 0 && cj >= 0 && ci < a.w && cj < a.h {
            if let Some(hit) = rebounders.get(&key(ci, cj)) {
                out.push(AssemblyProblem {
                    machine: a.name.clone(),
                    code: "exit-into-rebounder",
                    detail: format!(
                        "exit {} fires into {} at {},{}",
                        port.tag.as_deref().unwrap_or("?"),
                        hit.kind,
                        ci,
                        cj
                    ),
                });
                break;
            }
            ci += port.dir.di;
            cj += port.dir.dj;
        }
    }
}

fn check_drives_go_somewhere(a: &Assembly, out: &mut Vec<AssemblyProblem>) {
    let floor = floor_set(a);
    for p in &a.parts {
        if p.role.as_deref() != Some("drive") {
            continue;
        }
        if p.dir.di == 0 && p.dir.dj == 0 {
            continue;
        }
        let ni = p.ci + p.dir.di;
        let nj = p.cj + p.dir.dj;
        let inside_footprint = ni >= 0 && nj >= 0 && ni < a.w && nj < a.h;
        if !inside_footprint {
            continue;
        }
        if !floor.contains(&key(ni, nj)) {
            out.push(AssemblyProblem {
                machine: a.name.clone(),
                code: "dead-end-drive",
                detail: format!(
                    "{} at {},{} fires into uncarved cell {},{}",
                    p.kind, p.ci, p.cj, ni, nj
                ),
            });
        }
    }
}

fn check_corner_legs(a: &Assembly, out: &mut Vec<AssemblyProblem>) {
    for p in &a.parts {
        if !is_two_leg_kind(&p.kind) {
            if p.dir2.is_some() {
                out.push(AssemblyProblem {
                    machine: a.name.clone(),
                    code: "corner-missing-leg",
                    detail: format!(
                        "{} at {},{} has a dir2 but is not a corner kind — it will be ignored",
                        p.kind, p.ci, p.cj
                    ),
                });
            }
            continue;
        }
        let d2 = p.dir2;
        if d2.is_none() || (d2.unwrap().di == 0 && d2.unwrap().dj == 0) {
            out.push(AssemblyProblem {
                machine: a.name.clone(),
                code: "corner-missing-leg",
                detail: format!(
                    "{} at {},{} has no dir2 — it throws along a ZERO VECTOR and eats the player",
                    p.kind, p.ci, p.cj
                ),
            });
            continue;
        }
        let d2 = d2.unwrap();
        if p.dir.di * d2.di + p.dir.dj * d2.dj != 0 {
            out.push(AssemblyProblem {
                machine: a.name.clone(),
                code: "corner-missing-leg",
                detail: format!(
                    "{} at {},{} has legs ({},{}) and ({},{}) — a corner's legs must be perpendicular",
                    p.kind, p.ci, p.cj, p.dir.di, p.dir.dj, d2.di, d2.dj
                ),
            });
        }
    }
}

/// Run every rule over one machine. Empty array = the definition is sound.
pub fn check_assembly(a: &Assembly) -> Vec<AssemblyProblem> {
    let mut out = Vec::new();
    check_on_floor(a, &mut out);
    check_overlap(a, &mut out);
    check_has_entry(a, &mut out);
    check_exit_lines(a, &mut out);
    check_drives_go_somewhere(a, &mut out);
    check_corner_legs(a, &mut out);
    out
}

/// Run every rule over a whole library.
pub fn check_all(list: &[Assembly]) -> Vec<AssemblyProblem> {
    list.iter().flat_map(check_assembly).collect()
}
