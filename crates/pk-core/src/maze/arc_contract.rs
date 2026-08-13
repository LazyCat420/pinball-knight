//! THE ARC CONTRACT — which curved wall pieces may sit next to which.
//!
//! PORTS: `maze/arc-contract.ts`

use std::f64::consts::{PI, TAU};

use crate::grid::{at, idx, is_walkable, set_shape, Grid, T_WALL};
use crate::tile_shape::{ArcFeature, KickBand, LaneBand, SHAPE_ARC, SHAPE_FULL};

pub const TANGENT_TOL: f64 = (25.0 * PI) / 180.0;
pub const SURFACE_TOL: f64 = 0.75;
pub const SURFACE_NEAR: f64 = 1.2;
pub const MIN_ARC_LEN: f64 = 1.6;
pub const MIN_ARC_TILES: usize = 3;

const SAMPLES_PER_TILE: usize = 3;
const BACK_PROBE: f64 = 0.6;

pub fn surface_gap(f: &ArcFeature, x: f64, z: f64) -> f64 {
    (x - f.cx).hypot(z - f.cz) - f.r
}

pub fn tangent_angle(f: &ArcFeature, x: f64, z: f64) -> f64 {
    (z - f.cz).atan2(x - f.cx) + PI / 2.0
}

pub fn tangent_delta(a: f64, b: f64) -> f64 {
    let mut d = (a - b) % TAU;
    if d > PI {
        d -= TAU;
    }
    if d < -PI {
        d += TAU;
    }
    d = d.abs();
    if d > PI / 2.0 {
        PI - d
    } else {
        d
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct JunctionCheck {
    pub ok: bool,
    pub reason: &'static str,
    pub kink: f64,
    pub step: f64,
}

pub fn junction_check(a: &ArcFeature, b: &ArcFeature, mx: f64, mz: f64) -> JunctionCheck {
    let kink = tangent_delta(tangent_angle(a, mx, mz), tangent_angle(b, mx, mz));
    let ga = surface_gap(a, mx, mz);
    let gb = surface_gap(b, mx, mz);
    let step = (ga - gb).abs();

    if ga.abs() > SURFACE_NEAR || gb.abs() > SURFACE_NEAR {
        return JunctionCheck {
            ok: true,
            reason: "",
            kink,
            step,
        };
    }
    if a.solid_out != b.solid_out {
        return JunctionCheck {
            ok: false,
            reason: "flip",
            kink,
            step,
        };
    }
    if kink > TANGENT_TOL {
        return JunctionCheck {
            ok: false,
            reason: "kink",
            kink,
            step,
        };
    }
    if step > SURFACE_TOL {
        return JunctionCheck {
            ok: false,
            reason: "step",
            kink,
            step,
        };
    }
    JunctionCheck {
        ok: true,
        reason: "",
        kink,
        step,
    }
}

const SIDES: [(i32, i32); 4] = [
    (1, 0),
    (-1, 0),
    (0, 1),
    (0, -1),
];

pub fn junction_clear<T: AsRef<[(i32, i32)]>>(
    g: &Grid,
    tiles: T,
    feature: &ArcFeature,
) -> bool {
    let arc_idx = match &g.arc_idx {
        Some(arr) => arr,
        None => return true,
    };
    let tiles_slice = tiles.as_ref();
    let own: std::collections::HashSet<usize> = tiles_slice.iter().map(|&(ti, tj)| idx(g, ti, tj)).collect();

    for &(ti, tj) in tiles_slice {
        for (di, dj) in SIDES {
            let x = ti + di;
            let y = tj + dj;
            if x < 0 || y < 0 || x >= g.w || y >= g.h {
                continue;
            }
            let k = idx(g, x, y);
            if own.contains(&k) {
                continue;
            }
            if g.shapes[k] != SHAPE_ARC {
                continue;
            }
            let fi = arc_idx[k];
            if fi < 0 || (fi as usize) >= g.arcs.len() {
                continue;
            }
            let mx = (ti as f64) + 0.5 + (di as f64) * 0.5;
            let mz = (tj as f64) + 0.5 + (dj as f64) * 0.5;
            if !junction_check(feature, &g.arcs[fi as usize], mx, mz).ok {
                return false;
            }
        }
    }
    true
}

#[derive(Debug, Clone)]
pub struct ArcJunction {
    pub i: i32,
    pub j: i32,
    pub di: i32,
    pub dj: i32,
    pub a: usize,
    pub b: usize,
    pub check: JunctionCheck,
}

pub fn find_arc_junctions(g: &Grid, only_bad: bool) -> Vec<ArcJunction> {
    let mut out = Vec::new();
    let arc_idx = match &g.arc_idx {
        Some(arr) => arr,
        None => return out,
    };
    for j in 0..g.h {
        for i in 0..g.w {
            let k = idx(g, i, j);
            if g.shapes[k] != SHAPE_ARC {
                continue;
            }
            let a = arc_idx[k];
            if a < 0 || (a as usize) >= g.arcs.len() {
                continue;
            }
            for &(di, dj) in &[(1, 0), (0, 1)] {
                let x = i + di;
                let y = j + dj;
                if x >= g.w || y >= g.h {
                    continue;
                }
                let kk = idx(g, x, y);
                if g.shapes[kk] != SHAPE_ARC {
                    continue;
                }
                let b = arc_idx[kk];
                if b < 0 || (b as usize) >= g.arcs.len() || b == a {
                    continue;
                }
                let mx = (i as f64) + 0.5 + (di as f64) * 0.5;
                let mz = (j as f64) + 0.5 + (dj as f64) * 0.5;
                let check = junction_check(&g.arcs[a as usize], &g.arcs[b as usize], mx, mz);
                if only_bad && check.ok {
                    continue;
                }
                out.push(ArcJunction {
                    i,
                    j,
                    di,
                    dj,
                    a: a as usize,
                    b: b as usize,
                    check,
                });
            }
        }
    }
    out
}

pub fn backed_at(g: &Grid, f: &ArcFeature, ang: f64) -> bool {
    let rr = if f.solid_out {
        f.r + BACK_PROBE
    } else {
        f.r - BACK_PROBE
    };
    if rr <= 0.0 {
        return false;
    }
    let i = (f.cx + ang.cos() * rr).floor() as i32;
    let j = (f.cz + ang.sin() * rr).floor() as i32;
    if i < 0 || j < 0 || i >= g.w || j >= g.h {
        return false;
    }
    !is_walkable(g, i, j)
}

pub fn backed_fraction(g: &Grid, f: &ArcFeature) -> f64 {
    let n = 4.max((f.r * f.span * (SAMPLES_PER_TILE as f64)).ceil() as usize);
    let mut ok = 0;
    for s in 0..=n {
        if backed_at(g, f, f.a0 + (f.span * (s as f64)) / (n as f64)) {
            ok += 1;
        }
    }
    (ok as f64) / ((n + 1) as f64)
}

pub fn trim_arc_to_backing(g: &Grid, f: &ArcFeature) -> Option<ArcFeature> {
    if f.span >= PI * 2.0 - 1e-6 || f.owner == Some("island") {
        return if backed_fraction(g, f) > 0.5 {
            Some(f.clone())
        } else {
            None
        };
    }
    if f.owner == Some("funnel") {
        return if backed_fraction(g, f) > 0.999 {
            Some(f.clone())
        } else {
            None
        };
    }

    let n = 4.max((f.r * f.span * (SAMPLES_PER_TILE as f64)).ceil() as usize);
    let step = f.span / (n as f64);
    let mut best_start: Option<usize> = None;
    let mut best_len = 0;
    let mut run_start: Option<usize> = None;

    for s in 0..=n {
        if backed_at(g, f, f.a0 + step * (s as f64)) {
            if run_start.is_none() {
                run_start = Some(s);
            }
            let len = s - run_start.unwrap();
            if len > best_len {
                best_len = len;
                best_start = run_start;
            }
        } else {
            run_start = None;
        }
    }

    let Some(start) = best_start else {
        return None;
    };
    if best_len == 0 {
        return None;
    }
    let span = (best_len as f64) * step;
    if span * f.r < MIN_ARC_LEN {
        return None;
    }
    if start == 0 && best_len == n {
        return Some(f.clone());
    }
    let a0 = f.a0 + (start as f64) * step;

    let clip_kicks = |kicks: &[KickBand]| -> Vec<KickBand> {
        let mut out = Vec::new();
        for b in kicks {
            let s = b.a0.max(a0);
            let e = (b.a0 + b.span).min(a0 + span);
            if (e - s) * f.r >= MIN_ARC_LEN * 0.5 {
                out.push(KickBand {
                    a0: s,
                    span: e - s,
                    cooldown_t: b.cooldown_t,
                    hit_t: b.hit_t,
                });
            }
        }
        out
    };

    let clip_lanes = |lanes: &[LaneBand]| -> Vec<LaneBand> {
        let mut out = Vec::new();
        for b in lanes {
            let s = b.a0.max(a0);
            let e = (b.a0 + b.span).min(a0 + span);
            if (e - s) * f.r >= MIN_ARC_LEN * 0.5 {
                out.push(LaneBand {
                    a0: s,
                    span: e - s,
                    cw: b.cw,
                    cooldown_t: b.cooldown_t,
                    hit_t: b.hit_t,
                });
            }
        }
        out
    };

    Some(ArcFeature {
        cx: f.cx,
        cz: f.cz,
        r: f.r,
        a0,
        span,
        solid_out: f.solid_out,
        owner: f.owner,
        kicks: clip_kicks(&f.kicks),
        lanes: clip_lanes(&f.lanes),
    })
}

pub fn compact_arcs(g: &mut Grid, min_tiles: usize) -> usize {
    if g.arcs.is_empty() {
        return 0;
    }

    let mut count = vec![0usize; g.arcs.len()];
    if let Some(ref arc_idx) = g.arc_idx {
        for k in 0..g.shapes.len() {
            if g.shapes[k] != SHAPE_ARC {
                continue;
            }
            let i = (k as i32) % g.w;
            let j = (k as i32) / g.w;
            if at(g, i, j) != T_WALL {
                continue;
            }
            let fi = arc_idx[k];
            if fi >= 0 && (fi as usize) < g.arcs.len() {
                count[fi as usize] += 1;
            }
        }
    }

    let chained = |f: &ArcFeature| f.owner == Some("island") || f.owner == Some("funnel");
    let trimmed: Vec<Option<ArcFeature>> = g.arcs.iter().map(|f| trim_arc_to_backing(g, f)).collect();
    let keep: Vec<bool> = g
        .arcs
        .iter()
        .enumerate()
        .map(|(fi, f)| trimmed[fi].is_some() && count[fi] >= if chained(f) { 1 } else { min_tiles })
        .collect();

    let mut remap = vec![-1i16; g.arcs.len()];
    let mut next = Vec::new();
    for fi in 0..g.arcs.len() {
        if !keep[fi] {
            continue;
        }
        remap[fi] = next.len() as i16;
        next.push(trimmed[fi].clone().unwrap());
    }

    if let Some(ref mut arc_idx) = g.arc_idx {
        for k in 0..g.shapes.len() {
            if g.shapes[k] != SHAPE_ARC {
                continue;
            }
            let fi = arc_idx[k];
            let to = if fi >= 0 && (fi as usize) < remap.len() {
                remap[fi as usize]
            } else {
                -1
            };
            if to < 0 {
                g.shapes[k] = SHAPE_FULL;
                arc_idx[k] = -1;
            } else {
                arc_idx[k] = to;
            }
        }
    }

    let dropped = g.arcs.len() - next.len();
    g.arcs = next;
    dropped
}

pub fn find_orphan_arc_tiles(g: &Grid) -> Vec<(i32, i32)> {
    let mut out = Vec::new();
    for j in 0..g.h {
        for i in 0..g.w {
            if g.shapes[idx(g, i, j)] != SHAPE_ARC {
                continue;
            }
            if is_walkable(g, i, j) {
                out.push((i, j));
            }
        }
    }
    out
}

pub fn clear_orphan_arc_tiles(g: &mut Grid) -> usize {
    let orphans = find_orphan_arc_tiles(g);
    let n = orphans.len();
    for (i, j) in orphans {
        let k = idx(g, i, j);
        set_shape(g, i, j, SHAPE_FULL);
        if let Some(ref mut arc_idx) = g.arc_idx {
            arc_idx[k] = -1;
        }
    }
    n
}

